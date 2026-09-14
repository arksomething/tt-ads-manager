// Utility to generate diagnostic reasons for why a user may be shorter right now.
// This does not alter or compute any height predictions.

import { estimatePubertyState, type PubertyAnswers } from "./pubertyModel";

export type Sex = 'male' | 'female';

export type GrowthLastYearBucket = '<2cm' | '2-5cm' | '6-9cm' | '10+cm';

export interface PubertyQuizInputs {
  underarmHair?: 'no' | 'little' | 'yes';
  periodStarted?: 'notStarted' | 'lt6mo' | '1y' | '2y';
  periodRegular?: 'yes' | 'no' | 'idk';
  facialHair?: 'none' | 'faint' | 'shaveSometimes' | 'shaveRegularly';
  heightGainLastYear?: GrowthLastYearBucket;
  broaderShoulders?: 'no' | 'starting' | 'clearly';
  bodyOdor?: 'none' | 'little' | 'definite';
  acne?: 'none' | 'few' | 'regular' | 'frequent' | 'wentAway';
  muscleDefinition?: 'no' | 'little' | 'clearly';
  voiceDeepened?: 'noChange' | 'somewhat' | 'fully';
  stillGrowing?: 'yes' | 'yesButSlower' | 'no';
}

export interface ShortReasonsInput {
  ageYears: number;
  sex: Sex;
  // Optional self anthropometrics for BMI-based lifestyle reasoning
  selfHeightCm?: number;
  weightKg?: number;
  motherHeightCm?: number;
  fatherHeightCm?: number;
  tallRelativesBeyondParents?: boolean;
  exerciseHoursPerWeek?: number; // optional; absence means unknown
  sleepHoursPerNight?: number; // optional; absence means unknown
  sports?: ('basketball' | 'swimming' | 'volleyball' | 'soccer' | 'weightlifting' | 'running' | 'other' | 'none')[];
  pubertyQuiz: PubertyQuizInputs;
}

export type ShortReasonCategory = 'puberty' | 'genetics' | 'lifestyle';

export type ShortReasonType =
  | 'EarlyPubertyStage'
  | 'LowRecentGrowthVelocity'
  | 'GeneticsShortParentalStature'
  | 'GeneticsPotentialNotManifested'
  | 'LowSleepHabits'
  | 'LowPhysicalActivity'
  | 'EatingHabitsOverweight'
  | 'MindsetOpportunity';

export interface ShortReason {
  type: ShortReasonType;
  category: ShortReasonCategory;
  message: string;
}

export type GrowthTrackStatus = 'on_track' | 'slower' | 'faster';

export interface GrowthTrackResult {
  status: GrowthTrackStatus;
  message: string;
}

// Config defaults; consider moving to remote config if you need to tune regionally.
const AVERAGE_ADULT_HEIGHT_CM = {
  male: 175, // generic global-ish average; adjust if needed
  female: 162,
};

const LIFESTYLE_THRESHOLDS = {
  minHealthySleepHours: 8,
  lowSleepHours: 6,
  highExerciseHoursPerWeek: 5,
};

const BMI_THRESHOLDS = {
  obesity: 30, // heuristic for "very overweight" in absence of age-specific percentiles
};

