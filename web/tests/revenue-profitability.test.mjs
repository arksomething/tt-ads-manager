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

test("profitability summary totals reconcile to complete daily rows", async () => {
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

  assert.equal(dailyProceeds, 300);
  assert.equal(dailySpend, 153);
  assert.equal(result.knownSpend, dailySpend);
  assert.equal(result.netProfit, dailyProceeds - dailySpend);
  assert.equal(result.blendedRoas, dailyProceeds / dailySpend);
});
