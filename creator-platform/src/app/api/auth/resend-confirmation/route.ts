import { NextResponse, type NextRequest } from "next/server";

import { sanitizeNextPath } from "@/lib/auth-navigation";
import { getAppOrigin, hasSupabaseAuthEnv } from "@/lib/server-env";
import { createRouteHandlerClient } from "@/lib/supabase/server";
import { authRedirectUrl, getFormString } from "@/server/auth/http";

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const nextPath = sanitizeNextPath(getFormString(formData, "next"), "/apply");

  if (!hasSupabaseAuthEnv()) {
    return NextResponse.redirect(
      authRedirectUrl(request, "/auth/check-email", {
        error: "Email confirmation is not configured yet.",
        next: nextPath,
      }),
      303,
    );
  }

  const response = NextResponse.redirect(
    authRedirectUrl(request, "/auth/check-email", {
      notice:
        "If that address is still unconfirmed, we requested a new link. Confirmed accounts do not receive another confirmation email, so sign in instead. Requests are limited to once per minute.",
      next: nextPath,
    }),
    303,
  );
  const supabase = createRouteHandlerClient(request, response);
  const confirmationUrl = new URL("/auth/confirm", getAppOrigin(request.url));
  confirmationUrl.searchParams.set("next", nextPath);

  const { error } = await supabase.auth.resend({
    type: "signup",
    email: getFormString(formData, "email").toLowerCase(),
    options: {
      emailRedirectTo: confirmationUrl.toString(),
    },
  });

  if (error) {
    const authError = error as { code?: unknown; status?: unknown };
    console.warn("[creator-auth] confirmation resend was not accepted", {
      code: typeof authError.code === "string" ? authError.code : "unknown",
      status: typeof authError.status === "number" ? authError.status : null,
    });
  }

  // Always return the same response so this endpoint cannot enumerate accounts.
  return response;
}
