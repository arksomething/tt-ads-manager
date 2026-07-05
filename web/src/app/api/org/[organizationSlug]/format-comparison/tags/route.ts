import { NextRequest, NextResponse } from "next/server";

import { setVideoFormatTagForOrganization } from "@/server/dashboard/format-comparison";

type RouteContext = {
  params: Promise<unknown>;
};

async function getOrganizationSlug(context: RouteContext) {
  const params = await context.params;

  if (
    typeof params === "object" &&
    params !== null &&
    "organizationSlug" in params &&
    typeof params.organizationSlug === "string"
  ) {
    return params.organizationSlug;
  }

  throw new Error("Organization slug is missing.");
}

function getTextValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(request: NextRequest, context: RouteContext) {
  const organizationSlug = await getOrganizationSlug(context);

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const sourceVideoId = getTextValue(body.sourceVideoId);

    if (!sourceVideoId) {
      return NextResponse.json(
        {
          error: "Video source id is required.",
        },
        { status: 400 },
      );
    }

    const result = await setVideoFormatTagForOrganization({
      formatTag: getTextValue(body.formatTag),
      organizationSlug,
      sourceVideoId,
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error("Format tag update failed", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not save this format tag right now.",
      },
      { status: 500 },
    );
  }
}
