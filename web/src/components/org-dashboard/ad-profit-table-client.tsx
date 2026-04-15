"use client";

import { useEffect, useRef, useState } from "react";

type TikTokAdsManagerCandidate = {
  adId: string;
  adName: string | null;
  adsManagerUrl: string;
  displayName: string | null;
  itemIds: string[];
  matchLevel: "exact_item_id" | "exact_post_url" | "name_fallback";
  shareUrl: string | null;
  subtitle: string;
  title: string;
};

type TikTokAdsManagerResolveResult = {
  advertiserId: string;
  candidates: TikTokAdsManagerCandidate[];
  warnings: string[];
};

type RowResolveState = {
  chooserOpen: boolean;
  error: string | null;
  result: TikTokAdsManagerResolveResult | null;
  status: "idle" | "loading" | "ready" | "error";
};

export type AdProfitTableClientRow = {
  appLabel: string;
  campaignLabel: string;
  campaignName: string | null;
  creativeContextLabel: string;
  creativeId: string | null;
  creativeIdLabel: string;
  creativeImage: string | null;
  creativeName: string | null;
  creativeTitle: string;
  creativeUrl: string | null;
  id: string;
  overallRankLabel: string;
  profitLabel: string;
  profitPositive: boolean;
  revenueLabel: string;
  revenueRankLabel: string;
  roasLabel: string;
  roasRankLabel: string;
  sourceLabel: string;
  spendLabel: string;
  volumePrimaryLabel: string;
  volumeSecondaryLabel: string;
  compositeLabel: string;
  subCampaignName: string | null;
};

type AdProfitTableClientProps = {
  endDate: string;
  organizationSlug: string;
  rows: AdProfitTableClientRow[];
  startDate: string;
};

function getBackgroundImageStyle(imageUrl: string) {
  return {
    backgroundImage: `url(${JSON.stringify(imageUrl)})`,
    backgroundPosition: "center",
    backgroundRepeat: "no-repeat",
    backgroundSize: "cover",
  } as const;
}

