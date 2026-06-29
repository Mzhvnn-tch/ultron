import { describe, it, expect } from "vitest";
import { getChainRegistry } from "../knowledge/chain-registry.js";
import { getUniversalResolver } from "../knowledge/universal-resolver.js";
import { getVerifier } from "./verifier.js";
import { StaticCodeAnalyzerEngine } from "../agent/code-builder.js";

describe("Multi-Layer Pipeline Integration Suite", () => {
  it("should initialize ChainRegistry with dynamic multi-chain nodes", () => {
    const registry = getChainRegistry();
    const chains = registry.getAllChains();
    expect(chains.length).toBeGreaterThanOrEqual(4);
    expect(chains.some((c) => c.id === "ethereum")).toBe(true);
    expect(chains.some((c) => c.id === "hyperliquid")).toBe(true);
  });

  it("should resolve dynamic multi-chain entity profile via UniversalResolver", async () => {
    const resolver = getUniversalResolver();
    const profile = await resolver.resolveEntity("posisi wallet trader Bizyugo");

    expect(profile.targetName).toBe("Bizyugo");
    expect(profile.verifiedAddresses.length).toBeGreaterThan(0);
  });

  it("should execute verification audit without throwing errors", async () => {
    const verifier = getVerifier();
    const mockFindings = [
      {
        id: "f1",
        claim: "Bitcoin total market cap reached $2 Trillion in 2026.",
        confidence: 0.95,
        sourceUrls: ["https://blockchain.info"],
        evidence: [
          {
            text: "Market cap verified at $2 Trillion",
            sourceUrl: "https://blockchain.info",
            sourceTitle: "Blockchain Info Node",
            relevance: 1.0,
            extractedAt: Date.now(),
          },
        ],
      },
    ];
    const mockCitations = [
      {
        id: "c1",
        index: 1,
        url: "https://blockchain.info",
        title: "Blockchain Info Node",
        snippet: "Verified node data",
        relevance: 1.0,
        relevanceScore: 1.0,
      },
    ];

    const result = verifier.verify(mockFindings, mockCitations);
    expect(result.verifiedFindings.length).toBe(1);
  });

  it("should run StaticCodeAnalyzer safely without disk mutations", async () => {
    const analyzer = new StaticCodeAnalyzerEngine();
    const report = await analyzer.auditCodebase();

    expect(report.totalFilesScanned).toBeGreaterThan(10);
    expect(report.bottlenecksFound).toBeInstanceOf(Array);
  });
});
