import { NextResponse, type NextRequest } from "next/server";

import { sanitizeNextPath } from "@/lib/auth-navigation";
import { getAppOrigin, hasSupabaseAuthEnv } from "@/lib/server-env";
import {
  copySupabaseResponseState,
  createRouteHandlerClient,
} from "@/lib/supabase/server";
import { authRedirectUrl, getFormString } from "@/server/auth/http";

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const nextPath = sanitizeNextPath(getFormString(formData, "next"));

  if (!hasSupabaseAuthEnv()) {
    return NextResponse.redirect(
      authRedirectUrl(request, "/auth/sign-in", {
        error: "Google sign-in is not configured yet.",
        next: nextPath,
      }),
      303,
    );
  }

  const callbackUrl = new URL("/auth/confirm", getAppOrigin(request.url));
  callbackUrl.searchParams.set("next", nextPath);

  const authResponse = NextResponse.next();
  const supabase = createRouteHandlerClient(request, authResponse);
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: callbackUrl.toString(),
    },
  });

  if (error || !data.url) {
    return copySupabaseResponseState(
      authResponse,
      NextResponse.redirect(
        authRedirectUrl(request, "/auth/sign-in", {
          error: "Google sign-in could not be started. Please try again.",
          next: nextPath,
        }),
        303,
      ),
    );
  }

  return copySupabaseResponseState(
    authResponse,
    NextResponse.redirect(data.url, 303),
  );
}
