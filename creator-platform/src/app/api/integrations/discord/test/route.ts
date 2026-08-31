import { NextResponse, type NextRequest } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createRouteHandlerClient } from "@/lib/supabase/server";
import {
  discordAccountRedirect,
  isCanonicalSameOrigin,
} from "@/server/discord/http";

export async function POST(request: NextRequest) {
  const authResponse = NextResponse.next();
  if (!isCanonicalSameOrigin(request)) {
    return discordAccountRedirect(request, null, {
      error: "Request origin was not accepted.",
    });
  }
  const supabase = createRouteHandlerClient(request, authResponse);
  const { data: claims, error: claimsError } = await supabase.auth.getClaims();
  const accountId = typeof claims?.claims?.sub === "string" ? claims.claims.sub : null;
  if (claimsError || !accountId) {
    const signIn = new URL("/auth/sign-in", request.url);
    signIn.searchParams.set("next", "/account/discord");
    return NextResponse.redirect(signIn, 303);
  }

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("enqueue_creator_discord_test", {
    target_account_id: accountId,
  });
  if (error) {
    return discordAccountRedirect(
      request,
      null,
      { error: "Enable Discord reminders and confirm your server membership before sending a test." },
      authResponse,
    );
  }

  const rawResult = Array.isArray(data) ? data[0] : data;
  const deliveryState = rawResult && typeof rawResult === "object" && "delivery_state" in rawResult
    ? String(rawResult.delivery_state)
    : null;
  const notice = deliveryState === "scheduled" || deliveryState === "retry"
    ? "Test reminder queued. It may take a minute to arrive."
    : deliveryState === "leased" || deliveryState === "sending"
      ? "A test reminder is already being processed."
      : deliveryState === "sent"
        ? "A test reminder was already accepted by Discord this hour."
        : deliveryState === "delivery_unknown"
          ? "The earlier test outcome needs review, so no new test was queued."
          : deliveryState === "blocked" || deliveryState === "cancelled" || deliveryState === "dead"
            ? "No new test was queued. Check your Discord settings and try again next hour."
            : null;
  if (!notice) {
    return discordAccountRedirect(
      request,
      null,
      { error: "We could not confirm the test reminder state. Please try again." },
      authResponse,
    );
  }

  return discordAccountRedirect(
    request,
    null,
    { notice },
    authResponse,
  );
}
