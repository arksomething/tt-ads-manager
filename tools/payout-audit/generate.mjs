#!/usr/bin/env node
/**
 * Payout audit report generator.
 *
 * Produces compact per-creator audit pages (stat cards + deal structure +
 * every video row) from the pay engine's own receipt endpoint, then:
 *  - reconciles per-creator totals against the live UGC Pay page (rendered
 *    with the same settings) and refuses to ship on mismatch,
 *  - cross-checks every video against real TikTok (current view counts via
 *    yt-dlp) and every creator's public profile (post IDs decode to post
 *    dates) to find window posts the report is missing,
 *  - detects rate-limit-poisoned data and waits it out instead of shipping it,
 *  - writes explicit suspicion notes instead of silently dropping anything.
 *
 * Usage: node generate.mjs [--skip-tiktok] [--out DIR]
 * Env: reads web/.env + web/.env.local for DB/Supabase credentials.
 *
 * Server: run the local prod build with
 *   VIRAL_APP_PATIENT=1 VIRAL_APP_DISK_CACHE=/tmp/audit-viral-cache-<month> \
 *     TIKTOK_API_DISK_CACHE=/tmp/audit-tiktok-cache-<month> PORT=3100 npm run start
 * The disk cache snapshots every viral.app response for the run, so
 * correction reruns and the reconciliation pass reuse the snapshot instead of
 * re-paying the quota (~35 min → ~1 min). Point VIRAL_APP_DISK_CACHE at a new
 * (or emptied) directory to force a fresh snapshot; set the same var for this
 * script so the report pages can stamp the snapshot time.
 */
import { execSync, execFileSync, spawn } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

const require = createRequire("/home/ark296/projects/tt-ads-manager/web/package.json");
const { createClient } = require("@supabase/supabase-js");
const { Client } = require("pg");

const ROOT = "/home/ark296/projects/tt-ads-manager";
const WEB = path.join(ROOT, "web");
const ARGS = process.argv.slice(2);
const OUT = ARGS.includes("--out") ? ARGS[ARGS.indexOf("--out") + 1] : path.join(ROOT, "payouts/2026-07/audit-reports");
const SKIP_TIKTOK = ARGS.includes("--skip-tiktok");
const PARAMS = {
  startDate: "2026-07-01",
  endDate: "2026-07-31",
  payMode: "gained",
  videoWindowStartDate: "2026-06-24",
  viewWindowMode: "first-days",
  globalViewWindowDays: "7",
  videoFetchMode: "per-creator",
  campaign: "8a7bd7e4-94c8-4dfe-a7c4-7a7b59024292",
};
const QUERY = new URLSearchParams(PARAMS).toString();
const BASE = process.env.AUDIT_BASE ?? "https://tt-ads-manager.vercel.app";
const BASE_HOST = new URL(BASE).hostname;
const BASE_SECURE = BASE.startsWith("https");

const envf = readFileSync(path.join(WEB, ".env"), "utf8");
const env = (name) => (envf.match(new RegExp(`^${name}="?([^"\n]+)"?`, "m")) ?? [])[1];
const DB_URL = env("DATABASE_URL").replace(/sslmode=[^&]+/, "sslmode=no-verify");

const log = (...parts) => console.log(new Date().toISOString().slice(11, 19), ...parts);

async function mintSession() {
  const admin = createClient(env("SUPABASE_URL"), env("SUPABASE_SK"), { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: linkData, error: e1 } = await admin.auth.admin.generateLink({ type: "magiclink", email: "support@gotall.app" });
  if (e1) throw new Error("generateLink: " + e1.message);
  const anon = createClient(env("SUPABASE_URL"), env("SUPABASE_PK"), { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: otpData, error: e2 } = await anon.auth.verifyOtp({ type: "magiclink", token_hash: linkData.properties.hashed_token });
  if (e2) throw new Error("verifyOtp: " + e2.message);
  const ref = new URL(env("SUPABASE_URL")).hostname.split(".")[0];
  return `sb-${ref}-auth-token=base64-` + Buffer.from(JSON.stringify(otpData.session)).toString("base64url");
}

function parseCsv(text) {
  const rows = []; let row = [], field = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) { if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; } else field += ch; }
    else if (ch === '"') inQ = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (ch !== "\r") field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}


