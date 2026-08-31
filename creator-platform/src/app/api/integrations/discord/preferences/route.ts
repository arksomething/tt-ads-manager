import { NextResponse, type NextRequest } from "next/server";

import { createRouteHandlerClient } from "@/lib/supabase/server";
import {
  discordAccountRedirect,
  isCanonicalSameOrigin,
} from "@/server/discord/http";
import { parseDiscordPreferenceForm } from "@/server/discord/preferences";

export async function POST(request: NextRequest) {
  const authResponse = NextResponse.next();
  if (!isCanonicalSameOrigin(request)) {
    return discordAccountRedirect(request, null, {
      error: "Request origin was not accepted.",
    });
  }
  const formData = await request.formData();
  const parsed = parseDiscordPreferenceForm(formData);
  if (!parsed.ok) {
    return discordAccountRedirect(request, null, { error: parsed.error });
  }

  const supabase = createRouteHandlerClient(request, authResponse);
  const { data: claims, error: claimsError } = await supabase.auth.getClaims();
  if (claimsError || !claims?.claims?.sub) {
    const signIn = new URL("/auth/sign-in", request.url);
    signIn.searchParams.set("next", "/account/discord");
    return NextResponse.redirect(signIn, 303);
  }

  const { error } = await supabase.rpc("set_creator_discord_preferences", {
    preference_input: parsed.value,
  });
  if (error) {
    return discordAccountRedirect(
      request,
      null,
      {
        error: parsed.value.discord_opt_in
          ? "Connect Discord and join GoTall Creators before enabling reminders."
          : "We could not save reminder preferences.",
      },
      authResponse,
    );
  }
  return discordAccountRedirect(
    request,
    null,
    { notice: "Reminder preferences saved." },
    authResponse,
  );
}
