import { getTikTokBusinessEnv } from "@/lib/server-env";

type TikTokEnvelope<TData> = {
  code?: number;
  message?: string;
  request_id?: string;
  data?: TData;
};

type QueryPrimitive = string | number | boolean;
type QueryValue =
  | QueryPrimitive
  | readonly QueryPrimitive[]
  | readonly Record<string, unknown>[]
  | Record<string, unknown>
  | null
  | undefined;

type RequestTikTokBusinessApiArgs = {
  accessToken?: string;
  method?: "GET" | "POST";
  path: string;
  query?: Record<string, QueryValue>;
  body?: unknown;
};

const MAX_TIKTOK_API_ATTEMPTS = 4;
const BASE_RETRY_DELAY_MS = 1_000;
const MAX_RETRY_DELAY_MS = 20_000;

export class TikTokBusinessApiError extends Error {
  status: number;
  code: number | null;
  requestId: string | null;
  payload: unknown;

  constructor(args: {
    message: string;
    status: number;
    code?: number | null;
    requestId?: string | null;
    payload?: unknown;
  }) {
    super(args.message);
    this.name = "TikTokBusinessApiError";
    this.status = args.status;
    this.code = args.code ?? null;
    this.requestId = args.requestId ?? null;
    this.payload = args.payload;
  }
}

function buildUrl(
  baseUrl: string,
  path: string,
  query: Record<string, QueryValue> | undefined,
) {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const url = new URL(`${baseUrl}${normalizedPath}`);

  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null) {
        continue;
      }

      url.searchParams.set(
        key,
        typeof value === "object" ? JSON.stringify(value) : String(value),
      );
    }
  }

  return url;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfterMs(value: string | null) {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();

  if (trimmed.length === 0) {
    return null;
  }

  const seconds = Number(trimmed);

  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(MAX_RETRY_DELAY_MS, Math.round(seconds * 1_000));
  }

  const dateMs = Date.parse(trimmed);

  if (Number.isNaN(dateMs)) {
    return null;
  }

  return Math.min(MAX_RETRY_DELAY_MS, Math.max(0, dateMs - Date.now()));
}

function getRetryDelayMs(args: {
  attempt: number;
  retryAfterHeader: string | null;
}) {
  return (
    parseRetryAfterMs(args.retryAfterHeader) ??
    Math.min(MAX_RETRY_DELAY_MS, BASE_RETRY_DELAY_MS * 2 ** Math.max(0, args.attempt - 1))
  );
}

function shouldRetryForStatus(status: number) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

export async function requestTikTokBusinessApi<TData>(
  args: RequestTikTokBusinessApiArgs,
): Promise<TData> {
  const env = getTikTokBusinessEnv();
  const method = args.method ?? "GET";
  const url = buildUrl(env.TIKTOK_BUSINESS_BASE_URL, args.path, args.query);
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_TIKTOK_API_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, {
        method,
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          ...(args.accessToken
            ? {
                Authorization: `Bearer ${args.accessToken}`,
                "Access-Token": args.accessToken,
              }
            : {}),
        },
        ...(args.body !== undefined ? { body: JSON.stringify(args.body) } : {}),
        cache: "no-store",
      });
      const payload = (await response.json().catch(() => null)) as
        | TikTokEnvelope<TData>
        | null;

      if (!response.ok) {
        const error = new TikTokBusinessApiError({
          message:
            payload?.message ??
            `TikTok Business API request failed with status ${response.status}.`,
          status: response.status,
          code: payload?.code ?? null,
          requestId: payload?.request_id ?? null,
          payload,
        });

        if (attempt < MAX_TIKTOK_API_ATTEMPTS && shouldRetryForStatus(response.status)) {
          await sleep(
            getRetryDelayMs({
              attempt,
              retryAfterHeader: response.headers.get("Retry-After"),
            }),
          );
          lastError = error;
          continue;
        }

        throw error;
      }

      if (payload?.code && payload.code !== 0) {
        throw new TikTokBusinessApiError({
          message: payload.message ?? "TikTok Business API returned an error.",
          status: response.status,
          code: payload.code,
          requestId: payload.request_id ?? null,
          payload,
        });
      }

      return (payload?.data ?? null) as TData;
    } catch (error) {
      lastError =
        error instanceof Error
          ? error
          : new Error("TikTok Business API request failed unexpectedly.");

      if (
        attempt < MAX_TIKTOK_API_ATTEMPTS &&
        !(error instanceof TikTokBusinessApiError)
      ) {
        await sleep(
          getRetryDelayMs({
            attempt,
            retryAfterHeader: null,
          }),
        );
        continue;
      }

      throw lastError;
    }
  }

  throw lastError ?? new Error("TikTok Business API request failed unexpectedly.");
}
