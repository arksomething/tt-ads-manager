import { requireOrganizationMembership } from "@/server/auth/organizations";
import {
  getViewsBaseCredentials,
  type ViewsBaseCredentialValue,
} from "@/server/settings/managed-secrets";

import { viewsBaseClient } from "./client";
import {
  applyFacelessPricingToCreatorRows,
  applyFacelessPricingToDailyRows,
  buildCreatorRowsFromSpend,
  buildDailyRowsFromSpend,
  type ViewsBaseCreatorSpendRow,
  type ViewsBaseDailySpendApiRow,
  type ViewsBaseDailySpendRow,
} from "./faceless-calculations";

const VIEWSBASE_PAGE_SIZE = 100;
const MAX_VIEWSBASE_PAGES = 50;
const DEFAULT_WINDOW_DAYS = 7;
const ALL_CAMPAIGNS_SLUG = "all";
const DEFAULT_SEED_CAMPAIGN_SLUG = "gotall-larsie";

export type ViewsBaseCampaignMetadata = {
  id: string;
  name: string;
  slug: string;
  orgSlug: string;
  countingWindowDays: number | null;
};

export type ViewsBaseCampaignOption = Pick<
  ViewsBaseCampaignMetadata,
  "id" | "name" | "slug"
>;

type ViewsBaseStatsResponse = {
  totalVideos?: number | null;
  totalPending?: number | null;
  totalPaid?: number | null;
  pendingCPM?: number | null;
};

type ViewsBaseAnalyticsDailyRow = {
  date?: string | null;
  views?: number | null;
  likes?: number | null;
  comments?: number | null;
  shares?: number | null;
};

type ViewsBaseAnalyticsResponse = {
  stats?: {
    total_videos?: number | null;
    active_creators?: number | null;
    total_views?: number | null;
    avg_views_per_video?: number | null;
    total_comments?: number | null;
    engagement_rate?: number | null;
  } | null;
  daily_series?: ViewsBaseAnalyticsDailyRow[] | null;
  creator_daily_series?: Array<Record<string, unknown>> | null;
  creator_series_keys?: string[] | null;
  top_creators?: Array<{
    handle?: string | null;
    name?: string | null;
    total_views?: number | null;
    video_count?: number | null;
    share_of_views?: number | null;
  }> | null;
  meta?: {
    last_updated?: string | null;
  } | null;
};

type ViewsBaseInfluencer = {
  id?: string | null;
  name?: string | null;
  handle?: string | null;
  platform?: string | null;
};

type ViewsBaseVideoRow = {
  id?: string | null;
  influencer_id?: string | null;
  url?: string | null;
  posted_at?: string | null;
  current_views?: number | null;
  finalized_views?: number | null;
  finalized_amount?: number | null;
  status?: string | null;
  paid_at?: string | null;
  platform?: string | null;
  platform_post_id?: string | null;
  effective_cpm?: number | null;
  effective_cap?: number | null;
  counting_window_days?: number | null;
  influencer?: ViewsBaseInfluencer | null;
};

type ViewsBaseVideosResponse = {
  videos?: ViewsBaseVideoRow[];
  pagination?: {
    total?: number | null;
    totalPages?: number | null;
  } | null;
};

type ViewsBasePaymentSummaryResponse = {
  summary?: Array<{
    influencer_id?: string | null;
    influencer_name?: string | null;
    handle?: string | null;
    platform?: string | null;
    pending_count?: number | null;
    pending_amount?: number | null;
    finalized_count?: number | null;
    finalized_amount?: number | null;
    paid_count?: number | null;
    paid_amount?: number | null;
    total_earnings?: number | null;
  }>;
};

type ViewsBaseDailySpendResponse = {
  rows?: ViewsBaseDailySpendApiRow[];
};

