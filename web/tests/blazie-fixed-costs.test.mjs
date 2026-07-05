import assert from "node:assert/strict";
import test from "node:test";

import {
  BLAZIE_FIXED_COST_MONTHLY_AMOUNT,
  calculateBlazieProfitabilityMetrics,
  getBlazieFixedCostTarget,
  hasPendingBlazieOrganicProceeds,
} from "../src/lib/blazie-fixed-costs.ts";

test("uses a 15000 monthly fixed-cost target for Blazie", () => {
  assert.equal(BLAZIE_FIXED_COST_MONTHLY_AMOUNT, 15_000);
});

test("prorates Blazie's fixed-cost target by selected UTC calendar days", () => {
  assert.equal(getBlazieFixedCostTarget("2026-05-14", "2026-05-16"), 1451.61);
  assert.equal(getBlazieFixedCostTarget("2026-02-01", "2026-02-28"), 15_000);
});

test("calculates Blazie video ROAS with fixed cost outside ROAS", () => {
  const metrics = calculateBlazieProfitabilityMetrics({
    fixedCost: 750,
    videoRevenue: 1_000,
    videoSpend: 250,
  });

  assert.equal(metrics.videoRevenue, 1_000);
  assert.equal(metrics.videoSpend, 250);
  assert.equal(metrics.fixedCost, 750);
  assert.equal(metrics.totalCost, 1_000);
  assert.equal(metrics.profitLoss, 0);
  assert.equal(metrics.roas, 4);
});

test("does not mark Blazie proceeds pending for unrelated Singular warnings", () => {
  assert.equal(
    hasPendingBlazieOrganicProceeds({
      proceeds: 3_612.47,
      warnings: [
        "Singular is still preparing the report for this date window. This page will check again automatically.",
      ],
    }),
    false,
  );

  assert.equal(
    hasPendingBlazieOrganicProceeds({
      proceeds: 0,
      warnings: [
        "Singular is still preparing the report for this date window. This page will check again automatically.",
      ],
    }),
    false,
  );
});

test("marks Blazie proceeds pending when source proceeds are unavailable", () => {
  assert.equal(
    hasPendingBlazieOrganicProceeds({
      proceeds: 0,
      warnings: [
        "Singular is still preparing the source proceeds report, so organic / UGC proceeds are hidden until the paid-source split is ready.",
      ],
    }),
    true,
  );

  assert.equal(
    hasPendingBlazieOrganicProceeds({
      proceeds: 100,
      warnings: [
        "Singular source proceeds are not ready for this window; organic / UGC proceeds are hidden until the paid-source split is ready.",
      ],
    }),
    true,
  );

  assert.equal(
    hasPendingBlazieOrganicProceeds({
      proceeds: 100,
      warnings: [
        "Singular source proceeds report status is started. This page will check again automatically.",
      ],
    }),
    true,
  );

  assert.equal(
    hasPendingBlazieOrganicProceeds({
      proceeds: 100,
      warnings: [
        "Singular returned source rows, but actual revenue is not ready for this date window yet.",
      ],
    }),
    true,
  );

  assert.equal(
    hasPendingBlazieOrganicProceeds({
      proceeds: 0,
      warnings: [
        "Some Snapchat/Singular rows are Pacific-day aggregates mapped to UTC; exact UTC-day splitting would require hourly exports.",
        "Singular spend is incomplete for Snapchat; profit may change as delayed cost rows arrive.",
      ],
    }),
    false,
  );
});
