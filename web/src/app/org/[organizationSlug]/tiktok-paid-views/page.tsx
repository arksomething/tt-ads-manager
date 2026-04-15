import Link from "next/link";

import { prisma } from "@/lib/db";
import { type DashboardSearchParams } from "@/server/dashboard/filters";
import {
  type TikTokAdAttributionMatchMode,
  type TikTokAdProfitabilityRow,
} from "@/server/tiktok-business/ad-profitability";
import {
  getTopAdsForOrganization,
  type TikTokPaidViewMetric,
} from "@/server/tiktok-business/reporting";

export const dynamic = "force-dynamic";

type TikTokPaidViewsPageProps = {
  params: Promise<{
    organizationSlug: string;
  }>;
  searchParams: Promise<DashboardSearchParams>;
};

type TopAdsSortKey =
  | "performance"
  | "paidMetric"
  | "profit"
  | "revenue"
  | "roas"
  | "installs";

const metricOptions: Array<{
  value: TikTokPaidViewMetric;
  label: string;
  hint: string;
}> = [
  {
    value: "impressions",
    label: "Impressions",
    hint: "Times your paid Spark ads were served.",
  },
  {
    value: "videoPlayActions",
    label: "Video play actions",
    hint: "Paid video starts captured by TikTok reporting.",
  },
];

const metricDisplayCopy = {
  impressions: {
    totalLabel: "Total paid impressions",
    shortLabel: "Paid impressions",
    rowValueLabel: "Impressions",
  },
  videoPlayActions: {
    totalLabel: "Total paid video plays",
    shortLabel: "Paid video plays",
    rowValueLabel: "Video plays",
  },
} as const;

const matchModeOptions: Array<{
  value: TikTokAdAttributionMatchMode;
  label: string;
  hint: string;
}> = [
  {
    value: "best_effort",
    label: "Best effort",
    hint: "Allows ad-name fallback when Spark IDs or post URLs are missing.",
  },
  {
    value: "exact",
    label: "Exact only",
    hint: "Only keeps exact Spark or post matches for revenue attribution.",
  },
];

const sortOptions: Array<{
  value: TopAdsSortKey;
  label: string;
  hint: string;
}> = [
  {
    value: "performance",
    label: "Smart sort",
    hint: "Matched ads rank by profit first. Unmatched ads fall back to paid delivery.",
  },
  {
    value: "paidMetric",
    label: "Paid delivery",
    hint: "Ranks by the selected TikTok paid metric only.",
  },
  {
    value: "profit",
    label: "Profit",
    hint: "Ranks by Singular revenue minus spend.",
  },
  {
    value: "revenue",
    label: "Revenue",
    hint: "Ranks by Singular-attributed revenue.",
  },
  {
    value: "roas",
    label: "ROAS",
    hint: "Ranks by revenue over spend.",
  },
  {
    value: "installs",
    label: "Installs",
    hint: "Ranks by attributed installs.",
  },
];

const numberFormatter = new Intl.NumberFormat("en-US");
const decimalFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 2,
});
const ratioFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 2,
});
const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});
const currencyFormatterCache = new Map<string, Intl.NumberFormat>();

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
  date.setUTCDate(date.getUTCDate() - 29);
  return toDateOnlyString(date);
}

function getDefaultEndDate() {
  return toDateOnlyString(new Date());
}

function normalizeMetric(value: string | undefined): TikTokPaidViewMetric {
  return value === "videoPlayActions" ? "videoPlayActions" : "impressions";
}

function normalizeMatchMode(
  value: string | undefined,
): TikTokAdAttributionMatchMode {
  return value === "exact" ? "exact" : "best_effort";
}

function normalizeSortKey(value: string | undefined): TopAdsSortKey {
  switch (value) {
    case "paidMetric":
    case "profit":
    case "revenue":
    case "roas":
    case "installs":
      return value;
    default:
      return "performance";
  }
}

