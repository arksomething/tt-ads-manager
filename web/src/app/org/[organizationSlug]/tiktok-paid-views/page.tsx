import Link from "next/link";

import { prisma } from "@/lib/db";
import {
  getPaidViewsForCreatorByNameForOrganization,
  type TikTokPaidViewMetric,
} from "@/server/tiktok-business/reporting";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

type TikTokPaidViewsPageProps = {
  params: Promise<{
    organizationSlug: string;
  }>;
  searchParams: SearchParams;
};

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

const numberFormatter = new Intl.NumberFormat("en-US");
const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

function getSearchParamValue(
  searchParams: Record<string, string | string[] | undefined>,
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
  date.setUTCDate(date.getUTCDate() - 30);
  return toDateOnlyString(date);
}

function getDefaultEndDate() {
  return toDateOnlyString(new Date());
}

function normalizeMetric(value: string | undefined): TikTokPaidViewMetric {
  return value === "videoPlayActions" ? "videoPlayActions" : "impressions";
}

function formatDate(value: string | null) {
  if (!value) {
    return "Unknown";
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? value : dateFormatter.format(parsed);
}

export default async function TikTokPaidViewsPage({
  params,
  searchParams,
}: TikTokPaidViewsPageProps) {
  const { organizationSlug } = await params;
  const resolvedSearchParams = await searchParams;
  const creator = (getSearchParamValue(resolvedSearchParams, "creator") ?? "").trim();
  const startDate =
    getSearchParamValue(resolvedSearchParams, "startDate") ?? getDefaultStartDate();
  const endDate =
    getSearchParamValue(resolvedSearchParams, "endDate") ?? getDefaultEndDate();
  const metric = normalizeMetric(getSearchParamValue(resolvedSearchParams, "metric"));
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

  let result:
    | Awaited<ReturnType<typeof getPaidViewsForCreatorByNameForOrganization>>
    | null = null;
  let errorMessage: string | null = null;

  if (creator.length > 0) {
    try {
      result = await getPaidViewsForCreatorByNameForOrganization({
        organizationSlug,
        creatorName: creator,
        startDate,
        endDate,
        metric,
      });
    } catch (error) {
      errorMessage =
        error instanceof Error
          ? error.message
          : "Could not load TikTok paid views for this creator.";
    }
  }

  return (
    <div className="space-y-4">
      <section className="rounded-[1.55rem] border border-white/[0.08] bg-white/[0.03] p-5 shadow-[0_24px_70px_rgba(0,0,0,0.2)] backdrop-blur">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-2xl">
            <p className="text-xs uppercase tracking-[0.28em] text-muted-foreground">
              TikTok Spark Ads
            </p>
            <h1 className="mt-2 text-2xl font-medium tracking-[-0.045em] text-foreground">
              Look up paid views by creator.
            </h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              This view only counts paid TikTok delivery tied to Spark-authorized item
              IDs already stored in the workspace.
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
          <div className="rounded-[1.1rem] border border-white/[0.08] bg-black/[0.22] p-4">
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
              Connection
            </p>
            <p className="mt-2 text-sm font-medium text-foreground">
              {connectedAccount ? "Connected" : "Not connected"}
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              {connectedAccount?.advertiserName
                ? `${connectedAccount.advertiserName} (${connectedAccount.advertiserId})`
                : connectedAccount?.advertiserId ?? "Connect TikTok before querying live data."}
            </p>
          </div>
          <div className="rounded-[1.1rem] border border-white/[0.08] bg-black/[0.22] p-4">
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
              Status
            </p>
            <p className="mt-2 text-sm font-medium text-foreground">
              {connectedAccount?.status ?? "Missing"}
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              {connectedAccount?.lastValidatedAt
                ? `Last saved ${dateFormatter.format(connectedAccount.lastValidatedAt)}`
                : "No TikTok advertiser account has been saved for this org yet."}
            </p>
          </div>
          <div className="rounded-[1.1rem] border border-white/[0.08] bg-black/[0.22] p-4">
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
              Metric
            </p>
            <p className="mt-2 text-sm font-medium text-foreground">
              {metricOptions.find((option) => option.value === metric)?.label}
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              {metricOptions.find((option) => option.value === metric)?.hint}
            </p>
          </div>
          <div className="rounded-[1.1rem] border border-white/[0.08] bg-black/[0.22] p-4">
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
              Date window
            </p>
            <p className="mt-2 text-sm font-medium text-foreground">
              {formatDate(startDate)} to {formatDate(endDate)}
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              The report is run on demand against TikTok’s integrated reporting API.
            </p>
          </div>
        </div>
      </section>

      <section className="rounded-[1.55rem] border border-white/[0.08] bg-white/[0.03] p-5 shadow-[0_24px_70px_rgba(0,0,0,0.2)] backdrop-blur">
        <form className="space-y-4" method="get">
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
            <label className="block">
              <span className="mb-2 block text-xs uppercase tracking-[0.2em] text-muted-foreground">
                Creator
              </span>
              <input
                className="h-11 w-full rounded-[0.95rem] border border-white/[0.08] bg-black/[0.24] px-3.5 text-sm text-foreground outline-none transition placeholder:text-muted-foreground/60 focus:border-white/[0.16]"
                defaultValue={creator}
                name="creator"
                placeholder="@creator or display name"
                type="text"
              />
            </label>
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
            <div className="flex items-end">
              <button
                className="inline-flex min-h-11 w-full items-center justify-center rounded-[0.95rem] border border-[#90FF4D]/20 bg-[#90FF4D]/90 px-4 text-sm font-medium text-black transition hover:bg-[#A4FF68]"
                type="submit"
              >
                Run lookup
              </button>
            </div>
          </div>
        </form>
      </section>

      {errorMessage ? (
        <section className="rounded-[1.25rem] border border-[#FF7E54]/20 bg-[#FF7E54]/[0.08] px-4 py-3 text-sm text-[#FFD3C5]">
          {errorMessage}
        </section>
      ) : null}

      {result ? (
        <>
          <section className="rounded-[1.55rem] border border-white/[0.08] bg-white/[0.03] p-5 shadow-[0_24px_70px_rgba(0,0,0,0.2)] backdrop-blur">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.28em] text-muted-foreground">
                  Result
                </p>
                <h2 className="mt-2 text-xl font-medium tracking-[-0.04em] text-foreground">
                  {result.creator.displayName}
                  {result.creator.tiktokHandle
                    ? ` (@${result.creator.tiktokHandle})`
                    : ""}
                </h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  Paid {metric === "impressions" ? "impressions" : "video plays"} for
                  Spark-authorized items in the selected date range.
                </p>
              </div>
              <div className="rounded-[1.1rem] border border-[#90FF4D]/20 bg-[#90FF4D]/[0.08] px-4 py-3 text-right">
                <p className="text-xs uppercase tracking-[0.2em] text-[#D7FFBC]">
                  Total paid views
                </p>
                <p className="mt-2 text-3xl font-medium tracking-[-0.04em] text-[#F3FFE8]">
                  {numberFormatter.format(result.paidViews)}
                </p>
              </div>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-[1.1rem] border border-white/[0.08] bg-black/[0.22] p-4">
                <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                  Advertiser ID
                </p>
                <p className="mt-2 text-sm font-medium text-foreground">
                  {result.advertiserId}
                </p>
              </div>
              <div className="rounded-[1.1rem] border border-white/[0.08] bg-black/[0.22] p-4">
                <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                  Spark item IDs
                </p>
                <p className="mt-2 text-sm font-medium text-foreground">
                  {numberFormatter.format(result.matchedSparkItemIds.length)}
                </p>
              </div>
              <div className="rounded-[1.1rem] border border-white/[0.08] bg-black/[0.22] p-4">
                <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                  Report rows
                </p>
                <p className="mt-2 text-sm font-medium text-foreground">
                  {numberFormatter.format(result.rowCount)}
                </p>
              </div>
              <div className="rounded-[1.1rem] border border-white/[0.08] bg-black/[0.22] p-4">
                <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                  Date range
                </p>
                <p className="mt-2 text-sm font-medium text-foreground">
                  {formatDate(result.startDate)} to {formatDate(result.endDate)}
                </p>
              </div>
            </div>

            {result.warnings.length > 0 ? (
              <div className="mt-5 rounded-[1.1rem] border border-[#FFD24D]/20 bg-[#FFD24D]/[0.08] p-4 text-sm text-[#FFEAB1]">
                <p className="text-xs uppercase tracking-[0.2em] text-[#FFEAB1]/80">
                  Warnings
                </p>
                <ul className="mt-2 space-y-1.5">
                  {result.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>

          <section className="rounded-[1.55rem] border border-white/[0.08] bg-white/[0.03] p-5 shadow-[0_24px_70px_rgba(0,0,0,0.2)] backdrop-blur">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.28em] text-muted-foreground">
                  Report rows
                </p>
                <h3 className="mt-2 text-lg font-medium tracking-[-0.03em] text-foreground">
                  Raw TikTok row breakdown
                </h3>
              </div>
            </div>

            {result.rows.length > 0 ? (
              <div className="mt-5 overflow-x-auto">
                <table className="min-w-full divide-y divide-white/[0.08] text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-[0.18em] text-muted-foreground">
                      <th className="py-3 pr-4 font-medium">Date</th>
                      <th className="py-3 pr-4 font-medium">Ad ID</th>
                      <th className="py-3 pr-4 font-medium">Item ID</th>
                      <th className="py-3 font-medium">Value</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.05] text-foreground">
                    {result.rows.map((row, index) => (
                      <tr key={`${row.adId ?? "ad"}-${row.itemId ?? "item"}-${row.statDate ?? index}`}>
                        <td className="py-3 pr-4 text-muted-foreground">
                          {formatDate(row.statDate)}
                        </td>
                        <td className="py-3 pr-4">{row.adId ?? "Unknown"}</td>
                        <td className="py-3 pr-4">{row.itemId ?? "Filtered only"}</td>
                        <td className="py-3">
                          {numberFormatter.format(row.metricValue)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="mt-5 text-sm leading-6 text-muted-foreground">
                TikTok returned no matching paid-delivery rows for that creator in the
                selected window.
              </p>
            )}
          </section>
        </>
      ) : creator.length > 0 && !errorMessage ? (
        <section className="rounded-[1.25rem] border border-white/[0.08] bg-white/[0.03] px-4 py-3 text-sm text-muted-foreground">
          No paid TikTok data matched that creator in the selected date range.
        </section>
      ) : null}
    </div>
  );
}
