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

  const formData = await request.formData();
  const claimId = parsePlatformClaimId(formData);
  if (!claimId) {
    return formRedirect(request, "/onboarding/accounts", {
      error: "Choose a valid campaign account.",
    });
  }

  const supabase = createRouteHandlerClient(request, authResponse);
  const { data: claims, error: claimsError } = await supabase.auth.getClaims();
  if (claimsError || !claims?.claims?.sub) {
    return formRedirect(request, "/auth/sign-in", {
      error: "Sign in before requesting a verification check.",
    }, authResponse);
  }

  const { error } = await supabase.rpc("request_creator_platform_verification", {
    target_claim_id: claimId,
  });
  if (error) {
    return formRedirect(request, "/onboarding/accounts", {
      error: error.code === "22023"
        ? "We could not queue that check. Confirm the bio code and try again."
        : "The verification check could not be queued right now.",
    }, authResponse);
  }

  return formRedirect(request, "/onboarding/accounts", {
    notice: "Verification check queued. An active check keeps its queue position, so you can leave and return later.",
  }, authResponse);
}
