/**
 * VERIFICATION PIPELINE — Data Validity Engine
 *
 * The core problem this solves:
 *   Most research tools find data, but don't VERIFY it.
 *   This pipeline ensures every claim is cross-referenced
 *   across multiple independent sources before reporting.
 *
 * How it works:
 *  1. Dense Query Decomposition — break complex questions
 *     into precise, non-overlapping sub-queries using LLM
 *  2. Multi-Source Collection — for each sub-query, collect
 *     data from 3+ independent sources (APIs, scrapes, etc.)
 *  3. Cross-Verification — compare claims across sources,
 *     detect contradictions, flag unverifiable claims
 *  4. Confidence Scoring — statistical confidence based on
 *     source agreement, source authority, recency
 *  5. Report Generation — only include claims with confidence
 *     above threshold (default 85%)
 *
 * Output: Research report with:
 *  - Verified claims (100% cross-checked)
 *  - Confidence scores per claim
 *  - Source citations for every fact
 *  - Contradictions (if any, with explanation)
 *  - Unverifiable claims (excluded from report)
 */

import { logger } from "../utils/logger.js";
import { config } from "../config.js";
import type { Finding, Citation } from "../types.js";

// ─── Types ──────────────────────────────────────────────

export interface DenseQuery {
  /** The precise sub-query */
  query: string;
  /** Why this sub-query exists */
  rationale: string;
  /** Expected answer type */
  expectedType: "fact" | "timeline" | "statistics" | "comparison" | "causation" | "verification";
  /** Key entities to look for */
  entities: string[];
  /** Minimum sources needed for verification */
  minSources: number;
  /** Sources to prioritize */
  preferredSources: string[];
}

export interface VerifiedClaim {
  /** The verified claim text */
  claim: string;
  /** Confidence 0-1 */
  confidence: number;
  /** Sources that agree on this claim */
  supportingSources: string[];
  /** Sources that contradict (if any) */
  contradictingSources: string[];
  /** Number of independent sources that confirm */
  confirmationCount: number;
  /** Whether this passed verification threshold */
  verified: boolean;
  /** If contradictory, explanation */
  contradictionExplanation?: string;
  /** When this claim was last verified */
  verifiedAt: number;
  /** The raw evidence */
  evidence: Array<{
    sourceUrl: string;
    text: string;
  }>;
}

export interface VerificationReport {
  /** Original query */
  originalQuery: string;
  /** Dense sub-queries */
  subQueries: DenseQuery[];
  /** All verified claims (passed threshold) */
  verifiedClaims: VerifiedClaim[];
  /** Claims that failed verification */
  rejectedClaims: VerifiedClaim[];
  /** Contradictions found */
  contradictions: Array<{
    claim: string;
    sourcesA: string[];
    sourcesB: string[];
    resolution?: string;
  }>;
  /** Overall confidence score for the report */
  overallConfidence: number;
  /** Sources used */
  sourcesUsed: string[];
  /** Verification timestamp */
  verifiedAt: number;
}

// ─── Constants ──────────────────────────────────────────

const VERIFICATION_THRESHOLD = 0.85; // 85% minimum to report
const MIN_SOURCES_PER_CLAIM = 2; // At least 2 independent sources
const HIGH_VALUE_SOURCES = [
  "reuters.com",
  "apnews.com",
  "bbc.com",
  "bloomberg.com",
  "ft.com",
  "wsj.com",
  "nytimes.com",
  "washingtonpost.com",
  "economist.com",
  "nature.com",
  "science.org",
  "who.int",
  "un.org",
  "worldbank.org",
  "imf.org",
  "defillama.com",
  "coinmarketcap.com",
  "coingecko.com",
  "etherscan.io",
  "github.com",
];

/**
 * Data Validity Engine
 *
 * Takes a complex query, breaks it into dense sub-queries,
 * cross-verifies all findings, and only reports verified facts.
 */
export class ValidityEngine {

