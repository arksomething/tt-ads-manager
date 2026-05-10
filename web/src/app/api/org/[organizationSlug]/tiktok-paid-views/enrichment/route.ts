import { NextRequest, NextResponse } from "next/server";
import { ZodError, z } from "zod";

import { processViralPostEnrichmentQueue } from "@/server/singular/viral-post-enrichment";

const requestSchema = z.object({
  postIds: z.array(z.string().trim().min(1)).max(100),
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
    const result = await processViralPostEnrichmentQueue({
      organizationSlug,
      platformVideoIds: payload.postIds,
      limit: 2,
    });

    return NextResponse.json({
      attributions: Object.fromEntries(result.attributions),
      failedPostIds: result.failedPostIds,
      pendingPostIds: result.pendingPostIds,
      processedCount: result.processedCount,
      rateLimited: result.rateLimited,
    });
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        {
          error: "The viral.app enrichment payload was invalid.",
          issues: error.issues,
        },
        { status: 400 },
      );
    }

    if (error instanceof Error && /Organization access denied/i.test(error.message)) {
      return NextResponse.json(
        {
          error: "Organization access denied.",
        },
        { status: 403 },
      );
    }

    console.error("viral.app enrichment poll failed", error);

    return NextResponse.json(
      {
        error: "Could not process viral.app enrichment right now.",
      },
      { status: 500 },
    );
  }
}
