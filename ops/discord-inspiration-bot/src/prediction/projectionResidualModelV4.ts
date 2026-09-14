import { GENERATED_PUBERTY_ENCODER_PROJECTION_RESIDUAL_MODEL_SET_V4 } from "./generated/projectionResidualModel.pubertyEncoder.v4";
import {
  LONGITUDINAL_GROWTH_SUMMARY_VERSION,
  type LongitudinalGrowthSummary,
} from "./longitudinalGrowthSummary";
import { calculateMidParentalHeightCm } from "./midParentalHeight";
import {
  CANONICAL_PUBERTY_ENCODER_OUTPUT_VERSION_V1,
  type CanonicalPubertyEncodingV1,
  type PubertySexCode,
} from "./pubertyEncoder";

type ProjectionSexCode = PubertySexCode;

export const LOCAL_PROJECTION_MODEL_INPUT_VERSION_V4 =
  "gotall_projection_model_input_v4" as const;
export const LOCAL_PROJECTION_FEATURE_VERSION_V4 =
  "gotall_projection_residual_features_v4" as const;
export const LOCAL_PROJECTION_MODEL_ID_V4 =
  "gotall_projection_residual_linear_v4" as const;
export const LOCAL_PROJECTION_MODEL_SET_VERSION_V4 =
  "gotall_projection_residual_model_set_v4" as const;
const MAX_SAFE_MODEL_MAGNITUDE = 100;

export type ProjectionResidualFeatureKeyV4 =
  | "heightZScore"
  | "lateTeenShortfallZScore"
  | "midParentalHeightOffsetDm"
  | "weightKgCentered"
  | "sleepHoursCentered"
  | "exerciseHoursCentered"
  | "longitudinalRecentVelocityDeviationScaled"
  | "longitudinalPriorVelocityDeviationScaled"
  | "longitudinalVelocityDeltaScaled"
  | "longitudinalWindowSpanScaled"
  | "longitudinalMeasurementCountScaled"
  | "longitudinalFitErrorScaled"
  | "longitudinalSparseQualityFlagScaled"
  | "pubertyMaturityScoreScaled"
  | "pubertyMaturityResidualForAgeScaled"
  | "pubertyConfidenceScaled"
  | "pubertyResidualConfidenceInteractionScaled";

export const PROJECTION_RESIDUAL_FEATURE_ORDER_V4: ProjectionResidualFeatureKeyV4[] =
  [
    "heightZScore",
    "lateTeenShortfallZScore",
    "midParentalHeightOffsetDm",
    "weightKgCentered",
    "sleepHoursCentered",
    "exerciseHoursCentered",
    "longitudinalRecentVelocityDeviationScaled",
    "longitudinalPriorVelocityDeviationScaled",
    "longitudinalVelocityDeltaScaled",
    "longitudinalWindowSpanScaled",
    "longitudinalMeasurementCountScaled",
    "longitudinalFitErrorScaled",
    "longitudinalSparseQualityFlagScaled",
    "pubertyMaturityScoreScaled",
    "pubertyMaturityResidualForAgeScaled",
    "pubertyConfidenceScaled",
    "pubertyResidualConfidenceInteractionScaled",
  ];

export interface LocalProjectionModelInputV4 {
  version: typeof LOCAL_PROJECTION_MODEL_INPUT_VERSION_V4;
  ageYears: number;
  sex: ProjectionSexCode;
  heightCm: number;
  percentile: number;
  percentileZScore: number;
  motherHeightCm?: number;
  fatherHeightCm?: number;
  weightKg?: number;
  sleepHoursPerNight?: number;
  exerciseHoursPerWeek?: number;
  measuredGrowthVelocityCmPerYear?: number;
  longitudinalGrowthSummary?: LongitudinalGrowthSummary;
  pubertyEncoding?: CanonicalPubertyEncodingV1 | null;
}

export interface ProjectionResidualFeatureVectorV4 {
  version: typeof LOCAL_PROJECTION_FEATURE_VERSION_V4;
  inputVersion: typeof LOCAL_PROJECTION_MODEL_INPUT_VERSION_V4;
  raw: {
    ageYears: number;
    sex: ProjectionSexCode;
    ageWindowFactor: number;
    olderAgeScale: number;
    heightZScoreAgeScale: number;
    lateTeenShortfallScale: number;
    recentVelocityCmPerYear: number | null;
    priorVelocityCmPerYear: number | null;
    velocityDeltaCmPerYear: number;
    windowSpanDays: number;
    measurementCount: number;
    fitErrorCm: number;
    sparseMeasurementQualityFlag: 0 | 1;
    expectedGrowthVelocityCmPerYear: number;
    pubertyMaturityScore: number;
    pubertyMaturityResidualForAge: number;
    pubertyConfidence: number;
  };
  features: Record<ProjectionResidualFeatureKeyV4, number>;
}

