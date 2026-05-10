import { z } from "zod";

import { prisma } from "@/lib/db";
import { requireOrganizationMembership } from "@/server/auth/organizations";
import { canManageOrganization } from "@/server/auth/roles";

import {
  getManagedSecretDefinition,
  isManagedSecretKey,
  managedSecretDefinitions,
  type ManagedSecretKey,
} from "./managed-secrets-definitions";
import {
  decryptCredentialValue,
  encryptCredentialValue,
} from "./credential-crypto";

export { managedSecretDefinitions, type ManagedSecretKey };

export type CredentialSource = "database" | "environment" | "missing";

export type EffectiveCredential<T> =
  | {
      configured: true;
      source: Exclude<CredentialSource, "missing">;
      value: T;
    }
  | {
      configured: false;
      source: "missing";
      value: null;
    };

export type ViewsBaseCredentialValue = {
  baseUrl: string;
  cookieName: string;
  cookieValue: string;
  defaultOrgSlug: string | null;
};

export type AdaptyCredentialValue = {
  apiBaseUrl: string;
  apiKey: string;
  appleSourcePatterns: string;
  creatorSourcePatterns: string;
  tiktokSegmentation:
    | "attribution_source"
    | "attribution_channel"
    | "attribution_campaign"
    | "attribution_adgroup"
    | "attribution_adset"
    | "attribution_creative";
  tiktokSourcePatterns: string;
};

export type AdaptyDashboardCredentialValue = {
  appId: string;
  baseUrl: string;
  companyId: string;
  token: string;
};

const managedSecretInputSchema = z.object({
  key: z.string().trim().min(1),
  value: z.string().trim().min(1).max(64_000),
});

function getViewsBaseStaticConfig() {
  return {
    baseUrl: process.env.VIEWSBASE_BASE_URL || "https://www.viewsbase.com",
    cookieName:
      process.env.VIEWSBASE_SESSION_COOKIE_NAME ||
      "sb-euxaarvxbpiaipzmlesu-auth-token",
    defaultOrgSlug: process.env.VIEWSBASE_DEFAULT_ORG_SLUG || null,
  };
}

function getAdaptyStaticConfig() {
  const segmentation = process.env.ADAPTY_TIKTOK_SEGMENTATION;

  return {
    apiBaseUrl: process.env.ADAPTY_API_BASE_URL || "https://api-admin.adapty.io",
    appleSourcePatterns:
      process.env.ADAPTY_APPLE_SOURCE_PATTERNS ||
      "apple_search_ads,apple search ads,apple ads,apple search,apple searchads,search ads,searchads,asa",
    creatorSourcePatterns:
      process.env.ADAPTY_CREATOR_SOURCE_PATTERNS || "social custom",
    tiktokSegmentation:
      segmentation === "attribution_channel" ||
      segmentation === "attribution_campaign" ||
      segmentation === "attribution_adgroup" ||
      segmentation === "attribution_adset" ||
      segmentation === "attribution_creative"
        ? segmentation
        : "attribution_source",
    tiktokSourcePatterns:
      process.env.ADAPTY_TIKTOK_SOURCE_PATTERNS || "tiktok,tik tok",
  } satisfies Omit<AdaptyCredentialValue, "apiKey">;
}

function getAdaptyDashboardStaticConfig() {
  return {
    appId: process.env.ADAPTY_DASHBOARD_APP_ID || null,
    baseUrl:
      process.env.ADAPTY_DASHBOARD_BASE_URL ||
      "https://api-asa-admin.adapty.io/api/v1",
    companyId: process.env.ADAPTY_DASHBOARD_COMPANY_ID || null,
  };
}

function getPreview(value: string) {
  const trimmed = value.trim();

  if (trimmed.length <= 4) {
    return "set";
  }

  return `...${trimmed.slice(-4)}`;
}

function getEnvCredentialValue(key: ManagedSecretKey) {
  switch (key) {
    case "VIEWSBASE_SESSION_COOKIE_VALUE":
      return process.env.VIEWSBASE_SESSION_COOKIE_VALUE || null;
    case "ADAPTY_API_KEY":
      return process.env.ADAPTY_API_KEY || null;
    case "ADAPTY_DASHBOARD_TOKEN":
      return process.env.ADAPTY_DASHBOARD_TOKEN || null;
  }
}

async function getOrganizationCredential(args: {
  organizationId: string;
  key: ManagedSecretKey;
}) {
  const credential = await prisma.organizationIntegrationCredential.findUnique({
    where: {
      organizationId_key: {
        organizationId: args.organizationId,
        key: args.key,
      },
    },
  });

  if (!credential) {
    return null;
  }

  return {
    ...credential,
    value: decryptCredentialValue(credential.encryptedValue),
  };
}

