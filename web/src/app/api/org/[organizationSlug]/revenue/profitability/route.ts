import { NextRequest, NextResponse } from "next/server";

import { canAccessDashboardSection } from "@/components/org-dashboard/mock-data";
import { getDateRangeCacheHeaders } from "@/lib/cache-control";
import { requireOrganizationMembership } from "@/server/auth/organizations";
import { getRevenueProfitabilityData } from "@/server/revenue/revenue-profitability";

type RouteContext = {
  params: Promise<{
    organizationSlug: string;
  }>;
};

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

function getDateParam(searchParams: URLSearchParams, key: string) {
  const value = searchParams.get(key);
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

export async function GET(request: NextRequest, context: RouteContext) {
  const { organizationSlug } = await context.params;
  const membership = await requireOrganizationMembership(organizationSlug);

  if (!canAccessDashboardSection(membership.role, "revenue")) {
    return NextResponse.json(
      {
        error: "You do not have access to this revenue report.",
      },
      { status: 403 },
    );
  }

  const startDate = getDateParam(request.nextUrl.searchParams, "startDate");
  const endDate = getDateParam(request.nextUrl.searchParams, "endDate");

  if (!startDate || !endDate) {
    return NextResponse.json(
      {
        error: "A valid startDate and endDate are required.",
      },
      { status: 400 },
    );
  }

  try {
    const data = await getRevenueProfitabilityData({
      endDate,
      organizationSlug,
      searchParams: toDashboardSearchParams(request.nextUrl.searchParams),
      startDate,
    });

    return NextResponse.json(data, {
      headers: getDateRangeCacheHeaders({ endDate, startDate }),
    });
  } catch (error) {
    console.error("Revenue profitability lookup failed", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not load profitability data right now.",
      },
      { status: 500 },
    );
  }
}
