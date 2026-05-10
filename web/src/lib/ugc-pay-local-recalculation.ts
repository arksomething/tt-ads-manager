import {
  calculateUgcPayVideoAmounts,
  normalizeMoney,
  type UgcPayVideoDealOverride,
} from "../server/ugc-pay/calculations.ts";

type UgcPayMode = "posted" | "gained";
type UgcPayPaidStatus = "yes" | "no" | "unknown" | "unsupported";
type UgcPayPaidTrafficMetric = "IMPRESSIONS" | "VIDEO_PLAY_ACTIONS";
type UgcPayPerVideoCapScope = "CPM" | "TOTAL" | "NONE";

const CreatorDealPaidTrafficMetric = {
  IMPRESSIONS: "IMPRESSIONS",
  VIDEO_PLAY_ACTIONS: "VIDEO_PLAY_ACTIONS",
} as const;

const CreatorDealPerVideoCapScope = {
  CPM: "CPM",
  NONE: "NONE",
  TOTAL: "TOTAL",
} as const;

type UgcPayDeal = {
  id: string | null;
  currency: string;
  effectiveStartDate: Date;
  effectiveEndDate: Date | null;
  fixedFee: number | null;
  fixedFeeRecognitionDate: Date | null;
  fixedFeePerVideo: number | null;
  cpmAmount: number;
  paidTrafficMetric: UgcPayPaidTrafficMetric;
  deductPaidTraffic: boolean;
  viewCapPerVideo: number | null;
  viewWindowDays: number;
  payoutCapPerVideo: number;
  perVideoCapScope: UgcPayPerVideoCapScope;
  payoutCapTotal: number | null;
  notes: string | null;
  isDefault: boolean;
};

type UgcPayVideoRow = {
  campaignCreatorId: string;
  campaignId: string;
  campaignName: string;
  creatorId: string;
  creatorName: string;
  currency: string;
  videoId: string;
  sourceVideoId: string;
  videoUrl: string;
  titleOrCaption: string | null;
  publishedAt: Date | null;
  createdAt: Date;
  grossViews: number;
  paidViewsDeducted: number;
  payableViews: number;
  fixedFeePerVideo: number;
  cpmAmount: number;
  paidTrafficMetric: UgcPayPaidTrafficMetric;
  deductPaidTraffic: boolean;
  viewCapPerVideo: number | null;
  payoutCapPerVideo: number;
  perVideoCapScope: UgcPayPerVideoCapScope;
  hasVideoDealOverride: boolean;
  videoDealId: string | null;
  videoDealNotes: string | null;
  cpmPay: number;
  videoPay: number;
  viewCapReached: boolean;
  creatorTotalCapApplied: boolean;
  paidStatus: UgcPayPaidStatus;
  matchedAdIds: string[];
};

type UgcPayCreatorRow = {
  campaignCreatorId: string;
  campaignId: string;
  campaignName: string;
  creatorId: string;
  creatorName: string;
  tiktokHandle: string | null;
  hasCustomDeal: boolean;
  currency: string;
  deal: UgcPayDeal;
  defaultDeal: UgcPayDeal;
  grossViews: number;
  paidViewsDeducted: number;
  payableViews: number;
  fixedPay: number;
  videoPay: number;
  totalPay: number;
  videoCount: number;
  exactPaidVideoCount: number;
  unknownPaidVideoCount: number;
  videoDealOverrideCount: number;
  videoCapReached: boolean;
  creatorTotalCapApplied: boolean;
  videos: UgcPayVideoRow[];
};

type RecalculateCreatorOptions = {
  startDate: string;
  endDate: string;
  payMode: UgcPayMode;
};

function getTrimmedFormValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function coerceDate(value: Date | string | null | undefined) {
  if (!value) {
    return null;
  }

  const parsedValue = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsedValue.getTime()) ? null : parsedValue;
}

function parseDate(value: string, fallback: Date | string | null) {
  if (!value) {
    return coerceDate(fallback);
  }

  const parsedValue = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsedValue.getTime()) ? coerceDate(fallback) : parsedValue;
}

function parseOptionalNumber(value: string) {
  if (!value) {
    return null;
  }

  const parsedValue = Number(value);
  return Number.isFinite(parsedValue) ? parsedValue : null;
}

function parseRequiredNumber(value: string, fallback: number) {
  const parsedValue = Number(value);
  return Number.isFinite(parsedValue) ? parsedValue : fallback;
}

function parsePaidTrafficMetric(
  value: string,
  fallback: UgcPayDeal["paidTrafficMetric"],
) {
  return Object.values(CreatorDealPaidTrafficMetric).includes(
    value as (typeof CreatorDealPaidTrafficMetric)[keyof typeof CreatorDealPaidTrafficMetric],
  )
    ? (value as UgcPayDeal["paidTrafficMetric"])
    : fallback;
}