const SHORT_REASON_COPY = {
  desc: {
    EarlyPubertyStage: "You seem early in puberty, so bigger growth may start later.",
    LowRecentGrowthVelocity: "You didn't grow much this year, which often happens before a growth spurt.",
    GeneticsShortParentalStature: "Your parents are shorter than average, which can make you look shorter now.",
    GeneticsPotentialNotManifested: "Tall relatives suggest you might grow more later as you develop.",
    LowSleepHabits: "Not enough sleep can slow recovery and growth.",
    LowPhysicalActivity: "Low activity means fewer signals for bones and muscles to grow.",
    EatingHabitsOverweight: "Being overweight can affect posture and healthy growth; better food choices can help.",
    MindsetOpportunity: "Mindset, posture, and confidence can help you look taller and stick to good habits.",
  },
  msg: {
    EarlyPubertyStage: "You're likely early in puberty, so bigger growth may come later.",
    LowRecentGrowthVelocity: "You didn't grow much this year, which often happens before a growth spurt.",
    GeneticsShortParentalStature: "Your parents are shorter than average, which can make you look shorter now.",
    GeneticsPotentialNotManifested: "Tall relatives suggest you could grow more as you develop.",
    LowSleepHabits: "Getting more sleep can help your body recover and grow.",
    LowPhysicalActivity: "More regular activity can support healthy growth and posture.",
    EatingHabitsOverweight: "Improving your food choices can support healthy growth and posture.",
    MindsetOpportunity: "Your mindset might be the missing piece. Your genes and habits look good-stand tall, think confident, and keep strong posture.",
  },
  growth: {
    on_track: "Your growth pace looks on track for your stage.",
    slower: "Your growth has been slower lately; bigger gains often come as puberty moves forward.",
    faster: "You're growing faster than typical right now, which can happen during growth spurts.",
  },
} as const;

function isLikelyPreOrMidPuberty(ageYears: number, sex: Sex): boolean {
  // Heuristic windows for peak height velocity
  // Boys: ~12–16; Girls: ~10–14
  return sex === 'male' ? ageYears < 16.5 : ageYears < 15;
}

function isLikelyPostPuberty(ageYears: number, sex: Sex): boolean {
  // Heuristic: most linear growth completed by these ages
  return sex === 'male' ? ageYears >= 17.5 : ageYears >= 16.5;
}

function toPubertyModelAnswers(quiz: PubertyQuizInputs): PubertyAnswers {
  return {
    puberty_underarmHair: quiz.underarmHair,
    puberty_periodStart:
      quiz.periodStarted === 'notStarted'
        ? 'not_started'
        : quiz.periodStarted,
    puberty_periodRegular: quiz.periodRegular,
    puberty_facialHair:
      quiz.facialHair === 'shaveSometimes'
        ? 'sometimes'
        : quiz.facialHair === 'shaveRegularly'
          ? 'regular'
          : quiz.facialHair,
    puberty_growthLastYear:
      quiz.heightGainLastYear == null
        ? undefined
        : quiz.heightGainLastYear === '<2cm'
          ? 'lt2'
          : quiz.heightGainLastYear === '6-9cm'
            ? '6to9'
            : quiz.heightGainLastYear === '10+cm'
              ? '10plus'
              : '2to5',
    puberty_shouldersBroadening:
      quiz.broaderShoulders == null
        ? undefined
        : quiz.broaderShoulders === 'clearly'
          ? 'broader'
          : quiz.broaderShoulders,
    puberty_bodyOdor:
      quiz.bodyOdor == null
        ? undefined
        : quiz.bodyOdor === 'definite'
          ? 'definitely'
          : quiz.bodyOdor === 'none'
            ? 'no'
            : 'little',
    puberty_acneSeverity:
      quiz.acne == null
        ? undefined
        : quiz.acne === 'frequent'
          ? 'severe'
          : quiz.acne === 'wentAway'
            ? 'cleared'
            : quiz.acne,
    puberty_muscleDefinition:
      quiz.muscleDefinition == null
        ? undefined
        : quiz.muscleDefinition === 'clearly'
          ? 'clear'
          : quiz.muscleDefinition,
    puberty_voiceDepth:
      quiz.voiceDeepened == null
        ? undefined
        : quiz.voiceDeepened === 'noChange'
          ? 'nochange'
          : quiz.voiceDeepened === 'fully'
            ? 'full'
            : 'somewhat',
    puberty_stillGrowingSlower:
      quiz.stillGrowing == null
        ? undefined
        : quiz.stillGrowing === 'yes'
          ? 'yes'
          : quiz.stillGrowing === 'yesButSlower'
            ? 'slower'
            : 'no',
  };
}

function estimatePubertyFromQuiz(
  ageYears: number,
  sex: Sex,
  quiz: PubertyQuizInputs
){
  return estimatePubertyState({
    ageYears,
    sex: sex === 'male' ? '1' : '2',
    answers: toPubertyModelAnswers(quiz),
  });
}

