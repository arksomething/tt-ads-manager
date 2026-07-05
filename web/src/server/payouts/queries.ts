import {
  CampaignRole,
  CreatorStatus,
  CreatorDealPaidTrafficMetric,
  CreatorDealPerVideoCapScope,
  PayoutStatus,
  Platform,
} from "@/lib/prisma-shim";

import { prisma } from "@/lib/db";
import { type DashboardSearchParams } from "@/server/dashboard/filters";
import { requireOrganizationMembership } from "@/server/auth/organizations";
import { canManageCampaign, canManageOrganization } from "@/server/auth/roles";
import {
  getAccessibleCampaignOptionsForMembership,
  getAccessibleCampaignWhere,
} from "@/server/campaigns/queries";
import { getTikTokSingularOverlay } from "@/server/singular/reporting";
import { requestTikTokBusinessApi } from "@/server/tiktok-business/client";
import {
  getPaidViewTimelineForSourceVideosForCreatorForOrganization,
  type TikTokSourceVideoPaidViewsTimelineResult,
  type TikTokVideoPaidStatus,
} from "@/server/tiktok-business/reporting";
import {
  VIEWSBASE_CPM_AMOUNT,
  VIEWSBASE_PAYOUT_CAP_PER_VIDEO,
  isViewsBaseRawPayload,
} from "@/server/viewsbase/shared";

const AD_REPORT_PAGE_SIZE = 1_000;
const MAX_AD_REPORT_PAGES = 20;
const DEFAULT_DEAL_CURRENCY = "USD";
const DEFAULT_DEAL_CPM_AMOUNT = 1;
const DEFAULT_DEAL_VIEW_WINDOW_DAYS = 7;
const DEFAULT_DEAL_PAYOUT_CAP_PER_VIDEO = 100;
const VIDEO_METRICS_SNAPSHOT_BATCH_SIZE = 150;
const MAX_EXACT_PAID_TIMELINE_CREATORS = 20;
const MAX_EXACT_PAID_TIMELINE_SOURCE_VIDEOS = 250;
const DAILY_AD_METRIC_CANDIDATES = [
  {
    spendMetric: "spend",
    spendKeys: ["spend"],
  },
  {
    spendMetric: "cost",
    spendKeys: ["cost", "spend"],
  },
] as const;

type CampaignCreatorWorkspaceRow = {
  id: string;
  campaignId: string;
  creatorId: string;
  campaign: {
    id: string;
    name: string;
    ownerUserId: string | null;
    memberships: Array<{
      role: CampaignRole;
    }>;
  };
  creator: {
    id: string;
    displayName: string;
    platformAccounts: Array<{
      handle: string;
      platform: Platform;
    }>;
  };
  deals: CampaignCreatorWorkspaceDealRow[];
};

type CampaignCreatorWorkspaceDealRow = {
  id: string;
  currency: string;
  effectiveStartDate: Date;
  effectiveEndDate: Date | null;
  fixedFee: number | null;
  fixedFeeRecognitionDate: Date | null;
  fixedFeePerVideo: number | null;
  cpmAmount: number | null;
  paidTrafficMetric: CreatorDealPaidTrafficMetric;
  deductPaidTraffic: boolean;
  viewCapPerVideo: number | null;
  viewWindowDays: number | null;
  payoutCapPerVideo: number | null;
  perVideoCapScope: CreatorDealPerVideoCapScope;
  payoutCapTotal: number | null;
  notes: string | null;
};

type ResolvedCampaignCreatorDeal = {
  id: string | null;
  currency: string;
  effectiveStartDate: Date;
  effectiveEndDate: Date | null;
  fixedFee: number | null;
  fixedFeeRecognitionDate: Date | null;
  fixedFeePerVideo: number | null;
  cpmAmount: number;
  paidTrafficMetric: CreatorDealPaidTrafficMetric;
  deductPaidTraffic: boolean;
  viewCapPerVideo: number | null;
  viewWindowDays: number;
  payoutCapPerVideo: number;
  perVideoCapScope: CreatorDealPerVideoCapScope;
  payoutCapTotal: number | null;
  notes: string | null;
  isDefault: boolean;
};

type CampaignCreatorVideoRow = {
  id: string;
  campaignId: string | null;
  creatorId: string;
  sourceVideoId: string | null;
  platform: Platform;
  videoUrl: string;
  titleOrCaption: string | null;
  publishedAt: Date | null;
  createdAt: Date;
  views: number | null;
  lastSyncedAt: Date | null;
  rawPayload: unknown;
};

type VideoSnapshotRow = {
  videoId: string;
  capturedAt: Date;
  views: number | null;
};

type DailyAdMetricRow = {
  date: string;
  spend: number;
  impressions: number;
};

type DailyCostRow = {
  date: string;
  ugcFixedCost: number;
  ugcVariableCost: number;
  ugcTotalCost: number;
  adSpend: number;
  totalSpend: number;
  grossViews: number;
  paidViewsDeducted: number;
  payableViews: number;
  adImpressions: number;
  actualPaidPayouts: number;
};

type CreatorCostRow = {
  campaignCreatorId: string;
  campaignId: string;
  campaignName: string;
  creatorId: string;
  creatorName: string;
  tiktokHandle: string | null;
  canEditDeal: boolean;
  hasCustomDeal: boolean;
  currency: string;
  deal: ResolvedCampaignCreatorDeal;
  grossViews: number;
  paidViewsDeducted: number;
  payableViews: number;
  fixedCost: number;
  variableCost: number;
  totalCost: number;
  tiktokVideoCount: number;
  unsupportedPaidVideoCount: number;
  exactPaidVideoCount: number;
  creatorTotalCapApplied: boolean;
  videoCapReached: boolean;
  warnings: string[];
};

type VideoCostRow = {
  campaignCreatorId: string;
  campaignId: string;
  campaignName: string;
  creatorId: string;
  creatorName: string;
  currency: string;
  videoId: string;
  sourceVideoId: string | null;
  platform: Platform;
  videoUrl: string;
  titleOrCaption: string | null;
  publishedAt: Date | null;
  grossViews: number;
  paidViewsDeducted: number;
  payableViews: number;
  variableCost: number;
  sourceLabel: string;
  effectiveCpm: number;
  viewCapReached: boolean;
  creatorTotalCapApplied: boolean;
  paidStatus: TikTokVideoPaidStatus | "not_applicable";
  matchedAdIds: string[];
};

