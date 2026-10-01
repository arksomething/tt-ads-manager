// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { handleTrackingApi, handleTrackingWorker } from "@/server/tracking-api/handler";
import { hashToken, newApiKey, normalizeTarget, parsePage, subscriptionInput } from "@/server/tracking-api/contract";
import { trackingOpenApi } from "@/server/tracking-api/openapi";
const org = "00000000-0000-4000-8000-000000000001";
const subscription = "00000000-0000-4000-8000-000000000002";
const token = `trk_live_${"a".repeat(64)}`;
const auth = { organization_id: org, key_id: subscription, scopes: ["tracking:read", "tracking:write"], limit: 120, remaining: 119, reset_at: "2026-09-12T00:01:00Z" };
function setup(results: unknown[] = [], authorization = auth) {
  const rpc = vi.fn().mockResolvedValueOnce({ data: authorization, error: null });
  for (const data of results) rpc.mockResolvedValueOnce({ data, error: null });
  const factory = vi.fn(() => ({ rpc })) as unknown as Parameters<typeof handleTrackingApi>[2];
  return { rpc, factory };
}
function request(path: string, method = "GET", input?: unknown, extra: Record<string, string> = {}) {
  return new Request(`https://example.test/api/tracking/v1/${path}`, { method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...extra }, body: input === undefined ? undefined : JSON.stringify(input) });
}

