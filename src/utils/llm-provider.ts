import { config } from "../config.js";
import { logger } from "./logger.js";
import { withExponentialBackoff } from "./retry.js";

export type LLMProviderType = "openai" | "gemini" | "anthropic" | "ollama";

export interface LLMRequest {
  prompt: string;
  systemPrompt?: string;
  provider?: LLMProviderType;
  model?: string;
}

/**
 * Universal Unified LLM Provider Abstraction Layer.
 * Supports dynamic provider swapping (OpenAI, Gemini, Anthropic, Ollama local models)
 * with built-in fallback chains and resilience.
 */
export class LLMProvider {
  async complete(req: LLMRequest): Promise<string> {
    const provider = req.provider || (process.env.LLM_PROVIDER as LLMProviderType) || "openai";
    logger.info({ provider, model: req.model }, "[LLMProvider] Dispatching request");

    return withExponentialBackoff(async () => {
      if (provider === "anthropic") {
        return this.callAnthropic(req);
      } else if (provider === "gemini") {
        return this.callGemini(req);
      } else if (provider === "ollama") {
        return this.callOllama(req);
      } else {
        return this.callOpenAI(req);
      }
    }, { maxRetries: 2 });
  }

  private async callOpenAI(req: LLMRequest): Promise<string> {
    const apiKey = config.llm.apiKey;
    const baseUrl = config.llm.baseUrl;
    const model = req.model || config.llm.model;

    const resp = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          ...(req.systemPrompt ? [{ role: "system", content: req.systemPrompt }] : []),
          { role: "user", content: req.prompt },
        ],
        temperature: 0.2,
      }),
    });

    if (!resp.ok) {
      throw new Error(`OpenAI API error: ${resp.status}`);
    }

    const data = await resp.json() as any;
    return data.choices?.[0]?.message?.content || "";
  }

  private async callAnthropic(req: LLMRequest): Promise<string> {
    const apiKey = process.env.ANTHROPIC_API_KEY || config.llm.apiKey;
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: req.model || "claude-3-5-sonnet-20241022",
        max_tokens: 1024,
        messages: [{ role: "user", content: req.prompt }],
      }),
    });

    if (!resp.ok) throw new Error(`Anthropic API error: ${resp.status}`);
    const data = await resp.json() as any;
    return data.content?.[0]?.text || "";
  }

  private async callGemini(req: LLMRequest): Promise<string> {
    const apiKey = process.env.GEMINI_API_KEY || config.llm.apiKey;
    const model = req.model || "gemini-1.5-flash";
    const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: req.prompt }] }],
      }),
    });

    if (!resp.ok) throw new Error(`Gemini API error: ${resp.status}`);
    const data = await resp.json() as any;
    return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
  }

  private async callOllama(req: LLMRequest): Promise<string> {
    const baseUrl = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
    const resp = await fetch(`${baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: req.model || "llama3",
        prompt: req.prompt,
        stream: false,
      }),
    });

    if (!resp.ok) throw new Error(`Ollama API error: ${resp.status}`);
    const data = await resp.json() as any;
    return data.response || "";
  }
}

let _llmProvider: LLMProvider | null = null;
export function getLLMProvider(): LLMProvider {
  if (!_llmProvider) _llmProvider = new LLMProvider();
  return _llmProvider;
}
