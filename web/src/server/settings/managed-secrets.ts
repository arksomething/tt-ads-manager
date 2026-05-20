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

function parseNumericCsv(value: string | undefined) {
  return (value ?? "")
    .split(",")
    .map((entry) => Number(entry.trim()))
    .filter((entry) => Number.isInteger(entry) && entry > 0);
}

function parseNullablePositiveInteger(value: string | undefined) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function getSuperwallStaticConfig() {
  return {
    apiBaseUrl: process.env.SUPERWALL_API_BASE_URL || "https://api.superwall.com",
    applicationIds: parseNumericCsv(process.env.SUPERWALL_APPLICATION_IDS),
    appleSourcePatterns:
      process.env.SUPERWALL_APPLE_SOURCE_PATTERNS ||
      "apple_search_ads,apple search ads,apple ads,apple search,apple searchads,search ads,searchads,asa",
    creatorSourcePatterns:
      process.env.SUPERWALL_CREATOR_SOURCE_PATTERNS ||
      "social custom",
    organizationId: parseNullablePositiveInteger(
      process.env.SUPERWALL_ORGANIZATION_ID,
    ),
    projectName: process.env.SUPERWALL_PROJECT_NAME || "GoTall",
    tiktokSourcePatterns:
      process.env.SUPERWALL_TIKTOK_SOURCE_PATTERNS ||
      "tiktok,tik tok",
  } satisfies Omit<SuperwallCredentialValue, "apiKey">;
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
    case "SUPERWALL_API_KEY":
      return process.env.SUPERWALL_API_KEY || null;
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

export async function getSuperwallCredentials(
  organizationSlug: string,
): Promise<EffectiveCredential<SuperwallCredentialValue>> {
  const credential = await getEffectiveCredentialValue({
    organizationSlug,
    key: "SUPERWALL_API_KEY",
  });

  if (!credential.configured) {
    return credential;
  }

  const staticConfig = getSuperwallStaticConfig();

  return {
    configured: true,
    source: credential.source,
    value: {
      apiBaseUrl: staticConfig.apiBaseUrl,
      apiKey: credential.value,
      applicationIds: staticConfig.applicationIds,
      appleSourcePatterns: staticConfig.appleSourcePatterns,
      creatorSourcePatterns: staticConfig.creatorSourcePatterns,
      organizationId: staticConfig.organizationId,
      projectName: staticConfig.projectName,
      tiktokSourcePatterns: staticConfig.tiktokSourcePatterns,
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
