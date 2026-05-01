import { Platform } from "@/lib/prisma-shim";
import { z } from "zod";

export const createVideoSchema = z.object({
  creatorId: z.string().min(1).max(191),
  creatorPlatformAccountId: z.string().min(1).max(191).optional(),
  campaignId: z.string().min(1).max(191).optional(),
  sourceVideoId: z.string().max(255).optional(),
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
  organizationId: z.string().min(1).max(191),
  campaignId: z.string().min(1).max(191).optional(),
  creatorId: z.string().min(1).max(191).optional(),
  platform: z.nativeEnum(Platform).optional(),
  publishedAfter: z.coerce.date().optional(),
  publishedBefore: z.coerce.date().optional(),
});

export const trackVideoSchema = z.object({
  videoUrl: z.string().trim().max(4096).url(),
  campaignId: z.string().min(1, "Choose a campaign you can access.").max(191),
});

export const setVideoReviewSchema = z.object({
  videoId: z.string().min(1).max(191),
  action: z.enum(["mark-reviewed", "clear-reviewed"]),
});

export type CreateVideoInput = z.infer<typeof createVideoSchema>;
export type VideoFiltersInput = z.infer<typeof videoFiltersSchema>;
export type TrackVideoInput = z.infer<typeof trackVideoSchema>;
export type SetVideoReviewInput = z.infer<typeof setVideoReviewSchema>;
