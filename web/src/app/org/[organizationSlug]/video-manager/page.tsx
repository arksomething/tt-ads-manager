import Link from "next/link";
import { redirect } from "next/navigation";

import { CampaignBadge } from "@/components/org-dashboard/campaign-badge";
import { type DashboardSearchParams } from "@/server/dashboard/filters";
import { setVideoTalkingStatusForOrganization } from "@/server/videos/mutations";
import {
  getOrganizationVideoManagerData,
  type VideoManagerListItem,
} from "@/server/videos/queries";

export const dynamic = "force-dynamic";

type VideoManagerPageProps = {
  params: Promise<{
    organizationSlug: string;
  }>;
  searchParams: Promise<DashboardSearchParams>;
};

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});
const compactNumberFormatter = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});
const wholeNumberFormatter = new Intl.NumberFormat("en-US");

function getSearchParamValue(searchParams: DashboardSearchParams, key: string) {
  const value = searchParams[key];
  return Array.isArray(value) ? value[0] : value;
}

function getTrimmedFormValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function toDateOnlyString(value: Date) {
  return value.toISOString().slice(0, 10);
}

function getDefaultStartDate() {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - 29);
  return toDateOnlyString(date);
}

function getDefaultEndDate() {
  return toDateOnlyString(new Date());
}

function normalizeDateInput(value: string | undefined, fallback: string) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return fallback;
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? fallback : value;
}

function normalizeDateRange(searchParams: DashboardSearchParams) {
  const fallbackStartDate = getDefaultStartDate();
  const fallbackEndDate = getDefaultEndDate();
  const startDate = normalizeDateInput(
    getSearchParamValue(searchParams, "startDate"),
    fallbackStartDate,
  );
  const endDate = normalizeDateInput(
    getSearchParamValue(searchParams, "endDate"),
    fallbackEndDate,
  );

  if (startDate > endDate) {
    return {
      startDate: endDate,
      endDate: startDate,
    };
  }

  return {
    startDate,
    endDate,
  };
}

function getSelectedCreatorId(searchParams: DashboardSearchParams) {
  const value = getSearchParamValue(searchParams, "creatorId");
  return value && value !== "all" ? value : null;
}

