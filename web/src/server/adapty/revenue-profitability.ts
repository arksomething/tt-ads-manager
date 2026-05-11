import { type DashboardSearchParams } from "@/server/dashboard/filters";
import {
  getOrganizationUgcPayData,
  type OrganizationUgcPayData,
} from "@/server/ugc-pay/queries";
import { getFacelessCostAmount } from "@/server/viewsbase/faceless-calculations";
import {
  getViewsBaseFacelessReport,
  type ViewsBaseFacelessReport,
} from "@/server/viewsbase/report";

import {
  getRevenueAttributionReport,
  type RevenueAttributionReport,
} from "./revenue";
import {
  getDateKeys,
  getRevenueUgcPaySearchParams,
} from "./revenue-profitability-calculations";

const UGC_PAY_DAILY_QUERY_CONCURRENCY = 3;
const SUPERWALL_REVENUE_FEE_RATE = 0.01;
const MONTHLY_OPERATING_COSTS = [
  {
    key: "office",
    label: "Office",
    monthlyAmount: 1_900,
  },
  {
    key: "superwall",
    label: "Superwall",
    monthlyAmount: 200,
  },
  {
    key: "adapty",
    label: "Adapty",
    monthlyAmount: 1_400,
  },
  {
    key: "singular",
    label: "Singular",
    monthlyAmount: 1_000,
  },
  {
    key: "misc",
    label: "Bullshit",
    monthlyAmount: 1_000,
  },
] as const;

type RevenueUgcPaySpendData = {
  data: OrganizationUgcPayData;
  dailyRows: Array<{
    date: string;
    totalPay: number;
  }>;
};

type FacelessSpendReport = {
  configured: boolean;
  errorMessage: string | null;
  report: ViewsBaseFacelessReport | null;
};

export type RevenueProfitabilityRow = {
  kind:
    | "operating-cost"
    | "operating-total"
    | "organic-cost"
    | "organic-total"
    | "paid"
    | "renewal";
  key: string;
  label: string;
  basis: string;
  proceeds: number | null;
  spend: number | null;
  profit: number | null;
  roas: number | null;
  margin: number | null;
};

export type RevenueProfitabilityDailyRow = {
  date: string;
  facelessSpend: number;
  operatingSpend: number;
  proceeds: number;
  paidSpend: number | null;
  ugcSpend: number;
  totalSpend: number | null;
  profit: number | null;
  roas: number | null;
};

export type RevenueProfitabilityData = {
  blendedRoas: number | null;
  currency: string | null;
  dailyRows: RevenueProfitabilityDailyRow[];
  facelessConfigured: boolean;
  facelessErrorMessage: string | null;
  facelessSpend: number;
  knownSpend: number;
  netProfit: number;
  operatingSpend: number;
  paidSourceSpend: number;
  rows: RevenueProfitabilityRow[];
  ugcSpend: number;
  unknownSpendLabels: string[];
};

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>,
) {
  const results: R[] = [];
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(concurrency, 1), items.length);

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        const item = items[currentIndex];

        if (item !== undefined) {
          results[currentIndex] = await mapper(item);
        }
      }
    }),
  );

  return results;
}

async function getRevenueUgcPaySpendData(args: {
  organizationSlug: string;
  searchParams: DashboardSearchParams;
  startDate: string;
  endDate: string;
}): Promise<RevenueUgcPaySpendData> {
  const searchParams = getRevenueUgcPaySearchParams(args);
  const dateKeys = getDateKeys(args.startDate, args.endDate);
  const [data, dailyRows] = await Promise.all([
    getOrganizationUgcPayData({
      organizationSlug: args.organizationSlug,
      searchParams,
    }),
    mapWithConcurrency(dateKeys, UGC_PAY_DAILY_QUERY_CONCURRENCY, async (date) => {
      const dailyData = await getOrganizationUgcPayData({
        organizationSlug: args.organizationSlug,
        searchParams: {
          ...searchParams,
          endDate: date,
          startDate: date,
        },
      });

      return {
        date,
        totalPay: dailyData.summary.totalPay,
      };
    }),
  ]);

  return {
    dailyRows,
    data,
  };
}

