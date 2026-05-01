"use client";

import { useEffect, useRef, useState } from "react";

import { DashboardIcon } from "@/components/org-dashboard/org-icons";
import type { ViewTallyAdSpendListItem } from "@/server/videos/queries";

type AdSpendPayload = {
  startDate: string;
  endDate: string;
  adSpend: {
    advertiserId: string | null;
    totalSpend: number;
    rowCount: number;
    rows: ViewTallyAdSpendListItem[];
    warnings: string[];
  };
};

type AdSpendCacheEntry = {
  payload: AdSpendPayload;
  expiresAt: number;
  staleAt: number;
};

const AD_SPEND_CLIENT_CACHE_TTL_MS = 60 * 1_000;
const AD_SPEND_CLIENT_STALE_TTL_MS = 15 * 60 * 1_000;
const AD_SPEND_TIMEOUT_RETRY_LIMIT = 2;
const AD_SPEND_TIMEOUT_RETRY_DELAY_MS = 5 * 1_000;
const AD_SPEND_SESSION_CACHE_PREFIX = "view-tally-ad-spend:";
const adSpendPayloadCache = new Map<string, AdSpendCacheEntry>();
const pendingAdSpendFetches = new Map<string, Promise<AdSpendPayload>>();

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});
const wholeNumberFormatter = new Intl.NumberFormat("en-US");
const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

function formatDateLabel(value: Date | string | null | undefined) {
  if (!value) {
    return "Unknown";
  }

  const parsedValue = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(parsedValue.getTime())) {
    return "Unknown";
  }

  return dateFormatter.format(parsedValue);
}

function formatMetricValue(value: number | null | undefined, fallback = "--") {
  if (typeof value !== "number") {
    return fallback;
  }

  return wholeNumberFormatter.format(value);
}

function formatCurrencyValue(value: number | null | undefined, fallback = "--") {
  if (typeof value !== "number") {
    return fallback;
  }

  return currencyFormatter.format(value);
}

function getAdSpendSessionCacheKey(apiPath: string) {
  return `${AD_SPEND_SESSION_CACHE_PREFIX}${apiPath}`;
}

function isAdSpendCacheEntry(value: unknown): value is AdSpendCacheEntry {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<AdSpendCacheEntry>;
  return (
    typeof candidate.expiresAt === "number" &&
    typeof candidate.staleAt === "number" &&
    Boolean(candidate.payload) &&
    typeof candidate.payload === "object"
  );
}

function adSpendPayloadTimedOut(payload: AdSpendPayload) {
  return payload.adSpend.warnings.some((warning) =>
    warning.toLowerCase().includes("timed out"),
  );
}

function readCachedAdSpendPayload(apiPath: string) {
  const now = Date.now();
  const memoryEntry = adSpendPayloadCache.get(apiPath);

  if (memoryEntry && memoryEntry.staleAt > now) {
    return memoryEntry;
  }

  if (memoryEntry) {
    adSpendPayloadCache.delete(apiPath);
  }

  if (typeof window === "undefined") {
    return null;
  }

  try {
    const rawEntry = window.sessionStorage.getItem(
      getAdSpendSessionCacheKey(apiPath),
    );

    if (!rawEntry) {
      return null;
    }

    const parsedEntry = JSON.parse(rawEntry) as unknown;

    if (!isAdSpendCacheEntry(parsedEntry) || parsedEntry.staleAt <= now) {
      window.sessionStorage.removeItem(getAdSpendSessionCacheKey(apiPath));
      return null;
    }

    adSpendPayloadCache.set(apiPath, parsedEntry);
    return parsedEntry;
  } catch {
    return null;
  }
}