function buildVideoManagerHref(args: {
  organizationSlug: string;
  creatorId?: string | null;
  startDate: string;
  endDate: string;
  notice?: string | null;
  error?: string | null;
}) {
  const params = new URLSearchParams();

  if (args.creatorId) {
    params.set("creatorId", args.creatorId);
  }

  params.set("startDate", args.startDate);
  params.set("endDate", args.endDate);

  if (args.notice) {
    params.set("notice", args.notice);
  }

  if (args.error) {
    params.set("error", args.error);
  }

  return `/org/${args.organizationSlug}/video-manager?${params.toString()}`;
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

function getNoticeLabel(value: string | undefined) {
  switch (value) {
    case "video-marked-talking":
      return "Talking video pricing applied.";
    case "video-marked-non-talking":
      return "Non-talking $0.50 CPM pricing applied.";
    default:
      return undefined;
  }
}

function getErrorLabel(value: string | undefined) {
  if (!value || value.startsWith("NEXT_REDIRECT")) {
    return undefined;
  }

  return value;
}

function formatDateLabel(value: Date | string | null | undefined) {
  if (!value) {
    return "Unknown date";
  }

  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? "Unknown date" : dateFormatter.format(parsed);
}

function formatMetricValue(value: number | null | undefined) {
  return typeof value === "number" ? compactNumberFormatter.format(value) : "--";
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

function StatTile({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-[1.15rem] border border-white/[0.08] bg-black/[0.18] px-4 py-3.5">
      <p className="text-[0.62rem] uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-2 text-2xl font-semibold leading-none tracking-normal text-foreground">
        {value}
      </p>
    </div>
  );
}

function StatusBadge({ isTalking }: { isTalking: boolean }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${
        isTalking
          ? "border-[#90FF4D]/28 bg-[#90FF4D]/10 text-[#B8FF86]"
          : "border-[#FFD166]/28 bg-[#FFD166]/10 text-[#FFE2A0]"
      }`}
    >
      {isTalking ? "Talking" : "Non-talking"}
    </span>
  );
}

function VideoThumbnail({ video }: { video: VideoManagerListItem }) {
  if (video.thumbnailUrl) {
    return (
      <div
        aria-hidden="true"
        className="aspect-[4/5] w-full rounded-lg border border-white/[0.08] bg-white/[0.05]"
        style={getBackgroundImageStyle(video.thumbnailUrl)}
      />
    );
  }

  return (
    <div className="flex aspect-[4/5] w-full items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.04] text-[0.62rem] uppercase tracking-[0.18em] text-muted-foreground">
      Video
    </div>
  );
}

type VideoTalkingStatusAction = "mark-talking" | "mark-non-talking";

const videoTalkingStatusActions = [
  {
    action: "mark-talking",
    label: "Talking videos",
    pricingLabel: "Creator CPM",
  },
  {
    action: "mark-non-talking",
    label: "Non-talking",
    pricingLabel: "$0.50 CPM",
  },
] satisfies Array<{
  action: VideoTalkingStatusAction;
  label: string;
  pricingLabel: string;
}>;

function VideoTalkingStatusButton({
  action,
  currentCreatorId,
  endDate,
  isSelected,
  label,
  platform,
  pricingLabel,
  sourceVideoId,
  startDate,
  updateVideoTalkingStatus,
}: {
  action: VideoTalkingStatusAction;
  currentCreatorId: string | null;
  endDate: string;
  isSelected: boolean;
  label: string;
  platform: VideoManagerListItem["platform"];
  pricingLabel: string;
  sourceVideoId: string;
  startDate: string;
  updateVideoTalkingStatus: (formData: FormData) => Promise<void>;
}) {
  const selectedClass =
    action === "mark-talking"
      ? "border-[#90FF4D]/34 bg-[#90FF4D]/12 text-[#D7FFC4]"
      : "border-[#FFD166]/34 bg-[#FFD166]/12 text-[#FFE2A0]";
  const idleClass =
    "border-white/[0.08] bg-white/[0.04] text-foreground hover:border-white/[0.14] hover:bg-white/[0.07]";

  return (
    <form action={updateVideoTalkingStatus} className="min-w-0">
      <input name="sourceVideoId" type="hidden" value={sourceVideoId} />
      <input name="platform" type="hidden" value={platform} />
      <input name="action" type="hidden" value={action} />
      <input name="creatorId" type="hidden" value={currentCreatorId ?? ""} />
      <input name="startDate" type="hidden" value={startDate} />
      <input name="endDate" type="hidden" value={endDate} />
      <button
        aria-pressed={isSelected}
        className={`inline-flex min-h-11 w-full flex-col items-center justify-center rounded-full border px-2.5 py-1.5 text-center text-xs font-medium leading-4 transition disabled:cursor-default ${isSelected ? selectedClass : idleClass}`}
        disabled={isSelected}
        type="submit"
      >
        <span className="max-w-full truncate">{label}</span>
        <span className="mt-0.5 max-w-full truncate text-[0.62rem] font-normal leading-3 opacity-70">
          {pricingLabel}
        </span>
      </button>
    </form>
  );
}

function VideoCard({
  currentCreatorId,
  endDate,
  startDate,
  updateVideoTalkingStatus,
  video,
  canManageTalkingStatus,
}: {
  currentCreatorId: string | null;
  endDate: string;
  startDate: string;
  updateVideoTalkingStatus: (formData: FormData) => Promise<void>;
  video: VideoManagerListItem;
  canManageTalkingStatus: boolean;
}) {
  const title = video.titleOrCaption?.trim() || `${video.creatorName} video`;

  return (
    <article className="flex min-h-full flex-col rounded-lg border border-white/[0.08] bg-black/[0.18] p-3">
      <VideoThumbnail video={video} />

      <div className="flex flex-1 flex-col pt-3">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge isTalking={video.isTalking} />
          <CampaignBadge
            campaignId={video.campaignId}
            compact
            label={video.campaignName}
          />
        </div>

        <p className="mt-2 text-xs text-muted-foreground">
          {formatDateLabel(video.publishedAt)}
        </p>

        <h2 className="mt-2 break-words text-sm font-semibold leading-5 tracking-normal text-foreground">
          {truncateCopy(title, 105)}
        </h2>

        <div className="mt-3 grid gap-1 text-xs leading-5 text-muted-foreground">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate">{video.creatorName}</span>
            {video.accountHandle ? (
              <span className="truncate">@{video.accountHandle}</span>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>{formatMetricValue(video.views)} views</span>
            {typeof video.likes === "number" ? (
              <span>{formatMetricValue(video.likes)} likes</span>
            ) : null}
            {typeof video.comments === "number" ? (
              <span>{formatMetricValue(video.comments)} comments</span>
            ) : null}
          </div>
        </div>

        <div className="mt-auto grid gap-2 pt-4">
          <Link
            className="inline-flex min-h-10 items-center justify-center rounded-full border border-white/[0.08] bg-white/[0.04] px-4 py-2 text-sm text-foreground transition hover:border-white/[0.14] hover:bg-white/[0.07]"
            href={video.videoUrl}
            prefetch={false}
            rel="noreferrer"
            target="_blank"
          >
            Open
          </Link>

          {canManageTalkingStatus ? (
            <div className="grid grid-cols-2 gap-2">
              {videoTalkingStatusActions.map((statusAction) => (
                <VideoTalkingStatusButton
                  key={statusAction.action}
                  action={statusAction.action}
                  currentCreatorId={currentCreatorId}
                  endDate={endDate}
                  isSelected={
                    statusAction.action === "mark-talking"
                      ? video.isTalking
                      : !video.isTalking
                  }
                  label={statusAction.label}
                  platform={video.platform}
                  pricingLabel={statusAction.pricingLabel}
                  sourceVideoId={video.sourceVideoId}
                  startDate={startDate}
                  updateVideoTalkingStatus={updateVideoTalkingStatus}
                />
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </article>
  );
}

export default async function VideoManagerPage({
  params,
  searchParams,
}: VideoManagerPageProps) {
  const { organizationSlug } = await params;
  const resolvedSearchParams = await searchParams;
  const { startDate, endDate } = normalizeDateRange(resolvedSearchParams);
  const requestedCreatorId = getSelectedCreatorId(resolvedSearchParams);
  const data = await getOrganizationVideoManagerData({
    organizationSlug,
    startDate,
    endDate,
    creatorId: requestedCreatorId,
  });
  const notice = getNoticeLabel(getSearchParamValue(resolvedSearchParams, "notice"));
  const error = getErrorLabel(getSearchParamValue(resolvedSearchParams, "error"));

  async function updateVideoTalkingStatus(formData: FormData) {
    "use server";

    const nextStartDate = normalizeDateInput(
      getTrimmedFormValue(formData, "startDate"),
      getDefaultStartDate(),
    );
    const nextEndDate = normalizeDateInput(
      getTrimmedFormValue(formData, "endDate"),
      getDefaultEndDate(),
    );
    const nextCreatorId = getTrimmedFormValue(formData, "creatorId") || null;
    const action = getTrimmedFormValue(formData, "action");

    try {
      await setVideoTalkingStatusForOrganization({
        organizationSlug,
        input: {
          sourceVideoId: getTrimmedFormValue(formData, "sourceVideoId"),
          platform: getTrimmedFormValue(formData, "platform") || undefined,
          action,
        },
      });
    } catch (actionError) {
      redirect(
        buildVideoManagerHref({
          organizationSlug,
          creatorId: nextCreatorId,
          startDate: nextStartDate,
          endDate: nextEndDate,
          error: getActionErrorMessage(actionError),
        }),
      );
    }

    redirect(
      buildVideoManagerHref({
        organizationSlug,
        creatorId: nextCreatorId,
        startDate: nextStartDate,
        endDate: nextEndDate,
        notice:
          action === "mark-talking"
            ? "video-marked-talking"
            : "video-marked-non-talking",
      }),
    );
  }

  return (
    <main className="space-y-6">
      <section className="rounded-[1.35rem] border border-white/[0.08] bg-[linear-gradient(180deg,rgba(255,255,255,0.045),rgba(255,255,255,0.02))] p-4 shadow-[0_18px_60px_rgba(0,0,0,0.24)] sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-[0.64rem] uppercase tracking-[0.22em] text-muted-foreground">
              Blazie
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-normal text-foreground">
              Video Manager
            </h1>
          </div>

          <form
            action={`/org/${organizationSlug}/video-manager`}
            className="grid gap-2 sm:grid-cols-[minmax(12rem,1fr)_8.5rem_8.5rem_auto]"
          >
            <label className="block">
              <span className="mb-1.5 block text-[0.62rem] uppercase tracking-[0.16em] text-muted-foreground">
                Creator
              </span>
              <select
                className="min-h-11 w-full rounded-[0.85rem] border border-white/[0.08] bg-black/[0.2] px-3 text-sm text-foreground outline-none transition focus:border-white/[0.16]"
                defaultValue={data.selectedCreatorId ?? "all"}
                name="creatorId"
              >
                <option value="all">All creators</option>
                {data.creatorOptions.map((creator) => (
                  <option key={creator.id} value={creator.id}>
                    {creator.meta ? `${creator.label} (${creator.meta})` : creator.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-1.5 block text-[0.62rem] uppercase tracking-[0.16em] text-muted-foreground">
                Start
              </span>
              <input
                className="min-h-11 w-full rounded-[0.85rem] border border-white/[0.08] bg-black/[0.2] px-3 text-sm text-foreground outline-none transition focus:border-white/[0.16]"
                defaultValue={data.startDate}
                name="startDate"
                type="date"
              />
            </label>

            <label className="block">
              <span className="mb-1.5 block text-[0.62rem] uppercase tracking-[0.16em] text-muted-foreground">
                End
              </span>
              <input
                className="min-h-11 w-full rounded-[0.85rem] border border-white/[0.08] bg-black/[0.2] px-3 text-sm text-foreground outline-none transition focus:border-white/[0.16]"
                defaultValue={data.endDate}
                name="endDate"
                type="date"
              />
            </label>

            <button
              className="mt-auto inline-flex min-h-11 items-center justify-center rounded-full border border-white/[0.1] bg-white/[0.08] px-5 text-sm font-medium text-foreground transition hover:border-white/[0.16] hover:bg-white/[0.12]"
              type="submit"
            >
              Apply
            </button>
          </form>
        </div>
      </section>

      {notice ? (
        <div className="rounded-[1rem] border border-[#90FF4D]/25 bg-[#90FF4D]/10 px-4 py-3 text-sm text-[#D7FFC4]">
          {notice}
        </div>
      ) : null}

      {error ? (
        <div className="rounded-[1rem] border border-red-400/25 bg-red-500/10 px-4 py-3 text-sm text-red-100">
          {error}
        </div>
      ) : null}

      {data.errorMessage ? (
        <div className="rounded-[1rem] border border-red-400/25 bg-red-500/10 px-4 py-3 text-sm text-red-100">
          {data.errorMessage}
        </div>
      ) : null}

      {data.warnings.length > 0 ? (
        <div className="rounded-[1rem] border border-white/[0.08] bg-white/[0.04] px-4 py-3 text-sm leading-6 text-muted-foreground">
          {data.warnings.slice(0, 3).join(" ")}
        </div>
      ) : null}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Videos" value={wholeNumberFormatter.format(data.totalCount)} />
        <StatTile
          label="Talking"
          value={wholeNumberFormatter.format(data.talkingCount)}
        />
        <StatTile
          label="Non-talking"
          value={wholeNumberFormatter.format(data.nonTalkingCount)}
        />
        <StatTile label="Non-talking CPM" value="$0.50" />
      </section>

      <section className="space-y-3">
        {data.isLimited ? (
          <p className="text-sm text-muted-foreground">
            Showing the top {data.rowLimit} provider videos for this window.
          </p>
        ) : null}

        {data.rows.length > 0 ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            {data.rows.map((video) => (
              <VideoCard
                key={video.id}
                canManageTalkingStatus={data.canManageTalkingStatus}
                currentCreatorId={data.selectedCreatorId}
                endDate={data.endDate}
                startDate={data.startDate}
                updateVideoTalkingStatus={updateVideoTalkingStatus}
                video={video}
              />
            ))}
          </div>
        ) : (
          <div className="rounded-[1.15rem] border border-white/[0.08] bg-black/[0.18] px-4 py-10 text-sm text-muted-foreground">
            No videos found for this selection.
          </div>
        )}
      </section>
    </main>
  );
}
