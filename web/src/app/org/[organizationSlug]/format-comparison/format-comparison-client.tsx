"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { DashboardIcon } from "@/components/org-dashboard/org-icons";
import { type DashboardSearchParams } from "@/server/dashboard/filters";
import { type FormatComparisonData } from "@/server/dashboard/format-comparison";
import {
  calculateFormatComparison,
  normalizeFormatTag,
  type FormatComparisonSourceDay,
} from "@/server/dashboard/format-comparison-calculations";

type FormatComparisonClientProps = {
  data: FormatComparisonData;
  endDate: string;
  organizationSlug: string;
  searchParams: DashboardSearchParams;
  startDate: string;
};

type FormatSaveState =
  | {
      message: string | null;
      status: "error" | "idle" | "saved" | "saving";
    }
  | undefined;

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
const compactFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 1,
  notation: "compact",
});
const dateFormatter = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});
const currencyFormatterCache = new Map<string, Intl.NumberFormat>();
const DAILY_VIDEO_CARD_LIMIT = 7;
const NEW_FORMAT_OPTION_VALUE = "__new_format__";
const transientSearchParams = new Set(["error", "notice", "revenueModel"]);

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

function formatOptionalAmount(value: number | null, currency: string | null) {
  return value === null ? "Unavailable" : formatAmount(value, currency);
}

function formatViews(value: number) {
  return integerFormatter.format(value);
}

function formatCompactViews(value: number) {
  return compactFormatter.format(value);
}

function formatPercent(value: number | null) {
  return value === null ? "Unavailable" : percentFormatter.format(value);
}

function formatRpm(value: number | null, currency: string | null) {
  return value === null ? "Unavailable" : formatAmount(value, currency);
}

function getViewShare(views: number, totalViews: number) {
  return totalViews > 0 ? views / totalViews : null;
}

function formatDate(value: string) {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? value : dateFormatter.format(parsed);
}

function updateDataFormatTag(
  data: FormatComparisonData,
  sourceVideoId: string,
  formatTag: string | null,
): FormatComparisonData {
  const normalizedTag = normalizeFormatTag(formatTag);
  const sourceDays: FormatComparisonSourceDay[] = data.dailyRows.map((day) => ({
    date: day.date,
    revenue: day.revenue,
    videos: day.rows.map((row) => ({
      creatorName: row.creatorName,
      date: row.date,
      formatTag:
        row.sourceVideoId === sourceVideoId
          ? normalizedTag
          : normalizeFormatTag(row.formatTag),
      id: row.id,
      sourceVideoId: row.sourceVideoId,
      thumbnailUrl: row.thumbnailUrl,
      title: row.title,
      url: row.url,
      views: row.views,
    })),
  }));
  const result = calculateFormatComparison(sourceDays);
  const formatOptions = [
    ...new Set(
      [
        normalizedTag,
        ...data.formatOptions,
        ...result.videoRows.map((row) => normalizeFormatTag(row.formatTag)),
      ].filter((value): value is string => Boolean(value)),
    ),
  ].sort((left, right) => left.localeCompare(right));

  return {
    ...data,
    ...result,
    formatOptions,
  };
}

function HiddenSearchInputs({
  searchParams,
}: {
  searchParams: DashboardSearchParams;
}) {
  return (
    <>
      {Object.entries(searchParams).flatMap(([key, value]) => {
        if (key === "startDate" || key === "endDate" || transientSearchParams.has(key)) {
          return [];
        }

        const values = Array.isArray(value) ? value : [value];

        return values
          .filter((entry): entry is string => entry !== undefined)
          .map((entry, index) => (
            <input
              key={`${key}-${index}-${entry}`}
              name={key}
              type="hidden"
              value={entry}
            />
          ));
      })}
    </>
  );
}

function MetricCard({
  label,
  meta,
  value,
}: {
  label: string;
  meta: string;
  value: string;
}) {
  return (
    <article className="rounded-[1rem] border border-white/[0.08] bg-white/[0.035] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
      <p className="text-[0.65rem] uppercase tracking-[0.22em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-4 text-2xl font-semibold tracking-[-0.01em] text-foreground">
        {value}
      </p>
      <p className="mt-2 text-xs leading-5 text-muted-foreground">{meta}</p>
    </article>
  );
}

