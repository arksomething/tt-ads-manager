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

export type TikTokMatchedAd = {
  adId: string;
  adName: string | null;
  displayName: string | null;
  itemIds: string[];
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
}) {
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
      itemIds: [...summary.itemIds],
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
  let lastError: unknown = null;

  for (const [index, fields] of AD_GET_FIELDS_CANDIDATES.entries()) {
    try {
      const ads = await fetchAdvertiserAdsWithFields({
        advertiserId: args.advertiserId,
        accessToken: args.accessToken,
        fields,
      });

      return {
        ads,
        warnings:
          index > 0
            ? [
                "TikTok rejected the richer ad field set, so the app fell back to a simpler ad lookup response.",
              ]
            : [],
      };
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Could not load TikTok ads for this advertiser.");
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

  return {
    creatorLabel: args.creatorLabel.trim() || "Spark item set",
    advertiserId,
    metric,
    startDate: toDateOnlyString(startDate),
    endDate: toDateOnlyString(endDate),
    paidViews,
    matchedAds: buildMatchedAdSummaries({
      rows: scopedRows,
    }),
    matchedSparkItemIds: itemIds,
    matchedAdIds: uniqueNonEmptyStrings(scopedRows.map((row) => row.adId)),
    resolvedIdentities: [],
    discoveryMode: "manual_item_ids",
    rowCount: scopedRows.length,
    rows: scopedRows,
    warnings: rowsIncludeItemIds
      ? report.warnings
      : [
          ...report.warnings,
          "TikTok report rows did not include item_id, so the total depends entirely on TikTok's server-side filter.",
        ],
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
    }),
    matchedSparkItemIds,
    matchedAdIds: adIds,
    resolvedIdentities: identityResolution.identities.map(formatIdentityLabel),
    discoveryMode: "creator_discovery",
    rowCount: scopedRows.length,
    rows: scopedRows,
    warnings: [
      ...identityResolution.warnings,
      ...advertiserAds.warnings,
      ...matchedAds.warnings,
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
    ],
  };
}
