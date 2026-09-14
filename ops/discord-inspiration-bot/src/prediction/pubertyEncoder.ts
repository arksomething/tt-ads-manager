import { GENERATED_CANONICAL_PUBERTY_ENCODER_MODEL_V1 } from "./generated/pubertyEncoder.v1";
import type { PubertyAnswers, PubertySexCode } from "./pubertyModel";

export type { PubertySexCode } from "./pubertyModel";

export const CANONICAL_PUBERTY_ENCODER_INPUT_VERSION_V1 =
  "gotall_puberty_encoder_input_v1" as const;
export const CANONICAL_PUBERTY_ENCODER_OUTPUT_VERSION_V1 =
  "gotall_puberty_encoder_output_v1" as const;
export const CANONICAL_PUBERTY_ENCODER_MODEL_VERSION_V1 =
  "gotall_puberty_encoder_model_v1" as const;
export const CANONICAL_PUBERTY_ENCODER_FEATURE_VERSION_V1 =
  "gotall_puberty_encoder_features_v1" as const;

export interface RawPubertySignalsV1 {
  bodyHairStage?: number;
  facialHairStage?: number;
  voiceChangeStage?: number;
  skinChangesStage?: number;
  menarcheStarted?: boolean;
  menarcheYearsAgo?: number;
}

export interface CanonicalPubertyEncoderInputV1 extends RawPubertySignalsV1 {
  version: typeof CANONICAL_PUBERTY_ENCODER_INPUT_VERSION_V1;
  sex: PubertySexCode;
  ageYears: number;
}

export interface CanonicalPubertyEncodingV1 {
  version: typeof CANONICAL_PUBERTY_ENCODER_OUTPUT_VERSION_V1;
  maturityScore: number;
  maturityResidualForAge: number;
  confidence: number;
  coverage: number;
}

export interface PubertyEncoderCalibrationPointV1 {
  ageYears: number;
  expectedMaturityScore: number;
}

export type CanonicalPubertyEncoderFeatureKeyV1 =
  | "bodyHairStageCentered"
  | "bodyHairPresent"
  | "facialHairStageCentered"
  | "facialHairPresent"
  | "voiceChangeStageCentered"
  | "voiceChangePresent"
  | "skinChangesStageCentered"
  | "skinChangesPresent"
  | "menarcheStartedValue"
  | "menarcheStartedPresent"
  | "menarcheYearsAgoCentered"
  | "menarcheYearsAgoPresent";

export const CANONICAL_PUBERTY_ENCODER_FEATURE_ORDER_V1: CanonicalPubertyEncoderFeatureKeyV1[] =
  [
    "bodyHairStageCentered",
    "bodyHairPresent",
    "facialHairStageCentered",
    "facialHairPresent",
    "voiceChangeStageCentered",
    "voiceChangePresent",
    "skinChangesStageCentered",
    "skinChangesPresent",
    "menarcheStartedValue",
    "menarcheStartedPresent",
    "menarcheYearsAgoCentered",
    "menarcheYearsAgoPresent",
  ];

export interface CanonicalPubertyEncoderLinearModelV1 {
  intercept: number;
  coefficientsByFeature: Record<CanonicalPubertyEncoderFeatureKeyV1, number>;
}

export interface CanonicalPubertyEncoderModelSourceV1 {
  version: typeof CANONICAL_PUBERTY_ENCODER_MODEL_VERSION_V1;
  inputVersion: typeof CANONICAL_PUBERTY_ENCODER_INPUT_VERSION_V1;
  outputVersion: typeof CANONICAL_PUBERTY_ENCODER_OUTPUT_VERSION_V1;
  featureVersion: typeof CANONICAL_PUBERTY_ENCODER_FEATURE_VERSION_V1;
  target: "tanner_like_maturity_score";
  male: CanonicalPubertyEncoderLinearModelV1;
  female: CanonicalPubertyEncoderLinearModelV1;
  maleCalibrationCurve: PubertyEncoderCalibrationPointV1[];
  femaleCalibrationCurve: PubertyEncoderCalibrationPointV1[];
  notes: string[];
}

