import { DashboardIcon } from "@/components/org-dashboard/org-icons";
import { type DashboardSearchParams } from "@/server/dashboard/filters";
import {
  getOrganizationUgcPayData,
  type UgcPayMode,
  type UgcPayVideoFetchMode,
  type UgcPayViewWindowMode,
  type UgcPayCreatorRow,
  type UgcPayVideoRow,
} from "@/server/ugc-pay/queries";

export const dynamic = "force-dynamic";

type UgcPayPageProps = {
  params: Promise<{
    organizationSlug: string;
  }>;
  searchParams: Promise<DashboardSearchParams>;
};

const wholeNumberFormatter = new Intl.NumberFormat("en-US");
const compactNumberFormatter = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});
const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});
const currencyFormatters = new Map<string, Intl.NumberFormat>();

function getCurrencyFormatter(currency: string) {
  const normalizedCurrency = currency.toUpperCase();
  const cached = currencyFormatters.get(normalizedCurrency);

  if (cached) {
    return cached;
  }

  const formatter = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: normalizedCurrency,
    maximumFractionDigits: 2,
  });

  currencyFormatters.set(normalizedCurrency, formatter);
  return formatter;
}

function formatMoney(value: number, currency = "USD") {
  return getCurrencyFormatter(currency).format(value);
}

function formatMetricValue(value: number, compact = false) {
  return compact
    ? compactNumberFormatter.format(value)
    : wholeNumberFormatter.format(value);
}

function formatPayableViewsWithGross(item: {
  grossViews: number;
  paidViewsDeducted: number;
  payableViews: number;
}) {
  const payableLabel = formatMetricValue(item.payableViews, true);

  return item.paidViewsDeducted > 0 && item.grossViews > item.payableViews
    ? `${payableLabel} (${formatMetricValue(item.grossViews, true)})`
    : payableLabel;
}

function formatDateLabel(value: Date | string | null | undefined) {
  if (!value) {
    return "Unknown";
  }

  const parsedValue = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsedValue.getTime())
    ? "Unknown"
    : dateFormatter.format(parsedValue);
}

function getVideoTitle(video: Pick<UgcPayVideoRow, "titleOrCaption" | "creatorName">) {
  const title = video.titleOrCaption?.trim();
  return title && title.length > 0 ? title : `${video.creatorName} on TikTok`;
}

function formatDealLabel(creator: UgcPayCreatorRow) {
  const cpmLabel = `${formatMoney(creator.deal.cpmAmount, creator.currency)} CPM`;
  const fixedPerVideoLabel =
    creator.deal.fixedFeePerVideo != null && creator.deal.fixedFeePerVideo > 0
      ? `${formatMoney(creator.deal.fixedFeePerVideo, creator.currency)}/video fixed + `
      : "";
  const fixedFeeLabel =
    creator.deal.fixedFee != null && creator.deal.fixedFee > 0
      ? `${formatMoney(creator.deal.fixedFee, creator.currency)} fixed fee + `
      : "";
  const capLabel =
    creator.deal.perVideoCapScope === "NONE"
      ? "no per-video cap"
      : creator.deal.perVideoCapScope === "TOTAL"
        ? `${formatMoney(creator.deal.payoutCapPerVideo, creator.currency)} total cap`
        : `${formatMoney(creator.deal.payoutCapPerVideo, creator.currency)} CPM cap`;

  return `${fixedFeeLabel}${fixedPerVideoLabel}${cpmLabel}, ${capLabel}`;
}

function getPaidStatusLabel(video: UgcPayVideoRow) {
  switch (video.paidStatus) {
    case "yes":
      return "Paid impressions deducted";
    case "no":
      return "Organic";
    case "unsupported":
      return "Unsupported";
    default:
      return "Unknown";
  }
}

function getPayModeLabel(payMode: UgcPayMode) {
  return payMode === "gained" ? "Gained views" : "Posted in range";
}

