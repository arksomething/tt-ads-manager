import assert from "node:assert/strict";
import test from "node:test";

import { mapWithConcurrency } from "../src/lib/concurrency.ts";
import {
  formatRetryDelay,
  getProviderRateLimitRetryDelayMs,
  parseRetryAfterHeaderMs,
} from "../src/lib/provider-rate-limit.ts";

test("mapWithConcurrency caps simultaneous work", async () => {
  let active = 0;
  let maxActive = 0;

  const results = await mapWithConcurrency(
    [1, 2, 3, 4, 5, 6, 7],
    3,
    async (value) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return value * 2;
    },
  );

  assert.equal(maxActive, 3);
  assert.deepEqual(results, [2, 4, 6, 8, 10, 12, 14]);
});

test("provider rate-limit retry delay prefers Retry-After seconds", () => {
  const delayMs = getProviderRateLimitRetryDelayMs({
    status: 429,
    message: "Rate limit exceeded, please try again in 15 minutes.",
    retryAfterSeconds: 30,
  });

  assert.equal(delayMs, 30_000);
});

test("provider rate-limit retry delay parses viral.app messages", () => {
  const delayMs = getProviderRateLimitRetryDelayMs({
    status: 429,
    message:
      "Rate limit exceeded, please try again in 15 minutes (2026-05-09 20:01:48).",
  });

  assert.equal(delayMs, 15 * 60_000);
  assert.equal(formatRetryDelay(delayMs), "15 minutes");
});

test("Retry-After header parser supports absolute dates", () => {
  const delayMs = parseRetryAfterHeaderMs(
    "Sat, 09 May 2026 20:02:18 GMT",
    Date.parse("Sat, 09 May 2026 20:01:48 GMT"),
  );

  assert.equal(delayMs, 30_000);
});
