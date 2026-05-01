import { type Prisma, Platform } from "@/lib/prisma-shim";
import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/db";
import { requireOrganizationMembership } from "@/server/auth/organizations";
import { getAccessibleCampaignOptionsForMembership } from "@/server/campaigns/queries";

import { viewsBaseClient } from "./client";
import { VIEWSBASE_SYNC_SOURCE } from "./shared";

const VIEWSBASE_PAGE_SIZE = 100;
const MAX_VIEWSBASE_PAGES = 50;

type ViewsBaseCampaignInput = {
  campaignId: string;
  orgSlug: string;
  campaignSlug: string;
};

type ViewsBaseCampaignMetadata = {
  id: string;
  name: string;
  slug: string;
  orgSlug: string;
};

type ViewsBaseInfluencer = {
  id?: string | null;
  name?: string | null;
  handle?: string | null;
  platform?: string | null;
};

type ViewsBaseCampaignRef = {
  id?: string | null;
  name?: string | null;
  slug?: string | null;
};

type ViewsBaseVideoRow = {
  id?: string | null;
  influencer_id?: string | null;
  url?: string | null;
  posted_at?: string | null;
  current_views?: number | null;
  likes?: number | null;
  comments?: number | null;
  shares?: number | null;
  created_at?: string | null;
  updated_at?: string | null;
  platform?: string | null;
  platform_post_id?: string | null;
  influencer?: ViewsBaseInfluencer | null;
  campaign?: ViewsBaseCampaignRef | null;
};

type ViewsBaseVideosResponse = {
  videos?: ViewsBaseVideoRow[];
};