function writeCachedAdSpendPayload(apiPath: string, payload: AdSpendPayload) {
  const now = Date.now();
  const needsRetry = adSpendPayloadTimedOut(payload);
  const entry: AdSpendCacheEntry = {
    payload,
    expiresAt: now + (needsRetry ? 0 : AD_SPEND_CLIENT_CACHE_TTL_MS),
    staleAt: now + AD_SPEND_CLIENT_STALE_TTL_MS,
  };

  adSpendPayloadCache.set(apiPath, entry);

  if (typeof window === "undefined") {
    return;
  }

  try {
    window.sessionStorage.setItem(
      getAdSpendSessionCacheKey(apiPath),
      JSON.stringify(entry),
    );
  } catch {
    // Storage can be disabled or full; the in-memory cache still helps SPA navigation.
  }
}

async function fetchAdSpendPayload(apiPath: string, forceRefresh: boolean) {
  const pendingKey = `${apiPath}::${forceRefresh ? "reload" : "default"}`;
  const pending = pendingAdSpendFetches.get(pendingKey);

  if (pending) {
    return pending;
  }

  const request = fetch(apiPath, {
    cache: forceRefresh ? "reload" : "default",
    headers: {
      Accept: "application/json",
    },
  })
    .then(async (response) => {
      const body = (await response.json()) as
        | AdSpendPayload
        | {
            error?: string;
          };

      if (!response.ok) {
        throw new Error(
          "error" in body && body.error
            ? body.error
            : "Could not load TikTok ad spend right now.",
        );
      }

      return body as AdSpendPayload;
    })
    .finally(() => {
      pendingAdSpendFetches.delete(pendingKey);
    });

  pendingAdSpendFetches.set(pendingKey, request);
  return request;
}

