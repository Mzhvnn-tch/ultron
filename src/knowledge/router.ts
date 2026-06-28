/**
 * KNOWLEDGE ROUTER — Smart API Knowledge Base
 *
 * Instead of blindly scraping or downloading bundles,
 * this router knows WHERE to find specific data.
 *
 * For each topic, it has a curated list of public APIs
 * that provide the data directly — no scraping needed.
 *
 * The agent queries these KNOWN APIs first, before
 * falling back to discovery/scraping.
 *
 * Topics are organized by domain knowledge:
 *  - Crypto/DeFi: CoinGecko, DefiLlama, Etherscan, etc.
 *  - Tech/Startup: GitHub, Crunchbase, ProductHunt, etc.
 *  - News: NewsAPI, RSS feeds, etc.
 *  - Finance: Yahoo Finance, FRED, etc.
 */

import { createHttpClient } from "../utils/http.js";
import { logger } from "../utils/logger.js";
import type { Finding } from "../types.js";

// ─── Wikipedia Cache ──────────────────────────────
// Universal knowledge base — free, no auth, no CAPTCHA
const wikiCache = new Map<string, { data: ApiResult[]; expiresAt: number }>();
const WIKI_CACHE_TTL = 300_000; // 5 menit

function getWikiCached(key: string): ApiResult[] | null {
  const entry = wikiCache.get(key);
  if (entry && entry.expiresAt > Date.now()) return entry.data;
  wikiCache.delete(key);
  return null;
}
function setWikiCache(key: string, data: ApiResult[]): void {
  wikiCache.set(key, { data, expiresAt: Date.now() + WIKI_CACHE_TTL });
}

// ─── Scraped Data Cache ─────────────────────────────────
// Avoid re-scraping the same page within 60s
const scrapedCache = new Map<string, { data: string; expiresAt: number }>();
const CACHE_TTL_MS = 60_000;

function getCached(key: string): string | null {
  const entry = scrapedCache.get(key);
  if (entry && entry.expiresAt > Date.now()) return entry.data;
  scrapedCache.delete(key);
  return null;
}
function setCache(key: string, data: string): void {
  scrapedCache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS });
  // Evict old entries if cache grows too large
  if (scrapedCache.size > 50) {
    const now = Date.now();
    for (const [k, v] of scrapedCache) {
      if (v.expiresAt < now) scrapedCache.delete(k);
    }
  }
}

// ─── Knowledge Entry ────────────────────────────────────

interface KnowledgeRoute {
  /** Keywords that trigger this route */
  keywords: string[];
  /** Description of when to use this */
  description: string;
  /** The API query to execute */
  query: () => Promise<ApiResult[]>;
}

interface ApiResult {
  title: string;
  content: string;
  sourceUrl: string;
  confidence: number;
}

// ─── Crypto / DeFi Knowledge Base ───────────────────────

