import {
  DashboardIcon,
  type DashboardIconName,
} from "@/components/org-dashboard/org-icons";
import { Suspense, type ReactNode } from "react";
import { type DashboardSearchParams } from "@/server/dashboard/filters";
import {
  getOrganizationViewTallyData,
  type ViewTallyListItem,
  type ViewTallyTopAccount,
} from "@/server/videos/queries";
import { AdSpendSection } from "./ad-spend-section";

export const dynamic = "force-dynamic";

type ViewTallyPageProps = {
  params: Promise<{
    organizationSlug: string;
  }>;
  searchParams: Promise<DashboardSearchParams>;
};

type ViewTallyData = Awaited<ReturnType<typeof getOrganizationViewTallyData>>;

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});
const wholeNumberFormatter = new Intl.NumberFormat("en-US");
const compactNumberFormatter = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
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

function formatCompactMetricValue(value: number | null | undefined, fallback = "--") {
  if (typeof value !== "number") {
    return fallback;
  }

  return compactNumberFormatter.format(value);
}

function getNetViews(item: { views: number | null; paidViews: number | null }) {
  return Math.max((item.views ?? 0) - (item.paidViews ?? 0), 0);
}

function formatNetViewsWithGross(item: {
  views: number | null;
  paidViews: number | null;
}) {
  const netViews = getNetViews(item);
  const grossViews = item.views ?? 0;
  const paidViews = item.paidViews ?? 0;
  const netLabel = formatCompactMetricValue(netViews);

  return paidViews > 0 && grossViews > netViews
    ? `${netLabel} (${formatCompactMetricValue(grossViews)})`
    : netLabel;
}

function formatNetTotalViewsWithGross(data: ViewTallyData) {
  const netViews = data.totals.unpaidViews;
  const grossViews = data.totals.totalViews;
  const deductedPaidViews = data.totals.deductedPaidViews;
  const netLabel = formatCompactMetricValue(netViews);

  return deductedPaidViews > 0 && grossViews > netViews
    ? `${netLabel} (${formatCompactMetricValue(grossViews)})`
    : netLabel;
}