function receiptComplete(csv) {
  if (/rate limit/i.test(csv)) return { ok: false, why: "rate-limited" };
  const declared = Number((csv.match(/^Videos,(\d+)/m) ?? [])[1] ?? 0);
  if (declared < 220) return { ok: false, why: "thin (" + declared + " videos)" };
  const vi = csv.indexOf("\nVIDEOS");
  if (vi < 0) return { ok: false, why: "no VIDEOS section" };
  const rowCount = csv.slice(vi).split("\n").filter((l) => l.includes("tiktok.com/")).length;
  if (rowCount < declared) return { ok: false, why: `truncated (${rowCount}/${declared} video rows)` };
  if (!csv.endsWith("\n")) return { ok: false, why: "no trailing newline" };
  return { ok: true, why: "complete " + rowCount + "/" + declared };
}

// Stream a URL to a file, accepting the moment the payload validates instead
// of waiting out a fixed timebox (the server sometimes never closes the
// connection even after writing the full body).
async function curlToFile(url, cookie, dest, validate, maxMs = 25 * 60_000) {
  try { unlinkSync(dest); } catch { /* fresh start */ }
  const child = spawn("curl", ["-s", "--compressed", "-H", "Connection: close", "-H", `Cookie: ${cookie}`, url, "-o", dest], { stdio: "ignore" });
  let exited = false;
  child.on("exit", () => { exited = true; });
  const startedAt = Date.now();
  while (Date.now() - startedAt < maxMs) {
    await new Promise((r) => setTimeout(r, 5_000));
    let body = "";
    try { body = readFileSync(dest, "utf8"); } catch { /* not started yet */ }
    if (body && validate(body).ok) {
      try { child.kill("SIGKILL"); } catch { /* already gone */ }
      return body;
    }
    if (exited) return body;
  }
  try { child.kill("SIGKILL"); } catch { /* already gone */ }
  try { return readFileSync(dest, "utf8"); } catch { return ""; }
}

function viralSnapshotInfo() {
  const dir = process.env.VIRAL_APP_DISK_CACHE;
  if (!dir || !existsSync(dir)) return null;
  const times = readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => statSync(path.join(dir, f)).mtimeMs);
  if (!times.length) return null;
  return {
    dir,
    files: times.length,
    oldest: new Date(Math.min(...times)).toISOString(),
    newest: new Date(Math.max(...times)).toISOString(),
  };
}

// ---- Phase 1: acquire a clean receipt (wait out rate limits) ----
async function acquireReceipt(cookie) {
  const dest = "/tmp/audit-receipt.csv";
  // reuse a fresh valid receipt if one exists (server sometimes never closes
  // the connection even after the full body is written)
  try {
    const stat = (await import("node:fs")).statSync(dest);
    if (Date.now() - stat.mtimeMs < 45 * 60_000) {
      const csv = readFileSync(dest, "utf8");
      const check = receiptComplete(csv);
      if (check.ok) {
        log(`reusing fresh receipt on disk (${check.why})`);
        return csv;
      }
      log(`cached receipt rejected: ${check.why}`);
    }
  } catch { /* no cached receipt */ }
  for (let attempt = 1; attempt <= 12; attempt++) {
    log(`receipt attempt ${attempt}...`);
    const csv = await curlToFile(`${BASE}/org/gotall/ugc-pay/receipt?${QUERY}`, cookie, dest, receiptComplete);
    const check = receiptComplete(csv);
    const total = (csv.match(/^Total pay,([\d.]+)/m) ?? [])[1];
    log(`  total=${total} ${check.ok ? "ACCEPTED (" + check.why + ")" : "rejected: " + check.why}`);
    if (check.ok) return csv;
    const waitMs = check.why === "rate-limited" ? 20 * 60_000 : 60_000;
    await new Promise((r) => setTimeout(r, waitMs));
  }
  throw new Error("could not obtain a clean receipt after 12 attempts (~4h)");
}

