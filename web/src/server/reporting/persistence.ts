import { prisma } from "@/lib/db";
import {
  ReportingDayBuildStatus,
  ReportingFreshness,
  type ReportingDayVersion,
} from "@/lib/prisma-shim";
import { getRevenueAttributionReport } from "@/server/revenue/revenue";
import {
  getDateKeys,
  getRevenueUgcPaySearchParams,
  type DashboardSearchParamsLike,
} from "@/server/revenue/revenue-profitability-calculations";
import { requireOrganizationMembership } from "@/server/auth/organizations";
import { getOrganizationUgcPayData } from "@/server/ugc-pay/queries";
import { getViewsBaseFacelessReport } from "@/server/viewsbase/report";

import {
  getCanonicalFreshness,
  normalizeCanonicalWarnings,
} from "./aggregation.ts";
import {
  adaptOperatingCostDailyRowsToCanonicalDays,
  adaptRevenueAttributionReportToCanonicalDays,
  adaptUgcPayDailyRowsToCanonicalDays,
  adaptViewsBaseFacelessReportToCanonicalDays,
  type CanonicalBuildContext,
  type CanonicalUgcPayDailyRow,
} from "./adapters.ts";
import { getOperatingCostDailyBreakdown } from "./operating-costs.ts";
import type {
  CanonicalDailyFact,
  CanonicalDayVersion,
  CanonicalDayVersionStatus,
  CanonicalFactDimensions,
  CanonicalFreshness,
} from "./types.ts";

export type RefreshCanonicalReportingResult = {
  organizationId: string;
  organizationSlug: string;
  startDate: string;
  endDate: string;
  status: "completed";
  dayVersions: Array<{
    id: string | null;
    reportDate: string;
    version: number;
    status: CanonicalDayVersionStatus;
    freshness: CanonicalFreshness;
    isCurrent: boolean;
    factCount: number;
    warnings: string[];
  }>;
  warnings: string[];
};

const MAX_SYNC_REFRESH_DAYS = 31;