export function AdProfitTableClient({
  endDate,
  organizationSlug,
  rows,
  startDate,
}: AdProfitTableClientProps) {
  const topScrollRef = useRef<HTMLDivElement>(null);
  const bottomScrollRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLTableElement>(null);
  const syncLockRef = useRef(false);
  const [tableScrollWidth, setTableScrollWidth] = useState(1560);
  const [resolveStates, setResolveStates] = useState<Record<string, RowResolveState>>(
    {},
  );

  useEffect(() => {
    function updateTableScrollWidth() {
      setTableScrollWidth(tableRef.current?.scrollWidth ?? 1560);
    }

    updateTableScrollWidth();
    const resizeObserver = new ResizeObserver(() => {
      updateTableScrollWidth();
    });

    if (tableRef.current) {
      resizeObserver.observe(tableRef.current);
    }

    if (bottomScrollRef.current) {
      resizeObserver.observe(bottomScrollRef.current);
    }

    window.addEventListener("resize", updateTableScrollWidth);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", updateTableScrollWidth);
    };
  }, [rows]);

  function syncScrollPositions(args: {
    source: HTMLDivElement | null;
    destination: HTMLDivElement | null;
  }) {
    if (!args.source || !args.destination) {
      return;
    }

    if (syncLockRef.current) {
      syncLockRef.current = false;
      return;
    }

    syncLockRef.current = true;
    args.destination.scrollLeft = args.source.scrollLeft;
  }

  async function handleOpenInTikTok(row: AdProfitTableClientRow) {
    const existingState = resolveStates[row.id];

    if (existingState?.status === "ready" && existingState.result) {
      if (existingState.result.candidates.length === 1) {
        window.open(
          existingState.result.candidates[0]!.adsManagerUrl,
          "_blank",
          "noopener,noreferrer",
        );
        return;
      }

      if (existingState.result.candidates.length > 1) {
        setResolveStates((current) => ({
          ...current,
          [row.id]: {
            ...existingState,
            chooserOpen: !existingState.chooserOpen,
          },
        }));
        return;
      }
    }

    const pendingWindow = window.open("", "_blank", "noopener,noreferrer");

    setResolveStates((current) => ({
      ...current,
      [row.id]: {
        chooserOpen: false,
        error: null,
        result: null,
        status: "loading",
      },
    }));

    try {
      const response = await fetch(
        `/api/org/${organizationSlug}/tiktok-paid-views/resolve`,
        {
          body: JSON.stringify({
            campaignName: row.campaignName,
            creativeId: row.creativeId,
            creativeName: row.creativeName,
            creativeUrl: row.creativeUrl,
            endDate,
            startDate,
            subCampaignName: row.subCampaignName,
          }),
          headers: {
            "Content-Type": "application/json",
          },
          method: "POST",
        },
      );
      const payload = (await response.json()) as
        | TikTokAdsManagerResolveResult
        | { error?: string };

      if (!response.ok) {
        throw new Error(
          typeof payload === "object" && payload && "error" in payload && payload.error
            ? payload.error
            : "Could not resolve a TikTok ad for this creative.",
        );
      }

      const result = payload as TikTokAdsManagerResolveResult;
      const hasSingleCandidate = result.candidates.length === 1;

      setResolveStates((current) => ({
        ...current,
        [row.id]: {
          chooserOpen: result.candidates.length > 1,
          error: null,
          result,
          status: "ready",
        },
      }));

      if (hasSingleCandidate) {
        const targetUrl = result.candidates[0]!.adsManagerUrl;

        if (pendingWindow) {
          pendingWindow.location.href = targetUrl;
        } else {
          window.open(targetUrl, "_blank", "noopener,noreferrer");
        }

        return;
      }

      pendingWindow?.close();
    } catch (error) {
      pendingWindow?.close();
      setResolveStates((current) => ({
        ...current,
        [row.id]: {
          chooserOpen: false,
          error:
            error instanceof Error
              ? error.message
              : "Could not resolve a TikTok ad for this creative.",
          result: null,
          status: "error",
        },
      }));
    }
  }

  function getButtonLabel(rowId: string) {
    const state = resolveStates[rowId];

    if (state?.status === "loading") {
      return "Finding in TikTok Ads...";
    }

    if (state?.status === "ready" && state.result) {
      if (state.result.candidates.length > 1) {
        return state.chooserOpen ? "Hide matches" : "Choose TikTok ad";
      }

      if (state.result.candidates.length === 0) {
        return "Retry TikTok match";
      }
    }

    if (state?.status === "error") {
      return "Retry TikTok match";
    }

    return "Open in TikTok Ads";
  }

  return (
    <div className="mt-5 space-y-2">
      <div
        aria-label="Top table scrollbar"
        className="overflow-x-auto rounded-[0.95rem] border border-white/[0.08] bg-black/[0.22]"
        onScroll={() =>
          syncScrollPositions({
            source: topScrollRef.current,
            destination: bottomScrollRef.current,
          })
        }
        ref={topScrollRef}
      >
        <div className="h-4" style={{ width: tableScrollWidth }} />
      </div>

      <div
        className="overflow-x-auto rounded-[1.2rem] border border-white/[0.08] bg-black/[0.18]"
        onScroll={() =>
          syncScrollPositions({
            source: bottomScrollRef.current,
            destination: topScrollRef.current,
          })
        }
        ref={bottomScrollRef}
      >
        <table
          className="min-w-[1560px] w-full table-fixed border-collapse text-left"
          ref={tableRef}
        >
          <thead className="bg-white/[0.03]">
            <tr>
              <th className="w-[28rem] px-4 py-3 text-[0.62rem] font-normal uppercase tracking-[0.22em] text-muted-foreground">
                Creative
              </th>
              <th className="w-[18rem] px-4 py-3 text-[0.62rem] font-normal uppercase tracking-[0.22em] text-muted-foreground">
                Campaign
              </th>
              <th className="w-[8rem] px-4 py-3 text-[0.62rem] font-normal uppercase tracking-[0.22em] text-muted-foreground">
                Spend
              </th>
              <th className="w-[8rem] px-4 py-3 text-[0.62rem] font-normal uppercase tracking-[0.22em] text-muted-foreground">
                Revenue
              </th>
              <th className="w-[8rem] px-4 py-3 text-[0.62rem] font-normal uppercase tracking-[0.22em] text-muted-foreground">
                Profit
              </th>
              <th className="w-[7rem] px-4 py-3 text-[0.62rem] font-normal uppercase tracking-[0.22em] text-muted-foreground">
                ROAS
              </th>
              <th className="w-[7rem] px-4 py-3 text-[0.62rem] font-normal uppercase tracking-[0.22em] text-muted-foreground">
                Revenue rank
              </th>
              <th className="w-[7rem] px-4 py-3 text-[0.62rem] font-normal uppercase tracking-[0.22em] text-muted-foreground">
                ROAS rank
              </th>
              <th className="w-[8rem] px-4 py-3 text-[0.62rem] font-normal uppercase tracking-[0.22em] text-muted-foreground">
                Composite
              </th>
              <th className="w-[7rem] px-4 py-3 text-[0.62rem] font-normal uppercase tracking-[0.22em] text-muted-foreground">
                Overall rank
              </th>
              <th className="w-[9rem] px-4 py-3 text-[0.62rem] font-normal uppercase tracking-[0.22em] text-muted-foreground">
                Volume
              </th>
              <th className="w-[10rem] px-4 py-3 text-[0.62rem] font-normal uppercase tracking-[0.22em] text-muted-foreground">
                Source
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.06] text-sm text-foreground">
            {rows.map((row) => {
              const resolveState = resolveStates[row.id];
              const candidateCount = resolveState?.result?.candidates.length ?? 0;

              return (
                <tr className="align-top" key={row.id}>
                  <td className="px-4 py-4">
                    <div className="flex gap-3">
                      {row.creativeImage ? (
                        <div
                          aria-hidden="true"
                          className="hidden h-16 w-12 shrink-0 rounded-[0.85rem] border border-white/[0.08] bg-black/[0.24] md:block"
                          style={getBackgroundImageStyle(row.creativeImage)}
                        />
                      ) : null}

                      <div className="min-w-0">
                        <p
                          className="max-w-[24rem] overflow-hidden text-ellipsis whitespace-nowrap font-medium text-foreground"
                          title={row.creativeTitle}
                        >
                          {row.creativeTitle}
                        </p>
                        <p
                          className="mt-1 max-w-[24rem] overflow-hidden text-ellipsis whitespace-nowrap text-xs leading-5 text-muted-foreground"
                          title={row.creativeContextLabel}
                        >
                          {row.creativeContextLabel}
                        </p>

                        <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
                          {row.creativeUrl ? (
                            <a
                              className="text-foreground transition hover:text-white"
                              href={row.creativeUrl}
                              rel="noreferrer"
                              target="_blank"
                            >
                              Open creative
                            </a>
                          ) : null}

                          <button
                            className="text-foreground transition hover:text-white disabled:cursor-wait disabled:text-muted-foreground"
                            disabled={resolveState?.status === "loading"}
                            onClick={() => void handleOpenInTikTok(row)}
                            type="button"
                          >
                            {getButtonLabel(row.id)}
                          </button>
                        </div>

                        {resolveState?.status === "error" ? (
                          <p className="mt-2 max-w-[24rem] text-xs leading-5 text-[#FFD3C5]">
                            {resolveState.error}
                          </p>
                        ) : null}

                        {resolveState?.status === "ready" &&
                        resolveState.result &&
                        candidateCount === 0 ? (
                          <p className="mt-2 max-w-[24rem] text-xs leading-5 text-muted-foreground">
                            {resolveState.result.warnings[0] ??
                              "No TikTok ad matched this creative in the selected date range."}
                          </p>
                        ) : null}

                        {resolveState?.status === "ready" &&
                        resolveState.result &&
                        candidateCount > 1 &&
                        resolveState.chooserOpen ? (
                          <div className="mt-3 max-w-[24rem] rounded-[0.95rem] border border-white/[0.08] bg-black/[0.24] p-3">
                            <p className="text-[0.62rem] uppercase tracking-[0.22em] text-muted-foreground">
                              Choose TikTok ad
                            </p>
                            <div className="mt-2 space-y-2">
                              {resolveState.result.candidates.map((candidate) => (
                                <div
                                  className="rounded-[0.85rem] border border-white/[0.06] bg-white/[0.02] p-3"
                                  key={candidate.adId}
                                >
                                  <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                      <p
                                        className="max-w-[15rem] overflow-hidden text-ellipsis whitespace-nowrap font-medium text-foreground"
                                        title={candidate.title}
                                      >
                                        {candidate.title}
                                      </p>
                                      <p
                                        className="mt-1 max-w-[15rem] overflow-hidden text-ellipsis whitespace-nowrap text-xs text-muted-foreground"
                                        title={candidate.subtitle}
                                      >
                                        {candidate.subtitle}
                                      </p>
                                    </div>

                                    <a
                                      className="shrink-0 text-xs font-medium text-foreground transition hover:text-white"
                                      href={candidate.adsManagerUrl}
                                      rel="noreferrer"
                                      target="_blank"
                                    >
                                      Open
                                    </a>
                                  </div>

                                  {candidate.shareUrl ? (
                                    <div className="mt-2">
                                      <a
                                        className="text-xs text-muted-foreground transition hover:text-foreground"
                                        href={candidate.shareUrl}
                                        rel="noreferrer"
                                        target="_blank"
                                      >
                                        Open post
                                      </a>
                                    </div>
                                  ) : null}
                                </div>
                              ))}
                            </div>

                            {resolveState.result.warnings.length > 0 ? (
                              <p className="mt-3 text-xs leading-5 text-muted-foreground">
                                {resolveState.result.warnings[0]}
                              </p>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-4">
                    <p
                      className="max-w-[15rem] overflow-hidden text-ellipsis whitespace-nowrap font-medium text-foreground"
                      title={row.campaignLabel}
                    >
                      {row.campaignLabel}
                    </p>
                    <p
                      className="mt-1 max-w-[15rem] overflow-hidden text-ellipsis whitespace-nowrap text-xs text-muted-foreground"
                      title={row.creativeIdLabel}
                    >
                      {row.creativeIdLabel}
                    </p>
                  </td>
                  <td className="px-4 py-4">
                    <p className="font-medium text-foreground">{row.spendLabel}</p>
                  </td>
                  <td className="px-4 py-4">
                    <p className="font-medium text-foreground">{row.revenueLabel}</p>
                  </td>
                  <td className="px-4 py-4">
                    <p
                      className={`font-medium ${
                        row.profitPositive ? "text-[#B8FF86]" : "text-foreground"
                      }`}
                    >
                      {row.profitLabel}
                    </p>
                  </td>
                  <td className="px-4 py-4">
                    <p className="font-medium text-foreground">{row.roasLabel}</p>
                  </td>
                  <td className="px-4 py-4">
                    <p className="font-medium text-foreground">{row.revenueRankLabel}</p>
                  </td>
                  <td className="px-4 py-4">
                    <p className="font-medium text-foreground">{row.roasRankLabel}</p>
                  </td>
                  <td className="px-4 py-4">
                    <p className="font-medium text-foreground">{row.compositeLabel}</p>
                  </td>
                  <td className="px-4 py-4">
                    <p className="font-medium text-foreground">{row.overallRankLabel}</p>
                  </td>
                  <td className="px-4 py-4">
                    <p className="font-medium text-foreground">{row.volumePrimaryLabel}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {row.volumeSecondaryLabel}
                    </p>
                  </td>
                  <td className="px-4 py-4">
                    <p
                      className="max-w-[8rem] overflow-hidden text-ellipsis whitespace-nowrap font-medium text-foreground"
                      title={row.sourceLabel}
                    >
                      {row.sourceLabel}
                    </p>
                    <p
                      className="mt-1 max-w-[8rem] overflow-hidden text-ellipsis whitespace-nowrap text-xs text-muted-foreground"
                      title={row.appLabel}
                    >
                      {row.appLabel}
                    </p>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
