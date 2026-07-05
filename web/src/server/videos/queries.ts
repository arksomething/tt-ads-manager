import {
  ExternalSource,
  Platform,
  SourceEntityType,
  type Prisma,
} from "@/lib/prisma-shim";
import { unstable_cache } from "next/cache";

import { prisma } from "@/lib/db";
import { timeAsync, timeSync } from "@/lib/server-timing";
import {
  canManageOrganization,
  canReadOrganizationCampaignData,
} from "@/server/auth/roles";
import {
  ViralAppApiError,
  viralAppClient,
} from "@/server/data-provider/viral-app-client";
import {
  getSelectedIdsFromSearchParams,
  type DashboardSearchParams,
} from "@/server/dashboard/filters";
import { getOrganizationDashboardShellData } from "@/server/dashboard/org-shell";
import {
  getAdSpendForOrganization,
  getPaidViewsForSourceVideosForCreatorForOrganization,
  type TikTokAdSpendRow,
  type TikTokVideoPaidAttributionSource,
  type TikTokVideoPaidStatus,
  type TikTokVideoPaidStatusReason,
} from "@/server/tiktok-business/reporting";
import { getVideoDataSourceLabel } from "@/server/viewsbase/shared";

export const IMPORTED_VIDEOS_PAGE_SIZE = 50;
const PROVIDER_PAGINATION_CONCURRENCY = 3;
export const reviewWindowOptions = [
  { id: "24h", label: "Last 24 hours" },
  { id: "3d", label: "Last 3 days" },
  { id: "7d", label: "Last 7 days" },
] as const;

export type ReviewWindowId = (typeof reviewWindowOptions)[number]["id"];

export type ImportedVideoListItem = {
  id: string;
  videoUrl: string;
  titleOrCaption: string | null;
  platform: Platform;
  sourceLabel: string;
  views: number | null;
  likes: number | null;
  comments: number | null;
  engagementRate: number | null;
  publishedAt: Date | null;
  createdAt: Date;
  campaignId: string | null;
  campaignName: string | null;
  creatorName: string;
  accountHandle: string | null;
  thumbnailUrl?: string;
};

export type VideoManagerListItem = {
  id: string;
  sourceVideoId: string;
  videoUrl: string;
  titleOrCaption: string | null;
  platform: Platform;
  views: number | null;
  likes: number | null;
  comments: number | null;
  publishedAt: Date | null;
  createdAt: Date;
  isTalking: boolean;
  campaignId: string | null;
  campaignName: string | null;
  creatorId: string;
  creatorName: string;
  accountHandle: string | null;
  thumbnailUrl?: string;
};

export type OrganizationVideoManagerData = {
  creatorOptions: Array<{
    id: string;
    label: string;
    meta?: string;
  }>;
  selectedCreatorId: string | null;
  startDate: string;
  endDate: string;
  warnings: string[];
  errorMessage: string | null;
  rows: VideoManagerListItem[];
  totalCount: number;
  rowLimit: number;
  isLimited: boolean;
  talkingCount: number;
  nonTalkingCount: number;
  canManageTalkingStatus: boolean;
};

export type ReviewQueueVideoItem = {
  id: string;
  videoUrl: string;
  titleOrCaption: string | null;
  platform: Platform;
  views: number | null;
  likes: number | null;
  comments: number | null;
  engagementRate: number | null;
  publishedAt: Date | null;
  createdAt: Date;
  creatorName: string;
  accountHandle: string | null;
  thumbnailUrl?: string;
  reviewedAt: Date | null;
};

export type OrganizationCampaignReviewQueue = {
  campaignOptions: Array<{
    id: string;
    label: string;
  }>;
  selectedCampaign: {
    id: string;
    label: string;
  } | null;
  selectedWindowId: ReviewWindowId;
  windowStartedAt: Date;
  pendingItems: ReviewQueueVideoItem[];
  reviewedItems: ReviewQueueVideoItem[];
  totalCount: number;
  pendingCount: number;
  reviewedCount: number;
  completionPercent: number;
  nextVideo: ReviewQueueVideoItem | null;
};

export type ViewTallyListItem = {
  id: string;
  sourceVideoId: string;
  videoUrl: string;
  titleOrCaption: string | null;
  publishedAt: Date | null;
  createdAt: Date;
  views: number | null;
  currentViews: number | null;
  paidViews: number | null;
  organicViewsEstimate: number | null;
  paidStatus: TikTokVideoPaidStatus;
  paidStatusReason: TikTokVideoPaidStatusReason;
  matchedSparkItemIds: string[];
  matchedAdIds: string[];
  unresolvedPostBackedAdIds: string[];
  unresolvedNonPostBackedAdIds: string[];
  unresolvedPostBackedGroupCount: number;
  unresolvedNonPostBackedGroupCount: number;
  lookupWindowUnresolvedPostBackedGroupCount: number;
  lookupWindowUnresolvedNonPostBackedGroupCount: number;
  attributionSources: TikTokVideoPaidAttributionSource[];
  creatorName: string;
  accountHandle: string | null;
  thumbnailUrl?: string;
};

export type ViewTallyTopAccount = {
  id: string;
  label: string;
  handle: string | null;
  views: number;
  paidViews: number;
  videos: number;
  avatarUrl?: string;
};

export type ViewTallyAdSpendListItem = {
  key: string;
  adId: string | null;
  itemId: string | null;
  itemIds: string[];
  statDate: string | null;
  spend: number;
  matchStatus: "exact_report_item_id" | "exact_ad_metadata" | "matched_ad_id" | "unmatched";
  matchedVideo: {
    id: string;
    titleOrCaption: string | null;
    videoUrl: string;
    sourceVideoId: string;
    creatorName: string;
    accountHandle: string | null;
    thumbnailUrl?: string;
  } | null;
};

export type OrganizationViewTallyData = {
  creatorOptions: Array<{
    id: string;
    label: string;
    meta?: string;
  }>;
  selectedCreator: {
    id: string;
    label: string;
    meta?: string;
  } | null;
  startDate: string;
  endDate: string;
  warnings: string[];
  errorMessage: string | null;
  topLimit: number;
  topLimitOptions: number[];
  rows: ViewTallyListItem[];
  topVideos: ViewTallyListItem[];
  topAccounts: ViewTallyTopAccount[];
  adSpend: {
    advertiserId: string | null;
    totalSpend: number;
    rowCount: number;
    rows: ViewTallyAdSpendListItem[];
    warnings: string[];
  };
  totals: {
    videos: number;
    totalViews: number;
    paidViews: number;
    deductedPaidViews: number;
    unpaidViews: number;
    organicViewsEstimate: number;
    yesVideos: number;
    noVideos: number;
    unknownVideos: number;
    unsupportedVideos: number;
  };
};

export type OrganizationViewTallyAdSpendData = Pick<
  OrganizationViewTallyData,
  "startDate" | "endDate" | "adSpend"
>;

const VIEW_TALLY_ALL_CREATORS_ID = "all";
const VIEW_TALLY_AD_SPEND_TIMEOUT_MS = 20000;
const VIEW_TALLY_SPEND_CONTENT_LOOKUP_TIMEOUT_MS = 4500;
const VIEW_TALLY_SPEND_CONTENT_LOOKUP_LIMIT = 30;
const VIEW_TALLY_TOP_LIMIT_OPTIONS = [5, 10, 25, 50, 100] as const;
const VIDEO_MANAGER_ROW_LIMIT = 5;

type ViewTallyCreatorOption = OrganizationViewTallyData["creatorOptions"][number];

type ViewTallySpendContentVideo = Pick<
  ViewTallyListItem,
  | "id"
  | "sourceVideoId"
  | "videoUrl"
  | "titleOrCaption"
  | "creatorName"
  | "accountHandle"
  | "thumbnailUrl"
>;

type TrackedTikTokAccountRecord = {
  id: string;
  platform: string;
  platformAccountId: string | null;
  username: string | null;
  displayName: string | null;
  totalVideosTracked?: number | null;
};

type TrackedTikTokVideoRecord = {
  id: string;
  orgAccountId: string | null;
  platformVideoId: string;
  platform: string;
  username: string | null;
  accountDisplayName: string | null;
  createdAt: string | null;
};

type TrackedTikTokVideoDetails = {
  id?: string;
  platformVideoId?: string;
  platform_video_id?: string;
  accountUsername?: string | null;
  account_username?: string | null;
  accountDisplayName?: string | null;
  account_display_name?: string | null;
  caption?: string | null;
  title?: string | null;
  thumbnailUrl?: string | null;
  thumbnail_url?: string | null;
  accountProfilePictureUrl?: string | null;
  account_profile_picture_url?: string | null;
  publishedAt?: string | null;
  published_at?: string | null;
  createdAt?: string | null;
  created_at?: string | null;
  loadAt?: string | null;
  load_at?: string | null;
  viewCount?: number | string | null;
  view_count?: number | string | null;
  likeCount?: number | string | null;
  like_count?: number | string | null;
  commentCount?: number | string | null;
  comment_count?: number | string | null;
};

type ProviderAnalyticsVideoRecord = Record<string, unknown> & {
  id?: string | null;
  platformVideoId?: string | null;
  platform_video_id?: string | null;
  platformVideo_id?: string | null;
  platform?: string | null;
  accountUsername?: string | null;
  account_username?: string | null;
  accountDisplayName?: string | null;
  account_display_name?: string | null;
  accountProfilePictureUrl?: string | null;
  account_profile_picture_url?: string | null;
  caption?: string | null;
  title?: string | null;
  thumbnailUrl?: string | null;
  thumbnail_url?: string | null;
  publishedAt?: string | null;
  published_at?: string | null;
  createdAt?: string | null;
  created_at?: string | null;
  viewCountInPeriod?: number | string | null;
  view_count_in_period?: number | string | null;
  viewsInPeriod?: number | string | null;
  viewCountDelta?: number | string | null;
  viewDelta?: number | string | null;
  viewCount?: number | string | null;
  view_count?: number | string | null;
  currentViews?: number | string | null;
  current_views?: number | string | null;
  totalViews?: number | string | null;
  total_views?: number | string | null;
  orgAccountId?: string | null;
  org_account_id?: string | null;
};

