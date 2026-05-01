import { Platform, SparkAuthorizationStatus } from "@/lib/prisma-shim";

import { prisma } from "@/lib/db";
import { requireOrganizationMembership } from "@/server/auth/organizations";
import { getTikTokSingularOverlay } from "@/server/singular/reporting";

import {
  getAdProfitabilityReportForAdvertiser,
  resolvePaidAdGroupsForAdvertiser,
  type TikTokAdAttributionMatchMode,
  type TikTokAdProfitabilityReport,
} from "./ad-profitability";
import { requestTikTokBusinessApi } from "./client";

const MAX_REPORT_PAGES = 20;
const REPORT_PAGE_SIZE = 1_000;
const MAX_LIST_PAGES = 20;
const LIST_PAGE_SIZE = 100;
const PAID_REPORT_CACHE_TTL_MS = 5 * 60 * 1_000;
const AD_SPEND_REPORT_CACHE_TTL_MS = 5 * 60 * 1_000;

const paidViewMetricMap = {
  impressions: "impressions",
  videoPlayActions: "video_play_actions",
} as const;
const tiktokReportMetricMap = {
  ...paidViewMetricMap,
  spend: "spend",
} as const;
const basePaidReportDimensions = ["stat_time_day", "ad_id", "item_id"] as const;
const campaignPaidReportDimensions = [
  "stat_time_day",
  "campaign_id",
  "ad_id",
  "item_id",
] as const;
const adCampaignFieldCandidates: Array<readonly string[] | undefined> = [
  ["ad_id", "ad_name", "campaign_id", "tiktok_item_id", "item_id"],
  ["ad_id", "campaign_id", "tiktok_item_id"],
  ["ad_id", "campaign_id"],
  undefined,
] as const;
const campaignFieldCandidates: Array<readonly string[] | undefined> = [
  ["campaign_id", "campaign_name"],
  ["campaign_id"],
  undefined,
] as const;

export type TikTokPaidViewMetric = keyof typeof paidViewMetricMap;
type TikTokReportMetric = keyof typeof tiktokReportMetricMap;

type QueryDateInput = Date | string;

type GetPaidViewsForCreatorArgs = {
  organizationSlug: string;
  creatorId: string;
  startDate: QueryDateInput;
  endDate: QueryDateInput;
  metric?: TikTokPaidViewMetric;
};

type GetPaidViewsForCreatorByNameArgs = {
  organizationSlug: string;
  creatorName: string;
  startDate: QueryDateInput;
  endDate: QueryDateInput;
  metric?: TikTokPaidViewMetric;
};

type CreatorLookupRecord = {
  id: string;
  displayName: string;
  platformAccounts: Array<{
    platform: Platform;
    handle: string;
  }>;
};

type TikTokIntegratedReportRow = Record<string, unknown> & {
  dimensions?: Record<string, unknown>;
  metrics?: Record<string, unknown>;
};

type TikTokIntegratedReportData = {
  list?: TikTokIntegratedReportRow[];
  page_info?: Record<string, unknown>;
  total_metrics?: Record<string, unknown>;
};

type TikTokListData = Record<string, unknown> & {
  list?: Record<string, unknown>[];
  page_info?: Record<string, unknown>;
};

type TikTokPaidViewsRow = {
  campaignId?: string | null;
  campaignName?: string | null;
  adId: string | null;
  itemId: string | null;
  statDate: string | null;
  metricValue: number;
  raw: Record<string, unknown>;
};

type TikTokAdCampaignMetadata = {
  adId: string;
  campaignId: string | null;
  tiktokItemId: string | null;
  adName: string | null;
};

type TikTokCampaignMetadata = {
  campaignId: string;
  campaignName: string | null;
};

export type TikTokCreatorPaidViewsResult = {
  creator: {
    id: string;
    displayName: string;
    tiktokHandle: string | null;
  };
  advertiserId: string;
  metric: TikTokPaidViewMetric;
  startDate: string;
  endDate: string;
  paidViews: number;
  matchedSparkItemIds: string[];
  rowCount: number;
  rows: TikTokPaidViewsRow[];
  warnings: string[];
};

export type TikTokVideoPaidStatus = "yes" | "no" | "unsupported" | "unknown";
export type TikTokVideoPaidStatusReason =
  | "exact_post_match"
  | "no_exact_post_match"
  | "no_paid_rows_in_window"
  | "ambiguous_post_mapping"
  | "unresolved_post_mapping"
  | "non_post_backed_delivery"
  | "pending_external_match"
  | "missing_tiktok_connection";

export type TikTokVideoPaidAttributionSource =
  | "report_item_id"
  | "tiktok_ad_metadata"
  | "singular_creative_id"
  | "singular_tiktok_post_id"
  | "singular_post_url";

export type TikTokSourceVideoPaidViewsRow = {
  sourceVideoId: string;
  matchedSparkItemIds: string[];
  paidViews: number;
  paidStatus: TikTokVideoPaidStatus;
  paidStatusReason: TikTokVideoPaidStatusReason;
  matchedReportRowCount: number;
  matchedAdIds: string[];
  unresolvedPostBackedAdIds: string[];
  unresolvedNonPostBackedAdIds: string[];
  unresolvedPostBackedGroupCount: number;
  unresolvedNonPostBackedGroupCount: number;
  attributionSources: TikTokVideoPaidAttributionSource[];
};

export type TikTokSourceVideoPaidViewsResult = {
  advertiserId: string | null;
  metric: TikTokPaidViewMetric;
  startDate: string;
  endDate: string;
  unresolvedPostBackedGroupCount: number;
  unresolvedNonPostBackedGroupCount: number;
  rows: TikTokSourceVideoPaidViewsRow[];
  warnings: string[];
};

export type TikTokSourceVideoPaidViewsTimelineRow = {
  sourceVideoId: string;
  statDate: string;
  paidViews: number;
  matchedAdIds: string[];
  attributionSources: TikTokVideoPaidAttributionSource[];
};

export type TikTokSourceVideoPaidViewsTimelineResult =
  TikTokSourceVideoPaidViewsResult & {
    timelineRows: TikTokSourceVideoPaidViewsTimelineRow[];
  };

export type TikTokCampaignVideoMatchSource =
  | "report_item_id"
  | "ad_metadata_item_id"
  | "report_campaign_id"
  | "ad_metadata_campaign_id";

export type TikTokCampaignVideoViewRow = {
  sourceVideoId: string;
  tiktokCampaignId: string | null;
  tiktokCampaignName: string | null;
  paidViews: number;
  reportRowCount: number;
  matchedAdIds: string[];
  statDates: string[];
  matchSources: TikTokCampaignVideoMatchSource[];
};

export type TikTokCampaignVideoViewsResult = {
  advertiserId: string | null;
  metric: TikTokPaidViewMetric;
  startDate: string;
  endDate: string;
  totalPaidViews: number;
  reportRowCount: number;
  rows: TikTokCampaignVideoViewRow[];
  warnings: string[];
};

export type TikTokAdSpendRow = {
  key: string;
  adId: string | null;
  itemId: string | null;
  itemIds: string[];
  statDate: string | null;
  spend: number;
  matchSource: "report_item_id" | "tiktok_ad_metadata" | "unmatched";
  resolvedPosts: Array<{
    itemId: string;
    title: string | null;
    coverUrl: string | null;
    shareUrl: string | null;
    createTime: string | null;
  }>;
};

export type TikTokAdSpendReport = {
  advertiserId: string | null;
  startDate: string;
  endDate: string;
  totalSpend: number;
  rowCount: number;
  rows: TikTokAdSpendRow[];
  warnings: string[];
};

type PaidReportFetchResult = {
  rows: TikTokIntegratedReportRow[];
  apiMetricName: (typeof tiktokReportMetricMap)[TikTokReportMetric];
  warnings: string[];
};

type TimedCacheValue<T> = {
  expiresAt: number;
  value: T;
};

