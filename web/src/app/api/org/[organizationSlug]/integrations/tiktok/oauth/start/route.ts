import { NextRequest, NextResponse } from "next/server";

import { hasTikTokBusinessOauthEnv } from "@/lib/server-env";
import { requireOrganizationMembership } from "@/server/auth/organizations";
import { canManageOrganization } from "@/server/auth/roles";
import {
  buildTikTokAuthorizationUrl,
  createTikTokOauthState,
  getTikTokOauthCookieOptions,
  getTikTokOauthStateCookieName,
  getTikTokOauthStateMaxAgeSeconds,
} from "@/server/tiktok-business/oauth";

type RouteContext = {
  params: Promise<{
    organizationSlug: string;
  }>;
};

function buildIntegrationsErrorHref(organizationSlug: string, error: string) {
  const searchParams = new URLSearchParams({
    error,
  });

  return `/org/${organizationSlug}/integrations?${searchParams.toString()}`;
}

export async function GET(request: NextRequest, context: RouteContext) {
  const { organizationSlug } = await context.params;

  if (!hasTikTokBusinessOauthEnv()) {
    return NextResponse.redirect(
      new URL(
        buildIntegrationsErrorHref(
          organizationSlug,
          "TikTok OAuth is not configured in this environment yet.",
        ),
        request.url,
      ),
    );
  }

  const membership = await requireOrganizationMembership(organizationSlug);

  if (!canManageOrganization(membership.role)) {
    return NextResponse.redirect(
      new URL(
        buildIntegrationsErrorHref(organizationSlug, "Integration access denied."),
        request.url,
      ),
    );
  }

  const returnTo =
    request.nextUrl.searchParams.get("next") ?? `/org/${organizationSlug}/integrations`;
  const state = createTikTokOauthState({
    organizationSlug,
    returnTo,
  });
  const response = NextResponse.redirect(buildTikTokAuthorizationUrl({ state }));

  response.cookies.set(
    getTikTokOauthStateCookieName(),
    state,
    getTikTokOauthCookieOptions(getTikTokOauthStateMaxAgeSeconds()),
  );

  return response;
}
