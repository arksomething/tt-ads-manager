import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { extname, resolve as resolvePath } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const mockModules = new Map([
  [
    "@/lib/server-env",
    `export function getAdaptyDashboardEnv() {
      return {
        ADAPTY_DASHBOARD_APP_ID: "app",
        ADAPTY_DASHBOARD_BASE_URL: "https://api-asa-admin.adapty.io/api/v1",
        ADAPTY_DASHBOARD_COMPANY_ID: "company",
        ADAPTY_DASHBOARD_TOKEN: "token",
      };
    }
    export function hasAdaptyDashboardEnv() {
      return true;
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

test("normalizes Apple Search Ads dashboard totals from Adapty payloads", async () => {
  const { normalizeAppleSearchAdsDashboardReport } = await import(
    "../src/server/adapty/dashboard-client.ts"
  );
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

test("falls back to campaign row spend and installs when total payload is absent", async () => {
  const { normalizeAppleSearchAdsDashboardReport } = await import(
    "../src/server/adapty/dashboard-client.ts"
  );
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
