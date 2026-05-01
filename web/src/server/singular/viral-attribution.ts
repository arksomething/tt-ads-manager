import { unstable_cache } from "next/cache";

import { viralAppClient } from "@/server/data-provider/viral-app-client";

import type { TikTokSingularReportRow } from "./reporting";

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

export type SingularViralTikTokPostAttribution = {
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

function buildTikTokVideoUrl(args: {
  platformVideoId: string;
  username: string | null;
}) {
  return args.username
    ? `https://www.tiktok.com/@${encodeURIComponent(args.username)}/video/${encodeURIComponent(args.platformVideoId)}`
    : `https://www.tiktok.com/video/${encodeURIComponent(args.platformVideoId)}`;
}

async function getViralTikTokVideoDetailsUncached(platformVideoId: string) {
  try {
    return await viralAppClient.request<ViralTikTokVideoDetails>({
      path: `/videos/tiktok/${encodeURIComponent(platformVideoId)}`,
    });
  } catch {
    return await viralAppClient.request<ViralTikTokVideoDetails>({
      path: `/live/tiktok/videos/${encodeURIComponent(platformVideoId)}`,
    });
  }
}

const getViralTikTokVideoDetails = unstable_cache(
  async (platformVideoId: string) =>
    getViralTikTokVideoDetailsUncached(platformVideoId),
  ["singular-viral-tiktok-video-details"],
  {
    revalidate: 900,
  },
);

function normalizeViralTikTokVideoDetails(
  platformVideoId: string,
  details: ViralTikTokVideoDetails,
): SingularViralTikTokPostAttribution {
  const resolvedPlatformVideoId =
    normalizeText(details.platformVideoId) ??
    normalizeText(details.platform_video_id) ??
    platformVideoId;
  const accountUsername =
    normalizeText(details.accountUsername) ??
    normalizeText(details.account_username);

  return {
    accountDisplayName:
      normalizeText(details.accountDisplayName) ??
      normalizeText(details.account_display_name),
    accountUsername,
    caption: normalizeText(details.caption) ?? normalizeText(details.title),
    platformVideoId: resolvedPlatformVideoId,
    publishedAt:
      normalizeText(details.publishedAt) ??
      normalizeText(details.published_at) ??
      normalizeText(details.createdAt) ??
      normalizeText(details.created_at),
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

export async function getViralTikTokPostAttributionsForSingularRows(
  rows: readonly TikTokSingularReportRow[],
) {
  const postIds = [
    ...new Set(
      rows
        .map((row) => row.tiktokPostId?.trim())
        .filter((value): value is string => Boolean(value)),
    ),
  ];
  const attributions = new Map<string, SingularViralTikTokPostAttribution>();
  const warnings: string[] = [];

  await Promise.all(
    postIds.map(async (postId) => {
      try {
        const details = await getViralTikTokVideoDetails(postId);
        attributions.set(
          postId,
          normalizeViralTikTokVideoDetails(postId, details),
        );
      } catch (error) {
        warnings.push(
          error instanceof Error
            ? `Could not resolve TikTok post ${postId} in viral.app: ${error.message}`
            : `Could not resolve TikTok post ${postId} in viral.app.`,
        );
      }
    }),
  );

  return {
    attributions,
    postIdCount: postIds.length,
    matchedPostCount: attributions.size,
    warnings,
  };
}
