export type UgcStatusMetricInputs = {
  proceeds: number;
  spend: number;
  views: number;
  ugcViews: number;
  facelessViews: number;
};

export type UgcStatusMetrics = {
  proceeds: number;
  spend: number;
  profit: number;
  views: number;
  roas: number | null;
  margin: number | null;
  proceedsPerThousandViews: number | null;
  spendPerThousandViews: number | null;
  profitPerThousandViews: number | null;
  ugcViewShare: number | null;
  facelessViewShare: number | null;
};

export type UgcStatusTopVideoRow = {
  creatorName: string | null;
  id: string;
  sourceVideoId: string | null;
  spend: number | null;
  thumbnailUrl?: string | null;
  title: string;
  url: string | null;
  views: number;
};

function roundCurrency(value: number) {
  return Math.round(value * 100) / 100;
}

function getRatio(numerator: number, denominator: number) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) {
    return null;
  }

  return numerator / denominator;
}

function perThousand(value: number, views: number) {
  const ratio = getRatio(value, views);
  return ratio === null ? null : ratio * 1_000;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function calculateUgcStatusMetrics(
  inputs: UgcStatusMetricInputs,
): UgcStatusMetrics {
  const proceeds = roundCurrency(inputs.proceeds);
  const spend = roundCurrency(inputs.spend);
  const profit = roundCurrency(proceeds - spend);
  const views = Math.max(Math.round(inputs.views), 0);
  const ugcViews = Math.max(Math.round(inputs.ugcViews), 0);
  const facelessViews = Math.max(Math.round(inputs.facelessViews), 0);

  return {
    proceeds,
    spend,
    profit,
    views,
    roas: getRatio(proceeds, spend),
    margin: getRatio(profit, proceeds),
    proceedsPerThousandViews: perThousand(proceeds, views),
    spendPerThousandViews: perThousand(spend, views),
    profitPerThousandViews: perThousand(profit, views),
    ugcViewShare: getRatio(ugcViews, views),
    facelessViewShare: getRatio(facelessViews, views),
  };
}

export function getUgcStatusSpendByDate(args: {
  dates: string[];
  totalCpmSpend: number;
  totalFixedSpend: number;
  dailyRows: Array<{
    date: string;
    cpmSpend: number;
    fixedSpend: number;
  }>;
}) {
  const dailyRowsByDate = new Map(args.dailyRows.map((row) => [row.date, row]));
  const fixedSpendByDate = allocateTotalByDailyWeights({
    dates: args.dates,
    total: args.totalFixedSpend,
    weights: new Map(
      args.dailyRows.map(
        (row) => [row.date, Math.max(row.fixedSpend, 0)] as const,
      ),
    ),
  });
  const cpmSpendByDate = allocateTotalByDailyWeights({
    dates: args.dates,
    total: args.totalCpmSpend,
    weights: new Map(
      args.dailyRows.map((row) => [row.date, Math.max(row.cpmSpend, 0)] as const),
    ),
  });
  const spendByDate = new Map<
    string,
    {
      cpmSpend: number;
      fixedSpend: number;
      spend: number;
    }
  >();

  for (const date of args.dates) {
    const rawRow = dailyRowsByDate.get(date);
    const fixedSpend =
      fixedSpendByDate.get(date) ?? (rawRow ? Math.max(rawRow.fixedSpend, 0) : 0);
    const cpmSpend =
      cpmSpendByDate.get(date) ?? (rawRow ? Math.max(rawRow.cpmSpend, 0) : 0);

    spendByDate.set(date, {
      cpmSpend,
      fixedSpend,
      spend: roundCurrency(fixedSpend + cpmSpend),
    });
  }

  return spendByDate;
}

export function getUgcStatusDailyProceedsMap(args: {
  dates: string[];
  dailyRows: Array<{
    date: string;
    newProceeds: number | null;
    organic: number | null;
    paid: number | null;
    paidSpend: number | null;
    renewal: number | null;
    total: number;
  }>;
}) {
  const dailyRowsByDate = new Map(args.dailyRows.map((row) => [row.date, row]));

  return new Map(
    args.dates.map((date) => {
      const row = dailyRowsByDate.get(date);
      if (typeof row?.organic === "number" && Number.isFinite(row.organic)) {
        return [date, roundCurrency(Math.max(row.organic, 0))];
      }

      if (!row || !isFiniteNumber(row.paid)) {
        return [date, null];
      }

      const nonRenewalProceeds = isFiniteNumber(row.newProceeds)
        ? row.newProceeds
        : isFiniteNumber(row.renewal)
          ? Math.max(row.total - row.renewal, 0)
          : null;

      if (!isFiniteNumber(nonRenewalProceeds)) {
        return [date, null];
      }

      return [date, roundCurrency(Math.max(nonRenewalProceeds - row.paid, 0))];
    }),
  );
}

export function getUgcStatusSummaryProceeds(args: {
  organicProceeds: number;
}) {
  return roundCurrency(Math.max(args.organicProceeds, 0));
}

export function selectTopUgcStatusVideos(
  videos: UgcStatusTopVideoRow[],
  limit = 5,
): UgcStatusTopVideoRow[] {
  return [...videos].sort((a, b) => b.views - a.views).slice(0, limit);
}

export function getUgcStatusTopVideoViewTotal(
  videos: UgcStatusTopVideoRow[],
) {
  return videos.reduce(
    (total, video) => total + Math.max(Math.round(video.views), 0),
    0,
  );
}

export function getUgcStatusOrganicViewCount(args: {
  grossViews: number;
  paidViews: number | null;
}) {
  return Math.max(Math.round(args.grossViews - (args.paidViews ?? 0)), 0);
}

function addDateOnlyDays(value: string, days: number) {
  const parsed = new Date(`${value}T00:00:00.000Z`);

  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

export function getUgcStatusTopVideoSearchParams(args: {
  date: string;
  lookbackDays?: number;
  searchParams: Record<string, string | string[] | undefined>;
  viewWindowDays?: number;
}) {
  const lookbackDays = args.lookbackDays ?? 30;
  const viewWindowDays = args.viewWindowDays ?? 7;

  return {
    ...args.searchParams,
    endDate: args.date,
    globalViewWindowDays: String(viewWindowDays),
    payMode: "gained",
    reportTimeZone: "UTC",
    startDate: args.date,
    videoWindowStartDate: addDateOnlyDays(args.date, -lookbackDays),
    viewWindowMode: "first-days",
  };
}

export function allocateTotalByDailyWeights(args: {
  total: number;
  dates: string[];
  weights: Map<string, number>;
}) {
  const allocations = new Map<string, number>();
  const totalWeight = args.dates.reduce(
    (sum, date) => sum + Math.max(args.weights.get(date) ?? 0, 0),
    0,
  );

  if (args.dates.length === 0) {
    return allocations;
  }

  if (totalWeight <= 0) {
    const evenAllocation = roundCurrency(args.total / args.dates.length);
    let runningTotal = 0;

    for (const date of args.dates.slice(0, -1)) {
      allocations.set(date, evenAllocation);
      runningTotal += evenAllocation;
    }

    allocations.set(
      args.dates[args.dates.length - 1] ?? "",
      roundCurrency(args.total - runningTotal),
    );
    return allocations;
  }

  let runningTotal = 0;

  for (const date of args.dates.slice(0, -1)) {
    const allocation = roundCurrency(
      args.total * (Math.max(args.weights.get(date) ?? 0, 0) / totalWeight),
    );
    allocations.set(date, allocation);
    runningTotal += allocation;
  }

  allocations.set(
    args.dates[args.dates.length - 1] ?? "",
    roundCurrency(args.total - runningTotal),
  );
  return allocations;
}
