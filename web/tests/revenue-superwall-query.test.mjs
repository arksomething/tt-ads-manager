import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { extname, resolve as resolvePath } from "node:path";
import test, { beforeEach } from "node:test";
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
    "@/server/adapty/dashboard-client",
    `
let mockAppleSearchAdsDashboardReport = {
  configured: false,
  conversions: null,
  installs: null,
  revenue: null,
  revenueBasis: null,
  rowCount: 0,
  spend: null,
  warnings: [],
};

export function setMockAppleSearchAdsDashboardReport(report) {
  mockAppleSearchAdsDashboardReport = report;
}

export async function getAppleSearchAdsDashboardReport() {
  return mockAppleSearchAdsDashboardReport;
}
`,
  ],
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
const defaultSingularSourceRevenueReport = {
  cohortMetric: "revenue",
  cohortPeriod: "actual",
  configured: false,
  isPending: false,
  rowCount: 0,
  rows: [],
  totalRevenue: 0,
  warnings: [],
};

let mockSingularSourceRevenueReport = defaultSingularSourceRevenueReport;

export function resetMockSingularSourceRevenueReport() {
  mockSingularSourceRevenueReport = defaultSingularSourceRevenueReport;
}

export function setMockSingularSourceRevenueReport(report) {
  mockSingularSourceRevenueReport = {
    ...defaultSingularSourceRevenueReport,
    ...report,
  };
}

export async function getSingularSourceRevenueReport() {
  return mockSingularSourceRevenueReport;
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

beforeEach(async () => {
  const { resetMockSingularSourceRevenueReport } = await import(
    "@/server/singular/reporting"
  );

  resetMockSingularSourceRevenueReport();
});

test("explicit new proceeds model queries Superwall proceeds by purchase date", async () => {
  const { getRevenueAttributionReport } = await import(
    "../src/server/revenue/revenue.ts"
  );
  const { capturedSuperwallQueries } = await import("@/server/superwall/client");

  capturedSuperwallQueries.length = 0;

  const report = await getRevenueAttributionReport({
    endDate: "2026-05-16",
    organizationSlug: "gotall",
    proceedsModel: "new_proceeds",
    startDate: "2026-05-14",
  });

  assert.equal(report.proceedsModel, "new_proceeds");
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

test("defaults to cohorted all Superwall proceeds by install cohort date", async () => {
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

  assert.equal(report.proceedsModel, "cohorted_all");
  assert.equal(report.totals.total, 150);
  assert.equal(capturedSuperwallQueries.length, 3);

  for (const sql of capturedSuperwallQueries) {
    assert.match(
      sql,
      /installDate >= toDateTime64\('2026-05-14 00:00:00', 6, 'UTC'\)/,
    );
    assert.match(
      sql,
      /installDate < toDateTime64\('2026-05-17 00:00:00', 6, 'UTC'\)/,
    );
    assert.doesNotMatch(sql, /\bpurchasedAt >= toDateTime64/);
    assert.doesNotMatch(sql, /\bpurchasedAt < toDateTime64/);
    assert.doesNotMatch(sql, /\battributionTs >= toDateTime64/);
    assert.doesNotMatch(sql, /\battributionTs < toDateTime64/);
    assert.match(sql, /attributionEventId != ''/);
  }

  const dailyBucketQueries = capturedSuperwallQueries.filter((sql) =>
    sql.includes("toString(toDate"),
  );

  assert.equal(dailyBucketQueries.length, 2);

  for (const sql of dailyBucketQueries) {
    assert.match(sql, /toDate\(installDate, 'UTC'\)/);
  }
});

test("hides organic proceeds while Singular source cohort revenue is pending", async () => {
  const { getRevenueAttributionReport } = await import(
    "../src/server/revenue/revenue.ts"
  );
  const { setMockSingularSourceRevenueReport } = await import(
    "@/server/singular/reporting"
  );

  setMockSingularSourceRevenueReport({
    cohortMetric: "revenue",
    cohortPeriod: "actual",
    configured: true,
    isPending: true,
    rowCount: 1,
    rows: [
      {
        conversions: 381,
        currency: "USD",
        installs: 378,
        label: "Facebook",
        points: [
          {
            date: "2026-05-14",
            revenue: 0,
            spend: 547.47,
            spendAvailable: true,
          },
        ],
        revenue: 0,
        revenueAvailable: false,
        source: "Facebook",
        spend: 547.47,
        spendAvailable: true,
      },
    ],
    totalRevenue: 0,
    warnings: [
      "Singular returned source rows, but actual revenue is not ready for this date window yet.",
    ],
  });

  const report = await getRevenueAttributionReport({
    endDate: "2026-05-16",
    organizationSlug: "gotall",
    startDate: "2026-05-14",
  });

  assert.equal(report.sourceProvider, "singular");
  assert.equal(report.singularPending, true);
  assert.equal(report.totals.total, 150);
  assert.equal(report.totals.organic, 0);
  assert.equal(report.dailyRows[0]?.organic, null);
  assert.equal(report.dailyRows[0]?.paid, null);
  assert.match(
    report.warnings.join(" "),
    /organic \/ UGC proceeds are hidden until the paid-source split is ready/,
  );
});

test("uses Adapty Ads Manager totals for Apple Search Ads when available", async () => {
  const { getRevenueAttributionReport } = await import(
    "../src/server/revenue/revenue.ts"
  );
  const { setMockAppleSearchAdsDashboardReport } = await import(
    "@/server/adapty/dashboard-client"
  );

  setMockAppleSearchAdsDashboardReport({
    configured: true,
    conversions: 14,
    installs: 420,
    revenue: 248.11,
    revenueBasis: "proceeds",
    rowCount: 33,
    spend: 262.26,
    warnings: [],
  });

  const report = await getRevenueAttributionReport({
    endDate: "2026-05-16",
    organizationSlug: "gotall",
    startDate: "2026-05-14",
  });
  const appleRow = report.sourceRows.find((row) => row.kind === "apple");

  assert.ok(appleRow);
  assert.equal(report.appleSourceProvider, "adapty");
  assert.equal(report.appleAdsDashboardRowCount, 33);
  assert.equal(appleRow.rawLabel, "adapty_apple_search_ads");
  assert.equal(appleRow.revenue, 248.11);
  assert.equal(appleRow.spend, 262.26);
  assert.equal(appleRow.installs, 420);
  assert.equal(appleRow.conversions, 14);
});
