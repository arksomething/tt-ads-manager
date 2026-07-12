"use client";

import {
  Fragment,
  useMemo,
  useState,
  useTransition,
  type FormEvent,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";

import {
  type CreatorPortalFeedSort,
  sortCreatorPortalFeedVideos,
} from "@/lib/creator-portal-feed";
import {
  CreatorDealPaidTrafficMetric,
  CreatorDealPerVideoCapScope,
} from "@/lib/prisma-shim";
import type { UgcPayVideoRow } from "@/server/ugc-pay/queries";

import {
  saveCreatorPortalCreatorDeal,
  saveCreatorPortalVideoDeal,
} from "./actions";

type CreatorLedgerVideo = Omit<UgcPayVideoRow, "createdAt" | "publishedAt"> & {
  createdAt: string;
  publishedAt: string | null;
};

type CreatorLedgerEditableCreator = {
  campaignCreatorId: string;
  currency: string;
  deal: {
    id: string | null;
    currency: string;
    effectiveStartDate: string;
    effectiveEndDate: string | null;
    fixedFee: number | null;
    fixedFeeRecognitionDate: string | null;
    fixedFeePerVideo: number | null;
    cpmAmount: number;
    paidTrafficMetric: CreatorDealPaidTrafficMetric;
    deductPaidTraffic: boolean;
    viewCapPerVideo: number | null;
    viewWindowDays: number;
    payoutCapPerVideo: number;
    perVideoCapScope: CreatorDealPerVideoCapScope;
    payoutCapTotal: number | null;
    notes: string | null;
  };
  hasCustomDeal: boolean;
};

type CreatorLedgerClientProps = {
  canEditDeals: boolean;
  creator: CreatorLedgerEditableCreator | null;
  initialSort: CreatorPortalFeedSort;
  videos: CreatorLedgerVideo[];
};

const numberFormatter = new Intl.NumberFormat("en-US");
const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});
const currencyFormatters = new Map<string, Intl.NumberFormat>();

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

function formatOptionalNumber(value: number | null) {
  return value == null ? "none" : formatNumber(value);
}

