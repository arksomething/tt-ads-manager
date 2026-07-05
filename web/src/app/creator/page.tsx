import { redirect } from "next/navigation";

import type { DashboardSearchParams } from "@/server/dashboard/filters";
import {
  canCurrentUserEditCreatorPortalDeals,
  clearCreatorPortalSessionCookie,
  getCreatorPortalDefaultDateRange,
  getCurrentCreatorPortalAccess,
} from "@/server/creator-portal/access";
import { hasPendingCreatorPortalData } from "@/server/creator-portal/pending";
import { getCreatorPortalFeedSort } from "@/lib/creator-portal-feed";
import { getOrganizationUgcPayData } from "@/server/ugc-pay/queries";

import { CreatorLedgerClient } from "./creator-ledger-client";
import { CreatorPortalPendingRefresh } from "./pending-refresh";

export const dynamic = "force-dynamic";

type CreatorPortalPageProps = {
  searchParams: Promise<DashboardSearchParams>;
};

const numberFormatter = new Intl.NumberFormat("en-US");
const compactNumberFormatter = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});
const currencyFormatters = new Map<string, Intl.NumberFormat>();

function getSearchParamValue(searchParams: DashboardSearchParams, key: string) {
  const value = searchParams[key];
  return Array.isArray(value) ? value[0] : value;
}

function formatMoney(value: number, currency = "USD") {
  const key = currency.toUpperCase();
  const formatter =
    currencyFormatters.get(key) ??
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: key,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

  currencyFormatters.set(key, formatter);
  return formatter.format(value);
}

function formatNumber(value: number) {
  return numberFormatter.format(Math.round(value));
}

function formatCompactNumber(value: number) {
  return compactNumberFormatter.format(value);
}

function formatDateInputValue(value: string | undefined) {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
}

function formatCreatorWarning(warning: string) {
  return warning.replace(
    "This page will check again automatically and reuse the export once it is ready.",
    "Refresh this page later to reuse the export once it is ready.",
  );
}

function formatPayBreakdown(summary: {
  fixedPay: number;
  videoFixedPay: number;
  cpmPay: number;
}) {
  return `${formatMoney(summary.fixedPay)} creator fixed + ${formatMoney(summary.videoFixedPay)} video fixed + ${formatMoney(summary.cpmPay)} CPM`;
}

function formatDateLabel(value: Date | null | undefined) {
  if (!value) {
    return "Open";
  }

  return value.toISOString().slice(0, 10);
}

function formatCapScope(value: string) {
  if (value === "TOTAL") {
    return "Total video pay";
  }

  if (value === "CPM") {
    return "CPM pay";
  }

  return "No cap";
}