function parseDateOnly(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function dimensionsKey(dimensions: CanonicalFactDimensions | undefined) {
  return JSON.stringify(
    Object.entries(dimensions ?? {}).sort(([left], [right]) =>
      left.localeCompare(right),
    ),
  );
}

function mergeDayVersions(
  context: CanonicalBuildContext,
  reportDate: string,
  dayVersions: CanonicalDayVersion[],
): CanonicalDayVersion {
  const facts = dayVersions.flatMap((dayVersion) => dayVersion.facts);
  const freshness = getCanonicalFreshness(
    dayVersions.map((dayVersion) => dayVersion.freshness),
  );
  const status = freshness === "incomplete" ? "incomplete" : "succeeded";
  const createdAt = context.createdAt ?? new Date().toISOString();

  return {
    completedAt: createdAt,
    createdAt,
    facts,
    freshness,
    isCurrent: true,
    organizationId: context.organizationId,
    pricingConfigVersion: context.pricingConfigVersion ?? null,
    reportDate,
    sourceConfigVersion: context.sourceConfigVersion ?? null,
    sourceState: dayVersions.flatMap((dayVersion) => dayVersion.sourceState),
    status,
    version: context.version ?? 1,
    warnings: normalizeCanonicalWarnings(
      dayVersions.flatMap((dayVersion) => dayVersion.warnings),
    ),
  };
}

function toBuildStatus(status: CanonicalDayVersionStatus) {
  switch (status) {
    case "failed":
      return ReportingDayBuildStatus.FAILED;
    case "incomplete":
      return ReportingDayBuildStatus.INCOMPLETE;
    case "running":
      return ReportingDayBuildStatus.RUNNING;
    case "superseded":
      return ReportingDayBuildStatus.SUPERSEDED;
    case "succeeded":
    default:
      return ReportingDayBuildStatus.SUCCEEDED;
  }
}

function toFreshness(freshness: CanonicalFreshness) {
  switch (freshness) {
    case "incomplete":
      return ReportingFreshness.INCOMPLETE;
    case "stale":
      return ReportingFreshness.STALE;
    case "superseded":
      return ReportingFreshness.SUPERSEDED;
    case "fresh":
    default:
      return ReportingFreshness.FRESH;
  }
}

function shouldPublishCurrent(args: {
  dayVersion: CanonicalDayVersion;
  existingCurrent: ReportingDayVersion | null;
}) {
  return args.dayVersion.status === "succeeded" || !args.existingCurrent;
}

async function getNextVersion(args: {
  organizationId: string;
  reportDate: string;
}) {
  const existing = (await prisma.reportingDayVersion.findMany({
    where: {
      organizationId: args.organizationId,
      reportDate: parseDateOnly(args.reportDate),
    },
    orderBy: {
      version: "desc",
    },
    take: 1,
  })) as ReportingDayVersion[];

  return (existing[0]?.version ?? 0) + 1;
}

async function persistCanonicalDayVersion(dayVersion: CanonicalDayVersion) {
  const reportDate = parseDateOnly(dayVersion.reportDate);
  const existingCurrent = (await prisma.reportingDayVersion.findFirst({
    where: {
      organizationId: dayVersion.organizationId,
      reportDate,
      isCurrent: true,
    },
  })) as ReportingDayVersion | null;
  const publishCurrent = shouldPublishCurrent({
    dayVersion,
    existingCurrent,
  });

  return prisma.$transaction(async (tx) => {
    if (publishCurrent) {
      await tx.reportingDayVersion.updateMany({
        where: {
          organizationId: dayVersion.organizationId,
          reportDate,
          isCurrent: true,
        },
        data: {
          freshness: ReportingFreshness.SUPERSEDED,
          isCurrent: false,
          status: ReportingDayBuildStatus.SUPERSEDED,
        },
      });
    } else if (existingCurrent) {
      await tx.reportingDayVersion.update({
        where: {
          id: existingCurrent.id,
        },
        data: {
          freshness: ReportingFreshness.STALE,
          warnings: normalizeCanonicalWarnings([
            ...extractWarnings(existingCurrent.warnings),
            ...dayVersion.warnings,
            `A canonical refresh for ${dayVersion.reportDate} did not complete; this prior current version remains visible.`,
          ]),
        },
      });
    }

    const created = (await tx.reportingDayVersion.create({
      data: {
        completedAt: dayVersion.completedAt ? new Date(dayVersion.completedAt) : null,
        createdAt: new Date(dayVersion.createdAt),
        error: dayVersion.error ? { message: dayVersion.error } : null,
        freshness: toFreshness(dayVersion.freshness),
        isCurrent: publishCurrent,
        organizationId: dayVersion.organizationId,
        pricingConfigVersion: dayVersion.pricingConfigVersion ?? null,
        reportDate,
        sourceConfigVersion: dayVersion.sourceConfigVersion ?? null,
        sourceState: dayVersion.sourceState,
        status: toBuildStatus(dayVersion.status),
        version: dayVersion.version,
        warnings: dayVersion.warnings,
      },
    })) as ReportingDayVersion;

    for (const fact of dayVersion.facts) {
      await tx.reportingDailyFact.create({
        data: serializeFactForPersistence(created.id, fact),
      });
    }

    return {
      ...dayVersion,
      id: created.id,
      isCurrent: publishCurrent,
    } satisfies CanonicalDayVersion;
  });
}

function serializeFactForPersistence(
  dayVersionId: string,
  fact: CanonicalDailyFact,
) {
  return {
    bucket: fact.bucket ?? "total",
    createdAt: fact.createdAt ? new Date(fact.createdAt) : new Date(),
    currency: fact.currency ?? null,
    dayVersionId,
    dimensions: fact.dimensions ?? {},
    dimensionsKey: dimensionsKey(fact.dimensions),
    metricKey: fact.metricKey,
    organizationId: fact.organizationId,
    provenance: fact.provenance,
    reportDate: parseDateOnly(fact.reportDate),
    source: fact.source ?? "total",
    unit: fact.unit,
    value: fact.value,
  };
}

function extractWarnings(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((entry) =>
      typeof entry === "string" ? entry : JSON.stringify(entry),
    );
  }

  if (typeof value === "string") {
    return [value];
  }

  return [];
}

function getDayVersionMap(dayVersions: CanonicalDayVersion[]) {
  return new Map(dayVersions.map((dayVersion) => [dayVersion.reportDate, dayVersion]));
}

async function getUgcPayDailyRows(args: {
  organizationSlug: string;
  searchParams: DashboardSearchParamsLike;
  startDate: string;
  endDate: string;
}) {
  const searchParams = getRevenueUgcPaySearchParams(args);
  const dateKeys = getDateKeys(args.startDate, args.endDate);

  return Promise.all(
    dateKeys.map(async (date): Promise<CanonicalUgcPayDailyRow> => {
      const data = await getOrganizationUgcPayData({
        organizationSlug: args.organizationSlug,
        searchParams: {
          ...searchParams,
          endDate: date,
          startDate: date,
        },
      });

      return {
        date,
        fixedPay: data.summary.fixedPay,
        grossViews: data.summary.grossViews,
        paidViewsDeducted: data.summary.paidViewsDeducted,
        payableViews: data.summary.payableViews,
        totalPay: data.summary.totalPay,
        videoPay: data.summary.videoPay,
        videos: data.summary.videos,
        warnings: normalizeCanonicalWarnings([
          ...data.warnings,
          ...(data.errorMessage ? [data.errorMessage] : []),
        ]),
      };
    }),
  );
}

