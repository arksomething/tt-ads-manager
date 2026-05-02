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
  localVideoId: string | null;
  sourceVideoId: string | null;
  videoUrl: string | null;
  videoUrlSource: "preview" | "tiktok_share" | "local" | null;
  tiktokAdsManagerUrl: string | null;
  titleOrCaption: string | null;
  publishedAt: Date | null;
  createdAt: Date | null;
  localViews: number | null;
  creatorName: string | null;
  accountHandle: string | null;
  thumbnailUrl?: string;
  localCampaignId: string | null;
  localCampaignName: string | null;
  hasLocalVideoMatch: boolean;
  tiktokCampaignId: string | null;
  tiktokCampaignName: string | null;
  tiktokAdgroupId: string | null;
  tiktokAdgroupName: string | null;
  tiktokAdSourceName: string | null;
  tiktokAdId: string | null;
  tiktokAdName: string | null;
  tiktokImpressions: number;
  tiktokSpend: number;
  tiktokClicks: number;
  tiktokConversions: number;
  attributedRevenue: number;
  singularMatchedRowCount: number;
  reportRowCount: number;
  matchedAdIds: string[];
  statDates: string[];
  matchSources: TikTokCampaignVideoMatchSource[];
};

export type CampaignTikTokReconciliationCampaignTotal = {
  key: string;
  tiktokCampaignId: string | null;
  tiktokCampaignName: string | null;
  impressions: number;
  spend: number;
  clicks: number;
  conversions: number;
  revenue: number;
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

function getCampaignVideoLink(args: {
  previewUrl: string | null | undefined;
  localVideoUrl: string | null | undefined;
  resolvedPostUrl: string | null | undefined;
}) {
  if (args.previewUrl) {
    return {
      href: args.previewUrl,
      source: "preview" as const,
    };
  }

  if (args.resolvedPostUrl) {
    return {
      href: args.resolvedPostUrl,
      source: "tiktok_share" as const,
    };
  }

  if (!args.localVideoUrl) {
    return null;
  }

  try {
    const url = new URL(args.localVideoUrl);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    const pathname = url.pathname.replace(/\/+$/, "");

    if (host === "tiktok.com" && /^\/video\/\d+$/.test(pathname)) {
      return null;
    }

    return {
      href: url.toString(),
      source: "local" as const,
    };
  } catch {
    return null;
  }
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
  if (accessibleCampaignIdSet.size === 0) {
    return {
      startDate: args.startDate,
      endDate: args.endDate,
      advertiserId: null,
      singularCohortPeriod: null as string | null,
      reportRowCount: 0,
      warnings: [] as string[],
      rows: [] as CampaignTikTokReconciliationRow[],
      campaignTotals: [] as CampaignTikTokReconciliationCampaignTotal[],
      totals: {
        videos: 0,
        localViews: 0,
        tiktokImpressions: 0,
        tiktokSpend: 0,
        tiktokClicks: 0,
        tiktokConversions: 0,
        attributedRevenue: 0,
        matchedVideos: 0,
        tiktokCampaigns: 0,
      },
    };
  }

  const tiktokReport = await getTikTokCampaignVideoViewsForOrganization({
    organizationSlug: args.organizationSlug,
    startDate: args.startDate,
    endDate: args.endDate,
    metric: "impressions",
    includePerformanceMetrics: true,
    includeSingularRevenue: true,
  });
  const sourceVideoIds = uniqueNonEmptyStrings(
    tiktokReport.rows.map((row) => row.sourceVideoId),
  );
  const tiktokAdIds = uniqueNonEmptyStrings(
    tiktokReport.rows.flatMap((row) => row.matchedAdIds),
  );
  const previewWarnings: string[] = [];
  const previewUrls = await (async () => {
    if (!tiktokReport.advertiserId || tiktokAdIds.length === 0) {
      return [];
    }

    try {
      return await prisma.tikTokAdPreviewUrl.findMany({
        where: {
          organizationId: membership.organizationId,
          advertiserId: tiktokReport.advertiserId,
          adId: {
            in: tiktokAdIds,
          },
          OR: [
            {
              expiresAt: null,
            },
            {
              expiresAt: {
                gte: new Date(),
              },
            },
          ],
        },
        select: {
          adId: true,
          previewUrl: true,
        },
        orderBy: [{ importedAt: "desc" }],
      });
    } catch {
      previewWarnings.push(
        "TikTok preview URL storage is not available yet, so rows fall back to public post URLs or Ads Manager ad links.",
      );
      return [];
    }
  })();
  const previewUrlsByAdId = new Map(
    previewUrls.map((previewUrl) => [previewUrl.adId, previewUrl] as const),
  );
  const videos = await prisma.video.findMany({
    where: {
      platform: Platform.TIKTOK,
      sourceVideoId: {
        in: sourceVideoIds,
      },
      creator: {
        organizationId: membership.organizationId,
      },
      ...(canManageOrganization(membership.role)
        ? {}
        : {
            campaignId: {
              in: [...accessibleCampaignIdSet],
            },
          }),
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
  const videosBySourceVideoId = new Map(
    videos
      .map((video) =>
        video.sourceVideoId ? ([video.sourceVideoId, video] as const) : null,
      )
      .filter(
        (entry): entry is readonly [string, (typeof videos)[number]] =>
          entry !== null,
      ),
  );

  const rows = tiktokReport.rows.map((tiktokRow) => {
    const video = tiktokRow.sourceVideoId
      ? (videosBySourceVideoId.get(tiktokRow.sourceVideoId) ?? null)
      : null;
    const previewUrl =
      tiktokRow.matchedAdIds
        .map((adId) => previewUrlsByAdId.get(adId)?.previewUrl ?? null)
        .find((url): url is string => Boolean(url)) ?? null;
    const videoLink = getCampaignVideoLink({
      previewUrl,
      localVideoUrl: video?.videoUrl,
      resolvedPostUrl: tiktokRow.resolvedPostUrl,
    });

    return {
      localVideoId: video?.id ?? null,
      sourceVideoId: tiktokRow.sourceVideoId,
      videoUrl: videoLink?.href ?? null,
      videoUrlSource: videoLink?.source ?? null,
      tiktokAdsManagerUrl: tiktokRow.adsManagerUrl,
      titleOrCaption: video?.titleOrCaption ?? tiktokRow.resolvedPostTitle,
      publishedAt: video?.publishedAt ?? null,
      createdAt: video?.createdAt ?? null,
      localViews: video?.views ?? null,
      creatorName: video?.creator.displayName ?? null,
      accountHandle: video?.creatorPlatformAccount?.handle ?? null,
      thumbnailUrl:
        getVideoThumbnailUrl(video?.rawPayload) ??
        getAccountImageUrl(video?.rawPayload) ??
        getAccountImageUrl(video?.creatorPlatformAccount?.rawPayload) ??
        tiktokRow.resolvedPostCoverUrl ??
        undefined,
      localCampaignId: video?.campaign?.id ?? null,
      localCampaignName: video?.campaign?.name ?? null,
      hasLocalVideoMatch: Boolean(video),
      rowKey: tiktokRow.rowKey,
      tiktokCampaignId: tiktokRow.tiktokCampaignId,
      tiktokCampaignName: tiktokRow.tiktokCampaignName,
      tiktokAdgroupId: tiktokRow.tiktokAdgroupId,
      tiktokAdgroupName: tiktokRow.tiktokAdgroupName,
      tiktokAdSourceName: tiktokRow.tiktokAdSourceName,
      tiktokAdId: tiktokRow.tiktokAdId,
      tiktokAdName: tiktokRow.tiktokAdName,
      tiktokImpressions: tiktokRow.paidViews,
      tiktokSpend: tiktokRow.spend,
      tiktokClicks: tiktokRow.clicks,
      tiktokConversions: tiktokRow.conversions,
      attributedRevenue: tiktokRow.attributedRevenue,
      singularMatchedRowCount: tiktokRow.singularMatchedRowCount,
      reportRowCount: tiktokRow.reportRowCount,
      matchedAdIds: tiktokRow.matchedAdIds,
      statDates: tiktokRow.statDates,
      matchSources: tiktokRow.matchSources,
    } satisfies CampaignTikTokReconciliationRow;
  });
  const campaignTotalsByKey = new Map<
    string,
    CampaignTikTokReconciliationCampaignTotal
  >();
  const matchedVideoIds = new Set<string>();

  for (const row of rows) {
    if (row.localVideoId) {
      matchedVideoIds.add(row.localVideoId);
    }
    const campaignKey =
      row.tiktokCampaignId ?? row.tiktokCampaignName ?? "unknown-tiktok-campaign";
    const existingTotal =
      campaignTotalsByKey.get(campaignKey) ??
      {
        key: campaignKey,
        tiktokCampaignId: row.tiktokCampaignId,
        tiktokCampaignName: row.tiktokCampaignName,
        impressions: 0,
        spend: 0,
        clicks: 0,
        conversions: 0,
        revenue: 0,
        videos: 0,
      };

    existingTotal.impressions += row.tiktokImpressions;
    existingTotal.spend += row.tiktokSpend;
    existingTotal.clicks += row.tiktokClicks;
    existingTotal.conversions += row.tiktokConversions;
    existingTotal.revenue += row.attributedRevenue;
    existingTotal.videos += 1;
    campaignTotalsByKey.set(campaignKey, existingTotal);
  }

  const campaignTotals = [...campaignTotalsByKey.values()].sort(
    (left, right) =>
      right.impressions - left.impressions ||
      (left.tiktokCampaignName ?? left.tiktokCampaignId ?? "").localeCompare(
        right.tiktokCampaignName ?? right.tiktokCampaignId ?? "",
      ),
  );

  return {
    startDate: tiktokReport.startDate,
    endDate: tiktokReport.endDate,
    advertiserId: tiktokReport.advertiserId,
    singularCohortPeriod: tiktokReport.singularCohortPeriod,
    reportRowCount: tiktokReport.reportRowCount,
    warnings: [...tiktokReport.warnings, ...previewWarnings],
    rows,
    campaignTotals,
    totals: {
      videos: rows.length,
      localViews: videos.reduce((total, video) => total + (video.views ?? 0), 0),
      tiktokImpressions: tiktokReport.totalPaidViews,
      tiktokSpend: tiktokReport.totalSpend,
      tiktokClicks: tiktokReport.totalClicks,
      tiktokConversions: tiktokReport.totalConversions,
      attributedRevenue: tiktokReport.totalAttributedRevenue,
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
