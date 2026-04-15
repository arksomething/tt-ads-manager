import {
  getTikTokSingularOverlay,
  type TikTokSingularOverlay,
  type TikTokSingularReportRow,
} from "@/server/singular/reporting";

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

const paidViewMetricMap = {
  impressions: "impressions",
  videoPlayActions: "video_play_actions",
} as const;

export type TikTokPaidViewMetric = keyof typeof paidViewMetricMap;
export type TikTokAdAttributionMatchMode = "exact" | "best_effort";
export type TikTokAdSingularMatchLevel =
  | "exact_item_id"
  | "exact_post_url"
  | "name_fallback"
  | "unavailable";

type QueryDateInput = Date | string;

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
  raw: Record<string, unknown>;
};

type TikTokVideoInfoIdentityType = "AUTH_CODE" | "TT_USER" | "BC_AUTH_TT";

type TikTokVideoLookupContext = {
  itemId: string;
  identityId: string;
  identityType: TikTokVideoInfoIdentityType;
  identityAuthorizedBcId: string | null;
};

export type TikTokResolvedPost = {
  itemId: string;
  title: string | null;
  coverUrl: string | null;
  shareUrl: string | null;
  createTime: string | null;
};

type CachedValue<T> = {
  expiresAt: number;
  value: T;
};

type TikTokMatchedAd = {
  adId: string;
  adName: string | null;
  displayName: string | null;
  itemIds: string[];
  resolvedPosts: TikTokResolvedPost[];
};

type TikTokAdGroup = {
  key: string;
  adId: string;
  adName: string | null;
  displayName: string | null;
  itemIds: string[];
  rows: TikTokPaidViewsRow[];
  totalValue: number;
  firstDate: string | null;
  lastDate: string | null;
  resolvedPosts: TikTokResolvedPost[];
  primaryPost: TikTokResolvedPost | null;
};

type TikTokAdSingularMetrics = {
  configured: boolean;
  cohortPeriod: string;
  matchLevel: TikTokAdSingularMatchLevel;
  matchedRowCount: number;
  spend: number;
  revenue: number;
  profit: number;
  installs: number;
  conversions: number;
  roas: number | null;
  currency: string | null;
  singularCreativeLabel: string | null;
  singularCampaignLabel: string | null;
};

export type TikTokAdProfitabilityRow = {
  adId: string;
  adName: string | null;
  displayName: string | null;
  title: string;
  subtitle: string;
  itemIds: string[];
  totalValue: number;
  rowCount: number;
  firstDate: string | null;
  lastDate: string | null;
  resolvedPosts: TikTokResolvedPost[];
  primaryPost: TikTokResolvedPost | null;
  singular: TikTokAdSingularMetrics;
};

