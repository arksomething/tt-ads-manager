import {
  AdaptyApiError,
  adaptyClient,
  type AdaptyRevenueSegmentation,
} from "./client";
import {
  getSingularSourceRevenueReport,
  type SingularSourceRevenueReport,
  type SingularSourceRevenueRow,
} from "@/server/singular/reporting";
import {
  getAppleSearchAdsDashboardReport,
  type AppleSearchAdsDashboardReport,
} from "./dashboard-client";
import {
  getRevenueSourceKind,
  isAppleAdsLabel,
  isOrganicSingularLabel,
  isTikTokLabel,
  isUnattributedLabel,
  splitCommaSeparatedList,
} from "./source-classification";
import { getAdaptyCredentials } from "@/server/settings/managed-secrets";
import {
  getSingularSourceTimeZone,
  getUtcDateForProviderDate,
  REVENUE_REPORT_TIME_ZONE,
} from "./revenue-timezone";
import {
  getRenewalBucketAmounts,
  isActivationPeriodLabel,
  isRenewalPeriodLabel,
  isTrialPeriodLabel,
  type RenewalBucketAmounts,
} from "./revenue-renewals";

export type RevenueAttributionSourceRow = {
  label: string;
  rawLabel: string | null;
  kind: "tiktok" | "apple" | "paid" | "organic" | "renewal";
  revenue: number;
  share: number | null;
  spend: number | null;
  installs: number | null;
  conversions: number | null;
};

export type RevenueAttributionDailyRow = {
  date: string;
  total: number;
  newProceeds: number | null;
  renewal: number | null;
  paid: number | null;
  tiktok: number | null;
  apple: number | null;
  organic: number | null;
  paidSpend: number | null;
  tiktokSpend: number | null;
};

export type RevenueProviderTimeZoneRow = {
  provider: string;
  source: string;
  timeZone: string;
  reconciliation: string;
};