describe("tracking API", () => {
  it("rejects missing credentials before creating a database client", async () => {
    const { factory } = setup();
    expect((await handleTrackingApi(new Request("https://example.test"), ["videos"], factory)).status).toBe(401);
    expect(factory).not.toHaveBeenCalled();
  });
  it("authenticates a hash, never the bearer token, and forces organization scoping", async () => {
    const { rpc, factory } = setup([{ data: [] }]);
    const response = await handleTrackingApi(request("videos"), ["videos"], factory);
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenNthCalledWith(1, "tracking_authenticate", { p_hash: hashToken(token) });
    expect(rpc).toHaveBeenNthCalledWith(2, "tracking_read", expect.objectContaining({ p_org: org, p_resource: "videos" }));
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
  it("does not allow callers to supply an organization in query or body", async () => {
    const { factory } = setup();
    expect((await handleTrackingApi(request("videos?organization_id=other"), ["videos"], factory)).status).toBe(400);
    const second = setup();
    expect((await handleTrackingApi(request("subscriptions", "POST", { url: "https://www.tiktok.com/@example", organization_id: org }, { "idempotency-key": "test" }), ["subscriptions"], second.factory)).status).toBe(422);
  });
  it("blocks writes with a read-only key", async () => {
    const { rpc, factory } = setup([], { ...auth, scopes: ["tracking:read"] });
    expect((await handleTrackingApi(request("subscriptions", "POST", {}), ["subscriptions"], factory)).status).toBe(403);
    expect(rpc).toHaveBeenCalledTimes(1);
  });
  it("requires idempotency for submissions", async () => {
    const { rpc, factory } = setup();
    const response = await handleTrackingApi(request("subscriptions", "POST", { url: "https://www.tiktok.com/@example" }), ["subscriptions"], factory);
    expect(response.status).toBe(400);
    expect(rpc).toHaveBeenCalledTimes(1);
  });
  it("submits canonical targets and strips internal identity from the response", async () => {
    const { rpc, factory } = setup([{ subscription: { id: subscription, organization_id: org, target_id: "private", state: "active" }, job_id: org, replayed: false }]);
    const response = await handleTrackingApi(request("subscriptions", "POST", { url: "https://tiktok.com/@EXAMPLE?share=1", metadata: { campaign: "launch" } }, { "idempotency-key": "client-1" }), ["subscriptions"], factory);
    expect(response.status).toBe(202);
    expect(rpc).toHaveBeenNthCalledWith(2, "tracking_mutate", expect.objectContaining({ p_org: org, p_operation: "subscribe", p_input: expect.objectContaining({ url: "https://www.tiktok.com/@example", identity: "example" }) }));
    expect(await response.json()).toEqual({ data: { id: subscription, state: "active" }, job_id: org, replayed: false });
  });
  it("returns a continuation cursor without returning the extra row", async () => {
    const { factory } = setup([{ data: [{ id: org }, { id: subscription }] }]);
    const response = await handleTrackingApi(request("videos?limit=1"), ["videos"], factory);
    expect(await response.json()).toEqual({ data: [{ id: org }], next_cursor: org });
  });
  it("preserves null metrics and reports inaccessible objects as not found", async () => {
    const { factory } = setup([{ data: [{ id: org, latest_observation: { views: null, likes: 0 } }] }]);
    const response = await handleTrackingApi(request(`videos/${org}`), ["videos", org], factory);
    expect((await response.json()).data.latest_observation).toEqual({ views: null, likes: 0 });
    const missing = setup([{ data: [] }]);
    expect((await handleTrackingApi(request(`videos/${org}`), ["videos", org], missing.factory)).status).toBe(404);
  });
  it("provides retry timing for throttled organizations", async () => {
    const { factory } = setup([], { error: "RATE_LIMITED", retry_after: 17 } as unknown as typeof auth);
    const response = await handleTrackingApi(request("videos"), ["videos"], factory);
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("17");
  });
  it("does not expose database error messages", async () => {
    const rpc = vi.fn().mockResolvedValue({ error: { message: "secret connection data" }, data: null });
    const response = await handleTrackingApi(request("videos"), ["videos"], (() => ({ rpc })) as unknown as Parameters<typeof handleTrackingApi>[2]);
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("secret connection data");
  });
  it("client API keys cannot authenticate a worker", async () => {
    const { factory } = setup();
    expect((await handleTrackingWorker(request("lease", "POST", {}), "lease", factory)).status).toBe(401);
    expect(factory).not.toHaveBeenCalled();
  });
});

describe("tracking target contract", () => {
  it.each(["http://www.tiktok.com/@example", "https://tiktok.com.evil.test/@example", "https://user:secret@tiktok.com/@example", "https://127.0.0.1/video", "https://vm.tiktok.com/abc", "https://instagram.com/accounts/"])("rejects unsafe or unsupported URL %s", (url) => {
    expect(() => normalizeTarget(subscriptionInput.parse({ url }))).toThrow();
  });
  it("preserves Instagram shortcode case and requires owner identity", () => {
    expect(() => normalizeTarget(subscriptionInput.parse({ url: "https://instagram.com/reel/ABCde/" }))).toThrow("numeric owner");
    expect(normalizeTarget(subscriptionInput.parse({ url: "https://instagram.com/p/ABCde/", native_account_id: "123" }))).toMatchObject({ identity: "ABCde", url: "https://www.instagram.com/reel/ABCde/" });
  });
  it.each(["limit=0", "limit=101", "limit=2&limit=3", "after=not-a-uuid", "limit=1e2"])("rejects malformed pagination %s", (query) => {
    expect(() => parsePage(new URL(`https://example.test/?${query}`))).toThrow();
  });
  it("creates independent high-entropy keys and stores only hashes", () => {
    const first = newApiKey();
    expect(first.token).toMatch(/^trk_live_[a-f0-9]{64}$/);
    expect(first.token_hash).toBe(hashToken(first.token));
    expect(newApiKey().token).not.toBe(first.token);
  });
  it("publishes all client workflows with schemas and authentication", () => {
    expect(trackingOpenApi.paths["/subscriptions"].post.responses["202"]).toBeDefined();
    expect(trackingOpenApi.paths["/videos/{id}/observations"].get.operationId).toBe("listObservations");
    expect(trackingOpenApi.security).toEqual([{ ApiKey: [] }]);
    expect(JSON.stringify(trackingOpenApi)).not.toContain("service_role");
  });
});
