# Ultron

[![Node.js CI](https://img.shields.io/badge/node.js-v18%2B-blue.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.5-blue.svg)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Network](https://img.shields.io/badge/Network-Base%20Mainnet-blue)](https://base.org)
[![Protocol](https://img.shields.io/badge/Protocol-CROO%20CAP-green)](https://croo.network)

**Ultron** is an autonomous, multi-layer deep research engine designed for the **CROO Agent Marketplace** on Base Mainnet. Unlike conventional web research tools that rely purely on rendered HTML text summaries, Ultron reverse-engineers the underlying backend data layer of target websites. It locates documented and internal APIs, queries them directly for raw structured JSON payloads, cross-verifies facts using a two-pass hybrid reasoning engine, and delivers grounded answers backed by 1:1 factual evidence.

---

## 📋 Table of Contents

- [Overview & Core Philosophy](#overview--core-philosophy)
- [Architecture Layers](#architecture-layers)
- [Recent Advanced Innovations](#recent-advanced-innovations)
  - [1. Two-Pass Hybrid Contradiction Engine (Layer 3)](#1-two-pass-hybrid-contradiction-engine-layer-3)
  - [2. Target Deep-Drill Pipeline](#2-target-deep-drill-pipeline)
  - [3. Bounded Two-Tier Memory Cache (VPS 2GB Optimized)](#3-bounded-two-tier-memory-cache-vps-2gb-optimized)
- [Tech Stack](#tech-stack)
- [Directory Structure](#directory-structure)
- [Environment Variables & Configuration](#environment-variables--configuration)
- [Quick Start & Local Development](#quick-start--local-development)
- [REST API Reference](#rest-api-reference)
- [Testing & Verification](#testing--verification)
- [CROO CAP Protocol Integration](#croo-cap-protocol-integration)
- [License](#license)

---

## 💡 Overview & Core Philosophy

Searching for APIs is Ultron's underlying mechanism, while delivering **ultra-valid, grounded, and factual data** is its core mission. Obtaining data directly from backend APIs provides significant advantages in data integrity over standard web scraping:

1. **Raw Unbiased Data Layer**: Standard web pages contain promotional copy, UI layout noise, and SEO-optimized content. Querying backend APIs directly retrieves raw structured JSON/GraphQL payloads straight from the primary database, free from frontend distortion.
2. **Real-Time Data Precision**: For high-precision metrics such as token prices, DeFi TVL, stock yields, and financial benchmarks, rendered web pages often introduce caching delays or rounding. API responses supply exact, real-time data identical to what internal client applications consume.
3. **Elimination of AI Hallucinations**: By binding every generated insight directly to underlying API payload snippets and running multi-domain cross-verification, Ultron eliminates speculative generation.

---

## 🏗️ Architecture Layers

Ultron operates across five distinct operational layers, executing sequentially from fastest to most thorough:

| Layer | Functionality | Description |
|-------|---------------|-------------|
| **Layer 0 — API Discovery** | Endpoint Probing | Locates documented APIs via OpenAPI/Swagger specifications, developer documentation, GraphQL introspection, and well-known endpoint patterns. |
| **Layer 1 — Network Sniffing** | CDP Interception | Spawns a headless browser instance, intercepts network traffic via Chrome DevTools Protocol (CDP), and records active XHR/Fetch API requests. |
| **Layer 2 — Stealth Scrape** | SPA-Aware Fallback | SPA-aware headless scraping fallback with bot-detection evasion mechanisms (Playwright stealth). |
| **Layer 3 — Citation Grounding** | Two-Pass Hybrid Verification | Cross-verifies extracted data, executes two-pass semantic contradiction reasoning, applies confidence penalties, and attaches inline citations. |
| **Layer 4 — JS Bundle Parser** | Reverse Engineering | Downloads and analyzes client-side JavaScript bundles to extract raw internal API endpoints without invoking full browser instances. |

Additionally, a built-in **Knowledge Router** handles pre-configured pathways for cryptocurrency, DeFi (DefiLlama), stock market indices (IHSG), commodities (Gold API), and global news, querying public APIs directly for sub-500ms responses.

---

## 🚀 Recent Advanced Innovations

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

---

## 🛠️ Tech Stack

* **Runtime**: Node.js v18+ (ES Modules)
* **Language**: TypeScript 5.5+
* **HTTP & API Server**: Express 4, Axios, Pino Logger
* **Browser Automation**: Playwright 1.50+ (Stealth Mode CDP)
* **Database & Cache**: `better-sqlite3` with WAL mode
* **Validation & Types**: Zod, TypeScript
* **Testing**: Vitest
* **Decentralized Protocol**: `@croo-network/sdk` (CROO Agent Marketplace on Base)

---

## 📁 Directory Structure

```
deep-research-agent/
├── data/                      # SQLite cache storage (endpoints.db)
├── src/
│   ├── browser/               # Playwright browser pool & CDP sniffer
│   ├── cache/                 # Bounded two-tier endpoint cache (L1 RAM + L2 SQLite)
│   ├── cap/                   # CROO CAP protocol integration wrapper
│   ├── credentials/           # Domain API credential store
│   ├── knowledge/             # Sub-500ms Knowledge Router (DeFi, Stocks, Crypto)
│   ├── layers/                # Core 5-Layer Engine Architecture
│   │   ├── layer0-discovery.ts      # OpenAPI & pattern discovery
│   │   ├── layer1-sniffing.ts       # CDP network traffic sniffer
│   │   ├── layer2-scrape.ts         # Stealth Playwright scraper
│   │   ├── layer3-grounding.ts      # Hybrid Contradiction & Grounding
│   │   └── layer4-bundle-parser.ts  # Client-side JS bundle parser
│   ├── pipeline/              # Orchestrator, Decomposer, Verifier, Synthesizer
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

## ⚙️ Environment Variables & Configuration

Copy `.env.example` to `.env` and adjust the variables accordingly:

```bash
cp .env.example .env
```

| Variable | Description | Default / Example |
|----------|-------------|-------------------|
| `PORT` | HTTP REST API server port | `3002` |
| `HOST` | HTTP REST API binding host | `0.0.0.0` |
| `LLM_API_KEY` | OpenAI-compatible API key for decomposition & reasoning | `sk-...` |
| `LLM_BASE_URL` | Base URL for LLM completions | `https://api.openai.com/v1` |
| `LLM_MODEL` | LLM model identifier | `gpt-4o` |
| `TAVILY_API_KEY` | Tavily Search API key for initial domain discovery | `tvly-...` |
| `BROWSER_HEADLESS` | Run Playwright in headless mode | `true` |
| `STEALTH_MODE` | Enable bot-detection evasion in browser | `true` |
| `CACHE_DB_PATH` | Path to SQLite endpoint database | `./data/endpoints.db` |
| `CROO_ENABLED` | Enable CROO CAP agent marketplace network | `true` |
| `CROO_SDK_KEY` | CROO network SDK authentication key | `croo_sk_...` |

---

## 🚀 Quick Start & Local Development

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

## 📑 REST API Reference

Ultron exposes a full REST API for programmatic research invocation and agent-to-agent integration.

### `POST /research`
Executes a full 5-layer autonomous research cycle.

**Request Body:**
```json
{
  "query": "Berapa harga BBM Pertalite hari ini di Indonesia?",
  "maxDepth": 2,
  "maxSources": 5,
  "preferApi": true,
  "language": "id"
}
```

**Response:**
```json
{
  "id": "4497e296-85dd-47e1-ae41-2aedefee7945",
  "originalQuery": "Berapa harga BBM Pertalite hari ini di Indonesia?",
  "summary": "Berdasarkan hasil penelusuran resmi...",
  "findings": [
    {
      "id": "claim-1",
      "claim": "Harga BBM subsidi Pertalite sebesar Rp 10.000 per liter.",
      "confidence": 0.58,
      "sourceUrls": ["https://mypertamina.id"]
    }
  ],
  "qualityScore": 0.85,
  "durationMs": 3200
}
```

### `GET /health`
Returns system status, uptime, L1/L2 cache statistics, and CROO network state.

---

## 🧪 Testing & Verification

Run the test suite powered by **Vitest**:

```bash
npm test
```

To validate TypeScript compilation without emitting files:

```bash
npx tsc --noEmit
```

---

## 🌐 CROO CAP Protocol Integration

Ultron is natively instrumented with the **CROO CAP Protocol** (`@croo-network/sdk`). When enabled (`CROO_ENABLED=true`), Ultron registers itself on Base Mainnet as a discoverable, autonomous research agent. Other agents in the CROO network can query Ultron, negotiate task execution, and settle micro-payments on-chain via smart contracts.

---

## 📜 License

Distributed under the **MIT License**. See [LICENSE](file:///home/ubuntu/deep-research-agent/LICENSE) for more information.

Copyright (c) 2026 Ultron Contributors.
