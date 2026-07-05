import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/db";
import { getDefaultUgcPayStartDateForEndDate } from "@/lib/ugc-pay-date-defaults";
import {
  getOrganizationMembership,
  requireOrganizationMembership,
} from "@/server/auth/organizations";
import {
  canEditCreatorPortalDealTerms,
  canManageOrganization,
  canOpenCreatorPayLinks,
} from "@/server/auth/roles";
import { getCampaignAccess } from "@/server/campaigns/queries";
import {
  CREATOR_PORTAL_COOKIE_NAME,
  createCreatorPortalSessionValue,
  decryptCreatorPortalLinkToken,
  encryptCreatorPortalLinkToken,
  generateCreatorPortalLinkToken,
  getCreatorPortalSessionCookieOptions,
  hashCreatorPortalSecret,
  verifyCreatorPortalSessionValue,
} from "@/server/creator-portal/tokens";

const DEVELOPMENT_COOKIE_SECRET =
  "creator-portal-development-secret-value-for-local-use";
const LINK_ONLY_CODE_PREFIX = "Private link";

type CreatorPortalWorkspaceAccess = {
  encryptedLinkToken?: string | null;
  revokedAt?: Date | null;
};

function getCreatorPortalCookieSecret() {
  const secret = process.env.CREATOR_PORTAL_SECRET ?? process.env.AUTH_SECRET;

  if (secret && secret.length >= 32) {
    return secret;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("Set CREATOR_PORTAL_SECRET or AUTH_SECRET before using creator links.");
  }

  return DEVELOPMENT_COOKIE_SECRET;
}

export function getCreatorPortalSessionCookie(accessId: string) {
  return {
    name: CREATOR_PORTAL_COOKIE_NAME,
    value: createCreatorPortalSessionValue(accessId, getCreatorPortalCookieSecret()),
    options: getCreatorPortalSessionCookieOptions(),
  };
}

function hashLinkToken(token: string) {
  return hashCreatorPortalSecret(token.trim());
}

function getLinkOnlyCodeHash(linkToken: string) {
  return hashCreatorPortalSecret(`creator-portal-link-only:${linkToken}`);
}

function encryptLinkToken(linkToken: string) {
  return encryptCreatorPortalLinkToken(linkToken, getCreatorPortalCookieSecret());
}

function decryptLinkToken(value: string | null | undefined) {
  return value
    ? decryptCreatorPortalLinkToken(value, getCreatorPortalCookieSecret())
    : null;
}

async function requireCreatorLinkManager(organizationSlug: string) {
  const membership = await requireOrganizationMembership(organizationSlug);

  if (!canManageOrganization(membership.role)) {
    throw new Error("Only organization admins and owners can manage creator links.");
  }

  return membership;
}

async function requireCreatorPayLinkOpener(organizationSlug: string) {
  const membership = await requireOrganizationMembership(organizationSlug);

  if (!canOpenCreatorPayLinks(membership.role)) {
    throw new Error("Creator pay link access denied.");
  }

  return membership;
}

function revalidateCreatorLinks(organizationSlug: string) {
  revalidatePath(`/org/${organizationSlug}/links`);
  revalidatePath(`/org/${organizationSlug}/ugc-pay`);
}

export function buildCreatorPortalLinkPath(linkToken: string) {
  return `/creator/link/${encodeURIComponent(linkToken)}`;
}

