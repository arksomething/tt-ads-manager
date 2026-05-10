import assert from "node:assert/strict";
import test from "node:test";

import { normalizeAppleSearchAdsDashboardReport } from "../src/server/adapty/dashboard-client.ts";

test("normalizes Apple Search Ads dashboard totals from Adapty payloads", () => {
  const report = normalizeAppleSearchAdsDashboardReport({
    campaignPayload: {
      data: [
        {
          internal_id: "campaign-1",
          metrics: {
            local_spend: 100,
            total_installs: 20,
          },
        },
        {
          internal_id: "campaign-2",
          metrics: {
            local_spend: 50,
            total_installs: 10,
          },
        },
      ],
    },
    totalPayload: {
      data: {
        adapty_installs: 25,
        paid: 8,
        revenue: {
          gross: {
            total: 320,
          },
          net: {
            total: 260,
          },
          proceeds: {
            total: 275,
          },
        },
        spend: 155,
      },
    },
  });

  assert.equal(report.configured, true);
  assert.equal(report.rowCount, 2);
  assert.equal(report.revenue, 275);
  assert.equal(report.revenueBasis, "proceeds");
  assert.equal(report.spend, 155);
  assert.equal(report.installs, 25);
  assert.equal(report.conversions, 8);
  assert.deepEqual(report.warnings, []);
});

test("falls back to campaign row spend and installs when total payload is absent", () => {
  const report = normalizeAppleSearchAdsDashboardReport({
    campaignPayload: {
      data: [
        {
          metrics: {
            local_spend: "12.50",
            total_installs: "3",
          },
        },
        {
          metrics: {
            local_spend: 7.5,
            total_installs: 2,
          },
        },
      ],
    },
  });

  assert.equal(report.rowCount, 2);
  assert.equal(report.revenue, null);
  assert.equal(report.spend, 20);
  assert.equal(report.installs, 5);
  assert.deepEqual(report.warnings, [
    "Adapty Ads Manager returned Apple Search Ads rows without a revenue total.",
  ]);
});
