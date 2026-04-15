import { PayoutStatus } from "@/lib/prisma-shim";

import { prisma } from "@/lib/db";

export async function getOrganizationDashboardSummary(organizationId: string) {
  const [
    creatorCount,
    campaignCount,
    videoCount,
    paidPayoutAggregate,
  ] = await Promise.all([
    prisma.creator.count({
      where: {
        organizationId,
      },
    }),
    prisma.campaign.count({
      where: {
        organizationId,
      },
    }),
    prisma.video.count({
      where: {
        creator: {
          organizationId,
        },
      },
    }),
    prisma.payout.aggregate({
      where: {
        organizationId,
        status: PayoutStatus.PAID,
      },
      _sum: {
        amount: true,
      },
    }),
  ]);

  return {
    creatorCount,
    campaignCount,
    videoCount,
    paidPayoutTotal: paidPayoutAggregate._sum.amount ?? 0,
  };
}
