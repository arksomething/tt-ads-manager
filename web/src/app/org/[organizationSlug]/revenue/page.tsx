import Link from "next/link";

import { DashboardIcon } from "@/components/org-dashboard/org-icons";
import { type DashboardSearchParams } from "@/server/dashboard/filters";
import {
  getRevenueAttributionReport,
  type RevenueAttributionDailyRow,
  type RevenueAttributionReport,
  type RevenueAttributionSourceRow,
} from "@/server/adapty/revenue";

export const dynamic = "force-dynamic";

type RevenuePageProps = {
  params: Promise<{
    organizationSlug: string;
  }>;
  searchParams: Promise<DashboardSearchParams>;
};

const currencyFormatterCache = new Map<string, Intl.NumberFormat>();
const decimalFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 2,
});
const percentFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 1,
  style: "percent",
});
const dateFormatter = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

function getSearchParamValue(
  searchParams: DashboardSearchParams,
  key: string,
) {
  const value = searchParams[key];
  return Array.isArray(value) ? value[0] : value;
}

function toDateOnlyString(value: Date) {
  return value.toISOString().slice(0, 10);
}

function getDefaultStartDate() {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - 6);
  return toDateOnlyString(date);
}

function getDefaultEndDate() {
  return toDateOnlyString(new Date());
}

function normalizeDateInput(value: string | undefined, fallback: string) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return fallback;
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? fallback : value;
}

function normalizeDateRange(searchParams: DashboardSearchParams) {
  const fallbackStartDate = getDefaultStartDate();
  const fallbackEndDate = getDefaultEndDate();
  const startDate = normalizeDateInput(
    getSearchParamValue(searchParams, "startDate"),
    fallbackStartDate,
  );
  const endDate = normalizeDateInput(
    getSearchParamValue(searchParams, "endDate"),
    fallbackEndDate,
  );

  if (startDate > endDate) {
    return {
      endDate: startDate,
      startDate: endDate,
    };
  }

  return {
    endDate,
    startDate,
  };
}

function getCurrencyFormatter(currency: string) {
  const normalizedCurrency = currency.toUpperCase();
  const cached = currencyFormatterCache.get(normalizedCurrency);

  if (cached) {
    return cached;
  }

  const formatter = new Intl.NumberFormat("en-US", {
    currency: normalizedCurrency,
    maximumFractionDigits: 2,
    style: "currency",
  });

  currencyFormatterCache.set(normalizedCurrency, formatter);
  return formatter;
}

function formatAmount(value: number, currency: string | null) {
  if (currency && /^[A-Za-z]{3}$/.test(currency)) {
    return getCurrencyFormatter(currency).format(value);
  }

  return decimalFormatter.format(value);
}

function formatPercent(value: number | null) {
  return typeof value === "number" && Number.isFinite(value)
    ? percentFormatter.format(value)
    : "Unavailable";
}

function formatDate(value: string) {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? value : dateFormatter.format(parsed);
}

function StatCard(args: {
  icon: "payouts" | "integrations" | "creators" | "compare";
  label: string;
  meta: string;
  value: string;
}) {
  return (
    <article className="rounded-[1.25rem] border border-white/[0.08] bg-white/[0.03] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">
          {args.label}
        </p>
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-[0.75rem] border border-white/[0.08] bg-black/[0.22] text-muted-foreground">
          <DashboardIcon className="h-4 w-4" name={args.icon} />
        </span>
      </div>
      <p className="mt-3 text-2xl font-medium tracking-[-0.045em] text-foreground">
        {args.value}
      </p>
      <p className="mt-2 text-xs leading-5 text-muted-foreground">{args.meta}</p>
    </article>
  );
}

function SummaryPill(args: {
  label: string;
}) {
  return (
    <span className="rounded-full border border-white/[0.08] bg-black/[0.2] px-3 py-1.5 text-xs text-muted-foreground">
      {args.label}
    </span>
  );
}

