import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { extname, resolve as resolvePath } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const mockModules = new Map([
  [
    "@/server/dashboard/filters",
    "export {};",
  ],
  [
    "@/server/ugc-pay/queries",
    [
      "export async function getOrganizationUgcPayData() {",
      "  throw new Error('not used in this test');",
      "}",
    ].join("\n"),
  ],
  [
    "@/server/viewsbase/report",
    [
      "export async function getViewsBaseFacelessReport() {",
      "  throw new Error('not used in this test');",
      "}",
    ].join("\n"),
  ],
  [
    "@/server/viewsbase/faceless-calculations",
    `export function getFacelessCostAmount(input) {
      return input.projectedSpend ?? input.totalSpend ?? 0;
    }`,
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
      specifier === "./revenue" &&
      context.parentURL?.endsWith("/src/server/revenue/revenue-profitability.ts")
    ) {
      return {
        shortCircuit: true,
        url: [
          "data:text/javascript,",
          encodeURIComponent(
            [
              "export async function getRevenueAttributionReport() {",
              "  throw new Error('not used in this test');",
              "}",
              "export function getRevenueProceedsModelConfig() {",
              "  return { excludesRenewalsFromOrganic: true };",
              "}",
              "export function normalizeRevenueProceedsModel(value) {",
              "  return value === 'cohorted_all' ? 'cohorted_all' : 'new_proceeds';",
              "}",
            ].join("\n"),
          ),
        ].join(""),
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

test("profitability spend reconciles to complete daily rows while profit uses range proceeds", async () => {
  const { buildRevenueProfitabilityData } = await import(
    "../src/server/revenue/revenue-profitability.ts"
  );
  const result = buildRevenueProfitabilityData({
    facelessSpendReport: {
      configured: true,
      errorMessage: null,
      report: {
        dailyRows: [
          {
            baseProjectedSpend: 0,
            baseTotalSpend: 1,
            date: "2026-05-04",
            projectedSpend: null,
            totalSpend: 1,
          },
          {
            baseProjectedSpend: 0,
            baseTotalSpend: 2,
            date: "2026-05-05",
            projectedSpend: null,
            totalSpend: 2,
          },
        ],
        totals: {
          managementFee: 0,
          projectedSpend: null,
          totalSpend: 9,
        },
      },
    },
    report: {
      currency: "USD",
      proceedsModel: "new_proceeds",
      dailyRows: [
        {
          date: "2026-05-04",
          paidSpend: 50,
          total: 100,
        },
        {
          date: "2026-05-05",
          paidSpend: 70,
          total: 200,
        },
      ],
      sourceRows: [
        {
          kind: "paid",
          label: "TikTok",
          rawLabel: "tiktok",
          revenue: 140,
          spend: 120,
          spendStatus: "partial",
        },
      ],
      totals: {
        newProceeds: 749,
        organic: 500,
        renewal: 250,
        renewalBucket: 250,
        total: 999,
      },
    },
    ugcPayData: {
      dailyRows: [
        { date: "2026-05-04", totalPay: 10 },
        { date: "2026-05-05", totalPay: 20 },
      ],
      data: {
        summary: {
          totalPay: 40,
        },
      },
    },
  });
  const dailyProceeds = result.dailyRows.reduce(
    (total, row) => total + row.proceeds,
    0,
  );
  const dailySpend = result.dailyRows.reduce(
    (total, row) => total + row.totalSpend,
    0,
  );
  const roundedDailySpend = Number(dailySpend.toFixed(2));

  assert.equal(dailyProceeds, 300);
  assert.equal(roundedDailySpend, 485.04);
  assert.equal(result.knownSpend, roundedDailySpend);
  assert.equal(
    Number(
      (
        result.paidSourceSpend +
        result.ugcSpend +
        result.facelessSpend +
        result.operatingSpend
      ).toFixed(2),
    ),
    result.knownSpend,
  );
  assert.equal(result.ugcPaySpend, 30);
  assert.equal(result.ugcManagementSpend, 64.52);
  assert.equal(result.ugcSpend, 94.52);
  assert.equal(result.facelessBaseSpend, 3);
  assert.equal(result.facelessManagementSpend, 0);
  assert.equal(result.facelessSpend, 3);
  assert.equal(result.operatingSpend, 267.52);
  assert.equal(result.proceedsModel, "new_proceeds");
  assert.equal(result.totalProceeds, 999);
  assert.equal(result.newProceeds, 749);
  assert.equal(result.renewalProceeds, 250);
  assert.equal(result.newProceedsRoas, 749 / roundedDailySpend);
  assert.deepEqual(result.partialSpendLabels, ["TikTok"]);
  assert.equal(
    result.rows.find((row) => row.key === "paid:TikTok")?.basis,
    "Partial Singular spend + proceeds",
  );
  assert.equal(result.netProfit, 513.96);
  assert.equal(result.blendedRoas, 999 / roundedDailySpend);
  assert.equal(
    result.rows.find((row) => row.key === "organic:ugc-management")?.spend,
    64.52,
  );
  assert.equal(
    result.rows.find((row) => row.key === "organic:faceless-base")?.spend,
    3,
  );
  assert.equal(
    result.rows.find((row) => row.key === "organic:faceless-management")?.spend,
    0,
  );
  assert.equal(
    result.rows.find((row) => row.key === "operating:office")?.spend,
    122.58,
  );
  assert.equal(
    result.rows.find((row) => row.key === "operating:superwall")?.spend,
    15.9,
  );
});

test("profitability net profit cannot exceed total proceeds when known spend is positive", async () => {
  const { buildRevenueProfitabilityData } = await import(
    "../src/server/revenue/revenue-profitability.ts"
  );
  const result = buildRevenueProfitabilityData({
    facelessSpendReport: {
      configured: true,
      errorMessage: null,
      report: {
        dailyRows: [
          {
            baseProjectedSpend: 0,
            baseTotalSpend: 100,
            date: "2026-05-04",
            projectedSpend: null,
            totalSpend: 100,
          },
          {
            baseProjectedSpend: 0,
            baseTotalSpend: 200,
            date: "2026-05-05",
            projectedSpend: null,
            totalSpend: 200,
          },
        ],
        totals: {
          managementFee: 0,
          projectedSpend: null,
          totalSpend: 300,
        },
      },
    },
    report: {
      currency: "USD",
      proceedsModel: "new_proceeds",
      dailyRows: [
        {
          date: "2026-05-04",
          paidSpend: 300,
          total: 10_000,
        },
        {
          date: "2026-05-05",
          paidSpend: 400,
          total: 10_000,
        },
      ],
      sourceRows: [
        {
          kind: "paid",
          label: "TikTok",
          rawLabel: "tiktok",
          revenue: 1_000,
          spend: 700,
        },
      ],
      totals: {
        organic: 1_000,
        renewal: 0,
        total: 1_500,
      },
    },
    ugcPayData: {
      dailyRows: [
        { date: "2026-05-04", totalPay: 50 },
        { date: "2026-05-05", totalPay: 50 },
      ],
      data: {
        summary: {
          totalPay: 100,
        },
      },
    },
  });

  assert.equal(result.knownSpend, 1_629.04);
  assert.equal(result.operatingSpend, 464.52);
  assert.equal(result.netProfit, -129.04);
  assert.equal(result.blendedRoas, 1_500 / 1_629.04);
  assert.ok(result.netProfit <= 1_500);
});

test("cohorted profitability keeps ROAS on total cohorted proceeds", async () => {
  const { buildRevenueProfitabilityData } = await import(
    "../src/server/revenue/revenue-profitability.ts"
  );
  const result = buildRevenueProfitabilityData({
    facelessSpendReport: {
      configured: true,
      errorMessage: null,
      report: null,
    },
    report: {
      currency: "USD",
      proceedsModel: "cohorted_all",
      dailyRows: [
        {
          date: "2026-05-04",
          newProceeds: 800,
          paidSpend: 100,
          renewal: 200,
          total: 1_000,
        },
      ],
      sourceRows: [],
      totals: {
        newProceeds: 800,
        organic: 1_000,
        renewal: 200,
        renewalBucket: 0,
        total: 1_000,
      },
    },
    ugcPayData: {
      dailyRows: [],
      data: {
        summary: {
          totalPay: 0,
        },
      },
    },
  });

  assert.equal(result.proceedsModel, "cohorted_all");
  assert.equal(result.totalProceeds, 1_000);
  assert.equal(result.newProceeds, 800);
  assert.equal(result.renewalProceeds, 200);
  assert.equal(result.dailyRows[0]?.proceeds, 1_000);
  assert.equal(result.blendedRoas, 1_000 / result.knownSpend);
});
