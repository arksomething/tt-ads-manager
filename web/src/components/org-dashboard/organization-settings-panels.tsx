import { OrganizationRole } from "@/lib/prisma-shim";

import {
  getOrganizationMembers,
  getOrganizationPendingInvitations,
} from "@/server/organizations/queries";
import {
  canManageOrganizationRole,
  getManageableOrganizationRoles,
} from "@/server/auth/roles";

type OrganizationAction = (formData: FormData) => Promise<void>;

type OrganizationPendingInvitationsPanelProps = {
  organizationSlug: string;
  revokeInvitationAction: OrganizationAction;
  viewerRole: OrganizationRole;
};

type OrganizationMembersPanelProps = {
  organizationSlug: string;
  organizationName: string;
  removeMemberAction: OrganizationAction;
  updateMemberRoleAction: OrganizationAction;
  viewerRole: OrganizationRole;
  viewerUserId: string;
};

export async function OrganizationPendingInvitationsPanel({
  organizationSlug,
  revokeInvitationAction,
  viewerRole,
}: OrganizationPendingInvitationsPanelProps) {
  const invitations = await getOrganizationPendingInvitations(organizationSlug);

  return (
    <article className="rounded-[1.7rem] border border-white/[0.08] bg-white/[0.03] p-6 shadow-[0_22px_70px_rgba(0,0,0,0.2)]">
      <p className="text-[0.62rem] uppercase tracking-[0.24em] text-muted-foreground">
        Pending invitations
      </p>
      <div className="mt-5 space-y-3">
        {invitations.length > 0 ? (
          invitations.map((invitation) => (
            <div
              key={invitation.id}
              className="rounded-[1.15rem] border border-white/[0.08] bg-black/[0.18] px-4 py-3.5"
            >
              {(() => {
                const canRevokeInvitation = canManageOrganizationRole(
                  viewerRole,
                  invitation.role,
                );

                return (
                  <>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-foreground">
                          {invitation.email}
                        </p>
                        <p className="mt-1 text-xs uppercase tracking-[0.18em] text-muted-foreground">
                          {invitation.role}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="rounded-full border border-[#90FF4D]/25 bg-[#90FF4D]/10 px-2.5 py-1 text-[0.56rem] uppercase tracking-[0.18em] text-[#B8FF86]">
                          Pending
                        </span>
                        {canRevokeInvitation ? (
                          <form action={revokeInvitationAction}>
                            <input
                              name="invitationId"
                              type="hidden"
                              value={invitation.id}
                            />
                            <button
                              className="rounded-full border border-white/[0.08] bg-black/[0.18] px-3 py-1.5 text-[0.58rem] font-medium uppercase tracking-[0.18em] text-muted-foreground transition hover:border-white/[0.14] hover:text-foreground"
                              type="submit"
                            >
                              Revoke
                            </button>
                          </form>
                        ) : null}
                      </div>
                    </div>
                    <p className="mt-3 text-xs text-muted-foreground">
                      Invited by{" "}
                      {invitation.invitedBy?.email ??
                        invitation.invitedBy?.name ??
                        "an organization admin"}
                    </p>
                  </>
                );
              })()}
            </div>
          ))
        ) : (
          <div className="rounded-[1.15rem] border border-dashed border-white/[0.08] bg-black/[0.18] px-4 py-8 text-sm text-muted-foreground">
            No pending organization invites.
          </div>
        )}
      </div>
    </article>
  );
}

export function OrganizationPendingInvitationsSkeleton() {
  return (
    <article className="rounded-[1.7rem] border border-white/[0.08] bg-white/[0.03] p-6 shadow-[0_22px_70px_rgba(0,0,0,0.2)]">
      <p className="text-[0.62rem] uppercase tracking-[0.24em] text-muted-foreground">
        Pending invitations
      </p>
      <div className="mt-5 space-y-3 animate-pulse">
        {Array.from({ length: 3 }).map((_, index) => (
          <div
            key={index}
            className="rounded-[1.15rem] border border-white/[0.08] bg-black/[0.18] px-4 py-3.5"
          >
            <div className="h-4 w-40 rounded bg-white/[0.08]" />
            <div className="mt-2 h-3 w-20 rounded bg-white/[0.06]" />
            <div className="mt-4 h-3 w-32 rounded bg-white/[0.06]" />
          </div>
        ))}
      </div>
    </article>
  );
}

