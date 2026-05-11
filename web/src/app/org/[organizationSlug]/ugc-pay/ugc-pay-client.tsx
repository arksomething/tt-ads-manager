"use client";

import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";

import { DashboardIcon } from "@/components/org-dashboard/org-icons";
import {
  CreatorDealPaidTrafficMetric,
  CreatorDealPerVideoCapScope,
} from "@/lib/prisma-shim";
import {
  getUgcPaySummaryFromCreators,
  getVideoDealOverrideFromForm,
  recalculateCreatorWithVideoDeal,
} from "@/lib/ugc-pay-local-recalculation";
import {
  type UgcPayCreatorRow,
  type UgcPayMode,
  type UgcPayVideoRow,
} from "@/server/ugc-pay/queries";

import {
  clearCreatorDeal,
  clearVideoDeal,
  saveCreatorDeal,
  saveVideoDeal,
} from "./actions";

type UgcPaySummary = {
  totalPay: number;
  fixedPay: number;
  videoFixedPay: number;
  cpmPay: number;
  videoPay: number;
  grossViews: number;
  paidViewsDeducted: number;
  payableViews: number;
  creators: number;
  videos: number;
  customDeals: number;
  exactPaidVideos: number;
  unknownPaidVideos: number;
  unmatchedVideos: number;
  videoDealOverrides: number;
};

type UgcPayClientProps = {
  creators: UgcPayCreatorRow[];
  emptyCreatorLabel: string;
  organizationSlug: string;
  payMode: UgcPayMode;
  startDate: string;
  endDate: string;
  summary: UgcPaySummary;
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
  tip,
}: {
  children: ReactNode;
  label: string;
  tip?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-center gap-1.5 text-[0.56rem] uppercase text-muted-foreground">
        {label}
        {tip ? (
          <span
            className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border border-white/[0.12] text-[0.55rem] normal-case text-muted-foreground"
            title={tip}
          >
            ?
          </span>
        ) : null}
      </span>
      {children}
    </label>
  );
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

