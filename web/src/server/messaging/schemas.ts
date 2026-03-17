import { MessagingChannel } from "@prisma/client";
import { z } from "zod";

const e164PhoneSchema = z
  .string()
  .trim()
  .regex(/^\+[1-9]\d{7,14}$/, "Enter a valid E.164 phone number.");

const optionalTrimmedString = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((value) => {
    if (typeof value !== "string") {
      return undefined;
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  });

export const creatorContactPointSchema = z.object({
  creatorId: z.string().trim().min(1),
  channel: z.nativeEnum(MessagingChannel),
  phoneE164: e164PhoneSchema,
  isPrimary: z.boolean().optional().default(true),
});

export const sparkCodeRequestSchema = z
  .object({
    creatorId: z.string().trim().min(1),
    channel: z.nativeEnum(MessagingChannel),
    contactPointId: optionalTrimmedString,
    videoId: optionalTrimmedString,
    messageBody: optionalTrimmedString,
  })
  .transform((value) => ({
    ...value,
    contactPointId: value.contactPointId ?? null,
    videoId: value.videoId ?? null,
    messageBody: value.messageBody ?? null,
  }));

export const organizationTwilioConfigSchema = z.object({
  enabled: z.boolean().optional().default(true),
  messagingServiceSid: optionalTrimmedString,
  smsFrom: optionalTrimmedString,
  whatsappFrom: optionalTrimmedString,
});

export const organizationTikTokAccountSchema = z.object({
  advertiserId: z.string().trim().min(1),
  accessToken: z.string().trim().min(1),
  scope: optionalTrimmedString,
  status: optionalTrimmedString,
});

export const twilioTestMessageSchema = z.object({
  toE164: e164PhoneSchema,
  channel: z.nativeEnum(MessagingChannel),
  body: z
    .string()
    .trim()
    .min(1)
    .max(1000)
    .default("Billion Views Twilio integration test message."),
});

export type SparkCodeRequestInput = z.infer<typeof sparkCodeRequestSchema>;
