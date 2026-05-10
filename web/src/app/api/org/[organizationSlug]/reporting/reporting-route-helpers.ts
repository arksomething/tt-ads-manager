import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import {
  type ReportingDailyFact,
  type ReportingDayVersion,
} from "@/lib/prisma-shim";
import { getDateRangeCacheHeaders } from "@/lib/cache-control";
import { requireOrganizationMembership } from "@/server/auth/organizations";

export type ReportingRouteContext = {
  params: Promise<unknown>;
};

export type ReportingDateRange = {
  startDate: string;
  endDate: string;
};

type MetricTotal = {
  metricKey: string;
  value: number;
  unit: string | null;
  currency: string | null;
};

type SourceMetricTotal = MetricTotal & {
  source: string;
  bucket: string;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function getReportingCacheHeaders(range: ReportingDateRange) {
  return getDateRangeCacheHeaders(range);
}

export async function getOrganizationSlug(context: ReportingRouteContext) {
  const params = await context.params;

  if (
    typeof params === "object" &&
    params !== null &&
    "organizationSlug" in params &&
    typeof params.organizationSlug === "string"
  ) {
    return params.organizationSlug;
  }

  throw new Error("Organization slug is missing.");
}

export function getReportingDateRange(searchParams: URLSearchParams) {
  const startDate = getDateParam(searchParams, "startDate");
  const endDate = getDateParam(searchParams, "endDate");

  if (!startDate || !endDate || startDate > endDate) {
    return null;
  }

  return {
    startDate,
    endDate,
  };
}

export function jsonError(message: string, status: number) {
  return NextResponse.json(
    {
      error: message,
    },
    { status },
  );
}

export function reportingRouteError(label: string, error: unknown) {
  console.error(label, error);

  const message =
    error instanceof Error
      ? error.message
      : "Could not load canonical reporting data right now.";

  return jsonError(message, message === "Organization access denied" ? 403 : 500);
}

export async function loadCanonicalReportingRange(
  organizationSlug: string,
  range: ReportingDateRange,
) {
  const membership = await requireOrganizationMembership(organizationSlug);
  const organizationId = membership.organizationId;
  const start = parseReportDate(range.startDate);
  const end = parseReportDate(range.endDate);
  const requestedDays = enumerateDateRange(range.startDate, range.endDate);
  const dayVersions = (await prisma.reportingDayVersion.findMany({
    where: {
      organizationId,
      isCurrent: true,
      reportDate: {
        gte: start,
        lte: end,
      },
    },
    orderBy: [
      {
        reportDate: "asc",
      },
      {
        version: "asc",
      },
    ],
  })) as ReportingDayVersion[];
  const dayVersionIds = dayVersions.map((dayVersion) => dayVersion.id);
  const facts =
    dayVersionIds.length > 0
      ? ((await prisma.reportingDailyFact.findMany({
          where: {
            organizationId,
            dayVersionId: {
              in: dayVersionIds,
            },
            reportDate: {
              gte: start,
              lte: end,
            },
          },
          orderBy: [
            {
              reportDate: "asc",
            },
            {
              metricKey: "asc",
            },
          ],
        })) as ReportingDailyFact[])
      : [];

  const dayVersionsByDate = new Map(
    dayVersions.map((dayVersion) => [formatReportDate(dayVersion.reportDate), dayVersion]),
  );
  const factsByDate = groupBy(facts, (fact) => formatReportDate(fact.reportDate));
  const missingDays = requestedDays.filter((day) => !dayVersionsByDate.has(day));
  const staleDays = dayVersions
    .filter((dayVersion) => dayVersion.freshness === "STALE")
    .map((dayVersion) => formatReportDate(dayVersion.reportDate));
  const incompleteDays = dayVersions
    .filter(
      (dayVersion) =>
        dayVersion.freshness === "INCOMPLETE" ||
        dayVersion.status === "INCOMPLETE" ||
        dayVersion.status === "FAILED",
    )
    .map((dayVersion) => formatReportDate(dayVersion.reportDate));

  return {
    organizationId,
    organizationSlug,
    range,
    requestedDays,
    includedDayVersions: dayVersions.map(serializeDayVersion),
    missingDays,
    incompleteDays,
    staleDays,
    warnings: dayVersions.flatMap((dayVersion) =>
      extractWarnings(dayVersion.warnings).map((warning) => ({
        reportDate: formatReportDate(dayVersion.reportDate),
        warning,
      })),
    ),
    sourceStatuses: dayVersions.map((dayVersion) => ({
      reportDate: formatReportDate(dayVersion.reportDate),
      sourceState: dayVersion.sourceState ?? null,
    })),
    facts,
    factsByDate,
    totals: summarizeFacts(facts),
    sourceBreakdown: summarizeFactsBySource(facts),
    dayVersionsByDate,
  };
}

export function buildSummaryResponse(
  reportingData: Awaited<ReturnType<typeof loadCanonicalReportingRange>>,
) {
  return {
    organizationSlug: reportingData.organizationSlug,
    range: reportingData.range,
    includedDayVersions: reportingData.includedDayVersions,
    missingDays: reportingData.missingDays,
    incompleteDays: reportingData.incompleteDays,
    staleDays: reportingData.staleDays,
    warnings: reportingData.warnings,
    sourceStatuses: reportingData.sourceStatuses,
    totals: reportingData.totals,
  };
}

export function buildDailyResponse(
  reportingData: Awaited<ReturnType<typeof loadCanonicalReportingRange>>,
) {
  return {
    organizationSlug: reportingData.organizationSlug,
    range: reportingData.range,
    includedDayVersions: reportingData.includedDayVersions,
    missingDays: reportingData.missingDays,
    incompleteDays: reportingData.incompleteDays,
    staleDays: reportingData.staleDays,
    warnings: reportingData.warnings,
    days: reportingData.requestedDays.map((reportDate) => {
      const dayVersion = reportingData.dayVersionsByDate.get(reportDate);

      return {
        reportDate,
        dayVersion: dayVersion ? serializeDayVersion(dayVersion) : null,
        facts: (reportingData.factsByDate.get(reportDate) ?? []).map(serializeFact),
      };
    }),
  };
}

export function buildSourceBreakdownResponse(
  reportingData: Awaited<ReturnType<typeof loadCanonicalReportingRange>>,
) {
  return {
    organizationSlug: reportingData.organizationSlug,
    range: reportingData.range,
    includedDayVersions: reportingData.includedDayVersions,
    missingDays: reportingData.missingDays,
    incompleteDays: reportingData.incompleteDays,
    staleDays: reportingData.staleDays,
    warnings: reportingData.warnings,
    sourceStatuses: reportingData.sourceStatuses,
    sources: reportingData.sourceBreakdown,
  };
}

function getDateParam(searchParams: URLSearchParams, key: string) {
  const value = searchParams.get(key);
  return value && DATE_RE.test(value) ? value : null;
}

function parseReportDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function formatReportDate(value: Date | string) {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }

  return value.slice(0, 10);
}

