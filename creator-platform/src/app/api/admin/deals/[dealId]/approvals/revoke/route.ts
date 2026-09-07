import { NextResponse, type NextRequest } from "next/server";

import { parseAdminDealApprovalRevocationInput } from "@/server/admin/deals";

import {
  adminDealRpcError,
  adminDealSuccess,
  dealJson,
  parseDealJsonBody,
  requireAdminDealSession,
  validAdminDealId,
  validateDealReleaseRequest,
} from "../../../_shared";

type RouteContext = { params: Promise<{ dealId: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  const authResponse = NextResponse.next();
  const rejected = validateDealReleaseRequest(request, authResponse);
  if (rejected) return rejected;

  const { dealId } = await context.params;
  if (!validAdminDealId(dealId)) {
    return dealJson(authResponse, { error: "Deal identifier is invalid." }, 400);
  }

  const parsed = parseAdminDealApprovalRevocationInput(await parseDealJsonBody(request));
  if (!parsed) {
    return dealJson(authResponse, {
      error: "Provide the approval kind, exact snapshot hash, and a revocation reason.",
    }, 400);
  }

  const session = await requireAdminDealSession(request, authResponse);
  if (session instanceof NextResponse) return session;
  const { data, error } = await session.supabase.rpc("revoke_admin_program_deal_approval", {
    target_deal_version_id: dealId,
    approval_kind_input: parsed.kind,
    expected_snapshot_sha256: parsed.snapshotHash,
    revocation_note_input: parsed.reason,
  });
  if (error) return adminDealRpcError(authResponse, error);
  return adminDealSuccess(authResponse, data, 200);
}
