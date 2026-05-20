import assert from "node:assert/strict";
import test from "node:test";

import {
  getSingularSourceTimeZone,
  getUtcDateForProviderDate,
  REVENUE_REPORT_TIME_ZONE,
  SNAPCHAT_REVENUE_TIME_ZONE,
} from "../src/server/revenue/revenue-timezone.ts";

test("keeps UTC provider dates on the same UTC report date", () => {
  assert.equal(
    getUtcDateForProviderDate({
      date: "2026-05-09",
      providerTimeZone: REVENUE_REPORT_TIME_ZONE,
    }),
    "2026-05-09",
  );
});

test("maps Snapchat source rows to the Pacific provider timezone", () => {
  assert.equal(getSingularSourceTimeZone("Snapchat"), SNAPCHAT_REVENUE_TIME_ZONE);
  assert.equal(getSingularSourceTimeZone("Snap Ads"), SNAPCHAT_REVENUE_TIME_ZONE);
  assert.equal(getSingularSourceTimeZone("TikTok Ads"), REVENUE_REPORT_TIME_ZONE);
});

test("maps Pacific provider-day buckets to the UTC date of provider-day start", () => {
  assert.equal(
    getUtcDateForProviderDate({
      date: "2026-05-09",
      providerTimeZone: SNAPCHAT_REVENUE_TIME_ZONE,
    }),
    "2026-05-09",
  );
});
