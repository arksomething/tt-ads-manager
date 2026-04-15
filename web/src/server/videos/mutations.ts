import {
  ExternalSource,
  Platform,
  SourceEntityType,
  type Prisma,
} from "@/lib/prisma-shim";
import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/db";
import { requireOrganizationMembership } from "@/server/auth/organizations";
import { canManageOrganization } from "@/server/auth/roles";
import { getAccessibleCampaignOptionsForMembership } from "@/server/campaigns/queries";
import {
  ViralAppApiError,
  viralAppClient,
} from "@/server/data-provider/viral-app-client";

import { setVideoReviewSchema, trackVideoSchema } from "./schemas";

const MAX_INT = 2_147_483_647;

type ProviderPlatform = "instagram" | "tiktok" | "youtube";
type ParsedVideoUrl = {
  platform: ProviderPlatform;
  videoId: string;
  initialUsername?: string;
};
type ProviderVideoPayload = Prisma.InputJsonObject;
type TrackedVideoResponse = {
  count: number;
  eventIds: string[];
};

function revalidateVideoWorkspace(organizationSlug: string, campaignId?: string) {
  revalidatePath("/app");
  revalidatePath(`/org/${organizationSlug}`);
  revalidatePath(`/org/${organizationSlug}/videos`);
  revalidatePath(`/org/${organizationSlug}/review`);
  revalidatePath(`/org/${organizationSlug}/campaigns`);

  if (campaignId) {
    revalidatePath(`/org/${organizationSlug}/campaigns?campaignId=${campaignId}`);
  }
}

