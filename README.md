# Ultron

Autonomous deep research agent that goes beyond scraping — it **discovers and talks directly to APIs**, bypasses frontend UIs, and synthesizes grounded findings with citations.

## What Makes This Different

Most research agents scrape HTML. This one reverse-engineers the actual data layer.

| Layer | What it does |
|-------|-------------|
| **Layer 0 — API Discovery** | Finds documented APIs via OpenAPI specs, docs pages, well-known patterns |
| **Layer 1 — Network Sniffing** | Launches a headless browser, intercepts all network requests via CDP, captures live API calls |
| **Layer 2 — Stealth Scrape** | SPA-aware headless fallback with stealth mode (anti-bot evasion) |
| **Layer 3 — Citation Grounding** | Cross-verifies findings, detects contradictions, generates inline citations |
| **Layer 4 — JS Bundle Parser** | Downloads & parses website JS bundles to extract raw API endpoints — no browser, no CAPTCHA, no rate limits |

Plus a **Knowledge Router** with pre-built routes for crypto/DeFi, finance, news, and tech — hitting known public APIs directly for instant answers.

---

## Quick Start

### 1. Clone & Install

```bash
git clone <repo>
cd deep-research-agent
npm install
```

### 2. Configure

```bash
cp .env.example .env
```

Edit `.env`:

```env
# Required: LLM for query decomposition & synthesis
LLM_API_KEY=sk-...
LLM_BASE_URL=https://api.openai.com/v1   # Any OpenAI-compatible API
LLM_MODEL=gpt-4o

# Optional: defaults are fine for hackathon
PORT=3002
```

> **Note:** The agent works without an LLM key — it falls back to heuristic synthesis. But with a key, query decomposition and result summaries are significantly better.

### 3. Run

```bash
npm run dev
```

Server starts at `http://localhost:3002`. You'll see:

```
Ultron server started { host: '0.0.0.0', port: 3002 }
```

---

## Usage

### Interactive CLI

```bash
./research --interactive
```

```
DEEP RESEARCH AGENT — Interactive Mode
  Ketik 'exit' atau 'quit' buat keluar
  Ketik 'deep:domain.com' buat pake layer 4 (bundle parser)
============================================================

$ harga ETH sekarang
$ deep:uniswap.org
$ apa itu sumopod.com
```

### Single Query CLI

```bash
./research "ETH price and staking yield"
./research "what APIs does github.com expose"
./research "deep:defillama.com"   # Layer 4: bundle parsing mode
```

---

## REST API

### `POST /research` — Full Research

```bash
curl -X POST http://localhost:3002/research \
  -H "Content-Type: application/json" \
  -d '{
    "query": "ETH price and DeFi TVL",
    "maxDepth": 3,
    "maxSources": 10,
    "preferApi": true
  }'
```

**Response:**
```json
{
  "id": "uuid",
  "summary": "# Research Summary...",
  "findings": [...],
  "citations": [...],
  "discoveredApiEndpoints": [...],
  "durationMs": 4200
}
```

### `POST /research/quick` — Fast Research (≤2 depth, ≤5 sources)

```bash
curl -X POST http://localhost:3002/research/quick \
  -H "Content-Type: application/json" \
  -d '{"query": "bitcoin price"}'
```

### `POST /research/deep` — JS Bundle API Extraction

Reverse-engineers a website's JS bundles to extract raw API endpoints.

```bash
curl -X POST http://localhost:3002/research/deep \
  -H "Content-Type: application/json" \
  -d '{"domain": "uniswap.org", "query": "liquidity pools"}'
```

**Response includes:**
- `apiEndpoints` — all discovered endpoints with confidence scores
- `credentials` — any API keys/tokens found in bundles
- `curlCommands` — ready-to-run curl commands for each endpoint
- `directApiResults` — actual data from hitting the discovered APIs
- `authFlow` — detected auth mechanism (Bearer, API key, wallet sig, etc.)

### `POST /research/verify` — Fact Verification

