export type FormatComparisonSourceVideo = {
  creatorName: string | null;
  date: string;
  formatTag: string | null;
  id: string;
  sourceVideoId: string;
  thumbnailUrl: string | null;
  title: string;
  url: string | null;
  views: number;
};

export type FormatComparisonSourceDay = {
  date: string;
  revenue: number | null;
  videos: FormatComparisonSourceVideo[];
};

export type FormatComparisonVideoRow = FormatComparisonSourceVideo & {
  allocatedRevenue: number | null;
  revenuePerThousandViews: number | null;
  viewShare: number | null;
};

export type FormatComparisonFormatRow = {
  averageViewsPerVideo: number | null;
  formatTag: string | null;
  label: string;
  revenue: number | null;
  revenuePerThousandViews: number | null;
  rowCount: number;
  tagged: boolean;
  uniqueVideoCount: number;
  views: number;
};

export type FormatComparisonDailyRow = {
  date: string;
  revenue: number | null;
  revenuePerThousandViews: number | null;
  rows: FormatComparisonVideoRow[];
  views: number;
};

export type FormatComparisonResult = {
  dailyRows: FormatComparisonDailyRow[];
  formatRows: FormatComparisonFormatRow[];
  summary: {
    revenue: number | null;
    revenuePerThousandViews: number | null;
    taggedVideoCount: number;
    taggedViews: number;
    totalVideoCount: number;
    views: number;
  };
  videoRows: FormatComparisonVideoRow[];
};

function roundCurrency(value: number) {
  return Math.round(value * 100) / 100;
}

function getRevenuePerThousandViews(revenue: number | null, views: number) {
  if (revenue === null || !Number.isFinite(revenue) || views <= 0) {
    return null;
  }

  return (revenue / views) * 1_000;
}

export function normalizeFormatTag(value: unknown) {
  if (value === null || value === undefined) {
    return null;
  }

  const normalized = String(value).replace(/\s+/g, " ").trim();

  if (!normalized) {
    return null;
  }

  return normalized.slice(0, 80);
}

function getFormatLabel(formatTag: string | null) {
  return formatTag ?? "Untagged";
}

function getFormatKey(formatTag: string | null) {
  return formatTag ?? "";
}

function solveLinearSystem(matrix: number[][], vector: number[]) {
  const size = vector.length;
  const rows = matrix.map((row, index) => [...row, vector[index] ?? 0]);

  for (let column = 0; column < size; column += 1) {
    let pivotRow = column;

    for (let row = column + 1; row < size; row += 1) {
      if (
        Math.abs(rows[row][column] ?? 0) >
        Math.abs(rows[pivotRow][column] ?? 0)
      ) {
        pivotRow = row;
      }
    }

    const pivot = rows[pivotRow][column] ?? 0;

    if (Math.abs(pivot) < 1e-12) {
      return null;
    }

    if (pivotRow !== column) {
      [rows[column], rows[pivotRow]] = [rows[pivotRow], rows[column]];
    }

    for (let row = column + 1; row < size; row += 1) {
      const factor = (rows[row][column] ?? 0) / pivot;

      for (let entry = column; entry <= size; entry += 1) {
        rows[row][entry] =
          (rows[row][entry] ?? 0) - factor * (rows[column][entry] ?? 0);
      }
    }
  }

  const solution = Array.from({ length: size }, () => 0);

  for (let row = size - 1; row >= 0; row -= 1) {
    let total = rows[row][size] ?? 0;

    for (let column = row + 1; column < size; column += 1) {
      total -= (rows[row][column] ?? 0) * (solution[column] ?? 0);
    }

    const pivot = rows[row][row] ?? 0;

    if (Math.abs(pivot) < 1e-12) {
      return null;
    }

    solution[row] = total / pivot;
  }

  return solution;
}

function getMedian(values: number[]) {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 1) {
    return sorted[middle] ?? 0;
  }

  return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