function parsePerVideoCapScope(
  value: string,
  fallback: UgcPayDeal["perVideoCapScope"],
) {
  return Object.values(CreatorDealPerVideoCapScope).includes(
    value as (typeof CreatorDealPerVideoCapScope)[keyof typeof CreatorDealPerVideoCapScope],
  )
    ? (value as UgcPayDeal["perVideoCapScope"])
    : fallback;
}

function startOfUtcDay(value: Date | string) {
  const parsedValue = value instanceof Date ? value : new Date(value);
  return new Date(
    Date.UTC(
      parsedValue.getUTCFullYear(),
      parsedValue.getUTCMonth(),
      parsedValue.getUTCDate(),
    ),
  );
}

function getFixedPayForRange(deal: UgcPayDeal, startDate: string, endDate: string) {
  if (deal.fixedFee == null) {
    return 0;
  }

  const start = startOfUtcDay(`${startDate}T00:00:00.000Z`);
  const end = startOfUtcDay(`${endDate}T00:00:00.000Z`);
  const recognitionDate = startOfUtcDay(
    deal.fixedFeeRecognitionDate ?? deal.effectiveStartDate,
  );

  return recognitionDate >= start && recognitionDate <= end ? deal.fixedFee : 0;
}

function getVideoOverrideFromRow(video: UgcPayVideoRow): UgcPayVideoDealOverride {
  return {
    fixedFeePerVideo: video.fixedFeePerVideo,
    cpmAmount: video.cpmAmount,
    paidTrafficMetric: video.paidTrafficMetric,
    deductPaidTraffic: video.deductPaidTraffic,
    viewCapPerVideo: video.viewCapPerVideo,
    payoutCapPerVideo: video.payoutCapPerVideo,
    perVideoCapScope: video.perVideoCapScope,
    notes: video.videoDealNotes,
  };
}

function recalculateVideo(args: {
  video: UgcPayVideoRow;
  creatorDeal: UgcPayDeal;
  videoOverride: UgcPayVideoDealOverride | null;
  payMode: UgcPayMode;
}) {
  const effectiveDeal: UgcPayDeal = args.videoOverride
    ? {
        ...args.creatorDeal,
        fixedFeePerVideo: args.videoOverride.fixedFeePerVideo,
        cpmAmount: args.videoOverride.cpmAmount ?? args.creatorDeal.cpmAmount,
        paidTrafficMetric: parsePaidTrafficMetric(
          args.videoOverride.paidTrafficMetric,
          args.creatorDeal.paidTrafficMetric,
        ),
        deductPaidTraffic: args.videoOverride.deductPaidTraffic,
        viewCapPerVideo: args.videoOverride.viewCapPerVideo,
        payoutCapPerVideo:
          args.videoOverride.payoutCapPerVideo ?? args.creatorDeal.payoutCapPerVideo,
        perVideoCapScope: parsePerVideoCapScope(
          args.videoOverride.perVideoCapScope,
          args.creatorDeal.perVideoCapScope,
        ),
        notes: args.videoOverride.notes ?? args.creatorDeal.notes,
      }
    : args.creatorDeal;
  const fixedFeePerVideo = effectiveDeal.fixedFeePerVideo ?? 0;
  const amountResult = calculateUgcPayVideoAmounts({
    grossViews: args.video.grossViews,
    paidStatus: args.video.paidStatus,
    paidViews: args.video.paidViewsDeducted,
    deal: effectiveDeal,
    fixedFeePerVideo,
    gainedViewCapContext: null,
    payMode: args.payMode,
  });

  return {
    ...args.video,
    currency: effectiveDeal.currency,
    paidViewsDeducted: amountResult.paidViewsDeducted,
    payableViews: amountResult.payableViews,
    fixedFeePerVideo,
    cpmAmount: amountResult.cpmAmount,
    paidTrafficMetric: effectiveDeal.paidTrafficMetric,
    deductPaidTraffic: effectiveDeal.deductPaidTraffic,
    viewCapPerVideo: effectiveDeal.viewCapPerVideo,
    payoutCapPerVideo: effectiveDeal.payoutCapPerVideo,
    perVideoCapScope: effectiveDeal.perVideoCapScope,
    hasVideoDealOverride: args.videoOverride != null,
    videoDealId: args.videoOverride ? (args.video.videoDealId ?? "local") : null,
    videoDealNotes: args.videoOverride?.notes ?? null,
    cpmPay: amountResult.cpmPay,
    videoPay: amountResult.videoPay,
    viewCapReached: amountResult.viewCapReached,
    creatorTotalCapApplied: false,
  } satisfies UgcPayVideoRow;
}

