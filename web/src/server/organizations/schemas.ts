import { OrganizationRole } from "@/lib/prisma-shim";
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
  campaignAccessScope: z.enum(["all", "selected"]).default("all"),
  campaignIds: z.array(z.string().min(1).max(191)).default([]),
});

export const updateOrganizationMemberRoleSchema = z.object({
  membershipId: z.string().min(1).max(191),
  role: z.nativeEnum(OrganizationRole),
});

export const removeOrganizationMemberSchema = z.object({
  membershipId: z.string().min(1).max(191),
});

export const revokeOrganizationInvitationSchema = z.object({
  invitationId: z.string().min(1).max(191),
});

export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;
export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;
export type UpdateOrganizationMemberRoleInput = z.infer<
  typeof updateOrganizationMemberRoleSchema
>;
export type RemoveOrganizationMemberInput = z.infer<
  typeof removeOrganizationMemberSchema
>;
export type RevokeOrganizationInvitationInput = z.infer<
  typeof revokeOrganizationInvitationSchema
>;
