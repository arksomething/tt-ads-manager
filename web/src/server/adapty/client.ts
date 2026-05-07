import { getAdaptyEnv } from "@/lib/server-env";

const MAX_ADAPTY_API_ATTEMPTS = 3;
const BASE_RETRY_DELAY_MS = 900;
const MAX_RETRY_DELAY_MS = 8_000;

export type AdaptyRevenueSegmentation =
  | "attribution_source"
  | "attribution_channel"
  | "attribution_campaign"
  | "attribution_adgroup"
  | "attribution_adset"
  | "attribution_creative";

type AdaptyAnalyticsFilters = {
  date: [string, string];
  compare_date?: [string, string];
  store?: string[];
  country?: string[];
  store_product_id?: string[];
  duration?: string[];
  attribution_source?: string[];
  attribution_status?: string[];
  attribution_channel?: string[];
  attribution_campaign?: string[];
  attribution_adgroup?: string[];
  attribution_adset?: string[];
  attribution_creative?: string[];
  offer_category?: string[];
  offer_type?: string[];
  offer_id?: string[];
};

type AdaptyRetrieveAnalyticsArgs = {
  chartId: "revenue";
  dateType?: "purchase_date" | "profile_install_date";
  filters: AdaptyAnalyticsFilters;
  periodUnit?: "day" | "week" | "month" | "quarter" | "year";
  segmentation?: AdaptyRevenueSegmentation | "period";
};

type AdaptyRequestOptions = {
  path: string;
  body: Record<string, unknown>;
  signal?: AbortSignal;
};

export class AdaptyApiError extends Error {
  status: number;
  payload?: unknown;

  constructor(args: {
    message: string;
    status: number;
    payload?: unknown;
  }) {
    super(args.message);
    this.name = "AdaptyApiError";
    this.status = args.status;
    this.payload = args.payload;
  }
}

function buildAdaptyUrl(path: string) {
  const env = getAdaptyEnv();
  return new URL(path, env.ADAPTY_API_BASE_URL).toString();
}

function shouldRetryStatus(status: number) {
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

function getRetryDelayMs(args: {
  attempt: number;
  retryAfterMs: number | null;
}) {
  if (typeof args.retryAfterMs === "number") {
    return Math.max(0, Math.min(args.retryAfterMs, MAX_RETRY_DELAY_MS));
  }

  return Math.min(BASE_RETRY_DELAY_MS * 2 ** (args.attempt - 1), MAX_RETRY_DELAY_MS);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function parseResponsePayload(response: Response) {
  const contentType = response.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    try {
      return await response.json();
    } catch {
      return undefined;
    }
  }

  try {
    return await response.text();
  } catch {
    return undefined;
  }
}

function getPayloadErrorMessage(payload: unknown, status: number) {
  if (typeof payload === "string" && payload.trim().length > 0) {
    return payload;
  }

  if (typeof payload === "object" && payload !== null) {
    const record = payload as Record<string, unknown>;

    if (typeof record.message === "string" && record.message.trim().length > 0) {
      return record.message;
    }

    if (typeof record.error === "string" && record.error.trim().length > 0) {
      return record.error;
    }

    if (Array.isArray(record.errors) && record.errors.length > 0) {
      return record.errors
        .map((entry) => {
          if (typeof entry === "string") {
            return entry;
          }

          if (typeof entry === "object" && entry !== null) {
            const errorRecord = entry as Record<string, unknown>;
            const nestedErrors = errorRecord.errors;

            if (Array.isArray(nestedErrors)) {
              return nestedErrors.filter((value) => typeof value === "string").join(", ");
            }

            if (typeof errorRecord.error === "string") {
              return errorRecord.error;
            }
          }

          return "";
        })
        .filter(Boolean)
        .join("; ");
    }
  }

  return `Adapty request failed with ${status}.`;
}

export class AdaptyClient {
  async request<T>({ path, body, signal }: AdaptyRequestOptions): Promise<T> {
    const env = getAdaptyEnv();
    const url = buildAdaptyUrl(path);

    for (let attempt = 1; attempt <= MAX_ADAPTY_API_ATTEMPTS; attempt += 1) {
      const response = await fetch(url, {
        body: JSON.stringify(body),
        cache: "no-store",
        headers: {
          Accept: "application/json",
          Authorization: `Api-Key ${env.ADAPTY_API_KEY}`,
          "Content-Type": "application/json",
        },
        method: "POST",
        signal,
      });
      const payload = await parseResponsePayload(response);

      if (response.ok) {
        return payload as T;
      }

      if (attempt < MAX_ADAPTY_API_ATTEMPTS && shouldRetryStatus(response.status)) {
        await sleep(
          getRetryDelayMs({
            attempt,
            retryAfterMs: parseRetryAfterMs(response.headers.get("Retry-After")),
          }),
        );
        continue;
      }

      throw new AdaptyApiError({
        message: getPayloadErrorMessage(payload, response.status),
        status: response.status,
        payload,
      });
    }

    throw new Error("Adapty request attempts exhausted.");
  }

  retrieveAnalyticsData(args: AdaptyRetrieveAnalyticsArgs) {
    return this.request<unknown>({
      path: "/api/v1/client-api/metrics/analytics/",
      body: {
        chart_id: args.chartId,
        date_type: args.dateType ?? "purchase_date",
        filters: args.filters,
        format: "json",
        period_unit: args.periodUnit ?? "day",
        segmentation: args.segmentation,
      },
    });
  }
}

export const adaptyClient = new AdaptyClient();
