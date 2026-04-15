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
  inviteCampaignMember,
  removeCampaignMember,
  revokeCampaignInvitation,
  updateCampaignForOrganization,
  updateCampaignMemberRole,
} from "@/server/campaigns/mutations";
import { getCampaignWorkspace } from "@/server/campaigns/queries";

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
