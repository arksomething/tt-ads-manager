import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import {
  CREATOR_TRACKER_MONITOR_MAX_BODY_BYTES,
  CREATOR_TRACKER_MONITOR_MAX_CLOCK_SKEW_SECONDS,
  CREATOR_TRACKER_MONITOR_PATH,
} from "@/lib/creator-tracker/monitor-contract";

const monitorIdPattern = /^[a-z0-9][a-z0-9._-]{2,63}$/u;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const signaturePattern = /^v1=([0-9a-f]{64})$/u;
const minimumSecretBytes = 32;

export const CREATOR_TRACKER_MONITOR_HEADERS = {
  id: "x-gotall-monitor-id",
  timestamp: "x-gotall-monitor-timestamp",
  nonce: "x-gotall-monitor-nonce",
  signature: "x-gotall-monitor-signature",
} as const;

export class CreatorTrackerMonitorConfigurationError extends Error {
  constructor() {
    super("Creator tracker monitor authentication is not configured.");
    this.name = "CreatorTrackerMonitorConfigurationError";
  }
}

export class CreatorTrackerMonitorRequestError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string) {
    super(code);
    this.name = "CreatorTrackerMonitorRequestError";
    this.status = status;
    this.code = code;
  }
}

export type CreatorTrackerMonitorIdentity = {
  monitorId: string;
  requestNonce: string;
  requestTimestamp: string;
  bodySha256: string;
};

function sha256(value: Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}

function signingPayload(args: {
  timestamp: string;
  nonce: string;
  monitorId: string;
  bodySha256: string;
}) {
  return [
    "v1",
    args.timestamp,
    args.nonce,
    args.monitorId,
    "POST",
    CREATOR_TRACKER_MONITOR_PATH,
    args.bodySha256,
  ].join("\n");
}

export function loadCreatorTrackerMonitorSecret(
  environment: Readonly<Record<string, string | undefined>> = process.env,
) {
  const secret = environment.CREATOR_TRACKER_MONITOR_SECRET;
  if (!secret || Buffer.byteLength(secret, "utf8") < minimumSecretBytes) {
    throw new CreatorTrackerMonitorConfigurationError();
  }
  return Buffer.from(secret, "utf8");
}

export function signCreatorTrackerMonitorRequest(args: {
  secret: Uint8Array;
  timestamp: string;
  nonce: string;
  monitorId: string;
  bodySha256: string;
}) {
  return `v1=${createHmac("sha256", args.secret)
    .update(signingPayload(args), "utf8")
    .digest("hex")}`;
}

export async function readBoundedCreatorTrackerMonitorBody(request: Request) {
  const declaredLength = request.headers.get("content-length");
  if (
    declaredLength !== null &&
    (!/^\d+$/u.test(declaredLength) ||
      Number(declaredLength) > CREATOR_TRACKER_MONITOR_MAX_BODY_BYTES)
  ) {
    throw new CreatorTrackerMonitorRequestError(413, "PAYLOAD_TOO_LARGE");
  }

  if (!request.body) return Buffer.alloc(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > CREATOR_TRACKER_MONITOR_MAX_BODY_BYTES) {
        await reader.cancel();
        throw new CreatorTrackerMonitorRequestError(413, "PAYLOAD_TOO_LARGE");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), size);
}

export function authenticateCreatorTrackerMonitorRequest(
  request: Request,
  body: Uint8Array,
  secret: Uint8Array,
  now = Date.now(),
): CreatorTrackerMonitorIdentity {
  const url = new URL(request.url);
  if (
    request.method !== "POST" ||
    url.pathname !== CREATOR_TRACKER_MONITOR_PATH ||
    url.search !== ""
  ) {
    throw new CreatorTrackerMonitorRequestError(400, "INVALID_REQUEST_TARGET");
  }
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
    throw new CreatorTrackerMonitorRequestError(415, "UNSUPPORTED_MEDIA_TYPE");
  }
  const contentEncoding = request.headers.get("content-encoding");
  if (contentEncoding && contentEncoding.toLowerCase() !== "identity") {
    throw new CreatorTrackerMonitorRequestError(
      415,
      "UNSUPPORTED_CONTENT_ENCODING",
    );
  }

  const monitorId = request.headers.get(CREATOR_TRACKER_MONITOR_HEADERS.id) ?? "";
  const timestamp =
    request.headers.get(CREATOR_TRACKER_MONITOR_HEADERS.timestamp) ?? "";
  const nonce = request.headers.get(CREATOR_TRACKER_MONITOR_HEADERS.nonce) ?? "";
  const suppliedSignature =
    request.headers.get(CREATOR_TRACKER_MONITOR_HEADERS.signature) ?? "";
  if (
    !monitorIdPattern.test(monitorId) ||
    !/^\d{10}$/u.test(timestamp) ||
    !uuidPattern.test(nonce) ||
    !signaturePattern.test(suppliedSignature)
  ) {
    throw new CreatorTrackerMonitorRequestError(401, "AUTHENTICATION_FAILED");
  }

  const timestampSeconds = Number(timestamp);
  if (
    !Number.isSafeInteger(timestampSeconds) ||
    Math.abs(Math.floor(now / 1_000) - timestampSeconds) >
      CREATOR_TRACKER_MONITOR_MAX_CLOCK_SKEW_SECONDS
  ) {
    throw new CreatorTrackerMonitorRequestError(401, "AUTHENTICATION_FAILED");
  }

  const bodySha256 = sha256(body);
  const expected = signCreatorTrackerMonitorRequest({
    secret,
    timestamp,
    nonce,
    monitorId,
    bodySha256,
  });
  if (
    expected.length !== suppliedSignature.length ||
    !timingSafeEqual(
      Buffer.from(expected, "ascii"),
      Buffer.from(suppliedSignature, "ascii"),
    )
  ) {
    throw new CreatorTrackerMonitorRequestError(401, "AUTHENTICATION_FAILED");
  }

  return {
    monitorId,
    requestNonce: nonce,
    requestTimestamp: new Date(timestampSeconds * 1_000).toISOString(),
    bodySha256,
  };
}
