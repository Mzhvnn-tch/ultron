# Ultron

[![Node.js CI](https://img.shields.io/badge/node.js-v18%2B-blue.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue.svg)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Network](https://img.shields.io/badge/Network-Base%20Mainnet-blue)](https://base.org)
[![Protocol](https://img.shields.io/badge/Protocol-CROO%20CAP-green)](https://croo.network)

Autonomous deep research agent that discovers and talks directly to APIs, bypasses frontend UIs, and delivers grounded answers with citations. Built for the CROO Agent Marketplace on Base.

---

## Table of Contents

- [Overview](#overview)
- [Core Philosophy: API-First for Maximum Data Validity](#core-philosophy-api-first-for-maximum-data-validity)
- [Data Verification Engine](#data-verification-engine)
- [Architecture Layers](#architecture-layers)
- [Use Cases](#use-cases)
- [Quick Start](#quick-start)
- [Usage](#usage)
  - [Interactive CLI](#interactive-cli)
  - [Single Query CLI](#single-query-cli)
- [REST API](#rest-api)
  - [POST /research](#post-research--full-research)
  - [POST /research/quick](#post-researchquick--fast-research)
  - [POST /research/deep](#post-researchdeep--js-bundle-api-extraction)
  - [POST /research/verify](#post-researchverify--fact-verification)
  - [Utility Endpoints](#utility-endpoints)
- [CROO CAP Protocol](#croo-cap-protocol-agent-to-agent-marketplace)
- [Architecture Diagram](#architecture-diagram)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Performance Notes](#performance-notes)
- [Security & Compliance](#security--compliance)
- [License](#license)

---

## Overview

Ultron is an AI-powered research engine that does not rely solely on HTML web scraping. Instead, it reverse-engineers the underlying data layer behind target websites. When processing a request, Ultron locates relevant public and internal APIs, queries them directly for raw structured data, cross-verifies findings across multiple independent sources, and synthesizes grounded responses complete with authoritative source citations.

---

## Core Philosophy: API-First for Maximum Data Validity

Searching for APIs is Ultron's underlying mechanism, while delivering ultra-valid, grounded, and factual data is its core mission. Obtaining data directly from backend APIs provides significant advantages in data integrity over standard web scraping:

1. **Raw Unbiased Data Layer**: Standard web pages contain promotional copy, UI layout noise, and SEO-optimized content. Querying backend APIs directly retrieves raw structured JSON/GraphQL payloads straight from the primary database, free from frontend distortion.
2. **Real-Time Data Precision**: For high-precision metrics such as token prices, DeFi TVL, and financial benchmarks, rendered web pages often introduce caching delays or rounding. API responses supply exact, real-time data identical to what internal client applications consume.
3. **Elimination of AI Hallucinations**: By binding every generated insight directly to underlying API payload snippets, Ultron eliminates speculative generation and ensures factual accuracy.

---

## Data Verification Engine

Ultron enforces rigorous data verification protocols before delivering any synthesized report to ensure maximum data validity:

- **Evidence Tracking**: Every individual claim is explicitly mapped to raw evidence snippets and source URLs. Any claim lacking verifiable evidence is automatically discarded.
- **Cross-Source Validation**: Findings undergo multi-domain verification. Claims originating from a single domain are flagged, and their confidence scores are adjusted accordingly to prevent single-source bias.
- **Automated Contradiction Detection**: When conflicting data points emerge across different sources, Ultron detects the inconsistency, flags the contradiction in the final output, and adjusts overall reliability metrics.
- **Quantitative Quality Scoring**: Every research output is evaluated against an algorithmic quality index (0.0 to 1.0) based on source diversity, evidence density, and verification warnings.

---

## Architecture Layers

Ultron operates across five distinct layers, executing sequentially from fastest to most thorough:

| Layer | Functionality |
|-------|---------------|
| **Layer 0 — API Discovery** | Locates documented APIs via OpenAPI specifications, developer documentation, and well-known endpoint patterns. |
| **Layer 1 — Network Sniffing** | Spawns a headless browser instance, intercepts network traffic via CDP, and records active API requests. |
| **Layer 2 — Stealth Scrape** | SPA-aware headless scraping fallback with bot-detection evasion mechanisms. |
| **Layer 3 — Citation Grounding** | Cross-verifies extracted data, identifies contradictions, and attaches inline source citations. |
| **Layer 4 — JS Bundle Parser** | Downloads and analyzes client-side JavaScript bundles to extract raw internal API endpoints without invoking full browser instances. |

Additionally, a built-in **Knowledge Router** handles pre-configured pathways for cryptocurrency, DeFi, financial market data, and tech news, querying public APIs directly for sub-500ms responses.

---

## Use Cases

- **Crypto & DeFi**: Fetch real-time token pricing, TVL metrics, yield rates, and gas fees directly from services like CoinGecko, DefiLlama, and Etherscan.
- **Finance**: Retrieve live stock prices, foreign exchange rates, and commodity market data.
- **News & Technology**: Aggregate global headlines, explore GitHub repository data, and index technical documentation.
- **API Reverse Engineering**: Parse client-side JavaScript bundles to extract undocumented API endpoints and authentication patterns.
- **Fact Verification**: Verify assertions against multiple data sources with automated contradiction detection.

---

## Quick Start

### 1. Clone & Install

```bash
git clone https://github.com/Mzhvnn-tch/ultron.git
cd ultron
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
```

Edit parameters in `.env`:

```env
# Required: LLM for query decomposition & synthesis
LLM_API_KEY=sk-...
LLM_BASE_URL=https://api.openai.com/v1   # Any OpenAI-compatible API
LLM_MODEL=gpt-4o

# Optional: Server configuration
PORT=3002
```

> Note: The agent can run without an LLM API key using heuristic synthesis fallback. Providing an LLM API key enables advanced query decomposition and higher quality summaries.

### 3. Run Server

```bash
npm run dev
```

The HTTP server will start on `http://localhost:3002`:

```
Ultron server started { host: '0.0.0.0', port: 3002 }
```

---

## Usage

### Interactive CLI

Execute interactive research sessions via terminal:

```bash
./research --interactive
```

```
ULTRON — Interactive Mode
  Type 'exit' or 'quit' to leave
  Type 'deep:domain.com' for layer 4 bundle parsing
============================================================

$ current ETH price
$ deep:uniswap.org
$ what is sumopod.com
```

### Single Query CLI

Run single-shot queries directly:

```bash
./research "ETH price and staking yield"
./research "what APIs does github.com expose"
./research "deep:defillama.com"   # Layer 4 bundle parsing mode
```

---

## REST API

### `POST /research` — Full Research

Executes a full multi-layer research workflow.

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

**Response Sample:**

```json
{
  "id": "uuid",
  "summary": "# Research Summary...",
  "findings": [],
  "citations": [],
  "discoveredApiEndpoints": [],
  "durationMs": 4200
}
```

### `POST /research/quick` — Fast Research

Lightweight research execution restricted to depth <= 2 and sources <= 5.

```bash
curl -X POST http://localhost:3002/research/quick \
  -H "Content-Type: application/json" \
  -d '{"query": "bitcoin price"}'
```

### `POST /research/deep` — JS Bundle API Extraction

Reverse-engineers target JavaScript bundles to extract active API endpoints.

```bash
curl -X POST http://localhost:3002/research/deep \
  -H "Content-Type: application/json" \
  -d '{"domain": "uniswap.org", "query": "liquidity pools"}'
```

**Response Payload Attributes:**
- `apiEndpoints`: Extracted API routes tagged with confidence scores.
- `credentials`: Embedded tokens or public keys identified within bundles.
- `curlCommands`: Pre-formatted curl execution strings for discovered endpoints.
- `directApiResults`: Raw JSON responses obtained from direct endpoint queries.
- `authFlow`: Identified authentication header schemes (e.g., Bearer, API Key, signature).

### `POST /research/verify` — Fact Verification

Evaluates specific factual claims against cross-referenced data.

```bash
curl -X POST http://localhost:3002/research/verify \
  -H "Content-Type: application/json" \
  -d '{"query": "is ETH proof of stake?"}'
```

### Utility Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Returns server operational status and cache metrics. |
| `/cache/stats` | GET | Provides SQLite endpoint cache performance statistics. |
| `/cache/domains` | GET | Lists all target domains currently present in cache. |
| `/cache/domain/:domain` | GET | Retrieves cached endpoint specifications for a target domain. |
| `/pool/stats` | GET | Reports active browser pool utilization and instance status. |

---

## CROO CAP Protocol (Agent-to-Agent Marketplace)

Ultron natively supports autonomous discovery and task negotiation via the **CROO CAP protocol** on Base blockchain. External agents can discover Ultron, issue research work orders, settle payments in USDC, and receive verified deliverables on-chain.

To activate marketplace capabilities, configure `.env`:

```env
CROO_ENABLED=true
CROO_API_URL=https://api.croo.network
CROO_WS_URL=wss://api.croo.network/ws
CROO_SDK_KEY=croo_sk_...
```

When enabled, Ultron listens for incoming protocol tasks via WebSocket:
- **Negotiation Event**: Automatically evaluates incoming service requests and generates on-chain orders.
- **Payment Settled**: Triggers the internal research pipeline upon confirmed payment settlement.
- **Fulfillment**: Transmits final research packages to the requester address.

Available on the [CROO Agent Store](https://agent.croo.network).

---

## Architecture Diagram

```
Request
  |
  v
Knowledge Router ---> (Instant response from known public APIs)
  | (No match)
  v
Query Decomposer (LLM)
  |
  v
For each sub-query:
  +-- Layer 0: API Discovery (OpenAPI, documentation, well-known routes)
  |     +-- Query discovered endpoints directly
  +-- Layer 1: Network Sniffing (CDP + headless browser)
  |     +-- Intercept and query captured network calls
  +-- Layer 2: Stealth Scrape (Fallback mechanism)
  +-- (Short-circuit pipeline on successful layer resolution)
  |
  v
Layer 3: Citation Grounding & Contradiction Detection
  |
  v
Verifier & Quality Scoring Engine
  |
  v
Synthesizer (LLM or template engine fallback)
  |
  v
ResearchResult { summary, findings, citations, endpoints }
```

---

## Tech Stack

- **Runtime Environment**: Node.js, TypeScript
- **Web Framework**: Express.js
- **Browser Automation**: Playwright (Stealth Integration)
- **Persistence & Caching**: SQLite (`better-sqlite3`)
- **Schema Validation**: Zod
- **Structured Logging**: Pino
- **LLM Provider Integration**: OpenAI-compatible REST APIs
- **Agent Marketplace Protocol**: CROO CAP Protocol (`@croo-network/sdk`)

---

## Project Structure

```
src/
+-- index.ts               # Application entry point and graceful shutdown logic
+-- server.ts              # Express HTTP route definitions and middlewares
+-- config.ts              # Environment variable parsing and validation
+-- types.ts               # TypeScript interface definitions and Zod schemas
+-- layers/
|   +-- layer0-discovery.ts     # OpenAPI and public documentation discovery
|   +-- layer1-sniffing.ts      # CDP-based network request interception
|   +-- layer2-scrape.ts        # SPA-aware stealth web scraping fallback
|   +-- layer3-grounding.ts     # Data cross-verification and citation linking
|   +-- layer4-bundle-parser.ts # Static JavaScript bundle AST API extraction
+-- pipeline/
|   +-- orchestrator.ts    # Central pipeline workflow controller
|   +-- decomposer.ts      # Query decomposition engine
|   +-- synthesizer.ts     # Final response synthesis module
|   +-- verifier.ts        # Fact checking and validation engine
|   +-- validity.ts        # Result quality scoring engine
+-- knowledge/
|   +-- router.ts          # Static API knowledge base routes
+-- cache/                 # SQLite persistent endpoint storage
+-- browser/               # Playwright browser pool manager
+-- credentials/           # In-memory discovered credentials store
+-- cap/                   # CROO CAP marketplace SDK wrapper
+-- utils/                 # Shared HTTP clients and logger utilities
```

---

## Performance Notes

- **Knowledge Router**: Delivers responses in under 500ms for pre-indexed topics (Crypto, Finance).
- **Layer 0 (API Discovery)**: High speed performance for domains with standardized OpenAPI specs.
- **Layer 4 (Bundle Parser)**: Fast execution with zero browser overhead, scaling with JavaScript bundle sizes.
- **Layer 1 (Network Sniffing)**: Resource-intensive execution utilizing real browser instances.
- **Browser Pool**: Pre-warms Chromium instances at startup to minimize initial request latencies.

---

## Security & Compliance

- **Secrets Protection**: Environment configuration files (`.env`) are excluded from version control.
- **Traffic Management**: Built-in rate limiting parameters (`REQUEST_DELAY_MS`, `MAX_CONCURRENT_DOMAINS`) prevent server overload.
- **Ethical Inspection**: Automated requests identify themselves with standard user-agent signatures and respect target endpoint availability.
- **Credential Storage**: Discovered API keys and tokens reside strictly in volatile memory and are never persisted to disk.

---

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
