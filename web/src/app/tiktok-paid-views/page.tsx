/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { hasTikTokBusinessOauthEnv } from "@/lib/server-env";
import {
  getPaidViewsForCreator,
  getPaidViewsForSparkItems,
  type TikTokMatchedAd,
  type TikTokPaidViewMetric,
  type TikTokPaidViewsRow,
  type TikTokResolvedPost,
} from "@/server/tiktok-business/public-reporting";
import {
  createTikTokPublicConnectionCookieValue,
  getTikTokPublicConnectionCookieName,
  getTikTokPublicConnectionCookieOptions,
  getTikTokPublicConnectionMaxAgeSeconds,
  getTikTokPublicPendingSelectionCookieName,
  readTikTokPublicPendingSelectionCookieValue,
  readTikTokPublicConnectionCookieValue,
  sanitizeTikTokPublicReturnPath,
} from "@/server/tiktok-business/public-session";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

type TikTokPaidViewsPageProps = {
  searchParams: SearchParams;
};

const metricOptions: Array<{
  value: TikTokPaidViewMetric;
  label: string;
  hint: string;
}> = [
  {
    value: "impressions",
    label: "Impressions",
    hint: "Times your paid Spark ads were served.",
  },
  {
    value: "videoPlayActions",
    label: "Video play actions",
    hint: "Paid video starts captured by TikTok reporting.",
  },
];

const metricDisplayCopy = {
  impressions: {
    totalLabel: "Total paid impressions",
    shortLabel: "Paid impressions",
    rowValueLabel: "Impressions",
  },
  videoPlayActions: {
    totalLabel: "Total paid video plays",
    shortLabel: "Paid video plays",
    rowValueLabel: "Video plays",
  },
} as const;

const numberFormatter = new Intl.NumberFormat("en-US");
const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

function getSearchParamValue(
  searchParams: Record<string, string | string[] | undefined>,
  key: string,
) {
  const value = searchParams[key];
  return Array.isArray(value) ? value[0] : value;
}

function toDateOnlyString(value: Date) {
  return value.toISOString().slice(0, 10);
}

function getDefaultStartDate() {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - 30);
  return toDateOnlyString(date);
}

function getDefaultEndDate() {
  return toDateOnlyString(new Date());
}

function normalizeMetric(value: string | undefined): TikTokPaidViewMetric {
  return value === "videoPlayActions" ? "videoPlayActions" : "impressions";
}

