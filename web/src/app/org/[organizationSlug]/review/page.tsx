import Link from "next/link";
import { redirect } from "next/navigation";

import { CampaignBadge } from "@/components/org-dashboard/campaign-badge";
import {
  formatPlatformLabel,
  type DashboardSearchParams,
} from "@/server/dashboard/filters";
import { setVideoReviewForOrganization } from "@/server/videos/mutations";
import {
  getOrganizationCampaignReviewQueue,
  reviewWindowOptions,
  type ReviewQueueVideoItem,
  type ReviewWindowId,
} from "@/server/videos/queries";

export const dynamic = "force-dynamic";

type ReviewPageProps = {
  params: Promise<{
    organizationSlug: string;
  }>;
  searchParams: Promise<DashboardSearchParams>;
};

type ReviewActionHandler = (formData: FormData) => Promise<void>;

const reviewDateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});
const reviewDateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "UTC",
});

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

function getTrimmedFormValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function buildReviewPageHref(args: {
  organizationSlug: string;
  campaignId?: string | null;
  windowId?: string | null;
  error?: string | null;
}) {
  const nextSearchParams = new URLSearchParams();

  if (args.campaignId) {
    nextSearchParams.set("campaign", args.campaignId);
  }

  if (args.windowId) {
    nextSearchParams.set("window", args.windowId);
  }

  if (args.error) {
    nextSearchParams.set("error", args.error);
  }

  const query = nextSearchParams.toString();
  const baseHref = `/org/${args.organizationSlug}/review`;
  return query ? `${baseHref}?${query}` : baseHref;
}

function formatReviewDate(
  value: Date | string | null | undefined,
  fallback = "Unknown date",
) {
  if (!value) {
    return fallback;
  }

  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return fallback;
  }

  return reviewDateFormatter.format(date);
}

function formatReviewDateTime(
  value: Date | string | null | undefined,
  fallback = "Unknown date",
) {
  if (!value) {
    return fallback;
  }

  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return fallback;
  }

  return reviewDateTimeFormatter.format(date);
}

function formatCompactNumber(value: number) {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: value >= 1_000_000 ? 1 : 0,
  }).format(value);
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
  } as const;
}

function getReviewTitle(video: ReviewQueueVideoItem) {
  const title = video.titleOrCaption?.trim();
  return title && title.length > 0
    ? title
    : `${video.creatorName} on ${formatPlatformLabel(video.platform)}`;
}

function getReviewWindowLabel(windowId: ReviewWindowId) {
  return (
    reviewWindowOptions.find((option) => option.id === windowId)?.label ??
    reviewWindowOptions[0].label
  );
}

function SummaryCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <article className="rounded-[1.2rem] border border-white/[0.08] bg-black/[0.18] p-4">
      <p className="text-[0.62rem] uppercase tracking-[0.22em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-3 text-[1.7rem] font-medium tracking-[-0.05em] text-foreground">
        {value}
      </p>
      <p className="mt-2 text-sm text-muted-foreground">{detail}</p>
    </article>
  );
}

