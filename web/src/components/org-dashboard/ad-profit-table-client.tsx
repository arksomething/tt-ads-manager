"use client";

import { useEffect, useRef, useState } from "react";

export type AdProfitTableClientRow = {
  appLabel: string;
  campaignLabel: string;
  creativeContextLabel: string;
  creativeIdLabel: string;
  creativeImage: string | null;
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
};

type AdProfitTableClientProps = {
  rows: AdProfitTableClientRow[];
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
  rows,
}: AdProfitTableClientProps) {
  const topScrollRef = useRef<HTMLDivElement>(null);
  const bottomScrollRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLTableElement>(null);
  const syncLockRef = useRef(false);
  const [tableScrollWidth, setTableScrollWidth] = useState(1560);

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
            {rows.map((row) => (
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
                      {row.creativeUrl ? (
                        <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
                          <a
                            className="text-foreground transition hover:text-white"
                            href={row.creativeUrl}
                            rel="noreferrer"
                            target="_blank"
                          >
                            Open creative
                          </a>
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
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
