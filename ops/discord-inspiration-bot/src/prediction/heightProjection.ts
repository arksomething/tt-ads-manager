import {
    cdcHeightForPercentile,
    cdcPercentileForHeight,
    getCdcMonthRange,
    type CdcSexCode,
} from "./cdcPrediction";
import {
    createHeightMeasurementFromCm,
    createHeightMeasurementFromInches,
    type HeightMeasurement,
} from "./heightMeasurement";
import { HeightConverter } from "./heightUtils";
import {
    clamp,
    inverseStandardNormal,
    LMS_PERCENTILE_EPSILON,
    type GrowthSexCode,
} from "./lmsMath";
import { type LongitudinalGrowthSummary } from "./longitudinalGrowthSummary";
import { calculateMidParentalHeightCm } from "./midParentalHeight";
import {
    buildProjectionResidualFeatureVectorV2,
    createLocalProjectionModelInputV2,
    evaluateProjectionResidualModelV2,
    LOCAL_PROJECTION_MODEL_ID_V2,
    type LocalProjectionModelInputV2,
    type ProjectionResidualModelSourceV2,
} from "./projectionResidualModelV2";
import {
    buildProjectionResidualFeatureVectorV3,
    createLocalProjectionModelInputV3,
    evaluateProjectionResidualModelV3,
    isProjectionResidualModelSetV3,
    LOCAL_PROJECTION_MODEL_ID_V3,
    LOCAL_PROJECTION_MODEL_INPUT_VERSION_V3,
    type LocalProjectionModelInputV3,
    type ProjectionResidualModelSourceV3,
} from "./projectionResidualModelV3";
import {
    buildProjectionResidualFeatureVectorV4,
    createLocalProjectionModelInputV4,
    evaluateProjectionResidualModelV4,
    isProjectionResidualModelSetV4,
    LOCAL_PROJECTION_FEATURE_VERSION_V4,
    LOCAL_PROJECTION_MODEL_ID_V4,
    LOCAL_PROJECTION_MODEL_INPUT_VERSION_V4,
    type LocalProjectionModelInputV4,
    type ProjectionResidualLinearModelV4,
    type ProjectionResidualModelSourceV4,
} from "./projectionResidualModelV4";
import {
    estimatePubertyState,
    type PubertyAnswers,
    type PubertyEstimate,
} from "./pubertyModel";
import {
    buildCanonicalPubertyEncoderInputFromPubertyAnswers,
    buildCanonicalPubertyEncoderInputFromRawSignals,
    encodeCanonicalPubertyV1,
    type CanonicalPubertyEncodingV1,
    type RawPubertySignalsV1,
} from "./pubertyEncoder";
import {
    getAvailableMonthRange as getWhoMonthRange,
    whoHeightForPercentile,
    whoPercentileForHeight,
    type WhoSexCode,
} from "./whoPrediction";

export type GrowthDataset = "cdc" | "who";

const PERCENTILE_MARKERS = [3, 5, 10, 25, 50, 75, 90, 95, 97] as const;
const HEIGHT_MATCH_EPSILON_CM = 0.01;

interface DatasetMath {
  label: string;
  getMonthRange: (sex: GrowthSexCode) => { min: number; max: number };
  heightForPercentile: (input: {
    sex: GrowthSexCode;
    ageMonths: number;
    percentile: number;
  }) => number;
  percentileForHeight: (input: {
    sex: GrowthSexCode;
    ageMonths: number;
    heightCm: number;
  }) => number;
}

const datasetMath: Record<GrowthDataset, DatasetMath> = {
  cdc: {
    label: "CDC",
    getMonthRange: getCdcMonthRange as DatasetMath["getMonthRange"],
    heightForPercentile: ({ sex, ageMonths, percentile }) =>
      cdcHeightForPercentile({
        sex: sex as CdcSexCode,
        ageMonths,
        percentile,
      }),
    percentileForHeight: ({ sex, ageMonths, heightCm }) =>
      cdcPercentileForHeight({
        sex: sex as CdcSexCode,
        ageMonths,
        heightCm,
      }),
  },
  who: {
    label: "WHO",
    getMonthRange: getWhoMonthRange as DatasetMath["getMonthRange"],
    heightForPercentile: ({ sex, ageMonths, percentile }) =>
      whoHeightForPercentile({
        sex: sex as WhoSexCode,
        ageMonths,
        percentile,
      }),
    percentileForHeight: ({ sex, ageMonths, heightCm }) =>
      whoPercentileForHeight({
        sex: sex as WhoSexCode,
        ageMonths,
        heightCm,
      }),
  },
};

export interface UserData {
  heightCm: number;
  age: number;
  sex: GrowthSexCode;
  motherHeightCm?: number;
  fatherHeightCm?: number;
  weightKg?: number;
  sleepHoursPerNight?: number;
  exerciseHoursPerWeek?: number;
  measuredGrowthVelocityCmPerYear?: number;
  longitudinalGrowthSummary?: LongitudinalGrowthSummary;
  puberty?: PubertyAnswers;
  rawPubertySignals?: RawPubertySignalsV1;
}

export interface HeightData {
  current: HeightMeasurement;
  actual: HeightMeasurement;
  potential: HeightMeasurement;
  percentileRank?: number;
  percentileSummary?: HeightPercentileSummary;
  growthComplete?: number;
  dataset?: GrowthDataset;
  datasetLabel?: string;
  projectedAdultHeightCm?: number;
  ageMonthsUsed?: number;
  percentileZScore?: number;
  residualAdjustmentCm?: number;
  // Deprecated alias kept for existing UI callers.
  pubertyAdjustmentCm?: number;
  pubertyConfidence?: number;
  projectionModelId?: string;
}

interface PercentileBand {
  percentile: number;
  name: string;
  display: string;
  value: number;
}

export interface HeightPercentileSummary {
  percentile: number;
  zScore: number;
  range: string;
  percentileDisplay: string;
  lowerBound: PercentileBand | null;
  upperBound: PercentileBand | null;
  lowerName: string;
  upperName: string;
  dataset: GrowthDataset;
  datasetLabel: string;
  ageMonths: number;
  wasAgeClamped: boolean;
  datasetRange: { min: number; max: number };
  percentileBands: PercentileBand[];
}

export interface CalculatePercentileParams {
  sex: GrowthSexCode;
  ageMonths: number;
  heightCm: number;
  dataset?: GrowthDataset;
}

