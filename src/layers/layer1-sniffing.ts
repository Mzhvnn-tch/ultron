import { config } from "../config.js";
import { getEndpointCache } from "../cache/endpoint-cache.js";
import { Browser, Page } from "playwright";
import { getBrowserPool } from "../browser/pool.js";
import { logger } from "../utils/logger.js";
import { WasmParser } from "../utils/wasm-parser.js";
import type { DiscoveredEndpoint } from "../types.js";

interface CapturedRequest {
  url: string;
  method: string;
  requestHeaders: Record<string, string>;
  postData?: string;
  responseHeaders?: Record<string, string>;
  responseBody?: string;
  status?: number;
  contentType?: string;
  isApiCall: boolean;
}

/**
 * LAYER 1 — Network Sniffing via Chrome DevTools Protocol
 *
 * Opens a headless browser ONCE to visit a page, but captures ALL
 * XHR/fetch requests the frontend makes in the background.
 * These internal JSON API endpoints get cached for future direct use.
 *
 * This is the "learning" layer — the agent gets smarter every time
 * it visits a domain.
 */
export class NetworkSniffer {
  /**
   * Visit a page and capture all background API calls.
   * Returns discovered endpoints that can be hit directly next time.
   */
  async sniff(url: string): Promise<DiscoveredEndpoint[]> {
    logger.info({ url }, "[Layer 1] Starting network sniff");

    const captured: CapturedRequest[] = [];
    const capturedWasmEndpoints: DiscoveredEndpoint[] = [];
    const now = Date.now();

    let page: Page | null = null;
    let browser: Browser | null = null;

    try {
      const pool = getBrowserPool();
      browser = await pool.acquire();

      const context = await pool.createContext(browser);

      // Stealth patches & WASM runtime memory hooks
      await context.addInitScript(`
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
        window.chrome = { runtime: {} };
        window.__ultronWasmBuffers = [];
        if (window.WebAssembly && window.WebAssembly.instantiate) {
          const origInstantiate = window.WebAssembly.instantiate;
          window.WebAssembly.instantiate = function(bytes, importObject) {
            try {
              let buf = bytes instanceof ArrayBuffer ? bytes : (bytes && bytes.buffer ? bytes.buffer : null);
              if (buf) {
                const arr = Array.from(new Uint8Array(buf.slice(0, Math.min(buf.byteLength, 100000))));
                window.__ultronWasmBuffers.push(arr);
              }
            } catch(e) {}
            return origInstantiate.apply(this, arguments);
          };
        }
      `);

      page = await context.newPage();

      // Listen to responses natively in Playwright
      page.on("response", async (response) => {
        try {
          const req = response.request();
          const reqUrl = req.url();
          const reqHeaders = req.headers();
          const method = req.method();
          const postData = req.postData() || undefined;

          const status = response.status();
          const responseHeaders = response.headers();
          const contentType = responseHeaders["content-type"] || responseHeaders["Content-Type"] || "";

          const isApi = this.isApiRequest(reqUrl, reqHeaders) || contentType.toLowerCase().includes("json");

          if (isApi) {
            let responseBody: string | undefined;
            if (status >= 200 && status < 300 && contentType.toLowerCase().includes("json")) {
              try {
                responseBody = await response.text();
              } catch {
                // Response text might not be available for some responses
              }
            }

            captured.push({
              url: reqUrl,
              method,
              requestHeaders: reqHeaders,
              postData,
              responseHeaders,
              responseBody,
              status,
              contentType,
              isApiCall: true,
            });
          }
        } catch (err) {
          // Ignore event handling errors
        }
      });

      // Listen to live WebSocket connections & JSON stream frames
      page.on("websocket", (ws) => {
        const wsUrl = ws.url();
        logger.info({ wsUrl }, "[Layer 1] Live WebSocket connection intercepted");

        ws.on("framereceived", (event) => {
          try {
            const payload = String(event.payload || "");
            if (payload.startsWith("{") || payload.startsWith("[")) {
              captured.push({
                url: wsUrl,
                method: "WS_RECV",
                requestHeaders: {},
                responseBody: payload.substring(0, 5000),
                status: 200,
                contentType: "application/json; websocket",
                isApiCall: true,
              });
            }
          } catch {
            // Ignore ws frame parsing errors
          }
        });
      });

      // ─── Navigate (Fast 5s Timeout) ─────────────────
      logger.info({ url }, "[Layer 1] Navigating page (fast 5s limit)...");
      await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: 5000,
      });

