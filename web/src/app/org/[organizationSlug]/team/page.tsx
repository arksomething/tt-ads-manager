import Link from "next/link";
import { CampaignRole, OrganizationRole } from "@/lib/prisma-shim";
import { redirect } from "next/navigation";

import { CampaignBadge } from "@/components/org-dashboard/campaign-badge";
import { OrganizationInviteMemberForm } from "@/components/org-dashboard/organization-invite-member-form";
import {
  canManageOrganizationRole,
  getManageableOrganizationRoles,
} from "@/server/auth/roles";
import { getAccessibleCampaignOptionsForMembership } from "@/server/campaigns/queries";
import { type DashboardSearchParams } from "@/server/dashboard/filters";
import {
  inviteOrganizationMember,
  removeOrganizationMember,
  revokeOrganizationInvitation,
  updateOrganizationMemberRole,
} from "@/server/organizations/mutations";
import {
  getOrganizationMemberAccessRows,
  getOrganizationPendingInvitations,
  getOrganizationSettingsSummary,
} from "@/server/organizations/queries";

export const dynamic = "force-dynamic";

type TeamPageProps = {
  params: Promise<{
    organizationSlug: string;
  }>;
  searchParams: Promise<DashboardSearchParams>;
};

type PendingOrganizationInvitation = Awaited<
  ReturnType<typeof getOrganizationPendingInvitations>
>[number];

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
    case "member-invited":
      return "Organization invite sent";
    case "member-role-updated":
      return "Organization role updated";
    case "member-removed":
      return "Organization member removed";
    case "member-invite-revoked":
      return "Organization invite revoked";
    default:
      return undefined;
  }
}

function formatRoleLabel(value: string) {
  return value
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatCountLabel(
  count: number,
  singular: string,
  plural = `${singular}s`,
) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function formatInviteSentAtLabel(value: Date) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(value);
}

function getOrganizationRoleBadgeClass(role: OrganizationRole) {
  switch (role) {
    case OrganizationRole.OWNER:
      return "border-white/[0.12] bg-white/[0.08] text-foreground";
    case OrganizationRole.ADMIN:
      return "border-[#90FF4D]/25 bg-[#90FF4D]/10 text-[#B8FF86]";
    case OrganizationRole.MEMBER:
    default:
      return "border-white/[0.08] bg-black/[0.22] text-muted-foreground";
  }
}

function getCampaignRoleBadgeClass(role: CampaignRole) {
  switch (role) {
    case CampaignRole.OWNER:
      return "border-white/[0.12] bg-white/[0.08] text-foreground";
    case CampaignRole.MANAGER:
      return "border-[#90FF4D]/25 bg-[#90FF4D]/10 text-[#B8FF86]";
    case CampaignRole.MEMBER:
    default:
      return "border-white/[0.08] bg-white/[0.04] text-muted-foreground";
  }
}

