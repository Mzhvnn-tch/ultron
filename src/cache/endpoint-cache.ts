import Database from "better-sqlite3";
import { config } from "../config.js";
import { logger } from "../utils/logger.js";
import type { DiscoveredEndpoint } from "../types.js";
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
        fail_count INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_endpoints_domain ON endpoints(domain);
      CREATE INDEX IF NOT EXISTS idx_endpoints_source ON endpoints(source);
      CREATE INDEX IF NOT EXISTS idx_endpoints_confidence ON endpoints(confidence);
    `);

    this.insertStmt = this.db.prepare(`
      INSERT OR REPLACE INTO endpoints
        (url, domain, method, params, headers, body_template, auth_type, auth_details,
         description, response_example, source, confidence, discovered_at, last_used_at,
         success_count, fail_count)
      VALUES
        (@url, @domain, @method, @params, @headers, @bodyTemplate, @authType, @authDetails,
         @description, @responseExample, @source, @confidence, @discoveredAt, @lastUsedAt,
         @successCount, @failCount)
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
    });
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
    return rows.map(this.rowToEndpoint);
  }

  /** Check if an endpoint URL is already cached */
  getByUrl(url: string): DiscoveredEndpoint | null {
    const row = this.getByUrlStmt.get(url) as any;
    return row ? this.rowToEndpoint(row) : null;
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
    this.updateStatsStmt.run(Date.now(), successCount, existing.failCount, confidence, url);
  }

  /** Record a failed API call (lowers confidence) */
  recordFailure(url: string): void {
    const existing = this.getByUrl(url);
    if (!existing) return;
    const failCount = existing.failCount + 1;
    const confidence = Math.max(0.1, existing.confidence - 0.1);
    this.updateStatsStmt.run(Date.now(), existing.successCount, failCount, confidence, url);
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
