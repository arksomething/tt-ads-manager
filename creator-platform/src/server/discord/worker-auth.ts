import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";

const maximumClockSkewSeconds = 300;
const workerIdPattern = /^[a-z0-9][a-z0-9._-]{2,63}$/u;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const signaturePattern = /^v1=([a-f0-9]{64})$/u;

export type DiscordWorkerIdentity = {
  workerId: string;
  requestNonce: string;
  bodySha256: string;
};

type VerificationResult =
  | { ok: true; identity: DiscordWorkerIdentity }
  | {
      ok: false;
      reason:
        | "worker_id"
        | "nonce"
        | "timestamp"
        | "clock_skew"
        | "signature"
        | "configuration"
        | "replay"
        | "backend";
    };

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function safeEqualHex(left: string, right: string) {
  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function workerSecret() {
  const secret = process.env.DISCORD_REMINDER_WORKER_SECRET?.trim();
  if (!secret || Buffer.byteLength(secret, "utf8") < 32) {
    throw new Error("Discord reminder worker authentication is not configured.");
  }
  return secret;
}

export function verifyDiscordWorkerSignature(args: {
  secret: string;
  workerId: string | null;
  timestamp: string | null;
  nonce: string | null;
  signature: string | null;
  method: string;
  pathname: string;
  body: string;
  nowSeconds?: number;
}): VerificationResult {
  const workerId = args.workerId?.trim() ?? "";
  const nonce = args.nonce?.trim() ?? "";
  const timestampNumber = Number(args.timestamp);
  const signatureMatch = args.signature?.match(signaturePattern);
  const nowSeconds = args.nowSeconds ?? Math.floor(Date.now() / 1_000);

  if (!workerIdPattern.test(workerId)) return { ok: false, reason: "worker_id" };
  if (!uuidPattern.test(nonce)) return { ok: false, reason: "nonce" };
  if (!Number.isSafeInteger(timestampNumber)) return { ok: false, reason: "timestamp" };
  if (Math.abs(nowSeconds - timestampNumber) > maximumClockSkewSeconds) {
    return { ok: false, reason: "clock_skew" };
  }
  if (!signatureMatch) return { ok: false, reason: "signature" };

  const bodySha256 = sha256(args.body);
  const canonical = [
    "v1",
    String(timestampNumber),
    nonce,
    workerId,
    args.method.toUpperCase(),
    args.pathname,
    bodySha256,
  ].join("\n");
  const expected = createHmac("sha256", args.secret).update(canonical).digest("hex");

  if (!safeEqualHex(signatureMatch[1], expected)) {
    return { ok: false, reason: "signature" };
  }

  return {
    ok: true,
    identity: { workerId, requestNonce: nonce.toLowerCase(), bodySha256 },
  };
}

export async function authenticateDiscordWorkerRequest(
  request: NextRequest,
  rawBody: string,
): Promise<VerificationResult> {
  let verification: VerificationResult;
  try {
    verification = verifyDiscordWorkerSignature({
      secret: workerSecret(),
      workerId: request.headers.get("x-gotall-worker-id"),
      timestamp: request.headers.get("x-gotall-worker-timestamp"),
      nonce: request.headers.get("x-gotall-worker-nonce"),
      signature: request.headers.get("x-gotall-worker-signature"),
      method: request.method,
      pathname: request.nextUrl.pathname,
      body: rawBody,
    });
  } catch {
    return { ok: false, reason: "configuration" };
  }

  if (!verification.ok) return verification;

  const timestamp = new Date(
    Number(request.headers.get("x-gotall-worker-timestamp")) * 1_000,
  );
  let error: { code?: string } | null = null;
  let consumed = false;
  try {
    const supabase = createAdminClient();
    const result = await supabase.rpc("consume_creator_discord_worker_request", {
      worker_id: verification.identity.workerId,
      request_nonce: verification.identity.requestNonce,
      request_timestamp: timestamp.toISOString(),
      body_sha256: verification.identity.bodySha256,
    });
    error = result.error;
    consumed = result.data === true;
  } catch {
    return { ok: false, reason: "backend" };
  }

  if (error) return { ok: false, reason: "backend" };
  if (!consumed) return { ok: false, reason: "replay" };
  return verification;
}
