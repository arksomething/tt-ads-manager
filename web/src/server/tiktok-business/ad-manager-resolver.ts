import { prisma } from "@/lib/db";

import { requestTikTokBusinessApi } from "./client";

const MAX_REPORT_PAGES = 20;
const MAX_LIST_PAGES = 20;
const REPORT_PAGE_SIZE = 1_000;
const LIST_PAGE_SIZE = 100;
const AD_GET_FIELDS_CANDIDATES: Array<readonly string[] | undefined> = [
  [
    "ad_id",
    "ad_name",
    "identity_id",
    "identity_type",
    "identity_authorized_bc_id",
    "tiktok_item_id",
    "display_name",
    "creative_type",
    "secondary_status",
  ],
  [
    "ad_id",
    "ad_name",
    "identity_id",
    "identity_type",
    "tiktok_item_id",
    "display_name",
  ],
  ["ad_id", "ad_name", "identity_id", "identity_type"],
  undefined,
] as const;
const MAX_VIDEO_INFO_LOOKUPS = 20;
const VIDEO_INFO_LOOKUP_BATCH_SIZE = 2;
const VIDEO_INFO_LOOKUP_BATCH_DELAY_MS = 500;
const METADATA_CACHE_TTL_MS = 5 * 60 * 1_000;
const RESOLVED_POST_CACHE_TTL_MS = 15 * 60 * 1_000;
const SUPPORTED_VIDEO_INFO_IDENTITY_TYPES = new Set([
  "AUTH_CODE",
  "TT_USER",
  "BC_AUTH_TT",
]);

type TikTokIntegratedReportRow = Record<string, unknown> & {
  dimensions?: Record<string, unknown>;
  metrics?: Record<string, unknown>;
};

type TikTokIntegratedReportData = {
  list?: TikTokIntegratedReportRow[];
  page_info?: Record<string, unknown>;
};

type TikTokListData = Record<string, unknown> & {
  list?: Record<string, unknown>[];
  page_info?: Record<string, unknown>;
};

type TikTokPaidViewsRow = {
  adId: string | null;
  itemId: string | null;
  statDate: string | null;
  metricValue: number;
  raw: Record<string, unknown>;
};

type TikTokAdRecord = {
  adId: string;
  adName: string | null;
  identityId: string | null;
  identityType: string | null;
  identityAuthorizedBcId: string | null;
  tiktokItemId: string | null;
  displayName: string | null;
};

type TikTokVideoInfoIdentityType = "AUTH_CODE" | "TT_USER" | "BC_AUTH_TT";

type TikTokVideoLookupContext = {
  itemId: string;
  identityId: string;
  identityType: TikTokVideoInfoIdentityType;
  identityAuthorizedBcId: string | null;
};

type TikTokResolvedPost = {
  itemId: string;
  title: string | null;
  coverUrl: string | null;
  shareUrl: string | null;
};

type CachedValue<T> = {
  expiresAt: number;
  value: T;
};

type TikTokResolvedAdGroup = {
  adId: string;
  adName: string | null;
  displayName: string | null;
  itemIds: string[];
  resolvedPosts: TikTokResolvedPost[];
};

type MatchLevel = "exact_item_id" | "exact_post_url" | "name_fallback";

export type ResolveTikTokAdsManagerCandidatesArgs = {
  organizationSlug: string;
  startDate: string;
  endDate: string;
  singularRow: {
    creativeId: string | null;
    creativeName: string | null;
    tiktokPostId: string | null;
    creativeUrl: string | null;
    campaignName: string | null;
    subCampaignName: string | null;
  };
};

export type TikTokAdsManagerCandidate = {
  adId: string;
  adName: string | null;
  adsManagerUrl: string;
  displayName: string | null;
  itemIds: string[];
  matchLevel: MatchLevel;
  shareUrl: string | null;
  subtitle: string;
  title: string;
};

export type TikTokAdsManagerResolveResult = {
  advertiserId: string;
  candidates: TikTokAdsManagerCandidate[];
  warnings: string[];
};

const advertiserAdsCache = new Map<
  string,
  CachedValue<{
    ads: TikTokAdRecord[];
    warnings: string[];
  }>
