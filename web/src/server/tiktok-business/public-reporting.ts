import {
  getDefaultTikTokSingularOverlay,
  getTikTokSingularOverlay,
  type TikTokSingularOverlay,
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
  identity_list?: Record<string, unknown>[];
  page_info?: Record<string, unknown>;
};

type TikTokIdentityRecord = {
  identityId: string;
  identityType: string | null;
  username: string | null;
  displayName: string | null;
  nickname: string | null;
  identityAuthorizedBcId: string | null;
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

const advertiserIdentityCache = new Map<string, CachedValue<TikTokIdentityRecord[]>>();
const advertiserAdsCache = new Map<
  string,
  CachedValue<{
    ads: TikTokAdRecord[];
    warnings: string[];
  }>
>();
const resolvedPostCache = new Map<string, CachedValue<TikTokResolvedPost | null>>();

export type TikTokMatchedAd = {
  adId: string;
  adName: string | null;
  displayName: string | null;
  itemIds: string[];
  resolvedPosts: TikTokResolvedPost[];
};

export type TikTokPaidViewsRow = {
  adId: string | null;
  itemId: string | null;
  statDate: string | null;
  metricValue: number;
  raw: Record<string, unknown>;
};

export type TikTokSparkItemPaidViewsResult = {
  creatorLabel: string;
  advertiserId: string;
  metric: TikTokPaidViewMetric;
  startDate: string;
  endDate: string;
  paidViews: number;
  matchedAds: TikTokMatchedAd[];
  matchedSparkItemIds: string[];
  matchedAdIds: string[];
  resolvedIdentities: string[];
  discoveryMode: "manual_item_ids" | "creator_discovery";
  rowCount: number;
  rows: TikTokPaidViewsRow[];
  singular: TikTokSingularOverlay;
  warnings: string[];
};

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

function normalizeLookupValue(value: string) {
  return value.trim().toLowerCase().replace(/^@/, "");
}

function formatIdentityLabel(identity: TikTokIdentityRecord) {
  const username = identity.username ? `@${identity.username}` : null;

  if (identity.displayName && username) {
    return normalizeLookupValue(identity.displayName) === normalizeLookupValue(username)
      ? username
      : `${identity.displayName} (${username})`;
  }

  return username ?? identity.displayName ?? identity.nickname ?? identity.identityId;
}

function normalizeIdentityRecord(record: Record<string, unknown>): TikTokIdentityRecord | null {
  const identityId = getFirstString([record], ["identity_id", "identityId"]);

  if (!identityId) {
    return null;
  }

  return {
    identityId,
    identityType: getFirstString([record], ["identity_type", "identityType"]),
    username: getFirstString([record], ["username", "user_name", "userName"]),
    displayName: getFirstString([record], ["display_name", "displayName", "name"]),
    nickname: getFirstString([record], ["nickname", "nick_name", "nickName"]),
    identityAuthorizedBcId: getFirstString([record], [
      "identity_authorized_bc_id",
      "identityAuthorizedBcId",
    ]),
    raw: record,
  };
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

function uniqueNonEmptyStrings(values: ReadonlyArray<string | null | undefined>) {
  return [...new Set(values.filter((value): value is string => Boolean(value && value.trim())))];
}

function normalizeSparkItemIds(value: string | readonly string[]) {
  const parts = typeof value === "string"
    ? value
        .split(/[\s,]+/)
        .map((entry: string) => entry.trim())
        .filter(Boolean)
    : value;

  return uniqueNonEmptyStrings(parts);
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

function validateCredentials(args: {
  advertiserId: string;
  accessToken: string;
}) {
  const advertiserId = args.advertiserId.trim();
  const accessToken = args.accessToken.trim();

  if (advertiserId.length === 0) {
    throw new Error("Advertiser ID is required.");
  }

  if (accessToken.length === 0) {
    throw new Error("Access token is required.");
  }

  return {
    advertiserId,
    accessToken,
  };
}

async function fetchPaidReportRows(args: {
  advertiserId: string;
  accessToken: string;
  startDate: string;
  endDate: string;
  metric: TikTokPaidViewMetric;
  filterFieldName?: "item_id";
  filterValues?: string[];
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
        ...(args.filterFieldName && args.filterValues && args.filterValues.length > 0
          ? {
              filtering: [
                {
                  field_name: args.filterFieldName,
                  filter_type: "IN",
                  filter_value: JSON.stringify(args.filterValues),
                },
              ],
            }
          : {}),
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

async function fetchAdvertiserIdentities(args: {
  advertiserId: string;
  accessToken: string;
}) {
  const cacheKey = buildMetadataCacheKey(args);
  const cached = readCachedValue(advertiserIdentityCache, cacheKey);

  if (cached.found) {
    return cached.value;
  }

  const identities: TikTokIdentityRecord[] = [];
  let totalPages = 1;

  for (let page = 1; page <= totalPages && page <= MAX_LIST_PAGES; page += 1) {
    const payload = await requestTikTokBusinessApi<TikTokListData>({
      accessToken: args.accessToken,
      method: "GET",
      path: "/open_api/v1.3/identity/get/",
      query: {
        advertiser_id: args.advertiserId,
        page,
        page_size: LIST_PAGE_SIZE,
      },
    });

    const pageRecords = getRecordArray(payload, ["identity_list", "list"])
      .map(normalizeIdentityRecord)
      .filter((identity): identity is TikTokIdentityRecord => Boolean(identity));

    identities.push(...pageRecords);
    totalPages = getTotalPages({
      payload,
      currentRows: pageRecords.length,
      pageSize: LIST_PAGE_SIZE,
      maxPages: MAX_LIST_PAGES,
    });

    if (pageRecords.length < LIST_PAGE_SIZE) {
      break;
    }
  }

  writeCachedValue(advertiserIdentityCache, cacheKey, identities, METADATA_CACHE_TTL_MS);

  return identities;
}

function resolveCreatorIdentities(args: {
  creatorName: string;
  identities: TikTokIdentityRecord[];
}) {
  const lookupValue = normalizeLookupValue(args.creatorName);

  if (lookupValue.length === 0) {
    throw new Error("Creator name is required.");
  }

  const exactUsernameMatches = args.identities.filter(
    (identity) => normalizeLookupValue(identity.username ?? "") === lookupValue,
  );

  if (exactUsernameMatches.length > 0) {
    return {
      identities: exactUsernameMatches,
      warnings:
        exactUsernameMatches.length > 1
          ? [
              `Multiple TikTok identities matched @${lookupValue}. Using all exact username matches.`,
            ]
          : [],
    };
  }

  const exactProfileMatches = args.identities.filter((identity) =>
    [identity.displayName, identity.nickname].some(
      (value) => normalizeLookupValue(value ?? "") === lookupValue,
    ),
  );

  if (exactProfileMatches.length > 0) {
    return {
      identities: exactProfileMatches,
      warnings:
        exactProfileMatches.length > 1
          ? [
              `Multiple TikTok identities matched "${args.creatorName}". Using all exact profile-name matches.`,
            ]
          : [],
    };
  }

  const fuzzyMatches = args.identities.filter((identity) =>
    [identity.username, identity.displayName, identity.nickname].some((value) => {
      const normalized = normalizeLookupValue(value ?? "");
      return normalized.length > 0 && normalized.includes(lookupValue);
    }),
  );

  if (fuzzyMatches.length === 1) {
    return {
      identities: fuzzyMatches,
      warnings: [
        `Resolved "${args.creatorName}" using a fuzzy TikTok identity match.`,
      ],
    };
  }

  if (fuzzyMatches.length === 0) {
    throw new Error(
      `No TikTok identity matched "${args.creatorName}" for this advertiser. Reconnect TikTok or provide Spark item IDs manually.`,
    );
  }

  throw new Error(
    `Multiple TikTok identities matched "${args.creatorName}". Try the exact @handle or provide Spark item IDs manually.`,
  );
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
              "TikTok only returned ad metadata for some matched rows, so a few cards may still show raw ad IDs.",
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
              `Resolved exact post info for ${resolvedPostsByItemId.size} of ${candidateItemIds.length} known Spark item IDs. TikTok hid the rest, so the remaining matches use ad names and Singular creative metadata when available.`,
            ]
          : []),
    ]),
  };
}

