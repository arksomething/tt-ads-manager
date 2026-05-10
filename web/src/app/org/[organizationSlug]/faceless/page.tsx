import Link from "next/link";

import {
  getDefaultViewsBaseRange,
  getViewsBaseFacelessReport,
  type ViewsBaseCampaignOption,
  type ViewsBaseFacelessReport,
} from "@/server/viewsbase/report";
import { getViewsBaseCredentials } from "@/server/settings/managed-secrets";

export const dynamic = "force-dynamic";

type FacelessPageProps = {
  params: Promise<{
    organizationSlug: string;
  }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const numberFormatter = new Intl.NumberFormat("en-US");
const compactFormatter = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});
const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});
const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

function getSearchParamValue(
  searchParams: Record<string, string | string[] | undefined>,
  key: string,
) {
  const value = searchParams[key];
  return Array.isArray(value) ? value[0] : value;
}

function formatNumber(value: number) {
  return numberFormatter.format(Math.round(value));
}

function formatCompact(value: number) {
  return compactFormatter.format(value);
}

function formatCurrency(value: number) {
  return currencyFormatter.format(value);
}

function formatDateLabel(value: string) {
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? value : dateFormatter.format(date);
}

function formatCpm(value: number | null) {
  return value == null ? "--" : `${currencyFormatter.format(value)} CPM`;
}

function formatStatus(value: string) {
  switch (value) {
    case "actual":
      return "Actual";
    case "projected":
      return "Projected";
    case "mixed":
      return "Mixed";
    default:
      return "-";
  }
}

function buildApiHref(args: {
  organizationSlug: string;
  remoteOrgSlug: string;
  campaignSlug: string;
  startDate: string;
  endDate: string;
}) {
  const query = new URLSearchParams({
    orgSlug: args.remoteOrgSlug,
    campaignSlug: args.campaignSlug,
    startDate: args.startDate,
    endDate: args.endDate,
  });

  return `/api/org/${args.organizationSlug}/viewsbase/faceless?${query}`;
}

function getCampaignSelectOptions(args: {
  campaignOptions: ViewsBaseCampaignOption[];
  selectedCampaignSlug: string;
}) {
  const options = [...args.campaignOptions].sort((a, b) =>
    a.name.localeCompare(b.name),
  );

  if (
    args.selectedCampaignSlug !== "all" &&
    !options.some((option) => option.slug === args.selectedCampaignSlug)
  ) {
    options.push({
      id: args.selectedCampaignSlug,
      name: args.selectedCampaignSlug,
      slug: args.selectedCampaignSlug,
    });
  }

  return options;
}

function MetricTile({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <div className="rounded-[1rem] border border-white/[0.08] bg-black/[0.18] px-4 py-3">
      <p className="text-[0.62rem] uppercase tracking-[0.22em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-2 text-xl font-medium tracking-[-0.03em] text-foreground">
        {value}
      </p>
      {detail ? <p className="mt-1 text-xs text-muted-foreground">{detail}</p> : null}
    </div>
  );
}

