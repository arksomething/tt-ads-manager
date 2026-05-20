import { type DashboardSearchParams } from "@/server/dashboard/filters";
import { summarizeUgcStatusWarnings } from "@/lib/report-warnings";
import {
  getDateKeys,
  getRevenueUgcPaySearchParams,
} from "@/server/revenue/revenue-profitability-calculations";
import { getRevenueAttributionReport } from "@/server/revenue/revenue";
import {
  getOrganizationUgcPayData,
  type UgcPayVideoRow,
} from "@/server/ugc-pay/queries";
import {
  getViewsBaseFacelessReport,
  type ViewsBaseFacelessReport,
} from "@/server/viewsbase/report";
import {
  getFacelessCostBreakdown,
  getFacelessDailyCostBreakdown,
  getUgcManagementCostForDates,
  getUgcManagementDailyCost,
} from "@/server/revenue/creator-costs";

import {
  calculateUgcStatusMetrics,
  getUgcStatusDailyProceedsMap,
  getUgcStatusSummaryProceeds,
  getUgcStatusSpendByDate,
  getUgcStatusTopVideoSearchParams,
  selectTopUgcStatusVideos,
  type UgcStatusMetrics,
  type UgcStatusTopVideoRow,
} from "./ugc-status-calculations";

const UGC_STATUS_DAILY_QUERY_CONCURRENCY = 3;

type FacelessSpendReport = {
  configured: boolean;
  errorMessage: string | null;
  report: ViewsBaseFacelessReport | null;
};

export type UgcStatusDailyRow = UgcStatusMetrics & {
  date: string;
  facelessBaseSpend: number;
  facelessManagementSpend: number;
  facelessSpend: number;
  facelessViews: number;
  proceeds: number;
  ugcCpmSpend: number;
  ugcFixedSpend: number;
  ugcManagementSpend: number;
  ugcPaySpend: number;
  ugcSpend: number;
  ugcViews: number;
};

export type UgcStatusData = {
  currency: string | null;
  endDate: string;
  facelessConfigured: boolean;
  facelessErrorMessage: string | null;
  facelessSpend: number;
  facelessViews: number;
  proceedsConfigured: boolean;
  proceedsWarnings: string[];
  startDate: string;
  summary: UgcStatusMetrics & {
    facelessBaseSpend: number;
    facelessManagementSpend: number;
    facelessSpend: number;
    facelessViews: number;
    ugcCpmSpend: number;
    ugcFixedSpend: number;
    ugcManagementSpend: number;
    ugcPaySpend: number;
    ugcSpend: number;
    ugcViews: number;
  };
  ugcCampaignLabel: string | null;
  ugcSpend: number;
  ugcViews: number;
  rows: UgcStatusDailyRow[];
};

