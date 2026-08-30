import { NextResponse, type NextRequest } from "next/server";

import { sanitizeNextPath } from "@/lib/auth-navigation";
import { hasSupabaseAuthEnv } from "@/lib/server-env";
import { createRouteHandlerClient } from "@/lib/supabase/server";
import {
  authRedirectUrl,
  getFormString,
  getRawFormString,
} from "@/server/auth/http";

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const nextPath = sanitizeNextPath(getFormString(formData, "next"));

  if (!hasSupabaseAuthEnv()) {
    return NextResponse.redirect(
      authRedirectUrl(request, "/auth/sign-in", {
        error: "Sign in is not configured yet.",
        next: nextPath,
      }),
      303,
    );
  }

  const successResponse = NextResponse.redirect(new URL(nextPath, request.url), 303);
  const supabase = createRouteHandlerClient(request, successResponse);
  const { error } = await supabase.auth.signInWithPassword({
    email: getFormString(formData, "email").toLowerCase(),
    password: getRawFormString(formData, "password"),
  });

  if (error) {
    return NextResponse.redirect(
      authRedirectUrl(request, "/auth/sign-in", {
        error: "That email and password combination was not recognized.",
        next: nextPath,
      }),
      303,
    );
  }

  return successResponse;
}
