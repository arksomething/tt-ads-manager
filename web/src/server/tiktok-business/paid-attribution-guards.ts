/** Zero delivery cannot create an attribution uncertainty or a paid match. */
export function hasPaidDelivery(row: {metricValue:number}) {
  return Number.isFinite(row.metricValue) && row.metricValue > 0;
}
/** Only genuinely unresolved public-post mappings need an external fallback. */
export function needsPostMapping(group: {itemIds:readonly string[];postBackingStatus:string;totalValue:number}) {
  return group.totalValue > 0 && group.itemIds.length === 0 && group.postBackingStatus !== "non_post_backed";
}

export function getResolvedVideoPaidStatus(args: {
  matchedReportRowCount: number;
  hasAmbiguousMatch: boolean;
  hadAnyPaidRows: boolean;
  hasOpaqueReportRows: boolean;
  hasPendingExternalResolution: boolean;
  unresolvedUnknownGroupCount: number;
  onlyNonPostBackedDelivery: boolean;
}): {
  paidStatus: "yes" | "no" | "unknown" | "unsupported";
  paidStatusReason: "exact_post_match" | "ambiguous_post_mapping" | "no_paid_rows_in_window" | "pending_external_match" | "unresolved_post_mapping" | "no_exact_post_match";
} {
  if (args.matchedReportRowCount > 0) {
    return {
      paidStatus: "yes",
      paidStatusReason: "exact_post_match",
    };
  }

  if (args.hasAmbiguousMatch) {
    return {
      paidStatus: "unknown",
      paidStatusReason: "ambiguous_post_mapping",
    };
  }

  if (!args.hadAnyPaidRows) {
    return {
      paidStatus: "no",
      paidStatusReason: "no_paid_rows_in_window",
    };
  }

  if (args.hasPendingExternalResolution) {
    return {
      paidStatus: "unknown",
      paidStatusReason: "pending_external_match",
    };
  }

  if (args.hasOpaqueReportRows || args.unresolvedUnknownGroupCount > 0) {
    return {
      paidStatus: "unknown",
      paidStatusReason: "unresolved_post_mapping",
    };
  }

  if (args.onlyNonPostBackedDelivery) {
    return {
      paidStatus: "no",
      paidStatusReason: "no_exact_post_match",
    };
  }

  return {
    paidStatus: "no",
    paidStatusReason: "no_exact_post_match",
  };
}
