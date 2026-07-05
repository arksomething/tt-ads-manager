import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/db";
import { requireOrganizationMembership } from "@/server/auth/organizations";
import { canManageCreatorDeals } from "@/server/auth/roles";
import { getCampaignAccess } from "@/server/campaigns/queries";

import {
  deleteCampaignCreatorDealSchema,
  deleteCampaignCreatorVideoDealSchema,
  upsertCampaignCreatorDealSchema,
  upsertCampaignCreatorVideoDealSchema,
} from "./schemas";

function revalidatePayoutWorkspace(organizationSlug: string) {
  revalidatePath("/app");
  revalidatePath(`/org/${organizationSlug}`);
  revalidatePath(`/org/${organizationSlug}/payouts`);
  revalidatePath(`/org/${organizationSlug}/creators`);
  revalidatePath(`/org/${organizationSlug}/ugc-pay`);
  revalidatePath(`/org/${organizationSlug}/blazie`);
  revalidatePath(`/org/${organizationSlug}/campaigns`);
}

async function assertDealWriteAccess(args: {
  organizationSlug: string;
  campaignCreatorId: string;
}) {
  const membership = await requireOrganizationMembership(args.organizationSlug);
  const campaignCreator = await prisma.campaignCreator.findFirst({
    where: {
      id: args.campaignCreatorId,
      campaign: {
        organizationId: membership.organizationId,
      },
    },
    select: {
      campaignId: true,
    },
  });

  if (!campaignCreator) {
    throw new Error("Campaign creator link not found in this organization.");
  }

  const campaignAccess = await getCampaignAccess(
    args.organizationSlug,
    campaignCreator.campaignId,
  );

  if (!canManageCreatorDeals(membership.role) && !campaignAccess.canManageCampaign) {
    throw new Error("Deal edit access denied.");
  }

  return {
    membership,
    campaignId: campaignCreator.campaignId,
  };
}

function rangesOverlap(args: {
  leftStart: Date;
  leftEnd: Date | null | undefined;
  rightStart: Date;
  rightEnd: Date | null | undefined;
}) {
  const leftEnd = args.leftEnd ?? null;
  const rightEnd = args.rightEnd ?? null;

  return args.leftStart <= (rightEnd ?? new Date(8_640_000_000_000_000)) &&
    args.rightStart <= (leftEnd ?? new Date(8_640_000_000_000_000));
}

async function assertNoOverlappingCreatorDeal(args: {
  campaignCreatorId: string;
  effectiveStartDate: Date;
  effectiveEndDate: Date | null | undefined;
  excludingDealId?: string;
}) {
  const existingDeals = await prisma.campaignCreatorDeal.findMany({
    where: {
      campaignCreatorId: args.campaignCreatorId,
      ...(args.excludingDealId
        ? {
            id: {
              not: args.excludingDealId,
            },
          }
        : {}),
    },
    select: {
      id: true,
      effectiveStartDate: true,
      effectiveEndDate: true,
    },
  });
  const overlappingDeal = existingDeals.find((deal) =>
    rangesOverlap({
      leftStart: args.effectiveStartDate,
      leftEnd: args.effectiveEndDate ?? null,
      rightStart: deal.effectiveStartDate as Date,
      rightEnd: (deal.effectiveEndDate as Date | null) ?? null,
    }),
  );

  if (overlappingDeal) {
    throw new Error(
      "Creator deal dates overlap an existing deal. End the prior deal before this start date, or edit that deal period.",
    );
  }
}

function getCampaignCreatorDealData(values: ReturnType<typeof upsertCampaignCreatorDealSchema.parse>) {
  return {
    currency: values.currency,
    effectiveStartDate: values.effectiveStartDate,
    effectiveEndDate: values.effectiveEndDate ?? null,
    fixedFee: values.fixedFee ?? null,
    fixedFeeRecognitionDate: values.fixedFeeRecognitionDate ?? null,
    fixedFeePerVideo: values.fixedFeePerVideo ?? null,
    cpmAmount: values.cpmAmount ?? null,
    paidTrafficMetric: values.paidTrafficMetric,
    deductPaidTraffic: values.deductPaidTraffic,
    viewCapPerVideo: values.viewCapPerVideo ?? null,
    viewWindowDays: values.viewWindowDays,
    payoutCapPerVideo: values.payoutCapPerVideo,
    perVideoCapScope: values.perVideoCapScope,
    payoutCapTotal: values.payoutCapTotal ?? null,
    notes: values.notes ?? null,
  };
}