export interface HeightProjectionOptions {
  dataset?: GrowthDataset;
  residualModel?:
    | ProjectionResidualModelSourceV2
    | ProjectionResidualModelSourceV3
    | ProjectionResidualModelSourceV4;
  residualModelVersion?: "v2" | "v3" | "v4";
}

export interface BaselineAdultHeightProjection {
  percentileSummary: HeightPercentileSummary;
  datasetAdultHeightCm?: number;
  midParentalHeightCm?: number;
  parentBlendWeight?: number;
  projectedAdultHeightCm?: number;
}

export interface ProjectionResidualInputBuildResult {
  percentileSummary: HeightPercentileSummary;
  projectedAdultHeightCm?: number;
  pubertyEstimate: PubertyEstimate | null;
  projectionResidualInput: LocalProjectionModelInputV2;
}

export interface ProjectionResidualInputBuildResultV3 {
  percentileSummary: HeightPercentileSummary;
  projectedAdultHeightCm?: number;
  pubertyEstimate: PubertyEstimate | null;
  projectionResidualInput: LocalProjectionModelInputV3;
}

export interface ProjectionResidualInputBuildResultV4 {
  percentileSummary: HeightPercentileSummary;
  projectedAdultHeightCm?: number;
  pubertyEstimate: PubertyEstimate | null;
  pubertyEncoding: CanonicalPubertyEncodingV1 | null;
  projectionResidualInput: LocalProjectionModelInputV4;
}

const PARENT_BLEND_WEIGHT_MIN = 0.2;
const PARENT_BLEND_WEIGHT_MAX = 0.45;
const DEFAULT_PARENT_BLEND_WEIGHT = 0.3;
export const RESIDUAL_MODEL_MIN_AGE_YEARS = 8;
export const RESIDUAL_MODEL_MAX_AGE_YEARS = 18.5;
const LATE_TEEN_POSITIVE_RESIDUAL_MAX_EVIDENCE_SCORE = 1;

function clampValue(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  if (min > max) {
    return min;
  }
  return clamp(value, min, max);
}

function interpolateLinear(
  value: number,
  inputMin: number,
  inputMax: number,
  outputMin: number,
  outputMax: number
): number {
  if (!Number.isFinite(value)) {
    return outputMin;
  }
  if (inputMax <= inputMin) {
    return outputMin;
  }
  const t = clamp((value - inputMin) / (inputMax - inputMin), 0, 1);
  return outputMin + (outputMax - outputMin) * t;
}

function indicatesRecentGrowth(
  value: PubertyAnswers["puberty_growthLastYear"]
): boolean {
  return value === "6to9" || value === "10plus";
}

function indicatesStillGrowing(
  value: PubertyAnswers["puberty_stillGrowingSlower"]
): boolean {
  return (
    value === "yes" ||
    value === "same" ||
    value === "slower" ||
    value === "faster"
  );
}

function getLongitudinalEvidenceScore(
  summary: LongitudinalGrowthSummary | undefined
): number {
  if (
    summary?.version !== "gotall_longitudinal_growth_summary_v1" ||
    !Number.isFinite(summary.recentVelocityCmPerYear) ||
    !Number.isFinite(summary.velocityDeltaCmPerYear) ||
    !Number.isFinite(summary.windowSpanDays) ||
    !Number.isFinite(summary.measurementCount) ||
    !Number.isFinite(summary.fitErrorCm)
  ) {
    return 0;
  }

  const hasDenseWindow =
    summary.measurementCount >= 4 &&
    summary.windowSpanDays >= 180 &&
    summary.sparseMeasurementQualityFlag === 0;
  const hasPositiveGrowthSignal =
    summary.recentVelocityCmPerYear >= 1.5 || summary.velocityDeltaCmPerYear >= 1;
  if (!hasPositiveGrowthSignal) {
    return 0;
  }
  let score = 0;

  if (summary.recentVelocityCmPerYear >= 2.5) {
    score += hasDenseWindow ? 0.55 : 0.25;
  } else if (summary.recentVelocityCmPerYear >= 1.5) {
    score += hasDenseWindow ? 0.3 : 0.12;
  }
  if (summary.velocityDeltaCmPerYear >= 1) {
    score += hasDenseWindow ? 0.2 : 0.08;
  }
  if (summary.measurementCount >= 4 && summary.windowSpanDays >= 240) {
    score += 0.1;
  }
  if (summary.fitErrorCm <= 0.75 && summary.sparseMeasurementQualityFlag === 0) {
    score += 0.1;
  }

  return clamp(score, 0, LATE_TEEN_POSITIVE_RESIDUAL_MAX_EVIDENCE_SCORE);
}

function getMeasuredVelocityEvidenceScore(
  measuredGrowthVelocityCmPerYear: number | undefined
): number {
  if (!Number.isFinite(measuredGrowthVelocityCmPerYear)) {
    return 0;
  }

  const measuredVelocity = measuredGrowthVelocityCmPerYear as number;
  if (measuredVelocity >= 3) {
    return 0.7;
  }
  if (measuredVelocity >= 2) {
    return 0.4;
  }
  if (measuredVelocity >= 1) {
    return 0.15;
  }
  return 0;
}

function getLateTeenPubertyUnlockScale(
  ageYears: number,
  sex: GrowthSexCode
): number {
  if (!Number.isFinite(ageYears)) {
    return 0;
  }
  if (sex === "2") {
    if (ageYears <= 14.5) return 0.35;
    if (ageYears >= 15.75) return 0.02;
    return interpolateLinear(ageYears, 14.5, 15.75, 0.35, 0.02);
  }
  if (ageYears <= 16) return 0.35;
  if (ageYears >= 17) return 0.02;
  return interpolateLinear(ageYears, 16, 17, 0.35, 0.02);
}

function getLateTeenHardGrowthEvidenceScore(userData: UserData): number {
  const measuredVelocityScore = getMeasuredVelocityEvidenceScore(
    userData.measuredGrowthVelocityCmPerYear
  );
  const longitudinalScore = getLongitudinalEvidenceScore(
    userData.longitudinalGrowthSummary
  );
  const score =
    measuredVelocityScore > 0 && longitudinalScore > 0
      ? Math.max(measuredVelocityScore, longitudinalScore)
      : measuredVelocityScore + longitudinalScore;

  return clamp(score, 0, LATE_TEEN_POSITIVE_RESIDUAL_MAX_EVIDENCE_SCORE);
}