function formatDealPeriodLabel(deal: UgcPayCreatorRow["deal"]) {
  const start = formatDateInputValue(deal.effectiveStartDate) || "Start";
  const end = formatDateInputValue(deal.effectiveEndDate) || "Open";
  const cpmLabel = `${formatMoney(deal.cpmAmount, deal.currency)} CPM`;
  const fixedLabel =
    deal.fixedFee != null && deal.fixedFee > 0
      ? `${formatMoney(deal.fixedFee, deal.currency)} fixed + `
      : "";
  const fixedPerVideoLabel =
    deal.fixedFeePerVideo != null && deal.fixedFeePerVideo > 0
      ? `${formatMoney(deal.fixedFeePerVideo, deal.currency)}/video + `
      : "";

  return `${start} to ${end}: ${fixedLabel}${fixedPerVideoLabel}${cpmLabel}`;
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

function CreatorDealEditor({
  creator,
  errorMessage,
  isClearing,
  isSaving,
  onClear,
  onSave,
}: {
  creator: UgcPayCreatorRow;
  errorMessage: string | null;
  isClearing: boolean;
  isSaving: boolean;
  onClear: (formData: FormData) => void;
  onSave: (formData: FormData) => void;
}) {
  function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSave(new FormData(event.currentTarget));
  }

  function handleClear(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onClear(new FormData(event.currentTarget));
  }

  return (
    <div className="rounded-[1rem] border border-white/[0.08] bg-black/[0.16] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-[0.62rem] uppercase text-muted-foreground">
            Creator Deal Structure
          </p>
          <p className="mt-1 text-sm text-foreground">
            {creator.hasCustomDeal
              ? `${creator.dealPeriods.length} deal period${creator.dealPeriods.length === 1 ? "" : "s"}`
              : "Default terms"}
          </p>
        </div>
        <form onSubmit={handleClear}>
          <input
            name="campaignCreatorId"
            type="hidden"
            value={creator.campaignCreatorId}
          />
          <input name="dealId" type="hidden" value={creator.deal.id ?? ""} />
          <button
            className="text-xs text-muted-foreground transition hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
            disabled={!creator.hasCustomDeal || isClearing || isSaving}
            type="submit"
          >
            {isClearing ? "Removing..." : "Remove override"}
          </button>
        </form>
      </div>

      <form className="mt-3 space-y-3" onSubmit={handleSave}>
        <input
          name="campaignCreatorId"
          type="hidden"
          value={creator.campaignCreatorId}
        />
        <input name="dealId" type="hidden" value={creator.deal.id ?? ""} />
        {creator.dealPeriods.length > 0 ? (
          <div className="space-y-1.5 rounded-[0.75rem] border border-white/[0.08] bg-black/[0.14] p-2.5">
            {creator.dealPeriods.map((dealPeriod) => (
              <p
                className="text-xs text-muted-foreground"
                key={
                  dealPeriod.id ??
                  `${formatDateInputValue(dealPeriod.effectiveStartDate)}-${formatDateInputValue(dealPeriod.effectiveEndDate) || "open"}`
                }
              >
                {formatDealPeriodLabel(dealPeriod)}
              </p>
            ))}
          </div>
        ) : null}
        <div className="grid gap-2 md:grid-cols-3 xl:grid-cols-6">
          <FieldLabel label="Currency" tip="Currency used for this creator deal period.">
            <input
              className={dealInputClassName}
              defaultValue={creator.currency}
              maxLength={3}
              name="currency"
            />
          </FieldLabel>
          <FieldLabel label="Deal Start" tip="First posted date that can use this deal period. Deal periods cannot overlap.">
            <input
              className={dealInputClassName}
              defaultValue={formatDateInputValue(creator.deal.effectiveStartDate)}
              name="effectiveStartDate"
              type="date"
            />
          </FieldLabel>
          <FieldLabel label="Deal End" tip="Last posted date that can use this deal period. Leave blank for an open-ended period.">
            <input
              className={dealInputClassName}
              defaultValue={formatDateInputValue(creator.deal.effectiveEndDate)}
              name="effectiveEndDate"
              type="date"
            />
          </FieldLabel>
          <FieldLabel label="Base Fixed Fee" tip="One-time creator pay for this deal period. It counts when the fixed fee date is inside the report range.">
            <input
              className={dealInputClassName}
              defaultValue={creator.deal.fixedFee ?? ""}
              name="fixedFee"
              placeholder="0.00"
              step="0.01"
              type="number"
            />
          </FieldLabel>
          <FieldLabel label="Fixed Fee Date" tip="Date used to include the base fixed fee in UGC Pay reports. Blank falls back to the deal start.">
            <input
              className={dealInputClassName}
              defaultValue={formatDateInputValue(
                creator.deal.fixedFeeRecognitionDate,
              )}
              name="fixedFeeRecognitionDate"
              type="date"
            />
          </FieldLabel>
          <FieldLabel label="Fixed / Video" tip="Flat amount added for each payable video using this deal period.">
            <input
              className={dealInputClassName}
              defaultValue={creator.deal.fixedFeePerVideo ?? ""}
              name="fixedFeePerVideo"
              placeholder="0.00"
              step="0.01"
              type="number"
            />
          </FieldLabel>
          <FieldLabel label="CPM" tip="Pay per 1,000 payable organic views after any paid traffic deduction and view cap.">
            <input
              className={dealInputClassName}
              defaultValue={creator.deal.cpmAmount}
              name="cpmAmount"
              placeholder="0.00"
              step="0.01"
              type="number"
            />
          </FieldLabel>
          <FieldLabel label="View Window" tip="Maximum first-day window for payable gained views when first-days mode is selected.">
            <input
              className={dealInputClassName}
              defaultValue={creator.deal.viewWindowDays}
              min="1"
              name="viewWindowDays"
              step="1"
              type="number"
            />
          </FieldLabel>
          <FieldLabel label="Paid Metric" tip="Ad metric used to deduct paid traffic from gross views.">
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
          <FieldLabel label="View Cap / Video" tip="Optional maximum gross/payable views counted per video before payout is calculated.">
            <input
              className={dealInputClassName}
              defaultValue={creator.deal.viewCapPerVideo ?? ""}
              name="viewCapPerVideo"
              placeholder="100000"
              step="1"
              type="number"
            />
          </FieldLabel>
          <FieldLabel label="Payout Cap / Video" tip="Maximum payout used with the selected cap scope for each video.">
            <input
              className={dealInputClassName}
              defaultValue={creator.deal.payoutCapPerVideo}
              name="payoutCapPerVideo"
              placeholder="100.00"
              step="0.01"
              type="number"
            />
          </FieldLabel>
          <FieldLabel label="Cap Scope" tip="Choose whether the per-video payout cap limits CPM pay only, total video pay, or does not apply.">
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
          <FieldLabel label="Total Payout Cap" tip="Optional total cap for this deal period, applied to its fixed and video pay together.">
            <input
              className={dealInputClassName}
              defaultValue={creator.deal.payoutCapTotal ?? ""}
              name="payoutCapTotal"
              placeholder="0.00"
              step="0.01"
              type="number"
            />
          </FieldLabel>
          <FieldLabel label="Notes" tip="Internal deal notes shown with the saved period.">
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
          <span
            className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border border-white/[0.12] text-[0.55rem] text-muted-foreground"
            title="Creates another deal period instead of editing the current one. Use a non-overlapping start/end range."
          >
            ?
          </span>
        </label>
        {errorMessage ? (
          <p className="text-xs text-[#FFD3C5]">{errorMessage}</p>
        ) : null}
        <button
          className="inline-flex min-h-9 items-center justify-center rounded-[0.8rem] border border-[#90FF4D]/20 bg-[#90FF4D]/90 px-3 text-xs font-medium text-black transition hover:bg-[#A4FF68] disabled:cursor-not-allowed disabled:opacity-60"
          disabled={isSaving || isClearing}
          type="submit"
        >
          {isSaving ? "Saving..." : "Save creator deal"}
        </button>
      </form>
    </div>
  );
}

