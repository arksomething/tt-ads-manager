import {
  CreatorDealPaidTrafficMetric,
  CreatorStatus,
  CreatorDealPerVideoCapScope,
  Platform,
  type Prisma,
} from "@/lib/prisma-shim";

import { prisma } from "@/lib/db";
import { getDefaultUgcPayStartDateForEndDate } from "@/lib/ugc-pay-date-defaults";
import { requireOrganizationMembership } from "@/server/auth/organizations";
import {
  getAccessibleCampaignOptionsForMembership,
  getAccessibleCampaignWhere,
} from "@/server/campaigns/queries";
import { type DashboardSearchParams } from "@/server/dashboard/filters";
import {
  getOrganizationViewTallyData,
  resolveViewTallyCreatorIdForLocalCreator,
  type OrganizationViewTallyData,
  type ViewTallyListItem,
} from "@/server/videos/queries";
import {
  getPaidViewsForSourceVideosForCreatorForOrganization,
  type TikTokSourceVideoPaidViewsResult,
  type TikTokSourceVideoPaidViewsRow,
} from "@/server/tiktok-business/reporting";

import {
  applyUgcPayVideoContentTypeCpm,
  applyUgcPayVideoDealOverride,
  calculateUgcPayVideoAmounts,
  getUgcPayPerVideoGrossViewCap,
  normalizeMoney,
  type UgcPayGainedViewCapContext,
} from "./calculations";
import {
  buildCreatorAccessLedgerVideos,
  buildCreatorAccessViewTallyRows,
  filterCreatorAccessPayableRowsByMode,
  getCreatorAccessMissingSourceVideoCount,
  getCreatorAccessPaidLookupSourceVideoIds,
  type CreatorAccessLocalVideoRow,
  type CreatorAccessPeriodViewRow,
} from "./creator-access-local-videos";

const DEFAULT_DEAL_CURRENCY = "USD";
const DEFAULT_DEAL_CPM_AMOUNT = 1;
const DEFAULT_DEAL_VIEW_WINDOW_DAYS = 7;
const DEFAULT_DEAL_PAYOUT_CAP_PER_VIDEO = 100;
const DEFAULT_GLOBAL_VIEW_WINDOW_DAYS = 7;
const DEFAULT_REPORT_TIME_ZONE = "UTC";
const VIEW_TALLY_TOP_VIDEO_LIMIT_WARNING_THRESHOLD = 100;
const GAINED_VIEW_CAP_CONTEXT_BATCH_SIZE = 150;
const UGC_PAY_CREATOR_QUERY_CONCURRENCY = 2;
const CREATOR_ACCESS_PAID_LOOKUP_TIMEOUT_MS = 4_000;
const CREATOR_ACCESS_PAID_LOOKUP_CACHE_TTL_MS = 5 * 60 * 1_000;

export type UgcPayMode = "posted" | "gained";
export type UgcPayViewWindowMode = "all" | "first-days";
export type UgcPayVideoFetchMode = "global" | "per-creator";

type ViewTallyCreatorOption = OrganizationViewTallyData["creatorOptions"][number];

function normalizeImageUrl(value: string | null | undefined) {
  if (!value) {
    return undefined;
  }

  try {
    const url = new URL(value);

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return undefined;
    }

    return url.toString();
  } catch {
    return undefined;
  }
}

function getJsonString(
  value: Prisma.JsonValue | null | undefined,
  keys: string[],
): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  for (const key of keys) {
    const candidate = value[key];

    if (typeof candidate === "string" && candidate.length > 0) {
      return candidate;
    }
  }

  return undefined;
}

function getAccountImageUrl(payload: Prisma.JsonValue | null | undefined) {
  return normalizeImageUrl(
    getJsonString(payload, [
      "profilePictureUrl",
      "accountProfilePictureUrl",
      "creatorImage",
      "profile_picture_url",
      "account_profile_picture_url",
    ]),
  );
}

function getVideoThumbnailUrl(payload: Prisma.JsonValue | null | undefined) {
  return normalizeImageUrl(
    getJsonString(payload, [
      "thumbnailUrl",
      "thumbnail_url",
      "previewImageUrl",
      "preview_image_url",
    ]),
  );
}

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
  deals: CampaignCreatorDealUgcPayRow[];
};

type CampaignCreatorDealUgcPayRow = {
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
};

type CampaignCreatorVideoDealUgcPayRow = {
  id: string;
  campaignCreatorId: string;
  sourceVideoId: string;
  fixedFeePerVideo: number | null;
  cpmAmount: number | null;
  paidTrafficMetric: CreatorDealPaidTrafficMetric;
  deductPaidTraffic: boolean;
  viewCapPerVideo: number | null;
  payoutCapPerVideo: number | null;
  perVideoCapScope: CreatorDealPerVideoCapScope;
  notes: string | null;
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
  paidTrafficMetric: CreatorDealPaidTrafficMetric;
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
  defaultDeal: ResolvedUgcPayDeal;
  dealPeriods: ResolvedUgcPayDeal[];
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
  videoDealOverrideCount: number;
  dealTotals: Map<
    string,
    {
      deal: ResolvedUgcPayDeal;
      fixedPay: number;
      videoPayBeforeCreatorCap: number;
      videos: UgcPayVideoRow[];
    }
  >;
  videos: UgcPayVideoRow[];
};

type LocalVideoViewCapRow = {
  id: string;
  sourceVideoId: string | null;
  views: number | null;
  lastSyncedAt: Date | null;
};

type LocalVideoContentTypeRow = {
  sourceVideoId: string | null;
  isTalking: boolean;
};

type LocalVideoMetricsSnapshotRow = {
  videoId: string;
  capturedAt: Date;
  views: number | null;
};

type GainedViewCapContext = UgcPayGainedViewCapContext;

type CreatorAccessPaidLookupCacheEntry = {
  expiresAt: number;
  promise: Promise<TikTokSourceVideoPaidViewsResult>;
};

const creatorAccessPaidLookupCache = new Map<
  string,
  CreatorAccessPaidLookupCacheEntry
>();

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
  thumbnailUrl?: string | null;
  titleOrCaption: string | null;
  publishedAt: Date | null;
  createdAt: Date;
  isTalking: boolean;
  grossViews: number;
  paidViews: number | null;
  paidViewsDeducted: number;
  payableViews: number;
  fixedFeePerVideo: number;
  cpmAmount: number;
  paidTrafficMetric: CreatorDealPaidTrafficMetric;
  deductPaidTraffic: boolean;
  viewCapPerVideo: number | null;
  payoutCapPerVideo: number;
  perVideoCapScope: CreatorDealPerVideoCapScope;
  hasVideoDealOverride: boolean;
  videoDealId: string | null;
  videoDealNotes: string | null;
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
  defaultDeal: ResolvedUgcPayDeal;
  dealPeriods: ResolvedUgcPayDeal[];
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

export type OrganizationUgcPayData = {
  campaignOptions: Array<{
    id: string;
    label: string;
  }>;
  selectedCampaignId: string | null;
  selectedCampaignLabel: string | null;
  startDate: string;
  endDate: string;
  payMode: UgcPayMode;
  videoWindowStartDate: string;
  viewWindowMode: UgcPayViewWindowMode;
  videoFetchMode: UgcPayVideoFetchMode;
  globalViewWindowDays: number;
  reportTimeZone: string;
  warnings: string[];
  errorMessage: string | null;
  summary: {
    totalPay: number;
    fixedPay: number;
    videoFixedPay: number;
    cpmPay: number;
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
    videoDealOverrides: number;
  };
  creators: UgcPayCreatorRow[];
  videos: UgcPayVideoRow[];
};