function RevenueShareBar({ report }: { report: RevenueAttributionReport }) {
  const tiktokPercent = Math.max(0, Math.min(report.totals.tiktokShare ?? 0, 1));
  const ugcPercent = Math.max(0, Math.min(report.totals.ugcShare ?? 0, 1));

  return (
    <section className="rounded-[1.55rem] border border-white/[0.08] bg-white/[0.03] p-5 shadow-[0_24px_70px_rgba(0,0,0,0.2)] backdrop-blur">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.28em] text-muted-foreground">
            Attribution split
          </p>
          <h2 className="mt-2 text-xl font-medium tracking-[-0.04em] text-foreground">
            TikTok vs UGC revenue
          </h2>
        </div>
        <p className="text-sm text-muted-foreground">
          {formatPercent(report.totals.tiktokShare)} TikTok ·{" "}
          {formatPercent(report.totals.ugcShare)} UGC
        </p>
      </div>

      <div className="mt-5 h-4 overflow-hidden rounded-full border border-white/[0.08] bg-black/[0.24]">
        <div className="flex h-full w-full">
          <div
            className="h-full bg-[#79A8FF]"
            style={{ width: `${tiktokPercent * 100}%` }}
          />
          <div
            className="h-full bg-[#F8C972]"
            style={{ width: `${ugcPercent * 100}%` }}
          />
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-[1.05rem] border border-white/[0.08] bg-black/[0.18] p-3.5">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-[#79A8FF]" />
            <p className="text-sm font-medium text-foreground">TikTok</p>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            {formatAmount(report.totals.tiktok, report.currency)} attributed from
            matching Adapty segments.
          </p>
        </div>
        <div className="rounded-[1.05rem] border border-white/[0.08] bg-black/[0.18] p-3.5">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-[#F8C972]" />
            <p className="text-sm font-medium text-foreground">UGC</p>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            {formatAmount(report.totals.ugc, report.currency)} calculated as total
            revenue minus TikTok revenue.
          </p>
        </div>
      </div>
    </section>
  );
}

function buildLinePath(args: {
  rows: RevenueAttributionDailyRow[];
  maxValue: number;
  getValue: (row: RevenueAttributionDailyRow) => number | null;
}) {
  const width = 720;
  const height = 260;
  const paddingX = 28;
  const paddingY = 24;
  const usableWidth = width - paddingX * 2;
  const usableHeight = height - paddingY * 2;
  let path = "";

  args.rows.forEach((row, index) => {
    const value = args.getValue(row);

    if (value === null) {
      return;
    }

    const x =
      paddingX +
      (index * usableWidth) / Math.max(args.rows.length - 1, 1);
    const y =
      height -
      paddingY -
      (Math.max(value, 0) / Math.max(args.maxValue, 1)) * usableHeight;
    path += `${path ? " L" : "M"} ${x.toFixed(2)} ${y.toFixed(2)}`;
  });

  return path || null;
}

function RevenueTrendChart({ report }: { report: RevenueAttributionReport }) {
  const maxValue = Math.max(
    ...report.dailyRows.flatMap((row) => [
      row.total,
      row.tiktok ?? 0,
      row.ugc ?? 0,
    ]),
    1,
  );
  const totalPath = buildLinePath({
    getValue: (row) => row.total,
    maxValue,
    rows: report.dailyRows,
  });
  const tiktokPath = report.hasDailySourceBreakdown
    ? buildLinePath({
        getValue: (row) => row.tiktok,
        maxValue,
        rows: report.dailyRows,
      })
    : null;
  const ugcPath = report.hasDailySourceBreakdown
    ? buildLinePath({
        getValue: (row) => row.ugc,
        maxValue,
        rows: report.dailyRows,
      })
    : null;
  const firstDate = report.dailyRows[0]?.date;
  const lastDate = report.dailyRows[report.dailyRows.length - 1]?.date;

  return (
    <section className="rounded-[1.55rem] border border-white/[0.08] bg-white/[0.03] p-5 shadow-[0_24px_70px_rgba(0,0,0,0.2)] backdrop-blur">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.28em] text-muted-foreground">
            Daily trend
          </p>
          <h2 className="mt-2 text-xl font-medium tracking-[-0.04em] text-foreground">
            Revenue by day
          </h2>
        </div>
        <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-[#90FF4D]" />
            Total
          </span>
          <span className="inline-flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-[#79A8FF]" />
            TikTok
          </span>
          <span className="inline-flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-[#F8C972]" />
            UGC
          </span>
        </div>
      </div>

      <div className="mt-5 overflow-hidden rounded-[1.15rem] border border-white/[0.08] bg-black/[0.18] p-3">
        <svg
          aria-label="Daily revenue trend"
          className="h-72 w-full"
          preserveAspectRatio="none"
          role="img"
          viewBox="0 0 720 260"
        >
          <path d="M28 24 H692" stroke="rgba(255,255,255,0.08)" strokeWidth="1" />
          <path d="M28 130 H692" stroke="rgba(255,255,255,0.08)" strokeWidth="1" />
          <path d="M28 236 H692" stroke="rgba(255,255,255,0.08)" strokeWidth="1" />
          {totalPath ? (
            <path
              d={totalPath}
              fill="none"
              stroke="#90FF4D"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="3"
            />
          ) : null}
          {tiktokPath ? (
            <path
              d={tiktokPath}
              fill="none"
              stroke="#79A8FF"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2.5"
            />
          ) : null}
          {ugcPath ? (
            <path
              d={ugcPath}
              fill="none"
              stroke="#F8C972"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2.5"
            />
          ) : null}
        </svg>
      </div>

      <div className="mt-3 flex justify-between text-xs text-muted-foreground">
        <span>{firstDate ? formatDate(firstDate) : "Start"}</span>
        <span>{formatAmount(maxValue, report.currency)}</span>
        <span>{lastDate ? formatDate(lastDate) : "End"}</span>
      </div>
    </section>
  );
}