function hasLowSleep(sleepHoursPerNight?: number): boolean {
  if (sleepHoursPerNight == null) return false;
  return sleepHoursPerNight < LIFESTYLE_THRESHOLDS.lowSleepHours;
}

function hasLowActivity(exerciseHoursPerWeek?: number): boolean {
  if (exerciseHoursPerWeek == null) return false;
  return exerciseHoursPerWeek < 2; // simple heuristic: <2 hrs/week is low
}

function computeMidParentalHeightCm(
  sex: Sex,
  motherHeightCm?: number,
  fatherHeightCm?: number
): number | undefined {
  if (motherHeightCm == null || fatherHeightCm == null) return undefined;
  return sex === 'male'
    ? (fatherHeightCm + motherHeightCm + 13) / 2
    : (fatherHeightCm + motherHeightCm - 13) / 2;
}

function parentalStatureAppearsShort(
  sex: Sex,
  motherHeightCm?: number,
  fatherHeightCm?: number
): boolean {
  const mid = computeMidParentalHeightCm(sex, motherHeightCm, fatherHeightCm);
  if (mid == null) return false;
  const avg = sex === 'male' ? AVERAGE_ADULT_HEIGHT_CM.male : AVERAGE_ADULT_HEIGHT_CM.female;
  return mid < avg; // below typical average suggests shorter genetic baseline
}

function computeBmi(heightCm?: number, weightKg?: number): number | undefined {
  if (!heightCm || !weightKg || heightCm <= 0) return undefined;
  const meters = heightCm / 100;
  return weightKg / (meters * meters);
}

// All possible reason types with human-readable descriptions.
export const SHORT_REASON_TYPES_DESCRIPTION: Record<ShortReasonType, string> = {
  EarlyPubertyStage: SHORT_REASON_COPY.desc.EarlyPubertyStage,
  LowRecentGrowthVelocity: SHORT_REASON_COPY.desc.LowRecentGrowthVelocity,
  GeneticsShortParentalStature: SHORT_REASON_COPY.desc.GeneticsShortParentalStature,
  GeneticsPotentialNotManifested: SHORT_REASON_COPY.desc.GeneticsPotentialNotManifested,
  LowSleepHabits: SHORT_REASON_COPY.desc.LowSleepHabits,
  LowPhysicalActivity: SHORT_REASON_COPY.desc.LowPhysicalActivity,
  EatingHabitsOverweight: SHORT_REASON_COPY.desc.EatingHabitsOverweight,
  MindsetOpportunity: SHORT_REASON_COPY.desc.MindsetOpportunity,
};

