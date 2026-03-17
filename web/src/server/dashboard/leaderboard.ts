import { type Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";

import {
  dashboardDateRangeOptions,
  formatPlatformLabel,
  getDateRangeStart,
  getSelectedDateRange,
  type DashboardSearchParams,
} from "./filters";
import { getOrganizationDashboardShellData } from "./org-shell";

const LEADERBOARD_LIMIT = 20;

const compactNumberFormatter = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

const wholeNumberFormatter = new Intl.NumberFormat("en-US");

const shortDateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
});

type CampaignOption = {
  id: string;
  label: string;
};

type CreatorAccountSummary = {
  handle: string;
  imageUrl?: string;
  platformLabel: string;
  views: number;
};

type CreatorLeaderboardAccumulator = {
  id: string;
  creatorName: string;
  totalViews: number;
  videosCount: number;
  bestVideoTitle: string;
  bestVideoViews: number;
  lastPostAt: Date | null;
  accounts: Map<string, CreatorAccountSummary>;
};

export type LeaderboardRow = {
  id: string;
  rank: number;
  creatorName: string;
  handle: string | null;
  platformLabel: string | null;
  avatarUrl?: string;
  videosCount: number;
  videosCountLabel: string;
  totalViewsLabel: string;
  shareOfViewsPercent: number;
  shareOfViewsLabel: string;
  averageViewsLabel: string;
  bestVideoTitle: string;
  bestVideoViewsLabel: string;
  lastPostLabel: string | null;
};

export type LeaderboardPageData = {
  campaignOptions: CampaignOption[];
  selectedCampaign: CampaignOption | null;
  selectedDateRangeId: string;
  selectedDateRangeLabel: string;
  dateRangeOptions: Array<{
    id: string;
    label: string;
  }>;
  periodLabel: string;
  totalViewsLabel: string;
  totalVideosCount: number;
  totalVideosLabel: string;
  matchingCreatorsCount: number;
  matchingCreatorsLabel: string;
  showingCreatorsCount: number;
  leader:
    | {
        name: string;
        viewsLabel: string;
      }
    | null;
  rows: LeaderboardRow[];
};

function getSearchParamValue(
  searchParams: DashboardSearchParams | undefined,
  key: string,
) {
  const value = searchParams?.[key];
  return Array.isArray(value) ? value[0] : value;
}

function formatCompactNumber(value: number) {
  return compactNumberFormatter.format(value);
}

function formatShareOfViews(value: number) {
  if (value === 0) {
    return "0%";
  }

  if (value < 1) {
    return "<1%";
  }

  return value >= 10 ? `${value.toFixed(0)}%` : `${value.toFixed(1)}%`;
}

function formatDateLabel(value: Date | null) {
  if (!value) {
    return null;
  }

  return shortDateFormatter.format(value);
}

