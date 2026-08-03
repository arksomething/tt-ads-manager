import { randomUUID } from "node:crypto";

import {
  ViralPostEnrichmentStatus,
  type ViralPostEnrichment,
} from "@/lib/prisma-shim";
import { mapWithConcurrency } from "@/lib/concurrency";
import { prisma } from "@/lib/db";
import {
  formatRetryDelay,
  getProviderRateLimitRetryDelayMs,
} from "@/lib/provider-rate-limit";
import {
  ViralAppApiError,
  viralAppClient,
} from "@/server/data-provider/viral-app-client";
import { requireOrganizationMembership } from "@/server/auth/organizations";
import {
  resolveTikTokSparkPostsByItemIds,
  type TikTokSparkPostMetadata,
} from "@/server/tiktok-business/ad-manager-resolver";

const PLATFORM = "tiktok";
const PROCESSING_STALE_MS = 2 * 60_000;
const FAILED_RETRY_DELAY_MS = 6 * 60 * 60_000;
const MAX_FAILED_ATTEMPTS = 5;

type ViralTikTokVideoDetails = {
  id?: string | null;
  platformVideoId?: string | null;
  platform_video_id?: string | null;
  accountUsername?: string | null;
  account_username?: string | null;
  accountDisplayName?: string | null;
  account_display_name?: string | null;
  caption?: string | null;
  title?: string | null;
  thumbnailUrl?: string | null;
  thumbnail_url?: string | null;
  publishedAt?: string | null;
  published_at?: string | null;
  createdAt?: string | null;
  created_at?: string | null;
  viewCount?: number | string | null;
  view_count?: number | string | null;
};

export type ViralPostAttribution = {
  accountDisplayName: string | null;
  accountUsername: string | null;
  caption: string | null;
  platformVideoId: string;
  publishedAt: string | null;
  thumbnailUrl: string | null;
  videoUrl: string;
  viewCount: number | null;
};

