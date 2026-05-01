import {
  CreatorStatus,
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
import {
  removeCreatorContactPointForOrganization as removeCreatorContactPointForOrganizationMessaging,
  sendSparkCodeRequestForOrganization as sendSparkCodeRequestForOrganizationMessaging,
  upsertCreatorContactPointForOrganization as upsertCreatorContactPointForOrganizationMessaging,
} from "@/server/messaging/mutations";

import {
  createCreatorSchema,
  createPlatformAccountSchema,
  setCreatorStatusSchema,
  trackCreatorAccountFormSchema,
} from "./schemas";

const VIRAL_ACCOUNT_RESOURCE_TYPE_PREFIX = "viral-account";
const AUTO_IMPORTED_TIKTOK_CAMPAIGN_NAME = "All Tracked Creators";

type ProviderPlatform = "instagram" | "tiktok" | "youtube";
type ParsedTrackedAccountUrl = {
  platform: ProviderPlatform;
  username: string;
  profileUrl: string;
};
type TrackAccountResponse = {
  count: number;
  eventIds: string[];
};
type ProviderAccountPayload = Prisma.InputJsonObject;
type ProviderVideoPayload = Prisma.InputJsonObject;
type PagedProviderRecordsResponse = {
  data?: Array<Record<string, unknown>>;
  pageCount?: number | string | null;
};
type TrackedTikTokAccountRecord = {
  id: string;
  platformAccountId: string | null;
  username: string | null;
  displayName: string | null;
};
type TrackedTikTokVideoRecord = {
  id: string | null;
  orgAccountId: string | null;
  platformVideoId: string;
  platformAccountId: string | null;
  username: string | null;
  accountDisplayName: string | null;
  createdAt: string | null;
  publishedAt: string | null;
  viewCount: number | string | null;
  likeCount: number | string | null;
  commentCount: number | string | null;
  engagementRate: number | string | null;
  hashtags: string[] | null;
};

function revalidateCreatorWorkspace(organizationSlug: string) {
  const paths = [
    "/app",
    `/org/${organizationSlug}`,
    `/org/${organizationSlug}/campaigns`,
    `/org/${organizationSlug}/creators`,
    `/org/${organizationSlug}/videos`,
    `/org/${organizationSlug}/payouts`,
    `/org/${organizationSlug}/view-tally`,
  ];

  for (const path of paths) {
    try {
      revalidatePath(path);
    } catch {
      // Allow CLI backfills to finish even when there is no request store.
    }
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

function getPayloadValue(payload: ProviderAccountPayload, keys: string[]) {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(payload, key)) {
      return payload[key];
    }
  }

  return undefined;
}

function getPayloadString(payload: ProviderAccountPayload, keys: string[]) {
  return normalizeText(getPayloadValue(payload, keys));
}

function getPayloadUsername(payload: ProviderAccountPayload, keys: string[]) {
  return normalizeUsername(getPayloadValue(payload, keys));
}

function getPayloadNumber(payload: ProviderAccountPayload, keys: string[]) {
  const value = getPayloadValue(payload, keys);

  if (value === null || value === undefined || value === "") {
    return null;
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function getPayloadDate(payload: ProviderVideoPayload, keys: string[]) {
  const value = getPayloadValue(payload, keys);

  if (value === null || value === undefined || value === "") {
    return null;
  }

  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
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

function toSafeInt(value: number | null) {
  if (value === null) {
    return null;
  }

  return Math.max(0, Math.min(2_147_483_647, Math.round(value)));
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

function buildProfileUrl(platform: ProviderPlatform, username: string) {
  switch (platform) {
    case "instagram":
      return `https://www.instagram.com/${encodeURIComponent(username)}/`;
    case "youtube":
      return `https://www.youtube.com/@${encodeURIComponent(username)}`;
    default:
      return `https://www.tiktok.com/@${encodeURIComponent(username)}`;
  }
}

function buildVideoUrl(args: { platform: ProviderPlatform; videoId: string; username: string | null }) {
  switch (args.platform) {
    case "instagram":
      return args.username
        ? `https://www.instagram.com/reel/${encodeURIComponent(args.videoId)}/`
        : `https://www.instagram.com/reel/${encodeURIComponent(args.videoId)}/`;
    case "youtube":
      return `https://www.youtube.com/watch?v=${encodeURIComponent(args.videoId)}`;
    default:
      return args.username
        ? `https://www.tiktok.com/@${encodeURIComponent(args.username)}/video/${encodeURIComponent(args.videoId)}`
        : `https://www.tiktok.com/video/${encodeURIComponent(args.videoId)}`;
  }
}

function sanitizeTags(tags: string[]) {
  return [...new Set(tags.map((tag) => tag.trim().replace(/^#+/, "")).filter(Boolean))].slice(
    0,
    25,
  );
}

function parseTrackedAccountUrl(profileUrl: string): ParsedTrackedAccountUrl {
  let url: URL;

  try {
    url = new URL(profileUrl);
  } catch {
    throw new Error("Enter a valid TikTok, Instagram, or YouTube profile URL.");
  }

  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const pathname = url.pathname.replace(/\/+$/, "");

  if (host.endsWith("tiktok.com")) {
    const match = pathname.match(/^\/@([^/]+)/i);
    const username = normalizeUsername(match?.[1]);

    if (!username) {
      throw new Error("Use a TikTok profile URL like https://www.tiktok.com/@creator.");
    }

    return {
      platform: "tiktok",
      username,
      profileUrl: buildProfileUrl("tiktok", username),
    };
  }

  if (host.endsWith("instagram.com")) {
    const segment = pathname.split("/").filter(Boolean)[0];
    const username = normalizeUsername(segment);
    const blockedSegments = new Set(["p", "reel", "reels", "stories", "tv"]);

    if (!username || blockedSegments.has(username.toLowerCase())) {
      throw new Error(
        "Use an Instagram profile URL like https://www.instagram.com/creator/.",
      );
    }

    return {
      platform: "instagram",
      username,
      profileUrl: buildProfileUrl("instagram", username),
    };
  }

  if (host.endsWith("youtube.com")) {
    const match = pathname.match(/^\/@([^/]+)/i);
    const username = normalizeUsername(match?.[1]);

    if (!username) {
      throw new Error(
        "Use a YouTube handle URL like https://www.youtube.com/@creator.",
      );
    }

    return {
      platform: "youtube",
      username,
      profileUrl: buildProfileUrl("youtube", username),
    };
  }

  throw new Error(
    "Only TikTok, Instagram, and YouTube profile URLs can be tracked here.",
  );
}

function getCreatorDisplayName(accountDisplayName: string | null, username: string) {
  const fallbackLabel = `@${username}`.slice(0, 160);
  const normalizedDisplayName = normalizeText(accountDisplayName);

  if (!normalizedDisplayName) {
    return fallbackLabel;
  }

  return normalizedDisplayName.slice(0, 160);
}

function getTrackedAccountErrorMessage(error: unknown) {
  if (error instanceof ViralAppApiError) {
    const payload = error.payload as
      | {
          data?: {
            issues?: Array<{
              message?: string;
            }>;
          };
        }
      | undefined;
    const firstIssue = payload?.data?.issues?.find(
      (issue) => typeof issue?.message === "string" && issue.message.length > 0,
    );

    if (firstIssue?.message) {
      return firstIssue.message;
    }
  }

  return error instanceof Error ? error.message : "Something went wrong.";
}

async function addTrackedAccountInViralApp(args: {
  maxVideos: number;
  parsedAccount: ParsedTrackedAccountUrl;
}) {
  const { maxVideos, parsedAccount } = args;

  try {
    return await viralAppClient.request<TrackAccountResponse>({
      method: "POST",
      path: "/accounts/tracked",
      body: {
        accounts: [
          {
            platform: parsedAccount.platform,
            username: parsedAccount.username,
            max_videos: maxVideos,
          },
        ],
        isCompetitor: false,
      },
    });
  } catch (error) {
    throw new Error(getTrackedAccountErrorMessage(error));
  }
}

async function getTrackedAccountDetails(parsedAccount: ParsedTrackedAccountUrl) {
  try {
    return await viralAppClient.request<ProviderAccountPayload>({
      path: `/live/${parsedAccount.platform}/accounts/username/${encodeURIComponent(
        parsedAccount.username,
      )}`,
    });
  } catch {
    return null;
  }
}

async function getPagedProviderRecords(args: {
  path: string;
  perPage?: number;
  extraQuery?: Record<string, string | number | boolean | undefined>;
}) {
  const records: Array<Record<string, unknown>> = [];
  let page = 1;
  let pageCount: number | null = null;

  while (pageCount == null || page <= pageCount) {
    const response = await viralAppClient.request<PagedProviderRecordsResponse>({
      path: args.path,
      query: {
        ...(args.extraQuery ?? {}),
        ...(args.perPage ? { perPage: args.perPage } : {}),
        page,
      },
    });

    records.push(...(response.data ?? []));
    const resolvedPageCount = Number(response.pageCount ?? 1);
    pageCount = Number.isFinite(resolvedPageCount)
      ? Math.max(1, Math.trunc(resolvedPageCount))
      : 1;

    if ((response.data ?? []).length === 0) {
      break;
    }

    page += 1;
  }

  return records;
}

async function getAllTrackedTikTokAccountsInViralApp() {
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
      id: normalizeText(record.id) ?? "",
      platformAccountId: normalizeText(record.platformAccountId),
      username:
        normalizeUsername(record.username) ?? normalizeUsername(record.initialUsername),
      displayName: normalizeText(record.displayName),
    }))
    .filter((record) => record.id.length > 0);
}

async function getAllTrackedTikTokVideosInViralApp() {
  const records = await getPagedProviderRecords({
    path: "/videos",
    perPage: 100,
    extraQuery: {
      sortCol: "publishedAt",
      sortDir: "desc",
      platforms: "tiktok",
      viewMode: "internal",
    },
  });

  return records
    .map((record) => ({
      id: normalizeText(record.id),
      orgAccountId: normalizeText(record.orgAccountId),
      platformVideoId: normalizeText(record.platformVideoId) ?? "",
      platformAccountId: normalizeText(record.platformAccountId),
      username: normalizeUsername(record.username),
      accountDisplayName: normalizeText(record.accountDisplayName),
      createdAt: normalizeText(record.createdAt),
      publishedAt: normalizeText(record.publishedAt),
      viewCount:
        typeof record.viewCount === "number" || typeof record.viewCount === "string"
          ? record.viewCount
          : null,
      likeCount:
        typeof record.likeCount === "number" || typeof record.likeCount === "string"
          ? record.likeCount
          : null,
      commentCount:
        typeof record.commentCount === "number" || typeof record.commentCount === "string"
          ? record.commentCount
          : null,
      engagementRate:
        typeof record.engagementRate === "number" ||
        typeof record.engagementRate === "string"
          ? record.engagementRate
          : null,
      hashtags: Array.isArray(record.hashtags)
        ? record.hashtags
            .map((entry) => normalizeText(entry))
            .filter((entry): entry is string => entry != null)
        : null,
    }))
    .filter((record) => record.platformVideoId.length > 0);
}

async function upsertAccountSourceMapping(args: {
  organizationId: string;
  localEntityId: string;
  externalId: string;
  platform: Platform;
  rawPayload: ProviderAccountPayload;
  tx: Prisma.TransactionClient;
}) {
  const { organizationId, localEntityId, externalId, platform, rawPayload, tx } =
    args;
  const lastSyncedAt = new Date();

  await tx.sourceMapping.upsert({
    where: {
      externalSource_externalResourceType_externalId: {
        externalSource: ExternalSource.DATA_PROVIDER,
        externalResourceType: `${VIRAL_ACCOUNT_RESOURCE_TYPE_PREFIX}:${platform}`,
        externalId,
      },
    },
    update: {
      organizationId,
      localEntityType: SourceEntityType.PLATFORM_ACCOUNT,
      localEntityId,
      lastSyncedAt,
      rawPayload,
    },
    create: {
      organizationId,
      localEntityType: SourceEntityType.PLATFORM_ACCOUNT,
      localEntityId,
      externalSource: ExternalSource.DATA_PROVIDER,
      externalResourceType: `${VIRAL_ACCOUNT_RESOURCE_TYPE_PREFIX}:${platform}`,
      externalId,
      lastSyncedAt,
      rawPayload,
    },
  });
}

async function upsertCreatorSourceMapping(args: {
  organizationId: string;
  localEntityId: string;
  externalId: string;
  rawPayload: Prisma.InputJsonValue;
  tx: Prisma.TransactionClient;
}) {
  const { organizationId, localEntityId, externalId, rawPayload, tx } = args;
  const lastSyncedAt = new Date();

  await tx.sourceMapping.upsert({
    where: {
      externalSource_externalResourceType_externalId: {
        externalSource: ExternalSource.DATA_PROVIDER,
        externalResourceType: "viral-creator",
        externalId,
      },
    },
    update: {
      organizationId,
      localEntityType: SourceEntityType.CREATOR,
      localEntityId,
      lastSyncedAt,
      rawPayload,
    },
    create: {
      organizationId,
      localEntityType: SourceEntityType.CREATOR,
      localEntityId,
      externalSource: ExternalSource.DATA_PROVIDER,
      externalResourceType: "viral-creator",
      externalId,
      lastSyncedAt,
      rawPayload,
    },
  });
}

async function ensureAutoImportedTikTokCampaign(args: {
  organizationId: string;
  ownerUserId: string | null;
}) {
  const existingCampaign = await prisma.campaign.findFirst({
    where: {
      organizationId: args.organizationId,
      name: AUTO_IMPORTED_TIKTOK_CAMPAIGN_NAME,
    },
    select: {
      id: true,
    },
  });

  if (existingCampaign) {
    return existingCampaign.id;
  }

  const createdCampaign = await prisma.campaign.create({
    data: {
      organizationId: args.organizationId,
      ownerUserId: args.ownerUserId,
      name: AUTO_IMPORTED_TIKTOK_CAMPAIGN_NAME,
    },
    select: {
      id: true,
    },
  });

  return createdCampaign.id;
}

async function upsertTrackedTikTokAccountLocally(args: {
  tx: Prisma.TransactionClient;
  organizationId: string;
  campaignId: string;
  trackedAccountExternalId: string | null;
  providerPayload: ProviderAccountPayload;
}) {
  const syncedAt = new Date();
  const accountUsername = getPayloadUsername(args.providerPayload, [
    "accountUsername",
    "account_username",
    "username",
  ]);
  const sourceAccountId = getPayloadString(args.providerPayload, [
    "platformAccountId",
    "platform_account_id",
  ]);
  const accountDisplayName = getPayloadString(args.providerPayload, [
    "accountDisplayName",
    "account_display_name",
    "displayName",
    "display_name",
  ]);
  const followerCount = toSafeInt(
    getPayloadNumber(args.providerPayload, ["followerCount", "follower_count"]),
  );
  const averageViews = toSafeInt(
    getPayloadNumber(args.providerPayload, [
      "averageViews",
      "average_views",
      "averageViewsPerVideo",
      "average_views_per_video",
    ]),
  );
  const averageEngagementRate = toPercent(
    getPayloadNumber(args.providerPayload, ["engagementRate", "engagement_rate"]),
  );

  if (!accountUsername && !sourceAccountId) {
    return null;
  }

  const existingAccountSelect = {
    id: true,
    creatorId: true,
    handle: true,
    profileUrl: true,
    sourceAccountId: true,
    followerCount: true,
    averageViews: true,
    averageEngagementRate: true,
    creator: {
      select: {
        internalStatus: true,
      },
    },
  } satisfies Prisma.CreatorPlatformAccountSelect;

  let existingAccount =
    sourceAccountId != null
      ? await args.tx.creatorPlatformAccount.findFirst({
          where: {
            platform: Platform.TIKTOK,
            sourceAccountId,
            creator: {
              organizationId: args.organizationId,
            },
          },
          select: existingAccountSelect,
        })
      : null;

  if (!existingAccount && accountUsername) {
    existingAccount = await args.tx.creatorPlatformAccount.findFirst({
      where: {
        platform: Platform.TIKTOK,
        handle: {
          equals: accountUsername,
          mode: "insensitive",
        },
        creator: {
          organizationId: args.organizationId,
        },
      },
      select: existingAccountSelect,
    });
  }

  const nextProfileUrl =
    (accountUsername ? buildProfileUrl("tiktok", accountUsername) : null) ??
    existingAccount?.profileUrl ??
    null;
  const nextSourceAccountId = sourceAccountId ?? existingAccount?.sourceAccountId ?? null;

  const account =
    existingAccount != null
      ? await args.tx.creatorPlatformAccount.update({
          where: {
            id: existingAccount.id,
          },
          data: {
            handle: accountUsername ?? existingAccount.handle,
            sourceAccountId: nextSourceAccountId,
            profileUrl: nextProfileUrl,
            followerCount: followerCount ?? existingAccount.followerCount ?? null,
            averageViews: averageViews ?? existingAccount.averageViews ?? null,
            averageEngagementRate:
              averageEngagementRate ?? existingAccount.averageEngagementRate ?? null,
            lastSyncedAt: syncedAt,
            rawPayload: args.providerPayload,
          },
          select: {
            id: true,
            creatorId: true,
            handle: true,
            sourceAccountId: true,
          },
        })
      : await (async () => {
          const creator = await args.tx.creator.create({
            data: createCreatorSchema.parse({
              organizationId: args.organizationId,
              displayName: getCreatorDisplayName(
                accountDisplayName,
                accountUsername ?? sourceAccountId ?? "tracked-creator",
              ),
              internalStatus: CreatorStatus.NEW,
            }),
            select: {
              id: true,
            },
          });

          return args.tx.creatorPlatformAccount.create({
            data: {
              ...createPlatformAccountSchema.parse({
                creatorId: creator.id,
                platform: Platform.TIKTOK,
                sourceAccountId: nextSourceAccountId ?? undefined,
                handle: accountUsername ?? sourceAccountId ?? `tracked-${creator.id.slice(0, 10)}`,
                profileUrl: nextProfileUrl ?? undefined,
                followerCount: followerCount ?? undefined,
                averageViews: averageViews ?? undefined,
                averageEngagementRate: averageEngagementRate ?? undefined,
              }),
              lastSyncedAt: syncedAt,
              rawPayload: args.providerPayload,
            },
            select: {
              id: true,
              creatorId: true,
              handle: true,
              sourceAccountId: true,
            },
          });
        })();

  if (nextSourceAccountId) {
    await upsertAccountSourceMapping({
      organizationId: args.organizationId,
      localEntityId: account.id,
      externalId: nextSourceAccountId,
      platform: Platform.TIKTOK,
      rawPayload: args.providerPayload,
      tx: args.tx,
    });
  }

  if (args.trackedAccountExternalId) {
    await upsertCreatorSourceMapping({
      organizationId: args.organizationId,
      localEntityId: account.creatorId,
      externalId: args.trackedAccountExternalId,
      rawPayload: args.providerPayload,
      tx: args.tx,
    });
  }

  await args.tx.campaignCreator.upsert({
    where: {
      campaignId_creatorId: {
        campaignId: args.campaignId,
        creatorId: account.creatorId,
      },
    },
    update: {},
    create: {
      campaignId: args.campaignId,
      creatorId: account.creatorId,
    },
  });

  return {
    accountId: account.id,
    creatorId: account.creatorId,
    handle: account.handle,
    sourceAccountId: account.sourceAccountId ?? null,
  };
}

export async function trackCreatorAccountForOrganization(
  organizationSlug: string,
  input: unknown,
) {
  const membership = await requireOrganizationMembership(organizationSlug);
  const values = trackCreatorAccountFormSchema.parse(input);
  const accessibleCampaigns = await getAccessibleCampaignOptionsForMembership(
    membership,
  );
  const accessibleCampaignIds = new Set(
    accessibleCampaigns.map((campaign) => campaign.id),
  );

  if (accessibleCampaignIds.size === 0) {
    throw new Error(
      "Create or join at least one campaign before tracking creator accounts.",
    );
  }

  if (!accessibleCampaignIds.has(values.campaignId)) {
    throw new Error("Choose a campaign you can access.");
  }

  const parsedAccount = parseTrackedAccountUrl(values.profileUrl);
  const trackedAccount = await addTrackedAccountInViralApp({
    parsedAccount,
    maxVideos: values.maxVideos,
  });
  const liveAccountPayload = await getTrackedAccountDetails(parsedAccount);
  const fallbackPayload = {
    accountDisplayName: `@${parsedAccount.username}`,
    accountUsername: parsedAccount.username,
    maxVideos: values.maxVideos,
    platform: parsedAccount.platform,
    profileUrl: parsedAccount.profileUrl,
    trackedEventIds: trackedAccount.eventIds,
    username: parsedAccount.username,
  } satisfies ProviderAccountPayload;
  const providerPayload = {
    ...(liveAccountPayload ?? fallbackPayload),
    maxVideos: values.maxVideos,
    profileUrl: parsedAccount.profileUrl,
    trackedEventIds: trackedAccount.eventIds,
  } satisfies ProviderAccountPayload;
  const sourceAccountId = getPayloadString(providerPayload, [
    "platformAccountId",
    "platform_account_id",
  ]);
  const accountUsername =
    getPayloadUsername(providerPayload, [
      "accountUsername",
      "account_username",
      "username",
    ]) ?? parsedAccount.username;
  const accountDisplayName = getPayloadString(providerPayload, [
    "accountDisplayName",
    "account_display_name",
    "displayName",
    "display_name",
  ]);
  const followerCount = toSafeInt(
    getPayloadNumber(providerPayload, ["followerCount", "follower_count"]),
  );
  const averageViews = toSafeInt(
    getPayloadNumber(providerPayload, [
      "averageViews",
      "average_views",
      "averageViewsPerVideo",
      "average_views_per_video",
    ]),
  );
  const averageEngagementRate = toPercent(
    getPayloadNumber(providerPayload, ["engagementRate", "engagement_rate"]),
  );
  const localPlatform = mapProviderPlatform(parsedAccount.platform);
  const syncedAt = new Date();

  const creator = await prisma.$transaction(async (tx) => {
    async function linkCreatorToCampaign(creatorId: string) {
      await tx.campaignCreator.upsert({
        where: {
          campaignId_creatorId: {
            campaignId: values.campaignId,
            creatorId,
          },
        },
        update: {},
        create: {
          campaignId: values.campaignId,
          creatorId,
        },
      });
    }

    const existingAccountSelect = {
      id: true,
      creatorId: true,
      handle: true,
      profileUrl: true,
      sourceAccountId: true,
      followerCount: true,
      averageViews: true,
      averageEngagementRate: true,
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

    if (!existingAccount) {
      existingAccount = await tx.creatorPlatformAccount.findFirst({
        where: {
          platform: localPlatform,
          handle: {
            equals: accountUsername,
            mode: "insensitive",
          },
          creator: {
            organizationId: membership.organizationId,
          },
        },
        select: existingAccountSelect,
      });
    }

    const nextProfileUrl =
      buildProfileUrl(parsedAccount.platform, accountUsername) ??
      existingAccount?.profileUrl ??
      null;
    const nextSourceAccountId = sourceAccountId ?? existingAccount?.sourceAccountId;

    if (existingAccount) {
      const updatedAccount = await tx.creatorPlatformAccount.update({
        where: {
          id: existingAccount.id,
        },
        data: {
          handle: accountUsername,
          sourceAccountId: nextSourceAccountId,
          profileUrl: nextProfileUrl,
          followerCount: followerCount ?? existingAccount.followerCount ?? null,
          averageViews: averageViews ?? existingAccount.averageViews ?? null,
          averageEngagementRate:
            averageEngagementRate ?? existingAccount.averageEngagementRate ?? null,
          lastSyncedAt: syncedAt,
          rawPayload: providerPayload,
        },
        select: {
          creatorId: true,
          id: true,
        },
      });

      if (nextSourceAccountId) {
        await upsertAccountSourceMapping({
          organizationId: membership.organizationId,
          localEntityId: updatedAccount.id,
          externalId: nextSourceAccountId,
          platform: localPlatform,
          rawPayload: providerPayload,
          tx,
        });
      }

      await linkCreatorToCampaign(updatedAccount.creatorId);

      return updatedAccount;
    }

    const creatorInput = createCreatorSchema.parse({
      organizationId: membership.organizationId,
      displayName: getCreatorDisplayName(accountDisplayName, accountUsername),
      internalStatus: CreatorStatus.NEW,
    });
    const createdCreator = await tx.creator.create({
      data: creatorInput,
      select: {
        id: true,
      },
    });
    const accountInput = createPlatformAccountSchema.parse({
      creatorId: createdCreator.id,
      platform: localPlatform,
      sourceAccountId: nextSourceAccountId ?? undefined,
      handle: accountUsername,
      profileUrl: nextProfileUrl ?? undefined,
      followerCount: followerCount ?? undefined,
      averageViews: averageViews ?? undefined,
      averageEngagementRate: averageEngagementRate ?? undefined,
    });
    const createdAccount = await tx.creatorPlatformAccount.create({
      data: {
        ...accountInput,
        lastSyncedAt: syncedAt,
        rawPayload: providerPayload,
      },
      select: {
        creatorId: true,
        id: true,
      },
    });

    if (nextSourceAccountId) {
      await upsertAccountSourceMapping({
        organizationId: membership.organizationId,
        localEntityId: createdAccount.id,
        externalId: nextSourceAccountId,
        platform: localPlatform,
        rawPayload: providerPayload,
        tx,
      });
    }

    await linkCreatorToCampaign(createdAccount.creatorId);

    return createdAccount;
  });

  revalidateCreatorWorkspace(organizationSlug);

  return {
    creator,
    eventIds: trackedAccount.eventIds,
  };
}

function buildTrackedAccountFallbackPayload(record: TrackedTikTokAccountRecord) {
  return {
    accountDisplayName:
      record.displayName ?? (record.username ? `@${record.username}` : "Tracked TikTok creator"),
    accountUsername: record.username,
    platform: "tiktok",
    platformAccountId: record.platformAccountId,
    username: record.username,
  } satisfies ProviderAccountPayload;
}

function buildTrackedVideoFallbackPayload(record: TrackedTikTokVideoRecord) {
  return {
    accountDisplayName:
      record.accountDisplayName ??
      (record.username ? `@${record.username}` : "Tracked TikTok creator"),
    accountUsername: record.username,
    createdAt: record.createdAt,
    engagementRate: record.engagementRate,
    hashtags: record.hashtags,
    likeCount: record.likeCount,
    commentCount: record.commentCount,
    platform: "tiktok",
    platformAccountId: record.platformAccountId,
    platformVideoId: record.platformVideoId,
    publishedAt: record.publishedAt,
    viewCount: record.viewCount,
  } satisfies ProviderVideoPayload;
}

async function upsertTrackedTikTokVideoLocally(args: {
  tx: Prisma.TransactionClient;
  organizationId: string;
  campaignId: string;
  accountId: string;
  creatorId: string;
  providerPayload: ProviderVideoPayload;
  platformVideoId: string;
}) {
  const lastSyncedAt =
    getPayloadDate(args.providerPayload, [
      "loadAt",
      "load_at",
      "analyticsLatestLoadAt",
      "analytics_latest_load_at",
      "updatedAt",
      "updated_at",
    ]) ?? new Date();
  const accountUsername = getPayloadUsername(args.providerPayload, [
    "accountUsername",
    "account_username",
    "username",
  ]);
  const titleOrCaption = getPayloadString(args.providerPayload, [
    "caption",
    "title",
    "titleOrCaption",
    "title_or_caption",
  ]);
  const publishedAt = getPayloadDate(args.providerPayload, [
    "publishedAt",
    "published_at",
    "createdAt",
    "created_at",
  ]);
  const views = toSafeInt(
    getPayloadNumber(args.providerPayload, ["viewCount", "view_count"]),
  );
  const likes = toSafeInt(
    getPayloadNumber(args.providerPayload, ["likeCount", "like_count"]),
  );
  const comments = toSafeInt(
    getPayloadNumber(args.providerPayload, ["commentCount", "comment_count"]),
  );
  const engagementRate = toPercent(
    getPayloadNumber(args.providerPayload, ["engagementRate", "engagement_rate"]),
  );
  const contentTags = sanitizeTags(
    getPayloadStringArray(args.providerPayload, ["hashtags", "contentTags", "content_tags"]),
  );
  const videoUrl = buildVideoUrl({
    platform: "tiktok",
    videoId: args.platformVideoId,
    username: accountUsername,
  });

  const existingVideo = await args.tx.video.findUnique({
    where: {
      platform_sourceVideoId: {
        platform: Platform.TIKTOK,
        sourceVideoId: args.platformVideoId,
      },
    },
    select: {
      id: true,
      titleOrCaption: true,
      publishedAt: true,
      views: true,
      likes: true,
      comments: true,
      engagementRate: true,
      contentTags: true,
    },
  });

  const video =
    existingVideo != null
      ? await args.tx.video.update({
          where: {
            id: existingVideo.id,
          },
          data: {
            creatorId: args.creatorId,
            creatorPlatformAccountId: args.accountId,
            campaignId: args.campaignId,
            sourceVideoId: args.platformVideoId,
            platform: Platform.TIKTOK,
            videoUrl,
            titleOrCaption: titleOrCaption ?? existingVideo.titleOrCaption ?? null,
            publishedAt: publishedAt ?? existingVideo.publishedAt ?? null,
            views: views ?? existingVideo.views ?? null,
            likes: likes ?? existingVideo.likes ?? null,
            comments: comments ?? existingVideo.comments ?? null,
            engagementRate: engagementRate ?? existingVideo.engagementRate ?? null,
            contentTags: contentTags.length > 0 ? contentTags : existingVideo.contentTags,
            rawPayload: args.providerPayload,
            lastSyncedAt,
          },
          select: {
            id: true,
          },
        })
      : await args.tx.video.create({
          data: {
            creatorId: args.creatorId,
            creatorPlatformAccountId: args.accountId,
            campaignId: args.campaignId,
            sourceVideoId: args.platformVideoId,
            platform: Platform.TIKTOK,
            videoUrl,
            titleOrCaption,
            publishedAt,
            views,
            likes,
            comments,
            engagementRate,
            contentTags,
            rawPayload: args.providerPayload,
            lastSyncedAt,
          },
          select: {
            id: true,
          },
        });

  await args.tx.videoMetricsSnapshot.create({
    data: {
      videoId: video.id,
      capturedAt: lastSyncedAt,
      views,
      likes,
      comments,
      engagementRate,
      sourcePayload: args.providerPayload,
    },
  });

  await args.tx.sourceMapping.upsert({
    where: {
      externalSource_externalResourceType_externalId: {
        externalSource: ExternalSource.DATA_PROVIDER,
        externalResourceType: `viral-video:${Platform.TIKTOK}`,
        externalId: args.platformVideoId,
      },
    },
    update: {
      organizationId: args.organizationId,
      localEntityType: SourceEntityType.VIDEO,
      localEntityId: video.id,
      lastSyncedAt,
      rawPayload: args.providerPayload,
    },
    create: {
      organizationId: args.organizationId,
      localEntityType: SourceEntityType.VIDEO,
      localEntityId: video.id,
      externalSource: ExternalSource.DATA_PROVIDER,
      externalResourceType: `viral-video:${Platform.TIKTOK}`,
      externalId: args.platformVideoId,
      lastSyncedAt,
      rawPayload: args.providerPayload,
    },
  });

  return video.id;
}

export async function syncTrackedTikTokWorkspaceForOrganization(
  organizationSlug: string,
  options?: {
    mode?: "full" | "videos-only";
  },
) {
  const membership = await requireOrganizationMembership(organizationSlug);

  if (!canManageOrganization(membership.role)) {
    throw new Error("Creator sync access denied.");
  }

  const campaignId = await ensureAutoImportedTikTokCampaign({
    organizationId: membership.organizationId,
    ownerUserId: membership.userId === "public-access" ? null : membership.userId,
  });
  const syncMode = options?.mode ?? "full";
  const localAccountsByTrackedAccountExternalId = new Map<
    string,
    { accountId: string; creatorId: string; handle: string; sourceAccountId: string | null }
  >();
  const localAccountsByUsername = new Map<
    string,
    { accountId: string; creatorId: string; handle: string; sourceAccountId: string | null }
  >();
  const localAccountsBySourceAccountId = new Map<
    string,
    { accountId: string; creatorId: string; handle: string; sourceAccountId: string | null }
  >();
  const syncedCreatorIds = new Set<string>();
  const syncedVideoIds = new Set<string>();

  const existingLocalAccounts = await prisma.creatorPlatformAccount.findMany({
    where: {
      platform: Platform.TIKTOK,
      creator: {
        organizationId: membership.organizationId,
      },
    },
    select: {
      id: true,
      creatorId: true,
      handle: true,
      sourceAccountId: true,
    },
  });

  for (const existingLocalAccount of existingLocalAccounts) {
    localAccountsByUsername.set(
      existingLocalAccount.handle.toLowerCase(),
      existingLocalAccount,
    );

    if (existingLocalAccount.sourceAccountId) {
      localAccountsBySourceAccountId.set(
        existingLocalAccount.sourceAccountId,
        existingLocalAccount,
      );
    }
  }

  if (syncMode === "full") {
    const trackedAccounts = await getAllTrackedTikTokAccountsInViralApp();

    for (const trackedAccount of trackedAccounts) {
      const providerPayload =
        trackedAccount.username != null
          ? ((await getTrackedAccountDetails({
              platform: "tiktok",
              username: trackedAccount.username,
              profileUrl: buildProfileUrl("tiktok", trackedAccount.username),
            })) ?? buildTrackedAccountFallbackPayload(trackedAccount))
          : buildTrackedAccountFallbackPayload(trackedAccount);

      const localAccount = await prisma.$transaction((tx) =>
        upsertTrackedTikTokAccountLocally({
          tx,
          organizationId: membership.organizationId,
          campaignId,
          trackedAccountExternalId: trackedAccount.id,
          providerPayload,
        }),
      );

      if (!localAccount) {
        continue;
      }

      syncedCreatorIds.add(localAccount.creatorId);
      localAccountsByTrackedAccountExternalId.set(trackedAccount.id, localAccount);
      localAccountsByUsername.set(localAccount.handle.toLowerCase(), localAccount);

      if (localAccount.sourceAccountId) {
        localAccountsBySourceAccountId.set(localAccount.sourceAccountId, localAccount);
      }
    }
  }

  const trackedVideos = await getAllTrackedTikTokVideosInViralApp();

  for (const trackedVideo of trackedVideos) {
    const providerPayload = buildTrackedVideoFallbackPayload(trackedVideo);
    const sourceAccountId = getPayloadString(providerPayload, [
      "platformAccountId",
      "platform_account_id",
    ]);
    const accountUsername =
      getPayloadUsername(providerPayload, [
        "accountUsername",
        "account_username",
        "username",
      ]) ?? trackedVideo.username;
    let localAccount =
      (trackedVideo.orgAccountId
        ? localAccountsByTrackedAccountExternalId.get(trackedVideo.orgAccountId)
        : null) ??
      (sourceAccountId ? localAccountsBySourceAccountId.get(sourceAccountId) : null) ??
      (accountUsername ? localAccountsByUsername.get(accountUsername.toLowerCase()) : null) ??
      null;

    if (!localAccount) {
      const syntheticAccountPayload = {
        ...providerPayload,
        accountDisplayName:
          getPayloadString(providerPayload, [
            "accountDisplayName",
            "account_display_name",
            "displayName",
            "display_name",
          ]) ??
          trackedVideo.accountDisplayName ??
          (accountUsername ? `@${accountUsername}` : "Tracked TikTok creator"),
        accountUsername,
        platformAccountId: sourceAccountId,
        username: accountUsername,
      } satisfies ProviderAccountPayload;

      localAccount = await prisma.$transaction((tx) =>
        upsertTrackedTikTokAccountLocally({
          tx,
          organizationId: membership.organizationId,
          campaignId,
          trackedAccountExternalId: null,
          providerPayload: syntheticAccountPayload,
        }),
      );

      if (!localAccount) {
        continue;
      }

      localAccountsByUsername.set(localAccount.handle.toLowerCase(), localAccount);

      if (localAccount.sourceAccountId) {
        localAccountsBySourceAccountId.set(localAccount.sourceAccountId, localAccount);
      }
    }

    syncedCreatorIds.add(localAccount.creatorId);

    await prisma.$transaction(async (tx) => {
      await tx.campaignCreator.upsert({
        where: {
          campaignId_creatorId: {
            campaignId,
            creatorId: localAccount.creatorId,
          },
        },
        update: {},
        create: {
          campaignId,
          creatorId: localAccount.creatorId,
        },
      });

      await upsertTrackedTikTokVideoLocally({
        tx,
        organizationId: membership.organizationId,
        campaignId,
        accountId: localAccount.accountId,
        creatorId: localAccount.creatorId,
        providerPayload,
        platformVideoId: trackedVideo.platformVideoId,
      });
    });

    syncedVideoIds.add(trackedVideo.platformVideoId);
  }

  revalidateCreatorWorkspace(organizationSlug);

  return {
    campaignId,
    creatorCount: syncedCreatorIds.size,
    videoCount: syncedVideoIds.size,
  };
}

export async function setCreatorStatusForOrganization(args: {
  organizationSlug: string;
  input: unknown;
}) {
  const membership = await requireOrganizationMembership(args.organizationSlug);

  if (!canManageOrganization(membership.role)) {
    throw new Error("Creator status access denied.");
  }

  const values = setCreatorStatusSchema.parse(args.input);
  const creator = await prisma.creator.findFirst({
    where: {
      id: values.creatorId,
      organizationId: membership.organizationId,
    },
    select: {
      id: true,
    },
  });

  if (!creator) {
    throw new Error("Creator not found in this organization.");
  }

  await prisma.creator.update({
    where: {
      id: creator.id,
    },
    data: {
      internalStatus: values.internalStatus,
    },
  });

  revalidateCreatorWorkspace(args.organizationSlug);

  return {
    creatorId: creator.id,
    internalStatus: values.internalStatus,
  };
}

export async function upsertCreatorContactPointForOrganization(args: {
  organizationSlug: string;
  input: unknown;
}) {
  return upsertCreatorContactPointForOrganizationMessaging(args);
}

export async function removeCreatorContactPointForOrganization(args: {
  organizationSlug: string;
  input: unknown;
}) {
  return removeCreatorContactPointForOrganizationMessaging(args);
}

export async function requestSparkCodeForCreatorInOrganization(args: {
  organizationSlug: string;
  input: unknown;
}) {
  return sendSparkCodeRequestForOrganizationMessaging(args);
}
