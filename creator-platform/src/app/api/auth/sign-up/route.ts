import { NextResponse, type NextRequest } from "next/server";

import { sanitizeNextPath } from "@/lib/auth-navigation";
import { getAppOrigin, hasSupabaseAuthEnv } from "@/lib/server-env";
import {
  copySupabaseResponseState,
  createRouteHandlerClient,
} from "@/lib/supabase/server";
import {
  authRedirectUrl,
  getFormString,
  getRawFormString,
  validatePasswordPair,
} from "@/server/auth/http";

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const email = getFormString(formData, "email").toLowerCase();
  const password = getRawFormString(formData, "password");
  const confirmation = getRawFormString(formData, "passwordConfirm");
  const nextPath = sanitizeNextPath(getFormString(formData, "next"), "/apply");

  if (!hasSupabaseAuthEnv()) {
    return NextResponse.redirect(
      authRedirectUrl(request, "/auth/sign-up", {
        error: "Account creation is not configured yet.",
        next: nextPath,
      }),
      303,
    );
  }

  const passwordError = validatePasswordPair(password, confirmation);
  if (!email || passwordError) {
    return NextResponse.redirect(
      authRedirectUrl(request, "/auth/sign-up", {
        error: passwordError ?? "Enter a valid email address.",
        next: nextPath,
      }),
      303,
    );
  }

  const successResponse = NextResponse.redirect(new URL(nextPath, request.url), 303);
  const supabase = createRouteHandlerClient(request, successResponse);
  const confirmationUrl = new URL("/auth/confirm", getAppOrigin(request.url));
  confirmationUrl.searchParams.set("next", nextPath);

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: confirmationUrl.toString(),
    },
  });

  if (error) {
    return copySupabaseResponseState(
      successResponse,
      NextResponse.redirect(
        authRedirectUrl(request, "/auth/sign-up", {
          error: "We could not create that account. Try signing in or use another email.",
          next: nextPath,
        }),
        303,
      ),
    );
  }

  if (data.session) {
    return successResponse;
  }

  // With email confirmation enabled, Supabase deliberately returns an
  // obfuscated user with no identities for an already-registered address.
  // Sending that response to "check your email" is misleading because no new
  // confirmation message is generated for an account that is already
  // confirmed. Keep the copy non-enumerating while guiding the creator to the
  // path that can actually work.
  if (data.user && data.user.identities?.length === 0) {
    return copySupabaseResponseState(
      successResponse,
      NextResponse.redirect(
        authRedirectUrl(request, "/auth/sign-in", {
          notice:
            "This email may already have an account. Sign in with the password you created, or reset it if needed.",
          next: nextPath,
        }),
        303,
      ),
    );
  }

  return copySupabaseResponseState(
    successResponse,
    NextResponse.redirect(
      authRedirectUrl(request, "/auth/check-email", {
        next: nextPath,
      }),
      303,
    ),
  );
}
