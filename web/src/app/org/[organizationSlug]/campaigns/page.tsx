import Link from "next/link";
import { CampaignRole } from "@/lib/prisma-shim";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import {
  CampaignDetailPanel,
  CampaignDetailPanelSkeleton,
} from "@/components/org-dashboard/campaign-detail-panel";
import { CampaignSwatch } from "@/components/org-dashboard/campaign-badge";
import { OrgToolbar } from "@/components/org-dashboard/org-toolbar";
import { getCampaignColorTone } from "@/lib/campaign-colors";
import {
  dashboardDateRangeOptions,
  getSelectedIdsFromSearchParams,
  type DashboardSearchParams,
} from "@/server/dashboard/filters";
import {
  createCampaignForOrganization,
  deleteCampaignForOrganization,
  importTikTokAdPreviewUrlsForOrganization,
  inviteCampaignMember,
  removeCampaignMember,
  revokeCampaignInvitation,
  updateCampaignForOrganization,
  updateCampaignMemberRole,
} from "@/server/campaigns/mutations";
import {
  getCampaignTikTokVideoReconciliation,
  getCampaignWorkspace,
  type CampaignTikTokReconciliationRow,
} from "@/server/campaigns/queries";

export const dynamic = "force-dynamic";

type CampaignsPageProps = {
  params: Promise<{
    organizationSlug: string;
  }>;
  searchParams: Promise<DashboardSearchParams>;
};

type CampaignDateValue = Date | string | null | undefined;
type CampaignDeleteState = {
  creatorsCount: number;
  videosCount: number;
  payoutsCount: number;
};

const campaignDateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});
const campaignNumberFormatter = new Intl.NumberFormat("en-US");
const campaignCompactNumberFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 1,
  notation: "compact",
});
const campaignCurrencyFormatter = new Intl.NumberFormat("en-US", {
  currency: "USD",
  maximumFractionDigits: 2,
  style: "currency",
});
const campaignPercentFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
  style: "percent",
});
const campaignListFormatter = new Intl.ListFormat("en-US", {
  style: "long",
  type: "conjunction",
});

function getSearchParamValue(
  searchParams: DashboardSearchParams,
  key: string,
) {
  const value = searchParams[key];
  return Array.isArray(value) ? value[0] : value;
}

function createCampaignHref(args: {
  organizationSlug: string;
  searchParams: DashboardSearchParams;
  campaignId: string;
}) {
  const nextSearchParams = new URLSearchParams();

  for (const [key, value] of Object.entries(args.searchParams)) {
    if (value == null) {
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

  nextSearchParams.set("campaign", args.campaignId);

  const query = nextSearchParams.toString();
  const baseHref = `/org/${args.organizationSlug}/campaigns`;
  return query ? `${baseHref}?${query}` : baseHref;
}

function toDateOnlyString(value: Date) {
  return value.toISOString().slice(0, 10);
}

function getDefaultReconciliationStartDate() {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - 6);
  return toDateOnlyString(date);
}

function getDefaultReconciliationEndDate() {
  return toDateOnlyString(new Date());
}

function getReconciliationDateRange(searchParams: DashboardSearchParams) {
  const fallbackStartDate = getDefaultReconciliationStartDate();
  const fallbackEndDate = getDefaultReconciliationEndDate();
  const startDate = getSearchParamValue(searchParams, "startDate");
  const endDate = getSearchParamValue(searchParams, "endDate");
  const normalizedStartDate =
    startDate && /^\d{4}-\d{2}-\d{2}$/.test(startDate)
      ? startDate
      : fallbackStartDate;
  const normalizedEndDate =
    endDate && /^\d{4}-\d{2}-\d{2}$/.test(endDate)
      ? endDate
      : fallbackEndDate;

  if (normalizedEndDate < normalizedStartDate) {
    return {
      startDate: fallbackStartDate,
      endDate: fallbackEndDate,
    };
  }

  return {
    startDate: normalizedStartDate,
    endDate: normalizedEndDate,
  };
}

function getCampaignSearchValue(searchParams: DashboardSearchParams) {
  return getSearchParamValue(searchParams, "campaigns");
}

function getActiveCampaignSearchValue(searchParams: DashboardSearchParams) {
  return getSearchParamValue(searchParams, "campaign");
}

function getActionErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong.";
}

function getTrimmedFormValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function formatCampaignDateLabel(
  value: CampaignDateValue,
  fallback = "Unknown",
) {
  if (!value) {
    return fallback;
  }

  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return fallback;
  }

  return campaignDateFormatter.format(date);
}

function formatCampaignMetric(value: number | null | undefined, fallback = "--") {
  if (typeof value !== "number") {
    return fallback;
  }

  return campaignNumberFormatter.format(value);
}

function formatCampaignCompactMetric(
  value: number | null | undefined,
  fallback = "--",
) {
  if (typeof value !== "number") {
    return fallback;
  }

  return campaignCompactNumberFormatter.format(value);
}

function formatCampaignCurrency(
  value: number | null | undefined,
  fallback = "--",
) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  return campaignCurrencyFormatter.format(value);
}

function formatCampaignPercent(
  value: number | null | undefined,
  fallback = "--",
) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  return campaignPercentFormatter.format(value);
}

function getCampaignRatio(
  numerator: number | null | undefined,
  denominator: number | null | undefined,
) {
  if (
    typeof numerator !== "number" ||
    typeof denominator !== "number" ||
    !Number.isFinite(numerator) ||
    !Number.isFinite(denominator) ||
    denominator <= 0
  ) {
    return null;
  }

  return numerator / denominator;
}

function formatCampaignRoas(value: number | null | undefined, fallback = "--") {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  return `${campaignNumberFormatter.format(
    Math.round(value * 100) / 100,
  )}x`;
}

function getVideoTitle(row: CampaignTikTokReconciliationRow) {
  const title = row.titleOrCaption?.trim();

  if (title && title.length > 0) {
    return title;
  }

  if (row.creatorName) {
    return `${row.creatorName} on TikTok`;
  }

  if (row.sourceVideoId) {
    return `TikTok post ${row.sourceVideoId}`;
  }

  return row.matchedAdIds[0]
    ? `TikTok ad ${row.matchedAdIds[0]}`
    : "TikTok paid video";
}

