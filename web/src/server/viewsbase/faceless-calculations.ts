export type ViewsBaseDailySpendCreatorRow = {
  influencer_id?: string | null;
  influencer_name?: string | null;
  handle?: string | null;
  platform?: string | null;
  spend?: number | null;
  actual_spend?: number | null;
  projected_spend?: number | null;
  paid_views?: number | null;
  video_count?: number | null;
  projected_video_count?: number | null;
  estimated_cpm_video_count?: number | null;
  estimated_cpm?: number | null;
  cpm_sample_count?: number | null;
};

export type ViewsBaseDailySpendApiRow = {
  date?: string | null;
  status?: "actual" | "projected" | "mixed" | "none" | string | null;
  total_spend?: number | null;
  actual_spend?: number | null;
  projected_spend?: number | null;
  paid_views?: number | null;
  creator_breakdown?: ViewsBaseDailySpendCreatorRow[] | null;
};

export type ViewsBaseDailySpendRow = {
  date: string;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  baseTotalSpend: number;
  baseActualSpend: number;
  baseProjectedSpend: number;
  totalSpend: number;
  actualSpend: number;
  projectedSpend: number;
  managementFee: number;
  cpmManagementFee: number;
  fixedManagementFee: number;
  dashboardFee: number;
  projectedSpendIsEstimated: boolean;
  creatorCount: number;
  status: string;
};

export type ViewsBaseCreatorSpendRow = {
  handle: string;
  name: string;
  views: number;
  videoCount: number;
  shareOfViews: number | null;
  effectiveCpm: number | null;
  baseTotalSpend: number;
  totalSpend: number;
  actualSpend: number;
  projectedSpend: number;
  managementFee: number;
};