      // Wait extra for lazy-loaded API calls
      await page.waitForTimeout(500);

      // Scroll to trigger more lazy loads
      await page.evaluate(`
        window.scrollTo(0, document.body.scrollHeight / 2);
      `);
      await page.waitForTimeout(300);
      await page.evaluate(`
        window.scrollTo(0, document.body.scrollHeight);
      `);
      await page.waitForTimeout(300);

      // ─── SPA Interaction: Click common interactive elements ───
      // This triggers lazy-loaded API calls that are only fired on user interaction
      const spaClickSelectors = [
        'a[href*="login"]',
        'a[href*="signup"]',
        'a[href*="pricing"]',
        'a[href*="features"]',
        'a[href*="docs"]',
        'a[href*="api"]',
        'a[href*="about"]',
        'button:has-text("Login")',
        'button:has-text("Sign Up")',
        'button:has-text("Get Started")',
        'button:has-text("Try Free")',
        '[aria-label*="menu"]',
        '.navbar a',
        'nav a',
        'header a',
      ];

      for (const sel of spaClickSelectors) {
        try {
          const el = await page.$(sel);
          if (el) {
            const href = await el.getAttribute("href").catch(() => null);
            // Only click internal links (avoid navigation away from domain)
            if (href && !href.startsWith("http") && !href.startsWith("//") && !href.startsWith("#")) {
              logger.debug({ selector: sel, href }, "[Layer 1] Clicking SPA element");
              await el.click({ timeout: 2000 });
              await page.waitForTimeout(1500);
            }
          }
        } catch {
          // Element not found or not clickable — skip
        }
      }

      // ─── SPA Route Probing ──────────────────────────
      // Common SPA routes that trigger API calls when visited
      const spaRoutes = [
        "/login",
        "/signup",
        "/pricing",
        "/features",
        "/docs",
        "/api",
        "/about",
        "/dashboard",
        "/products",
        "/solutions",
      ];

      for (const route of spaRoutes) {
        try {
          const fullUrl = new URL(route, url).toString();
          logger.debug({ route: fullUrl }, "[Layer 1] Probing SPA route");
          await page.goto(fullUrl, {
            waitUntil: "domcontentloaded",
            timeout: 8000,
          });
          await page.waitForTimeout(1000);
        } catch {
          // Route may not exist or timeout — skip
        }
      }

