import {
    createHeightMeasurementFromCm,
    formatHeight as formatHeightMeasurement,
} from "./heightMeasurement";
import { calculateHeightProjection } from "./heightProjection";
import type { PubertyAnswers } from "./pubertyModel";

/* --------------------------------------------------------------------------
 * Constants & helpers
 * --------------------------------------------------------------------------*/

const MALE_REMAINING_CM_TABLE = [
  [6, 35],
  [8, 30],
  [10, 25],
  [12, 22],
  [14, 15],
  [15, 12],
  [16, 8],
  [17, 5],
  [18, 2],
  [19, 0.5],
] as const;

const FEMALE_REMAINING_CM_TABLE = [
  [6, 30],
  [8, 25],
  [10, 20],
  [11, 17],
  [12, 13],
  [13, 9],
  [14, 6],
  [15, 3],
  [16, 1],
  [17, 0.3],
] as const;

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

/** Logistic drop-off: returns value 0-100 */
const logistic = (x: number, steep: number, mid: number) => 100 / (1 + Math.exp(steep * (x - mid)));

export interface DreamHeightData {
  dreamHeightCm: number;
  currentHeightCm: number;
  age: number;
  sex: "1" | "2";
  motherHeightCm?: number;
  fatherHeightCm?: number;
  weightKg?: number;
  sleepHoursPerNight?: number;
  exerciseHoursPerWeek?: number;
  measuredGrowthVelocityCmPerYear?: number;
  puberty?: PubertyAnswers;
}

export interface ProbabilityResult {
  probability: number;
  probabilityText: string;
  dreamHeightFormatted: string;
  heightDifference: number;
  heightDifferenceFormatted: string;
}

export function calculateDreamHeightProbability(data: DreamHeightData): ProbabilityResult {
  const {
    dreamHeightCm,
    currentHeightCm,
    age,
    sex,
    motherHeightCm,
    fatherHeightCm,
    weightKg,
    sleepHoursPerNight,
    exerciseHoursPerWeek,
    measuredGrowthVelocityCmPerYear,
    puberty,
  } = data;
  
  // Calculate height difference
  const heightDifference = dreamHeightCm - currentHeightCm;
  const heightDifferenceFormatted = formatHeightDifference(heightDifference);
  
  // Format dream height for display
  const dreamHeightFormatted = formatHeight(dreamHeightCm);
  
  // Calculate probability based on various factors
  let probability = calculateBaseProbability({
    heightDifference,
    age,
    sex,
    motherHeightCm,
    fatherHeightCm,
    weightKg,
    sleepHoursPerNight,
    exerciseHoursPerWeek,
    measuredGrowthVelocityCmPerYear,
    dreamHeightCm,
    currentHeightCm,
    puberty,
  });
  
  // Guard against NaN or infinite
  if (!isFinite(probability)) {
    probability = 5;
  }

  // Round to one decimal place
  probability = Math.round(probability * 10) / 10;

  // Ensure probability is within 5-100 % range
  probability = Math.max(5, Math.min(100, probability));
  
  const probabilityText = formatProbabilityText(probability);
  
  return {
    probability,
    probabilityText,
    dreamHeightFormatted,
    heightDifference,
    heightDifferenceFormatted
  };
}

interface BaseProbabilityArgs {
  heightDifference: number;
  age: number;
  sex: "1" | "2";
  motherHeightCm?: number;
  fatherHeightCm?: number;
  weightKg?: number;
  sleepHoursPerNight?: number;
  exerciseHoursPerWeek?: number;
  measuredGrowthVelocityCmPerYear?: number;
  dreamHeightCm: number;
  currentHeightCm: number;
  puberty?: PubertyAnswers;
}

