import { ZodError } from "zod";
import { NextResponse } from "next/server";

import { hasAiEnv } from "@/lib/server-env";
import {
  aiAnalyticsChatRequestSchema,
  askAiAnalyticsQuestion,
} from "@/server/ai-analytics/chat";

type RouteContext = {
  params: Promise<{
    organizationSlug: string;
  }>;
};

export async function POST(request: Request, context: RouteContext) {
  const { organizationSlug } = await context.params;

  if (!hasAiEnv()) {
    return NextResponse.json(
      {
        error:
          "AI analytics is not configured yet. Add OPENAI_API_KEY before using this page.",
      },
      { status: 503 },
    );
  }

  try {
    const payload = aiAnalyticsChatRequestSchema.parse(await request.json());
    const response = await askAiAnalyticsQuestion({
      organizationSlug,
      prompt: payload.prompt,
      messages: payload.messages,
      selectedCampaignIds: payload.selectedCampaignIds,
      selectedDateRange: payload.selectedDateRange,
    });

    return NextResponse.json(response);
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        {
          error: "The AI analytics request payload was invalid.",
          issues: error.issues,
        },
        { status: 400 },
      );
    }

    if (
      error instanceof Error &&
      (error.message === "Unauthorized" ||
        error.message === "Organization access denied")
    ) {
      return NextResponse.json(
        {
          error: error.message,
        },
        { status: 403 },
      );
    }

    console.error("AI analytics route failed", error);

    return NextResponse.json(
      {
        error: "The AI analytics request failed.",
      },
      { status: 500 },
    );
  }
}
