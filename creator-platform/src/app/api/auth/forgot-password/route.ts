import { NextResponse, type NextRequest } from "next/server";

import { getAppOrigin, hasSupabaseAuthEnv } from "@/lib/server-env";
import { createRouteHandlerClient } from "@/lib/supabase/server";
import { authRedirectUrl, getFormString } from "@/server/auth/http";

export async function POST(request: NextRequest) {
  const formData = await request.formData();

  if (!hasSupabaseAuthEnv()) {
    return NextResponse.redirect(
      authRedirectUrl(request, "/auth/forgot-password", {
        error: "Password recovery is not configured yet.",
      }),
      303,
    );
  }

  const response = NextResponse.redirect(
    authRedirectUrl(request, "/auth/forgot-password", {
      notice: "If an account exists for that email, a reset link is on its way.",
    }),
    303,
  );
  const supabase = createRouteHandlerClient(request, response);
  const confirmationUrl = new URL("/auth/confirm", getAppOrigin(request.url));
  confirmationUrl.searchParams.set("next", "/auth/reset-password");

  await supabase.auth.resetPasswordForEmail(
    getFormString(formData, "email").toLowerCase(),
    { redirectTo: confirmationUrl.toString() },
  );

  // Always return the same response so the endpoint cannot enumerate accounts.
  return response;
}
