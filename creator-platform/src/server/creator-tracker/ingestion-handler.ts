import { TextDecoder } from "node:util";

import { ZodError } from "zod";

import {
  authenticateCreatorTrackerIngestionRequest,
  CreatorTrackerIngestionConfigurationError,
  CreatorTrackerIngestionRequestError,
  loadCreatorTrackerIngestionRuntimeConfig,
  readBoundedCreatorTrackerBody,
  signCreatorTrackerCommitReceipt,
  type CreatorTrackerIngestionRuntimeConfig,
} from "@/lib/creator-tracker/ingestion-auth";
import {
  creatorTrackerIngestionSchema,
  deriveIngestionCounts,
  type CreatorTrackerIngestionBatch,
} from "@/lib/creator-tracker/ingestion-contract";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  createCreatorTrackerIngestionStore,
  CreatorTrackerIngestionStoreError,
  type CreatorTrackerCommitReceipt,
  type CreatorTrackerIngestionStore,
} from "@/server/creator-tracker/ingestion-store";

type IngestionRpcResult = {
  batchId: string;
  organizationId: string;
  idempotencyKey: string;
  payloadSha256: string;
  committedAt: string;
  itemCount: number;
  observationCount: number;
  failureCount: number;
  replayed: boolean;
};

type HandlerDependencies = {
  config?: CreatorTrackerIngestionRuntimeConfig;
  normalizedStore?: CreatorTrackerIngestionStore;
  now?: () => number;
};

function jsonResponse(status: number, value: unknown, headers?: HeadersInit) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store, max-age=0",
      ...headers,
    },
  });
}

function errorResponse(status: number, code: string, issues?: unknown) {
  return jsonResponse(status, {
    ok: false,
    error: { code, ...(issues ? { issues } : {}) },
  });
}

