import { NextResponse, type NextRequest } from "next/server";

import { getAppOrigin } from "@/lib/server-env";
import { copySupabaseResponseState } from "@/lib/supabase/server";
import { sanitizeDiscordReturnPath } from "@/server/discord/state";

type DiscordMessage = {
  error?: string | null;
  notice?: string | null;
};

export function noStoreDiscordResponse<T extends NextResponse>(response: T) {
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("Pragma", "no-cache");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

export function discordAccountRedirect(
  request: NextRequest,
  returnPath: string | null | undefined,
  message: DiscordMessage,
  authResponse?: NextResponse,
) {
  const url = new URL(
    sanitizeDiscordReturnPath(returnPath),
    getAppOrigin(request.url),
  );
  if (message.error) url.searchParams.set("error", message.error);
  if (message.notice) url.searchParams.set("notice", message.notice);

  const response = NextResponse.redirect(url, 303);
  if (authResponse) copySupabaseResponseState(authResponse, response);
  return noStoreDiscordResponse(response);
}

export function isCanonicalSameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin) return false;

  try {
    return new URL(origin).origin === getAppOrigin(request.url);
  } catch {
    return false;
  }
}
