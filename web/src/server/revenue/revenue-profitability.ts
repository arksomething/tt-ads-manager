import { type DashboardSearchParams } from "@/server/dashboard/filters";
import { type RevenueProfitabilityProceedsModel } from "@/lib/revenue-profitability-view";
import {
  getOrganizationUgcPayData,
  type OrganizationUgcPayData,
} from "@/server/ugc-pay/queries";
import {
  getViewsBaseFacelessReport,
  type ViewsBaseFacelessReport,
} from "@/server/viewsbase/report";

import {
  getRevenueProceedsModelConfig,
  getRevenueAttributionReport,
  normalizeRevenueProceedsModel,
  type RevenueAttributionReport,
} from "./revenue";
import {
  getDateKeys,
  getRevenueUgcPaySearchParams,
} from "./revenue-profitability-calculations";
import {
  getOperatingCostDailyBreakdown,
  getOperatingCostRows,
} from "@/server/reporting/operating-costs";
import {
  getFacelessCostBreakdown,
  getFacelessDailyCostBreakdown,
  getUgcManagementCostForDates,
  getUgcManagementDailyCost,
  UGC_MANAGER_MONTHLY_AMOUNT,
} from "./creator-costs";

const UGC_PAY_DAILY_QUERY_CONCURRENCY = 3;
const REVENUE_PROFITABILITY_CACHE_TTL_MS = 5 * 60 * 1000;
const REVENUE_PROFITABILITY_PENDING_CACHE_TTL_MS = 10 * 1000;
const REVENUE_PROFITABILITY_IN_FLIGHT_CACHE_TTL_MS = 30 * 1000;

const globalForRevenueProfitability = globalThis as typeof globalThis & {
  revenueProfitabilityDataCache?: Map<
    string,
    {
      expiresAt: number;
      promise: Promise<RevenueProfitabilityData>;
    }
  >;
};

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
  spendStatus?: "complete" | "partial" | "unavailable";
};

