/**
 * LAYER 4 — JS Bundle API Extractor
 *
 * The REAL deep research layer.
 *
 * Instead of scraping HTML or sniffing with a browser (slow, detectable),
 * this layer downloads the website's JavaScript bundles and extracts
 * ALL API endpoint calls directly from the source code.
 *
 * How it works:
 *  1. Download the HTML to find JS bundle URLs
 *  2. Download each JS bundle
 *  3. Parse JavaScript to extract:
 *     - fetch() / axios() calls with URLs
 *     - API endpoint patterns (/api/v1/, /v2/, /graphql, etc.)
 *     - Request body structures (objects passed to fetch/POST)
 *     - Authentication flows (Bearer tokens, API keys, wallet signatures)
 *     - WebSocket endpoints
 *     - GraphQL queries & mutations
 *  4. Reconstruct working API client that hits endpoints directly
 *
 * No browser needed. No CAPTCHA. No rate limiting from Cloudflare.
 * Just raw API access — faster, cleaner, undetectable.
 *
 * Use cases:
 *  - DeFi protocols (Uniswap, DefiLlama, Etherscan) → get raw data
 *  - Any SPA website → bypass the UI, talk to the API directly
 *  - Research platform → offer as a service (faster than Hermes/headless)
 */

import { createHttpClient } from "../utils/http.js";
import { logger } from "../utils/logger.js";
import { getEndpointCache } from "../cache/endpoint-cache.js";
import type { DiscoveredEndpoint } from "../types.js";

// ─── Extracted API Contract ──────────────────────────────

export interface ApiContract {
  /** Full endpoint URL (with base) */
  url: string;
  method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  /** Request headers (auth, content-type, etc.) */
  headers: Record<string, string>;
  /** Request body structure (if POST/PUT) */
  bodyTemplate: Record<string, unknown> | null;
  /** Query parameters */
  queryParams: Record<string, string>;
  /** Source code snippet for verification */
  sourceSnippet: string;
  /** Bundle file this was found in */
  sourceFile: string;
  /** Confidence based on context clues */
  confidence: number;
  /** Description of what this endpoint does */
  description: string;
  /** Auth type detected */
  authType: "bearer" | "api-key" | "none" | "wallet" | "cookie" | "complex" | "unknown";
  /** Any dependencies (e.g., needs token from another endpoint) */
  dependencies: string[];
}

// ─── API Keys Found in Bundle ────────────────────────────

export interface ExtractedCredential {
  type: "supabase-anon" | "supabase-service" | "api-key" | "bearer-token" | "wallet-rpc" | "environment-variable";
  key: string;
  value: string;
  source: string;
  /** Suggested usage */
  usage: string;
}


// ─── API Client Generator ────────────────────────────────

export interface GeneratedClient {
  endpoints: ApiContract[];
  /** Credentials found in bundle (API keys, tokens) */
  credentials: ExtractedCredential[];
  /** Runnable curl commands */
  curlCommands: string[];
  /** Runnable TypeScript snippets */
  codeSnippets: Record<string, string>;
  /** Auth flow (how to get the token) */
  authFlow: string[];
  /** Base URLs discovered */
  baseUrls: string[];
}

// ─── Patterns ────────────────────────────────────────────

