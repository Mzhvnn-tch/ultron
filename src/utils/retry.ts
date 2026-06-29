import { logger } from "./logger.js";

export interface RetryOptions {
  maxRetries?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  backoffFactor?: number;
}

/**
 * Robust Exponential Backoff & Resilience Utility.
 * Wraps dynamic network fetches with structured retries and backoff.
 */
export async function withExponentialBackoff<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const maxRetries = options.maxRetries ?? 3;
  const initialDelay = options.initialDelayMs ?? 300;
  const maxDelay = options.maxDelayMs ?? 3000;
  const factor = options.backoffFactor ?? 2;

  let attempt = 0;
  let currentDelay = initialDelay;

  while (true) {
    try {
      return await fn();
    } catch (err: any) {
      attempt++;
      if (attempt > maxRetries) {
        logger.error({ attempt, error: err.message }, "[Resilience] Max retries exceeded");
        throw err;
      }

      logger.warn(
        { attempt, nextDelayMs: currentDelay, error: err.message },
        "[Resilience] Transient error detected, retrying with exponential backoff"
      );

      await new Promise((resolve) => setTimeout(resolve, currentDelay));
      currentDelay = Math.min(currentDelay * factor, maxDelay);
    }
  }
}
