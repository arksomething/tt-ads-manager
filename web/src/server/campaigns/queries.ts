import { CampaignRole, type OrganizationMembership } from "@/lib/prisma-shim";

import { prisma } from "@/lib/db";
import { requireOrganizationMembership } from "@/server/auth/organizations";
import { canManageCampaign, canManageOrganization } from "@/server/auth/roles";

const CAMPAIGN_CREATOR_PREVIEW_LIMIT = 12;
const CAMPAIGN_VIDEO_PREVIEW_LIMIT = 12;

type ViewerOrganizationMembership = Pick<
  OrganizationMembership,
  "organizationId" | "role" | "userId"
>;

export function getAccessibleCampaignWhere(
  membership: ViewerOrganizationMembership,
) {
  if (canManageOrganization(membership.role)) {
    return {
      organizationId: membership.organizationId,
    };
  }

  return {
    organizationId: membership.organizationId,
    OR: [
      {
        ownerUserId: membership.userId,
      },
      {
        memberships: {
          some: {
            userId: membership.userId,
          },
        },
      },
    ],
  };
}

export async function getAccessibleCampaignOptionsForMembership(
  membership: ViewerOrganizationMembership,
) {
  return prisma.campaign.findMany({
    where: getAccessibleCampaignWhere(membership),
    select: {
      id: true,
      name: true,
    },
    orderBy: {
      createdAt: "desc",
    },
  });
}

export async function countAccessibleCampaignsForMembership(
  membership: ViewerOrganizationMembership,
) {
  return prisma.campaign.count({
    where: getAccessibleCampaignWhere(membership),
  });
}

export async function getCampaignWorkspace(organizationSlug: string) {
  const membership = await requireOrganizationMembership(organizationSlug);

  const campaigns = await prisma.campaign.findMany({
    where: getAccessibleCampaignWhere(membership),
    select: {
      id: true,
      name: true,
      updatedAt: true,
      owner: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
      memberships: {
        where: {
          userId: membership.userId,
        },
        select: {
          role: true,
        },
        take: 1,
      },
      _count: {
        select: {
          creators: true,
          videos: true,
          memberships: true,
          payouts: true,
        },
      },
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  return {
    membership,
    campaigns,
    canManageOrganizationCampaigns: canManageOrganization(membership.role),
  };
}

export type CampaignWorkspace = Awaited<ReturnType<typeof getCampaignWorkspace>>;
export type CampaignWorkspaceSummary = CampaignWorkspace["campaigns"][number];

export async function getCampaignWorkspaceDetail(args: {
  organizationSlug: string;
  campaignId: string;
}) {
  const membership = await requireOrganizationMembership(args.organizationSlug);

  return prisma.campaign.findFirst({
    where: {
      id: args.campaignId,
      ...getAccessibleCampaignWhere(membership),
    },
    select: {
      memberships: {
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
      },
      invitations: {
        where: {
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
      },
      creators: {
        select: {
          id: true,
          createdAt: true,
          creator: {
            select: {
              id: true,
              displayName: true,
              primaryNiche: true,
            },
          },
        },
        orderBy: {
          createdAt: "desc",
        },
        take: CAMPAIGN_CREATOR_PREVIEW_LIMIT,
      },
      videos: {
        select: {
          id: true,
          videoUrl: true,
          titleOrCaption: true,
          platform: true,
          views: true,
          publishedAt: true,
          createdAt: true,
          creator: {
            select: {
              id: true,
              displayName: true,
            },
          },
        },
        orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
        take: CAMPAIGN_VIDEO_PREVIEW_LIMIT,
      },
    },
  });
}

export async function getCampaignAccess(
  organizationSlug: string,
  campaignId: string,
) {
  const membership = await requireOrganizationMembership(organizationSlug);
  const campaign = await prisma.campaign.findFirst({
    where: {
      id: campaignId,
      ...getAccessibleCampaignWhere(membership),
    },
    include: {
      memberships: {
        where: {
          userId: membership.userId,
        },
        select: {
          role: true,
        },
      },
    },
  });

  if (!campaign) {
    throw new Error("Campaign access denied");
  }

  const viewerCampaignRole =
    campaign.ownerUserId === membership.userId
      ? CampaignRole.OWNER
      : (campaign.memberships[0]?.role ?? null);

  return {
    membership,
    campaign,
    viewerCampaignRole,
    canManageCampaign:
      canManageOrganization(membership.role) ||
      (viewerCampaignRole ? canManageCampaign(viewerCampaignRole) : false),
  };
}
