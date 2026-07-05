import {
  getAdaptyDashboardEnv,
  hasAdaptyDashboardEnv,
} from "@/lib/server-env";

export type AppleSearchAdsDashboardReport = {
  configured: boolean;
  rowCount: number;
  revenue: number | null;
  revenueBasis: "proceeds" | "net" | "gross" | null;
  spend: number | null;
  installs: number | null;
  conversions: number | null;
  warnings: string[];
};

type AdaptyDashboardCredentialValue = {
  appId: string;
  baseUrl: string;
  companyId: string;
  token: string;
};

type DashboardRequestOptions = {
  path: string;
  body: Record<string, unknown>;
  credentials?: AdaptyDashboardCredentialValue;
  signal?: AbortSignal;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const numberValue = Number(value.replace(/,/g, ""));

    if (Number.isFinite(numberValue)) {
      return numberValue;
    }
  }

  return null;
}

function getMetricNumber(
  record: Record<string, unknown> | undefined,
  keys: readonly string[],
) {
  if (!record) {
    return null;
  }

  for (const key of keys) {
    const value = getNumber(record[key]);

    if (value !== null) {
      return value;
    }
  }

  return null;
}

function sumMetricRows(rows: readonly unknown[], keys: readonly string[]) {
  let total = 0;
  let hasValue = false;

  for (const row of rows) {
    if (!isRecord(row) || !isRecord(row.metrics)) {
      continue;
    }

    const value = getMetricNumber(row.metrics, keys);

    if (value === null) {
      continue;
    }

    total += value;
    hasValue = true;
  }

  return hasValue ? total : null;
}

function getRevenueMetric(data: Record<string, unknown> | undefined) {
  if (!data || !isRecord(data.revenue)) {
    return {
      basis: null,
      value: null,
    };
  }

  for (const basis of ["proceeds", "net", "gross"] as const) {
    const metric = data.revenue[basis];

    if (!isRecord(metric)) {
      continue;
    }

    const value = getNumber(metric.total);

    if (value !== null) {
      return {
        basis,
        value,
      };
    }
  }

  return {
    basis: null,
    value: null,
  };
}

function getRows(payload: unknown) {
  if (!isRecord(payload) || !Array.isArray(payload.data)) {
    return [];
  }

  return payload.data;
}

function getInternalIds(rows: readonly unknown[]) {
  return rows
    .map((row) =>
      isRecord(row) &&
      (typeof row.internal_id === "string" ||
        typeof row.internal_id === "number")
        ? String(row.internal_id)
        : null,
    )
    .filter((value): value is string => Boolean(value));
}

export function normalizeAppleSearchAdsDashboardReport(args: {
  campaignPayload: unknown;
  totalPayload?: unknown;
}): AppleSearchAdsDashboardReport {
  const rows = getRows(args.campaignPayload);
  const totalData =
    isRecord(args.totalPayload) && isRecord(args.totalPayload.data)
      ? args.totalPayload.data
      : undefined;
  const revenue = getRevenueMetric(totalData);
  const spend =
    getMetricNumber(totalData, ["spend", "local_spend"]) ??
    sumMetricRows(rows, ["local_spend", "spend"]);
  const installs =
    getMetricNumber(totalData, ["adapty_installs", "total_installs"]) ??
    sumMetricRows(rows, ["total_installs", "adapty_installs"]);
  const conversions =
    getMetricNumber(totalData, [
      "paid",
      "subscriptions_started",
      "trials_converted",
      "conversion",
    ]) ?? null;

  return {
    configured: true,
    conversions,
    installs,
    revenue: revenue.value,
    revenueBasis: revenue.basis,
    rowCount: rows.length,
    spend,
    warnings:
      rows.length > 0 && revenue.value === null
        ? [
            "Adapty Ads Manager returned Apple Search Ads rows without a revenue total.",
          ]
        : [],
  };
}

class AdaptyDashboardClient {
  private getCredentials(credentials?: AdaptyDashboardCredentialValue) {
    if (credentials) {
      return credentials;
    }

    const env = getAdaptyDashboardEnv();
    return {
      appId: env.ADAPTY_DASHBOARD_APP_ID,
      baseUrl: env.ADAPTY_DASHBOARD_BASE_URL,
      companyId: env.ADAPTY_DASHBOARD_COMPANY_ID,
      token: env.ADAPTY_DASHBOARD_TOKEN,
    };
  }

  async request<T>({
    path,
    body,
    credentials,
    signal,
  }: DashboardRequestOptions): Promise<T> {
    const resolvedCredentials = this.getCredentials(credentials);
    const baseUrl = resolvedCredentials.baseUrl.replace(/\/$/, "");
    const response = await fetch(`${baseUrl}${path}`, {
      body: JSON.stringify(body),
      cache: "no-store",
      headers: {
        Accept: "application/json",
        ADAPTY_DASHBOARD_APP_ID: resolvedCredentials.appId,
        ADAPTY_DASHBOARD_COMPANY_ID: resolvedCredentials.companyId,
        Authorization: `Bearer ${resolvedCredentials.token}`,
        "Content-Type": "application/json",
      },
      method: "POST",
      signal,
    });
    const contentType = response.headers.get("content-type") ?? "";
    const payload = contentType.includes("application/json")
      ? await response.json().catch(() => undefined)
      : await response.text().catch(() => undefined);

    if (response.ok) {
      return payload as T;
    }

    throw new Error(
      `Adapty Ads Manager request failed with ${response.status}.`,
    );
  }
}

export const adaptyDashboardClient = new AdaptyDashboardClient();

export async function getAppleSearchAdsDashboardReport(args: {
  startDate: string;
  endDate: string;
}): Promise<AppleSearchAdsDashboardReport> {
  if (!hasAdaptyDashboardEnv()) {
    return {
      configured: false,
      conversions: null,
      installs: null,
      revenue: null,
      revenueBasis: null,
      rowCount: 0,
      spend: null,
      warnings: [],
    };
  }

  try {
    const campaignPayload = await adaptyDashboardClient.request<unknown>({
      body: {
        filters: {
          date: [args.startDate, args.endDate],
        },
      },
      path: "/asa-metadata/campaigns/",
    });
    const rows = getRows(campaignPayload);
    const ids = getInternalIds(rows);
    const totalPayload =
      ids.length > 0
        ? await adaptyDashboardClient.request<unknown>({
            body: {
              filters: {
                date_from: args.startDate,
                date_to: args.endDate,
                ids,
                metrics: ["revenue", "revenue_proceeds", "revenue_net"],
              },
            },
            path: "/asa-metadata/v3/campaign/metrics/total/",
          })
        : undefined;

    return normalizeAppleSearchAdsDashboardReport({
      campaignPayload,
      totalPayload,
    });
  } catch (error) {
    return {
      configured: true,
      conversions: null,
      installs: null,
      revenue: null,
      revenueBasis: null,
      rowCount: 0,
      spend: null,
      warnings: [
        error instanceof Error
          ? error.message
          : "Could not load Adapty Ads Manager Apple Search Ads data.",
      ],
    };
  }
}
