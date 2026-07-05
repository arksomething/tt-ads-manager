"use client";

import Link from "next/link";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";

import { DashboardIcon } from "@/components/org-dashboard/org-icons";
import {
  calculateBlazieProfitabilityMetrics,
  getBlazieFixedCostTarget,
  hasPendingBlazieOrganicProceeds,
} from "@/lib/blazie-fixed-costs";
import {
  getInitialDetailedStatisticsOpen,
  getNextExpandedUgcStatusDates,
  getTikTokEmbedPlayerUrl,
  getTikTokEmbedPostId,
  getUgcStatusVideoViewShare,
  type UgcStatusViewVariant,
} from "@/lib/ugc-status-view";
import { type DashboardSearchParams } from "@/server/dashboard/filters";
import {
  type UgcStatusData,
  type UgcStatusTopVideosData,
} from "@/server/dashboard/ugc-status";

type UgcStatusClientProps = {
  endDate: string;
  initialData?: UgcStatusData | null;
  organizationSlug: string;
  variant?: UgcStatusViewVariant;
  searchParams: DashboardSearchParams;
  startDate: string;
};

type LoadState =
  | {
      data: UgcStatusData;
      error: null;
      status: "ready";
      url: string;
    }
  | {
      data: null;
      error: string | null;
      status: "error" | "loading";
      url: string | null;
    };

type TopVideosLoadState =
  | {
      data: UgcStatusTopVideosData;
      error: null;
      status: "ready";
    }
  | {
      data: null;
      error: string | null;
      status: "error" | "loading";
    };

type TopVideosByDate = Record<string, TopVideosLoadState | undefined>;
type TopVideoRow = UgcStatusTopVideosData["ugc"][number];

const currencyFormatterCache = new Map<string, Intl.NumberFormat>();
const integerFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
});
const decimalFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 2,
});
const percentFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 1,
  style: "percent",
});
const dateFormatter = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});
const HISTORICAL_ATTRIBUTION_CUTOFF_DATE = "2026-05-12";
const UGC_STATUS_PENDING_REFRESH_MS = 10_000;

