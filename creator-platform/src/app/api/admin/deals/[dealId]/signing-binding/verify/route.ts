import { NextResponse, type NextRequest } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { parseAdminDealArchivedBindingVerificationInput } from "@/server/admin/deal-template-source";
import {
  assertDealTemplateSourceIntegrity,
  dealTemplateSourceIntegrityHttpStatus,
  normalizeDealTemplateSourceMutationReceipt,
} from "@/server/admin/deal-template-source-integrity";
import { signWellBindingVerificationAttestation } from "@/server/admin/deals";

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

  const parsed = parseAdminDealArchivedBindingVerificationInput(
    await parseDealJsonBody(request),
    signWellBindingVerificationAttestation,
  );
  if (!parsed) {
    return dealJson(authResponse, {
      error: "Select the exact archived source and accept the full manual verification attestation.",
    }, 400);
  }

  const session = await requireAdminDealSession(request, authResponse);
  if (session instanceof NextResponse) return session;

  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
    await assertDealTemplateSourceIntegrity({
      dealVersionId: dealId,
      sourceArtifactId: parsed.sourceArtifactId,
      snapshotHash: parsed.snapshotHash,
    }, admin);
  } catch (error) {
    return dealJson(authResponse, {
      error: "The private template source failed its server integrity check. Verification remains unchanged.",
    }, dealTemplateSourceIntegrityHttpStatus(error));
  }

  const verified = await admin.rpc(
    "verify_admin_program_deal_signwell_binding_from_artifact",
    {
      target_deal_version_id: dealId,
      actor_user_id_input: session.actorUserId,
      expected_snapshot_sha256: parsed.snapshotHash,
      source_artifact_id_input: parsed.sourceArtifactId,
      verification_attestation: parsed.attestation,
    },
  );
  if (verified.error) return adminDealRpcError(authResponse, verified.error);
  if (!normalizeDealTemplateSourceMutationReceipt(verified.data, {
    dealVersionId: dealId,
    sourceArtifactId: parsed.sourceArtifactId,
  }, "verified")) {
    return dealJson(authResponse, {
      error: "The binding response was incomplete. Refresh before relying on verification.",
    }, 503);
  }

  const refreshed = await session.supabase.rpc("get_admin_program_deal_detail", {
    target_deal_version_id: dealId,
  });
  if (refreshed.error) return adminDealRpcError(authResponse, refreshed.error);
  return adminDealSuccess(authResponse, refreshed.data, 200);
}