export default async function OrganizationTeamPage({
  params,
  searchParams,
}: TeamPageProps) {
  const { organizationSlug } = await params;
  const resolvedSearchParams = await searchParams;
  const workspace = await getOrganizationSettingsSummary(organizationSlug);
  const notice = getNoticeLabel(getSearchParamValue(resolvedSearchParams, "notice"));
  const error = getErrorLabel(getSearchParamValue(resolvedSearchParams, "error"));
  const inviteRoleOptions =
    workspace.membership.role === OrganizationRole.OWNER
      ? [
          OrganizationRole.OWNER,
          OrganizationRole.ADMIN,
          OrganizationRole.MEMBER,
        ]
      : [OrganizationRole.ADMIN, OrganizationRole.MEMBER];
  const memberRows = workspace.canManageMembers
    ? await getOrganizationMemberAccessRows(organizationSlug)
    : [];
  const pendingInvitations = workspace.canManageMembers
    ? await getOrganizationPendingInvitations(organizationSlug)
    : [];
  const campaignOptions = workspace.canManageMembers
    ? await getAccessibleCampaignOptionsForMembership(workspace.membership)
    : [];

  async function inviteMemberAction(formData: FormData) {
    "use server";

    try {
      await inviteOrganizationMember({
        organizationSlug,
        input: {
          email: formData.get("email"),
          role: formData.get("role"),
          campaignAccessScope: formData.get("campaignAccessScope"),
          campaignIds: formData.getAll("campaignIds"),
        },
      });

      redirect(`/org/${organizationSlug}/team?notice=member-invited`);
    } catch (inviteError) {
      redirect(
        `/org/${organizationSlug}/team?error=${encodeURIComponent(
          getActionErrorMessage(inviteError),
        )}`,
      );
    }
  }

  async function updateMemberRoleAction(formData: FormData) {
    "use server";

    try {
      await updateOrganizationMemberRole({
        organizationSlug,
        input: {
          membershipId: formData.get("membershipId"),
          role: formData.get("role"),
        },
      });

      redirect(`/org/${organizationSlug}/team?notice=member-role-updated`);
    } catch (updateError) {
      redirect(
        `/org/${organizationSlug}/team?error=${encodeURIComponent(
          getActionErrorMessage(updateError),
        )}`,
      );
    }
  }

  async function removeMemberAction(formData: FormData) {
    "use server";

    try {
      await removeOrganizationMember({
        organizationSlug,
        input: {
          membershipId: formData.get("membershipId"),
        },
      });

      redirect(`/org/${organizationSlug}/team?notice=member-removed`);
    } catch (removeError) {
      redirect(
        `/org/${organizationSlug}/team?error=${encodeURIComponent(
          getActionErrorMessage(removeError),
        )}`,
      );
    }
  }

  async function revokeInvitationAction(formData: FormData) {
    "use server";

    try {
      await revokeOrganizationInvitation({
        organizationSlug,
        input: {
          invitationId: formData.get("invitationId"),
        },
      });

      redirect(`/org/${organizationSlug}/team?notice=member-invite-revoked`);
    } catch (revokeError) {
      redirect(
        `/org/${organizationSlug}/team?error=${encodeURIComponent(
          getActionErrorMessage(revokeError),
        )}`,
      );
    }
  }

  return (
    <div className="space-y-6">
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

      <section className="rounded-[1.7rem] border border-white/[0.08] bg-white/[0.03] p-6 shadow-[0_22px_70px_rgba(0,0,0,0.2)]">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-[0.62rem] uppercase tracking-[0.24em] text-muted-foreground">
              Team access
            </p>
            <h1 className="mt-3 text-2xl font-medium tracking-[-0.04em] text-foreground">
              Who has access to what.
            </h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground">
              Review {workspace.membership.organization.name} in one table. Each
              row shows the member, their organization role, and which campaigns
              they can access.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className="rounded-full border border-white/[0.08] bg-black/[0.18] px-3 py-1.5 text-[0.68rem] uppercase tracking-[0.18em] text-muted-foreground">
              {formatCountLabel(workspace.memberCount, "member")}
            </span>
            <span className="rounded-full border border-white/[0.08] bg-black/[0.18] px-3 py-1.5 text-[0.68rem] uppercase tracking-[0.18em] text-muted-foreground">
              {formatCountLabel(workspace.invitationCount, "pending invite")}
            </span>
            <span className="rounded-full border border-white/[0.08] bg-black/[0.18] px-3 py-1.5 text-[0.68rem] uppercase tracking-[0.18em] text-muted-foreground">
              {formatCountLabel(workspace.organizationCampaignCount, "campaign")}
            </span>
            <span className="rounded-full border border-[#90FF4D]/25 bg-[#90FF4D]/10 px-3 py-1.5 text-[0.68rem] uppercase tracking-[0.18em] text-[#B8FF86]">
              You are {formatRoleLabel(workspace.membership.role)}
            </span>
          </div>
        </div>
      </section>

      {workspace.canManageMembers ? (
        <>
          <section className="overflow-hidden rounded-[1.7rem] border border-white/[0.08] bg-white/[0.03] shadow-[0_22px_70px_rgba(0,0,0,0.2)]">
            <div className="border-b border-white/[0.08] px-6 py-4">
              <p className="text-[0.62rem] uppercase tracking-[0.24em] text-muted-foreground">
                Members
              </p>
              <h2 className="mt-2 text-xl font-medium tracking-[-0.04em] text-foreground">
                Organization access table.
              </h2>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-[920px] w-full border-collapse">
                <thead className="bg-black/[0.22] text-left text-[0.62rem] uppercase tracking-[0.22em] text-muted-foreground">
                  <tr>
                    <th className="px-6 py-3 font-medium">Member</th>
                    <th className="px-6 py-3 font-medium">Org role</th>
                    <th className="px-6 py-3 font-medium">Campaign access</th>
                    <th className="px-6 py-3 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.08]">
                  {memberRows.map((member) => {
                    const manageableRoles = getManageableOrganizationRoles(
                      workspace.membership.role,
                      member.role,
                    );
                    const canManageMember =
                      manageableRoles.length > 0 &&
                      member.userId !== workspace.membership.userId;

                    return (
                      <tr
                        key={member.id}
                        className="align-top transition hover:bg-white/[0.02]"
                      >
                        <td className="px-6 py-4">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-foreground">
                              {member.name ?? member.email ?? "Organization member"}
                            </p>
                            <p className="mt-1 truncate text-sm text-muted-foreground">
                              {member.email ?? "No email available"}
                            </p>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <span
                            className={`inline-flex rounded-full border px-3 py-1.5 text-[0.68rem] font-medium uppercase tracking-[0.18em] ${getOrganizationRoleBadgeClass(
                              member.role,
                            )}`}
                          >
                            {formatRoleLabel(member.role)}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          {member.hasOrgWideCampaignAccess ? (
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="inline-flex rounded-full border border-[#90FF4D]/25 bg-[#90FF4D]/10 px-3 py-1.5 text-[0.68rem] font-medium uppercase tracking-[0.18em] text-[#B8FF86]">
                                All campaigns
                              </span>
                              <span className="text-sm text-muted-foreground">
                                {formatCountLabel(
                                  workspace.organizationCampaignCount,
                                  "campaign",
                                )}
                              </span>
                            </div>
                          ) : member.campaignAccess.length > 0 ? (
                            <div className="flex max-w-2xl flex-wrap gap-2">
                              {member.campaignAccess.map((campaignAccess) => (
                                <div
                                  key={`${member.id}-${campaignAccess.id}`}
                                  className="flex max-w-full items-center gap-2"
                                >
                                  <CampaignBadge
                                    campaignId={campaignAccess.id}
                                    compact
                                    label={campaignAccess.name}
                                  />
                                  <span
                                    className={`inline-flex rounded-full border px-2 py-0.5 text-[0.56rem] font-medium uppercase tracking-[0.16em] ${getCampaignRoleBadgeClass(
                                      campaignAccess.role,
                                    )}`}
                                  >
                                    {formatRoleLabel(campaignAccess.role)}
                                  </span>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <span className="text-sm text-muted-foreground">
                              No campaign access
                            </span>
                          )}
                        </td>
                        <td className="px-6 py-4">
                          {canManageMember ? (
                            <div className="flex min-w-[17rem] flex-col gap-2">
                              <form
                                action={updateMemberRoleAction}
                                className="flex flex-wrap items-center gap-2"
                              >
                                <input
                                  name="membershipId"
                                  type="hidden"
                                  value={member.id}
                                />
                                <select
                                  className="rounded-full border border-white/[0.08] bg-black/[0.24] px-3.5 py-2 text-[0.68rem] font-medium uppercase tracking-[0.18em] text-foreground outline-none transition focus:border-white/[0.14]"
                                  defaultValue={member.role}
                                  name="role"
                                >
                                  {manageableRoles.map((role) => (
                                    <option key={role} value={role}>
                                      {formatRoleLabel(role)}
                                    </option>
                                  ))}
                                </select>
                                <button
                                  className="rounded-full border border-[#90FF4D]/24 bg-[#90FF4D]/90 px-4 py-2 text-[0.68rem] font-medium uppercase tracking-[0.18em] text-black transition hover:bg-[#A4FF68]"
                                  type="submit"
                                >
                                  Save
                                </button>
                              </form>
                              <form action={removeMemberAction}>
                                <input
                                  name="membershipId"
                                  type="hidden"
                                  value={member.id}
                                />
                                <button
                                  className="rounded-full border border-[#FF7E54]/22 bg-[#FF7E54]/10 px-4 py-2 text-[0.68rem] font-medium uppercase tracking-[0.18em] text-[#FFD5C8] transition hover:bg-[#FF7E54]/16"
                                  type="submit"
                                >
                                  Remove
                                </button>
                              </form>
                            </div>
                          ) : (
                            <span className="inline-flex rounded-full border border-white/[0.08] bg-white/[0.04] px-3 py-1.5 text-[0.68rem] uppercase tracking-[0.18em] text-muted-foreground">
                              {member.userId === workspace.membership.userId
                                ? "You"
                                : member.role === OrganizationRole.OWNER
                                  ? "Protected"
                                  : "No actions"}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <section className="overflow-hidden rounded-[1.7rem] border border-white/[0.08] bg-white/[0.03] shadow-[0_22px_70px_rgba(0,0,0,0.2)]">
            <div className="flex flex-col gap-4 border-b border-white/[0.08] px-6 py-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-[0.62rem] uppercase tracking-[0.24em] text-muted-foreground">
                  Pending invites
                </p>
                <h2 className="mt-2 text-xl font-medium tracking-[-0.04em] text-foreground">
                  Waiting for invite acceptance.
                </h2>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                  Invites remain here until that email signs in and accepts access.
                </p>
              </div>
              <span className="inline-flex rounded-full border border-white/[0.08] bg-black/[0.22] px-3 py-1.5 text-[0.68rem] uppercase tracking-[0.18em] text-muted-foreground">
                {formatCountLabel(pendingInvitations.length, "pending invite")}
              </span>
            </div>

            {pendingInvitations.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="min-w-[980px] w-full border-collapse">
                  <thead className="bg-black/[0.22] text-left text-[0.62rem] uppercase tracking-[0.22em] text-muted-foreground">
                    <tr>
                      <th className="px-6 py-3 font-medium">Invitee</th>
                      <th className="px-6 py-3 font-medium">Org role</th>
                      <th className="px-6 py-3 font-medium">Campaign access</th>
                      <th className="px-6 py-3 font-medium">Sent</th>
                      <th className="px-6 py-3 font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.08]">
                    {pendingInvitations.map((invitation) => {
                      const canRevokeInvitation = canManageOrganizationRole(
                        workspace.membership.role,
                        invitation.role,
                      );

                      return (
                        <tr
                          key={invitation.id}
                          className="align-top transition hover:bg-white/[0.02]"
                        >
                          <td className="px-6 py-4">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium text-foreground">
                                {invitation.email}
                              </p>
                              <p className="mt-1 truncate text-xs text-muted-foreground">
                                Invited by{" "}
                                {invitation.invitedBy?.email ??
                                  invitation.invitedBy?.name ??
                                  "an organization admin"}
                              </p>
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            <span
                              className={`inline-flex rounded-full border px-3 py-1.5 text-[0.68rem] font-medium uppercase tracking-[0.18em] ${getOrganizationRoleBadgeClass(
                                invitation.role,
                              )}`}
                            >
                              {formatRoleLabel(invitation.role)}
                            </span>
                          </td>
                          <td className="px-6 py-4">
                            {invitation.role === OrganizationRole.OWNER ||
                            invitation.role === OrganizationRole.ADMIN ? (
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="inline-flex rounded-full border border-[#90FF4D]/25 bg-[#90FF4D]/10 px-3 py-1.5 text-[0.68rem] font-medium uppercase tracking-[0.18em] text-[#B8FF86]">
                                  All campaigns
                                </span>
                                <span className="text-sm text-muted-foreground">
                                  Included with {formatRoleLabel(invitation.role)}
                                </span>
                              </div>
                            ) : workspace.organizationCampaignCount > 0 &&
                              invitation.campaignAccess.length ===
                                workspace.organizationCampaignCount ? (
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="inline-flex rounded-full border border-[#90FF4D]/25 bg-[#90FF4D]/10 px-3 py-1.5 text-[0.68rem] font-medium uppercase tracking-[0.18em] text-[#B8FF86]">
                                  All campaigns
                                </span>
                                <span className="text-sm text-muted-foreground">
                                  {formatCountLabel(
                                    invitation.campaignAccess.length,
                                    "campaign",
                                  )}
                                </span>
                              </div>
                            ) : invitation.campaignAccess.length > 0 ? (
                              <div className="flex max-w-2xl flex-wrap gap-2">
                                {invitation.campaignAccess.map(
                                  (
                                    campaignAccess: PendingOrganizationInvitation["campaignAccess"][number],
                                  ) => (
                                    <div
                                      key={`${invitation.id}-${campaignAccess.id}`}
                                      className="flex max-w-full items-center gap-2"
                                    >
                                      <CampaignBadge
                                        campaignId={campaignAccess.id}
                                        compact
                                        label={campaignAccess.name}
                                      />
                                      <span
                                        className={`inline-flex rounded-full border px-2 py-0.5 text-[0.56rem] font-medium uppercase tracking-[0.16em] ${getCampaignRoleBadgeClass(
                                          campaignAccess.role,
                                        )}`}
                                      >
                                        {formatRoleLabel(campaignAccess.role)}
                                      </span>
                                    </div>
                                  ),
                                )}
                              </div>
                            ) : (
                              <span className="text-sm text-muted-foreground">
                                No campaign access selected
                              </span>
                            )}
                          </td>
                          <td className="px-6 py-4">
                            <p className="text-sm text-foreground">
                              {formatInviteSentAtLabel(invitation.createdAt)}
                            </p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              Awaiting sign in
                            </p>
                          </td>
                          <td className="px-6 py-4">
                            {canRevokeInvitation ? (
                              <form action={revokeInvitationAction}>
                                <input
                                  name="invitationId"
                                  type="hidden"
                                  value={invitation.id}
                                />
                                <button
                                  className="rounded-full border border-white/[0.08] bg-black/[0.18] px-4 py-2 text-[0.68rem] font-medium uppercase tracking-[0.18em] text-muted-foreground transition hover:border-white/[0.14] hover:text-foreground"
                                  type="submit"
                                >
                                  Revoke
                                </button>
                              </form>
                            ) : (
                              <span className="inline-flex rounded-full border border-white/[0.08] bg-white/[0.04] px-3 py-1.5 text-[0.68rem] uppercase tracking-[0.18em] text-muted-foreground">
                                Protected
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="px-6 py-8">
                <p className="text-sm text-muted-foreground">
                  No pending invites yet. New invites will show up here until the
                  person signs in.
                </p>
              </div>
            )}
          </section>

          <section className="rounded-[1.7rem] border border-white/[0.08] bg-white/[0.03] p-6 shadow-[0_22px_70px_rgba(0,0,0,0.2)]">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <p className="text-[0.62rem] uppercase tracking-[0.24em] text-muted-foreground">
                  Add member
                </p>
                <h2 className="mt-3 text-2xl font-medium tracking-[-0.04em] text-foreground">
                  Invite someone to this organization.
                </h2>
                <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
                  Use the exact email address they will sign in with, then
                  choose whether they should get all campaign access or only the
                  campaigns you select here.
                </p>
              </div>
              <Link
                className="inline-flex items-center justify-center rounded-full border border-white/[0.08] bg-white/[0.04] px-5 py-3 text-sm font-medium text-foreground transition hover:border-white/[0.14] hover:bg-white/[0.08]"
                href={`/org/${organizationSlug}/campaigns`}
              >
                Open campaigns
              </Link>
            </div>

            <OrganizationInviteMemberForm
              campaignOptions={campaignOptions}
              inviteMemberAction={inviteMemberAction}
              inviteRoleOptions={inviteRoleOptions}
            />
          </section>
        </>
      ) : (
        <section className="rounded-[1.7rem] border border-white/[0.08] bg-white/[0.03] p-6 shadow-[0_22px_70px_rgba(0,0,0,0.2)]">
          <p className="text-[0.62rem] uppercase tracking-[0.24em] text-muted-foreground">
            Org access
          </p>
          <h2 className="mt-3 text-2xl font-medium tracking-[-0.04em] text-foreground">
            Org-wide team management is limited to admins and owners.
          </h2>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
            Your current role is {formatRoleLabel(workspace.membership.role)}.
            Campaign-level managers and members are still handled from the
            campaigns screen.
          </p>
          <Link
            className="mt-6 inline-flex items-center justify-center rounded-full border border-[#90FF4D]/24 bg-[#90FF4D]/90 px-5 py-3 text-sm font-medium text-black transition hover:bg-[#A4FF68]"
            href={`/org/${organizationSlug}/campaigns`}
          >
            Open campaigns
          </Link>
        </section>
      )}
    </div>
  );
}