function getCurrencyFormatter(currency: string) {
  const normalizedCurrency = currency.toUpperCase();
  const cached = currencyFormatterCache.get(normalizedCurrency);

  if (cached) {
    return cached;
  }

  const formatter = new Intl.NumberFormat("en-US", {
    currency: normalizedCurrency,
    maximumFractionDigits: 2,
    style: "currency",
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

function formatSignedAmount(value: number, currency: string | null) {
  const absoluteValue = formatAmount(Math.abs(value), currency);
  return value < 0 ? `-${absoluteValue}` : absoluteValue;
}

function formatOptionalAmount(value: number | null, currency: string | null) {
  return value === null ? "Unavailable" : formatAmount(value, currency);
}

function formatOptionalSignedAmount(
  value: number | null,
  currency: string | null,
) {
  return value === null ? "Unavailable" : formatSignedAmount(value, currency);
}

function formatViews(value: number) {
  return integerFormatter.format(value);
}

function formatPercent(value: number | null) {
  return typeof value === "number" && Number.isFinite(value)
    ? percentFormatter.format(value)
    : "Unavailable";
}

function formatRatio(value: number | null) {
  return typeof value === "number" && Number.isFinite(value)
    ? `${decimalFormatter.format(value)}x`
    : "Unavailable";
}

function formatDate(value: string) {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? value : dateFormatter.format(parsed);
}

function InfoTip({ label, tip }: { label: string; tip: string }) {
  return (
    <span
      aria-label={`${label}: ${tip}`}
      className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-white/[0.08] bg-black/[0.18] text-muted-foreground"
      role="img"
      tabIndex={0}
      title={tip}
    >
      <DashboardIcon className="h-3 w-3" name="info" />
    </span>
  );
}

function LabelWithTip({ label, tip }: { label: string; tip: string }) {
  return (
    <span className="inline-flex items-center justify-end gap-1.5">
      <span>{label}</span>
      <InfoTip label={label} tip={tip} />
    </span>
  );
}

function TikTokVideoModal({
  onClose,
  video,
}: {
  onClose: () => void;
  video: TopVideoRow;
}) {
  const postId = getTikTokEmbedPostId({
    sourceVideoId: video.sourceVideoId,
    url: video.url,
  });
  const embedUrl = postId ? getTikTokEmbedPlayerUrl(postId) : null;

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  if (!embedUrl) {
    return null;
  }

  return (
    <div
      aria-label={video.title}
      aria-modal="true"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
      role="dialog"
    >
      <div className="flex max-h-[calc(100vh-2rem)] w-full max-w-[30rem] flex-col overflow-hidden rounded-[1rem] border border-white/[0.12] bg-[#0B0B0D] shadow-[0_24px_90px_rgba(0,0,0,0.65)]">
        <div className="flex items-start justify-between gap-3 border-b border-white/[0.08] px-4 py-3">
          <div className="min-w-0">
            <p className="line-clamp-1 text-sm font-medium text-foreground">
              {video.title}
            </p>
            <p className="mt-1 truncate text-xs text-muted-foreground">
              {video.creatorName ?? "Unknown creator"}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {video.url ? (
              <a
                aria-label="Open in TikTok"
                className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/[0.1] bg-white/[0.04] text-muted-foreground transition hover:border-white/[0.22] hover:text-foreground"
                href={video.url}
                rel="noreferrer"
                target="_blank"
              >
                <DashboardIcon className="h-4 w-4" name="externalLink" />
              </a>
            ) : null}
            <button
              aria-label="Close video"
              className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/[0.1] bg-white/[0.04] text-muted-foreground transition hover:border-white/[0.22] hover:text-foreground"
              onClick={onClose}
              type="button"
            >
              <DashboardIcon className="h-4 w-4" name="close" />
            </button>
          </div>
        </div>
        <iframe
          allow="fullscreen; encrypted-media; picture-in-picture"
          allowFullScreen
          className="aspect-[9/16] max-h-[78vh] w-full bg-black"
          loading="lazy"
          referrerPolicy="strict-origin-when-cross-origin"
          src={embedUrl}
          title={video.title}
        />
      </div>
    </div>
  );
}

function TopVideoList({
  currency,
  label,
  spendLabel,
  totalViews,
  videos,
}: {
  currency: string | null;
  label: string;
  spendLabel: string;
  totalViews: number;
  videos: UgcStatusTopVideosData["ugc"];
}) {
  const [selectedVideo, setSelectedVideo] = useState<TopVideoRow | null>(null);

  return (
    <div className="rounded-[1rem] border border-white/[0.08] bg-black/20 p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-medium text-foreground">{label}</h3>
        <span className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
          Top {videos.length || 0}
        </span>
      </div>

      {videos.length > 0 ? (
        <div className="mt-4 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
          {videos.map((video, index) => {
            const viewShare = getUgcStatusVideoViewShare(
              video.views,
              totalViews,
            );
            const embedPostId = getTikTokEmbedPostId({
              sourceVideoId: video.sourceVideoId,
              url: video.url,
            });
            const viewShareLabel =
              viewShare === null
                ? "Unavailable"
                : `${formatPercent(viewShare)} of views`;

            return (
              <article
                className="min-w-0 rounded-[0.75rem] border border-white/[0.08] bg-white/[0.035] p-2 text-sm shadow-[inset_0_1px_0_rgba(255,255,255,0.025)]"
                key={video.id}
              >
                <div className="relative overflow-hidden rounded-lg border border-white/[0.08] bg-white/[0.04]">
                  {video.thumbnailUrl ? (
                    <img
                      alt=""
                      className="aspect-[4/5] w-full object-cover"
                      loading="lazy"
                      src={video.thumbnailUrl}
                    />
                  ) : (
                    <span className="flex aspect-[4/5] w-full items-center justify-center text-[0.62rem] uppercase tracking-[0.16em] text-muted-foreground">
                      Video
                    </span>
                  )}
                  {embedPostId ? (
                    <button
                      aria-label={`Watch ${video.title}`}
                      className="absolute inset-0 z-[1] flex items-center justify-center bg-black/0 text-white transition hover:bg-black/25"
                      onClick={() => setSelectedVideo(video)}
                      type="button"
                    >
                      <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-black/65 shadow-[0_12px_28px_rgba(0,0,0,0.35)]">
                        <DashboardIcon className="h-5 w-5" name="videos" />
                      </span>
                    </button>
                  ) : video.url ? (
                    <a
                      aria-label={`Open ${video.title}`}
                      className="absolute inset-0 z-[1]"
                      href={video.url}
                      rel="noreferrer"
                      target="_blank"
                    />
                  ) : null}
                  <span className="absolute left-2 top-2 z-[2] inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-black/70 px-2 text-xs font-medium text-white shadow-[0_8px_20px_rgba(0,0,0,0.28)]">
                    {index + 1}
                  </span>
                  {video.url ? (
                    <a
                      aria-label={`Open ${video.title} in TikTok`}
                      className="absolute right-2 top-2 z-[3] inline-flex h-7 w-7 items-center justify-center rounded-full bg-black/70 text-white shadow-[0_8px_20px_rgba(0,0,0,0.28)] transition hover:bg-black/85"
                      href={video.url}
                      rel="noreferrer"
                      target="_blank"
                    >
                      <DashboardIcon className="h-3.5 w-3.5" name="externalLink" />
                    </a>
                  ) : null}
                </div>
                <div className="mt-3 min-w-0">
                  {video.url ? (
                    <a
                      className="line-clamp-2 min-h-10 text-sm font-medium leading-5 text-foreground hover:text-white"
                      href={video.url}
                      rel="noreferrer"
                      target="_blank"
                    >
                      {video.title}
                    </a>
                  ) : (
                    <p className="line-clamp-2 min-h-10 text-sm font-medium leading-5 text-foreground">
                      {video.title}
                    </p>
                  )}
                  <p className="mt-1 truncate text-xs text-muted-foreground">
                    {video.creatorName ?? "Unknown creator"}
                  </p>
                </div>
                <div className="mt-3 flex items-end justify-between gap-2 border-t border-white/[0.06] pt-2">
                  <div>
                    <p className="text-[0.58rem] uppercase tracking-[0.16em] text-muted-foreground">
                      Views
                    </p>
                    <p className="mt-1 text-sm font-medium text-foreground">
                      {formatViews(video.views)}
                    </p>
                  </div>
                  <div className="text-right text-xs">
                    <p className="font-medium text-foreground">
                      {viewShareLabel}
                    </p>
                    <p className="mt-1 text-muted-foreground">
                      {video.spend === null
                        ? spendLabel
                        : `${formatAmount(video.spend, currency)} ${spendLabel}`}
                    </p>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <p className="mt-4 text-sm text-muted-foreground">
          No video rows for this day.
        </p>
      )}
      {selectedVideo ? (
        <TikTokVideoModal
          onClose={() => setSelectedVideo(null)}
          video={selectedVideo}
        />
      ) : null}
    </div>
  );
}

function TopVideosUnavailable({
  message,
  title,
}: {
  message: string;
  title: string;
}) {
  return (
    <div className="rounded-[1rem] border border-white/[0.08] bg-black/20 p-4">
      <h3 className="text-sm font-medium text-foreground">{title}</h3>
      <p className="mt-4 text-sm leading-6 text-muted-foreground">{message}</p>
    </div>
  );
}

function TopVideosLoading() {
  return (
    <div className="rounded-[1rem] border border-white/[0.08] bg-black/20 p-4">
      <SkeletonBlock className="h-4 w-40" />
      <div className="mt-4 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
        {Array.from({ length: 12 }).map((_, index) => (
          <div
            className="rounded-[0.75rem] border border-white/[0.08] bg-white/[0.035] p-2"
            key={index}
          >
            <SkeletonBlock className="aspect-[4/5] w-full" />
            <SkeletonBlock className="mt-3 h-4 w-full" />
            <SkeletonBlock className="mt-2 h-3 w-2/3" />
          </div>
        ))}
      </div>
    </div>
  );
}

function TopVideosPanel({
  currency,
  state,
}: {
  currency: string | null;
  state: TopVideosLoadState | undefined;
}) {
  if (!state || state.status === "loading") {
    return <TopVideosLoading />;
  }

  if (state.status === "error") {
    return (
      <TopVideosUnavailable
        message={state.error ?? "Could not load top videos right now."}
        title="Video breakdown unavailable"
      />
    );
  }

  const topVideos = state.data;

  if (!topVideos) {
    return <TopVideosLoading />;
  }

  return (
    <div className="space-y-3">
      {topVideos.warnings.length > 0 ? (
        <div className="rounded-[1rem] border border-[#FFD24D]/20 bg-[#FFD24D]/[0.08] px-4 py-3 text-sm text-[#FFEAB1]">
          {topVideos.warnings[0]}
        </div>
      ) : null}
      <TopVideoList
        currency={currency}
        label="UGC videos by 30/7 gained views"
        spendLabel="paid"
        totalViews={topVideos.totalViews}
        videos={topVideos.ugc}
      />
    </div>
  );
}

function appendSearchParams(
  params: URLSearchParams,
  searchParams: DashboardSearchParams,
) {
  for (const [key, value] of Object.entries(searchParams)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        params.append(key, item);
      }
    } else if (typeof value === "string") {
      params.set(key, value);
    }
  }
}

function SkeletonBlock({ className = "" }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded-[0.8rem] bg-white/[0.055] ${className}`}
    />
  );
}

function StatCard(args: {
  className?: string;
  icon: "payouts" | "integrations" | "creators" | "compare" | "videos" | "revenue";
  label: string;
  meta: string;
  tip?: string;
  value: string;
}) {
  return (
    <article
      className={`rounded-[1.25rem] border border-white/[0.08] bg-white/[0.03] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] ${args.className ?? ""}`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-xs uppercase leading-4 tracking-[0.22em] text-muted-foreground">
          <span>{args.label}</span>
          {args.tip ? <InfoTip label={args.label} tip={args.tip} /> : null}
        </div>
        <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[0.75rem] border border-white/[0.08] bg-black/[0.22] text-muted-foreground">
          <DashboardIcon className="h-4 w-4" name={args.icon} />
        </span>
      </div>
      <p className="mt-3 break-words text-2xl font-medium tracking-[-0.045em] text-foreground tabular-nums">
        {args.value}
      </p>
      <p className="mt-2 text-xs leading-5 text-muted-foreground">{args.meta}</p>
    </article>
  );
}

function RatioCard(args: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <article className="rounded-[1rem] border border-white/[0.08] bg-black/[0.18] p-3.5">
      <p className="text-[0.62rem] uppercase tracking-[0.2em] text-muted-foreground">
        {args.label}
      </p>
      <p className="mt-2 text-lg font-medium text-foreground">{args.value}</p>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">{args.detail}</p>
    </article>
  );
}

function hasPendingOrganicProceeds(data: UgcStatusData) {
  return hasPendingBlazieOrganicProceeds({
    proceeds: data.summary.proceeds,
    warnings: data.proceedsWarnings,
  });
}

function getBlazieAction(args: {
  profitLoss: number;
  proceedsPending: boolean;
  roas: number | null;
}) {
  if (args.proceedsPending) {
    return {
      detail: "Revenue attribution is still updating. Costs and views are loaded, but wait for proceeds before deciding whether to scale.",
      title: "Wait for revenue data.",
    };
  }

  if (args.roas === null) {
    return {
      detail: "Wait for spend and revenue to come in before changing anything.",
      title: "Not enough data yet.",
    };
  }

  if (args.roas < 1) {
    return {
      detail: "Videos are losing money before fixed costs. Improve conversion first.",
      title: "Do not scale yet.",
    };
  }

  if (args.profitLoss < 0) {
    return {
      detail: "Videos are working. You are still down after fixed costs, so keep scaling only if ROAS holds.",
      title: "Keep pushing carefully.",
    };
  }

  return {
    detail: "Videos are profitable after fixed costs. Consider scaling spend.",
    title: "Good. Consider scaling.",
  };
}

function BlazieMetricsSummary({
  data,
  endDate,
  startDate,
}: {
  data: UgcStatusData;
  endDate: string;
  startDate: string;
}) {
  const fixedCostTarget = getBlazieFixedCostTarget(startDate, endDate);
  const metrics = calculateBlazieProfitabilityMetrics({
    fixedCost: fixedCostTarget,
    videoRevenue: data.summary.proceeds,
    videoSpend: data.summary.spend,
  });
  const fixedCostLabel = formatAmount(metrics.fixedCost, data.currency);
  const proceedsPending = hasPendingOrganicProceeds(data);
  const action = getBlazieAction({
    profitLoss: metrics.profitLoss,
    proceedsPending,
    roas: metrics.roas,
  });
  const warnings = getUgcStatusWarnings(data, "blazie");
  const profitLossValue = proceedsPending
    ? "Pending"
    : formatSignedAmount(metrics.profitLoss, data.currency);

  return (
    <>
      <section className="grid gap-4 rounded-[1.55rem] border border-[#90FF4D]/20 bg-[#90FF4D]/[0.06] p-4 shadow-[0_24px_70px_rgba(0,0,0,0.2)] backdrop-blur sm:p-5 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,24rem)] lg:items-center">
        <div className="order-2 lg:order-1">
          <p className="text-xs uppercase tracking-[0.28em] text-[#B8FF86]">
            What to do
          </p>
          <h2 className="mt-3 text-xl font-medium tracking-[-0.045em] text-foreground sm:text-2xl">
            {action.title}
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
            {action.detail}
          </p>
        </div>

        <article className="order-1 min-w-0 rounded-[1.2rem] border border-[#90FF4D]/25 bg-black/[0.22] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] sm:p-5 lg:order-2">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-xs uppercase tracking-[0.22em] text-[#B8FF86]">
              <span>Profit/loss</span>
              <InfoTip
                label="Profit/loss"
                tip="UGC and faceless revenue minus UGC and faceless spend and the prorated fixed-cost target."
              />
            </div>
            {warnings.length > 0 ? <ReportWarningsButton warnings={warnings} /> : null}
          </div>
          <p className="mt-4 break-words text-3xl font-semibold tracking-[-0.045em] text-foreground tabular-nums sm:text-4xl">
            {profitLossValue}
          </p>
          <p className="mt-2 text-xs leading-5 text-muted-foreground">
            {proceedsPending
              ? "Waiting on attributed proceeds"
              : `After ${fixedCostLabel} fixed costs`}
          </p>
        </article>
      </section>

      <section
        aria-label="Blazie top metrics"
        className="overflow-x-auto pb-1"
      >
        <div className="flex min-w-max gap-3 sm:grid sm:min-w-0 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          <StatCard
            className="w-[14.25rem] shrink-0 sm:w-auto"
            icon="compare"
            label="UGC + faceless ROAS"
            meta={
              proceedsPending
                ? `${formatAmount(metrics.videoSpend, data.currency)} spend loaded`
                : `${formatAmount(metrics.videoRevenue, data.currency)} revenue / ${formatAmount(metrics.videoSpend, data.currency)} spend`
            }
            tip="UGC and faceless revenue divided by UGC and faceless spend. Fixed costs are not included in ROAS."
            value={proceedsPending ? "Pending" : formatRatio(metrics.roas)}
          />
          <StatCard
            className="w-[14.25rem] shrink-0 sm:w-auto"
            icon="revenue"
            label="UGC + faceless revenue"
            meta={
              proceedsPending
                ? "Source split still preparing"
                : "Organic / unattributed proceeds"
            }
            tip="Revenue organic / unattributed proceeds after renewals and paid-source attribution. This is the combined UGC and faceless bucket."
            value={proceedsPending ? "Pending" : formatAmount(metrics.videoRevenue, data.currency)}
          />
          <StatCard
            className="w-[14.25rem] shrink-0 sm:w-auto"
            icon="integrations"
            label="UGC + faceless spend"
            meta="Before fixed costs"
            tip="Includes UGC Pay, UGC management, ViewsBase faceless base spend, and faceless management. Fixed costs are not included."
            value={formatAmount(metrics.videoSpend, data.currency)}
          />
          <StatCard
            className="w-[14.25rem] shrink-0 sm:w-auto"
            icon="integrations"
            label="UGC-only spend"
            meta={`${formatAmount(data.summary.ugcPaySpend, data.currency)} UGC Pay + ${formatAmount(data.summary.ugcManagementSpend, data.currency)} mgmt`}
            tip="Only UGC Pay and UGC management spend. Faceless spend and fixed costs are excluded."
            value={formatAmount(data.summary.ugcSpend, data.currency)}
          />
          <StatCard
            className="w-[14.25rem] shrink-0 sm:w-auto"
            icon="videos"
            label="UGC views"
            meta="UGC Pay payable views"
            tip="Payable views after report window rules, paid-view deductions, and caps. View Tally and TikTok paid data can lag."
            value={formatViews(data.summary.ugcViews)}
          />
        </div>
      </section>
    </>
  );
}

function HeaderAndControls({
  data,
  endDate,
  organizationSlug,
  startDate,
  variant = "default",
}: {
  data: UgcStatusData | null;
  endDate: string;
  organizationSlug: string;
  startDate: string;
  variant?: UgcStatusViewVariant;
}) {
  const isBlazie = variant === "blazie";

  return (
    <>
      <section className="rounded-[1.55rem] border border-white/[0.08] bg-white/[0.03] p-5 shadow-[0_24px_70px_rgba(0,0,0,0.2)] backdrop-blur">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl">
            <p className="text-xs uppercase tracking-[0.28em] text-muted-foreground">
              {isBlazie ? "Blazie" : "UGC status"}
            </p>
            <h1 className="mt-2 text-2xl font-medium tracking-[-0.045em] text-foreground">
              {isBlazie
                ? "Blazie profitability."
                : "UGC and faceless proceeds against spend and views."}
            </h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {isBlazie
                ? "A simple summary for the selected window: what to do, profit/loss, UGC + faceless ROAS, spend, and revenue."
                : "Proceeds use Revenue organic / unattributed proceeds after renewals and paid-source attribution. Spend comes from exact UGC Pay, prorated UGC management, and ViewsBase faceless base and management costs."}
            </p>
          </div>

          {isBlazie ? null : (
            <Link
              className="inline-flex min-h-11 items-center justify-center rounded-[0.95rem] border border-white/[0.12] bg-black/[0.24] px-4 text-sm font-medium text-foreground transition hover:border-white/[0.2]"
              href={`/org/${organizationSlug}/revenue?startDate=${startDate}&endDate=${endDate}`}
            >
              Open Revenue
            </Link>
          )}
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          <span className="rounded-full border border-white/[0.08] bg-black/[0.2] px-3 py-1.5 text-xs text-muted-foreground">
            {formatDate(startDate)} to {formatDate(endDate)}
          </span>
          {isBlazie ? null : (
            <>
              <span className="rounded-full border border-white/[0.08] bg-black/[0.2] px-3 py-1.5 text-xs text-muted-foreground">
                Proceeds {data ? (data.proceedsConfigured ? "connected" : "missing") : "loading"}
              </span>
              <span className="rounded-full border border-white/[0.08] bg-black/[0.2] px-3 py-1.5 text-xs text-muted-foreground">
                Faceless {data ? (data.facelessConfigured ? "connected" : "missing") : "loading"}
              </span>
              {data?.ugcCampaignLabel ? (
                <span className="rounded-full border border-white/[0.08] bg-black/[0.2] px-3 py-1.5 text-xs text-muted-foreground">
                  UGC campaign {data.ugcCampaignLabel}
                </span>
              ) : null}
            </>
          )}
        </div>
      </section>

      <section className="rounded-[1.55rem] border border-white/[0.08] bg-white/[0.03] p-5 shadow-[0_24px_70px_rgba(0,0,0,0.2)] backdrop-blur">
        <p className="text-xs uppercase tracking-[0.28em] text-muted-foreground">
          {isBlazie ? "Dates" : "Controls"}
        </p>

        <form
          className="mt-5 grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]"
          method="get"
        >
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

          <div className="flex items-end">
            <button
              className="inline-flex min-h-11 w-full items-center justify-center rounded-[0.95rem] border border-[#90FF4D]/20 bg-[#90FF4D]/90 px-4 text-sm font-medium text-black transition hover:bg-[#A4FF68] md:w-auto"
              type="submit"
            >
              {isBlazie ? "Refresh" : "Refresh status"}
            </button>
          </div>
        </form>
      </section>
    </>
  );
}

function getUgcStatusWarnings(
  data: UgcStatusData,
  variant: UgcStatusViewVariant = "default",
) {
  const isBlazie = variant === "blazie";
  const historicalAttributionWarning =
    data.startDate < HISTORICAL_ATTRIBUTION_CUTOFF_DATE
      ? isBlazie
        ? "Before May 12, 2026, old Adapty/Singular attribution can overstate organic proceeds; UGC and faceless proceeds are directional."
        : "Before May 12, 2026, old Adapty/Singular attribution can overstate organic proceeds; UGC/F proceeds are directional."
      : null;

  return [
    ...(historicalAttributionWarning ? [historicalAttributionWarning] : []),
    ...data.proceedsWarnings,
    ...(data.facelessErrorMessage
      ? [`ViewsBase faceless spend could not be loaded: ${data.facelessErrorMessage}`]
      : []),
  ];
}

function ReportWarningsButton({ warnings }: { warnings: string[] }) {
  return (
    <div className="group relative">
      <button
        aria-label={`${warnings.length} report ${warnings.length === 1 ? "warning" : "warnings"}`}
        className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-[#FFD24D]/25 bg-[#FFD24D]/[0.08] text-[#FFEAB1] outline-none transition hover:border-[#FFD24D]/45 hover:bg-[#FFD24D]/[0.12] focus-visible:border-[#FFD24D]/50 focus-visible:bg-[#FFD24D]/[0.12]"
        type="button"
      >
        <DashboardIcon className="h-4 w-4" name="warning" />
      </button>

      <div className="absolute right-0 top-full z-50 mt-2 hidden max-h-[min(22rem,calc(100vh-8rem))] w-[calc(100vw-2rem)] max-w-[38rem] overflow-y-auto overscroll-contain rounded-[1rem] border border-[#FFD24D]/20 bg-[#17140A] p-4 text-left text-sm leading-5 text-[#FFEAB1] shadow-[0_24px_70px_rgba(0,0,0,0.45)] group-hover:block group-focus-within:block">
        <p className="text-xs uppercase tracking-[0.2em] text-[#FFEAB1]/80">
          Report warnings
        </p>
        <ul className="mt-2 space-y-1.5">
          {warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function WarningPanel({
  data,
  variant = "default",
}: {
  data: UgcStatusData;
  variant?: UgcStatusViewVariant;
}) {
  const warnings = getUgcStatusWarnings(data, variant);

  if (warnings.length === 0) {
    return null;
  }

  return (
    <section className="flex justify-end">
      <ReportWarningsButton warnings={warnings} />
    </section>
  );
}

function UgcStatusSkeleton() {
  return (
    <>
      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        {Array.from({ length: 5 }).map((_, index) => (
          <article
            className="rounded-[1.25rem] border border-white/[0.08] bg-white/[0.03] p-4"
            key={index}
          >
            <SkeletonBlock className="h-3 w-24" />
            <SkeletonBlock className="mt-4 h-7 w-28" />
            <SkeletonBlock className="mt-3 h-3 w-full" />
          </article>
        ))}
      </section>

      <section className="rounded-[1.55rem] border border-white/[0.08] bg-white/[0.03] p-5">
        <SkeletonBlock className="h-4 w-20" />
        <SkeletonBlock className="mt-3 h-6 w-72 max-w-full" />
        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, index) => (
            <div
              className="rounded-[1rem] border border-white/[0.08] bg-black/[0.18] p-3.5"
              key={index}
            >
              <SkeletonBlock className="h-3 w-20" />
              <SkeletonBlock className="mt-3 h-5 w-24" />
              <SkeletonBlock className="mt-2 h-3 w-full" />
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-[1.55rem] border border-white/[0.08] bg-white/[0.03] p-5">
        <SkeletonBlock className="h-4 w-24" />
        <SkeletonBlock className="mt-3 h-6 w-80 max-w-full" />
        <div className="mt-5 space-y-2">
          {Array.from({ length: 7 }).map((_, index) => (
            <SkeletonBlock className="h-10 w-full" key={index} />
          ))}
        </div>
      </section>
    </>
  );
}

function BlazieMetricsSkeleton() {
  return (
    <>
      <section className="grid gap-5 rounded-[1.55rem] border border-[#90FF4D]/20 bg-[#90FF4D]/[0.06] p-5 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,24rem)]">
        <div>
          <SkeletonBlock className="h-3 w-24" />
          <SkeletonBlock className="mt-4 h-7 w-64 max-w-full" />
          <SkeletonBlock className="mt-3 h-4 w-full max-w-xl" />
        </div>
        <article className="rounded-[1.2rem] border border-[#90FF4D]/25 bg-black/[0.22] p-5">
          <SkeletonBlock className="h-3 w-24" />
          <SkeletonBlock className="mt-5 h-10 w-36" />
          <SkeletonBlock className="mt-3 h-3 w-44" />
        </article>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {Array.from({ length: 5 }).map((_, index) => (
          <article
            className="rounded-[1.25rem] border border-white/[0.08] bg-white/[0.03] p-4"
            key={index}
          >
            <SkeletonBlock className="h-3 w-24" />
            <SkeletonBlock className="mt-4 h-7 w-28" />
            <SkeletonBlock className="mt-3 h-3 w-full" />
          </article>
        ))}
      </section>
    </>
  );
}

function UgcStatusTable({
  data,
  organizationSlug,
  searchParams,
  variant = "default",
}: {
  data: UgcStatusData;
  organizationSlug: string;
  searchParams: DashboardSearchParams;
  variant?: UgcStatusViewVariant;
}) {
  const isBlazie = variant === "blazie";
  const proceedsPending = isBlazie && hasPendingOrganicProceeds(data);
  const [expandedDates, setExpandedDates] = useState<string[]>([]);
  const [topVideoStates, setTopVideoStates] = useState<TopVideosByDate>({});
  const searchParamsKey = useMemo(
    () => JSON.stringify(searchParams),
    [searchParams],
  );

  useEffect(() => {
    setExpandedDates([]);
    setTopVideoStates({});
  }, [data.endDate, data.startDate, searchParamsKey]);

  function loadTopVideos(date: string) {
    const existingState = topVideoStates[date];

    if (existingState?.status === "loading" || existingState?.status === "ready") {
      return;
    }

    setTopVideoStates((current) => ({
      ...current,
      [date]: {
        data: null,
        error: null,
        status: "loading",
      },
    }));

    const params = new URLSearchParams();
    appendSearchParams(params, searchParams);
    params.set("date", date);
    params.set("limit", "12");

    fetch(
      `/api/org/${encodeURIComponent(organizationSlug)}/ugc-status/top-videos?${params.toString()}`,
      {
        cache: "no-store",
        headers: {
          Accept: "application/json",
        },
      },
    )
      .then(async (response) => {
        const payload = await response.json();

        if (!response.ok) {
          throw new Error(
            typeof payload?.error === "string"
              ? payload.error
              : "Could not load top videos right now.",
          );
        }

        return payload as UgcStatusTopVideosData;
      })
      .then((topVideos) => {
        setTopVideoStates((current) => ({
          ...current,
          [date]: {
            data: topVideos,
            error: null,
            status: "ready",
          },
        }));
      })
      .catch((error) => {
        setTopVideoStates((current) => ({
          ...current,
          [date]: {
            data: null,
            error:
              error instanceof Error
                ? error.message
                : "Could not load top videos right now.",
            status: "error",
          },
        }));
      });
  }

  return (
    <section className="rounded-[1.55rem] border border-white/[0.08] bg-white/[0.03] p-5 shadow-[0_24px_70px_rgba(0,0,0,0.2)] backdrop-blur">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.28em] text-muted-foreground">
            Daily status
          </p>
          <h2 className="mt-2 text-xl font-medium tracking-[-0.04em] text-foreground">
            UGC and faceless economics by day
          </h2>
        </div>
        <p className="text-sm text-muted-foreground">
          {proceedsPending
            ? "Revenue attribution is still updating; proceeds-based columns are pending."
            : "Daily proceeds use Revenue organic / unattributed proceeds."}
        </p>
      </div>

      <div className="mt-5 overflow-x-auto">
        <table className="w-full min-w-[1480px] border-separate border-spacing-0 text-left text-sm">
          <thead>
            <tr className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
              <th className="w-10 border-b border-white/[0.08] px-3 py-3 font-medium" />
              <th className="border-b border-white/[0.08] px-3 py-3 font-medium">
                Day
              </th>
              <th className="border-b border-white/[0.08] px-3 py-3 text-right font-medium">
                <LabelWithTip
                  label={isBlazie ? "UGC and faceless proceeds" : "UGC/F proceeds"}
                  tip="Revenue organic / unattributed proceeds after renewals and paid-source attribution. Superwall proceeds and Singular paid-source proceeds can refresh on different upstream schedules."
                />
              </th>
              <th className="border-b border-white/[0.08] px-3 py-3 text-right font-medium">
                <LabelWithTip
                  label="Spend"
                  tip="UGC Pay plus UGC management plus ViewsBase faceless base and management spend."
                />
              </th>
              <th className="border-b border-white/[0.08] px-3 py-3 text-right font-medium">
                <LabelWithTip
                  label="UGC costs"
                  tip="UGC Pay plus the prorated UGC manager cost for the selected UTC report date."
                />
              </th>
              <th className="border-b border-white/[0.08] px-3 py-3 text-right font-medium">
                <LabelWithTip
                  label="UGC mgmt"
                  tip="UGC manager cost prorated by calendar day."
                />
              </th>
              <th className="border-b border-white/[0.08] px-3 py-3 text-right font-medium">
                <LabelWithTip
                  label="UGC fixed"
                  tip="Deal fixed fees plus per-video fixed fees from UGC Pay. Deal fixed fees appear on their configured fixed-fee date; per-video fixed fees appear on eligible posted videos."
                />
              </th>
              <th className="border-b border-white/[0.08] px-3 py-3 text-right font-medium">
                <LabelWithTip
                  label="UGC CPM"
                  tip="CPM pay from payable views after paid-view deductions and caps. Payable views can change when View Tally or paid-view deduction data updates."
                />
              </th>
              <th className="border-b border-white/[0.08] px-3 py-3 text-right font-medium">
                <LabelWithTip
                  label="Faceless spend"
                  tip="ViewsBase faceless base spend plus faceless management fees."
                />
              </th>
              <th className="border-b border-white/[0.08] px-3 py-3 text-right font-medium">
                <LabelWithTip
                  label="Faceless mgmt"
                  tip="ViewsBase CPM, fixed, and dashboard management fees for that day."
                />
              </th>
              <th className="border-b border-white/[0.08] px-3 py-3 text-right font-medium">
                Profit
              </th>
              <th className="border-b border-white/[0.08] px-3 py-3 text-right font-medium">
                <LabelWithTip
                  label="Views"
                  tip="Combined UGC payable views and ViewsBase faceless views. These sources can update after the report date."
                />
              </th>
              <th className="border-b border-white/[0.08] px-3 py-3 text-right font-medium">
                <LabelWithTip
                  label="UGC views"
                  tip="UGC Pay payable views after the selected view window, paid traffic deduction, and view cap rules."
                />
              </th>
              <th className="border-b border-white/[0.08] px-3 py-3 text-right font-medium">
                <LabelWithTip
                  label="Faceless views"
                  tip="ViewsBase paid views for the faceless bucket. Upstream rows may arrive later than Revenue or UGC Pay data."
                />
              </th>
              <th className="border-b border-white/[0.08] px-3 py-3 text-right font-medium">
                ROAS
              </th>
              <th className="border-b border-white/[0.08] px-3 py-3 text-right font-medium">
                Margin
              </th>
              <th className="border-b border-white/[0.08] px-3 py-3 text-right font-medium">
                Profit / 1K views
              </th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row) => {
              const isExpanded = expandedDates.includes(row.date);

              return (
                <Fragment key={row.date}>
                  <tr className="text-foreground">
                    <td className="border-b border-white/[0.06] px-3 py-3">
                      <button
                        aria-expanded={isExpanded}
                        aria-label={`Toggle ${formatDate(row.date)} video breakdown`}
                        className="flex h-7 w-7 items-center justify-center rounded-full border border-white/[0.08] bg-white/[0.03] text-muted-foreground transition hover:border-white/[0.18] hover:text-foreground"
                        onClick={() => {
                          setExpandedDates((current) =>
                            getNextExpandedUgcStatusDates(current, row.date),
                          );

                          if (!isExpanded) {
                            loadTopVideos(row.date);
                          }
                        }}
                        type="button"
                      >
                        <DashboardIcon
                          className="h-3.5 w-3.5"
                          name={isExpanded ? "chevronDown" : "chevronRight"}
                        />
                      </button>
                    </td>
                    <td className="border-b border-white/[0.06] px-3 py-3">
                      {formatDate(row.date)}
                    </td>
                    <td className="border-b border-white/[0.06] px-3 py-3 text-right font-medium">
                      {proceedsPending
                        ? "Pending"
                        : formatOptionalAmount(row.proceeds, data.currency)}
                    </td>
                    <td className="border-b border-white/[0.06] px-3 py-3 text-right">
                      {formatAmount(row.spend, data.currency)}
                    </td>
                    <td className="border-b border-white/[0.06] px-3 py-3 text-right text-muted-foreground">
                      {formatAmount(row.ugcSpend, data.currency)}
                    </td>
                    <td className="border-b border-white/[0.06] px-3 py-3 text-right text-muted-foreground">
                      {formatAmount(row.ugcManagementSpend, data.currency)}
                    </td>
                    <td className="border-b border-white/[0.06] px-3 py-3 text-right text-muted-foreground">
                      {formatAmount(row.ugcFixedSpend, data.currency)}
                    </td>
                    <td className="border-b border-white/[0.06] px-3 py-3 text-right text-muted-foreground">
                      {formatAmount(row.ugcCpmSpend, data.currency)}
                    </td>
                    <td className="border-b border-white/[0.06] px-3 py-3 text-right text-muted-foreground">
                      {formatAmount(row.facelessSpend, data.currency)}
                    </td>
                    <td className="border-b border-white/[0.06] px-3 py-3 text-right text-muted-foreground">
                      {formatAmount(row.facelessManagementSpend, data.currency)}
                    </td>
                    <td className="border-b border-white/[0.06] px-3 py-3 text-right">
                      {proceedsPending
                        ? "Pending"
                        : formatOptionalSignedAmount(row.profit, data.currency)}
                    </td>
                    <td className="border-b border-white/[0.06] px-3 py-3 text-right">
                      {formatViews(row.views)}
                    </td>
                    <td className="border-b border-white/[0.06] px-3 py-3 text-right text-muted-foreground">
                      {formatViews(row.ugcViews)}
                    </td>
                    <td className="border-b border-white/[0.06] px-3 py-3 text-right text-muted-foreground">
                      {formatViews(row.facelessViews)}
                    </td>
                    <td className="border-b border-white/[0.06] px-3 py-3 text-right">
                      {proceedsPending ? "Pending" : formatRatio(row.roas)}
                    </td>
                    <td className="border-b border-white/[0.06] px-3 py-3 text-right">
                      {proceedsPending ? "Pending" : formatPercent(row.margin)}
                    </td>
                    <td className="border-b border-white/[0.06] px-3 py-3 text-right">
                      {proceedsPending
                        ? "Pending"
                        : row.profitPerThousandViews === null
                        ? "Unavailable"
                        : formatSignedAmount(row.profitPerThousandViews, data.currency)}
                    </td>
                  </tr>
                  {isExpanded ? (
                    <tr>
                      <td
                        className="border-b border-white/[0.06] px-3 py-4"
                        colSpan={17}
                      >
                        <TopVideosPanel
                          currency={data.currency}
                          state={topVideoStates[row.date]}
                        />
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function getSpendPerThousandViews(spend: number, views: number) {
  return views > 0 ? (spend / views) * 1_000 : null;
}

function SpendBreakdownTable({
  data,
  variant = "default",
}: {
  data: UgcStatusData;
  variant?: UgcStatusViewVariant;
}) {
  const isBlazie = variant === "blazie";
  const rows = [
    {
      bucket: "UGC",
      label: "UGC fixed fees",
      share: data.summary.spend > 0 ? data.summary.ugcFixedSpend / data.summary.spend : null,
      spend: data.summary.ugcFixedSpend,
      spendPerThousandViews: getSpendPerThousandViews(
        data.summary.ugcFixedSpend,
        data.summary.ugcViews,
      ),
      tip: "Deal fixed fees plus per-video fixed fees from UGC Pay. Deal fixed fees appear on their configured fixed-fee date; per-video fixed fees appear on eligible posted videos.",
      views: data.summary.ugcViews,
    },
    {
      bucket: "UGC",
      label: "UGC CPM pay",
      share: data.summary.spend > 0 ? data.summary.ugcCpmSpend / data.summary.spend : null,
      spend: data.summary.ugcCpmSpend,
      spendPerThousandViews: getSpendPerThousandViews(
        data.summary.ugcCpmSpend,
        data.summary.ugcViews,
      ),
      tip: "CPM UGC Pay from payable views. This can change when View Tally or paid-view deduction data refreshes.",
      views: data.summary.ugcViews,
    },
    {
      bucket: "UGC",
      label: "UGC management",
      share:
        data.summary.spend > 0
          ? data.summary.ugcManagementSpend / data.summary.spend
          : null,
      spend: data.summary.ugcManagementSpend,
      spendPerThousandViews: getSpendPerThousandViews(
        data.summary.ugcManagementSpend,
        data.summary.ugcViews,
      ),
      tip: "UGC manager cost prorated by calendar day for the selected range.",
      views: data.summary.ugcViews,
    },
    {
      bucket: "Faceless",
      label: "Faceless spend",
      share:
        data.summary.spend > 0
          ? data.summary.facelessBaseSpend / data.summary.spend
          : null,
      spend: data.summary.facelessBaseSpend,
      spendPerThousandViews: getSpendPerThousandViews(
        data.summary.facelessBaseSpend,
        data.summary.facelessViews,
      ),
      tip: "Direct faceless spend before management fees. Actual spend is used when available; otherwise the report uses projected spend.",
      views: data.summary.facelessViews,
    },
    {
      bucket: "Faceless",
      label: "Faceless management",
      share:
        data.summary.spend > 0
          ? data.summary.facelessManagementSpend / data.summary.spend
          : null,
      spend: data.summary.facelessManagementSpend,
      spendPerThousandViews: getSpendPerThousandViews(
        data.summary.facelessManagementSpend,
        data.summary.facelessViews,
      ),
      tip: "ViewsBase CPM, fixed, and dashboard management fees.",
      views: data.summary.facelessViews,
    },
  ];

  return (
    <section className="rounded-[1.55rem] border border-white/[0.08] bg-white/[0.03] p-5 shadow-[0_24px_70px_rgba(0,0,0,0.2)] backdrop-blur">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.28em] text-muted-foreground">
            Spend breakdown
          </p>
          <h2 className="mt-2 text-xl font-medium tracking-[-0.04em] text-foreground">
            UGC and faceless spend sources
          </h2>
        </div>
        <p className="text-sm text-muted-foreground">
          {formatAmount(data.summary.spend, data.currency)} total{" "}
          {isBlazie ? "UGC and faceless" : "UGC/F"} spend
        </p>
      </div>

      <div className="mt-5 overflow-x-auto">
        <table className="w-full min-w-[760px] border-separate border-spacing-0 text-left text-sm">
          <thead>
            <tr className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
              <th className="border-b border-white/[0.08] px-3 py-3 font-medium">
                Segment
              </th>
              <th className="border-b border-white/[0.08] px-3 py-3 font-medium">
                Bucket
              </th>
              <th className="border-b border-white/[0.08] px-3 py-3 text-right font-medium">
                <LabelWithTip
                  label="Spend"
                  tip="Spend timing depends on the source row: UGC Pay is recalculated from view and deal inputs; ViewsBase can switch from projected to actual spend."
                />
              </th>
              <th className="border-b border-white/[0.08] px-3 py-3 text-right font-medium">
                Share
              </th>
              <th className="border-b border-white/[0.08] px-3 py-3 text-right font-medium">
                <LabelWithTip
                  label="Views"
                  tip="Views come from UGC Pay or ViewsBase and may update independently of spend and Revenue proceeds."
                />
              </th>
              <th className="border-b border-white/[0.08] px-3 py-3 text-right font-medium">
                Spend / 1K views
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr className="text-foreground" key={row.label}>
                <td className="border-b border-white/[0.06] px-3 py-3">
                  <span className="inline-flex items-center gap-2">
                    <span>{row.label}</span>
                    <InfoTip label={row.label} tip={row.tip} />
                  </span>
                </td>
                <td className="border-b border-white/[0.06] px-3 py-3">
                  <span className="inline-flex rounded-full border border-white/[0.08] bg-black/[0.2] px-2.5 py-1 text-[0.62rem] uppercase tracking-[0.16em] text-muted-foreground">
                    {row.bucket}
                  </span>
                </td>
                <td className="border-b border-white/[0.06] px-3 py-3 text-right font-medium">
                  {formatAmount(row.spend, data.currency)}
                </td>
                <td className="border-b border-white/[0.06] px-3 py-3 text-right text-muted-foreground">
                  {formatPercent(row.share)}
                </td>
                <td className="border-b border-white/[0.06] px-3 py-3 text-right text-muted-foreground">
                  {formatViews(row.views)}
                </td>
                <td className="border-b border-white/[0.06] px-3 py-3 text-right text-muted-foreground">
                  {row.spendPerThousandViews === null
                    ? "Unavailable"
                    : formatAmount(row.spendPerThousandViews, data.currency)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function UgcStatusContent({
  data,
  organizationSlug,
  variant = "default",
  searchParams,
}: {
  data: UgcStatusData;
  organizationSlug: string;
  variant?: UgcStatusViewVariant;
  searchParams: DashboardSearchParams;
}) {
  const isBlazie = variant === "blazie";
  const bucketLabel = isBlazie ? "UGC and faceless" : "UGC/F";
  const [detailsOpen, setDetailsOpen] = useState(() =>
    getInitialDetailedStatisticsOpen(variant),
  );
  const proceedsPending = isBlazie && hasPendingOrganicProceeds(data);

  const ratioStatistics = (
    <>
      <section className="rounded-[1.55rem] border border-white/[0.08] bg-white/[0.03] p-5 shadow-[0_24px_70px_rgba(0,0,0,0.2)] backdrop-blur">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.28em] text-muted-foreground">
              Ratios
            </p>
            <h2 className="mt-2 text-xl font-medium tracking-[-0.04em] text-foreground">
              Efficiency of the UGC and faceless bucket
            </h2>
          </div>
          <p className="text-sm text-muted-foreground">
            {formatViews(data.summary.views)} combined payable / paid views
          </p>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <RatioCard
            detail={`${bucketLabel} proceeds divided by ${bucketLabel} spend`}
            label="ROAS"
            value={proceedsPending ? "Pending" : formatRatio(data.summary.roas)}
          />
          <RatioCard
            detail={`${bucketLabel} profit divided by ${bucketLabel} proceeds`}
            label="Margin"
            value={proceedsPending ? "Pending" : formatPercent(data.summary.margin)}
          />
          <RatioCard
            detail="Proceeds normalized to combined views"
            label="Proceeds / 1K views"
            value={
              proceedsPending
                ? "Pending"
                : data.summary.proceedsPerThousandViews === null
                ? "Unavailable"
                : formatAmount(data.summary.proceedsPerThousandViews, data.currency)
            }
          />
          <RatioCard
            detail="Profit normalized to combined views"
            label="Profit / 1K views"
            value={
              proceedsPending
                ? "Pending"
                : data.summary.profitPerThousandViews === null
                ? "Unavailable"
                : formatSignedAmount(data.summary.profitPerThousandViews, data.currency)
            }
          />
          <RatioCard
            detail="Spend normalized to combined views"
            label="Spend / 1K views"
            value={
              data.summary.spendPerThousandViews === null
                ? "Unavailable"
                : formatAmount(data.summary.spendPerThousandViews, data.currency)
            }
          />
          <RatioCard
            detail="UGC Pay payable view share"
            label="UGC view mix"
            value={formatPercent(data.summary.ugcViewShare)}
          />
          <RatioCard
            detail="ViewsBase paid view share"
            label="Faceless view mix"
            value={formatPercent(data.summary.facelessViewShare)}
          />
          <RatioCard
            detail="Proceeds minus spend"
            label="Net"
            value={
              proceedsPending
                ? "Pending"
                : formatSignedAmount(data.summary.profit, data.currency)
            }
          />
        </div>
      </section>

      <SpendBreakdownTable data={data} variant={variant} />
    </>
  );
  const dailyStatusTable = (
    <UgcStatusTable
      data={data}
      organizationSlug={organizationSlug}
      variant={variant}
      searchParams={searchParams}
    />
  );
  const blazieDetailMetrics = (
    <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      <StatCard
        icon="payouts"
        label="Profit / 1K views"
        meta={`${formatViews(data.summary.views)} combined views`}
        tip="UGC and faceless profit normalized to combined UGC Pay payable views and ViewsBase paid views."
        value={
          proceedsPending
            ? "Pending"
            : data.summary.profitPerThousandViews === null
            ? "Unavailable"
            : formatSignedAmount(data.summary.profitPerThousandViews, data.currency)
        }
      />
      <StatCard
        icon="payouts"
        label={`${bucketLabel} profit`}
        meta={
          proceedsPending
            ? "Waiting on attributed proceeds"
            : `${bucketLabel} proceeds minus UGC and faceless costs`
        }
        tip="Profit changes whenever Revenue proceeds, paid-source attribution, UGC Pay, or ViewsBase faceless spend refreshes upstream."
        value={
          proceedsPending
            ? "Pending"
            : formatSignedAmount(data.summary.profit, data.currency)
        }
      />
      <StatCard
        icon="videos"
        label="Faceless views"
        meta="ViewsBase paid views"
        tip="ViewsBase paid views for the selected range. These can update independently from Revenue and UGC Pay."
        value={formatViews(data.summary.facelessViews)}
      />
    </section>
  );

  return (
    <>
      {isBlazie ? (
        <BlazieMetricsSummary
          data={data}
          endDate={data.endDate}
          startDate={data.startDate}
        />
      ) : null}
      {isBlazie ? null : <WarningPanel data={data} variant={variant} />}

      {isBlazie ? (
        <>
          <section className="rounded-[1.35rem] border border-white/[0.08] bg-white/[0.03] p-2.5 shadow-[0_24px_70px_rgba(0,0,0,0.18)] backdrop-blur sm:p-3">
            <button
              aria-expanded={detailsOpen}
              className="flex min-h-12 w-full items-center justify-between gap-3 rounded-[1.05rem] px-2.5 text-left outline-none transition hover:bg-white/[0.04] focus-visible:bg-white/[0.05] sm:px-3"
              onClick={() => setDetailsOpen((isOpen) => !isOpen)}
              type="button"
            >
              <span className="min-w-0">
                <span className="block text-sm font-medium text-foreground">
                  {detailsOpen
                    ? "Hide detailed statistics"
                    : "View detailed statistics"}
                </span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  Extra ratios and source breakdowns
                </span>
              </span>
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-[0.8rem] border border-white/[0.08] bg-black/[0.22] text-muted-foreground">
                <DashboardIcon
                  className={`h-4 w-4 transition ${detailsOpen ? "rotate-180" : ""}`}
                  name="chevronDown"
                />
              </span>
            </button>
          </section>

          {detailsOpen ? (
            <>
              {blazieDetailMetrics}
              {ratioStatistics}
            </>
          ) : null}

          {dailyStatusTable}
        </>
      ) : (
        <>
          <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            <StatCard
              icon="revenue"
              label={`${bucketLabel} proceeds`}
              meta="Revenue organic / unattributed proceeds"
              tip="Uses the same organic / unattributed proceeds bucket from Revenue after renewals and paid-source attribution. Superwall and Singular can each update at different times."
              value={formatAmount(data.summary.proceeds, data.currency)}
            />
            <StatCard
              icon="integrations"
              label={`${bucketLabel} spend`}
              meta={`${formatAmount(data.summary.ugcSpend, data.currency)} UGC + ${formatAmount(data.summary.facelessSpend, data.currency)} faceless`}
              tip="Combines UGC Pay, UGC management, ViewsBase faceless base spend, and faceless management. View, paid-deduction, and faceless spend sources may refresh after the report date."
              value={formatAmount(data.summary.spend, data.currency)}
            />
            <StatCard
              icon="payouts"
              label={`${bucketLabel} profit`}
              meta={`${bucketLabel} proceeds minus UGC and faceless costs`}
              tip="Profit changes whenever Revenue proceeds, paid-source attribution, UGC Pay, or ViewsBase faceless spend refreshes upstream."
              value={formatSignedAmount(data.summary.profit, data.currency)}
            />
            <StatCard
              icon="videos"
              label="UGC views"
              meta="UGC Pay payable views"
              tip="Payable views after report window rules, paid-view deductions, and caps. View Tally and TikTok paid data can lag."
              value={formatViews(data.summary.ugcViews)}
            />
            <StatCard
              icon="videos"
              label="Faceless views"
              meta="ViewsBase paid views"
              tip="ViewsBase paid views for the selected range. These can update independently from Revenue and UGC Pay."
              value={formatViews(data.summary.facelessViews)}
            />
          </section>
          {ratioStatistics}
          {dailyStatusTable}
        </>
      )}
    </>
  );
}

export function UgcStatusClient({
  endDate,
  initialData = null,
  organizationSlug,
  variant = "default",
  searchParams,
  startDate,
}: UgcStatusClientProps) {
  const searchParamsKey = useMemo(
    () => JSON.stringify(searchParams),
    [searchParams],
  );
  const statusUrl = useMemo(() => {
    const params = new URLSearchParams();
    appendSearchParams(params, searchParams);
    params.set("startDate", startDate);
    params.set("endDate", endDate);

    return `/api/org/${encodeURIComponent(organizationSlug)}/ugc-status?${params.toString()}`;
  }, [endDate, organizationSlug, searchParams, searchParamsKey, startDate]);
  const [state, setState] = useState<LoadState>(() =>
    initialData
      ? {
          data: initialData,
          error: null,
          status: "ready",
          url: statusUrl,
        }
      : {
          data: null,
          error: null,
          status: "loading",
          url: null,
        },
  );
  const loadStatus = useCallback(
    async (signal?: AbortSignal) => {
      const response = await fetch(statusUrl, {
        cache: "no-store",
        headers: {
          Accept: "application/json",
        },
        signal,
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(
          typeof payload?.error === "string"
            ? payload.error
            : "Could not load UGC status data right now.",
        );
      }

      return payload as UgcStatusData;
    },
    [statusUrl],
  );

  useEffect(() => {
    if (state.url === statusUrl) {
      return;
    }

    const controller = new AbortController();

    setState({
      data: null,
      error: null,
      status: "loading",
      url: statusUrl,
    });

    loadStatus(controller.signal)
      .then((data) => {
        setState({
          data,
          error: null,
          status: "ready",
          url: statusUrl,
        });
      })
      .catch((error) => {
        if (controller.signal.aborted) {
          return;
        }

        setState({
          data: null,
          error:
            error instanceof Error
              ? error.message
              : "Could not load UGC status data right now.",
          status: "error",
          url: statusUrl,
        });
      });

    return () => {
      controller.abort();
    };
  }, [loadStatus, state.url, statusUrl]);

  useEffect(() => {
    if (
      variant !== "blazie" ||
      state.status !== "ready" ||
      !hasPendingOrganicProceeds(state.data)
    ) {
      return;
    }

    const controller = new AbortController();
    let isCancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    async function poll() {
      if (document.visibilityState !== "visible") {
        timeoutId = setTimeout(poll, UGC_STATUS_PENDING_REFRESH_MS);
        return;
      }

      try {
        const data = await loadStatus(controller.signal);

        if (isCancelled) {
          return;
        }

        setState({
          data,
          error: null,
          status: "ready",
          url: statusUrl,
        });

        if (hasPendingOrganicProceeds(data)) {
          timeoutId = setTimeout(poll, UGC_STATUS_PENDING_REFRESH_MS);
        }
      } catch (error) {
        if (!isCancelled && !controller.signal.aborted) {
          timeoutId = setTimeout(poll, UGC_STATUS_PENDING_REFRESH_MS);
        }
      }
    }

    timeoutId = setTimeout(poll, UGC_STATUS_PENDING_REFRESH_MS);

    return () => {
      isCancelled = true;
      controller.abort();

      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [loadStatus, state, variant]);

  return (
    <div className="space-y-4">
      <HeaderAndControls
        data={state.data}
        endDate={endDate}
        organizationSlug={organizationSlug}
        startDate={startDate}
        variant={variant}
      />

      {state.status === "ready" ? (
        <UgcStatusContent
          data={state.data}
          organizationSlug={organizationSlug}
          variant={variant}
          searchParams={searchParams}
        />
      ) : null}

      {state.status === "error" ? (
        <section className="rounded-[1.55rem] border border-[#FFD24D]/20 bg-[#FFD24D]/[0.08] p-5 text-sm leading-6 text-[#FFEAB1]">
          {variant === "blazie" ? "This view" : "UGC status"} could not be loaded: {state.error}
        </section>
      ) : null}

      {state.status === "loading" ? (
        variant === "blazie" ? (
          <BlazieMetricsSkeleton />
        ) : (
          <UgcStatusSkeleton />
        )
      ) : null}
    </div>
  );
}