function FacelessReportView({
  apiHref,
  report,
}: {
  apiHref: string;
  report: ViewsBaseFacelessReport;
}) {
  const topDailyRows = [...report.dailyRows].sort((a, b) =>
    a.date.localeCompare(b.date),
  );
  const topCreatorRows = report.creatorRows.slice(0, 12);

  return (
    <>
      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <MetricTile
          detail={
            report.isAggregate
              ? `${formatNumber(report.selectedCampaignSlugs.length)} campaigns`
              : `${formatNumber(report.totals.rawVideoCount)} raw video rows`
          }
          label="Videos"
          value={formatNumber(report.stats.totalVideos)}
        />
        <MetricTile
          detail={`${formatNumber(report.stats.activeCreators)} active creators`}
          label="Views in range"
          value={formatCompact(report.stats.totalViewsInRange)}
        />
        <MetricTile
          detail={`${formatCurrency(report.totals.baseTotalSpend)} base + ${formatCurrency(report.totals.managementFee)} fees`}
          label="Total spend"
          value={formatCurrency(report.totals.totalSpend)}
        />
        <MetricTile
          detail={`${formatCurrency(report.totals.cpmManagementFee)} CPM + ${formatCurrency(report.totals.fixedManagementFee)} fixed + ${formatCurrency(report.totals.dashboardFee)} dashboard`}
          label="Management fees"
          value={formatCurrency(report.totals.managementFee)}
        />
        <MetricTile
          detail="Subset still inside the paid view window"
          label="Projected spend"
          value={formatCurrency(report.totals.projectedSpend)}
        />
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(22rem,0.85fr)]">
        <div className="rounded-[1.25rem] border border-white/[0.08] bg-white/[0.03] p-4 shadow-[0_24px_70px_rgba(0,0,0,0.2)]">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.24em] text-muted-foreground">
                Daily ledger
              </p>
              <h2 className="mt-1 text-lg font-medium text-foreground">
                Spend and views by day
              </h2>
            </div>
            <Link
              className="text-xs uppercase tracking-[0.18em] text-[#C7FFA4] transition hover:text-[#90FF4D]"
              href={apiHref}
              prefetch={false}
              target="_blank"
            >
              Open JSON
            </Link>
          </div>

          <div className="mt-4 overflow-x-auto rounded-[0.95rem] border border-white/[0.08] bg-black/[0.18]">
            <table className="w-full min-w-[760px] border-collapse text-left">
              <thead className="bg-white/[0.03]">
                <tr>
                  {["Date", "Status", "Views", "Total spend", "Fees", "Projected", "Creators"].map(
                    (label) => (
                      <th
                        className="px-3 py-2.5 text-[0.6rem] font-normal uppercase tracking-[0.2em] text-muted-foreground"
                        key={label}
                      >
                        {label}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {topDailyRows.map((row) => (
                  <tr className="border-t border-white/[0.07]" key={row.date}>
                    <td className="px-3 py-3 text-sm text-foreground">
                      {formatDateLabel(row.date)}
                    </td>
                    <td className="px-3 py-3 text-xs uppercase tracking-[0.16em] text-muted-foreground">
                      {formatStatus(row.status)}
                    </td>
                    <td className="px-3 py-3 text-sm text-foreground">
                      {formatNumber(row.views)}
                    </td>
                    <td className="px-3 py-3">
                      <p className="text-sm text-foreground">
                        {formatCurrency(row.totalSpend)}
                      </p>
                      <p className="mt-0.5 text-[0.62rem] uppercase tracking-[0.16em] text-muted-foreground">
                        {formatCurrency(row.baseTotalSpend)} base
                      </p>
                    </td>
                    <td className="px-3 py-3">
                      <p className="text-sm text-foreground">
                        {formatCurrency(row.managementFee)}
                      </p>
                      <p className="mt-0.5 text-[0.62rem] uppercase tracking-[0.16em] text-muted-foreground">
                        {formatCurrency(row.cpmManagementFee)} CPM
                      </p>
                    </td>
                    <td className="px-3 py-3 text-sm text-foreground">
                      {formatCurrency(row.projectedSpend)}
                    </td>
                    <td className="px-3 py-3 text-sm text-muted-foreground">
                      {formatNumber(row.creatorCount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-[1.25rem] border border-white/[0.08] bg-white/[0.03] p-4 shadow-[0_24px_70px_rgba(0,0,0,0.2)]">
          <p className="text-xs uppercase tracking-[0.24em] text-muted-foreground">
            Spend drivers
          </p>
          <h2 className="mt-1 text-lg font-medium text-foreground">
            Creators in range
          </h2>

          <div className="mt-4 divide-y divide-white/[0.07] rounded-[0.95rem] border border-white/[0.08] bg-black/[0.18]">
            {topCreatorRows.map((creator) => (
              <div
                className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 px-3 py-3"
                key={creator.handle}
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">
                    {creator.name}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    @{creator.handle} / {formatCpm(creator.effectiveCpm)}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm text-foreground">
                    {formatCurrency(creator.totalSpend)}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {formatCompact(creator.views)} views
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}

export default async function FacelessPage({
  params,
  searchParams,
}: FacelessPageProps) {
  const { organizationSlug } = await params;
  const resolvedSearchParams = await searchParams;
  const defaultRange = getDefaultViewsBaseRange();
  const viewsBaseCredentials = await getViewsBaseCredentials(organizationSlug);
  const remoteOrgSlug =
    getSearchParamValue(resolvedSearchParams, "orgSlug") ??
    (viewsBaseCredentials.configured
      ? viewsBaseCredentials.value.defaultOrgSlug
      : null) ??
    "gotall";
  const campaignSlug =
    getSearchParamValue(resolvedSearchParams, "campaignSlug") ?? "all";
  const startDate =
    getSearchParamValue(resolvedSearchParams, "startDate") ??
    defaultRange.startDate;
  const endDate =
    getSearchParamValue(resolvedSearchParams, "endDate") ?? defaultRange.endDate;
  const apiHref = buildApiHref({
    organizationSlug,
    remoteOrgSlug,
    campaignSlug,
    startDate,
    endDate,
  });
  let report: ViewsBaseFacelessReport | null = null;
  let errorMessage: string | null = null;

  if (viewsBaseCredentials.configured) {
    try {
      report = await getViewsBaseFacelessReport({
        organizationSlug,
        remoteOrgSlug,
        campaignSlug,
        startDate,
        endDate,
      });
    } catch (error) {
      errorMessage =
        error instanceof Error ? error.message : "Unable to load ViewsBase.";
    }
  }
  const campaignSelectOptions = getCampaignSelectOptions({
    campaignOptions: report?.campaignOptions ?? [],
    selectedCampaignSlug: campaignSlug,
  });

  return (
    <div className="space-y-4">
      <section className="rounded-[1.25rem] border border-white/[0.08] bg-white/[0.03] p-4 shadow-[0_24px_70px_rgba(0,0,0,0.2)]">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.28em] text-muted-foreground">
              ViewsBase
            </p>
            <h1 className="mt-2 text-2xl font-medium tracking-[-0.04em] text-foreground">
              Faceless spend
            </h1>
            <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
              Live daily views and projected creator spend from the ViewsBase campaign
              APIs. The raw endpoint is available as JSON for automation.
            </p>
          </div>

          <form className="grid gap-2 sm:grid-cols-4 xl:w-[50rem]" method="get">
            <label className="block">
              <span className="mb-1.5 block text-[0.58rem] uppercase tracking-[0.18em] text-muted-foreground">
                Org
              </span>
              <input
                className="h-10 w-full rounded-[0.85rem] border border-white/[0.08] bg-black/[0.24] px-3 text-sm text-foreground outline-none transition focus:border-white/[0.16]"
                defaultValue={remoteOrgSlug}
                name="orgSlug"
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[0.58rem] uppercase tracking-[0.18em] text-muted-foreground">
                Campaign
              </span>
              <select
                className="h-10 w-full rounded-[0.85rem] border border-white/[0.08] bg-black/[0.24] px-3 text-sm text-foreground outline-none transition focus:border-white/[0.16]"
                defaultValue={campaignSlug}
                name="campaignSlug"
              >
                <option value="all">All campaigns</option>
                {campaignSelectOptions.map((campaign) => (
                  <option key={campaign.id} value={campaign.slug}>
                    {campaign.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[0.58rem] uppercase tracking-[0.18em] text-muted-foreground">
                Start
              </span>
              <input
                className="h-10 w-full rounded-[0.85rem] border border-white/[0.08] bg-black/[0.24] px-3 text-sm text-foreground outline-none transition focus:border-white/[0.16]"
                defaultValue={startDate}
                name="startDate"
                type="date"
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[0.58rem] uppercase tracking-[0.18em] text-muted-foreground">
                End
              </span>
              <div className="flex gap-2">
                <input
                  className="h-10 min-w-0 flex-1 rounded-[0.85rem] border border-white/[0.08] bg-black/[0.24] px-3 text-sm text-foreground outline-none transition focus:border-white/[0.16]"
                  defaultValue={endDate}
                  name="endDate"
                  type="date"
                />
                <button
                  className="inline-flex h-10 items-center justify-center rounded-[0.85rem] border border-[#90FF4D]/20 bg-[#90FF4D]/90 px-3 text-sm font-medium text-black transition hover:bg-[#A4FF68]"
                  type="submit"
                >
                  Apply
                </button>
              </div>
            </label>
          </form>
        </div>

        {report ? (
          <div className="mt-4 grid gap-2 text-xs text-muted-foreground sm:grid-cols-3">
            <p>
              Campaign:{" "}
              <span className="text-foreground">
                {report.isAggregate
                  ? `All campaigns (${report.selectedCampaignSlugs.length})`
                  : report.campaign.name}
              </span>
            </p>
            <p>
              Window:{" "}
              <span className="text-foreground">
                {report.requestedRange.startDate} to {report.requestedRange.endDate}
              </span>
            </p>
            <p>
              Last updated:{" "}
              <span className="text-foreground">
                {report.stats.lastUpdated ?? "ViewsBase did not return a timestamp"}
              </span>
            </p>
          </div>
        ) : null}
      </section>

      {!viewsBaseCredentials.configured ? (
        <section className="rounded-[1.25rem] border border-[#FF7E54]/20 bg-[#FF7E54]/[0.08] px-4 py-3 text-sm text-[#FFD3C5]">
          Save a ViewsBase session cookie in Settings to load this report.
        </section>
      ) : null}

      {errorMessage ? (
        <section className="rounded-[1.25rem] border border-[#FF7E54]/20 bg-[#FF7E54]/[0.08] px-4 py-3 text-sm text-[#FFD3C5]">
          {errorMessage}
        </section>
      ) : null}

      {report ? <FacelessReportView apiHref={apiHref} report={report} /> : null}
    </div>
  );
}
