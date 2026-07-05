export const BLAZIE_FIXED_COST_MONTHLY_AMOUNT = 15_000;

export type BlazieProfitabilityMetricInputs = {
  fixedCost: number;
  videoRevenue: number;
  videoSpend: number;
};

function roundCurrency(value: number) {
  return Math.round(value * 100) / 100;
}

function normalizeCurrencyInput(value: number) {
  return Number.isFinite(value) ? roundCurrency(Math.max(value, 0)) : 0;
}

function getDaysInUtcMonth(date: string) {
  const parsed = new Date(`${date}T00:00:00.000Z`);

  if (Number.isNaN(parsed.getTime())) {
    return 30;
  }

  return new Date(
    Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth() + 1, 0),
  ).getUTCDate();
}

function getInclusiveDateKeys(startDate: string, endDate: string) {
  const keys: string[] = [];
  const cursor = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);

  if (Number.isNaN(cursor.getTime()) || Number.isNaN(end.getTime())) {
    return keys;
  }

  while (cursor <= end) {
    keys.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return keys;
}

export function getBlazieFixedCostTarget(startDate: string, endDate: string) {
  return roundCurrency(
    getInclusiveDateKeys(startDate, endDate).reduce(
      (total, date) =>
        total + BLAZIE_FIXED_COST_MONTHLY_AMOUNT / getDaysInUtcMonth(date),
      0,
    ),
  );
}

export function calculateBlazieProfitabilityMetrics(
  inputs: BlazieProfitabilityMetricInputs,
) {
  const fixedCost = normalizeCurrencyInput(inputs.fixedCost);
  const videoRevenue = normalizeCurrencyInput(inputs.videoRevenue);
  const videoSpend = normalizeCurrencyInput(inputs.videoSpend);
  const totalCost = roundCurrency(videoSpend + fixedCost);

  return {
    fixedCost,
    profitLoss: roundCurrency(videoRevenue - totalCost),
    roas: videoSpend > 0 ? videoRevenue / videoSpend : null,
    totalCost,
    videoRevenue,
    videoSpend,
  };
}

export function hasPendingBlazieOrganicProceeds(args: {
  proceeds: number;
  warnings: readonly string[];
}) {
  return args.warnings.some((warning) => {
    const normalizedWarning = warning.toLowerCase();

    return (
      normalizedWarning.includes("organic / ugc proceeds are hidden") ||
      normalizedWarning.includes("source split is still preparing") ||
      normalizedWarning.includes("singular source proceeds are not ready") ||
      (normalizedWarning.includes("singular returned source rows") &&
        normalizedWarning.includes("revenue is not ready")) ||
      (normalizedWarning.includes("source proceeds report") &&
        (normalizedWarning.includes("still preparing") ||
          normalizedWarning.includes("status is")))
    );
  });
}
