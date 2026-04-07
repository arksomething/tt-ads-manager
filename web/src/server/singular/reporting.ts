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
const SINGULAR_STATUS_POLL_INTERVAL_MS = 10_000;

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

const singularSourceCache = new Map<string, CachedValue<string[]>>();
const singularReportCache = new Map<string, SingularReportCacheEntry>();

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
  creativeUrl: string | null;
  creativeImage: string | null;
  creativeIsVideo: boolean | null;
  currency: string | null;
  spend: number;
  revenue: number;
  installs: number;
  conversions: number;
  roas: number | null;
  raw: Record<string, unknown>;
};

export type TikTokSingularOverlay = {
  configured: boolean;
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
  cohortPeriod?: string;
  sourceNames?: string[];
  warnings?: string[];
}): TikTokSingularOverlay {
  return {
    configured: args?.configured ?? false,
    cohortPeriod: args?.cohortPeriod ?? "7d",
    sourceNames: args?.sourceNames ?? [],
    rowCount: 0,
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

function getRevenueMetricKeys(period: string) {
  const normalizedPeriod = normalizeCohortPeriod(period);
  return uniqueNonEmptyStrings([
    `revenue_${normalizedPeriod}`,
    normalizedPeriod === "actual" ? "revenue_actual" : null,
    normalizedPeriod === "ltv" ? "revenue_ltv" : null,
    "revenue",
  ]);
}

function buildRowKey(record: TikTokSingularReportRow) {
  return [
    record.source,
    record.app,
    record.campaignId,
    record.subCampaignId,
    record.creativeId,
    record.creativeName,
    record.creativeUrl,
  ]
    .map((value) => value?.trim() || "")
    .join("::");
}

function normalizeReportRow(record: Record<string, unknown>, cohortPeriod: string) {
  const spend = getFirstNumber(record, ["adn_cost"]);
  const revenue = getFirstNumber(record, getRevenueMetricKeys(cohortPeriod));
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
    creativeUrl: getFirstString(record, ["creative_url"]),
    creativeImage: getFirstString(record, ["creative_image"]),
    creativeIsVideo: getFirstBoolean(record, ["creative_is_video"]),
    currency: getFirstString(record, ["adn_original_currency"]),
    spend,
    revenue,
    installs,
    conversions,
    roas: spend > 0 ? revenue / spend : null,
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
}): SingularCreateAsyncReportArgs {
  return {
    startDate: args.startDate,
    endDate: args.endDate,
    timeBreakdown: "all",
    sourceNames: args.sourceNames,
    appNames: args.appNames,
    dimensions: [
      "app",
      "source",
      "unified_campaign_id",
      "unified_campaign_name",
      "sub_campaign_id",
      "sub_campaign_name",
      "adn_creative_id",
      "adn_creative_name",
      "creative_url",
      "creative_image",
      "creative_is_video",
      "asset_id",
      "asset_name",
    ],
    metrics: [
      "adn_cost",
      "adn_original_currency",
      "custom_installs",
      "tracker_conversions",
    ],
    cohortMetrics: ["revenue"],
    cohortPeriods: [args.cohortPeriod],
    displayUnenriched: true,
    format: "json",
  };
}

async function completePendingReport(
  cacheKey: string,
  entry: SingularPendingReportCacheEntry,
): Promise<TikTokSingularOverlay> {
  if (Date.now() - entry.lastPolledAt < SINGULAR_STATUS_POLL_INTERVAL_MS) {
    return getEmptyTikTokSingularOverlay({
      configured: true,
      cohortPeriod: entry.cohortPeriod,
      sourceNames: entry.sourceNames,
      warnings: [
        "Singular is still preparing the report for this date window. Run the same lookup again in a few seconds to reuse the in-flight report.",
      ],
    });
  }

  if (entry.expiresAt <= Date.now()) {
    singularReportCache.delete(cacheKey);

    return getEmptyTikTokSingularOverlay({
      configured: true,
      cohortPeriod: entry.cohortPeriod,
      sourceNames: entry.sourceNames,
      warnings: [
        "The pending Singular report expired before it finished. Run the lookup again to start a fresh report.",
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
    cohortPeriod: entry.cohortPeriod,
    sourceNames: entry.sourceNames,
    warnings: [
      `Singular report status is ${status.status?.toLowerCase() ?? "pending"}. Run the same lookup again in a few seconds to reuse it once the export is ready.`,
    ],
  });
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
      warnings: [
        error instanceof SingularApiError || error instanceof Error
          ? error.message
          : "Could not resolve TikTok sources from Singular filters.",
      ],
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

  if (rangeDays > MAX_SINGULAR_REPORT_RANGE_DAYS) {
    return getEmptyTikTokSingularOverlay({
      configured: true,
      cohortPeriod: env.SINGULAR_COHORT_PERIOD,
      sourceNames,
      warnings: [
        `Singular overlay currently runs on ranges up to ${MAX_SINGULAR_REPORT_RANGE_DAYS} days at a time. Narrow the date window to fetch creative-level metrics.`,
      ],
    });
  }

  const cacheKey = buildReportCacheKey({
    startDate: args.startDate,
    endDate: args.endDate,
    cohortPeriod: env.SINGULAR_COHORT_PERIOD,
    sourceNames,
    appNames,
  });
  const cached = readReportCache(cacheKey);

  if (cached?.kind === "ready") {
    return cached.value;
  }

  if (cached?.kind === "pending") {
    return completePendingReport(cacheKey, cached);
  }

  const query = buildSingularReportQuery({
    startDate: args.startDate,
    endDate: args.endDate,
    cohortPeriod: env.SINGULAR_COHORT_PERIOD,
    sourceNames,
    appNames,
  });

  try {
    const reportId = await singularClient.createAsyncReport(query);
    const pendingEntry: SingularPendingReportCacheEntry = {
      kind: "pending",
      expiresAt: Date.now() + SINGULAR_PENDING_REPORT_TTL_MS,
      reportId,
      query,
      sourceNames,
      appNames,
      cohortPeriod: env.SINGULAR_COHORT_PERIOD,
      lastPolledAt: Date.now(),
    };

    singularReportCache.set(cacheKey, pendingEntry);
    await sleep(SINGULAR_STATUS_POLL_INTERVAL_MS);

    return completePendingReport(cacheKey, {
      ...pendingEntry,
      lastPolledAt: 0,
    });
  } catch (error) {
    singularReportCache.delete(cacheKey);

    return getEmptyTikTokSingularOverlay({
      configured: true,
      cohortPeriod: env.SINGULAR_COHORT_PERIOD,
      sourceNames,
      warnings: [
        error instanceof SingularApiError || error instanceof Error
          ? error.message
          : "Could not load Singular reporting for this date window.",
      ],
    });
  }
}

export function getDefaultTikTokSingularOverlay() {
  return getEmptyTikTokSingularOverlay({
    configured: hasSingularEnv(),
    cohortPeriod: process.env.SINGULAR_COHORT_PERIOD || "7d",
  });
}
