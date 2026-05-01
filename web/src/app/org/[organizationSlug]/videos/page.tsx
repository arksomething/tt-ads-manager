import Link from "next/link";
import { redirect } from "next/navigation";

import { getViewsBaseEnv, hasViewsBaseEnv } from "@/lib/server-env";
import { CampaignBadge } from "@/components/org-dashboard/campaign-badge";
import {
  formatPlatformLabel,
  type DashboardSearchParams,
} from "@/server/dashboard/filters";
import { trackVideoForOrganization } from "@/server/videos/mutations";
import { getOrganizationImportedVideosPage } from "@/server/videos/queries";
import { syncViewsBaseCampaignForOrganization } from "@/server/viewsbase/sync";

export const dynamic = "force-dynamic";

type VideosPageProps = {
  params: Promise<{
    organizationSlug: string;
  }>;
  searchParams: Promise<DashboardSearchParams>;
};
const pageDateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});
const wholeNumberFormatter = new Intl.NumberFormat("en-US");

function getSearchParamValue(
  searchParams: DashboardSearchParams,
  key: string,
) {
  const value = searchParams[key];
  return Array.isArray(value) ? value[0] : value;
}

function getActionErrorMessage(error: unknown) {
  const digest =
    typeof error === "object" &&
    error !== null &&
    "digest" in error &&
    typeof (error as { digest?: unknown }).digest === "string"
      ? (error as { digest: string }).digest
      : null;

  if (digest?.startsWith("NEXT_REDIRECT")) {
    throw error;
  }

  return error instanceof Error ? error.message : "Something went wrong.";
}

function getErrorLabel(value: string | undefined) {
  if (!value) {
    return value;
  }

  return value.startsWith("NEXT_REDIRECT") ? undefined : value;
}

function getNoticeLabel(value: string | undefined) {
  switch (value) {
    case "video-tracked":
      return "Video added to tracking, synced with viral.app, and saved locally.";
    case "viewsbase-synced":
      return "ViewsBase campaign synced and added to local tracking.";
    default:
      return undefined;
  }
}

function getTrimmedFormValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function parseRequestedPage(searchParams: DashboardSearchParams) {
  const rawValue = getSearchParamValue(searchParams, "page");
  const parsedValue = rawValue ? Number.parseInt(rawValue, 10) : 1;
  return Number.isInteger(parsedValue) && parsedValue > 0 ? parsedValue : 1;
}

function formatCompactNumber(value: number) {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: value >= 1_000_000 ? 1 : 0,
  }).format(value);
}

function formatVideoDateLabel(value: Date | string | null | undefined) {
  if (!value) {
    return "Unknown date";
  }

  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Unknown date";
  }

  return pageDateFormatter.format(date);
}

function formatMetricValue(value: number | null | undefined, suffix: string) {
  if (typeof value !== "number") {
    return `-- ${suffix}`;
  }

  return `${formatCompactNumber(value)} ${suffix}`;
}

function formatEngagementValue(value: number | null | undefined) {
  if (typeof value !== "number") {
    return "--";
  }

  return `${value.toFixed(1)}%`;
}