function getRatio(numerator: number | null, denominator: number | null) {
  if (
    typeof numerator !== "number" ||
    typeof denominator !== "number" ||
    !Number.isFinite(numerator) ||
    !Number.isFinite(denominator) ||
    denominator <= 0
  ) {
    return null;
  }

  return numerator / denominator;
}

function getProfit(proceeds: number, spend: number | null) {
  return typeof spend === "number" && Number.isFinite(spend)
    ? proceeds - spend
    : null;
}

function roundCurrency(value: number) {
  return Math.round(value * 100) / 100;
}

function getDaysInUtcMonth(date: string) {
  const parsed = new Date(`${date}T00:00:00.000Z`);

  if (Number.isNaN(parsed.getTime())) {
    return 30;
  }

  return new Date(
    Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth() + 1, 0),
  ).getUTCDate();
}

function getMonthlyCostDailyAmount(date: string, monthlyAmount: number) {
  return monthlyAmount / getDaysInUtcMonth(date);
}

function getOperatingCostDailyBreakdown(args: {
  date: string;
  proceeds: number;
}) {
  const fixedRows = MONTHLY_OPERATING_COSTS.map((cost) => ({
    ...cost,
    amount: getMonthlyCostDailyAmount(args.date, cost.monthlyAmount),
  }));
  const superwallRevenueFee = args.proceeds * SUPERWALL_REVENUE_FEE_RATE;
  const rows = fixedRows.map((row) =>
    row.key === "superwall"
      ? {
          ...row,
          amount: row.amount + superwallRevenueFee,
        }
      : row,
  );

  return {
    rows,
    total: roundCurrency(rows.reduce((total, row) => total + row.amount, 0)),
  };
}

function getOperatingCostRows(dailyRows: RevenueProfitabilityDailyRow[]) {
  const spendByKey = new Map<string, number>();

  for (const row of dailyRows) {
    for (const cost of getOperatingCostDailyBreakdown({
      date: row.date,
      proceeds: row.proceeds,
    }).rows) {
      spendByKey.set(cost.key, (spendByKey.get(cost.key) ?? 0) + cost.amount);
    }
  }

  return MONTHLY_OPERATING_COSTS.map((cost) => ({
    cost,
    spend: roundCurrency(spendByKey.get(cost.key) ?? 0),
  }));
}

function getCompleteDailyProfitabilityTotals(
  dailyRows: RevenueProfitabilityDailyRow[],
) {
  if (
    dailyRows.length === 0 ||
    dailyRows.some(
      (row) =>
        typeof row.totalSpend !== "number" ||
        !Number.isFinite(row.totalSpend),
    )
  ) {
    return null;
  }

  const spend = dailyRows.reduce(
    (total, row) => total + (row.totalSpend ?? 0),
    0,
  );

  return {
    knownSpend: roundCurrency(spend),
  };
}