export interface ProjectionResidualLinearModelV4 {
  modelId: typeof LOCAL_PROJECTION_MODEL_ID_V4;
  inputVersion: typeof LOCAL_PROJECTION_MODEL_INPUT_VERSION_V4;
  featureVersion: typeof LOCAL_PROJECTION_FEATURE_VERSION_V4;
  target: "potential_height_adjustment_cm";
  interceptCm: number;
  clampCm: { min: number; max: number };
  coefficientsCmByFeature: Record<ProjectionResidualFeatureKeyV4, number>;
  notes: string[];
}

export interface ProjectionResidualModelSetV4 {
  version: typeof LOCAL_PROJECTION_MODEL_SET_VERSION_V4;
  male: ProjectionResidualLinearModelV4;
  female: ProjectionResidualLinearModelV4;
  notes: string[];
}

export type ProjectionResidualModelSourceV4 =
  | ProjectionResidualLinearModelV4
  | ProjectionResidualModelSetV4;

export interface ProjectionResidualEvaluationV4 {
  modelId: ProjectionResidualLinearModelV4["modelId"];
  adjustmentCm: number;
  featureVector: ProjectionResidualFeatureVectorV4;
}

const MALE_EXPECTED_GROWTH_VELOCITY_CURVE = [
  [8, 5.8],
  [10, 5.3],
  [11, 5.9],
  [12, 7.2],
  [13, 8.8],
  [14, 7.8],
  [15, 5.2],
  [16, 3],
  [17, 1.4],
  [18, 0.5],
] as const;

const FEMALE_EXPECTED_GROWTH_VELOCITY_CURVE = [
  [7, 5.7],
  [9, 6.6],
  [10, 7.6],
  [11, 8.2],
  [12, 6.8],
  [13, 3.9],
  [14, 1.9],
  [15, 0.8],
  [16, 0.3],
] as const;

export const DEFAULT_PROJECTION_RESIDUAL_LINEAR_MODEL_V4: ProjectionResidualLinearModelV4 =
  {
    modelId: LOCAL_PROJECTION_MODEL_ID_V4,
    inputVersion: LOCAL_PROJECTION_MODEL_INPUT_VERSION_V4,
    featureVersion: LOCAL_PROJECTION_FEATURE_VERSION_V4,
    target: "potential_height_adjustment_cm",
    interceptCm: 0,
    clampCm: { min: -3.5, max: 3.5 },
    coefficientsCmByFeature: {
      heightZScore: 0,
      lateTeenShortfallZScore: 0,
      midParentalHeightOffsetDm: 0,
      weightKgCentered: 0,
      sleepHoursCentered: 0,
      exerciseHoursCentered: 0,
      longitudinalRecentVelocityDeviationScaled: 0,
      longitudinalPriorVelocityDeviationScaled: 0,
      longitudinalVelocityDeltaScaled: 0,
      longitudinalWindowSpanScaled: 0,
      longitudinalMeasurementCountScaled: 0,
      longitudinalFitErrorScaled: 0,
      longitudinalSparseQualityFlagScaled: 0,
      pubertyMaturityScoreScaled: 0.6,
      pubertyMaturityResidualForAgeScaled: 1.1,
      pubertyConfidenceScaled: 0.1,
      pubertyResidualConfidenceInteractionScaled: 0.8,
    },
    notes: [
      "Default coefficients preserve a conservative frozen-encoder fallback behavior.",
      "Replace this object with exported offline-trained coefficients once the puberty-encoder v4 cohort pipeline is ready.",
    ],
  };

export const ACTIVE_PROJECTION_RESIDUAL_MODEL_SOURCE_V4: ProjectionResidualModelSourceV4 =
  GENERATED_PUBERTY_ENCODER_PROJECTION_RESIDUAL_MODEL_SET_V4;

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function interpolateCurve(
  ageYears: number,
  points: readonly (readonly [number, number])[]
): number {
  if (ageYears <= points[0][0]) return points[0][1];
  for (let index = 0; index < points.length - 1; index += 1) {
    const [ageA, valueA] = points[index];
    const [ageB, valueB] = points[index + 1];
    if (ageYears <= ageB) {
      const t = (ageYears - ageA) / (ageB - ageA);
      return valueA + (valueB - valueA) * t;
    }
  }
  return points[points.length - 1][1];
}

