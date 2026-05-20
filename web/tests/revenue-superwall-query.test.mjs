import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { extname, resolve as resolvePath } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const superwallClientMock = `
export class SuperwallApiError extends Error {
  constructor(args) {
    super(args.message);
    this.name = "SuperwallApiError";
    this.status = args.status;
    this.payload = args.payload;
  }
}

export const capturedSuperwallQueries = [];

export const superwallClient = {
  async resolveQueryScope() {
    return {
      applicationIds: [20369, 20370],
      organizationId: 10397,
    };
  },
  async queryJsonEachRow({ sql }) {
    capturedSuperwallQueries.push(sql);

    if (sql.includes("count() AS rowCount")) {
      return [
        {
          conversions: 0,
          revenue: 0,
          rowCount: 0,
        },
      ];
    }

    if (sql.includes("Organic / unattributed")) {
      return [
        {
          date: "2026-05-14",
          label: "Organic / unattributed",
          value: 150,
        },
      ];
    }

    return [
      {
        date: "2026-05-14",
        label: "Activation",
        value: 100,
      },
      {
        date: "2026-05-14",
        label: "Renewal",
        value: 50,
      },
    ];
  },
};
`;

const mockModules = new Map([
  ["@/server/superwall/client", superwallClientMock],
  [
    "@/server/settings/managed-secrets",
    `
export async function getSuperwallCredentials() {
  return {
    configured: true,
    source: "database",
    value: {
      apiBaseUrl: "https://api.superwall.com",
      apiKey: "test",
      applicationIds: [20369, 20370],
      appleSourcePatterns: "apple search ads",
      creatorSourcePatterns: "social custom",
      organizationId: 10397,
      projectName: "GoTall",
      tiktokSourcePatterns: "tiktok,tik tok",
    },
  };
}
`,
  ],
  [
    "@/server/singular/reporting",
    `
export async function getSingularSourceRevenueReport() {
  return {
    cohortPeriod: null,
    configured: false,
    isPending: false,
    rows: [],
    warnings: [],
  };
}
`,
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

test("queries Superwall proceeds by purchase date, not ingestion event date", async () => {
  const { getRevenueAttributionReport } = await import(
    "../src/server/revenue/revenue.ts"
  );
  const { capturedSuperwallQueries } = await import("@/server/superwall/client");

  capturedSuperwallQueries.length = 0;

  const report = await getRevenueAttributionReport({
    endDate: "2026-05-16",
    organizationSlug: "gotall",
    startDate: "2026-05-14",
  });

  assert.equal(report.totals.total, 150);
  assert.equal(capturedSuperwallQueries.length, 3);

  for (const sql of capturedSuperwallQueries) {
    assert.match(
      sql,
      /purchasedAt >= toDateTime64\('2026-05-14 00:00:00', 6, 'UTC'\)/,
    );
    assert.match(
      sql,
      /purchasedAt < toDateTime64\('2026-05-17 00:00:00', 6, 'UTC'\)/,
    );
    assert.doesNotMatch(sql, /\bts >= toDateTime64/);
    assert.doesNotMatch(sql, /\bts < toDateTime64/);
    assert.match(sql, /attributionEventId != ''/);
  }

  const dailyBucketQueries = capturedSuperwallQueries.filter((sql) =>
    sql.includes("toString(toDate"),
  );

  assert.equal(dailyBucketQueries.length, 2);

  for (const sql of dailyBucketQueries) {
    assert.match(sql, /toDate\(purchasedAt, 'UTC'\)/);
  }

  assert.match(capturedSuperwallQueries[0], /isTrialConversion = 1,\s*'Activation'/);
  assert.match(capturedSuperwallQueries[0], /name = 'renewal',\s*'Renewal'/);
});

test("cohorted all model queries Superwall proceeds by attribution cohort date", async () => {
  const { getRevenueAttributionReport } = await import(
    "../src/server/revenue/revenue.ts"
  );
  const { capturedSuperwallQueries } = await import("@/server/superwall/client");

  capturedSuperwallQueries.length = 0;

  const report = await getRevenueAttributionReport({
    endDate: "2026-05-16",
    organizationSlug: "gotall",
    proceedsModel: "cohorted_all",
    startDate: "2026-05-14",
  });

  assert.equal(report.proceedsModel, "cohorted_all");
  assert.equal(report.totals.total, 150);
  assert.equal(capturedSuperwallQueries.length, 3);

  for (const sql of capturedSuperwallQueries) {
    assert.match(
      sql,
      /attributionTs >= toDateTime64\('2026-05-14 00:00:00', 6, 'UTC'\)/,
    );
    assert.match(
      sql,
      /attributionTs < toDateTime64\('2026-05-17 00:00:00', 6, 'UTC'\)/,
    );
    assert.doesNotMatch(sql, /\bpurchasedAt >= toDateTime64/);
    assert.doesNotMatch(sql, /\bpurchasedAt < toDateTime64/);
    assert.match(sql, /attributionEventId != ''/);
  }

  const dailyBucketQueries = capturedSuperwallQueries.filter((sql) =>
    sql.includes("toString(toDate"),
  );

  assert.equal(dailyBucketQueries.length, 2);

  for (const sql of dailyBucketQueries) {
    assert.match(sql, /toDate\(attributionTs, 'UTC'\)/);
  }
});
