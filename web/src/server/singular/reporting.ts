import { getSingularEnv, hasSingularEnv } from "@/lib/server-env";

import {
  SingularApiError,
  singularClient,
  type SingularCreateAsyncReportArgs,
  type SingularFilterDimension,
} from "./client";

const MAX_SINGULAR_REPORT_RANGE_DAYS = 30;
const SINGULAR_SOURCE_CACHE_TTL_MS = 60 * 60 * 1_000;
const SINGULAR_REPORT_CACHE_TTL_MS = 15 * 60 * 1_000;
const SINGULAR_PENDING_REPORT_TTL_MS = 30 * 60 * 1_000;
const SINGULAR_STATUS_POLL_INTERVAL_MS = 3_000;
const SINGULAR_INITIAL_REPORT_WAIT_MS = 6_000;
const SINGULAR_REPORT_DIMENSIONS = [
  "app",
  "source",
  "unified_campaign_id",
  "unified_campaign_name",
  "sub_campaign_id",
  "sub_campaign_name",
  "adn_creative_id",
  "adn_creative_name",
  "tiktok_post_id",
] as const;
const SINGULAR_REPORT_METRICS = [
  "adn_cost",
  "custom_installs",
  "tracker_conversions",
] as const;
// Singular's revenue cohort metric is already proceeds for this app.
const SINGULAR_SOURCE_REVENUE_COHORT_METRIC = "revenue";

type CachedValue<T> = {
  expiresAt: number;
  value: T;
};

type SingularPendingReportCacheEntry = {
  kind: "pending";
  expiresAt: number;
  reportId: string;
  query: SingularCreateAsyncReportArgs;
  sourceNames: string[];
  appNames: string[];
  cohortPeriod: string;
  lastPolledAt: number;
};

type SingularReadyReportCacheEntry = {
  kind: "ready";
  expiresAt: number;
  value: TikTokSingularOverlay;
};

type SingularReportCacheEntry =
  | SingularPendingReportCacheEntry
  | SingularReadyReportCacheEntry;

export type SingularSourceRevenuePoint = {
  date: string | null;
  revenue: number;
  spend: number;
};

export type SingularSourceRevenueRow = {
  source: string | null;
  label: string;
  currency: string | null;
  spend: number;
  revenue: number;
  revenueAvailable: boolean;
  installs: number;
  conversions: number;
  points: SingularSourceRevenuePoint[];
};

export type SingularSourceRevenueReport = {
  configured: boolean;
  isPending: boolean;
  cohortPeriod: string;
  cohortMetric: string;
  rowCount: number;
  totalRevenue: number;
  rows: SingularSourceRevenueRow[];
  warnings: string[];
};

type SingularSourceRevenuePendingCacheEntry = {
  kind: "pending";
  expiresAt: number;
  reportId: string;
  query: SingularCreateAsyncReportArgs;
  appNames: string[];
  cohortPeriod: string;
  cohortMetric: string;
  lastPolledAt: number;
};

type SingularSourceRevenueReadyCacheEntry = {
  kind: "ready";
  expiresAt: number;
  value: SingularSourceRevenueReport;
};

type SingularSourceRevenueCacheEntry =
  | SingularSourceRevenuePendingCacheEntry
  | SingularSourceRevenueReadyCacheEntry;

const singularSourceCache = new Map<string, CachedValue<string[]>>();
const singularReportCache = new Map<string, SingularReportCacheEntry>();
const singularSourceRevenueReportCache = new Map<
  string,
  SingularSourceRevenueCacheEntry
>();

export type TikTokSingularReportRow = {
  rowKey: string;
  app: string | null;
  source: string | null;
  campaignId: string | null;
  campaignName: string | null;
  subCampaignId: string | null;
  subCampaignName: string | null;
  creativeId: string | null;
  creativeName: string | null;
  tiktokPostId: string | null;
  creativeUrl: string | null;
  creativeImage: string | null;
  creativeIsVideo: boolean | null;
  currency: string | null;
  spend: number;
  revenue: number;
  revenueAvailable: boolean;
  installs: number;
  conversions: number;
  roas: number | null;
  raw: Record<string, unknown>;
};

