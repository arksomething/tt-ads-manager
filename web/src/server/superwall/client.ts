import { getSuperwallEnv } from "@/lib/server-env";

const MAX_SUPERWALL_API_ATTEMPTS = 3;
const BASE_RETRY_DELAY_MS = 900;
const MAX_RETRY_DELAY_MS = 8_000;

type SuperwallRequestOptions = {
  body?: string;
  credentials?: SuperwallCredentialValue;
  method?: "GET" | "POST";
  path: string;
  responseType?: "auto" | "text";
  signal?: AbortSignal;
};

export type SuperwallProjectApplication = {
  id: number;
  name: string;
  platform: string | null;
  slug: string | null;
};

export type SuperwallQueryScope = {
  applicationIds: number[];
  organizationId: number;
};

export type SuperwallCredentialValue = {
  apiBaseUrl: string;
  apiKey: string;
  applicationIds: number[];
  appleSourcePatterns: string;
  creatorSourcePatterns: string;
  organizationId: number | null;
  projectName: string;
  tiktokSourcePatterns: string;
};

type SuperwallProject = {
  applications: SuperwallProjectApplication[];
  archived: boolean;
  id: number;
  name: string;
  organizationId: number;
};

export class SuperwallApiError extends Error {
  status: number;
  payload?: unknown;

  constructor(args: {
    message: string;
    status: number;
    payload?: unknown;
  }) {
    super(args.message);
    this.name = "SuperwallApiError";
    this.status = args.status;
    this.payload = args.payload;
  }
}

const scopeCache = new Map<string, Promise<SuperwallQueryScope>>();

function getSuperwallRequestCredentials(credentials?: SuperwallCredentialValue) {
  if (credentials) {
    return credentials;
  }

  const env = getSuperwallEnv();
  return {
    apiBaseUrl: env.SUPERWALL_API_BASE_URL,
    apiKey: env.SUPERWALL_API_KEY,
    applicationIds: env.SUPERWALL_APPLICATION_IDS,
    appleSourcePatterns: env.SUPERWALL_APPLE_SOURCE_PATTERNS,
    creatorSourcePatterns: env.SUPERWALL_CREATOR_SOURCE_PATTERNS,
    organizationId: env.SUPERWALL_ORGANIZATION_ID,
    projectName: env.SUPERWALL_PROJECT_NAME,
    tiktokSourcePatterns: env.SUPERWALL_TIKTOK_SOURCE_PATTERNS,
  };
}

function buildSuperwallUrl(path: string, credentials: SuperwallCredentialValue) {
  return new URL(path, credentials.apiBaseUrl).toString();
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

  return Math.min(
    BASE_RETRY_DELAY_MS * 2 ** (args.attempt - 1),
    MAX_RETRY_DELAY_MS,
  );
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function parseResponsePayload(
  response: Response,
  responseType: SuperwallRequestOptions["responseType"] = "auto",
) {
  if (responseType === "text") {
    try {
      return await response.text();
    } catch {
      return undefined;
    }
  }

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
  }

  return `Superwall request failed with ${status}.`;
}

function toNumber(value: unknown) {
  const numberValue =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : null;

  return typeof numberValue === "number" && Number.isFinite(numberValue)
    ? numberValue
    : null;
}

function parseProjectPayload(payload: unknown): SuperwallProject[] {
  if (
    !payload ||
    typeof payload !== "object" ||
    !Array.isArray((payload as { data?: unknown }).data)
  ) {
    return [];
  }

  return (payload as { data: unknown[] }).data.flatMap((entry) => {
    if (!entry || typeof entry !== "object") {
      return [];
    }

    const record = entry as Record<string, unknown>;
    const id = toNumber(record.id);
    const organizationId =
      toNumber(record.organization_id) ?? toNumber(record.organizationId);
    const name = typeof record.name === "string" ? record.name : null;

    if (id === null || organizationId === null || !name) {
      return [];
    }

    const applications = Array.isArray(record.applications)
      ? record.applications.flatMap((application) => {
          if (!application || typeof application !== "object") {
            return [];
          }

          const applicationRecord = application as Record<string, unknown>;
          const applicationId = toNumber(applicationRecord.id);

          if (applicationId === null || applicationRecord.archived_at) {
            return [];
          }

          return [
            {
              id: applicationId,
              name:
                typeof applicationRecord.name === "string"
                  ? applicationRecord.name
                  : "",
              platform:
                typeof applicationRecord.platform === "string"
                  ? applicationRecord.platform
                  : null,
              slug:
                typeof applicationRecord.slug === "string"
                  ? applicationRecord.slug
                  : null,
            },
          ] satisfies SuperwallProjectApplication[];
        })
      : [];

    return [
      {
        applications,
        archived: Boolean(record.archived),
        id,
        name,
        organizationId,
      },
    ];
  });
}