export type TikTokAdProfitabilityReport = {
  advertiserId: string;
  metric: TikTokPaidViewMetric;
  matchMode: TikTokAdAttributionMatchMode;
  startDate: string;
  endDate: string;
  paidMetricTotal: number;
  rowCount: number;
  ads: TikTokAdProfitabilityRow[];
  singular: TikTokSingularOverlay;
  totals: {
    spend: number;
    revenue: number;
    profit: number;
    installs: number;
    conversions: number;
    matchedAds: number;
    profitableAds: number;
  };
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

function parseDateInput(value: QueryDateInput, label: string) {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new Error(`Invalid ${label}.`);
    }

    return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  }

  const normalized = value.trim();

  if (normalized.length === 0) {
    throw new Error(`Missing ${label}.`);
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return new Date(`${normalized}T00:00:00.000Z`);
  }

  const parsed = new Date(normalized);

  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid ${label}.`);
  }

  return new Date(
    Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate()),
  );
}

function toDateOnlyString(value: Date) {
  return value.toISOString().slice(0, 10);
}

function normalizeMatchText(value: string | null | undefined) {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function uniqueNonEmptyStrings(values: ReadonlyArray<string | null | undefined>) {
  return [...new Set(values.filter((value): value is string => Boolean(value && value.trim())))];
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

function getBestPostTitle(post: TikTokResolvedPost | null) {
  const title = post?.title?.trim();
  return title && title.length > 0 ? title : null;
}

function getMeaningfulAdLabel(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed && !/^ad\s+\d+$/i.test(trimmed) ? trimmed : null;
}

function getPrimaryResolvedPost(posts: readonly TikTokResolvedPost[]) {
  return (
    posts.find((post) => Boolean(post.title?.trim() || post.coverUrl || post.shareUrl)) ??
    posts[0] ??
    null
  );
}

function getPrimarySingularRow(rows: readonly TikTokSingularReportRow[]) {
  return (
    rows.find((row) =>
      Boolean(row.creativeName?.trim() || row.campaignName?.trim() || row.subCampaignName?.trim()),
    ) ??
    rows[0] ??
    null
  );
}

function getBestSingularCreativeLabel(row: TikTokSingularReportRow | null) {
  const creativeName = row?.creativeName?.trim();

  if (creativeName && creativeName.toUpperCase() !== "N/A") {
    return creativeName;
  }

  return row?.creativeId ? `Creative ${row.creativeId}` : null;
}

function getSingularCampaignLabel(row: TikTokSingularReportRow | null) {
  const campaignName = row?.campaignName?.trim() || null;
  const subCampaignName = row?.subCampaignName?.trim() || null;

  if (
    campaignName &&
    subCampaignName &&
    normalizeMatchText(campaignName) !== normalizeMatchText(subCampaignName)
  ) {
    return `${campaignName} · ${subCampaignName}`;
  }

  return campaignName ?? subCampaignName ?? null;
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
    raw: record,
  };
}

function normalizeResolvedPost(
  record: Record<string, unknown>,
  fallbackItemId?: string,
): TikTokResolvedPost | null {
  const candidates = [
    record,
    ...getNestedRecordCandidates(record, [
      "video_info",
      "videoInfo",
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
      "tiktok_item_id",
      "tiktokItemId",
      "aweme_item_id",
      "awemeItemId",
    ]) ?? fallbackItemId ?? null;

  if (!itemId) {
    return null;
  }

  return {
    itemId,
    title: getFirstString(candidates, [
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
    ]),
    coverUrl: getFirstString(candidates, [
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
    ]),
    shareUrl: getFirstString(candidates, [
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
    ]),
    createTime: getFirstString(candidates, [
      "create_time",
      "createTime",
      "publish_time",
      "publishTime",
      "published_at",
      "publishedAt",
      "post_time",
      "postTime",
    ]),
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
    args.advertiserId,
    args.identityId,
    args.identityType,
    args.identityAuthorizedBcId ?? "",
    args.itemId,
  ].join(":");
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

function normalizeReportRow(row: TikTokIntegratedReportRow, apiMetricName: string): TikTokPaidViewsRow {
  const dimensions = isRecord(row.dimensions) ? row.dimensions : null;
  const metrics = isRecord(row.metrics) ? row.metrics : null;

  return {
    adId: getFirstString([dimensions, row], ["ad_id", "adId"]),
    itemId: getFirstString([dimensions, row], ["item_id", "itemId"]),
    statDate: getFirstString([dimensions, row], ["stat_time_day", "statTimeDay"]),
    metricValue: getFirstNumber([metrics, row], [apiMetricName]),
    raw: row,
  };
}

async function fetchPaidReportRows(args: {
  advertiserId: string;
  accessToken: string;
  startDate: string;
  endDate: string;
  metric: TikTokPaidViewMetric;
}) {
  const apiMetricName = paidViewMetricMap[args.metric];
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
        metrics: [apiMetricName],
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
    rows,
    apiMetricName,
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
      .map(normalizeAdRecord)
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
                "TikTok rejected the richer ad field set, so the app fell back to a simpler ad lookup response.",
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
    const advertiserAds = await fetchAdvertiserAds({
      advertiserId: args.advertiserId,
      accessToken: args.accessToken,
    });
    const adIdSet = new Set(args.adIds);
    const matchedAds = advertiserAds.ads.filter((ad) => adIdSet.has(ad.adId));

    return {
      ads: matchedAds,
      warnings: uniqueNonEmptyStrings([
        ...advertiserAds.warnings,
        ...(matchedAds.length < adIdSet.size
          ? [
              "TikTok only returned ad metadata for some matched rows, so a few rows may still show raw ad IDs.",
            ]
          : []),
      ]),
    };
  } catch {
    return {
      ads: [] as TikTokAdRecord[],
      warnings: [
        "Could not load TikTok ad metadata to enrich the matched rows with ad names or post details.",
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
        "TikTok exposed Spark item IDs for some matches, but not enough identity metadata to fetch the underlying post details.",
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

  for (
    let start = 0;
    start < pendingContexts.length;
    start += VIDEO_INFO_LOOKUP_BATCH_SIZE
  ) {
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
            "TikTok exposed Spark item IDs, but not the exact underlying post metadata. Those matches use ad-level labels instead.",
          ]
        : resolvedPostsByItemId.size < candidateItemIds.length
          ? [
              `Resolved exact post info for ${resolvedPostsByItemId.size} of ${candidateItemIds.length} known Spark item IDs. TikTok hid the rest, so the remaining matches use ad names and Singular metadata when available.`,
            ]
          : []),
    ]),
  };
}

function buildMatchedAdSummaries(args: {
  ads?: readonly TikTokAdRecord[];
  rows?: readonly TikTokPaidViewsRow[];
  resolvedPostsByItemId?: ReadonlyMap<string, TikTokResolvedPost>;
}) {
  const resolvedPostsByItemId = args.resolvedPostsByItemId ?? new Map();
  const summaries = new Map<
    string,
    {
      adId: string;
      adName: string | null;
      displayName: string | null;
      itemIds: Set<string>;
    }
  >();

  for (const ad of args.ads ?? []) {
    const existingSummary = summaries.get(ad.adId);

    if (existingSummary) {
      existingSummary.adName ??= ad.adName;
      existingSummary.displayName ??= ad.displayName;

      if (ad.tiktokItemId) {
        existingSummary.itemIds.add(ad.tiktokItemId);
      }

      continue;
    }

    summaries.set(ad.adId, {
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

    const existingSummary = summaries.get(row.adId);

    if (existingSummary) {
      if (row.itemId) {
        existingSummary.itemIds.add(row.itemId);
      }

      continue;
    }

    summaries.set(row.adId, {
      adId: row.adId,
      adName: null,
      displayName: null,
      itemIds: new Set(row.itemId ? [row.itemId] : []),
    });
  }

  return [...summaries.values()]
    .map((summary) => ({
      adId: summary.adId,
      adName: summary.adName,
      displayName: summary.displayName,
      itemIds: [...summary.itemIds].sort(),
      resolvedPosts: [...summary.itemIds]
        .sort()
        .map((itemId) => resolvedPostsByItemId.get(itemId))
        .filter((post): post is TikTokResolvedPost => Boolean(post)),
    }))
    .sort((left, right) => left.adId.localeCompare(right.adId));
}

function buildAdGroups(args: {
  rows: TikTokPaidViewsRow[];
  matchedAds: TikTokMatchedAd[];
}) {
  const adMetadata = new Map(args.matchedAds.map((ad) => [ad.adId, ad] as const));
  const groups = new Map<
    string,
    {
      adId: string;
      itemIds: Set<string>;
      rows: TikTokPaidViewsRow[];
      totalValue: number;
    }
  >();

  for (const row of args.rows) {
    const adId = row.adId ?? "Unknown";
    const existingGroup = groups.get(adId);

    if (existingGroup) {
      existingGroup.totalValue += row.metricValue;
      existingGroup.rows.push(row);

      if (row.itemId) {
        existingGroup.itemIds.add(row.itemId);
      }

      continue;
    }

    groups.set(adId, {
      adId,
      itemIds: new Set(row.itemId ? [row.itemId] : []),
      rows: [row],
      totalValue: row.metricValue,
    });
  }

  return [...groups.values()].map((group) => {
    const metadata = adMetadata.get(group.adId);
    const itemIds = uniqueNonEmptyStrings([
      ...(metadata?.itemIds ?? []),
      ...group.rows.map((row) => row.itemId),
      ...group.itemIds,
    ]).sort();
    const sortedRows = [...group.rows].sort((left, right) =>
      (left.statDate ?? "").localeCompare(right.statDate ?? ""),
    );
    const resolvedPosts =
      metadata?.resolvedPosts.filter((post) => itemIds.includes(post.itemId)) ??
      metadata?.resolvedPosts ??
      [];
    const primaryPost =
      itemIds.length > 0
        ? resolvedPosts.find((post) => post.itemId === itemIds[0]) ?? getPrimaryResolvedPost(resolvedPosts)
        : getPrimaryResolvedPost(resolvedPosts);

    return {
      key: group.adId,
      adId: group.adId,
      adName: metadata?.adName ?? null,
      displayName: metadata?.displayName ?? null,
      itemIds,
      rows: sortedRows,
      totalValue: group.totalValue,
      firstDate: sortedRows[0]?.statDate ?? null,
      lastDate: sortedRows[sortedRows.length - 1]?.statDate ?? null,
      resolvedPosts,
      primaryPost,
    } satisfies TikTokAdGroup;
  });
}

function addSingularRowToLookup(
  lookup: Map<string, TikTokSingularReportRow[]>,
  key: string | null,
  row: TikTokSingularReportRow,
) {
  if (!key) {
    return;
  }

  const existingRows = lookup.get(key);

  if (existingRows) {
    existingRows.push(row);
    return;
  }

  lookup.set(key, [row]);
}

function getAdCandidateNameKeys(group: TikTokAdGroup) {
  return uniqueNonEmptyStrings([
    group.adName,
    group.displayName,
    ...group.resolvedPosts.map((post) => post.title),
  ])
    .filter(isMeaningfulMatchLabel)
    .map((value) => normalizeMatchText(value))
    .filter((value) => value.length > 0);
}

function buildSingularMetrics(args: {
  overlay: TikTokSingularOverlay;
  matchedRows: TikTokSingularReportRow[];
  matchLevel: TikTokAdSingularMatchLevel;
}) {
  const matchedRows = [...args.matchedRows].sort(
    (left, right) =>
      right.spend - left.spend ||
      right.revenue - left.revenue ||
      (left.creativeName ?? "").localeCompare(right.creativeName ?? ""),
  );
  const currencyCodes = uniqueNonEmptyStrings(matchedRows.map((row) => row.currency));
  const spend = matchedRows.reduce((total, row) => total + row.spend, 0);
  const revenue = matchedRows.reduce((total, row) => total + row.revenue, 0);
  const installs = matchedRows.reduce((total, row) => total + row.installs, 0);
  const conversions = matchedRows.reduce((total, row) => total + row.conversions, 0);
  const leadRow = getPrimarySingularRow(matchedRows);

  return {
    configured: args.overlay.configured,
    cohortPeriod: args.overlay.cohortPeriod,
    matchLevel: matchedRows.length > 0 ? args.matchLevel : "unavailable",
    matchedRowCount: matchedRows.length,
    spend,
    revenue,
    profit: revenue - spend,
    installs,
    conversions,
    roas: spend > 0 ? revenue / spend : null,
    currency: currencyCodes.length === 1 ? currencyCodes[0].toUpperCase() : null,
    singularCreativeLabel: getBestSingularCreativeLabel(leadRow),
    singularCampaignLabel: getSingularCampaignLabel(leadRow),
  } satisfies TikTokAdSingularMetrics;
}

function attachSingularMetricsToGroups(args: {
  groups: TikTokAdGroup[];
  singular: TikTokSingularOverlay;
  allowNameFallback: boolean;
}) {
  const rowsByCreativeId = new Map<string, TikTokSingularReportRow[]>();
  const rowsByVideoIdFromUrl = new Map<string, TikTokSingularReportRow[]>();
  const rowsByNameKey = new Map<string, TikTokSingularReportRow[]>();
  const groupKeysByName = new Map<string, Set<string>>();

  for (const row of args.singular.rows) {
    addSingularRowToLookup(rowsByCreativeId, row.creativeId, row);
    addSingularRowToLookup(rowsByVideoIdFromUrl, extractTikTokVideoIdFromUrl(row.creativeUrl), row);
    addSingularRowToLookup(rowsByNameKey, normalizeMatchText(row.creativeName), row);
  }

  for (const group of args.groups) {
    for (const nameKey of getAdCandidateNameKeys(group)) {
      const existingGroups = groupKeysByName.get(nameKey);

      if (existingGroups) {
        existingGroups.add(group.key);
        continue;
      }

      groupKeysByName.set(nameKey, new Set([group.key]));
    }
  }

  return args.groups.map((group) => {
    const matchedRows = new Map<string, TikTokSingularReportRow>();
    let matchLevel: TikTokAdSingularMatchLevel = "unavailable";

    for (const itemId of group.itemIds) {
      for (const row of rowsByCreativeId.get(itemId) ?? []) {
        matchedRows.set(row.rowKey, row);
      }
    }

    if (matchedRows.size > 0) {
      matchLevel = "exact_item_id";
    }

    if (matchedRows.size === 0) {
      for (const itemId of group.itemIds) {
        for (const row of rowsByVideoIdFromUrl.get(itemId) ?? []) {
          matchedRows.set(row.rowKey, row);
        }
      }

      if (matchedRows.size > 0) {
        matchLevel = "exact_post_url";
      }
    }

    if (matchedRows.size === 0 && args.allowNameFallback) {
      for (const nameKey of getAdCandidateNameKeys(group)) {
        if ((groupKeysByName.get(nameKey)?.size ?? 0) !== 1) {
          continue;
        }

        for (const row of rowsByNameKey.get(nameKey) ?? []) {
          matchedRows.set(row.rowKey, row);
        }
      }

      if (matchedRows.size > 0) {
        matchLevel = "name_fallback";
      }
    }

    const singular = buildSingularMetrics({
      overlay: args.singular,
      matchedRows: [...matchedRows.values()],
      matchLevel,
    });
    const title =
      getBestPostTitle(group.primaryPost) ??
      getMeaningfulAdLabel(group.adName) ??
      getMeaningfulAdLabel(group.displayName) ??
      singular.singularCreativeLabel ??
      `Ad ${group.adId}`;
    const subtitle = uniqueNonEmptyStrings([
      group.adId !== "Unknown" ? `Ad ID ${group.adId}` : "TikTok row missing ad ID",
      group.itemIds.length === 1 ? `Video ID ${group.itemIds[0]}` : null,
      group.itemIds.length > 1 ? `${group.itemIds.length} Spark IDs` : null,
      singular.singularCampaignLabel,
    ]).join(" · ");

    return {
      adId: group.adId,
      adName: group.adName,
      displayName: group.displayName,
      title,
      subtitle,
      itemIds: group.itemIds,
      totalValue: group.totalValue,
      rowCount: group.rows.length,
      firstDate: group.firstDate,
      lastDate: group.lastDate,
      resolvedPosts: group.resolvedPosts,
      primaryPost: group.primaryPost,
      singular,
    } satisfies TikTokAdProfitabilityRow;
  });
}

export async function getAdProfitabilityReportForAdvertiser(args: {
  advertiserId: string;
  accessToken: string;
  startDate: QueryDateInput;
  endDate: QueryDateInput;
  metric?: TikTokPaidViewMetric;
  matchMode?: TikTokAdAttributionMatchMode;
}): Promise<TikTokAdProfitabilityReport> {
  const advertiserId = args.advertiserId.trim();
  const accessToken = args.accessToken.trim();

  if (advertiserId.length === 0) {
    throw new Error("Advertiser ID is required.");
  }

  if (accessToken.length === 0) {
    throw new Error("Access token is required.");
  }

  const startDate = parseDateInput(args.startDate, "start date");
  const endDate = parseDateInput(args.endDate, "end date");

  if (endDate < startDate) {
    throw new Error("End date must be on or after start date.");
  }

  const metric = args.metric ?? "impressions";
  const matchMode = args.matchMode ?? "best_effort";
  const report = await fetchPaidReportRows({
    advertiserId,
    accessToken,
    startDate: toDateOnlyString(startDate),
    endDate: toDateOnlyString(endDate),
    metric,
  });
  const rows = report.rows.map((row) => normalizeReportRow(row, report.apiMetricName));
  const matchedAdIds = uniqueNonEmptyStrings(rows.map((row) => row.adId));
  const adMetadata = await fetchMatchedAdsByIdsBestEffort({
    advertiserId,
    accessToken,
    adIds: matchedAdIds,
  });
  const resolvedPosts = await fetchResolvedPostsForAds({
    advertiserId,
    accessToken,
    ads: adMetadata.ads,
    rows,
  });
  const singular = await getTikTokSingularOverlay({
    startDate: toDateOnlyString(startDate),
    endDate: toDateOnlyString(endDate),
  });
  const matchedAds = buildMatchedAdSummaries({
    ads: adMetadata.ads,
    rows,
    resolvedPostsByItemId: resolvedPosts.resolvedPostsByItemId,
  });
  const adRows = attachSingularMetricsToGroups({
    groups: buildAdGroups({
      rows,
      matchedAds,
    }),
    singular,
    allowNameFallback: matchMode === "best_effort",
  });

  return {
    advertiserId,
    metric,
    matchMode,
    startDate: toDateOnlyString(startDate),
    endDate: toDateOnlyString(endDate),
    paidMetricTotal: rows.reduce((total, row) => total + row.metricValue, 0),
    rowCount: rows.length,
    ads: adRows,
    singular,
    totals: {
      spend: adRows.reduce((total, row) => total + row.singular.spend, 0),
      revenue: adRows.reduce((total, row) => total + row.singular.revenue, 0),
      profit: adRows.reduce((total, row) => total + row.singular.profit, 0),
      installs: adRows.reduce((total, row) => total + row.singular.installs, 0),
      conversions: adRows.reduce((total, row) => total + row.singular.conversions, 0),
      matchedAds: adRows.filter((row) => row.singular.matchedRowCount > 0).length,
      profitableAds: adRows.filter((row) => row.singular.profit > 0).length,
    },
    warnings: uniqueNonEmptyStrings([
      ...report.warnings,
      ...adMetadata.warnings,
      ...resolvedPosts.warnings,
      ...(rows.length === 0
        ? [
            "TikTok returned no paid ad rows for this advertiser in the selected date range.",
          ]
        : []),
      ...(matchMode !== "best_effort"
        ? []
        : [
            "Best effort mode allows ad-name fallback when an exact Spark ID or TikTok post match is unavailable.",
          ]),
    ]),
  };
}