function VideoDealEditor({
  errorMessage,
  isClearing,
  isSaving,
  onClear,
  onSave,
  video,
}: {
  errorMessage: string | null;
  isClearing: boolean;
  isSaving: boolean;
  onClear: (formData: FormData) => void;
  onSave: (formData: FormData) => void;
  video: UgcPayVideoRow;
}) {
  function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSave(new FormData(event.currentTarget));
  }

  function handleClear(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onClear(new FormData(event.currentTarget));
  }

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
        <form className="mt-3 space-y-3" onSubmit={handleSave}>
          <input
            name="campaignCreatorId"
            type="hidden"
            value={video.campaignCreatorId}
          />
          <input name="sourceVideoId" type="hidden" value={video.sourceVideoId} />
          <div className="grid gap-2 sm:grid-cols-2">
            <FieldLabel label="Fixed / Video" tip="Video-specific flat pay. Leave blank to use the creator deal value.">
              <input
                className={dealInputClassName}
                defaultValue={video.fixedFeePerVideo || ""}
                name="fixedFeePerVideo"
                placeholder="0.00"
                step="0.01"
                type="number"
              />
            </FieldLabel>
            <FieldLabel label="CPM" tip="Video-specific CPM. Leave blank to use the creator deal value.">
              <input
                className={dealInputClassName}
                defaultValue={video.cpmAmount}
                name="cpmAmount"
                placeholder="0.00"
                step="0.01"
                type="number"
              />
            </FieldLabel>
            <FieldLabel label="Paid Metric" tip="Video-specific paid traffic metric used for deduction.">
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
            <FieldLabel label="View Cap" tip="Video-specific view cap before payout is calculated.">
              <input
                className={dealInputClassName}
                defaultValue={video.viewCapPerVideo ?? ""}
                name="viewCapPerVideo"
                placeholder="100000"
                step="1"
                type="number"
              />
            </FieldLabel>
            <FieldLabel label="Payout Cap" tip="Video-specific payout cap used with the selected cap scope.">
              <input
                className={dealInputClassName}
                defaultValue={video.payoutCapPerVideo}
                name="payoutCapPerVideo"
                placeholder="100.00"
                step="0.01"
                type="number"
              />
            </FieldLabel>
            <FieldLabel label="Cap Scope" tip="Video-specific per-video cap behavior.">
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
            <FieldLabel label="Notes" tip="Internal note for this video override.">
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
          {errorMessage ? (
            <p className="text-xs text-[#FFD3C5]">{errorMessage}</p>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <button
              className="inline-flex min-h-8 items-center rounded-[0.8rem] border border-[#90FF4D]/20 bg-[#90FF4D]/90 px-3 text-xs font-medium text-black transition hover:bg-[#A4FF68] disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isSaving || isClearing}
              type="submit"
            >
              {isSaving ? "Saving..." : "Save video deal"}
            </button>
          </div>
        </form>
        <form className="mt-2" onSubmit={handleClear}>
          <input
            name="campaignCreatorId"
            type="hidden"
            value={video.campaignCreatorId}
          />
          <input name="sourceVideoId" type="hidden" value={video.sourceVideoId} />
          <button
            className="text-xs text-muted-foreground transition hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
            disabled={!video.hasVideoDealOverride || isSaving || isClearing}
            type="submit"
          >
            {isClearing ? "Removing..." : "Remove video override"}
          </button>
        </form>
      </div>
    </details>
  );
}

