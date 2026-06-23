import { chromium, Browser, BrowserContext } from "playwright";
import { config } from "../config.js";
import { logger } from "../utils/logger.js";

/**
 * Browser Pool
 *
 * Manages a pool of persistent Chromium browser instances.
 * Dramatically reduces latency by eliminating browser launch/close per request.
 *
 * - Pool size: configurable (default 3)
 * - Browsers are lazily created and kept warm
 * - Each acquire() gives a fresh BrowserContext (isolated session)
 * - On release, context is closed but browser stays in pool
 */
export class BrowserPool {
  private pool: Browser[] = [];
  private maxSize: number;
  private activeCount = 0;
  private launchOpts: Record<string, any>;

  constructor(maxSize = 3) {
    this.maxSize = maxSize;
    this.launchOpts = {
      headless: config.browser.headless,
      args: [
        "--disable-blink-features=AutomationControlled",
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
      ],
    };
    logger.info({ maxSize }, "[BrowserPool] Initialized");
  }

  /**
   * Acquire a browser from the pool.
   * Returns a ready-to-use Browser instance.
   */
  async acquire(): Promise<Browser> {
    this.activeCount++;

    // Reuse from pool if available
    if (this.pool.length > 0) {
      const browser = this.pool.pop()!;
      // Verify it's still connected
      try {
        if (browser.isConnected()) {
          logger.debug("[BrowserPool] Reused from pool");
          return browser;
        }
      } catch {
        // Dead browser, discard
      }
    }

    const browser = await chromium.launch(this.launchOpts);
    logger.debug("[BrowserPool] Launched new browser instance");
    return browser;
  }

  /**
   * Return a browser to the pool, or close it if pool is full.
   * Closes ALL contexts on the browser before returning to pool
   * to prevent context leakage.
   */
  async release(browser: Browser): Promise<void> {
    this.activeCount--;

    try {
      // Close all contexts to prevent session leakage
      const contexts = browser.contexts();
      for (const ctx of contexts) {
        try {
          // Clear all pages in context
          const pages = ctx.pages();
          for (const page of pages) {
            try { await page.close(); } catch {}
          }
          await ctx.close();
        } catch {}
      }

      if (this.pool.length < this.maxSize && browser.isConnected()) {
        this.pool.push(browser);
        logger.debug("[BrowserPool] Returned to pool");
      } else {
        await browser.close();
        logger.debug("[BrowserPool] Pool full — browser closed");
      }
    } catch (err: any) {
      logger.warn({ error: err.message }, "[BrowserPool] Error releasing browser");
      try { await browser.close(); } catch {}
    }
  }

  /**
   * Create a fresh isolated context from a browser.
   * Each context = separate session (cookies, storage, etc.)
   */
  async createContext(browser: Browser): Promise<BrowserContext> {
    return browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
      viewport: { width: 1920, height: 1080 },
      locale: "en-US",
      timezoneId: "America/New_York",
    });
  }

  /**
   * Get current pool stats.
   */
  stats(): {
    poolSize: number;
    maxSize: number;
    activeCount: number;
    availableCount: number;
  } {
    return {
      poolSize: this.pool.length,
      maxSize: this.maxSize,
      activeCount: this.activeCount,
      availableCount: this.pool.length,
    };
  }

  /**
   * Warm up the pool by pre-launching browsers.
   */
  async warmUp(count = 2): Promise<void> {
    const browsers = await Promise.all(
      Array.from({ length: Math.min(count, this.maxSize) }, () =>
        chromium.launch(this.launchOpts)
      )
    );
    this.pool.push(...browsers);
    logger.info({ count: browsers.length }, "[BrowserPool] Warmed up");
  }

  /**
   * Graceful shutdown — close all browsers in pool.
   */
  async shutdown(): Promise<void> {
    logger.info(
      { poolSize: this.pool.length },
      "[BrowserPool] Shutting down"
    );
    const browsers = [...this.pool];
    this.pool = [];
    await Promise.all(
      browsers.map((b) =>
        b.close().catch(() => {})
      )
    );
    logger.info("[BrowserPool] Shutdown complete");
  }
}

// Singleton
let _pool: BrowserPool | null = null;
export function getBrowserPool(): BrowserPool {
  if (!_pool) _pool = new BrowserPool(3);
  return _pool;
}
