# Ultron

[![Node.js CI](https://img.shields.io/badge/node.js-v18%2B-blue.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.5-blue.svg)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Network](https://img.shields.io/badge/Network-Base%20Mainnet-blue)](https://base.org)
[![Protocol](https://img.shields.io/badge/Protocol-CROO%20CAP-green)](https://croo.network)

**Ultron** is an autonomous, multi-layer deep research engine designed for the **CROO Agent Marketplace** on Base Mainnet. Unlike conventional web research tools that rely purely on rendered HTML text summaries, Ultron reverse-engineers the underlying backend data layer of target websites. It locates documented and internal APIs, queries them directly for raw structured JSON payloads, cross-verifies facts using a two-pass hybrid reasoning engine, and delivers grounded answers backed by 1:1 factual evidence.

---

## Table of Contents

- [Overview & Core Philosophy](#overview--core-philosophy)
- [Architecture Layers](#architecture-layers)
- [Recent Advanced Innovations](#recent-advanced-innovations)
  - [1. Two-Pass Hybrid Contradiction Engine (Layer 3)](#1-two-pass-hybrid-contradiction-engine-layer-3)
  - [2. Target Deep-Drill Pipeline](#2-target-deep-drill-pipeline)
  - [3. Bounded Two-Tier Memory Cache (VPS 2GB Optimized)](#3-bounded-two-tier-memory-cache-vps-2gb-optimized)
  - [4. Autonomous Self-Evolving Codebase Engine (VM Sandbox)](#4-autonomous-self-evolving-codebase-engine-vm-sandbox)
  - [5. Dynamic Multi-Chain Protocol Resolver](#5-dynamic-multi-chain-protocol-resolver)
- [Tech Stack](#tech-stack)
- [Directory Structure](#directory-structure)
- [Environment Variables & Configuration](#environment-variables--configuration)
- [Quick Start & Local Development](#quick-start--local-development)
- [REST API Reference](#rest-api-reference)
  - [Research Endpoints](#research-endpoints)
  - [System & Observability Endpoints](#system--observability-endpoints)
  - [Cache & Browser Pool Management](#cache--browser-pool-management)
  - [CROO CAP Protocol Endpoints](#croo-cap-protocol-endpoints)
- [Testing & Verification](#testing--verification)
- [CROO CAP Protocol Integration](#croo-cap-protocol-integration)
- [License](#license)

---

## Overview & Core Philosophy

Searching for APIs is Ultron's underlying mechanism, while delivering **ultra-valid, grounded, and factual data** is its core mission. Obtaining data directly from backend APIs provides significant advantages in data integrity over standard web scraping:

1. **Raw Unbiased Data Layer**: Standard web pages contain promotional copy, UI layout noise, and SEO-optimized content. Querying backend APIs directly retrieves raw structured JSON/GraphQL payloads straight from the primary database, free from frontend distortion.
2. **Real-Time Data Precision**: For high-precision metrics such as token prices, DeFi TVL, stock yields, and financial benchmarks, rendered web pages often introduce caching delays or rounding. API responses supply exact, real-time data identical to what internal client applications consume.
3. **Elimination of AI Hallucinations**: By binding every generated insight directly to underlying API payload snippets and running multi-domain cross-verification, Ultron eliminates speculative generation.

---

## Architecture Layers

Ultron operates across five distinct operational layers, executing sequentially from fastest to most thorough:

| Layer | Functionality | Description |
|-------|---------------|-------------|
| **Layer 0 — API Discovery** | Endpoint Probing | Locates documented APIs via OpenAPI/Swagger specifications, developer documentation, GraphQL introspection, and well-known endpoint patterns. |
| **Layer 1 — Network Sniffing** | CDP Interception | Spawns a headless browser instance, intercepts network traffic via Chrome DevTools Protocol (CDP), and records active XHR/Fetch API requests. |
| **Layer 2 — Stealth Scrape** | SPA-Aware Fallback | SPA-aware headless scraping fallback with bot-detection evasion mechanisms (Playwright stealth). |
| **Layer 3 — Citation Grounding** | Two-Pass Hybrid Verification | Cross-verifies extracted data, executes two-pass semantic contradiction reasoning, applies confidence penalties, and attaches inline citations. |
| **Layer 4 — JS Bundle Parser** | Reverse Engineering | Downloads and analyzes client-side JavaScript bundles to extract raw internal API endpoints without invoking full browser instances. |

Additionally, a built-in **Knowledge Router** handles pre-configured pathways for cryptocurrency, DeFi (DefiLlama), stock market indices (IHSG), commodities (Gold API), multi-chain wallet tracking, and global news, querying public APIs directly for sub-500ms responses.

---

## Recent Advanced Innovations

### 1. Two-Pass Hybrid Contradiction Engine (Layer 3)
To eliminate conflicting claims across heterogeneous data sources without sacrificing execution speed or inflating token costs:
* **Pass 1 (Fast Heuristic Filter)**: Scans findings using entity overlap and polarity negation checks to isolate candidate contradictory pairs in **0ms latency**.
* **Pass 2 (Targeted LLM Reasoning)**: Dispatches candidate pairs to an LLM verification prompt to determine true semantic contradiction.
* **Confidence Adjustments**: Confirmed contradictions trigger an automated **30% confidence penalty** (e.g., `0.58` → `0.406`) and flag the findings with explicit `[ALERT CONTRADICTION]` metadata explanations in the final report.

### 2. Target Deep-Drill Pipeline
To ensure search engines (such as Tavily) do not become the single source of truth:
* Tavily/DuckDuckGo search queries serve strictly as **initial address pointers** to discover official domains and target URLs.
* Once URLs are identified, Ultron immediately triggers **Target Deep-Drill**, spawning Layer 0 API discovery and Layer 1 CDP network sniffing directly on the target sites to extract raw backend APIs and fetch 1:1 JSON payloads.

### 3. Bounded Two-Tier Memory Cache (VPS 2GB Optimized)
Engineered specifically for low-resource environments (e.g., 2GB VPS or light cloud instances):
* **L1 In-Memory RAM Cache**: Bounded LRU cache capped at **500 active endpoints** (~50MB RAM ceiling) providing sub-millisecond lookups (`<0.1ms`).
* **L2 SQLite Disk Persistence**: Full endpoint history is asynchronously synchronized to a WAL-enabled SQLite database (`better-sqlite3`), preventing Out-Of-Memory (OOM) crashes while preserving persistent domain learning.

### 4. Autonomous Self-Evolving Codebase Engine (VM Sandbox)
When target backend APIs undergo breaking changes or endpoint deprecations:
* **Failure Analysis**: Captures API error causes and endpoint degradation events at runtime.
* **JS Code Synthesis**: Generates replacement adapter functions and fallback endpoint transformations.
* **Isolated VM Testing**: Executes synthesized adapter patches inside an isolated Node.js `node:vm` sandbox context to verify runtime recovery.
* **Live Hot-Swapping**: Upon successful sandbox verification, dynamically registers the new adapter in runtime memory without restarting the server process.

### 5. Dynamic Multi-Chain Protocol Resolver
Extends knowledge resolution across decentralized networks:
* **Dynamic RPC Registry (`ChainRegistry`)**: Manages real-time RPC node connectivity for Base Mainnet, Ethereum, Arbitrum, Solana, and Hyperliquid L1.
* **Universal Resolver (`UniversalResolver`)**: Inspects entity queries and resolves multi-chain wallet positions, DEX protocol states, and trader analytics across multiple blockchains simultaneously.

---

## Tech Stack

* **Runtime**: Node.js v18+ (ES Modules)
* **Language**: TypeScript 5.5+
* **HTTP & API Server**: Express 4, Axios, Pino Logger
* **Browser Automation**: Playwright 1.50+ (Stealth Mode CDP)
* **Database & Cache**: `better-sqlite3` with WAL mode
* **Validation & Types**: Zod, TypeScript
* **Testing**: Vitest
* **Decentralized Protocol**: `@croo-network/sdk` (CROO Agent Marketplace on Base)

---

## Directory Structure

```
deep-research-agent/
├── data/                      # SQLite cache storage (endpoints.db)
├── src/
│   ├── agent/                 # Self-healing Evolution Engine & Static Code Analyzer
│   │   ├── code-builder.ts    # Static Code Analyzer Engine
│   │   └── evolution.ts       # VM Sandbox Autonomous Adapter Self-Healing
│   ├── browser/               # Playwright browser pool & CDP sniffer
│   ├── cache/                 # Bounded two-tier endpoint cache (L1 RAM + L2 SQLite)
│   ├── cap/                   # CROO CAP protocol integration wrapper
│   ├── credentials/           # Domain API credential store
│   ├── knowledge/             # Sub-500ms Knowledge Router & Multi-Chain Resolver
│   │   ├── chain-registry.ts  # Dynamic Multi-Chain RPC Node Registry
│   │   ├── router.ts          # Knowledge Router for financial/crypto APIs
│   │   └── universal-resolver.ts # Cross-chain wallet & protocol resolver
│   ├── layers/                # Core 5-Layer Engine Architecture
│   │   ├── layer0-discovery.ts      # OpenAPI & pattern discovery
│   │   ├── layer1-sniffing.ts       # CDP network traffic sniffer
│   │   ├── layer2-scrape.ts         # Stealth Playwright scraper
│   │   ├── layer3-grounding.ts      # Hybrid Contradiction & Grounding
│   │   └── layer4-bundle-parser.ts  # Client-side JS bundle parser
│   ├── pipeline/              # Orchestrator, Decomposer, Verifier, Synthesizer, Validity Engine
│   │   ├── decomposer.ts      # LLM & heuristic query decomposer
│   │   ├── orchestrator.ts    # Main pipeline execution orchestrator
│   │   ├── synthesizer.ts     # Research summary synthesizer
│   │   ├── validity.ts        # Validity Engine & query verification audit
│   │   └── verifier.ts        # Evidence verification engine
│   ├── utils/                 # HTTP client, logger, helper utilities
│   ├── config.ts              # System configuration loader
│   ├── index.ts               # CLI & application entry point
│   ├── server.ts              # REST API Express server
│   └── types.ts               # Core TypeScript interfaces & Zod schemas
├── demo.mjs                   # Interactive demonstration script
├── package.json               # Dependencies & scripts
├── tsconfig.json              # TypeScript compiler configuration
└── README.md                  # Project documentation
```

---

## Environment Variables & Configuration

Copy `.env.example` to `.env` and adjust the variables accordingly:

```bash
cp .env.example .env
```

| Variable | Description | Default / Example |
|----------|-------------|-------------------|
| `PORT` | HTTP REST API server port | `3001` |
| `HOST` | HTTP REST API binding host | `0.0.0.0` |
| `LLM_API_KEY` | OpenAI-compatible API key for decomposition & reasoning | `sk-...` |
| `LLM_BASE_URL` | Base URL for LLM completions | `https://api.openai.com/v1` |
| `LLM_MODEL` | LLM model identifier | `gpt-4o` |
| `TAVILY_API_KEY` | Tavily Search API key for initial domain discovery | `tvly-...` |
| `BROWSER_HEADLESS` | Run Playwright in headless mode | `true` |
| `BROWSER_TIMEOUT` | Timeout in milliseconds for browser navigation & operations | `30000` |
| `STEalth_MODE` | Enable bot-detection evasion in browser | `true` |
| `CACHE_DB_PATH` | Path to SQLite endpoint database | `./data/endpoints.db` |
| `CACHE_TTL_HOURS` | Retention period for cached API endpoints (in hours) | `720` |
| `MAX_CONCURRENT_DOMAINS` | Maximum concurrent domain scrapers allowed | `5` |
| `REQUEST_DELAY_MS` | Throttle delay between outbound HTTP requests (in ms) | `500` |
| `CROO_ENABLED` | Enable CROO CAP agent marketplace network | `false` |
| `CROO_API_URL` | CROO Network API gateway URL | `https://api.croo.network` |
| `CROO_WS_URL` | CROO Network WebSocket signaling URL | `wss://api.croo.network/ws` |
| `CROO_SDK_KEY` | CROO network SDK authentication key | `croo_sk_...` |
| `ULTRON_API_KEY` | (Optional) Bearer token security header for `/research` endpoints | `my-secret-key` |

---

## Quick Start & Local Development

### 1. Clone & Install Dependencies

```bash
git clone https://github.com/Mzhvnn-tch/ultron.git
cd ultron
npm install
```

### 2. Run Development Server

Start the development server with automatic reloading via `tsx`:

```bash
npm run dev
```

### 3. Execute Demo / Queries

Run the interactive demo script:

```bash
npm run demo
```

Or run a direct query test using `tsx`:

```bash
npx tsx -e '
import { getOrchestrator } from "./src/pipeline/orchestrator.js";
const result = await getOrchestrator().research({ query: "Berapa dividend yield BBCA?" });
console.log(result.summary);
'
```

---

## REST API Reference

Ultron exposes a full REST API for programmatic research invocation, internal state monitoring, and agent-to-agent integration.

### Research Endpoints

#### `POST /research`
Executes a full 5-layer autonomous research cycle.

* **Request Body**:
```json
{
  "query": "Berapa harga BBM Pertalite hari ini di Indonesia?",
  "maxDepth": 2,
  "maxSources": 5,
  "preferApi": true,
  "language": "id"
}
```
* **Response**: Returns summary, detailed evidence findings, confidence metrics, and duration.

#### `POST /research/quick`
Executes a lightweight research cycle capped at lower depth and source counts for rapid response times.

* **Request Body**: Same schema as `/research`.

#### `POST /research/deep`
Performs deep client-side JavaScript bundle parsing ([layer4-bundle-parser.ts](file:///home/ubuntu/deep-research-agent/src/layers/layer4-bundle-parser.ts)), extracts hidden API endpoints, and immediately queries top backend targets directly.

* **Request Body**:
```json
{
  "domain": "https://example.com",
  "query": "Extract user metrics"
}
```

#### `POST /research/verify`
Triggers the `ValidityEngine` ([validity.ts](file:///home/ubuntu/deep-research-agent/src/pipeline/validity.ts)) to decompose complex queries and execute a formal factual verification audit report.

* **Request Body**:
```json
{
  "query": "Apakah Inflation Rate US turun bulan ini?"
}
```

---

### System & Observability Endpoints

#### `GET /health`
Returns system status, process uptime, L1/L2 cache statistics, and CROO network status.

#### `GET /metrics`
Prometheus-compatible observability endpoint reporting real-time system metrics:
* `ultron_uptime_seconds`
* `ultron_memory_heap_used_bytes`
* `ultron_cached_endpoints_total`

#### `GET /audit/codebase`
Triggers the Safe Static Code Analyzer Engine ([code-builder.ts](file:///home/ubuntu/deep-research-agent/src/agent/code-builder.ts)) to audit repository TypeScript files for potential bottlenecks, unsafe parsing, and architectural recommendations without disk mutation risks.

---

### Cache & Browser Pool Management

* **`GET /cache/stats`**: Returns L1 in-memory RAM cache usage and L2 SQLite disk database totals.
* **`GET /cache/domains`**: Returns an array of all unique domains currently stored in cache.
* **`GET /cache/domain/:domain`**: Retrieves all cached API endpoints and metadata for a specific domain.
* **`GET /pool/stats`**: Reports active and idle browser instances in the Playwright pool.

---

### CROO CAP Protocol Endpoints

*(Active when `CROO_ENABLED=true`)*

* **`GET /cap/identity`**: Returns the agent's Decentralized Identifier (DID) and public keys on Base Mainnet.
* **`POST /cap/order`**: Endpoint for receiving and processing decentralized research requests from peer agents.

---

## Production & Operational Hardening Features

* **Live WebSocket Frame Interception**: Layer 1 Network Sniffing captures real-time WebSocket JSON streams (`page.on('websocket')`) for financial market orderbooks and tick streams.
* **Universal LLM Provider Abstraction**: Dynamic provider switching supporting OpenAI, Anthropic (Claude), Google Gemini, and local Ollama models via `LLMProvider`.
* **Exponential Backoff Resilience**: Built-in network retry wrapper (`withExponentialBackoff`) protecting network requests against transient rate-limits and network hiccups.
* **Sequential Concurrency Throttling**: Memory-safe sequential loop execution preventing unthrottled browser spawn surges.
* **API Key Authorization Middleware**: Configurable security header verification (`Authorization: Bearer <ULTRON_API_KEY>`) securing `/research` endpoints.
* **Containerized Docker Deployment**: Multi-stage production [Dockerfile](file:///home/ubuntu/deep-research-agent/Dockerfile) ready for Kubernetes and cloud container services.

---

## Testing & Verification

Run the test suite powered by **Vitest**:

```bash
npm test
```

To validate TypeScript compilation without emitting files:

```bash
npx tsc --noEmit
```

---

## CROO CAP Protocol Integration

Ultron is natively instrumented with the **CROO CAP Protocol** (`@croo-network/sdk`). When enabled (`CROO_ENABLED=true`), Ultron registers itself on Base Mainnet as a discoverable, autonomous research agent. Other agents in the CROO network can query Ultron, negotiate task execution, and settle micro-payments on-chain via smart contracts.

---

## License

Distributed under the **MIT License**. See [LICENSE](file:///home/ubuntu/deep-research-agent/LICENSE) for more information.

Copyright (c) 2026 Ultron Contributors.
