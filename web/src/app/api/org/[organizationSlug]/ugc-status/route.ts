import { NextRequest, NextResponse } from "next/server";

import { getDateRangeCacheHeaders } from "@/lib/cache-control";
import { getOrganizationDashboardLayoutData } from "@/server/dashboard/org-shell";
import { type DashboardSearchParams } from "@/server/dashboard/filters";
import { getUgcStatusData } from "@/server/dashboard/ugc-status";

type RouteContext = {
  params: Promise<unknown>;
};

function toDashboardSearchParams(searchParams: URLSearchParams) {
  const result: DashboardSearchParams = {};

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

async function getOrganizationSlug(context: RouteContext) {
  const params = await context.params;

  if (
    typeof params === "object" &&
    params !== null &&
    "organizationSlug" in params &&
    typeof params.organizationSlug === "string"
  ) {
    return params.organizationSlug;
  }

  throw new Error("Organization slug is missing.");
}

export async function GET(request: NextRequest, context: RouteContext) {
  const organizationSlug = await getOrganizationSlug(context);
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
    await getOrganizationDashboardLayoutData(organizationSlug);

    const data = await getUgcStatusData({
      endDate,
      organizationSlug,
      searchParams: toDashboardSearchParams(request.nextUrl.searchParams),
      startDate,
    });

    return NextResponse.json(data, {
      headers: getDateRangeCacheHeaders({ endDate, startDate }),
    });
  } catch (error) {
    console.error("UGC status lookup failed", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not load UGC status data right now.",
      },
      { status: 500 },
    );
  }
}