function formatDate(value: string | null) {
  if (!value) {
    return "Unposted";
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "Unposted" : dateFormatter.format(parsed);
}

function formatDateInputValue(value: string | null | undefined) {
  return value ? value.slice(0, 10) : "";
}

function formatPaidTrafficMetric(value: string) {
  return value
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function getCapLabel(video: CreatorLedgerVideo) {
  if (video.perVideoCapScope === "NONE") {
    return "no payout cap";
  }

  const scope = video.perVideoCapScope === "TOTAL" ? "total pay" : "CPM pay";
  const state = video.viewCapReached ? "applied" : "available";

  return `${formatMoney(video.payoutCapPerVideo, video.currency)} ${scope} cap ${state}`;
}

function getVideoTerms(video: CreatorLedgerVideo) {
  const paidDeduction = video.deductPaidTraffic
    ? `deduct ${formatPaidTrafficMetric(video.paidTrafficMetric)} paid views`
    : "do not deduct paid views";
  const overrideLabel = video.hasVideoDealOverride ? "video override; " : "";

  return `${overrideLabel}${formatMoney(video.fixedFeePerVideo, video.currency)} per video fixed; ${formatMoney(video.cpmAmount, video.currency)} CPM; view cap ${formatOptionalNumber(video.viewCapPerVideo)}; ${getCapLabel(video)}; ${paidDeduction}`;
}

function getVideoFormula(video: CreatorLedgerVideo) {
  const cpmExpression = `(${formatNumber(video.payableViews)} / 1000) x ${formatMoney(video.cpmAmount, video.currency)}`;
  const cpmPayLabel = `${cpmExpression} = ${formatMoney(video.cpmPay, video.currency)}`;
  const totalLabel = `${formatMoney(video.fixedFeePerVideo, video.currency)} fixed + ${formatMoney(video.cpmPay, video.currency)} CPM = ${formatMoney(video.videoPay, video.currency)}`;

  return `${getVideoTerms(video)}; ${cpmPayLabel}; ${totalLabel}`;
}

const dealInputClassName =
  "mt-2 h-12 w-full rounded-[0.75rem] border border-white/[0.1] bg-black/25 px-3 text-base text-foreground";

function FieldLabel({
  children,
  label,
}: {
  children: ReactNode;
  label: string;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}

function CreatorDealEditor({
  creator,
}: {
  creator: CreatorLedgerEditableCreator;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);

    setErrorMessage(null);
    setSuccessMessage(null);
    startTransition(async () => {
      const result = await saveCreatorPortalCreatorDeal(formData);

      if (!result.ok) {
        setErrorMessage(result.error);
        return;
      }

      setSuccessMessage("Creator deal saved.");
      router.refresh();
    });
  }

  return (
    <details className="rounded-[1.35rem] border border-[#90FF4D]/15 bg-[#90FF4D]/[0.035] p-5">
      <summary className="cursor-pointer text-sm font-semibold text-foreground">
        Edit creator deal structure
      </summary>
      <form className="mt-4 space-y-3" onSubmit={handleSubmit}>
        <input
          name="campaignCreatorId"
          type="hidden"
          value={creator.campaignCreatorId}
        />
        <input name="dealId" type="hidden" value={creator.deal.id ?? ""} />
        <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
          <FieldLabel label="Currency">
            <input
              className={dealInputClassName}
              defaultValue={creator.deal.currency || creator.currency}
              maxLength={3}
              name="currency"
            />
          </FieldLabel>
          <FieldLabel label="Deal start">
            <input
              className={dealInputClassName}
              defaultValue=""
              name="effectiveStartDate"
              type="date"
            />
          </FieldLabel>
          <FieldLabel label="Deal end">
            <input
              className={dealInputClassName}
              defaultValue={formatDateInputValue(creator.deal.effectiveEndDate)}
              name="effectiveEndDate"
              type="date"
            />
          </FieldLabel>
          <FieldLabel label="Creator fixed">
            <input
              className={dealInputClassName}
              defaultValue={creator.deal.fixedFee ?? ""}
              name="fixedFee"
              step="0.01"
              type="number"
            />
          </FieldLabel>
          <FieldLabel label="Fixed fee date">
            <input
              className={dealInputClassName}
              defaultValue={formatDateInputValue(
                creator.deal.fixedFeeRecognitionDate,
              )}
              name="fixedFeeRecognitionDate"
              type="date"
            />
          </FieldLabel>
          <FieldLabel label="Fixed / video">
            <input
              className={dealInputClassName}
              defaultValue={creator.deal.fixedFeePerVideo ?? ""}
              name="fixedFeePerVideo"
              step="0.01"
              type="number"
            />
          </FieldLabel>
          <FieldLabel label="CPM">
            <input
              className={dealInputClassName}
              defaultValue={creator.deal.cpmAmount}
              name="cpmAmount"
              step="0.01"
              type="number"
            />
          </FieldLabel>
          <FieldLabel label="Paid metric">
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
          <FieldLabel label="View cap">
            <input
              className={dealInputClassName}
              defaultValue={creator.deal.viewCapPerVideo ?? ""}
              name="viewCapPerVideo"
              step="1"
              type="number"
            />
          </FieldLabel>
          <FieldLabel label="View window">
            <input
              className={dealInputClassName}
              defaultValue={creator.deal.viewWindowDays}
              min="1"
              name="viewWindowDays"
              step="1"
              type="number"
            />
          </FieldLabel>
          <FieldLabel label="Payout cap / video">
            <input
              className={dealInputClassName}
              defaultValue={creator.deal.payoutCapPerVideo}
              name="payoutCapPerVideo"
              step="0.01"
              type="number"
            />
          </FieldLabel>
          <FieldLabel label="Cap scope">
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
          <FieldLabel label="Total cap">
            <input
              className={dealInputClassName}
              defaultValue={creator.deal.payoutCapTotal ?? ""}
              name="payoutCapTotal"
              step="0.01"
              type="number"
            />
          </FieldLabel>
          <FieldLabel label="Notes">
            <input
              className={dealInputClassName}
              defaultValue={creator.deal.notes ?? ""}
              name="notes"
            />
          </FieldLabel>
        </div>
        <label className="flex min-h-9 items-center gap-2 rounded-[0.75rem] border border-white/[0.08] bg-black/[0.14] px-3 py-2 text-sm text-foreground">
          <input
            defaultChecked={creator.deal.deductPaidTraffic}
            name="deductPaidTraffic"
            type="checkbox"
          />
          Deduct paid traffic
        </label>
        {errorMessage ? (
          <p className="text-sm text-[#FFD3C5]">{errorMessage}</p>
        ) : null}
        {successMessage ? (
          <p className="text-sm text-[#D4FFB2]">{successMessage}</p>
        ) : null}
        <button
          className="rounded-[0.85rem] bg-white px-4 py-2 text-sm font-semibold text-black transition hover:bg-[#90FF4D] disabled:cursor-not-allowed disabled:opacity-60"
          disabled={isPending}
          type="submit"
        >
          {isPending ? "Saving..." : "Save creator deal"}
        </button>
      </form>
    </details>
  );
}

function VideoDealEditor({ video }: { video: CreatorLedgerVideo }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);

    setErrorMessage(null);
    setSuccessMessage(null);
    startTransition(async () => {
      const result = await saveCreatorPortalVideoDeal(formData);

      if (!result.ok) {
        setErrorMessage(result.error);
        return;
      }

      setSuccessMessage("Video deal saved.");
      router.refresh();
    });
  }

  return (
    <details className="rounded-[1rem] border border-[#90FF4D]/15 bg-[#90FF4D]/[0.04] p-4">
      <summary className="cursor-pointer text-base font-semibold text-[#D4FFB2]">
        Edit video deal
      </summary>
      <form className="mt-4 space-y-4" onSubmit={handleSubmit}>
        <input
          name="campaignCreatorId"
          type="hidden"
          value={video.campaignCreatorId}
        />
        <input name="sourceVideoId" type="hidden" value={video.sourceVideoId} />
        <input
          name="paidTrafficMetric"
          type="hidden"
          value={video.paidTrafficMetric}
        />
        <input
          name="deductPaidTraffic"
          type="hidden"
          value={video.deductPaidTraffic ? "on" : ""}
        />
        <input
          name="viewCapPerVideo"
          type="hidden"
          value={video.viewCapPerVideo ?? ""}
        />
        <input
          name="perVideoCapScope"
          type="hidden"
          value={video.perVideoCapScope}
        />
        <input name="notes" type="hidden" value={video.videoDealNotes ?? ""} />
        <div className="grid gap-4 md:grid-cols-3">
          <FieldLabel label="Fixed / video">
            <input
              className={dealInputClassName}
              defaultValue={video.fixedFeePerVideo || ""}
              name="fixedFeePerVideo"
              step="0.01"
              type="number"
            />
          </FieldLabel>
          <FieldLabel label="CPM">
            <input
              className={dealInputClassName}
              defaultValue={video.cpmAmount}
              name="cpmAmount"
              step="0.01"
              type="number"
            />
          </FieldLabel>
          <FieldLabel label="Payout cap">
            <input
              className={dealInputClassName}
              defaultValue={video.payoutCapPerVideo}
              name="payoutCapPerVideo"
              step="0.01"
              type="number"
            />
          </FieldLabel>
        </div>
        {errorMessage ? (
          <p className="text-xs text-[#FFD3C5]">{errorMessage}</p>
        ) : null}
        {successMessage ? (
          <p className="text-xs text-[#D4FFB2]">{successMessage}</p>
        ) : null}
        <button
          className="min-h-11 rounded-[0.85rem] border border-[#90FF4D]/20 bg-[#90FF4D]/90 px-4 text-sm font-semibold text-black transition hover:bg-[#A4FF68] disabled:cursor-not-allowed disabled:opacity-60"
          disabled={isPending}
          type="submit"
        >
          {isPending ? "Saving..." : "Save video deal"}
        </button>
      </form>
    </details>
  );
}

