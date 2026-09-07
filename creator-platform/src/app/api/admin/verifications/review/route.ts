import { NextResponse, type NextRequest } from "next/server";

import { createRouteHandlerClient } from "@/lib/supabase/server";
import { parsePlatformClaimReview } from "@/server/accounts/platform-verification-form";
import { formRedirect, isSameOrigin } from "@/server/forms";

export async function POST(request: NextRequest) {
  const authResponse = NextResponse.next();
  if (!isSameOrigin(request)) {
    return formRedirect(request, "/admin/verifications", {
      error: "Request origin was not accepted.",
    });
  }

  const parsed = parsePlatformClaimReview(await request.formData());
  if (!parsed.ok) {
    return formRedirect(request, "/admin/verifications", { error: parsed.error });
  }

  const supabase = createRouteHandlerClient(request, authResponse);
  const { data: claims, error: claimsError } = await supabase.auth.getClaims();
  if (claimsError || !claims?.claims?.sub) {
    return formRedirect(request, "/auth/sign-in", {
      error: "Sign in with a staff account before reviewing verification.",
    }, authResponse);
  }

  const { error } = await supabase.rpc("review_creator_platform_claim", {
    target_claim_id: parsed.value.claimId,
    review_input: {
      decision: parsed.value.decision,
      nativeAccountId: parsed.value.nativeAccountId,
      evidenceReference: parsed.value.evidenceReference,
      note: parsed.value.note,
    },
  });
  if (error) {
    return formRedirect(request, "/admin/verifications", {
      error: error.code === "23505"
        ? "That native account is already verified for another creator."
        : "The verification review could not be saved.",
    }, authResponse);
  }

  return formRedirect(request, "/admin/verifications", {
    notice: parsed.value.decision === "approve"
      ? "Campaign account verified."
      : "The creator was asked to correct the account bio.",
  }, authResponse);
}