function formatPeriodLabel(startDate: Date, endDate: Date) {
  return `${shortDateFormatter.format(startDate)} - ${shortDateFormatter.format(endDate)}`;
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
) {
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

function resolveSelectedCampaign(
  campaignOptions: CampaignOption[],
  searchParams: DashboardSearchParams | undefined,
) {
  if (campaignOptions.length === 0) {
    return null;
  }

  const campaignIds = new Set(campaignOptions.map((campaign) => campaign.id));
  const explicitCampaignId = getSearchParamValue(searchParams, "campaign");

  if (explicitCampaignId && campaignIds.has(explicitCampaignId)) {
    return (
      campaignOptions.find((campaign) => campaign.id === explicitCampaignId) ?? null
    );
  }

  const rawCampaignSelection = getSearchParamValue(searchParams, "campaigns");

  if (rawCampaignSelection) {
    const firstSelectedCampaignId = rawCampaignSelection
      .split(",")
      .map((value) => value.trim())
      .find((value) => campaignIds.has(value));

    if (firstSelectedCampaignId) {
      return (
        campaignOptions.find((campaign) => campaign.id === firstSelectedCampaignId) ??
        null
      );
    }
  }

  return campaignOptions[0] ?? null;
}

function createEmptyLeaderboardData(args: {
  campaignOptions: CampaignOption[];
  selectedCampaign: CampaignOption | null;
  selectedDateRangeId: string;
  periodLabel: string;
  totalVideosCount?: number;
}): LeaderboardPageData {
  const selectedDateRangeLabel =
    dashboardDateRangeOptions.find((option) => option.id === args.selectedDateRangeId)
      ?.label ??
    dashboardDateRangeOptions[1]?.label ??
    dashboardDateRangeOptions[0]?.label ??
    "Last 14 days";

  return {
    campaignOptions: args.campaignOptions,
    selectedCampaign: args.selectedCampaign,
    selectedDateRangeId: args.selectedDateRangeId,
    selectedDateRangeLabel,
    dateRangeOptions: dashboardDateRangeOptions.map((option) => ({
      id: option.id,
      label: option.label,
    })),
    periodLabel: args.periodLabel,
    totalViewsLabel: "0",
    totalVideosCount: args.totalVideosCount ?? 0,
    totalVideosLabel: wholeNumberFormatter.format(args.totalVideosCount ?? 0),
    matchingCreatorsCount: 0,
    matchingCreatorsLabel: "0",
    showingCreatorsCount: 0,
    leader: null,
    rows: [],
  };
}

export async function getOrganizationLeaderboardData(args: {
  organizationSlug: string;
  searchParams?: DashboardSearchParams;
}): Promise<LeaderboardPageData> {
  const { organizationSlug, searchParams } = args;
  const shellData = await getOrganizationDashboardShellData(organizationSlug);
  const campaignOptions = shellData.campaigns.map((campaign) => ({
    id: campaign.id,
    label: campaign.name,
  }));
  const selectedCampaign = resolveSelectedCampaign(campaignOptions, searchParams);
  const selectedDateRangeId = getSelectedDateRange(searchParams);
  const rangeStart = getDateRangeStart(selectedDateRangeId);
  const rangeEnd = new Date();
  const periodLabel = formatPeriodLabel(rangeStart, rangeEnd);

  if (!selectedCampaign) {
    return createEmptyLeaderboardData({
      campaignOptions,
      selectedCampaign: null,
      selectedDateRangeId,
      periodLabel,
    });
  }

  const videos = await prisma.video.findMany({
    where: {
      campaignId: selectedCampaign.id,
      creator: {
        organizationId: shellData.membership.organizationId,
      },
      publishedAt: {
        gte: rangeStart,
        lte: rangeEnd,
      },
    },
    select: {
      id: true,
      titleOrCaption: true,
      views: true,
      publishedAt: true,
      creator: {
        select: {
          id: true,
          displayName: true,
        },
      },
      creatorPlatformAccount: {
        select: {
          handle: true,
          platform: true,
          rawPayload: true,
        },
      },
    },
    orderBy: [{ views: "desc" }, { publishedAt: "desc" }, { createdAt: "desc" }],
  });

  if (videos.length === 0) {
    return createEmptyLeaderboardData({
      campaignOptions,
      selectedCampaign,
      selectedDateRangeId,
      periodLabel,
    });
  }

  const leaderboardByCreator = new Map<string, CreatorLeaderboardAccumulator>();

  for (const video of videos) {
    const existingEntry = leaderboardByCreator.get(video.creator.id) ?? {
      id: video.creator.id,
      creatorName: video.creator.displayName,
      totalViews: 0,
      videosCount: 0,
      bestVideoTitle: video.titleOrCaption?.trim() || `${video.creator.displayName} video`,
      bestVideoViews: 0,
      lastPostAt: null,
      accounts: new Map<string, CreatorAccountSummary>(),
    };
    const videoViews = video.views ?? 0;

    existingEntry.totalViews += videoViews;
    existingEntry.videosCount += 1;

    if (
      videoViews > existingEntry.bestVideoViews ||
      existingEntry.bestVideoTitle.length === 0
    ) {
      existingEntry.bestVideoViews = videoViews;
      existingEntry.bestVideoTitle =
        video.titleOrCaption?.trim() || `${video.creator.displayName} video`;
    }

    if (
      video.publishedAt &&
      (!existingEntry.lastPostAt || video.publishedAt > existingEntry.lastPostAt)
    ) {
      existingEntry.lastPostAt = video.publishedAt;
    }

    if (video.creatorPlatformAccount?.handle) {
      const accountKey = `${video.creatorPlatformAccount.platform}:${video.creatorPlatformAccount.handle}`;
      const accountImageUrl = getAccountImageUrl(video.creatorPlatformAccount.rawPayload);
      const existingAccount = existingEntry.accounts.get(accountKey);

      if (existingAccount) {
        existingAccount.views += videoViews;

        if (!existingAccount.imageUrl && accountImageUrl) {
          existingAccount.imageUrl = accountImageUrl;
        }
      } else {
        existingEntry.accounts.set(accountKey, {
          handle: video.creatorPlatformAccount.handle,
          imageUrl: accountImageUrl,
          platformLabel: formatPlatformLabel(video.creatorPlatformAccount.platform),
          views: videoViews,
        });
      }
    }

    leaderboardByCreator.set(video.creator.id, existingEntry);
  }

  const rankedCreators = [...leaderboardByCreator.values()]
    .filter((entry) => entry.totalViews > 0)
    .sort((left, right) => {
      const byViews = right.totalViews - left.totalViews;

      if (byViews !== 0) {
        return byViews;
      }

      const byVideoCount = right.videosCount - left.videosCount;

      if (byVideoCount !== 0) {
        return byVideoCount;
      }

      const byLatestPost =
        (right.lastPostAt?.getTime() ?? 0) - (left.lastPostAt?.getTime() ?? 0);

      if (byLatestPost !== 0) {
        return byLatestPost;
      }

      return left.creatorName.localeCompare(right.creatorName);
    });

  if (rankedCreators.length === 0) {
    return createEmptyLeaderboardData({
      campaignOptions,
      selectedCampaign,
      selectedDateRangeId,
      periodLabel,
      totalVideosCount: videos.length,
    });
  }

  const totalViews = rankedCreators.reduce(
    (runningTotal, entry) => runningTotal + entry.totalViews,
    0,
  );

  const rows = rankedCreators.slice(0, LEADERBOARD_LIMIT).map((entry, index) => {
    const primaryAccount = [...entry.accounts.values()].sort(
      (left, right) => right.views - left.views,
    )[0];
    const shareOfViewsPercent =
      totalViews > 0
        ? Number(((entry.totalViews / totalViews) * 100).toFixed(1))
        : 0;

    return {
      id: entry.id,
      rank: index + 1,
      creatorName: entry.creatorName,
      handle: primaryAccount ? `@${primaryAccount.handle}` : null,
      platformLabel: primaryAccount?.platformLabel ?? null,
      avatarUrl: primaryAccount?.imageUrl,
      videosCount: entry.videosCount,
      videosCountLabel: wholeNumberFormatter.format(entry.videosCount),
      totalViewsLabel: formatCompactNumber(entry.totalViews),
      shareOfViewsPercent,
      shareOfViewsLabel: formatShareOfViews(shareOfViewsPercent),
      averageViewsLabel: formatCompactNumber(
        Math.round(entry.totalViews / Math.max(entry.videosCount, 1)),
      ),
      bestVideoTitle: entry.bestVideoTitle,
      bestVideoViewsLabel: formatCompactNumber(entry.bestVideoViews),
      lastPostLabel: formatDateLabel(entry.lastPostAt),
    } satisfies LeaderboardRow;
  });

  const leader = rows[0]
    ? {
        name: rows[0].creatorName,
        viewsLabel: rows[0].totalViewsLabel,
      }
    : null;

  return {
    campaignOptions,
    selectedCampaign,
    selectedDateRangeId,
    selectedDateRangeLabel:
      dashboardDateRangeOptions.find((option) => option.id === selectedDateRangeId)
        ?.label ??
      dashboardDateRangeOptions[1]?.label ??
      dashboardDateRangeOptions[0]?.label ??
      "Last 14 days",
    dateRangeOptions: dashboardDateRangeOptions.map((option) => ({
      id: option.id,
      label: option.label,
    })),
    periodLabel,
    totalViewsLabel: formatCompactNumber(totalViews),
    totalVideosCount: videos.length,
    totalVideosLabel: wholeNumberFormatter.format(videos.length),
    matchingCreatorsCount: rankedCreators.length,
    matchingCreatorsLabel: wholeNumberFormatter.format(rankedCreators.length),
    showingCreatorsCount: rows.length,
    leader,
    rows,
  };
}
