import { type Prisma } from "@prisma/client";

import type {
  MetricCardData,
  MetricChartSeries,
  OverviewMockData,
  TopAccountItem,
  TopVideoItem,
} from "@/components/org-dashboard/mock-data";
import { prisma } from "@/lib/db";
import { canManageOrganization } from "@/server/auth/roles";

import {
  dashboardDateRangeOptions,
  formatPlatformLabel,
  getDateRangeStart,
  getSelectedDateRange,
  getSelectedIdsFromSearchParams,
  type DashboardSearchParams,
} from "./filters";
import { getOrganizationDashboardShellData } from "./org-shell";

const accountAccentGradients = [
  "linear-gradient(135deg, rgba(144,255,77,0.96), rgba(19,202,45,0.78))",
  "linear-gradient(135deg, rgba(124,255,176,0.96), rgba(44,198,117,0.78))",
  "linear-gradient(135deg, rgba(121,168,255,0.96), rgba(124,125,255,0.78))",
  "linear-gradient(135deg, rgba(248,201,114,0.96), rgba(239,139,53,0.8))",
  "linear-gradient(135deg, rgba(255,181,122,0.96), rgba(255,107,90,0.8))",
];

const shortDateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
});

function formatCompactNumber(value: number) {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: value >= 1_000_000 ? 1 : 0,
  }).format(value);
}

function formatPercent(value: number) {
  return `${value.toFixed(1)}%`;
}

function formatSignedCompactNumber(value: number) {
  if (value === 0) {
    return "0";
  }

  const prefix = value > 0 ? "+" : "-";
  return `${prefix}${formatCompactNumber(Math.abs(value))}`;
}

function formatSignedPercent(value: number) {
  if (value === 0) {
    return "0%";
  }

  const prefix = value > 0 ? "+" : "-";
  return `${prefix}${Math.abs(value).toFixed(1)}%`;
}

