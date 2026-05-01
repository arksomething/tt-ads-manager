import { redirect } from "next/navigation";

import { type DashboardSearchParams } from "@/server/dashboard/filters";
import {
  deleteCampaignCreatorDealForOrganization,
  upsertCampaignCreatorDealForOrganization,
} from "@/server/payouts/mutations";
import { getOrganizationPayoutDashboardData } from "@/server/payouts/queries";

export const dynamic = "force-dynamic";

type PayoutsPageProps = {
  params: Promise<{
    organizationSlug: string;
  }>;
  searchParams: Promise<DashboardSearchParams>;
};

const wholeNumberFormatter = new Intl.NumberFormat("en-US");
const compactNumberFormatter = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});
const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});
const currencyFormatters = new Map<string, Intl.NumberFormat>();

function getSearchParamValue(searchParams: DashboardSearchParams, key: string) {
  const value = searchParams[key];
  return Array.isArray(value) ? value[0] : value;
}

function formatDateLabel(value: Date | string | null | undefined) {
  if (!value) {
    return "Unknown";
  }

  const parsedValue = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsedValue.getTime())
    ? "Unknown"
    : dateFormatter.format(parsedValue);
}

function formatDateInputValue(value: Date | string | null | undefined) {
  if (!value) {
    return "";
  }

  const parsedValue = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsedValue.getTime())
    ? ""
    : parsedValue.toISOString().slice(0, 10);
}

function getCurrencyFormatter(currency: string) {
  const normalizedCurrency = currency.toUpperCase();
  const cached = currencyFormatters.get(normalizedCurrency);

  if (cached) {
    return cached;
  }

  const formatter = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: normalizedCurrency,
    maximumFractionDigits: 2,
  });

  currencyFormatters.set(normalizedCurrency, formatter);
  return formatter;
}

function formatMoney(value: number, currency = "USD") {
  return getCurrencyFormatter(currency).format(value);
}

function formatMetricValue(value: number, compact = false) {
  return compact
    ? compactNumberFormatter.format(value)
    : wholeNumberFormatter.format(value);
}

function getTrimmedFormValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function buildPayoutsHref(args: {
  organizationSlug: string;
  searchParams: DashboardSearchParams;
  notice?: string;
  error?: string;
}) {
  const nextSearchParams = new URLSearchParams();

  for (const [key, value] of Object.entries(args.searchParams)) {
    if (!value || key === "notice" || key === "error") {
      continue;
    }

    if (Array.isArray(value)) {
      for (const entry of value) {
        nextSearchParams.append(key, entry);
      }

      continue;
    }

    nextSearchParams.set(key, value);
  }

  if (args.notice) {
    nextSearchParams.set("notice", args.notice);
  }

  if (args.error) {
    nextSearchParams.set("error", args.error);
  }

  const query = nextSearchParams.toString();
  return query
    ? `/org/${args.organizationSlug}/payouts?${query}`
    : `/org/${args.organizationSlug}/payouts`;
}

function SummaryCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <article className="rounded-[1.2rem] border border-white/[0.08] bg-black/[0.18] p-4">
      <p className="text-[0.62rem] uppercase tracking-[0.22em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-3 text-[1.7rem] font-medium tracking-[-0.05em] text-foreground">
        {value}
      </p>
      <p className="mt-2 text-sm text-muted-foreground">{detail}</p>
    </article>
  );
}

function getNoticeLabel(value: string | undefined) {
  switch (value) {
    case "deal-saved":
      return "Creator deal saved";
    case "deal-cleared":
      return "Creator deal removed";
    default:
      return undefined;
  }
}

function getErrorLabel(value: string | undefined) {
  if (!value || value.startsWith("NEXT_REDIRECT")) {
    return undefined;
  }

  return value;
}