function getViewWindowModeLabel(
  viewWindowMode: UgcPayViewWindowMode,
  globalViewWindowDays: number,
) {
  return viewWindowMode === "first-days"
    ? `First ${formatMetricValue(globalViewWindowDays)} days`
    : "All report views";
}

function getVideoFetchModeLabel(videoFetchMode: UgcPayVideoFetchMode) {
  return videoFetchMode === "per-creator"
    ? "Accurate creators"
    : "Global top 100";
}

function SummaryCard({
  label,
  value,
  detail,
  iconName,
}: {
  label: string;
  value: string;
  detail: string;
  iconName: "payouts" | "videos" | "creators" | "overview";
}) {
  return (
    <article className="rounded-[1.15rem] border border-white/[0.08] bg-black/[0.18] p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[0.62rem] uppercase text-muted-foreground">
          {label}
        </p>
        <DashboardIcon className="h-4 w-4 text-muted-foreground" name={iconName} />
      </div>
      <p className="mt-3 text-[1.65rem] font-semibold leading-none tracking-normal text-foreground">
        {value}
      </p>
      <p className="mt-2 text-sm leading-5 text-muted-foreground">{detail}</p>
    </article>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="rounded-[1.15rem] border border-white/[0.08] bg-black/[0.18] px-4 py-10 text-sm text-muted-foreground">
      {label}
    </div>
  );
}