```bash
curl -X POST http://localhost:3002/research/verify \
  -H "Content-Type: application/json" \
  -d '{"query": "is ETH proof of stake?"}'
```

### Other Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /health` | Server status + cache stats |
| `GET /cache/stats` | SQLite endpoint cache metrics |
| `GET /cache/domains` | All domains in cache |
| `GET /cache/domain/:domain` | Cached endpoints for a specific domain |
| `GET /pool/stats` | Browser pool status |

---

## CROO CAP Protocol (Agent-to-Agent Marketplace)

This agent is discoverable and callable by other agents via the **CROO CAP protocol** on Base.

Enable in `.env`:
```env
CROO_ENABLED=true
CROO_API_URL=https://api.croo.network
CROO_WS_URL=wss://api.croo.network/ws
CROO_SDK_KEY=croo_sk_...
```

Other agents can discover this agent on the [CROO Agent Store](https://agent.croo.network) and place orders with on-chain settlement in USDC.

---

## Architecture

```
Request
  │
  ▼
Knowledge Router ──→ (instant answer from known APIs)
  │ (no match)
  ▼
Query Decomposer (LLM)
  │
  ▼
For each sub-query:
  ├── Layer 0: API Discovery (OpenAPI, docs, well-known)
  │     └─ Hit discovered APIs directly
  ├── Layer 1: Network Sniff (CDP + headless browser)
  │     └─ Query sniffed endpoints
  ├── Layer 2: Stealth Scrape (fallback)
  └── (short-circuit on success at each layer)
  │
  ▼
Layer 3: Citation Grounding + Contradiction Detection
  │
  ▼
Verifier + Quality Scoring
  │
  ▼
Synthesizer (LLM or template fallback)
  │
  ▼
ResearchResult { summary, findings, citations, endpoints }
```

---

## Tech Stack

- **Runtime:** Node.js + TypeScript
- **HTTP Server:** Express
- **Browser Automation:** Playwright (stealth mode)
- **Cache:** SQLite via better-sqlite3
- **Validation:** Zod
- **Logging:** Pino (structured JSON)
- **LLM:** OpenAI-compatible API (configurable)

---

## Project Structure

```
src/
├── index.ts              # Entry point + graceful shutdown
├── server.ts             # Express routes
├── config.ts             # Config from env
├── types.ts              # Zod schemas + TypeScript types
├── layers/
│   ├── layer0-discovery.ts    # API Discovery
│   ├── layer1-sniffing.ts     # Network sniffing via CDP
│   ├── layer2-scrape.ts       # Stealth scraping
│   ├── layer3-grounding.ts    # Citation grounding
│   └── layer4-bundle-parser.ts # JS bundle API extraction
├── pipeline/
│   ├── orchestrator.ts   # Master pipeline controller
│   ├── decomposer.ts     # Query decomposition
│   ├── synthesizer.ts    # Result synthesis
│   ├── verifier.ts       # Finding verification
│   └── validity.ts       # Validity engine
├── knowledge/
│   └── router.ts         # Pre-built API knowledge base
├── cache/                # SQLite endpoint cache
├── browser/              # Playwright browser pool
├── credentials/          # Discovered credential store
├── cap/                  # CAP protocol wrapper
└── utils/                # HTTP client, logger
```

---

## Performance Notes

- **Knowledge Router** answers in <500ms for known topics (crypto, finance, etc.)
- **Layer 0 (API)** is fastest for sites with OpenAPI specs
- **Layer 4 (Bundle Parser)** is fast (no browser) but depends on JS bundle size
- **Layer 1 (Sniffing)** is slowest — spawns a real browser
- Browser pool pre-warms 2 Chromium instances on startup to reduce first-request latency

---

## Security Notes

- `.env` is gitignored — never commit API keys
- Rate limiting is built-in (`REQUEST_DELAY_MS`, `MAX_CONCURRENT_DOMAINS`)
- Stealth mode enabled by default to avoid bot detection
- All discovered credentials are stored in-memory only (not persisted)
