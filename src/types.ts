import { z } from "zod";

// ─── Query ────────────────────────────────────────────────────

export const ResearchQuery = z.object({
  query: z.string().min(1).max(1000),
  maxDepth: z.number().int().min(1).max(5).default(3),
  maxSources: z.number().int().min(1).max(20).default(10),
  domains: z.array(z.string()).optional(),
  preferApi: z.boolean().default(true),
  language: z.string().default("en"),
});
export type ResearchQuery = z.infer<typeof ResearchQuery>;

// ─── Discovered API Endpoint ───────────────────────────────────

export interface WasmMetadata {
  moduleUrl?: string;
  exportedFunctions?: string[];
  heapMemoryOffsets?: number[];
  signatureHeaders?: Record<string, string>;
  extractedUrls?: string[];
  decompiledSnippet?: string;
}

export interface DiscoveredEndpoint {
  url: string;
  method: "GET" | "POST" | "PUT" | "DELETE";
  params?: Record<string, string>;
  headers?: Record<string, string>;
  bodyTemplate?: Record<string, unknown>;
  authType?: "none" | "bearer" | "api-key" | "basic" | "oauth2" | "wasm-signature";
  authDetails?: {
    headerName?: string;
    tokenHint?: string;
  };
  description?: string;
  responseExample?: unknown;
  /** Where this was discovered from */
  source: "openapi-spec" | "docs-page" | "network-sniff" | "common-pattern" | "well-known" | "layer1-wasm" | "layer4-wasm" | string;
  confidence: number; // 0–1
  discoveredAt: number;
  lastUsedAt?: number;
  successCount: number;
  failCount: number;
  wasmMetadata?: WasmMetadata;
}

// ─── Research Step ─────────────────────────────────────────────

export type StepStatus = "pending" | "discovering" | "fetching" | "analyzing" | "done" | "failed";

export interface ResearchStep {
  id: string;
  query: string;
  status: StepStatus;
  /** Sub-queries decomposed from the original query */
  subQueries: string[];
  /** API endpoints discovered for this step */
  discoveredEndpoints: DiscoveredEndpoint[];
  /** Endpoints actually used (successfully) */
  usedEndpoints: DiscoveredEndpoint[];
  /** Network-sniffed endpoints from headless browser */
  sniffedEndpoints: DiscoveredEndpoint[];
  /** Scraped page data (fallback) */
  scrapedData: ScrapedPage[];
  /** Synthesized findings from this step */
  findings: Finding[];
  error?: string;
  startedAt: number;
  finishedAt?: number;
}

// ─── Scraped Page ──────────────────────────────────────────────

export interface ScrapedPage {
  url: string;
  title: string;
  content: string; // cleaned text
  htmlLength: number;
  /** Key data points extracted */
  extractedData: Record<string, unknown>;
  /** Screenshot if available */
  screenshotPath?: string;
  fetchedAt: number;
}

// ─── Finding ───────────────────────────────────────────────────

export interface Finding {
  id: string;
  claim: string;
  evidence: Evidence[];
  confidence: number; // 0–1
  sourceUrls: string[];
  isContradictory?: boolean;
  contradictionReason?: string;
  isStale?: boolean;
  varianceWarning?: string;
}

export interface Evidence {
  text: string;
  sourceUrl: string;
  sourceTitle: string;
  relevance: number; // 0–1
  extractedAt: number;
}

// ─── Final Research Result ─────────────────────────────────────

export interface ResearchResult {
  id: string;
  originalQuery: string;
  summary: string;
  findings: Finding[];
  steps: ResearchStep[];
  citations: Citation[];
  /** Endpoint cache that was built/updated during this research */
  discoveredApiEndpoints: DiscoveredEndpoint[];
  /** Total time spent */
  durationMs: number;
  startedAt: number;
  finishedAt: number;
  /** Number of sources consulted */
  totalSources: number;
  /** Domains visited */
  domainsVisited: string[];
}

export interface Citation {
  index: number;
  url: string;
  title: string;
  snippet: string;
  relevanceScore: number;
}

// ─── CAP Protocol Types ────────────────────────────────────────

export interface CapOrder {
  orderId: string;
  buyerDid: string;
  buyerWallet: string;
  capabilityId: string;
  params: ResearchQuery;
  price: string; // in wei or token units
  token: string;
  status: "negotiate" | "locked" | "delivered" | "cleared" | "disputed";
  createdAt: number;
  deadline: number;
}

export interface CapDelivery {
  orderId: string;
  resultHash: string; // keccak256 of result JSON
  resultUri: string; // IPFS or HTTP URI to full result
  proof: {
    timestamp: number;
    agentDid: string;
    signature: string;
  };
}

// ─── Agent Identity ────────────────────────────────────────────

export interface AgentIdentity {
  did: string;
  walletAddress: string;
  publicKey: string;
  capabilities: AgentCapability[];
  registeredAt: number;
}

export interface AgentCapability {
  id: string;
  name: string;
  description: string;
  price: string;
  token: string;
  maxInputLength: number;
  estimatedDuration: number; // ms
}

// ─── Knowledge Graph & Vector Memory ────────────────────────────

export interface KnowledgeEntity {
  id: string;
  name: string;
  type: string; // e.g. "token", "protocol", "metric", "company", "concept"
  description?: string;
  metadata?: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export interface KnowledgeTriple {
  id: string;
  subjectId: string;
  predicate: string; // e.g. "depends_on", "provides_liquidity", "competes_with", "has_price"
  objectId: string;
  confidence: number;
  sourceQuery?: string;
  createdAt: number;
}

export interface VectorMemoryItem {
  id: string;
  claim: string;
  vector: number[];
  entityIds: string[];
  sourceUrl?: string;
  createdAt: number;
}

// ─── Self-Evolution Engine ──────────────────────────────────────

export interface EvolutionLog {
  id: string;
  domain: string;
  failedEndpointUrl: string;
  errorCause: string;
  synthesizedPatchCode?: string;
  sandboxTestStatus: "passed" | "failed" | "skipped";
  hotSwappedAt?: number;
  createdAt: number;
}

// ─── Universal Entity & Asset Resolver Engine ───────────────────

export interface FinancialAsset {
  symbol: string;
  assetType: "stock" | "crypto_token" | "perp_position" | "bond" | "commodity";
  chainOrExchange: string; // Dynamic universal string supporting any global exchange, EVM/non-EVM blockchain or DEX
  balanceOrShares: number;
  valueUsd: number;
  confidence: number;
}

export interface CorporateEntity {
  companyName: string;
  role: string; // e.g. "Founder", "CEO", "Major Shareholder", "Board Member"
  equityPercentage?: number;
  jurisdiction?: string;
}

export interface UniversalEntityProfile {
  targetName: string;
  category: "trader" | "executive" | "institution" | "individual";
  verifiedAddresses: string[];
  tradfiAssets: FinancialAsset[];
  web3Positions: FinancialAsset[];
  corporateAffiliations: CorporateEntity[];
  overallConfidence: number;
}
