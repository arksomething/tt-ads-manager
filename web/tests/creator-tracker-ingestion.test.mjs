import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { registerHooks } from "node:module";
import { extname, resolve as resolvePath } from "node:path";
import test from "node:test";
import { rootCertificates } from "node:tls";
import { pathToFileURL } from "node:url";

function localTsUrl(path) {
  const resolved = resolvePath(path);
  return pathToFileURL(extname(resolved) ? resolved : `${resolved}.ts`).href;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      return nextResolve(localTsUrl(resolvePath("src", specifier.slice(2))), context);
    }
    if (
      specifier.startsWith(".") &&
      !extname(specifier) &&
      context.parentURL?.includes("/web/src/")
    ) {
      return nextResolve(
        localTsUrl(new URL(specifier, context.parentURL).pathname),
        context,
      );
    }
    return nextResolve(specifier, context);
  },
});

const {
  loadCreatorTrackerIngestionRuntimeConfig,
  signCreatorTrackerCommitReceipt,
  signCreatorTrackerIngestionRequest,
} = await import("../src/server/creator-tracker/ingestion-auth.ts");
const {
  CREATOR_TRACKER_INGEST_PATH,
  creatorTrackerIngestionSchema,
  deriveIngestionCounts,
} = await import("../src/server/creator-tracker/ingestion-contract.ts");
const { handleCreatorTrackerIngestionRequest } = await import(
  "../src/server/creator-tracker/ingestion-handler.ts"
);
const {
  buildCreatorTrackerPoolConfig,
  CreatorTrackerIngestionStoreError,
  persistCreatorTrackerBatchWithClient,
} = await import("../src/server/creator-tracker/ingestion-store.ts");

const NOW = Date.parse("2030-01-01T12:02:00.000Z");
const TIMESTAMP = String(Math.floor(NOW / 1_000));
const SECRET = Buffer.alloc(32, 7);
const KEY_ID = "collector-current";
const ORGANIZATION_ID = "org-ingestion-test";
const RAW_HASH = "a".repeat(64);
const RAW_OBJECT_HASH = "b".repeat(64);
const PRODUCER_RUN_ID = "550e8400-e29b-41d4-a716-446655440000";

const IDS = {
  batch: "018f0000-0000-7000-8000-000000000001",
  creator: "018f0000-0000-7000-8000-000000000002",
  account: "018f0000-0000-7000-8000-000000000003",
  run: "018f0000-0000-7000-8000-000000000004",
  raw: "018f0000-0000-7000-8000-000000000005",
  rawEntry: "018f0000-0000-7000-8000-00000000000a",
  video: "018f0000-0000-7000-8000-000000000006",
  handle: "018f0000-0000-7000-8000-000000000007",
  observation: "018f0000-0000-7000-8000-000000000008",
  coverage: "018f0000-0000-7000-8000-000000000009",
};