function formatPaidTrafficMetric(value: string) {
  return value
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function StatTile({
  detail,
  label,
  value,
}: {
  detail?: string;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-[1.1rem] border border-white/[0.08] bg-white/[0.035] p-4">
      <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-2 text-2xl font-semibold tracking-[-0.03em] text-foreground">
        {value}
      </p>
      {detail ? (
        <p className="mt-1 text-xs leading-5 text-muted-foreground">{detail}</p>
      ) : null}
    </div>
  );
}

function DealTermTile({
  detail,
  label,
  value,
}: {
  detail?: string;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-[1rem] border border-white/[0.08] bg-black/25 p-4">
      <p className="text-[0.65rem] uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-2 text-base font-semibold text-foreground">{value}</p>
      {detail ? (
        <p className="mt-1 text-xs leading-5 text-muted-foreground">{detail}</p>
      ) : null}
    </div>
  );
}

function CreatorLinkRequired({
  error,
}: {
  error: string | undefined;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <section className="w-full max-w-md rounded-[1.45rem] border border-white/[0.08] bg-[#0D0E11]/90 p-6 shadow-[0_28px_90px_rgba(0,0,0,0.36)] sm:p-7">
        <p className="text-[0.65rem] uppercase tracking-[0.24em] text-muted-foreground">
          Creator Portal
        </p>
        <h1 className="mt-4 text-3xl font-semibold tracking-[-0.05em] text-foreground">
          Use your private link
        </h1>
        <p className="mt-4 text-sm leading-6 text-muted-foreground">
          Open the private portal link from your campaign manager.
        </p>
        {error ? (
          <p className="mt-5 rounded-[0.9rem] border border-[#FF7E54]/20 bg-[#FF7E54]/[0.08] px-3 py-2 text-sm text-[#FFD3C5]">
            That creator link is not active.
          </p>
        ) : null}
      </section>
    </main>
  );
}

export default async function CreatorPortalPage({
  searchParams,
}: CreatorPortalPageProps) {
  const resolvedSearchParams = await searchParams;
  const access = await getCurrentCreatorPortalAccess();

  if (!access) {
    return (
      <CreatorLinkRequired
        error={getSearchParamValue(resolvedSearchParams, "error")}
      />
    );
  }

  async function signOut() {
    "use server";

    await clearCreatorPortalSessionCookie();
    redirect("/creator");
  }

  const campaignId = access.campaignCreator?.campaignId as string | undefined;
  const canEditDeals = await canCurrentUserEditCreatorPortalDeals({
    campaignId,
    organizationSlug: access.organization.slug,
  });
  const hasExplicitDateRange = Boolean(
    getSearchParamValue(resolvedSearchParams, "startDate") ||
      getSearchParamValue(resolvedSearchParams, "endDate"),
  );
  const defaultDateRange = hasExplicitDateRange
    ? null
    : await getCreatorPortalDefaultDateRange({
        campaignId,
        creatorId: access.creatorId as string,
      });
  const data = await getOrganizationUgcPayData({
    organizationSlug: access.organization.slug,
    searchParams: {
      ...resolvedSearchParams,
      ...(campaignId ? { campaign: campaignId } : {}),
      ...(defaultDateRange ?? {}),
    },
    creatorAccess: {
      organizationId: access.organizationId as string,
      creatorId: access.creatorId as string,
      campaignCreatorId: access.campaignCreatorId as string | null,
    },
  });

  if (hasPendingCreatorPortalData(data.warnings)) {
    return <CreatorPortalPendingRefresh />;
  }

  const creator = data.creators[0] ?? null;
  const feedSort = getCreatorPortalFeedSort(
    getSearchParamValue(resolvedSearchParams, "feedSort"),
  );
  const ledgerVideos = data.videos.map((video) => ({
    ...video,
    createdAt: video.createdAt.toISOString(),
    publishedAt: video.publishedAt?.toISOString() ?? null,
  }));
  const editableCreator = creator
    ? {
        campaignCreatorId: creator.campaignCreatorId,
        currency: creator.currency,
        deal: {
          ...creator.deal,
          effectiveStartDate: creator.deal.effectiveStartDate.toISOString(),
          effectiveEndDate:
            creator.deal.effectiveEndDate?.toISOString() ?? null,
          fixedFeeRecognitionDate:
            creator.deal.fixedFeeRecognitionDate?.toISOString() ?? null,
        },
        hasCustomDeal: creator.hasCustomDeal,
      }
    : null;

  return (
    <main className="min-h-screen px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-5">
        <header className="flex flex-col gap-4 rounded-[1.45rem] border border-white/[0.08] bg-[#0D0E11]/90 p-5 shadow-[0_24px_80px_rgba(0,0,0,0.28)] sm:p-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-[0.65rem] uppercase tracking-[0.24em] text-muted-foreground">
              {access.organization.name}
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-[-0.05em] text-foreground sm:text-4xl">
              {access.creator.displayName}
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {data.selectedCampaignLabel ?? access.campaignCreator?.campaign?.name ?? "Creator payout"}
            </p>
          </div>

          <form action={signOut}>
            <button
              className="rounded-[0.9rem] border border-white/[0.1] px-4 py-2 text-sm text-muted-foreground transition hover:border-white/[0.18] hover:text-foreground"
              type="submit"
            >
              Sign out
            </button>
          </form>
        </header>

        <form className="grid gap-3 rounded-[1.25rem] border border-white/[0.08] bg-white/[0.03] p-4 sm:grid-cols-[repeat(4,minmax(0,1fr))_auto] sm:items-end">
          <label>
            <span className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
              Start
            </span>
            <input
              className="mt-2 w-full rounded-[0.85rem] border border-white/[0.08] bg-black/25 px-3 py-2 text-sm text-foreground"
              defaultValue={formatDateInputValue(data.startDate)}
              name="startDate"
              type="date"
            />
          </label>
          <label>
            <span className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
              End
            </span>
            <input
              className="mt-2 w-full rounded-[0.85rem] border border-white/[0.08] bg-black/25 px-3 py-2 text-sm text-foreground"
              defaultValue={formatDateInputValue(data.endDate)}
              name="endDate"
              type="date"
            />
          </label>
          <input name="viewWindowMode" type="hidden" value="all" />
          <label>
            <span className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
              Pay basis
            </span>
            <select
              className="mt-2 w-full rounded-[0.85rem] border border-white/[0.08] bg-black/25 px-3 py-2 text-sm text-foreground"
              defaultValue={data.payMode}
              name="payMode"
            >
              <option value="gained">Period views</option>
              <option value="posted">Post date</option>
            </select>
          </label>
          <div>
            <span className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
              Included videos
            </span>
            <div className="mt-2 w-full rounded-[0.85rem] border border-white/[0.08] bg-black/25 px-3 py-2 text-sm text-foreground">
              {data.payMode === "posted"
                ? "Posted in selected range"
                : "Posted or viewed in selected range"}
            </div>
          </div>
          <button
            className="rounded-[0.85rem] bg-white px-4 py-2 text-sm font-semibold text-black transition hover:bg-[#90FF4D]"
            type="submit"
          >
            Update
          </button>
        </form>

        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <StatTile
            detail={formatPayBreakdown(data.summary)}
            label="Total pay"
            value={formatMoney(data.summary.totalPay)}
          />
          <StatTile
            detail={`${formatCompactNumber(data.summary.grossViews)} gross views`}
            label="Payable views"
            value={formatCompactNumber(data.summary.payableViews)}
          />
          <StatTile
            detail={`${formatMoney(data.summary.videoFixedPay)} video fixed + ${formatMoney(data.summary.cpmPay)} CPM`}
            label="Video pay"
            value={formatMoney(data.summary.videoPay)}
          />
          <StatTile
            detail={`${data.summary.exactPaidVideos} exact paid-status rows`}
            label="Videos"
            value={formatNumber(data.summary.videos)}
          />
        </section>

        {creator ? (
          <section className="rounded-[1.35rem] border border-white/[0.08] bg-white/[0.03] p-5">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                  Deal terms
                </p>
                <h2 className="mt-2 text-xl font-semibold tracking-[-0.03em]">
                  {creator.hasCustomDeal ? "Custom terms" : "Default terms"}
                </h2>
              </div>
              <p className="text-sm text-muted-foreground">
                {formatDateLabel(creator.deal.effectiveStartDate)} to{" "}
                {formatDateLabel(creator.deal.effectiveEndDate)}
              </p>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <DealTermTile
                detail="Added to each eligible video before caps."
                label="Per-video fixed"
                value={formatMoney(creator.deal.fixedFeePerVideo ?? 0, creator.currency)}
              />
              <DealTermTile
                detail="Applied as payable views / 1,000 x CPM."
                label="CPM"
                value={formatMoney(creator.deal.cpmAmount, creator.currency)}
              />
              <DealTermTile
                detail={
                  creator.deal.viewCapPerVideo != null
                    ? "Maximum payable views per video."
                    : "No separate view cap saved."
                }
                label="View cap"
                value={
                  creator.deal.viewCapPerVideo != null
                    ? formatNumber(creator.deal.viewCapPerVideo)
                    : "None"
                }
              />
              <DealTermTile
                detail={formatCapScope(creator.deal.perVideoCapScope)}
                label="Per-video payout cap"
                value={
                  creator.deal.perVideoCapScope === "NONE"
                    ? "None"
                    : formatMoney(creator.deal.payoutCapPerVideo, creator.currency)
                }
              />
              <DealTermTile
                detail={
                  creator.deal.fixedFeeRecognitionDate
                    ? `Recognized ${formatDateLabel(creator.deal.fixedFeeRecognitionDate)}.`
                    : "Recognized from the deal start date."
                }
                label="Creator fixed"
                value={formatMoney(creator.deal.fixedFee ?? 0, creator.currency)}
              />
              <DealTermTile
                detail="Caps creator fixed plus video pay for this deal period."
                label="Creator total cap"
                value={
                  creator.deal.payoutCapTotal != null
                    ? formatMoney(creator.deal.payoutCapTotal, creator.currency)
                    : "None"
                }
              />
              <DealTermTile
                detail={formatPaidTrafficMetric(creator.deal.paidTrafficMetric)}
                label="Paid traffic"
                value={creator.deal.deductPaidTraffic ? "Deducted" : "Not deducted"}
              />
              <DealTermTile
                detail="Default window used for creator terms."
                label="View window"
                value={`${formatNumber(creator.deal.viewWindowDays)} days`}
              />
            </div>
          </section>
        ) : null}

        <section className="grid gap-4 rounded-[1.35rem] border border-white/[0.08] bg-white/[0.03] p-5 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
              Formula
            </p>
            <h2 className="mt-2 text-xl font-semibold tracking-[-0.03em]">
              {formatMoney(data.summary.totalPay)} total
            </h2>
            <div className="mt-4 rounded-[1rem] border border-white/[0.08] bg-black/30 p-4 font-mono text-sm leading-7 text-foreground">
              <p>total = fixed fees + sum(video pay)</p>
              <p>
                {formatMoney(data.summary.totalPay)} = {formatMoney(data.summary.fixedPay)} + {formatMoney(data.summary.videoPay)}
              </p>
              <p>total = creator fixed + video fixed + CPM pay</p>
              <p>
                {formatMoney(data.summary.totalPay)} = {formatMoney(data.summary.fixedPay)} + {formatMoney(data.summary.videoFixedPay)} + {formatMoney(data.summary.cpmPay)}
              </p>
              <p>video pay = fixed/video + CPM pay</p>
              <p>
                {formatMoney(data.summary.videoPay)} = {formatMoney(data.summary.videoFixedPay)} + {formatMoney(data.summary.cpmPay)}
              </p>
              <p>CPM pay = (payable views / 1000) x CPM</p>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <StatTile
              label="Fixed fees"
              detail={`${formatMoney(data.summary.fixedPay)} creator fixed + ${formatMoney(data.summary.videoFixedPay)} video fixed`}
              value={formatMoney(data.summary.fixedPay + data.summary.videoFixedPay)}
            />
            <StatTile
              label="CPM pay"
              value={formatMoney(data.summary.cpmPay)}
            />
            <StatTile
              label="Paid views deducted"
              value={formatCompactNumber(data.summary.paidViewsDeducted)}
            />
            <StatTile
              label="Caps"
              value={
                creator?.videoCapReached || creator?.creatorTotalCapApplied
                  ? "Applied"
                  : "None"
              }
            />
          </div>
        </section>

        {data.errorMessage ? (
          <section className="rounded-[1rem] border border-[#FF7E54]/20 bg-[#FF7E54]/[0.08] px-4 py-3 text-sm text-[#FFD3C5]">
            {data.errorMessage}
          </section>
        ) : null}

        {data.warnings.length > 0 ? (
          <section className="rounded-[1rem] border border-[#FFD24D]/20 bg-[#FFD24D]/[0.08] px-4 py-3 text-sm leading-6 text-[#FFEAB1]">
            {data.warnings.slice(0, 4).map(formatCreatorWarning).join(" ")}
          </section>
        ) : null}

        <CreatorLedgerClient
          canEditDeals={canEditDeals}
          creator={editableCreator}
          initialSort={feedSort}
          videos={ledgerVideos}
        />
      </div>
    </main>
  );
}
