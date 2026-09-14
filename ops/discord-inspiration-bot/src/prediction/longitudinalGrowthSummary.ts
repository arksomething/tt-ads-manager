export const LONGITUDINAL_GROWTH_SUMMARY_VERSION =
  "gotall_longitudinal_growth_summary_v1" as const;

const DAYS_PER_YEAR = 365.25;
const DEFAULT_PREFERRED_WINDOW_DAYS = 365.25;
const DEFAULT_MAX_WINDOW_DAYS = 730.5;
const DEFAULT_MIN_SPAN_DAYS = 120;
const DEFAULT_RECENT_WINDOW_DAYS = 183;

export interface LongitudinalGrowthSample {
  timeDays: number;
  heightCm: number;
}

export interface LongitudinalGrowthSummary {
  version: typeof LONGITUDINAL_GROWTH_SUMMARY_VERSION;
  windowSpanDays: number;
  measurementCount: number;
  recentVelocityCmPerYear: number;
  priorVelocityCmPerYear: number;
  velocityDeltaCmPerYear: number;
  fitErrorCm: number;
  sparseMeasurementQualityFlag: 0 | 1;
}

export interface BuildLongitudinalGrowthSummaryOptions {
  preferredWindowDays?: number;
  maxWindowDays?: number;
  minSpanDays?: number;
  recentWindowDays?: number;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function average(values: number[]): number | null {
  const finiteValues = values.filter((value) => Number.isFinite(value));
  if (finiteValues.length === 0) return null;
  const total = finiteValues.reduce((sum, value) => sum + value, 0);
  return total / finiteValues.length;
}

function collapseSamplesByTime(
  samples: LongitudinalGrowthSample[]
): LongitudinalGrowthSample[] {
  const grouped = new Map<number, number[]>();
  for (const sample of samples) {
    const existing = grouped.get(sample.timeDays) ?? [];
    existing.push(sample.heightCm);
    grouped.set(sample.timeDays, existing);
  }

  return Array.from(grouped.entries())
    .map(([timeDays, heights]) => {
      const heightCm = average(heights);
      if (!Number.isFinite(heightCm)) {
        return null;
      }

      return {
        timeDays,
        heightCm: heightCm as number,
      };
    })
    .filter((value): value is LongitudinalGrowthSample => value != null)
    .sort((left, right) => left.timeDays - right.timeDays);
}

function getWindowSpanDays(samples: LongitudinalGrowthSample[]): number {
  if (samples.length < 2) return 0;
  return samples[samples.length - 1].timeDays - samples[0].timeDays;
}

function normalizeSamples(
  samples: LongitudinalGrowthSample[]
): LongitudinalGrowthSample[] {
  return collapseSamplesByTime(
    samples.filter(
      (sample) =>
        Number.isFinite(sample.timeDays) &&
        Number.isFinite(sample.heightCm) &&
        sample.heightCm > 0
    )
  );
}

function pickSummaryWindow(
  samples: LongitudinalGrowthSample[],
  options: Required<BuildLongitudinalGrowthSummaryOptions>
): LongitudinalGrowthSample[] {
  if (samples.length <= 2) {
    return samples;
  }

  const latestTimeDays = samples[samples.length - 1]?.timeDays ?? 0;
  const preferredWindow = samples.filter(
    (sample) => sample.timeDays >= latestTimeDays - options.preferredWindowDays
  );
  if (
    preferredWindow.length >= 2 &&
    getWindowSpanDays(preferredWindow) >= options.minSpanDays
  ) {
    return preferredWindow;
  }

  const extendedWindow = samples.filter(
    (sample) => sample.timeDays >= latestTimeDays - options.maxWindowDays
  );
  if (
    extendedWindow.length >= 2 &&
    getWindowSpanDays(extendedWindow) >= options.minSpanDays
  ) {
    return extendedWindow;
  }

  return samples.slice(-Math.min(4, samples.length));
}

type LinearFit = {
  intercept: number;
  slopeCmPerDay: number;
};

function fitLinearRegression(samples: LongitudinalGrowthSample[]): LinearFit | null {
  if (samples.length < 2) return null;

  const meanTime = average(samples.map((sample) => sample.timeDays));
  const meanHeight = average(samples.map((sample) => sample.heightCm));
  if (!Number.isFinite(meanTime) || !Number.isFinite(meanHeight)) {
    return null;
  }

  let numerator = 0;
  let denominator = 0;
  for (const sample of samples) {
    const centeredTime = sample.timeDays - (meanTime as number);
    numerator += centeredTime * (sample.heightCm - (meanHeight as number));
    denominator += centeredTime * centeredTime;
  }

  const slopeCmPerDay = denominator > 0 ? numerator / denominator : 0;
  const intercept = (meanHeight as number) - slopeCmPerDay * (meanTime as number);

  return {
    intercept,
    slopeCmPerDay,
  };
}

function getVelocityCmPerYear(samples: LongitudinalGrowthSample[]): number | null {
  const fit = fitLinearRegression(samples);
  if (!fit) return null;
  return clamp(fit.slopeCmPerDay * DAYS_PER_YEAR, -25, 25);
}

function getFitErrorCm(samples: LongitudinalGrowthSample[]): number {
  const fit = fitLinearRegression(samples);
  if (!fit) return 0;

  const squaredErrorTotal = samples.reduce((sum, sample) => {
    const predictedHeight = fit.intercept + fit.slopeCmPerDay * sample.timeDays;
    const error = sample.heightCm - predictedHeight;
    return sum + error * error;
  }, 0);

  return clamp(Math.sqrt(squaredErrorTotal / samples.length), 0, 10);
}

export function buildLongitudinalGrowthSummary(
  rawSamples: LongitudinalGrowthSample[],
  options: BuildLongitudinalGrowthSummaryOptions = {}
): LongitudinalGrowthSummary | null {
  const resolvedOptions: Required<BuildLongitudinalGrowthSummaryOptions> = {
    preferredWindowDays:
      options.preferredWindowDays ?? DEFAULT_PREFERRED_WINDOW_DAYS,
    maxWindowDays: options.maxWindowDays ?? DEFAULT_MAX_WINDOW_DAYS,
    minSpanDays: options.minSpanDays ?? DEFAULT_MIN_SPAN_DAYS,
    recentWindowDays: options.recentWindowDays ?? DEFAULT_RECENT_WINDOW_DAYS,
  };
  const samples = pickSummaryWindow(
    normalizeSamples(rawSamples),
    resolvedOptions
  );
  if (samples.length < 2) {
    return null;
  }

  const firstSample = samples[0];
  const lastSample = samples[samples.length - 1];
  const windowSpanDays = lastSample.timeDays - firstSample.timeDays;
  if (!Number.isFinite(windowSpanDays) || windowSpanDays < resolvedOptions.minSpanDays) {
    return null;
  }

  const recentWindowStart = Math.max(
    firstSample.timeDays,
    lastSample.timeDays - Math.min(resolvedOptions.recentWindowDays, windowSpanDays / 2)
  );
  const recentSamples = samples.filter(
    (sample) => sample.timeDays >= recentWindowStart
  );
  const priorSamples = samples.filter(
    (sample) => sample.timeDays <= recentWindowStart
  );
  const overallVelocityCmPerYear = getVelocityCmPerYear(samples);
  if (!Number.isFinite(overallVelocityCmPerYear)) {
    return null;
  }

  const recentVelocityCmPerYear =
    getVelocityCmPerYear(recentSamples) ?? (overallVelocityCmPerYear as number);
  const priorVelocityCmPerYear =
    getVelocityCmPerYear(priorSamples) ?? (overallVelocityCmPerYear as number);

  const sparseMeasurementQualityFlag: 0 | 1 =
    samples.length >= 4 &&
    windowSpanDays >= 180 &&
    recentSamples.length >= 2 &&
    priorSamples.length >= 2
      ? 0
      : 1;

  return {
    version: LONGITUDINAL_GROWTH_SUMMARY_VERSION,
    windowSpanDays: clamp(windowSpanDays, 0, DEFAULT_MAX_WINDOW_DAYS),
    measurementCount: samples.length,
    recentVelocityCmPerYear,
    priorVelocityCmPerYear,
    velocityDeltaCmPerYear: clamp(
      recentVelocityCmPerYear - priorVelocityCmPerYear,
      -20,
      20
    ),
    fitErrorCm: getFitErrorCm(samples),
    sparseMeasurementQualityFlag,
  };
}

export function buildLongitudinalGrowthSummaryFromAgeObservations(
  observations: Array<{ ageYears: number; heightCm: number }>,
  options?: BuildLongitudinalGrowthSummaryOptions
): LongitudinalGrowthSummary | null {
  return buildLongitudinalGrowthSummary(
    observations.map((observation) => ({
      timeDays: observation.ageYears * DAYS_PER_YEAR,
      heightCm: observation.heightCm,
    })),
    options
  );
}

export function isPreferredLongitudinalWindow(
  summary: LongitudinalGrowthSummary | null | undefined
): boolean {
  return Boolean(
    summary &&
      summary.windowSpanDays >= 180 &&
      summary.windowSpanDays <= 400 &&
      summary.measurementCount >= 4 &&
      summary.sparseMeasurementQualityFlag === 0
  );
}

