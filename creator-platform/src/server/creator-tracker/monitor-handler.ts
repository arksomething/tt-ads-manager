import { TextDecoder } from "node:util";

import { ZodError } from "zod";

import {
  authenticateCreatorTrackerMonitorRequest,
  CreatorTrackerMonitorConfigurationError,
  CreatorTrackerMonitorRequestError,
  loadCreatorTrackerMonitorSecret,
  readBoundedCreatorTrackerMonitorBody,
} from "@/lib/creator-tracker/monitor-auth";
import {
  creatorTrackerMonitorHeartbeatSchema,
} from "@/lib/creator-tracker/monitor-contract";
import { createAdminClient } from "@/lib/supabase/admin";

type HandlerDependencies = {
  now?: () => number;
  secret?: Uint8Array;
};

type MonitorReceipt = {
  monitorId: string;
  receivedAt: string;
  replayed: boolean;
};

function jsonResponse(status: number, value: unknown) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store, max-age=0",
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
  return error.issues.slice(0, 20).map((issue) => ({
    path: issue.path.map(String).join("."),
    message: issue.message,
  }));
}

function parseMonitorReceipt(value: unknown): MonitorReceipt | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Partial<MonitorReceipt>;
  if (
    typeof candidate.monitorId !== "string" ||
    typeof candidate.receivedAt !== "string" ||
    !Number.isFinite(Date.parse(candidate.receivedAt)) ||
    typeof candidate.replayed !== "boolean"
  ) {
    return null;
  }
  return candidate as MonitorReceipt;
}

export async function handleCreatorTrackerMonitorHeartbeat(
  request: Request,
  dependencies: HandlerDependencies = {},
) {
  try {
    const now = dependencies.now?.() ?? Date.now();
    const secret = dependencies.secret ?? loadCreatorTrackerMonitorSecret();
    const body = await readBoundedCreatorTrackerMonitorBody(request);
    const identity = authenticateCreatorTrackerMonitorRequest(
      request,
      body,
      secret,
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
    const parsed = creatorTrackerMonitorHeartbeatSchema.safeParse(input);
    if (!parsed.success) {
      return errorResponse(
        422,
        "INVALID_MONITOR_HEARTBEAT",
        publicValidationIssues(parsed.error),
      );
    }
    if (parsed.data.monitorId !== identity.monitorId) {
      return errorResponse(401, "AUTHENTICATION_FAILED");
    }
    if (Math.abs(Date.parse(parsed.data.observedAt) - now) > 5 * 60 * 1_000) {
      return errorResponse(422, "INVALID_HEARTBEAT_TIMESTAMP");
    }

    const supabase = createAdminClient();
    const { data, error } = await supabase.rpc(
      "record_creator_tracker_monitor_heartbeat",
      {
        heartbeat_input: parsed.data,
        request_nonce: identity.requestNonce,
        request_timestamp: identity.requestTimestamp,
        request_body_sha256: identity.bodySha256,
      },
    );
    if (error) {
      if (error.code === "23505" && error.message?.includes("MONITOR_REQUEST_REPLAYED")) {
        return errorResponse(409, "MONITOR_REQUEST_REPLAYED");
      }
      if (
        ["22023", "23502", "23503", "23514", "22P02", "22003", "22007"].includes(
          error.code ?? "",
        )
      ) {
        return errorResponse(422, "DATABASE_CONTRACT_REJECTED");
      }
      return errorResponse(503, "MONITOR_UNAVAILABLE");
    }
    const receipt = parseMonitorReceipt(data);
    if (!receipt || receipt.monitorId !== parsed.data.monitorId) {
      return errorResponse(500, "MONITOR_FAILED");
    }

    return jsonResponse(receipt.replayed ? 200 : 201, {
      ok: true,
      accepted: true,
      monitorId: parsed.data.monitorId,
      receivedAt: receipt.receivedAt,
      replayed: receipt.replayed,
    });
  } catch (error) {
    if (error instanceof CreatorTrackerMonitorRequestError) {
      return errorResponse(error.status, error.code);
    }
    if (error instanceof CreatorTrackerMonitorConfigurationError) {
      return errorResponse(503, "MONITOR_UNAVAILABLE");
    }
    console.error("[creator-tracker-monitor] unhandled heartbeat failure");
    return errorResponse(500, "MONITOR_FAILED");
  }
}