function publicValidationIssues(error: ZodError) {
  return error.issues.slice(0, 25).map((issue) => ({
    path: issue.path.map(String).join("."),
    message: issue.message,
  }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseRpcResult(value: unknown): IngestionRpcResult | null {
  if (!isRecord(value)) return null;
  const result = value as Partial<IngestionRpcResult>;
  if (
    typeof result.batchId !== "string" ||
    typeof result.organizationId !== "string" ||
    typeof result.idempotencyKey !== "string" ||
    !/^[a-f0-9]{64}$/u.test(result.payloadSha256 ?? "") ||
    typeof result.committedAt !== "string" ||
    !Number.isFinite(Date.parse(result.committedAt)) ||
    !Number.isSafeInteger(result.itemCount) ||
    !Number.isSafeInteger(result.observationCount) ||
    !Number.isSafeInteger(result.failureCount) ||
    typeof result.replayed !== "boolean"
  ) {
    return null;
  }
  return result as IngestionRpcResult;
}

function rpcErrorResponse(error: { code?: string; message?: string }) {
  if (error.code === "23505") {
    const reused = error.message?.includes("IDEMPOTENCY_KEY_REUSED");
    return errorResponse(409, reused ? "IDEMPOTENCY_KEY_REUSED" : "EVIDENCE_CONFLICT");
  }
  if (
    ["23502", "23503", "23514", "22P02", "22003", "22007", "22023"].includes(
      error.code ?? "",
    )
  ) {
    return errorResponse(422, "DATABASE_CONTRACT_REJECTED");
  }
  if (
    error.code === "42501" ||
    error.code === "3F000" ||
    error.code === "42P01" ||
    error.code?.startsWith("08") ||
    error.code?.startsWith("57")
  ) {
    return errorResponse(503, "INGESTION_UNAVAILABLE");
  }
  return errorResponse(500, "INGESTION_FAILED");
}

function storeErrorResponse(error: CreatorTrackerIngestionStoreError) {
  switch (error.kind) {
    case "conflict":
      return errorResponse(409, error.code);
    case "invalid_evidence":
      return errorResponse(422, error.code);
    case "unavailable":
      return errorResponse(503, "INGESTION_UNAVAILABLE");
    default:
      return errorResponse(500, "INGESTION_FAILED");
  }
}

function receiptHasExpectedIdentity(
  receipt: IngestionRpcResult,
  payload: CreatorTrackerIngestionBatch,
  payloadSha256: string,
) {
  const counts = deriveIngestionCounts(payload);
  return (
    receipt.batchId === payload.batch.id &&
    receipt.organizationId === payload.batch.organizationId &&
    receipt.idempotencyKey === payload.batch.idempotencyKey &&
    receipt.payloadSha256 === payloadSha256 &&
    receipt.itemCount === counts.itemCount &&
    receipt.observationCount === counts.observationCount &&
    receipt.failureCount === counts.failureCount
  );
}

function receiptsHaveSameIdentity(
  staging: IngestionRpcResult,
  normalized: CreatorTrackerCommitReceipt,
) {
  return (
    staging.batchId === normalized.batchId &&
    staging.organizationId === normalized.organizationId &&
    staging.idempotencyKey === normalized.idempotencyKey &&
    staging.payloadSha256 === normalized.payloadSha256 &&
    staging.itemCount === normalized.itemCount &&
    staging.observationCount === normalized.observationCount &&
    staging.failureCount === normalized.failureCount
  );
}

function laterCommitTimestamp(staging: string, normalized: string) {
  return Date.parse(normalized) >= Date.parse(staging) ? normalized : staging;
}

export async function handleCreatorTrackerIngestionRequest(
  request: Request,
  dependencies: HandlerDependencies = {},
) {
  try {
    const config =
      dependencies.config ?? loadCreatorTrackerIngestionRuntimeConfig();
    const now = dependencies.now?.() ?? Date.now();
    const body = await readBoundedCreatorTrackerBody(request);
    const authentication = authenticateCreatorTrackerIngestionRequest(
      request,
      body,
      config,
      now,
    );

    let decoded: string;
    try {
      decoded = new TextDecoder("utf-8", { fatal: true }).decode(body);
    } catch {
      return errorResponse(400, "INVALID_JSON_ENCODING");
    }

    let input: unknown;
    try {
      input = JSON.parse(decoded);
    } catch {
      return errorResponse(400, "INVALID_JSON");
    }

    const parsed = creatorTrackerIngestionSchema.safeParse(input);
    if (!parsed.success) {
      return errorResponse(
        422,
        "INVALID_INGESTION_BATCH",
        publicValidationIssues(parsed.error),
      );
    }
    if (!config.allowedOrganizationIds.has(parsed.data.batch.organizationId)) {
      return errorResponse(403, "ORGANIZATION_NOT_ALLOWED");
    }
    if (Date.parse(parsed.data.batch.producedAt) > now + 5 * 60 * 1_000) {
      return errorResponse(422, "INVALID_BATCH_TIMESTAMP");
    }

    const supabase = createAdminClient();
    const { data, error } = await supabase.rpc("ingest_creator_tracker_batch", {
      batch_input: parsed.data,
      request_key_id: authentication.key.id,
      request_payload_sha256: authentication.payloadSha256,
    });
    if (error) return rpcErrorResponse(error);

    const stagingReceipt = parseRpcResult(data);
    if (
      !stagingReceipt ||
      !receiptHasExpectedIdentity(
        stagingReceipt,
        parsed.data,
        authentication.payloadSha256,
      )
    ) {
      return errorResponse(500, "INGESTION_FAILED");
    }

    // The Supabase RPC is the creator-platform projection. The normalized V2
    // store is a separate durable projection, so a retry may find either side
    // already committed. Both stores are idempotent; never acknowledge until
    // both return the exact signed batch identity.
    const normalizedStore =
      dependencies.normalizedStore ??
      createCreatorTrackerIngestionStore(
        config.databaseUrl,
        config.databaseTls,
      );
    const normalizedReceipt = await normalizedStore.persist(
      parsed.data,
      authentication.payloadSha256,
    );
    if (
      !receiptHasExpectedIdentity(
        normalizedReceipt,
        parsed.data,
        authentication.payloadSha256,
      ) ||
      !receiptsHaveSameIdentity(stagingReceipt, normalizedReceipt) ||
      !Number.isFinite(Date.parse(normalizedReceipt.committedAt))
    ) {
      return errorResponse(500, "INGESTION_FAILED");
    }

    const receipt = {
      ...normalizedReceipt,
      committedAt: laterCommitTimestamp(
        stagingReceipt.committedAt,
        normalizedReceipt.committedAt,
      ),
      // A partially committed request is not an exact replay until both stores
      // independently report that this identity already existed.
      replayed: stagingReceipt.replayed && normalizedReceipt.replayed,
    };
    const receiptBody = JSON.stringify({
      ok: true,
      receiptVersion: 1,
      status: "committed",
      batchId: receipt.batchId,
      organizationId: receipt.organizationId,
      idempotencyKey: receipt.idempotencyKey,
      payloadSha256: receipt.payloadSha256,
      committedAt: receipt.committedAt,
      counts: {
        items: receipt.itemCount,
        observations: receipt.observationCount,
        failures: receipt.failureCount,
      },
      replayed: receipt.replayed,
      rawEvidence: {
        manifest: "committed",
        bytes: "externally_pre_stored_unverified",
      },
    });
    const receiptSignature = signCreatorTrackerCommitReceipt(
      authentication.key.secret,
      receiptBody,
    );

    return new Response(receiptBody, {
      status: receipt.replayed ? 200 : 201,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store, max-age=0",
        "x-creator-ingest-ack-key-id": authentication.key.id,
        "x-creator-ingest-ack-signature": receiptSignature,
      },
    });
  } catch (error) {
    if (error instanceof CreatorTrackerIngestionRequestError) {
      return errorResponse(error.status, error.code);
    }
    if (error instanceof CreatorTrackerIngestionConfigurationError) {
      return errorResponse(503, "INGESTION_UNAVAILABLE");
    }
    if (error instanceof CreatorTrackerIngestionStoreError) {
      return storeErrorResponse(error);
    }
    // Do not log signed request bodies, hashes, key IDs, or organization IDs.
    console.error("[creator-tracker-ingestion] unhandled ingestion failure");
    return errorResponse(500, "INGESTION_FAILED");
  }
}