export async function refreshCanonicalReporting(args: {
  organizationSlug: string;
  startDate: string;
  endDate: string;
  searchParams?: DashboardSearchParamsLike;
}) {
  const dateKeys = getDateKeys(args.startDate, args.endDate);

  if (dateKeys.length === 0) {
    throw new Error("A valid startDate and endDate are required.");
  }

  if (dateKeys.length > MAX_SYNC_REFRESH_DAYS) {
    throw new Error(
      `Canonical reporting refresh is limited to ${MAX_SYNC_REFRESH_DAYS} days per request.`,
    );
  }

  const membership = await requireOrganizationMembership(args.organizationSlug);
  const organizationId = membership.organizationId;
  const createdAt = new Date().toISOString();
  const [revenueReport, ugcPayRows, viewsBaseReport] = await Promise.all([
    getRevenueAttributionReport({
      endDate: args.endDate,
      organizationSlug: args.organizationSlug,
      startDate: args.startDate,
    }),
    getUgcPayDailyRows({
      endDate: args.endDate,
      organizationSlug: args.organizationSlug,
      searchParams: args.searchParams ?? {},
      startDate: args.startDate,
    }),
    getViewsBaseFacelessReport({
      campaignSlug: "all",
      endDate: args.endDate,
      organizationSlug: args.organizationSlug,
      remoteOrgSlug: "gotall",
      startDate: args.startDate,
    }).catch(() => null),
  ]);
  const baseContext = {
    createdAt,
    organizationId,
  } satisfies CanonicalBuildContext;
  const revenueDaysByDate = getDayVersionMap(
    adaptRevenueAttributionReportToCanonicalDays(baseContext, revenueReport),
  );
  const ugcPayDaysByDate = getDayVersionMap(
    adaptUgcPayDailyRowsToCanonicalDays({
      context: baseContext,
      currency: revenueReport.currency ?? "USD",
      endDate: args.endDate,
      rows: ugcPayRows,
      startDate: args.startDate,
    }),
  );
  const viewsBaseDaysByDate = getDayVersionMap(
    viewsBaseReport
      ? adaptViewsBaseFacelessReportToCanonicalDays(baseContext, viewsBaseReport)
      : [],
  );
  const operatingDaysByDate = getDayVersionMap(
    adaptOperatingCostDailyRowsToCanonicalDays(
      baseContext,
      revenueReport.dailyRows.map((row) =>
        getOperatingCostDailyBreakdown({
          date: row.date,
          proceeds: row.total,
        }),
      ),
    ),
  );
  const persistedDays: CanonicalDayVersion[] = [];

  for (const reportDate of dateKeys) {
    const version = await getNextVersion({ organizationId, reportDate });
    const context = {
      ...baseContext,
      version,
    };
    const providerDays = [
      revenueDaysByDate.get(reportDate),
      ugcPayDaysByDate.get(reportDate),
      viewsBaseDaysByDate.get(reportDate),
      operatingDaysByDate.get(reportDate),
    ].filter((dayVersion): dayVersion is CanonicalDayVersion =>
      Boolean(dayVersion),
    );

    if (!viewsBaseReport) {
      providerDays.push({
        completedAt: createdAt,
        createdAt,
        facts: [],
        freshness: "incomplete",
        isCurrent: true,
        organizationId,
        reportDate,
        sourceConfigVersion: null,
        sourceState: [
          {
            provider: "ViewsBase",
            requestedRange: {
              endDate: args.endDate,
              startDate: args.startDate,
            },
            status: "failed",
            warnings: ["ViewsBase faceless report could not be loaded."],
          },
        ],
        status: "incomplete",
        version,
        warnings: ["ViewsBase faceless report could not be loaded."],
      });
    }

    persistedDays.push(
      await persistCanonicalDayVersion(
        mergeDayVersions(context, reportDate, providerDays),
      ),
    );
  }

  return {
    dayVersions: persistedDays.map((dayVersion) => ({
      factCount: dayVersion.facts.length,
      freshness: dayVersion.freshness,
      id: dayVersion.id ?? null,
      isCurrent: dayVersion.isCurrent,
      reportDate: dayVersion.reportDate,
      status: dayVersion.status,
      version: dayVersion.version,
      warnings: dayVersion.warnings,
    })),
    endDate: args.endDate,
    organizationId,
    organizationSlug: args.organizationSlug,
    startDate: args.startDate,
    status: "completed",
    warnings: normalizeCanonicalWarnings(
      persistedDays.flatMap((dayVersion) => dayVersion.warnings),
    ),
  } satisfies RefreshCanonicalReportingResult;
}
