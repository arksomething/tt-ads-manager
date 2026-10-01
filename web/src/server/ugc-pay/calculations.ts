export type UgcPayPerVideoCapScope = "CPM" | "TOTAL" | "NONE";
export type UgcPayMode = "posted" | "gained";

export type UgcPayCalculationDeal = {
  fixedFeePerVideo: number | null;
  cpmAmount: number;
  paidTrafficMetric: string;
  deductPaidTraffic: boolean;
  viewCapPerVideo: number | null;
  payoutCapPerVideo: number;
  perVideoCapScope: string;
  notes: string | null;
};

export type UgcPayVideoDealOverride = {
  fixedFeePerVideo: number | null;
  cpmAmount: number | null;
  paidTrafficMetric: string;
  deductPaidTraffic: boolean;
  viewCapPerVideo: number | null;
  payoutCapPerVideo: number | null;
  perVideoCapScope: string;
  notes: string | null;
};

export type UgcPayGainedViewCapContext = {
  grossViewsBeforePeriod: number;
  grossViewsAtPeriodEnd: number;
};

export type UgcPayVideoAmountInput = {
  grossViews: number;
  paidStatus: string;
  paidViews: number;
  deal: UgcPayCalculationDeal;
  fixedFeePerVideo: number;
  gainedViewCapContext: UgcPayGainedViewCapContext | null;
  payMode: UgcPayMode;
};

export type UgcPayVideoAmountResult = {
  grossViewsInsideCap: number;
  paidViewsDeducted: number;
  uncappedPayableViews: number;
  payableViews: number;
  cpmAmount: number;
  rawCpmPay: number;
  cpmPay: number;
  videoPay: number;
  viewCapReached: boolean;
};

export const NON_TALKING_VIDEO_CPM_AMOUNT = 0.5;
export const NON_TALKING_VIDEO_PAYOUT_CAP_PER_VIDEO = 100;
// Pre-Jul-20 non-talking terms were $0.50 CPM capped at $300/video. A
// downgraded video posted before the change must take THAT cap — inheriting
// the talking deal's pre-change $100 cap undercapped big non-talking videos
// (mansuhn Jul 2 2026: 543k views paid $100 instead of $271.52).
export const LEGACY_NON_TALKING_VIDEO_PAYOUT_CAP_PER_VIDEO = 300;
// Jul 20 2026 policy: classified non-talking videos take the full non-talking
// terms (CPM and cap) of whichever era the video was posted in.
export const NON_TALKING_VIDEO_CAP_EFFECTIVE_DATE_ONLY = "2026-07-20";
// Announcement 1549797121111236619: applies to posts 24 hours after publication.
export const GOTALL_NON_TALKING_CHANGE_AT = "2026-09-17T15:00:27.511Z";
export const GOTALL_ORGANIZATION_ID = "org_public_tt_ads_manager";

// Older deals use inclusive calendar dates. Explicit intraday boundaries use
// publication instants, so a new rate cannot reprice earlier posts that day.
export function selectUgcPayDealForPublication<T extends {
  effectiveStartDate: Date;
  effectiveEndDate: Date | null;
}>(deals: T[], postedAt: Date | null, postedDateOnly: string): T | null {
  const instant = postedAt?.getTime();
  const matches = deals.filter((deal) => {
    const start = deal.effectiveStartDate;
    const end = deal.effectiveEndDate;
    const midnight = (date: Date) => date.toISOString().slice(11) === "00:00:00.000Z";
    const afterStart = midnight(start)
      ? postedDateOnly >= start.toISOString().slice(0, 10)
      : instant != null && instant >= start.getTime();
    const beforeEnd = !end || (midnight(end)
      ? postedDateOnly <= end.toISOString().slice(0, 10)
      : instant != null && instant <= end.getTime());
    return afterStart && beforeEnd;
  });
  return matches.sort((a, b) => b.effectiveStartDate.getTime() - a.effectiveStartDate.getTime())[0] ?? null;
}

export function normalizeMoney(value: number) {
  // Decimal half-cents must round away from zero. Binary toFixed can turn
  // $18.395 into $18.39, underpaying otherwise identical view-earnings lines.
  // Drop arithmetic noise from e.g. (10 + 1.505) - 10 before cent rounding.
  const absolute = Number(Math.abs(value).toPrecision(15));
  const cents = Math.round((absolute + Number.EPSILON * Math.max(1, absolute)) * 100);
  return (value < 0 ? -cents : cents) / 100;
}

export function applyUgcPayVideoContentTypeCpm<
  TDeal extends UgcPayCalculationDeal,
>(
  deal: TDeal,
  args: {
    isTalking: boolean;
    hasVideoDealOverride: boolean;
    postedDateOnly?: string | null;
    creatorIsTalking?: boolean;
    organizationId?: string;
    postedAt?: Date | string | null;
  },
): TDeal {
  // The non-talking downgrade reprices a mismatched video: a non-talking
  // video paid under a talking creator's terms. Non-talking creators' deals
  // already encode their non-talking pricing (which may be a negotiated
  // special rate), so their videos always pay deal terms as-is.
  if (
    args.isTalking ||
    args.hasVideoDealOverride ||
    args.creatorIsTalking === false
  ) {
    return deal;
  }

  const appliesNonTalkingCap =
    args.postedDateOnly != null &&
    args.postedDateOnly >= NON_TALKING_VIDEO_CAP_EFFECTIVE_DATE_ONLY;

  return {
    ...deal,
    cpmAmount: args.organizationId === GOTALL_ORGANIZATION_ID &&
      args.postedAt != null && new Date(args.postedAt).getTime() >= Date.parse(GOTALL_NON_TALKING_CHANGE_AT)
      ? 0.2 : NON_TALKING_VIDEO_CPM_AMOUNT,
    payoutCapPerVideo: appliesNonTalkingCap
      ? NON_TALKING_VIDEO_PAYOUT_CAP_PER_VIDEO
      : LEGACY_NON_TALKING_VIDEO_PAYOUT_CAP_PER_VIDEO,
    perVideoCapScope: "CPM" as TDeal["perVideoCapScope"],
  };
}