function shouldProtectHardGrowthEvidenceFloor(params: {
  ageYears: number;
  sex: GrowthSexCode;
  hardGrowthEvidenceScore: number;
}): boolean {
  const protectionAge = params.sex === "2" ? 14.5 : 16;
  return (
    Number.isFinite(params.ageYears) &&
    params.ageYears >= protectionAge &&
    params.hardGrowthEvidenceScore >= 0.3
  );
}

function isSingleProjectionResidualModelV4(
  value: unknown
): value is ProjectionResidualLinearModelV4 {
  if (typeof value !== "object" || value == null) {
    return false;
  }
  const candidate = value as Partial<ProjectionResidualLinearModelV4>;
  return (
    candidate.modelId === LOCAL_PROJECTION_MODEL_ID_V4 &&
    candidate.inputVersion === LOCAL_PROJECTION_MODEL_INPUT_VERSION_V4 &&
    candidate.featureVersion === LOCAL_PROJECTION_FEATURE_VERSION_V4 &&
    candidate.target === "potential_height_adjustment_cm"
  );
}

function getV4MaleLateTeenFallbackBlendWeight(params: {
  residualModelVersion: "v2" | "v3" | "v4";
  sex: GrowthSexCode;
  ageYears: number;
  hasCustomResidualModel: boolean;
}): number {
  if (params.residualModelVersion !== "v4") {
    return 0;
  }
  if (params.hasCustomResidualModel) {
    return 0;
  }
  if (params.sex !== "1") {
    return 0;
  }
  if (!Number.isFinite(params.ageYears)) {
    return 0;
  }
  return params.ageYears > 16.5 && params.ageYears <= 17.5 ? 1 : 0;
}

function getLateTeenPositiveGrowthEvidenceScore(params: {
  userData: UserData;
  pubertyEstimate: PubertyEstimate | null;
}): number {
  const { userData, pubertyEstimate } = params;
  const hardEvidenceScore = getLateTeenHardGrowthEvidenceScore(userData);
  let pubertyEvidenceScore = 0;

  const pubertyConfidence = pubertyEstimate?.confidence ?? 0;
  const stageGap =
    Number.isFinite(pubertyEstimate?.expectedStage) &&
    Number.isFinite(pubertyEstimate?.stageContinuous)
      ? (pubertyEstimate?.expectedStage ?? 0) -
        (pubertyEstimate?.stageContinuous ?? 0)
      : 0;

  if (pubertyEstimate?.timing === "late" && pubertyConfidence >= 0.55) {
    pubertyEvidenceScore += 0.25;
  }
  if (stageGap >= 0.5 && pubertyConfidence >= 0.55) {
    pubertyEvidenceScore += 0.25;
  }
  if (indicatesRecentGrowth(userData.puberty?.puberty_growthLastYear)) {
    pubertyEvidenceScore += indicatesStillGrowing(
      userData.puberty?.puberty_stillGrowingSlower
    )
      ? 0.25
      : 0.1;
  } else if (
    userData.puberty?.puberty_growthLastYear === "2to5" &&
    indicatesStillGrowing(userData.puberty?.puberty_stillGrowingSlower)
  ) {
    pubertyEvidenceScore += 0.08;
  }

  const pubertyUnlockScale = getLateTeenPubertyUnlockScale(
    userData.age,
    userData.sex
  );

  return clamp(
    hardEvidenceScore + pubertyEvidenceScore * pubertyUnlockScale,
    0,
    LATE_TEEN_POSITIVE_RESIDUAL_MAX_EVIDENCE_SCORE
  );
}

function getLateTeenPositiveResidualGuardrail(params: {
  ageYears: number;
  sex: GrowthSexCode;
  evidenceScore: number;
  hardGrowthEvidenceScore: number;
}): { scale: number; capCm: number } {
  const { ageYears, sex } = params;
  const evidenceScore = clamp(
    params.evidenceScore,
    0,
    LATE_TEEN_POSITIVE_RESIDUAL_MAX_EVIDENCE_SCORE
  );
  const hardGrowthEvidenceScore = clamp(
    params.hardGrowthEvidenceScore,
    0,
    LATE_TEEN_POSITIVE_RESIDUAL_MAX_EVIDENCE_SCORE
  );
  const thresholds =
    sex === "2"
      ? {
          fadeStart: 14.5,
          strongGuardrail: 15.5,
          cutoff: 16.5,
          nearAdultCapAge: 17.5,
        }
      : {
          fadeStart: 16,
          strongGuardrail: 17,
          cutoff: 18,
          nearAdultCapAge: RESIDUAL_MODEL_MAX_AGE_YEARS,
        };

  if (!Number.isFinite(ageYears) || ageYears < thresholds.fadeStart) {
    return { scale: 1, capCm: 3.5 };
  }

  if (hardGrowthEvidenceScore < 0.05) {
    if (ageYears < thresholds.strongGuardrail) {
      return {
        scale: interpolateLinear(
          ageYears,
          thresholds.fadeStart,
          thresholds.strongGuardrail,
          0.25,
          0
        ),
        capCm: interpolateLinear(
          ageYears,
          thresholds.fadeStart,
          thresholds.strongGuardrail,
          0.75,
          0
        ),
      };
    }
    return { scale: 0, capCm: 0 };
  }

  if (ageYears < thresholds.strongGuardrail) {
    const minScale = interpolateLinear(
      ageYears,
      thresholds.fadeStart,
      thresholds.strongGuardrail,
      0.65,
      0.35
    );
    const capFloor = interpolateLinear(
      ageYears,
      thresholds.fadeStart,
      thresholds.strongGuardrail,
      1.7,
      0.95
    );
    return {
      scale: minScale + (1 - minScale) * evidenceScore,
      capCm: capFloor + (2.6 - capFloor) * evidenceScore,
    };
  }

  if (ageYears < thresholds.cutoff) {
    const minScale = interpolateLinear(
      ageYears,
      thresholds.strongGuardrail,
      thresholds.cutoff,
      0.22,
      0.08
    );
    const maxScale = interpolateLinear(
      ageYears,
      thresholds.strongGuardrail,
      thresholds.cutoff,
      0.65,
      0.35
    );
    const capFloor = interpolateLinear(
      ageYears,
      thresholds.strongGuardrail,
      thresholds.cutoff,
      0.75,
      0.25
    );
    const capCeiling = interpolateLinear(
      ageYears,
      thresholds.strongGuardrail,
      thresholds.cutoff,
      1.6,
      0.85
    );
    return {
      scale: minScale + (maxScale - minScale) * evidenceScore,
      capCm: capFloor + (capCeiling - capFloor) * evidenceScore,
    };
  }

  const clampedAgeYears = Math.min(ageYears, thresholds.nearAdultCapAge);
  const minScale = interpolateLinear(
    clampedAgeYears,
    thresholds.cutoff,
    thresholds.nearAdultCapAge,
    0.06,
    0.02
  );
  const maxScale = interpolateLinear(
    clampedAgeYears,
    thresholds.cutoff,
    thresholds.nearAdultCapAge,
    0.35,
    0.2
  );
  const capFloor = interpolateLinear(
    clampedAgeYears,
    thresholds.cutoff,
    thresholds.nearAdultCapAge,
    0.2,
    0.1
  );
  const capCeiling = interpolateLinear(
    clampedAgeYears,
    thresholds.cutoff,
    thresholds.nearAdultCapAge,
    0.85,
    0.45
  );

  return {
    scale: minScale + (maxScale - minScale) * evidenceScore,
    capCm: capFloor + (capCeiling - capFloor) * evidenceScore,
  };
}

