import { NextResponse, type NextRequest } from "next/server";

import { hasSupabaseAuthEnv } from "@/lib/server-env";
import {
  copySupabaseResponseState,
  createRouteHandlerClient,
} from "@/lib/supabase/server";
import {
  discordAccountRedirect,
  isCanonicalSameOrigin,
  noStoreDiscordResponse,
} from "@/server/discord/http";

export const dynamic = "force-dynamic";

function wantsJson(request: NextRequest) {
  return request.headers.get("accept")?.includes("application/json") ?? false;
}

function jsonResponse(
  authResponse: NextResponse,
  body: Record<string, unknown>,
  status: number,
) {
  const response = NextResponse.json(body, { status });
  copySupabaseResponseState(authResponse, response);
  return noStoreDiscordResponse(response);
}

export async function POST(request: NextRequest) {
  const json = wantsJson(request);
  const authResponse = NextResponse.next();

  if (!isCanonicalSameOrigin(request)) {
    return json
      ? jsonResponse(authResponse, { error: "Request origin was not accepted." }, 403)
      : discordAccountRedirect(request, null, {
          error: "Request origin was not accepted.",
        });
  }

  if (!hasSupabaseAuthEnv()) {
    return json
      ? jsonResponse(authResponse, { error: "Discord connection is not configured." }, 503)
      : discordAccountRedirect(request, null, {
          error: "Discord connection is not configured.",
        });
  }

  const supabase = createRouteHandlerClient(request, authResponse);
  const { data, error: authError } = await supabase.auth.getUser();
  if (authError || !data?.user) {
    return json
      ? jsonResponse(authResponse, { error: "Sign in before disconnecting Discord." }, 401)
      : discordAccountRedirect(
          request,
          null,
          { error: "Sign in before disconnecting Discord." },
          authResponse,
        );
  }

  const { error } = await supabase.rpc("disconnect_creator_discord");
  if (error) {
    return json
      ? jsonResponse(authResponse, { error: "We could not disconnect Discord." }, 503)
      : discordAccountRedirect(
          request,
          null,
          { error: "We could not disconnect Discord. Please try again." },
          authResponse,
        );
  }

  return json
    ? jsonResponse(authResponse, { disconnected: true }, 200)
    : discordAccountRedirect(
        request,
        null,
        { notice: "Discord account disconnected." },
        authResponse,
      );
}