function fullPayload() {
  return {
    schemaVersion: 2,
    batch: {
      id: IDS.batch,
      organizationId: ORGANIZATION_ID,
      idempotencyKey: "collector-outbox-row-1",
      source: "laptop-collector",
      collectorInstanceId: "collector-laptop-1",
      producedAt: "2030-01-01T12:01:00.000Z",
      metadata: { attempt: 1 },
    },
    creators: [
      {
        id: IDS.creator,
        legacyCreatorId: "legacy-creator-1",
        displayName: "Creator One",
        state: "active",
        metadata: {},
        evidenceRunId: IDS.run,
        rawManifestId: IDS.raw,
      },
    ],
    accounts: [
      {
        id: IDS.account,
        creatorId: IDS.creator,
        platform: "tiktok",
        nativeAccountId: "native-account-1",
        profileUrl: "https://www.tiktok.com/@creator.one",
        trackingState: "active",
        discoveryTier: "hot",
        firstSeenAt: "2030-01-01T12:00:00.000Z",
        lastDiscoveryAt: "2030-01-01T12:00:30.000Z",
        lastSuccessAt: "2030-01-01T12:00:30.000Z",
        lastCompleteDiscoveryRunId: IDS.run,
        nextDiscoveryAt: "2030-01-01T12:12:30.000Z",
        consecutiveFailures: 0,
        lastErrorCode: null,
        metadata: {},
        evidenceRunId: IDS.run,
        rawManifestId: IDS.raw,
      },
    ],
    runs: [
      {
        id: IDS.run,
        workerId: "worker-1",
        adapter: "tiktok_ytdlp",
        adapterVersion: "1.0.0",
        requestId: "request-1",
        scheduledFor: "2030-01-01T12:00:00.000Z",
        requestStartedAt: "2030-01-01T12:00:00.000Z",
        responseReceivedAt: "2030-01-01T12:00:50.000Z",
        completedAt: "2030-01-01T12:01:00.000Z",
        status: "complete",
        completenessReason: null,
        cursorIn: null,
        cursorOut: null,
        pagesExpected: 1,
        pagesFetched: 1,
        itemsExpected: 1,
        itemsSeen: 1,
        itemsWritten: 1,
        httpStatus: 200,
        errorCode: null,
        errorDetail: null,
        rawManifestSha256: RAW_HASH,
      },
    ],
    rawManifests: [
      {
        id: IDS.raw,
        runId: IDS.run,
        producerRunId: PRODUCER_RUN_ID,
        source: "tiktok_ytdlp",
        endpoint: "https://www.tiktok.com/@creator.one",
        storageKey: `creator-tracker/raw/v1/sha256/aa/${RAW_HASH}`,
        sha256: RAW_HASH,
        byteLength: 1234,
        contentType: "application/json",
        sourceObservedAt: "2030-01-01T12:00:50.000Z",
        fetchedAt: "2030-01-01T12:00:50.000Z",
        retentionClass: "operational",
        retainUntil: "2030-04-01T12:00:50.000Z",
        storeVersion: 1,
        purpose: "video_observation",
        responseCount: 1,
        totalResponseBytes: 1200,
        sealed: true,
      },
    ],
    rawManifestEntries: [
      {
        id: IDS.rawEntry,
        rawManifestId: IDS.raw,
        runId: IDS.run,
        ordinal: 0,
        adapter: "tiktok_ytdlp",
        requestKind: "post_detail",
        sourceObservedAtMs: Date.parse("2030-01-01T12:00:50.000Z"),
        mediaType: "application/json",
        storageKey: `creator-tracker/raw/v1/sha256/bb/${RAW_OBJECT_HASH}`,
        sha256: RAW_OBJECT_HASH,
        byteLength: 1200,
      },
    ],
    videos: [
      {
        id: IDS.video,
        creatorId: IDS.creator,
        accountId: IDS.account,
        platform: "tiktok",
        nativeVideoId: "native-video-1",
        canonicalUrl: "https://www.tiktok.com/@creator.one/video/1",
        publishedAt: "2030-01-01T11:59:00.000Z",
        publishedAtSource: "platform",
        publishedAtConfidence: "verified",
        firstSeenAt: "2030-01-01T12:00:00.000Z",
        lastSeenAt: "2030-01-01T12:00:30.000Z",
        firstSeenRunId: IDS.run,
        captionFirst: "First caption",
        captionCurrent: "First caption",
        hashtagsFirst: ["creator"],
        durationMs: 15000,
        availability: "available",
        trackingState: "active",
        observationTier: "hot",
        nextObservationAt: "2030-01-02T00:00:30.000Z",
        metadata: {},
        evidenceRunId: IDS.run,
        rawManifestId: IDS.raw,
      },
    ],
    handleEvents: [
      {
        id: IDS.handle,
        accountId: IDS.account,
        handle: "creator.one",
        validFrom: "2030-01-01T12:00:00.000Z",
        sourceRunId: IDS.run,
        rawManifestId: IDS.raw,
        isVerified: true,
      },
    ],
    observations: [
      {
        id: IDS.observation,
        videoId: IDS.video,
        runId: IDS.run,
        adapter: "tiktok_ytdlp",
        metricSchemaVersion: 1,
        scheduledFor: "2030-01-01T12:00:00.000Z",
        requestStartedAt: "2030-01-01T12:00:00.000Z",
        observedAt: "2030-01-01T12:00:30.000Z",
        sourceObservedAt: "2030-01-01T12:00:30.000Z",
        sourceTimezone: "UTC",
        views: 100,
        likes: 10,
        comments: 2,
        shares: 1,
        saves: 0,
        availability: "available",
        httpStatus: 200,
        isComplete: true,
        confidence: "direct",
        counterRegression: false,
        rawManifestId: IDS.raw,
        idempotencyKey: "observation-request-1-video-1",
      },
    ],
    failures: [],
    coverageWindows: [
      {
        id: IDS.coverage,
        platform: "tiktok",
        accountId: IDS.account,
        source: "tiktok_ytdlp",
        windowStart: "2030-01-01T11:00:00.000Z",
        windowEnd: "2030-01-01T12:00:30.000Z",
        runId: IDS.run,
        status: "complete",
        expectedCount: 1,
        discoveredCount: 1,
        observedCount: 1,
        pagesExpected: 1,
        pagesFetched: 1,
        missingNativeIds: [],
        warningCodes: [],
        computedAt: "2030-01-01T12:01:00.000Z",
        evidenceSha256: RAW_HASH,
        idempotencyKey: "coverage-request-1-account-1",
      },
    ],
  };
}