function getHandleLabel(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  return value.startsWith("@") ? value : `@${value}`;
}

function getTikTokCampaignLabel(row: CampaignTikTokReconciliationRow) {
  if (row.tiktokCampaignName) {
    return row.tiktokCampaignName;
  }

  if (row.tiktokCampaignId) {
    return `TikTok campaign ${row.tiktokCampaignId}`;
  }

  return "Unknown TikTok campaign";
}

function getTikTokAdgroupLabel(row: CampaignTikTokReconciliationRow) {
  if (row.tiktokAdgroupName) {
    return row.tiktokAdgroupName;
  }

  if (row.tiktokAdgroupId) {
    return `TikTok ad group ${row.tiktokAdgroupId}`;
  }

  return "Unknown ad group";
}

function getTikTokAdLabel(row: CampaignTikTokReconciliationRow) {
  if (row.tiktokAdName) {
    return row.tiktokAdName;
  }

  if (row.tiktokAdId) {
    return `TikTok ad ${row.tiktokAdId}`;
  }

  return "Unknown ad";
}

function getTikTokSourceContentLabel(row: CampaignTikTokReconciliationRow) {
  if (row.tiktokAdSourceName) {
    return row.tiktokAdSourceName;
  }

  if (row.titleOrCaption) {
    return row.titleOrCaption;
  }

  if (row.sourceVideoId) {
    return `TikTok post ${row.sourceVideoId}`;
  }

  return null;
}

function getAdsManagerPathSegments(row: CampaignTikTokReconciliationRow) {
  const sourceContentLabel = getTikTokSourceContentLabel(row);
  const segments = [
    {
      label: "Campaign",
      name: getTikTokCampaignLabel(row),
      id: row.tiktokCampaignId,
    },
    {
      label: "Ad group",
      name: getTikTokAdgroupLabel(row),
      id: row.tiktokAdgroupId,
    },
    sourceContentLabel
      ? {
          label: "Source content",
          name: sourceContentLabel,
          id: row.sourceVideoId,
        }
      : null,
    {
      label: "Ad",
      name: getTikTokAdLabel(row),
      id: row.tiktokAdId,
    },
  ];

  return segments.filter(
    (segment): segment is Exclude<(typeof segments)[number], null> =>
      segment !== null,
  );
}

function getVideoLinkSourceLabel(
  source: CampaignTikTokReconciliationRow["videoUrlSource"],
) {
  switch (source) {
    case "preview":
      return "Preview URL";
    case "tiktok_share":
      return "TikTok share link";
    case "local":
      return "Local video link";
    default:
      return null;
  }
}

function formatMatchSource(source: CampaignTikTokReconciliationRow["matchSources"][number]) {
  switch (source) {
    case "report_item_id":
      return "report item_id";
    case "ad_metadata_item_id":
      return "ad metadata item";
    case "report_campaign_id":
      return "report campaign_id";
    default:
      return "ad metadata campaign";
  }
}

function formatEvidenceLabel(row: CampaignTikTokReconciliationRow) {
  if (row.reportRowCount === 0) {
    return "No TikTok rows in range";
  }

  const details = [
    `${formatCampaignMetric(row.reportRowCount)} TikTok row${
      row.reportRowCount === 1 ? "" : "s"
    }`,
    row.matchedAdIds.length > 0
      ? `${formatCampaignMetric(row.matchedAdIds.length)} ad${
          row.matchedAdIds.length === 1 ? "" : "s"
        }`
      : null,
    row.statDates.length > 0
      ? `${formatCampaignMetric(row.statDates.length)} day${
          row.statDates.length === 1 ? "" : "s"
        }`
      : null,
  ].filter((value): value is string => Boolean(value));

  return details.join(" / ");
}

function getBackgroundImageStyle(imageUrl: string) {
  return {
    backgroundImage: `url(${JSON.stringify(imageUrl)})`,
    backgroundPosition: "center",
    backgroundRepeat: "no-repeat",
    backgroundSize: "cover",
  } as const;
}

function pluralizeLabel(count: number, singular: string) {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
}

function isCampaignReadyForPermanentDelete({
  creatorsCount,
  videosCount,
  payoutsCount,
}: CampaignDeleteState) {
  return creatorsCount === 0 && videosCount === 0 && payoutsCount === 0;
}

function getCampaignDeleteMessage({
  creatorsCount,
  videosCount,
  payoutsCount,
}: CampaignDeleteState) {
  const blockers = [
    creatorsCount > 0 ? pluralizeLabel(creatorsCount, "creator") : null,
    videosCount > 0 ? pluralizeLabel(videosCount, "video") : null,
    payoutsCount > 0 ? pluralizeLabel(payoutsCount, "payout") : null,
  ].filter((value): value is string => Boolean(value));

  if (blockers.length === 0) {
    return "Delete is available. Memberships and pending invitations will be removed with the campaign.";
  }

  return `Delete is unavailable while this campaign still has ${campaignListFormatter.format(
    blockers,
  )} linked.`;
}

function getNoticeLabel(value: string | undefined) {
  switch (value) {
    case "campaign-created":
      return "Campaign created";
    case "campaign-deleted":
      return "Campaign deleted";
    case "campaign-updated":
      return "Campaign renamed";
    case "campaign-member-invited":
      return "Campaign member invited";
    case "campaign-member-updated":
      return "Campaign member updated";
    case "campaign-member-removed":
      return "Campaign member removed";
    case "campaign-invite-revoked":
      return "Campaign invite revoked";
    case "tiktok-preview-imported":
      return "TikTok preview URLs imported";
    default:
      return undefined;
  }
}

function getErrorLabel(value: string | undefined) {
  if (!value) {
    return value;
  }

  return value.startsWith("NEXT_REDIRECT") ? undefined : value;
}

