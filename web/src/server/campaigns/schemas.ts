import { CampaignRole } from "@/lib/prisma-shim";
import { z } from "zod";

export const createCampaignSchema = z.object({
  organizationId: z.string().min(1).max(191),
  name: z.string().min(2).max(160),
  ownerUserId: z.string().min(1).max(191).optional(),
});

export const createOrganizationCampaignSchema = createCampaignSchema.omit({
  organizationId: true,
  ownerUserId: true,
});

export const updateCampaignSchema = z.object({
  name: z.string().min(2).max(160).optional(),
});

export const addCreatorToCampaignSchema = z.object({
  campaignId: z.string().min(1).max(191),
  creatorId: z.string().min(1).max(191),
  agreedRate: z.number().nonnegative().optional(),
  dueDate: z.coerce.date().optional(),
  internalNotes: z.string().max(5000).optional(),
});

export const inviteCampaignMemberSchema = z.object({
  email: z.email(),
  role: z.nativeEnum(CampaignRole).default(CampaignRole.MEMBER),
});

export const updateCampaignMemberRoleSchema = z.object({
  membershipId: z.string().min(1).max(191),
  role: z.enum([CampaignRole.MANAGER, CampaignRole.MEMBER]),
});

export const removeCampaignMemberSchema = z.object({
  membershipId: z.string().min(1).max(191),
});

export const revokeCampaignInvitationSchema = z.object({
  invitationId: z.string().min(1).max(191),
});

export type CreateCampaignInput = z.infer<typeof createCampaignSchema>;
export type CreateOrganizationCampaignInput = z.infer<
  typeof createOrganizationCampaignSchema
>;
export type UpdateCampaignInput = z.infer<typeof updateCampaignSchema>;
export type AddCreatorToCampaignInput = z.infer<
  typeof addCreatorToCampaignSchema
>;
export type InviteCampaignMemberInput = z.infer<
  typeof inviteCampaignMemberSchema
>;
export type UpdateCampaignMemberRoleInput = z.infer<
  typeof updateCampaignMemberRoleSchema
>;
export type RemoveCampaignMemberInput = z.infer<
  typeof removeCampaignMemberSchema
>;
export type RevokeCampaignInvitationInput = z.infer<
  typeof revokeCampaignInvitationSchema
>;