function ReviewQueueCard({
  action,
  item,
  mode,
}: {
  action: ReviewActionHandler;
  item: ReviewQueueVideoItem;
  mode: "pending" | "reviewed";
}) {
  const isReviewed = mode === "reviewed";
  const title = getReviewTitle(item);

  return (
    <article className="rounded-[1.2rem] border border-white/[0.08] bg-black/[0.18] p-4">
      <div className="flex flex-col gap-4">
        <div className="flex gap-3">
          <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-[1rem] border border-white/[0.06] bg-black/[0.28]">
            {item.thumbnailUrl ? (
              <>
                <div
                  aria-hidden="true"
                  className="absolute inset-0"
                  style={getBackgroundImageStyle(item.thumbnailUrl)}
                />
                <div
                  aria-hidden="true"
                  className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.08),rgba(0,0,0,0.02)_40%,rgba(0,0,0,0.46))]"
                />
              </>
            ) : (
              <div className="absolute inset-0 flex items-center justify-center px-2 text-center text-[0.56rem] uppercase tracking-[0.18em] text-muted-foreground">
                {formatPlatformLabel(item.platform)}
              </div>
            )}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-white/[0.08] bg-white/[0.05] px-2.5 py-1 text-[0.56rem] uppercase tracking-[0.18em] text-muted-foreground">
                {formatPlatformLabel(item.platform)}
              </span>
              <span className="rounded-full border border-white/[0.08] bg-white/[0.03] px-2.5 py-1 text-[0.56rem] uppercase tracking-[0.18em] text-muted-foreground">
                {formatReviewDate(item.publishedAt ?? item.createdAt)}
              </span>
              {isReviewed ? (
                <span className="rounded-full border border-[#90FF4D]/20 bg-[#90FF4D]/10 px-2.5 py-1 text-[0.56rem] uppercase tracking-[0.18em] text-[#C9FFAB]">
                  Checked off
                </span>
              ) : null}
            </div>

            <a
              className="mt-2 block text-sm font-medium leading-6 text-foreground transition hover:text-[#C7FFA4]"
              href={item.videoUrl}
              rel="noreferrer"
              target="_blank"
              title={title}
            >
              {truncateCopy(title, 170)}
            </a>

            <div className="mt-2 flex flex-wrap gap-2 text-sm text-muted-foreground">
              <span>{item.creatorName}</span>
              <span className="text-white/20">/</span>
              <span>
                {item.accountHandle ? `@${item.accountHandle}` : "No linked handle"}
              </span>
            </div>
          </div>
        </div>

        <div className="grid gap-2 sm:grid-cols-4">
          <div className="rounded-[0.95rem] border border-white/[0.06] bg-white/[0.03] px-3 py-2">
            <p className="text-[0.56rem] uppercase tracking-[0.18em] text-muted-foreground">
              Views
            </p>
            <p className="mt-1 text-sm text-foreground">
              {formatMetricValue(item.views, "views")}
            </p>
          </div>
          <div className="rounded-[0.95rem] border border-white/[0.06] bg-white/[0.03] px-3 py-2">
            <p className="text-[0.56rem] uppercase tracking-[0.18em] text-muted-foreground">
              Likes
            </p>
            <p className="mt-1 text-sm text-foreground">
              {formatMetricValue(item.likes, "likes")}
            </p>
          </div>
          <div className="rounded-[0.95rem] border border-white/[0.06] bg-white/[0.03] px-3 py-2">
            <p className="text-[0.56rem] uppercase tracking-[0.18em] text-muted-foreground">
              Comments
            </p>
            <p className="mt-1 text-sm text-foreground">
              {formatMetricValue(item.comments, "comments")}
            </p>
          </div>
          <div className="rounded-[0.95rem] border border-white/[0.06] bg-white/[0.03] px-3 py-2">
            <p className="text-[0.56rem] uppercase tracking-[0.18em] text-muted-foreground">
              Engagement
            </p>
            <p className="mt-1 text-sm text-foreground">
              {formatEngagementValue(item.engagementRate)}
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs leading-5 text-muted-foreground">
            {isReviewed && item.reviewedAt
              ? `Checked off ${formatReviewDateTime(item.reviewedAt)}.`
              : "Open the video, review it, then check it off to clear it from your queue."}
          </p>

          <div className="flex flex-wrap gap-2">
            <a
              className="inline-flex min-h-10 items-center rounded-[0.95rem] border border-white/[0.08] bg-white/[0.04] px-3.5 text-sm text-foreground transition hover:border-white/[0.14] hover:bg-white/[0.07]"
              href={item.videoUrl}
              rel="noreferrer"
              target="_blank"
            >
              Open video
            </a>

            <form action={action}>
              <input name="videoId" type="hidden" value={item.id} />
              <input
                name="reviewAction"
                type="hidden"
                value={isReviewed ? "clear-reviewed" : "mark-reviewed"}
              />
              <button
                className={`inline-flex min-h-10 items-center rounded-[0.95rem] border px-3.5 text-sm font-medium transition ${
                  isReviewed
                    ? "border-white/[0.08] bg-white/[0.04] text-foreground hover:border-white/[0.14] hover:bg-white/[0.07]"
                    : "border-[#90FF4D]/20 bg-[#90FF4D]/90 text-black hover:bg-[#A4FF68]"
                }`}
                type="submit"
              >
                {isReviewed ? "Undo check-off" : "Check off"}
              </button>
            </form>
          </div>
        </div>
      </div>
    </article>
  );
}

