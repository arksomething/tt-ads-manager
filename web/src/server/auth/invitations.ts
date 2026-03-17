import { OrganizationRole } from "@prisma/client";

import { prisma } from "@/lib/db";

import { mergeCampaignRoles, mergeOrganizationRoles } from "./roles";

export function normalizeInviteEmail(value: string) {
  return value.trim().toLowerCase();
}

export async function applyPendingInvitationsForUser({
  userId,
  email,
}: {
  userId: string;
  email?: string | null;
}) {
  const normalizedEmail = normalizeInviteEmail(email ?? "");

  if (!normalizedEmail) {
    return;
  }

  const prismaWithOptionalInvitationDelegates = prisma as typeof prisma & {
    organizationInvitation?: typeof prisma.organizationInvitation;
    campaignInvitation?: typeof prisma.campaignInvitation;
  };
  const organizationInvitationDelegate =
    prismaWithOptionalInvitationDelegates.organizationInvitation;
  const campaignInvitationDelegate =
    prismaWithOptionalInvitationDelegates.campaignInvitation;

  // During local schema/client churn, the dev server can hold a stale Prisma
  // runtime. Skip invitation auto-claiming rather than blocking org access.
  if (!organizationInvitationDelegate || !campaignInvitationDelegate) {
    if (process.env.NODE_ENV !== "production") {
      console.warn(
        "Skipping pending invitation sync because invitation delegates are unavailable. Restart the dev server after Prisma schema or env changes.",
      );
    }

    return;
  }

  const [organizationInvitations, campaignInvitations] = await Promise.all([
    organizationInvitationDelegate.findMany({
      where: {
        email: normalizedEmail,
        acceptedAt: null,
        revokedAt: null,
      },
      select: {
        id: true,
        organizationId: true,
        role: true,
      },
    }),
    campaignInvitationDelegate.findMany({
      where: {
        email: normalizedEmail,
        acceptedAt: null,
        revokedAt: null,
      },
      select: {
        id: true,
        campaignId: true,
        role: true,
        campaign: {
          select: {
            organizationId: true,
          },
        },
      },
    }),
  ]);

  if (organizationInvitations.length === 0 && campaignInvitations.length === 0) {
    return;
  }

  const acceptedAt = new Date();

  await prisma.$transaction(async (tx) => {
    for (const invitation of organizationInvitations) {
      const existingMembership = await tx.organizationMembership.findUnique({
        where: {
          organizationId_userId: {
            organizationId: invitation.organizationId,
            userId,
          },
        },
        select: {
          role: true,
        },
      });

      if (existingMembership) {
        await tx.organizationMembership.update({
          where: {
            organizationId_userId: {
              organizationId: invitation.organizationId,
              userId,
            },
          },
          data: {
            role: mergeOrganizationRoles(existingMembership.role, invitation.role),
          },
        });
      } else {
        await tx.organizationMembership.create({
          data: {
            organizationId: invitation.organizationId,
            userId,
            role: invitation.role,
          },
        });
      }

      await tx.organizationInvitation.update({
        where: {
          id: invitation.id,
        },
        data: {
          acceptedAt,
        },
      });
    }

    for (const invitation of campaignInvitations) {
      const organizationId = invitation.campaign.organizationId;
      const existingOrganizationMembership =
        await tx.organizationMembership.findUnique({
          where: {
            organizationId_userId: {
              organizationId,
              userId,
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
              organizationId,
              userId,
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
            organizationId,
            userId,
            role: OrganizationRole.MEMBER,
          },
        });
      }

      const existingCampaignMembership = await tx.campaignMembership.findUnique({
        where: {
          campaignId_userId: {
            campaignId: invitation.campaignId,
            userId,
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
              campaignId: invitation.campaignId,
              userId,
            },
          },
          data: {
            role: mergeCampaignRoles(existingCampaignMembership.role, invitation.role),
          },
        });
      } else {
        await tx.campaignMembership.create({
          data: {
            campaignId: invitation.campaignId,
            userId,
            role: invitation.role,
          },
        });
      }

      await tx.campaignInvitation.update({
        where: {
          id: invitation.id,
        },
        data: {
          acceptedAt,
        },
      });
    }
  });
}