export type UgcStatusTopVideosData = {
  date: string;
  facelessUnavailableReason: string;
  limit: number;
  lookbackDays: number;
  ugc: UgcStatusTopVideoRow[];
  viewWindowDays: number;
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

export function getTopUgcStatusVideos(
  videos: UgcPayVideoRow[],
  limit = 5,
): UgcStatusTopVideoRow[] {
  return selectTopUgcStatusVideos(
    videos.map((video) => ({
      creatorName: video.creatorName,
      id: video.videoId,
      spend: video.videoPay,
      title: getUgcVideoTitle(video),
      url: video.videoUrl,
      views: video.payableViews,
    })),
    limit,
  );
}

export async function getUgcStatusTopVideosData(args: {
  date: string;
  limit?: number;
  organizationSlug: string;
  searchParams: DashboardSearchParams;
}): Promise<UgcStatusTopVideosData> {
  const limit = Math.max(Math.min(args.limit ?? 5, 25), 1);
  const lookbackDays = 30;
  const viewWindowDays = 7;
  const ugcPayData = await getOrganizationUgcPayData({
    organizationSlug: args.organizationSlug,
    searchParams: getUgcStatusTopVideoSearchParams({
      date: args.date,
      lookbackDays,
      searchParams: args.searchParams,
      viewWindowDays,
    }),
  });

  return {
    date: args.date,
    facelessUnavailableReason:
      "Faceless 30-day lookback and 7-day gained-view video deltas are not available from UGC Pay.",
    limit,
    lookbackDays,
    ugc: getTopUgcStatusVideos(ugcPayData.videos, limit),
    viewWindowDays,
    warnings: summarizeUgcStatusWarnings([
      ...ugcPayData.warnings,
      ...(ugcPayData.errorMessage ? [ugcPayData.errorMessage] : []),
    ]),
  };
}

export async function getUgcStatusData(args: {
  organizationSlug: string;
  searchParams: DashboardSearchParams;
  startDate: string;
  endDate: string;
}): Promise<UgcStatusData> {
  const ugcPaySearchParams = getRevenueUgcPaySearchParams(args);
  const dateKeys = getDateKeys(args.startDate, args.endDate);
  const [revenueReport, ugcPayData, ugcDailyRows, facelessSpendReport] =
    await Promise.all([
      getRevenueAttributionReport({
        endDate: args.endDate,
        organizationSlug: args.organizationSlug,
        startDate: args.startDate,
      }),
      getOrganizationUgcPayData({
        organizationSlug: args.organizationSlug,
        searchParams: ugcPaySearchParams,
      }),
      mapWithConcurrency(dateKeys, UGC_STATUS_DAILY_QUERY_CONCURRENCY, async (date) => {
        const dailyData = await getOrganizationUgcPayData({
          organizationSlug: args.organizationSlug,
          searchParams: {
            ...ugcPaySearchParams,
            endDate: date,
            startDate: date,
          },
        });

        return {
          date,
          cpmSpend: dailyData.summary.cpmPay,
          fixedSpend:
            dailyData.summary.fixedPay + dailyData.summary.videoFixedPay,
          spend: dailyData.summary.totalPay,
          views: dailyData.summary.payableViews,
        };
      }),
      getViewsBaseFacelessReport({
        campaignSlug: "all",
        endDate: args.endDate,
        organizationSlug: args.organizationSlug,
        remoteOrgSlug: "gotall",
        startDate: args.startDate,
      })
        .then((report) => ({
          configured: true,
          errorMessage: null,
          report,
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
  const facelessCostBreakdown = getFacelessCostBreakdown(
    facelessSpendReport.report,
  );
  const facelessSpend = facelessCostBreakdown.totalSpend;
  const facelessViews = facelessSpendReport.report?.totals.rangeViews ?? 0;
  const ugcPaySpend = ugcPayData.summary.totalPay;
  const ugcManagementSpend = getUgcManagementCostForDates(dateKeys);
  const ugcSpend = ugcPaySpend + ugcManagementSpend;
  const ugcViews = ugcPayData.summary.payableViews;
  const proceedsWarnings = summarizeUgcStatusWarnings([
    ...revenueReport.warnings,
    ...ugcPayData.warnings,
    ...(ugcPayData.errorMessage
      ? [`UGC Pay could not be fully loaded: ${ugcPayData.errorMessage}`]
      : []),
  ]);
  const facelessSpendByDate = new Map(
    (facelessSpendReport.report?.dailyRows ?? []).map(
      (row) =>
        [
          row.date,
          {
            ...getFacelessDailyCostBreakdown(row),
            views: row.views,
          },
        ] as const,
    ),
  );
  const ugcByDate = new Map(ugcDailyRows.map((row) => [row.date, row] as const));
  const proceedsByDate = getUgcStatusDailyProceedsMap({
    dailyRows: revenueReport.dailyRows,
    dates: dateKeys,
  });
  const ugcSpendByDate = getUgcStatusSpendByDate({
    dailyRows: ugcDailyRows,
    dates: dateKeys,
    totalCpmSpend: ugcPayData.summary.cpmPay,
    totalFixedSpend:
      ugcPayData.summary.fixedPay + ugcPayData.summary.videoFixedPay,
  });
  const rows = dateKeys.map((date) => {
    const ugc = ugcByDate.get(date) ?? {
      cpmSpend: 0,
      fixedSpend: 0,
      spend: 0,
      views: 0,
    };
    const faceless = facelessSpendByDate.get(date) ?? {
      baseSpend: 0,
      managementSpend: 0,
      totalSpend: 0,
      views: 0,
    };
    const reconciledUgcSpend = ugcSpendByDate.get(date) ?? {
      cpmSpend: ugc.cpmSpend,
      fixedSpend: ugc.fixedSpend,
      spend: ugc.spend,
    };
    const proceeds = proceedsByDate.get(date) ?? 0;
    const ugcManagementDailySpend = getUgcManagementDailyCost(date);
    const ugcDailySpend = reconciledUgcSpend.spend + ugcManagementDailySpend;
    const spend = ugcDailySpend + faceless.totalSpend;
    const views = ugc.views + faceless.views;

    return {
      date,
      facelessBaseSpend: faceless.baseSpend,
      facelessManagementSpend: faceless.managementSpend,
      facelessSpend: faceless.totalSpend,
      facelessViews: faceless.views,
      ugcCpmSpend: reconciledUgcSpend.cpmSpend,
      ugcFixedSpend: reconciledUgcSpend.fixedSpend,
      ugcManagementSpend: ugcManagementDailySpend,
      ugcPaySpend: reconciledUgcSpend.spend,
      ugcSpend: ugcDailySpend,
      ugcViews: ugc.views,
      ...calculateUgcStatusMetrics({
        facelessViews: faceless.views,
        proceeds,
        spend,
        ugcViews: ugc.views,
        views,
      }),
    };
  });
  const summary = {
    facelessBaseSpend: facelessCostBreakdown.baseSpend,
    facelessManagementSpend: facelessCostBreakdown.managementSpend,
    facelessSpend,
    facelessViews,
    ugcCpmSpend: ugcPayData.summary.cpmPay,
    ugcFixedSpend:
      ugcPayData.summary.fixedPay + ugcPayData.summary.videoFixedPay,
    ugcManagementSpend,
    ugcPaySpend,
    ugcSpend,
    ugcViews,
    ...calculateUgcStatusMetrics({
      facelessViews,
      proceeds: getUgcStatusSummaryProceeds({
        organicProceeds: revenueReport.totals.organic,
      }),
      spend: ugcSpend + facelessSpend,
      ugcViews,
      views: ugcViews + facelessViews,
    }),
  };

  return {
    currency: revenueReport.currency,
    endDate: args.endDate,
    facelessConfigured: facelessSpendReport.configured,
    facelessErrorMessage: facelessSpendReport.errorMessage,
    facelessSpend,
    facelessViews,
    proceedsConfigured: revenueReport.configured,
    proceedsWarnings,
    rows,
    startDate: args.startDate,
    summary,
    ugcCampaignLabel: ugcPayData.selectedCampaignLabel,
    ugcSpend,
    ugcViews,
  };
}
