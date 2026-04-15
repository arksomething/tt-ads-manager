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
  trackCreatorAccountFormSchema,
} from "./schemas";

const VIRAL_ACCOUNT_RESOURCE_TYPE_PREFIX = "viral-account";

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

function revalidateCreatorWorkspace(organizationSlug: string) {
  revalidatePath("/app");
  revalidatePath(`/org/${organizationSlug}`);
  revalidatePath(`/org/${organizationSlug}/campaigns`);
  revalidatePath(`/org/${organizationSlug}/creators`);
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
