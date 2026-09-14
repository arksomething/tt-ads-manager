export type MidParentalSexCode = "1" | "2";

export function calculateMidParentalHeightCm(params: {
  sex: MidParentalSexCode;
  motherHeightCm?: number;
  fatherHeightCm?: number;
}): number | null {
  if (
    !Number.isFinite(params.motherHeightCm) ||
    !Number.isFinite(params.fatherHeightCm)
  ) {
    return null;
  }

  const motherHeightCm = params.motherHeightCm as number;
  const fatherHeightCm = params.fatherHeightCm as number;

  return params.sex === "1"
    ? (fatherHeightCm + motherHeightCm + 13) / 2
    : (fatherHeightCm + motherHeightCm - 13) / 2;
}
