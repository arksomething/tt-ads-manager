import { createHash } from "node:crypto";
import { rootCertificates } from "node:tls";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/v1/creator-tracker/ingestion/batches/route";
import {
  loadCreatorTrackerIngestionRuntimeConfig,
  signCreatorTrackerCommitReceipt,
  signCreatorTrackerIngestionRequest,
} from "@/lib/creator-tracker/ingestion-auth";
import {
  CREATOR_TRACKER_INGEST_PATH,
  creatorTrackerIngestionSchema,
  deriveIngestionCounts,
} from "@/lib/creator-tracker/ingestion-contract";
import {
  buildCreatorTrackerPoolConfig,
  CreatorTrackerIngestionStoreError,
} from "@/server/creator-tracker/ingestion-store";

import { fullCreatorTrackerPayload } from "./creator-tracker-fixture";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  normalizedPersist: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ rpc: mocks.rpc }),
}));

vi.mock("@/server/creator-tracker/ingestion-store", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/server/creator-tracker/ingestion-store")
  >();
  return {
    ...actual,
    createCreatorTrackerIngestionStore: () => ({
      persist: mocks.normalizedPersist,
    }),
  };
});

const now = Date.parse("2030-01-01T12:02:00.000Z");
const keyId = "collector-current";
const secret = Buffer.alloc(32, 7);
const organizationId = "org-ingestion-test";
const databaseUrl =
  "postgresql://ingest:password@database.example/tracker?sslmode=require";
const databaseCa = rootCertificates[0];

function commitReceipt(
  payload = creatorTrackerIngestionSchema.parse(fullCreatorTrackerPayload()),
  payloadSha256 = createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("hex"),
  replayed = false,
  committedAt = "2030-01-01T12:02:02.000Z",
) {
  return {
    batchId: payload.batch.id,
    organizationId: payload.batch.organizationId,
    idempotencyKey: payload.batch.idempotencyKey,
    payloadSha256,
    committedAt,
    ...deriveIngestionCounts(payload),
    replayed,
  };
}

function configure() {
  vi.stubEnv("CREATOR_INGEST_ALLOWED_ORGANIZATION_IDS", organizationId);
  vi.stubEnv("CREATOR_INGEST_CURRENT_KEY_ID", keyId);
  vi.stubEnv("CREATOR_INGEST_CURRENT_SECRET_B64", secret.toString("base64"));
  vi.stubEnv("CREATOR_TRACKER_V2_DATABASE_URL", databaseUrl);
  vi.stubEnv(
    "CREATOR_TRACKER_V2_DATABASE_CA_B64",
    Buffer.from(databaseCa, "utf8").toString("base64"),
  );
  vi.setSystemTime(now);
}

