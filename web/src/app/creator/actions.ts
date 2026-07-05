"use server";

import { revalidatePath } from "next/cache";

import {
  canCurrentUserEditCreatorPortalDeals,
  getCurrentCreatorPortalAccess,
} from "@/server/creator-portal/access";
import {
  upsertCampaignCreatorDealForOrganization,
  upsertCampaignCreatorVideoDealForOrganization,
} from "@/server/payouts/mutations";

type CreatorPortalDealActionResult =
  | {
      ok: true;
    }
  | {
      ok: false;
      error: string;
    };

function getTrimmedFormValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function getActionErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong.";
}

async function requireCreatorPortalDealEditAccess(formData: FormData) {
  const access = await getCurrentCreatorPortalAccess();

  if (!access?.campaignCreatorId || !access.campaignCreator?.campaignId) {
    throw new Error("Creator portal access was not found.");
  }

  const campaignCreatorId = getTrimmedFormValue(formData, "campaignCreatorId");

  if (campaignCreatorId !== access.campaignCreatorId) {
    throw new Error("Creator deal edit access denied.");
  }

  const canEdit = await canCurrentUserEditCreatorPortalDeals({
    campaignId: access.campaignCreator.campaignId,
    organizationSlug: access.organization.slug,
  });

  if (!canEdit) {
    throw new Error("Sign in with an authorized account to edit deal terms.");
  }

  return {
    access,
    campaignCreatorId,
    organizationSlug: access.organization.slug,
  };
}

export async function saveCreatorPortalCreatorDeal(
  formData: FormData,
): Promise<CreatorPortalDealActionResult> {
  try {
    const { organizationSlug } = await requireCreatorPortalDealEditAccess(formData);

    await upsertCampaignCreatorDealForOrganization({
      organizationSlug,
      input: {
        campaignCreatorId: getTrimmedFormValue(formData, "campaignCreatorId"),
        dealId: getTrimmedFormValue(formData, "dealId") || undefined,
        currency: getTrimmedFormValue(formData, "currency") || "USD",
        effectiveStartDate: getTrimmedFormValue(formData, "effectiveStartDate"),
        effectiveEndDate:
          getTrimmedFormValue(formData, "effectiveEndDate") || undefined,
        fixedFee: getTrimmedFormValue(formData, "fixedFee") || undefined,
        fixedFeeRecognitionDate:
          getTrimmedFormValue(formData, "fixedFeeRecognitionDate") || undefined,
        fixedFeePerVideo:
          getTrimmedFormValue(formData, "fixedFeePerVideo") || undefined,
        cpmAmount: getTrimmedFormValue(formData, "cpmAmount") || undefined,
        paidTrafficMetric:
          getTrimmedFormValue(formData, "paidTrafficMetric") || undefined,
        deductPaidTraffic: formData.get("deductPaidTraffic") === "on",
        viewCapPerVideo:
          getTrimmedFormValue(formData, "viewCapPerVideo") || undefined,
        viewWindowDays:
          getTrimmedFormValue(formData, "viewWindowDays") || undefined,
        payoutCapPerVideo:
          getTrimmedFormValue(formData, "payoutCapPerVideo") || undefined,
        perVideoCapScope:
          getTrimmedFormValue(formData, "perVideoCapScope") || undefined,
        payoutCapTotal:
          getTrimmedFormValue(formData, "payoutCapTotal") || undefined,
        notes: getTrimmedFormValue(formData, "notes") || undefined,
      },
    });

    revalidatePath("/creator");

    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: getActionErrorMessage(error),
    };
  }
}

export async function saveCreatorPortalVideoDeal(
  formData: FormData,
): Promise<CreatorPortalDealActionResult> {
  try {
    const { organizationSlug } = await requireCreatorPortalDealEditAccess(formData);

    await upsertCampaignCreatorVideoDealForOrganization({
      organizationSlug,
      input: {
        campaignCreatorId: getTrimmedFormValue(formData, "campaignCreatorId"),
        sourceVideoId: getTrimmedFormValue(formData, "sourceVideoId"),
        fixedFeePerVideo:
          getTrimmedFormValue(formData, "fixedFeePerVideo") || undefined,
        cpmAmount: getTrimmedFormValue(formData, "cpmAmount") || undefined,
        paidTrafficMetric:
          getTrimmedFormValue(formData, "paidTrafficMetric") || undefined,
        deductPaidTraffic: formData.get("deductPaidTraffic") === "on",
        viewCapPerVideo:
          getTrimmedFormValue(formData, "viewCapPerVideo") || undefined,
        payoutCapPerVideo:
          getTrimmedFormValue(formData, "payoutCapPerVideo") || undefined,
        perVideoCapScope:
          getTrimmedFormValue(formData, "perVideoCapScope") || undefined,
        notes: getTrimmedFormValue(formData, "notes") || undefined,
      },
    });

    revalidatePath("/creator");

    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: getActionErrorMessage(error),
    };
  }
}
