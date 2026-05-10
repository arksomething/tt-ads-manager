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

export function normalizeMoney(value: number) {
  return Number(value.toFixed(2));
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