export type TikTokSingularOverlay = {
  configured: boolean;
  isPending: boolean;
  cohortPeriod: string;
  sourceNames: string[];
  rowCount: number;
  rows: TikTokSingularReportRow[];
  warnings: string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readCachedValue<T>(cache: Map<string, CachedValue<T>>, key: string) {
  const cached = cache.get(key);

  if (!cached) {
    return null;
  }

  if (cached.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }

  return cached.value;
}

function writeCachedValue<T>(
  cache: Map<string, CachedValue<T>>,
  key: string,
  value: T,
  ttlMs: number,
) {
  cache.set(key, {
    value,
    expiresAt: Date.now() + ttlMs,
  });
}

function getEmptyTikTokSingularOverlay(args?: {
  configured?: boolean;
  isPending?: boolean;
  cohortPeriod?: string;
  sourceNames?: string[];
  warnings?: string[];
}): TikTokSingularOverlay {
  return {
    configured: args?.configured ?? false,
    isPending: args?.isPending ?? false,
    cohortPeriod: args?.cohortPeriod ?? "7d",
    sourceNames: args?.sourceNames ?? [],
    rowCount: 0,
    rows: [],
    warnings: args?.warnings ?? [],
  };
}

function getEmptySingularSourceRevenueReport(args?: {
  configured?: boolean;
  isPending?: boolean;
  cohortPeriod?: string;
  cohortMetric?: string;
  warnings?: string[];
}): SingularSourceRevenueReport {
  return {
    configured: args?.configured ?? false,
    isPending: args?.isPending ?? false,
    cohortPeriod: args?.cohortPeriod ?? "7d",
    cohortMetric: args?.cohortMetric ?? SINGULAR_SOURCE_REVENUE_COHORT_METRIC,
    rowCount: 0,
    totalRevenue: 0,
    rows: [],
    warnings: args?.warnings ?? [],
  };
}

function splitCommaSeparatedList(value: string | undefined) {
  return (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function uniqueNonEmptyStrings(values: ReadonlyArray<string | null | undefined>) {
  return [...new Set(values.map((value) => value?.trim()).filter(Boolean) as string[])];
}

function getInclusiveDateRangeDays(startDate: string, endDate: string) {
  const start = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);
  return Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1;
}

function getFirstString(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];

    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }

    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }

  return null;
}

function getFirstMeaningfulString(record: Record<string, unknown>, keys: string[]) {
  const value = getFirstString(record, keys);
  const normalized = value?.trim() ?? "";

  if (!normalized || ["n/a", "na", "none", "null", "unknown"].includes(normalized.toLowerCase())) {
    return null;
  }

  return normalized;
}

function getFirstNumber(record: Record<string, unknown>, keys: string[]) {
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

  return 0;
}

function getFirstBoolean(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];

    if (typeof value === "boolean") {
      return value;
    }

    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();

      if (normalized === "true") {
        return true;
      }

      if (normalized === "false") {
        return false;
      }
    }
  }

  return null;
}

function normalizeCohortPeriod(period: string) {
  return period.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_");
}

function getCohortMetricKeys(metric: string, period: string) {
  const normalizedMetric = normalizeCohortPeriod(metric);
  const normalizedPeriod = normalizeCohortPeriod(period);
  return uniqueNonEmptyStrings([
    `${normalizedMetric}_${normalizedPeriod}`,
    normalizedPeriod === "actual" ? `${normalizedMetric}_actual` : null,
    normalizedPeriod === "ltv" ? `${normalizedMetric}_ltv` : null,
    normalizedMetric,
  ]);
}

