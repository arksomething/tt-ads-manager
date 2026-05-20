import { getFacelessCostAmount } from "../viewsbase/faceless-calculations.ts";

export const UGC_MANAGER_MONTHLY_AMOUNT = 1_000;

export type FacelessCostBreakdown = {
  baseSpend: number;
  managementSpend: number;
  totalSpend: number;
};

type FacelessDailyCostRowLike = {
  baseProjectedSpend?: unknown;
  baseTotalSpend?: unknown;
  projectedSpend?: unknown;
  totalSpend?: unknown;
};

type FacelessReportLike = {
  dailyRows: FacelessDailyCostRowLike[];
  totals: {
    managementFee?: unknown;
    projectedSpend?: unknown;
    totalSpend?: unknown;
  };
};

function roundCurrency(value: number) {
  return Math.round(value * 100) / 100;
}

function toFiniteNumber(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
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

export function getMonthlyCostDailyAmount(date: string, monthlyAmount: number) {
  return roundCurrency(monthlyAmount / getDaysInUtcMonth(date));
}

export function getUgcManagementDailyCost(date: string) {
  return getMonthlyCostDailyAmount(date, UGC_MANAGER_MONTHLY_AMOUNT);
}

export function getUgcManagementCostForDates(dates: readonly string[]) {
  return roundCurrency(
    dates.reduce((total, date) => total + getUgcManagementDailyCost(date), 0),
  );
}

export function getFacelessDailyCostBreakdown(
  row: FacelessDailyCostRowLike,
): FacelessCostBreakdown {
  const totalSpend = toFiniteNumber(row.totalSpend);
  const projectedSpend = toFiniteNumber(row.projectedSpend);
  const useProjectedSpend = projectedSpend > totalSpend;
  const selectedSpend = roundCurrency(
    useProjectedSpend ? projectedSpend : totalSpend,
  );
  const selectedBaseSpend = roundCurrency(
    useProjectedSpend
      ? toFiniteNumber(row.baseProjectedSpend)
      : toFiniteNumber(row.baseTotalSpend),
  );
  const managementSpend = roundCurrency(
    Math.max(selectedSpend - selectedBaseSpend, 0),
  );

  return {
    baseSpend: roundCurrency(Math.max(selectedSpend - managementSpend, 0)),
    managementSpend,
    totalSpend: selectedSpend,
  };
}

export function getFacelessCostBreakdown(
  report: FacelessReportLike | null,
): FacelessCostBreakdown {
  if (!report) {
    return {
      baseSpend: 0,
      managementSpend: 0,
      totalSpend: 0,
    };
  }

  if (report.dailyRows.length > 0) {
    return report.dailyRows.reduce<FacelessCostBreakdown>(
      (total, row) => {
        const daily = getFacelessDailyCostBreakdown(row);

        return {
          baseSpend: roundCurrency(total.baseSpend + daily.baseSpend),
          managementSpend: roundCurrency(
            total.managementSpend + daily.managementSpend,
          ),
          totalSpend: roundCurrency(total.totalSpend + daily.totalSpend),
        };
      },
      {
        baseSpend: 0,
        managementSpend: 0,
        totalSpend: 0,
      },
    );
  }

  const totalSpend = getFacelessCostAmount({
    projectedSpend: toFiniteNumber(report.totals.projectedSpend),
    totalSpend: toFiniteNumber(report.totals.totalSpend),
  });
  const managementSpend = roundCurrency(
    Math.min(toFiniteNumber(report.totals.managementFee), totalSpend),
  );

  return {
    baseSpend: roundCurrency(Math.max(totalSpend - managementSpend, 0)),
    managementSpend,
    totalSpend,
  };
}
