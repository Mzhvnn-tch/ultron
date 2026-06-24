import { randomUUID } from "node:crypto";
import { logger } from "../utils/logger.js";
import { config } from "../config.js";
import { getApiDiscovery } from "../layers/layer0-discovery.js";
import { getNetworkSniffer } from "../layers/layer1-sniffing.js";
import { getStealthScraper } from "../layers/layer2-scrape.js";
import { getCitationGrounding } from "../layers/layer3-grounding.js";
import { getQueryDecomposer } from "./decomposer.js";
import { getSynthesizer } from "./synthesizer.js";
import { getVerifier } from "./verifier.js";
import { getKnowledgeRouter } from "../knowledge/router.js";
import { getCredentialStore } from "../credentials/store.js";
import { getEndpointCache, EndpointCache } from "../cache/endpoint-cache.js";
import { createHttpClient } from "../utils/http.js";
import type {
  ResearchQuery,
  ResearchResult,
  ResearchStep,
  DiscoveredEndpoint,
  Finding,
  ScrapedPage,
} from "../types.js";

/**
 * Deep Research Pipeline Orchestrator
 *
 * Master controller that coordinates all 4 layers + pipeline components
 * to execute a full autonomous research cycle:
 *
 *  1. Decompose query into sub-queries
 *  2. For each sub-query:
 *     a. Layer 0: API Discovery (check docs, patterns, well-known)
 *     b. Layer 1: Network Sniffing (if no cached API for domain)
 *     c. Layer 2: Fallback Scrape (if no API at all)
 *  3. Layer 3: Cross-verify & ground findings with citations
 *  4. Synthesize final summary
 */
export class ResearchOrchestrator {
  private http = createHttpClient();

