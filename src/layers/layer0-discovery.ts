import { createHttpClient, quickProbe, authenticatedProbe } from "../utils/http.js";
import { getEndpointCache, EndpointCache } from "../cache/endpoint-cache.js";
import { getCredentialStore } from "../credentials/store.js";
import { logger } from "../utils/logger.js";
import type { DiscoveredEndpoint } from "../types.js";

// ─── Common API Patterns ───────────────────────────────────────

const COMMON_API_PATHS = [
  "/api",
  "/api/v1",
  "/api/v2",
  "/v1",
  "/v2",
  "/v1/models",
  "/graphql",
  "/swagger.json",
  "/openapi.json",
  "/api-docs",
  "/api/docs",
  "/docs/api",
  "/.well-known/",
  "/rest",
  "/rest/v1",
  "/json",
];

const WELL_KNOWN_PATHS = [
  "/.well-known/ai-plugin.json",
  "/.well-known/openapi.yaml",
  "/.well-known/openapi.json",
  "/.well-known/agent.json",
];

const OPENAPI_CONTENT_TYPES = [
  "application/json",
  "application/yaml",
  "application/x-yaml",
  "text/yaml",
  "text/vnd.yaml",
];

/**
 * LAYER 0 — API Discovery
 *
 * Before opening a browser, probe the target domain for API endpoints.
 * Strategy (ordered by cost):
 *  1. Check common pattern paths (HEAD/GET quick probe)
 *  2. Check /.well-known/ paths (standardized discovery)
 *  3. Parse OpenAPI/Swagger specs if found
 *  4. Extract endpoints from freeform HTML docs pages
 */
export class ApiDiscovery {
  private http = createHttpClient();

