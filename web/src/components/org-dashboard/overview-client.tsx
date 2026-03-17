"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

import { getCampaignColorTone } from "@/lib/campaign-colors";

import { CampaignBadge } from "./campaign-badge";
import type {
  MetricCardData,
  MetricChartSeries,
  OverviewMockData,
  TopAccountItem,
  TopVideoItem,
} from "./mock-data";
import { OrgToolbar } from "./org-toolbar";
import { DashboardIcon } from "./org-icons";

type OverviewClientProps = {
  data: OverviewMockData;
  organizationSlug: string;
};

type VideoSortKey = "views" | "engagement";
type AccountSortKey = "views" | "growth";

function parseCompactNumber(value: string) {
  const normalized = value.replace(/[$,%+]/g, "").trim();
  const multiplier =
    normalized.endsWith("M") ? 1_000_000 : normalized.endsWith("K") ? 1_000 : 1;

  return Number.parseFloat(normalized.replace(/[MK]/g, "")) * multiplier;
}

function normalizeIdentityLabel(value: string) {
  return value.trim().replace(/^@+/, "").toLowerCase();
}

function getBackgroundImageStyle(imageUrl: string) {
  return {
    backgroundImage: `url(${JSON.stringify(imageUrl)})`,
    backgroundPosition: "center",
    backgroundRepeat: "no-repeat",
    backgroundSize: "cover",
  } as const;
}

function getInitials(value: string) {
  const parts = value.trim().split(/\s+/).filter(Boolean);

  if (parts.length >= 2) {
    return parts
      .slice(0, 2)
      .map((part) => part[0] ?? "")
      .join("")
      .toUpperCase();
  }

  return value.slice(0, 2).toUpperCase();
}