function assertSupportedInputVersion(
  version: LocalProjectionModelInputV4["version"]
): void {
  if (version !== LOCAL_PROJECTION_MODEL_INPUT_VERSION_V4) {
    throw new Error(
      `[projectionResidualModelV4] Unsupported input version: ${String(version)}`
    );
  }
}

function sanitizeFinite(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function sanitizeFiniteMagnitude(
  value: unknown,
  fallback: number,
  maxAbs: number = MAX_SAFE_MODEL_MAGNITUDE
): number {
  const safeValue = sanitizeFinite(value, fallback);
  return Math.abs(safeValue) <= maxAbs ? safeValue : fallback;
}

function sanitizeClampRange(
  clampRange: ProjectionResidualLinearModelV4["clampCm"] | undefined
): ProjectionResidualLinearModelV4["clampCm"] {
  const fallback = DEFAULT_PROJECTION_RESIDUAL_LINEAR_MODEL_V4.clampCm;
  const min = sanitizeFinite(clampRange?.min, fallback.min);
  const max = sanitizeFinite(clampRange?.max, fallback.max);
  return min < max ? { min, max } : fallback;
}

function isCanonicalPubertyEncodingV1(
  value: unknown
): value is CanonicalPubertyEncodingV1 {
  return (
    typeof value === "object" &&
    value != null &&
    (value as CanonicalPubertyEncodingV1).version ===
      CANONICAL_PUBERTY_ENCODER_OUTPUT_VERSION_V1
  );
}

function getTimingAgeWindowFactor(
  ageYears: number,
  sex: ProjectionSexCode
): number {
  const start = sex === "1" ? 11 : 9;
  const end = sex === "1" ? 16.5 : 14.5;
  if (ageYears >= start && ageYears <= end) return 1;
  if (ageYears >= start - 1 && ageYears <= end + 1) return 0.55;
  return 0.2;
}

function getOlderAgeScale(ageYears: number, sex: ProjectionSexCode): number {
  const olderCutoff = sex === "1" ? 18.5 : 16.5;
  return ageYears >= olderCutoff ? 0.25 : 1;
}

function getHeightZScoreAgeScale(
  ageYears: number,
  sex: ProjectionSexCode
): number {
  const fadeStart = sex === "1" ? 16.5 : 14.5;
  const fadeMiddle = sex === "1" ? 17.5 : 15.5;
  const fadeEnd = sex === "1" ? 18.5 : 16.5;
  if (ageYears <= fadeStart) return 1;
  if (ageYears <= fadeMiddle) {
    return interpolateCurve(ageYears, [
      [fadeStart, 1],
      [fadeMiddle, 0.55],
    ]);
  }
  return interpolateCurve(ageYears, [
    [fadeMiddle, 0.55],
    [fadeEnd, 0.2],
  ]);
}

function getLateTeenShortfallScale(
  ageYears: number,
  sex: ProjectionSexCode
): number {
  const start = sex === "1" ? 16.5 : 14.5;
  const end = sex === "1" ? 18.5 : 16.5;
  if (ageYears <= start) return 0;
  return interpolateCurve(ageYears, [
    [start, 0],
    [end, 1],
  ]);
}

function getExpectedGrowthVelocityCmPerYear(
  ageYears: number,
  sex: ProjectionSexCode
): number {
  return interpolateCurve(
    ageYears,
    sex === "1"
      ? MALE_EXPECTED_GROWTH_VELOCITY_CURVE
      : FEMALE_EXPECTED_GROWTH_VELOCITY_CURVE
  );
}

function getValidatedLongitudinalSummary(
  summary: LongitudinalGrowthSummary | undefined
): LongitudinalGrowthSummary | undefined {
  if (
    summary?.version !== LONGITUDINAL_GROWTH_SUMMARY_VERSION ||
    !Number.isFinite(summary.windowSpanDays) ||
    !Number.isFinite(summary.measurementCount) ||
    !Number.isFinite(summary.recentVelocityCmPerYear) ||
    !Number.isFinite(summary.priorVelocityCmPerYear) ||
    !Number.isFinite(summary.velocityDeltaCmPerYear) ||
    !Number.isFinite(summary.fitErrorCm)
  ) {
    return undefined;
  }

  return summary;
}

export function sanitizeProjectionResidualModelV4(
  model: ProjectionResidualLinearModelV4 | null | undefined
): ProjectionResidualLinearModelV4 {
  if (!model) {
    return DEFAULT_PROJECTION_RESIDUAL_LINEAR_MODEL_V4;
  }

  if (
    model.modelId !== LOCAL_PROJECTION_MODEL_ID_V4 ||
    model.inputVersion !== LOCAL_PROJECTION_MODEL_INPUT_VERSION_V4 ||
    model.featureVersion !== LOCAL_PROJECTION_FEATURE_VERSION_V4 ||
    model.target !== "potential_height_adjustment_cm"
  ) {
    return DEFAULT_PROJECTION_RESIDUAL_LINEAR_MODEL_V4;
  }

  const coefficientsCmByFeature: Record<ProjectionResidualFeatureKeyV4, number> =
    {
      ...DEFAULT_PROJECTION_RESIDUAL_LINEAR_MODEL_V4.coefficientsCmByFeature,
    };
  for (const featureKey of PROJECTION_RESIDUAL_FEATURE_ORDER_V4) {
    coefficientsCmByFeature[featureKey] = sanitizeFiniteMagnitude(
      model.coefficientsCmByFeature?.[featureKey],
      DEFAULT_PROJECTION_RESIDUAL_LINEAR_MODEL_V4.coefficientsCmByFeature[
        featureKey
      ]
    );
  }

  return {
    modelId: LOCAL_PROJECTION_MODEL_ID_V4,
    inputVersion: LOCAL_PROJECTION_MODEL_INPUT_VERSION_V4,
    featureVersion: LOCAL_PROJECTION_FEATURE_VERSION_V4,
    target: "potential_height_adjustment_cm",
    interceptCm: sanitizeFiniteMagnitude(
      model.interceptCm,
      DEFAULT_PROJECTION_RESIDUAL_LINEAR_MODEL_V4.interceptCm
    ),
    clampCm: sanitizeClampRange(model.clampCm),
    coefficientsCmByFeature,
    notes:
      Array.isArray(model.notes) && model.notes.every((note) => typeof note === "string")
        ? model.notes
        : DEFAULT_PROJECTION_RESIDUAL_LINEAR_MODEL_V4.notes,
  };
}

export function isProjectionResidualModelSetV4(
  model: unknown
): model is ProjectionResidualModelSetV4 {
  return (
    typeof model === "object" &&
    model != null &&
    (model as ProjectionResidualModelSetV4).version ===
      LOCAL_PROJECTION_MODEL_SET_VERSION_V4 &&
    typeof (model as ProjectionResidualModelSetV4).male === "object" &&
    typeof (model as ProjectionResidualModelSetV4).female === "object"
  );
}

export function selectProjectionResidualModelForSexV4(
  sex: ProjectionSexCode,
  model: ProjectionResidualModelSourceV4 | null | undefined
): ProjectionResidualLinearModelV4 | undefined {
  if (!model) return undefined;
  if (isProjectionResidualModelSetV4(model)) {
    return sex === "1" ? model.male : model.female;
  }
  return model;
}

export function resolveProjectionResidualModelForSexV4(
  sex: ProjectionSexCode,
  model: ProjectionResidualModelSourceV4 | null | undefined =
    ACTIVE_PROJECTION_RESIDUAL_MODEL_SOURCE_V4
): ProjectionResidualLinearModelV4 {
  return sanitizeProjectionResidualModelV4(
    selectProjectionResidualModelForSexV4(sex, model)
  );
}

export function createLocalProjectionModelInputV4(
  params: Omit<LocalProjectionModelInputV4, "version">
): LocalProjectionModelInputV4 {
  return {
    version: LOCAL_PROJECTION_MODEL_INPUT_VERSION_V4,
    ...params,
  };
}

export function buildProjectionResidualFeatureVectorV4(
  input: LocalProjectionModelInputV4
): ProjectionResidualFeatureVectorV4 {
  assertSupportedInputVersion(input.version);

  const ageYears = Number.isFinite(input.ageYears) ? input.ageYears : 0;
  const ageWindowFactor = getTimingAgeWindowFactor(ageYears, input.sex);
  const olderAgeScale = getOlderAgeScale(ageYears, input.sex);
  const heightZScoreAgeScale = getHeightZScoreAgeScale(ageYears, input.sex);
  const lateTeenShortfallScale = getLateTeenShortfallScale(
    ageYears,
    input.sex
  );
  const midParentalHeightCm = calculateMidParentalHeightCm({
    sex: input.sex,
    motherHeightCm: input.motherHeightCm,
    fatherHeightCm: input.fatherHeightCm,
  });
  const sexAverageHeightCm = input.sex === "1" ? 175 : 162;
  const expectedGrowthVelocityCmPerYear = getExpectedGrowthVelocityCmPerYear(
    ageYears,
    input.sex
  );
  const validatedSummary = getValidatedLongitudinalSummary(
    input.longitudinalGrowthSummary
  );
  const fallbackVelocity = Number.isFinite(input.measuredGrowthVelocityCmPerYear)
    ? (input.measuredGrowthVelocityCmPerYear as number)
    : null;
  const recentVelocityCmPerYear = Number.isFinite(
    validatedSummary?.recentVelocityCmPerYear
  )
    ? (validatedSummary?.recentVelocityCmPerYear as number)
    : fallbackVelocity;
  const priorVelocityCmPerYear = Number.isFinite(
    validatedSummary?.priorVelocityCmPerYear
  )
    ? (validatedSummary?.priorVelocityCmPerYear as number)
    : recentVelocityCmPerYear;
  const velocityDeltaCmPerYear = Number.isFinite(
    validatedSummary?.velocityDeltaCmPerYear
  )
    ? (validatedSummary?.velocityDeltaCmPerYear as number)
    : recentVelocityCmPerYear != null && priorVelocityCmPerYear != null
      ? recentVelocityCmPerYear - priorVelocityCmPerYear
      : 0;
  const windowSpanDays = Number.isFinite(validatedSummary?.windowSpanDays)
    ? (validatedSummary?.windowSpanDays as number)
    : recentVelocityCmPerYear == null
      ? 0
      : 180;
  const measurementCount = Number.isFinite(validatedSummary?.measurementCount)
    ? (validatedSummary?.measurementCount as number)
    : recentVelocityCmPerYear == null
      ? 0
      : 2;
  const fitErrorCm = Number.isFinite(validatedSummary?.fitErrorCm)
    ? (validatedSummary?.fitErrorCm as number)
    : 0;
  const sparseMeasurementQualityFlag: 0 | 1 =
    validatedSummary?.sparseMeasurementQualityFlag ??
    (recentVelocityCmPerYear == null ? 0 : 1);
  const longitudinalAgeScale = ageWindowFactor * olderAgeScale;
  const longitudinalQualityScale =
    recentVelocityCmPerYear == null
      ? 0
      : sparseMeasurementQualityFlag === 1
        ? 0.55
        : 1;
  const percentileZScore = Number.isFinite(input.percentileZScore)
    ? input.percentileZScore
    : 0;
  const pubertyEncoding = isCanonicalPubertyEncodingV1(input.pubertyEncoding)
    ? input.pubertyEncoding
    : null;
  const pubertyMaturityScore = clamp(pubertyEncoding?.maturityScore ?? 3, 1, 5);
  const pubertyMaturityResidualForAge = clamp(
    pubertyEncoding?.maturityResidualForAge ?? 0,
    -4,
    4
  );
  const pubertyConfidence = clamp(pubertyEncoding?.confidence ?? 0, 0, 1);
  const pubertyAgeScale = ageWindowFactor * olderAgeScale;
  const pubertyMaturityScoreScaled =
    clamp((3 - pubertyMaturityScore) / 1.5, -2, 2) *
    pubertyAgeScale *
    pubertyConfidence;
  const pubertyMaturityResidualForAgeScaled =
    clamp(pubertyMaturityResidualForAge / 1.5, -2, 2) *
    pubertyAgeScale *
    pubertyConfidence;
  const pubertyConfidenceScaled =
    pubertyEncoding == null ? 0 : pubertyConfidence * olderAgeScale;

  const features: Record<ProjectionResidualFeatureKeyV4, number> = {
    heightZScore: percentileZScore * heightZScoreAgeScale,
    lateTeenShortfallZScore:
      Math.max(-percentileZScore, 0) * lateTeenShortfallScale,
    midParentalHeightOffsetDm:
      midParentalHeightCm == null
        ? 0
        : (midParentalHeightCm - sexAverageHeightCm) / 10,
    weightKgCentered: Number.isFinite(input.weightKg)
      ? ((input.weightKg as number) - 55) / 10
      : 0,
    sleepHoursCentered: Number.isFinite(input.sleepHoursPerNight)
      ? ((input.sleepHoursPerNight as number) - 8) / 2
      : 0,
    exerciseHoursCentered: Number.isFinite(input.exerciseHoursPerWeek)
      ? ((input.exerciseHoursPerWeek as number) - 4) / 4
      : 0,
    longitudinalRecentVelocityDeviationScaled:
      recentVelocityCmPerYear == null
        ? 0
        : clamp(
            (recentVelocityCmPerYear - expectedGrowthVelocityCmPerYear) / 4,
            -2.5,
            2.5
          ) *
          longitudinalAgeScale *
          longitudinalQualityScale,
    longitudinalPriorVelocityDeviationScaled:
      priorVelocityCmPerYear == null
        ? 0
        : clamp(
            (priorVelocityCmPerYear - expectedGrowthVelocityCmPerYear) / 4,
            -2.5,
            2.5
          ) *
          longitudinalAgeScale *
          longitudinalQualityScale,
    longitudinalVelocityDeltaScaled:
      recentVelocityCmPerYear == null || priorVelocityCmPerYear == null
        ? 0
        : clamp(velocityDeltaCmPerYear / 4, -2.5, 2.5) *
          longitudinalAgeScale *
          longitudinalQualityScale,
    longitudinalWindowSpanScaled:
      recentVelocityCmPerYear == null
        ? 0
        : clamp((windowSpanDays - 270) / 120, -2, 2) *
          longitudinalAgeScale *
          longitudinalQualityScale,
    longitudinalMeasurementCountScaled:
      recentVelocityCmPerYear == null
        ? 0
        : clamp((measurementCount - 3) / 3, -1, 2) *
          longitudinalAgeScale *
          longitudinalQualityScale,
    longitudinalFitErrorScaled:
      recentVelocityCmPerYear == null
        ? 0
        : clamp(fitErrorCm / 2, 0, 2.5) *
          longitudinalAgeScale *
          longitudinalQualityScale,
    longitudinalSparseQualityFlagScaled:
      recentVelocityCmPerYear == null
        ? 0
        : sparseMeasurementQualityFlag * longitudinalAgeScale,
    pubertyMaturityScoreScaled,
    pubertyMaturityResidualForAgeScaled,
    pubertyConfidenceScaled,
    pubertyResidualConfidenceInteractionScaled:
      pubertyMaturityResidualForAgeScaled * pubertyConfidence,
  };

  return {
    version: LOCAL_PROJECTION_FEATURE_VERSION_V4,
    inputVersion: LOCAL_PROJECTION_MODEL_INPUT_VERSION_V4,
    raw: {
      ageYears,
      sex: input.sex,
      ageWindowFactor,
      olderAgeScale,
      heightZScoreAgeScale,
      lateTeenShortfallScale,
      recentVelocityCmPerYear,
      priorVelocityCmPerYear,
      velocityDeltaCmPerYear,
      windowSpanDays,
      measurementCount,
      fitErrorCm,
      sparseMeasurementQualityFlag,
      expectedGrowthVelocityCmPerYear,
      pubertyMaturityScore,
      pubertyMaturityResidualForAge,
      pubertyConfidence,
    },
    features,
  };
}

export function evaluateProjectionResidualModelV4(
  input: LocalProjectionModelInputV4,
  model: ProjectionResidualModelSourceV4 | null | undefined =
    ACTIVE_PROJECTION_RESIDUAL_MODEL_SOURCE_V4
): ProjectionResidualEvaluationV4 {
  const safeModel = resolveProjectionResidualModelForSexV4(input.sex, model);
  const featureVector = buildProjectionResidualFeatureVectorV4(input);

  let total = safeModel.interceptCm;
  for (const featureKey of PROJECTION_RESIDUAL_FEATURE_ORDER_V4) {
    total +=
      (featureVector.features[featureKey] ?? 0) *
      (safeModel.coefficientsCmByFeature[featureKey] ?? 0);
  }
  if (!Number.isFinite(total)) {
    total = DEFAULT_PROJECTION_RESIDUAL_LINEAR_MODEL_V4.interceptCm;
  }

  return {
    modelId: safeModel.modelId,
    adjustmentCm: clamp(total, safeModel.clampCm.min, safeModel.clampCm.max),
    featureVector,
  };
}
