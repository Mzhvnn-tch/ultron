import { logger } from "../utils/logger.js";
import { config } from "../config.js";
import type { Finding, Evidence, Citation, ResearchStep } from "../types.js";

/**
 * LAYER 3 — Citation Grounding & Cross-Verification
 *
 * After gathering data from multiple sources, this layer:
 *  1. Cross-verifies claims across sources
 *  2. Calculates confidence scores based on source corroboration
 *  3. Extracts verifiable citations with URLs & snippets
 *  4. Flags potential contradictions
 */
export class CitationGrounding {
  /**
   * Ground findings from a research step with citations.
   * Each finding must have at least one verifiable source.
   */
  groundFindings(findings: Finding[], step: ResearchStep): Finding[] {
    logger.info(
      { findingCount: findings.length },
      "[Layer 3] Grounding findings with citations"
    );

    const grounded: Finding[] = [];

    for (const finding of findings) {
      // Ensure every claim has cited evidence
      if (finding.evidence.length === 0) {
        logger.warn({ finding: finding.id }, "[Layer 3] Finding has no evidence — dropping");
        continue;
      }

      // Cross-verify: boost confidence when multiple independent sources agree
      const corroboration = this.assessCorroboration(finding);
      const adjustedConfidence = this.calculateConfidence(finding, corroboration);

      grounded.push({
        ...finding,
        confidence: adjustedConfidence,
        evidence: finding.evidence.map((e) => ({
          ...e,
          relevance: e.relevance || this.estimateRelevance(e, finding.claim),
        })),
      });
    }

    // Sort by confidence (highest first)
    grounded.sort((a, b) => b.confidence - a.confidence);

    logger.info(
      { groundedCount: grounded.length, avgConfidence: this.avgConfidence(grounded) },
      "[Layer 3] Grounding complete"
    );

    return grounded;
  }

  /**
   * Generate a consolidated citations list from all findings.
   */
  generateCitations(findings: Finding[]): Citation[] {
    const citationMap = new Map<string, Citation>();
    let index = 1;

    for (const finding of findings) {
      for (const evidence of finding.evidence) {
        const key = evidence.sourceUrl;
        if (!citationMap.has(key)) {
          citationMap.set(key, {
            index: index++,
            url: evidence.sourceUrl,
            title: evidence.sourceTitle,
            snippet: evidence.text.substring(0, 300),
            relevanceScore: evidence.relevance,
          });
        } else {
          // Boost relevance score for sources cited multiple times
          const existing = citationMap.get(key)!;
          existing.relevanceScore = Math.min(1, existing.relevanceScore + 0.1);
        }
      }
    }

    return Array.from(citationMap.values()).sort(
      (a, b) => b.relevanceScore - a.relevanceScore
    );
  }

