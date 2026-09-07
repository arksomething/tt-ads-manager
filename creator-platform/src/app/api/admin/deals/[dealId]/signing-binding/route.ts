import { NextResponse, type NextRequest } from "next/server";

import { parseAdminDealArchivedBindingInput } from "@/server/admin/deal-template-source";

import {
  adminDealRpcError,
  adminDealSuccess,
  dealJson,
  parseDealJsonBody,
  requireAdminDealSession,
  validAdminDealId,
  validateDealReleaseRequest,
} from "../../_shared";

type RouteContext = { params: Promise<{ dealId: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  const authResponse = NextResponse.next();
  const rejected = validateDealReleaseRequest(request, authResponse);
  if (rejected) return rejected;

  const { dealId } = await context.params;
  if (!validAdminDealId(dealId)) {
    return dealJson(authResponse, { error: "Deal identifier is invalid." }, 400);
  }

  const parsed = parseAdminDealArchivedBindingInput(await parseDealJsonBody(request));
  if (!parsed) {
    return dealJson(authResponse, {
      error: "Select the immutable archived template source for this exact snapshot. Browser-supplied template hashes are not accepted.",
    }, 400);
  }

  const session = await requireAdminDealSession(request, authResponse);
  if (session instanceof NextResponse) return session;
  const { data, error } = await session.supabase.rpc(
    "record_admin_program_deal_signwell_binding_from_artifact",
    {
      target_deal_version_id: dealId,
      expected_snapshot_sha256: parsed.snapshotHash,
      source_artifact_id_input: parsed.sourceArtifactId,
    },
  );
  if (error) return adminDealRpcError(authResponse, error);
  return adminDealSuccess(authResponse, data, 200);
}