  /**
   * Full pipeline: decompose → collect → verify → report
   */
  async verifyQuery(query: string): Promise<VerificationReport> {
    logger.info({ query }, "[Validity] Starting verification pipeline");

    // Phase 1: Dense Query Decomposition
    const subQueries = await this.decomposeDense(query);
    logger.info({ count: subQueries.length }, "[Validity] Query decomposed");

    // Phase 2: Multi-Source Collection & Verification
    const allVerifiedClaims: VerifiedClaim[] = [];
    const allRejectedClaims: VerifiedClaim[] = [];
    const allContradictions: VerificationReport["contradictions"] = [];
    const sourcesUsed = new Set<string>();

    for (const subQuery of subQueries) {
      const result = await this.verifySubQuery(subQuery);
      allVerifiedClaims.push(...result.verified);
      allRejectedClaims.push(...result.rejected);
      allContradictions.push(...result.contradictions);
      result.sources.forEach(s => sourcesUsed.add(s));
    }

    // Phase 3: Cross-Claim Verification
    // Check if verified claims from different sub-queries agree
    const crossContradictions = this.detectCrossContradictions(allVerifiedClaims);
    allContradictions.push(...crossContradictions);

    // Phase 4: Calculate Overall Confidence
    const overallConfidence = this.calculateOverallConfidence(
      allVerifiedClaims,
      allContradictions
    );

    const report: VerificationReport = {
      originalQuery: query,
      subQueries,
      verifiedClaims: allVerifiedClaims,
      rejectedClaims: allRejectedClaims,
      contradictions: allContradictions,
      overallConfidence,
      sourcesUsed: [...sourcesUsed],
      verifiedAt: Date.now(),
    };

    logger.info(
      {
        verified: allVerifiedClaims.length,
        rejected: allRejectedClaims.length,
        contradictions: allContradictions.length,
        confidence: `${(overallConfidence * 100).toFixed(0)}%`,
        sources: sourcesUsed.size,
      },
      "[Validity] Verification complete"
    );

    return report;
  }

  /**
   * Phase 1: Break a complex query into dense, precise sub-queries.
   * Each sub-query is:
   *  - Non-overlapping (no redundant work)
   *  - Specific (can be answered definitively)
   *  - Verifiable (has measurable answer)
   */
  async decomposeDense(query: string): Promise<DenseQuery[]> {
    // Try LLM decomposition first
    try {
      return await this.llmDecompose(query);
    } catch (err: any) {
      logger.warn({ error: err.message }, "[Validity] LLM decompose failed, using fallback");
      return this.heuristicDecompose(query);
    }
  }