>();
const resolvedPostCache = new Map<string, CachedValue<TikTokResolvedPost | null>>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getFirstString(records: Array<Record<string, unknown> | null>, keys: string[]) {
  for (const record of records) {
    if (!record) {
      continue;
    }

    for (const key of keys) {
      const value = record[key];

      if (typeof value === "string" && value.trim().length > 0) {
        return value;
      }

      if (typeof value === "number" && Number.isFinite(value)) {
        return String(value);
      }

      if (Array.isArray(value)) {
        const primitiveValue = value.find(
          (entry) =>
            (typeof entry === "string" && entry.trim().length > 0) ||
            (typeof entry === "number" && Number.isFinite(entry)),
        );

        if (typeof primitiveValue === "string") {
          return primitiveValue;
        }

        if (typeof primitiveValue === "number") {
          return String(primitiveValue);
        }
      }
    }
  }

  return null;
}

function getFirstNumber(records: Array<Record<string, unknown> | null>, keys: string[]) {
  for (const record of records) {
    if (!record) {
      continue;
    }

    for (const key of keys) {
      const value = record[key];
      const numberValue =
        typeof value === "number"
          ? value
          : typeof value === "string"
            ? Number(value)
            : null;

      if (typeof numberValue === "number" && Number.isFinite(numberValue)) {
        return numberValue;
      }
    }
  }

  return 0;
}

function getRecordArray(
  payload: Record<string, unknown>,
  keys: string[],
): Record<string, unknown>[] {
  for (const key of keys) {
    const value = payload[key];

    if (Array.isArray(value)) {
      return value.filter(isRecord);
    }
  }

  return [];
}

function getNestedRecordCandidates(record: Record<string, unknown>, keys: string[]) {
  const nestedRecords: Record<string, unknown>[] = [];

  for (const key of keys) {
    const value = record[key];

    if (Array.isArray(value)) {
      nestedRecords.push(...value.filter(isRecord));
      continue;
    }

    if (isRecord(value)) {
      nestedRecords.push(value);
    }
  }

  return nestedRecords;
}

function uniqueNonEmptyStrings(values: ReadonlyArray<string | null | undefined>) {
  return [...new Set(values.filter((value): value is string => Boolean(value && value.trim())))];
}

