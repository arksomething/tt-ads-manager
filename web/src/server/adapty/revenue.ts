import { getAdaptyEnv, hasAdaptyEnv } from "@/lib/server-env";

import {
  AdaptyApiError,
  adaptyClient,
  type AdaptyRevenueSegmentation,
} from "./client";

export type RevenueAttributionSourceRow = {
  label: string;
  rawLabel: string | null;
  kind: "tiktok" | "ugc" | "unattributed";
  revenue: number;
  share: number | null;
};

export type RevenueAttributionDailyRow = {
  date: string;
  total: number;
  tiktok: number | null;
  ugc: number | null;
};

export type RevenueAttributionReport = {
  configured: boolean;
  startDate: string;
  endDate: string;
  attributionDimension: AdaptyRevenueSegmentation;
  tiktokPatterns: string[];
  currency: string | null;
  totals: {
    total: number;
    tiktok: number;
    ugc: number;
    unattributed: number;
    tiktokShare: number | null;
    ugcShare: number | null;
  };
  sourceRows: RevenueAttributionSourceRow[];
  dailyRows: RevenueAttributionDailyRow[];
  hasDailySourceBreakdown: boolean;
  warnings: string[];
};

type NormalizedPoint = {
  date: string | null;
  value: number;
};

type NormalizedSeries = {
  label: string | null;
  value: number;
  points: NormalizedPoint[];
  unit: string | null;
};

type MetricContainer = {
  metric: Record<string, unknown>;
  key: string;
};

const REVENUE_NUMBER_KEYS = [
  "value",
  "revenue",
  "proceeds",
  "net_revenue",
  "amount",
  "total",
  "y",
] as const;
const SERIES_LABEL_KEYS = [
  "name",
  "title",
  "label",
  "segment",
  "segmentation",
  "attribution_source",
  "attribution_channel",
  "attribution_campaign",
  "attribution_adgroup",
  "attribution_adset",
  "attribution_creative",
] as const;
const POINT_DATE_KEYS = [
  "date",
  "period",
  "datetime",
  "timestamp",
  "time",
  "x",
] as const;
const CHILD_DATA_KEYS = ["data", "values", "points", "series", "items", "rows"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getFirstString(record: Record<string, unknown>, keys: readonly string[]) {
  for (const key of keys) {
    const value = record[key];

    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }

    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }

  return null;
}

function getFirstNumber(record: Record<string, unknown>, keys: readonly string[]) {
  for (const key of keys) {
    const value = record[key];
    const numberValue =
      typeof value === "number"
        ? value
        : typeof value === "string"
          ? Number(value.replace(/,/g, ""))
          : null;

    if (typeof numberValue === "number" && Number.isFinite(numberValue)) {
      return numberValue;
    }
  }

  return null;
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

function getPointDate(record: Record<string, unknown>) {
  for (const key of POINT_DATE_KEYS) {
    const date = normalizeDateOnly(record[key]);

    if (date) {
      return date;
    }
  }

  return null;
}

function valueToRows(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.filter(isRecord);
  }

  if (!isRecord(value)) {
    return [];
  }

  return Object.entries(value).flatMap(([key, entry]) => {
    if (isRecord(entry)) {
      return [{ key, ...entry }];
    }

    if (typeof entry === "number" || typeof entry === "string") {
      return [{ key, value: entry }];
    }

    return [];
  });
}

function getChildRows(record: Record<string, unknown>) {
  for (const key of CHILD_DATA_KEYS) {
    const rows = valueToRows(record[key]);

    if (rows.length > 0) {
      return rows;
    }
  }

  return [];
}

function getSeriesLabel(record: Record<string, unknown>) {
  const label = getFirstString(record, SERIES_LABEL_KEYS);

  if (label) {
    return label;
  }

  const key = getFirstString(record, ["key"]);

  if (key && !normalizeDateOnly(key)) {
    return key;
  }

  return null;
}

function normalizePoint(record: Record<string, unknown>): NormalizedPoint | null {
  const value = getFirstNumber(record, REVENUE_NUMBER_KEYS);

  if (value === null) {
    return null;
  }

  return {
    date: getPointDate(record) ?? normalizeDateOnly(record.key),
    value,
  };
}

