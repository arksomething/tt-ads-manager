import { NextRequest } from "next/server";

import {
  FORMAT_COMPARISON_PROCEEDS_MODEL,
  getFormatComparisonData,
  type FormatComparisonTraceEvent,
} from "@/server/dashboard/format-comparison";
import { type DashboardSearchParams } from "@/server/dashboard/filters";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<unknown>;
};

function getOrganizationSlugFromParams(params: unknown) {
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

function toDashboardSearchParams(
  searchParams: URLSearchParams,
): DashboardSearchParams {
  const result: DashboardSearchParams = {};

  for (const [key, value] of searchParams.entries()) {
    const existing = result[key];

    if (existing === undefined) {
      result[key] = value;
    } else if (Array.isArray(existing)) {
      result[key] = [...existing, value];
    } else {
      result[key] = [existing, value];
    }
  }

  result.revenueModel = FORMAT_COMPARISON_PROCEEDS_MODEL;
  return result;
}

function getDateParam(searchParams: URLSearchParams, key: string) {
  const value = searchParams.get(key);

  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${key} is required.`);
  }

  return value;
}

function serializeStreamEvent(value: unknown) {
  return `${JSON.stringify(value)}\n`;
}

export async function GET(request: NextRequest, context: RouteContext) {
  const organizationSlug = getOrganizationSlugFromParams(await context.params);
  const searchParams = request.nextUrl.searchParams;
  const startDate = getDateParam(searchParams, "startDate");
  const endDate = getDateParam(searchParams, "endDate");
  const dashboardSearchParams = toDashboardSearchParams(searchParams);
  const encoder = new TextEncoder();
  const startedAt = Date.now();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: unknown) => {
        controller.enqueue(encoder.encode(serializeStreamEvent(event)));
      };
      const trace = (event: FormatComparisonTraceEvent) => {
        send({
          ...event,
          elapsedMs: Date.now() - startedAt,
          type: "progress",
        });
      };

      try {
        trace({
          detail: "Server trace connected.",
          key: "trace",
          label: "Starting server trace",
          progress: 1,
          status: "started",
        });

        const data = await getFormatComparisonData({
          endDate,
          organizationSlug,
          searchParams: dashboardSearchParams,
          startDate,
          trace,
        });

        send({
          data,
          elapsedMs: Date.now() - startedAt,
          type: "done",
        });
      } catch (error) {
        send({
          detail:
            error instanceof Error
              ? error.message
              : "Could not load the format comparison report.",
          elapsedMs: Date.now() - startedAt,
          key: "error",
          label: "Load failed",
          progress: 100,
          status: "failed",
          type: "error",
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "X-Accel-Buffering": "no",
    },
  });
}
