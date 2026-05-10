import { NextRequest, NextResponse } from "next/server";

import {
  buildDailyResponse,
  getOrganizationSlug,
  getReportingDateRange,
  getReportingCacheHeaders,
  jsonError,
  loadCanonicalReportingRange,
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

    return NextResponse.json(buildDailyResponse(reportingData), {
      headers: getReportingCacheHeaders(range),
    });
  } catch (error) {
    return reportingRouteError("Canonical reporting daily lookup failed", error);
  }
}
