import assert from "node:assert/strict";
import test from "node:test";

import {
  summarizeReportWarnings,
  summarizeUgcStatusWarnings,
} from "../src/lib/report-warnings.ts";

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

test("summarizes verbose UGC status provider diagnostics", () => {
  const result = summarizeUgcStatusWarnings([
    "Revenue targets UTC. Snapchat/Singular daily rows are Pacific-day aggregates, so they are mapped to UTC by provider-day start; exact UTC-day spend/proceeds splitting requires hourly exports.",
    "Singular spend is incomplete for Facebook; available spend is shown and profit may change when delayed cost rows arrive.",
    "Singular spend is incomplete for TikTok Ads; available spend is shown and profit may change when delayed cost rows arrive.",
    "Could not load TikTok ad metadata to enrich the matched rows with ad names or post details.",
    "TikTok returned 147 ad groups without a resolvable TikTok post ID. Those rows were excluded from per-video tallies.",
    "Singular matched 68 unresolved TikTok ad groups by name, but those creative rows still lacked an exact TikTok post ID, post URL, or creative ID for the selected videos.",
    "Singular lined up 68 unresolved TikTok ad groups by TikTok ad ID.",
    "Could not associate Vuk Santiago E. with a local creator record, so paid TikTok delivery cannot be attributed to these View Tally rows.",
    "Could not associate Ali Haider with a local creator record, so paid TikTok delivery cannot be attributed to these View Tally rows.",
    "View Tally returned 100 video rows while applying the 7-day view window for 2026-05-15 to 2026-05-17. Lower-view rows may be missing from this clipped window.",
    "Singular is still preparing the report for this date window. This page will check again automatically.",
    "Singular is still preparing the source proceeds report, so organic / UGC proceeds are hidden until the paid-source split is ready.",
    "Singular source proceeds report status is started. This page will check again automatically.",
    "Singular returned source rows, but actual revenue is not ready for this date window yet.",
    "Singular report status is queued. This page will check again automatically and reuse the export once it is ready.",
    "Singular report status is started. This page will check again automatically and reuse the export once it is ready.",
  ]);

  assert.deepEqual(result, [
    "Some Snapchat/Singular rows are Pacific-day aggregates mapped to UTC; exact UTC-day splitting would require hourly exports.",
    "Singular spend is incomplete for Facebook and TikTok Ads; profit may change as delayed cost rows arrive.",
    "Singular is still preparing one or more report exports. This page will check again automatically.",
    "Singular source proceeds are not ready for this window; organic / UGC proceeds are hidden until the paid-source split is ready.",
    "TikTok paid-delivery matching is partial for this window; some ad groups lack exact post IDs or creative metadata, so per-video paid deductions may be incomplete.",
    "2 creators not linked to local creator records; paid TikTok delivery may not be attributed to those View Tally rows.",
    "View Tally hit its 100-row response cap for part of this window; lower-view UGC rows may be missing.",
  ]);
});
