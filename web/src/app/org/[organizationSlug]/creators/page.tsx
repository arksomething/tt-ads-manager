import Link from "next/link";
import {
  CreatorDealPaidTrafficMetric,
  CreatorDealPerVideoCapScope,
  CreatorStatus,
  MessagingChannel,
  Platform,
} from "@/lib/prisma-shim";
import { redirect } from "next/navigation";
import { type ReactNode } from "react";

import { CampaignBadge } from "@/components/org-dashboard/campaign-badge";
import type { DashboardSearchParams } from "@/server/dashboard/filters";
import { formatPlatformLabel } from "@/server/dashboard/filters";
import {
  removeCreatorContactPointForOrganization,
  requestSparkCodeForCreatorInOrganization,
  setCreatorStatusForOrganization,
  syncTrackedTikTokWorkspaceForOrganization,
  trackCreatorAccountForOrganization,
  upsertCreatorContactPointForOrganization,
} from "@/server/creators/mutations";
import { getCreatorsWorkspace } from "@/server/creators/queries";
import { trackedAccountMaxVideoOptions } from "@/server/creators/schemas";
import {
  deleteCampaignCreatorDealForOrganization,
  upsertCampaignCreatorDealForOrganization,
} from "@/server/payouts/mutations";

export const dynamic = "force-dynamic";

type CreatorsPageProps = {
  params: Promise<{
    organizationSlug: string;
  }>;
  searchParams: Promise<DashboardSearchParams>;
};

type CreatorContactPointRow = {
  id: string;
  channel: MessagingChannel;
  phoneE164: string;
  isPrimary: boolean;
};

type CreatorPlatformAccountRow = {
  id: string;
  platform: Platform;
  handle: string;
  profileUrl: string | null;
  followerCount: number | null;
  averageViews: number | null;
};

type CreatorDealRow = {
  id: string;
  currency: string;
  effectiveStartDate: Date;
  effectiveEndDate: Date | null;
  fixedFee: number | null;
  fixedFeeRecognitionDate: Date | null;
  fixedFeePerVideo: number | null;
  cpmAmount: number | null;
  paidTrafficMetric: CreatorDealPaidTrafficMetric;
  deductPaidTraffic: boolean;
  viewCapPerVideo: number | null;
  viewWindowDays: number | null;
  payoutCapPerVideo: number | null;
  perVideoCapScope: CreatorDealPerVideoCapScope;
  payoutCapTotal: number | null;
  notes: string | null;
};

type CreatorCampaignLinkRow = {
  id: string;
  createdAt: Date;
  canEditDeal: boolean;
  campaign: {
    id: string;
    name: string;
  };
  deal: CreatorDealRow | null;
};

type CreatorVideoOption = {
  id: string;
  sourceVideoId: string | null;
  titleOrCaption: string | null;
};

const compactNumberFormatter = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});
const wholeNumberFormatter = new Intl.NumberFormat("en-US");
const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});
const currencyFormatters = new Map<string, Intl.NumberFormat>();

function getSearchParamValue(
  searchParams: DashboardSearchParams,
  key: string,
) {
  const value = searchParams[key];
  return Array.isArray(value) ? value[0] : value;
}

function parseRequestedPage(searchParams: DashboardSearchParams) {
  const rawValue = getSearchParamValue(searchParams, "page");
  const parsedValue = rawValue ? Number.parseInt(rawValue, 10) : 1;
  return Number.isInteger(parsedValue) && parsedValue > 0 ? parsedValue : 1;
}

