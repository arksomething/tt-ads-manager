import { createHash } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { createRouteHandlerClient } from "@/lib/supabase/server";
import {
  contentRedirect,
  formText,
  isAcceptedContentOrigin,
  isUuid,
} from "@/server/content/http";

export const dynamic = "force-dynamic";

function financeError(error: unknown) {
  const code = error && typeof error === "object" && "code" in error
    ? String((error as { code?: unknown }).code ?? "")
    : "";
  if (code === "42501") return "Administrator access is required for finance changes.";
  if (code === "23505") return "A settlement already exists for that exact earning batch.";
  if (code === "22023" || code === "23514" || code === "23503") {
    return "The ledger changed or the requested transition is not valid. Refresh before trying again.";
  }
  return "The finance change could not be saved. No ledger transition is being claimed.";
}

function settlementKey(entryIds: string[]) {
  const digest = createHash("sha256").update(entryIds.slice().sort().join(",")).digest("hex");
  return `admin-ledger-v1:${digest}`;
}

export async function POST(request: NextRequest) {
  const authResponse = NextResponse.next();
  if (!isAcceptedContentOrigin(request)) {
    return contentRedirect(request, "/admin/finance", {
      error: "Request origin was not accepted.",
    });
  }

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > 96_000) {
    return contentRedirect(request, "/admin/finance", {
      error: "The finance request was too large.",
    });
  }

  const formData = await request.formData();
  const action = formText(formData, "action", 40);
  const reason = formText(formData, "reason", 1000);

  const supabase = createRouteHandlerClient(request, authResponse);
  const { data: claims, error: claimsError } = await supabase.auth.getClaims();
  if (claimsError || !claims?.claims?.sub) {
    return contentRedirect(request, "/auth/sign-in", {
      error: "Sign in with an administrator account before changing finance records.",
    }, authResponse);
  }

  let error: unknown = null;
  let notice: string;

  if (action === "create_settlement") {
    const accountId = formText(formData, "accountId", 40);
    const enrollmentId = formText(formData, "enrollmentId", 40);
    const entryIds = [...new Set(formData.getAll("earningEntryId").flatMap((value) => (
      typeof value === "string" && isUuid(value.trim()) ? [value.trim()] : []
    )))];
    if (!isUuid(accountId) || !isUuid(enrollmentId) || entryIds.length < 1 || entryIds.length > 1000) {
      return contentRedirect(request, "/admin/finance", {
        error: "Select at least one approved earning from one creator and enrollment.",
      }, authResponse);
    }

    ({ error } = await supabase.rpc("create_creator_settlement", {
      settlement_input: {
        accountId,
        enrollmentId,
        earningEntryIds: entryIds,
        idempotencyKey: settlementKey(entryIds),
      },
    }));
    notice = "Pending settlement recorded. No payout was sent.";
  } else if (action === "transition_earning") {
    const earningId = formText(formData, "earningId", 40);
    const nextState = formText(formData, "nextState", 20);
    if (!isUuid(earningId) || !["pending", "approved"].includes(nextState) || reason.length < 2) {
      return contentRedirect(request, "/admin/finance", {
        error: "Choose a valid earning transition and add an audit reason.",
      }, authResponse);
    }
    ({ error } = await supabase.rpc("transition_creator_earning", {
      target_earning_id: earningId,
      target_state: nextState,
      transition_reason: reason,
      provider_reference: null,
    }));
    notice = nextState === "approved"
      ? "Earning approved for settlement. No payout was sent."
      : "Earning moved to pending review.";
  } else if (action === "transition_settlement") {
    const settlementId = formText(formData, "settlementId", 40);
    const nextState = formText(formData, "nextState", 20);
    if (!isUuid(settlementId) || nextState !== "approved" || reason.length < 2) {
      return contentRedirect(request, "/admin/finance", {
        error: "Choose a pending settlement and add an approval reason.",
      }, authResponse);
    }
    ({ error } = await supabase.rpc("transition_creator_settlement", {
      target_settlement_id: settlementId,
      target_state: "approved",
      transition_reason: reason,
      provider_key: null,
      provider_payout_id: null,
    }));
    notice = "Settlement approved. No payout was sent.";
  } else {
    return contentRedirect(request, "/admin/finance", {
      error: "Finance action was not recognized.",
    }, authResponse);
  }

  if (error) {
    return contentRedirect(request, "/admin/finance", {
      error: financeError(error),
    }, authResponse);
  }

  return contentRedirect(request, "/admin/finance", { notice }, authResponse);
}
