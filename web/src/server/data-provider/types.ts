export type DataProviderRequestOptions = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  headers?: HeadersInit;
  signal?: AbortSignal;
};

export type DataProviderErrorPayload = {
  message?: string;
  code?: string;
  status?: number;
};
