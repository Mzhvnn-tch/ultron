// demo.mjs — Deep Research Agent Demo
// Usage: npm run demo
// Requires: npm run dev (in a separate terminal)

const API = "http://localhost:3002";
const DELAY = 1200;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function divider() {
  console.log("-".repeat(64));
}

function section(title) {
  console.log();
  divider();
  console.log(title);
  divider();
}

function ok(label, value) {
  const pad = String(label).padEnd(30, ".");
  console.log(`  ${pad} ${value}`);
}

function note(msg) {
  console.log(`  ${msg}`);
}

function blank() {
  console.log();
}

// ------------------------------------------------------------
// Health Check
// ------------------------------------------------------------

async function checkServer() {
  try {
    const r = await fetch(`${API}/health`, { signal: AbortSignal.timeout(3000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const d = await r.json();
    ok("Status",   "online");
    ok("Uptime",   `${d.uptime.toFixed(1)}s`);
    ok("Cache",    `${d.cache?.totalEndpoints ?? 0} endpoints stored`);
    ok("LLM",      "deepseek-v4-flash (OpenAI-compatible)");
    ok("CAP",      d.cap?.enabled ? "enabled" : "disabled");
  } catch {
    note("Server is not running.");
    note("Start it first: npm run dev");
    process.exit(1);
  }
}

// ------------------------------------------------------------
// Knowledge Router — pre-built API routes, no scraping
// ------------------------------------------------------------

async function demoKnowledgeRouter() {
  const queries = [
    { q: "harga ETH sekarang",  label: "ETH price (CoinGecko)"  },
    { q: "DeFi TVL terbesar",   label: "DeFi TVL (DefiLlama)"   },
    { q: "harga emas hari ini", label: "Gold price (Gold-API)"   },
  ];

  for (const { q, label } of queries) {
    blank();
    note(`Query : "${q}"`);
    note(`Source: ${label}`);
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
      const preview = (d.summary || d.findings?.[0]?.claim || "no result")
        .replace(/#+\s*/g, "")
        .replace(/\n+/g, " ")
        .trim()
        .substring(0, 120);
      ok("Duration", `${ms}ms`);
      ok("Result",   `${preview}${preview.length >= 120 ? "..." : ""}`);
    } catch (e) {
      ok("Error", e.message);
    }
    await sleep(DELAY);
  }
}

// ------------------------------------------------------------
// API Discovery — probe OpenAPI, Swagger, GraphQL introspection
// ------------------------------------------------------------

async function demoApiDiscovery() {
  const targets = [
    { q: "get posts", domain: "jsonplaceholder.typicode.com", label: "jsonplaceholder.typicode.com" },
    { q: "pokemon",   domain: "pokeapi.co",                   label: "pokeapi.co (has OpenAPI spec)" },
  ];

  for (const { q, label } of targets) {
    blank();
    note(`Target: ${label}`);
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
      ok("Duration",            `${ms}ms`);
      ok("Endpoints discovered", d.discoveredApiEndpoints?.length ?? 0);
      ok("Findings",             d.findings?.length ?? 0);
      ok("Citations",            d.citations?.length ?? 0);
      if (d.discoveredApiEndpoints?.length > 0) {
        const ep = d.discoveredApiEndpoints[0];
        ok("Top endpoint", `[${ep.method}] ${ep.url.substring(0, 55)}`);
      }
    } catch (e) {
      ok("Error", e.message);
    }
    await sleep(DELAY);
  }
}

// ------------------------------------------------------------
// JS Bundle Parser — extract API calls directly from source code
// ------------------------------------------------------------

async function demoBundleParser() {
  const domain = "jsonplaceholder.typicode.com";
  blank();
  note(`Domain : ${domain}`);
  note(`Method : download JS bundles, parse fetch/axios calls from minified source`);
  note(`Benefit: no browser session, no CAPTCHA, no rate limits`);
  blank();

  const start = Date.now();
  try {
    const r = await fetch(`${API}/research/deep`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ domain, query: "list all available endpoints" }),
      signal: AbortSignal.timeout(60000),
    });
    const d = await r.json();
    const ms = Date.now() - start;

    ok("Duration",            `${ms}ms`);
    ok("Endpoints extracted",  d.totalEndpointsFound ?? 0);
    ok("Endpoints queried",    d.totalEndpointsQueried ?? 0);

    if (d.apiEndpoints?.length > 0) {
      blank();
      note("Discovered endpoints:");
      d.apiEndpoints.slice(0, 6).forEach((ep) => {
        const conf = `conf ${(ep.confidence * 100).toFixed(0)}%`;
        note(`  [${ep.method}] ${ep.url.substring(0, 58).padEnd(58)}  ${conf}`);
      });
      if (d.apiEndpoints.length > 6) {
        note(`  ... and ${d.apiEndpoints.length - 6} more`);
      }
    }

    if (d.credentials?.length > 0) {
      blank();
      ok("Credentials found", d.credentials.length);
      d.credentials.slice(0, 3).forEach((c) => {
        note(`  [${c.type}] ${c.key}: ${String(c.value).substring(0, 40)}...`);
      });
    }

    if (d.authFlow) {
      ok("Auth flow", d.authFlow);
    }

    if (Object.keys(d.directApiResults || {}).length > 0) {
      blank();
      note("Sample data from direct API hits:");
      Object.entries(d.directApiResults).slice(0, 2).forEach(([desc, val]) => {
        note(`  ${desc}: ${JSON.stringify(val).substring(0, 90)}...`);
      });
    }
  } catch (e) {
    ok("Error", e.message);
  }
}