export type ViewsBaseFacelessReport = {
  campaign: ViewsBaseCampaignMetadata;
  campaignOptions: ViewsBaseCampaignOption[];
  selectedCampaignSlugs: string[];
  isAggregate: boolean;
  requestedRange: {
    startDate: string;
    endDate: string;
  };
  stats: {
    totalVideos: number;
    totalPending: number;
    totalPaid: number;
    pendingCpm: number | null;
    activeCreators: number;
    totalViewsInRange: number;
    avgViewsPerVideo: number;
    engagementRate: number | null;
    lastUpdated: string | null;
  };
  totals: {
    rangeViews: number;
    baseTotalSpend: number;
    totalSpend: number;
    projectedSpend: number;
    managementFee: number;
    cpmManagementFee: number;
    fixedManagementFee: number;
    dashboardFee: number;
    rawVideoCount: number;
    paymentSummaryRows: number;
  };
  dailyRows: ViewsBaseDailySpendRow[];
  creatorRows: ViewsBaseCreatorSpendRow[];
  paymentRows: NonNullable<ViewsBasePaymentSummaryResponse["summary"]>;
};

function normalizeText(value: unknown) {
  if (value === null || value === undefined) {
    return null;
  }

  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function toFiniteNumber(value: unknown, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function roundCurrency(value: number) {
  return Math.round(value * 100) / 100;
}

function getSpendTotals(dailyRows: ViewsBaseDailySpendRow[]) {
  return {
    baseTotalSpend: roundCurrency(
      dailyRows.reduce((sum, row) => sum + row.baseTotalSpend, 0),
    ),
    cpmManagementFee: roundCurrency(
      dailyRows.reduce((sum, row) => sum + row.cpmManagementFee, 0),
    ),
    dashboardFee: roundCurrency(
      dailyRows.reduce((sum, row) => sum + row.dashboardFee, 0),
    ),
    fixedManagementFee: roundCurrency(
      dailyRows.reduce((sum, row) => sum + row.fixedManagementFee, 0),
    ),
    managementFee: roundCurrency(
      dailyRows.reduce((sum, row) => sum + row.managementFee, 0),
    ),
    projectedSpend: roundCurrency(
      dailyRows.reduce((sum, row) => sum + row.projectedSpend, 0),
    ),
    totalSpend: roundCurrency(
      dailyRows.reduce((sum, row) => sum + row.totalSpend, 0),
    ),
  };
}

function normalizeDateInput(value: string | null | undefined) {
  const text = normalizeText(value);

  if (!text || !/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return null;
  }

  return text;
}

function formatUtcDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function getDefaultViewsBaseRange(referenceDate = new Date()) {
  const endDate = new Date(
    Date.UTC(
      referenceDate.getUTCFullYear(),
      referenceDate.getUTCMonth(),
      referenceDate.getUTCDate(),
    ),
  );
  const startDate = new Date(endDate);
  startDate.setUTCDate(startDate.getUTCDate() - (DEFAULT_WINDOW_DAYS - 1));

  return {
    startDate: formatUtcDate(startDate),
    endDate: formatUtcDate(endDate),
  };
}

function parseCampaignMetadataFromHtml(args: {
  html: string;
  orgSlug: string;
  campaignSlug: string;
}) {
  const normalizedHtml = normalizeViewsBaseHtml(args.html);
  const match =
    normalizedHtml.match(
      /"campaign":\{"id":"([^"]+)","name":"([^"]+)","slug":"([^"]+)"([^}]*)\}/,
    ) ??
    normalizedHtml.match(
      /campaign:\{id:"([^"]+)",name:"([^"]+)",slug:"([^"]+)"([^}]*)\}/,
    );

  if (!match?.[1] || !match[2] || !match[3]) {
    throw new Error(
      `Could not resolve the ViewsBase campaign for ${args.orgSlug}/${args.campaignSlug}.`,
    );
  }

  const countingWindowMatch = match[4]?.match(/"counting_window_days":(\d+)/);

  return {
    id: match[1],
    name: match[2],
    slug: match[3],
    orgSlug: args.orgSlug,
    countingWindowDays: countingWindowMatch?.[1]
      ? Number.parseInt(countingWindowMatch[1], 10)
      : null,
  } satisfies ViewsBaseCampaignMetadata;
}

