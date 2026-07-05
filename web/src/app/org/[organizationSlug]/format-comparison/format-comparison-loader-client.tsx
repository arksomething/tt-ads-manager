"use client";

import { useEffect, useMemo, useState } from "react";

import { type DashboardSearchParams } from "@/server/dashboard/filters";
import { type FormatComparisonData } from "@/server/dashboard/format-comparison";

import { FormatComparisonClient } from "./format-comparison-client";
import {
  FormatComparisonSkeleton,
  type FormatComparisonLoadingTraceEvent,
} from "./format-comparison-skeleton";

type FormatComparisonLoaderClientProps = {
  endDate: string;
  organizationSlug: string;
  searchParams: DashboardSearchParams;
  startDate: string;
};

type TraceStreamEvent =
  | ({
      type: "progress";
    } & FormatComparisonLoadingTraceEvent)
  | {
      data: FormatComparisonData;
      elapsedMs: number;
      type: "done";
    }
  | ({
      type: "error";
    } & FormatComparisonLoadingTraceEvent);

function appendSearchParam(
  params: URLSearchParams,
  key: string,
  value: string | string[] | undefined,
) {
  if (value === undefined) {
    return;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      params.append(key, entry);
    }
    return;
  }

  params.set(key, value);
}

function buildTraceUrl(args: FormatComparisonLoaderClientProps) {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(args.searchParams)) {
    if (key === "startDate" || key === "endDate" || key === "revenueModel") {
      continue;
    }

    appendSearchParam(params, key, value);
  }

  params.set("startDate", args.startDate);
  params.set("endDate", args.endDate);

  return `/api/org/${encodeURIComponent(
    args.organizationSlug,
  )}/format-comparison/trace?${params.toString()}`;
}

function parseTraceEvent(line: string): TraceStreamEvent | null {
  try {
    const parsed = JSON.parse(line) as TraceStreamEvent;

    if (
      parsed.type === "progress" ||
      parsed.type === "done" ||
      parsed.type === "error"
    ) {
      return parsed;
    }
  } catch {
    return null;
  }

  return null;
}

export function FormatComparisonLoaderClient({
  endDate,
  organizationSlug,
  searchParams,
  startDate,
}: FormatComparisonLoaderClientProps) {
  const traceUrl = useMemo(
    () =>
      buildTraceUrl({
        endDate,
        organizationSlug,
        searchParams,
        startDate,
      }),
    [endDate, organizationSlug, searchParams, startDate],
  );
  const [data, setData] = useState<FormatComparisonData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [traceEvents, setTraceEvents] = useState<
    FormatComparisonLoadingTraceEvent[]
  >([]);

  useEffect(() => {
    const controller = new AbortController();
    let pendingText = "";

    async function readTrace() {
      setData(null);
      setError(null);
      setTraceEvents([]);

      try {
        const response = await fetch(traceUrl, {
          cache: "no-store",
          headers: {
            Accept: "application/x-ndjson",
          },
          signal: controller.signal,
        });

        if (!response.ok || !response.body) {
          throw new Error("Could not start the server trace.");
        }

        const reader = response.body
          .pipeThrough(new TextDecoderStream())
          .getReader();

        while (true) {
          const { done, value } = await reader.read();

          if (done) {
            break;
          }

          pendingText += value;
          const lines = pendingText.split("\n");
          pendingText = lines.pop() ?? "";

          for (const line of lines) {
            const event = parseTraceEvent(line.trim());

            if (!event) {
              continue;
            }

            if (event.type === "progress") {
              setTraceEvents((events) => [
                ...events.slice(-20),
                {
                  detail: event.detail,
                  elapsedMs: event.elapsedMs,
                  key: event.key,
                  label: event.label,
                  progress: event.progress,
                  status: event.status,
                },
              ]);
            } else if (event.type === "error") {
              setTraceEvents((events) => [
                ...events.slice(-20),
                {
                  detail: event.detail,
                  elapsedMs: event.elapsedMs,
                  key: event.key,
                  label: event.label,
                  progress: event.progress,
                  status: event.status,
                },
              ]);
              setError(event.detail);
            } else {
              setData(event.data);
            }
          }
        }
      } catch (traceError) {
        if (controller.signal.aborted) {
          return;
        }

        setError(
          traceError instanceof Error
            ? traceError.message
            : "Could not load the format comparison report.",
        );
      }
    }

    void readTrace();

    return () => {
      controller.abort();
    };
  }, [traceUrl]);

  if (data) {
    return (
      <FormatComparisonClient
        data={data}
        endDate={endDate}
        organizationSlug={organizationSlug}
        searchParams={searchParams}
        startDate={startDate}
      />
    );
  }

  return (
    <>
      <FormatComparisonSkeleton
        detail="This is a live server trace of the report load."
        title="Loading format comparison"
        traceEvents={traceEvents}
      />
      {error ? (
        <section className="mt-6 rounded-[1rem] border border-red-300/20 bg-red-400/10 px-4 py-3 text-sm text-red-100">
          {error}
        </section>
      ) : null}
    </>
  );
}
