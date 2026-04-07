import { requestTikTokBusinessApi } from "./client";

const MAX_REPORT_PAGES = 20;
const REPORT_PAGE_SIZE = 1_000;

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
  matchedSparkItemIds: string[];
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

function getTotalPages(payload: TikTokIntegratedReportData, currentRows: number) {
  const pageInfo = isRecord(payload.page_info) ? payload.page_info : null;
  const totalPages = getFirstNumber([pageInfo], ["total_page", "total_pages"]);

  if (totalPages > 0) {
    return Math.max(1, Math.trunc(totalPages));
  }

  return currentRows < REPORT_PAGE_SIZE ? 1 : MAX_REPORT_PAGES;
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
  itemIds: string[];
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
        filtering: [
          {
            field_name: "item_id",
            filter_type: "IN",
            filter_value: JSON.stringify(args.itemIds),
          },
        ],
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
      `TikTok reporting returned more than ${MAX_REPORT_PAGES} pages. The result may be truncated.`,
    );
  }

  return {
    rows,
    apiMetricName,
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
  const advertiserId = args.advertiserId.trim();
  const accessToken = args.accessToken.trim();

  if (advertiserId.length === 0) {
    throw new Error("Advertiser ID is required.");
  }

  if (accessToken.length === 0) {
    throw new Error("Access token is required.");
  }

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
    itemIds,
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
    matchedSparkItemIds: itemIds,
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
