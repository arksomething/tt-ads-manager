export type PubertySexCode = "1" | "2";
export type PubertyTiming = "early" | "typical" | "late" | "unknown";

export interface PubertyAnswers {
  puberty_underarmHair?: "no" | "little" | "yes" | "idk";
  puberty_periodStart?: "not_started" | "lt6mo" | "1y" | "2y" | "idk";
  puberty_periodRegular?: "yes" | "no" | "idk";
  puberty_facialHair?: "none" | "faint" | "sometimes" | "regular" | "idk";
  puberty_growthLastYear?: "lt2" | "2to5" | "6to9" | "10plus" | "idk";
  puberty_shouldersBroadening?: "no" | "starting" | "broader" | "idk";
  puberty_bodyOdor?: "no" | "little" | "definitely" | "idk";
  puberty_acneSeverity?:
    | "none"
    | "few"
    | "regular"
    | "severe"
    | "cleared"
    | "idk";
  puberty_muscleDefinition?: "no" | "little" | "clear" | "idk";
  puberty_voiceDepth?: "nochange" | "somewhat" | "full" | "idk";
  puberty_stillGrowingSlower?:
    | "same"
    | "slower"
    | "notgrown"
    | "faster"
    | "no"
    | "yes"
    | "idk";
  puberty_shaveFrequency?: "no" | "sometimes" | "regularly" | "idk";
}

export interface PubertyEstimate {
  stage: 1 | 2 | 3 | 4 | 5 | null;
  stageContinuous: number | null;
  expectedStage: number;
  timing: PubertyTiming;
  confidence: number;
  answeredCount: number;
  relevantAnswerCount: number;
}

type StageSignal = {
  value: number | null;
  weight: number;
};

const MALE_EXPECTED_STAGE_CURVE = [
  [9, 1],
  [10.5, 1.2],
  [11.5, 1.9],
  [12.5, 2.8],
  [13.5, 3.5],
  [14.5, 4.1],
  [15.5, 4.5],
  [16.5, 4.8],
  [17.5, 5],
] as const;

const FEMALE_EXPECTED_STAGE_CURVE = [
  [8, 1],
  [9, 1.4],
  [10, 2.2],
  [11, 3],
  [12, 3.8],
  [13, 4.4],
  [14, 4.8],
  [15, 5],
] as const;

export const PUBERTY_TIMING_MIN_CONFIDENCE = 0.35;
export const PUBERTY_TIMING_EARLY_LATE_THRESHOLD = 0.9;
export const PUBERTY_TIMING_GROWTH_SIGNAL_WEIGHT = 0.35;

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

function averageWeightedSignals(signals: StageSignal[]): {
  stageContinuous: number | null;
  answeredCount: number;
  totalAnsweredWeight: number;
} {
  let weightedTotal = 0;
  let totalWeight = 0;
  let answeredCount = 0;

  for (const signal of signals) {
    if (signal.value == null) continue;
    weightedTotal += signal.value * signal.weight;
    totalWeight += signal.weight;
    answeredCount += 1;
  }

  if (totalWeight <= 0) {
    return { stageContinuous: null, answeredCount: 0, totalAnsweredWeight: 0 };
  }

  return {
    stageContinuous: clamp(weightedTotal / totalWeight, 1, 5),
    answeredCount,
    totalAnsweredWeight: totalWeight,
  };
}