type ProviderAnalyticsAccountRecord = Record<string, unknown> & {
  id?: string | null;
  orgAccountId?: string | null;
  org_account_id?: string | null;
  username?: string | null;
  accountUsername?: string | null;
  account_username?: string | null;
  displayName?: string | null;
  accountDisplayName?: string | null;
  account_display_name?: string | null;
  profilePictureUrl?: string | null;
  accountProfilePictureUrl?: string | null;
  account_profile_picture_url?: string | null;
  viewCountInPeriod?: number | string | null;
  view_count_in_period?: number | string | null;
  viewsInPeriod?: number | string | null;
  viewCountDelta?: number | string | null;
  viewDelta?: number | string | null;
  videoCountInPeriod?: number | string | null;
  video_count_in_period?: number | string | null;
};

type PagedProviderRecordsResponse = {
  data?: Array<Record<string, unknown>>;
  pageCount?: number | string | null;
};

function getSearchParamValue(
  searchParams: DashboardSearchParams | undefined,
  key: string,
) {
  const value = searchParams?.[key];
  return Array.isArray(value) ? value[0] : value;
}

function getSelectedReviewWindow(
  searchParams: DashboardSearchParams | undefined,
): ReviewWindowId {
  const rawValue = getSearchParamValue(searchParams, "window");
  const validWindowIds = new Set<ReviewWindowId>(
    reviewWindowOptions.map((option) => option.id),
  );

  return rawValue && validWindowIds.has(rawValue as ReviewWindowId)
    ? (rawValue as ReviewWindowId)
    : reviewWindowOptions[0].id;
}

function toDateOnlyString(value: Date) {
  return value.toISOString().slice(0, 10);
}

function parseDateOnlyString(value: string) {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getDateOnlySearchParam(
  searchParams: DashboardSearchParams | undefined,
  key: string,
) {
  const rawValue = getSearchParamValue(searchParams, key);

  if (!rawValue || !/^\d{4}-\d{2}-\d{2}$/.test(rawValue)) {
    return null;
  }

  return rawValue;
}

function getDefaultViewTallyStartDate() {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - 1);
  return toDateOnlyString(date);
}

function getDefaultViewTallyEndDate() {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - 1);
  return toDateOnlyString(date);
}

function getViewTallyDateRange(searchParams: DashboardSearchParams | undefined) {
  const fallbackStartDate = getDefaultViewTallyStartDate();
  const fallbackEndDate = getDefaultViewTallyEndDate();
  const startDate = getDateOnlySearchParam(searchParams, "startDate") ?? fallbackStartDate;
  const endDate = getDateOnlySearchParam(searchParams, "endDate") ?? fallbackEndDate;

  if (endDate < startDate) {
    return {
      startDate: fallbackStartDate,
      endDate: fallbackEndDate,
    };
  }

  return {
    startDate,
    endDate,
  };
}

function getSelectedViewTallyTopLimit(
  searchParams: DashboardSearchParams | undefined,
) {
  const rawValue = getSearchParamValue(searchParams, "topLimit");
  const parsedValue = rawValue ? Number(rawValue) : null;

  return VIEW_TALLY_TOP_LIMIT_OPTIONS.includes(
    parsedValue as (typeof VIEW_TALLY_TOP_LIMIT_OPTIONS)[number],
  )
    ? parsedValue!
    : VIEW_TALLY_TOP_LIMIT_OPTIONS[0];
}

function getSelectedViewTallyCreatorId(
  searchParams: DashboardSearchParams | undefined,
  creatorOptions: Array<{
    id: string;
    label: string;
    meta?: string;
  }>,
) {
  const rawValue = getSearchParamValue(searchParams, "creator");
  const validCreatorIds = new Set(creatorOptions.map((creator) => creator.id));

  if (!rawValue || rawValue === VIEW_TALLY_ALL_CREATORS_ID) {
    return creatorOptions.length > 0 ? VIEW_TALLY_ALL_CREATORS_ID : null;
  }

  return rawValue && validCreatorIds.has(rawValue)
    ? rawValue
    : VIEW_TALLY_ALL_CREATORS_ID;
}

function normalizeProviderText(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeProviderNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
) {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
  });

  return Promise.race([
    promise.finally(() => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }),
    timeoutPromise,
  ]);
}

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

function isProviderRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getProviderAnalyticsRecords<T extends Record<string, unknown>>(
  response: unknown,
) {
  if (Array.isArray(response)) {
    return response.filter(isProviderRecord) as T[];
  }

  if (!isProviderRecord(response)) {
    return [];
  }

  for (const key of ["data", "rows", "results", "videos", "accounts"]) {
    const value = response[key];

    if (Array.isArray(value)) {
      return value.filter(isProviderRecord) as T[];
    }
  }

  return [];
}

function getAnalyticsPeriodViewCount(record: Record<string, unknown>) {
  return (
    normalizeProviderNumber(record.viewCountInPeriod) ??
    normalizeProviderNumber(record.view_count_in_period) ??
    normalizeProviderNumber(record.viewsInPeriod) ??
    normalizeProviderNumber(record.viewCountDelta) ??
    normalizeProviderNumber(record.viewDelta) ??
    normalizeProviderNumber(record.views)
  );
}

function getAnalyticsCurrentViewCount(record: Record<string, unknown>) {
  return (
    normalizeProviderNumber(record.viewCount) ??
    normalizeProviderNumber(record.view_count) ??
    normalizeProviderNumber(record.currentViews) ??
    normalizeProviderNumber(record.current_views) ??
    normalizeProviderNumber(record.totalViews) ??
    normalizeProviderNumber(record.total_views) ??
    null
  );
}

function getProviderMetricNumber(value: unknown): number | null {
  const directValue = normalizeProviderNumber(value);

  if (directValue !== null) {
    return directValue;
  }

  if (!isProviderRecord(value)) {
    return null;
  }

  return (
    normalizeProviderNumber(value.value) ??
    normalizeProviderNumber(value.current) ??
    normalizeProviderNumber(value.total) ??
    normalizeProviderNumber(value.count)
  );
}

function extractProviderAnalyticsViewTotal(response: unknown): number | null {
  const candidateKeys = [
    "viewCount",
    "view_count",
    "views",
    "totalViews",
    "total_views",
    "viewCountInPeriod",
    "view_count_in_period",
  ];
  const candidateContainers: unknown[] = [response];

  if (isProviderRecord(response)) {
    candidateContainers.push(
      response.data,
      response.kpis,
      response.metrics,
      response.current,
      response.summary,
      response.totals,
    );
  }

  for (const container of candidateContainers) {
    if (isProviderRecord(container)) {
      for (const key of candidateKeys) {
        const value = getProviderMetricNumber(container[key]);

        if (value !== null) {
          return value;
        }
      }
    }

    if (Array.isArray(container)) {
      for (const item of container) {
        if (!isProviderRecord(item)) {
          continue;
        }

        const metricName =
          normalizeProviderText(item.metric) ??
          normalizeProviderText(item.key) ??
          normalizeProviderText(item.name) ??
          normalizeProviderText(item.id);

        if (!metricName || !candidateKeys.includes(metricName)) {
          continue;
        }

        const value =
          getProviderMetricNumber(item.value) ??
          getProviderMetricNumber(item.current) ??
          getProviderMetricNumber(item.total);

        if (value !== null) {
          return value;
        }
      }
    }
  }

  return null;
}

function getNetViewCount(args: {
  views: number | null | undefined;
  paidViews: number | null | undefined;
}) {
  return Math.max((args.views ?? 0) - (args.paidViews ?? 0), 0);
}

function uniqueNonEmptyStrings(values: ReadonlyArray<string | null | undefined>) {
  return [
    ...new Set(
      values
        .map((value) => normalizeProviderText(value))
        .filter(Boolean) as string[],
    ),
  ];
}

function normalizeHandleLookupValue(value: string | null | undefined) {
  return normalizeProviderText(value)?.replace(/^@/, "") ?? null;
}

async function getViewTallySpendContentVideo(
  sourceVideoId: string,
): Promise<ViewTallySpendContentVideo | null> {
  try {
    const details = await getTrackedTikTokVideoDetails(sourceVideoId);
    const accountHandle =
      normalizeProviderText(details.accountUsername) ??
      normalizeProviderText(details.account_username);

    return {
      id: normalizeProviderText(details.id) ?? sourceVideoId,
      sourceVideoId:
        normalizeProviderText(details.platformVideoId) ??
        normalizeProviderText(details.platform_video_id) ??
        sourceVideoId,
      videoUrl: buildTrackedTikTokVideoUrl({
        platformVideoId: sourceVideoId,
        username: accountHandle,
      }),
      titleOrCaption:
        normalizeProviderText(details.caption) ??
        normalizeProviderText(details.title),
      creatorName:
        normalizeProviderText(details.accountDisplayName) ??
        normalizeProviderText(details.account_display_name) ??
        accountHandle ??
        "TikTok content",
      accountHandle,
      thumbnailUrl:
        normalizeImageUrl(
          normalizeProviderText(details.thumbnailUrl) ??
            normalizeProviderText(details.thumbnail_url),
        ) ??
        normalizeImageUrl(
          normalizeProviderText(details.accountProfilePictureUrl) ??
            normalizeProviderText(details.account_profile_picture_url),
        ),
    };
  } catch {
    return null;
  }
}

