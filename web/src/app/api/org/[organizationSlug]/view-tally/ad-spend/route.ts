import { NextRequest, NextResponse } from "next/server";

import { getDateRangeCacheHeaders } from "@/lib/cache-control";
import {
  getOrganizationViewTallyAdSpendData,
  type OrganizationViewTallyAdSpendData,
} from "@/server/videos/queries";

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

export async function GET(
  request: NextRequest,
  context: {
    params: Promise<{
      organizationSlug: string;
    }>;
  },
) {
  const { organizationSlug } = await context.params;

  try {
    const data: OrganizationViewTallyAdSpendData = await getOrganizationViewTallyAdSpendData({
      organizationSlug,
      searchParams: toDashboardSearchParams(request.nextUrl.searchParams),
    });

    return NextResponse.json(data, {
      headers: getDateRangeCacheHeaders({
        endDate: request.nextUrl.searchParams.get("endDate"),
        missingDateIncludesToday: true,
        startDate: request.nextUrl.searchParams.get("startDate"),
      }),
    });
  } catch (error) {
    console.error("View Tally ad spend lookup failed", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not load TikTok ad spend right now.",
      },
      { status: 500 },
    );
  }
}