export default async function CampaignsPage({
  params,
  searchParams,
}: CampaignsPageProps) {
  const { organizationSlug } = await params;
  const resolvedSearchParams = await searchParams;
  const workspace = await getCampaignWorkspace(organizationSlug);
  const visibleCampaignIds = getSelectedIdsFromSearchParams(
    resolvedSearchParams,
    "campaigns",
    workspace.campaigns.map((campaign) => campaign.id),
  );
  const visibleCampaigns = workspace.campaigns.filter((campaign) =>
    visibleCampaignIds.includes(campaign.id),
  );
  const reconciliationDateRange =
    getReconciliationDateRange(resolvedSearchParams);
  const reconciliation = await getCampaignTikTokVideoReconciliation({
    organizationSlug,
    campaignIds: visibleCampaignIds,
    startDate: reconciliationDateRange.startDate,
    endDate: reconciliationDateRange.endDate,
  });
  const campaignFilterValue = getCampaignSearchValue(resolvedSearchParams);
  const activeCampaignValue = getActiveCampaignSearchValue(resolvedSearchParams);
  const requestedCampaignId = getSearchParamValue(resolvedSearchParams, "campaign");
  const activeCampaignSummary =
    visibleCampaigns.find((campaign) => campaign.id === requestedCampaignId) ??
    visibleCampaigns[0] ??
    null;
  const notice = getNoticeLabel(getSearchParamValue(resolvedSearchParams, "notice"));
  const error = getErrorLabel(getSearchParamValue(resolvedSearchParams, "error"));
  const campaignMemberCount = visibleCampaigns.reduce(
    (total, campaign) => total + campaign._count.memberships,
    0,
  );
  const linkedCreatorCount = visibleCampaigns.reduce(
    (total, campaign) => total + campaign._count.creators,
    0,
  );
  const linkedVideoCount = visibleCampaigns.reduce(
    (total, campaign) => total + campaign._count.videos,
    0,
  );
  const campaignRoleOptions = [CampaignRole.MANAGER, CampaignRole.MEMBER];
  const activeCampaignViewerMembership = activeCampaignSummary?.memberships[0] ?? null;
  const canCreateCampaign = workspace.canManageOrganizationCampaigns;
  const canImportPreviewUrls = workspace.canManageOrganizationCampaigns;
  const canManageActiveCampaign = activeCampaignSummary
    ? workspace.canManageOrganizationCampaigns ||
      activeCampaignSummary.owner?.id === workspace.membership.userId ||
      activeCampaignViewerMembership?.role === CampaignRole.OWNER ||
      activeCampaignViewerMembership?.role === CampaignRole.MANAGER
    : false;
  const canDeleteActiveCampaign = activeCampaignSummary
    ? workspace.canManageOrganizationCampaigns ||
      activeCampaignSummary.owner?.id === workspace.membership.userId ||
      activeCampaignViewerMembership?.role === CampaignRole.OWNER
    : false;
  const activeInviteRoleOptions = campaignRoleOptions;
  const activeCampaignDeleteState = activeCampaignSummary
    ? {
        creatorsCount: activeCampaignSummary._count.creators,
        videosCount: activeCampaignSummary._count.videos,
        payoutsCount: activeCampaignSummary._count.payouts,
      }
    : null;
  const canPermanentlyDeleteActiveCampaign =
    canDeleteActiveCampaign &&
    activeCampaignDeleteState != null &&
    isCampaignReadyForPermanentDelete(activeCampaignDeleteState);
  const activeDeleteAvailabilityMessage =
    activeCampaignDeleteState == null
      ? null
      : canDeleteActiveCampaign
        ? getCampaignDeleteMessage(activeCampaignDeleteState)
        : "Only organization admins/owners and campaign owners can delete this campaign.";
  const totalRoas = getCampaignRatio(
    reconciliation.totals.attributedRevenue,
    reconciliation.totals.tiktokSpend,
  );

  async function createCampaignAction(formData: FormData) {
    "use server";

    try {
      await createCampaignForOrganization(organizationSlug, {
        name: getTrimmedFormValue(formData, "name"),
      });
    } catch (createError) {
      redirect(
        `/org/${organizationSlug}/campaigns?error=${encodeURIComponent(
          getActionErrorMessage(createError),
        )}`,
      );
    }

    redirect(`/org/${organizationSlug}/campaigns?notice=campaign-created`);
  }

  async function importTikTokPreviewUrlsAction(formData: FormData) {
    "use server";

    try {
      const file = formData.get("previewFile");

      if (!(file instanceof File) || file.size === 0) {
        throw new Error("Choose the TikTok preview URL CSV first.");
      }

      await importTikTokAdPreviewUrlsForOrganization({
        organizationSlug,
        csvText: await file.text(),
        sourceFileName: file.name,
      });
    } catch (importError) {
      redirect(
        `/org/${organizationSlug}/campaigns?error=${encodeURIComponent(
          getActionErrorMessage(importError),
        )}`,
      );
    }

    redirect(`/org/${organizationSlug}/campaigns?notice=tiktok-preview-imported`);
  }

  async function updateCampaignAction(formData: FormData) {
    "use server";

    try {
      await updateCampaignForOrganization({
        organizationSlug,
        campaignId: String(formData.get("campaignId") ?? ""),
        input: {
          name: getTrimmedFormValue(formData, "name"),
        },
      });
    } catch (updateError) {
      redirect(
        `/org/${organizationSlug}/campaigns?error=${encodeURIComponent(
          getActionErrorMessage(updateError),
        )}`,
      );
    }

    redirect(`/org/${organizationSlug}/campaigns?notice=campaign-updated`);
  }

  async function deleteCampaignAction(formData: FormData) {
    "use server";

    try {
      await deleteCampaignForOrganization({
        organizationSlug,
        campaignId: String(formData.get("campaignId") ?? ""),
      });
    } catch (deleteError) {
      redirect(
        `/org/${organizationSlug}/campaigns?error=${encodeURIComponent(
          getActionErrorMessage(deleteError),
        )}`,
      );
    }

    redirect(`/org/${organizationSlug}/campaigns?notice=campaign-deleted`);
  }

  async function inviteCampaignMemberAction(formData: FormData) {
    "use server";

    try {
      await inviteCampaignMember({
        organizationSlug,
        campaignId: String(formData.get("campaignId") ?? ""),
        input: {
          email: formData.get("email"),
          role: formData.get("role") as CampaignRole,
        },
      });
    } catch (inviteError) {
      redirect(
        `/org/${organizationSlug}/campaigns?error=${encodeURIComponent(
          getActionErrorMessage(inviteError),
        )}`,
      );
    }

    redirect(`/org/${organizationSlug}/campaigns?notice=campaign-member-invited`);
  }

  async function updateCampaignMemberRoleAction(formData: FormData) {
    "use server";

    try {
      await updateCampaignMemberRole({
        organizationSlug,
        campaignId: String(formData.get("campaignId") ?? ""),
        input: {
          membershipId: formData.get("membershipId"),
          role: formData.get("role"),
        },
      });
    } catch (updateError) {
      redirect(
        `/org/${organizationSlug}/campaigns?error=${encodeURIComponent(
          getActionErrorMessage(updateError),
        )}`,
      );
    }

    redirect(`/org/${organizationSlug}/campaigns?notice=campaign-member-updated`);
  }

  async function removeCampaignMemberAction(formData: FormData) {
    "use server";

    try {
      await removeCampaignMember({
        organizationSlug,
        campaignId: String(formData.get("campaignId") ?? ""),
        input: {
          membershipId: formData.get("membershipId"),
        },
      });
    } catch (removeError) {
      redirect(
        `/org/${organizationSlug}/campaigns?error=${encodeURIComponent(
          getActionErrorMessage(removeError),
        )}`,
      );
    }

    redirect(`/org/${organizationSlug}/campaigns?notice=campaign-member-removed`);
  }

  async function revokeCampaignInvitationAction(formData: FormData) {
    "use server";

    try {
      await revokeCampaignInvitation({
        organizationSlug,
        campaignId: String(formData.get("campaignId") ?? ""),
        input: {
          invitationId: formData.get("invitationId"),
        },
      });
    } catch (revokeError) {
      redirect(
        `/org/${organizationSlug}/campaigns?error=${encodeURIComponent(
          getActionErrorMessage(revokeError),
        )}`,
      );
    }

    redirect(`/org/${organizationSlug}/campaigns?notice=campaign-invite-revoked`);
  }

  return (
    <div className="space-y-6">
      <OrgToolbar
        accountOptions={[]}
        campaignOptions={workspace.campaigns.map((campaign) => ({
          id: campaign.id,
          label: campaign.name,
        }))}
        dateRangeOptions={[...dashboardDateRangeOptions]}
        showAccountFilter={false}
        showActionButtons={false}
        showDateRangeFilter={false}
        showUtilityButtons={false}
      />

      {notice || error ? (
        <section
          className={`rounded-[1.25rem] border px-4 py-3 text-sm ${
            error
              ? "border-[#FF7E54]/25 bg-[#FF7E54]/10 text-[#FFD5C8]"
              : "border-[#90FF4D]/25 bg-[#90FF4D]/10 text-[#D7FFBD]"
          }`}
        >
          {error ?? notice}
        </section>
      ) : null}

      <section className="grid gap-4 md:grid-cols-4">
        <article className="rounded-[1.4rem] border border-white/[0.08] bg-white/[0.03] p-5">
          <p className="text-[0.62rem] uppercase tracking-[0.22em] text-muted-foreground">
            Visible campaigns
          </p>
          <p className="mt-3 text-2xl font-medium tracking-[-0.04em] text-foreground">
            {visibleCampaigns.length}
          </p>
        </article>
        <article className="rounded-[1.4rem] border border-white/[0.08] bg-white/[0.03] p-5">
          <p className="text-[0.62rem] uppercase tracking-[0.22em] text-muted-foreground">
            Members across campaigns
          </p>
          <p className="mt-3 text-2xl font-medium tracking-[-0.04em] text-foreground">
            {campaignMemberCount}
          </p>
        </article>
        <article className="rounded-[1.4rem] border border-white/[0.08] bg-white/[0.03] p-5">
          <p className="text-[0.62rem] uppercase tracking-[0.22em] text-muted-foreground">
            Linked creators
          </p>
          <p className="mt-3 text-2xl font-medium tracking-[-0.04em] text-foreground">
            {linkedCreatorCount}
          </p>
        </article>
        <article className="rounded-[1.4rem] border border-white/[0.08] bg-white/[0.03] p-5">
          <p className="text-[0.62rem] uppercase tracking-[0.22em] text-muted-foreground">
            Linked videos
          </p>
          <p className="mt-3 text-2xl font-medium tracking-[-0.04em] text-foreground">
            {linkedVideoCount}
          </p>
        </article>
      </section>

      <section className="rounded-[1.7rem] border border-white/[0.08] bg-white/[0.03] p-6 shadow-[0_22px_70px_rgba(0,0,0,0.2)]">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="max-w-3xl">
            <p className="text-[0.62rem] uppercase tracking-[0.24em] text-muted-foreground">
              TikTok reconciliation
            </p>
            <h2 className="mt-3 text-2xl font-medium text-foreground">
              Videos by TikTok campaign.
            </h2>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              This table starts from TikTok Ads Manager paid delivery, then
              attaches the matching local/viral.app video when the TikTok post ID
              is available.
            </p>
          </div>

          <form
            className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]"
            method="get"
          >
            {campaignFilterValue ? (
              <input name="campaigns" type="hidden" value={campaignFilterValue} />
            ) : null}
            {activeCampaignValue ? (
              <input name="campaign" type="hidden" value={activeCampaignValue} />
            ) : null}

            <label className="block">
              <span className="mb-2 block text-[0.62rem] uppercase tracking-[0.2em] text-muted-foreground">
                Start date
              </span>
              <input
                className="h-11 w-full rounded-[0.95rem] border border-white/[0.08] bg-black/[0.24] px-3.5 text-sm text-foreground outline-none transition focus:border-white/[0.16]"
                defaultValue={reconciliationDateRange.startDate}
                name="startDate"
                type="date"
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-[0.62rem] uppercase tracking-[0.2em] text-muted-foreground">
                End date
              </span>
              <input
                className="h-11 w-full rounded-[0.95rem] border border-white/[0.08] bg-black/[0.24] px-3.5 text-sm text-foreground outline-none transition focus:border-white/[0.16]"
                defaultValue={reconciliationDateRange.endDate}
                name="endDate"
                type="date"
              />
            </label>

            <div className="flex items-end">
              <button
                className="inline-flex min-h-11 w-full items-center justify-center rounded-[0.95rem] border border-[#90FF4D]/20 bg-[#90FF4D]/90 px-4 text-sm font-medium text-black transition hover:bg-[#A4FF68]"
                type="submit"
              >
                Refresh
              </button>
            </div>
          </form>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-7">
          <article className="rounded-[1.15rem] border border-white/[0.08] bg-black/[0.22] p-4">
            <p className="text-[0.62rem] uppercase tracking-[0.2em] text-muted-foreground">
              Paid video rows
            </p>
            <p className="mt-2 text-xl font-medium text-foreground">
              {formatCampaignMetric(reconciliation.totals.videos)}
            </p>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">
              TikTok paid ad/post/campaign rows in this date window
            </p>
          </article>
          <article className="rounded-[1.15rem] border border-white/[0.08] bg-black/[0.22] p-4">
            <p className="text-[0.62rem] uppercase tracking-[0.2em] text-muted-foreground">
              TikTok impressions
            </p>
            <p className="mt-2 text-xl font-medium text-foreground">
              {formatCampaignMetric(reconciliation.totals.tiktokImpressions)}
            </p>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">
              Ads Manager impressions matched to those paid videos
            </p>
          </article>
          <article className="rounded-[1.15rem] border border-white/[0.08] bg-black/[0.22] p-4">
            <p className="text-[0.62rem] uppercase tracking-[0.2em] text-muted-foreground">
              TikTok cost
            </p>
            <p className="mt-2 text-xl font-medium text-foreground">
              {formatCampaignCurrency(reconciliation.totals.tiktokSpend)}
            </p>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">
              Spend reported by TikTok Ads Manager in this window
            </p>
          </article>
          <article className="rounded-[1.15rem] border border-white/[0.08] bg-black/[0.22] p-4">
            <p className="text-[0.62rem] uppercase tracking-[0.2em] text-muted-foreground">
              TikTok results
            </p>
            <p className="mt-2 text-xl font-medium text-foreground">
              {formatCampaignMetric(reconciliation.totals.tiktokConversions)}
            </p>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">
              Ads Manager conversion result count for the selected event
            </p>
          </article>
          <article className="rounded-[1.15rem] border border-white/[0.08] bg-black/[0.22] p-4">
            <p className="text-[0.62rem] uppercase tracking-[0.2em] text-muted-foreground">
              ROAS
            </p>
            <p className="mt-2 text-xl font-medium text-foreground">
              {formatCampaignRoas(totalRoas)}
            </p>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">
              {formatCampaignCurrency(reconciliation.totals.attributedRevenue)}{" "}
              {reconciliation.singularCohortPeriod
                ? `Singular ${reconciliation.singularCohortPeriod} revenue / TikTok cost`
                : "Singular revenue / TikTok cost"}
            </p>
          </article>
          <article className="rounded-[1.15rem] border border-white/[0.08] bg-black/[0.22] p-4">
            <p className="text-[0.62rem] uppercase tracking-[0.2em] text-muted-foreground">
              Matched local videos
            </p>
            <p className="mt-2 text-xl font-medium text-foreground">
              {formatCampaignMetric(reconciliation.totals.matchedVideos)}
            </p>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">
              Paid posts that matched a local/viral.app video record
            </p>
          </article>
          <article className="rounded-[1.15rem] border border-white/[0.08] bg-black/[0.22] p-4">
            <p className="text-[0.62rem] uppercase tracking-[0.2em] text-muted-foreground">
              TikTok campaigns
            </p>
            <p className="mt-2 text-xl font-medium text-foreground">
              {formatCampaignMetric(reconciliation.totals.tiktokCampaigns)}
            </p>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">
              Campaign labels returned or resolved from TikTok
            </p>
          </article>
        </div>

        {reconciliation.campaignTotals.length > 0 ? (
          <div className="mt-5 grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
            {reconciliation.campaignTotals.map((campaignTotal) => {
              const costPerResult = getCampaignRatio(
                campaignTotal.spend,
                campaignTotal.conversions,
              );
              const roas = getCampaignRatio(
                campaignTotal.revenue,
                campaignTotal.spend,
              );

              return (
                <article
                  className="rounded-[1.15rem] border border-white/[0.08] bg-black/[0.18] p-4"
                  key={campaignTotal.key}
                >
                  <p className="text-[0.62rem] uppercase tracking-[0.2em] text-muted-foreground">
                    TikTok campaign total
                  </p>
                  <h3 className="mt-2 truncate text-sm font-medium text-foreground">
                    {campaignTotal.tiktokCampaignName ??
                      (campaignTotal.tiktokCampaignId
                        ? `TikTok campaign ${campaignTotal.tiktokCampaignId}`
                        : "Unknown TikTok campaign")}
                  </h3>
                  <p className="mt-2 text-lg font-medium text-foreground">
                    {formatCampaignMetric(campaignTotal.impressions)} impressions
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {formatCampaignCurrency(campaignTotal.spend)} cost /{" "}
                    {formatCampaignMetric(campaignTotal.conversions)} results
                    {costPerResult !== null
                      ? ` / ${formatCampaignCurrency(costPerResult)} CPA`
                      : ""}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {formatCampaignCurrency(campaignTotal.revenue)} revenue /{" "}
                    {formatCampaignRoas(roas)} ROAS
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {formatCampaignMetric(campaignTotal.videos)} paid row
                    {campaignTotal.videos === 1 ? "" : "s"}
                    {campaignTotal.tiktokCampaignId
                      ? ` / ID ${campaignTotal.tiktokCampaignId}`
                      : ""}
                  </p>
                </article>
              );
            })}
          </div>
        ) : null}

        {reconciliation.warnings.length > 0 ? (
          <div className="mt-5 rounded-[1.15rem] border border-[#FFD24D]/20 bg-[#FFD24D]/[0.08] p-4 text-sm text-[#FFEAB1]">
            <p className="text-[0.62rem] uppercase tracking-[0.2em] text-[#FFEAB1]/80">
              Reconciliation notes
            </p>
            <ul className="mt-2 space-y-1.5">
              {reconciliation.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
            {!reconciliation.advertiserId ? (
              <Link
                className="mt-3 inline-flex text-sm font-medium text-[#FFEAB1] underline underline-offset-4"
                href={`/org/${organizationSlug}/integrations`}
              >
                Manage TikTok connection
              </Link>
            ) : null}
          </div>
        ) : null}

        {canImportPreviewUrls && reconciliation.advertiserId ? (
          <form
            action={importTikTokPreviewUrlsAction}
            className="mt-5 flex flex-col gap-3 rounded-[1.15rem] border border-white/[0.08] bg-black/[0.18] p-4 lg:flex-row lg:items-end lg:justify-between"
            encType="multipart/form-data"
          >
            <label className="block min-w-0 flex-1">
              <span className="mb-2 block text-[0.62rem] uppercase tracking-[0.2em] text-muted-foreground">
                TikTok preview URL CSV
              </span>
              <input
                accept=".csv,text/csv"
                className="h-11 w-full rounded-[0.95rem] border border-white/[0.08] bg-black/[0.24] px-3.5 py-2 text-sm text-foreground file:mr-3 file:rounded-full file:border-0 file:bg-white/[0.08] file:px-3 file:py-1.5 file:text-xs file:text-foreground"
                name="previewFile"
                type="file"
              />
            </label>
            <button
              className="inline-flex min-h-11 items-center justify-center rounded-[0.95rem] border border-white/[0.1] bg-white/[0.06] px-4 text-sm font-medium text-foreground transition hover:bg-white/[0.1]"
              type="submit"
            >
              Import previews
            </button>
          </form>
        ) : null}

        <div className="mt-5 overflow-hidden rounded-[1.15rem] border border-white/[0.08] bg-black/[0.16]">
          {reconciliation.rows.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="min-w-[1780px] w-full border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-white/[0.08] text-[0.62rem] uppercase tracking-[0.2em] text-muted-foreground">
                    <th className="px-4 py-3 font-medium">Paid video</th>
                    <th className="px-4 py-3 font-medium">Ads Manager path</th>
                    <th className="px-4 py-3 text-right font-medium">TikTok impressions</th>
                    <th className="px-4 py-3 text-right font-medium">Cost</th>
                    <th className="px-4 py-3 text-right font-medium">Clicks / CTR</th>
                    <th className="px-4 py-3 text-right font-medium">Results / CPA</th>
                    <th className="px-4 py-3 text-right font-medium">Revenue / ROAS</th>
                    <th className="px-4 py-3 font-medium">Local match</th>
                    <th className="px-4 py-3 text-right font-medium">App views</th>
                    <th className="px-4 py-3 font-medium">Evidence</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.06]">
                  {reconciliation.rows.map((row) => {
                    const handleLabel = getHandleLabel(row.accountHandle);
                    const matchedAdPreview = row.matchedAdIds.slice(0, 2).join(", ");
                    const extraAdCount = Math.max(row.matchedAdIds.length - 2, 0);
                    const videoHref = row.videoUrl;
                    const videoLinkSourceLabel = getVideoLinkSourceLabel(
                      row.videoUrlSource,
                    );
                    const ctr = getCampaignRatio(
                      row.tiktokClicks,
                      row.tiktokImpressions,
                    );
                    const cpm =
                      row.tiktokImpressions > 0
                        ? (row.tiktokSpend / row.tiktokImpressions) * 1000
                        : null;
                    const costPerResult = getCampaignRatio(
                      row.tiktokSpend,
                      row.tiktokConversions,
                    );
                    const resultRate = getCampaignRatio(
                      row.tiktokConversions,
                      row.tiktokImpressions,
                    );
                    const roas = getCampaignRatio(
                      row.attributedRevenue,
                      row.tiktokSpend,
                    );
                    const adsManagerPathSegments = getAdsManagerPathSegments(row);

                    return (
                      <tr key={row.rowKey} className="align-top">
                        <td className="px-4 py-4">
                          <div className="flex min-w-0 items-start gap-3">
                            {videoHref ? (
                              <a
                                aria-label="Open TikTok video"
                                className="h-14 w-14 shrink-0 rounded-[0.9rem] border border-white/[0.08] bg-white/[0.05]"
                                href={videoHref}
                                rel="noreferrer"
                                style={
                                  row.thumbnailUrl
                                    ? getBackgroundImageStyle(row.thumbnailUrl)
                                    : undefined
                                }
                                target="_blank"
                              />
                            ) : (
                              <div className="h-14 w-14 shrink-0 rounded-[0.9rem] border border-white/[0.08] bg-white/[0.05]" />
                            )}
                            <div className="min-w-0">
                              {videoHref ? (
                                <a
                                  className="line-clamp-2 font-medium leading-5 text-foreground transition hover:text-[#90FF4D]"
                                  href={videoHref}
                                  rel="noreferrer"
                                  target="_blank"
                                >
                                  {getVideoTitle(row)}
                                </a>
                              ) : (
                                <p className="line-clamp-2 font-medium leading-5 text-foreground">
                                  {getVideoTitle(row)}
                                </p>
                              )}
                              <p className="mt-1 text-xs text-muted-foreground">
                                {row.creatorName ?? "No local video match"}
                                {handleLabel ? ` / ${handleLabel}` : ""}
                              </p>
                              <p className="mt-1 text-xs text-muted-foreground">
                                {row.sourceVideoId
                                  ? `Post ID ${row.sourceVideoId}`
                                  : "TikTok post ID unavailable"}
                                {row.publishedAt
                                  ? ` / Published ${formatCampaignDateLabel(row.publishedAt)}`
                                  : ""}
                                {videoLinkSourceLabel
                                  ? ` / ${videoLinkSourceLabel}`
                                  : ""}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-4">
                          <div className="min-w-[28rem] max-w-[34rem] rounded-[0.95rem] border border-white/[0.08] bg-black/[0.18] p-3">
                            <div className="space-y-2 font-mono text-xs leading-5">
                              {adsManagerPathSegments.map((segment, index) => (
                                <div
                                  className={
                                    index === 0
                                      ? ""
                                      : index === 1
                                        ? "pl-4"
                                        : "pl-8"
                                  }
                                  key={segment.label}
                                >
                                  <p className="flex min-w-0 gap-2">
                                    <span className="shrink-0 text-muted-foreground">
                                      {segment.label}/
                                    </span>
                                    <span
                                      className="truncate font-sans font-medium text-foreground"
                                      title={segment.name}
                                    >
                                      {segment.name}
                                    </span>
                                  </p>
                                  {segment.id ? (
                                    <p className="mt-0.5 text-[0.68rem] text-muted-foreground">
                                      ID {segment.id}
                                    </p>
                                  ) : null}
                                </div>
                              ))}
                            </div>
                          </div>
                          {row.tiktokAdsManagerUrl ? (
                            <a
                              className="mt-1 inline-flex text-xs font-medium text-[#D7FFBD] underline underline-offset-4"
                              href={row.tiktokAdsManagerUrl}
                              rel="noreferrer"
                              target="_blank"
                            >
                              Manage ad
                            </a>
                          ) : null}
                        </td>
                        <td className="px-4 py-4 text-right">
                          <p className="font-medium text-foreground">
                            {formatCampaignMetric(row.tiktokImpressions)}
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {formatCampaignCompactMetric(row.tiktokImpressions)}
                          </p>
                        </td>
                        <td className="px-4 py-4 text-right">
                          <p className="font-medium text-foreground">
                            {formatCampaignCurrency(row.tiktokSpend)}
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {formatCampaignCurrency(cpm)} CPM
                          </p>
                        </td>
                        <td className="px-4 py-4 text-right">
                          <p className="font-medium text-foreground">
                            {formatCampaignMetric(row.tiktokClicks)}
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {formatCampaignPercent(ctr)} CTR
                          </p>
                        </td>
                        <td className="px-4 py-4 text-right">
                          <p className="font-medium text-foreground">
                            {formatCampaignMetric(row.tiktokConversions)}
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {formatCampaignCurrency(costPerResult)} CPA
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {formatCampaignPercent(resultRate)} result rate
                          </p>
                        </td>
                        <td className="px-4 py-4 text-right">
                          <p className="font-medium text-foreground">
                            {formatCampaignCurrency(row.attributedRevenue)}
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {formatCampaignRoas(roas)} ROAS
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {formatCampaignMetric(row.singularMatchedRowCount)}{" "}
                            Singular row
                            {row.singularMatchedRowCount === 1 ? "" : "s"}
                          </p>
                        </td>
                        <td className="px-4 py-4">
                          <span
                            className={`inline-flex max-w-[14rem] rounded-full border px-3 py-1 text-xs ${
                              row.hasLocalVideoMatch
                                ? "border-white/[0.08] bg-white/[0.05] text-foreground"
                                : "border-[#FFD24D]/20 bg-[#FFD24D]/[0.08] text-[#FFEAB1]"
                            }`}
                          >
                            <span className="truncate">
                              {row.hasLocalVideoMatch
                                ? (row.localCampaignName ?? "Unassigned")
                                : "No local/viral.app match"}
                            </span>
                          </span>
                        </td>
                        <td className="px-4 py-4 text-right">
                          <p className="font-medium text-foreground">
                            {formatCampaignMetric(row.localViews)}
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            lifetime
                          </p>
                        </td>
                        <td className="px-4 py-4">
                          <p className="text-xs leading-5 text-muted-foreground">
                            {formatEvidenceLabel(row)}
                          </p>
                          {matchedAdPreview ? (
                            <p className="mt-1 text-xs leading-5 text-muted-foreground">
                              Ads {matchedAdPreview}
                              {extraAdCount > 0
                                ? ` +${formatCampaignMetric(extraAdCount)}`
                                : ""}
                            </p>
                          ) : null}
                          {row.matchSources.length > 0 ? (
                            <p className="mt-1 text-xs leading-5 text-muted-foreground">
                              {row.matchSources.map(formatMatchSource).join(", ")}
                            </p>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="px-4 py-8 text-sm leading-6 text-muted-foreground">
              TikTok returned no paid video rows for the selected date range.
            </div>
          )}
        </div>
      </section>

      <section className="rounded-[1.7rem] border border-white/[0.08] bg-white/[0.03] p-6 shadow-[0_22px_70px_rgba(0,0,0,0.2)]">
        <p className="text-[0.62rem] uppercase tracking-[0.24em] text-muted-foreground">
          Create campaign
        </p>
        <h2 className="mt-3 text-2xl font-medium tracking-[-0.04em] text-foreground">
          Campaigns start at the org level.
        </h2>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
          Organization admins and owners can create campaigns. After that, invite
          managers and members inside the campaign itself.
        </p>

        {canCreateCampaign ? (
          <form action={createCampaignAction} className="mt-6 max-w-xl space-y-4">
            <label className="block">
              <span className="mb-2 block text-[0.62rem] uppercase tracking-[0.22em] text-muted-foreground">
                Campaign name
              </span>
              <input
                className="w-full rounded-[1rem] border border-white/[0.08] bg-black/[0.22] px-4 py-3 text-sm text-foreground outline-none transition placeholder:text-muted-foreground/62 focus:border-white/[0.14]"
                name="name"
                placeholder="Spring Creator Sprint"
                required
                type="text"
              />
            </label>

            <button
              className="inline-flex items-center justify-center rounded-full border border-[#90FF4D]/24 bg-[#90FF4D]/90 px-5 py-3 text-sm font-medium text-black transition hover:bg-[#A4FF68]"
              type="submit"
            >
              Create campaign
            </button>
          </form>
        ) : (
          <div className="mt-6 rounded-[1.15rem] border border-white/[0.08] bg-black/[0.2] px-4 py-4 text-sm text-muted-foreground">
            Only organization admins and owners can create campaigns. Campaign
            managers get access after they are invited into a specific campaign.
          </div>
        )}
      </section>

      <section className="space-y-4">
        {workspace.campaigns.length > 0 ? (
          visibleCampaigns.length > 0 ? (
            <>
              {visibleCampaigns.length > 1 ? (
                <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
                  {visibleCampaigns.map((campaign) => {
                    const isActive = campaign.id === activeCampaignSummary?.id;
                    const campaignTone = getCampaignColorTone(campaign.id);

                    return (
                      <article
                        key={campaign.id}
                        className="relative overflow-hidden rounded-[1.5rem] border p-5 shadow-[0_22px_70px_rgba(0,0,0,0.2)] transition"
                        style={{
                          backgroundImage: `${isActive ? campaignTone.backgroundStrong : campaignTone.background}, linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.02))`,
                          borderColor: isActive ? campaignTone.border : "rgba(255,255,255,0.08)",
                        }}
                      >
                        <div
                          aria-hidden="true"
                          className="pointer-events-none absolute inset-x-5 top-0 h-px"
                          style={{ background: campaignTone.gradient }}
                        />
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex items-start gap-3">
                            <CampaignSwatch
                              campaignId={campaign.id}
                              className="h-11 w-11 rounded-[1rem]"
                              label={campaign.name}
                            />
                            <div className="min-w-0">
                              <p className="text-[0.62rem] uppercase tracking-[0.22em] text-muted-foreground">
                                {isActive ? "Open now" : "Campaign"}
                              </p>
                              <h2 className="mt-3 truncate text-xl font-medium tracking-[-0.03em] text-foreground">
                                {campaign.name}
                              </h2>
                            </div>
                          </div>
                          {isActive ? (
                            <span
                              className="rounded-full border px-2.5 py-1 text-[0.58rem] uppercase tracking-[0.2em]"
                              style={{
                                background: campaignTone.background,
                                borderColor: campaignTone.border,
                                color: campaignTone.text,
                              }}
                            >
                              Selected
                            </span>
                          ) : null}
                        </div>

                        <div className="mt-4 flex flex-wrap gap-2 text-[0.58rem] uppercase tracking-[0.18em] text-muted-foreground">
                          <span className="rounded-full border border-white/[0.08] bg-black/[0.22] px-2.5 py-1">
                            {campaign._count.memberships} members
                          </span>
                          <span className="rounded-full border border-white/[0.08] bg-black/[0.22] px-2.5 py-1">
                            {campaign._count.creators} creators
                          </span>
                          <span className="rounded-full border border-white/[0.08] bg-black/[0.22] px-2.5 py-1">
                            {campaign._count.videos} videos
                          </span>
                        </div>

                        <p className="mt-4 text-sm text-muted-foreground">
                          Owner:{" "}
                          <span className="text-foreground/86">
                            {campaign.owner?.email ??
                              campaign.owner?.name ??
                              "Unassigned"}
                          </span>
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Updated {formatCampaignDateLabel(campaign.updatedAt)}
                        </p>

                        <Link
                          className={`mt-5 inline-flex items-center justify-center rounded-full px-4 py-2.5 text-sm font-medium transition ${
                            isActive
                              ? "border border-white/[0.08] bg-white/[0.04] text-foreground"
                              : "border border-[#90FF4D]/24 bg-[#90FF4D]/90 text-black hover:bg-[#A4FF68]"
                          }`}
                          href={createCampaignHref({
                            organizationSlug,
                            searchParams: resolvedSearchParams,
                            campaignId: campaign.id,
                          })}
                          prefetch={false}
                        >
                          {isActive ? "Viewing details" : "Open details"}
                        </Link>
                      </article>
                    );
                  })}
                </div>
              ) : null}

              {activeCampaignSummary ? (
                <Suspense
                  key={activeCampaignSummary.id}
                  fallback={
                    <CampaignDetailPanelSkeleton
                      activeCampaignSummary={activeCampaignSummary}
                    />
                  }
                >
                  <CampaignDetailPanel
                    activeCampaignOwnerUserId={activeCampaignSummary.owner?.id}
                    activeCampaignSummary={activeCampaignSummary}
                    activeDeleteAvailabilityMessage={activeDeleteAvailabilityMessage}
                    activeInviteRoleOptions={activeInviteRoleOptions}
                    canDeleteActiveCampaign={canDeleteActiveCampaign}
                    canManageActiveCampaign={canManageActiveCampaign}
                    canPermanentlyDeleteActiveCampaign={
                      canPermanentlyDeleteActiveCampaign
                    }
                    deleteCampaignAction={deleteCampaignAction}
                    inviteCampaignMemberAction={inviteCampaignMemberAction}
                    organizationSlug={organizationSlug}
                    removeCampaignMemberAction={removeCampaignMemberAction}
                    revokeCampaignInvitationAction={revokeCampaignInvitationAction}
                    updateCampaignAction={updateCampaignAction}
                    updateCampaignMemberRoleAction={updateCampaignMemberRoleAction}
                    viewerUserId={workspace.membership.userId}
                  />
                </Suspense>
              ) : (
                <article className="rounded-[1.7rem] border border-dashed border-white/[0.08] bg-white/[0.03] px-6 py-10 text-sm text-muted-foreground">
                  The selected campaign could not be loaded. Pick another campaign
                  from the list above.
                </article>
              )}
            </>
          ) : (
            <article className="rounded-[1.7rem] border border-dashed border-white/[0.08] bg-white/[0.03] px-6 py-10 text-sm text-muted-foreground">
              No campaigns matched the current filter. Clear the campaign filter to
              see everything again.
            </article>
          )
        ) : (
          <article className="rounded-[1.7rem] border border-dashed border-white/[0.08] bg-white/[0.03] px-6 py-10 text-sm text-muted-foreground">
            No campaigns are available yet. Create one above, then add members,
            creators, and videos directly into it.
          </article>
        )}
      </section>
    </div>
  );
}
