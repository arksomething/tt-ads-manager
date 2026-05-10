import assert from "node:assert/strict";
import test from "node:test";

import { summarizeReportWarnings } from "../src/lib/report-warnings.ts";

test("summarizes repeated viral.app TikTok post rate-limit warnings", () => {
  const result = summarizeReportWarnings([
    "Could not resolve TikTok post 7633575911379569933 in viral.app: Rate limit exceeded, please try again in 15 minutes (2026-05-09 20:01:48).",
    "Could not resolve TikTok post 7633535691149806861 in viral.app: Rate limit exceeded, please try again in 15 minutes (2026-05-09 20:01:48).",
    "SINGULAR_APP_NAMES is not set, so this leaderboard may span more than one app.",
  ]);

  assert.deepEqual(result.summaryWarnings, [
    "viral.app rate-limited 2 TikTok post lookups. Retry in 15 minutes. Last response: 2026-05-09 20:01:48.",
    "SINGULAR_APP_NAMES is not set, so this leaderboard may span more than one app.",
  ]);
  assert.equal(result.detailWarnings.length, 3);
});
