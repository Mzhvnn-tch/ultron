import { config } from "../config.js";
import { logger } from "../utils/logger.js";
import { KnowledgeGraphStore, getKnowledgeGraphStore } from "../cache/knowledge-graph.js";
import { getLLMProvider } from "../utils/llm-provider.js";
import type { Finding, ResearchStep, ResearchResult } from "../types.js";

/**
 * Research Synthesizer
 *
 * Combines findings from all research steps into a coherent summary.
 * Uses LLM for intelligent synthesis when available.
 */
export class Synthesizer {
  /**
   * Synthesize all findings into a final summary.
   */
  async synthesize(
    query: string,
    steps: ResearchStep[],
    allFindings: Finding[]
  ): Promise<string> {
    logger.info(
      { stepCount: steps.length, findingCount: allFindings.length },
      "[Synthesizer] Synthesizing results"
    );

    if (allFindings.length === 0) {
      return `No findings were discovered for query: "${query}". The research could not locate relevant information from the sources searched.`;
    }

    // Store findings into Knowledge Graph & Vector Memory asynchronously
    this.extractAndStoreKnowledge(query, allFindings).catch((err) => {
      logger.warn({ error: err.message }, "[Synthesizer] Failed to store knowledge graph items");
    });

    // Try LLM synthesis
    try {
      return await this.llmSynthesize(query, allFindings);
    } catch (err: any) {
      logger.warn({ error: err.message }, "[Synthesizer] LLM synthesis failed, using fallback");
      return this.templateSynthesize(query, allFindings);
    }
  }

  private async llmSynthesize(
    query: string,
    findings: Finding[]
  ): Promise<string> {
    if (!config.llm.apiKey) {
      throw new Error("No LLM API key");
    }

    // Prepare findings context
    const findingsText = findings
      .slice(0, 20) // Limit context for LLM
      .map(
        (f, i) =>
          `[${i + 1}] (confidence: ${(f.confidence * 100).toFixed(0)}%) ${f.claim}\n   Sources: ${f.sourceUrls.join(", ")}`
      )
      .join("\n\n");

    const systemPrompt = `You are a research synthesizer. Given a research query and discovered findings, produce a comprehensive, well-structured summary.

Rules:
- Start with a brief executive summary (2-3 sentences)
- Organize findings into logical sections with headings
- Include specific data points, numbers, and facts
- Note confidence levels where appropriate
- Mention any contradictions or uncertainties
- Use [1], [2] etc. for inline citations referencing the findings
- Keep the total response under 2000 words
- Be objective and balanced in tone`;
    const provider = getLLMProvider();
    const summary = await provider.complete({
      systemPrompt,
      prompt: `Research Query: "${query}"\n\nDiscovered Findings:\n${findingsText}\n\nSynthesize these findings into a comprehensive research summary.`,
    });

    return summary || this.templateSynthesize(query, findings);
  }

  private templateSynthesize(query: string, findings: Finding[]): string {
    const highConf = findings.filter((f) => f.confidence >= 0.7);
    const medConf = findings.filter((f) => f.confidence >= 0.4 && f.confidence < 0.7);
    const lowConf = findings.filter((f) => f.confidence < 0.4);

    let summary = `# Research Summary: ${query}\n\n`;

    summary += `## Executive Summary\n`;
    summary += `This research identified ${findings.length} findings across multiple sources. `;
    summary += `${highConf.length} findings have high confidence, ${medConf.length} moderate, and ${lowConf.length} lower confidence.\n\n`;

    if (highConf.length > 0) {
      summary += `## High-Confidence Findings\n\n`;
      for (const f of highConf.slice(0, 5)) {
        summary += `- ${f.claim} [Sources: ${f.sourceUrls.length}]\n`;
      }
      summary += "\n";
    }

    if (medConf.length > 0) {
      summary += `## Moderate-Confidence Findings\n\n`;
      for (const f of medConf.slice(0, 5)) {
        summary += `- ${f.claim}\n`;
      }
      summary += "\n";
    }

    if (lowConf.length > 0) {
      summary += `## Lower-Confidence Observations\n\n`;
      for (const f of lowConf.slice(0, 3)) {
        summary += `- ${f.claim}\n`;
      }
      summary += "\n";
    }

    summary += `## Sources Consulted\n`;
    const allSources = new Set<string>();
    for (const f of findings) {
      for (const s of f.sourceUrls) allSources.add(s);
    }
    summary += `${allSources.size} unique sources were consulted.\n`;

    return summary;
  }

  private async extractAndStoreKnowledge(query: string, findings: Finding[]): Promise<void> {
    const kgStore = getKnowledgeGraphStore();
    const now = Date.now();

    for (const finding of findings) {
      // Store vector memory claim
      const vector = KnowledgeGraphStore.generateSimpleVector(finding.claim);
      kgStore.saveVectorItem({
        id: `vec_${finding.id}_${now}`,
        claim: finding.claim,
        vector,
        entityIds: [],
        sourceUrl: finding.sourceUrls[0],
        createdAt: now,
      });

      // Extract basic entities & triples from query and claims
      const words = finding.claim.split(/\s+/).filter((w) => w.length > 3 && /^[A-Z0-9]/.test(w));
      if (words.length >= 2) {
        const subName = words[0].replace(/[^a-zA-Z0-9]/g, "");
        const objName = words[1].replace(/[^a-zA-Z0-9]/g, "");
        if (subName && objName && subName !== objName) {
          const subId = `ent_${subName.toLowerCase()}`;
          const objId = `ent_${objName.toLowerCase()}`;

          kgStore.saveEntity({ id: subId, name: subName, type: "concept", createdAt: now, updatedAt: now });
          kgStore.saveEntity({ id: objId, name: objName, type: "concept", createdAt: now, updatedAt: now });

          kgStore.saveTriple({
            id: `trip_${subId}_${objId}_${now}`,
            subjectId: subId,
            predicate: "associated_with",
            objectId: objId,
            confidence: finding.confidence,
            sourceQuery: query,
            createdAt: now,
          });
        }
      }
    }
    logger.info({ findingCount: findings.length }, "[KnowledgeGraph] Successfully processed and stored knowledge memory");
  }
}

// Singleton
let _synthesizer: Synthesizer | null = null;
export function getSynthesizer(): Synthesizer {
  if (!_synthesizer) _synthesizer = new Synthesizer();
  return _synthesizer;
}