function applyLateTeenPositiveResidualGuardrail(params: {
  ageYears: number;
  adjustmentCm: number;
  userData: UserData;
  pubertyEstimate: PubertyEstimate | null;
}): number {
  if (!(params.adjustmentCm > 0)) {
    return params.adjustmentCm;
  }

  const evidenceScore = getLateTeenPositiveGrowthEvidenceScore({
    userData: params.userData,
    pubertyEstimate: params.pubertyEstimate,
  });
  const hardGrowthEvidenceScore = getLateTeenHardGrowthEvidenceScore(
    params.userData
  );
  const { scale, capCm } = getLateTeenPositiveResidualGuardrail({
    ageYears: params.ageYears,
    sex: params.userData.sex,
    evidenceScore,
    hardGrowthEvidenceScore,
  });

  return Math.min(params.adjustmentCm * scale, capCm);
}

function getPotentialPolicy(params: {
  ageYears: number;
  userData: UserData;
  pubertyEstimate: PubertyEstimate | null;
}): { extraInches: number; totalUpsideCapInches: number } {
  const evidenceScore = getLateTeenPositiveGrowthEvidenceScore({
    userData: params.userData,
    pubertyEstimate: params.pubertyEstimate,
  });

  if (params.ageYears >= 21) {
    return {
      extraInches: 0,
      totalUpsideCapInches: 0.5,
    };
  }
  if (params.ageYears >= 19) {
    return {
      extraInches: 0.05 + evidenceScore * 0.15,
      totalUpsideCapInches: 0.35 + evidenceScore * 0.45,
    };
  }
  if (params.ageYears >= 18) {
    return {
      extraInches: 0.1 + evidenceScore * 0.25,
      totalUpsideCapInches: 0.75 + evidenceScore * 0.75,
    };
  }
  return {
    extraInches: 0.5,
    totalUpsideCapInches: Number.POSITIVE_INFINITY,
  };
}

function formatOrdinal(value: number): string {
  const rounded = Math.round(value);
  const mod100 = rounded % 100;
  if (mod100 >= 11 && mod100 <= 13) {
    return `${rounded}th`;
  }
  switch (rounded % 10) {
    case 1:
      return `${rounded}st`;
    case 2:
      return `${rounded}nd`;
    case 3:
      return `${rounded}rd`;
    default:
      return `${rounded}th`;
  }
}

function formatPercentileDisplay(percentile: number): string {
  const rounded = Math.round(percentile * 10) / 10;
  if (Math.abs(rounded - Math.round(rounded)) < 1e-6) {
    return formatOrdinal(Math.round(rounded));
  }
  return `${rounded.toFixed(1)}th`;
}

function resolveDatasetOrder(
  ageMonths: number,
  sex: GrowthSexCode,
  override?: GrowthDataset
): GrowthDataset[] {
  if (override) {
    return override === "cdc" ? ["cdc", "who"] : ["who", "cdc"];
  }

  const order: GrowthDataset[] = [];
  const whoRange = datasetMath.who.getMonthRange(sex);
  if (ageMonths >= whoRange.min && ageMonths <= whoRange.max) {
    order.push("who");
  }
  order.push(order.includes("cdc") ? ("cdc" as GrowthDataset) : "cdc");
  if (!order.includes("who")) {
    order.push("who");
  }
  return order;
}

function determinePercentileRange(
  heightCm: number,
  bands: PercentileBand[]
): {
  range: string;
  lowerBound: PercentileBand | null;
  upperBound: PercentileBand | null;
  lowerName: string;
  upperName: string;
} {
  if (bands.length === 0) {
    return {
      range: "Unknown percentile",
      lowerBound: null,
      upperBound: null,
      lowerName: "Unknown",
      upperName: "Unknown",
    };
  }

  const first = bands[0];
  const last = bands[bands.length - 1];

  if (heightCm < first.value - HEIGHT_MATCH_EPSILON_CM) {
    return {
      range: `Below ${first.display} percentile`,
      lowerBound: null,
      upperBound: first,
      lowerName: "Below",
      upperName: `${first.display} percentile`,
    };
  }

  if (heightCm > last.value + HEIGHT_MATCH_EPSILON_CM) {
    return {
      range: `Above ${last.display} percentile`,
      lowerBound: last,
      upperBound: null,
      lowerName: `${last.display} percentile`,
      upperName: "Above",
    };
  }

  for (let i = 0; i < bands.length - 1; i++) {
    const lower = bands[i];
    const upper = bands[i + 1];
    if (
      heightCm >= lower.value - HEIGHT_MATCH_EPSILON_CM &&
      heightCm <= upper.value + HEIGHT_MATCH_EPSILON_CM
    ) {
      return {
        range: `${lower.display} - ${upper.display} percentile`,
        lowerBound: lower,
        upperBound: upper,
        lowerName: `${lower.display} percentile`,
        upperName: `${upper.display} percentile`,
      };
    }
  }

  const median = bands[Math.floor(bands.length / 2)];
  return {
    range: `${median.display} percentile`,
    lowerBound: median,
    upperBound: median,
    lowerName: `${median.display} percentile`,
    upperName: `${median.display} percentile`,
  };
}

