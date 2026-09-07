import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getClaims: vi.fn(),
  routeRpc: vi.fn(),
  adminRpc: vi.fn(),
  readiness: vi.fn(),
  createDraft: vi.fn(),
  getSigningUrl: vi.fn(),
  sendAgreement: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createRouteHandlerClient: () => ({
    auth: { getClaims: mocks.getClaims },
    rpc: mocks.routeRpc,
  }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ rpc: mocks.adminRpc }),
}));

vi.mock("@/lib/server-env", () => ({
  getAppOrigin: () => "https://gotall-creator-platform.vercel.app",
}));

vi.mock("@/lib/agreements/signwell", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/agreements/signwell")>(),
  createSignWellAgreementDraft: mocks.createDraft,
  getSignWellAgreementSigningUrl: mocks.getSigningUrl,
  getSignWellReadiness: mocks.readiness,
  sendSignWellAgreement: mocks.sendAgreement,
}));

import { POST } from "@/app/api/agreements/signwell/open/route";

const signingUrl = "https://www.signwell.com/docs/creator-agreement";
const externalAgreementId = "5ccaf055-993b-4e90-83fb-bd735a5793f4";
const providerTemplateId = "31f53cbf-6b41-4813-8d2c-0bf382081dd3";

function request() {
  return new NextRequest(
    "https://gotall-creator-platform.vercel.app/api/agreements/signwell/open",
    {
      method: "POST",
      headers: { Origin: "https://gotall-creator-platform.vercel.app" },
    },
  );
}

function signingContext(
  status: string,
  includeExternalAgreement = false,
  provisioningStartedAt: string | null = null,
) {
  return [{
    agreement_id: "598ab5cf-f047-4c4b-973a-fb17cf900799",
    enrollment_id: "fb993917-4ec5-49ce-b437-f082074064f6",
    deal_version_id: "264df1b2-9ce7-439d-a7d4-38a464b23ed0",
    provider: "signwell",
    provider_environment: "test",
    external_agreement_id: includeExternalAgreement ? externalAgreementId : null,
    agreement_status: status,
    signer_name: "Creator Name",
    signer_email: "creator@example.com",
    provider_template_id: includeExternalAgreement ? providerTemplateId : null,
    deal_snapshot_sha256: includeExternalAgreement ? "a".repeat(64) : null,
    verified_provider_template_id: providerTemplateId,
    verified_deal_snapshot_sha256: "a".repeat(64),
    provisioning_started_at: provisioningStartedAt,
    sent_at: null,
    completed_at: null,
  }];
}

function redirect(response: Response) {
  const location = response.headers.get("location");
  expect(location).not.toBeNull();
  return new URL(location!);
}

function expectNoProviderOrProvisioningCalls() {
  expect(mocks.adminRpc).not.toHaveBeenCalled();
  expect(mocks.createDraft).not.toHaveBeenCalled();
  expect(mocks.getSigningUrl).not.toHaveBeenCalled();
  expect(mocks.sendAgreement).not.toHaveBeenCalled();
}