export default async function ReviewPage({
  params,
  searchParams,
}: ReviewPageProps) {
  const { organizationSlug } = await params;
  const resolvedSearchParams = await searchParams;
  const error = getErrorLabel(getSearchParamValue(resolvedSearchParams, "error"));
  const reviewQueue = await getOrganizationCampaignReviewQueue({
    organizationSlug,
    searchParams: resolvedSearchParams,
  });

  async function setReviewStateAction(formData: FormData) {
    "use server";

    try {
      await setVideoReviewForOrganization({
        organizationSlug,
        input: {
          action: getTrimmedFormValue(formData, "reviewAction"),
          videoId: getTrimmedFormValue(formData, "videoId"),
        },
      });
    } catch (reviewError) {
      redirect(
        buildReviewPageHref({
          organizationSlug,
          campaignId: reviewQueue.selectedCampaign?.id ?? null,
          windowId: reviewQueue.selectedWindowId,
          error: getActionErrorMessage(reviewError),
        }),
      );
    }
  }

  return (
    <div className="space-y-4">
      {error ? (
        <section className="rounded-[1.25rem] border border-[#FF7E54]/20 bg-[#FF7E54]/[0.08] px-4 py-3 text-sm text-[#FFD3C5]">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <span>{error}</span>
            <Link
              className="inline-flex min-h-9 items-center rounded-full border border-white/[0.08] bg-white/[0.06] px-3 text-xs font-medium text-foreground transition hover:border-white/[0.14] hover:bg-white/[0.08]"
              href={buildReviewPageHref({
                organizationSlug,
                campaignId: reviewQueue.selectedCampaign?.id ?? null,
                windowId: reviewQueue.selectedWindowId,
              })}
            >
              Clear
            </Link>
          </div>
        </section>
      ) : null}

      <section className="rounded-[1.55rem] border border-white/[0.08] bg-white/[0.03] p-5 shadow-[0_24px_70px_rgba(0,0,0,0.2)] backdrop-blur">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl">
            <p className="text-xs uppercase tracking-[0.28em] text-muted-foreground">
              Review queue
            </p>
            <h1 className="mt-2 text-2xl font-medium tracking-[-0.045em] text-foreground">
              Review campaign videos one campaign at a time.
            </h1>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              Pick a campaign, load a recent window, and check videos off as you
              review them. The check-off state is saved for your account so you can
              leave and come back without losing your place.
            </p>
          </div>

          {reviewQueue.selectedCampaign ? (
            <CampaignBadge
              campaignId={reviewQueue.selectedCampaign.id}
              label={reviewQueue.selectedCampaign.label}
            />
          ) : null}
        </div>

        {reviewQueue.campaignOptions.length > 0 ? (
          <>
            <form
              className="mt-5 grid gap-3 lg:grid-cols-[minmax(0,1fr)_12rem_auto]"
              method="get"
            >
              <label className="block">
                <span className="mb-2 block text-xs uppercase tracking-[0.2em] text-muted-foreground">
                  Campaign
                </span>
                <select
                  className="h-11 w-full rounded-[0.95rem] border border-white/[0.08] bg-black/[0.24] px-3.5 text-sm text-foreground outline-none transition focus:border-white/[0.16]"
                  defaultValue={reviewQueue.selectedCampaign?.id ?? ""}
                  name="campaign"
                >
                  {reviewQueue.campaignOptions.map((campaign) => (
                    <option key={campaign.id} value={campaign.id}>
                      {campaign.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="mb-2 block text-xs uppercase tracking-[0.2em] text-muted-foreground">
                  Window
                </span>
                <select
                  className="h-11 w-full rounded-[0.95rem] border border-white/[0.08] bg-black/[0.24] px-3.5 text-sm text-foreground outline-none transition focus:border-white/[0.16]"
                  defaultValue={reviewQueue.selectedWindowId}
                  name="window"
                >
                  {reviewWindowOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <div className="flex items-end">
                <button
                  className="inline-flex min-h-11 w-full items-center justify-center rounded-[0.95rem] border border-[#90FF4D]/20 bg-[#90FF4D]/90 px-4 text-sm font-medium text-black transition hover:bg-[#A4FF68] lg:w-auto"
                  type="submit"
                >
                  Load queue
                </button>
              </div>
            </form>

            <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <SummaryCard
                detail={`${getReviewWindowLabel(reviewQueue.selectedWindowId)} in ${reviewQueue.selectedCampaign?.label ?? "this campaign"}.`}
                label="Videos in window"
                value={String(reviewQueue.totalCount)}
              />
              <SummaryCard
                detail="Still waiting for your review."
                label="Still to review"
                value={String(reviewQueue.pendingCount)}
              />
              <SummaryCard
                detail="Already checked off by you."
                label="Checked off"
                value={String(reviewQueue.reviewedCount)}
              />
              <SummaryCard
                detail={`Window started ${formatReviewDateTime(reviewQueue.windowStartedAt)}.`}
                label="Completion"
                value={`${reviewQueue.completionPercent}%`}
              />
            </div>
          </>
        ) : (
          <div className="mt-5 rounded-[1.2rem] border border-dashed border-white/[0.08] bg-black/[0.18] px-4 py-10 text-sm text-muted-foreground">
            You need access to at least one campaign before there is anything to
            review here.
          </div>
        )}
      </section>

      {reviewQueue.selectedCampaign ? (
        <section className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
          <article className="rounded-[1.55rem] border border-white/[0.08] bg-white/[0.03] p-5 shadow-[0_24px_70px_rgba(0,0,0,0.2)] backdrop-blur">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.28em] text-muted-foreground">
                  Still to review
                </p>
                <h2 className="mt-2 text-xl font-medium tracking-[-0.04em] text-foreground">
                  Current queue
                </h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  {reviewQueue.totalCount === 0
                    ? "No campaign videos landed in this window yet."
                    : reviewQueue.pendingCount === 0
                      ? "You have checked everything off for this campaign window."
                      : "Work from top to bottom and check each video off once you have reviewed it."}
                </p>
              </div>

              <span className="inline-flex min-h-10 items-center rounded-full border border-white/[0.08] bg-white/[0.04] px-4 py-2 text-sm text-foreground">
                {reviewQueue.pendingCount} left
              </span>
            </div>

            <div className="mt-5 space-y-3">
              {reviewQueue.totalCount === 0 ? (
                <div className="rounded-[1.2rem] border border-dashed border-white/[0.08] bg-black/[0.18] px-4 py-10 text-sm text-muted-foreground">
                  Nothing has been published for{" "}
                  {reviewQueue.selectedCampaign.label} in{" "}
                  {getReviewWindowLabel(reviewQueue.selectedWindowId).toLowerCase()}.
                  Try a wider window or switch campaigns.
                </div>
              ) : reviewQueue.pendingCount === 0 ? (
                <div className="rounded-[1.2rem] border border-[#90FF4D]/20 bg-[#90FF4D]/[0.08] px-4 py-10 text-sm text-[#D7FFBC]">
                  Everything in this window is checked off. Switch campaigns or
                  come back when new videos land.
                </div>
              ) : (
                reviewQueue.pendingItems.map((item) => (
                  <ReviewQueueCard
                    key={item.id}
                    action={setReviewStateAction}
                    item={item}
                    mode="pending"
                  />
                ))
              )}
            </div>
          </article>

          <div className="space-y-4">
            <article className="rounded-[1.55rem] border border-white/[0.08] bg-white/[0.03] p-5 shadow-[0_24px_70px_rgba(0,0,0,0.2)] backdrop-blur">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <p className="text-xs uppercase tracking-[0.28em] text-muted-foreground">
                    Checked off by you
                  </p>
                  <h2 className="mt-2 text-xl font-medium tracking-[-0.04em] text-foreground">
                    Recently reviewed
                  </h2>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Your completed review history for this campaign window.
                  </p>
                </div>

                <span className="inline-flex min-h-10 items-center rounded-full border border-white/[0.08] bg-white/[0.04] px-4 py-2 text-sm text-foreground">
                  {reviewQueue.reviewedCount} done
                </span>
              </div>

              <div className="mt-5 space-y-3">
                {reviewQueue.reviewedCount > 0 ? (
                  reviewQueue.reviewedItems.map((item) => (
                    <ReviewQueueCard
                      key={item.id}
                      action={setReviewStateAction}
                      item={item}
                      mode="reviewed"
                    />
                  ))
                ) : (
                  <div className="rounded-[1.2rem] border border-dashed border-white/[0.08] bg-black/[0.18] px-4 py-10 text-sm text-muted-foreground">
                    Nothing is checked off yet for this campaign window.
                  </div>
                )}
              </div>
            </article>

            <article className="rounded-[1.55rem] border border-white/[0.08] bg-white/[0.03] p-5 shadow-[0_24px_70px_rgba(0,0,0,0.2)] backdrop-blur">
              <p className="text-xs uppercase tracking-[0.28em] text-muted-foreground">
                Current rhythm
              </p>
              <h2 className="mt-2 text-xl font-medium tracking-[-0.04em] text-foreground">
                Keep the queue tight.
              </h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Review one campaign at a time, keep the window recent, and use the
                check-off buttons to keep your place clean.
              </p>

              <div className="mt-5 grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
                <div className="rounded-[1.05rem] border border-white/[0.08] bg-black/[0.18] p-3.5">
                  <p className="text-[0.58rem] uppercase tracking-[0.2em] text-muted-foreground">
                    Campaign
                  </p>
                  <p className="mt-2 text-sm font-medium text-foreground">
                    {reviewQueue.selectedCampaign.label}
                  </p>
                </div>
                <div className="rounded-[1.05rem] border border-white/[0.08] bg-black/[0.18] p-3.5">
                  <p className="text-[0.58rem] uppercase tracking-[0.2em] text-muted-foreground">
                    Window
                  </p>
                  <p className="mt-2 text-sm font-medium text-foreground">
                    {getReviewWindowLabel(reviewQueue.selectedWindowId)}
                  </p>
                </div>
                <div className="rounded-[1.05rem] border border-white/[0.08] bg-black/[0.18] p-3.5">
                  <p className="text-[0.58rem] uppercase tracking-[0.2em] text-muted-foreground">
                    Window started
                  </p>
                  <p className="mt-2 text-sm font-medium text-foreground">
                    {formatReviewDateTime(reviewQueue.windowStartedAt)}
                  </p>
                </div>
              </div>

              {reviewQueue.nextVideo ? (
                <div className="mt-5 rounded-[1.2rem] border border-[#90FF4D]/20 bg-[#90FF4D]/[0.08] p-4">
                  <p className="text-[0.58rem] uppercase tracking-[0.2em] text-[#BFF59A]">
                    Up next
                  </p>
                  <p className="mt-2 text-sm font-medium text-foreground">
                    {truncateCopy(getReviewTitle(reviewQueue.nextVideo), 120)}
                  </p>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {reviewQueue.nextVideo.creatorName}
                    {reviewQueue.nextVideo.accountHandle
                      ? ` / @${reviewQueue.nextVideo.accountHandle}`
                      : ""}
                  </p>
                  <a
                    className="mt-4 inline-flex min-h-10 items-center rounded-[0.95rem] border border-[#90FF4D]/20 bg-[#90FF4D]/90 px-3.5 text-sm font-medium text-black transition hover:bg-[#A4FF68]"
                    href={reviewQueue.nextVideo.videoUrl}
                    rel="noreferrer"
                    target="_blank"
                  >
                    Open next video
                  </a>
                </div>
              ) : (
                <div className="mt-5 rounded-[1.2rem] border border-white/[0.08] bg-black/[0.18] p-4 text-sm text-muted-foreground">
                  No pending videos are left in this window.
                </div>
              )}

              <p className="mt-4 text-xs leading-5 text-muted-foreground">
                Check-off state is saved per user, so your review queue stays where
                you left it without changing anyone else&apos;s queue.
              </p>
            </article>
          </div>
        </section>
      ) : null}
    </div>
  );
}
