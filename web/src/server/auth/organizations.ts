import { prisma } from "@/lib/db";

import { requireUser } from "./session";

export async function getViewerOrganizations() {
  const user = await requireUser();

  return prisma.organizationMembership.findMany({
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
}

export async function getOrganizationMembership(organizationSlug: string) {
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
}

export async function requireOrganizationMembership(organizationSlug: string) {
  const membership = await getOrganizationMembership(organizationSlug);

  if (!membership) {
    throw new Error("Organization access denied");
  }

  return membership;
}
