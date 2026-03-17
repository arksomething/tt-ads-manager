import { getTikTokBusinessEnv } from "@/lib/server-env";

type TikTokEnvelope<TData> = {
  code?: number;
  message?: string;
  request_id?: string;
  data?: TData;
};

type RequestTikTokBusinessApiArgs = {
  accessToken: string;
  method?: "GET" | "POST";
  path: string;
  query?: Record<string, string | number | boolean | null | undefined>;
  body?: unknown;
};

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
  query: Record<string, string | number | boolean | null | undefined> | undefined,
) {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const url = new URL(`${baseUrl}${normalizedPath}`);

  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null) {
        continue;
      }

      url.searchParams.set(key, String(value));
    }
  }

  return url;
}

export async function requestTikTokBusinessApi<TData>(
  args: RequestTikTokBusinessApiArgs,
): Promise<TData> {
  const env = getTikTokBusinessEnv();
  const method = args.method ?? "GET";
  const url = buildUrl(env.TIKTOK_BUSINESS_BASE_URL, args.path, args.query);
  const response = await fetch(url, {
    method,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${args.accessToken}`,
      "Access-Token": args.accessToken,
    },
    ...(args.body !== undefined ? { body: JSON.stringify(args.body) } : {}),
    cache: "no-store",
  });
  const payload = (await response.json().catch(() => null)) as
    | TikTokEnvelope<TData>
    | null;

  if (!response.ok) {
    throw new TikTokBusinessApiError({
      message:
        payload?.message ??
        `TikTok Business API request failed with status ${response.status}.`,
      status: response.status,
      code: payload?.code ?? null,
      requestId: payload?.request_id ?? null,
      payload,
    });
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
}