export type UgcPayCreatorAccessScope = {
  organizationId: string;
  creatorId: string;
  campaignCreatorId?: string | null;
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

function toDateOnlyStringInTimeZone(value: Date, timeZone: string) {
  const parts = getDateTimePartsInTimeZone(value, timeZone);
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function parseDateOnly(value: string) {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseDateOnlyParts(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);

  if (!match) {
    return null;
  }

  const [, year, month, day] = match;

  return {
    year: Number(year),
    month: Number(month),
    day: Number(day),
  };
}

function startOfUtcDay(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function addDateOnlyDays(value: string, days: number) {
  const parts = parseDateOnlyParts(value);

  if (!parts) {
    return null;
  }

  const nextValue = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  nextValue.setUTCDate(nextValue.getUTCDate() + days);
  return toDateOnlyString(nextValue);
}

function addDateOnlyMonths(value: string, months: number) {
  const parts = parseDateOnlyParts(value);

  if (!parts) {
    return null;
  }

  const targetMonthStart = new Date(Date.UTC(parts.year, parts.month - 1 + months, 1));
  const targetYear = targetMonthStart.getUTCFullYear();
  const targetMonth = targetMonthStart.getUTCMonth();
  const lastTargetMonthDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const targetDay = Math.min(parts.day, lastTargetMonthDay);

  return toDateOnlyString(new Date(Date.UTC(targetYear, targetMonth, targetDay)));
}

function getReportTimeZone(overrideTimeZone?: string | null) {
  const configuredTimeZone =
    overrideTimeZone?.trim() ||
    process.env.UGC_PAY_REPORT_TIME_ZONE?.trim() ||
    DEFAULT_REPORT_TIME_ZONE;

  try {
    new Intl.DateTimeFormat("en-US", { timeZone: configuredTimeZone }).format(
      new Date(),
    );
    return configuredTimeZone;
  } catch {
    return DEFAULT_REPORT_TIME_ZONE;
  }
}

function getDateTimePartsInTimeZone(value: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(
    formatter
      .formatToParts(value)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );

  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second,
  };
}

function getTimeZoneOffsetMs(value: Date, timeZone: string) {
  const parts = getDateTimePartsInTimeZone(value, timeZone);
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );

  return asUtc - value.getTime();
}

function zonedDateTimeToUtc(args: {
  year: number;
  month: number;
  day: number;
  hour?: number;
  minute?: number;
  second?: number;
  timeZone: string;
}) {
  const utcWallTime = Date.UTC(
    args.year,
    args.month - 1,
    args.day,
    args.hour ?? 0,
    args.minute ?? 0,
    args.second ?? 0,
  );
  let resolved = new Date(utcWallTime);

  for (let index = 0; index < 4; index += 1) {
    const offset = getTimeZoneOffsetMs(resolved, args.timeZone);
    const nextResolved = new Date(utcWallTime - offset);

    if (Math.abs(nextResolved.getTime() - resolved.getTime()) < 1_000) {
      return nextResolved;
    }

    resolved = nextResolved;
  }

  return resolved;
}

function startOfReportTimeZoneDay(value: string, timeZone: string) {
  const parts = parseDateOnlyParts(value);

  if (!parts) {
    return null;
  }

  return zonedDateTimeToUtc({
    ...parts,
    timeZone,
  });
}

function getReportDateRangeBounds(args: {
  startDate: string;
  endDate: string;
  timeZone: string;
}) {
  const endExclusiveDate = addDateOnlyDays(args.endDate, 1);

  if (!endExclusiveDate) {
    return null;
  }

  const start = startOfReportTimeZoneDay(args.startDate, args.timeZone);
  const endExclusive = startOfReportTimeZoneDay(endExclusiveDate, args.timeZone);

  return start && endExclusive ? { start, endExclusive } : null;
}

function getVideoPostedAt(row: ViewTallyListItem) {
  return row.publishedAt ?? row.createdAt ?? null;
}

function isVideoPostedInReportDateRange(args: {
  row: ViewTallyListItem;
  start: Date;
  endExclusive: Date;
}) {
  const postedAt = getVideoPostedAt(args.row);

  return postedAt ? postedAt >= args.start && postedAt < args.endExclusive : false;
}

function isVideoPostedInVideoWindow(args: {
  row: ViewTallyListItem;
  start: Date;
  endExclusive: Date;
}) {
  return isVideoPostedInReportDateRange(args);
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

function getDefaultReportDate(timeZone: string) {
  const reportToday = toDateOnlyStringInTimeZone(new Date(), timeZone);
  return addDateOnlyDays(reportToday, -1) ?? reportToday;
}

function getSelectedDateRange(
  searchParams: DashboardSearchParams | undefined,
  timeZone: string,
) {
  const fallbackEndDate = getDefaultReportDate(timeZone);
  const endDate = getDateOnlySearchParam(searchParams, "endDate") ?? fallbackEndDate;
  const fallbackStartDate = getDefaultUgcPayStartDateForEndDate(endDate);
  const startDate =
    getDateOnlySearchParam(searchParams, "startDate") ?? fallbackStartDate;

  if (endDate < startDate) {
    return {
      startDate: addDateOnlyDays(fallbackEndDate, -6) ?? fallbackEndDate,
      endDate: fallbackEndDate,
    };
  }

  return {
    startDate,
    endDate,
  };
}

function getSelectedPayMode(searchParams: DashboardSearchParams | undefined): UgcPayMode {
  return getSearchParamValue(searchParams, "payMode") === "gained"
    ? "gained"
    : "posted";
}

function getDefaultVideoWindowStartDate(startDate: string) {
  return addDateOnlyDays(startDate, -7) ?? startDate;
}

function getSelectedVideoWindowStartDate(
  searchParams: DashboardSearchParams | undefined,
  startDate: string,
  endDate: string,
) {
  const fallbackDate = getDefaultVideoWindowStartDate(startDate);
  const selectedDate =
    getDateOnlySearchParam(searchParams, "videoWindowStartDate") ?? fallbackDate;

  return selectedDate <= endDate ? selectedDate : fallbackDate;
}

function getSelectedViewWindowMode(
  searchParams: DashboardSearchParams | undefined,
): UgcPayViewWindowMode {
  return getSearchParamValue(searchParams, "viewWindowMode") === "first-days"
    ? "first-days"
    : "all";
}

function getSelectedVideoFetchMode(
  searchParams: DashboardSearchParams | undefined,
): UgcPayVideoFetchMode {
  return getSearchParamValue(searchParams, "videoFetchMode") === "per-creator"
    ? "per-creator"
    : "global";
}

function getSelectedGlobalViewWindowDays(
  searchParams: DashboardSearchParams | undefined,
): number {
  const rawValue = getSearchParamValue(searchParams, "globalViewWindowDays");
  const parsedValue = rawValue ? Number(rawValue) : null;

  if (
    typeof parsedValue === "number" &&
    Number.isInteger(parsedValue) &&
    parsedValue >= 1 &&
    parsedValue <= 365
  ) {
    return parsedValue;
  }

  return DEFAULT_GLOBAL_VIEW_WINDOW_DAYS;
}

function normalizeHandle(value: string | null | undefined) {
  const normalized = value?.trim().replace(/^@/, "").toLowerCase();
  return normalized && normalized.length > 0 ? normalized : null;
}

function normalizeName(value: string | null | undefined) {
  const normalized = value?.trim().replace(/\s+/g, " ").toLowerCase();
  return normalized && normalized.length > 0 ? normalized : null;
}

function chunkArray<T>(values: T[], size: number) {
  const chunks: T[][] = [];

  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }

  return chunks;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>,
) {
  const results: R[] = [];
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(concurrency, 1), items.length);

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        const item = items[currentIndex];

        if (item !== undefined) {
          results[currentIndex] = await mapper(item);
        }
      }
    }),
  );

  return results;
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

function getCampaignCreatorTikTokHandles(row: CampaignCreatorUgcPayRow) {
  return row.creator.platformAccounts
    .filter((account) => account.platform === Platform.TIKTOK)
    .map((account) => normalizeHandle(account.handle))
    .filter((handle): handle is string => Boolean(handle));
}

function getMatchedViewTallyCreatorOptions(args: {
  campaignCreators: CampaignCreatorUgcPayRow[];
  creatorOptions: ViewTallyCreatorOption[];
}) {
  const optionsByHandle = new Map<string, ViewTallyCreatorOption | null>();
  const optionsByName = new Map<string, ViewTallyCreatorOption | null>();

  for (const option of args.creatorOptions) {
    setUniqueLookupValue(optionsByHandle, normalizeHandle(option.meta), option);
    setUniqueLookupValue(optionsByHandle, normalizeHandle(option.label), option);
    setUniqueLookupValue(optionsByName, normalizeName(option.label), option);
  }

  const matchedOptions: ViewTallyCreatorOption[] = [];
  const matchedOptionIds = new Set<string>();
  const unmatchedCampaignCreators: CampaignCreatorUgcPayRow[] = [];

  for (const campaignCreator of args.campaignCreators) {
    const matches = new Map<string, ViewTallyCreatorOption>();

    for (const handle of getCampaignCreatorTikTokHandles(campaignCreator)) {
      const option = optionsByHandle.get(handle) ?? null;

      if (option) {
        matches.set(option.id, option);
      }
    }

    if (matches.size === 0) {
      const option =
        optionsByName.get(normalizeName(campaignCreator.creator.displayName) ?? "") ?? null;

      if (option) {
        matches.set(option.id, option);
      }
    }

    if (matches.size === 0) {
      unmatchedCampaignCreators.push(campaignCreator);
      continue;
    }

    for (const option of matches.values()) {
      if (matchedOptionIds.has(option.id)) {
        continue;
      }

      matchedOptionIds.add(option.id);
      matchedOptions.push(option);
    }
  }

  return {
    matchedOptions,
    unmatchedCampaignCreators,
  };
}

function mergeViewTallyRowsBySourceVideoId(rowGroups: ViewTallyListItem[][]) {
  const rowsBySourceVideoId = new Map<string, ViewTallyListItem>();

  for (const rows of rowGroups) {
    for (const row of rows) {
      const existingRow = rowsBySourceVideoId.get(row.sourceVideoId);

      if (!existingRow || (row.views ?? 0) >= (existingRow.views ?? 0)) {
        rowsBySourceVideoId.set(row.sourceVideoId, row);
      }
    }
  }

  return [...rowsBySourceVideoId.values()].sort(
    (left, right) => (right.views ?? 0) - (left.views ?? 0),
  );
}

function getMatchedViewTallyCreatorOptionsForRows(args: {
  rows: ViewTallyListItem[];
  creatorOptions: ViewTallyCreatorOption[];
}) {
  const optionsByHandle = new Map<string, ViewTallyCreatorOption | null>();
  const optionsByName = new Map<string, ViewTallyCreatorOption | null>();

  for (const option of args.creatorOptions) {
    setUniqueLookupValue(optionsByHandle, normalizeHandle(option.meta), option);
    setUniqueLookupValue(optionsByHandle, normalizeHandle(option.label), option);
    setUniqueLookupValue(optionsByName, normalizeName(option.label), option);
  }

  const matchedOptions: ViewTallyCreatorOption[] = [];
  const matchedOptionIds = new Set<string>();

  for (const row of args.rows) {
    const option =
      optionsByHandle.get(normalizeHandle(row.accountHandle) ?? "") ??
      optionsByHandle.get(normalizeHandle(row.creatorName) ?? "") ??
      optionsByName.get(normalizeName(row.creatorName) ?? "") ??
      null;

    if (!option || matchedOptionIds.has(option.id)) {
      continue;
    }

    matchedOptionIds.add(option.id);
    matchedOptions.push(option);
  }

  return matchedOptions;
}

