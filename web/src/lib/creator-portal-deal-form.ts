export const CREATOR_PORTAL_ALL_TIME_DEAL_START_DATE = "1970-01-01";

function getTrimmedFormValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

export function getCreatorPortalCreatorDealInput(formData: FormData) {
  return {
    campaignCreatorId: getTrimmedFormValue(formData, "campaignCreatorId"),
    dealId: getTrimmedFormValue(formData, "dealId") || undefined,
    currency: getTrimmedFormValue(formData, "currency") || "USD",
    effectiveStartDate:
      getTrimmedFormValue(formData, "effectiveStartDate") ||
      CREATOR_PORTAL_ALL_TIME_DEAL_START_DATE,
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
    viewWindowDays: getTrimmedFormValue(formData, "viewWindowDays") || undefined,
    payoutCapPerVideo:
      getTrimmedFormValue(formData, "payoutCapPerVideo") || undefined,
    perVideoCapScope:
      getTrimmedFormValue(formData, "perVideoCapScope") || undefined,
    payoutCapTotal:
      getTrimmedFormValue(formData, "payoutCapTotal") || undefined,
    notes: getTrimmedFormValue(formData, "notes") || undefined,
  };
}