function normalizeText(value: unknown) {
  if (value === null || value === undefined) {
    return null;
  }

  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function normalizeHandle(value: unknown) {
  const text = normalizeText(value);

  if (!text) {
    return null;
  }

  return text.startsWith("@") ? text.slice(1).toLowerCase() : text.toLowerCase();
}

function toFiniteNumber(value: unknown, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function roundCurrency(value: number) {
  return Math.round(value * 100) / 100;
}

function parseDateOnly(value: string) {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatDateOnly(value: Date) {
  return value.toISOString().slice(0, 10);
}

function getDateKeys(startDate: string, endDate: string) {
  const keys: string[] = [];
  const cursor = parseDateOnly(startDate);
  const end = parseDateOnly(endDate);

  if (!cursor || !end || cursor > end) {
    return keys;
  }

  while (cursor <= end) {
    keys.push(formatDateOnly(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return keys;
}

function getDaysInUtcMonth(date: string) {
  const parsed = parseDateOnly(date);

  if (!parsed) {
    return 30;
  }

  return new Date(
    Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth() + 1, 0),
  ).getUTCDate();
}

function normalizeSlug(value: string) {
  return value.trim().toLowerCase();
}

export function getFacelessCampaignPricing(campaignSlug: string) {
  const slug = normalizeSlug(campaignSlug);

  if (slug.includes("larsie")) {
    return {
      cpmManagementRate: 0.1,
      fixedMonthlyFee: 500,
    };
  }

  if (slug.includes("mads")) {
    return {
      cpmManagementRate: 0.2,
      fixedMonthlyFee: 0,
    };
  }

  return {
    cpmManagementRate: 0,
    fixedMonthlyFee: 0,
  };
}

export function getFacelessCostAmount(args: {
  projectedSpend: number;
  totalSpend: number;
}) {
  const totalSpend = Number.isFinite(args.totalSpend) ? args.totalSpend : 0;
  const projectedSpend = Number.isFinite(args.projectedSpend)
    ? args.projectedSpend
    : 0;

  return roundCurrency(Math.max(totalSpend, projectedSpend));
}

export function buildDailyRowsFromSpend(rows: ViewsBaseDailySpendApiRow[]) {
  return rows
    .map((row) => {
      const date = normalizeText(row.date) ?? "";
      const creatorBreakdown = row.creator_breakdown ?? [];
      const totalSpend = roundCurrency(toFiniteNumber(row.total_spend, 0));
      const actualSpend = roundCurrency(toFiniteNumber(row.actual_spend, 0));
      const projectedSpend = roundCurrency(toFiniteNumber(row.projected_spend, 0));

      return {
        date,
        views: Math.round(toFiniteNumber(row.paid_views, 0)),
        likes: 0,
        comments: 0,
        shares: 0,
        baseTotalSpend: totalSpend,
        baseActualSpend: actualSpend,
        baseProjectedSpend: projectedSpend,
        totalSpend,
        actualSpend,
        projectedSpend,
        managementFee: 0,
        cpmManagementFee: 0,
        fixedManagementFee: 0,
        dashboardFee: 0,
        projectedSpendIsEstimated: true,
        creatorCount: creatorBreakdown.length,
        status: normalizeText(row.status) ?? "none",
      } satisfies ViewsBaseDailySpendRow;
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function buildCreatorRowsFromSpend(rows: ViewsBaseDailySpendApiRow[]) {
  const creators = new Map<
    string,
    {
      handle: string;
      name: string;
      views: number;
      videoCount: number;
      totalSpend: number;
      actualSpend: number;
      projectedSpend: number;
      estimatedCpmWeightedSum: number;
      estimatedCpmVideoCount: number;
    }
  >();

  for (const row of rows) {
    for (const creator of row.creator_breakdown ?? []) {
      const handle =
        normalizeHandle(creator.handle) ??
        normalizeHandle(creator.influencer_name) ??
        normalizeText(creator.influencer_id) ??
        "unknown";
      const existing =
        creators.get(handle) ??
        ({
          handle,
          name: normalizeText(creator.influencer_name) ?? `@${handle}`,
          views: 0,
          videoCount: 0,
          totalSpend: 0,
          actualSpend: 0,
          projectedSpend: 0,
          estimatedCpmWeightedSum: 0,
          estimatedCpmVideoCount: 0,
        });
      const estimatedCpmVideoCount = Math.round(
        toFiniteNumber(creator.estimated_cpm_video_count, 0),
      );
      const estimatedCpm = toFiniteNumber(creator.estimated_cpm, Number.NaN);

      existing.views += Math.round(toFiniteNumber(creator.paid_views, 0));
      existing.videoCount += Math.round(toFiniteNumber(creator.video_count, 0));
      existing.totalSpend = roundCurrency(
        existing.totalSpend + toFiniteNumber(creator.spend, 0),
      );
      existing.actualSpend = roundCurrency(
        existing.actualSpend + toFiniteNumber(creator.actual_spend, 0),
      );
      existing.projectedSpend = roundCurrency(
        existing.projectedSpend + toFiniteNumber(creator.projected_spend, 0),
      );

      if (Number.isFinite(estimatedCpm) && estimatedCpmVideoCount > 0) {
        existing.estimatedCpmWeightedSum += estimatedCpm * estimatedCpmVideoCount;
        existing.estimatedCpmVideoCount += estimatedCpmVideoCount;
      }

      creators.set(handle, existing);
    }
  }

  const totalViews = [...creators.values()].reduce(
    (sum, creator) => sum + creator.views,
    0,
  );

  return [...creators.values()]
    .map((creator) => ({
      handle: creator.handle,
      name: creator.name,
      views: creator.views,
      videoCount: creator.videoCount,
      shareOfViews: totalViews > 0 ? (creator.views / totalViews) * 100 : null,
      effectiveCpm:
        creator.estimatedCpmVideoCount > 0
          ? roundCurrency(
              creator.estimatedCpmWeightedSum / creator.estimatedCpmVideoCount,
            )
          : creator.views > 0
            ? roundCurrency((creator.totalSpend / creator.views) * 1000)
            : null,
      baseTotalSpend: roundCurrency(creator.totalSpend),
      totalSpend: roundCurrency(creator.totalSpend),
      actualSpend: roundCurrency(creator.actualSpend),
      projectedSpend: roundCurrency(creator.projectedSpend),
      managementFee: 0,
    }))
    .sort((a, b) => b.totalSpend - a.totalSpend) satisfies ViewsBaseCreatorSpendRow[];
}

export function applyFacelessPricingToDailyRows(args: {
  rows: ViewsBaseDailySpendRow[];
  campaignSlug: string;
  startDate: string;
  endDate: string;
  includeDashboardFee?: boolean;
}) {
  const pricing = getFacelessCampaignPricing(args.campaignSlug);
  const rowsByDate = new Map(args.rows.map((row) => [row.date, row] as const));
  const dateKeys = getDateKeys(args.startDate, args.endDate);
  const dates = dateKeys.length > 0 ? dateKeys : args.rows.map((row) => row.date);

  return dates
    .map((date) => {
      const row = rowsByDate.get(date) ?? {
        date,
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
      } satisfies ViewsBaseDailySpendRow;
      const baseTotalSpend = row.baseTotalSpend;
      const baseActualSpend = row.baseActualSpend;
      const baseProjectedSpend = row.baseProjectedSpend;
      const cpmManagementFee = roundCurrency(
        baseTotalSpend * pricing.cpmManagementRate,
      );
      const actualCpmManagementFee = roundCurrency(
        baseActualSpend * pricing.cpmManagementRate,
      );
      const projectedCpmManagementFee = roundCurrency(
        baseProjectedSpend * pricing.cpmManagementRate,
      );
      const fixedManagementFee = roundCurrency(
        pricing.fixedMonthlyFee / getDaysInUtcMonth(date),
      );
      const dashboardFee = roundCurrency(
        args.includeDashboardFee ? 250 / getDaysInUtcMonth(date) : 0,
      );
      const fixedFees = roundCurrency(fixedManagementFee + dashboardFee);
      const managementFee = roundCurrency(cpmManagementFee + fixedFees);

      return {
        ...row,
        totalSpend: roundCurrency(baseTotalSpend + cpmManagementFee + fixedFees),
        actualSpend: roundCurrency(
          baseActualSpend + actualCpmManagementFee + fixedFees,
        ),
        projectedSpend: roundCurrency(
          baseProjectedSpend + projectedCpmManagementFee + fixedFees,
        ),
        managementFee,
        cpmManagementFee,
        fixedManagementFee,
        dashboardFee,
      } satisfies ViewsBaseDailySpendRow;
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function applyFacelessPricingToCreatorRows(args: {
  rows: ViewsBaseCreatorSpendRow[];
  campaignSlug: string;
}) {
  const pricing = getFacelessCampaignPricing(args.campaignSlug);

  return args.rows
    .map((row) => {
      const managementFee = roundCurrency(
        row.baseTotalSpend * pricing.cpmManagementRate,
      );
      const totalSpend = roundCurrency(row.baseTotalSpend + managementFee);

      return {
        ...row,
        totalSpend,
        actualSpend: roundCurrency(
          row.actualSpend + row.actualSpend * pricing.cpmManagementRate,
        ),
        projectedSpend: roundCurrency(
          row.projectedSpend + row.projectedSpend * pricing.cpmManagementRate,
        ),
        effectiveCpm:
          row.views > 0 ? roundCurrency((totalSpend / row.views) * 1000) : null,
        managementFee,
      } satisfies ViewsBaseCreatorSpendRow;
    })
    .sort((a, b) => b.totalSpend - a.totalSpend);
}
