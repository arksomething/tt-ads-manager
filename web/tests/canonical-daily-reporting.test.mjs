import assert from "node:assert/strict";
import test from "node:test";

import {
  adaptOperatingCostDailyRowsToCanonicalDays,
  adaptRevenueAttributionReportToCanonicalDays,
  adaptUgcPayDailyRowsToCanonicalDays,
  adaptViewsBaseFacelessReportToCanonicalDays,
  aggregateCurrentDailyFacts,
  getMetricTotal,
} from "../src/server/reporting/index.ts";

const context = {
  organizationId: "org_123",
  version: 7,
  createdAt: "2026-05-10T12:00:00.000Z",
};

function toCurrentDays(versions) {
  return versions.map((version) => ({
    organizationId: version.organizationId,
    reportDate: version.reportDate,
    version,
  }));
}

function revenueReport(overrides = {}) {
  return {
    appleAdsDashboardConfigured: false,
    appleAdsDashboardRowCount: 0,
    appleSourceProvider: "none",
    attributionDimension: "attribution_source",
    configured: true,
    currency: "USD",
    dailyRows: [
      {
        apple: 5,
        date: "2026-05-04",
        newProceeds: 85,
        organic: 70,
        paid: 20,
        paidSpend: 8,
        renewal: 10,
        tiktok: 15,
        tiktokSpend: 6,
        total: 100,
      },
      {
        apple: 7,
        date: "2026-05-05",
        newProceeds: 170,
        organic: 130,
        paid: 50,
        paidSpend: 12,
        renewal: 20,
        tiktok: 25,
        tiktokSpend: 9,
        total: 200,
      },
    ],
    endDate: "2026-05-05",
    hasDailySourceBreakdown: true,
    providerTimeZones: [],
    singularCohortPeriod: null,
    singularConfigured: true,
    singularPending: false,
    sourceProvider: "singular",
    sourceRows: [],
    startDate: "2026-05-04",
    timeZone: "UTC",
    tiktokPatterns: ["tiktok"],
    totals: {
      apple: 12,
      appleProfit: null,
      appleRoas: null,
      appleShare: 0.04,
      appleSpend: null,
      newProceeds: 255,
      newShare: 0.85,
      organic: 200,
      organicShare: 2 / 3,
      paid: 70,
      paidShare: 70 / 300,
      renewal: 30,
      renewalBucket: 30,
      renewalShare: 0.1,
      tiktok: 40,
      tiktokShare: 40 / 300,
      total: 300,
    },
    warnings: [],
    ...overrides,
  };
}

test("aggregates range totals as the sum of current daily facts", () => {
  const revenueDays = adaptRevenueAttributionReportToCanonicalDays(
    context,
    revenueReport(),
  );
  const ugcDays = adaptUgcPayDailyRowsToCanonicalDays({
    context,
    currency: "USD",
    endDate: "2026-05-05",
    rows: [
      { date: "2026-05-04", fixedPay: 10, payableViews: 1_000, totalPay: 30, videoPay: 20 },
      { date: "2026-05-05", fixedPay: 15, payableViews: 2_000, totalPay: 45, videoPay: 30 },
    ],
    startDate: "2026-05-04",
  });
  const daysByDate = new Map(
    revenueDays.map((day) => [day.reportDate, { ...day, facts: [...day.facts] }]),
  );

  for (const ugcDay of ugcDays) {
    daysByDate.get(ugcDay.reportDate)?.facts.push(...ugcDay.facts);
  }

  const aggregation = aggregateCurrentDailyFacts({
    days: toCurrentDays([...daysByDate.values()]),
    endDate: "2026-05-05",
    organizationId: "org_123",
    startDate: "2026-05-04",
  });

  assert.equal(getMetricTotal(aggregation, "proceeds.total")?.value, 300);
  assert.equal(getMetricTotal(aggregation, "proceeds.organic_ugc")?.value, 200);
  assert.equal(getMetricTotal(aggregation, "spend.ugc.total")?.value, 75);
  assert.equal(getMetricTotal(aggregation, "views.ugc")?.value, 3_000);
  assert.equal(aggregation.freshness, "fresh");
  assert.deepEqual(aggregation.missingDays, []);
});

test("does not fabricate organic or paid source facts while Singular split is pending", () => {
  const [day] = adaptRevenueAttributionReportToCanonicalDays(
    context,
    revenueReport({
      dailyRows: [
        {
          apple: null,
          date: "2026-05-04",
          newProceeds: 100,
          organic: 0,
          paid: null,
          paidSpend: null,
          renewal: 0,
          tiktok: null,
          tiktokSpend: null,
          total: 100,
        },
      ],
      endDate: "2026-05-04",
      hasDailySourceBreakdown: false,
      singularPending: true,
      startDate: "2026-05-04",
      warnings: ["Singular source split is still preparing."],
    }),
  );

  assert.equal(day.freshness, "incomplete");
  assert.equal(
    day.facts.some((fact) => fact.metricKey === "proceeds.organic_ugc"),
    false,
  );
  assert.equal(day.facts.some((fact) => fact.metricKey === "proceeds.paid"), false);
  assert.equal(
    day.facts.find((fact) => fact.metricKey === "proceeds.total")?.value,
    100,
  );
  assert.match(day.warnings.join(" "), /organic\/UGC proceeds were not published/);
});

