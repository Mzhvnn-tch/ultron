import express from "express";
import { config } from "./config.js";
import { logger } from "./utils/logger.js";
import { getOrchestrator } from "./pipeline/orchestrator.js";
import { getBundleParser } from "./layers/layer4-bundle-parser.js";
import { getValidityEngine } from "./pipeline/validity.js";
import { getCapWrapper } from "./cap/wrapper.js";
import { getEndpointCache } from "./cache/endpoint-cache.js";
import { getBrowserPool } from "./browser/pool.js";
import { getCodeBuilder } from "./agent/code-builder.js";
import { ResearchQuery } from "./types.js";
import type { Request, Response, NextFunction } from "express";

const app = express();

app.use(express.json({ limit: "1mb" }));
app.use(express.static("public"));

// ─── CORS + Info Headers ────────────────────────────────

app.use((_req: Request, res: Response, next: NextFunction) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("X-Powered-By", "DeepResearchAgent/1.0");
  res.setHeader("X-RateLimit-Max-Domains", config.rateLimit.maxConcurrentDomains);
  res.setHeader("X-RateLimit-Delay-Ms", config.rateLimit.requestDelayMs);
  next();
});

app.options("*", (_req: Request, res: Response) => {
  res.sendStatus(204);
});

// ─── Optional API Key Security Authentication ─────────────

app.use((req: Request, res: Response, next: NextFunction) => {
  const apiKey = process.env.ULTRON_API_KEY;
  if (apiKey && req.path.startsWith("/research")) {
    const authHeader = req.headers.authorization;
    if (!authHeader || authHeader !== `Bearer ${apiKey}`) {
      res.status(401).json({ error: "Unauthorized: Invalid or missing API key" });
      return;
    }
  }
  next();
});

// ─── Observability & Prometheus Metrics Endpoint ───────────

app.get("/metrics", (_req: Request, res: Response) => {
  const memory = process.memoryUsage();
  const cacheStats = getEndpointCache().stats();
  const metrics = `
# HELP ultron_uptime_seconds Process uptime in seconds
# TYPE ultron_uptime_seconds gauge
ultron_uptime_seconds ${process.uptime()}

# HELP ultron_memory_heap_used_bytes Heap memory used in bytes
# TYPE ultron_memory_heap_used_bytes gauge
ultron_memory_heap_used_bytes ${memory.heapUsed}

# HELP ultron_cached_endpoints_total Total cached API endpoints in SQLite
# TYPE ultron_cached_endpoints_total gauge
ultron_cached_endpoints_total ${cacheStats.totalEndpoints}
  `.trim();
  res.setHeader("Content-Type", "text/plain");
  res.send(metrics);
});

// ─── Health Check ──────────────────────────────────────

app.get("/health", (_req: Request, res: Response) => {
  const cache = getEndpointCache();
  res.json({
    status: "ok",
    uptime: process.uptime(),
    cache: cache.stats(),
    cap: {
      enabled: config.croo.enabled,
      identity: getCapWrapper().getIdentity().did,
    },
  });
});

// ─── Research Endpoint ─────────────────────────────────

app.post("/research", async (req: Request, res: Response) => {
  const startTime = Date.now();

  try {
    const parsed = ResearchQuery.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Invalid request",
        details: parsed.error.flatten(),
      });
      return;
    }

    logger.info({ query: parsed.data.query }, "POST /research");

    const orchestrator = getOrchestrator();
    const result = await orchestrator.research(parsed.data);

    res.json({
      ...result,
      _meta: {
        serverTimeMs: Date.now() - startTime,
      },
    });
  } catch (err: any) {
    logger.error({ error: err.message }, "POST /research error");
    res.status(500).json({
      error: "Research failed",
      message: err.message,
      durationMs: Date.now() - startTime,
    });
  }
});

// ─── Quick Research (lightweight) ──────────────────────

app.post("/research/quick", async (req: Request, res: Response) => {
  try {
    const parsed = ResearchQuery.safeParse({
      ...req.body,
      maxDepth: Math.min(req.body.maxDepth || 2, 2),
      maxSources: Math.min(req.body.maxSources || 5, 5),
    });
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
      return;
    }

    const orchestrator = getOrchestrator();
    const result = await orchestrator.research(parsed.data);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: "Quick research failed", message: err.message });
  }
});

// ─── Deep Research: JS Bundle API Extraction ─────────