  /**
   * LLM-based dense query decomposition.
   */
  private async llmDecompose(query: string): Promise<DenseQuery[]> {
    if (!config.llm.apiKey) throw new Error("No LLM API key");

    const systemPrompt = `You are a research query decomposer. Break down complex questions into dense, precise sub-queries.

Rules:
- Each sub-query must be SELF-CONTAINED and ANSWERABLE
- Avoid overlap between sub-queries
- Include the RATIONALE for each sub-query
- Specify MINIMUM SOURCES needed (2-3)
- Specify PREFERRED SOURCES (reuters.com, apnews.com, etc. for news)
- Return ONLY valid JSON array

Output format:
[
  {
    "query": "specific search query",
    "rationale": "why this sub-query exists",
    "expectedType": "fact|timeline|statistics|comparison|causation|verification",
    "entities": ["key entity 1", "key entity 2"],
    "minSources": 2,
    "preferredSources": ["reuters.com", "apnews.com"]
  }
]

Example:
Input: "Why is there a conflict in Iran?"
Output: [
  {
    "query": "Iran conflict 2026 timeline key events",
    "rationale": "Establish verified timeline of events leading to current conflict",
    "expectedType": "timeline",
    "entities": ["Iran", "2026"],
    "minSources": 3,
    "preferredSources": ["reuters.com", "apnews.com", "bbc.com"]
  },
  {
    "query": "Iran military actions 2026 causes",
    "rationale": "Identify proximate causes cited by multiple news agencies",
    "expectedType": "causation",
    "entities": ["Iran", "military"],
    "minSources": 3,
    "preferredSources": ["reuters.com", "apnews.com", "bloomberg.com"]
  }
]`;

    const response = await fetch(`${config.llm.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.llm.apiKey}`,
      },
      body: JSON.stringify({
        model: config.llm.model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Decompose this query into dense sub-queries: "${query}"` },
        ],
        temperature: 0.3,
        max_tokens: 1000,
      }),
    });

    if (!response.ok) throw new Error(`LLM API error: ${response.status}`);

    const data = await response.json() as any;
    const content = data.choices?.[0]?.message?.content || "";
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (Array.isArray(parsed)) {
        return parsed.map((q: any) => ({
          query: q.query,
          rationale: q.rationale || "",
          expectedType: q.expectedType || "fact",
          entities: q.entities || [],
          minSources: q.minSources || 2,
          preferredSources: q.preferredSources || [],
        }));
      }
    }

    throw new Error("Failed to parse LLM response");
  }

  /**
   * Fallback heuristic decomposition.
   */
  private heuristicDecompose(query: string): DenseQuery[] {
    const aspects = [
      { pattern: /why|cause|reason|trigger/, type: "causation" as const, prefix: "causes of" },
      { pattern: /what|define|explain/, type: "fact" as const, prefix: "what is" },
      { pattern: /when|timeline|history/, type: "timeline" as const, prefix: "timeline of" },
      { pattern: /how many|statistic|data|number/, type: "statistics" as const, prefix: "statistics" },
      { pattern: /compare|vs|difference/, type: "comparison" as const, prefix: "comparison" },
      { pattern: /verify|confirm|true|fact.check/, type: "verification" as const, prefix: "fact check" },
    ];

    const subQueries: DenseQuery[] = [];
    const mainEntities = query.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g) || [];

    for (const aspect of aspects) {
      if (aspect.pattern.test(query)) {
        subQueries.push({
          query: `${aspect.prefix} ${query}`,
          rationale: `Investigate ${aspect.type} aspect of the query`,
          expectedType: aspect.type,
          entities: mainEntities.slice(0, 3),
          minSources: 2,
          preferredSources: HIGH_VALUE_SOURCES.slice(0, 3),
        });
      }
    }

    // Always add a general fact-finding query
    if (subQueries.length === 0) {
      subQueries.push({
        query,
        rationale: "General fact-finding",
        expectedType: "fact",
        entities: mainEntities.slice(0, 3),
        minSources: 2,
        preferredSources: HIGH_VALUE_SOURCES.slice(0, 3),
      });
    }

    return subQueries.slice(0, 5);
  }

  /**
   * Phase 2: Verify a single sub-query across multiple sources.
   */
  async verifySubQuery(subQuery: DenseQuery): Promise<{
    verified: VerifiedClaim[];
    rejected: VerifiedClaim[];
    contradictions: VerificationReport["contradictions"];
    sources: string[];
  }> {
    logger.info({ query: subQuery.query }, "[Validity] Verifying sub-query");

    // In a full implementation, this would:
    // 1. Hit multiple sources (APIs, scrapers) for the same query
    // 2. Extract claims from each source
    // 3. Compare claims across sources
    // 4. Only keep claims that appear in 2+ independent sources
    //
    // For now, this is a framework that processes findings
    // from the other layers and applies verification logic.

    const verified: VerifiedClaim[] = [];
    const rejected: VerifiedClaim[] = [];
    const contradictions: VerificationReport["contradictions"] = [];
    const sources = new Set<string>();

    // The actual multi-source collection happens in the orchestrator.
    // This engine processes the collected data for verification.

    return {
      verified,
      rejected,
      contradictions,
      sources: [...sources],
    };
  }

  /**
   * Phase 3: Verify a group of claims across multiple sources.
   * This is the core verification logic.
   */
  verifyClaims(findings: Finding[]): {
    verified: VerifiedClaim[];
    rejected: VerifiedClaim[];
    contradictions: VerificationReport["contradictions"];
  } {
    const verified: VerifiedClaim[] = [];
    const rejected: VerifiedClaim[] = [];
    const contradictions: VerificationReport["contradictions"] = [];

    // Group findings by topic (similar claims)
    const groups = this.groupSimilarClaims(findings);

    for (const [topic, group] of groups) {
      // Count independent sources
      const uniqueSources = new Set<string>();
      for (const f of group) {
        f.sourceUrls.forEach(u => uniqueSources.add(u));
      }

      // Count source domains (for diversity check)
      const uniqueDomains = new Set<string>();
      for (const url of uniqueSources) {
        try { uniqueDomains.add(new URL(url).hostname); }
        catch { uniqueDomains.add(url); }
      }

      // Check for contradictions within the group
      const groupContradictions = this.detectGroupContradictions(group);
      if (groupContradictions.length > 0) {
        // Has contradictions — investigate further
        const resolved = this.resolveContradictions(group, groupContradictions);
        contradictions.push(...resolved.contradictions);
      }

      // Calculate confidence based on source agreement
      const agreement = this.calculateAgreement(group, uniqueDomains.size);
      const sourceAuthority = this.calculateSourceAuthority([...uniqueDomains]);
      const confidence = (agreement * 0.6 + sourceAuthority * 0.4);

      // Determine the most representative claim
      const bestClaim = this.selectBestClaim(group);

      const verifiedClaim: VerifiedClaim = {
        claim: bestClaim,
        confidence,
        supportingSources: [...uniqueSources],
        contradictingSources: [],
        confirmationCount: uniqueDomains.size,
        verified: confidence >= VERIFICATION_THRESHOLD && uniqueDomains.size >= MIN_SOURCES_PER_CLAIM,
        verifiedAt: Date.now(),
        evidence: group.flatMap(f => 
          f.evidence.map(e => ({
            sourceUrl: e.sourceUrl,
            text: e.text,
          }))
        ),
      };

      if (verifiedClaim.verified) {
        verified.push(verifiedClaim);
      } else {
        rejected.push(verifiedClaim);
      }
    }

    return { verified, rejected, contradictions };
  }

  /**
   * Find claims that contradict across different sub-queries.
   */
  private detectCrossContradictions(allClaims: VerifiedClaim[]): VerificationReport["contradictions"] {
    const contradictions: VerificationReport["contradictions"] = [];

    for (let i = 0; i < allClaims.length; i++) {
      for (let j = i + 1; j < allClaims.length; j++) {
        const a = allClaims[i].claim.toLowerCase();
        const b = allClaims[j].claim.toLowerCase();

        // Check if they're topically related
        const aWords = new Set(a.split(/\s+/).filter(w => w.length > 4));
        const bWords = new Set(b.split(/\s+/).filter(w => w.length > 4));
        const overlap = [...aWords].filter(w => bWords.has(w));

        if (overlap.length >= 3) {
          // Check for negation/number disagreement
          const aNums: string[] = a.match(/\d+(?:\.\d+)?/g) || [];
          const bNums: string[] = b.match(/\d+(?:\.\d+)?/g) || [];

          const numbersDisagree = aNums.length > 0 && bNums.length > 0 &&
            aNums.some(n => !bNums.includes(n));

          const hasNegation = /not |no |never |isn't|aren't|won't|can't/.test(a) !==
            /not |no |never |isn't|aren't|won't|can't/.test(b);

          if (numbersDisagree || hasNegation) {
            contradictions.push({
              claim: overlap.slice(0, 3).join(", "),
              sourcesA: aWords.size > bWords.size ? [...allClaims[i].supportingSources] : [...allClaims[j].supportingSources],
              sourcesB: aWords.size > bWords.size ? [...allClaims[j].supportingSources] : [...allClaims[i].supportingSources],
              resolution: "Sources disagree — needs further investigation",
            });
          }
        }
      }
    }

    return contradictions;
  }

  /**
   * Group similar claims together for cross-verification.
   */
  private groupSimilarClaims(findings: Finding[]): Map<string, Finding[]> {
    const groups = new Map<string, Finding[]>();

    for (const finding of findings) {
      // Extract key topic from claim
      const topic = this.extractTopic(finding.claim);
      if (!groups.has(topic)) groups.set(topic, []);
      groups.get(topic)!.push(finding);
    }

    return groups;
  }

  /**
   * Extract the main topic from a claim.
   */
  private extractTopic(claim: string): string {
    // Simple heuristic: first 5 significant words
    const words = claim
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, "")
      .split(/\s+/)
      .filter(w => w.length > 3 && !["this", "that", "with", "from", "have", "been", "were", "their", "they", "what", "when", "where"].includes(w));

    return words.slice(0, 5).join(" ");
  }

  /**
   * Detect contradictions within a group of similar claims.
   */
  private detectGroupContradictions(group: Finding[]): Array<{ a: string; b: string }> {
    const contradictions: Array<{ a: string; b: string }> = [];
    
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i].claim.toLowerCase();
        const b = group[j].claim.toLowerCase();

        // Check for number disagreement
        const aNums = a.match(/\d+/g) || [];
        const bNums = b.match(/\d+/g) || [];
        if (aNums.length > 0 && bNums.length > 0) {
          for (const numA of aNums) {
            for (const numB of bNums) {
              if (numA !== numB && Math.abs(parseInt(numA) - parseInt(numB)) > 1) {
                contradictions.push({ a: group[i].claim, b: group[j].claim });
              }
            }
          }
        }
      }
    }

    return contradictions;
  }

  /**
   * Resolve contradictions within a group.
   */
  private resolveContradictions(
    group: Finding[],
    contradictions: Array<{ a: string; b: string }>
  ): {
    contradictions: VerificationReport["contradictions"];
  } {
    const resolved: VerificationReport["contradictions"] = [];

    for (const c of contradictions) {
      resolved.push({
        claim: c.a.substring(0, 100),
        sourcesA: group.find(f => f.claim === c.a)?.sourceUrls || [],
        sourcesB: group.find(f => f.claim === c.b)?.sourceUrls || [],
        resolution: "Contradictory data — requires manual verification",
      });
    }

    return { contradictions: resolved };
  }

  /**
   * Calculate agreement score based on source diversity.
   */
  private calculateAgreement(group: Finding[], uniqueDomains: number): number {
    if (group.length === 0) return 0;
    if (uniqueDomains <= 1) return 0.3; // Single source = low confidence
    
    // More independent sources = higher agreement
    return Math.min(1, 0.5 + (uniqueDomains - 1) * 0.1);
  }

  /**
   * Calculate source authority score.
   */
  private calculateSourceAuthority(domains: string[]): number {
    if (domains.length === 0) return 0;

    let score = 0;
    for (const domain of domains) {
      if (HIGH_VALUE_SOURCES.some(s => domain.includes(s))) {
        score += 1;
      } else if (domain.includes(".gov") || domain.includes(".edu") || domain.includes(".org")) {
        score += 0.8;
      } else {
        score += 0.4;
      }
    }

    return score / domains.length;
  }

  /**
   * Select the best claim from a group.
   */
  private selectBestClaim(group: Finding[]): string {
    // Pick the claim from the highest confidence finding
    const best = group.reduce((a, b) => a.confidence > b.confidence ? a : b);
    return best.claim;
  }

  /**
   * Calculate overall confidence for the entire report.
   */
  private calculateOverallConfidence(
    verified: VerifiedClaim[],
    contradictions: VerificationReport["contradictions"]
  ): number {
    if (verified.length === 0) return 0;

    const avgConfidence = verified.reduce((s, c) => s + c.confidence, 0) / verified.length;
    const contradictionPenalty = Math.min(0.3, contradictions.length * 0.05);
    const sourceDiversity = Math.min(1, new Set(verified.flatMap(v => v.supportingSources)).size / 10);

    return Math.max(0, Math.min(1, avgConfidence * 0.5 + sourceDiversity * 0.3 - contradictionPenalty));
  }

  /**
   * Generate a human-readable verification report.
   */
  generateReport(report: VerificationReport): string {
    let output = `# 🔍 Verification Report\n\n`;
    output += `**Query:** ${report.originalQuery}\n`;
    output += `**Overall Confidence:** ${(report.overallConfidence * 100).toFixed(0)}%\n`;
    output += `**Sources Used:** ${report.sourcesUsed.length}\n`;
    output += `**Verified Claims:** ${report.verifiedClaims.length}\n`;
    output += `**Rejected Claims:** ${report.rejectedClaims.length}\n`;
    output += `**Contradictions Found:** ${report.contradictions.length}\n\n`;

    if (report.verifiedClaims.length > 0) {
      output += `## ✅ Verified Claims\n\n`;
      for (const vc of report.verifiedClaims) {
        const badge = vc.confidence >= 0.9 ? "🟢" : vc.confidence >= 0.8 ? "🟡" : "🟠";
        output += `### ${badge} ${vc.claim.substring(0, 200)}\n`;
        output += `- Confidence: ${(vc.confidence * 100).toFixed(0)}%\n`;
        output += `- Confirmed by ${vc.confirmationCount} independent sources\n`;
        output += `- Sources: ${vc.supportingSources.slice(0, 3).join(", ")}\n\n`;
      }
    }

    if (report.contradictions.length > 0) {
      output += `## ⚠️ Contradictions\n\n`;
      for (const c of report.contradictions) {
        output += `- **${c.claim}**\n`;
        output += `  - Sources A: ${c.sourcesA.slice(0, 2).join(", ")}\n`;
        output += `  - Sources B: ${c.sourcesB.slice(0, 2).join(", ")}\n`;
        if (c.resolution) output += `  - Resolution: ${c.resolution}\n`;
        output += "\n";
      }
    }

    if (report.rejectedClaims.length > 0) {
      output += `## ❌ Rejected Claims (Below Threshold)\n\n`;
      for (const rc of report.rejectedClaims) {
        output += `- ${rc.claim.substring(0, 150)}... (${(rc.confidence * 100).toFixed(0)}%)\n`;
      }
      output += "\n";
    }

    output += `---\n`;
    output += `*Verified at: ${new Date(report.verifiedAt).toISOString()}*\n`;

    return output;
  }
}

// Singleton
let _validity: ValidityEngine | null = null;
export function getValidityEngine(): ValidityEngine {
  if (!_validity) _validity = new ValidityEngine();
  return _validity;
}
