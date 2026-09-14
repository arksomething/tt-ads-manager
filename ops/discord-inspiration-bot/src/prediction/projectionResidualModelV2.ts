import { GENERATED_ADD_HEALTH_PROJECTION_RESIDUAL_MODEL_SET_V2 } from "./generated/projectionResidualModel.addHealth.v2";
import { calculateMidParentalHeightCm } from "./midParentalHeight";
import {
    getPubertyGrowthSignal,
    type PubertyAnswers,
    type PubertySexCode,
    type PubertyTiming,
} from "./pubertyModel";

type ProjectionSexCode = PubertySexCode;
type ProjectionTiming = PubertyTiming;
type ProjectionPubertyAnswers = PubertyAnswers;

export const LOCAL_PROJECTION_MODEL_INPUT_VERSION_V2 =
  "gotall_projection_model_input_v2" as const;
export const LOCAL_PROJECTION_FEATURE_VERSION_V2 =
  "gotall_projection_residual_features_v2" as const;
export const LOCAL_PROJECTION_MODEL_ID_V2 =
  "gotall_projection_residual_linear_v2" as const;
export const LOCAL_PROJECTION_MODEL_SET_VERSION_V2 =
  "gotall_projection_residual_model_set_v2" as const;
const MAX_SAFE_MODEL_MAGNITUDE = 100;

export type ProjectionResidualFeatureKeyV2 =
  | "heightZScore"
  | "lateTeenShortfallZScore"
  | "midParentalHeightOffsetDm"
  | "weightKgCentered"
  | "sleepHoursCentered"
  | "exerciseHoursCentered"
  | "measuredGrowthVelocityDeviationScaled"
  | "pubertyStageGapScaled"
  | "pubertyGrowthSignalScaled"
  | "pubertyTimingEarlyScaled"
  | "pubertyTimingLateScaled"
  | "femaleMenarcheRegularScaled"
  | "maleLateMarkerScaled";

export const PROJECTION_RESIDUAL_FEATURE_ORDER_V2: ProjectionResidualFeatureKeyV2[] =
  [
    "heightZScore",
    "lateTeenShortfallZScore",
    "midParentalHeightOffsetDm",
    "weightKgCentered",
    "sleepHoursCentered",
    "exerciseHoursCentered",
    "measuredGrowthVelocityDeviationScaled",
    "pubertyStageGapScaled",
    "pubertyGrowthSignalScaled",
    "pubertyTimingEarlyScaled",
    "pubertyTimingLateScaled",
    "femaleMenarcheRegularScaled",
    "maleLateMarkerScaled",
  ];

export interface LocalProjectionModelInputV2 {
  version: typeof LOCAL_PROJECTION_MODEL_INPUT_VERSION_V2;
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
  pubertyAnswers?: ProjectionPubertyAnswers;
  pubertyObservedStage?: number | null;
  pubertyExpectedStage?: number;
  pubertyTiming?: ProjectionTiming;
  pubertyConfidence?: number;
}

export interface ProjectionResidualFeatureVectorV2 {
  version: typeof LOCAL_PROJECTION_FEATURE_VERSION_V2;
  inputVersion: typeof LOCAL_PROJECTION_MODEL_INPUT_VERSION_V2;
  raw: {
    ageYears: number;
    sex: ProjectionSexCode;
    stageGap: number;
    growthSignal: number;
    ageWindowFactor: number;
    olderAgeScale: number;
    heightZScoreAgeScale: number;
    lateTeenShortfallScale: number;
    pubertyConfidence: number;
    pubertyTiming: ProjectionTiming;
    measuredGrowthVelocityCmPerYear: number | null;
    expectedGrowthVelocityCmPerYear: number;
  };
  features: Record<ProjectionResidualFeatureKeyV2, number>;
}