// Public: returns up to three diagnostic reasons (distinct categories) why the user may be shorter now.
export function getShortReasons(input: ShortReasonsInput): ShortReason[] {
  const reasons: ShortReason[] = [];

  const pubertyEstimate = estimatePubertyFromQuiz(
    input.ageYears,
    input.sex,
    input.pubertyQuiz
  );
  const tanner = pubertyEstimate.stage ?? 3;
  const hasReliablePubertyEstimate =
    pubertyEstimate.confidence >= 0.35 &&
    pubertyEstimate.relevantAnswerCount >= 2;
  const grewLittle = input.pubertyQuiz.heightGainLastYear === '<2cm';
  const preOrMid = isLikelyPreOrMidPuberty(input.ageYears, input.sex);
  const post = isLikelyPostPuberty(input.ageYears, input.sex);

  // 1) Puberty/development category (pick at most one)
  if (hasReliablePubertyEstimate && tanner <= 2 && preOrMid) {
    reasons.push({
      type: 'EarlyPubertyStage',
      category: 'puberty',
      message: SHORT_REASON_COPY.msg.EarlyPubertyStage,
    });
  } else if (hasReliablePubertyEstimate && grewLittle && tanner <= 3 && preOrMid && !post) {
    reasons.push({
      type: 'LowRecentGrowthVelocity',
      category: 'puberty',
      message: SHORT_REASON_COPY.msg.LowRecentGrowthVelocity,
    });
  }

  // 2) Genetics/growth category (pick at most one)
  const geneticsReasons: ShortReason[] = [];
  if (parentalStatureAppearsShort(input.sex, input.motherHeightCm, input.fatherHeightCm)) {
    geneticsReasons.push({
      type: 'GeneticsShortParentalStature',
      category: 'genetics',
      message: SHORT_REASON_COPY.msg.GeneticsShortParentalStature,
    });
  } else if (hasReliablePubertyEstimate && input.tallRelativesBeyondParents && tanner <= 3 && preOrMid) {
    geneticsReasons.push({
      type: 'GeneticsPotentialNotManifested',
      category: 'genetics',
      message: SHORT_REASON_COPY.msg.GeneticsPotentialNotManifested,
    });
  }
  if (!reasons.find(r => r.category === 'genetics') && geneticsReasons.length > 0) {
    reasons.push(geneticsReasons[0]);
  }

  // 3) Lifestyle category (pick at most one)
  const lifestyleReasons: ShortReason[] = [];
  // Prioritize sleep first so severe sleep deprivation is surfaced
  if (hasLowSleep(input.sleepHoursPerNight)) {
    lifestyleReasons.push({
      type: 'LowSleepHabits',
      category: 'lifestyle',
      message: SHORT_REASON_COPY.msg.LowSleepHabits,
    });
  }
  // Then activity
  if (hasLowActivity(input.exerciseHoursPerWeek)) {
    lifestyleReasons.push({
      type: 'LowPhysicalActivity',
      category: 'lifestyle',
      message: SHORT_REASON_COPY.msg.LowPhysicalActivity,
    });
  }
  // Finally weight-related reason
  const bmi = computeBmi(input.selfHeightCm, input.weightKg);
  if (bmi != null && bmi >= BMI_THRESHOLDS.obesity) {
    lifestyleReasons.push({
      type: 'EatingHabitsOverweight',
      category: 'lifestyle',
      message: SHORT_REASON_COPY.msg.EatingHabitsOverweight,
    });
  }
  if (!reasons.find(r => r.category === 'lifestyle') && lifestyleReasons.length > 0) {
    reasons.push(lifestyleReasons[0]);
  }

  // Ensure we only return up to three reasons; prioritize in the order added.
  const finalReasons = reasons.slice(0, 3);
  if (finalReasons.length === 0) {
    finalReasons.push({
      type: 'MindsetOpportunity',
      category: 'lifestyle',
      message: SHORT_REASON_COPY.msg.MindsetOpportunity,
    });
  }
  return finalReasons;
}

// Public: classify whether recent growth pace is on track relative to stage and age
export function getGrowthTrackStatus(input: Pick<ShortReasonsInput, 'ageYears' | 'sex' | 'pubertyQuiz'>): GrowthTrackResult {
  const pubertyEstimate = estimatePubertyFromQuiz(
    input.ageYears,
    input.sex,
    input.pubertyQuiz
  );
  if (pubertyEstimate.confidence < 0.35 || pubertyEstimate.relevantAnswerCount < 2) {
    return {
      status: 'on_track',
      message: SHORT_REASON_COPY.growth.on_track,
    };
  }
  const tanner = pubertyEstimate.stage ?? 3;
  const preOrMid = isLikelyPreOrMidPuberty(input.ageYears, input.sex);
  const post = isLikelyPostPuberty(input.ageYears, input.sex);

  const gain = input.pubertyQuiz.heightGainLastYear;

  let status: GrowthTrackStatus = 'on_track';
  if (preOrMid || tanner <= 3) {
    if (gain === '<2cm') status = 'slower';
    else if (gain === '10+cm') status = 'faster';
    else status = 'on_track';
  } else if (post || tanner >= 4) {
    if (gain === '6-9cm' || gain === '10+cm') status = 'faster';
    else status = 'on_track';
  }

  let message = '';
  if (status === 'on_track') {
    message = SHORT_REASON_COPY.growth.on_track;
  } else if (status === 'slower') {
    message = SHORT_REASON_COPY.growth.slower;
  } else {
    message = SHORT_REASON_COPY.growth.faster;
  }

  return { status, message };
}

