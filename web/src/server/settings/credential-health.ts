import { AdaptyApiError, adaptyClient } from "@/server/adapty/client";
import { adaptyDashboardClient } from "@/server/adapty/dashboard-client";
import {
  getAdaptyCredentials,
  getAdaptyDashboardCredentials,
  getViewsBaseCredentials,
  type ManagedSecretKey,
} from "@/server/settings/managed-secrets";
import { viewsBaseClient, ViewsBaseApiError } from "@/server/viewsbase/client";

export type CredentialHealthStatus = "ok" | "missing" | "failed";

export type CredentialHealthResult = {
  checkedAt: Date;
  key: ManagedSecretKey;
  message: string;
  source: "database" | "environment" | "missing";
  status: CredentialHealthStatus;
};

function todayDateKey() {
  return new Date().toISOString().slice(0, 10);
}

function getErrorMessage(error: unknown) {
  if (error instanceof ViewsBaseApiError) {
    return error.status === 401 || error.status === 403
      ? "Unauthorized. Regenerate the ViewsBase cookie and save it again."
      : error.message;
  }

  if (error instanceof AdaptyApiError) {
    return error.status === 401 || error.status === 403
      ? "Unauthorized. Regenerate the Adapty key and save it again."
      : error.message;
  }

  return error instanceof Error ? error.message : "Credential check failed.";
}

function withTimeout<T>(promise: Promise<T>, timeoutMs = 8_000) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      reject(new Error("Credential check timed out."));
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeout) {
      clearTimeout(timeout);
    }
  });
}

export async function checkManagedCredential(args: {
  organizationSlug: string;
  key: ManagedSecretKey;
}): Promise<CredentialHealthResult> {
  const checkedAt = new Date();

  try {
    switch (args.key) {
      case "VIEWSBASE_SESSION_COOKIE_VALUE": {
        const credentials = await getViewsBaseCredentials(args.organizationSlug);

        if (!credentials.configured) {
          return {
            checkedAt,
            key: args.key,
            message: "No ViewsBase credential is configured.",
            source: "missing",
            status: "missing",
          };
        }

        const orgSlug = credentials.value.defaultOrgSlug ?? "gotall";
        await withTimeout(
          viewsBaseClient.requestText({
            credentials: credentials.value,
            headers: {
              "x-org-slug": orgSlug,
            },
            path: `/${orgSlug}/gotall-larsie`,
          }),
        );

        return {
          checkedAt,
          key: args.key,
          message: "ViewsBase accepted the cookie.",
          source: credentials.source,
          status: "ok",
        };
      }
      case "ADAPTY_API_KEY": {
        const credentials = await getAdaptyCredentials(args.organizationSlug);

        if (!credentials.configured) {
          return {
            checkedAt,
            key: args.key,
            message: "No Adapty API key is configured.",
            source: "missing",
            status: "missing",
          };
        }

        const date = todayDateKey();
        await withTimeout(
          adaptyClient.retrieveAnalyticsData({
            chartId: "revenue",
            credentials: credentials.value,
            filters: {
              date: [date, date],
            },
            periodUnit: "day",
            segmentation: "period",
          }),
        );

        return {
          checkedAt,
          key: args.key,
          message: "Adapty API accepted the key.",
          source: credentials.source,
          status: "ok",
        };
      }
      case "ADAPTY_DASHBOARD_TOKEN": {
        const credentials = await getAdaptyDashboardCredentials(
          args.organizationSlug,
        );

        if (!credentials.configured) {
          return {
            checkedAt,
            key: args.key,
            message:
              "No Adapty dashboard token is configured, or app/company IDs are missing.",
            source: "missing",
            status: "missing",
          };
        }

        const date = todayDateKey();
        await withTimeout(
          adaptyDashboardClient.request<unknown>({
            body: {
              filters: {
                date: [date, date],
              },
            },
            credentials: credentials.value,
            path: "/asa-metadata/campaigns/",
          }),
        );

        return {
          checkedAt,
          key: args.key,
          message: "Adapty Ads Manager accepted the bearer token.",
          source: credentials.source,
          status: "ok",
        };
      }
    }
  } catch (error) {
    return {
      checkedAt,
      key: args.key,
      message: getErrorMessage(error),
      source: "missing",
      status: "failed",
    };
  }
}

export async function getManagedCredentialHealthChecks(organizationSlug: string) {
  return Promise.all([
    checkManagedCredential({
      organizationSlug,
      key: "VIEWSBASE_SESSION_COOKIE_VALUE",
    }),
    checkManagedCredential({
      organizationSlug,
      key: "ADAPTY_API_KEY",
    }),
    checkManagedCredential({
      organizationSlug,
      key: "ADAPTY_DASHBOARD_TOKEN",
    }),
  ]);
}
