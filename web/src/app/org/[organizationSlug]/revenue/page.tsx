import Link from "next/link";
import { redirect } from "next/navigation";

import { AdProfitAutoRefresh } from "@/components/org-dashboard/ad-profit-auto-refresh";
import {
  canAccessDashboardSection,
  getDefaultDashboardHrefForRole,
} from "@/components/org-dashboard/mock-data";
import { DashboardIcon } from "@/components/org-dashboard/org-icons";
import { RevenueProfitabilityClient } from "@/components/org-dashboard/revenue-profitability-client";
import { RevenueTrendChartClient } from "@/components/org-dashboard/revenue-trend-chart-client";
import { requireOrganizationMembership } from "@/server/auth/organizations";
import { type DashboardSearchParams } from "@/server/dashboard/filters";
import {
  getRevenueProceedsModelConfig,
  getRevenueAttributionReport,
  normalizeRevenueProceedsModel,
  REVENUE_PROCEEDS_MODELS,
  type RevenueAttributionReport,
  type RevenueAttributionSourceRow,
  type RevenueProceedsModel,
} from "@/server/revenue/revenue";

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

function buildRevenueModelHref(args: {
  organizationSlug: string;
  searchParams: DashboardSearchParams;
  startDate: string;
  endDate: string;
  proceedsModel: RevenueProceedsModel;
}) {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(args.searchParams)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        params.append(key, item);
      }
    } else if (typeof value === "string") {
      params.set(key, value);
    }
  }

  params.set("startDate", args.startDate);
  params.set("endDate", args.endDate);
  params.set("revenueModel", args.proceedsModel);

  return `/org/${args.organizationSlug}/revenue?${params.toString()}`;
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

function formatSignedAmount(value: number | null, currency: string | null) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "Unavailable";
  }

  const absoluteValue = formatAmount(Math.abs(value), currency);
  return value < 0 ? `-${absoluteValue}` : absoluteValue;
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
  const modelConfig = getRevenueProceedsModelConfig(report.proceedsModel);
  const separatesRenewals = modelConfig.excludesRenewalsFromOrganic;
  const paidPercent = Math.max(0, Math.min(report.totals.paidShare ?? 0, 1));
  const renewalPercent = Math.max(
    0,
    Math.min(
      separatesRenewals && report.totals.total > 0
        ? report.totals.renewalBucket / report.totals.total
        : 0,
      1,
    ),
  );
  const organicPercent = Math.max(
    0,
    Math.min(report.totals.organicShare ?? 0, 1),
  );

  return (
    <section className="rounded-[1.55rem] border border-white/[0.08] bg-white/[0.03] p-5 shadow-[0_24px_70px_rgba(0,0,0,0.2)] backdrop-blur">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.28em] text-muted-foreground">
            Attribution split
          </p>
          <h2 className="mt-2 text-xl font-medium tracking-[-0.04em] text-foreground">
            {separatesRenewals
              ? "Paid, renewals, and organic proceeds"
              : "Paid and organic cohorted proceeds"}
          </h2>
        </div>
        <p className="text-sm text-muted-foreground">
          {formatPercent(report.totals.paidShare)} paid ·{" "}
          {separatesRenewals
            ? `${formatPercent(
                report.totals.total > 0
                  ? report.totals.renewalBucket / report.totals.total
                  : null,
              )} renewal · `
            : ""}
          {formatPercent(report.totals.organicShare)} organic
        </p>
      </div>

      <div className="mt-5 h-4 overflow-hidden rounded-full border border-white/[0.08] bg-black/[0.24]">
        <div className="flex h-full w-full">
          <div
            className="h-full bg-[#79A8FF]"
            style={{ width: `${paidPercent * 100}%` }}
          />
          <div
            className="h-full bg-[#C8A26A]"
            style={{ width: `${renewalPercent * 100}%` }}
          />
          <div
            className="h-full bg-[#F8C972]"
            style={{ width: `${organicPercent * 100}%` }}
          />
        </div>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-3">
        <div className="rounded-[1.05rem] border border-white/[0.08] bg-black/[0.18] p-3.5">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-[#79A8FF]" />
            <p className="text-sm font-medium text-foreground">Paid sources</p>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            {formatAmount(report.totals.paid, report.currency)} attributed from
            {report.appleSourceProvider === "none"
              ? " TikTok, Snap, Facebook, and other supported source rows."
              : " TikTok, Apple Ads, Snap, Facebook, and other supported source rows."}
          </p>
        </div>
        <div className="rounded-[1.05rem] border border-white/[0.08] bg-black/[0.18] p-3.5">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-[#C8A26A]" />
            <p className="text-sm font-medium text-foreground">Renewals</p>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            {formatAmount(report.totals.renewal, report.currency)} renewal
            proceeds{" "}
            {separatesRenewals
              ? "identified by Superwall subscription events."
              : "included inside the cohorted source and organic buckets."}
          </p>
        </div>
        <div className="rounded-[1.05rem] border border-white/[0.08] bg-black/[0.18] p-3.5">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-[#F8C972]" />
            <p className="text-sm font-medium text-foreground">Organic / UGC</p>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            {formatAmount(report.totals.organic, report.currency)} calculated as
            {separatesRenewals
              ? " Superwall total proceeds minus paid-source and renewal proceeds."
              : " Superwall cohorted proceeds minus paid-source proceeds."}
          </p>
        </div>
      </div>
    </section>
  );
}

function RevenueTrendChart({ report }: { report: RevenueAttributionReport }) {
  const includeApple = report.appleSourceProvider !== "none";

  return (
    <section className="rounded-[1.55rem] border border-white/[0.08] bg-white/[0.03] p-5 shadow-[0_24px_70px_rgba(0,0,0,0.2)] backdrop-blur">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.28em] text-muted-foreground">
            Daily trend
          </p>
          <h2 className="mt-2 text-xl font-medium tracking-[-0.04em] text-foreground">
            Proceeds by day
          </h2>
        </div>
        <p className="text-sm text-muted-foreground">
          Hover a day for source breakdown, spend, profit, and ROAS
        </p>
      </div>

      <RevenueTrendChartClient
        currency={report.currency}
        hasDailySourceBreakdown={report.hasDailySourceBreakdown}
        includeApple={includeApple}
        rows={report.dailyRows}
      />
    </section>
  );
}