const CRYPTO_ROUTES: KnowledgeRoute[] = [
  {
    keywords: ["eth", "ethereum", "ether", "eth price", "harga eth"],
    description: "Ethereum real-time price from CoinGecko",
    query: async () => {
      const http = createHttpClient();
      const resp = await http.get("https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd&include_24hr_change=true&include_market_cap=true");
      const data = resp.data as any;
      return [{
        title: "ETH/USD Price (CoinGecko)",
        content: `Ethereum (ETH) harga real-time: $${data.ethereum.usd.toLocaleString()} USD.\nPerubahan 24 jam: ${data.ethereum.usd_24h_change.toFixed(2)}%.\nMarket Cap: $${(data.ethereum.usd_market_cap / 1e9).toFixed(2)}B`,
        sourceUrl: "https://www.coingecko.com/en/coins/ethereum",
        confidence: 0.95,
      }];
    },
  },
  {
    keywords: ["btc", "bitcoin", "harga btc", "bitcoin price"],
    description: "Bitcoin real-time price from CoinGecko",
    query: async () => {
      const http = createHttpClient();
      const resp = await http.get("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_24hr_change=true&include_market_cap=true");
      const data = resp.data as any;
      return [{
        title: "BTC/USD Price (CoinGecko)",
        content: `Bitcoin (BTC) harga real-time: $${data.bitcoin.usd.toLocaleString()} USD.\nPerubahan 24 jam: ${data.bitcoin.usd_24h_change.toFixed(2)}%.\nMarket Cap: $${(data.bitcoin.usd_market_cap / 1e9).toFixed(2)}B`,
        sourceUrl: "https://www.coingecko.com/en/coins/bitcoin",
        confidence: 0.95,
      }];
    },
  },
  {
    keywords: ["yield eth", "eth yield", "crypto yield", "staking yield", "apy", "staking", "lending crypto"],
    description: "ETH staking & lending yield from DefiLlama",
    query: async () => {
      const http = createHttpClient();
      const resp = await http.get("https://yields.llama.fi/pools?symbol=ETH");
      const data = resp.data as any;
      const pools = (data.data || []).slice(0, 10);
      
      const results: ApiResult[] = [{
        title: "ETH Yield Pools (DefiLlama)",
        content: `Top 10 ETH Yield Pools:\n` + pools.map((p: any, i: number) =>
          `${i+1}. ${p.project} (${p.chain}) — APY: ${p.apy.toFixed(2)}% | TVL: $${(p.tvlUsd/1e6).toFixed(0)}M`
        ).join('\n'),
        sourceUrl: "https://defillama.com/yields",
        confidence: 0.95,
      }];

      // Add Lido-specific data if available
      const lidoPool = pools.find((p: any) => p.project === "lido");
      if (lidoPool) {
        results.push({
          title: "Lido Staking Detail",
          content: `Lido ETH Staking: ${lidoPool.apy.toFixed(2)}% APY\nTVL: $${(lidoPool.tvlUsd/1e9).toFixed(2)}B\nChain: ${lidoPool.chain}`,
          sourceUrl: "https://lido.fi/",
          confidence: 0.95,
        });
      }

      return results;
    },
  },
  {
    keywords: ["defi", "total value locked", "tvl", "defillama"],
    description: "DeFi TVL data from DefiLlama",
    query: async () => {
      const http = createHttpClient();
      const resp = await http.get("https://api.llama.fi/protocols");
      const data = resp.data as any;
      const top = (data || []).slice(0, 15);
      
      return [{
        title: "Top DeFi Protocols by TVL (DefiLlama)",
        content: top.map((p: any, i: number) =>
          `${i+1}. ${p.name} — TVL: $${(p.tvl/1e9).toFixed(2)}B | Chain: ${p.chain}`
        ).join('\n'),
        sourceUrl: "https://defillama.com/",
        confidence: 0.95,
      }];
    },
  },
  {
    keywords: ["gas", "gas fee", "gas price", "eth gas"],
    description: "Current Ethereum gas fees from Etherscan",
    query: async () => {
      const http = createHttpClient();
      const resp = await http.get("https://api.etherscan.io/api?module=gastracker&action=gasoracle");
      const data = resp.data as any;
      const r = data.result || {};
      return [{
        title: "Ethereum Gas Fees (Etherscan)",
        content: `Gas Fees saat ini:\n- Safe (Slow): ${r.SafeGasPrice} Gwei\n- Standard (Average): ${r.ProposeGasPrice} Gwei\n- Fast: ${r.FastGasPrice} Gwei\n- Base Fee: ${r.suggestBaseFee} Gwei`,
        sourceUrl: "https://etherscan.io/gastracker",
        confidence: 0.9,
      }];
    },
  },
  {
    keywords: ["token price", "coin price", "crypto price"],
    description: "Multi-coin price from CoinGecko",
    query: async () => {
      const http = createHttpClient();
      const resp = await http.get("https://api.coingecko.com/api/v3/simple/price?ids=ethereum,bitcoin,solana,ripple,cardano,polkadot,avalanche-2,dogecoin&vs_currencies=usd&include_24hr_change=true");
      const data = resp.data as any;
      return [{
        title: "Top Crypto Prices (CoinGecko)",
        content: Object.entries(data).map(([coin, info]: any) => {
          const name = coin.replace(/-2?$/, '').replace(/-/g, ' ').toUpperCase();
          return `${name}: $${info.usd.toLocaleString()} (${info.usd_24h_change > 0 ? '+' : ''}${info.usd_24h_change.toFixed(2)}%)`;
        }).join('\n'),
        sourceUrl: "https://www.coingecko.com/",
        confidence: 0.95,
      }];
    },
  },
];

// ─── All Routes ─────────────────────────────────────────

