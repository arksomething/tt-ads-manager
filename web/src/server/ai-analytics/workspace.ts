import { type Prisma } from "@/lib/prisma-shim";

import { prisma } from "@/lib/db";
import { hasAiEnv } from "@/lib/server-env";
import { canManageOrganization } from "@/server/auth/roles";
import { getOrganizationDashboardShellData } from "@/server/dashboard/org-shell";

export type AiAnalyticsAccessContext = {
  organizationSlug: string;
  organizationId: string;
  organizationName: string;
  canManageOrganizationData: boolean;
  accessibleCampaigns: Array<{
    id: string;
    name: string;
  }>;
};

export type AiAnalyticsPageData = {
  organizationSlug: string;
  organizationName: string;
  isAiConfigured: boolean;
  hasDataAccess: boolean;
  accessibleCampaigns: Array<{
    id: string;
    name: string;
  }>;
  stats: {
    trackedVideos: number;
    accessibleCampaigns: number;
    accessibleCreators: number;
    latestPublishedAt: string | null;
  };
  samplePrompts: string[];
};

export async function getAiAnalyticsAccessContext(
  organizationSlug: string,
): Promise<AiAnalyticsAccessContext> {
  const shellData = await getOrganizationDashboardShellData(organizationSlug);

  return {
    organizationSlug,
    organizationId: shellData.membership.organizationId,
    organizationName: shellData.membership.organization.name,
    canManageOrganizationData: canManageOrganization(shellData.membership.role),
    accessibleCampaigns: shellData.campaigns.map((campaign) => ({
      id: campaign.id,
      name: campaign.name,
    })),
  };
}

export function getAiScopedVideoWhere(
  context: AiAnalyticsAccessContext,
): Prisma.VideoWhereInput {
  if (
    !context.canManageOrganizationData &&
    context.accessibleCampaigns.length === 0
  ) {
    return {
      id: {
        in: [],
      },
    };
  }

  return {
    creator: {
      organizationId: context.organizationId,
    },
    ...(context.canManageOrganizationData
      ? {}
      : {
          campaignId: {
            in: context.accessibleCampaigns.map((campaign) => campaign.id),
          },
        }),
  };
}

function getAiScopedCreatorWhere(
  context: AiAnalyticsAccessContext,
): Prisma.CreatorWhereInput {
  if (
    !context.canManageOrganizationData &&
    context.accessibleCampaigns.length === 0
  ) {
    return {
      id: {
        in: [],
      },
    };
  }

  return context.canManageOrganizationData
    ? {
        organizationId: context.organizationId,
      }
    : {
        organizationId: context.organizationId,
        campaignLinks: {
          some: {
            campaignId: {
              in: context.accessibleCampaigns.map((campaign) => campaign.id),
            },
          },
        },
      };
}

export async function getAiAnalyticsPageData(
  organizationSlug: string,
): Promise<AiAnalyticsPageData> {
  const context = await getAiAnalyticsAccessContext(organizationSlug);
  const baseVideoWhere = getAiScopedVideoWhere(context);
  const hasDataAccess =
    context.canManageOrganizationData || context.accessibleCampaigns.length > 0;
  const [trackedVideos, accessibleCreators, latestVideo] = await Promise.all([
    prisma.video.count({
      where: baseVideoWhere,
    }),
    prisma.creator.count({
      where: getAiScopedCreatorWhere(context),
    }),
    prisma.video.findFirst({
      where: baseVideoWhere,
      select: {
        publishedAt: true,
      },
      orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
    }),
  ]);

  return {
    organizationSlug: context.organizationSlug,
    organizationName: context.organizationName,
    isAiConfigured: hasAiEnv(),
    hasDataAccess,
    accessibleCampaigns: context.accessibleCampaigns,
    stats: {
      trackedVideos,
      accessibleCampaigns: context.accessibleCampaigns.length,
      accessibleCreators,
      latestPublishedAt: latestVideo?.publishedAt?.toISOString() ?? null,
    },
    samplePrompts: [
      "What were our top 5 videos by views in the last 30 days?",
      "Which campaigns drove the most total views this month?",
      "Show me the creators with the highest average engagement rate.",
      "How many videos did we publish on TikTok in the last 14 days?",
    ],
  };
}