  /**
   * Execute a full research cycle.
   */
  async research(params: ResearchQuery): Promise<ResearchResult> {
    const id = randomUUID();
    const startTime = Date.now();

    logger.info({ id, query: params.query }, "[Orchestrator] Starting research");

    const steps: ResearchStep[] = [];
    const allFindings: Finding[] = [];
    const allEndpoints: DiscoveredEndpoint[] = [];
    const domainsVisited = new Set<string>();

    // ─── Phase 0: Knowledge Router (instant answers) ───
    // Before doing any work, check if we already know where to find the data
    const knowledgeRouter = getKnowledgeRouter();
    const knowledgeResult = await knowledgeRouter.route(params.query);

    if (knowledgeResult.matched) {
      allFindings.push(...knowledgeResult.findings);
      logger.info(
        { route: knowledgeResult.routeName, findings: knowledgeResult.findings.length },
        "[Orchestrator] Knowledge router matched — instant answer"
      );

      // Skip LLM synthesis — pake template biar cepet
      const summary = allFindings.map(f => {
        const lines = f.claim.split(String.fromCharCode(10)).filter(Boolean);
        return lines.map(l => `- ${l}`).join(String.fromCharCode(10));
      }).join(String.fromCharCode(10, 10));

      const fullSummary = [
        `# Hasil Research: ${params.query}`,
        ``,
        `## Data Real-time dari API Publik`,
        `Source: ${allFindings.map(f => f.evidence[0]?.sourceTitle).filter(Boolean).join(", ")}`, 
        `Confidence: ${(allFindings.reduce((s, f) => s + f.confidence, 0) / allFindings.length * 100).toFixed(0)}%`,
        `Waktu: ${new Date().toLocaleString("id-ID")}`, 
        ``,
        summary,
        ``, 
        `## Sumber`, 
        ...allFindings.flatMap((f, i) => [
          `[${i+1}] ${f.evidence[0]?.sourceTitle || "Sumber"}: ${f.evidence[0]?.sourceUrl || "-"}`
        ]),
      ].join(String.fromCharCode(10));

      return {
        id,
        originalQuery: params.query,
        summary: fullSummary,
        findings: allFindings,
        steps: [],
        citations: allFindings.flatMap((f, i) => ({
          index: i + 1,
          url: f.evidence[0]?.sourceUrl || "",
          title: f.evidence[0]?.sourceTitle || "",
          snippet: f.claim.substring(0, 200),
          relevanceScore: f.confidence,
        })),
        discoveredApiEndpoints: [],
        durationMs: Date.now() - startTime,
        startedAt: startTime,
        finishedAt: Date.now(),
        totalSources: new Set(allFindings.flatMap(f => f.sourceUrls)).size,
        domainsVisited: [...domainsVisited],
      };
    }

    // ─── Phase 1: Decompose Query ──────────────────────
    const decomposer = getQueryDecomposer();
    const subQueries = await decomposer.decompose(params.query, params.maxDepth);

    logger.info({ subQueries }, "[Orchestrator] Query decomposed");

    // ─── Phase 2: Research Each Sub-Query ──────────────
    for (const subQuery of subQueries) {
      const step = await this.researchSingleQuery(
        subQuery,
        params.preferApi,
        domainsVisited
      );
      steps.push(step);

      if (step.findings.length > 0) {
        allFindings.push(...step.findings);
      }
      if (step.discoveredEndpoints.length > 0) {
        allEndpoints.push(...step.discoveredEndpoints);
      }
      if (step.sniffedEndpoints.length > 0) {
        allEndpoints.push(...step.sniffedEndpoints);
      }

      // Progress logging
      logger.info(
        {
          subQuery,
          findings: step.findings.length,
          apiEndpoints: step.discoveredEndpoints.length,
          sniffedEndpoints: step.sniffedEndpoints.length,
          scrapedPages: step.scrapedData.length,
        },
        "[Orchestrator] Sub-query complete"
      );
    }

    // ─── Phase 3: Citation Grounding ───────────────────
    const grounding = getCitationGrounding();
    const groundedFindings = grounding.groundFindings(allFindings, steps[steps.length - 1]);
    const citations = grounding.generateCitations(groundedFindings);
    const contradictions = grounding.detectContradictions(groundedFindings);

    if (contradictions.length > 0) {
      logger.warn({ contradictions }, "[Orchestrator] Contradictions found");
    }

    // ─── Phase 4: Verify ──────────────────────────────
    const verifier = getVerifier();
    const { verifiedFindings, warnings, qualityScore } = verifier.verify(
      groundedFindings,
      citations
    );

    // ─── Phase 5: Synthesize ──────────────────────────
    const synthesizer = getSynthesizer();
    const summary = await synthesizer.synthesize(
      params.query,
      steps,
      verifiedFindings
    );

    // ─── Phase 6: Final Assembly ──────────────────────
    const endTime = Date.now();
    const result: ResearchResult = {
      id,
      originalQuery: params.query,
      summary,
      findings: verifiedFindings,
      steps,
      citations,
      discoveredApiEndpoints: allEndpoints,
      durationMs: endTime - startTime,
      startedAt: startTime,
      finishedAt: endTime,
      totalSources: new Set(verifiedFindings.flatMap((f) => f.sourceUrls)).size,
      domainsVisited: [...domainsVisited],
    };

    // Log cache stats
    const cache = getEndpointCache();
    logger.info(
      {
        id,
        durationMs: result.durationMs,
        findings: verifiedFindings.length,
        citations: citations.length,
        endpoints: allEndpoints.length,
        qualityScore,
        cacheStats: cache.stats(),
      },
      "[Orchestrator] Research complete"
    );

    return result;
  }

