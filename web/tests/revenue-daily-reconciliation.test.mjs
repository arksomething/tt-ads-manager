import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { extname, resolve as resolvePath } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const mockModules = new Map([
  [
    "@/server/settings/managed-secrets",
    "export async function getAdaptyCredentials() { throw new Error('not used'); }",
  ],
  [
    "@/server/singular/reporting",
    "export async function getSingularSourceRevenueReport() { throw new Error('not used'); }",
  ],
]);

function localTsUrl(path) {
  const resolved = resolvePath(path);
  return pathToFileURL(extname(resolved) ? resolved : `${resolved}.ts`).href;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    const mock = mockModules.get(specifier);

    if (mock) {
      return {
        shortCircuit: true,
        url: `data:text/javascript,${encodeURIComponent(mock)}`,
      };
    }

    if (
      specifier === "./client" &&
      context.parentURL?.endsWith("/src/server/adapty/revenue.ts")
    ) {
      return {
        shortCircuit: true,
        url: `data:text/javascript,${encodeURIComponent(
          [
            "export class AdaptyApiError extends Error {}",
            "export const adaptyClient = {",
            "  retrieveAnalyticsData() { throw new Error('not used'); },",
            "};",
          ].join("\n"),
        )}`,
      };
    }

    if (
      specifier === "./dashboard-client" &&
      context.parentURL?.endsWith("/src/server/adapty/revenue.ts")
    ) {
      return {
        shortCircuit: true,
        url: `data:text/javascript,${encodeURIComponent(
          "export async function getAppleSearchAdsDashboardReport() { throw new Error('not used'); }",
        )}`,
      };
    }

    if (specifier.startsWith("@/")) {
      return nextResolve(localTsUrl(resolvePath("src", specifier.slice(2))), context);
    }

    if (specifier.startsWith(".") && !extname(specifier)) {
      return nextResolve(
        localTsUrl(new URL(specifier, context.parentURL).pathname),
        context,
      );
    }

    return nextResolve(specifier, context);
  },
});

test("reconciles inflated provider daily proceeds to range totals", async () => {
  const { reconcileRevenueDailyRowsToTotals } = await import(
    "../src/server/adapty/revenue.ts"
  );
  const rows = [
    {
      apple: 3,
      date: "2026-05-04",
      newProceeds: 4_000,
      organic: 300,
      paid: 300,
      paidSpend: null,
      renewal: 400,
      tiktok: 250,
      tiktokSpend: null,
      total: 4_405.94,
    },
    {
      apple: 2,
      date: "2026-05-05",
      newProceeds: 3_000,
      organic: 250,
      paid: 250,
      paidSpend: null,
      renewal: 350,
      tiktok: 200,
      tiktokSpend: null,
      total: 3_702.84,
    },
    {
      apple: 2,
      date: "2026-05-06",
      newProceeds: 3_200,
      organic: 200,
      paid: 200,
      paidSpend: null,
      renewal: 300,
      tiktok: 150,
      tiktokSpend: null,
      total: 3_495.13,
    },
    {
      apple: 2,
      date: "2026-05-07",
      newProceeds: 2_500,
      organic: 150,
      paid: 150,
      paidSpend: null,
      renewal: 300,
      tiktok: 100,
      tiktokSpend: null,
      total: 2_624.45,
    },
    {
      apple: 2,
      date: "2026-05-08",
      newProceeds: 3_300,
      organic: 180,
      paid: 180,
      paidSpend: null,
      renewal: 350,
      tiktok: 120,
      tiktokSpend: null,
      total: 3_550.4,
    },
    {
      apple: 1,
      date: "2026-05-09",
      newProceeds: 3_600,
      organic: 160,
      paid: 160,
      paidSpend: null,
      renewal: 450,
      tiktok: 140,
      tiktokSpend: null,
      total: 3_930.02,
    },
    {
      apple: 1.43,
      date: "2026-05-10",
      newProceeds: 2_800,
      organic: 150,
      paid: 150,
      paidSpend: null,
      renewal: 473.49,
      tiktok: 100,
      tiktokSpend: null,
      total: 2_902.34,
    },
  ];
  const reconciled = reconcileRevenueDailyRowsToTotals({
    includeSourceBreakdown: true,
    rows,
    totals: {
      apple: 13.43,
      newProceeds: 9_681.08,
      organic: 2_142.81,
      paid: 7_538.27,
      renewal: 2_623.49,
      tiktok: 5_015.48,
      total: 12_030.57,
    },
  });
  const sum = (key) =>
    Number(
      reconciled
        .reduce((total, row) => total + (row[key] ?? 0), 0)
        .toFixed(2),
    );

  assert.equal(sum("total"), 12_030.57);
  assert.equal(sum("newProceeds"), 9_681.08);
  assert.equal(sum("renewal"), 2_623.49);
  assert.equal(sum("organic"), 2_142.81);
  assert.equal(sum("paid"), 7_538.27);
  assert.equal(sum("tiktok"), 5_015.48);
  assert.equal(sum("apple"), 13.43);
  assert.ok(reconciled[0].total < rows[0].total);
});

