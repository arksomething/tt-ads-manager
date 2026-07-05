import assert from "node:assert/strict";
import test from "node:test";

import {
  getInitialDetailedStatisticsOpen,
  getNextExpandedUgcStatusDates,
  getTikTokEmbedPlayerUrl,
  getTikTokEmbedPostId,
  getUgcStatusVideoViewShare,
} from "../src/lib/ugc-status-view.ts";

test("keeps detailed statistics collapsed by default for Blazie", () => {
  assert.equal(getInitialDetailedStatisticsOpen("blazie"), false);
});

test("keeps detailed statistics collapsed by default outside Blazie", () => {
  assert.equal(getInitialDetailedStatisticsOpen("default"), false);
  assert.equal(getInitialDetailedStatisticsOpen(), false);
});

test("toggles UGC status expanded dates without closing other rows", () => {
  assert.deepEqual(getNextExpandedUgcStatusDates([], "2026-05-27"), [
    "2026-05-27",
  ]);
  assert.deepEqual(
    getNextExpandedUgcStatusDates(["2026-05-27"], "2026-05-28"),
    ["2026-05-27", "2026-05-28"],
  );
  assert.deepEqual(
    getNextExpandedUgcStatusDates(
      ["2026-05-27", "2026-05-28"],
      "2026-05-27",
    ),
    ["2026-05-28"],
  );
});

test("builds TikTok embed player URLs from post ids", () => {
  assert.equal(
    getTikTokEmbedPostId({
      sourceVideoId: "7371234567890123456",
      url: "https://www.tiktok.com/@creator/video/111",
    }),
    "7371234567890123456",
  );
  assert.equal(
    getTikTokEmbedPostId({
      url: "https://www.tiktok.com/@creator/video/7371234567890123456",
    }),
    "7371234567890123456",
  );
  assert.equal(
    getTikTokEmbedPlayerUrl("7371234567890123456"),
    "https://www.tiktok.com/player/v1/7371234567890123456",
  );
});

test("calculates a top UGC video's share of its matching video set views", () => {
  assert.equal(getUgcStatusVideoViewShare(25_000, 100_000), 0.25);
  assert.equal(getUgcStatusVideoViewShare(0, 100_000), 0);
});

test("does not display top UGC video view shares above 100 percent", () => {
  assert.equal(getUgcStatusVideoViewShare(140_000, 100_000), 1);
});

test("does not calculate a top UGC video view share without total views", () => {
  assert.equal(getUgcStatusVideoViewShare(25_000, 0), null);
  assert.equal(getUgcStatusVideoViewShare(25_000, Number.NaN), null);
});