function computePercentileSummaryForDataset(
  params: CalculatePercentileParams & { dataset: GrowthDataset }
): HeightPercentileSummary {
  const { sex, heightCm, dataset } = params;
  const math = datasetMath[dataset];
  const { min, max } = math.getMonthRange(sex);
  const rawAgeMonths = Number.isFinite(params.ageMonths) ? params.ageMonths : 0;
  const ageMonths = clampValue(rawAgeMonths, min, max);

  const percentileValue = math.percentileForHeight({
    sex,
    ageMonths,
    heightCm,
  });
  const percentileClamped = clamp(percentileValue, 0, 100);
  const normalized = clamp(
    percentileClamped / 100,
    LMS_PERCENTILE_EPSILON,
    1 - LMS_PERCENTILE_EPSILON
  );
  const zScore = inverseStandardNormal(normalized);

  const percentileBands: PercentileBand[] = PERCENTILE_MARKERS.map(
    (marker) => ({
      percentile: marker,
      name: `P${marker}`,
      display: formatOrdinal(marker),
      value: math.heightForPercentile({
        sex,
        ageMonths,
        percentile: marker,
      }),
    })
  ).filter((band) => Number.isFinite(band.value));

  const rangeInfo = determinePercentileRange(heightCm, percentileBands);

  return {
    percentile: percentileClamped,
    zScore,
    range: rangeInfo.range,
    percentileDisplay: `${formatPercentileDisplay(
      percentileClamped
    )} percentile`,
    lowerBound: rangeInfo.lowerBound,
    upperBound: rangeInfo.upperBound,
    lowerName: rangeInfo.lowerName,
    upperName: rangeInfo.upperName,
    dataset,
    datasetLabel: math.label,
    ageMonths,
    wasAgeClamped: ageMonths !== rawAgeMonths,
    datasetRange: { min, max },
    percentileBands,
  };
}

export function calculatePercentile(
  params: CalculatePercentileParams
): HeightPercentileSummary {
  const ageMonths = Number.isFinite(params.ageMonths) ? params.ageMonths : 0;
  const order = resolveDatasetOrder(ageMonths, params.sex, params.dataset);
  let lastError: unknown;

  for (const dataset of order) {
    try {
      return computePercentileSummaryForDataset({ ...params, dataset });
    } catch (error) {
      lastError = error;
    }
  }

  console.error(
    "[heightProjection] Failed to calculate percentile with LMS tables",
    lastError
  );

  const fallbackDataset: GrowthDataset = "cdc";
  const { min, max } = datasetMath[fallbackDataset].getMonthRange(params.sex);
  const clampedAge = clampValue(ageMonths, min, max);

  return {
    percentile: 50,
    zScore: 0,
    range: "50th percentile",
    percentileDisplay: "50th percentile",
    lowerBound: null,
    upperBound: null,
    lowerName: "50th percentile",
    upperName: "50th percentile",
    dataset: fallbackDataset,
    datasetLabel: datasetMath[fallbackDataset].label,
    ageMonths: clampedAge,
    wasAgeClamped: clampedAge !== ageMonths,
    datasetRange: { min, max },
    percentileBands: [],
  };
}

function calculateAdultHeightForPercentile(params: {
  sex: GrowthSexCode;
  percentileSummary: HeightPercentileSummary;
}): number | undefined {
  const { sex, percentileSummary } = params;
  const adultDataset =
    percentileSummary.dataset === "who" ? "cdc" : percentileSummary.dataset;
  const math = datasetMath[adultDataset];
  try {
    return math.heightForPercentile({
      sex,
      ageMonths: math.getMonthRange(sex).max,
      percentile: percentileSummary.percentile,
    });
  } catch (error) {
    console.warn(
      "[heightProjection] Failed to evaluate adult height from percentile",
      error
    );
    return undefined;
  }
}

function shouldApplyResidualModel(ageYears: number): boolean {
  return (
    Number.isFinite(ageYears) &&
    ageYears >= RESIDUAL_MODEL_MIN_AGE_YEARS &&
    ageYears <= RESIDUAL_MODEL_MAX_AGE_YEARS
  );
}

function resolveResidualModelVersion(
  options: HeightProjectionOptions
): "v2" | "v3" | "v4" {
  if (options.residualModelVersion === "v4") {
    return "v4";
  }
  if (options.residualModelVersion === "v3") {
    return "v3";
  }
  if (options.residualModelVersion === "v2") {
    return "v2";
  }

  const residualModel = options.residualModel as
    | { version?: unknown; inputVersion?: unknown }
    | null
    | undefined;
  if (
    residualModel?.inputVersion === LOCAL_PROJECTION_MODEL_INPUT_VERSION_V4 ||
    isProjectionResidualModelSetV4(residualModel)
  ) {
    return "v4";
  }

  if (
    residualModel?.inputVersion === LOCAL_PROJECTION_MODEL_INPUT_VERSION_V3 ||
    isProjectionResidualModelSetV3(residualModel)
  ) {
    return "v3";
  }

  return "v2";
}

function getParentBlendWeight(ageYears: number): number {
  if (!Number.isFinite(ageYears)) {
    return DEFAULT_PARENT_BLEND_WEIGHT;
  }

  const ageAdjustedWeight = 0.5 - (ageYears - 8) * 0.025;
  return clamp(
    ageAdjustedWeight,
    PARENT_BLEND_WEIGHT_MIN,
    PARENT_BLEND_WEIGHT_MAX
  );
}

function blendAdultHeightWithParents(params: {
  ageYears: number;
  datasetAdultHeightCm?: number;
  midParentalHeightCm?: number | null;
}): {
  projectedAdultHeightCm?: number;
  parentBlendWeight?: number;
} {
  const { datasetAdultHeightCm, midParentalHeightCm } = params;
  const hasDatasetAdultHeight = Number.isFinite(datasetAdultHeightCm);
  const hasMidParentalHeight = Number.isFinite(midParentalHeightCm);

  if (!hasDatasetAdultHeight && !hasMidParentalHeight) {
    return {};
  }

  if (!hasDatasetAdultHeight) {
    return {
      projectedAdultHeightCm: midParentalHeightCm as number,
      parentBlendWeight: 1,
    };
  }

  if (!hasMidParentalHeight) {
    return {
      projectedAdultHeightCm: datasetAdultHeightCm as number,
      parentBlendWeight: 0,
    };
  }

  const parentBlendWeight = getParentBlendWeight(params.ageYears);
  return {
    projectedAdultHeightCm:
      (datasetAdultHeightCm as number) * (1 - parentBlendWeight) +
      (midParentalHeightCm as number) * parentBlendWeight,
    parentBlendWeight,
  };
}