function buildProfitabilityRows(args: {
  facelessSpend: number;
  operatingCostRows: Array<{
    cost: (typeof MONTHLY_OPERATING_COSTS)[number];
    spend: number;
  }>;
  operatingSpend: number;
  report: RevenueAttributionReport;
  ugcPayData: RevenueUgcPaySpendData;
}) {
  const paidRows: RevenueProfitabilityRow[] = args.report.sourceRows
    .filter((row) => row.kind !== "organic" && row.kind !== "renewal")
    .map((row) => {
      const profit = getProfit(row.revenue, row.spend);

      return {
        kind: "paid",
        key: `${row.kind}:${row.label}`,
        label: row.label,
        basis:
          row.spend === null
            ? "Proceeds only; spend unavailable"
            : row.kind === "apple" && row.rawLabel === "adapty_dashboard_asa"
              ? "Adapty Ads Manager spend + proceeds"
              : "Singular spend + proceeds",
        proceeds: row.revenue,
        spend: row.spend,
        profit,
        roas: getRatio(row.revenue, row.spend),
        margin: getRatio(profit, row.revenue),
      } satisfies RevenueProfitabilityRow;
    })
    .sort(
      (left, right) =>
        (right.profit ?? Number.NEGATIVE_INFINITY) -
          (left.profit ?? Number.NEGATIVE_INFINITY) ||
        (right.proceeds ?? 0) - (left.proceeds ?? 0) ||
        left.label.localeCompare(right.label),
    );

  const ugcSpend = args.ugcPayData.data.summary.totalPay;
  const creatorSpend = ugcSpend + args.facelessSpend;
  const ugcProfit = getProfit(args.report.totals.organic, creatorSpend);
  const organicRows: RevenueProfitabilityRow[] = [
    {
      kind: "renewal",
      key: "renewal:existing-subscribers",
      label: "Renewals / existing subscribers",
      basis: "Adapty old-source proceeds excluded from organic / creator proceeds",
      proceeds: args.report.totals.renewal,
      spend: null,
      profit: null,
      roas: null,
      margin: null,
    },
    {
      kind: "organic-total",
      key: "organic:total",
      label: "Organic / creator spend",
      basis:
        args.facelessSpend > 0
          ? "Adapty organic proceeds - UGC Pay owed - ViewsBase faceless spend"
          : "Adapty organic proceeds - UGC Pay owed",
      proceeds: args.report.totals.organic,
      spend: creatorSpend,
      profit: ugcProfit,
      roas: getRatio(args.report.totals.organic, creatorSpend),
      margin: getRatio(ugcProfit, args.report.totals.organic),
    },
    {
      kind: "organic-cost",
      key: "organic:ugc-pay",
      label: "UGC Pay",
      basis: "Cost breakdown of organic / creator spend above",
      proceeds: null,
      spend: ugcSpend,
      profit: null,
      roas: null,
      margin: null,
    },
    {
      kind: "organic-cost",
      key: "organic:faceless",
      label: "ViewsBase faceless",
      basis: "Cost breakdown of organic / creator spend above",
      proceeds: null,
      spend: args.facelessSpend,
      profit: null,
      roas: null,
      margin: null,
    },
  ];
  const operatingRows: RevenueProfitabilityRow[] = [
    {
      kind: "operating-total",
      key: "operating:total",
      label: "Operating costs",
      basis: "Monthly fixed costs prorated by calendar day plus Superwall 1% revenue fee",
      proceeds: null,
      spend: args.operatingSpend,
      profit: null,
      roas: null,
      margin: null,
    },
    ...args.operatingCostRows.map(({ cost, spend }) => ({
      kind: "operating-cost" as const,
      key: `operating:${cost.key}`,
      label: cost.label,
      basis:
        cost.key === "superwall"
          ? "$200/month prorated daily + 1% of daily proceeds"
          : `$${cost.monthlyAmount.toLocaleString("en-US")}/month prorated daily`,
      proceeds: null,
      spend,
      profit: null,
      roas: null,
      margin: null,
    })),
  ];

  return [...organicRows, ...operatingRows, ...paidRows];
}

function getFacelessReportCost(report: ViewsBaseFacelessReport | null) {
  if (!report) {
    return 0;
  }

  return getFacelessCostAmount({
    projectedSpend: report.totals.projectedSpend,
    totalSpend: report.totals.totalSpend,
  });
}

function getFacelessDailyCost(
  row: ViewsBaseFacelessReport["dailyRows"][number],
) {
  return getFacelessCostAmount({
    projectedSpend: row.projectedSpend,
    totalSpend: row.totalSpend,
  });
}