const config = {
  databaseUrl: "postgresql://ingest:password@database.invalid/tracker",
  databaseTls: {
    ca: rootCertificates[0],
    servername: "database.invalid",
    rejectUnauthorized: true,
  },
  allowedOrganizationIds: new Set([ORGANIZATION_ID]),
  keys: new Map([[KEY_ID, { id: KEY_ID, secret: SECRET }]]),
};

function signedRequest(payload, overrides = {}) {
  const body = overrides.body ?? JSON.stringify(payload);
  const contentHash = createHash("sha256").update(body).digest("hex");
  const timestamp = overrides.timestamp ?? TIMESTAMP;
  const keyId = overrides.keyId ?? KEY_ID;
  const signature =
    overrides.signature ??
    signCreatorTrackerIngestionRequest(
      overrides.secret ?? SECRET,
      keyId,
      timestamp,
      overrides.claimedHash ?? contentHash,
    );
  return new Request(
    `https://tracker.example${CREATOR_TRACKER_INGEST_PATH}${overrides.search ?? ""}`,
    {
      method: "POST",
      headers: {
        "content-type": overrides.contentType ?? "application/json",
        "x-creator-ingest-key-id": keyId,
        "x-creator-ingest-timestamp": timestamp,
        "x-creator-ingest-content-sha256": overrides.claimedHash ?? contentHash,
        "x-creator-ingest-signature": signature,
        ...(overrides.headers ?? {}),
      },
      body,
    },
  );
}

function receiptFor(payload, hash, replayed = false) {
  const counts = deriveIngestionCounts(creatorTrackerIngestionSchema.parse(payload));
  return {
    batchId: payload.batch.id,
    organizationId: payload.batch.organizationId,
    idempotencyKey: payload.batch.idempotencyKey,
    payloadSha256: hash,
    committedAt: "2030-01-01T12:02:01.000Z",
    ...counts,
    replayed,
  };
}

test("accepts a signed strict batch and returns a verifiable post-commit receipt", async () => {
  const payload = fullPayload();
  let persisted;
  const store = {
    async persist(parsed, hash) {
      persisted = { parsed, hash };
      return receiptFor(payload, hash);
    },
  };
  const response = await handleCreatorTrackerIngestionRequest(
    signedRequest(payload),
    { config, store, now: () => NOW },
  );

  assert.equal(response.status, 201);
  const responseText = await response.text();
  const responseBody = JSON.parse(responseText);
  assert.equal(responseBody.status, "committed");
  assert.equal(responseBody.batchId, payload.batch.id);
  assert.equal(responseBody.idempotencyKey, payload.batch.idempotencyKey);
  assert.equal(responseBody.payloadSha256, persisted.hash);
  assert.equal(responseBody.committedAt, "2030-01-01T12:02:01.000Z");
  assert.deepEqual(responseBody.rawEvidence, {
    manifest: "committed",
    bytes: "externally_pre_stored_unverified",
  });
  assert.equal(
    response.headers.get("x-creator-ingest-ack-signature"),
    signCreatorTrackerCommitReceipt(SECRET, responseText),
  );
  assert.equal(response.headers.get("cache-control"), "no-store, max-age=0");
  assert.equal(persisted.parsed.observations[0].rawManifestId, IDS.raw);
});

