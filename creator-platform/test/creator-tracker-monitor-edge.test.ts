import { webcrypto } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  createMonitorTickHandler,
  renderMonitorEmail,
} from "../supabase/functions/creator-tracker-monitor-tick/runtime.mjs";

const deliveryId = "123e4567-e89b-42d3-a456-426614174000";
const leaseToken = "223e4567-e89b-42d3-a456-426614174000";
const environment = {
  SUPABASE_URL: "https://database.example",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key".padEnd(48, "s"),
  CREATOR_TRACKER_MONITOR_TICK_SECRET: "tick-secret".padEnd(48, "t"),
  RESEND_API_KEY: "re_test_key".padEnd(32, "r"),
  CREATOR_TRACKER_MONITOR_EMAIL_FROM: "GoTall Monitor <monitor@example.com>",
  CREATOR_TRACKER_MONITOR_EMAIL_TO: "owner@example.com",
};

function delivery(eventKind = "opened", attemptNumber = 1) {
  return {
    delivery_id: deliveryId,
    lease_token: leaseToken,
    event_kind: eventKind,
    event_payload: {
      schemaVersion: 1,
      monitorId: "creator-tracker-xps",
      incidentKind: "heartbeat_stale",
      eventKind,
      outageStartedAt: "2030-01-01T12:00:00.000Z",
      incidentOpenedAt: "2030-01-01T12:00:01.000Z",
      lastReceivedAt: "2030-01-01T11:55:00.000Z",
      recoveredAt: "2030-01-01T12:06:00.000Z",
      lastStatus: "degraded",
      issueCodes: ["coverage.stale"],
      releaseId: "tracker-a1b2c3",
    },
    attempt_number: attemptNumber,
  };
}

function tickRequest(secret = environment.CREATOR_TRACKER_MONITOR_TICK_SECRET) {
  return new Request(
    "https://project.supabase.co/functions/v1/creator-tracker-monitor-tick",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-gotall-monitor-tick-secret": secret,
      },
      body: JSON.stringify({ schemaVersion: 1 }),
    },
  );
}

describe("creator tracker monitor Edge Function", () => {
  it("leases the durable outbox, sends through Resend, and records a receipt", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.endsWith("/rpc/lease_creator_tracker_monitor_deliveries")) {
        return new Response(JSON.stringify([delivery()]), { status: 200 });
      }
      if (url === "https://api.resend.com/emails") {
        return new Response(JSON.stringify({ id: "email_receipt_1" }), { status: 200 });
      }
      if (url.endsWith("/rpc/complete_creator_tracker_monitor_delivery")) {
        return new Response(JSON.stringify({ accepted: true, state: "sent" }), {
          status: 200,
        });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
    const handler = createMonitorTickHandler({
      environment,
      fetchImpl,
      cryptoImpl: webcrypto as unknown as Crypto,
    });

    const response = await handler(tickRequest());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, leased: 1, sent: 1, retrying: 0 });

    const resendCall = calls.find((call) => call.url === "https://api.resend.com/emails");
    expect(new Headers(resendCall?.init?.headers).get("idempotency-key")).toBe(
      `creator-tracker-monitor/${deliveryId}`,
    );
    const email = JSON.parse(String(resendCall?.init?.body));
    expect(email.subject).toContain("Urgent");
    expect(email.text).toContain("does not prove whether creator data was missed");

    const completionCall = calls.find((call) =>
      call.url.endsWith("/rpc/complete_creator_tracker_monitor_delivery"),
    );
    expect(JSON.parse(String(completionCall?.init?.body))).toMatchObject({
      target_delivery_id: deliveryId,
      target_lease_token: leaseToken,
      result_input: {
        outcome: "sent",
        providerStatus: 200,
        providerMessageId: "email_receipt_1",
      },
    });
  });

  it("keeps provider failures in durable retry with bounded backoff", async () => {
    let completionBody: Record<string, unknown> | undefined;
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/rpc/lease_creator_tracker_monitor_deliveries")) {
        return new Response(JSON.stringify([delivery("repeat", 3)]), { status: 200 });
      }
      if (url === "https://api.resend.com/emails") {
        return new Response("temporarily unavailable", { status: 503 });
      }
      if (url.endsWith("/rpc/complete_creator_tracker_monitor_delivery")) {
        completionBody = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({ accepted: true, state: "retry" }), {
          status: 200,
        });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
    const handler = createMonitorTickHandler({
      environment,
      fetchImpl,
      cryptoImpl: webcrypto as unknown as Crypto,
    });

    const response = await handler(tickRequest());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ sent: 0, retrying: 1 });
    expect(completionBody).toMatchObject({
      result_input: {
        outcome: "retry",
        providerStatus: 503,
        errorCode: "resend_unavailable",
        retryAfterSeconds: 300,
      },
    });
  });

  it("rejects an invalid tick secret before leasing anything", async () => {
    const fetchImpl = vi.fn();
    const handler = createMonitorTickHandler({
      environment,
      fetchImpl,
      cryptoImpl: webcrypto as unknown as Crypto,
    });
    const response = await handler(tickRequest("wrong-secret"));
    expect(response.status).toBe(401);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("renders a distinct recovery notification", () => {
    const email = renderMonitorEmail("recovered", delivery("recovered").event_payload);
    expect(email.subject).toContain("Recovered");
    expect(email.text).toContain("heartbeat restored");
    expect(email.text).toContain("2030-01-01T12:06:00.000Z");
  });

  it("distinguishes a live runtime failure from a missing heartbeat", () => {
    const payload = {
      ...delivery().event_payload,
      incidentKind: "runtime_failing",
      lastReceivedAt: "2030-01-01T12:01:59.000Z",
      lastStatus: "failing",
    };
    const email = renderMonitorEmail("opened", payload);
    expect(email.subject).toContain("runtime failure");
    expect(email.text).toContain("laptop is checking in");
    expect(email.text).toContain("live tracker failure");
  });
});
