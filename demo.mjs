// demo.mjs — Deep Research Agent Hackathon Demo Script
// Usage: npm run demo
// Requires server running: npm run dev (in another terminal)

const API = "http://localhost:3001";
const DELAY = 1200; // ms between demos

const c = {
  reset:   "\x1b[0m",
  bold:    "\x1b[1m",
  dim:     "\x1b[2m",
  green:   "\x1b[32m",
  cyan:    "\x1b[36m",
  yellow:  "\x1b[33m",
  magenta: "\x1b[35m",
  red:     "\x1b[31m",
  blue:    "\x1b[34m",
  bgBlue:  "\x1b[44m",
  bgGreen: "\x1b[42m",
  bgCyan:  "\x1b[46m",
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function header(title) {
  const line = "═".repeat(62);
  console.log(`\n${c.cyan}${c.bold}${line}${c.reset}`);
  console.log(`${c.cyan}${c.bold}  ${title}${c.reset}`);
  console.log(`${c.cyan}${c.bold}${line}${c.reset}\n`);
}

function section(icon, label) {
  console.log(`${c.yellow}${icon} ${c.bold}${label}${c.reset}`);
}

function ok(msg)   { console.log(`  ${c.green}✓${c.reset}  ${msg}`); }
function info(msg) { console.log(`  ${c.blue}→${c.reset}  ${c.dim}${msg}${c.reset}`); }
function fail(msg) { console.log(`  ${c.red}✗${c.reset}  ${msg}`); }
function data(msg) { console.log(`     ${c.dim}${msg}${c.reset}`); }

// ─── 0. Health Check ────────────────────────────────────────────

async function checkServer() {
  try {
    const r = await fetch(`${API}/health`, { signal: AbortSignal.timeout(3000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const d = await r.json();
    ok(`Server online  uptime: ${d.uptime.toFixed(1)}s`);
    ok(`Endpoint cache: ${d.cache?.totalEndpoints ?? 0} entries in SQLite`);
    ok(`LLM model: deepseek-v4-flash via OpenAI-compatible API`);
    ok(`CAP protocol: ${d.cap?.enabled ? "enabled" : "off (safe mode)"}`);
    return true;
  } catch (e) {
    fail(`Server tidak jalan! Jalankan dulu di terminal lain:`);
    console.log(`\n     ${c.cyan}cd deep-research-agent && npm run dev${c.reset}\n`);
    process.exit(1);
  }
}

// ─── 1. Knowledge Router (Instant API Answers) ──────────────────

async function demoKnowledgeRouter() {
  const queries = [
    { q: "harga ETH sekarang",   label: "ETH price  (CoinGecko API)" },
    { q: "DeFi TVL terbesar",    label: "DeFi TVL   (DefiLlama API)" },
    { q: "harga emas hari ini",  label: "Gold price (Gold-API)"      },
  ];

  for (const { q, label } of queries) {
    info(`Query: "${q}"`);
    const start = Date.now();
    try {
      const r = await fetch(`${API}/research/quick`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q, maxDepth: 1, maxSources: 3, preferApi: true }),
        signal: AbortSignal.timeout(15000),
      });
      const d = await r.json();
      const ms = Date.now() - start;
      const preview = (d.summary || d.findings?.[0]?.claim || "no data")
        .replace(/#+\s*/g, "")
        .replace(/\n+/g, " ")
        .trim()
        .substring(0, 130);

      ok(`${label}  [${ms}ms]`);
      data(`${preview}${preview.length >= 130 ? "…" : ""}`);
    } catch (e) {
      fail(`${label} — ${e.message}`);
    }
    await sleep(DELAY);
  }
}

// ─── 2. API Discovery + Network Sniffing ────────────────────────

async function demoApiDiscovery() {
  const targets = [
    { q: "get posts from jsonplaceholder", domain: "jsonplaceholder.typicode.com", label: "Public REST API (no auth)" },
    { q: "pokemon data",                   domain: "pokeapi.co",                   label: "PokeAPI (OpenAPI spec)"   },
  ];

  for (const { q, label } of targets) {
    info(`Target: ${label}`);
    const start = Date.now();
    try {
      const r = await fetch(`${API}/research`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q, maxDepth: 2, maxSources: 5, preferApi: true }),
        signal: AbortSignal.timeout(45000),
      });
      const d = await r.json();
      const ms = Date.now() - start;
      ok(`${d.discoveredApiEndpoints?.length ?? 0} endpoints discovered  [${ms}ms]`);
      ok(`${d.findings?.length ?? 0} findings  •  ${d.citations?.length ?? 0} citations`);
      if (d.discoveredApiEndpoints?.length > 0) {
        const ep = d.discoveredApiEndpoints[0];
        data(`Top endpoint: [${ep.method}] ${ep.url.substring(0, 70)}`);
      }
    } catch (e) {
      fail(e.message);
    }
    await sleep(DELAY);
  }
}

