import { CampaignRole } from "@prisma/client";
import { z } from "zod";

export const createCampaignSchema = z.object({
  organizationId: z.string().cuid(),
  name: z.string().min(2).max(160),
  ownerUserId: z.string().cuid().optional(),
});

export const createOrganizationCampaignSchema = createCampaignSchema.omit({
  organizationId: true,
  ownerUserId: true,
});

export const updateCampaignSchema = z.object({
  name: z.string().min(2).max(160).optional(),
});

export const addCreatorToCampaignSchema = z.object({
  campaignId: z.string().cuid(),
  creatorId: z.string().cuid(),
  agreedRate: z.number().nonnegative().optional(),
  dueDate: z.coerce.date().optional(),
  internalNotes: z.string().max(5000).optional(),
});

export const inviteCampaignMemberSchema = z.object({
  email: z.email(),
  role: z.nativeEnum(CampaignRole).default(CampaignRole.MEMBER),
});

export const updateCampaignMemberRoleSchema = z.object({
  membershipId: z.string().cuid(),
  role: z.enum([CampaignRole.MANAGER, CampaignRole.MEMBER]),
});

export const removeCampaignMemberSchema = z.object({
  membershipId: z.string().cuid(),
});

export const revokeCampaignInvitationSchema = z.object({
  invitationId: z.string().cuid(),
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
