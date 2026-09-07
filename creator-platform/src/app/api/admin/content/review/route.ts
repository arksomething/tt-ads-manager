import { NextResponse, type NextRequest } from "next/server";

import { createRouteHandlerClient } from "@/lib/supabase/server";
import {
  contentMutationError,
  contentRedirect,
  formText,
  isAcceptedContentOrigin,
  isUuid,
} from "@/server/content/http";

export const dynamic = "force-dynamic";

const allowedStates = new Set(["matching", "needs_review", "rejected"]);

export async function POST(request: NextRequest) {
  const authResponse = NextResponse.next();
  if (!isAcceptedContentOrigin(request)) {
    return contentRedirect(request, "/admin/content", {
      error: "Request origin was not accepted.",
    });
  }

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > 24_576) {
    return contentRedirect(request, "/admin/content", {
      error: "The review update was too large.",
    });
  }

  const formData = await request.formData();
  const submissionId = formText(formData, "submissionId", 40);
  const state = formText(formData, "state", 32).toLowerCase();
  const note = formText(formData, "note", 1000);

  if (!isUuid(submissionId) || !allowedStates.has(state)) {
    return contentRedirect(request, "/admin/content", {
      error: "Choose an open submission and a valid review state.",
    });
  }
  if ((state === "needs_review" || state === "rejected") && note.length < 2) {
    return contentRedirect(request, "/admin/content", {
      error: "Add a reviewer note before requesting attention or rejecting a submission.",
    });
  }

  const supabase = createRouteHandlerClient(request, authResponse);
  const { data: claims, error: claimsError } = await supabase.auth.getClaims();
  if (claimsError || !claims?.claims?.sub) {
    return contentRedirect(request, "/auth/sign-in", {
      error: "Sign in with a staff account before reviewing content.",
    }, authResponse);
  }

  const { error } = await supabase.rpc("set_creator_content_review_state", {
    target_submission_id: submissionId,
    target_state: state,
    reviewer_note: note || null,
  });
  if (error) {
    return contentRedirect(request, "/admin/content", {
      error: contentMutationError(error),
    }, authResponse);
  }

  return contentRedirect(request, "/admin/content", {
    notice: state === "matching"
      ? "Submission moved into matching. No attribution is being claimed yet."
      : state === "needs_review"
        ? "Submission marked for attention."
        : "Submission rejected and retained in its audit history.",
  }, authResponse);
}