// ─── 3. JS Bundle Parser (Layer 4 — The Wow Factor) ─────────────

async function demoBundleParser() {
  const domain = "jsonplaceholder.typicode.com";
  info(`Downloading & parsing JS bundles of: ${domain}`);
  info(`Extracting fetch()/axios() calls from minified source…`);
  console.log();

  const start = Date.now();
  try {
    const r = await fetch(`${API}/research/deep`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ domain, query: "get all available data endpoints" }),
      signal: AbortSignal.timeout(60000),
    });
    const d = await r.json();
    const ms = Date.now() - start;

    ok(`${d.totalEndpointsFound} API endpoints extracted from JS bundles  [${ms}ms]`);
    ok(`${d.totalEndpointsQueried} endpoints successfully hit & got data`);

    if (d.apiEndpoints?.length > 0) {
      console.log(`\n  ${c.bold}Discovered endpoints (top 6):${c.reset}`);
      d.apiEndpoints.slice(0, 6).forEach((ep) => {
        const icon = ep.confidence >= 0.8 ? "🟢" : ep.confidence >= 0.6 ? "🟡" : "🟠";
        const conf = `${(ep.confidence * 100).toFixed(0)}%`;
        console.log(`    ${icon}  [${ep.method}] ${ep.url.substring(0, 65).padEnd(65)}  (conf: ${conf})`);
      });
      if (d.apiEndpoints.length > 6) {
        data(`... and ${d.apiEndpoints.length - 6} more`);
      }
    }

    if (d.credentials?.length > 0) {
      console.log();
      ok(`🔑 ${d.credentials.length} credential(s) found in bundles`);
      d.credentials.slice(0, 3).forEach((cred) => {
        data(`[${cred.type}] ${cred.key}: ${String(cred.value).substring(0, 40)}…`);
      });
    }

    if (d.authFlow) {
      ok(`Auth flow detected: ${d.authFlow}`);
    }

    if (Object.keys(d.directApiResults || {}).length > 0) {
      console.log();
      ok(`Direct API results (agent hit endpoints, got real data):`);
      Object.entries(d.directApiResults).slice(0, 2).forEach(([desc, val]) => {
        const preview = JSON.stringify(val).substring(0, 100);
        data(`${desc}: ${preview}…`);
      });
    }
  } catch (e) {
    fail(e.message);
  }
}

// ─── 4. Self-Learning Cache ──────────────────────────────────────

