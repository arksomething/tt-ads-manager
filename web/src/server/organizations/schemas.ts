import { OrganizationRole } from "@prisma/client";
import { z } from "zod";

export const createOrganizationSchema = z.object({
  name: z.string().min(2).max(120),
  slug: z
    .string()
    .min(2)
    .max(120)
    .regex(/^[a-z0-9-]+$/),
});

export const inviteMemberSchema = z.object({
  email: z.email(),
  role: z.nativeEnum(OrganizationRole).default(OrganizationRole.MEMBER),
});

export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;
export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;
