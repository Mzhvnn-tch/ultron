import Database from "better-sqlite3";
import { config } from "../config.js";
import { logger } from "../utils/logger.js";
import { getEvolutionEngine } from "../agent/evolution.js";
import type { DiscoveredEndpoint, EvolutionLog } from "../types.js";
import fs from "node:fs";
import path from "node:path";

/**
 * Persistent per-domain endpoint cache.
 * The agent "learns" from each domain — the more it queries a domain,
 * the more endpoints it knows, the faster subsequent queries become.
 */
export class EndpointCache {
  private db: Database.Database;
  private insertStmt: Database.Statement;
  private getByDomainStmt: Database.Statement;
  private getByUrlStmt: Database.Statement;
  private updateStatsStmt: Database.Statement;
  private insertEvolutionStmt: Database.Statement;

  // Bounded L1 RAM Cache (VPS 2GB Optimized - capped at 500 items)
  private l1Cache: Map<string, DiscoveredEndpoint> = new Map();
  private MAX_L1_SIZE = 500;

  constructor() {
    const dbPath = config.cache.dbPath;
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });

    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("busy_timeout = 5000");

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS endpoints (
        url TEXT PRIMARY KEY,
        domain TEXT NOT NULL,
        method TEXT NOT NULL DEFAULT 'GET',
        params TEXT,
        headers TEXT,
        body_template TEXT,
        auth_type TEXT,
        auth_details TEXT,
        description TEXT,
        response_example TEXT,
        source TEXT NOT NULL,
        confidence REAL NOT NULL DEFAULT 0.5,
        discovered_at INTEGER NOT NULL,
        last_used_at INTEGER,
        success_count INTEGER NOT NULL DEFAULT 0,
        fail_count INTEGER NOT NULL DEFAULT 0,
        wasm_metadata TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_endpoints_domain ON endpoints(domain);
      CREATE INDEX IF NOT EXISTS idx_endpoints_source ON endpoints(source);
      CREATE INDEX IF NOT EXISTS idx_endpoints_confidence ON endpoints(confidence);

      CREATE TABLE IF NOT EXISTS evolution_logs (
        id TEXT PRIMARY KEY,
        domain TEXT NOT NULL,
        failed_endpoint_url TEXT NOT NULL,
        error_cause TEXT NOT NULL,
        synthesized_patch_code TEXT,
        sandbox_test_status TEXT NOT NULL,
        hot_swapped_at INTEGER,
        created_at INTEGER NOT NULL
      );
    `);

    try {
      this.db.exec("ALTER TABLE endpoints ADD COLUMN wasm_metadata TEXT;");
    } catch {
      // Column already exists
    }

    this.insertStmt = this.db.prepare(`
      INSERT OR REPLACE INTO endpoints
        (url, domain, method, params, headers, body_template, auth_type, auth_details,
         description, response_example, source, confidence, discovered_at, last_used_at,
         success_count, fail_count, wasm_metadata)
      VALUES
        (@url, @domain, @method, @params, @headers, @bodyTemplate, @authType, @authDetails,
         @description, @responseExample, @source, @confidence, @discoveredAt, @lastUsedAt,
         @successCount, @failCount, @wasmMetadata)
    `);

    this.insertEvolutionStmt = this.db.prepare(`
      INSERT OR REPLACE INTO evolution_logs
        (id, domain, failed_endpoint_url, error_cause, synthesized_patch_code, sandbox_test_status, hot_swapped_at, created_at)
      VALUES
        (@id, @domain, @failedEndpointUrl, @errorCause, @synthesizedPatchCode, @sandboxTestStatus, @hotSwappedAt, @createdAt)
    `);

    this.getByDomainStmt = this.db.prepare(
      "SELECT * FROM endpoints WHERE domain = ? ORDER BY confidence DESC, success_count DESC"
    );

    this.getByUrlStmt = this.db.prepare("SELECT * FROM endpoints WHERE url = ?");

    this.updateStatsStmt = this.db.prepare(`
      UPDATE endpoints
      SET last_used_at = ?, success_count = ?, fail_count = ?, confidence = ?
      WHERE url = ?
    `);

    logger.info({ dbPath }, "Endpoint cache initialized");
  }

  /** Extract domain from URL */
  static extractDomain(url: string): string {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return url;
    }
  }

  private addToL1(endpoint: DiscoveredEndpoint): void {
    if (this.l1Cache.size >= this.MAX_L1_SIZE && !this.l1Cache.has(endpoint.url)) {
      const firstKey = this.l1Cache.keys().next().value;
      if (firstKey) this.l1Cache.delete(firstKey);
    }
    this.l1Cache.set(endpoint.url, endpoint);
  }

  /** Store a discovered endpoint */
  save(endpoint: DiscoveredEndpoint): void {
    const domain = EndpointCache.extractDomain(endpoint.url);
    this.insertStmt.run({
      url: endpoint.url,
      domain,
      method: endpoint.method,
      params: endpoint.params ? JSON.stringify(endpoint.params) : null,
      headers: endpoint.headers ? JSON.stringify(endpoint.headers) : null,
      bodyTemplate: endpoint.bodyTemplate ? JSON.stringify(endpoint.bodyTemplate) : null,
      authType: endpoint.authType || null,
      authDetails: endpoint.authDetails ? JSON.stringify(endpoint.authDetails) : null,
      description: endpoint.description || null,
      responseExample: endpoint.responseExample ? JSON.stringify(endpoint.responseExample) : null,
      source: endpoint.source,
      confidence: endpoint.confidence,
      discoveredAt: endpoint.discoveredAt,
      lastUsedAt: endpoint.lastUsedAt || null,
      successCount: endpoint.successCount,
      failCount: endpoint.failCount,
      wasmMetadata: endpoint.wasmMetadata ? JSON.stringify(endpoint.wasmMetadata) : null,
    });
    this.addToL1(endpoint);
    logger.debug({ url: endpoint.url, source: endpoint.source }, "Endpoint cached");
  }

  /** Save multiple endpoints at once */
  saveBatch(endpoints: DiscoveredEndpoint[]): void {
    const insertMany = this.db.transaction((eps: DiscoveredEndpoint[]) => {
      for (const ep of eps) this.save(ep);
    });
    insertMany(endpoints);
    logger.info({ count: endpoints.length }, "Batch-cached endpoints");
  }

  /** Get all cached endpoints for a domain */
  getForDomain(domain: string): DiscoveredEndpoint[] {
    const rows = this.getByDomainStmt.all(domain) as any[];
    const endpoints = rows.map(this.rowToEndpoint);
    for (const ep of endpoints) {
      this.addToL1(ep);
    }
    return endpoints;
  }

  /** Check if an endpoint URL is already cached */
  getByUrl(url: string): DiscoveredEndpoint | null {
    if (this.l1Cache.has(url)) {
      return this.l1Cache.get(url)!;
    }
    const row = this.getByUrlStmt.get(url) as any;
    if (row) {
      const ep = this.rowToEndpoint(row);
      this.addToL1(ep);
      return ep;
    }
    return null;
  }

  /**
   * Get the best endpoints for a domain (highest confidence, highest success rate).
   * Used to prefer proven endpoints over newly discovered ones.
   */
  getBestForDomain(domain: string, limit = 5): DiscoveredEndpoint[] {
    return this.getForDomain(domain)
      .filter((ep) => ep.confidence > 0.3)
      .sort((a, b) => {
        // Sort by success rate first, then confidence
        const aRate = a.successCount / Math.max(1, a.successCount + a.failCount);
        const bRate = b.successCount / Math.max(1, b.successCount + b.failCount);
        if (bRate !== aRate) return bRate - aRate;
        return b.confidence - a.confidence;
      })
      .slice(0, limit);
  }

  /** Record a successful API call */
  recordSuccess(url: string): void {
    const existing = this.getByUrl(url);
    if (!existing) return;
    const successCount = existing.successCount + 1;
    const confidence = Math.min(1, existing.confidence + 0.05);
    const now = Date.now();
    this.updateStatsStmt.run(now, successCount, existing.failCount, confidence, url);
    existing.successCount = successCount;
    existing.confidence = confidence;
    existing.lastUsedAt = now;
    this.addToL1(existing);
  }

  /** Record a failed API call (lowers confidence) */
  recordFailure(url: string): void {
    const existing = this.getByUrl(url);
    if (!existing) return;
    const failCount = existing.failCount + 1;
    const confidence = Math.max(0.1, existing.confidence - 0.1);
    const now = Date.now();
    this.updateStatsStmt.run(now, existing.successCount, failCount, confidence, url);
    existing.failCount = failCount;
    existing.confidence = confidence;
    existing.lastUsedAt = now;
    this.addToL1(existing);

    if (confidence < 0.30 || failCount >= 3) {
      getEvolutionEngine().evolveEndpoint(url, `Endpoint confidence degraded to ${confidence.toFixed(2)} (failures: ${failCount})`).catch(() => {});
    }
  }

  /** Save a self-evolution log entry */
  saveEvolutionLog(log: EvolutionLog): void {
    this.insertEvolutionStmt.run({
      id: log.id,
      domain: log.domain,
      failedEndpointUrl: log.failedEndpointUrl,
      errorCause: log.errorCause,
      synthesizedPatchCode: log.synthesizedPatchCode || null,
      sandboxTestStatus: log.sandboxTestStatus,
      hotSwappedAt: log.hotSwappedAt || null,
      createdAt: log.createdAt,
    });
    logger.info({ domain: log.domain, status: log.sandboxTestStatus }, "[EndpointCache] Self-evolution journal updated");
  }

  /** Get all domains we know about */
  getAllDomains(): string[] {
    const rows = this.db
      .prepare("SELECT DISTINCT domain FROM endpoints")
      .all() as any[];
    return rows.map((r: any) => r.domain);
  }

  /** Total cached endpoints */
  count(): number {
    const row = this.db.prepare("SELECT COUNT(*) as cnt FROM endpoints").get() as any;
    return row.cnt;
  }

  /** Stats for monitoring */
  stats(): { totalEndpoints: number; domains: number; bySource: Record<string, number> } {
    const totalEndpoints = this.count();
    const domains = this.getAllDomains().length;
    const sourceRows = this.db
      .prepare("SELECT source, COUNT(*) as cnt FROM endpoints GROUP BY source")
      .all() as any[];
    const bySource: Record<string, number> = {};
    for (const r of sourceRows) bySource[r.source] = r.cnt;
    return { totalEndpoints, domains, bySource };
  }

  private rowToEndpoint(row: any): DiscoveredEndpoint {
    return {
      url: row.url,
      method: row.method,
      params: row.params ? JSON.parse(row.params) : undefined,
      headers: row.headers ? JSON.parse(row.headers) : undefined,
      bodyTemplate: row.body_template ? JSON.parse(row.body_template) : undefined,
      authType: row.auth_type || undefined,
      authDetails: row.auth_details ? JSON.parse(row.auth_details) : undefined,
      description: row.description || undefined,
      responseExample: row.response_example ? JSON.parse(row.response_example) : undefined,
      source: row.source,
      confidence: row.confidence,
      discoveredAt: row.discovered_at,
      lastUsedAt: row.last_used_at || undefined,
      successCount: row.success_count,
      failCount: row.fail_count,
      wasmMetadata: row.wasm_metadata ? JSON.parse(row.wasm_metadata) : undefined,
    };
  }

  close(): void {
    this.db.close();
  }
}

// Singleton
let _cache: EndpointCache | null = null;
export function getEndpointCache(): EndpointCache {
  if (!_cache) _cache = new EndpointCache();
  return _cache;
}