export function calculateBaselineAdultHeightProjection(
  params: CalculatePercentileParams & {
    ageYears?: number;
    motherHeightCm?: number;
    fatherHeightCm?: number;
  }
): BaselineAdultHeightProjection {
  const percentileSummary = calculatePercentile(params);
  const datasetAdultHeightCm = calculateAdultHeightForPercentile({
    sex: params.sex,
    percentileSummary,
  });
  const midParentalHeightCm = calculateMidParentalHeightCm({
    sex: params.sex,
    motherHeightCm: params.motherHeightCm,
    fatherHeightCm: params.fatherHeightCm,
  });
  const { projectedAdultHeightCm, parentBlendWeight } = blendAdultHeightWithParents(
    {
      ageYears: params.ageYears ?? params.ageMonths / 12,
      datasetAdultHeightCm,
      midParentalHeightCm,
    }
  );

  return {
    percentileSummary,
    datasetAdultHeightCm,
    midParentalHeightCm: midParentalHeightCm ?? undefined,
    parentBlendWeight,
    projectedAdultHeightCm,
  };
}

export function buildProjectionResidualInputV2FromUserData(params: {
  userData: UserData;
  dataset?: GrowthDataset;
  baselineProjection?: BaselineAdultHeightProjection;
}): ProjectionResidualInputBuildResult {
  const { userData, dataset } = params;
  const baselineProjection =
    params.baselineProjection ??
    calculateBaselineAdultHeightProjection({
      sex: userData.sex,
      ageMonths: (Number.isFinite(userData.age) ? userData.age : 0) * 12,
      ageYears: userData.age,
      heightCm: userData.heightCm,
      motherHeightCm: userData.motherHeightCm,
      fatherHeightCm: userData.fatherHeightCm,
      dataset,
    });
  const ageYears = Number.isFinite(userData.age) ? userData.age : 0;
  const pubertyEstimate = userData.puberty
    ? estimatePubertyState({
        ageYears,
        sex: userData.sex,
        answers: userData.puberty,
      })
    : null;

  return {
    percentileSummary: baselineProjection.percentileSummary,
    projectedAdultHeightCm: baselineProjection.projectedAdultHeightCm,
    pubertyEstimate,
    projectionResidualInput: createLocalProjectionModelInputV2({
      ageYears,
      sex: userData.sex,
      heightCm: userData.heightCm,
      percentile: baselineProjection.percentileSummary.percentile,
      percentileZScore: baselineProjection.percentileSummary.zScore,
      motherHeightCm: userData.motherHeightCm,
      fatherHeightCm: userData.fatherHeightCm,
      weightKg: userData.weightKg,
      sleepHoursPerNight: userData.sleepHoursPerNight,
      exerciseHoursPerWeek: userData.exerciseHoursPerWeek,
      measuredGrowthVelocityCmPerYear: userData.measuredGrowthVelocityCmPerYear,
      pubertyAnswers: userData.puberty,
      pubertyObservedStage: pubertyEstimate?.stageContinuous,
      pubertyExpectedStage: pubertyEstimate?.expectedStage,
      pubertyTiming: pubertyEstimate?.timing,
      pubertyConfidence: pubertyEstimate?.confidence,
    }),
  };
}

export function buildProjectionResidualInputV3FromUserData(params: {
  userData: UserData;
  dataset?: GrowthDataset;
  baselineProjection?: BaselineAdultHeightProjection;
}): ProjectionResidualInputBuildResultV3 {
  const { userData, dataset } = params;
  const baselineProjection =
    params.baselineProjection ??
    calculateBaselineAdultHeightProjection({
      sex: userData.sex,
      ageMonths: (Number.isFinite(userData.age) ? userData.age : 0) * 12,
      ageYears: userData.age,
      heightCm: userData.heightCm,
      motherHeightCm: userData.motherHeightCm,
      fatherHeightCm: userData.fatherHeightCm,
      dataset,
    });
  const ageYears = Number.isFinite(userData.age) ? userData.age : 0;
  const pubertyEstimate = userData.puberty
    ? estimatePubertyState({
        ageYears,
        sex: userData.sex,
        answers: userData.puberty,
      })
    : null;

  return {
    percentileSummary: baselineProjection.percentileSummary,
    projectedAdultHeightCm: baselineProjection.projectedAdultHeightCm,
    pubertyEstimate,
    projectionResidualInput: createLocalProjectionModelInputV3({
      ageYears,
      sex: userData.sex,
      heightCm: userData.heightCm,
      percentile: baselineProjection.percentileSummary.percentile,
      percentileZScore: baselineProjection.percentileSummary.zScore,
      motherHeightCm: userData.motherHeightCm,
      fatherHeightCm: userData.fatherHeightCm,
      weightKg: userData.weightKg,
      sleepHoursPerNight: userData.sleepHoursPerNight,
      exerciseHoursPerWeek: userData.exerciseHoursPerWeek,
      measuredGrowthVelocityCmPerYear: userData.measuredGrowthVelocityCmPerYear,
      longitudinalGrowthSummary: userData.longitudinalGrowthSummary,
      pubertyAnswers: userData.puberty,
      pubertyObservedStage: pubertyEstimate?.stageContinuous,
      pubertyExpectedStage: pubertyEstimate?.expectedStage,
      pubertyTiming: pubertyEstimate?.timing,
      pubertyConfidence: pubertyEstimate?.confidence,
    }),
  };
}

