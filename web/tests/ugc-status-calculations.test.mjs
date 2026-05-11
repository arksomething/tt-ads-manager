import assert from "node:assert/strict";
import test from "node:test";

import {
  allocateTotalByDailyWeights,
  calculateUgcStatusMetrics,
  getUgcStatusDailyProceedsMap,
  getUgcStatusSummaryProceeds,
  getUgcStatusSpendByDate,
  getUgcStatusTopVideoSearchParams,
  selectTopUgcStatusVideos,
} from "../src/server/dashboard/ugc-status-calculations.ts";

test("calculates UGC status profit and ratios", () => {
  const metrics = calculateUgcStatusMetrics({
    facelessViews: 40_000,
    proceeds: 1_000,
    spend: 250,
    ugcViews: 60_000,
    views: 100_000,
  });

  assert.equal(metrics.profit, 750);
  assert.equal(metrics.roas, 4);
  assert.equal(metrics.margin, 0.75);
  assert.equal(metrics.proceedsPerThousandViews, 10);
  assert.equal(metrics.spendPerThousandViews, 2.5);
  assert.equal(metrics.profitPerThousandViews, 7.5);
  assert.equal(metrics.ugcViewShare, 0.6);
  assert.equal(metrics.facelessViewShare, 0.4);
});

test("returns unavailable ratios when spend or views are zero", () => {
  const metrics = calculateUgcStatusMetrics({
    facelessViews: 0,
    proceeds: 0,
    spend: 0,
    ugcViews: 0,
    views: 0,
  });

  assert.equal(metrics.roas, null);
  assert.equal(metrics.margin, null);
  assert.equal(metrics.proceedsPerThousandViews, null);
  assert.equal(metrics.spendPerThousandViews, null);
  assert.equal(metrics.profitPerThousandViews, null);
  assert.equal(metrics.ugcViewShare, null);
  assert.equal(metrics.facelessViewShare, null);
});

test("allocates daily proceeds so rows add back to the summary total", () => {
  const allocations = allocateTotalByDailyWeights({
    dates: ["2026-05-04", "2026-05-05", "2026-05-06"],
    total: 2_470.65,
    weights: new Map([
      ["2026-05-04", 2_914.11],
      ["2026-05-05", 2_319.98],
      ["2026-05-06", 2_427.36],
    ]),
  });
  const total = [...allocations.values()].reduce((sum, value) => sum + value, 0);

  assert.equal(Number(total.toFixed(2)), 2_470.65);
  assert.deepEqual([...allocations.keys()], [
    "2026-05-04",
    "2026-05-05",
    "2026-05-06",
  ]);
});

test("allocates evenly when daily proceeds weights are unavailable", () => {
  const allocations = allocateTotalByDailyWeights({
    dates: ["2026-05-04", "2026-05-05", "2026-05-06"],
    total: 100,
    weights: new Map(),
  });

  assert.deepEqual([...allocations.values()], [33.33, 33.33, 33.34]);
});

test("calculates UGC status proceeds as non-renewal proceeds minus known ad spend", () => {
  const proceeds = getUgcStatusDailyProceedsMap({
    dates: ["2026-05-04", "2026-05-05", "2026-05-06"],
    appleSpendByDate: new Map([
      ["2026-05-04", 12.5],
      ["2026-05-05", 7.25],
    ]),
    dailyRows: [
      {
        date: "2026-05-04",
        newProceeds: 1_000,
        paidSpend: 300,
        renewal: 100,
        total: 1_100,
      },
      {
        date: "2026-05-05",
        newProceeds: null,
        paidSpend: 50,
        renewal: 200,
        total: 900,
      },
      {
        date: "2026-05-06",
        newProceeds: 100,
        paidSpend: 125,
        renewal: 0,
        total: 100,
      },
    ],
  });

  assert.deepEqual([...proceeds.values()], [687.5, 642.75, 0]);
  assert.equal(
    getUgcStatusSummaryProceeds({
      newProceeds: 1_900,
      paidSourceSpend: 494.75,
    }),
    1_405.25,
  );
});

test("reconciles daily UGC spend back to the UGC Pay summary total", () => {
  const spend = getUgcStatusSpendByDate({
    dates: [
      "2026-05-04",
      "2026-05-05",
      "2026-05-06",
      "2026-05-07",
      "2026-05-08",
      "2026-05-09",
      "2026-05-10",
    ],
    dailyRows: [
      { date: "2026-05-04", cpmSpend: 388.68, fixedSpend: 0 },
      { date: "2026-05-05", cpmSpend: 216.08, fixedSpend: 0 },
      { date: "2026-05-06", cpmSpend: 184.91, fixedSpend: 0 },
      { date: "2026-05-07", cpmSpend: 146.81, fixedSpend: 0 },
      { date: "2026-05-08", cpmSpend: 288.53, fixedSpend: 0 },
      { date: "2026-05-09", cpmSpend: 211.84, fixedSpend: 0 },
      { date: "2026-05-10", cpmSpend: 123.09, fixedSpend: 0 },
    ],
    totalCpmSpend: 1_157.13,
    totalFixedSpend: 0,
  });
  const total = [...spend.values()].reduce((sum, row) => sum + row.spend, 0);

  assert.equal(Number(total.toFixed(2)), 1_157.13);
  assert.equal(spend.get("2026-05-04")?.spend, 288.31);
});

test("selects the requested top UGC status videos by views", () => {
  const videos = [
    { id: "1", title: "one", creatorName: "A", url: null, views: 10, spend: 1 },
    { id: "2", title: "two", creatorName: "B", url: null, views: 60, spend: 6 },
    { id: "3", title: "three", creatorName: "C", url: null, views: 20, spend: 2 },
    { id: "4", title: "four", creatorName: "D", url: null, views: 50, spend: 5 },
    { id: "5", title: "five", creatorName: "E", url: null, views: 40, spend: 4 },
    { id: "6", title: "six", creatorName: "F", url: null, views: 30, spend: 3 },
  ];

  assert.deepEqual(
    selectTopUgcStatusVideos(videos, 3).map((video) => video.id),
    ["2", "4", "5"],
  );
});

test("builds UGC status top video search params with a 30 day lookback and 7 day view window", () => {
  assert.deepEqual(
    getUgcStatusTopVideoSearchParams({
      date: "2026-05-10",
      searchParams: {
        campaign: "creator-campaign",
        startDate: "2026-05-04",
        videoWindowStartDate: "2026-01-01",
      },
    }),
    {
      campaign: "creator-campaign",
      endDate: "2026-05-10",
      globalViewWindowDays: "7",
      payMode: "gained",
      reportTimeZone: "UTC",
      startDate: "2026-05-10",
      videoWindowStartDate: "2026-04-10",
      viewWindowMode: "first-days",
    },
  );
});