  /**
   * Check for contradictions between findings using Two-Pass Hybrid Verification:
   *  Pass 1: Fast heuristic candidate selection (keyword overlap & negation check)
   *  Pass 2: Targeted LLM reasoning verification for candidate pairs
   * Returns pairs of findings that contradict each other, adjusting confidence scores downwards by 30%.
   */
  async detectContradictions(findings: Finding[]): Promise<{
    findingA: string;
    findingB: string;
    description: string;
  }[]> {
    const candidatePairs: { findingA: Finding; findingB: Finding; overlap: string[] }[] = [];
    const negations = ["not", "no", "never", "doesn't", "don't", "isn't", "aren't", "won't"];

    // Pass 1: Fast Heuristic Candidate Filtering
    for (let i = 0; i < findings.length; i++) {
      for (let j = i + 1; j < findings.length; j++) {
        const a = findings[i].claim.toLowerCase();
        const b = findings[j].claim.toLowerCase();

        const aWords = new Set(a.split(/\s+/));
        const bWords = new Set(b.split(/\s+/));
        const overlap = [...aWords].filter((w) => bWords.has(w) && w.length > 3);

        const hasNegationA = negations.some((n) => a.includes(` ${n} `));
        const hasNegationB = negations.some((n) => b.includes(` ${n} `));

        if (overlap.length >= 3 || (overlap.length >= 2 && hasNegationA !== hasNegationB)) {
          candidatePairs.push({
            findingA: findings[i],
            findingB: findings[j],
            overlap,
          });
        }
      }
    }

    if (candidatePairs.length === 0) {
      return [];
    }

    logger.info(
      { candidatePairsCount: candidatePairs.length },
      "[Layer 3] Fast filter identified potential contradiction candidates for LLM verification"
    );

    const contradictions: {
      findingA: string;
      findingB: string;
      description: string;
    }[] = [];

    // Pass 2: LLM Verification (or Fallback if LLM unavailable)
    for (const pair of candidatePairs) {
      let isContradiction = false;
      let reasoning = "";

      if (config.llm.apiKey) {
        try {
          const prompt = `Evaluate if the following two claims semantically contradict each other.
Claim A: "${pair.findingA.claim}"
Claim B: "${pair.findingB.claim}"

Respond ONLY with a valid JSON object matching this format:
{"isContradiction": boolean, "reasoning": "short explanation of contradiction"}`;

          const response = await fetch(`${config.llm.baseUrl}/chat/completions`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${config.llm.apiKey}`,
            },
            body: JSON.stringify({
              model: config.llm.model,
              messages: [
                { role: "system", content: "You are a logical verification agent specialized in detecting semantic contradictions between research claims." },
                { role: "user", content: prompt },
              ],
              temperature: 0,
              max_tokens: 200,
            }),
          });

          if (response.ok) {
            const data = (await response.json()) as any;
            const content = data.choices?.[0]?.message?.content || "";
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              const parsed = JSON.parse(jsonMatch[0]);
              isContradiction = Boolean(parsed.isContradiction);
              reasoning = parsed.reasoning || "Semantic contradiction confirmed by LLM reasoning.";
            }
          }
        } catch (err: any) {
          logger.warn({ error: err.message }, "[Layer 3] LLM contradiction check failed, using fallback heuristic");
        }
      }

      // Fallback if LLM skipped or failed: check basic negation heuristic
      if (!isContradiction && (!config.llm.apiKey || !reasoning) && pair.overlap.length >= 3) {
        const a = pair.findingA.claim.toLowerCase();
        const b = pair.findingB.claim.toLowerCase();
        const hasNegationA = negations.some((n) => a.includes(` ${n} `));
        const hasNegationB = negations.some((n) => b.includes(` ${n} `));
        if (hasNegationA !== hasNegationB) {
          isContradiction = true;
          reasoning = `Contradictory claims about: ${pair.overlap.slice(0, 3).join(", ")}`;
        }
      }

      if (isContradiction) {
        // Flag both findings and adjust confidence score downwards by 30%
        pair.findingA.isContradictory = true;
        pair.findingB.isContradictory = true;
        pair.findingA.contradictionReason = reasoning;
        pair.findingB.contradictionReason = reasoning;

        pair.findingA.confidence = Math.max(0.1, Math.round(pair.findingA.confidence * 0.7 * 100) / 100);
        pair.findingB.confidence = Math.max(0.1, Math.round(pair.findingB.confidence * 0.7 * 100) / 100);

        contradictions.push({
          findingA: pair.findingA.id,
          findingB: pair.findingB.id,
          description: reasoning,
        });
      }
    }

    if (contradictions.length > 0) {
      logger.warn(
        { count: contradictions.length },
        "[Layer 3] Confirmed contradictions detected and findings adjusted"
      );
    }

    return contradictions;
  }

  /**
   * Extract key claims as structured findings from raw text.
   * Uses heuristics with SPA-aware extraction.
   */
  extractClaims(text: string, sourceUrl: string, sourceTitle: string): Finding[] {
    const findings: Finding[] = [];

    // Skip if text looks like binary/garbage
    if (this.isGarbageText(text)) {
      return findings;
    }

    // Skip if text is just boilerplate HTML wrapper (SPA index.html)
    // This prevents false positives from well-known endpoints that return SPA shell
    const isHtmlWrapper = text.length < 500 && /<html|<head|<body|<div id="root"/i.test(text);
    if (isHtmlWrapper) {
      return findings;
    }

    // Strategy 1: Extract full page as a single finding if it's substantial
    // This catches SPA content that doesn't match "factual indicator" keywords
    if (text.length > 200 && text.length < 50000) {
      // Check if this looks like meaningful page content (not just error/noise)
      const wordCount = text.split(/\s+/).length;
      const hasStructure = /^[A-Z][^a-z]*\n|[A-Z][a-z]+ [A-Z]/.test(text);

      if (wordCount > 20 && (hasStructure || wordCount > 50)) {
        findings.push({
          id: `page-${sourceUrl.replace(/[^a-zA-Z0-9]/g, "-").substring(0, 20)}`,
          claim: text.substring(0, 500).replace(/\n+/g, " ").trim(),
          evidence: [
            {
              text: text.substring(0, 2000),
              sourceUrl,
              sourceTitle,
              relevance: 0.8,
              extractedAt: Date.now(),
            },
          ],
          confidence: 0.65,
          sourceUrls: [sourceUrl],
        });
      }
    }

    const sentences = text
      .split(/[.!?]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 30 && s.length < 500);

    // Heuristic: sentences with factual indicators
    const factualIndicators = [
      "according to", "research shows", "study found", "data indicates",
      "reported", "confirmed", "announced", "revealed", "published",
      "estimated", "measured", "recorded", "documented",
      "%", "percent", "million", "billion", "thousand",
      // SPA-specific content indicators
      "platform", "service", "solution", "product", "feature",
      "deploy", "container", "manage", "monitor", "scale",
      "pricing", "subscription", "plan", "free", "trial",
      "api", "integrate", "connect", "build", "automate",
      "security", "infrastructure", "cloud", "enterprise",
      "dashboard", "analytics", "workflow", "pipeline",
    ];

    let id = 0;
    for (const sentence of sentences) {
      const lower = sentence.toLowerCase();
      const isFactual = factualIndicators.some((ind) => lower.includes(ind));

      if (isFactual && sentence.length > 50) {
        findings.push({
          id: `claim-${sourceUrl.replace(/[^a-zA-Z0-9]/g, "-").substring(0, 20)}-${id++}`,
          claim: sentence,
          evidence: [
            {
              text: sentence,
              sourceUrl,
              sourceTitle,
              relevance: 0.7,
              extractedAt: Date.now(),
            },
          ],
          confidence: 0.6,
          sourceUrls: [sourceUrl],
        });
      }
    }

    return findings;
  }

  // ─── Private Helpers ───────────────────────────────────

  private assessCorroboration(finding: Finding): number {
    // More evidence from different domains = higher corroboration
    if (finding.evidence.length <= 1) return 0;

    const uniqueDomains = new Set(
      finding.evidence.map((e) => {
        try {
          return new URL(e.sourceUrl).hostname;
        } catch {
          return e.sourceUrl;
        }
      })
    );

    // Score: more unique domains = more corroboration
    return Math.min(1, uniqueDomains.size / 3);
  }

  private calculateConfidence(finding: Finding, corroboration: number): number {
    // Base confidence from initial estimate
    let confidence = finding.confidence;

    // Boost from corroboration (multiple independent sources)
    confidence += corroboration * 0.2;

    // Boost from evidence quality
    const avgRelevance =
      finding.evidence.reduce((sum, e) => sum + e.relevance, 0) /
      Math.max(1, finding.evidence.length);
    confidence += avgRelevance * 0.1;

    // Penalize if only one source
    if (finding.evidence.length === 1) {
      confidence -= 0.1;
    }

    return Math.max(0.1, Math.min(1, confidence));
  }

  private estimateRelevance(evidence: Evidence, claim: string): number {
    const claimWords = new Set(claim.toLowerCase().split(/\s+/).filter((w) => w.length > 3));
    const evidenceWords = evidence.text.toLowerCase().split(/\s+/);
    const overlap = evidenceWords.filter((w) => claimWords.has(w)).length;

    // Jaccard-like similarity
    const total = new Set([...claimWords, ...new Set(evidenceWords)]).size;
    return total > 0 ? Math.min(1, overlap / Math.min(claimWords.size, 20)) : 0.5;
  }

  private isGarbageText(text: string): boolean {
    if (!text || text.length < 20) return true;
    // High ratio of non-printable characters = binary garbage
    const nonPrintable = text.replace(/[\x20-\x7E\x0A\x0D\t]/g, "").length;
    const ratio = nonPrintable / text.length;
    if (ratio > 0.15) return true; // >15% non-printable = garbage
    // High ratio of hex/encoded-looking content
    const hexLike = (text.match(/[0-9A-Fa-f]{8,}/g) || []).join("").length;
    if (hexLike > text.length * 0.3) return true;
    return false;
  }

  private avgConfidence(findings: Finding[]): number {
    if (findings.length === 0) return 0;
    return findings.reduce((s, f) => s + f.confidence, 0) / findings.length;
  }
}

// Singleton
let _grounding: CitationGrounding | null = null;
export function getCitationGrounding(): CitationGrounding {
  if (!_grounding) _grounding = new CitationGrounding();
  return _grounding;
}