function normalizeSeries(record: Record<string, unknown>): NormalizedSeries | null {
  const childRows = getChildRows(record);
  const unit = getFirstString(record, ["unit", "currency"]);

  if (childRows.length > 0) {
    const points = childRows.flatMap((child) => {
      const point = normalizePoint(child);
      return point ? [point] : [];
    });
    const explicitValue = getFirstNumber(record, REVENUE_NUMBER_KEYS);
    const value =
      explicitValue ??
      points.reduce((total, point) => total + point.value, 0);

    if (value === 0 && points.length === 0 && explicitValue === null) {
      return null;
    }

    return {
      label: getSeriesLabel(record),
      points,
      unit,
      value,
    };
  }

  const point = normalizePoint(record);
  const value = getFirstNumber(record, REVENUE_NUMBER_KEYS);

  if (value === null) {
    return null;
  }

  return {
    label: getSeriesLabel(record),
    points: point ? [point] : [],
    unit,
    value,
  };
}

function getMetricContainer(payload: unknown): MetricContainer | null {
  if (Array.isArray(payload)) {
    return {
      key: "data",
      metric: { data: payload },
    };
  }

  if (!isRecord(payload)) {
    return null;
  }

  const data = payload.data;

  if (isRecord(data)) {
    const revenue = data.revenue;

    if (isRecord(revenue)) {
      return {
        key: "revenue",
        metric: revenue,
      };
    }

    for (const [key, value] of Object.entries(data)) {
      if (isRecord(value) && (Array.isArray(value.data) || "value" in value)) {
        return {
          key,
          metric: value,
        };
      }
    }
  }

  if (Array.isArray(data)) {
    return {
      key: "data",
      metric: { data },
    };
  }

  return null;
}

function normalizeMetricSeries(payload: unknown) {
  const container = getMetricContainer(payload);

  if (!container) {
    return {
      metricKey: null,
      series: [] as NormalizedSeries[],
      total: 0,
      unit: null as string | null,
    };
  }

  const unit = getFirstString(container.metric, ["unit", "currency"]);
  const rows = getChildRows(container.metric);
  const series = rows.flatMap((row) => {
    const normalized = normalizeSeries(row);
    return normalized ? [normalized] : [];
  });
  const total =
    getFirstNumber(container.metric, REVENUE_NUMBER_KEYS) ??
    series.reduce((sum, row) => sum + row.value, 0);

  return {
    metricKey: container.key,
    series: aggregateSeriesByLabel(series),
    total,
    unit,
  };
}

function aggregateSeriesByLabel(series: NormalizedSeries[]) {
  const grouped = new Map<string, NormalizedSeries>();

  for (const row of series) {
    const key = row.label?.trim().toLowerCase() ?? "__unsegmented__";
    const existing = grouped.get(key);

    if (existing) {
      existing.value += row.value;
      existing.points = aggregatePoints([...existing.points, ...row.points]);
      existing.unit ??= row.unit;
      continue;
    }

    grouped.set(key, {
      label: row.label,
      points: aggregatePoints(row.points),
      unit: row.unit,
      value: row.value,
    });
  }

  return [...grouped.values()];
}

function aggregatePoints(points: NormalizedPoint[]) {
  const grouped = new Map<string, number>();
  const undatedPoints: NormalizedPoint[] = [];

  for (const point of points) {
    if (!point.date) {
      undatedPoints.push(point);
      continue;
    }

    grouped.set(point.date, (grouped.get(point.date) ?? 0) + point.value);
  }

  return [
    ...[...grouped.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([date, value]) => ({ date, value })),
    ...undatedPoints,
  ];
}