const API_PATTERNS = [
  // fetch() calls
  /fetch\s*\(\s*["'`]([^"'`]*)["'`]\s*(?:,?\s*\{[^}]*method\s*:\s*["'`](GET|POST|PUT|DELETE|PATCH)["'`])/gis,
  /fetch\s*\(\s*["'`]([^"'`]*)["'`]\s*\)/g,
  
  // axios calls
  /axios\.(get|post|put|delete|patch)\s*\(\s*["'`]([^"'`]*)["'`]/gis,
  /axios\s*\(\s*\{[^}]*url\s*:\s*["'`]([^"'`]*)["'`][^}]*method\s*:\s*["'`](GET|POST|PUT|DELETE|PATCH)["'`]/gis,
  
  // supabase client calls
  /supabase\.from\s*\(\s*["'`]([^"'`]*)["'`]/gis,
  
  // WebSocket
  /new\s+WebSocket\s*\(\s*["'`]([^"'`]*)["'`]/g,
  /ws:\/\//g,
  /wss:\/\//g,

  // GraphQL
  /graphql/i,
  /gql`/g,
  
  // Common API paths
  /["'`]\/api\/[^"'`\s,)]+["'`]/g,
  /["'`]\/v[12]\/[^"'`\s,)]+/g,
  /["'`]\/rest\/[^"'`\s,)]+/g,
];

const AUTH_PATTERNS = [
  /Authorization\s*:\s*["'`]Bearer\s*\+\s*([a-zA-Z_$][a-zA-Z0-9_$]*)/g,
  /Authorization\s*:\s*["'`]Bearer\s*\$\{([^}]+)\}/g,
  /headers\s*:\s*\{[^}]*Authorization/i,
  /apiKey\s*:|api_key\s*:|X-Api-Key\s*:/gi,
  /signInWithPassword|signInWithOAuth|getSession|refreshToken/g,
  /supabase\.auth\./g,
  /wallet\.signMessage|ethereum\.request|signTypedData/g,
];

const API_DOMAIN_PATTERNS = [
  /["'`](https?:\/\/(?:api|api-gate|api-v2|api-v1|rest|graphql|backend|service)[^"'`\s,)]*)["'`]/g,
  /["'`](https?:\/\/[^"'`\s,)]*\/api\/[^"'`\s,)]*)["'`]/g,
  /["'`](https?:\/\/[^"'`\s,)]*\.(?:supabase\.co|vercel\.app|fly\.dev|railway\.app|render\.com)[^"'`\s,)]*)["'`]/g,
];

/**
 * JS Bundle Parser — Extract API contracts from JavaScript source code.
 */
export class BundleParser {
  private http = createHttpClient();

  /**
   * Full pipeline: download bundles → parse → generate API client.
   */
  async extractApis(domain: string): Promise<GeneratedClient> {
    logger.info({ domain }, "[Layer 4] Starting JS bundle API extraction");

    // Step 1: Get the HTML to find JS bundle URLs
    const bundleUrls = await this.findBundleUrls(domain);
    
    if (bundleUrls.length === 0) {
      // Fallback: try to get HTML from the domain directly
      logger.info({ domain }, "[Layer 4] No bundles found via CDN, trying direct fetch");
      const directBundles = await this.findBundlesFromDirectFetch(domain);
      bundleUrls.push(...directBundles);
    }

    logger.info({ domain, bundlesFound: bundleUrls.length }, "[Layer 4] Bundle discovery complete");

    // Step 2: Download all JS bundles
    const allContracts: ApiContract[] = [];
    
    for (const bundleUrl of bundleUrls) {
      try {
        const code = await this.downloadBundle(bundleUrl);
        if (!code || code.length < 100) continue;

        const contracts = this.parseBundle(code, bundleUrl);
        allContracts.push(...contracts);
      } catch (err: any) {
        logger.debug({ url: bundleUrl, error: err.message }, "[Layer 4] Failed to download bundle");
      }
    }

    // Step 3: Deduplicate & rank
    const unique = this.deduplicateContracts(allContracts);
    const ranked = this.rankContracts(unique);

    // Step 4: Generate runnable API client
    const client = this.generateClient(ranked, domain);

    // Step 5: Cache discovered endpoints
    this.cacheEndpoints(ranked, domain);

    logger.info(
      { domain, endpoints: ranked.length, baseUrls: client.baseUrls.length },
      "[Layer 4] API extraction complete"
    );

    return client;
  }

  /**
   * Find JS bundle URLs from CDN (jsdelivr, unpkg) or direct page fetch.
   */
  private async findBundleUrls(domain: string): Promise<string[]> {
    const bundles: string[] = [];

    // Check common CDN patterns for the domain
    const cdnPatterns = [
      `https://cdn.jsdelivr.net/npm/${domain}`,
      `https://cdn.jsdelivr.net/npm/@${domain}`,
      `https://unpkg.com/${domain}`,
      `https://unpkg.com/@${domain}`,
    ];

    for (const url of cdnPatterns) {
      try {
        const resp = await this.http.get(url, {
          timeout: 5000,
          validateStatus: (s: number) => s < 400,
        });
        if (resp.status === 200 && typeof resp.data === 'string') {
          bundles.push(url);
          logger.debug({ url }, "[Layer 4] Found bundle via CDN");
        }
      } catch {
        // Not found on this CDN
      }
    }

    return bundles;
  }

  /**
   * Fetch the actual page HTML and extract <script> src attributes.
   */
  private async findBundlesFromDirectFetch(domain: string): Promise<string[]> {
    const bundles: string[] = [];
    const url = domain.startsWith("http") ? domain : `https://${domain}`;

    try {
      const resp = await this.http.get(url, {
        timeout: 15000,
        validateStatus: (s: number) => s < 400,
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          Accept: "text/html,application/xhtml+xml",
        },
      });

      const html = typeof resp.data === "string" ? resp.data : String(resp.data);
      
      // Extract ALL script src attributes (including type=module, crossorigin, etc.)
      // Matches: <script src="...">, <script type="module" src="...">, <script type="module" crossorigin src="...">
      const scriptRegex = /<script[^>]*?src\s*=\s*["']([^"']+?)["'][^>]*?>/gi;
      let match;
      while ((match = scriptRegex.exec(html)) !== null) {
        const src = match[1];
        // Accept ANY .js file – don't filter aggressively
        if (!src.endsWith(".js") && !src.includes("/assets/") && !src.includes("/js/")) continue;
        
        const fullUrl = src.startsWith("http") ? src : new URL(src, url).toString();
        if (this.isAnalyticsScript(fullUrl)) continue;
        if (!bundles.includes(fullUrl)) {
          bundles.push(fullUrl);
          logger.debug({ url: fullUrl }, "[Layer 4] Found JS bundle in HTML");
        }
      }

      // Also check for modulepreload links (Vite bundles)
      const moduleRegex = /<link[^>]*?rel\s*=\s*["']modulepreload["'][^>]*?href\s*=\s*["']([^"']+?)["'][^>]*?>/gi;
      while ((match = moduleRegex.exec(html)) !== null) {
        const href = match[1];
        const fullUrl = href.startsWith("http") ? href : new URL(href, url).toString();
        if (!bundles.includes(fullUrl)) {
          bundles.push(fullUrl);
          logger.debug({ url: fullUrl }, "[Layer 4] Found modulepreload bundle");
        }
      }

      // Strategy: Also try common Vite/React chunk patterns directly
      // Vite often chunks: /assets/index-xxx.js, /assets/chunk-xxx.js
      // If we found the HTML, extract the base path and try to find more chunks
      const assetBaseMatch = html.match(/<script[^>]*?src\s*=\s*["'](\/?assets\/[^"']+?)["']/i);
      if (assetBaseMatch) {
        const assetPath = assetBaseMatch[1];
        const basePath = assetPath.substring(0, assetPath.lastIndexOf('/'));
        // Try common chunk patterns
        const chunkPatterns = [
          `${basePath}/chunk-vendors.js`,
          `${basePath}/app.js`,
          `${basePath}/main.js`,
        ];
        for (const cp of chunkPatterns) {
          const fullUrl = cp.startsWith("http") ? cp : new URL(cp, url).toString();
          if (!bundles.includes(fullUrl)) {
            bundles.push(fullUrl);
            logger.debug({ url: fullUrl }, "[Layer 4] Trying common chunk path");
          }
        }
      }

    } catch (err: any) {
      logger.warn({ domain, error: err.message }, "[Layer 4] Direct fetch failed");
    }

    return bundles;
  }

  /**
   * Download a JS bundle.
   */
  private async downloadBundle(url: string): Promise<string | null> {
    try {
      const resp = await this.http.get(url, {
        timeout: 15000,
        validateStatus: (s: number) => s < 400,
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.536",
          Accept: "*/*",
        },
        // Don't decompress — we need the raw JS
        decompress: true,
      });

      if (resp.status !== 200) return null;

      const data = typeof resp.data === "string" ? resp.data : String(resp.data);
      
      // Validate it looks like JS (not HTML, not binary)
      if (data.startsWith("<!doctype") || data.startsWith("<html")) {
        logger.debug({ url }, "[Layer 4] Bundle is actually HTML — skipping");
        return null;
      }

      if (data.length < 50) return null;

      return data;
    } catch (err: any) {
      logger.debug({ url, error: err.message }, "[Layer 4] Bundle download failed");
      return null;
    }
  }

  /**
   * Parse a JS bundle and extract all API calls.
   */
  parseBundle(code: string, sourceFile: string): ApiContract[] {
    const contracts: ApiContract[] = [];
    const seen = new Set<string>();

    // Strategy 0: Extract Supabase project URL + anon key + table names
    // These are embedded in the bundle for Supabase client initialization
    const supabaseEndpoints = this.extractSupabaseApis(code, sourceFile, seen);
    contracts.push(...supabaseEndpoints);

    // Strategy 1: API URL patterns (finds ALL endpoint URLs)
    const strings = this.extractStrings(code);
    
    for (const str of strings) {
      // Skip short strings
      if (str.length < 10) continue;

      // Check for API URL patterns
      const apiMatch = this.matchApiUrl(str);
      if (apiMatch) {
        const key = `${apiMatch.method}:${apiMatch.url}`;
        if (!seen.has(key)) {
          seen.add(key);
          contracts.push({
            url: apiMatch.url,
            method: apiMatch.method,
            headers: {},
            bodyTemplate: null,
            queryParams: {},
            sourceSnippet: this.extractContext(code, str),
            sourceFile,
            confidence: 0.6,
            description: this.describeEndpoint(apiMatch.url),
            authType: "unknown",
            dependencies: [],
          });
        }
      }
    }

    // Strategy 2: Search for structured API call patterns with more context
    const apiCalls = this.findStructuredApiCalls(code, sourceFile);
    for (const call of apiCalls) {
      const key = `${call.method}:${call.url}`;
      if (!seen.has(key)) {
        seen.add(key);
        contracts.push(call);
      }
    }

    // Strategy 3: Find API base URLs and domain patterns
    const baseUrls = this.findBaseUrls(code);
    for (const baseUrl of baseUrls) {
      if (!contracts.some(c => c.url.includes(baseUrl))) {
        contracts.push({
          url: baseUrl,
          method: "GET",
          headers: {},
          bodyTemplate: null,
          queryParams: {},
          sourceSnippet: "",
          sourceFile,
          confidence: 0.5,
          description: `API base URL: ${baseUrl}`,
          authType: "unknown",
          dependencies: [],
        });
      }
    }

    return contracts;
  }

  /**
   * Extract all string literals from JS code (heuristic).
   */

  /**
   * Extract Supabase API endpoints from bundle.
   * Supabase uses: supabase.from('table').select() pattern
   * The project URL and anon key are always hardcoded in the bundle.
   */
  private extractSupabaseApis(code: string, sourceFile: string, seen: Set<string>): ApiContract[] {
    const contracts: ApiContract[] = [];

    // Extract Supabase project URL
    const supabaseUrlMatch = code.match(/["'](https?:\/\/[a-zA-Z0-9.-]+\.supabase\.(?:co|in))["']/);
    const supabaseUrl = supabaseUrlMatch?.[1];

    // Extract Supabase anon key (JWT token starting with eyJ...)
    const anonKeyMatch = code.match(/["'](eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+)["']/);
    const anonKey = anonKeyMatch?.[1];

    // Extract all table names from supabase.from("table_name") calls
    const tableMatches = code.match(/\.from\s*\(\s*["']([^"']+?)["']\s*\)/g);
    const tableNames = [...new Set(tableMatches?.map(m => {
      const t = m.match(/["']([^"']+?)["']/);
      return t?.[1];
    }).filter(Boolean) || [])];

    if (supabaseUrl && anonKey) {
      // Generate Supabase REST API endpoints (public)
      for (const table of tableNames) {
        const restUrl = `${supabaseUrl}/rest/v1/${table}`;
        const key = `GET:${restUrl}`;
        if (!seen.has(key)) {
          seen.add(key);
          contracts.push({
            url: restUrl,
            method: "GET",
            headers: {
              "apikey": anonKey,
              "Authorization": `Bearer ${anonKey}`,
              "Accept": "application/json",
            },
            bodyTemplate: null,
            queryParams: { limit: "1000", select: "*" },
            sourceSnippet: `supabase.from("${table}")`,
            sourceFile,
            confidence: 0.9,
            description: `Supabase REST API — ${table} table (public anon access)`,
            authType: "api-key",
            dependencies: [],
          });
        }
      }

      // Also add the Supabase auth endpoint
      const authUrl = `${supabaseUrl}/auth/v1/token?grant_type=password`;
      const authKey = `POST:${authUrl}`;
      if (!seen.has(authKey)) {
        seen.add(authKey);
        contracts.push({
          url: authUrl,
          method: "POST",
          headers: {
            "apikey": anonKey,
            "Content-Type": "application/json",
          },
          bodyTemplate: { email: "", password: "" },
          queryParams: {},
          sourceSnippet: `supabase.auth.signInWithPassword()`,
          sourceFile,
          confidence: 0.85,
          description: "Supabase Auth — sign in with email/password",
          authType: "api-key",
          dependencies: [],
        });
      }
    }

    return contracts;
  }

  private extractStrings(code: string): string[] {
    const strings: string[] = [];
    
    // Match template literals, single-quoted, double-quoted strings from length 4
    const patterns = [
      /["'`]([^"'`]{4,500})["'`]/g,
      /`([^`]{4,500})`/g,
    ];

    for (const pattern of patterns) {
      let match;
      pattern.lastIndex = 0;
      while ((match = pattern.exec(code)) !== null) {
        const str = match[1];
        
        const lower = str.toLowerCase();
        const isPath = str.startsWith("/");
        const isUrl = lower.startsWith("http");
        const hasApiIndicator = ["api", "graphql", "rest", "v1", "v2"].some(ind => lower.includes(ind));
        
        // Skip short non-path/non-API words (like "name", "type") to avoid noise
        if (str.length < 10 && !isPath && !isUrl && !hasApiPrefix(lower)) continue;

        // Clean up escapes
        const cleaned = str
          .replace(/\\n/g, "")
          .replace(/\\t/g, "")
          .replace(/\\"/g, '"')
          .replace(/\\'/g, "'");
        strings.push(cleaned);
      }
    }

    function hasApiPrefix(s: string): boolean {
      return s.startsWith("api") || s.startsWith("v1") || s.startsWith("v2") || s.startsWith("graphql");
    }

    return strings;
  }

  /**
   * Check if a string looks like an API URL and extract method.
   */
  private matchApiUrl(str: string): { url: string; method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH" } | null {
    const urlLower = str.toLowerCase();

    // Must contain an API-like path
    const apiIndicators = [
      "/api/", "/v1/", "/v2/", "/v3/", "/graphql",
      "/rest/", "/rpc/", ".json", "/auth", "/token",
      "/users", "/data/", "/query", "/search",
    ];

    const hasApiIndicator = apiIndicators.some(ind => urlLower.includes(ind));
    if (!hasApiIndicator) return null;

    // Must look like a URL
    if (!urlLower.startsWith("http") && !urlLower.startsWith("/")) return null;

    // Guess method from URL keywords
    let method: ApiContract["method"] = "GET";
    if (urlLower.includes("login") || urlLower.includes("signup") || urlLower.includes("register")) {
      method = "POST";
    } else if (urlLower.includes("delete") || urlLower.includes("remove")) {
      method = "DELETE";
    } else if (urlLower.includes("update") || urlLower.includes("edit") || urlLower.includes("save")) {
      method = "PUT";
    } else if (urlLower.includes("graphql")) {
      method = "POST";
    }

    return { url: str, method };
  }

  /**
   * Find structured API calls (fetch/axios with method + url + body).
   */
  private findStructuredApiCalls(code: string, sourceFile: string): ApiContract[] {
    const contracts: ApiContract[] = [];

    // Pattern: fetch(url, { method, headers, body })
    const fetchPattern = /fetch\s*\(\s*["'`]([^"'`]*)["'`]\s*,\s*\{([^}]+)\}\s*\)/gis;
    let match;
    while ((match = fetchPattern.exec(code)) !== null) {
      const url = match[1];
      const opts = match[2];

      // Detect method
      const methodMatch = opts.match(/method\s*:\s*["'`](GET|POST|PUT|DELETE|PATCH)["'`]/i);
      const method = methodMatch?.[1] as ApiContract["method"] || "GET";

      // Detect headers
      const headerMatch = opts.match(/headers\s*:\s*\{([^}]*)\}/i);
      let headers: Record<string, string> = {};
      if (headerMatch) {
        const headerStr = headerMatch[1];
        const headerPairs = headerStr.match(/["'`]([^"'`]*)["'`]\s*:\s*["'`]([^"'`]*)["'`]/g);
        if (headerPairs) {
          for (const pair of headerPairs) {
            const [, k, v] = pair.match(/["'`]([^"'`]*)["'`]\s*:\s*["'`]([^"'`]*)["'`]/)!;
            headers[k] = v;
          }
        }
      }

      // Detect body
      let bodyTemplate: Record<string, unknown> | null = null;
      const bodyMatch = opts.match(/body\s*:\s*(\{[^}]+\})/i);
      if (bodyMatch) {
        try {
          // Try to parse as JSON-like object
          const bodyStr = bodyMatch[1]
            .replace(/(\w+)\s*:/g, '"$1":')
            .replace(/'/g, '"');
          bodyTemplate = JSON.parse(bodyStr);
        } catch {
          bodyTemplate = { raw: bodyMatch[1].substring(0, 200) };
        }
      }

      // Detect auth
      let authType: ApiContract["authType"] = "none";
      if (headers["Authorization"]?.startsWith("Bearer")) authType = "bearer";
      if (headers["X-Api-Key"]) authType = "api-key";

      contracts.push({
        url,
        method,
        headers,
        bodyTemplate,
        queryParams: {},
        sourceSnippet: match[0].substring(0, 300),
        sourceFile,
        confidence: 0.85,
        description: this.describeEndpoint(url),
        authType,
        dependencies: [],
      });
    }

    // Pattern: axios.post(url, body, config)
    const axiosPattern = /axios\.(get|post|put|delete|patch)\s*\(\s*["'`]([^"'`]*)["'`]/gis;
    while ((match = axiosPattern.exec(code)) !== null) {
      const axiosMethod = match[1];
      const url = match[2];
      
      const methodMap: Record<string, ApiContract["method"]> = {
        get: "GET", post: "POST", put: "PUT", delete: "DELETE", patch: "PATCH",
      };

      contracts.push({
        url,
        method: methodMap[axiosMethod.toLowerCase()] || "GET",
        headers: {},
        bodyTemplate: null,
        queryParams: {},
        sourceSnippet: match[0].substring(0, 200),
        sourceFile,
        confidence: 0.8,
        description: this.describeEndpoint(url),
        authType: "unknown",
        dependencies: [],
      });
    }

    return contracts;
  }

  /**
   * Find API base URLs and service domains.
   */
  private findBaseUrls(code: string): string[] {
    const urls: string[] = [];
    const seen = new Set<string>();

    // Match full URLs in strings
    const urlPattern = /["'`](https?:\/\/[^"'`\s,);]+)["'`]/g;
    let match;
    while ((match = urlPattern.exec(code)) !== null) {
      try {
        const fullUrl = new URL(match[1]);
        const base = `${fullUrl.protocol}//${fullUrl.hostname}`;
        
        // Only keep API-like hosts
        const host = fullUrl.hostname.toLowerCase();
        if (
          host.includes("api") ||
          host.includes("gate") ||
          host.includes("supabase") ||
          host.includes("graphql") ||
          host.includes("service") ||
          host.includes("backend") ||
          host.includes(".up.") ||
          host.includes("fly.dev") ||
          host.includes("vercel.app") ||
          host.includes("railway.app") ||
          host.includes("netlify.app") ||
          host.includes("onrender.com")
        ) {
          if (!seen.has(base)) {
            seen.add(base);
            urls.push(base);
          }
        }
      } catch {
        // Invalid URL
      }
    }

    return urls;
  }

  /**
   * Extract surrounding code context for a matched string.
   */
  private extractContext(code: string, target: string): string {
    const idx = code.indexOf(target);
    if (idx === -1) return target;
    
    const start = Math.max(0, idx - 100);
    const end = Math.min(code.length, idx + target.length + 100);
    return code.substring(start, end);
  }

  /**
   * Describe what an endpoint does based on its URL.
   */
  private describeEndpoint(url: string): string {
    const lower = url.toLowerCase();
    
    if (lower.includes("graphql")) return "GraphQL API endpoint";
    if (lower.includes("login") || lower.includes("auth")) return "Authentication endpoint";
    if (lower.includes("user") || lower.includes("profile")) return "User data endpoint";
    if (lower.includes("token")) return "Token/credential endpoint";
    if (lower.includes("price") || lower.includes("ticker") || lower.includes("quote")) return "Price/ticker data endpoint";
    if (lower.includes("swap") || lower.includes("trade")) return "Swap/trade endpoint";
    if (lower.includes("pool") || lower.includes("liquidity")) return "Liquidity pool endpoint";
    if (lower.includes("pair") || lower.includes("token")) return "Token/pair data endpoint";
    if (lower.includes("chart") || lower.includes("history") || lower.includes("candle")) return "Chart/historical data endpoint";
    if (lower.includes("balance") || lower.includes("portfolio")) return "Balance/portfolio endpoint";
    if (lower.includes("transaction") || lower.includes("tx")) return "Transaction data endpoint";
    if (lower.includes("stake") || lower.includes("farm")) return "Staking/farming endpoint";
    if (lower.includes("search") || lower.includes("query")) return "Search/query endpoint";
    if (lower.includes("list") || lower.includes("all") || lower.includes("index")) return "List/index endpoint";
    if (lower.includes("deploy") || lower.includes("create") || lower.includes("new")) return "Create/deploy endpoint";
    if (lower.includes("update") || lower.includes("edit") || lower.includes("modify")) return "Update/modify endpoint";
    if (lower.includes("delete") || lower.includes("remove")) return "Delete/remove endpoint";
    if (lower.includes("config") || lower.includes("setting")) return "Configuration endpoint";
    if (lower.includes("wallet") || lower.includes("payment")) return "Wallet/payment endpoint";
    if (lower.includes("notif")) return "Notification endpoint";
    if (lower.includes("feed") || lower.includes("timeline")) return "Feed/timeline endpoint";
    
    return "API endpoint";
  }

  /**
   * Check if a URL is an analytics/library script (skip).
   */
  private isAnalyticsScript(url: string): boolean {
    const skipPatterns = [
      /google-analytics/i,
      /gtag/i,
      /gtm\.js/i,
      /facebook\.net/i,
      /fbevents/i,
      /hotjar/i,
      /sentry\.js/i,
      /cdn-cgi\//i,
      /clarity\.ms/i,
      /posthog/i,
      /amplitude/i,
      /segment\.io/i,
      /fullstory/i,
      /cdn\.jsdelivr\.net\/npm\/(jquery|lodash|moment|chart\.js|d3|bootstrap)/i,
      /cdnjs\.cloudflare\.com/i,
      /kit\.fontawesome\.com/i,
    ];
    return skipPatterns.some(p => p.test(url));
  }

  /**
   * Deduplicate contracts by URL+method.
   */
  private deduplicateContracts(contracts: ApiContract[]): ApiContract[] {
    const seen = new Map<string, ApiContract>();
    
    for (const c of contracts) {
      // Normalize URL — remove query params for dedup
      let normalizedUrl = c.url;
      try {
        const u = new URL(c.url.startsWith("http") ? c.url : `https:${c.url}`);
        normalizedUrl = `${u.origin}${u.pathname}`;
      } catch {}
      
      const key = `${c.method}:${normalizedUrl}`;
      
      if (!seen.has(key) || c.confidence > seen.get(key)!.confidence) {
        seen.set(key, c);
      }
    }

    return Array.from(seen.values());
  }

  /**
   * Rank contracts by confidence and deduplicate.
   */
  private rankContracts(contracts: ApiContract[]): ApiContract[] {
    // Boost confidence for URLs with more context
    return contracts
      .map(c => ({
        ...c,
        confidence: c.sourceSnippet.length > 100 ? Math.min(1, c.confidence + 0.1) : c.confidence,
      }))
      .sort((a, b) => b.confidence - a.confidence)
      .sort((a, b) => {
        // Prefer well-structured URLs
        const aScore = a.url.includes("/api/") || a.url.includes("/v1/") || a.url.includes("/v2/") ? 1 : 0;
        const bScore = b.url.includes("/api/") || b.url.includes("/v1/") || b.url.includes("/v2/") ? 1 : 0;
        return bScore - aScore;
      });
  }

  /**
   * Generate runnable API client from extracted contracts.
   */
  generateClient(contracts: ApiContract[], domain: string): GeneratedClient {
    const baseUrls = [...new Set(contracts.map(c => {
      try {
        const u = new URL(c.url.startsWith("http") ? c.url : `https://${domain}${c.url}`);
        return `${u.protocol}//${u.host}`;
      } catch { return domain; }
    }))];

    // Extract credentials from contracts (API keys, tokens in headers)
    const credentials: ExtractedCredential[] = [];
    for (const c of contracts) {
      for (const [header, value] of Object.entries(c.headers)) {
        if (header.toLowerCase() === "apikey" || header.toLowerCase() === "authorization") {
          // Supabase anon key pattern
          if (value.startsWith("eyJ") && value.includes(".eyJ")) {
            credentials.push({
              type: "supabase-anon",
              key: "Supabase Anon Key",
              value,
              source: c.sourceFile,
              usage: `Use as apikey header when calling ${c.url}`,
            });
          } else if (value.startsWith("Bearer ")) {
            credentials.push({
              type: "bearer-token",
              key: "Bearer Token",
              value: value.replace("Bearer ", ""),
              source: c.sourceFile,
              usage: "Used for API authentication",
            });
          }
        }
      }
    }

    // Brute-force scanning of raw JS bundle code for credentials
    // We scan the code for patterns like api_key, stripe keys, firebase tokens, etc.
    const rawCodeMatches = [
      {
        type: "api-key" as const,
        pattern: /(?:api[-_]?key|apikey|secret[-_]?key|access[-_]?token|auth[-_]?token)["']?\s*[:=]\s*["'](eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+|pk_[a-zA-Z0-9_]{20,}|sk_[a-zA-Z0-9_]{20,}|[a-zA-Z0-9-_]{32,})["']/gi,
        desc: "API / Authorization Key"
      },
      {
        type: "supabase-anon" as const,
        pattern: /["'](eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+)["']/g,
        desc: "Supabase Anon Token"
      },
      {
        type: "wallet-rpc" as const,
        pattern: /["'](https?:\/\/(?:mainnet|polygon|arbitrum|optimism|bsc|sepolia|goerli)\.infura\.io\/v3\/[a-f0-9]{32}|https?:\/\/[a-z-]+\.alchemyapi\.io\/v2\/[a-zA-Z0-9_-]{32})["']/gi,
        desc: "Ethereum/Wallet RPC Provider"
      }
    ];

    for (const matchRule of rawCodeMatches) {
      // Find all matches in contracts' source snippets or in cached files if available
      for (const c of contracts) {
        let match;
        // Search in context snippet first
        while ((match = matchRule.pattern.exec(c.sourceSnippet)) !== null) {
          const value = match[1];
          if (value && value.length > 10 && !credentials.some(cr => cr.value === value)) {
            credentials.push({
              type: matchRule.type,
              key: matchRule.desc,
              value,
              source: c.sourceFile,
              usage: `Extracted from JS code context: ${match[0].substring(0, 50)}...`,
            });
          }
        }
      }
    }

    // Deduplicate credentials by value
    const uniqueCredentials = credentials.filter((c, i, self) =>
      self.findIndex(cr => cr.value === c.value) === i
    );
    credentials.length = 0;
    credentials.push(...uniqueCredentials);


    // Generate curl commands
    const curlCommands = contracts.map(c => {
      const fullUrl = c.url.startsWith("http") ? c.url : `https://${domain}${c.url}`;
      let cmd = `curl -X ${c.method} "${fullUrl}"`;
      
      for (const [k, v] of Object.entries(c.headers)) {
        cmd += ` \\\n  -H "${k}: ${v}"`;
      }

      if (c.bodyTemplate) {
        cmd += ` \\\n  -H "Content-Type: application/json"`;
        cmd += ` \\\n  -d '${JSON.stringify(c.bodyTemplate)}'`;
      }

      return cmd;
    });

    // Generate code snippets per base URL
    const codeSnippets: Record<string, string> = {};
    for (const baseUrl of baseUrls) {
      const related = contracts.filter(c => c.url.includes(baseUrl));
      if (related.length === 0) continue;

      let snippet = `// Auto-generated API client for ${baseUrl}\n`;
      snippet += `const BASE = "${baseUrl}";\n\n`;
      
      for (const c of related.slice(0, 10)) {
        const name = this.endpointToFunctionName(c.url);
        const path = c.url.replace(baseUrl, "").split("?")[0];
        
        snippet += `// ${c.description}\n`;
        snippet += `async function ${name}(params = {}) {\n`;
        
        if (c.method === "GET") {
          snippet += `  const url = new URL(\`\${BASE}${path}\`);\n`;
          snippet += `  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, String(v)));\n`;
          snippet += `  const res = await fetch(url.toString());\n`;
        } else if (c.bodyTemplate) {
          snippet += `  const res = await fetch(\`\${BASE}${path}\`, {\n`;
          snippet += `    method: "${c.method}",\n`;
          snippet += `    headers: { "Content-Type": "application/json" },\n`;
          snippet += `    body: JSON.stringify(params),\n`;
          snippet += `  });\n`;
        } else {
          snippet += `  const res = await fetch(\`\${BASE}${path}\`, {\n`;
          snippet += `    method: "${c.method}",\n`;
          snippet += `    headers: { "Content-Type": "application/json" },\n`;
          snippet += `  });\n`;
        }
        
        snippet += `  return res.json();\n`;
        snippet += `}\n\n`;
      }

      codeSnippets[baseUrl] = snippet;
    }

    // Deduce auth flow
    const authFlow = this.deduceAuthFlow(contracts);

    return {
      endpoints: contracts,
      credentials,
      curlCommands,
      codeSnippets,
      authFlow,
      baseUrls,
    };
  }

  /**
   * Convert endpoint URL to a readable function name.
   */
  private endpointToFunctionName(url: string): string {
    try {
      const u = new URL(url.startsWith("http") ? url : `https:${url}`);
      const parts = u.pathname.split("/").filter(Boolean);
      // Remove common prefixes
      const clean = parts.filter(p => !["api", "v1", "v2", "v3", "rest"].includes(p));
      
      if (clean.length === 0) return `get${u.hostname.split('.')[0].replace(/[^a-zA-Z]/g, '')}`;
      
      return clean
        .map((p, i) => {
          // Remove query strings
          const name = p.split("?")[0].replace(/[^a-zA-Z0-9]/g, "_");
          return i === 0 ? name : name.charAt(0).toUpperCase() + name.slice(1);
        })
        .join("");
    } catch {
      return "getData";
    }
  }

  /**
   * Deduce authentication flow from discovered contracts.
   */
  private deduceAuthFlow(contracts: ApiContract[]): string[] {
    const steps: string[] = [];
    
    const hasAuth = contracts.some(c => c.authType !== "none" && c.authType !== "unknown");
    const hasLogin = contracts.some(c => c.url.toLowerCase().includes("login"));
    const hasSupabase = contracts.some(c => c.url.includes("supabase"));
    const hasWallet = contracts.some(c => c.url.toLowerCase().includes("wallet"));
    
    if (hasSupabase) {
      steps.push("Supabase Auth — need to sign in or use anon key from bundle");
    }
    if (hasLogin) {
      steps.push("POST /login endpoint — need email/password or OAuth token");
    }
    if (hasWallet) {
      steps.push("Wallet connection required — may need signature verification");
    }
    if (hasAuth) {
      steps.push("Bearer token required — check localStorage or cookie after auth");
    }
    if (!hasAuth && !hasLogin) {
      steps.push("Public API — no authentication needed");
    }

    return steps;
  }

  /**
   * Cache discovered endpoints for future use.
   */
  private cacheEndpoints(contracts: ApiContract[], domain: string): void {
    const cache = getEndpointCache();
    const now = Date.now();

    const methodMap: Record<string, DiscoveredEndpoint["method"]> = {
      GET: "GET", POST: "POST", PUT: "PUT", DELETE: "DELETE", PATCH: "PUT",
    };

    const endpoints: DiscoveredEndpoint[] = contracts.map(c => ({
      url: c.url.startsWith("http") ? c.url : `https://${domain}${c.url}`,
      method: methodMap[c.method] || "GET",
      headers: Object.keys(c.headers).length > 0 ? c.headers : undefined,
      bodyTemplate: c.bodyTemplate || undefined,
      description: c.description,
      source: "network-sniff" as const,
      confidence: c.confidence,
      discoveredAt: now,
      successCount: 0,
      failCount: 0,
    }));

    cache.saveBatch(endpoints);
    logger.info(
      { domain, cached: endpoints.length },
      "[Layer 4] Endpoints cached"
    );
  }
}

// Singleton
let _parser: BundleParser | null = null;
export function getBundleParser(): BundleParser {
  if (!_parser) _parser = new BundleParser();
  return _parser;
}