function filterCreatorAds(args: {
  creatorName: string;
  identities: TikTokIdentityRecord[];
  ads: TikTokAdRecord[];
}) {
  const warnings: string[] = [];
  const identityIdSet = new Set(args.identities.map((identity) => identity.identityId));
  const matchedByIdentity = args.ads.filter(
    (ad) => ad.identityId !== null && identityIdSet.has(ad.identityId),
  );

  if (matchedByIdentity.length > 0) {
    return {
      ads: matchedByIdentity,
      warnings,
    };
  }

  const lookupValue = normalizeLookupValue(args.creatorName);
  const matchedByDisplayName = args.ads.filter(
    (ad) =>
      ad.displayName !== null &&
      normalizeLookupValue(ad.displayName) === lookupValue &&
      Boolean(ad.tiktokItemId || ad.identityType),
  );

  if (matchedByDisplayName.length > 0) {
    warnings.push(
      "Matched ads by creative display name because TikTok did not expose identity_id on the returned ad records.",
    );

    return {
      ads: matchedByDisplayName,
      warnings,
    };
  }

  return {
    ads: [],
    warnings,
  };
}

export async function getPaidViewsForSparkItems(args: {
  creatorLabel: string;
  advertiserId: string;
  accessToken: string;
  itemIds: string | readonly string[];
  startDate: QueryDateInput;
  endDate: QueryDateInput;
  metric?: TikTokPaidViewMetric;
}): Promise<TikTokSparkItemPaidViewsResult> {
  const { advertiserId, accessToken } = validateCredentials(args);
  const itemIds = normalizeSparkItemIds(args.itemIds);

  if (itemIds.length === 0) {
    throw new Error("At least one Spark item ID is required.");
  }

  const startDate = parseDateInput(args.startDate, "start date");
  const endDate = parseDateInput(args.endDate, "end date");

  if (endDate < startDate) {
    throw new Error("End date must be on or after start date.");
  }

  const metric = args.metric ?? "impressions";
  const report = await fetchPaidReportRows({
    advertiserId,
    accessToken,
    startDate: toDateOnlyString(startDate),
    endDate: toDateOnlyString(endDate),
    metric,
    filterFieldName: "item_id",
    filterValues: itemIds,
  });
  const normalizedRows = report.rows.map((row) =>
    normalizeReportRow(row, report.apiMetricName),
  );
  const itemIdSet = new Set(itemIds);
  const rowsIncludeItemIds = normalizedRows.some((row) => row.itemId !== null);
  const scopedRows = rowsIncludeItemIds
    ? normalizedRows.filter((row) => row.itemId !== null && itemIdSet.has(row.itemId))
    : normalizedRows;
  const paidViews = scopedRows.reduce((total, row) => total + row.metricValue, 0);
  const matchedAdIds = uniqueNonEmptyStrings(scopedRows.map((row) => row.adId));
  const adMetadata = await fetchMatchedAdsByIdsBestEffort({
    advertiserId,
    accessToken,
    adIds: matchedAdIds,
  });
  const resolvedPosts = await fetchResolvedPostsForAds({
    advertiserId,
    accessToken,
    ads: adMetadata.ads,
    rows: scopedRows,
  });
  const singular = await getTikTokSingularOverlay({
    startDate: toDateOnlyString(startDate),
    endDate: toDateOnlyString(endDate),
  });
  const matchedSparkItemIds = uniqueNonEmptyStrings([
    ...itemIds,
    ...scopedRows.map((row) => row.itemId),
    ...adMetadata.ads.map((ad) => ad.tiktokItemId),
  ]);

  return {
    creatorLabel: args.creatorLabel.trim() || "Spark item set",
    advertiserId,
    metric,
    startDate: toDateOnlyString(startDate),
    endDate: toDateOnlyString(endDate),
    paidViews,
    matchedAds: buildMatchedAdSummaries({
      ads: adMetadata.ads,
      rows: scopedRows,
      resolvedPostsByItemId: resolvedPosts.resolvedPostsByItemId,
    }),
    matchedSparkItemIds,
    matchedAdIds,
    resolvedIdentities: [],
    discoveryMode: "manual_item_ids",
    rowCount: scopedRows.length,
    rows: scopedRows,
    singular,
    warnings: uniqueNonEmptyStrings(
      rowsIncludeItemIds
        ? [...report.warnings, ...adMetadata.warnings, ...resolvedPosts.warnings]
        : [
            ...report.warnings,
            ...adMetadata.warnings,
            ...resolvedPosts.warnings,
            "TikTok report rows did not include item_id, so the total depends entirely on TikTok's server-side filter.",
          ],
    ),
  };
}