function normalizeViewsBaseHtml(html: string) {
  return html.replace(/\\"/g, '"').replace(/\\u0026/g, "&");
}

function parseCampaignOptionsFromHtml(html: string) {
  const normalizedHtml = normalizeViewsBaseHtml(html);
  const campaigns = new Map<string, ViewsBaseCampaignOption>();
  const campaignsPayload =
    normalizedHtml.match(/"campaigns":\[([\s\S]*?)\],"userOrgs"/)?.[1] ??
    normalizedHtml;

  for (const match of campaignsPayload.matchAll(
    /\{"id":"([^"]+)","name":"([^"]+)","slug":"([^"]+)"/g,
  )) {
    if (match[1] && match[2] && match[3] && !campaigns.has(match[3])) {
      campaigns.set(match[3], {
        id: match[1],
        name: match[2],
        slug: match[3],
      });
    }
  }

  return [...campaigns.values()];
}

async function fetchViewsBaseCampaignPage(args: {
  orgSlug: string;
  campaignSlug: string;
  credentials?: ViewsBaseCredentialValue;
}) {
  return viewsBaseClient.requestText({
    path: `/${args.orgSlug}/${args.campaignSlug}`,
    headers: {
      "x-org-slug": args.orgSlug,
    },
    credentials: args.credentials,
  });
}

async function resolveViewsBaseCampaignPage(args: {
  orgSlug: string;
  campaignSlug: string;
  credentials?: ViewsBaseCredentialValue;
}) {
  const html = await fetchViewsBaseCampaignPage(args);

  return {
    campaign: parseCampaignMetadataFromHtml({
      html,
      orgSlug: args.orgSlug,
      campaignSlug: args.campaignSlug,
    }),
    campaignOptions: parseCampaignOptionsFromHtml(html),
  };
}

export async function resolveViewsBaseCampaignMetadata(args: {
  orgSlug: string;
  campaignSlug: string;
  credentials?: ViewsBaseCredentialValue;
}) {
  return (await resolveViewsBaseCampaignPage(args)).campaign;
}

async function fetchViewsBaseCampaignVideos(
  campaign: ViewsBaseCampaignMetadata,
  credentials?: ViewsBaseCredentialValue,
) {
  const videos: ViewsBaseVideoRow[] = [];

  for (let page = 1; page <= MAX_VIEWSBASE_PAGES; page += 1) {
    const payload = await viewsBaseClient.requestJson<ViewsBaseVideosResponse>({
      path: "/api/dashboard/videos",
      query: {
        page,
        limit: VIEWSBASE_PAGE_SIZE,
        campaign_id: campaign.id,
      },
      headers: {
        "x-org-slug": campaign.orgSlug,
      },
      credentials,
    });
    const pageVideos = Array.isArray(payload.videos) ? payload.videos : [];

    videos.push(...pageVideos);

    if (
      pageVideos.length < VIEWSBASE_PAGE_SIZE ||
      (payload.pagination?.totalPages && page >= payload.pagination.totalPages)
    ) {
      break;
    }
  }

  return videos;
}

function calculateVideoProjectedSpend(video: ViewsBaseVideoRow) {
  const finalizedAmount = toFiniteNumber(video.finalized_amount, Number.NaN);

  if (Number.isFinite(finalizedAmount) && finalizedAmount > 0) {
    return finalizedAmount;
  }

  const cpm = toFiniteNumber(video.effective_cpm, Number.NaN);

  if (!Number.isFinite(cpm) || cpm <= 0) {
    return 0;
  }

  const views = Math.max(
    0,
    toFiniteNumber(video.finalized_views ?? video.current_views, 0),
  );
  const cap = toFiniteNumber(video.effective_cap, Number.NaN);
  const payableViews = Number.isFinite(cap) && cap > 0 ? Math.min(views, cap) : views;

  return (payableViews * cpm) / 1000;
}