export type RevenueAttributionReport = {
  configured: boolean;
  singularConfigured: boolean;
  singularPending: boolean;
  singularCohortPeriod: string | null;
  startDate: string;
  endDate: string;
  timeZone: string;
  attributionDimension: AdaptyRevenueSegmentation;
  tiktokPatterns: string[];
  sourceProvider: "singular" | "adapty" | "none";
  appleSourceProvider: "adapty_dashboard" | "adapty" | "singular" | "none";
  currency: string | null;
  totals: {
    total: number;
    paid: number;
    tiktok: number;
    apple: number;
    appleSpend: number | null;
    appleProfit: number | null;
    appleRoas: number | null;
    organic: number;
    newProceeds: number;
    renewal: number;
    renewalBucket: number;
    renewalShare: number | null;
    newShare: number | null;
    tiktokShare: number | null;
    appleShare: number | null;
    paidShare: number | null;
    organicShare: number | null;
  };
  sourceRows: RevenueAttributionSourceRow[];
  dailyRows: RevenueAttributionDailyRow[];
  providerTimeZones: RevenueProviderTimeZoneRow[];
  hasDailySourceBreakdown: boolean;
  appleAdsDashboardConfigured: boolean;
  appleAdsDashboardRowCount: number;
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
  "proceeds",
  "net_revenue",
  "revenue",
  "amount",
  "total",
  "y",
] as const;
const MONEY_CONTAINER_KEYS = ["proceeds", "net_revenue", "revenue"] as const;
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
    for (const key of MONEY_CONTAINER_KEYS) {
      const metric = data[key];

      if (isRecord(metric)) {
        return {
          key,
          metric,
        };
      }
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

function roundCurrency(value: number) {
  return Math.round(value * 100) / 100;
}

function allocateTotalByDailyWeights(args: {
  dates: string[];
  total: number;
  weights: Map<string, number>;
}) {
  const allocations = new Map<string, number>();
  const totalWeight = args.dates.reduce(
    (sum, date) => sum + Math.max(args.weights.get(date) ?? 0, 0),
    0,
  );

  if (args.dates.length === 0) {
    return allocations;
  }

  if (totalWeight <= 0) {
    const evenAllocation = roundCurrency(args.total / args.dates.length);
    let runningTotal = 0;

    for (const date of args.dates.slice(0, -1)) {
      allocations.set(date, evenAllocation);
      runningTotal += evenAllocation;
    }

    allocations.set(
      args.dates[args.dates.length - 1] ?? "",
      roundCurrency(args.total - runningTotal),
    );
    return allocations;
  }

  let runningTotal = 0;

  for (const date of args.dates.slice(0, -1)) {
    const allocation = roundCurrency(
      args.total * (Math.max(args.weights.get(date) ?? 0, 0) / totalWeight),
    );
    allocations.set(date, allocation);
    runningTotal += allocation;
  }

  allocations.set(
    args.dates[args.dates.length - 1] ?? "",
    roundCurrency(args.total - runningTotal),
  );
  return allocations;
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

function getPeriodRevenueSplit(series: readonly NormalizedSeries[]) {
  const activationSeries = series.filter((row) => isActivationPeriodLabel(row.label));
  const renewalSeries = series.filter((row) => isRenewalPeriodLabel(row.label));
  const trialSeries = series.filter((row) => isTrialPeriodLabel(row.label));

  return {
    activationSeries,
    renewalSeries,
    trialSeries,
    activationRevenue: activationSeries.reduce((total, row) => total + row.value, 0),
    renewalRevenue: renewalSeries.reduce((total, row) => total + row.value, 0),
  };
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
  applePatterns: string[];
  creatorPatterns: string[];
  totalRevenue: number;
}) {
  return args.sourceSeries
    .filter((row) => row.value !== 0 || row.label)
    .map<RevenueAttributionSourceRow>((row) => {
      const kind = getRevenueSourceKind({
        applePatterns: args.applePatterns,
        creatorPatterns: args.creatorPatterns,
        label: row.label,
        tiktokPatterns: args.tiktokPatterns,
      });

      return {
        kind,
        label: getDisplaySourceLabel(row.label),
        rawLabel: row.label,
        revenue: row.value,
        share: args.totalRevenue > 0 ? row.value / args.totalRevenue : null,
        spend: null,
        installs: null,
        conversions: null,
      };
    })
    .sort((left, right) => right.revenue - left.revenue || left.label.localeCompare(right.label));
}

function buildSingularSourceRows(args: {
  singularReport: SingularSourceRevenueReport;
  tiktokPatterns: string[];
  applePatterns: string[];
  creatorPatterns: string[];
  totalRevenue: number;
}) {
  const paidRows: RevenueAttributionSourceRow[] = args.singularReport.rows
    .filter((row) => !isOrganicSingularLabel(row.label, args.creatorPatterns))
    .map((row) => {
      const kind = isTikTokLabel(row.label, args.tiktokPatterns)
        ? "tiktok"
        : isAppleAdsLabel(row.label, args.applePatterns)
        ? "apple"
        : "paid";

      return {
        kind,
        label: row.label,
        rawLabel: row.source,
        revenue: row.revenue,
        share: args.totalRevenue > 0 ? row.revenue / args.totalRevenue : null,
        spend: row.spend,
        installs: row.installs,
        conversions: row.conversions,
      } satisfies RevenueAttributionSourceRow;
    });
  const paidRevenue = paidRows.reduce((total, row) => total + row.revenue, 0);
  const organicRevenue = Math.max(args.totalRevenue - paidRevenue, 0);
  const organicRow =
    organicRevenue > 0 || args.totalRevenue > 0
      ? [
          {
            kind: "organic",
            label: "Organic / unattributed",
            rawLabel: null,
            revenue: organicRevenue,
            share:
              args.totalRevenue > 0 ? organicRevenue / args.totalRevenue : null,
            spend: null,
            installs: null,
            conversions: null,
          } satisfies RevenueAttributionSourceRow,
        ]
      : [];

  return [...paidRows, ...organicRow].sort(
    (left, right) => right.revenue - left.revenue || left.label.localeCompare(right.label),
  );
}

function rebuildOrganicSourceRow(args: {
  rows: RevenueAttributionSourceRow[];
  renewalRevenue: number;
  totalRevenue: number;
}) {
  const paidRows = args.rows.filter((row) => row.kind !== "organic");
  const paidRevenue = paidRows.reduce((total, row) => total + row.revenue, 0);
  const renewalBucket = getRenewalBucketAmounts({
    paidRevenue,
    renewalRevenue: args.renewalRevenue,
    totalRevenue: args.totalRevenue,
  });
  const organicRevenue = renewalBucket.organic;
  const renewalRow =
    renewalBucket.renewalBucket > 0
      ? [
          {
            kind: "renewal",
            label: "Renewals / existing subscribers",
            rawLabel: "adapty_old_source_profile_install_date",
            revenue: renewalBucket.renewalBucket,
            share:
              args.totalRevenue > 0
                ? renewalBucket.renewalBucket / args.totalRevenue
                : null,
            spend: null,
            installs: null,
            conversions: null,
          } satisfies RevenueAttributionSourceRow,
        ]
      : [];
  const organicRow =
    organicRevenue > 0 || args.totalRevenue > 0
      ? [
          {
            kind: "organic",
            label: "Organic / unattributed",
            rawLabel: null,
            revenue: organicRevenue,
            share:
              args.totalRevenue > 0 ? organicRevenue / args.totalRevenue : null,
            spend: null,
            installs: null,
            conversions: null,
          } satisfies RevenueAttributionSourceRow,
        ]
      : [];

  return [...paidRows, ...renewalRow, ...organicRow].sort(
    (left, right) => right.revenue - left.revenue || left.label.localeCompare(right.label),
  );
}

function buildDashboardAppleRow(args: {
  dashboardReport: AppleSearchAdsDashboardReport;
  fallbackRows: RevenueAttributionSourceRow[];
  totalRevenue: number;
}) {
  if (!args.dashboardReport.configured || args.dashboardReport.rowCount === 0) {
    return null;
  }

  const fallbackRevenue = args.fallbackRows.reduce(
    (total, row) => total + row.revenue,
    0,
  );
  const revenue = args.dashboardReport.revenue ?? fallbackRevenue;

  return {
    conversions: args.dashboardReport.conversions,
    installs: args.dashboardReport.installs,
    kind: "apple",
    label: "Apple Search Ads",
    rawLabel: "adapty_dashboard_asa",
    revenue,
    share: args.totalRevenue > 0 ? revenue / args.totalRevenue : null,
    spend: args.dashboardReport.spend,
  } satisfies RevenueAttributionSourceRow;
}

function buildDailyRows(args: {
  startDate: string;
  endDate: string;
  totalSeries: NormalizedSeries[];
  activationSeries?: NormalizedSeries[];
  renewalSeries?: NormalizedSeries[];
  appleChannelSeries?: NormalizedSeries[];
  singularRows?: SingularSourceRevenueRow[];
  sourceSeries?: NormalizedSeries[];
  tiktokPatterns?: string[];
  applePatterns?: string[];
  creatorPatterns?: string[];
  excludeAppleRows?: boolean;
}) {
  const dateKeys = getInclusiveDateKeys(args.startDate, args.endDate);
  const totalMap = getMergedPointMap(args.totalSeries);
  const paidMap = new Map<string, number>();
  const tiktokMap = new Map<string, number>();
  const appleMap = new Map<string, number>();
  const activationMap = getMergedPointMap(args.activationSeries ?? []);
  const renewalMap = getMergedPointMap(args.renewalSeries ?? []);
  const paidSpendMap = new Map<string, number>();
  const tiktokSpendMap = new Map<string, number>();
  const fallbackSourceSeries = args.sourceSeries ?? [];
  const fallbackTikTokPatterns = args.tiktokPatterns ?? [];
  const fallbackApplePatterns = args.applePatterns ?? [];
  const fallbackCreatorPatterns = args.creatorPatterns ?? [];
  const eligibleFallbackSourceSeries = fallbackSourceSeries.filter(
    (row) =>
      !(
        args.excludeAppleRows &&
        isAppleAdsLabel(row.label, fallbackApplePatterns)
      ),
  );

  if (args.singularRows) {
    for (const row of args.singularRows) {
      if (
        isOrganicSingularLabel(row.label, fallbackCreatorPatterns) ||
        (args.excludeAppleRows && isAppleAdsLabel(row.label, fallbackApplePatterns))
      ) {
        continue;
      }

      for (const point of row.points) {
        if (!point.date) {
          continue;
        }

        const providerTimeZone = getSingularSourceTimeZone(row.label);
        const utcDate = getUtcDateForProviderDate({
          date: point.date,
          providerTimeZone,
        });

        paidMap.set(utcDate, (paidMap.get(utcDate) ?? 0) + point.revenue);
        paidSpendMap.set(
          utcDate,
          (paidSpendMap.get(utcDate) ?? 0) + point.spend,
        );

        if (isTikTokLabel(row.label, fallbackTikTokPatterns)) {
          tiktokMap.set(
            utcDate,
            (tiktokMap.get(utcDate) ?? 0) + point.revenue,
          );
          tiktokSpendMap.set(
            utcDate,
            (tiktokSpendMap.get(utcDate) ?? 0) + point.spend,
          );
        }

        if (isAppleAdsLabel(row.label, fallbackApplePatterns)) {
          appleMap.set(
            utcDate,
            (appleMap.get(utcDate) ?? 0) + point.revenue,
          );
        }
      }
    }
  } else {
    for (const row of eligibleFallbackSourceSeries) {
      if (isUnattributedLabel(row.label)) {
        continue;
      }

      for (const point of row.points) {
        if (!point.date) {
          continue;
        }

        paidMap.set(point.date, (paidMap.get(point.date) ?? 0) + point.value);

        if (isTikTokLabel(row.label, fallbackTikTokPatterns)) {
          tiktokMap.set(point.date, (tiktokMap.get(point.date) ?? 0) + point.value);
        }

        if (isAppleAdsLabel(row.label, fallbackApplePatterns)) {
          appleMap.set(point.date, (appleMap.get(point.date) ?? 0) + point.value);
        }
      }
    }
  }

  for (const row of args.appleChannelSeries ?? []) {
    if (!isAppleAdsLabel(row.label, fallbackApplePatterns)) {
      continue;
    }

    for (const point of row.points) {
      if (!point.date) {
        continue;
      }

      paidMap.set(point.date, (paidMap.get(point.date) ?? 0) + point.value);
      appleMap.set(point.date, (appleMap.get(point.date) ?? 0) + point.value);
    }
  }

  const sourceTotalMap = args.singularRows
    ? paidMap
    : getMergedPointMap(eligibleFallbackSourceSeries);
  const hasSourceDailyBreakdown =
    paidMap.size > 0 ||
    tiktokMap.size > 0 ||
    appleMap.size > 0 ||
    activationMap.size > 0 ||
    renewalMap.size > 0 ||
    sourceTotalMap.size > 0;
  const hasDailySpendBreakdown = paidSpendMap.size > 0;
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
      const paid = hasSourceDailyBreakdown ? paidMap.get(date) ?? 0 : null;
      const newProceeds =
        hasSourceDailyBreakdown && activationMap.size > 0
          ? Math.min(activationMap.get(date) ?? 0, total)
          : null;
      const renewal =
        hasSourceDailyBreakdown && renewalMap.size > 0
          ? renewalMap.get(date) ?? 0
          : newProceeds === null
            ? null
            : Math.max(total - newProceeds, 0);
      const tiktok = hasSourceDailyBreakdown ? tiktokMap.get(date) ?? 0 : null;
      const paidSpend = hasDailySpendBreakdown
        ? paidSpendMap.get(date) ?? 0
        : null;
      const tiktokSpend = hasDailySpendBreakdown
        ? tiktokSpendMap.get(date) ?? 0
        : null;
      const apple =
        hasSourceDailyBreakdown && appleMap.size > 0
          ? appleMap.get(date) ?? 0
          : null;
      const organic =
        hasSourceDailyBreakdown && paid !== null
          ? Math.max(total - paid - (renewal ?? 0), 0)
          : null;

      return {
        date,
        newProceeds,
        paid,
        tiktok,
        apple,
        total,
        renewal,
        organic,
        paidSpend,
        tiktokSpend,
      };
    }),
  };
}

