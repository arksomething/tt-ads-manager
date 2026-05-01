import {
  CreatorStatus,
  CreatorDealPerVideoCapScope,
  Platform,
  type CreatorDealPaidTrafficMetric,
} from "@/lib/prisma-shim";

import { prisma } from "@/lib/db";
import { requireOrganizationMembership } from "@/server/auth/organizations";
import {
  getAccessibleCampaignOptionsForMembership,
  getAccessibleCampaignWhere,
} from "@/server/campaigns/queries";
import { type DashboardSearchParams } from "@/server/dashboard/filters";
import {
  getOrganizationViewTallyData,
  type ViewTallyListItem,
} from "@/server/videos/queries";

const DEFAULT_DEAL_CURRENCY = "USD";
const DEFAULT_DEAL_CPM_AMOUNT = 1;
const DEFAULT_DEAL_VIEW_WINDOW_DAYS = 30;
const DEFAULT_DEAL_PAYOUT_CAP_PER_VIDEO = 100;
const VIEW_TALLY_TOP_VIDEO_LIMIT_WARNING_THRESHOLD = 100;

type CampaignCreatorUgcPayRow = {
  id: string;
  campaignId: string;
  creatorId: string;
  campaign: {
    id: string;
    name: string;
  };
  creator: {
    id: string;
    displayName: string;
    platformAccounts: Array<{
      handle: string;
      platform: Platform;
    }>;
  };
  deal: {
    id: string;
    currency: string;
    effectiveStartDate: Date;
    effectiveEndDate: Date | null;
    fixedFee: number | null;
    fixedFeeRecognitionDate: Date | null;
    fixedFeePerVideo: number | null;
    cpmAmount: number | null;
    paidTrafficMetric: CreatorDealPaidTrafficMetric;
    deductPaidTraffic: boolean;
    viewCapPerVideo: number | null;
    viewWindowDays: number | null;
    payoutCapPerVideo: number | null;
    perVideoCapScope: CreatorDealPerVideoCapScope;
    payoutCapTotal: number | null;
    notes: string | null;
  } | null;
};

type ResolvedUgcPayDeal = {
  id: string | null;
  currency: string;
  effectiveStartDate: Date;
  effectiveEndDate: Date | null;
  fixedFee: number | null;
  fixedFeeRecognitionDate: Date | null;
  fixedFeePerVideo: number | null;
  cpmAmount: number;
  deductPaidTraffic: boolean;
  viewCapPerVideo: number | null;
  viewWindowDays: number;
  payoutCapPerVideo: number;
  perVideoCapScope: CreatorDealPerVideoCapScope;
  payoutCapTotal: number | null;
  notes: string | null;
  isDefault: boolean;
};

type CreatorAccumulator = {
  campaignCreator: CampaignCreatorUgcPayRow;
  deal: ResolvedUgcPayDeal;
  hasCustomDeal: boolean;
  fixedPay: number;
  grossViews: number;
  paidViewsDeducted: number;
  payableViews: number;
  videoPayBeforeCreatorCap: number;
  unknownPaidVideoCount: number;
  exactPaidVideoCount: number;
  videoCapReached: boolean;
  creatorTotalCapApplied: boolean;
  videos: UgcPayVideoRow[];
};

export type UgcPayVideoRow = {
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
  cpmPay: number;
  videoPay: number;
  viewCapReached: boolean;
  creatorTotalCapApplied: boolean;
  paidStatus: ViewTallyListItem["paidStatus"];
  matchedAdIds: string[];
};

export type UgcPayCreatorRow = {
  campaignCreatorId: string;
  campaignId: string;
  campaignName: string;
  creatorId: string;
  creatorName: string;
  tiktokHandle: string | null;
  hasCustomDeal: boolean;
  currency: string;
  deal: ResolvedUgcPayDeal;
  grossViews: number;
  paidViewsDeducted: number;
  payableViews: number;
  fixedPay: number;
  videoPay: number;
  totalPay: number;
  videoCount: number;
  exactPaidVideoCount: number;
  unknownPaidVideoCount: number;
  videoCapReached: boolean;
  creatorTotalCapApplied: boolean;
  videos: UgcPayVideoRow[];
};