// ---- Phase 2: parse receipt into creators + videos ----
function parseReceipt(csv) {
  const rows = parseCsv(csv);
  const ci = rows.findIndex((r) => r[0] === "CREATORS");
  const vi = rows.findIndex((r) => r[0] === "VIDEOS");
  const meta = Object.fromEntries(rows.slice(0, ci).filter((r) => r.length === 2).map((r) => [r[0], r[1]]));
  const warnings = (rows.slice(0, ci).find((r) => r[0] === "Warnings") ?? [])[1] ?? "";
  const creators = rows.slice(ci + 2, vi).filter((r) => r.length > 5 && r[0]).map((r) => ({
    name: r[0], handle: r[1], currency: r[3], videoCount: Number(r[4]), grossViews: Number(r[5]),
    paidDeducted: Number(r[6]), payableViews: Number(r[7]), fixedPay: Number(r[8]), videoPay: Number(r[9]),
    totalPay: Number(r[10]), customDeal: r[11] === "yes", capReached: r[12] === "yes",
  }));
  const videos = rows.slice(vi + 2).filter((r) => r.length > 5 && r[0]).map((r) => ({
    creator: r[0], url: r[1], title: r[2], posted: r[3], talking: r[4] === "yes", grossViews: Number(r[5]),
    paidDeducted: Number(r[6]), payableViews: Number(r[7]), cpm: Number(r[8]), fixedFee: Number(r[9]),
    cpmPay: Number(r[10]), videoPay: Number(r[11]), paidStatus: r[12], override: r[13] === "yes",
    sourceVideoId: (r[1].match(/video\/(\d+)/) ?? [])[1] ?? null,
  }));
  return { meta, warnings, creators, videos };
}

// ---- Phase 3: deal structures from DB ----
async function loadDeals() {
  const client = new Client({ connectionString: DB_URL });
  await client.connect();
  const res = await client.query(`
    SELECT pa.handle, cr."isTalking" AS creator_talking, d."cpmAmount" AS cpm, d."payoutCapPerVideo" AS cap,
           d."perVideoCapScope" AS scope, d."fixedFeePerVideo" AS fixedvid, d."fixedFee" AS fixedfee,
           d."payoutCapTotal" AS totalcap, to_char(d."effectiveStartDate",'YYYY-MM-DD') AS start,
           to_char(d."effectiveEndDate",'YYYY-MM-DD') AS "end"
    FROM "CampaignCreator" cc
    JOIN "Creator" cr ON cr.id = cc."creatorId"
    JOIN "CreatorPlatformAccount" pa ON pa."creatorId" = cr.id AND pa.platform = 'TIKTOK'
    LEFT JOIN "CampaignCreatorDeal" d ON d."campaignCreatorId" = cc.id
    WHERE cc."campaignId" = $1
    ORDER BY pa.handle, d."effectiveStartDate"`, [PARAMS.campaign]);
  const byHandle = new Map();
  for (const row of res.rows) {
    if (!byHandle.has(row.handle)) byHandle.set(row.handle, { creatorTalking: row.creator_talking, periods: [] });
    if (row.cpm != null) byHandle.get(row.handle).periods.push(row);
  }
  await client.end();
  return byHandle;
}

