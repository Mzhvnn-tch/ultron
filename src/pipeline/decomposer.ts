import { config } from "../config.js";
import { logger } from "../utils/logger.js";
import { getLLMProvider } from "../utils/llm-provider.js";

// Current year for dynamic date generation
const CURRENT_YEAR = new Date().getFullYear();
const PREV_YEAR = CURRENT_YEAR - 1;
const NEXT_YEAR = CURRENT_YEAR + 1;

/**
 * Query Decomposition
 *
 * Breaks a complex research query into focused sub-queries
 * for parallel or sequential investigation.
 *
 * Uses the configured LLM for intelligent decomposition,
 * with regex fallback for when LLM is unavailable.
 */
export class QueryDecomposer {
  /**
   * Decompose a query into sub-queries.
   */
  async decompose(
    query: string,
    maxSubQueries: number = 5
  ): Promise<string[]> {
    logger.info({ query }, "[Decomposer] Decomposing query");

    // Try LLM decomposition first
    try {
      const subQueries = await this.llmDecompose(query, maxSubQueries);
      if (subQueries.length > 0) {
        logger.info({ count: subQueries.length }, "[Decomposer] LLM decomposition complete");
        return subQueries;
      }
    } catch (err: any) {
      logger.warn({ error: err.message }, "[Decomposer] LLM decomposition failed, using fallback");
    }

    // Fallback: heuristic decomposition
    return this.heuristicDecompose(query, maxSubQueries);
  }

  private async llmDecompose(
    query: string,
    maxSubQueries: number
  ): Promise<string[]> {
    if (!config.llm.apiKey) {
      throw new Error("No LLM API key configured");
    }

    const systemPrompt = `You are a research query decomposer. Break down the user's research question into specific, focused sub-queries that can be answered by searching the web or querying APIs.

Rules:
- Return ONLY a JSON array of strings, nothing else
- Each sub-query should be self-contained and searchable
- Focus on different aspects: facts, data, opinions, comparisons, recent developments
- Maximum ${maxSubQueries} sub-queries
- Use concise, keyword-rich phrasing

Example input: "What is the impact of AI on healthcare in 2024?"
Example output: ["AI healthcare market size 2024 statistics", "AI medical diagnosis accuracy clinical trials 2024", "FDA approved AI medical devices 2024 list", "AI healthcare investment funding 2024", "AI doctor adoption rate hospitals 2024 survey"]`;

    const provider = getLLMProvider();
    const content = await provider.complete({
      systemPrompt,
      prompt: `Decompose this research query into up to ${maxSubQueries} sub-queries: "${query}"`,
    });

    // Extract JSON array from response (handle markdown code blocks)
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (Array.isArray(parsed)) {
        return parsed.slice(0, maxSubQueries);
      }
    }

    return [];
  }

  private heuristicDecompose(
    query: string,
    maxSubQueries: number
  ): string[] {
    const subQueries: string[] = [query]; // Start with original

    const aspects: { pattern: RegExp; prefix: string }[] = [
      { pattern: /what is|definition|meaning/i, prefix: "definition of" },
      { pattern: /how to|tutorial|guide/i, prefix: "how to" },
      { pattern: /compare|vs|versus|difference between/i, prefix: "comparison" },
      { pattern: /best|top|ranking/i, prefix: "best" },
      { pattern: /price|cost|how much|harga|berapa /i, prefix: "cost of" },
      { pattern: /history|timeline|evolution/i, prefix: "history of" },
      { pattern: new RegExp(`future|trend|prediction|${CURRENT_YEAR}|${NEXT_YEAR}` , 'i'), prefix: "future of" },
      { pattern: /problem|issue|challenge|risk/i, prefix: "problems with" },
      { pattern: /benefit|advantage|pro/i, prefix: "benefits of" },
      { pattern: /example|case study/i, prefix: "examples of" },
    ];

    for (const aspect of aspects) {
      if (subQueries.length >= maxSubQueries) break;

      if (aspect.pattern.test(query)) {
        // Extract the main subject from the query
        const mainSubject = query
          .replace(aspect.pattern, "")
          .replace(/[?!.]/g, "")
          .trim();

        const subQuery = mainSubject
          ? `${aspect.prefix} ${mainSubject}`
          : query;

        if (!subQueries.includes(subQuery)) {
          subQueries.push(subQuery);
        }
      }
    }

    // Add statistics/data variant
    if (subQueries.length < maxSubQueries) {
      subQueries.push(`${query} statistics data`);
    }

    // Add recent variant
    if (subQueries.length < maxSubQueries) {
      subQueries.push(`${query} latest ${PREV_YEAR} ${CURRENT_YEAR}`);
    }

    return subQueries.slice(0, maxSubQueries);
  }
}

// Singleton
let _decomposer: QueryDecomposer | null = null;
export function getQueryDecomposer(): QueryDecomposer {
  if (!_decomposer) _decomposer = new QueryDecomposer();
  return _decomposer;
}