export interface CanonicalPubertyEncoderFeatureVectorV1 {
  version: typeof CANONICAL_PUBERTY_ENCODER_FEATURE_VERSION_V1;
  inputVersion: typeof CANONICAL_PUBERTY_ENCODER_INPUT_VERSION_V1;
  raw: {
    ageYears: number;
    sex: PubertySexCode;
    bodyHairStage: number | null;
    facialHairStage: number | null;
    voiceChangeStage: number | null;
    skinChangesStage: number | null;
    menarcheStarted: boolean | null;
    menarcheYearsAgo: number | null;
    observedStageSignals: number[];
    coverage: number;
    confidence: number;
  };
  features: Record<CanonicalPubertyEncoderFeatureKeyV1, number>;
}

export type PubertyEncoderTimingBucket =
  | "early"
  | "typical"
  | "late"
  | "unknown";

const MAX_SAFE_MODEL_MAGNITUDE = 100;
const DEFAULT_MALE_CALIBRATION_CURVE: PubertyEncoderCalibrationPointV1[] = [
  { ageYears: 10, expectedMaturityScore: 1.2 },
  { ageYears: 11, expectedMaturityScore: 1.6 },
  { ageYears: 12, expectedMaturityScore: 2.0 },
  { ageYears: 13, expectedMaturityScore: 2.35 },
  { ageYears: 14, expectedMaturityScore: 2.65 },
  { ageYears: 15, expectedMaturityScore: 2.85 },
  { ageYears: 16, expectedMaturityScore: 2.98 },
  { ageYears: 17, expectedMaturityScore: 3.08 },
  { ageYears: 18, expectedMaturityScore: 3.15 },
] as const;
const DEFAULT_FEMALE_CALIBRATION_CURVE: PubertyEncoderCalibrationPointV1[] = [
  { ageYears: 9, expectedMaturityScore: 1.4 },
  { ageYears: 10, expectedMaturityScore: 2.1 },
  { ageYears: 11, expectedMaturityScore: 2.9 },
  { ageYears: 12, expectedMaturityScore: 3.7 },
  { ageYears: 13, expectedMaturityScore: 4.25 },
  { ageYears: 14, expectedMaturityScore: 4.6 },
  { ageYears: 15, expectedMaturityScore: 4.8 },
  { ageYears: 16, expectedMaturityScore: 4.9 },
] as const;

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function interpolateCurve(
  ageYears: number,
  points: readonly PubertyEncoderCalibrationPointV1[]
): number {
  if (points.length === 0) {
    return 3;
  }
  if (ageYears <= points[0].ageYears) {
    return points[0].expectedMaturityScore;
  }
  for (let index = 0; index < points.length - 1; index += 1) {
    const pointA = points[index];
    const pointB = points[index + 1];
    if (ageYears <= pointB.ageYears) {
      const t =
        pointB.ageYears === pointA.ageYears
          ? 0
          : (ageYears - pointA.ageYears) / (pointB.ageYears - pointA.ageYears);
      return (
        pointA.expectedMaturityScore +
        (pointB.expectedMaturityScore - pointA.expectedMaturityScore) * t
      );
    }
  }
  return points[points.length - 1].expectedMaturityScore;
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

function sanitizeCalibrationCurve(
  points: unknown,
  fallback: readonly PubertyEncoderCalibrationPointV1[]
): PubertyEncoderCalibrationPointV1[] {
  if (!Array.isArray(points)) {
    return [...fallback];
  }

  const sanitized = points
    .map((point) => {
      if (typeof point !== "object" || point == null) {
        return null;
      }
      const ageYears = sanitizeFinite(
        (point as PubertyEncoderCalibrationPointV1).ageYears,
        Number.NaN
      );
      const expectedMaturityScore = sanitizeFinite(
        (point as PubertyEncoderCalibrationPointV1).expectedMaturityScore,
        Number.NaN
      );
      if (!Number.isFinite(ageYears) || !Number.isFinite(expectedMaturityScore)) {
        return null;
      }
      return {
        ageYears,
        expectedMaturityScore: clamp(expectedMaturityScore, 1, 5),
      };
    })
    .filter((point): point is PubertyEncoderCalibrationPointV1 => point != null)
    .sort((left, right) => left.ageYears - right.ageYears);

  return sanitized.length > 0 ? sanitized : [...fallback];
}

function sanitizeLinearModel(
  model: unknown,
  fallback: CanonicalPubertyEncoderLinearModelV1
): CanonicalPubertyEncoderLinearModelV1 {
  const coefficientsByFeature = {
    ...fallback.coefficientsByFeature,
  };
  for (const featureKey of CANONICAL_PUBERTY_ENCODER_FEATURE_ORDER_V1) {
    coefficientsByFeature[featureKey] = sanitizeFiniteMagnitude(
      (model as CanonicalPubertyEncoderLinearModelV1 | undefined)?.coefficientsByFeature?.[
        featureKey
      ],
      fallback.coefficientsByFeature[featureKey]
    );
  }

  return {
    intercept: sanitizeFiniteMagnitude(
      (model as CanonicalPubertyEncoderLinearModelV1 | undefined)?.intercept,
      fallback.intercept
    ),
    coefficientsByFeature,
  };
}

export const DEFAULT_CANONICAL_PUBERTY_ENCODER_MODEL_V1: CanonicalPubertyEncoderModelSourceV1 =
  {
    version: CANONICAL_PUBERTY_ENCODER_MODEL_VERSION_V1,
    inputVersion: CANONICAL_PUBERTY_ENCODER_INPUT_VERSION_V1,
    outputVersion: CANONICAL_PUBERTY_ENCODER_OUTPUT_VERSION_V1,
    featureVersion: CANONICAL_PUBERTY_ENCODER_FEATURE_VERSION_V1,
    target: "tanner_like_maturity_score",
    male: {
      intercept: 3,
      coefficientsByFeature: {
        bodyHairStageCentered: 0.35,
        bodyHairPresent: 0,
        facialHairStageCentered: 0.55,
        facialHairPresent: 0,
        voiceChangeStageCentered: 0.7,
        voiceChangePresent: 0,
        skinChangesStageCentered: 0.2,
        skinChangesPresent: 0,
        menarcheStartedValue: 0,
        menarcheStartedPresent: 0,
        menarcheYearsAgoCentered: 0,
        menarcheYearsAgoPresent: 0,
      },
    },
    female: {
      intercept: 2.8,
      coefficientsByFeature: {
        bodyHairStageCentered: 0.35,
        bodyHairPresent: 0,
        facialHairStageCentered: 0,
        facialHairPresent: 0,
        voiceChangeStageCentered: 0,
        voiceChangePresent: 0,
        skinChangesStageCentered: 0.22,
        skinChangesPresent: 0,
        menarcheStartedValue: 1.1,
        menarcheStartedPresent: 0,
        menarcheYearsAgoCentered: 0.85,
        menarcheYearsAgoPresent: 0,
      },
    },
    maleCalibrationCurve: [...DEFAULT_MALE_CALIBRATION_CURVE],
    femaleCalibrationCurve: [...DEFAULT_FEMALE_CALIBRATION_CURVE],
    notes: [
      "Fallback Tanner-like puberty encoder calibrated to a conservative Add Health-like maturity curve.",
      "Generated artifacts should replace this bundle after retraining.",
    ],
  };

export const ACTIVE_CANONICAL_PUBERTY_ENCODER_MODEL_SOURCE_V1: CanonicalPubertyEncoderModelSourceV1 =
  GENERATED_CANONICAL_PUBERTY_ENCODER_MODEL_V1;

function sanitizeStage(
  value: unknown,
  min: number = 1,
  max: number = 5
): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  return value >= min && value <= max ? value : undefined;
}