function FormatRanking({
  data,
}: {
  data: FormatComparisonData;
}) {
  return (
    <section className="rounded-[1.25rem] border border-white/[0.08] bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.018))] p-4 sm:p-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[0.62rem] uppercase tracking-[0.24em] text-muted-foreground">
            Answer
          </p>
          <h2 className="mt-2 text-base font-semibold text-foreground">
            Revenue / 1K views by format
          </h2>
        </div>
        <p className="text-xs text-muted-foreground">
          {data.selectedCampaignLabel ?? "All accessible UGC"}
        </p>
      </div>

      <div className="mt-5 overflow-x-auto">
        <table className="w-full min-w-[48rem] border-collapse text-sm">
          <thead>
            <tr className="border-b border-white/[0.08] text-left text-[0.62rem] uppercase tracking-[0.2em] text-muted-foreground">
              <th className="pb-3 pr-4 font-medium">Format</th>
              <th className="pb-3 px-4 text-right font-medium">Revenue / 1K</th>
              <th className="pb-3 px-4 text-right font-medium">Revenue</th>
              <th className="pb-3 px-4 text-right font-medium">Views</th>
              <th className="pb-3 px-4 text-right font-medium">Videos</th>
              <th className="pb-3 pl-4 text-right font-medium">Avg views/video</th>
            </tr>
          </thead>
          <tbody>
            {data.formatRows.map((row) => (
              <tr
                className="border-b border-white/[0.06] last:border-b-0"
                key={row.label}
              >
                <td className="py-3 pr-4">
                  <div className="flex items-center gap-2">
                    <span
                      className={
                        row.tagged
                          ? "inline-flex h-2.5 w-2.5 rounded-full bg-[#8AF064]"
                          : "inline-flex h-2.5 w-2.5 rounded-full bg-white/25"
                      }
                    />
                    <span className="font-medium text-foreground">{row.label}</span>
                  </div>
                </td>
                <td className="px-4 py-3 text-right font-semibold text-foreground">
                  {formatRpm(row.revenuePerThousandViews, data.currency)}
                </td>
                <td className="px-4 py-3 text-right text-muted-foreground">
                  {formatOptionalAmount(row.revenue, data.currency)}
                </td>
                <td className="px-4 py-3 text-right text-muted-foreground">
                  {formatViews(row.views)}
                </td>
                <td className="px-4 py-3 text-right text-muted-foreground">
                  {formatViews(row.uniqueVideoCount)}
                </td>
                <td className="py-3 pl-4 text-right text-muted-foreground">
                  {row.averageViewsPerVideo === null
                    ? "Unavailable"
                    : formatViews(row.averageViewsPerVideo)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function VideoCard({
  currency,
  formatOptions,
  onSave,
  row,
  saveState,
}: {
  currency: string | null;
  formatOptions: string[];
  onSave: (sourceVideoId: string, formatTag: string | null) => Promise<void>;
  row: FormatComparisonData["dailyRows"][number]["rows"][number];
  saveState: FormatSaveState;
}) {
  const saving = saveState?.status === "saving";
  const saved = saveState?.status === "saved";
  const failed = saveState?.status === "error";
  const selectOptions = useMemo(
    () =>
      [
        ...new Set(
          [
            normalizeFormatTag(row.formatTag),
            ...formatOptions.map((option) => normalizeFormatTag(option)),
          ].filter((value): value is string => Boolean(value)),
        ),
      ].sort((left, right) => left.localeCompare(right)),
    [formatOptions, row.formatTag],
  );

  return (
    <article className="min-w-0 rounded-[0.85rem] border border-white/[0.08] bg-white/[0.035] p-2.5 text-sm shadow-[inset_0_1px_0_rgba(255,255,255,0.025)]">
      <div className="relative overflow-hidden rounded-[0.6rem] border border-white/[0.08] bg-white/[0.04]">
        {row.thumbnailUrl ? (
          <img
            alt=""
            className="aspect-[4/5] w-full object-cover"
            loading="lazy"
            src={row.thumbnailUrl}
          />
        ) : (
          <span className="flex aspect-[4/5] w-full items-center justify-center text-[0.62rem] uppercase tracking-[0.16em] text-muted-foreground">
            Video
          </span>
        )}
        {row.url ? (
          <a
            aria-label={`Open ${row.title} in TikTok`}
            className="absolute right-2 top-2 z-[2] inline-flex h-7 w-7 items-center justify-center rounded-full bg-black/70 text-white shadow-[0_8px_20px_rgba(0,0,0,0.28)] transition hover:bg-black/85"
            href={row.url}
            rel="noreferrer"
            target="_blank"
          >
            <DashboardIcon className="h-3.5 w-3.5" name="externalLink" />
          </a>
        ) : null}
      </div>

      <div className="mt-3 min-w-0">
        {row.url ? (
          <a
            className="line-clamp-2 min-h-10 text-sm font-medium leading-5 text-foreground hover:text-white"
            href={row.url}
            rel="noreferrer"
            target="_blank"
          >
            {row.title}
          </a>
        ) : (
          <p className="line-clamp-2 min-h-10 text-sm font-medium leading-5 text-foreground">
            {row.title}
          </p>
        )}
        <p className="mt-1 truncate text-xs text-muted-foreground">
          {row.creatorName ?? "Unknown creator"}
        </p>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 border-t border-white/[0.06] pt-2 text-xs">
        <div>
          <p className="text-[0.58rem] uppercase tracking-[0.16em] text-muted-foreground">
            Views
          </p>
          <p className="mt-1 font-medium text-foreground">{formatViews(row.views)}</p>
        </div>
        <div className="text-right">
          <p className="text-[0.58rem] uppercase tracking-[0.16em] text-muted-foreground">
            Share
          </p>
          <p className="mt-1 font-medium text-foreground">
            {formatPercent(row.viewShare)}
          </p>
        </div>
        <div>
          <p className="text-[0.58rem] uppercase tracking-[0.16em] text-muted-foreground">
            Revenue
          </p>
          <p className="mt-1 font-medium text-foreground">
            {formatOptionalAmount(row.allocatedRevenue, currency)}
          </p>
        </div>
        <div className="text-right">
          <p className="text-[0.58rem] uppercase tracking-[0.16em] text-muted-foreground">
            Rev / 1K
          </p>
          <p className="mt-1 font-medium text-foreground">
            {formatRpm(row.revenuePerThousandViews, currency)}
          </p>
        </div>
      </div>

      <div className="mt-3">
        <div className="mb-1.5 flex items-center justify-between gap-3">
          <p className="text-[0.58rem] uppercase tracking-[0.16em] text-muted-foreground">
            Format
          </p>
          {saving || saved || failed ? (
            <p
              className={`text-[0.58rem] uppercase tracking-[0.16em] ${
                failed ? "text-red-200" : "text-muted-foreground"
              }`}
            >
              {saving ? "Saving" : failed ? "Error" : "Saved"}
            </p>
          ) : null}
        </div>
        <div className="relative">
          <select
            aria-label={`Format tag for ${row.title}`}
            className="h-9 w-full appearance-none rounded-[0.55rem] border border-white/[0.1] bg-black/25 px-3 pr-8 text-sm font-medium text-foreground outline-none transition hover:border-white/[0.18] focus:border-[#8AF064]/70"
            name="formatTag"
            onChange={(event) => {
              const selectedValue = event.target.value;

              if (selectedValue === NEW_FORMAT_OPTION_VALUE) {
                const nextFormat = window.prompt(
                  "New format name",
                  row.formatTag ?? "",
                );

                if (nextFormat === null) {
                  return;
                }

                void onSave(row.sourceVideoId, nextFormat);
                return;
              }

              void onSave(row.sourceVideoId, selectedValue || null);
            }}
            value={row.formatTag ?? ""}
          >
            <option value="">Untagged</option>
            {selectOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
            <option value={NEW_FORMAT_OPTION_VALUE}>New format...</option>
          </select>
          <DashboardIcon
            aria-hidden="true"
            className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
            name="chevronDown"
          />
        </div>
      </div>
      {saveState?.status === "error" && saveState.message ? (
        <p className="mt-2 text-xs text-red-200">{saveState.message}</p>
      ) : null}
    </article>
  );
}

function DailyRows({
  data,
  onSave,
  saveStates,
}: {
  data: FormatComparisonData;
  onSave: (sourceVideoId: string, formatTag: string | null) => Promise<void>;
  saveStates: Record<string, FormatSaveState>;
}) {
  const visibleRowsByDate = data.dailyRows.map((day) => {
    const totalVideoCount = day.rows.length;
    const visibleRows = day.rows.slice(0, DAILY_VIDEO_CARD_LIMIT);
    const visibleTaggedViews = visibleRows.reduce(
      (sum, row) => sum + (normalizeFormatTag(row.formatTag) ? row.views : 0),
      0,
    );
    const taggedViews = day.rows.reduce(
      (sum, row) => sum + (normalizeFormatTag(row.formatTag) ? row.views : 0),
      0,
    );

    return {
      ...day,
      hiddenTaggedViews: Math.max(taggedViews - visibleTaggedViews, 0),
      hiddenVideoCount: Math.max(totalVideoCount - visibleRows.length, 0),
      taggedViewShare: getViewShare(taggedViews, day.views),
      taggedViews,
      totalVideoCount,
      rows: visibleRows,
    };
  });

  return (
    <section className="space-y-5">
      <div>
        <p className="text-[0.62rem] uppercase tracking-[0.24em] text-muted-foreground">
          Daily rows
        </p>
        <h2 className="mt-2 text-base font-semibold text-foreground">
          UGC videos
        </h2>
      </div>

      {visibleRowsByDate.map((day) => (
        <article
          className="rounded-[1.25rem] border border-white/[0.08] bg-[linear-gradient(180deg,rgba(255,255,255,0.035),rgba(255,255,255,0.014))] p-4 sm:p-5"
          key={day.date}
        >
          <div className="flex flex-col gap-4 border-b border-white/[0.08] pb-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-[0.62rem] uppercase tracking-[0.22em] text-muted-foreground">
                {day.date}
              </p>
              <h3 className="mt-2 text-xl font-semibold text-foreground">
                {formatDate(day.date)}
              </h3>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
              <div className="text-left lg:text-right">
                <p className="text-[0.58rem] uppercase tracking-[0.16em] text-muted-foreground">
                  Revenue
                </p>
                <p className="mt-1 font-medium text-foreground">
                  {formatOptionalAmount(day.revenue, data.currency)}
                </p>
              </div>
              <div className="text-left lg:text-right">
                <p className="text-[0.58rem] uppercase tracking-[0.16em] text-muted-foreground">
                  Rev / 1K
                </p>
                <p className="mt-1 font-medium text-foreground">
                  {formatRpm(day.revenuePerThousandViews, data.currency)}
                </p>
              </div>
              <div className="text-left lg:text-right">
                <p className="text-[0.58rem] uppercase tracking-[0.16em] text-muted-foreground">
                  Views
                </p>
                <p className="mt-1 font-medium text-foreground">
                  {formatCompactViews(day.views)}
                </p>
              </div>
              <div className="text-left lg:text-right">
                <p className="text-[0.58rem] uppercase tracking-[0.16em] text-muted-foreground">
                  Tagged views
                </p>
                <p className="mt-1 font-medium text-foreground">
                  {formatPercent(day.taggedViewShare)}
                </p>
                <p className="mt-0.5 text-[0.65rem] text-muted-foreground">
                  {formatCompactViews(day.taggedViews)}
                </p>
              </div>
              <div className="text-left lg:text-right">
                <p className="text-[0.58rem] uppercase tracking-[0.16em] text-muted-foreground">
                  Videos
                </p>
                <p className="mt-1 font-medium text-foreground">
                  {formatViews(day.totalVideoCount)}
                </p>
                {day.hiddenVideoCount > 0 ? (
                  <p className="mt-0.5 text-[0.65rem] text-muted-foreground">
                    {formatViews(day.rows.length)} shown
                  </p>
                ) : null}
              </div>
            </div>
          </div>

          {day.hiddenVideoCount > 0 ? (
            <p className="mt-3 text-xs leading-5 text-muted-foreground">
              Showing top {formatViews(day.rows.length)} by views; daily totals
              include {formatViews(day.totalVideoCount)} videos
              {day.hiddenTaggedViews > 0
                ? `, including ${formatCompactViews(
                    day.hiddenTaggedViews,
                  )} tagged views below`
                : ""}
              .
            </p>
          ) : null}

          {day.rows.length > 0 ? (
            <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
              {day.rows.map((row) => (
                <VideoCard
                  currency={data.currency}
                  formatOptions={data.formatOptions}
                  key={row.id}
                  onSave={onSave}
                  row={row}
                  saveState={saveStates[row.sourceVideoId]}
                />
              ))}
            </div>
          ) : (
            <p className="mt-4 text-sm text-muted-foreground">
              No UGC video rows for this day.
            </p>
          )}
        </article>
      ))}
    </section>
  );
}

export function FormatComparisonClient({
  data: initialData,
  endDate,
  organizationSlug,
  searchParams,
  startDate,
}: FormatComparisonClientProps) {
  const router = useRouter();
  const [data, setData] = useState(initialData);
  const [saveStates, setSaveStates] = useState<Record<string, FormatSaveState>>({});
  const dataRef = useRef(initialData);
  const saveRequestIdsRef = useRef<Record<string, number>>({});
  const currentData = useMemo(() => data, [data]);
  const taggedViewShare = getViewShare(
    currentData.summary.taggedViews,
    currentData.summary.views,
  );
  const pendingWarning = currentData.isPending
    ? currentData.warnings.find((warning) =>
        warning.toLowerCase().includes("singular"),
      ) ??
      "Singular source proceeds are still preparing. Revenue metrics will fill in when the source split is ready."
    : null;
  const visibleWarnings = pendingWarning
    ? currentData.warnings.filter((warning) => warning !== pendingWarning)
    : currentData.warnings;

  useEffect(() => {
    setData(initialData);
    setSaveStates({});
  }, [initialData]);

  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  useEffect(() => {
    if (!currentData.isPending) {
      return;
    }

    const refreshInterval = window.setInterval(() => {
      router.refresh();
    }, 4_000);

    return () => {
      window.clearInterval(refreshInterval);
    };
  }, [currentData.isPending, router]);

  async function saveFormatTag(sourceVideoId: string, formatTag: string | null) {
    const normalizedTag = normalizeFormatTag(formatTag);
    const previousTag =
      dataRef.current.videoRows.find((row) => row.sourceVideoId === sourceVideoId)
        ?.formatTag ?? null;
    const requestId = (saveRequestIdsRef.current[sourceVideoId] ?? 0) + 1;
    saveRequestIdsRef.current[sourceVideoId] = requestId;

    setData((previousData) =>
      updateDataFormatTag(previousData, sourceVideoId, normalizedTag),
    );
    setSaveStates((states) => ({
      ...states,
      [sourceVideoId]: {
        message: null,
        status: "saving",
      },
    }));

    try {
      const response = await fetch(
        `/api/org/${encodeURIComponent(organizationSlug)}/format-comparison/tags`,
        {
          body: JSON.stringify({
            formatTag: normalizedTag,
            sourceVideoId,
          }),
          headers: {
            "Content-Type": "application/json",
          },
          method: "POST",
        },
      );
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        formatTag?: string | null;
      };

      if (!response.ok) {
        throw new Error(body.error ?? "Could not save this format tag.");
      }

      if (saveRequestIdsRef.current[sourceVideoId] !== requestId) {
        return;
      }

      const savedTag = normalizeFormatTag(body.formatTag ?? normalizedTag);
      setData((previousData) =>
        updateDataFormatTag(previousData, sourceVideoId, savedTag),
      );
      setSaveStates((states) => ({
        ...states,
        [sourceVideoId]: {
          message: null,
          status: "saved",
        },
      }));
      window.setTimeout(() => {
        if (saveRequestIdsRef.current[sourceVideoId] !== requestId) {
          return;
        }

        setSaveStates((states) => ({
          ...states,
          [sourceVideoId]: {
            message: null,
            status: "idle",
          },
        }));
      }, 1_500);
    } catch (error) {
      if (saveRequestIdsRef.current[sourceVideoId] !== requestId) {
        return;
      }

      setData((previousData) =>
        updateDataFormatTag(previousData, sourceVideoId, previousTag),
      );
      setSaveStates((states) => ({
        ...states,
        [sourceVideoId]: {
          message:
            error instanceof Error
              ? error.message
              : "Could not save this format tag.",
          status: "error",
        },
      }));
    }
  }

  return (
    <main className="space-y-6">
      <section className="rounded-[1.35rem] border border-white/[0.08] bg-[linear-gradient(180deg,rgba(255,255,255,0.045),rgba(255,255,255,0.02))] p-4 shadow-[0_18px_60px_rgba(0,0,0,0.24)] sm:p-5">
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-[0.62rem] uppercase tracking-[0.24em] text-muted-foreground">
                Format comparison
              </p>
              <h1 className="mt-2 text-2xl font-semibold tracking-[-0.01em] text-foreground">
                Compare manual video formats by revenue / 1K views
              </h1>
            </div>
            <div className="inline-flex items-center gap-2 text-xs text-muted-foreground">
              <DashboardIcon className="h-4 w-4" name="compare" />
              <span>
                {currentData.proceedsModelLabel} proceeds ·{" "}
                {currentData.selectedCampaignLabel ?? "All accessible UGC"}
              </span>
            </div>
          </div>

          <form
            action={`/org/${organizationSlug}/format-comparison`}
            className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]"
            method="get"
          >
            <HiddenSearchInputs searchParams={searchParams} />
            <input
              name="revenueModel"
              type="hidden"
              value={currentData.proceedsModel}
            />
            <label className="space-y-2">
              <span className="block text-[0.62rem] uppercase tracking-[0.22em] text-muted-foreground">
                Start date
              </span>
              <input
                className="h-12 w-full rounded-[0.8rem] border border-white/[0.08] bg-black/20 px-4 text-sm text-foreground outline-none transition focus:border-[#8AF064]/70"
                defaultValue={startDate}
                name="startDate"
                type="date"
              />
            </label>
            <label className="space-y-2">
              <span className="block text-[0.62rem] uppercase tracking-[0.22em] text-muted-foreground">
                End date
              </span>
              <input
                className="h-12 w-full rounded-[0.8rem] border border-white/[0.08] bg-black/20 px-4 text-sm text-foreground outline-none transition focus:border-[#8AF064]/70"
                defaultValue={endDate}
                name="endDate"
                type="date"
              />
            </label>
            <button
              className="inline-flex h-12 items-center justify-center gap-2 self-end rounded-[0.8rem] bg-[#8AF064] px-5 text-sm font-semibold text-black transition hover:bg-[#9cff77]"
              type="submit"
            >
              <DashboardIcon className="h-4 w-4" name="revenue" />
              Refresh
            </button>
          </form>
        </div>
      </section>

      {pendingWarning ? (
        <section className="rounded-[1rem] border border-[#8AF064]/25 bg-[#8AF064]/10 px-4 py-3 text-sm text-[#DDFDD0]">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <p className="font-medium text-foreground">Source proceeds pending</p>
            <p className="text-xs text-[#DDFDD0]/80">
              Auto-refreshing every 4 seconds
            </p>
          </div>
          <p className="mt-2 text-[#DDFDD0]/85">{pendingWarning}</p>
        </section>
      ) : null}

      {visibleWarnings.length > 0 ? (
        <section className="rounded-[1rem] border border-amber-400/25 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
          {visibleWarnings.map((warning) => (
            <p key={warning}>{warning}</p>
          ))}
        </section>
      ) : null}

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Revenue / 1K"
          meta="Across selected UGC rows"
          value={formatRpm(
            currentData.summary.revenuePerThousandViews,
            currentData.currency,
          )}
        />
        <MetricCard
          label="TikTok video revenue"
          meta={`Allocated from ${currentData.proceedsModelLabel.toLowerCase()} organic + TikTok paid proceeds`}
          value={formatOptionalAmount(
            currentData.summary.revenue,
            currentData.currency,
          )}
        />
        <MetricCard
          label="UGC views"
          meta={`${formatCompactViews(
            currentData.summary.taggedViews,
          )} tagged (${formatPercent(taggedViewShare)} of views)`}
          value={formatViews(currentData.summary.views)}
        />
        <MetricCard
          label="Tagged videos"
          meta={`${formatViews(currentData.summary.totalVideoCount)} total videos in range`}
          value={formatViews(currentData.summary.taggedVideoCount)}
        />
      </section>

      <FormatRanking data={currentData} />
      <DailyRows
        data={currentData}
        onSave={saveFormatTag}
        saveStates={saveStates}
      />
    </main>
  );
}