function parseReportDate(value: string | null) {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();

  if (trimmed.length === 0) {
    return null;
  }

  const directMatch = trimmed.match(
    /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}:\d{2}))?$/,
  );

  if (directMatch) {
    const [, datePart, timePart] = directMatch;
    const parsed = new Date(`${datePart}T${timePart ?? "00:00:00"}.000Z`);

    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatDate(value: string | Date | null) {
  if (!value) {
    return "Unknown";
  }

  const parsed =
    value instanceof Date
      ? value
      : parseReportDate(value) ?? new Date(`${value}T00:00:00.000Z`);

  return Number.isNaN(parsed.getTime()) ? String(value) : dateFormatter.format(parsed);
}

function formatDateRange(startDate: string | null, endDate: string | null) {
  if (!startDate && !endDate) {
    return "Unknown";
  }

  const startLabel = formatDate(startDate);
  const endLabel = formatDate(endDate);

  return startLabel === endLabel ? startLabel : `${startLabel} to ${endLabel}`;
}

function getCurrencyFormatter(currency: string) {
  const normalizedCurrency = currency.toUpperCase();
  const existingFormatter = currencyFormatterCache.get(normalizedCurrency);

  if (existingFormatter) {
    return existingFormatter;
  }

  const formatter = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: normalizedCurrency,
    maximumFractionDigits: 2,
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

function formatRoas(value: number | null) {
  return typeof value === "number" && Number.isFinite(value)
    ? `${ratioFormatter.format(value)}x`
    : "Unavailable";
}

function getMetricDisplayCopy(metric: TikTokPaidViewMetric) {
  return metricDisplayCopy[metric];
}

function getSingleCurrency(rows: readonly TikTokAdProfitabilityRow[]) {
  const currencies = [
    ...new Set(
      rows
        .map((row) => row.singular.currency?.trim().toUpperCase())
        .filter((value): value is string => Boolean(value)),
    ),
  ];

  return currencies.length === 1 ? currencies[0] : null;
}

function getNullableNumberSortValue(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : Number.NEGATIVE_INFINITY;
}

function compareAds(
  left: TikTokAdProfitabilityRow,
  right: TikTokAdProfitabilityRow,
  sortKey: TopAdsSortKey,
) {
  const leftLastSeen = parseReportDate(left.lastDate)?.getTime() ?? 0;
  const rightLastSeen = parseReportDate(right.lastDate)?.getTime() ?? 0;
  const finish = () =>
    rightLastSeen - leftLastSeen || left.title.localeCompare(right.title);

  switch (sortKey) {
    case "paidMetric":
      return right.totalValue - left.totalValue || finish();
    case "profit":
      return right.singular.profit - left.singular.profit || right.totalValue - left.totalValue || finish();
    case "revenue":
      return right.singular.revenue - left.singular.revenue || right.totalValue - left.totalValue || finish();
    case "roas":
      return (
        getNullableNumberSortValue(right.singular.roas) -
          getNullableNumberSortValue(left.singular.roas) ||
        right.singular.profit - left.singular.profit ||
        right.totalValue - left.totalValue ||
        finish()
      );
    case "installs":
      return right.singular.installs - left.singular.installs || right.totalValue - left.totalValue || finish();
    default: {
      const leftMatched = left.singular.matchedRowCount > 0 ? 1 : 0;
      const rightMatched = right.singular.matchedRowCount > 0 ? 1 : 0;

      if (rightMatched !== leftMatched) {
        return rightMatched - leftMatched;
      }

      if (leftMatched === 1) {
        return (
          right.singular.profit - left.singular.profit ||
          getNullableNumberSortValue(right.singular.roas) -
            getNullableNumberSortValue(left.singular.roas) ||
          right.singular.revenue - left.singular.revenue ||
          right.totalValue - left.totalValue ||
          finish()
        );
      }

      return right.totalValue - left.totalValue || finish();
    }
  }
}

function sortAds(
  ads: readonly TikTokAdProfitabilityRow[],
  sortKey: TopAdsSortKey,
) {
  return [...ads].sort((left, right) => compareAds(left, right, sortKey));
}

function getMatchBadgeLabel(row: TikTokAdProfitabilityRow) {
  switch (row.singular.matchLevel) {
    case "exact_item_id":
      return "Exact Spark ID";
    case "exact_post_url":
      return "Exact post URL";
    case "name_fallback":
      return "Name fallback";
    default:
      return row.singular.configured ? "Unavailable" : "Singular off";
  }
}

function getMatchBadgeClassName(row: TikTokAdProfitabilityRow) {
  switch (row.singular.matchLevel) {
    case "exact_item_id":
    case "exact_post_url":
      return "border-[#4DA3FF]/20 bg-[#4DA3FF]/[0.08] text-[#D8ECFF]";
    case "name_fallback":
      return "border-[#FFD24D]/20 bg-[#FFD24D]/[0.08] text-[#FFEAB1]";
    default:
      return "border-white/[0.08] bg-white/[0.04] text-muted-foreground";
  }
}

function getHighlightValueLabel(args: {
  row: TikTokAdProfitabilityRow;
  metric: TikTokPaidViewMetric;
  highlight: "paidMetric" | "profit" | "roas";
}) {
  switch (args.highlight) {
    case "profit":
      return formatAmount(args.row.singular.profit, args.row.singular.currency);
    case "roas":
      return formatRoas(args.row.singular.roas);
    default:
      return numberFormatter.format(args.row.totalValue);
  }
}

function getHighlightMetaLabel(args: {
  row: TikTokAdProfitabilityRow;
  metric: TikTokPaidViewMetric;
  highlight: "paidMetric" | "profit" | "roas";
}) {
  switch (args.highlight) {
    case "profit":
      return `${formatAmount(args.row.singular.revenue, args.row.singular.currency)} revenue on ${formatAmount(args.row.singular.spend, args.row.singular.currency)} spend`;
    case "roas":
      return `${formatAmount(args.row.singular.profit, args.row.singular.currency)} profit`;
    default:
      return `${numberFormatter.format(args.row.itemIds.length)} Spark ID${args.row.itemIds.length === 1 ? "" : "s"} · ${getMetricDisplayCopy(args.metric).shortLabel.toLowerCase()}`;
  }
}

function getBackgroundImageStyle(imageUrl: string) {
  return {
    backgroundImage: `url(${JSON.stringify(imageUrl)})`,
    backgroundPosition: "center",
    backgroundRepeat: "no-repeat",
    backgroundSize: "cover",
  } as const;
}

function StatCard(args: {
  label: string;
  value: string;
  meta: string;
}) {
  return (
    <article className="rounded-[1.15rem] border border-white/[0.08] bg-black/[0.22] p-4">
      <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
        {args.label}
      </p>
      <p className="mt-2 text-xl font-medium tracking-[-0.04em] text-foreground">
        {args.value}
      </p>
      <p className="mt-2 text-xs leading-5 text-muted-foreground">{args.meta}</p>
    </article>
  );
}

function TopAdHighlightCard(args: {
  title: string;
  description: string;
  highlight: "paidMetric" | "profit" | "roas";
  metric: TikTokPaidViewMetric;
  row: TikTokAdProfitabilityRow | null;
}) {
  const toneClassName =
    args.highlight === "profit"
      ? "border-[#90FF4D]/20 bg-[linear-gradient(140deg,rgba(144,255,77,0.12),rgba(255,255,255,0.03))]"
      : args.highlight === "roas"
        ? "border-[#FFD24D]/20 bg-[linear-gradient(140deg,rgba(255,210,77,0.12),rgba(255,255,255,0.03))]"
        : "border-[#4DA3FF]/20 bg-[linear-gradient(140deg,rgba(77,163,255,0.12),rgba(255,255,255,0.03))]";

  if (!args.row) {
    return (
      <article
        className={`rounded-[1.35rem] border p-4 shadow-[0_24px_70px_rgba(0,0,0,0.2)] backdrop-blur ${toneClassName}`}
      >
        <p className="text-xs uppercase tracking-[0.24em] text-muted-foreground">
          {args.title}
        </p>
        <h3 className="mt-2 text-lg font-medium tracking-[-0.03em] text-foreground">
          No qualifying ad yet
        </h3>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          {args.description}
        </p>
      </article>
    );
  }

  return (
    <article
      className={`rounded-[1.35rem] border p-4 shadow-[0_24px_70px_rgba(0,0,0,0.2)] backdrop-blur ${toneClassName}`}
    >
      <div className="flex gap-4">
        {args.row.primaryPost?.coverUrl ? (
          <div
            aria-hidden="true"
            className="hidden h-24 w-20 shrink-0 rounded-[1rem] border border-white/[0.1] bg-black/[0.24] sm:block"
            style={getBackgroundImageStyle(args.row.primaryPost.coverUrl)}
          />
        ) : null}

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xs uppercase tracking-[0.24em] text-muted-foreground">
              {args.title}
            </p>
            <span
              className={`rounded-full border px-2 py-1 text-[0.65rem] uppercase tracking-[0.18em] ${getMatchBadgeClassName(args.row)}`}
            >
              {getMatchBadgeLabel(args.row)}
            </span>
          </div>

          <h3 className="mt-2 truncate text-lg font-medium tracking-[-0.03em] text-foreground">
            {args.row.title}
          </h3>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            {args.row.subtitle}
          </p>

          <p className="mt-4 text-2xl font-medium tracking-[-0.05em] text-foreground">
            {getHighlightValueLabel({
              row: args.row,
              metric: args.metric,
              highlight: args.highlight,
            })}
          </p>
          <p className="mt-2 text-xs leading-5 text-muted-foreground">
            {getHighlightMetaLabel({
              row: args.row,
              metric: args.metric,
              highlight: args.highlight,
            })}
          </p>

          <div className="mt-4 flex flex-wrap gap-2">
            {args.row.primaryPost?.shareUrl ? (
              <a
                className="inline-flex min-h-10 items-center rounded-[0.95rem] border border-white/[0.08] bg-black/[0.22] px-3 text-sm text-foreground transition hover:border-white/[0.14] hover:bg-white/[0.05]"
                href={args.row.primaryPost.shareUrl}
                rel="noreferrer"
                target="_blank"
              >
                Open post
              </a>
            ) : null}
          </div>
        </div>
      </div>
    </article>
  );
}

export default async function TikTokPaidViewsPage({
  params,
  searchParams,
}: TikTokPaidViewsPageProps) {
  const { organizationSlug } = await params;
  const resolvedSearchParams = await searchParams;
  const startDate =
    getSearchParamValue(resolvedSearchParams, "startDate") ?? getDefaultStartDate();
  const endDate =
    getSearchParamValue(resolvedSearchParams, "endDate") ?? getDefaultEndDate();
  const metric = normalizeMetric(getSearchParamValue(resolvedSearchParams, "metric"));
  const matchMode = normalizeMatchMode(
    getSearchParamValue(resolvedSearchParams, "matchMode"),
  );
  const sortKey = normalizeSortKey(getSearchParamValue(resolvedSearchParams, "sort"));
  const connectHref = `/api/org/${organizationSlug}/integrations/tiktok/oauth/start?next=${encodeURIComponent(
    `/org/${organizationSlug}/tiktok-paid-views`,
  )}`;
  const connectedAccount = await prisma.organizationTikTokAccount.findFirst({
    where: {
      organization: {
        slug: organizationSlug,
      },
    },
    orderBy: [{ updatedAt: "desc" }],
    select: {
      advertiserId: true,
      advertiserName: true,
      lastValidatedAt: true,
      status: true,
    },
  });

  let result: Awaited<ReturnType<typeof getTopAdsForOrganization>> | null = null;
  let errorMessage: string | null = null;

  if (connectedAccount) {
    try {
      result = await getTopAdsForOrganization({
        organizationSlug,
        startDate,
        endDate,
        metric,
        matchMode,
      });
    } catch (error) {
      errorMessage =
        error instanceof Error
          ? error.message
          : "Could not load TikTok top ads for this organization.";
    }
  }

  const metricCopy = getMetricDisplayCopy(result?.metric ?? metric);
  const sortedAds = result ? sortAds(result.ads, sortKey) : [];
  const reportCurrency = getSingleCurrency(sortedAds);
  const topByPaidMetric = result ? sortAds(result.ads, "paidMetric")[0] ?? null : null;
  const topByProfit =
    result
      ? sortAds(
          result.ads.filter((row) => row.singular.matchedRowCount > 0),
          "profit",
        )[0] ?? null
      : null;
  const topByRoas =
    result
      ? sortAds(
          result.ads.filter((row) => typeof row.singular.roas === "number"),
          "roas",
        )[0] ?? null
      : null;
  const selectedSortOption =
    sortOptions.find((option) => option.value === sortKey) ?? sortOptions[0];
  const selectedMetricOption =
    metricOptions.find((option) => option.value === metric) ?? metricOptions[0];
  const selectedMatchModeOption =
    matchModeOptions.find((option) => option.value === matchMode) ??
    matchModeOptions[0];

  return (
    <div className="space-y-4">
      <section className="rounded-[1.55rem] border border-white/[0.08] bg-white/[0.03] p-5 shadow-[0_24px_70px_rgba(0,0,0,0.2)] backdrop-blur">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl">
            <p className="text-xs uppercase tracking-[0.28em] text-muted-foreground">
              TikTok Spark Ads
            </p>
            <h1 className="mt-2 text-2xl font-medium tracking-[-0.045em] text-foreground">
              See the highest-performing ads in one view.
            </h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              This report ranks every paid TikTok ad for the connected advertiser,
              then layers in Singular revenue, profit, ROAS, and installs when a
              trustworthy match exists.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Link
              className="inline-flex min-h-11 items-center rounded-[0.95rem] border border-white/[0.12] bg-black/[0.24] px-4 text-sm font-medium text-foreground transition hover:border-white/[0.2]"
              href={`/org/${organizationSlug}/integrations`}
            >
              Open Integrations
            </Link>
            <Link
              className="inline-flex min-h-11 items-center rounded-[0.95rem] border border-[#90FF4D]/20 bg-[#90FF4D]/90 px-4 text-sm font-medium text-black transition hover:bg-[#A4FF68]"
              href={connectHref}
            >
              {connectedAccount ? "Reconnect TikTok" : "Connect TikTok"}
            </Link>
          </div>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Connection"
            meta={
              connectedAccount?.advertiserName
                ? `${connectedAccount.advertiserName} (${connectedAccount.advertiserId})`
                : connectedAccount?.advertiserId ??
                  "Connect TikTok before running live ad rankings."
            }
            value={connectedAccount ? "Connected" : "Not connected"}
          />
          <StatCard
            label="Status"
            meta={
              connectedAccount?.lastValidatedAt
                ? `Last validated ${formatDate(connectedAccount.lastValidatedAt)}`
                : "No TikTok advertiser account has been saved for this org yet."
            }
            value={connectedAccount?.status ?? "Missing"}
          />
          <StatCard
            label="Metric"
            meta={selectedMetricOption.hint}
            value={selectedMetricOption.label}
          />
          <StatCard
            label="Date window"
            meta="This report runs live against the TikTok integrated reporting API."
            value={`${formatDate(startDate)} to ${formatDate(endDate)}`}
          />
        </div>
      </section>

      <section className="rounded-[1.55rem] border border-white/[0.08] bg-white/[0.03] p-5 shadow-[0_24px_70px_rgba(0,0,0,0.2)] backdrop-blur">
        <div className="flex flex-col gap-2">
          <p className="text-xs uppercase tracking-[0.28em] text-muted-foreground">
            Filters
          </p>
          <h2 className="text-lg font-medium tracking-[-0.03em] text-foreground">
            Adjust the ranking logic.
          </h2>
          <p className="text-sm leading-6 text-muted-foreground">
            Use smart sort when you want the best answer fast. Switch to a single
            metric when you need a stricter leaderboard.
          </p>
        </div>

        <form className="mt-5 space-y-4" method="get">
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.1fr)_minmax(0,1.1fr)_minmax(0,1.2fr)_auto]">
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

            <label className="block">
              <span className="mb-2 block text-xs uppercase tracking-[0.2em] text-muted-foreground">
                Metric
              </span>
              <select
                className="h-11 w-full rounded-[0.95rem] border border-white/[0.08] bg-black/[0.24] px-3.5 text-sm text-foreground outline-none transition focus:border-white/[0.16]"
                defaultValue={metric}
                name="metric"
              >
                {metricOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-2 block text-xs uppercase tracking-[0.2em] text-muted-foreground">
                Match mode
              </span>
              <select
                className="h-11 w-full rounded-[0.95rem] border border-white/[0.08] bg-black/[0.24] px-3.5 text-sm text-foreground outline-none transition focus:border-white/[0.16]"
                defaultValue={matchMode}
                name="matchMode"
              >
                {matchModeOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-2 block text-xs uppercase tracking-[0.2em] text-muted-foreground">
                Sort ads by
              </span>
              <select
                className="h-11 w-full rounded-[0.95rem] border border-white/[0.08] bg-black/[0.24] px-3.5 text-sm text-foreground outline-none transition focus:border-white/[0.16]"
                defaultValue={sortKey}
                name="sort"
              >
                {sortOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <div className="flex items-end">
              <button
                className="inline-flex min-h-11 w-full items-center justify-center rounded-[0.95rem] border border-[#90FF4D]/20 bg-[#90FF4D]/90 px-4 text-sm font-medium text-black transition hover:bg-[#A4FF68]"
                type="submit"
              >
                Refresh report
              </button>
            </div>
          </div>
        </form>

        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <div className="rounded-[1rem] border border-white/[0.08] bg-black/[0.2] p-4">
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
              Sort logic
            </p>
            <p className="mt-2 text-sm font-medium text-foreground">
              {selectedSortOption.label}
            </p>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">
              {selectedSortOption.hint}
            </p>
          </div>

          <div className="rounded-[1rem] border border-white/[0.08] bg-black/[0.2] p-4">
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
              Selected metric
            </p>
            <p className="mt-2 text-sm font-medium text-foreground">
              {selectedMetricOption.label}
            </p>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">
              {selectedMetricOption.hint}
            </p>
          </div>

          <div className="rounded-[1rem] border border-white/[0.08] bg-black/[0.2] p-4">
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
              Attribution mode
            </p>
            <p className="mt-2 text-sm font-medium text-foreground">
              {selectedMatchModeOption.label}
            </p>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">
              {selectedMatchModeOption.hint}
            </p>
          </div>
        </div>
      </section>

      {errorMessage ? (
        <section className="rounded-[1.25rem] border border-[#FF7E54]/20 bg-[#FF7E54]/[0.08] px-4 py-3 text-sm text-[#FFD3C5]">
          {errorMessage}
        </section>
      ) : null}

      {!connectedAccount ? (
        <section className="rounded-[1.55rem] border border-white/[0.08] bg-white/[0.03] p-5 shadow-[0_24px_70px_rgba(0,0,0,0.2)] backdrop-blur">
          <p className="text-xs uppercase tracking-[0.28em] text-muted-foreground">
            TikTok connection required
          </p>
          <h2 className="mt-2 text-xl font-medium tracking-[-0.04em] text-foreground">
            Connect a TikTok advertiser account first.
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
            This page runs a live ad report for the organization&apos;s saved TikTok
            advertiser account. Once that connection exists, the leaderboard will
            populate automatically.
          </p>
        </section>
      ) : null}

      {result ? (
        <>
          <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label={metricCopy.totalLabel}
              meta={`${formatDate(result.startDate)} to ${formatDate(result.endDate)}`}
              value={numberFormatter.format(result.paidMetricTotal)}
            />
            <StatCard
              label="Ads returned"
              meta={`${numberFormatter.format(result.rowCount)} raw TikTok report row${result.rowCount === 1 ? "" : "s"}`}
              value={numberFormatter.format(result.ads.length)}
            />
            <StatCard
              label="Singular matched"
              meta={`${numberFormatter.format(result.totals.profitableAds)} profitable ad${result.totals.profitableAds === 1 ? "" : "s"}`}
              value={numberFormatter.format(result.totals.matchedAds)}
            />
            <StatCard
              label={result.singular.configured ? "Net profit" : "Revenue overlay"}
              meta={
                result.singular.configured
                  ? `${formatAmount(result.totals.revenue, reportCurrency)} revenue on ${formatAmount(result.totals.spend, reportCurrency)} spend`
                  : "Singular is not configured, so profitability metrics are unavailable."
              }
              value={
                result.singular.configured
                  ? formatAmount(result.totals.profit, reportCurrency)
                  : "Off"
              }
            />
          </section>

          {result.warnings.length > 0 ? (
            <section className="rounded-[1.35rem] border border-[#FFD24D]/20 bg-[#FFD24D]/[0.08] p-4 text-sm text-[#FFEAB1]">
              <p className="text-xs uppercase tracking-[0.2em] text-[#FFEAB1]/80">
                Report warnings
              </p>
              <ul className="mt-2 space-y-1.5">
                {result.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className="grid gap-4 xl:grid-cols-3">
            <TopAdHighlightCard
              description="The ad pulling the most paid delivery in the selected date window."
              highlight="paidMetric"
              metric={metric}
              row={topByPaidMetric}
              title={`Top ${metricCopy.shortLabel.toLowerCase()}`}
            />
            <TopAdHighlightCard
              description="The matched ad with the strongest attributed profit."
              highlight="profit"
              metric={metric}
              row={topByProfit}
              title="Top profit"
            />
            <TopAdHighlightCard
              description="The matched ad with the best return on ad spend."
              highlight="roas"
              metric={metric}
              row={topByRoas}
              title="Top ROAS"
            />
          </section>

          <section className="rounded-[1.55rem] border border-white/[0.08] bg-white/[0.03] p-5 shadow-[0_24px_70px_rgba(0,0,0,0.2)] backdrop-blur">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.28em] text-muted-foreground">
                  Ranked ads
                </p>
                <h2 className="mt-2 text-xl font-medium tracking-[-0.04em] text-foreground">
                  Full ad leaderboard
                </h2>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
                  Sorted by {selectedSortOption.label.toLowerCase()}. Each row combines
                  TikTok paid delivery with any trustworthy Singular attribution that
                  could be attached to the ad.
                </p>
              </div>
              <div className="rounded-full border border-white/[0.08] bg-black/[0.2] px-3 py-2 text-xs uppercase tracking-[0.18em] text-muted-foreground">
                {metricCopy.rowValueLabel} leaderboard
              </div>
            </div>

            {sortedAds.length > 0 ? (
              <div className="mt-5 overflow-x-auto rounded-[1.2rem] border border-white/[0.08] bg-black/[0.18]">
                <table className="min-w-[1180px] w-full border-collapse text-left">
                  <thead className="bg-white/[0.03]">
                    <tr>
                      <th className="px-4 py-3 text-[0.62rem] font-normal uppercase tracking-[0.22em] text-muted-foreground">
                        Ad
                      </th>
                      <th className="px-4 py-3 text-[0.62rem] font-normal uppercase tracking-[0.22em] text-muted-foreground">
                        {metricCopy.rowValueLabel}
                      </th>
                      <th className="px-4 py-3 text-[0.62rem] font-normal uppercase tracking-[0.22em] text-muted-foreground">
                        Spend
                      </th>
                      <th className="px-4 py-3 text-[0.62rem] font-normal uppercase tracking-[0.22em] text-muted-foreground">
                        Revenue
                      </th>
                      <th className="px-4 py-3 text-[0.62rem] font-normal uppercase tracking-[0.22em] text-muted-foreground">
                        Profit
                      </th>
                      <th className="px-4 py-3 text-[0.62rem] font-normal uppercase tracking-[0.22em] text-muted-foreground">
                        ROAS
                      </th>
                      <th className="px-4 py-3 text-[0.62rem] font-normal uppercase tracking-[0.22em] text-muted-foreground">
                        Match
                      </th>
                      <th className="px-4 py-3 text-[0.62rem] font-normal uppercase tracking-[0.22em] text-muted-foreground">
                        Last seen
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.06] text-sm text-foreground">
                    {sortedAds.map((row) => {
                      const isPositiveProfit = row.singular.profit > 0;

                      return (
                        <tr className="align-top" key={row.adId}>
                          <td className="px-4 py-4">
                            <div className="flex gap-3">
                              {row.primaryPost?.coverUrl ? (
                                <div
                                  aria-hidden="true"
                                  className="hidden h-16 w-12 shrink-0 rounded-[0.85rem] border border-white/[0.08] bg-black/[0.24] md:block"
                                  style={getBackgroundImageStyle(row.primaryPost.coverUrl)}
                                />
                              ) : null}

                              <div className="min-w-0">
                                <p className="truncate font-medium text-foreground">
                                  {row.title}
                                </p>
                                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                                  {row.subtitle}
                                </p>
                                <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
                                  <span>
                                    {numberFormatter.format(row.itemIds.length)} Spark ID
                                    {row.itemIds.length === 1 ? "" : "s"}
                                  </span>
                                  <span>
                                    {numberFormatter.format(row.rowCount)} TikTok row
                                    {row.rowCount === 1 ? "" : "s"}
                                  </span>
                                  {row.primaryPost?.shareUrl ? (
                                    <a
                                      className="text-foreground transition hover:text-white"
                                      href={row.primaryPost.shareUrl}
                                      rel="noreferrer"
                                      target="_blank"
                                    >
                                      Open post
                                    </a>
                                  ) : null}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-4">
                            <p className="font-medium text-foreground">
                              {numberFormatter.format(row.totalValue)}
                            </p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {formatDateRange(row.firstDate, row.lastDate)}
                            </p>
                          </td>
                          <td className="px-4 py-4">
                            <p className="font-medium text-foreground">
                              {formatAmount(row.singular.spend, row.singular.currency)}
                            </p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {numberFormatter.format(row.singular.installs)} installs
                            </p>
                          </td>
                          <td className="px-4 py-4">
                            <p className="font-medium text-foreground">
                              {formatAmount(row.singular.revenue, row.singular.currency)}
                            </p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {numberFormatter.format(row.singular.conversions)} conversions
                            </p>
                          </td>
                          <td className="px-4 py-4">
                            <p
                              className={`font-medium ${
                                isPositiveProfit ? "text-[#B8FF86]" : "text-foreground"
                              }`}
                            >
                              {formatAmount(row.singular.profit, row.singular.currency)}
                            </p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {row.singular.matchedRowCount > 0
                                ? `${numberFormatter.format(row.singular.matchedRowCount)} matched row${row.singular.matchedRowCount === 1 ? "" : "s"}`
                                : "No attributed rows"}
                            </p>
                          </td>
                          <td className="px-4 py-4">
                            <p className="font-medium text-foreground">
                              {formatRoas(row.singular.roas)}
                            </p>
                          </td>
                          <td className="px-4 py-4">
                            <span
                              className={`inline-flex rounded-full border px-2.5 py-1 text-[0.68rem] uppercase tracking-[0.18em] ${getMatchBadgeClassName(row)}`}
                            >
                              {getMatchBadgeLabel(row)}
                            </span>
                          </td>
                          <td className="px-4 py-4">
                            <p className="font-medium text-foreground">
                              {formatDate(row.lastDate)}
                            </p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {formatDateRange(row.firstDate, row.lastDate)}
                            </p>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="mt-5 text-sm leading-6 text-muted-foreground">
                TikTok returned no paid ad rows for this advertiser in the selected
                date range.
              </p>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}
