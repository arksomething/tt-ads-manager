import { CampaignRole, OrganizationRole } from "@/lib/prisma-shim";

import { prisma } from "@/lib/db";
import { requireOrganizationMembership } from "@/server/auth/organizations";
import { canManageOrganization } from "@/server/auth/roles";
import { countAccessibleCampaignsForMembership } from "@/server/campaigns/queries";

const organizationRoleSortWeight: Record<OrganizationRole, number> = {
  [OrganizationRole.OWNER]: 0,
  [OrganizationRole.ADMIN]: 1,
  [OrganizationRole.MEMBER]: 2,
};

type OrganizationMemberCampaignAccess = {
  id: string;
  name: string;
  role: CampaignRole;
};

export type OrganizationMemberAccessRow = {
  id: string;
  userId: string;
  role: OrganizationRole;
  name: string | null;
  email: string | null;
  hasOrgWideCampaignAccess: boolean;
  campaignAccess: OrganizationMemberCampaignAccess[];
};

function getOrganizationMemberCampaignAccess(args: {
  ownedCampaigns: Array<{
    id: string;
    name: string;
  }>;
  campaignMemberships: Array<{
    role: CampaignRole;
    campaign: {
      id: string;
      name: string;
    };
  }>;
}) {
  const accessByCampaignId = new Map<string, OrganizationMemberCampaignAccess>();

  for (const campaign of args.ownedCampaigns) {
    accessByCampaignId.set(campaign.id, {
      id: campaign.id,
      name: campaign.name,
      role: CampaignRole.OWNER,
    });
  }

  for (const membership of args.campaignMemberships) {
    const existingAccess = accessByCampaignId.get(membership.campaign.id);

    if (existingAccess?.role === CampaignRole.OWNER) {
      continue;
    }

    accessByCampaignId.set(membership.campaign.id, {
      id: membership.campaign.id,
      name: membership.campaign.name,
      role: membership.role,
    });
  }

  return Array.from(accessByCampaignId.values()).sort((left, right) =>
    left.name.localeCompare(right.name),
  );
}

export async function getOrganizationSettingsSummary(organizationSlug: string) {
  const membership = await requireOrganizationMembership(organizationSlug);

  const [
    memberCount,
    invitationCount,
    accessibleCampaignCount,
    organizationCampaignCount,
  ] =
    await Promise.all([
      prisma.organizationMembership.count({
        where: {
          organizationId: membership.organizationId,
        },
      }),
      prisma.organizationInvitation.count({
        where: {
          organizationId: membership.organizationId,
          acceptedAt: null,
          revokedAt: null,
        },
      }),
      countAccessibleCampaignsForMembership(membership),
      prisma.campaign.count({
        where: {
          organizationId: membership.organizationId,
        },
      }),
    ]);

  return {
    membership,
    memberCount,
    invitationCount,
    accessibleCampaignCount,
    organizationCampaignCount,
    canManageMembers: canManageOrganization(membership.role),
  };
}

export async function getOrganizationMembers(organizationSlug: string) {
  const membership = await requireOrganizationMembership(organizationSlug);

  if (!canManageOrganization(membership.role)) {
    throw new Error("Organization team access denied");
  }

  return prisma.organizationMembership.findMany({
    where: {
      organizationId: membership.organizationId,
    },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
    },
    orderBy: [{ role: "asc" }, { createdAt: "asc" }],
  });
}

export async function getOrganizationMemberAccessRows(organizationSlug: string) {
  const membership = await requireOrganizationMembership(organizationSlug);

  if (!canManageOrganization(membership.role)) {
    throw new Error("Organization team access denied");
  }

  const members = await prisma.organizationMembership.findMany({
    where: {
      organizationId: membership.organizationId,
    },
    select: {
      id: true,
      userId: true,
      role: true,
      user: {
        select: {
          name: true,
          email: true,
          ownedCampaigns: {
            where: {
              organizationId: membership.organizationId,
            },
            select: {
              id: true,
              name: true,
            },
          },
          campaignMemberships: {
            where: {
              campaign: {
                organizationId: membership.organizationId,
              },
            },
            select: {
              role: true,
              campaign: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          },
        },
      },
    },
  });

  return members
    .map<OrganizationMemberAccessRow>((member) => ({
      id: member.id,
      userId: member.userId,
      role: member.role,
      name: member.user.name,
      email: member.user.email,
      hasOrgWideCampaignAccess:
        member.role === OrganizationRole.OWNER ||
        member.role === OrganizationRole.ADMIN,
      campaignAccess: getOrganizationMemberCampaignAccess({
        ownedCampaigns: member.user.ownedCampaigns,
        campaignMemberships: member.user.campaignMemberships,
      }),
    }))
    .sort((left, right) => {
      const roleWeightDifference =
        organizationRoleSortWeight[left.role] -
        organizationRoleSortWeight[right.role];

      if (roleWeightDifference !== 0) {
        return roleWeightDifference;
      }

      return (left.name ?? left.email ?? "").localeCompare(
        right.name ?? right.email ?? "",
      );
    });
}

export async function getOrganizationPendingInvitations(
  organizationSlug: string,
) {
  const membership = await requireOrganizationMembership(organizationSlug);

  if (!canManageOrganization(membership.role)) {
    throw new Error("Organization invite access denied");
  }

  const [organizationInvitations, campaignInvitations] = await Promise.all([
    prisma.organizationInvitation.findMany({
      where: {
        organizationId: membership.organizationId,
        acceptedAt: null,
        revokedAt: null,
      },
      include: {
        invitedBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    }),
    prisma.campaignInvitation.findMany({
      where: {
        acceptedAt: null,
        revokedAt: null,
        campaign: {
          organizationId: membership.organizationId,
        },
      },
      select: {
        email: true,
        role: true,
        campaign: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: {
        campaign: {
          name: "asc",
        },
      },
    }),
  ]);
  const campaignAccessByEmail = campaignInvitations.reduce(
    (accessByEmail, invitation) => {
      const existingAccess = accessByEmail.get(invitation.email) ?? [];

      existingAccess.push({
        id: invitation.campaign.id,
        name: invitation.campaign.name,
        role: invitation.role,
      });
      accessByEmail.set(invitation.email, existingAccess);
      return accessByEmail;
    },
    new Map<string, Array<{ id: string; name: string; role: CampaignRole }>>(),
  );

  return organizationInvitations.map((invitation) => ({
    ...invitation,
    campaignAccess: campaignAccessByEmail.get(invitation.email) ?? [],
  }));
}
