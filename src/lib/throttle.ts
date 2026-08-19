/**
 * Request pacing helpers.
 *
 * Provider rate limits are the practical constraint on the bakeoff: OpenAI's
 * TTS endpoint rejects parallel requests well below the rate a naive worker
 * pool asks for. These live in their own module so the spacing logic can be
 * tested without executing a spike script's main().
 */

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Returns a gate that resolves at most once per `minIntervalMs`.
 *
 * Slots are reserved at call time rather than measured after the previous call
 * returns, so N concurrent workers sharing one gate still produce evenly spaced
 * requests instead of bursting. An interval of 0 disables pacing entirely.
 */
export function createThrottle(minIntervalMs: number): () => Promise<void> {
  let nextSlot = 0;
  return async () => {
    if (minIntervalMs <= 0) return;
    const now = Date.now();
    const wait = Math.max(0, nextSlot - now);
    nextSlot = Math.max(now, nextSlot) + minIntervalMs;
    if (wait > 0) await sleep(wait);
  };
}

/** Whether an error from any provider is a rate-limit rejection worth retrying. */
export function isRateLimit(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /\b429\b|rate.?limit|too many requests/i.test(message);
}

/**
 * Whether a 429 is a per-*day* quota rather than a per-minute burst limit.
 *
 * The distinction decides whether waiting is worth anything. Backing off and
 * retrying clears a per-minute limit; against a daily cap it just burns more
 * requests against a quota that is already spent, turning one failure into
 * dozens. These abort the run instead.
 */
export function isDailyQuota(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /requests per day|\bRPD\b|per day \(RPD\)/i.test(message);
}
