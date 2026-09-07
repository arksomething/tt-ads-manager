import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  getAdminDealTemplateSourceArtifact,
  normalizeAdminDealTemplateSourceArtifact,
  parseAdminDealArchivedBindingInput,
  parseAdminDealArchivedBindingVerificationInput,
} from "@/server/admin/deal-template-source";

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ rpc: mocks.rpc }),
}));

const dealVersionId = "11111111-1111-4111-8111-111111111111";
const artifactId = "22222222-2222-4222-8222-222222222222";
const templateId = "33333333-3333-4333-8333-333333333333";
const actorId = "44444444-4444-4444-8444-444444444444";
const snapshotHash = "a".repeat(64);
const sourceSha256 = "b".repeat(64);
const attestation =
  "I verified this exact SignWell production template source against this sealed deal snapshot.";
const artifact = {
  id: artifactId,
  dealVersionId,
  provider: "signwell",
  environment: "production",
  templateId,
  snapshotHash,
  sourceSha256,
  storageBucket: "creator-deal-template-sources",
  storagePath: `${dealVersionId}/55555555-5555-4555-8555-555555555555.pdf`,
  originalFilename: "agreement.pdf",
  contentType: "application/pdf",
  byteSize: 1234,
  uploadedBy: actorId,
  createdAt: "2026-09-03T12:00:00.000Z",
};

describe("admin deal template source boundary", () => {
  beforeEach(() => mocks.rpc.mockReset());

  it("strictly normalizes immutable artifact evidence", () => {
    expect(normalizeAdminDealTemplateSourceArtifact(artifact)).toEqual(artifact);
    expect(normalizeAdminDealTemplateSourceArtifact({ ...artifact, rawServiceKey: "secret" }))
      .toBeNull();
    expect(normalizeAdminDealTemplateSourceArtifact({ ...artifact, sourceSha256: "browser" }))
      .toBeNull();
    expect(normalizeAdminDealTemplateSourceArtifact({
      ...artifact,
      storagePath: `${dealVersionId}/../../agreement.pdf`,
    })).toBeNull();
  });

  it("accepts only archive IDs and snapshots at the browser binding boundary", () => {
    expect(parseAdminDealArchivedBindingInput({ sourceArtifactId: artifactId, snapshotHash }))
      .toEqual({ sourceArtifactId: artifactId, snapshotHash });
    expect(parseAdminDealArchivedBindingInput({
      sourceArtifactId: artifactId,
      snapshotHash,
      templateSourceSha256: sourceSha256,
    })).toBeNull();
    expect(parseAdminDealArchivedBindingVerificationInput({
      sourceArtifactId: artifactId,
      snapshotHash,
      attestation,
    }, attestation)).toEqual({ sourceArtifactId: artifactId, snapshotHash, attestation });
    expect(parseAdminDealArchivedBindingVerificationInput({
      sourceArtifactId: artifactId,
      snapshotHash,
      attestation: "verified",
    }, attestation)).toBeNull();
  });

  it("loads artifact evidence only through the staff RPC and fails closed", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: artifact, error: null });
    await expect(getAdminDealTemplateSourceArtifact(dealVersionId)).resolves.toEqual(artifact);
    expect(mocks.rpc).toHaveBeenCalledWith(
      "get_admin_program_deal_template_source_artifact",
      { target_deal_version_id: dealVersionId },
    );

    mocks.rpc.mockResolvedValueOnce({ data: { ...artifact, byteSize: null }, error: null });
    await expect(getAdminDealTemplateSourceArtifact(dealVersionId)).rejects.toThrow(/incomplete/i);
  });
});
