import { getDataProviderEnv } from "@/lib/server-env";
import { getProviderRateLimitRetryDelayMs } from "@/lib/provider-rate-limit";
import { logServerTiming } from "@/lib/server-timing";

import type {
  DataProviderErrorPayload,
  DataProviderRequestOptions,
} from "./types";

export class ViralAppApiError extends Error {
  status: number;
  payload?: DataProviderErrorPayload;
  retryAfterSeconds?: number;

  constructor(
    message: string,
    status: number,
    payload?: DataProviderErrorPayload,
    retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "ViralAppApiError";
    this.status = status;
    this.payload = payload;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

type ViralAppCacheEntry = {
  expiresAt: number;
  value: unknown;
};

const VIRAL_APP_DEFAULT_RATE_LIMIT_COOLDOWN_MS = 60_000;
const VIRAL_APP_MAX_RATE_LIMIT_COOLDOWN_MS = 30 * 60_000;

const globalForViralAppClient = globalThis as typeof globalThis & {
  viralAppGetCache?: Map<string, ViralAppCacheEntry>;
  viralAppPendingGetRequests?: Map<string, Promise<unknown>>;
  viralAppRateLimitUntil?: number;
};

const getCache = () =>
  (globalForViralAppClient.viralAppGetCache ??= new Map<
    string,
    ViralAppCacheEntry
  >());
const getPendingRequests = () =>
  (globalForViralAppClient.viralAppPendingGetRequests ??= new Map<
    string,
    Promise<unknown>
  >());

function getCacheTtlMs(method: string, path: string) {
  if (method !== "GET") {
    return 0;
  }

  if (
    path.startsWith("/videos/tiktok/") ||
    path.startsWith("/live/tiktok/videos/")
  ) {
    return 15 * 60_000;
  }

  if (path.startsWith("/analytics/")) {
    return 5 * 60_000;
  }

  if (
    path === "/accounts/tracked" ||
    path === "/videos/tracked" ||
    path === "/videos"
  ) {
    return 60_000;
  }

  return 0;
}

function getCachedValue<T>(key: string) {
  const cache = getCache();
  const cached = cache.get(key);

  if (!cached) {
    return {
      found: false as const,
      value: undefined,
    };
  }

  if (cached.expiresAt <= Date.now()) {
    cache.delete(key);
    return {
      found: false as const,
      value: undefined,
    };
  }

  return {
    found: true as const,
    value: cached.value as T,
  };
}

function writeCachedValue(key: string, value: unknown, ttlMs: number) {
  getCache().set(key, {
    value,
    expiresAt: Date.now() + ttlMs,
  });
}

function clearViralAppReadCache() {
  getCache().clear();
  getPendingRequests().clear();
}

function getActiveRateLimitDelayMs(now = Date.now()) {
  const rateLimitUntil = globalForViralAppClient.viralAppRateLimitUntil;

  if (!rateLimitUntil || rateLimitUntil <= now) {
    return null;
  }

  return rateLimitUntil - now;
}

function rememberRateLimit(error: ViralAppApiError, now = Date.now()) {
  const retryDelayMs = getProviderRateLimitRetryDelayMs(error, {
    defaultDelayMs: VIRAL_APP_DEFAULT_RATE_LIMIT_COOLDOWN_MS,
    maxDelayMs: VIRAL_APP_MAX_RATE_LIMIT_COOLDOWN_MS,
    now,
  });

  if (retryDelayMs == null) {
    return;
  }

  globalForViralAppClient.viralAppRateLimitUntil = Math.max(
    globalForViralAppClient.viralAppRateLimitUntil ?? 0,
    now + retryDelayMs,
  );
}

function logViralAppTiming(args: {
  cache: "hit" | "miss" | "pending" | "rate-limit-skip";
  durationMs: number;
  method: string;
  path: string;
  status?: number;
  ttlMs?: number;
}) {
  logServerTiming("viral.app.request", args.durationMs, {
    cache: args.cache,
    method: args.method,
    path: args.path,
    statusCode: args.status,
    ttlMs: args.ttlMs,
  });
}

export class ViralAppClient {
  async request<T>({
    method = "GET",
    path,
    query,
    body,
    headers,
    signal,
  }: DataProviderRequestOptions): Promise<T> {
    const providerEnv = getDataProviderEnv();
    const baseUrl = providerEnv.DATA_PROVIDER_BASE_URL.endsWith("/")
      ? providerEnv.DATA_PROVIDER_BASE_URL
      : `${providerEnv.DATA_PROVIDER_BASE_URL}/`;
    const url = new URL(path.startsWith("/") ? path.slice(1) : path, baseUrl);

    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }

    const cacheTtlMs = getCacheTtlMs(method, path);
    const cacheKey = `${method}:${url.toString()}`;
    const canUseCache = cacheTtlMs > 0 && !signal;

    if (canUseCache) {
      const cached = getCachedValue<T>(cacheKey);

      if (cached.found) {
        logViralAppTiming({
          cache: "hit",
          durationMs: 0,
          method,
          path,
          ttlMs: cacheTtlMs,
        });
        return cached.value;
      }

      const pending = getPendingRequests().get(cacheKey);

      if (pending) {
        const pendingStartedAt = Date.now();
        const value = (await pending) as T;
        logViralAppTiming({
          cache: "pending",
          durationMs: Date.now() - pendingStartedAt,
          method,
          path,
          ttlMs: cacheTtlMs,
        });
        return value;
      }
    }

    const activeRateLimitDelayMs = getActiveRateLimitDelayMs();

    if (activeRateLimitDelayMs != null) {
      logViralAppTiming({
        cache: "rate-limit-skip",
        durationMs: 0,
        method,
        path,
        status: 429,
      });
      throw new ViralAppApiError(
        `Rate limit exceeded, please try again in ${Math.max(
          1,
          Math.ceil(activeRateLimitDelayMs / 1_000),
        )} seconds.`,
        429,
      );
    }

    const requestPromise = (async () => {
      const upstreamStartedAt = Date.now();
      let responseStatus: number | undefined;

      const response = await fetch(url, {
        method,
        signal,
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "x-api-key": providerEnv.DATA_PROVIDER_API_KEY,
          ...headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        cache: "no-store",
      });
      responseStatus = response.status;

      if (!response.ok) {
        const payload = (await safeJson(response)) as
          | DataProviderErrorPayload
          | undefined;

        const error = new ViralAppApiError(
          payload?.message ??
            `viral.app request failed with ${response.status}.`,
          response.status,
          payload,
          getRetryAfterSeconds(response.headers.get("retry-after")),
        );

        if (response.status === 429) {
          rememberRateLimit(error);
        }

        logViralAppTiming({
          cache: "miss",
          durationMs: Date.now() - upstreamStartedAt,
          method,
          path,
          status: responseStatus,
          ttlMs: canUseCache ? cacheTtlMs : undefined,
        });
        throw error;
      }

      if (method !== "GET") {
        clearViralAppReadCache();
      }

      const result =
        response.status === 204
          ? (undefined as T)
          : ((await response.json()) as T);

      logViralAppTiming({
        cache: "miss",
        durationMs: Date.now() - upstreamStartedAt,
        method,
        path,
        status: responseStatus,
        ttlMs: canUseCache ? cacheTtlMs : undefined,
      });

      return result;
    })();

    if (canUseCache) {
      getPendingRequests().set(cacheKey, requestPromise);
    }

    try {
      const result = await requestPromise;

      if (canUseCache) {
        writeCachedValue(cacheKey, result, cacheTtlMs);
      }

      return result;
    } finally {
      if (canUseCache) {
        const pending = getPendingRequests().get(cacheKey);

        if (pending === requestPromise) {
          getPendingRequests().delete(cacheKey);
        }
      }
    }
  }
}

async function safeJson(response: Response) {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

function getRetryAfterSeconds(retryAfter: string | null) {
  if (!retryAfter) {
    return undefined;
  }

  const seconds = Number(retryAfter);

  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds;
  }

  const retryAt = Date.parse(retryAfter);

  if (Number.isFinite(retryAt)) {
    return Math.max(0, Math.ceil((retryAt - Date.now()) / 1_000));
  }

  return undefined;
}

export const viralAppClient = new ViralAppClient();