async function demoCacheSmarts() {
  try {
    const sr = await fetch(`${API}/cache/stats`);
    const sd = await sr.json();
    ok(`SQLite endpoint cache: ${sd.totalEndpoints ?? 0} endpoints persisted across sessions`);
    ok(`Agent gets smarter every run — no re-discovering known APIs`);

    const dr = await fetch(`${API}/cache/domains`);
    const dd = await dr.json();
    if (dd.domains?.length > 0) {
      ok(`Known domains (${dd.domains.length} total): ${dd.domains.slice(0, 6).join(", ")}${dd.domains.length > 6 ? " …" : ""}`);
    }

    const pr = await fetch(`${API}/pool/stats`);
    const pd = await pr.json();
    ok(`Browser pool: ${pd.total ?? 0} Chromium instance(s) ready, ${pd.available ?? 0} idle`);
  } catch (e) {
    fail(e.message);
  }
}

// ─── Main ────────────────────────────────────────────────────────

async function main() {
  console.clear();

  const WIDTH = 64;
  const pad = (s) => s + " ".repeat(Math.max(0, WIDTH - s.length - 2));

  console.log(`\n${c.bgBlue}${c.bold}  ${pad("🧠  DEEP RESEARCH AGENT — Hackathon Demo")}${c.reset}`);
  console.log(`${c.bgBlue}${c.bold}  ${pad("4-Layer Autonomous Research Engine + JS Bundle Parser")}${c.reset}`);
  console.log(`${c.bgBlue}${c.bold}  ${pad("Powered by DeepSeek v4 Flash · Built for speed & depth")}${c.reset}\n`);

  // ── 0. Health ────────────────────────────────────────
  header("0️⃣   Server Health Check");
  await checkServer();
  await sleep(DELAY);

  // ── 1. Knowledge Router ──────────────────────────────
  header("1️⃣   Knowledge Router — Instant API Answers (<1s)");
  section("⚡", "Pre-built routes ke CoinGecko, DefiLlama, Gold-API");
  section("🚫", "No scraping. No browser. Direct API calls only.");
  console.log();
  await demoKnowledgeRouter();
  await sleep(DELAY);

  // ── 2. API Discovery + Sniffing ──────────────────────
  header("2️⃣   Layer 0+1 — API Discovery + CDP Sniffing");
  section("🔍", "Probe OpenAPI specs, parse Swagger, introspect GraphQL");
  section("📡", "CDP network sniffing: observe all XHR/fetch in headless browser");
  console.log();
  await demoApiDiscovery();
  await sleep(DELAY);

  // ── 3. Bundle Parser ─────────────────────────────────
  header("3️⃣   Layer 4 — JS Bundle Parser  ★ THE WOW FACTOR ★");
  section("🚀", "Download JS bundles → parse minified source → extract ALL API calls");
  section("🔓", "No browser. No CAPTCHA. No rate limits. Raw API access.");
  console.log();
  await demoBundleParser();
  await sleep(DELAY);

  // ── 4. Self-Learning Cache ───────────────────────────
  header("4️⃣   Self-Learning Cache — Agent Gets Smarter Over Time");
  section("🧠", "SQLite endpoint cache persists discoveries across sessions");
  console.log();
  await demoCacheSmarts();
  await sleep(DELAY);

  // ── Done ─────────────────────────────────────────────
  console.log();
  console.log(`${c.bgGreen}${c.bold}  ${pad("✅  Demo complete! Ready for questions.")}${c.reset}`);
  console.log();
  console.log(`${c.bold}Try it yourself:${c.reset}`);
  console.log(`  ${c.cyan}./research "harga ETH sekarang"${c.reset}         ${c.dim}# crypto price${c.reset}`);
  console.log(`  ${c.cyan}./research "deep:uniswap.org"${c.reset}           ${c.dim}# bundle parser${c.reset}`);
  console.log(`  ${c.cyan}./research --interactive${c.reset}                ${c.dim}# chat mode${c.reset}`);
  console.log(`  ${c.cyan}curl localhost:3001/health${c.reset}              ${c.dim}# health check${c.reset}`);
  console.log();
}

main().catch((e) => {
  console.error(`\n${c.red}❌ Demo crashed: ${e.message}${c.reset}`);
  console.error(e.stack);
  process.exit(1);
});