function SourceBadge({ kind }: { kind: RevenueAttributionSourceRow["kind"] }) {
  if (kind === "tiktok") {
    return (
      <span className="rounded-full border border-[#B9A7FF]/25 bg-[#B9A7FF]/10 px-2.5 py-1 text-[0.58rem] uppercase tracking-[0.2em] text-[#D8CFFF]">
        TikTok
      </span>
    );
  }

  if (kind === "apple") {
    return (
      <span className="rounded-full border border-[#FF8FB3]/25 bg-[#FF8FB3]/10 px-2.5 py-1 text-[0.58rem] uppercase tracking-[0.2em] text-[#FFD2DF]">
        Apple Ads
      </span>
    );
  }

  if (kind === "organic") {
    return (
      <span className="rounded-full border border-white/[0.1] bg-white/[0.05] px-2.5 py-1 text-[0.58rem] uppercase tracking-[0.2em] text-muted-foreground">
        Organic
      </span>
    );
  }

  if (kind === "renewal") {
    return (
      <span className="rounded-full border border-[#C8A26A]/25 bg-[#C8A26A]/10 px-2.5 py-1 text-[0.58rem] uppercase tracking-[0.2em] text-[#F2D9A8]">
        Renewal
      </span>
    );
  }

  return (
    <span className="rounded-full border border-[#79A8FF]/25 bg-[#79A8FF]/10 px-2.5 py-1 text-[0.58rem] uppercase tracking-[0.2em] text-[#B8D0FF]">
      Paid
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
            Proceeds by source
          </h2>
        </div>
        <p className="text-sm text-muted-foreground">
          {report.sourceProvider === "singular"
            ? `Singular ${report.singularCohortPeriod ?? ""} source split${
                report.appleSourceProvider === "superwall"
                  ? " plus Superwall Apple Search Ads"
                  : report.appleSourceProvider === "singular"
                    ? " plus Singular Apple Search Ads"
                  : ""
              }`
            : report.appleSourceProvider === "superwall"
              ? "Superwall source split plus Apple Search Ads"
              : "Superwall source split"}
        </p>
      </div>

      {report.sourceRows.length > 0 ? (
        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[840px] border-separate border-spacing-0 text-left text-sm">
            <thead>
              <tr className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                <th className="border-b border-white/[0.08] px-3 py-3 font-medium">
                  Segment
                </th>
                <th className="border-b border-white/[0.08] px-3 py-3 font-medium">
                  Bucket
                </th>
                <th className="border-b border-white/[0.08] px-3 py-3 text-right font-medium">
                  Proceeds
                </th>
                <th className="border-b border-white/[0.08] px-3 py-3 text-right font-medium">
                  Share
                </th>
                <th className="border-b border-white/[0.08] px-3 py-3 text-right font-medium">
                  Spend
                </th>
                <th className="border-b border-white/[0.08] px-3 py-3 text-right font-medium">
                  Installs
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
                  <td className="border-b border-white/[0.06] px-3 py-3 text-right text-muted-foreground">
                    {row.spend === null
                      ? "Unavailable"
                      : formatAmount(row.spend, report.currency)}
                  </td>
                  <td className="border-b border-white/[0.06] px-3 py-3 text-right text-muted-foreground">
                    {row.installs === null
                      ? "Unavailable"
                      : decimalFormatter.format(row.installs)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-5 text-sm leading-6 text-muted-foreground">
          No proceeds source rows were available for this date range.
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
  const membership = await requireOrganizationMembership(organizationSlug);

  if (!canAccessDashboardSection(membership.role, "revenue")) {
    redirect(getDefaultDashboardHrefForRole(organizationSlug, membership.role));
  }

  const resolvedSearchParams = await searchParams;
  const { startDate, endDate } = normalizeDateRange(resolvedSearchParams);
  const proceedsModel = normalizeRevenueProceedsModel(
    getSearchParamValue(resolvedSearchParams, "revenueModel"),
  );
  const proceedsModelConfig = getRevenueProceedsModelConfig(proceedsModel);
  const report = await getRevenueAttributionReport({
    endDate,
    organizationSlug,
    proceedsModel,
    startDate,
  });

  return (
    <div className="space-y-4">
      <section className="rounded-[1.55rem] border border-white/[0.08] bg-white/[0.03] p-5 shadow-[0_24px_70px_rgba(0,0,0,0.2)] backdrop-blur">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl">
            <p className="text-xs uppercase tracking-[0.28em] text-muted-foreground">
              Proceeds attribution
            </p>
            <h1 className="mt-2 text-2xl font-medium tracking-[-0.045em] text-foreground">
              Proceeds by paid source and organic lift.
            </h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Total proceeds use {proceedsModelConfig.description} Apple Ads
              proceeds use Superwall Apple Search Ads attribution when present.
              Renewal proceeds use Superwall renewal-type events: new purchases
              and trial conversions are new proceeds, renewals are
              existing-subscriber proceeds.
            </p>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Apple Search Ads spend is filled from Singular when its source
              report includes Apple Ads rows.
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
          <SummaryPill label={`Superwall ${report.configured ? "connected" : "missing"}`} />
          <SummaryPill
            label={`Singular ${report.singularConfigured ? (report.singularPending ? "preparing" : "connected") : "missing"}`}
          />
          <SummaryPill label={`${formatDate(startDate)} to ${formatDate(endDate)}`} />
          <SummaryPill label={`Timezone ${report.timeZone}`} />
          <SummaryPill label={`Model ${proceedsModelConfig.shortLabel}`} />
          <SummaryPill
            label={
              report.sourceProvider === "singular"
                ? `Sources Singular ${report.singularCohortPeriod ?? ""}`
                : `Sources ${report.attributionDimension.replace(/_/g, " ")}`
            }
          />
          <SummaryPill
            label={`Apple Ads ${
              report.appleSourceProvider === "superwall"
                ? `Superwall ${report.appleAdsDashboardRowCount} rows`
                : report.appleSourceProvider === "singular"
                  ? "Singular"
                : "not found"
            }`}
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
          <input name="revenueModel" type="hidden" value={proceedsModel} />
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
              Refresh proceeds
            </button>
          </div>
        </form>

        <div className="mt-5">
          <p className="mb-2 text-xs uppercase tracking-[0.2em] text-muted-foreground">
            Revenue model
          </p>
          <div className="grid gap-2 lg:grid-cols-2">
            {REVENUE_PROCEEDS_MODELS.map((model) => {
              const active = model.id === proceedsModel;

              return (
                <Link
                  className={`rounded-[0.95rem] border px-3.5 py-3 text-left transition ${
                    active
                      ? "border-[#90FF4D]/35 bg-[#90FF4D]/10 text-foreground"
                      : "border-white/[0.08] bg-black/[0.18] text-muted-foreground hover:border-white/[0.16] hover:text-foreground"
                  }`}
                  href={buildRevenueModelHref({
                    endDate,
                    organizationSlug,
                    proceedsModel: model.id,
                    searchParams: resolvedSearchParams,
                    startDate,
                  })}
                  key={model.id}
                >
                  <span className="block text-sm font-medium">
                    {model.label}
                  </span>
                  <span className="mt-1 block text-xs leading-5">
                    {model.description}
                  </span>
                </Link>
              );
            })}
          </div>
        </div>
      </section>

      {!report.configured ? (
        <section className="rounded-[1.35rem] border border-[#FFD24D]/20 bg-[#FFD24D]/[0.08] p-4 text-sm leading-6 text-[#FFEAB1]">
          Add SUPERWALL_API_KEY to the server environment to load mobile app
          proceeds from Superwall.
        </section>
      ) : null}

      <AdProfitAutoRefresh
        enabled={report.singularPending}
        label="Preparing proceeds report"
        message="Singular is preparing the source proceeds report."
      />

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

      {report.providerTimeZones.length > 0 ? (
        <section className="rounded-[1.35rem] border border-white/[0.08] bg-white/[0.03] p-4 text-sm text-muted-foreground">
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
            Timezone reconciliation
          </p>
          <div className="mt-3 grid gap-2 lg:grid-cols-2">
            {report.providerTimeZones.map((row) => (
              <div
                key={`${row.provider}-${row.source}-${row.timeZone}`}
                className="rounded-[1rem] border border-white/[0.08] bg-black/[0.18] px-3 py-2.5"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium text-foreground">
                    {row.provider} · {row.source}
                  </p>
                  <span className="rounded-full border border-white/[0.08] bg-white/[0.04] px-2.5 py-1 text-[0.62rem] uppercase tracking-[0.16em] text-muted-foreground">
                    {row.timeZone}
                  </span>
                </div>
                <p className="mt-1.5 text-xs leading-5">{row.reconciliation}</p>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon="payouts"
          label="Total proceeds"
          meta={`Net attributed Superwall proceeds for the selected ${proceedsModelConfig.dateBasisLabel} window`}
          value={formatAmount(report.totals.total, report.currency)}
        />
        <StatCard
          icon="payouts"
          label="New proceeds"
          meta={`${formatPercent(report.totals.newShare)} of total after renewals`}
          value={formatAmount(report.totals.newProceeds, report.currency)}
        />
        <StatCard
          icon="payouts"
          label="Renewal proceeds"
          meta={`${formatPercent(report.totals.renewalShare)} of total proceeds`}
          value={formatAmount(report.totals.renewal, report.currency)}
        />
        <StatCard
          icon="integrations"
          label="Paid proceeds"
          meta={`${formatPercent(report.totals.paidShare)} of total proceeds`}
          value={formatAmount(report.totals.paid, report.currency)}
        />
        <StatCard
          icon="compare"
          label="TikTok proceeds"
          meta={`${formatPercent(report.totals.tiktokShare)} of total proceeds`}
          value={formatAmount(report.totals.tiktok, report.currency)}
        />
        <StatCard
          icon="compare"
          label="Apple Ads proceeds"
          meta={
            report.appleSourceProvider === "none"
              ? "No Apple Search Ads revenue found"
              : report.appleSourceProvider === "superwall"
                ? `${formatPercent(report.totals.appleShare)} of total proceeds from Superwall Apple Search Ads`
                : `${formatPercent(report.totals.appleShare)} of total proceeds from Singular Apple Search Ads`
          }
          value={
            report.appleSourceProvider === "none"
              ? "Unavailable"
              : formatAmount(report.totals.apple, report.currency)
          }
        />
        <StatCard
          icon="integrations"
          label="Apple Ads cost"
          meta={
            report.totals.appleSpend === null
              ? "Apple Search Ads spend unavailable"
              : `${formatSignedAmount(report.totals.appleProfit, report.currency)} profit · ${formatPercent(report.totals.appleRoas)} ROAS`
          }
          value={
            report.totals.appleSpend === null
              ? "Unavailable"
              : formatAmount(report.totals.appleSpend, report.currency)
          }
        />
        <StatCard
          icon="creators"
          label="Organic / UGC proceeds"
          meta={
            proceedsModelConfig.excludesRenewalsFromOrganic
              ? `${formatPercent(report.totals.organicShare)} remains after paid + renewals`
              : `${formatPercent(report.totals.organicShare)} remains after paid; renewals included`
          }
          value={formatAmount(report.totals.organic, report.currency)}
        />
      </section>

      <RevenueShareBar report={report} />
      <RevenueTrendChart report={report} />
      <RevenueProfitabilityClient
        endDate={endDate}
        organizationSlug={organizationSlug}
        revenueModel={proceedsModel}
        searchParams={resolvedSearchParams}
        startDate={startDate}
      />
      <SourceBreakdownTable report={report} />
    </div>
  );
}
