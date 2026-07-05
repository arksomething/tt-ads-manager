import { type DashboardSearchParams } from "@/server/dashboard/filters";
import { FORMAT_COMPARISON_PROCEEDS_MODEL } from "@/server/dashboard/format-comparison";

import { FormatComparisonLoaderClient } from "./format-comparison-loader-client";

export const dynamic = "force-dynamic";

type FormatComparisonPageProps = {
  params: Promise<{
    organizationSlug: string;
  }>;
  searchParams: Promise<DashboardSearchParams>;
};

function getSearchParamValue(
  searchParams: DashboardSearchParams,
  key: string,
) {
  const value = searchParams[key];
  return Array.isArray(value) ? value[0] : value;
}

function toDateOnlyString(value: Date) {
  return value.toISOString().slice(0, 10);
}

function getDefaultStartDate() {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - 6);
  return toDateOnlyString(date);
}

function getDefaultEndDate() {
  return toDateOnlyString(new Date());
}

function normalizeDateInput(value: string | undefined, fallback: string) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return fallback;
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? fallback : value;
}

function normalizeDateRange(searchParams: DashboardSearchParams) {
  const fallbackStartDate = getDefaultStartDate();
  const fallbackEndDate = getDefaultEndDate();
  const startDate = normalizeDateInput(
    getSearchParamValue(searchParams, "startDate"),
    fallbackStartDate,
  );
  const endDate = normalizeDateInput(
    getSearchParamValue(searchParams, "endDate"),
    fallbackEndDate,
  );

  if (startDate > endDate) {
    return {
      endDate: startDate,
      startDate: endDate,
    };
  }

  return {
    endDate,
    startDate,
  };
}

export default async function FormatComparisonPage({
  params,
  searchParams,
}: FormatComparisonPageProps) {
  const { organizationSlug } = await params;
  const resolvedSearchParams = await searchParams;
  const { startDate, endDate } = normalizeDateRange(resolvedSearchParams);
  const clientSearchParams = {
    ...resolvedSearchParams,
    revenueModel: FORMAT_COMPARISON_PROCEEDS_MODEL,
  };

  return (
    <FormatComparisonLoaderClient
      endDate={endDate}
      organizationSlug={organizationSlug}
      searchParams={clientSearchParams}
      startDate={startDate}
    />
  );
}
