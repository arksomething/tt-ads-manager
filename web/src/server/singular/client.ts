import { getSingularEnv } from "@/lib/server-env";

const MAX_SINGULAR_API_ATTEMPTS = 4;
const BASE_RETRY_DELAY_MS = 1_000;
const MAX_RETRY_DELAY_MS = 20_000;

type SingularQueryValue = string | number | boolean | null | undefined;

type SingularEnvelope<T> = {
  status?: number;
  substatus?: number;
  message?: string;
  error?: string;
  value?: T;
};

type SingularRequestOptions = {
  method?: "GET" | "POST";
  path: string;
  query?: Record<string, SingularQueryValue>;
  formBody?: Record<string, SingularQueryValue>;
  headers?: HeadersInit;
  signal?: AbortSignal;
};

export type SingularReportStatusValue = {
  status?: string;
  report_id?: string;
  download_url?: string;
  url_expires_in?: number;
  generated_url_time_in_utc?: string;
  url_expired_time_in_utc?: string;
  message?: string;
  error?: string;
};

export type SingularFilterDimensionValue = {
  name?: string | number;
  display_name?: string;
};

export type SingularFilterDimension = {
  name?: string;
  display_name?: string;
  values?: SingularFilterDimensionValue[];
};

export type SingularCreateAsyncReportArgs = {
  startDate: string;
  endDate: string;
  timeBreakdown?: "day" | "week" | "month" | "all";
  dimensions: string[];
  metrics?: string[];
  cohortMetrics?: string[];
  cohortPeriods?: string[];
  sourceNames?: string[];
  appNames?: string[];
  filters?: Array<{
    dimension: string;
    operator: string;
    values: Array<string | number | boolean>;
  }>;
  format?: "json" | "csv";
  displayUnenriched?: boolean;
  displayAlignment?: boolean;
  allowMultipleBreakdowns?: boolean;
  signal?: AbortSignal;
};

export class SingularApiError extends Error {
  status: number;
  singularStatus: number | null;
  singularSubstatus: number | null;
  payload?: unknown;

  constructor(args: {
    message: string;
    status: number;
    singularStatus?: number | null;
    singularSubstatus?: number | null;
    payload?: unknown;
  }) {
    super(args.message);
    this.name = "SingularApiError";
    this.status = args.status;
    this.singularStatus = args.singularStatus ?? null;
    this.singularSubstatus = args.singularSubstatus ?? null;
    this.payload = args.payload;
  }
}

function buildSingularUrl(path: string, query?: Record<string, SingularQueryValue>) {
  const singularEnv = getSingularEnv();
  const url = new URL(path, singularEnv.SINGULAR_API_BASE_URL);
  url.searchParams.set("api_key", singularEnv.SINGULAR_API_KEY);

  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null) {
      continue;
    }

    url.searchParams.set(key, String(value));
  }

  return url;
}

function shouldRetryForStatus(status: number) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function parseRetryAfterMs(value: string | null) {
  if (!value) {
    return null;
  }

  const numericValue = Number(value);

  if (Number.isFinite(numericValue) && numericValue >= 0) {
    return numericValue * 1_000;
  }

  const retryDate = new Date(value);
  const retryMs = retryDate.getTime() - Date.now();
  return Number.isFinite(retryMs) && retryMs > 0 ? retryMs : null;
}

