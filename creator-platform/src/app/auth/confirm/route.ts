import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

import { sanitizeNextPath } from "@/lib/auth-navigation";
import { hasSupabaseAuthEnv } from "@/lib/server-env";
import {
  copySupabaseResponseState,
  createRouteHandlerClient,
} from "@/lib/supabase/server";
import { authRedirectUrl } from "@/server/auth/http";
import { setPasswordRecoveryProof } from "@/server/auth/recovery";

const otpTypes = new Set<EmailOtpType>([
  "email",
  "signup",
  "recovery",
  "invite",
  "email_change",
  "magiclink",
]);

export async function GET(request: NextRequest) {
  const nextPath = sanitizeNextPath(request.nextUrl.searchParams.get("next"));

  if (!hasSupabaseAuthEnv()) {
    return NextResponse.redirect(
      authRedirectUrl(request, "/auth/sign-in", {
        error: "Email confirmation is not configured yet.",
        next: nextPath,
      }),
    );
  }

  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  const rawType = request.nextUrl.searchParams.get("type") as EmailOtpType | null;
  const code = request.nextUrl.searchParams.get("code");
  const flowId = request.nextUrl.searchParams.get("sb_flow_id");

  if (tokenHash && rawType === "recovery") {
    const response = NextResponse.redirect(
      new URL("/auth/reset-password", request.url),
    );
    const proofStored = setPasswordRecoveryProof(response, {
      method: "otp",
      credential: tokenHash,
    });
    if (proofStored) return response;
  }

  if (code && nextPath === "/auth/reset-password") {
    const response = NextResponse.redirect(
      new URL("/auth/reset-password", request.url),
    );
    const proofStored = setPasswordRecoveryProof(response, {
      method: "pkce",
      credential: code,
      flowId,
    });
    if (proofStored) return response;
  }

  const response = NextResponse.redirect(new URL(nextPath, request.url));
  const supabase = createRouteHandlerClient(request, response);
  let error: unknown = null;

  if (tokenHash && rawType && otpTypes.has(rawType)) {
    ({ error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: rawType,
    }));
  } else if (code) {
    ({ error } = await supabase.auth.exchangeCodeForSession(code));
  } else {
    error = new Error("Missing confirmation token");
  }

  if (!error) {
    return response;
  }

  return copySupabaseResponseState(
    response,
    NextResponse.redirect(
      authRedirectUrl(request, "/auth/sign-in", {
        error: "That email link is incomplete or expired. Request a new one.",
        next: nextPath,
      }),
    ),
  );
}