async function getEffectiveCredentialValue(args: {
  organizationSlug: string;
  key: ManagedSecretKey;
}): Promise<EffectiveCredential<string>> {
  const membership = await requireOrganizationMembership(args.organizationSlug);
  const credential = await getOrganizationCredential({
    organizationId: membership.organizationId,
    key: args.key,
  });

  if (credential) {
    return {
      configured: true,
      source: "database",
      value: credential.value,
    };
  }

  const envValue = getEnvCredentialValue(args.key);

  return envValue
    ? {
        configured: true,
        source: "environment",
        value: envValue,
      }
    : {
        configured: false,
        source: "missing",
        value: null,
      };
}

export async function getViewsBaseCredentials(
  organizationSlug: string,
): Promise<EffectiveCredential<ViewsBaseCredentialValue>> {
  const credential = await getEffectiveCredentialValue({
    organizationSlug,
    key: "VIEWSBASE_SESSION_COOKIE_VALUE",
  });

  if (!credential.configured) {
    return credential;
  }

  const staticConfig = getViewsBaseStaticConfig();

  return {
    configured: true,
    source: credential.source,
    value: {
      baseUrl: staticConfig.baseUrl,
      cookieName: staticConfig.cookieName,
      cookieValue: credential.value,
      defaultOrgSlug: staticConfig.defaultOrgSlug,
    },
  };
}

export async function getAdaptyCredentials(
  organizationSlug: string,
): Promise<EffectiveCredential<AdaptyCredentialValue>> {
  const credential = await getEffectiveCredentialValue({
    organizationSlug,
    key: "ADAPTY_API_KEY",
  });

  if (!credential.configured) {
    return credential;
  }

  const staticConfig = getAdaptyStaticConfig();

  return {
    configured: true,
    source: credential.source,
    value: {
      apiBaseUrl: staticConfig.apiBaseUrl,
      apiKey: credential.value,
      appleSourcePatterns: staticConfig.appleSourcePatterns,
      creatorSourcePatterns: staticConfig.creatorSourcePatterns,
      tiktokSegmentation: staticConfig.tiktokSegmentation,
      tiktokSourcePatterns: staticConfig.tiktokSourcePatterns,
    },
  };
}

export async function getAdaptyDashboardCredentials(
  organizationSlug: string,
): Promise<EffectiveCredential<AdaptyDashboardCredentialValue>> {
  const credential = await getEffectiveCredentialValue({
    organizationSlug,
    key: "ADAPTY_DASHBOARD_TOKEN",
  });

  const staticConfig = getAdaptyDashboardStaticConfig();

  if (!credential.configured || !staticConfig.appId || !staticConfig.companyId) {
    return {
      configured: false,
      source: "missing",
      value: null,
    };
  }

  return {
    configured: true,
    source: credential.source,
    value: {
      appId: staticConfig.appId,
      baseUrl: staticConfig.baseUrl,
      companyId: staticConfig.companyId,
      token: credential.value,
    },
  };
}

export async function getManagedSecretRuntimeStatuses(organizationSlug: string) {
  const membership = await requireOrganizationMembership(organizationSlug);
  const rows = await prisma.organizationIntegrationCredential.findMany({
    where: {
      organizationId: membership.organizationId,
    },
  });
  const rowsByKey = new Map(
    rows.map((row) => [row.key, row]),
  );

  return managedSecretDefinitions.map((definition) => {
    const row = rowsByKey.get(definition.key);
    const envValue = getEnvCredentialValue(definition.key);

    return {
      ...definition,
      configured: Boolean(row || envValue),
      lastUpdatedAt: row?.updatedAt ?? null,
      preview: row?.valuePreview ?? (envValue ? "env fallback" : null),
      source: row ? "database" : envValue ? "environment" : "missing",
    };
  });
}

export async function upsertOrganizationManagedCredential(args: {
  organizationSlug: string;
  key: string;
  value: string;
}) {
  const membership = await requireOrganizationMembership(args.organizationSlug);

  if (!canManageOrganization(membership.role)) {
    throw new Error("Settings access denied.");
  }

  const input = managedSecretInputSchema.parse({
    key: args.key,
    value: args.value,
  });

  if (!isManagedSecretKey(input.key)) {
    throw new Error("This setting cannot be updated from the dashboard.");
  }

  const definition = getManagedSecretDefinition(input.key);

  if (!definition) {
    throw new Error("Unknown managed setting.");
  }

  await prisma.organizationIntegrationCredential.upsert({
    where: {
      organizationId_key: {
        organizationId: membership.organizationId,
        key: input.key,
      },
    },
    create: {
      encryptedValue: encryptCredentialValue(input.value),
      key: input.key,
      organization: {
        connect: {
          id: membership.organizationId,
        },
      },
      valuePreview: getPreview(input.value),
    },
    update: {
      encryptedValue: encryptCredentialValue(input.value),
      lastValidatedAt: null,
      lastValidationError: null,
      lastValidationStatus: null,
      valuePreview: getPreview(input.value),
    },
  });

  return {
    key: input.key,
    label: definition.label,
  };
}