function enumerateDateRange(startDate: string, endDate: string) {
  const days: string[] = [];
  const cursor = parseReportDate(startDate);
  const end = parseReportDate(endDate);

  while (cursor.getTime() <= end.getTime()) {
    days.push(formatReportDate(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return days;
}

function groupBy<T>(entries: T[], getKey: (entry: T) => string) {
  const grouped = new Map<string, T[]>();

  for (const entry of entries) {
    const key = getKey(entry);
    grouped.set(key, [...(grouped.get(key) ?? []), entry]);
  }

  return grouped;
}

function summarizeFacts(facts: ReportingDailyFact[]) {
  const totals = new Map<string, MetricTotal>();

  for (const fact of facts) {
    const key = [fact.metricKey, fact.unit ?? "", fact.currency ?? ""].join("|");
    const existing = totals.get(key);

    if (existing) {
      existing.value += toNumber(fact.value);
    } else {
      totals.set(key, {
        metricKey: fact.metricKey,
        value: toNumber(fact.value),
        unit: fact.unit ?? null,
        currency: fact.currency ?? null,
      });
    }
  }

  return [...totals.values()].sort((left, right) =>
    left.metricKey.localeCompare(right.metricKey),
  );
}

function summarizeFactsBySource(facts: ReportingDailyFact[]) {
  const totals = new Map<string, SourceMetricTotal>();

  for (const fact of facts) {
    const key = [
      fact.source,
      fact.bucket,
      fact.metricKey,
      fact.unit ?? "",
      fact.currency ?? "",
    ].join("|");
    const existing = totals.get(key);

    if (existing) {
      existing.value += toNumber(fact.value);
    } else {
      totals.set(key, {
        source: fact.source,
        bucket: fact.bucket,
        metricKey: fact.metricKey,
        value: toNumber(fact.value),
        unit: fact.unit ?? null,
        currency: fact.currency ?? null,
      });
    }
  }

  return [...totals.values()].sort((left, right) => {
    const sourceCompare = left.source.localeCompare(right.source);

    if (sourceCompare !== 0) {
      return sourceCompare;
    }

    const bucketCompare = left.bucket.localeCompare(right.bucket);

    if (bucketCompare !== 0) {
      return bucketCompare;
    }

    return left.metricKey.localeCompare(right.metricKey);
  });
}

function serializeDayVersion(dayVersion: ReportingDayVersion) {
  return {
    id: dayVersion.id,
    reportDate: formatReportDate(dayVersion.reportDate),
    version: dayVersion.version,
    status: dayVersion.status,
    freshness: dayVersion.freshness,
    isCurrent: dayVersion.isCurrent,
    pricingConfigVersion: dayVersion.pricingConfigVersion,
    sourceConfigVersion: dayVersion.sourceConfigVersion,
    sourceState: dayVersion.sourceState ?? null,
    warnings: dayVersion.warnings ?? null,
    error: dayVersion.error ?? null,
    createdAt: dayVersion.createdAt.toISOString(),
    completedAt: dayVersion.completedAt?.toISOString() ?? null,
  };
}

function serializeFact(fact: ReportingDailyFact) {
  return {
    id: fact.id,
    dayVersionId: fact.dayVersionId,
    reportDate: formatReportDate(fact.reportDate),
    metricKey: fact.metricKey,
    value: toNumber(fact.value),
    unit: fact.unit ?? null,
    currency: fact.currency ?? null,
    source: fact.source,
    bucket: fact.bucket,
    dimensionsKey: fact.dimensionsKey,
    dimensions: fact.dimensions ?? null,
    provenance: fact.provenance ?? null,
    createdAt: fact.createdAt.toISOString(),
  };
}

function extractWarnings(value: unknown): string[] {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value.map((entry) =>
      typeof entry === "string" ? entry : JSON.stringify(entry),
    );
  }

  if (
    typeof value === "object" &&
    "warnings" in value &&
    Array.isArray(value.warnings)
  ) {
    return value.warnings.map((entry) =>
      typeof entry === "string" ? entry : JSON.stringify(entry),
    );
  }

  if (typeof value === "string") {
    return [value];
  }

  return [JSON.stringify(value)];
}

function toNumber(value: number | string | unknown) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}