export type OrganizationUgcPayData = {
  campaignOptions: Array<{
    id: string;
    label: string;
  }>;
  selectedCampaignId: string | null;
  selectedCampaignLabel: string | null;
  startDate: string;
  endDate: string;
  warnings: string[];
  errorMessage: string | null;
  summary: {
    totalPay: number;
    fixedPay: number;
    videoPay: number;
    grossViews: number;
    paidViewsDeducted: number;
    payableViews: number;
    creators: number;
    videos: number;
    customDeals: number;
    exactPaidVideos: number;
    unknownPaidVideos: number;
    unmatchedVideos: number;
  };
  creators: UgcPayCreatorRow[];
  videos: UgcPayVideoRow[];
};

function getSearchParamValue(
  searchParams: DashboardSearchParams | undefined,
  key: string,
) {
  const value = searchParams?.[key];
  return Array.isArray(value) ? value[0] : value;
}

function toDateOnlyString(value: Date) {
  return value.toISOString().slice(0, 10);
}

function parseDateOnly(value: string) {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function startOfUtcDay(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function getDateOnlySearchParam(
  searchParams: DashboardSearchParams | undefined,
  key: string,
) {
  const rawValue = getSearchParamValue(searchParams, key);

  if (!rawValue || !/^\d{4}-\d{2}-\d{2}$/.test(rawValue)) {
    return null;
  }

  return rawValue;
}

function getDefaultReportDate() {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - 1);
  return toDateOnlyString(date);
}

function getSelectedDateRange(searchParams: DashboardSearchParams | undefined) {
  const fallbackDate = getDefaultReportDate();
  const startDate = getDateOnlySearchParam(searchParams, "startDate") ?? fallbackDate;
  const endDate = getDateOnlySearchParam(searchParams, "endDate") ?? fallbackDate;

  if (endDate < startDate) {
    return {
      startDate: fallbackDate,
      endDate: fallbackDate,
    };
  }

  return {
    startDate,
    endDate,
  };
}

function normalizeMoney(value: number) {
  return Number(value.toFixed(2));
}

function normalizeHandle(value: string | null | undefined) {
  const normalized = value?.trim().replace(/^@/, "").toLowerCase();
  return normalized && normalized.length > 0 ? normalized : null;
}

function normalizeName(value: string | null | undefined) {
  const normalized = value?.trim().replace(/\s+/g, " ").toLowerCase();
  return normalized && normalized.length > 0 ? normalized : null;
}

function setUniqueLookupValue<T>(
  map: Map<string, T | null>,
  key: string | null,
  value: T,
) {
  if (!key) {
    return;
  }

  if (map.has(key)) {
    map.set(key, null);
    return;
  }

  map.set(key, value);
}

function getTikTokHandle(row: CampaignCreatorUgcPayRow) {
  return (
    row.creator.platformAccounts.find((account) => account.platform === Platform.TIKTOK)?.handle ??
    null
  );
}

function isDealActiveInRange(
  deal: NonNullable<CampaignCreatorUgcPayRow["deal"]>,
  start: Date,
  end: Date,
) {
  const dealStart = startOfUtcDay(deal.effectiveStartDate);
  const dealEnd = deal.effectiveEndDate ? startOfUtcDay(deal.effectiveEndDate) : null;

  return dealStart <= end && (!dealEnd || dealEnd >= start);
}

function resolveUgcPayDeal(
  deal: CampaignCreatorUgcPayRow["deal"],
  fallbackStartDate: Date,
): ResolvedUgcPayDeal {
  return {
    id: deal?.id ?? null,
    currency: deal?.currency ?? DEFAULT_DEAL_CURRENCY,
    effectiveStartDate: deal?.effectiveStartDate ?? fallbackStartDate,
    effectiveEndDate: deal?.effectiveEndDate ?? null,
    fixedFee: deal?.fixedFee ?? null,
    fixedFeeRecognitionDate: deal?.fixedFeeRecognitionDate ?? null,
    fixedFeePerVideo: deal?.fixedFeePerVideo ?? null,
    cpmAmount: deal?.cpmAmount ?? DEFAULT_DEAL_CPM_AMOUNT,
    deductPaidTraffic: deal?.deductPaidTraffic ?? true,
    viewCapPerVideo: deal?.viewCapPerVideo ?? null,
    viewWindowDays: Math.max(deal?.viewWindowDays ?? DEFAULT_DEAL_VIEW_WINDOW_DAYS, 1),
    payoutCapPerVideo:
      deal?.payoutCapPerVideo ?? DEFAULT_DEAL_PAYOUT_CAP_PER_VIDEO,
    perVideoCapScope: deal?.perVideoCapScope ?? CreatorDealPerVideoCapScope.CPM,
    payoutCapTotal: deal?.payoutCapTotal ?? null,
    notes: deal?.notes ?? null,
    isDefault: deal == null,
  };
}

function getFixedPayForRange(deal: ResolvedUgcPayDeal, start: Date, end: Date) {
  if (deal.fixedFee == null) {
    return 0;
  }

  const recognitionDate = startOfUtcDay(
    deal.fixedFeeRecognitionDate ?? deal.effectiveStartDate,
  );

  return recognitionDate >= start && recognitionDate <= end ? deal.fixedFee : 0;
}

function calculateVideoPay(args: {
  row: ViewTallyListItem;
  campaignCreator: CampaignCreatorUgcPayRow;
  deal: ResolvedUgcPayDeal;
}): UgcPayVideoRow {
  const grossViews = args.row.views ?? 0;
  const paidViewsDeducted =
    args.deal.deductPaidTraffic && args.row.paidStatus === "yes"
      ? (args.row.paidViews ?? 0)
      : 0;
  const uncappedPayableViews = Math.max(grossViews - paidViewsDeducted, 0);
  let payableViews = uncappedPayableViews;

  if (typeof args.deal.viewCapPerVideo === "number") {
    payableViews = Math.min(payableViews, args.deal.viewCapPerVideo);
  }

  const cpmPay =
    args.deal.cpmAmount > 0 ? (payableViews / 1_000) * args.deal.cpmAmount : 0;
  const fixedFeePerVideo = args.deal.fixedFeePerVideo ?? 0;
  let cappedCpmPay = cpmPay;
  let videoPay = fixedFeePerVideo + cpmPay;

  if (args.deal.perVideoCapScope === CreatorDealPerVideoCapScope.CPM) {
    cappedCpmPay = Math.min(cpmPay, args.deal.payoutCapPerVideo);
    videoPay = fixedFeePerVideo + cappedCpmPay;
  } else if (args.deal.perVideoCapScope === CreatorDealPerVideoCapScope.TOTAL) {
    videoPay = Math.min(videoPay, args.deal.payoutCapPerVideo);
    cappedCpmPay = Math.max(videoPay - fixedFeePerVideo, 0);
  }

  const viewCapReached =
    payableViews < uncappedPayableViews ||
    videoPay < fixedFeePerVideo + cpmPay;

  return {
    campaignCreatorId: args.campaignCreator.id,
    campaignId: args.campaignCreator.campaignId,
    campaignName: args.campaignCreator.campaign.name,
    creatorId: args.campaignCreator.creatorId,
    creatorName: args.campaignCreator.creator.displayName,
    currency: args.deal.currency,
    videoId: args.row.id,
    sourceVideoId: args.row.sourceVideoId,
    videoUrl: args.row.videoUrl,
    titleOrCaption: args.row.titleOrCaption,
    publishedAt: args.row.publishedAt,
    createdAt: args.row.createdAt,
    grossViews,
    paidViewsDeducted,
    payableViews,
    fixedFeePerVideo,
    cpmAmount: args.deal.cpmAmount,
    cpmPay: normalizeMoney(cappedCpmPay),
    videoPay: normalizeMoney(videoPay),
    viewCapReached,
    creatorTotalCapApplied: false,
    paidStatus: args.row.paidStatus,
    matchedAdIds: args.row.matchedAdIds,
  };
}

function getCampaignCreatorForViewTallyRow(args: {
  row: ViewTallyListItem;
  byHandle: Map<string, CampaignCreatorUgcPayRow | null>;
  byName: Map<string, CampaignCreatorUgcPayRow | null>;
}) {
  const directHandleMatch =
    args.byHandle.get(normalizeHandle(args.row.accountHandle) ?? "") ?? null;

  if (directHandleMatch) {
    return directHandleMatch;
  }

  const creatorNameAsHandleMatch =
    args.byHandle.get(normalizeHandle(args.row.creatorName) ?? "") ?? null;

  if (creatorNameAsHandleMatch) {
    return creatorNameAsHandleMatch;
  }

  return args.byName.get(normalizeName(args.row.creatorName) ?? "") ?? null;
}

function getOrCreateAccumulator(args: {
  accumulators: Map<string, CreatorAccumulator>;
  campaignCreator: CampaignCreatorUgcPayRow;
  start: Date;
  end: Date;
}) {
  const existing = args.accumulators.get(args.campaignCreator.id);

  if (existing) {
    return existing;
  }

  const activeCustomDeal =
    args.campaignCreator.deal &&
    isDealActiveInRange(args.campaignCreator.deal, args.start, args.end)
      ? args.campaignCreator.deal
      : null;
  const deal = resolveUgcPayDeal(activeCustomDeal, args.start);
  const accumulator: CreatorAccumulator = {
    campaignCreator: args.campaignCreator,
    deal,
    hasCustomDeal: activeCustomDeal != null,
    fixedPay: normalizeMoney(getFixedPayForRange(deal, args.start, args.end)),
    grossViews: 0,
    paidViewsDeducted: 0,
    payableViews: 0,
    videoPayBeforeCreatorCap: 0,
    unknownPaidVideoCount: 0,
    exactPaidVideoCount: 0,
    videoCapReached: false,
    creatorTotalCapApplied: false,
    videos: [],
  };

  args.accumulators.set(args.campaignCreator.id, accumulator);
  return accumulator;
}

function applyCreatorTotalCap(accumulator: CreatorAccumulator) {
  const cap = accumulator.deal.payoutCapTotal;
  const rawFixedPay = accumulator.fixedPay;
  const rawVideoPay = accumulator.videoPayBeforeCreatorCap;

  if (typeof cap !== "number" || rawFixedPay + rawVideoPay <= cap) {
    accumulator.fixedPay = normalizeMoney(rawFixedPay);
    for (const video of accumulator.videos) {
      video.videoPay = normalizeMoney(video.videoPay);
    }
    return;
  }

  accumulator.creatorTotalCapApplied = true;
  accumulator.fixedPay = normalizeMoney(Math.min(rawFixedPay, cap));
  const availableVideoPay = Math.max(cap - accumulator.fixedPay, 0);
  const scale =
    rawVideoPay > 0 ? Math.min(availableVideoPay / rawVideoPay, 1) : 0;

  for (const video of accumulator.videos) {
    video.videoPay = normalizeMoney(video.videoPay * scale);
    video.creatorTotalCapApplied = true;
  }
}

function buildCreatorRow(accumulator: CreatorAccumulator): UgcPayCreatorRow {
  applyCreatorTotalCap(accumulator);

  const videoPay = normalizeMoney(
    accumulator.videos.reduce((total, video) => total + video.videoPay, 0),
  );
  const totalPay = normalizeMoney(accumulator.fixedPay + videoPay);

  return {
    campaignCreatorId: accumulator.campaignCreator.id,
    campaignId: accumulator.campaignCreator.campaignId,
    campaignName: accumulator.campaignCreator.campaign.name,
    creatorId: accumulator.campaignCreator.creatorId,
    creatorName: accumulator.campaignCreator.creator.displayName,
    tiktokHandle: getTikTokHandle(accumulator.campaignCreator),
    hasCustomDeal: accumulator.hasCustomDeal,
    currency: accumulator.deal.currency,
    deal: accumulator.deal,
    grossViews: accumulator.grossViews,
    paidViewsDeducted: accumulator.paidViewsDeducted,
    payableViews: accumulator.payableViews,
    fixedPay: accumulator.fixedPay,
    videoPay,
    totalPay,
    videoCount: accumulator.videos.length,
    exactPaidVideoCount: accumulator.exactPaidVideoCount,
    unknownPaidVideoCount: accumulator.unknownPaidVideoCount,
    videoCapReached: accumulator.videoCapReached,
    creatorTotalCapApplied: accumulator.creatorTotalCapApplied,
    videos: accumulator.videos.sort(
      (left, right) =>
        right.videoPay - left.videoPay ||
        right.grossViews - left.grossViews ||
        left.creatorName.localeCompare(right.creatorName),
    ),
  };
}

function getEmptyData(args: {
  campaignOptions: OrganizationUgcPayData["campaignOptions"];
  selectedCampaignId: string | null;
  selectedCampaignLabel: string | null;
  startDate: string;
  endDate: string;
  warnings?: string[];
  errorMessage?: string | null;
}): OrganizationUgcPayData {
  return {
    campaignOptions: args.campaignOptions,
    selectedCampaignId: args.selectedCampaignId,
    selectedCampaignLabel: args.selectedCampaignLabel,
    startDate: args.startDate,
    endDate: args.endDate,
    warnings: args.warnings ?? [],
    errorMessage: args.errorMessage ?? null,
    summary: {
      totalPay: 0,
      fixedPay: 0,
      videoPay: 0,
      grossViews: 0,
      paidViewsDeducted: 0,
      payableViews: 0,
      creators: 0,
      videos: 0,
      customDeals: 0,
      exactPaidVideos: 0,
      unknownPaidVideos: 0,
      unmatchedVideos: 0,
    },
    creators: [],
    videos: [],
  };
}

export async function getOrganizationUgcPayData(args: {
  organizationSlug: string;
  searchParams?: DashboardSearchParams;
}): Promise<OrganizationUgcPayData> {
  const membership = await requireOrganizationMembership(args.organizationSlug);
  const campaignOptions = (await getAccessibleCampaignOptionsForMembership(membership)).map(
    (campaign) => ({
      id: campaign.id,
      label: campaign.name,
    }),
  );
  const requestedCampaignId = getSearchParamValue(args.searchParams, "campaign");
  const selectedCampaign =
    campaignOptions.find((campaign) => campaign.id === requestedCampaignId) ??
    campaignOptions[0] ??
    null;
  const { startDate, endDate } = getSelectedDateRange(args.searchParams);
  const start = parseDateOnly(startDate);
  const end = parseDateOnly(endDate);

  if (!start || !end) {
    return getEmptyData({
      campaignOptions,
      selectedCampaignId: selectedCampaign?.id ?? null,
      selectedCampaignLabel: selectedCampaign?.label ?? null,
      startDate,
      endDate,
      errorMessage: "The selected date range was invalid.",
    });
  }

  if (!selectedCampaign) {
    return getEmptyData({
      campaignOptions,
      selectedCampaignId: null,
      selectedCampaignLabel: null,
      startDate,
      endDate,
      warnings: ["Create a campaign before running UGC pay."],
    });
  }

  const campaignCreators = (await prisma.campaignCreator.findMany({
    where: {
      campaignId: selectedCampaign.id,
      campaign: getAccessibleCampaignWhere(membership),
      creator: {
        internalStatus: {
          not: CreatorStatus.ARCHIVED,
        },
      },
    },
    select: {
      id: true,
      campaignId: true,
      creatorId: true,
      campaign: {
        select: {
          id: true,
          name: true,
        },
      },
      creator: {
        select: {
          id: true,
          displayName: true,
          platformAccounts: {
            where: {
              platform: Platform.TIKTOK,
            },
            select: {
              handle: true,
              platform: true,
            },
          },
        },
      },
      deal: {
        select: {
          id: true,
          currency: true,
          effectiveStartDate: true,
          effectiveEndDate: true,
          fixedFee: true,
          fixedFeeRecognitionDate: true,
          fixedFeePerVideo: true,
          cpmAmount: true,
          paidTrafficMetric: true,
          deductPaidTraffic: true,
          viewCapPerVideo: true,
          viewWindowDays: true,
          payoutCapPerVideo: true,
          perVideoCapScope: true,
          payoutCapTotal: true,
          notes: true,
        },
      },
    },
    orderBy: {
      creator: {
        displayName: "asc",
      },
    },
  })) as CampaignCreatorUgcPayRow[];

  const byHandle = new Map<string, CampaignCreatorUgcPayRow | null>();
  const byName = new Map<string, CampaignCreatorUgcPayRow | null>();

  for (const campaignCreator of campaignCreators) {
    setUniqueLookupValue(byName, normalizeName(campaignCreator.creator.displayName), campaignCreator);

    for (const account of campaignCreator.creator.platformAccounts) {
      setUniqueLookupValue(byHandle, normalizeHandle(account.handle), campaignCreator);
    }
  }

  const viewTallyData = await getOrganizationViewTallyData({
    organizationSlug: args.organizationSlug,
    searchParams: {
      startDate,
      endDate,
    },
    includeAdSpend: false,
  });
  const warnings = [...viewTallyData.warnings];
  let unmatchedVideos = 0;

  if (viewTallyData.rows.length >= VIEW_TALLY_TOP_VIDEO_LIMIT_WARNING_THRESHOLD) {
    warnings.push(
      "View Tally returned 100 video rows for this date range. If more videos exist, lower-view rows may not be included in this UGC pay report.",
    );
  }

  const accumulators = new Map<string, CreatorAccumulator>();

  for (const campaignCreator of campaignCreators) {
    const activeCustomDeal =
      campaignCreator.deal && isDealActiveInRange(campaignCreator.deal, start, end)
        ? campaignCreator.deal
        : null;
    const deal = resolveUgcPayDeal(activeCustomDeal, start);
    const fixedPay = normalizeMoney(getFixedPayForRange(deal, start, end));

    if (fixedPay > 0) {
      getOrCreateAccumulator({
        accumulators,
        campaignCreator,
        start,
        end,
      });
    }
  }

  for (const row of viewTallyData.rows) {
    const campaignCreator = getCampaignCreatorForViewTallyRow({
      row,
      byHandle,
      byName,
    });

    if (!campaignCreator) {
      unmatchedVideos += 1;
      continue;
    }

    const accumulator = getOrCreateAccumulator({
      accumulators,
      campaignCreator,
      start,
      end,
    });
    const videoPay = calculateVideoPay({
      row,
      campaignCreator,
      deal: accumulator.deal,
    });

    accumulator.grossViews += videoPay.grossViews;
    accumulator.paidViewsDeducted += videoPay.paidViewsDeducted;
    accumulator.payableViews += videoPay.payableViews;
    accumulator.videoPayBeforeCreatorCap += videoPay.videoPay;
    accumulator.videoCapReached ||= videoPay.viewCapReached;

    if (row.paidStatus === "yes" || row.paidStatus === "no") {
      accumulator.exactPaidVideoCount += 1;
    } else {
      accumulator.unknownPaidVideoCount += 1;
    }

    accumulator.videos.push(videoPay);
  }

  if (unmatchedVideos > 0) {
    warnings.push(
      `${unmatchedVideos} View Tally video${unmatchedVideos === 1 ? "" : "s"} could not be matched to creators in ${selectedCampaign.label}.`,
    );
  }

  const creators = [...accumulators.values()]
    .map(buildCreatorRow)
    .filter((creator) => creator.videoCount > 0 || creator.fixedPay > 0)
    .sort(
      (left, right) =>
        right.totalPay - left.totalPay ||
        right.payableViews - left.payableViews ||
        left.creatorName.localeCompare(right.creatorName),
    );
  const videos = creators
    .flatMap((creator) => creator.videos)
    .sort(
      (left, right) =>
        right.videoPay - left.videoPay ||
        right.grossViews - left.grossViews ||
        left.creatorName.localeCompare(right.creatorName),
    );
  const fixedPay = creators.reduce((total, creator) => total + creator.fixedPay, 0);
  const videoPay = videos.reduce((total, video) => total + video.videoPay, 0);

  return {
    campaignOptions,
    selectedCampaignId: selectedCampaign.id,
    selectedCampaignLabel: selectedCampaign.label,
    startDate: viewTallyData.startDate,
    endDate: viewTallyData.endDate,
    warnings: [...new Set(warnings)],
    errorMessage: viewTallyData.errorMessage,
    summary: {
      totalPay: normalizeMoney(fixedPay + videoPay),
      fixedPay: normalizeMoney(fixedPay),
      videoPay: normalizeMoney(videoPay),
      grossViews: creators.reduce((total, creator) => total + creator.grossViews, 0),
      paidViewsDeducted: creators.reduce(
        (total, creator) => total + creator.paidViewsDeducted,
        0,
      ),
      payableViews: creators.reduce((total, creator) => total + creator.payableViews, 0),
      creators: creators.length,
      videos: videos.length,
      customDeals: creators.filter((creator) => creator.hasCustomDeal).length,
      exactPaidVideos: creators.reduce(
        (total, creator) => total + creator.exactPaidVideoCount,
        0,
      ),
      unknownPaidVideos: creators.reduce(
        (total, creator) => total + creator.unknownPaidVideoCount,
        0,
      ),
      unmatchedVideos,
    },
    creators,
    videos,
  };
}