test("an exact replay returns the same committed identity with a newly signed replay receipt", async () => {
  const payload = fullPayload();
  const body = JSON.stringify(payload);
  const hash = createHash("sha256").update(body).digest("hex");
  const response = await handleCreatorTrackerIngestionRequest(
    signedRequest(payload, { body }),
    {
      config,
      store: { persist: async () => receiptFor(payload, hash, true) },
      now: () => NOW,
    },
  );
  assert.equal(response.status, 200);
  const responseText = await response.text();
  const receipt = JSON.parse(responseText);
  assert.equal(receipt.replayed, true);
  assert.equal(receipt.payloadSha256, hash);
  assert.equal(
    response.headers.get("x-creator-ingest-ack-signature"),
    signCreatorTrackerCommitReceipt(SECRET, responseText),
  );
});

test("body tampering, stale signatures, and unknown keys fail before persistence", async (t) => {
  const payload = fullPayload();
  let calls = 0;
  const store = { persist: async () => { calls += 1; } };

  const cases = [
    ["tampered body", signedRequest(payload, { claimedHash: "b".repeat(64) })],
    ["stale timestamp", signedRequest(payload, { timestamp: String(Number(TIMESTAMP) - 301) })],
    ["unknown key", signedRequest(payload, { keyId: "unknown-key" })],
    ["bad signature", signedRequest(payload, { signature: `v1=${"0".repeat(64)}` })],
  ];
  for (const [name, request] of cases) {
    await t.test(name, async () => {
      const response = await handleCreatorTrackerIngestionRequest(request, {
        config,
        store,
        now: () => NOW,
      });
      assert.equal(response.status, 401);
      assert.equal((await response.json()).error.code, "AUTHENTICATION_FAILED");
      assert.equal(response.headers.get("x-creator-ingest-ack-signature"), null);
    });
  }
  assert.equal(calls, 0);
});

test("signed organization mismatch is rejected before the database", async () => {
  const payload = fullPayload();
  payload.batch.organizationId = "org-not-allowed";
  let calls = 0;
  const response = await handleCreatorTrackerIngestionRequest(
    signedRequest(payload),
    {
      config,
      store: { persist: async () => { calls += 1; } },
      now: () => NOW,
    },
  );
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error.code, "ORGANIZATION_NOT_ALLOWED");
  assert.equal(calls, 0);
});

