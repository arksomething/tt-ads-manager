import { NextRequest, NextResponse } from "next/server";

import { getRevenueProfitabilityData } from "@/server/adapty/revenue-profitability";

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
      headers: {
        "Cache-Control": "private, max-age=30, stale-while-revalidate=300",
      },
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