export async function getCreatorPortalLinksWorkspace(organizationSlug: string) {
  const membership = await requireCreatorPayLinkOpener(organizationSlug);
  const campaignCreators = await prisma.campaignCreator.findMany({
    where: {
      campaign: {
        organizationId: membership.organizationId,
      },
    },
    select: {
      id: true,
      createdAt: true,
      creatorId: true,
      campaign: {
        select: {
          id: true,
          name: true,
        },
      },
      creator: {
        select: {
          id: true,
          displayName: true,
          platformAccounts: {
            select: {
              handle: true,
              platform: true,
            },
            orderBy: [{ platform: "asc" }, { createdAt: "asc" }],
          },
        },
      },
      portalAccesses: {
        where: {
          organizationId: membership.organizationId,
        },
        select: {
          id: true,
          encryptedLinkToken: true,
          revokedAt: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: {
          createdAt: "desc",
        },
      },
    },
    orderBy: [
      {
        campaign: {
          name: "asc",
        },
      },
      {
        creator: {
          displayName: "asc",
        },
      },
    ],
  });

  return {
    organizationId: membership.organizationId,
    campaignCreators: campaignCreators.map((campaignCreator) => ({
      ...campaignCreator,
      portalAccesses: campaignCreator.portalAccesses.map(
        (access: CreatorPortalWorkspaceAccess) => {
        const linkToken = access.revokedAt
          ? null
          : decryptLinkToken(access.encryptedLinkToken);

        return {
          ...access,
          linkPath: linkToken ? buildCreatorPortalLinkPath(linkToken) : null,
        };
        },
      ),
    })),
  };
}

async function getCampaignCreatorForAccess(args: {
  organizationId: string;
  campaignCreatorId: string;
}) {
  const campaignCreator = await prisma.campaignCreator.findFirst({
    where: {
      id: args.campaignCreatorId,
      campaign: {
        organizationId: args.organizationId,
      },
    },
    select: {
      id: true,
      creatorId: true,
    },
  });

  if (!campaignCreator) {
    throw new Error("Creator campaign link was not found.");
  }

  return campaignCreator;
}

export async function createCreatorPortalAccessForOrganization(args: {
  organizationSlug: string;
  campaignCreatorId: string;
}) {
  const membership = await requireCreatorLinkManager(args.organizationSlug);
  const campaignCreator = await getCampaignCreatorForAccess({
    organizationId: membership.organizationId,
    campaignCreatorId: args.campaignCreatorId,
  });
  return createCreatorPortalAccessRecord({
    campaignCreatorId: campaignCreator.id,
    creatorId: campaignCreator.creatorId,
    organizationId: membership.organizationId,
    organizationSlug: args.organizationSlug,
  });
}

async function createCreatorPortalAccessRecord(args: {
  organizationId: string;
  organizationSlug: string;
  creatorId: string;
  campaignCreatorId: string;
}) {
  const linkToken = generateCreatorPortalLinkToken();
  const access = await prisma.creatorPortalAccess.create({
    data: {
      organizationId: args.organizationId,
      creatorId: args.creatorId,
      campaignCreatorId: args.campaignCreatorId,
      linkTokenHash: hashLinkToken(linkToken),
      encryptedLinkToken: encryptLinkToken(linkToken),
      codeHash: getLinkOnlyCodeHash(linkToken),
      codePrefix: LINK_ONLY_CODE_PREFIX,
    },
    select: {
      id: true,
    },
  });

  revalidateCreatorLinks(args.organizationSlug);

  return {
    accessId: access.id as string,
    linkPath: buildCreatorPortalLinkPath(linkToken),
    linkToken,
  };
}

export async function getOrCreateCreatorPortalAccessForOrganization(args: {
  organizationSlug: string;
  campaignCreatorId: string;
}) {
  const membership = await requireCreatorPayLinkOpener(args.organizationSlug);
  const campaignCreator = await getCampaignCreatorForAccess({
    organizationId: membership.organizationId,
    campaignCreatorId: args.campaignCreatorId,
  });
  const existingAccess = await prisma.creatorPortalAccess.findFirst({
    where: {
      organizationId: membership.organizationId,
      campaignCreatorId: campaignCreator.id,
      revokedAt: null,
    },
    select: {
      id: true,
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  if (existingAccess?.id) {
    return {
      accessId: existingAccess.id as string,
      linkPath: null,
      linkToken: null,
    };
  }

  return createCreatorPortalAccessRecord({
    campaignCreatorId: campaignCreator.id,
    creatorId: campaignCreator.creatorId,
    organizationId: membership.organizationId,
    organizationSlug: args.organizationSlug,
  });
}

async function requireManagedCreatorPortalAccess(args: {
  organizationSlug: string;
  accessId: string;
}) {
  const membership = await requireCreatorLinkManager(args.organizationSlug);
  const access = await prisma.creatorPortalAccess.findFirst({
    where: {
      id: args.accessId,
      organizationId: membership.organizationId,
    },
    select: {
      id: true,
    },
  });

  if (!access) {
    throw new Error("Creator link was not found.");
  }

  return access;
}

export async function rotateCreatorPortalAccessForOrganization(args: {
  organizationSlug: string;
  accessId: string;
}) {
  const access = await requireManagedCreatorPortalAccess(args);
  const linkToken = generateCreatorPortalLinkToken();

  await prisma.creatorPortalAccess.update({
    where: {
      id: access.id,
    },
    data: {
      linkTokenHash: hashLinkToken(linkToken),
      encryptedLinkToken: encryptLinkToken(linkToken),
      codeHash: getLinkOnlyCodeHash(linkToken),
      codePrefix: LINK_ONLY_CODE_PREFIX,
      revokedAt: null,
    },
  });

  revalidateCreatorLinks(args.organizationSlug);

  return {
    accessId: access.id as string,
    linkPath: buildCreatorPortalLinkPath(linkToken),
    linkToken,
  };
}

export async function revokeCreatorPortalAccessForOrganization(args: {
  organizationSlug: string;
  accessId: string;
}) {
  const access = await requireManagedCreatorPortalAccess(args);

  await prisma.creatorPortalAccess.update({
    where: {
      id: access.id,
    },
    data: {
      revokedAt: new Date(),
    },
  });

  revalidateCreatorLinks(args.organizationSlug);
}

function getCreatorPortalAccessSelect() {
  return {
    id: true,
    organizationId: true,
    creatorId: true,
    campaignCreatorId: true,
    revokedAt: true,
    organization: {
      select: {
        id: true,
        name: true,
        slug: true,
      },
    },
    creator: {
      select: {
        id: true,
        displayName: true,
        platformAccounts: {
          select: {
            handle: true,
            platform: true,
          },
          orderBy: [{ platform: "asc" }, { createdAt: "asc" }],
        },
      },
    },
    campaignCreator: {
      select: {
        id: true,
        campaignId: true,
        campaign: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    },
  };
}

export async function resolveCreatorPortalAccessByLinkToken(linkToken: string) {
  return prisma.creatorPortalAccess.findFirst({
    where: {
      linkTokenHash: hashLinkToken(linkToken),
      revokedAt: null,
    },
    select: getCreatorPortalAccessSelect(),
  });
}

export async function setCreatorPortalSessionCookie(accessId: string) {
  const cookieStore = await cookies();
  const sessionCookie = getCreatorPortalSessionCookie(accessId);
  cookieStore.set(
    sessionCookie.name,
    sessionCookie.value,
    sessionCookie.options,
  );
}

export async function getCurrentCreatorPortalAccess() {
  const cookieStore = await cookies();
  const accessId = verifyCreatorPortalSessionValue(
    cookieStore.get(CREATOR_PORTAL_COOKIE_NAME)?.value,
    getCreatorPortalCookieSecret(),
  );

  if (!accessId) {
    return null;
  }

  return prisma.creatorPortalAccess.findFirst({
    where: {
      id: accessId,
      revokedAt: null,
    },
    select: getCreatorPortalAccessSelect(),
  });
}

export async function canCurrentUserEditCreatorPortalDeals(args: {
  campaignId?: string | null;
  organizationSlug: string;
}) {
  const membership = await getOrganizationMembership(args.organizationSlug);

  if (
    canEditCreatorPortalDealTerms({
      organizationRole: membership?.role ?? null,
    })
  ) {
    return true;
  }

  if (!membership || !args.campaignId) {
    return false;
  }

  try {
    const campaignAccess = await getCampaignAccess(
      args.organizationSlug,
      args.campaignId,
    );

    return canEditCreatorPortalDealTerms({
      campaignCanManage: campaignAccess.canManageCampaign,
      organizationRole: membership.role,
    });
  } catch {
    return false;
  }
}

function toDateOnlyString(value: Date) {
  return value.toISOString().slice(0, 10);
}

export async function getCreatorPortalDefaultDateRange(args: {
  campaignId?: string | null;
  creatorId: string;
}) {
  const latestVideo = await prisma.video.findFirst({
    where: {
      creatorId: args.creatorId,
      ...(args.campaignId ? { campaignId: args.campaignId } : {}),
    },
    select: {
      createdAt: true,
      publishedAt: true,
    },
    orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
  });
  const latestDate = latestVideo?.publishedAt ?? latestVideo?.createdAt ?? null;

  if (!latestDate) {
    return null;
  }

  return {
    startDate: getDefaultUgcPayStartDateForEndDate(toDateOnlyString(latestDate)),
    endDate: toDateOnlyString(latestDate),
  };
}

export async function clearCreatorPortalSessionCookie() {
  const cookieStore = await cookies();
  cookieStore.delete(CREATOR_PORTAL_COOKIE_NAME);
}
