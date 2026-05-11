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
      context.parentURL?.endsWith("/src/server/adapty/revenue-profitability.ts")
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
    "../src/server/adapty/revenue-profitability.ts"
  );
  const result = buildRevenueProfitabilityData({
    facelessSpendReport: {
      configured: true,
      errorMessage: null,
      report: {
        dailyRows: [
          { date: "2026-05-04", projectedSpend: null, totalSpend: 1 },
          { date: "2026-05-05", projectedSpend: null, totalSpend: 2 },
        ],
        totals: {
          projectedSpend: null,
          totalSpend: 9,
        },
      },
    },
    report: {
      currency: "USD",
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
        },
      ],
      totals: {
        organic: 500,
        renewal: 0,
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
  assert.equal(roundedDailySpend, 510.84);
  assert.equal(result.knownSpend, roundedDailySpend);
  assert.equal(result.operatingSpend, 357.84);
  assert.equal(result.netProfit, 488.16);
  assert.equal(result.blendedRoas, 999 / roundedDailySpend);
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
    "../src/server/adapty/revenue-profitability.ts"
  );
  const result = buildRevenueProfitabilityData({
    facelessSpendReport: {
      configured: true,
      errorMessage: null,
      report: {
        dailyRows: [
          { date: "2026-05-04", projectedSpend: null, totalSpend: 100 },
          { date: "2026-05-05", projectedSpend: null, totalSpend: 200 },
        ],
        totals: {
          projectedSpend: null,
          totalSpend: 300,
        },
      },
    },
    report: {
      currency: "USD",
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

  assert.equal(result.knownSpend, 1_654.84);
  assert.equal(result.operatingSpend, 554.84);
  assert.equal(result.netProfit, -154.84);
  assert.equal(result.blendedRoas, 1_500 / 1_654.84);
  assert.ok(result.netProfit <= 1_500);
});
