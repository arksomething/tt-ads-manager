import { TextDecoder } from "node:util";

import { ZodError } from "zod";

import {
  authenticateCreatorTrackerIngestionRequest,
  CreatorTrackerIngestionConfigurationError,
  CreatorTrackerIngestionRequestError,
  loadCreatorTrackerIngestionRuntimeConfig,
  readBoundedRequestBody,
  signCreatorTrackerCommitReceipt,
  type CreatorTrackerIngestionRuntimeConfig,
} from "./ingestion-auth";
import { creatorTrackerIngestionSchema } from "./ingestion-contract";
import {
  createCreatorTrackerIngestionStore,
  CreatorTrackerIngestionStoreError,
  type CreatorTrackerIngestionStore,
} from "./ingestion-store";

interface CreatorTrackerIngestionHandlerDependencies {
  config?: CreatorTrackerIngestionRuntimeConfig;
  store?: CreatorTrackerIngestionStore;
  now?: () => number;
}

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

export async function handleCreatorTrackerIngestionRequest(
  request: Request,
  dependencies: CreatorTrackerIngestionHandlerDependencies = {},
) {
  try {
    const config =
      dependencies.config ?? loadCreatorTrackerIngestionRuntimeConfig();
    const now = dependencies.now?.() ?? Date.now();
    const body = await readBoundedRequestBody(request);
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

    const store =
      dependencies.store ??
      createCreatorTrackerIngestionStore(config.databaseUrl, config.databaseTls);
    const receipt = await store.persist(
      parsed.data,
      authentication.payloadSha256,
    );

    // The durable collector outbox may retire a row only after verifying this
    // exact, server-signed post-COMMIT receipt. Raw bytes are deliberately not
    // described as uploaded: the V2 schema records only their manifests.
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
      return errorResponse(error.status, error.code, undefined);
    }
    if (error instanceof CreatorTrackerIngestionConfigurationError) {
      return errorResponse(503, "INGESTION_UNAVAILABLE");
    }
    if (error instanceof CreatorTrackerIngestionStoreError) {
      return storeErrorResponse(error);
    }
    return errorResponse(500, "INGESTION_FAILED");
  }
}
