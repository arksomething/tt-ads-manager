import { NextResponse, type NextRequest } from "next/server";

import { parseAdminDealSealInput } from "@/server/admin/deals";

import {
  adminDealRpcError,
  adminDealSuccess,
  dealJson,
  parseDealJsonBody,
  requireAdminDealSession,
  validateDealWriteRequest,
} from "../../_shared";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
type RouteContext = { params: Promise<{ dealId: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  const authResponse = NextResponse.next();
  const rejected = validateDealWriteRequest(request, authResponse);
  if (rejected) return rejected;

  const { dealId } = await context.params;
  if (!uuidPattern.test(dealId)) {
    return dealJson(authResponse, { error: "Deal identifier is invalid." }, 400);
  }

  const parsed = parseAdminDealSealInput(await parseDealJsonBody(request));
  if (!parsed) {
    return dealJson(authResponse, {
      error: "Provide the current draft revision before sealing.",
    }, 400);
  }

  const session = await requireAdminDealSession(request, authResponse);
  if (session instanceof NextResponse) return session;

  const { data, error } = await session.supabase.rpc("seal_admin_program_deal_draft", {
    target_deal_version_id: dealId,
    expected_draft_revision: parsed.revision,
    change_note_input: parsed.changeNote,
  });
  if (error) return adminDealRpcError(authResponse, error);
  return adminDealSuccess(authResponse, data, 200);
}