export function buildRevenueProfitabilityData(args: {
  facelessSpendReport: FacelessSpendReport;
  report: RevenueAttributionReport;
  ugcPayData: RevenueUgcPaySpendData;
}): RevenueProfitabilityData {
  const facelessSpend = getFacelessReportCost(args.facelessSpendReport.report);
  const paidSourceSpend = args.report.sourceRows
    .filter((row) => row.kind !== "organic" && row.kind !== "renewal")
    .reduce(
      (total, row) =>
        typeof row.spend === "number" && Number.isFinite(row.spend)
          ? total + row.spend
          : total,
      0,
    );
  const paidRows = args.report.sourceRows.filter(
    (row) => row.kind !== "organic" && row.kind !== "renewal",
  );
  const unknownSpendLabels = paidRows
    .filter((row) => row.spend === null)
    .map((row) => row.label);
  const ugcSpend = args.ugcPayData.data.summary.totalPay;
  const ugcPayByDate = new Map(
    args.ugcPayData.dailyRows.map((row) => [row.date, row.totalPay] as const),
  );
  const facelessSpendByDate = new Map(
    (args.facelessSpendReport.report?.dailyRows ?? []).map(
      (row) => [row.date, getFacelessDailyCost(row)] as const,
    ),
  );
  const dailyRows = args.report.dailyRows.map((row) => {
    const ugcDailySpend = ugcPayByDate.get(row.date) ?? 0;
    const facelessDailySpend = facelessSpendByDate.get(row.date) ?? 0;
    const operatingSpend = getOperatingCostDailyBreakdown({
      date: row.date,
      proceeds: row.total,
    }).total;
    const paidSpend = row.paidSpend;
    const totalSpend =
      typeof paidSpend === "number" && Number.isFinite(paidSpend)
        ? roundCurrency(
            paidSpend + ugcDailySpend + facelessDailySpend + operatingSpend,
          )
        : null;
    const profit = getProfit(row.total, totalSpend);

    return {
      date: row.date,
      facelessSpend: facelessDailySpend,
      operatingSpend,
      paidSpend,
      proceeds: row.total,
      profit,
      roas: getRatio(row.total, totalSpend),
      totalSpend,
      ugcSpend: ugcDailySpend,
    };
  });
  const operatingCostRows = getOperatingCostRows(dailyRows);
  const operatingSpend = roundCurrency(
    operatingCostRows.reduce((total, row) => total + row.spend, 0),
  );
  const rows = buildProfitabilityRows({
    facelessSpend,
    operatingCostRows,
    operatingSpend,
    report: args.report,
    ugcPayData: args.ugcPayData,
  });
  const dailyTotals = getCompleteDailyProfitabilityTotals(dailyRows);
  const fallbackKnownSpend =
    paidSourceSpend + ugcSpend + facelessSpend + operatingSpend;
  const knownSpend = dailyTotals?.knownSpend ?? fallbackKnownSpend;
  const netProfit = roundCurrency(args.report.totals.total - knownSpend);
  const blendedRoas = getRatio(args.report.totals.total, knownSpend);

  return {
    blendedRoas,
    currency: args.report.currency,
    dailyRows,
    facelessConfigured: args.facelessSpendReport.configured,
    facelessErrorMessage: args.facelessSpendReport.errorMessage,
    facelessSpend,
    knownSpend,
    netProfit,
    operatingSpend,
    paidSourceSpend,
    rows,
    ugcSpend,
    unknownSpendLabels,
  };
}

export async function getRevenueProfitabilityData(args: {
  organizationSlug: string;
  searchParams: DashboardSearchParams;
  startDate: string;
  endDate: string;
}) {
  const [report, ugcPayData, facelessSpendReport] = await Promise.all([
    getRevenueAttributionReport({
      endDate: args.endDate,
      organizationSlug: args.organizationSlug,
      startDate: args.startDate,
    }),
    getRevenueUgcPaySpendData({
      endDate: args.endDate,
      organizationSlug: args.organizationSlug,
      searchParams: args.searchParams,
      startDate: args.startDate,
    }),
    getViewsBaseFacelessReport({
      campaignSlug: "all",
      endDate: args.endDate,
      organizationSlug: args.organizationSlug,
      remoteOrgSlug: "gotall",
      startDate: args.startDate,
    })
      .then((viewsBaseReport) => ({
        configured: true,
        errorMessage: null,
        report: viewsBaseReport,
      }))
      .catch((error) => ({
        configured: false,
        errorMessage:
          error instanceof Error
            ? error.message
            : "Unable to load ViewsBase faceless spend.",
        report: null,
      })),
  ]);

  return buildRevenueProfitabilityData({
    facelessSpendReport,
    report,
    ugcPayData,
  });
}