test("strict contract rejects unknown fields and broken raw-manifest lineage", async (t) => {
  const mutations = [
    ["unknown field", (payload) => { payload.unexpected = true; }],
    ["missing manifest link", (payload) => { payload.creators[0].rawManifestId = IDS.coverage; }],
    ["run hash mismatch", (payload) => { payload.runs[0].rawManifestSha256 = "b".repeat(64); }],
    ["observation outside run", (payload) => { payload.observations[0].observedAt = "2030-01-01T12:01:01.000Z"; }],
    ["source observation after observation", (payload) => { payload.observations[0].sourceObservedAt = "2030-01-01T12:00:31.000Z"; }],
    ["raw fetch after run", (payload) => { payload.rawManifests[0].fetchedAt = "2030-01-01T12:01:01.000Z"; }],
    ["missing producer run binding", (payload) => { delete payload.rawManifests[0].producerRunId; }],
    ["non-canonical producer run binding", (payload) => { payload.rawManifests[0].producerRunId = IDS.run; }],
    ["run response after completion", (payload) => { payload.runs[0].responseReceivedAt = "2030-01-01T12:01:01.000Z"; }],
    ["run scheduled after start", (payload) => { payload.runs[0].scheduledFor = "2030-01-01T12:00:01.000Z"; }],
    ["run completed after batch", (payload) => { payload.batch.producedAt = "2030-01-01T12:00:59.000Z"; }],
    ["coverage computed after batch", (payload) => { payload.coverageWindows[0].computedAt = "2030-01-01T12:01:01.000Z"; }],
    ["observation scheduled after request", (payload) => { payload.observations[0].scheduledFor = "2030-01-01T12:00:01.000Z"; }],
    ["published after last seen", (payload) => { payload.videos[0].publishedAt = "2030-01-01T12:00:31.000Z"; }],
    ["account first seen after evidence", (payload) => { payload.accounts[0].firstSeenAt = "2030-01-01T12:01:01.000Z"; }],
    ["missing child response", (payload) => { payload.rawManifestEntries = []; }],
    ["child count mismatch", (payload) => { payload.rawManifests[0].responseCount = 2; }],
    ["child byte total mismatch", (payload) => { payload.rawManifests[0].totalResponseBytes += 1; }],
    ["child digest mismatch", (payload) => { payload.rawManifestEntries[0].storageKey = `creator-tracker/raw/v1/sha256/cc/${"c".repeat(64)}`; }],
    ["child source after run", (payload) => { payload.rawManifestEntries[0].sourceObservedAtMs = Date.parse("2030-01-01T12:01:01.000Z"); }],
    ["child request kind mismatch", (payload) => { payload.rawManifestEntries[0].requestKind = "profile_page"; }],
    ["adapter request vocabulary mismatch", (payload) => { payload.rawManifestEntries[0].requestKind = "video_query"; }],
    ["provider purpose mismatch", (payload) => {
      payload.runs[0].adapter = "viral_app_provider";
      payload.rawManifests[0].source = "viral_app_provider";
      payload.rawManifests[0].purpose = "video_observation";
      payload.rawManifestEntries[0].adapter = "viral_app_provider";
      payload.rawManifestEntries[0].requestKind = "provider_videos_page";
    }],
    ["aggregate content type", (payload) => { payload.rawManifests[0].contentType = "text/html"; }],
    ["child content type", (payload) => { payload.rawManifestEntries[0].mediaType = "text/html"; }],
    ["non-HTTPS profile", (payload) => { payload.accounts[0].profileUrl = "http://www.tiktok.com/@creator.one"; }],
    ["wrong profile host", (payload) => { payload.accounts[0].profileUrl = "https://attacker.example/@creator.one"; }],
    ["wrong video host", (payload) => { payload.videos[0].canonicalUrl = "https://attacker.example/@creator.one/video/1"; }],
    ["ambiguous storage traversal", (payload) => { payload.rawManifests[0].storageKey = "creator-tracker/raw/../secret"; }],
    ["storage digest mismatch", (payload) => { payload.rawManifests[0].storageKey = `creator-tracker/raw/v1/sha256/bb/${"b".repeat(64)}`; }],
    ["storage shard mismatch", (payload) => { payload.rawManifests[0].storageKey = `creator-tracker/raw/v1/sha256/ff/${RAW_HASH}`; }],
  ];
  for (const [name, mutate] of mutations) {
    await t.test(name, async () => {
      const payload = fullPayload();
      mutate(payload);
      const response = await handleCreatorTrackerIngestionRequest(
        signedRequest(payload),
        { config, store: { persist: async () => assert.fail("must not persist") }, now: () => NOW },
      );
      assert.equal(response.status, 422);
      assert.equal((await response.json()).error.code, "INVALID_INGESTION_BATCH");
    });
  }
});

test("request target and media constraints are fail-closed", async (t) => {
  const payload = fullPayload();
  const cases = [
    ["query string", signedRequest(payload, { search: "?retry=1" }), 400, "INVALID_REQUEST_TARGET"],
    ["media type", signedRequest(payload, { contentType: "text/plain" }), 415, "UNSUPPORTED_MEDIA_TYPE"],
    ["encoding", signedRequest(payload, { headers: { "content-encoding": "gzip" } }), 415, "UNSUPPORTED_CONTENT_ENCODING"],
    ["declared oversize", signedRequest(payload, { headers: { "content-length": String(2 * 1024 * 1024 + 1) } }), 413, "PAYLOAD_TOO_LARGE"],
  ];
  for (const [name, request, status, code] of cases) {
    await t.test(name, async () => {
      const response = await handleCreatorTrackerIngestionRequest(request, {
        config,
        store: { persist: async () => assert.fail("must not persist") },
        now: () => NOW,
      });
      assert.equal(response.status, status);
      assert.equal((await response.json()).error.code, code);
    });
  }
});

test("database conflict and rollback paths never emit a commit receipt", async () => {
  const payload = fullPayload();
  const response = await handleCreatorTrackerIngestionRequest(
    signedRequest(payload),
    {
      config,
      store: {
        persist: async () => {
          throw new CreatorTrackerIngestionStoreError(
            "conflict",
            "IDEMPOTENCY_KEY_REUSED",
          );
        },
      },
      now: () => NOW,
    },
  );
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error.code, "IDEMPOTENCY_KEY_REUSED");
  assert.equal(response.headers.get("x-creator-ingest-ack-signature"), null);
});