async function getPerCreatorViewTallyRowsForOptions(args: {
  organizationSlug: string;
  organizationId?: string;
  creatorOptions: ViewTallyCreatorOption[];
  baseData: OrganizationViewTallyData;
  startDate: string;
  endDate: string;
  includePaidViews?: boolean;
  topVideoLimit?: number;
  warningPrefix: string;
}) {
  const warnings: string[] = [];

  if (args.creatorOptions.length === 0) {
    return {
      rows: args.baseData.rows,
      warnings,
    };
  }

  const creatorResults = await mapWithConcurrency(
    args.creatorOptions,
    UGC_PAY_CREATOR_QUERY_CONCURRENCY,
    async (creatorOption) => {
      const data = await getOrganizationViewTallyData({
        organizationSlug: args.organizationSlug,
        organizationId: args.organizationId,
        searchParams: {
          startDate: args.startDate,
          endDate: args.endDate,
          creator: creatorOption.id,
          ...(args.topVideoLimit
            ? { topLimit: String(args.topVideoLimit) }
            : {}),
        },
        includeAdSpend: false,
        includePaidViews: args.includePaidViews,
        includeSummaryAnalytics: false,
        topVideoLimit: args.topVideoLimit,
      });

      return {
        creatorOption,
        data,
      };
    },
  );

  for (const result of creatorResults) {
    warnings.push(...result.data.warnings);

    if (result.data.errorMessage) {
      warnings.push(
        `Could not load ${args.warningPrefix} for ${result.creatorOption.label}: ${result.data.errorMessage}`,
      );
    }

    if (result.data.rows.length >= VIEW_TALLY_TOP_VIDEO_LIMIT_WARNING_THRESHOLD) {
      warnings.push(
        `Viral.app returned 100 videos for ${result.creatorOption.label} from ${args.startDate} to ${args.endDate}. Lower-view videos for this creator may still be missing.`,
      );
    }
  }

  const mergedRows = mergeViewTallyRowsBySourceVideoId([
    args.baseData.rows,
    ...creatorResults.map((result) => result.data.rows),
  ]);

  return {
    rows: mergedRows,
    warnings,
  };
}

async function getPerCreatorViewTallyRows(args: {
  organizationSlug: string;
  organizationId?: string;
  campaignCreators: CampaignCreatorUgcPayRow[];
  baseData: OrganizationViewTallyData;
  startDate: string;
  endDate: string;
  includePaidViews?: boolean;
  topVideoLimit?: number;
}) {
  const { matchedOptions, unmatchedCampaignCreators } =
    getMatchedViewTallyCreatorOptions({
      campaignCreators: args.campaignCreators,
      creatorOptions: args.baseData.creatorOptions,
    });
  const warnings: string[] = [];

  if (matchedOptions.length === 0) {
    return {
      rows: args.baseData.rows,
      warnings: [
        "Accurate creator queries could not find matching tracked TikTok accounts for this campaign.",
      ],
    };
  }

  if (unmatchedCampaignCreators.length > 0) {
    const examples = unmatchedCampaignCreators
      .slice(0, 5)
      .map((creator) => creator.creator.displayName)
      .join(", ");
    warnings.push(
      `Accurate creator queries could not match ${unmatchedCampaignCreators.length} campaign creator${unmatchedCampaignCreators.length === 1 ? "" : "s"} to tracked TikTok accounts${examples ? `: ${examples}` : ""}.`,
    );
  }

  const expandedRows = await getPerCreatorViewTallyRowsForOptions({
    organizationSlug: args.organizationSlug,
    organizationId: args.organizationId,
    creatorOptions: matchedOptions,
    baseData: args.baseData,
    startDate: args.startDate,
    endDate: args.endDate,
    includePaidViews: args.includePaidViews,
    topVideoLimit: args.topVideoLimit,
    warningPrefix: "accurate creator videos",
  });

  warnings.push(...expandedRows.warnings);
  warnings.push(
    `Accurate creator queries checked ${matchedOptions.length} tracked creator account${matchedOptions.length === 1 ? "" : "s"} and expanded the report from ${args.baseData.rows.length} global video row${args.baseData.rows.length === 1 ? "" : "s"} to ${expandedRows.rows.length} merged video row${expandedRows.rows.length === 1 ? "" : "s"}.`,
  );

  return {
    rows: expandedRows.rows,
    warnings,
  };
}

function isDealActiveInRange(
  deal: CampaignCreatorDealUgcPayRow,
  start: Date,
  end: Date,
) {
  const dealStart = startOfUtcDay(deal.effectiveStartDate);
  const dealEnd = deal.effectiveEndDate ? startOfUtcDay(deal.effectiveEndDate) : null;

  return dealStart <= end && (!dealEnd || dealEnd >= start);
}

function isDealActiveOnDate(deal: CampaignCreatorDealUgcPayRow, date: Date) {
  const targetDate = startOfUtcDay(date);
  const dealStart = startOfUtcDay(deal.effectiveStartDate);
  const dealEnd = deal.effectiveEndDate ? startOfUtcDay(deal.effectiveEndDate) : null;

  return dealStart <= targetDate && (!dealEnd || dealEnd >= targetDate);
}

function getActiveDealsInRange(
  deals: CampaignCreatorDealUgcPayRow[],
  start: Date,
  end: Date,
) {
  return deals.filter((deal) => isDealActiveInRange(deal, start, end));
}