function getDailyWeightMap(
  rows: RevenueAttributionDailyRow[],
  getValue: (row: RevenueAttributionDailyRow) => number | null,
  fallback?: Map<string, number>,
) {
  return new Map(
    rows.map((row) => [
      row.date,
      Math.max(getValue(row) ?? fallback?.get(row.date) ?? 0, 0),
    ]),
  );
}

function shouldPublishReconciledNullableSeries(args: {
  rows: RevenueAttributionDailyRow[];
  total: number;
  getValue: (row: RevenueAttributionDailyRow) => number | null;
}) {
  return (
    args.total > 0 ||
    args.rows.some((row) => args.getValue(row) !== null)
  );
}

export function reconcileRevenueDailyRowsToTotals(args: {
  rows: RevenueAttributionDailyRow[];
  totals: {
    total: number;
    newProceeds: number;
    renewal: number;
    paid: number;
    tiktok: number;
    apple: number;
    organic: number;
  };
  includeSourceBreakdown: boolean;
}) {
  const dates = args.rows.map((row) => row.date);
  const totalWeights = getDailyWeightMap(args.rows, (row) => row.total);
  const totalByDate = allocateTotalByDailyWeights({
    dates,
    total: args.totals.total,
    weights: totalWeights,
  });
  const newProceedsByDate = allocateTotalByDailyWeights({
    dates,
    total: args.totals.newProceeds,
    weights: getDailyWeightMap(
      args.rows,
      (row) => row.newProceeds,
      totalWeights,
    ),
  });
  const renewalByDate = allocateTotalByDailyWeights({
    dates,
    total: args.totals.renewal,
    weights: getDailyWeightMap((args.rows), (row) => row.renewal, totalWeights),
  });
  const paidByDate = allocateTotalByDailyWeights({
    dates,
    total: args.totals.paid,
    weights: getDailyWeightMap(args.rows, (row) => row.paid, totalWeights),
  });
  const tiktokByDate = allocateTotalByDailyWeights({
    dates,
    total: args.totals.tiktok,
    weights: getDailyWeightMap(args.rows, (row) => row.tiktok, totalWeights),
  });
  const appleByDate = allocateTotalByDailyWeights({
    dates,
    total: args.totals.apple,
    weights: getDailyWeightMap(args.rows, (row) => row.apple, totalWeights),
  });
  const organicByDate = allocateTotalByDailyWeights({
    dates,
    total: args.totals.organic,
    weights: getDailyWeightMap(args.rows, (row) => row.organic, totalWeights),
  });
  const publishPaid = args.includeSourceBreakdown
    ? shouldPublishReconciledNullableSeries({
        rows: args.rows,
        total: args.totals.paid,
        getValue: (row) => row.paid,
      })
    : false;
  const publishTiktok = args.includeSourceBreakdown
    ? shouldPublishReconciledNullableSeries({
        rows: args.rows,
        total: args.totals.tiktok,
        getValue: (row) => row.tiktok,
      })
    : false;
  const publishApple = args.includeSourceBreakdown
    ? shouldPublishReconciledNullableSeries({
        rows: args.rows,
        total: args.totals.apple,
        getValue: (row) => row.apple,
      })
    : false;
  const publishOrganic = args.includeSourceBreakdown
    ? shouldPublishReconciledNullableSeries({
        rows: args.rows,
        total: args.totals.organic,
        getValue: (row) => row.organic,
      })
    : false;

  return args.rows.map((row) => ({
    ...row,
    apple: publishApple ? appleByDate.get(row.date) ?? 0 : null,
    newProceeds: newProceedsByDate.get(row.date) ?? 0,
    organic: publishOrganic ? organicByDate.get(row.date) ?? 0 : null,
    paid: publishPaid ? paidByDate.get(row.date) ?? 0 : null,
    renewal: renewalByDate.get(row.date) ?? 0,
    tiktok: publishTiktok ? tiktokByDate.get(row.date) ?? 0 : null,
    total: totalByDate.get(row.date) ?? 0,
  }));
}