function solveRidgeLeastSquaresTowardPrior(
  matrix: number[][],
  target: number[],
  prior: number[],
  regularization: number,
) {
  const columnCount = matrix[0]?.length ?? 0;

  if (columnCount === 0) {
    return [];
  }

  const normalMatrix = Array.from({ length: columnCount }, () =>
    Array.from({ length: columnCount }, () => 0),
  );
  const normalVector = Array.from({ length: columnCount }, () => 0);

  for (const [rowIndex, row] of matrix.entries()) {
    const targetValue = target[rowIndex] ?? 0;

    for (let left = 0; left < columnCount; left += 1) {
      const leftValue = row[left] ?? 0;
      normalVector[left] += leftValue * targetValue;

      for (let right = 0; right < columnCount; right += 1) {
        normalMatrix[left][right] += leftValue * (row[right] ?? 0);
      }
    }
  }

  const averageDiagonal =
    normalMatrix.reduce((sum, row, index) => sum + Math.abs(row[index] ?? 0), 0) /
    Math.max(columnCount, 1);
  const ridgePenalty = Math.max(regularization, averageDiagonal * 1e-8, 1e-8);

  for (let index = 0; index < columnCount; index += 1) {
    normalMatrix[index][index] += ridgePenalty;
    normalVector[index] += ridgePenalty * (prior[index] ?? 0);
  }

  return solveLinearSystem(normalMatrix, normalVector);
}

function normalizeDays(days: FormatComparisonSourceDay[]) {
  return days.map((day) => {
    const rows = day.videos.map((video) => ({
      ...video,
      views: Math.max(Math.round(video.views), 0),
      formatTag: normalizeFormatTag(video.formatTag),
    }));
    const views = rows.reduce((sum, row) => sum + row.views, 0);

    return {
      ...day,
      rows,
      views,
    };
  });
}

function fitFormatRevenuePerThousandViews(
  days: ReturnType<typeof normalizeDays>,
) {
  const formatKeys = [
    ...new Set(
      days.flatMap((day) =>
        day.rows
          .filter((row) => row.views > 0)
          .map((row) => getFormatKey(row.formatTag)),
      ),
    ),
  ].sort((left, right) =>
    getFormatLabel(left || null).localeCompare(getFormatLabel(right || null)),
  );
  const formatIndexByKey = new Map(formatKeys.map((key, index) => [key, index]));
  const trainingRows = days.filter((day) => day.revenue !== null && day.views > 0);
  const matrix = trainingRows.map((day) => {
    const row = Array.from({ length: formatKeys.length }, () => 0);

    for (const video of day.rows) {
      const formatIndex = formatIndexByKey.get(getFormatKey(video.formatTag));

      if (formatIndex !== undefined) {
        row[formatIndex] += video.views / 1_000;
      }
    }

    return row;
  });
  const target = trainingRows.map((day) => day.revenue ?? 0);
  const trainingViewThousands = trainingRows.reduce(
    (sum, day) => sum + day.views / 1_000,
    0,
  );
  const trainingRevenue = trainingRows.reduce(
    (sum, day) => sum + (day.revenue ?? 0),
    0,
  );
  const baselineRevenuePerThousandViews =
    trainingViewThousands > 0 ? trainingRevenue / trainingViewThousands : 0;
  const dailyViewThousands = trainingRows
    .map((day) => day.views / 1_000)
    .filter((views) => views > 0);
  const typicalDayViewThousands = getMedian(dailyViewThousands);
  // One typical day of views acts like prior evidence for each format.
  const regularization = typicalDayViewThousands ** 2;
  const prior = Array.from(
    { length: formatKeys.length },
    () => baselineRevenuePerThousandViews,
  );
  const solution =
    matrix.length > 0 && formatKeys.length > 0
      ? (solveRidgeLeastSquaresTowardPrior(
          matrix,
          target,
          prior,
          regularization,
        ) ?? prior)
      : [];

  return new Map(
    formatKeys.map(
      (key, index) =>
        [key, Math.max(solution[index] ?? baselineRevenuePerThousandViews, 0)] as const,
    ),
  );
}

function allocateDailyRevenue(
  day: ReturnType<typeof normalizeDays>[number],
  formatRevenuePerThousandViews: Map<string, number>,
) {
  return day.rows.map((video) => {
    const modeledRevenuePerThousandViews = formatRevenuePerThousandViews.get(
      getFormatKey(video.formatTag),
    ) ?? null;
    const allocatedRevenue =
      day.revenue === null || modeledRevenuePerThousandViews === null
        ? null
        : (video.views / 1_000) * modeledRevenuePerThousandViews;

    return {
      ...video,
      allocatedRevenue,
      revenuePerThousandViews:
        allocatedRevenue === null || video.views <= 0
          ? null
          : modeledRevenuePerThousandViews,
      viewShare: day.views > 0 ? video.views / day.views : null,
    } satisfies FormatComparisonVideoRow;
  });
}