export function CreatorLedgerClient({
  canEditDeals,
  creator,
  initialSort,
  videos,
}: CreatorLedgerClientProps) {
  const [sort, setSort] = useState<CreatorPortalFeedSort>(initialSort);
  const sortedVideos = useMemo(
    () => sortCreatorPortalFeedVideos(videos, sort),
    [sort, videos],
  );

  return (
    <div className="space-y-4">
      {canEditDeals && creator ? <CreatorDealEditor creator={creator} /> : null}
      <section className="overflow-hidden rounded-[1.35rem] border border-white/[0.08] bg-[#0D0E11] shadow-[0_24px_70px_rgba(0,0,0,0.24)]">
      <div className="flex flex-col gap-3 border-b border-white/[0.08] px-5 py-4 sm:flex-row sm:items-end sm:justify-between">
        <h2 className="text-lg font-semibold tracking-[-0.03em]">
          Ledger
        </h2>
        <label className="w-full sm:w-48">
          <span className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
            Sort
          </span>
          <select
            className="mt-2 w-full rounded-[0.85rem] border border-white/[0.08] bg-black/25 px-3 py-2 text-sm text-foreground"
            onChange={(event) =>
              setSort(event.currentTarget.value === "date" ? "date" : "views")
            }
            value={sort}
          >
            <option value="views">Most views</option>
            <option value="date">Newest date</option>
          </select>
        </label>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-white/[0.08] text-left text-sm">
          <thead className="bg-white/[0.03] text-xs uppercase tracking-[0.14em] text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">Video</th>
              <th className="px-4 py-3 font-medium">Date</th>
              <th className="px-4 py-3 font-medium">Views</th>
              <th className="px-4 py-3 font-medium">Payable</th>
              <th className="px-4 py-3 font-medium">Formula</th>
              <th className="px-4 py-3 text-right font-medium">Pay</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.06]">
            {sortedVideos.map((video) => (
              <Fragment key={`${video.campaignCreatorId}-${video.sourceVideoId}`}>
                <tr>
                  <td className="max-w-[24rem] px-4 py-4">
                    <div className="flex min-w-0 items-center gap-3">
                      <a
                        aria-label={video.titleOrCaption || "Open TikTok video"}
                        className="flex h-16 w-12 shrink-0 items-center justify-center overflow-hidden rounded-md border border-white/[0.08] bg-white/[0.04] transition hover:border-[#90FF4D]/60"
                        href={video.videoUrl}
                        rel="noreferrer"
                        target="_blank"
                      >
                        {video.thumbnailUrl ? (
                          <img
                            alt=""
                            className="h-full w-full object-cover"
                            loading="lazy"
                            src={video.thumbnailUrl}
                          />
                        ) : (
                          <span className="block h-0 w-0 border-y-[6px] border-l-[9px] border-y-transparent border-l-muted-foreground/70" />
                        )}
                      </a>
                      <div className="min-w-0">
                        <a
                          className="line-clamp-2 font-medium text-foreground transition hover:text-[#90FF4D]"
                          href={video.videoUrl}
                          rel="noreferrer"
                          target="_blank"
                        >
                          {video.titleOrCaption || "TikTok video"}
                        </a>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {video.paidStatus}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-4 text-muted-foreground">
                    {formatDate(video.publishedAt ?? video.createdAt)}
                  </td>
                  <td className="px-4 py-4 text-muted-foreground">
                    {formatNumber(video.grossViews)}
                  </td>
                  <td className="px-4 py-4 text-muted-foreground">
                    {formatNumber(video.payableViews)}
                  </td>
                  <td className="min-w-[24rem] px-4 py-4 font-mono text-xs leading-5 text-muted-foreground">
                    {getVideoFormula(video)}
                  </td>
                  <td className="px-4 py-4 text-right font-semibold text-foreground">
                    {formatMoney(video.videoPay, video.currency)}
                  </td>
                </tr>
                {canEditDeals ? (
                  <tr>
                    <td className="px-4 pb-5 pt-0" colSpan={6}>
                      <VideoDealEditor video={video} />
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            ))}
            {sortedVideos.length === 0 ? (
              <tr>
                <td
                  className="px-4 py-10 text-center text-sm text-muted-foreground"
                  colSpan={6}
                >
                  No tracked videos were posted or viewed in this date range.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      </section>
    </div>
  );
}