function getRetryDelayMs(args: { attempt: number; retryAfterMs: number | null }) {
  if (typeof args.retryAfterMs === "number") {
    return Math.max(0, Math.min(args.retryAfterMs, MAX_RETRY_DELAY_MS));
  }

  return Math.min(BASE_RETRY_DELAY_MS * 2 ** (args.attempt - 1), MAX_RETRY_DELAY_MS);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function safeJson(response: Response) {
  try {
    return (await response.json()) as unknown;
  } catch {
    return undefined;
  }
}

function getEnvelopeErrorMessage(envelope: SingularEnvelope<unknown>, status: number) {
  if (typeof envelope.error === "string" && envelope.error.trim().length > 0) {
    return envelope.error;
  }

  if (typeof envelope.message === "string" && envelope.message.trim().length > 0) {
    return envelope.message;
  }

  return `Singular request failed with ${status}.`;
}

export class SingularClient {
  async request<T>({
    method = "GET",
    path,
    query,
    formBody,
    headers,
    signal,
  }: SingularRequestOptions): Promise<T> {
    const url = buildSingularUrl(path, query);

    for (let attempt = 1; attempt <= MAX_SINGULAR_API_ATTEMPTS; attempt += 1) {
      try {
        const response = await fetch(url, {
          method,
          signal,
          headers: {
            Accept: "application/json",
            ...(formBody
              ? { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" }
              : {}),
            ...headers,
          },
          body: formBody
            ? new URLSearchParams(
                Object.entries(formBody).flatMap(([key, value]) =>
                  value === undefined || value === null ? [] : [[key, String(value)]],
                ),
              )
            : undefined,
          cache: "no-store",
        });

        if (!response.ok) {
          const payload = await safeJson(response);

          if (attempt < MAX_SINGULAR_API_ATTEMPTS && shouldRetryForStatus(response.status)) {
            await sleep(
              getRetryDelayMs({
                attempt,
                retryAfterMs: parseRetryAfterMs(response.headers.get("Retry-After")),
              }),
            );
            continue;
          }

          const envelope = payload as SingularEnvelope<unknown> | undefined;
          throw new SingularApiError({
            message: envelope
              ? getEnvelopeErrorMessage(envelope, response.status)
              : `Singular request failed with ${response.status}.`,
            status: response.status,
            singularStatus: envelope?.status ?? null,
            singularSubstatus: envelope?.substatus ?? null,
            payload,
          });
        }

        const envelope = (await response.json()) as SingularEnvelope<T>;

        if (envelope.status !== 0) {
          throw new SingularApiError({
            message: getEnvelopeErrorMessage(envelope, response.status),
            status: response.status,
            singularStatus: envelope.status ?? null,
            singularSubstatus: envelope.substatus ?? null,
            payload: envelope,
          });
        }

        if (envelope.value === undefined) {
          throw new SingularApiError({
            message: "Singular response did not include a value payload.",
            status: response.status,
            singularStatus: envelope.status ?? null,
            singularSubstatus: envelope.substatus ?? null,
            payload: envelope,
          });
        }

        return envelope.value;
      } catch (error) {
        if (attempt >= MAX_SINGULAR_API_ATTEMPTS) {
          throw error;
        }

        if (error instanceof SingularApiError) {
          throw error;
        }

        await sleep(
          getRetryDelayMs({
            attempt,
            retryAfterMs: null,
          }),
        );
      }
    }

    throw new Error("Singular request attempts exhausted.");
  }

  async createAsyncReport(args: SingularCreateAsyncReportArgs) {
    const payload = await this.request<{ report_id?: string }>({
      method: "POST",
      path: "/api/v2.0/create_async_report",
      formBody: {
        start_date: args.startDate,
        end_date: args.endDate,
        time_breakdown: args.timeBreakdown ?? "all",
        dimensions: args.dimensions.join(","),
        metrics: args.metrics?.join(",") || undefined,
        cohort_metrics: args.cohortMetrics?.join(",") || undefined,
        cohort_periods: args.cohortPeriods?.join(",") || undefined,
        source: args.sourceNames?.join(",") || undefined,
        app: args.appNames?.join(",") || undefined,
        filters: args.filters?.length ? JSON.stringify(args.filters) : undefined,
        format: args.format ?? "json",
        display_unenriched:
          typeof args.displayUnenriched === "boolean"
            ? String(args.displayUnenriched)
            : undefined,
        display_alignment:
          typeof args.displayAlignment === "boolean"
            ? String(args.displayAlignment)
            : undefined,
        allow_multiple_breakdowns:
          typeof args.allowMultipleBreakdowns === "boolean"
            ? String(args.allowMultipleBreakdowns)
            : undefined,
      },
      signal: args.signal,
    });

    const reportId = payload.report_id?.trim();

    if (!reportId) {
      throw new Error("Singular did not return a report ID.");
    }

    return reportId;
  }

  async getReportStatus(reportId: string, signal?: AbortSignal) {
    return this.request<SingularReportStatusValue>({
      path: "/api/v2.0/get_report_status",
      query: {
        report_id: reportId,
      },
      signal,
    });
  }

  async getFilters(signal?: AbortSignal) {
    return this.request<{ dimensions?: SingularFilterDimension[] }>({
      path: "/api/v2.0/reporting/filters",
      signal,
    });
  }

  async downloadReport(downloadUrl: string, signal?: AbortSignal) {
    for (let attempt = 1; attempt <= MAX_SINGULAR_API_ATTEMPTS; attempt += 1) {
      try {
        const response = await fetch(downloadUrl, {
          method: "GET",
          signal,
          headers: {
            Accept: "application/json",
          },
          cache: "no-store",
        });

        if (!response.ok) {
          if (attempt < MAX_SINGULAR_API_ATTEMPTS && shouldRetryForStatus(response.status)) {
            await sleep(
              getRetryDelayMs({
                attempt,
                retryAfterMs: parseRetryAfterMs(response.headers.get("Retry-After")),
              }),
            );
            continue;
          }

          throw new Error(`Could not download Singular report (${response.status}).`);
        }

        const text = await response.text();
        return JSON.parse(text) as unknown;
      } catch (error) {
        if (attempt >= MAX_SINGULAR_API_ATTEMPTS) {
          throw error;
        }

        await sleep(
          getRetryDelayMs({
            attempt,
            retryAfterMs: null,
          }),
        );
      }
    }

    throw new Error("Singular report download attempts exhausted.");
  }
}

export const singularClient = new SingularClient();
