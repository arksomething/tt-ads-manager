import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST as activateDeal } from "@/app/api/admin/deals/[dealId]/activate/route";
import { POST as approveDeal } from "@/app/api/admin/deals/[dealId]/approvals/route";
import { POST as revokeApproval } from "@/app/api/admin/deals/[dealId]/approvals/revoke/route";
import { POST as recordBinding } from "@/app/api/admin/deals/[dealId]/signing-binding/route";
import { POST as verifyBinding } from "@/app/api/admin/deals/[dealId]/signing-binding/verify/route";
import {
  adminDealActivationConfirmation,
  emptyAdminDealEconomics,
  signWellBindingVerificationAttestation,
} from "@/server/admin/deals";

const mocks = vi.hoisted(() => ({
  adminRpc: vi.fn(),
  assertIntegrity: vi.fn(),
  getClaims: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@/lib/server-env", () => ({ hasSupabaseAuthEnv: () => true }));
vi.mock("@/lib/supabase/server", () => ({
  createRouteHandlerClient: () => ({
    auth: { getClaims: mocks.getClaims },
    rpc: mocks.rpc,
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ rpc: mocks.adminRpc }),
}));
vi.mock("@/server/admin/deal-template-source-integrity", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/server/admin/deal-template-source-integrity")>(),
  assertDealTemplateSourceIntegrity: mocks.assertIntegrity,
}));

const origin = "https://gotall-creator-platform.vercel.app";
const dealId = "11111111-1111-4111-8111-111111111111";
const actorId = "22222222-2222-4222-8222-222222222222";
const templateId = "33333333-3333-4333-8333-333333333333";
const sourceArtifactId = "44444444-4444-4444-8444-444444444444";
const snapshotHash = "a".repeat(64);
const templateSourceSha256 = "b".repeat(64);
const detail = {
  id: dealId,
  dealKey: "standard",
  version: 1,
  label: "Standard deal",
  status: "sealed",
  isDefault: false,
  draftRevision: 2,
  termsHash: "c".repeat(64),
  economicsHash: "d".repeat(64),
  snapshotHash,
  providerTemplateHash: null,
  assignmentCount: 0,
  providerBindingCount: 0,
  approvalCount: 0,
  businessApprovalCount: 0,
  legalApprovalCount: 0,
  readinessBlockerCount: 3,
  activationReady: false,
  readinessBlockers: ["binding", "business", "legal"],
  createdAt: "2026-09-03T12:00:00.000Z",
  updatedAt: "2026-09-03T12:00:00.000Z",
  effectiveAt: null,
  sealedAt: "2026-09-03T12:00:00.000Z",
  termsMarkdown: "# Sealed agreement\n\nReviewed exact legal terms.",
  economics: emptyAdminDealEconomics(),
  changeNote: null,
  providerBindings: [],
  approvals: [],
  auditEvents: [],
};

function request(path: string, body: unknown, options?: { origin?: string | null }) {
  const headers = new Headers({ "Content-Type": "application/json" });
  const requestOrigin = options?.origin === undefined ? origin : options.origin;
  if (requestOrigin) headers.set("Origin", requestOrigin);
  return new NextRequest(`${origin}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

const context = { params: Promise.resolve({ dealId }) };

describe("admin deal release API", () => {
  beforeEach(() => {
    mocks.getClaims.mockReset();
    mocks.rpc.mockReset();
    mocks.adminRpc.mockReset();
    mocks.assertIntegrity.mockReset();
    mocks.getClaims.mockResolvedValue({ data: { claims: { sub: actorId } }, error: null });
    mocks.rpc.mockResolvedValue({ data: detail, error: null });
    mocks.assertIntegrity.mockResolvedValue({
      id: sourceArtifactId,
      dealVersionId: dealId,
      templateId,
      snapshotHash,
    });
    mocks.adminRpc.mockImplementation(async (name: string) => ({
      data: name === "verify_admin_program_deal_signwell_binding_from_artifact"
        ? { dealVersionId: dealId, sourceArtifactId, verified: true }
        : { dealVersionId: dealId, sourceArtifactId, activated: true },
      error: null,
    }));
  });

  it("records exact-snapshot business or legal approval without accepting an actor or status", async () => {
    const rejected = await approveDeal(request(`/api/admin/deals/${dealId}/approvals`, {
      kind: "business",
      snapshotHash,
      status: "approved",
      approvedBy: actorId,
    }), context);
    expect(rejected.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();

    const missingLegalReference = await approveDeal(request(
      `/api/admin/deals/${dealId}/approvals`,
      { kind: "legal", snapshotHash, note: null },
    ), context);
    expect(missingLegalReference.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();

    const response = await approveDeal(request(`/api/admin/deals/${dealId}/approvals`, {
      kind: "legal",
      snapshotHash,
      note: "Reviewed by legal counsel.",
    }), context);
    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("record_admin_program_deal_approval", {
      target_deal_version_id: dealId,
      approval_kind_input: "legal",
      expected_snapshot_sha256: snapshotHash,
      note_input: "Reviewed by legal counsel.",
    });
  });

  it("requires an exact snapshot and reason to revoke an approval", async () => {
    const invalid = await revokeApproval(request(
      `/api/admin/deals/${dealId}/approvals/revoke`,
      { kind: "legal", snapshotHash, reason: "no" },
    ), context);
    expect(invalid.status).toBe(400);

    const response = await revokeApproval(request(
      `/api/admin/deals/${dealId}/approvals/revoke`,
      { kind: "legal", snapshotHash, reason: "Legal language changed externally." },
    ), context);
    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenLastCalledWith("revoke_admin_program_deal_approval", {
      target_deal_version_id: dealId,
      approval_kind_input: "legal",
      expected_snapshot_sha256: snapshotHash,
      revocation_note_input: "Legal language changed externally.",
    });
  });

  it("records a pending binding only from an archived artifact ID", async () => {
    const rejected = await recordBinding(request(`/api/admin/deals/${dealId}/signing-binding`, {
      templateId,
      templateSourceSha256,
      snapshotHash,
    }), context);
    expect(rejected.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();

    const response = await recordBinding(request(`/api/admin/deals/${dealId}/signing-binding`, {
      sourceArtifactId,
      snapshotHash,
    }), context);
    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith(
      "record_admin_program_deal_signwell_binding_from_artifact",
      {
        target_deal_version_id: dealId,
        expected_snapshot_sha256: snapshotHash,
        source_artifact_id_input: sourceArtifactId,
      },
    );
  });

  it("requires the full attestation and identifies only the archived source", async () => {
    const missing = await verifyBinding(request(
      `/api/admin/deals/${dealId}/signing-binding/verify`,
      { sourceArtifactId, snapshotHash, attestation: "verified" },
    ), context);
    expect(missing.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();

    const response = await verifyBinding(request(
      `/api/admin/deals/${dealId}/signing-binding/verify`,
      { sourceArtifactId, snapshotHash, attestation: signWellBindingVerificationAttestation },
    ), context);
    expect(response.status).toBe(200);
    expect(mocks.assertIntegrity).toHaveBeenCalledWith(expect.objectContaining({
      dealVersionId: dealId,
      sourceArtifactId,
      snapshotHash,
    }), expect.anything());
    expect(mocks.adminRpc).toHaveBeenCalledWith(
      "verify_admin_program_deal_signwell_binding_from_artifact",
      {
        target_deal_version_id: dealId,
        actor_user_id_input: actorId,
        expected_snapshot_sha256: snapshotHash,
        source_artifact_id_input: sourceArtifactId,
        verification_attestation: signWellBindingVerificationAttestation,
      },
    );
    expect(mocks.rpc).toHaveBeenLastCalledWith("get_admin_program_deal_detail", {
      target_deal_version_id: dealId,
    });
  });

  it("requires exact activation confirmation and never calls the historical rotator", async () => {
    const rejected = await activateDeal(request(`/api/admin/deals/${dealId}/activate`, {
      snapshotHash,
      confirmation: "activate",
    }), context);
    expect(rejected.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();

    const response = await activateDeal(request(`/api/admin/deals/${dealId}/activate`, {
      snapshotHash,
      confirmation: adminDealActivationConfirmation,
    }), context);
    expect(response.status).toBe(200);
    expect(mocks.assertIntegrity).toHaveBeenCalledWith(expect.objectContaining({
      dealVersionId: dealId,
      snapshotHash,
    }), expect.anything());
    expect(mocks.adminRpc).toHaveBeenCalledWith(
      "activate_admin_program_deal_default_from_verified_artifact",
      {
      target_deal_version_id: dealId,
      actor_user_id_input: actorId,
      expected_snapshot_sha256: snapshotHash,
      source_artifact_id_input: sourceArtifactId,
      activation_confirmation: adminDealActivationConfirmation,
      },
    );
    expect(mocks.adminRpc).not.toHaveBeenCalledWith(
      "rotate_default_program_deal_version",
      expect.anything(),
    );
  });

  it("rejects missing/cross-site origins, unsigned sessions, and non-admin RPC responses", async () => {
    const missingOrigin = await activateDeal(request(`/api/admin/deals/${dealId}/activate`, {
      snapshotHash,
      confirmation: adminDealActivationConfirmation,
    }, { origin: null }), context);
    expect(missingOrigin.status).toBe(403);

    const crossOrigin = await activateDeal(request(`/api/admin/deals/${dealId}/activate`, {
      snapshotHash,
      confirmation: adminDealActivationConfirmation,
    }, { origin: "https://attacker.example" }), context);
    expect(crossOrigin.status).toBe(403);

    mocks.getClaims.mockResolvedValueOnce({ data: { claims: null }, error: new Error("expired") });
    const unsigned = await activateDeal(request(`/api/admin/deals/${dealId}/activate`, {
      snapshotHash,
      confirmation: adminDealActivationConfirmation,
    }), context);
    expect(unsigned.status).toBe(401);

    mocks.adminRpc.mockResolvedValueOnce({ data: null, error: { code: "42501" } });
    const reviewer = await activateDeal(request(`/api/admin/deals/${dealId}/activate`, {
      snapshotHash,
      confirmation: adminDealActivationConfirmation,
    }), context);
    expect(reviewer.status).toBe(403);
  });
});
