import { CreatorDealPaidTrafficMetric } from "@/lib/prisma-shim";
import { z } from "zod";

function emptyToUndefined(value: unknown) {
  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

const optionalDateField = z.preprocess(
  emptyToUndefined,
  z.coerce.date().optional(),
);

const optionalCurrencyField = z.preprocess(
  emptyToUndefined,
  z.coerce.number().nonnegative().optional(),
);

const optionalIntegerField = z.preprocess(
  emptyToUndefined,
  z.coerce.number().int().nonnegative().optional(),
);

const positiveIntegerField = z.preprocess(
  emptyToUndefined,
  z.coerce.number().int().positive().optional(),
);

const optionalStringField = z.preprocess(
  emptyToUndefined,
  z.string().max(5000).optional(),
);

export const upsertCampaignCreatorDealSchema = z
  .object({
    campaignCreatorId: z.string().min(1).max(191),
    currency: z
      .string()
      .trim()
      .length(3)
      .transform((value) => value.toUpperCase())
      .default("USD"),
    effectiveStartDate: z.coerce.date(),
    effectiveEndDate: optionalDateField,
    fixedFee: optionalCurrencyField,
    fixedFeeRecognitionDate: optionalDateField,
    cpmAmount: optionalCurrencyField.default(1),
    paidTrafficMetric: z
      .nativeEnum(CreatorDealPaidTrafficMetric)
      .default(CreatorDealPaidTrafficMetric.IMPRESSIONS),
    deductPaidTraffic: z.boolean().default(true),
    viewCapPerVideo: optionalIntegerField,
    viewWindowDays: positiveIntegerField.default(30),
    payoutCapPerVideo: optionalCurrencyField.default(100),
    payoutCapTotal: optionalCurrencyField,
    notes: optionalStringField,
  })
  .superRefine((value, context) => {
    if (
      value.effectiveEndDate &&
      value.effectiveEndDate.getTime() < value.effectiveStartDate.getTime()
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["effectiveEndDate"],
        message: "End date must be on or after the start date.",
      });
    }

    if (
      value.fixedFeeRecognitionDate &&
      value.fixedFeeRecognitionDate.getTime() < value.effectiveStartDate.getTime()
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["fixedFeeRecognitionDate"],
        message: "Fixed fee date must be on or after the deal start date.",
      });
    }

    if (value.payoutCapPerVideo !== undefined && value.cpmAmount === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["cpmAmount"],
        message: "CPM must be above zero when a per-video payout cap is set.",
      });
    }
  });

export const deleteCampaignCreatorDealSchema = z.object({
  campaignCreatorId: z.string().min(1).max(191),
});

export type UpsertCampaignCreatorDealInput = z.infer<
  typeof upsertCampaignCreatorDealSchema
>;
export type DeleteCampaignCreatorDealInput = z.infer<
  typeof deleteCampaignCreatorDealSchema
>;