function SourceBadge({ kind }: { kind: RevenueAttributionSourceRow["kind"] }) {
  if (kind === "tiktok") {
    return (
      <span className="rounded-full border border-[#79A8FF]/25 bg-[#79A8FF]/10 px-2.5 py-1 text-[0.58rem] uppercase tracking-[0.2em] text-[#B8D0FF]">
        TikTok
      </span>
    );
  }

  if (kind === "unattributed") {
    return (
      <span className="rounded-full border border-white/[0.1] bg-white/[0.05] px-2.5 py-1 text-[0.58rem] uppercase tracking-[0.2em] text-muted-foreground">
        UGC
      </span>
    );
  }

  return (
    <span className="rounded-full border border-[#F8C972]/25 bg-[#F8C972]/10 px-2.5 py-1 text-[0.58rem] uppercase tracking-[0.2em] text-[#FFE4A3]">
      UGC
    </span>
  );
}

function SourceBreakdownTable({ report }: { report: RevenueAttributionReport }) {
  return (
    <section className="rounded-[1.55rem] border border-white/[0.08] bg-white/[0.03] p-5 shadow-[0_24px_70px_rgba(0,0,0,0.2)] backdrop-blur">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.28em] text-muted-foreground">
            Source table
          </p>
          <h2 className="mt-2 text-xl font-medium tracking-[-0.04em] text-foreground">
            Adapty attribution segments
          </h2>
        </div>
        <p className="text-sm text-muted-foreground">
          Segmented by {report.attributionDimension.replace(/_/g, " ")}
        </p>
      </div>

      {report.sourceRows.length > 0 ? (
        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[640px] border-separate border-spacing-0 text-left text-sm">
            <thead>
              <tr className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                <th className="border-b border-white/[0.08] px-3 py-3 font-medium">
                  Segment
                </th>
                <th className="border-b border-white/[0.08] px-3 py-3 font-medium">
                  Bucket
                </th>
                <th className="border-b border-white/[0.08] px-3 py-3 text-right font-medium">
                  Revenue
                </th>
                <th className="border-b border-white/[0.08] px-3 py-3 text-right font-medium">
                  Share
                </th>
              </tr>
            </thead>
            <tbody>
              {report.sourceRows.map((row) => (
                <tr key={`${row.kind}:${row.label}`} className="text-foreground">
                  <td className="border-b border-white/[0.06] px-3 py-3">
                    {row.label}
                  </td>
                  <td className="border-b border-white/[0.06] px-3 py-3">
                    <SourceBadge kind={row.kind} />
                  </td>
                  <td className="border-b border-white/[0.06] px-3 py-3 text-right font-medium">
                    {formatAmount(row.revenue, report.currency)}
                  </td>
                  <td className="border-b border-white/[0.06] px-3 py-3 text-right text-muted-foreground">
                    {formatPercent(row.share)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-5 text-sm leading-6 text-muted-foreground">
          Adapty returned no attribution segments for this date range.
        </p>
      )}
    </section>
  );
}

export default async function RevenuePage({
  params,
  searchParams,
}: RevenuePageProps) {
  const { organizationSlug } = await params;
  const resolvedSearchParams = await searchParams;
  const { startDate, endDate } = normalizeDateRange(resolvedSearchParams);
  const report = await getRevenueAttributionReport({
    endDate,
    startDate,
  });

  return (
    <div className="space-y-4">
      <section className="rounded-[1.55rem] border border-white/[0.08] bg-white/[0.03] p-5 shadow-[0_24px_70px_rgba(0,0,0,0.2)] backdrop-blur">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl">
            <p className="text-xs uppercase tracking-[0.28em] text-muted-foreground">
              Revenue attribution
            </p>
            <h1 className="mt-2 text-2xl font-medium tracking-[-0.045em] text-foreground">
              See how much revenue comes from TikTok and how much remains UGC.
            </h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Total revenue comes from Adapty. TikTok is classified from matching
              attribution segments, and UGC is calculated as total revenue minus
              TikTok revenue.
            </p>
          </div>

          <Link
            className="inline-flex min-h-11 items-center justify-center rounded-[0.95rem] border border-white/[0.12] bg-black/[0.24] px-4 text-sm font-medium text-foreground transition hover:border-white/[0.2]"
            href={`/org/${organizationSlug}/integrations`}
          >
            Manage connections
          </Link>
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          <SummaryPill label={`Adapty ${report.configured ? "connected" : "missing"}`} />
          <SummaryPill label={`${formatDate(startDate)} to ${formatDate(endDate)}`} />
          <SummaryPill label={`Matches ${report.tiktokPatterns.join(", ")}`} />
          <SummaryPill
            label={`Dimension ${report.attributionDimension.replace(/_/g, " ")}`}
          />
        </div>
      </section>

      <section className="rounded-[1.55rem] border border-white/[0.08] bg-white/[0.03] p-5 shadow-[0_24px_70px_rgba(0,0,0,0.2)] backdrop-blur">
        <p className="text-xs uppercase tracking-[0.28em] text-muted-foreground">
          Controls
        </p>

        <form
          className="mt-5 grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]"
          method="get"
        >
          <label className="block">
            <span className="mb-2 block text-xs uppercase tracking-[0.2em] text-muted-foreground">
              Start date
            </span>
            <input
              className="h-11 w-full rounded-[0.95rem] border border-white/[0.08] bg-black/[0.24] px-3.5 text-sm text-foreground outline-none transition focus:border-white/[0.16]"
              defaultValue={startDate}
              name="startDate"
              type="date"
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-xs uppercase tracking-[0.2em] text-muted-foreground">
              End date
            </span>
            <input
              className="h-11 w-full rounded-[0.95rem] border border-white/[0.08] bg-black/[0.24] px-3.5 text-sm text-foreground outline-none transition focus:border-white/[0.16]"
              defaultValue={endDate}
              name="endDate"
              type="date"
            />
          </label>

          <div className="flex items-end">
            <button
              className="inline-flex min-h-11 w-full items-center justify-center rounded-[0.95rem] border border-[#90FF4D]/20 bg-[#90FF4D]/90 px-4 text-sm font-medium text-black transition hover:bg-[#A4FF68] md:w-auto"
              type="submit"
            >
              Refresh revenue
            </button>
          </div>
        </form>
      </section>

      {!report.configured ? (
        <section className="rounded-[1.35rem] border border-[#FFD24D]/20 bg-[#FFD24D]/[0.08] p-4 text-sm leading-6 text-[#FFEAB1]">
          Add ADAPTY_API_KEY to the server environment to load mobile app revenue
          from Adapty.
        </section>
      ) : null}

      {report.warnings.length > 0 ? (
        <section className="rounded-[1.35rem] border border-[#FFD24D]/20 bg-[#FFD24D]/[0.08] p-4 text-sm text-[#FFEAB1]">
          <p className="text-xs uppercase tracking-[0.2em] text-[#FFEAB1]/80">
            Report warnings
          </p>
          <ul className="mt-2 space-y-1.5">
            {report.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon="payouts"
          label="Total revenue"
          meta="Adapty revenue for the selected purchase-date window"
          value={formatAmount(report.totals.total, report.currency)}
        />
        <StatCard
          icon="integrations"
          label="TikTok revenue"
          meta={`${formatPercent(report.totals.tiktokShare)} of total revenue`}
          value={formatAmount(report.totals.tiktok, report.currency)}
        />
        <StatCard
          icon="creators"
          label="UGC revenue"
          meta="Total revenue minus TikTok revenue"
          value={formatAmount(report.totals.ugc, report.currency)}
        />
        <StatCard
          icon="compare"
          label="TikTok share"
          meta={`${formatPercent(report.totals.ugcShare)} remains UGC`}
          value={formatPercent(report.totals.tiktokShare)}
        />
      </section>

      <RevenueShareBar report={report} />
      <RevenueTrendChart report={report} />
      <SourceBreakdownTable report={report} />
    </div>
  );
}
