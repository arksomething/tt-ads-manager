import { NextRequest, NextResponse } from "next/server";

import { hasTikTokBusinessOauthEnv } from "@/lib/server-env";
import {
  buildTikTokAuthorizationUrl,
  createTikTokPublicOauthState,
  getTikTokOauthCookieOptions,
  getTikTokOauthStateCookieName,
  getTikTokOauthStateMaxAgeSeconds,
} from "@/server/tiktok-business/oauth";
import { sanitizeTikTokPublicReturnPath } from "@/server/tiktok-business/public-session";

function buildReturnPath(args: { returnTo: string; error?: string | null }) {
  const url = new URL(sanitizeTikTokPublicReturnPath(args.returnTo), "https://example.com");

  if (args.error) {
    url.searchParams.set("error", args.error);
  }

  return `${url.pathname}${url.search}`;
}

export async function GET(request: NextRequest) {
  const returnTo = sanitizeTikTokPublicReturnPath(
    request.nextUrl.searchParams.get("next"),
  );

  if (!hasTikTokBusinessOauthEnv()) {
    return NextResponse.redirect(
      new URL(
        buildReturnPath({
          returnTo,
          error: "TikTok OAuth is not configured in this environment yet.",
        }),
        request.url,
      ),
    );
  }

  const state = createTikTokPublicOauthState({
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