async function fetchViewsBaseDailySpend(args: {
  orgSlug: string;
  campaignId?: string | null;
  startDate: string;
  endDate: string;
  credentials?: ViewsBaseCredentialValue;
}) {
  const payload = await viewsBaseClient.requestJson<ViewsBaseDailySpendResponse>({
    path: "/api/payment-summary/daily-spend",
    query: {
      campaign_id: args.campaignId,
    },
    headers: {
      "x-org-slug": args.orgSlug,
    },
    credentials: args.credentials,
  });
  const startDate = normalizeDateInput(args.startDate) ?? args.startDate;
  const endDate = normalizeDateInput(args.endDate) ?? args.endDate;

  return (payload.rows ?? []).filter((row) => {
    const date = normalizeText(row.date);

    return date != null && date >= startDate && date <= endDate;
  });
}

async function getSingleViewsBaseFacelessReport(args: {
  campaign: ViewsBaseCampaignMetadata;
  campaignOptions: ViewsBaseCampaignOption[];
  startDate: string;
  endDate: string;
  credentials: ViewsBaseCredentialValue;
}) {
  const headers = {
    "x-org-slug": args.campaign.orgSlug,
  };
  const [stats, analytics, videos, paymentSummary, dailySpendRows] = await Promise.all([
    viewsBaseClient.requestJson<ViewsBaseStatsResponse>({
      path: "/api/stats",
      query: {
        campaign_id: args.campaign.id,
      },
      headers,
      credentials: args.credentials,
    }),
    viewsBaseClient.requestJson<ViewsBaseAnalyticsResponse>({
      path: "/api/analytics/campaign",
      query: {
        campaign_id: args.campaign.id,
        start_date: args.startDate,
        end_date: args.endDate,
      },
      headers,
      credentials: args.credentials,
    }),
    fetchViewsBaseCampaignVideos(args.campaign, args.credentials),
    viewsBaseClient.requestJson<ViewsBasePaymentSummaryResponse>({
      path: "/api/payment-summary",
      query: {
        campaign_id: args.campaign.id,
      },
      headers,
      credentials: args.credentials,
    }),
    fetchViewsBaseDailySpend({
      orgSlug: args.campaign.orgSlug,
      campaignId: args.campaign.id,
      startDate: args.startDate,
      endDate: args.endDate,
      credentials: args.credentials,
    }),
  ]);
  const dailyRows = applyFacelessPricingToDailyRows({
    campaignSlug: args.campaign.slug,
    endDate: args.endDate,
    rows: buildDailyRowsFromSpend(dailySpendRows),
    startDate: args.startDate,
  });
  const creatorRows = applyFacelessPricingToCreatorRows({
    campaignSlug: args.campaign.slug,
    rows: buildCreatorRowsFromSpend(dailySpendRows),
  });
  const fallbackProjectedSpend = videos.reduce(
    (sum, video) => sum + calculateVideoProjectedSpend(video),
    0,
  );
  const rangeViews = dailyRows.reduce((sum, row) => sum + row.views, 0);
  const spendTotals = getSpendTotals(dailyRows);

  return {
    campaign: args.campaign,
    campaignOptions: args.campaignOptions,
    selectedCampaignSlugs: [args.campaign.slug],
    isAggregate: false,
    requestedRange: {
      startDate: args.startDate,
      endDate: args.endDate,
    },
    stats: {
      totalVideos: Math.round(toFiniteNumber(stats.totalVideos, 0)),
      totalPending: roundCurrency(toFiniteNumber(stats.totalPending, 0)),
      totalPaid: roundCurrency(toFiniteNumber(stats.totalPaid, 0)),
      pendingCpm:
        stats.pendingCPM === null || stats.pendingCPM === undefined
          ? null
          : toFiniteNumber(stats.pendingCPM, 0),
      activeCreators: Math.round(
        creatorRows.length || toFiniteNumber(analytics.stats?.active_creators, 0),
      ),
      totalViewsInRange: Math.round(
        rangeViews || toFiniteNumber(analytics.stats?.total_views, 0),
      ),
      avgViewsPerVideo: Math.round(
        toFiniteNumber(analytics.stats?.avg_views_per_video, 0),
      ),
      engagementRate:
        analytics.stats?.engagement_rate === null ||
        analytics.stats?.engagement_rate === undefined
          ? null
          : toFiniteNumber(analytics.stats.engagement_rate, 0),
      lastUpdated: normalizeText(analytics.meta?.last_updated),
    },
    totals: {
      rangeViews,
      ...spendTotals,
      projectedSpend:
        spendTotals.projectedSpend > 0
          ? spendTotals.projectedSpend
          : roundCurrency(fallbackProjectedSpend),
      rawVideoCount: videos.length,
      paymentSummaryRows: paymentSummary.summary?.length ?? 0,
    },
    dailyRows,
    creatorRows,
    paymentRows: paymentSummary.summary ?? [],
  } satisfies ViewsBaseFacelessReport;
}

