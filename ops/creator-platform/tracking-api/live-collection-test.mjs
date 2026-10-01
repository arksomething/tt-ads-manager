import assert from "node:assert/strict";
import { randomBytes, createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
const require = createRequire(new URL("../../../creator-platform/package.json", import.meta.url));
const { createClient } = require("@supabase/supabase-js");
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const [url, native_account_id] = process.argv.slice(2);
if (!url) throw new Error("Pass a real profile/video URL and optional native owner ID. This test uses provider credits.");
const base = "https://gotall-creator-platform.vercel.app/api/tracking/v1";
async function checked(result) { const { data, error } = await result; if (error) throw new Error(error.code); return data; }
const org = await checked(db.from("tracking_organizations").insert({ name: "Temporary live collection verification" }).select("id").single());
const token = `trk_live_${randomBytes(32).toString("hex")}`;
async function api(path, method = "GET", body) {
  const r = await fetch(`${base}/${path}`, { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "Idempotency-Key": randomUUID() }, body: body ? JSON.stringify(body) : undefined });
  const json = await r.json();
  assert.ok(r.ok, `HTTP ${r.status}: ${json.error?.code}`);
  return json;
}
try {
  await checked(db.from("tracking_api_keys").insert({ organization_id: org.id, name: "collection-test", token_hash: createHash("sha256").update(token).digest("hex"), prefix: token.slice(0, 17), scopes: ["tracking:read", "tracking:write"] }));
  const submittedAt = Date.now();
  const submission = await api("subscriptions", "POST", { url, ...(native_account_id ? { native_account_id } : {}) });
  assert.ok(submission.job_id, "Use a target that is due for fresh collection");
  console.log(JSON.stringify({ state: "queued", job_id: submission.job_id }));
  let job;
  for (let attempt = 0; attempt < 40; attempt++) {
    job = (await api(`jobs/${submission.job_id}`)).data;
    if (["succeeded", "failed", "cancelled"].includes(job.state)) break;
    await new Promise(resolve => setTimeout(resolve, 15000));
  }
  assert.equal(job.state, "succeeded", `Collection ended ${job.state}: ${job.error_code}`);
  const videos = (await api(`videos?subscription_id=${submission.data.id}`)).data;
  const fresh = videos.filter(v => v.latest_observation && Date.parse(v.latest_observation.observed_at) >= submittedAt - 5000);
  assert.ok(fresh.length > 0, "At least one fresh observation must be readable");
  for (const video of fresh) {
    assert.equal(video.latest_observation.confidence, "provider");
    assert.ok(video.latest_observation.views === null || video.latest_observation.views >= 0);
    if (native_account_id) assert.equal(video.native_account_id, native_account_id);
  }
  console.log(JSON.stringify({ state: job.state, attempts: job.attempts, fresh_videos: fresh.length, elapsed_seconds: Math.round((Date.now() - submittedAt) / 1000) }));
} finally {
  for (const table of ["tracking_api_keys", "tracking_idempotency", "tracking_subscriptions"]) await checked(db.from(table).delete().eq("organization_id", org.id));
  await checked(db.from("tracking_organizations").delete().eq("id", org.id));
  console.log("Temporary collection client cleaned up.");
}
