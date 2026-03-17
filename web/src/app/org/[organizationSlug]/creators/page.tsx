import Link from "next/link";
import { CreatorStatus } from "@prisma/client";
import { redirect } from "next/navigation";

import { CampaignBadge } from "@/components/org-dashboard/campaign-badge";
import type { DashboardSearchParams } from "@/server/dashboard/filters";
import { formatPlatformLabel } from "@/server/dashboard/filters";
import { trackCreatorAccountForOrganization } from "@/server/creators/mutations";
import { getCreatorsWorkspace } from "@/server/creators/queries";
import { trackedAccountMaxVideoOptions } from "@/server/creators/schemas";

export const dynamic = "force-dynamic";

type CreatorsPageProps = {
  params: Promise<{
    organizationSlug: string;
  }>;
  searchParams: Promise<DashboardSearchParams>;
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

function formatCompactNumber(value: number | null | undefined) {
  if (typeof value !== "number") {
    return null;
  }

  return compactNumberFormatter.format(value);
}

function formatDateLabel(value: Date) {
  return dateFormatter.format(value);
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
          className="inline-flex min-h-10 items-center rounded-full border border-white/[0.08] bg-white/[0.04] px-4 py-2 text-sm text-foreground transition hover:border-white/[0.14] hover:bg-white/[0.07]"
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
          className="inline-flex min-h-10 items-center rounded-full border border-white/[0.08] bg-white/[0.04] px-4 py-2 text-sm text-foreground transition hover:border-white/[0.14] hover:bg-white/[0.07]"
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
        <span className="inline-flex min-h-10 items-center rounded-full border border-white/[0.06] bg-white/[0.02] px-4 py-2 text-sm text-muted-foreground/70">
          Next
        </span>
      )}
    </nav>
  );
}

function getNoticeLabel(value: string | undefined) {
  switch (value) {
    case "account-tracked":
      return "Account added to viral.app and synced locally.";
    case "creator-created":
      return "Creator added to viral.app";
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
            </div>
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

      <section className="rounded-[1.55rem] border border-white/[0.08] bg-white/[0.03] p-5 shadow-[0_24px_70px_rgba(0,0,0,0.2)] backdrop-blur">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.28em] text-muted-foreground">
              Current roster
            </p>
            <h2 className="mt-2 text-xl font-medium tracking-[-0.04em] text-foreground">
              Existing creators in this organization
            </h2>
            {creatorCount > 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">
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
          <div className="mt-5 overflow-x-auto rounded-[1.2rem] border border-white/[0.08] bg-black/[0.18]">
            <table className="min-w-[980px] w-full border-collapse text-left">
              <thead className="bg-white/[0.03]">
                <tr>
                  <th className="px-4 py-3 text-[0.62rem] font-normal uppercase tracking-[0.22em] text-muted-foreground">
                    Creator
                  </th>
                  <th className="px-4 py-3 text-[0.62rem] font-normal uppercase tracking-[0.22em] text-muted-foreground">
                    Status
                  </th>
                  <th className="px-4 py-3 text-[0.62rem] font-normal uppercase tracking-[0.22em] text-muted-foreground">
                    Accounts
                  </th>
                  <th className="px-4 py-3 text-[0.62rem] font-normal uppercase tracking-[0.22em] text-muted-foreground">
                    Details
                  </th>
                  <th className="px-4 py-3 text-[0.62rem] font-normal uppercase tracking-[0.22em] text-muted-foreground">
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
                    <td className="px-4 py-4">
                      <p className="max-w-[16rem] text-sm font-medium text-foreground">
                        {creator.displayName}
                      </p>
                      {creator.notesSummary ? (
                        <p className="mt-1 max-w-[20rem] truncate text-sm text-muted-foreground">
                          {creator.notesSummary}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-4 py-4">
                      <span className="rounded-full border border-white/[0.08] bg-white/[0.04] px-2.5 py-1 text-[0.62rem] uppercase tracking-[0.2em] text-muted-foreground">
                        {formatStatusLabel(creator.internalStatus)}
                      </span>
                      <p className="mt-2 max-w-[14rem] text-xs leading-5 text-muted-foreground">
                        {creator.providerCreatorId || creator.platformAccounts.length > 0
                          ? "Linked to a viral.app tracked account."
                          : "No viral.app account linked yet."}
                      </p>
                    </td>
                    <td className="px-4 py-4">
                      {creator.platformAccounts.length > 0 ? (
                        <div className="space-y-2">
                          {creator.platformAccounts.slice(0, 3).map((account) => (
                            <div
                              key={account.id}
                              className="rounded-[0.95rem] border border-white/[0.08] bg-white/[0.03] px-3 py-2.5"
                            >
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="min-w-0">
                                  <p className="truncate text-sm font-medium text-foreground">
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
                                  <p className="mt-1 text-xs text-muted-foreground">
                                    {formatPlatformLabel(account.platform)}
                                  </p>
                                </div>
                                <div className="text-right text-xs text-muted-foreground">
                                  <p>
                                    {formatCompactNumber(account.followerCount) ?? "No"} followers
                                  </p>
                                  <p className="mt-1">
                                    {formatCompactNumber(account.averageViews) ?? "No"} avg views
                                  </p>
                                </div>
                              </div>
                            </div>
                          ))}
                          {creator.platformAccounts.length > 3 ? (
                            <p className="text-xs text-muted-foreground">
                              +{creator.platformAccounts.length - 3} more account
                              {creator.platformAccounts.length - 3 === 1 ? "" : "s"}
                            </p>
                          ) : null}
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground">
                          No platform accounts linked yet.
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex max-w-[16rem] flex-wrap gap-2 text-[0.68rem] uppercase tracking-[0.18em] text-muted-foreground">
                        {creator.campaignLinks.map((link) => (
                            <CampaignBadge
                              key={link.campaign.id}
                              campaignId={link.campaign.id}
                              compact
                              label={link.campaign.name}
                            />
                        ))}
                        {creator.primaryNiche ? (
                          <span className="rounded-full border border-white/[0.08] bg-white/[0.04] px-2.5 py-1">
                            {creator.primaryNiche}
                          </span>
                        ) : null}
                        {creator.region ? (
                          <span className="rounded-full border border-white/[0.08] bg-white/[0.04] px-2.5 py-1">
                            {creator.region}
                          </span>
                        ) : null}
                        {creator.language ? (
                          <span className="rounded-full border border-white/[0.08] bg-white/[0.04] px-2.5 py-1">
                            {creator.language}
                          </span>
                        ) : null}
                        {creator.customTags.map((tag) => (
                          <span
                            key={tag}
                            className="rounded-full border border-[#90FF4D]/20 bg-[#90FF4D]/[0.08] px-2.5 py-1 text-[#C7FFA4]"
                          >
                            #{tag}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-4 text-sm text-muted-foreground">
                      {formatDateLabel(creator.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="mt-5 rounded-[1.2rem] border border-dashed border-white/[0.08] bg-black/[0.18] px-4 py-10 text-sm text-muted-foreground">
            No creators yet. Paste the first profile URL above to track a creator
            account in viral.app and store it in this workspace.
          </div>
        )}
      </section>
    </div>
  );
}
