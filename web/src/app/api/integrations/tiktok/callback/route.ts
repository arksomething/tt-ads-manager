import { NextRequest, NextResponse } from "next/server";

import { hasTikTokBusinessOauthEnv } from "@/lib/server-env";
import { requireOrganizationMembership } from "@/server/auth/organizations";
import { canManageOrganization } from "@/server/auth/roles";
import {
  createPendingAdvertiserSelectionCookieValue,
  exchangeTikTokAuthCode,
  getAuthorizedTikTokAdvertisers,
  getTikTokOauthCookieOptions,
  getTikTokOauthPendingMaxAgeSeconds,
  getTikTokOauthPendingSelectionCookieName,
  getTikTokOauthStateCookieName,
  saveTikTokOauthAccount,
  validateTikTokOauthState,
} from "@/server/tiktok-business/oauth";

function buildRedirectPath(args: {
  pathname: string;
  notice?: string | null;
  error?: string | null;
}) {
  const url = new URL(args.pathname, "https://example.com");

  if (args.notice) {
    url.searchParams.set("notice", args.notice);
  }

  if (args.error) {
    url.searchParams.set("error", args.error);
  }

  return `${url.pathname}${url.search}`;
}

function createCallbackResponse(request: NextRequest, path: string) {
  return NextResponse.redirect(new URL(path, request.url));
}

function clearTikTokOauthState(response: NextResponse) {
  response.cookies.set(
    getTikTokOauthStateCookieName(),
    "",
    getTikTokOauthCookieOptions(0),
  );
}

export async function GET(request: NextRequest) {
  if (!hasTikTokBusinessOauthEnv()) {
    return NextResponse.json(
      {
        error: "TikTok OAuth is not configured in this environment yet.",
      },
      { status: 503 },
    );
  }

  const receivedState = request.nextUrl.searchParams.get("state");
  const expectedState = request.cookies.get(getTikTokOauthStateCookieName())?.value;

  let statePayload;

  try {
    statePayload = validateTikTokOauthState({
      expectedState,
      receivedState,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "TikTok OAuth state validation failed.",
      },
      { status: 400 },
    );
  }

  const oauthError =
    request.nextUrl.searchParams.get("error_description") ??
    request.nextUrl.searchParams.get("error");

  const authCode =
    request.nextUrl.searchParams.get("auth_code") ??
    request.nextUrl.searchParams.get("code");

  const membership = await requireOrganizationMembership(statePayload.organizationSlug);

  if (!canManageOrganization(membership.role)) {
    const deniedResponse = createCallbackResponse(
      request,
      buildRedirectPath({
        pathname: `/org/${statePayload.organizationSlug}/integrations`,
        error: "Integration access denied.",
      }),
    );

    clearTikTokOauthState(deniedResponse);

    return deniedResponse;
  }

  if (oauthError) {
    const declinedResponse = createCallbackResponse(
      request,
      buildRedirectPath({
        pathname: `/org/${statePayload.organizationSlug}/integrations`,
        error: oauthError,
      }),
    );

    clearTikTokOauthState(declinedResponse);

    return declinedResponse;
  }

  if (!authCode) {
    const missingCodeResponse = createCallbackResponse(
      request,
      buildRedirectPath({
        pathname: `/org/${statePayload.organizationSlug}/integrations`,
        error: "TikTok OAuth did not return an authorization code.",
      }),
    );

    clearTikTokOauthState(missingCodeResponse);

    return missingCodeResponse;
  }

  try {
    const token = await exchangeTikTokAuthCode({
      authCode,
    });
    const advertisers = await getAuthorizedTikTokAdvertisers({
      accessToken: token.accessToken,
    });

    if (advertisers.length === 0) {
      throw new Error(
        "TikTok OAuth succeeded, but no advertiser accounts were returned for this app.",
      );
    }

    if (advertisers.length === 1) {
      await saveTikTokOauthAccount({
        organizationId: membership.organizationId,
        advertiser: advertisers[0],
        token,
      });

      const successResponse = createCallbackResponse(
        request,
        buildRedirectPath({
          pathname: statePayload.returnTo,
          notice: "tiktok-oauth-connected",
        }),
      );

      clearTikTokOauthState(successResponse);
      successResponse.cookies.set(
        getTikTokOauthPendingSelectionCookieName(),
        "",
        getTikTokOauthCookieOptions(0),
      );

      return successResponse;
    }

    const selectionResponse = createCallbackResponse(
      request,
      buildRedirectPath({
        pathname: `/org/${statePayload.organizationSlug}/integrations`,
        notice: "tiktok-select-advertiser",
      }),
    );

    clearTikTokOauthState(selectionResponse);
    selectionResponse.cookies.set(
      getTikTokOauthPendingSelectionCookieName(),
      createPendingAdvertiserSelectionCookieValue({
        organizationSlug: statePayload.organizationSlug,
        returnTo: statePayload.returnTo,
        advertisers,
        token,
      }),
      getTikTokOauthCookieOptions(getTikTokOauthPendingMaxAgeSeconds()),
    );

    return selectionResponse;
  } catch (error) {
    const failureResponse = createCallbackResponse(
      request,
      buildRedirectPath({
        pathname: `/org/${statePayload.organizationSlug}/integrations`,
        error:
          error instanceof Error
            ? error.message
            : "TikTok OAuth callback failed.",
      }),
    );

    clearTikTokOauthState(failureResponse);

    return failureResponse;
  }
}
