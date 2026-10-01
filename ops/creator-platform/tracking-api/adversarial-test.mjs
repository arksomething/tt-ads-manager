import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
const require = createRequire(new URL("../../../creator-platform/package.json", import.meta.url));
const { Pool } = require("pg");
const pool = new Pool({ max: 20 });
let checks = 0;
const query = (sql, params = []) => pool.query(sql, params);
async function rpc(name, args) {
  const r = await query(`select ${name}(${args.map((_, i) => `$${i + 1}`).join(",")}) as result`, args);
  return r.rows[0].result;
}
function check(value, message) { assert.ok(value, message); checks++; }
async function org(limit = 100, rate = 120) {
  return (await query("insert into tracking_organizations(name,subscription_limit,requests_per_minute) values('Adversarial',$1,$2) returning id", [limit, rate])).rows[0].id;
}
function target(identity) { return { platform: "tiktok", kind: "video", identity, url: `https://www.tiktok.com/@test/video/${identity}` }; }
const subscribe = (o, identity, key = randomUUID()) => rpc("tracking_mutate", [o, "subscribe", target(identity), key, identity]);
try {
  const a = await org(3);
  const quota = await Promise.all(Array.from({ length: 20 }, (_, i) => subscribe(a, String(1000 + i))));
  check(quota.filter(r => !r.error).length === 3, "Concurrent quota must accept exactly three");
  check(quota.filter(r => r.error === "SUBSCRIPTION_LIMIT").length === 17, "Concurrent quota rejects excess");
  const b = await org();
  const replay = await Promise.all(Array.from({ length: 20 }, () => subscribe(b, "2000", "same-key")));
  check(new Set(replay.map(r => r.subscription.id)).size === 1, "Concurrent replay has one subscription");
  check(new Set(replay.map(r => r.job_id)).size === 1, "Concurrent replay has one job");
  check(replay.filter(r => r.replayed).length === 19, "Exactly one initial mutation");
  const organizations = await Promise.all(Array.from({ length: 10 }, () => org()));
  const shared = await Promise.all(organizations.map(o => subscribe(o, "3000")));
  check(shared.every(r => !r.error), "Concurrent cross-tenant dedup does not fail");
  check(new Set(shared.map(r => r.job_id)).size === 1, "Shared target has one pending job");
  check(new Set(shared.map(r => r.subscription.id)).size === 10, "Subscriptions stay per tenant");
  const rateOrg = await org(100, 7);
  const hash = "d".repeat(64);
  await query("insert into tracking_api_keys(organization_id,name,token_hash,prefix,scopes) values($1,'rate',$2,'test',array['tracking:read'])", [rateOrg, hash]);
  const rate = await Promise.all(Array.from({ length: 20 }, () => rpc("tracking_authenticate", [hash])));
  check(rate.filter(r => !r.error).length === 7, "Atomic rate limit allows exactly seven");
  check(rate.filter(r => r.error === "RATE_LIMITED").length === 13, "Atomic rate limit rejects thirteen");
  // Isolate worker recovery from the preceding queued fixture jobs.
  await query("update tracking_subscriptions set state='paused'");
  const w = "e".repeat(64);
  await query("insert into tracking_worker_keys(token_hash,name) values($1,'adversarial')", [w]);
  const owner = await org();
  const sub = await subscribe(owner, "4000");
  const leases = await Promise.all(Array.from({ length: 10 }, () => rpc("tracking_worker_lease", [w])));
  check(leases.filter(r => r.job).length === 1, "Concurrent workers lease only once");
  const first = leases.find(r => r.job).job;
  await query("update tracking_jobs set lease_expires_at=now()-interval '1 second' where id=$1", [first.id]);
  check((await rpc("tracking_worker_complete", [w, first.id, first.lease_token, { error_code: "TEST_FAILURE" }])).error === "LEASE_CONFLICT", "Expired completion rejected before reaping");
  const second = (await rpc("tracking_worker_lease", [w])).job;
  check(second.id === first.id && second.lease_token !== first.lease_token, "Expired job re-leased with fresh fencing token");
  check((await rpc("tracking_worker_complete", [w, first.id, first.lease_token, {}])).error === "LEASE_CONFLICT", "Old worker fenced after reassignment");
  await query("update tracking_jobs set lease_expires_at=now()-interval '1 second' where id=$1", [first.id]);
  const third = (await rpc("tracking_worker_lease", [w])).job;
  check(third.id === first.id, "Third attempt granted");
  await query("update tracking_jobs set lease_expires_at=now()-interval '1 second' where id=$1", [first.id]);
  check((await rpc("tracking_worker_lease", [w])).job === null, "Exhausted job not immediately requeued");
  const failed = (await query("select state,attempts from tracking_jobs where id=$1", [first.id])).rows[0];
  check(failed.state === "failed" && failed.attempts === 3, "Crashed job visibly fails after three attempts");
  await query("update tracking_targets set next_collection_at=now()-interval '1 second' where id=$1", [sub.subscription.target_id]);
  const retry = (await rpc("tracking_worker_lease", [w])).job;
  check(retry.id !== first.id, "Scheduled recovery creates new job");
  await rpc("tracking_worker_complete", [w, retry.id, retry.lease_token, { error_code: "CREDIT_BLOCKED", blocked: true }]);
  const blocked = (await query("select collection_state,consecutive_failures,next_collection_at>now()+interval '29 minutes' as backed_off from tracking_targets where id=$1", [sub.subscription.target_id])).rows[0];
  check(blocked.collection_state === "blocked" && blocked.consecutive_failures === 1 && blocked.backed_off, "Provider failure preserves blocked state and backoff");
  check((await query("select count(*)::int n from tracking_observations o join tracking_target_videos tv on tv.video_id=o.video_id where tv.target_id=$1", [sub.subscription.target_id])).rows[0].n === 0, "Failed collection creates no fake zero observations");
  await rpc("tracking_mutate", [owner, "delete", { id: sub.subscription.id }, null, null]);
  check((await rpc("tracking_worker_lease", [w])).job === null, "Deleted target not scheduled");
  const metricSub = await subscribe(owner, "5000");
  const metricLease = (await rpc("tracking_worker_lease", [w])).job;
  const item = { native_video_id: "5000", native_account_id: "owner-5000", url: target("5000").url, caption: "test", published_at: null, observed_at: new Date().toISOString(), source: "scrapecreators_tiktok", views: 100, likes: null, comments: 0, shares: null, saves: null };
  await rpc("tracking_worker_complete", [w, metricLease.id, metricLease.lease_token, { coverage: "complete", videos: [item] }]);
  const metricVideo = (await rpc("tracking_read", [owner, "videos"])).data[0];
  check(metricVideo.latest_observation.views === 100 && metricVideo.latest_observation.likes === null && metricVideo.latest_observation.comments === 0, "Null and measured zero remain distinct");
  await query("update tracking_targets set next_collection_at=now()-interval '1 second' where id=$1", [metricSub.subscription.target_id]);
  const regressionLease = (await rpc("tracking_worker_lease", [w])).job;
  await rpc("tracking_worker_complete", [w, regressionLease.id, regressionLease.lease_token, { coverage: "complete", videos: [{ ...item, views: 50, observed_at: new Date(Date.now() + 1000).toISOString() }] }]);
  const regression = (await rpc("tracking_read", [owner, "videos"])).data[0];
  check(regression.latest_observation.counter_regression === true && regression.latest_observation.views === 50, "Counter regression retained and flagged");
  check((await query("select count(*)::int n from tracking_observations where video_id=$1", [metricVideo.id])).rows[0].n === 2, "New observations append without overwriting history");
  await query("update tracking_targets set next_collection_at=now()-interval '1 second' where id=$1", [metricSub.subscription.target_id]);
  const wrongOwner = (await rpc("tracking_worker_lease", [w])).job;
  await assert.rejects(rpc("tracking_worker_complete", [w, wrongOwner.id, wrongOwner.lease_token, { coverage: "complete", videos: [{ ...item, native_account_id: "different-owner" }] }]), /IDENTITY_CONFLICT/);
  checks++;
  check((await query("select count(*)::int n from tracking_observations where video_id=$1", [metricVideo.id])).rows[0].n === 2, "Rejected owner produces no partial observation write");
  await rpc("tracking_worker_complete", [w, wrongOwner.id, wrongOwner.lease_token, { coverage: "empty_unconfirmed", videos: [] }]);
  check((await query("select count(*)::int n from tracking_observations where video_id=$1", [metricVideo.id])).rows[0].n === 2, "Empty result does not manufacture zeros");
  check((await query("select coverage from tracking_targets where id=$1", [metricSub.subscription.target_id])).rows[0].coverage === "empty_unconfirmed", "Empty inventory remains unconfirmed");
  console.log(JSON.stringify({ passed: checks, suite: "PostgreSQL concurrency and recovery" }));
} finally { await pool.end(); }