function CreatorPayRow({ creator }: { creator: UgcPayCreatorRow }) {
  return (
    <details className="group border-b border-white/[0.06] last:border-b-0">
      <summary className="grid cursor-pointer list-none gap-3 px-4 py-4 md:grid-cols-[minmax(0,1.4fr)_minmax(0,0.85fr)_minmax(0,0.85fr)_minmax(0,0.75fr)_auto] md:items-center">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-sm font-semibold text-foreground">
              {creator.creatorName}
            </h3>
            <span
              className={`rounded-full border px-2 py-0.5 text-[0.62rem] uppercase ${
                creator.hasCustomDeal
                  ? "border-[#7BB2FF]/25 bg-[#7BB2FF]/10 text-[#D6E7FF]"
                  : "border-white/[0.08] bg-white/[0.05] text-muted-foreground"
              }`}
            >
              {creator.hasCustomDeal ? "custom" : "default"}
            </span>
            {creator.creatorTotalCapApplied || creator.videoCapReached ? (
              <span className="rounded-full border border-[#FFD24D]/20 bg-[#FFD24D]/10 px-2 py-0.5 text-[0.62rem] uppercase text-[#FFE7A6]">
                capped
              </span>
            ) : null}
          </div>
          <p className="mt-1 truncate text-xs text-muted-foreground">
            {creator.tiktokHandle ? `@${creator.tiktokHandle}` : creator.campaignName}
          </p>
        </div>

        <div>
          <p className="text-[0.62rem] uppercase text-muted-foreground">
            Pay
          </p>
          <p className="mt-1 text-sm font-semibold text-foreground">
            {formatMoney(creator.totalPay, creator.currency)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {formatMoney(creator.fixedPay, creator.currency)} fixed
          </p>
        </div>

        <div>
          <p className="text-[0.62rem] uppercase text-muted-foreground">
            Views
          </p>
          <p className="mt-1 text-sm text-foreground">
            {formatPayableViewsWithGross(creator)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {formatMetricValue(creator.paidViewsDeducted, true)} paid impressions removed
          </p>
        </div>

        <div>
          <p className="text-[0.62rem] uppercase text-muted-foreground">
            Videos
          </p>
          <p className="mt-1 text-sm text-foreground">
            {formatMetricValue(creator.videoCount)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {creator.exactPaidVideoCount} exact
          </p>
        </div>

        <div className="flex items-center md:justify-end">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-[0.85rem] border border-white/[0.1] bg-white/[0.05] transition group-open:border-white/[0.16] group-open:bg-white/[0.08]">
            <DashboardIcon
              className="h-4 w-4 text-foreground transition group-open:rotate-90"
              name="chevronRight"
            />
          </span>
        </div>
      </summary>

      <div className="border-t border-white/[0.06] px-4 py-4">
        <div className="flex flex-wrap gap-2 text-[0.62rem] uppercase">
          <span className="rounded-full border border-white/[0.08] bg-white/[0.05] px-2.5 py-1 text-muted-foreground">
            {formatDealLabel(creator)}
          </span>
          <span className="rounded-full border border-white/[0.08] bg-white/[0.05] px-2.5 py-1 text-muted-foreground">
            {formatMoney(creator.videoPay, creator.currency)} video pay
          </span>
          <span className="rounded-full border border-white/[0.08] bg-white/[0.05] px-2.5 py-1 text-muted-foreground">
            {formatMetricValue(creator.grossViews, true)} gross views
          </span>
          {creator.unknownPaidVideoCount > 0 ? (
            <span className="rounded-full border border-[#FFD24D]/20 bg-[#FFD24D]/10 px-2.5 py-1 text-[#FFE7A6]">
              {creator.unknownPaidVideoCount} unknown paid
            </span>
          ) : null}
        </div>

        {creator.videos.length > 0 ? (
          <div className="mt-4 overflow-x-auto rounded-[1rem] border border-white/[0.08] bg-black/[0.16]">
            <table className="w-full min-w-[980px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-white/[0.08] text-[0.62rem] uppercase text-muted-foreground">
                  <th className="px-3 py-3 font-medium">Video</th>
                  <th className="px-3 py-3 font-medium">Gross</th>
                  <th className="px-3 py-3 font-medium">Paid Impressions</th>
                  <th className="px-3 py-3 font-medium">Payable</th>
                  <th className="px-3 py-3 font-medium">Fixed</th>
                  <th className="px-3 py-3 font-medium">CPM</th>
                  <th className="px-3 py-3 font-medium">Pay</th>
                  <th className="px-3 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {creator.videos.map((video) => (
                  <VideoTableRow key={`${video.sourceVideoId}-${video.campaignCreatorId}`} video={video} />
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </details>
  );
}

function VideoTableRow({ video }: { video: UgcPayVideoRow }) {
  return (
    <tr className="border-b border-white/[0.05] align-top last:border-b-0">
      <td className="max-w-[24rem] px-3 py-3">
        <a
          className="block truncate font-medium text-foreground transition hover:text-[#B9FF95]"
          href={video.videoUrl}
          rel="noreferrer"
          target="_blank"
          title={getVideoTitle(video)}
        >
          {getVideoTitle(video)}
        </a>
        <p className="mt-1 text-xs text-muted-foreground">
          {formatDateLabel(video.publishedAt ?? video.createdAt)}
        </p>
      </td>
      <td className="px-3 py-3 text-foreground">
        {formatMetricValue(video.grossViews, true)}
      </td>
      <td className="px-3 py-3 text-muted-foreground">
        {formatMetricValue(video.paidViewsDeducted, true)}
      </td>
      <td className="px-3 py-3 text-muted-foreground">
        {formatPayableViewsWithGross(video)}
      </td>
      <td className="px-3 py-3 text-muted-foreground">
        {formatMoney(video.fixedFeePerVideo, video.currency)}
      </td>
      <td className="px-3 py-3 text-muted-foreground">
        {formatMoney(video.cpmAmount, video.currency)}
      </td>
      <td className="px-3 py-3 font-semibold text-foreground">
        {formatMoney(video.videoPay, video.currency)}
      </td>
      <td className="px-3 py-3">
        <span
          className={`rounded-full border px-2 py-1 text-[0.62rem] uppercase ${
            video.paidStatus === "yes" || video.paidStatus === "no"
              ? "border-white/[0.08] bg-white/[0.05] text-muted-foreground"
              : "border-[#FFD24D]/20 bg-[#FFD24D]/10 text-[#FFE7A6]"
          }`}
        >
          {getPaidStatusLabel(video)}
        </span>
      </td>
    </tr>
  );
}

export default async function UgcPayPage({
  params,
  searchParams,
}: UgcPayPageProps) {
  const { organizationSlug } = await params;
  const resolvedSearchParams = await searchParams;
  const data = await getOrganizationUgcPayData({
    organizationSlug,
    searchParams: resolvedSearchParams,
  });
  const isGainedViewMode = data.payMode === "gained";
  const isGlobalViewWindowMode = data.viewWindowMode === "first-days";
  const isAccurateCreatorFetchMode = data.videoFetchMode === "per-creator";
  const rangeDetail = isGainedViewMode
    ? `${data.reportTimeZone} report dates. Paying views gained in range for videos posted since ${formatDateLabel(data.videoWindowStartDate)}. Fixed per-video fees only count for videos posted in range.`
    : `${data.reportTimeZone} report dates. Videos posted in range; views use this View Tally period.`;
  const viewWindowDetail = isGlobalViewWindowMode
    ? `Payable views are clipped to the first ${formatMetricValue(data.globalViewWindowDays)} days after each video was posted.`
    : "Payable views use the full selected View Tally period.";
  const videoFetchDetail = isGainedViewMode
    ? isAccurateCreatorFetchMode
      ? "Using account-scoped creator queries for more complete gained-view rows."
      : "Using the fast global top-100 View Tally video feed."
    : null;
  const emptyCreatorLabel = isGainedViewMode
    ? "No View Tally videos gained views in the selected range for matched creators in this campaign."
    : "No View Tally videos matched creators in this campaign for the selected range.";

  return (
    <div className="space-y-4">
      <section className="rounded-[1.55rem] border border-white/[0.08] bg-white/[0.03] p-5 shadow-[0_24px_70px_rgba(0,0,0,0.2)] backdrop-blur">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-xs uppercase text-muted-foreground">
              UGC Pay
            </p>
            <h1 className="mt-2 text-xl font-semibold tracking-normal text-foreground">
              Creator pay from View Tally.
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {data.selectedCampaignLabel ?? "No campaign selected"}
            </p>
          </div>

          <div className="rounded-[1.1rem] border border-white/[0.08] bg-black/[0.2] px-4 py-3 text-sm text-muted-foreground">
            <p className="text-[0.62rem] uppercase text-muted-foreground">
              Selected range
            </p>
            <p className="mt-2 text-foreground">
              {formatDateLabel(data.startDate)} to {formatDateLabel(data.endDate)}
            </p>
            <p className="mt-1 text-xs">{rangeDetail}</p>
            <p className="mt-1 text-xs">{viewWindowDetail}</p>
            {videoFetchDetail ? (
              <p className="mt-1 text-xs">{videoFetchDetail}</p>
            ) : null}
            <p className="mt-1 text-xs">
              {getPayModeLabel(data.payMode)} - {getViewWindowModeLabel(data.viewWindowMode, data.globalViewWindowDays)} - {getVideoFetchModeLabel(data.videoFetchMode)} - {formatMetricValue(data.summary.customDeals)} custom deals
            </p>
          </div>
        </div>

        <form
          className="mt-5 space-y-3"
          method="get"
        >
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.25fr)_auto]">
            <label className="block">
              <span className="mb-1.5 block text-[0.62rem] uppercase text-muted-foreground">
                Start date
              </span>
              <input
                className="w-full rounded-[0.95rem] border border-white/[0.08] bg-black/[0.18] px-3 py-2.5 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-white/[0.16]"
                defaultValue={data.startDate}
                name="startDate"
                type="date"
              />
            </label>

            <label className="block">
              <span className="mb-1.5 block text-[0.62rem] uppercase text-muted-foreground">
                End date
              </span>
              <input
                className="w-full rounded-[0.95rem] border border-white/[0.08] bg-black/[0.18] px-3 py-2.5 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-white/[0.16]"
                defaultValue={data.endDate}
                name="endDate"
                type="date"
              />
            </label>

            <label className="block">
              <span className="mb-1.5 block text-[0.62rem] uppercase text-muted-foreground">
                Campaign
              </span>
              <select
                className="w-full rounded-[0.95rem] border border-white/[0.08] bg-black/[0.18] px-3 py-2.5 text-sm text-foreground outline-none transition focus:border-white/[0.16]"
                defaultValue={data.selectedCampaignId ?? ""}
                disabled={data.campaignOptions.length === 0}
                name="campaign"
              >
                {data.campaignOptions.length === 0 ? (
                  <option value="">No campaigns</option>
                ) : null}
                {data.campaignOptions.map((campaign) => (
                  <option key={campaign.id} value={campaign.id}>
                    {campaign.label}
                  </option>
                ))}
              </select>
            </label>

            <div className="flex flex-col items-stretch justify-end gap-2 sm:flex-row lg:flex-col">
              <button
                className="inline-flex w-full items-center justify-center gap-2 rounded-[0.95rem] border border-white/[0.1] bg-white/[0.06] px-4 py-2.5 text-sm text-foreground transition hover:border-white/[0.16] hover:bg-white/[0.1]"
                type="submit"
              >
                <DashboardIcon className="h-4 w-4" name="refresh" />
                Apply
              </button>
              {isGainedViewMode ? (
                <button
                  className="inline-flex w-full items-center justify-center gap-2 rounded-[0.95rem] border border-[#8BE0C2]/25 bg-[#8BE0C2]/[0.08] px-4 py-2.5 text-sm text-[#CFFFF0] transition hover:border-[#8BE0C2]/40 hover:bg-[#8BE0C2]/[0.12]"
                  name="videoFetchMode"
                  type="submit"
                  value="per-creator"
                >
                  <DashboardIcon className="h-4 w-4" name="creators" />
                  Query creators
                </button>
              ) : null}
            </div>
          </div>

          <div className="grid gap-3 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
            <fieldset>
              <legend className="mb-1.5 block text-[0.62rem] uppercase text-muted-foreground">
                Calculation
              </legend>
              <div className="grid grid-cols-2 gap-1 rounded-[0.95rem] border border-white/[0.08] bg-black/[0.18] p-1">
                <label className="block">
                  <input
                    className="peer sr-only"
                    defaultChecked={data.payMode === "posted"}
                    name="payMode"
                    type="radio"
                    value="posted"
                  />
                  <span className="flex min-h-10 items-center justify-center rounded-[0.75rem] px-3 text-center text-sm text-muted-foreground transition peer-checked:bg-white/[0.1] peer-checked:text-foreground">
                    Posted in range
                  </span>
                </label>
                <label className="block">
                  <input
                    className="peer sr-only"
                    defaultChecked={isGainedViewMode}
                    name="payMode"
                    type="radio"
                    value="gained"
                  />
                  <span className="flex min-h-10 items-center justify-center rounded-[0.75rem] px-3 text-center text-sm text-muted-foreground transition peer-checked:bg-white/[0.1] peer-checked:text-foreground">
                    Gained views
                  </span>
                </label>
              </div>
            </fieldset>

            {isGainedViewMode ? (
              <label className="block">
                <span className="mb-1.5 block text-[0.62rem] uppercase text-muted-foreground">
                  Video window start
                </span>
                <input
                  className="w-full rounded-[0.95rem] border border-white/[0.08] bg-black/[0.18] px-3 py-2.5 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-white/[0.16]"
                  defaultValue={data.videoWindowStartDate}
                  name="videoWindowStartDate"
                  type="date"
                />
              </label>
            ) : null}
          </div>

          <div className="grid gap-3 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
            <fieldset>
              <legend className="mb-1.5 block text-[0.62rem] uppercase text-muted-foreground">
                View window
              </legend>
              <div className="grid grid-cols-2 gap-1 rounded-[0.95rem] border border-white/[0.08] bg-black/[0.18] p-1">
                <label className="block">
                  <input
                    className="peer sr-only"
                    defaultChecked={data.viewWindowMode === "all"}
                    name="viewWindowMode"
                    type="radio"
                    value="all"
                  />
                  <span className="flex min-h-10 items-center justify-center rounded-[0.75rem] px-3 text-center text-sm text-muted-foreground transition peer-checked:bg-white/[0.1] peer-checked:text-foreground">
                    All report views
                  </span>
                </label>
                <label className="block">
                  <input
                    className="peer sr-only"
                    defaultChecked={isGlobalViewWindowMode}
                    name="viewWindowMode"
                    type="radio"
                    value="first-days"
                  />
                  <span className="flex min-h-10 items-center justify-center rounded-[0.75rem] px-3 text-center text-sm text-muted-foreground transition peer-checked:bg-white/[0.1] peer-checked:text-foreground">
                    First days
                  </span>
                </label>
              </div>
            </fieldset>

            <label className="block">
              <span className="mb-1.5 block text-[0.62rem] uppercase text-muted-foreground">
                Window days
              </span>
              <input
                className="w-full rounded-[0.95rem] border border-white/[0.08] bg-black/[0.18] px-3 py-2.5 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-white/[0.16]"
                defaultValue={data.globalViewWindowDays}
                min={1}
                max={365}
                name="globalViewWindowDays"
                type="number"
              />
            </label>
          </div>
        </form>
      </section>

      {data.errorMessage ? (
        <section className="rounded-[1.1rem] border border-[#FF7E54]/20 bg-[#FF7E54]/[0.08] px-4 py-3 text-sm text-[#FFD3C5]">
          {data.errorMessage}
        </section>
      ) : null}

      {data.warnings.length > 0 ? (
        <section className="rounded-[1.1rem] border border-[#FFD24D]/20 bg-[#FFD24D]/[0.08] px-4 py-3 text-sm leading-6 text-[#FFEAB1]">
          <span className="font-medium">Report warnings:</span>{" "}
          {data.warnings.slice(0, 4).join(" ")}
          {data.warnings.length > 4 ? ` +${data.warnings.length - 4} more` : ""}
        </section>
      ) : null}

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <SummaryCard
          detail={`${formatMoney(data.summary.fixedPay)} fixed + ${formatMoney(data.summary.videoPay)} video`}
          iconName="payouts"
          label="UGC Pay"
          value={formatMoney(data.summary.totalPay)}
        />
        <SummaryCard
          detail={`${formatMetricValue(data.summary.grossViews, true)} gross less ${formatMetricValue(data.summary.paidViewsDeducted, true)} paid impressions`}
          iconName="overview"
          label="Payable Views"
          value={formatPayableViewsWithGross(data.summary)}
        />
        <SummaryCard
          detail={`${formatMetricValue(data.summary.creators)} creators matched`}
          iconName="videos"
          label="Videos"
          value={formatMetricValue(data.summary.videos)}
        />
        <SummaryCard
          detail={`${formatMetricValue(data.summary.unknownPaidVideos)} unknown, ${formatMetricValue(data.summary.unmatchedVideos)} unmatched`}
          iconName="creators"
          label="Paid Checks"
          value={formatMetricValue(data.summary.exactPaidVideos)}
        />
      </section>

      <section className="rounded-[1.55rem] border border-white/[0.08] bg-white/[0.03] p-5 shadow-[0_24px_70px_rgba(0,0,0,0.2)] backdrop-blur">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs uppercase text-muted-foreground">
              Creators
            </p>
            <h2 className="mt-2 text-lg font-semibold tracking-normal text-foreground">
              Pay by creator
            </h2>
          </div>
          <p className="text-sm text-muted-foreground">
            {formatMetricValue(data.summary.videos)} video rows
          </p>
        </div>

        <div className="mt-5 overflow-hidden rounded-[1.2rem] border border-white/[0.08] bg-black/[0.18]">
          {data.creators.length > 0 ? (
            data.creators.map((creator) => (
              <CreatorPayRow creator={creator} key={creator.campaignCreatorId} />
            ))
          ) : (
            <div className="px-4 py-10 text-sm text-muted-foreground">
              {emptyCreatorLabel}
            </div>
          )}
        </div>
      </section>

      <section className="rounded-[1.55rem] border border-white/[0.08] bg-white/[0.03] p-5 shadow-[0_24px_70px_rgba(0,0,0,0.2)] backdrop-blur">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs uppercase text-muted-foreground">
              Videos
            </p>
            <h2 className="mt-2 text-lg font-semibold tracking-normal text-foreground">
              Video pay breakdown
            </h2>
          </div>
          <p className="text-sm text-muted-foreground">
            {formatMoney(data.summary.videoPay)} total video pay
          </p>
        </div>

        {data.videos.length > 0 ? (
          <div className="mt-5 overflow-x-auto rounded-[1.2rem] border border-white/[0.08] bg-black/[0.18]">
            <table className="w-full min-w-[980px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-white/[0.08] text-[0.62rem] uppercase text-muted-foreground">
                  <th className="px-3 py-3 font-medium">Video</th>
                  <th className="px-3 py-3 font-medium">Creator</th>
                  <th className="px-3 py-3 font-medium">Gross</th>
                  <th className="px-3 py-3 font-medium">Paid Impressions</th>
                  <th className="px-3 py-3 font-medium">Payable</th>
                  <th className="px-3 py-3 font-medium">Fixed</th>
                  <th className="px-3 py-3 font-medium">CPM Pay</th>
                  <th className="px-3 py-3 font-medium">Pay</th>
                  <th className="px-3 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {data.videos.map((video) => (
                  <tr
                    className="border-b border-white/[0.05] align-top last:border-b-0"
                    key={`${video.sourceVideoId}-${video.campaignCreatorId}`}
                  >
                    <td className="max-w-[24rem] px-3 py-3">
                      <a
                        className="block truncate font-medium text-foreground transition hover:text-[#B9FF95]"
                        href={video.videoUrl}
                        rel="noreferrer"
                        target="_blank"
                        title={getVideoTitle(video)}
                      >
                        {getVideoTitle(video)}
                      </a>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {formatDateLabel(video.publishedAt ?? video.createdAt)}
                      </p>
                    </td>
                    <td className="px-3 py-3 text-muted-foreground">
                      {video.creatorName}
                    </td>
                    <td className="px-3 py-3 text-foreground">
                      {formatMetricValue(video.grossViews, true)}
                    </td>
                    <td className="px-3 py-3 text-muted-foreground">
                      {formatMetricValue(video.paidViewsDeducted, true)}
                    </td>
                    <td className="px-3 py-3 text-muted-foreground">
                      {formatPayableViewsWithGross(video)}
                    </td>
                    <td className="px-3 py-3 text-muted-foreground">
                      {formatMoney(video.fixedFeePerVideo, video.currency)}
                    </td>
                    <td className="px-3 py-3 text-muted-foreground">
                      {formatMoney(video.cpmPay, video.currency)}
                    </td>
                    <td className="px-3 py-3 font-semibold text-foreground">
                      {formatMoney(video.videoPay, video.currency)}
                    </td>
                    <td className="px-3 py-3 text-muted-foreground">
                      {getPaidStatusLabel(video)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="mt-5">
            <EmptyState label="No video pay rows for the selected campaign and date range." />
          </div>
        )}
      </section>
    </div>
  );
}