  /**
   * Research a single sub-query through all layers.
   */
  public async researchSingleQuery(
    query: string,
    preferApi: boolean,
    domainsVisited: Set<string>
  ): Promise<ResearchStep> {
    const step: ResearchStep = {
      id: randomUUID(),
      query,
      status: "discovering",
      subQueries: [],
      discoveredEndpoints: [],
      usedEndpoints: [],
      sniffedEndpoints: [],
      scrapedData: [],
      findings: [],
      startedAt: Date.now(),
    };

    try {
      // Extract candidate domains from the query
      const domains = this.extractSearchTargets(query);

      for (const domain of domains.slice(0, config.rateLimit.maxConcurrentDomains)) {
        domainsVisited.add(domain);

        // ── Layer 0: API Discovery ─────────────────────
        if (preferApi) {
          step.status = "discovering";
          const apiDiscovery = getApiDiscovery();
          const apiEndpoints = await apiDiscovery.discover(domain);
          step.discoveredEndpoints.push(...apiEndpoints);

          // Try to use discovered API endpoints
          if (apiEndpoints.length > 0) {
            step.status = "fetching";
            const apiFindings = await this.queryApiEndpoints(
              query,
              apiEndpoints,
              domain
            );
            step.usedEndpoints.push(...apiEndpoints.filter((ep) => ep.successCount > 0));
            step.findings.push(...apiFindings);

            // If we got good data from API, skip browser layers
            if (apiFindings.length > 0) {
              // Check if findings are real content or just HTML boilerplate from SPA shell
              const hasRealContent = apiFindings.some((f) => {
                const claim = f.claim.toLowerCase();
                const isBoilerplate = claim.length < 100
                  || /<\!doctype|<html|<head|<body|<div id="root"/i.test(claim)
                  || /favicon/i.test(claim);
                return !isBoilerplate;
              });

              if (hasRealContent) {
                logger.info(
                  { domain, apiFindings: apiFindings.length },
                  "[Orchestrator] API-first success — skipping browser layers"
                );
                step.status = "done";
                step.finishedAt = Date.now();
                return step;
              }

              logger.info(
                { domain, apiFindings: apiFindings.length },
                "[Orchestrator] API findings were boilerplate — falling through"
              );
            }
          }
        }

        // ── Layer 1: Network Sniffing ──────────────────
        step.status = "discovering";
        const cache = getEndpointCache();
        const cachedSniffed = cache.getForDomain(domain).filter(
          (ep) => ep.source === "network-sniff"
        );

        if (cachedSniffed.length === 0) {
          // No cached sniffed endpoints → sniff now
          const sniffer = getNetworkSniffer();
          const sniffed = await sniffer.sniff(`https://${domain}`);
          step.sniffedEndpoints.push(...sniffed);

          // Try querying sniffed endpoints
          if (sniffed.length > 0) {
            step.status = "fetching";
            const sniffFindings = await this.queryApiEndpoints(
              query,
              sniffed,
              domain
            );
            step.findings.push(...sniffFindings);
          }
        } else {
          // Use cached sniffed endpoints
          const cachedFindings = await this.queryApiEndpoints(
            query,
            cachedSniffed,
            domain
          );
          step.findings.push(...cachedFindings);
        }

        // ── Layer 2: Fallback Scrape ───────────────────
        if (step.findings.length === 0) {
          step.status = "fetching";
          const scraper = getStealthScraper();
          const grounding = getCitationGrounding();

          // Strategy A: Scrape the actual target domain directly (SPA-aware)
          // This renders JavaScript, waits for content, extracts visible text
          const directUrl = `https://${domain}`;
          logger.info({ url: directUrl }, "[Orchestrator] Trying direct domain scrape");

          try {
            const directPage = await scraper.scrape(directUrl);
            step.scrapedData.push(directPage);

            const directClaims = grounding.extractClaims(
              directPage.content,
              directPage.url,
              directPage.title
            );
            step.findings.push(...directClaims);

            // If direct scrape got meaningful content, skip Google
            if (directClaims.length > 0 && directPage.content.length > 200) {
              logger.info(
                { domain, claims: directClaims.length, contentLen: directPage.content.length },
                "[Orchestrator] Direct scrape successful — skipping Google fallback"
              );
            } else {
              // Strategy B: Google search as fallback (only if direct scrape was empty)
              logger.info(
                { domain, contentLen: directPage.content.length },
                "[Orchestrator] Direct scrape yielded little — trying Google"
              );
              throw new Error("Direct scrape insufficient");
            }
          } catch {
            // Strategy B: Search fallback
            try {
              const scrapedPage = await this.executeSearch(query, domain);
              step.scrapedData.push(scrapedPage);

              const claims = grounding.extractClaims(
                scrapedPage.content,
                scrapedPage.url,
                scrapedPage.title
              );
              step.findings.push(...claims);
            } catch (searchErr: any) {
              logger.warn(
                { error: searchErr.message },
                "[Orchestrator] Search fallback also failed"
              );
            }
          }

          step.finishedAt = Date.now();
        }
      }

      // If no domains were extracted, do a general web search
      if (domains.length === 0) {
        step.status = "fetching";
        const scraper = getStealthScraper();
        const grounding = getCitationGrounding();

        // Try direct scrape with natural-language-derived URL
        // The query itself might contain a domain-like term
        const possibleDomain = query.match(/([a-zA-Z0-9][-a-zA-Z0-9]*\.)+[a-zA-Z]{2,}/);
        if (possibleDomain) {
          const directUrl = `https://${possibleDomain[0]}`;
          logger.info({ url: directUrl }, "[Orchestrator] Trying direct scrape from query domain");
          try {
            const directPage = await scraper.scrape(directUrl);
            step.scrapedData.push(directPage);
            const directClaims = grounding.extractClaims(
              directPage.content,
              directPage.url,
              directPage.title
            );
            step.findings.push(...directClaims);
          } catch {}
        }

        // Only fall back to Search if direct scrape didn't work
        if (step.findings.length === 0) {
          try {
            const scrapedPage = await this.executeSearch(query);
            step.scrapedData.push(scrapedPage);
            const claims = grounding.extractClaims(
              scrapedPage.content,
              scrapedPage.url,
              scrapedPage.title
            );
            step.findings.push(...claims);

            // DYNAMIC DEEP API DISCOVERY LOOP:
            // Extract the official domain of the target entity from search results
            const discoveredDomain = this.extractDomainFromSearch(scrapedPage);
            if (discoveredDomain && !domainsVisited.has(discoveredDomain)) {
              logger.info({ discoveredDomain }, "[Orchestrator] Dynamically discovered official domain from search results — triggering API sniffing loop");
              domainsVisited.add(discoveredDomain);

              // 1. Run API Discovery
              const apiDiscovery = getApiDiscovery();
              const apiEndpoints = await apiDiscovery.discover(discoveredDomain);
              step.discoveredEndpoints.push(...apiEndpoints);

              if (apiEndpoints.length > 0) {
                const apiFindings = await this.queryApiEndpoints(query, apiEndpoints, discoveredDomain);
                step.usedEndpoints.push(...apiEndpoints.filter(ep => ep.successCount > 0));
                step.findings.push(...apiFindings);
              }

              // 2. Run Network Sniffing
              const sniffer = getNetworkSniffer();
              const sniffed = await sniffer.sniff(`https://${discoveredDomain}`);
              step.sniffedEndpoints.push(...sniffed);

              if (sniffed.length > 0) {
                const sniffFindings = await this.queryApiEndpoints(query, sniffed, discoveredDomain);
                step.findings.push(...sniffFindings);
              }
            }
          } catch (err: any) {
            logger.warn({ error: err.message }, "[Orchestrator] Search fallback failed");
          }
        }
      }

      step.status = step.findings.length > 0 ? "done" : "failed";

    } catch (err: any) {
      logger.error({ query, error: err.message }, "[Orchestrator] Step failed");
      step.status = "failed";
      step.error = err.message;
    }

    step.finishedAt = Date.now();
    return step;
  }

