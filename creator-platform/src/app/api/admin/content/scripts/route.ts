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

export async function POST(request: NextRequest) {
  const authResponse = NextResponse.next();
  if (!isAcceptedContentOrigin(request)) {
    return contentRedirect(request, "/admin/scripts", { error: "Request origin was not accepted." });
  }

  const supabase = createRouteHandlerClient(request, authResponse);
  const { data: claims, error: claimsError } = await supabase.auth.getClaims();
  if (claimsError || !claims?.claims?.sub) {
    return contentRedirect(request, "/auth/sign-in", { error: "Sign in before managing scripts." }, authResponse);
  }

  const formData = await request.formData();
  const action = formText(formData, "action", 32);
  let result: { error: unknown } = { error: null };
  let notice = "Script saved.";

  if (action === "save") {
    const id = formText(formData, "id", 40);
    const title = formText(formData, "title", 140);
    const summary = formText(formData, "summary", 500);
    const bodyMarkdown = formText(formData, "bodyMarkdown", 100_000);
    if ((id && !isUuid(id)) || title.length < 2 || !bodyMarkdown) {
      return contentRedirect(request, "/admin/scripts", { error: "Add a title and script body." }, authResponse);
    }
    result = await supabase.rpc("save_program_script", {
      script_input: { id: id || null, title, summary, bodyMarkdown },
    });
    notice = id ? "Script revision saved." : "Draft script created.";
  } else if (action === "publish" || action === "archive") {
    const scriptId = formText(formData, "scriptId", 40);
    if (!isUuid(scriptId)) return contentRedirect(request, "/admin/scripts", { error: "Script was not recognized." }, authResponse);
    result = await supabase.rpc("set_program_script_status", {
      target_script_id: scriptId,
      target_status: action === "publish" ? "published" : "archived",
    });
    notice = action === "publish" ? "Script published." : "Script archived.";
  } else if (action === "delete") {
    const scriptId = formText(formData, "scriptId", 40);
    if (!isUuid(scriptId)) return contentRedirect(request, "/admin/scripts", { error: "Script was not recognized." }, authResponse);
    result = await supabase.rpc("delete_draft_program_script", { target_script_id: scriptId });
    notice = "Draft script deleted.";
  } else if (action === "assign") {
    const scriptId = formText(formData, "scriptId", 40);
    const enrollmentId = formText(formData, "enrollmentId", 40);
    const note = formText(formData, "note", 1000);
    const dueAt = formText(formData, "dueAt", 40);
    if (!isUuid(scriptId) || !isUuid(enrollmentId)) {
      return contentRedirect(request, "/admin/scripts", { error: "Choose a creator for this assignment." }, authResponse);
    }
    result = await supabase.rpc("assign_program_script", {
      assignment_input: { scriptId, enrollmentId, note, dueAt: dueAt || null },
    });
    notice = "Script assigned to creator.";
  } else if (action === "withdraw") {
    const assignmentId = formText(formData, "assignmentId", 40);
    if (!isUuid(assignmentId)) return contentRedirect(request, "/admin/scripts", { error: "Assignment was not recognized." }, authResponse);
    result = await supabase.rpc("set_program_script_assignment_state", {
      target_assignment_id: assignmentId,
      target_state: "withdrawn",
    });
    notice = "Script assignment withdrawn.";
  } else {
    return contentRedirect(request, "/admin/scripts", { error: "Script action was not recognized." }, authResponse);
  }

  if (result.error) {
    return contentRedirect(request, "/admin/scripts", { error: contentMutationError(result.error) }, authResponse);
  }
  return contentRedirect(request, "/admin/scripts", { notice }, authResponse);
}
