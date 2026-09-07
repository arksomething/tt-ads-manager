import { randomBytes, randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST as completeVerification } from "@/app/api/internal/platform-verification/v1/complete/route";
import { POST as leaseVerification } from "@/app/api/internal/platform-verification/v1/lease/route";
import { signPlatformVerificationWorkerRequest } from "@/server/platform-verification/worker-auth";

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ rpc: mocks.rpc }),
}));

const origin = "https://gotall-creator-platform.vercel.app";
const workerId = "gotall-verification-worker";
const secret = randomBytes(32);

function signedRequest(pathname: string, value: unknown) {
  const body = JSON.stringify(value);
  const timestamp = Math.floor(Date.now() / 1_000);
  const nonce = randomUUID();
  const signature = signPlatformVerificationWorkerRequest({
    secret, timestamp, nonce, workerId, method: "POST", pathname, body,
  });
  return new NextRequest(new URL(pathname, origin), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-GoTall-Verification-Worker-Id": workerId,
      "X-GoTall-Verification-Timestamp": String(timestamp),
      "X-GoTall-Verification-Nonce": nonce,
      "X-GoTall-Verification-Signature": signature,
    },
    body,
  });
}

describe("campaign-account verification worker routes", () => {
  beforeEach(() => {
    vi.stubEnv("CREATOR_VERIFICATION_WORKER_SECRET_B64", secret.toString("base64"));
    mocks.rpc.mockReset();
    mocks.rpc.mockImplementation((name: string) => Promise.resolve(
      name === "consume_creator_platform_verification_worker_request"
        ? { data: true, error: null }
        : name === "lease_creator_platform_verification_jobs"
          ? { data: [{ job_id: randomUUID(), lease_token: randomUUID(), bio_code: "GT-ABC12345" }], error: null }
          : { data: [{ accepted: true, final_state: "succeeded", result_code: "verified_machine" }], error: null },
    ));
  });

  afterEach(() => vi.unstubAllEnvs());

  it("consumes a nonce before leasing provider-neutral work", async () => {
    const pathname = "/api/internal/platform-verification/v1/lease";
    const response = (await leaseVerification(signedRequest(pathname, {
      protocolVersion: 1,
      workerId,
      bootId: randomUUID(),
      maxJobs: 5,
      leaseSeconds: 120,
    })))!;
    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenNthCalledWith(1,
      "consume_creator_platform_verification_worker_request",
      expect.objectContaining({ worker_id: workerId }),
    );
    expect(mocks.rpc).toHaveBeenNthCalledWith(2,
      "lease_creator_platform_verification_jobs",
      { worker_id: workerId, requested_max_jobs: 5, requested_lease_seconds: 120 },
    );
  });

  it("passes only validated hashed evidence into fenced completion", async () => {
    const pathname = "/api/internal/platform-verification/v1/complete";
    const jobId = randomUUID();
    const leaseToken = randomUUID();
    const response = (await completeVerification(signedRequest(pathname, {
      protocolVersion: 1,
      workerId,
      jobId,
      leaseToken,
      outcome: "verified",
      nativeAccountId: "native-123",
      codeMatched: true,
      evidenceReference: "provider-response-123",
      observedBioSha256: "a".repeat(64),
      observedAt: "2026-08-31T15:00:00.000Z",
    })))!;
    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenNthCalledWith(2,
      "complete_creator_platform_verification_job",
      {
        target_job_id: jobId,
        target_lease_token: leaseToken,
        result_input: expect.objectContaining({
          outcome: "verified",
          codeMatched: true,
          observedBioSha256: "a".repeat(64),
        }),
      },
    );
  });
});
