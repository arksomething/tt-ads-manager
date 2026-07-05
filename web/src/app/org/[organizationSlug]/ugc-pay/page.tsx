import { redirect } from "next/navigation";
import { Suspense, type ReactNode } from "react";

import { DashboardIcon } from "@/components/org-dashboard/org-icons";
import {
  CreatorDealPaidTrafficMetric,
  CreatorDealPerVideoCapScope,
} from "@/lib/prisma-shim";
import { type DashboardSearchParams } from "@/server/dashboard/filters";
import {
  deleteCampaignCreatorDealForOrganization,
  deleteCampaignCreatorVideoDealForOrganization,
  upsertCampaignCreatorDealForOrganization,
  upsertCampaignCreatorVideoDealForOrganization,
} from "@/server/payouts/mutations";
import {
  getOrganizationUgcPayData,
  type UgcPayMode,
  type UgcPayVideoFetchMode,
  type UgcPayViewWindowMode,
  type UgcPayCreatorRow,
  type UgcPayVideoRow,
} from "@/server/ugc-pay/queries";

import { UgcPayClient } from "./ugc-pay-client";
import UgcPayLoading from "./loading";

export const dynamic = "force-dynamic";

type UgcPayPageProps = {
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
const dealInputClassName =
  "w-full rounded-[0.75rem] border border-white/[0.08] bg-black/[0.18] px-2.5 py-2 text-xs text-foreground outline-none transition focus:border-white/[0.16]";

type DealAction = (formData: FormData) => Promise<void>;

function getSearchParamValue(searchParams: DashboardSearchParams, key: string) {
  const value = searchParams[key];
  return Array.isArray(value) ? value[0] : value;
}

function getTrimmedFormValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function buildUgcPayHref(args: {
  organizationSlug: string;
  searchParams: DashboardSearchParams;
  notice?: string | null;
  error?: string | null;
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
    ? `/org/${args.organizationSlug}/ugc-pay?${query}`
    : `/org/${args.organizationSlug}/ugc-pay`;
}

function getNoticeLabel(value: string | undefined) {
  switch (value) {
    case "creator-deal-saved":
      return "Creator deal structure saved.";
    case "creator-deal-cleared":
      return "Creator deal override removed.";
    case "video-deal-saved":
      return "Video deal override saved.";
    case "video-deal-cleared":
      return "Video deal override removed.";
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

function getActionErrorMessage(error: unknown) {
  const digest =
    typeof error === "object" &&
    error !== null &&
    "digest" in error &&
    typeof (error as { digest?: unknown }).digest === "string"
      ? (error as { digest: string }).digest
      : null;

  if (digest?.startsWith("NEXT_REDIRECT")) {
    throw error;
  }

  return error instanceof Error ? error.message : "Something went wrong.";
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

function formatPayableViewsWithGross(item: {
  grossViews: number;
  paidViewsDeducted: number;
  payableViews: number;
}) {
  const payableLabel = formatMetricValue(item.payableViews, true);

  return item.paidViewsDeducted > 0 && item.grossViews > item.payableViews
    ? `${payableLabel} (${formatMetricValue(item.grossViews, true)})`
    : payableLabel;
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

function FieldLabel({
  children,
  label,
}: {
  children: ReactNode;
  label: string;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[0.56rem] uppercase text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}

function TooltipLabel({ label, tip }: { label: string; tip: string }) {
  return (
    <span className="mb-1.5 flex items-center gap-1.5 text-[0.62rem] uppercase text-muted-foreground">
      <span>{label}</span>
      <span
        aria-label={`${label}: ${tip}`}
        className="group relative inline-flex h-4 w-4 items-center justify-center rounded-full text-muted-foreground outline-none transition hover:text-foreground focus-visible:text-foreground"
        role="img"
        tabIndex={0}
      >
        <DashboardIcon className="h-3.5 w-3.5" name="info" />
        <span className="pointer-events-none absolute left-1/2 top-full z-30 mt-2 hidden w-64 -translate-x-1/2 rounded-[0.75rem] border border-white/[0.1] bg-[#111114] px-3 py-2 text-left text-xs normal-case leading-5 text-foreground shadow-[0_18px_50px_rgba(0,0,0,0.45)] group-hover:block group-focus-visible:block">
          {tip}
        </span>
      </span>
    </span>
  );
}

function OptionTip({ children, tip }: { children: ReactNode; tip: string }) {
  return (
    <span className="group relative flex min-h-10 items-center justify-center rounded-[0.75rem] px-3 text-center text-sm text-muted-foreground transition peer-checked:bg-white/[0.1] peer-checked:text-foreground">
      <span>{children}</span>
      <span className="pointer-events-none absolute left-1/2 top-full z-30 mt-2 hidden w-64 -translate-x-1/2 rounded-[0.75rem] border border-white/[0.1] bg-[#111114] px-3 py-2 text-left text-xs leading-5 text-foreground shadow-[0_18px_50px_rgba(0,0,0,0.45)] group-hover:block group-focus-within:block">
        {tip}
      </span>
    </span>
  );
}

function getVideoTitle(video: Pick<UgcPayVideoRow, "titleOrCaption" | "creatorName">) {
  const title = video.titleOrCaption?.trim();
  return title && title.length > 0 ? title : `${video.creatorName} on TikTok`;
}

function formatDealLabel(creator: UgcPayCreatorRow) {
  const cpmLabel = `${formatMoney(creator.deal.cpmAmount, creator.currency)} CPM`;
  const fixedPerVideoLabel =
    creator.deal.fixedFeePerVideo != null && creator.deal.fixedFeePerVideo > 0
      ? `${formatMoney(creator.deal.fixedFeePerVideo, creator.currency)}/video fixed + `
      : "";
  const fixedFeeLabel =
    creator.deal.fixedFee != null && creator.deal.fixedFee > 0
      ? `${formatMoney(creator.deal.fixedFee, creator.currency)} fixed fee + `
      : "";
  const capLabel =
    creator.deal.perVideoCapScope === "NONE"
      ? "no per-video cap"
      : creator.deal.perVideoCapScope === "TOTAL"
        ? `${formatMoney(creator.deal.payoutCapPerVideo, creator.currency)} total cap`
        : `${formatMoney(creator.deal.payoutCapPerVideo, creator.currency)} CPM cap`;

  return `${fixedFeeLabel}${fixedPerVideoLabel}${cpmLabel}, ${capLabel}`;
}

function getPaidStatusLabel(video: UgcPayVideoRow) {
  switch (video.paidStatus) {
    case "yes":
      return "Paid impressions deducted";
    case "no":
      return "Organic";
    case "unsupported":
      return "Unsupported";
    default:
      return "Unknown";
  }
}

function getPayModeLabel(payMode: UgcPayMode) {
  return payMode === "gained" ? "Gained views" : "Posted in range";
}

function getViewWindowModeLabel(
  viewWindowMode: UgcPayViewWindowMode,
  globalViewWindowDays: number,
) {
  return viewWindowMode === "first-days"
    ? `First ${formatMetricValue(globalViewWindowDays)} days`
    : "All report views";
}

function getVideoFetchModeLabel(videoFetchMode: UgcPayVideoFetchMode) {
  return videoFetchMode === "per-creator"
    ? "Accurate creators"
    : "Global top 100";
}

function SummaryCard({
  label,
  value,
  detail,
  iconName,
}: {
  label: string;
  value: string;
  detail: string;
  iconName: "payouts" | "videos" | "creators" | "overview";
}) {
  return (
    <article className="rounded-[1.15rem] border border-white/[0.08] bg-black/[0.18] p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[0.62rem] uppercase text-muted-foreground">
          {label}
        </p>
        <DashboardIcon className="h-4 w-4 text-muted-foreground" name={iconName} />
      </div>
      <p className="mt-3 text-[1.65rem] font-semibold leading-none tracking-normal text-foreground">
        {value}
      </p>
      <p className="mt-2 text-sm leading-5 text-muted-foreground">{detail}</p>
    </article>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="rounded-[1.15rem] border border-white/[0.08] bg-black/[0.18] px-4 py-10 text-sm text-muted-foreground">
      {label}
    </div>
  );
}

function CreatorDealEditor({
  clearCreatorDealAction,
  creator,
  saveCreatorDealAction,
}: {
  clearCreatorDealAction: DealAction;
  creator: UgcPayCreatorRow;
  saveCreatorDealAction: DealAction;
}) {
  return (
    <div className="rounded-[1rem] border border-white/[0.08] bg-black/[0.16] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-[0.62rem] uppercase text-muted-foreground">
            Creator Deal Structure
          </p>
          <p className="mt-1 text-sm text-foreground">
            {creator.hasCustomDeal ? "Custom override" : "Default terms"}
          </p>
        </div>
        <form action={clearCreatorDealAction}>
          <input
            name="campaignCreatorId"
            type="hidden"
            value={creator.campaignCreatorId}
          />
          <input name="dealId" type="hidden" value={creator.deal.id ?? ""} />
          <button
            className="text-xs text-muted-foreground transition hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
            disabled={!creator.hasCustomDeal}
            type="submit"
          >
            Remove override
          </button>
        </form>
      </div>

      <form action={saveCreatorDealAction} className="mt-3 space-y-3">
        <input
          name="campaignCreatorId"
          type="hidden"
          value={creator.campaignCreatorId}
        />
        <input name="dealId" type="hidden" value={creator.deal.id ?? ""} />
        <div className="grid gap-2 md:grid-cols-3 xl:grid-cols-6">
          <FieldLabel label="Currency">
            <input
              className={dealInputClassName}
              defaultValue={creator.currency}
              maxLength={3}
              name="currency"
            />
          </FieldLabel>
          <FieldLabel label="Deal Start">
            <input
              className={dealInputClassName}
              defaultValue={formatDateInputValue(creator.deal.effectiveStartDate)}
              name="effectiveStartDate"
              type="date"
            />
          </FieldLabel>
          <FieldLabel label="Deal End">
            <input
              className={dealInputClassName}
              defaultValue={formatDateInputValue(creator.deal.effectiveEndDate)}
              name="effectiveEndDate"
              type="date"
            />
          </FieldLabel>
          <FieldLabel label="Base Fixed Fee">
            <input
              className={dealInputClassName}
              defaultValue={creator.deal.fixedFee ?? ""}
              name="fixedFee"
              placeholder="0.00"
              step="0.01"
              type="number"
            />
          </FieldLabel>
          <FieldLabel label="Fixed Fee Date">
            <input
              className={dealInputClassName}
              defaultValue={formatDateInputValue(
                creator.deal.fixedFeeRecognitionDate,
              )}
              name="fixedFeeRecognitionDate"
              type="date"
            />
          </FieldLabel>
          <FieldLabel label="Fixed / Video">
            <input
              className={dealInputClassName}
              defaultValue={creator.deal.fixedFeePerVideo ?? ""}
              name="fixedFeePerVideo"
              placeholder="0.00"
              step="0.01"
              type="number"
            />
          </FieldLabel>
          <FieldLabel label="CPM">
            <input
              className={dealInputClassName}
              defaultValue={creator.deal.cpmAmount}
              name="cpmAmount"
              placeholder="0.00"
              step="0.01"
              type="number"
            />
          </FieldLabel>
          <FieldLabel label="View Window">
            <input
              className={dealInputClassName}
              defaultValue={creator.deal.viewWindowDays}
              min="1"
              name="viewWindowDays"
              step="1"
              type="number"
            />
          </FieldLabel>
          <FieldLabel label="Paid Metric">
            <select
              className={dealInputClassName}
              defaultValue={creator.deal.paidTrafficMetric}
              name="paidTrafficMetric"
            >
              <option value={CreatorDealPaidTrafficMetric.IMPRESSIONS}>
                Impressions
              </option>
              <option value={CreatorDealPaidTrafficMetric.VIDEO_PLAY_ACTIONS}>
                Video plays
              </option>
            </select>
          </FieldLabel>
          <FieldLabel label="View Cap / Video">
            <input
              className={dealInputClassName}
              defaultValue={creator.deal.viewCapPerVideo ?? ""}
              name="viewCapPerVideo"
              placeholder="100000"
              step="1"
              type="number"
            />
          </FieldLabel>
          <FieldLabel label="Payout Cap / Video">
            <input
              className={dealInputClassName}
              defaultValue={creator.deal.payoutCapPerVideo}
              name="payoutCapPerVideo"
              placeholder="100.00"
              step="0.01"
              type="number"
            />
          </FieldLabel>
          <FieldLabel label="Cap Scope">
            <select
              className={dealInputClassName}
              defaultValue={creator.deal.perVideoCapScope}
              name="perVideoCapScope"
            >
              <option value={CreatorDealPerVideoCapScope.CPM}>Cap CPM only</option>
              <option value={CreatorDealPerVideoCapScope.TOTAL}>
                Cap total video pay
              </option>
              <option value={CreatorDealPerVideoCapScope.NONE}>
                No per-video cap
              </option>
            </select>
          </FieldLabel>
          <FieldLabel label="Total Payout Cap">
            <input
              className={dealInputClassName}
              defaultValue={creator.deal.payoutCapTotal ?? ""}
              name="payoutCapTotal"
              placeholder="0.00"
              step="0.01"
              type="number"
            />
          </FieldLabel>
          <FieldLabel label="Notes">
            <input
              className={dealInputClassName}
              defaultValue={creator.deal.notes ?? ""}
              name="notes"
              placeholder="Contract notes or exceptions"
            />
          </FieldLabel>
        </div>
        <label className="flex min-h-9 items-center gap-2 rounded-[0.75rem] border border-white/[0.08] bg-black/[0.14] px-2.5 py-2 text-xs text-foreground">
          <input
            defaultChecked={creator.deal.deductPaidTraffic}
            name="deductPaidTraffic"
            type="checkbox"
          />
          Deduct paid traffic
        </label>
        <label className="flex min-h-9 items-center gap-2 rounded-[0.75rem] border border-white/[0.08] bg-black/[0.14] px-2.5 py-2 text-xs text-foreground">
          <input name="createNewDealPeriod" type="checkbox" />
          Save as new dated deal
        </label>
        <button
          className="inline-flex min-h-9 items-center justify-center rounded-[0.8rem] border border-[#90FF4D]/20 bg-[#90FF4D]/90 px-3 text-xs font-medium text-black transition hover:bg-[#A4FF68]"
          type="submit"
        >
          Save creator deal
        </button>
      </form>
    </div>
  );
}

function VideoDealEditor({
  clearVideoDealAction,
  saveVideoDealAction,
  video,
}: {
  clearVideoDealAction: DealAction;
  saveVideoDealAction: DealAction;
  video: UgcPayVideoRow;
}) {
  return (
    <details>
      <summary className="inline-flex min-h-8 cursor-pointer list-none items-center justify-center rounded-[0.75rem] border border-white/[0.1] bg-white/[0.05] px-2.5 text-xs text-foreground transition hover:border-white/[0.16] hover:bg-white/[0.08]">
        <DashboardIcon className="h-4 w-4" name="settings" />
      </summary>
      <div className="mt-2 w-[26rem] max-w-[70vw] rounded-[0.95rem] border border-white/[0.08] bg-[#090909] p-3 shadow-[0_18px_50px_rgba(0,0,0,0.45)]">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[0.62rem] uppercase text-muted-foreground">
            Video Deal Override
          </p>
          {video.hasVideoDealOverride ? (
            <span className="rounded-full border border-[#90FF4D]/20 bg-[#90FF4D]/10 px-2 py-0.5 text-[0.56rem] uppercase text-[#D4FFB2]">
              edited
            </span>
          ) : null}
        </div>
        <form action={saveVideoDealAction} className="mt-3 space-y-3">
          <input
            name="campaignCreatorId"
            type="hidden"
            value={video.campaignCreatorId}
          />
          <input name="sourceVideoId" type="hidden" value={video.sourceVideoId} />
          <div className="grid gap-2 sm:grid-cols-2">
            <FieldLabel label="Fixed / Video">
              <input
                className={dealInputClassName}
                defaultValue={video.fixedFeePerVideo || ""}
                name="fixedFeePerVideo"
                placeholder="0.00"
                step="0.01"
                type="number"
              />
            </FieldLabel>
            <FieldLabel label="CPM">
              <input
                className={dealInputClassName}
                defaultValue={video.cpmAmount}
                name="cpmAmount"
                placeholder="0.00"
                step="0.01"
                type="number"
              />
            </FieldLabel>
            <FieldLabel label="Paid Metric">
              <select
                className={dealInputClassName}
                defaultValue={video.paidTrafficMetric}
                name="paidTrafficMetric"
              >
                <option value={CreatorDealPaidTrafficMetric.IMPRESSIONS}>
                  Impressions
                </option>
                <option value={CreatorDealPaidTrafficMetric.VIDEO_PLAY_ACTIONS}>
                  Video plays
                </option>
              </select>
            </FieldLabel>
            <FieldLabel label="View Cap">
              <input
                className={dealInputClassName}
                defaultValue={video.viewCapPerVideo ?? ""}
                name="viewCapPerVideo"
                placeholder="100000"
                step="1"
                type="number"
              />
            </FieldLabel>
            <FieldLabel label="Payout Cap">
              <input
                className={dealInputClassName}
                defaultValue={video.payoutCapPerVideo}
                name="payoutCapPerVideo"
                placeholder="100.00"
                step="0.01"
                type="number"
              />
            </FieldLabel>
            <FieldLabel label="Cap Scope">
              <select
                className={dealInputClassName}
                defaultValue={video.perVideoCapScope}
                name="perVideoCapScope"
              >
                <option value={CreatorDealPerVideoCapScope.CPM}>Cap CPM only</option>
                <option value={CreatorDealPerVideoCapScope.TOTAL}>
                  Cap total video pay
                </option>
                <option value={CreatorDealPerVideoCapScope.NONE}>
                  No per-video cap
                </option>
              </select>
            </FieldLabel>
            <FieldLabel label="Notes">
              <input
                className={dealInputClassName}
                defaultValue={video.videoDealNotes ?? ""}
                name="notes"
                placeholder="Special video terms"
              />
            </FieldLabel>
          </div>
          <label className="flex min-h-9 items-center gap-2 rounded-[0.75rem] border border-white/[0.08] bg-black/[0.14] px-2.5 py-2 text-xs text-foreground">
            <input
              defaultChecked={video.deductPaidTraffic}
              name="deductPaidTraffic"
              type="checkbox"
            />
            Deduct paid traffic
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <button
              className="inline-flex min-h-8 items-center rounded-[0.8rem] border border-[#90FF4D]/20 bg-[#90FF4D]/90 px-3 text-xs font-medium text-black transition hover:bg-[#A4FF68]"
              type="submit"
            >
              Save video deal
            </button>
          </div>
        </form>
        <form action={clearVideoDealAction} className="mt-2">
          <input
            name="campaignCreatorId"
            type="hidden"
            value={video.campaignCreatorId}
          />
          <input name="sourceVideoId" type="hidden" value={video.sourceVideoId} />
          <button
            className="text-xs text-muted-foreground transition hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
            disabled={!video.hasVideoDealOverride}
            type="submit"
          >
            Remove video override
          </button>
        </form>
      </div>
    </details>
  );
}

function CreatorPayRow({
  clearCreatorDealAction,
  clearVideoDealAction,
  creator,
  saveCreatorDealAction,
  saveVideoDealAction,
}: {
  clearCreatorDealAction: DealAction;
  clearVideoDealAction: DealAction;
  creator: UgcPayCreatorRow;
  saveCreatorDealAction: DealAction;
  saveVideoDealAction: DealAction;
}) {
  return (
    <details className="group border-b border-white/[0.06] last:border-b-0">
      <summary className="grid cursor-pointer list-none gap-3 px-4 py-4 md:grid-cols-[minmax(0,1.4fr)_minmax(0,0.85fr)_minmax(0,0.85fr)_minmax(0,0.75fr)_auto] md:items-center">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-sm font-semibold text-foreground">
              {creator.creatorName}
            </h3>
            <span
              className={`rounded-full border px-2 py-0.5 text-[0.62rem] uppercase ${
                creator.hasCustomDeal
                  ? "border-[#7BB2FF]/25 bg-[#7BB2FF]/10 text-[#D6E7FF]"
                  : "border-white/[0.08] bg-white/[0.05] text-muted-foreground"
              }`}
            >
              {creator.hasCustomDeal ? "custom" : "default"}
            </span>
            {creator.creatorTotalCapApplied || creator.videoCapReached ? (
              <span className="rounded-full border border-[#FFD24D]/20 bg-[#FFD24D]/10 px-2 py-0.5 text-[0.62rem] uppercase text-[#FFE7A6]">
                capped
              </span>
            ) : null}
          </div>
          <p className="mt-1 truncate text-xs text-muted-foreground">
            {creator.tiktokHandle ? `@${creator.tiktokHandle}` : creator.campaignName}
          </p>
        </div>

        <div>
          <p className="text-[0.62rem] uppercase text-muted-foreground">
            Pay
          </p>
          <p className="mt-1 text-sm font-semibold text-foreground">
            {formatMoney(creator.totalPay, creator.currency)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {formatMoney(creator.fixedPay, creator.currency)} fixed
          </p>
        </div>

        <div>
          <p className="text-[0.62rem] uppercase text-muted-foreground">
            Views
          </p>
          <p className="mt-1 text-sm text-foreground">
            {formatPayableViewsWithGross(creator)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {formatMetricValue(creator.paidViewsDeducted, true)} paid impressions removed
          </p>
        </div>

        <div>
          <p className="text-[0.62rem] uppercase text-muted-foreground">
            Videos
          </p>
          <p className="mt-1 text-sm text-foreground">
            {formatMetricValue(creator.videoCount)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {creator.exactPaidVideoCount} exact
          </p>
        </div>

        <div className="flex items-center gap-2 md:justify-end">
          <span className="inline-flex min-h-9 items-center gap-1.5 rounded-[0.85rem] border border-[#7BB2FF]/20 bg-[#7BB2FF]/10 px-3 text-xs text-[#D6E7FF]">
            <DashboardIcon className="h-3.5 w-3.5" name="settings" />
            Deal
          </span>
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-[0.85rem] border border-white/[0.1] bg-white/[0.05] transition group-open:border-white/[0.16] group-open:bg-white/[0.08]">
            <DashboardIcon
              className="h-4 w-4 text-foreground transition group-open:rotate-90"
              name="chevronRight"
            />
          </span>
        </div>
      </summary>

      <div className="border-t border-white/[0.06] px-4 py-4">
        <CreatorDealEditor
          clearCreatorDealAction={clearCreatorDealAction}
          creator={creator}
          saveCreatorDealAction={saveCreatorDealAction}
        />

        <div className="mt-3 flex flex-wrap gap-2 text-[0.62rem] uppercase">
          <span className="rounded-full border border-white/[0.08] bg-white/[0.05] px-2.5 py-1 text-muted-foreground">
            {formatDealLabel(creator)}
          </span>
          <span className="rounded-full border border-white/[0.08] bg-white/[0.05] px-2.5 py-1 text-muted-foreground">
            {formatMoney(creator.videoPay, creator.currency)} video pay
          </span>
          <span className="rounded-full border border-white/[0.08] bg-white/[0.05] px-2.5 py-1 text-muted-foreground">
            {formatMetricValue(creator.grossViews, true)} gross views
          </span>
          {creator.unknownPaidVideoCount > 0 ? (
            <span className="rounded-full border border-[#FFD24D]/20 bg-[#FFD24D]/10 px-2.5 py-1 text-[#FFE7A6]">
              {creator.unknownPaidVideoCount} unknown paid
            </span>
          ) : null}
          {creator.videoDealOverrideCount > 0 ? (
            <span className="rounded-full border border-[#90FF4D]/20 bg-[#90FF4D]/10 px-2.5 py-1 text-[#D4FFB2]">
              {creator.videoDealOverrideCount} edited video
              {creator.videoDealOverrideCount === 1 ? "" : "s"}
            </span>
          ) : null}
        </div>

        {creator.videos.length > 0 ? (
          <div className="mt-4 overflow-x-auto rounded-[1rem] border border-white/[0.08] bg-black/[0.16]">
            <table className="w-full min-w-[980px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-white/[0.08] text-[0.62rem] uppercase text-muted-foreground">
                  <th className="px-3 py-3 font-medium">Video</th>
                  <th className="px-3 py-3 font-medium">Gross</th>
                  <th className="px-3 py-3 font-medium">Paid Impressions</th>
                  <th className="px-3 py-3 font-medium">Payable</th>
                  <th className="px-3 py-3 font-medium">Fixed</th>
                  <th className="px-3 py-3 font-medium">CPM</th>
                  <th className="px-3 py-3 font-medium">Pay</th>
                  <th className="px-3 py-3 font-medium">Deal</th>
                  <th className="px-3 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {creator.videos.map((video) => (
                  <VideoTableRow
                    clearVideoDealAction={clearVideoDealAction}
                    key={`${video.sourceVideoId}-${video.campaignCreatorId}`}
                    saveVideoDealAction={saveVideoDealAction}
                    video={video}
                  />
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </details>
  );
}

function VideoTableRow({
  clearVideoDealAction,
  saveVideoDealAction,
  video,
}: {
  clearVideoDealAction: DealAction;
  saveVideoDealAction: DealAction;
  video: UgcPayVideoRow;
}) {
  return (
    <tr className="border-b border-white/[0.05] align-top last:border-b-0">
      <td className="max-w-[24rem] px-3 py-3">
        <div className="flex min-w-0 items-center gap-2">
          {video.hasVideoDealOverride ? (
            <span
              className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-[#90FF4D]/20 bg-[#90FF4D]/10 text-[#D4FFB2]"
              title="Video deal override"
            >
              <DashboardIcon className="h-3 w-3" name="settings" />
            </span>
          ) : null}
          <a
            className="block truncate font-medium text-foreground transition hover:text-[#B9FF95]"
            href={video.videoUrl}
            rel="noreferrer"
            target="_blank"
            title={getVideoTitle(video)}
          >
            {getVideoTitle(video)}
          </a>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {formatDateLabel(video.publishedAt ?? video.createdAt)}
        </p>
      </td>
      <td className="px-3 py-3 text-foreground">
        {formatMetricValue(video.grossViews, true)}
      </td>
      <td className="px-3 py-3 text-muted-foreground">
        {formatMetricValue(video.paidViewsDeducted, true)}
      </td>
      <td className="px-3 py-3 text-muted-foreground">
        {formatPayableViewsWithGross(video)}
      </td>
      <td className="px-3 py-3 text-muted-foreground">
        {formatMoney(video.fixedFeePerVideo, video.currency)}
      </td>
      <td className="px-3 py-3 text-muted-foreground">
        {formatMoney(video.cpmAmount, video.currency)}
      </td>
      <td className="px-3 py-3 font-semibold text-foreground">
        {formatMoney(video.videoPay, video.currency)}
      </td>
      <td className="px-3 py-3">
        <VideoDealEditor
          clearVideoDealAction={clearVideoDealAction}
          saveVideoDealAction={saveVideoDealAction}
          video={video}
        />
      </td>
      <td className="px-3 py-3">
        <span
          className={`rounded-full border px-2 py-1 text-[0.62rem] uppercase ${
            video.paidStatus === "yes" || video.paidStatus === "no"
              ? "border-white/[0.08] bg-white/[0.05] text-muted-foreground"
              : "border-[#FFD24D]/20 bg-[#FFD24D]/10 text-[#FFE7A6]"
          }`}
        >
          {getPaidStatusLabel(video)}
        </span>
      </td>
    </tr>
  );
}

async function UgcPayPageReport({
  organizationSlug,
  resolvedSearchParams,
}: {
  organizationSlug: string;
  resolvedSearchParams: DashboardSearchParams;
}) {
  const data = await getOrganizationUgcPayData({
    organizationSlug,
    searchParams: resolvedSearchParams,
  });
  const notice = getNoticeLabel(getSearchParamValue(resolvedSearchParams, "notice"));
  const error = getErrorLabel(getSearchParamValue(resolvedSearchParams, "error"));
  const isGainedViewMode = data.payMode === "gained";
  const isGlobalViewWindowMode = data.viewWindowMode === "first-days";
  const isAccurateCreatorFetchMode = data.videoFetchMode === "per-creator";
  const rangeDetail = isGainedViewMode
    ? `${data.reportTimeZone} report dates. Paying views gained in range for videos posted since ${formatDateLabel(data.videoWindowStartDate)}. Fixed per-video fees only count for videos posted in range.`
    : `${data.reportTimeZone} report dates. Videos posted in range; views use this View Tally period.`;
  const viewWindowDetail = isGlobalViewWindowMode
    ? `Payable views are clipped to the first ${formatMetricValue(data.globalViewWindowDays)} days after each video was posted.`
    : "Payable views use the full selected View Tally period.";
  const videoFetchDetail = isGainedViewMode
    ? isAccurateCreatorFetchMode
      ? "Using account-scoped creator queries for more complete gained-view rows."
      : "Using the fast global top-100 View Tally video feed."
    : null;
  const emptyCreatorLabel = isGainedViewMode
    ? "No View Tally videos gained views in the selected range for matched creators in this campaign."
    : "No View Tally videos matched creators in this campaign for the selected range.";

  async function saveCreatorDealAction(formData: FormData) {
    "use server";

    try {
      const createNewDealPeriod = formData.get("createNewDealPeriod") === "on";

      await upsertCampaignCreatorDealForOrganization({
        organizationSlug,
        input: {
          campaignCreatorId: getTrimmedFormValue(formData, "campaignCreatorId"),
          dealId: createNewDealPeriod
            ? undefined
            : getTrimmedFormValue(formData, "dealId") || undefined,
          currency: getTrimmedFormValue(formData, "currency") || "USD",
          effectiveStartDate: getTrimmedFormValue(formData, "effectiveStartDate"),
          effectiveEndDate:
            getTrimmedFormValue(formData, "effectiveEndDate") || undefined,
          fixedFee: getTrimmedFormValue(formData, "fixedFee") || undefined,
          fixedFeeRecognitionDate:
            getTrimmedFormValue(formData, "fixedFeeRecognitionDate") || undefined,
          fixedFeePerVideo:
            getTrimmedFormValue(formData, "fixedFeePerVideo") || undefined,
          cpmAmount: getTrimmedFormValue(formData, "cpmAmount") || undefined,
          paidTrafficMetric:
            getTrimmedFormValue(formData, "paidTrafficMetric") || undefined,
          deductPaidTraffic: formData.get("deductPaidTraffic") === "on",
          viewCapPerVideo:
            getTrimmedFormValue(formData, "viewCapPerVideo") || undefined,
          viewWindowDays:
            getTrimmedFormValue(formData, "viewWindowDays") || undefined,
          payoutCapPerVideo:
            getTrimmedFormValue(formData, "payoutCapPerVideo") || undefined,
          perVideoCapScope:
            getTrimmedFormValue(formData, "perVideoCapScope") || undefined,
          payoutCapTotal:
            getTrimmedFormValue(formData, "payoutCapTotal") || undefined,
          notes: getTrimmedFormValue(formData, "notes") || undefined,
        },
      });

      redirect(
        buildUgcPayHref({
          organizationSlug,
          searchParams: resolvedSearchParams,
          notice: "creator-deal-saved",
        }),
      );
    } catch (saveError) {
      redirect(
        buildUgcPayHref({
          organizationSlug,
          searchParams: resolvedSearchParams,
          error: getActionErrorMessage(saveError),
        }),
      );
    }
  }

  async function clearCreatorDealAction(formData: FormData) {
    "use server";

    try {
      await deleteCampaignCreatorDealForOrganization({
        organizationSlug,
        input: {
          campaignCreatorId: getTrimmedFormValue(formData, "campaignCreatorId"),
          dealId: getTrimmedFormValue(formData, "dealId") || undefined,
        },
      });

      redirect(
        buildUgcPayHref({
          organizationSlug,
          searchParams: resolvedSearchParams,
          notice: "creator-deal-cleared",
        }),
      );
    } catch (deleteError) {
      redirect(
        buildUgcPayHref({
          organizationSlug,
          searchParams: resolvedSearchParams,
          error: getActionErrorMessage(deleteError),
        }),
      );
    }
  }

  async function saveVideoDealAction(formData: FormData) {
    "use server";

    try {
      await upsertCampaignCreatorVideoDealForOrganization({
        organizationSlug,
        input: {
          campaignCreatorId: getTrimmedFormValue(formData, "campaignCreatorId"),
          sourceVideoId: getTrimmedFormValue(formData, "sourceVideoId"),
          fixedFeePerVideo:
            getTrimmedFormValue(formData, "fixedFeePerVideo") || undefined,
          cpmAmount: getTrimmedFormValue(formData, "cpmAmount") || undefined,
          paidTrafficMetric:
            getTrimmedFormValue(formData, "paidTrafficMetric") || undefined,
          deductPaidTraffic: formData.get("deductPaidTraffic") === "on",
          viewCapPerVideo:
            getTrimmedFormValue(formData, "viewCapPerVideo") || undefined,
          payoutCapPerVideo:
            getTrimmedFormValue(formData, "payoutCapPerVideo") || undefined,
          perVideoCapScope:
            getTrimmedFormValue(formData, "perVideoCapScope") || undefined,
          notes: getTrimmedFormValue(formData, "notes") || undefined,
        },
      });

      redirect(
        buildUgcPayHref({
          organizationSlug,
          searchParams: resolvedSearchParams,
          notice: "video-deal-saved",
        }),
      );
    } catch (saveError) {
      redirect(
        buildUgcPayHref({
          organizationSlug,
          searchParams: resolvedSearchParams,
          error: getActionErrorMessage(saveError),
        }),
      );
    }
  }

  async function clearVideoDealAction(formData: FormData) {
    "use server";

    try {
      await deleteCampaignCreatorVideoDealForOrganization({
        organizationSlug,
        input: {
          campaignCreatorId: getTrimmedFormValue(formData, "campaignCreatorId"),
          sourceVideoId: getTrimmedFormValue(formData, "sourceVideoId"),
        },
      });

      redirect(
        buildUgcPayHref({
          organizationSlug,
          searchParams: resolvedSearchParams,
          notice: "video-deal-cleared",
        }),
      );
    } catch (deleteError) {
      redirect(
        buildUgcPayHref({
          organizationSlug,
          searchParams: resolvedSearchParams,
          error: getActionErrorMessage(deleteError),
        }),
      );
    }
  }

  return (
    <div className="space-y-4">
      <section className="rounded-[1.55rem] border border-white/[0.08] bg-white/[0.03] p-5 shadow-[0_24px_70px_rgba(0,0,0,0.2)] backdrop-blur">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-xs uppercase text-muted-foreground">
              UGC Pay
            </p>
            <h1 className="mt-2 text-xl font-semibold tracking-normal text-foreground">
              Creator pay from View Tally.
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {data.selectedCampaignLabel ?? "No campaign selected"}
            </p>
          </div>

          <div className="rounded-[1.1rem] border border-white/[0.08] bg-black/[0.2] px-4 py-3 text-sm text-muted-foreground">
            <p className="text-[0.62rem] uppercase text-muted-foreground">
              Selected range
            </p>
            <p className="mt-2 text-foreground">
              {formatDateLabel(data.startDate)} to {formatDateLabel(data.endDate)}
            </p>
            <p className="mt-1 text-xs">{rangeDetail}</p>
            <p className="mt-1 text-xs">{viewWindowDetail}</p>
            {videoFetchDetail ? (
              <p className="mt-1 text-xs">{videoFetchDetail}</p>
            ) : null}
            <p className="mt-1 text-xs">
              {getPayModeLabel(data.payMode)} - {getViewWindowModeLabel(data.viewWindowMode, data.globalViewWindowDays)} - {getVideoFetchModeLabel(data.videoFetchMode)} - {formatMetricValue(data.summary.customDeals)} custom deals - {formatMetricValue(data.summary.videoDealOverrides)} video overrides
            </p>
          </div>
        </div>

        <form
          className="mt-5 space-y-3"
          method="get"
        >
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.25fr)_auto]">
            <label className="block">
              <TooltipLabel
                label="Start date"
                tip="First UTC report date included. In posted mode, videos must be posted on or after this date. In gained views mode, this starts the view-growth period."
              />
              <input
                className="w-full rounded-[0.95rem] border border-white/[0.08] bg-black/[0.18] px-3 py-2.5 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-white/[0.16]"
                defaultValue={data.startDate}
                name="startDate"
                type="date"
              />
            </label>

            <label className="block">
              <TooltipLabel
                label="End date"
                tip="Last UTC report date included for View Tally views and TikTok paid-delivery deductions."
              />
              <input
                className="w-full rounded-[0.95rem] border border-white/[0.08] bg-black/[0.18] px-3 py-2.5 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-white/[0.16]"
                defaultValue={data.endDate}
                name="endDate"
                type="date"
              />
            </label>

            <label className="block">
              <TooltipLabel
                label="Campaign"
                tip="Filters creator matching and deal terms to one campaign. All Tracked Creators uses every campaign creator available to the report."
              />
              <select
                className="w-full rounded-[0.95rem] border border-white/[0.08] bg-black/[0.18] px-3 py-2.5 text-sm text-foreground outline-none transition focus:border-white/[0.16]"
                defaultValue={data.selectedCampaignId ?? ""}
                disabled={data.campaignOptions.length === 0}
                name="campaign"
              >
                {data.campaignOptions.length === 0 ? (
                  <option value="">No campaigns</option>
                ) : null}
                {data.campaignOptions.map((campaign) => (
                  <option key={campaign.id} value={campaign.id}>
                    {campaign.label}
                  </option>
                ))}
              </select>
            </label>

            <div className="flex flex-col items-stretch justify-end gap-2 sm:flex-row lg:flex-col">
              <button
                className="inline-flex w-full items-center justify-center gap-2 rounded-[0.95rem] border border-white/[0.1] bg-white/[0.06] px-4 py-2.5 text-sm text-foreground transition hover:border-white/[0.16] hover:bg-white/[0.1]"
                type="submit"
              >
                <DashboardIcon className="h-4 w-4" name="refresh" />
                Apply
              </button>
              {isGainedViewMode ? (
                <button
                  className="inline-flex w-full items-center justify-center gap-2 rounded-[0.95rem] border border-[#8BE0C2]/25 bg-[#8BE0C2]/[0.08] px-4 py-2.5 text-sm text-[#CFFFF0] transition hover:border-[#8BE0C2]/40 hover:bg-[#8BE0C2]/[0.12]"
                  name="videoFetchMode"
                  type="submit"
                  value="per-creator"
                >
                  <DashboardIcon className="h-4 w-4" name="creators" />
                  Query creators
                </button>
              ) : null}
            </div>
          </div>

          <div className="grid gap-3 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
            <fieldset>
              <legend>
                <TooltipLabel
                  label="Calculation"
                  tip="Chooses which videos and views become eligible before creator deal terms, paid-view deductions, and caps are applied."
                />
              </legend>
              <div className="grid grid-cols-2 gap-1 rounded-[0.95rem] border border-white/[0.08] bg-black/[0.18] p-1">
                <label className="block">
                  <input
                    className="peer sr-only"
                    defaultChecked={data.payMode === "posted"}
                    name="payMode"
                    type="radio"
                    value="posted"
                  />
                  <OptionTip tip="Pays videos posted between the start and end dates. Views come from the selected view window.">
                    Posted in range
                  </OptionTip>
                </label>
                <label className="block">
                  <input
                    className="peer sr-only"
                    defaultChecked={isGainedViewMode}
                    name="payMode"
                    type="radio"
                    value="gained"
                  />
                  <OptionTip tip="Pays only views gained during the selected date range for matched videos from the video-window start onward.">
                    Gained views
                  </OptionTip>
                </label>
              </div>
            </fieldset>

            {isGainedViewMode ? (
              <label className="block">
                <TooltipLabel
                  label="Video window start"
                  tip="Earliest video post date included in gained-view mode. Use this to include older videos while only paying the views gained in the report range."
                />
                <input
                  className="w-full rounded-[0.95rem] border border-white/[0.08] bg-black/[0.18] px-3 py-2.5 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-white/[0.16]"
                  defaultValue={data.videoWindowStartDate}
                  name="videoWindowStartDate"
                  type="date"
                />
              </label>
            ) : null}
          </div>

          <div className="grid gap-3 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
            <fieldset>
              <legend>
                <TooltipLabel
                  label="View window"
                  tip="Controls which View Tally views count for each included video before paid traffic deductions and creator deal caps."
                />
              </legend>
              <div className="grid grid-cols-2 gap-1 rounded-[0.95rem] border border-white/[0.08] bg-black/[0.18] p-1">
                <label className="block">
                  <input
                    className="peer sr-only"
                    defaultChecked={data.viewWindowMode === "all"}
                    name="viewWindowMode"
                    type="radio"
                    value="all"
                  />
                  <OptionTip tip="Uses all views View Tally reports for the selected report period.">
                    All report views
                  </OptionTip>
                </label>
                <label className="block">
                  <input
                    className="peer sr-only"
                    defaultChecked={isGlobalViewWindowMode}
                    name="viewWindowMode"
                    type="radio"
                    value="first-days"
                  />
                  <OptionTip tip="Limits payable views to the first N days after each video's post date. Set N with Window days.">
                    First days
                  </OptionTip>
                </label>
              </div>
            </fieldset>

            <label className="block">
              <TooltipLabel
                label="Window days"
                tip="Number of days after each video's post date to count when First days is selected. This value is ignored by All report views."
              />
              <input
                className="w-full rounded-[0.95rem] border border-white/[0.08] bg-black/[0.18] px-3 py-2.5 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-white/[0.16]"
                defaultValue={data.globalViewWindowDays}
                min={1}
                max={365}
                name="globalViewWindowDays"
                type="number"
              />
            </label>
          </div>
        </form>
      </section>

      {notice ? (
        <section className="rounded-[1.1rem] border border-[#90FF4D]/20 bg-[#90FF4D]/[0.08] px-4 py-3 text-sm text-[#D7FFBC]">
          {notice}
        </section>
      ) : null}

      {error ? (
        <section className="rounded-[1.1rem] border border-[#FF7E54]/20 bg-[#FF7E54]/[0.08] px-4 py-3 text-sm text-[#FFD3C5]">
          {error}
        </section>
      ) : null}

      {data.errorMessage ? (
        <section className="rounded-[1.1rem] border border-[#FF7E54]/20 bg-[#FF7E54]/[0.08] px-4 py-3 text-sm text-[#FFD3C5]">
          {data.errorMessage}
        </section>
      ) : null}

      {data.warnings.length > 0 ? (
        <section className="rounded-[1.1rem] border border-[#FFD24D]/20 bg-[#FFD24D]/[0.08] px-4 py-3 text-sm leading-6 text-[#FFEAB1]">
          <span className="font-medium">Report warnings:</span>{" "}
          {data.warnings.slice(0, 4).join(" ")}
          {data.warnings.length > 4 ? ` +${data.warnings.length - 4} more` : ""}
        </section>
      ) : null}

      <UgcPayClient
        creators={data.creators}
        emptyCreatorLabel={emptyCreatorLabel}
        endDate={data.endDate}
        organizationSlug={organizationSlug}
        payMode={data.payMode}
        selectedCampaignId={data.selectedCampaignId}
        startDate={data.startDate}
        summary={data.summary}
      />
    </div>
  );
}

export default async function UgcPayPage({
  params,
  searchParams,
}: UgcPayPageProps) {
  const { organizationSlug } = await params;
  const resolvedSearchParams = await searchParams;

  return (
    <Suspense fallback={<UgcPayLoading />}>
      <UgcPayPageReport
        organizationSlug={organizationSlug}
        resolvedSearchParams={resolvedSearchParams}
      />
    </Suspense>
  );
}
