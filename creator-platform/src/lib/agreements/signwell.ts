import { createHash, createHmac, timingSafeEqual } from "node:crypto";

const SIGNWELL_API_ORIGIN = "https://www.signwell.com";
const SIGNWELL_API_BASE = `${SIGNWELL_API_ORIGIN}/api/v1`;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const HEX_64_PATTERN = /^[a-f0-9]{64}$/iu;
const MAX_RESPONSE_BYTES = 1_048_576;
const MAX_ARTIFACT_BYTES = 33_554_432;

function envValue(name: string) {
  const value = process.env[name];
  return value?.trim() || null;
}

export type SignWellReadiness = {
  selected: boolean;
  apiKeyConfigured: boolean;
  webhookConfigured: boolean;
  archiveConfigured: boolean;
  sendEnabled: boolean;
  testMode: boolean;
  readyToSend: boolean;
};

type SignWellConfig = {
  apiKey: string;
  templateId: string;
  creatorPlaceholder: string;
  dealSnapshotSha256: string;
  testMode: boolean;
};

export function getSignWellReadiness(): SignWellReadiness {
  const selected = envValue("AGREEMENT_PROVIDER")?.toLowerCase() === "signwell";
  const apiKeyConfigured = (envValue("AGREEMENT_API_KEY")?.length ?? 0) >= 20;
  const webhookConfigured = (envValue("AGREEMENT_WEBHOOK_SECRET")?.length ?? 0) >= 20;
  const archiveConfigured = envValue("AGREEMENT_ARCHIVE_ENABLED")?.toLowerCase() === "true";
  const sendEnabled = envValue("AGREEMENT_SEND_ENABLED")?.toLowerCase() === "true";
  const testMode = envValue("AGREEMENT_TEST_MODE")?.toLowerCase() !== "false";
  const liveApproved = envValue("AGREEMENT_LIVE_MODE_APPROVED")?.toLowerCase() === "true";

  return {
    selected,
    apiKeyConfigured,
    webhookConfigured,
    archiveConfigured,
    sendEnabled,
    testMode,
    readyToSend: selected
      && apiKeyConfigured
      && webhookConfigured
      && archiveConfigured
      && sendEnabled
      && (testMode || liveApproved),
  };
}

function getSignWellConfig(
  expectedDealSnapshotSha256: string,
  expectedProviderTemplateId: string,
): SignWellConfig {
  const readiness = getSignWellReadiness();
  const apiKey = envValue("AGREEMENT_API_KEY");
  const creatorPlaceholder = envValue("AGREEMENT_CREATOR_PLACEHOLDER") ?? "Creator";

  if (!readiness.readyToSend || !apiKey) {
    throw new SignWellError("not_ready", 503);
  }

  if (creatorPlaceholder.length > 100) {
    throw new SignWellError("invalid_configuration", 503);
  }

  if (!HEX_64_PATTERN.test(expectedDealSnapshotSha256)
    || !UUID_PATTERN.test(expectedProviderTemplateId)
  ) {
    throw new SignWellError("invalid_verified_template_binding", 503);
  }

  return {
    apiKey,
    templateId: expectedProviderTemplateId,
    creatorPlaceholder,
    dealSnapshotSha256: expectedDealSnapshotSha256.toLowerCase(),
    testMode: readiness.testMode,
  };
}

export class SignWellError extends Error {
  constructor(
    public readonly safeCode: string,
    public readonly status: number,
  ) {
    super(`SignWell request failed: ${safeCode}`);
  }
}

type SignWellRecipient = {
  id?: string;
  email?: string;
  name?: string;
  embedded_signing_url?: string;
};

type SignWellDocument = {
  id?: string;
  recipients?: SignWellRecipient[];
};