function getDailyRowsTotal(rows: RevenueAttributionDailyRow[]) {
  return roundCurrency(rows.reduce((total, row) => total + row.total, 0));
}

function getProviderTimeZoneRows(args: {
  singularRows?: SingularSourceRevenueRow[];
}): RevenueProviderTimeZoneRow[] {
  const rows = new Map<string, RevenueProviderTimeZoneRow>();

  rows.set("adapty", {
    provider: "Adapty",
    source: "Proceeds analytics",
    timeZone: REVENUE_REPORT_TIME_ZONE,
    reconciliation: "Queried and bucketed by UTC report dates.",
  });
  rows.set("singular-default", {
    provider: "Singular",
    source: "Paid source rows",
    timeZone: REVENUE_REPORT_TIME_ZONE,
    reconciliation:
      "Rows are treated as UTC unless a known source has a different provider calendar.",
  });
  rows.set("apple-search-ads", {
    provider: "Adapty Ads Manager",
    source: "Apple Search Ads",
    timeZone: REVENUE_REPORT_TIME_ZONE,
    reconciliation: "Queried by UTC report dates.",
  });
  rows.set("viewsbase", {
    provider: "ViewsBase",
    source: "Faceless spend",
    timeZone: REVENUE_REPORT_TIME_ZONE,
    reconciliation: "Filtered to UTC report date labels returned by ViewsBase.",
  });
  rows.set("ugc-pay", {
    provider: "UGC Pay",
    source: "Creator pay",
    timeZone: REVENUE_REPORT_TIME_ZONE,
    reconciliation: "Revenue page passes UTC report dates into UGC Pay.",
  });

  for (const row of args.singularRows ?? []) {
    const timeZone = getSingularSourceTimeZone(row.label);

    if (timeZone === REVENUE_REPORT_TIME_ZONE) {
      continue;
    }

    rows.set(`singular-${row.label.toLowerCase()}`, {
      provider: "Singular",
      source: row.label,
      timeZone,
      reconciliation:
        "Provider daily rows are mapped to UTC by the UTC date of the provider-day start. Exact UTC-day splitting requires hourly exports.",
    });
  }

  return [...rows.values()];
}