export default async function PayoutsPage({
  params,
  searchParams,
}: PayoutsPageProps) {
  const { organizationSlug } = await params;
  const resolvedSearchParams = await searchParams;
  const data = await getOrganizationPayoutDashboardData({
    organizationSlug,
    searchParams: resolvedSearchParams,
  });
  const notice = getNoticeLabel(getSearchParamValue(resolvedSearchParams, "notice"));
  const error = getErrorLabel(getSearchParamValue(resolvedSearchParams, "error"));

  async function saveDealAction(formData: FormData) {
    "use server";

    try {
      await upsertCampaignCreatorDealForOrganization({
        organizationSlug,
        input: {
          campaignCreatorId: getTrimmedFormValue(formData, "campaignCreatorId"),
          currency: getTrimmedFormValue(formData, "currency") || "USD",
          effectiveStartDate: getTrimmedFormValue(formData, "effectiveStartDate"),
          effectiveEndDate: getTrimmedFormValue(formData, "effectiveEndDate") || undefined,
          fixedFee: getTrimmedFormValue(formData, "fixedFee") || undefined,
          fixedFeeRecognitionDate:
            getTrimmedFormValue(formData, "fixedFeeRecognitionDate") || undefined,
          cpmAmount: getTrimmedFormValue(formData, "cpmAmount") || undefined,
          paidTrafficMetric:
            getTrimmedFormValue(formData, "paidTrafficMetric") || undefined,
          deductPaidTraffic: formData.get("deductPaidTraffic") === "on",
          viewCapPerVideo: getTrimmedFormValue(formData, "viewCapPerVideo") || undefined,
          viewWindowDays: getTrimmedFormValue(formData, "viewWindowDays") || undefined,
          payoutCapPerVideo:
            getTrimmedFormValue(formData, "payoutCapPerVideo") || undefined,
          payoutCapTotal: getTrimmedFormValue(formData, "payoutCapTotal") || undefined,
          notes: getTrimmedFormValue(formData, "notes") || undefined,
        },
      });
    } catch (saveError) {
      redirect(
        buildPayoutsHref({
          organizationSlug,
          searchParams: resolvedSearchParams,
          error:
            saveError instanceof Error ? saveError.message : "Could not save the creator deal.",
        }),
      );
    }

    redirect(
      buildPayoutsHref({
        organizationSlug,
        searchParams: resolvedSearchParams,
        notice: "deal-saved",
      }),
    );
  }

  async function clearDealAction(formData: FormData) {
    "use server";

    try {
      await deleteCampaignCreatorDealForOrganization({
        organizationSlug,
        input: {
          campaignCreatorId: getTrimmedFormValue(formData, "campaignCreatorId"),
        },
      });
    } catch (deleteError) {
      redirect(
        buildPayoutsHref({
          organizationSlug,
          searchParams: resolvedSearchParams,
          error:
            deleteError instanceof Error
              ? deleteError.message
              : "Could not remove the creator deal.",
        }),
      );
    }

    redirect(
      buildPayoutsHref({
        organizationSlug,
        searchParams: resolvedSearchParams,
        notice: "deal-cleared",
      }),
    );
  }

  return (
    <div className="space-y-4">
      <section className="rounded-[1.55rem] border border-white/[0.08] bg-white/[0.03] p-5 shadow-[0_24px_70px_rgba(0,0,0,0.2)] backdrop-blur">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl">
            <p className="text-xs uppercase tracking-[0.28em] text-muted-foreground">
              Payouts
            </p>
            <h1 className="mt-2 text-xl font-medium tracking-[-0.04em] text-foreground">
              Track UGC accrual, ad spend, and what the money is buying.
            </h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              UGC costs are computed from creator deal terms, video snapshot deltas,
              and TikTok paid-impression deductions for Spark-backed posts. Ad costs come
              from TikTok reporting, while revenue and performance summary fields come
              from Singular.
            </p>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Default creator terms: $1 CPM, 30-day view window, and a $100
              per-video cap unless you save a custom override. ViewsBase-synced
              video rows are treated as a separate source and priced at $0.50 CPM
              with a $100 per-video cap and no fixed fee.
            </p>
          </div>

          <div className="rounded-[1.1rem] border border-white/[0.08] bg-black/[0.2] px-4 py-3 text-sm text-muted-foreground">
            <p className="text-[0.62rem] uppercase tracking-[0.22em] text-muted-foreground">
              Selected range
            </p>
            <p className="mt-2 text-foreground">
              {formatDateLabel(data.startDate)} to {formatDateLabel(data.endDate)}
            </p>
            <p className="mt-1 text-xs">
              Daily rows show accrued cost. Actual payouts stay separate.
            </p>
          </div>
        </div>

        <form
          className="mt-5 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.2fr)_auto]"
          method="get"
        >
          <label className="block">
            <span className="mb-1.5 block text-[0.62rem] uppercase tracking-[0.22em] text-muted-foreground">
              Start
            </span>
            <input
              className="w-full rounded-[0.95rem] border border-white/[0.08] bg-black/[0.18] px-3 py-2.5 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-white/[0.16]"
              defaultValue={data.startDate}
              name="startDate"
              type="date"
            />
          </label>

          <label className="block">
            <span className="mb-1.5 block text-[0.62rem] uppercase tracking-[0.22em] text-muted-foreground">
              End
            </span>
            <input
              className="w-full rounded-[0.95rem] border border-white/[0.08] bg-black/[0.18] px-3 py-2.5 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-white/[0.16]"
              defaultValue={data.endDate}
              name="endDate"
              type="date"
            />
          </label>

          <label className="block">
            <span className="mb-1.5 block text-[0.62rem] uppercase tracking-[0.22em] text-muted-foreground">
              Campaign
            </span>
            <select
              className="w-full rounded-[0.95rem] border border-white/[0.08] bg-black/[0.18] px-3 py-2.5 text-sm text-foreground outline-none transition focus:border-white/[0.16]"
              defaultValue={data.selectedCampaignId ?? ""}
              name="campaign"
            >
              <option value="">All accessible campaigns</option>
              {data.campaignOptions.map((campaign) => (
                <option key={campaign.id} value={campaign.id}>
                  {campaign.label}
                </option>
              ))}
            </select>
          </label>

          <div className="flex items-end">
            <button
              className="inline-flex w-full items-center justify-center rounded-[0.95rem] border border-white/[0.1] bg-white/[0.06] px-4 py-2.5 text-sm text-foreground transition hover:border-white/[0.16] hover:bg-white/[0.1]"
              type="submit"
            >
              Apply filters
            </button>
          </div>
        </form>

        {notice ? (
          <div className="mt-4 rounded-[1rem] border border-[#90FF4D]/20 bg-[#90FF4D]/10 px-4 py-3 text-sm text-[#D4FFB2]">
            {notice}
          </div>
        ) : null}

        {error ? (
          <div className="mt-4 rounded-[1rem] border border-[#FF7E54]/20 bg-[#FF7E54]/10 px-4 py-3 text-sm text-[#FFD3C5]">
            {error}
          </div>
        ) : null}
      </section>

      {data.campaignOptions.length === 0 && data.creators.length === 0 ? (
        <section className="rounded-[1.35rem] border border-[#7BB2FF]/15 bg-[#7BB2FF]/[0.08] p-4">
          <p className="text-[0.62rem] uppercase tracking-[0.22em] text-[#CFE1FF]">
            Workspace Empty
          </p>
          <p className="mt-3 text-sm leading-6 text-[#E5EEFF]">
            This organization does not have any campaigns, tracked creators, or tracked
            videos yet, so the payouts dashboard has nothing to price. Start by creating
            a campaign, then add creators on the Creators page or track videos on the
            Videos page.
          </p>
        </section>
      ) : null}

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <SummaryCard
          label="Total Spend"
          value={formatMoney(data.summary.totalSpend)}
          detail={`${formatMoney(data.summary.ugcSpend)} UGC + ${formatMoney(data.summary.adSpend)} ads`}
        />
        <SummaryCard
          label="Payable Views"
          value={formatMetricValue(data.summary.payableViews, true)}
          detail={`${formatMetricValue(data.summary.grossViews, true)} gross less ${formatMetricValue(data.summary.paidViewsDeducted, true)} paid impressions`}
        />
        <SummaryCard
          label="Ad Delivery"
          value={formatMetricValue(data.summary.adImpressions, true)}
          detail="TikTok Ads Manager impressions"
        />
        <SummaryCard
          label="Singular Revenue"
          value={formatMoney(data.summary.singularRevenue)}
          detail={`${formatMoney(data.summary.singularProfit)} profit, ${formatMetricValue(data.summary.singularInstalls, true)} installs`}
        />
        <SummaryCard
          label="Paid Out"
          value={formatMoney(data.summary.actualPaidPayouts)}
          detail={`${data.summary.creatorRowsWithDeals} custom creator overrides saved`}
        />
      </section>

      {data.warnings.length > 0 ? (
        <section className="rounded-[1.35rem] border border-[#FFD24D]/15 bg-[#FFD24D]/[0.08] p-4">
          <p className="text-[0.62rem] uppercase tracking-[0.22em] text-[#FFE7A6]">
            Reporting Warnings
          </p>
          <ul className="mt-3 space-y-2 text-sm leading-6 text-[#FFF2C3]">
            {data.warnings.slice(0, 8).map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="rounded-[1.55rem] border border-white/[0.08] bg-white/[0.03] p-5 shadow-[0_24px_70px_rgba(0,0,0,0.2)] backdrop-blur">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.28em] text-muted-foreground">
              Daily Cost
            </p>
            <h2 className="mt-2 text-lg font-medium tracking-[-0.04em] text-foreground">
              Spend by day
            </h2>
          </div>
          <p className="text-sm text-muted-foreground">
            UGC is accrued from tracked view deltas. Ads are direct spend.
          </p>
        </div>

        <div className="mt-5 overflow-x-auto">
          <table className="min-w-[980px] w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-white/[0.08] text-[0.62rem] uppercase tracking-[0.18em] text-muted-foreground">
                <th className="pb-3 pr-4 font-medium">Date</th>
                <th className="pb-3 pr-4 font-medium">UGC Fixed</th>
                <th className="pb-3 pr-4 font-medium">UGC Variable</th>
                <th className="pb-3 pr-4 font-medium">Ads</th>
                <th className="pb-3 pr-4 font-medium">Total</th>
                <th className="pb-3 pr-4 font-medium">Gross Views</th>
                <th className="pb-3 pr-4 font-medium">Paid Impressions</th>
                <th className="pb-3 pr-4 font-medium">Payable Views</th>
                <th className="pb-3 pr-4 font-medium">Impressions</th>
                <th className="pb-3 pr-0 font-medium">Paid Out</th>
              </tr>
            </thead>
            <tbody>
              {data.dailyRows.map((row) => (
                <tr key={row.date} className="border-b border-white/[0.05] align-top">
                  <td className="py-3 pr-4 text-foreground">{formatDateLabel(row.date)}</td>
                  <td className="py-3 pr-4 text-foreground">{formatMoney(row.ugcFixedCost)}</td>
                  <td className="py-3 pr-4 text-foreground">{formatMoney(row.ugcVariableCost)}</td>
                  <td className="py-3 pr-4 text-foreground">{formatMoney(row.adSpend)}</td>
                  <td className="py-3 pr-4 font-medium text-foreground">{formatMoney(row.totalSpend)}</td>
                  <td className="py-3 pr-4 text-muted-foreground">{formatMetricValue(row.grossViews, true)}</td>
                  <td className="py-3 pr-4 text-muted-foreground">{formatMetricValue(row.paidViewsDeducted, true)}</td>
                  <td className="py-3 pr-4 text-muted-foreground">{formatMetricValue(row.payableViews, true)}</td>
                  <td className="py-3 pr-4 text-muted-foreground">{formatMetricValue(row.adImpressions, true)}</td>
                  <td className="py-3 pr-0 text-muted-foreground">{formatMoney(row.actualPaidPayouts)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-[1.55rem] border border-white/[0.08] bg-white/[0.03] p-5 shadow-[0_24px_70px_rgba(0,0,0,0.2)] backdrop-blur">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.28em] text-muted-foreground">
              Creator Deals
            </p>
            <h2 className="mt-2 text-lg font-medium tracking-[-0.04em] text-foreground">
              Creator costs
            </h2>
          </div>
          <p className="text-sm text-muted-foreground">
            Each row shows creator, views, and pay. Open Edit deal when terms differ.
          </p>
        </div>

        <div className="mt-5 overflow-hidden rounded-[1.2rem] border border-white/[0.08] bg-black/[0.18]">
          {data.creators.map((row, index) => (
            <details
              key={row.campaignCreatorId}
              className={`${index > 0 ? "border-t border-white/[0.08]" : ""} group`}
            >
              <summary className="grid cursor-pointer list-none gap-3 px-4 py-4 md:grid-cols-[minmax(0,1.8fr)_minmax(0,0.9fr)_minmax(0,0.9fr)_auto] md:items-center">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="truncate text-sm font-medium text-foreground">
                      {row.creatorName}
                    </h3>
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[0.62rem] uppercase tracking-[0.16em] ${
                        row.hasCustomDeal
                          ? "border-white/[0.08] bg-white/[0.05] text-muted-foreground"
                          : "border-[#90FF4D]/20 bg-[#90FF4D]/10 text-[#D4FFB2]"
                      }`}
                    >
                      {row.hasCustomDeal ? "custom" : "default"}
                    </span>
                    {row.videoCapReached ? (
                      <span className="rounded-full border border-[#FFD24D]/20 bg-[#FFD24D]/10 px-2 py-0.5 text-[0.62rem] uppercase tracking-[0.16em] text-[#FFE7A6]">
                        capped
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 truncate text-xs text-muted-foreground">
                    {row.campaignName}
                    {row.tiktokHandle ? ` · @${row.tiktokHandle}` : ""}
                  </p>
                </div>

                <div>
                  <p className="text-[0.62rem] uppercase tracking-[0.18em] text-muted-foreground">
                    Views
                  </p>
                  <p className="mt-1 text-sm text-foreground">
                    {formatMetricValue(row.payableViews, true)}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {formatMetricValue(row.grossViews, true)} gross
                  </p>
                </div>

                <div>
                  <p className="text-[0.62rem] uppercase tracking-[0.18em] text-muted-foreground">
                    Pay
                  </p>
                  <p className="mt-1 text-sm font-medium text-foreground">
                    {formatMoney(row.totalCost, row.currency)}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {formatMoney(row.fixedCost, row.currency)} fixed +{" "}
                    {formatMoney(row.variableCost, row.currency)} variable
                  </p>
                </div>

                <div className="flex items-center md:justify-end">
                  <span className="inline-flex items-center rounded-[0.85rem] border border-white/[0.1] bg-white/[0.05] px-3 py-2 text-sm text-foreground transition group-open:border-white/[0.16] group-open:bg-white/[0.08]">
                    Edit deal
                  </span>
                </div>
              </summary>

              <div className="border-t border-white/[0.08] px-4 py-4">
                <div className="flex flex-wrap gap-2 text-[0.62rem] uppercase tracking-[0.18em]">
                  <span className="rounded-full border border-white/[0.08] bg-white/[0.05] px-2.5 py-1 text-muted-foreground">
                    {formatMetricValue(row.grossViews, true)} gross
                  </span>
                  <span className="rounded-full border border-white/[0.08] bg-white/[0.05] px-2.5 py-1 text-muted-foreground">
                    {formatMetricValue(row.paidViewsDeducted, true)} paid impressions deducted
                  </span>
                  <span className="rounded-full border border-[#90FF4D]/20 bg-[#90FF4D]/10 px-2.5 py-1 text-[#D4FFB2]">
                    {formatMetricValue(row.payableViews, true)} payable
                  </span>
                  <span className="rounded-full border border-white/[0.08] bg-white/[0.05] px-2.5 py-1 text-muted-foreground">
                    {row.tiktokVideoCount} TikTok videos
                  </span>
                  <span className="rounded-full border border-white/[0.08] bg-white/[0.05] px-2.5 py-1 text-muted-foreground">
                    {row.exactPaidVideoCount} exact paid matches
                  </span>
                  {row.creatorTotalCapApplied ? (
                    <span className="rounded-full border border-[#FF7E54]/20 bg-[#FF7E54]/10 px-2.5 py-1 text-[#FFD3C5]">
                      total cap applied
                    </span>
                  ) : null}
                  {row.unsupportedPaidVideoCount > 0 ? (
                    <span className="rounded-full border border-[#FFD24D]/20 bg-[#FFD24D]/10 px-2.5 py-1 text-[#FFE7A6]">
                      {row.unsupportedPaidVideoCount} unresolved paid row
                      {row.unsupportedPaidVideoCount === 1 ? "" : "s"}
                    </span>
                  ) : null}
                </div>

                {row.warnings.length > 0 ? (
                  <p className="mt-3 text-sm leading-6 text-[#FFE7A6]">
                    {row.warnings[0]}
                  </p>
                ) : null}

                <form action={saveDealAction} className="mt-4 grid gap-3 xl:grid-cols-6">
                  <input name="campaignCreatorId" type="hidden" value={row.campaignCreatorId} />

                  <label className="block">
                    <span className="mb-1.5 block text-[0.62rem] uppercase tracking-[0.18em] text-muted-foreground">
                      Currency
                    </span>
                    <input
                      className="w-full rounded-[0.9rem] border border-white/[0.08] bg-black/[0.18] px-3 py-2.5 text-sm text-foreground outline-none transition focus:border-white/[0.16] disabled:cursor-not-allowed disabled:opacity-60"
                      defaultValue={row.currency}
                      disabled={!row.canEditDeal}
                      maxLength={3}
                      name="currency"
                    />
                  </label>

                  <label className="block">
                    <span className="mb-1.5 block text-[0.62rem] uppercase tracking-[0.18em] text-muted-foreground">
                      Deal Start
                    </span>
                    <input
                      className="w-full rounded-[0.9rem] border border-white/[0.08] bg-black/[0.18] px-3 py-2.5 text-sm text-foreground outline-none transition focus:border-white/[0.16] disabled:cursor-not-allowed disabled:opacity-60"
                      defaultValue={
                        formatDateInputValue(row.deal.effectiveStartDate) || data.startDate
                      }
                      disabled={!row.canEditDeal}
                      name="effectiveStartDate"
                      type="date"
                    />
                  </label>

                  <label className="block">
                    <span className="mb-1.5 block text-[0.62rem] uppercase tracking-[0.18em] text-muted-foreground">
                      Deal End
                    </span>
                    <input
                      className="w-full rounded-[0.9rem] border border-white/[0.08] bg-black/[0.18] px-3 py-2.5 text-sm text-foreground outline-none transition focus:border-white/[0.16] disabled:cursor-not-allowed disabled:opacity-60"
                      defaultValue={formatDateInputValue(row.deal.effectiveEndDate)}
                      disabled={!row.canEditDeal}
                      name="effectiveEndDate"
                      type="date"
                    />
                  </label>

                  <label className="block">
                    <span className="mb-1.5 block text-[0.62rem] uppercase tracking-[0.18em] text-muted-foreground">
                      Fixed Fee
                    </span>
                    <input
                      className="w-full rounded-[0.9rem] border border-white/[0.08] bg-black/[0.18] px-3 py-2.5 text-sm text-foreground outline-none transition focus:border-white/[0.16] disabled:cursor-not-allowed disabled:opacity-60"
                      defaultValue={row.deal.fixedFee ?? ""}
                      disabled={!row.canEditDeal}
                      name="fixedFee"
                      placeholder="0.00"
                      step="0.01"
                      type="number"
                    />
                  </label>

                  <label className="block">
                    <span className="mb-1.5 block text-[0.62rem] uppercase tracking-[0.18em] text-muted-foreground">
                      Fixed Fee Date
                    </span>
                    <input
                      className="w-full rounded-[0.9rem] border border-white/[0.08] bg-black/[0.18] px-3 py-2.5 text-sm text-foreground outline-none transition focus:border-white/[0.16] disabled:cursor-not-allowed disabled:opacity-60"
                      defaultValue={formatDateInputValue(row.deal.fixedFeeRecognitionDate)}
                      disabled={!row.canEditDeal}
                      name="fixedFeeRecognitionDate"
                      type="date"
                    />
                  </label>

                  <label className="block">
                    <span className="mb-1.5 block text-[0.62rem] uppercase tracking-[0.18em] text-muted-foreground">
                      CPM
                    </span>
                    <input
                      className="w-full rounded-[0.9rem] border border-white/[0.08] bg-black/[0.18] px-3 py-2.5 text-sm text-foreground outline-none transition focus:border-white/[0.16] disabled:cursor-not-allowed disabled:opacity-60"
                      defaultValue={row.deal.cpmAmount}
                      disabled={!row.canEditDeal}
                      name="cpmAmount"
                      placeholder="0.00"
                      step="0.01"
                      type="number"
                    />
                  </label>

                  <label className="block">
                    <span className="mb-1.5 block text-[0.62rem] uppercase tracking-[0.18em] text-muted-foreground">
                      View Window (Days)
                    </span>
                    <input
                      className="w-full rounded-[0.9rem] border border-white/[0.08] bg-black/[0.18] px-3 py-2.5 text-sm text-foreground outline-none transition focus:border-white/[0.16] disabled:cursor-not-allowed disabled:opacity-60"
                      defaultValue={row.deal.viewWindowDays}
                      disabled={!row.canEditDeal}
                      min="1"
                      name="viewWindowDays"
                      step="1"
                      type="number"
                    />
                  </label>

                  <label className="block">
                    <span className="mb-1.5 block text-[0.62rem] uppercase tracking-[0.18em] text-muted-foreground">
                      Paid Metric
                    </span>
                    <select
                      className="w-full rounded-[0.9rem] border border-white/[0.08] bg-black/[0.18] px-3 py-2.5 text-sm text-foreground outline-none transition focus:border-white/[0.16] disabled:cursor-not-allowed disabled:opacity-60"
                      defaultValue="IMPRESSIONS"
                      disabled={!row.canEditDeal}
                      name="paidTrafficMetric"
                    >
                      <option value="IMPRESSIONS">Impressions</option>
                    </select>
                  </label>

                  <label className="block">
                    <span className="mb-1.5 block text-[0.62rem] uppercase tracking-[0.18em] text-muted-foreground">
                      View Cap / Video
                    </span>
                    <input
                      className="w-full rounded-[0.9rem] border border-white/[0.08] bg-black/[0.18] px-3 py-2.5 text-sm text-foreground outline-none transition focus:border-white/[0.16] disabled:cursor-not-allowed disabled:opacity-60"
                      defaultValue={row.deal.viewCapPerVideo ?? ""}
                      disabled={!row.canEditDeal}
                      name="viewCapPerVideo"
                      placeholder="100000"
                      step="1"
                      type="number"
                    />
                  </label>

                  <label className="block">
                    <span className="mb-1.5 block text-[0.62rem] uppercase tracking-[0.18em] text-muted-foreground">
                      Payout Cap / Video
                    </span>
                    <input
                      className="w-full rounded-[0.9rem] border border-white/[0.08] bg-black/[0.18] px-3 py-2.5 text-sm text-foreground outline-none transition focus:border-white/[0.16] disabled:cursor-not-allowed disabled:opacity-60"
                      defaultValue={row.deal.payoutCapPerVideo}
                      disabled={!row.canEditDeal}
                      name="payoutCapPerVideo"
                      placeholder="100.00"
                      step="0.01"
                      type="number"
                    />
                  </label>

                  <label className="block">
                    <span className="mb-1.5 block text-[0.62rem] uppercase tracking-[0.18em] text-muted-foreground">
                      Total Payout Cap
                    </span>
                    <input
                      className="w-full rounded-[0.9rem] border border-white/[0.08] bg-black/[0.18] px-3 py-2.5 text-sm text-foreground outline-none transition focus:border-white/[0.16] disabled:cursor-not-allowed disabled:opacity-60"
                      defaultValue={row.deal.payoutCapTotal ?? ""}
                      disabled={!row.canEditDeal}
                      name="payoutCapTotal"
                      placeholder="0.00"
                      step="0.01"
                      type="number"
                    />
                  </label>

                  <label className="flex items-center gap-3 rounded-[0.9rem] border border-white/[0.08] bg-black/[0.14] px-3 py-2.5 text-sm text-foreground">
                    <input
                      defaultChecked={row.deal.deductPaidTraffic}
                      disabled={!row.canEditDeal}
                      name="deductPaidTraffic"
                      type="checkbox"
                    />
                    Deduct paid traffic before CPM
                  </label>

                  <label className="block xl:col-span-2">
                    <span className="mb-1.5 block text-[0.62rem] uppercase tracking-[0.18em] text-muted-foreground">
                      Notes
                    </span>
                    <input
                      className="w-full rounded-[0.9rem] border border-white/[0.08] bg-black/[0.18] px-3 py-2.5 text-sm text-foreground outline-none transition focus:border-white/[0.16] disabled:cursor-not-allowed disabled:opacity-60"
                      defaultValue={row.deal.notes ?? ""}
                      disabled={!row.canEditDeal}
                      name="notes"
                      placeholder="Contract notes, exceptions, or manual payout rules"
                    />
                  </label>

                  <div className="flex items-end gap-2 xl:col-span-6">
                    <button
                      className="inline-flex items-center justify-center rounded-[0.9rem] border border-white/[0.1] bg-white/[0.06] px-4 py-2.5 text-sm text-foreground transition hover:border-white/[0.16] hover:bg-white/[0.1] disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={!row.canEditDeal}
                      type="submit"
                    >
                      Save deal
                    </button>
                  </div>
                </form>

                <form action={clearDealAction} className="mt-2">
                  <input name="campaignCreatorId" type="hidden" value={row.campaignCreatorId} />
                  <button
                    className="text-sm text-muted-foreground transition hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={!row.canEditDeal || !row.hasCustomDeal}
                    type="submit"
                  >
                    Remove custom override
                  </button>
                </form>
              </div>
            </details>
          ))}
        </div>
      </section>

      <section className="rounded-[1.55rem] border border-white/[0.08] bg-white/[0.03] p-5 shadow-[0_24px_70px_rgba(0,0,0,0.2)] backdrop-blur">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.28em] text-muted-foreground">
              Video Breakdown
            </p>
            <h2 className="mt-2 text-lg font-medium tracking-[-0.04em] text-foreground">
              Highest-cost video rows
            </h2>
          </div>
          <p className="text-sm text-muted-foreground">
            Costs here are variable CPM accrual. Fixed fees stay on the creator row.
          </p>
        </div>

        <div className="mt-5 overflow-x-auto">
          <table className="min-w-[1080px] w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-white/[0.08] text-[0.62rem] uppercase tracking-[0.18em] text-muted-foreground">
                <th className="pb-3 pr-4 font-medium">Creator</th>
                <th className="pb-3 pr-4 font-medium">Campaign</th>
                <th className="pb-3 pr-4 font-medium">Video</th>
                <th className="pb-3 pr-4 font-medium">Platform</th>
                <th className="pb-3 pr-4 font-medium">Gross</th>
                <th className="pb-3 pr-4 font-medium">Paid</th>
                <th className="pb-3 pr-4 font-medium">Payable</th>
                <th className="pb-3 pr-4 font-medium">Variable Cost</th>
                <th className="pb-3 pr-0 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.videos.slice(0, 25).map((row) => (
                <tr key={row.videoId} className="border-b border-white/[0.05] align-top">
                  <td className="py-3 pr-4 text-foreground">{row.creatorName}</td>
                  <td className="py-3 pr-4 text-muted-foreground">{row.campaignName}</td>
                  <td className="py-3 pr-4">
                    <a
                      className="text-foreground underline decoration-white/[0.18] underline-offset-4 transition hover:decoration-white/[0.4]"
                      href={row.videoUrl}
                      rel="noreferrer"
                      target="_blank"
                    >
                      {row.titleOrCaption?.trim() || row.sourceVideoId || "Open video"}
                    </a>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {formatDateLabel(row.publishedAt)}
                    </p>
                  </td>
                  <td className="py-3 pr-4 text-muted-foreground">
                    {row.platform === "INSTAGRAM_REELS"
                      ? "Instagram"
                      : row.platform === "YOUTUBE_SHORTS"
                        ? "YouTube"
                        : "TikTok"}
                  </td>
                  <td className="py-3 pr-4 text-muted-foreground">{formatMetricValue(row.grossViews, true)}</td>
                  <td className="py-3 pr-4 text-muted-foreground">{formatMetricValue(row.paidViewsDeducted, true)}</td>
                  <td className="py-3 pr-4 text-muted-foreground">{formatMetricValue(row.payableViews, true)}</td>
                  <td className="py-3 pr-4 text-foreground">{formatMoney(row.variableCost)}</td>
                  <td className="py-3 pr-0">
                    <div className="flex flex-wrap gap-2 text-[0.62rem] uppercase tracking-[0.16em]">
                      <span className="rounded-full border border-white/[0.08] bg-white/[0.05] px-2.5 py-1 text-muted-foreground">
                        {row.paidStatus.replaceAll("_", " ")}
                      </span>
                      <span className="rounded-full border border-white/[0.08] bg-white/[0.05] px-2.5 py-1 text-muted-foreground">
                        {row.sourceLabel} · {formatMoney(row.effectiveCpm, row.currency)} CPM
                      </span>
                      {row.viewCapReached ? (
                        <span className="rounded-full border border-[#FFD24D]/20 bg-[#FFD24D]/10 px-2.5 py-1 text-[#FFE7A6]">
                          per-video cap
                        </span>
                      ) : null}
                      {row.creatorTotalCapApplied ? (
                        <span className="rounded-full border border-[#FF7E54]/20 bg-[#FF7E54]/10 px-2.5 py-1 text-[#FFD3C5]">
                          creator cap
                        </span>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