export async function OrganizationMembersPanel({
  organizationSlug,
  organizationName,
  removeMemberAction,
  updateMemberRoleAction,
  viewerRole,
  viewerUserId,
}: OrganizationMembersPanelProps) {
  const members = await getOrganizationMembers(organizationSlug);

  return (
    <section className="rounded-[1.7rem] border border-white/[0.08] bg-white/[0.03] p-6 shadow-[0_22px_70px_rgba(0,0,0,0.2)]">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[0.62rem] uppercase tracking-[0.24em] text-muted-foreground">
            Members
          </p>
          <h2 className="mt-3 text-2xl font-medium tracking-[-0.04em] text-foreground">
            Organization access roster.
          </h2>
        </div>
        <p className="text-sm text-muted-foreground">{organizationName}</p>
      </div>

      <div className="mt-6 space-y-3">
        {members.map((member) => (
          <div
            key={member.id}
            className="flex flex-col gap-3 rounded-[1.15rem] border border-white/[0.08] bg-black/[0.18] px-4 py-3.5"
          >
            {(() => {
              const manageableRoles = getManageableOrganizationRoles(
                viewerRole,
                member.role,
              );
              const canManageMember =
                manageableRoles.length > 0 && member.userId !== viewerUserId;

              return (
                <>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">
                        {member.user.name ?? member.user.email ?? "Organization member"}
                      </p>
                      <p className="mt-1 truncate text-xs text-muted-foreground">
                        {member.user.email ?? "No email available"}
                      </p>
                    </div>
                    {canManageMember ? (
                      <div className="flex flex-wrap items-center gap-2">
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
                                {role}
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
                      <span className="rounded-full border border-white/[0.08] bg-white/[0.04] px-2.5 py-1 text-[0.56rem] uppercase tracking-[0.18em] text-muted-foreground">
                        {member.role}
                      </span>
                    )}
                  </div>
                  {member.userId === viewerUserId ? (
                    <p className="text-xs text-muted-foreground">
                      Ask another organization admin or owner if your own access
                      needs to change.
                    </p>
                  ) : member.role === OrganizationRole.OWNER ? (
                    <p className="text-xs text-muted-foreground">
                      Owner access stays protected unless another owner changes it.
                    </p>
                  ) : null}
                </>
              );
            })()}
          </div>
        ))}
      </div>
    </section>
  );
}

export function OrganizationMembersPanelSkeleton({
  organizationName,
}: Pick<OrganizationMembersPanelProps, "organizationName">) {
  return (
    <section className="rounded-[1.7rem] border border-white/[0.08] bg-white/[0.03] p-6 shadow-[0_22px_70px_rgba(0,0,0,0.2)]">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[0.62rem] uppercase tracking-[0.24em] text-muted-foreground">
            Members
          </p>
          <h2 className="mt-3 text-2xl font-medium tracking-[-0.04em] text-foreground">
            Organization access roster.
          </h2>
        </div>
        <p className="text-sm text-muted-foreground">{organizationName}</p>
      </div>

      <div className="mt-6 space-y-3 animate-pulse">
        {Array.from({ length: 4 }).map((_, index) => (
          <div
            key={index}
            className="rounded-[1.15rem] border border-white/[0.08] bg-black/[0.18] px-4 py-3.5"
          >
            <div className="h-4 w-44 rounded bg-white/[0.08]" />
            <div className="mt-2 h-3 w-32 rounded bg-white/[0.06]" />
          </div>
        ))}
      </div>
    </section>
  );
}
