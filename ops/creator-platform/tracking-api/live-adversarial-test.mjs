import assert from "node:assert/strict";
import { randomBytes, createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
const require = createRequire(new URL("../../../creator-platform/package.json", import.meta.url));
const { createClient } = require("@supabase/supabase-js");
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const base = "https://gotall-creator-platform.vercel.app/api/tracking/v1";
const organizations = [];
let checks = 0;
function check(value, message) { assert.ok(value, message); checks++; }
async function checked(result) { const { data, error } = await result; if (error) throw new Error(error.code); return data; }
async function client() {
  const o = await checked(db.from("tracking_organizations").insert({ name: "Temporary adversarial verification", requests_per_minute: 1000 }).select("id").single());
  organizations.push(o.id);
  const token = `trk_live_${randomBytes(32).toString("hex")}`;
  await checked(db.from("tracking_api_keys").insert({ organization_id: o.id, name: "test", token_hash: createHash("sha256").update(token).digest("hex"), prefix: token.slice(0, 17), scopes: ["tracking:read", "tracking:write", "keys:manage"] }));
  return { id: o.id, token };
}
async function api(path, token, method = "GET", body, extra = {}) {
  const r = await fetch(`${base}/${path}`, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": "application/json", ...extra }, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) });
  const data = await r.json();
  return { status: r.status, data, headers: r.headers };
}
try {
  const a = await client(); const b = await client();
  for (const token of [undefined, "bad", `trk_live_${"0".repeat(64)}`, `trk_worker_${"0".repeat(64)}`]) {
    const r = await api("organization", token);
    check(r.status === 401 && r.headers.get("www-authenticate") === "Bearer", "Unauthorized token rejected");
    check(r.headers.get("cache-control").includes("no-store") && r.data.error.request_id === r.headers.get("x-request-id"), "Errors are uncached and correlated");
  }
  for (const [body, headers, status] of [
    ["{", {}, 400],
    [{ url: "http://127.0.0.1/" }, {}, 422],
    [{ url: "https://www.tiktok.com.evil.test/@x" }, {}, 422],
    [{ url: "https://www.tiktok.com/@x", organization_id: b.id }, {}, 422],
    [{ url: "https://www.instagram.com/example/" }, {}, 422],
    [{ url: "https://www.tiktok.com/@x" }, { "Content-Type": "text/plain" }, 415],
    [{ url: "https://www.tiktok.com/@x" }, { "Idempotency-Key": "bad key" }, 400],
    [{ url: "https://www.tiktok.com/@x", metadata: { long: "x".repeat(501) } }, {}, 422],
    ["x".repeat(65537), {}, 413],
  ]) {
    const r = await api("subscriptions", a.token, "POST", body, headers);
    check(r.status === status, `Invalid request expected ${status}, received ${r.status}`);
  }
  for (const query of ["limit=0", "limit=101", "limit=1&limit=2", "after=bad", `organization_id=${b.id}`]) {
    check((await api(`videos?${query}`, a.token)).status === 400, "Malformed query rejected");
  }
  const ro = await api("keys", a.token, "POST", { name: "Read manager", scopes: ["tracking:read", "keys:manage"] });
  check(ro.status === 201, "Scoped key created");
  const readToken = ro.data.data.token;
  check((await api("organization", readToken)).status === 200, "Scoped read works");
  check((await api("subscriptions", readToken, "POST", {})).status === 403, "Read key cannot submit");
  check((await api("keys", readToken, "POST", { name: "Escalation", scopes: ["tracking:write"] })).status === 403, "Key manager cannot escalate");
  check((await api(`keys/${ro.data.data.id}`, b.token, "DELETE")).status === 404, "Foreign key cannot be revoked");
  const keyList = await api("keys", a.token);
  check(!JSON.stringify(keyList.data).includes(readToken) && !JSON.stringify(keyList.data).includes("token_hash"), "Key list does not leak credentials");
  await api(`keys/${ro.data.data.id}`, a.token, "DELETE");
  check((await api("organization", readToken)).status === 401, "Revocation effective");
  // Reuse a freshly collected real video: no synthetic provider requests.
  const input = { url: "https://www.tiktok.com/@imogg3d/video/7684403605973011743", metadata: { private_note: "tenant-a-only" } };
  const responses = await Promise.all(Array.from({ length: 12 }, () => api("subscriptions", a.token, "POST", input, { "Idempotency-Key": "concurrent-live-test" })));
  check(responses.every(r => r.status === 202), "Concurrent live submissions accepted");
  check(new Set(responses.map(r => r.data.data.id)).size === 1, "Concurrent live replay returns one subscription");
  check(responses.filter(r => r.data.replayed).length === 11, "Concurrent live idempotency exact");
  const sid = responses[0].data.data.id;
  check((await api("subscriptions", a.token, "POST", { ...input, metadata: {} }, { "Idempotency-Key": "concurrent-live-test" })).status === 409, "Changed replay rejected");
  check((await api(`subscriptions/${sid}`, b.token)).status === 404, "Foreign subscription hidden");
  check((await api(`subscriptions/${sid}`, b.token, "PATCH", { state: "paused" })).status === 404, "Foreign subscription immutable");
  const videos = await api(`videos?subscription_id=${sid}`, a.token);
  check(videos.status === 200 && videos.data.data.length === 1, "Existing video readable immediately");
  const vid = videos.data.data[0].id;
  check((await api(`videos/${vid}`, b.token)).status === 404, "Foreign video hidden");
  check((await api(`videos/${vid}/observations`, b.token)).status === 404, "Foreign history hidden");
  check((await api(`videos?subscription_id=${sid}`, b.token)).status === 404, "Foreign filter hidden");
  let after = null; const ids = new Set(); let pages = 0;
  do {
    const r = await api(`videos/${vid}/observations?limit=1${after ? `&after=${after}` : ""}`, a.token);
    check(r.status === 200 && r.data.data.length <= 1, "History page bounded");
    for (const row of r.data.data) { check(!ids.has(row.id) && !("evidence_key" in row), "History unique and private fields removed"); ids.add(row.id); }
    after = r.data.next_cursor; pages++;
  } while (after && pages < 100);
  check(!after && ids.size > 0, "History pagination terminates");
  await api(`subscriptions/${sid}`, a.token, "PATCH", { state: "paused" });
  check((await api(`videos/${vid}`, a.token)).status === 200, "Paused subscription retains read access");
  check((await api(`subscriptions/${sid}/refreshes`, a.token, "POST", undefined, { "Idempotency-Key": randomUUID() })).status === 409, "Paused refresh blocked");
  await api(`subscriptions/${sid}`, a.token, "DELETE");
  check((await api(`videos/${vid}`, a.token)).status === 404, "Deletion removes video entitlement");
  await checked(db.from("tracking_organizations").update({ requests_per_minute: 5, rate_count: 0, rate_window: new Date().toISOString() }).eq("id", b.id));
  const rates = await Promise.all(Array.from({ length: 12 }, () => api("organization", b.token)));
  check(rates.filter(r => r.status === 200).length === 5, "Live concurrent rate limit allows five");
  check(rates.filter(r => r.status === 429).length === 7, "Live concurrent rate limit rejects seven");
  check(rates.filter(r => r.status === 429).every(r => Number(r.headers.get("retry-after")) > 0), "Rate rejection includes Retry-After");
  console.log(JSON.stringify({ suite: "Production HTTP adversarial checks", passed: checks, history_records: ids.size }));
} finally {
  for (const id of organizations) {
    for (const table of ["tracking_api_keys", "tracking_idempotency", "tracking_subscriptions"]) await checked(db.from(table).delete().eq("organization_id", id));
    await checked(db.from("tracking_organizations").delete().eq("id", id));
  }
  console.log("Temporary test organizations cleaned up.");
}
