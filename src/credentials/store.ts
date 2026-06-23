import { logger } from "../utils/logger.js";

/**
 * Credential Store (Keychain)
 *
 * Stores API keys / auth tokens per domain so the agent can:
 *  1. Discover authenticated endpoints (probe with auth headers)
 *  2. Query authenticated APIs automatically
 *
 * Loaded from ENV var: API_KEYS
 * Format: "domain1:header:value,domain2:header:value"
 * Example: "api.codecrafters.id:Authorization:Bearer sk-xxx,stripe.com:Authorization:Bearer sk_live_xxx"
 */
export interface Credential {
  domain: string;
  headerName: string;
  headerValue: string;
  /** Optional: sub-path match (e.g., /v1/ matches /v1/models) */
  pathPrefix?: string;
  /** Optional: label for logging */
  label?: string;
  /** Optional: rate limit (ms between requests) */
  rateLimitMs?: number;
}

export class CredentialStore {
  private credentials: Credential[] = [];

  constructor() {
    this.loadFromEnv();
  }

  /**
   * Load credentials from API_KEYS env var.
   */
  private loadFromEnv(): void {
    const raw = process.env.API_KEYS || "";
    if (!raw) {
      logger.debug("[CredentialStore] No API_KEYS configured");
      return;
    }

    const entries = raw.split(",").filter(Boolean);
    for (const entry of entries) {
      const parts = entry.split(":");
      if (parts.length < 3) {
        logger.warn({ entry }, "[CredentialStore] Invalid credential format — skipping");
        continue;
      }
      const domain = parts[0];
      const headerName = parts[1];
      const headerValue = parts.slice(2).join(":"); // Rejoin in case value contains ":"
      const label = domain.replace(/[^a-zA-Z0-9]/g, "_");

      this.credentials.push({
        domain,
        headerName,
        headerValue,
        label,
      });

      // Mask the secret for logging
      const masked = headerValue.length > 12
        ? headerValue.substring(0, 6) + "..." + headerValue.substring(headerValue.length - 4)
        : "***";
      logger.info(
        { domain, headerName, value: masked },
        "[CredentialStore] Loaded credential"
      );
    }

    logger.info(
      { count: this.credentials.length },
      "[CredentialStore] Credentials loaded"
    );
  }

  /**
   * Find matching credentials for a URL.
   * Matches by domain (exact or subdomain).
   */
  findForUrl(url: string): Credential[] {
    try {
      const u = new URL(url);
      const hostname = u.hostname.replace(/^www\./, "");

      return this.credentials.filter((c) => {
        // Exact match
        if (c.domain === hostname) return true;
        // Subdomain match: api.codecrafters.id matches *.codecrafters.id
        if (hostname.endsWith(`.${c.domain}`)) return true;
        // Path prefix match if specified
        if (c.pathPrefix && u.pathname.startsWith(c.pathPrefix)) return true;
        return false;
      });
    } catch {
      return [];
    }
  }

  /**
   * Get auth headers for a URL.
   * Returns headers object to merge into requests.
   */
  getHeadersForUrl(url: string): Record<string, string> {
    const creds = this.findForUrl(url);
    const headers: Record<string, string> = {};
    for (const c of creds) {
      headers[c.headerName] = c.headerValue;
    }
    return headers;
  }

  /**
   * Check if we have credentials for a domain.
   */
  hasCredentialsFor(domain: string): boolean {
    return this.credentials.some(
      (c) => c.domain === domain || domain.endsWith(`.${c.domain}`)
    );
  }

  /**
   * Register a credential programmatically.
   */
  add(credential: Credential): void {
    this.credentials.push(credential);
    logger.info({ domain: credential.domain }, "[CredentialStore] Added credential");
  }

  /**
   * Get all registered domains.
   */
  getDomains(): string[] {
    return [...new Set(this.credentials.map((c) => c.domain))];
  }

  /**
   * Get credential count.
   */
  count(): number {
    return this.credentials.length;
  }
}

// Singleton
let _store: CredentialStore | null = null;
export function getCredentialStore(): CredentialStore {
  if (!_store) _store = new CredentialStore();
  return _store;
}
