import { cache } from "react";

import { prisma } from "@/lib/db";
import {
  getOrganizationDisplayName,
  normalizeOrganizationNameKey,
} from "@/server/organizations/naming";

import { requireUser } from "./session";

export const getViewerOrganizations = cache(async () => {
  const user = await requireUser();

  const memberships = await prisma.organizationMembership.findMany({
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
  });

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
  const user = await requireUser();

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
});

export async function requireOrganizationMembership(organizationSlug: string) {
  const membership = await getOrganizationMembership(organizationSlug);

  if (!membership) {
    throw new Error("Organization access denied");
  }

  return membership;
}
