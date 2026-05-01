import {
  CampaignRole,
  Platform,
  type OrganizationMembership,
  type Prisma,
} from "@/lib/prisma-shim";

import { prisma } from "@/lib/db";
import { requireOrganizationMembership } from "@/server/auth/organizations";
import { canManageCampaign, canManageOrganization } from "@/server/auth/roles";
import {
  getTikTokCampaignVideoViewsForOrganization,
  type TikTokCampaignVideoMatchSource,
} from "@/server/tiktok-business/reporting";

const CAMPAIGN_CREATOR_PREVIEW_LIMIT = 12;
const CAMPAIGN_VIDEO_PREVIEW_LIMIT = 12;

type ViewerOrganizationMembership = Pick<
  OrganizationMembership,
  "organizationId" | "role" | "userId"
>;

export type CampaignTikTokReconciliationRow = {
  rowKey: string;
  id: string;
  sourceVideoId: string;
  videoUrl: string;
  titleOrCaption: string | null;
  publishedAt: Date | null;
  createdAt: Date;
  localViews: number | null;
  creatorName: string;
  accountHandle: string | null;
  thumbnailUrl?: string;
  localCampaignId: string | null;
  localCampaignName: string | null;
  tiktokCampaignId: string | null;
  tiktokCampaignName: string | null;
  tiktokViews: number;
  hasTikTokDelivery: boolean;
  reportRowCount: number;
  matchedAdIds: string[];
  statDates: string[];
  matchSources: TikTokCampaignVideoMatchSource[];
};

export type CampaignTikTokReconciliationCampaignTotal = {
  key: string;
  tiktokCampaignId: string | null;
  tiktokCampaignName: string | null;
  views: number;
  videos: number;
};

export function getAccessibleCampaignWhere(
  membership: ViewerOrganizationMembership,
) {
  if (canManageOrganization(membership.role)) {
    return {
      organizationId: membership.organizationId,
    };
  }

  return {
    organizationId: membership.organizationId,
    OR: [
      {
        ownerUserId: membership.userId,
      },
      {
        memberships: {
          some: {
            userId: membership.userId,
          },
        },
      },
    ],
  };
}

export async function getAccessibleCampaignOptionsForMembership(
  membership: ViewerOrganizationMembership,
) {
  return prisma.campaign.findMany({
    where: getAccessibleCampaignWhere(membership),
    select: {
      id: true,
      name: true,
    },
    orderBy: {
      createdAt: "desc",
    },
  });
}

export async function countAccessibleCampaignsForMembership(
  membership: ViewerOrganizationMembership,
) {
  return prisma.campaign.count({
    where: getAccessibleCampaignWhere(membership),
  });
}

