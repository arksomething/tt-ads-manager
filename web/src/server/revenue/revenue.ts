import {
  getAppleSearchAdsDashboardReport,
  type AppleSearchAdsDashboardReport,
} from "@/server/adapty/dashboard-client";
import {
  SuperwallApiError,
  superwallClient,
  type SuperwallQueryScope,
} from "@/server/superwall/client";
import {
  getSingularSourceRevenueReport,
  type SingularSourceRevenueReport,
  type SingularSourceRevenueRow,
} from "@/server/singular/reporting";
import {
  getRevenueSourceKind,
  isAppleAdsLabel,
  isOrganicSingularLabel,
  isTikTokLabel,
  isUnattributedLabel,
  splitCommaSeparatedList,
} from "./source-classification";
import {
  getSuperwallCredentials,
  type SuperwallCredentialValue,
} from "@/server/settings/managed-secrets";
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

export type RevenueProceedsModel = "new_proceeds" | "cohorted_all";

export type RevenueProceedsModelConfig = {
  id: RevenueProceedsModel;
  label: string;
  shortLabel: string;
  description: string;
  dateBasisLabel: string;
  dateColumn: "purchasedAt" | "installDate";
  excludesRenewalsFromOrganic: boolean;
};

export const DEFAULT_REVENUE_PROCEEDS_MODEL: RevenueProceedsModel =
  "cohorted_all";

export const REVENUE_PROCEEDS_MODELS: RevenueProceedsModelConfig[] = [
  {
    id: "new_proceeds",
    label: "New proceeds",
    shortLabel: "New",
    description:
      "Purchase-date Superwall proceeds with renewal proceeds separated out before organic / creator allocation.",
    dateBasisLabel: "purchase date",
    dateColumn: "purchasedAt",
    excludesRenewalsFromOrganic: true,
  },
  {
    id: "cohorted_all",
    label: "Cohorted all proceeds",
    shortLabel: "Cohorted all",
    description:
      "Superwall proceeds bucketed by install cohort date, with renewal proceeds included in the attributed source / organic allocation.",
    dateBasisLabel: "install cohort date",
    dateColumn: "installDate",
    excludesRenewalsFromOrganic: false,
  },
];

const REVENUE_PROCEEDS_MODEL_BY_ID = new Map(
  REVENUE_PROCEEDS_MODELS.map((model) => [model.id, model]),
);

export function normalizeRevenueProceedsModel(
  value: string | null | undefined,
): RevenueProceedsModel {
  return value === "cohorted_all" || value === "new_proceeds"
    ? value
    : DEFAULT_REVENUE_PROCEEDS_MODEL;
}

export function getRevenueProceedsModelConfig(
  model: RevenueProceedsModel,
): RevenueProceedsModelConfig {
  return (
    REVENUE_PROCEEDS_MODEL_BY_ID.get(model) ??
    REVENUE_PROCEEDS_MODEL_BY_ID.get(DEFAULT_REVENUE_PROCEEDS_MODEL)!
  );
}

export type RevenueAttributionSourceRow = {
  label: string;
  rawLabel: string | null;
  kind: "tiktok" | "apple" | "paid" | "organic" | "renewal";
  revenue: number;
  share: number | null;
  spend: number | null;
  spendStatus?: "complete" | "partial" | "unavailable";
  installs: number | null;
  conversions: number | null;
};

type RevenueSpendStatus = "complete" | "partial" | "unavailable";

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
  paidSpendStatus?: RevenueSpendStatus;
  tiktokSpend: number | null;
  tiktokSpendStatus?: RevenueSpendStatus;
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
  proceedsModel: RevenueProceedsModel;
  startDate: string;
  endDate: string;
  timeZone: string;
  attributionDimension: "superwall_source";
  tiktokPatterns: string[];
  sourceProvider: "singular" | "superwall" | "none";
  appleSourceProvider: "adapty" | "superwall" | "singular" | "none";
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

export type AppleSearchAdsRevenueReport = {
  configured: boolean;
  conversions: number | null;
  installs: number | null;
  revenue: number | null;
  revenueBasis: "proceeds" | "net" | "gross" | null;
  rowCount: number;
  spend: number | null;
  warnings: string[];
};

export type NormalizedPoint = {
  date: string | null;
  value: number;
};

export type NormalizedSeries = {
  label: string | null;
  value: number;
  points: NormalizedPoint[];
  unit: string | null;
};

type MetricContainer = {
  metric: Record<string, unknown>;
  key: string;
};

type SuperwallMetricRow = {
  date: string;
  label: string;
  value: number | string;
};