function calculateBaseProbability({
  heightDifference,
  age,
  sex,
  motherHeightCm,
  fatherHeightCm,
  weightKg,
  sleepHoursPerNight,
  exerciseHoursPerWeek,
  measuredGrowthVelocityCmPerYear,
  dreamHeightCm,
  currentHeightCm,
  puberty,
}: BaseProbabilityArgs): number {
  // If dream height already achieved, certainty is 100%
  if (heightDifference <= 0) {
    return 100;
  }

  //////////////////////////////////////////////////////////////
  // New approach: centre odds on PROJECTED POTENTIAL height  //
  //////////////////////////////////////////////////////////////

  // 1. Compute projected potential adult height using the same util used in UI
  let projectedPotentialCm: number | null = null;
  try {
    const projection = calculateHeightProjection({
      heightCm: currentHeightCm,
      age,
      sex,
      motherHeightCm,
      fatherHeightCm,
      weightKg,
      sleepHoursPerNight,
      exerciseHoursPerWeek,
      measuredGrowthVelocityCmPerYear,
      puberty,
    });

    projectedPotentialCm = projection.potential.cm;
  } catch (e) {
    // Fallback: estimate remaining growth potential if projection failed
    projectedPotentialCm = null;
  }

  let probability: number;

  /* ---------- Primary branch: we have a projected potential height ---------- */
  if (projectedPotentialCm) {
    const diffFromPotential = dreamHeightCm - projectedPotentialCm; // cm (may be negative)

    if (diffFromPotential <= 0) {
      // Dream height is at or below projected potential – high odds
      probability = 90;
    } else {
      /*
        Use a logistic curve centred at 0 cm (dream == potential → 50-60 %)
        and dropping towards 5 % when dream is >12 cm over potential.
      */
      probability = logistic(diffFromPotential, 0.4, 0); // centred at 0 cm
    }
  }
  /* ---------- Fallback branch: no projection available ---------- */
  else {
    // Fallback to previous remaining-growth model if projection failed
    const remainingPotentialCm = getRemainingGrowthPotentialCm(age, sex);

    if (remainingPotentialCm < 0.5) return 5;
    const ratio = heightDifference / remainingPotentialCm;
    probability = logistic(ratio, 8, 0.6);
  }

  // Clamp reasonable bounds
  probability = clamp(probability, 5, 95);

  // Adjust for genetics if we have parental heights
  if (motherHeightCm && fatherHeightCm) {
    const midparentalHeight =
      sex === "1"
        ? (fatherHeightCm + motherHeightCm + 13) / 2
        : (fatherHeightCm + motherHeightCm - 13) / 2;

    const geneticGap = dreamHeightCm - midparentalHeight;

    // If dream height within 2 cm of mid-parental, small boost
    if (geneticGap <= 2) probability += 5;

    // If dream height > mid-parental by >10 cm, penalise
    if (geneticGap > 10) probability -= 15;
  }

  // Small sex-related tweak (boys have slightly longer growth window)
  if (sex === "1") probability += 3;

  return probability;
}

function getRemainingGrowthPotentialCm(age: number, sex: "1" | "2"): number {
  // Approximate average remaining growth based on CDC growth curves (very rough)
  const table = sex === "1" ? MALE_REMAINING_CM_TABLE : FEMALE_REMAINING_CM_TABLE;

  // Find the first entry older than the user and interpolate linearly
  for (let i = 0; i < table.length - 1; i++) {
    const [ageA, cmA] = table[i];
    const [ageB, cmB] = table[i + 1];
    if (age >= ageA && age < ageB) {
      const t = (age - ageA) / (ageB - ageA);
      return cmA + (cmB - cmA) * t;
    }
  }

  // If age younger than first entry, use first value; if older than last, use last
  if (age < table[0][0]) return table[0][1];
  return table[table.length - 1][1];
}

function formatHeight(heightCm: number): string {
  const measurement = createHeightMeasurementFromCm(heightCm);
  return formatHeightMeasurement(measurement, {
    unit: "ft",
    precision: 0,
    stripInchSymbol: false,
  });
}

function formatHeightDifference(differenceCm: number): string {
  if (differenceCm <= 0) {
    return "";
  }

  const measurement = createHeightMeasurementFromCm(differenceCm);
  const feet = measurement.feet;
  const inches = Math.round(measurement.inchesRemainder);

  if (feet === 0) {
    return `${inches}"`;
  }

  if (inches === 0) {
    return `${feet}'`;
  }

  return `${feet}'${inches}"`;
}

function formatProbabilityText(probability: number): string {
  // Return an empty bucket so UI can supply localized strings
  if (probability >= 90) return "prob_very_high";
  if (probability >= 75) return "prob_high";
  if (probability >= 50) return "prob_moderate";
  if (probability >= 25) return "prob_low";
  return "prob_very_low";
}