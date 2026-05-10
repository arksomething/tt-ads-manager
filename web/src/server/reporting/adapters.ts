import type {
  RevenueAttributionDailyRow,
  RevenueAttributionReport,
} from "../adapty/revenue";
import type { OrganizationUgcPayData } from "../ugc-pay/queries";
import type { ViewsBaseFacelessReport } from "../viewsbase/report";
import type {
  CanonicalDailyFact,
  CanonicalDayVersion,
  CanonicalFactUnit,
  CanonicalFreshness,
  CanonicalMetricKey,
  CanonicalSourceProvenance,
} from "./types";
import { normalizeCanonicalWarnings } from "./aggregation.ts";

const DEFAULT_VERSION = 1;
const DEFAULT_CREATED_AT = "1970-01-01T00:00:00.000Z";

type FactInput = {
  metricKey: CanonicalMetricKey;
  value: number | null | undefined;
  unit: CanonicalFactUnit;
  currency?: string | null;
  source?: string | null;
  bucket?: string | null;
  dimensions?: CanonicalDailyFact["dimensions"];
};

export type CanonicalBuildContext = {
  organizationId: string;
  version?: number;
  createdAt?: string;
  pricingConfigVersion?: string | null;
  sourceConfigVersion?: string | null;
};

export type CanonicalUgcPayDailyRow = {
  date: string;
  totalPay: number;
  fixedPay?: number | null;
  videoPay?: number | null;
  payableViews?: number | null;
  grossViews?: number | null;
  paidViewsDeducted?: number | null;
  videos?: number | null;
  warnings?: string[];
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function roundMoney(value: number) {
  return Number(value.toFixed(2));
}

function facelessCostAmount(args: { projectedSpend: number; totalSpend: number }) {
  const totalSpend = Number.isFinite(args.totalSpend) ? args.totalSpend : 0;
  const projectedSpend = Number.isFinite(args.projectedSpend)
    ? args.projectedSpend
    : 0;

  return roundMoney(Math.max(totalSpend, projectedSpend));
}

function buildSource(args: {
  provider: string;
  startDate: string;
  endDate: string;
  status: CanonicalSourceProvenance["status"];
  warnings?: string[];
  generatedAt?: string | null;
  rowCount?: number | null;
  cacheKey?: string | null;
  providerReportId?: string | null;
}): CanonicalSourceProvenance {
  return {
    cacheKey: args.cacheKey ?? null,
    generatedAt: args.generatedAt ?? null,
    provider: args.provider,
    providerReportId: args.providerReportId ?? null,
    requestedRange: {
      endDate: args.endDate,
      startDate: args.startDate,
    },
    rowCount: args.rowCount ?? null,
    status: args.status,
    warnings: normalizeCanonicalWarnings(args.warnings ?? []),
  };
}

function makeFacts(args: {
  organizationId: string;
  reportDate: string;
  facts: readonly FactInput[];
  provenance: readonly CanonicalSourceProvenance[];
  createdAt: string;
  version: number;
}) {
  return args.facts.flatMap((fact) => {
    if (!isFiniteNumber(fact.value)) {
      return [];
    }

    return [
      {
        bucket: fact.bucket ?? null,
        createdAt: args.createdAt,
        currency: fact.currency ?? null,
        dimensions: fact.dimensions ?? {},
        metricKey: fact.metricKey,
        organizationId: args.organizationId,
        provenance: [...args.provenance],
        reportDate: args.reportDate,
        source: fact.source ?? null,
        unit: fact.unit,
        value: fact.value,
        version: args.version,
      },
    ];
  }) satisfies CanonicalDailyFact[];
}

function buildDayVersion(args: {
  context: CanonicalBuildContext;
  reportDate: string;
  freshness: CanonicalFreshness;
  sourceState: CanonicalSourceProvenance[];
  warnings: string[];
  facts: CanonicalDailyFact[];
}): CanonicalDayVersion {
  const version = args.context.version ?? DEFAULT_VERSION;
  const createdAt = args.context.createdAt ?? DEFAULT_CREATED_AT;
  const status = args.freshness === "incomplete" ? "incomplete" : "succeeded";

  return {
    completedAt: createdAt,
    createdAt,
    facts: args.facts,
    freshness: args.freshness,
    isCurrent: true,
    organizationId: args.context.organizationId,
    pricingConfigVersion: args.context.pricingConfigVersion ?? null,
    reportDate: args.reportDate,
    sourceConfigVersion: args.context.sourceConfigVersion ?? null,
    sourceState: args.sourceState,
    status,
    version,
    warnings: normalizeCanonicalWarnings(args.warnings),
  };
}

function hasRevenueSourceSplit(report: RevenueAttributionReport) {
  return (
    report.configured &&
    !report.singularPending &&
    report.hasDailySourceBreakdown &&
    report.sourceProvider !== "none"
  );
}

function getRevenueFreshness(report: RevenueAttributionReport) {
  if (!report.configured || report.singularPending || !report.hasDailySourceBreakdown) {
    return "incomplete" satisfies CanonicalFreshness;
  }

  return "fresh" satisfies CanonicalFreshness;
}

function getRevenueWarnings(report: RevenueAttributionReport) {
  return normalizeCanonicalWarnings([
    ...report.warnings,
    ...(!hasRevenueSourceSplit(report)
      ? [
          "Revenue source split is incomplete; canonical organic/UGC proceeds were not published for this snapshot.",
        ]
      : []),
  ]);
}

export function adaptRevenueAttributionReportToCanonicalDays(
  context: CanonicalBuildContext,
  report: RevenueAttributionReport,
) {
  const sourceSplitReady = hasRevenueSourceSplit(report);
  const freshness = getRevenueFreshness(report);
  const warnings = getRevenueWarnings(report);
  const source = buildSource({
    endDate: report.endDate,
    provider: "Revenue Attribution",
    rowCount: report.dailyRows.length,
    startDate: report.startDate,
    status: freshness === "incomplete" ? "partial" : "ready",
    warnings,
  });
  const createdAt = context.createdAt ?? DEFAULT_CREATED_AT;
  const version = context.version ?? DEFAULT_VERSION;

  return report.dailyRows.map((row) => {
    const facts = makeFacts({
      createdAt,
      facts: [
        {
          currency: report.currency,
          metricKey: "proceeds.total",
          source: "adapty",
          unit: "currency",
          value: row.total,
        },
        {
          currency: report.currency,
          metricKey: "proceeds.new",
          source: "adapty",
          unit: "currency",
          value: row.newProceeds,
        },
        {
          currency: report.currency,
          metricKey: "proceeds.renewal",
          source: "adapty",
          unit: "currency",
          value: row.renewal,
        },
        ...(sourceSplitReady ? getRevenueSourceFacts(report, row) : []),
      ],
      organizationId: context.organizationId,
      provenance: [source],
      reportDate: row.date,
      version,
    });

    return buildDayVersion({
      context,
      facts,
      freshness,
      reportDate: row.date,
      sourceState: [source],
      warnings,
    });
  });
}

function getRevenueSourceFacts(
  report: RevenueAttributionReport,
  row: RevenueAttributionDailyRow,
): FactInput[] {
  return [
    {
      currency: report.currency,
      metricKey: "proceeds.paid",
      source: report.sourceProvider,
      unit: "currency",
      value: row.paid,
    },
    {
      currency: report.currency,
      metricKey: "proceeds.tiktok",
      source: "tiktok",
      unit: "currency",
      value: row.tiktok,
    },
    {
      currency: report.currency,
      metricKey: "proceeds.apple_search_ads",
      source: "apple_search_ads",
      unit: "currency",
      value: row.apple,
    },
    {
      currency: report.currency,
      metricKey: "proceeds.organic_ugc",
      source: "organic_ugc",
      unit: "currency",
      value: row.organic,
    },
    {
      currency: report.currency,
      metricKey: "spend.paid.total",
      source: report.sourceProvider,
      unit: "currency",
      value: row.paidSpend,
    },
    {
      currency: report.currency,
      metricKey: "spend.tiktok",
      source: "tiktok",
      unit: "currency",
      value: row.tiktokSpend,
    },
  ];
}

export function adaptUgcPayDailyRowsToCanonicalDays(args: {
  context: CanonicalBuildContext;
  rows: readonly CanonicalUgcPayDailyRow[];
  startDate: string;
  endDate: string;
  currency?: string | null;
  warnings?: string[];
}) {
  const source = buildSource({
    endDate: args.endDate,
    provider: "UGC Pay",
    rowCount: args.rows.length,
    startDate: args.startDate,
    status: "ready",
    warnings: args.warnings,
  });
  const createdAt = args.context.createdAt ?? DEFAULT_CREATED_AT;
  const version = args.context.version ?? DEFAULT_VERSION;

  return args.rows.map((row) => {
    const warnings = normalizeCanonicalWarnings([
      ...(args.warnings ?? []),
      ...(row.warnings ?? []),
    ]);
    const rowSource = {
      ...source,
      requestedRange: {
        endDate: row.date,
        startDate: row.date,
      },
      warnings,
    };
    const facts = makeFacts({
      createdAt,
      facts: [
        {
          currency: args.currency ?? null,
          metricKey: "spend.ugc.total",
          source: "ugc_pay",
          unit: "currency",
          value: row.totalPay,
        },
        {
          currency: args.currency ?? null,
          metricKey: "spend.ugc.fixed",
          source: "ugc_pay",
          unit: "currency",
          value: row.fixedPay,
        },
        {
          currency: args.currency ?? null,
          metricKey: "spend.ugc.cpm_video_pay",
          source: "ugc_pay",
          unit: "currency",
          value: row.videoPay,
        },
        {
          metricKey: "views.ugc",
          source: "ugc_pay",
          unit: "views",
          value: row.payableViews,
        },
        {
          metricKey: "videos.ugc",
          source: "ugc_pay",
          unit: "videos",
          value: row.videos,
        },
      ],
      organizationId: args.context.organizationId,
      provenance: [rowSource],
      reportDate: row.date,
      version,
    });

    return buildDayVersion({
      context: args.context,
      facts,
      freshness: "fresh",
      reportDate: row.date,
      sourceState: [rowSource],
      warnings,
    });
  });
}

export function adaptUgcPaySummaryToCanonicalDay(
  context: CanonicalBuildContext,
  data: OrganizationUgcPayData,
) {
  const isSingleDay = data.startDate === data.endDate;
  const warnings = normalizeCanonicalWarnings([
    ...data.warnings,
    ...(data.errorMessage ? [data.errorMessage] : []),
    ...(!isSingleDay
      ? [
          "UGC Pay summary covers multiple dates; pass daily rows before publishing canonical daily facts.",
        ]
      : []),
  ]);
  const source = buildSource({
    endDate: data.endDate,
    provider: "UGC Pay",
    rowCount: data.videos.length,
    startDate: data.startDate,
    status: data.errorMessage || !isSingleDay ? "partial" : "ready",
    warnings,
  });
  const createdAt = context.createdAt ?? DEFAULT_CREATED_AT;
  const version = context.version ?? DEFAULT_VERSION;
  const facts = isSingleDay
    ? makeFacts({
        createdAt,
        facts: [
          {
            currency: null,
            metricKey: "spend.ugc.total",
            source: "ugc_pay",
            unit: "currency",
            value: data.summary.totalPay,
          },
          {
            currency: null,
            metricKey: "spend.ugc.fixed",
            source: "ugc_pay",
            unit: "currency",
            value: data.summary.fixedPay,
          },
          {
            currency: null,
            metricKey: "spend.ugc.cpm_video_pay",
            source: "ugc_pay",
            unit: "currency",
            value: data.summary.videoPay,
          },
          {
            metricKey: "views.ugc",
            source: "ugc_pay",
            unit: "views",
            value: data.summary.payableViews,
          },
          {
            metricKey: "videos.ugc",
            source: "ugc_pay",
            unit: "videos",
            value: data.summary.videos,
          },
        ],
        organizationId: context.organizationId,
        provenance: [source],
        reportDate: data.startDate,
        version,
      })
    : [];

  return buildDayVersion({
    context,
    facts,
    freshness: data.errorMessage || !isSingleDay ? "incomplete" : "fresh",
    reportDate: data.startDate,
    sourceState: [source],
    warnings,
  });
}

export function adaptViewsBaseFacelessReportToCanonicalDays(
  context: CanonicalBuildContext,
  report: ViewsBaseFacelessReport,
) {
  const reportWarnings: string[] = [];
  const createdAt = context.createdAt ?? DEFAULT_CREATED_AT;
  const version = context.version ?? DEFAULT_VERSION;

  return report.dailyRows.map((row) => {
    const rowIncomplete = row.status === "none";
    const warnings = normalizeCanonicalWarnings([
      ...reportWarnings,
      ...(rowIncomplete
        ? [`ViewsBase returned no faceless spend row for ${row.date}.`]
        : []),
    ]);
    const source = buildSource({
      endDate: row.date,
      generatedAt: report.stats.lastUpdated,
      provider: "ViewsBase",
      rowCount: 1,
      startDate: row.date,
      status: rowIncomplete ? "missing" : row.status,
      warnings,
    });
    const facts = makeFacts({
      createdAt,
      facts: [
        {
          currency: "USD",
          metricKey: "spend.faceless.total",
          source: "viewsbase",
          unit: "currency",
          value: facelessCostAmount({
            projectedSpend: row.projectedSpend,
            totalSpend: row.totalSpend,
          }),
        },
        {
          currency: "USD",
          metricKey: "spend.faceless.base",
          source: "viewsbase",
          unit: "currency",
          value: row.baseTotalSpend,
        },
        {
          currency: "USD",
          metricKey: "spend.faceless.management_fee",
          source: "viewsbase",
          unit: "currency",
          value: row.managementFee,
        },
        {
          currency: "USD",
          metricKey: "spend.faceless.cpm_management_fee",
          source: "viewsbase",
          unit: "currency",
          value: row.cpmManagementFee,
        },
        {
          currency: "USD",
          metricKey: "spend.faceless.fixed_management_fee",
          source: "viewsbase",
          unit: "currency",
          value: row.fixedManagementFee,
        },
        {
          currency: "USD",
          metricKey: "spend.faceless.dashboard_fee",
          source: "viewsbase",
          unit: "currency",
          value: row.dashboardFee,
        },
        {
          metricKey: "views.faceless",
          source: "viewsbase",
          unit: "views",
          value: row.views,
        },
      ],
      organizationId: context.organizationId,
      provenance: [source],
      reportDate: row.date,
      version,
    });

    return buildDayVersion({
      context,
      facts,
      freshness: rowIncomplete ? "incomplete" : "fresh",
      reportDate: row.date,
      sourceState: [source],
      warnings,
    });
  });
}