// Helper: list all possible reason types with their categories and descriptions (useful for UI/help).
export function listAllShortReasonTypes(): { type: ShortReasonType; category: ShortReasonCategory; description: string }[] {
  return (
    [
      { type: 'EarlyPubertyStage', category: 'puberty' as const },
      { type: 'LowRecentGrowthVelocity', category: 'puberty' as const },
      { type: 'GeneticsShortParentalStature', category: 'genetics' as const },
      { type: 'GeneticsPotentialNotManifested', category: 'genetics' as const },
      { type: 'LowSleepHabits', category: 'lifestyle' as const },
      { type: 'LowPhysicalActivity', category: 'lifestyle' as const },
    ] as const
  ).map(({ type, category }) => ({ type, category, description: SHORT_REASON_TYPES_DESCRIPTION[type] }));
}


// Convenience helper: map app user data and onboarding answers into ShortReasons input and return reasons
// Accepts a minimal shape to avoid tight coupling. All fields are optional except required basics.
export interface AppUserBasicsForReasons {
  heightCm: number;
  sex: '1' | '2';
}

export interface AppOnboardingSnapshotForReasons {
  units?: 'imperial' | 'metric';
  motherHeight?: string;
  fatherHeight?: string;
  sleepHoursPerNight?: string;
  exerciseHoursPerWeek?: string;
  tallerRelatives?: string[];
  weight?: string;
}

export interface AppUserPubertyFieldsForReasons {
  puberty_underarmHair?: 'no' | 'little' | 'yes' | 'idk';
  puberty_periodStart?: 'not_started' | 'lt6mo' | '1y' | '2y' | 'idk';
  puberty_periodRegular?: 'yes' | 'no' | 'idk';
  puberty_facialHair?: 'none' | 'faint' | 'sometimes' | 'regular' | 'idk';
  puberty_growthLastYear?: 'lt2' | '2to5' | '6to9' | '10plus' | 'idk';
  puberty_shouldersBroadening?: 'no' | 'starting' | 'broader' | 'idk';
  puberty_bodyOdor?: 'no' | 'little' | 'definitely' | 'idk';
  puberty_acneSeverity?: 'none' | 'few' | 'regular' | 'severe' | 'cleared' | 'idk';
  puberty_muscleDefinition?: 'no' | 'little' | 'clear' | 'idk';
  puberty_voiceDepth?: 'nochange' | 'somewhat' | 'full' | 'idk';
  puberty_stillGrowingSlower?: 'same' | 'slower' | 'notgrown' | 'faster' | 'no' | 'yes' | 'idk';
}