function normalizeText(value: unknown) {
  if (value === null || value === undefined) {
    return null;
  }

  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function normalizeUsername(value: unknown) {
  const text = normalizeText(value);

  if (!text) {
    return null;
  }

  return text.startsWith("@") ? text.slice(1) : text;
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

function toSafeInt(value: number | null) {
  if (value === null) {
    return null;
  }

  return Math.max(0, Math.min(MAX_INT, Math.round(value)));
}

function toPercent(value: number | null) {
  if (value === null) {
    return null;
  }

  if (value > 0 && value < 1) {
    return Number((value * 100).toFixed(4));
  }

  return Number(value.toFixed(4));
}

function sanitizeTags(values: string[]) {
  const tags: string[] = [];
  const seen = new Set<string>();

  for (const value of values) {
    const normalized = normalizeText(value);

    if (!normalized) {
      continue;
    }

    const cleaned = normalized.replace(/^#/, "").slice(0, 64);
    const lookupKey = cleaned.toLowerCase();

    if (cleaned.length === 0 || seen.has(lookupKey)) {
      continue;
    }

    seen.add(lookupKey);
    tags.push(cleaned);
  }

  return tags;
}

function mapProviderPlatform(platform: ProviderPlatform) {
  switch (platform) {
    case "instagram":
      return Platform.INSTAGRAM_REELS;
    case "youtube":
      return Platform.YOUTUBE_SHORTS;
    default:
      return Platform.TIKTOK;
  }
}

function formatProviderPlatform(platform: ProviderPlatform) {
  switch (platform) {
    case "instagram":
      return "Instagram";
    case "youtube":
      return "YouTube";
    default:
      return "TikTok";
  }
}

function buildProfileUrl(platform: ProviderPlatform, username: string | null) {
  if (!username) {
    return null;
  }

  switch (platform) {
    case "instagram":
      return `https://www.instagram.com/${encodeURIComponent(username)}/`;
    case "youtube":
      return `https://www.youtube.com/@${encodeURIComponent(username)}`;
    default:
      return `https://www.tiktok.com/@${encodeURIComponent(username)}`;
  }
}

function buildVideoUrl(args: {
  platform: ProviderPlatform;
  videoId: string;
  username?: string | null;
}) {
  switch (args.platform) {
    case "instagram":
      return `https://www.instagram.com/reel/${encodeURIComponent(args.videoId)}/`;
    case "youtube":
      return `https://www.youtube.com/shorts/${encodeURIComponent(args.videoId)}`;
    default:
      return args.username
        ? `https://www.tiktok.com/@${encodeURIComponent(args.username)}/video/${encodeURIComponent(args.videoId)}`
        : `https://www.tiktok.com/video/${encodeURIComponent(args.videoId)}`;
  }
}

function parseVideoUrl(videoUrl: string): ParsedVideoUrl {
  let url: URL;

  try {
    url = new URL(videoUrl);
  } catch {
    throw new Error("Enter a valid TikTok, Instagram, or YouTube video URL.");
  }

  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const pathname = url.pathname.replace(/\/+$/, "");

  if (host.endsWith("tiktok.com")) {
    const accountVideoMatch = pathname.match(/^\/@([^/]+)\/video\/(\d+)/i);
    const genericVideoMatch = pathname.match(/^\/video\/(\d+)/i);

    if (accountVideoMatch) {
      return {
        platform: "tiktok",
        initialUsername: decodeURIComponent(accountVideoMatch[1] ?? ""),
        videoId: decodeURIComponent(accountVideoMatch[2] ?? ""),
      };
    }

    if (genericVideoMatch) {
      return {
        platform: "tiktok",
        videoId: decodeURIComponent(genericVideoMatch[1] ?? ""),
      };
    }

    throw new Error("Use a full TikTok video URL that includes the native video ID.");
  }

  if (host.endsWith("instagram.com")) {
    const match = pathname.match(/^\/(?:reel|reels|p)\/([^/?#]+)/i);

    if (!match) {
      throw new Error(
        "Use an Instagram reel or post URL that includes the native video ID.",
      );
    }

    return {
      platform: "instagram",
      videoId: decodeURIComponent(match[1] ?? ""),
    };
  }

  if (host === "youtu.be") {
    const videoId = pathname.split("/").filter(Boolean)[0];

    if (!videoId) {
      throw new Error(
        "Use a YouTube Shorts or watch URL that includes the native video ID.",
      );
    }

    return {
      platform: "youtube",
      videoId: decodeURIComponent(videoId),
    };
  }

  if (host.endsWith("youtube.com")) {
    const shortsMatch = pathname.match(/^\/shorts\/([^/?#]+)/i);

    if (shortsMatch) {
      return {
        platform: "youtube",
        videoId: decodeURIComponent(shortsMatch[1] ?? ""),
      };
    }

    const watchVideoId = normalizeText(url.searchParams.get("v"));

    if (watchVideoId) {
      return {
        platform: "youtube",
        videoId: watchVideoId,
      };
    }

    throw new Error(
      "Use a YouTube Shorts or watch URL that includes the native video ID.",
    );
  }

  throw new Error(
    "Only TikTok, Instagram Reels, and YouTube Shorts URLs can be tracked here.",
  );
}

function getPayloadValue(payload: ProviderVideoPayload, keys: string[]) {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(payload, key)) {
      return payload[key];
    }
  }

  return undefined;
}

function getPayloadString(payload: ProviderVideoPayload, keys: string[]) {
  return normalizeText(getPayloadValue(payload, keys));
}

function getPayloadUsername(payload: ProviderVideoPayload, keys: string[]) {
  return normalizeUsername(getPayloadValue(payload, keys));
}

function getPayloadNumber(payload: ProviderVideoPayload, keys: string[]) {
  const value = getPayloadValue(payload, keys);

  if (value === null || value === undefined || value === "") {
    return null;
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function getPayloadDate(payload: ProviderVideoPayload, keys: string[]) {
  return toDate(getPayloadValue(payload, keys));
}

function getPayloadStringArray(payload: ProviderVideoPayload, keys: string[]) {
  const value = getPayloadValue(payload, keys);

  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => normalizeText(entry))
    .filter((entry): entry is string => entry != null);
}

function createFallbackVideoPayload(parsedVideo: ParsedVideoUrl) {
  const syncedAt = new Date().toISOString();

  return {
    platform: parsedVideo.platform,
    platformVideoId: parsedVideo.videoId,
    accountUsername:
      parsedVideo.initialUsername ?? `tracked-${parsedVideo.videoId.slice(0, 12)}`,
    accountDisplayName: parsedVideo.initialUsername
      ? `@${parsedVideo.initialUsername}`
      : `Tracked ${formatProviderPlatform(parsedVideo.platform)} creator`,
    caption: null,
    hashtags: [],
    publishedAt: syncedAt,
    loadAt: syncedAt,
  } satisfies ProviderVideoPayload;
}

async function addTrackedVideoInViralApp(parsedVideo: ParsedVideoUrl) {
  try {
    return await viralAppClient.request<TrackedVideoResponse>({
      method: "POST",
      path: "/videos/tracked",
      body: {
        videos: [
          {
            videoId: parsedVideo.videoId,
            platform: parsedVideo.platform,
            ...(parsedVideo.initialUsername
              ? {
                  initial_username: parsedVideo.initialUsername,
                }
              : {}),
          },
        ],
        isCompetitor: false,
      },
    });
  } catch (error) {
    if (
      error instanceof ViralAppApiError &&
      (error.status === 409 || error.payload?.code === "NOT_UNIQUE")
    ) {
      return {
        count: 0,
        eventIds: [],
      } satisfies TrackedVideoResponse;
    }

    throw error;
  }
}

async function getTrackedVideoDetails(parsedVideo: ParsedVideoUrl) {
  try {
    return await viralAppClient.request<ProviderVideoPayload>({
      path: `/videos/${parsedVideo.platform}/${parsedVideo.videoId}`,
    });
  } catch {
    try {
      return await viralAppClient.request<ProviderVideoPayload>({
        path: `/live/${parsedVideo.platform}/videos/${parsedVideo.videoId}`,
      });
    } catch {
      return null;
    }
  }
}

async function upsertSourceMapping(args: {
  tx: Prisma.TransactionClient;
  organizationId: string;
  localEntityType: SourceEntityType;
  localEntityId: string;
  externalResourceType: string;
  externalId: string;
  lastSyncedAt: Date;
  rawPayload: ProviderVideoPayload;
}) {
  const {
    tx,
    organizationId,
    localEntityType,
    localEntityId,
    externalResourceType,
    externalId,
    lastSyncedAt,
    rawPayload,
  } = args;

  await tx.sourceMapping.upsert({
    where: {
      externalSource_externalResourceType_externalId: {
        externalSource: ExternalSource.DATA_PROVIDER,
        externalResourceType,
        externalId,
      },
    },
    update: {
      organizationId,
      localEntityType,
      localEntityId,
      lastSyncedAt,
      rawPayload,
    },
    create: {
      organizationId,
      localEntityType,
      localEntityId,
      externalSource: ExternalSource.DATA_PROVIDER,
      externalResourceType,
      externalId,
      lastSyncedAt,
      rawPayload,
    },
  });
}

export async function trackVideoForOrganization(args: {
  organizationSlug: string;
  input: unknown;
}) {
  const { organizationSlug, input } = args;
  const membership = await requireOrganizationMembership(organizationSlug);
  const values = trackVideoSchema.parse(input);
  const accessibleCampaigns = await getAccessibleCampaignOptionsForMembership(
    membership,
  );
  const accessibleCampaignIds = new Set(accessibleCampaigns.map((campaign) => campaign.id));

  if (accessibleCampaignIds.size === 0) {
    throw new Error("You need access to at least one campaign before tracking videos.");
  }

  if (!accessibleCampaignIds.has(values.campaignId)) {
    throw new Error("Select a campaign you can access.");
  }

  const parsedVideo = parseVideoUrl(values.videoUrl);
  const trackedVideo = await addTrackedVideoInViralApp(parsedVideo);
  const providerVideo =
    (await getTrackedVideoDetails(parsedVideo)) ?? createFallbackVideoPayload(parsedVideo);
  const localPlatform = mapProviderPlatform(parsedVideo.platform);
  const sourceAccountId = getPayloadString(providerVideo, [
    "platformAccountId",
    "platform_account_id",
  ]);

  const accountUsername =
    getPayloadUsername(providerVideo, ["accountUsername", "account_username"]) ??
    parsedVideo.initialUsername ??
    null;
  const accountDisplayName = getPayloadString(providerVideo, [
    "accountDisplayName",
    "account_display_name",
    "displayName",
    "display_name",
  ]);
  const titleOrCaption = getPayloadString(providerVideo, [
    "caption",
    "title",
    "titleOrCaption",
    "title_or_caption",
  ]);
  const publishedAt = getPayloadDate(providerVideo, [
    "publishedAt",
    "published_at",
    "createdAt",
    "created_at",
  ]);
  const lastSyncedAt =
    getPayloadDate(providerVideo, [
      "loadAt",
      "load_at",
      "analyticsLatestLoadAt",
      "analytics_latest_load_at",
      "updatedAt",
      "updated_at",
    ]) ?? new Date();
  const views = toSafeInt(
    getPayloadNumber(providerVideo, ["viewCount", "view_count"]),
  );
  const likes = toSafeInt(
    getPayloadNumber(providerVideo, ["likeCount", "like_count"]),
  );
  const comments = toSafeInt(
    getPayloadNumber(providerVideo, ["commentCount", "comment_count"]),
  );
  const engagementRate = toPercent(
    getPayloadNumber(providerVideo, ["engagementRate", "engagement_rate"]),
  );
  const contentTags = sanitizeTags(
    getPayloadStringArray(providerVideo, ["hashtags", "contentTags", "content_tags"]),
  );

  const persistedVideo = await prisma.$transaction(async (tx) => {
    const existingAccountSelect = {
      id: true,
      creatorId: true,
      handle: true,
      profileUrl: true,
      sourceAccountId: true,
    } satisfies Prisma.CreatorPlatformAccountSelect;

    let existingAccount =
      sourceAccountId != null
        ? await tx.creatorPlatformAccount.findFirst({
            where: {
              platform: localPlatform,
              sourceAccountId,
              creator: {
                organizationId: membership.organizationId,
              },
            },
            select: existingAccountSelect,
          })
        : null;

    if (!existingAccount && accountUsername) {
      existingAccount = await tx.creatorPlatformAccount.findFirst({
        where: {
          platform: localPlatform,
          handle: accountUsername,
          creator: {
            organizationId: membership.organizationId,
          },
        },
        select: existingAccountSelect,
      });
    }

    const nextHandle =
      accountUsername ??
      existingAccount?.handle ??
      sourceAccountId ??
      `tracked-${parsedVideo.videoId.slice(0, 12)}`;
    const nextProfileUrl =
      buildProfileUrl(parsedVideo.platform, accountUsername ?? parsedVideo.initialUsername ?? null) ??
      existingAccount?.profileUrl ??
      null;
    const nextSourceAccountId = sourceAccountId ?? existingAccount?.sourceAccountId ?? null;
    const creatorDisplayName =
      accountDisplayName ??
      (accountUsername ? `@${accountUsername}` : null) ??
      `Tracked ${formatProviderPlatform(parsedVideo.platform)} creator`;

    const account =
      existingAccount != null
        ? await tx.creatorPlatformAccount.update({
            where: {
              id: existingAccount.id,
            },
            data: {
              handle: nextHandle,
              sourceAccountId: nextSourceAccountId,
              profileUrl: nextProfileUrl,
              lastSyncedAt,
              rawPayload: providerVideo,
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
                displayName: creatorDisplayName,
              },
              select: {
                id: true,
              },
            });

            return tx.creatorPlatformAccount.create({
              data: {
                creatorId: creator.id,
                platform: localPlatform,
                sourceAccountId: nextSourceAccountId,
                handle: nextHandle,
                profileUrl: nextProfileUrl,
                lastSyncedAt,
                rawPayload: providerVideo,
              },
              select: {
                id: true,
                creatorId: true,
              },
            });
          })();

    if (nextSourceAccountId) {
      await upsertSourceMapping({
        tx,
        organizationId: membership.organizationId,
        localEntityType: SourceEntityType.PLATFORM_ACCOUNT,
        localEntityId: account.id,
        externalResourceType: `viral-account:${localPlatform}`,
        externalId: nextSourceAccountId,
        lastSyncedAt,
        rawPayload: providerVideo,
      });
    }

    await tx.campaignCreator.upsert({
      where: {
        campaignId_creatorId: {
          campaignId: values.campaignId,
          creatorId: account.creatorId,
        },
      },
      update: {},
      create: {
        campaignId: values.campaignId,
        creatorId: account.creatorId,
      },
    });

    const existingVideo = await tx.video.findUnique({
      where: {
        platform_sourceVideoId: {
          platform: localPlatform,
          sourceVideoId: parsedVideo.videoId,
        },
      },
      select: {
        id: true,
        campaignId: true,
        titleOrCaption: true,
        publishedAt: true,
        views: true,
        likes: true,
        comments: true,
        engagementRate: true,
        contentTags: true,
      },
    });

    const videoUrl = buildVideoUrl({
      platform: parsedVideo.platform,
      videoId: parsedVideo.videoId,
      username: accountUsername ?? parsedVideo.initialUsername,
    });

    const video =
      existingVideo != null
        ? await tx.video.update({
            where: {
              id: existingVideo.id,
            },
            data: {
              creatorId: account.creatorId,
              creatorPlatformAccountId: account.id,
              campaignId: values.campaignId,
              sourceVideoId: parsedVideo.videoId,
              platform: localPlatform,
              videoUrl,
              titleOrCaption: titleOrCaption ?? existingVideo.titleOrCaption ?? null,
              publishedAt: publishedAt ?? existingVideo.publishedAt ?? null,
              views: views ?? existingVideo.views ?? null,
              likes: likes ?? existingVideo.likes ?? null,
              comments: comments ?? existingVideo.comments ?? null,
              engagementRate:
                engagementRate ?? existingVideo.engagementRate ?? null,
              contentTags:
                contentTags.length > 0 ? contentTags : existingVideo.contentTags,
              rawPayload: providerVideo,
              lastSyncedAt,
            },
            select: {
              id: true,
              campaignId: true,
            },
          })
        : await tx.video.create({
            data: {
              creatorId: account.creatorId,
              creatorPlatformAccountId: account.id,
              campaignId: values.campaignId,
              sourceVideoId: parsedVideo.videoId,
              platform: localPlatform,
              videoUrl,
              titleOrCaption,
              publishedAt,
              views,
              likes,
              comments,
              engagementRate,
              contentTags,
              rawPayload: providerVideo,
              lastSyncedAt,
            },
            select: {
              id: true,
              campaignId: true,
            },
          });

    await tx.videoMetricsSnapshot.create({
      data: {
        videoId: video.id,
        capturedAt: lastSyncedAt,
        views,
        likes,
        comments,
        engagementRate,
        sourcePayload: providerVideo,
      },
    });

    await upsertSourceMapping({
      tx,
      organizationId: membership.organizationId,
      localEntityType: SourceEntityType.VIDEO,
      localEntityId: video.id,
      externalResourceType: `viral-video:${localPlatform}`,
      externalId: parsedVideo.videoId,
      lastSyncedAt,
      rawPayload: providerVideo,
    });

    return video;
  });

  revalidateVideoWorkspace(organizationSlug, persistedVideo.campaignId ?? undefined);

  return {
    campaignId: persistedVideo.campaignId,
    eventIds: trackedVideo.eventIds,
    videoId: persistedVideo.id,
  };
}

export async function setVideoReviewForOrganization(args: {
  organizationSlug: string;
  input: unknown;
}) {
  const { organizationSlug, input } = args;
  const membership = await requireOrganizationMembership(organizationSlug);
  const values = setVideoReviewSchema.parse(input);
  const accessibleCampaigns = await getAccessibleCampaignOptionsForMembership(
    membership,
  );
  const accessibleCampaignIds = accessibleCampaigns.map((campaign) => campaign.id);
  const canSeeAllOrganizationData = canManageOrganization(membership.role);

  if (!canSeeAllOrganizationData && accessibleCampaignIds.length === 0) {
    throw new Error("You need campaign access before reviewing videos.");
  }

  const video = await prisma.video.findFirst({
    where: {
      id: values.videoId,
      creator: {
        organizationId: membership.organizationId,
      },
      ...(canSeeAllOrganizationData
        ? {}
        : {
            campaignId: {
              in: accessibleCampaignIds,
            },
          }),
    },
    select: {
      id: true,
      campaignId: true,
    },
  });

  if (!video) {
    throw new Error("Video access denied.");
  }

  if (values.action === "mark-reviewed") {
    await prisma.videoReview.upsert({
      where: {
        videoId_reviewerUserId: {
          videoId: video.id,
          reviewerUserId: membership.userId,
        },
      },
      update: {
        reviewedAt: new Date(),
      },
      create: {
        videoId: video.id,
        reviewerUserId: membership.userId,
      },
    });
  } else {
    await prisma.videoReview.deleteMany({
      where: {
        videoId: video.id,
        reviewerUserId: membership.userId,
      },
    });
  }

  revalidateVideoWorkspace(organizationSlug, video.campaignId ?? undefined);

  return {
    reviewed: values.action === "mark-reviewed",
    videoId: video.id,
  };
}
