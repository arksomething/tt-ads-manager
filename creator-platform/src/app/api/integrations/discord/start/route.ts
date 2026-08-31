import { NextResponse, type NextRequest } from "next/server";

import { getDiscordOAuthConfig } from "@/lib/discord/config";
import { hasSupabaseAuthEnv } from "@/lib/server-env";
import {
  copySupabaseResponseState,
  createRouteHandlerClient,
} from "@/lib/supabase/server";
import { buildDiscordAuthorizationUrl } from "@/server/discord/oauth";
import {
  discordAccountRedirect,
  noStoreDiscordResponse,
} from "@/server/discord/http";
import {
  createDiscordOAuthState,
  hashDiscordOAuthState,
  sanitizeDiscordReturnPath,
} from "@/server/discord/state";

const oauthAttemptLifetimeMs = 10 * 60 * 1_000;

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const returnPath = sanitizeDiscordReturnPath(
    request.nextUrl.searchParams.get("returnTo") ??
      request.nextUrl.searchParams.get("return"),
  );

  if (!hasSupabaseAuthEnv()) {
    return discordAccountRedirect(request, returnPath, {
      error: "Discord connection is not configured yet.",
    });
  }

  const authResponse = NextResponse.next();
  const supabase = createRouteHandlerClient(request, authResponse);
  const { data, error } = await supabase.auth.getUser();
  const user = data?.user;

  if (error || !user) {
    const signInUrl = new URL("/auth/sign-in", request.url);
    signInUrl.searchParams.set("next", returnPath);
    signInUrl.searchParams.set("error", "Sign in before connecting Discord.");
    return noStoreDiscordResponse(
      copySupabaseResponseState(
        authResponse,
        NextResponse.redirect(signInUrl, 303),
      ),
    );
  }

  if (!user.email || !user.email_confirmed_at) {
    const confirmationUrl = new URL("/auth/check-email", request.url);
    confirmationUrl.searchParams.set("next", returnPath);
    confirmationUrl.searchParams.set(
      "error",
      "Confirm your email before connecting Discord.",
    );
    return noStoreDiscordResponse(
      copySupabaseResponseState(
        authResponse,
        NextResponse.redirect(confirmationUrl, 303),
      ),
    );
  }

  try {
    const config = getDiscordOAuthConfig();
    const state = createDiscordOAuthState();
    const expiresAt = new Date(Date.now() + oauthAttemptLifetimeMs).toISOString();
    const { error: attemptError } = await supabase.rpc(
      "create_discord_oauth_attempt",
      {
        state_hash: hashDiscordOAuthState(state),
        return_path: returnPath,
        expires_at: expiresAt,
      },
    );

    if (attemptError) {
      return discordAccountRedirect(
        request,
        returnPath,
        { error: "We could not start the Discord connection. Please try again." },
        authResponse,
      );
    }

    const response = NextResponse.redirect(
      buildDiscordAuthorizationUrl(config, state),
      302,
    );
    copySupabaseResponseState(authResponse, response);
    return noStoreDiscordResponse(response);
  } catch {
    return discordAccountRedirect(
      request,
      returnPath,
      { error: "Discord connection is not available right now." },
      authResponse,
    );
  }
}