function getUnderarmSignal(
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

function getBodyOdorSignal(
  value: PubertyAnswers["puberty_bodyOdor"]
): number | null {
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

function getAcneSignal(
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

function getFacialHairSignal(
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

function getShouldersSignal(
  value: PubertyAnswers["puberty_shouldersBroadening"]
): number | null {
  switch (value) {
    case "no":
      return 1.4;
    case "starting":
      return 2.5;
    case "broader":
      return 4.1;
    default:
      return null;
  }
}

function getMuscleSignal(
  value: PubertyAnswers["puberty_muscleDefinition"]
): number | null {
  switch (value) {
    case "no":
      return 1.5;
    case "little":
      return 2.6;
    case "clear":
      return 4.1;
    default:
      return null;
  }
}

function getVoiceSignal(
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

function getShaveSignal(
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

function getPeriodStartSignal(
  value: PubertyAnswers["puberty_periodStart"]
): number | null {
  switch (value) {
    case "not_started":
      return 1.8;
    case "lt6mo":
      return 4.2;
    case "1y":
      return 4.6;
    case "2y":
      return 4.9;
    default:
      return null;
  }
}

function getPeriodRegularSignal(
  periodStart: PubertyAnswers["puberty_periodStart"],
  value: PubertyAnswers["puberty_periodRegular"]
): number | null {
  if (
    periodStart == null ||
    periodStart === "idk" ||
    periodStart === "not_started"
  ) {
    return null;
  }

  switch (value) {
    case "no":
      return 4.2;
    case "yes":
      return 4.9;
    default:
      return null;
  }
}

function getRelevantSignals(
  sex: PubertySexCode,
  answers: PubertyAnswers
): StageSignal[] {
  const sharedSignals: StageSignal[] = [
    { value: getUnderarmSignal(answers.puberty_underarmHair), weight: 1 },
    { value: getBodyOdorSignal(answers.puberty_bodyOdor), weight: 0.8 },
    { value: getAcneSignal(answers.puberty_acneSeverity), weight: 0.7 },
  ];

  if (sex === "1") {
    return [
      ...sharedSignals,
      { value: getFacialHairSignal(answers.puberty_facialHair), weight: 1.2 },
      { value: getShouldersSignal(answers.puberty_shouldersBroadening), weight: 0.7 },
      { value: getMuscleSignal(answers.puberty_muscleDefinition), weight: 0.7 },
      { value: getVoiceSignal(answers.puberty_voiceDepth), weight: 1.3 },
      { value: getShaveSignal(answers.puberty_shaveFrequency), weight: 0.5 },
    ];
  }

  return [
    ...sharedSignals,
    { value: getPeriodStartSignal(answers.puberty_periodStart), weight: 1.5 },
    {
      value: getPeriodRegularSignal(
        answers.puberty_periodStart,
        answers.puberty_periodRegular
      ),
      weight: 0.8,
    },
  ];
}

export function getPubertyGrowthSignal(answers: PubertyAnswers): number {
  let signal = 0;

  switch (answers.puberty_growthLastYear) {
    case "10plus":
      signal += 0.6;
      break;
    case "6to9":
      signal += 0.3;
      break;
    case "lt2":
      signal -= 0.45;
      break;
    default:
      break;
  }

  switch (answers.puberty_stillGrowingSlower) {
    case "yes":
    case "same":
    case "faster":
      signal += 0.3;
      break;
    case "slower":
      signal += 0.05;
      break;
    case "no":
    case "notgrown":
      signal -= 0.35;
      break;
    default:
      break;
  }

  return signal;
}

export function getPubertyTimingAdjustedDelta(params: {
  confidence: number;
  expectedStage: number;
  observedStage: number | null;
  answers: PubertyAnswers;
}): number | null {
  if (
    params.observedStage == null ||
    params.confidence < PUBERTY_TIMING_MIN_CONFIDENCE
  ) {
    return null;
  }

  const stageDelta = params.expectedStage - params.observedStage;
  return (
    stageDelta +
    getPubertyGrowthSignal(params.answers) * PUBERTY_TIMING_GROWTH_SIGNAL_WEIGHT
  );
}

function getPubertyTiming(
  sex: PubertySexCode,
  confidence: number,
  expectedStage: number,
  observedStage: number | null,
  answers: PubertyAnswers
): PubertyTiming {
  const adjustedDelta = getPubertyTimingAdjustedDelta({
    confidence,
    expectedStage,
    observedStage,
    answers,
  });
  if (adjustedDelta == null) return "unknown";

  if (adjustedDelta >= PUBERTY_TIMING_EARLY_LATE_THRESHOLD) return "late";
  if (adjustedDelta <= -PUBERTY_TIMING_EARLY_LATE_THRESHOLD) return "early";
  return "typical";
}

export function estimatePubertyState(params: {
  ageYears: number;
  sex: PubertySexCode;
  answers?: PubertyAnswers | null;
}): PubertyEstimate {
  const ageYears = Number.isFinite(params.ageYears) ? params.ageYears : 0;
  const sex = params.sex;
  const answers = params.answers ?? {};
  const relevantSignals = getRelevantSignals(sex, answers);
  const { stageContinuous, answeredCount, totalAnsweredWeight } =
    averageWeightedSignals(relevantSignals);
  const expectedStage = interpolateCurve(
    ageYears,
    sex === "1" ? MALE_EXPECTED_STAGE_CURVE : FEMALE_EXPECTED_STAGE_CURVE
  );
  const totalPossibleWeight = relevantSignals.reduce(
    (sum, signal) => sum + signal.weight,
    0
  );
  const confidence = clamp(
    totalPossibleWeight > 0 ? totalAnsweredWeight / totalPossibleWeight : 0,
    0,
    1
  );
  const timing = getPubertyTiming(
    sex,
    confidence,
    expectedStage,
    stageContinuous,
    answers
  );
  const stage =
    stageContinuous == null
      ? null
      : (clamp(Math.round(stageContinuous), 1, 5) as 1 | 2 | 3 | 4 | 5);

  return {
    stage,
    stageContinuous,
    expectedStage,
    timing,
    confidence,
    answeredCount,
    relevantAnswerCount: answeredCount,
  };
}

export function buildProjectionPubertyInputs(
  source: Partial<PubertyAnswers> | null | undefined
): PubertyAnswers | undefined {
  if (!source) return undefined;

  const answers: PubertyAnswers = {
    puberty_underarmHair: source.puberty_underarmHair,
    puberty_periodStart: source.puberty_periodStart,
    puberty_periodRegular: source.puberty_periodRegular,
    puberty_facialHair: source.puberty_facialHair,
    puberty_growthLastYear: source.puberty_growthLastYear,
    puberty_shouldersBroadening: source.puberty_shouldersBroadening,
    puberty_bodyOdor: source.puberty_bodyOdor,
    puberty_acneSeverity: source.puberty_acneSeverity,
    puberty_muscleDefinition: source.puberty_muscleDefinition,
    puberty_voiceDepth: source.puberty_voiceDepth,
    puberty_stillGrowingSlower: source.puberty_stillGrowingSlower,
    puberty_shaveFrequency: source.puberty_shaveFrequency,
  };

  const hasAnyAnswer = Object.values(answers).some(
    (value) => value != null && value !== "" && value !== "idk"
  );
  return hasAnyAnswer ? answers : undefined;
}