function aggregateDailyRows(reports: ViewsBaseFacelessReport[]) {
  const rowsByDate = new Map<string, ViewsBaseDailySpendRow>();

  for (const report of reports) {
    for (const row of report.dailyRows) {
      const existing =
        rowsByDate.get(row.date) ??
        ({
          date: row.date,
          views: 0,
          likes: 0,
          comments: 0,
          shares: 0,
          baseTotalSpend: 0,
          baseActualSpend: 0,
          baseProjectedSpend: 0,
          totalSpend: 0,
          actualSpend: 0,
          projectedSpend: 0,
          managementFee: 0,
          cpmManagementFee: 0,
          fixedManagementFee: 0,
          dashboardFee: 0,
          projectedSpendIsEstimated: true,
          creatorCount: 0,
          status: "none",
        } satisfies ViewsBaseDailySpendRow);

      existing.views += row.views;
      existing.likes += row.likes;
      existing.comments += row.comments;
      existing.shares += row.shares;
      existing.baseTotalSpend = roundCurrency(
        existing.baseTotalSpend + row.baseTotalSpend,
      );
      existing.baseActualSpend = roundCurrency(
        existing.baseActualSpend + row.baseActualSpend,
      );
      existing.baseProjectedSpend = roundCurrency(
        existing.baseProjectedSpend + row.baseProjectedSpend,
      );
      existing.totalSpend = roundCurrency(existing.totalSpend + row.totalSpend);
      existing.actualSpend = roundCurrency(existing.actualSpend + row.actualSpend);
      existing.projectedSpend = roundCurrency(
        existing.projectedSpend + row.projectedSpend,
      );
      existing.managementFee = roundCurrency(
        existing.managementFee + row.managementFee,
      );
      existing.cpmManagementFee = roundCurrency(
        existing.cpmManagementFee + row.cpmManagementFee,
      );
      existing.fixedManagementFee = roundCurrency(
        existing.fixedManagementFee + row.fixedManagementFee,
      );
      existing.dashboardFee = roundCurrency(existing.dashboardFee + row.dashboardFee);
      existing.creatorCount += row.creatorCount;
      existing.status =
        existing.status === "none" || existing.status === row.status
          ? row.status
          : "mixed";
      rowsByDate.set(row.date, existing);
    }
  }

  return [...rowsByDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function aggregateCreatorRows(reports: ViewsBaseFacelessReport[], totalViews: number) {
  const rowsByHandle = new Map<
    string,
    {
      handle: string;
      name: string;
      views: number;
      videoCount: number;
      baseTotalSpend: number;
      totalSpend: number;
      actualSpend: number;
      projectedSpend: number;
      managementFee: number;
    }
  >();

  for (const report of reports) {
    for (const row of report.creatorRows) {
      const existing =
        rowsByHandle.get(row.handle) ??
        ({
          handle: row.handle,
          name: row.name,
          views: 0,
          videoCount: 0,
          baseTotalSpend: 0,
          totalSpend: 0,
          actualSpend: 0,
          projectedSpend: 0,
          managementFee: 0,
        });

      existing.views += row.views;
      existing.videoCount += row.videoCount;
      existing.baseTotalSpend = roundCurrency(
        existing.baseTotalSpend + row.baseTotalSpend,
      );
      existing.totalSpend = roundCurrency(existing.totalSpend + row.totalSpend);
      existing.actualSpend = roundCurrency(existing.actualSpend + row.actualSpend);
      existing.projectedSpend = roundCurrency(
        existing.projectedSpend + row.projectedSpend,
      );
      existing.managementFee = roundCurrency(
        existing.managementFee + row.managementFee,
      );
      rowsByHandle.set(row.handle, existing);
    }
  }

  return [...rowsByHandle.values()]
    .map((row) => ({
      ...row,
      shareOfViews: totalViews > 0 ? (row.views / totalViews) * 100 : null,
      effectiveCpm:
        row.views > 0 ? roundCurrency((row.totalSpend / row.views) * 1000) : null,
    }))
    .sort((a, b) => b.totalSpend - a.totalSpend) satisfies ViewsBaseCreatorSpendRow[];
}

function aggregateReports(args: {
  reports: ViewsBaseFacelessReport[];
  campaignOptions: ViewsBaseCampaignOption[];
  orgSlug: string;
  startDate: string;
  endDate: string;
}) {
  const dailyRows = aggregateDailyRows(args.reports);
  const rangeViews = dailyRows.reduce((sum, row) => sum + row.views, 0);
  const rawVideoCount = args.reports.reduce(
    (sum, report) => sum + report.totals.rawVideoCount,
    0,
  );
  const totalVideos = args.reports.reduce(
    (sum, report) => sum + report.stats.totalVideos,
    0,
  );
  const spendTotals = getSpendTotals(dailyRows);
  const totalPending = args.reports.reduce(
    (sum, report) => sum + report.stats.totalPending,
    0,
  );
  const totalPaid = args.reports.reduce(
    (sum, report) => sum + report.stats.totalPaid,
    0,
  );
  const latestUpdated = args.reports
    .map((report) => report.stats.lastUpdated)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1);
  const creatorRows = aggregateCreatorRows(args.reports, rangeViews);
  const engagementRates = args.reports
    .map((report) => report.stats.engagementRate)
    .filter((value): value is number => value != null);
  const pendingCpms = args.reports
    .map((report) => report.stats.pendingCpm)
    .filter((value): value is number => value != null);

  return {
    campaign: {
      id: ALL_CAMPAIGNS_SLUG,
      name: "All campaigns",
      slug: ALL_CAMPAIGNS_SLUG,
      orgSlug: args.orgSlug,
      countingWindowDays: null,
    },
    campaignOptions: args.campaignOptions,
    selectedCampaignSlugs: args.reports.map((report) => report.campaign.slug),
    isAggregate: true,
    requestedRange: {
      startDate: args.startDate,
      endDate: args.endDate,
    },
    stats: {
      totalVideos,
      totalPending: roundCurrency(totalPending),
      totalPaid: roundCurrency(totalPaid),
      pendingCpm:
        pendingCpms.length > 0
          ? pendingCpms.reduce((sum, value) => sum + value, 0) / pendingCpms.length
          : null,
      activeCreators: creatorRows.length,
      totalViewsInRange: rangeViews,
      avgViewsPerVideo:
        totalVideos > 0 ? Math.round(rangeViews / totalVideos) : 0,
      engagementRate:
        engagementRates.length > 0
          ? engagementRates.reduce((sum, value) => sum + value, 0) /
            engagementRates.length
          : null,
      lastUpdated: latestUpdated ?? null,
    },
    totals: {
      rangeViews,
      ...spendTotals,
      rawVideoCount,
      paymentSummaryRows: args.reports.reduce(
        (sum, report) => sum + report.totals.paymentSummaryRows,
        0,
      ),
    },
    dailyRows,
    creatorRows,
    paymentRows: args.reports.flatMap((report) => report.paymentRows),
  } satisfies ViewsBaseFacelessReport;
}

export async function getViewsBaseFacelessReport(args: {
  organizationSlug: string;
  remoteOrgSlug: string;
  campaignSlug: string;
  startDate?: string | null;
  endDate?: string | null;
}) {
  await requireOrganizationMembership(args.organizationSlug);
  const credentials = await getViewsBaseCredentials(args.organizationSlug);

  if (!credentials.configured) {
    throw new Error("ViewsBase credentials are not configured.");
  }

  const defaultRange = getDefaultViewsBaseRange();
  const startDate = normalizeDateInput(args.startDate) ?? defaultRange.startDate;
  const endDate = normalizeDateInput(args.endDate) ?? defaultRange.endDate;
  const requestedCampaignSlug = normalizeText(args.campaignSlug) ?? ALL_CAMPAIGNS_SLUG;
  const seedCampaignSlug =
    requestedCampaignSlug === ALL_CAMPAIGNS_SLUG
      ? DEFAULT_SEED_CAMPAIGN_SLUG
      : requestedCampaignSlug;
  const pageContext = await resolveViewsBaseCampaignPage({
    orgSlug: args.remoteOrgSlug,
    campaignSlug: seedCampaignSlug,
    credentials: credentials.value,
  });
  const campaignOptions =
    pageContext.campaignOptions.length > 0
      ? pageContext.campaignOptions
      : [pageContext.campaign];

  if (requestedCampaignSlug === ALL_CAMPAIGNS_SLUG) {
    const reports = await Promise.all(
      campaignOptions.map((option) =>
        getSingleViewsBaseFacelessReport({
          campaign: {
            ...option,
            orgSlug: args.remoteOrgSlug,
            countingWindowDays:
              option.slug === pageContext.campaign.slug
                ? pageContext.campaign.countingWindowDays
                : null,
          },
          campaignOptions,
          startDate,
          endDate,
          credentials: credentials.value,
        }),
      ),
    );
    const aggregateReport = aggregateReports({
      reports,
      campaignOptions,
      orgSlug: args.remoteOrgSlug,
      startDate,
      endDate,
    });
    const dailyRows = applyFacelessPricingToDailyRows({
      campaignSlug: ALL_CAMPAIGNS_SLUG,
      endDate,
      includeDashboardFee: true,
      rows: aggregateReport.dailyRows,
      startDate,
    });
    const spendTotals = getSpendTotals(dailyRows);

    return {
      ...aggregateReport,
      stats: {
        ...aggregateReport.stats,
        totalViewsInRange: dailyRows.reduce((sum, row) => sum + row.views, 0),
      },
      totals: {
        ...aggregateReport.totals,
        rangeViews: dailyRows.reduce((sum, row) => sum + row.views, 0),
        ...spendTotals,
      },
      dailyRows,
    } satisfies ViewsBaseFacelessReport;
  }

  const selectedCampaign =
    requestedCampaignSlug === pageContext.campaign.slug
      ? pageContext.campaign
      : campaignOptions.find((option) => option.slug === requestedCampaignSlug);

  if (!selectedCampaign) {
    throw new Error(`ViewsBase campaign ${requestedCampaignSlug} was not found.`);
  }

  const report = await getSingleViewsBaseFacelessReport({
    campaign: {
      ...selectedCampaign,
      orgSlug: args.remoteOrgSlug,
      countingWindowDays:
        selectedCampaign.slug === pageContext.campaign.slug
          ? pageContext.campaign.countingWindowDays
          : null,
    },
    campaignOptions,
    startDate,
    endDate,
    credentials: credentials.value,
  });
  const dailyRows = applyFacelessPricingToDailyRows({
    campaignSlug: ALL_CAMPAIGNS_SLUG,
    endDate,
    includeDashboardFee: true,
    rows: report.dailyRows,
    startDate,
  });
  const spendTotals = getSpendTotals(dailyRows);

  return {
    ...report,
    totals: {
      ...report.totals,
      ...spendTotals,
      rangeViews: dailyRows.reduce((sum, row) => sum + row.views, 0),
    },
    dailyRows,
  };
}