function getPercentChange(currentValue: number, previousValue: number) {
  if (previousValue === 0) {
    return currentValue === 0 ? 0 : 100;
  }

  return ((currentValue - previousValue) / previousValue) * 100;
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

function createMetricCard(args: {
  label: string;
  currentValue: number;
  previousValue: number;
  icon: MetricCardData["icon"];
  formatter: (value: number) => string;
}): MetricCardData {
  const delta = args.currentValue - args.previousValue;

  return {
    label: args.label,
    value: args.formatter(args.currentValue),
    delta: args.formatter === formatPercent ? formatSignedPercent(delta) : formatSignedCompactNumber(delta),
    direction: delta >= 0 ? "up" : "down",
    icon: args.icon,
  };
}

function buildDateKeys(startDate: Date, endDate: Date) {
  const dateKeys: string[] = [];
  const cursor = new Date(startDate);

  while (cursor <= endDate) {
    dateKeys.push(cursor.toISOString().slice(0, 10));
    cursor.setDate(cursor.getDate() + 1);
  }

  return dateKeys;
}

function createDayBucketMap(dateKeys: string[]) {
  return new Map(
    dateKeys.map((dateKey) => [
      dateKey,
      {
        views: 0,
        likes: 0,
        videos: 0,
        engagementTotal: 0,
        engagementCount: 0,
      },
    ]),
  );
}

function buildAxisLabels(
  maxValue: number,
  formatter: (value: number) => string,
) {
  const normalizedMax = Math.max(maxValue, 1);

  return [
    formatter(normalizedMax),
    formatter(normalizedMax / 2),
    formatter(0),
  ];
}

function buildMetricSeries(args: {
  id: string;
  label: string;
  summary: string;
  values: number[];
  dateKeys: string[];
  formatter: (value: number) => string;
}): MetricChartSeries {
  const maxValue = Math.max(...args.values, 0);

  return {
    id: args.id,
    label: args.label,
    summary: args.summary,
    axisLabels: buildAxisLabels(maxValue, args.formatter),
    points: args.values.map((value, index) => ({
      label: args.dateKeys[index] ?? "",
      shortLabel: shortDateFormatter.format(new Date(args.dateKeys[index] ?? "")),
      value,
      highlight: value === maxValue && maxValue > 0,
    })),
  };
}

function buildVideoScope(args: {
  organizationId: string;
  canSeeAllOrganizationData: boolean;
  accessibleCampaignIds: string[];
  selectedCampaignIds: string[];
}): Prisma.VideoWhereInput {
  const baseScope: Prisma.VideoWhereInput = args.canSeeAllOrganizationData
    ? {
        creator: {
          organizationId: args.organizationId,
        },
      }
    : args.accessibleCampaignIds.length > 0
      ? {
          creator: {
            organizationId: args.organizationId,
          },
          campaignId: {
            in: args.accessibleCampaignIds,
          },
        }
      : {
          id: {
            in: [],
          },
        };

  if (args.accessibleCampaignIds.length > 0 && args.selectedCampaignIds.length === 0) {
    return {
      id: {
        in: [],
      },
    };
  }

  if (
    args.accessibleCampaignIds.length > 0 &&
    args.selectedCampaignIds.length < args.accessibleCampaignIds.length
  ) {
    baseScope.campaignId = {
      in: args.selectedCampaignIds,
    };
  }

  return baseScope;
}

export async function getOrganizationOverviewData(args: {
  organizationSlug: string;
  searchParams?: DashboardSearchParams;
}): Promise<OverviewMockData> {
  const { organizationSlug, searchParams } = args;
  const shellData = await getOrganizationDashboardShellData(organizationSlug);
  const campaignOptions = shellData.campaigns.map((campaign) => ({
    id: campaign.id,
    label: campaign.name,
  }));
  const accountOptions: OverviewMockData["accountOptions"] = [];
  const selectedCampaignIds = getSelectedIdsFromSearchParams(
    searchParams,
    "campaigns",
    campaignOptions.map((campaign) => campaign.id),
  );
  const selectedDateRange = getSelectedDateRange(searchParams);
  const rangeStart = getDateRangeStart(selectedDateRange);
  const rangeEnd = new Date();
  const windowLengthInDays =
    Math.floor((rangeEnd.getTime() - rangeStart.getTime()) / 86_400_000) + 1;
  const previousWindowStart = new Date(rangeStart);
  previousWindowStart.setDate(previousWindowStart.getDate() - windowLengthInDays);
  const previousWindowEnd = new Date(rangeStart);
  previousWindowEnd.setMilliseconds(previousWindowEnd.getMilliseconds() - 1);
  const canSeeAllOrganizationData = canManageOrganization(shellData.membership.role);
  const videoScope = buildVideoScope({
    organizationId: shellData.membership.organizationId,
    canSeeAllOrganizationData,
    accessibleCampaignIds: campaignOptions.map((campaign) => campaign.id),
    selectedCampaignIds,
  });
  const dateKeys = buildDateKeys(rangeStart, rangeEnd);
  const videoWindowWhere: Prisma.VideoWhereInput = {
    ...videoScope,
    publishedAt: {
      gte: previousWindowStart,
      lte: rangeEnd,
    },
  };
  const currentWindowWhere: Prisma.VideoWhereInput = {
    ...videoScope,
    publishedAt: {
      gte: rangeStart,
      lte: rangeEnd,
    },
  };

  const [videos, topVideoRows] = await Promise.all([
    prisma.video.findMany({
      where: videoWindowWhere,
      select: {
        id: true,
        creatorId: true,
        creatorPlatformAccountId: true,
        publishedAt: true,
        views: true,
        likes: true,
        engagementRate: true,
      },
      orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
      take: 500,
    }),
    prisma.video.findMany({
      where: currentWindowWhere,
      select: {
        id: true,
        titleOrCaption: true,
        platform: true,
        views: true,
        engagementRate: true,
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
      orderBy: [{ views: "desc" }, { publishedAt: "desc" }, { createdAt: "desc" }],
      take: 5,
    }),
  ]);

  const currentVideos = videos.filter(
    (video) => video.publishedAt && video.publishedAt >= rangeStart,
  );
  const previousVideos = videos.filter(
    (video) =>
      video.publishedAt &&
      video.publishedAt >= previousWindowStart &&
      video.publishedAt <= previousWindowEnd,
  );
  const currentViews = currentVideos.reduce(
    (total, video) => total + (video.views ?? 0),
    0,
  );
  const previousViews = previousVideos.reduce(
    (total, video) => total + (video.views ?? 0),
    0,
  );
  const currentLikes = currentVideos.reduce(
    (total, video) => total + (video.likes ?? 0),
    0,
  );
  const previousLikes = previousVideos.reduce(
    (total, video) => total + (video.likes ?? 0),
    0,
  );
  const currentActiveCreators = new Set(
    currentVideos.map((video) => video.creatorId),
  ).size;
  const previousActiveCreators = new Set(
    previousVideos.map((video) => video.creatorId),
  ).size;
  const currentVideosPerAccount = new Map<
    string,
    { currentViews: number; previousViews: number }
  >();

  for (const video of currentVideos) {
    if (!video.creatorPlatformAccountId) {
      continue;
    }

    const existingEntry = currentVideosPerAccount.get(video.creatorPlatformAccountId) ?? {
      currentViews: 0,
      previousViews: 0,
    };

    existingEntry.currentViews += video.views ?? 0;
    currentVideosPerAccount.set(video.creatorPlatformAccountId, existingEntry);
  }

  for (const video of previousVideos) {
    if (!video.creatorPlatformAccountId) {
      continue;
    }

    const existingEntry = currentVideosPerAccount.get(video.creatorPlatformAccountId) ?? {
      currentViews: 0,
      previousViews: 0,
    };

    existingEntry.previousViews += video.views ?? 0;
    currentVideosPerAccount.set(video.creatorPlatformAccountId, existingEntry);
  }

  const topAccountIds = [...currentVideosPerAccount.entries()]
    .filter(([, entry]) => entry.currentViews > 0)
    .sort((left, right) => right[1].currentViews - left[1].currentViews)
    .slice(0, 5)
    .map(([accountId]) => accountId);
  const topAccountDetails =
    topAccountIds.length > 0
      ? await prisma.creatorPlatformAccount.findMany({
          where: {
            id: {
              in: topAccountIds,
            },
          },
          select: {
            id: true,
            handle: true,
            platform: true,
            profileUrl: true,
            rawPayload: true,
          },
        })
      : [];
  const topAccountDetailsById = new Map(
    topAccountDetails.map((account) => [account.id, account]),
  );

  const currentActiveAccounts = [...currentVideosPerAccount.values()].filter(
    (entry) => entry.currentViews > 0,
  ).length;
  const previousActiveAccounts = [...currentVideosPerAccount.values()].filter(
    (entry) => entry.previousViews > 0,
  ).length;
  const currentAverageViewsPerVideo =
    currentVideos.length > 0 ? currentViews / currentVideos.length : 0;
  const previousAverageViewsPerVideo =
    previousVideos.length > 0 ? previousViews / previousVideos.length : 0;
  const dayBuckets = createDayBucketMap(dateKeys);

  for (const video of currentVideos) {
    if (!video.publishedAt) {
      continue;
    }

    const dateKey = video.publishedAt.toISOString().slice(0, 10);
    const bucket = dayBuckets.get(dateKey);

    if (!bucket) {
      continue;
    }

    bucket.views += video.views ?? 0;
    bucket.likes += video.likes ?? 0;
    bucket.videos += 1;

    if (typeof video.engagementRate === "number") {
      bucket.engagementTotal += video.engagementRate;
      bucket.engagementCount += 1;
    }
  }

  const dailyViews = dateKeys.map((dateKey) => dayBuckets.get(dateKey)?.views ?? 0);
  const dailyLikes = dateKeys.map((dateKey) => dayBuckets.get(dateKey)?.likes ?? 0);
  const dailyVideoCounts = dateKeys.map((dateKey) => dayBuckets.get(dateKey)?.videos ?? 0);
  const dailyEngagement = dateKeys.map((dateKey) => {
    const bucket = dayBuckets.get(dateKey);

    if (!bucket || bucket.engagementCount === 0) {
      return 0;
    }

    return Number((bucket.engagementTotal / bucket.engagementCount).toFixed(1));
  });
  const topVideos: TopVideoItem[] = topVideoRows.map((video) => ({
      id: video.id,
      title: video.titleOrCaption ?? `${video.creator.displayName} video`,
      account:
        video.creatorPlatformAccount?.handle ?? video.creator.displayName,
      handle: video.creatorPlatformAccount
        ? `@${video.creatorPlatformAccount.handle}`
        : video.creator.displayName,
      platform: formatPlatformLabel(video.platform),
      views: formatCompactNumber(video.views ?? 0),
      engagement: formatPercent(video.engagementRate ?? 0),
      badge: video.campaign?.name ?? "Unassigned",
      campaignId: video.campaign?.id ?? null,
      thumbnailUrl:
        getVideoThumbnailUrl(video.rawPayload) ??
        getAccountImageUrl(video.rawPayload) ??
        getAccountImageUrl(video.creatorPlatformAccount?.rawPayload),
    }));
  const topAccounts: TopAccountItem[] = topAccountIds.flatMap((accountId, index) => {
    const account = topAccountDetailsById.get(accountId);
    const stats = currentVideosPerAccount.get(accountId);

    if (!account || !stats) {
      return [];
    }

    return [
      {
        id: account.id,
        name: account.handle,
        handle: `@${account.handle}`,
        platform: formatPlatformLabel(account.platform),
        views: formatCompactNumber(stats.currentViews),
        growth: formatSignedPercent(
          getPercentChange(stats.currentViews, stats.previousViews),
        ),
        accent: accountAccentGradients[index % accountAccentGradients.length]!,
        imageUrl: getAccountImageUrl(account.rawPayload),
        profileUrl: account.profileUrl ?? undefined,
      },
    ];
  });

  return {
    accountOptions,
    campaignOptions,
    dateRangeOptions: [...dashboardDateRangeOptions],
    metricCards: [
      createMetricCard({
        label: "Published Videos",
        currentValue: currentVideos.length,
        previousValue: previousVideos.length,
        icon: "videos",
        formatter: (value) => formatCompactNumber(value),
      }),
      createMetricCard({
        label: "Active Accounts",
        currentValue: currentActiveAccounts,
        previousValue: previousActiveAccounts,
        icon: "accounts",
        formatter: (value) => formatCompactNumber(value),
      }),
      createMetricCard({
        label: "Views",
        currentValue: currentViews,
        previousValue: previousViews,
        icon: "overview",
        formatter: (value) => formatCompactNumber(value),
      }),
      createMetricCard({
        label: "Likes",
        currentValue: currentLikes,
        previousValue: previousLikes,
        icon: "spotlight",
        formatter: (value) => formatCompactNumber(value),
      }),
      createMetricCard({
        label: "Active Creators",
        currentValue: currentActiveCreators,
        previousValue: previousActiveCreators,
        icon: "creators",
        formatter: (value) => formatCompactNumber(value),
      }),
      createMetricCard({
        label: "Avg Views / Video",
        currentValue: currentAverageViewsPerVideo,
        previousValue: previousAverageViewsPerVideo,
        icon: "campaigns",
        formatter: (value) => formatCompactNumber(Math.round(value)),
      }),
    ],
    metricChartSeries: [
      buildMetricSeries({
        id: "views",
        label: "Views",
        summary: `${formatCompactNumber(currentViews)} views across ${currentVideos.length} videos in the current selection.`,
        values: dailyViews,
        dateKeys,
        formatter: (value) => formatCompactNumber(Math.round(value)),
      }),
      buildMetricSeries({
        id: "likes",
        label: "Likes",
        summary: `${formatCompactNumber(currentLikes)} likes captured in the selected date window.`,
        values: dailyLikes,
        dateKeys,
        formatter: (value) => formatCompactNumber(Math.round(value)),
      }),
      buildMetricSeries({
        id: "videos",
        label: "Videos",
        summary: `${currentVideos.length} published videos matched the current account and campaign filters.`,
        values: dailyVideoCounts,
        dateKeys,
        formatter: (value) => formatCompactNumber(Math.round(value)),
      }),
    ],
    engagementSeries: {
      summary:
        currentVideos.length > 0
          ? `${formatPercent(
              currentVideos.reduce(
                (total, video) => total + (video.engagementRate ?? 0),
                0,
              ) / currentVideos.length,
            )} average engagement across the filtered videos.`
          : "No published videos matched the current selection yet.",
      axisLabels: buildAxisLabels(
        Math.max(...dailyEngagement, 0),
        (value) => formatPercent(value),
      ),
      points: dateKeys.map((dateKey, index) => ({
        label: shortDateFormatter.format(new Date(dateKey)),
        value: dailyEngagement[index] ?? 0,
      })),
    },
    topVideos,
    topAccounts,
  };
}