function normalizeText(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function normalizeImageUrl(value: unknown) {
  const text = normalizeText(value);

  if (!text) {
    return null;
  }

  if (/^https?:\/\//i.test(text)) {
    return text;
  }

  if (text.startsWith("//")) {
    return `https:${text}`;
  }

  if (/^[a-z0-9.-]+\//i.test(text)) {
    return `https://${text}`;
  }

  return text;
}

function normalizeDate(value: unknown) {
  const text = normalizeText(value);

  if (!text) {
    return null;
  }

  const parsed = new Date(text.replace(/^(\d{4}-\d{2}-\d{2})\s+/, "$1T"));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function buildTikTokVideoUrl(args: {
  platformVideoId: string;
  username: string | null;
}) {
  return args.username
    ? `https://www.tiktok.com/@${encodeURIComponent(args.username)}/video/${encodeURIComponent(args.platformVideoId)}`
    : `https://www.tiktok.com/video/${encodeURIComponent(args.platformVideoId)}`;
}

function normalizeProviderPayload(
  platformVideoId: string,
  details: ViralTikTokVideoDetails,
) {
  const resolvedPlatformVideoId =
    normalizeText(details.platformVideoId) ??
    normalizeText(details.platform_video_id) ??
    platformVideoId;
  const accountUsername =
    normalizeText(details.accountUsername) ??
    normalizeText(details.account_username);
  const publishedAt =
    normalizeDate(details.publishedAt) ??
    normalizeDate(details.published_at) ??
    normalizeDate(details.createdAt) ??
    normalizeDate(details.created_at);

  return {
    accountDisplayName:
      normalizeText(details.accountDisplayName) ??
      normalizeText(details.account_display_name),
    accountUsername,
    caption: normalizeText(details.caption) ?? normalizeText(details.title),
    platformVideoId: resolvedPlatformVideoId,
    publishedAt,
    thumbnailUrl: normalizeImageUrl(
      details.thumbnailUrl ?? details.thumbnail_url,
    ),
    videoUrl: buildTikTokVideoUrl({
      platformVideoId: resolvedPlatformVideoId,
      username: accountUsername,
    }),
    viewCount: normalizeNumber(details.viewCount ?? details.view_count),
  };
}

function normalizePostId(value: string) {
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function toAttribution(
  row: ViralPostEnrichment,
): ViralPostAttribution | null {
  if (row.status !== ViralPostEnrichmentStatus.SUCCEEDED) {
    return null;
  }

  return {
    accountDisplayName: row.accountDisplayName,
    accountUsername: row.accountUsername,
    caption: row.caption,
    platformVideoId: row.platformVideoId,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    thumbnailUrl: row.thumbnailUrl,
    videoUrl:
      row.videoUrl ??
      buildTikTokVideoUrl({
        platformVideoId: row.platformVideoId,
        username: row.accountUsername,
      }),
    viewCount: row.viewCount,
  };
}

function extractTikTokUsernameFromUrl(value: string | null) {
  if (!value) {
    return null;
  }

  const match = value.match(/\/@([^/?#]+)\/video\//i);

  if (!match) {
    return null;
  }

  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

// TikTok video IDs encode the post time in their upper bits (id >> 32 = unix seconds).
function decodeTikTokPostedAt(platformVideoId: string) {
  if (!/^\d{15,20}$/.test(platformVideoId)) {
    return null;
  }

  const seconds = Number(BigInt(platformVideoId) >> BigInt(32));
  const posted = new Date(seconds * 1_000);
  const earliest = Date.UTC(2015, 0, 1);
  const latest = Date.now() + 2 * 24 * 60 * 60_000;

  if (posted.getTime() < earliest || posted.getTime() > latest) {
    return null;
  }

  return posted;
}

function normalizeSparkPostMetadata(
  platformVideoId: string,
  post: TikTokSparkPostMetadata,
) {
  // Only trust canonical post links; the Ads API payload also carries signed
  // CDN media URLs that expire.
  const shareUrl = normalizeText(post.shareUrl);
  const canonicalShareUrl =
    shareUrl && /tiktok\.com\/@[^/]+\/video\//i.test(shareUrl) ? shareUrl : null;
  const accountUsername =
    normalizeText(post.identityUsername) ?? extractTikTokUsernameFromUrl(canonicalShareUrl);

  return {
    accountDisplayName: normalizeText(post.identityDisplayName),
    accountUsername,
    caption: normalizeText(post.title),
    publishedAt: decodeTikTokPostedAt(platformVideoId),
    thumbnailUrl: normalizeImageUrl(post.coverUrl),
    videoUrl:
      canonicalShareUrl ??
      buildTikTokVideoUrl({
        platformVideoId,
        username: accountUsername,
      }),
  };
}

const SPARK_REFRESH_DELAY_MS = 30 * 60_000;

async function resolveEnrichmentsViaTikTokAds(args: {
  organizationSlug: string;
  rows: readonly ViralPostEnrichment[];
}) {
  const unmatchedRows = args.rows.filter(
    (row) => row.status !== ViralPostEnrichmentStatus.SUCCEEDED,
  );

  if (unmatchedRows.length === 0) {
    return new Set<string>();
  }

  let lookup: Awaited<ReturnType<typeof resolveTikTokSparkPostsByItemIds>>;

  try {
    lookup = await resolveTikTokSparkPostsByItemIds({
      organizationSlug: args.organizationSlug,
      itemIds: unmatchedRows.map((row) => row.platformVideoId),
    });
  } catch {
    // No TikTok advertiser account or the Ads API is unavailable — the
    // viral.app queue below still covers every row.
    return new Set<string>();
  }

  const resolvedIds = new Set<string>();
  const resolvedRows = unmatchedRows.filter((row) =>
    lookup.postsByItemId.has(row.platformVideoId),
  );

  await mapWithConcurrency(resolvedRows, 8, async (row) => {
    const post = lookup.postsByItemId.get(row.platformVideoId);

    if (!post) {
      return;
    }

    const normalized = normalizeSparkPostMetadata(row.platformVideoId, post);

    await prisma.viralPostEnrichment.update({
      where: {
        id: row.id,
      },
      data: {
        status: ViralPostEnrichmentStatus.SUCCEEDED,
        // Leave the row due soon so viral.app can backfill viewCount in the
        // background without blocking the match.
        nextAttemptAt: new Date(Date.now() + SPARK_REFRESH_DELAY_MS),
        processingStartedAt: null,
        lastFetchedAt: new Date(),
        lastError: null,
        accountDisplayName: normalized.accountDisplayName,
        accountUsername: normalized.accountUsername,
        caption: normalized.caption,
        thumbnailUrl: normalized.thumbnailUrl,
        videoUrl: normalized.videoUrl,
        publishedAt: normalized.publishedAt,
        viewCount: null,
        rawPayload: {
          source: "tiktok-ads-api",
          itemId: post.itemId,
          title: post.title,
          coverUrl: post.coverUrl,
          shareUrl: post.shareUrl,
          identityDisplayName: post.identityDisplayName,
          identityUsername: post.identityUsername,
        },
      },
    });
    resolvedIds.add(row.platformVideoId);
  });

  return resolvedIds;
}

const OEMBED_LOOKUPS_PER_PASS = 8;
const OEMBED_TIMEOUT_MS = 6_000;
const OEMBED_USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36";

// Free, unauthenticated fallback for posts the Ads API doesn't know (non-Spark
// creatives). oEmbed resolves the real author even from a placeholder-username
// URL; a non-OK response usually means the post is deleted or private, in
// which case the row is left for the viral.app queue.
async function resolveEnrichmentsViaOembed(args: {
  rows: readonly ViralPostEnrichment[];
  skipIds: ReadonlySet<string>;
}) {
  const candidateRows = args.rows
    .filter(
      (row) =>
        row.status !== ViralPostEnrichmentStatus.SUCCEEDED &&
        !args.skipIds.has(row.platformVideoId),
    )
    .slice(0, OEMBED_LOOKUPS_PER_PASS);
  const resolvedIds = new Set<string>();

  await mapWithConcurrency(candidateRows, 4, async (row) => {
    let payload: {
      title?: string | null;
      author_name?: string | null;
      author_url?: string | null;
      thumbnail_url?: string | null;
    };

    try {
      const response = await fetch(
        `https://www.tiktok.com/oembed?url=${encodeURIComponent(
          `https://www.tiktok.com/@_/video/${row.platformVideoId}`,
        )}`,
        {
          headers: { "user-agent": OEMBED_USER_AGENT },
          signal: AbortSignal.timeout(OEMBED_TIMEOUT_MS),
        },
      );

      if (!response.ok) {
        return;
      }

      payload = (await response.json()) as typeof payload;
    } catch {
      return;
    }

    const authorMatch = normalizeText(payload.author_url)?.match(/\/@([^/?#]+)/);
    const accountUsername = authorMatch ? decodeURIComponent(authorMatch[1]) : null;

    if (!accountUsername) {
      return;
    }

    await prisma.viralPostEnrichment.update({
      where: {
        id: row.id,
      },
      data: {
        status: ViralPostEnrichmentStatus.SUCCEEDED,
        nextAttemptAt: new Date(Date.now() + SPARK_REFRESH_DELAY_MS),
        processingStartedAt: null,
        lastFetchedAt: new Date(),
        lastError: null,
        accountDisplayName: normalizeText(payload.author_name),
        accountUsername,
        caption: normalizeText(payload.title),
        thumbnailUrl: normalizeImageUrl(payload.thumbnail_url),
        videoUrl: buildTikTokVideoUrl({
          platformVideoId: row.platformVideoId,
          username: accountUsername,
        }),
        publishedAt: decodeTikTokPostedAt(row.platformVideoId),
        viewCount: null,
        rawPayload: {
          source: "tiktok-oembed",
          title: payload.title ?? null,
          authorName: payload.author_name ?? null,
          authorUrl: payload.author_url ?? null,
          thumbnailUrl: payload.thumbnail_url ?? null,
        },
      },
    });
    resolvedIds.add(row.platformVideoId);
  });

  return resolvedIds;
}

async function fetchViralPostDetails(platformVideoId: string) {
  try {
    return await viralAppClient.request<ViralTikTokVideoDetails>({
      path: `/videos/tiktok/${encodeURIComponent(platformVideoId)}`,
    });
  } catch (error) {
    if (!(error instanceof ViralAppApiError) || error.status !== 404) {
      throw error;
    }

    return viralAppClient.request<ViralTikTokVideoDetails>({
      path: `/live/tiktok/videos/${encodeURIComponent(platformVideoId)}`,
    });
  }
}

function getRetryDelayMs(error: unknown) {
  const rateLimitDelayMs = getProviderRateLimitRetryDelayMs(error, {
    defaultDelayMs: 60_000,
    maxDelayMs: 30 * 60_000,
  });

  if (rateLimitDelayMs != null) {
    return {
      delayMs: rateLimitDelayMs,
      status: ViralPostEnrichmentStatus.RATE_LIMITED,
    };
  }

  return {
    delayMs: FAILED_RETRY_DELAY_MS,
    status: ViralPostEnrichmentStatus.FAILED,
  };
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "viral.app lookup failed.";
}

export async function enqueueViralPostEnrichments(args: {
  organizationId: string;
  platformVideoIds: readonly string[];
}) {
  const platformVideoIds = [
    ...new Set(
      args.platformVideoIds
        .map((value) => normalizePostId(value))
        .filter((value): value is string => Boolean(value)),
    ),
  ];

  if (platformVideoIds.length === 0) {
    return;
  }

  const existingRows = (await prisma.viralPostEnrichment.findMany({
    where: {
      organizationId: args.organizationId,
      platform: PLATFORM,
      platformVideoId: {
        in: platformVideoIds,
      },
    },
    select: {
      platformVideoId: true,
    },
  })) as Array<{ platformVideoId: string }>;
  const existingIds = new Set(existingRows.map((row) => row.platformVideoId));

  for (const platformVideoId of platformVideoIds) {
    if (existingIds.has(platformVideoId)) {
      continue;
    }

    await prisma.viralPostEnrichment.upsert({
      where: {
        organizationId_platform_platformVideoId: {
          organizationId: args.organizationId,
          platform: PLATFORM,
          platformVideoId,
        },
      },
      data: {
        id: randomUUID(),
        organizationId: args.organizationId,
        nextAttemptAt: new Date(Date.now() - 1_000),
        platform: PLATFORM,
        platformVideoId,
      },
      update: {},
    });
  }
}

export async function getViralPostAttributions(args: {
  organizationId: string;
  platformVideoIds: readonly string[];
}) {
  const platformVideoIds = [
    ...new Set(
      args.platformVideoIds
        .map((value) => normalizePostId(value))
        .filter((value): value is string => Boolean(value)),
    ),
  ];

  if (platformVideoIds.length === 0) {
    return new Map<string, ViralPostAttribution>();
  }

  const rows = (await prisma.viralPostEnrichment.findMany({
    where: {
      organizationId: args.organizationId,
      platform: PLATFORM,
      platformVideoId: {
        in: platformVideoIds,
      },
    },
  })) as ViralPostEnrichment[];
  const attributions = new Map<string, ViralPostAttribution>();

  for (const row of rows) {
    const attribution = toAttribution(row);

    if (attribution) {
      attributions.set(row.platformVideoId, attribution);
    }
  }

  return attributions;
}

function isDueForProcessing(row: ViralPostEnrichment, now: Date) {
  if (row.status === ViralPostEnrichmentStatus.SUCCEEDED) {
    // Rows matched through the TikTok Ads API have no organic view count;
    // let viral.app backfill it in the background when quota allows.
    return row.viewCount == null && row.nextAttemptAt <= now;
  }

  if (
    row.status === ViralPostEnrichmentStatus.FAILED &&
    row.attemptCount >= MAX_FAILED_ATTEMPTS
  ) {
    return false;
  }

  if (row.status === ViralPostEnrichmentStatus.PROCESSING) {
    return (
      !row.processingStartedAt ||
      now.getTime() - row.processingStartedAt.getTime() > PROCESSING_STALE_MS
    );
  }

  return row.nextAttemptAt <= now;
}

export async function processViralPostEnrichmentQueue(args: {
  organizationSlug: string;
  platformVideoIds: readonly string[];
  limit?: number;
}) {
  const membership = await requireOrganizationMembership(args.organizationSlug);
  const platformVideoIds = [
    ...new Set(
      args.platformVideoIds
        .map((value) => normalizePostId(value))
        .filter((value): value is string => Boolean(value)),
    ),
  ];
  const now = new Date();
  const limit = Math.max(0, Math.min(args.limit ?? 2, 5));

  await enqueueViralPostEnrichments({
    organizationId: membership.organizationId,
    platformVideoIds,
  });

  const rows = (await prisma.viralPostEnrichment.findMany({
    where: {
      organizationId: membership.organizationId,
      platform: PLATFORM,
      platformVideoId: {
        in: platformVideoIds,
      },
    },
    orderBy: [{ nextAttemptAt: "asc" }, { updatedAt: "asc" }],
  })) as ViralPostEnrichment[];
  const adsResolvedIds = await resolveEnrichmentsViaTikTokAds({
    organizationSlug: args.organizationSlug,
    rows,
  });
  const oembedResolvedIds = await resolveEnrichmentsViaOembed({
    rows,
    skipIds: adsResolvedIds,
  });
  const externallyResolvedIds = new Set([...adsResolvedIds, ...oembedResolvedIds]);
  // Unmatched rows are matching-critical; view-count refreshes of already
  // matched rows only run with whatever budget is left over.
  const dueRows = rows
    .filter(
      (row) =>
        !externallyResolvedIds.has(row.platformVideoId) && isDueForProcessing(row, now),
    )
    .sort((left, right) => {
      const leftMatched = left.status === ViralPostEnrichmentStatus.SUCCEEDED ? 1 : 0;
      const rightMatched = right.status === ViralPostEnrichmentStatus.SUCCEEDED ? 1 : 0;
      return leftMatched - rightMatched;
    })
    .slice(0, limit);
  let processedCount = 0;
  let rateLimited = false;

  for (const row of dueRows) {
    const isRefreshOfMatchedRow = row.status === ViralPostEnrichmentStatus.SUCCEEDED;
    const attemptCount = row.attemptCount + 1;
    await prisma.viralPostEnrichment.update({
      where: {
        id: row.id,
      },
      data: {
        // A refresh must keep the row matched even if this poll dies mid-flight.
        status: isRefreshOfMatchedRow
          ? ViralPostEnrichmentStatus.SUCCEEDED
          : ViralPostEnrichmentStatus.PROCESSING,
        processingStartedAt: new Date(),
        attemptCount,
      },
    });

    try {
      const details = await fetchViralPostDetails(row.platformVideoId);
      const normalized = normalizeProviderPayload(row.platformVideoId, details);

      await prisma.viralPostEnrichment.update({
        where: {
          id: row.id,
        },
        data: {
          status: ViralPostEnrichmentStatus.SUCCEEDED,
          nextAttemptAt: new Date(Date.now() + 24 * 60 * 60_000),
          processingStartedAt: null,
          lastFetchedAt: new Date(),
          lastError: null,
          accountDisplayName: normalized.accountDisplayName,
          accountUsername: normalized.accountUsername,
          caption: normalized.caption,
          thumbnailUrl: normalized.thumbnailUrl,
          videoUrl: normalized.videoUrl,
          publishedAt: normalized.publishedAt,
          viewCount: normalized.viewCount,
          rawPayload: details,
        },
      });
      processedCount += 1;
    } catch (error) {
      const retry = getRetryDelayMs(error);
      const retryAt = new Date(Date.now() + retry.delayMs);
      rateLimited = retry.status === ViralPostEnrichmentStatus.RATE_LIMITED;

      await prisma.viralPostEnrichment.update({
        where: {
          id: row.id,
        },
        data: {
          // A failed view-count refresh must not un-match an already
          // matched row — keep it SUCCEEDED and just push the retry out.
          status: isRefreshOfMatchedRow ? ViralPostEnrichmentStatus.SUCCEEDED : retry.status,
          nextAttemptAt: retryAt,
          processingStartedAt: null,
          lastError:
            retry.status === ViralPostEnrichmentStatus.RATE_LIMITED
              ? `Rate limit exceeded, retry in ${formatRetryDelay(retry.delayMs)}.`
              : getErrorMessage(error),
        },
      });

      if (rateLimited) {
        break;
      }
    }
  }

  const nextRows = (await prisma.viralPostEnrichment.findMany({
    where: {
      organizationId: membership.organizationId,
      platform: PLATFORM,
      platformVideoId: {
        in: platformVideoIds,
      },
    },
  })) as ViralPostEnrichment[];
  const attributions = new Map<string, ViralPostAttribution>();
  const pendingPostIds: string[] = [];
  const failedPostIds: string[] = [];

  for (const row of nextRows) {
    const attribution = toAttribution(row);

    if (attribution) {
      attributions.set(row.platformVideoId, attribution);
      continue;
    }

    if (
      row.status === ViralPostEnrichmentStatus.FAILED &&
      row.attemptCount >= MAX_FAILED_ATTEMPTS
    ) {
      failedPostIds.push(row.platformVideoId);
    } else {
      pendingPostIds.push(row.platformVideoId);
    }
  }

  return {
    attributions,
    failedPostIds,
    pendingPostIds,
    processedCount,
    rateLimited,
  };
}
