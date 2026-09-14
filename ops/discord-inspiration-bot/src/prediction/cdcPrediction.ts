import cdcRaw from "./data.json";
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

export type CdcSexCode = GrowthSexCode;

interface RawCdcRecord {
  Sex: string;
  Agemos: string;
  L: string;
  M: string;
  S: string;
}

const CDC_TABLES: Record<CdcSexCode, LMSPoint[]> = {
  "1": normalizeCdcTable("1"),
  "2": normalizeCdcTable("2"),
};

function normalizeCdcTable(sex: CdcSexCode): LMSPoint[] {
  return (cdcRaw as RawCdcRecord[])
    .filter((row) => row.Sex === sex)
    .map((row) => ({
      month: Number(row.Agemos),
      L: Number(row.L),
      M: Number(row.M),
      S: Number(row.S),
    }))
    .filter(
      (row) =>
        Number.isFinite(row.month) &&
        Number.isFinite(row.L) &&
        Number.isFinite(row.M) &&
        Number.isFinite(row.S)
    )
    .sort((a, b) => a.month - b.month);
}

function getCdcLmsPoint(sex: CdcSexCode, ageMonths: number): LMSPoint {
  const table = CDC_TABLES[sex];
  if (!table || table.length === 0) {
    throw new Error(`CDC data not available for sex ${sex}`);
  }

  return interpolateLmsPoint(table, ageMonths);
}

export interface CdcHeightForPercentileInput {
  sex: CdcSexCode;
  ageMonths: number;
  percentile: number;
}

/**
 * Returns the expected height (cm) for a given percentile using CDC LMS tables.
 * Percentile accepts decimals (e.g. 99.5) and is clamped to (0, 100).
 */
export function cdcHeightForPercentile({
  sex,
  ageMonths,
  percentile,
}: CdcHeightForPercentileInput): number {
  const normalizedPercentile = clamp(
    percentile / 100,
    LMS_PERCENTILE_EPSILON,
    1 - LMS_PERCENTILE_EPSILON
  );
  const zScore = inverseStandardNormal(normalizedPercentile);
  return cdcHeightForZScore({ sex, ageMonths, zScore });
}

export interface CdcHeightForZScoreInput {
  sex: CdcSexCode;
  ageMonths: number;
  zScore: number;
}

/**
 * Returns the height (cm) for a supplied z-score using CDC LMS tables.
 */
export function cdcHeightForZScore({
  sex,
  ageMonths,
  zScore,
}: CdcHeightForZScoreInput): number {
  const params = getCdcLmsPoint(sex, ageMonths);
  return evaluateHeightFromZ(params, zScore);
}

export interface CdcPercentileForHeightInput {
  sex: CdcSexCode;
  ageMonths: number;
  heightCm: number;
}

/**
 * Returns the percentile (0-100) corresponding to a given height in cm
 * using the CDC LMS curves.
 */
export function cdcPercentileForHeight({
  sex,
  ageMonths,
  heightCm,
}: CdcPercentileForHeightInput): number {
  const params = getCdcLmsPoint(sex, ageMonths);
  const zScore = evaluateZFromHeight(params, heightCm);
  return clamp(standardNormalCDF(zScore) * 100, 0, 100);
}

/**
 * Convenience helper returning the min/max month available in the CDC dataset.
 */
export function getCdcMonthRange(
  sex: CdcSexCode
): { min: number; max: number } {
  const table = CDC_TABLES[sex];
  if (!table || table.length === 0) {
    throw new Error(`CDC data not available for sex ${sex}`);
  }

  return { min: table[0].month, max: table[table.length - 1].month };
}