export function buildProjectionResidualInputV4FromUserData(params: {
  userData: UserData;
  dataset?: GrowthDataset;
  baselineProjection?: BaselineAdultHeightProjection;
}): ProjectionResidualInputBuildResultV4 {
  const { userData, dataset } = params;
  const baselineProjection =
    params.baselineProjection ??
    calculateBaselineAdultHeightProjection({
      sex: userData.sex,
      ageMonths: (Number.isFinite(userData.age) ? userData.age : 0) * 12,
      ageYears: userData.age,
      heightCm: userData.heightCm,
      motherHeightCm: userData.motherHeightCm,
      fatherHeightCm: userData.fatherHeightCm,
      dataset,
    });
  const ageYears = Number.isFinite(userData.age) ? userData.age : 0;
  const pubertyEstimate = userData.puberty
    ? estimatePubertyState({
        ageYears,
        sex: userData.sex,
        answers: userData.puberty,
      })
    : null;
  const canonicalPubertyInput =
    buildCanonicalPubertyEncoderInputFromRawSignals({
      sex: userData.sex,
      ageYears,
      rawPubertySignals: userData.rawPubertySignals,
    }) ??
    buildCanonicalPubertyEncoderInputFromPubertyAnswers({
      sex: userData.sex,
      ageYears,
      answers: userData.puberty,
    });
  const pubertyEncoding = canonicalPubertyInput
    ? encodeCanonicalPubertyV1(canonicalPubertyInput)
    : null;

  return {
    percentileSummary: baselineProjection.percentileSummary,
    projectedAdultHeightCm: baselineProjection.projectedAdultHeightCm,
    pubertyEstimate,
    pubertyEncoding,
    projectionResidualInput: createLocalProjectionModelInputV4({
      ageYears,
      sex: userData.sex,
      heightCm: userData.heightCm,
      percentile: baselineProjection.percentileSummary.percentile,
      percentileZScore: baselineProjection.percentileSummary.zScore,
      motherHeightCm: userData.motherHeightCm,
      fatherHeightCm: userData.fatherHeightCm,
      weightKg: userData.weightKg,
      sleepHoursPerNight: userData.sleepHoursPerNight,
      exerciseHoursPerWeek: userData.exerciseHoursPerWeek,
      measuredGrowthVelocityCmPerYear: userData.measuredGrowthVelocityCmPerYear,
      longitudinalGrowthSummary: userData.longitudinalGrowthSummary,
      pubertyEncoding,
    }),
  };
}

