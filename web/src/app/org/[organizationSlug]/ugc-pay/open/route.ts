import { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import {
  getCreatorPortalSessionCookie,
  getOrCreateCreatorPortalAccessForOrganization,
} from "@/server/creator-portal/access";

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

function buildDirectoryErrorHref(organizationSlug: string, message: string) {
  const searchParams = new URLSearchParams({
    error: message,
  });

  return `/org/${organizationSlug}/ugc-pay?${searchParams.toString()}`;
}

function redirectTo(request: NextRequest, href: string) {
  return NextResponse.redirect(new URL(href, request.url));
}

export async function GET(request: NextRequest, context: RouteContext) {
  const organizationSlug = await getOrganizationSlug(context);
  const campaignCreatorId =
    request.nextUrl.searchParams.get("campaignCreatorId")?.trim() ?? "";

  if (!campaignCreatorId) {
    return redirectTo(
      request,
      buildDirectoryErrorHref(organizationSlug, "Choose a creator."),
    );
  }

  let accessId: string;

  try {
    const access = await getOrCreateCreatorPortalAccessForOrganization({
      organizationSlug,
      campaignCreatorId,
    });
    accessId = access.accessId;
  } catch (error) {
    return redirectTo(
      request,
      buildDirectoryErrorHref(
        organizationSlug,
        error instanceof Error ? error.message : "Could not open that creator portal.",
      ),
    );
  }

  const response = redirectTo(request, "/creator");
  const sessionCookie = getCreatorPortalSessionCookie(accessId);
  response.cookies.set(
    sessionCookie.name,
    sessionCookie.value,
    sessionCookie.options,
  );
  return response;
}
