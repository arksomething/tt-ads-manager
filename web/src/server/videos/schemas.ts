import { Platform } from "@prisma/client";
import { z } from "zod";

export const createVideoSchema = z.object({
  creatorId: z.string().cuid(),
  creatorPlatformAccountId: z.string().cuid().optional(),
  campaignId: z.string().cuid().optional(),
  viralVideoId: z.string().max(255).optional(),
  platform: z.nativeEnum(Platform),
  videoUrl: z.url(),
  titleOrCaption: z.string().max(5000).optional(),
  publishedAt: z.coerce.date().optional(),
  views: z.number().int().nonnegative().optional(),
  likes: z.number().int().nonnegative().optional(),
  comments: z.number().int().nonnegative().optional(),
  engagementRate: z.number().nonnegative().optional(),
  contentTags: z.array(z.string().min(1).max(64)).default([]),
  hookSummary: z.string().max(500).optional(),
});

export const videoFiltersSchema = z.object({
  organizationId: z.string().cuid(),
  campaignId: z.string().cuid().optional(),
  creatorId: z.string().cuid().optional(),
  platform: z.nativeEnum(Platform).optional(),
  publishedAfter: z.coerce.date().optional(),
  publishedBefore: z.coerce.date().optional(),
});

export type CreateVideoInput = z.infer<typeof createVideoSchema>;
export type VideoFiltersInput = z.infer<typeof videoFiltersSchema>;