// ------------------------------------------------------------
// Cache — self-learning endpoint store
// ------------------------------------------------------------

async function demoCache() {
  try {
    const sr = await fetch(`${API}/cache/stats`);
    const sd = await sr.json();
    ok("Stored endpoints", sd.totalEndpoints ?? 0);
    ok("Persistence",      "SQLite — survives restarts, accumulates knowledge");

    const dr = await fetch(`${API}/cache/domains`);
    const dd = await dr.json();
    if (dd.domains?.length > 0) {
      ok("Known domains", `${dd.domains.length} total`);
      note(`  ${dd.domains.slice(0, 6).join(", ")}${dd.domains.length > 6 ? ", ..." : ""}`);
    }

    const pr = await fetch(`${API}/pool/stats`);
    const pd = await pr.json();
    ok("Browser pool", `${pd.total ?? 0} Chromium instances (${pd.available ?? 0} idle)`);
  } catch (e) {
    ok("Error", e.message);
  }
}

// ------------------------------------------------------------
// Main
// ------------------------------------------------------------

async function main() {
  console.log();
  console.log("Deep Research Agent");
  console.log("4-Layer Autonomous Research Engine");
  console.log(`${new Date().toISOString()}`);

  section("Health Check");
  await checkServer();
  await sleep(DELAY);

  section("1. Knowledge Router  (instant answers from known APIs)");
  note("Hits CoinGecko, DefiLlama, Gold-API directly. No scraping.");
  await demoKnowledgeRouter();
  await sleep(DELAY);

  section("2. API Discovery  (probe + OpenAPI + GraphQL introspection)");
  note("Probes common paths, parses Swagger specs, runs GraphQL introspection.");
  await demoApiDiscovery();
  await sleep(DELAY);

  section("3. JS Bundle Parser  (Layer 4)");
  note("Downloads website JS bundles. Extracts every API call from source code.");
  await demoBundleParser();
  await sleep(DELAY);

  section("4. Self-Learning Cache");
  note("Every discovered endpoint is stored. Subsequent queries skip rediscovery.");
  blank();
  await demoCache();

  section("Done");
  note("Try it:");
  note("  ./research \"harga ETH sekarang\"");
  note("  ./research \"deep:uniswap.org\"");
  note("  ./research --interactive");
  blank();
}

main().catch((e) => {
  console.error(`Fatal: ${e.message}`);
  process.exit(1);
});