export async function upsertCampaignCreatorDealForOrganization(args: {
  organizationSlug: string;
  input: unknown;
}) {
  const values = upsertCampaignCreatorDealSchema.parse(args.input);
  const { membership } = await assertDealWriteAccess({
    organizationSlug: args.organizationSlug,
    campaignCreatorId: values.campaignCreatorId,
  });
  await assertNoOverlappingCreatorDeal({
    campaignCreatorId: values.campaignCreatorId,
    effectiveStartDate: values.effectiveStartDate,
    effectiveEndDate: values.effectiveEndDate,
    excludingDealId: values.dealId,
  });
  const dealData = getCampaignCreatorDealData(values);

  if (values.dealId) {
    const existingDeal = await prisma.campaignCreatorDeal.findFirst({
      where: {
        id: values.dealId,
        campaignCreatorId: values.campaignCreatorId,
        organizationId: membership.organizationId,
      },
      select: {
        id: true,
      },
    });

    if (!existingDeal) {
      throw new Error("Creator deal period not found in this organization.");
    }

    const deal = await prisma.campaignCreatorDeal.update({
      where: {
        id: values.dealId,
      },
      data: dealData,
    });

    revalidatePayoutWorkspace(args.organizationSlug);

    return deal;
  }

  const deal = await prisma.campaignCreatorDeal.create({
    data: {
      organizationId: membership.organizationId,
      campaignCreatorId: values.campaignCreatorId,
      ...dealData,
    },
  });

  revalidatePayoutWorkspace(args.organizationSlug);

  return deal;
}

export async function deleteCampaignCreatorDealForOrganization(args: {
  organizationSlug: string;
  input: unknown;
}) {
  const values = deleteCampaignCreatorDealSchema.parse(args.input);
  await assertDealWriteAccess({
    organizationSlug: args.organizationSlug,
    campaignCreatorId: values.campaignCreatorId,
  });

  await prisma.campaignCreatorDeal.deleteMany({
    where: {
      campaignCreatorId: values.campaignCreatorId,
      ...(values.dealId
        ? {
            id: values.dealId,
          }
        : {}),
    },
  });

  revalidatePayoutWorkspace(args.organizationSlug);

  return {
    campaignCreatorId: values.campaignCreatorId,
  };
}

export async function upsertCampaignCreatorVideoDealForOrganization(args: {
  organizationSlug: string;
  input: unknown;
}) {
  const values = upsertCampaignCreatorVideoDealSchema.parse(args.input);
  const { membership } = await assertDealWriteAccess({
    organizationSlug: args.organizationSlug,
    campaignCreatorId: values.campaignCreatorId,
  });

  const deal = await prisma.campaignCreatorVideoDeal.upsert({
    where: {
      campaignCreatorId_sourceVideoId: {
        campaignCreatorId: values.campaignCreatorId,
        sourceVideoId: values.sourceVideoId,
      },
    },
    update: {
      fixedFeePerVideo: values.fixedFeePerVideo ?? null,
      cpmAmount: values.cpmAmount ?? null,
      paidTrafficMetric: values.paidTrafficMetric,
      deductPaidTraffic: values.deductPaidTraffic,
      viewCapPerVideo: values.viewCapPerVideo ?? null,
      payoutCapPerVideo: values.payoutCapPerVideo,
      perVideoCapScope: values.perVideoCapScope,
      notes: values.notes ?? null,
    },
    create: {
      organizationId: membership.organizationId,
      campaignCreatorId: values.campaignCreatorId,
      sourceVideoId: values.sourceVideoId,
      fixedFeePerVideo: values.fixedFeePerVideo ?? null,
      cpmAmount: values.cpmAmount ?? null,
      paidTrafficMetric: values.paidTrafficMetric,
      deductPaidTraffic: values.deductPaidTraffic,
      viewCapPerVideo: values.viewCapPerVideo ?? null,
      payoutCapPerVideo: values.payoutCapPerVideo,
      perVideoCapScope: values.perVideoCapScope,
      notes: values.notes ?? null,
    },
  });

  revalidatePayoutWorkspace(args.organizationSlug);

  return deal;
}

export async function deleteCampaignCreatorVideoDealForOrganization(args: {
  organizationSlug: string;
  input: unknown;
}) {
  const values = deleteCampaignCreatorVideoDealSchema.parse(args.input);
  await assertDealWriteAccess({
    organizationSlug: args.organizationSlug,
    campaignCreatorId: values.campaignCreatorId,
  });

  await prisma.campaignCreatorVideoDeal.deleteMany({
    where: {
      campaignCreatorId: values.campaignCreatorId,
      sourceVideoId: values.sourceVideoId,
    },
  });

  revalidatePayoutWorkspace(args.organizationSlug);

  return {
    campaignCreatorId: values.campaignCreatorId,
    sourceVideoId: values.sourceVideoId,
  };
}
