import { type Platform, type Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { canManageOrganization } from "@/server/auth/roles";
import {
  getSelectedIdsFromSearchParams,
  type DashboardSearchParams,
} from "@/server/dashboard/filters";
import { getOrganizationDashboardShellData } from "@/server/dashboard/org-shell";

export const IMPORTED_VIDEOS_PAGE_SIZE = 50;
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