function truncateCopy(value: string, maxLength: number) {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}...` : value;
}

function getBackgroundImageStyle(imageUrl: string) {
  return {
    backgroundImage: `url(${JSON.stringify(imageUrl)})`,
    backgroundPosition: "center",
    backgroundRepeat: "no-repeat",
    backgroundSize: "cover",
  };
}

function buildVideosPageHref(args: {
  organizationSlug: string;
  page?: number;
  notice?: string | null;
  error?: string | null;
}) {
  const nextSearchParams = new URLSearchParams();

  if (args.page && args.page > 1) {
    nextSearchParams.set("page", String(args.page));
  }

  if (args.notice) {
    nextSearchParams.set("notice", args.notice);
  }

  if (args.error) {
    nextSearchParams.set("error", args.error);
  }

  const query = nextSearchParams.toString();
  const baseHref = `/org/${args.organizationSlug}/videos`;
  return query ? `${baseHref}?${query}` : baseHref;
}

function getPaginationItems(currentPage: number, pageCount: number) {
  if (pageCount <= 7) {
    return Array.from({ length: pageCount }, (_, index) => index + 1);
  }

  const items: Array<number | "ellipsis"> = [1];
  const windowStart = Math.max(2, currentPage - 1);
  const windowEnd = Math.min(pageCount - 1, currentPage + 1);

  if (windowStart > 2) {
    items.push("ellipsis");
  }

  for (let page = windowStart; page <= windowEnd; page += 1) {
    items.push(page);
  }

  if (windowEnd < pageCount - 1) {
    items.push("ellipsis");
  }

  items.push(pageCount);
  return items;
}

function PaginationNav({
  currentPage,
  organizationSlug,
  pageCount,
}: {
  currentPage: number;
  organizationSlug: string;
  pageCount: number;
}) {
  if (pageCount <= 1) {
    return null;
  }

  const pageItems = getPaginationItems(currentPage, pageCount);

  return (
    <nav
      aria-label="Videos pagination"
      className="flex flex-wrap items-center gap-2"
    >
      {currentPage > 1 ? (
        <Link
          className="inline-flex min-h-10 items-center rounded-full border border-white/[0.08] bg-white/[0.04] px-4 py-2 text-sm text-foreground transition hover:border-white/[0.14] hover:bg-white/[0.07]"
          href={buildVideosPageHref({
            organizationSlug,
            page: currentPage - 1,
          })}
          prefetch={false}
        >
          Previous
        </Link>
      ) : (
        <span className="inline-flex min-h-10 items-center rounded-full border border-white/[0.06] bg-white/[0.02] px-4 py-2 text-sm text-muted-foreground/70">
          Previous
        </span>
      )}

      {pageItems.map((item, index) =>
        item === "ellipsis" ? (
          <span
            key={`ellipsis-${index}`}
            className="px-1 text-sm text-muted-foreground"
          >
            ...
          </span>
        ) : (
          <Link
            key={item}
            aria-current={item === currentPage ? "page" : undefined}
            className={`inline-flex h-10 min-w-10 items-center justify-center rounded-full border px-3 text-sm transition ${
              item === currentPage
                ? "border-[#90FF4D]/40 bg-[#90FF4D]/90 text-black shadow-[0_10px_24px_rgba(144,255,77,0.26)]"
                : "border-white/[0.08] bg-white/[0.04] text-foreground hover:border-white/[0.14] hover:bg-white/[0.07]"
            }`}
            href={buildVideosPageHref({
              organizationSlug,
              page: item,
            })}
            prefetch={false}
          >
            {item}
          </Link>
        ),
      )}

      {currentPage < pageCount ? (
        <Link
          className="inline-flex min-h-10 items-center rounded-full border border-white/[0.08] bg-white/[0.04] px-4 py-2 text-sm text-foreground transition hover:border-white/[0.14] hover:bg-white/[0.07]"
          href={buildVideosPageHref({
            organizationSlug,
            page: currentPage + 1,
          })}
          prefetch={false}
        >
          Next
        </Link>
      ) : (
        <span className="inline-flex min-h-10 items-center rounded-full border border-white/[0.06] bg-white/[0.02] px-4 py-2 text-sm text-muted-foreground/70">
          Next
        </span>
      )}
    </nav>
  );
}

export default async function VideosPage({
  params,
  searchParams,
}: VideosPageProps) {
  const { organizationSlug } = await params;
  const resolvedSearchParams = await searchParams;
  const notice = getNoticeLabel(getSearchParamValue(resolvedSearchParams, "notice"));
  const error = getErrorLabel(getSearchParamValue(resolvedSearchParams, "error"));
  const requestedPage = parseRequestedPage(resolvedSearchParams);
  const videosPage = await getOrganizationImportedVideosPage({
    organizationSlug,
    page: requestedPage,
  });
  const hasViewsBaseIntegration = hasViewsBaseEnv();
  const defaultViewsBaseOrgSlug = hasViewsBaseIntegration
    ? getViewsBaseEnv().VIEWSBASE_DEFAULT_ORG_SLUG ?? ""
    : "";
  const defaultCampaignId =
    videosPage.campaignOptions.length === 1
      ? videosPage.campaignOptions[0]?.id ?? ""
      : "";
  const showingStart =
    videosPage.totalCount === 0
      ? 0
      : (videosPage.currentPage - 1) * videosPage.pageSize + 1;
  const showingEnd =
    videosPage.totalCount === 0
      ? 0
      : showingStart + videosPage.videos.length - 1;
  const currentPage = videosPage.currentPage;

  async function trackVideoAction(formData: FormData) {
    "use server";

    const campaignId = getTrimmedFormValue(formData, "campaignId");

    try {
      if (!campaignId) {
        throw new Error("Choose a campaign before tracking a video.");
      }

      await trackVideoForOrganization({
        organizationSlug,
        input: {
          videoUrl: getTrimmedFormValue(formData, "videoUrl"),
          campaignId,
        },
      });

      redirect(
        buildVideosPageHref({
          organizationSlug,
          notice: "video-tracked",
        }),
      );
    } catch (trackError) {
      redirect(
        buildVideosPageHref({
          organizationSlug,
          page: currentPage,
          error: getActionErrorMessage(trackError),
        }),
      );
    }
  }

  async function syncViewsBaseAction(formData: FormData) {
    "use server";

    try {
      await syncViewsBaseCampaignForOrganization({
        organizationSlug,
        input: {
          campaignId: getTrimmedFormValue(formData, "viewsbaseCampaignId"),
          orgSlug: getTrimmedFormValue(formData, "viewsbaseOrgSlug"),
          campaignSlug: getTrimmedFormValue(formData, "viewsbaseCampaignSlug"),
        },
      });

      redirect(
        buildVideosPageHref({
          organizationSlug,
          notice: "viewsbase-synced",
        }),
      );
    } catch (syncError) {
      redirect(
        buildVideosPageHref({
          organizationSlug,
          page: currentPage,
          error: getActionErrorMessage(syncError),
        }),
      );
    }
  }

  return (
    <div className="space-y-4">
      {notice ? (
        <section className="rounded-[1.25rem] border border-[#90FF4D]/20 bg-[#90FF4D]/[0.08] px-4 py-3 text-sm text-[#D7FFBC]">
          {notice}
        </section>
      ) : null}

      {error ? (
        <section className="rounded-[1.25rem] border border-[#FF7E54]/20 bg-[#FF7E54]/[0.08] px-4 py-3 text-sm text-[#FFD3C5]">
          {error}
        </section>
      ) : null}

      <section className="max-w-4xl">
        <aside className="rounded-[1.55rem] border border-white/[0.08] bg-white/[0.03] p-5 shadow-[0_24px_70px_rgba(0,0,0,0.2)] backdrop-blur">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.28em] text-muted-foreground">
                Track video
              </p>
              <h1 className="mt-2 text-xl font-medium tracking-[-0.04em] text-foreground">
                Track a video
              </h1>
              <p className="mt-2 text-sm text-muted-foreground">
                Paste a TikTok, Instagram Reel, or YouTube Shorts URL. We&apos;ll
                add the video to viral.app, sync it locally, and assign it to the
                selected campaign with its creator linked automatically.
              </p>
            </div>
            {notice || error ? (
              <Link
                href={buildVideosPageHref({
                  organizationSlug,
                  page: currentPage,
                })}
                className="inline-flex min-h-10 items-center rounded-[0.95rem] border border-white/[0.08] bg-white/[0.04] px-3.5 text-sm text-muted-foreground transition hover:border-white/[0.14] hover:bg-white/[0.07] hover:text-foreground"
              >
                Clear flash
              </Link>
            ) : null}
          </div>

          {videosPage.canTrackVideos ? (
            <div className="mt-5 grid gap-5 xl:grid-cols-2">
              <form
                action={trackVideoAction}
                className="space-y-4 rounded-[1.2rem] border border-white/[0.08] bg-black/[0.14] p-4"
              >
                <div>
                  <p className="text-[0.62rem] uppercase tracking-[0.22em] text-muted-foreground">
                    Manual Video Tracking
                  </p>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Add one TikTok, Instagram Reel, or YouTube Shorts URL through viral.app.
                  </p>
                </div>

                <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_15rem]">
                  <label className="block">
                    <span className="mb-2 block text-xs uppercase tracking-[0.2em] text-muted-foreground">
                      Video URL
                    </span>
                    <input
                      className="h-11 w-full rounded-[0.95rem] border border-white/[0.08] bg-black/[0.24] px-3.5 text-sm text-foreground outline-none transition placeholder:text-muted-foreground/60 focus:border-white/[0.16]"
                      name="videoUrl"
                      placeholder="https://www.tiktok.com/@creator/video/7456789068912345678"
                      required
                      type="url"
                    />
                  </label>

                  <label className="block">
                    <span className="mb-2 block text-xs uppercase tracking-[0.2em] text-muted-foreground">
                      Campaign
                    </span>
                    <select
                      className="h-11 w-full rounded-[0.95rem] border border-white/[0.08] bg-black/[0.24] px-3.5 text-sm text-foreground outline-none transition focus:border-white/[0.16]"
                      defaultValue={defaultCampaignId}
                      disabled={videosPage.campaignOptions.length === 0}
                      name="campaignId"
                      required
                    >
                      <option value="">
                        {videosPage.campaignOptions.length === 0
                          ? "No campaign yet"
                          : "Choose a campaign"}
                      </option>
                      {videosPage.campaignOptions.map((campaign) => (
                        <option key={campaign.id} value={campaign.id}>
                          {campaign.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <button
                    className="inline-flex min-h-11 items-center justify-center rounded-[0.95rem] border border-[#90FF4D]/20 bg-[#90FF4D]/90 px-4 text-sm font-medium text-black transition hover:bg-[#A4FF68]"
                    type="submit"
                  >
                    Track video
                  </button>
                  <p className="text-xs leading-5 text-muted-foreground sm:max-w-sm sm:text-right">
                    Choose one of the campaigns you can access. We&apos;ll
                    automatically link the detected creator to that campaign.
                  </p>
                </div>
              </form>

              <div className="rounded-[1.2rem] border border-white/[0.08] bg-black/[0.14] p-4">
                <div>
                  <p className="text-[0.62rem] uppercase tracking-[0.22em] text-muted-foreground">
                    ViewsBase Sync
                  </p>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Pull a whole ViewsBase campaign into this workspace. These synced rows are
                    priced in payouts at 0.5 CPM with a $100 per-video cap and no fixed fee.
                  </p>
                </div>

                {hasViewsBaseIntegration ? (
                  <form action={syncViewsBaseAction} className="mt-4 space-y-4">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="block">
                        <span className="mb-2 block text-xs uppercase tracking-[0.2em] text-muted-foreground">
                          ViewsBase Org Slug
                        </span>
                        <input
                          className="h-11 w-full rounded-[0.95rem] border border-white/[0.08] bg-black/[0.24] px-3.5 text-sm text-foreground outline-none transition placeholder:text-muted-foreground/60 focus:border-white/[0.16]"
                          defaultValue={defaultViewsBaseOrgSlug}
                          name="viewsbaseOrgSlug"
                          placeholder="gotall"
                          required
                        />
                      </label>

                      <label className="block">
                        <span className="mb-2 block text-xs uppercase tracking-[0.2em] text-muted-foreground">
                          ViewsBase Campaign Slug
                        </span>
                        <input
                          className="h-11 w-full rounded-[0.95rem] border border-white/[0.08] bg-black/[0.24] px-3.5 text-sm text-foreground outline-none transition placeholder:text-muted-foreground/60 focus:border-white/[0.16]"
                          name="viewsbaseCampaignSlug"
                          placeholder="gotall-nuddi"
                          required
                        />
                      </label>
                    </div>

                    <label className="block">
                      <span className="mb-2 block text-xs uppercase tracking-[0.2em] text-muted-foreground">
                        Local Campaign
                      </span>
                      <select
                        className="h-11 w-full rounded-[0.95rem] border border-white/[0.08] bg-black/[0.24] px-3.5 text-sm text-foreground outline-none transition focus:border-white/[0.16]"
                        defaultValue={defaultCampaignId}
                        disabled={videosPage.campaignOptions.length === 0}
                        name="viewsbaseCampaignId"
                        required
                      >
                        <option value="">
                          {videosPage.campaignOptions.length === 0
                            ? "No campaign yet"
                            : "Choose a campaign"}
                        </option>
                        {videosPage.campaignOptions.map((campaign) => (
                          <option key={campaign.id} value={campaign.id}>
                            {campaign.label}
                          </option>
                        ))}
                      </select>
                    </label>

                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <button
                        className="inline-flex min-h-11 items-center justify-center rounded-[0.95rem] border border-[#90FF4D]/20 bg-[#90FF4D]/90 px-4 text-sm font-medium text-black transition hover:bg-[#A4FF68]"
                        type="submit"
                      >
                        Sync ViewsBase campaign
                      </button>
                      <p className="text-xs leading-5 text-muted-foreground sm:max-w-sm sm:text-right">
                        Uses the authenticated ViewsBase session cookie from your server env.
                      </p>
                    </div>
                  </form>
                ) : (
                  <div className="mt-4 rounded-[1rem] border border-dashed border-white/[0.08] bg-black/[0.18] px-4 py-6 text-sm text-muted-foreground">
                    Configure <code>VIEWSBASE_SESSION_COOKIE_VALUE</code> in the server env to
                    enable ViewsBase syncs from this workspace.
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="mt-5 rounded-[1.2rem] border border-dashed border-white/[0.08] bg-black/[0.18] px-4 py-10 text-sm text-muted-foreground">
              You need access to at least one campaign before you can track videos
              from this workspace.
            </div>
          )}
        </aside>
      </section>

      <section className="rounded-[1.55rem] border border-white/[0.08] bg-white/[0.03] p-5 shadow-[0_24px_70px_rgba(0,0,0,0.2)] backdrop-blur">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.28em] text-muted-foreground">
              Current feed
            </p>
            <h2 className="mt-2 text-xl font-medium tracking-[-0.04em] text-foreground">
              Tracked videos in this organization
            </h2>
            {videosPage.totalCount > 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">
                Showing {wholeNumberFormatter.format(showingStart)}-
                {wholeNumberFormatter.format(showingEnd)} of{" "}
                {wholeNumberFormatter.format(videosPage.totalCount)} synced videos.
              </p>
            ) : null}
          </div>

          <div className="flex flex-col gap-2 sm:items-end">
            <p className="text-sm text-muted-foreground">
              {wholeNumberFormatter.format(videosPage.totalCount)} video
              {videosPage.totalCount === 1 ? "" : "s"}
            </p>
            <PaginationNav
              currentPage={videosPage.currentPage}
              organizationSlug={organizationSlug}
              pageCount={videosPage.pageCount}
            />
          </div>
        </div>

        {videosPage.videos.length > 0 ? (
          <div className="mt-5 overflow-x-auto rounded-[1.2rem] border border-white/[0.08] bg-black/[0.18]">
            <table className="min-w-[980px] w-full border-collapse text-left">
              <thead className="bg-white/[0.03]">
                <tr>
                  <th className="px-4 py-3 text-[0.62rem] font-normal uppercase tracking-[0.22em] text-muted-foreground">
                    Video
                  </th>
                  <th className="px-4 py-3 text-[0.62rem] font-normal uppercase tracking-[0.22em] text-muted-foreground">
                    Creator
                  </th>
                  <th className="px-4 py-3 text-[0.62rem] font-normal uppercase tracking-[0.22em] text-muted-foreground">
                    Campaign
                  </th>
                  <th className="px-4 py-3 text-[0.62rem] font-normal uppercase tracking-[0.22em] text-muted-foreground">
                    Metrics
                  </th>
                  <th className="px-4 py-3 text-[0.62rem] font-normal uppercase tracking-[0.22em] text-muted-foreground">
                    Added
                  </th>
                </tr>
              </thead>
              <tbody>
                {videosPage.videos.map((video) => {
                  const title =
                    video.titleOrCaption?.trim() ||
                    `${video.creatorName} on ${formatPlatformLabel(video.platform)}`;

                  return (
                    <tr
                      key={video.id}
                      className="border-t border-white/[0.08] align-top transition hover:bg-white/[0.02]"
                    >
                      <td className="px-4 py-4">
                        <div className="flex gap-3">
                          <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-[0.95rem] border border-white/[0.06] bg-black/[0.28]">
                            {video.thumbnailUrl ? (
                              <>
                                <div
                                  aria-hidden="true"
                                  className="absolute inset-0"
                                  style={getBackgroundImageStyle(video.thumbnailUrl)}
                                />
                                <div
                                  aria-hidden="true"
                                  className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.12),rgba(0,0,0,0.02)_42%,rgba(0,0,0,0.42))]"
                                />
                              </>
                            ) : (
                              <div className="absolute inset-0 flex items-center justify-center px-2 text-center text-[0.56rem] uppercase tracking-[0.18em] text-muted-foreground">
                                {formatPlatformLabel(video.platform)}
                              </div>
                            )}
                          </div>

                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="rounded-full border border-white/[0.08] bg-white/[0.05] px-2.5 py-1 text-[0.56rem] uppercase tracking-[0.18em] text-muted-foreground">
                                {formatPlatformLabel(video.platform)}
                              </span>
                              <span className="rounded-full border border-white/[0.08] bg-white/[0.05] px-2.5 py-1 text-[0.56rem] uppercase tracking-[0.18em] text-muted-foreground">
                                {video.sourceLabel}
                              </span>
                              <a
                                className="text-[0.62rem] uppercase tracking-[0.2em] text-[#C7FFA4] transition hover:text-[#90FF4D]"
                                href={video.videoUrl}
                                rel="noreferrer"
                                target="_blank"
                              >
                                Open video
                              </a>
                            </div>
                            <a
                              className="mt-2 block max-w-[26rem] text-sm font-medium leading-6 text-foreground transition hover:text-[#C7FFA4]"
                              href={video.videoUrl}
                              rel="noreferrer"
                              target="_blank"
                              title={title}
                            >
                              {truncateCopy(title, 160)}
                            </a>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-4">
                        <p className="text-sm font-medium text-foreground">
                          {video.creatorName}
                        </p>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {video.accountHandle
                            ? `@${video.accountHandle}`
                            : "No linked handle"}
                        </p>
                      </td>
                      <td className="px-4 py-4">
                        <CampaignBadge
                          campaignId={video.campaignId}
                          compact
                          label={video.campaignName ?? "Unassigned"}
                        />
                      </td>
                      <td className="px-4 py-4">
                        <div className="grid max-w-[15rem] gap-2 sm:grid-cols-2">
                          <div className="rounded-[0.95rem] border border-white/[0.06] bg-white/[0.03] px-3 py-2">
                            <p className="text-[0.56rem] uppercase tracking-[0.18em] text-muted-foreground">
                              Views
                            </p>
                            <p className="mt-1 text-sm text-foreground">
                              {formatMetricValue(video.views, "views")}
                            </p>
                          </div>
                          <div className="rounded-[0.95rem] border border-white/[0.06] bg-white/[0.03] px-3 py-2">
                            <p className="text-[0.56rem] uppercase tracking-[0.18em] text-muted-foreground">
                              Likes
                            </p>
                            <p className="mt-1 text-sm text-foreground">
                              {formatMetricValue(video.likes, "likes")}
                            </p>
                          </div>
                          <div className="rounded-[0.95rem] border border-white/[0.06] bg-white/[0.03] px-3 py-2">
                            <p className="text-[0.56rem] uppercase tracking-[0.18em] text-muted-foreground">
                              Comments
                            </p>
                            <p className="mt-1 text-sm text-foreground">
                              {formatMetricValue(video.comments, "comments")}
                            </p>
                          </div>
                          <div className="rounded-[0.95rem] border border-white/[0.06] bg-white/[0.03] px-3 py-2">
                            <p className="text-[0.56rem] uppercase tracking-[0.18em] text-muted-foreground">
                              Engagement
                            </p>
                            <p className="mt-1 text-sm text-foreground">
                              {formatEngagementValue(video.engagementRate)}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-4 text-sm text-muted-foreground">
                        <p>{formatVideoDateLabel(video.publishedAt ?? video.createdAt)}</p>
                        <p className="mt-1 text-[0.62rem] uppercase tracking-[0.2em] text-muted-foreground/70">
                          {video.publishedAt ? "Published" : "Imported"}
                        </p>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="mt-5 rounded-[1.2rem] border border-dashed border-white/[0.08] bg-black/[0.18] px-4 py-10 text-sm text-muted-foreground">
            No tracked videos yet. Paste the first video URL above to add it to
            viral.app and store it in this workspace.
          </div>
        )}
      </section>
    </div>
  );
}
