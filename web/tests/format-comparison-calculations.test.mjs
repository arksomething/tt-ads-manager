import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateFormatComparison,
  normalizeFormatTag,
} from "../src/server/dashboard/format-comparison-calculations.ts";

function video(overrides) {
  return {
    creatorName: "Creator",
    date: "2026-05-24",
    formatTag: null,
    id: overrides.sourceVideoId,
    sourceVideoId: overrides.sourceVideoId,
    thumbnailUrl: null,
    title: overrides.sourceVideoId,
    url: null,
    views: overrides.views,
    ...overrides,
  };
}

test("ridge-shrinks fitted revenue per 1k values toward the global baseline", () => {
  const result = calculateFormatComparison([
    {
      date: "2026-05-24",
      revenue: 30,
      videos: [
        video({ sourceVideoId: "a-1", formatTag: "Format A", views: 100 }),
        video({ sourceVideoId: "b-1", formatTag: "Format B", views: 100 }),
      ],
    },
    {
      date: "2026-05-25",
      revenue: 20,
      videos: [
        video({
          date: "2026-05-25",
          sourceVideoId: "a-2",
          formatTag: "Format A",
          views: 100,
        }),
      ],
    },
    {
      date: "2026-05-26",
      revenue: 10,
      videos: [
        video({
          date: "2026-05-26",
          sourceVideoId: "b-2",
          formatTag: "Format B",
          views: 100,
        }),
      ],
    },
  ]);

  const [formatA, formatB] = result.formatRows;
  const [dayOneFormatA, dayOneFormatB] = result.dailyRows[0].rows;

  assert.equal(formatA.label, "Format A");
  assert.equal(formatA.revenue, 35);
  assert.equal(formatA.views, 200);
  assert.equal(Number(formatA.revenuePerThousandViews?.toFixed(2)), 175);
  assert.equal(formatB.label, "Format B");
  assert.equal(formatB.revenue, 25);
  assert.equal(formatB.views, 200);
  assert.equal(Number(formatB.revenuePerThousandViews?.toFixed(2)), 125);
  assert.equal(result.dailyRows[0].revenue, 30);
  assert.equal(Number(dayOneFormatA.revenuePerThousandViews?.toFixed(2)), 175);
  assert.equal(Number(dayOneFormatB.revenuePerThousandViews?.toFixed(2)), 125);
  assert.equal(Number(dayOneFormatA.allocatedRevenue?.toFixed(2)), 17.5);
  assert.equal(Number(dayOneFormatB.allocatedRevenue?.toFixed(2)), 12.5);
  assert.equal(result.summary.revenue, 60);
  assert.equal(result.summary.views, 400);
  assert.equal(result.summary.taggedViews, 400);
});

test("shrinks weakly identified formats instead of forcing hard zero coefficients", () => {
  const result = calculateFormatComparison([
    {
      date: "2026-05-24",
      revenue: 10,
      videos: [
        video({ sourceVideoId: "a-1", formatTag: "Format A", views: 1000 }),
        video({ sourceVideoId: "b-1", formatTag: "Format B", views: 1000 }),
      ],
    },
    {
      date: "2026-05-25",
      revenue: 10,
      videos: [
        video({
          date: "2026-05-25",
          sourceVideoId: "a-2",
          formatTag: "Format A",
          views: 1000,
        }),
      ],
    },
  ]);

  const baseline = result.summary.revenuePerThousandViews;
  const formatA = result.formatRows.find((row) => row.label === "Format A");
  const formatB = result.formatRows.find((row) => row.label === "Format B");

  assert.ok(baseline !== null);
  assert.ok(formatA);
  assert.ok(formatB);
  assert.ok((formatA.revenuePerThousandViews ?? 0) > baseline);
  assert.ok((formatB.revenuePerThousandViews ?? 0) > 0);
  assert.ok((formatB.revenuePerThousandViews ?? Infinity) < baseline);
});

test("normalizes manual format labels before grouping", () => {
  const result = calculateFormatComparison([
    {
      date: "2026-05-24",
      revenue: 40,
      videos: [
        video({ sourceVideoId: "a-1", formatTag: " Format   A ", views: 100 }),
        video({ sourceVideoId: "a-2", formatTag: "Format A", views: 100 }),
      ],
    },
  ]);

  assert.equal(normalizeFormatTag("  Format   A "), "Format A");
  assert.equal(result.formatRows.length, 1);
  assert.equal(result.formatRows[0].label, "Format A");
  assert.equal(result.formatRows[0].revenuePerThousandViews, 200);
});

test("leaves revenue per 1k unavailable when daily revenue cannot be allocated", () => {
  const result = calculateFormatComparison([
    {
      date: "2026-05-24",
      revenue: null,
      videos: [video({ sourceVideoId: "a-1", formatTag: "Format A", views: 100 })],
    },
  ]);

  assert.equal(result.dailyRows[0].revenue, null);
  assert.equal(result.videoRows[0].allocatedRevenue, null);
  assert.equal(result.formatRows[0].revenuePerThousandViews, null);
  assert.equal(result.summary.revenuePerThousandViews, null);
});
