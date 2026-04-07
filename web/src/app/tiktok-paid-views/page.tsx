import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { hasTikTokBusinessOauthEnv } from "@/lib/server-env";
import {
  getPaidViewsForSparkItems,
  type TikTokPaidViewMetric,
} from "@/server/tiktok-business/public-reporting";
import {
  createTikTokPublicConnectionCookieValue,
  getTikTokPublicConnectionCookieName,
  getTikTokPublicConnectionCookieOptions,
  getTikTokPublicConnectionMaxAgeSeconds,
  getTikTokPublicPendingSelectionCookieName,
  readTikTokPublicPendingSelectionCookieValue,
  readTikTokPublicConnectionCookieValue,
  sanitizeTikTokPublicReturnPath,
} from "@/server/tiktok-business/public-session";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

type TikTokPaidViewsPageProps = {
  searchParams: SearchParams;
};

const metricOptions: Array<{
  value: TikTokPaidViewMetric;
  label: string;
  hint: string;
}> = [
  {
    value: "impressions",
    label: "Impressions",
    hint: "Times your paid Spark ads were served.",
  },
  {
    value: "videoPlayActions",
    label: "Video play actions",
    hint: "Paid video starts captured by TikTok reporting.",
  },
];

const numberFormatter = new Intl.NumberFormat("en-US");
const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

function getSearchParamValue(
  searchParams: Record<string, string | string[] | undefined>,
  key: string,
) {
  const value = searchParams[key];
  return Array.isArray(value) ? value[0] : value;
}

function toDateOnlyString(value: Date) {
  return value.toISOString().slice(0, 10);
}

function getDefaultStartDate() {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - 30);
  return toDateOnlyString(date);
}

function getDefaultEndDate() {
  return toDateOnlyString(new Date());
}

function normalizeMetric(value: string | undefined): TikTokPaidViewMetric {
  return value === "videoPlayActions" ? "videoPlayActions" : "impressions";
}