export function calculateHeightProjection(
  userData: UserData,
  options: HeightProjectionOptions = {}
): HeightData {
  const currentMeasurement = createHeightMeasurementFromCm(userData.heightCm);
  const currentHeightInches = currentMeasurement.inches;
  const ageYears = Number.isFinite(userData.age) ? userData.age : 0;
  const ageMonthsRaw = ageYears * 12;

  const baselineProjection = calculateBaselineAdultHeightProjection({
    sex: userData.sex,
    ageMonths: ageMonthsRaw,
    ageYears,
    heightCm: userData.heightCm,
    motherHeightCm: userData.motherHeightCm,
    fatherHeightCm: userData.fatherHeightCm,
    dataset: options.dataset,
  });
  const percentileSummary = baselineProjection.percentileSummary;
  const projectedAdultHeightCm = baselineProjection.projectedAdultHeightCm;
  const residualModelVersion = resolveResidualModelVersion(options);
  const v2InputBuild = residualModelVersion === "v2"
    ? buildProjectionResidualInputV2FromUserData({
        userData,
        dataset: options.dataset,
        baselineProjection,
      })
    : null;
  const v3InputBuild = residualModelVersion === "v3"
    ? buildProjectionResidualInputV3FromUserData({
        userData,
        dataset: options.dataset,
        baselineProjection,
      })
    : null;
  const v4InputBuild = residualModelVersion === "v4"
    ? buildProjectionResidualInputV4FromUserData({
        userData,
        dataset: options.dataset,
        baselineProjection,
      })
    : null;
  const pubertyEstimate =
    v4InputBuild?.pubertyEstimate ??
    v3InputBuild?.pubertyEstimate ??
    v2InputBuild?.pubertyEstimate ??
    null;
  const pubertyEncoding = v4InputBuild?.pubertyEncoding ?? null;
  const projectionResidual =
    residualModelVersion === "v4"
      ? shouldApplyResidualModel(ageYears)
        ? evaluateProjectionResidualModelV4(
            v4InputBuild!.projectionResidualInput,
            options.residualModel as ProjectionResidualModelSourceV4 | undefined
          )
        : {
            modelId: LOCAL_PROJECTION_MODEL_ID_V4,
            adjustmentCm: 0,
            featureVector: buildProjectionResidualFeatureVectorV4(
              v4InputBuild!.projectionResidualInput
            ),
          }
      : residualModelVersion === "v3"
      ? shouldApplyResidualModel(ageYears)
        ? evaluateProjectionResidualModelV3(
            v3InputBuild!.projectionResidualInput,
            options.residualModel as ProjectionResidualModelSourceV3 | undefined
          )
        : {
            modelId: LOCAL_PROJECTION_MODEL_ID_V3,
            adjustmentCm: 0,
            featureVector: buildProjectionResidualFeatureVectorV3(
              v3InputBuild!.projectionResidualInput
            ),
          }
      : shouldApplyResidualModel(ageYears)
        ? evaluateProjectionResidualModelV2(
            v2InputBuild!.projectionResidualInput,
            options.residualModel as ProjectionResidualModelSourceV2 | undefined
          )
        : {
            modelId: LOCAL_PROJECTION_MODEL_ID_V2,
            adjustmentCm: 0,
            featureVector: buildProjectionResidualFeatureVectorV2(
              v2InputBuild!.projectionResidualInput
            ),
          };
  let effectiveProjectionModelId = projectionResidual.modelId;
  const pubertyAdjustmentCm = applyLateTeenPositiveResidualGuardrail({
    ageYears,
    adjustmentCm: projectionResidual.adjustmentCm,
    userData,
    pubertyEstimate,
  });
  const hardGrowthEvidenceScore = getLateTeenHardGrowthEvidenceScore(userData);
  const protectedPubertyAdjustmentCmBeforeV4Fallback =
    (residualModelVersion === "v3" || residualModelVersion === "v4") &&
    shouldApplyResidualModel(ageYears) &&
    shouldProtectHardGrowthEvidenceFloor({
      ageYears,
      sex: userData.sex,
      hardGrowthEvidenceScore,
    })
      ? (() => {
          const noHardEvidenceUserData: UserData = {
            ...userData,
            measuredGrowthVelocityCmPerYear: undefined,
            longitudinalGrowthSummary: undefined,
          };
          const noHardEvidenceAdjustmentCm =
            residualModelVersion === "v4"
              ? (() => {
                  const noHardEvidenceInputBuild =
                    buildProjectionResidualInputV4FromUserData({
                      userData: noHardEvidenceUserData,
                      dataset: options.dataset,
                      baselineProjection,
                    });
                  const noHardEvidenceResidual = evaluateProjectionResidualModelV4(
                    noHardEvidenceInputBuild.projectionResidualInput,
                    options.residualModel as ProjectionResidualModelSourceV4 | undefined
                  );

                  return applyLateTeenPositiveResidualGuardrail({
                    ageYears,
                    adjustmentCm: noHardEvidenceResidual.adjustmentCm,
                    userData: noHardEvidenceUserData,
                    pubertyEstimate: noHardEvidenceInputBuild.pubertyEstimate,
                  });
                })()
              : (() => {
                  const noHardEvidenceInputBuild =
                    buildProjectionResidualInputV3FromUserData({
                      userData: noHardEvidenceUserData,
                      dataset: options.dataset,
                      baselineProjection,
                    });
                  const noHardEvidenceResidual = evaluateProjectionResidualModelV3(
                    noHardEvidenceInputBuild.projectionResidualInput,
                    options.residualModel as ProjectionResidualModelSourceV3 | undefined
                  );

                  return applyLateTeenPositiveResidualGuardrail({
                    ageYears,
                    adjustmentCm: noHardEvidenceResidual.adjustmentCm,
                    userData: noHardEvidenceUserData,
                    pubertyEstimate: noHardEvidenceInputBuild.pubertyEstimate,
                  });
                })();

          return Math.max(pubertyAdjustmentCm, noHardEvidenceAdjustmentCm);
        })()
      : pubertyAdjustmentCm;
  const v4LateTeenFallbackBlendWeight = getV4MaleLateTeenFallbackBlendWeight({
    residualModelVersion,
    sex: userData.sex,
    ageYears,
    hasCustomResidualModel:
      residualModelVersion === "v4" &&
      options.residualModel != null &&
      isSingleProjectionResidualModelV4(options.residualModel) &&
      !isProjectionResidualModelSetV4(
        options.residualModel as ProjectionResidualModelSourceV4
      ),
  });
  const protectedPubertyAdjustmentCm =
    v4LateTeenFallbackBlendWeight > 0
      ? (() => {
          const v2FallbackInputBuild = buildProjectionResidualInputV2FromUserData({
            userData,
            dataset: options.dataset,
            baselineProjection,
          });
          const v2FallbackResidual = shouldApplyResidualModel(ageYears)
            ? evaluateProjectionResidualModelV2(v2FallbackInputBuild.projectionResidualInput)
            : {
                modelId: LOCAL_PROJECTION_MODEL_ID_V2,
                adjustmentCm: 0,
              };
          effectiveProjectionModelId = v2FallbackResidual.modelId;
          const v2FallbackAdjustmentCm = applyLateTeenPositiveResidualGuardrail({
            ageYears,
            adjustmentCm: v2FallbackResidual.adjustmentCm,
            userData,
            pubertyEstimate: v2FallbackInputBuild.pubertyEstimate,
          });
          return (
            protectedPubertyAdjustmentCmBeforeV4Fallback *
              (1 - v4LateTeenFallbackBlendWeight) +
            v2FallbackAdjustmentCm * v4LateTeenFallbackBlendWeight
          );
        })()
      : protectedPubertyAdjustmentCmBeforeV4Fallback;
  const pubertyAdjustmentInches = HeightConverter.cmToInches(
    protectedPubertyAdjustmentCm
  );
  const rawProjectedAdultHeightCm = projectedAdultHeightCm;

  const effectiveBaselineAdultHeightCm = Number.isFinite(rawProjectedAdultHeightCm)
    ? Math.max(userData.heightCm, rawProjectedAdultHeightCm as number)
    : undefined;
  const resolvedAdultHeightInches = Number.isFinite(effectiveBaselineAdultHeightCm)
    ? HeightConverter.cmToInches(effectiveBaselineAdultHeightCm as number)
    : undefined;

  let baseHeightInches = currentHeightInches;
  if (resolvedAdultHeightInches !== undefined) {
    baseHeightInches = resolvedAdultHeightInches;
  }
  baseHeightInches = Math.max(
    baseHeightInches + pubertyAdjustmentInches,
    currentHeightInches
  );

  const potentialPolicy = getPotentialPolicy({
    ageYears,
    userData,
    pubertyEstimate,
  });
  const potentialHeightInches = Math.min(
    baseHeightInches + potentialPolicy.extraInches,
    currentHeightInches + potentialPolicy.totalUpsideCapInches
  );

  const clampedPotentialHeightInches = Math.max(
    potentialHeightInches,
    currentHeightInches
  );
  const actualHeightInches = Math.max(
    clampedPotentialHeightInches - 1,
    currentHeightInches
  );

  const datasetMaxMonths = percentileSummary.datasetRange.max;
  const growthComplete =
    datasetMaxMonths > 0
      ? Math.round(
          (Math.min(ageMonthsRaw, datasetMaxMonths) / datasetMaxMonths) * 100
        )
      : undefined;
  const adjustedProjectedAdultHeightCm = Number.isFinite(rawProjectedAdultHeightCm)
    ? Math.max(
        userData.heightCm,
        (effectiveBaselineAdultHeightCm as number) + protectedPubertyAdjustmentCm
      )
    : undefined;

  return {
    current: currentMeasurement,
    actual: createHeightMeasurementFromInches(actualHeightInches),
    potential: createHeightMeasurementFromInches(clampedPotentialHeightInches),
    percentileRank: percentileSummary.percentile,
    percentileSummary,
    growthComplete,
    dataset: percentileSummary.dataset,
    datasetLabel: percentileSummary.datasetLabel,
    projectedAdultHeightCm: adjustedProjectedAdultHeightCm,
    ageMonthsUsed: percentileSummary.ageMonths,
    percentileZScore: percentileSummary.zScore,
    residualAdjustmentCm: protectedPubertyAdjustmentCm,
    pubertyAdjustmentCm: protectedPubertyAdjustmentCm,
    pubertyConfidence: pubertyEncoding?.confidence ?? pubertyEstimate?.confidence,
    projectionModelId: effectiveProjectionModelId,
  };
}

export function compareHeights(height1: string, height2: string): string {
  const [feet1, inches1] = height1.split("'").map((v) => parseFloat(v));
  const [feet2, inches2] = height2.split("'").map((v) => parseFloat(v));

  const totalInches1 = feet1 * 12 + inches1;
  const totalInches2 = feet2 * 12 + inches2;

  return totalInches1 >= totalInches2 ? height1 : height2;
}
