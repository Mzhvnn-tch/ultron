import { startServer } from "./server.js";
import { logger } from "./utils/logger.js";
import { getEndpointCache } from "./cache/endpoint-cache.js";
import { getBrowserPool } from "./browser/pool.js";
import { config } from "./config.js";

/**
 * Deep Research Agent — Main Entry Point
 *
 * Layers:
 *  0 — API Discovery (docs, patterns, well-known, OpenAPI parsing)
 *  1 — Network Sniffing (CDP capture, endpoint caching)
 *  2 — Stealth Scrape (headless browser fallback)
 *  3 — Citation Grounding (cross-verification, citations)
 *
 * Pipeline:
 *  Decompose → Discover → Fetch → Verify → Synthesize
 *
 * CAP Wrapper:
 *  Agent discoverable & payable by other agents via CROO protocol
 */
async function main() {
  logger.info("Deep Research Agent v1.0.0");
  logger.info("4-Layer Autonomous Research Engine");

  // Initialize endpoint cache (SQLite)
  const cache = getEndpointCache();
  logger.info({ stats: cache.stats() }, "Cache initialized");

  // Validate config
  if (!config.llm.apiKey) {
    logger.warn("No LLM_API_KEY set - query decomposition and synthesis will use fallback heuristics");
  }

  // Warm up browser pool (pre-launch 2 Chromium instances)
  await getBrowserPool().warmUp(2);

  // Start HTTP server
  startServer();

  // Graceful shutdown
  const shutdown = async () => {
    logger.info("Shutting down...");
    await getBrowserPool().shutdown();
    cache.close();
    process.exit(0);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((err) => {
  logger.error({ error: err.message, stack: err.stack }, "Fatal startup error");
  process.exit(1);
});