function signedRequest(payload: unknown, overrides: Record<string, string> = {}) {
  const body = JSON.stringify(payload);
  const contentSha256 = createHash("sha256").update(body).digest("hex");
  const timestamp = overrides.timestamp ?? String(Math.floor(now / 1_000));
  const signature = overrides.signature ?? signCreatorTrackerIngestionRequest(
    secret,
    keyId,
    timestamp,
    overrides.contentSha256 ?? contentSha256,
  );
  return new Request(`https://creator.example${CREATOR_TRACKER_INGEST_PATH}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-creator-ingest-key-id": keyId,
      "x-creator-ingest-timestamp": timestamp,
      "x-creator-ingest-content-sha256": overrides.contentSha256 ?? contentSha256,
      "x-creator-ingest-signature": signature,
    },
    body,
  });
}

describe("creator tracker ingestion bridge", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.unstubAllEnvs();
    configure();
    mocks.rpc.mockReset();
    mocks.normalizedPersist.mockReset();
    mocks.normalizedPersist.mockImplementation(async (payload, payloadSha256) =>
      commitReceipt(payload, payloadSha256),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("accepts the existing strict v2 contract and returns a signed post-commit receipt", async () => {
    const payload = creatorTrackerIngestionSchema.parse(fullCreatorTrackerPayload());
    const body = JSON.stringify(payload);
    const payloadSha256 = createHash("sha256").update(body).digest("hex");
    const counts = deriveIngestionCounts(payload);
    mocks.rpc.mockResolvedValue({
      data: {
        batchId: payload.batch.id,
        organizationId: payload.batch.organizationId,
        idempotencyKey: payload.batch.idempotencyKey,
        payloadSha256,
        committedAt: "2030-01-01T12:02:01.000Z",
        ...counts,
        replayed: false,
      },
      error: null,
    });

    const response = await POST(signedRequest(payload));
    expect(response.status).toBe(201);
    const responseText = await response.text();
    expect(JSON.parse(responseText)).toMatchObject({
      ok: true,
      status: "committed",
      batchId: payload.batch.id,
      payloadSha256,
      replayed: false,
      counts: {
        items: counts.itemCount,
        observations: 1,
        failures: 0,
      },
      rawEvidence: {
        manifest: "committed",
        bytes: "externally_pre_stored_unverified",
      },
    });
    expect(response.headers.get("x-creator-ingest-ack-key-id")).toBe(keyId);
    expect(response.headers.get("x-creator-ingest-ack-signature")).toBe(
      signCreatorTrackerCommitReceipt(secret, responseText),
    );
    expect(mocks.rpc).toHaveBeenCalledWith("ingest_creator_tracker_batch", {
      batch_input: payload,
      request_key_id: keyId,
      request_payload_sha256: payloadSha256,
    });
    expect(mocks.normalizedPersist).toHaveBeenCalledWith(payload, payloadSha256);
    expect(mocks.rpc.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.normalizedPersist.mock.invocationCallOrder[0],
    );
  });

  it("supports previous-key rotation without accepting unknown keys", () => {
    const previousSecret = Buffer.alloc(48, 9);
    const config = loadCreatorTrackerIngestionRuntimeConfig({
      CREATOR_TRACKER_V2_DATABASE_URL: databaseUrl,
      CREATOR_TRACKER_V2_DATABASE_CA_B64: Buffer.from(
        databaseCa,
        "utf8",
      ).toString("base64"),
      CREATOR_INGEST_ALLOWED_ORGANIZATION_IDS: organizationId,
      CREATOR_INGEST_CURRENT_KEY_ID: keyId,
      CREATOR_INGEST_CURRENT_SECRET_B64: secret.toString("base64"),
      CREATOR_INGEST_PREVIOUS_KEY_ID: "collector-previous",
      CREATOR_INGEST_PREVIOUS_SECRET_B64: previousSecret.toString("base64"),
    });
    expect(config.keys.get("collector-previous")?.secret).toEqual(previousSecret);
    expect(() => loadCreatorTrackerIngestionRuntimeConfig({
      CREATOR_TRACKER_V2_DATABASE_URL: databaseUrl,
      CREATOR_TRACKER_V2_DATABASE_CA_B64: Buffer.from(
        databaseCa,
        "utf8",
      ).toString("base64"),
      CREATOR_INGEST_ALLOWED_ORGANIZATION_IDS: organizationId,
      CREATOR_INGEST_CURRENT_KEY_ID: keyId,
      CREATOR_INGEST_CURRENT_SECRET_B64: secret.toString("base64"),
      CREATOR_INGEST_PREVIOUS_KEY_ID: "collector-previous",
    })).toThrow();
  });

  it("rejects tampering, stale signatures, unapproved organizations, and unknown fields before SQL", async () => {
    const tampered = await POST(signedRequest(fullCreatorTrackerPayload(), {
      contentSha256: "b".repeat(64),
    }));
    expect(tampered.status).toBe(401);

    const stale = await POST(signedRequest(fullCreatorTrackerPayload(), {
      timestamp: String(Math.floor(now / 1_000) - 301),
    }));
    expect(stale.status).toBe(401);

    const wrongOrganization = fullCreatorTrackerPayload();
    wrongOrganization.batch.organizationId = "another-organization";
    const forbidden = await POST(signedRequest(wrongOrganization));
    expect(forbidden.status).toBe(403);

    const unknown = { ...fullCreatorTrackerPayload(), surprise: true };
    const invalid = await POST(signedRequest(unknown));
    expect(invalid.status).toBe(422);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("never signs a receipt when the database rejects a reused idempotency key", async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { code: "23505", message: "IDEMPOTENCY_KEY_REUSED" },
    });
    const response = await POST(signedRequest(fullCreatorTrackerPayload()));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      ok: false,
      error: { code: "IDEMPOTENCY_KEY_REUSED" },
    });
    expect(response.headers.get("x-creator-ingest-ack-signature")).toBeNull();
    expect(mocks.normalizedPersist).not.toHaveBeenCalled();
  });

  it("withholds the receipt after a staging-only partial commit and safely completes it on retry", async () => {
    const payload = creatorTrackerIngestionSchema.parse(fullCreatorTrackerPayload());
    const payloadSha256 = createHash("sha256")
      .update(JSON.stringify(payload))
      .digest("hex");
    const counts = deriveIngestionCounts(payload);
    mocks.rpc.mockResolvedValue({
      data: {
        ...commitReceipt(payload, payloadSha256, false, "2030-01-01T12:02:01.000Z"),
        ...counts,
      },
      error: null,
    });
    mocks.normalizedPersist.mockRejectedValueOnce(
      new CreatorTrackerIngestionStoreError(
        "unavailable",
        "INGESTION_UNAVAILABLE",
        { cause: new Error("sensitive database connection detail") },
      ),
    );

    const incomplete = await POST(signedRequest(payload));
    expect(incomplete.status).toBe(503);
    expect(incomplete.headers.get("x-creator-ingest-ack-signature")).toBeNull();
    expect(await incomplete.json()).toEqual({
      ok: false,
      error: { code: "INGESTION_UNAVAILABLE" },
    });

    mocks.rpc.mockResolvedValue({
      data: commitReceipt(
        payload,
        payloadSha256,
        true,
        "2030-01-01T12:02:01.000Z",
      ),
      error: null,
    });
    mocks.normalizedPersist.mockResolvedValueOnce(
      commitReceipt(
        payload,
        payloadSha256,
        false,
        "2030-01-01T12:03:00.000Z",
      ),
    );

    const completed = await POST(signedRequest(payload));
    expect(completed.status).toBe(201);
    expect(await completed.json()).toMatchObject({
      status: "committed",
      replayed: false,
      committedAt: "2030-01-01T12:03:00.000Z",
    });

    mocks.normalizedPersist.mockResolvedValueOnce(
      commitReceipt(
        payload,
        payloadSha256,
        true,
        "2030-01-01T12:03:00.000Z",
      ),
    );
    const exactReplay = await POST(signedRequest(payload));
    expect(exactReplay.status).toBe(200);
    expect(await exactReplay.json()).toMatchObject({ replayed: true });
  });

  it("never signs a receipt when the normalized store returns a different identity", async () => {
    const payload = creatorTrackerIngestionSchema.parse(fullCreatorTrackerPayload());
    const payloadSha256 = createHash("sha256")
      .update(JSON.stringify(payload))
      .digest("hex");
    mocks.rpc.mockResolvedValue({
      data: commitReceipt(payload, payloadSha256),
      error: null,
    });
    mocks.normalizedPersist.mockResolvedValue({
      ...commitReceipt(payload, payloadSha256),
      idempotencyKey: "different-batch-identity",
    });

    const response = await POST(signedRequest(payload));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      ok: false,
      error: { code: "INGESTION_FAILED" },
    });
    expect(response.headers.get("x-creator-ingest-ack-signature")).toBeNull();
  });

  it("requires a pinned CA and a verify-full-compatible normalized database URL", () => {
    const config = loadCreatorTrackerIngestionRuntimeConfig({
      CREATOR_TRACKER_V2_DATABASE_URL: databaseUrl,
      CREATOR_TRACKER_V2_DATABASE_CA_B64: Buffer.from(
        databaseCa,
        "utf8",
      ).toString("base64"),
      CREATOR_INGEST_ALLOWED_ORGANIZATION_IDS: organizationId,
      CREATOR_INGEST_CURRENT_KEY_ID: keyId,
      CREATOR_INGEST_CURRENT_SECRET_B64: secret.toString("base64"),
    });
    expect(new URL(config.databaseUrl).search).toBe("");
    expect(config.databaseTls).toEqual({
      ca: databaseCa,
      servername: "database.example",
      rejectUnauthorized: true,
    });
    expect(buildCreatorTrackerPoolConfig(config.databaseUrl, config.databaseTls))
      .toMatchObject({
        connectionString: config.databaseUrl,
        ssl: config.databaseTls,
        max: 2,
      });
    expect(() =>
      loadCreatorTrackerIngestionRuntimeConfig({
        CREATOR_TRACKER_V2_DATABASE_URL:
          "postgresql://ingest:password@database.example/tracker?sslmode=no-verify",
        CREATOR_TRACKER_V2_DATABASE_CA_B64: Buffer.from(
          databaseCa,
          "utf8",
        ).toString("base64"),
        CREATOR_INGEST_ALLOWED_ORGANIZATION_IDS: organizationId,
        CREATOR_INGEST_CURRENT_KEY_ID: keyId,
        CREATOR_INGEST_CURRENT_SECRET_B64: secret.toString("base64"),
      }),
    ).toThrow();
    expect(() =>
      loadCreatorTrackerIngestionRuntimeConfig({
        CREATOR_TRACKER_V2_DATABASE_URL: databaseUrl,
        CREATOR_TRACKER_V2_DATABASE_CA_B64: Buffer.from(
          "not a certificate",
        ).toString("base64"),
        CREATOR_INGEST_ALLOWED_ORGANIZATION_IDS: organizationId,
        CREATOR_INGEST_CURRENT_KEY_ID: keyId,
        CREATOR_INGEST_CURRENT_SECRET_B64: secret.toString("base64"),
      }),
    ).toThrow();
  });

  it("rejects cross-platform account and video attribution before persistence", async () => {
    const payload = fullCreatorTrackerPayload();
    payload.videos[0].platform = "instagram";
    const response = await POST(signedRequest(payload));
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      ok: false,
      error: { code: "INVALID_INGESTION_BATCH" },
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