function sanitizeMenarcheYearsAgo(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  return value >= 0 && value <= 10 ? value : undefined;
}

function approximateMenarcheStage(
  menarcheStarted: boolean | null,
  menarcheYearsAgo: number | null
): number | null {
  if (menarcheStarted === false) return 1.8;
  if (menarcheStarted !== true) return null;
  if (menarcheYearsAgo == null) return 4.2;
  if (menarcheYearsAgo < 0.5) return 4.2;
  if (menarcheYearsAgo < 1.5) return 4.6;
  return 4.9;
}

function averageFinite(values: Array<number | null | undefined>): number | null {
  const finiteValues = values.filter(
    (value): value is number => typeof value === "number" && Number.isFinite(value)
  );
  if (finiteValues.length === 0) {
    return null;
  }
  return finiteValues.reduce((sum, value) => sum + value, 0) / finiteValues.length;
}

function mapUnderarmHairToStage(
  value: PubertyAnswers["puberty_underarmHair"]
): number | null {
  switch (value) {
    case "no":
      return 1.2;
    case "little":
      return 2.5;
    case "yes":
      return 4;
    default:
      return null;
  }
}

function mapBodyOdorToStage(value: PubertyAnswers["puberty_bodyOdor"]): number | null {
  switch (value) {
    case "no":
      return 1.4;
    case "little":
      return 2.5;
    case "definitely":
      return 3.6;
    default:
      return null;
  }
}

