import assert from "node:assert/strict";
import test from "node:test";

import {
  applyFacelessPricingToCreatorRows,
  applyFacelessPricingToDailyRows,
  buildCreatorRowsFromSpend,
  buildDailyRowsFromSpend,
  getFacelessCostAmount,
} from "../src/server/viewsbase/faceless-calculations.ts";

const dailySpendRows = [
  {
    date: "2026-05-04",
    status: "mixed",
    total_spend: 113.045,
    actual_spend: 43.83,
    projected_spend: 69.215,
    paid_views: 245_809,
    creator_breakdown: [
      {
        influencer_id: "creator-a",
        influencer_name: "Creator A",
        handle: "creator_a",
        spend: 25,
        actual_spend: 5,
        projected_spend: 20,
        paid_views: 50_000,
        video_count: 3,
        estimated_cpm_video_count: 2,
        estimated_cpm: 0.4,
      },
      {
        influencer_id: "creator-b",
        influencer_name: "Creator B",
        handle: "@creator_b",
        spend: 10,
        actual_spend: 10,
        projected_spend: 0,
        paid_views: 20_000,
        video_count: 1,
      },
    ],
  },
  {
    date: "2026-05-03",
    status: "mixed",
    total_spend: 126.67,
    actual_spend: 67.48,
    projected_spend: 59.19,
    paid_views: 288_951,
    creator_breakdown: [
      {
        influencer_id: "creator-a",
        influencer_name: "Creator A",
        handle: "creator_a",
        spend: 30,
        actual_spend: 0,
        projected_spend: 30,
        paid_views: 60_000,
        video_count: 2,
        estimated_cpm_video_count: 3,
        estimated_cpm: 0.5,
      },
      {
        influencer_id: "creator-c",
        influencer_name: "Creator C",
        handle: "creator_c",
        spend: 39.74,
        actual_spend: 39.74,
        projected_spend: 0,
        paid_views: 134_900,
        video_count: 4,
      },
    ],
  },
];

test("faceless daily rows preserve ViewsBase daily-spend ledger rows", () => {
  const rows = buildDailyRowsFromSpend(dailySpendRows);

  assert.deepEqual(
    rows.map((row) => row.date),
    ["2026-05-03", "2026-05-04"],
  );
  assert.equal(rows[0].views, 288_951);
  assert.equal(rows[0].baseTotalSpend, 126.67);
  assert.equal(rows[0].totalSpend, 126.67);
  assert.equal(rows[0].actualSpend, 67.48);
  assert.equal(rows[0].projectedSpend, 59.19);
  assert.equal(rows[0].managementFee, 0);
  assert.equal(rows[0].creatorCount, 2);
  assert.equal(rows[0].status, "mixed");

  assert.equal(rows[1].views, 245_809);
  assert.equal(rows[1].totalSpend, 113.05);
  assert.equal(rows[1].projectedSpend, 69.22);
});

test("faceless creator rows aggregate repeated creators and include actual-only spend drivers", () => {
  const creators = buildCreatorRowsFromSpend(dailySpendRows);

  assert.deepEqual(
    creators.map((creator) => creator.handle),
    ["creator_a", "creator_c", "creator_b"],
  );

  const creatorA = creators[0];
  assert.equal(creatorA.name, "Creator A");
  assert.equal(creatorA.views, 110_000);
  assert.equal(creatorA.videoCount, 5);
  assert.equal(creatorA.baseTotalSpend, 55);
  assert.equal(creatorA.totalSpend, 55);
  assert.equal(creatorA.actualSpend, 5);
  assert.equal(creatorA.projectedSpend, 50);
  assert.equal(creatorA.effectiveCpm, 0.46);

  const actualOnlyCreator = creators.find(
    (creator) => creator.handle === "creator_c",
  );
  assert.ok(actualOnlyCreator);
  assert.equal(actualOnlyCreator.totalSpend, 39.74);
  assert.equal(actualOnlyCreator.projectedSpend, 0);
  assert.equal(actualOnlyCreator.effectiveCpm, 0.29);
});

test("faceless pricing adds Larsie CPM markup and prorated fixed fees", () => {
  const pricedRows = applyFacelessPricingToDailyRows({
    campaignSlug: "gotall-larsie",
    startDate: "2026-05-03",
    endDate: "2026-05-04",
    rows: buildDailyRowsFromSpend(dailySpendRows),
  });

  assert.equal(pricedRows[0].baseTotalSpend, 126.67);
  assert.equal(pricedRows[0].cpmManagementFee, 12.67);
  assert.equal(pricedRows[0].fixedManagementFee, 16.13);
  assert.equal(pricedRows[0].dashboardFee, 0);
  assert.equal(pricedRows[0].managementFee, 28.8);
  assert.equal(pricedRows[0].totalSpend, 155.47);

  assert.equal(pricedRows[1].cpmManagementFee, 11.31);
  assert.equal(pricedRows[1].fixedManagementFee, 16.13);
  assert.equal(pricedRows[1].totalSpend, 140.49);
});

test("faceless pricing adds Mads CPM markup and dashboard fee once", () => {
  const pricedRows = applyFacelessPricingToDailyRows({
    campaignSlug: "gotall-mads",
    includeDashboardFee: true,
    startDate: "2026-05-03",
    endDate: "2026-05-04",
    rows: buildDailyRowsFromSpend(dailySpendRows),
  });

  assert.equal(pricedRows[0].cpmManagementFee, 25.33);
  assert.equal(pricedRows[0].fixedManagementFee, 0);
  assert.equal(pricedRows[0].dashboardFee, 8.06);
  assert.equal(pricedRows[0].managementFee, 33.39);
  assert.equal(pricedRows[0].totalSpend, 160.06);
});

test("faceless creator pricing applies campaign CPM markup without fixed fees", () => {
  const creators = applyFacelessPricingToCreatorRows({
    campaignSlug: "gotall-mads",
    rows: buildCreatorRowsFromSpend(dailySpendRows),
  });
  const creatorA = creators.find((creator) => creator.handle === "creator_a");

  assert.ok(creatorA);
  assert.equal(creatorA.baseTotalSpend, 55);
  assert.equal(creatorA.managementFee, 11);
  assert.equal(creatorA.totalSpend, 66);
  assert.equal(creatorA.effectiveCpm, 0.6);
});

test("faceless cost uses the stronger available ViewsBase price signal", () => {
  assert.equal(
    getFacelessCostAmount({
      projectedSpend: 59.19,
      totalSpend: 126.67,
    }),
    126.67,
  );
  assert.equal(
    getFacelessCostAmount({
      projectedSpend: 84.42,
      totalSpend: 0,
    }),
    84.42,
  );
  assert.equal(
    getFacelessCostAmount({
      projectedSpend: 25.555,
      totalSpend: 20,
    }),
    25.56,
  );
});
