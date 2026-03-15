import { prisma } from "@/lib/db";

export async function getCampaignWorkspace(campaignId: string) {
  return prisma.campaign.findUnique({
    where: {
      id: campaignId,
    },
    include: {
      organization: true,
      owner: true,
      creators: {
        include: {
          creator: {
            include: {
              platformAccounts: true,
            },
          },
          payouts: true,
        },
        orderBy: {
          createdAt: "desc",
        },
      },
      videos: {
        orderBy: {
          publishedAt: "desc",
        },
        take: 50,
      },
      payouts: {
        orderBy: {
          createdAt: "desc",
        },
      },
    },
  });
}