test("uses Adapty total series instead of summing total plus period components", async () => {
  const { getRevenueTotalPointMap, normalizeMetricSeries } = await import(
    "../src/server/adapty/revenue.ts"
  );
  const series = [
    {
      label: "Activation",
      points: [
        { date: "2026-05-04", value: 1_805.29 },
        { date: "2026-05-05", value: 1_462.74 },
      ],
      unit: "USD",
      value: 3_268.03,
    },
    {
      label: "Renewal 1",
      points: [
        { date: "2026-05-04", value: 83.61 },
        { date: "2026-05-05", value: 151.92 },
      ],
      unit: "USD",
      value: 235.53,
    },
    {
      label: "Total",
      points: [
        { date: "2026-05-04", value: 2_204.77 },
        { date: "2026-05-05", value: 1_851.42 },
      ],
      unit: "USD",
      value: 4_056.19,
    },
  ];
  const totals = getRevenueTotalPointMap(series);
  const metric = normalizeMetricSeries({
    data: {
      proceeds: {
        data: series.map((row) => ({
          data: row.points,
          name: row.label,
          unit: row.unit,
          value: row.value,
        })),
      },
    },
  });

  assert.equal(totals.get("2026-05-04"), 2_204.77);
  assert.equal(totals.get("2026-05-05"), 1_851.42);
  assert.notEqual(totals.get("2026-05-04"), 2_204.77 + 1_805.29 + 83.61);
  assert.equal(metric.total, 4_056.19);
  assert.notEqual(metric.total, 4_056.19 + 3_268.03 + 235.53);
});

test("derives exact organic source daily proceeds without source total rows", async () => {
  const { getOrganicSourceDailyRows, getOrganicSourceSeries } = await import(
    "../src/server/adapty/revenue.ts"
  );
  const series = [
    {
      label: "No Data",
      points: [
        { date: "2026-05-04", value: 333.05 },
        { date: "2026-05-05", value: 255.63 },
      ],
      unit: "USD",
      value: 588.68,
    },
    {
      label: "apple_search_ads",
      points: [
        { date: "2026-05-04", value: 1_871.72 },
        { date: "2026-05-05", value: 1_595.79 },
      ],
      unit: "USD",
      value: 3_467.51,
    },
    {
      label: "Total",
      points: [
        { date: "2026-05-04", value: 2_204.77 },
        { date: "2026-05-05", value: 1_851.42 },
      ],
      unit: "USD",
      value: 4_056.19,
    },
  ];
  const organicSeries = getOrganicSourceSeries({
    applePatterns: ["apple_search_ads"],
    creatorPatterns: ["social custom"],
    sourceSeries: series,
    tiktokPatterns: ["tiktok"],
  });
  const dailyRows = getOrganicSourceDailyRows({
    endDate: "2026-05-05",
    sourceSeries: organicSeries,
    startDate: "2026-05-04",
  });

  assert.deepEqual(
    dailyRows.map((row) => row.proceeds),
    [333.05, 255.63],
  );
});