export function applyUgcPayVideoDealOverride<TDeal extends UgcPayCalculationDeal>(
  deal: TDeal,
  videoDeal: UgcPayVideoDealOverride | null,
): TDeal {
  if (!videoDeal) {
    return deal;
  }

  return {
    ...deal,
    fixedFeePerVideo: videoDeal.fixedFeePerVideo,
    cpmAmount: videoDeal.cpmAmount ?? deal.cpmAmount,
    paidTrafficMetric: videoDeal.paidTrafficMetric,
    deductPaidTraffic: videoDeal.deductPaidTraffic,
    viewCapPerVideo: videoDeal.viewCapPerVideo,
    payoutCapPerVideo: videoDeal.payoutCapPerVideo ?? deal.payoutCapPerVideo,
    perVideoCapScope: videoDeal.perVideoCapScope,
    notes: videoDeal.notes ?? deal.notes,
  };
}

export function getUgcPayPerVideoGrossViewCap(args: {
  deal: UgcPayCalculationDeal;
  fixedFeePerVideo: number;
}) {
  const viewCaps: number[] = [];

  if (typeof args.deal.viewCapPerVideo === "number") {
    viewCaps.push(args.deal.viewCapPerVideo);
  }

  if (args.deal.cpmAmount > 0) {
    if (args.deal.perVideoCapScope === "CPM") {
      viewCaps.push((args.deal.payoutCapPerVideo / args.deal.cpmAmount) * 1_000);
    } else if (args.deal.perVideoCapScope === "TOTAL") {
      const cpmCap = Math.max(
        args.deal.payoutCapPerVideo - args.fixedFeePerVideo,
        0,
      );
      viewCaps.push((cpmCap / args.deal.cpmAmount) * 1_000);
    }
  }

  return viewCaps.length > 0 ? Math.min(...viewCaps) : null;
}

function getGrossViewsInsideCap(args: {
  grossViewsInPeriod: number;
  viewCap: number | null;
  context: UgcPayGainedViewCapContext | null;
}) {
  if (!args.context || typeof args.viewCap !== "number") {
    return args.grossViewsInPeriod;
  }

  return Math.max(
    Math.min(args.context.grossViewsAtPeriodEnd, args.viewCap) -
      Math.min(args.context.grossViewsBeforePeriod, args.viewCap),
    0,
  );
}

export function calculateUgcPayVideoAmounts(
  args: UgcPayVideoAmountInput,
): UgcPayVideoAmountResult {
  const perVideoGrossViewCap = getUgcPayPerVideoGrossViewCap({
    deal: args.deal,
    fixedFeePerVideo: args.fixedFeePerVideo,
  });
  const grossViewsInsideCap =
    args.payMode === "gained"
      ? getGrossViewsInsideCap({
          grossViewsInPeriod: args.grossViews,
          viewCap: perVideoGrossViewCap,
          context: args.gainedViewCapContext,
        })
      : args.grossViews;
  const paidViewsDeducted = Math.min(
    args.deal.deductPaidTraffic && args.paidStatus === "yes"
      ? args.paidViews
      : 0,
    grossViewsInsideCap,
  );
  const uncappedPayableViews = Math.max(grossViewsInsideCap - paidViewsDeducted, 0);
  let payableViews = uncappedPayableViews;

  if (typeof args.deal.viewCapPerVideo === "number") {
    payableViews = Math.min(payableViews, args.deal.viewCapPerVideo);
  }

  const rawCpmPay =
    args.deal.cpmAmount > 0 ? (payableViews / 1_000) * args.deal.cpmAmount : 0;
  let cappedCpmPay = rawCpmPay;
  let videoPay = args.fixedFeePerVideo + rawCpmPay;

  if (args.deal.perVideoCapScope === "CPM") {
    cappedCpmPay = Math.min(rawCpmPay, args.deal.payoutCapPerVideo);
    videoPay = args.fixedFeePerVideo + cappedCpmPay;
  } else if (args.deal.perVideoCapScope === "TOTAL") {
    videoPay = Math.min(videoPay, args.deal.payoutCapPerVideo);
    cappedCpmPay = Math.max(videoPay - args.fixedFeePerVideo, 0);
  }

  const viewCapReached =
    grossViewsInsideCap < args.grossViews ||
    payableViews < uncappedPayableViews ||
    videoPay < args.fixedFeePerVideo + rawCpmPay;

  return {
    grossViewsInsideCap,
    paidViewsDeducted,
    uncappedPayableViews,
    payableViews,
    cpmAmount: args.deal.cpmAmount,
    rawCpmPay: normalizeMoney(rawCpmPay),
    cpmPay: normalizeMoney(cappedCpmPay),
    videoPay: normalizeMoney(videoPay),
    viewCapReached,
  };
}