  /**
   * Main entry: discover all reachable API endpoints for a domain.
   */
  async discover(domain: string): Promise<DiscoveredEndpoint[]> {
    const baseUrl = domain.startsWith("http") ? domain : `https://${domain}`;
    const hostname = domain.startsWith("http")
      ? new URL(domain).hostname
      : domain;

    logger.info({ hostname }, "[Layer 0] Starting API discovery");

    const endpoints: DiscoveredEndpoint[] = [];
    const now = Date.now();

    // Step 1: Check cached endpoints first (fast path)
    const cache = getEndpointCache();
    const cached = cache.getBestForDomain(hostname);
    if (cached.length > 0) {
      logger.info(
        { hostname, cachedCount: cached.length },
        "[Layer 0] Found cached endpoints — fast path"
      );
      endpoints.push(...cached);
      // Still probe for new ones, but use cached as base
    }

    // Step 2: Probe common API paths
    const commonEndpoints = await this.probeCommonPaths(baseUrl, hostname, now);
    endpoints.push(...commonEndpoints);

    // Step 3: Probe well-known paths
    const wkEndpoints = await this.probeWellKnown(baseUrl, hostname, now);
    endpoints.push(...wkEndpoints);

    // Step 4: If any probe returned an OpenAPI spec URL, parse it
    const specEndpoints = await this.parseOpenApiSpecs(endpoints, now);
    endpoints.push(...specEndpoints);

    // Step 5: If we found a GraphQL endpoint, introspect it
    const gqlEndpoints = await this.introspectGraphql(endpoints, hostname, now);
    endpoints.push(...gqlEndpoints);

    // Deduplicate by URL+method
    const seen = new Set<string>();
    const unique = endpoints.filter((ep) => {
      const key = `${ep.method}:${ep.url}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Cache all newly discovered
    if (unique.length > 0) {
      cache.saveBatch(unique);
    }

    logger.info(
      { hostname, total: unique.length },
      "[Layer 0] API discovery complete"
    );
    return unique;
  }

  /**
   * Quick probe of common API path patterns.
   */
  private async probeCommonPaths(
    baseUrl: string,
    hostname: string,
    now: number
  ): Promise<DiscoveredEndpoint[]> {
    const endpoints: DiscoveredEndpoint[] = [];
    const creds = getCredentialStore();
    const hasAuth = creds.hasCredentialsFor(hostname);
    const authHeaders = hasAuth ? creds.getHeadersForUrl(`https://${hostname}/`) : {};

    const probes = COMMON_API_PATHS.map(async (path) => {
      const url = `${baseUrl}${path}`;

      // Step 1: try HEAD probe (no auth)
      const probe = await quickProbe(url);

      // Step 2: if HEAD returned 405 (method not allowed) or 401/403,
      // try GET with auth headers
      let authProbe = probe;
      let usedAuth = false;
      if ((probe.status === 405 || !probe.ok) && hasAuth) {
        authProbe = await authenticatedProbe(url, authHeaders);
        usedAuth = true;
      }

      const result = probe.status === 405 ? authProbe : probe;

      if (result.ok || result.status === 401 || result.status === 403) {
        // Returns JSON → likely an API
        if (result.isJson) {
          endpoints.push({
            url,
            method: "GET",
            source: "common-pattern",
            confidence: 0.6,
            discoveredAt: now,
            successCount: 0,
            failCount: 0,
            authType: usedAuth ? "bearer" : undefined,
            description: `Auto-discovered via common path pattern: ${path}${usedAuth ? " (authenticated)" : ""}`,
          });
          logger.debug({ url }, "[Layer 0] Found JSON endpoint at common path");
        }
        // Auth required → still likely an API, just protected
        else if (result.status === 401 || result.status === 403) {
          endpoints.push({
            url,
            method: "GET",
            source: "common-pattern",
            confidence: 0.4,
            discoveredAt: now,
            successCount: 0,
            failCount: 0,
            authType: "bearer",
            description: `Protected endpoint at common path: ${path} (401/403)`,
          });
        }
      }
    });

    await Promise.all(probes);
    return endpoints;
  }

  /**
   * Check /.well-known/ standardized discovery paths.
   */
  private async probeWellKnown(
    baseUrl: string,
    hostname: string,
    now: number
  ): Promise<DiscoveredEndpoint[]> {
    const endpoints: DiscoveredEndpoint[] = [];

    for (const wkPath of WELL_KNOWN_PATHS) {
      const url = `${baseUrl}${wkPath}`;
      try {
        const resp = await this.http.get(url);
        if (resp.status === 200) {
          endpoints.push({
            url,
            method: "GET",
            source: "well-known",
            confidence: 0.8,
            discoveredAt: now,
            successCount: 1,
            failCount: 0,
            description: `Discovered via /.well-known/: ${wkPath}`,
          });
          logger.info({ url }, "[Layer 0] Found well-known endpoint");
        }
      } catch {
        // Ignore unreachable
      }
    }

    return endpoints;
  }

  /**
   * If we found an OpenAPI/Swagger spec, parse it to extract all endpoints.
   */
  private async parseOpenApiSpecs(
    existingEndpoints: DiscoveredEndpoint[],
    now: number
  ): Promise<DiscoveredEndpoint[]> {
    const specEndpoints = existingEndpoints.filter(
      (ep) =>
        ep.url.includes("swagger") ||
        ep.url.includes("openapi") ||
        ep.url.endsWith(".yaml") ||
        ep.url.endsWith(".yml")
    );

    const discovered: DiscoveredEndpoint[] = [];

    for (const specEp of specEndpoints) {
      try {
        const resp = await this.http.get(specEp.url);
        if (resp.status !== 200) continue;

        let spec: any;
        const ct = resp.headers["content-type"] || "";

        if (String(ct).includes("yaml") || specEp.url.endsWith(".yaml") || specEp.url.endsWith(".yml")) {
          // Parse YAML — use basic regex-based extraction for path entries
          spec = this.parseYamlLikeSpec(resp.data);
        } else {
          spec = typeof resp.data === "string" ? JSON.parse(resp.data) : resp.data;
        }

        if (!spec || !spec.paths) {
          logger.debug({ url: specEp.url }, "[Layer 0] Spec has no paths");
          continue;
        }

        const baseUrl = spec.servers?.[0]?.url || this.extractBaseUrl(specEp.url);
        const authType = this.detectAuthType(spec);

        for (const [path, methods] of Object.entries(spec.paths) as [string, any][]) {
          for (const [method, detailsUntyped] of Object.entries(methods)) {
            const details = detailsUntyped as Record<string, any>;
            if (!["get", "post", "put", "delete", "patch"].includes(method)) continue;

            const fullUrl = path.startsWith("http") ? path : `${baseUrl}${path}`;
            const params = details.parameters
              ? this.extractParams(details.parameters)
              : undefined;

            discovered.push({
              url: fullUrl,
              method: method.toUpperCase() as any,
              params,
              authType: (authType as DiscoveredEndpoint["authType"]) || undefined,
              description: details.summary || details.description || undefined,
              responseExample: details.responses?.["200"]?.content?.["application/json"]?.example
                || undefined,
              source: "openapi-spec",
              confidence: 0.9,
              discoveredAt: now,
              successCount: 0,
              failCount: 0,
            });
          }
        }

        logger.info(
          { specUrl: specEp.url, endpoints: discovered.length },
          "[Layer 0] Parsed OpenAPI spec"
        );
      } catch (err: any) {
        logger.warn({ url: specEp.url, error: err.message }, "[Layer 0] Failed to parse spec");
      }
    }

    return discovered;
  }

  /**
   * Basic YAML-like spec parsing for paths.
   * Falls back to regex for cases where we don't have a YAML parser.
   */
  private parseYamlLikeSpec(yamlText: string): any {
    const paths: any = {};
    const pathRegex = /^\s*(\/[^\s:]+):\s*$/gm;
    const methodRegex = /^\s*(get|post|put|delete|patch):\s*$/gim;

    let currentPath = "";
    let currentMethod = "";

    const lines = yamlText.split("\n");
    for (const line of lines) {
      const pathMatch = line.match(/^\s{0,2}(\/[^\s:]+):\s*$/);
      if (pathMatch) {
        currentPath = pathMatch[1];
        paths[currentPath] = {};
        continue;
      }

      if (currentPath) {
        const methodMatch = line.match(/^\s{2,4}(get|post|put|delete|patch):\s*$/i);
        if (methodMatch) {
          currentMethod = methodMatch[1].toLowerCase();
          paths[currentPath][currentMethod] = {};
        }
      }
    }

    return { paths };
  }

  private extractBaseUrl(specUrl: string): string {
    try {
      const u = new URL(specUrl);
      return `${u.protocol}//${u.host}`;
    } catch {
      return specUrl.replace(/(\/swagger\.json|\/openapi\.json|\/api-docs).*/, "");
    }
  }

  private detectAuthType(spec: any): string | null {
    const sec = spec.components?.securitySchemes || spec.securityDefinitions || {};
    const schemes = Object.values(sec) as any[];
    for (const s of schemes) {
      if (s.type === "http" && s.scheme === "bearer") return "bearer";
      if (s.type === "apiKey") return "api-key";
      if (s.type === "oauth2") return "oauth2";
      if (s.type === "http" && s.scheme === "basic") return "basic";
    }
    return null;
  }

  private extractParams(parameters: any[]): Record<string, string> {
    const params: Record<string, string> = {};
    for (const p of parameters) {
      if (p.name && p.in === "query") {
        params[p.name] = p.example || p.schema?.example || p.schema?.type || "string";
      }
    }
    return params;
  }

  /**
   * If we found a GraphQL endpoint, attempt introspection query.
   */
  private async introspectGraphql(
    endpoints: DiscoveredEndpoint[],
    hostname: string,
    now: number
  ): Promise<DiscoveredEndpoint[]> {
    const gqlEp = endpoints.find(
      (ep) =>
        ep.url.includes("graphql") || ep.description?.toLowerCase().includes("graphql")
    );

    if (!gqlEp) return [];

    const introspectionQuery = {
      query: `{ __schema { types { name kind description } queryType { name } mutationType { name } } }`,
    };

    try {
      const resp = await this.http.post(gqlEp.url, introspectionQuery, {
        headers: { "Content-Type": "application/json" },
        timeout: 5000,
      });

      if (resp.status === 200 && resp.data?.data?.__schema) {
        const types = resp.data.data.__schema.types
          ?.filter((t: any) => !t.name.startsWith("__"))
          .map((t: any) => t.name).slice(0, 20);

        return [
          {
            url: gqlEp.url,
            method: "POST",
            source: "openapi-spec",
            confidence: 0.95,
            discoveredAt: now,
            successCount: 1,
            failCount: 0,
            authType: gqlEp.authType,
            description: `GraphQL endpoint — available types: ${types?.join(", ") || "unknown"}`,
          },
        ];
      }
    } catch {
      logger.debug({ url: gqlEp.url }, "[Layer 0] GraphQL introspection failed (may be disabled)");
    }

    return [];
  }
}

// Singleton
let _discovery: ApiDiscovery | null = null;
export function getApiDiscovery(): ApiDiscovery {
  if (!_discovery) _discovery = new ApiDiscovery();
  return _discovery;
}