  /**
   * Execute API queries against discovered endpoints.
   */
  private async queryApiEndpoints(
    query: string,
    endpoints: DiscoveredEndpoint[],
    domain: string
  ): Promise<Finding[]> {
    const findings: Finding[] = [];
    const cache = getEndpointCache();

    // Filter: only query endpoints that look like real APIs
    const validEndpoints = endpoints.filter((ep) => {
      // Skip static assets (CSS, images, etc.)
      if (ep.url.match(/\.(css|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot)(\?|$)/i)) return false;
      // Skip Cloudflare analytics
      if (ep.url.includes("cdn-cgi/")) return false;
      // If sniffed, must have JSON-like description or API URL pattern
      if (ep.source === "network-sniff") {
        const hasApiPattern = /\/api[/.]|\/v[12]\/|\/v1\b|graphql|\.json/i.test(ep.url);
        const hasJsonDesc = ep.description?.toLowerCase().includes("json") || false;
        return hasApiPattern || hasJsonDesc;
      }
      return true;
    });

    const creds = getCredentialStore();

    for (const ep of validEndpoints.slice(0, 5)) {
      try {
        const authHeaders = creds.getHeadersForUrl(ep.url);
        const response = await this.http({
          method: ep.method,
          url: ep.url,
          params: ep.params,
          headers: {
            ...ep.headers,
            "User-Agent": "DeepResearchAgent/1.0",
            ...authHeaders, // Merge in stored credentials
          },
          timeout: 10000,
        });

        if (response.status >= 200 && response.status < 400) {
          cache.recordSuccess(ep.url);

          const data = response.data;
          // Only process if response is readable text or JSON
          const ct = String(response.headers["content-type"] || "").toLowerCase();
          let text: string;
          if (typeof data === "string") {
            text = data;
          } else if (typeof data === "object") {
            text = JSON.stringify(data, null, 2);
          } else {
            text = String(data);
          }

          // Skip if response is binary/compressed
          if (ct.includes("application/octet-stream") || ct.includes("application/gzip")
              || ct.includes("application/zip")) {
            logger.debug({ url: ep.url, ct }, "[Orchestrator] Skipping binary response");
            continue;
          }

          // Skip if response is HTML (likely SPA catch-all, not real API data)
          // API endpoints should return JSON/XML/YAML, not full HTML pages
          if (ct.includes("text/html")) {
            logger.debug(
              { url: ep.url, ct, source: ep.source },
              "[Orchestrator] Skipping HTML response from API-like path — likely SPA catch-all"
            );
            continue;
          }

          // Extract claims from API response
          const grounding = getCitationGrounding();
          const apiFindings = grounding.extractClaims(
            text.substring(0, 10000),
            ep.url,
            `API: ${domain}`
          );

          // BONUS: if API returned JSON but no claims matched heuristics,
          // still create a raw finding with the response preview
          if (apiFindings.length === 0 && ct.includes("json")) {
            const preview = text.substring(0, 500);
            if (preview.length > 20) {
              findings.push({
                id: `api-${domain}-${ep.method}-${Buffer.from(ep.url).toString('base64').substring(0, 16)}`,
                claim: `API response from ${ep.method} ${ep.url}: ${preview.substring(0, 300)}`,
                evidence: [{
                  text: preview,
                  sourceUrl: ep.url,
                  sourceTitle: `API: ${domain} - ${ep.method} ${ep.url.split('/').pop()}`,
                  relevance: 0.8,
                  extractedAt: Date.now(),
                }],
                confidence: 0.7,
                sourceUrls: [ep.url],
              });
              logger.debug({ url: ep.url }, "[Orchestrator] API response captured as raw finding");
            }
          }

          findings.push(...apiFindings);
        } else {
          cache.recordFailure(ep.url);
        }
      } catch (err: any) {
        cache.recordFailure(ep.url);
        logger.debug(
          { url: ep.url, error: err.message },
          "[Orchestrator] API call failed"
        );
      }

      // Rate limit between API calls
      if (config.rateLimit.requestDelayMs > 0) {
        await new Promise((r) => setTimeout(r, config.rateLimit.requestDelayMs));
      }
    }

    return findings;
  }

