const SUPERWALL_REVENUE_FEE_RATE = 0.01;

export const MONTHLY_OPERATING_COSTS = [
  {
    key: "office",
    label: "Office",
    monthlyAmount: 1_900,
  },
  {
    key: "superwall",
    label: "Superwall",
    monthlyAmount: 200,
  },
  {
    key: "singular",
    label: "Singular",
    monthlyAmount: 1_000,
  },
  {
    key: "misc",
    label: "Bullshit",
    monthlyAmount: 1_000,
  },
] as const;

export type OperatingCostDailyRow = {
  date: string;
  total: number;
  costs: Array<{
    key: string;
    label: string;
    amount: number;
  }>;
};

function roundCurrency(value: number) {
  return Math.round(value * 100) / 100;
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

function getMonthlyCostDailyAmount(date: string, monthlyAmount: number) {
  return monthlyAmount / getDaysInUtcMonth(date);
}

export function getOperatingCostDailyBreakdown(args: {
  date: string;
  proceeds: number;
}): OperatingCostDailyRow {
  const fixedRows = MONTHLY_OPERATING_COSTS.map((cost) => ({
    ...cost,
    amount: getMonthlyCostDailyAmount(args.date, cost.monthlyAmount),
  }));
  const superwallRevenueFee = args.proceeds * SUPERWALL_REVENUE_FEE_RATE;
  const rows = fixedRows.map((row) =>
    row.key === "superwall"
      ? {
          ...row,
          amount: row.amount + superwallRevenueFee,
        }
      : row,
  );

  return {
    costs: rows.map((row) => ({
      amount: roundCurrency(row.amount),
      key: row.key,
      label: row.label,
    })),
    date: args.date,
    total: roundCurrency(rows.reduce((total, row) => total + row.amount, 0)),
  };
}

export function getOperatingCostRows(
  dailyRows: ReadonlyArray<{
    date: string;
    proceeds: number;
  }>,
) {
  const spendByKey = new Map<string, number>();

  for (const row of dailyRows) {
    for (const cost of getOperatingCostDailyBreakdown(row).costs) {
      spendByKey.set(cost.key, (spendByKey.get(cost.key) ?? 0) + cost.amount);
    }
  }

  return MONTHLY_OPERATING_COSTS.map((cost) => ({
    cost,
    spend: roundCurrency(spendByKey.get(cost.key) ?? 0),
  }));
}