function mapFacialHairToStage(
  value: PubertyAnswers["puberty_facialHair"]
): number | null {
  switch (value) {
    case "none":
      return 1.2;
    case "faint":
      return 2.5;
    case "sometimes":
      return 3.6;
    case "regular":
      return 4.5;
    default:
      return null;
  }
}

function mapShaveFrequencyToStage(
  value: PubertyAnswers["puberty_shaveFrequency"]
): number | null {
  switch (value) {
    case "no":
      return 2.2;
    case "sometimes":
      return 3.4;
    case "regularly":
      return 4.6;
    default:
      return null;
  }
}

function mapVoiceDepthToStage(
  value: PubertyAnswers["puberty_voiceDepth"]
): number | null {
  switch (value) {
    case "nochange":
      return 1.4;
    case "somewhat":
      return 3.1;
    case "full":
      return 4.6;
    default:
      return null;
  }
}

function mapAcneSeverityToStage(
  value: PubertyAnswers["puberty_acneSeverity"]
): number | null {
  switch (value) {
    case "none":
      return 1.4;
    case "few":
      return 2.4;
    case "regular":
      return 3.3;
    case "severe":
      return 4.1;
    case "cleared":
      return 4.4;
    default:
      return null;
  }
}

function mapPeriodStartToMenarche(params: {
  periodStart: PubertyAnswers["puberty_periodStart"];
}): { menarcheStarted: boolean | null; menarcheYearsAgo: number | null } {
  switch (params.periodStart) {
    case "not_started":
      return { menarcheStarted: false, menarcheYearsAgo: null };
    case "lt6mo":
      return { menarcheStarted: true, menarcheYearsAgo: 0.25 };
    case "1y":
      return { menarcheStarted: true, menarcheYearsAgo: 1 };
    case "2y":
      return { menarcheStarted: true, menarcheYearsAgo: 2 };
    default:
      return { menarcheStarted: null, menarcheYearsAgo: null };
  }
}

export function sanitizeRawPubertySignalsV1(
  signals: RawPubertySignalsV1 | null | undefined
): RawPubertySignalsV1 | undefined {
  if (!signals) {
    return undefined;
  }

  const sanitized: RawPubertySignalsV1 = {
    bodyHairStage: sanitizeStage(signals.bodyHairStage),
    facialHairStage: sanitizeStage(signals.facialHairStage, 1, 5),
    voiceChangeStage: sanitizeStage(signals.voiceChangeStage),
    skinChangesStage: sanitizeStage(signals.skinChangesStage),
    menarcheStarted:
      typeof signals.menarcheStarted === "boolean"
        ? signals.menarcheStarted
        : undefined,
    menarcheYearsAgo: sanitizeMenarcheYearsAgo(signals.menarcheYearsAgo),
  };

  return Object.values(sanitized).some((value) => value != null)
    ? sanitized
    : undefined;
}

