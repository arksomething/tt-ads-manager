import { createHash, randomUUID } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/v1/creator-tracker/heartbeat/route";
import {
  CREATOR_TRACKER_MONITOR_HEADERS,
  signCreatorTrackerMonitorRequest,
} from "@/lib/creator-tracker/monitor-auth";
import {
  CREATOR_TRACKER_MONITOR_ID,
  CREATOR_TRACKER_MONITOR_PATH,
  creatorTrackerMonitorHeartbeatSchema,
} from "@/lib/creator-tracker/monitor-contract";

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ rpc: mocks.rpc }),
}));

const now = Date.parse("2030-01-01T12:02:00.000Z");
const secret = "monitor-secret-".padEnd(48, "s");

function heartbeat(status: "healthy" | "degraded" | "failing" = "healthy") {
  return {
    schemaVersion: 1,
    monitorId: CREATOR_TRACKER_MONITOR_ID,
    bootId: randomUUID(),
    sequence: 42,
    observedAt: new Date(now).toISOString(),
    status,
    issueCodes: status === "healthy" ? [] : ["coverage.stale"],
    releaseId: "tracker-20300101-a1b2c3",
  };
}

function signedRequest(payload: unknown, overrides: Record<string, string> = {}) {
  const body = JSON.stringify(payload);
  const timestamp = overrides.timestamp ?? String(Math.floor(now / 1_000));
  const nonce = overrides.nonce ?? randomUUID();
  const monitorId = overrides.monitorId ?? CREATOR_TRACKER_MONITOR_ID;
  const bodySha256 = createHash("sha256").update(body).digest("hex");
  const signature = overrides.signature ?? signCreatorTrackerMonitorRequest({
    secret: Buffer.from(secret),
    timestamp,
    nonce,
    monitorId,
    bodySha256,
  });
  return new Request(`https://creator.example${CREATOR_TRACKER_MONITOR_PATH}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      [CREATOR_TRACKER_MONITOR_HEADERS.id]: monitorId,
      [CREATOR_TRACKER_MONITOR_HEADERS.timestamp]: timestamp,
      [CREATOR_TRACKER_MONITOR_HEADERS.nonce]: nonce,
      [CREATOR_TRACKER_MONITOR_HEADERS.signature]: signature,
    },
    body,
  });
}

describe("creator tracker off-host heartbeat", () => {
  beforeEach(() => {
    vi.stubEnv("CREATOR_TRACKER_MONITOR_SECRET", secret);
    vi.setSystemTime(now);
    mocks.rpc.mockReset();
    mocks.rpc.mockResolvedValue({
      data: {
        monitorId: CREATOR_TRACKER_MONITOR_ID,
        receivedAt: new Date(now).toISOString(),
        replayed: false,
      },
      error: null,
    });
  });

  it.each(["healthy", "degraded", "failing"] as const)(
    "durably accepts %s runtime state as liveness",
    async (status) => {
      const payload = creatorTrackerMonitorHeartbeatSchema.parse(heartbeat(status));
      const response = await POST(signedRequest(payload));
      expect(response.status).toBe(201);
      expect(await response.json()).toMatchObject({
        ok: true,
        accepted: true,
        monitorId: CREATOR_TRACKER_MONITOR_ID,
        replayed: false,
      });
      expect(mocks.rpc).toHaveBeenCalledWith(
        "record_creator_tracker_monitor_heartbeat",
        expect.objectContaining({ heartbeat_input: payload }),
      );
    },
  );

  it("binds the exact body, monitor, nonce, timestamp, method, and path", async () => {
    const request = signedRequest(heartbeat(), { signature: `v1=${"0".repeat(64)}` });
    const response = await POST(request);
    expect(response.status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("rejects stale requests and header/body identity mismatch", async () => {
    expect((await POST(signedRequest(heartbeat(), {
      timestamp: String(Math.floor(now / 1_000) - 301),
    }))).status).toBe(401);

    const wrongBody = { ...heartbeat(), monitorId: "creator-tracker-other" };
    expect((await POST(signedRequest(wrongBody))).status).toBe(422);

  });

  it("returns the original durable receipt for an exact retry after ACK loss", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: {
        monitorId: CREATOR_TRACKER_MONITOR_ID,
        receivedAt: new Date(now).toISOString(),
        replayed: true,
      },
      error: null,
    });
    const response = await POST(signedRequest(heartbeat()));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ accepted: true, replayed: true });
  });

  it("rejects unknown fields and does not turn an invalid payload into liveness", async () => {
    const response = await POST(signedRequest({ ...heartbeat(), surprise: true }));
    expect(response.status).toBe(422);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
