import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { createAdminClient } from "@/lib/supabase/admin";

const maximumClockSkewSeconds = 300;
const minimumSecretBytes = 32;
const maximumSecretBytes = 128;
const workerIdPattern = /^[a-z0-9][a-z0-9._-]{2,63}$/u;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const signaturePattern = /^v1=([a-f0-9]{64})$/u;

export type PlatformVerificationWorkerIdentity = {
  workerId: string;
  requestNonce: string;
  bodySha256: string;
};

type VerificationResult =
  | { ok: true; identity: PlatformVerificationWorkerIdentity }
  | {
      ok: false;
      reason:
        | "worker_id"
        | "nonce"
        | "timestamp"
        | "clock_skew"
        | "request_target"
        | "signature"
        | "configuration"
        | "replay"
        | "backend";
    };

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function safeEqualHex(left: string, right: string) {
  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");
  return (
    leftBuffer.length === rightBuffer.length
    && timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function decodeWorkerSecret(value: string | undefined) {
  const encoded = value?.trim() ?? "";
  if (!encoded || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/u.test(encoded)) {
    throw new Error("Platform verification worker authentication is not configured.");
  }
  const secret = Buffer.from(encoded, "base64");
  if (
    secret.length < minimumSecretBytes
    || secret.length > maximumSecretBytes
    || secret.toString("base64") !== encoded
  ) {
    throw new Error("Platform verification worker authentication is not configured.");
  }
  return secret;
}

function signingPayload(args: {
  timestamp: number;
  nonce: string;
  workerId: string;
  method: string;
  pathname: string;
  bodySha256: string;
}) {
  return [
    "gotall-platform-verification-worker-v1",
    String(args.timestamp),
    args.nonce.toLowerCase(),
    args.workerId,
    args.method.toUpperCase(),
    args.pathname,
    args.bodySha256,
  ].join("\n");
}

export function signPlatformVerificationWorkerRequest(args: {
  secret: Uint8Array;
  timestamp: number;
  nonce: string;
  workerId: string;
  method: string;
  pathname: string;
  body: string;
}) {
  const bodySha256 = sha256(args.body);
  return `v1=${createHmac("sha256", args.secret)
    .update(signingPayload({ ...args, bodySha256 }), "utf8")
    .digest("hex")}`;
}

export function verifyPlatformVerificationWorkerSignature(args: {
  secret: Uint8Array;
  workerId: string | null;
  timestamp: string | null;
  nonce: string | null;
  signature: string | null;
  method: string;
  pathname: string;
  search: string;
  body: string;
  nowSeconds?: number;
}): VerificationResult {
  const workerId = args.workerId?.trim() ?? "";
  const nonce = args.nonce?.trim().toLowerCase() ?? "";
  const timestampNumber = Number(args.timestamp);
  const signatureMatch = args.signature?.match(signaturePattern);
  const nowSeconds = args.nowSeconds ?? Math.floor(Date.now() / 1_000);

  if (!workerIdPattern.test(workerId)) return { ok: false, reason: "worker_id" };
  if (!uuidPattern.test(nonce)) return { ok: false, reason: "nonce" };
  if (!/^\d{10}$/u.test(args.timestamp ?? "") || !Number.isSafeInteger(timestampNumber)) {
    return { ok: false, reason: "timestamp" };
  }
  if (Math.abs(nowSeconds - timestampNumber) > maximumClockSkewSeconds) {
    return { ok: false, reason: "clock_skew" };
  }
  if (args.method.toUpperCase() !== "POST" || args.search !== "") {
    return { ok: false, reason: "request_target" };
  }
  if (!signatureMatch) return { ok: false, reason: "signature" };

  const bodySha256 = sha256(args.body);
  const expected = createHmac("sha256", args.secret)
    .update(signingPayload({
      timestamp: timestampNumber,
      nonce,
      workerId,
      method: args.method,
      pathname: args.pathname,
      bodySha256,
    }), "utf8")
    .digest("hex");
  if (!safeEqualHex(signatureMatch[1], expected)) {
    return { ok: false, reason: "signature" };
  }

  return {
    ok: true,
    identity: { workerId, requestNonce: nonce, bodySha256 },
  };
}

export async function authenticatePlatformVerificationWorkerRequest(
  request: Request,
  rawBody: string,
): Promise<VerificationResult> {
  let verification: VerificationResult;
  try {
    const url = new URL(request.url);
    verification = verifyPlatformVerificationWorkerSignature({
      secret: decodeWorkerSecret(process.env.CREATOR_VERIFICATION_WORKER_SECRET_B64),
      workerId: request.headers.get("x-gotall-verification-worker-id"),
      timestamp: request.headers.get("x-gotall-verification-timestamp"),
      nonce: request.headers.get("x-gotall-verification-nonce"),
      signature: request.headers.get("x-gotall-verification-signature"),
      method: request.method,
      pathname: url.pathname,
      search: url.search,
      body: rawBody,
    });
  } catch {
    return { ok: false, reason: "configuration" };
  }
  if (!verification.ok) return verification;

  const requestTimestamp = new Date(
    Number(request.headers.get("x-gotall-verification-timestamp")) * 1_000,
  ).toISOString();
  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase.rpc(
      "consume_creator_platform_verification_worker_request",
      {
        worker_id: verification.identity.workerId,
        request_nonce: verification.identity.requestNonce,
        request_timestamp: requestTimestamp,
        body_sha256: verification.identity.bodySha256,
      },
    );
    if (error) return { ok: false, reason: "backend" };
    if (data !== true) return { ok: false, reason: "replay" };
  } catch {
    return { ok: false, reason: "backend" };
  }

  return verification;
}