function truncateCopy(value: string, maxLength: number) {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}...` : value;
}

function getViewTitle(item: ViewTallyListItem) {
  const title = item.titleOrCaption?.trim();

  return title && title.length > 0 ? title : `${item.creatorName} on TikTok`;
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

function buildViewTallyHref(
  searchParams: DashboardSearchParams,
  updates: Record<string, string | number | null>,
) {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(searchParams ?? {}) as Array<
    [string, string | string[] | undefined]
  >) {
    if (Array.isArray(value)) {
      for (const item of value) {
        params.append(key, item);
      }
    } else if (value) {
      params.set(key, value);
    }
  }

  for (const [key, value] of Object.entries(updates)) {
    if (value === null) {
      params.delete(key);
    } else {
      params.set(key, String(value));
    }
  }

  const queryString = params.toString();
  return queryString ? `?${queryString}` : "?";
}

function ControlShell({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`flex min-h-12 items-center gap-3 rounded-[1rem] border border-white/[0.08] bg-black/[0.22] px-4 text-sm text-muted-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] ${className}`}
    >
      {children}
    </div>
  );
}

function MetricCard({
  label,
  value,
  iconName,
  tone,
}: {
  label: string;
  value: string;
  iconName: DashboardIconName;
  tone: "green" | "blue" | "orange";
}) {
  const glowClass =
    tone === "green"
      ? "from-[#6DFF8F]/12 via-[#6DFF8F]/4 to-transparent"
      : tone === "blue"
        ? "from-[#6D95FF]/14 via-[#6D95FF]/4 to-transparent"
        : "from-[#FFB86D]/14 via-[#FFB86D]/4 to-transparent";

  return (
    <article className="group relative min-h-[6.5rem] overflow-hidden rounded-[1.35rem] border border-white/[0.08] bg-[#0C0D10] p-4 shadow-[0_20px_60px_rgba(0,0,0,0.22)]">
      <div
        aria-hidden="true"
        className={`absolute inset-0 bg-[radial-gradient(circle_at_12%_0%,var(--tw-gradient-stops))] ${glowClass}`}
      />
      <div className="relative flex items-center gap-4">
        <div className="flex h-[4.25rem] w-[4.25rem] shrink-0 items-center justify-center rounded-[1.15rem] border border-white/[0.08] bg-black shadow-[0_16px_36px_rgba(0,0,0,0.35)]">
          <DashboardIcon className="h-7 w-7 text-foreground" name={iconName} />
        </div>
        <div className="min-w-0">
          <p className="text-[0.95rem] font-medium text-muted-foreground">{label}</p>
          <p className="mt-1 text-[2rem] font-semibold leading-none tracking-[-0.06em] text-foreground sm:text-[2.25rem]">
            {value}
          </p>
        </div>
      </div>
      <DashboardIcon
        aria-hidden="true"
        className="absolute right-4 top-4 h-4 w-4 text-muted-foreground/30"
        name="dotsHorizontal"
      />
    </article>
  );
}

function LeaderboardPanel({
  title,
  leftControl,
  limit,
  limitOptions,
  searchParams,
  children,
}: {
  title: string;
  leftControl: string;
  limit: number;
  limitOptions: number[];
  searchParams: DashboardSearchParams;
  children: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-[1.45rem] border border-white/[0.08] bg-[#0D0E11] shadow-[0_24px_70px_rgba(0,0,0,0.24)]">
      <header className="flex min-h-[5.35rem] items-center justify-between gap-3 border-b border-white/[0.08] px-5">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold tracking-[-0.04em] text-foreground">
            {title}
          </h2>
          <span className="flex h-4 w-4 items-center justify-center rounded-full border border-white/[0.16] text-[0.62rem] text-muted-foreground">
            i
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button className="inline-flex h-10 items-center gap-2 rounded-[0.95rem] border border-white/[0.08] bg-black/[0.18] px-3 text-sm font-medium text-foreground" type="button">
            {leftControl}
            <DashboardIcon className="h-3.5 w-3.5 text-muted-foreground" name="chevronDown" />
          </button>
          <details className="group relative">
            <summary className="inline-flex h-10 cursor-pointer list-none items-center gap-2 rounded-[0.95rem] border border-white/[0.08] bg-black/[0.18] px-3 text-sm font-medium text-foreground [&::-webkit-details-marker]:hidden">
              {limit}
              <DashboardIcon className="h-3.5 w-3.5 text-muted-foreground transition group-open:rotate-180" name="chevronDown" />
            </summary>
            <div className="absolute right-0 top-12 z-30 w-24 overflow-hidden rounded-[0.95rem] border border-white/[0.1] bg-[#0B0C0F] py-1 shadow-[0_24px_60px_rgba(0,0,0,0.45)]">
              {limitOptions.map((option) => (
                <a
                  className={`block px-3 py-2 text-sm transition hover:bg-white/[0.08] ${
                    option === limit
                      ? "bg-white/[0.1] text-foreground"
                      : "text-muted-foreground"
                  }`}
                  href={buildViewTallyHref(searchParams, { topLimit: option })}
                  key={option}
                >
                  {option}
                </a>
              ))}
            </div>
          </details>
        </div>
      </header>
      <div className="divide-y divide-white/[0.07]">{children}</div>
    </section>
  );
}

function TopVideoRow({ item }: { item: ViewTallyListItem }) {
  const title = getViewTitle(item);
  const handleLabel = getHandleLabel(item.accountHandle);

  return (
    <article className="relative grid min-h-[6.25rem] grid-cols-[minmax(0,1fr)_8rem] overflow-hidden bg-[#0B0C0F] transition hover:bg-[#101218] sm:grid-cols-[minmax(0,1fr)_10rem]">
      <div className="flex min-w-0 gap-3 px-5 py-3.5">
        <a
          className="relative h-[4.7rem] w-[3.25rem] shrink-0 overflow-hidden rounded-[0.7rem] border border-white/[0.08] bg-black"
          href={item.videoUrl}
          rel="noreferrer"
          target="_blank"
        >
          {item.thumbnailUrl ? (
            <>
              <div aria-hidden="true" className="absolute inset-0" style={getBackgroundImageStyle(item.thumbnailUrl)} />
              <div aria-hidden="true" className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.08),rgba(0,0,0,0.12)_45%,rgba(0,0,0,0.58))]" />
            </>
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-[0.56rem] uppercase tracking-[0.16em] text-muted-foreground">
              TikTok
            </div>
          )}
          <div className="absolute bottom-1 right-1 flex h-5 w-5 items-center justify-center rounded-full border border-white/[0.18] bg-black/80">
            <DashboardIcon className="h-3 w-3 text-foreground" name="videos" />
          </div>
        </a>
        <div className="min-w-0 py-0.5">
          <a
            className="line-clamp-2 text-sm font-semibold leading-5 text-foreground transition hover:text-[#B9FF95]"
            href={item.videoUrl}
            rel="noreferrer"
            target="_blank"
            title={title}
          >
            {truncateCopy(title, 120)}
          </a>
          <div className="mt-2 flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
            <span className="h-5 w-5 shrink-0 overflow-hidden rounded-full border border-white/[0.08] bg-white/[0.08]" />
            <span className="truncate font-medium text-foreground/80">
              {handleLabel ?? item.creatorName}
            </span>
            <span className="rounded-[0.28rem] bg-white/[0.12] px-1 text-[0.56rem] text-muted-foreground">
              TikTok
            </span>
          </div>
        </div>
      </div>
      <div className="relative flex items-center justify-end px-5 text-right">
        <div aria-hidden="true" className="absolute inset-y-0 right-0 w-full bg-[linear-gradient(90deg,rgba(13,14,17,0),rgba(29,43,79,0.58))]" />
        <p className="relative text-base font-semibold tracking-[0.04em] text-foreground">
          {formatNetViewsWithGross(item)}
        </p>
      </div>
      <DashboardIcon
        aria-hidden="true"
        className="absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/55"
        name="dotsHorizontal"
      />
    </article>
  );
}

function TopAccountRow({ item }: { item: ViewTallyTopAccount }) {
  const handleLabel = getHandleLabel(item.handle);

  return (
    <article className="relative grid min-h-[6.25rem] grid-cols-[minmax(0,1fr)_8rem] overflow-hidden bg-[#0B0C0F] transition hover:bg-[#101218] sm:grid-cols-[minmax(0,1fr)_10rem]">
      <div className="flex min-w-0 items-center gap-4 px-5 py-3.5">
        <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-full border border-white/[0.08] bg-white/[0.08]">
          {item.avatarUrl ? (
            <div aria-hidden="true" className="absolute inset-0" style={getBackgroundImageStyle(item.avatarUrl)} />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-sm font-semibold text-foreground">
              {item.label.slice(0, 1).toUpperCase()}
            </div>
          )}
        </div>
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <p className="truncate text-sm font-semibold text-foreground">{handleLabel ?? item.label}</p>
            <span className="rounded-[0.28rem] bg-white/[0.12] px-1 text-[0.56rem] text-muted-foreground">
              TikTok
            </span>
          </div>
          <p className="mt-1 truncate text-sm text-muted-foreground">
            {handleLabel ? item.label : `${formatMetricValue(item.videos)} videos`}
          </p>
        </div>
      </div>
      <div className="relative flex items-center justify-end px-5 text-right">
        <div aria-hidden="true" className="absolute inset-y-0 right-0 w-full bg-[linear-gradient(90deg,rgba(13,14,17,0),rgba(29,43,79,0.58))]" />
        <p className="relative text-base font-semibold tracking-[0.04em] text-foreground">
          {formatNetViewsWithGross(item)}
        </p>
      </div>
      <DashboardIcon
        aria-hidden="true"
        className="absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/55"
        name="dotsHorizontal"
      />
    </article>
  );
}

function EmptyPanelRow({ label }: { label: string }) {
  return (
    <div className="px-5 py-12 text-sm text-muted-foreground">
      {label}
    </div>
  );
}

function SkeletonBar({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`animate-pulse rounded-full bg-white/[0.08] ${className}`}
    />
  );
}

function ViewTallyPanelSkeleton({ title }: { title: string }) {
  return (
    <section className="overflow-hidden rounded-[1.45rem] border border-white/[0.08] bg-[#0D0E11] shadow-[0_24px_70px_rgba(0,0,0,0.24)]">
      <header className="flex min-h-[5.35rem] items-center justify-between gap-3 border-b border-white/[0.08] px-5">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold tracking-[-0.04em] text-foreground">
            {title}
          </h2>
          <span className="flex h-4 w-4 items-center justify-center rounded-full border border-white/[0.16] text-[0.62rem] text-muted-foreground">
            i
          </span>
        </div>
        <div className="flex items-center gap-2">
          <SkeletonBar className="h-10 w-20 rounded-[0.95rem]" />
          <SkeletonBar className="h-10 w-14 rounded-[0.95rem]" />
        </div>
      </header>
      <div className="divide-y divide-white/[0.07]">
        {Array.from({ length: 5 }, (_, index) => (
          <div
            className="grid min-h-[6.25rem] grid-cols-[minmax(0,1fr)_8rem] bg-[#0B0C0F] sm:grid-cols-[minmax(0,1fr)_10rem]"
            key={index}
          >
            <div className="flex min-w-0 items-center gap-3 px-5 py-3.5">
              <SkeletonBar className="h-[4.7rem] w-[3.25rem] shrink-0 rounded-[0.7rem]" />
              <div className="min-w-0 flex-1 space-y-3">
                <SkeletonBar className="h-4 w-[min(22rem,82%)]" />
                <SkeletonBar className="h-3 w-[min(14rem,58%)]" />
              </div>
            </div>
            <div className="flex items-center justify-end px-5">
              <SkeletonBar className="h-4 w-16" />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function ViewTallyPageSkeleton() {
  return (
    <div className="space-y-5">
      <form className="grid gap-3 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1.1fr)_auto_auto_auto]">
        <ControlShell>
          <DashboardIcon className="h-5 w-5 shrink-0" name="accounts" />
          <SkeletonBar className="h-4 w-36" />
        </ControlShell>
        <ControlShell>
          <DashboardIcon className="h-5 w-5 shrink-0" name="campaigns" />
          <SkeletonBar className="h-4 w-32" />
        </ControlShell>
        <ControlShell className="justify-center px-3">
          <SkeletonBar className="h-7 w-28" />
        </ControlShell>
        <ControlShell className="gap-2 px-3">
          <DashboardIcon className="h-5 w-5 shrink-0" name="calendar" />
          <SkeletonBar className="h-4 w-36" />
        </ControlShell>
        <SkeletonBar className="min-h-12 rounded-[1rem]" />
      </form>

      <section className="grid gap-4 lg:grid-cols-3">
        {(["videos", "integrations", "viralVideos"] as DashboardIconName[]).map(
          (iconName) => (
            <article
              className="relative min-h-[6.5rem] overflow-hidden rounded-[1.35rem] border border-white/[0.08] bg-[#0C0D10] p-4 shadow-[0_20px_60px_rgba(0,0,0,0.22)]"
              key={iconName}
            >
              <div className="relative flex items-center gap-4">
                <div className="flex h-[4.25rem] w-[4.25rem] shrink-0 items-center justify-center rounded-[1.15rem] border border-white/[0.08] bg-black">
                  <DashboardIcon className="h-7 w-7 text-muted-foreground/55" name={iconName} />
                </div>
                <div className="min-w-0 flex-1 space-y-3">
                  <SkeletonBar className="h-4 w-28" />
                  <SkeletonBar className="h-8 w-24" />
                </div>
              </div>
            </article>
          ),
        )}
      </section>

      <section className="grid gap-5 xl:grid-cols-2">
        <ViewTallyPanelSkeleton title="Top Videos" />
        <ViewTallyPanelSkeleton title="Top Accounts" />
      </section>

      <section className="overflow-hidden rounded-[1.45rem] border border-white/[0.08] bg-[#0D0E11] shadow-[0_24px_70px_rgba(0,0,0,0.24)]">
        <header className="flex min-h-[6rem] items-center justify-between gap-3 border-b border-white/[0.08] px-5">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold tracking-[-0.04em] text-foreground">
                Ad Spend by Ad and Content
              </h2>
              <span className="flex h-4 w-4 items-center justify-center rounded-full border border-white/[0.16] text-[0.62rem] text-muted-foreground">
                i
              </span>
            </div>
            <SkeletonBar className="mt-3 h-3 w-[min(32rem,80vw)]" />
          </div>
          <SkeletonBar className="h-16 w-32 rounded-[1rem]" />
        </header>
        <div className="px-5 py-12">
          <SkeletonBar className="h-4 w-64" />
        </div>
      </section>
    </div>
  );
}

function ViewTallyControls({ data }: { data: ViewTallyData }) {
  return (
    <form className="grid gap-3 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1.1fr)_auto_auto_auto]" method="get">
      <ControlShell>
        <DashboardIcon className="h-5 w-5 shrink-0" name="accounts" />
        <select
          className="h-8 min-w-0 flex-1 appearance-none bg-transparent text-sm font-medium text-foreground outline-none"
          defaultValue={data.selectedCreator?.id ?? "all"}
          disabled={data.creatorOptions.length === 0}
          name="creator"
        >
          <option value="all">All accounts</option>
          {data.creatorOptions.map((creator) => (
            <option key={creator.id} value={creator.id}>
              {creator.meta ? `${creator.label} (${creator.meta})` : creator.label}
            </option>
          ))}
        </select>
        <DashboardIcon className="h-4 w-4 shrink-0 text-muted-foreground" name="chevronDown" />
      </ControlShell>

      <ControlShell className="opacity-75">
        <DashboardIcon className="h-5 w-5 shrink-0" name="campaigns" />
        <span className="min-w-0 flex-1 truncate font-medium">Select projects</span>
      </ControlShell>

      <ControlShell className="justify-center px-3">
        <span className="rounded-full bg-white/[0.12] px-2.5 py-1 text-xs font-semibold text-foreground">TikTok</span>
        <span className="text-xs font-semibold text-muted-foreground">IG</span>
        <span className="text-xs font-semibold text-muted-foreground">YT</span>
        <span className="text-xs font-semibold text-muted-foreground">FB</span>
      </ControlShell>

      <ControlShell className="gap-2 px-3">
        <DashboardIcon className="h-5 w-5 shrink-0" name="calendar" />
        <input
          className="h-8 w-[8.5rem] bg-transparent text-sm font-medium text-foreground outline-none"
          defaultValue={data.startDate}
          name="startDate"
          type="date"
        />
        <span className="text-muted-foreground/50">/</span>
        <input
          className="h-8 w-[8.5rem] bg-transparent text-sm font-medium text-foreground outline-none"
          defaultValue={data.endDate}
          name="endDate"
          type="date"
        />
      </ControlShell>

      <button
        className="flex min-h-12 items-center justify-center rounded-[1rem] border border-white/[0.1] bg-white/[0.06] px-5 text-sm font-semibold text-foreground transition hover:bg-white/[0.1]"
        type="submit"
      >
        Apply
      </button>
    </form>
  );
}

async function ViewTallyPageContent({
  organizationSlug,
  resolvedSearchParams,
}: {
  organizationSlug: string;
  resolvedSearchParams: DashboardSearchParams;
}) {
  const data = await getOrganizationViewTallyData({
    organizationSlug,
    searchParams: resolvedSearchParams,
    includeAdSpend: false,
  });
  const adSpendApiPath = `/api/org/${encodeURIComponent(organizationSlug)}/view-tally/ad-spend${buildViewTallyHref(resolvedSearchParams, {
    startDate: data.startDate,
    endDate: data.endDate,
  })}`;

  return (
    <div className="space-y-5">
      <ViewTallyControls data={data} />

      {data.errorMessage ? (
        <section className="rounded-[1.1rem] border border-[#FF7E54]/20 bg-[#FF7E54]/[0.08] px-4 py-3 text-sm text-[#FFD3C5]">
          {data.errorMessage}
        </section>
      ) : null}

      {data.warnings.length > 0 ? (
        <section className="rounded-[1.1rem] border border-[#FFD24D]/20 bg-[#FFD24D]/[0.08] px-4 py-3 text-sm text-[#FFEAB1]">
          <span className="font-medium">Report warnings:</span>{" "}
          {data.warnings.slice(0, 3).join(" ")}
          {data.warnings.length > 3 ? ` +${data.warnings.length - 3} more` : ""}
        </section>
      ) : null}

      <section className="grid gap-4 lg:grid-cols-3">
        <MetricCard
          iconName="videos"
          label="Total Views"
          tone="green"
          value={formatNetTotalViewsWithGross(data)}
        />
        <MetricCard
          iconName="integrations"
          label="Paid Impressions"
          tone="blue"
          value={formatCompactMetricValue(data.totals.paidViews)}
        />
        <MetricCard
          iconName="viralVideos"
          label="Net Views"
          tone="orange"
          value={formatCompactMetricValue(data.totals.unpaidViews)}
        />
      </section>

      <section className="grid gap-5 xl:grid-cols-2">
        <LeaderboardPanel
          leftControl="Views"
          limit={data.topLimit}
          limitOptions={data.topLimitOptions}
          searchParams={resolvedSearchParams}
          title="Top Videos"
        >
          {data.topVideos.length > 0 ? (
            data.topVideos.map((item) => <TopVideoRow item={item} key={item.id} />)
          ) : (
            <EmptyPanelRow
              label={`No TikTok videos were found between ${formatDateLabel(data.startDate)} and ${formatDateLabel(data.endDate)}.`}
            />
          )}
        </LeaderboardPanel>

        <LeaderboardPanel
          leftControl="Accounts"
          limit={data.topLimit}
          limitOptions={data.topLimitOptions}
          searchParams={resolvedSearchParams}
          title="Top Accounts"
        >
          {data.topAccounts.length > 0 ? (
            data.topAccounts.map((item) => <TopAccountRow item={item} key={item.id} />)
          ) : (
            <EmptyPanelRow label="No tracked accounts have views in this date range." />
          )}
        </LeaderboardPanel>
      </section>

      <AdSpendSection
        apiPath={adSpendApiPath}
        endDate={data.endDate}
        startDate={data.startDate}
      />
    </div>
  );
}

export default async function ViewTallyPage({
  params,
  searchParams,
}: ViewTallyPageProps) {
  const { organizationSlug } = await params;
  const resolvedSearchParams = await searchParams;

  return (
    <Suspense fallback={<ViewTallyPageSkeleton />}>
      <ViewTallyPageContent
        organizationSlug={organizationSlug}
        resolvedSearchParams={resolvedSearchParams}
      />
    </Suspense>
  );
}
