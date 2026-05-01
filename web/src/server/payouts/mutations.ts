import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/db";
import { requireOrganizationMembership } from "@/server/auth/organizations";
import { canManageOrganization } from "@/server/auth/roles";
import { getCampaignAccess } from "@/server/campaigns/queries";

import {
  deleteCampaignCreatorDealSchema,
  upsertCampaignCreatorDealSchema,
} from "./schemas";

function revalidatePayoutWorkspace(organizationSlug: string) {
  revalidatePath("/app");
  revalidatePath(`/org/${organizationSlug}`);
  revalidatePath(`/org/${organizationSlug}/payouts`);
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

  if (
    !canManageOrganization(membership.role) &&
    !campaignAccess.canManageCampaign
  ) {
    throw new Error("Deal edit access denied.");
  }

  return {
    membership,
    campaignId: campaignCreator.campaignId,
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

  const deal = await prisma.campaignCreatorDeal.upsert({
    where: {
      campaignCreatorId: values.campaignCreatorId,
    },
    update: {
      currency: values.currency,
      effectiveStartDate: values.effectiveStartDate,
      effectiveEndDate: values.effectiveEndDate ?? null,
      fixedFee: values.fixedFee ?? null,
      fixedFeeRecognitionDate: values.fixedFeeRecognitionDate ?? null,
      cpmAmount: values.cpmAmount ?? null,
      paidTrafficMetric: values.paidTrafficMetric,
      deductPaidTraffic: values.deductPaidTraffic,
      viewCapPerVideo: values.viewCapPerVideo ?? null,
      viewWindowDays: values.viewWindowDays,
      payoutCapPerVideo: values.payoutCapPerVideo,
      payoutCapTotal: values.payoutCapTotal ?? null,
      notes: values.notes ?? null,
    },
    create: {
      organizationId: membership.organizationId,
      campaignCreatorId: values.campaignCreatorId,
      currency: values.currency,
      effectiveStartDate: values.effectiveStartDate,
      effectiveEndDate: values.effectiveEndDate ?? null,
      fixedFee: values.fixedFee ?? null,
      fixedFeeRecognitionDate: values.fixedFeeRecognitionDate ?? null,
      cpmAmount: values.cpmAmount ?? null,
      paidTrafficMetric: values.paidTrafficMetric,
      deductPaidTraffic: values.deductPaidTraffic,
      viewCapPerVideo: values.viewCapPerVideo ?? null,
      viewWindowDays: values.viewWindowDays,
      payoutCapPerVideo: values.payoutCapPerVideo,
      payoutCapTotal: values.payoutCapTotal ?? null,
      notes: values.notes ?? null,
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
    },
  });

  revalidatePayoutWorkspace(args.organizationSlug);

  return {
    campaignCreatorId: values.campaignCreatorId,
  };
}
