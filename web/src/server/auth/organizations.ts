import { OrganizationRole, type Organization, type OrganizationMembership } from "@/lib/prisma-shim";
import { cache } from "react";

import { prisma } from "@/lib/db";
import { isAuthDisabled } from "@/lib/server-env";
import {
  getOrganizationDisplayName,
  normalizeOrganizationNameKey,
} from "@/server/organizations/naming";

import { getCurrentUser } from "./session";

type OrganizationMembershipWithOrganization = OrganizationMembership & {
  organization: Organization;
};

function createPublicMembership(
  organization: Organization,
): OrganizationMembershipWithOrganization {
  return {
    id: `public-${organization.id}`,
    organizationId: organization.id,
    userId: "public-access",
    role: OrganizationRole.OWNER,
    createdAt: organization.createdAt,
    updatedAt: organization.updatedAt,
    organization,
  };
}

export const getViewerOrganizations = cache(async () => {
  const user = await getCurrentUser();
  const memberships = user?.id
    ? await prisma.organizationMembership.findMany({
        where: {
          userId: user.id,
        },
        include: {
          organization: true,
        },
        orderBy: {
          organization: {
            name: "asc",
          },
        },
      })
    : isAuthDisabled()
      ? (
          await prisma.organization.findMany({
            orderBy: {
              name: "asc",
            },
          })
        ).map(createPublicMembership)
      : [];

  const organizationNameCounts = memberships.reduce((counts, membership) => {
    const key = normalizeOrganizationNameKey(membership.organization.name);
    counts.set(key, (counts.get(key) ?? 0) + 1);
    return counts;
  }, new Map<string, number>());

  return memberships.map((membership) => {
    const hasNameCollision =
      (organizationNameCounts.get(
        normalizeOrganizationNameKey(membership.organization.name),
      ) ?? 0) > 1;

    return {
      ...membership,
      organization: {
        ...membership.organization,
        displayName: getOrganizationDisplayName({
          name: membership.organization.name,
          slug: membership.organization.slug,
          hasNameCollision,
        }),
      },
    };
  });
});

export const getOrganizationMembership = cache(async (organizationSlug: string) => {
  const user = await getCurrentUser();

  if (user?.id) {
    return prisma.organizationMembership.findFirst({
      where: {
        userId: user.id,
        organization: {
          slug: organizationSlug,
        },
      },
      include: {
        organization: true,
      },
    });
  }

  if (!isAuthDisabled()) {
    return null;
  }

  const organization = await prisma.organization.findUnique({
    where: {
      slug: organizationSlug,
    },
  });

  return organization ? createPublicMembership(organization) : null;
});

export async function requireOrganizationMembership(organizationSlug: string) {
  const membership = await getOrganizationMembership(organizationSlug);

  if (!membership) {
    throw new Error("Organization access denied");
  }

  return membership;
}
