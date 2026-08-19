import assert from "node:assert/strict";
import { test } from "node:test";

import { createThrottle, isDailyQuota, isRateLimit } from "./throttle.ts";

test("spaces sequential calls by at least the interval", async () => {
  const throttle = createThrottle(50);
  const stamps: number[] = [];
  for (let i = 0; i < 4; i++) {
    await throttle();
    stamps.push(Date.now());
  }

  // First call is immediate; each subsequent one waits out the interval.
  for (let i = 1; i < stamps.length; i++) {
    const gap = stamps[i] - stamps[i - 1];
    assert.ok(gap >= 45, `gap ${i} was ${gap}ms, expected >= ~50ms`);
  }
});

test("spaces calls even when several workers share one gate", async () => {
  // The failure this guards against: measuring the interval from when the
  // previous call *returned* lets concurrent workers all pass at once, which is
  // exactly the burst that triggers provider rate limits.
  const throttle = createThrottle(40);
  const stamps: number[] = [];

  await Promise.all(
    Array.from({ length: 4 }, async () => {
      await throttle();
      stamps.push(Date.now());
    }),
  );

  stamps.sort((a, b) => a - b);
  assert.equal(stamps.length, 4);
  const span = stamps[3] - stamps[0];
  assert.ok(span >= 110, `4 concurrent calls spanned only ${span}ms, expected >= ~120ms`);
});

test("an interval of zero disables pacing", async () => {
  const throttle = createThrottle(0);
  const started = Date.now();
  for (let i = 0; i < 20; i++) await throttle();
  assert.ok(Date.now() - started < 30);
});

test("recognises rate-limit errors across provider phrasings", () => {
  assert.ok(isRateLimit(new Error("429 Too Many Requests")));
  assert.ok(isRateLimit(new Error("Rate limit reached for gpt-4o-mini-tts")));
  assert.ok(isRateLimit("rate-limited"));

  assert.ok(!isRateLimit(new Error("401 Unauthorized")));
  assert.ok(!isRateLimit(new Error("getaddrinfo ENOTFOUND")));
  // Must not fire on an unrelated number that merely contains 429.
  assert.ok(!isRateLimit(new Error("wrote 4291 bytes")));
});

test("separates per-day quota exhaustion from per-minute burst limits", () => {
  // Verbatim from OpenAI on an unpaid account. Retrying this spends more of an
  // already-empty quota, so it must be distinguishable from a burst limit.
  const daily = new Error(
    "429 Rate limit reached for gpt-4o-mini-tts (for limit gpt-4o-mini) in organization " +
      "org-abc on requests per day (RPD): Limit 50, Used 50, Requested 1. Please try again in 28m48s.",
  );
  assert.ok(isDailyQuota(daily));
  assert.ok(isRateLimit(daily), "a daily cap is still a 429");

  const burst = new Error(
    "429 Rate limit reached for gpt-4o-mini-tts on requests per min (RPM): Limit 3, Used 3.",
  );
  assert.ok(isRateLimit(burst));
  assert.ok(!isDailyQuota(burst), "per-minute limits are retryable and must not abort the run");

  assert.ok(!isDailyQuota(new Error("401 Unauthorized")));
});