export function hasAnyRawPubertySignal(
  signals: RawPubertySignalsV1 | null | undefined
): boolean {
  return Object.values(sanitizeRawPubertySignalsV1(signals) ?? {}).some(
    (value) => value != null
  );
}

export function createCanonicalPubertyEncoderInputV1(
  params: Omit<CanonicalPubertyEncoderInputV1, "version">
): CanonicalPubertyEncoderInputV1 {
  const sanitizedSignals = sanitizeRawPubertySignalsV1(params);
  return {
    version: CANONICAL_PUBERTY_ENCODER_INPUT_VERSION_V1,
    sex: params.sex,
    ageYears: Number.isFinite(params.ageYears) ? params.ageYears : 0,
    ...sanitizedSignals,
  };
}

export function buildCanonicalPubertyEncoderInputFromRawSignals(params: {
  sex: PubertySexCode;
  ageYears: number;
  rawPubertySignals?: RawPubertySignalsV1 | null;
}): CanonicalPubertyEncoderInputV1 | null {
  const sanitizedSignals = sanitizeRawPubertySignalsV1(params.rawPubertySignals);
  if (!sanitizedSignals) {
    return null;
  }

  return createCanonicalPubertyEncoderInputV1({
    sex: params.sex,
    ageYears: params.ageYears,
    ...sanitizedSignals,
  });
}

export function buildCanonicalPubertyEncoderInputFromPubertyAnswers(params: {
  sex: PubertySexCode;
  ageYears: number;
  answers?: PubertyAnswers | null;
}): CanonicalPubertyEncoderInputV1 | null {
  const answers = params.answers;
  if (!answers) {
    return null;
  }

  const bodyHairStage = averageFinite([
    mapUnderarmHairToStage(answers.puberty_underarmHair),
    mapBodyOdorToStage(answers.puberty_bodyOdor),
  ]);
  const facialHairStage = averageFinite([
    mapFacialHairToStage(answers.puberty_facialHair),
    mapShaveFrequencyToStage(answers.puberty_shaveFrequency),
  ]);
  const voiceChangeStage = mapVoiceDepthToStage(answers.puberty_voiceDepth);
  const skinChangesStage = mapAcneSeverityToStage(answers.puberty_acneSeverity);
  const menarche = mapPeriodStartToMenarche({
    periodStart: answers.puberty_periodStart,
  });

  return buildCanonicalPubertyEncoderInputFromRawSignals({
    sex: params.sex,
    ageYears: params.ageYears,
    rawPubertySignals: {
      bodyHairStage: bodyHairStage ?? undefined,
      facialHairStage: facialHairStage ?? undefined,
      voiceChangeStage: voiceChangeStage ?? undefined,
      skinChangesStage: skinChangesStage ?? undefined,
      menarcheStarted: menarche.menarcheStarted ?? undefined,
      menarcheYearsAgo: menarche.menarcheYearsAgo ?? undefined,
    },
  });
}

