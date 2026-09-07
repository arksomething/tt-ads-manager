import { createHash } from "node:crypto";

import { Pool, type PoolClient, type PoolConfig } from "pg";

import {
  type CreatorTrackerIngestionBatch,
  deriveIngestionCounts,
  withIngestionLineage,
} from "./ingestion-contract";

export interface CreatorTrackerCommitReceipt {
  batchId: string;
  organizationId: string;
  idempotencyKey: string;
  payloadSha256: string;
  committedAt: string;
  itemCount: number;
  observationCount: number;
  failureCount: number;
  replayed: boolean;
}

export type CreatorTrackerIngestionStoreErrorKind =
  | "conflict"
  | "invalid_evidence"
  | "unavailable"
  | "internal";

export class CreatorTrackerIngestionStoreError extends Error {
  readonly kind: CreatorTrackerIngestionStoreErrorKind;
  readonly code: string;

  constructor(
    kind: CreatorTrackerIngestionStoreErrorKind,
    code: string,
    options?: ErrorOptions,
  ) {
    super(code, options);
    this.name = "CreatorTrackerIngestionStoreError";
    this.kind = kind;
    this.code = code;
  }
}

export interface CreatorTrackerIngestionStore {
  persist(
    payload: CreatorTrackerIngestionBatch,
    payloadSha256: string,
  ): Promise<CreatorTrackerCommitReceipt>;
}

interface PgError extends Error {
  code?: string;
  constraint?: string;
}

const pools = new Map<string, Pool>();

export interface CreatorTrackerDatabaseTlsConfig {
  ca: string;
  servername: string;
  rejectUnauthorized: true;
}

export function buildCreatorTrackerPoolConfig(
  databaseUrl: string,
  databaseTls: CreatorTrackerDatabaseTlsConfig,
): PoolConfig {
  return {
    connectionString: databaseUrl,
    application_name: "creator-tracker-v2-ingestion",
    ssl: {
      ca: databaseTls.ca,
      rejectUnauthorized: true,
      servername: databaseTls.servername,
    },
    max: 2,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 5_000,
    allowExitOnIdle: true,
  };
}

function getPool(
  databaseUrl: string,
  databaseTls: CreatorTrackerDatabaseTlsConfig,
) {
  const poolKey = `${databaseUrl}:${createHash("sha256")
    .update(databaseTls.ca, "utf8")
    .digest("hex")}`;
  let pool = pools.get(poolKey);
  if (!pool) {
    pool = new Pool(buildCreatorTrackerPoolConfig(databaseUrl, databaseTls));
    pool.on("error", () => {
      // A checked-out request reports its own failure. Idle-pool errors must not
      // include connection strings or payload data in application logs.
    });
    pools.set(poolKey, pool);
  }
  return pool;
}

function timestampString(value: unknown) {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" && Number.isFinite(Date.parse(value))) {
    return new Date(value).toISOString();
  }
  throw new CreatorTrackerIngestionStoreError("internal", "INVALID_COMMIT_TIMESTAMP");
}

function pgErrorCode(error: unknown) {
  return error && typeof error === "object" && "code" in error
    ? String((error as PgError).code ?? "")
    : "";
}

function isRetryableTransactionError(error: unknown) {
  const code = pgErrorCode(error);
  return (
    code === "40001" ||
    code === "40P01" ||
    code === "55P03" ||
    code.startsWith("08") ||
    ["ECONNREFUSED", "ECONNRESET", "EPIPE", "ETIMEDOUT"].includes(code) ||
    code === "57P01" ||
    code === "57P02" ||
    code === "57P03"
  );
}

function normalizeStoreError(error: unknown): CreatorTrackerIngestionStoreError {
  if (error instanceof CreatorTrackerIngestionStoreError) return error;
  const code = pgErrorCode(error);
  if (code === "23505" || code === "23P01" || code === "55000") {
    return new CreatorTrackerIngestionStoreError("conflict", "EVIDENCE_CONFLICT", {
      cause: error,
    });
  }
  if (
    code === "23502" ||
    code === "23503" ||
    code === "23514" ||
    code === "22P02" ||
    code === "22003" ||
    code === "22007"
  ) {
    return new CreatorTrackerIngestionStoreError(
      "invalid_evidence",
      "DATABASE_CONTRACT_REJECTED",
      { cause: error },
    );
  }
  if (
    code === "42501" ||
    code === "3F000" ||
    code === "42P01" ||
    code === "40001" ||
    code === "40P01" ||
    code === "55P03" ||
    code.startsWith("08") ||
    code.startsWith("57") ||
    code.startsWith("ERR_TLS") ||
    [
      "ECONNREFUSED",
      "ECONNRESET",
      "EHOSTUNREACH",
      "ENETUNREACH",
      "ENOTFOUND",
      "EPIPE",
      "ETIMEDOUT",
      "SELF_SIGNED_CERT_IN_CHAIN",
      "UNABLE_TO_GET_ISSUER_CERT",
      "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
      "CERT_HAS_EXPIRED",
      "ERR_TLS_CERT_ALTNAME_INVALID",
    ].includes(code)
  ) {
    return new CreatorTrackerIngestionStoreError("unavailable", "INGESTION_UNAVAILABLE", {
      cause: error,
    });
  }
  return new CreatorTrackerIngestionStoreError("internal", "INGESTION_FAILED", {
    cause: error instanceof Error ? error : undefined,
  });
}

