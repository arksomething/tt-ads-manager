import { NextRequest, NextResponse } from "next/server";

import { refreshCanonicalReporting } from "@/server/reporting/persistence";

import {
  getReportingDateRange,
  getOrganizationSlug,
  jsonError,
  reportingRouteError,
  type ReportingRouteContext,
} from "../reporting-route-helpers";

export async function POST(request: NextRequest, context: ReportingRouteContext) {
  try {
    const organizationSlug = await getOrganizationSlug(context);
    const payload = await readJsonBody(request);
    const range =
      getDateRangeFromPayload(payload) ??
      getReportingDateRange(request.nextUrl.searchParams);

    if (!range) {
      return jsonError("A valid startDate and endDate are required.", 400);
    }

    const result = await refreshCanonicalReporting({
      endDate: range.endDate,
      organizationSlug,
      searchParams: getSearchParamsFromPayload(payload),
      startDate: range.startDate,
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof SyntaxError) {
      return jsonError("Refresh payload must be valid JSON.", 400);
    }

    return reportingRouteError("Canonical reporting refresh failed", error);
  }
}

async function readJsonBody(request: NextRequest) {
  const text = await request.text();

  if (!text.trim()) {
    return null;
  }

  return JSON.parse(text) as unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getDateRangeFromPayload(payload: unknown) {
  if (!isRecord(payload)) {
    return null;
  }

  const { startDate, endDate } = payload;

  if (
    typeof startDate === "string" &&
    typeof endDate === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(startDate) &&
    /^\d{4}-\d{2}-\d{2}$/.test(endDate) &&
    startDate <= endDate
  ) {
    return {
      startDate,
      endDate,
    };
  }

  return null;
}

function getSearchParamsFromPayload(payload: unknown) {
  if (!isRecord(payload) || !isRecord(payload.searchParams)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(payload.searchParams).filter(
      (entry): entry is [string, string | string[]] =>
        typeof entry[1] === "string" ||
        (Array.isArray(entry[1]) &&
          entry[1].every((value) => typeof value === "string")),
    ),
  );
}