export function calculateFormatComparison(
  days: FormatComparisonSourceDay[],
): FormatComparisonResult {
  const normalizedDays = normalizeDays(days);
  const formatRevenuePerThousandViews =
    fitFormatRevenuePerThousandViews(normalizedDays);
  const dailyRows = normalizedDays.map((day) => {
    const rows = allocateDailyRevenue(day, formatRevenuePerThousandViews);
    const views = rows.reduce((sum, row) => sum + row.views, 0);
    const revenue = day.revenue === null ? null : roundCurrency(day.revenue);

    return {
      date: day.date,
      revenue,
      revenuePerThousandViews: getRevenuePerThousandViews(revenue, views),
      rows,
      views,
    } satisfies FormatComparisonDailyRow;
  });
  const videoRows = dailyRows.flatMap((day) => day.rows);
  const groups = new Map<
    string,
    {
      formatTag: string | null;
      revenue: number;
      rows: FormatComparisonVideoRow[];
      videoIds: Set<string>;
      views: number;
    }
  >();

  for (const row of videoRows) {
    const formatTag = normalizeFormatTag(row.formatTag);
    const key = formatTag ?? "";
    const group = groups.get(key) ?? {
      formatTag,
      revenue: 0,
      rows: [],
      videoIds: new Set<string>(),
      views: 0,
    };

    group.rows.push(row);
    group.views += row.views;

    if (row.allocatedRevenue !== null) {
      group.revenue += row.allocatedRevenue;
    }

    group.videoIds.add(row.sourceVideoId || row.id);
    groups.set(key, group);
  }

  const formatRows = [...groups.values()]
    .map((group) => {
      const revenue =
        group.rows.some((row) => row.allocatedRevenue !== null)
          ? roundCurrency(group.revenue)
          : null;
      const uniqueVideoCount = group.videoIds.size;

      return {
        averageViewsPerVideo:
          uniqueVideoCount > 0 ? group.views / uniqueVideoCount : null,
        formatTag: group.formatTag,
        label: getFormatLabel(group.formatTag),
        revenue,
        revenuePerThousandViews: getRevenuePerThousandViews(
          revenue,
          group.views,
        ),
        rowCount: group.rows.length,
        tagged: Boolean(group.formatTag),
        uniqueVideoCount,
        views: group.views,
      } satisfies FormatComparisonFormatRow;
    })
    .sort((left, right) => {
      if (left.tagged !== right.tagged) {
        return left.tagged ? -1 : 1;
      }

      return (
        (right.revenuePerThousandViews ?? -Infinity) -
          (left.revenuePerThousandViews ?? -Infinity) ||
        right.views - left.views ||
        left.label.localeCompare(right.label)
      );
    });
  const knownRevenueRows = dailyRows.filter((row) => row.revenue !== null);
  const summaryRevenue =
    knownRevenueRows.length > 0
      ? roundCurrency(
          knownRevenueRows.reduce((sum, row) => sum + (row.revenue ?? 0), 0),
        )
      : null;
  const summaryViews = dailyRows.reduce((sum, row) => sum + row.views, 0);
  const uniqueVideoIds = new Set(videoRows.map((row) => row.sourceVideoId || row.id));
  const taggedVideoIds = new Set(
    videoRows
      .filter((row) => normalizeFormatTag(row.formatTag))
      .map((row) => row.sourceVideoId || row.id),
  );

  return {
    dailyRows,
    formatRows,
    summary: {
      revenue: summaryRevenue,
      revenuePerThousandViews: getRevenuePerThousandViews(
        summaryRevenue,
        summaryViews,
      ),
      taggedVideoCount: taggedVideoIds.size,
      taggedViews: videoRows.reduce(
        (sum, row) => sum + (normalizeFormatTag(row.formatTag) ? row.views : 0),
        0,
      ),
      totalVideoCount: uniqueVideoIds.size,
      views: summaryViews,
    },
    videoRows,
  };
}