function getScopeCacheKey(credentials: SuperwallCredentialValue) {
  return JSON.stringify({
    applicationIds: credentials.applicationIds,
    organizationId: credentials.organizationId,
    projectName: credentials.projectName,
    tokenTail: credentials.apiKey.slice(-8),
  });
}

function parseJsonEachRow<T>(payload: unknown) {
  if (typeof payload !== "string") {
    return [];
  }

  return payload
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}

export class SuperwallClient {
  async request<T>({
    body,
    credentials,
    method = "GET",
    path,
    responseType = "auto",
    signal,
  }: SuperwallRequestOptions): Promise<T> {
    const resolvedCredentials = getSuperwallRequestCredentials(credentials);
    const url = buildSuperwallUrl(path, resolvedCredentials);

    for (let attempt = 1; attempt <= MAX_SUPERWALL_API_ATTEMPTS; attempt += 1) {
      const response = await fetch(url, {
        body,
        cache: "no-store",
        headers: {
          Accept: "application/json,text/plain,*/*",
          Authorization: `Bearer ${resolvedCredentials.apiKey}`,
          ...(body ? { "Content-Type": "text/plain; charset=utf-8" } : {}),
        },
        method,
        signal,
      });
      const payload = await parseResponsePayload(response, responseType);

      if (response.ok) {
        return payload as T;
      }

      if (attempt < MAX_SUPERWALL_API_ATTEMPTS && shouldRetryStatus(response.status)) {
        await sleep(
          getRetryDelayMs({
            attempt,
            retryAfterMs: parseRetryAfterMs(response.headers.get("Retry-After")),
          }),
        );
        continue;
      }

      throw new SuperwallApiError({
        message: getPayloadErrorMessage(payload, response.status),
        status: response.status,
        payload,
      });
    }

    throw new Error("Superwall request attempts exhausted.");
  }

  async listProjects(credentials?: SuperwallCredentialValue) {
    const payload = await this.request<unknown>({
      credentials,
      path: "/v2/projects",
    });

    return parseProjectPayload(payload);
  }

  async resolveQueryScope(credentials?: SuperwallCredentialValue) {
    const resolvedCredentials = getSuperwallRequestCredentials(credentials);

    if (
      resolvedCredentials.organizationId &&
      resolvedCredentials.applicationIds.length > 0
    ) {
      return {
        applicationIds: resolvedCredentials.applicationIds,
        organizationId: resolvedCredentials.organizationId,
      } satisfies SuperwallQueryScope;
    }

    const cacheKey = getScopeCacheKey(resolvedCredentials);
    const cached = scopeCache.get(cacheKey);

    if (cached) {
      return cached;
    }

    const promise = this.listProjects(resolvedCredentials).then((projects) => {
      const activeProjects = projects.filter((project) => !project.archived);
      const configuredProjectName = resolvedCredentials.projectName
        .trim()
        .toLowerCase();
      const project =
        activeProjects.find(
          (entry) => entry.name.trim().toLowerCase() === configuredProjectName,
        ) ?? activeProjects[0];

      if (!project) {
        throw new Error("Superwall did not return any active projects.");
      }

      const applicationIds =
        resolvedCredentials.applicationIds.length > 0
          ? resolvedCredentials.applicationIds
          : project.applications.map((application) => application.id);
      const organizationId =
        resolvedCredentials.organizationId ?? project.organizationId;

      if (applicationIds.length === 0) {
        throw new Error(
          `Superwall project ${project.name} did not return any active applications.`,
        );
      }

      return {
        applicationIds,
        organizationId,
      } satisfies SuperwallQueryScope;
    });

    scopeCache.set(cacheKey, promise);
    return promise;
  }

  async queryRaw(args: {
    credentials?: SuperwallCredentialValue;
    organizationId?: number;
    signal?: AbortSignal;
    sql: string;
  }) {
    const resolvedCredentials = getSuperwallRequestCredentials(args.credentials);
    const organizationId =
      args.organizationId ??
      (await this.resolveQueryScope(resolvedCredentials)).organizationId;

    return this.request<string>({
      body: args.sql,
      credentials: resolvedCredentials,
      method: "POST",
      path: `/v2/organizations/${organizationId}/query`,
      responseType: "text",
      signal: args.signal,
    });
  }

  async queryJsonEachRow<T>(args: {
    credentials?: SuperwallCredentialValue;
    organizationId?: number;
    signal?: AbortSignal;
    sql: string;
  }) {
    const payload = await this.queryRaw(args);
    return parseJsonEachRow<T>(payload);
  }
}

export const superwallClient = new SuperwallClient();