function buildAreaPaths(values: number[]) {
  const width = 640;
  const height = 260;
  const paddingX = 22;
  const paddingY = 18;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min || 1;

  const points = values.map((value, index) => {
    const x =
      paddingX + (index * (width - paddingX * 2)) / Math.max(values.length - 1, 1);
    const y =
      height -
      paddingY -
      ((value - min) / range) * (height - paddingY * 2 - 10);

    return { x, y };
  });

  const linePath = points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`)
    .join(" ");
  const lastPoint = points[points.length - 1];
  const firstPoint = points[0];
  const areaPath = `${linePath} L ${lastPoint.x} ${height - paddingY} L ${firstPoint.x} ${height - paddingY} Z`;

  return { areaPath, linePath, points };
}

export function OverviewClient({ data, organizationSlug }: OverviewClientProps) {
  const [activeMetricSeriesId, setActiveMetricSeriesId] = useState(
    data.metricChartSeries[0]?.id ?? "views",
  );
  const [videoSort, setVideoSort] = useState<VideoSortKey>("views");
  const [accountSort, setAccountSort] = useState<AccountSortKey>("views");

  const activeMetricSeries =
    data.metricChartSeries.find((series) => series.id === activeMetricSeriesId) ??
    data.metricChartSeries[0];

  const sortedVideos = useMemo(() => {
    return [...data.topVideos].sort((left, right) => {
      const leftValue =
        videoSort === "views"
          ? parseCompactNumber(left.views)
          : parseCompactNumber(left.engagement);
      const rightValue =
        videoSort === "views"
          ? parseCompactNumber(right.views)
          : parseCompactNumber(right.engagement);

      return rightValue - leftValue;
    });
  }, [data.topVideos, videoSort]);

  const sortedAccounts = useMemo(() => {
    return [...data.topAccounts].sort((left, right) => {
      const leftValue =
        accountSort === "views"
          ? parseCompactNumber(left.views)
          : parseCompactNumber(left.growth);
      const rightValue =
        accountSort === "views"
          ? parseCompactNumber(right.views)
          : parseCompactNumber(right.growth);

      return rightValue - leftValue;
    });
  }, [accountSort, data.topAccounts]);

  return (
    <div className="space-y-4">
      <OrgToolbar
        accountOptions={data.accountOptions}
        campaignOptions={data.campaignOptions}
        dateRangeOptions={data.dateRangeOptions}
        showAccountFilter={false}
        showActionButtons={false}
        showUtilityButtons={false}
      />

      <section className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-6">
        {data.metricCards.map((card) => (
          <MetricCard key={card.label} card={card} />
        ))}
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <MetricsChartCard
          activeSeries={activeMetricSeries}
          seriesOptions={data.metricChartSeries}
          onSelectSeries={setActiveMetricSeriesId}
        />
        <EngagementChartCard
          axisLabels={data.engagementSeries.axisLabels}
          points={data.engagementSeries.points}
          summary={data.engagementSeries.summary}
        />
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <TopVideosCard
          items={sortedVideos}
          sort={videoSort}
          onSortChange={setVideoSort}
        />
        <TopAccountsCard
          items={sortedAccounts}
          organizationSlug={organizationSlug}
          sort={accountSort}
          onSortChange={setAccountSort}
        />
      </section>
    </div>
  );
}

function MetricCard({ card }: { card: MetricCardData }) {
  const deltaTone =
    card.direction === "up"
      ? "text-[#8FFF63] bg-[#90FF4D]/10 border-[#90FF4D]/20"
      : "text-[#FF9D7A] bg-[#FF7E54]/10 border-[#FF7E54]/20";
  const surfaceTone =
    card.direction === "up"
      ? "linear-gradient(135deg, rgba(144,255,77,0.12), rgba(255,255,255,0.04) 38%, rgba(255,255,255,0.02) 100%)"
      : "linear-gradient(135deg, rgba(255,126,84,0.12), rgba(255,255,255,0.04) 38%, rgba(255,255,255,0.02) 100%)";

  return (
    <article
      className="rounded-[1.25rem] border border-white/[0.08] bg-white/[0.03] p-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]"
      style={{ backgroundImage: surfaceTone }}
    >
      <div className="flex items-start justify-between gap-2.5">
        <span className="inline-flex h-9 w-9 items-center justify-center rounded-[0.85rem] border border-white/[0.08] bg-black/[0.24] text-foreground">
          <DashboardIcon className="h-3.5 w-3.5" name={card.icon} />
        </span>
        {card.scope ? (
          <span className="rounded-full border border-white/[0.08] bg-white/[0.04] px-2 py-0.5 text-[0.54rem] uppercase tracking-[0.2em] text-muted-foreground">
            {card.scope}
          </span>
        ) : null}
      </div>

      <p className="mt-4 text-[0.68rem] uppercase tracking-[0.22em] text-muted-foreground">
        {card.label}
      </p>
      <p className="mt-2.5 text-[1.7rem] font-medium tracking-[-0.05em] text-foreground">
        {card.value}
      </p>

      <div
        className={`mt-3 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[0.58rem] uppercase tracking-[0.2em] ${deltaTone}`}
      >
        <DashboardIcon
          className="h-3 w-3"
          name={card.direction === "up" ? "arrowUpRight" : "arrowDownRight"}
        />
        {card.delta}
      </div>
    </article>
  );
}

function MetricsChartCard({
  activeSeries,
  seriesOptions,
  onSelectSeries,
}: {
  activeSeries: MetricChartSeries;
  seriesOptions: MetricChartSeries[];
  onSelectSeries: (value: string) => void;
}) {
  const maxPoint = Math.max(...activeSeries.points.map((point) => point.value), 1);

  return (
    <article className="rounded-[1.55rem] border border-white/[0.08] bg-white/[0.03] p-4 shadow-[0_24px_70px_rgba(0,0,0,0.2)] backdrop-blur sm:p-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-[0.68rem] uppercase tracking-[0.26em] text-muted-foreground">
            Metrics
          </p>
          <p className="mt-1.5 max-w-md text-[0.86rem] leading-6 text-muted-foreground">
            {activeSeries.summary}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {seriesOptions.map((series) => {
            const isActive = series.id === activeSeries.id;

            return (
              <button
                key={series.id}
                className={`rounded-full border px-2.5 py-1.5 text-[0.82rem] transition ${
                  isActive
                    ? "border-white/[0.14] bg-white/[0.08] text-foreground"
                    : "border-white/[0.08] bg-white/[0.04] text-muted-foreground hover:border-white/[0.14] hover:bg-white/[0.07] hover:text-foreground"
                }`}
                onClick={() => onSelectSeries(series.id)}
                type="button"
              >
                {series.label}
              </button>
            );
          })}

          <button
            className="rounded-full border border-white/[0.08] bg-white/[0.04] px-2.5 py-1.5 text-[0.82rem] text-muted-foreground transition hover:border-white/[0.14] hover:bg-white/[0.07] hover:text-foreground"
            type="button"
          >
            Add secondary
          </button>
        </div>
      </div>

      <div className="mt-5 grid gap-3 lg:grid-cols-[auto_1fr]">
        <div className="hidden h-[17.5rem] flex-col justify-between py-1 text-[0.62rem] uppercase tracking-[0.18em] text-muted-foreground lg:flex">
          {activeSeries.axisLabels.map((label, index) => (
            <span key={`${label}-${index}`}>{label}</span>
          ))}
        </div>

        <div className="relative h-[17.5rem] overflow-hidden rounded-[1.25rem] border border-white/[0.08] bg-black/[0.22] px-3.5 pb-10 pt-5">
          <div className="pointer-events-none absolute inset-x-3.5 top-5 bottom-10 grid grid-rows-3">
            <div className="border-b border-white/[0.06]" />
            <div className="border-b border-white/[0.06]" />
            <div />
          </div>

          <div className="absolute inset-x-3.5 bottom-10 top-5 flex items-end gap-2">
            {activeSeries.points.map((point) => {
              const height = Math.max((point.value / maxPoint) * 100, 7);

              return (
                <div key={point.label} className="group relative flex h-full flex-1 items-end">
                  <div
                    className={`w-full rounded-t-[0.75rem] border border-white/[0.04] ${
                      point.highlight
                        ? "bg-[linear-gradient(180deg,rgba(167,122,255,0.92),rgba(122,86,255,0.55))]"
                        : "bg-[linear-gradient(180deg,rgba(144,255,77,0.78),rgba(19,202,45,0.34))]"
                    }`}
                    style={{ height: `${height}%` }}
                  />
                  <span className="absolute -top-6 left-1/2 hidden -translate-x-1/2 rounded-full border border-white/[0.08] bg-[#121216] px-2 py-1 text-[0.56rem] uppercase tracking-[0.16em] text-foreground group-hover:inline-flex">
                    {point.value}
                  </span>
                </div>
              );
            })}
          </div>

          <div className="absolute inset-x-3.5 bottom-2.5 flex justify-between gap-2 text-[0.56rem] uppercase tracking-[0.16em] text-muted-foreground">
            {activeSeries.points.map((point, index) => (
              <span
                key={point.label}
                className={index % 2 === 0 ? "inline-flex" : "hidden sm:inline-flex"}
              >
                {point.shortLabel}
              </span>
            ))}
          </div>
        </div>
      </div>
    </article>
  );
}

function EngagementChartCard({
  summary,
  axisLabels,
  points,
}: {
  summary: string;
  axisLabels: string[];
  points: Array<{
    label: string;
    value: number;
  }>;
}) {
  const values = points.map((point) => point.value);
  const { areaPath, linePath, points: chartPoints } = buildAreaPaths(values);

  return (
    <article className="rounded-[1.55rem] border border-white/[0.08] bg-white/[0.03] p-4 shadow-[0_24px_70px_rgba(0,0,0,0.2)] backdrop-blur sm:p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[0.68rem] uppercase tracking-[0.26em] text-muted-foreground">
            Engagement
          </p>
          <p className="mt-1.5 max-w-md text-[0.86rem] leading-6 text-muted-foreground">
            {summary}
          </p>
        </div>
      </div>

      <div className="mt-5 grid gap-3 lg:grid-cols-[auto_1fr]">
        <div className="hidden h-[17.5rem] flex-col justify-between py-1 text-[0.62rem] uppercase tracking-[0.18em] text-muted-foreground lg:flex">
          {axisLabels.map((label, index) => (
            <span key={`${label}-${index}`}>{label}</span>
          ))}
        </div>

        <div className="relative h-[17.5rem] overflow-hidden rounded-[1.25rem] border border-white/[0.08] bg-black/[0.22] px-3.5 pb-10 pt-5">
          <div className="pointer-events-none absolute inset-x-3.5 top-5 bottom-10 grid grid-rows-3">
            <div className="border-b border-white/[0.06]" />
            <div className="border-b border-white/[0.06]" />
            <div />
          </div>

          <svg
            className="absolute inset-x-3.5 top-5 h-[calc(100%-3.75rem)] w-[calc(100%-1.75rem)]"
            preserveAspectRatio="none"
            viewBox="0 0 640 260"
          >
            <defs>
              <linearGradient id="engagement-fill" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="#90FF4D" stopOpacity="0.5" />
                <stop offset="100%" stopColor="#13CA2D" stopOpacity="0.02" />
              </linearGradient>
              <linearGradient id="engagement-line" x1="0" x2="1" y1="0" y2="0">
                <stop offset="0%" stopColor="#7CFFB0" stopOpacity="0.92" />
                <stop offset="100%" stopColor="#90FF4D" stopOpacity="0.92" />
              </linearGradient>
            </defs>
            <path d={areaPath} fill="url(#engagement-fill)" />
            <path
              d={linePath}
              fill="none"
              stroke="url(#engagement-line)"
              strokeWidth="3.5"
            />
            {chartPoints.map((point, index) => (
              <circle
                key={`${point.x}-${point.y}-${index}`}
                cx={point.x}
                cy={point.y}
                fill="#09090b"
                r="4"
                stroke="rgba(144,255,77,0.92)"
                strokeWidth="2.25"
              />
            ))}
          </svg>

          <div className="absolute inset-x-3.5 bottom-2.5 flex justify-between gap-2 text-[0.56rem] uppercase tracking-[0.16em] text-muted-foreground">
            {points.map((point, index) => (
              <span
                key={point.label}
                className={index % 2 === 0 ? "inline-flex" : "hidden sm:inline-flex"}
              >
                {point.label}
              </span>
            ))}
          </div>
        </div>
      </div>
    </article>
  );
}

function TopVideosCard({
  items,
  sort,
  onSortChange,
}: {
  items: TopVideoItem[];
  sort: VideoSortKey;
  onSortChange: (value: VideoSortKey) => void;
}) {
  return (
    <article className="rounded-[1.55rem] border border-white/[0.08] bg-white/[0.03] p-4 shadow-[0_24px_70px_rgba(0,0,0,0.2)] backdrop-blur sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-[0.68rem] uppercase tracking-[0.26em] text-muted-foreground">
            Top Videos
          </p>
          <p className="mt-1.5 text-[0.86rem] leading-6 text-muted-foreground">
            The highest-signal content blocks, still organized in the same calm frame.
          </p>
        </div>

        <div className="flex gap-2">
          <SortChip
            active={sort === "views"}
            label="Views"
            onClick={() => onSortChange("views")}
          />
          <SortChip
            active={sort === "engagement"}
            label="Engagement"
            onClick={() => onSortChange("engagement")}
          />
        </div>
      </div>

      <div className="mt-5 space-y-2.5">
        {items.length > 0 ? (
          items.map((item) => {
            const campaignTone = getCampaignColorTone(item.campaignId ?? item.badge);
            const normalizedAccount = normalizeIdentityLabel(item.account);
            const normalizedHandle = normalizeIdentityLabel(item.handle);
            const metadataParts = [
              normalizedAccount && normalizedAccount !== normalizedHandle
                ? item.account
                : null,
              item.handle.trim() ? item.handle : null,
              item.platform.trim() ? item.platform : null,
            ].filter((part): part is string => Boolean(part));

            return (
              <div
                key={item.id}
                className="flex items-center gap-3 rounded-[1.1rem] border border-white/[0.08] bg-black/[0.18] px-3.5 py-3 transition hover:border-white/[0.14] hover:bg-white/[0.04]"
              >
                <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-[0.85rem] bg-black/[0.28]">
                  <div
                    aria-hidden="true"
                    className="absolute inset-0"
                    style={
                      item.thumbnailUrl
                        ? getBackgroundImageStyle(item.thumbnailUrl)
                        : { backgroundImage: campaignTone.gradient }
                    }
                  />
                  <div
                    aria-hidden="true"
                    className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.12),rgba(0,0,0,0.02)_42%,rgba(0,0,0,0.38))]"
                  />
                </div>

                <div className="min-w-0 flex-1">
                  <p className="truncate text-[0.92rem] font-medium text-foreground">
                    {item.title}
                  </p>
                  <CampaignBadge
                    campaignId={item.campaignId}
                    className="mt-1 border-black/10"
                    compact
                    label={item.badge}
                  />
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[0.72rem] text-muted-foreground">
                    {metadataParts.map((part, index) => (
                      <span
                        key={`${item.id}-meta-${part}-${index}`}
                        className="inline-flex items-center gap-1.5"
                      >
                        {index > 0 ? (
                          <span className="h-1 w-1 rounded-full bg-white/[0.18]" />
                        ) : null}
                        <span>{part}</span>
                      </span>
                    ))}
                  </div>
                </div>

                <div className="text-right">
                  <p className="text-[0.92rem] font-medium text-foreground">
                    {sort === "views" ? item.views : item.engagement}
                  </p>
                  <p className="mt-0.5 text-[0.56rem] uppercase tracking-[0.16em] text-muted-foreground">
                    {sort === "views" ? "Views" : "Engagement"}
                  </p>
                </div>
              </div>
            );
          })
        ) : (
          <div className="rounded-[1.1rem] border border-dashed border-white/[0.08] bg-black/[0.18] px-4 py-8 text-[0.92rem] text-muted-foreground">
            No videos matched the current filters yet.
          </div>
        )}
      </div>
    </article>
  );
}

function TopAccountsCard({
  items,
  organizationSlug,
  sort,
  onSortChange,
}: {
  items: TopAccountItem[];
  organizationSlug: string;
  sort: AccountSortKey;
  onSortChange: (value: AccountSortKey) => void;
}) {
  return (
    <article className="rounded-[1.55rem] border border-white/[0.08] bg-white/[0.03] p-4 shadow-[0_24px_70px_rgba(0,0,0,0.2)] backdrop-blur sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-[0.68rem] uppercase tracking-[0.26em] text-muted-foreground">
            Top Accounts
          </p>
          <p className="mt-1.5 text-[0.86rem] leading-6 text-muted-foreground">
            Account ranking stays close to the viral.app pattern, but inside a campaign-first shell.
          </p>
        </div>

        <div className="flex gap-2">
          <SortChip
            active={sort === "views"}
            label="Views"
            onClick={() => onSortChange("views")}
          />
          <SortChip
            active={sort === "growth"}
            label="Growth"
            onClick={() => onSortChange("growth")}
          />
        </div>
      </div>

      <div className="mt-5 space-y-2.5">
        {items.length > 0 ? (
          items.map((item) => {
            const cardClassName =
              "flex cursor-pointer items-center gap-3 rounded-[1.1rem] border border-white/[0.08] bg-black/[0.18] px-3.5 py-3 transition hover:border-white/[0.14] hover:bg-white/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30";
            const metricsLabel = sort === "views" ? "Views" : "Growth";
            const details = (
              <>
                <div className="relative inline-flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-black/[0.24] text-[0.78rem] font-semibold text-black">
                  <div
                    aria-hidden="true"
                    className="absolute inset-0"
                    style={
                      item.imageUrl
                        ? getBackgroundImageStyle(item.imageUrl)
                        : { backgroundImage: item.accent }
                    }
                  />
                  {!item.imageUrl ? (
                    <span className="relative z-10">{getInitials(item.name)}</span>
                  ) : null}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-[0.92rem] font-medium text-foreground">
                      {item.name}
                    </p>
                    <span className="rounded-full border border-white/[0.08] bg-white/[0.04] px-1.5 py-0.5 text-[0.52rem] uppercase tracking-[0.16em] text-muted-foreground">
                      {item.platform}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[0.72rem] text-muted-foreground">
                    {item.handle}
                  </p>
                </div>

                <div className="text-right">
                  <p className="text-[0.92rem] font-medium text-foreground">
                    {sort === "views" ? item.views : item.growth}
                  </p>
                  <p className="mt-0.5 text-[0.56rem] uppercase tracking-[0.16em] text-muted-foreground">
                    {metricsLabel}
                  </p>
                </div>
              </>
            );

            if (item.profileUrl) {
              return (
                <a
                  key={item.id}
                  className={cardClassName}
                  href={item.profileUrl}
                  rel="noreferrer noopener"
                  target="_blank"
                >
                  {details}
                </a>
              );
            }

            return (
              <Link
                key={item.id}
                className={cardClassName}
                href={`/org/${organizationSlug}/accounts?accounts=${encodeURIComponent(item.id)}`}
                prefetch={false}
              >
                {details}
              </Link>
            );
          })
        ) : (
          <div className="rounded-[1.1rem] border border-dashed border-white/[0.08] bg-black/[0.18] px-4 py-8 text-[0.92rem] text-muted-foreground">
            No accounts matched the current filters yet.
          </div>
        )}
      </div>
    </article>
  );
}

function SortChip({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className={`rounded-full border px-2.5 py-1.5 text-[0.82rem] transition ${
        active
          ? "border-white/[0.14] bg-white/[0.08] text-foreground"
          : "border-white/[0.08] bg-white/[0.04] text-muted-foreground hover:border-white/[0.14] hover:bg-white/[0.07] hover:text-foreground"
      }`}
      onClick={onClick}
      type="button"
    >
      {label}
    </button>
  );
}
