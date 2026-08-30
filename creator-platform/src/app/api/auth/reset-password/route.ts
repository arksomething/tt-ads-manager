import { NextResponse, type NextRequest } from "next/server";

import { hasSupabaseAuthEnv } from "@/lib/server-env";
import {
  copySupabaseResponseState,
  createRouteHandlerClient,
} from "@/lib/supabase/server";
import {
  authRedirectUrl,
  getRawFormString,
  validatePasswordPair,
} from "@/server/auth/http";
import {
  clearPasswordRecoveryProof,
  parsePasswordRecoveryProof,
  passwordRecoveryCookieName,
} from "@/server/auth/recovery";

function expiredRecoveryResponse(
  request: NextRequest,
  authResponse?: NextResponse,
) {
  const response = NextResponse.redirect(
    authRedirectUrl(request, "/auth/forgot-password", {
      error: "That reset session has expired. Request a fresh link.",
    }),
    303,
  );

  if (authResponse) copySupabaseResponseState(authResponse, response);
  clearPasswordRecoveryProof(response);
  return response;
}

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const password = getRawFormString(formData, "password");
  const passwordError = validatePasswordPair(
    password,
    getRawFormString(formData, "passwordConfirm"),
  );

  if (!hasSupabaseAuthEnv() || passwordError) {
    return NextResponse.redirect(
      authRedirectUrl(request, "/auth/reset-password", {
        error: passwordError ?? "Password recovery is not configured yet.",
      }),
      303,
    );
  }

  const proof = parsePasswordRecoveryProof(
    request.cookies.get(passwordRecoveryCookieName)?.value,
  );
  if (!proof) return expiredRecoveryResponse(request);

  const authResponse = NextResponse.redirect(
    authRedirectUrl(request, "/account", {
      notice: "Your password has been updated.",
    }),
    303,
  );
  const supabase = createRouteHandlerClient(request, authResponse);
  let verifiedRecovery = false;

  if (proof.method === "otp") {
    const { data, error } = await supabase.auth.verifyOtp({
      token_hash: proof.credential,
      type: "recovery",
    });
    verifiedRecovery = Boolean(!error && data.session && data.user);
  } else {
    const { data, error } = await supabase.auth.exchangeCodeForSession(
      proof.credential,
      proof.flowId ? { flowId: proof.flowId } : undefined,
    );
    const redirectType = (
      data as typeof data & { redirectType?: string | null }
    ).redirectType;
    verifiedRecovery = Boolean(
      !error && data.session && data.user && redirectType === "recovery",
    );
  }

  if (!verifiedRecovery) {
    return expiredRecoveryResponse(request, authResponse);
  }

  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    return expiredRecoveryResponse(request, authResponse);
  }

  clearPasswordRecoveryProof(authResponse);
  return authResponse;
}