export function buildShortReasonsFromAppData(
  basics: AppUserBasicsForReasons & AppUserPubertyFieldsForReasons,
  onboarding: AppOnboardingSnapshotForReasons,
  getAgeYears: () => number,
  fallbackMotherHeightCm?: number,
  fallbackFatherHeightCm?: number
): ShortReason[] {
  const ageYears = getAgeYears();
  const sex = basics.sex === '1' ? 'male' : 'female';

  const parseHeightStringToCm = (input?: string): number | undefined => {
    if (!input) return undefined;
    if (onboarding.units === 'metric') {
      const cm = parseInt(input.split(' ')[0]);
      return isNaN(cm) ? undefined : cm;
    }
    const parts = input.split(' ft ');
    if (parts.length < 2) return undefined;
    const feet = parseInt(parts[0]);
    const inches = parseInt(parts[1]);
    if (isNaN(feet) || isNaN(inches)) return undefined;
    const totalInches = feet * 12 + inches;
    // simple inline convert to cm to avoid importing convert-units here
    return Math.round(totalInches * 2.54);
  };

  const motherHeightCm = parseHeightStringToCm(onboarding.motherHeight) ?? fallbackMotherHeightCm;
  const fatherHeightCm = parseHeightStringToCm(onboarding.fatherHeight) ?? fallbackFatherHeightCm;

  const quiz: PubertyQuizInputs = {
    underarmHair:
      basics.puberty_underarmHair === 'yes'
        ? 'yes'
        : basics.puberty_underarmHair === 'little'
          ? 'little'
          : undefined,
    periodStarted:
      basics.puberty_periodStart === 'lt6mo' ||
      basics.puberty_periodStart === '1y' ||
      basics.puberty_periodStart === '2y'
        ? basics.puberty_periodStart
        : basics.puberty_periodStart === 'not_started'
          ? 'notStarted'
          : undefined,
    periodRegular: basics.puberty_periodRegular,
    facialHair:
      basics.puberty_facialHair === 'faint'
        ? 'faint'
        : basics.puberty_facialHair === 'sometimes'
        ? 'shaveSometimes'
        : basics.puberty_facialHair === 'regular'
        ? 'shaveRegularly'
        : undefined,
    heightGainLastYear:
      basics.puberty_growthLastYear === 'lt2'
        ? '<2cm'
        : basics.puberty_growthLastYear === '6to9'
        ? '6-9cm'
        : basics.puberty_growthLastYear === '10plus'
        ? '10+cm'
        : basics.puberty_growthLastYear === '2to5'
          ? '2-5cm'
          : undefined,
    broaderShoulders:
      basics.puberty_shouldersBroadening === 'starting'
        ? 'starting'
        : basics.puberty_shouldersBroadening === 'broader'
        ? 'clearly'
        : basics.puberty_shouldersBroadening === 'no'
          ? 'no'
          : undefined,
    bodyOdor:
      basics.puberty_bodyOdor === 'little'
        ? 'little'
        : basics.puberty_bodyOdor === 'definitely'
        ? 'definite'
        : basics.puberty_bodyOdor === 'no'
          ? 'none'
          : undefined,
    acne:
      basics.puberty_acneSeverity === 'few'
        ? 'few'
        : basics.puberty_acneSeverity === 'regular'
        ? 'regular'
        : basics.puberty_acneSeverity === 'severe'
        ? 'frequent'
        : basics.puberty_acneSeverity === 'cleared'
        ? 'wentAway'
        : basics.puberty_acneSeverity === 'none'
          ? 'none'
          : undefined,
    muscleDefinition:
      basics.puberty_muscleDefinition === 'little'
        ? 'little'
        : basics.puberty_muscleDefinition === 'clear'
        ? 'clearly'
        : basics.puberty_muscleDefinition === 'no'
          ? 'no'
          : undefined,
    voiceDeepened:
      basics.puberty_voiceDepth === 'somewhat'
        ? 'somewhat'
        : basics.puberty_voiceDepth === 'full'
        ? 'fully'
        : basics.puberty_voiceDepth === 'nochange'
          ? 'noChange'
          : undefined,
    stillGrowing:
      basics.puberty_stillGrowingSlower === 'yes'
        ? 'yesButSlower'
        : basics.puberty_stillGrowingSlower === 'no'
        ? 'no'
        : basics.puberty_stillGrowingSlower === 'slower'
        ? 'yesButSlower'
        : basics.puberty_stillGrowingSlower === 'notgrown'
        ? 'no'
        : basics.puberty_stillGrowingSlower === 'faster'
        ? 'yes'
        : basics.puberty_stillGrowingSlower === 'same'
        ? 'yes'
        : undefined,
  };

  const weightKg = (() => {
    const w = onboarding.weight;
    if (!w) return undefined;
    if (onboarding.units === 'metric') {
      const kg = parseInt(w.split(' ')[0]);
      return isNaN(kg) ? undefined : kg;
    }
    const lb = parseInt(w.split(' ')[0]);
    if (isNaN(lb)) return undefined;
    return Math.round(lb * 0.45359237 * 100) / 100;
  })();

  const reasons = getShortReasons({
    ageYears,
    sex: sex as any,
    selfHeightCm: basics.heightCm,
    weightKg,
    motherHeightCm,
    fatherHeightCm,
    tallRelativesBeyondParents: (onboarding.tallerRelatives || []).length > 0,
    exerciseHoursPerWeek: parseFloat(onboarding.exerciseHoursPerWeek || ''),
    sleepHoursPerNight: parseFloat(onboarding.sleepHoursPerNight || ''),
    sports: undefined as any,
    pubertyQuiz: quiz,
  });

  return reasons;
}

