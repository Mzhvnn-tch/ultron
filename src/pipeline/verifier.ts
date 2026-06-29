import { config } from "../config.js";
import { logger } from "../utils/logger.js";
import type { Finding, Citation } from "../types.js";

/**
 * Cross-Verifier
 *
 * Validates findings by checking consistency across sources
 * and optionally performing fact-checking via LLM.
 */
export class Verifier {
  /**
   * Verify a set of findings for internal consistency and source quality.
   */
  verify(findings: Finding[], citations: Citation[]): {
    verifiedFindings: Finding[];
    warnings: string[];
    qualityScore: number;
  } {
    logger.info({ count: findings.length }, "[Verifier] Verifying findings");

    const warnings: string[] = [];
    const verifiedFindings: Finding[] = [];

    for (const finding of findings) {
      // Skip findings with no evidence
      if (finding.evidence.length === 0) {
        warnings.push(`Finding "${finding.id}" has no evidence — excluded`);
        continue;
      }

      // Check source diversity
      const uniqueDomains = new Set(
        finding.evidence.map((e) => {
          try {
            return new URL(e.sourceUrl).hostname;
          } catch {
            return e.sourceUrl;
          }
        })
      );

      if (uniqueDomains.size === 1 && finding.confidence > 0.7) {
        // Single-source high-confidence claim → flag it
        finding.confidence = Math.min(finding.confidence, 0.65);
        warnings.push(
          `Finding "${finding.claim.substring(0, 80)}..." relies on single domain — confidence adjusted`
        );
      }

      // Check if sources are in our citation list (they should be)
      for (const url of finding.sourceUrls) {
        if (!citations.some((c) => c.url === url)) {
          warnings.push(`Finding "${finding.id}" references uncited source: ${url}`);
        }
      }

      // Check Temporal Staleness (60-second threshold for quantitative facts)
      const stalenessWarning = this.checkTemporalStaleness(finding);
      if (stalenessWarning) {
        warnings.push(stalenessWarning);
      }

      // Check Numerical Variance (>2% deviation check)
      const varianceWarning = this.checkNumericalVariance(finding);
      if (varianceWarning) {
        warnings.push(varianceWarning);
      }

      verifiedFindings.push(finding);
    }

    // Calculate overall quality score
    const qualityScore = this.calculateQualityScore(verifiedFindings, warnings);

    logger.info(
      {
        verified: verifiedFindings.length,
        warnings: warnings.length,
        qualityScore: qualityScore.toFixed(2),
      },
      "[Verifier] Verification complete"
    );

    return { verifiedFindings, warnings, qualityScore };
  }

  /**
   * LLM-based fact checking for critical claims (optional).
   */
  async factCheck(claim: string): Promise<{
    isAccurate: boolean;
    explanation: string;
    confidence: number;
  }> {
    if (!config.llm.apiKey) {
      return { isAccurate: true, explanation: "LLM fact-checking disabled", confidence: 0.5 };
    }

    try {
      const response = await fetch(`${config.llm.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.llm.apiKey}`,
        },
        body: JSON.stringify({
          model: config.llm.model,
          messages: [
            {
              role: "system",
              content:
                "You are a fact-checker. Given a claim, evaluate its accuracy. Respond ONLY with a JSON object: {\"isAccurate\": boolean, \"explanation\": string, \"confidence\": number 0-1}.",
            },
            { role: "user", content: `Fact-check this claim: "${claim}"` },
          ],
          temperature: 0,
          max_tokens: 300,
        }),
      });

      if (!response.ok) throw new Error(`API error: ${response.status}`);
      const data = await response.json() as any;
      const content = data.choices?.[0]?.message?.content || "";

      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    } catch (err: any) {
      logger.warn({ error: err.message }, "[Verifier] Fact-check failed");
    }

    return { isAccurate: true, explanation: "Could not verify", confidence: 0.5 };
  }

  private calculateQualityScore(
    findings: Finding[],
    warnings: string[]
  ): number {
    if (findings.length === 0) return 0;

    // Average confidence
    const avgConf =
      findings.reduce((s, f) => s + f.confidence, 0) / findings.length;

    // Source diversity score
    const allSources = new Set<string>();
    for (const f of findings) {
      for (const s of f.sourceUrls) allSources.add(s);
    }
    const diversityScore = Math.min(1, allSources.size / Math.max(1, findings.length * 1.5));

    // Warning penalty
    const warningPenalty = Math.min(0.3, warnings.length * 0.05);

    // Evidence per finding score
    const avgEvidence =
      findings.reduce((s, f) => s + f.evidence.length, 0) / findings.length;
    const evidenceScore = Math.min(1, avgEvidence / 3);

    const score = avgConf * 0.4 + diversityScore * 0.25 + evidenceScore * 0.35 - warningPenalty;
    return Math.max(0, Math.min(1, Math.round(score * 100) / 100));
  }

  /** Check if finding evidence contains quantitative data older than 60 seconds */
  private checkTemporalStaleness(finding: Finding): string | null {
    const now = Date.now();
    const STALENESS_THRESHOLD_MS = 60_000; // 60 seconds

    const isQuantitative = /\b(\$?\d+(\.\d+)?\s*(usdt|usd|eth|sol|tvl|price|volume|mcap|k|m|b)?)\b/i.test(finding.claim);
    if (!isQuantitative) return null;

    for (const ev of finding.evidence) {
      if (ev.extractedAt && now - ev.extractedAt > STALENESS_THRESHOLD_MS) {
        finding.isStale = true;
        finding.confidence = Math.round(finding.confidence * 0.5 * 100) / 100; // 50% penalty
        return `[TEMPORAL STALENESS WARNING] Finding "${finding.claim.substring(0, 60)}..." is older than 60s (stale) — confidence reduced to ${(finding.confidence * 100).toFixed(0)}%`;
      }
    }
    return null;
  }

  /** Check if evidence numbers contain mathematical deviation > 2% */
  private checkNumericalVariance(finding: Finding): string | null {
    if (finding.evidence.length < 2) return null;

    const numbers: number[] = [];
    for (const ev of finding.evidence) {
      const matches = ev.text.match(/\b\d+(\.\d+)?\b/g);
      if (matches) {
        for (const m of matches) {
          const val = parseFloat(m);
          if (!isNaN(val) && val > 0) numbers.push(val);
        }
      }
    }

    if (numbers.length < 2) return null;

    const maxVal = Math.max(...numbers);
    const minVal = Math.min(...numbers);
    const deviationPercent = ((maxVal - minVal) / minVal) * 100;

    if (deviationPercent > 2) {
      finding.varianceWarning = `Numerical variance of ${deviationPercent.toFixed(1)}% detected across evidence sources`;
      finding.confidence = Math.round(finding.confidence * 0.5 * 100) / 100; // 50% penalty
      return `[NUMERICAL VARIANCE WARNING] Finding "${finding.claim.substring(0, 60)}..." has ${deviationPercent.toFixed(1)}% numerical deviation across sources — confidence reduced to ${(finding.confidence * 100).toFixed(0)}%`;
    }

    return null;
  }
}

// Singleton
let _verifier: Verifier | null = null;
export function getVerifier(): Verifier {
  if (!_verifier) _verifier = new Verifier();
  return _verifier;
}
