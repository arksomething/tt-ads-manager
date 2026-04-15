import { Platform, SparkAuthorizationStatus } from "@/lib/prisma-shim";

import { prisma } from "@/lib/db";
import { requireOrganizationMembership } from "@/server/auth/organizations";

import {
  getAdProfitabilityReportForAdvertiser,
  type TikTokAdAttributionMatchMode,
  type TikTokAdProfitabilityReport,
} from "./ad-profitability";
import { requestTikTokBusinessApi } from "./client";

const MAX_REPORT_PAGES = 20;
const REPORT_PAGE_SIZE = 1_000;

const paidViewMetricMap = {
  impressions: "impressions",
  videoPlayActions: "video_play_actions",
} as const;

export type TikTokPaidViewMetric = keyof typeof paidViewMetricMap;

type QueryDateInput = Date | string;

type GetPaidViewsForCreatorArgs = {
  organizationSlug: string;
  creatorId: string;
  startDate: QueryDateInput;
  endDate: QueryDateInput;
  metric?: TikTokPaidViewMetric;
};

type GetPaidViewsForCreatorByNameArgs = {
  organizationSlug: string;
  creatorName: string;
  startDate: QueryDateInput;
  endDate: QueryDateInput;
  metric?: TikTokPaidViewMetric;
};

type CreatorLookupRecord = {
  id: string;
  displayName: string;
  platformAccounts: Array<{
    platform: Platform;
    handle: string;
  }>;
};

type TikTokIntegratedReportRow = Record<string, unknown> & {
  dimensions?: Record<string, unknown>;
  metrics?: Record<string, unknown>;
};

type TikTokIntegratedReportData = {
  list?: TikTokIntegratedReportRow[];
  page_info?: Record<string, unknown>;
  total_metrics?: Record<string, unknown>;
};

type TikTokPaidViewsRow = {
  adId: string | null;
  itemId: string | null;
  statDate: string | null;
  metricValue: number;
  raw: Record<string, unknown>;
};