type SuperwallAppleRow = {
  conversions: number | string | null;
  revenue: number | string | null;
  rowCount: number | string;
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
const SUPERWALL_REVENUE_TABLE = "open_revenue.attributed_events_by_ts_rep";

function escapeClickHouseString(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function toSqlString(value: string) {
  return `'${escapeClickHouseString(value)}'`;
}

function getExclusiveEndDate(endDate: string) {
  const parsed = new Date(`${endDate}T00:00:00.000Z`);

  if (Number.isNaN(parsed.getTime())) {
    return endDate;
  }

  parsed.setUTCDate(parsed.getUTCDate() + 1);
  return parsed.toISOString().slice(0, 10);
}

function getSuperwallScopeWhere(scope: SuperwallQueryScope) {
  return `applicationId IN (${scope.applicationIds.join(",")})`;
}

function getSuperwallDateWhere(args: {
  startDate: string;
  endDate: string;
  dateColumn: RevenueProceedsModelConfig["dateColumn"];
}) {
  const start = `${args.startDate} 00:00:00`;
  const end = `${getExclusiveEndDate(args.endDate)} 00:00:00`;

  return [
    `${args.dateColumn} >= toDateTime64(${toSqlString(start)}, 6, 'UTC')`,
    `${args.dateColumn} < toDateTime64(${toSqlString(end)}, 6, 'UTC')`,
  ].join(" AND ");
}

function getSuperwallChartAttributionWhere() {
  return "attributionEventId != ''";
}

function getSuperwallProductionWhere(scope: SuperwallQueryScope) {
  return [
    getSuperwallScopeWhere(scope),
    "isSandbox = 0",
    "environment = 'PRODUCTION'",
  ].join(" AND ");
}

function getSuperwallAppleSearchAdsCondition() {
  return [
    "lower(ifNull(appleSearchAdsAttribution, '')) IN ('true', '1')",
    "ifNull(appleSearchAdsCampaignId, '') != ''",
    "ifNull(appleSearchAdsCampaignName, '') != ''",
    "ifNull(appleSearchAdsOrgId, '') != ''",
  ].join(" OR ");
}

function toFiniteNumber(value: unknown) {
  const numberValue =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value.replace(/,/g, ""))
        : null;

  return typeof numberValue === "number" && Number.isFinite(numberValue)
    ? numberValue
    : null;
}

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

export function normalizeMetricSeries(payload: unknown) {
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
  const totalSeriesValue = getTotalSeriesValue(series);
  const total =
    getFirstNumber(container.metric, REVENUE_NUMBER_KEYS) ??
    totalSeriesValue ??
    series.reduce((sum, row) => sum + row.value, 0);

  return {
    metricKey: container.key,
    series: aggregateSeriesByLabel(series),
    total,
    unit,
  };
}

function buildMetricPayloadFromSuperwallRows(rows: SuperwallMetricRow[]) {
  const grouped = new Map<
    string,
    {
      points: Array<{ date: string; value: number }>;
      value: number;
    }
  >();
  const totalByDate = new Map<string, number>();

  for (const row of rows) {
    const value = toFiniteNumber(row.value) ?? 0;
    const label = row.label.trim() || "Unattributed";
    const existing = grouped.get(label) ?? {
      points: [],
      value: 0,
    };

    existing.points.push({
      date: row.date,
      value,
    });
    existing.value += value;
    grouped.set(label, existing);
    totalByDate.set(row.date, (totalByDate.get(row.date) ?? 0) + value);
  }

  const data = [...grouped.entries()].map(([name, series]) => ({
    data: aggregatePoints(series.points),
    name,
    unit: "USD",
    value: roundCurrency(series.value),
  }));
  const totalPoints = [...totalByDate.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, value]) => ({
      date,
      value: roundCurrency(value),
    }));
  const total = roundCurrency(
    totalPoints.reduce((sum, point) => sum + point.value, 0),
  );

  return {
    data: {
      proceeds: {
        data: [
          ...data,
          {
            data: totalPoints,
            name: "Total",
            unit: "USD",
            value: total,
          },
        ],
        unit: "USD",
        value: total,
      },
    },
  };
}

