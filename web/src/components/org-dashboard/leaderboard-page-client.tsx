"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

import type { LeaderboardPageData } from "@/server/dashboard/leaderboard";

import { CampaignBadge } from "./campaign-badge";

type LeaderboardPageClientProps = {
  data: LeaderboardPageData;
};

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

function getBackgroundImageStyle(imageUrl: string) {
  return {
    backgroundImage: `url(${JSON.stringify(imageUrl)})`,
    backgroundPosition: "center",
    backgroundRepeat: "no-repeat",
    backgroundSize: "cover",
  } as const;
}

function getEmptyStateCopy(data: LeaderboardPageData) {
  if (data.campaignOptions.length === 0) {
    return "You need access to at least one campaign before a leaderboard can be shown here.";
  }

  if (data.totalVideosCount === 0) {
    return "No tracked videos from this campaign were published in the selected period yet.";
  }

  return "Videos matched this range, but view counts have not synced for ranking yet.";
}

export function LeaderboardPageClient({
  data,
}: LeaderboardPageClientProps) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const defaultDateRangeId =
    data.dateRangeOptions[1]?.id ?? data.dateRangeOptions[0]?.id ?? "";
  const selectionSummary =
    data.matchingCreatorsCount > data.showingCreatorsCount
      ? `Showing top ${data.showingCreatorsCount} of ${data.matchingCreatorsCount} creators`
      : data.showingCreatorsCount > 0
        ? `Showing ${data.showingCreatorsCount} creator${data.showingCreatorsCount === 1 ? "" : "s"}`
        : "No creators ranked yet";

  function updateSearchParams(updater: (params: URLSearchParams) => void) {
    const params = new URLSearchParams(searchParams.toString());
    updater(params);
    const nextQuery = params.toString();
    router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname);
  }

  function handleCampaignChange(nextCampaignId: string) {
    updateSearchParams((params) => {
      params.delete("page");

      if (!nextCampaignId) {
        params.delete("campaign");
        params.delete("campaigns");
        return;
      }

      params.set("campaign", nextCampaignId);
      params.set("campaigns", nextCampaignId);
    });
  }

  function handleRangeChange(nextRangeId: string) {
    updateSearchParams((params) => {
      params.delete("page");

      if (!nextRangeId || nextRangeId === defaultDateRangeId) {
        params.delete("range");
        return;
      }

      params.set("range", nextRangeId);
    });
  }

  return (
    <div className="space-y-4">
      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.18fr)_minmax(0,0.82fr)]">
        <article className="rounded-[1.55rem] border border-white/[0.08] bg-white/[0.03] p-4 shadow-[0_24px_70px_rgba(0,0,0,0.2)] backdrop-blur sm:p-5">
          <p className="text-xs uppercase tracking-[0.28em] text-muted-foreground">
            Creator leaderboard
          </p>
          <h1 className="mt-3 max-w-3xl text-2xl font-medium tracking-[-0.045em] text-foreground">
            {data.selectedCampaign
              ? `Top creators for ${data.selectedCampaign.label}`
              : "Top creators by campaign views"}
          </h1>
          <p className="mt-3 max-w-2xl text-[0.92rem] leading-6 text-muted-foreground">
            Rank creators by total views across campaign videos published inside
            the selected date window.
          </p>

          <div className="mt-5 flex flex-wrap gap-2">
            {data.selectedCampaign ? (
              <CampaignBadge
                campaignId={data.selectedCampaign.id}
                label={data.selectedCampaign.label}
              />
            ) : null}
            <SummaryPill>{data.selectedDateRangeLabel}</SummaryPill>
            <SummaryPill>{data.periodLabel}</SummaryPill>
            <SummaryPill>{selectionSummary}</SummaryPill>
          </div>
        </article>

        <aside className="rounded-[1.55rem] border border-white/[0.08] bg-white/[0.03] p-4 shadow-[0_24px_70px_rgba(0,0,0,0.2)] backdrop-blur sm:p-5">
          <p className="text-xs uppercase tracking-[0.28em] text-muted-foreground">
            Filters
          </p>

          <div className="mt-4 space-y-4">
            <label className="block">
              <span className="mb-2 block text-[0.62rem] uppercase tracking-[0.22em] text-muted-foreground">
                Campaign
              </span>
              <select
                className="h-11 w-full rounded-[0.95rem] border border-white/[0.08] bg-black/[0.24] px-3.5 text-sm text-foreground outline-none transition focus:border-white/[0.16] disabled:cursor-not-allowed disabled:text-muted-foreground/70"
                disabled={data.campaignOptions.length === 0}
                onChange={(event) => handleCampaignChange(event.target.value)}
                value={data.selectedCampaign?.id ?? ""}
              >
                {data.campaignOptions.length === 0 ? (
                  <option value="">No campaigns available</option>
                ) : null}
                {data.campaignOptions.map((campaign) => (
                  <option key={campaign.id} value={campaign.id}>
                    {campaign.label}
                  </option>
                ))}
              </select>
            </label>

            <div>
              <span className="block text-[0.62rem] uppercase tracking-[0.22em] text-muted-foreground">
                Period
              </span>
              <div className="mt-2 flex flex-wrap gap-2">
                {data.dateRangeOptions.map((option) => {
                  const isActive = option.id === data.selectedDateRangeId;

                  return (
                    <button
                      key={option.id}
                      className={`rounded-full border px-3 py-1.5 text-[0.82rem] transition ${
                        isActive
                          ? "border-white/[0.14] bg-white/[0.08] text-foreground"
                          : "border-white/[0.08] bg-white/[0.04] text-muted-foreground hover:border-white/[0.14] hover:bg-white/[0.07] hover:text-foreground"
                      }`}
                      onClick={() => handleRangeChange(option.id)}
                      type="button"
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </aside>
      </section>

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Total views"
          meta="Across campaign videos in range"
          value={data.totalViewsLabel}
        />
        <StatCard
          label="Creators ranked"
          meta={
            data.matchingCreatorsCount > 20
              ? "Top 20 shown below"
              : "All matching creators shown"
          }
          value={data.matchingCreatorsLabel}
        />
        <StatCard
          label="Videos counted"
          meta="Published in the selected window"
          value={data.totalVideosLabel}
        />
        <StatCard
          compact
          label="Leader"
          meta={data.leader ? `${data.leader.viewsLabel} views` : "No ranked creator yet"}
          value={data.leader?.name ?? "--"}
        />
      </section>

      <section className="rounded-[1.55rem] border border-white/[0.08] bg-white/[0.03] p-5 shadow-[0_24px_70px_rgba(0,0,0,0.2)] backdrop-blur">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.28em] text-muted-foreground">
              Top 20 creators
            </p>
            <h2 className="mt-2 text-xl font-medium tracking-[-0.04em] text-foreground">
              Campaign leaderboard table
            </h2>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              Sorted by total views, with share of campaign views and best video
              context for each creator.
            </p>
          </div>

          {data.selectedCampaign ? (
            <CampaignBadge
              campaignId={data.selectedCampaign.id}
              label={data.selectedCampaign.label}
            />
          ) : null}
        </div>

        {data.rows.length > 0 ? (
          <div className="mt-5 overflow-x-auto rounded-[1.2rem] border border-white/[0.08] bg-black/[0.18]">
            <table className="min-w-[1100px] w-full border-collapse text-left">
              <thead className="bg-white/[0.03]">
                <tr>
                  <th className="px-4 py-3 text-[0.62rem] font-normal uppercase tracking-[0.22em] text-muted-foreground">
                    Rank
                  </th>
                  <th className="px-4 py-3 text-[0.62rem] font-normal uppercase tracking-[0.22em] text-muted-foreground">
                    Creator
                  </th>
                  <th className="px-4 py-3 text-[0.62rem] font-normal uppercase tracking-[0.22em] text-muted-foreground">
                    Videos
                  </th>
                  <th className="px-4 py-3 text-[0.62rem] font-normal uppercase tracking-[0.22em] text-muted-foreground">
                    Total views
                  </th>
                  <th className="px-4 py-3 text-[0.62rem] font-normal uppercase tracking-[0.22em] text-muted-foreground">
                    Avg / video
                  </th>
                  <th className="px-4 py-3 text-[0.62rem] font-normal uppercase tracking-[0.22em] text-muted-foreground">
                    Best video
                  </th>
                  <th className="px-4 py-3 text-[0.62rem] font-normal uppercase tracking-[0.22em] text-muted-foreground">
                    Latest post
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row) => {
                  const shareBarWidth =
                    row.shareOfViewsPercent > 0
                      ? Math.max(row.shareOfViewsPercent, 4)
                      : 0;

                  return (
                    <tr
                      key={row.id}
                      className="border-t border-white/[0.08] align-top transition hover:bg-white/[0.02]"
                    >
                      <td className="px-4 py-4">
                        <RankBadge rank={row.rank} />
                      </td>
                      <td className="px-4 py-4">
                        <div className="flex items-center gap-3">
                          <CreatorAvatar
                            imageUrl={row.avatarUrl}
                            name={row.creatorName}
                          />
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-foreground">
                              {row.creatorName}
                            </p>
                            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                              {row.handle ? <span>{row.handle}</span> : null}
                              {row.handle && row.platformLabel ? (
                                <span className="h-1 w-1 rounded-full bg-white/[0.18]" />
                              ) : null}
                              <span>{row.platformLabel ?? "No linked account"}</span>
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-4 text-sm text-foreground">
                        {row.videosCountLabel}
                      </td>
                      <td className="px-4 py-4">
                        <p className="text-sm font-medium text-foreground">
                          {row.totalViewsLabel}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {row.shareOfViewsLabel} of campaign views
                        </p>
                        <div className="mt-2 h-1.5 w-full max-w-[10rem] overflow-hidden rounded-full bg-white/[0.06]">
                          <div
                            className="h-full rounded-full bg-[linear-gradient(90deg,rgba(144,255,77,0.95),rgba(124,255,176,0.82))]"
                            style={{ width: `${shareBarWidth}%` }}
                          />
                        </div>
                      </td>
                      <td className="px-4 py-4 text-sm text-foreground">
                        {row.averageViewsLabel}
                      </td>
                      <td className="px-4 py-4">
                        <p
                          className="max-w-[20rem] truncate text-sm text-foreground"
                          title={row.bestVideoTitle}
                        >
                          {row.bestVideoTitle}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {row.bestVideoViewsLabel} views
                        </p>
                      </td>
                      <td className="px-4 py-4 text-sm text-muted-foreground">
                        {row.lastPostLabel ?? "--"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="mt-5 rounded-[1.2rem] border border-dashed border-white/[0.08] bg-black/[0.18] px-4 py-10 text-sm text-muted-foreground">
            {getEmptyStateCopy(data)}
          </div>
        )}
      </section>
    </div>
  );
}

function SummaryPill({
  children,
}: {
  children: string;
}) {
  return (
    <span className="rounded-full border border-white/[0.08] bg-black/[0.22] px-2.5 py-1.5 text-[0.58rem] uppercase tracking-[0.2em] text-muted-foreground">
      {children}
    </span>
  );
}

function StatCard({
  label,
  meta,
  value,
  compact = false,
}: {
  label: string;
  meta: string;
  value: string;
  compact?: boolean;
}) {
  return (
    <article className="rounded-[1.25rem] border border-white/[0.08] bg-white/[0.03] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
      <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">
        {label}
      </p>
      <p
        className={`mt-3 font-medium tracking-[-0.05em] text-foreground ${
          compact ? "text-[1.25rem] leading-7" : "text-[1.7rem]"
        }`}
      >
        {value}
      </p>
      <p className="mt-2 text-[0.72rem] leading-5 text-muted-foreground">
        {meta}
      </p>
    </article>
  );
}

function RankBadge({
  rank,
}: {
  rank: number;
}) {
  const tone =
    rank === 1
      ? "border-[#90FF4D]/25 bg-[#90FF4D]/10 text-[#C7FFA4]"
      : rank === 2
        ? "border-white/[0.12] bg-white/[0.08] text-foreground"
        : rank === 3
          ? "border-[#A77AFF]/25 bg-[#A77AFF]/12 text-[#D3C2FF]"
          : "border-white/[0.08] bg-white/[0.04] text-muted-foreground";

  return (
    <span
      className={`inline-flex h-9 min-w-9 items-center justify-center rounded-full border px-2 text-sm font-medium ${tone}`}
    >
      {rank}
    </span>
  );
}

function CreatorAvatar({
  imageUrl,
  name,
}: {
  imageUrl?: string;
  name: string;
}) {
  return (
    <div className="relative inline-flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full border border-white/[0.08] bg-black/[0.24] text-[0.76rem] font-semibold text-foreground">
      {imageUrl ? (
        <div
          aria-hidden="true"
          className="absolute inset-0"
          style={getBackgroundImageStyle(imageUrl)}
        />
      ) : null}
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-[linear-gradient(135deg,rgba(144,255,77,0.18),rgba(255,255,255,0.04))]"
      />
      {!imageUrl ? <span className="relative z-10">{getInitials(name)}</span> : null}
    </div>
  );
}