function buildCreatorsPageHref(args: {
  organizationSlug: string;
  searchParams: DashboardSearchParams;
  page?: number;
  notice?: string | null;
  error?: string | null;
}) {
  const nextSearchParams = new URLSearchParams();

  for (const [key, value] of Object.entries(args.searchParams)) {
    if (
      value == null ||
      key === "notice" ||
      key === "error" ||
      key === "page"
    ) {
      continue;
    }

    if (Array.isArray(value)) {
      for (const entry of value) {
        nextSearchParams.append(key, entry);
      }

      continue;
    }

    nextSearchParams.set(key, value);
  }

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
  const baseHref = `/org/${args.organizationSlug}/creators`;
  return query ? `${baseHref}?${query}` : baseHref;
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

function formatStatusLabel(status: CreatorStatus) {
  return status
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatChannelLabel(channel: MessagingChannel) {
  return channel === MessagingChannel.WHATSAPP ? "WhatsApp" : "SMS";
}

function formatCompactNumber(value: number | null | undefined) {
  if (typeof value !== "number") {
    return null;
  }

  return compactNumberFormatter.format(value);
}

function formatDateLabel(value: Date) {
  return dateFormatter.format(value);
}

function formatDateInputValue(value: Date | string | null | undefined) {
  if (!value) {
    return "";
  }

  const parsedValue = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsedValue.getTime())
    ? ""
    : parsedValue.toISOString().slice(0, 10);
}

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

function formatOptionalMoney(value: number | null | undefined, currency = "USD") {
  return value == null ? "None" : formatMoney(value, currency);
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
  searchParams,
}: {
  currentPage: number;
  organizationSlug: string;
  pageCount: number;
  searchParams: DashboardSearchParams;
}) {
  if (pageCount <= 1) {
    return null;
  }

  const pageItems = getPaginationItems(currentPage, pageCount);

  return (
    <nav
      aria-label="Creators pagination"
      className="flex flex-wrap items-center gap-2"
    >
      {currentPage > 1 ? (
        <Link
          className="inline-flex h-8 items-center rounded-full border border-white/[0.08] bg-white/[0.04] px-3 text-xs text-foreground transition hover:border-white/[0.14] hover:bg-white/[0.07]"
          href={buildCreatorsPageHref({
            organizationSlug,
            searchParams,
            page: currentPage - 1,
          })}
          prefetch={false}
        >
          Previous
        </Link>
      ) : (
        <span className="inline-flex h-8 items-center rounded-full border border-white/[0.06] bg-white/[0.02] px-3 text-xs text-muted-foreground/70">
          Previous
        </span>
      )}

      {pageItems.map((item, index) =>
        item === "ellipsis" ? (
          <span
            key={`ellipsis-${index}`}
            className="px-1 text-xs text-muted-foreground"
          >
            ...
          </span>
        ) : (
          <Link
            key={item}
            aria-current={item === currentPage ? "page" : undefined}
            className={`inline-flex h-8 min-w-8 items-center justify-center rounded-full border px-2 text-xs transition ${
              item === currentPage
                ? "border-[#90FF4D]/40 bg-[#90FF4D]/90 text-black shadow-[0_10px_24px_rgba(144,255,77,0.26)]"
                : "border-white/[0.08] bg-white/[0.04] text-foreground hover:border-white/[0.14] hover:bg-white/[0.07]"
            }`}
            href={buildCreatorsPageHref({
              organizationSlug,
              searchParams,
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
          className="inline-flex h-8 items-center rounded-full border border-white/[0.08] bg-white/[0.04] px-3 text-xs text-foreground transition hover:border-white/[0.14] hover:bg-white/[0.07]"
          href={buildCreatorsPageHref({
            organizationSlug,
            searchParams,
            page: currentPage + 1,
          })}
          prefetch={false}
        >
          Next
        </Link>
      ) : (
        <span className="inline-flex h-8 items-center rounded-full border border-white/[0.06] bg-white/[0.02] px-3 text-xs text-muted-foreground/70">
          Next
        </span>
      )}
    </nav>
  );
}

function DealTerm({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <div className="min-w-0 rounded-[0.85rem] border border-white/[0.08] bg-black/[0.14] px-3 py-2.5">
      <p className="text-[0.56rem] uppercase tracking-[0.16em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 truncate text-xs font-medium text-foreground">{value}</p>
      {detail ? (
        <p className="mt-1 truncate text-[0.68rem] text-muted-foreground">
          {detail}
        </p>
      ) : null}
    </div>
  );
}

function FieldLabel({
  children,
  label,
}: {
  children: ReactNode;
  label: string;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[0.56rem] uppercase tracking-[0.16em] text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}

const dealInputClassName =
  "w-full rounded-[0.65rem] border border-white/[0.08] bg-black/[0.18] px-2 py-1.5 text-xs text-foreground outline-none transition focus:border-white/[0.16] disabled:cursor-not-allowed disabled:opacity-60";

const compactControlClassName =
  "h-7 rounded-[0.65rem] border border-white/[0.08] bg-black/[0.24] px-2 text-xs text-foreground outline-none transition focus:border-white/[0.16]";

function getDealCurrency(
  deal: { currency: string } | null | undefined,
) {
  return deal?.currency ?? "USD";
}

function getDealCpmAmount(
  deal: { cpmAmount: number | null } | null | undefined,
) {
  return deal?.cpmAmount ?? 1;
}

function getDealViewWindowDays(
  deal: { viewWindowDays: number | null } | null | undefined,
) {
  return Math.max(deal?.viewWindowDays ?? 30, 1);
}

function getDealPayoutCapPerVideo(
  deal: { payoutCapPerVideo: number | null } | null | undefined,
) {
  return deal?.payoutCapPerVideo ?? 100;
}

function getDealPerVideoCapScope(
  deal:
    | { perVideoCapScope: CreatorDealPerVideoCapScope }
    | null
    | undefined,
) {
  return deal?.perVideoCapScope ?? CreatorDealPerVideoCapScope.CPM;
}

function formatPerVideoCapLabel(args: {
  payoutCapPerVideo: number;
  perVideoCapScope: CreatorDealPerVideoCapScope;
  currency: string;
}) {
  switch (args.perVideoCapScope) {
    case CreatorDealPerVideoCapScope.NONE:
      return "No per-video cap";
    case CreatorDealPerVideoCapScope.TOTAL:
      return `${formatMoney(args.payoutCapPerVideo, args.currency)} total/video`;
    default:
      return `${formatMoney(args.payoutCapPerVideo, args.currency)} CPM/video`;
  }
}

function getNoticeLabel(value: string | undefined) {
  switch (value) {
    case "account-tracked":
      return "Account added to viral.app and synced locally.";
    case "creator-created":
      return "Creator added to viral.app";
    case "tracked-sync-complete":
      return "Tracked TikTok creators and videos were synced from viral.app.";
    case "contact-saved":
      return "Creator contact point saved.";
    case "contact-removed":
      return "Creator contact point removed.";
    case "creator-archived":
      return "Creator excluded locally. Archived creators stay synced but are ignored in payouts.";
    case "creator-restored":
      return "Creator restored locally and included in payouts again.";
    case "spark-request-sent":
      return "Spark code request sent.";
    case "deal-saved":
      return "Creator deal structure saved.";
    case "deal-cleared":
      return "Creator deal override removed.";
    default:
      return undefined;
  }
}

export default async function CreatorsPage({
  params,
  searchParams,
}: CreatorsPageProps) {
  const { organizationSlug } = await params;
  const resolvedSearchParams = await searchParams;
  const requestedPage = parseRequestedPage(resolvedSearchParams);
  const workspace = await getCreatorsWorkspace({
    organizationSlug,
    page: requestedPage,
  });
  const notice = getNoticeLabel(
    getSearchParamValue(resolvedSearchParams, "notice"),
  );
  const error = getErrorLabel(getSearchParamValue(resolvedSearchParams, "error"));
  const creatorCount = workspace.totalCount;
  const defaultCampaignId =
    workspace.campaignOptions.length === 1
      ? workspace.campaignOptions[0]?.id ?? ""
      : "";
  const showingStart =
    creatorCount === 0 ? 0 : (workspace.currentPage - 1) * workspace.pageSize + 1;
  const showingEnd =
    creatorCount === 0 ? 0 : showingStart + workspace.creators.length - 1;

  async function trackCreatorAction(formData: FormData) {
    "use server";

    try {
      await trackCreatorAccountForOrganization(organizationSlug, {
        profileUrl: getTrimmedFormValue(formData, "profileUrl"),
        campaignId: getTrimmedFormValue(formData, "campaignId"),
        maxVideos: getTrimmedFormValue(formData, "maxVideos"),
      });

      redirect(
        buildCreatorsPageHref({
          organizationSlug,
          searchParams: resolvedSearchParams,
          page: workspace.currentPage,
          notice: "account-tracked",
          error: null,
        }),
      );
    } catch (createError) {
      redirect(
        buildCreatorsPageHref({
          organizationSlug,
          searchParams: resolvedSearchParams,
          page: workspace.currentPage,
          notice: null,
          error: getActionErrorMessage(createError),
        }),
      );
    }
  }

  async function syncTrackedWorkspaceAction() {
    "use server";

    try {
      await syncTrackedTikTokWorkspaceForOrganization(organizationSlug);

      redirect(
        buildCreatorsPageHref({
          organizationSlug,
          searchParams: resolvedSearchParams,
          page: workspace.currentPage,
          notice: "tracked-sync-complete",
          error: null,
        }),
      );
    } catch (syncError) {
      redirect(
        buildCreatorsPageHref({
          organizationSlug,
          searchParams: resolvedSearchParams,
          page: workspace.currentPage,
          notice: null,
          error: getActionErrorMessage(syncError),
        }),
      );
    }
  }

  async function upsertContactPointAction(formData: FormData) {
    "use server";

    try {
      await upsertCreatorContactPointForOrganization({
        organizationSlug,
        input: {
          creatorId: getTrimmedFormValue(formData, "creatorId"),
          channel: getTrimmedFormValue(formData, "channel"),
          phoneE164: getTrimmedFormValue(formData, "phoneE164"),
          isPrimary:
            getTrimmedFormValue(formData, "isPrimary") === "on" ||
            getTrimmedFormValue(formData, "isPrimary") === "true",
        },
      });

      redirect(
        buildCreatorsPageHref({
          organizationSlug,
          searchParams: resolvedSearchParams,
          page: workspace.currentPage,
          notice: "contact-saved",
          error: null,
        }),
      );
    } catch (contactError) {
      redirect(
        buildCreatorsPageHref({
          organizationSlug,
          searchParams: resolvedSearchParams,
          page: workspace.currentPage,
          notice: null,
          error: getActionErrorMessage(contactError),
        }),
      );
    }
  }

  async function removeContactPointAction(formData: FormData) {
    "use server";

    try {
      await removeCreatorContactPointForOrganization({
        organizationSlug,
        input: {
          contactPointId: getTrimmedFormValue(formData, "contactPointId"),
        },
      });

      redirect(
        buildCreatorsPageHref({
          organizationSlug,
          searchParams: resolvedSearchParams,
          page: workspace.currentPage,
          notice: "contact-removed",
          error: null,
        }),
      );
    } catch (contactError) {
      redirect(
        buildCreatorsPageHref({
          organizationSlug,
          searchParams: resolvedSearchParams,
          page: workspace.currentPage,
          notice: null,
          error: getActionErrorMessage(contactError),
        }),
      );
    }
  }

  async function requestSparkCodeAction(formData: FormData) {
    "use server";

    try {
      await requestSparkCodeForCreatorInOrganization({
        organizationSlug,
        input: {
          creatorId: getTrimmedFormValue(formData, "creatorId"),
          channel: getTrimmedFormValue(formData, "channel"),
          contactPointId: getTrimmedFormValue(formData, "contactPointId"),
          videoId: getTrimmedFormValue(formData, "videoId"),
        },
      });

      redirect(
        buildCreatorsPageHref({
          organizationSlug,
          searchParams: resolvedSearchParams,
          page: workspace.currentPage,
          notice: "spark-request-sent",
          error: null,
        }),
      );
    } catch (requestError) {
      redirect(
        buildCreatorsPageHref({
          organizationSlug,
          searchParams: resolvedSearchParams,
          page: workspace.currentPage,
          notice: null,
          error: getActionErrorMessage(requestError),
        }),
      );
    }
  }

  async function setCreatorStatusAction(formData: FormData) {
    "use server";

    const nextStatus = getTrimmedFormValue(formData, "internalStatus");

    try {
      await setCreatorStatusForOrganization({
        organizationSlug,
        input: {
          creatorId: getTrimmedFormValue(formData, "creatorId"),
          internalStatus: nextStatus,
        },
      });

      redirect(
        buildCreatorsPageHref({
          organizationSlug,
          searchParams: resolvedSearchParams,
          page: workspace.currentPage,
          notice:
            nextStatus === CreatorStatus.ARCHIVED
              ? "creator-archived"
              : "creator-restored",
          error: null,
        }),
      );
    } catch (statusError) {
      redirect(
        buildCreatorsPageHref({
          organizationSlug,
          searchParams: resolvedSearchParams,
          page: workspace.currentPage,
          notice: null,
          error: getActionErrorMessage(statusError),
        }),
      );
    }
  }

  async function saveDealAction(formData: FormData) {
    "use server";

    try {
      await upsertCampaignCreatorDealForOrganization({
        organizationSlug,
        input: {
          campaignCreatorId: getTrimmedFormValue(formData, "campaignCreatorId"),
          currency: getTrimmedFormValue(formData, "currency") || "USD",
          effectiveStartDate: getTrimmedFormValue(formData, "effectiveStartDate"),
          effectiveEndDate:
            getTrimmedFormValue(formData, "effectiveEndDate") || undefined,
          fixedFee: getTrimmedFormValue(formData, "fixedFee") || undefined,
          fixedFeeRecognitionDate:
            getTrimmedFormValue(formData, "fixedFeeRecognitionDate") || undefined,
          fixedFeePerVideo:
            getTrimmedFormValue(formData, "fixedFeePerVideo") || undefined,
          cpmAmount: getTrimmedFormValue(formData, "cpmAmount") || undefined,
          paidTrafficMetric:
            getTrimmedFormValue(formData, "paidTrafficMetric") || undefined,
          deductPaidTraffic: formData.get("deductPaidTraffic") === "on",
          viewCapPerVideo:
            getTrimmedFormValue(formData, "viewCapPerVideo") || undefined,
          viewWindowDays:
            getTrimmedFormValue(formData, "viewWindowDays") || undefined,
          payoutCapPerVideo:
            getTrimmedFormValue(formData, "payoutCapPerVideo") || undefined,
          perVideoCapScope:
            getTrimmedFormValue(formData, "perVideoCapScope") || undefined,
          payoutCapTotal:
            getTrimmedFormValue(formData, "payoutCapTotal") || undefined,
          notes: getTrimmedFormValue(formData, "notes") || undefined,
        },
      });

      redirect(
        buildCreatorsPageHref({
          organizationSlug,
          searchParams: resolvedSearchParams,
          page: workspace.currentPage,
          notice: "deal-saved",
          error: null,
        }),
      );
    } catch (dealError) {
      redirect(
        buildCreatorsPageHref({
          organizationSlug,
          searchParams: resolvedSearchParams,
          page: workspace.currentPage,
          notice: null,
          error: getActionErrorMessage(dealError),
        }),
      );
    }
  }

  async function clearDealAction(formData: FormData) {
    "use server";

    try {
      await deleteCampaignCreatorDealForOrganization({
        organizationSlug,
        input: {
          campaignCreatorId: getTrimmedFormValue(formData, "campaignCreatorId"),
        },
      });

      redirect(
        buildCreatorsPageHref({
          organizationSlug,
          searchParams: resolvedSearchParams,
          page: workspace.currentPage,
          notice: "deal-cleared",
          error: null,
        }),
      );
    } catch (dealError) {
      redirect(
        buildCreatorsPageHref({
          organizationSlug,
          searchParams: resolvedSearchParams,
          page: workspace.currentPage,
          notice: null,
          error: getActionErrorMessage(dealError),
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

      <section className="max-w-3xl">
        <aside className="rounded-[1.55rem] border border-white/[0.08] bg-white/[0.03] p-5 shadow-[0_24px_70px_rgba(0,0,0,0.2)] backdrop-blur">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.28em] text-muted-foreground">
                Track account
              </p>
              <h1 className="mt-2 text-xl font-medium tracking-[-0.04em] text-foreground">
                Track creator account
              </h1>
              <p className="mt-2 text-sm text-muted-foreground">
                Paste a TikTok, Instagram, or YouTube profile URL. We&apos;ll add
                the account to viral.app and sync the creator locally.
              </p>
              <p className="mt-2 text-sm text-muted-foreground">
                For tracked TikTok accounts already in viral.app, use the bulk sync
                action below. You can exclude any synced creator locally without
                deleting them upstream.
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              {workspace.canManageOrganizationData ? (
                <form action={syncTrackedWorkspaceAction}>
                  <button
                    className="inline-flex min-h-10 items-center rounded-[0.95rem] border border-[#90FF4D]/20 bg-[#90FF4D]/90 px-3.5 text-sm font-medium text-black transition hover:bg-[#A4FF68]"
                    type="submit"
                  >
                    Sync tracked TikTok creators
                  </button>
                </form>
              ) : null}
              {notice || error ? (
                <Link
                  href={buildCreatorsPageHref({
                    organizationSlug,
                    searchParams: resolvedSearchParams,
                    page: workspace.currentPage,
                    notice: null,
                    error: null,
                  })}
                  className="inline-flex min-h-10 items-center rounded-[0.95rem] border border-white/[0.08] bg-white/[0.04] px-3.5 text-sm text-muted-foreground transition hover:border-white/[0.14] hover:bg-white/[0.07] hover:text-foreground"
                >
                  Clear flash
                </Link>
              ) : null}
            </div>
          </div>

          {workspace.canTrackCreators ? (
            <form action={trackCreatorAction} className="mt-5 space-y-4">
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_13rem_15rem]">
                <label className="block">
                  <span className="mb-2 block text-xs uppercase tracking-[0.2em] text-muted-foreground">
                    Profile URL
                  </span>
                  <input
                    className="h-11 w-full rounded-[0.95rem] border border-white/[0.08] bg-black/[0.24] px-3.5 text-sm text-foreground outline-none transition placeholder:text-muted-foreground/60 focus:border-white/[0.16]"
                    name="profileUrl"
                    placeholder="https://www.tiktok.com/@creator"
                    required
                    type="url"
                  />
                </label>

                <label className="block">
                  <span className="mb-2 block text-xs uppercase tracking-[0.2em] text-muted-foreground">
                    Videos to track
                  </span>
                  <select
                    className="h-11 w-full rounded-[0.95rem] border border-white/[0.08] bg-black/[0.24] px-3.5 text-sm text-foreground outline-none transition focus:border-white/[0.16]"
                    defaultValue="100"
                    name="maxVideos"
                  >
                    {trackedAccountMaxVideoOptions.map((value) => (
                      <option key={value} value={value}>
                        {value === 0 ? "0 (profile only)" : `${value} videos`}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block">
                  <span className="mb-2 block text-xs uppercase tracking-[0.2em] text-muted-foreground">
                    Campaign
                  </span>
                  <select
                    className="h-11 w-full rounded-[0.95rem] border border-white/[0.08] bg-black/[0.24] px-3.5 text-sm text-foreground outline-none transition focus:border-white/[0.16]"
                    defaultValue={defaultCampaignId}
                    name="campaignId"
                    required
                  >
                    <option value="">Choose a campaign</option>
                    {workspace.campaignOptions.map((campaign) => (
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
                  Track account
                </button>
                <p className="text-xs leading-5 text-muted-foreground sm:max-w-sm sm:text-right">
                  Every tracked creator is assigned to a campaign immediately.
                </p>
              </div>
            </form>
          ) : (
            <div className="mt-5 rounded-[1.2rem] border border-dashed border-white/[0.08] bg-black/[0.18] px-4 py-10 text-sm text-muted-foreground">
              Create or join at least one campaign before tracking creator
              accounts.
            </div>
          )}
        </aside>
      </section>

      <section className="rounded-[1.2rem] border border-white/[0.08] bg-white/[0.03] p-3 shadow-[0_24px_70px_rgba(0,0,0,0.2)] backdrop-blur sm:p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-[0.6rem] uppercase tracking-[0.24em] text-muted-foreground">
              Current roster
            </p>
            <h2 className="mt-1 text-lg font-medium text-foreground">
              Existing creators in this organization
            </h2>
            {creatorCount > 0 ? (
              <p className="mt-1 text-xs text-muted-foreground">
                Showing {wholeNumberFormatter.format(showingStart)}-
                {wholeNumberFormatter.format(showingEnd)} of{" "}
                {wholeNumberFormatter.format(creatorCount)} creators.
              </p>
            ) : null}
          </div>
          <div className="flex flex-col gap-2 sm:items-end">
            <p className="text-sm text-muted-foreground">
              {wholeNumberFormatter.format(creatorCount)} creator
              {creatorCount === 1 ? "" : "s"}
            </p>
            <PaginationNav
              currentPage={workspace.currentPage}
              organizationSlug={organizationSlug}
              pageCount={workspace.pageCount}
              searchParams={resolvedSearchParams}
            />
          </div>
        </div>

        {creatorCount > 0 ? (
          <div className="mt-3 overflow-x-auto rounded-[0.95rem] border border-white/[0.08] bg-black/[0.18]">
            <table className="min-w-[1120px] w-full border-collapse text-left">
              <thead className="bg-white/[0.03]">
                <tr>
                  <th className="px-3 py-2 text-[0.58rem] font-normal uppercase tracking-[0.18em] text-muted-foreground">
                    Creator
                  </th>
                  <th className="px-3 py-2 text-[0.58rem] font-normal uppercase tracking-[0.18em] text-muted-foreground">
                    Status
                  </th>
                  <th className="px-3 py-2 text-[0.58rem] font-normal uppercase tracking-[0.18em] text-muted-foreground">
                    Accounts
                  </th>
                  <th className="px-3 py-2 text-[0.58rem] font-normal uppercase tracking-[0.18em] text-muted-foreground">
                    Deals
                  </th>
                  <th className="px-3 py-2 text-[0.58rem] font-normal uppercase tracking-[0.18em] text-muted-foreground">
                    Added
                  </th>
                </tr>
              </thead>
              <tbody>
                {workspace.creators.map((creator) => (
                  <tr
                    key={creator.id}
                    className="border-t border-white/[0.08] align-top transition hover:bg-white/[0.02]"
                  >
                    <td className="px-3 py-2.5">
                      <p className="max-w-[14rem] truncate text-sm font-medium text-foreground">
                        {creator.displayName}
                      </p>
                      {creator.notesSummary ? (
                        <p className="mt-0.5 max-w-[16rem] truncate text-xs text-muted-foreground">
                          {creator.notesSummary}
                        </p>
                      ) : null}
                      <div className="mt-2">
                        {creator.contactPoints.length > 0 ? (
                          <div className="flex max-w-[18rem] flex-wrap gap-1.5">
                            {creator.contactPoints.map(
                              (contactPoint: CreatorContactPointRow) => (
                              <div
                                key={contactPoint.id}
                                className="flex h-7 items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.03] px-2"
                              >
                                <span className="text-[0.56rem] uppercase text-muted-foreground">
                                  {formatChannelLabel(contactPoint.channel)}
                                </span>
                                <span className="max-w-[8rem] truncate text-xs text-foreground">
                                  {contactPoint.phoneE164}
                                </span>
                                {contactPoint.isPrimary ? (
                                  <span className="text-[0.56rem] uppercase text-[#B8FF86]">
                                    Pri
                                  </span>
                                ) : null}
                                {workspace.canManageOrganizationData ? (
                                  <form action={removeContactPointAction}>
                                    <input
                                      name="contactPointId"
                                      type="hidden"
                                      value={contactPoint.id}
                                    />
                                    <button
                                      className="text-[0.62rem] text-muted-foreground transition hover:text-foreground"
                                      type="submit"
                                    >
                                      x
                                    </button>
                                  </form>
                                ) : null}
                              </div>
                              ),
                            )}
                          </div>
                        ) : (
                          <p className="text-xs text-muted-foreground">No contact</p>
                        )}
                      </div>
                      {workspace.canManageOrganizationData ? (
                        <form action={upsertContactPointAction} className="mt-2">
                          <input name="creatorId" type="hidden" value={creator.id} />
                          <div className="grid gap-1.5 sm:grid-cols-[4.8rem_minmax(0,1fr)_auto]">
                            <select
                              className={compactControlClassName}
                              defaultValue={MessagingChannel.SMS}
                              name="channel"
                            >
                              <option value={MessagingChannel.SMS}>SMS</option>
                              <option value={MessagingChannel.WHATSAPP}>WhatsApp</option>
                            </select>
                            <input
                              className={`${compactControlClassName} min-w-0 placeholder:text-muted-foreground/60`}
                              name="phoneE164"
                              placeholder="+15551234567"
                              required
                              type="text"
                            />
                            <button
                              className="inline-flex h-7 items-center rounded-[0.65rem] border border-[#90FF4D]/20 bg-[#90FF4D]/90 px-2 text-xs font-medium text-black transition hover:bg-[#A4FF68]"
                              type="submit"
                            >
                              Save
                            </button>
                          </div>
                          <label className="mt-1.5 inline-flex items-center gap-1.5 text-[0.68rem] text-muted-foreground">
                            <input
                              className="h-3 w-3 rounded border border-white/[0.2] bg-black/[0.24]"
                              defaultChecked
                              name="isPrimary"
                              type="checkbox"
                              value="true"
                            />
                            Primary
                          </label>
                        </form>
                      ) : null}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="rounded-full border border-white/[0.08] bg-white/[0.04] px-2 py-0.5 text-[0.58rem] uppercase text-muted-foreground">
                        {formatStatusLabel(creator.internalStatus)}
                      </span>
                      <p className="mt-1 max-w-[10rem] text-[0.68rem] leading-4 text-muted-foreground">
                        {creator.internalStatus === CreatorStatus.ARCHIVED
                          ? "Excluded locally"
                          : creator.providerCreatorId || creator.platformAccounts.length > 0
                            ? "viral.app linked"
                            : "No viral.app link"}
                      </p>
                      {workspace.canManageOrganizationData ? (
                        <form action={setCreatorStatusAction} className="mt-2">
                          <input name="creatorId" type="hidden" value={creator.id} />
                          <input
                            name="internalStatus"
                            type="hidden"
                            value={
                              creator.internalStatus === CreatorStatus.ARCHIVED
                                ? CreatorStatus.ACTIVE
                                : CreatorStatus.ARCHIVED
                            }
                          />
                          <button
                            className={`inline-flex h-7 items-center rounded-[0.65rem] border px-2 text-[0.58rem] uppercase transition ${
                              creator.internalStatus === CreatorStatus.ARCHIVED
                                ? "border-[#90FF4D]/20 bg-[#90FF4D]/10 text-[#D4FFB2] hover:bg-[#90FF4D]/16"
                                : "border-white/[0.08] bg-black/[0.22] text-muted-foreground hover:border-white/[0.14] hover:text-foreground"
                            }`}
                            type="submit"
                          >
                            {creator.internalStatus === CreatorStatus.ARCHIVED
                              ? "Restore"
                              : "Exclude"}
                          </button>
                        </form>
                      ) : null}
                    </td>
                    <td className="px-3 py-2.5">
                      {creator.platformAccounts.length > 0 ? (
                        <div className="space-y-1.5">
                          {creator.platformAccounts
                            .slice(0, 3)
                            .map((account: CreatorPlatformAccountRow) => (
                            <div
                              key={account.id}
                              className="rounded-[0.7rem] border border-white/[0.08] bg-white/[0.03] px-2.5 py-1.5"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <div className="min-w-0">
                                  <p className="truncate text-xs font-medium text-foreground">
                                    {account.profileUrl ? (
                                      <a
                                        className="transition hover:text-[#C7FFA4]"
                                        href={account.profileUrl}
                                        rel="noreferrer"
                                        target="_blank"
                                      >
                                        @{account.handle}
                                      </a>
                                    ) : (
                                      `@${account.handle}`
                                    )}
                                  </p>
                                  <p className="text-[0.68rem] text-muted-foreground">
                                    {formatPlatformLabel(account.platform)}
                                  </p>
                                </div>
                                <div className="shrink-0 text-right text-[0.68rem] leading-4 text-muted-foreground">
                                  <p>
                                    {formatCompactNumber(account.followerCount) ?? "No"} followers
                                  </p>
                                  <p>
                                    {formatCompactNumber(account.averageViews) ?? "No"} avg views
                                  </p>
                                </div>
                              </div>
                            </div>
                            ))}
                          {creator.platformAccounts.length > 3 ? (
                            <p className="text-[0.68rem] text-muted-foreground">
                              +{creator.platformAccounts.length - 3} more account
                              {creator.platformAccounts.length - 3 === 1 ? "" : "s"}
                            </p>
                          ) : null}
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground">
                          No accounts
                        </p>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      {creator.campaignLinks.length > 0 ? (
                        <div className="w-[30rem] max-w-full space-y-1.5">
                          {creator.campaignLinks.map(
                            (link: CreatorCampaignLinkRow) => {
                            const deal = link.deal;
                            const currency = getDealCurrency(deal);
                            const cpmAmount = getDealCpmAmount(deal);
                            const viewWindowDays = getDealViewWindowDays(deal);
                            const payoutCapPerVideo =
                              getDealPayoutCapPerVideo(deal);
                            const perVideoCapScope =
                              getDealPerVideoCapScope(deal);

                            return (
                              <details
                                key={link.id}
                                className="group rounded-[0.75rem] border border-white/[0.08] bg-white/[0.03]"
                              >
                                <summary className="cursor-pointer list-none px-2.5 py-1.5">
                                  <div className="flex items-center justify-between gap-2">
                                    <div className="min-w-0 flex-1">
                                      <div className="flex min-w-0 items-center gap-1.5">
                                        <CampaignBadge
                                          campaignId={link.campaign.id}
                                          compact
                                          label={link.campaign.name}
                                        />
                                        <span
                                          className={`rounded-full border px-1.5 py-0.5 text-[0.52rem] uppercase ${
                                            deal
                                              ? "border-[#90FF4D]/20 bg-[#90FF4D]/10 text-[#D4FFB2]"
                                              : "border-white/[0.08] bg-white/[0.05] text-muted-foreground"
                                          }`}
                                        >
                                          {deal ? "custom" : "default"}
                                        </span>
                                        {!link.canEditDeal ? (
                                          <span className="rounded-full border border-[#FFD24D]/20 bg-[#FFD24D]/10 px-1.5 py-0.5 text-[0.52rem] uppercase text-[#FFE7A6]">
                                            read only
                                          </span>
                                        ) : null}
                                      </div>
                                      <p className="mt-1 truncate text-[0.68rem] text-muted-foreground">
                                        {formatOptionalMoney(deal?.fixedFee, currency)} fixed,{" "}
                                        {formatMoney(cpmAmount, currency)} CPM,{" "}
                                        {formatPerVideoCapLabel({
                                          currency,
                                          payoutCapPerVideo,
                                          perVideoCapScope,
                                        })}
                                      </p>
                                    </div>
                                    <span className="inline-flex h-7 items-center rounded-[0.65rem] border border-white/[0.08] bg-black/[0.18] px-2 text-xs text-foreground transition group-open:border-white/[0.16] group-open:bg-white/[0.07]">
                                      Edit
                                    </span>
                                  </div>
                                </summary>

                                <div className="border-t border-white/[0.08] px-2.5 py-2.5">
                                  <div className="grid gap-2 sm:grid-cols-3">
                                    <DealTerm
                                      detail={
                                        deal?.fixedFeePerVideo != null
                                          ? "per-video fee enabled"
                                          : undefined
                                      }
                                      label="Fixed"
                                      value={`${formatOptionalMoney(deal?.fixedFee, currency)} base${
                                        deal?.fixedFeePerVideo != null
                                          ? ` + ${formatMoney(
                                              deal.fixedFeePerVideo,
                                              currency,
                                            )}/video`
                                          : ""
                                      }`}
                                    />
                                    <DealTerm
                                      detail={
                                        deal?.deductPaidTraffic ?? true
                                          ? "paid traffic deducted"
                                          : "gross views"
                                      }
                                      label="CPM"
                                      value={formatMoney(cpmAmount, currency)}
                                    />
                                    <DealTerm
                                      detail={
                                        deal?.effectiveEndDate
                                          ? `Ends ${formatDateLabel(
                                              deal.effectiveEndDate,
                                            )}`
                                          : "No end date"
                                      }
                                      label="Window"
                                      value={`${wholeNumberFormatter.format(
                                        viewWindowDays,
                                      )} days`}
                                    />
                                  </div>

                                  <form action={saveDealAction} className="mt-3 space-y-3">
                                    <input
                                      name="campaignCreatorId"
                                      type="hidden"
                                      value={link.id}
                                    />
                                    <div className="grid gap-2 sm:grid-cols-3">
                                      <FieldLabel label="Currency">
                                        <input
                                          className={dealInputClassName}
                                          defaultValue={currency}
                                          disabled={!link.canEditDeal}
                                          maxLength={3}
                                          name="currency"
                                        />
                                      </FieldLabel>
                                      <FieldLabel label="Deal Start">
                                        <input
                                          className={dealInputClassName}
                                          defaultValue={
                                            formatDateInputValue(
                                              deal?.effectiveStartDate,
                                            ) || formatDateInputValue(link.createdAt)
                                          }
                                          disabled={!link.canEditDeal}
                                          name="effectiveStartDate"
                                          type="date"
                                        />
                                      </FieldLabel>
                                      <FieldLabel label="Deal End">
                                        <input
                                          className={dealInputClassName}
                                          defaultValue={formatDateInputValue(
                                            deal?.effectiveEndDate,
                                          )}
                                          disabled={!link.canEditDeal}
                                          name="effectiveEndDate"
                                          type="date"
                                        />
                                      </FieldLabel>
                                      <FieldLabel label="Base Fixed Fee">
                                        <input
                                          className={dealInputClassName}
                                          defaultValue={deal?.fixedFee ?? ""}
                                          disabled={!link.canEditDeal}
                                          name="fixedFee"
                                          placeholder="0.00"
                                          step="0.01"
                                          type="number"
                                        />
                                      </FieldLabel>
                                      <FieldLabel label="Fixed Fee Date">
                                        <input
                                          className={dealInputClassName}
                                          defaultValue={formatDateInputValue(
                                            deal?.fixedFeeRecognitionDate,
                                          )}
                                          disabled={!link.canEditDeal}
                                          name="fixedFeeRecognitionDate"
                                          type="date"
                                        />
                                      </FieldLabel>
                                      <FieldLabel label="Fixed / Video">
                                        <input
                                          className={dealInputClassName}
                                          defaultValue={deal?.fixedFeePerVideo ?? ""}
                                          disabled={!link.canEditDeal}
                                          name="fixedFeePerVideo"
                                          placeholder="0.00"
                                          step="0.01"
                                          type="number"
                                        />
                                      </FieldLabel>
                                      <FieldLabel label="CPM">
                                        <input
                                          className={dealInputClassName}
                                          defaultValue={cpmAmount}
                                          disabled={!link.canEditDeal}
                                          name="cpmAmount"
                                          placeholder="0.00"
                                          step="0.01"
                                          type="number"
                                        />
                                      </FieldLabel>
                                      <FieldLabel label="View Window">
                                        <input
                                          className={dealInputClassName}
                                          defaultValue={viewWindowDays}
                                          disabled={!link.canEditDeal}
                                          min="1"
                                          name="viewWindowDays"
                                          step="1"
                                          type="number"
                                        />
                                      </FieldLabel>
                                      <FieldLabel label="Paid Metric">
                                        <select
                                          className={dealInputClassName}
                                          defaultValue={
                                            deal?.paidTrafficMetric ??
                                            CreatorDealPaidTrafficMetric.IMPRESSIONS
                                          }
                                          disabled={!link.canEditDeal}
                                          name="paidTrafficMetric"
                                        >
                                          <option
                                            value={
                                              CreatorDealPaidTrafficMetric.IMPRESSIONS
                                            }
                                          >
                                            Impressions
                                          </option>
                                          <option
                                            value={
                                              CreatorDealPaidTrafficMetric.VIDEO_PLAY_ACTIONS
                                            }
                                          >
                                            Video plays
                                          </option>
                                        </select>
                                      </FieldLabel>
                                      <FieldLabel label="View Cap / Video">
                                        <input
                                          className={dealInputClassName}
                                          defaultValue={deal?.viewCapPerVideo ?? ""}
                                          disabled={!link.canEditDeal}
                                          name="viewCapPerVideo"
                                          placeholder="100000"
                                          step="1"
                                          type="number"
                                        />
                                      </FieldLabel>
                                      <FieldLabel label="Payout Cap / Video">
                                        <input
                                          className={dealInputClassName}
                                          defaultValue={payoutCapPerVideo}
                                          disabled={!link.canEditDeal}
                                          name="payoutCapPerVideo"
                                          placeholder="100.00"
                                          step="0.01"
                                          type="number"
                                        />
                                      </FieldLabel>
                                      <FieldLabel label="Cap Scope">
                                        <select
                                          className={dealInputClassName}
                                          defaultValue={perVideoCapScope}
                                          disabled={!link.canEditDeal}
                                          name="perVideoCapScope"
                                        >
                                          <option
                                            value={CreatorDealPerVideoCapScope.CPM}
                                          >
                                            Cap CPM only
                                          </option>
                                          <option
                                            value={
                                              CreatorDealPerVideoCapScope.TOTAL
                                            }
                                          >
                                            Cap total video pay
                                          </option>
                                          <option
                                            value={CreatorDealPerVideoCapScope.NONE}
                                          >
                                            No per-video cap
                                          </option>
                                        </select>
                                      </FieldLabel>
                                      <FieldLabel label="Total Payout Cap">
                                        <input
                                          className={dealInputClassName}
                                          defaultValue={deal?.payoutCapTotal ?? ""}
                                          disabled={!link.canEditDeal}
                                          name="payoutCapTotal"
                                          placeholder="0.00"
                                          step="0.01"
                                          type="number"
                                        />
                                      </FieldLabel>
                                      <FieldLabel label="Notes">
                                        <input
                                          className={dealInputClassName}
                                          defaultValue={deal?.notes ?? ""}
                                          disabled={!link.canEditDeal}
                                          name="notes"
                                          placeholder="Manual payout rules"
                                        />
                                      </FieldLabel>
                                    </div>
                                    <label className="flex min-h-9 items-center gap-2 rounded-[0.75rem] border border-white/[0.08] bg-black/[0.14] px-2.5 py-2 text-xs text-foreground">
                                      <input
                                        defaultChecked={deal?.deductPaidTraffic ?? true}
                                        disabled={!link.canEditDeal}
                                        name="deductPaidTraffic"
                                        type="checkbox"
                                      />
                                      Deduct paid traffic
                                    </label>
                                    <div className="flex flex-wrap items-center gap-2">
                                      <button
                                        className="inline-flex min-h-8 items-center rounded-[0.8rem] border border-[#90FF4D]/20 bg-[#90FF4D]/90 px-3 text-xs font-medium text-black transition hover:bg-[#A4FF68] disabled:cursor-not-allowed disabled:opacity-60"
                                        disabled={!link.canEditDeal}
                                        type="submit"
                                      >
                                        Save deal
                                      </button>
                                      {!link.canEditDeal ? (
                                        <span className="text-xs text-muted-foreground">
                                          You do not have edit access for this campaign.
                                        </span>
                                      ) : null}
                                    </div>
                                  </form>

                                  <form action={clearDealAction} className="mt-2">
                                    <input
                                      name="campaignCreatorId"
                                      type="hidden"
                                      value={link.id}
                                    />
                                    <button
                                      className="text-xs text-muted-foreground transition hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
                                      disabled={!link.canEditDeal || !deal}
                                      type="submit"
                                    >
                                      Remove custom override
                                    </button>
                                  </form>
                                </div>
                              </details>
                            );
                            },
                          )}
                        </div>
                      ) : null}
                      {workspace.canManageOrganizationData ? (
                        <form action={requestSparkCodeAction} className="mt-2">
                          <input name="creatorId" type="hidden" value={creator.id} />
                          <div className="grid gap-1.5 sm:grid-cols-[5.5rem_minmax(0,1fr)_auto]">
                            <label className="block">
                              <select
                                aria-label="Spark request channel"
                                className={`${compactControlClassName} w-full`}
                                defaultValue={MessagingChannel.SMS}
                                name="channel"
                              >
                                <option value={MessagingChannel.SMS}>SMS</option>
                                <option value={MessagingChannel.WHATSAPP}>
                                  WhatsApp
                                </option>
                              </select>
                            </label>
                            <label className="block">
                              <select
                                aria-label="Spark request video"
                                className={`${compactControlClassName} w-full`}
                                defaultValue=""
                                name="videoId"
                              >
                                <option value="">No specific video</option>
                                {creator.videos.map((video: CreatorVideoOption) => (
                                  <option key={video.id} value={video.id}>
                                    {video.sourceVideoId ??
                                      video.titleOrCaption ??
                                      "Tracked video"}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <button
                              className="inline-flex h-7 items-center rounded-[0.65rem] border border-[#90FF4D]/20 bg-[#90FF4D]/90 px-2 text-xs font-medium text-black transition hover:bg-[#A4FF68] disabled:cursor-not-allowed disabled:border-white/[0.08] disabled:bg-white/[0.08] disabled:text-muted-foreground"
                              disabled={creator.contactPoints.length === 0}
                              type="submit"
                            >
                              Spark
                            </button>
                          </div>
                        </form>
                      ) : null}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-muted-foreground">
                      {formatDateLabel(creator.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="mt-5 rounded-[1.2rem] border border-dashed border-white/[0.08] bg-black/[0.18] px-4 py-10 text-sm text-muted-foreground">
            No creators yet. Sync all tracked TikTok creators from viral.app above,
            or paste the first profile URL to start tracking a creator account here.
          </div>
        )}
      </section>
    </div>
  );
}
