import { NextResponse, type NextRequest } from "next/server";

import { createRouteHandlerClient } from "@/lib/supabase/server";
import {
  contentMutationError,
  contentRedirect,
  formText,
  isAcceptedContentOrigin,
  isUuid,
} from "@/server/content/http";

export async function POST(request: NextRequest) {
  const authResponse = NextResponse.next();
  const returnTo = request.nextUrl.searchParams.get("returnTo") === "/account/assets"
    ? "/account/assets"
    : "/account/scripts";
  if (!isAcceptedContentOrigin(request)) {
    return contentRedirect(request, returnTo, { error: "Request origin was not accepted." });
  }
  const supabase = createRouteHandlerClient(request, authResponse);
  const { data: claims, error: claimsError } = await supabase.auth.getClaims();
  if (claimsError || !claims?.claims?.sub) {
    return contentRedirect(request, "/auth/sign-in", { error: "Sign in before updating content." }, authResponse);
  }
  const formData = await request.formData();
  const kind = formText(formData, "kind", 16);
  const assignmentId = formText(formData, "assignmentId", 40);
  const state = formText(formData, "state", 16);
  if (!isUuid(assignmentId) || (kind !== "script" && kind !== "asset")
    || (kind === "script" ? !["viewed", "used"].includes(state) : state !== "viewed")) {
    return contentRedirect(request, returnTo, { error: "Content update was not recognized." }, authResponse);
  }
  const functionName = kind === "script"
    ? "set_program_script_assignment_state"
    : "set_program_asset_assignment_state";
  const { error } = await supabase.rpc(functionName, {
    target_assignment_id: assignmentId,
    target_state: state,
  });
  if (error) return contentRedirect(request, returnTo, { error: contentMutationError(error) }, authResponse);
  return contentRedirect(request, returnTo, {
    notice: state === "used" ? "Script marked as used." : "Content marked as viewed.",
  }, authResponse);
}