async function getSuperwallMetricPayloads(args: {
  credentials: SuperwallCredentialValue;
  endDate: string;
  proceedsModel: RevenueProceedsModel;
  scope: SuperwallQueryScope;
  startDate: string;
}) {
  const modelConfig = getRevenueProceedsModelConfig(args.proceedsModel);
  const where = [
    getSuperwallProductionWhere(args.scope),
    getSuperwallDateWhere({
      dateColumn: modelConfig.dateColumn,
      endDate: args.endDate,
      startDate: args.startDate,
    }),
    getSuperwallChartAttributionWhere(),
    `ifNull(${SUPERWALL_REVENUE_TABLE}.proceeds, 0) != 0`,
  ].join(" AND ");
  const appleCondition = getSuperwallAppleSearchAdsCondition();
  const periodRows = await superwallClient.queryJsonEachRow<SuperwallMetricRow>({
    credentials: args.credentials,
    organizationId: args.scope.organizationId,
    sql: `
      SELECT
        toString(toDate(${modelConfig.dateColumn}, 'UTC')) AS date,
        multiIf(
          ifNull(${SUPERWALL_REVENUE_TABLE}.proceeds, 0) < 0,
          'Renewal',
          name = 'renewal' AND isTrialConversion = 1,
          'Activation',
          name = 'initial_purchase' OR name = 'non_renewing_purchase',
          'Activation',
          name = 'renewal',
          'Renewal',
          'Other'
        ) AS label,
        round(sum(toFloat64(ifNull(${SUPERWALL_REVENUE_TABLE}.proceeds, 0))), 2) AS value
      FROM ${SUPERWALL_REVENUE_TABLE}
      WHERE ${where}
      GROUP BY date, label
      ORDER BY date, label
      FORMAT JSONEachRow
    `,
  });
  const sourceRows = await superwallClient.queryJsonEachRow<SuperwallMetricRow>({
    credentials: args.credentials,
    organizationId: args.scope.organizationId,
    sql: `
      SELECT
        toString(toDate(${modelConfig.dateColumn}, 'UTC')) AS date,
        if(${appleCondition}, 'Apple Search Ads', 'Organic / unattributed') AS label,
        round(sum(toFloat64(ifNull(${SUPERWALL_REVENUE_TABLE}.proceeds, 0))), 2) AS value
      FROM ${SUPERWALL_REVENUE_TABLE}
      WHERE ${where}
      GROUP BY date, label
      ORDER BY date, label
      FORMAT JSONEachRow
    `,
  });

  return {
    periodPayload: buildMetricPayloadFromSuperwallRows(periodRows),
    sourcePayload: buildMetricPayloadFromSuperwallRows(sourceRows),
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

function isTotalSeriesLabel(label: string | null) {
  return label?.trim().toLowerCase() === "total";
}

function getTotalSeriesValue(series: readonly NormalizedSeries[]) {
  const totalSeries = series.filter((row) => isTotalSeriesLabel(row.label));

  if (totalSeries.length === 0) {
    return null;
  }

  return totalSeries.reduce((total, row) => total + row.value, 0);
}

export function getRevenueTotalPointMap(series: readonly NormalizedSeries[]) {
  const totalSeries = series.filter((row) => isTotalSeriesLabel(row.label));

  if (totalSeries.length > 0) {
    return getMergedPointMap(totalSeries);
  }

  return getMergedPointMap(series);
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
    .filter((row) => !isTotalSeriesLabel(row.label))
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
      const hasSpend = row.points.some(
        (point) => point.spendAvailable !== false,
      );
      const hasMissingSpend = row.points.some(
        (point) => point.spendAvailable === false,
      );

      return {
        kind,
        label: row.label,
        rawLabel: row.source,
        revenue: row.revenue,
        share: args.totalRevenue > 0 ? row.revenue / args.totalRevenue : null,
        spend: hasSpend ? row.spend : null,
        spendStatus: hasMissingSpend
          ? hasSpend
            ? "partial"
            : "unavailable"
          : "complete",
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
            rawLabel: "superwall_renewal_events",
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

function buildAppleSearchAdsRow(args: {
  appleReport: AppleSearchAdsRevenueReport | AppleSearchAdsDashboardReport;
  fallbackRows: RevenueAttributionSourceRow[];
  rawLabel: string;
  totalRevenue: number;
}) {
  if (!args.appleReport.configured || args.appleReport.rowCount === 0) {
    return null;
  }

  const fallbackRevenue = args.fallbackRows.reduce(
    (total, row) => total + row.revenue,
    0,
  );
  const fallbackSpend = args.fallbackRows.reduce(
    (total, row) =>
      typeof row.spend === "number" && Number.isFinite(row.spend)
        ? total + row.spend
        : total,
    0,
  );
  const hasFallbackSpend = args.fallbackRows.some(
    (row) => typeof row.spend === "number" && Number.isFinite(row.spend),
  );
  const fallbackInstalls = args.fallbackRows.reduce(
    (total, row) =>
      typeof row.installs === "number" && Number.isFinite(row.installs)
        ? total + row.installs
        : total,
    0,
  );
  const hasFallbackInstalls = args.fallbackRows.some(
    (row) => typeof row.installs === "number" && Number.isFinite(row.installs),
  );
  const fallbackConversions = args.fallbackRows.reduce(
    (total, row) =>
      typeof row.conversions === "number" && Number.isFinite(row.conversions)
        ? total + row.conversions
        : total,
    0,
  );
  const hasFallbackConversions = args.fallbackRows.some(
    (row) =>
      typeof row.conversions === "number" && Number.isFinite(row.conversions),
  );
  const revenue = args.appleReport.revenue ?? fallbackRevenue;

  return {
    conversions:
      args.appleReport.conversions ??
      (hasFallbackConversions ? fallbackConversions : null),
    installs:
      args.appleReport.installs ??
      (hasFallbackInstalls ? fallbackInstalls : null),
    kind: "apple",
    label: "Apple Search Ads",
    rawLabel: args.rawLabel,
    revenue,
    share: args.totalRevenue > 0 ? revenue / args.totalRevenue : null,
    spend:
      args.appleReport.spend ?? (hasFallbackSpend ? fallbackSpend : null),
  } satisfies RevenueAttributionSourceRow;
}

export async function getAppleSearchAdsRevenueReport(args: {
  credentials: SuperwallCredentialValue;
  endDate: string;
  proceedsModel: RevenueProceedsModel;
  scope: SuperwallQueryScope;
  startDate: string;
}): Promise<AppleSearchAdsRevenueReport> {
  const modelConfig = getRevenueProceedsModelConfig(args.proceedsModel);
  const where = [
    getSuperwallProductionWhere(args.scope),
    getSuperwallDateWhere({
      dateColumn: modelConfig.dateColumn,
      endDate: args.endDate,
      startDate: args.startDate,
    }),
    getSuperwallChartAttributionWhere(),
    `(${getSuperwallAppleSearchAdsCondition()})`,
    `ifNull(${SUPERWALL_REVENUE_TABLE}.proceeds, 0) != 0`,
  ].join(" AND ");

  try {
    const [row] = await superwallClient.queryJsonEachRow<SuperwallAppleRow>({
      credentials: args.credentials,
      organizationId: args.scope.organizationId,
      sql: `
        SELECT
          count() AS rowCount,
          countIf(name IN ('initial_purchase', 'renewal', 'non_renewing_purchase') AND ifNull(${SUPERWALL_REVENUE_TABLE}.proceeds, 0) > 0) AS conversions,
          round(sum(toFloat64(ifNull(${SUPERWALL_REVENUE_TABLE}.proceeds, 0))), 2) AS revenue
        FROM ${SUPERWALL_REVENUE_TABLE}
        WHERE ${where}
        FORMAT JSONEachRow
      `,
    });
    const rowCount = toFiniteNumber(row?.rowCount) ?? 0;
    const revenue = toFiniteNumber(row?.revenue);

    return {
      configured: true,
      conversions: toFiniteNumber(row?.conversions),
      installs: null,
      revenue,
      revenueBasis: revenue === null ? null : "proceeds",
      rowCount,
      spend: null,
      warnings: [],
    };
  } catch (error) {
    return {
      configured: true,
      conversions: null,
      installs: null,
      revenue: null,
      revenueBasis: null,
      rowCount: 0,
      spend: null,
      warnings: [
        error instanceof Error
          ? error.message
          : "Could not load Superwall Apple Search Ads data.",
      ],
    };
  }
}

function buildDailyRows(args: {
  startDate: string;
  endDate: string;
  totalSeries: NormalizedSeries[];
  activationSeries?: NormalizedSeries[];
  renewalSeries?: NormalizedSeries[];
  appleChannelSeries?: NormalizedSeries[];
  separateRenewalsFromOrganic?: boolean;
  singularRows?: SingularSourceRevenueRow[];
  sourceSeries?: NormalizedSeries[];
  tiktokPatterns?: string[];
  applePatterns?: string[];
  creatorPatterns?: string[];
  excludeAppleRows?: boolean;
}) {
  const dateKeys = getInclusiveDateKeys(args.startDate, args.endDate);
  const totalMap = getRevenueTotalPointMap(args.totalSeries);
  const paidMap = new Map<string, number>();
  const tiktokMap = new Map<string, number>();
  const appleMap = new Map<string, number>();
  const activationMap = getMergedPointMap(args.activationSeries ?? []);
  const renewalMap = getMergedPointMap(args.renewalSeries ?? []);
  const paidSpendMap = new Map<string, number>();
  const tiktokSpendMap = new Map<string, number>();
  const missingPaidSpendDates = new Set<string>();
  const missingTiktokSpendDates = new Set<string>();
  const fallbackSourceSeries = (args.sourceSeries ?? []).filter(
    (row) => !isTotalSeriesLabel(row.label),
  );
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

        if (point.spendAvailable !== false) {
          paidSpendMap.set(
            utcDate,
            (paidSpendMap.get(utcDate) ?? 0) + point.spend,
          );
        } else {
          missingPaidSpendDates.add(utcDate);
        }

        if (isTikTokLabel(row.label, fallbackTikTokPatterns)) {
          tiktokMap.set(
            utcDate,
            (tiktokMap.get(utcDate) ?? 0) + point.revenue,
          );

          if (point.spendAvailable !== false) {
            tiktokSpendMap.set(
              utcDate,
              (tiktokSpendMap.get(utcDate) ?? 0) + point.spend,
            );
          } else {
            missingTiktokSpendDates.add(utcDate);
          }
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
  const firstTotalSeriesMap =
    args.totalSeries.find((row) => isTotalSeriesLabel(row.label))
      ? pointsToDateMap(
          args.totalSeries.find((row) => isTotalSeriesLabel(row.label))?.points ?? [],
        )
      : args.totalSeries[0]
        ? pointsToDateMap(args.totalSeries[0].points)
        : new Map<string, number>();

  return {
    hasSourceDailyBreakdown,
    rows: dateKeys.map<RevenueAttributionDailyRow>((date) => {
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
      const paidSpend =
        paidSpendMap.has(date)
          ? paidSpendMap.get(date) ?? 0
          : hasDailySpendBreakdown && !missingPaidSpendDates.has(date)
            ? 0
            : null;
      const paidSpendStatus: RevenueSpendStatus | null = missingPaidSpendDates.has(date)
        ? paidSpendMap.has(date)
          ? "partial"
          : "unavailable"
        : hasDailySpendBreakdown
          ? "complete"
          : null;
      const tiktokSpend =
        tiktokSpendMap.has(date)
          ? tiktokSpendMap.get(date) ?? 0
          : hasDailySpendBreakdown && !missingTiktokSpendDates.has(date)
            ? 0
            : null;
      const tiktokSpendStatus: RevenueSpendStatus | null = missingTiktokSpendDates.has(date)
        ? tiktokSpendMap.has(date)
          ? "partial"
          : "unavailable"
        : hasDailySpendBreakdown
          ? "complete"
          : null;
      const apple =
        hasSourceDailyBreakdown && appleMap.size > 0
          ? appleMap.get(date) ?? 0
          : null;
      const organic =
        hasSourceDailyBreakdown && paid !== null
          ? Math.max(
              total -
                paid -
                (args.separateRenewalsFromOrganic ? renewal ?? 0 : 0),
              0,
            )
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
        ...(paidSpendStatus ? { paidSpendStatus } : {}),
        tiktokSpend,
        ...(tiktokSpendStatus ? { tiktokSpendStatus } : {}),
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
    paidSpend: number | null;
    tiktok: number;
    tiktokSpend: number | null;
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
  const hasRawPaidSpendBreakdown = args.rows.some((row) => row.paidSpend !== null);
  const hasIncompleteRawPaidSpendBreakdown =
    hasRawPaidSpendBreakdown &&
    args.rows.some(
      (row) =>
        row.paidSpend === null ||
        row.paidSpendStatus === "partial" ||
        row.paidSpendStatus === "unavailable",
    );
  const paidSpendByDate =
    typeof args.totals.paidSpend === "number" && !hasIncompleteRawPaidSpendBreakdown
      ? allocateTotalByDailyWeights({
          dates,
          total: args.totals.paidSpend,
          weights: getDailyWeightMap(
            args.rows,
            (row) => row.paidSpend,
            hasRawPaidSpendBreakdown ? undefined : paidByDate,
          ),
        })
      : null;
  const tiktokByDate = allocateTotalByDailyWeights({
    dates,
    total: args.totals.tiktok,
    weights: getDailyWeightMap(args.rows, (row) => row.tiktok, totalWeights),
  });
  const hasRawTiktokSpendBreakdown = args.rows.some((row) => row.tiktokSpend !== null);
  const hasIncompleteRawTiktokSpendBreakdown =
    hasRawTiktokSpendBreakdown &&
    args.rows.some(
      (row) =>
        row.tiktokSpend === null ||
        row.tiktokSpendStatus === "partial" ||
        row.tiktokSpendStatus === "unavailable",
    );
  const tiktokSpendByDate =
    typeof args.totals.tiktokSpend === "number" &&
    !hasIncompleteRawTiktokSpendBreakdown
      ? allocateTotalByDailyWeights({
          dates,
          total: args.totals.tiktokSpend,
          weights: getDailyWeightMap(
            args.rows,
            (row) => row.tiktokSpend,
            hasRawTiktokSpendBreakdown ? undefined : tiktokByDate,
          ),
        })
      : null;
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
  const publishPaidSpend = Boolean(
    paidSpendByDate && (args.includeSourceBreakdown || hasRawPaidSpendBreakdown),
  );
  const publishTiktokSpend = Boolean(
    tiktokSpendByDate &&
      (args.includeSourceBreakdown || hasRawTiktokSpendBreakdown),
  );

  return args.rows.map((row) => ({
    ...row,
    apple: publishApple ? appleByDate.get(row.date) ?? 0 : null,
    newProceeds: newProceedsByDate.get(row.date) ?? 0,
    organic: publishOrganic ? organicByDate.get(row.date) ?? 0 : null,
    paid: publishPaid ? paidByDate.get(row.date) ?? 0 : null,
    paidSpend:
      hasIncompleteRawPaidSpendBreakdown
        ? row.paidSpend
        : publishPaidSpend
        ? row.paidSpend === null && hasRawPaidSpendBreakdown
          ? null
          : paidSpendByDate?.get(row.date) ?? 0
        : row.paidSpend,
    paidSpendStatus: hasIncompleteRawPaidSpendBreakdown
      ? row.paidSpendStatus ??
        (row.paidSpend === null ? "unavailable" : "partial")
      : publishPaidSpend
        ? "complete"
        : row.paidSpendStatus,
    renewal: renewalByDate.get(row.date) ?? 0,
    tiktok: publishTiktok ? tiktokByDate.get(row.date) ?? 0 : null,
    tiktokSpend:
      hasIncompleteRawTiktokSpendBreakdown
        ? row.tiktokSpend
        : publishTiktokSpend
        ? row.tiktokSpend === null && hasRawTiktokSpendBreakdown
          ? null
          : tiktokSpendByDate?.get(row.date) ?? 0
        : row.tiktokSpend,
    tiktokSpendStatus: hasIncompleteRawTiktokSpendBreakdown
      ? row.tiktokSpendStatus ??
        (row.tiktokSpend === null ? "unavailable" : "partial")
      : publishTiktokSpend
        ? "complete"
        : row.tiktokSpendStatus,
    total: totalByDate.get(row.date) ?? 0,
  }));
}

function getDailyRowsTotal(rows: RevenueAttributionDailyRow[]) {
  return roundCurrency(rows.reduce((total, row) => total + row.total, 0));
}

function getProviderTimeZoneRows(args: {
  proceedsModel?: RevenueProceedsModel;
  singularRows?: SingularSourceRevenueRow[];
}): RevenueProviderTimeZoneRow[] {
  const rows = new Map<string, RevenueProviderTimeZoneRow>();
  const modelConfig = getRevenueProceedsModelConfig(
    args.proceedsModel ?? DEFAULT_REVENUE_PROCEEDS_MODEL,
  );

  rows.set("superwall", {
    provider: "Superwall",
    source: "Proceeds analytics",
    timeZone: REVENUE_REPORT_TIME_ZONE,
    reconciliation: `Queried from Superwall ${modelConfig.dateBasisLabel} timestamps and bucketed by UTC report dates.`,
  });
  rows.set("singular-default", {
    provider: "Singular",
    source: "Paid source rows",
    timeZone: REVENUE_REPORT_TIME_ZONE,
    reconciliation:
      "Rows are treated as UTC unless a known source has a different provider calendar.",
  });
  rows.set("apple-search-ads", {
    provider: "Superwall",
    source: "Apple Search Ads",
    timeZone: REVENUE_REPORT_TIME_ZONE,
    reconciliation: "Apple Search Ads proceeds are attributed from Superwall revenue events.",
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
  proceedsModel?: RevenueProceedsModel;
}): Promise<RevenueAttributionReport> {
  const proceedsModel =
    args.proceedsModel ?? DEFAULT_REVENUE_PROCEEDS_MODEL;
  const modelConfig = getRevenueProceedsModelConfig(proceedsModel);
  const superwallCredentials = await getSuperwallCredentials(args.organizationSlug);

  if (!superwallCredentials.configured) {
    return getDefaultRevenueAttributionReport({
      startDate: args.startDate,
      endDate: args.endDate,
      proceedsModel,
    });
  }

  const credentials = superwallCredentials.value;
  const tiktokPatterns = splitCommaSeparatedList(credentials.tiktokSourcePatterns);
  const applePatterns = splitCommaSeparatedList(credentials.appleSourcePatterns);
  const creatorPatterns = splitCommaSeparatedList(credentials.creatorSourcePatterns);
  const attributionDimension = "superwall_source" as const;

  try {
    const scope = await superwallClient.resolveQueryScope(credentials);
    const [
      superwallMetricPayloads,
      singularSourceReport,
      appleSearchAdsReport,
      adaptyAppleSearchAdsReport,
    ] = await Promise.all([
      getSuperwallMetricPayloads({
        credentials,
        endDate: args.endDate,
        proceedsModel,
        scope,
        startDate: args.startDate,
      }),
      getSingularSourceRevenueReport({
        endDate: args.endDate,
        startDate: args.startDate,
      }),
      getAppleSearchAdsRevenueReport({
        credentials,
        endDate: args.endDate,
        proceedsModel,
        scope,
        startDate: args.startDate,
      }),
      getAppleSearchAdsDashboardReport({
        endDate: args.endDate,
        startDate: args.startDate,
      }),
    ]);
    const { periodPayload, sourcePayload } = superwallMetricPayloads;
    const periodMetric = normalizeMetricSeries(periodPayload);
    const sourceMetric = normalizeMetricSeries(sourcePayload);
    const periodRevenueSplit = getPeriodRevenueSplit(periodMetric.series);
    const superwallSourceRows = buildSourceRows({
      applePatterns,
      creatorPatterns,
      sourceSeries: sourceMetric.series,
      tiktokPatterns,
      totalRevenue: periodMetric.total,
    });
    const superwallAppleRows = superwallSourceRows.filter(
      (row) => row.kind === "apple" && row.revenue > 0,
    );
    const appleChannelSeries = sourceMetric.series.filter((row) =>
      isAppleAdsLabel(row.label, applePatterns),
    );
    let singularAppleRows: RevenueAttributionSourceRow[] = [];
    let appleSearchAdsRow = buildAppleSearchAdsRow({
      appleReport: appleSearchAdsReport,
      fallbackRows: superwallAppleRows,
      rawLabel: "superwall_apple_search_ads",
      totalRevenue: periodMetric.total,
    });
    let adaptyAppleSearchAdsRow = buildAppleSearchAdsRow({
      appleReport: adaptyAppleSearchAdsReport,
      fallbackRows: appleSearchAdsRow
        ? [appleSearchAdsRow]
        : superwallAppleRows,
      rawLabel: "adapty_apple_search_ads",
      totalRevenue: periodMetric.total,
    });
    let appleRows = adaptyAppleSearchAdsRow
      ? [adaptyAppleSearchAdsRow]
      : appleSearchAdsRow
        ? [appleSearchAdsRow]
        : superwallAppleRows;
    let sourceProvider: RevenueAttributionReport["sourceProvider"] = "none";
    let appleSourceProvider: RevenueAttributionReport["appleSourceProvider"] =
      adaptyAppleSearchAdsRow
        ? "adapty"
        : appleRows.length > 0
          ? "superwall"
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
    const renewalRevenueForAllocation = modelConfig.excludesRenewalsFromOrganic
      ? oldSourceRevenue
      : 0;
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
      singularAppleRows = singularRows.filter((row) => row.kind === "apple");
      appleSearchAdsRow = buildAppleSearchAdsRow({
        appleReport: appleSearchAdsReport,
        fallbackRows: [...superwallAppleRows, ...singularAppleRows],
        rawLabel: "superwall_apple_search_ads",
        totalRevenue: periodMetric.total,
      });
      adaptyAppleSearchAdsRow = buildAppleSearchAdsRow({
        appleReport: adaptyAppleSearchAdsReport,
        fallbackRows: appleSearchAdsRow
          ? [appleSearchAdsRow]
          : superwallAppleRows.length > 0
            ? superwallAppleRows
            : singularAppleRows,
        rawLabel: "adapty_apple_search_ads",
        totalRevenue: periodMetric.total,
      });
      appleRows = adaptyAppleSearchAdsRow
        ? [adaptyAppleSearchAdsRow]
        : appleSearchAdsRow
          ? [appleSearchAdsRow]
          : superwallAppleRows.length > 0
            ? superwallAppleRows
            : singularAppleRows;
      appleSourceProvider =
        adaptyAppleSearchAdsRow
          ? "adapty"
          : appleSearchAdsRow || superwallAppleRows.length > 0
            ? "superwall"
            : singularAppleRows.length > 0
              ? "singular"
              : "none";
      sourceRows = rebuildOrganicSourceRow({
        rows: [
          ...singularRows.filter(
            (row) =>
              row.kind !== "organic" &&
              row.kind !== "apple",
          ),
          ...appleRows,
        ],
        renewalRevenue: renewalRevenueForAllocation,
        totalRevenue,
      });
    } else {
      sourceProvider = "superwall";
      sourceRows = rebuildOrganicSourceRow({
        rows: [
          ...superwallSourceRows.filter(
            (row) => row.kind !== "organic" && row.kind !== "apple",
          ),
          ...appleRows,
        ],
        renewalRevenue: renewalRevenueForAllocation,
        totalRevenue,
      });
    }

    const paidRevenue = sourceRows
      .filter((row) => row.kind !== "organic" && row.kind !== "renewal")
      .reduce((total, row) => total + row.revenue, 0);
    const paidSpend = sourceRows
      .filter((row) => row.kind !== "organic" && row.kind !== "renewal")
      .reduce(
        (total, row) =>
          typeof row.spend === "number" && Number.isFinite(row.spend)
            ? total + row.spend
            : total,
        0,
      );
    const hasPaidSpend = sourceRows.some(
      (row) =>
        row.kind !== "organic" &&
        row.kind !== "renewal" &&
        typeof row.spend === "number" &&
        Number.isFinite(row.spend),
    );
    const tiktokRevenue = sourceRows
      .filter((row) => row.kind === "tiktok")
      .reduce((total, row) => total + row.revenue, 0);
    const tiktokSpend = sourceRows
      .filter((row) => row.kind === "tiktok")
      .reduce(
        (total, row) =>
          typeof row.spend === "number" && Number.isFinite(row.spend)
            ? total + row.spend
            : total,
        0,
      );
    const hasTiktokSpend = sourceRows.some(
      (row) =>
        row.kind === "tiktok" &&
        typeof row.spend === "number" &&
        Number.isFinite(row.spend),
    );
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
      renewalRevenue: renewalRevenueForAllocation,
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
      separateRenewalsFromOrganic: modelConfig.excludesRenewalsFromOrganic,
      singularRows: singularSourceReport.configured
        ? singularSourceReport.rows
        : undefined,
      sourceSeries: sourceMetric.series,
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
        newProceeds: newProceedsRevenue,
        organic: organicRevenue,
        paid: paidRevenue,
        paidSpend: hasPaidSpend ? paidSpend : null,
        renewal: oldSourceRevenue,
        tiktok: tiktokRevenue,
        tiktokSpend: hasTiktokSpend ? tiktokSpend : null,
        total: totalRevenue,
      },
    });
    const providerTimeZones = getProviderTimeZoneRows({
      proceedsModel,
      singularRows: singularSourceReport.configured
        ? singularSourceReport.rows
        : undefined,
    });
    const currency = getCurrency({
      periodSeries: periodMetric.series,
      periodUnit: periodMetric.unit,
      sourceSeries: sourceMetric.series,
      sourceUnit: sourceMetric.unit,
    });
    const warnings = normalizeWarnings([
      ...(periodMetric.metricKey && periodMetric.metricKey !== "proceeds"
        ? [
            `Superwall did not return a proceeds metric container for this date window, so ${periodMetric.metricKey} is being used instead.`,
          ]
        : []),
      ...singularSourceReport.warnings,
      ...(currency.currencies.length > 1
        ? [
            `Superwall returned multiple proceeds units (${currency.currencies.join(", ")}), so amounts are shown as plain numbers.`,
          ]
        : []),
      ...(sourceProvider === "superwall" && totalRevenue > 0 && tiktokRevenue === 0
        ? [
            "Superwall does not expose a TikTok paid-source split for this report, so TikTok proceeds require Singular source revenue.",
          ]
        : []),
      ...(singularSourceReport.configured && singularSourceReport.isPending
        ? [
            "Singular is still preparing the source proceeds report, so organic / UGC proceeds are hidden until the paid-source split is ready.",
          ]
        : []),
      ...adaptyAppleSearchAdsReport.warnings,
      ...(appleSourceProvider === "adapty"
        ? []
        : appleSearchAdsReport.warnings),
      ...getTimezoneWarnings({
        singularRows: singularSourceReport.configured
          ? singularSourceReport.rows
          : undefined,
      }),
      ...(appleSourceProvider === "superwall" &&
      appleSearchAdsReport.revenueBasis &&
      appleSearchAdsReport.revenueBasis !== "proceeds"
        ? [
            `Superwall did not return Apple Search Ads proceeds, so ${appleSearchAdsReport.revenueBasis} revenue is being used for Apple Search Ads.`,
          ]
        : []),
      ...(appleSourceProvider === "adapty" &&
      adaptyAppleSearchAdsReport.revenueBasis &&
      adaptyAppleSearchAdsReport.revenueBasis !== "proceeds"
        ? [
            `Adapty Ads Manager did not return Apple Search Ads proceeds, so ${adaptyAppleSearchAdsReport.revenueBasis} revenue is being used for Apple Search Ads.`,
          ]
        : []),
      ...(appleSourceProvider === "superwall" && !hasAppleSpend
        ? [
            "Superwall returned Apple Search Ads revenue without spend; Singular Apple Ads spend is used when available.",
          ]
        : []),
      ...sourceRows
        .filter((row) => row.spendStatus === "partial")
        .map(
          (row) =>
            `Singular spend is incomplete for ${row.label}; available spend is shown and profit may change when delayed cost rows arrive.`,
        ),
      ...(sourceProvider === "singular" && nonOrganicRevenue > totalRevenue
        ? [
            modelConfig.excludesRenewalsFromOrganic
              ? "Paid-source plus renewal proceeds are greater than Superwall total proceeds for this date window, so organic proceeds were clamped to zero."
              : "Paid-source proceeds are greater than Superwall total proceeds for this date window, so organic proceeds were clamped to zero.",
          ]
        : []),
      ...(totalRevenue > 0 && periodRevenueSplit.activationSeries.length === 0
        ? [
            "Superwall did not return activation proceeds for this date window, so new proceeds could not be split out from renewal proceeds.",
          ]
        : []),
      ...(totalRevenue > 0 && periodRevenueSplit.renewalSeries.length === 0
        ? [
            "Superwall did not return renewal proceeds for this date window, so renewal proceeds could not be split out.",
          ]
        : []),
      ...(oldSourceRevenue > renewalBucket.renewalBucket &&
      modelConfig.excludesRenewalsFromOrganic
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
      proceedsModel,
      providerTimeZones,
      singularCohortPeriod: singularSourceReport.configured
        ? singularSourceReport.cohortPeriod
        : null,
      singularConfigured: singularSourceReport.configured,
      singularPending: singularSourceReport.isPending,
      sourceProvider,
      appleSourceProvider,
      appleAdsDashboardConfigured:
        adaptyAppleSearchAdsReport.configured || appleSearchAdsReport.configured,
      appleAdsDashboardRowCount:
        appleSourceProvider === "adapty"
          ? adaptyAppleSearchAdsReport.rowCount
          : appleSearchAdsReport.rowCount,
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
        newProceeds: newProceedsRevenue,
        newShare:
          totalRevenue > 0 ? newProceedsRevenue / totalRevenue : null,
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
        proceedsModel,
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
        error instanceof SuperwallApiError || error instanceof Error
          ? error.message
          : "Could not load Superwall proceeds analytics.",
      ],
    };
  }
}

export function getDefaultRevenueAttributionReport(args: {
  startDate: string;
  endDate: string;
  proceedsModel?: RevenueProceedsModel;
}): RevenueAttributionReport {
  const proceedsModel =
    args.proceedsModel ?? DEFAULT_REVENUE_PROCEEDS_MODEL;

  return {
    attributionDimension: "superwall_source",
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
    proceedsModel,
    providerTimeZones: getProviderTimeZoneRows({ proceedsModel }),
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
