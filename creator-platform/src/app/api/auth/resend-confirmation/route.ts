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
      notice: "If that address still needs confirmation, a new link is on its way.",
      next: nextPath,
    }),
    303,
  );
  const supabase = createRouteHandlerClient(request, response);
  const confirmationUrl = new URL("/auth/confirm", getAppOrigin(request.url));
  confirmationUrl.searchParams.set("next", nextPath);

  await supabase.auth.resend({
    type: "signup",
    email: getFormString(formData, "email").toLowerCase(),
    options: {
      emailRedirectTo: confirmationUrl.toString(),
    },
  });

  // Always return the same response so this endpoint cannot enumerate accounts.
  return response;
}