function getNestedNumber(
  record: Record<string, unknown>,
  key: string,
  nestedKeys: string[],
) {
  const nestedValue = record[key];

  if (!isRecord(nestedValue)) {
    return null;
  }

  for (const nestedKey of nestedKeys) {
    const value = nestedValue[nestedKey];
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

  return null;
}

function getFirstOptionalNumber(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    if (!(key in record)) {
      continue;
    }

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

  return null;
}

function getCohortMetricValue(
  record: Record<string, unknown>,
  metric: string,
  period: string,
) {
  const directRevenue = getFirstOptionalNumber(
    record,
    getCohortMetricKeys(metric, period),
  );

  if (directRevenue !== null) {
    return {
      available: true,
      value: directRevenue,
    };
  }

  const normalizedPeriod = normalizeCohortPeriod(period);
  const nestedRevenue = getNestedNumber(
    record,
    normalizeCohortPeriod(metric),
    uniqueNonEmptyStrings([period.trim(), normalizedPeriod]),
  );

  return {
    available: nestedRevenue !== null,
    value: nestedRevenue ?? 0,
  };
}

function getRevenueValue(record: Record<string, unknown>, period: string) {
  return getCohortMetricValue(record, "revenue", period);
}

function toDateOnlyString(value: Date) {
  return value.toISOString().slice(0, 10);
}

function normalizeDateOnly(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }

  if (typeof value !== "string" && typeof value !== "number") {
    return null;
  }

  const stringValue = String(value).trim();
  const directMatch = stringValue.match(/^(\d{4}-\d{2}-\d{2})/);

  if (directMatch?.[1]) {
    return directMatch[1];
  }

  const parsed = new Date(stringValue);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

function getReportRowDate(record: Record<string, unknown>) {
  for (const key of [
    "date",
    "start_date",
    "end_date",
    "cohort_date",
    "install_date",
    "event_date",
  ]) {
    const date = normalizeDateOnly(record[key]);

    if (date) {
      return date;
    }
  }

  return null;
}

function splitDateRangeIntoChunks(args: {
  startDate: string;
  endDate: string;
  maxDaysInclusive: number;
}) {
  const chunks: Array<{
    startDate: string;
    endDate: string;
  }> = [];
  const finalDate = new Date(`${args.endDate}T00:00:00.000Z`);
  let cursor = new Date(`${args.startDate}T00:00:00.000Z`);

  while (cursor <= finalDate) {
    const chunkStart = new Date(cursor);
    const chunkEnd = new Date(cursor);
    chunkEnd.setUTCDate(chunkEnd.getUTCDate() + args.maxDaysInclusive - 1);

    if (chunkEnd > finalDate) {
      chunkEnd.setTime(finalDate.getTime());
    }

    chunks.push({
      startDate: toDateOnlyString(chunkStart),
      endDate: toDateOnlyString(chunkEnd),
    });

    cursor = new Date(chunkEnd);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return chunks;
}

function mergeTikTokSingularOverlays(overlays: TikTokSingularOverlay[]) {
  const firstOverlay = overlays[0];

  if (!firstOverlay) {
    return getEmptyTikTokSingularOverlay();
  }

  const rows = overlays.flatMap((overlay) => overlay.rows);

  return {
    configured: overlays.some((overlay) => overlay.configured),
    isPending: overlays.some((overlay) => overlay.isPending),
    cohortPeriod: firstOverlay.cohortPeriod,
    sourceNames: firstOverlay.sourceNames,
    rowCount: rows.length,
    rows,
    warnings: normalizeSingularWarnings(overlays.flatMap((overlay) => overlay.warnings)),
  };
}

function buildRowKey(record: TikTokSingularReportRow) {
  const creativeKey = record.creativeId
    ? `creative:${record.creativeId}`
    : record.tiktokPostId
      ? `post:${record.tiktokPostId}`
      : record.creativeName
        ? `name:${record.creativeName}`
        : record.creativeUrl
          ? `url:${record.creativeUrl}`
          : "";

  return [
    record.source,
    record.app,
    record.campaignId,
    record.subCampaignId,
    creativeKey,
  ]
    .map((value) => value?.trim() || "")
    .join("::");
}

function normalizeReportRow(record: Record<string, unknown>, cohortPeriod: string) {
  const spend = getFirstNumber(record, ["adn_cost"]);
  const revenue = getRevenueValue(record, cohortPeriod);
  const installs = getFirstNumber(record, ["custom_installs", "tracker_installs", "adn_installs"]);
  const conversions = getFirstNumber(record, ["tracker_conversions"]);

  const normalizedRow: TikTokSingularReportRow = {
    rowKey: "",
    app: getFirstString(record, ["app"]),
    source: getFirstString(record, ["source"]),
    campaignId: getFirstString(record, [
      "unified_campaign_id",
      "adn_campaign_id",
      "tracker_campaign_id",
    ]),
    campaignName: getFirstString(record, [
      "unified_campaign_name",
      "adn_campaign_name",
      "tracker_campaign_name",
    ]),
    subCampaignId: getFirstString(record, ["sub_campaign_id", "adn_sub_campaign_id"]),
    subCampaignName: getFirstString(record, ["sub_campaign_name", "adn_sub_campaign_name"]),
    creativeId: getFirstString(record, ["adn_creative_id", "asset_id"]),
    creativeName: getFirstString(record, ["adn_creative_name", "asset_name"]),
    tiktokPostId: getFirstMeaningfulString(record, ["tiktok_post_id"]),
    creativeUrl: getFirstString(record, ["creative_reported_url", "creative_url"]),
    creativeImage: getFirstString(record, ["creative_image"]),
    creativeIsVideo: getFirstBoolean(record, ["creative_is_video"]),
    currency: getFirstString(record, ["adn_original_currency"]),
    spend,
    revenue: revenue.value,
    revenueAvailable: revenue.available,
    installs,
    conversions,
    roas: spend > 0 && revenue.available ? revenue.value / spend : null,
    raw: record,
  };

  normalizedRow.rowKey = buildRowKey(normalizedRow);
  return normalizedRow;
}

function extractReportRows(payload: unknown) {
  if (Array.isArray(payload)) {
    return payload.filter(isRecord);
  }

  if (!isRecord(payload)) {
    return [];
  }

  const directResults = payload.results;

  if (Array.isArray(directResults)) {
    return directResults.filter(isRecord);
  }

  const directRows = payload.rows;

  if (Array.isArray(directRows)) {
    return directRows.filter(isRecord);
  }

  const directData = payload.data;

  if (Array.isArray(directData)) {
    return directData.filter(isRecord);
  }

  const nestedValue = payload.value;

  if (isRecord(nestedValue)) {
    const nestedResults = nestedValue.results;

    if (Array.isArray(nestedResults)) {
      return nestedResults.filter(isRecord);
    }

    const nestedRows = nestedValue.rows;

    if (Array.isArray(nestedRows)) {
      return nestedRows.filter(isRecord);
    }
  }

  return [];
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readReportCache(key: string) {
  const cached = singularReportCache.get(key);

  if (!cached) {
    return null;
  }

  if (cached.expiresAt <= Date.now()) {
    singularReportCache.delete(key);
    return null;
  }

  return cached;
}

function buildReportCacheKey(args: {
  startDate: string;
  endDate: string;
  cohortPeriod: string;
  sourceNames: string[];
  appNames: string[];
}) {
  return [
    args.startDate,
    args.endDate,
    args.cohortPeriod,
    args.sourceNames.join(","),
    args.appNames.join(","),
  ].join("|");
}

function buildSourceRevenueReportCacheKey(args: {
  startDate: string;
  endDate: string;
  cohortPeriod: string;
  cohortMetric: string;
  appNames: string[];
}) {
  return [
    "source-revenue",
    args.startDate,
    args.endDate,
    args.cohortPeriod,
    args.cohortMetric,
    args.appNames.join(","),
  ].join("|");
}

function buildSourceCacheKey() {
  const env = getSingularEnv();
  return `${env.SINGULAR_API_BASE_URL}|${env.SINGULAR_SOURCE_NAMES ?? ""}`;
}

async function resolveTikTokSourceNamesFromFilters(dimensions: SingularFilterDimension[]) {
  const sourceDimension = dimensions.find(
    (dimension) => dimension.name?.trim().toLowerCase() === "source",
  );

  if (!sourceDimension?.values?.length) {
    return [];
  }

  return uniqueNonEmptyStrings(
    sourceDimension.values.flatMap((value) => {
      const name =
        typeof value.name === "string" || typeof value.name === "number"
          ? String(value.name)
          : null;
      const displayName = value.display_name ?? null;
      const haystack = [name, displayName]
        .filter((entry): entry is string => Boolean(entry))
        .join(" ")
        .toLowerCase();

      return /tik\s*tok/.test(haystack) ? [name ?? displayName] : [];
    }),
  );
}

async function getTikTokSourceNames() {
  const env = getSingularEnv();
  const configuredSourceNames = splitCommaSeparatedList(env.SINGULAR_SOURCE_NAMES);

  if (configuredSourceNames.length > 0) {
    return configuredSourceNames;
  }

  const cacheKey = buildSourceCacheKey();
  const cached = readCachedValue(singularSourceCache, cacheKey);

  if (cached) {
    return cached;
  }

  const filters = await singularClient.getFilters();
  const resolvedSourceNames = await resolveTikTokSourceNamesFromFilters(filters.dimensions ?? []);
  writeCachedValue(singularSourceCache, cacheKey, resolvedSourceNames, SINGULAR_SOURCE_CACHE_TTL_MS);
  return resolvedSourceNames;
}

function buildSingularReportQuery(args: {
  startDate: string;
  endDate: string;
  cohortPeriod: string;
  sourceNames: string[];
  appNames: string[];
  dimensions?: string[];
}): SingularCreateAsyncReportArgs {
  return {
    startDate: args.startDate,
    endDate: args.endDate,
    timeBreakdown: "all",
    sourceNames: args.sourceNames,
    appNames: args.appNames,
    dimensions: args.dimensions ? [...args.dimensions] : [...SINGULAR_REPORT_DIMENSIONS],
    metrics: [...SINGULAR_REPORT_METRICS],
    cohortMetrics: ["revenue"],
    cohortPeriods: [args.cohortPeriod],
    displayUnenriched: true,
    format: "json",
  };
}

function buildSingularSourceRevenueReportQuery(args: {
  startDate: string;
  endDate: string;
  cohortPeriod: string;
  cohortMetric: string;
  appNames: string[];
}): SingularCreateAsyncReportArgs {
  return {
    startDate: args.startDate,
    endDate: args.endDate,
    timeBreakdown: "day",
    appNames: args.appNames,
    dimensions: ["source"],
    metrics: [...SINGULAR_REPORT_METRICS],
    cohortMetrics: [args.cohortMetric],
    cohortPeriods: [args.cohortPeriod],
    displayUnenriched: true,
    format: "json",
  };
}

function getUnauthorizedDimensionsFromError(error: unknown) {
  if (!(error instanceof SingularApiError || error instanceof Error)) {
    return [];
  }

  const match = error.message.match(/unauthorized dimensions:\s*([^\n\r]+)/i);

  if (!match?.[1]) {
    return [];
  }

  return uniqueNonEmptyStrings(
    match[1]
      .split(",")
      .map((value) => value.trim())
      .filter((value) => value.length > 0),
  );
}

function normalizeSingularWarnings(warnings: string[]) {
  return uniqueNonEmptyStrings(
    warnings.map((warning) => {
      const unauthorizedDimensions = getUnauthorizedDimensionsFromError(
        new Error(warning),
      );

      if (unauthorizedDimensions.length === 0) {
        return warning;
      }

      return `Singular does not allow the requested dimensions (${unauthorizedDimensions.join(", ")}) for this API key, so the dashboard is loading aggregate performance without those columns.`;
    }),
  );
}

function normalizeSourceRevenueLabel(source: string | null) {
  const label = source?.trim();
  return label && label.length > 0 ? label : "Unattributed / organic";
}

function normalizeSourceRevenueReportRow(
  record: Record<string, unknown>,
  cohortPeriod: string,
  cohortMetric: string,
): SingularSourceRevenueRow {
  const source = getFirstMeaningfulString(record, ["source"]);
  const revenue = getCohortMetricValue(record, cohortMetric, cohortPeriod);

  return {
    source,
    label: normalizeSourceRevenueLabel(source),
    currency: getFirstString(record, ["adn_original_currency"]),
    spend: getFirstNumber(record, ["adn_cost"]),
    revenue: revenue.value,
    revenueAvailable: revenue.available,
    installs: getFirstNumber(record, [
      "custom_installs",
      "tracker_installs",
      "adn_installs",
    ]),
    conversions: getFirstNumber(record, ["tracker_conversions"]),
    points: [
      {
        date: getReportRowDate(record),
        revenue: revenue.value,
        spend: getFirstNumber(record, ["adn_cost"]),
      },
    ],
  };
}

function buildSourceRevenueRowKey(row: SingularSourceRevenueRow) {
  return row.label.trim().toLowerCase();
}

function aggregateSingularSourceRevenueRows(rows: SingularSourceRevenueRow[]) {
  const grouped = new Map<string, SingularSourceRevenueRow>();

  for (const row of rows) {
    const key = buildSourceRevenueRowKey(row);
    const existing = grouped.get(key);

    if (existing) {
      existing.spend += row.spend;
      existing.revenue += row.revenue;
      existing.revenueAvailable ||= row.revenueAvailable;
      existing.installs += row.installs;
      existing.conversions += row.conversions;
      existing.points.push(...row.points);
      existing.currency = existing.currency === row.currency ? existing.currency : null;
      continue;
    }

    grouped.set(key, {
      ...row,
      points: [...row.points],
    });
  }

  return [...grouped.values()]
    .map((row) => ({
      ...row,
      points: aggregateSourceRevenuePoints(row.points),
    }))
    .sort((left, right) => right.revenue - left.revenue || left.label.localeCompare(right.label));
}

function aggregateSourceRevenuePoints(points: SingularSourceRevenuePoint[]) {
  const grouped = new Map<string, { revenue: number; spend: number }>();
  const undatedPoints: SingularSourceRevenuePoint[] = [];

  for (const point of points) {
    if (!point.date) {
      undatedPoints.push(point);
      continue;
    }

    const existing = grouped.get(point.date) ?? { revenue: 0, spend: 0 };
    existing.revenue += point.revenue;
    existing.spend += point.spend;
    grouped.set(point.date, existing);
  }

  return [
    ...[...grouped.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([date, value]) => ({
        date,
        revenue: value.revenue,
        spend: value.spend,
      })),
    ...undatedPoints,
  ];
}

function mergeSingularSourceRevenueReports(
  reports: SingularSourceRevenueReport[],
) {
  const firstReport = reports[0];

  if (!firstReport) {
    return getEmptySingularSourceRevenueReport();
  }

  const rows = aggregateSingularSourceRevenueRows(
    reports.flatMap((report) => report.rows),
  );

  return {
    configured: reports.some((report) => report.configured),
    isPending: reports.some((report) => report.isPending),
    cohortPeriod: firstReport.cohortPeriod,
    cohortMetric: firstReport.cohortMetric,
    rowCount: rows.length,
    totalRevenue: rows.reduce((total, row) => total + row.revenue, 0),
    rows,
    warnings: normalizeSingularWarnings(reports.flatMap((report) => report.warnings)),
  };
}

async function getTikTokSingularOverlayForRange(args: {
  startDate: string;
  endDate: string;
  cohortPeriod: string;
  sourceNames: string[];
  appNames: string[];
}): Promise<TikTokSingularOverlay> {
  const cacheKey = buildReportCacheKey({
    startDate: args.startDate,
    endDate: args.endDate,
    cohortPeriod: args.cohortPeriod,
    sourceNames: args.sourceNames,
    appNames: args.appNames,
  });
  const cached = readReportCache(cacheKey);

  if (cached?.kind === "ready") {
    return cached.value;
  }

  if (cached?.kind === "pending") {
    return completePendingReport(cacheKey, cached);
  }

  let allowedDimensions = [...SINGULAR_REPORT_DIMENSIONS];
  const retryWarnings: string[] = [];

  while (allowedDimensions.length > 0) {
    const query = buildSingularReportQuery({
      startDate: args.startDate,
      endDate: args.endDate,
      cohortPeriod: args.cohortPeriod,
      sourceNames: args.sourceNames,
      appNames: args.appNames,
      dimensions: allowedDimensions,
    });

    try {
      const reportId = await singularClient.createAsyncReport(query);
      const pendingEntry: SingularPendingReportCacheEntry = {
        kind: "pending",
        expiresAt: Date.now() + SINGULAR_PENDING_REPORT_TTL_MS,
        reportId,
        query,
        sourceNames: args.sourceNames,
        appNames: args.appNames,
        cohortPeriod: args.cohortPeriod,
        lastPolledAt: Date.now(),
      };

      singularReportCache.set(cacheKey, pendingEntry);

      await sleep(SINGULAR_INITIAL_REPORT_WAIT_MS);

      const overlay = await pollPendingReport(cacheKey, {
        ...pendingEntry,
        lastPolledAt: 0,
      });

      return {
        ...overlay,
        warnings: normalizeSingularWarnings([
          ...retryWarnings,
          ...overlay.warnings,
        ]),
      };
    } catch (error) {
      const unauthorizedDimensions = getUnauthorizedDimensionsFromError(error);

      if (unauthorizedDimensions.length > 0) {
        const nextDimensions = allowedDimensions.filter(
          (dimension) => !unauthorizedDimensions.includes(dimension),
        );

        if (nextDimensions.length > 0 && nextDimensions.length < allowedDimensions.length) {
          retryWarnings.push(
            `Singular denied ${unauthorizedDimensions.join(", ")} for this API key, so the creative fallback retried without those dimensions.`,
          );
          allowedDimensions = nextDimensions;
          continue;
        }
      }

      singularReportCache.delete(cacheKey);

      return getEmptyTikTokSingularOverlay({
        configured: true,
        cohortPeriod: args.cohortPeriod,
        sourceNames: args.sourceNames,
        warnings: normalizeSingularWarnings([
          ...retryWarnings,
          error instanceof SingularApiError || error instanceof Error
            ? error.message
            : "Could not load Singular reporting for this date window.",
        ]),
      });
    }
  }

  singularReportCache.delete(cacheKey);

  return getEmptyTikTokSingularOverlay({
    configured: true,
    cohortPeriod: args.cohortPeriod,
    sourceNames: args.sourceNames,
    warnings: normalizeSingularWarnings([
      ...retryWarnings,
      "Singular denied all requested creative dimensions for this API key.",
    ]),
  });
}

async function completePendingReport(
  cacheKey: string,
  entry: SingularPendingReportCacheEntry,
): Promise<TikTokSingularOverlay> {
  if (Date.now() - entry.lastPolledAt < SINGULAR_STATUS_POLL_INTERVAL_MS) {
    return getEmptyTikTokSingularOverlay({
      configured: true,
      isPending: true,
      cohortPeriod: entry.cohortPeriod,
      sourceNames: entry.sourceNames,
      warnings: [
        "Singular is still preparing the report for this date window. This page will check again automatically.",
      ],
    });
  }

  return pollPendingReport(cacheKey, entry);
}

async function pollPendingReport(
  cacheKey: string,
  entry: SingularPendingReportCacheEntry,
): Promise<TikTokSingularOverlay> {

  if (entry.expiresAt <= Date.now()) {
    singularReportCache.delete(cacheKey);

    return getEmptyTikTokSingularOverlay({
      configured: true,
      cohortPeriod: entry.cohortPeriod,
      sourceNames: entry.sourceNames,
      warnings: [
        "The pending Singular report expired before it finished. Submit the lookup again to start a fresh report.",
      ],
    });
  }

  const status = await singularClient.getReportStatus(entry.reportId);

  if (status.status === "DONE" && status.download_url) {
    const payload = await singularClient.downloadReport(status.download_url);
    const rows = extractReportRows(payload)
      .map((record) => normalizeReportRow(record, entry.cohortPeriod))
      .filter(
        (row) =>
          row.spend > 0 ||
          row.revenue > 0 ||
          row.installs > 0 ||
          row.conversions > 0 ||
          Boolean(row.creativeId || row.creativeName),
      );

    const overlay: TikTokSingularOverlay = {
      configured: true,
      isPending: false,
      cohortPeriod: entry.cohortPeriod,
      sourceNames: entry.sourceNames,
      rowCount: rows.length,
      rows,
      warnings: [],
    };

    singularReportCache.set(cacheKey, {
      kind: "ready",
      expiresAt: Date.now() + SINGULAR_REPORT_CACHE_TTL_MS,
      value: overlay,
    });

    return overlay;
  }

  if (status.status === "FAILED") {
    singularReportCache.delete(cacheKey);

    return getEmptyTikTokSingularOverlay({
      configured: true,
      cohortPeriod: entry.cohortPeriod,
      sourceNames: entry.sourceNames,
      warnings: [
        status.error ??
          status.error_message ??
          status.message ??
          "Singular failed to prepare the creative report for this date window.",
      ],
    });
  }

  singularReportCache.set(cacheKey, {
    ...entry,
    lastPolledAt: Date.now(),
  });

  return getEmptyTikTokSingularOverlay({
    configured: true,
    isPending: true,
    cohortPeriod: entry.cohortPeriod,
    sourceNames: entry.sourceNames,
    warnings: [
      `Singular report status is ${status.status?.toLowerCase() ?? "pending"}. This page will check again automatically and reuse the export once it is ready.`,
    ],
  });
}

async function getSingularSourceRevenueReportForRange(args: {
  startDate: string;
  endDate: string;
  cohortPeriod: string;
  cohortMetric: string;
  appNames: string[];
}): Promise<SingularSourceRevenueReport> {
  const cacheKey = buildSourceRevenueReportCacheKey({
    startDate: args.startDate,
    endDate: args.endDate,
    cohortPeriod: args.cohortPeriod,
    cohortMetric: args.cohortMetric,
    appNames: args.appNames,
  });
  const cached = singularSourceRevenueReportCache.get(cacheKey);

  if (cached?.kind === "ready" && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  if (cached?.kind === "pending" && cached.expiresAt > Date.now()) {
    return completePendingSourceRevenueReport(cacheKey, cached);
  }

  const query = buildSingularSourceRevenueReportQuery({
    startDate: args.startDate,
    endDate: args.endDate,
    cohortPeriod: args.cohortPeriod,
    cohortMetric: args.cohortMetric,
    appNames: args.appNames,
  });

  try {
    const reportId = await singularClient.createAsyncReport(query);
    const pendingEntry: SingularSourceRevenuePendingCacheEntry = {
      kind: "pending",
      expiresAt: Date.now() + SINGULAR_PENDING_REPORT_TTL_MS,
      reportId,
      query,
      appNames: args.appNames,
      cohortPeriod: args.cohortPeriod,
      cohortMetric: args.cohortMetric,
      lastPolledAt: Date.now(),
    };

    singularSourceRevenueReportCache.set(cacheKey, pendingEntry);

    await sleep(SINGULAR_INITIAL_REPORT_WAIT_MS);

    return pollPendingSourceRevenueReport(cacheKey, {
      ...pendingEntry,
      lastPolledAt: 0,
    });
  } catch (error) {
    singularSourceRevenueReportCache.delete(cacheKey);

    return getEmptySingularSourceRevenueReport({
      configured: true,
      cohortPeriod: args.cohortPeriod,
      cohortMetric: args.cohortMetric,
      warnings: normalizeSingularWarnings([
        error instanceof SingularApiError || error instanceof Error
          ? error.message
          : "Could not load Singular source proceeds for this date window.",
      ]),
    });
  }
}

async function completePendingSourceRevenueReport(
  cacheKey: string,
  entry: SingularSourceRevenuePendingCacheEntry,
): Promise<SingularSourceRevenueReport> {
  if (Date.now() - entry.lastPolledAt < SINGULAR_STATUS_POLL_INTERVAL_MS) {
    return getEmptySingularSourceRevenueReport({
      configured: true,
      isPending: true,
      cohortPeriod: entry.cohortPeriod,
      cohortMetric: entry.cohortMetric,
      warnings: [
        "Singular is still preparing the source proceeds report for this date window. This page will check again automatically.",
      ],
    });
  }

  return pollPendingSourceRevenueReport(cacheKey, entry);
}

async function pollPendingSourceRevenueReport(
  cacheKey: string,
  entry: SingularSourceRevenuePendingCacheEntry,
): Promise<SingularSourceRevenueReport> {
  if (entry.expiresAt <= Date.now()) {
    singularSourceRevenueReportCache.delete(cacheKey);

    return getEmptySingularSourceRevenueReport({
      configured: true,
      cohortPeriod: entry.cohortPeriod,
      cohortMetric: entry.cohortMetric,
      warnings: [
        "The pending Singular source proceeds report expired before it finished. Refresh again to start a fresh report.",
      ],
    });
  }

  const status = await singularClient.getReportStatus(entry.reportId);

  if (status.status === "DONE" && status.download_url) {
    const payload = await singularClient.downloadReport(status.download_url);
    const rows = aggregateSingularSourceRevenueRows(
      extractReportRows(payload)
        .map((record) =>
          normalizeSourceRevenueReportRow(
            record,
            entry.cohortPeriod,
            entry.cohortMetric,
          ),
        )
        .filter(
          (row) =>
            row.spend > 0 ||
            row.revenue > 0 ||
            row.installs > 0 ||
            row.conversions > 0,
        ),
    );
    const report: SingularSourceRevenueReport = {
      configured: true,
      isPending: false,
      cohortPeriod: entry.cohortPeriod,
      cohortMetric: entry.cohortMetric,
      rowCount: rows.length,
      totalRevenue: rows.reduce((total, row) => total + row.revenue, 0),
      rows,
      warnings: rows.some((row) => row.revenueAvailable)
        ? []
        : [
            `Singular returned source rows, but ${entry.cohortPeriod} ${entry.cohortMetric} is not ready for this date window yet.`,
          ],
    };

    singularSourceRevenueReportCache.set(cacheKey, {
      kind: "ready",
      expiresAt: Date.now() + SINGULAR_REPORT_CACHE_TTL_MS,
      value: report,
    });

    return report;
  }

  if (status.status === "FAILED") {
    singularSourceRevenueReportCache.delete(cacheKey);

    return getEmptySingularSourceRevenueReport({
      configured: true,
      cohortPeriod: entry.cohortPeriod,
      cohortMetric: entry.cohortMetric,
      warnings: [
        status.error ??
          status.error_message ??
          status.message ??
          "Singular failed to prepare the source proceeds report for this date window.",
      ],
    });
  }

  singularSourceRevenueReportCache.set(cacheKey, {
    ...entry,
    lastPolledAt: Date.now(),
  });

  return getEmptySingularSourceRevenueReport({
    configured: true,
    isPending: true,
    cohortPeriod: entry.cohortPeriod,
    cohortMetric: entry.cohortMetric,
    warnings: [
      `Singular source proceeds report status is ${status.status?.toLowerCase() ?? "pending"}. This page will check again automatically.`,
    ],
  });
}

export async function getSingularSourceRevenueReport(args: {
  startDate: string;
  endDate: string;
}): Promise<SingularSourceRevenueReport> {
  if (!hasSingularEnv()) {
    return getEmptySingularSourceRevenueReport();
  }

  const env = getSingularEnv();
  const appNames = splitCommaSeparatedList(env.SINGULAR_APP_NAMES);
  const cohortMetric = SINGULAR_SOURCE_REVENUE_COHORT_METRIC;
  const rangeDays = getInclusiveDateRangeDays(args.startDate, args.endDate);
  const dateChunks =
    rangeDays > MAX_SINGULAR_REPORT_RANGE_DAYS
      ? splitDateRangeIntoChunks({
          startDate: args.startDate,
          endDate: args.endDate,
          maxDaysInclusive: MAX_SINGULAR_REPORT_RANGE_DAYS,
        })
      : [{ startDate: args.startDate, endDate: args.endDate }];
  const reports: SingularSourceRevenueReport[] = [];

  for (const chunk of dateChunks) {
    reports.push(
      await getSingularSourceRevenueReportForRange({
        startDate: chunk.startDate,
        endDate: chunk.endDate,
        cohortPeriod: env.SINGULAR_COHORT_PERIOD,
        cohortMetric,
        appNames,
      }),
    );
  }

  return mergeSingularSourceRevenueReports(reports);
}

export async function getTikTokSingularOverlay(args: {
  startDate: string;
  endDate: string;
}): Promise<TikTokSingularOverlay> {
  if (!hasSingularEnv()) {
    return getEmptyTikTokSingularOverlay();
  }

  const env = getSingularEnv();
  const appNames = splitCommaSeparatedList(env.SINGULAR_APP_NAMES);
  let sourceNames: string[];

  try {
    sourceNames = await getTikTokSourceNames();
  } catch (error) {
    return getEmptyTikTokSingularOverlay({
      configured: true,
      cohortPeriod: env.SINGULAR_COHORT_PERIOD,
      warnings: normalizeSingularWarnings([
        error instanceof SingularApiError || error instanceof Error
          ? error.message
          : "Could not resolve TikTok sources from Singular filters.",
      ]),
    });
  }

  if (sourceNames.length === 0) {
    return getEmptyTikTokSingularOverlay({
      configured: true,
      cohortPeriod: env.SINGULAR_COHORT_PERIOD,
      warnings: [
        "Singular is configured, but no TikTok-like source names were discovered. Set SINGULAR_SOURCE_NAMES if your account uses a custom source label.",
      ],
    });
  }

  const rangeDays = getInclusiveDateRangeDays(args.startDate, args.endDate);
  const dateChunks =
    rangeDays > MAX_SINGULAR_REPORT_RANGE_DAYS
      ? splitDateRangeIntoChunks({
          startDate: args.startDate,
          endDate: args.endDate,
          maxDaysInclusive: MAX_SINGULAR_REPORT_RANGE_DAYS,
        })
      : [{ startDate: args.startDate, endDate: args.endDate }];
  const overlays: TikTokSingularOverlay[] = [];

  for (const chunk of dateChunks) {
    overlays.push(
      await getTikTokSingularOverlayForRange({
        startDate: chunk.startDate,
        endDate: chunk.endDate,
        cohortPeriod: env.SINGULAR_COHORT_PERIOD,
        sourceNames,
        appNames,
      }),
    );
  }

  return mergeTikTokSingularOverlays(overlays);
}

export function getDefaultTikTokSingularOverlay() {
  return getEmptyTikTokSingularOverlay({
    configured: hasSingularEnv(),
    cohortPeriod: process.env.SINGULAR_COHORT_PERIOD || "7d",
  });
}