async function resolveViewTallyPaidLookupCreatorId(args: {
  organizationId: string;
  selectedCreator: ViewTallyCreatorOption;
  selectedTrackedAccount: TrackedTikTokAccountRecord | null;
  selectedCreatorUsername: string | null;
  sourceVideoIds: string[];
}) {
  const directCreator = await prisma.creator.findFirst({
    where: {
      id: args.selectedCreator.id,
      organizationId: args.organizationId,
    },
    select: {
      id: true,
    },
  });

  if (directCreator) {
    return directCreator.id;
  }

  const candidateExternalIds = uniqueNonEmptyStrings([
    args.selectedTrackedAccount?.id,
    args.selectedTrackedAccount?.platformAccountId,
    normalizeHandleLookupValue(args.selectedTrackedAccount?.username),
    normalizeHandleLookupValue(args.selectedCreatorUsername),
  ]);

  const accountMapping =
    candidateExternalIds.length > 0
      ? await prisma.sourceMapping.findFirst({
          where: {
            organizationId: args.organizationId,
            localEntityType: SourceEntityType.PLATFORM_ACCOUNT,
            externalSource: ExternalSource.DATA_PROVIDER,
            externalResourceType: {
              in: [`viral-account:${Platform.TIKTOK}`, "viral-account:tiktok"],
            },
            externalId: {
              in: candidateExternalIds,
            },
          },
          orderBy: {
            updatedAt: "desc",
          },
          select: {
            localEntityId: true,
          },
        })
      : null;

  if (accountMapping) {
    const account = await prisma.creatorPlatformAccount.findFirst({
      where: {
        id: accountMapping.localEntityId,
        creator: {
          organizationId: args.organizationId,
        },
      },
      select: {
        creatorId: true,
      },
    });

    if (account) {
      return account.creatorId;
    }
  }

  const sourceAccountIds = uniqueNonEmptyStrings([
    args.selectedTrackedAccount?.platformAccountId,
    args.selectedTrackedAccount?.id,
  ]);
  const handles = uniqueNonEmptyStrings([
    normalizeHandleLookupValue(args.selectedTrackedAccount?.username),
    normalizeHandleLookupValue(args.selectedCreatorUsername),
    normalizeHandleLookupValue(args.selectedCreator.meta),
  ]);
  const accountWhere: Prisma.CreatorPlatformAccountWhereInput[] = [];

  if (sourceAccountIds.length > 0) {
    accountWhere.push({
      sourceAccountId: {
        in: sourceAccountIds,
      },
    });
  }

  for (const handle of handles) {
    accountWhere.push({
      handle: {
        equals: handle,
        mode: "insensitive",
      },
    });
  }

  const account =
    accountWhere.length > 0
      ? await prisma.creatorPlatformAccount.findFirst({
          where: {
            platform: Platform.TIKTOK,
            OR: accountWhere,
            creator: {
              organizationId: args.organizationId,
            },
          },
          orderBy: {
            updatedAt: "desc",
          },
          select: {
            creatorId: true,
          },
        })
      : null;

  if (account) {
    return account.creatorId;
  }

  const sourceVideoIds = uniqueNonEmptyStrings(args.sourceVideoIds);

  if (sourceVideoIds.length === 0) {
    return null;
  }

  const localVideos = await prisma.video.findMany({
    where: {
      platform: Platform.TIKTOK,
      sourceVideoId: {
        in: sourceVideoIds,
      },
      creator: {
        organizationId: args.organizationId,
      },
    },
    select: {
      creatorId: true,
    },
  });

  const creatorVideoCounts = new Map<string, number>();

  for (const video of localVideos) {
    creatorVideoCounts.set(
      video.creatorId,
      (creatorVideoCounts.get(video.creatorId) ?? 0) + 1,
    );
  }

  return (
    [...creatorVideoCounts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ??
    null
  );
}

function parseProviderDate(value: unknown) {
  const normalized = normalizeProviderText(value);

  if (!normalized) {
    return null;
  }

  const isoLikeValue = normalized
    .replace(/^(\d{4}-\d{2}-\d{2})\s+/, "$1T")
    .replace(/([+-]\d{2})$/, "$1:00")
    .replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
  const parsed = new Date(isoLikeValue);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function buildTrackedTikTokVideoUrl(args: {
  platformVideoId: string;
  username: string | null;
}) {
  return args.username
    ? `https://www.tiktok.com/@${encodeURIComponent(args.username)}/video/${encodeURIComponent(args.platformVideoId)}`
    : `https://www.tiktok.com/video/${encodeURIComponent(args.platformVideoId)}`;
}

async function getPagedProviderRecords(args: {
  path: string;
  search?: string;
  perPage?: number;
  extraQuery?: Record<string, string | number | boolean | undefined>;
}) {
  async function getPage(page: number) {
    const response = await viralAppClient.request<PagedProviderRecordsResponse>({
      path: args.path,
      query: {
        ...(args.extraQuery ?? {}),
        ...(args.search
          ? {
              search: args.search,
            }
          : {}),
        ...(args.perPage
          ? {
              perPage: args.perPage,
            }
          : {}),
        page,
      },
    });

    return {
      records: response.data ?? [],
      pageCount: Math.max(1, normalizeProviderNumber(response.pageCount) ?? 1),
    };
  }

  const firstPage = await getPage(1);
  const records: Array<Record<string, unknown>> = [...firstPage.records];

  if (firstPage.records.length === 0 || firstPage.pageCount <= 1) {
    return records;
  }

  const remainingPages = Array.from(
    { length: firstPage.pageCount - 1 },
    (_, index) => index + 2,
  );
  const remainingRecords = await mapWithConcurrency(
    remainingPages,
    PROVIDER_PAGINATION_CONCURRENCY,
    async (page) => (await getPage(page)).records,
  );

  records.push(...remainingRecords.flat());

  return records;
}

async function getTrackedTikTokAccountsUncached() {
  const records = await getPagedProviderRecords({
    path: "/accounts/tracked",
    perPage: 100,
    extraQuery: {
      platforms: "tiktok",
      viewMode: "internal",
    },
  });

  return records
    .map((record) => ({
      id: normalizeProviderText(record.id) ?? "",
      platform: normalizeProviderText(record.platform) ?? "",
      platformAccountId: normalizeProviderText(record.platformAccountId),
      username:
        normalizeProviderText(record.username) ??
        normalizeProviderText(record.initialUsername),
      displayName: normalizeProviderText(record.displayName),
      totalVideosTracked: normalizeProviderNumber(record.totalVideosTracked),
    }))
    .filter((record) => record.id.length > 0);
}

const getTrackedTikTokAccounts = unstable_cache(
  async () => getTrackedTikTokAccountsUncached(),
  ["view-tally-tracked-tiktok-accounts"],
  {
    revalidate: 300,
  },
);

function normalizeViewTallyHandle(value: string | null | undefined) {
  const normalized = value?.trim().replace(/^@/, "").toLowerCase();
  return normalized && normalized.length > 0 ? normalized : null;
}

function normalizeViewTallyName(value: string | null | undefined) {
  const normalized = value?.trim().replace(/\s+/g, " ").toLowerCase();
  return normalized && normalized.length > 0 ? normalized : null;
}

export async function resolveViewTallyCreatorIdForLocalCreator(args: {
  organizationId: string;
  creatorId: string;
}) {
  const localCreator = await prisma.creator.findFirst({
    where: {
      id: args.creatorId,
      organizationId: args.organizationId,
    },
    select: {
      displayName: true,
      platformAccounts: {
        where: {
          platform: Platform.TIKTOK,
        },
        select: {
          handle: true,
        },
      },
    },
  });

  if (!localCreator) {
    return null;
  }

  const localHandles = new Set(
    (localCreator.platformAccounts as Array<{ handle: string }>)
      .map((account) => normalizeViewTallyHandle(account.handle))
      .filter((handle): handle is string => Boolean(handle)),
  );
  const localName = normalizeViewTallyName(localCreator.displayName);
  const trackedAccounts = await getTrackedTikTokAccounts();

  for (const account of trackedAccounts) {
    if (localHandles.has(normalizeViewTallyHandle(account.username) ?? "")) {
      return account.id;
    }
  }

  if (localName) {
    const nameMatches = trackedAccounts.filter(
      (account) => normalizeViewTallyName(account.displayName) === localName,
    );

    if (nameMatches.length === 1) {
      return nameMatches[0]?.id ?? null;
    }
  }

  return null;
}

async function getTrackedTikTokVideosUncached(args?: {
  search?: string;
}) {
  const records = await getPagedProviderRecords({
    path: "/videos/tracked",
    search: args?.search,
    perPage: 100,
    extraQuery: {
      platforms: "tiktok",
      viewMode: "internal",
    },
  });

  return records
    .map((record) => ({
      id: normalizeProviderText(record.id) ?? "",
      orgAccountId: normalizeProviderText(record.orgAccountId),
      platformVideoId: normalizeProviderText(record.platformVideoId) ?? "",
      platform: normalizeProviderText(record.platform) ?? "",
      username: normalizeProviderText(record.username),
      accountDisplayName: normalizeProviderText(record.accountDisplayName),
      createdAt: normalizeProviderText(record.createdAt),
    }))
    .filter((record) => record.platformVideoId.length > 0);
}

const getTrackedTikTokVideos = unstable_cache(
  async (search?: string) =>
    getTrackedTikTokVideosUncached(
      search
        ? {
            search,
          }
        : undefined,
    ),
  ["view-tally-tracked-tiktok-videos"],
  {
    revalidate: 900,
  },
);

function buildProviderAnalyticsQuery(args: {
  orgAccountId?: string | null;
  startDate: string;
  endDate: string;
}) {
  return {
    platforms: "tiktok",
    viewMode: "internal",
    publicationMode: "allEligible",
    onlyPublished: false,
    "dateRange[from]": args.startDate,
    "dateRange[to]": args.endDate,
    ...(args.orgAccountId
      ? {
          accounts: args.orgAccountId,
        }
      : {}),
  };
}

async function getProviderAnalyticsTopVideosUncached(args: {
  orgAccountId?: string | null;
  startDate: string;
  endDate: string;
  limit?: number;
}) {
  const response = await viralAppClient.request<unknown>({
    path: "/analytics/top-videos",
    query: {
      ...buildProviderAnalyticsQuery(args),
      metric: "viewCountInPeriod",
      limit: args.limit ?? 100,
    },
  });

  return getProviderAnalyticsRecords<ProviderAnalyticsVideoRecord>(response).filter(
    (record) => {
      const platform = normalizeProviderText(record.platform);
      return !platform || platform === "tiktok";
    },
  );
}

const getProviderAnalyticsTopVideos = unstable_cache(
  async (
    orgAccountId: string | null | undefined,
    startDate: string,
    endDate: string,
    limit?: number,
  ) =>
    getProviderAnalyticsTopVideosUncached({
      orgAccountId,
      startDate,
      endDate,
      limit,
    }),
  ["view-tally-provider-analytics-top-videos"],
  {
    revalidate: 300,
  },
);

async function getProviderAnalyticsTopAccountsUncached(args: {
  orgAccountId?: string | null;
  startDate: string;
  endDate: string;
  limit: number;
}) {
  const response = await viralAppClient.request<unknown>({
    path: "/analytics/top-accounts",
    query: {
      ...buildProviderAnalyticsQuery(args),
      metric: "viewCountInPeriod",
      limit: args.limit,
    },
  });

  return getProviderAnalyticsRecords<ProviderAnalyticsAccountRecord>(response);
}

const getProviderAnalyticsTopAccounts = unstable_cache(
  async (
    orgAccountId: string | null | undefined,
    startDate: string,
    endDate: string,
    limit: number,
  ) =>
    getProviderAnalyticsTopAccountsUncached({
      orgAccountId,
      startDate,
      endDate,
      limit,
    }),
  ["view-tally-provider-analytics-top-accounts"],
  {
    revalidate: 300,
  },
);

async function getProviderAnalyticsViewTotalUncached(args: {
  orgAccountId?: string | null;
  startDate: string;
  endDate: string;
}) {
  const response = await viralAppClient.request<unknown>({
    path: "/analytics/kpis",
    query: buildProviderAnalyticsQuery(args),
  });

  return extractProviderAnalyticsViewTotal(response);
}

const getProviderAnalyticsViewTotal = unstable_cache(
  async (
    orgAccountId: string | null | undefined,
    startDate: string,
    endDate: string,
  ) =>
    getProviderAnalyticsViewTotalUncached({
      orgAccountId,
      startDate,
      endDate,
    }),
  ["view-tally-provider-analytics-view-total"],
  {
    revalidate: 300,
  },
);

async function getTrackedTikTokVideoDetails(platformVideoId: string) {
  try {
    return await viralAppClient.request<TrackedTikTokVideoDetails>({
      path: `/videos/tiktok/${encodeURIComponent(platformVideoId)}`,
    });
  } catch (error) {
    if (!(error instanceof ViralAppApiError) || error.status !== 404) {
      throw error;
    }

    return await viralAppClient.request<TrackedTikTokVideoDetails>({
      path: `/live/tiktok/videos/${encodeURIComponent(platformVideoId)}`,
    });
  }
}

export function getReviewWindowStart(windowId: ReviewWindowId, now = new Date()) {
  const start = new Date(now);

  switch (windowId) {
    case "3d":
      start.setHours(start.getHours() - 72);
      return start;
    case "7d":
      start.setHours(start.getHours() - 168);
      return start;
    default:
      start.setHours(start.getHours() - 24);
      return start;
  }
}

function getSelectedReviewCampaignId(
  searchParams: DashboardSearchParams | undefined,
  campaignOptions: Array<{
    id: string;
    label: string;
  }>,
) {
  const rawValue = getSearchParamValue(searchParams, "campaign");
  const validCampaignIds = new Set(campaignOptions.map((campaign) => campaign.id));

  return rawValue && validCampaignIds.has(rawValue)
    ? rawValue
    : (campaignOptions[0]?.id ?? null);
}

export async function getOrganizationImportedVideosPage(args: {
  organizationSlug: string;
  searchParams?: DashboardSearchParams;
  page?: number;
}) {
  const shellData = await getOrganizationDashboardShellData(args.organizationSlug);
  const campaignOptions = shellData.campaigns.map((campaign) => ({
    id: campaign.id,
    label: campaign.name,
  }));
  const accessibleCampaignIds = campaignOptions.map((campaign) => campaign.id);
  const selectedCampaignIds = getSelectedIdsFromSearchParams(
    args.searchParams,
    "campaigns",
    accessibleCampaignIds,
  );
  const requestedPage =
    typeof args.page === "number" && Number.isInteger(args.page) && args.page > 0
      ? args.page
      : 1;
  const where = buildImportedVideoWhere({
    organizationId: shellData.membership.organizationId,
    canSeeAllOrganizationData: canManageOrganization(shellData.membership.role),
    accessibleCampaignIds,
    selectedCampaignIds,
  });
  const totalCount = await prisma.video.count({
    where,
  });
  const pageCount =
    totalCount > 0 ? Math.ceil(totalCount / IMPORTED_VIDEOS_PAGE_SIZE) : 0;
  const currentPage =
    pageCount === 0 ? 1 : Math.min(requestedPage, pageCount);
  const videos = totalCount
    ? await prisma.video.findMany({
        where,
        select: {
          id: true,
          videoUrl: true,
          titleOrCaption: true,
          platform: true,
          views: true,
          likes: true,
          comments: true,
          engagementRate: true,
          publishedAt: true,
          createdAt: true,
          rawPayload: true,
          campaign: {
            select: {
              id: true,
              name: true,
            },
          },
          creator: {
            select: {
              displayName: true,
            },
          },
          creatorPlatformAccount: {
            select: {
              handle: true,
              rawPayload: true,
            },
          },
        },
        orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
        skip: (currentPage - 1) * IMPORTED_VIDEOS_PAGE_SIZE,
        take: IMPORTED_VIDEOS_PAGE_SIZE,
      })
    : [];

  return {
    canTrackVideos: campaignOptions.length > 0,
    campaignOptions,
    currentPage,
    pageCount,
    pageSize: IMPORTED_VIDEOS_PAGE_SIZE,
    selectedCampaignIds,
    totalCount,
    videos: videos.map((video) => ({
      id: video.id,
      videoUrl: video.videoUrl,
      titleOrCaption: video.titleOrCaption,
      platform: video.platform,
      sourceLabel: getVideoDataSourceLabel(video.rawPayload),
      views: video.views,
      likes: video.likes,
      comments: video.comments,
      engagementRate: video.engagementRate,
      publishedAt: video.publishedAt,
      createdAt: video.createdAt,
      campaignId: video.campaign?.id ?? null,
      campaignName: video.campaign?.name ?? null,
      creatorName: video.creator.displayName,
      accountHandle: video.creatorPlatformAccount?.handle ?? null,
      thumbnailUrl:
        getVideoThumbnailUrl(video.rawPayload) ??
        getAccountImageUrl(video.rawPayload) ??
        getAccountImageUrl(video.creatorPlatformAccount?.rawPayload),
    })) satisfies ImportedVideoListItem[],
  };
}

async function getVideoTalkingStatusBySourceVideoId(args: {
  organizationId: string;
  rows: ViewTallyListItem[];
}) {
  const sourceVideoIds = [
    ...new Set(
      args.rows
        .map((row) => row.sourceVideoId)
        .filter((value): value is string => value.length > 0),
    ),
  ];

  if (sourceVideoIds.length === 0) {
    return new Map<string, boolean>();
  }

  const [classifications, localVideos] = await Promise.all([
    prisma.videoContentClassification.findMany({
      where: {
        organizationId: args.organizationId,
        platform: Platform.TIKTOK,
        sourceVideoId: {
          in: sourceVideoIds,
        },
      },
      select: {
        sourceVideoId: true,
        isTalking: true,
      },
    }),
    prisma.video.findMany({
      where: {
        platform: Platform.TIKTOK,
        sourceVideoId: {
          in: sourceVideoIds,
        },
        creator: {
          organizationId: args.organizationId,
        },
      },
      select: {
        sourceVideoId: true,
        isTalking: true,
      },
    }),
  ]);
  const statusBySourceVideoId = new Map<string, boolean>();

  for (const video of localVideos) {
    if (video.sourceVideoId) {
      statusBySourceVideoId.set(video.sourceVideoId, video.isTalking);
    }
  }

  for (const classification of classifications) {
    statusBySourceVideoId.set(
      classification.sourceVideoId,
      classification.isTalking,
    );
  }

  return statusBySourceVideoId;
}

export async function getOrganizationVideoManagerData(args: {
  organizationSlug: string;
  startDate: string;
  endDate: string;
  creatorId?: string | null;
}): Promise<OrganizationVideoManagerData> {
  const shellData = await getOrganizationDashboardShellData(args.organizationSlug);
  const canManageTalkingStatus = canReadOrganizationCampaignData(
    shellData.membership.role,
  );
  const viewTallyData = await getOrganizationViewTallyData({
    organizationSlug: args.organizationSlug,
    searchParams: {
      creator: args.creatorId ?? VIEW_TALLY_ALL_CREATORS_ID,
      startDate: args.startDate,
      endDate: args.endDate,
      topLimit: String(VIDEO_MANAGER_ROW_LIMIT),
    },
    includeAdSpend: false,
    includePaidViews: false,
    includeSummaryAnalytics: false,
    topVideoLimit: VIDEO_MANAGER_ROW_LIMIT,
  });
  const talkingStatusBySourceVideoId = await getVideoTalkingStatusBySourceVideoId({
    organizationId: shellData.membership.organizationId,
    rows: viewTallyData.rows,
  });
  const rows = viewTallyData.rows.map((video) => {
    const isTalking =
      talkingStatusBySourceVideoId.get(video.sourceVideoId) ?? true;

    return {
      id: video.id,
      sourceVideoId: video.sourceVideoId,
      videoUrl: video.videoUrl,
      titleOrCaption: video.titleOrCaption,
      platform: Platform.TIKTOK,
      views: video.views,
      likes: null,
      comments: null,
      publishedAt: video.publishedAt,
      createdAt: video.createdAt,
      isTalking,
      campaignId: null,
      campaignName: "View Tally",
      creatorId:
        viewTallyData.selectedCreator?.id ??
        video.accountHandle ??
        video.creatorName,
      creatorName: video.creatorName,
      accountHandle: video.accountHandle,
      thumbnailUrl: video.thumbnailUrl,
    } satisfies VideoManagerListItem;
  });
  const talkingCount = rows.filter((row) => row.isTalking).length;
  const nonTalkingCount = rows.length - talkingCount;

  return {
    creatorOptions: viewTallyData.creatorOptions,
    selectedCreatorId: viewTallyData.selectedCreator?.id ?? null,
    startDate: args.startDate,
    endDate: args.endDate,
    warnings: viewTallyData.warnings,
    errorMessage: viewTallyData.errorMessage,
    rows,
    totalCount: rows.length,
    rowLimit: VIDEO_MANAGER_ROW_LIMIT,
    isLimited: rows.length >= VIDEO_MANAGER_ROW_LIMIT,
    talkingCount,
    nonTalkingCount,
    canManageTalkingStatus,
  };
}

export async function getOrganizationCampaignReviewQueue(args: {
  organizationSlug: string;
  searchParams?: DashboardSearchParams;
}): Promise<OrganizationCampaignReviewQueue> {
  const shellData = await getOrganizationDashboardShellData(args.organizationSlug);
  const campaignOptions = shellData.campaigns.map((campaign) => ({
    id: campaign.id,
    label: campaign.name,
  }));
  const selectedWindowId = getSelectedReviewWindow(args.searchParams);
  const windowStartedAt = getReviewWindowStart(selectedWindowId);
  const selectedCampaignId = getSelectedReviewCampaignId(
    args.searchParams,
    campaignOptions,
  );
  const selectedCampaign =
    campaignOptions.find((campaign) => campaign.id === selectedCampaignId) ?? null;

  if (!selectedCampaign) {
    return {
      campaignOptions,
      selectedCampaign: null,
      selectedWindowId,
      windowStartedAt,
      pendingItems: [],
      reviewedItems: [],
      totalCount: 0,
      pendingCount: 0,
      reviewedCount: 0,
      completionPercent: 0,
      nextVideo: null,
    };
  }

  const videos = await prisma.video.findMany({
    where: {
      campaignId: selectedCampaign.id,
      creator: {
        organizationId: shellData.membership.organizationId,
      },
      lastSyncedAt: {
        not: null,
      },
      sourceVideoId: {
        not: null,
      },
      OR: [
        {
          publishedAt: {
            gte: windowStartedAt,
          },
        },
        {
          publishedAt: null,
          createdAt: {
            gte: windowStartedAt,
          },
        },
      ],
    },
    select: {
      id: true,
      videoUrl: true,
      titleOrCaption: true,
      platform: true,
      views: true,
      likes: true,
      comments: true,
      engagementRate: true,
      publishedAt: true,
      createdAt: true,
      rawPayload: true,
      creator: {
        select: {
          displayName: true,
        },
      },
      creatorPlatformAccount: {
        select: {
          handle: true,
          rawPayload: true,
        },
      },
      reviews: {
        where: {
          reviewerUserId: shellData.membership.userId,
        },
        select: {
          reviewedAt: true,
        },
        take: 1,
      },
    },
    orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
    take: 250,
  });

  const items: ReviewQueueVideoItem[] = videos.map((video) => ({
    id: video.id,
    videoUrl: video.videoUrl,
    titleOrCaption: video.titleOrCaption,
    platform: video.platform,
    views: video.views,
    likes: video.likes,
    comments: video.comments,
    engagementRate: video.engagementRate,
    publishedAt: video.publishedAt,
    createdAt: video.createdAt,
    creatorName: video.creator.displayName,
    accountHandle: video.creatorPlatformAccount?.handle ?? null,
    thumbnailUrl:
      getVideoThumbnailUrl(video.rawPayload) ??
      getAccountImageUrl(video.rawPayload) ??
      getAccountImageUrl(video.creatorPlatformAccount?.rawPayload),
    reviewedAt: video.reviews[0]?.reviewedAt ?? null,
  }));
  const pendingItems = items.filter((item) => item.reviewedAt === null);
  const reviewedItems = items
    .filter((item) => item.reviewedAt !== null)
    .sort(
      (left, right) =>
        (right.reviewedAt?.getTime() ?? 0) - (left.reviewedAt?.getTime() ?? 0),
    );

  return {
    campaignOptions,
    selectedCampaign,
    selectedWindowId,
    windowStartedAt,
    pendingItems,
    reviewedItems,
    totalCount: items.length,
    pendingCount: pendingItems.length,
    reviewedCount: reviewedItems.length,
    completionPercent:
      items.length === 0
        ? 0
        : Math.round((reviewedItems.length / items.length) * 100),
    nextVideo: pendingItems[0] ?? null,
  };
}

async function buildViewTallyAdSpendData(args: {
  organizationSlug: string;
  startDate: string;
  endDate: string;
  viewRows?: readonly ViewTallyListItem[];
}): Promise<OrganizationViewTallyData["adSpend"]> {
  try {
    const spendReport = await timeAsync(
      "view-tally.ad-spend.tiktok-report",
      {
        organizationSlug: args.organizationSlug,
        startDate: args.startDate,
        endDate: args.endDate,
      },
      () =>
        withTimeout(
          getAdSpendForOrganization({
            organizationSlug: args.organizationSlug,
            startDate: args.startDate,
            endDate: args.endDate,
            metadataRowLimit: VIEW_TALLY_SPEND_CONTENT_LOOKUP_LIMIT,
          }),
          VIEW_TALLY_AD_SPEND_TIMEOUT_MS,
          "TikTok ad spend lookup timed out. Keep this panel open; it will reuse cached results when TikTok finishes.",
        ),
    );
    const adSpendWarnings = [...spendReport.warnings];
    const spendRows = [...spendReport.rows].sort(
      (left, right) => right.spend - left.spend,
    );
    const viewRows = args.viewRows ?? [];
    const videosBySourceVideoId = new Map(
      viewRows.map((row) => [row.sourceVideoId, row]),
    );
    const videosByMatchedAdId = new Map<string, ViewTallyListItem[]>();
    const spendCandidateItemIds = uniqueNonEmptyStrings(
      spendRows
        .filter((row) => row.spend > 0)
        .flatMap((row) => [
          row.itemId,
          ...row.itemIds,
          ...row.resolvedPosts.map((post) => post.itemId),
        ]),
    ).slice(0, VIEW_TALLY_SPEND_CONTENT_LOOKUP_LIMIT);
    let spendContentVideoEntries: Array<
      readonly [string, ViewTallySpendContentVideo | null]
    > = [];

    try {
      spendContentVideoEntries = await timeAsync(
        "view-tally.ad-spend.viral-content-match",
        {
          organizationSlug: args.organizationSlug,
          candidateCount: spendCandidateItemIds.length,
        },
        () =>
          withTimeout(
            Promise.all(
              spendCandidateItemIds.map(async (sourceVideoId) => [
                sourceVideoId,
                await getViewTallySpendContentVideo(sourceVideoId).catch(
                  () => null,
                ),
              ] as const),
            ),
            VIEW_TALLY_SPEND_CONTENT_LOOKUP_TIMEOUT_MS,
            "Viral.app content matching lookup timed out before all ad rows could be resolved.",
          ),
      );
    } catch (error) {
      adSpendWarnings.push(
        error instanceof Error
          ? error.message
          : "Viral.app content matching lookup timed out before all ad rows could be resolved.",
      );
    }

    const spendContentVideosBySourceVideoId = new Map(
      spendContentVideoEntries.filter(
        (entry): entry is readonly [string, ViewTallySpendContentVideo] =>
          entry[1] !== null,
      ),
    );

    for (const row of viewRows) {
      for (const adId of row.matchedAdIds) {
        const existingVideos = videosByMatchedAdId.get(adId);

        if (existingVideos) {
          existingVideos.push(row);
        } else {
          videosByMatchedAdId.set(adId, [row]);
        }
      }
    }

    function mapSpendRow(row: TikTokAdSpendRow): ViewTallyAdSpendListItem {
      const candidateItemIds = uniqueNonEmptyStrings([
        row.itemId,
        ...row.itemIds,
        ...row.resolvedPosts.map((post) => post.itemId),
      ]);
      const exactItemMatch =
        candidateItemIds
          .map((itemId) => videosBySourceVideoId.get(itemId) ?? null)
          .find((video) => video !== null) ?? null;
      const spendContentMatch =
        !exactItemMatch
          ? (candidateItemIds
              .map((itemId) => spendContentVideosBySourceVideoId.get(itemId) ?? null)
              .find((video) => video !== null) ?? null)
          : null;
      const adMetadataMatch =
        !exactItemMatch && !spendContentMatch && row.adId
          ? (videosByMatchedAdId.get(row.adId)?.[0] ?? null)
          : null;
      const resolvedPost =
        row.resolvedPosts.find((post) => candidateItemIds.includes(post.itemId)) ??
        row.resolvedPosts[0] ??
        null;
      const matchedVideo = exactItemMatch ?? spendContentMatch ?? adMetadataMatch;

      return {
        key: row.key,
        adId: row.adId,
        itemId: row.itemId,
        itemIds: candidateItemIds,
        statDate: row.statDate,
        spend: row.spend,
        matchStatus:
          exactItemMatch ||
          (row.matchSource === "report_item_id" &&
            (row.itemId || spendContentMatch || resolvedPost))
            ? "exact_report_item_id"
            : spendContentMatch || row.matchSource === "tiktok_ad_metadata" || resolvedPost
              ? "exact_ad_metadata"
              : adMetadataMatch
                ? "matched_ad_id"
                : "unmatched",
        matchedVideo: matchedVideo
          ? {
              id: matchedVideo.id,
              titleOrCaption: matchedVideo.titleOrCaption,
              videoUrl: matchedVideo.videoUrl,
              sourceVideoId: matchedVideo.sourceVideoId,
              creatorName: matchedVideo.creatorName,
              accountHandle: matchedVideo.accountHandle,
              thumbnailUrl: matchedVideo.thumbnailUrl,
            }
          : resolvedPost
            ? {
                id: resolvedPost.itemId,
                titleOrCaption: resolvedPost.title,
                videoUrl: resolvedPost.shareUrl ?? `https://www.tiktok.com/video/${resolvedPost.itemId}`,
                sourceVideoId: resolvedPost.itemId,
                creatorName: "TikTok content",
                accountHandle: null,
                thumbnailUrl: resolvedPost.coverUrl ?? undefined,
              }
            : null,
      };
    }

    return {
      advertiserId: spendReport.advertiserId,
      totalSpend: spendReport.totalSpend,
      rowCount: spendReport.rowCount,
      rows: spendRows.map(mapSpendRow),
      warnings: adSpendWarnings,
    };
  } catch (error) {
    return {
      advertiserId: null,
      totalSpend: 0,
      rowCount: 0,
      rows: [],
      warnings: [
        error instanceof Error
          ? error.message
          : "Could not load TikTok ad spend for this date window.",
      ],
    };
  }
}

export async function getOrganizationViewTallyAdSpendData(args: {
  organizationSlug: string;
  searchParams?: DashboardSearchParams;
}): Promise<OrganizationViewTallyAdSpendData> {
  const { startDate, endDate } = getViewTallyDateRange(args.searchParams);

  return {
    startDate,
    endDate,
    adSpend: await buildViewTallyAdSpendData({
      organizationSlug: args.organizationSlug,
      startDate,
      endDate,
    }),
  };
}

export async function getOrganizationViewTallyData(args: {
  organizationSlug: string;
  organizationId?: string;
  searchParams?: DashboardSearchParams;
  includeAdSpend?: boolean;
  includePaidViews?: boolean;
  includeSummaryAnalytics?: boolean;
  topVideoLimit?: number;
}): Promise<OrganizationViewTallyData> {
  const organizationId =
    args.organizationId ??
    (
      await timeAsync(
        "view-tally.shell",
        {
          organizationSlug: args.organizationSlug,
        },
        () => getOrganizationDashboardShellData(args.organizationSlug),
      )
    ).membership.organizationId;
  let warnings: string[] = [];
  let errorMessage: string | null = null;
  let trackedAccounts: TrackedTikTokAccountRecord[] = [];

  try {
    trackedAccounts = await timeAsync(
      "view-tally.tracked-accounts",
      {
        organizationSlug: args.organizationSlug,
      },
      () => getTrackedTikTokAccounts(),
    );
  } catch (error) {
    errorMessage =
      error instanceof Error
        ? error.message
        : "Could not load tracked TikTok creators from viral.app.";
  }

  const creatorOptions = trackedAccounts
    .map((account) => ({
      id: account.id,
      label: account.displayName ?? (account.username ? `@${account.username}` : "Tracked TikTok creator"),
      meta: account.username ? `@${account.username}` : undefined,
      totalVideosTracked: account.totalVideosTracked ?? 0,
      username: account.username,
    }))
    .sort((left, right) => {
      if (right.totalVideosTracked !== left.totalVideosTracked) {
        return right.totalVideosTracked - left.totalVideosTracked;
      }

      return left.label.localeCompare(right.label);
    })
    .map(({ id, label, meta, username }) => ({
      id,
      label,
      meta: meta ?? (username ? `@${username}` : undefined),
    }));

  if (creatorOptions.length === 0) {
    let trackedVideos: TrackedTikTokVideoRecord[] = [];

    try {
      trackedVideos = await timeAsync(
        "view-tally.tracked-videos-fallback",
        {
          organizationSlug: args.organizationSlug,
        },
        () => getTrackedTikTokVideos(),
      );
    } catch (error) {
      errorMessage ??=
        error instanceof Error
          ? error.message
          : "Could not load tracked TikTok creators from viral.app.";
    }

    if (trackedVideos.length > 0) {
      const fallbackCreatorMap = new Map<
        string,
        (typeof creatorOptions)[number]
      >();

      for (const video of trackedVideos) {
        const username = video.username;
        const id = video.orgAccountId ?? username ?? video.platformVideoId;

        if (fallbackCreatorMap.has(id)) {
          continue;
        }

        fallbackCreatorMap.set(id, {
          id,
          label:
            video.accountDisplayName ??
            (username ? `@${username}` : "Tracked TikTok creator"),
          meta: username ? `@${username}` : undefined,
        });
      }

      creatorOptions.push(...fallbackCreatorMap.values());
    }
  }

  const selectedCreatorId = getSelectedViewTallyCreatorId(
    args.searchParams,
    creatorOptions,
  );
  const isAllCreatorsSelected = selectedCreatorId === VIEW_TALLY_ALL_CREATORS_ID;
  const selectedCreator = isAllCreatorsSelected
    ? null
    : (creatorOptions.find((creator) => creator.id === selectedCreatorId) ?? null);
  const selectedTrackedAccount =
    !isAllCreatorsSelected && selectedCreatorId
      ? (trackedAccounts.find((account) => account.id === selectedCreatorId) ?? null)
      : null;
  const { startDate, endDate } = getViewTallyDateRange(args.searchParams);
  const topLimit = getSelectedViewTallyTopLimit(args.searchParams);

  if (!isAllCreatorsSelected && !selectedCreator) {
    return {
      creatorOptions,
      selectedCreator: null,
      startDate,
      endDate,
      warnings,
      errorMessage,
      topLimit,
      topLimitOptions: [...VIEW_TALLY_TOP_LIMIT_OPTIONS],
      rows: [],
      topVideos: [],
      topAccounts: [],
      adSpend: {
        advertiserId: null,
        totalSpend: 0,
        rowCount: 0,
        rows: [],
        warnings: [],
      },
      totals: {
        videos: 0,
        totalViews: 0,
        paidViews: 0,
        deductedPaidViews: 0,
        unpaidViews: 0,
        organicViewsEstimate: 0,
        yesVideos: 0,
        noVideos: 0,
        unknownVideos: 0,
        unsupportedVideos: 0,
      },
    };
  }

  const startBoundary = parseDateOnlyString(startDate);
  const endBoundary = parseDateOnlyString(endDate);

  if (!startBoundary || !endBoundary) {
    return {
      creatorOptions,
      selectedCreator,
      startDate,
      endDate,
      warnings: [],
      errorMessage: "The selected date range was invalid.",
      topLimit,
      topLimitOptions: [...VIEW_TALLY_TOP_LIMIT_OPTIONS],
      rows: [],
      topVideos: [],
      topAccounts: [],
      adSpend: {
        advertiserId: null,
        totalSpend: 0,
        rowCount: 0,
        rows: [],
        warnings: [],
      },
      totals: {
        videos: 0,
        totalViews: 0,
        paidViews: 0,
        deductedPaidViews: 0,
        unpaidViews: 0,
        organicViewsEstimate: 0,
        yesVideos: 0,
        noVideos: 0,
        unknownVideos: 0,
        unsupportedVideos: 0,
      },
    };
  }

  const selectedAnalyticsOrgAccountId = isAllCreatorsSelected
    ? null
    : selectedCreator?.id ?? null;
  const trackedAccountsById = new Map(
    trackedAccounts.map((account) => [account.id, account]),
  );
  const creatorOptionsById = new Map(
    creatorOptions.map((creator) => [creator.id, creator]),
  );
  const includeSummaryAnalytics = args.includeSummaryAnalytics !== false;
  let analyticsViewTotal: number | null = null;
  let analyticsTopVideoRecords: ProviderAnalyticsVideoRecord[] = [];
  let analyticsTopAccountRecords: ProviderAnalyticsAccountRecord[] = [];

  if (includeSummaryAnalytics) {
    const [
      analyticsViewTotalResult,
      analyticsTopVideoRecordsResult,
      analyticsTopAccountRecordsResult,
    ] = await timeAsync(
      "view-tally.viral-analytics",
      {
        organizationSlug: args.organizationSlug,
        selectedCreatorId: selectedAnalyticsOrgAccountId,
        startDate,
        endDate,
        topLimit,
        includeSummaryAnalytics,
      },
      () =>
        Promise.allSettled([
          getProviderAnalyticsViewTotal(
            selectedAnalyticsOrgAccountId,
            startDate,
            endDate,
          ),
          getProviderAnalyticsTopVideos(
            selectedAnalyticsOrgAccountId,
            startDate,
            endDate,
            args.topVideoLimit,
          ),
          getProviderAnalyticsTopAccounts(
            selectedAnalyticsOrgAccountId,
            startDate,
            endDate,
            topLimit,
          ),
        ]),
    );

    if (analyticsViewTotalResult.status === "fulfilled") {
      analyticsViewTotal = analyticsViewTotalResult.value;
    } else {
      const error = analyticsViewTotalResult.reason;
      warnings.push(
        error instanceof Error
          ? `Could not load viral.app period view total: ${error.message}`
          : "Could not load viral.app period view total.",
      );
    }

    if (analyticsTopVideoRecordsResult.status === "fulfilled") {
      analyticsTopVideoRecords = analyticsTopVideoRecordsResult.value;
    } else {
      const error = analyticsTopVideoRecordsResult.reason;
      errorMessage ??=
        error instanceof Error
          ? error.message
          : "Could not load viral.app period video gains.";
    }

    if (analyticsTopAccountRecordsResult.status === "fulfilled") {
      analyticsTopAccountRecords = analyticsTopAccountRecordsResult.value;
    } else {
      const error = analyticsTopAccountRecordsResult.reason;
      warnings.push(
        error instanceof Error
          ? `Could not load viral.app period account gains: ${error.message}`
          : "Could not load viral.app period account gains.",
      );
    }
  } else {
    try {
      analyticsTopVideoRecords = await timeAsync(
        "view-tally.viral-analytics-top-videos",
        {
          organizationSlug: args.organizationSlug,
          selectedCreatorId: selectedAnalyticsOrgAccountId,
          startDate,
          endDate,
        },
        () =>
          getProviderAnalyticsTopVideos(
            selectedAnalyticsOrgAccountId,
            startDate,
            endDate,
            args.topVideoLimit,
          ),
      );
    } catch (error) {
      errorMessage ??=
        error instanceof Error
          ? error.message
          : "Could not load viral.app period video gains.";
    }
  }

  const videos = timeSync(
    "view-tally.map-viral-videos",
    {
      organizationSlug: args.organizationSlug,
      analyticsVideoCount: analyticsTopVideoRecords.length,
      trackedAccountCount: trackedAccounts.length,
    },
    () => {
      const seenAnalyticsSourceVideoIds = new Set<string>();

      return analyticsTopVideoRecords
        .map((video) => {
      const sourceVideoId =
        normalizeProviderText(video.platformVideoId) ??
        normalizeProviderText(video.platform_video_id) ??
        normalizeProviderText(video.platformVideo_id) ??
        normalizeProviderText(video.id);

      if (!sourceVideoId || seenAnalyticsSourceVideoIds.has(sourceVideoId)) {
        return null;
      }

      seenAnalyticsSourceVideoIds.add(sourceVideoId);

      const orgAccountId =
        normalizeProviderText(video.orgAccountId) ??
        normalizeProviderText(video.org_account_id);
      const trackedAccount = orgAccountId
        ? (trackedAccountsById.get(orgAccountId) ?? null)
        : selectedTrackedAccount;
      const accountHandle =
        normalizeProviderText(video.accountUsername) ??
        normalizeProviderText(video.account_username) ??
        trackedAccount?.username ??
        selectedCreator?.meta?.replace(/^@/, "") ??
        null;
      const creator =
        (orgAccountId ? creatorOptionsById.get(orgAccountId) : null) ??
        selectedCreator ??
        {
          id: orgAccountId ?? accountHandle ?? sourceVideoId,
          label:
            normalizeProviderText(video.accountDisplayName) ??
            normalizeProviderText(video.account_display_name) ??
            trackedAccount?.displayName ??
            (accountHandle ? `@${accountHandle}` : "Tracked TikTok creator"),
          meta: accountHandle ? `@${accountHandle}` : undefined,
        };
      const publishedAt =
        parseProviderDate(video.publishedAt) ??
        parseProviderDate(video.published_at);
      const createdAt =
        publishedAt ??
        parseProviderDate(video.createdAt) ??
        parseProviderDate(video.created_at) ??
        new Date(0);

      return {
        id: normalizeProviderText(video.id) ?? sourceVideoId,
        sourceVideoId,
        videoUrl: buildTrackedTikTokVideoUrl({
          platformVideoId: sourceVideoId,
          username: accountHandle,
        }),
        titleOrCaption:
          normalizeProviderText(video.caption) ?? normalizeProviderText(video.title),
        publishedAt,
        createdAt,
        views: getAnalyticsPeriodViewCount(video),
        currentViews: getAnalyticsCurrentViewCount(video),
        creatorName:
          normalizeProviderText(video.accountDisplayName) ??
          normalizeProviderText(video.account_display_name) ??
          trackedAccount?.displayName ??
          creator.label,
        accountHandle,
        thumbnailUrl:
          normalizeImageUrl(
            normalizeProviderText(video.thumbnailUrl) ??
              normalizeProviderText(video.thumbnail_url),
          ) ??
          normalizeImageUrl(
            normalizeProviderText(video.accountProfilePictureUrl) ??
              normalizeProviderText(video.account_profile_picture_url),
          ),
        selectedCreator: creator,
        selectedTrackedAccount: trackedAccount,
        selectedCreatorUsername: accountHandle,
      };
    })
    .filter((video): video is NonNullable<typeof video> => video !== null)
        .sort((left, right) => (right.views ?? 0) - (left.views ?? 0));
    },
  );

  const paidRowsBySourceVideoId = new Map<
    string,
    {
      paidViews: number;
      paidStatus: TikTokVideoPaidStatus;
      paidStatusReason: TikTokVideoPaidStatusReason;
      matchedSparkItemIds: string[];
      matchedAdIds: string[];
      unresolvedPostBackedAdIds: string[];
      unresolvedNonPostBackedAdIds: string[];
      unresolvedPostBackedGroupCount: number;
      unresolvedNonPostBackedGroupCount: number;
      attributionSources: TikTokVideoPaidAttributionSource[];
    }
  >();
  const lookupWindowDetailsBySourceVideoId = new Map<
    string,
    {
      unresolvedPostBackedGroupCount: number;
      unresolvedNonPostBackedGroupCount: number;
    }
  >();
  let lookupWindowUnresolvedPostBackedGroupCount = 0;
  let lookupWindowUnresolvedNonPostBackedGroupCount = 0;

  if (videos.length > 0 && args.includePaidViews !== false) {
    const paidLookupGroups = new Map<
      string,
      {
        selectedCreator: ViewTallyCreatorOption;
        selectedTrackedAccount: TrackedTikTokAccountRecord | null;
        selectedCreatorUsername: string | null;
        sourceVideoIds: string[];
      }
    >();

    for (const video of videos) {
      const existingGroup =
        paidLookupGroups.get(video.selectedCreator.id) ??
        {
          selectedCreator: video.selectedCreator,
          selectedTrackedAccount: video.selectedTrackedAccount,
          selectedCreatorUsername: video.selectedCreatorUsername,
          sourceVideoIds: [],
        };

      existingGroup.sourceVideoIds.push(video.sourceVideoId);
      paidLookupGroups.set(video.selectedCreator.id, existingGroup);
    }

    const paidLookupResults = await mapWithConcurrency(
      [...paidLookupGroups.values()],
      4,
      async (group) => {
        try {
          const sourceVideoIds = [...new Set(group.sourceVideoIds)];
          const paidLookupCreatorId = await resolveViewTallyPaidLookupCreatorId({
            organizationId,
            selectedCreator: group.selectedCreator,
            selectedTrackedAccount: group.selectedTrackedAccount,
            selectedCreatorUsername: group.selectedCreatorUsername,
            sourceVideoIds,
          });

          if (!paidLookupCreatorId) {
            return {
              errorMessage: null,
              lookupDetails: [],
              rows: [],
              unresolvedNonPostBackedGroupCount: 0,
              unresolvedPostBackedGroupCount: 0,
              warnings: [
                `Could not associate ${group.selectedCreator.label} with a local creator record, so paid TikTok delivery cannot be attributed to these View Tally rows.`,
              ],
            };
          }

          const paidReport =
            await getPaidViewsForSourceVideosForCreatorForOrganization({
              organizationSlug: args.organizationSlug,
              organizationId: args.organizationId,
              creatorId: paidLookupCreatorId,
              sourceVideoIds,
              startDate,
              endDate,
            });

          return {
            errorMessage: null,
            lookupDetails: sourceVideoIds.map((sourceVideoId) => [
              sourceVideoId,
              {
                unresolvedPostBackedGroupCount:
                  paidReport.unresolvedPostBackedGroupCount,
                unresolvedNonPostBackedGroupCount:
                  paidReport.unresolvedNonPostBackedGroupCount,
              },
            ] as const),
            rows: paidReport.rows,
            unresolvedNonPostBackedGroupCount:
              paidReport.unresolvedNonPostBackedGroupCount,
            unresolvedPostBackedGroupCount:
              paidReport.unresolvedPostBackedGroupCount,
            warnings: paidReport.warnings,
          };
        } catch (error) {
          return {
            errorMessage:
              error instanceof Error
                ? error.message
                : "Could not resolve paid TikTok impressions for these videos right now.",
            lookupDetails: [],
            rows: [],
            unresolvedNonPostBackedGroupCount: 0,
            unresolvedPostBackedGroupCount: 0,
            warnings: [],
          };
        }
      },
    );

    for (const result of paidLookupResults) {
      warnings = [...warnings, ...result.warnings];
      errorMessage ??= result.errorMessage;
      lookupWindowUnresolvedPostBackedGroupCount +=
        result.unresolvedPostBackedGroupCount;
      lookupWindowUnresolvedNonPostBackedGroupCount +=
        result.unresolvedNonPostBackedGroupCount;

      for (const [sourceVideoId, details] of result.lookupDetails) {
        lookupWindowDetailsBySourceVideoId.set(sourceVideoId, details);
      }

      for (const row of result.rows) {
        paidRowsBySourceVideoId.set(row.sourceVideoId, {
          paidViews: row.paidViews,
          paidStatus: row.paidStatus,
          paidStatusReason: row.paidStatusReason,
          matchedSparkItemIds: row.matchedSparkItemIds,
          matchedAdIds: row.matchedAdIds,
          unresolvedPostBackedAdIds: row.unresolvedPostBackedAdIds,
          unresolvedNonPostBackedAdIds: row.unresolvedNonPostBackedAdIds,
          unresolvedPostBackedGroupCount: row.unresolvedPostBackedGroupCount,
          unresolvedNonPostBackedGroupCount:
            row.unresolvedNonPostBackedGroupCount,
          attributionSources: row.attributionSources,
        });
      }
    }
  }

  const rows = videos.map((video) => {
    const paidRow = paidRowsBySourceVideoId.get(video.sourceVideoId) ?? null;
    const lookupWindowDetails =
      lookupWindowDetailsBySourceVideoId.get(video.sourceVideoId) ?? null;
    const isExactPostAnswerKnown =
      paidRow?.paidStatus === "yes" || paidRow?.paidStatus === "no";
    const paidViews = isExactPostAnswerKnown ? (paidRow?.paidViews ?? 0) : null;
    const organicViewsEstimate =
      typeof video.views === "number" && typeof paidViews === "number"
        ? Math.max(video.views - paidViews, 0)
        : null;

    return {
      id: video.id,
      sourceVideoId: video.sourceVideoId,
      videoUrl: video.videoUrl,
      titleOrCaption: video.titleOrCaption,
      publishedAt: video.publishedAt,
      createdAt: video.createdAt,
      views: video.views,
      currentViews: video.currentViews,
      paidViews,
      organicViewsEstimate,
      paidStatus: paidRow?.paidStatus ?? "unknown",
      paidStatusReason: paidRow?.paidStatusReason ?? "unresolved_post_mapping",
      matchedSparkItemIds: paidRow?.matchedSparkItemIds ?? [],
      matchedAdIds: paidRow?.matchedAdIds ?? [],
      unresolvedPostBackedAdIds: paidRow?.unresolvedPostBackedAdIds ?? [],
      unresolvedNonPostBackedAdIds: paidRow?.unresolvedNonPostBackedAdIds ?? [],
      unresolvedPostBackedGroupCount: paidRow?.unresolvedPostBackedGroupCount ?? 0,
      unresolvedNonPostBackedGroupCount: paidRow?.unresolvedNonPostBackedGroupCount ?? 0,
      lookupWindowUnresolvedPostBackedGroupCount:
        lookupWindowDetails?.unresolvedPostBackedGroupCount ??
        lookupWindowUnresolvedPostBackedGroupCount,
      lookupWindowUnresolvedNonPostBackedGroupCount:
        lookupWindowDetails?.unresolvedNonPostBackedGroupCount ??
        lookupWindowUnresolvedNonPostBackedGroupCount,
      attributionSources: paidRow?.attributionSources ?? [],
      creatorName: video.creatorName,
      accountHandle: video.accountHandle,
      thumbnailUrl: video.thumbnailUrl,
    } satisfies ViewTallyListItem;
  });
  const topVideos = [...rows]
    .sort(
      (left, right) =>
        getNetViewCount(right) - getNetViewCount(left),
    )
    .slice(0, topLimit);
  const accountRows = new Map<string, ViewTallyTopAccount>();

  for (const row of rows) {
    const accountKey = row.accountHandle ?? row.creatorName;
    const existingAccount =
      accountRows.get(accountKey) ??
      {
        id: accountKey,
        label: row.creatorName,
        handle: row.accountHandle,
        views: 0,
        paidViews: 0,
        videos: 0,
        avatarUrl: row.thumbnailUrl,
      };

    existingAccount.views += row.views ?? 0;
    existingAccount.paidViews += row.paidViews ?? 0;
    existingAccount.videos += 1;
    existingAccount.avatarUrl ??= row.thumbnailUrl;
    accountRows.set(accountKey, existingAccount);
  }

  const providerTopAccounts = analyticsTopAccountRecords
    .map((account) => {
      const id =
        normalizeProviderText(account.orgAccountId) ??
        normalizeProviderText(account.org_account_id) ??
        normalizeProviderText(account.id) ??
        "";
      const handle =
        normalizeProviderText(account.username) ??
        normalizeProviderText(account.accountUsername) ??
        normalizeProviderText(account.account_username);
      const label =
        normalizeProviderText(account.displayName) ??
        normalizeProviderText(account.accountDisplayName) ??
        normalizeProviderText(account.account_display_name) ??
        (handle ? `@${handle}` : "Tracked TikTok creator");
      const accountKey = handle ?? label;
      const rowAccount = accountRows.get(accountKey) ?? accountRows.get(label) ?? null;

      return {
        id: id || accountKey,
        label,
        handle,
        views: getAnalyticsPeriodViewCount(account) ?? 0,
        paidViews: rowAccount?.paidViews ?? 0,
        videos:
          normalizeProviderNumber(account.videoCountInPeriod) ??
          normalizeProviderNumber(account.video_count_in_period) ??
          rowAccount?.videos ??
          0,
        avatarUrl:
          normalizeImageUrl(
            normalizeProviderText(account.profilePictureUrl) ??
              normalizeProviderText(account.accountProfilePictureUrl) ??
              normalizeProviderText(account.account_profile_picture_url),
          ) ?? rowAccount?.avatarUrl,
      } satisfies ViewTallyTopAccount;
    })
    .filter((account) => account.views > 0)
    .sort(
      (left, right) =>
        getNetViewCount(right) - getNetViewCount(left),
    );

  const topAccounts =
    providerTopAccounts.length > 0
      ? providerTopAccounts.slice(0, topLimit)
      : [...accountRows.values()]
          .sort(
            (left, right) =>
              getNetViewCount(right) - getNetViewCount(left),
          )
          .slice(0, topLimit);
  let adSpend: OrganizationViewTallyData["adSpend"] = {
    advertiserId: null,
    totalSpend: 0,
    rowCount: 0,
    rows: [],
    warnings: [],
  };

  if (args.includeAdSpend !== false) {
    adSpend = await buildViewTallyAdSpendData({
      organizationSlug: args.organizationSlug,
      startDate,
      endDate,
      viewRows: rows,
    });
  }

  const paidViewsTotal = rows.reduce(
    (total, row) => total + (row.paidViews ?? 0),
    0,
  );
  const deductedPaidViews = rows.reduce(
    (total, row) =>
      row.paidStatus === "yes" ? total + (row.paidViews ?? 0) : total,
    0,
  );
  const totalViews =
    analyticsViewTotal ??
    rows.reduce((total, row) => total + (row.views ?? 0), 0);
  const unpaidViews = Math.max(totalViews - deductedPaidViews, 0);

  return {
    creatorOptions,
    selectedCreator,
    startDate,
    endDate,
    warnings,
    errorMessage,
    topLimit,
    topLimitOptions: [...VIEW_TALLY_TOP_LIMIT_OPTIONS],
    rows,
    topVideos,
    topAccounts,
    adSpend,
    totals: {
      videos: rows.length,
      totalViews,
      paidViews: paidViewsTotal,
      deductedPaidViews,
      unpaidViews,
      organicViewsEstimate: rows.reduce(
        (total, row) => total + (row.organicViewsEstimate ?? 0),
        0,
      ),
      yesVideos: rows.filter((row) => row.paidStatus === "yes").length,
      noVideos: rows.filter((row) => row.paidStatus === "no").length,
      unknownVideos: rows.filter((row) => row.paidStatus === "unknown").length,
      unsupportedVideos: rows.filter((row) => row.paidStatus === "unsupported").length,
    },
  };
}

function buildImportedVideoWhere(args: {
  organizationId: string;
  canSeeAllOrganizationData: boolean;
  accessibleCampaignIds: string[];
  selectedCampaignIds: string[];
}): Prisma.VideoWhereInput {
  if (
    args.accessibleCampaignIds.length > 0 &&
    args.selectedCampaignIds.length === 0
  ) {
    return {
      id: {
        in: [],
      },
    };
  }

  if (
    !args.canSeeAllOrganizationData &&
    args.accessibleCampaignIds.length === 0
  ) {
    return {
      id: {
        in: [],
      },
    };
  }

  const where: Prisma.VideoWhereInput = {
    creator: {
      organizationId: args.organizationId,
    },
    lastSyncedAt: {
      not: null,
    },
    sourceVideoId: {
      not: null,
    },
  };

  if (!args.canSeeAllOrganizationData) {
    where.campaignId = {
      in: args.accessibleCampaignIds,
    };
  }

  if (
    args.accessibleCampaignIds.length > 0 &&
    args.selectedCampaignIds.length < args.accessibleCampaignIds.length
  ) {
    where.campaignId = {
      in: args.selectedCampaignIds,
    };
  }

  return where;
}

function normalizeImageUrl(value: string | null | undefined) {
  if (!value) {
    return undefined;
  }

  try {
    const url = new URL(value);

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return undefined;
    }

    return url.toString();
  } catch {
    return undefined;
  }
}

function getJsonString(
  value: Prisma.JsonValue | null | undefined,
  keys: string[],
): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  for (const key of keys) {
    const candidate = value[key];

    if (typeof candidate === "string" && candidate.length > 0) {
      return candidate;
    }
  }

  return undefined;
}

function getAccountImageUrl(payload: Prisma.JsonValue | null | undefined) {
  return normalizeImageUrl(
    getJsonString(payload, [
      "profilePictureUrl",
      "accountProfilePictureUrl",
      "creatorImage",
      "profile_picture_url",
      "account_profile_picture_url",
    ]),
  );
}

function getVideoThumbnailUrl(payload: Prisma.JsonValue | null | undefined) {
  return normalizeImageUrl(
    getJsonString(payload, [
      "thumbnailUrl",
      "thumbnail_url",
      "previewImageUrl",
      "preview_image_url",
    ]),
  );
}