function parseReportDate(value: string | null) {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();

  if (trimmed.length === 0) {
    return null;
  }

  const directMatch = trimmed.match(/^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}:\d{2}))?$/);

  if (directMatch) {
    const [, datePart, timePart] = directMatch;
    const parsed = new Date(`${datePart}T${timePart ?? "00:00:00"}.000Z`);

    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatDate(value: string | null) {
  if (!value) {
    return "Unknown";
  }

  const parsed = parseReportDate(value);
  return parsed ? dateFormatter.format(parsed) : value;
}

function getReportDateSortValue(value: string | null) {
  return parseReportDate(value)?.getTime() ?? 0;
}

function getMetricDisplayCopy(metric: TikTokPaidViewMetric) {
  return metricDisplayCopy[metric];
}

function getBestAdLabel(ad: TikTokMatchedAd) {
  const adName = ad.adName?.trim();

  if (adName) {
    return adName;
  }

  const displayName = ad.displayName?.trim();

  if (displayName) {
    return displayName;
  }

  return `Ad ${ad.adId}`;
}

function getBestPostTitle(post: TikTokResolvedPost) {
  const title = post.title?.trim();
  return title && title.length > 0 ? title : `Video ${post.itemId}`;
}

function getPrimaryResolvedPost(posts: readonly TikTokResolvedPost[]) {
  return (
    posts.find((post) => Boolean(post.title?.trim() || post.coverUrl || post.shareUrl)) ??
    posts[0] ??
    null
  );
}

function getResolvedPostsForMatchedAds(matchedAds: readonly TikTokMatchedAd[]) {
  const postsByItemId = new Map<string, TikTokResolvedPost>();

  for (const ad of matchedAds) {
    for (const post of ad.resolvedPosts) {
      if (!postsByItemId.has(post.itemId)) {
        postsByItemId.set(post.itemId, post);
      }
    }
  }

  return [...postsByItemId.values()].sort((left, right) => left.itemId.localeCompare(right.itemId));
}

type TikTokMatchedGroupAd = {
  adId: string;
  adLabel: string;
  itemIds: string[];
  totalValue: number;
  resolvedPosts: TikTokResolvedPost[];
  primaryPost: TikTokResolvedPost | null;
};

type TikTokMatchedGroupPoint = {
  date: string | null;
  value: number;
};

type TikTokMatchedGroup = {
  key: string;
  kind: "video" | "creative";
  title: string;
  subtitle: string;
  itemIds: string[];
  totalValue: number;
  activeDays: number;
  rowCount: number;
  firstDate: string | null;
  lastDate: string | null;
  rows: TikTokPaidViewsRow[];
  dailyPoints: TikTokMatchedGroupPoint[];
  ads: TikTokMatchedGroupAd[];
  resolvedPosts: TikTokResolvedPost[];
  primaryPost: TikTokResolvedPost | null;
};

function buildMatchedGroups(args: {
  rows: TikTokPaidViewsRow[];
  matchedAds: TikTokMatchedAd[];
}): TikTokMatchedGroup[] {
  const adMetadata = new Map(args.matchedAds.map((ad) => [ad.adId, ad] as const));
  const perAdGroups = new Map<
    string,
    {
      adId: string;
      adLabel: string;
      itemIds: Set<string>;
      totalValue: number;
      rows: TikTokPaidViewsRow[];
    }
  >();

  for (const row of args.rows) {
    const adId = row.adId ?? "Unknown";
    const ad = adMetadata.get(adId);
    const existingGroup = perAdGroups.get(adId);

    if (existingGroup) {
      existingGroup.totalValue += row.metricValue;
      existingGroup.rows.push(row);

      if (row.itemId) {
        existingGroup.itemIds.add(row.itemId);
      }

      continue;
    }

    perAdGroups.set(adId, {
      adId,
      adLabel: ad ? getBestAdLabel(ad) : `Ad ${adId}`,
      itemIds: new Set([
        ...(ad?.itemIds ?? []),
        ...(row.itemId ? [row.itemId] : []),
      ]),
      totalValue: row.metricValue,
      rows: [row],
    });
  }

  const groupedMatches = new Map<
    string,
    {
      key: string;
      kind: "video" | "creative";
      itemIds: Set<string>;
      rows: TikTokPaidViewsRow[];
      ads: TikTokMatchedGroupAd[];
      totalValue: number;
    }
  >();

  for (const adGroup of perAdGroups.values()) {
    const itemIds = [...adGroup.itemIds].sort();
    const isVideoGroup = itemIds.length === 1;
    const key = isVideoGroup ? `video:${itemIds[0]}` : `creative:${adGroup.adId}`;
    const existingGroup = groupedMatches.get(key);
    const resolvedPosts = [...(adMetadata.get(adGroup.adId)?.resolvedPosts ?? [])].sort(
      (left, right) => left.itemId.localeCompare(right.itemId),
    );
    const adSummary = {
      adId: adGroup.adId,
      adLabel: adGroup.adLabel,
      itemIds,
      totalValue: adGroup.totalValue,
      resolvedPosts,
      primaryPost: getPrimaryResolvedPost(resolvedPosts),
    };

    if (existingGroup) {
      existingGroup.totalValue += adGroup.totalValue;
      existingGroup.rows.push(...adGroup.rows);
      existingGroup.ads.push(adSummary);

      for (const itemId of itemIds) {
        existingGroup.itemIds.add(itemId);
      }

      continue;
    }

    groupedMatches.set(key, {
      key,
      kind: isVideoGroup ? "video" : "creative",
      itemIds: new Set(itemIds),
      rows: [...adGroup.rows],
      ads: [adSummary],
      totalValue: adGroup.totalValue,
    });
  }

  return [...groupedMatches.values()]
    .map((group) => {
      const sortedRows = [...group.rows].sort(
        (left, right) =>
          getReportDateSortValue(left.statDate) - getReportDateSortValue(right.statDate),
      );
      const itemIds = [...group.itemIds].sort();
      const dailyPointMap = new Map<string, TikTokMatchedGroupPoint>();
      const resolvedPostsByItemId = new Map<string, TikTokResolvedPost>();

      for (const row of sortedRows) {
        const key = row.statDate ?? `unknown-${group.key}`;
        const existingPoint = dailyPointMap.get(key);

        if (existingPoint) {
          existingPoint.value += row.metricValue;
          continue;
        }

        dailyPointMap.set(key, {
          date: row.statDate,
          value: row.metricValue,
        });
      }

      for (const ad of group.ads) {
        for (const post of ad.resolvedPosts) {
          if (!resolvedPostsByItemId.has(post.itemId)) {
            resolvedPostsByItemId.set(post.itemId, post);
          }
        }
      }

      const dailyPoints = [...dailyPointMap.values()].sort(
        (left, right) =>
          getReportDateSortValue(left.date) - getReportDateSortValue(right.date),
      );
      const resolvedPosts = [...resolvedPostsByItemId.values()].sort(
        (left, right) => left.itemId.localeCompare(right.itemId),
      );
      const primaryPost =
        group.kind === "video"
          ? (itemIds[0] ? resolvedPostsByItemId.get(itemIds[0]) : null) ??
            getPrimaryResolvedPost(resolvedPosts)
          : getPrimaryResolvedPost(resolvedPosts);
      const leadAd = group.ads[0];
      const title =
        group.kind === "video"
          ? primaryPost
            ? getBestPostTitle(primaryPost)
            : leadAd && !leadAd.adLabel.startsWith("Ad ")
            ? leadAd.adLabel
            : `Video ${itemIds[0]}`
          : leadAd?.adLabel ??
            (primaryPost ? getBestPostTitle(primaryPost) : `Ad ${leadAd?.adId ?? "Unknown"}`);
      const subtitle =
        group.kind === "video"
          ? `Video ID ${itemIds[0]}${group.ads.length > 1 ? ` · ${group.ads.length} ads` : ""}`
          : primaryPost
            ? `Lead post ${primaryPost.itemId} · Ad ID ${leadAd?.adId ?? "Unknown"}`
            : `Ad ID ${leadAd?.adId ?? "Unknown"}`;

      return {
        key: group.key,
        kind: group.kind,
        title,
        subtitle,
        itemIds,
        totalValue: group.totalValue,
        activeDays: dailyPoints.length,
        rowCount: sortedRows.length,
        firstDate: sortedRows[0]?.statDate ?? null,
        lastDate: sortedRows[sortedRows.length - 1]?.statDate ?? null,
        rows: sortedRows,
        dailyPoints,
        ads: [...group.ads].sort(
          (left, right) =>
            right.totalValue - left.totalValue || left.adId.localeCompare(right.adId),
        ),
        resolvedPosts,
        primaryPost,
      };
    })
    .sort(
      (left, right) =>
        right.totalValue - left.totalValue ||
        getReportDateSortValue(right.lastDate) - getReportDateSortValue(left.lastDate),
    );
}

function summarizeItemIds(itemIds: string[]) {
  if (itemIds.length === 0) {
    return "TikTok did not return Spark item IDs for this ad.";
  }

  if (itemIds.length <= 3) {
    return itemIds.join(", ");
  }

  return `${itemIds.slice(0, 3).join(", ")} +${itemIds.length - 3} more`;
}

function DailyMetricChart(args: {
  points: TikTokMatchedGroupPoint[];
  metricLabel: string;
}) {
  if (args.points.length === 0) {
    return null;
  }

  const chartHeight = 120;
  const baselineY = 104;
  const maxValue = Math.max(...args.points.map((point) => point.value), 1);
  const barWidth = 12;
  const gap = 6;
  const chartWidth = Math.max(320, args.points.length * (barWidth + gap));
  const peakPoint = args.points.reduce((currentPeak, point) =>
    point.value > currentPeak.value ? point : currentPeak,
  );

  return (
    <div className="mt-4 rounded-[1rem] border border-white/[0.08] bg-black/[0.2] p-4">
      <div className="overflow-x-auto">
        <svg
          aria-label={`${args.metricLabel} over time`}
          className="h-32 w-full min-w-[320px]"
          preserveAspectRatio="none"
          viewBox={`0 0 ${chartWidth} ${chartHeight}`}
        >
          <line
            stroke="rgba(255,255,255,0.12)"
            strokeWidth="1"
            x1="0"
            x2={chartWidth}
            y1={baselineY}
            y2={baselineY}
          />
          {args.points.map((point, index) => {
            const height = Math.max(3, (point.value / maxValue) * 88);
            const x = index * (barWidth + gap);
            const y = baselineY - height;

            return (
              <rect
                fill="rgba(144,255,77,0.88)"
                height={height}
                key={`${point.date ?? "unknown"}-${index}`}
                rx="3"
                width={barWidth}
                x={x}
                y={y}
              />
            );
          })}
        </svg>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
        <span>
          {formatDate(args.points[0]?.date ?? null)} to{" "}
          {formatDate(args.points[args.points.length - 1]?.date ?? null)}
        </span>
        <span>
          Peak day: {formatDate(peakPoint.date)} · {numberFormatter.format(peakPoint.value)}{" "}
          {args.metricLabel.toLowerCase()}
        </span>
      </div>
    </div>
  );
}

function withFlashPath(args: {
  returnTo: string;
  notice?: string | null;
  error?: string | null;
}) {
  const url = new URL(sanitizeTikTokPublicReturnPath(args.returnTo), "https://example.com");

  if (args.notice) {
    url.searchParams.set("notice", args.notice);
  }

  if (args.error) {
    url.searchParams.set("error", args.error);
  }

  return `${url.pathname}${url.search}`;
}

function getNoticeLabel(value: string | undefined) {
  switch (value) {
    case "connection-saved":
      return "TikTok advertiser connection saved in this browser.";
    case "connection-cleared":
      return "TikTok advertiser connection cleared from this browser.";
    case "oauth-select-advertiser":
      return "Choose which TikTok advertiser account to save for this browser.";
    default:
      return undefined;
  }
}

function getActionErrorMessage(error: unknown) {
  const digest =
    typeof error === "object" &&
    error !== null &&
    "digest" in error &&
    typeof (error as { digest?: unknown }).digest === "string"
      ? (error as { digest: string }).digest
      : null;

  if (digest?.startsWith("NEXT_REDIRECT")) {
    throw error;
  }

  return error instanceof Error ? error.message : "Something went wrong.";
}

export default async function TikTokPaidViewsPage({
  searchParams,
}: TikTokPaidViewsPageProps) {
  const resolvedSearchParams = await searchParams;
  const creatorLabel = (getSearchParamValue(resolvedSearchParams, "creator") ?? "").trim();
  const itemIdsInput = getSearchParamValue(resolvedSearchParams, "itemIds") ?? "";
  const hasManualItemIds = itemIdsInput.trim().length > 0;
  const hasLookupInput = creatorLabel.length > 0 || hasManualItemIds;
  const startDate =
    getSearchParamValue(resolvedSearchParams, "startDate") ?? getDefaultStartDate();
  const endDate =
    getSearchParamValue(resolvedSearchParams, "endDate") ?? getDefaultEndDate();
  const metric = normalizeMetric(getSearchParamValue(resolvedSearchParams, "metric"));
  const cookieStore = await cookies();
  const oauthConfigured = hasTikTokBusinessOauthEnv();
  const connection = readTikTokPublicConnectionCookieValue(
    cookieStore.get(getTikTokPublicConnectionCookieName())?.value,
  );
  const pendingSelection = readTikTokPublicPendingSelectionCookieValue(
    cookieStore.get(getTikTokPublicPendingSelectionCookieName())?.value,
  );
  const returnTo = withFlashPath({
    returnTo: `/tiktok-paid-views?${new URLSearchParams({
      creator: creatorLabel,
      itemIds: itemIdsInput,
      startDate,
      endDate,
      metric,
    }).toString()}`,
  });
  const oauthConnectHref = `/api/tiktok/oauth/start?next=${encodeURIComponent(returnTo)}`;
  const notice = getNoticeLabel(getSearchParamValue(resolvedSearchParams, "notice"));

  async function saveConnectionAction(formData: FormData) {
    "use server";

    const advertiserId = String(formData.get("advertiserId") ?? "").trim();
    const advertiserName = String(formData.get("advertiserName") ?? "").trim();
    const accessToken = String(formData.get("accessToken") ?? "").trim();
    const nextPath = sanitizeTikTokPublicReturnPath(
      String(formData.get("returnTo") ?? ""),
    );

    try {
      const serverCookieStore = await cookies();
      serverCookieStore.set(
        getTikTokPublicConnectionCookieName(),
        createTikTokPublicConnectionCookieValue({
          advertiserId,
          advertiserName,
          accessToken,
        }),
        getTikTokPublicConnectionCookieOptions(
          getTikTokPublicConnectionMaxAgeSeconds(),
        ),
      );
      serverCookieStore.set(
        getTikTokPublicPendingSelectionCookieName(),
        "",
        getTikTokPublicConnectionCookieOptions(0),
      );
      redirect(
        withFlashPath({
          returnTo: nextPath,
          notice: "connection-saved",
        }),
      );
    } catch (error) {
      redirect(
        withFlashPath({
          returnTo: nextPath,
          error: getActionErrorMessage(error),
        }),
      );
    }
  }

  async function clearConnectionAction(formData: FormData) {
    "use server";

    const nextPath = sanitizeTikTokPublicReturnPath(
      String(formData.get("returnTo") ?? ""),
    );
    const serverCookieStore = await cookies();
    serverCookieStore.set(
      getTikTokPublicConnectionCookieName(),
      "",
      getTikTokPublicConnectionCookieOptions(0),
    );
    serverCookieStore.set(
      getTikTokPublicPendingSelectionCookieName(),
      "",
      getTikTokPublicConnectionCookieOptions(0),
    );
    redirect(
      withFlashPath({
        returnTo: nextPath,
        notice: "connection-cleared",
      }),
    );
  }

  async function completeOauthSelectionAction(formData: FormData) {
    "use server";

    const advertiserId = String(formData.get("advertiserId") ?? "").trim();
    const nextPath = sanitizeTikTokPublicReturnPath(
      String(formData.get("returnTo") ?? ""),
    );

    try {
      const serverCookieStore = await cookies();
      const pendingAdvertiserSelection = readTikTokPublicPendingSelectionCookieValue(
        serverCookieStore.get(getTikTokPublicPendingSelectionCookieName())?.value,
      );

      if (!pendingAdvertiserSelection) {
        throw new Error("No pending TikTok advertiser selection was found.");
      }

      const advertiser = pendingAdvertiserSelection.advertisers.find(
        (candidate) => candidate.advertiserId === advertiserId,
      );

      if (!advertiser) {
        throw new Error("That TikTok advertiser is no longer available.");
      }

      serverCookieStore.set(
        getTikTokPublicConnectionCookieName(),
        createTikTokPublicConnectionCookieValue({
          advertiserId: advertiser.advertiserId,
          advertiserName: advertiser.advertiserName,
          accessToken: pendingAdvertiserSelection.accessToken,
        }),
        getTikTokPublicConnectionCookieOptions(
          getTikTokPublicConnectionMaxAgeSeconds(),
        ),
      );
      serverCookieStore.set(
        getTikTokPublicPendingSelectionCookieName(),
        "",
        getTikTokPublicConnectionCookieOptions(0),
      );
      redirect(
        withFlashPath({
          returnTo: pendingAdvertiserSelection.returnTo,
          notice: "connection-saved",
        }),
      );
    } catch (error) {
      redirect(
        withFlashPath({
          returnTo: nextPath,
          error: getActionErrorMessage(error),
        }),
      );
    }
  }

  let result: Awaited<ReturnType<typeof getPaidViewsForSparkItems>> | null = null;
  let errorMessage = getSearchParamValue(resolvedSearchParams, "error") ?? null;

  if (hasLookupInput && !errorMessage) {
    if (!connection) {
      errorMessage = "Save a TikTok advertiser connection before running a lookup.";
    } else {
      try {
        result = hasManualItemIds
          ? await getPaidViewsForSparkItems({
              creatorLabel,
              advertiserId: connection.advertiserId,
              accessToken: connection.accessToken,
              itemIds: itemIdsInput,
              startDate,
              endDate,
              metric,
            })
          : await getPaidViewsForCreator({
              creatorName: creatorLabel,
              advertiserId: connection.advertiserId,
              accessToken: connection.accessToken,
              startDate,
              endDate,
              metric,
            });
      } catch (error) {
        errorMessage =
          error instanceof Error
            ? error.message
            : "Could not load TikTok paid views for this creator.";
      }
    }
  }

  const metricCopy = getMetricDisplayCopy(result?.metric ?? metric);
  const visibleRows = result ? result.rows.filter((row) => row.metricValue > 0) : [];
  const hiddenZeroRowCount = result ? Math.max(result.rows.length - visibleRows.length, 0) : 0;
  const matchedGroups = buildMatchedGroups({
    rows: visibleRows,
    matchedAds: result?.matchedAds ?? [],
  });
  const resolvedPosts = getResolvedPostsForMatchedAds(result?.matchedAds ?? []);
  const resolvedPostCount = resolvedPosts.length;
  const knownVideoGroupCount = matchedGroups.filter((group) => group.kind === "video").length;
  const creativeOnlyGroupCount = matchedGroups.length - knownVideoGroupCount;

  return (
    <div className="mx-auto w-full max-w-7xl space-y-4 px-4 py-4 sm:px-6 lg:px-8 lg:py-6">
      {notice ? (
        <section className="rounded-[1.25rem] border border-[#90FF4D]/20 bg-[#90FF4D]/[0.08] px-4 py-3 text-sm text-[#D7FFBC]">
          {notice}
        </section>
      ) : null}

      <section className="rounded-[1.55rem] border border-white/[0.08] bg-white/[0.03] p-5 shadow-[0_24px_70px_rgba(0,0,0,0.2)] backdrop-blur">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl">
            <p className="text-xs uppercase tracking-[0.28em] text-muted-foreground">
              TikTok Spark Ads
            </p>
            <h1 className="mt-2 text-2xl font-medium tracking-[-0.045em] text-foreground">
              Prisma-free paid views lookup.
            </h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              This page talks directly to TikTok’s reporting API. Save an advertiser
              ID and access token in an encrypted browser cookie, then either
              auto-discover a creator’s existing Spark posts or query paid
              delivery by Spark <code>item_id</code> with no workspace database
              required.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              className="inline-flex min-h-11 items-center rounded-[0.95rem] border border-white/[0.12] bg-black/[0.24] px-4 text-sm font-medium text-foreground transition hover:border-white/[0.2]"
              href="/"
            >
              Home
            </Link>
          </div>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-[1.1rem] border border-white/[0.08] bg-black/[0.22] p-4">
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
              Connection
            </p>
            <p className="mt-2 text-sm font-medium text-foreground">
              {connection ? "Connected" : "Missing"}
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              {connection
                ? connection.advertiserName
                  ? `${connection.advertiserName} (${connection.advertiserId})`
                  : connection.advertiserId
                : oauthConfigured
                  ? "Connect with TikTok OAuth or save an advertiser ID and token below."
                  : "Save a TikTok advertiser ID and access token below."}
            </p>
          </div>
          <div className="rounded-[1.1rem] border border-white/[0.08] bg-black/[0.22] p-4">
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
              Storage
            </p>
            <p className="mt-2 text-sm font-medium text-foreground">Encrypted cookie</p>
            <p className="mt-2 text-xs text-muted-foreground">
              Credentials stay out of the URL and are only stored in this browser.
            </p>
          </div>
          <div className="rounded-[1.1rem] border border-white/[0.08] bg-black/[0.22] p-4">
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
              Creator lookup
            </p>
            <p className="mt-2 text-sm font-medium text-foreground">
              Auto-discovery first
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              Leave Spark item IDs blank to discover existing Spark ads for a
              creator. Paste item IDs only when you want manual override.
            </p>
          </div>
          <div className="rounded-[1.1rem] border border-white/[0.08] bg-black/[0.22] p-4">
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
              Date window
            </p>
            <p className="mt-2 text-sm font-medium text-foreground">
              {formatDate(startDate)} to {formatDate(endDate)}
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              The report runs on demand against TikTok’s integrated reporting API.
            </p>
          </div>
        </div>
      </section>

      {pendingSelection ? (
        <section className="rounded-[1.55rem] border border-[#FFD24D]/20 bg-[#FFD24D]/[0.08] p-5 shadow-[0_24px_70px_rgba(0,0,0,0.2)] backdrop-blur">
          <div className="flex flex-col gap-2">
            <p className="text-xs uppercase tracking-[0.28em] text-[#FFEAB1]/80">
              Advertiser selection
            </p>
            <h2 className="text-lg font-medium tracking-[-0.03em] text-foreground">
              Choose which TikTok advertiser account to use.
            </h2>
            <p className="text-sm leading-6 text-muted-foreground">
              TikTok returned multiple advertiser accounts for this OAuth session.
              Pick the one you want saved into this browser.
            </p>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-2">
            {pendingSelection.advertisers.map((advertiser) => (
              <form
                action={completeOauthSelectionAction}
                className="rounded-[1.15rem] border border-white/[0.08] bg-black/[0.22] p-4"
                key={advertiser.advertiserId}
              >
                <input name="advertiserId" type="hidden" value={advertiser.advertiserId} />
                <input name="returnTo" type="hidden" value={returnTo} />
                <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                  Advertiser
                </p>
                <p className="mt-2 text-sm font-medium text-foreground">
                  {advertiser.advertiserName ?? "Unnamed advertiser"}
                </p>
                <p className="mt-2 text-xs text-muted-foreground">
                  {advertiser.advertiserId}
                </p>
                <button
                  className="mt-4 inline-flex min-h-10 items-center justify-center rounded-[0.95rem] border border-[#90FF4D]/20 bg-[#90FF4D]/90 px-4 text-sm font-medium text-black transition hover:bg-[#A4FF68]"
                  type="submit"
                >
                  Use this advertiser
                </button>
              </form>
            ))}
          </div>
        </section>
      ) : null}

      <section className="rounded-[1.55rem] border border-white/[0.08] bg-white/[0.03] p-5 shadow-[0_24px_70px_rgba(0,0,0,0.2)] backdrop-blur">
        <div className="flex flex-col gap-2">
          <p className="text-xs uppercase tracking-[0.28em] text-muted-foreground">
            TikTok connection
          </p>
          <h2 className="text-lg font-medium tracking-[-0.03em] text-foreground">
            Connect with TikTok or paste credentials manually.
          </h2>
          <p className="text-sm leading-6 text-muted-foreground">
            Use OAuth for the smoothest flow, or paste an advertiser ID and access
            token if you already have one. Either way, the saved connection stays in
            this browser only.
          </p>
        </div>

        {oauthConfigured ? (
          <div className="mt-5 flex flex-wrap gap-3">
            <Link
              className="inline-flex min-h-11 items-center rounded-[0.95rem] border border-[#90FF4D]/20 bg-[#90FF4D]/90 px-4 text-sm font-medium text-black transition hover:bg-[#A4FF68]"
              href={oauthConnectHref}
            >
              Connect with TikTok OAuth
            </Link>
            <p className="self-center text-xs text-muted-foreground">
              TikTok will return here and save the selected advertiser into an
              encrypted cookie.
            </p>
          </div>
        ) : null}

        <form action={saveConnectionAction} className="mt-5 space-y-4">
          <input name="returnTo" type="hidden" value={returnTo} />
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.5fr)_auto]">
            <label className="block">
              <span className="mb-2 block text-xs uppercase tracking-[0.2em] text-muted-foreground">
                Advertiser ID
              </span>
              <input
                className="h-11 w-full rounded-[0.95rem] border border-white/[0.08] bg-black/[0.24] px-3.5 text-sm text-foreground outline-none transition placeholder:text-muted-foreground/60 focus:border-white/[0.16]"
                defaultValue={connection?.advertiserId ?? ""}
                name="advertiserId"
                placeholder="7480039305227098128"
                type="text"
              />
            </label>
            <label className="block">
              <span className="mb-2 block text-xs uppercase tracking-[0.2em] text-muted-foreground">
                Advertiser name
              </span>
              <input
                className="h-11 w-full rounded-[0.95rem] border border-white/[0.08] bg-black/[0.24] px-3.5 text-sm text-foreground outline-none transition placeholder:text-muted-foreground/60 focus:border-white/[0.16]"
                defaultValue={connection?.advertiserName ?? ""}
                name="advertiserName"
                placeholder="Optional label"
                type="text"
              />
            </label>
            <label className="block">
              <span className="mb-2 block text-xs uppercase tracking-[0.2em] text-muted-foreground">
                Access token
              </span>
              <input
                className="h-11 w-full rounded-[0.95rem] border border-white/[0.08] bg-black/[0.24] px-3.5 text-sm text-foreground outline-none transition placeholder:text-muted-foreground/60 focus:border-white/[0.16]"
                defaultValue=""
                name="accessToken"
                placeholder={connection ? "Saved. Paste a fresh token to replace it." : "Paste TikTok Business access token"}
                type="password"
              />
            </label>
            <div className="flex items-end gap-2">
              <button
                className="inline-flex min-h-11 items-center justify-center rounded-[0.95rem] border border-[#90FF4D]/20 bg-[#90FF4D]/90 px-4 text-sm font-medium text-black transition hover:bg-[#A4FF68]"
                type="submit"
              >
                Save connection
              </button>
            </div>
          </div>
        </form>

        {connection ? (
          <form action={clearConnectionAction} className="mt-3">
            <input name="returnTo" type="hidden" value={returnTo} />
            <button
              className="inline-flex min-h-10 items-center rounded-[0.95rem] border border-white/[0.12] bg-black/[0.24] px-4 text-sm font-medium text-foreground transition hover:border-white/[0.2]"
              type="submit"
            >
              Clear saved connection
            </button>
          </form>
        ) : null}

        {connection?.savedAt ? (
          <p className="mt-3 text-xs text-muted-foreground">
            Last saved {dateFormatter.format(connection.savedAt)}.
          </p>
        ) : null}
      </section>

      <section className="rounded-[1.55rem] border border-white/[0.08] bg-white/[0.03] p-5 shadow-[0_24px_70px_rgba(0,0,0,0.2)] backdrop-blur">
        <form className="space-y-4" method="get">
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
            <label className="block">
              <span className="mb-2 block text-xs uppercase tracking-[0.2em] text-muted-foreground">
                Creator handle or label
              </span>
              <input
                className="h-11 w-full rounded-[0.95rem] border border-white/[0.08] bg-black/[0.24] px-3.5 text-sm text-foreground outline-none transition placeholder:text-muted-foreground/60 focus:border-white/[0.16]"
                defaultValue={creatorLabel}
                name="creator"
                placeholder="@creator"
                type="text"
              />
            </label>
            <label className="block lg:col-span-1">
              <span className="mb-2 block text-xs uppercase tracking-[0.2em] text-muted-foreground">
                Spark item IDs
              </span>
              <textarea
                className="min-h-24 w-full rounded-[0.95rem] border border-white/[0.08] bg-black/[0.24] px-3.5 py-3 text-sm text-foreground outline-none transition placeholder:text-muted-foreground/60 focus:border-white/[0.16]"
                defaultValue={itemIdsInput}
                name="itemIds"
                placeholder={"Optional manual override: paste comma or newline separated item IDs"}
              />
            </label>
            <label className="block">
              <span className="mb-2 block text-xs uppercase tracking-[0.2em] text-muted-foreground">
                Start date
              </span>
              <input
                className="h-11 w-full rounded-[0.95rem] border border-white/[0.08] bg-black/[0.24] px-3.5 text-sm text-foreground outline-none transition focus:border-white/[0.16]"
                defaultValue={startDate}
                name="startDate"
                type="date"
              />
            </label>
            <label className="block">
              <span className="mb-2 block text-xs uppercase tracking-[0.2em] text-muted-foreground">
                End date
              </span>
              <input
                className="h-11 w-full rounded-[0.95rem] border border-white/[0.08] bg-black/[0.24] px-3.5 text-sm text-foreground outline-none transition focus:border-white/[0.16]"
                defaultValue={endDate}
                name="endDate"
                type="date"
              />
            </label>
            <label className="block">
              <span className="mb-2 block text-xs uppercase tracking-[0.2em] text-muted-foreground">
                Metric
              </span>
              <select
                className="h-11 w-full rounded-[0.95rem] border border-white/[0.08] bg-black/[0.24] px-3.5 text-sm text-foreground outline-none transition focus:border-white/[0.16]"
                defaultValue={metric}
                name="metric"
              >
                {metricOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex items-end">
              <button
                className="inline-flex min-h-11 w-full items-center justify-center rounded-[0.95rem] border border-[#90FF4D]/20 bg-[#90FF4D]/90 px-4 text-sm font-medium text-black transition hover:bg-[#A4FF68]"
                type="submit"
              >
                Run lookup
              </button>
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            Leave Spark item IDs blank to auto-discover existing Spark ads for the
            creator from TikTok identities and ads. If you paste item IDs, manual
            mode wins and the creator field becomes a label again.
          </p>
        </form>
      </section>

      {errorMessage ? (
        <section className="rounded-[1.25rem] border border-[#FF7E54]/20 bg-[#FF7E54]/[0.08] px-4 py-3 text-sm text-[#FFD3C5]">
          {errorMessage}
        </section>
      ) : null}

      {result ? (
        <>
          <section className="rounded-[1.55rem] border border-white/[0.08] bg-white/[0.03] p-5 shadow-[0_24px_70px_rgba(0,0,0,0.2)] backdrop-blur">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.28em] text-muted-foreground">
                  Result
                </p>
                <h2 className="mt-2 text-xl font-medium tracking-[-0.04em] text-foreground">
                  {result.creatorLabel}
                </h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {result.discoveryMode === "manual_item_ids"
                    ? `${metricCopy.shortLabel} for the Spark items you provided.`
                    : `${metricCopy.shortLabel} for the Spark ads TikTok matched to this creator.`}
                </p>
                {result.resolvedIdentities.length > 0 ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Resolved via {result.resolvedIdentities.join(", ")}.
                  </p>
                ) : null}
                {result.matchedSparkItemIds.length > 0 ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Exact post info resolved for {numberFormatter.format(resolvedPostCount)} of{" "}
                    {numberFormatter.format(result.matchedSparkItemIds.length)} known video IDs.
                  </p>
                ) : null}
              </div>
              <div className="rounded-[1.1rem] border border-[#90FF4D]/20 bg-[#90FF4D]/[0.08] px-4 py-3 text-right">
                <p className="text-xs uppercase tracking-[0.2em] text-[#D7FFBC]">
                  {metricCopy.totalLabel}
                </p>
                <p className="mt-2 text-3xl font-medium tracking-[-0.04em] text-[#F3FFE8]">
                  {numberFormatter.format(result.paidViews)}
                </p>
              </div>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
              <div className="rounded-[1.1rem] border border-white/[0.08] bg-black/[0.22] p-4">
                <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                  Advertiser ID
                </p>
                <p className="mt-2 text-sm font-medium text-foreground">
                  {result.advertiserId}
                </p>
              </div>
              <div className="rounded-[1.1rem] border border-white/[0.08] bg-black/[0.22] p-4">
                <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                  Match mode
                </p>
                <p className="mt-2 text-sm font-medium text-foreground">
                  {result.discoveryMode === "manual_item_ids"
                    ? "Manual item IDs"
                    : "Creator discovery"}
                </p>
              </div>
              <div className="rounded-[1.1rem] border border-white/[0.08] bg-black/[0.22] p-4">
                <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                  Matched groups
                </p>
                <p className="mt-2 text-sm font-medium text-foreground">
                  {numberFormatter.format(matchedGroups.length)}
                </p>
              </div>
              <div className="rounded-[1.1rem] border border-white/[0.08] bg-black/[0.22] p-4">
                <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                  Underlying ads
                </p>
                <p className="mt-2 text-sm font-medium text-foreground">
                  {numberFormatter.format(result.matchedAdIds.length)}
                </p>
              </div>
              <div className="rounded-[1.1rem] border border-white/[0.08] bg-black/[0.22] p-4">
                <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                  Known video IDs
                </p>
                <p className="mt-2 text-sm font-medium text-foreground">
                  {numberFormatter.format(result.matchedSparkItemIds.length)}
                </p>
              </div>
              <div className="rounded-[1.1rem] border border-white/[0.08] bg-black/[0.22] p-4">
                <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                  Date range
                </p>
                <p className="mt-2 text-sm font-medium text-foreground">
                  {formatDate(result.startDate)} to {formatDate(result.endDate)}
                </p>
              </div>
            </div>

            {result.warnings.length > 0 ? (
              <div className="mt-5 rounded-[1.1rem] border border-[#FFD24D]/20 bg-[#FFD24D]/[0.08] p-4 text-sm text-[#FFEAB1]">
                <p className="text-xs uppercase tracking-[0.2em] text-[#FFEAB1]/80">
                  Warnings
                </p>
                <ul className="mt-2 space-y-1.5">
                  {result.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            {hiddenZeroRowCount > 0 ? (
              <div className="mt-5 rounded-[1.1rem] border border-white/[0.08] bg-black/[0.22] p-4 text-sm text-muted-foreground">
                Hidden {numberFormatter.format(hiddenZeroRowCount)} zero-value daily rows
                to keep the breakdown readable.
              </div>
            ) : null}
          </section>

          <section className="rounded-[1.55rem] border border-white/[0.08] bg-white/[0.03] p-5 shadow-[0_24px_70px_rgba(0,0,0,0.2)] backdrop-blur">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.28em] text-muted-foreground">
                  Matched results
                </p>
                <h3 className="mt-2 text-lg font-medium tracking-[-0.03em] text-foreground">
                  Grouped videos and creatives
                </h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  Known Spark video IDs are grouped as videos. If TikTok hides the
                  video ID, the match falls back to the ad or creative instead.
                </p>
                <p className="mt-2 text-xs text-muted-foreground">
                  {numberFormatter.format(knownVideoGroupCount)} grouped videos ·{" "}
                  {numberFormatter.format(creativeOnlyGroupCount)} ad-only fallbacks
                </p>
              </div>
            </div>

            {matchedGroups.length > 0 ? (
              <div className="mt-5 space-y-4">
                {matchedGroups.map((group) => (
                  <details
                    className="group rounded-[1.15rem] border border-white/[0.08] bg-black/[0.22] p-4"
                    key={group.key}
                  >
                    <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                        <div className="flex gap-4">
                          {group.kind === "video" && group.primaryPost?.coverUrl ? (
                            <div className="h-24 w-[72px] overflow-hidden rounded-[0.95rem] border border-white/[0.08] bg-black/[0.2]">
                              <img
                                alt={`Cover for ${getBestPostTitle(group.primaryPost)}`}
                                className="h-full w-full object-cover"
                                loading="lazy"
                                src={group.primaryPost.coverUrl}
                              />
                            </div>
                          ) : null}
                          <div>
                            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                              {group.kind === "video" ? "Matched video" : "Matched creative"}
                            </p>
                            <h4 className="mt-2 text-base font-medium text-foreground">
                              {group.title}
                            </h4>
                            <p className="mt-2 text-xs leading-5 text-muted-foreground">
                              {group.subtitle}
                            </p>
                            <p className="mt-2 text-xs leading-5 text-muted-foreground">
                              {group.kind === "video"
                                ? `Underlying ads: ${group.ads
                                    .map((ad) => ad.adLabel)
                                    .slice(0, 2)
                                    .join(", ")}${group.ads.length > 2 ? ` +${group.ads.length - 2} more` : ""}`
                                : group.resolvedPosts.length > 0
                                  ? `Resolved posts: ${numberFormatter.format(group.resolvedPosts.length)} · Spark item IDs: ${summarizeItemIds(group.itemIds)}`
                                  : group.itemIds.length > 0
                                    ? `Spark item IDs: ${summarizeItemIds(group.itemIds)}`
                                    : "TikTok did not return a Spark video ID for this creative."}
                            </p>
                          </div>
                        </div>
                        <div className="rounded-[1rem] border border-[#90FF4D]/20 bg-[#90FF4D]/[0.08] px-4 py-3 text-right">
                          <p className="text-xs uppercase tracking-[0.2em] text-[#D7FFBC]">
                            {metricCopy.shortLabel}
                          </p>
                          <p className="mt-2 text-2xl font-medium tracking-[-0.03em] text-[#F3FFE8]">
                            {numberFormatter.format(group.totalValue)}
                          </p>
                        </div>
                      </div>
                      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
                        <span>
                          {formatDate(group.firstDate)} to {formatDate(group.lastDate)} ·{" "}
                          {numberFormatter.format(group.activeDays)} active day
                          {group.activeDays === 1 ? "" : "s"}
                        </span>
                        <span className="inline-flex min-h-8 items-center rounded-full border border-white/[0.1] bg-white/[0.04] px-3 text-foreground transition group-open:border-[#90FF4D]/25 group-open:bg-[#90FF4D]/10">
                          {group.kind === "video" ? "Show video charts" : "Show creative charts"}
                        </span>
                      </div>
                    </summary>

                    <div className="mt-4 border-t border-white/[0.08] pt-4">
                      {group.resolvedPosts.length > 0 ? (
                        <div className="mb-4">
                          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                            Resolved TikTok posts
                          </p>
                          <div className="mt-3 grid gap-3 md:grid-cols-2">
                            {group.resolvedPosts.map((post) => (
                              <div
                                className="rounded-[1rem] border border-white/[0.08] bg-black/[0.2] p-4"
                                key={post.itemId}
                              >
                                <div className="flex gap-4">
                                  {post.coverUrl ? (
                                    <div className="h-24 w-[72px] overflow-hidden rounded-[0.9rem] border border-white/[0.08] bg-black/[0.28]">
                                      <img
                                        alt={`Cover for ${getBestPostTitle(post)}`}
                                        className="h-full w-full object-cover"
                                        loading="lazy"
                                        src={post.coverUrl}
                                      />
                                    </div>
                                  ) : null}
                                  <div className="min-w-0">
                                    <p className="text-sm font-medium text-foreground">
                                      {getBestPostTitle(post)}
                                    </p>
                                    <p className="mt-2 text-xs text-muted-foreground">
                                      Video ID {post.itemId}
                                    </p>
                                    {post.createTime ? (
                                      <p className="mt-2 text-xs text-muted-foreground">
                                        Posted {formatDate(post.createTime)}
                                      </p>
                                    ) : null}
                                    {post.shareUrl ? (
                                      <a
                                        className="mt-3 inline-flex min-h-9 items-center rounded-[0.85rem] border border-white/[0.12] bg-black/[0.24] px-3 text-xs font-medium text-foreground transition hover:border-white/[0.2]"
                                        href={post.shareUrl}
                                        rel="noreferrer"
                                        target="_blank"
                                      >
                                        Open TikTok post
                                      </a>
                                    ) : null}
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : null}

                      <DailyMetricChart
                        metricLabel={metricCopy.rowValueLabel}
                        points={group.dailyPoints}
                      />

                      <div className="mt-4 grid gap-3 lg:grid-cols-3">
                        <div className="rounded-[1rem] border border-white/[0.08] bg-black/[0.2] p-4">
                          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                            Active days
                          </p>
                          <p className="mt-2 text-sm font-medium text-foreground">
                            {numberFormatter.format(group.activeDays)}
                          </p>
                        </div>
                        <div className="rounded-[1rem] border border-white/[0.08] bg-black/[0.2] p-4">
                          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                            Rows in group
                          </p>
                          <p className="mt-2 text-sm font-medium text-foreground">
                            {numberFormatter.format(group.rowCount)}
                          </p>
                        </div>
                        <div className="rounded-[1rem] border border-white/[0.08] bg-black/[0.2] p-4">
                          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                            Underlying ads
                          </p>
                          <p className="mt-2 text-sm font-medium text-foreground">
                            {numberFormatter.format(group.ads.length)}
                          </p>
                        </div>
                      </div>

                      <div className="mt-4">
                        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                          Ads in this group
                        </p>
                        <div className="mt-3 grid gap-3 md:grid-cols-2">
                          {group.ads.map((ad) => (
                            <div
                              className="rounded-[1rem] border border-white/[0.08] bg-black/[0.2] p-4"
                              key={ad.adId}
                            >
                              <div className="flex gap-4">
                                {ad.primaryPost?.coverUrl ? (
                                  <div className="h-20 w-[60px] overflow-hidden rounded-[0.85rem] border border-white/[0.08] bg-black/[0.28]">
                                    <img
                                      alt={`Cover for ${getBestPostTitle(ad.primaryPost)}`}
                                      className="h-full w-full object-cover"
                                      loading="lazy"
                                      src={ad.primaryPost.coverUrl}
                                    />
                                  </div>
                                ) : null}
                                <div className="min-w-0">
                                  <p className="text-sm font-medium text-foreground">
                                    {ad.adLabel}
                                  </p>
                                  <p className="mt-2 text-xs text-muted-foreground">
                                    Ad ID {ad.adId}
                                  </p>
                                  {ad.primaryPost ? (
                                    <p className="mt-2 text-xs leading-5 text-muted-foreground">
                                      Resolved post: {getBestPostTitle(ad.primaryPost)}
                                    </p>
                                  ) : null}
                                  <p className="mt-2 text-xs leading-5 text-muted-foreground">
                                    {ad.itemIds.length > 0
                                      ? `Spark item IDs: ${summarizeItemIds(ad.itemIds)}`
                                      : "TikTok did not return a Spark video ID for this ad."}
                                  </p>
                                  {ad.primaryPost?.shareUrl ? (
                                    <a
                                      className="mt-3 inline-flex min-h-8 items-center rounded-[0.8rem] border border-white/[0.12] bg-black/[0.24] px-3 text-xs font-medium text-foreground transition hover:border-white/[0.2]"
                                      href={ad.primaryPost.shareUrl}
                                      rel="noreferrer"
                                      target="_blank"
                                    >
                                      Open TikTok post
                                    </a>
                                  ) : null}
                                  <p className="mt-3 text-sm font-medium text-foreground">
                                    {numberFormatter.format(ad.totalValue)}{" "}
                                    {metricCopy.rowValueLabel.toLowerCase()}
                                  </p>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </details>
                ))}
              </div>
            ) : result.rows.length > 0 ? (
              <p className="mt-5 text-sm leading-6 text-muted-foreground">
                TikTok returned rows for this lookup, but every row in the selected
                window had a value of zero.
              </p>
            ) : (
              <p className="mt-5 text-sm leading-6 text-muted-foreground">
                TikTok returned no matching paid-delivery rows for this lookup in
                the selected window.
              </p>
            )}
          </section>
        </>
      ) : hasLookupInput && !errorMessage ? (
        <section className="rounded-[1.25rem] border border-white/[0.08] bg-white/[0.03] px-4 py-3 text-sm text-muted-foreground">
          No paid TikTok data matched this lookup in the selected date range.
        </section>
      ) : null}
    </div>
  );
}
