import { type DashboardSearchParams } from "@/server/dashboard/filters";
import {
  getDateKeys,
  getRevenueUgcPaySearchParams,
} from "@/server/adapty/revenue-profitability-calculations";
import { getRevenueAttributionReport } from "@/server/adapty/revenue";
import {
  getOrganizationUgcPayData,
  type UgcPayVideoRow,
} from "@/server/ugc-pay/queries";
import { getFacelessCostAmount } from "@/server/viewsbase/faceless-calculations";
import {
  getViewsBaseFacelessReport,
  type ViewsBaseFacelessReport,
} from "@/server/viewsbase/report";

import {
  calculateUgcStatusMetrics,
  getUgcStatusProceedsByDate,
  getUgcStatusSpendByDate,
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
  facelessSpend: number;
  facelessViews: number;
  proceeds: number;
  topVideos: {
    faceless: UgcStatusTopVideoRow[];
    ugc: UgcStatusTopVideoRow[];
  };
  ugcCpmSpend: number;
  ugcFixedSpend: number;
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
    facelessSpend: number;
    facelessViews: number;
    ugcCpmSpend: number;
    ugcFixedSpend: number;
    ugcSpend: number;
    ugcViews: number;
  };
  ugcCampaignLabel: string | null;
  ugcSpend: number;
  ugcViews: number;
  rows: UgcStatusDailyRow[];
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

function getUgcVideoTitle(video: UgcPayVideoRow) {
  const title = video.titleOrCaption?.trim();

  if (title) {
    return title;
  }

  return video.sourceVideoId || video.videoId || "Untitled video";
}

export function getTopUgcStatusVideos(
  videos: UgcPayVideoRow[],
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
  );
}

function getTopFacelessVideos(
  report: ViewsBaseFacelessReport | null,
  date: string,
): UgcStatusTopVideoRow[] {
  return (report?.topVideosByDate[date] ?? []).map((video) => ({
    creatorName: video.creatorName ?? video.creatorHandle,
    id: video.id,
    spend: video.spend,
    title: video.title,
    url: video.url,
    views: video.views,
  }));
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
          cpmSpend: dailyData.summary.videoPay,
          fixedSpend: dailyData.summary.fixedPay,
          spend: dailyData.summary.totalPay,
          topVideos: getTopUgcStatusVideos(dailyData.videos),
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
  const facelessSpend = getFacelessReportCost(facelessSpendReport.report);
  const facelessViews = facelessSpendReport.report?.totals.rangeViews ?? 0;
  const ugcSpend = ugcPayData.summary.totalPay;
  const ugcViews = ugcPayData.summary.payableViews;
  const facelessSpendByDate = new Map(
    (facelessSpendReport.report?.dailyRows ?? []).map(
      (row) =>
        [
          row.date,
          {
            spend: getFacelessDailyCost(row),
            views: row.views,
          },
        ] as const,
    ),
  );
  const ugcByDate = new Map(ugcDailyRows.map((row) => [row.date, row] as const));
  const proceedsByDate = getUgcStatusProceedsByDate({
    dailyRows: revenueReport.dailyRows,
    dates: dateKeys,
    total: revenueReport.totals.organic,
  });
  const ugcSpendByDate = getUgcStatusSpendByDate({
    dailyRows: ugcDailyRows,
    dates: dateKeys,
    totalCpmSpend: ugcPayData.summary.videoPay,
    totalFixedSpend: ugcPayData.summary.fixedPay,
  });
  const rows = dateKeys.map((date) => {
    const ugc = ugcByDate.get(date) ?? {
      cpmSpend: 0,
      fixedSpend: 0,
      spend: 0,
      topVideos: [],
      views: 0,
    };
    const faceless = facelessSpendByDate.get(date) ?? {
      spend: 0,
      views: 0,
    };
    const reconciledUgcSpend = ugcSpendByDate.get(date) ?? {
      cpmSpend: ugc.cpmSpend,
      fixedSpend: ugc.fixedSpend,
      spend: ugc.spend,
    };
    const proceeds = proceedsByDate.get(date) ?? 0;
    const spend = reconciledUgcSpend.spend + faceless.spend;
    const views = ugc.views + faceless.views;

    return {
      date,
      facelessSpend: faceless.spend,
      facelessViews: faceless.views,
      topVideos: {
        faceless: getTopFacelessVideos(facelessSpendReport.report, date),
        ugc: ugc.topVideos ?? [],
      },
      ugcCpmSpend: reconciledUgcSpend.cpmSpend,
      ugcFixedSpend: reconciledUgcSpend.fixedSpend,
      ugcSpend: reconciledUgcSpend.spend,
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
    facelessSpend,
    facelessViews,
    ugcCpmSpend: ugcPayData.summary.videoPay,
    ugcFixedSpend: ugcPayData.summary.fixedPay,
    ugcSpend,
    ugcViews,
    ...calculateUgcStatusMetrics({
      facelessViews,
      proceeds: revenueReport.totals.organic,
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
    proceedsWarnings: revenueReport.warnings,
    rows,
    startDate: args.startDate,
    summary,
    ugcCampaignLabel: ugcPayData.selectedCampaignLabel,
    ugcSpend,
    ugcViews,
  };
}
