"use client";

import Link from "next/link";
import { Fragment, useEffect, useMemo, useState } from "react";

import { DashboardIcon } from "@/components/org-dashboard/org-icons";
import { type DashboardSearchParams } from "@/server/dashboard/filters";
import {
  type UgcStatusData,
  type UgcStatusTopVideosData,
} from "@/server/dashboard/ugc-status";

type UgcStatusClientProps = {
  endDate: string;
  organizationSlug: string;
  searchParams: DashboardSearchParams;
  startDate: string;
};

type LoadState =
  | {
      data: UgcStatusData;
      error: null;
      status: "ready";
    }
  | {
      data: null;
      error: string | null;
      status: "error" | "loading";
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

function TopVideoList({
  currency,
  label,
  spendLabel,
  videos,
}: {
  currency: string | null;
  label: string;
  spendLabel: string;
  videos: UgcStatusTopVideosData["ugc"];
}) {
  return (
    <div className="rounded-[1rem] border border-white/[0.08] bg-black/20 p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-medium text-foreground">{label}</h3>
        <span className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
          Top {videos.length || 0}
        </span>
      </div>

      {videos.length > 0 ? (
        <div className="mt-3 divide-y divide-white/[0.06]">
          {videos.map((video, index) => (
            <div
              className="grid grid-cols-[2rem_minmax(0,1fr)_auto] gap-3 py-3 text-sm"
              key={video.id}
            >
              <div className="text-muted-foreground">{index + 1}</div>
              <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-2">
                  {video.url ? (
                    <a
                      className="truncate font-medium text-foreground hover:text-white"
                      href={video.url}
                      rel="noreferrer"
                      target="_blank"
                    >
                      {video.title}
                    </a>
                  ) : (
                    <p className="truncate font-medium text-foreground">
                      {video.title}
                    </p>
                  )}
                  {video.url ? (
                    <DashboardIcon
                      aria-hidden="true"
                      className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                      name="externalLink"
                    />
                  ) : null}
                </div>
                <p className="mt-1 truncate text-xs text-muted-foreground">
                  {video.creatorName ?? "Unknown creator"}
                </p>
              </div>
              <div className="text-right">
                <p className="font-medium text-foreground">
                  {formatViews(video.views)}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {video.spend === null
                    ? spendLabel
                    : `${formatAmount(video.spend, currency)} ${spendLabel}`}
                </p>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-4 text-sm text-muted-foreground">
          No video rows for this day.
        </p>
      )}
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
    <div className="grid gap-4 lg:grid-cols-2">
      {Array.from({ length: 2 }).map((_, index) => (
        <div
          className="rounded-[1rem] border border-white/[0.08] bg-black/20 p-4"
          key={index}
        >
          <SkeletonBlock className="h-4 w-36" />
          <div className="mt-4 space-y-3">
            {Array.from({ length: 5 }).map((__, itemIndex) => (
              <SkeletonBlock className="h-9 w-full" key={itemIndex} />
            ))}
          </div>
        </div>
      ))}
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
      <div className="grid gap-4 lg:grid-cols-2">
        <TopVideoList
          currency={currency}
          label="UGC videos by 30/7 gained views"
          spendLabel="paid"
          videos={topVideos.ugc}
        />
        <TopVideosUnavailable
          message={topVideos.facelessUnavailableReason}
          title="Faceless 30/7 gained views"
        />
      </div>
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
  icon: "payouts" | "integrations" | "creators" | "compare" | "videos" | "revenue";
  label: string;
  meta: string;
  value: string;
}) {
  return (
    <article className="rounded-[1.25rem] border border-white/[0.08] bg-white/[0.03] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">
          {args.label}
        </p>
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-[0.75rem] border border-white/[0.08] bg-black/[0.22] text-muted-foreground">
          <DashboardIcon className="h-4 w-4" name={args.icon} />
        </span>
      </div>
      <p className="mt-3 text-2xl font-medium tracking-[-0.045em] text-foreground">
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

function HeaderAndControls({
  data,
  endDate,
  organizationSlug,
  startDate,
}: {
  data: UgcStatusData | null;
  endDate: string;
  organizationSlug: string;
  startDate: string;
}) {
  return (
    <>
      <section className="rounded-[1.55rem] border border-white/[0.08] bg-white/[0.03] p-5 shadow-[0_24px_70px_rgba(0,0,0,0.2)] backdrop-blur">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl">
            <p className="text-xs uppercase tracking-[0.28em] text-muted-foreground">
              UGC status
            </p>
            <h1 className="mt-2 text-2xl font-medium tracking-[-0.045em] text-foreground">
              UGC and faceless proceeds against spend and views.
            </h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Proceeds are the same organic / UGC remainder used in Revenue after
              paid channels, Apple Search Ads, and renewal proceeds are removed.
              Spend comes from exact UGC Pay and ViewsBase faceless costs.
            </p>
          </div>

          <Link
            className="inline-flex min-h-11 items-center justify-center rounded-[0.95rem] border border-white/[0.12] bg-black/[0.24] px-4 text-sm font-medium text-foreground transition hover:border-white/[0.2]"
            href={`/org/${organizationSlug}/revenue?startDate=${startDate}&endDate=${endDate}`}
          >
            Open Revenue
          </Link>
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          <span className="rounded-full border border-white/[0.08] bg-black/[0.2] px-3 py-1.5 text-xs text-muted-foreground">
            {formatDate(startDate)} to {formatDate(endDate)}
          </span>
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
        </div>
      </section>

      <section className="rounded-[1.55rem] border border-white/[0.08] bg-white/[0.03] p-5 shadow-[0_24px_70px_rgba(0,0,0,0.2)] backdrop-blur">
        <p className="text-xs uppercase tracking-[0.28em] text-muted-foreground">
          Controls
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
              Refresh status
            </button>
          </div>
        </form>
      </section>
    </>
  );
}

function WarningPanel({ data }: { data: UgcStatusData }) {
  const warnings = [
    ...data.proceedsWarnings,
    ...(data.facelessErrorMessage
      ? [`ViewsBase faceless spend could not be loaded: ${data.facelessErrorMessage}`]
      : []),
  ];

  if (warnings.length === 0) {
    return null;
  }

  return (
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

function UgcStatusTable({
  data,
  organizationSlug,
  searchParams,
}: {
  data: UgcStatusData;
  organizationSlug: string;
  searchParams: DashboardSearchParams;
}) {
  const [expandedDate, setExpandedDate] = useState<string | null>(null);
  const [topVideoStates, setTopVideoStates] = useState<TopVideosByDate>({});
  const searchParamsKey = useMemo(
    () => JSON.stringify(searchParams),
    [searchParams],
  );

  useEffect(() => {
    setExpandedDate(null);
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
    params.set("limit", "5");

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
          Daily proceeds reconcile to the Revenue tab UGC/F total.
        </p>
      </div>

      <div className="mt-5 overflow-x-auto">
        <table className="w-full min-w-[1260px] border-separate border-spacing-0 text-left text-sm">
          <thead>
            <tr className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
              <th className="w-10 border-b border-white/[0.08] px-3 py-3 font-medium" />
              <th className="border-b border-white/[0.08] px-3 py-3 font-medium">
                Day
              </th>
              <th className="border-b border-white/[0.08] px-3 py-3 text-right font-medium">
                UGC/F proceeds
              </th>
              <th className="border-b border-white/[0.08] px-3 py-3 text-right font-medium">
                Spend
              </th>
              <th className="border-b border-white/[0.08] px-3 py-3 text-right font-medium">
                UGC spend
              </th>
              <th className="border-b border-white/[0.08] px-3 py-3 text-right font-medium">
                UGC fixed
              </th>
              <th className="border-b border-white/[0.08] px-3 py-3 text-right font-medium">
                UGC CPM/video
              </th>
              <th className="border-b border-white/[0.08] px-3 py-3 text-right font-medium">
                Faceless spend
              </th>
              <th className="border-b border-white/[0.08] px-3 py-3 text-right font-medium">
                Profit
              </th>
              <th className="border-b border-white/[0.08] px-3 py-3 text-right font-medium">
                Views
              </th>
              <th className="border-b border-white/[0.08] px-3 py-3 text-right font-medium">
                UGC views
              </th>
              <th className="border-b border-white/[0.08] px-3 py-3 text-right font-medium">
                Faceless views
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
              const isExpanded = expandedDate === row.date;

              return (
                <Fragment key={row.date}>
                  <tr className="text-foreground">
                    <td className="border-b border-white/[0.06] px-3 py-3">
                      <button
                        aria-expanded={isExpanded}
                        aria-label={`Toggle ${formatDate(row.date)} video breakdown`}
                        className="flex h-7 w-7 items-center justify-center rounded-full border border-white/[0.08] bg-white/[0.03] text-muted-foreground transition hover:border-white/[0.18] hover:text-foreground"
                        onClick={() => {
                          setExpandedDate(isExpanded ? null : row.date);

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
                      {formatAmount(row.proceeds, data.currency)}
                    </td>
                    <td className="border-b border-white/[0.06] px-3 py-3 text-right">
                      {formatAmount(row.spend, data.currency)}
                    </td>
                    <td className="border-b border-white/[0.06] px-3 py-3 text-right text-muted-foreground">
                      {formatAmount(row.ugcSpend, data.currency)}
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
                    <td className="border-b border-white/[0.06] px-3 py-3 text-right">
                      {formatSignedAmount(row.profit, data.currency)}
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
                      {formatRatio(row.roas)}
                    </td>
                    <td className="border-b border-white/[0.06] px-3 py-3 text-right">
                      {formatPercent(row.margin)}
                    </td>
                    <td className="border-b border-white/[0.06] px-3 py-3 text-right">
                      {row.profitPerThousandViews === null
                        ? "Unavailable"
                        : formatSignedAmount(row.profitPerThousandViews, data.currency)}
                    </td>
                  </tr>
                  {isExpanded ? (
                    <tr>
                      <td
                        className="border-b border-white/[0.06] px-3 py-4"
                        colSpan={15}
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

function SpendBreakdownTable({ data }: { data: UgcStatusData }) {
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
      views: data.summary.ugcViews,
    },
    {
      bucket: "UGC",
      label: "UGC CPM/video pay",
      share: data.summary.spend > 0 ? data.summary.ugcCpmSpend / data.summary.spend : null,
      spend: data.summary.ugcCpmSpend,
      spendPerThousandViews: getSpendPerThousandViews(
        data.summary.ugcCpmSpend,
        data.summary.ugcViews,
      ),
      views: data.summary.ugcViews,
    },
    {
      bucket: "UGC",
      label: "UGC Pay total",
      share: data.summary.spend > 0 ? data.summary.ugcSpend / data.summary.spend : null,
      spend: data.summary.ugcSpend,
      spendPerThousandViews: getSpendPerThousandViews(
        data.summary.ugcSpend,
        data.summary.ugcViews,
      ),
      views: data.summary.ugcViews,
    },
    {
      bucket: "Faceless",
      label: "ViewsBase faceless",
      share:
        data.summary.spend > 0
          ? data.summary.facelessSpend / data.summary.spend
          : null,
      spend: data.summary.facelessSpend,
      spendPerThousandViews: getSpendPerThousandViews(
        data.summary.facelessSpend,
        data.summary.facelessViews,
      ),
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
          {formatAmount(data.summary.spend, data.currency)} total UGC/F spend
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
                Spend
              </th>
              <th className="border-b border-white/[0.08] px-3 py-3 text-right font-medium">
                Share
              </th>
              <th className="border-b border-white/[0.08] px-3 py-3 text-right font-medium">
                Views
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
                  {row.label}
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
  searchParams,
}: {
  data: UgcStatusData;
  organizationSlug: string;
  searchParams: DashboardSearchParams;
}) {
  return (
    <>
      <WarningPanel data={data} />

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <StatCard
          icon="revenue"
          label="UGC/F proceeds"
          meta="Revenue tab organic / UGC proceeds after paid + renewals"
          value={formatAmount(data.summary.proceeds, data.currency)}
        />
        <StatCard
          icon="integrations"
          label="UGC/F spend"
          meta={`${formatAmount(data.summary.ugcSpend, data.currency)} UGC + ${formatAmount(data.summary.facelessSpend, data.currency)} faceless`}
          value={formatAmount(data.summary.spend, data.currency)}
        />
        <StatCard
          icon="payouts"
          label="UGC/F profit"
          meta="UGC/F proceeds minus UGC Pay and faceless spend"
          value={formatSignedAmount(data.summary.profit, data.currency)}
        />
        <StatCard
          icon="videos"
          label="UGC views"
          meta="UGC Pay payable views"
          value={formatViews(data.summary.ugcViews)}
        />
        <StatCard
          icon="videos"
          label="Faceless views"
          meta="ViewsBase paid views"
          value={formatViews(data.summary.facelessViews)}
        />
      </section>

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
            detail="UGC/F proceeds divided by UGC/F spend"
            label="ROAS"
            value={formatRatio(data.summary.roas)}
          />
          <RatioCard
            detail="UGC/F profit divided by UGC/F proceeds"
            label="Margin"
            value={formatPercent(data.summary.margin)}
          />
          <RatioCard
            detail="Proceeds normalized to combined views"
            label="Proceeds / 1K views"
            value={
              data.summary.proceedsPerThousandViews === null
                ? "Unavailable"
                : formatAmount(data.summary.proceedsPerThousandViews, data.currency)
            }
          />
          <RatioCard
            detail="Profit normalized to combined views"
            label="Profit / 1K views"
            value={
              data.summary.profitPerThousandViews === null
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
            value={formatSignedAmount(data.summary.profit, data.currency)}
          />
        </div>
      </section>

      <SpendBreakdownTable data={data} />
      <UgcStatusTable
        data={data}
        organizationSlug={organizationSlug}
        searchParams={searchParams}
      />
    </>
  );
}

export function UgcStatusClient({
  endDate,
  organizationSlug,
  searchParams,
  startDate,
}: UgcStatusClientProps) {
  const searchParamsKey = useMemo(
    () => JSON.stringify(searchParams),
    [searchParams],
  );
  const [state, setState] = useState<LoadState>({
    data: null,
    error: null,
    status: "loading",
  });

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams();
    appendSearchParams(params, searchParams);
    params.set("startDate", startDate);
    params.set("endDate", endDate);

    setState({
      data: null,
      error: null,
      status: "loading",
    });

    fetch(
      `/api/org/${encodeURIComponent(organizationSlug)}/ugc-status?${params.toString()}`,
      {
        headers: {
          Accept: "application/json",
        },
        signal: controller.signal,
      },
    )
      .then(async (response) => {
        const payload = await response.json();

        if (!response.ok) {
          throw new Error(
            typeof payload?.error === "string"
              ? payload.error
              : "Could not load UGC status data right now.",
          );
        }

        return payload as UgcStatusData;
      })
      .then((data) => {
        setState({
          data,
          error: null,
          status: "ready",
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
        });
      });

    return () => {
      controller.abort();
    };
  }, [endDate, organizationSlug, searchParams, searchParamsKey, startDate]);

  return (
    <div className="space-y-4">
      <HeaderAndControls
        data={state.data}
        endDate={endDate}
        organizationSlug={organizationSlug}
        startDate={startDate}
      />

      {state.status === "ready" ? (
        <UgcStatusContent
          data={state.data}
          organizationSlug={organizationSlug}
          searchParams={searchParams}
        />
      ) : null}

      {state.status === "error" ? (
        <section className="rounded-[1.55rem] border border-[#FFD24D]/20 bg-[#FFD24D]/[0.08] p-5 text-sm leading-6 text-[#FFEAB1]">
          UGC status could not be loaded: {state.error}
        </section>
      ) : null}

      {state.status === "loading" ? <UgcStatusSkeleton /> : null}
    </div>
  );
}
