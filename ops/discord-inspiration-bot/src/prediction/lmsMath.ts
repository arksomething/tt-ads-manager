export type GrowthSexCode = "1" | "2";

export interface LMSPoint {
  month: number;
  L: number;
  M: number;
  S: number;
}

export const LMS_PERCENTILE_EPSILON = 1e-12;
export const LMS_L_TOLERANCE = 1e-9;

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

const PROBIT_COEFF_A = [
  -3.969683028665376e1,
  2.209460984245205e2,
  -2.759285104469687e2,
  1.38357751867269e2,
  -3.066479806614716e1,
  2.506628277459239,
] as const;

const PROBIT_COEFF_B = [
  -5.447609879822406e1,
  1.615858368580409e2,
  -1.556989798598866e2,
  6.680131188771972e1,
  -1.328068155288572e1,
] as const;

const PROBIT_COEFF_C = [
  -7.784894002430293e-3,
  -3.223964580411365e-1,
  -2.400758277161838,
  -2.549732539343734,
  4.374664141464968,
  2.938163982698783,
] as const;

const PROBIT_COEFF_D = [
  7.784695709041462e-3,
  3.224671290700398e-1,
  2.445134137142996,
  3.754408661907416,
] as const;

const PROBIT_TAIL_CUTOFF = 0.02425;

function erf(x: number): number {
  const sign = Math.sign(x);
  const absX = Math.abs(x);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const t = 1 / (1 + p * absX);
  const y =
    1 -
    (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t) *
      Math.exp(-absX * absX);
  return sign * y;
}

export function standardNormalCDF(z: number): number {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

export function inverseStandardNormal(p: number): number {
  if (p <= 0 || p >= 1) {
    throw new RangeError(
      `Probability must be between 0 and 1 (exclusive). Received ${p}`
    );
  }

  if (p < PROBIT_TAIL_CUTOFF) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (
      (((((PROBIT_COEFF_C[0] * q + PROBIT_COEFF_C[1]) * q + PROBIT_COEFF_C[2]) *
        q +
        PROBIT_COEFF_C[3]) *
        q +
        PROBIT_COEFF_C[4]) *
        q +
        PROBIT_COEFF_C[5]) /
      ((((PROBIT_COEFF_D[0] * q + PROBIT_COEFF_D[1]) * q + PROBIT_COEFF_D[2]) *
        q +
        PROBIT_COEFF_D[3]) *
        q +
        1)
    );
  }

  if (p > 1 - PROBIT_TAIL_CUTOFF) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return (
      -(((((PROBIT_COEFF_C[0] * q + PROBIT_COEFF_C[1]) * q +
        PROBIT_COEFF_C[2]) *
        q +
        PROBIT_COEFF_C[3]) *
        q +
        PROBIT_COEFF_C[4]) *
        q +
        PROBIT_COEFF_C[5]) /
      ((((PROBIT_COEFF_D[0] * q + PROBIT_COEFF_D[1]) * q + PROBIT_COEFF_D[2]) *
        q +
        PROBIT_COEFF_D[3]) *
        q +
        1)
    );
  }

  const q = p - 0.5;
  const r = q * q;

  return (
    (((((PROBIT_COEFF_A[0] * r + PROBIT_COEFF_A[1]) * r + PROBIT_COEFF_A[2]) *
      r +
      PROBIT_COEFF_A[3]) *
      r +
      PROBIT_COEFF_A[4]) *
      r +
      PROBIT_COEFF_A[5]) *
      q /
    (((((PROBIT_COEFF_B[0] * r + PROBIT_COEFF_B[1]) * r + PROBIT_COEFF_B[2]) *
      r +
      PROBIT_COEFF_B[3]) *
      r +
      PROBIT_COEFF_B[4]) *
      r +
      1)
  );
}

type LMSLike = Pick<LMSPoint, "L" | "M" | "S">;

export function evaluateHeightFromZ(
  params: LMSLike,
  zScore: number
): number {
  const { L, M, S } = params;

  if (Math.abs(L) < LMS_L_TOLERANCE) {
    return M * Math.exp(S * zScore);
  }

  const inner = 1 + L * S * zScore;
  if (inner <= 0) {
    return Math.max(Number.MIN_VALUE, M * Math.exp(S * zScore));
  }

  return M * Math.pow(inner, 1 / L);
}

export function evaluateZFromHeight(
  params: LMSLike,
  heightCm: number
): number {
  const { L, M, S } = params;

  if (heightCm <= 0) {
    throw new RangeError("Height must be positive.");
  }

  if (Math.abs(L) < LMS_L_TOLERANCE) {
    return Math.log(heightCm / M) / S;
  }

  return (Math.pow(heightCm / M, L) - 1) / (L * S);
}

export function interpolateLmsPoint(
  table: readonly LMSPoint[],
  ageMonths: number
): LMSPoint {
  if (!table.length) {
    throw new Error("LMS table is empty.");
  }

  const first = table[0];
  const last = table[table.length - 1];

  if (ageMonths <= first.month) {
    return first;
  }

  if (ageMonths >= last.month) {
    return last;
  }

  let low = 0;
  let high = table.length - 1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const midMonth = table[mid].month;

    if (midMonth === ageMonths) {
      return table[mid];
    }

    if (midMonth < ageMonths) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  const upperIndex = clamp(low, 1, table.length - 1);
  const lowerIndex = upperIndex - 1;

  const lower = table[lowerIndex];
  const upper = table[upperIndex];
  const span = upper.month - lower.month || 1;
  const t = clamp((ageMonths - lower.month) / span, 0, 1);

  return {
    month: ageMonths,
    L: lerp(lower.L, upper.L, t),
    M: lerp(lower.M, upper.M, t),
    S: lerp(lower.S, upper.S, t),
  };
}