test("rolls up stale, incomplete, and missing day status for a range", () => {
  const [freshDay, staleDay] = adaptRevenueAttributionReportToCanonicalDays(
    context,
    revenueReport(),
  );
  const staleVersion = {
    ...staleDay,
    freshness: "stale",
    warnings: ["Pricing rules changed after this day was built."],
  };

  const aggregation = aggregateCurrentDailyFacts({
    days: toCurrentDays([freshDay, staleVersion]),
    endDate: "2026-05-06",
    organizationId: "org_123",
    startDate: "2026-05-04",
  });

  assert.equal(aggregation.freshness, "incomplete");
  assert.deepEqual(aggregation.staleDays, ["2026-05-05"]);
  assert.deepEqual(aggregation.missingDays, ["2026-05-06"]);
  assert.deepEqual(aggregation.incompleteDays, ["2026-05-06"]);
  assert.match(aggregation.warnings.join(" "), /Pricing rules changed/);
  assert.match(aggregation.warnings.join(" "), /No current canonical day version/);
});

test("aggregates provenance and warnings into source breakdowns", () => {
  const days = adaptUgcPayDailyRowsToCanonicalDays({
    context,
    currency: "USD",
    endDate: "2026-05-05",
    rows: [
      {
        date: "2026-05-04",
        fixedPay: 10,
        payableViews: 1_000,
        totalPay: 30,
        videoPay: 20,
        warnings: ["creator A has unknown paid traffic"],
      },
      {
        date: "2026-05-05",
        fixedPay: 10,
        payableViews: 1_000,
        totalPay: 30,
        videoPay: 20,
        warnings: ["creator A has unknown paid traffic"],
      },
    ],
    startDate: "2026-05-04",
    warnings: ["UGC Pay loaded with provider warning"],
  });

  const aggregation = aggregateCurrentDailyFacts({
    days: toCurrentDays(days),
    endDate: "2026-05-05",
    organizationId: "org_123",
    startDate: "2026-05-04",
  });
  const total = getMetricTotal(aggregation, "spend.ugc.total");
  const [breakdown] = total.sourceBreakdown;

  assert.equal(total.value, 60);
  assert.equal(breakdown.source, "ugc_pay");
  assert.deepEqual(breakdown.days, ["2026-05-04", "2026-05-05"]);
  assert.equal(breakdown.provenance.length, 2);
  assert.deepEqual(breakdown.warnings, [
    "UGC Pay loaded with provider warning",
    "creator A has unknown paid traffic",
  ]);
  assert.deepEqual(aggregation.warnings, [
    "UGC Pay loaded with provider warning",
    "creator A has unknown paid traffic",
  ]);
});

test("converts ViewsBase faceless daily rows into spend, fee, and view facts", () => {
  const [day] = adaptViewsBaseFacelessReportToCanonicalDays(context, {
    campaign: {
      countingWindowDays: 7,
      id: "campaign_1",
      name: "Faceless",
      orgSlug: "gotall",
      slug: "faceless",
    },
    campaignOptions: [],
    creatorRows: [],
    dailyRows: [
      {
        actualSpend: 90,
        baseActualSpend: 80,
        baseProjectedSpend: 120,
        baseTotalSpend: 80,
        comments: 0,
        cpmManagementFee: 8,
        creatorCount: 2,
        dashboardFee: 8.06,
        date: "2026-05-04",
        fixedManagementFee: 0,
        likes: 0,
        managementFee: 16.06,
        projectedSpend: 136.06,
        projectedSpendIsEstimated: true,
        shares: 0,
        status: "mixed",
        totalSpend: 96.06,
        views: 25_000,
      },
    ],
    isAggregate: false,
    paymentRows: [],
    requestedRange: {
      endDate: "2026-05-04",
      startDate: "2026-05-04",
    },
    selectedCampaignSlugs: ["faceless"],
    stats: {
      activeCreators: 2,
      avgViewsPerVideo: 12_500,
      engagementRate: null,
      lastUpdated: "2026-05-04T18:00:00.000Z",
      pendingCpm: null,
      totalPaid: 2,
      totalPending: 0,
      totalVideos: 2,
      totalViewsInRange: 25_000,
    },
    totals: {
      baseTotalSpend: 80,
      cpmManagementFee: 8,
      dashboardFee: 8.06,
      fixedManagementFee: 0,
      managementFee: 16.06,
      paymentSummaryRows: 0,
      projectedSpend: 136.06,
      rangeViews: 25_000,
      rawVideoCount: 2,
      totalSpend: 96.06,
    },
  });

  assert.equal(
    day.facts.find((fact) => fact.metricKey === "spend.faceless.total")?.value,
    136.06,
  );
  assert.equal(
    day.facts.find((fact) => fact.metricKey === "spend.faceless.management_fee")?.value,
    16.06,
  );
  assert.equal(
    day.facts.find((fact) => fact.metricKey === "views.faceless")?.value,
    25_000,
  );
});

test("converts operating costs into parent and child spend facts", () => {
  const [day] = adaptOperatingCostDailyRowsToCanonicalDays(context, [
    {
      date: "2026-05-04",
      total: 123.45,
      costs: [
        {
          amount: 50,
          key: "office",
          label: "Office",
        },
        {
          amount: 73.45,
          key: "misc",
          label: "Bullshit",
        },
      ],
    },
  ]);

  assert.equal(
    day.facts.find((fact) => fact.metricKey === "spend.operating.total")?.value,
    123.45,
  );
  assert.equal(
    day.facts.find((fact) => fact.metricKey === "spend.operating.office")?.value,
    50,
  );
  assert.equal(
    day.facts.find((fact) => fact.metricKey === "spend.operating.other")?.value,
    73.45,
  );
});