export function buildCanonicalPubertyEncoderFeatureVectorV1(
  input: CanonicalPubertyEncoderInputV1
): CanonicalPubertyEncoderFeatureVectorV1 {
  const bodyHairStage = sanitizeStage(input.bodyHairStage) ?? null;
  const facialHairStage = sanitizeStage(input.facialHairStage) ?? null;
  const voiceChangeStage = sanitizeStage(input.voiceChangeStage) ?? null;
  const skinChangesStage = sanitizeStage(input.skinChangesStage) ?? null;
  const menarcheStarted =
    typeof input.menarcheStarted === "boolean" ? input.menarcheStarted : null;
  const menarcheYearsAgo = sanitizeMenarcheYearsAgo(input.menarcheYearsAgo) ?? null;
  const menarcheStage = approximateMenarcheStage(menarcheStarted, menarcheYearsAgo);
  const observedStageSignals =
    input.sex === "1"
      ? [bodyHairStage, facialHairStage, voiceChangeStage, skinChangesStage]
      : [bodyHairStage, skinChangesStage, menarcheStage];
  const finiteObservedStageSignals = observedStageSignals.filter(
    (value): value is number => typeof value === "number" && Number.isFinite(value)
  );

  const coverageWeights =
    input.sex === "1"
      ? {
          total: 3.6,
          present:
            (bodyHairStage != null ? 1 : 0) +
            (facialHairStage != null ? 1 : 0) +
            (voiceChangeStage != null ? 1 : 0) +
            (skinChangesStage != null ? 0.6 : 0),
        }
      : {
          total: 3.6,
          present:
            (bodyHairStage != null ? 1 : 0) +
            (skinChangesStage != null ? 0.6 : 0) +
            (menarcheStarted != null ? 1.2 : 0) +
            (menarcheYearsAgo != null ? 0.8 : 0),
        };
  const coverage =
    coverageWeights.total > 0
      ? clamp(coverageWeights.present / coverageWeights.total, 0, 1)
      : 0;
  const consistency =
    finiteObservedStageSignals.length < 2
      ? 1
      : (() => {
          const max = Math.max(...finiteObservedStageSignals);
          const min = Math.min(...finiteObservedStageSignals);
          const range = max - min;
          return clamp(1 - Math.max(0, range - 0.75) / 3.25, 0.35, 1);
        })();
  const confidence = clamp(coverage * (0.5 + 0.5 * consistency), 0, 1);

  return {
    version: CANONICAL_PUBERTY_ENCODER_FEATURE_VERSION_V1,
    inputVersion: CANONICAL_PUBERTY_ENCODER_INPUT_VERSION_V1,
    raw: {
      ageYears: Number.isFinite(input.ageYears) ? input.ageYears : 0,
      sex: input.sex,
      bodyHairStage,
      facialHairStage,
      voiceChangeStage,
      skinChangesStage,
      menarcheStarted,
      menarcheYearsAgo,
      observedStageSignals: finiteObservedStageSignals,
      coverage,
      confidence,
    },
    features: {
      bodyHairStageCentered: bodyHairStage == null ? 0 : bodyHairStage - 3,
      bodyHairPresent: bodyHairStage == null ? 0 : 1,
      facialHairStageCentered:
        facialHairStage == null ? 0 : facialHairStage - 3,
      facialHairPresent: facialHairStage == null ? 0 : 1,
      voiceChangeStageCentered:
        voiceChangeStage == null ? 0 : voiceChangeStage - 3,
      voiceChangePresent: voiceChangeStage == null ? 0 : 1,
      skinChangesStageCentered:
        skinChangesStage == null ? 0 : skinChangesStage - 3,
      skinChangesPresent: skinChangesStage == null ? 0 : 1,
      menarcheStartedValue:
        menarcheStarted == null ? 0 : menarcheStarted ? 1 : -1,
      menarcheStartedPresent: menarcheStarted == null ? 0 : 1,
      menarcheYearsAgoCentered:
        menarcheYearsAgo == null ? 0 : clamp((menarcheYearsAgo - 1) / 2, -0.5, 2),
      menarcheYearsAgoPresent: menarcheYearsAgo == null ? 0 : 1,
    },
  };
}

