import Link from "next/link";

import {
  AdProfitTableClient,
  type AdProfitTableClientRow,
} from "@/components/org-dashboard/ad-profit-table-client";
import { prisma } from "@/lib/db";
import { type DashboardSearchParams } from "@/server/dashboard/filters";
import {
  getTikTokSingularOverlay,
  type TikTokSingularReportRow,
} from "@/server/singular/reporting";
import { getViralTikTokPostAttributionsForSingularRows } from "@/server/singular/viral-attribution";

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
const compactIntegerFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 1,
  notation: "compact",
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
  date.setUTCDate(date.getUTCDate() - 6);
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
    row.tiktokPostId ? `TikTok post ID ${row.tiktokPostId}` : null,
    row.creativeId ? `Creative ID ${row.creativeId}` : null,
  ]).join(" · ");
}

function getViralPostContextLabel(args: {
  accountUsername: string | null;
  accountDisplayName: string | null;
  viewCount: number | null;
  platformVideoId: string;
  singularCreativeId: string | null;
  singularCreativeName: string | null;
}) {
  return uniqueNonEmptyStrings([
    args.accountUsername
      ? `@${args.accountUsername}`
      : args.accountDisplayName,
    typeof args.viewCount === "number"
      ? `${compactIntegerFormatter.format(args.viewCount)} viral.app views`
      : null,
    `TikTok post ID ${args.platformVideoId}`,
    args.singularCreativeName
      ? `Singular ${args.singularCreativeName}`
      : args.singularCreativeId
        ? `Singular creative ${args.singularCreativeId}`
        : null,
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

function SummaryPill(args: {
  label: string;
}) {
  return (
    <div className="rounded-full border border-white/[0.08] bg-black/[0.2] px-3 py-1.5 text-xs text-muted-foreground">
      {args.label}
    </div>
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
  const viralAttribution = await getViralTikTokPostAttributionsForSingularRows(
    rows,
  );
  const reportCurrency = getSingleCurrency(sortedRows);
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
    ...viralAttribution.warnings,
    ...(!process.env.SINGULAR_APP_NAMES?.trim()
      ? [
          "SINGULAR_APP_NAMES is not set, so this leaderboard may span more than one app.",
        ]
      : []),
  ]);
  const summaryScopeLabel =
    appFilterNames.length > 0
      ? `${appFilterNames.length} app${appFilterNames.length === 1 ? "" : "s"}`
      : "All apps";
  const sourceScopeLabel = `${overlay.sourceNames.length} TikTok source${overlay.sourceNames.length === 1 ? "" : "s"}`;
  const tableRows: AdProfitTableClientRow[] = sortedRows.map((row) => {
    const viralPost = row.tiktokPostId
      ? viralAttribution.attributions.get(row.tiktokPostId)
      : null;

    return {
      id: row.rowKey,
      creativeId: row.creativeId,
      creativeName: row.creativeName,
      creativeTitle: viralPost?.caption ?? getCreativeTitle(row),
      creativeContextLabel: viralPost
        ? getViralPostContextLabel({
            accountDisplayName: viralPost.accountDisplayName,
            accountUsername: viralPost.accountUsername,
            platformVideoId: viralPost.platformVideoId,
            singularCreativeId: row.creativeId,
            singularCreativeName: row.creativeName,
            viewCount: viralPost.viewCount,
          })
        : getCreativeContextLabel(row),
      creativeIdLabel: row.creativeId
        ? `Creative ID ${row.creativeId}`
        : "Creative ID unavailable",
      creativeImage: row.creativeImage ?? viralPost?.thumbnailUrl ?? null,
      creativeUrl: row.creativeUrl ?? viralPost?.videoUrl ?? null,
      primaryLinkLabel: viralPost ? "Open viral post" : "Open creative",
      tiktokPostId: row.tiktokPostId,
      campaignLabel: getCampaignLabel(row),
      campaignName: row.campaignName,
      spendLabel: formatAmount(row.spend, row.currency),
      revenueLabel: formatAmount(row.revenue, row.currency),
      profitLabel: formatAmount(row.profit, row.currency),
      profitPositive: row.profit > 0,
      roasLabel: formatRoas(row.roas),
      revenueRankLabel: integerFormatter.format(row.revenueRank),
      roasRankLabel: integerFormatter.format(row.roasRank),
      compositeLabel: decimalFormatter.format(row.compositeScore),
      overallRankLabel: integerFormatter.format(row.overallRank),
      volumePrimaryLabel: `${integerFormatter.format(row.installs)} installs`,
      volumeSecondaryLabel: `${integerFormatter.format(row.conversions)} conversions`,
      sourceLabel: row.source ?? "Unknown source",
      appLabel: row.app ?? "Unknown app",
      subCampaignName: row.subCampaignName,
      viralPostMatched: Boolean(viralPost),
    };
  });

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
            <p className="mt-2 text-sm text-muted-foreground">
              Singular-first creative performance for the selected window.
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

        <div className="mt-5 flex flex-wrap gap-2">
          <SummaryPill
            label={`Singular ${overlay.configured ? "connected" : "missing"}`}
          />
          <SummaryPill
            label={
              connectedAccount
                ? `TikTok ${connectedAccount.status.toLowerCase()}`
                : "TikTok optional"
            }
          />
          <SummaryPill
            label={`${formatDate(startDate)} to ${formatDate(endDate)}`}
          />
          <SummaryPill label={`${summaryScopeLabel} · ${sourceScopeLabel}`} />
          <SummaryPill
            label={`${integerFormatter.format(viralAttribution.matchedPostCount)}/${integerFormatter.format(viralAttribution.postIdCount)} viral.app post matches`}
          />
        </div>
      </section>

      <section className="rounded-[1.55rem] border border-white/[0.08] bg-white/[0.03] p-5 shadow-[0_24px_70px_rgba(0,0,0,0.2)] backdrop-blur">
        <p className="text-xs uppercase tracking-[0.28em] text-muted-foreground">
          Controls
        </p>

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
              meta="Across all returned creatives"
              value={formatAmount(totalSpend, reportCurrency)}
            />
            <StatCard
              label="Total revenue"
              meta="Attributed revenue in range"
              value={formatAmount(totalRevenue, reportCurrency)}
            />
            <StatCard
              label="Net profit"
              meta={`${integerFormatter.format(profitableCreatives)} profitable creative${profitableCreatives === 1 ? "" : "s"} in range`}
              value={formatAmount(totalProfit, reportCurrency)}
            />
          </section>

          <section className="rounded-[1.55rem] border border-white/[0.08] bg-white/[0.03] p-5 shadow-[0_24px_70px_rgba(0,0,0,0.2)] backdrop-blur">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.28em] text-muted-foreground">
                  Ranked creatives
                </p>
                <h2 className="mt-2 text-xl font-medium tracking-[-0.04em] text-foreground">
                  Creative table
                </h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  {integerFormatter.format(sortedRows.length)} row
                  {sortedRows.length === 1 ? "" : "s"} · sorted by{" "}
                  {selectedSortOption.label.toLowerCase()}
                </p>
              </div>
            </div>

            {sortedRows.length > 0 ? (
              <AdProfitTableClient
                endDate={endDate}
                organizationSlug={organizationSlug}
                rows={tableRows}
                startDate={startDate}
              />
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
