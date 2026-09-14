import {
    clamp,
    evaluateHeightFromZ,
    evaluateZFromHeight,
    interpolateLmsPoint,
    inverseStandardNormal,
    LMS_PERCENTILE_EPSILON,
    standardNormalCDF,
    type GrowthSexCode,
    type LMSPoint,
} from "./lmsMath";
import boysRaw from "./who-boys.json";
import girlsRaw from "./who-girls.json";

export type WhoSexCode = GrowthSexCode;

interface RawWhoRecord {
  Month: number;
  L: number;
  M: number;
  S: number;
}

const WHO_TABLES: Record<WhoSexCode, LMSPoint[]> = {
  "1": normalizeRawTable(boysRaw as RawWhoRecord[]),
  "2": normalizeRawTable(girlsRaw as RawWhoRecord[]),
};

function normalizeRawTable(raw: RawWhoRecord[]): LMSPoint[] {
  return raw
    .map((row) => ({
      month: row.Month,
      L: row.L,
      M: row.M,
      S: row.S,
    }))
    .sort((a, b) => a.month - b.month);
}

function getInterpolatedLMS(sex: WhoSexCode, ageMonths: number): LMSPoint {
  const table = WHO_TABLES[sex];
  if (!table || table.length === 0) {
    throw new Error(`WHO data not available for sex ${sex}`);
  }

  return interpolateLmsPoint(table, ageMonths);
}

export interface HeightForPercentileInput {
  sex: WhoSexCode;
  ageMonths: number;
  percentile: number;
}

/**
 * Returns the expected height (cm) for a given percentile using WHO LMS tables.
 * Percentile accepts decimals (e.g. 99.5) and is clamped to (0, 100).
 */
export function whoHeightForPercentile({
  sex,
  ageMonths,
  percentile,
}: HeightForPercentileInput): number {
  const normalizedPercentile = clamp(
    percentile / 100,
    LMS_PERCENTILE_EPSILON,
    1 - LMS_PERCENTILE_EPSILON
  );
  const zScore = inverseStandardNormal(normalizedPercentile);
  return whoHeightForZScore({ sex, ageMonths, zScore });
}

export interface HeightForZScoreInput {
  sex: WhoSexCode;
  ageMonths: number;
  zScore: number;
}

/**
 * Returns the height (cm) for a supplied z-score using WHO LMS tables.
 */
export function whoHeightForZScore({
  sex,
  ageMonths,
  zScore,
}: HeightForZScoreInput): number {
  const params = getInterpolatedLMS(sex, ageMonths);
  return evaluateHeightFromZ(params, zScore);
}

export interface PercentileForHeightInput {
  sex: WhoSexCode;
  ageMonths: number;
  heightCm: number;
}

/**
 * Returns the percentile (0-100) corresponding to a given height in cm.
 */
export function whoPercentileForHeight({
  sex,
  ageMonths,
  heightCm,
}: PercentileForHeightInput): number {
  const params = getInterpolatedLMS(sex, ageMonths);
  const zScore = evaluateZFromHeight(params, heightCm);
  return clamp(standardNormalCDF(zScore) * 100, 0, 100);
}

/**
 * Convenience helper returning the min/max month available in the WHO dataset.
 */
export function getAvailableMonthRange(
  sex: WhoSexCode
): { min: number; max: number } {
  const table = WHO_TABLES[sex];
  if (!table || table.length === 0) {
    throw new Error(`WHO data not available for sex ${sex}`);
  }

  return { min: table[0].month, max: table[table.length - 1].month };
}