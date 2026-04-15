import { CampaignRole, OrganizationRole } from "@/lib/prisma-shim";
import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/db";
import { normalizeInviteEmail } from "@/server/auth/invitations";
import { requireOrganizationMembership } from "@/server/auth/organizations";
import {
  canManageOrganization,
  mergeCampaignRoles,
  mergeOrganizationRoles,
} from "@/server/auth/roles";

import { getCampaignAccess } from "./queries";
import {
  createOrganizationCampaignSchema,
  inviteCampaignMemberSchema,
  removeCampaignMemberSchema,
  revokeCampaignInvitationSchema,
  updateCampaignSchema,
  updateCampaignMemberRoleSchema,
} from "./schemas";

function revalidateCampaignWorkspace(organizationSlug: string) {
  revalidatePath("/app");
  revalidatePath(`/org/${organizationSlug}`);
  revalidatePath(`/org/${organizationSlug}/campaigns`);
}

export async function createCampaignForOrganization(
  organizationSlug: string,
  input: unknown,
) {
  const membership = await requireOrganizationMembership(organizationSlug);

  if (!canManageOrganization(membership.role)) {
    throw new Error("Only organization admins and owners can create campaigns.");
  }

  const values = createOrganizationCampaignSchema.parse(input);

  const campaign = await prisma.campaign.create({
    data: {
      organizationId: membership.organizationId,
      ownerUserId: membership.userId,
      name: values.name,
      memberships: {
        create: {
          userId: membership.userId,
          role: CampaignRole.OWNER,
        },
      },
    },
  });

  revalidateCampaignWorkspace(organizationSlug);

  return campaign;
}

export async function updateCampaignForOrganization(args: {
  organizationSlug: string;
  campaignId: string;
  input: unknown;
}) {
  const { organizationSlug, campaignId, input } = args;
  const { canManageCampaign } = await getCampaignAccess(
    organizationSlug,
    campaignId,
  );

  if (!canManageCampaign) {
    throw new Error("Campaign edit access denied");
  }

  const values = updateCampaignSchema.parse(input);
  const campaign = await prisma.campaign.update({
    where: {
      id: campaignId,
    },
    data: {
      ...(values.name !== undefined ? { name: values.name } : {}),
    },
  });

  revalidateCampaignWorkspace(organizationSlug);
  revalidatePath(`/org/${organizationSlug}/campaigns?campaignId=${campaign.id}`);

  return campaign;
}

export async function deleteCampaignForOrganization(args: {
  organizationSlug: string;
  campaignId: string;
}) {
  const { organizationSlug, campaignId } = args;
  const { membership, viewerCampaignRole } = await getCampaignAccess(
    organizationSlug,
    campaignId,
  );
  const canDeleteCampaign =
    canManageOrganization(membership.role) ||
    viewerCampaignRole === CampaignRole.OWNER;

  if (!canDeleteCampaign) {
    throw new Error("Campaign delete access denied");
  }

  const linkedRecordCounts = await prisma.campaign.findUnique({
    where: {
      id: campaignId,
    },
    select: {
      _count: {
        select: {
          creators: true,
          videos: true,
          payouts: true,
        },
      },
    },
  });

  if (!linkedRecordCounts) {
    throw new Error("Campaign not found");
  }

  if (
    linkedRecordCounts._count.creators > 0 ||
    linkedRecordCounts._count.videos > 0 ||
    linkedRecordCounts._count.payouts > 0
  ) {
    throw new Error(
      "Remove linked creators, videos, and payouts before deleting this campaign.",
    );
  }

  const deletedCampaign = await prisma.campaign.delete({
    where: {
      id: campaignId,
    },
  });

  revalidateCampaignWorkspace(organizationSlug);

  return deletedCampaign;
}

export async function inviteCampaignMember(args: {
  organizationSlug: string;
  campaignId: string;
  input: unknown;
}) {
  const { organizationSlug, campaignId, input } = args;
  const {
    membership,
    campaign,
    canManageCampaign,
  } = await getCampaignAccess(
    organizationSlug,
    campaignId,
  );

  if (!canManageCampaign && !canManageOrganization(membership.role)) {
    throw new Error("Campaign invite access denied");
  }

  const values = inviteCampaignMemberSchema.parse(input);
  const email = normalizeInviteEmail(values.email);

  if (values.role === CampaignRole.OWNER) {
    throw new Error(
      "Invite campaign leads as managers. The primary campaign owner stays the original creator.",
    );
  }

  const invitation = await prisma.$transaction(async (tx) => {
    const invitedUser = await tx.user.findFirst({
      where: {
        email: {
          equals: email,
          mode: "insensitive",
        },
      },
      select: {
        id: true,
      },
    });

    const acceptedAt = invitedUser ? new Date() : null;

    const upsertedInvitation = await tx.campaignInvitation.upsert({
      where: {
        campaignId_email: {
          campaignId,
          email,
        },
      },
      update: {
        role: values.role,
        invitedByUserId: membership.userId,
        acceptedAt,
        revokedAt: null,
      },
      create: {
        campaignId,
        email,
        role: values.role,
        invitedByUserId: membership.userId,
        acceptedAt,
      },
    });

    if (invitedUser) {
      const existingOrganizationMembership =
        await tx.organizationMembership.findUnique({
          where: {
            organizationId_userId: {
              organizationId: membership.organizationId,
              userId: invitedUser.id,
            },
          },
          select: {
            role: true,
          },
        });

      if (existingOrganizationMembership) {
        await tx.organizationMembership.update({
          where: {
            organizationId_userId: {
              organizationId: membership.organizationId,
              userId: invitedUser.id,
            },
          },
          data: {
            role: mergeOrganizationRoles(
              existingOrganizationMembership.role,
              OrganizationRole.MEMBER,
            ),
          },
        });
      } else {
        await tx.organizationMembership.create({
          data: {
            organizationId: membership.organizationId,
            userId: invitedUser.id,
            role: OrganizationRole.MEMBER,
          },
        });
      }

      const existingCampaignMembership = await tx.campaignMembership.findUnique({
        where: {
          campaignId_userId: {
            campaignId,
            userId: invitedUser.id,
          },
        },
        select: {
          role: true,
        },
      });

      if (existingCampaignMembership) {
        await tx.campaignMembership.update({
          where: {
            campaignId_userId: {
              campaignId,
              userId: invitedUser.id,
            },
          },
          data: {
            role: mergeCampaignRoles(existingCampaignMembership.role, values.role),
          },
        });
      } else {
        await tx.campaignMembership.create({
          data: {
            campaignId,
            userId: invitedUser.id,
            role: values.role,
          },
        });
      }
    }

    return upsertedInvitation;
  });

  revalidateCampaignWorkspace(organizationSlug);
  revalidatePath(`/org/${organizationSlug}/campaigns?campaignId=${campaign.id}`);

  return invitation;
}