function resolveUgcPayDeal(
  deal: CampaignCreatorDealUgcPayRow | null,
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
    paidTrafficMetric: deal?.paidTrafficMetric ?? CreatorDealPaidTrafficMetric.IMPRESSIONS,
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

function getVideoDealKey(campaignCreatorId: string, sourceVideoId: string) {
  return `${campaignCreatorId}::${sourceVideoId}`;
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

function getDealDateForVideo(
  row: ViewTallyListItem,
  reportTimeZone: string,
  fallbackStartDate: Date,
) {
  const postedDateOnly = getVideoPostedDateOnly(row, reportTimeZone);
  return postedDateOnly ? (parseDateOnly(postedDateOnly) ?? fallbackStartDate) : fallbackStartDate;
}

function resolveDealForVideo(args: {
  campaignCreator: CampaignCreatorUgcPayRow;
  row: ViewTallyListItem;
  reportTimeZone: string;
  fallbackStartDate: Date;
}) {
  const dealDate = getDealDateForVideo(
    args.row,
    args.reportTimeZone,
    args.fallbackStartDate,
  );
  const activeDeal =
    args.campaignCreator.deals.find((deal) => isDealActiveOnDate(deal, dealDate)) ??
    null;

  return resolveUgcPayDeal(activeDeal, args.fallbackStartDate);
}

function getVideoPostedDateOnly(row: ViewTallyListItem, timeZone: string) {
  const postedAt = getVideoPostedAt(row);
  return postedAt ? toDateOnlyStringInTimeZone(postedAt, timeZone) : null;
}

async function applyGlobalViewWindowToRows(args: {
  organizationSlug: string;
  organizationId?: string;
  viewTallyCreatorId?: string | null;
  rows: ViewTallyListItem[];
  startDate: string;
  endDate: string;
  reportTimeZone: string;
  videoFetchMode: UgcPayVideoFetchMode;
  globalViewWindowDays: number;
  includePaidViews?: boolean;
  topVideoLimit?: number;
}) {
  const reportEndExclusiveDate = addDateOnlyDays(args.endDate, 1);

  if (!reportEndExclusiveDate) {
    return {
      rows: args.rows,
      warnings: [] as string[],
    };
  }

  const keptRows: ViewTallyListItem[] = [];
  const clippedRowGroups = new Map<
    string,
    {
      startDate: string;
      endDate: string;
      rows: ViewTallyListItem[];
    }
  >();

  for (const row of args.rows) {
    const postedDate = getVideoPostedDateOnly(row, args.reportTimeZone);
    const windowEndExclusiveDate = postedDate
      ? addDateOnlyDays(postedDate, args.globalViewWindowDays)
      : null;

    if (!postedDate || !windowEndExclusiveDate) {
      continue;
    }

    const overlapStartDate =
      postedDate > args.startDate ? postedDate : args.startDate;
    const overlapEndExclusiveDate =
      windowEndExclusiveDate < reportEndExclusiveDate
        ? windowEndExclusiveDate
        : reportEndExclusiveDate;

    if (overlapStartDate >= overlapEndExclusiveDate) {
      continue;
    }

    const overlapEndDate = addDateOnlyDays(overlapEndExclusiveDate, -1);

    if (!overlapEndDate || overlapEndDate < overlapStartDate) {
      continue;
    }

    if (overlapStartDate === args.startDate && overlapEndDate === args.endDate) {
      keptRows.push(row);
      continue;
    }

    const groupKey = `${overlapStartDate}:${overlapEndDate}`;
    const group =
      clippedRowGroups.get(groupKey) ??
      {
        startDate: overlapStartDate,
        endDate: overlapEndDate,
        rows: [],
      };

    group.rows.push(row);
    clippedRowGroups.set(groupKey, group);
  }

  const warnings: string[] = [];

  for (const group of clippedRowGroups.values()) {
    const clippedData = await getOrganizationViewTallyData({
      organizationSlug: args.organizationSlug,
      organizationId: args.organizationId,
      searchParams: {
        startDate: group.startDate,
        endDate: group.endDate,
        ...(args.viewTallyCreatorId
          ? {
              creator: args.viewTallyCreatorId,
              topLimit: String(args.topVideoLimit ?? 100),
            }
          : args.topVideoLimit
            ? { topLimit: String(args.topVideoLimit) }
          : {}),
      },
      includeAdSpend: false,
      includePaidViews: args.includePaidViews,
      includeSummaryAnalytics: false,
      topVideoLimit: args.topVideoLimit,
    });
    warnings.push(...clippedData.warnings);

    if (clippedData.errorMessage) {
      warnings.push(
        `Could not fully apply the ${args.globalViewWindowDays}-day view window for ${group.startDate} to ${group.endDate}: ${clippedData.errorMessage}`,
      );
    }

    let clippedRows = clippedData.rows;

    if (args.videoFetchMode === "per-creator") {
      const creatorOptions = getMatchedViewTallyCreatorOptionsForRows({
        rows: group.rows,
        creatorOptions: clippedData.creatorOptions,
      });
      const expandedClippedRows = await getPerCreatorViewTallyRowsForOptions({
        organizationSlug: args.organizationSlug,
        organizationId: args.organizationId,
        creatorOptions,
        baseData: clippedData,
        startDate: group.startDate,
        endDate: group.endDate,
        includePaidViews: args.includePaidViews,
        topVideoLimit: args.topVideoLimit,
        warningPrefix: "accurate view-window videos",
      });

      clippedRows = expandedClippedRows.rows;
      warnings.push(...expandedClippedRows.warnings);
    }

    if (
      args.videoFetchMode === "global" &&
      clippedData.rows.length >= VIEW_TALLY_TOP_VIDEO_LIMIT_WARNING_THRESHOLD
    ) {
      warnings.push(
        `View Tally returned 100 video rows while applying the ${args.globalViewWindowDays}-day view window for ${group.startDate} to ${group.endDate}. Lower-view rows may be missing from this clipped window.`,
      );
    }

    const clippedRowsBySourceVideoId = new Map(
      clippedRows.map((row) => [row.sourceVideoId, row]),
    );

    for (const originalRow of group.rows) {
      const clippedRow = clippedRowsBySourceVideoId.get(originalRow.sourceVideoId);

      if (!clippedRow || (clippedRow.views ?? 0) <= 0) {
        continue;
      }

      keptRows.push({
        ...clippedRow,
        publishedAt: originalRow.publishedAt ?? clippedRow.publishedAt,
        createdAt: originalRow.createdAt,
      });
    }
  }

  return {
    rows: keptRows,
    warnings,
  };
}

function getLocalGainedViewCapContext(args: {
  row: ViewTallyListItem;
  video: LocalVideoViewCapRow | null;
  snapshots: LocalVideoMetricsSnapshotRow[];
  periodStart: Date;
  periodEndExclusive: Date;
}) {
  if (!args.video) {
    return null;
  }

  const grossViewsInPeriod = args.row.views ?? 0;
  const points = args.snapshots
    .filter((snapshot) => typeof snapshot.views === "number")
    .map((snapshot) => ({
      capturedAt: snapshot.capturedAt,
      views: snapshot.views as number,
    }));

  if (
    typeof args.video.views === "number" &&
    args.video.lastSyncedAt &&
    args.video.lastSyncedAt < args.periodEndExclusive
  ) {
    points.push({
      capturedAt: args.video.lastSyncedAt,
      views: args.video.views,
    });
  }

  points.sort((left, right) => left.capturedAt.getTime() - right.capturedAt.getTime());

  let grossViewsBeforePeriod: number | null = null;
  let grossViewsAtPeriodEnd: number | null = null;

  for (const point of points) {
    if (point.capturedAt < args.periodStart) {
      grossViewsBeforePeriod = Math.max(grossViewsBeforePeriod ?? 0, point.views);
    }

    if (point.capturedAt < args.periodEndExclusive) {
      grossViewsAtPeriodEnd = Math.max(grossViewsAtPeriodEnd ?? 0, point.views);
    }
  }

  if (grossViewsBeforePeriod != null) {
    return {
      grossViewsBeforePeriod,
      grossViewsAtPeriodEnd: Math.max(
        grossViewsAtPeriodEnd ?? 0,
        grossViewsBeforePeriod + grossViewsInPeriod,
      ),
    };
  }

  if (grossViewsAtPeriodEnd != null && grossViewsAtPeriodEnd >= grossViewsInPeriod) {
    return {
      grossViewsBeforePeriod: grossViewsAtPeriodEnd - grossViewsInPeriod,
      grossViewsAtPeriodEnd,
    };
  }

  return null;
}

async function getLocalGainedViewCapContexts(args: {
  organizationId: string;
  rows: ViewTallyListItem[];
  periodStart: Date;
  periodEndExclusive: Date;
}) {
  const sourceVideoIds = [
    ...new Set(
      args.rows
        .map((row) => row.sourceVideoId)
        .filter((value): value is string => value.length > 0),
    ),
  ];

  if (sourceVideoIds.length === 0) {
    return new Map<string, GainedViewCapContext>();
  }

  const videos: LocalVideoViewCapRow[] = [];

  for (const sourceVideoIdBatch of chunkArray(
    sourceVideoIds,
    GAINED_VIEW_CAP_CONTEXT_BATCH_SIZE,
  )) {
    videos.push(
      ...((await prisma.video.findMany({
        where: {
          platform: Platform.TIKTOK,
          sourceVideoId: {
            in: sourceVideoIdBatch,
          },
          creator: {
            organizationId: args.organizationId,
          },
        },
        select: {
          id: true,
          sourceVideoId: true,
          views: true,
          lastSyncedAt: true,
        },
      })) as LocalVideoViewCapRow[]),
    );
  }

  if (videos.length === 0) {
    return new Map<string, GainedViewCapContext>();
  }

  const snapshots: LocalVideoMetricsSnapshotRow[] = [];

  for (const videoIdBatch of chunkArray(
    videos.map((video) => video.id),
    GAINED_VIEW_CAP_CONTEXT_BATCH_SIZE,
  )) {
    snapshots.push(
      ...((await prisma.videoMetricsSnapshot.findMany({
        where: {
          videoId: {
            in: videoIdBatch,
          },
          capturedAt: {
            lt: args.periodEndExclusive,
          },
        },
        select: {
          videoId: true,
          capturedAt: true,
          views: true,
        },
        orderBy: [{ capturedAt: "asc" }],
      })) as LocalVideoMetricsSnapshotRow[]),
    );
  }

  const videosBySourceVideoId = new Map(
    videos
      .filter((video) => video.sourceVideoId != null)
      .map((video) => [video.sourceVideoId as string, video]),
  );
  const snapshotsByVideoId = new Map<string, LocalVideoMetricsSnapshotRow[]>();

  for (const snapshot of snapshots) {
    const existing = snapshotsByVideoId.get(snapshot.videoId) ?? [];
    existing.push(snapshot);
    snapshotsByVideoId.set(snapshot.videoId, existing);
  }

  const contexts = new Map<string, GainedViewCapContext>();

  for (const row of args.rows) {
    const video = videosBySourceVideoId.get(row.sourceVideoId) ?? null;
    const context = getLocalGainedViewCapContext({
      row,
      video,
      snapshots: video ? (snapshotsByVideoId.get(video.id) ?? []) : [],
      periodStart: args.periodStart,
      periodEndExclusive: args.periodEndExclusive,
    });

    if (context) {
      contexts.set(row.sourceVideoId, context);
    }
  }

  return contexts;
}

async function getLocalVideoContentTypes(args: {
  organizationId: string;
  rows: ViewTallyListItem[];
}) {
  const sourceVideoIds = [
    ...new Set(
      args.rows
        .map((row) => row.sourceVideoId)
        .filter((value): value is string => value.length > 0),
    ),
  ];

  if (sourceVideoIds.length === 0) {
    return new Map<string, boolean>();
  }

  const [classifications, videos] = await Promise.all([
    prisma.videoContentClassification.findMany({
      where: {
        organizationId: args.organizationId,
        platform: Platform.TIKTOK,
        sourceVideoId: {
          in: sourceVideoIds,
        },
      },
      select: {
        sourceVideoId: true,
        isTalking: true,
      },
    }),
    (async () => {
      const localVideos: LocalVideoContentTypeRow[] = [];

      for (const sourceVideoIdBatch of chunkArray(
        sourceVideoIds,
        GAINED_VIEW_CAP_CONTEXT_BATCH_SIZE,
      )) {
        localVideos.push(
          ...((await prisma.video.findMany({
            where: {
              platform: Platform.TIKTOK,
              sourceVideoId: {
                in: sourceVideoIdBatch,
              },
              creator: {
                organizationId: args.organizationId,
              },
            },
            select: {
              sourceVideoId: true,
              isTalking: true,
            },
          })) as LocalVideoContentTypeRow[]),
        );
      }

      return localVideos;
    })(),
  ]);
  const statusBySourceVideoId = new Map(
    videos
      .filter((video) => video.sourceVideoId != null)
      .map((video) => [video.sourceVideoId as string, video.isTalking]),
  );

  for (const classification of classifications) {
    statusBySourceVideoId.set(
      classification.sourceVideoId,
      classification.isTalking,
    );
  }

  return statusBySourceVideoId;
}

async function getProviderGainedViewCapContexts(args: {
  organizationSlug: string;
  organizationId?: string;
  viewTallyCreatorId?: string | null;
  rows: ViewTallyListItem[];
  startDate: string;
  endDate: string;
}) {
  if (args.rows.length === 0) {
    return {
      contexts: new Map<string, GainedViewCapContext>(),
      warnings: [] as string[],
    };
  }

  const cumulativeData = await getOrganizationViewTallyData({
    organizationSlug: args.organizationSlug,
    organizationId: args.organizationId,
    searchParams: {
      startDate: args.startDate,
      endDate: args.endDate,
      ...(args.viewTallyCreatorId
        ? { creator: args.viewTallyCreatorId, topLimit: "100" }
        : {}),
    },
    includeAdSpend: false,
    includePaidViews: false,
    includeSummaryAnalytics: false,
  });
  const cumulativeRowsBySourceVideoId = new Map(
    cumulativeData.rows.map((row) => [row.sourceVideoId, row]),
  );
  const contexts = new Map<string, GainedViewCapContext>();

  for (const row of args.rows) {
    const grossViewsInPeriod = row.views ?? 0;
    const cumulativeGrossViews =
      cumulativeRowsBySourceVideoId.get(row.sourceVideoId)?.views ?? null;

    if (
      typeof cumulativeGrossViews !== "number" ||
      cumulativeGrossViews < grossViewsInPeriod
    ) {
      continue;
    }

    contexts.set(row.sourceVideoId, {
      grossViewsBeforePeriod: cumulativeGrossViews - grossViewsInPeriod,
      grossViewsAtPeriodEnd: cumulativeGrossViews,
    });
  }

  return {
    contexts,
    warnings: [
      ...cumulativeData.warnings,
      ...(cumulativeData.errorMessage
        ? [
            `Could not load cumulative View Tally context for gained-view caps: ${cumulativeData.errorMessage}`,
          ]
        : []),
    ],
  };
}

function getFallbackGainedViewCapContext(row: ViewTallyListItem) {
  const grossViewsInPeriod = row.views ?? 0;

  if (
    typeof row.currentViews !== "number" ||
    row.currentViews < grossViewsInPeriod
  ) {
    return null;
  }

  return {
    grossViewsBeforePeriod: row.currentViews - grossViewsInPeriod,
    grossViewsAtPeriodEnd: row.currentViews,
  };
}

function getViewTallyNetViews(row: ViewTallyListItem) {
  return Math.max(
    (row.views ?? 0) -
      (row.paidStatus === "yes" ? (row.paidViews ?? 0) : 0),
    0,
  );
}

function buildLocalCreatorViewTallyData(args: {
  creatorId: string;
  creatorName: string;
  accountHandle: string | null;
  startDate: string;
  endDate: string;
  rows: ViewTallyListItem[];
  warnings: string[];
  errorMessage: string | null;
}) {
  const selectedCreator = {
    id: args.creatorId,
    label: args.creatorName,
    meta: args.accountHandle ? `@${args.accountHandle}` : undefined,
  };
  const totalViews = args.rows.reduce(
    (total, row) => total + (row.views ?? 0),
    0,
  );
  const paidViewsTotal = args.rows.reduce(
    (total, row) => total + (row.paidViews ?? 0),
    0,
  );
  const deductedPaidViews = args.rows.reduce(
    (total, row) =>
      row.paidStatus === "yes" ? total + (row.paidViews ?? 0) : total,
    0,
  );
  const topVideos = [...args.rows].sort(
    (left, right) => getViewTallyNetViews(right) - getViewTallyNetViews(left),
  );
  const topAccounts =
    args.rows.length > 0
      ? [
          {
            id: args.creatorId,
            label: args.creatorName,
            handle: args.accountHandle,
            views: totalViews,
            paidViews: paidViewsTotal,
            videos: args.rows.length,
            avatarUrl: args.rows.find((row) => row.thumbnailUrl)?.thumbnailUrl,
          },
        ]
      : [];

  return {
    creatorOptions: [selectedCreator],
    selectedCreator,
    startDate: args.startDate,
    endDate: args.endDate,
    warnings: args.warnings,
    errorMessage: args.errorMessage,
    topLimit: args.rows.length,
    topLimitOptions: [args.rows.length],
    rows: args.rows,
    topVideos,
    topAccounts,
    adSpend: {
      advertiserId: null,
      totalSpend: 0,
      rowCount: 0,
      rows: [],
      warnings: [],
    },
    totals: {
      videos: args.rows.length,
      totalViews,
      paidViews: paidViewsTotal,
      deductedPaidViews,
      unpaidViews: Math.max(totalViews - deductedPaidViews, 0),
      organicViewsEstimate: args.rows.reduce(
        (total, row) => total + (row.organicViewsEstimate ?? 0),
        0,
      ),
      yesVideos: args.rows.filter((row) => row.paidStatus === "yes").length,
      noVideos: args.rows.filter((row) => row.paidStatus === "no").length,
      unknownVideos: args.rows.filter((row) => row.paidStatus === "unknown").length,
      unsupportedVideos: args.rows.filter((row) => row.paidStatus === "unsupported")
        .length,
    },
  } satisfies OrganizationViewTallyData;
}

function getCreatorAccessPaidLookupCacheKey(args: {
  organizationId: string;
  creatorId: string;
  sourceVideoIds: string[];
  startDate: string;
  endDate: string;
}) {
  return [
    args.organizationId,
    args.creatorId,
    args.startDate,
    args.endDate,
    [...args.sourceVideoIds].sort().join(","),
  ].join("::");
}

function getCreatorAccessPaidLookupPromise(args: {
  organizationSlug: string;
  organizationId: string;
  creatorId: string;
  sourceVideoIds: string[];
  startDate: string;
  endDate: string;
}) {
  const cacheKey = getCreatorAccessPaidLookupCacheKey(args);
  const now = Date.now();
  const existing = creatorAccessPaidLookupCache.get(cacheKey);

  if (existing && existing.expiresAt > now) {
    return existing.promise;
  }

  if (existing) {
    creatorAccessPaidLookupCache.delete(cacheKey);
  }

  const promise = getPaidViewsForSourceVideosForCreatorForOrganization({
    organizationSlug: args.organizationSlug,
    organizationId: args.organizationId,
    creatorId: args.creatorId,
    sourceVideoIds: args.sourceVideoIds,
    startDate: args.startDate,
    endDate: args.endDate,
  });

  creatorAccessPaidLookupCache.set(cacheKey, {
    expiresAt: now + CREATOR_ACCESS_PAID_LOOKUP_CACHE_TTL_MS,
    promise,
  });
  promise.catch(() => {
    if (creatorAccessPaidLookupCache.get(cacheKey)?.promise === promise) {
      creatorAccessPaidLookupCache.delete(cacheKey);
    }
  });

  return promise;
}

async function getCreatorAccessPaidLookupWithTimeout(args: {
  organizationSlug: string;
  organizationId: string;
  creatorId: string;
  sourceVideoIds: string[];
  startDate: string;
  endDate: string;
}) {
  const paidLookupPromise = getCreatorAccessPaidLookupPromise(args);
  let timeoutId: NodeJS.Timeout | null = null;

  const timeoutPromise = new Promise<"timeout">((resolve) => {
    timeoutId = setTimeout(
      () => resolve("timeout"),
      CREATOR_ACCESS_PAID_LOOKUP_TIMEOUT_MS,
    );
  });

  const result = await Promise.race([paidLookupPromise, timeoutPromise]);

  if (timeoutId) {
    clearTimeout(timeoutId);
  }

  return result;
}

async function getCreatorAccessPeriodViewRows(args: {
  organizationSlug: string;
  organizationId: string;
  creatorId: string;
  startDate: string;
  endDate: string;
}) {
  const warnings: string[] = [];
  let errorMessage: string | null = null;
  const viewTallyCreatorId = await resolveViewTallyCreatorIdForLocalCreator({
    organizationId: args.organizationId,
    creatorId: args.creatorId,
  });

  if (!viewTallyCreatorId) {
    return {
      rows: [] as CreatorAccessPeriodViewRow[],
      warnings: [
        "Could not match this local creator to a tracked View Tally account, so selected-period view counts could not be resolved.",
      ],
      errorMessage: null,
    };
  }

  const periodData = await getOrganizationViewTallyData({
    organizationSlug: args.organizationSlug,
    organizationId: args.organizationId,
    searchParams: {
      creator: viewTallyCreatorId,
      startDate: args.startDate,
      endDate: args.endDate,
      topLimit: "100",
    },
    includeAdSpend: false,
    includePaidViews: false,
    includeSummaryAnalytics: false,
  });

  warnings.push(...periodData.warnings);
  errorMessage = periodData.errorMessage;

  return {
    rows: periodData.rows.map(
      (row) =>
        ({
          sourceVideoId: row.sourceVideoId,
          views: row.views,
          currentViews: row.currentViews,
          titleOrCaption: row.titleOrCaption,
          publishedAt: row.publishedAt,
          createdAt: row.createdAt,
          videoUrl: row.videoUrl,
          thumbnailUrl: row.thumbnailUrl,
        }) satisfies CreatorAccessPeriodViewRow,
    ),
    warnings,
    errorMessage,
  };
}

async function getCreatorAccessLocalViewTallyData(args: {
  organizationSlug: string;
  organizationId: string;
  creatorId: string;
  creatorName: string;
  accountHandle: string | null;
  startDate: string;
  endDate: string;
  start: Date;
  endExclusive: Date;
}) {
  type CreatorAccessLocalVideoRecord = Omit<
    CreatorAccessLocalVideoRow,
    "thumbnailUrl"
  > & {
    rawPayload: Prisma.JsonValue | null;
    creatorPlatformAccount: {
      rawPayload: Prisma.JsonValue | null;
    } | null;
  };

  const videoRecords = (await prisma.video.findMany({
    where: {
      creatorId: args.creatorId,
      platform: Platform.TIKTOK,
      creator: {
        organizationId: args.organizationId,
      },
      OR: [
        {
          publishedAt: {
            lt: args.endExclusive,
          },
        },
        {
          publishedAt: null,
          createdAt: {
            lt: args.endExclusive,
          },
        },
      ],
    },
    select: {
      id: true,
      sourceVideoId: true,
      videoUrl: true,
      titleOrCaption: true,
      publishedAt: true,
      createdAt: true,
      views: true,
      isTalking: true,
      rawPayload: true,
      creatorPlatformAccount: {
        select: {
          rawPayload: true,
        },
      },
      creator: {
        select: {
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
    },
    orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
  })) as CreatorAccessLocalVideoRecord[];
  const videos = videoRecords.map(
    ({ rawPayload, creatorPlatformAccount, ...video }) =>
      ({
        ...video,
        thumbnailUrl:
          getVideoThumbnailUrl(rawPayload) ??
          getAccountImageUrl(rawPayload) ??
          getAccountImageUrl(creatorPlatformAccount?.rawPayload),
      }) satisfies CreatorAccessLocalVideoRow,
  );
  const warnings: string[] = [];
  let errorMessage: string | null = null;
  let periodRows: CreatorAccessPeriodViewRow[] = [];
  let paidRows: TikTokSourceVideoPaidViewsRow[] = [];
  let lookupWindowUnresolvedPostBackedGroupCount = 0;
  let lookupWindowUnresolvedNonPostBackedGroupCount = 0;

  try {
    const periodResult = await getCreatorAccessPeriodViewRows({
      organizationSlug: args.organizationSlug,
      organizationId: args.organizationId,
      creatorId: args.creatorId,
      startDate: args.startDate,
      endDate: args.endDate,
    });

    periodRows = periodResult.rows;
    warnings.push(...periodResult.warnings);
    errorMessage ??= periodResult.errorMessage;

    if (
      periodRows.length >= VIEW_TALLY_TOP_VIDEO_LIMIT_WARNING_THRESHOLD
    ) {
      warnings.push(
        "View Tally returned 100 selected-period video rows for this creator. The ledger includes queried provider videos plus local tracked videos, but provider period-view counts may be capped for lower-view posts.",
      );
    }
  } catch (error) {
    warnings.push(
      error instanceof Error
        ? `Could not load selected-period view counts right now: ${error.message}`
      : "Could not load selected-period view counts right now.",
    );
  }

  const ledgerVideos = buildCreatorAccessLedgerVideos({
    accountHandle: args.accountHandle,
    creatorName: args.creatorName,
    videos,
    periodRows,
    periodStart: args.start,
    periodEndExclusive: args.endExclusive,
  });
  const sourceVideoIds = getCreatorAccessPaidLookupSourceVideoIds(ledgerVideos);
  const missingSourceVideoCount =
    getCreatorAccessMissingSourceVideoCount(ledgerVideos);

  if (sourceVideoIds.length > 0) {
    try {
      const paidReport = await getCreatorAccessPaidLookupWithTimeout({
        organizationSlug: args.organizationSlug,
        organizationId: args.organizationId,
        creatorId: args.creatorId,
        sourceVideoIds,
        startDate: args.startDate,
        endDate: args.endDate,
      });

      if (paidReport === "timeout") {
        warnings.push(
          "Paid traffic matching did not finish within 4 seconds, so paid delivery remains unknown for unmatched rows. Refresh this page to retry exact paid matching.",
        );
      } else {
        paidRows = paidReport.rows;
        lookupWindowUnresolvedPostBackedGroupCount =
          paidReport.unresolvedPostBackedGroupCount;
        lookupWindowUnresolvedNonPostBackedGroupCount =
          paidReport.unresolvedNonPostBackedGroupCount;
        warnings.push(...paidReport.warnings);
      }
    } catch (error) {
      errorMessage =
        error instanceof Error
          ? error.message
          : "Could not resolve paid TikTok impressions for these videos right now.";
    }
  }

  if (missingSourceVideoCount > 0) {
    warnings.push(
      `${missingSourceVideoCount} local TikTok video${missingSourceVideoCount === 1 ? "" : "s"} had no TikTok post ID. They are included in the ledger, but paid-delivery matching and per-video overrides cannot be resolved for those rows.`,
    );
  }

  const rows = buildCreatorAccessViewTallyRows({
    videos: ledgerVideos,
    periodRows,
    paidRows,
    lookupWindowUnresolvedPostBackedGroupCount,
    lookupWindowUnresolvedNonPostBackedGroupCount,
  }) as ViewTallyListItem[];

  return buildLocalCreatorViewTallyData({
    creatorId: args.creatorId,
    creatorName: args.creatorName,
    accountHandle: args.accountHandle,
    startDate: args.startDate,
    endDate: args.endDate,
    rows,
    warnings,
    errorMessage,
  });
}

function calculateVideoPay(args: {
  row: ViewTallyListItem;
  campaignCreator: CampaignCreatorUgcPayRow;
  deal: ResolvedUgcPayDeal;
  videoDealOverride: CampaignCreatorVideoDealUgcPayRow | null;
  isTalking: boolean;
  includeFixedFeePerVideo: boolean;
  gainedViewCapContext: GainedViewCapContext | null;
  payMode: UgcPayMode;
}): UgcPayVideoRow {
  const grossViews = args.row.views ?? 0;
  const fixedFeePerVideo = args.includeFixedFeePerVideo
    ? (args.deal.fixedFeePerVideo ?? 0)
    : 0;
  const amountResult = calculateUgcPayVideoAmounts({
    grossViews,
    paidStatus: args.row.paidStatus,
    paidViews: args.row.paidViews ?? 0,
    deal: args.deal,
    fixedFeePerVideo,
    gainedViewCapContext: args.gainedViewCapContext,
    payMode: args.payMode,
  });

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
    thumbnailUrl: args.row.thumbnailUrl ?? null,
    titleOrCaption: args.row.titleOrCaption,
    publishedAt: args.row.publishedAt,
    createdAt: args.row.createdAt,
    isTalking: args.isTalking,
    grossViews,
    paidViews: args.row.paidViews,
    paidViewsDeducted: amountResult.paidViewsDeducted,
    payableViews: amountResult.payableViews,
    fixedFeePerVideo,
    cpmAmount: amountResult.cpmAmount,
    paidTrafficMetric: args.deal.paidTrafficMetric,
    deductPaidTraffic: args.deal.deductPaidTraffic,
    viewCapPerVideo: args.deal.viewCapPerVideo,
    payoutCapPerVideo: args.deal.payoutCapPerVideo,
    perVideoCapScope: args.deal.perVideoCapScope,
    hasVideoDealOverride: args.videoDealOverride != null,
    videoDealId: args.videoDealOverride?.id ?? null,
    videoDealNotes: args.videoDealOverride?.notes ?? null,
    cpmPay: amountResult.cpmPay,
    videoPay: amountResult.videoPay,
    viewCapReached: amountResult.viewCapReached,
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

  const activeCustomDeals = getActiveDealsInRange(
    args.campaignCreator.deals,
    args.start,
    args.end,
  );
  const defaultDeal = resolveUgcPayDeal(null, args.start);
  const dealPeriods = activeCustomDeals.map((activeDeal) =>
    resolveUgcPayDeal(activeDeal, args.start),
  );
  const deal = dealPeriods[0] ?? defaultDeal;
  const fixedDealPay = dealPeriods.map((dealPeriod) => ({
    deal: dealPeriod,
    fixedPay: normalizeMoney(getFixedPayForRange(dealPeriod, args.start, args.end)),
  }));
  const accumulator: CreatorAccumulator = {
    campaignCreator: args.campaignCreator,
    deal,
    defaultDeal,
    dealPeriods,
    hasCustomDeal: dealPeriods.length > 0,
    fixedPay: normalizeMoney(
      fixedDealPay.reduce((total, dealPay) => total + dealPay.fixedPay, 0),
    ),
    grossViews: 0,
    paidViewsDeducted: 0,
    payableViews: 0,
    videoPayBeforeCreatorCap: 0,
    unknownPaidVideoCount: 0,
    exactPaidVideoCount: 0,
    videoCapReached: false,
    creatorTotalCapApplied: false,
    videoDealOverrideCount: 0,
    dealTotals: new Map(),
    videos: [],
  };

  for (const dealPay of fixedDealPay) {
    if (dealPay.fixedPay > 0) {
      accumulator.dealTotals.set(getResolvedDealKey(dealPay.deal), {
        deal: dealPay.deal,
        fixedPay: dealPay.fixedPay,
        videoPayBeforeCreatorCap: 0,
        videos: [],
      });
    }
  }

  args.accumulators.set(args.campaignCreator.id, accumulator);
  return accumulator;
}

function getResolvedDealKey(deal: ResolvedUgcPayDeal) {
  return deal.id ?? "__default__";
}

function getOrCreateDealTotal(
  accumulator: CreatorAccumulator,
  deal: ResolvedUgcPayDeal,
) {
  const key = getResolvedDealKey(deal);
  const existing = accumulator.dealTotals.get(key);

  if (existing) {
    return existing;
  }

  const total = {
    deal,
    fixedPay: 0,
    videoPayBeforeCreatorCap: 0,
    videos: [] as UgcPayVideoRow[],
  };
  accumulator.dealTotals.set(key, total);
  return total;
}

function applyCreatorTotalCap(accumulator: CreatorAccumulator) {
  let fixedPay = 0;

  for (const dealTotal of accumulator.dealTotals.values()) {
    const cap = dealTotal.deal.payoutCapTotal;
    const rawFixedPay = dealTotal.fixedPay;
    const rawVideoPay = dealTotal.videoPayBeforeCreatorCap;

    if (typeof cap !== "number" || rawFixedPay + rawVideoPay <= cap) {
      fixedPay += normalizeMoney(rawFixedPay);
      for (const video of dealTotal.videos) {
        video.videoPay = normalizeMoney(video.videoPay);
        video.creatorTotalCapApplied = false;
      }
      continue;
    }

    accumulator.creatorTotalCapApplied = true;
    const cappedFixedPay = normalizeMoney(Math.min(rawFixedPay, cap));
    fixedPay += cappedFixedPay;
    const availableVideoPay = Math.max(cap - cappedFixedPay, 0);
    const scale =
      rawVideoPay > 0 ? Math.min(availableVideoPay / rawVideoPay, 1) : 0;

    for (const video of dealTotal.videos) {
      video.videoPay = normalizeMoney(video.videoPay * scale);
      video.creatorTotalCapApplied = true;
    }
  }

  accumulator.fixedPay = normalizeMoney(fixedPay);
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
    defaultDeal: accumulator.defaultDeal,
    dealPeriods: accumulator.dealPeriods,
    grossViews: accumulator.grossViews,
    paidViewsDeducted: accumulator.paidViewsDeducted,
    payableViews: accumulator.payableViews,
    fixedPay: accumulator.fixedPay,
    videoPay,
    totalPay,
    videoCount: accumulator.videos.length,
    exactPaidVideoCount: accumulator.exactPaidVideoCount,
    unknownPaidVideoCount: accumulator.unknownPaidVideoCount,
    videoDealOverrideCount: accumulator.videoDealOverrideCount,
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

function getVideoFixedPay(videos: UgcPayVideoRow[]) {
  return normalizeMoney(
    videos.reduce(
      (total, video) =>
        total + Math.min(Math.max(video.fixedFeePerVideo, 0), Math.max(video.videoPay, 0)),
      0,
    ),
  );
}

function getEmptyData(args: {
  campaignOptions: OrganizationUgcPayData["campaignOptions"];
  selectedCampaignId: string | null;
  selectedCampaignLabel: string | null;
  startDate: string;
  endDate: string;
  payMode: UgcPayMode;
  videoWindowStartDate: string;
  viewWindowMode: UgcPayViewWindowMode;
  videoFetchMode: UgcPayVideoFetchMode;
  globalViewWindowDays: number;
  reportTimeZone: string;
  warnings?: string[];
  errorMessage?: string | null;
}): OrganizationUgcPayData {
  return {
    campaignOptions: args.campaignOptions,
    selectedCampaignId: args.selectedCampaignId,
    selectedCampaignLabel: args.selectedCampaignLabel,
    startDate: args.startDate,
    endDate: args.endDate,
    payMode: args.payMode,
    videoWindowStartDate: args.videoWindowStartDate,
    viewWindowMode: args.viewWindowMode,
    videoFetchMode: args.videoFetchMode,
    globalViewWindowDays: args.globalViewWindowDays,
    reportTimeZone: args.reportTimeZone,
    warnings: args.warnings ?? [],
    errorMessage: args.errorMessage ?? null,
    summary: {
      totalPay: 0,
      fixedPay: 0,
      videoFixedPay: 0,
      cpmPay: 0,
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
      videoDealOverrides: 0,
    },
    creators: [],
    videos: [],
  };
}

export async function getOrganizationUgcPayData(args: {
  organizationSlug: string;
  searchParams?: DashboardSearchParams;
  creatorAccess?: UgcPayCreatorAccessScope;
  includePaidViews?: boolean;
  topVideoLimit?: number;
}): Promise<OrganizationUgcPayData> {
  const membership = args.creatorAccess
    ? null
    : await requireOrganizationMembership(args.organizationSlug);
  const organizationId = args.creatorAccess?.organizationId ?? membership?.organizationId;

  if (!organizationId) {
    throw new Error("Organization access denied");
  }

  const campaignOptions = (
    args.creatorAccess
      ? await prisma.campaign.findMany({
          where: {
            organizationId,
            creators: {
              some: {
                creatorId: args.creatorAccess.creatorId,
                ...(args.creatorAccess.campaignCreatorId
                  ? { id: args.creatorAccess.campaignCreatorId }
                  : {}),
              },
            },
          },
          select: {
            id: true,
            name: true,
          },
          orderBy: {
            createdAt: "desc",
          },
        })
      : await getAccessibleCampaignOptionsForMembership(membership!)
  ).map((campaign) => ({
    id: campaign.id,
    label: campaign.name,
  }));
  const requestedCampaignId = getSearchParamValue(args.searchParams, "campaign");
  const selectedCampaign =
    campaignOptions.find((campaign) => campaign.id === requestedCampaignId) ??
    campaignOptions[0] ??
    null;
  const reportTimeZone = getReportTimeZone(
    getSearchParamValue(args.searchParams, "reportTimeZone"),
  );
  const { startDate, endDate } = getSelectedDateRange(
    args.searchParams,
    reportTimeZone,
  );
  const payMode = getSelectedPayMode(args.searchParams);
  const videoWindowStartDate = getSelectedVideoWindowStartDate(
    args.searchParams,
    startDate,
    endDate,
  );
  const viewWindowMode = args.creatorAccess
    ? "all"
    : getSelectedViewWindowMode(args.searchParams);
  const videoFetchMode = getSelectedVideoFetchMode(args.searchParams);
  const globalViewWindowDays = getSelectedGlobalViewWindowDays(args.searchParams);
  const viewTallyTopLimit = getSearchParamValue(args.searchParams, "topLimit");
  const start = parseDateOnly(startDate);
  const end = parseDateOnly(endDate);
  const reportDateBounds = getReportDateRangeBounds({
    startDate,
    endDate,
    timeZone: reportTimeZone,
  });
  const videoWindowDateBounds = getReportDateRangeBounds({
    startDate: videoWindowStartDate,
    endDate,
    timeZone: reportTimeZone,
  });

  if (!start || !end || !reportDateBounds || !videoWindowDateBounds) {
    return getEmptyData({
      campaignOptions,
      selectedCampaignId: selectedCampaign?.id ?? null,
      selectedCampaignLabel: selectedCampaign?.label ?? null,
      startDate,
      endDate,
      payMode,
      videoWindowStartDate,
      viewWindowMode,
      videoFetchMode,
      globalViewWindowDays,
      reportTimeZone,
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
      payMode,
      videoWindowStartDate,
      viewWindowMode,
      videoFetchMode,
      globalViewWindowDays,
      reportTimeZone,
      warnings: ["Create a campaign before running UGC pay."],
    });
  }

  const campaignCreators = (await prisma.campaignCreator.findMany({
    where: {
      ...(args.creatorAccess?.campaignCreatorId
        ? { id: args.creatorAccess.campaignCreatorId }
        : {}),
      campaignId: selectedCampaign.id,
      campaign: args.creatorAccess
        ? {
            organizationId,
          }
        : getAccessibleCampaignWhere(membership!),
      creator: {
        ...(args.creatorAccess ? { id: args.creatorAccess.creatorId } : {}),
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
      deals: {
        where: {
          organizationId,
        },
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
        orderBy: [
          {
            effectiveStartDate: "asc",
          },
          {
            createdAt: "asc",
          },
        ],
      },
    },
    orderBy: {
      creator: {
        displayName: "asc",
      },
    },
  })) as CampaignCreatorUgcPayRow[];
  const campaignCreatorIds = campaignCreators.map((campaignCreator) => campaignCreator.id);
  const videoDealOverrides = campaignCreatorIds.length
    ? ((await prisma.campaignCreatorVideoDeal.findMany({
        where: {
          organizationId,
          campaignCreatorId: {
            in: campaignCreatorIds,
          },
        },
        select: {
          id: true,
          campaignCreatorId: true,
          sourceVideoId: true,
          fixedFeePerVideo: true,
          cpmAmount: true,
          paidTrafficMetric: true,
          deductPaidTraffic: true,
          viewCapPerVideo: true,
          payoutCapPerVideo: true,
          perVideoCapScope: true,
          notes: true,
        },
      })) as CampaignCreatorVideoDealUgcPayRow[])
    : [];
  const videoDealOverrideByKey = new Map(
    videoDealOverrides.map((videoDeal) => [
      getVideoDealKey(videoDeal.campaignCreatorId, videoDeal.sourceVideoId),
      videoDeal,
    ]),
  );

  const byHandle = new Map<string, CampaignCreatorUgcPayRow | null>();
  const byName = new Map<string, CampaignCreatorUgcPayRow | null>();

  for (const campaignCreator of campaignCreators) {
    setUniqueLookupValue(byName, normalizeName(campaignCreator.creator.displayName), campaignCreator);

    for (const account of campaignCreator.creator.platformAccounts) {
      setUniqueLookupValue(byHandle, normalizeHandle(account.handle), campaignCreator);
    }
  }

  const creatorAccessViewTallyCreatorId = null;
  const creatorAccessCampaignCreator = campaignCreators[0] ?? null;
  const viewTallyData = args.creatorAccess
    ? await getCreatorAccessLocalViewTallyData({
        organizationSlug: args.organizationSlug,
        organizationId,
        creatorId: args.creatorAccess.creatorId,
        creatorName:
          creatorAccessCampaignCreator?.creator.displayName ?? "Creator",
        accountHandle: creatorAccessCampaignCreator
          ? getTikTokHandle(creatorAccessCampaignCreator)
          : null,
        startDate,
        endDate,
        start: reportDateBounds.start,
        endExclusive: reportDateBounds.endExclusive,
      })
    : await getOrganizationViewTallyData({
        organizationSlug: args.organizationSlug,
        organizationId,
        searchParams: {
          startDate,
          endDate,
          ...(viewTallyTopLimit ? { topLimit: viewTallyTopLimit } : {}),
        },
        includeAdSpend: false,
        includePaidViews: args.includePaidViews,
        includeSummaryAnalytics: false,
        topVideoLimit: args.topVideoLimit,
      });
  const warnings = [...viewTallyData.warnings];
  let viewTallyRows = viewTallyData.rows;

  if (payMode === "gained" && videoFetchMode === "per-creator") {
    const perCreatorRows = await getPerCreatorViewTallyRows({
      organizationSlug: args.organizationSlug,
      organizationId,
      campaignCreators,
      baseData: viewTallyData,
      startDate,
      endDate,
      includePaidViews: args.includePaidViews,
      topVideoLimit: args.topVideoLimit,
    });
    viewTallyRows = perCreatorRows.rows;
    warnings.push(...perCreatorRows.warnings);
  }

  const candidatePayableRows = args.creatorAccess
    ? filterCreatorAccessPayableRowsByMode({
        payMode,
        rows: viewTallyRows,
        periodStart: reportDateBounds.start,
        periodEndExclusive: reportDateBounds.endExclusive,
      })
    : payMode === "gained"
      ? viewTallyRows.filter((row) => {
          return (
            (row.views ?? 0) > 0 &&
            isVideoPostedInVideoWindow({
              row,
              start: videoWindowDateBounds.start,
              endExclusive: videoWindowDateBounds.endExclusive,
            })
          );
        })
      : viewTallyRows.filter((row) =>
          isVideoPostedInReportDateRange({
            row,
            start: reportDateBounds.start,
            endExclusive: reportDateBounds.endExclusive,
          }),
        );
  let unmatchedVideos = 0;

  const viewWindowAdjustedRows =
    viewWindowMode === "first-days"
      ? await applyGlobalViewWindowToRows({
          organizationSlug: args.organizationSlug,
          organizationId,
          viewTallyCreatorId: creatorAccessViewTallyCreatorId,
          rows: candidatePayableRows,
          startDate,
          endDate,
          reportTimeZone,
          videoFetchMode,
          globalViewWindowDays,
          includePaidViews: args.includePaidViews,
          topVideoLimit: args.topVideoLimit,
        })
      : {
          rows: candidatePayableRows,
          warnings: [] as string[],
        };
  const payableRows = viewWindowAdjustedRows.rows;
  warnings.push(...viewWindowAdjustedRows.warnings);
  const videoContentTypesBySourceVideoId = await getLocalVideoContentTypes({
    organizationId,
    rows: payableRows,
  });

  if (
    !args.creatorAccess &&
    videoFetchMode === "global" &&
    viewTallyData.rows.length >= VIEW_TALLY_TOP_VIDEO_LIMIT_WARNING_THRESHOLD
  ) {
    warnings.push(
      "View Tally returned 100 video rows for this date range. If more videos exist, lower-view rows may not be included in this UGC pay report.",
    );
  }

  let providerGainedViewCapContexts = new Map<string, GainedViewCapContext>();
  let localGainedViewCapContexts = new Map<string, GainedViewCapContext>();

  if (payMode === "gained") {
    if (!args.creatorAccess && viewWindowMode === "all") {
      const providerContextResult = await getProviderGainedViewCapContexts({
        organizationSlug: args.organizationSlug,
        organizationId,
        viewTallyCreatorId: creatorAccessViewTallyCreatorId,
        rows: payableRows,
        startDate: videoWindowStartDate,
        endDate,
      });
      providerGainedViewCapContexts = providerContextResult.contexts;
      warnings.push(...providerContextResult.warnings);
    }

    localGainedViewCapContexts = await getLocalGainedViewCapContexts({
      organizationId,
      rows: payableRows,
      periodStart: reportDateBounds.start,
      periodEndExclusive: reportDateBounds.endExclusive,
    });
  }

  const accumulators = new Map<string, CreatorAccumulator>();
  let missingGainedViewCapContextCount = 0;

  for (const campaignCreator of campaignCreators) {
    const fixedPay = getActiveDealsInRange(campaignCreator.deals, start, end)
      .map((deal) => resolveUgcPayDeal(deal, start))
      .reduce(
        (total, deal) => total + getFixedPayForRange(deal, start, end),
        0,
      );

    if (normalizeMoney(fixedPay) > 0) {
      getOrCreateAccumulator({
        accumulators,
        campaignCreator,
        start,
        end,
      });
    }
  }

  for (const row of payableRows) {
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
    const videoDealOverride =
      videoDealOverrideByKey.get(
        getVideoDealKey(campaignCreator.id, row.sourceVideoId),
      ) ?? null;
    const baseVideoDeal = resolveDealForVideo({
      campaignCreator,
      row,
      reportTimeZone,
      fallbackStartDate: start,
    });
    const effectiveDeal = applyUgcPayVideoContentTypeCpm(
      applyUgcPayVideoDealOverride(baseVideoDeal, videoDealOverride),
      {
        hasVideoDealOverride: videoDealOverride != null,
        isTalking: videoContentTypesBySourceVideoId.get(row.sourceVideoId) ?? true,
      },
    );
    const includeFixedFeePerVideo =
      payMode === "posted" ||
      isVideoPostedInReportDateRange({
        row,
        start: reportDateBounds.start,
        endExclusive: reportDateBounds.endExclusive,
      });
    const fixedFeePerVideo = includeFixedFeePerVideo
      ? (effectiveDeal.fixedFeePerVideo ?? 0)
      : 0;
    const perVideoGrossViewCap = getUgcPayPerVideoGrossViewCap({
      deal: effectiveDeal,
      fixedFeePerVideo,
    });
    const gainedViewCapContext =
      payMode === "gained" && typeof perVideoGrossViewCap === "number"
        ? (providerGainedViewCapContexts.get(row.sourceVideoId) ??
          localGainedViewCapContexts.get(row.sourceVideoId) ??
          getFallbackGainedViewCapContext(row))
        : null;

    if (
      payMode === "gained" &&
      typeof perVideoGrossViewCap === "number" &&
      !gainedViewCapContext
    ) {
      missingGainedViewCapContextCount += 1;
    }

    const videoPay = calculateVideoPay({
      row,
      campaignCreator,
      deal: effectiveDeal,
      videoDealOverride,
      isTalking: videoContentTypesBySourceVideoId.get(row.sourceVideoId) ?? true,
      includeFixedFeePerVideo,
      gainedViewCapContext,
      payMode,
    });

    accumulator.grossViews += videoPay.grossViews;
    accumulator.paidViewsDeducted += videoPay.paidViewsDeducted;
    accumulator.payableViews += videoPay.payableViews;
    accumulator.videoPayBeforeCreatorCap += videoPay.videoPay;
    accumulator.videoCapReached ||= videoPay.viewCapReached;
    if (videoPay.hasVideoDealOverride) {
      accumulator.videoDealOverrideCount += 1;
    }

    if (row.paidStatus === "yes" || row.paidStatus === "no") {
      accumulator.exactPaidVideoCount += 1;
    } else {
      accumulator.unknownPaidVideoCount += 1;
    }

    const dealTotal = getOrCreateDealTotal(accumulator, effectiveDeal);
    dealTotal.videoPayBeforeCreatorCap += videoPay.videoPay;
    dealTotal.videos.push(videoPay);

    accumulator.videos.push(videoPay);
  }

  if (unmatchedVideos > 0) {
    warnings.push(
      `${unmatchedVideos} View Tally video${unmatchedVideos === 1 ? "" : "s"} could not be matched to creators in ${selectedCampaign.label}.`,
    );
  }

  if (missingGainedViewCapContextCount > 0) {
    warnings.push(
      `${missingGainedViewCapContextCount} gained-view video${missingGainedViewCapContextCount === 1 ? "" : "s"} did not have cumulative view context, so per-video caps were applied to selected-period views only for those rows.`,
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
  const videoFixedPay = getVideoFixedPay(videos);
  const cpmPay = normalizeMoney(videoPay - videoFixedPay);

  return {
    campaignOptions,
    selectedCampaignId: selectedCampaign.id,
    selectedCampaignLabel: selectedCampaign.label,
    startDate: viewTallyData.startDate,
    endDate: viewTallyData.endDate,
    payMode,
    videoWindowStartDate,
    viewWindowMode,
    videoFetchMode,
    globalViewWindowDays,
    reportTimeZone,
    warnings: [...new Set(warnings)],
    errorMessage: viewTallyData.errorMessage,
    summary: {
      totalPay: normalizeMoney(fixedPay + videoPay),
      fixedPay: normalizeMoney(fixedPay),
      videoFixedPay,
      cpmPay,
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
      videoDealOverrides: creators.reduce(
        (total, creator) => total + creator.videoDealOverrideCount,
        0,
      ),
    },
    creators,
    videos,
  };
}