function getTimezoneWarnings(args: {
  singularRows?: SingularSourceRevenueRow[];
}) {
  const hasNonUtcSingularRows = (args.singularRows ?? []).some(
    (row) => getSingularSourceTimeZone(row.label) !== REVENUE_REPORT_TIME_ZONE,
  );

  return hasNonUtcSingularRows
    ? [
        "Revenue targets UTC. Snapchat/Singular daily rows are Pacific-day aggregates, so they are mapped to UTC by provider-day start; exact UTC-day spend/proceeds splitting requires hourly exports.",
      ]
    : [];
}

function normalizeWarnings(warnings: string[]) {
  return [...new Set(warnings.map((warning) => warning.trim()).filter(Boolean))];
}

export async function getRevenueAttributionReport(args: {
  organizationSlug: string;
  startDate: string;
  endDate: string;
}): Promise<RevenueAttributionReport> {
  const adaptyCredentials = await getAdaptyCredentials(args.organizationSlug);

  if (!adaptyCredentials.configured) {
    return getDefaultRevenueAttributionReport({
      startDate: args.startDate,
      endDate: args.endDate,
    });
  }

  const credentials = adaptyCredentials.value;
  const tiktokPatterns = splitCommaSeparatedList(credentials.tiktokSourcePatterns);
  const applePatterns = splitCommaSeparatedList(credentials.appleSourcePatterns);
  const creatorPatterns = splitCommaSeparatedList(credentials.creatorSourcePatterns);
  const attributionDimension = credentials.tiktokSegmentation;
  const filters = {
    date: [args.startDate, args.endDate] as [string, string],
  };

  try {
    const [
      periodPayload,
      singularSourceReport,
      sourcePayload,
      channelPayload,
      appleAdsDashboardReport,
    ] = await Promise.all([
      adaptyClient.retrieveAnalyticsData({
        chartId: "revenue",
        credentials,
        filters,
        periodUnit: "day",
        segmentation: "period",
      }),
      getSingularSourceRevenueReport({
        endDate: args.endDate,
        startDate: args.startDate,
      }),
      adaptyClient.retrieveAnalyticsData({
        chartId: "revenue",
        credentials,
        filters,
        periodUnit: "day",
        segmentation: attributionDimension,
      }),
      adaptyClient.retrieveAnalyticsData({
        chartId: "revenue",
        credentials,
        filters,
        periodUnit: "day",
        segmentation: "attribution_channel",
      }),
      getAppleSearchAdsDashboardReport({
        endDate: args.endDate,
        organizationSlug: args.organizationSlug,
        startDate: args.startDate,
      }),
    ]);
    const periodMetric = normalizeMetricSeries(periodPayload);
    const sourceMetric = normalizeMetricSeries(sourcePayload);
    const channelMetric = normalizeMetricSeries(channelPayload);
    const periodRevenueSplit = getPeriodRevenueSplit(periodMetric.series);
    const adaptySourceRows = buildSourceRows({
      applePatterns,
      creatorPatterns,
      sourceSeries: sourceMetric.series,
      tiktokPatterns,
      totalRevenue: periodMetric.total,
    });
    const adaptyAppleChannelRows = buildSourceRows({
      applePatterns,
      creatorPatterns: [],
      sourceSeries: channelMetric.series,
      tiktokPatterns,
      totalRevenue: periodMetric.total,
    }).filter((row) => row.kind === "apple" && row.revenue > 0);
    const appleChannelSeries = channelMetric.series.filter((row) =>
      isAppleAdsLabel(row.label, applePatterns),
    );
    const dashboardAppleRow = buildDashboardAppleRow({
      dashboardReport: appleAdsDashboardReport,
      fallbackRows: adaptyAppleChannelRows,
      totalRevenue: periodMetric.total,
    });
    const appleRows = dashboardAppleRow
      ? [dashboardAppleRow]
      : adaptyAppleChannelRows;
    let sourceProvider: RevenueAttributionReport["sourceProvider"] = "none";
    const appleSourceProvider: RevenueAttributionReport["appleSourceProvider"] =
      dashboardAppleRow
        ? "adapty_dashboard"
        : adaptyAppleChannelRows.length > 0
          ? "adapty"
          : "none";
    let sourceRows: RevenueAttributionSourceRow[] = [];
    const totalRevenue = periodMetric.total;
    const newProceedsRevenue = Math.min(
      periodRevenueSplit.activationRevenue,
      totalRevenue,
    );
    const oldSourceRevenue = Math.min(
      periodRevenueSplit.renewalRevenue,
      Math.max(totalRevenue - newProceedsRevenue, 0),
    );
    const sourceSplitPending =
      singularSourceReport.configured && singularSourceReport.isPending;

    if (singularSourceReport.configured) {
      sourceProvider = "singular";
      const singularRows = buildSingularSourceRows({
        applePatterns,
        creatorPatterns,
        singularReport: singularSourceReport,
        tiktokPatterns,
        totalRevenue,
      });
      sourceRows = rebuildOrganicSourceRow({
        rows: [
          ...singularRows.filter(
            (row) =>
              row.kind !== "organic" &&
              row.kind !== "apple",
          ),
          ...appleRows,
        ],
        renewalRevenue: oldSourceRevenue,
        totalRevenue,
      });
    } else {
      sourceProvider = "adapty";
      sourceRows = rebuildOrganicSourceRow({
        rows: [
          ...adaptySourceRows.filter(
            (row) => row.kind !== "organic" && row.kind !== "apple",
          ),
          ...appleRows,
        ],
        renewalRevenue: oldSourceRevenue,
        totalRevenue,
      });
    }

    const paidRevenue = sourceRows
      .filter((row) => row.kind !== "organic" && row.kind !== "renewal")
      .reduce((total, row) => total + row.revenue, 0);
    const tiktokRevenue = sourceRows
      .filter((row) => row.kind === "tiktok")
      .reduce((total, row) => total + row.revenue, 0);
    const appleRevenue = sourceRows
      .filter((row) => row.kind === "apple")
      .reduce((total, row) => total + row.revenue, 0);
    const appleSpend = sourceRows
      .filter((row) => row.kind === "apple")
      .reduce(
        (total, row) =>
          typeof row.spend === "number" && Number.isFinite(row.spend)
            ? total + row.spend
            : total,
        0,
      );
    const hasAppleSpend = sourceRows.some(
      (row) =>
        row.kind === "apple" &&
        typeof row.spend === "number" &&
        Number.isFinite(row.spend),
    );
    const appleProfit = hasAppleSpend ? appleRevenue - appleSpend : null;
    const appleRoas =
      hasAppleSpend && appleSpend > 0 ? appleRevenue / appleSpend : null;
    const renewalBucket = getRenewalBucketAmounts({
      paidRevenue,
      renewalRevenue: oldSourceRevenue,
      totalRevenue,
    });
    const nonOrganicRevenue = paidRevenue + renewalBucket.renewalBucket;
    const organicRevenue = sourceSplitPending ? 0 : renewalBucket.organic;
    if (sourceSplitPending) {
      sourceRows = sourceRows
        .map((row) =>
          row.kind === "organic"
            ? {
                ...row,
                revenue: 0,
                share: totalRevenue > 0 ? 0 : null,
              }
            : row,
        )
        .sort(
          (left, right) =>
            right.revenue - left.revenue || left.label.localeCompare(right.label),
        );
    }
    const daily = buildDailyRows({
      endDate: args.endDate,
      activationSeries: periodRevenueSplit.activationSeries,
      appleChannelSeries,
      excludeAppleRows: true,
      renewalSeries: periodRevenueSplit.renewalSeries,
      singularRows: singularSourceReport.configured
        ? singularSourceReport.rows
        : undefined,
      sourceSeries: sourceMetric?.series,
      startDate: args.startDate,
      applePatterns,
      creatorPatterns,
      tiktokPatterns,
      totalSeries: periodMetric.series,
    });
    const rawDailyRows = sourceSplitPending
      ? daily.rows.map((row) => ({
          ...row,
          organic: 0,
          paid: null,
          paidSpend: null,
          tiktok: null,
          tiktokSpend: null,
        }))
      : daily.rows;
    const hasDailySourceBreakdown = sourceSplitPending
      ? false
      : daily.hasSourceDailyBreakdown;
    const dailyRows = reconcileRevenueDailyRowsToTotals({
      includeSourceBreakdown: hasDailySourceBreakdown,
      rows: rawDailyRows,
      totals: {
        apple: appleRevenue,
        newProceeds: renewalBucket.newProceeds,
        organic: organicRevenue,
        paid: paidRevenue,
        renewal: oldSourceRevenue,
        tiktok: tiktokRevenue,
        total: totalRevenue,
      },
    });
    const providerTimeZones = getProviderTimeZoneRows({
      singularRows: singularSourceReport.configured
        ? singularSourceReport.rows
        : undefined,
    });
    const currency = getCurrency({
      periodSeries: periodMetric.series,
      periodUnit: periodMetric.unit,
      sourceSeries: [...(sourceMetric?.series ?? []), ...channelMetric.series],
      sourceUnit: sourceMetric?.unit ?? channelMetric.unit ?? null,
    });
    const warnings = normalizeWarnings([
      ...(periodMetric.metricKey && periodMetric.metricKey !== "proceeds"
        ? [
            `Adapty did not return a proceeds metric container for this date window, so ${periodMetric.metricKey} is being used instead.`,
          ]
        : []),
      ...singularSourceReport.warnings,
      ...(currency.currencies.length > 1
        ? [
            `Adapty returned multiple proceeds units (${currency.currencies.join(", ")}), so amounts are shown as plain numbers.`,
          ]
        : []),
      ...(sourceProvider === "adapty" && totalRevenue > 0 && tiktokRevenue === 0
        ? [
            `No ${attributionDimension.replace(/_/g, " ")} segment matched ${tiktokPatterns.join(", ")}. If TikTok lives in another Adapty attribution field, set ADAPTY_TIKTOK_SEGMENTATION.`,
          ]
        : []),
      ...(singularSourceReport.configured && singularSourceReport.isPending
        ? [
            "Singular is still preparing the source proceeds report, so organic / UGC proceeds are hidden until the paid-source split is ready.",
          ]
        : []),
      ...appleAdsDashboardReport.warnings,
      ...getTimezoneWarnings({
        singularRows: singularSourceReport.configured
          ? singularSourceReport.rows
          : undefined,
      }),
      ...(appleSourceProvider === "adapty_dashboard" &&
      appleAdsDashboardReport.revenueBasis &&
      appleAdsDashboardReport.revenueBasis !== "proceeds"
        ? [
            `Adapty Ads Manager did not return Apple Search Ads proceeds, so ${appleAdsDashboardReport.revenueBasis} revenue is being used for Apple Search Ads.`,
          ]
        : []),
      ...(appleSourceProvider === "adapty_dashboard" && !hasAppleSpend
        ? [
            "Adapty Ads Manager returned Apple Search Ads revenue without spend, so Apple Search Ads profit is unavailable.",
          ]
        : []),
      ...(sourceProvider === "singular" && nonOrganicRevenue > totalRevenue
        ? [
            "Paid-source plus renewal proceeds are greater than Adapty total proceeds for this date window, so organic proceeds were clamped to zero.",
          ]
        : []),
      ...(totalRevenue > 0 && periodRevenueSplit.activationSeries.length === 0
        ? [
            "Adapty did not return an Activation period row, so new proceeds could not be split out from renewal proceeds.",
          ]
        : []),
      ...(totalRevenue > 0 && periodRevenueSplit.renewalSeries.length === 0
        ? [
            "Adapty did not return Renewal period rows, so renewal proceeds could not be split out.",
          ]
        : []),
      ...(oldSourceRevenue > renewalBucket.renewalBucket
        ? [
            "Old-source proceeds exceeded the organic/unattributed remainder after paid rows, so only the organic remainder was moved into the renewal bucket.",
          ]
        : []),
      ...(totalRevenue > 0 && !hasDailySourceBreakdown
        ? [
            "The source report did not return daily attribution points, so the daily chart only shows total proceeds.",
          ]
        : []),
      ...(Math.abs(getDailyRowsTotal(rawDailyRows) - roundCurrency(totalRevenue)) > 0.01
        ? [
            "Provider daily proceeds did not reconcile to the selected range total, so daily proceeds were proportionally reconciled to the range total.",
          ]
        : []),
    ]);

    return {
      attributionDimension,
      configured: true,
      currency: currency.currency,
      dailyRows,
      endDate: args.endDate,
      hasDailySourceBreakdown,
      providerTimeZones,
      singularCohortPeriod: singularSourceReport.configured
        ? singularSourceReport.cohortPeriod
        : null,
      singularConfigured: singularSourceReport.configured,
      singularPending: singularSourceReport.isPending,
      sourceProvider,
      appleSourceProvider,
      appleAdsDashboardConfigured: appleAdsDashboardReport.configured,
      appleAdsDashboardRowCount: appleAdsDashboardReport.rowCount,
      sourceRows,
      startDate: args.startDate,
      timeZone: REVENUE_REPORT_TIME_ZONE,
      tiktokPatterns,
      totals: {
        apple: appleRevenue,
        appleProfit,
        appleRoas,
        appleShare:
          appleSourceProvider !== "none" && totalRevenue > 0
            ? appleRevenue / totalRevenue
            : null,
        appleSpend: hasAppleSpend ? appleSpend : null,
        newProceeds: renewalBucket.newProceeds,
        newShare:
          totalRevenue > 0 ? renewalBucket.newProceeds / totalRevenue : null,
        organic: organicRevenue,
        organicShare: totalRevenue > 0 ? organicRevenue / totalRevenue : null,
        paid: paidRevenue,
        paidShare: totalRevenue > 0 ? paidRevenue / totalRevenue : null,
        renewal: oldSourceRevenue,
        renewalBucket: renewalBucket.renewalBucket,
        renewalShare:
          totalRevenue > 0 ? oldSourceRevenue / totalRevenue : null,
        tiktok: tiktokRevenue,
        tiktokShare: totalRevenue > 0 ? tiktokRevenue / totalRevenue : null,
        total: totalRevenue,
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
      appleSourceProvider: "none",
      appleAdsDashboardConfigured: false,
      appleAdsDashboardRowCount: 0,
      singularCohortPeriod: null,
      singularConfigured: false,
      singularPending: false,
      sourceProvider: "none",
      tiktokPatterns,
      timeZone: REVENUE_REPORT_TIME_ZONE,
      warnings: [
        error instanceof AdaptyApiError || error instanceof Error
          ? error.message
          : "Could not load Adapty proceeds analytics.",
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
      apple: null,
      newProceeds: null,
      paid: null,
      paidSpend: null,
      renewal: null,
      tiktok: null,
      tiktokSpend: null,
      total: 0,
      organic: null,
    })),
    endDate: args.endDate,
    hasDailySourceBreakdown: false,
    providerTimeZones: getProviderTimeZoneRows({}),
    appleSourceProvider: "none",
    appleAdsDashboardConfigured: false,
    appleAdsDashboardRowCount: 0,
    singularCohortPeriod: null,
    singularConfigured: false,
    singularPending: false,
    sourceProvider: "none",
    sourceRows: [],
    startDate: args.startDate,
    timeZone: REVENUE_REPORT_TIME_ZONE,
    tiktokPatterns: ["tiktok", "tik tok"],
    totals: {
      apple: 0,
      appleProfit: null,
      appleRoas: null,
      appleShare: null,
      appleSpend: null,
      newProceeds: 0,
      newShare: null,
      organic: 0,
      organicShare: null,
      paid: 0,
      paidShare: null,
      renewal: 0,
      renewalBucket: 0,
      renewalShare: null,
      tiktok: 0,
      tiktokShare: null,
      total: 0,
    },
    warnings: [],
  };
}
