import dotenv from "dotenv";
dotenv.config();

export const config = {
  server: {
    port: parseInt(process.env.PORT || "3001"),
    host: process.env.HOST || "0.0.0.0",
  },

  llm: {
    apiKey: process.env.LLM_API_KEY || "",
    baseUrl: process.env.LLM_BASE_URL || "https://api.openai.com/v1",
    model: process.env.LLM_MODEL || "gpt-4o",
  },

  browser: {
    headless: process.env.BROWSER_HEADLESS !== "false",
    timeout: parseInt(process.env.BROWSER_TIMEOUT || "30000"),
    stealthMode: process.env.STEALTH_MODE !== "false",
  },

  cache: {
    dbPath: process.env.CACHE_DB_PATH || "./data/endpoints.db",
    ttlHours: parseInt(process.env.CACHE_TTL_HOURS || "720"),
  },

  rateLimit: {
    maxConcurrentDomains: parseInt(process.env.MAX_CONCURRENT_DOMAINS || "5"),
    requestDelayMs: parseInt(process.env.REQUEST_DELAY_MS || "500"),
  },

  cap: {
    enabled: process.env.CAP_ENABLED === "true",
    registryUrl: process.env.CAP_REGISTRY_URL || "http://localhost:4000",
    agentPrivateKey: process.env.CAP_AGENT_PRIVATE_KEY || "",
  },
};

export type Config = typeof config;