function applyCreatorTotalCap(args: {
  deal: UgcPayDeal;
  fixedPay: number;
  videos: UgcPayVideoRow[];
}) {
  const rawVideoPay = args.videos.reduce((total, video) => total + video.videoPay, 0);
  const cap = args.deal.payoutCapTotal;

  if (typeof cap !== "number" || args.fixedPay + rawVideoPay <= cap) {
    return {
      fixedPay: normalizeMoney(args.fixedPay),
      videos: args.videos.map((video) => ({
        ...video,
        videoPay: normalizeMoney(video.videoPay),
        creatorTotalCapApplied: false,
      })),
      creatorTotalCapApplied: false,
    };
  }

  const fixedPay = normalizeMoney(Math.min(args.fixedPay, cap));
  const availableVideoPay = Math.max(cap - fixedPay, 0);
  const scale =
    rawVideoPay > 0 ? Math.min(availableVideoPay / rawVideoPay, 1) : 0;

  return {
    fixedPay,
    videos: args.videos.map((video) => ({
      ...video,
      videoPay: normalizeMoney(video.videoPay * scale),
      creatorTotalCapApplied: true,
    })),
    creatorTotalCapApplied: true,
  };
}

function rebuildCreatorRow<TCreator extends UgcPayCreatorRow>(args: {
  creator: TCreator;
  deal: TCreator["deal"];
  hasCustomDeal: boolean;
  videos: UgcPayVideoRow[];
  options: RecalculateCreatorOptions;
}) {
  const fixedPay = getFixedPayForRange(
    args.deal,
    args.options.startDate,
    args.options.endDate,
  );
  const capped = applyCreatorTotalCap({
    deal: args.deal,
    fixedPay,
    videos: args.videos,
  });
  const videos = capped.videos.sort(
    (left, right) =>
      right.videoPay - left.videoPay ||
      right.grossViews - left.grossViews ||
      left.creatorName.localeCompare(right.creatorName),
  );
  const videoPay = normalizeMoney(
    videos.reduce((total, video) => total + video.videoPay, 0),
  );

  return {
    ...args.creator,
    hasCustomDeal: args.hasCustomDeal,
    currency: args.deal.currency,
    deal: args.deal,
    defaultDeal: args.creator.defaultDeal,
    grossViews: videos.reduce((total, video) => total + video.grossViews, 0),
    paidViewsDeducted: videos.reduce(
      (total, video) => total + video.paidViewsDeducted,
      0,
    ),
    payableViews: videos.reduce((total, video) => total + video.payableViews, 0),
    fixedPay: capped.fixedPay,
    videoPay,
    totalPay: normalizeMoney(capped.fixedPay + videoPay),
    videoCount: videos.length,
    videoDealOverrideCount: videos.filter((video) => video.hasVideoDealOverride)
      .length,
    videoCapReached: videos.some((video) => video.viewCapReached),
    creatorTotalCapApplied: capped.creatorTotalCapApplied,
    videos,
  } as TCreator;
}

export function getCreatorDealFromForm<TCreator extends UgcPayCreatorRow>(
  creator: TCreator,
  formData: FormData,
) {
  return {
    ...creator.deal,
    id: creator.deal.id ?? "local",
    currency: getTrimmedFormValue(formData, "currency").toUpperCase() || "USD",
    effectiveStartDate:
      parseDate(
        getTrimmedFormValue(formData, "effectiveStartDate"),
        creator.deal.effectiveStartDate,
      ) ?? creator.deal.effectiveStartDate,
    effectiveEndDate: parseDate(
      getTrimmedFormValue(formData, "effectiveEndDate"),
      null,
    ),
    fixedFee: parseOptionalNumber(getTrimmedFormValue(formData, "fixedFee")),
    fixedFeeRecognitionDate: parseDate(
      getTrimmedFormValue(formData, "fixedFeeRecognitionDate"),
      null,
    ),
    fixedFeePerVideo: parseOptionalNumber(
      getTrimmedFormValue(formData, "fixedFeePerVideo"),
    ),
    cpmAmount: parseRequiredNumber(
      getTrimmedFormValue(formData, "cpmAmount"),
      creator.deal.cpmAmount,
    ),
    paidTrafficMetric: parsePaidTrafficMetric(
      getTrimmedFormValue(formData, "paidTrafficMetric"),
      creator.deal.paidTrafficMetric,
    ),
    deductPaidTraffic: formData.get("deductPaidTraffic") === "on",
    viewCapPerVideo: parseOptionalNumber(
      getTrimmedFormValue(formData, "viewCapPerVideo"),
    ),
    viewWindowDays: Math.max(
      parseRequiredNumber(
        getTrimmedFormValue(formData, "viewWindowDays"),
        creator.deal.viewWindowDays,
      ),
      1,
    ),
    payoutCapPerVideo: parseRequiredNumber(
      getTrimmedFormValue(formData, "payoutCapPerVideo"),
      creator.deal.payoutCapPerVideo,
    ),
    perVideoCapScope: parsePerVideoCapScope(
      getTrimmedFormValue(formData, "perVideoCapScope"),
      creator.deal.perVideoCapScope,
    ),
    payoutCapTotal: parseOptionalNumber(
      getTrimmedFormValue(formData, "payoutCapTotal"),
    ),
    notes: getTrimmedFormValue(formData, "notes") || null,
    isDefault: false,
  } as TCreator["deal"];
}

