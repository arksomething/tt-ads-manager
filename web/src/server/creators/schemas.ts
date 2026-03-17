import { CreatorStatus, Platform } from "@prisma/client";
import { z } from "zod";

export const trackedAccountMaxVideoOptions = [
  0,
  10,
  30,
  60,
  100,
  200,
  300,
  400,
  500,
  1000,
  2000,
] as const;
const trackedAccountMaxVideoValues = new Set<number>(
  trackedAccountMaxVideoOptions,
);

export const createCreatorSchema = z.object({
  organizationId: z.string().cuid(),
  displayName: z.string().min(2).max(160),
  primaryNiche: z.string().max(100).optional(),
  region: z.string().max(100).optional(),
  language: z.string().max(100).optional(),
  internalStatus: z.nativeEnum(CreatorStatus).default(CreatorStatus.NEW),
  notesSummary: z.string().max(5000).optional(),
  contactEmail: z.email().optional(),
  customTags: z.array(z.string().min(1).max(40)).default([]),
});

export const trackCreatorAccountFormSchema = z.object({
  profileUrl: z.string().trim().max(4096).url(),
  campaignId: z.string().cuid(),
  maxVideos: z.coerce
    .number()
    .int()
    .refine((value) => trackedAccountMaxVideoValues.has(value), {
      message: "Select a valid video limit.",
    }),
});

export const createPlatformAccountSchema = z.object({
  creatorId: z.string().cuid(),
  platform: z.nativeEnum(Platform),
  sourceAccountId: z.string().max(255).optional(),
  handle: z.string().min(1).max(255),
  profileUrl: z.url().optional(),
  followerCount: z.number().int().nonnegative().optional(),
  averageViews: z.number().int().nonnegative().optional(),
  averageEngagementRate: z.number().nonnegative().optional(),
});

export const creatorFiltersSchema = z.object({
  organizationId: z.string().cuid(),
  campaignId: z.string().cuid().optional(),
  platform: z.nativeEnum(Platform).optional(),
  internalStatus: z.nativeEnum(CreatorStatus).optional(),
  niche: z.string().optional(),
  region: z.string().optional(),
  search: z.string().max(160).optional(),
});

export type CreateCreatorInput = z.infer<typeof createCreatorSchema>;
export type TrackCreatorAccountFormInput = z.infer<
  typeof trackCreatorAccountFormSchema
>;
export type CreatePlatformAccountInput = z.infer<
  typeof createPlatformAccountSchema
>;
export type CreatorFiltersInput = z.infer<typeof creatorFiltersSchema>;
