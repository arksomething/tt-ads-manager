import { createHash, createHmac, randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST as leaseDeliveries } from "@/app/api/internal/discord/v1/lease/route";
import { POST as recordHeartbeat } from "@/app/api/internal/discord/v1/heartbeat/route";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: mocks.rpc,
  }),
}));

const appOrigin = "https://gotall-creator-platform.vercel.app";
const secret = "worker-secret-".padEnd(48, "s");
const workerId = "gotall-xps-discord-worker";

function signedRequest(
  bodyValue: unknown,
  overrides?: { signature?: string; nonce?: string; pathname?: string },
) {
  const pathname = overrides?.pathname ?? "/api/internal/discord/v1/lease";
  const body = JSON.stringify(bodyValue);
  const timestamp = Math.floor(Date.now() / 1_000);
  const nonce = overrides?.nonce ?? randomUUID();
  const bodyHash = createHash("sha256").update(body).digest("hex");
  const canonical = ["v1", timestamp, nonce, workerId, "POST", pathname, bodyHash].join("\n");
  const signature = overrides?.signature
    ?? `v1=${createHmac("sha256", secret).update(canonical).digest("hex")}`;
  return new NextRequest(new URL(pathname, appOrigin), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-GoTall-Worker-Id": workerId,
      "X-GoTall-Worker-Timestamp": String(timestamp),
      "X-GoTall-Worker-Nonce": nonce,
      "X-GoTall-Worker-Signature": signature,
    },
    body,
  });
}

function leaseBody() {
  return {
    workerId,
    bootId: "018f55b0-0ad2-7aa3-8bbc-1f18b6252e7b",
    protocolVersion: 1,
    maxMessages: 10,
    leaseSeconds: 120,
    templateVersions: { "creator.test": 1 },
  };
}

describe("Discord worker internal API", () => {
  beforeEach(() => {
    vi.stubEnv("DISCORD_REMINDER_WORKER_SECRET", secret);
    mocks.rpc.mockReset();
    mocks.rpc.mockImplementation((name: string) => Promise.resolve(
      name === "consume_creator_discord_worker_request"
        ? { data: true, error: null }
        : {
            data: [{
              delivery_id: "018f55b0-0ad2-7aa3-8bbc-1f18b6252e7c",
              lease_token: "018f55b0-0ad2-7aa3-8bbc-1f18b6252e7a",
              attempt_number: 1,
              requires_recovery: false,
              discord_user_id: "571179674323910667",
              template_key: "creator.test",
              template_version: 1,
              variables: {},
              provider_nonce: "test-nonce",
            }],
            error: null,
          },
    ));
  });

  afterEach(() => vi.unstubAllEnvs());

  it("consumes a one-use request nonce before atomically leasing work", async () => {
    const response = (await leaseDeliveries(signedRequest(leaseBody())))!;
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      protocolVersion: 1,
      messages: [{
        discordUserId: "571179674323910667",
        templateKey: "creator.test",
        requiresRecovery: false,
      }],
    });
    expect(mocks.rpc).toHaveBeenNthCalledWith(1, "consume_creator_discord_worker_request", {
      worker_id: workerId,
      request_nonce: expect.stringMatching(/^[0-9a-f-]{36}$/u),
      request_timestamp: expect.any(String),
      body_sha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
    expect(mocks.rpc).toHaveBeenNthCalledWith(2, "claim_creator_notification_deliveries", {
      worker_id: workerId,
      max_messages: 10,
      lease_seconds: 120,
    });
  });

  it("rejects invalid signatures and replayed nonces before leasing", async () => {
    const invalid = (await leaseDeliveries(signedRequest(leaseBody(), {
      signature: `v1=${"0".repeat(64)}`,
    })))!;
    expect(invalid.status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();

    mocks.rpc.mockResolvedValueOnce({ data: false, error: null });
    const replay = (await leaseDeliveries(signedRequest(leaseBody())))!;
    expect(replay.status).toBe(401);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });

  it("reports replay-ledger outages as unavailable instead of bad signatures", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: "42P01" } });

    const response = (await leaseDeliveries(signedRequest(leaseBody())))!;

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Worker authentication is unavailable.",
    });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith("[creator-discord-worker-auth] backend");
  });

  it("persists the worker's closed healthy/degraded heartbeat state", async () => {
    const body = {
      workerId,
      bootId: "018f55b0-0ad2-7aa3-8bbc-1f18b6252e7b",
      protocolVersion: 1,
      workerVersion: "1.1.0",
      status: "degraded",
      observedAt: new Date().toISOString(),
    };
    const response = (await recordHeartbeat(signedRequest(body, {
      pathname: "/api/internal/discord/v1/heartbeat",
    })))!;

    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenNthCalledWith(2, "record_creator_discord_worker_heartbeat", {
      input: expect.objectContaining({
        worker_id: workerId,
        worker_version: "1.1.0",
        status: "degraded",
      }),
    });
  });
});
