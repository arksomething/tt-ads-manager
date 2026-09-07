import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DealReleaseControls } from "@/app/admin/deals/deal-release-controls";
import type { AdminDealTemplateSourceArtifact } from "@/server/admin/deal-template-source";
import type { AdminDealDetail } from "@/server/admin/deals";

const mocks = vi.hoisted(() => ({ refresh: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));

const dealId = "11111111-1111-4111-8111-111111111111";
const actorId = "22222222-2222-4222-8222-222222222222";
const businessAdminId = "33333333-3333-4333-8333-333333333333";
const legalAdminId = "44444444-4444-4444-8444-444444444444";
const templateId = "55555555-5555-4555-8555-555555555555";
const sourceArtifactId = "99999999-9999-4999-8999-999999999999";
const snapshotHash = "a".repeat(64);
const sourceHash = "b".repeat(64);
const verificationAttestation =
  "I verified this exact SignWell production template source against this sealed deal snapshot.";
const activationConfirmation =
  "ACTIVATE THIS EXACT SEALED DEAL SNAPSHOT AS THE DEFAULT";

function releaseDeal(overrides: Partial<AdminDealDetail> = {}): AdminDealDetail {
  return {
    id: dealId,
    dealKey: "standard-creator",
    version: 1,
    label: "Standard creator agreement",
    status: "sealed",
    isDefault: false,
    draftRevision: 3,
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
    createdAt: "2026-09-01T12:00:00.000Z",
    updatedAt: "2026-09-03T12:00:00.000Z",
    effectiveAt: null,
    sealedAt: "2026-09-03T12:00:00.000Z",
    termsMarkdown: "# Exact terms",
    economics: null,
    changeNote: null,
    providerBindings: [],
    approvals: [],
    auditEvents: [],
    ...overrides,
  };
}

function pendingBinding() {
  return {
    id: "66666666-6666-4666-8666-666666666666",
    sourceArtifactId,
    provider: "signwell" as const,
    environment: "production",
    templateId,
    templateHash: sourceHash,
    boundSnapshotHash: snapshotHash,
    status: "pending" as const,
    configuredBy: actorId,
    verifiedBy: null,
    verificationMethod: null,
    verifiedAt: null,
    updatedAt: "2026-09-03T12:00:00.000Z",
  };
}

function templateSourceArtifact(): AdminDealTemplateSourceArtifact {
  return {
    id: sourceArtifactId,
    dealVersionId: dealId,
    provider: "signwell",
    environment: "production",
    templateId,
    snapshotHash,
    sourceSha256: sourceHash,
    storageBucket: "creator-deal-template-sources",
    storagePath: `${dealId}/${sourceArtifactId}.pdf`,
    originalFilename: "standard-creator-agreement.pdf",
    contentType: "application/pdf",
    byteSize: 12_345,
    uploadedBy: actorId,
    createdAt: "2026-09-03T12:00:00.000Z",
  };
}

function verifiedBinding() {
  return {
    ...pendingBinding(),
    status: "verified" as const,
    verifiedBy: actorId,
    verificationMethod: "manual_admin_attestation" as const,
    verifiedAt: "2026-09-03T12:30:00.000Z",
  };
}

function approval(kind: "business" | "legal", approvedBy: string) {
  return {
    id: kind === "business"
      ? "77777777-7777-4777-8777-777777777777"
      : "88888888-8888-4888-8888-888888888888",
    kind,
    status: "approved" as const,
    snapshotHash,
    approvedBy,
    note: `${kind} review complete`,
    approvedAt: "2026-09-03T13:00:00.000Z",
    revokedBy: null,
    revocationNote: null,
    revokedAt: null,
  };
}

function renderControls(
  deal: AdminDealDetail,
  options: {
    role?: "admin" | "reviewer";
    actor?: string;
    artifact?: AdminDealTemplateSourceArtifact | null;
    artifactUnavailable?: boolean;
  } = {},
) {
  return render(
    <DealReleaseControls
      activationConfirmation={activationConfirmation}
      actorUserId={options.actor ?? actorId}
      deal={deal}
      role={options.role ?? "admin"}
      templateSourceArtifact={options.artifact ?? null}
      templateSourceUnavailable={options.artifactUnavailable ?? false}
      verificationAttestation={verificationAttestation}
    />,
  );
}

function successfulResponse() {
  return {
    ok: true,
    json: vi.fn().mockResolvedValue({ deal: { id: dealId, snapshotHash } }),
  };
}

function successfulArtifactResponse() {
  return {
    ok: true,
    json: vi.fn().mockResolvedValue({ artifact: templateSourceArtifact() }),
  };
}

describe("admin deal release controls", () => {
  beforeEach(() => {
    mocks.refresh.mockReset();
    vi.unstubAllGlobals();
  });

  it.each([
    ["reviewer", "sealed", /Reviewer access is read-only/i],
    ["reviewer", "active", /Reviewer access is read-only/i],
    ["admin", "draft", /still an editable internal draft/i],
    ["admin", "retired", /retired and remains read-only/i],
  ] as const)("keeps %s access to a %s version read-only", (role, status, copy) => {
    renderControls(releaseDeal({ status }), { role });

    expect(screen.getByText(copy)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("keeps only emergency approval revocation available on an active default", () => {
    renderControls(releaseDeal({
      status: "active",
      isDefault: true,
      effectiveAt: "2026-09-03T14:00:00.000Z",
      approvalCount: 2,
      businessApprovalCount: 1,
      legalApprovalCount: 1,
      approvals: [
        approval("business", businessAdminId),
        approval("legal", legalAdminId),
      ],
    }));

    expect(screen.getByRole("heading", { name: "Emergency assignment stop" })).toBeInTheDocument();
    expect(screen.getByText(/blocks new creator assignments/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Revoke business approval" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Revoke legal approval" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /record|activate/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Production template ID")).not.toBeInTheDocument();
  });

  it("uploads the exact source without accepting a browser hash", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(successfulArtifactResponse()));
    renderControls(releaseDeal());

    await user.type(screen.getByLabelText("Production template ID"), templateId);
    await user.upload(
      screen.getByLabelText(/Exact reviewed source file/),
      new File(["%PDF-1.7\n%%EOF"], "standard-creator-agreement.pdf", {
        type: "application/pdf",
      }),
    );
    const archiveButton = screen.getByRole("button", { name: "Archive exact template source" });
    fireEvent.submit(archiveButton.closest("form")!);

    expect(fetch).toHaveBeenCalledWith(
      `/api/admin/deals/${dealId}/template-source`,
      expect.objectContaining({ method: "POST" }),
    );
    const options = vi.mocked(fetch).mock.calls[0]?.[1] as RequestInit;
    expect(options.headers).toBeUndefined();
    expect(options.body).toBeInstanceOf(FormData);
    const form = options.body as FormData;
    expect(form.get("templateId")).toBe(templateId);
    expect(form.get("snapshotHash")).toBe(snapshotHash);
    expect(form.has("templateSourceSha256")).toBe(false);
    expect(await screen.findByRole("status")).toHaveTextContent(/privately archived and hashed by the server/i);
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: /send/i })).not.toBeInTheDocument();
  });

  it("records a pending binding using only the selected archive ID and snapshot", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(successfulResponse()));
    renderControls(releaseDeal(), { artifact: templateSourceArtifact() });

    await user.click(screen.getByRole("button", { name: "Record pending binding from archive" }));

    const options = vi.mocked(fetch).mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(options.body))).toEqual({ sourceArtifactId, snapshotHash });
    expect(String(options.body)).not.toContain(sourceHash);
    expect(await screen.findByRole("status")).toHaveTextContent(/pending SignWell production binding/i);
  });

  it("records only the archived-source ID and exact manual attestation", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(successfulResponse()));
    renderControls(releaseDeal({
      providerBindingCount: 1,
      providerBindings: [pendingBinding()],
      readinessBlockers: ["verification", "business", "legal"],
    }), { artifact: templateSourceArtifact() });

    const verification = screen.getByRole("heading", { name: "Attest to the reviewed source" }).closest("section");
    expect(verification).not.toBeNull();
    await user.click(within(verification!).getByLabelText(verificationAttestation));
    await user.click(within(verification!).getByRole("button", { name: "Record manual verification" }));

    expect(fetch).toHaveBeenCalledWith(
      `/api/admin/deals/${dealId}/signing-binding/verify`,
      expect.objectContaining({ method: "POST" }),
    );
    const options = vi.mocked(fetch).mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(options.body))).toEqual({
      sourceArtifactId,
      snapshotHash,
      attestation: verificationAttestation,
    });
    expect(await screen.findByRole("status")).toHaveTextContent(/does not claim SignWell API verification/i);
  });

  it("records an exact-snapshot approval and prevents one administrator from satisfying both gates", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(successfulResponse()));
    const { rerender } = renderControls(releaseDeal());

    await user.type(screen.getByLabelText("Business approval note (optional)"), "Commercial terms accepted.");
    await user.click(screen.getByRole("button", { name: "Record business approval" }));

    const options = vi.mocked(fetch).mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(options.body))).toEqual({
      kind: "business",
      snapshotHash,
      note: "Commercial terms accepted.",
    });

    rerender(
      <DealReleaseControls
        activationConfirmation={activationConfirmation}
        actorUserId={actorId}
        deal={releaseDeal({
          approvalCount: 1,
          businessApprovalCount: 1,
          approvals: [approval("business", actorId)],
        })}
        role="admin"
        templateSourceArtifact={null}
        templateSourceUnavailable={false}
        verificationAttestation={verificationAttestation}
      />,
    );

    expect(screen.getByText(/different active administrator must record this approval/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Record legal approval" })).toBeDisabled();
    expect(screen.getByText(/does not establish human identity separation/i)).toBeInTheDocument();
    expect(screen.getByLabelText("Legal review reference (required)")).toBeRequired();
  });

  it("requires a reason and revokes one approval against the loaded snapshot", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(successfulResponse()));
    renderControls(releaseDeal({
      approvalCount: 1,
      businessApprovalCount: 1,
      approvals: [approval("business", businessAdminId)],
    }));

    const button = screen.getByRole("button", { name: "Revoke business approval" });
    await user.click(button);
    expect(fetch).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText("Business revocation reason"), "Commercial terms need revision.");
    await user.click(button);

    expect(fetch).toHaveBeenCalledWith(
      `/api/admin/deals/${dealId}/approvals/revoke`,
      expect.objectContaining({ method: "POST" }),
    );
    const options = vi.mocked(fetch).mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(options.body))).toEqual({
      kind: "business",
      snapshotHash,
      reason: "Commercial terms need revision.",
    });
  });

  it("reveals activation only for coherent ready evidence and requires the exact typed confirmation", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(successfulResponse()));
    renderControls(releaseDeal({
      providerTemplateHash: sourceHash,
      providerBindingCount: 1,
      approvalCount: 2,
      businessApprovalCount: 1,
      legalApprovalCount: 1,
      readinessBlockerCount: 0,
      activationReady: true,
      readinessBlockers: [],
      providerBindings: [verifiedBinding()],
      approvals: [
        approval("business", businessAdminId),
        approval("legal", legalAdminId),
      ],
    }), { artifact: templateSourceArtifact() });

    const button = screen.getByRole("button", { name: "Activate exact snapshot as default" });
    expect(button).toBeDisabled();
    await user.type(screen.getByLabelText("Type the full confirmation"), "ACTIVATE");
    expect(button).toBeDisabled();
    await user.clear(screen.getByLabelText("Type the full confirmation"));
    await user.type(screen.getByLabelText("Type the full confirmation"), activationConfirmation);
    expect(button).toBeEnabled();
    await user.click(button);

    expect(fetch).toHaveBeenCalledWith(
      `/api/admin/deals/${dealId}/activate`,
      expect.objectContaining({ method: "POST" }),
    );
    const options = vi.mocked(fetch).mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(options.body))).toEqual({
      snapshotHash,
      confirmation: activationConfirmation,
    });
  });

  it("fails closed when a successful response does not match the loaded snapshot", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        deal: { id: dealId, snapshotHash: "f".repeat(64) },
      }),
    }));
    renderControls(releaseDeal());

    await user.click(screen.getByRole("button", { name: "Record business approval" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/did not match this loaded snapshot/i);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});