test("runtime configuration requires a dedicated URL, tenant allowlist, and canonical key", () => {
  const environment = {
    CREATOR_TRACKER_V2_DATABASE_URL:
      "postgresql://ingest:password@database.example/tracker?sslmode=require",
    CREATOR_TRACKER_V2_DATABASE_CA_B64: Buffer.from(
      rootCertificates[0],
      "utf8",
    ).toString("base64"),
    CREATOR_INGEST_ALLOWED_ORGANIZATION_IDS: ORGANIZATION_ID,
    CREATOR_INGEST_CURRENT_KEY_ID: KEY_ID,
    CREATOR_INGEST_CURRENT_SECRET_B64: SECRET.toString("base64"),
  };
  const parsed = loadCreatorTrackerIngestionRuntimeConfig(environment);
  assert.equal(parsed.allowedOrganizationIds.has(ORGANIZATION_ID), true);
  assert.deepEqual(parsed.keys.get(KEY_ID).secret, SECRET);
  assert.equal(parsed.databaseTls.rejectUnauthorized, true);
  assert.equal(parsed.databaseTls.servername, "database.example");
  assert.equal(new URL(parsed.databaseUrl).search, "");
  const poolConfig = buildCreatorTrackerPoolConfig(
    parsed.databaseUrl,
    parsed.databaseTls,
  );
  assert.equal(poolConfig.connectionString, parsed.databaseUrl);
  assert.deepEqual(poolConfig.ssl, {
    ca: rootCertificates[0],
    rejectUnauthorized: true,
    servername: "database.example",
  });
  assert.throws(() =>
    loadCreatorTrackerIngestionRuntimeConfig({
      ...environment,
      CREATOR_INGEST_CURRENT_SECRET_B64: "not-base64",
    }),
  );
  assert.throws(() =>
    loadCreatorTrackerIngestionRuntimeConfig({
      ...environment,
      CREATOR_INGEST_ALLOWED_ORGANIZATION_IDS: "",
    }),
  );
  assert.throws(() =>
    loadCreatorTrackerIngestionRuntimeConfig({
      ...environment,
      CREATOR_TRACKER_V2_DATABASE_URL:
        "postgresql://ingest:password@database.example/tracker?sslmode=no-verify",
    }),
  );
  assert.throws(() =>
    loadCreatorTrackerIngestionRuntimeConfig({
      ...environment,
      CREATOR_TRACKER_V2_DATABASE_URL:
        "postgresql://ingest:password@database.example/tracker?sslmode=require&sslrootcert=system",
    }),
  );
  assert.throws(() =>
    loadCreatorTrackerIngestionRuntimeConfig({
      ...environment,
      CREATOR_TRACKER_V2_DATABASE_CA_B64: Buffer.from(
        "not a certificate",
      ).toString("base64"),
    }),
  );
});

function minimalParsedPayload() {
  const payload = fullPayload();
  payload.creators = [];
  payload.accounts = [];
  payload.videos = [];
  payload.handleEvents = [];
  payload.observations = [];
  payload.failures = [];
  payload.coverageWindows = [];
  return creatorTrackerIngestionSchema.parse(payload);
}

class RecordingClient {
  constructor(options = {}) {
    this.options = options;
    this.statements = [];
  }