  /**
   * Extract likely search targets (domains) from a query.
   */
  private extractSearchTargets(query: string): string[] {
    const targets: string[] = [];

    // If query mentions a specific site/domain
    const urlPattern = /([a-zA-Z0-9][-a-zA-Z0-9]*\.)+[a-zA-Z]{2,}/g;
    const domains = query.match(urlPattern);
    if (domains) {
      targets.push(...domains);
    }

    // Common research sources — match query keywords to known domains
    const sourceMap: Record<string, string> = {
      wiki: "wikipedia.org",
      wikipedia: "wikipedia.org",
      statista: "statista.com",
      reddit: "reddit.com",
      github: "github.com",
      npm: "npmjs.com",
      pypi: "pypi.org",
      arxiv: "arxiv.org",
      scholar: "scholar.google.com",
      bloomberg: "bloomberg.com",
      reuters: "reuters.com",
      techcrunch: "techcrunch.com",
      stripe: "stripe.com",
      shopify: "shopify.com",
      aws: "aws.amazon.com",
      gcp: "cloud.google.com",
      azure: "azure.microsoft.com",
      // Public API domains for API-first testing
      jsonplaceholder: "jsonplaceholder.typicode.com",
      swapi: "swapi.dev",
      pokeapi: "pokeapi.co",
      openlibrary: "openlibrary.org",
      openweathermap: "api.openweathermap.org",
      newsapi: "newsapi.org",
      exchangerate: "api.exchangerate-api.com",
      dogapi: "api.thedogapi.com",
      catapi: "api.thecatapi.com",
      chucknorris: "api.chucknorris.io",
      numbersapi: "numbersapi.com",
    };

    const queryLower = query.toLowerCase();
    for (const [keyword, domain] of Object.entries(sourceMap)) {
      if (queryLower.includes(keyword) && !targets.includes(domain)) {
        targets.push(domain);
      }
    }

    return targets;
  }

