import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSpendReport,
  buildSpendReportFromRevenueProfitability,
} from "../src/server/reporting/spend.ts";

const baseArgs = {
  organizationSlug: "gotall",
  range: {
    startDate: "2026-05-01",
    endDate: "2026-05-03",
  },
  freshness: {
    incompleteDays: [],
    missingDays: [],
    staleDays: [],
  },
  warnings: [],
};

function fact(metricKey, value, currency = "USD") {
  return {
    currency,
    metricKey,
    unit: "currency",
    value,
  };
}

test("builds non-overlapping spend totals with nested category detail", () => {
  const report = buildSpendReport({
    ...baseArgs,
    facts: [
      fact("spend.paid.total", 300),
      fact("spend.tiktok", 225),
      fact("spend.ugc.total", 100),
      fact("spend.ugc.fixed", 35),
      fact("spend.ugc.cpm_video_pay", 65),
      fact("spend.faceless.total", 50),
      fact("spend.faceless.base", 40),
      fact("spend.faceless.management_fee", 10),
      fact("spend.operating.total", 25),
      fact("spend.operating.office", 15),
    ],
  });

  assert.equal(report.currency, "USD");
  assert.equal(report.grandTotal, 475);

  const paidAds = report.categories.find((category) => category.key === "paid_ads");
  assert.equal(paidAds?.total, 300);
  assert.equal(paidAds?.basis, "metric");
  assert.equal(
    paidAds?.children.find((child) => child.key === "ads.tiktok")?.total,
    225,
  );

  const ugc = report.categories.find((category) => category.key === "ugc");
  assert.equal(ugc?.total, 100);
  assert.equal(
    ugc?.children.find((child) => child.key === "ugc.fixed")?.total,
    35,
  );

  const faceless = report.categories.find((category) => category.key === "faceless");
  assert.equal(faceless?.total, 50);
  assert.equal(
    faceless?.children.find((child) => child.key === "faceless.management_fee")?.total,
    10,
  );

  const operating = report.categories.find((category) => category.key === "operating");
  assert.equal(operating?.total, 25);
  assert.equal(
    operating?.children.find((child) => child.key === "operating.office")?.total,
    15,
  );
});

test("falls back to child spend when a parent total is not emitted", () => {
  const report = buildSpendReport({
    ...baseArgs,
    facts: [
      fact("spend.tiktok", 200),
      fact("spend.facebook", 125),
      fact("spend.operating.office", 40),
      fact("spend.operating.singular", 15),
    ],
  });

  const paidAds = report.categories.find((category) => category.key === "paid_ads");
  const operating = report.categories.find((category) => category.key === "operating");

  assert.equal(paidAds?.basis, "children");
  assert.equal(paidAds?.total, 325);
  assert.equal(operating?.basis, "children");
  assert.equal(operating?.total, 55);
  assert.equal(report.grandTotal, 380);
});

test("keeps future unclassified spend metrics visible", () => {
  const report = buildSpendReport({
    ...baseArgs,
    facts: [
      fact("spend.ugc.total", 100),
      fact("spend.experimental.creator_bonus", 17.5),
    ],
  });

  assert.equal(report.grandTotal, 117.5);
  assert.deepEqual(
    report.unclassified.map((entry) => ({
      key: entry.key,
      metricKeys: entry.metricKeys,
      total: entry.total,
    })),
    [
      {
        key: "experimental.creator_bonus",
        metricKeys: ["spend.experimental.creator_bonus"],
        total: 17.5,
      },
    ],
  );
});

test("builds spend reports from live profitability totals when canonical storage is unavailable", () => {
  const report = buildSpendReportFromRevenueProfitability({
    ...baseArgs,
    profitability: {
      currency: "USD",
      facelessSpend: 50,
      operatingSpend: 25,
      paidSourceSpend: 300,
      rows: [
        {
          kind: "paid",
          key: "tiktok:TikTok Ads",
          label: "TikTok Ads",
          spend: 225,
        },
        {
          kind: "paid",
          key: "facebook:Facebook",
          label: "Facebook",
          spend: 75,
        },
        {
          kind: "operating-cost",
          key: "operating:office",
          label: "Office",
          spend: 15,
        },
        {
          kind: "operating-cost",
          key: "operating:misc",
          label: "Bullshit",
          spend: 10,
        },
      ],
      ugcSpend: 100,
      unknownSpendLabels: ["Example network"],
    },
  });

  assert.equal(report.currency, "USD");
  assert.equal(report.grandTotal, 475);
  assert.equal(
    report.categories.find((category) => category.key === "paid_ads")?.total,
    300,
  );
  assert.equal(
    report.categories.find((category) => category.key === "ugc")?.total,
    100,
  );
  assert.equal(
    report.categories.find((category) => category.key === "faceless")?.total,
    50,
  );
  assert.equal(
    report.categories.find((category) => category.key === "operating")?.total,
    25,
  );
  assert.deepEqual(report.warnings, ["Spend unavailable for Example network."]);
});
