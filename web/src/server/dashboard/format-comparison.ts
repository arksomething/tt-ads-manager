import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/db";
import { Platform } from "@/lib/prisma-shim";
import { summarizeUgcStatusWarnings } from "@/lib/report-warnings";
import { requireOrganizationMembership } from "@/server/auth/organizations";
import { canReadOrganizationCampaignData } from "@/server/auth/roles";
import { type DashboardSearchParams } from "@/server/dashboard/filters";
import {
  getDateKeys,
  getRevenueUgcPaySearchParams,
} from "@/server/revenue/revenue-profitability-calculations";
import {
  getRevenueAttributionReport,
  getRevenueProceedsModelConfig,
  type RevenueAttributionDailyRow,
  type RevenueProceedsModel,
} from "@/server/revenue/revenue";
import {
  getOrganizationUgcPayData,
  type UgcPayVideoRow,
} from "@/server/ugc-pay/queries";

import {
  calculateFormatComparison,
  normalizeFormatTag,
  type FormatComparisonResult,
  type FormatComparisonSourceDay,
} from "./format-comparison-calculations";

const FORMAT_COMPARISON_DAILY_QUERY_CONCURRENCY = 3;
const FORMAT_COMPARISON_CANDIDATE_LIMIT = "25";
const FORMAT_COMPARISON_TOP_VIDEO_LIMIT = Number(
  FORMAT_COMPARISON_CANDIDATE_LIMIT,
);
export const FORMAT_COMPARISON_PROCEEDS_MODEL =
  "cohorted_all" satisfies RevenueProceedsModel;

export type FormatComparisonTraceEvent = {
  detail: string;
  key: string;
  label: string;
  progress: number;
  status: "completed" | "failed" | "info" | "started";
};

type FormatComparisonTrace = (
  event: FormatComparisonTraceEvent,
) => Promise<void> | void;

type FormatTagRow = {
  formatTag?: string | null;
  sourceVideoId: string;
};

