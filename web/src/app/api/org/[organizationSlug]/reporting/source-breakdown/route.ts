import { NextRequest, NextResponse } from "next/server";

import {
  buildSourceBreakdownResponse,
  getOrganizationSlug,
  getReportingDateRange,
  jsonError,
  loadCanonicalReportingRange,
  REPORTING_CACHE_HEADERS,
  reportingRouteError,
  type ReportingRouteContext,
} from "../reporting-route-helpers";

export async function GET(request: NextRequest, context: ReportingRouteContext) {
  const range = getReportingDateRange(request.nextUrl.searchParams);

  if (!range) {
    return jsonError("A valid startDate and endDate are required.", 400);
  }

  try {
    const organizationSlug = await getOrganizationSlug(context);
    const reportingData = await loadCanonicalReportingRange(organizationSlug, range);

    return NextResponse.json(buildSourceBreakdownResponse(reportingData), {
      headers: REPORTING_CACHE_HEADERS,
    });
  } catch (error) {
    return reportingRouteError(
      "Canonical reporting source breakdown lookup failed",
      error,
    );
  }
}
