import { CampaignRole, OrganizationRole } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { prisma } from "@/lib/db";
import { normalizeInviteEmail } from "@/server/auth/invitations";
import { requireOrganizationMembership } from "@/server/auth/organizations";
import { requireUser } from "@/server/auth/session";
import {
  canAssignOrganizationRole,
  canManageOrganization,
  canManageOrganizationRole,
  mergeOrganizationRoles,
} from "@/server/auth/roles";

import {
  inviteMemberSchema,
  removeOrganizationMemberSchema,
  revokeOrganizationInvitationSchema,
  updateOrganizationMemberRoleSchema,
} from "./schemas";
import {
  formatOrganizationName,
  formatOrganizationSlug,
  getOrganizationNameSequence,
  getOrganizationSlugSequence,
  slugifyOrganizationName,
} from "./naming";

const createOrganizationFromNameSchema = z.object({
  name: z.string().trim().min(2).max(120),
});

function toTitleCaseWords(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

function getDefaultOrganizationNameForUser(args: {
  name?: string | null;
  email?: string | null;
}) {
  const normalizedName = args.name?.trim();

  if (normalizedName && normalizedName.length >= 2) {
    return /workspace$/i.test(normalizedName)
      ? normalizedName
      : `${normalizedName} Workspace`;
  }

  const emailLocalPart = args.email?.split("@")[0]?.trim() ?? "";
  const humanizedEmailLocalPart = toTitleCaseWords(
    emailLocalPart.replace(/[^a-zA-Z0-9]+/g, " ").trim(),
  );

  if (humanizedEmailLocalPart.length >= 2) {
    return /workspace$/i.test(humanizedEmailLocalPart)
      ? humanizedEmailLocalPart
      : `${humanizedEmailLocalPart} Workspace`;
  }

  return "My Workspace";
}

function revalidateOrganizationWorkspace(organizationSlug: string) {
  revalidatePath("/app");
  revalidatePath(`/org/${organizationSlug}`);
  revalidatePath(`/org/${organizationSlug}/campaigns`);
  revalidatePath(`/org/${organizationSlug}/settings`);
  revalidatePath(`/org/${organizationSlug}/team`);
}

async function getAvailableOrganizationIdentity(args: {
  userId: string;
  desiredName: string;
}) {
  const { userId, desiredName } = args;
  const baseName = desiredName.trim();
  const baseSlug = slugifyOrganizationName(baseName);

  const [viewerOrganizations, similarOrganizations] = await Promise.all([
    prisma.organizationMembership.findMany({
      where: {
        userId,
      },
      select: {
        organization: {
          select: {
            name: true,
          },
        },
      },
    }),
    prisma.organization.findMany({
      where: {
        slug: {
          startsWith: baseSlug,
        },
      },
      select: {
        slug: true,
      },
    }),
  ]);

  const takenNameSequences = new Set(
    viewerOrganizations
      .map(({ organization }) => getOrganizationNameSequence(organization.name, baseName))
      .filter((sequence): sequence is number => sequence !== null),
  );
  const takenSlugSequences = new Set(
    similarOrganizations
      .map(({ slug }) => getOrganizationSlugSequence(slug, baseSlug))
      .filter((sequence): sequence is number => sequence !== null),
  );

  let sequence = 1;

  while (takenNameSequences.has(sequence) || takenSlugSequences.has(sequence)) {
    sequence += 1;
  }

  return {
    name: formatOrganizationName(baseName, sequence),
    slug: formatOrganizationSlug(baseSlug, sequence),
  };
}

export async function createOrganizationForCurrentUser(input: unknown) {
  const user = await requireUser();
  const { name } = createOrganizationFromNameSchema.parse(input);
  const organizationIdentity = await getAvailableOrganizationIdentity({
    userId: user.id,
    desiredName: name,
  });

  const organization = await prisma.organization.create({
    data: {
      name: organizationIdentity.name,
      slug: organizationIdentity.slug,
      createdById: user.id,
      memberships: {
        create: {
          userId: user.id,
          role: OrganizationRole.OWNER,
        },
      },
    },
  });

  revalidatePath("/app");

  return organization;
}

export async function ensureOrganizationForCurrentUser() {
  const user = await requireUser();
  const existingMembership = await prisma.organizationMembership.findFirst({
    where: {
      userId: user.id,
    },
    include: {
      organization: true,
    },
    orderBy: {
      createdAt: "asc",
    },
  });

  if (existingMembership) {
    return existingMembership.organization;
  }

  return createOrganizationForCurrentUser({
    name: getDefaultOrganizationNameForUser({
      name: user.name,
      email: user.email,
    }),
  });
}

export async function inviteOrganizationMember(args: {
  organizationSlug: string;
  input: unknown;
}) {
  const { organizationSlug, input } = args;
  const membership = await requireOrganizationMembership(organizationSlug);

  if (!canManageOrganization(membership.role)) {
    throw new Error("Organization invite access denied");
  }

  const values = inviteMemberSchema.parse(input);
  const email = normalizeInviteEmail(values.email);
  const grantsOrgWideCampaignAccess = canManageOrganization(values.role);
  const requestedCampaignIds = Array.from(new Set(values.campaignIds));

  if (
    values.role === OrganizationRole.OWNER &&
    membership.role !== OrganizationRole.OWNER
  ) {
    throw new Error("Only organization owners can invite another owner.");
  }

  const selectedCampaignIds = grantsOrgWideCampaignAccess
    ? []
    : values.campaignAccessScope === "all"
      ? (
          await prisma.campaign.findMany({
            where: {
              organizationId: membership.organizationId,
            },
            select: {
              id: true,
            },
          })
        ).map((campaign) => campaign.id)
      : requestedCampaignIds.length > 0
        ? (
            await prisma.campaign.findMany({
              where: {
                organizationId: membership.organizationId,
                id: {
                  in: requestedCampaignIds,
                },
              },
              select: {
                id: true,
              },
            })
          ).map((campaign) => campaign.id)
        : [];

  if (
    !grantsOrgWideCampaignAccess &&
    values.campaignAccessScope === "selected" &&
    selectedCampaignIds.length !== requestedCampaignIds.length
  ) {
    throw new Error("Some selected campaigns are no longer available.");
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
    const upsertedInvitation = await tx.organizationInvitation.upsert({
      where: {
        organizationId_email: {
          organizationId: membership.organizationId,
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
        organizationId: membership.organizationId,
        email,
        role: values.role,
        invitedByUserId: membership.userId,
        acceptedAt,
      },
    });

    if (invitedUser) {
      const existingMembership = await tx.organizationMembership.findUnique({
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

      if (existingMembership) {
        await tx.organizationMembership.update({
          where: {
            organizationId_userId: {
              organizationId: membership.organizationId,
              userId: invitedUser.id,
            },
          },
          data: {
            role: mergeOrganizationRoles(existingMembership.role, values.role),
          },
        });
      } else {
        await tx.organizationMembership.create({
          data: {
            organizationId: membership.organizationId,
            userId: invitedUser.id,
            role: values.role,
          },
        });
      }
    }

    const selectedCampaignIdSet = new Set(selectedCampaignIds);
    const pendingCampaignInvitations = await tx.campaignInvitation.findMany({
      where: {
        email,
        acceptedAt: null,
        revokedAt: null,
        campaign: {
          organizationId: membership.organizationId,
        },
      },
      select: {
        id: true,
        campaignId: true,
      },
    });
    const pendingCampaignInvitationIdsToRevoke = pendingCampaignInvitations
      .filter((campaignInvitation) => {
        return !selectedCampaignIdSet.has(campaignInvitation.campaignId);
      })
      .map((campaignInvitation) => campaignInvitation.id);

    if (pendingCampaignInvitationIdsToRevoke.length > 0) {
      await tx.campaignInvitation.updateMany({
        where: {
          id: {
            in: pendingCampaignInvitationIdsToRevoke,
          },
        },
        data: {
          revokedAt: new Date(),
        },
      });
    }

    for (const campaignId of selectedCampaignIds) {
      await tx.campaignInvitation.upsert({
        where: {
          campaignId_email: {
            campaignId,
            email,
          },
        },
        update: {
          role: CampaignRole.MEMBER,
          invitedByUserId: membership.userId,
          acceptedAt,
          revokedAt: null,
        },
        create: {
          campaignId,
          email,
          role: CampaignRole.MEMBER,
          invitedByUserId: membership.userId,
          acceptedAt,
        },
      });

      if (!invitedUser) {
        continue;
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

      if (!existingCampaignMembership) {
        await tx.campaignMembership.create({
          data: {
            campaignId,
            userId: invitedUser.id,
            role: CampaignRole.MEMBER,
          },
        });
      }
    }

    return upsertedInvitation;
  });

  revalidateOrganizationWorkspace(organizationSlug);

  return invitation;
}

export async function updateOrganizationMemberRole(args: {
  organizationSlug: string;
  input: unknown;
}) {
  const { organizationSlug, input } = args;
  const membership = await requireOrganizationMembership(organizationSlug);

  if (!canManageOrganization(membership.role)) {
    throw new Error("Organization role access denied");
  }

  const values = updateOrganizationMemberRoleSchema.parse(input);
  const updatedMembership = await prisma.$transaction(async (tx) => {
    const targetMembership = await tx.organizationMembership.findFirst({
      where: {
        id: values.membershipId,
        organizationId: membership.organizationId,
      },
      include: {
        user: {
          select: {
            id: true,
          },
        },
      },
    });

    if (!targetMembership) {
      throw new Error("Organization member not found.");
    }

    if (targetMembership.userId === membership.userId) {
      throw new Error(
        "Ask another organization admin or owner to change your own access.",
      );
    }

    if (!canManageOrganizationRole(membership.role, targetMembership.role)) {
      throw new Error("You cannot change that organization role.");
    }

    if (!canAssignOrganizationRole(membership.role, values.role)) {
      throw new Error("You cannot assign that organization role.");
    }

    if (targetMembership.role === OrganizationRole.OWNER) {
      const ownerCount = await tx.organizationMembership.count({
        where: {
          organizationId: membership.organizationId,
          role: OrganizationRole.OWNER,
        },
      });

      if (ownerCount <= 1 && values.role !== OrganizationRole.OWNER) {
        throw new Error(
          "Add another organization owner before changing the final owner.",
        );
      }
    }

    return tx.organizationMembership.update({
      where: {
        id: targetMembership.id,
      },
      data: {
        role: values.role,
      },
    });
  });

  revalidateOrganizationWorkspace(organizationSlug);

  return updatedMembership;
}

export async function removeOrganizationMember(args: {
  organizationSlug: string;
  input: unknown;
}) {
  const { organizationSlug, input } = args;
  const membership = await requireOrganizationMembership(organizationSlug);

  if (!canManageOrganization(membership.role)) {
    throw new Error("Organization removal access denied");
  }

  const values = removeOrganizationMemberSchema.parse(input);
  const removedMembership = await prisma.$transaction(async (tx) => {
    const targetMembership = await tx.organizationMembership.findFirst({
      where: {
        id: values.membershipId,
        organizationId: membership.organizationId,
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
      throw new Error("Organization member not found.");
    }

    if (targetMembership.userId === membership.userId) {
      throw new Error(
        "Ask another organization admin or owner to remove your own access.",
      );
    }

    if (!canManageOrganizationRole(membership.role, targetMembership.role)) {
      throw new Error("You cannot remove that organization member.");
    }

    if (targetMembership.role === OrganizationRole.OWNER) {
      const ownerCount = await tx.organizationMembership.count({
        where: {
          organizationId: membership.organizationId,
          role: OrganizationRole.OWNER,
        },
      });

      if (ownerCount <= 1) {
        throw new Error(
          "Add another organization owner before removing the final owner.",
        );
      }
    }

    const normalizedEmail = targetMembership.user.email
      ? normalizeInviteEmail(targetMembership.user.email)
      : null;
    const revokedAt = new Date();

    if (normalizedEmail) {
      await tx.organizationInvitation.updateMany({
        where: {
          organizationId: membership.organizationId,
          email: normalizedEmail,
          acceptedAt: null,
          revokedAt: null,
        },
        data: {
          revokedAt,
        },
      });

      await tx.campaignInvitation.updateMany({
        where: {
          email: normalizedEmail,
          acceptedAt: null,
          revokedAt: null,
          campaign: {
            organizationId: membership.organizationId,
          },
        },
        data: {
          revokedAt,
        },
      });
    }

    await tx.campaign.updateMany({
      where: {
        organizationId: membership.organizationId,
        ownerUserId: targetMembership.userId,
      },
      data: {
        ownerUserId: null,
      },
    });

    await tx.campaignMembership.deleteMany({
      where: {
        userId: targetMembership.userId,
        campaign: {
          organizationId: membership.organizationId,
        },
      },
    });

    return tx.organizationMembership.delete({
      where: {
        id: targetMembership.id,
      },
    });
  });

  revalidateOrganizationWorkspace(organizationSlug);

  return removedMembership;
}

export async function revokeOrganizationInvitation(args: {
  organizationSlug: string;
  input: unknown;
}) {
  const { organizationSlug, input } = args;
  const membership = await requireOrganizationMembership(organizationSlug);

  if (!canManageOrganization(membership.role)) {
    throw new Error("Organization invite access denied");
  }

  const values = revokeOrganizationInvitationSchema.parse(input);
  const invitation = await prisma.organizationInvitation.findFirst({
    where: {
      id: values.invitationId,
      organizationId: membership.organizationId,
    },
  });

  if (!invitation || invitation.acceptedAt || invitation.revokedAt) {
    throw new Error("Organization invitation is no longer pending.");
  }

  if (!canManageOrganizationRole(membership.role, invitation.role)) {
    throw new Error("You cannot revoke that organization invitation.");
  }

  const revokedAt = new Date();
  const revokedInvitation = await prisma.$transaction(async (tx) => {
    const updatedInvitation = await tx.organizationInvitation.update({
      where: {
        id: invitation.id,
      },
      data: {
        revokedAt,
      },
    });

    await tx.campaignInvitation.updateMany({
      where: {
        email: invitation.email,
        acceptedAt: null,
        revokedAt: null,
        campaign: {
          organizationId: membership.organizationId,
        },
      },
      data: {
        revokedAt,
      },
    });

    return updatedInvitation;
  });

  revalidateOrganizationWorkspace(organizationSlug);

  return revokedInvitation;
}
