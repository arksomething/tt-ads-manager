import { NextRequest, NextResponse } from "next/server";
import { ZodError, z } from "zod";

import { resolveTikTokAdsManagerCandidates } from "@/server/tiktok-business/ad-manager-resolver";

const requestSchema = z.object({
  startDate: z.string().trim().min(1),
  endDate: z.string().trim().min(1),
  creativeId: z.string().trim().min(1).nullable().optional(),
  creativeName: z.string().trim().min(1).nullable().optional(),
  creativeUrl: z.string().trim().min(1).nullable().optional(),
  campaignName: z.string().trim().min(1).nullable().optional(),
  subCampaignName: z.string().trim().min(1).nullable().optional(),
});

export async function POST(
  request: NextRequest,
  context: {
    params: Promise<{
      organizationSlug: string;
    }>;
  },
) {
  const { organizationSlug } = await context.params;

  try {
    const payload = requestSchema.parse(await request.json());
    const response = await resolveTikTokAdsManagerCandidates({
      organizationSlug,
      startDate: payload.startDate,
      endDate: payload.endDate,
      singularRow: {
        creativeId: payload.creativeId ?? null,
        creativeName: payload.creativeName ?? null,
        creativeUrl: payload.creativeUrl ?? null,
        campaignName: payload.campaignName ?? null,
        subCampaignName: payload.subCampaignName ?? null,
      },
    });

    return NextResponse.json(response);
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        {
          error: "The TikTok ad resolver payload was invalid.",
          issues: error.issues,
        },
        { status: 400 },
      );
    }

    if (
      error instanceof Error &&
      /No TikTok advertiser account is configured|not enough creative metadata/i.test(
        error.message,
      )
    ) {
      return NextResponse.json(
        {
          error: error.message,
        },
        { status: 400 },
      );
    }

    console.error("TikTok ad resolver failed", error);

    return NextResponse.json(
      {
        error: "Could not resolve a TikTok ad for this creative right now.",
      },
      { status: 500 },
    );
  }
}