async function signWellRequest(
  path: string,
  config: SignWellConfig,
  options: { method?: "GET" | "POST"; body?: Record<string, unknown> } = {},
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);

  try {
    const response = await fetch(`${SIGNWELL_API_BASE}${path}`, {
      method: options.method ?? "GET",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Api-Key": config.apiKey,
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      cache: "no-store",
      signal: controller.signal,
    });
    const raw = await response.text();
    if (Buffer.byteLength(raw, "utf8") > MAX_RESPONSE_BYTES) {
      throw new SignWellError("oversized_response", 502);
    }

    let data: unknown = null;
    try {
      data = raw ? JSON.parse(raw) : null;
    } catch {
      throw new SignWellError("invalid_response", 502);
    }

    if (!response.ok) {
      const safeCode = response.status === 401
        ? "provider_authentication"
        : response.status === 429
          ? "provider_rate_limit"
          : response.status === 422 || response.status === 400
            ? "provider_rejected_document"
            : "provider_unavailable";
      throw new SignWellError(safeCode, response.status === 429 ? 503 : 502);
    }

    return data;
  } catch (error) {
    if (error instanceof SignWellError) throw error;
    throw new SignWellError(
      error instanceof Error && error.name === "AbortError" ? "provider_timeout" : "provider_unavailable",
      503,
    );
  } finally {
    clearTimeout(timeout);
  }
}

function documentValue(value: unknown): SignWellDocument {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as SignWellDocument)
    : {};
}

function signingUrl(document: SignWellDocument, expectedEmail: string) {
  const recipient = document.recipients?.find(
    (candidate) => candidate.email?.toLowerCase() === expectedEmail.toLowerCase(),
  ) ?? document.recipients?.[0];
  const value = recipient?.embedded_signing_url;
  if (!value) throw new SignWellError("missing_signing_url", 502);

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new SignWellError("invalid_signing_url", 502);
  }
  if (url.protocol !== "https:" || url.hostname !== "www.signwell.com" || !url.pathname.startsWith("/docs/")) {
    throw new SignWellError("invalid_signing_url", 502);
  }
  return url.toString();
}

export async function createSignWellAgreementDraft(input: {
  agreementId: string;
  enrollmentId: string;
  dealVersionId: string;
  dealSnapshotSha256: string;
  providerTemplateId: string;
  signerName: string;
  signerEmail: string;
  redirectUrl: string;
}) {
  const config = getSignWellConfig(
    input.dealSnapshotSha256,
    input.providerTemplateId,
  );
  const data = documentValue(await signWellRequest("/document_templates/documents", config, {
    method: "POST",
    body: {
      test_mode: config.testMode,
      template_id: config.templateId,
      name: `GoTall creator agreement — ${input.signerName}`,
      subject: "Your GoTall creator agreement",
      message: "Review and sign your creator agreement to complete onboarding.",
      recipients: [{
        id: "1",
        placeholder_name: config.creatorPlaceholder,
        name: input.signerName,
        email: input.signerEmail,
      }],
      embedded_signing: true,
      embedded_signing_notifications: true,
      draft: true,
      reminders: true,
      allow_decline: true,
      allow_reassign: false,
      redirect_url: input.redirectUrl,
      metadata: {
        agreement_record_id: input.agreementId,
        enrollment_id: input.enrollmentId,
        deal_version_id: input.dealVersionId,
        deal_snapshot_sha256: input.dealSnapshotSha256,
      },
    },
  }));

  if (!data.id || !UUID_PATTERN.test(data.id)) {
    throw new SignWellError("missing_document_id", 502);
  }

  return {
    documentId: data.id,
    templateId: config.templateId,
    dealSnapshotSha256: config.dealSnapshotSha256,
  };
}

export async function sendSignWellAgreement(input: {
  documentId: string;
  dealSnapshotSha256: string;
  providerTemplateId: string;
  signerEmail: string;
  redirectUrl: string;
}) {
  if (!UUID_PATTERN.test(input.documentId)) {
    throw new SignWellError("invalid_document_id", 400);
  }
  const config = getSignWellConfig(
    input.dealSnapshotSha256,
    input.providerTemplateId,
  );
  const data = documentValue(await signWellRequest(
    `/documents/${encodeURIComponent(input.documentId)}/send`,
    config,
    {
      method: "POST",
      body: {
        test_mode: config.testMode,
        reminders: true,
        allow_decline: true,
        allow_reassign: false,
        redirect_url: input.redirectUrl,
      },
    },
  ));
  return signingUrl(data, input.signerEmail);
}

export async function getSignWellAgreementSigningUrl(
  documentId: string,
  signerEmail: string,
  dealSnapshotSha256: string,
  providerTemplateId: string,
) {
  if (!UUID_PATTERN.test(documentId)) throw new SignWellError("invalid_document_id", 400);
  const config = getSignWellConfig(dealSnapshotSha256, providerTemplateId);
  const data = documentValue(await signWellRequest(
    `/documents/${encodeURIComponent(documentId)}`,
    config,
  ));
  return signingUrl(data, signerEmail);
}