  async query(text, values) {
    this.statements.push({ text, values });
    if (/FROM creator_tracker_v2\.ingestion_batches/.test(text)) {
      return { rowCount: this.options.existing ? 1 : 0, rows: this.options.existing ? [this.options.existing] : [] };
    }
    if (/INSERT INTO creator_tracker_v2\.ingestion_batches/.test(text)) {
      return { rowCount: 1, rows: [{ accepted_at: "2030-01-01T12:02:01.000Z" }] };
    }
    if (/claimed_regression/.test(text)) {
      const rows = this.options.regressionRows ?? [];
      return { rowCount: rows.length, rows };
    }
    if (/FROM creator_tracker_v2\.account_handle_history/.test(text)) {
      const rows = this.options.currentHandle ? [this.options.currentHandle] : [];
      return { rowCount: rows.length, rows };
    }
    if (this.options.failRaw && /INSERT INTO creator_tracker_v2\.raw_object_manifests/.test(text)) {
      const error = new Error("raw insert failed");
      error.code = "23503";
      throw error;
    }
    if (/INSERT INTO creator_tracker_v2\.(tracking_runs|raw_object_manifests|raw_object_manifest_sets|raw_object_manifest_entries)/.test(text)) {
      return { rowCount: 1, rows: [{ id: "unused" }] };
    }
    if (
      /(?:INSERT INTO creator_tracker_v2\.(?:creators|creator_platform_accounts|videos|account_handle_history|video_observations|source_coverage_windows)|UPDATE creator_tracker_v2\.creator_platform_accounts)/.test(text)
    ) {
      return { rowCount: 1, rows: [{ id: "unused" }] };
    }
    return { rowCount: null, rows: [] };
  }
}

test("store commits inbox, runs, and manifests atomically before resolving", async () => {
  const payload = minimalParsedPayload();
  const client = new RecordingClient();
  const receipt = await persistCreatorTrackerBatchWithClient(
    client,
    payload,
    "c".repeat(64),
  );
  const sql = client.statements.map((entry) => entry.text.trim());
  assert.match(sql[0], /^BEGIN ISOLATION LEVEL SERIALIZABLE$/);
  assert.ok(sql.some((entry) => entry === "SET LOCAL ROLE creator_tracker_v2_ingest"));
  assert.doesNotMatch(
    sql.find((entry) => entry.includes("FROM creator_tracker_v2.ingestion_batches")),
    /FOR\s+(?:UPDATE|SHARE)/,
    "append-only inbox lookup must not require the intentionally absent UPDATE grant",
  );
  assert.ok(
    sql.findIndex((entry) => entry.includes("INSERT INTO creator_tracker_v2.ingestion_batches")) <
      sql.findIndex((entry) => entry.includes("INSERT INTO creator_tracker_v2.tracking_runs")),
  );
  assert.ok(
    sql.findIndex((entry) => entry.includes("INSERT INTO creator_tracker_v2.tracking_runs")) <
      sql.findIndex((entry) => entry.includes("INSERT INTO creator_tracker_v2.raw_object_manifests")),
  );
  assert.ok(
    sql.findIndex((entry) => entry.includes("INSERT INTO creator_tracker_v2.raw_object_manifests")) <
      sql.findIndex((entry) => entry.includes("INSERT INTO creator_tracker_v2.raw_object_manifest_sets")),
  );
  assert.ok(
    sql.findIndex((entry) => entry.includes("INSERT INTO creator_tracker_v2.raw_object_manifest_sets")) <
      sql.findIndex((entry) => entry.includes("INSERT INTO creator_tracker_v2.raw_object_manifest_entries")),
  );
  assert.equal(sql.at(-1), "COMMIT");
  assert.equal(receipt.committedAt, "2030-01-01T12:02:01.000Z");
  assert.equal(receipt.replayed, false);
  assert.equal(receipt.itemCount, 3);
});

test("store exact replay commits read-only while payload mismatch rolls back", async () => {
  const payload = minimalParsedPayload();
  const counts = deriveIngestionCounts(payload);
  const hash = "d".repeat(64);
  const existing = {
    id: payload.batch.id,
    organization_id: ORGANIZATION_ID,
    idempotency_key: payload.batch.idempotencyKey,
    source: payload.batch.source,
    collector_instance_id: payload.batch.collectorInstanceId,
    schema_version: 2,
    payload_sha256: hash,
    status: "accepted",
    accepted_at: "2030-01-01T12:02:01.000Z",
    item_count: counts.itemCount,
    observation_count: counts.observationCount,
    failure_count: counts.failureCount,
  };
  const replayClient = new RecordingClient({ existing });
  const receipt = await persistCreatorTrackerBatchWithClient(replayClient, payload, hash);
  assert.equal(receipt.replayed, true);
  assert.equal(
    replayClient.statements.some((entry) => /INSERT INTO/.test(entry.text)),
    false,
  );
  assert.equal(replayClient.statements.at(-1).text, "COMMIT");

  const mismatchClient = new RecordingClient({
    existing: { ...existing, payload_sha256: "e".repeat(64) },
  });
  await assert.rejects(
    persistCreatorTrackerBatchWithClient(mismatchClient, payload, hash),
    (error) => error.code === "IDEMPOTENCY_KEY_REUSED",
  );
  assert.equal(mismatchClient.statements.at(-1).text, "ROLLBACK");
  assert.equal(
    mismatchClient.statements.some((entry) => entry.text === "COMMIT"),
    false,
  );
});