export function sanitizeCanonicalPubertyEncoderModelV1(
  model: CanonicalPubertyEncoderModelSourceV1 | null | undefined
): CanonicalPubertyEncoderModelSourceV1 {
  if (!model) {
    return DEFAULT_CANONICAL_PUBERTY_ENCODER_MODEL_V1;
  }

  if (
    model.version !== CANONICAL_PUBERTY_ENCODER_MODEL_VERSION_V1 ||
    model.inputVersion !== CANONICAL_PUBERTY_ENCODER_INPUT_VERSION_V1 ||
    model.outputVersion !== CANONICAL_PUBERTY_ENCODER_OUTPUT_VERSION_V1 ||
    model.featureVersion !== CANONICAL_PUBERTY_ENCODER_FEATURE_VERSION_V1 ||
    model.target !== "tanner_like_maturity_score"
  ) {
    return DEFAULT_CANONICAL_PUBERTY_ENCODER_MODEL_V1;
  }

  return {
    version: CANONICAL_PUBERTY_ENCODER_MODEL_VERSION_V1,
    inputVersion: CANONICAL_PUBERTY_ENCODER_INPUT_VERSION_V1,
    outputVersion: CANONICAL_PUBERTY_ENCODER_OUTPUT_VERSION_V1,
    featureVersion: CANONICAL_PUBERTY_ENCODER_FEATURE_VERSION_V1,
    target: "tanner_like_maturity_score",
    male: sanitizeLinearModel(
      model.male,
      DEFAULT_CANONICAL_PUBERTY_ENCODER_MODEL_V1.male
    ),
    female: sanitizeLinearModel(
      model.female,
      DEFAULT_CANONICAL_PUBERTY_ENCODER_MODEL_V1.female
    ),
    maleCalibrationCurve: sanitizeCalibrationCurve(
      model.maleCalibrationCurve,
      DEFAULT_CANONICAL_PUBERTY_ENCODER_MODEL_V1.maleCalibrationCurve
    ),
    femaleCalibrationCurve: sanitizeCalibrationCurve(
      model.femaleCalibrationCurve,
      DEFAULT_CANONICAL_PUBERTY_ENCODER_MODEL_V1.femaleCalibrationCurve
    ),
    notes:
      Array.isArray(model.notes) && model.notes.every((note) => typeof note === "string")
        ? model.notes
        : DEFAULT_CANONICAL_PUBERTY_ENCODER_MODEL_V1.notes,
  };
}

export function resolveCanonicalPubertyEncoderModelV1(
  model: CanonicalPubertyEncoderModelSourceV1 | null | undefined =
    ACTIVE_CANONICAL_PUBERTY_ENCODER_MODEL_SOURCE_V1
): CanonicalPubertyEncoderModelSourceV1 {
  return sanitizeCanonicalPubertyEncoderModelV1(model);
}

function evaluateObservedMaturityScore(
  featureVector: CanonicalPubertyEncoderFeatureVectorV1,
  model: CanonicalPubertyEncoderModelSourceV1
): number {
  const submodel = featureVector.raw.sex === "1" ? model.male : model.female;
  let total = submodel.intercept;
  for (const featureKey of CANONICAL_PUBERTY_ENCODER_FEATURE_ORDER_V1) {
    total +=
      (featureVector.features[featureKey] ?? 0) *
      (submodel.coefficientsByFeature[featureKey] ?? 0);
  }
  return clamp(total, 1, 5);
}

export function getPubertyEncoderTimingBucket(
  encoding: CanonicalPubertyEncodingV1 | null | undefined
): PubertyEncoderTimingBucket {
  if (!encoding || encoding.confidence < 0.35) {
    return "unknown";
  }
  if (encoding.maturityResidualForAge >= 0.75) {
    return "late";
  }
  if (encoding.maturityResidualForAge <= -0.75) {
    return "early";
  }
  return "typical";
}

export function encodeCanonicalPubertyV1(
  input: CanonicalPubertyEncoderInputV1,
  model: CanonicalPubertyEncoderModelSourceV1 | null | undefined =
    ACTIVE_CANONICAL_PUBERTY_ENCODER_MODEL_SOURCE_V1
): CanonicalPubertyEncodingV1 {
  const safeModel = resolveCanonicalPubertyEncoderModelV1(model);
  const featureVector = buildCanonicalPubertyEncoderFeatureVectorV1(input);
  const maturityScore = evaluateObservedMaturityScore(featureVector, safeModel);
  const expectedMaturityScore = interpolateCurve(
    Number.isFinite(input.ageYears) ? input.ageYears : 0,
    input.sex === "1"
      ? safeModel.maleCalibrationCurve
      : safeModel.femaleCalibrationCurve
  );

  return {
    version: CANONICAL_PUBERTY_ENCODER_OUTPUT_VERSION_V1,
    maturityScore,
    maturityResidualForAge: clamp(expectedMaturityScore - maturityScore, -4, 4),
    confidence: featureVector.raw.confidence,
    coverage: featureVector.raw.coverage,
  };
}