export type RevenueProfitabilityDailyRow = {
  date: string;
  facelessBaseSpend: number;
  facelessManagementSpend: number;
  facelessSpend: number;
  newProceeds: number | null;
  operatingSpend: number;
  proceeds: number;
  paidSpend: number | null;
  paidSpendStatus?: "complete" | "partial" | "unavailable";
  renewalProceeds: number | null;
  ugcManagementSpend: number;
  ugcPaySpend: number;
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
  facelessBaseSpend: number;
  facelessErrorMessage: string | null;
  facelessManagementSpend: number;
  facelessSpend: number;
  knownSpend: number;
  netProfit: number;
  newProceeds: number;
  newProceedsRoas: number | null;
  operatingSpend: number;
  paidSourceSpend: number;
  proceedsModel: RevenueProfitabilityProceedsModel;
  renewalProceeds: number;
  rows: RevenueProfitabilityRow[];
  partialSpendLabels: string[];
  singularPending: boolean;
  totalProceeds: number;
  ugcManagementSpend: number;
  ugcPaySpend: number;
  ugcSpend: number;
  unknownSpendLabels: string[];
  warnings: string[];
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

function getReportTotalProceeds(report: RevenueAttributionReport) {
  return roundCurrency(report.totals.total);
}

function getReportRenewalProceeds(report: RevenueAttributionReport) {
  return roundCurrency(report.totals.renewal ?? 0);
}

function getReportNewProceeds(report: RevenueAttributionReport) {
  return roundCurrency(
    report.totals.newProceeds ??
      Math.max(
        getReportTotalProceeds(report) - getReportRenewalProceeds(report),
        0,
      ),
  );
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
  facelessBaseSpend: number;
  facelessManagementSpend: number;
  facelessSpend: number;
  operatingCostRows: Array<{
    cost: {
      key: string;
      label: string;
      monthlyAmount: number;
    };
    spend: number;
  }>;
  operatingSpend: number;
  report: RevenueAttributionReport;
  ugcManagementSpend: number;
  ugcPaySpend: number;
}) {
  const modelConfig = getRevenueProceedsModelConfig(
    args.report.proceedsModel,
  );
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
            : row.spendStatus === "partial"
              ? "Partial Singular spend + proceeds"
            : row.kind === "apple" && row.rawLabel === "adapty_apple_search_ads"
              ? "Adapty Apple Ads spend + proceeds"
            : row.kind === "apple" && row.rawLabel === "superwall_apple_search_ads"
              ? "Superwall proceeds + Singular spend"
              : "Singular spend + proceeds",
        proceeds: row.revenue,
        spend: row.spend,
        profit,
        roas: getRatio(row.revenue, row.spend),
        margin: getRatio(profit, row.revenue),
        spendStatus: row.spendStatus,
      } satisfies RevenueProfitabilityRow;
    })
    .sort(
      (left, right) =>
        (right.profit ?? Number.NEGATIVE_INFINITY) -
          (left.profit ?? Number.NEGATIVE_INFINITY) ||
        (right.proceeds ?? 0) - (left.proceeds ?? 0) ||
        left.label.localeCompare(right.label),
    );

  const ugcSpend = args.ugcPaySpend + args.ugcManagementSpend;
  const creatorSpend = ugcSpend + args.facelessSpend;
  const ugcProfit = getProfit(args.report.totals.organic, creatorSpend);
  const organicRows: RevenueProfitabilityRow[] = [
    {
      kind: "renewal",
      key: "renewal:existing-subscribers",
      label: "Renewals / existing subscribers",
      basis: modelConfig.excludesRenewalsFromOrganic
        ? "Superwall renewal proceeds excluded from organic / creator proceeds"
        : "Superwall renewal proceeds included in cohorted source / organic proceeds",
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
        modelConfig.excludesRenewalsFromOrganic && args.facelessSpend > 0
          ? "Superwall organic proceeds - UGC Pay owed - UGC management - faceless spend"
          : modelConfig.excludesRenewalsFromOrganic
            ? "Superwall organic proceeds - UGC Pay owed - UGC management"
            : args.facelessSpend > 0
              ? "Superwall cohorted organic proceeds - UGC Pay owed - UGC management - faceless spend"
              : "Superwall cohorted organic proceeds - UGC Pay owed - UGC management",
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
      spend: args.ugcPaySpend,
      profit: null,
      roas: null,
      margin: null,
    },
    {
      kind: "organic-cost",
      key: "organic:ugc-management",
      label: "UGC management",
      basis: `$${UGC_MANAGER_MONTHLY_AMOUNT.toLocaleString("en-US")}/month prorated daily`,
      proceeds: null,
      spend: args.ugcManagementSpend,
      profit: null,
      roas: null,
      margin: null,
    },
    {
      kind: "organic-cost",
      key: "organic:faceless-base",
      label: "ViewsBase faceless base",
      basis: "Cost breakdown of organic / creator spend above",
      proceeds: null,
      spend: args.facelessBaseSpend,
      profit: null,
      roas: null,
      margin: null,
    },
    {
      kind: "organic-cost",
      key: "organic:faceless-management",
      label: "Faceless management",
      basis: "ViewsBase CPM, fixed, and dashboard management fees",
      proceeds: null,
      spend: args.facelessManagementSpend,
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

function getUgcPaySpend(ugcPayData: RevenueUgcPaySpendData) {
  if (ugcPayData.dailyRows.length > 0) {
    return roundCurrency(
      ugcPayData.dailyRows.reduce((total, row) => total + row.totalPay, 0),
    );
  }

  return ugcPayData.data.summary.totalPay;
}

function getPaidSourceSpend(report: RevenueAttributionReport) {
  const dailySpend = report.dailyRows.reduce((total, row) => {
    if (typeof row.paidSpend !== "number" || !Number.isFinite(row.paidSpend)) {
      return total;
    }

    return total + row.paidSpend;
  }, 0);

  if (dailySpend > 0 || report.dailyRows.some((row) => row.paidSpend !== null)) {
    return roundCurrency(dailySpend);
  }

  return roundCurrency(
    report.sourceRows
      .filter((row) => row.kind !== "organic" && row.kind !== "renewal")
      .reduce(
        (total, row) =>
          typeof row.spend === "number" && Number.isFinite(row.spend)
            ? total + row.spend
            : total,
        0,
      ),
  );
}

export function buildRevenueProfitabilityData(args: {
  facelessSpendReport: FacelessSpendReport;
  report: RevenueAttributionReport;
  ugcPayData: RevenueUgcPaySpendData;
}): RevenueProfitabilityData {
  const dateKeys = args.report.dailyRows.map((row) => row.date);
  const facelessCostBreakdown = getFacelessCostBreakdown(
    args.facelessSpendReport.report,
  );
  const facelessSpend = facelessCostBreakdown.totalSpend;
  const paidSourceSpend = getPaidSourceSpend(args.report);
  const paidRows = args.report.sourceRows.filter(
    (row) => row.kind !== "organic" && row.kind !== "renewal",
  );
  const unknownSpendLabels = paidRows
    .filter((row) => row.spend === null)
    .map((row) => row.label);
  const partialSpendLabels = paidRows
    .filter((row) => row.spendStatus === "partial")
    .map((row) => row.label);
  const ugcPaySpend = getUgcPaySpend(args.ugcPayData);
  const ugcManagementSpend = getUgcManagementCostForDates(dateKeys);
  const ugcSpend = roundCurrency(ugcPaySpend + ugcManagementSpend);
  const ugcPayByDate = new Map(
    args.ugcPayData.dailyRows.map((row) => [row.date, row.totalPay] as const),
  );
  const facelessSpendByDate = new Map(
    (args.facelessSpendReport.report?.dailyRows ?? []).map(
      (row) => [row.date, getFacelessDailyCostBreakdown(row)] as const,
    ),
  );
  const dailyRows = args.report.dailyRows.map((row) => {
    const ugcPayDailySpend = ugcPayByDate.get(row.date) ?? 0;
    const ugcManagementDailySpend = getUgcManagementDailyCost(row.date);
    const ugcDailySpend = roundCurrency(
      ugcPayDailySpend + ugcManagementDailySpend,
    );
    const facelessDailyBreakdown = facelessSpendByDate.get(row.date) ?? {
      baseSpend: 0,
      managementSpend: 0,
      totalSpend: 0,
    };
    const facelessDailySpend = facelessDailyBreakdown.totalSpend;
    const operatingSpend = getOperatingCostDailyBreakdown({
      date: row.date,
      proceeds: row.total,
    }).total;
    const paidSpend = row.paidSpend;
    const paidSpendStatus =
      row.paidSpendStatus ??
      (typeof paidSpend === "number" && Number.isFinite(paidSpend)
        ? "complete"
        : "unavailable");
    const totalSpend =
      typeof paidSpend === "number" && Number.isFinite(paidSpend)
        ? roundCurrency(
            paidSpend + ugcDailySpend + facelessDailySpend + operatingSpend,
          )
        : null;
    const profit = getProfit(row.total, totalSpend);

    return {
      date: row.date,
      facelessBaseSpend: facelessDailyBreakdown.baseSpend,
      facelessManagementSpend: facelessDailyBreakdown.managementSpend,
      facelessSpend: facelessDailySpend,
      newProceeds: row.newProceeds ?? null,
      operatingSpend,
      paidSpend,
      paidSpendStatus,
      proceeds: row.total,
      profit,
      renewalProceeds: row.renewal ?? null,
      roas: getRatio(row.total, totalSpend),
      totalSpend,
      ugcManagementSpend: ugcManagementDailySpend,
      ugcPaySpend: ugcPayDailySpend,
      ugcSpend: ugcDailySpend,
    };
  });
  const operatingCostRows = getOperatingCostRows(dailyRows);
  const operatingSpend = roundCurrency(
    operatingCostRows.reduce((total, row) => total + row.spend, 0),
  );
  const rows = buildProfitabilityRows({
    facelessBaseSpend: facelessCostBreakdown.baseSpend,
    facelessManagementSpend: facelessCostBreakdown.managementSpend,
    facelessSpend,
    operatingCostRows,
    operatingSpend,
    report: args.report,
    ugcManagementSpend,
    ugcPaySpend,
  });
  const dailyTotals = getCompleteDailyProfitabilityTotals(dailyRows);
  const fallbackKnownSpend =
    paidSourceSpend + ugcSpend + facelessSpend + operatingSpend;
  const knownSpend = dailyTotals?.knownSpend ?? fallbackKnownSpend;
  const totalProceeds = getReportTotalProceeds(args.report);
  const renewalProceeds = getReportRenewalProceeds(args.report);
  const newProceeds = getReportNewProceeds(args.report);
  const netProfit = roundCurrency(totalProceeds - knownSpend);
  const blendedRoas = getRatio(totalProceeds, knownSpend);
  const newProceedsRoas = getRatio(newProceeds, knownSpend);

  return {
    blendedRoas,
    currency: args.report.currency,
    dailyRows,
    facelessConfigured: args.facelessSpendReport.configured,
    facelessBaseSpend: facelessCostBreakdown.baseSpend,
    facelessErrorMessage: args.facelessSpendReport.errorMessage,
    facelessManagementSpend: facelessCostBreakdown.managementSpend,
    facelessSpend,
    knownSpend,
    netProfit,
    newProceeds,
    newProceedsRoas,
    operatingSpend,
    partialSpendLabels,
    paidSourceSpend,
    proceedsModel: args.report.proceedsModel,
    renewalProceeds,
    rows,
    singularPending: Boolean(args.report.singularPending),
    totalProceeds,
    ugcManagementSpend,
    ugcPaySpend,
    ugcSpend,
    unknownSpendLabels,
    warnings: args.report.warnings ?? [],
  };
}

function getProfitabilityCache() {
  if (!globalForRevenueProfitability.revenueProfitabilityDataCache) {
    globalForRevenueProfitability.revenueProfitabilityDataCache = new Map();
  }

  return globalForRevenueProfitability.revenueProfitabilityDataCache;
}

function normalizeSearchParamsForCache(searchParams: DashboardSearchParams) {
  const entries = Object.entries(searchParams)
    .flatMap(([key, value]): Array<[string, string | string[]]> => {
      if (value === undefined) {
        return [];
      }

      return [[key, Array.isArray(value) ? [...value].sort() : value]];
    })
    .sort((left, right) => left[0].localeCompare(right[0]));

  return JSON.stringify(entries);
}

function getSearchParamValue(
  searchParams: DashboardSearchParams,
  key: string,
) {
  const value = searchParams[key];
  return Array.isArray(value) ? value[0] : value;
}

function getRevenueProfitabilityCacheKey(args: {
  organizationSlug: string;
  searchParams: DashboardSearchParams;
  startDate: string;
  endDate: string;
}) {
  return JSON.stringify({
    endDate: args.endDate,
    organizationSlug: args.organizationSlug,
    searchParams: normalizeSearchParamsForCache(args.searchParams),
    startDate: args.startDate,
  });
}

async function loadRevenueProfitabilityData(args: {
  organizationSlug: string;
  searchParams: DashboardSearchParams;
  startDate: string;
  endDate: string;
}) {
  const proceedsModel = normalizeRevenueProceedsModel(
    getSearchParamValue(args.searchParams, "revenueModel"),
  );
  const [report, ugcPayData, facelessSpendReport] = await Promise.all([
    getRevenueAttributionReport({
      endDate: args.endDate,
      organizationSlug: args.organizationSlug,
      proceedsModel,
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

export async function getRevenueProfitabilityData(args: {
  organizationSlug: string;
  searchParams: DashboardSearchParams;
  startDate: string;
  endDate: string;
}) {
  const cache = getProfitabilityCache();
  const cacheKey = getRevenueProfitabilityCacheKey(args);
  const now = Date.now();
  const cached = cache.get(cacheKey);

  if (cached && cached.expiresAt > now) {
    return cached.promise;
  }

  let promise!: Promise<RevenueProfitabilityData>;
  promise = loadRevenueProfitabilityData(args).then((data) => {
    if (cache.get(cacheKey)?.promise === promise) {
      cache.set(cacheKey, {
        expiresAt:
          Date.now() +
          (data.singularPending
            ? REVENUE_PROFITABILITY_PENDING_CACHE_TTL_MS
            : REVENUE_PROFITABILITY_CACHE_TTL_MS),
        promise: Promise.resolve(data),
      });
    }

    return data;
  }).catch((error) => {
    if (cache.get(cacheKey)?.promise === promise) {
      cache.delete(cacheKey);
    }

    throw error;
  });

  cache.set(cacheKey, {
    expiresAt: now + REVENUE_PROFITABILITY_IN_FLIGHT_CACHE_TTL_MS,
    promise,
  });

  return promise;
}