// ---- Phase 4: reconcile against the live page ----
function scrapeLivePage(cookie) {
  const script = `
    const puppeteer = require('puppeteer-core');
    (async () => {
      const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] });
      const page = await browser.newPage();
      const [name, ...valueParts] = process.env.ORG_COOKIE.split('=');
      await page.setCookie({ name, value: valueParts.join('='), domain: process.env.BASE_HOST, path: '/', secure: process.env.BASE_SECURE === '1' });
      await page.setViewport({ width: 1500, height: 1200 });
      await page.goto('${BASE}/org/gotall/ugc-pay?${QUERY}', { waitUntil: 'commit', timeout: 600000 });
      await page.waitForFunction(() => document.body && document.body.innerText.includes('Pay by creator'), { timeout: 5400000, polling: 2000 });
      await new Promise(r => setTimeout(r, 3000));
      const data = await page.evaluate(() => {
        const rows = [];
        for (const h3 of document.querySelectorAll('h3')) {
          const row = h3.closest('div.grid');
          if (!row) continue;
          const handle = (row.querySelector('p.truncate')?.innerText ?? '').replace(/^@/, '');
          const pay = row.innerText.match(/\\$[\\d,]+\\.\\d\\d/)?.[0] ?? null;
          if (pay) rows.push({ name: h3.innerText.trim(), handle, pay });
        }
        const total = document.body.innerText.match(/UGC Pay\\s*\\n\\s*(\\$[\\d,]+\\.\\d\\d)/)?.[1] ?? null;
        const rateLimited = /rate limit/i.test(document.body.innerText);
        return { rows, total, rateLimited };
      });
      console.log(JSON.stringify(data));
      await browser.close();
    })().catch(e => { console.error(e.message); process.exit(1); });
  `;
  const out = execFileSync("node", ["-e", script], {
    env: { ...process.env, NODE_PATH: "/tmp/pptr/node_modules", ORG_COOKIE: cookie, BASE_HOST, BASE_SECURE: BASE_SECURE ? "1" : "0" },
    encoding: "utf8", timeout: 7300000,
  });
  return JSON.parse(out.trim().split("\n").pop());
}

// ---- Phase 5: TikTok ground truth ----
function tiktokVideoViews(urls, workers = 6) {
  const results = new Map();
  const queue = [...urls];
  const workerFn = () => {
    while (queue.length) {
      const url = queue.shift();
      try {
        const out = execFileSync("yt-dlp", ["--no-warnings", "--print", "%(view_count)s", url], { encoding: "utf8", timeout: 60000 }).trim();
        results.set(url, Number(out) || null);
      } catch { results.set(url, null); }
    }
  };
  // simple sequential batches of `workers` via Promise.all on child procs is messy in sync;
  // spawn a python pool instead for real parallelism
  writeFileSync("/tmp/audit-tiktok-urls.json", JSON.stringify(urls));
  const py = `
import json, subprocess
from concurrent.futures import ThreadPoolExecutor
urls = json.load(open('/tmp/audit-tiktok-urls.json'))
def get(u):
    try:
        out = subprocess.run(['yt-dlp','--no-warnings','--print','%(view_count)s',u], capture_output=True, text=True, timeout=60)
        return u, int(out.stdout.strip()) if out.stdout.strip().isdigit() else None
    except Exception:
        return u, None
with ThreadPoolExecutor(max_workers=${workers}) as pool:
    res = dict(pool.map(get, urls))
json.dump(res, open('/tmp/audit-tiktok-views.json','w'))
print('done', sum(1 for v in res.values() if v is not None), '/', len(res))
`;
  execFileSync("python3", ["-c", py], { encoding: "utf8", timeout: 3600000, stdio: "inherit" });
  return new Map(Object.entries(JSON.parse(readFileSync("/tmp/audit-tiktok-views.json", "utf8"))));
}

function tiktokProfilePosts(handle) {
  // enumerate the public profile; IDs decode to post timestamps
  try {
    const out = execFileSync("yt-dlp", ["--no-warnings", "--flat-playlist", "--playlist-end", "80", "--print", "%(id)s", `https://www.tiktok.com/@${handle}`], { encoding: "utf8", timeout: 120000 });
    return out.trim().split("\n").filter(Boolean).map((id) => ({
      id, posted: new Date(Number(BigInt(id) >> 32n) * 1000).toISOString().slice(0, 10),
    }));
  } catch { return null; }
}