  /**
   * Execute search via Tavily API, DuckDuckGo HTML scraping, or Wikipedia API fallback.
   */
  private async executeSearch(query: string, domain?: string): Promise<ScrapedPage> {
    const searchQuery = domain ? `${query} site:${domain}` : query;
    const tavilyKey = process.env.TAVILY_API_KEY;

    // 1. Try Tavily API if key is present
    if (tavilyKey) {
      logger.info({ searchQuery }, "[Search] Using Tavily Search API");
      try {
        const response = await this.http.post("https://api.tavily.com/search", {
          api_key: tavilyKey,
          query: searchQuery,
          search_depth: "basic",
        }, { timeout: 10000 });

        if (response.status === 200 && response.data) {
          const results = response.data.results || [];
          const content = results.map((r: any) => `Title: ${r.title}\nURL: ${r.url}\nSnippet: ${r.content}`).join("\n\n");
          return {
            url: `tavily:${encodeURIComponent(searchQuery)}`,
            title: `Tavily Search: ${searchQuery}`,
            content,
            htmlLength: content.length,
            extractedData: { results },
            fetchedAt: Date.now(),
          };
        }
      } catch (err: any) {
        logger.warn({ error: err.message }, "[Search] Tavily Search API failed, falling back");
      }
    }

    // 2. Try DuckDuckGo HTML scrape (less aggressive than Google, but still has bot challenges)
    try {
      const scraper = getStealthScraper();
      const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(searchQuery)}`;
      logger.info({ url: searchUrl }, "[Search] Scraping DuckDuckGo search");
      return await scraper.scrape(searchUrl);
    } catch (err: any) {
      logger.warn({ error: err.message }, "[Search] DuckDuckGo scraping failed (likely CAPTCHA block), trying Wikipedia API");
    }

    // 3. Try Wikipedia Search API (both id.wikipedia.org and en.wikipedia.org)
    try {
      logger.info({ searchQuery }, "[Search] Falling back to Wikipedia Search API (EN + ID)");
      const results: any[] = [];
      
      const enUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&origin=*`;
      const idUrl = `https://id.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&origin=*`;
      
      const [enResp, idResp] = await Promise.all([
        this.http.get(enUrl, {
          headers: { "User-Agent": "DeepResearchAgent/1.0 (contact@deepresearchagent.internal)" },
          timeout: 6000
        }).catch(() => null),
        this.http.get(idUrl, {
          headers: { "User-Agent": "DeepResearchAgent/1.0 (contact@deepresearchagent.internal)" },
          timeout: 6000
        }).catch(() => null),
      ]);
      
      if (enResp?.status === 200 && enResp.data?.query?.search) {
        results.push(...enResp.data.query.search.map((r: any) => ({ ...r, lang: "en" })));
      }
      if (idResp?.status === 200 && idResp.data?.query?.search) {
        results.push(...idResp.data.query.search.map((r: any) => ({ ...r, lang: "id" })));
      }
      
      if (results.length > 0) {
        const content = results
          .slice(0, 10)
          .map((r: any) => `Title: ${r.title} (${r.lang.toUpperCase()})\nSnippet: ${r.snippet.replace(/<span class="searchmatch">/g, "").replace(/<\/span>/g, "")}`)
          .join("\n\n");
          
        logger.info({ count: results.length }, "[Search] Wikipedia Search API success");
        const topResult = results[0];
        const wikiDomain = topResult.lang === "id" ? "id.wikipedia.org" : "en.wikipedia.org";
        
        return {
          url: `https://${wikiDomain}/wiki/${encodeURIComponent(topResult.title)}`,
          title: `Wikipedia Search: ${searchQuery}`,
          content,
          htmlLength: content.length,
          extractedData: { results },
          fetchedAt: Date.now(),
        };
      }
    } catch (err: any) {
      logger.error({ error: err.message }, "[Search] Wikipedia fallback also failed");
    }

