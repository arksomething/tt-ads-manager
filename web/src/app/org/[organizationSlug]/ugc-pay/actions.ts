"use server";

import { addCreatorToCampaignForOrganization } from "@/server/creators/mutations";
import {
  deleteCampaignCreatorDealForOrganization,
  deleteCampaignCreatorVideoDealForOrganization,
  upsertCampaignCreatorDealForOrganization,
  upsertCampaignCreatorVideoDealForOrganization,
} from "@/server/payouts/mutations";
import { setVideoTalkingStatusForOrganization } from "@/server/videos/mutations";

type UgcPayDealActionResult =
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

export async function saveCreatorDeal(
  organizationSlug: string,
  formData: FormData,
): Promise<UgcPayDealActionResult> {
  try {
    const createNewDealPeriod = formData.get("createNewDealPeriod") === "on";

    await upsertCampaignCreatorDealForOrganization({
      organizationSlug,
      input: {
        campaignCreatorId: getTrimmedFormValue(formData, "campaignCreatorId"),
        dealId: createNewDealPeriod
          ? undefined
          : getTrimmedFormValue(formData, "dealId") || undefined,
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

    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: getActionErrorMessage(error),
    };
  }
}

export async function clearCreatorDeal(
  organizationSlug: string,
  formData: FormData,
): Promise<UgcPayDealActionResult> {
  try {
    await deleteCampaignCreatorDealForOrganization({
      organizationSlug,
      input: {
        campaignCreatorId: getTrimmedFormValue(formData, "campaignCreatorId"),
        dealId: getTrimmedFormValue(formData, "dealId") || undefined,
      },
    });

    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: getActionErrorMessage(error),
    };
  }
}

export async function saveVideoDeal(
  organizationSlug: string,
  formData: FormData,
): Promise<UgcPayDealActionResult> {
  try {
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

    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: getActionErrorMessage(error),
    };
  }
}

export async function clearVideoDeal(
  organizationSlug: string,
  formData: FormData,
): Promise<UgcPayDealActionResult> {
  try {
    await deleteCampaignCreatorVideoDealForOrganization({
      organizationSlug,
      input: {
        campaignCreatorId: getTrimmedFormValue(formData, "campaignCreatorId"),
        sourceVideoId: getTrimmedFormValue(formData, "sourceVideoId"),
      },
    });

    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: getActionErrorMessage(error),
    };
  }
}

export async function addCreatorToUgcPay(
  organizationSlug: string,
  formData: FormData,
): Promise<UgcPayDealActionResult> {
  try {
    await addCreatorToCampaignForOrganization({
      organizationSlug,
      input: {
        campaignId: getTrimmedFormValue(formData, "campaignId"),
        displayName: getTrimmedFormValue(formData, "displayName") || undefined,
        tiktokHandle: getTrimmedFormValue(formData, "tiktokHandle"),
      },
    });

    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: getActionErrorMessage(error),
    };
  }
}

export async function setUgcPayVideoTalkingStatus(
  organizationSlug: string,
  formData: FormData,
): Promise<UgcPayDealActionResult> {
  try {
    await setVideoTalkingStatusForOrganization({
      organizationSlug,
      input: {
        action: getTrimmedFormValue(formData, "action"),
        platform: getTrimmedFormValue(formData, "platform") || undefined,
        sourceVideoId: getTrimmedFormValue(formData, "sourceVideoId"),
      },
    });

    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: getActionErrorMessage(error),
    };
  }
}