function normalizeMatchText(value: string | null | undefined) {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function isMeaningfulMatchLabel(value: string | null | undefined) {
  const trimmed = value?.trim() ?? "";

  if (trimmed.length < 3) {
    return false;
  }

  return !/^ad\s+\d+$/i.test(trimmed) && !/^video\s+\d+$/i.test(trimmed);
}

function extractTikTokVideoIdFromUrl(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const match = value.match(/\/video\/(\d+)/i);
  return match ? match[1] : null;
}

function getMeaningfulAdLabel(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed && !/^ad\s+\d+$/i.test(trimmed) ? trimmed : null;
}

function getBestPostTitle(post: TikTokResolvedPost | null) {
  const title = post?.title?.trim();
  return title && title.length > 0 ? title : null;
}

function normalizeVideoInfoIdentityType(
  value: string | null,
): TikTokVideoInfoIdentityType | null {
  if (!value) {
    return null;
  }

  const normalized = value.trim().toUpperCase();
  return SUPPORTED_VIDEO_INFO_IDENTITY_TYPES.has(normalized)
    ? (normalized as TikTokVideoInfoIdentityType)
    : null;
}

function normalizeAdRecord(record: Record<string, unknown>): TikTokAdRecord | null {
  const candidates = [
    record,
    ...getNestedRecordCandidates(record, [
      "creatives",
      "creative_infos",
      "creative_info",
      "creative_list",
      "materials",
    ]),
  ];
  const adId = getFirstString(candidates, ["ad_id", "adId"]);

  if (!adId) {
    return null;
  }

  return {
    adId,
    adName: getFirstString(candidates, ["ad_name", "adName"]),
    identityId: getFirstString(candidates, ["identity_id", "identityId"]),
    identityType: getFirstString(candidates, ["identity_type", "identityType"]),
    identityAuthorizedBcId: getFirstString(candidates, [
      "identity_authorized_bc_id",
      "identityAuthorizedBcId",
    ]),
    tiktokItemId: getFirstString(candidates, [
      "tiktok_item_id",
      "tiktokItemId",
      "item_id",
      "itemId",
    ]),
    displayName: getFirstString(candidates, ["display_name", "displayName"]),
  };
}

function normalizeResolvedPost(
  record: Record<string, unknown>,
  fallbackItemId?: string,
): TikTokResolvedPost | null {
  const candidates = [
    record,
    ...getNestedRecordCandidates(record, [
      "video",
      "videos",
      "video_list",
      "videoList",
      "video_infos",
      "videoInfos",
      "video_info",
      "videoInfo",
      "item",
      "items",
      "item_list",
      "itemList",
      "item_info",
      "itemInfo",
      "post_info",
      "postInfo",
      "share_info",
      "shareInfo",
    ]),
  ];
  const itemId =
    getFirstString(candidates, [
      "item_id",
      "itemId",
      "video_id",
      "videoId",
      "tiktok_item_id",
      "tiktokItemId",
      "aweme_item_id",
      "awemeItemId",
    ]) ?? fallbackItemId ?? null;

  if (!itemId) {
    return null;
  }

  const title = getFirstString(candidates, [
    "title",
    "video_title",
    "videoTitle",
    "video_name",
    "videoName",
    "caption",
    "description",
    "desc",
    "name",
    "display_name",
    "displayName",
  ]);
  const coverUrl = getFirstString(candidates, [
    "cover_url",
    "coverUrl",
    "video_cover_url",
    "videoCoverUrl",
    "poster_url",
    "posterUrl",
    "cover_image_url",
    "coverImageUrl",
    "thumbnail_url",
    "thumbnailUrl",
    "image_url",
    "imageUrl",
  ]);
  const shareUrl = getFirstString(candidates, [
    "share_url",
    "shareUrl",
    "video_share_url",
    "videoShareUrl",
    "tiktok_url",
    "tiktokUrl",
    "permalink",
    "permalink_url",
    "permalinkUrl",
    "url",
  ]);

  if (!title && !coverUrl && !shareUrl) {
    return null;
  }

  return {
    itemId,
    title,
    coverUrl,
    shareUrl,
  };
}

function readCachedValue<T>(cache: Map<string, CachedValue<T>>, key: string) {
  const cached = cache.get(key);

  if (!cached) {
    return { found: false as const };
  }

  if (cached.expiresAt <= Date.now()) {
    cache.delete(key);
    return { found: false as const };
  }

  return {
    found: true as const,
    value: cached.value,
  };
}

function writeCachedValue<T>(
  cache: Map<string, CachedValue<T>>,
  key: string,
  value: T,
  ttlMs: number,
) {
  cache.set(key, {
    expiresAt: Date.now() + ttlMs,
    value,
  });
}

function buildMetadataCacheKey(args: {
  advertiserId: string;
  accessToken: string;
}) {
  return `${args.advertiserId}:${args.accessToken}`;
}

function buildResolvedPostCacheKey(args: {
  advertiserId: string;
  itemId: string;
  identityId: string;
  identityType: TikTokVideoInfoIdentityType;
  identityAuthorizedBcId: string | null;
}) {
  return [
    "video-info-v2",
    args.advertiserId,
    args.identityId,
    args.identityType,
    args.identityAuthorizedBcId ?? "",
    args.itemId,
  ].join(":");
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getReportRows(payload: TikTokIntegratedReportData) {
  if (!Array.isArray(payload.list)) {
    return [];
  }

  return payload.list.filter(isRecord);
}

function getTotalPages(args: {
  payload: { page_info?: Record<string, unknown> };
  currentRows: number;
  pageSize: number;
  maxPages: number;
}) {
  const pageInfo = isRecord(args.payload.page_info) ? args.payload.page_info : null;
  const totalPages = getFirstNumber([pageInfo], ["total_page", "total_pages"]);

  if (totalPages > 0) {
    return Math.max(1, Math.trunc(totalPages));
  }

  return args.currentRows < args.pageSize ? 1 : args.maxPages;
}

function normalizeReportRow(row: TikTokIntegratedReportRow): TikTokPaidViewsRow {
  const dimensions = isRecord(row.dimensions) ? row.dimensions : null;
  const metrics = isRecord(row.metrics) ? row.metrics : null;

  return {
    adId: getFirstString([dimensions, row], ["ad_id", "adId"]),
    itemId: getFirstString([dimensions, row], ["item_id", "itemId"]),
    statDate: getFirstString([dimensions, row], ["stat_time_day", "statTimeDay"]),
    metricValue: getFirstNumber([metrics, row], ["impressions"]),
    raw: row,
  };
}

async function fetchPaidReportRows(args: {
  advertiserId: string;
  accessToken: string;
  startDate: string;
  endDate: string;
}) {
  const rows: TikTokIntegratedReportRow[] = [];
  const warnings: string[] = [];
  let totalPages = 1;

  for (let page = 1; page <= totalPages && page <= MAX_REPORT_PAGES; page += 1) {
    const payload = await requestTikTokBusinessApi<TikTokIntegratedReportData>({
      accessToken: args.accessToken,
      method: "GET",
      path: "/open_api/v1.3/report/integrated/get/",
      query: {
        report_type: "BASIC",
        advertiser_id: args.advertiserId,
        data_level: "AUCTION_AD",
        dimensions: ["stat_time_day", "ad_id", "item_id"],
        metrics: ["impressions"],
        start_date: args.startDate,
        end_date: args.endDate,
        page,
        page_size: REPORT_PAGE_SIZE,
      },
    });

    const pageRows = getReportRows(payload);
    rows.push(...pageRows);
    totalPages = getTotalPages({
      payload,
      currentRows: pageRows.length,
      pageSize: REPORT_PAGE_SIZE,
      maxPages: MAX_REPORT_PAGES,
    });

    if (pageRows.length < REPORT_PAGE_SIZE) {
      break;
    }
  }

  if (totalPages > MAX_REPORT_PAGES) {
    warnings.push(
      `TikTok reporting returned more than ${MAX_REPORT_PAGES} pages. The result may be truncated.`,
    );
  }

  return {
    rows: rows.map((row) => normalizeReportRow(row)),
    warnings,
  };
}

async function fetchAdvertiserAdsWithFields(args: {
  advertiserId: string;
  accessToken: string;
  fields?: readonly string[];
}) {
  const ads: TikTokAdRecord[] = [];
  let totalPages = 1;

  for (let page = 1; page <= totalPages && page <= MAX_LIST_PAGES; page += 1) {
    const payload = await requestTikTokBusinessApi<TikTokListData>({
      accessToken: args.accessToken,
      method: "GET",
      path: "/open_api/v1.3/ad/get/",
      query: {
        advertiser_id: args.advertiserId,
        page,
        page_size: LIST_PAGE_SIZE,
        ...(args.fields ? { fields: args.fields } : {}),
      },
    });

    const pageAds = getRecordArray(payload, ["list"])
      .map((ad) => normalizeAdRecord(ad))
      .filter((ad): ad is TikTokAdRecord => Boolean(ad));

    ads.push(...pageAds);
    totalPages = getTotalPages({
      payload,
      currentRows: pageAds.length,
      pageSize: LIST_PAGE_SIZE,
      maxPages: MAX_LIST_PAGES,
    });

    if (pageAds.length < LIST_PAGE_SIZE) {
      break;
    }
  }

  return ads;
}

async function fetchAdvertiserAds(args: {
  advertiserId: string;
  accessToken: string;
}) {
  const cacheKey = buildMetadataCacheKey(args);
  const cached = readCachedValue(advertiserAdsCache, cacheKey);

  if (cached.found) {
    return cached.value;
  }

  let lastError: unknown = null;

  for (const [index, fields] of AD_GET_FIELDS_CANDIDATES.entries()) {
    try {
      const ads = await fetchAdvertiserAdsWithFields({
        advertiserId: args.advertiserId,
        accessToken: args.accessToken,
        fields,
      });

      const result = {
        ads,
        warnings:
          index > 0
            ? [
                "TikTok rejected the richer ad field set, so the matcher fell back to a simpler ad lookup response.",
              ]
            : [],
      };

      writeCachedValue(advertiserAdsCache, cacheKey, result, METADATA_CACHE_TTL_MS);
      return result;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Could not load TikTok ads for this advertiser.");
}

async function fetchMatchedAdsByIdsBestEffort(args: {
  advertiserId: string;
  accessToken: string;
  adIds: readonly string[];
}) {
  if (args.adIds.length === 0) {
    return {
      ads: [] as TikTokAdRecord[],
      warnings: [] as string[],
    };
  }

  try {
    const advertiserAds = await fetchAdvertiserAds(args);
    const adIdSet = new Set(args.adIds);
    const matchedAds = advertiserAds.ads.filter((ad) => adIdSet.has(ad.adId));

    return {
      ads: matchedAds,
      warnings: uniqueNonEmptyStrings([
        ...advertiserAds.warnings,
        ...(matchedAds.length < adIdSet.size
          ? [
              "TikTok only returned ad metadata for some matched ads, so a few matches may still rely on raw ad IDs.",
            ]
          : []),
      ]),
    };
  } catch {
    return {
      ads: [] as TikTokAdRecord[],
      warnings: [
        "Could not load TikTok ad metadata to enrich the matching ads with names or post details.",
      ],
    };
  }
}

function buildVideoLookupContexts(args: {
  ads?: readonly TikTokAdRecord[];
  rows?: readonly TikTokPaidViewsRow[];
}) {
  const rowItemIdsByAdId = new Map<string, Set<string>>();
  const candidateItemIds = new Set<string>();

  for (const row of args.rows ?? []) {
    if (row.itemId) {
      candidateItemIds.add(row.itemId);
    }

    if (!row.adId || !row.itemId) {
      continue;
    }

    const existingSet = rowItemIdsByAdId.get(row.adId);

    if (existingSet) {
      existingSet.add(row.itemId);
      continue;
    }

    rowItemIdsByAdId.set(row.adId, new Set([row.itemId]));
  }

  const contexts = new Map<string, TikTokVideoLookupContext>();

  for (const ad of args.ads ?? []) {
    const itemIds = uniqueNonEmptyStrings([
      ad.tiktokItemId,
      ...(rowItemIdsByAdId.has(ad.adId) ? [...(rowItemIdsByAdId.get(ad.adId) ?? [])] : []),
    ]);

    for (const itemId of itemIds) {
      candidateItemIds.add(itemId);
    }

    const identityType = normalizeVideoInfoIdentityType(ad.identityType);

    if (
      itemIds.length === 0 ||
      !ad.identityId ||
      !identityType ||
      (identityType === "BC_AUTH_TT" && !ad.identityAuthorizedBcId)
    ) {
      continue;
    }

    for (const itemId of itemIds) {
      if (!contexts.has(itemId)) {
        contexts.set(itemId, {
          itemId,
          identityId: ad.identityId,
          identityType,
          identityAuthorizedBcId: ad.identityAuthorizedBcId,
        });
      }
    }
  }

  return {
    candidateItemIds: [...candidateItemIds].sort(),
    contexts,
  };
}

async function fetchIdentityVideoInfo(args: {
  advertiserId: string;
  accessToken: string;
  itemId: string;
  identityId: string;
  identityType: TikTokVideoInfoIdentityType;
  identityAuthorizedBcId: string | null;
}) {
  const cacheKey = buildResolvedPostCacheKey(args);
  const cached = readCachedValue(resolvedPostCache, cacheKey);

  if (cached.found) {
    return cached.value;
  }

  const payload = await requestTikTokBusinessApi<Record<string, unknown> | null>({
    accessToken: args.accessToken,
    method: "GET",
    path: "/open_api/v1.3/identity/video/info/",
    query: {
      advertiser_id: args.advertiserId,
      identity_type: args.identityType,
      identity_id: args.identityId,
      video_id: args.itemId,
      item_id: args.itemId,
      ...(args.identityType === "BC_AUTH_TT" && args.identityAuthorizedBcId
        ? {
            identity_authorized_bc_id: args.identityAuthorizedBcId,
          }
        : {}),
    },
  });

  const resolvedPost = normalizeResolvedPost(isRecord(payload) ? payload : {}, args.itemId);
  writeCachedValue(resolvedPostCache, cacheKey, resolvedPost, RESOLVED_POST_CACHE_TTL_MS);
  return resolvedPost;
}

async function fetchResolvedPostsForAds(args: {
  advertiserId: string;
  accessToken: string;
  ads?: readonly TikTokAdRecord[];
  rows?: readonly TikTokPaidViewsRow[];
}) {
  const { candidateItemIds, contexts } = buildVideoLookupContexts(args);

  if (candidateItemIds.length === 0) {
    return {
      resolvedPostsByItemId: new Map<string, TikTokResolvedPost>(),
      warnings: [] as string[],
    };
  }

  if (contexts.size === 0) {
    return {
      resolvedPostsByItemId: new Map<string, TikTokResolvedPost>(),
      warnings: [
        "TikTok exposed Spark item IDs for some matched ads, but not enough identity metadata to fetch the underlying post details.",
      ],
    };
  }

  const itemIdsToLookup = [...contexts.keys()].slice(0, MAX_VIDEO_INFO_LOOKUPS);
  const resolvedPostsByItemId = new Map<string, TikTokResolvedPost>();
  const pendingContexts: TikTokVideoLookupContext[] = [];

  for (const itemId of itemIdsToLookup) {
    const context = contexts.get(itemId);

    if (!context) {
      continue;
    }

    const cached = readCachedValue(
      resolvedPostCache,
      buildResolvedPostCacheKey({
        advertiserId: args.advertiserId,
        itemId: context.itemId,
        identityId: context.identityId,
        identityType: context.identityType,
        identityAuthorizedBcId: context.identityAuthorizedBcId,
      }),
    );

    if (cached.found) {
      if (cached.value) {
        resolvedPostsByItemId.set(itemId, cached.value);
      }

      continue;
    }

    pendingContexts.push(context);
  }

  for (let start = 0; start < pendingContexts.length; start += VIDEO_INFO_LOOKUP_BATCH_SIZE) {
    const batch = pendingContexts.slice(start, start + VIDEO_INFO_LOOKUP_BATCH_SIZE);
    const batchResults = await Promise.allSettled(
      batch.map((context) =>
        fetchIdentityVideoInfo({
          advertiserId: args.advertiserId,
          accessToken: args.accessToken,
          itemId: context.itemId,
          identityId: context.identityId,
          identityType: context.identityType,
          identityAuthorizedBcId: context.identityAuthorizedBcId,
        }),
      ),
    );

    for (const [index, result] of batchResults.entries()) {
      if (result.status !== "fulfilled" || !result.value) {
        continue;
      }

      resolvedPostsByItemId.set(batch[index]!.itemId, result.value);
    }

    if (start + VIDEO_INFO_LOOKUP_BATCH_SIZE < pendingContexts.length) {
      await sleep(VIDEO_INFO_LOOKUP_BATCH_DELAY_MS);
    }
  }

  return {
    resolvedPostsByItemId,
    warnings: uniqueNonEmptyStrings([
      ...(contexts.size > MAX_VIDEO_INFO_LOOKUPS
        ? [
            `Resolved exact post info for the first ${MAX_VIDEO_INFO_LOOKUPS} known Spark item IDs only to keep the lookup fast.`,
          ]
        : []),
      ...(resolvedPostsByItemId.size === 0
        ? [
            "TikTok exposed Spark item IDs, but not the exact underlying public post metadata. Those matches use ad-level labels and Ads Manager ad links when available.",
          ]
        : resolvedPostsByItemId.size < candidateItemIds.length
          ? [
              `Resolved exact public post info for ${resolvedPostsByItemId.size} of ${candidateItemIds.length} known Spark item IDs.`,
            ]
          : []),
    ]),
  };
}

function buildMatchedAdGroups(args: {
  ads?: readonly TikTokAdRecord[];
  rows?: readonly TikTokPaidViewsRow[];
  resolvedPostsByItemId?: ReadonlyMap<string, TikTokResolvedPost>;
}) {
  const resolvedPostsByItemId = args.resolvedPostsByItemId ?? new Map();
  const groups = new Map<
    string,
    {
      adId: string;
      adName: string | null;
      displayName: string | null;
      itemIds: Set<string>;
    }
  >();

  for (const ad of args.ads ?? []) {
    const existing = groups.get(ad.adId);

    if (existing) {
      existing.adName ??= ad.adName;
      existing.displayName ??= ad.displayName;

      if (ad.tiktokItemId) {
        existing.itemIds.add(ad.tiktokItemId);
      }

      continue;
    }

    groups.set(ad.adId, {
      adId: ad.adId,
      adName: ad.adName,
      displayName: ad.displayName,
      itemIds: new Set(ad.tiktokItemId ? [ad.tiktokItemId] : []),
    });
  }

  for (const row of args.rows ?? []) {
    if (!row.adId) {
      continue;
    }

    const existing = groups.get(row.adId);

    if (existing) {
      if (row.itemId) {
        existing.itemIds.add(row.itemId);
      }

      continue;
    }

    groups.set(row.adId, {
      adId: row.adId,
      adName: null,
      displayName: null,
      itemIds: new Set(row.itemId ? [row.itemId] : []),
    });
  }

  return [...groups.values()]
    .map((group) => ({
      adId: group.adId,
      adName: group.adName,
      displayName: group.displayName,
      itemIds: [...group.itemIds].sort(),
      resolvedPosts: [...group.itemIds]
        .sort()
        .map((itemId) => resolvedPostsByItemId.get(itemId))
        .filter((post): post is TikTokResolvedPost => Boolean(post)),
    }))
    .sort((left, right) => left.adId.localeCompare(right.adId));
}

function getGroupNameKeys(group: TikTokResolvedAdGroup) {
  return uniqueNonEmptyStrings([
    group.adName,
    group.displayName,
    ...group.resolvedPosts.map((post) => post.title),
  ])
    .filter(isMeaningfulMatchLabel)
    .map((value) => normalizeMatchText(value))
    .filter((value) => value.length > 0);
}

function buildAdsManagerUrl(advertiserId: string, adId: string) {
  const url = new URL("https://ads.tiktok.com/i18n/perf/advertiser/ad");
  url.searchParams.set("aadvid", advertiserId);
  url.searchParams.set("advertiser_id", advertiserId);
  url.searchParams.set("ad_id", adId);
  return url.toString();
}

function getMatchLevelWeight(matchLevel: MatchLevel) {
  switch (matchLevel) {
    case "exact_item_id":
      return 0;
    case "exact_post_url":
      return 1;
    default:
      return 2;
  }
}

function buildCandidateSubtitle(args: {
  group: TikTokResolvedAdGroup;
  matchLevel: MatchLevel;
  singularRow: ResolveTikTokAdsManagerCandidatesArgs["singularRow"];
}) {
  const matchLabel =
    args.matchLevel === "exact_item_id"
      ? "Matched by item ID"
      : args.matchLevel === "exact_post_url"
        ? args.singularRow.tiktokPostId
          ? "Matched by post ID"
          : "Matched by post URL"
        : "Matched by name";

  return uniqueNonEmptyStrings([
    `Ad ID ${args.group.adId}`,
    args.group.itemIds.length === 1 ? `Video ID ${args.group.itemIds[0]}` : null,
    args.group.itemIds.length > 1 ? `${args.group.itemIds.length} Spark IDs` : null,
    args.singularRow.campaignName?.trim() || args.singularRow.subCampaignName?.trim() || null,
    matchLabel,
  ]).join(" · ");
}

function matchResolvedAdGroups(args: {
  advertiserId: string;
  groups: TikTokResolvedAdGroup[];
  singularRow: ResolveTikTokAdsManagerCandidatesArgs["singularRow"];
}) {
  const exactItemId = args.singularRow.creativeId?.trim() || null;
  const exactPostVideoId =
    args.singularRow.tiktokPostId?.trim() ||
    extractTikTokVideoIdFromUrl(args.singularRow.creativeUrl);
  const normalizedCreativeName = isMeaningfulMatchLabel(args.singularRow.creativeName)
    ? normalizeMatchText(args.singularRow.creativeName)
    : "";

  return args.groups
    .map((group) => {
      let matchLevel: MatchLevel | null = null;

      if (exactItemId && group.itemIds.includes(exactItemId)) {
        matchLevel = "exact_item_id";
      } else if (exactPostVideoId && group.itemIds.includes(exactPostVideoId)) {
        matchLevel = "exact_post_url";
      } else if (
        normalizedCreativeName.length > 0 &&
        getGroupNameKeys(group).includes(normalizedCreativeName)
      ) {
        matchLevel = "name_fallback";
      }

      if (!matchLevel) {
        return null;
      }

      const primaryPost = group.resolvedPosts.find((post) =>
        Boolean(post.shareUrl || post.title || post.coverUrl),
      ) ?? group.resolvedPosts[0] ?? null;

      return {
        adId: group.adId,
        adName: group.adName,
        adsManagerUrl: buildAdsManagerUrl(args.advertiserId, group.adId),
        displayName: group.displayName,
        itemIds: group.itemIds,
        matchLevel,
        shareUrl: primaryPost?.shareUrl ?? null,
        subtitle: buildCandidateSubtitle({
          group,
          matchLevel,
          singularRow: args.singularRow,
        }),
        title:
          getBestPostTitle(primaryPost) ??
          getMeaningfulAdLabel(group.adName) ??
          getMeaningfulAdLabel(group.displayName) ??
          `Ad ${group.adId}`,
      } satisfies TikTokAdsManagerCandidate;
    })
    .filter((candidate): candidate is TikTokAdsManagerCandidate => Boolean(candidate))
    .sort(
      (left, right) =>
        getMatchLevelWeight(left.matchLevel) - getMatchLevelWeight(right.matchLevel) ||
        left.title.localeCompare(right.title),
    );
}

async function getOrgTikTokAccount(organizationSlug: string) {
  const activeAccount = await prisma.organizationTikTokAccount.findFirst({
    where: {
      organization: {
        slug: organizationSlug,
      },
      status: "ACTIVE",
    },
    orderBy: [{ updatedAt: "desc" }],
    select: {
      advertiserId: true,
      accessToken: true,
      status: true,
    },
  });

  if (activeAccount) {
    return {
      account: activeAccount,
      warnings: [] as string[],
    };
  }

  const latestAccount = await prisma.organizationTikTokAccount.findFirst({
    where: {
      organization: {
        slug: organizationSlug,
      },
    },
    orderBy: [{ updatedAt: "desc" }],
    select: {
      advertiserId: true,
      accessToken: true,
      status: true,
    },
  });

  if (!latestAccount) {
    throw new Error(
      "No TikTok advertiser account is configured for this organization. Add one in Integrations first.",
    );
  }

  return {
    account: latestAccount,
    warnings: [
      `Using the latest TikTok account even though its status is ${latestAccount.status}.`,
    ],
  };
}

export async function resolveTikTokAdsManagerCandidates(
  args: ResolveTikTokAdsManagerCandidatesArgs,
): Promise<TikTokAdsManagerResolveResult> {
  const creativeSignals = uniqueNonEmptyStrings([
    args.singularRow.creativeId,
    args.singularRow.creativeName,
    args.singularRow.tiktokPostId,
    args.singularRow.creativeUrl,
  ]);

  if (creativeSignals.length === 0) {
    throw new Error("This row does not have enough creative metadata to match a TikTok ad.");
  }

  const { account, warnings: accountWarnings } = await getOrgTikTokAccount(args.organizationSlug);
  const report = await fetchPaidReportRows({
    advertiserId: account.advertiserId,
    accessToken: account.accessToken,
    startDate: args.startDate,
    endDate: args.endDate,
  });
  const scopedAdIds = uniqueNonEmptyStrings(report.rows.map((row) => row.adId));
  const matchedAds = await fetchMatchedAdsByIdsBestEffort({
    advertiserId: account.advertiserId,
    accessToken: account.accessToken,
    adIds: scopedAdIds,
  });
  const baseGroups = buildMatchedAdGroups({
    ads: matchedAds.ads,
    rows: report.rows,
  });
  let candidates = matchResolvedAdGroups({
    advertiserId: account.advertiserId,
    groups: baseGroups,
    singularRow: args.singularRow,
  });
  let resolvedPostWarnings: string[] = [];

  if (candidates.length > 0) {
    const matchedAdIds = new Set(candidates.map((candidate) => candidate.adId));
    const resolvedPosts = await fetchResolvedPostsForAds({
      advertiserId: account.advertiserId,
      accessToken: account.accessToken,
      ads: matchedAds.ads.filter((ad) => matchedAdIds.has(ad.adId)),
      rows: report.rows.filter((row) => row.adId && matchedAdIds.has(row.adId)),
    });

    resolvedPostWarnings = resolvedPosts.warnings;

    if (resolvedPosts.resolvedPostsByItemId.size > 0) {
      const enrichedGroups = buildMatchedAdGroups({
        ads: matchedAds.ads.filter((ad) => matchedAdIds.has(ad.adId)),
        rows: report.rows.filter((row) => row.adId && matchedAdIds.has(row.adId)),
        resolvedPostsByItemId: resolvedPosts.resolvedPostsByItemId,
      });
      const enrichedCandidates = new Map(
        matchResolvedAdGroups({
          advertiserId: account.advertiserId,
          groups: enrichedGroups,
          singularRow: args.singularRow,
        }).map((candidate) => [candidate.adId, candidate] as const),
      );

      candidates = candidates.map((candidate) => enrichedCandidates.get(candidate.adId) ?? candidate);
    }
  } else {
    const resolvedPosts = await fetchResolvedPostsForAds({
      advertiserId: account.advertiserId,
      accessToken: account.accessToken,
      ads: matchedAds.ads,
      rows: report.rows,
    });

    resolvedPostWarnings = resolvedPosts.warnings;

    candidates = matchResolvedAdGroups({
      advertiserId: account.advertiserId,
      groups: buildMatchedAdGroups({
        ads: matchedAds.ads,
        rows: report.rows,
        resolvedPostsByItemId: resolvedPosts.resolvedPostsByItemId,
      }),
      singularRow: args.singularRow,
    });
  }

  return {
    advertiserId: account.advertiserId,
    candidates,
    warnings: uniqueNonEmptyStrings([
      ...accountWarnings,
      ...report.warnings,
      ...matchedAds.warnings,
      ...resolvedPostWarnings,
      ...(candidates.length === 0
        ? [
            "No TikTok ad matched this creative in the selected date range.",
          ]
        : []),
    ]),
  };
}