const paidReportCache = new Map<string, TimedCacheValue<PaidReportFetchResult>>();
const pendingPaidReportCache = new Map<string, Promise<PaidReportFetchResult>>();
const adSpendReportCache = new Map<string, TimedCacheValue<TikTokAdSpendReport>>();
const pendingAdSpendReportCache = new Map<string, Promise<TikTokAdSpendReport>>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeLookupValue(value: string) {
  return value.trim().toLowerCase().replace(/^@/, "");
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

function addUtcDays(value: Date, days: number) {
  const nextValue = new Date(value);
  nextValue.setUTCDate(nextValue.getUTCDate() + days);
  return nextValue;
}

function getPaidReportCacheKey(args: {
  advertiserId: string;
  startDate: string;
  endDate: string;
  metric: TikTokReportMetric;
  dimensions?: readonly string[];
}) {
  return [
    args.advertiserId,
    args.metric,
    (args.dimensions ?? basePaidReportDimensions).join(","),
    args.startDate,
    args.endDate,
  ].join("::");
}

function readPaidReportCache(key: string) {
  const cached = paidReportCache.get(key);

  if (!cached) {
    return null;
  }

  if (cached.expiresAt <= Date.now()) {
    paidReportCache.delete(key);
    return null;
  }

  return cached.value;
}

function getAdSpendReportCacheKey(args: {
  organizationId: string;
  advertiserId: string;
  startDate: string;
  endDate: string;
  metadataRowLimit: number;
}) {
  return [
    args.organizationId,
    args.advertiserId,
    args.startDate,
    args.endDate,
    args.metadataRowLimit,
  ].join("::");
}

function readAdSpendReportCache(key: string) {
  const cached = adSpendReportCache.get(key);

  if (!cached) {
    return null;
  }

  if (cached.expiresAt <= Date.now()) {
    adSpendReportCache.delete(key);
    return null;
  }

  return cached.value;
}

function getPrimaryTikTokHandle(creator: CreatorLookupRecord) {
  return (
    creator.platformAccounts.find((account) => account.platform === Platform.TIKTOK)?.handle ??
    null
  );
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

function getReportRows(payload: TikTokIntegratedReportData) {
  if (!Array.isArray(payload.list)) {
    return [];
  }

  return payload.list.filter(isRecord);
}

function getTotalPages(
  payload: Pick<TikTokIntegratedReportData, "page_info">,
  currentRows: number,
  pageSize = REPORT_PAGE_SIZE,
  maxPages = MAX_REPORT_PAGES,
) {
  const pageInfo = isRecord(payload.page_info) ? payload.page_info : null;
  const totalPages = getFirstNumber([pageInfo], ["total_page", "total_pages"]);

  if (totalPages > 0) {
    return Math.max(1, Math.trunc(totalPages));
  }

  return currentRows < pageSize ? 1 : maxPages;
}

function normalizeReportRow(row: TikTokIntegratedReportRow, apiMetricName: string): TikTokPaidViewsRow {
  const dimensions = isRecord(row.dimensions) ? row.dimensions : null;
  const metrics = isRecord(row.metrics) ? row.metrics : null;

  return {
    campaignId: getFirstString([dimensions, row], ["campaign_id", "campaignId"]),
    campaignName: getFirstString([dimensions, row], ["campaign_name", "campaignName"]),
    adId: getFirstString([dimensions, row], ["ad_id", "adId"]),
    itemId: getFirstString([dimensions, row], ["item_id", "itemId"]),
    statDate: getFirstString([dimensions, row], ["stat_time_day", "statTimeDay"]),
    metricValue: getFirstNumber([metrics, row], [apiMetricName]),
    raw: row,
  };
}

function normalizeAdCampaignMetadata(
  record: Record<string, unknown>,
): TikTokAdCampaignMetadata | null {
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
    campaignId: getFirstString(candidates, ["campaign_id", "campaignId"]),
    tiktokItemId: getFirstString(candidates, [
      "tiktok_item_id",
      "tiktokItemId",
      "item_id",
      "itemId",
    ]),
    adName: getFirstString(candidates, ["ad_name", "adName"]),
  };
}

function normalizeCampaignMetadata(
  record: Record<string, unknown>,
): TikTokCampaignMetadata | null {
  const campaignId = getFirstString([record], ["campaign_id", "campaignId"]);

  if (!campaignId) {
    return null;
  }

  return {
    campaignId,
    campaignName: getFirstString([record], ["campaign_name", "campaignName", "name"]),
  };
}

function uniqueNonEmptyStrings(values: Array<string | null | undefined>) {
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

function addSetMapEntry<ValueType>(
  map: Map<string, Set<ValueType>>,
  key: string,
  value: ValueType,
) {
  const existing = map.get(key);

  if (existing) {
    existing.add(value);
    return;
  }

  map.set(key, new Set([value]));
}

function mergeSetMaps<ValueType>(
  target: Map<string, Set<ValueType>>,
  source: Map<string, Set<ValueType>>,
) {
  for (const [key, values] of source.entries()) {
    for (const value of values) {
      addSetMapEntry(target, key, value);
    }
  }
}

function buildItemDateKey(itemId: string, statDate: string) {
  return `${itemId}::${statDate}`;
}

function parseItemDateKey(key: string) {
  const separatorIndex = key.lastIndexOf("::");

  if (separatorIndex < 0) {
    return null;
  }

  const itemId = key.slice(0, separatorIndex);
  const statDate = key.slice(separatorIndex + 2);

  if (itemId.length === 0 || statDate.length === 0) {
    return null;
  }

  return {
    itemId,
    statDate,
  };
}

function addPaidViewsByItemDate(
  map: Map<string, number>,
  itemId: string,
  statDate: string | null,
  metricValue: number,
) {
  if (!statDate || !Number.isFinite(metricValue) || metricValue <= 0) {
    return;
  }

  const key = buildItemDateKey(itemId, statDate);
  map.set(key, (map.get(key) ?? 0) + metricValue);
}

function getAdCandidateNameKeys(group: {
  adName: string | null;
  displayName: string | null;
  resolvedPosts: Array<{
    title: string | null;
  }>;
}) {
  return uniqueNonEmptyStrings([
    group.adName,
    group.displayName,
    ...group.resolvedPosts.map((post) => post.title),
  ])
    .filter(isMeaningfulMatchLabel)
    .map((value) => normalizeMatchText(value))
    .filter((value) => value.length > 0);
}

type ExactItemIdFallbackResult = {
  paidViewsByItemId: Map<string, number>;
  paidViewsByItemDate: Map<string, number>;
  rowCountByItemId: Map<string, number>;
  ambiguousItemIds: Set<string>;
  matchedAdIdsByItemId: Map<string, Set<string>>;
  attributionSourcesByItemId: Map<string, Set<TikTokVideoPaidAttributionSource>>;
  resolvedGroupIds: Set<string>;
  ambiguousGroupIds: Set<string>;
  unresolvedPostBackedGroupIds: Set<string>;
  unresolvedNonPostBackedGroupIds: Set<string>;
  unresolvedUnknownGroupCount: number;
  unresolvedNonPostBackedGroupCount: number;
  pending: boolean;
  warnings: string[];
};

function getEmptyExactItemIdFallbackResult(): ExactItemIdFallbackResult {
  return {
    paidViewsByItemId: new Map(),
    paidViewsByItemDate: new Map(),
    rowCountByItemId: new Map(),
    ambiguousItemIds: new Set(),
    matchedAdIdsByItemId: new Map(),
    attributionSourcesByItemId: new Map(),
    resolvedGroupIds: new Set(),
    ambiguousGroupIds: new Set(),
    unresolvedPostBackedGroupIds: new Set(),
    unresolvedNonPostBackedGroupIds: new Set(),
    unresolvedUnknownGroupCount: 0,
    unresolvedNonPostBackedGroupCount: 0,
    pending: false,
    warnings: [],
  };
}

async function resolveExactItemIdsFromSingular(args: {
  itemIds: string[];
  startDate: string;
  endDate: string;
  groups: Array<{
    adId: string;
    adName: string | null;
    displayName: string | null;
    itemIds: string[];
    totalValue: number;
    rowCount: number;
    rows: TikTokPaidViewsRow[];
    resolvedPosts: Array<{
      title: string | null;
    }>;
  }>;
}): Promise<ExactItemIdFallbackResult> {
  const unresolvedGroups = args.groups.filter((group) => group.itemIds.length === 0);

  if (unresolvedGroups.length === 0) {
    return getEmptyExactItemIdFallbackResult();
  }

  const singular = await getTikTokSingularOverlay({
    startDate: args.startDate,
    endDate: args.endDate,
  });

  if (!singular.configured) {
    return {
      ...getEmptyExactItemIdFallbackResult(),
      warnings: [
        ...singular.warnings,
        "Singular is not configured, so unresolved TikTok ad rows could not get a second-pass creative match.",
      ],
    };
  }

  if (singular.isPending) {
    return {
      ...getEmptyExactItemIdFallbackResult(),
      pending: true,
      warnings: singular.warnings,
    };
  }

  if (singular.rows.length === 0) {
    return {
      ...getEmptyExactItemIdFallbackResult(),
      warnings: uniqueNonEmptyStrings([
        ...singular.warnings,
        "Singular returned no TikTok creative rows for this date window, so unresolved TikTok ad rows stayed unknown.",
      ]),
    };
  }

  const itemIdSet = new Set(args.itemIds);
  const rowsByCreativeId = new Map<string, typeof singular.rows>();
  const groupIdsByNameKey = new Map<string, Set<string>>();
  const rowsByNameKey = new Map<string, typeof singular.rows>();

  for (const group of unresolvedGroups) {
    for (const nameKey of getAdCandidateNameKeys(group)) {
      addSetMapEntry(groupIdsByNameKey, nameKey, group.adId);
    }
  }

  for (const row of singular.rows) {
    const creativeId = row.creativeId?.trim() ?? "";

    if (creativeId.length > 0) {
      const existingRows = rowsByCreativeId.get(creativeId);

      if (existingRows) {
        existingRows.push(row);
      } else {
        rowsByCreativeId.set(creativeId, [row]);
      }
    }

    const creativeNameKey = isMeaningfulMatchLabel(row.creativeName)
      ? normalizeMatchText(row.creativeName)
      : "";

    if (creativeNameKey.length === 0) {
      continue;
    }

    const existingRows = rowsByNameKey.get(creativeNameKey);

    if (existingRows) {
      existingRows.push(row);
      continue;
    }

    rowsByNameKey.set(creativeNameKey, [row]);
  }

  const paidViewsByItemId = new Map<string, number>();
  const paidViewsByItemDate = new Map<string, number>();
  const rowCountByItemId = new Map<string, number>();
  const ambiguousItemIds = new Set<string>();
  const matchedAdIdsByItemId = new Map<string, Set<string>>();
  const attributionSourcesByItemId = new Map<
    string,
    Set<TikTokVideoPaidAttributionSource>
  >();
  const resolvedGroupIds = new Set<string>();
  const ambiguousGroupIds = new Set<string>();
  let groupsMatchedBySingular = 0;
  let groupsResolvedByCreativeId = 0;
  let groupsResolvedByTikTokPostId = 0;
  let groupsResolvedByPostUrl = 0;
  let groupsWithoutExactVideoSignal = 0;
  let groupsMatchedByAdId = 0;
  let ambiguousGroups = 0;

  for (const group of unresolvedGroups) {
    const matchedRows = new Map<string, (typeof singular.rows)[number]>();

    for (const row of rowsByCreativeId.get(group.adId) ?? []) {
      matchedRows.set(row.rowKey, row);
    }

    for (const nameKey of getAdCandidateNameKeys(group)) {
      if ((groupIdsByNameKey.get(nameKey)?.size ?? 0) !== 1) {
        continue;
      }

      for (const row of rowsByNameKey.get(nameKey) ?? []) {
        matchedRows.set(row.rowKey, row);
      }
    }

    if (matchedRows.size === 0) {
      continue;
    }

    groupsMatchedBySingular += 1;
    if ((rowsByCreativeId.get(group.adId)?.length ?? 0) > 0) {
      groupsMatchedByAdId += 1;
    }
    const sourcesByItemId = new Map<string, Set<TikTokVideoPaidAttributionSource>>();

    for (const row of matchedRows.values()) {
      const creativeId = row.creativeId?.trim() ?? "";

      if (creativeId.length > 0 && itemIdSet.has(creativeId)) {
        addSetMapEntry(sourcesByItemId, creativeId, "singular_creative_id");
      }

      const tiktokPostId = row.tiktokPostId?.trim() ?? "";

      if (tiktokPostId.length > 0 && itemIdSet.has(tiktokPostId)) {
        addSetMapEntry(sourcesByItemId, tiktokPostId, "singular_tiktok_post_id");
      }

      const videoIdFromUrl = extractTikTokVideoIdFromUrl(row.creativeUrl);

      if (videoIdFromUrl && itemIdSet.has(videoIdFromUrl)) {
        addSetMapEntry(sourcesByItemId, videoIdFromUrl, "singular_post_url");
      }
    }

    if (sourcesByItemId.size === 0) {
      groupsWithoutExactVideoSignal += 1;
      continue;
    }

    if (sourcesByItemId.size > 1) {
      ambiguousGroups += 1;
      ambiguousGroupIds.add(group.adId);

      for (const itemId of sourcesByItemId.keys()) {
        ambiguousItemIds.add(itemId);
      }

      continue;
    }

    const [matchedEntry] = [...sourcesByItemId.entries()];

    if (!matchedEntry) {
      continue;
    }

    const [itemId, sources] = matchedEntry;
    resolvedGroupIds.add(group.adId);
    paidViewsByItemId.set(itemId, (paidViewsByItemId.get(itemId) ?? 0) + group.totalValue);
    for (const row of group.rows) {
      addPaidViewsByItemDate(
        paidViewsByItemDate,
        itemId,
        row.statDate,
        row.metricValue,
      );
    }
    rowCountByItemId.set(itemId, (rowCountByItemId.get(itemId) ?? 0) + group.rowCount);
    const matchedByPostUrl = sources.has("singular_post_url");
    const matchedByTikTokPostId = sources.has("singular_tiktok_post_id");
    const matchedByCreativeId = sources.has("singular_creative_id");

    for (const source of sources) {
      addSetMapEntry(attributionSourcesByItemId, itemId, source);
    }

    if (matchedByPostUrl) {
      groupsResolvedByPostUrl += 1;
    }

    if (matchedByTikTokPostId) {
      groupsResolvedByTikTokPostId += 1;
    }

    if (matchedByCreativeId) {
      groupsResolvedByCreativeId += 1;
    }

    if (group.adId !== "Unknown") {
      addSetMapEntry(matchedAdIdsByItemId, itemId, group.adId);
    }
  }

  return {
    paidViewsByItemId,
    paidViewsByItemDate,
    rowCountByItemId,
    ambiguousItemIds,
    matchedAdIdsByItemId,
    attributionSourcesByItemId,
    resolvedGroupIds,
    ambiguousGroupIds,
    unresolvedPostBackedGroupIds: new Set(),
    unresolvedNonPostBackedGroupIds: new Set(),
    unresolvedUnknownGroupCount: 0,
    unresolvedNonPostBackedGroupCount: 0,
    pending: false,
    warnings: uniqueNonEmptyStrings([
      ...singular.warnings,
      ...(groupsResolvedByPostUrl > 0
        ? [
            `Singular matched ${groupsResolvedByPostUrl} unresolved TikTok ad group${groupsResolvedByPostUrl === 1 ? "" : "s"} to exact TikTok post URLs.`,
          ]
        : []),
      ...(groupsResolvedByTikTokPostId > 0
        ? [
            `Singular matched ${groupsResolvedByTikTokPostId} unresolved TikTok ad group${groupsResolvedByTikTokPostId === 1 ? "" : "s"} to exact TikTok post IDs.`,
          ]
        : []),
      ...(groupsResolvedByCreativeId > 0
        ? [
            `Singular matched ${groupsResolvedByCreativeId} unresolved TikTok ad group${groupsResolvedByCreativeId === 1 ? "" : "s"} to exact creative IDs.`,
          ]
        : []),
      ...(groupsWithoutExactVideoSignal > 0
        ? [
            `Singular matched ${groupsWithoutExactVideoSignal} unresolved TikTok ad group${groupsWithoutExactVideoSignal === 1 ? "" : "s"} by name, but those creative rows still lacked an exact TikTok post ID, post URL, or creative ID for the selected videos.`,
          ]
        : []),
      ...(ambiguousGroups > 0
        ? [
            `Singular pointed ${ambiguousGroups} unresolved TikTok ad group${ambiguousGroups === 1 ? "" : "s"} at multiple selected videos. Those rows were excluded from per-video tallies.`,
          ]
        : []),
      ...(groupsMatchedBySingular === 0
        ? [
            "Singular could not line up the unresolved TikTok ad groups with creative rows in this date window.",
          ]
        : []),
      ...(groupsMatchedByAdId > 0
        ? [
            `Singular lined up ${groupsMatchedByAdId} unresolved TikTok ad group${groupsMatchedByAdId === 1 ? "" : "s"} by TikTok ad ID.`,
          ]
        : []),
    ]),
  };
}

async function resolveExactItemIdsFromAdMetadata(args: {
  advertiserId: string;
  accessToken: string;
  itemIds: string[];
  startDate: string;
  endDate: string;
  rows: TikTokPaidViewsRow[];
}): Promise<ExactItemIdFallbackResult> {
  const rowsNeedingResolution = args.rows.filter((row) => row.adId && !row.itemId);

  if (rowsNeedingResolution.length === 0) {
    return getEmptyExactItemIdFallbackResult();
  }

  const itemIdSet = new Set(args.itemIds);
  const fallback = await resolvePaidAdGroupsForAdvertiser({
    advertiserId: args.advertiserId,
    accessToken: args.accessToken,
    rows: rowsNeedingResolution,
    targetItemIds: args.itemIds,
  });
  const paidViewsByItemId = new Map<string, number>();
  const paidViewsByItemDate = new Map<string, number>();
  const rowCountByItemId = new Map<string, number>();
  const ambiguousItemIds = new Set<string>();
  const matchedAdIdsByItemId = new Map<string, Set<string>>();
  const attributionSourcesByItemId = new Map<
    string,
    Set<TikTokVideoPaidAttributionSource>
  >();
  const resolvedGroupIds = new Set<string>();
  const ambiguousGroupIds = new Set<string>();
  const unresolvedPostBackedGroupIds = new Set<string>();
  const unresolvedNonPostBackedGroupIds = new Set<string>();
  let unresolvedUnknownGroupCount = 0;
  let unresolvedNonPostBackedGroupCount = 0;
  let adGroupsWithoutResolvedPostId = 0;
  let ambiguousAdGroups = 0;

  for (const group of fallback.groups) {
    if (group.itemIds.length === 0) {
      adGroupsWithoutResolvedPostId += 1;

      if (group.postBackingStatus === "non_post_backed") {
        if (group.adId !== "Unknown") {
          unresolvedNonPostBackedGroupIds.add(group.adId);
        }
        unresolvedNonPostBackedGroupCount += 1;
      } else {
        if (group.adId !== "Unknown") {
          unresolvedPostBackedGroupIds.add(group.adId);
        }
        unresolvedUnknownGroupCount += 1;
      }

      continue;
    }

    const matchingItemIds = group.itemIds.filter((itemId) => itemIdSet.has(itemId));

    if (matchingItemIds.length === 0) {
      continue;
    }

    if (group.itemIds.length > 1) {
      ambiguousAdGroups += 1;
      ambiguousGroupIds.add(group.adId);

      for (const itemId of matchingItemIds) {
        ambiguousItemIds.add(itemId);
      }

      continue;
    }

    const [itemId] = matchingItemIds;

    if (!itemId) {
      continue;
    }

    paidViewsByItemId.set(
      itemId,
      (paidViewsByItemId.get(itemId) ?? 0) + group.totalValue,
    );
    for (const row of group.rows) {
      addPaidViewsByItemDate(
        paidViewsByItemDate,
        itemId,
        row.statDate,
        row.metricValue,
      );
    }
    rowCountByItemId.set(
      itemId,
      (rowCountByItemId.get(itemId) ?? 0) + group.rowCount,
    );

    addSetMapEntry(attributionSourcesByItemId, itemId, "tiktok_ad_metadata");

    if (group.adId !== "Unknown") {
      addSetMapEntry(matchedAdIdsByItemId, itemId, group.adId);
    }

    resolvedGroupIds.add(group.adId);
  }

  const singularFallback = await resolveExactItemIdsFromSingular({
    itemIds: args.itemIds,
    startDate: args.startDate,
    endDate: args.endDate,
    groups: fallback.groups,
  });

  for (const [itemId, paidViews] of singularFallback.paidViewsByItemId.entries()) {
    paidViewsByItemId.set(itemId, (paidViewsByItemId.get(itemId) ?? 0) + paidViews);
  }

  for (const [itemDateKey, paidViews] of singularFallback.paidViewsByItemDate.entries()) {
    paidViewsByItemDate.set(itemDateKey, (paidViewsByItemDate.get(itemDateKey) ?? 0) + paidViews);
  }

  for (const [itemId, matchedRowCount] of singularFallback.rowCountByItemId.entries()) {
    rowCountByItemId.set(itemId, (rowCountByItemId.get(itemId) ?? 0) + matchedRowCount);
  }

  for (const itemId of singularFallback.ambiguousItemIds) {
    ambiguousItemIds.add(itemId);
  }

  mergeSetMaps(matchedAdIdsByItemId, singularFallback.matchedAdIdsByItemId);
  mergeSetMaps(attributionSourcesByItemId, singularFallback.attributionSourcesByItemId);

  for (const groupId of singularFallback.resolvedGroupIds) {
    resolvedGroupIds.add(groupId);
  }

  for (const groupId of singularFallback.ambiguousGroupIds) {
    ambiguousGroupIds.add(groupId);
  }

  for (const group of fallback.groups) {
    if (group.itemIds.length !== 0 || resolvedGroupIds.has(group.adId)) {
      continue;
    }

    if (ambiguousGroupIds.has(group.adId)) {
      unresolvedUnknownGroupCount += 1;
      continue;
    }

    if (group.postBackingStatus === "non_post_backed") {
      if (group.adId !== "Unknown") {
        unresolvedNonPostBackedGroupIds.add(group.adId);
      }
      unresolvedNonPostBackedGroupCount += 1;
      continue;
    }

    if (group.adId !== "Unknown") {
      unresolvedPostBackedGroupIds.add(group.adId);
    }
    unresolvedUnknownGroupCount += 1;
  }

  return {
    paidViewsByItemId,
    paidViewsByItemDate,
    rowCountByItemId,
    ambiguousItemIds,
    matchedAdIdsByItemId,
    attributionSourcesByItemId,
    resolvedGroupIds,
    ambiguousGroupIds,
    unresolvedPostBackedGroupIds,
    unresolvedNonPostBackedGroupIds,
    unresolvedUnknownGroupCount,
    unresolvedNonPostBackedGroupCount,
    pending: singularFallback.pending,
    warnings: uniqueNonEmptyStrings([
      ...fallback.warnings,
      ...singularFallback.warnings,
      ...(ambiguousAdGroups > 0
        ? [
            `TikTok mapped ${ambiguousAdGroups} ad group${ambiguousAdGroups === 1 ? "" : "s"} to multiple possible TikTok post IDs. Those rows were excluded from per-video tallies to avoid double-counting.`,
          ]
        : []),
      ...(adGroupsWithoutResolvedPostId > 0
        ? [
            `TikTok returned ${adGroupsWithoutResolvedPostId} ad group${adGroupsWithoutResolvedPostId === 1 ? "" : "s"} without a resolvable TikTok post ID. Those rows were excluded from per-video tallies.`,
          ]
        : []),
    ]),
  };
}

function isMissingOrgTikTokAccountError(error: unknown) {
  return (
    error instanceof Error &&
    /No TikTok advertiser account is configured/i.test(error.message)
  );
}

async function getOrgTikTokAccount(organizationId: string) {
  const activeAccount = await prisma.organizationTikTokAccount.findFirst({
    where: {
      organizationId,
      status: "ACTIVE",
    },
    orderBy: [{ updatedAt: "desc" }],
    select: {
      advertiserId: true,
      accessToken: true,
      status: true,
      lastValidatedAt: true,
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
      organizationId,
    },
    orderBy: [{ updatedAt: "desc" }],
    select: {
      advertiserId: true,
      accessToken: true,
      status: true,
      lastValidatedAt: true,
    },
  });

  if (!latestAccount) {
    throw new Error(
      "No TikTok advertiser account is configured for this organization. Add an advertiser ID and access token in Integrations first.",
    );
  }

  return {
    account: latestAccount,
    warnings: [
      `Using the latest TikTok account even though its status is ${latestAccount.status}.`,
    ],
  };
}

async function resolveCreatorById(args: {
  organizationId: string;
  creatorId: string;
}): Promise<CreatorLookupRecord> {
  const creator = await prisma.creator.findFirst({
    where: {
      id: args.creatorId,
      organizationId: args.organizationId,
    },
    select: {
      id: true,
      displayName: true,
      platformAccounts: {
        where: {
          platform: Platform.TIKTOK,
        },
        select: {
          platform: true,
          handle: true,
        },
        orderBy: [{ handle: "asc" }],
      },
    },
  });

  if (!creator) {
    throw new Error("Creator not found in this organization.");
  }

  return creator;
}

async function resolveCreatorByName(args: {
  organizationId: string;
  creatorName: string;
}): Promise<CreatorLookupRecord> {
  if (args.creatorName.trim().length === 0) {
    throw new Error("Creator name is required.");
  }

  const lookupValue = normalizeLookupValue(args.creatorName);
  const directMatches = await prisma.creator.findMany({
    where: {
      organizationId: args.organizationId,
      OR: [
        {
          displayName: {
            equals: args.creatorName.trim(),
            mode: "insensitive",
          },
        },
        {
          platformAccounts: {
            some: {
              platform: Platform.TIKTOK,
              handle: {
                equals: lookupValue,
                mode: "insensitive",
              },
            },
          },
        },
      ],
    },
    select: {
      id: true,
      displayName: true,
      platformAccounts: {
        where: {
          platform: Platform.TIKTOK,
        },
        select: {
          platform: true,
          handle: true,
        },
        orderBy: [{ handle: "asc" }],
      },
    },
    take: 10,
  });

  const exactDisplayMatches = directMatches.filter(
    (creator) => normalizeLookupValue(creator.displayName) === lookupValue,
  );

  if (exactDisplayMatches.length === 1) {
    return exactDisplayMatches[0];
  }

  const exactHandleMatches = directMatches.filter(
    (creator) => normalizeLookupValue(getPrimaryTikTokHandle(creator) ?? "") === lookupValue,
  );

  if (exactHandleMatches.length === 1) {
    return exactHandleMatches[0];
  }

  if (directMatches.length === 1) {
    return directMatches[0];
  }

  if (directMatches.length > 1) {
    throw new Error(
      `Multiple creators matched "${args.creatorName}". Use the creator ID or exact TikTok handle instead.`,
    );
  }

  const fuzzyMatches = await prisma.creator.findMany({
    where: {
      organizationId: args.organizationId,
      OR: [
        {
          displayName: {
            contains: args.creatorName.trim(),
            mode: "insensitive",
          },
        },
        {
          platformAccounts: {
            some: {
              platform: Platform.TIKTOK,
              handle: {
                contains: lookupValue,
                mode: "insensitive",
              },
            },
          },
        },
      ],
    },
    select: {
      id: true,
      displayName: true,
      platformAccounts: {
        where: {
          platform: Platform.TIKTOK,
        },
        select: {
          platform: true,
          handle: true,
        },
        orderBy: [{ handle: "asc" }],
      },
    },
    take: 10,
  });

  if (fuzzyMatches.length === 1) {
    return fuzzyMatches[0];
  }

  if (fuzzyMatches.length === 0) {
    throw new Error(`No creator matched "${args.creatorName}" in this organization.`);
  }

  throw new Error(
    `Multiple creators matched "${args.creatorName}". Use the creator ID or exact TikTok handle instead.`,
  );
}

async function getCreatorSparkItemIds(args: {
  organizationId: string;
  creatorId: string;
  advertiserId: string;
  startDate: Date;
  endDate: Date;
}) {
  const authorizations = await prisma.sparkAuthorization.findMany({
    where: {
      organizationId: args.organizationId,
      creatorId: args.creatorId,
      advertiserId: args.advertiserId,
      status: SparkAuthorizationStatus.AUTHORIZED,
      tiktokItemId: {
        not: null,
      },
      OR: [
        {
          authStartTime: null,
        },
        {
          authStartTime: {
            lte: args.endDate,
          },
        },
      ],
      AND: [
        {
          OR: [
            {
              authEndTime: null,
            },
            {
              authEndTime: {
                gte: args.startDate,
              },
            },
          ],
        },
      ],
    },
    select: {
      tiktokItemId: true,
    },
  });

  return uniqueNonEmptyStrings(authorizations.map((authorization) => authorization.tiktokItemId));
}

async function getCreatorSparkItemIdsBySourceVideo(args: {
  organizationId: string;
  creatorId: string;
  advertiserId: string;
  sourceVideoIds: string[];
  startDate: Date;
  endDate: Date;
}) {
  const sourceVideoIds = uniqueNonEmptyStrings(args.sourceVideoIds);

  if (sourceVideoIds.length === 0) {
    return new Map<string, string[]>();
  }

  const authorizations = await prisma.sparkAuthorization.findMany({
    where: {
      organizationId: args.organizationId,
      creatorId: args.creatorId,
      advertiserId: args.advertiserId,
      status: SparkAuthorizationStatus.AUTHORIZED,
      tiktokItemId: {
        in: sourceVideoIds,
      },
      OR: [
        {
          authStartTime: null,
        },
        {
          authStartTime: {
            lte: args.endDate,
          },
        },
      ],
      AND: [
        {
          OR: [
            {
              authEndTime: null,
            },
            {
              authEndTime: {
                gte: args.startDate,
              },
            },
          ],
        },
      ],
    },
    select: {
      tiktokItemId: true,
    },
  });

  const itemIdsBySourceVideoId = new Map<string, string[]>();

  for (const authorization of authorizations) {
    const itemId = authorization.tiktokItemId?.trim();

    if (!itemId) {
      continue;
    }

    const existingItemIds = itemIdsBySourceVideoId.get(itemId) ?? [];

    if (!existingItemIds.includes(itemId)) {
      itemIdsBySourceVideoId.set(itemId, [...existingItemIds, itemId]);
    }
  }

  return itemIdsBySourceVideoId;
}

async function fetchPaidReportRows(args: {
  advertiserId: string;
  accessToken: string;
  startDate: string;
  endDate: string;
  metric: TikTokReportMetric;
  dimensions?: readonly string[];
}) {
  const cacheKey = getPaidReportCacheKey(args);
  const cached = readPaidReportCache(cacheKey);

  if (cached) {
    return cached;
  }

  const pending = pendingPaidReportCache.get(cacheKey);

  if (pending) {
    return pending;
  }

  const requestPromise = (async () => {
    const apiMetricName = tiktokReportMetricMap[args.metric];
    const dimensions = args.dimensions ?? basePaidReportDimensions;
    const rows: TikTokIntegratedReportRow[] = [];
    const warnings: string[] = [];

    const startBoundary = parseDateInput(args.startDate, "start date");
    const endBoundary = parseDateInput(args.endDate, "end date");
    let windowStart = startBoundary;

    while (windowStart <= endBoundary) {
      const windowEnd =
        addUtcDays(windowStart, 29) < endBoundary
          ? addUtcDays(windowStart, 29)
          : endBoundary;
      let totalPages = 1;

      for (
        let page = 1;
        page <= totalPages && page <= MAX_REPORT_PAGES;
        page += 1
      ) {
        const payload = await requestTikTokBusinessApi<TikTokIntegratedReportData>({
          accessToken: args.accessToken,
          method: "GET",
          path: "/open_api/v1.3/report/integrated/get/",
          query: {
            report_type: "BASIC",
            advertiser_id: args.advertiserId,
            data_level: "AUCTION_AD",
            dimensions,
            metrics: [apiMetricName],
            start_date: toDateOnlyString(windowStart),
            end_date: toDateOnlyString(windowEnd),
            page,
            page_size: REPORT_PAGE_SIZE,
          },
        });

        const pageRows = getReportRows(payload);
        rows.push(...pageRows);
        totalPages = getTotalPages(payload, pageRows.length);

        if (pageRows.length < REPORT_PAGE_SIZE) {
          break;
        }
      }

      if (totalPages > MAX_REPORT_PAGES) {
        warnings.push(
          `TikTok reporting returned more than ${MAX_REPORT_PAGES} pages for ${toDateOnlyString(
            windowStart,
          )} to ${toDateOnlyString(windowEnd)}. The result may be truncated.`,
        );
      }

      windowStart = addUtcDays(windowEnd, 1);
    }

    const result: PaidReportFetchResult = {
      rows,
      apiMetricName,
      warnings,
    };

    paidReportCache.set(cacheKey, {
      value: result,
      expiresAt: Date.now() + PAID_REPORT_CACHE_TTL_MS,
    });

    return result;
  })();

  pendingPaidReportCache.set(cacheKey, requestPromise);

  try {
    return await requestPromise;
  } finally {
    pendingPaidReportCache.delete(cacheKey);
  }
}

async function fetchAdvertiserAdCampaignMetadataWithFields(args: {
  advertiserId: string;
  accessToken: string;
  fields?: readonly string[];
}) {
  const ads: TikTokAdCampaignMetadata[] = [];
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
      .map(normalizeAdCampaignMetadata)
      .filter((ad): ad is TikTokAdCampaignMetadata => Boolean(ad));

    ads.push(...pageAds);
    totalPages = getTotalPages(
      payload,
      pageAds.length,
      LIST_PAGE_SIZE,
      MAX_LIST_PAGES,
    );

    if (pageAds.length < LIST_PAGE_SIZE) {
      break;
    }
  }

  return ads;
}

async function fetchAdvertiserAdCampaignMetadataBestEffort(args: {
  advertiserId: string;
  accessToken: string;
}) {
  let lastError: unknown = null;

  for (const [index, fields] of adCampaignFieldCandidates.entries()) {
    try {
      const ads = await fetchAdvertiserAdCampaignMetadataWithFields({
        advertiserId: args.advertiserId,
        accessToken: args.accessToken,
        fields,
      });

      return {
        ads,
        warnings:
          index > 0
            ? [
                "TikTok rejected the richer ad field set, so campaign reconciliation used a simpler ad metadata response.",
              ]
            : [],
      };
    } catch (error) {
      lastError = error;
    }
  }

  return {
    ads: [] as TikTokAdCampaignMetadata[],
    warnings: [
      lastError instanceof Error
        ? `Could not load TikTok ad metadata for campaign reconciliation: ${lastError.message}`
        : "Could not load TikTok ad metadata for campaign reconciliation.",
    ],
  };
}

async function fetchAdvertiserCampaignMetadataWithFields(args: {
  advertiserId: string;
  accessToken: string;
  fields?: readonly string[];
}) {
  const campaigns: TikTokCampaignMetadata[] = [];
  let totalPages = 1;

  for (let page = 1; page <= totalPages && page <= MAX_LIST_PAGES; page += 1) {
    const payload = await requestTikTokBusinessApi<TikTokListData>({
      accessToken: args.accessToken,
      method: "GET",
      path: "/open_api/v1.3/campaign/get/",
      query: {
        advertiser_id: args.advertiserId,
        page,
        page_size: LIST_PAGE_SIZE,
        ...(args.fields ? { fields: args.fields } : {}),
      },
    });

    const pageCampaigns = getRecordArray(payload, ["list"])
      .map(normalizeCampaignMetadata)
      .filter(
        (campaign): campaign is TikTokCampaignMetadata => Boolean(campaign),
      );

    campaigns.push(...pageCampaigns);
    totalPages = getTotalPages(
      payload,
      pageCampaigns.length,
      LIST_PAGE_SIZE,
      MAX_LIST_PAGES,
    );

    if (pageCampaigns.length < LIST_PAGE_SIZE) {
      break;
    }
  }

  return campaigns;
}

async function fetchAdvertiserCampaignMetadataBestEffort(args: {
  advertiserId: string;
  accessToken: string;
}) {
  let lastError: unknown = null;

  for (const [index, fields] of campaignFieldCandidates.entries()) {
    try {
      const campaigns = await fetchAdvertiserCampaignMetadataWithFields({
        advertiserId: args.advertiserId,
        accessToken: args.accessToken,
        fields,
      });

      return {
        campaigns,
        warnings:
          index > 0
            ? [
                "TikTok rejected the richer campaign field set, so campaign labels may fall back to raw campaign IDs.",
              ]
            : [],
      };
    } catch (error) {
      lastError = error;
    }
  }

  return {
    campaigns: [] as TikTokCampaignMetadata[],
    warnings: [
      lastError instanceof Error
        ? `Could not load TikTok campaign metadata: ${lastError.message}`
        : "Could not load TikTok campaign metadata.",
    ],
  };
}

async function fetchCampaignAwarePaidReportRows(args: {
  advertiserId: string;
  accessToken: string;
  startDate: string;
  endDate: string;
  metric: TikTokPaidViewMetric;
}) {
  try {
    return await fetchPaidReportRows({
      ...args,
      dimensions: campaignPaidReportDimensions,
    });
  } catch {
    const fallbackReport = await fetchPaidReportRows({
      ...args,
      dimensions: basePaidReportDimensions,
    });

    return {
      ...fallbackReport,
      warnings: [
        ...fallbackReport.warnings,
        "TikTok did not return campaign_id as a report dimension, so campaign labels were resolved from ad metadata when possible.",
      ],
    };
  }
}

export async function getTikTokCampaignVideoViewsForOrganization(args: {
  organizationSlug: string;
  itemIds: string[];
  startDate: QueryDateInput;
  endDate: QueryDateInput;
  metric?: TikTokPaidViewMetric;
}): Promise<TikTokCampaignVideoViewsResult> {
  const membership = await requireOrganizationMembership(args.organizationSlug);
  const startDate = parseDateInput(args.startDate, "start date");
  const endDate = parseDateInput(args.endDate, "end date");

  if (endDate < startDate) {
    throw new Error("End date must be on or after start date.");
  }

  const metric = args.metric ?? "videoPlayActions";
  const itemIds = uniqueNonEmptyStrings(args.itemIds);
  const startDateString = toDateOnlyString(startDate);
  const endDateString = toDateOnlyString(endDate);

  if (itemIds.length === 0) {
    return {
      advertiserId: null,
      metric,
      startDate: startDateString,
      endDate: endDateString,
      totalPaidViews: 0,
      reportRowCount: 0,
      rows: [],
      warnings: [],
    };
  }

  let accountWarnings: string[] = [];
  let advertiserId: string | null = null;
  let accessToken: string | null = null;

  try {
    const accountLookup = await getOrgTikTokAccount(membership.organizationId);
    advertiserId = accountLookup.account.advertiserId;
    accessToken = accountLookup.account.accessToken;
    accountWarnings = accountLookup.warnings;
  } catch (error) {
    if (!isMissingOrgTikTokAccountError(error)) {
      throw error;
    }

    return {
      advertiserId: null,
      metric,
      startDate: startDateString,
      endDate: endDateString,
      totalPaidViews: 0,
      reportRowCount: 0,
      rows: [],
      warnings: [
        error instanceof Error
          ? error.message
          : "No TikTok advertiser account is configured for this organization.",
      ],
    };
  }

  if (!advertiserId || !accessToken) {
    throw new Error("TikTok advertiser credentials are unavailable.");
  }

  const report = await fetchCampaignAwarePaidReportRows({
    advertiserId,
    accessToken,
    startDate: startDateString,
    endDate: endDateString,
    metric,
  });
  const normalizedRows = report.rows.map((row) =>
    normalizeReportRow(row, report.apiMetricName),
  );
  const rowsNeedAdMetadata = normalizedRows.some(
    (row) => row.adId && (!row.itemId || !row.campaignId),
  );
  const adMetadata = rowsNeedAdMetadata
    ? await fetchAdvertiserAdCampaignMetadataBestEffort({
        advertiserId,
        accessToken,
      })
    : {
        ads: [] as TikTokAdCampaignMetadata[],
        warnings: [] as string[],
      };
  const adsById = new Map(adMetadata.ads.map((ad) => [ad.adId, ad] as const));
  const campaignIds = uniqueNonEmptyStrings([
    ...normalizedRows.map((row) => row.campaignId),
    ...adMetadata.ads.map((ad) => ad.campaignId),
  ]);
  const campaignMetadata =
    campaignIds.length > 0
      ? await fetchAdvertiserCampaignMetadataBestEffort({
          advertiserId,
          accessToken,
        })
      : {
          campaigns: [] as TikTokCampaignMetadata[],
          warnings: [] as string[],
        };
  const campaignIdSet = new Set(campaignIds);
  const campaignsById = new Map(
    campaignMetadata.campaigns
      .filter((campaign) => campaignIdSet.has(campaign.campaignId))
      .map((campaign) => [campaign.campaignId, campaign] as const),
  );
  const itemIdSet = new Set(itemIds);
  const groupedRows = new Map<
    string,
    {
      sourceVideoId: string;
      tiktokCampaignId: string | null;
      tiktokCampaignName: string | null;
      paidViews: number;
      reportRowCount: number;
      matchedAdIds: Set<string>;
      statDates: Set<string>;
      matchSources: Set<TikTokCampaignVideoMatchSource>;
    }
  >();

  for (const row of normalizedRows) {
    const ad = row.adId ? (adsById.get(row.adId) ?? null) : null;
    const sourceVideoId = row.itemId ?? ad?.tiktokItemId ?? null;

    if (!sourceVideoId || !itemIdSet.has(sourceVideoId)) {
      continue;
    }

    const tiktokCampaignId = row.campaignId ?? ad?.campaignId ?? null;
    const tiktokCampaignName =
      row.campaignName ??
      (tiktokCampaignId
        ? (campaignsById.get(tiktokCampaignId)?.campaignName ?? null)
        : null);
    const groupKey = [
      sourceVideoId,
      tiktokCampaignId ?? tiktokCampaignName ?? "unknown-campaign",
    ].join("::");
    const group =
      groupedRows.get(groupKey) ??
      {
        sourceVideoId,
        tiktokCampaignId,
        tiktokCampaignName,
        paidViews: 0,
        reportRowCount: 0,
        matchedAdIds: new Set<string>(),
        statDates: new Set<string>(),
        matchSources: new Set<TikTokCampaignVideoMatchSource>(),
      };

    group.tiktokCampaignName ??= tiktokCampaignName;
    group.paidViews += row.metricValue;
    group.reportRowCount += 1;

    if (row.adId) {
      group.matchedAdIds.add(row.adId);
    }

    if (row.statDate) {
      group.statDates.add(row.statDate);
    }

    group.matchSources.add(row.itemId ? "report_item_id" : "ad_metadata_item_id");

    if (tiktokCampaignId) {
      group.matchSources.add(
        row.campaignId ? "report_campaign_id" : "ad_metadata_campaign_id",
      );
    }

    groupedRows.set(groupKey, group);
  }

  const rows = [...groupedRows.values()]
    .map((row) => ({
      sourceVideoId: row.sourceVideoId,
      tiktokCampaignId: row.tiktokCampaignId,
      tiktokCampaignName: row.tiktokCampaignName,
      paidViews: row.paidViews,
      reportRowCount: row.reportRowCount,
      matchedAdIds: [...row.matchedAdIds].sort(),
      statDates: [...row.statDates].sort(),
      matchSources: [...row.matchSources].sort(),
    }))
    .sort(
      (left, right) =>
        right.paidViews - left.paidViews ||
        (left.tiktokCampaignName ?? left.tiktokCampaignId ?? "").localeCompare(
          right.tiktokCampaignName ?? right.tiktokCampaignId ?? "",
        ) ||
        left.sourceVideoId.localeCompare(right.sourceVideoId),
    );

  return {
    advertiserId,
    metric,
    startDate: startDateString,
    endDate: endDateString,
    totalPaidViews: rows.reduce((total, row) => total + row.paidViews, 0),
    reportRowCount: normalizedRows.length,
    rows,
    warnings: uniqueNonEmptyStrings([
      ...accountWarnings,
      ...report.warnings,
      ...adMetadata.warnings,
      ...campaignMetadata.warnings,
    ]),
  };
}

function getResolvedVideoPaidStatus(args: {
  matchedReportRowCount: number;
  hasAmbiguousMatch: boolean;
  hadAnyPaidRows: boolean;
  hasOpaqueReportRows: boolean;
  hasPendingExternalResolution: boolean;
  unresolvedUnknownGroupCount: number;
  onlyNonPostBackedDelivery: boolean;
}): {
  paidStatus: TikTokVideoPaidStatus;
  paidStatusReason: TikTokVideoPaidStatusReason;
} {
  if (args.matchedReportRowCount > 0) {
    return {
      paidStatus: "yes",
      paidStatusReason: "exact_post_match",
    };
  }

  if (args.hasAmbiguousMatch) {
    return {
      paidStatus: "unknown",
      paidStatusReason: "ambiguous_post_mapping",
    };
  }

  if (!args.hadAnyPaidRows) {
    return {
      paidStatus: "no",
      paidStatusReason: "no_paid_rows_in_window",
    };
  }

  if (args.hasPendingExternalResolution) {
    return {
      paidStatus: "unknown",
      paidStatusReason: "pending_external_match",
    };
  }

  if (args.hasOpaqueReportRows || args.unresolvedUnknownGroupCount > 0) {
    return {
      paidStatus: "unknown",
      paidStatusReason: "unresolved_post_mapping",
    };
  }

  if (args.onlyNonPostBackedDelivery) {
    return {
      paidStatus: "unsupported",
      paidStatusReason: "non_post_backed_delivery",
    };
  }

  return {
    paidStatus: "no",
    paidStatusReason: "no_exact_post_match",
  };
}

export async function getAdSpendForOrganization(args: {
  organizationSlug: string;
  startDate: QueryDateInput;
  endDate: QueryDateInput;
  metadataRowLimit?: number;
}): Promise<TikTokAdSpendReport> {
  const membership = await requireOrganizationMembership(args.organizationSlug);
  const startDate = parseDateInput(args.startDate, "start date");
  const endDate = parseDateInput(args.endDate, "end date");

  if (endDate < startDate) {
    throw new Error("End date must be on or after start date.");
  }

  let accountWarnings: string[] = [];
  let advertiserId: string | null = null;
  let accessToken: string | null = null;

  try {
    const accountLookup = await getOrgTikTokAccount(membership.organizationId);
    advertiserId = accountLookup.account.advertiserId;
    accessToken = accountLookup.account.accessToken;
    accountWarnings = accountLookup.warnings;
  } catch (error) {
    if (!isMissingOrgTikTokAccountError(error)) {
      throw error;
    }

    return {
      advertiserId: null,
      startDate: toDateOnlyString(startDate),
      endDate: toDateOnlyString(endDate),
      totalSpend: 0,
      rowCount: 0,
      rows: [],
      warnings: [
        error instanceof Error
          ? error.message
          : "No TikTok advertiser account is configured for this organization.",
      ],
    };
  }

  if (!advertiserId || !accessToken) {
    throw new Error("TikTok advertiser credentials are unavailable.");
  }

  const startDateString = toDateOnlyString(startDate);
  const endDateString = toDateOnlyString(endDate);
  const metadataRowLimit = args.metadataRowLimit ?? 30;
  const cacheKey = getAdSpendReportCacheKey({
    organizationId: membership.organizationId,
    advertiserId,
    startDate: startDateString,
    endDate: endDateString,
    metadataRowLimit,
  });
  const cached = readAdSpendReportCache(cacheKey);

  if (cached) {
    return cached;
  }

  const pending = pendingAdSpendReportCache.get(cacheKey);

  if (pending) {
    return pending;
  }

  const requestPromise = (async () => {
    const report = await fetchPaidReportRows({
      advertiserId,
      accessToken,
      startDate: startDateString,
      endDate: endDateString,
      metric: "spend",
    });
    const normalizedRows = report.rows.map((row) =>
      normalizeReportRow(row, report.apiMetricName),
    );
    const metadataRows = [...normalizedRows]
      .filter((row) => row.metricValue > 0)
      .sort((left, right) => right.metricValue - left.metricValue)
      .slice(0, metadataRowLimit);
    const resolvedAdGroups = await resolvePaidAdGroupsForAdvertiser({
      advertiserId,
      accessToken,
      rows: metadataRows,
    });
    const groupsByAdId = new Map(
      resolvedAdGroups.groups.map((group) => [group.adId, group] as const),
    );
    const rows = normalizedRows.map((normalizedRow, index) => {
      const resolvedGroup = normalizedRow.adId
        ? (groupsByAdId.get(normalizedRow.adId) ?? null)
        : null;
      const itemIds = uniqueNonEmptyStrings([
        normalizedRow.itemId,
        ...(resolvedGroup?.itemIds ?? []),
        ...(resolvedGroup?.resolvedPosts.map((post) => post.itemId) ?? []),
      ]);
      const matchSource: TikTokAdSpendRow["matchSource"] = normalizedRow.itemId
        ? "report_item_id"
        : itemIds.length > 0
          ? "tiktok_ad_metadata"
          : "unmatched";

      return {
        key: [
          normalizedRow.statDate ?? "unknown-date",
          normalizedRow.adId ?? "unknown-ad",
          normalizedRow.itemId ?? "unknown-item",
          index,
        ].join("::"),
        adId: normalizedRow.adId,
        itemId: normalizedRow.itemId,
        itemIds,
        statDate: normalizedRow.statDate,
        spend: normalizedRow.metricValue,
        matchSource,
        resolvedPosts: resolvedGroup?.resolvedPosts ?? [],
      };
    });
    const result = {
      advertiserId,
      startDate: startDateString,
      endDate: endDateString,
      totalSpend: rows.reduce((total, row) => total + row.spend, 0),
      rowCount: rows.length,
      rows,
      warnings: uniqueNonEmptyStrings([
        ...accountWarnings,
        ...report.warnings,
        ...resolvedAdGroups.warnings,
        ...(rows.length === 0
          ? ["TikTok returned no ad spend rows for this advertiser in the selected date range."]
          : []),
      ]),
    };

    adSpendReportCache.set(cacheKey, {
      value: result,
      expiresAt: Date.now() + AD_SPEND_REPORT_CACHE_TTL_MS,
    });

    return result;
  })();

  pendingAdSpendReportCache.set(cacheKey, requestPromise);

  try {
    return await requestPromise;
  } finally {
    pendingAdSpendReportCache.delete(cacheKey);
  }
}

export async function getPaidViewsForCreatorForOrganization(
  args: GetPaidViewsForCreatorArgs,
): Promise<TikTokCreatorPaidViewsResult> {
  const membership = await requireOrganizationMembership(args.organizationSlug);
  const creator = await resolveCreatorById({
    organizationId: membership.organizationId,
    creatorId: args.creatorId,
  });
  const startDate = parseDateInput(args.startDate, "start date");
  const endDate = parseDateInput(args.endDate, "end date");

  if (endDate < startDate) {
    throw new Error("End date must be on or after start date.");
  }

  const metric = args.metric ?? "impressions";
  const { account, warnings } = await getOrgTikTokAccount(membership.organizationId);
  const itemIds = await getCreatorSparkItemIds({
    organizationId: membership.organizationId,
    creatorId: creator.id,
    advertiserId: account.advertiserId,
    startDate,
    endDate,
  });

  if (itemIds.length === 0) {
    return {
      creator: {
        id: creator.id,
        displayName: creator.displayName,
        tiktokHandle: getPrimaryTikTokHandle(creator),
      },
      advertiserId: account.advertiserId,
      metric,
      startDate: toDateOnlyString(startDate),
      endDate: toDateOnlyString(endDate),
      paidViews: 0,
      matchedSparkItemIds: [],
      rowCount: 0,
      rows: [],
      warnings: [
        ...warnings,
        "No authorized Spark item IDs were found for this creator in the requested date window.",
      ],
    };
  }

  const report = await fetchPaidReportRows({
    advertiserId: account.advertiserId,
    accessToken: account.accessToken,
    startDate: toDateOnlyString(startDate),
    endDate: toDateOnlyString(endDate),
    metric,
  });
  const normalizedRows = report.rows.map((row) =>
    normalizeReportRow(row, report.apiMetricName),
  );
  const itemIdSet = new Set(itemIds);
  const rowsIncludeItemIds = normalizedRows.some((row) => row.itemId !== null);
  const rowsIncludeAdIds = normalizedRows.some((row) => row.adId !== null);
  const scopedRows = rowsIncludeItemIds
    ? normalizedRows.filter((row) => row.itemId !== null && itemIdSet.has(row.itemId))
    : [];
  const paidViews = scopedRows.reduce((total, row) => total + row.metricValue, 0);

  return {
    creator: {
      id: creator.id,
      displayName: creator.displayName,
      tiktokHandle: getPrimaryTikTokHandle(creator),
    },
    advertiserId: account.advertiserId,
    metric,
    startDate: toDateOnlyString(startDate),
    endDate: toDateOnlyString(endDate),
    paidViews,
    matchedSparkItemIds: itemIds,
    rowCount: scopedRows.length,
    rows: scopedRows,
    warnings: rowsIncludeItemIds
      ? [...warnings, ...report.warnings]
      : [
          ...warnings,
          ...report.warnings,
          rowsIncludeAdIds
            ? "TikTok report rows did not include item_id, so this creator lookup returned 0 rows rather than guess from ad-level data."
            : "TikTok report rows did not include item_id or ad_id, so this creator lookup could not be safely scoped.",
        ],
  };
}

export async function getPaidViewsForCreatorByNameForOrganization(
  args: GetPaidViewsForCreatorByNameArgs,
) {
  const membership = await requireOrganizationMembership(args.organizationSlug);
  const creator = await resolveCreatorByName({
    organizationId: membership.organizationId,
    creatorName: args.creatorName,
  });

  return getPaidViewsForCreatorForOrganization({
    organizationSlug: args.organizationSlug,
    creatorId: creator.id,
    startDate: args.startDate,
    endDate: args.endDate,
    metric: args.metric,
  });
}

export async function getPaidViewsForItemIdsForOrganization(args: {
  organizationSlug: string;
  itemIds: string[];
  startDate: QueryDateInput;
  endDate: QueryDateInput;
  metric?: TikTokPaidViewMetric;
}): Promise<TikTokSourceVideoPaidViewsResult> {
  const membership = await requireOrganizationMembership(args.organizationSlug);
  const startDate = parseDateInput(args.startDate, "start date");
  const endDate = parseDateInput(args.endDate, "end date");

  if (endDate < startDate) {
    throw new Error("End date must be on or after start date.");
  }

  const metric = args.metric ?? "videoPlayActions";
  const itemIds = uniqueNonEmptyStrings(args.itemIds);

  if (itemIds.length === 0) {
    return {
      advertiserId: null,
      metric,
      startDate: toDateOnlyString(startDate),
      endDate: toDateOnlyString(endDate),
      unresolvedPostBackedGroupCount: 0,
      unresolvedNonPostBackedGroupCount: 0,
      rows: [],
      warnings: [],
    };
  }

  try {
    const { account, warnings } = await getOrgTikTokAccount(membership.organizationId);
    const report = await fetchPaidReportRows({
      advertiserId: account.advertiserId,
      accessToken: account.accessToken,
      startDate: toDateOnlyString(startDate),
      endDate: toDateOnlyString(endDate),
      metric,
    });
    const normalizedRows = report.rows.map((row) =>
      normalizeReportRow(row, report.apiMetricName),
    );
    const rowsIncludeItemIds = normalizedRows.some((row) => row.itemId !== null);
    const rowsIncludeAdIds = normalizedRows.some((row) => row.adId !== null);
    const itemIdSet = new Set(itemIds);
    const paidViewsByItemId = new Map<string, number>();
    const rowCountByItemId = new Map<string, number>();
    const matchedAdIdsByItemId = new Map<string, Set<string>>();
    const attributionSourcesByItemId = new Map<
      string,
      Set<TikTokVideoPaidAttributionSource>
    >();
    const fallbackResolution = rowsIncludeAdIds
      ? await resolveExactItemIdsFromAdMetadata({
          advertiserId: account.advertiserId,
          accessToken: account.accessToken,
          itemIds,
          startDate: toDateOnlyString(startDate),
          endDate: toDateOnlyString(endDate),
          rows: normalizedRows,
        })
      : getEmptyExactItemIdFallbackResult();

    if (rowsIncludeItemIds) {
      for (const row of normalizedRows) {
        if (!row.itemId || !itemIdSet.has(row.itemId)) {
          continue;
        }

        paidViewsByItemId.set(
          row.itemId,
          (paidViewsByItemId.get(row.itemId) ?? 0) + row.metricValue,
        );
        rowCountByItemId.set(
          row.itemId,
          (rowCountByItemId.get(row.itemId) ?? 0) + 1,
        );

        addSetMapEntry(attributionSourcesByItemId, row.itemId, "report_item_id");

        if (row.adId) {
          addSetMapEntry(matchedAdIdsByItemId, row.itemId, row.adId);
        }
      }
    }

    for (const [itemId, paidViews] of fallbackResolution.paidViewsByItemId.entries()) {
      paidViewsByItemId.set(itemId, (paidViewsByItemId.get(itemId) ?? 0) + paidViews);
    }

    for (const [itemId, matchedRowCount] of fallbackResolution.rowCountByItemId.entries()) {
      rowCountByItemId.set(itemId, (rowCountByItemId.get(itemId) ?? 0) + matchedRowCount);
    }

    mergeSetMaps(matchedAdIdsByItemId, fallbackResolution.matchedAdIdsByItemId);
    mergeSetMaps(attributionSourcesByItemId, fallbackResolution.attributionSourcesByItemId);

    const hadAnyPaidRows = normalizedRows.length > 0;
    const hasAnyResolvedItemMatches =
      paidViewsByItemId.size > 0 || fallbackResolution.ambiguousItemIds.size > 0;
    const hasPendingExternalResolution = fallbackResolution.pending;
    const hasOpaqueReportRows = hadAnyPaidRows && !rowsIncludeItemIds && !rowsIncludeAdIds;
    const onlyNonPostBackedDelivery =
      hadAnyPaidRows &&
      !rowsIncludeItemIds &&
      !hasAnyResolvedItemMatches &&
      !hasPendingExternalResolution &&
      !hasOpaqueReportRows &&
      fallbackResolution.unresolvedUnknownGroupCount === 0 &&
      fallbackResolution.unresolvedNonPostBackedGroupCount > 0;

    return {
      advertiserId: account.advertiserId,
      metric,
      startDate: toDateOnlyString(startDate),
      endDate: toDateOnlyString(endDate),
      unresolvedPostBackedGroupCount: fallbackResolution.unresolvedUnknownGroupCount,
      unresolvedNonPostBackedGroupCount: fallbackResolution.unresolvedNonPostBackedGroupCount,
      rows: itemIds.map((itemId) => {
        const matchedReportRowCount = rowCountByItemId.get(itemId) ?? 0;
        const status = getResolvedVideoPaidStatus({
          matchedReportRowCount,
          hasAmbiguousMatch: fallbackResolution.ambiguousItemIds.has(itemId),
          hadAnyPaidRows,
          hasOpaqueReportRows,
          hasPendingExternalResolution,
          unresolvedUnknownGroupCount: fallbackResolution.unresolvedUnknownGroupCount,
          onlyNonPostBackedDelivery,
        });

        return {
          sourceVideoId: itemId,
          matchedSparkItemIds: [itemId],
          paidViews: paidViewsByItemId.get(itemId) ?? 0,
          paidStatus: status.paidStatus,
          paidStatusReason: status.paidStatusReason,
          matchedReportRowCount,
          matchedAdIds: [...(matchedAdIdsByItemId.get(itemId) ?? [])].sort(),
          unresolvedPostBackedAdIds:
            status.paidStatus === "unknown" || status.paidStatus === "unsupported"
              ? uniqueNonEmptyStrings([
                  ...fallbackResolution.unresolvedPostBackedGroupIds,
                  ...fallbackResolution.ambiguousGroupIds,
                ]).sort()
              : [],
          unresolvedNonPostBackedAdIds:
            status.paidStatus === "unknown" || status.paidStatus === "unsupported"
              ? [...fallbackResolution.unresolvedNonPostBackedGroupIds].sort()
              : [],
          unresolvedPostBackedGroupCount:
            status.paidStatus === "unknown" || status.paidStatus === "unsupported"
              ? fallbackResolution.unresolvedUnknownGroupCount
              : 0,
          unresolvedNonPostBackedGroupCount:
            status.paidStatus === "unknown" || status.paidStatus === "unsupported"
              ? fallbackResolution.unresolvedNonPostBackedGroupCount
              : 0,
          attributionSources: [...(attributionSourcesByItemId.get(itemId) ?? [])].sort(),
        };
      }),
      warnings:
        rowsIncludeItemIds || hasAnyResolvedItemMatches || hasPendingExternalResolution
          ? [...warnings, ...report.warnings, ...fallbackResolution.warnings]
          : [
              ...warnings,
              ...report.warnings,
              ...fallbackResolution.warnings,
              onlyNonPostBackedDelivery
                ? "TikTok only exposed non-post-backed ad delivery for this date window, so exact post-level tallies are unsupported here."
                : rowsIncludeAdIds
                ? "TikTok report rows did not include item_id, and neither TikTok metadata nor Singular could resolve exact post IDs for these tallies."
                : "TikTok report rows did not include item_id or ad_id, so paid video tallies could not be safely scoped.",
            ],
    };
  } catch (error) {
    if (!isMissingOrgTikTokAccountError(error)) {
      throw error;
    }

    const warningMessage =
      error instanceof Error
        ? error.message
        : "No TikTok advertiser account is configured for this organization.";

    return {
      advertiserId: null,
      metric,
      startDate: toDateOnlyString(startDate),
      endDate: toDateOnlyString(endDate),
      unresolvedPostBackedGroupCount: 0,
      unresolvedNonPostBackedGroupCount: 0,
      rows: itemIds.map((itemId) => ({
        sourceVideoId: itemId,
        matchedSparkItemIds: [itemId],
        paidViews: 0,
        paidStatus: "unknown",
        paidStatusReason: "missing_tiktok_connection",
        matchedReportRowCount: 0,
        matchedAdIds: [],
        unresolvedPostBackedAdIds: [],
        unresolvedNonPostBackedAdIds: [],
        unresolvedPostBackedGroupCount: 0,
        unresolvedNonPostBackedGroupCount: 0,
        attributionSources: [],
      })),
      warnings: [warningMessage],
    };
  }
}

export async function getPaidViewsForSourceVideosForCreatorForOrganization(args: {
  organizationSlug: string;
  creatorId: string;
  sourceVideoIds: string[];
  startDate: QueryDateInput;
  endDate: QueryDateInput;
  metric?: TikTokPaidViewMetric;
}): Promise<TikTokSourceVideoPaidViewsResult> {
  const membership = await requireOrganizationMembership(args.organizationSlug);
  await resolveCreatorById({
    organizationId: membership.organizationId,
    creatorId: args.creatorId,
  });
  const startDate = parseDateInput(args.startDate, "start date");
  const endDate = parseDateInput(args.endDate, "end date");

  if (endDate < startDate) {
    throw new Error("End date must be on or after start date.");
  }

  const metric = args.metric ?? "videoPlayActions";
  const sourceVideoIds = uniqueNonEmptyStrings(args.sourceVideoIds);

  if (sourceVideoIds.length === 0) {
    return {
      advertiserId: null,
      metric,
      startDate: toDateOnlyString(startDate),
      endDate: toDateOnlyString(endDate),
      unresolvedPostBackedGroupCount: 0,
      unresolvedNonPostBackedGroupCount: 0,
      rows: [],
      warnings: [],
    };
  }

  let accountWarnings: string[] = [];
  let advertiserId: string | null = null;
  let accessToken: string | null = null;

  try {
    const accountLookup = await getOrgTikTokAccount(membership.organizationId);
    advertiserId = accountLookup.account.advertiserId;
    accessToken = accountLookup.account.accessToken;
    accountWarnings = accountLookup.warnings;
  } catch (error) {
    if (!isMissingOrgTikTokAccountError(error)) {
      throw error;
    }

    const warningMessage =
      error instanceof Error
        ? error.message
        : "No TikTok advertiser account is configured for this organization.";

    return {
      advertiserId: null,
      metric,
      startDate: toDateOnlyString(startDate),
      endDate: toDateOnlyString(endDate),
      unresolvedPostBackedGroupCount: 0,
      unresolvedNonPostBackedGroupCount: 0,
      rows: sourceVideoIds.map((sourceVideoId) => ({
        sourceVideoId,
        matchedSparkItemIds: [],
        paidViews: 0,
        paidStatus: "unknown",
        paidStatusReason: "missing_tiktok_connection",
        matchedReportRowCount: 0,
        matchedAdIds: [],
        unresolvedPostBackedAdIds: [],
        unresolvedNonPostBackedAdIds: [],
        unresolvedPostBackedGroupCount: 0,
        unresolvedNonPostBackedGroupCount: 0,
        attributionSources: [],
      })),
      warnings: [warningMessage],
    };
  }

  if (!advertiserId || !accessToken) {
    throw new Error("TikTok advertiser credentials are unavailable.");
  }

  const itemIdsBySourceVideoId = await getCreatorSparkItemIdsBySourceVideo({
    organizationId: membership.organizationId,
    creatorId: args.creatorId,
    advertiserId,
    sourceVideoIds,
    startDate,
    endDate,
  });
  const candidateItemIdsBySourceVideoId = new Map(
    sourceVideoIds.map((sourceVideoId) => [
      sourceVideoId,
      uniqueNonEmptyStrings([sourceVideoId, ...(itemIdsBySourceVideoId.get(sourceVideoId) ?? [])]),
    ]),
  );
  const candidateItemIds = uniqueNonEmptyStrings(
    [...candidateItemIdsBySourceVideoId.values()].flat(),
  );

  const report = await fetchPaidReportRows({
    advertiserId,
    accessToken,
    startDate: toDateOnlyString(startDate),
    endDate: toDateOnlyString(endDate),
    metric,
  });
  const normalizedRows = report.rows.map((row) =>
    normalizeReportRow(row, report.apiMetricName),
  );
  const rowsIncludeItemIds = normalizedRows.some((row) => row.itemId !== null);
  const rowsIncludeAdIds = normalizedRows.some((row) => row.adId !== null);
  const paidViewsByItemId = new Map<string, number>();
  const rowCountByItemId = new Map<string, number>();
  const matchedAdIdsByItemId = new Map<string, Set<string>>();
  const attributionSourcesByItemId = new Map<
    string,
    Set<TikTokVideoPaidAttributionSource>
  >();
  const fallbackResolution = rowsIncludeAdIds
    ? await resolveExactItemIdsFromAdMetadata({
        advertiserId,
        accessToken,
        itemIds: candidateItemIds,
        startDate: toDateOnlyString(startDate),
        endDate: toDateOnlyString(endDate),
        rows: normalizedRows,
      })
    : getEmptyExactItemIdFallbackResult();

  if (rowsIncludeItemIds) {
    for (const row of normalizedRows) {
      if (!row.itemId) {
        continue;
      }

      paidViewsByItemId.set(
        row.itemId,
        (paidViewsByItemId.get(row.itemId) ?? 0) + row.metricValue,
      );
      rowCountByItemId.set(
        row.itemId,
        (rowCountByItemId.get(row.itemId) ?? 0) + 1,
      );

      addSetMapEntry(attributionSourcesByItemId, row.itemId, "report_item_id");

      if (row.adId) {
        addSetMapEntry(matchedAdIdsByItemId, row.itemId, row.adId);
      }
    }
  }

  for (const [itemId, paidViews] of fallbackResolution.paidViewsByItemId.entries()) {
    paidViewsByItemId.set(itemId, (paidViewsByItemId.get(itemId) ?? 0) + paidViews);
  }

  for (const [itemId, matchedRowCount] of fallbackResolution.rowCountByItemId.entries()) {
    rowCountByItemId.set(itemId, (rowCountByItemId.get(itemId) ?? 0) + matchedRowCount);
  }

  mergeSetMaps(matchedAdIdsByItemId, fallbackResolution.matchedAdIdsByItemId);
  mergeSetMaps(attributionSourcesByItemId, fallbackResolution.attributionSourcesByItemId);

  const hadAnyPaidRows = normalizedRows.length > 0;
  const hasAnyResolvedItemMatches =
    paidViewsByItemId.size > 0 || fallbackResolution.ambiguousItemIds.size > 0;
  const hasPendingExternalResolution = fallbackResolution.pending;
  const hasOpaqueReportRows = hadAnyPaidRows && !rowsIncludeItemIds && !rowsIncludeAdIds;
  const onlyNonPostBackedDelivery =
    hadAnyPaidRows &&
    !rowsIncludeItemIds &&
    !hasAnyResolvedItemMatches &&
    !hasPendingExternalResolution &&
    !hasOpaqueReportRows &&
    fallbackResolution.unresolvedUnknownGroupCount === 0 &&
    fallbackResolution.unresolvedNonPostBackedGroupCount > 0;

  const rows = sourceVideoIds.map((sourceVideoId) => {
    const matchedSparkItemIds = itemIdsBySourceVideoId.get(sourceVideoId) ?? [];
    const candidateItemIds = candidateItemIdsBySourceVideoId.get(sourceVideoId) ?? [sourceVideoId];
    const matchedReportRowCount = candidateItemIds.reduce(
      (total, itemId) => total + (rowCountByItemId.get(itemId) ?? 0),
      0,
    );
    const paidViews = candidateItemIds.reduce(
      (total, itemId) => total + (paidViewsByItemId.get(itemId) ?? 0),
      0,
    );
    const hasAmbiguousMatch = candidateItemIds.some((itemId) =>
      fallbackResolution.ambiguousItemIds.has(itemId),
    );
    const matchedAdIds = [
      ...candidateItemIds.reduce((result, itemId) => {
        for (const adId of matchedAdIdsByItemId.get(itemId) ?? []) {
          result.add(adId);
        }

        return result;
      }, new Set<string>()),
    ].sort();
    const attributionSources = [
      ...candidateItemIds.reduce((result, itemId) => {
        for (const source of attributionSourcesByItemId.get(itemId) ?? []) {
          result.add(source);
        }

        return result;
      }, new Set<TikTokVideoPaidAttributionSource>()),
    ].sort();
    const status = getResolvedVideoPaidStatus({
      matchedReportRowCount,
      hasAmbiguousMatch,
      hadAnyPaidRows,
      hasOpaqueReportRows,
      hasPendingExternalResolution,
      unresolvedUnknownGroupCount: fallbackResolution.unresolvedUnknownGroupCount,
      onlyNonPostBackedDelivery,
    });

    return {
      sourceVideoId,
      matchedSparkItemIds,
      paidViews,
      paidStatus: status.paidStatus,
      paidStatusReason: status.paidStatusReason,
      matchedReportRowCount,
      matchedAdIds,
      unresolvedPostBackedAdIds:
        status.paidStatus === "unknown" || status.paidStatus === "unsupported"
          ? uniqueNonEmptyStrings([
              ...fallbackResolution.unresolvedPostBackedGroupIds,
              ...fallbackResolution.ambiguousGroupIds,
            ]).sort()
          : [],
      unresolvedNonPostBackedAdIds:
        status.paidStatus === "unknown" || status.paidStatus === "unsupported"
          ? [...fallbackResolution.unresolvedNonPostBackedGroupIds].sort()
          : [],
      unresolvedPostBackedGroupCount:
        status.paidStatus === "unknown" || status.paidStatus === "unsupported"
          ? fallbackResolution.unresolvedUnknownGroupCount
          : 0,
      unresolvedNonPostBackedGroupCount:
        status.paidStatus === "unknown" || status.paidStatus === "unsupported"
          ? fallbackResolution.unresolvedNonPostBackedGroupCount
          : 0,
      attributionSources,
    };
  });

  return {
    advertiserId,
    metric,
    startDate: toDateOnlyString(startDate),
    endDate: toDateOnlyString(endDate),
    unresolvedPostBackedGroupCount: fallbackResolution.unresolvedUnknownGroupCount,
    unresolvedNonPostBackedGroupCount: fallbackResolution.unresolvedNonPostBackedGroupCount,
    rows,
    warnings:
      rowsIncludeItemIds || hasAnyResolvedItemMatches || hasPendingExternalResolution
        ? [...accountWarnings, ...report.warnings, ...fallbackResolution.warnings]
        : [
            ...accountWarnings,
            ...report.warnings,
            ...fallbackResolution.warnings,
            onlyNonPostBackedDelivery
              ? "TikTok only exposed non-post-backed ad delivery for this date window, so exact post-level tallies are unsupported here."
              : rowsIncludeAdIds
              ? "TikTok report rows did not include item_id, and neither TikTok metadata nor Singular could resolve exact post IDs for these tallies."
              : "TikTok report rows did not include item_id or ad_id, so paid video tallies could not be safely scoped.",
            ...(candidateItemIds.length === sourceVideoIds.length
              ? [
                  "No authorized Spark item IDs were found for the selected videos in the requested date window.",
                ]
              : []),
          ],
  };
}

export async function getPaidViewTimelineForSourceVideosForCreatorForOrganization(args: {
  organizationSlug: string;
  creatorId: string;
  sourceVideoIds: string[];
  startDate: QueryDateInput;
  endDate: QueryDateInput;
  metric?: TikTokPaidViewMetric;
}): Promise<TikTokSourceVideoPaidViewsTimelineResult> {
  const membership = await requireOrganizationMembership(args.organizationSlug);
  await resolveCreatorById({
    organizationId: membership.organizationId,
    creatorId: args.creatorId,
  });
  const startDate = parseDateInput(args.startDate, "start date");
  const endDate = parseDateInput(args.endDate, "end date");

  if (endDate < startDate) {
    throw new Error("End date must be on or after start date.");
  }

  const metric = args.metric ?? "videoPlayActions";
  const sourceVideoIds = uniqueNonEmptyStrings(args.sourceVideoIds);

  if (sourceVideoIds.length === 0) {
    return {
      advertiserId: null,
      metric,
      startDate: toDateOnlyString(startDate),
      endDate: toDateOnlyString(endDate),
      unresolvedPostBackedGroupCount: 0,
      unresolvedNonPostBackedGroupCount: 0,
      rows: [],
      timelineRows: [],
      warnings: [],
    };
  }

  let accountWarnings: string[] = [];
  let advertiserId: string | null = null;
  let accessToken: string | null = null;

  try {
    const accountLookup = await getOrgTikTokAccount(membership.organizationId);
    advertiserId = accountLookup.account.advertiserId;
    accessToken = accountLookup.account.accessToken;
    accountWarnings = accountLookup.warnings;
  } catch (error) {
    if (!isMissingOrgTikTokAccountError(error)) {
      throw error;
    }

    const warningMessage =
      error instanceof Error
        ? error.message
        : "No TikTok advertiser account is configured for this organization.";

    return {
      advertiserId: null,
      metric,
      startDate: toDateOnlyString(startDate),
      endDate: toDateOnlyString(endDate),
      unresolvedPostBackedGroupCount: 0,
      unresolvedNonPostBackedGroupCount: 0,
      rows: sourceVideoIds.map((sourceVideoId) => ({
        sourceVideoId,
        matchedSparkItemIds: [],
        paidViews: 0,
        paidStatus: "unknown",
        paidStatusReason: "missing_tiktok_connection",
        matchedReportRowCount: 0,
        matchedAdIds: [],
        unresolvedPostBackedAdIds: [],
        unresolvedNonPostBackedAdIds: [],
        unresolvedPostBackedGroupCount: 0,
        unresolvedNonPostBackedGroupCount: 0,
        attributionSources: [],
      })),
      timelineRows: [],
      warnings: [warningMessage],
    };
  }

  if (!advertiserId || !accessToken) {
    throw new Error("TikTok advertiser credentials are unavailable.");
  }

  const itemIdsBySourceVideoId = await getCreatorSparkItemIdsBySourceVideo({
    organizationId: membership.organizationId,
    creatorId: args.creatorId,
    advertiserId,
    sourceVideoIds,
    startDate,
    endDate,
  });
  const candidateItemIdsBySourceVideoId = new Map(
    sourceVideoIds.map((sourceVideoId) => [
      sourceVideoId,
      uniqueNonEmptyStrings([sourceVideoId, ...(itemIdsBySourceVideoId.get(sourceVideoId) ?? [])]),
    ]),
  );
  const candidateItemIds = uniqueNonEmptyStrings(
    [...candidateItemIdsBySourceVideoId.values()].flat(),
  );

  const report = await fetchPaidReportRows({
    advertiserId,
    accessToken,
    startDate: toDateOnlyString(startDate),
    endDate: toDateOnlyString(endDate),
    metric,
  });
  const normalizedRows = report.rows.map((row) =>
    normalizeReportRow(row, report.apiMetricName),
  );
  const rowsIncludeItemIds = normalizedRows.some((row) => row.itemId !== null);
  const rowsIncludeAdIds = normalizedRows.some((row) => row.adId !== null);
  const paidViewsByItemId = new Map<string, number>();
  const paidViewsByItemDate = new Map<string, number>();
  const rowCountByItemId = new Map<string, number>();
  const matchedAdIdsByItemId = new Map<string, Set<string>>();
  const attributionSourcesByItemId = new Map<
    string,
    Set<TikTokVideoPaidAttributionSource>
  >();
  const fallbackResolution = rowsIncludeAdIds
    ? await resolveExactItemIdsFromAdMetadata({
        advertiserId,
        accessToken,
        itemIds: candidateItemIds,
        startDate: toDateOnlyString(startDate),
        endDate: toDateOnlyString(endDate),
        rows: normalizedRows,
      })
    : getEmptyExactItemIdFallbackResult();

  if (rowsIncludeItemIds) {
    for (const row of normalizedRows) {
      if (!row.itemId) {
        continue;
      }

      paidViewsByItemId.set(
        row.itemId,
        (paidViewsByItemId.get(row.itemId) ?? 0) + row.metricValue,
      );
      addPaidViewsByItemDate(
        paidViewsByItemDate,
        row.itemId,
        row.statDate,
        row.metricValue,
      );
      rowCountByItemId.set(
        row.itemId,
        (rowCountByItemId.get(row.itemId) ?? 0) + 1,
      );

      addSetMapEntry(attributionSourcesByItemId, row.itemId, "report_item_id");

      if (row.adId) {
        addSetMapEntry(matchedAdIdsByItemId, row.itemId, row.adId);
      }
    }
  }

  for (const [itemId, paidViews] of fallbackResolution.paidViewsByItemId.entries()) {
    paidViewsByItemId.set(itemId, (paidViewsByItemId.get(itemId) ?? 0) + paidViews);
  }

  for (const [itemDateKey, paidViews] of fallbackResolution.paidViewsByItemDate.entries()) {
    paidViewsByItemDate.set(itemDateKey, (paidViewsByItemDate.get(itemDateKey) ?? 0) + paidViews);
  }

  for (const [itemId, matchedRowCount] of fallbackResolution.rowCountByItemId.entries()) {
    rowCountByItemId.set(itemId, (rowCountByItemId.get(itemId) ?? 0) + matchedRowCount);
  }

  mergeSetMaps(matchedAdIdsByItemId, fallbackResolution.matchedAdIdsByItemId);
  mergeSetMaps(attributionSourcesByItemId, fallbackResolution.attributionSourcesByItemId);

  const hadAnyPaidRows = normalizedRows.length > 0;
  const hasAnyResolvedItemMatches =
    paidViewsByItemId.size > 0 || fallbackResolution.ambiguousItemIds.size > 0;
  const hasPendingExternalResolution = fallbackResolution.pending;
  const hasOpaqueReportRows = hadAnyPaidRows && !rowsIncludeItemIds && !rowsIncludeAdIds;
  const onlyNonPostBackedDelivery =
    hadAnyPaidRows &&
    !rowsIncludeItemIds &&
    !hasAnyResolvedItemMatches &&
    !hasPendingExternalResolution &&
    !hasOpaqueReportRows &&
    fallbackResolution.unresolvedUnknownGroupCount === 0 &&
    fallbackResolution.unresolvedNonPostBackedGroupCount > 0;

  const rows = sourceVideoIds.map((sourceVideoId) => {
    const matchedSparkItemIds = itemIdsBySourceVideoId.get(sourceVideoId) ?? [];
    const candidateItemIds = candidateItemIdsBySourceVideoId.get(sourceVideoId) ?? [sourceVideoId];
    const matchedReportRowCount = candidateItemIds.reduce(
      (total, itemId) => total + (rowCountByItemId.get(itemId) ?? 0),
      0,
    );
    const paidViews = candidateItemIds.reduce(
      (total, itemId) => total + (paidViewsByItemId.get(itemId) ?? 0),
      0,
    );
    const hasAmbiguousMatch = candidateItemIds.some((itemId) =>
      fallbackResolution.ambiguousItemIds.has(itemId),
    );
    const matchedAdIds = [
      ...candidateItemIds.reduce((result, itemId) => {
        for (const adId of matchedAdIdsByItemId.get(itemId) ?? []) {
          result.add(adId);
        }

        return result;
      }, new Set<string>()),
    ].sort();
    const attributionSources = [
      ...candidateItemIds.reduce((result, itemId) => {
        for (const source of attributionSourcesByItemId.get(itemId) ?? []) {
          result.add(source);
        }

        return result;
      }, new Set<TikTokVideoPaidAttributionSource>()),
    ].sort();
    const status = getResolvedVideoPaidStatus({
      matchedReportRowCount,
      hasAmbiguousMatch,
      hadAnyPaidRows,
      hasOpaqueReportRows,
      hasPendingExternalResolution,
      unresolvedUnknownGroupCount: fallbackResolution.unresolvedUnknownGroupCount,
      onlyNonPostBackedDelivery,
    });

    return {
      sourceVideoId,
      matchedSparkItemIds,
      paidViews,
      paidStatus: status.paidStatus,
      paidStatusReason: status.paidStatusReason,
      matchedReportRowCount,
      matchedAdIds,
      unresolvedPostBackedAdIds:
        status.paidStatus === "unknown" || status.paidStatus === "unsupported"
          ? uniqueNonEmptyStrings([
              ...fallbackResolution.unresolvedPostBackedGroupIds,
              ...fallbackResolution.ambiguousGroupIds,
            ]).sort()
          : [],
      unresolvedNonPostBackedAdIds:
        status.paidStatus === "unknown" || status.paidStatus === "unsupported"
          ? [...fallbackResolution.unresolvedNonPostBackedGroupIds].sort()
          : [],
      unresolvedPostBackedGroupCount:
        status.paidStatus === "unknown" || status.paidStatus === "unsupported"
          ? fallbackResolution.unresolvedUnknownGroupCount
          : 0,
      unresolvedNonPostBackedGroupCount:
        status.paidStatus === "unknown" || status.paidStatus === "unsupported"
          ? fallbackResolution.unresolvedNonPostBackedGroupCount
          : 0,
      attributionSources,
    };
  });

  const timelineEntriesByItemId = new Map<
    string,
    Array<{
      statDate: string;
      paidViews: number;
    }>
  >();

  for (const [itemDateKey, paidViews] of paidViewsByItemDate.entries()) {
    const parsedKey = parseItemDateKey(itemDateKey);

    if (!parsedKey) {
      continue;
    }

    const existingEntries = timelineEntriesByItemId.get(parsedKey.itemId);

    if (existingEntries) {
      existingEntries.push({
        statDate: parsedKey.statDate,
        paidViews,
      });
      continue;
    }

    timelineEntriesByItemId.set(parsedKey.itemId, [
      {
        statDate: parsedKey.statDate,
        paidViews,
      },
    ]);
  }

  const timelineRows = sourceVideoIds
    .flatMap((sourceVideoId) => {
      const candidateItemIds =
        candidateItemIdsBySourceVideoId.get(sourceVideoId) ?? [sourceVideoId];
      const paidViewsByDate = new Map<string, number>();
      const matchedAdIds = [
        ...candidateItemIds.reduce((result, itemId) => {
          for (const adId of matchedAdIdsByItemId.get(itemId) ?? []) {
            result.add(adId);
          }

          return result;
        }, new Set<string>()),
      ].sort();
      const attributionSources = [
        ...candidateItemIds.reduce((result, itemId) => {
          for (const source of attributionSourcesByItemId.get(itemId) ?? []) {
            result.add(source);
          }

          return result;
        }, new Set<TikTokVideoPaidAttributionSource>()),
      ].sort();

      for (const itemId of candidateItemIds) {
        for (const entry of timelineEntriesByItemId.get(itemId) ?? []) {
          paidViewsByDate.set(
            entry.statDate,
            (paidViewsByDate.get(entry.statDate) ?? 0) + entry.paidViews,
          );
        }
      }

      return [...paidViewsByDate.entries()]
        .map(([statDate, paidViews]) => ({
          sourceVideoId,
          statDate,
          paidViews,
          matchedAdIds,
          attributionSources,
        }))
        .sort((left, right) => left.statDate.localeCompare(right.statDate));
    })
    .sort(
      (left, right) =>
        left.statDate.localeCompare(right.statDate) ||
        left.sourceVideoId.localeCompare(right.sourceVideoId),
    );

  return {
    advertiserId,
    metric,
    startDate: toDateOnlyString(startDate),
    endDate: toDateOnlyString(endDate),
    unresolvedPostBackedGroupCount: fallbackResolution.unresolvedUnknownGroupCount,
    unresolvedNonPostBackedGroupCount: fallbackResolution.unresolvedNonPostBackedGroupCount,
    rows,
    timelineRows,
    warnings:
      rowsIncludeItemIds || hasAnyResolvedItemMatches || hasPendingExternalResolution
        ? [...accountWarnings, ...report.warnings, ...fallbackResolution.warnings]
        : [
            ...accountWarnings,
            ...report.warnings,
            ...fallbackResolution.warnings,
            onlyNonPostBackedDelivery
              ? "TikTok only exposed non-post-backed ad delivery for this date window, so exact post-level tallies are unsupported here."
              : rowsIncludeAdIds
                ? "TikTok report rows did not include item_id, and neither TikTok metadata nor Singular could resolve exact post IDs for these tallies."
                : "TikTok report rows did not include item_id or ad_id, so paid video tallies could not be safely scoped.",
            ...(candidateItemIds.length === sourceVideoIds.length
              ? [
                  "No authorized Spark item IDs were found for the selected videos in the requested date window.",
                ]
              : []),
          ],
  };
}

export async function getTopAdsForOrganization(args: {
  organizationSlug: string;
  startDate: QueryDateInput;
  endDate: QueryDateInput;
  metric?: TikTokPaidViewMetric;
  matchMode?: TikTokAdAttributionMatchMode;
}): Promise<TikTokAdProfitabilityReport> {
  const membership = await requireOrganizationMembership(args.organizationSlug);
  const { account, warnings } = await getOrgTikTokAccount(membership.organizationId);
  const report = await getAdProfitabilityReportForAdvertiser({
    advertiserId: account.advertiserId,
    accessToken: account.accessToken,
    startDate: args.startDate,
    endDate: args.endDate,
    metric: args.metric,
    matchMode: args.matchMode,
  });

  return {
    ...report,
    warnings: [...warnings, ...report.warnings],
  };
}