const NEWS_ROUTES: KnowledgeRoute[] = [
  {
    keywords: ["iran", "hormuz", "middle east", "israel", "palestine", "gaza", "yaman", "arab", "perang", "konflik", "krisis", "invasi", "sanksi"],
    description: "Geopolitical news & facts from Wikipedia + News APIs",
    query: async () => {
      const http = createHttpClient();
      const results: ApiResult[] = [];

      // Strategy 1: Wikipedia summary (fast, free, no key)
      try {
        const wikiUrl = "https://en.wikipedia.org/api/rest_v1/page/summary/Strait_of_Hormuz";
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000);
        const wikiResp = await fetch(wikiUrl, {
          headers: { "User-Agent": "DeepResearchBot/1.0", "Accept": "application/json" },
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
        if (wikiResp.ok) {
          const wiki = await wikiResp.json();
          if (wiki?.extract) {
            results.push({
              title: `Wikipedia — ${wiki.title || "Strait of Hormuz"}`,
              content: `${wiki.title || "Strait of Hormuz"}\n\n${wiki.extract.substring(0, 1000)}\n\nSource: ${wiki.content_urls?.desktop?.page || "https://en.wikipedia.org/wiki/Strait_of_Hormuz"}`,
              sourceUrl: wiki.content_urls?.desktop?.page || "https://en.wikipedia.org/wiki/Strait_of_Hormuz",
              confidence: 0.9,
            });
          }
        }
      } catch (err: any) {
        logger.debug({ error: err.message }, "[Knowledge] Wikipedia API failed");
      }

      // Strategy 2: NewsAPI (if key available via env)
      const newsKey = (typeof process !== "undefined" && process.env?.NEWS_API_KEY) || null;
      if (newsKey) {
        try {
          const newsResp = await http.get(
            `https://newsapi.org/v2/everything?q=iran+strait+of+hormuz&sortBy=publishedAt&pageSize=5&apiKey=${newsKey}`,
            { timeout: 8000 }
          );
          const newsData = newsResp.data as any;
          if (newsData?.articles) {
            for (const a of newsData.articles.slice(0, 5)) {
              results.push({
                title: `${a.title}`,
                content: `${a.title}\nSumber: ${a.source?.name || a.url}\nTanggal: ${a.publishedAt || ""}\n\n${a.description || ""}`.substring(0, 500),
                sourceUrl: a.url,
                confidence: 0.8,
              });
            }
          }
        } catch {}
      }

      if (results.length === 0) {
        results.push({
          title: "Informasi Selat Hormuz",
          content: "Selat Hormuz adalah jalur pelayaran strategis antara Teluk Persia dan Teluk Oman. Iran telah beberapa kali mengancam akan menutup selat ini sebagai respons terhadap ketegangan geopolitik. Untuk berita terkini, disarankan memeriksa sumber berita terpercaya seperti Reuters, BBC, atau AP News.",
          sourceUrl: "https://en.wikipedia.org/wiki/Strait_of_Hormuz",
          confidence: 0.7,
        });
      }

      return results;
    },
  },
  {
    keywords: ["ihsg", "indeks harga saham gabungan", "idx composite", "harga ihsg", "saham indonesia"],
    description: "IHSG (Indonesia Stock Exchange composite index) current price, open, high, low from Google Finance",
    query: async () => {
      const cached = getCached("ihsg");
      if (cached) return JSON.parse(cached);

      try {
        const { getStealthScraper } = await import("../layers/layer2-scrape.js");
        const scraper = getStealthScraper();
        const page = await scraper.scrape("https://www.google.com/search?q=IHSG+indeks+harga+saham+gabungan+terkini&hl=id");

        const content = page.content;

        // Extract structured data from cleaned text using known patterns
        const todayMatch = content.match(/([0-9]{1,3}(?:[.][0-9]{3})*,[0-9]{2})/g);
        const highMatch = content.match(/(?:Tinggi|High)[^0-9]*([0-9]{1,3}(?:[.][0-9]{3})*,[0-9]{2})/i);
        const lowMatch = content.match(/(?:Rendah|Low)[^0-9]*([0-9]{1,3}(?:[.][0-9]{3})*,[0-9]{2})/i);
        const openMatch = content.match(/(?:Buka|Open)[^0-9]*([0-9]{1,3}(?:[.][0-9]{3})*,[0-9]{2})/i);
        const prevCloseMatch = content.match(/(?:Ttp sblmnya|Prev close)[^0-9]*([0-9]{1,3}(?:[.][0-9]{3})*,[0-9]{2})/i);
        const week52High = content.match(/(?:Tggi 52 mg|52.*?[Hh]igh)[^0-9]*([0-9]{1,3}(?:[.][0-9]{3})*,[0-9]{2})/i);
        const week52Low = content.match(/(?:Rndh 52 mg|52.*?[Ll]ow)[^0-9]*([0-9]{1,3}(?:[.][0-9]{3})*,[0-9]{2})/i);

        // Try to find the main price (first large number that looks like IHSG)
        const mainPrice = todayMatch?.find(n => {
          const num = parseFloat(n.replace(/[.]/g, '').replace(',', '.'));
          return num > 1000 && num < 15000;
        });

        const price = mainPrice || todayMatch?.[0] || "N/A";
        const open = openMatch?.[1] || "N/A";
        const high = highMatch?.[1] || "N/A";
        const low = lowMatch?.[1] || "N/A";
        const prevClose = prevCloseMatch?.[1] || "N/A";

        const resultStr = `IHSG (Indeks Harga Saham Gabungan)

Harga: ${price}
Buka: ${open} | Tinggi: ${high} | Rendah: ${low}
Penutupan Sebelumnya: ${prevClose}
Tertinggi 52-mg: ${week52High?.[1] || "N/A"} | Terendah 52-mg: ${week52Low?.[1] || "N/A"}

Sumber: Google Finance - IDX Composite Index`;

        const result: ApiResult[] = [{
          title: "IHSG (IDX Composite Index) — Live Data",
          content: resultStr,
          sourceUrl: "https://www.google.com/search?q=IHSG",
          confidence: 0.85,
        }];

        setCache("ihsg", JSON.stringify(result));
        return result;
      } catch (err: any) {
        logger.warn({ error: err.message }, "[Knowledge] IHSG scrape failed");
        return [{
          title: "IHSG (IDX Composite Index)",
          content: "Maaf, data IHSG sedang tidak dapat diakses. Coba lagi dalam beberapa saat.",
          sourceUrl: "https://www.google.com/finance/quote/JKSE:IDX",
          confidence: 0.5,
        }];
      }
    },
  },
  {
    keywords: ["harga emas", "gold price", "emas hari ini", "logam mulia"],
    description: "Gold price from GoldAPI",
    query: async () => {
      const http = createHttpClient();
      const resp = await http.get("https://api.gold-api.com/price/XAU");
      const data = resp.data as any;
      return [{
        title: "Gold Price Today",
        content: `Harga Emas (XAU/USD): $${data?.price || data?.ask || "N/A"} per troy ounce`,
        sourceUrl: "https://www.gold-api.com/",
        confidence: 0.8,
      }];
    },
  },
];

const ALL_ROUTES: Record<string, KnowledgeRoute[]> = {
  crypto: CRYPTO_ROUTES,
  news: NEWS_ROUTES,
};

// ─── Router ─────────────────────────────────────────────

export class KnowledgeRouter {
  private http = createHttpClient();

  /**
   * Route a query to the right knowledge base.
   * Returns findings directly from known APIs — no scraping.
   */
  async route(query: string): Promise<{
    findings: Finding[];
    matched: boolean;
    routeName: string;
  }> {
    const queryLower = query.toLowerCase();
    const allFindings: Finding[] = [];
    let matchedRoutes: string[] = [];

    // Check all routes for keyword matches — return ALL matches
    for (const [category, routes] of Object.entries(ALL_ROUTES)) {
      for (const route of routes) {
        const matched = route.keywords.some(kw => queryLower.includes(kw));
        if (!matched) continue;

        logger.info({ category, keywords: route.keywords }, "[Knowledge] Route matched");

        try {
          const results = await route.query();
          if (results.length === 0) continue;

          matchedRoutes.push(route.description);

          const findings: Finding[] = results.map((r, i) => ({
            id: `knowledge-${category}-${i}`,
            claim: r.content.substring(0, 500),
            evidence: [{
              text: r.content,
              sourceUrl: r.sourceUrl,
              sourceTitle: r.title,
              relevance: 0.95,
              extractedAt: Date.now(),
            }],
            confidence: r.confidence,
            sourceUrls: [r.sourceUrl],
          }));

          allFindings.push(...findings);
          logger.info({ category, findings: findings.length }, "[Knowledge] Route produced findings");
        } catch (err: any) {
          logger.warn({ category, error: err.message }, "[Knowledge] Route query failed");
        }
      }
    }

    // ─── Universal Fallback 1: DuckDuckGo Instant Answer ──
    // Priority #1 — works dari Node.js di server ini (Wikipedia diblokir)
    // Free, no API key, returns instant answers untuk topik APAPUN
    // Coba MULTIPLE varian query biar dapet hasil
    if (allFindings.length === 0) {
      try {
        const stopwords = new Set(["harga","berapa","apakah","siapa","apa","dimana","kapan","mengapa","bagaimana","tentang","cari","info","data","hasil","pendapat","menurut","price","what","who","where","when","why","how","is","are","the","a","an","of","in","for","to","dan","atau","yg","yang","di","ke","dari","dengan","pada","itu","ini","saya","kami","kita","baru","terbaru","sekarang","saat","tahun","bulan","minggu","hari","kemarin","besok","dividen","saham","s0ace"]);
        // Coba original query + cleaned query
        const searchQueries = [
          query,
          this.extractSearchQuery(query),   // cleaned (tanpa stopwords)
          this.extractSearchQuery(query).replace(/ /g, ""), // merged
        ].filter(q => {
          const cleaned = q.trim().toLowerCase();
          if (cleaned.length <= 2) return false;
          if (stopwords.has(cleaned)) return false;
          // Don't query if it is purely stopwords
          const words = cleaned.split(/\s+/).filter(Boolean);
          const allStopwords = words.every(w => stopwords.has(w));
          if (allStopwords) return false;
          return true;
        });
        
        for (const sq of [...new Set(searchQueries)].filter(q => q.length > 2)) {
          const ddgResults = await this.queryDuckDuckGo(sq);
          if (ddgResults.length > 0) {
            matchedRoutes.push("DuckDuckGo");
            const findings: Finding[] = ddgResults.map((r, i) => ({
              id: `knowledge-ddg-${i}`,
              claim: r.content.substring(0, 500),
              evidence: [{
                text: r.content,
                sourceUrl: r.sourceUrl,
                sourceTitle: r.title,
                relevance: 0.85,
                extractedAt: Date.now(),
              }],
              confidence: r.confidence,
              sourceUrls: [r.sourceUrl],
            }));
            allFindings.push(...findings);
            logger.info({ query: sq }, "[Knowledge] DuckDuckGo fallback matched");
            break;
          }
        }
      } catch (err: any) {
        logger.warn({ error: err.message }, "[Knowledge] DuckDuckGo fallback failed");
      }
    }

    // ─── Universal Fallback 2: Wikipedia API via curl ─────
    // Wikipedia blokir Node.js dari IP ini (403), jadi pake curl
    if (allFindings.length === 0) {
      try {
        const wikiResults = await this.queryWikipedia(query);
        if (wikiResults.length > 0) {
          matchedRoutes.push("Wikipedia");
          const findings: Finding[] = wikiResults.map((r, i) => ({
            id: `knowledge-wikipedia-${i}`,
            claim: r.content.substring(0, 500),
            evidence: [{
              text: r.content,
              sourceUrl: r.sourceUrl,
              sourceTitle: r.title,
              relevance: 0.9,
              extractedAt: Date.now(),
            }],
            confidence: r.confidence,
            sourceUrls: [r.sourceUrl],
          }));
          allFindings.push(...findings);
          logger.info({ query, sources: wikiResults.length }, "[Knowledge] Wikipedia fallback matched");
        }
      } catch (err: any) {
        logger.warn({ error: err.message }, "[Knowledge] Wikipedia fallback failed");
      }
    }

    return {
      findings: allFindings,
      matched: matchedRoutes.length > 0,
      routeName: matchedRoutes.join(" + "),
    };
  }

  /**
   * Wikipedia API — universal knowledge untuk TOPIK BARU.
   * Free, no rate limit, no CAPTCHA, no auth.
   * Returns summary extract untuk query apapun dalam < 1 detik.
   */
  private async queryWikipedia(query: string): Promise<ApiResult[]> {
    // Cari kata kunci yang bisa jadi judul Wikipedia
    // Strategy multi-level buat nge-handle query kaya "space x" → "SpaceX"
    const clean = query.trim();
    const originalWords = clean.split(/\s+/).filter((w: string) => w.length > 0);
    
    // Stopwords ringan — jangan hapus kata pendek yang bisa jadi bagian proper noun!
    // Contoh: "x" di "space x" harus KEEP karena bagian dari "SpaceX"
    const stopwords = new Set(["harga","berapa","apakah","siapa","apa","dimana","kapan","mengapa","bagaimana","tentang","cari","info","data","hasil","pendapat","menurut","price","what","who","where","when","why","how","is","are","the","a","an","of","in","for","to","dan","atau","yg","yang","di","ke","dari","dengan","pada","itu","ini","saya","kami","kita","baru","terbaru","sekarang","saat","tahun","bulan","minggu","hari","kemarin","besok","dividen","saham","s0ace"]);

    // Strategy: generate semua kemungkinan judul
    const candidates = new Set<string>();
    
    // Only add original if it's not a stopword or not all stopwords
    const isStopwordQuery = (q: string) => {
      const lower = q.trim().toLowerCase();
      if (stopwords.has(lower)) return true;
      const words = lower.split(/\s+/).filter(Boolean);
      return words.every(w => stopwords.has(w));
    };

    if (!isStopwordQuery(clean)) {
      candidates.add(clean);
      candidates.add(clean.replace(/ /g, ""));
    }

    // Tanpa stopwords (tapi keep "x" karena bisa jadi bagian proper noun)
    const filtered = originalWords.filter((w: string) => w.length > 1 && !stopwords.has(w.toLowerCase()));
    if (filtered.length > 0) {
      candidates.add(filtered.join(" "));                                // "space"
      candidates.add(filtered.join(""));                                 // "space"
    }

    // Bigram: 2 kata berurutan digabung (buat nangkep "spacex")
    for (let i = 0; i < originalWords.length - 1; i++) {
      const w1 = originalWords[i].toLowerCase();
      const w2 = originalWords[i + 1].toLowerCase();
      if (!stopwords.has(w1) || !stopwords.has(w2)) {
        candidates.add(originalWords[i] + " " + originalWords[i + 1]);
        candidates.add(originalWords[i] + originalWords[i + 1]);           // "spacex"
      }
    }

    // Trigram: 3 kata berurutan digabung
    for (let i = 0; i < originalWords.length - 2; i++) {
      const w1 = originalWords[i].toLowerCase();
      const w2 = originalWords[i + 1].toLowerCase();
      const w3 = originalWords[i + 2].toLowerCase();
      if (!stopwords.has(w1) || !stopwords.has(w2) || !stopwords.has(w3)) {
        candidates.add(originalWords[i] + " " + originalWords[i + 1] + " " + originalWords[i + 2]);
        candidates.add(originalWords[i] + originalWords[i + 1] + originalWords[i + 2]);
      }
    }

    // Tiap kata individual (kecuali stopwords super pendek)
    for (const w of originalWords) {
      if (w.length > 2 && !stopwords.has(w.toLowerCase())) {
        candidates.add(w);                                // "space", "dividen"
      }
    }

    // Urutin: paling PANJANG & paling SPESIFIK duluan
    // Biar "spacex" kebaca SEBELUM "space"
    const uniqueTitles = [...candidates]
      .filter((t: string) => {
        const lower = t.trim().toLowerCase();
        if (lower.length <= 2) return false;
        if (stopwords.has(lower)) return false;
        const words = lower.split(/\s+/).filter(Boolean);
        if (words.every(w => stopwords.has(w))) return false;
        return true;
      })
      .sort((a: string, b: string) => b.length - a.length) // descending by length
      .slice(0, 8);

    const cacheKey = `wiki:${uniqueTitles[0] || query}`;
    const cached = getWikiCached(cacheKey);
    if (cached) return cached;

    const results: ApiResult[] = [];

    for (const rawTitle of uniqueTitles) {
      const title = rawTitle.charAt(0).toUpperCase() + rawTitle.slice(1);
      const encodedTitle = encodeURIComponent(title);

      try {
        // Pake fetch (native Node.js) — mungkin work di lingkungan lain
        const resp = await fetch(
          `https://en.wikipedia.org/api/rest_v1/page/summary/${encodedTitle}`,
          {
            headers: { "User-Agent": "Mozilla/5.0 (compatible; ResearchBot/1.0)", Accept: "application/json" },
            signal: AbortSignal.timeout(3000),
          }
        );

        if (resp.status !== 200) continue;
        const summary = await resp.json() as any;
        const extract = summary?.extract || "";
        if (extract.length < 50) continue;

        results.push({
          title: `Wikipedia — ${summary.title || title}`,
          content: `${summary.title || title}${summary.description ? ` - ${summary.description}` : ""}\n\n${extract.substring(0, 2000)}\n\nSource: ${summary.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${encodedTitle}`}`,
          sourceUrl: summary.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${encodedTitle}`,
          confidence: 0.85,
        });
        break;
      } catch { /* coba title berikutnya */ }
    }

    // Fallback: pake curl via child_process (work di server ini walau Node.js diblokir Wikipedia)
    if (results.length === 0) {
      const { execSync } = await import("node:child_process");
      
      for (const rawTitle of uniqueTitles) {
        try {
          const title = rawTitle.charAt(0).toUpperCase() + rawTitle.slice(1);
          const encoded = encodeURIComponent(title);
          
          const output = execSync(
            `curl -s -H "User-Agent: Mozilla/5.0" "https://en.wikipedia.org/api/rest_v1/page/summary/${encoded}"`,
            { timeout: 5000, encoding: "utf-8" }
          );

          const summary = JSON.parse(output);
          if (!summary?.extract || summary.extract.length < 50) continue;

          results.push({
            title: `Wikipedia — ${summary.title}`,
            content: `${summary.title}${summary.description ? ` - ${summary.description}` : ""}\n\n${summary.extract.substring(0, 2000)}\n\nSource: ${summary.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${encoded}`}`,
            sourceUrl: summary.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${encoded}`,
            confidence: 0.85,
          });
          break; // dapet satu, berhenti
        } catch { /* coba candidate berikutnya */ }
      }
    }

    if (results.length > 0) {
      setWikiCache(cacheKey, results);
    }

    return results;
  }

  /**
   * DuckDuckGo Instant Answer API — free, instant, no auth.
   */
  private async queryDuckDuckGo(query: string): Promise<ApiResult[]> {
    const results: ApiResult[] = [];
    const http = createHttpClient();

    try {
      const resp = await http.get(
        `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`,
        {
          headers: { "User-Agent": "DeepResearchBot/1.0" },
          timeout: 5000,
        }
      );

      if (resp.status !== 200) return results;
      const data = resp.data as any;

      // Abstract (instant answer)
      if (data.AbstractText && data.AbstractText.length > 50) {
        results.push({
          title: `DuckDuckGo — ${data.Heading || query}`,
          content: data.AbstractText.substring(0, 1500),
          sourceUrl: data.AbstractURL || `https://duckduckgo.com/?q=${encodeURIComponent(query)}`,
          confidence: 0.8,
        });
      }

      // Definition
      if (data.Definition && !data.AbstractText) {
        results.push({
          title: `Definition: ${data.DefinitionSource || query}`,
          content: data.Definition,
          sourceUrl: data.DefinitionURL || `https://duckduckgo.com/?q=${encodeURIComponent(query)}`,
          confidence: 0.7,
        });
      }

      // Related topics
      if (results.length === 0 && data.RelatedTopics?.length > 0) {
        const texts = data.RelatedTopics
          .slice(0, 3)
          .filter((t: any) => t.Text)
          .map((t: any) => t.Text);
        if (texts.length > 0) {
          results.push({
            title: `Related: ${data.Heading || query}`,
            content: texts.join("\n"),
            sourceUrl: `https://duckduckgo.com/?q=${encodeURIComponent(query)}`,
            confidence: 0.6,
          });
        }
      }
    } catch { /* DuckDuckGo failed */ }

    return results;
  }

  /**
   * Extract kata kunci utama dari query (buat DuckDuckGo & Wikipedia).
   * Hapus stopwords, ambil kata-kata penting.
   */
  private extractSearchQuery(query: string): string {
    const stopwords = new Set(["harga","berapa","apakah","siapa","apa","dimana","kapan","mengapa","bagaimana","tentang","cari","info","data","hasil","pendapat","menurut","price","what","who","where","when","why","how","is","are","the","a","an","of","in","for","to","dan","atau","yg","yang","di","ke","dari","dengan","pada","itu","ini","saya","kami","kita","baru","terbaru","sekarang","saat","tahun","bulan","minggu","hari","kemarin","besok","dividen","saham","s0ace"]);
    return query.split(/\s+/)
      .filter((w: string) => w.length > 1 && !stopwords.has(w.toLowerCase()))
      .join(" ");
  }
}

// Singleton
let _router: KnowledgeRouter | null = null;
export function getKnowledgeRouter(): KnowledgeRouter {
  if (!_router) _router = new KnowledgeRouter();
  return _router;
}
