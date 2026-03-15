import { OrganizationRole } from "@prisma/client";
import { z } from "zod";

import { prisma } from "@/lib/db";
import { requireUser } from "@/server/auth/session";

const createOrganizationFromNameSchema = z.object({
  name: z.string().trim().min(2).max(120),
});

function slugifyOrganizationName(name: string) {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");

  return slug || "organization";
}

async function getAvailableOrganizationSlug(baseSlug: string) {
  const similarOrganizations = await prisma.organization.findMany({
    where: {
      slug: {
        startsWith: baseSlug,
      },
    },
    select: {
      slug: true,
    },
  });

  const takenSlugs = new Set(similarOrganizations.map(({ slug }) => slug));

  if (!takenSlugs.has(baseSlug)) {
    return baseSlug;
  }

  let suffix = 2;

  while (takenSlugs.has(`${baseSlug}-${suffix}`)) {
    suffix += 1;
  }

  return `${baseSlug}-${suffix}`;
}

export async function createOrganizationForCurrentUser(input: unknown) {
  const user = await requireUser();
  const { name } = createOrganizationFromNameSchema.parse(input);
  const slug = await getAvailableOrganizationSlug(slugifyOrganizationName(name));

  return prisma.organization.create({
    data: {
      name,
      slug,
      memberships: {
        create: {
          userId: user.id,
          role: OrganizationRole.OWNER,
        },
      },
    },
  });
}
