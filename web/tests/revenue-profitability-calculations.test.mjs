import assert from "node:assert/strict";
import test from "node:test";

import {
  getDateKeys,
  getRevenueUgcPaySearchParams,
} from "../src/server/revenue/revenue-profitability-calculations.ts";

test("builds exact UGC Pay query params for revenue profitability", () => {
  assert.deepEqual(
    getRevenueUgcPaySearchParams({
      endDate: "2026-05-09",
      searchParams: {
        campaign: "creator-campaign",
        startDate: "2026-01-01",
        videoWindowStartDate: "2026-04-01",
      },
      startDate: "2026-05-03",
    }),
    {
      campaign: "creator-campaign",
      endDate: "2026-05-09",
      globalViewWindowDays: "7",
      payMode: "gained",
      reportTimeZone: "UTC",
      startDate: "2026-05-03",
      videoWindowStartDate: "2026-04-01",
      viewWindowMode: "first-days",
    },
  );
});

test("defaults revenue UGC Pay video window to seven days before the report", () => {
  assert.equal(
    getRevenueUgcPaySearchParams({
      endDate: "2026-05-09",
      searchParams: {},
      startDate: "2026-05-03",
    }).videoWindowStartDate,
    "2026-04-27",
  );
});

test("returns inclusive daily keys for the profitability loader", () => {
  assert.deepEqual(getDateKeys("2026-05-03", "2026-05-05"), [
    "2026-05-03",
    "2026-05-04",
    "2026-05-05",
  ]);
});