export interface ProjectionResidualLinearModelV2 {
  modelId: typeof LOCAL_PROJECTION_MODEL_ID_V2;
  inputVersion: typeof LOCAL_PROJECTION_MODEL_INPUT_VERSION_V2;
  featureVersion: typeof LOCAL_PROJECTION_FEATURE_VERSION_V2;
  target: "potential_height_adjustment_cm";
  interceptCm: number;
  clampCm: { min: number; max: number };
  coefficientsCmByFeature: Record<ProjectionResidualFeatureKeyV2, number>;
  notes: string[];
}

export interface ProjectionResidualModelSetV2 {
  version: typeof LOCAL_PROJECTION_MODEL_SET_VERSION_V2;
  male: ProjectionResidualLinearModelV2;
  female: ProjectionResidualLinearModelV2;
  notes: string[];
}

export type ProjectionResidualModelSourceV2 =
  | ProjectionResidualLinearModelV2
  | ProjectionResidualModelSetV2;

export interface ProjectionResidualEvaluationV2 {
  modelId: ProjectionResidualLinearModelV2["modelId"];
  adjustmentCm: number;
  featureVector: ProjectionResidualFeatureVectorV2;
}

export const DEFAULT_PROJECTION_RESIDUAL_LINEAR_MODEL_V2: ProjectionResidualLinearModelV2 =
  {
    modelId: LOCAL_PROJECTION_MODEL_ID_V2,
    inputVersion: LOCAL_PROJECTION_MODEL_INPUT_VERSION_V2,
    featureVersion: LOCAL_PROJECTION_FEATURE_VERSION_V2,
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
      measuredGrowthVelocityDeviationScaled: 0,
      pubertyStageGapScaled: 1.35,
      pubertyGrowthSignalScaled: 1,
      pubertyTimingEarlyScaled: -0.25,
      pubertyTimingLateScaled: 0.25,
      femaleMenarcheRegularScaled: -0.6,
      maleLateMarkerScaled: -0.45,
    },
    notes: [
      "Default coefficients preserve the previous puberty-sensitive fallback behavior.",
      "Replace this object with exported offline-trained coefficients once the v2 cohort pipeline is ready.",
    ],
  };

export const ACTIVE_PROJECTION_RESIDUAL_MODEL_SOURCE_V2: ProjectionResidualModelSourceV2 =
  GENERATED_ADD_HEALTH_PROJECTION_RESIDUAL_MODEL_SET_V2;

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

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function interpolateCurve(
  ageYears: number,
  points: readonly (readonly [number, number])[]
): number {
  if (ageYears <= points[0][0]) return points[0][1];
  for (let i = 0; i < points.length - 1; i += 1) {
    const [ageA, valueA] = points[i];
    const [ageB, valueB] = points[i + 1];
    if (ageYears <= ageB) {
      const t = (ageYears - ageA) / (ageB - ageA);
      return valueA + (valueB - valueA) * t;
    }
  }
  return points[points.length - 1][1];
}

