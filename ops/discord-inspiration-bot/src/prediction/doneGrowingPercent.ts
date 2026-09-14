export const DEFAULT_GROWTH_END_AGE_YEARS = 21;

/**
 * Returns "done growing" percent as used on the Home tab (age-based).
 * The current product heuristic assumes growth completes by ~21 years old.
 */
export function getDoneGrowingPercentFromAgeYears(
  ageYears: number,
  endAgeYears: number = DEFAULT_GROWTH_END_AGE_YEARS
): number {
  if (!Number.isFinite(ageYears) || ageYears <= 0) return 0;
  if (!Number.isFinite(endAgeYears) || endAgeYears <= 0) return 0;

  const yearsRounded = Math.floor(ageYears);
  const pct = Math.round((yearsRounded / endAgeYears) * 100);
  return Math.max(0, Math.min(100, pct));
}

