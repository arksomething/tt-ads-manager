import { NextResponse, type NextRequest } from "next/server";

import { createRouteHandlerClient } from "@/lib/supabase/server";
import { parsePlatformClaimId } from "@/server/accounts/platform-verification-form";
import { formRedirect, isSameOrigin } from "@/server/forms";

export async function POST(request: NextRequest) {
  const authResponse = NextResponse.next();
  if (!isSameOrigin(request)) {
    return formRedirect(request, "/onboarding/accounts", {
      error: "Request origin was not accepted.",
    });
  }

  const claimId = parsePlatformClaimId(await request.formData());
  if (!claimId) {
    return formRedirect(request, "/onboarding/accounts", {
      error: "Choose a valid campaign account.",
    });
  }

  const supabase = createRouteHandlerClient(request, authResponse);
  const { data: claims, error: claimsError } = await supabase.auth.getClaims();
  if (claimsError || !claims?.claims?.sub) {
    return formRedirect(request, "/auth/sign-in", {
      error: "Sign in before replacing a verification code.",
    }, authResponse);
  }

  const { error } = await supabase.rpc("rotate_creator_platform_verification_code", {
    target_claim_id: claimId,
  });
  if (error) {
    return formRedirect(request, "/onboarding/accounts", {
      error: "That verification code cannot be replaced right now.",
    }, authResponse);
  }

  return formRedirect(request, "/onboarding/accounts", {
    notice: "A new bio code is ready. Replace the previous code before checking again.",
  }, authResponse);
}