describe("SignWell agreement opening state gates", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
    mocks.getClaims.mockResolvedValue({
      data: { claims: { sub: "creator-account-id" } },
      error: null,
    });
    mocks.readiness.mockReturnValue({ readyToSend: true, testMode: true });
    mocks.getSigningUrl.mockResolvedValue(signingUrl);
  });

  it.each([
    {
      status: "creator_accepted",
      pathname: "/onboarding/agreement",
      messageKey: "notice",
      message: "Your signing step was submitted. Completion confirmation is still processing.",
    },
    {
      status: "preparing",
      pathname: "/onboarding/agreement",
      messageKey: "notice",
      message: "Agreement preparation is already running. Refresh in a moment.",
    },
    {
      status: "declined",
      pathname: "/onboarding/agreement",
      messageKey: "error",
      message: "This agreement can’t be opened from its current state.",
    },
    {
      status: "voided",
      pathname: "/onboarding/agreement",
      messageKey: "error",
      message: "This agreement can’t be opened from its current state.",
    },
    {
      status: "completed",
      pathname: "/account",
      messageKey: "notice",
      message: "Your completed agreement is already confirmed.",
    },
  ])("blocks provider and provisioning calls for $status agreements", async (fixture) => {
    mocks.routeRpc.mockResolvedValue({
      data: signingContext(fixture.status, true),
      error: null,
    });

    const response = await POST(request());
    const location = redirect(response);

    expect(response.status).toBe(303);
    expect(location.pathname).toBe(fixture.pathname);
    expect(location.searchParams.get(fixture.messageKey)).toBe(fixture.message);
    expect(mocks.routeRpc).toHaveBeenCalledOnce();
    expectNoProviderOrProvisioningCalls();
  });

  it("provisions a newly assigned agreement through the leased database path", async () => {
    const agreementId = "598ab5cf-f047-4c4b-973a-fb17cf900799";
    const provisioningToken = "8b123ed0-5780-4434-a48c-1a20f529db95";
    const dealSnapshotSha256 = "a".repeat(64);
    mocks.routeRpc.mockResolvedValue({
      data: signingContext("assigned"),
      error: null,
    });
    mocks.adminRpc.mockImplementation(async (name: string) => {
      if (name === "begin_own_signwell_agreement_provisioning") {
        return {
          data: [{
            agreement_id: agreementId,
            provisioning_token: provisioningToken,
            enrollment_id: "fb993917-4ec5-49ce-b437-f082074064f6",
            deal_version_id: "264df1b2-9ce7-439d-a7d4-38a464b23ed0",
            deal_snapshot_sha256: dealSnapshotSha256,
            provider_template_id: providerTemplateId,
            signer_name: "Creator Name",
            signer_email: "creator@example.com",
            external_agreement_id: null,
          }],
          error: null,
        };
      }
      return { data: agreementId, error: null };
    });
    mocks.createDraft.mockResolvedValue({
      documentId: externalAgreementId,
      templateId: providerTemplateId,
      dealSnapshotSha256,
    });

    const response = await POST(request());

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(signingUrl);
    expect(mocks.adminRpc).toHaveBeenNthCalledWith(
      1,
      "begin_own_signwell_agreement_provisioning",
      { target_account_id: "creator-account-id", target_environment: "test" },
    );
    expect(mocks.createDraft).toHaveBeenCalledOnce();
    expect(mocks.createDraft).toHaveBeenCalledWith(expect.objectContaining({
      dealSnapshotSha256,
      providerTemplateId,
    }));
    expect(mocks.adminRpc).toHaveBeenNthCalledWith(
      2,
      "attach_own_signwell_agreement_document",
      expect.objectContaining({
        target_agreement_id: agreementId,
        target_provisioning_token: provisioningToken,
        signwell_document_id: externalAgreementId,
        bound_deal_snapshot_sha256: dealSnapshotSha256,
      }),
    );
    expect(mocks.adminRpc).toHaveBeenNthCalledWith(
      3,
      "complete_own_signwell_agreement_provisioning",
      expect.objectContaining({
        target_agreement_id: agreementId,
        target_provisioning_token: provisioningToken,
        signwell_document_id: externalAgreementId,
      }),
    );
  });

  it("keeps a fresh preparing lease refresh-only", async () => {
    mocks.routeRpc.mockResolvedValue({
      data: signingContext("preparing", true, new Date().toISOString()),
      error: null,
    });

    const response = await POST(request());
    const location = redirect(response);

    expect(location.searchParams.get("notice")).toBe(
      "Agreement preparation is already running. Refresh in a moment.",
    );
    expectNoProviderOrProvisioningCalls();
  });

  it("recovers an expired preparing lease without creating a second known document", async () => {
    const provisioningToken = "8b123ed0-5780-4434-a48c-1a20f529db95";
    mocks.routeRpc.mockResolvedValue({
      data: signingContext(
        "preparing",
        true,
        new Date(Date.now() - 11 * 60 * 1_000).toISOString(),
      ),
      error: null,
    });
    mocks.adminRpc.mockImplementation(async (name: string) => name === "begin_own_signwell_agreement_provisioning"
      ? {
          data: [{
            agreement_id: "598ab5cf-f047-4c4b-973a-fb17cf900799",
            provisioning_token: provisioningToken,
            enrollment_id: "fb993917-4ec5-49ce-b437-f082074064f6",
            deal_version_id: "264df1b2-9ce7-439d-a7d4-38a464b23ed0",
            deal_snapshot_sha256: "a".repeat(64),
            provider_template_id: providerTemplateId,
            signer_name: "Creator Name",
            signer_email: "creator@example.com",
            external_agreement_id: externalAgreementId,
          }],
          error: null,
        }
      : { data: externalAgreementId, error: null });

    const response = await POST(request());

    expect(response.headers.get("location")).toBe(signingUrl);
    expect(mocks.adminRpc).toHaveBeenCalledWith(
      "begin_own_signwell_agreement_provisioning",
      expect.any(Object),
    );
    expect(mocks.createDraft).not.toHaveBeenCalled();
    expect(mocks.sendAgreement).not.toHaveBeenCalled();
    expect(mocks.getSigningUrl).toHaveBeenCalledWith(
      externalAgreementId,
      "creator@example.com",
      "a".repeat(64),
      providerTemplateId,
    );
  });

  it.each(["sent", "viewed"])(
    "continues an existing %s agreement without creating or sending another document",
    async (status) => {
      mocks.routeRpc.mockResolvedValue({
        data: signingContext(status, true),
        error: null,
      });

      const response = await POST(request());

      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe(signingUrl);
      expect(mocks.getSigningUrl).toHaveBeenCalledOnce();
      expect(mocks.getSigningUrl).toHaveBeenCalledWith(
        externalAgreementId,
        "creator@example.com",
        "a".repeat(64),
        providerTemplateId,
      );
      expect(mocks.adminRpc).not.toHaveBeenCalled();
      expect(mocks.createDraft).not.toHaveBeenCalled();
      expect(mocks.sendAgreement).not.toHaveBeenCalled();
    },
  );

  it.each([
    { provider: "signwell", providerEnvironment: "test", label: "another SignWell environment" },
    { provider: "another-provider", providerEnvironment: "production", label: "another provider" },
  ])("does not reopen an existing document from $label", async ({ provider, providerEnvironment }) => {
    mocks.readiness.mockReturnValue({ readyToSend: true, testMode: false });
    const mismatchedContext = signingContext("sent", true);
    mismatchedContext[0].provider = provider;
    mismatchedContext[0].provider_environment = providerEnvironment;
    mocks.routeRpc.mockResolvedValue({ data: mismatchedContext, error: null });

    const response = await POST(request());
    const location = redirect(response);

    expect(location.pathname).toBe("/onboarding/agreement");
    expect(location.searchParams.get("error")).toBe(
      "Your agreement template binding needs staff review before it can be reopened.",
    );
    expectNoProviderOrProvisioningCalls();
  });

  it("does not reopen a provider document without stored combined-snapshot evidence", async () => {
    const legacyContext = signingContext("sent", true);
    legacyContext[0].deal_snapshot_sha256 = null;
    mocks.routeRpc.mockResolvedValue({ data: legacyContext, error: null });

    const response = await POST(request());
    const location = redirect(response);

    expect(location.pathname).toBe("/onboarding/agreement");
    expect(location.searchParams.get("error")).toBe(
      "Your agreement template binding needs staff review before it can be reopened.",
    );
    expectNoProviderOrProvisioningCalls();
  });

  it("rejects a legacy terms-only lease before creating or sending a document", async () => {
    mocks.routeRpc.mockResolvedValue({
      data: signingContext("assigned"),
      error: null,
    });
    mocks.adminRpc.mockResolvedValueOnce({
      data: [{
        agreement_id: "598ab5cf-f047-4c4b-973a-fb17cf900799",
        provisioning_token: "8b123ed0-5780-4434-a48c-1a20f529db95",
        enrollment_id: "fb993917-4ec5-49ce-b437-f082074064f6",
        deal_version_id: "264df1b2-9ce7-439d-a7d4-38a464b23ed0",
        deal_terms_sha256: "a".repeat(64),
        signer_name: "Creator Name",
        signer_email: "creator@example.com",
        external_agreement_id: null,
      }],
      error: null,
    });

    const response = await POST(request());
    const location = redirect(response);

    expect(location.pathname).toBe("/onboarding/agreement");
    expect(location.searchParams.get("error")).toBe("Your agreement could not be prepared yet.");
    expect(mocks.createDraft).not.toHaveBeenCalled();
    expect(mocks.getSigningUrl).not.toHaveBeenCalled();
    expect(mocks.sendAgreement).not.toHaveBeenCalled();
  });
});