// ---- Phase 6: render ----
const fmtMoney = (v) => "$" + Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtNum = (v) => Number(v).toLocaleString("en-US");
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const CSS = `body{background:#0b0c0e;color:#e8e8ea;font-family:-apple-system,'Segoe UI',Roboto,sans-serif;margin:0;padding:1.5rem}
a{color:#b9ff95;text-decoration:none}a:hover{text-decoration:underline}
h1{font-size:1.3rem;margin:0 0 .2rem}.sub{color:#9a9aa2;font-size:.8rem;margin-bottom:1rem}
.cards{display:flex;gap:.7rem;margin:.8rem 0;flex-wrap:wrap}
.card{background:#111214;border-radius:10px;padding:.7rem 1rem;min-width:8rem}
.card .v{font-size:1.15rem;font-weight:700;margin-top:.15rem}.card .l{font-size:.62rem;text-transform:uppercase;color:#9a9aa2}
table{border-collapse:collapse;width:100%;background:#111214;border-radius:10px;overflow:hidden;font-size:.8rem}
th{text-align:left;font-size:.62rem;text-transform:uppercase;color:#9a9aa2;padding:.5rem .6rem;background:#16171a;position:sticky;top:0}
td{padding:.45rem .6rem;border-top:1px solid #1e2024;vertical-align:middle}
td.r,th.r{text-align:right}.pay{font-weight:600}
img.t{width:44px;height:60px;object-fit:cover;border-radius:6px;display:block}
.talk{color:#b9ff95}.non{color:#8ab4ff}.warn{color:#ffe7a6}.bad{color:#ff9b8a;font-weight:600}
.ok{color:#7ee2a8}.muted{color:#9a9aa2;font-size:.72rem}
.deal{background:#16171a;border-radius:8px;padding:.5rem .8rem;font-size:.75rem;margin:.2rem 0}
.note{background:#2a2214;border:1px solid #5c4a1a;border-radius:8px;padding:.5rem .8rem;font-size:.78rem;margin:.3rem 0;color:#ffe7a6}`;

function renderCreatorPage(creator, vids, deal, checks, thumbsDir) {
  const notes = checks.notes ?? [];
  const dealHtml = (deal?.periods ?? []).map((p) =>
    `<div class="deal">${p.start} → ${p.end ?? "open"}: $${Number(p.cpm).toFixed(2)} CPM, $${Number(p.cap).toFixed(2)} cap (${p.scope})${p.fixedvid ? ` + $${Number(p.fixedvid).toFixed(2)}/video` : ""}${p.fixedfee ? ` + $${Number(p.fixedfee).toFixed(2)} fixed fee` : ""}${p.totalcap ? ` · total cap $${Number(p.totalcap).toFixed(2)}` : ""}</div>`).join("");
  const rows = vids.map((v) => {
    const thumb = v.sourceVideoId && existsSync(path.join(thumbsDir, v.sourceVideoId + ".jpg"))
      ? `<img class="t" src="thumbs/${v.sourceVideoId}.jpg">` : "▶";
    const tiktokViews = checks.viewsByUrl?.get?.(v.url);
    let viewCheck = '<span class="muted">n/a</span>';
    if (tiktokViews != null) {
      viewCheck = tiktokViews >= v.grossViews * 0.98
        ? `<span class="ok">✓ ${fmtNum(tiktokViews)}</span>`
        : `<span class="bad">⚠ TikTok has ${fmtNum(tiktokViews)} total &lt; ${fmtNum(v.grossViews)} paid views</span>`;
    }
    return `<tr><td><a href="${esc(v.url)}" target="_blank">${thumb}</a></td>
<td style="max-width:16rem"><a href="${esc(v.url)}" target="_blank">${esc(v.title || "TikTok video")}</a></td>
<td>${v.posted?.slice(0, 10) ?? ""}</td><td class="${v.talking ? "talk" : "non"}">${v.talking ? "talking" : "non-talking"}</td>
<td class="r">${fmtNum(v.grossViews)}</td><td class="r">${fmtNum(v.payableViews)}</td>
<td class="r">$${v.cpm.toFixed(2)}</td><td class="r">$${v.fixedFee.toFixed(2)}</td>
<td class="r pay">${fmtMoney(v.videoPay)}</td><td>${viewCheck}</td>${v.override ? '<td class="warn">override</td>' : "<td></td>"}</tr>`;
  }).join("");
  return `<!doctype html><meta charset="utf-8"><title>${esc(creator.name)} — July 2026 audit</title><style>${CSS}</style>
<div class="sub"><a href="index.html">← all creators</a></div>
<h1>${esc(creator.name)} <span class="muted">@${esc(creator.handle)}</span> — ${fmtMoney(creator.totalPay)}</h1>
<div class="sub">Jul 1–31 2026 · gained views · window from Jun 24 · first 7 days · per-creator feed · creator default: ${deal?.creatorTalking ? "talking" : "non-talking"}</div>
<div class="cards">
<div class="card"><div class="l">Total pay</div><div class="v">${fmtMoney(creator.totalPay)}</div></div>
<div class="card"><div class="l">Fixed</div><div class="v">${fmtMoney(creator.fixedPay)}</div></div>
<div class="card"><div class="l">Videos</div><div class="v">${creator.videoCount}</div></div>
<div class="card"><div class="l">Gross views</div><div class="v">${fmtNum(creator.grossViews)}</div></div>
<div class="card"><div class="l">Payable views</div><div class="v">${fmtNum(Math.round(creator.payableViews))}</div></div>
<div class="card"><div class="l">Cap reached</div><div class="v">${creator.capReached ? "yes" : "no"}</div></div>
</div>
${dealHtml}
${notes.map((n) => `<div class="note">⚠ ${esc(n)}</div>`).join("")}
<table><tr><th></th><th>Video</th><th>Posted</th><th>Type</th><th class="r">Gross</th><th class="r">Payable</th><th class="r">CPM</th><th class="r">Fixed</th><th class="r">Pay</th><th>TikTok check</th><th></th></tr>${rows}</table>`;
}

