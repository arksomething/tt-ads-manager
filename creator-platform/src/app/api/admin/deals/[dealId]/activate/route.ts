import { NextResponse, type NextRequest } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  assertDealTemplateSourceIntegrity,
  dealTemplateSourceIntegrityHttpStatus,
  normalizeDealTemplateSourceMutationReceipt,
} from "@/server/admin/deal-template-source-integrity";
import { parseAdminDealActivationInput } from "@/server/admin/deals";

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

  const parsed = parseAdminDealActivationInput(await parseDealJsonBody(request));
  if (!parsed) {
    return dealJson(authResponse, {
      error: "Provide the exact sealed snapshot hash and full default-activation confirmation.",
    }, 400);
  }

  const session = await requireAdminDealSession(request, authResponse);
  if (session instanceof NextResponse) return session;

  let admin: ReturnType<typeof createAdminClient>;
  let artifact;
  try {
    admin = createAdminClient();
    artifact = await assertDealTemplateSourceIntegrity({
      dealVersionId: dealId,
      snapshotHash: parsed.snapshotHash,
    }, admin);
  } catch (error) {
    return dealJson(authResponse, {
      error: "The private template source failed its server integrity check. Activation remains unchanged.",
    }, dealTemplateSourceIntegrityHttpStatus(error));
  }

  const activated = await admin.rpc(
    "activate_admin_program_deal_default_from_verified_artifact",
    {
    target_deal_version_id: dealId,
    actor_user_id_input: session.actorUserId,
    expected_snapshot_sha256: parsed.snapshotHash,
    source_artifact_id_input: artifact.id,
    activation_confirmation: parsed.confirmation,
    },
  );
  if (activated.error) return adminDealRpcError(authResponse, activated.error);
  if (!normalizeDealTemplateSourceMutationReceipt(activated.data, {
    dealVersionId: dealId,
    sourceArtifactId: artifact.id,
  }, "activated")) {
    return dealJson(authResponse, {
      error: "The activation response was incomplete. Refresh before relying on the default state.",
    }, 503);
  }

  const refreshed = await session.supabase.rpc("get_admin_program_deal_detail", {
    target_deal_version_id: dealId,
  });
  if (refreshed.error) return adminDealRpcError(authResponse, refreshed.error);
  return adminDealSuccess(authResponse, refreshed.data, 200);
}