function VideoTableRow({
  errorMessage,
  isClearing,
  isSaving,
  onClearVideoDeal,
  onSaveVideoDeal,
  video,
}: {
  errorMessage: string | null;
  isClearing: boolean;
  isSaving: boolean;
  onClearVideoDeal: (video: UgcPayVideoRow, formData: FormData) => void;
  onSaveVideoDeal: (video: UgcPayVideoRow, formData: FormData) => void;
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
          errorMessage={errorMessage}
          isClearing={isClearing}
          isSaving={isSaving}
          onClear={(formData) => onClearVideoDeal(video, formData)}
          onSave={(formData) => onSaveVideoDeal(video, formData)}
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

function CreatorPayRow({
  actionError,
  isCreatorClearing,
  isCreatorSaving,
  pendingVideoKey,
  creator,
  onClearCreatorDeal,
  onClearVideoDeal,
  onSaveCreatorDeal,
  onSaveVideoDeal,
}: {
  actionError: { key: string; message: string } | null;
  isCreatorClearing: boolean;
  isCreatorSaving: boolean;
  pendingVideoKey: string | null;
  creator: UgcPayCreatorRow;
  onClearCreatorDeal: (creator: UgcPayCreatorRow, formData: FormData) => void;
  onClearVideoDeal: (video: UgcPayVideoRow, formData: FormData) => void;
  onSaveCreatorDeal: (creator: UgcPayCreatorRow, formData: FormData) => void;
  onSaveVideoDeal: (video: UgcPayVideoRow, formData: FormData) => void;
}) {
  const creatorError =
    actionError?.key === `creator:${creator.campaignCreatorId}`
      ? actionError.message
      : null;

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
          creator={creator}
          errorMessage={creatorError}
          isClearing={isCreatorClearing}
          isSaving={isCreatorSaving}
          onClear={(formData) => onClearCreatorDeal(creator, formData)}
          onSave={(formData) => onSaveCreatorDeal(creator, formData)}
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
                {creator.videos.map((video) => {
                  const videoKey = `${video.campaignCreatorId}:${video.sourceVideoId}`;
                  const videoError =
                    actionError?.key === `video:${videoKey}`
                      ? actionError.message
                      : null;

                  return (
                    <VideoTableRow
                      errorMessage={videoError}
                      isClearing={pendingVideoKey === `clear:${videoKey}`}
                      isSaving={pendingVideoKey === `save:${videoKey}`}
                      key={`${video.sourceVideoId}-${video.campaignCreatorId}`}
                      onClearVideoDeal={onClearVideoDeal}
                      onSaveVideoDeal={onSaveVideoDeal}
                      video={video}
                    />
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </details>
  );
}

export function UgcPayClient({
  creators: initialCreators,
  emptyCreatorLabel,
  endDate,
  organizationSlug,
  payMode,
  startDate,
  summary: initialSummary,
}: UgcPayClientProps) {
  const router = useRouter();
  const [creators, setCreators] = useState(initialCreators);
  const [pendingCreatorKey, setPendingCreatorKey] = useState<string | null>(null);
  const [pendingVideoKey, setPendingVideoKey] = useState<string | null>(null);
  const [actionError, setActionError] = useState<{
    key: string;
    message: string;
  } | null>(null);
  const recalculateOptions = useMemo(
    () => ({
      startDate,
      endDate,
      payMode,
    }),
    [endDate, payMode, startDate],
  );
  useEffect(() => {
    setCreators(initialCreators);
  }, [initialCreators]);

  const summary = useMemo(
    () =>
      getUgcPaySummaryFromCreators({
        creators,
        unmatchedVideos: initialSummary.unmatchedVideos,
      }),
    [creators, initialSummary.unmatchedVideos],
  );
  const videos = useMemo(
    () =>
      creators
        .flatMap((creator) => creator.videos)
        .sort(
          (left, right) =>
            right.videoPay - left.videoPay ||
            right.grossViews - left.grossViews ||
            left.creatorName.localeCompare(right.creatorName),
        ),
    [creators],
  );

  async function handleSaveCreatorDeal(
    creator: UgcPayCreatorRow,
    formData: FormData,
  ) {
    const pendingKey = `save:${creator.campaignCreatorId}`;
    setActionError(null);
    setPendingCreatorKey(pendingKey);

    const result = await saveCreatorDeal(organizationSlug, formData);
    setPendingCreatorKey(null);

    if (!result.ok) {
      setActionError({
        key: `creator:${creator.campaignCreatorId}`,
        message: result.error,
      });
      return;
    }

    router.refresh();
  }

  async function handleClearCreatorDeal(
    creator: UgcPayCreatorRow,
    formData: FormData,
  ) {
    const pendingKey = `clear:${creator.campaignCreatorId}`;
    setActionError(null);
    setPendingCreatorKey(pendingKey);

    const result = await clearCreatorDeal(organizationSlug, formData);
    setPendingCreatorKey(null);

    if (!result.ok) {
      setActionError({
        key: `creator:${creator.campaignCreatorId}`,
        message: result.error,
      });
      return;
    }

    router.refresh();
  }

  async function handleSaveVideoDeal(video: UgcPayVideoRow, formData: FormData) {
    const nextVideoDeal = getVideoDealOverrideFromForm(video, formData);
    const videoKey = `${video.campaignCreatorId}:${video.sourceVideoId}`;
    setActionError(null);
    setPendingVideoKey(`save:${videoKey}`);

    const result = await saveVideoDeal(organizationSlug, formData);
    setPendingVideoKey(null);

    if (!result.ok) {
      setActionError({
        key: `video:${videoKey}`,
        message: result.error,
      });
      return;
    }

    setCreators((currentCreators) =>
      currentCreators.map((creator) =>
        creator.campaignCreatorId === video.campaignCreatorId
          ? (recalculateCreatorWithVideoDeal({
              creator,
              sourceVideoId: video.sourceVideoId,
              videoOverride: nextVideoDeal,
              options: recalculateOptions,
            }) as UgcPayCreatorRow)
          : creator,
      ),
    );
  }

  async function handleClearVideoDeal(video: UgcPayVideoRow, formData: FormData) {
    const videoKey = `${video.campaignCreatorId}:${video.sourceVideoId}`;
    setActionError(null);
    setPendingVideoKey(`clear:${videoKey}`);

    const result = await clearVideoDeal(organizationSlug, formData);
    setPendingVideoKey(null);

    if (!result.ok) {
      setActionError({
        key: `video:${videoKey}`,
        message: result.error,
      });
      return;
    }

    setCreators((currentCreators) =>
      currentCreators.map((creator) =>
        creator.campaignCreatorId === video.campaignCreatorId
          ? (recalculateCreatorWithVideoDeal({
              creator,
              sourceVideoId: video.sourceVideoId,
              videoOverride: null,
              options: recalculateOptions,
            }) as UgcPayCreatorRow)
          : creator,
      ),
    );
  }

  return (
    <>
      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <SummaryCard
          detail={`${formatMoney(summary.fixedPay)} fixed + ${formatMoney(summary.videoPay)} video`}
          iconName="payouts"
          label="UGC Pay"
          value={formatMoney(summary.totalPay)}
        />
        <SummaryCard
          detail={`${formatMetricValue(summary.grossViews, true)} gross less ${formatMetricValue(summary.paidViewsDeducted, true)} paid impressions`}
          iconName="overview"
          label="Payable Views"
          value={formatPayableViewsWithGross(summary)}
        />
        <SummaryCard
          detail={`${formatMetricValue(summary.creators)} creators matched`}
          iconName="videos"
          label="Videos"
          value={formatMetricValue(summary.videos)}
        />
        <SummaryCard
          detail={`${formatMetricValue(summary.unknownPaidVideos)} unknown, ${formatMetricValue(summary.unmatchedVideos)} unmatched`}
          iconName="creators"
          label="Paid Checks"
          value={formatMetricValue(summary.exactPaidVideos)}
        />
      </section>

      <section className="rounded-[1.55rem] border border-white/[0.08] bg-white/[0.03] p-5 shadow-[0_24px_70px_rgba(0,0,0,0.2)] backdrop-blur">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs uppercase text-muted-foreground">
              Creators
            </p>
            <h2 className="mt-2 text-lg font-semibold tracking-normal text-foreground">
              Pay by creator
            </h2>
          </div>
          <p className="text-sm text-muted-foreground">
            {formatMetricValue(summary.videos)} video rows
          </p>
        </div>

        <div className="mt-5 overflow-hidden rounded-[1.2rem] border border-white/[0.08] bg-black/[0.18]">
          {creators.length > 0 ? (
            creators.map((creator) => (
              <CreatorPayRow
                actionError={actionError}
                creator={creator}
                isCreatorClearing={
                  pendingCreatorKey === `clear:${creator.campaignCreatorId}`
                }
                isCreatorSaving={
                  pendingCreatorKey === `save:${creator.campaignCreatorId}`
                }
                key={creator.campaignCreatorId}
                onClearCreatorDeal={handleClearCreatorDeal}
                onClearVideoDeal={handleClearVideoDeal}
                onSaveCreatorDeal={handleSaveCreatorDeal}
                onSaveVideoDeal={handleSaveVideoDeal}
                pendingVideoKey={pendingVideoKey}
              />
            ))
          ) : (
            <div className="px-4 py-10 text-sm text-muted-foreground">
              {emptyCreatorLabel}
            </div>
          )}
        </div>
      </section>

      <section className="rounded-[1.55rem] border border-white/[0.08] bg-white/[0.03] p-5 shadow-[0_24px_70px_rgba(0,0,0,0.2)] backdrop-blur">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs uppercase text-muted-foreground">
              Videos
            </p>
            <h2 className="mt-2 text-lg font-semibold tracking-normal text-foreground">
              Video pay breakdown
            </h2>
          </div>
          <p className="text-sm text-muted-foreground">
            {formatMoney(summary.videoPay)} total video pay
          </p>
        </div>

        {videos.length > 0 ? (
          <div className="mt-5 overflow-x-auto rounded-[1.2rem] border border-white/[0.08] bg-black/[0.18]">
            <table className="w-full min-w-[980px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-white/[0.08] text-[0.62rem] uppercase text-muted-foreground">
                  <th className="px-3 py-3 font-medium">Video</th>
                  <th className="px-3 py-3 font-medium">Creator</th>
                  <th className="px-3 py-3 font-medium">Gross</th>
                  <th className="px-3 py-3 font-medium">Paid Impressions</th>
                  <th className="px-3 py-3 font-medium">Payable</th>
                  <th className="px-3 py-3 font-medium">Fixed</th>
                  <th className="px-3 py-3 font-medium">CPM Pay</th>
                  <th className="px-3 py-3 font-medium">Pay</th>
                  <th className="px-3 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {videos.map((video) => (
                  <tr
                    className="border-b border-white/[0.05] align-top last:border-b-0"
                    key={`${video.sourceVideoId}-${video.campaignCreatorId}`}
                  >
                    <td className="max-w-[24rem] px-3 py-3">
                      <a
                        className="block truncate font-medium text-foreground transition hover:text-[#B9FF95]"
                        href={video.videoUrl}
                        rel="noreferrer"
                        target="_blank"
                        title={getVideoTitle(video)}
                      >
                        <span className="inline-flex min-w-0 items-center gap-2">
                          {video.hasVideoDealOverride ? (
                            <span
                              className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-[#90FF4D]/20 bg-[#90FF4D]/10 text-[#D4FFB2]"
                              title="Video deal override"
                            >
                              <DashboardIcon className="h-3 w-3" name="settings" />
                            </span>
                          ) : null}
                          <span className="truncate">{getVideoTitle(video)}</span>
                        </span>
                      </a>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {formatDateLabel(video.publishedAt ?? video.createdAt)}
                      </p>
                    </td>
                    <td className="px-3 py-3 text-muted-foreground">
                      {video.creatorName}
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
                      {formatMoney(video.cpmPay, video.currency)}
                    </td>
                    <td className="px-3 py-3 font-semibold text-foreground">
                      {formatMoney(video.videoPay, video.currency)}
                    </td>
                    <td className="px-3 py-3 text-muted-foreground">
                      {getPaidStatusLabel(video)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="mt-5">
            <EmptyState label="No video pay rows for the selected campaign and date range." />
          </div>
        )}
      </section>
    </>
  );
}
