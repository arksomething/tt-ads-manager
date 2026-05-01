import { getViewsBaseEnv } from "@/lib/server-env";

type ViewsBaseRequestOptions = {
  path: string;
  query?: Record<string, string | number | boolean | null | undefined>;
  headers?: Record<string, string>;
  signal?: AbortSignal;
};

type ViewsBaseErrorPayload = {
  error?: string;
  message?: string;
};

export class ViewsBaseApiError extends Error {
  status: number;
  payload?: ViewsBaseErrorPayload;

  constructor(message: string, status: number, payload?: ViewsBaseErrorPayload) {
    super(message);
    this.name = "ViewsBaseApiError";
    this.status = status;
    this.payload = payload;
  }
}

class ViewsBaseClient {
  private buildUrl(path: string, query?: ViewsBaseRequestOptions["query"]) {
    const env = getViewsBaseEnv();
    const baseUrl = env.VIEWSBASE_BASE_URL.endsWith("/")
      ? env.VIEWSBASE_BASE_URL
      : `${env.VIEWSBASE_BASE_URL}/`;
    const url = new URL(path.startsWith("/") ? path.slice(1) : path, baseUrl);

    for (const [key, value] of Object.entries(query ?? {})) {
      if (value === null || value === undefined) {
        continue;
      }

      url.searchParams.set(key, String(value));
    }

    return url;
  }

  private getHeaders(extraHeaders?: Record<string, string>) {
    const env = getViewsBaseEnv();

    return {
      Accept: "application/json, text/html;q=0.9, */*;q=0.8",
      Cookie: `${env.VIEWSBASE_SESSION_COOKIE_NAME}=${env.VIEWSBASE_SESSION_COOKIE_VALUE}`,
      ...extraHeaders,
    };
  }

  async requestJson<T>({ path, query, headers, signal }: ViewsBaseRequestOptions): Promise<T> {
    const response = await fetch(this.buildUrl(path, query), {
      method: "GET",
      headers: this.getHeaders(headers),
      cache: "no-store",
      signal,
    });

    if (!response.ok) {
      const payload = (await safeJson(response)) as ViewsBaseErrorPayload | undefined;

      throw new ViewsBaseApiError(
        payload?.message ??
          payload?.error ??
          `ViewsBase request failed with ${response.status}.`,
        response.status,
        payload,
      );
    }

    return (await response.json()) as T;
  }

  async requestText({ path, query, headers, signal }: ViewsBaseRequestOptions) {
    const response = await fetch(this.buildUrl(path, query), {
      method: "GET",
      headers: this.getHeaders(headers),
      cache: "no-store",
      signal,
    });

    if (!response.ok) {
      const payload = (await safeJson(response)) as ViewsBaseErrorPayload | undefined;

      throw new ViewsBaseApiError(
        payload?.message ??
          payload?.error ??
          `ViewsBase request failed with ${response.status}.`,
        response.status,
        payload,
      );
    }

    return response.text();
  }
}

async function safeJson(response: Response) {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

export const viewsBaseClient = new ViewsBaseClient();