    throw new Error("All search options failed or were blocked by CAPTCHA");
  }

  /**
   * Helper to extract the primary official domain of the entity from search results.
   */
  private extractDomainFromSearch(scrapedPage: ScrapedPage): string | null {
    const skipDomains = [
      "google.com", "duckduckgo.com", "bing.com", "wikipedia.org", "wiktionary.org",
      "youtube.com", "twitter.com", "linkedin.com", "facebook.com", "instagram.com",
      "github.com", "medium.com", "reddit.com", "quora.com", "pinterest.com",
      "tavily.com", "yahoo.com", "outlook.com", "apple-touch-icon", "favicon"
    ];

    // Case A: Tavily search results (structured list)
    if (scrapedPage.extractedData?.results && Array.isArray(scrapedPage.extractedData.results)) {
      for (const res of scrapedPage.extractedData.results) {
        if (res.url) {
          try {
            const u = new URL(res.url);
            const host = u.hostname.replace(/^www\./, "").toLowerCase();
            if (!skipDomains.some(d => host.includes(d))) {
              return host;
            }
          } catch {}
        }
      }
    }

    // Case B: HTML/Wikipedia text links (regex search)
    const urlPattern = /https?:\/\/([a-zA-Z0-9][-a-zA-Z0-9]*\.)+[a-zA-Z]{2,}/g;
    const matches = scrapedPage.content.match(urlPattern);
    if (matches) {
      for (const m of matches) {
        try {
          const u = new URL(m);
          const host = u.hostname.replace(/^www\./, "").toLowerCase();
          if (!skipDomains.some(d => host.includes(d))) {
            return host;
          }
        } catch {}
      }
    }

    return null;
  }
}

// Singleton
let _orchestrator: ResearchOrchestrator | null = null;
export function getOrchestrator(): ResearchOrchestrator {
  if (!_orchestrator) _orchestrator = new ResearchOrchestrator();
  return _orchestrator;
}
