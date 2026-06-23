import { config } from "../config.js";
import { Browser, Page } from "playwright";
import { getBrowserPool } from "../browser/pool.js";
import { logger } from "../utils/logger.js";
import type { ScrapedPage } from "../types.js";

/**
 * LAYER 2 — Stealth Browser Scraping (Fallback)
 *
 * When no API is available (full server-rendered, no JS API calls),
 * fall back to rendering the full page and extracting clean text content.
 *
 * Includes anti-detection measures:
 *  - Masked WebDriver flag
 *  - Realistic viewport & user agent
 *  - Human-like scroll behavior
 *  - Cookie consent dismissal
 */
export class StealthScraper {
  /**
   * Scrape a single page — returns cleaned text content and metadata.
   */
  async scrape(url: string): Promise<ScrapedPage> {
    logger.info({ url }, "[Layer 2] Starting stealth scrape");

    let page: Page | null = null;
    let browser: Browser | null = null;
    const startTime = Date.now();

    try {
      const pool = getBrowserPool();
      browser = await pool.acquire();

      const context = await pool.createContext(browser);

      // ─── Stealth Patches (raw string for ESM compatibility) ──
      await context.addInitScript(`
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
        window.chrome = { runtime: {} };
        const origQuery = window.navigator.permissions.query;
        window.navigator.permissions.query = (params) =>
          params.name === 'notifications'
            ? Promise.resolve({ state: Notification.permission })
            : origQuery(params);
        Object.defineProperty(navigator, 'plugins', {
          get: () => [1, 2, 3, 4, 5],
        });
        Object.defineProperty(navigator, 'languages', {
          get: () => ['en-US', 'en'],
        });
      `);

      page = await context.newPage();

      // Block only images & fonts for speed — allow stylesheets for SPA rendering
      await page.route("**/*", (route) => {
        const type = route.request().resourceType();
        if (["image", "font", "media"].includes(type)) {
          return route.abort();
        }
        return route.continue();
      });

      // ─── Navigate ───────────────────────────────────
      await page.goto(url, {
        waitUntil: "networkidle",
        timeout: config.browser.timeout,
      });

      // Dismiss cookie consent popups
      await this.dismissCookieConsent(page);

      // Wait for JavaScript to fully render (critical for SPAs)
      await page.waitForTimeout(3000);

      // Wait for React/Vue/Angular to finish rendering
      // Check if root element has meaningful content
      await page.evaluate(async () => {
        // Wait for SPA framework to populate the DOM
        const root = document.getElementById('root') || document.getElementById('app') || document.querySelector('#__next');
        if (root) {
          const maxWait = 5000;
          const interval = 200;
          let waited = 0;
          while (waited < maxWait) {
            const text = root.textContent || '';
            if (text.trim().length > 50) break;
            await new Promise(r => setTimeout(r, interval));
            waited += interval;
          }
        }
      });

      // Scroll to load lazy content
      await this.humanLikeScroll(page);

      // ─── Extract Content ────────────────────────────
      const title = await page.title();

      // Get ALL visible text — for SPAs, the rendered DOM is the content
      const content = await page.evaluate(`
        const removeSelectors = [
          'script', 'style', 'noscript',
          '.cookie-banner', '.cookie-consent',
          '[aria-hidden="true"]',
        ];
        const clone = document.body.cloneNode(true);
        for (const sel of removeSelectors) {
          clone.querySelectorAll(sel).forEach((el) => el.remove());
        }
        // Get visible text only
        const walker = document.createTreeWalker(clone, NodeFilter.SHOW_TEXT, null, false);
        const texts = [];
        while (walker.nextNode()) {
          const node = walker.currentNode;
          // Skip hidden elements
          let parent = node.parentElement;
          let hidden = false;
          while (parent) {
            const style = window.getComputedStyle(parent);
            if (style.display === 'none' || style.visibility === 'hidden') {
              hidden = true;
              break;
            }
            parent = parent.parentElement;
          }
          if (!hidden) {
            const text = node.textContent.trim();
            if (text.length > 1) texts.push(text);
          }
        }
        texts.join('\\n');
      `) as string;

      // Clean up whitespace
      const cleaned = content
        .replace(/\n{3,}/g, "\n\n")
        .replace(/[ \t]{3,}/g, "  ")
        .trim()
        .substring(0, 50_000); // Cap at 50KB

      // Extract structured data if available
      const extractedData = await page.evaluate(`
        const data = {};
        const jsonLd = document.querySelectorAll('script[type="application/ld+json"]');
        if (jsonLd.length > 0) {
          data.jsonLd = [];
          jsonLd.forEach((el) => {
            try { data.jsonLd.push(JSON.parse(el.textContent || '')); } catch(e) {}
          });
        }
        const ogTitle = document.querySelector('meta[property="og:title"]');
        if (ogTitle) data.ogTitle = ogTitle.getAttribute('content');
        const ogDesc = document.querySelector('meta[property="og:description"]');
        if (ogDesc) data.ogDescription = ogDesc.getAttribute('content');
        const metaDesc = document.querySelector('meta[name="description"]');
        if (metaDesc) data.metaDescription = metaDesc.getAttribute('content');
        // Extract all headings (SPA content structure)
        const headings = [];
        document.querySelectorAll('h1, h2, h3, h4').forEach((h) => {
          if (h.textContent.trim()) headings.push(h.tagName + ': ' + h.textContent.trim());
        });
        if (headings.length > 0) data.headings = headings;
        // Extract all links (for site structure)
        const links = [];
        document.querySelectorAll('a[href]').forEach((a) => {
          const href = a.getAttribute('href');
          const text = a.textContent.trim();
          if (href && text && !href.startsWith('#') && href.length < 200) {
            links.push({ href, text: text.substring(0, 100) });
          }
        });
        if (links.length > 0) data.links = links.slice(0, 50);
        data;
      `) as Record<string, unknown>;

      logger.info(
        { url, title, contentLength: cleaned.length, timeMs: Date.now() - startTime },
        "[Layer 2] Scrape complete"
      );

      return {
        url,
        title,
        content: cleaned,
        htmlLength: cleaned.length,
        extractedData,
        fetchedAt: Date.now(),
      };
    } catch (err: any) {
      logger.error({ url, error: err.message }, "[Layer 2] Scrape failed");
      throw err;
    } finally {
      if (page) {
        try { await page.close(); } catch {}
      }
      if (browser) {
        await getBrowserPool().release(browser);
      }
    }
  }

