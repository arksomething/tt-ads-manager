"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from "recharts";

export type RevenueTrendChartPoint = {
  apple: number | null;
  date: string;
  newProceeds: number | null;
  organic: number | null;
  paid: number | null;
  paidSpend: number | null;
  renewal: number | null;
  tiktok: number | null;
  total: number;
};

type RevenueTrendChartClientProps = {
  currency: string | null;
  hasDailySourceBreakdown: boolean;
  includeApple: boolean;
  rows: RevenueTrendChartPoint[];
};

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});
const compactFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 1,
  notation: "compact",
});
const currencyFormatterCache = new Map<string, Intl.NumberFormat>();

const SERIES = [
  { color: "#90FF4D", key: "total", label: "Total" },
  { color: "#79A8FF", key: "paid", label: "Paid" },
  { color: "#B9A7FF", key: "tiktok", label: "TikTok" },
  { color: "#FF8FB3", key: "apple", label: "Apple Ads" },
  { color: "#C8A26A", key: "renewal", label: "Renewal" },
  { color: "#F8C972", key: "organic", label: "Organic" },
] as const;

function getCurrencyFormatter(currency: string | null) {
  const currencyCode = currency || "USD";
  const existing = currencyFormatterCache.get(currencyCode);

  if (existing) {
    return existing;
  }

  const formatter = new Intl.NumberFormat("en-US", {
    currency: currencyCode,
    maximumFractionDigits: 2,
    style: "currency",
  });
  currencyFormatterCache.set(currencyCode, formatter);

  return formatter;
}

function formatCurrency(value: number | null | undefined, currency: string | null) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "Unavailable";
  }

  return getCurrencyFormatter(currency).format(value);
}

function formatCompactCurrency(value: number, currency: string | null) {
  if (!Number.isFinite(value)) {
    return "";
  }

  return `${currency || "USD"} ${compactFormatter.format(value)}`;
}

function formatDate(value: string) {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? value : dateFormatter.format(parsed);
}

function getRoas(proceeds: number, spend: number | null) {
  if (typeof spend !== "number" || !Number.isFinite(spend) || spend <= 0) {
    return null;
  }

  return proceeds / spend;
}

function TooltipContent({
  active,
  currency,
  includeApple,
  payload,
}: TooltipContentProps & {
  currency: string | null;
  includeApple: boolean;
}) {
  if (!active || !payload?.length) {
    return null;
  }

  const row = payload[0]?.payload as RevenueTrendChartPoint | undefined;

  if (!row) {
    return null;
  }

  const visibleSeries = SERIES.filter(
    (series) => includeApple || series.key !== "apple",
  );
  const roas = getRoas(row.total, row.paidSpend);

  return (
    <div className="min-w-64 rounded-[0.9rem] border border-white/[0.1] bg-[#09090B]/95 p-3 text-sm shadow-[0_18px_45px_rgba(0,0,0,0.38)] backdrop-blur">
      <div className="flex items-start justify-between gap-4 border-b border-white/[0.08] pb-2">
        <div>
          <p className="text-[0.62rem] uppercase tracking-[0.2em] text-muted-foreground">
            Day
          </p>
          <p className="mt-1 font-medium text-foreground">{formatDate(row.date)}</p>
        </div>
        <div className="text-right">
          <p className="text-[0.62rem] uppercase tracking-[0.2em] text-muted-foreground">
            ROAS
          </p>
          <p className="mt-1 font-medium text-foreground">
            {roas === null ? "Unavailable" : `${roas.toFixed(2)}x`}
          </p>
        </div>
      </div>

      <div className="mt-2 space-y-1.5">
        {visibleSeries.map((series) => {
          const value = row[series.key];

          return (
            <div className="flex items-center justify-between gap-5" key={series.key}>
              <span className="inline-flex items-center gap-2 text-muted-foreground">
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: series.color }}
                />
                {series.label}
              </span>
              <span className="font-medium text-foreground">
                {formatCurrency(value, currency)}
              </span>
            </div>
          );
        })}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 border-t border-white/[0.08] pt-2 text-xs">
        <div>
          <p className="uppercase tracking-[0.16em] text-muted-foreground">
            Paid spend
          </p>
          <p className="mt-1 font-medium text-foreground">
            {formatCurrency(row.paidSpend, currency)}
          </p>
        </div>
        <div>
          <p className="uppercase tracking-[0.16em] text-muted-foreground">
            New proceeds
          </p>
          <p className="mt-1 font-medium text-foreground">
            {formatCurrency(row.newProceeds, currency)}
          </p>
        </div>
        <div>
          <p className="uppercase tracking-[0.16em] text-muted-foreground">
            Paid profit
          </p>
          <p className="mt-1 font-medium text-foreground">
            {typeof row.paidSpend === "number"
              ? formatCurrency(row.total - row.paidSpend, currency)
              : "Unavailable"}
          </p>
        </div>
      </div>
    </div>
  );
}

export function RevenueTrendChartClient({
  currency,
  hasDailySourceBreakdown,
  includeApple,
  rows,
}: RevenueTrendChartClientProps) {
  const chartRows = rows.map((row) => ({
    ...row,
    dateLabel: formatDate(row.date),
  }));
  const plottedSeries = SERIES.filter((series) => {
    if (series.key === "apple" && !includeApple) {
      return false;
    }

    return series.key === "total" || hasDailySourceBreakdown;
  });

  return (
    <div className="mt-5">
      <div className="h-80 rounded-[1.15rem] border border-white/[0.08] bg-black/[0.18] px-2 py-4 sm:px-4">
        <ResponsiveContainer height="100%" width="100%">
          <LineChart
            data={chartRows}
            margin={{ bottom: 4, left: 0, right: 18, top: 10 }}
          >
            <CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} />
            <XAxis
              axisLine={false}
              dataKey="dateLabel"
              minTickGap={18}
              stroke="rgba(255,255,255,0.38)"
              tick={{ fill: "rgba(255,255,255,0.55)", fontSize: 11 }}
              tickLine={false}
            />
            <YAxis
              axisLine={false}
              stroke="rgba(255,255,255,0.38)"
              tick={{ fill: "rgba(255,255,255,0.55)", fontSize: 11 }}
              tickFormatter={(value) => formatCompactCurrency(Number(value), currency)}
              tickLine={false}
              width={74}
            />
            <Tooltip
              content={(props) => (
                <TooltipContent
                  {...props}
                  currency={currency}
                  includeApple={includeApple}
                />
              )}
              cursor={{
                stroke: "rgba(255,255,255,0.28)",
                strokeDasharray: "4 5",
                strokeWidth: 1,
              }}
            />
            {plottedSeries.map((series) => (
              <Line
                activeDot={{
                  r: series.key === "total" ? 5 : 4,
                  stroke: "#050506",
                  strokeWidth: 2,
                }}
                connectNulls
                dataKey={series.key}
                dot={false}
                key={series.key}
                name={series.label}
                stroke={series.color}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={series.key === "total" ? 3 : 2}
                type="monotone"
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted-foreground">
        {plottedSeries.map((series) => (
          <span className="inline-flex items-center gap-2" key={series.key}>
            <span
              className="h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: series.color }}
            />
            {series.label}
          </span>
        ))}
      </div>
    </div>
  );
}