export async function getSignWellCompletedArtifact(documentId: string) {
  if (!UUID_PATTERN.test(documentId)) throw new SignWellError("invalid_document_id", 400);
  const apiKey = envValue("AGREEMENT_API_KEY");
  if (envValue("AGREEMENT_PROVIDER")?.toLowerCase() !== "signwell"
    || !apiKey
    || apiKey.length < 20
    || envValue("AGREEMENT_ARCHIVE_ENABLED")?.toLowerCase() !== "true"
  ) {
    throw new SignWellError("archive_not_ready", 503);
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(
      `${SIGNWELL_API_BASE}/documents/${encodeURIComponent(documentId)}/completed_pdf?audit_page=true&file_format=pdf&url_only=false`,
      {
        headers: { Accept: "application/pdf", "X-Api-Key": apiKey },
        cache: "no-store",
        signal: controller.signal,
      },
    );
    if (!response.ok) {
      throw new SignWellError(
        response.status === 400 || response.status === 404
          ? "completed_artifact_not_ready"
          : response.status === 429
            ? "provider_rate_limit"
            : "provider_unavailable",
        503,
      );
    }
    const declaredLength = Number(response.headers.get("content-length") ?? 0);
    if (Number.isFinite(declaredLength) && declaredLength > MAX_ARTIFACT_BYTES) {
      throw new SignWellError("oversized_artifact", 502);
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.length
      || bytes.length > MAX_ARTIFACT_BYTES
      || bytes.subarray(0, 5).toString("ascii") !== "%PDF-"
    ) {
      throw new SignWellError("invalid_completed_artifact", 502);
    }
    return {
      bytes,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
  } catch (error) {
    if (error instanceof SignWellError) throw error;
    throw new SignWellError(
      error instanceof Error && error.name === "AbortError"
        ? "provider_timeout"
        : "provider_unavailable",
      503,
    );
  } finally {
    clearTimeout(timeout);
  }
}

export type VerifiedSignWellEvent = {
  externalEventId: string;
  eventType: string;
  eventTimestamp: string;
  documentId: string;
  payloadSha256: string;
};

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function verifySignWellWebhook(
  rawBody: string,
  now = new Date(),
): VerifiedSignWellEvent {
  const webhookId = envValue("AGREEMENT_WEBHOOK_SECRET");
  if (!webhookId || webhookId.length < 20) throw new SignWellError("webhook_not_configured", 503);

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    throw new SignWellError("invalid_webhook_json", 400);
  }

  const root = objectRecord(payload);
  const event = objectRecord(root?.event);
  const data = objectRecord(root?.data);
  const document = objectRecord(data?.object);
  const relatedSigner = objectRecord(event?.related_signer);
  const eventHash = typeof event?.hash === "string" ? event.hash.toLowerCase() : "";
  const eventType = typeof event?.type === "string" ? event.type.trim().toLowerCase() : "";
  const eventTime = typeof event?.time === "number" ? event.time : Number(event?.time);
  const documentId = typeof document?.id === "string" ? document.id.trim() : "";

  if (!HEX_64_PATTERN.test(eventHash)
    || !/^document_[a-z_]{2,60}$/u.test(eventType)
    || !Number.isSafeInteger(eventTime)
    || !UUID_PATTERN.test(documentId)
  ) {
    throw new SignWellError("invalid_webhook_event", 400);
  }

  // SignWell can legitimately retry an old event. Authenticity comes from the
  // provider HMAC and database idempotency; only impossible future timestamps
  // are rejected so delayed retries are not discarded.
  if (eventTime > now.getTime() / 1000 + 300) {
    throw new SignWellError("future_webhook_event", 401);
  }

  const actual = Buffer.from(eventHash, "hex");
  const expected = createHmac("sha256", webhookId)
    .update(`${eventType}@${eventTime}`)
    .digest();
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new SignWellError("invalid_webhook_signature", 401);
  }

  const signerReference = typeof relatedSigner?.email === "string"
    ? relatedSigner.email.trim().toLowerCase()
    : "";
  const externalEventId = createHash("sha256")
    .update(`${documentId}|${eventType}|${eventTime}|${signerReference}`)
    .digest("hex");

  return {
    externalEventId,
    eventType,
    eventTimestamp: new Date(eventTime * 1000).toISOString(),
    documentId,
    payloadSha256: createHash("sha256").update(rawBody).digest("hex"),
  };
}