  /**
   * Try to dismiss common cookie consent popups.
   */
  private async dismissCookieConsent(page: Page): Promise<void> {
    const cookieSelectors = [
      'button:has-text("Accept")',
      'button:has-text("Accept All")',
      'button:has-text("Accept all")',
      'button:has-text("AGREE")',
      'button:has-text("I agree")',
      'button:has-text("OK")',
      'button:has-text("Got it")',
      '[aria-label="Accept cookies"]',
      '[data-testid="cookie-accept"]',
      "#accept-cookies",
      ".accept-cookies",
    ];

    for (const sel of cookieSelectors) {
      try {
        const btn = await page.$(sel);
        if (btn) {
          await btn.click({ timeout: 1000 });
          logger.debug("[Layer 2] Dismissed cookie consent");
          await page.waitForTimeout(500);
          break;
        }
      } catch {
        // Continue trying other selectors
      }
    }
  }

  /**
   * Human-like scroll behavior to trigger lazy content loading.
   */
  private async humanLikeScroll(page: Page): Promise<void> {
    await page.evaluate(`
      (async () => {
        const delay = (ms) => new Promise((r) => setTimeout(r, ms));
        const scrollHeight = document.body.scrollHeight;
        const steps = 5;
        for (let i = 1; i <= steps; i++) {
          window.scrollTo(0, (scrollHeight / steps) * i);
          await delay(300 + Math.random() * 400);
        }
        window.scrollTo(0, scrollHeight * 0.8);
        await delay(200);
        window.scrollTo(0, scrollHeight);
        await delay(500);
      })();
    `);
  }

  /**
   * Scrape multiple URLs in sequence (with rate limiting).
   */
  async scrapeMultiple(urls: string[]): Promise<ScrapedPage[]> {
    const results: ScrapedPage[] = [];

    for (const url of urls) {
      try {
        const result = await this.scrape(url);
        results.push(result);
      } catch (err: any) {
        logger.warn({ url, error: err.message }, "[Layer 2] Skipping failed URL");
        // Continue with remaining URLs
      }

      // Rate limit between requests
      if (config.rateLimit.requestDelayMs > 0) {
        await new Promise((r) => setTimeout(r, config.rateLimit.requestDelayMs));
      }
    }

    return results;
  }

  async close(): Promise<void> {
    // Browser handled by pool — nothing to close here
  }
}

// Singleton
let _scraper: StealthScraper | null = null;
export function getStealthScraper(): StealthScraper {
  if (!_scraper) _scraper = new StealthScraper();
  return _scraper;
}
