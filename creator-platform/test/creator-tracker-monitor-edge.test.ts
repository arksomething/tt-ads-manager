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

function authorizedDelivery(value = delivery()) {
  return {
    authorized: true,
    state: "leased",
    deliveryId: value.delivery_id,
    leaseToken: value.lease_token,
    eventKind: value.event_kind,
    eventPayload: value.event_payload,
    attemptNumber: value.attempt_number,
    authorizedAt: "2030-01-01T12:00:02.000Z",
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
      if (url.endsWith("/rpc/authorize_creator_tracker_monitor_delivery")) {
        return new Response(JSON.stringify(authorizedDelivery()), { status: 200 });
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
    expect(await response.json()).toEqual({
      ok: true,
      leased: 1,
      sent: 1,
      retrying: 0,
      refused: 0,
      authorizationErrors: 0,
    });

    const resendCall = calls.find((call) => call.url === "https://api.resend.com/emails");
    const authorizationIndex = calls.findIndex((call) =>
      call.url.endsWith("/rpc/authorize_creator_tracker_monitor_delivery")
    );
    const resendIndex = calls.findIndex((call) => call.url === "https://api.resend.com/emails");
    const completionIndex = calls.findIndex((call) =>
      call.url.endsWith("/rpc/complete_creator_tracker_monitor_delivery")
    );
    expect(authorizationIndex).toBeGreaterThan(0);
    expect(resendIndex).toBeGreaterThan(authorizationIndex);
    expect(completionIndex).toBeGreaterThan(resendIndex);
    expect(new Headers(resendCall?.init?.headers).get("idempotency-key")).toBe(
      `creator-tracker-monitor/${deliveryId}`,
    );
    const email = JSON.parse(String(resendCall?.init?.body));
    expect(email.subject).toBe("Action needed: reconnect the creator tracker laptop");
    expect(email.text).toContain("What to do now");
    expect(email.text).toContain("powered on and connected to its charger");
    expect(email.text).toContain("Automatic repair cannot run while the laptop is unreachable");
    expect(email.text).not.toContain("backfill");

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
      if (url.endsWith("/rpc/authorize_creator_tracker_monitor_delivery")) {
        return new Response(
          JSON.stringify(authorizedDelivery(delivery("repeat", 3))),
          { status: 200 },
        );
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

  it("renders a quiet, action-first heartbeat reminder", () => {
    const email = renderMonitorEmail("repeat", delivery("repeat").event_payload);
    expect(email.subject).toBe("Reminder: reconnect the creator tracker laptop");
    expect(email.text).toContain("Reconnect it to the internet and leave it awake");
    expect(email.text).not.toMatch(/urgent|still down|recovered|backfill/iu);
  });

  it("explains that automatic runtime repair is exhausted before asking for review", () => {
    const payload = {
      ...delivery().event_payload,
      incidentKind: "runtime_failing",
      lastReceivedAt: "2030-01-01T12:01:59.000Z",
      lastStatus: "failing",
      issueCodes: ["operator_action_required", "autopilot_operator_required"],
    };
    const email = renderMonitorEmail("opened", payload);
    expect(email.subject).toBe("Action needed: review the creator tracker repair");
    expect(email.text).toContain("automated repair exhausted its safe options");
    expect(email.text).toContain("inspect the latest creator-tracker autopilot report");
    expect(email.text).toContain("Approve only the specific production or account action");
    expect(email.text).toContain("operator_action_required");
    expect(email.text).not.toMatch(/urgent|still failing|recovered|backfill/iu);
  });

  it("sends a runtime action request only when the leased evidence has the operator marker", async () => {
    const actionDelivery = delivery("opened");
    actionDelivery.event_payload.incidentKind = "runtime_failing";
    actionDelivery.event_payload.lastStatus = "failing";
    actionDelivery.event_payload.issueCodes = [
      "operator_action_required",
      "autopilot_operator_required",
    ];
    let sentEmail: Record<string, unknown> | undefined;
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/rpc/lease_creator_tracker_monitor_deliveries")) {
        return new Response(JSON.stringify([actionDelivery]), { status: 200 });
      }
      if (url.endsWith("/rpc/authorize_creator_tracker_monitor_delivery")) {
        return new Response(JSON.stringify(authorizedDelivery(actionDelivery)), { status: 200 });
      }
      if (url === "https://api.resend.com/emails") {
        sentEmail = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({ id: "runtime_action_receipt" }), { status: 200 });
      }
      if (url.endsWith("/rpc/complete_creator_tracker_monitor_delivery")) {
        return new Response(JSON.stringify({ accepted: true, state: "sent" }), { status: 200 });
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
    expect(sentEmail?.subject).toBe("Action needed: review the creator tracker repair");
  });

  it("refuses retired recovery deliveries before contacting Resend", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/rpc/lease_creator_tracker_monitor_deliveries")) {
        return new Response(JSON.stringify([delivery("recovered")]), { status: 200 });
      }
      if (url.endsWith("/rpc/authorize_creator_tracker_monitor_delivery")) {
        return new Response(JSON.stringify({
          authorized: false,
          state: "cancelled",
          reasonCode: "delivery_event_retired",
        }), { status: 200 });
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
    expect(await response.json()).toMatchObject({
      ok: true,
      leased: 1,
      sent: 0,
      refused: 1,
      authorizationErrors: 0,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(() => renderMonitorEmail("recovered", delivery("recovered").event_payload))
      .toThrow("MONITOR_DELIVERY_EVENT_UNSUPPORTED");
  });

  it("refuses pre-policy runtime alerts without the explicit operator marker", async () => {
    const prePolicyDelivery = delivery("opened");
    prePolicyDelivery.event_payload.incidentKind = "runtime_failing";
    prePolicyDelivery.event_payload.lastStatus = "failing";
    prePolicyDelivery.event_payload.issueCodes = ["autopilot_incident_confirmed"];
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/rpc/lease_creator_tracker_monitor_deliveries")) {
        return new Response(JSON.stringify([prePolicyDelivery]), { status: 200 });
      }
      if (url.endsWith("/rpc/authorize_creator_tracker_monitor_delivery")) {
        return new Response(JSON.stringify({
          authorized: false,
          state: "cancelled",
          reasonCode: "operator_action_not_required",
        }), { status: 200 });
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
    expect(await response.json()).toMatchObject({
      ok: true,
      leased: 1,
      sent: 0,
      refused: 1,
      authorizationErrors: 0,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("refuses a malformed legacy lease without blocking a valid delivery in the batch", async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith("/rpc/lease_creator_tracker_monitor_deliveries")) {
        return new Response(JSON.stringify([{ legacy: "invalid" }, delivery()]), { status: 200 });
      }
      if (url.endsWith("/rpc/authorize_creator_tracker_monitor_delivery")) {
        return new Response(JSON.stringify(authorizedDelivery()), { status: 200 });
      }
      if (url === "https://api.resend.com/emails") {
        return new Response(JSON.stringify({ id: "valid_batch_receipt" }), { status: 200 });
      }
      if (url.endsWith("/rpc/complete_creator_tracker_monitor_delivery")) {
        expect(JSON.parse(String(init?.body))).toMatchObject({
          target_delivery_id: deliveryId,
          target_lease_token: leaseToken,
        });
        return new Response(JSON.stringify({ accepted: true, state: "sent" }), { status: 200 });
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
    expect(await response.json()).toEqual({
      ok: true,
      leased: 2,
      sent: 1,
      retrying: 0,
      refused: 1,
      authorizationErrors: 0,
    });
    expect(calls.filter((url) => url === "https://api.resend.com/emails")).toHaveLength(1);
  });
});