function assertSupportedInputVersion(
  version: LocalProjectionModelInputV2["version"]
): void {
  if (version !== LOCAL_PROJECTION_MODEL_INPUT_VERSION_V2) {
    throw new Error(
      `[projectionResidualModelV2] Unsupported input version: ${String(version)}`
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
  clampRange: ProjectionResidualLinearModelV2["clampCm"] | undefined
): ProjectionResidualLinearModelV2["clampCm"] {
  const fallback = DEFAULT_PROJECTION_RESIDUAL_LINEAR_MODEL_V2.clampCm;
  const min = sanitizeFinite(clampRange?.min, fallback.min);
  const max = sanitizeFinite(clampRange?.max, fallback.max);
  return min < max ? { min, max } : fallback;
}

export function sanitizeProjectionResidualModelV2(
  model: ProjectionResidualLinearModelV2 | null | undefined
): ProjectionResidualLinearModelV2 {
  if (!model) {
    return DEFAULT_PROJECTION_RESIDUAL_LINEAR_MODEL_V2;
  }

  if (
    model.modelId !== LOCAL_PROJECTION_MODEL_ID_V2 ||
    model.inputVersion !== LOCAL_PROJECTION_MODEL_INPUT_VERSION_V2 ||
    model.featureVersion !== LOCAL_PROJECTION_FEATURE_VERSION_V2 ||
    model.target !== "potential_height_adjustment_cm"
  ) {
    return DEFAULT_PROJECTION_RESIDUAL_LINEAR_MODEL_V2;
  }

  const coefficientsCmByFeature: Record<ProjectionResidualFeatureKeyV2, number> =
    {
      ...DEFAULT_PROJECTION_RESIDUAL_LINEAR_MODEL_V2.coefficientsCmByFeature,
    };
  for (const featureKey of PROJECTION_RESIDUAL_FEATURE_ORDER_V2) {
    coefficientsCmByFeature[featureKey] = sanitizeFiniteMagnitude(
      model.coefficientsCmByFeature?.[featureKey],
      DEFAULT_PROJECTION_RESIDUAL_LINEAR_MODEL_V2.coefficientsCmByFeature[
        featureKey
      ]
    );
  }

  return {
    modelId: LOCAL_PROJECTION_MODEL_ID_V2,
    inputVersion: LOCAL_PROJECTION_MODEL_INPUT_VERSION_V2,
    featureVersion: LOCAL_PROJECTION_FEATURE_VERSION_V2,
    target: "potential_height_adjustment_cm",
    interceptCm: sanitizeFiniteMagnitude(
      model.interceptCm,
      DEFAULT_PROJECTION_RESIDUAL_LINEAR_MODEL_V2.interceptCm
    ),
    clampCm: sanitizeClampRange(model.clampCm),
    coefficientsCmByFeature,
    notes:
      Array.isArray(model.notes) && model.notes.every((note) => typeof note === "string")
        ? model.notes
        : DEFAULT_PROJECTION_RESIDUAL_LINEAR_MODEL_V2.notes,
  };
}

export function isProjectionResidualModelSetV2(
  model: unknown
): model is ProjectionResidualModelSetV2 {
  return (
    typeof model === "object" &&
    model != null &&
    (model as ProjectionResidualModelSetV2).version ===
      LOCAL_PROJECTION_MODEL_SET_VERSION_V2 &&
    typeof (model as ProjectionResidualModelSetV2).male === "object" &&
    typeof (model as ProjectionResidualModelSetV2).female === "object"
  );
}

export function selectProjectionResidualModelForSexV2(
  sex: ProjectionSexCode,
  model: ProjectionResidualModelSourceV2 | null | undefined
): ProjectionResidualLinearModelV2 | undefined {
  if (!model) return undefined;
  if (isProjectionResidualModelSetV2(model)) {
    return sex === "1" ? model.male : model.female;
  }
  return model;
}

export function resolveProjectionResidualModelForSexV2(
  sex: ProjectionSexCode,
  model: ProjectionResidualModelSourceV2 | null | undefined = ACTIVE_PROJECTION_RESIDUAL_MODEL_SOURCE_V2
): ProjectionResidualLinearModelV2 {
  return sanitizeProjectionResidualModelV2(
    selectProjectionResidualModelForSexV2(sex, model)
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

function getGrowthSignal(
  answers: LocalProjectionModelInputV2["pubertyAnswers"]
): number {
  return answers ? getPubertyGrowthSignal(answers) : 0;
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

export function createLocalProjectionModelInputV2(
  params: Omit<LocalProjectionModelInputV2, "version">
): LocalProjectionModelInputV2 {
  return {
    version: LOCAL_PROJECTION_MODEL_INPUT_VERSION_V2,
    ...params,
  };
}

export function buildProjectionResidualFeatureVectorV2(
  input: LocalProjectionModelInputV2
): ProjectionResidualFeatureVectorV2 {
  assertSupportedInputVersion(input.version);

  const ageYears = Number.isFinite(input.ageYears) ? input.ageYears : 0;
  const stageGap = clamp(
    (input.pubertyExpectedStage ?? 0) - (input.pubertyObservedStage ?? 0),
    -2,
    2
  );
  const pubertyConfidence = clamp(input.pubertyConfidence ?? 0, 0, 1);
  const ageWindowFactor = getTimingAgeWindowFactor(ageYears, input.sex);
  const olderAgeScale = getOlderAgeScale(ageYears, input.sex);
  const heightZScoreAgeScale = getHeightZScoreAgeScale(ageYears, input.sex);
  const lateTeenShortfallScale = getLateTeenShortfallScale(
    ageYears,
    input.sex
  );
  const growthSignal = getGrowthSignal(input.pubertyAnswers);
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
  const measuredGrowthVelocityCmPerYear = Number.isFinite(
    input.measuredGrowthVelocityCmPerYear
  )
    ? (input.measuredGrowthVelocityCmPerYear as number)
    : null;
  const measuredGrowthVelocityDeviationScaled =
    measuredGrowthVelocityCmPerYear == null
      ? 0
      : clamp(
          (measuredGrowthVelocityCmPerYear - expectedGrowthVelocityCmPerYear) /
            4,
          -2.5,
          2.5
        ) *
        ageWindowFactor *
        olderAgeScale;
  const percentileZScore = Number.isFinite(input.percentileZScore)
    ? input.percentileZScore
    : 0;

  const features: Record<ProjectionResidualFeatureKeyV2, number> = {
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
    measuredGrowthVelocityDeviationScaled,
    pubertyStageGapScaled:
      stageGap * pubertyConfidence * ageWindowFactor * olderAgeScale,
    pubertyGrowthSignalScaled:
      growthSignal * pubertyConfidence * ageWindowFactor * olderAgeScale,
    pubertyTimingEarlyScaled:
      input.pubertyTiming === "early"
        ? pubertyConfidence * olderAgeScale
        : 0,
    pubertyTimingLateScaled:
      input.pubertyTiming === "late"
        ? pubertyConfidence * olderAgeScale
        : 0,
    femaleMenarcheRegularScaled:
      input.sex === "2" &&
      input.pubertyAnswers?.puberty_periodStart === "2y" &&
      input.pubertyAnswers?.puberty_periodRegular === "yes"
        ? pubertyConfidence * olderAgeScale
        : 0,
    maleLateMarkerScaled:
      input.sex === "1" &&
      input.pubertyAnswers?.puberty_voiceDepth === "full" &&
      input.pubertyAnswers?.puberty_facialHair === "regular"
        ? pubertyConfidence * olderAgeScale
        : 0,
  };

  return {
    version: LOCAL_PROJECTION_FEATURE_VERSION_V2,
    inputVersion: LOCAL_PROJECTION_MODEL_INPUT_VERSION_V2,
    raw: {
      ageYears,
      sex: input.sex,
      stageGap,
      growthSignal,
      ageWindowFactor,
      olderAgeScale,
      heightZScoreAgeScale,
      lateTeenShortfallScale,
      pubertyConfidence,
      pubertyTiming: input.pubertyTiming ?? "unknown",
      measuredGrowthVelocityCmPerYear,
      expectedGrowthVelocityCmPerYear,
    },
    features,
  };
}

export function evaluateProjectionResidualModelV2(
  input: LocalProjectionModelInputV2,
  model: ProjectionResidualModelSourceV2 | null | undefined = ACTIVE_PROJECTION_RESIDUAL_MODEL_SOURCE_V2
): ProjectionResidualEvaluationV2 {
  const safeModel = resolveProjectionResidualModelForSexV2(input.sex, model);
  const featureVector = buildProjectionResidualFeatureVectorV2(input);

  let total = safeModel.interceptCm;
  for (const featureKey of PROJECTION_RESIDUAL_FEATURE_ORDER_V2) {
    const featureValue = featureVector.features[featureKey] ?? 0;
    const coefficient = safeModel.coefficientsCmByFeature[featureKey] ?? 0;
    total += featureValue * coefficient;
  }
  if (!Number.isFinite(total)) {
    total = DEFAULT_PROJECTION_RESIDUAL_LINEAR_MODEL_V2.interceptCm;
  }

  return {
    modelId: safeModel.modelId,
    adjustmentCm: clamp(total, safeModel.clampCm.min, safeModel.clampCm.max),
    featureVector,
  };
}