export function getVideoDealOverrideFromForm(
  video: UgcPayVideoRow,
  formData: FormData,
) {
  return {
    fixedFeePerVideo: parseOptionalNumber(
      getTrimmedFormValue(formData, "fixedFeePerVideo"),
    ),
    cpmAmount: parseRequiredNumber(
      getTrimmedFormValue(formData, "cpmAmount"),
      video.cpmAmount,
    ),
    paidTrafficMetric: parsePaidTrafficMetric(
      getTrimmedFormValue(formData, "paidTrafficMetric"),
      video.paidTrafficMetric,
    ),
    deductPaidTraffic: formData.get("deductPaidTraffic") === "on",
    viewCapPerVideo: parseOptionalNumber(
      getTrimmedFormValue(formData, "viewCapPerVideo"),
    ),
    payoutCapPerVideo: parseRequiredNumber(
      getTrimmedFormValue(formData, "payoutCapPerVideo"),
      video.payoutCapPerVideo,
    ),
    perVideoCapScope: parsePerVideoCapScope(
      getTrimmedFormValue(formData, "perVideoCapScope"),
      video.perVideoCapScope,
    ),
    notes: getTrimmedFormValue(formData, "notes") || null,
  } satisfies UgcPayVideoDealOverride;
}

export function recalculateCreatorWithDeal<TCreator extends UgcPayCreatorRow>(args: {
  creator: TCreator;
  deal: TCreator["deal"];
  hasCustomDeal: boolean;
  options: RecalculateCreatorOptions;
}) {
  const videos = args.creator.videos.map((video) =>
    recalculateVideo({
      video,
      creatorDeal: args.deal,
      videoOverride: video.hasVideoDealOverride ? getVideoOverrideFromRow(video) : null,
      payMode: args.options.payMode,
    }),
  );

  return rebuildCreatorRow({
    creator: args.creator,
    deal: args.deal,
    hasCustomDeal: args.hasCustomDeal,
    videos,
    options: args.options,
  });
}

export function recalculateCreatorWithVideoDeal<TCreator extends UgcPayCreatorRow>(args: {
  creator: TCreator;
  sourceVideoId: string;
  videoOverride: UgcPayVideoDealOverride | null;
  options: RecalculateCreatorOptions;
}) {
  const videos = args.creator.videos.map((video) =>
    video.sourceVideoId === args.sourceVideoId
      ? recalculateVideo({
          video,
          creatorDeal: args.creator.deal,
          videoOverride: args.videoOverride,
          payMode: args.options.payMode,
        })
      : video,
  );

  return rebuildCreatorRow({
    creator: args.creator,
    deal: args.creator.deal,
    hasCustomDeal: args.creator.hasCustomDeal,
    videos,
    options: args.options,
  });
}

export function getUgcPaySummaryFromCreators(args: {
  creators: UgcPayCreatorRow[];
  unmatchedVideos: number;
}) {
  const videos = args.creators.flatMap((creator) => creator.videos);
  const fixedPay = args.creators.reduce(
    (total, creator) => total + creator.fixedPay,
    0,
  );
  const videoPay = videos.reduce((total, video) => total + video.videoPay, 0);

  return {
    totalPay: normalizeMoney(fixedPay + videoPay),
    fixedPay: normalizeMoney(fixedPay),
    videoPay: normalizeMoney(videoPay),
    grossViews: args.creators.reduce(
      (total, creator) => total + creator.grossViews,
      0,
    ),
    paidViewsDeducted: args.creators.reduce(
      (total, creator) => total + creator.paidViewsDeducted,
      0,
    ),
    payableViews: args.creators.reduce(
      (total, creator) => total + creator.payableViews,
      0,
    ),
    creators: args.creators.length,
    videos: videos.length,
    customDeals: args.creators.filter((creator) => creator.hasCustomDeal).length,
    exactPaidVideos: args.creators.reduce(
      (total, creator) => total + creator.exactPaidVideoCount,
      0,
    ),
    unknownPaidVideos: args.creators.reduce(
      (total, creator) => total + creator.unknownPaidVideoCount,
      0,
    ),
    unmatchedVideos: args.unmatchedVideos,
    videoDealOverrides: args.creators.reduce(
      (total, creator) => total + creator.videoDealOverrideCount,
      0,
    ),
  };
}