export type FormatComparisonData = FormatComparisonResult & {
  currency: string | null;
  endDate: string;
  formatOptions: string[];
  isPending: boolean;
  proceedsDateBasisLabel: string;
  proceedsConfigured: boolean;
  proceedsModel: RevenueProceedsModel;
  proceedsModelLabel: string;
  selectedCampaignLabel: string | null;
  startDate: string;
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

function getUgcVideoTitle(video: UgcPayVideoRow) {
  const title = video.titleOrCaption?.trim();

  if (title) {
    return title;
  }

  return video.sourceVideoId || video.videoId || "Untitled video";
}

function buildFormatComparisonSearchParams(args: {
  endDate: string;
  searchParams: DashboardSearchParams;
  startDate: string;
}) {
  return {
    ...getRevenueUgcPaySearchParams(args),
    topLimit: FORMAT_COMPARISON_CANDIDATE_LIMIT,
  };
}

function roundCurrency(value: number) {
  return Math.round(value * 100) / 100;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function getFormatComparisonDailyRevenueMap(args: {
  dailyRows: RevenueAttributionDailyRow[];
  dates: string[];
}) {
  const dailyRowsByDate = new Map(args.dailyRows.map((row) => [row.date, row]));

  return new Map(
    args.dates.map((date) => {
      const row = dailyRowsByDate.get(date);

      if (!row) {
        return [date, null] as const;
      }

      if (isFiniteNumber(row.organic) && isFiniteNumber(row.tiktok)) {
        return [
          date,
          roundCurrency(Math.max(row.organic, 0) + Math.max(row.tiktok, 0)),
        ] as const;
      }

      return [date, null] as const;
    }),
  );
}

async function getVideoFormatTags(args: {
  organizationId: string;
  sourceVideoIds: string[];
}) {
  if (args.sourceVideoIds.length === 0) {
    return {
      tags: new Map<string, string | null>(),
      warning: null,
    };
  }

  try {
    const rows = (await prisma.videoContentClassification.findMany({
      where: {
        organizationId: args.organizationId,
        platform: Platform.TIKTOK,
        sourceVideoId: {
          in: args.sourceVideoIds,
        },
      },
      select: {
        formatTag: true,
        sourceVideoId: true,
      },
    })) as FormatTagRow[];

    return {
      tags: new Map(
        rows.map((row) => [
          row.sourceVideoId,
          normalizeFormatTag(row.formatTag),
        ] as const),
      ),
      warning: null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    return {
      tags: new Map<string, string | null>(),
      warning: `Format tags could not be loaded: ${message}`,
    };
  }
}

async function getOrganizationFormatOptions(args: {
  organizationId: string;
}) {
  try {
    const rows = (await prisma.videoContentClassification.findMany({
      where: {
        organizationId: args.organizationId,
        platform: Platform.TIKTOK,
        formatTag: {
          not: null,
        },
      },
      select: {
        formatTag: true,
      },
    })) as Array<{
      formatTag?: string | null;
    }>;
    const options = [
      ...new Set(
        rows
          .map((row) => normalizeFormatTag(row.formatTag))
          .filter((value): value is string => Boolean(value)),
      ),
    ].sort((left, right) => left.localeCompare(right));

    return {
      options,
      warning: null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    return {
      options: [] as string[],
      warning: `Saved format names could not be loaded: ${message}`,
    };
  }
}

export async function getFormatComparisonData(args: {
  endDate: string;
  organizationSlug: string;
  searchParams: DashboardSearchParams;
  startDate: string;
  trace?: FormatComparisonTrace;
}): Promise<FormatComparisonData> {
  const trace = async (event: FormatComparisonTraceEvent) => {
    await args.trace?.(event);
  };

  await trace({
    detail: "Checking your workspace and role before loading report data.",
    key: "access",
    label: "Checking access",
    progress: 4,
    status: "started",
  });
  const membership = await requireOrganizationMembership(args.organizationSlug);
  await trace({
    detail: "Workspace access confirmed.",
    key: "access",
    label: "Checking access",
    progress: 8,
    status: "completed",
  });

  await trace({
    detail: "Building date keys and applying the selected filters.",
    key: "request",
    label: "Preparing request",
    progress: 10,
    status: "started",
  });
  const dateKeys = getDateKeys(args.startDate, args.endDate);
  const ugcPaySearchParams = buildFormatComparisonSearchParams(args);
  await trace({
    detail: `${dateKeys.length} day${dateKeys.length === 1 ? "" : "s"} selected for analysis.`,
    key: "request",
    label: "Preparing request",
    progress: 12,
    status: "completed",
  });

  await trace({
    detail: "Loading cohorted all organic proceeds by day.",
    key: "revenue",
    label: "Loading revenue",
    progress: 14,
    status: "started",
  });
  await trace({
    detail: `Loading daily UGC rows with ${FORMAT_COMPARISON_DAILY_QUERY_CONCURRENCY} concurrent workers.`,
    key: "daily-ugc",
    label: "Loading daily videos",
    progress: 18,
    status: "started",
  });
  let completedDailyRows = 0;
  const [revenueReport, dailyUgcPayData] = await Promise.all([
    getRevenueAttributionReport({
      endDate: args.endDate,
      organizationSlug: args.organizationSlug,
      proceedsModel: FORMAT_COMPARISON_PROCEEDS_MODEL,
      startDate: args.startDate,
    }).then(async (report) => {
      await trace({
        detail: report.singularPending
          ? "Revenue provider report is still preparing; using the latest available status."
          : `${report.dailyRows.length} revenue day${report.dailyRows.length === 1 ? "" : "s"} loaded.`,
        key: "revenue",
        label: "Loading revenue",
        progress: 35,
        status: "completed",
      });

      return report;
    }),
    mapWithConcurrency(
      dateKeys,
      FORMAT_COMPARISON_DAILY_QUERY_CONCURRENCY,
      async (date) => {
        const data = await getOrganizationUgcPayData({
          organizationSlug: args.organizationSlug,
          includePaidViews: false,
          searchParams: {
            ...ugcPaySearchParams,
            endDate: date,
            startDate: date,
          },
          topVideoLimit: FORMAT_COMPARISON_TOP_VIDEO_LIMIT,
        });
        completedDailyRows += 1;
        await trace({
          detail: `${date}: ${data.videos.length} video row${data.videos.length === 1 ? "" : "s"} loaded (${completedDailyRows}/${dateKeys.length}).`,
          key: "daily-ugc",
          label: "Loading daily videos",
          progress: 35 + Math.round((completedDailyRows / Math.max(dateKeys.length, 1)) * 25),
          status:
            completedDailyRows === dateKeys.length ? "completed" : "info",
        });

        return data;
      },
    ),
  ]);
  await trace({
    detail: "Mapping daily proceeds onto the selected date range.",
    key: "proceeds-map",
    label: "Mapping revenue by day",
    progress: 62,
    status: "started",
  });
  const proceedsModelConfig = getRevenueProceedsModelConfig(
    revenueReport.proceedsModel,
  );
  const proceedsByDate = getFormatComparisonDailyRevenueMap({
    dailyRows: revenueReport.dailyRows,
    dates: dateKeys,
  });
  await trace({
    detail: "Daily revenue map is ready.",
    key: "proceeds-map",
    label: "Mapping revenue by day",
    progress: 66,
    status: "completed",
  });
  await trace({
    detail: "Collecting source video ids before loading saved format tags.",
    key: "source-ids",
    label: "Preparing tag lookup",
    progress: 68,
    status: "started",
  });
  const sourceVideoIds = [
    ...new Set(
      dailyUgcPayData
        .flatMap((dailyData) => dailyData.videos)
        .map((video) => video.sourceVideoId)
        .filter((value): value is string => value.length > 0),
    ),
  ];
  await trace({
    detail: `${sourceVideoIds.length} source video id${sourceVideoIds.length === 1 ? "" : "s"} collected.`,
    key: "source-ids",
    label: "Preparing tag lookup",
    progress: 70,
    status: "completed",
  });
  await trace({
    detail: "Loading saved tags for visible and repeated videos.",
    key: "format-tags",
    label: "Loading format tags",
    progress: 72,
    status: "started",
  });
  const [formatTags, savedFormatOptions] = await Promise.all([
    getVideoFormatTags({
      organizationId: membership.organizationId,
      sourceVideoIds,
    }),
    getOrganizationFormatOptions({
      organizationId: membership.organizationId,
    }),
  ]);
  await trace({
    detail: `${formatTags.tags.size} saved video tag${formatTags.tags.size === 1 ? "" : "s"} and ${savedFormatOptions.options.length} format option${savedFormatOptions.options.length === 1 ? "" : "s"} loaded.`,
    key: "format-tags",
    label: "Loading format tags",
    progress: 78,
    status: "completed",
  });
  await trace({
    detail: "Building daily video rows for the format model.",
    key: "source-days",
    label: "Building video rows",
    progress: 80,
    status: "started",
  });
  const sourceDays: FormatComparisonSourceDay[] = dateKeys.map((date, index) => {
    const dailyData = dailyUgcPayData[index];
    const videos = (dailyData?.videos ?? [])
      .map((video) => ({
        creatorName: video.creatorName,
        date,
        formatTag: formatTags.tags.get(video.sourceVideoId) ?? null,
        id: `${date}-${video.sourceVideoId || video.videoId}`,
        sourceVideoId: video.sourceVideoId,
        thumbnailUrl: video.thumbnailUrl ?? null,
        title: getUgcVideoTitle(video),
        url: video.videoUrl || null,
        views: Math.max(Math.round(video.grossViews), 0),
      }))
      .sort((left, right) => right.views - left.views);

    return {
      date,
      revenue: proceedsByDate.get(date) ?? null,
      videos,
    };
  });
  await trace({
    detail: `${sourceDays.reduce((sum, day) => sum + day.videos.length, 0)} daily video row${sourceDays.reduce((sum, day) => sum + day.videos.length, 0) === 1 ? "" : "s"} prepared.`,
    key: "source-days",
    label: "Building video rows",
    progress: 86,
    status: "completed",
  });
  await trace({
    detail: "Calculating format revenue per 1K and tagged coverage.",
    key: "calculation",
    label: "Calculating format results",
    progress: 88,
    status: "started",
  });
  const result = calculateFormatComparison(sourceDays);
  await trace({
    detail: `${result.formatRows.length} format row${result.formatRows.length === 1 ? "" : "s"} ranked.`,
    key: "calculation",
    label: "Calculating format results",
    progress: 94,
    status: "completed",
  });
  await trace({
    detail: "Preparing format options and report warnings.",
    key: "response",
    label: "Preparing dashboard",
    progress: 96,
    status: "started",
  });
  const formatOptions = [
    ...new Set(
      [
        ...savedFormatOptions.options,
        ...result.formatRows
          .map((row) => row.formatTag)
          .filter((value): value is string => Boolean(value)),
      ].map((value) => value.trim()),
    ),
  ];
  const warnings = summarizeUgcStatusWarnings([
    ...revenueReport.warnings,
    ...dailyUgcPayData.flatMap((dailyData) => dailyData.warnings),
    ...dailyUgcPayData.flatMap((dailyData) =>
      dailyData.errorMessage
        ? [`UGC Pay could not be fully loaded: ${dailyData.errorMessage}`]
        : [],
    ),
    ...(formatTags.warning ? [formatTags.warning] : []),
    ...(savedFormatOptions.warning ? [savedFormatOptions.warning] : []),
  ]);
  await trace({
    detail: "Dashboard data is ready.",
    key: "response",
    label: "Preparing dashboard",
    progress: 100,
    status: "completed",
  });

  return {
    ...result,
    currency: revenueReport.currency,
    endDate: args.endDate,
    formatOptions,
    isPending: Boolean(revenueReport.singularPending),
    proceedsDateBasisLabel: proceedsModelConfig.dateBasisLabel,
    proceedsConfigured: revenueReport.configured,
    proceedsModel: revenueReport.proceedsModel,
    proceedsModelLabel: proceedsModelConfig.shortLabel,
    selectedCampaignLabel:
      dailyUgcPayData.find((dailyData) => dailyData.selectedCampaignLabel)
        ?.selectedCampaignLabel ?? null,
    startDate: args.startDate,
    warnings,
  };
}

export async function setVideoFormatTagForOrganization(args: {
  formatTag: string | null;
  organizationSlug: string;
  sourceVideoId: string;
}) {
  const membership = await requireOrganizationMembership(args.organizationSlug);

  if (!canReadOrganizationCampaignData(membership.role)) {
    throw new Error("Format tag access denied.");
  }

  const sourceVideoId = args.sourceVideoId.trim();

  if (!sourceVideoId) {
    throw new Error("Video source id is required.");
  }

  const formatTag = normalizeFormatTag(args.formatTag);

  await prisma.videoContentClassification.upsert({
    where: {
      organizationId_platform_sourceVideoId: {
        organizationId: membership.organizationId,
        platform: Platform.TIKTOK,
        sourceVideoId,
      },
    },
    update: {
      formatTag,
    },
    create: {
      formatTag,
      organizationId: membership.organizationId,
      platform: Platform.TIKTOK,
      sourceVideoId,
    },
  });

  revalidatePath(`/org/${args.organizationSlug}/format-comparison`);

  return {
    formatTag,
    sourceVideoId,
  };
}