function formatDate(value: string | null) {
  if (!value) {
    return "Unknown";
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? value : dateFormatter.format(parsed);
}

function withFlashPath(args: {
  returnTo: string;
  notice?: string | null;
  error?: string | null;
}) {
  const url = new URL(sanitizeTikTokPublicReturnPath(args.returnTo), "https://example.com");

  if (args.notice) {
    url.searchParams.set("notice", args.notice);
  }

  if (args.error) {
    url.searchParams.set("error", args.error);
  }

  return `${url.pathname}${url.search}`;
}

function getNoticeLabel(value: string | undefined) {
  switch (value) {
    case "connection-saved":
      return "TikTok advertiser connection saved in this browser.";
    case "connection-cleared":
      return "TikTok advertiser connection cleared from this browser.";
    case "oauth-select-advertiser":
      return "Choose which TikTok advertiser account to save for this browser.";
    default:
      return undefined;
  }
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

export default async function TikTokPaidViewsPage({
  searchParams,
}: TikTokPaidViewsPageProps) {
  const resolvedSearchParams = await searchParams;
  const creatorLabel = (getSearchParamValue(resolvedSearchParams, "creator") ?? "").trim();
  const itemIdsInput = getSearchParamValue(resolvedSearchParams, "itemIds") ?? "";
  const startDate =
    getSearchParamValue(resolvedSearchParams, "startDate") ?? getDefaultStartDate();
  const endDate =
    getSearchParamValue(resolvedSearchParams, "endDate") ?? getDefaultEndDate();
  const metric = normalizeMetric(getSearchParamValue(resolvedSearchParams, "metric"));
  const cookieStore = await cookies();
  const oauthConfigured = hasTikTokBusinessOauthEnv();
  const connection = readTikTokPublicConnectionCookieValue(
    cookieStore.get(getTikTokPublicConnectionCookieName())?.value,
  );
  const pendingSelection = readTikTokPublicPendingSelectionCookieValue(
    cookieStore.get(getTikTokPublicPendingSelectionCookieName())?.value,
  );
  const returnTo = withFlashPath({
    returnTo: `/tiktok-paid-views?${new URLSearchParams({
      creator: creatorLabel,
      itemIds: itemIdsInput,
      startDate,
      endDate,
      metric,
    }).toString()}`,
  });
  const oauthConnectHref = `/api/tiktok/oauth/start?next=${encodeURIComponent(returnTo)}`;
  const notice = getNoticeLabel(getSearchParamValue(resolvedSearchParams, "notice"));

  async function saveConnectionAction(formData: FormData) {
    "use server";

    const advertiserId = String(formData.get("advertiserId") ?? "").trim();
    const advertiserName = String(formData.get("advertiserName") ?? "").trim();
    const accessToken = String(formData.get("accessToken") ?? "").trim();
    const nextPath = sanitizeTikTokPublicReturnPath(
      String(formData.get("returnTo") ?? ""),
    );

    try {
      const serverCookieStore = await cookies();
      serverCookieStore.set(
        getTikTokPublicConnectionCookieName(),
        createTikTokPublicConnectionCookieValue({
          advertiserId,
          advertiserName,
          accessToken,
        }),
        getTikTokPublicConnectionCookieOptions(
          getTikTokPublicConnectionMaxAgeSeconds(),
        ),
      );
      serverCookieStore.set(
        getTikTokPublicPendingSelectionCookieName(),
        "",
        getTikTokPublicConnectionCookieOptions(0),
      );
      redirect(
        withFlashPath({
          returnTo: nextPath,
          notice: "connection-saved",
        }),
      );
    } catch (error) {
      redirect(
        withFlashPath({
          returnTo: nextPath,
          error: getActionErrorMessage(error),
        }),
      );
    }
  }

  async function clearConnectionAction(formData: FormData) {
    "use server";

    const nextPath = sanitizeTikTokPublicReturnPath(
      String(formData.get("returnTo") ?? ""),
    );
    const serverCookieStore = await cookies();
    serverCookieStore.set(
      getTikTokPublicConnectionCookieName(),
      "",
      getTikTokPublicConnectionCookieOptions(0),
    );
    serverCookieStore.set(
      getTikTokPublicPendingSelectionCookieName(),
      "",
      getTikTokPublicConnectionCookieOptions(0),
    );
    redirect(
      withFlashPath({
        returnTo: nextPath,
        notice: "connection-cleared",
      }),
    );
  }

  async function completeOauthSelectionAction(formData: FormData) {
    "use server";

    const advertiserId = String(formData.get("advertiserId") ?? "").trim();
    const nextPath = sanitizeTikTokPublicReturnPath(
      String(formData.get("returnTo") ?? ""),
    );

    try {
      const serverCookieStore = await cookies();
      const pendingAdvertiserSelection = readTikTokPublicPendingSelectionCookieValue(
        serverCookieStore.get(getTikTokPublicPendingSelectionCookieName())?.value,
      );

      if (!pendingAdvertiserSelection) {
        throw new Error("No pending TikTok advertiser selection was found.");
      }

      const advertiser = pendingAdvertiserSelection.advertisers.find(
        (candidate) => candidate.advertiserId === advertiserId,
      );

      if (!advertiser) {
        throw new Error("That TikTok advertiser is no longer available.");
      }

      serverCookieStore.set(
        getTikTokPublicConnectionCookieName(),
        createTikTokPublicConnectionCookieValue({
          advertiserId: advertiser.advertiserId,
          advertiserName: advertiser.advertiserName,
          accessToken: pendingAdvertiserSelection.accessToken,
        }),
        getTikTokPublicConnectionCookieOptions(
          getTikTokPublicConnectionMaxAgeSeconds(),
        ),
      );
      serverCookieStore.set(
        getTikTokPublicPendingSelectionCookieName(),
        "",
        getTikTokPublicConnectionCookieOptions(0),
      );
      redirect(
        withFlashPath({
          returnTo: pendingAdvertiserSelection.returnTo,
          notice: "connection-saved",
        }),
      );
    } catch (error) {
      redirect(
        withFlashPath({
          returnTo: nextPath,
          error: getActionErrorMessage(error),
        }),
      );
    }
  }

  let result: Awaited<ReturnType<typeof getPaidViewsForSparkItems>> | null = null;
  let errorMessage = getSearchParamValue(resolvedSearchParams, "error") ?? null;

  if ((creatorLabel.length > 0 || itemIdsInput.trim().length > 0) && !errorMessage) {
    if (!connection) {
      errorMessage = "Save a TikTok advertiser connection before running a lookup.";
    } else {
      try {
        result = await getPaidViewsForSparkItems({
          creatorLabel,
          advertiserId: connection.advertiserId,
          accessToken: connection.accessToken,
          itemIds: itemIdsInput,
          startDate,
          endDate,
          metric,
        });
      } catch (error) {
        errorMessage =
          error instanceof Error
            ? error.message
            : "Could not load TikTok paid views for these Spark items.";
      }
    }
  }

  return (
    <div className="mx-auto w-full max-w-7xl space-y-4 px-4 py-4 sm:px-6 lg:px-8 lg:py-6">
      {notice ? (
        <section className="rounded-[1.25rem] border border-[#90FF4D]/20 bg-[#90FF4D]/[0.08] px-4 py-3 text-sm text-[#D7FFBC]">
          {notice}
        </section>
      ) : null}

      <section className="rounded-[1.55rem] border border-white/[0.08] bg-white/[0.03] p-5 shadow-[0_24px_70px_rgba(0,0,0,0.2)] backdrop-blur">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl">
            <p className="text-xs uppercase tracking-[0.28em] text-muted-foreground">
              TikTok Spark Ads
            </p>
            <h1 className="mt-2 text-2xl font-medium tracking-[-0.045em] text-foreground">
              Prisma-free paid views lookup.
            </h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              This page talks directly to TikTok’s reporting API. Save an advertiser
              ID and access token in an encrypted browser cookie, then query paid
              delivery by Spark <code>item_id</code> with no workspace database
              required.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              className="inline-flex min-h-11 items-center rounded-[0.95rem] border border-white/[0.12] bg-black/[0.24] px-4 text-sm font-medium text-foreground transition hover:border-white/[0.2]"
              href="/"
            >
              Home
            </Link>
          </div>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-[1.1rem] border border-white/[0.08] bg-black/[0.22] p-4">
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
              Connection
            </p>
            <p className="mt-2 text-sm font-medium text-foreground">
              {connection ? "Connected" : "Missing"}
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              {connection
                ? connection.advertiserName
                  ? `${connection.advertiserName} (${connection.advertiserId})`
                  : connection.advertiserId
                : oauthConfigured
                  ? "Connect with TikTok OAuth or save an advertiser ID and token below."
                  : "Save a TikTok advertiser ID and access token below."}
            </p>
          </div>
          <div className="rounded-[1.1rem] border border-white/[0.08] bg-black/[0.22] p-4">
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
              Storage
            </p>
            <p className="mt-2 text-sm font-medium text-foreground">Encrypted cookie</p>
            <p className="mt-2 text-xs text-muted-foreground">
              Credentials stay out of the URL and are only stored in this browser.
            </p>
          </div>
          <div className="rounded-[1.1rem] border border-white/[0.08] bg-black/[0.22] p-4">
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
              Creator lookup
            </p>
            <p className="mt-2 text-sm font-medium text-foreground">Manual Spark item IDs</p>
            <p className="mt-2 text-xs text-muted-foreground">
              The creator field is now a label only. Paste the Spark <code>item_id</code>
              values you want counted.
            </p>
          </div>
          <div className="rounded-[1.1rem] border border-white/[0.08] bg-black/[0.22] p-4">
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
              Date window
            </p>
            <p className="mt-2 text-sm font-medium text-foreground">
              {formatDate(startDate)} to {formatDate(endDate)}
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              The report runs on demand against TikTok’s integrated reporting API.
            </p>
          </div>
        </div>
      </section>

      {pendingSelection ? (
        <section className="rounded-[1.55rem] border border-[#FFD24D]/20 bg-[#FFD24D]/[0.08] p-5 shadow-[0_24px_70px_rgba(0,0,0,0.2)] backdrop-blur">
          <div className="flex flex-col gap-2">
            <p className="text-xs uppercase tracking-[0.28em] text-[#FFEAB1]/80">
              Advertiser selection
            </p>
            <h2 className="text-lg font-medium tracking-[-0.03em] text-foreground">
              Choose which TikTok advertiser account to use.
            </h2>
            <p className="text-sm leading-6 text-muted-foreground">
              TikTok returned multiple advertiser accounts for this OAuth session.
              Pick the one you want saved into this browser.
            </p>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-2">
            {pendingSelection.advertisers.map((advertiser) => (
              <form
                action={completeOauthSelectionAction}
                className="rounded-[1.15rem] border border-white/[0.08] bg-black/[0.22] p-4"
                key={advertiser.advertiserId}
              >
                <input name="advertiserId" type="hidden" value={advertiser.advertiserId} />
                <input name="returnTo" type="hidden" value={returnTo} />
                <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                  Advertiser
                </p>
                <p className="mt-2 text-sm font-medium text-foreground">
                  {advertiser.advertiserName ?? "Unnamed advertiser"}
                </p>
                <p className="mt-2 text-xs text-muted-foreground">
                  {advertiser.advertiserId}
                </p>
                <button
                  className="mt-4 inline-flex min-h-10 items-center justify-center rounded-[0.95rem] border border-[#90FF4D]/20 bg-[#90FF4D]/90 px-4 text-sm font-medium text-black transition hover:bg-[#A4FF68]"
                  type="submit"
                >
                  Use this advertiser
                </button>
              </form>
            ))}
          </div>
        </section>
      ) : null}

      <section className="rounded-[1.55rem] border border-white/[0.08] bg-white/[0.03] p-5 shadow-[0_24px_70px_rgba(0,0,0,0.2)] backdrop-blur">
        <div className="flex flex-col gap-2">
          <p className="text-xs uppercase tracking-[0.28em] text-muted-foreground">
            TikTok connection
          </p>
          <h2 className="text-lg font-medium tracking-[-0.03em] text-foreground">
            Connect with TikTok or paste credentials manually.
          </h2>
          <p className="text-sm leading-6 text-muted-foreground">
            Use OAuth for the smoothest flow, or paste an advertiser ID and access
            token if you already have one. Either way, the saved connection stays in
            this browser only.
          </p>
        </div>

        {oauthConfigured ? (
          <div className="mt-5 flex flex-wrap gap-3">
            <Link
              className="inline-flex min-h-11 items-center rounded-[0.95rem] border border-[#90FF4D]/20 bg-[#90FF4D]/90 px-4 text-sm font-medium text-black transition hover:bg-[#A4FF68]"
              href={oauthConnectHref}
            >
              Connect with TikTok OAuth
            </Link>
            <p className="self-center text-xs text-muted-foreground">
              TikTok will return here and save the selected advertiser into an
              encrypted cookie.
            </p>
          </div>
        ) : null}

        <form action={saveConnectionAction} className="mt-5 space-y-4">
          <input name="returnTo" type="hidden" value={returnTo} />
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.5fr)_auto]">
            <label className="block">
              <span className="mb-2 block text-xs uppercase tracking-[0.2em] text-muted-foreground">
                Advertiser ID
              </span>
              <input
                className="h-11 w-full rounded-[0.95rem] border border-white/[0.08] bg-black/[0.24] px-3.5 text-sm text-foreground outline-none transition placeholder:text-muted-foreground/60 focus:border-white/[0.16]"
                defaultValue={connection?.advertiserId ?? ""}
                name="advertiserId"
                placeholder="7480039305227098128"
                type="text"
              />
            </label>
            <label className="block">
              <span className="mb-2 block text-xs uppercase tracking-[0.2em] text-muted-foreground">
                Advertiser name
              </span>
              <input
                className="h-11 w-full rounded-[0.95rem] border border-white/[0.08] bg-black/[0.24] px-3.5 text-sm text-foreground outline-none transition placeholder:text-muted-foreground/60 focus:border-white/[0.16]"
                defaultValue={connection?.advertiserName ?? ""}
                name="advertiserName"
                placeholder="Optional label"
                type="text"
              />
            </label>
            <label className="block">
              <span className="mb-2 block text-xs uppercase tracking-[0.2em] text-muted-foreground">
                Access token
              </span>
              <input
                className="h-11 w-full rounded-[0.95rem] border border-white/[0.08] bg-black/[0.24] px-3.5 text-sm text-foreground outline-none transition placeholder:text-muted-foreground/60 focus:border-white/[0.16]"
                defaultValue=""
                name="accessToken"
                placeholder={connection ? "Saved. Paste a fresh token to replace it." : "Paste TikTok Business access token"}
                type="password"
              />
            </label>
            <div className="flex items-end gap-2">
              <button
                className="inline-flex min-h-11 items-center justify-center rounded-[0.95rem] border border-[#90FF4D]/20 bg-[#90FF4D]/90 px-4 text-sm font-medium text-black transition hover:bg-[#A4FF68]"
                type="submit"
              >
                Save connection
              </button>
            </div>
          </div>
        </form>

        {connection ? (
          <form action={clearConnectionAction} className="mt-3">
            <input name="returnTo" type="hidden" value={returnTo} />
            <button
              className="inline-flex min-h-10 items-center rounded-[0.95rem] border border-white/[0.12] bg-black/[0.24] px-4 text-sm font-medium text-foreground transition hover:border-white/[0.2]"
              type="submit"
            >
              Clear saved connection
            </button>
          </form>
        ) : null}

        {connection?.savedAt ? (
          <p className="mt-3 text-xs text-muted-foreground">
            Last saved {dateFormatter.format(connection.savedAt)}.
          </p>
        ) : null}
      </section>

      <section className="rounded-[1.55rem] border border-white/[0.08] bg-white/[0.03] p-5 shadow-[0_24px_70px_rgba(0,0,0,0.2)] backdrop-blur">
        <form className="space-y-4" method="get">
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
            <label className="block">
              <span className="mb-2 block text-xs uppercase tracking-[0.2em] text-muted-foreground">
                Creator label
              </span>
              <input
                className="h-11 w-full rounded-[0.95rem] border border-white/[0.08] bg-black/[0.24] px-3.5 text-sm text-foreground outline-none transition placeholder:text-muted-foreground/60 focus:border-white/[0.16]"
                defaultValue={creatorLabel}
                name="creator"
                placeholder="@creator or campaign label"
                type="text"
              />
            </label>
            <label className="block lg:col-span-1">
              <span className="mb-2 block text-xs uppercase tracking-[0.2em] text-muted-foreground">
                Spark item IDs
              </span>
              <textarea
                className="min-h-24 w-full rounded-[0.95rem] border border-white/[0.08] bg-black/[0.24] px-3.5 py-3 text-sm text-foreground outline-none transition placeholder:text-muted-foreground/60 focus:border-white/[0.16]"
                defaultValue={itemIdsInput}
                name="itemIds"
                placeholder={"Paste comma or newline separated item IDs"}
              />
            </label>
            <label className="block">
              <span className="mb-2 block text-xs uppercase tracking-[0.2em] text-muted-foreground">
                Start date
              </span>
              <input
                className="h-11 w-full rounded-[0.95rem] border border-white/[0.08] bg-black/[0.24] px-3.5 text-sm text-foreground outline-none transition focus:border-white/[0.16]"
                defaultValue={startDate}
                name="startDate"
                type="date"
              />
            </label>
            <label className="block">
              <span className="mb-2 block text-xs uppercase tracking-[0.2em] text-muted-foreground">
                End date
              </span>
              <input
                className="h-11 w-full rounded-[0.95rem] border border-white/[0.08] bg-black/[0.24] px-3.5 text-sm text-foreground outline-none transition focus:border-white/[0.16]"
                defaultValue={endDate}
                name="endDate"
                type="date"
              />
            </label>
            <label className="block">
              <span className="mb-2 block text-xs uppercase tracking-[0.2em] text-muted-foreground">
                Metric
              </span>
              <select
                className="h-11 w-full rounded-[0.95rem] border border-white/[0.08] bg-black/[0.24] px-3.5 text-sm text-foreground outline-none transition focus:border-white/[0.16]"
                defaultValue={metric}
                name="metric"
              >
                {metricOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex items-end">
              <button
                className="inline-flex min-h-11 w-full items-center justify-center rounded-[0.95rem] border border-[#90FF4D]/20 bg-[#90FF4D]/90 px-4 text-sm font-medium text-black transition hover:bg-[#A4FF68]"
                type="submit"
              >
                Run lookup
              </button>
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            The creator field is just a label for the result card. The actual TikTok
            filter runs on the Spark <code>item_id</code> values you provide.
          </p>
        </form>
      </section>

      {errorMessage ? (
        <section className="rounded-[1.25rem] border border-[#FF7E54]/20 bg-[#FF7E54]/[0.08] px-4 py-3 text-sm text-[#FFD3C5]">
          {errorMessage}
        </section>
      ) : null}

      {result ? (
        <>
          <section className="rounded-[1.55rem] border border-white/[0.08] bg-white/[0.03] p-5 shadow-[0_24px_70px_rgba(0,0,0,0.2)] backdrop-blur">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.28em] text-muted-foreground">
                  Result
                </p>
                <h2 className="mt-2 text-xl font-medium tracking-[-0.04em] text-foreground">
                  {result.creatorLabel}
                </h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  Paid {metric === "impressions" ? "impressions" : "video plays"} for
                  the Spark items in the selected date range.
                </p>
              </div>
              <div className="rounded-[1.1rem] border border-[#90FF4D]/20 bg-[#90FF4D]/[0.08] px-4 py-3 text-right">
                <p className="text-xs uppercase tracking-[0.2em] text-[#D7FFBC]">
                  Total paid views
                </p>
                <p className="mt-2 text-3xl font-medium tracking-[-0.04em] text-[#F3FFE8]">
                  {numberFormatter.format(result.paidViews)}
                </p>
              </div>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-[1.1rem] border border-white/[0.08] bg-black/[0.22] p-4">
                <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                  Advertiser ID
                </p>
                <p className="mt-2 text-sm font-medium text-foreground">
                  {result.advertiserId}
                </p>
              </div>
              <div className="rounded-[1.1rem] border border-white/[0.08] bg-black/[0.22] p-4">
                <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                  Spark item IDs
                </p>
                <p className="mt-2 text-sm font-medium text-foreground">
                  {numberFormatter.format(result.matchedSparkItemIds.length)}
                </p>
              </div>
              <div className="rounded-[1.1rem] border border-white/[0.08] bg-black/[0.22] p-4">
                <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                  Report rows
                </p>
                <p className="mt-2 text-sm font-medium text-foreground">
                  {numberFormatter.format(result.rowCount)}
                </p>
              </div>
              <div className="rounded-[1.1rem] border border-white/[0.08] bg-black/[0.22] p-4">
                <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                  Date range
                </p>
                <p className="mt-2 text-sm font-medium text-foreground">
                  {formatDate(result.startDate)} to {formatDate(result.endDate)}
                </p>
              </div>
            </div>

            {result.warnings.length > 0 ? (
              <div className="mt-5 rounded-[1.1rem] border border-[#FFD24D]/20 bg-[#FFD24D]/[0.08] p-4 text-sm text-[#FFEAB1]">
                <p className="text-xs uppercase tracking-[0.2em] text-[#FFEAB1]/80">
                  Warnings
                </p>
                <ul className="mt-2 space-y-1.5">
                  {result.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>

          <section className="rounded-[1.55rem] border border-white/[0.08] bg-white/[0.03] p-5 shadow-[0_24px_70px_rgba(0,0,0,0.2)] backdrop-blur">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.28em] text-muted-foreground">
                  Report rows
                </p>
                <h3 className="mt-2 text-lg font-medium tracking-[-0.03em] text-foreground">
                  Raw TikTok row breakdown
                </h3>
              </div>
            </div>

            {result.rows.length > 0 ? (
              <div className="mt-5 overflow-x-auto">
                <table className="min-w-full divide-y divide-white/[0.08] text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-[0.18em] text-muted-foreground">
                      <th className="py-3 pr-4 font-medium">Date</th>
                      <th className="py-3 pr-4 font-medium">Ad ID</th>
                      <th className="py-3 pr-4 font-medium">Item ID</th>
                      <th className="py-3 font-medium">Value</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.05] text-foreground">
                    {result.rows.map((row, index) => (
                      <tr key={`${row.adId ?? "ad"}-${row.itemId ?? "item"}-${row.statDate ?? index}`}>
                        <td className="py-3 pr-4 text-muted-foreground">
                          {formatDate(row.statDate)}
                        </td>
                        <td className="py-3 pr-4">{row.adId ?? "Unknown"}</td>
                        <td className="py-3 pr-4">{row.itemId ?? "Filtered only"}</td>
                        <td className="py-3">
                          {numberFormatter.format(row.metricValue)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="mt-5 text-sm leading-6 text-muted-foreground">
                TikTok returned no matching paid-delivery rows for those Spark items
                in the selected window.
              </p>
            )}
          </section>
        </>
      ) : itemIdsInput.trim().length > 0 && !errorMessage ? (
        <section className="rounded-[1.25rem] border border-white/[0.08] bg-white/[0.03] px-4 py-3 text-sm text-muted-foreground">
          No paid TikTok data matched those Spark item IDs in the selected date range.
        </section>
      ) : null}
    </div>
  );
}
