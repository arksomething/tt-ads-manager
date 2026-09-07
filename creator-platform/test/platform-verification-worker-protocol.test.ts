import { createHash, randomBytes, randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  parseVerificationCompletionInput,
  parseVerificationLeaseInput,
  parseVerificationRetryInput,
} from "@/server/platform-verification/protocol";
import {
  signPlatformVerificationWorkerRequest,
  verifyPlatformVerificationWorkerSignature,
} from "@/server/platform-verification/worker-auth";

const workerId = "gotall-verification-worker";

describe("campaign-account verification worker protocol", () => {
  it("signs the exact method, path, nonce, worker, timestamp, and body", () => {
    const secret = randomBytes(32);
    const timestamp = 1_800_000_000;
    const nonce = randomUUID();
    const body = '{"protocolVersion":1}';
    const signature = signPlatformVerificationWorkerRequest({
      secret, timestamp, nonce, workerId, method: "POST",
      pathname: "/api/internal/platform-verification/v1/lease", body,
    });
    expect(verifyPlatformVerificationWorkerSignature({
      secret,
      workerId,
      timestamp: String(timestamp),
      nonce,
      signature,
      method: "POST",
      pathname: "/api/internal/platform-verification/v1/lease",
      search: "",
      body,
      nowSeconds: timestamp,
    })).toMatchObject({ ok: true });
    expect(verifyPlatformVerificationWorkerSignature({
      secret,
      workerId,
      timestamp: String(timestamp),
      nonce,
      signature,
      method: "POST",
      pathname: "/api/internal/platform-verification/v1/complete",
      search: "",
      body,
      nowSeconds: timestamp,
    })).toEqual({ ok: false, reason: "signature" });
  });

  it("accepts only bounded lease and retry vocabularies", () => {
    expect(parseVerificationLeaseInput({
      protocolVersion: 1,
      workerId,
      bootId: randomUUID(),
      maxJobs: 10,
      leaseSeconds: 120,
    })).toMatchObject({ maxJobs: 10, leaseSeconds: 120 });
    expect(parseVerificationRetryInput({
      protocolVersion: 1,
      workerId,
      jobId: randomUUID(),
      leaseToken: randomUUID(),
      failureCode: "provider_unavailable",
      backoffSeconds: 300,
    })).not.toBeNull();
    expect(parseVerificationRetryInput({
      protocolVersion: 1,
      workerId,
      jobId: randomUUID(),
      leaseToken: randomUUID(),
      failureCode: "run_arbitrary_provider_command",
      backoffSeconds: 300,
    })).toBeNull();
  });

  it("requires a stable native ID and hashed bio evidence for machine success", () => {
    const payload = {
      protocolVersion: 1,
      workerId,
      jobId: randomUUID(),
      leaseToken: randomUUID(),
      outcome: "verified",
      nativeAccountId: "stable-native-123",
      codeMatched: true,
      evidenceReference: "provider-response-123",
      observedBioSha256: createHash("sha256").update("bio with GT-CODE").digest("hex"),
      observedAt: "2026-08-31T15:00:00.000Z",
    };
    expect(parseVerificationCompletionInput(payload)).not.toBeNull();
    expect(parseVerificationCompletionInput({ ...payload, codeMatched: false })).toBeNull();
    expect(parseVerificationCompletionInput({ ...payload, observedBioSha256: "raw bio" })).toBeNull();
  });
});
