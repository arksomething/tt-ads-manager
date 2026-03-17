import { getDataProviderEnv } from "@/lib/server-env";

import type {
  DataProviderErrorPayload,
  DataProviderRequestOptions,
} from "./types";

export class DataProviderApiError extends Error {
  status: number;
  payload?: DataProviderErrorPayload;

  constructor(
    message: string,
    status: number,
    payload?: DataProviderErrorPayload,
  ) {
    super(message);
    this.name = "DataProviderApiError";
    this.status = status;
    this.payload = payload;
  }
}

export class DataProviderClient {
  async request<T>({
    method = "GET",
    path,
    query,
    body,
    headers,
    signal,
  }: DataProviderRequestOptions): Promise<T> {
    const dataProviderEnv = getDataProviderEnv();
    const url = new URL(path, dataProviderEnv.DATA_PROVIDER_BASE_URL);

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
        "x-api-key": dataProviderEnv.DATA_PROVIDER_API_KEY,
        "Content-Type": "application/json",
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
    });

    if (!response.ok) {
      const payload = (await safeJson(response)) as
        | DataProviderErrorPayload
        | undefined;

      throw new DataProviderApiError(
        payload?.message ?? `Data provider request failed with ${response.status}.`,
        response.status,
        payload,
      );
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

export const dataProviderClient = new DataProviderClient();
