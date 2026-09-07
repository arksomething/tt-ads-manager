import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  emptyAdminDealEconomics,
  getAdminDealCatalog,
  getAdminDealDetail,
  normalizeAdminDealCatalog,
  normalizeAdminDealDetail,
  normalizeAdminDealEconomics,
  parseAdminDealCreateInput,
  parseAdminDealUpdateInput,
} from "@/server/admin/deals";

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ rpc: mocks.rpc }),
}));

const dealId = "11111111-1111-4111-8111-111111111111";
const actorId = "22222222-2222-4222-8222-222222222222";
const bindingId = "33333333-3333-4333-8333-333333333333";
const hash = "a".repeat(64);

const economics = {
  ...emptyAdminDealEconomics(),
  currency: "USD",
  measurementWindowSeconds: 604800,
  paidImpressionsPolicy: "exclude_verified" as const,
  invalidTrafficPolicy: "exclude_verified" as const,
  minimumQualifiedViews: 0,
  crossPostPolicy: "campaign_brief" as const,
  paymentDueDays: 30,
  tiers: {
    baseline: {
      rateMicrosPerThousand: 500_000,
      perPostCapMicros: 100_000_000,
      qualification: "Every accepted baseline deliverable.",
    },
    talking: {
      rateMicrosPerThousand: 1_000_000,
      perPostCapMicros: 300_000_000,
      qualification: "Accepted talking content under the campaign brief.",
    },
  },
};

const summary = {
  id: dealId,
  dealKey: "standard",
  version: 1,
  label: "Standard creator deal",
  status: "draft",
  isDefault: false,
  draftRevision: 2,
  termsHash: hash,
  economicsHash: hash,
  snapshotHash: hash,
  providerTemplateHash: null,
  assignmentCount: 0,
  providerBindingCount: 0,
  approvalCount: 0,
  businessApprovalCount: 0,
  legalApprovalCount: 0,
  readinessBlockerCount: 4,
  activationReady: false,
  readinessBlockers: [
    "Seal the immutable deal snapshot.",
    "Verify exactly one signing-provider template binding.",
    "Record business approval for this exact snapshot.",
    "Record legal approval for this exact snapshot.",
  ],
  createdAt: "2026-09-02T12:00:00.000Z",
  updatedAt: "2026-09-02T12:05:00.000Z",
  effectiveAt: null,
  sealedAt: null,
};

const detail = {
  ...summary,
  termsMarkdown: "# Agreement\n\nReviewed terms.",
  economics,
  changeNote: "Initial internal draft.",
  providerBindings: [],
  approvals: [],
  auditEvents: [{
    id: 1,
    type: "draft_updated",
    actorUserId: actorId,
    draftRevision: 2,
    fromStatus: "draft",
    toStatus: "draft",
    metadata: {
      changedFields: ["termsMarkdown"],
      changeNote: "Initial internal draft.",
    },
    createdAt: "2026-09-02T12:05:00.000Z",
  }],
  serverRoleKey: "must-not-leak",
};