export async function updateCampaignMemberRole(args: {
  organizationSlug: string;
  campaignId: string;
  input: unknown;
}) {
  const { organizationSlug, campaignId, input } = args;
  const { membership, campaign, canManageCampaign } = await getCampaignAccess(
    organizationSlug,
    campaignId,
  );

  if (!canManageCampaign && !canManageOrganization(membership.role)) {
    throw new Error("Campaign role access denied");
  }

  const values = updateCampaignMemberRoleSchema.parse(input);
  const updatedMembership = await prisma.$transaction(async (tx) => {
    const targetMembership = await tx.campaignMembership.findFirst({
      where: {
        id: values.membershipId,
        campaignId,
      },
    });

    if (!targetMembership) {
      throw new Error("Campaign member not found.");
    }

    if (targetMembership.userId === membership.userId) {
      throw new Error(
        "Ask another admin or manager to change your own campaign access.",
      );
    }

    if (
      targetMembership.role === CampaignRole.OWNER ||
      campaign.ownerUserId === targetMembership.userId
    ) {
      throw new Error("The primary campaign owner cannot be changed here.");
    }

    return tx.campaignMembership.update({
      where: {
        id: targetMembership.id,
      },
      data: {
        role: values.role,
      },
    });
  });

  revalidateCampaignWorkspace(organizationSlug);
  revalidatePath(`/org/${organizationSlug}/campaigns?campaignId=${campaign.id}`);

  return updatedMembership;
}

export async function removeCampaignMember(args: {
  organizationSlug: string;
  campaignId: string;
  input: unknown;
}) {
  const { organizationSlug, campaignId, input } = args;
  const { membership, campaign, canManageCampaign } = await getCampaignAccess(
    organizationSlug,
    campaignId,
  );

  if (!canManageCampaign && !canManageOrganization(membership.role)) {
    throw new Error("Campaign removal access denied");
  }

  const values = removeCampaignMemberSchema.parse(input);
  const removedMembership = await prisma.$transaction(async (tx) => {
    const targetMembership = await tx.campaignMembership.findFirst({
      where: {
        id: values.membershipId,
        campaignId,
      },
      include: {
        user: {
          select: {
            email: true,
          },
        },
      },
    });

    if (!targetMembership) {
      throw new Error("Campaign member not found.");
    }

    if (targetMembership.userId === membership.userId) {
      throw new Error(
        "Ask another admin or manager to remove your own campaign access.",
      );
    }

    if (
      targetMembership.role === CampaignRole.OWNER ||
      campaign.ownerUserId === targetMembership.userId
    ) {
      throw new Error("The primary campaign owner cannot be removed here.");
    }

    if (targetMembership.user.email) {
      await tx.campaignInvitation.updateMany({
        where: {
          campaignId,
          email: normalizeInviteEmail(targetMembership.user.email),
          acceptedAt: null,
          revokedAt: null,
        },
        data: {
          revokedAt: new Date(),
        },
      });
    }

    return tx.campaignMembership.delete({
      where: {
        id: targetMembership.id,
      },
    });
  });

  revalidateCampaignWorkspace(organizationSlug);
  revalidatePath(`/org/${organizationSlug}/campaigns?campaignId=${campaign.id}`);

  return removedMembership;
}

export async function revokeCampaignInvitation(args: {
  organizationSlug: string;
  campaignId: string;
  input: unknown;
}) {
  const { organizationSlug, campaignId, input } = args;
  const { membership, campaign, canManageCampaign } = await getCampaignAccess(
    organizationSlug,
    campaignId,
  );

  if (!canManageCampaign && !canManageOrganization(membership.role)) {
    throw new Error("Campaign invite access denied");
  }

  const values = revokeCampaignInvitationSchema.parse(input);
  const invitation = await prisma.campaignInvitation.findFirst({
    where: {
      id: values.invitationId,
      campaignId,
    },
  });

  if (!invitation || invitation.acceptedAt || invitation.revokedAt) {
    throw new Error("Campaign invitation is no longer pending.");
  }

  const revokedInvitation = await prisma.campaignInvitation.update({
    where: {
      id: invitation.id,
    },
    data: {
      revokedAt: new Date(),
    },
  });

  revalidateCampaignWorkspace(organizationSlug);
  revalidatePath(`/org/${organizationSlug}/campaigns?campaignId=${campaign.id}`);

  return revokedInvitation;
}