function normalizeText(value: unknown) {
  if (value === null || value === undefined) {
    return null;
  }

  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function normalizeHandle(value: unknown) {
  const text = normalizeText(value);

  if (!text) {
    return null;
  }

  return text.startsWith("@") ? text.slice(1) : text;
}

function toSafeInt(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const numeric = Number(value);

  if (!Number.isFinite(numeric)) {
    return null;
  }

  return Math.max(0, Math.min(2_147_483_647, Math.round(numeric)));
}

function toDate(value: unknown) {
  const text = normalizeText(value);

  if (!text) {
    return null;
  }

  const normalized = text.includes("T")
    ? text.replace(/\+00$/, "Z")
    : text.replace(" ", "T").replace(/\+00$/, "Z");
  const date = new Date(normalized);

  return Number.isNaN(date.getTime()) ? null : date;
}

function mapViewsBasePlatform(platform: unknown) {
  switch (normalizeText(platform)?.toLowerCase()) {
    case "instagram":
    case "instagram_reels":
      return Platform.INSTAGRAM_REELS;
    case "youtube":
    case "youtube_shorts":
      return Platform.YOUTUBE_SHORTS;
    case "tiktok":
      return Platform.TIKTOK;
    default:
      return null;
  }
}

function buildProfileUrl(platform: Platform, handle: string | null) {
  if (!handle) {
    return null;
  }

  switch (platform) {
    case Platform.INSTAGRAM_REELS:
      return `https://www.instagram.com/${encodeURIComponent(handle)}/`;
    case Platform.YOUTUBE_SHORTS:
      return `https://www.youtube.com/@${encodeURIComponent(handle)}`;
    default:
      return `https://www.tiktok.com/@${encodeURIComponent(handle)}`;
  }
}

function getSourceVideoId(video: ViewsBaseVideoRow) {
  const explicitId = normalizeText(video.platform_post_id);

  if (explicitId) {
    return explicitId;
  }

  const videoUrl = normalizeText(video.url);

  if (!videoUrl) {
    return null;
  }

  const tiktokMatch = videoUrl.match(/\/video\/(\d+)/i);

  if (tiktokMatch?.[1]) {
    return tiktokMatch[1];
  }

  const instagramMatch = videoUrl.match(/\/(?:reel|reels|p)\/([^/?#]+)/i);

  if (instagramMatch?.[1]) {
    return instagramMatch[1];
  }

  const youtubeMatch =
    videoUrl.match(/\/shorts\/([^/?#]+)/i) ??
    videoUrl.match(/[?&]v=([^&]+)/i) ??
    videoUrl.match(/youtu\.be\/([^/?#]+)/i);

  return youtubeMatch?.[1] ?? null;
}

function buildWrappedViewsBasePayload(args: {
  campaign: ViewsBaseCampaignMetadata;
  syncStartedAt: Date;
  video: ViewsBaseVideoRow;
  handle: string | null;
  creatorName: string;
  sourceVideoId: string | null;
}) {
  return {
    integrationSource: VIEWSBASE_SYNC_SOURCE,
    sourceProvider: VIEWSBASE_SYNC_SOURCE,
    viewsbaseOrgSlug: args.campaign.orgSlug,
    viewsbaseCampaignId: args.campaign.id,
    viewsbaseCampaignSlug: args.campaign.slug,
    platform: normalizeText(args.video.platform)?.toLowerCase() ?? "tiktok",
    platformVideoId: args.sourceVideoId,
    accountUsername: args.handle,
    accountDisplayName: args.creatorName,
    caption: null,
    publishedAt: normalizeText(args.video.posted_at),
    loadAt: args.syncStartedAt.toISOString(),
    viewCount: toSafeInt(args.video.current_views),
    likeCount: toSafeInt(args.video.likes),
    commentCount: toSafeInt(args.video.comments),
    viewsbase: args.video as unknown as Prisma.InputJsonValue,
  } satisfies Prisma.InputJsonObject;
}

async function resolveViewsBaseCampaignMetadata(args: {
  orgSlug: string;
  campaignSlug: string;
}) {
  const html = await viewsBaseClient.requestText({
    path: `/${args.orgSlug}/${args.campaignSlug}`,
    headers: {
      "x-org-slug": args.orgSlug,
    },
  });

  const match =
    html.match(
      /"campaign":\{"id":"([^"]+)","name":"([^"]+)","slug":"([^"]+)"/,
    ) ??
    html.match(/campaign:\{id:"([^"]+)",name:"([^"]+)",slug:"([^"]+)"/);

  if (!match?.[1] || !match[2] || !match[3]) {
    throw new Error(
      `Could not resolve the ViewsBase campaign for ${args.orgSlug}/${args.campaignSlug}.`,
    );
  }

  return {
    id: match[1],
    name: match[2],
    slug: match[3],
    orgSlug: args.orgSlug,
  } satisfies ViewsBaseCampaignMetadata;
}

async function fetchViewsBaseCampaignVideos(campaign: ViewsBaseCampaignMetadata) {
  const videos: ViewsBaseVideoRow[] = [];

  for (let page = 1; page <= MAX_VIEWSBASE_PAGES; page += 1) {
    const payload = await viewsBaseClient.requestJson<ViewsBaseVideosResponse>({
      path: "/api/dashboard/videos",
      query: {
        page,
        limit: VIEWSBASE_PAGE_SIZE,
        campaign_id: campaign.id,
      },
      headers: {
        "x-org-slug": campaign.orgSlug,
      },
    });
    const pageVideos = Array.isArray(payload.videos) ? payload.videos : [];

    videos.push(...pageVideos);

    if (pageVideos.length < VIEWSBASE_PAGE_SIZE) {
      break;
    }
  }

  return videos;
}

function revalidateViewsBaseWorkspace(organizationSlug: string, campaignId: string) {
  const paths = [
    "/app",
    `/org/${organizationSlug}`,
    `/org/${organizationSlug}/campaigns`,
    `/org/${organizationSlug}/videos`,
    `/org/${organizationSlug}/payouts`,
    `/org/${organizationSlug}/review`,
    `/org/${organizationSlug}/view-tally`,
    `/org/${organizationSlug}/campaigns?campaignId=${campaignId}`,
  ];

  for (const path of paths) {
    try {
      revalidatePath(path);
    } catch {
      // Allow non-request backfills to complete without failing revalidation.
    }
  }
}

export async function syncViewsBaseCampaignForOrganization(args: {
  organizationSlug: string;
  input: unknown;
}) {
  const membership = await requireOrganizationMembership(args.organizationSlug);
  const values = args.input as Partial<ViewsBaseCampaignInput>;
  const localCampaignId = normalizeText(values.campaignId);
  const remoteOrgSlug = normalizeText(values.orgSlug);
  const remoteCampaignSlug = normalizeText(values.campaignSlug);

  if (!localCampaignId) {
    throw new Error("Choose a local campaign before syncing ViewsBase.");
  }

  if (!remoteOrgSlug || !remoteCampaignSlug) {
    throw new Error("Enter the ViewsBase org slug and campaign slug.");
  }

  const accessibleCampaigns = await getAccessibleCampaignOptionsForMembership(membership);
  const accessibleCampaignIds = new Set(accessibleCampaigns.map((campaign) => campaign.id));

  if (!accessibleCampaignIds.has(localCampaignId)) {
    throw new Error("Choose a campaign you can access.");
  }

  const remoteCampaign = await resolveViewsBaseCampaignMetadata({
    orgSlug: remoteOrgSlug,
    campaignSlug: remoteCampaignSlug,
  });
  const remoteVideos = await fetchViewsBaseCampaignVideos(remoteCampaign);
  const syncStartedAt = new Date();
  const syncedCreatorIds = new Set<string>();
  let syncedVideoCount = 0;
  let skippedVideoCount = 0;
  const warnings: string[] = [];

  for (const remoteVideo of remoteVideos) {
    const platform = mapViewsBasePlatform(remoteVideo.platform);
    const videoUrl = normalizeText(remoteVideo.url);
    const sourceVideoId = getSourceVideoId(remoteVideo);
    const handle =
      normalizeHandle(remoteVideo.influencer?.handle) ??
      normalizeHandle(videoUrl?.match(/\/@([^/]+)/)?.[1] ?? null);
    const creatorName =
      normalizeText(remoteVideo.influencer?.name) ??
      (handle ? `@${handle}` : null) ??
      "ViewsBase creator";

    if (!platform || !videoUrl || !sourceVideoId) {
      skippedVideoCount += 1;
      warnings.push(
        `Skipped a ViewsBase row because it was missing a supported platform, URL, or source video ID.`,
      );
      continue;
    }

    await prisma.$transaction(async (tx) => {
      const existingAccount =
        handle != null
          ? await tx.creatorPlatformAccount.findFirst({
              where: {
                platform,
                handle: {
                  equals: handle,
                  mode: "insensitive",
                },
                creator: {
                  organizationId: membership.organizationId,
                },
              },
              select: {
                id: true,
                creatorId: true,
                handle: true,
                profileUrl: true,
              },
            })
          : null;

      const account =
        existingAccount != null
          ? await tx.creatorPlatformAccount.update({
              where: {
                id: existingAccount.id,
              },
              data: {
                handle: handle ?? existingAccount.handle,
                profileUrl:
                  buildProfileUrl(platform, handle ?? existingAccount.handle) ??
                  existingAccount.profileUrl,
                lastSyncedAt: syncStartedAt,
              },
              select: {
                id: true,
                creatorId: true,
              },
            })
          : await (async () => {
              const creator = await tx.creator.create({
                data: {
                  organizationId: membership.organizationId,
                  displayName: creatorName,
                },
                select: {
                  id: true,
                },
              });

              return tx.creatorPlatformAccount.create({
                data: {
                  creatorId: creator.id,
                  platform,
                  handle:
                    handle ??
                    `${VIEWSBASE_SYNC_SOURCE}-${sourceVideoId.slice(0, 18)}`,
                  profileUrl: buildProfileUrl(platform, handle),
                  lastSyncedAt: syncStartedAt,
                },
                select: {
                  id: true,
                  creatorId: true,
                },
              });
            })();

      syncedCreatorIds.add(account.creatorId);

      await tx.campaignCreator.upsert({
        where: {
          campaignId_creatorId: {
            campaignId: localCampaignId,
            creatorId: account.creatorId,
          },
        },
        update: {},
        create: {
          campaignId: localCampaignId,
          creatorId: account.creatorId,
        },
      });

      const existingVideo = await tx.video.findUnique({
        where: {
          platform_sourceVideoId: {
            platform,
            sourceVideoId,
          },
        },
        select: {
          id: true,
          titleOrCaption: true,
          publishedAt: true,
          views: true,
          likes: true,
          comments: true,
        },
      });
      const payload = buildWrappedViewsBasePayload({
        campaign: remoteCampaign,
        syncStartedAt,
        video: remoteVideo,
        handle,
        creatorName,
        sourceVideoId,
      });
      const publishedAt =
        toDate(remoteVideo.posted_at) ??
        toDate(remoteVideo.created_at) ??
        existingVideo?.publishedAt ??
        null;
      const views = toSafeInt(remoteVideo.current_views) ?? existingVideo?.views ?? null;
      const likes = toSafeInt(remoteVideo.likes) ?? existingVideo?.likes ?? null;
      const comments =
        toSafeInt(remoteVideo.comments) ?? existingVideo?.comments ?? null;

      const video =
        existingVideo != null
          ? await tx.video.update({
              where: {
                id: existingVideo.id,
              },
              data: {
                creatorId: account.creatorId,
                creatorPlatformAccountId: account.id,
                campaignId: localCampaignId,
                sourceVideoId,
                platform,
                videoUrl,
                titleOrCaption: existingVideo.titleOrCaption ?? null,
                publishedAt,
                views,
                likes,
                comments,
                rawPayload: payload,
                lastSyncedAt: syncStartedAt,
              },
              select: {
                id: true,
              },
            })
          : await tx.video.create({
              data: {
                creatorId: account.creatorId,
                creatorPlatformAccountId: account.id,
                campaignId: localCampaignId,
                sourceVideoId,
                platform,
                videoUrl,
                titleOrCaption: null,
                publishedAt,
                views,
                likes,
                comments,
                rawPayload: payload,
                lastSyncedAt: syncStartedAt,
              },
              select: {
                id: true,
              },
            });

      await tx.videoMetricsSnapshot.create({
        data: {
          videoId: video.id,
          capturedAt: syncStartedAt,
          views,
          likes,
          comments,
          sourcePayload: payload,
        },
      });
    });

    syncedVideoCount += 1;
  }

  revalidateViewsBaseWorkspace(args.organizationSlug, localCampaignId);

  return {
    localCampaignId,
    remoteCampaign,
    syncedCreatorCount: syncedCreatorIds.size,
    syncedVideoCount,
    skippedVideoCount,
    warnings: [...new Set(warnings)],
  };
}
