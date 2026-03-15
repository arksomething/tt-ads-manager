import { CampaignStatus } from "@prisma/client";
import { z } from "zod";

export const createCampaignSchema = z.object({
  organizationId: z.string().cuid(),
  name: z.string().min(2).max(160),
  ownerUserId: z.string().cuid().optional(),
  status: z.nativeEnum(CampaignStatus).default(CampaignStatus.DRAFT),
  budget: z.number().nonnegative().optional(),
  currency: z.string().min(3).max(3).default("USD"),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
  targetKpis: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
  notesSummary: z.string().max(5000).optional(),
});

export const updateCampaignSchema = createCampaignSchema
  .omit({ organizationId: true })
  .partial()
  .refine(
    (value) =>
      !value.startDate ||
      !value.endDate ||
      value.endDate.getTime() >= value.startDate.getTime(),
    {
      message: "Campaign end date must be on or after the start date.",
      path: ["endDate"],
    },
  );

export const addCreatorToCampaignSchema = z.object({
  campaignId: z.string().cuid(),
  creatorId: z.string().cuid(),
  agreedRate: z.number().nonnegative().optional(),
  dueDate: z.coerce.date().optional(),
  internalNotes: z.string().max(5000).optional(),
});

export type CreateCampaignInput = z.infer<typeof createCampaignSchema>;
export type UpdateCampaignInput = z.infer<typeof updateCampaignSchema>;
export type AddCreatorToCampaignInput = z.infer<
  typeof addCreatorToCampaignSchema
>;
