import { createHmac } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createSignWellAgreementDraft,
  getSignWellReadiness,
  sendSignWellAgreement,
  SignWellError,
  verifySignWellWebhook,
} from "@/lib/agreements/signwell";

const webhookId = "8f989068-8a41-4822-9428-5e4e703adabc";
const documentId = "c4e4dbd4-4594-43b3-87b0-0b62b10b656b";
const agreementId = "598ab5cf-f047-4c4b-973a-fb17cf900799";
const dealSnapshotSha256 = "a".repeat(64);
const providerTemplateId = "c0593039-c093-4fd4-af40-ee59af4ff92f";

describe("SignWell configuration", () => {
  beforeEach(() => {
    vi.stubEnv("AGREEMENT_PROVIDER", "signwell");
    vi.stubEnv("AGREEMENT_API_KEY", "rotated-production-shaped-key");
    vi.stubEnv("AGREEMENT_WEBHOOK_SECRET", webhookId);
    vi.stubEnv("AGREEMENT_ARCHIVE_ENABLED", "true");
    vi.stubEnv("AGREEMENT_SEND_ENABLED", "true");
    vi.stubEnv("AGREEMENT_TEST_MODE", "true");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("stays fail-closed until every send gate is present", () => {
    expect(getSignWellReadiness()).toMatchObject({ readyToSend: true, testMode: true });
    vi.stubEnv("AGREEMENT_WEBHOOK_SECRET", "");
    expect(getSignWellReadiness().readyToSend).toBe(false);
    vi.stubEnv("AGREEMENT_WEBHOOK_SECRET", webhookId);
    vi.stubEnv("AGREEMENT_SEND_ENABLED", "false");
    expect(getSignWellReadiness().readyToSend).toBe(false);
  });

  it("does not trust obsolete process-wide template variables", () => {
    vi.stubEnv("AGREEMENT_TEMPLATE_ID", "31f53cbf-6b41-4813-8d2c-0bf382081dd3");
    vi.stubEnv("AGREEMENT_TEMPLATE_TERMS_SHA256", "b".repeat(64));
    vi.stubEnv("AGREEMENT_TEMPLATE_DEAL_SNAPSHOT_SHA256", "c".repeat(64));

    expect(getSignWellReadiness()).toMatchObject({ readyToSend: true });
  });

  it("uses a retired assignment's DB binding when obsolete env values point at a new default", async () => {
    vi.stubEnv("AGREEMENT_TEMPLATE_ID", "31f53cbf-6b41-4813-8d2c-0bf382081dd3");
    vi.stubEnv("AGREEMENT_TEMPLATE_TERMS_SHA256", "b".repeat(64));
    vi.stubEnv("AGREEMENT_TEMPLATE_DEAL_SNAPSHOT_SHA256", "c".repeat(64));
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      id: documentId,
      recipients: [{
        id: "1",
        email: "creator@example.com",
        name: "Creator Name",
        embedded_signing_url: "https://www.signwell.com/docs/secure-link/",
      }],
    }), { status: 201, headers: { "Content-Type": "application/json" } }));

    await expect(createSignWellAgreementDraft({
      agreementId,
      enrollmentId: "fb993493-53d7-4a07-b3ae-86e266ecb9e3",
      dealVersionId: "264d8fe6-5b59-428a-a6d1-ac146940c8ed",
      dealSnapshotSha256,
      providerTemplateId,
      signerName: "Creator Name",
      signerEmail: "creator@example.com",
      redirectUrl: "https://gotall-creator-platform.vercel.app/onboarding/agreement",
    })).resolves.toEqual({
      documentId,
      templateId: providerTemplateId,
      dealSnapshotSha256,
    });

    const request = fetchMock.mock.calls[0];
    expect(request[0]).toBe("https://www.signwell.com/api/v1/document_templates/documents");
    const options = request[1] as RequestInit;
    expect(JSON.parse(String(options.body))).toMatchObject({
      test_mode: true,
      template_id: "c0593039-c093-4fd4-af40-ee59af4ff92f",
      embedded_signing: true,
      draft: true,
      metadata: {
        agreement_record_id: agreementId,
        deal_snapshot_sha256: dealSnapshotSha256,
      },
    });
  });

  it("refuses malformed database binding evidence before making a provider request", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");

    await expect(createSignWellAgreementDraft({
      agreementId,
      enrollmentId: "fb993493-53d7-4a07-b3ae-86e266ecb9e3",
      dealVersionId: "264d8fe6-5b59-428a-a6d1-ac146940c8ed",
      dealSnapshotSha256: "b".repeat(63),
      providerTemplateId,
      signerName: "Creator Name",
      signerEmail: "creator@example.com",
      redirectUrl: "https://gotall-creator-platform.vercel.app/onboarding/agreement",
    })).rejects.toMatchObject({
      safeCode: "invalid_verified_template_binding",
    } satisfies Partial<SignWellError>);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends an attached draft and rejects provider-controlled redirects outside SignWell", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      id: documentId,
      recipients: [{ email: "creator@example.com", embedded_signing_url: "https://attacker.example/docs/a" }],
    }), { status: 201 }));

    await expect(sendSignWellAgreement({
      documentId,
      dealSnapshotSha256,
      providerTemplateId,
      signerEmail: "creator@example.com",
      redirectUrl: "https://gotall-creator-platform.vercel.app/onboarding/agreement",
    })).rejects.toMatchObject({ safeCode: "invalid_signing_url" } satisfies Partial<SignWellError>);

    expect(globalThis.fetch).toHaveBeenCalledWith(
      `https://www.signwell.com/api/v1/documents/${documentId}/send`,
      expect.objectContaining({ method: "POST" }),
    );
  });
});

describe("SignWell webhooks", () => {
  beforeEach(() => vi.stubEnv("AGREEMENT_WEBHOOK_SECRET", webhookId));
  afterEach(() => vi.unstubAllEnvs());

  function bodyFor(time: number, overrideHash?: string) {
    const type = "document_completed";
    const hash = overrideHash ?? createHmac("sha256", webhookId).update(`${type}@${time}`).digest("hex");
    return JSON.stringify({
      event: { hash, time, type, related_signer: { email: "creator@example.com" } },
      data: { object: { id: documentId, status: "Completed" }, account_id: "account" },
    });
  }

  it("verifies HMAC, timestamp, document identity, and produces an idempotency key", () => {
    const time = 1_788_194_400;
    expect(verifySignWellWebhook(bodyFor(time), new Date(time * 1000))).toMatchObject({
      eventType: "document_completed",
      eventTimestamp: new Date(time * 1000).toISOString(),
      documentId,
      externalEventId: expect.stringMatching(/^[a-f0-9]{64}$/u),
      payloadSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
  });

  it("rejects bad signatures and impossible future events while accepting delayed retries", () => {
    const time = 1_788_194_400;
    expect(() => verifySignWellWebhook(bodyFor(time, "0".repeat(64)), new Date(time * 1000)))
      .toThrowError(/invalid_webhook_signature/u);
    expect(verifySignWellWebhook(bodyFor(time), new Date((time + 86_400) * 1000)))
      .toMatchObject({ eventType: "document_completed" });
    expect(() => verifySignWellWebhook(bodyFor(time + 301), new Date(time * 1000)))
      .toThrowError(/future_webhook_event/u);
  });
});
