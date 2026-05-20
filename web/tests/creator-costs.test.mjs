import assert from "node:assert/strict";
import test from "node:test";

import {
  getFacelessCostBreakdown,
  getFacelessDailyCostBreakdown,
  getUgcManagementCostForDates,
  getUgcManagementDailyCost,
} from "../src/server/revenue/creator-costs.ts";

test("prorates the UGC manager monthly cost by calendar day", () => {
  assert.equal(getUgcManagementDailyCost("2026-05-04"), 32.26);
  assert.equal(
    getUgcManagementCostForDates(["2026-05-04", "2026-05-05"]),
    64.52,
  );
});

test("splits selected faceless spend into base and management", () => {
  assert.deepEqual(
    getFacelessDailyCostBreakdown({
      baseProjectedSpend: 100,
      baseTotalSpend: 90,
      projectedSpend: 120,
      totalSpend: 100,
    }),
    {
      baseSpend: 100,
      managementSpend: 20,
      totalSpend: 120,
    },
  );
});

test("sums faceless base and management breakouts across daily rows", () => {
  assert.deepEqual(
    getFacelessCostBreakdown({
      dailyRows: [
        {
          baseProjectedSpend: 0,
          baseTotalSpend: 90,
          date: "2026-05-04",
          projectedSpend: 0,
          totalSpend: 100,
        },
        {
          baseProjectedSpend: 100,
          baseTotalSpend: 70,
          date: "2026-05-05",
          projectedSpend: 120,
          totalSpend: 80,
        },
      ],
      totals: {
        managementFee: 30,
        projectedSpend: 120,
        totalSpend: 180,
      },
    }),
    {
      baseSpend: 190,
      managementSpend: 30,
      totalSpend: 220,
    },
  );
});