app.post("/research/deep", async (req: Request, res: Response) => {
  const startTime = Date.now();

  try {
    const { domain, query } = req.body;
    
    if (!domain) {
      res.status(400).json({ error: "Missing 'domain' in request body" });
      return;
    }

    logger.info({ domain, query }, "POST /research/deep");

    // Phase 1: Extract APIs from JS bundles
    const parser = getBundleParser();
    const apiClient = await parser.extractApis(domain);

    // Phase 2: Hit discovered APIs directly
    const apiResults: Record<string, any> = {};
    
    // Try top 5 highest confidence endpoints
    const topEndpoints = apiClient.endpoints
      .filter(e => e.confidence > 0.5)
      .slice(0, 5);

    for (const ep of topEndpoints) {
      try {
        const fullUrl = ep.url.startsWith("http") ? ep.url : `https://${domain}${ep.url}`;
        const resp = await fetch(fullUrl, {
          method: ep.method,
          headers: {
            "User-Agent": "Mozilla/5.0",
            "Accept": "application/json",
            ...ep.headers,
          },
          ...(ep.bodyTemplate ? { body: JSON.stringify(ep.bodyTemplate) } : {}),
        });
        
        const contentType = String(resp.headers.get("content-type") || "").toLowerCase();
        if (resp.ok && !contentType.includes("text/html")) {
          const data = await resp.json().catch(() => ({}));
          if (Object.keys(data).length > 0) {
            apiResults[ep.description || ep.url] = data;
            logger.info({ url: fullUrl, status: resp.status }, "[Deep] API hit successful");
          }
        }
      } catch (err: any) {
        logger.debug({ url: ep.url, error: err.message }, "[Deep] API hit failed");
      }
    }

    // Phase 3: Synthesize findings (if LLM available)
    let summary = "";
    try {
      const { getSynthesizer } = await import("./pipeline/synthesizer.js");
      const findings = Object.entries(apiResults).map(([desc, data], i) => ({
        id: `deep-${i}`,
        claim: `${desc}: ${JSON.stringify(data).substring(0, 300)}`,
        evidence: [{ text: JSON.stringify(data).substring(0, 1000), sourceUrl: domain, sourceTitle: desc, relevance: 0.9, extractedAt: Date.now() }],
        confidence: 0.85,
        sourceUrls: [domain],
      }));
      summary = await getSynthesizer().synthesize(query || `Extract all data from ${domain}`, [], findings);
    } catch {
      summary = `Extracted ${apiClient.endpoints.length} API endpoints from ${domain}. Successfully queried ${Object.keys(apiResults).length} of them.`;
    }

    const duration = Date.now() - startTime;

    res.json({
      domain,
      durationMs: duration,
      summary,
      credentials: apiClient.credentials,
      apiEndpoints: apiClient.endpoints,
      baseUrls: apiClient.baseUrls,
      authFlow: apiClient.authFlow,
      curlCommands: apiClient.curlCommands,
      codeSnippets: apiClient.codeSnippets,
      directApiResults: apiResults,
      totalEndpointsFound: apiClient.endpoints.length,
      totalEndpointsQueried: Object.keys(apiResults).length,
    });

  } catch (err: any) {
    logger.error({ error: err.message }, "POST /research/deep error");
    res.status(500).json({
      error: "Deep research failed",
      message: err.message,
      durationMs: Date.now() - startTime,
    });
  }
});

// ─── Deep Research: Verify & Validate ──────────────

app.post("/research/verify", async (req: Request, res: Response) => {
  const startTime = Date.now();

  try {
    const { query } = req.body;

    if (!query) {
      res.status(400).json({ error: "Missing 'query' in request body" });
      return;
    }

    logger.info({ query }, "POST /research/verify");

    const engine = getValidityEngine();
    const report = await engine.verifyQuery(query);

    res.json({
      report,
      durationMs: Date.now() - startTime,
      summary: engine.generateReport(report),
    });
  } catch (err: any) {
    logger.error({ error: err.message }, "POST /research/verify error");
    res.status(500).json({
      error: "Verification failed",
      message: err.message,
      durationMs: Date.now() - startTime,
    });
  }
});

// ─── Autonomous Codebase Self-Upgrade Endpoint ───────

app.get("/audit/codebase", async (_req: Request, res: Response) => {
  try {
    const builder = getCodeBuilder();
    const report = await builder.auditCodebase();
    res.json({ status: "success", report });
  } catch (err: any) {
    res.status(500).json({ error: "Codebase audit failed", message: err.message });
  }
});

// ─── Cache Management ──────────────────────────────────

app.get("/cache/stats", (_req: Request, res: Response) => {
  res.json(getEndpointCache().stats());
});

app.get("/cache/domains", (_req: Request, res: Response) => {
  res.json({ domains: getEndpointCache().getAllDomains() });
});

app.get("/cache/domain/:domain", (req: Request, res: Response) => {
  const endpoints = getEndpointCache().getForDomain(req.params.domain);
  res.json({ domain: req.params.domain, endpoints, count: endpoints.length });
});

// ─── Browser Pool Management ──────────────────────────

app.get("/pool/stats", (_req: Request, res: Response) => {
  res.json(getBrowserPool().stats());
});

// ─── CROO CAP Protocol Endpoints ──────────────────────

if (config.croo.enabled) {
  const cap = getCapWrapper();

  app.get("/cap/identity", (_req: Request, res: Response) => {
    res.json(cap.getIdentity());
  });

  app.post("/cap/order", async (req: Request, res: Response) => {
    try {
      logger.info({ body: req.body }, "[CROO] Incoming HTTP order");
      const delivery = await cap.handleOrderHttp(req.body);
      res.json({ status: "delivered", ...delivery });
    } catch (err: any) {
      logger.error({ error: err.message }, "[CROO] HTTP order error");
      res.status(500).json({ error: "Order processing failed" });
    }
  });
}

// ─── Error Handler ─────────────────────────────────────

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  logger.error({ error: err.message, stack: err.stack }, "Unhandled error");
  res.status(500).json({ error: "Internal server error" });
});

// ─── Start ─────────────────────────────────────────────

export function startServer(): void {
  const server = app.listen(config.server.port, config.server.host, () => {
    logger.info(
      {
        host: config.server.host,
        port: config.server.port,
        croo: config.croo.enabled ? "enabled" : "disabled",
      },
      "Ultron server started"
    );

    if (config.croo.enabled) {
      getCapWrapper().initialize().catch((err) => {
        logger.warn({ error: err.message }, "[CROO] Initialization failed");
      });
    }
  });

  process.on("SIGTERM", () => {
    logger.info("Shutting down...");
    getCapWrapper().shutdown();
    server.close(() => process.exit(0));
  });

  process.on("SIGINT", () => {
    logger.info("Shutting down...");
    getCapWrapper().shutdown();
    server.close(() => process.exit(0));
  });
}

export { app };