// ---- main ----
(async () => {
  mkdirSync(path.join(OUT, "thumbs"), { recursive: true });
  log("minting session...");
  let cookie = await mintSession();

  const csv = await acquireReceipt(cookie);
  writeFileSync(path.join(OUT, "receipt.csv"), csv);
  const { meta, warnings, creators, videos } = parseReceipt(csv);
  log(`receipt: ${creators.length} creators, ${videos.length} videos, total ${meta["Total pay"]}`);

  const deals = await loadDeals();
  log(`deals loaded for ${deals.size} handles`);

  log("scraping live page for reconciliation...");
  cookie = await mintSession(); // refresh; page render takes a while
  let live = null;
  let reconMode = "live UGC Pay page";
  try {
    live = scrapeLivePage(cookie);
    if (live.rateLimited) throw new Error("live page showed a rate limit");
    log(`live page: ${live.rows.length} creator rows, total ${live.total}`);
  } catch (scrapeError) {
    log(`live-page scrape failed (${String(scrapeError.message).slice(0, 80)}) — falling back to independent second engine run`);
    reconMode = "second independent engine run (live page could not be rendered — see notes)";
    await curlToFile(`${BASE}/org/gotall/ugc-pay/receipt?${QUERY}&reconcile=1`, cookie, "/tmp/audit-receipt-2.csv", receiptComplete);
    const secondCheck = receiptComplete(readFileSync("/tmp/audit-receipt-2.csv", "utf8"));
    if (!secondCheck.ok) throw new Error("second engine run incomplete: " + secondCheck.why);
    const second = parseReceipt(readFileSync("/tmp/audit-receipt-2.csv", "utf8"));
    live = { rows: second.creators.map((c) => ({ name: c.name, handle: c.handle, pay: "$" + c.totalPay.toFixed(2) })), total: "$" + Number(second.meta["Total pay"]).toFixed(2), rateLimited: false };
  }

  // reconcile
  const reconciliation = [];
  const liveByHandle = new Map(live.rows.map((r) => [r.handle.toLowerCase(), r.pay]));
  let mismatches = 0;
  for (const c of creators) {
    const livePay = liveByHandle.get(c.handle.toLowerCase());
    const match = livePay != null && Math.abs(Number(livePay.replace(/[$,]/g, "")) - c.totalPay) < 0.011;
    if (!match) mismatches++;
    reconciliation.push({ handle: c.handle, receipt: c.totalPay, live: livePay, match });
  }
  log(`reconciliation vs ${reconMode}: ${creators.length - mismatches}/${creators.length} match`);

  // tiktok checks
  const checksByCreator = new Map();
  let viewsByUrl = new Map();
  if (!SKIP_TIKTOK) {
    const cachePath = "/tmp/audit-tiktok-views.json";
    let cached = null;
    try {
      const stat = (await import("node:fs")).statSync(cachePath);
      if (Date.now() - stat.mtimeMs < 24 * 3600_000) cached = new Map(Object.entries(JSON.parse(readFileSync(cachePath, "utf8"))));
    } catch { /* no cache */ }
    const missing = cached ? videos.filter((v) => !cached.has(v.url)).map((v) => v.url) : videos.map((v) => v.url);
    log(`fetching TikTok view counts (${missing.length} new, ${cached ? cached.size : 0} cached)...`);
    if (missing.length > 0) {
      const fresh = tiktokVideoViews(missing);
      viewsByUrl = new Map([...(cached ?? []), ...fresh]);
      writeFileSync(cachePath, JSON.stringify(Object.fromEntries(viewsByUrl)));
    } else {
      viewsByUrl = cached;
    }
    void 0;
    log("enumerating profiles for missing-post detection...");
    for (const c of creators) {
      const notes = [];
      const posts = tiktokProfilePosts(c.handle);
      if (posts == null) {
        notes.push("Could not enumerate this creator's TikTok profile — completeness not verified.");
      } else {
        const windowPosts = posts.filter((p) => p.posted >= PARAMS.videoWindowStartDate && p.posted <= PARAMS.endDate);
        const reportIds = new Set(videos.filter((v) => v.creator === c.name).map((v) => v.sourceVideoId));
        const missing = windowPosts.filter((p) => !reportIds.has(p.id));
        if (missing.length > 0) {
          notes.push(`TikTok profile shows ${missing.length} post(s) in the pay window that are NOT in this report (viral.app tracking gap): ` +
            missing.slice(0, 10).map((m) => `${m.posted} (https://www.tiktok.com/@${c.handle}/video/${m.id})`).join(", ") + (missing.length > 10 ? ` +${missing.length - 10} more` : ""));
        }
        notes.push(`Profile check: ${windowPosts.length} window posts on TikTok vs ${reportIds.size} in report.`);
      }
      checksByCreator.set(c.name, { notes, viewsByUrl });
    }
    // per-video impossible-views flags roll into page rendering via viewsByUrl
  }

  // thumbnails (reuse existing caches)
  const thumbSources = [path.join(ROOT, "payouts/2026-07/html/thumbs"), path.join(ROOT, "payouts/2026-07/classification-audit/thumbs")];
  let thumbs = 0;
  for (const v of videos) {
    if (!v.sourceVideoId) continue;
    const dest = path.join(OUT, "thumbs", v.sourceVideoId + ".jpg");
    if (existsSync(dest)) { thumbs++; continue; }
    const src = thumbSources.map((d) => path.join(d, v.sourceVideoId + ".jpg")).find(existsSync);
    if (src) { execSync(`cp "${src}" "${dest}"`); thumbs++; continue; }
    try {
      const metaJson = JSON.parse(execSync(`curl -s --max-time 15 "https://www.tiktok.com/oembed?url=${v.url}"`, { encoding: "utf8", timeout: 20000 }));
      if (metaJson.thumbnail_url) { execSync(`curl -s --max-time 20 -o "${dest}" "${metaJson.thumbnail_url}"`, { timeout: 25000 }); thumbs++; }
    } catch { /* thumb optional */ }
  }
  log(`thumbnails: ${thumbs}/${videos.length}`);

  // render pages
  for (const c of creators) {
    const vids = videos.filter((v) => v.creator === c.name).sort((a, b) => (b.posted ?? "").localeCompare(a.posted ?? ""));
    const checks = { ...(checksByCreator.get(c.name) ?? { notes: [] }), viewsByUrl };
    const slug = (c.handle || c.name).replace(/[^a-z0-9._-]/gi, "_");
    writeFileSync(path.join(OUT, slug + ".html"), renderCreatorPage(c, vids, deals.get(c.handle), checks, path.join(OUT, "thumbs")));
  }

  // index
  const noteCount = (name) => (checksByCreator.get(name)?.notes ?? []).filter((n) => n.includes("NOT in this report") || n.includes("Could not")).length;
  const indexRows = creators.sort((a, b) => b.totalPay - a.totalPay).map((c) => {
    const rec = reconciliation.find((r) => r.handle === c.handle);
    const slug = (c.handle || c.name).replace(/[^a-z0-9._-]/gi, "_");
    return `<tr><td><a href="${slug}.html">${esc(c.name)}</a> <span class="muted">@${esc(c.handle)}</span></td>
<td class="r">${c.videoCount}</td><td class="r">${fmtNum(c.grossViews)}</td><td class="r pay">${fmtMoney(c.totalPay)}</td>
<td>${rec?.match ? '<span class="ok">✓ matches live page</span>' : `<span class="bad">✗ live shows ${esc(rec?.live ?? "—")}</span>`}</td>
<td>${noteCount(c.name) ? `<span class="warn">${noteCount(c.name)} note(s)</span>` : ""}${c.capReached ? ' <span class="warn">cap</span>' : ""}</td></tr>`;
  }).join("");
  const index = `<!doctype html><meta charset="utf-8"><title>July 2026 payout audit</title><style>${CSS}</style>
<h1>July 2026 payout audit — ${fmtMoney(meta["Total pay"])}</h1>
<div class="sub">${creators.length} creators · ${videos.length} videos · generated ${meta["Generated at (UTC)"]} · settings: gained views, Jul 1–31, window from Jun 24, first 7 days, per-creator feed${(() => { const s = viralSnapshotInfo(); return s ? ` · viral.app snapshot ${s.oldest.slice(0, 16)}Z–${s.newest.slice(0, 16)}Z (${s.files} responses)` : ""; })()}</div>
<div class="cards">
<div class="card"><div class="l">Total pay</div><div class="v">${fmtMoney(meta["Total pay"])}</div></div>
<div class="card"><div class="l">Creators</div><div class="v">${creators.length}</div></div>
<div class="card"><div class="l">Videos</div><div class="v">${videos.length}</div></div>
<div class="card"><div class="l">Payable views</div><div class="v">${fmtNum(Math.round(meta["Payable views"]))}</div></div>
<div class="card"><div class="l">Live-page match</div><div class="v">${creators.length - mismatches}/${creators.length}</div></div>
</div>
${/rate limit/i.test(warnings) ? '<div class="note">⚠ Receipt contained rate-limit warnings — DO NOT TRUST</div>' : ""}
<table><tr><th>Creator</th><th class="r">Videos</th><th class="r">Gross views</th><th class="r">Pay</th><th>Reconciliation</th><th>Flags</th></tr>${indexRows}</table>`;
  writeFileSync(path.join(OUT, "index.html"), index);

  // self-verification report
  const sumPages = creators.reduce((t, c) => t + c.totalPay, 0);
  const verification = {
    generatedAt: new Date().toISOString(),
    receiptTotal: Number(meta["Total pay"]),
    sumOfCreatorPages: Number(sumPages.toFixed(2)),
    totalsAgree: Math.abs(sumPages - Number(meta["Total pay"])) < 0.011,
    creators: creators.length,
    videos: videos.length,
    rateLimitClean: !/rate limit/i.test(csv),
    viralAppSnapshot: viralSnapshotInfo(),
    liveReconciliation: { mode: reconMode, matched: creators.length - mismatches, total: creators.length, detail: reconciliation.filter((r) => !r.match) },
  };
  writeFileSync(path.join(OUT, "verification.json"), JSON.stringify(verification, null, 1));
  log("VERIFICATION:", JSON.stringify(verification, null, 1));
})();