      // ─── Extract Captured WASM Buffers ───────────────
      try {
        const rawBuffers = await page.evaluate(() => (window as any).__ultronWasmBuffers || []);
        if (Array.isArray(rawBuffers) && rawBuffers.length > 0) {
          logger.info({ count: rawBuffers.length }, "[Layer 1 WASM] Processing captured WASM modules from heap");
          for (const rawArr of rawBuffers) {
            const buf = Buffer.from(rawArr);
            const analysis = WasmParser.parseWasmBuffer(buf, url);
            for (const extractedUrl of analysis.extractedUrls) {
              capturedWasmEndpoints.push({
                url: extractedUrl,
                method: "GET",
                authType: Object.keys(analysis.signatureHeaders).length > 0 ? "wasm-signature" : "none",
                description: `Extracted from WASM memory heap: ${analysis.exportedFunctions.slice(0, 3).join(", ")}`,
                source: "layer1-wasm",
                confidence: 0.9,
                discoveredAt: now,
                successCount: 0,
                failCount: 0,
                wasmMetadata: {
                  moduleUrl: url,
                  exportedFunctions: analysis.exportedFunctions,
                  signatureHeaders: analysis.signatureHeaders,
                  extractedUrls: analysis.extractedUrls,
                  decompiledSnippet: analysis.decompiledSnippet,
                },
              });
            }
          }
        }
      } catch (e: any) {
        logger.debug({ error: e.message }, "[Layer 1 WASM] Error extracting WASM buffers");
      }

    } catch (err: any) {
      logger.warn({ url, error: err.message }, "[Layer 1] Navigation error");
    } finally {
      if (page) {
        try { await page.close(); } catch {}
      }
      if (browser) {
        const pool = getBrowserPool();
        await pool.release(browser);
      }
    }

    // ─── Process Captured Requests ────────────────────
    const apiCalls = captured.filter((c) => c.isApiCall);
    logger.info(
      { total: captured.length, apiCalls: apiCalls.length },
      "[Layer 1] Capture complete"
    );

    const endpoints = this.processCapturedRequests(apiCalls, now);
    if (typeof capturedWasmEndpoints !== "undefined" && capturedWasmEndpoints.length > 0) {
      endpoints.push(...capturedWasmEndpoints);
    }

    // Cache them
    if (endpoints.length > 0) {
      getEndpointCache().saveBatch(endpoints);
    }

    return endpoints;
  }

  /**
   * Determine if a request looks like an API call (JSON endpoint).
   */
  private isApiRequest(
    url: string,
    headers: Record<string, string>
  ): boolean {
    const urlLower = url.toLowerCase();

    // Exclude static assets (images, fonts, CSS, JS bundles, analytics)
    const staticPatterns = [
      /\.(css|js|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot|mp4|webm|pdf)(\?|$)/i,
      /cdn-cgi\//i,      // Cloudflare analytics
      /analytics/i,
      /pixel/i,
      /beacon/i,
      /favicon/i,
    ];
    for (const pattern of staticPatterns) {
      if (pattern.test(urlLower)) return false;
    }

    // Check common API patterns in URL
    const apiPatterns = [
      "/api/",
      "/v1/",
      "/v2/",
      "/graphql",
      "/rest/",
      "/json",
      ".json",
    ];
    for (const pattern of apiPatterns) {
      if (urlLower.includes(pattern)) return true;
    }

    // Check fetch/XHR headers
    const accept = (headers["accept"] || headers["Accept"] || "").toLowerCase();
    if (accept.includes("application/json")) return true;

    const xRequestedWith =
      headers["x-requested-with"] || headers["X-Requested-With"] || "";
    if (xRequestedWith.toLowerCase() === "xmlhttprequest") return true;

    // Check for common API host patterns
    if (urlLower.includes("api.") || urlLower.includes("api-")) return true;

    return false;
  }

  /**
   * Process captured requests into DiscoveredEndpoint objects.
   */
  private processCapturedRequests(
    requests: CapturedRequest[],
    now: number
  ): DiscoveredEndpoint[] {
    // Filter: only keep API-like requests (JSON responses or API URL patterns)
    const apiOnly = requests.filter((req) => {
      const ct = (req.contentType || "").toLowerCase();
      // Skip images, CSS, fonts, videos
      if (ct.includes("image/") || ct.includes("text/css") || ct.includes("font/") || ct.includes("video/")) {
        return false;
      }
      // Skip static assets
      if (req.url.match(/\.(css|js|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot|mp4|webm)(\?|$)/i)) {
        return false;
      }
      // Keep JSON responses and URLs that look like API endpoints
      return ct.includes("json") || req.url.includes("/api/") || req.url.includes("/v1/") || req.url.includes("/v2/");
    });

    // Group by URL (strip query params for dedup)
    const grouped = new Map<string, CapturedRequest[]>();

    for (const req of requests) {
      try {
        const u = new URL(req.url);
        const key = `${req.method}:${u.origin}${u.pathname}`;
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key)!.push(req);
      } catch {
        // Skip malformed URLs
      }
    }

    const endpoints: DiscoveredEndpoint[] = [];

    for (const [key, reqs] of grouped) {
      const best = reqs[0]; // Use first occurrence

      // Parse back the real URL from the key (key format: "METHOD:https://...")
      const realUrl = key.replace(/^(GET|POST|PUT|DELETE|PATCH):/, "");

      // Extract query param names from actual calls
      let params: Record<string, string> | undefined;
      try {
        // Use the first actual captured URL (which has query params)
        const firstUrl = reqs.find((r) => r.url.includes("?"))?.url || best.url;
        const u = new URL(firstUrl);
        if (u.searchParams.size > 0) {
          params = {};
          u.searchParams.forEach((v, k) => {
            params![k] = v;
          });
        }
      } catch {}

      // Detect auth type from headers
      let authType: DiscoveredEndpoint["authType"] = undefined;
      let authDetails: DiscoveredEndpoint["authDetails"] | undefined;

      const authHeader =
        best.requestHeaders["authorization"] ||
        best.requestHeaders["Authorization"] ||
        "";
      if (authHeader.startsWith("Bearer ")) {
        authType = "bearer";
        authDetails = { headerName: "Authorization" };
      } else if (authHeader.startsWith("Basic ")) {
        authType = "basic";
        authDetails = { headerName: "Authorization" };
      }

      // Check for API key headers
      for (const [h, v] of Object.entries(best.requestHeaders)) {
        if (
          h.toLowerCase().includes("api-key") ||
          h.toLowerCase().includes("x-api-key")
        ) {
          authType = "api-key";
          authDetails = { headerName: h, tokenHint: v?.substring(0, 8) + "..." };
        }
      }

      // Try to extract a sample JSON response body
      let responseExample: unknown;
      if (best.responseBody) {
        try {
          responseExample = JSON.parse(best.responseBody);
        } catch {}
      }

      endpoints.push({
        url: realUrl, // Real URL without method prefix
        method: best.method as any,
        params,
        headers: this.extractRelevantHeaders(best.requestHeaders),
        authType,
        authDetails,
        description: this.inferDescription(best.url, best.contentType),
        responseExample,
        source: "network-sniff",
        confidence: 0.85, // High — we literally saw this being called
        discoveredAt: now,
        successCount: best.status && best.status < 400 ? 1 : 0,
        failCount: best.status && best.status >= 400 ? 1 : 0,
      });
    }

    return endpoints;
  }

  /**
   * Extract only relevant headers (auth, content-type, etc.)
   */
  private extractRelevantHeaders(
    headers: Record<string, string>
  ): Record<string, string> {
    const relevant = [
      "authorization",
      "content-type",
      "accept",
      "x-api-key",
      "x-request-id",
      "x-correlation-id",
      "api-key",
    ];
    const extracted: Record<string, string> = {};
    for (const [k, v] of Object.entries(headers)) {
      if (relevant.includes(k.toLowerCase())) {
        extracted[k] = v;
      }
    }
    return extracted;
  }

  /**
   * Try to infer a human-readable description from URL patterns.
   */
  private inferDescription(url: string, contentType?: string): string {
    try {
      const u = new URL(url);
      const pathParts = u.pathname.split("/").filter(Boolean);

      if (pathParts.includes("search") || pathParts.includes("query")) {
        return "Search/query endpoint";
      }
      if (pathParts.includes("graphql")) {
        return "GraphQL API endpoint";
      }
      if (pathParts.includes("auth") || pathParts.includes("login")) {
        return "Authentication endpoint";
      }
      if (pathParts.includes("user") || pathParts.includes("users")) {
        return "User data endpoint";
      }
      if (pathParts.includes("products") || pathParts.includes("items")) {
        return "Product/item listing endpoint";
      }

      // Generic: use last path segment
      const last = pathParts[pathParts.length - 1] || "";
      return `${last || u.pathname} endpoint (${contentType || "unknown type"})`;
    } catch {
      return `Sniffed API endpoint`;
    }
  }

  /**
   * Cleanup browser resources.
   */
  async close(): Promise<void> {
    // Browser handled by pool — nothing to close here
  }
}

// Singleton
let _sniffer: NetworkSniffer | null = null;
export function getNetworkSniffer(): NetworkSniffer {
  if (!_sniffer) _sniffer = new NetworkSniffer();
  return _sniffer;
}