test("store evidence failure rolls back the batch and cannot produce a receipt", async () => {
  const client = new RecordingClient({ failRaw: true });
  await assert.rejects(
    persistCreatorTrackerBatchWithClient(
      client,
      minimalParsedPayload(),
      "f".repeat(64),
    ),
  );
  assert.equal(client.statements.at(-1).text, "ROLLBACK");
  assert.equal(client.statements.some((entry) => entry.text === "COMMIT"), false);
});

test("store rejects a collector-suppressed counter regression and rolls back every write", async () => {
  const payload = creatorTrackerIngestionSchema.parse(fullPayload());
  assert.equal(payload.observations[0].counterRegression, false);
  const client = new RecordingClient({
    regressionRows: [
      {
        id: IDS.observation,
        claimed_regression: false,
        computed_regression: true,
      },
    ],
  });
  await assert.rejects(
    persistCreatorTrackerBatchWithClient(client, payload, "1".repeat(64)),
    (error) =>
      error.kind === "invalid_evidence" &&
      error.code === "COUNTER_REGRESSION_MISMATCH",
  );
  assert.equal(client.statements.at(-1).text, "ROLLBACK");
  assert.equal(client.statements.some((entry) => entry.text === "COMMIT"), false);
  const regressionSql = client.statements.find((entry) =>
    /claimed_regression/.test(entry.text),
  ).text;
  assert.match(regressionSql, /LEFT JOIN LATERAL/);
  assert.match(regressionSql, /candidate\.is_complete/);
  assert.doesNotMatch(
    regressionSql,
    /current_observation\.is_complete/,
    "an incomplete claim must not suppress a regression in counters that were supplied",
  );
  assert.match(regressionSql, /candidate\.observed_at DESC, candidate\.id DESC/);
  for (const counter of ["views", "likes", "comments", "shares", "saves"]) {
    assert.match(regressionSql, new RegExp(`current_observation\\.${counter} < previous\\.${counter}`));
  }
});

test("store closes one current handle interval before appending the replacement", async () => {
  const payload = creatorTrackerIngestionSchema.parse(fullPayload());
  const client = new RecordingClient({
    currentHandle: {
      id: "018f0000-0000-7000-8000-000000000099",
      valid_from: "2030-01-01T11:00:00.000Z",
      same_handle: false,
    },
    regressionRows: [
      {
        id: IDS.observation,
        claimed_regression: false,
        computed_regression: false,
      },
    ],
  });
  const receipt = await persistCreatorTrackerBatchWithClient(
    client,
    payload,
    "2".repeat(64),
  );
  assert.equal(receipt.replayed, false);
  const closeIndex = client.statements.findIndex((entry) =>
    /UPDATE creator_tracker_v2\.account_handle_history/.test(entry.text),
  );
  const appendIndex = client.statements.findIndex((entry) =>
    /INSERT INTO creator_tracker_v2\.account_handle_history/.test(entry.text),
  );
  assert.ok(closeIndex >= 0 && closeIndex < appendIndex);
  assert.equal(client.statements.at(-1).text, "COMMIT");
});

test("store rejects a redundant current-handle event instead of rewriting history", async () => {
  const client = new RecordingClient({
    currentHandle: {
      id: "018f0000-0000-7000-8000-000000000099",
      valid_from: "2030-01-01T11:00:00.000Z",
      same_handle: true,
    },
  });
  await assert.rejects(
    persistCreatorTrackerBatchWithClient(
      client,
      creatorTrackerIngestionSchema.parse(fullPayload()),
      "3".repeat(64),
    ),
    (error) => error.code === "HANDLE_HISTORY_CONFLICT",
  );
  assert.equal(client.statements.at(-1).text, "ROLLBACK");
  assert.equal(
    client.statements.some((entry) =>
      /UPDATE creator_tracker_v2\.account_handle_history/.test(entry.text),
    ),
    false,
  );
});