export async function getCampaignWorkspace(organizationSlug: string) {
  const membership = await requireOrganizationMembership(organizationSlug);

  const campaigns = await prisma.campaign.findMany({
    where: getAccessibleCampaignWhere(membership),
    select: {
      id: true,
      name: true,
      updatedAt: true,
      owner: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
      memberships: {
        where: {
          userId: membership.userId,
        },
        select: {
          role: true,
        },
        take: 1,
      },
      _count: {
        select: {
          creators: true,
          videos: true,
          memberships: true,
          payouts: true,
        },
      },
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  return {
    membership,
    campaigns,
    canManageOrganizationCampaigns: canManageOrganization(membership.role),
  };
}

export type CampaignWorkspace = Awaited<ReturnType<typeof getCampaignWorkspace>>;
export type CampaignWorkspaceSummary = CampaignWorkspace["campaigns"][number];

export async function getCampaignWorkspaceDetail(args: {
  organizationSlug: string;
  campaignId: string;
}) {
  const membership = await requireOrganizationMembership(args.organizationSlug);

  return prisma.campaign.findFirst({
    where: {
      id: args.campaignId,
      ...getAccessibleCampaignWhere(membership),
    },
    select: {
      memberships: {
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
        orderBy: [{ role: "asc" }, { createdAt: "asc" }],
      },
      invitations: {
        where: {
          acceptedAt: null,
          revokedAt: null,
        },
        include: {
          invitedBy: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
        orderBy: {
          createdAt: "desc",
        },
      },
      creators: {
        select: {
          id: true,
          createdAt: true,
          creator: {
            select: {
              id: true,
              displayName: true,
              primaryNiche: true,
            },
          },
        },
        orderBy: {
          createdAt: "desc",
        },
        take: CAMPAIGN_CREATOR_PREVIEW_LIMIT,
      },
      videos: {
        select: {
          id: true,
          videoUrl: true,
          titleOrCaption: true,
          platform: true,
          views: true,
          publishedAt: true,
          createdAt: true,
          creator: {
            select: {
              id: true,
              displayName: true,
            },
          },
        },
        orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
        take: CAMPAIGN_VIDEO_PREVIEW_LIMIT,
      },
    },
  });
}

function uniqueNonEmptyStrings(values: ReadonlyArray<string | null | undefined>) {
  return [
    ...new Set(
      values
        .map((value) => value?.trim())
        .filter((value): value is string => Boolean(value)),
    ),
  ];
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

export async function getCampaignTikTokVideoReconciliation(args: {
  organizationSlug: string;
  campaignIds?: string[];
  startDate: string;
  endDate: string;
}) {
  const membership = await requireOrganizationMembership(args.organizationSlug);
  const accessibleCampaigns = await prisma.campaign.findMany({
    where: getAccessibleCampaignWhere(membership),
    select: {
      id: true,
      name: true,
    },
    orderBy: {
      createdAt: "desc",
    },
  });
  const accessibleCampaignIdSet = new Set(
    accessibleCampaigns.map((campaign) => campaign.id),
  );
  const selectedCampaignIds =
    args.campaignIds === undefined
      ? [...accessibleCampaignIdSet]
      : uniqueNonEmptyStrings(args.campaignIds).filter((campaignId) =>
          accessibleCampaignIdSet.has(campaignId),
        );

  if (selectedCampaignIds.length === 0) {
    return {
      startDate: args.startDate,
      endDate: args.endDate,
      advertiserId: null,
      reportRowCount: 0,
      warnings: [] as string[],
      rows: [] as CampaignTikTokReconciliationRow[],
      campaignTotals: [] as CampaignTikTokReconciliationCampaignTotal[],
      totals: {
        videos: 0,
        localViews: 0,
        tiktokViews: 0,
        matchedVideos: 0,
        tiktokCampaigns: 0,
      },
    };
  }

  const videos = await prisma.video.findMany({
    where: {
      platform: Platform.TIKTOK,
      sourceVideoId: {
        not: null,
      },
      campaignId: {
        in: selectedCampaignIds,
      },
      creator: {
        organizationId: membership.organizationId,
      },
    },
    select: {
      id: true,
      sourceVideoId: true,
      videoUrl: true,
      titleOrCaption: true,
      publishedAt: true,
      createdAt: true,
      views: true,
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
  });

  const sourceVideoIds = uniqueNonEmptyStrings(
    videos.map((video) => video.sourceVideoId),
  );
  const tiktokReport = await getTikTokCampaignVideoViewsForOrganization({
    organizationSlug: args.organizationSlug,
    itemIds: sourceVideoIds,
    startDate: args.startDate,
    endDate: args.endDate,
  });
  const tiktokRowsBySourceVideoId = new Map<
    string,
    typeof tiktokReport.rows
  >();

  for (const row of tiktokReport.rows) {
    const existingRows = tiktokRowsBySourceVideoId.get(row.sourceVideoId) ?? [];
    tiktokRowsBySourceVideoId.set(row.sourceVideoId, [...existingRows, row]);
  }

  const rows = videos.flatMap((video) => {
    const sourceVideoId = video.sourceVideoId;

    if (!sourceVideoId) {
      return [];
    }

    const tiktokRows = tiktokRowsBySourceVideoId.get(sourceVideoId) ?? [];
    const baseRow = {
      id: video.id,
      sourceVideoId,
      videoUrl: video.videoUrl,
      titleOrCaption: video.titleOrCaption,
      publishedAt: video.publishedAt,
      createdAt: video.createdAt,
      localViews: video.views,
      creatorName: video.creator.displayName,
      accountHandle: video.creatorPlatformAccount?.handle ?? null,
      thumbnailUrl:
        getVideoThumbnailUrl(video.rawPayload) ??
        getAccountImageUrl(video.rawPayload) ??
        getAccountImageUrl(video.creatorPlatformAccount?.rawPayload),
      localCampaignId: video.campaign?.id ?? null,
      localCampaignName: video.campaign?.name ?? null,
    };

    if (tiktokRows.length === 0) {
      return [
        {
          ...baseRow,
          rowKey: `${video.id}:no-tiktok-campaign`,
          tiktokCampaignId: null,
          tiktokCampaignName: null,
          tiktokViews: 0,
          hasTikTokDelivery: false,
          reportRowCount: 0,
          matchedAdIds: [],
          statDates: [],
          matchSources: [],
        } satisfies CampaignTikTokReconciliationRow,
      ];
    }

    return tiktokRows.map((tiktokRow) => ({
      ...baseRow,
      rowKey: [
        video.id,
        tiktokRow.tiktokCampaignId ??
          tiktokRow.tiktokCampaignName ??
          "unknown-tiktok-campaign",
      ].join(":"),
      tiktokCampaignId: tiktokRow.tiktokCampaignId,
      tiktokCampaignName: tiktokRow.tiktokCampaignName,
      tiktokViews: tiktokRow.paidViews,
      hasTikTokDelivery: tiktokRow.paidViews > 0,
      reportRowCount: tiktokRow.reportRowCount,
      matchedAdIds: tiktokRow.matchedAdIds,
      statDates: tiktokRow.statDates,
      matchSources: tiktokRow.matchSources,
    })) satisfies CampaignTikTokReconciliationRow[];
  });
  const campaignTotalsByKey = new Map<
    string,
    CampaignTikTokReconciliationCampaignTotal
  >();
  const matchedVideoIds = new Set<string>();

  for (const row of rows) {
    if (!row.hasTikTokDelivery) {
      continue;
    }

    matchedVideoIds.add(row.id);
    const campaignKey =
      row.tiktokCampaignId ?? row.tiktokCampaignName ?? "unknown-tiktok-campaign";
    const existingTotal =
      campaignTotalsByKey.get(campaignKey) ??
      {
        key: campaignKey,
        tiktokCampaignId: row.tiktokCampaignId,
        tiktokCampaignName: row.tiktokCampaignName,
        views: 0,
        videos: 0,
      };

    existingTotal.views += row.tiktokViews;
    existingTotal.videos += 1;
    campaignTotalsByKey.set(campaignKey, existingTotal);
  }

  const campaignTotals = [...campaignTotalsByKey.values()].sort(
    (left, right) =>
      right.views - left.views ||
      (left.tiktokCampaignName ?? left.tiktokCampaignId ?? "").localeCompare(
        right.tiktokCampaignName ?? right.tiktokCampaignId ?? "",
      ),
  );

  return {
    startDate: tiktokReport.startDate,
    endDate: tiktokReport.endDate,
    advertiserId: tiktokReport.advertiserId,
    reportRowCount: tiktokReport.reportRowCount,
    warnings: tiktokReport.warnings,
    rows,
    campaignTotals,
    totals: {
      videos: videos.length,
      localViews: videos.reduce((total, video) => total + (video.views ?? 0), 0),
      tiktokViews: rows.reduce((total, row) => total + row.tiktokViews, 0),
      matchedVideos: matchedVideoIds.size,
      tiktokCampaigns: campaignTotals.length,
    },
  };
}

export async function getCampaignAccess(
  organizationSlug: string,
  campaignId: string,
) {
  const membership = await requireOrganizationMembership(organizationSlug);
  const campaign = await prisma.campaign.findFirst({
    where: {
      id: campaignId,
      ...getAccessibleCampaignWhere(membership),
    },
    include: {
      memberships: {
        where: {
          userId: membership.userId,
        },
        select: {
          role: true,
        },
      },
    },
  });

  if (!campaign) {
    throw new Error("Campaign access denied");
  }

  const viewerCampaignRole =
    campaign.ownerUserId === membership.userId
      ? CampaignRole.OWNER
      : (campaign.memberships[0]?.role ?? null);

  return {
    membership,
    campaign,
    viewerCampaignRole,
    canManageCampaign:
      canManageOrganization(membership.role) ||
      (viewerCampaignRole ? canManageCampaign(viewerCampaignRole) : false),
  };
}
