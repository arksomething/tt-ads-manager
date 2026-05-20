import { NextRequest, NextResponse } from "next/server";

import { SchemaUnavailableError } from "@/lib/db";
import { getRevenueProfitabilityData } from "@/server/revenue/revenue-profitability";
import {
  buildSpendReport,
  buildSpendReportFromRevenueProfitability,
} from "@/server/reporting/spend";

import {
  getOrganizationSlug,
  getReportingCacheHeaders,
  getReportingDateRange,
  jsonError,
  loadCanonicalReportingRange,
  reportingRouteError,
  type ReportingRouteContext,
} from "@/app/api/org/[organizationSlug]/reporting/reporting-route-helpers";

function toDashboardSearchParams(searchParams: URLSearchParams) {
  const result: Record<string, string | string[]> = {};

  for (const [key, value] of searchParams.entries()) {
    const existingValue = result[key];

    if (Array.isArray(existingValue)) {
      existingValue.push(value);
    } else if (existingValue) {
      result[key] = [existingValue, value];
    } else {
      result[key] = value;
    }
  }

  return result;
}

async function buildLiveProfitabilitySpendResponse(args: {
  organizationSlug: string;
  range: {
    startDate: string;
    endDate: string;
  };
  request: NextRequest;
  warning: string;
}) {
  const profitability = await getRevenueProfitabilityData({
    endDate: args.range.endDate,
    organizationSlug: args.organizationSlug,
    searchParams: toDashboardSearchParams(args.request.nextUrl.searchParams),
    startDate: args.range.startDate,
  });

  return NextResponse.json(
    buildSpendReportFromRevenueProfitability({
      organizationSlug: args.organizationSlug,
      profitability,
      range: args.range,
      warnings: [args.warning],
    }),
    {
      headers: getReportingCacheHeaders(args.range),
    },
  );
}

export async function GET(request: NextRequest, context: ReportingRouteContext) {
  const range = getReportingDateRange(request.nextUrl.searchParams);

  if (!range) {
    return jsonError("A valid startDate and endDate are required.", 400);
  }

  try {
    const organizationSlug = await getOrganizationSlug(context);
    let reportingData: Awaited<ReturnType<typeof loadCanonicalReportingRange>>;

    try {
      reportingData = await loadCanonicalReportingRange(organizationSlug, range);
    } catch (error) {
      if (!(error instanceof SchemaUnavailableError)) {
        throw error;
      }

      return buildLiveProfitabilitySpendResponse({
        organizationSlug,
        range,
        request,
        warning:
          "Canonical reporting tables are unavailable; spend was computed from live profitability sources.",
      });
    }

    if (
      reportingData.requestedDays.length > 0 &&
      reportingData.missingDays.length === reportingData.requestedDays.length
    ) {
      return buildLiveProfitabilitySpendResponse({
        organizationSlug,
        range,
        request,
        warning:
          "Canonical reporting has not been refreshed for this range; spend was computed from live profitability sources.",
      });
    }

    return NextResponse.json(
      buildSpendReport({
        facts: reportingData.facts,
        freshness: {
          incompleteDays: reportingData.incompleteDays,
          missingDays: reportingData.missingDays,
          staleDays: reportingData.staleDays,
        },
        organizationSlug,
        range,
        warnings: reportingData.warnings,
      }),
      {
        headers: getReportingCacheHeaders(range),
      },
    );
  } catch (error) {
    return reportingRouteError("Canonical spend reporting lookup failed", error);
  }
}
