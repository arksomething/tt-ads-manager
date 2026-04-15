import Link from "next/link";

import { prisma } from "@/lib/db";
import { type DashboardSearchParams } from "@/server/dashboard/filters";
import {
  getTikTokSingularOverlay,
  type TikTokSingularReportRow,
} from "@/server/singular/reporting";

export const dynamic = "force-dynamic";

type TikTokPaidViewsPageProps = {
  params: Promise<{
    organizationSlug: string;
  }>;
  searchParams: Promise<DashboardSearchParams>;
};

type SingularSortKey =
  | "composite"
  | "roas"
  | "profit"
  | "revenue"
  | "spend"
  | "installs"
  | "conversions";

type SingularCreativeRow = TikTokSingularReportRow & {
  profit: number;
};

type RankedSingularCreativeRow = SingularCreativeRow & {
  revenueRank: number;
  roasRank: number;
  compositeScore: number;
  overallRank: number;
};

type MetricSortKey = Exclude<SingularSortKey, "composite">;

const sortOptions: Array<{
  value: SingularSortKey;
  label: string;
  hint: string;
}> = [
  {
    value: "composite",
    label: "Composite",
    hint: "Average revenue rank and ROAS rank, matching the manual spreadsheet.",
  },
  {
    value: "roas",
    label: "ROAS",
    hint: "Sort exactly the way a Singular creative leaderboard usually gets read.",
  },
  {
    value: "profit",
    label: "Profit",
    hint: "Show creatives with the strongest net revenue after spend first.",
  },
  {
    value: "revenue",
    label: "Revenue",
    hint: "Show the highest attributed revenue first.",
  },
  {
    value: "spend",
    label: "Spend",
    hint: "Useful when you want to inspect the heaviest spenders first.",
  },
  {
    value: "installs",
    label: "Installs",
    hint: "Sort by attributed install volume.",
  },
  {
    value: "conversions",
    label: "Conversions",
    hint: "Sort by attributed tracker conversions.",
  },
];

const decimalFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 2,
});
const integerFormatter = new Intl.NumberFormat("en-US");
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