function requireAllRows(
  actual: number | null,
  expected: number,
  code = "PROJECTION_IDENTITY_CONFLICT",
) {
  if (actual !== expected) {
    throw new CreatorTrackerIngestionStoreError("conflict", code);
  }
}

function json(value: unknown) {
  return JSON.stringify(value);
}

export async function persistCreatorTrackerBatchWithClient(
  client: PoolClient,
  payload: CreatorTrackerIngestionBatch,
  payloadSha256: string,
): Promise<CreatorTrackerCommitReceipt> {
  const organizationId = payload.batch.organizationId;
  const counts = deriveIngestionCounts(payload);
  let transactionOpen = false;
  try {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    transactionOpen = true;
    await client.query("SET LOCAL ROLE creator_tracker_v2_ingest");
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SET LOCAL statement_timeout = '20s'");
    await client.query("SET LOCAL idle_in_transaction_session_timeout = '25s'");
    await client.query(
      "SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended($1, 0))",
      [`creator-tracker-v2-ingest:${organizationId}`],
    );

    const existingBatch = await client.query<{
      id: string;
      organization_id: string;
      idempotency_key: string;
      source: string;
      collector_instance_id: string;
      schema_version: number;
      payload_sha256: string;
      status: string;
      accepted_at: Date | string;
      item_count: number;
      observation_count: number;
      failure_count: number;
    }>(
      `SELECT id::text, organization_id, idempotency_key, source,
              collector_instance_id, schema_version, payload_sha256, status,
              accepted_at, item_count, observation_count, failure_count
        FROM creator_tracker_v2.ingestion_batches
        WHERE organization_id = $1 AND idempotency_key = $2`,
      [organizationId, payload.batch.idempotencyKey],
    );

    if (existingBatch.rowCount === 1) {
      const existing = existingBatch.rows[0];
      const exactReplay =
        existing.id === payload.batch.id &&
        existing.organization_id === organizationId &&
        existing.source === payload.batch.source &&
        existing.collector_instance_id === payload.batch.collectorInstanceId &&
        existing.schema_version === payload.schemaVersion &&
        existing.payload_sha256 === payloadSha256 &&
        existing.status === "accepted" &&
        existing.item_count === counts.itemCount &&
        existing.observation_count === counts.observationCount &&
        existing.failure_count === counts.failureCount;
      if (!exactReplay) {
        throw new CreatorTrackerIngestionStoreError(
          "conflict",
          "IDEMPOTENCY_KEY_REUSED",
        );
      }

      await client.query("COMMIT");
      transactionOpen = false;
      return {
        batchId: existing.id,
        organizationId,
        idempotencyKey: existing.idempotency_key,
        payloadSha256: existing.payload_sha256,
        committedAt: timestampString(existing.accepted_at),
        ...counts,
        replayed: true,
      };
    }

    const insertedBatch = await client.query<{ accepted_at: Date | string }>(
      `INSERT INTO creator_tracker_v2.ingestion_batches (
         id, organization_id, idempotency_key, source, collector_instance_id,
         schema_version, payload_sha256, status, received_at, accepted_at,
         item_count, observation_count, failure_count, metadata
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, 'accepted',
         transaction_timestamp(), transaction_timestamp(), $8, $9, $10, $11::jsonb
       )
       RETURNING accepted_at`,
      [
        payload.batch.id,
        organizationId,
        payload.batch.idempotencyKey,
        payload.batch.source,
        payload.batch.collectorInstanceId,
        payload.schemaVersion,
        payloadSha256,
        counts.itemCount,
        counts.observationCount,
        counts.failureCount,
        json({
          ...payload.batch.metadata,
          producedAt: payload.batch.producedAt,
          rawBytes: "externally_pre_stored_unverified",
        }),
      ],
    );

    if (payload.creators.length > 0) {
      const rows = payload.creators.map((entry) => ({
        ...entry,
        metadata: withIngestionLineage(
          entry.metadata,
          payload.batch.id,
          entry.evidenceRunId,
          entry.rawManifestId,
        ),
      }));
      const result = await client.query(
        `INSERT INTO creator_tracker_v2.creators AS current_creator (
           id, organization_id, legacy_creator_id, display_name, state, metadata
         )
         SELECT incoming.id, $1, incoming."legacyCreatorId", incoming."displayName",
                incoming.state, incoming.metadata
           FROM jsonb_to_recordset($2::jsonb) AS incoming(
             id uuid, "legacyCreatorId" text, "displayName" text, state text,
             metadata jsonb, "evidenceRunId" uuid, "rawManifestId" uuid
           )
         ON CONFLICT (id) DO UPDATE SET
           display_name = EXCLUDED.display_name,
           state = EXCLUDED.state,
           metadata = EXCLUDED.metadata,
           updated_at = transaction_timestamp()
         WHERE current_creator.organization_id = EXCLUDED.organization_id
           AND current_creator.legacy_creator_id IS NOT DISTINCT FROM EXCLUDED.legacy_creator_id
         RETURNING id`,
        [organizationId, json(rows)],
      );
      requireAllRows(result.rowCount, rows.length);
    }

    if (payload.accounts.length > 0) {
      const rows = payload.accounts.map((entry) => ({
        ...entry,
        metadata: withIngestionLineage(
          entry.metadata,
          payload.batch.id,
          entry.evidenceRunId,
          entry.rawManifestId,
        ),
      }));
      const result = await client.query(
        `INSERT INTO creator_tracker_v2.creator_platform_accounts AS current_account (
           id, organization_id, creator_id, platform, native_account_id,
           profile_url, tracking_state, discovery_tier, first_seen_at,
           last_discovery_at, last_success_at, next_discovery_at,
           consecutive_failures, last_error_code, metadata
         )
         SELECT incoming.id, $1, incoming."creatorId", incoming.platform,
                incoming."nativeAccountId", incoming."profileUrl",
                incoming."trackingState", incoming."discoveryTier",
                incoming."firstSeenAt", incoming."lastDiscoveryAt",
                incoming."lastSuccessAt", incoming."nextDiscoveryAt",
                incoming."consecutiveFailures", incoming."lastErrorCode", incoming.metadata
           FROM jsonb_to_recordset($2::jsonb) AS incoming(
             id uuid, "creatorId" uuid, platform creator_tracker_v2.platform,
             "nativeAccountId" text, "profileUrl" text,
             "trackingState" creator_tracker_v2.account_tracking_state,
             "discoveryTier" creator_tracker_v2.discovery_tier,
             "firstSeenAt" timestamptz, "lastDiscoveryAt" timestamptz,
             "lastSuccessAt" timestamptz, "nextDiscoveryAt" timestamptz,
             "consecutiveFailures" integer, "lastErrorCode" text,
             metadata jsonb, "evidenceRunId" uuid, "rawManifestId" uuid,
             "lastCompleteDiscoveryRunId" uuid
           )
         ON CONFLICT (id) DO UPDATE SET
           native_account_id = COALESCE(current_account.native_account_id, EXCLUDED.native_account_id),
           profile_url = CASE
             WHEN COALESCE(EXCLUDED.last_discovery_at, EXCLUDED.first_seen_at)
                  >= COALESCE(current_account.last_discovery_at, current_account.first_seen_at)
             THEN EXCLUDED.profile_url ELSE current_account.profile_url END,
           tracking_state = CASE
             WHEN COALESCE(EXCLUDED.last_discovery_at, EXCLUDED.first_seen_at)
                  >= COALESCE(current_account.last_discovery_at, current_account.first_seen_at)
             THEN EXCLUDED.tracking_state ELSE current_account.tracking_state END,
           discovery_tier = CASE
             WHEN COALESCE(EXCLUDED.last_discovery_at, EXCLUDED.first_seen_at)
                  >= COALESCE(current_account.last_discovery_at, current_account.first_seen_at)
             THEN EXCLUDED.discovery_tier ELSE current_account.discovery_tier END,
           last_discovery_at = GREATEST(current_account.last_discovery_at, EXCLUDED.last_discovery_at),
           last_success_at = GREATEST(current_account.last_success_at, EXCLUDED.last_success_at),
           next_discovery_at = CASE
             WHEN COALESCE(EXCLUDED.last_discovery_at, EXCLUDED.first_seen_at)
                  >= COALESCE(current_account.last_discovery_at, current_account.first_seen_at)
             THEN EXCLUDED.next_discovery_at ELSE current_account.next_discovery_at END,
           consecutive_failures = CASE
             WHEN COALESCE(EXCLUDED.last_discovery_at, EXCLUDED.first_seen_at)
                  >= COALESCE(current_account.last_discovery_at, current_account.first_seen_at)
             THEN EXCLUDED.consecutive_failures ELSE current_account.consecutive_failures END,
           last_error_code = CASE
             WHEN COALESCE(EXCLUDED.last_discovery_at, EXCLUDED.first_seen_at)
                  >= COALESCE(current_account.last_discovery_at, current_account.first_seen_at)
             THEN EXCLUDED.last_error_code ELSE current_account.last_error_code END,
           metadata = CASE
             WHEN COALESCE(EXCLUDED.last_discovery_at, EXCLUDED.first_seen_at)
                  >= COALESCE(current_account.last_discovery_at, current_account.first_seen_at)
             THEN EXCLUDED.metadata ELSE current_account.metadata END,
           updated_at = CASE
             WHEN COALESCE(EXCLUDED.last_discovery_at, EXCLUDED.first_seen_at)
                  >= COALESCE(current_account.last_discovery_at, current_account.first_seen_at)
                  OR (current_account.native_account_id IS NULL AND EXCLUDED.native_account_id IS NOT NULL)
             THEN transaction_timestamp() ELSE current_account.updated_at END
         WHERE current_account.organization_id = EXCLUDED.organization_id
           AND current_account.creator_id = EXCLUDED.creator_id
           AND current_account.platform = EXCLUDED.platform
           AND current_account.first_seen_at = EXCLUDED.first_seen_at
           AND (
             current_account.native_account_id IS NULL
             OR EXCLUDED.native_account_id IS NULL
             OR current_account.native_account_id = EXCLUDED.native_account_id
           )
         RETURNING id`,
        [organizationId, json(rows)],
      );
      requireAllRows(result.rowCount, rows.length);
    }

    if (payload.runs.length > 0) {
      const result = await client.query(
        `INSERT INTO creator_tracker_v2.tracking_runs (
           id, organization_id, ingestion_batch_id, worker_id, adapter,
           adapter_version, request_id, scheduled_for, request_started_at,
           response_received_at, completed_at, status, completeness_reason,
           cursor_in, cursor_out, pages_expected, pages_fetched, items_expected,
           items_seen, items_written, http_status, error_code, error_detail,
           raw_manifest_sha256
         )
         SELECT incoming.id, $1, $2, incoming."workerId", incoming.adapter,
                incoming."adapterVersion", incoming."requestId", incoming."scheduledFor",
                incoming."requestStartedAt", incoming."responseReceivedAt",
                incoming."completedAt", incoming.status, incoming."completenessReason",
                incoming."cursorIn", incoming."cursorOut", incoming."pagesExpected",
                incoming."pagesFetched", incoming."itemsExpected", incoming."itemsSeen",
                incoming."itemsWritten", incoming."httpStatus", incoming."errorCode",
                incoming."errorDetail", incoming."rawManifestSha256"
           FROM jsonb_to_recordset($3::jsonb) AS incoming(
             id uuid, "workerId" text, adapter text, "adapterVersion" text,
             "requestId" text, "scheduledFor" timestamptz,
             "requestStartedAt" timestamptz, "responseReceivedAt" timestamptz,
             "completedAt" timestamptz, status creator_tracker_v2.run_status,
             "completenessReason" text, "cursorIn" text, "cursorOut" text,
             "pagesExpected" integer, "pagesFetched" integer,
             "itemsExpected" integer, "itemsSeen" integer, "itemsWritten" integer,
             "httpStatus" integer, "errorCode" text, "errorDetail" jsonb,
             "rawManifestSha256" text
           )
         RETURNING id`,
        [organizationId, payload.batch.id, json(payload.runs)],
      );
      requireAllRows(result.rowCount, payload.runs.length, "RUN_IDENTITY_CONFLICT");
    }

    if (payload.rawManifests.length > 0) {
      const result = await client.query(
        `INSERT INTO creator_tracker_v2.raw_object_manifests (
           id, organization_id, run_id, source, endpoint, storage_key, sha256,
           byte_length, content_type, source_observed_at, fetched_at,
           retention_class, retain_until
         )
         SELECT incoming.id, $1, incoming."runId", incoming.source, incoming.endpoint,
                incoming."storageKey", incoming.sha256, incoming."byteLength",
                incoming."contentType", incoming."sourceObservedAt", incoming."fetchedAt",
                incoming."retentionClass", incoming."retainUntil"
           FROM jsonb_to_recordset($2::jsonb) AS incoming(
             id uuid, "runId" uuid, source text, endpoint text, "storageKey" text,
             sha256 text, "byteLength" bigint, "contentType" text,
             "sourceObservedAt" timestamptz, "fetchedAt" timestamptz,
             "retentionClass" creator_tracker_v2.retention_class,
             "retainUntil" timestamptz
           )
         RETURNING id`,
        [organizationId, json(payload.rawManifests)],
      );
      requireAllRows(result.rowCount, payload.rawManifests.length, "RAW_MANIFEST_CONFLICT");

      const setResult = await client.query(
        `INSERT INTO creator_tracker_v2.raw_object_manifest_sets (
           organization_id, raw_manifest_id, run_id, producer_run_id,
           store_version, purpose, response_count, total_response_bytes, sealed
         )
         SELECT $1, incoming.id, incoming."runId", incoming."producerRunId",
                incoming."storeVersion",
                incoming.purpose, incoming."responseCount",
                incoming."totalResponseBytes", incoming.sealed
           FROM jsonb_to_recordset($2::jsonb) AS incoming(
             id uuid, "runId" uuid, "producerRunId" text,
             "storeVersion" smallint, purpose text,
             "responseCount" integer, "totalResponseBytes" bigint,
             sealed boolean
           )
         RETURNING raw_manifest_id`,
        [organizationId, json(payload.rawManifests)],
      );
      requireAllRows(
        setResult.rowCount,
        payload.rawManifests.length,
        "RAW_MANIFEST_SET_CONFLICT",
      );
    }

    if (payload.rawManifestEntries.length > 0) {
      const result = await client.query(
        `INSERT INTO creator_tracker_v2.raw_object_manifest_entries (
           id, organization_id, raw_manifest_id, run_id, ordinal, adapter,
           request_kind, source_observed_at_ms, media_type, storage_key, sha256,
           byte_length
         )
         SELECT incoming.id, $1, incoming."rawManifestId", incoming."runId",
                incoming.ordinal, incoming.adapter, incoming."requestKind",
                incoming."sourceObservedAtMs", incoming."mediaType",
                incoming."storageKey", incoming.sha256, incoming."byteLength"
           FROM jsonb_to_recordset($2::jsonb) AS incoming(
             id uuid, "rawManifestId" uuid, "runId" uuid, ordinal integer,
             adapter text, "requestKind" text, "sourceObservedAtMs" bigint,
             "mediaType" text, "storageKey" text, sha256 text,
             "byteLength" bigint
           )
         RETURNING id`,
        [organizationId, json(payload.rawManifestEntries)],
      );
      requireAllRows(
        result.rowCount,
        payload.rawManifestEntries.length,
        "RAW_MANIFEST_ENTRY_CONFLICT",
      );
    }

    if (payload.accounts.some((entry) => entry.lastCompleteDiscoveryRunId !== null)) {
      const requested = payload.accounts.filter(
        (entry) => entry.lastCompleteDiscoveryRunId !== null,
      );
      const result = await client.query(
        `UPDATE creator_tracker_v2.creator_platform_accounts AS account
            SET last_complete_discovery_run_id = incoming."lastCompleteDiscoveryRunId",
                updated_at = transaction_timestamp()
           FROM jsonb_to_recordset($2::jsonb) AS incoming(
             id uuid, "firstSeenAt" timestamptz, "lastDiscoveryAt" timestamptz,
             "lastCompleteDiscoveryRunId" uuid
           )
           JOIN creator_tracker_v2.tracking_runs AS complete_run
             ON complete_run.organization_id = $1
            AND complete_run.id = incoming."lastCompleteDiscoveryRunId"
            AND complete_run.status = 'complete'
          WHERE account.organization_id = $1
            AND account.id = incoming.id
            AND COALESCE(incoming."lastDiscoveryAt", incoming."firstSeenAt")
                >= COALESCE(account.last_discovery_at, account.first_seen_at)
          RETURNING account.id`,
        [organizationId, json(requested)],
      );
      requireAllRows(
        result.rowCount,
        requested.length,
        "LAST_COMPLETE_RUN_INVALID",
      );
    }

    if (payload.videos.length > 0) {
      const rows = payload.videos.map((entry) => ({
        ...entry,
        metadata: withIngestionLineage(
          entry.metadata,
          payload.batch.id,
          entry.evidenceRunId,
          entry.rawManifestId,
        ),
      }));
      const result = await client.query(
        `INSERT INTO creator_tracker_v2.videos AS current_video (
           id, organization_id, creator_id, account_id, platform, native_video_id,
           canonical_url, published_at, published_at_source, published_at_confidence,
           first_seen_at, last_seen_at, first_seen_run_id, caption_first,
           caption_current, hashtags_first, duration_ms, availability, tracking_state,
           observation_tier, next_observation_at, metadata
         )
         SELECT incoming.id, $1, incoming."creatorId", incoming."accountId",
                incoming.platform, incoming."nativeVideoId", incoming."canonicalUrl",
                incoming."publishedAt", incoming."publishedAtSource",
                incoming."publishedAtConfidence", incoming."firstSeenAt",
                incoming."lastSeenAt", incoming."firstSeenRunId", incoming."captionFirst",
                incoming."captionCurrent", incoming."hashtagsFirst", incoming."durationMs",
                incoming.availability, incoming."trackingState", incoming."observationTier",
                incoming."nextObservationAt", incoming.metadata
           FROM jsonb_to_recordset($2::jsonb) AS incoming(
             id uuid, "creatorId" uuid, "accountId" uuid,
             platform creator_tracker_v2.platform, "nativeVideoId" text,
             "canonicalUrl" text, "publishedAt" timestamptz,
             "publishedAtSource" creator_tracker_v2.published_at_source,
             "publishedAtConfidence" creator_tracker_v2.evidence_confidence,
             "firstSeenAt" timestamptz, "lastSeenAt" timestamptz,
             "firstSeenRunId" uuid, "captionFirst" text, "captionCurrent" text,
             "hashtagsFirst" text[], "durationMs" integer,
             availability creator_tracker_v2.video_availability,
             "trackingState" creator_tracker_v2.video_tracking_state,
             "observationTier" creator_tracker_v2.observation_tier,
             "nextObservationAt" timestamptz, metadata jsonb,
             "evidenceRunId" uuid, "rawManifestId" uuid
           )
         ON CONFLICT (id) DO UPDATE SET
           canonical_url = CASE WHEN EXCLUDED.last_seen_at >= current_video.last_seen_at
             THEN EXCLUDED.canonical_url ELSE current_video.canonical_url END,
           published_at = CASE
             WHEN EXCLUDED.published_at IS NOT NULL AND
               (CASE EXCLUDED.published_at_confidence
                  WHEN 'verified' THEN 3 WHEN 'high' THEN 2 WHEN 'low' THEN 1 ELSE 0 END)
               >=
               (CASE current_video.published_at_confidence
                  WHEN 'verified' THEN 3 WHEN 'high' THEN 2 WHEN 'low' THEN 1 ELSE 0 END)
             THEN EXCLUDED.published_at ELSE current_video.published_at END,
           published_at_source = CASE
             WHEN EXCLUDED.published_at IS NOT NULL AND
               (CASE EXCLUDED.published_at_confidence
                  WHEN 'verified' THEN 3 WHEN 'high' THEN 2 WHEN 'low' THEN 1 ELSE 0 END)
               >=
               (CASE current_video.published_at_confidence
                  WHEN 'verified' THEN 3 WHEN 'high' THEN 2 WHEN 'low' THEN 1 ELSE 0 END)
             THEN EXCLUDED.published_at_source ELSE current_video.published_at_source END,
           published_at_confidence = CASE
             WHEN EXCLUDED.published_at IS NOT NULL AND
               (CASE EXCLUDED.published_at_confidence
                  WHEN 'verified' THEN 3 WHEN 'high' THEN 2 WHEN 'low' THEN 1 ELSE 0 END)
               >=
               (CASE current_video.published_at_confidence
                  WHEN 'verified' THEN 3 WHEN 'high' THEN 2 WHEN 'low' THEN 1 ELSE 0 END)
             THEN EXCLUDED.published_at_confidence ELSE current_video.published_at_confidence END,
           last_seen_at = GREATEST(current_video.last_seen_at, EXCLUDED.last_seen_at),
           caption_current = CASE WHEN EXCLUDED.last_seen_at >= current_video.last_seen_at
             THEN EXCLUDED.caption_current ELSE current_video.caption_current END,
           duration_ms = CASE WHEN EXCLUDED.last_seen_at >= current_video.last_seen_at
             THEN EXCLUDED.duration_ms ELSE current_video.duration_ms END,
           availability = CASE WHEN EXCLUDED.last_seen_at >= current_video.last_seen_at
             THEN EXCLUDED.availability ELSE current_video.availability END,
           tracking_state = CASE WHEN EXCLUDED.last_seen_at >= current_video.last_seen_at
             THEN EXCLUDED.tracking_state ELSE current_video.tracking_state END,
           observation_tier = CASE WHEN EXCLUDED.last_seen_at >= current_video.last_seen_at
             THEN EXCLUDED.observation_tier ELSE current_video.observation_tier END,
           next_observation_at = CASE WHEN EXCLUDED.last_seen_at >= current_video.last_seen_at
             THEN EXCLUDED.next_observation_at ELSE current_video.next_observation_at END,
           metadata = CASE WHEN EXCLUDED.last_seen_at >= current_video.last_seen_at
             THEN EXCLUDED.metadata ELSE current_video.metadata END,
           updated_at = CASE WHEN EXCLUDED.last_seen_at >= current_video.last_seen_at
             THEN transaction_timestamp() ELSE current_video.updated_at END
         WHERE current_video.organization_id = EXCLUDED.organization_id
           AND current_video.creator_id = EXCLUDED.creator_id
           AND current_video.account_id = EXCLUDED.account_id
           AND current_video.platform = EXCLUDED.platform
           AND current_video.native_video_id = EXCLUDED.native_video_id
           AND current_video.first_seen_at = EXCLUDED.first_seen_at
           AND current_video.first_seen_run_id = EXCLUDED.first_seen_run_id
           AND current_video.caption_first IS NOT DISTINCT FROM EXCLUDED.caption_first
           AND current_video.hashtags_first = EXCLUDED.hashtags_first
         RETURNING id`,
        [organizationId, json(rows)],
      );
      requireAllRows(result.rowCount, rows.length);
    }

    for (const event of payload.handleEvents) {
      const current = await client.query<{
        id: string;
        valid_from: Date | string;
        same_handle: boolean;
      }>(
        `SELECT id::text, valid_from, (handle = $3::public.citext) AS same_handle
           FROM creator_tracker_v2.account_handle_history
          WHERE organization_id = $1 AND account_id = $2 AND valid_to IS NULL
          FOR UPDATE`,
        [organizationId, event.accountId, event.handle],
      );
      if (current.rowCount === 1) {
        const existing = current.rows[0];
        if (
          existing.same_handle ||
          Date.parse(event.validFrom) <= Date.parse(String(existing.valid_from))
        ) {
          throw new CreatorTrackerIngestionStoreError(
            "conflict",
            "HANDLE_HISTORY_CONFLICT",
          );
        }
        await client.query(
          `UPDATE creator_tracker_v2.account_handle_history
              SET valid_to = $3
            WHERE organization_id = $1 AND id = $2 AND valid_to IS NULL`,
          [organizationId, existing.id, event.validFrom],
        );
      }
      await client.query(
        `INSERT INTO creator_tracker_v2.account_handle_history (
           id, organization_id, account_id, handle, valid_from, source_run_id, is_verified
         ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          event.id,
          organizationId,
          event.accountId,
          event.handle,
          event.validFrom,
          event.sourceRunId,
          event.isVerified,
        ],
      );
      const accountUpdate = await client.query(
        `UPDATE creator_tracker_v2.creator_platform_accounts
            SET current_handle = $3, updated_at = transaction_timestamp(),
                metadata = jsonb_set(
                  metadata,
                  '{_creatorTrackerIngestion}',
                  jsonb_build_object(
                    'batchId', $4::text,
                    'runId', $5::text,
                    'rawManifestId', $6::text
                  ),
                  true
                )
          WHERE organization_id = $1 AND id = $2`,
        [
          organizationId,
          event.accountId,
          event.handle,
          payload.batch.id,
          event.sourceRunId,
          event.rawManifestId,
        ],
      );
      requireAllRows(accountUpdate.rowCount, 1, "HANDLE_ACCOUNT_NOT_FOUND");
    }

    if (payload.observations.length > 0) {
      const result = await client.query(
        `INSERT INTO creator_tracker_v2.video_observations (
           id, organization_id, video_id, run_id, adapter, metric_schema_version,
           scheduled_for, request_started_at, observed_at, source_observed_at,
           source_timezone, views, likes, comments, shares, saves, availability,
           http_status, is_complete, confidence, counter_regression,
           raw_manifest_id, idempotency_key
         )
         SELECT incoming.id, $1, incoming."videoId", incoming."runId", incoming.adapter,
                incoming."metricSchemaVersion", incoming."scheduledFor",
                incoming."requestStartedAt", incoming."observedAt",
                incoming."sourceObservedAt", incoming."sourceTimezone", incoming.views,
                incoming.likes, incoming.comments, incoming.shares, incoming.saves,
                incoming.availability, incoming."httpStatus", incoming."isComplete",
                incoming.confidence, incoming."counterRegression",
                incoming."rawManifestId", incoming."idempotencyKey"
           FROM jsonb_to_recordset($2::jsonb) AS incoming(
             id uuid, "videoId" uuid, "runId" uuid, adapter text,
             "metricSchemaVersion" smallint, "scheduledFor" timestamptz,
             "requestStartedAt" timestamptz, "observedAt" timestamptz,
             "sourceObservedAt" timestamptz, "sourceTimezone" text,
             views bigint, likes bigint, comments bigint, shares bigint, saves bigint,
             availability creator_tracker_v2.video_availability, "httpStatus" integer,
             "isComplete" boolean, confidence creator_tracker_v2.evidence_confidence,
             "counterRegression" boolean, "rawManifestId" uuid,
             "idempotencyKey" text
           )
         RETURNING id`,
        [organizationId, json(payload.observations)],
      );
      requireAllRows(result.rowCount, payload.observations.length, "OBSERVATION_CONFLICT");

      const regressionCheck = await client.query<{
        id: string;
        claimed_regression: boolean;
        computed_regression: boolean;
      }>(
        `WITH incoming_ids AS (
           SELECT value::uuid AS id FROM jsonb_array_elements_text($2::jsonb)
         )
         SELECT current_observation.id::text,
                current_observation.counter_regression AS claimed_regression,
                (
                  current_observation.availability = 'available'
                  AND (
                    (current_observation.views IS NOT NULL AND previous.views IS NOT NULL
                      AND current_observation.views < previous.views)
                    OR (current_observation.likes IS NOT NULL AND previous.likes IS NOT NULL
                      AND current_observation.likes < previous.likes)
                    OR (current_observation.comments IS NOT NULL AND previous.comments IS NOT NULL
                      AND current_observation.comments < previous.comments)
                    OR (current_observation.shares IS NOT NULL AND previous.shares IS NOT NULL
                      AND current_observation.shares < previous.shares)
                    OR (current_observation.saves IS NOT NULL AND previous.saves IS NOT NULL
                      AND current_observation.saves < previous.saves)
                  )
                ) AS computed_regression
           FROM creator_tracker_v2.video_observations AS current_observation
           JOIN incoming_ids ON incoming_ids.id = current_observation.id
           LEFT JOIN LATERAL (
             SELECT candidate.views, candidate.likes, candidate.comments,
                    candidate.shares, candidate.saves
               FROM creator_tracker_v2.video_observations AS candidate
              WHERE candidate.organization_id = current_observation.organization_id
                AND candidate.video_id = current_observation.video_id
                AND candidate.is_complete
                AND candidate.availability = 'available'
                AND (candidate.observed_at, candidate.id)
                    < (current_observation.observed_at, current_observation.id)
              ORDER BY candidate.observed_at DESC, candidate.id DESC
              LIMIT 1
           ) AS previous ON true
          WHERE current_observation.organization_id = $1`,
        [organizationId, json(payload.observations.map((entry) => entry.id))],
      );
      if (
        regressionCheck.rowCount !== payload.observations.length ||
        regressionCheck.rows.some(
          (row) => row.claimed_regression !== row.computed_regression,
        )
      ) {
        throw new CreatorTrackerIngestionStoreError(
          "invalid_evidence",
          "COUNTER_REGRESSION_MISMATCH",
        );
      }

      await client.query(
        `WITH incoming_ids AS (
           SELECT value::uuid AS id FROM jsonb_array_elements_text($2::jsonb)
         ), latest AS (
           SELECT DISTINCT ON (observation.video_id)
                  observation.id, observation.video_id, observation.observed_at,
                  observation.availability
             FROM creator_tracker_v2.video_observations AS observation
             JOIN incoming_ids ON incoming_ids.id = observation.id
            WHERE observation.organization_id = $1
            ORDER BY observation.video_id, observation.observed_at DESC, observation.id DESC
         )
         UPDATE creator_tracker_v2.videos AS video
            SET last_observation_at = latest.observed_at,
                latest_observation_id = latest.id,
                availability = latest.availability,
                updated_at = transaction_timestamp()
           FROM latest
          WHERE video.organization_id = $1
            AND video.id = latest.video_id
            AND (
              video.last_observation_at IS NULL
              OR latest.observed_at > video.last_observation_at
              OR (latest.observed_at = video.last_observation_at
                  AND latest.id > video.latest_observation_id)
            )`,
        [organizationId, json(payload.observations.map((entry) => entry.id))],
      );
    }

    if (payload.failures.length > 0) {
      const result = await client.query(
        `INSERT INTO creator_tracker_v2.tracking_failures (
           id, organization_id, run_id, target_type, account_id, video_id,
           target_key, stage, error_code, http_status, retryable, detail,
           occurred_at, resolved_by_run_id, idempotency_key
         )
         SELECT incoming.id, $1, incoming."runId", incoming."targetType",
                incoming."accountId", incoming."videoId", incoming."targetKey",
                incoming.stage, incoming."errorCode", incoming."httpStatus",
                incoming.retryable, incoming.detail, incoming."occurredAt",
                incoming."resolvedByRunId", incoming."idempotencyKey"
           FROM jsonb_to_recordset($2::jsonb) AS incoming(
             id uuid, "runId" uuid, "targetType" text, "accountId" uuid,
             "videoId" uuid, "targetKey" text, stage text, "errorCode" text,
             "httpStatus" integer, retryable boolean, detail jsonb,
             "occurredAt" timestamptz, "resolvedByRunId" uuid,
             "idempotencyKey" text
           )
         RETURNING id`,
        [organizationId, json(payload.failures)],
      );
      requireAllRows(result.rowCount, payload.failures.length, "FAILURE_CONFLICT");
    }

    if (payload.coverageWindows.length > 0) {
      const result = await client.query(
        `INSERT INTO creator_tracker_v2.source_coverage_windows (
           id, organization_id, platform, account_id, source, window_start,
           window_end, run_id, status, expected_count, discovered_count,
           observed_count, pages_expected, pages_fetched, missing_native_ids,
           warning_codes, computed_at, evidence_sha256, idempotency_key
         )
         SELECT incoming.id, $1, incoming.platform, incoming."accountId", incoming.source,
                incoming."windowStart", incoming."windowEnd", incoming."runId",
                incoming.status, incoming."expectedCount", incoming."discoveredCount",
                incoming."observedCount", incoming."pagesExpected", incoming."pagesFetched",
                incoming."missingNativeIds", incoming."warningCodes", incoming."computedAt",
                incoming."evidenceSha256", incoming."idempotencyKey"
           FROM jsonb_to_recordset($2::jsonb) AS incoming(
             id uuid, platform creator_tracker_v2.platform, "accountId" uuid,
             source text, "windowStart" timestamptz, "windowEnd" timestamptz,
             "runId" uuid, status creator_tracker_v2.coverage_status,
             "expectedCount" integer, "discoveredCount" integer,
             "observedCount" integer, "pagesExpected" integer, "pagesFetched" integer,
             "missingNativeIds" text[], "warningCodes" text[], "computedAt" timestamptz,
             "evidenceSha256" text, "idempotencyKey" text
           )
         RETURNING id`,
        [organizationId, json(payload.coverageWindows)],
      );
      requireAllRows(result.rowCount, payload.coverageWindows.length, "COVERAGE_CONFLICT");
    }

    await client.query("COMMIT");
    transactionOpen = false;
    return {
      batchId: payload.batch.id,
      organizationId,
      idempotencyKey: payload.batch.idempotencyKey,
      payloadSha256,
      committedAt: timestampString(insertedBatch.rows[0]?.accepted_at),
      ...counts,
      replayed: false,
    };
  } catch (error) {
    if (transactionOpen) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // The original failure determines retryability and the public error.
      }
    }
    throw error;
  }
}

export function createCreatorTrackerIngestionStore(
  databaseUrl: string,
  databaseTls: CreatorTrackerDatabaseTlsConfig,
): CreatorTrackerIngestionStore {
  const pool = getPool(databaseUrl, databaseTls);
  return {
    async persist(payload, payloadSha256) {
      let lastError: unknown;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        let client: PoolClient | undefined;
        let releaseAsBroken = false;
        try {
          client = await pool.connect();
          return await persistCreatorTrackerBatchWithClient(
            client,
            payload,
            payloadSha256,
          );
        } catch (error) {
          lastError = error;
          releaseAsBroken = pgErrorCode(error).startsWith("08") ||
            ["ECONNRESET", "EPIPE", "ETIMEDOUT"].includes(pgErrorCode(error));
          if (!isRetryableTransactionError(error) || attempt === 2) break;
        } finally {
          client?.release(releaseAsBroken);
        }
      }
      throw normalizeStoreError(lastError);
    },
  };
}
