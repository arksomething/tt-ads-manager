import { requireOrganizationMembership } from "@/server/auth/organizations";
import { canManageOrganization } from "@/server/auth/roles";
import { prisma } from "@/lib/db";

export async function getOrganizationMessagingWorkspace(organizationSlug: string) {
  const membership = await requireOrganizationMembership(organizationSlug);
  const canManageIntegrations = canManageOrganization(membership.role);
  const [twilioConfig, tiktokAccounts, recentThreads, recentEvents] = await Promise.all([
    canManageIntegrations
      ? prisma.organizationTwilioConfig.findUnique({
          where: {
            organizationId: membership.organizationId,
          },
        })
      : Promise.resolve(null),
    canManageIntegrations
      ? prisma.organizationTikTokAccount.findMany({
          where: {
            organizationId: membership.organizationId,
          },
          orderBy: [{ updatedAt: "desc" }],
          take: 3,
        })
      : Promise.resolve([]),
    canManageIntegrations
      ? prisma.creatorMessageThread.findMany({
          where: {
            organizationId: membership.organizationId,
          },
          orderBy: [{ updatedAt: "desc" }],
          take: 10,
          select: {
            id: true,
            channel: true,
            state: true,
            lastInboundAt: true,
            lastOutboundAt: true,
            creator: {
              select: {
                displayName: true,
              },
            },
          },
        })
      : Promise.resolve([]),
    canManageIntegrations
      ? prisma.creatorMessageEvent.findMany({
          where: {
            organizationId: membership.organizationId,
          },
          orderBy: [{ createdAt: "desc" }],
          take: 10,
          select: {
            id: true,
            direction: true,
            channel: true,
            body: true,
            parseStatus: true,
            deliveryStatus: true,
            createdAt: true,
            creator: {
              select: {
                displayName: true,
              },
            },
          },
        })
      : Promise.resolve([]),
  ]);

  return {
    membership,
    canManageIntegrations,
    twilioConfig,
    tiktokAccounts,
    recentThreads,
    recentEvents,
  };
}