export type OrganizationPayoutDashboardData = {
  campaignOptions: Array<{
    id: string;
    label: string;
  }>;
  selectedCampaignId: string | null;
  startDate: string;
  endDate: string;
  warnings: string[];
  summary: {
    totalSpend: number;
    ugcSpend: number;
    ugcFixedCost: number;
    ugcVariableCost: number;
    adSpend: number;
    grossViews: number;
    paidViewsDeducted: number;
    payableViews: number;
    adImpressions: number;
    singularRevenue: number;
    singularProfit: number;
    singularInstalls: number;
    singularConversions: number;
    actualPaidPayouts: number;
    creatorRowsWithDeals: number;
  };
  dailyRows: DailyCostRow[];
  creators: CreatorCostRow[];
  videos: VideoCostRow[];
};

type TikTokIntegratedReportRow = Record<string, unknown> & {
  dimensions?: Record<string, unknown>;
  metrics?: Record<string, unknown>;
};

type TikTokIntegratedReportData = {
  list?: TikTokIntegratedReportRow[];
  page_info?: Record<string, unknown>;
};

function getSearchParamValue(
  searchParams: DashboardSearchParams | undefined,
  key: string,
) {
  const value = searchParams?.[key];
  return Array.isArray(value) ? value[0] : value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getFirstString(records: Array<Record<string, unknown> | null>, keys: string[]) {
  for (const record of records) {
    if (!record) {
      continue;
    }

    for (const key of keys) {
      const value = record[key];

      if (typeof value === "string" && value.trim().length > 0) {
        return value;
      }

      if (typeof value === "number" && Number.isFinite(value)) {
        return String(value);
      }
    }
  }

  return null;
}

function getFirstNumber(records: Array<Record<string, unknown> | null>, keys: string[]) {
  for (const record of records) {
    if (!record) {
      continue;
    }

    for (const key of keys) {
      const value = record[key];
      const parsed =
        typeof value === "number"
          ? value
          : typeof value === "string"
            ? Number(value)
            : null;

      if (typeof parsed === "number" && Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }

  return 0;
}

function startOfUtcDay(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function endOfUtcDay(value: Date) {
  return new Date(
    Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate(), 23, 59, 59, 999),
  );
}

function addUtcDays(value: Date, days: number) {
  const nextValue = new Date(value);
  nextValue.setUTCDate(nextValue.getUTCDate() + days);
  return nextValue;
}

function toDateOnlyString(value: Date) {
  return value.toISOString().slice(0, 10);
}

function parseDateOnly(value: string) {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function normalizeReportDateKey(value: string) {
  const trimmed = value.trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }

  const parsed = new Date(trimmed);

  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return toDateOnlyString(startOfUtcDay(parsed));
}

function getDefaultStartDate(endDate = new Date()) {
  const date = new Date(endDate);
  date.setUTCDate(date.getUTCDate() - 6);
  return toDateOnlyString(date);
}

function getDefaultEndDate(endDate = new Date()) {
  return toDateOnlyString(endDate);
}

function getSelectedDateRange(
  searchParams: DashboardSearchParams | undefined,
  defaultEndBoundary = new Date(),
) {
  const defaultEndDate = getDefaultEndDate(defaultEndBoundary);
  const defaultStartDate = getDefaultStartDate(defaultEndBoundary);
  const startDate = getSearchParamValue(searchParams, "startDate") ?? defaultStartDate;
  const endDate = getSearchParamValue(searchParams, "endDate") ?? defaultEndDate;
  const parsedStartDate = parseDateOnly(startDate);
  const parsedEndDate = parseDateOnly(endDate);

  if (!parsedStartDate || !parsedEndDate || parsedEndDate < parsedStartDate) {
    return {
      startDate: defaultStartDate,
      endDate: defaultEndDate,
      start: parseDateOnly(defaultStartDate)!,
      end: parseDateOnly(defaultEndDate)!,
    };
  }

  return {
    startDate,
    endDate,
    start: parsedStartDate,
    end: parsedEndDate,
  };
}

function buildDateKeys(startDate: Date, endDate: Date) {
  const dates: string[] = [];
  let cursor = startOfUtcDay(startDate);

  while (cursor <= endDate) {
    dates.push(toDateOnlyString(cursor));
    cursor = addUtcDays(cursor, 1);
  }

  return dates;
}

function chunkArray<T>(values: T[], size: number) {
  if (size <= 0) {
    return [values];
  }

  const chunks: T[][] = [];

  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }

  return chunks;
}

function getTikTokHandle(row: CampaignCreatorWorkspaceRow) {
  return (
    row.creator.platformAccounts.find((account) => account.platform === Platform.TIKTOK)?.handle ??
    null
  );
}

function getMetricMap<T>(dateKeys: string[], initialValue: T) {
  return new Map(dateKeys.map((dateKey) => [dateKey, initialValue]));
}

function addNumberMapValue(map: Map<string, number>, key: string, value: number) {
  map.set(key, (map.get(key) ?? 0) + value);
}

function normalizeMoney(value: number) {
  return Number(value.toFixed(2));
}

function resolveCampaignCreatorDeal(
  deal: CampaignCreatorWorkspaceDealRow | null,
  fallbackStartDate: Date,
): ResolvedCampaignCreatorDeal {
  return {
    id: deal?.id ?? null,
    currency: deal?.currency ?? DEFAULT_DEAL_CURRENCY,
    effectiveStartDate: deal?.effectiveStartDate ?? fallbackStartDate,
    effectiveEndDate: deal?.effectiveEndDate ?? null,
    fixedFee: deal?.fixedFee ?? null,
    fixedFeeRecognitionDate: deal?.fixedFeeRecognitionDate ?? null,
    fixedFeePerVideo: deal?.fixedFeePerVideo ?? null,
    cpmAmount: deal?.cpmAmount ?? DEFAULT_DEAL_CPM_AMOUNT,
    paidTrafficMetric: CreatorDealPaidTrafficMetric.IMPRESSIONS,
    deductPaidTraffic: deal?.deductPaidTraffic ?? true,
    viewCapPerVideo: deal?.viewCapPerVideo ?? null,
    viewWindowDays: Math.max(deal?.viewWindowDays ?? DEFAULT_DEAL_VIEW_WINDOW_DAYS, 1),
    payoutCapPerVideo:
      deal?.payoutCapPerVideo ?? DEFAULT_DEAL_PAYOUT_CAP_PER_VIDEO,
    perVideoCapScope: deal?.perVideoCapScope ?? CreatorDealPerVideoCapScope.CPM,
    payoutCapTotal: deal?.payoutCapTotal ?? null,
    notes: deal?.notes ?? null,
    isDefault: deal == null,
  };
}

function getCampaignCreatorDealActiveInRange(
  deals: CampaignCreatorWorkspaceDealRow[],
  start: Date,
  end: Date,
) {
  return (
    deals.find((deal) => {
      const dealStart = startOfUtcDay(deal.effectiveStartDate);
      const dealEnd = deal.effectiveEndDate
        ? startOfUtcDay(deal.effectiveEndDate)
        : null;

      return dealStart <= end && (!dealEnd || dealEnd >= start);
    }) ?? null
  );
}

function getPerVideoPayableViewCap(deal: ResolvedCampaignCreatorDeal) {
  if (deal.perVideoCapScope === CreatorDealPerVideoCapScope.NONE) {
    return null;
  }

  if (deal.cpmAmount <= 0) {
    return null;
  }

  const cpmCap =
    deal.perVideoCapScope === CreatorDealPerVideoCapScope.TOTAL
      ? Math.max(deal.payoutCapPerVideo - (deal.fixedFeePerVideo ?? 0), 0)
      : deal.payoutCapPerVideo;

  return (cpmCap / deal.cpmAmount) * 1_000;
}

function getPaidMetricForDeal(): "impressions" {
  return "impressions";
}

function getVideoGroupingKey(video: CampaignCreatorVideoRow) {
  return `${video.campaignId ?? "none"}::${video.creatorId}`;
}

function isViewsBaseVideo(video: Pick<CampaignCreatorVideoRow, "rawPayload">) {
  return isViewsBaseRawPayload(video.rawPayload);
}

function getEffectiveDealForVideo(
  video: Pick<CampaignCreatorVideoRow, "rawPayload">,
  deal: ResolvedCampaignCreatorDeal,
): ResolvedCampaignCreatorDeal {
  if (!isViewsBaseVideo(video)) {
    return deal;
  }

  return {
    ...deal,
    fixedFee: null,
    fixedFeeRecognitionDate: null,
    fixedFeePerVideo: null,
    cpmAmount: VIEWSBASE_CPM_AMOUNT,
    deductPaidTraffic: false,
    payoutCapPerVideo: VIEWSBASE_PAYOUT_CAP_PER_VIDEO,
    perVideoCapScope: CreatorDealPerVideoCapScope.CPM,
  };
}

function getVideoSourceLabel(video: Pick<CampaignCreatorVideoRow, "rawPayload">) {
  return isViewsBaseVideo(video) ? "ViewsBase" : "viral.app";
}

function getDailyAdReportRows(payload: TikTokIntegratedReportData) {
  if (!Array.isArray(payload.list)) {
    return [];
  }

  return payload.list.filter(isRecord);
}

function getDailyAdReportTotalPages(payload: TikTokIntegratedReportData, rowCount: number) {
  const pageInfo = isRecord(payload.page_info) ? payload.page_info : null;
  const totalPages = getFirstNumber([pageInfo], ["total_page", "total_pages"]);

  if (totalPages > 0) {
    return Math.max(1, Math.trunc(totalPages));
  }

  return rowCount < AD_REPORT_PAGE_SIZE ? 1 : MAX_AD_REPORT_PAGES;
}

async function getDailyAdMetricsForOrganization(args: {
  organizationId: string;
  startDate: string;
  endDate: string;
}) {
  const account = await prisma.organizationTikTokAccount.findFirst({
    where: {
      organizationId: args.organizationId,
      status: "ACTIVE",
    },
    select: {
      advertiserId: true,
      accessToken: true,
    },
    orderBy: {
      updatedAt: "desc",
    },
  });

  if (!account?.accessToken) {
    return {
      rows: [] as DailyAdMetricRow[],
      warnings: [
        "No active TikTok advertiser account is connected, so ad spend could not be loaded.",
      ],
    };
  }

  let lastError: unknown = null;

  for (const candidate of DAILY_AD_METRIC_CANDIDATES) {
    try {
      const rows: DailyAdMetricRow[] = [];
      let totalPages = 1;

      for (
        let page = 1;
        page <= totalPages && page <= MAX_AD_REPORT_PAGES;
        page += 1
      ) {
        const payload = await requestTikTokBusinessApi<TikTokIntegratedReportData>({
          accessToken: account.accessToken,
          method: "GET",
          path: "/open_api/v1.3/report/integrated/get/",
          query: {
            report_type: "BASIC",
            advertiser_id: account.advertiserId,
            data_level: "AUCTION_AD",
            dimensions: ["stat_time_day", "ad_id"],
            metrics: [
              candidate.spendMetric,
              "impressions",
            ],
            start_date: args.startDate,
            end_date: args.endDate,
            page,
            page_size: AD_REPORT_PAGE_SIZE,
          },
        });

        const pageRows = getDailyAdReportRows(payload);
        totalPages = getDailyAdReportTotalPages(payload, pageRows.length);

        for (const row of pageRows) {
          const dimensions = isRecord(row.dimensions) ? row.dimensions : null;
          const metrics = isRecord(row.metrics) ? row.metrics : null;
          const rawDate = getFirstString([dimensions, row], ["stat_time_day", "statTimeDay"]);
          const date = rawDate ? normalizeReportDateKey(rawDate) : null;

          if (!date) {
            continue;
          }

          rows.push({
            date,
            spend: getFirstNumber([metrics, row], [...candidate.spendKeys]),
            impressions: getFirstNumber([metrics, row], ["impressions"]),
          });
        }

        if (pageRows.length < AD_REPORT_PAGE_SIZE) {
          break;
        }
      }

      const byDate = new Map<string, DailyAdMetricRow>();

      for (const row of rows) {
        const existing = byDate.get(row.date);

        if (existing) {
          existing.spend += row.spend;
          existing.impressions += row.impressions;
          continue;
        }

        byDate.set(row.date, { ...row });
      }

      return {
        rows: [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date)),
        warnings:
          candidate.spendMetric === "spend"
            ? ([] as string[])
            : [
                "TikTok rejected the preferred spend metric name, so the dashboard fell back to an alternate spend field.",
              ],
      };
    } catch (error) {
      lastError = error;
    }
  }

  return {
    rows: [] as DailyAdMetricRow[],
    warnings: [
      lastError instanceof Error
        ? lastError.message
        : "TikTok ad spend could not be loaded for this date range.",
    ],
  };
}

function buildGrossViewDeltaMap(args: {
  video: CampaignCreatorVideoRow;
  snapshots: VideoSnapshotRow[];
  startDate: Date;
  endDate: Date;
}) {
  const sortedSnapshots = args.snapshots
    .filter((snapshot) => typeof snapshot.views === "number")
    .map((snapshot) => ({
      capturedAt: snapshot.capturedAt,
      views: snapshot.views as number,
    }))
    .sort((left, right) => left.capturedAt.getTime() - right.capturedAt.getTime());

  const syntheticSnapshotTime = args.video.lastSyncedAt ?? null;

  if (
    typeof args.video.views === "number" &&
    syntheticSnapshotTime &&
    syntheticSnapshotTime <= endOfUtcDay(args.endDate)
  ) {
    const duplicatePoint = sortedSnapshots.some(
      (snapshot) =>
        snapshot.capturedAt.getTime() === syntheticSnapshotTime.getTime() &&
        snapshot.views === args.video.views,
    );

    if (!duplicatePoint) {
      sortedSnapshots.push({
        capturedAt: syntheticSnapshotTime,
        views: args.video.views,
      });
      sortedSnapshots.sort((left, right) => left.capturedAt.getTime() - right.capturedAt.getTime());
    }
  }

  let snapshotIndex = 0;
  let baselineViews = 0;

  while (
    snapshotIndex < sortedSnapshots.length &&
    sortedSnapshots[snapshotIndex]!.capturedAt < args.startDate
  ) {
    baselineViews = Math.max(baselineViews, sortedSnapshots[snapshotIndex]!.views);
    snapshotIndex += 1;
  }

  let carriedViews = baselineViews;
  const grossViewsByDate = new Map<string, number>();

  for (const dateKey of buildDateKeys(args.startDate, args.endDate)) {
    const dayEnd = endOfUtcDay(parseDateOnly(dateKey)!);
    let nextViews = carriedViews;

    while (
      snapshotIndex < sortedSnapshots.length &&
      sortedSnapshots[snapshotIndex]!.capturedAt <= dayEnd
    ) {
      nextViews = Math.max(nextViews, sortedSnapshots[snapshotIndex]!.views);
      snapshotIndex += 1;
    }

    const delta = Math.max(nextViews - carriedViews, 0);
    grossViewsByDate.set(dateKey, delta);
    carriedViews = nextViews;
  }

  return grossViewsByDate;
}

function getPaidTimelineRowMap(result: TikTokSourceVideoPaidViewsTimelineResult) {
  const timelineBySourceVideoId = new Map<string, Map<string, number>>();

  for (const row of result.timelineRows) {
    const existingMap = timelineBySourceVideoId.get(row.sourceVideoId);

    if (existingMap) {
      existingMap.set(row.statDate, (existingMap.get(row.statDate) ?? 0) + row.paidViews);
      continue;
    }

    timelineBySourceVideoId.set(
      row.sourceVideoId,
      new Map([[row.statDate, row.paidViews]]),
    );
  }

  return timelineBySourceVideoId;
}

function getPaidStatusMap(result: TikTokSourceVideoPaidViewsTimelineResult) {
  return new Map(result.rows.map((row) => [row.sourceVideoId, row]));
}

async function getVideoSnapshotsForRange(args: {
  videoIds: string[];
  endDate: Date;
}) {
  const rows: VideoSnapshotRow[] = [];

  for (const videoIdBatch of chunkArray(
    args.videoIds,
    VIDEO_METRICS_SNAPSHOT_BATCH_SIZE,
  )) {
    if (videoIdBatch.length === 0) {
      continue;
    }

    rows.push(
      ...((await prisma.videoMetricsSnapshot.findMany({
        where: {
          videoId: {
            in: videoIdBatch,
          },
          capturedAt: {
            lte: endOfUtcDay(args.endDate),
          },
        },
        select: {
          videoId: true,
          capturedAt: true,
          views: true,
        },
        orderBy: [{ capturedAt: "asc" }],
      })) as VideoSnapshotRow[]),
    );
  }

  return rows;
}

export async function getOrganizationPayoutDashboardData(args: {
  organizationSlug: string;
  searchParams?: DashboardSearchParams;
  includeAdSpend?: boolean;
  includeSingularOverlay?: boolean;
}): Promise<OrganizationPayoutDashboardData> {
  const membership = await requireOrganizationMembership(args.organizationSlug);
  const campaignOptions = (await getAccessibleCampaignOptionsForMembership(membership)).map(
    (campaign) => ({
      id: campaign.id,
      label: campaign.name,
    }),
  );
  const selectedCampaignId = (() => {
    const requestedCampaignId = getSearchParamValue(args.searchParams, "campaign");
    return campaignOptions.some((campaign) => campaign.id === requestedCampaignId)
      ? (requestedCampaignId ?? null)
      : null;
  })();
  const selectedCampaignIds =
    selectedCampaignId != null
      ? [selectedCampaignId]
      : campaignOptions.map((campaign) => campaign.id);
  const latestVideoSync = await prisma.video.findFirst({
    where: {
      creator: {
        organizationId: membership.organizationId,
      },
      lastSyncedAt: {
        not: null,
      },
    },
    select: {
      lastSyncedAt: true,
    },
    orderBy: {
      lastSyncedAt: "desc",
    },
  });
  const { startDate, endDate, start, end } = getSelectedDateRange(
    args.searchParams,
    latestVideoSync?.lastSyncedAt ?? new Date(),
  );
  const selectedDateKeys = buildDateKeys(start, end);

  const campaignCreators = (await prisma.campaignCreator.findMany({
    where: {
      campaignId: {
        in: selectedCampaignIds,
      },
      campaign: getAccessibleCampaignWhere(membership),
      creator: {
        internalStatus: {
          not: CreatorStatus.ARCHIVED,
        },
      },
    },
    select: {
      id: true,
      campaignId: true,
      creatorId: true,
      campaign: {
        select: {
          id: true,
          name: true,
          ownerUserId: true,
          memberships: {
            where: {
              userId: membership.userId,
            },
            select: {
              role: true,
            },
            take: 1,
          },
        },
      },
      creator: {
        select: {
          id: true,
          displayName: true,
          platformAccounts: {
            where: {
              platform: Platform.TIKTOK,
            },
            select: {
              handle: true,
              platform: true,
            },
          },
        },
      },
      deals: {
        where: {
          organizationId: membership.organizationId,
        },
        select: {
          id: true,
          currency: true,
          effectiveStartDate: true,
          effectiveEndDate: true,
          fixedFee: true,
          fixedFeeRecognitionDate: true,
          fixedFeePerVideo: true,
          cpmAmount: true,
          paidTrafficMetric: true,
          deductPaidTraffic: true,
          viewCapPerVideo: true,
          viewWindowDays: true,
          payoutCapPerVideo: true,
          perVideoCapScope: true,
          payoutCapTotal: true,
          notes: true,
        },
        orderBy: [
          {
            effectiveStartDate: "asc",
          },
          {
            createdAt: "asc",
          },
        ],
      },
    },
    orderBy: [
      {
        campaign: {
          name: "asc",
        },
      },
      {
        creator: {
          displayName: "asc",
        },
      },
    ],
  })) as CampaignCreatorWorkspaceRow[];

  const creatorIds = [...new Set(campaignCreators.map((row) => row.creatorId))];
  const videos = creatorIds.length
    ? ((await prisma.video.findMany({
        where: {
          campaignId: {
            in: selectedCampaignIds,
          },
          creatorId: {
            in: creatorIds,
          },
          OR: [
            {
              publishedAt: {
                lte: endOfUtcDay(end),
              },
            },
            {
              publishedAt: null,
              createdAt: {
                lte: endOfUtcDay(end),
              },
            },
          ],
        },
        select: {
          id: true,
          campaignId: true,
          creatorId: true,
          sourceVideoId: true,
          platform: true,
          videoUrl: true,
          titleOrCaption: true,
          publishedAt: true,
          createdAt: true,
          views: true,
          lastSyncedAt: true,
          rawPayload: true,
        },
        orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
      })) as CampaignCreatorVideoRow[])
    : [];
  const videoIds = videos.map((video) => video.id);
  const snapshots = videoIds.length
    ? await getVideoSnapshotsForRange({
        videoIds,
        endDate: end,
      })
    : [];
  const paidPayouts = await prisma.payout.findMany({
    where: {
      organizationId: membership.organizationId,
      status: PayoutStatus.PAID,
      ...(selectedCampaignIds.length > 0
        ? {
            campaignId: {
              in: selectedCampaignIds,
            },
          }
        : {}),
      payoutDate: {
        gte: startOfUtcDay(start),
        lte: endOfUtcDay(end),
      },
    },
    select: {
      amount: true,
      payoutDate: true,
    },
  });

  const [dailyAdMetrics, singularOverlay] = await Promise.all([
    args.includeAdSpend === false
      ? {
          rows: [] as DailyAdMetricRow[],
          warnings: [] as string[],
        }
      : getDailyAdMetricsForOrganization({
          organizationId: membership.organizationId,
          startDate,
          endDate,
        }),
    args.includeSingularOverlay === false
      ? {
          rows: [],
          warnings: [],
        }
      : getTikTokSingularOverlay({
          startDate,
          endDate,
        }),
  ]);

  const warnings = [
    ...dailyAdMetrics.warnings,
    ...singularOverlay.warnings,
  ];
  const hasAnyAdDelivery = dailyAdMetrics.rows.some(
    (row) => row.spend > 0 || row.impressions > 0,
  );

  const snapshotsByVideoId = new Map<string, VideoSnapshotRow[]>();

  for (const snapshot of snapshots) {
    const existingSnapshots = snapshotsByVideoId.get(snapshot.videoId);

    if (existingSnapshots) {
      existingSnapshots.push(snapshot);
      continue;
    }

    snapshotsByVideoId.set(snapshot.videoId, [snapshot]);
  }

  const videosByCampaignCreatorKey = new Map<string, CampaignCreatorVideoRow[]>();

  for (const video of videos) {
    const key = getVideoGroupingKey(video);
    const existingVideos = videosByCampaignCreatorKey.get(key);

    if (existingVideos) {
      existingVideos.push(video);
      continue;
    }

    videosByCampaignCreatorKey.set(key, [video]);
  }

  const paidTimelineScope = campaignCreators.reduce(
    (totals, campaignCreator) => {
      const tiktokSourceVideoIds =
        videosByCampaignCreatorKey
          .get(`${campaignCreator.campaignId}::${campaignCreator.creatorId}`)
          ?.filter(
            (video) =>
              video.platform === Platform.TIKTOK &&
              typeof video.sourceVideoId === "string" &&
              video.sourceVideoId.length > 0,
          )
          .map((video) => video.sourceVideoId as string) ?? [];

      if (tiktokSourceVideoIds.length === 0) {
        return totals;
      }

      return {
        creators: totals.creators + 1,
        sourceVideos: totals.sourceVideos + tiktokSourceVideoIds.length,
      };
    },
    {
      creators: 0,
      sourceVideos: 0,
    },
  );
  const shouldSkipExactPaidDeductions =
    hasAnyAdDelivery &&
    (paidTimelineScope.creators > MAX_EXACT_PAID_TIMELINE_CREATORS ||
      paidTimelineScope.sourceVideos > MAX_EXACT_PAID_TIMELINE_SOURCE_VIDEOS);

  if (shouldSkipExactPaidDeductions) {
    warnings.push(
      `Exact TikTok paid-impression deductions were skipped for this overview because it spans ${paidTimelineScope.creators} creators and ${paidTimelineScope.sourceVideos} TikTok videos, which exceeds the live lookup budget. The dashboard used gross creator views for this broad selection so the page stays responsive.`,
    );
  }

  const actualPaidPayoutsByDate = getMetricMap(selectedDateKeys, 0);

  for (const payout of paidPayouts) {
    if (!payout.payoutDate) {
      continue;
    }

    const dateKey = toDateOnlyString(startOfUtcDay(payout.payoutDate));

    if (!actualPaidPayoutsByDate.has(dateKey)) {
      continue;
    }

    addNumberMapValue(actualPaidPayoutsByDate, dateKey, payout.amount);
  }

  const dailyRowsByDate = new Map(
    selectedDateKeys.map((dateKey) => [
      dateKey,
      {
        date: dateKey,
        ugcFixedCost: 0,
        ugcVariableCost: 0,
        ugcTotalCost: 0,
        adSpend: 0,
        totalSpend: 0,
        grossViews: 0,
        paidViewsDeducted: 0,
        payableViews: 0,
        adImpressions: 0,
        actualPaidPayouts: actualPaidPayoutsByDate.get(dateKey) ?? 0,
      } satisfies DailyCostRow,
    ]),
  );

  for (const adRow of dailyAdMetrics.rows) {
    const dailyRow = dailyRowsByDate.get(adRow.date);

    if (!dailyRow) {
      continue;
    }

    dailyRow.adSpend += adRow.spend;
    dailyRow.adImpressions += adRow.impressions;
  }

  const creatorRows: CreatorCostRow[] = [];
  const videoRows: VideoCostRow[] = [];

  for (const campaignCreator of campaignCreators) {
      const campaignVideos =
        videosByCampaignCreatorKey.get(
          `${campaignCreator.campaignId}::${campaignCreator.creatorId}`,
        ) ?? [];
      const canEditDeal =
        canManageOrganization(membership.role) ||
        campaignCreator.campaign.ownerUserId === membership.userId ||
        canManageCampaign(campaignCreator.campaign.memberships[0]?.role ?? CampaignRole.MEMBER);
      const activeDeal = getCampaignCreatorDealActiveInRange(
        campaignCreator.deals,
        start,
        end,
      );
      const resolvedDeal = resolveCampaignCreatorDeal(activeDeal, start);
      const currency = resolvedDeal.currency;
      const creatorWarnings = new Set<string>();
      const termStart = activeDeal
        ? startOfUtcDay(resolvedDeal.effectiveStartDate)
        : addUtcDays(start, -(resolvedDeal.viewWindowDays - 1));
      const dealEffectiveEnd = resolvedDeal.effectiveEndDate
        ? startOfUtcDay(resolvedDeal.effectiveEndDate)
        : null;
      const termEnd =
        dealEffectiveEnd && dealEffectiveEnd < end ? dealEffectiveEnd : end;
      const termDateKeys =
        termEnd >= termStart ? buildDateKeys(termStart, termEnd) : ([] as string[]);
      const creatorGrossViewsByDate = new Map(termDateKeys.map((dateKey) => [dateKey, 0]));
      const creatorPaidViewsByDate = new Map(termDateKeys.map((dateKey) => [dateKey, 0]));
      const creatorPayableViewsByDate = new Map(termDateKeys.map((dateKey) => [dateKey, 0]));
      const creatorVariableCostPreCapByDate = new Map(
        termDateKeys.map((dateKey) => [dateKey, 0]),
      );
      const hasNonViewsBaseVideos = campaignVideos.some((video) => !isViewsBaseVideo(video));
      const fixedFeeDateKey =
        resolvedDeal.fixedFee != null && hasNonViewsBaseVideos
          ? toDateOnlyString(
              startOfUtcDay(
                resolvedDeal.fixedFeeRecognitionDate ??
                  resolvedDeal.effectiveStartDate,
              ),
            )
          : null;
      const tiktokSourceVideoIds = campaignVideos
        .filter(
          (video) =>
            video.platform === Platform.TIKTOK &&
            typeof video.sourceVideoId === "string" &&
            video.sourceVideoId.length > 0,
        )
        .map((video) => video.sourceVideoId as string);

      let paidTimelineResult: TikTokSourceVideoPaidViewsTimelineResult | null = null;

      if (
        hasAnyAdDelivery &&
        !shouldSkipExactPaidDeductions &&
        termDateKeys.length > 0 &&
        tiktokSourceVideoIds.length > 0
      ) {
        try {
          paidTimelineResult =
            await getPaidViewTimelineForSourceVideosForCreatorForOrganization({
              organizationSlug: args.organizationSlug,
              creatorId: campaignCreator.creatorId,
              sourceVideoIds: tiktokSourceVideoIds,
              startDate: termStart,
              endDate: termEnd,
              metric: getPaidMetricForDeal(),
            });

          for (const warning of paidTimelineResult.warnings) {
            creatorWarnings.add(warning);
          }
        } catch (error) {
          creatorWarnings.add(
            error instanceof Error
              ? `Paid-impression deductions could not be loaded for ${campaignCreator.creator.displayName}, so the dashboard used 0 paid-impression deductions for this creator. ${error.message}`
              : `Paid-impression deductions could not be loaded for ${campaignCreator.creator.displayName}, so the dashboard used 0 paid-impression deductions for this creator.`,
          );
        }
      }

      const paidTimelineBySourceVideoId = paidTimelineResult
        ? getPaidTimelineRowMap(paidTimelineResult)
        : new Map<string, Map<string, number>>();
      const paidStatusBySourceVideoId = paidTimelineResult
        ? getPaidStatusMap(paidTimelineResult)
        : new Map();
      let unsupportedPaidVideoCount = 0;
      let exactPaidVideoCount = 0;
      let videoCapReached = false;
      let creatorGrossViews = 0;
      let creatorPaidViewsDeducted = 0;
      let creatorPayableViews = 0;

      for (const video of campaignVideos) {
        const effectiveDeal = getEffectiveDealForVideo(video, resolvedDeal);
        const perVideoPayableViewCap = getPerVideoPayableViewCap(effectiveDeal);
        const videoAnchorDate = startOfUtcDay(video.publishedAt ?? video.createdAt);
        const videoWindowEnd = startOfUtcDay(
          addUtcDays(videoAnchorDate, effectiveDeal.viewWindowDays - 1),
        );
        const videoTermStart =
          videoAnchorDate > termStart ? videoAnchorDate : termStart;
        const videoTermEnd = videoWindowEnd < termEnd ? videoWindowEnd : termEnd;
        const videoDateKeys =
          videoTermEnd >= videoTermStart
            ? buildDateKeys(videoTermStart, videoTermEnd)
            : ([] as string[]);
        const grossViewDeltaByDate =
          videoDateKeys.length > 0
            ? buildGrossViewDeltaMap({
                video,
                snapshots: snapshotsByVideoId.get(video.id) ?? [],
                startDate: videoTermStart,
                endDate: videoTermEnd,
              })
            : new Map<string, number>();
        const paidViewDeltaByDate =
          video.sourceVideoId != null
            ? paidTimelineBySourceVideoId.get(video.sourceVideoId) ?? new Map<string, number>()
            : new Map<string, number>();
        const paidStatus =
          video.sourceVideoId != null
            ? (paidStatusBySourceVideoId.get(video.sourceVideoId)?.paidStatus ??
              "not_applicable")
            : "not_applicable";
        const matchedAdIds =
          video.sourceVideoId != null
            ? (paidStatusBySourceVideoId.get(video.sourceVideoId)?.matchedAdIds ?? [])
            : [];

        if (paidStatus === "yes" || paidStatus === "no") {
          exactPaidVideoCount += 1;
        } else if (paidStatus !== "not_applicable") {
          unsupportedPaidVideoCount += 1;
        }

        let grossViewsCumulative = 0;
        let paidViewsCumulative = 0;
        let payableViewsCumulative = 0;
        const variableCostByDate = new Map<string, number>();
        const payableViewsByDate = new Map<string, number>();
        let selectedGrossViews = 0;
        let selectedPaidViews = 0;
        let selectedPayableViews = 0;
        let selectedVariableCost = 0;
        let perVideoCapReached = false;

        for (const dateKey of videoDateKeys) {
          const grossViewsDelta = grossViewDeltaByDate.get(dateKey) ?? 0;
          const paidViewsDelta =
            effectiveDeal.deductPaidTraffic && video.platform === Platform.TIKTOK
              ? paidViewDeltaByDate.get(dateKey) ?? 0
              : 0;

          grossViewsCumulative += grossViewsDelta;
          paidViewsCumulative += paidViewsDelta;

          let payableViewsNext = Math.max(grossViewsCumulative - paidViewsCumulative, 0);

          if (typeof effectiveDeal.viewCapPerVideo === "number") {
            payableViewsNext = Math.min(
              payableViewsNext,
              effectiveDeal.viewCapPerVideo,
            );
          }

          if (typeof perVideoPayableViewCap === "number") {
            payableViewsNext = Math.min(payableViewsNext, perVideoPayableViewCap);
          }

          const payableViewsDelta = Math.max(
            payableViewsNext - payableViewsCumulative,
            0,
          );
          const variableCostDelta =
            effectiveDeal.cpmAmount > 0
              ? (payableViewsDelta / 1_000) * effectiveDeal.cpmAmount
              : 0;

          payableViewsCumulative = payableViewsNext;
          variableCostByDate.set(dateKey, variableCostDelta);
          payableViewsByDate.set(dateKey, payableViewsDelta);

          addNumberMapValue(creatorGrossViewsByDate, dateKey, grossViewsDelta);
          addNumberMapValue(creatorPaidViewsByDate, dateKey, paidViewsDelta);
          addNumberMapValue(creatorPayableViewsByDate, dateKey, payableViewsDelta);
          addNumberMapValue(creatorVariableCostPreCapByDate, dateKey, variableCostDelta);

          if (selectedDateKeys.includes(dateKey)) {
            selectedGrossViews += grossViewsDelta;
            selectedPaidViews += paidViewsDelta;
            selectedPayableViews += payableViewsDelta;
            selectedVariableCost += variableCostDelta;
          }
        }

        if (
          (typeof effectiveDeal.viewCapPerVideo === "number" &&
            payableViewsCumulative >= effectiveDeal.viewCapPerVideo) ||
          (typeof perVideoPayableViewCap === "number" &&
            payableViewsCumulative >= perVideoPayableViewCap)
        ) {
          perVideoCapReached = true;
          videoCapReached = true;
        }

        creatorGrossViews += selectedGrossViews;
        creatorPaidViewsDeducted += selectedPaidViews;
        creatorPayableViews += selectedPayableViews;

        videoRows.push({
          campaignCreatorId: campaignCreator.id,
          campaignId: campaignCreator.campaignId,
          campaignName: campaignCreator.campaign.name,
          creatorId: campaignCreator.creatorId,
          creatorName: campaignCreator.creator.displayName,
          currency,
          videoId: video.id,
          sourceVideoId: video.sourceVideoId,
          platform: video.platform,
          videoUrl: video.videoUrl,
          titleOrCaption: video.titleOrCaption,
          publishedAt: video.publishedAt,
          grossViews: selectedGrossViews,
          paidViewsDeducted: selectedPaidViews,
          payableViews: selectedPayableViews,
          variableCost: normalizeMoney(selectedVariableCost),
          sourceLabel: getVideoSourceLabel(video),
          effectiveCpm: effectiveDeal.cpmAmount,
          viewCapReached: perVideoCapReached,
          creatorTotalCapApplied: false,
          paidStatus,
          matchedAdIds,
        });
      }

      let fixedRunning = 0;
      let variableRunning = 0;
      let actualFixedRunning = 0;
      let actualVariableRunning = 0;
      let selectedFixedCost = 0;
      let selectedVariableCost = 0;
      let creatorTotalCapApplied = false;

      for (const dateKey of termDateKeys) {
        const fixedFeeDelta =
          fixedFeeDateKey === dateKey ? (resolvedDeal.fixedFee ?? 0) : 0;
        const variableCostDelta = creatorVariableCostPreCapByDate.get(dateKey) ?? 0;
        fixedRunning += fixedFeeDelta;
        variableRunning += variableCostDelta;

        let nextActualFixedRunning = fixedRunning;
        let nextActualVariableRunning = variableRunning;

        if (typeof resolvedDeal.payoutCapTotal === "number") {
          nextActualFixedRunning = Math.min(
            fixedRunning,
            resolvedDeal.payoutCapTotal,
          );
          const remainingCap = Math.max(
            resolvedDeal.payoutCapTotal - nextActualFixedRunning,
            0,
          );
          nextActualVariableRunning = Math.min(variableRunning, remainingCap);

          if (nextActualVariableRunning < variableRunning) {
            creatorTotalCapApplied = true;
          }
        }

        const actualFixedDelta = nextActualFixedRunning - actualFixedRunning;
        const actualVariableDelta = nextActualVariableRunning - actualVariableRunning;
        actualFixedRunning = nextActualFixedRunning;
        actualVariableRunning = nextActualVariableRunning;

        if (selectedDateKeys.includes(dateKey)) {
          selectedFixedCost += actualFixedDelta;
          selectedVariableCost += actualVariableDelta;
          const dailyRow = dailyRowsByDate.get(dateKey);

          if (dailyRow) {
            dailyRow.ugcFixedCost += actualFixedDelta;
            dailyRow.ugcVariableCost += actualVariableDelta;
            dailyRow.grossViews += creatorGrossViewsByDate.get(dateKey) ?? 0;
            dailyRow.paidViewsDeducted += creatorPaidViewsByDate.get(dateKey) ?? 0;
            dailyRow.payableViews += creatorPayableViewsByDate.get(dateKey) ?? 0;
          }
        }
      }

      if (creatorTotalCapApplied) {
        for (const videoRow of videoRows) {
          if (videoRow.campaignCreatorId === campaignCreator.id) {
            videoRow.creatorTotalCapApplied = true;
          }
        }
      }

      creatorRows.push({
        campaignCreatorId: campaignCreator.id,
        campaignId: campaignCreator.campaignId,
        campaignName: campaignCreator.campaign.name,
        creatorId: campaignCreator.creatorId,
        creatorName: campaignCreator.creator.displayName,
        tiktokHandle: getTikTokHandle(campaignCreator),
        canEditDeal,
        hasCustomDeal: activeDeal != null,
        currency,
        deal: resolvedDeal,
        grossViews: creatorGrossViews,
        paidViewsDeducted: creatorPaidViewsDeducted,
        payableViews: creatorPayableViews,
        fixedCost: normalizeMoney(selectedFixedCost),
        variableCost: normalizeMoney(selectedVariableCost),
        totalCost: normalizeMoney(selectedFixedCost + selectedVariableCost),
        tiktokVideoCount: campaignVideos.filter((video) => video.platform === Platform.TIKTOK)
          .length,
        unsupportedPaidVideoCount,
        exactPaidVideoCount,
        creatorTotalCapApplied,
        videoCapReached,
        warnings: [...creatorWarnings],
      });

      for (const warning of creatorWarnings) {
        warnings.push(
          `${campaignCreator.creator.displayName}: ${warning}`,
        );
      }
  }

  for (const dailyRow of dailyRowsByDate.values()) {
    dailyRow.ugcFixedCost = normalizeMoney(dailyRow.ugcFixedCost);
    dailyRow.ugcVariableCost = normalizeMoney(dailyRow.ugcVariableCost);
    dailyRow.ugcTotalCost = normalizeMoney(
      dailyRow.ugcFixedCost + dailyRow.ugcVariableCost,
    );
    dailyRow.adSpend = normalizeMoney(dailyRow.adSpend);
    dailyRow.totalSpend = normalizeMoney(dailyRow.ugcTotalCost + dailyRow.adSpend);
    dailyRow.actualPaidPayouts = normalizeMoney(dailyRow.actualPaidPayouts);
  }

  const dailyRows = [...dailyRowsByDate.values()].sort((left, right) =>
    left.date.localeCompare(right.date),
  );
  const ugcFixedCost = dailyRows.reduce((total, row) => total + row.ugcFixedCost, 0);
  const ugcVariableCost = dailyRows.reduce((total, row) => total + row.ugcVariableCost, 0);
  const adSpend = dailyRows.reduce((total, row) => total + row.adSpend, 0);
  const grossViews = dailyRows.reduce((total, row) => total + row.grossViews, 0);
  const paidViewsDeducted = dailyRows.reduce(
    (total, row) => total + row.paidViewsDeducted,
    0,
  );
  const payableViews = dailyRows.reduce((total, row) => total + row.payableViews, 0);
  const adImpressions = dailyRows.reduce((total, row) => total + row.adImpressions, 0);
  const actualPaidPayouts = dailyRows.reduce(
    (total, row) => total + row.actualPaidPayouts,
    0,
  );

  return {
    campaignOptions,
    selectedCampaignId,
    startDate,
    endDate,
    warnings: [...new Set(warnings)],
    summary: {
      totalSpend: normalizeMoney(ugcFixedCost + ugcVariableCost + adSpend),
      ugcSpend: normalizeMoney(ugcFixedCost + ugcVariableCost),
      ugcFixedCost: normalizeMoney(ugcFixedCost),
      ugcVariableCost: normalizeMoney(ugcVariableCost),
      adSpend: normalizeMoney(adSpend),
      grossViews,
      paidViewsDeducted,
      payableViews,
      adImpressions,
      singularRevenue: normalizeMoney(
        singularOverlay.rows.reduce((total, row) => total + row.revenue, 0),
      ),
      singularProfit: normalizeMoney(
        singularOverlay.rows.reduce((total, row) => total + (row.revenue - row.spend), 0),
      ),
      singularInstalls: singularOverlay.rows.reduce(
        (total, row) => total + row.installs,
        0,
      ),
      singularConversions: singularOverlay.rows.reduce(
        (total, row) => total + row.conversions,
        0,
      ),
      actualPaidPayouts: normalizeMoney(actualPaidPayouts),
      creatorRowsWithDeals: creatorRows.filter((row) => row.hasCustomDeal).length,
    },
    dailyRows,
    creators: creatorRows.sort(
      (left, right) =>
        left.campaignName.localeCompare(right.campaignName) ||
        left.creatorName.localeCompare(right.creatorName),
    ),
    videos: videoRows.sort(
      (left, right) =>
        right.variableCost - left.variableCost ||
        right.grossViews - left.grossViews ||
        left.creatorName.localeCompare(right.creatorName),
    ),
  };
}
