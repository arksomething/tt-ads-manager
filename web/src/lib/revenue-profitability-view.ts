export type RevenueProfitabilityProceedsModel =
  | "cohorted_all"
  | "new_proceeds";

export function getRevenueProfitabilityRoasCopy(
  proceedsModel: RevenueProfitabilityProceedsModel,
) {
  if (proceedsModel === "cohorted_all") {
    return {
      primaryProceedsLabel: "Cohorted proceeds",
      primaryProceedsMetaKind: "cohorted_basis",
      primaryRoasLabel: "Cohorted ROAS",
      primaryRoasMetaProceedsLabel: "cohorted proceeds",
      showNewProceedsRoas: false,
    };
  }

  return {
    primaryProceedsLabel: "Total proceeds",
    primaryProceedsMetaKind: "new_renewal_split",
    primaryRoasLabel: "Blended ROAS",
    primaryRoasMetaProceedsLabel: "total proceeds",
    showNewProceedsRoas: true,
  };
}
