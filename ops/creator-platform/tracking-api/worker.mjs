import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";

// Run with the sealed collector's tsx loader and tsconfig, under its writer flock.
// Reusing these adapters preserves the account-wide durable provider credit guard.
const root = realpathSync("/opt/creator-tracker/current/app");
const moduleAt = (path) => import(pathToFileURL(`${root}/src/${path}.ts`).href);
const { sqlite, assertShadowWriteDatabaseConnection, closeShadowDatabaseConnection } = await moduleAt("db/index");
const { createDbBoundScrapeCreatorsProviderRunBudget, loadLatestScrapeCreatorsCreditEvidence, resolveScrapeCreatorsProviderCreditReserve } = await moduleAt("sync/scrapecreators-provider-credit");
const tiktok = await moduleAt("sync/scrapecreators-tiktok");
const instagram = await moduleAt("sync/scrapecreators-instagram");

const base = process.env.TRACKING_API_BASE_URL;
const token = process.env.TRACKING_API_WORKER_TOKEN;
if (!base || new URL(base).protocol !== "https:" || !/^trk_worker_[a-f0-9]{64}$/.test(token ?? "")) throw new Error("Tracking worker configuration is invalid.");
async function api(action, payload = {}) {
  const response = await fetch(`${base}/api/internal/tracking/v1/${action}`, {
    method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(payload), signal: AbortSignal.timeout(30000), redirect: "error",
  });
  if (!response.ok) throw new Error(`Tracking worker API returned HTTP ${response.status}.`);
  return response.json();
}

function normalize(item, platform, target) {
  const metrics = item.stats ?? item.metrics;
  const nativeAccount = item.nativeAuthorId ?? item.nativeOwnerId;
  if (!nativeAccount) throw new Error("Native owner identity was missing.");
  const handle = new URL(target.url).pathname.split("/")[1];
  return {
    native_video_id: item.nativeVideoId, native_account_id: nativeAccount,
    url: item.canonicalUrl ?? `https://www.tiktok.com/${handle}/video/${item.nativeVideoId}`,
    caption: metrics.description ?? null,
    published_at: metrics.postedAtMs == null ? null : new Date(metrics.postedAtMs).toISOString(),
    observed_at: new Date(item.sourceObservedAtMs).toISOString(), source: `scrapecreators_${platform}`,
    views: metrics.views ?? null, likes: metrics.likes ?? null, comments: metrics.comments ?? null,
    shares: metrics.shares ?? null, saves: metrics.saves ?? null,
  };
}

try {
  try { await api("sync"); }
  catch { console.log(JSON.stringify({ source_sync: "failed" })); }
  const { job } = await api("lease");
  if (job) {
    const runId = randomUUID();
    const target = job.target;
    target.native_account_id = target.resolved_native_account_id ?? target.native_account_id;
    assertShadowWriteDatabaseConnection();
    sqlite.prepare("INSERT INTO tracker_runs(id,run_kind,adapter,status,started_at) VALUES(?,?,?,?,?)")
      .run(runId, "tracking_api", `scrapecreators_${target.platform}`, "running", Date.now());
    let result;
    try {
      const reserve = resolveScrapeCreatorsProviderCreditReserve({ shared: process.env.SCRAPECREATORS_PROVIDER_CREDIT_RESERVE, legacyInstagram: process.env.INSTAGRAM_PROVIDER_CREDIT_RESERVE });
      const budget = createDbBoundScrapeCreatorsProviderRunBudget({
        sqlite, runId, reserveCredits: reserve,
        initialEvidence: loadLatestScrapeCreatorsCreditEvidence(sqlite),
        limits: { maxRequests: 3, maxProfilePages: 3, maxCredits: 3 },
        assertWriteAuthorized: assertShadowWriteDatabaseConnection,
      });
      const common = { apiKey: process.env.SCRAPECREATORS_API_KEY, budget, attempts: 1, timeoutMs: 45000 };
      let collected;
      if (target.platform === "tiktok") {
        collected = target.kind === "account"
          ? await tiktok.fetchScrapeCreatorsProfileVideos({ ...common, handle: target.identity, limit: 10, expectedNativeAccountId: target.native_account_id })
          : { items: [await tiktok.fetchScrapeCreatorsVideo({ ...common, videoUrl: target.url, expectedVideoId: target.identity, expectedNativeAccountId: target.native_account_id })], status: "complete" };
      } else {
        collected = target.kind === "account"
          ? await instagram.fetchScrapeCreatorsInstagramProfileVideos({ ...common, handle: target.identity, nativeAccountId: target.native_account_id, limit: 10 })
          : { items: [await instagram.fetchScrapeCreatorsInstagramPost({ ...common, videoUrl: target.url, expectedShortcode: target.identity, expectedNativeAccountId: target.native_account_id, allowAlternateRouteOn404: false })], status: "complete" };
      }
      const videos = collected.items.map((item) => normalize(item, target.platform, target));
      result = { videos, coverage: videos.length ? collected.status : "empty_unconfirmed" };
      assertShadowWriteDatabaseConnection();
      sqlite.prepare("UPDATE tracker_runs SET status='success',completed_at=? WHERE id=?").run(Date.now(), runId);
    } catch (error) {
      // Provider exception messages can contain URLs or response details. Only
      // expose a bounded code; preserve the provider's durable guard checkpoint.
      const credit = /Credit|Budget/.test(error?.name ?? "");
      result = { error_code: credit ? "PROVIDER_BUDGET_BLOCKED" : "COLLECTION_FAILED", blocked: credit };
      assertShadowWriteDatabaseConnection();
      sqlite.prepare("UPDATE tracker_runs SET status='failed',completed_at=? WHERE id=?").run(Date.now(), runId);
    }
    await api("complete", { job_id: job.id, lease_token: job.lease_token, result });
    console.log(JSON.stringify({ job_id: job.id, state: result.error_code ? "failed" : "succeeded", error_code: result.error_code ?? null, videos: result.videos?.length ?? 0 }));
  } else console.log(JSON.stringify({ state: "idle" }));
} finally {
  closeShadowDatabaseConnection();
}