export type TikTokCreatorPaidViewsResult = {
  creator: {
    id: string;
    displayName: string;
    tiktokHandle: string | null;
  };
  advertiserId: string;
  metric: TikTokPaidViewMetric;
  startDate: string;
  endDate: string;
  paidViews: number;
  matchedSparkItemIds: string[];
  rowCount: number;
  rows: TikTokPaidViewsRow[];
  warnings: string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeLookupValue(value: string) {
  return value.trim().toLowerCase().replace(/^@/, "");
}

function parseDateInput(value: QueryDateInput, label: string) {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new Error(`Invalid ${label}.`);
    }

    return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  }

  const normalized = value.trim();

  if (normalized.length === 0) {
    throw new Error(`Missing ${label}.`);
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return new Date(`${normalized}T00:00:00.000Z`);
  }

  const parsed = new Date(normalized);

  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid ${label}.`);
  }

  return new Date(
    Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate()),
  );
}

function toDateOnlyString(value: Date) {
  return value.toISOString().slice(0, 10);
}

function getPrimaryTikTokHandle(creator: CreatorLookupRecord) {
  return (
    creator.platformAccounts.find((account) => account.platform === Platform.TIKTOK)?.handle ??
    null
  );
}

function getFirstString(records: Array<Record<string, unknown> | null>, keys: string[]) {
  for (const record of records) {
    if (!record) {
      continue;
    }

    for (const key of keys) {
      const value = record[key];

      if (typeof value === "string" && value.trim().length > 0) {
        return value;
      }

      if (typeof value === "number" && Number.isFinite(value)) {
        return String(value);
      }
    }
  }

  return null;
}

function getFirstNumber(records: Array<Record<string, unknown> | null>, keys: string[]) {
  for (const record of records) {
    if (!record) {
      continue;
    }

    for (const key of keys) {
      const value = record[key];
      const numberValue =
        typeof value === "number"
          ? value
          : typeof value === "string"
            ? Number(value)
            : null;

      if (typeof numberValue === "number" && Number.isFinite(numberValue)) {
        return numberValue;
      }
    }
  }

  return 0;
}

function getReportRows(payload: TikTokIntegratedReportData) {
  if (!Array.isArray(payload.list)) {
    return [];
  }

  return payload.list.filter(isRecord);
}

function getTotalPages(payload: TikTokIntegratedReportData, currentRows: number) {
  const pageInfo = isRecord(payload.page_info) ? payload.page_info : null;
  const totalPages = getFirstNumber([pageInfo], ["total_page", "total_pages"]);

  if (totalPages > 0) {
    return Math.max(1, Math.trunc(totalPages));
  }

  return currentRows < REPORT_PAGE_SIZE ? 1 : MAX_REPORT_PAGES;
}

function normalizeReportRow(row: TikTokIntegratedReportRow, apiMetricName: string): TikTokPaidViewsRow {
  const dimensions = isRecord(row.dimensions) ? row.dimensions : null;
  const metrics = isRecord(row.metrics) ? row.metrics : null;

  return {
    adId: getFirstString([dimensions, row], ["ad_id", "adId"]),
    itemId: getFirstString([dimensions, row], ["item_id", "itemId"]),
    statDate: getFirstString([dimensions, row], ["stat_time_day", "statTimeDay"]),
    metricValue: getFirstNumber([metrics, row], [apiMetricName]),
    raw: row,
  };
}

function uniqueNonEmptyStrings(values: Array<string | null | undefined>) {
  return [...new Set(values.filter((value): value is string => Boolean(value && value.trim())))];
}

async function getOrgTikTokAccount(organizationId: string) {
  const activeAccount = await prisma.organizationTikTokAccount.findFirst({
    where: {
      organizationId,
      status: "ACTIVE",
    },
    orderBy: [{ updatedAt: "desc" }],
    select: {
      advertiserId: true,
      accessToken: true,
      status: true,
      lastValidatedAt: true,
    },
  });

  if (activeAccount) {
    return {
      account: activeAccount,
      warnings: [] as string[],
    };
  }

  const latestAccount = await prisma.organizationTikTokAccount.findFirst({
    where: {
      organizationId,
    },
    orderBy: [{ updatedAt: "desc" }],
    select: {
      advertiserId: true,
      accessToken: true,
      status: true,
      lastValidatedAt: true,
    },
  });

  if (!latestAccount) {
    throw new Error(
      "No TikTok advertiser account is configured for this organization. Add an advertiser ID and access token in Integrations first.",
    );
  }

  return {
    account: latestAccount,
    warnings: [
      `Using the latest TikTok account even though its status is ${latestAccount.status}.`,
    ],
  };
}

async function resolveCreatorById(args: {
  organizationId: string;
  creatorId: string;
}): Promise<CreatorLookupRecord> {
  const creator = await prisma.creator.findFirst({
    where: {
      id: args.creatorId,
      organizationId: args.organizationId,
    },
    select: {
      id: true,
      displayName: true,
      platformAccounts: {
        where: {
          platform: Platform.TIKTOK,
        },
        select: {
          platform: true,
          handle: true,
        },
        orderBy: [{ handle: "asc" }],
      },
    },
  });

  if (!creator) {
    throw new Error("Creator not found in this organization.");
  }

  return creator;
}

async function resolveCreatorByName(args: {
  organizationId: string;
  creatorName: string;
}): Promise<CreatorLookupRecord> {
  if (args.creatorName.trim().length === 0) {
    throw new Error("Creator name is required.");
  }

  const lookupValue = normalizeLookupValue(args.creatorName);
  const directMatches = await prisma.creator.findMany({
    where: {
      organizationId: args.organizationId,
      OR: [
        {
          displayName: {
            equals: args.creatorName.trim(),
            mode: "insensitive",
          },
        },
        {
          platformAccounts: {
            some: {
              platform: Platform.TIKTOK,
              handle: {
                equals: lookupValue,
                mode: "insensitive",
              },
            },
          },
        },
      ],
    },
    select: {
      id: true,
      displayName: true,
      platformAccounts: {
        where: {
          platform: Platform.TIKTOK,
        },
        select: {
          platform: true,
          handle: true,
        },
        orderBy: [{ handle: "asc" }],
      },
    },
    take: 10,
  });

  const exactDisplayMatches = directMatches.filter(
    (creator) => normalizeLookupValue(creator.displayName) === lookupValue,
  );

  if (exactDisplayMatches.length === 1) {
    return exactDisplayMatches[0];
  }

  const exactHandleMatches = directMatches.filter(
    (creator) => normalizeLookupValue(getPrimaryTikTokHandle(creator) ?? "") === lookupValue,
  );

  if (exactHandleMatches.length === 1) {
    return exactHandleMatches[0];
  }

  if (directMatches.length === 1) {
    return directMatches[0];
  }

  if (directMatches.length > 1) {
    throw new Error(
      `Multiple creators matched "${args.creatorName}". Use the creator ID or exact TikTok handle instead.`,
    );
  }

  const fuzzyMatches = await prisma.creator.findMany({
    where: {
      organizationId: args.organizationId,
      OR: [
        {
          displayName: {
            contains: args.creatorName.trim(),
            mode: "insensitive",
          },
        },
        {
          platformAccounts: {
            some: {
              platform: Platform.TIKTOK,
              handle: {
                contains: lookupValue,
                mode: "insensitive",
              },
            },
          },
        },
      ],
    },
    select: {
      id: true,
      displayName: true,
      platformAccounts: {
        where: {
          platform: Platform.TIKTOK,
        },
        select: {
          platform: true,
          handle: true,
        },
        orderBy: [{ handle: "asc" }],
      },
    },
    take: 10,
  });

  if (fuzzyMatches.length === 1) {
    return fuzzyMatches[0];
  }

  if (fuzzyMatches.length === 0) {
    throw new Error(`No creator matched "${args.creatorName}" in this organization.`);
  }

  throw new Error(
    `Multiple creators matched "${args.creatorName}". Use the creator ID or exact TikTok handle instead.`,
  );
}

async function getCreatorSparkItemIds(args: {
  organizationId: string;
  creatorId: string;
  advertiserId: string;
  startDate: Date;
  endDate: Date;
}) {
  const authorizations = await prisma.sparkAuthorization.findMany({
    where: {
      organizationId: args.organizationId,
      creatorId: args.creatorId,
      advertiserId: args.advertiserId,
      status: SparkAuthorizationStatus.AUTHORIZED,
      tiktokItemId: {
        not: null,
      },
      OR: [
        {
          authStartTime: null,
        },
        {
          authStartTime: {
            lte: args.endDate,
          },
        },
      ],
      AND: [
        {
          OR: [
            {
              authEndTime: null,
            },
            {
              authEndTime: {
                gte: args.startDate,
              },
            },
          ],
        },
      ],
    },
    select: {
      tiktokItemId: true,
    },
  });

  return uniqueNonEmptyStrings(authorizations.map((authorization) => authorization.tiktokItemId));
}

async function fetchPaidReportRows(args: {
  advertiserId: string;
  accessToken: string;
  startDate: string;
  endDate: string;
  metric: TikTokPaidViewMetric;
}) {
  const apiMetricName = paidViewMetricMap[args.metric];
  const rows: TikTokIntegratedReportRow[] = [];
  const warnings: string[] = [];
  let totalPages = 1;

  for (let page = 1; page <= totalPages && page <= MAX_REPORT_PAGES; page += 1) {
    const payload = await requestTikTokBusinessApi<TikTokIntegratedReportData>({
      accessToken: args.accessToken,
      method: "GET",
      path: "/open_api/v1.3/report/integrated/get/",
      query: {
        report_type: "BASIC",
        advertiser_id: args.advertiserId,
        data_level: "AUCTION_AD",
        dimensions: ["stat_time_day", "ad_id", "item_id"],
        metrics: [apiMetricName],
        start_date: args.startDate,
        end_date: args.endDate,
        page,
        page_size: REPORT_PAGE_SIZE,
      },
    });

    const pageRows = getReportRows(payload);
    rows.push(...pageRows);
    totalPages = getTotalPages(payload, pageRows.length);

    if (pageRows.length < REPORT_PAGE_SIZE) {
      break;
    }
  }

  if (totalPages > MAX_REPORT_PAGES) {
    warnings.push(
      `TikTok reporting returned more than ${MAX_REPORT_PAGES} pages. The result may be truncated.`,
    );
  }

  return {
    rows,
    apiMetricName,
    warnings,
  };
}

export async function getPaidViewsForCreatorForOrganization(
  args: GetPaidViewsForCreatorArgs,
): Promise<TikTokCreatorPaidViewsResult> {
  const membership = await requireOrganizationMembership(args.organizationSlug);
  const creator = await resolveCreatorById({
    organizationId: membership.organizationId,
    creatorId: args.creatorId,
  });
  const startDate = parseDateInput(args.startDate, "start date");
  const endDate = parseDateInput(args.endDate, "end date");

  if (endDate < startDate) {
    throw new Error("End date must be on or after start date.");
  }

  const metric = args.metric ?? "impressions";
  const { account, warnings } = await getOrgTikTokAccount(membership.organizationId);
  const itemIds = await getCreatorSparkItemIds({
    organizationId: membership.organizationId,
    creatorId: creator.id,
    advertiserId: account.advertiserId,
    startDate,
    endDate,
  });

  if (itemIds.length === 0) {
    return {
      creator: {
        id: creator.id,
        displayName: creator.displayName,
        tiktokHandle: getPrimaryTikTokHandle(creator),
      },
      advertiserId: account.advertiserId,
      metric,
      startDate: toDateOnlyString(startDate),
      endDate: toDateOnlyString(endDate),
      paidViews: 0,
      matchedSparkItemIds: [],
      rowCount: 0,
      rows: [],
      warnings: [
        ...warnings,
        "No authorized Spark item IDs were found for this creator in the requested date window.",
      ],
    };
  }

  const report = await fetchPaidReportRows({
    advertiserId: account.advertiserId,
    accessToken: account.accessToken,
    startDate: toDateOnlyString(startDate),
    endDate: toDateOnlyString(endDate),
    metric,
  });
  const normalizedRows = report.rows.map((row) =>
    normalizeReportRow(row, report.apiMetricName),
  );
  const itemIdSet = new Set(itemIds);
  const rowsIncludeItemIds = normalizedRows.some((row) => row.itemId !== null);
  const rowsIncludeAdIds = normalizedRows.some((row) => row.adId !== null);
  const scopedRows = rowsIncludeItemIds
    ? normalizedRows.filter((row) => row.itemId !== null && itemIdSet.has(row.itemId))
    : [];
  const paidViews = scopedRows.reduce((total, row) => total + row.metricValue, 0);

  return {
    creator: {
      id: creator.id,
      displayName: creator.displayName,
      tiktokHandle: getPrimaryTikTokHandle(creator),
    },
    advertiserId: account.advertiserId,
    metric,
    startDate: toDateOnlyString(startDate),
    endDate: toDateOnlyString(endDate),
    paidViews,
    matchedSparkItemIds: itemIds,
    rowCount: scopedRows.length,
    rows: scopedRows,
    warnings: rowsIncludeItemIds
      ? [...warnings, ...report.warnings]
      : [
          ...warnings,
          ...report.warnings,
          rowsIncludeAdIds
            ? "TikTok report rows did not include item_id, so this creator lookup returned 0 rows rather than guess from ad-level data."
            : "TikTok report rows did not include item_id or ad_id, so this creator lookup could not be safely scoped.",
        ],
  };
}

export async function getPaidViewsForCreatorByNameForOrganization(
  args: GetPaidViewsForCreatorByNameArgs,
) {
  const membership = await requireOrganizationMembership(args.organizationSlug);
  const creator = await resolveCreatorByName({
    organizationId: membership.organizationId,
    creatorName: args.creatorName,
  });

  return getPaidViewsForCreatorForOrganization({
    organizationSlug: args.organizationSlug,
    creatorId: creator.id,
    startDate: args.startDate,
    endDate: args.endDate,
    metric: args.metric,
  });
}

export async function getTopAdsForOrganization(args: {
  organizationSlug: string;
  startDate: QueryDateInput;
  endDate: QueryDateInput;
  metric?: TikTokPaidViewMetric;
  matchMode?: TikTokAdAttributionMatchMode;
}): Promise<TikTokAdProfitabilityReport> {
  const membership = await requireOrganizationMembership(args.organizationSlug);
  const { account, warnings } = await getOrgTikTokAccount(membership.organizationId);
  const report = await getAdProfitabilityReportForAdvertiser({
    advertiserId: account.advertiserId,
    accessToken: account.accessToken,
    startDate: args.startDate,
    endDate: args.endDate,
    metric: args.metric,
    matchMode: args.matchMode,
  });

  return {
    ...report,
    warnings: [...warnings, ...report.warnings],
  };
}