export async function getPaidViewsForCreator(args: {
  creatorName: string;
  advertiserId: string;
  accessToken: string;
  startDate: QueryDateInput;
  endDate: QueryDateInput;
  metric?: TikTokPaidViewMetric;
}): Promise<TikTokSparkItemPaidViewsResult> {
  const { advertiserId, accessToken } = validateCredentials(args);
  const creatorName = args.creatorName.trim();

  if (creatorName.length === 0) {
    throw new Error("Creator name is required.");
  }

  const startDate = parseDateInput(args.startDate, "start date");
  const endDate = parseDateInput(args.endDate, "end date");

  if (endDate < startDate) {
    throw new Error("End date must be on or after start date.");
  }

  const metric = args.metric ?? "impressions";
  const identities = await fetchAdvertiserIdentities({
    advertiserId,
    accessToken,
  });
  const identityResolution = resolveCreatorIdentities({
    creatorName,
    identities,
  });
  const advertiserAds = await fetchAdvertiserAds({
    advertiserId,
    accessToken,
  });
  const matchedAds = filterCreatorAds({
    creatorName,
    identities: identityResolution.identities,
    ads: advertiserAds.ads,
  });
  const adIds = uniqueNonEmptyStrings(matchedAds.ads.map((ad) => ad.adId));
  const discoveredItemIds = uniqueNonEmptyStrings(
    matchedAds.ads.map((ad) => ad.tiktokItemId),
  );
  const canServerFilterByItemId =
    matchedAds.ads.length > 0 && matchedAds.ads.every((ad) => Boolean(ad.tiktokItemId));

  if (adIds.length === 0) {
    return {
      creatorLabel: creatorName,
      advertiserId,
      metric,
      startDate: toDateOnlyString(startDate),
      endDate: toDateOnlyString(endDate),
      paidViews: 0,
      matchedAds: buildMatchedAdSummaries({
        ads: matchedAds.ads,
      }),
      matchedSparkItemIds: discoveredItemIds,
      matchedAdIds: [],
      resolvedIdentities: identityResolution.identities.map(formatIdentityLabel),
      discoveryMode: "creator_discovery",
      rowCount: 0,
      rows: [],
      singular: getDefaultTikTokSingularOverlay(),
      warnings: [
        ...identityResolution.warnings,
        ...advertiserAds.warnings,
        ...matchedAds.warnings,
        `No existing Spark ads were found for "${creatorName}" under this advertiser.`,
      ],
    };
  }

  const report = await fetchPaidReportRows({
    advertiserId,
    accessToken,
    startDate: toDateOnlyString(startDate),
    endDate: toDateOnlyString(endDate),
    metric,
    ...(canServerFilterByItemId
      ? {
          filterFieldName: "item_id" as const,
          filterValues: discoveredItemIds,
        }
      : {}),
  });
  const normalizedRows = report.rows.map((row) =>
    normalizeReportRow(row, report.apiMetricName),
  );
  const adIdSet = new Set(adIds);
  const itemIdSet = new Set(discoveredItemIds);
  const rowsIncludeAdIds = normalizedRows.some((row) => row.adId !== null);
  const rowsIncludeItemIds = normalizedRows.some((row) => row.itemId !== null);
  const scopedRows = rowsIncludeAdIds
    ? normalizedRows.filter((row) => row.adId !== null && adIdSet.has(row.adId))
    : canServerFilterByItemId && rowsIncludeItemIds
      ? normalizedRows.filter((row) => row.itemId !== null && itemIdSet.has(row.itemId))
      : normalizedRows;
  const paidViews = scopedRows.reduce((total, row) => total + row.metricValue, 0);
  const matchedSparkItemIds = uniqueNonEmptyStrings([
    ...discoveredItemIds,
    ...scopedRows.map((row) => row.itemId),
  ]);
  const resolvedPosts = await fetchResolvedPostsForAds({
    advertiserId,
    accessToken,
    ads: matchedAds.ads,
    rows: scopedRows,
  });
  const singular = await getTikTokSingularOverlay({
    startDate: toDateOnlyString(startDate),
    endDate: toDateOnlyString(endDate),
  });

  return {
    creatorLabel: creatorName,
    advertiserId,
    metric,
    startDate: toDateOnlyString(startDate),
    endDate: toDateOnlyString(endDate),
    paidViews,
    matchedAds: buildMatchedAdSummaries({
      ads: matchedAds.ads,
      rows: scopedRows,
      resolvedPostsByItemId: resolvedPosts.resolvedPostsByItemId,
    }),
    matchedSparkItemIds,
    matchedAdIds: adIds,
    resolvedIdentities: identityResolution.identities.map(formatIdentityLabel),
    discoveryMode: "creator_discovery",
    rowCount: scopedRows.length,
    rows: scopedRows,
    singular,
    warnings: uniqueNonEmptyStrings([
      ...identityResolution.warnings,
      ...advertiserAds.warnings,
      ...matchedAds.warnings,
      ...resolvedPosts.warnings,
      ...(!canServerFilterByItemId
        ? [
            "TikTok reporting does not support filtering by ad_id, so this lookup scanned advertiser rows for the date window and scoped them locally to the matched ads.",
          ]
        : []),
      ...report.warnings,
      ...(matchedSparkItemIds.length === 0
        ? [
            "TikTok did not expose Spark item IDs for the matched ads, but the totals were still scoped by ad_id.",
          ]
        : []),
    ]),
  };
}