describe("admin deal data boundary", () => {
  beforeEach(() => mocks.rpc.mockReset());

  it("accepts nullable draft fields but rejects floats and unknown economic keys", () => {
    expect(normalizeAdminDealEconomics(emptyAdminDealEconomics())).toEqual(
      emptyAdminDealEconomics(),
    );
    expect(normalizeAdminDealEconomics({
      ...economics,
      fixedFeeMicros: 0.5,
    })).toBeNull();
    expect(normalizeAdminDealEconomics({
      ...economics,
      browserSelectedPayout: true,
    })).toBeNull();
  });

  it("normalizes reviewed audit metadata and rejects malformed or unknown evidence", () => {
    expect(normalizeAdminDealCatalog({ defaultVersion: null, versions: [summary] }))
      .toEqual({ defaultVersion: null, versions: [summary] });
    const normalized = normalizeAdminDealDetail(detail);
    expect(normalized).toMatchObject({
      id: dealId,
      activationReady: false,
      readinessBlockerCount: 4,
      auditEvents: [{
        metadata: {
          changedFields: ["termsMarkdown"],
          changeNote: "Initial internal draft.",
          snapshotHash: null,
        },
      }],
    });
    expect(JSON.stringify(normalized)).not.toContain("must-not-leak");

    expect(normalizeAdminDealDetail({
      ...detail,
      auditEvents: [{
        ...detail.auditEvents[0],
        metadata: {
          ...detail.auditEvents[0].metadata,
          rawProviderSecret: "must-not-leak",
        },
      }],
    })).toBeNull();
    expect(normalizeAdminDealDetail({
      ...detail,
      auditEvents: [{
        ...detail.auditEvents[0],
        metadata: "not-an-object",
      }],
    })).toBeNull();

    expect(normalizeAdminDealCatalog({
      defaultVersion: null,
      versions: [{ ...summary, readinessBlockerCount: 0 }],
    })).toBeNull();

    const withBinding = normalizeAdminDealDetail({
      ...detail,
      providerBindings: [{
        id: bindingId,
        sourceArtifactId: null,
        provider: "signwell",
        environment: "production",
        templateId: "44444444-4444-4444-8444-444444444444",
        templateHash: hash,
        boundSnapshotHash: hash,
        status: "verified",
        configuredBy: actorId,
        verifiedBy: actorId,
        verificationMethod: "manual_admin_attestation",
        verifiedAt: "2026-09-02T12:06:00.000Z",
        updatedAt: "2026-09-02T12:06:00.000Z",
      }],
    });
    expect(withBinding?.providerBindings[0]).toMatchObject({
      environment: "production",
      templateId: "44444444-4444-4444-8444-444444444444",
      templateHash: hash,
      boundSnapshotHash: hash,
    });
    expect(normalizeAdminDealDetail({
      ...detail,
      providerBindings: [{
        ...withBinding?.providerBindings[0],
        boundSnapshotHash: "not-a-hash",
      }],
    })).toBeNull();
  });

  it("rejects browser-owned status, hash, version, and actor fields", () => {
    expect(parseAdminDealCreateInput({
      dealKey: "standard",
      label: "Standard deal",
      termsMarkdown: "Draft terms",
      economics,
      status: "active",
      version: 99,
      actorUserId: actorId,
      snapshotHash: hash,
    })).toBeNull();

    expect(parseAdminDealUpdateInput({
      revision: 2,
      termsMarkdown: "Changed terms",
      status: "sealed",
    })).toBeNull();
    expect(parseAdminDealUpdateInput({ termsMarkdown: "Changed terms" })).toBeNull();
  });

  it("preserves exact release evidence instead of silently dropping it", () => {
    const templateId = "44444444-4444-4444-8444-444444444444";
    const sourceArtifactId = "55555555-5555-4555-8555-555555555555";
    const normalized = normalizeAdminDealDetail({
      ...detail,
      auditEvents: [{
        id: 2,
        type: "signwell_binding_verified",
        actorUserId: actorId,
        draftRevision: 2,
        fromStatus: "sealed",
        toStatus: "sealed",
        metadata: {
          provider: "signwell",
          environment: "production",
          templateId,
          sourceArtifactId,
          templateSourceSha256: hash,
          snapshotHash: hash,
          verificationMethod: "manual_admin_attestation",
          attestationText:
            "I verified this exact SignWell production template source against this sealed deal snapshot.",
          integrityCheckedAt: "2026-09-02T12:07:00.000Z",
          integrityMethod: "server_private_storage_download_size_structure_sha256",
        },
        createdAt: "2026-09-02T12:07:00.000Z",
      }],
    });

    expect(normalized?.auditEvents[0]?.metadata).toMatchObject({
      provider: "signwell",
      environment: "production",
      templateId,
      sourceArtifactId,
      templateSourceSha256: hash,
      snapshotHash: hash,
      verificationMethod: "manual_admin_attestation",
      integrityCheckedAt: "2026-09-02T12:07:00.000Z",
      integrityMethod: "server_private_storage_download_size_structure_sha256",
    });
  });

  it("requires exact tamper-evident source evidence on activation audit events", () => {
    const sourceArtifactId = "55555555-5555-4555-8555-555555555555";
    const normalized = normalizeAdminDealDetail({
      ...detail,
      auditEvents: [{
        id: 3,
        type: "default_activated",
        actorUserId: actorId,
        draftRevision: 2,
        fromStatus: "sealed",
        toStatus: "active",
        metadata: {
          snapshotHash: hash,
          sourceArtifactId,
          templateSourceSha256: hash,
          previousDefaultDealVersionId: null,
          activationConfirmation: "ACTIVATE THIS EXACT SEALED DEAL SNAPSHOT AS THE DEFAULT",
          readinessRecomputedUnderLock: true,
          integrityCheckedAt: "2026-09-02T12:08:00.000Z",
          integrityMethod: "server_private_storage_download_size_structure_sha256",
        },
        createdAt: "2026-09-02T12:08:00.000Z",
      }],
    });

    expect(normalized?.auditEvents[0]?.metadata).toMatchObject({
      sourceArtifactId,
      templateSourceSha256: hash,
      integrityMethod: "server_private_storage_download_size_structure_sha256",
    });
    expect(normalizeAdminDealDetail({
      ...detail,
      auditEvents: [{
        ...normalized?.auditEvents[0],
        metadata: {
          ...normalized?.auditEvents[0]?.metadata,
          integrityMethod: "browser_claim",
        },
      }],
    })).toBeNull();
  });

  it("loads catalog and detail exclusively through signed-in staff RPCs", async () => {
    mocks.rpc
      .mockResolvedValueOnce({ data: { defaultVersion: null, versions: [summary] }, error: null })
      .mockResolvedValueOnce({ data: detail, error: null });

    await expect(getAdminDealCatalog()).resolves.toMatchObject({ versions: [{ id: dealId }] });
    await expect(getAdminDealDetail(dealId)).resolves.toMatchObject({ id: dealId });

    expect(mocks.rpc).toHaveBeenNthCalledWith(1, "get_admin_program_deal_catalog");
    expect(mocks.rpc).toHaveBeenNthCalledWith(2, "get_admin_program_deal_detail", {
      target_deal_version_id: dealId,
    });
  });
});
