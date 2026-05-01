import type { EmailOtpType } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

import { createRouteHandlerClient } from "@/lib/supabase/server";

function sanitizeNextPath(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/app";
  }

  return value;
}

export async function GET(request: NextRequest) {
  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  const nextPath = sanitizeNextPath(request.nextUrl.searchParams.get("next"));
  const type = request.nextUrl.searchParams.get("type") as EmailOtpType | null;

  const successUrl = new URL(nextPath, request.url);
  const errorUrl = new URL("/login", request.url);

  if (!tokenHash || !type) {
    errorUrl.searchParams.set(
      "error",
      "That email confirmation link is incomplete or expired.",
    );
    return NextResponse.redirect(errorUrl);
  }

  const response = NextResponse.redirect(successUrl);
  const supabase = createRouteHandlerClient(request, response);
  const { error } = await supabase.auth.verifyOtp({
    type,
    token_hash: tokenHash,
  });

  if (!error) {
    return response;
  }

  errorUrl.searchParams.set(
    "error",
    "That email confirmation link is no longer valid. Try signing in again.",
  );
  return NextResponse.redirect(errorUrl);
}