function truncateCopy(value: string, maxLength: number) {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}...` : value;
}

function getHandleLabel(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  return value.startsWith("@") ? value : `@${value}`;
}

function getBackgroundImageStyle(imageUrl: string) {
  return {
    backgroundImage: `url(${JSON.stringify(imageUrl)})`,
    backgroundPosition: "center",
    backgroundRepeat: "no-repeat",
    backgroundSize: "cover",
  } as const;
}

function getAdSpendMatchLabel(status: ViewTallyAdSpendListItem["matchStatus"]) {
  switch (status) {
    case "exact_report_item_id":
      return "Exact item_id match";
    case "exact_ad_metadata":
      return "Ad metadata match";
    case "matched_ad_id":
      return "Matched ad ID";
    default:
      return "No content match";
  }
}

function getAdSpendMatchClasses(status: ViewTallyAdSpendListItem["matchStatus"]) {
  switch (status) {
    case "exact_report_item_id":
      return "border-[#90FF4D]/20 bg-[#90FF4D]/10 text-[#D4FFB2]";
    case "exact_ad_metadata":
      return "border-[#6D95FF]/20 bg-[#6D95FF]/10 text-[#C9D8FF]";
    case "matched_ad_id":
      return "border-[#6D95FF]/20 bg-[#6D95FF]/10 text-[#C9D8FF]";
    default:
      return "border-white/[0.08] bg-white/[0.05] text-muted-foreground";
  }
}

function getMatchedVideoTitle(item: ViewTallyAdSpendListItem) {
  const video = item.matchedVideo;

  if (!video) {
    const itemId = item.itemId ?? item.itemIds[0] ?? null;
    return itemId ? `TikTok item ${itemId}` : "No TikTok item ID exposed";
  }

  const title = video.titleOrCaption?.trim();
  return title && title.length > 0 ? title : `${video.creatorName} on TikTok`;
}

function EmptyPanelRow({ label }: { label: string }) {
  return (
    <div className="px-5 py-12 text-sm text-muted-foreground">
      {label}
    </div>
  );
}

function AdSpendRow({ item }: { item: ViewTallyAdSpendListItem }) {
  const title = getMatchedVideoTitle(item);
  const handleLabel = getHandleLabel(item.matchedVideo?.accountHandle);

  return (
    <article className="grid gap-4 border-t border-white/[0.07] bg-[#0B0C0F] px-5 py-4 transition hover:bg-[#101218] lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1.4fr)_8rem] lg:items-center">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-white/[0.08] bg-white/[0.05] px-2.5 py-1 text-[0.6rem] uppercase tracking-[0.18em] text-muted-foreground">
            Ad
          </span>
          <span className={`rounded-full border px-2.5 py-1 text-[0.6rem] uppercase tracking-[0.18em] ${getAdSpendMatchClasses(item.matchStatus)}`}>
            {getAdSpendMatchLabel(item.matchStatus)}
          </span>
        </div>
        <p className="mt-2 truncate font-mono text-sm text-foreground">
          {item.adId ?? "Unknown ad ID"}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {formatDateLabel(item.statDate)}
        </p>
      </div>

      <div className="flex min-w-0 items-center gap-3">
        <div className="relative h-14 w-10 shrink-0 overflow-hidden rounded-[0.65rem] border border-white/[0.08] bg-black">
          {item.matchedVideo?.thumbnailUrl ? (
            <div aria-hidden="true" className="absolute inset-0" style={getBackgroundImageStyle(item.matchedVideo.thumbnailUrl)} />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-[0.52rem] uppercase tracking-[0.14em] text-muted-foreground">
              TikTok
            </div>
          )}
        </div>
        <div className="min-w-0">
          {item.matchedVideo ? (
            <a
              className="line-clamp-2 text-sm font-semibold leading-5 text-foreground transition hover:text-[#B9FF95]"
              href={item.matchedVideo.videoUrl}
              rel="noreferrer"
              target="_blank"
              title={title}
            >
              {truncateCopy(title, 130)}
            </a>
          ) : (
            <p className="line-clamp-2 text-sm font-semibold leading-5 text-foreground" title={title}>
              {title}
            </p>
          )}
          <p className="mt-1 truncate text-xs text-muted-foreground">
            {handleLabel ?? item.matchedVideo?.creatorName ?? "Unmatched content"} · Item ID {item.itemId ?? item.itemIds[0] ?? "--"}
          </p>
        </div>
      </div>

      <p className="text-left text-lg font-semibold tracking-[-0.03em] text-foreground lg:text-right">
        {formatCurrencyValue(item.spend)}
      </p>
    </article>
  );
}

export function AdSpendSection({
  apiPath,
  startDate,
  endDate,
}: {
  apiPath: string;
  startDate: string;
  endDate: string;
}) {
  const [payload, setPayload] = useState<AdSpendPayload | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const retryCountsRef = useRef(new Map<string, number>());
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const adSpend = payload?.adSpend ?? null;
  const warnings = [
    ...(adSpend?.warnings ?? []),
    ...(errorMessage ? [errorMessage] : []),
  ];
  const adSpendTimedOut = warnings.some((warning) =>
    warning.toLowerCase().includes("timed out"),
  );

  useEffect(() => {
    let isActive = true;
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }

    const cachedEntry = readCachedAdSpendPayload(apiPath);
    const forceRefresh = refreshKey > 0;
    const hasFreshCache = cachedEntry ? cachedEntry.expiresAt > Date.now() : false;

    queueMicrotask(() => {
      if (!isActive) {
        return;
      }

      setErrorMessage(null);

      if (cachedEntry) {
        setPayload(cachedEntry.payload);
        setIsLoading(false);
        setIsRefreshing(forceRefresh || !hasFreshCache);
      } else {
        setPayload(null);
        setIsLoading(true);
        setIsRefreshing(false);
      }
    });

    if (hasFreshCache && !forceRefresh) {
      return () => {
        isActive = false;
      };
    }

    fetchAdSpendPayload(apiPath, forceRefresh)
      .then((nextPayload) => {
        writeCachedAdSpendPayload(apiPath, nextPayload);

        if (!isActive) {
          return;
        }

        setPayload(nextPayload);

        if (adSpendPayloadTimedOut(nextPayload)) {
          const retryCount = retryCountsRef.current.get(apiPath) ?? 0;

          if (retryCount < AD_SPEND_TIMEOUT_RETRY_LIMIT) {
            retryCountsRef.current.set(apiPath, retryCount + 1);
            retryTimerRef.current = setTimeout(() => {
              if (isActive) {
                setRefreshKey((value) => value + 1);
              }
            }, AD_SPEND_TIMEOUT_RETRY_DELAY_MS * (retryCount + 1));
          }
        } else {
          retryCountsRef.current.delete(apiPath);
        }
      })
      .catch((error) => {
        if (!isActive) {
          return;
        }

        setErrorMessage(
          error instanceof Error
            ? error.message
            : "Could not load TikTok ad spend right now.",
        );
      })
      .finally(() => {
        if (isActive) {
          setIsLoading(false);
          setIsRefreshing(false);
        }
      });

    return () => {
      isActive = false;
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    };
  }, [apiPath, refreshKey]);

  return (
    <section className="overflow-hidden rounded-[1.45rem] border border-white/[0.08] bg-[#0D0E11] shadow-[0_24px_70px_rgba(0,0,0,0.24)]">
      <header className="flex flex-col gap-4 border-b border-white/[0.08] px-5 py-5 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold tracking-[-0.04em] text-foreground">
              Ad Spend by Ad and Content
            </h2>
            <span className="flex h-4 w-4 items-center justify-center rounded-full border border-white/[0.16] text-[0.62rem] text-muted-foreground">
              i
            </span>
            <button
              aria-label="Refresh ad spend"
              className="flex h-7 w-7 items-center justify-center rounded-full border border-white/[0.1] bg-white/[0.05] text-muted-foreground transition hover:bg-white/[0.1] hover:text-foreground disabled:cursor-wait disabled:opacity-60"
              disabled={isLoading || isRefreshing}
              onClick={() => setRefreshKey((value) => value + 1)}
              title="Refresh ad spend"
              type="button"
            >
              <DashboardIcon
                aria-hidden="true"
                className={`h-3.5 w-3.5 ${isRefreshing ? "animate-spin" : ""}`}
                name="refresh"
              />
            </button>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            Exact content matches use TikTok reporting item_id or resolved ad metadata against viral.app video IDs.
          </p>
        </div>
        <div className="rounded-[1rem] border border-white/[0.08] bg-black/[0.22] px-4 py-3 text-right">
          <p className="text-[0.62rem] uppercase tracking-[0.2em] text-muted-foreground">
            Ad spend
          </p>
          <p className="mt-1 text-2xl font-semibold tracking-[-0.05em] text-foreground">
            {isLoading && !adSpend ? "--" : formatCurrencyValue(adSpend?.totalSpend ?? 0)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {isLoading && !adSpend
              ? "Loading TikTok rows"
              : isRefreshing
                ? "Refreshing TikTok rows"
                : `${formatMetricValue(adSpend?.rowCount ?? 0)} TikTok ad row${adSpend?.rowCount === 1 ? "" : "s"}`}
          </p>
        </div>
      </header>

      {warnings.length > 0 ? (
        <div className="border-b border-[#FFD24D]/15 bg-[#FFD24D]/[0.06] px-5 py-3 text-sm text-[#FFEAB1]">
          {warnings.slice(0, 2).join(" ")}
          {warnings.length > 2 ? ` +${warnings.length - 2} more` : ""}
        </div>
      ) : null}

      <div>
        {isLoading && !adSpend ? (
          <EmptyPanelRow label="Loading TikTok ad spend without blocking the rest of the dashboard..." />
        ) : adSpend && adSpend.rows.length > 0 ? (
          adSpend.rows.map((item) => <AdSpendRow item={item} key={item.key} />)
        ) : adSpendTimedOut ? (
          <EmptyPanelRow label="TikTok ad spend is still loading slowly. Refresh again in a moment or narrow the date range." />
        ) : (
          <EmptyPanelRow
            label={`No TikTok ad spend was reported between ${formatDateLabel(startDate)} and ${formatDateLabel(endDate)}.`}
          />
        )}
      </div>
    </section>
  );
}
