import { getDataProviderEnv } from "@/lib/server-env";

import type {
  DataProviderErrorPayload,
  DataProviderRequestOptions,
} from "./types";

export class ViralAppApiError extends Error {
  status: number;
  payload?: DataProviderErrorPayload;

  constructor(
    message: string,
    status: number,
    payload?: DataProviderErrorPayload,
  ) {
    super(message);
    this.name = "ViralAppApiError";
    this.status = status;
    this.payload = payload;
  }
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

    if (!response.ok) {
      const payload = (await safeJson(response)) as
        | DataProviderErrorPayload
        | undefined;

      throw new ViralAppApiError(
        payload?.message ?? `viral.app request failed with ${response.status}.`,
        response.status,
        payload,
      );
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return (await response.json()) as T;
  }
}

async function safeJson(response: Response) {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

export const viralAppClient = new ViralAppClient();