function splitCommaSeparatedList(value: string | undefined) {
  return (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function normalizeMatchText(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function isTikTokLabel(label: string | null, patterns: readonly string[]) {
  if (!label) {
    return false;
  }

  const normalizedLabel = normalizeMatchText(label);
  return patterns.some((pattern) => {
    const normalizedPattern = normalizeMatchText(pattern);
    return normalizedPattern.length > 0 && normalizedLabel.includes(normalizedPattern);
  });
}

function isUnattributedLabel(label: string | null) {
  if (!label) {
    return true;
  }

  const normalized = normalizeMatchText(label);
  return (
    normalized.length === 0 ||
    ["unknown", "not set", "none", "null", "n a", "organic"].includes(normalized)
  );
}

function getDisplaySourceLabel(label: string | null) {
  return label?.trim() || "Unattributed";
}

function getInclusiveDateKeys(startDate: string, endDate: string) {
  const keys: string[] = [];
  const end = new Date(`${endDate}T00:00:00.000Z`);
  const cursor = new Date(`${startDate}T00:00:00.000Z`);

  while (cursor <= end) {
    keys.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return keys;
}

function pointsToDateMap(points: NormalizedPoint[]) {
  const map = new Map<string, number>();

  for (const point of points) {
    if (!point.date) {
      continue;
    }

    map.set(point.date, (map.get(point.date) ?? 0) + point.value);
  }

  return map;
}

function getMergedPointMap(series: readonly NormalizedSeries[]) {
  const map = new Map<string, number>();

  for (const row of series) {
    for (const point of row.points) {
      if (!point.date) {
        continue;
      }

      map.set(point.date, (map.get(point.date) ?? 0) + point.value);
    }
  }

  return map;
}

function getCurrency(args: {
  periodUnit: string | null;
  sourceUnit: string | null;
  periodSeries: NormalizedSeries[];
  sourceSeries: NormalizedSeries[];
}) {
  const currencies = [
    args.periodUnit,
    args.sourceUnit,
    ...args.periodSeries.map((row) => row.unit),
    ...args.sourceSeries.map((row) => row.unit),
  ]
    .map((value) => value?.trim().toUpperCase())
    .filter((value): value is string => Boolean(value));
  const uniqueCurrencies = [...new Set(currencies)];

  return {
    currency: uniqueCurrencies.length === 1 ? uniqueCurrencies[0] : null,
    currencies: uniqueCurrencies,
  };
}

function buildSourceRows(args: {
  sourceSeries: NormalizedSeries[];
  tiktokPatterns: string[];
  totalRevenue: number;
}) {
  return args.sourceSeries
    .filter((row) => row.value !== 0 || row.label)
    .map<RevenueAttributionSourceRow>((row) => {
      const kind = isTikTokLabel(row.label, args.tiktokPatterns)
        ? "tiktok"
        : isUnattributedLabel(row.label)
          ? "unattributed"
          : "ugc";

      return {
        kind,
        label: getDisplaySourceLabel(row.label),
        rawLabel: row.label,
        revenue: row.value,
        share: args.totalRevenue > 0 ? row.value / args.totalRevenue : null,
      };
    })
    .sort((left, right) => right.revenue - left.revenue || left.label.localeCompare(right.label));
}

function buildDailyRows(args: {
  startDate: string;
  endDate: string;
  totalSeries: NormalizedSeries[];
  sourceSeries: NormalizedSeries[];
  tiktokPatterns: string[];
}) {
  const dateKeys = getInclusiveDateKeys(args.startDate, args.endDate);
  const totalMap = getMergedPointMap(args.totalSeries);
  const tiktokMap = getMergedPointMap(
    args.sourceSeries.filter((row) => isTikTokLabel(row.label, args.tiktokPatterns)),
  );
  const sourceTotalMap = getMergedPointMap(args.sourceSeries);
  const hasSourceDailyBreakdown = tiktokMap.size > 0 || sourceTotalMap.size > 0;
  const firstTotalSeriesMap = args.totalSeries[0]
    ? pointsToDateMap(args.totalSeries[0].points)
    : new Map<string, number>();

  return {
    hasSourceDailyBreakdown,
    rows: dateKeys.map((date) => {
      const total =
        totalMap.get(date) ??
        sourceTotalMap.get(date) ??
        firstTotalSeriesMap.get(date) ??
        0;
      const tiktok = hasSourceDailyBreakdown ? tiktokMap.get(date) ?? 0 : null;
      const ugc =
        hasSourceDailyBreakdown && tiktok !== null
          ? Math.max(total - tiktok, 0)
          : null;

      return {
        date,
        tiktok,
        total,
        ugc,
      };
    }),
  };
}

function normalizeWarnings(warnings: string[]) {
  return [...new Set(warnings.map((warning) => warning.trim()).filter(Boolean))];
}

export async function getRevenueAttributionReport(args: {
  startDate: string;
  endDate: string;
}): Promise<RevenueAttributionReport> {
  if (!hasAdaptyEnv()) {
    return getDefaultRevenueAttributionReport({
      startDate: args.startDate,
      endDate: args.endDate,
    });
  }

  const env = getAdaptyEnv();
  const tiktokPatterns = splitCommaSeparatedList(env.ADAPTY_TIKTOK_SOURCE_PATTERNS);
  const attributionDimension = env.ADAPTY_TIKTOK_SEGMENTATION;
  const filters = {
    date: [args.startDate, args.endDate] as [string, string],
  };

  try {
    const periodPayload = await adaptyClient.retrieveAnalyticsData({
      chartId: "revenue",
      filters,
      periodUnit: "day",
      segmentation: "period",
    });
    const sourcePayload = await adaptyClient.retrieveAnalyticsData({
      chartId: "revenue",
      filters,
      periodUnit: "day",
      segmentation: attributionDimension,
    });
    const periodMetric = normalizeMetricSeries(periodPayload);
    const sourceMetric = normalizeMetricSeries(sourcePayload);
    const sourceRows = buildSourceRows({
      sourceSeries: sourceMetric.series,
      tiktokPatterns,
      totalRevenue: periodMetric.total || sourceMetric.total,
    });
    const sourceTotal = sourceRows.reduce((total, row) => total + row.revenue, 0);
    const totalRevenue = periodMetric.total || sourceMetric.total || sourceTotal;
    const tiktokRevenue = sourceRows
      .filter((row) => row.kind === "tiktok")
      .reduce((total, row) => total + row.revenue, 0);
    const unattributedRevenue = sourceRows
      .filter((row) => row.kind === "unattributed")
      .reduce((total, row) => total + row.revenue, 0);
    const ugcRevenue = Math.max(totalRevenue - tiktokRevenue, 0);
    const daily = buildDailyRows({
      endDate: args.endDate,
      sourceSeries: sourceMetric.series,
      startDate: args.startDate,
      tiktokPatterns,
      totalSeries: periodMetric.series,
    });
    const currency = getCurrency({
      periodSeries: periodMetric.series,
      periodUnit: periodMetric.unit,
      sourceSeries: sourceMetric.series,
      sourceUnit: sourceMetric.unit,
    });
    const warnings = normalizeWarnings([
      ...(periodMetric.metricKey && periodMetric.metricKey !== "revenue"
        ? [`Adapty returned ${periodMetric.metricKey} as the revenue metric container.`]
        : []),
      ...(currency.currencies.length > 1
        ? [
            `Adapty returned multiple revenue units (${currency.currencies.join(", ")}), so amounts are shown as plain numbers.`,
          ]
        : []),
      ...(totalRevenue > 0 && tiktokRevenue === 0
        ? [
            `No ${attributionDimension.replace(/_/g, " ")} segment matched ${tiktokPatterns.join(", ")}. If TikTok lives in another Adapty attribution field, set ADAPTY_TIKTOK_SEGMENTATION.`,
          ]
        : []),
      ...(unattributedRevenue > 0
        ? ["Unattributed or organic Adapty revenue is included in UGC for this v1 breakdown."]
        : []),
      ...(tiktokRevenue > totalRevenue
        ? [
            "TikTok revenue was greater than total revenue in the Adapty response, so UGC was clamped to zero.",
          ]
        : []),
      ...(totalRevenue > 0 && !daily.hasSourceDailyBreakdown
        ? [
            "Adapty did not return daily attribution points, so the daily chart only shows total revenue.",
          ]
        : []),
    ]);

    return {
      attributionDimension,
      configured: true,
      currency: currency.currency,
      dailyRows: daily.rows,
      endDate: args.endDate,
      hasDailySourceBreakdown: daily.hasSourceDailyBreakdown,
      sourceRows: buildSourceRows({
        sourceSeries: sourceMetric.series,
        tiktokPatterns,
        totalRevenue,
      }),
      startDate: args.startDate,
      tiktokPatterns,
      totals: {
        tiktok: tiktokRevenue,
        tiktokShare: totalRevenue > 0 ? tiktokRevenue / totalRevenue : null,
        total: totalRevenue,
        ugc: ugcRevenue,
        ugcShare: totalRevenue > 0 ? ugcRevenue / totalRevenue : null,
        unattributed: unattributedRevenue,
      },
      warnings,
    };
  } catch (error) {
    return {
      ...getDefaultRevenueAttributionReport({
        startDate: args.startDate,
        endDate: args.endDate,
      }),
      attributionDimension,
      configured: true,
      tiktokPatterns,
      warnings: [
        error instanceof AdaptyApiError || error instanceof Error
          ? error.message
          : "Could not load Adapty revenue analytics.",
      ],
    };
  }
}

export function getDefaultRevenueAttributionReport(args: {
  startDate: string;
  endDate: string;
}): RevenueAttributionReport {
  return {
    attributionDimension: "attribution_source",
    configured: false,
    currency: null,
    dailyRows: getInclusiveDateKeys(args.startDate, args.endDate).map((date) => ({
      date,
      tiktok: null,
      total: 0,
      ugc: null,
    })),
    endDate: args.endDate,
    hasDailySourceBreakdown: false,
    sourceRows: [],
    startDate: args.startDate,
    tiktokPatterns: ["tiktok", "tik tok"],
    totals: {
      tiktok: 0,
      tiktokShare: null,
      total: 0,
      ugc: 0,
      ugcShare: null,
      unattributed: 0,
    },
    warnings: [],
  };
}