function getCurrencyFormatter(currency: string) {
  const normalizedCurrency = currency.toUpperCase();
  const cached = currencyFormatterCache.get(normalizedCurrency);

  if (cached) {
    return cached;
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

function normalizeSortKey(value: string | undefined): SingularSortKey {
  switch (value) {
    case "composite":
    case "profit":
    case "revenue":
    case "spend":
    case "installs":
    case "conversions":
    case "roas":
      return value;
    default:
      return "profit";
  }
}

function getNullableNumberSortValue(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : Number.NEGATIVE_INFINITY;
}

function uniqueNonEmptyStrings(values: ReadonlyArray<string | null | undefined>) {
  return [...new Set(values.map((value) => value?.trim()).filter(Boolean) as string[])];
}

function getSingleCurrency(rows: readonly SingularCreativeRow[]) {
  const currencies = uniqueNonEmptyStrings(rows.map((row) => row.currency?.toUpperCase()));
  return currencies.length === 1 ? currencies[0] : null;
}

function getCampaignLabel(row: SingularCreativeRow) {
  const campaignName = row.campaignName?.trim() || null;
  const subCampaignName = row.subCampaignName?.trim() || null;

  if (
    campaignName &&
    subCampaignName &&
    campaignName.toLowerCase() !== subCampaignName.toLowerCase()
  ) {
    return `${campaignName} · ${subCampaignName}`;
  }

  return campaignName ?? subCampaignName ?? "No campaign label";
}

function getCreativeContextLabel(row: SingularCreativeRow) {
  return uniqueNonEmptyStrings([
    row.app,
    row.source,
    row.creativeId ? `Creative ID ${row.creativeId}` : null,
  ]).join(" · ");
}

function getCreativeTitle(row: SingularCreativeRow) {
  const creativeName = row.creativeName?.trim();

  if (creativeName && creativeName.toUpperCase() !== "N/A") {
    return creativeName;
  }

  if (row.creativeId) {
    return `Creative ${row.creativeId}`;
  }

  return getCampaignLabel(row);
}

function getCreativeSubtitle(row: SingularCreativeRow) {
  return uniqueNonEmptyStrings([
    getCampaignLabel(row),
    getCreativeContextLabel(row),
  ]).join(" · ");
}

function compareMetricRows(
  left: SingularCreativeRow,
  right: SingularCreativeRow,
  sortKey: MetricSortKey,
) {
  const finish = () =>
    getCreativeTitle(left).localeCompare(getCreativeTitle(right));

  switch (sortKey) {
    case "profit":
      return right.profit - left.profit || right.revenue - left.revenue || finish();
    case "revenue":
      return right.revenue - left.revenue || right.profit - left.profit || finish();
    case "spend":
      return right.spend - left.spend || right.revenue - left.revenue || finish();
    case "installs":
      return right.installs - left.installs || right.revenue - left.revenue || finish();
    case "conversions":
      return right.conversions - left.conversions || right.revenue - left.revenue || finish();
    default:
      return (
        getNullableNumberSortValue(right.roas) -
          getNullableNumberSortValue(left.roas) ||
        right.profit - left.profit ||
        right.revenue - left.revenue ||
        finish()
      );
  }
}

function compareCompositeRows(
  left: RankedSingularCreativeRow,
  right: RankedSingularCreativeRow,
) {
  return (
    left.compositeScore - right.compositeScore ||
    left.revenueRank - right.revenueRank ||
    left.roasRank - right.roasRank ||
    compareMetricRows(left, right, "profit")
  );
}

function compareRows(
  left: RankedSingularCreativeRow,
  right: RankedSingularCreativeRow,
  sortKey: SingularSortKey,
) {
  if (sortKey === "composite") {
    return compareCompositeRows(left, right);
  }

  return compareMetricRows(left, right, sortKey);
}

function sortRows(
  rows: readonly RankedSingularCreativeRow[],
  sortKey: SingularSortKey,
) {
  return [...rows].sort((left, right) => compareRows(left, right, sortKey));
}

function aggregateSingularRows(rows: readonly TikTokSingularReportRow[]) {
  const groupedRows = new Map<string, SingularCreativeRow>();

  for (const row of rows) {
    const existing = groupedRows.get(row.rowKey);

    if (existing) {
      existing.spend += row.spend;
      existing.revenue += row.revenue;
      existing.installs += row.installs;
      existing.conversions += row.conversions;
      existing.roas = existing.spend > 0 ? existing.revenue / existing.spend : null;
      existing.profit = existing.revenue - existing.spend;
      continue;
    }

    groupedRows.set(row.rowKey, {
      ...row,
      profit: row.revenue - row.spend,
    });
  }

  return [...groupedRows.values()];
}

// Use ordinal ranks so every row gets a deterministic spreadsheet-style position.
function buildRankMap(
  rows: readonly SingularCreativeRow[],
  sortKey: MetricSortKey,
) {
  return new Map(
    [...rows]
      .sort((left, right) => compareMetricRows(left, right, sortKey))
      .map((row, index) => [row.rowKey, index + 1] as const),
  );
}

function rankRows(rows: readonly SingularCreativeRow[]) {
  const revenueRankMap = buildRankMap(rows, "revenue");
  const roasRankMap = buildRankMap(rows, "roas");
  const rowsWithMetricRanks: RankedSingularCreativeRow[] = rows.map((row) => {
    const revenueRank = revenueRankMap.get(row.rowKey) ?? rows.length + 1;
    const roasRank = roasRankMap.get(row.rowKey) ?? rows.length + 1;

    return {
      ...row,
      revenueRank,
      roasRank,
      compositeScore: (revenueRank + roasRank) / 2,
      overallRank: 0,
    };
  });
  const overallRankMap = new Map(
    [...rowsWithMetricRanks]
      .sort((left, right) => compareCompositeRows(left, right))
      .map((row, index) => [row.rowKey, index + 1] as const),
  );

  return rowsWithMetricRanks.map((row) => ({
    ...row,
    overallRank: overallRankMap.get(row.rowKey) ?? rows.length + 1,
  }));
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

function HighlightCard(args: {
  title: string;
  description: string;
  highlight: "roas" | "profit" | "spend";
  row: SingularCreativeRow | null;
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
          No qualifying creative yet
        </h3>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          {args.description}
        </p>
      </article>
    );
  }

  const highlightValue =
    args.highlight === "profit"
      ? formatAmount(args.row.profit, args.row.currency)
      : args.highlight === "spend"
        ? formatAmount(args.row.spend, args.row.currency)
        : formatRoas(args.row.roas);
  const highlightMeta =
    args.highlight === "profit"
      ? `${formatAmount(args.row.revenue, args.row.currency)} revenue on ${formatAmount(args.row.spend, args.row.currency)} spend`
      : args.highlight === "spend"
        ? `${formatAmount(args.row.revenue, args.row.currency)} revenue returned`
        : `${formatAmount(args.row.profit, args.row.currency)} profit`;

  return (
    <article
      className={`rounded-[1.35rem] border p-4 shadow-[0_24px_70px_rgba(0,0,0,0.2)] backdrop-blur ${toneClassName}`}
    >
      <div className="flex gap-4">
        {args.row.creativeImage ? (
          <div
            aria-hidden="true"
            className="hidden h-24 w-20 shrink-0 rounded-[1rem] border border-white/[0.1] bg-black/[0.24] sm:block"
            style={getBackgroundImageStyle(args.row.creativeImage)}
          />
        ) : null}

        <div className="min-w-0 flex-1">
          <p className="text-xs uppercase tracking-[0.24em] text-muted-foreground">
            {args.title}
          </p>
          <h3 className="mt-2 truncate text-lg font-medium tracking-[-0.03em] text-foreground">
            {getCreativeTitle(args.row)}
          </h3>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            {getCreativeSubtitle(args.row)}
          </p>

          <p className="mt-4 text-2xl font-medium tracking-[-0.05em] text-foreground">
            {highlightValue}
          </p>
          <p className="mt-2 text-xs leading-5 text-muted-foreground">
            {highlightMeta}
          </p>

          <div className="mt-4 flex flex-wrap gap-2">
            {args.row.creativeUrl ? (
              <a
                className="inline-flex min-h-10 items-center rounded-[0.95rem] border border-white/[0.08] bg-black/[0.22] px-3 text-sm text-foreground transition hover:border-white/[0.14] hover:bg-white/[0.05]"
                href={args.row.creativeUrl}
                rel="noreferrer"
                target="_blank"
              >
                Open creative
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
  const sortKey = normalizeSortKey(getSearchParamValue(resolvedSearchParams, "sort"));
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
  const connectHref = `/api/org/${organizationSlug}/integrations/tiktok/oauth/start?next=${encodeURIComponent(
    `/org/${organizationSlug}/tiktok-paid-views`,
  )}`;

  let errorMessage: string | null = null;
  let overlay = {
    configured: false,
    cohortPeriod: process.env.SINGULAR_COHORT_PERIOD || "7d",
    sourceNames: [] as string[],
    rowCount: 0,
    rows: [] as TikTokSingularReportRow[],
    warnings: [] as string[],
  };

  try {
    overlay = await getTikTokSingularOverlay({
      startDate,
      endDate,
    });
  } catch (error) {
    errorMessage =
      error instanceof Error
        ? error.message
        : "Could not load Singular creative performance for this date window.";
  }

  const rows = rankRows(aggregateSingularRows(overlay.rows));
  const sortedRows = sortRows(rows, sortKey);
  const reportCurrency = getSingleCurrency(sortedRows);
  const topByRoas = sortRows(
    rows.filter((row) => typeof row.roas === "number"),
    "roas",
  )[0] ?? null;
  const topByProfit = sortRows(
    rows.filter((row) => row.profit > 0),
    "profit",
  )[0] ?? null;
  const topBySpend = sortRows(
    rows.filter((row) => row.spend > 0),
    "spend",
  )[0] ?? null;
  const totalSpend = rows.reduce((total, row) => total + row.spend, 0);
  const totalRevenue = rows.reduce((total, row) => total + row.revenue, 0);
  const totalProfit = rows.reduce((total, row) => total + row.profit, 0);
  const profitableCreatives = rows.filter((row) => row.profit > 0).length;
  const appFilterNames = (process.env.SINGULAR_APP_NAMES ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  const selectedSortOption =
    sortOptions.find((option) => option.value === sortKey) ?? sortOptions[0];
  const warnings = uniqueNonEmptyStrings([
    ...overlay.warnings,
    ...(!process.env.SINGULAR_APP_NAMES?.trim()
      ? [
          "SINGULAR_APP_NAMES is not set, so this leaderboard may span more than one app.",
        ]
      : []),
  ]);

  return (
    <div className="space-y-4">
      <section className="rounded-[1.55rem] border border-white/[0.08] bg-white/[0.03] p-5 shadow-[0_24px_70px_rgba(0,0,0,0.2)] backdrop-blur">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl">
            <p className="text-xs uppercase tracking-[0.28em] text-muted-foreground">
              Ad profitability
            </p>
            <h1 className="mt-2 text-2xl font-medium tracking-[-0.045em] text-foreground">
              See every returned creative and sort it however you want.
            </h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              This page reads Singular creative performance directly, keeps every
              returned row visible, and lets you switch between profit, ROAS,
              revenue, spend, volume, and spreadsheet-style composite ranking.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Link
              className="inline-flex min-h-11 items-center rounded-[0.95rem] border border-white/[0.12] bg-black/[0.24] px-4 text-sm font-medium text-foreground transition hover:border-white/[0.2]"
              href={`/org/${organizationSlug}/integrations`}
            >
              Manage connections
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
            label="Singular"
            meta="This leaderboard is driven directly from Singular creative rows."
            value={overlay.configured ? "Connected" : "Missing"}
          />
          <StatCard
            label="TikTok connection"
            meta={
              connectedAccount?.advertiserName
                ? `${connectedAccount.advertiserName} (${connectedAccount.advertiserId})`
                : "Optional for this view. Used only for TikTok-native lookups."
            }
            value={connectedAccount ? connectedAccount.status : "Optional"}
          />
          <StatCard
            label="Date window"
            meta="The Singular report is chunked automatically if the range exceeds 30 days."
            value={`${formatDate(startDate)} to ${formatDate(endDate)}`}
          />
          <StatCard
            label="Scope"
            meta={`${overlay.sourceNames.length} TikTok source name${overlay.sourceNames.length === 1 ? "" : "s"} in scope`}
            value={
              appFilterNames.length > 0
                ? `${appFilterNames.length} app${appFilterNames.length === 1 ? "" : "s"}`
                : "All apps"
            }
          />
        </div>
      </section>

      <section className="rounded-[1.55rem] border border-white/[0.08] bg-white/[0.03] p-5 shadow-[0_24px_70px_rgba(0,0,0,0.2)] backdrop-blur">
        <div className="flex flex-col gap-2">
          <p className="text-xs uppercase tracking-[0.28em] text-muted-foreground">
            Singular leaderboard
          </p>
          <h2 className="text-lg font-medium tracking-[-0.03em] text-foreground">
            Sort the raw creative export the way you actually use it.
          </h2>
          <p className="text-sm leading-6 text-muted-foreground">
            No match mode. No TikTok-first fallback. The table below is just the
            Singular creative report, aggregated across the selected date range and
            sorted by {selectedSortOption.label.toLowerCase()}.
          </p>
        </div>

        <form className="mt-5 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto]" method="get">
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
              Sort creatives by
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
              Refresh leaderboard
            </button>
          </div>
        </form>
      </section>

      {errorMessage ? (
        <section className="rounded-[1.25rem] border border-[#FF7E54]/20 bg-[#FF7E54]/[0.08] px-4 py-3 text-sm text-[#FFD3C5]">
          {errorMessage}
        </section>
      ) : null}

      {warnings.length > 0 ? (
        <section className="rounded-[1.35rem] border border-[#FFD24D]/20 bg-[#FFD24D]/[0.08] p-4 text-sm text-[#FFEAB1]">
          <p className="text-xs uppercase tracking-[0.2em] text-[#FFEAB1]/80">
            Report warnings
          </p>
          <ul className="mt-2 space-y-1.5">
            {warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {!overlay.configured ? (
        <section className="rounded-[1.55rem] border border-white/[0.08] bg-white/[0.03] p-5 shadow-[0_24px_70px_rgba(0,0,0,0.2)] backdrop-blur">
          <p className="text-xs uppercase tracking-[0.28em] text-muted-foreground">
            Singular required
          </p>
          <h2 className="mt-2 text-xl font-medium tracking-[-0.04em] text-foreground">
            Configure Singular to use this leaderboard.
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
            This page now reads directly from the Singular creative export. Until
            Singular is configured, there is no source-of-truth ROAS data to show.
          </p>
        </section>
      ) : (
        <>
          <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Creatives returned"
              meta={`${integerFormatter.format(overlay.rowCount)} raw Singular row${overlay.rowCount === 1 ? "" : "s"} before aggregation`}
              value={integerFormatter.format(rows.length)}
            />
            <StatCard
              label="Total spend"
              meta={`${integerFormatter.format(profitableCreatives)} profitable creative${profitableCreatives === 1 ? "" : "s"} in range`}
              value={formatAmount(totalSpend, reportCurrency)}
            />
            <StatCard
              label="Total revenue"
              meta={`${formatAmount(totalProfit, reportCurrency)} net profit`}
              value={formatAmount(totalRevenue, reportCurrency)}
            />
            <StatCard
              label="Top sort mode"
              meta={selectedSortOption.hint}
              value={selectedSortOption.label}
            />
          </section>

          <section className="grid gap-4 xl:grid-cols-3">
            <HighlightCard
              description="The creative with the strongest return on ad spend."
              highlight="roas"
              row={topByRoas}
              title="Top ROAS"
            />
            <HighlightCard
              description="The creative with the strongest net profit."
              highlight="profit"
              row={topByProfit}
              title="Top profit"
            />
            <HighlightCard
              description="The heaviest spender in the selected date range."
              highlight="spend"
              row={topBySpend}
              title="Top spend"
            />
          </section>

          <section className="rounded-[1.55rem] border border-white/[0.08] bg-white/[0.03] p-5 shadow-[0_24px_70px_rgba(0,0,0,0.2)] backdrop-blur">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.28em] text-muted-foreground">
                  Ranked creatives
                </p>
                <h2 className="mt-2 text-xl font-medium tracking-[-0.04em] text-foreground">
                  Singular-first creative table
                </h2>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
                  Sorted by {selectedSortOption.label.toLowerCase()}. Every returned
                  row stays visible, with direct metric sorts plus the same
                  revenue-and-ROAS composite logic your spreadsheet uses.
                </p>
              </div>
              <div className="rounded-full border border-white/[0.08] bg-black/[0.2] px-3 py-2 text-xs uppercase tracking-[0.18em] text-muted-foreground">
                Creative performance
              </div>
            </div>

            {sortedRows.length > 0 ? (
              <div className="mt-5 overflow-x-auto rounded-[1.2rem] border border-white/[0.08] bg-black/[0.18]">
                <table className="min-w-[1660px] w-full border-collapse text-left">
                  <thead className="bg-white/[0.03]">
                    <tr>
                      <th className="px-4 py-3 text-[0.62rem] font-normal uppercase tracking-[0.22em] text-muted-foreground">
                        Creative
                      </th>
                      <th className="px-4 py-3 text-[0.62rem] font-normal uppercase tracking-[0.22em] text-muted-foreground">
                        Campaign
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
                        Revenue rank
                      </th>
                      <th className="px-4 py-3 text-[0.62rem] font-normal uppercase tracking-[0.22em] text-muted-foreground">
                        ROAS rank
                      </th>
                      <th className="px-4 py-3 text-[0.62rem] font-normal uppercase tracking-[0.22em] text-muted-foreground">
                        Composite
                      </th>
                      <th className="px-4 py-3 text-[0.62rem] font-normal uppercase tracking-[0.22em] text-muted-foreground">
                        Overall rank
                      </th>
                      <th className="px-4 py-3 text-[0.62rem] font-normal uppercase tracking-[0.22em] text-muted-foreground">
                        Volume
                      </th>
                      <th className="px-4 py-3 text-[0.62rem] font-normal uppercase tracking-[0.22em] text-muted-foreground">
                        Source
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.06] text-sm text-foreground">
                    {sortedRows.map((row) => {
                      const isPositiveProfit = row.profit > 0;

                      return (
                        <tr className="align-top" key={row.rowKey}>
                          <td className="px-4 py-4">
                            <div className="flex gap-3">
                              {row.creativeImage ? (
                                <div
                                  aria-hidden="true"
                                  className="hidden h-16 w-12 shrink-0 rounded-[0.85rem] border border-white/[0.08] bg-black/[0.24] md:block"
                                  style={getBackgroundImageStyle(row.creativeImage)}
                                />
                              ) : null}

                              <div className="min-w-0">
                                <p className="truncate font-medium text-foreground">
                                  {getCreativeTitle(row)}
                                </p>
                                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                                  {getCreativeContextLabel(row)}
                                </p>
                                <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
                                  {row.creativeUrl ? (
                                    <a
                                      className="text-foreground transition hover:text-white"
                                      href={row.creativeUrl}
                                      rel="noreferrer"
                                      target="_blank"
                                    >
                                      Open creative
                                    </a>
                                  ) : null}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-4">
                            <p className="font-medium text-foreground">
                              {getCampaignLabel(row)}
                            </p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {row.creativeId
                                ? `Creative ID ${row.creativeId}`
                                : "Creative ID unavailable"}
                            </p>
                          </td>
                          <td className="px-4 py-4">
                            <p className="font-medium text-foreground">
                              {formatAmount(row.spend, row.currency)}
                            </p>
                          </td>
                          <td className="px-4 py-4">
                            <p className="font-medium text-foreground">
                              {formatAmount(row.revenue, row.currency)}
                            </p>
                          </td>
                          <td className="px-4 py-4">
                            <p
                              className={`font-medium ${
                                isPositiveProfit ? "text-[#B8FF86]" : "text-foreground"
                              }`}
                            >
                              {formatAmount(row.profit, row.currency)}
                            </p>
                          </td>
                          <td className="px-4 py-4">
                            <p className="font-medium text-foreground">
                              {formatRoas(row.roas)}
                            </p>
                          </td>
                          <td className="px-4 py-4">
                            <p className="font-medium text-foreground">
                              {integerFormatter.format(row.revenueRank)}
                            </p>
                          </td>
                          <td className="px-4 py-4">
                            <p className="font-medium text-foreground">
                              {integerFormatter.format(row.roasRank)}
                            </p>
                          </td>
                          <td className="px-4 py-4">
                            <p className="font-medium text-foreground">
                              {decimalFormatter.format(row.compositeScore)}
                            </p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              Avg revenue rank and ROAS rank
                            </p>
                          </td>
                          <td className="px-4 py-4">
                            <p className="font-medium text-foreground">
                              {integerFormatter.format(row.overallRank)}
                            </p>
                          </td>
                          <td className="px-4 py-4">
                            <p className="font-medium text-foreground">
                              {integerFormatter.format(row.installs)} installs
                            </p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {integerFormatter.format(row.conversions)} conversions
                            </p>
                          </td>
                          <td className="px-4 py-4">
                            <p className="font-medium text-foreground">
                              {row.source ?? "Unknown source"}
                            </p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {row.app ?? "Unknown app"}
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
                Singular returned no creative rows for the selected date range.
              </p>
            )}
          </section>
        </>
      )}
    </div>
  );
}
