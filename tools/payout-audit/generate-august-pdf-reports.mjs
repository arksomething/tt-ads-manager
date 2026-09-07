#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import {
  copyFileSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

const ROOT = "/home/ark296/projects/tt-ads-manager";
const require = createRequire(path.join(ROOT, "web/package.json"));
const { Client } = require("pg");
const SETTLEMENT_PATH = path.join(
  ROOT,
  "payouts/2026-08/final-settlement/settlement.json",
);
const OUT = path.join(ROOT, "output/pdf/august-2026-payout-reports");
const TMP = path.join(ROOT, "tmp/pdfs/august-2026-payout-reports");
const SAMPLE_OUT = path.join(ROOT, "output/pdf/august-2026-payout-report-sample");
const SAMPLE_TMP = path.join(ROOT, "tmp/pdfs/august-2026-payout-report-sample");
const THUMBNAIL_CACHE = path.join(ROOT, "tmp/pdfs/august-2026-thumbnail-cache");
const VIDEO_FRAME_CACHE = path.join(ROOT, "tmp/pdfs/august-2026-missing-video-frames");
const CHROME_PROFILE = path.join(TMP, "chrome-profile");
const PACKET = path.join(OUT, "august-2026-complete-payout-report-packet.pdf");

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function money(value) {
  return `$${Number(value).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function integer(value) {
  return Number(value).toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function slug(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 72);
}

function truncate(value, length = 100) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > length ? `${text.slice(0, length - 3)}...` : text;
}

const baseStyles = `
  :root {
    --ink: #172033;
    --muted: #647086;
    --line: #dbe1eb;
    --soft: #f4f7fb;
    --blue: #2156d8;
    --blue-soft: #eaf0ff;
    --green: #087c5a;
    --green-soft: #e8f7f1;
    --orange: #9a4c09;
    --orange-soft: #fff1df;
    --red: #a12736;
    --red-soft: #fdecef;
  }
  * { box-sizing: border-box; }
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body {
    margin: 0;
    color: var(--ink);
    background: white;
    font-family: Inter, Arial, Helvetica, sans-serif;
    font-size: 10px;
    line-height: 1.35;
  }
  @page { size: A4 landscape; margin: 10mm 9mm 11mm; }
  h1 { margin: 0; font-size: 24px; line-height: 1.1; letter-spacing: -0.5px; }
  h2 { margin: 17px 0 7px; font-size: 14px; }
  h3 { margin: 0 0 5px; font-size: 11px; }
  p { margin: 4px 0; }
  a { color: var(--blue); text-decoration: none; }
  .page-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 18px;
    padding-bottom: 10px;
    border-bottom: 2px solid var(--ink);
  }
  .eyebrow { color: var(--blue); font-size: 9px; font-weight: 800; letter-spacing: 1.25px; text-transform: uppercase; }
  .subtitle { color: var(--muted); margin-top: 5px; }
  .amount { font-size: 30px; line-height: 1; font-weight: 800; text-align: right; color: var(--green); }
  .status { margin-top: 6px; color: var(--muted); font-size: 9px; text-align: right; }
  .stats { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 7px; margin: 11px 0; }
  .stat { border: 1px solid var(--line); border-radius: 7px; padding: 8px 9px; background: var(--soft); }
  .stat .label { color: var(--muted); font-size: 8px; text-transform: uppercase; letter-spacing: 0.45px; }
  .stat .value { font-size: 16px; font-weight: 800; margin-top: 2px; }
  .note { border-left: 4px solid var(--blue); background: var(--blue-soft); padding: 8px 10px; margin: 9px 0; border-radius: 0 6px 6px 0; }
  .note.warn { border-left-color: var(--orange); background: var(--orange-soft); }
  .note.hold { border-left-color: var(--red); background: var(--red-soft); }
  .note.good { border-left-color: var(--green); background: var(--green-soft); }
  .pill { display: inline-block; border-radius: 999px; padding: 2px 6px; font-size: 7px; font-weight: 800; white-space: nowrap; }
  .pill.yes { background: var(--green-soft); color: var(--green); }
  .pill.no { background: var(--red-soft); color: var(--red); }
  .pill.neutral { background: var(--soft); color: var(--muted); }
  table { width: 100%; border-collapse: collapse; margin-top: 6px; table-layout: fixed; }
  thead { display: table-header-group; }
  tr { break-inside: avoid; page-break-inside: avoid; }
  th { background: var(--ink); color: white; font-size: 7px; text-align: left; padding: 5px 4px; letter-spacing: 0.2px; }
  td { border-bottom: 1px solid var(--line); padding: 4px; vertical-align: top; font-size: 7.2px; overflow-wrap: anywhere; }
  tbody tr:nth-child(even) td { background: #fafbfe; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  .video-title { font-weight: 700; }
  .caption { color: var(--muted); margin-top: 2px; font-size: 6.6px; }
  .thumb { width: 42px; height: 56px; object-fit: cover; border-radius: 5px; border: 1px solid var(--line); background: var(--soft); display: block; }
  .small { color: var(--muted); font-size: 8px; }
  .footer { margin-top: 10px; padding-top: 7px; border-top: 1px solid var(--line); color: var(--muted); font-size: 7px; }
  .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .card { border: 1px solid var(--line); border-radius: 8px; padding: 10px; break-inside: avoid; }
  .card.hold { border-color: #efb7bf; background: #fffafb; }
  .card.good { border-color: #acd9c0; background: #f7fcf9; }
  .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
`;

function documentHtml(title, body, extraStyles = "") {
  return `<!doctype html>
  <html lang="en">
  <head>
    <meta charset="utf-8">
    <title>${escapeHtml(title)}</title>
    <style>${baseStyles}${extraStyles}</style>
  </head>
  <body>${body}</body>
  </html>`;
}

function stat(label, value) {
  return `<div class="stat"><div class="label">${escapeHtml(label)}</div><div class="value">${escapeHtml(value)}</div></div>`;
}

function displayHasYap(video) {
  return Boolean(video.hasYap);
}

function thumbnailPath(video) {
  return path.join(
    THUMBNAIL_CACHE,
    `${video.platform === "INSTAGRAM_REELS" ? "instagram" : "tiktok"}-${video.platformVideoId}.webp`,
  );
}

function visibleVideos(recipient) {
  return recipient.videos
    .filter((video) => video.videoPay > 0)
    .sort(
      (left, right) =>
        right.publishedDate.localeCompare(left.publishedDate) ||
        right.platformVideoId.localeCompare(left.platformVideoId),
    );
}

function readEnvironment(name) {
  for (const envPath of [path.join(ROOT, "web/.env.local"), path.join(ROOT, "web/.env")]) {
    let environment = "";
    try {
      environment = readFileSync(envPath, "utf8");
    } catch {
      continue;
    }
    const match = environment.match(new RegExp(`^${name}="?([^"\\n]+)"?`, "m"));
    if (match) return match[1];
  }
  throw new Error(`${name} is not configured`);
}

async function loadDealTerms() {
  const databaseUrl = readEnvironment("DATABASE_URL").replace(
    /sslmode=[^&]+/,
    "sslmode=no-verify",
  );
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const result = await client.query(
      `
        SELECT cr.id AS "creatorId", cr."displayName",
               d."fixedFeePerVideo"::float8 AS "fixedFeePerVideo",
               d."cpmAmount"::float8 AS "cpmAmount",
               d."payoutCapPerVideo"::float8 AS "payoutCapPerVideo",
               d."perVideoCapScope", d."viewWindowDays",
               to_char(d."effectiveStartDate", 'YYYY-MM-DD') AS "effectiveStartDate"
        FROM "CampaignCreatorDeal" d
        JOIN "CampaignCreator" cc ON cc.id = d."campaignCreatorId"
        JOIN "Creator" cr ON cr.id = cc."creatorId"
        WHERE cc."campaignId" = $1
          AND d."effectiveStartDate" <= '2026-08-31'
          AND (d."effectiveEndDate" IS NULL OR d."effectiveEndDate" >= '2026-07-25')
        ORDER BY d."effectiveStartDate"
      `,
      ["8a7bd7e4-94c8-4dfe-a7c4-7a7b59024292"],
    );
    return new Map(result.rows.map((deal) => [deal.creatorId, deal]));
  } finally {
    await client.end();
  }
}

function inferredDealTerms(videos) {
  const augustVideos = videos.filter((video) => video.publishedDate.startsWith("2026-08-"));
  const fixedFees = [...new Set(augustVideos.map((video) => video.fixedFee).filter((fee) => fee > 0))]
    .sort((left, right) => left - right);
  const baseRates = [...new Set(videos.map((video) => video.baseCpm).filter((rate) => rate > 0))]
    .sort((left, right) => left - right);
  const effectiveRates = [
    ...new Set(videos.map((video) => video.effectiveCpm).filter((rate) => rate > 0)),
  ].sort((left, right) => left - right);

  let fixedTerm = "No fixed per-post fee";
  if (fixedFees.length === 1) fixedTerm = `${money(fixedFees[0])} per August post`;
  if (fixedFees.length > 1) {
    fixedTerm = `${fixedFees.map(money).join(" / ")} per August post, depending on account`;
  }

  const highestBaseRate = baseRates.at(-1);
  const lowestEffectiveRate = effectiveRates[0];
  const hasYapRateDifference =
    highestBaseRate != null &&
    lowestEffectiveRate != null &&
    highestBaseRate > lowestEffectiveRate;
  let viewRateTerm = "No CPM payment";
  if (hasYapRateDifference) {
    viewRateTerm = `${money(highestBaseRate)} CPM with #yap; ${money(lowestEffectiveRate)} CPM otherwise`;
  } else if (effectiveRates.length === 1) {
    viewRateTerm = `${money(effectiveRates[0])} CPM`;
  } else if (effectiveRates.length > 1) {
    viewRateTerm = `${effectiveRates.map(money).join(" / ")} CPM, depending on account`;
  }

  function capForRate(rate) {
    const matches = videos.filter(
      (video) => video.effectiveCpm === rate && video.payoutCapPerVideo > 0,
    );
    if (matches.length === 0) return null;
    const highest = matches.sort(
      (left, right) => right.payoutCapPerVideo - left.payoutCapPerVideo,
    )[0];
    if (highest.perVideoCapScope === "NONE") return null;
    const scope = highest.perVideoCapScope === "TOTAL" ? "total payout" : "view payout";
    return `${money(highest.payoutCapPerVideo)} ${scope}`;
  }

  let capTerm = "No separate per-video cap";
  if (hasYapRateDifference) {
    const yapCap = capForRate(highestBaseRate);
    const otherCap = capForRate(lowestEffectiveRate);
    if (yapCap && otherCap) capTerm = `${yapCap} with #yap; ${otherCap} otherwise`;
    else if (yapCap) capTerm = `${yapCap} with #yap`;
    else if (otherCap) capTerm = `${otherCap} without #yap`;
  } else if (effectiveRates.length === 1) {
    const cap = capForRate(effectiveRates[0]);
    if (cap) capTerm = cap;
  }

  return `Fixed fee: ${fixedTerm}. View rate: ${viewRateTerm}. Per-video cap: ${capTerm}.`;
}

function capDescription(amount, scope) {
  if (!(amount > 0) || scope === "NONE") return null;
  return `${money(amount)} ${scope === "TOTAL" ? "total payout" : "view payout"}`;
}

function configuredDealTerms(deal) {
  const fixedTerm = deal.fixedFeePerVideo > 0
    ? `${money(deal.fixedFeePerVideo)} per August post`
    : "No fixed per-post fee";
  const cpm = Number(deal.cpmAmount ?? 0);
  const baseCap = capDescription(deal.payoutCapPerVideo, deal.perVideoCapScope);
  let viewRateTerm = cpm > 0 ? `${money(cpm)} CPM` : "No CPM payment";
  let capTerm = baseCap ?? "No separate per-video cap";

  if (cpm > 0.5) {
    viewRateTerm = `${money(cpm)} CPM with #yap; $0.50 CPM otherwise`;
    const lowerCap = "$100.00 view payout";
    if (baseCap === lowerCap) capTerm = baseCap;
    else if (baseCap) capTerm = `${baseCap} with #yap; ${lowerCap} otherwise`;
    else capTerm = `No base cap with #yap; ${lowerCap} otherwise`;
  }

  return `Fixed fee: ${fixedTerm}. View rate: ${viewRateTerm}. Per-video cap: ${capTerm}.`;
}

function dealStructure(recipient, dealTermsByCreator) {
  const creatorGroups = new Map();
  for (const video of recipient.videos) {
    if (!creatorGroups.has(video.creatorId)) creatorGroups.set(video.creatorId, []);
    creatorGroups.get(video.creatorId).push(video);
  }
  const structures = [...creatorGroups.entries()].map(([creatorId, videos]) => {
    const configuredDeal = dealTermsByCreator.get(creatorId);
    const configuredCpm = Number(configuredDeal?.cpmAmount ?? 0);
    const settledTermsDiffer = configuredDeal
      ? videos.some((video) => Number(video.baseCpm) !== configuredCpm)
      : false;
    return {
      creatorName: videos[0].creatorName,
      text: configuredDeal && !settledTermsDiffer
        ? configuredDealTerms(configuredDeal)
        : inferredDealTerms(videos),
    };
  });
  const uniqueStructures = [...new Set(structures.map((structure) => structure.text))];
  const terms = uniqueStructures.length === 1
    ? escapeHtml(uniqueStructures[0])
    : structures
        .map(
          (structure) =>
            `<strong>${escapeHtml(structure.creatorName)}:</strong> ${escapeHtml(structure.text)}`,
        )
        .join("<br>");
  return `<strong>Deal structure:</strong> ${terms} View window: each video&rsquo;s first seven days, counting only the portion inside August; matched paid-ad views are excluded. July carryovers receive eligible August view pay, but not another fixed per-post fee.`;
}

function creatorReport(settlement, recipient, dealTermsByCreator) {
  const handles = recipient.handles.map((handle) => `@${handle}`).join(" + ");
  const videos = visibleVideos(recipient);
  const displayedTotalViews = videos.reduce((sum, video) => sum + video.totalViews, 0);
  const displayedSevenDayViews = videos.reduce((sum, video) => sum + video.payableViews, 0);
  const displayedFixedPay = videos.reduce((sum, video) => sum + video.fixedFee, 0);
  const displayedViewPay = recipient.totalPay - displayedFixedPay;
  const displayedYap = videos.filter(displayHasYap).length;
  const rows = videos
    .map((video, index) => {
      const shownYap = displayHasYap(video);
      return `<tr>
        <td class="num">${index + 1}</td>
        <td><img class="thumb" src="file://${escapeHtml(thumbnailPath(video))}" alt="Video thumbnail"></td>
        <td>${escapeHtml(video.publishedDate)}</td>
        <td><div class="video-title"><a href="${escapeHtml(video.url)}">${escapeHtml(video.platformVideoId)}</a></div><div class="caption">${escapeHtml(truncate(video.caption))}</div></td>
        <td>${escapeHtml(video.accountHandle)}<br><span class="small">${video.platform === "TIKTOK" ? "TikTok" : "Instagram"}</span></td>
        <td class="num">${integer(video.totalViews)}</td>
        <td class="num">${integer(video.payableViews)}</td>
        <td><span class="pill ${shownYap ? "yes" : "neutral"}">${shownYap ? "#yap" : "-"}</span></td>
        <td class="num">${money(video.effectiveCpm)}</td>
        <td class="num">${money(video.fixedFee)}</td>
        <td class="num"><strong>${money(video.videoPay)}</strong></td>
      </tr>`;
    })
    .join("");

  return documentHtml(
    `${recipient.name} - August 2026 payout report`,
    `<div class="page-header">
      <div>
        <div class="eyebrow">GoTall creator payout report</div>
        <h1>${escapeHtml(recipient.name)}</h1>
        <div class="subtitle">${escapeHtml(handles)} | August 1-31, 2026 | UTC</div>
      </div>
      <div>
        <div class="amount">${money(recipient.totalPay)}</div>
        <div class="status">${recipient.correction ? "CORRECTED - READY TO SEND" : "CALCULATED - READY TO SEND"}</div>
      </div>
    </div>
    <div class="stats">
      ${stat("Paid videos", integer(videos.length))}
      ${stat("Total views", integer(displayedTotalViews))}
      ${stat("7-day views minus paid ads", integer(displayedSevenDayViews))}
      ${stat("Fixed pay", money(displayedFixedPay))}
      ${stat("View pay", money(displayedViewPay))}
      ${stat("#yap", integer(displayedYap))}
    </div>
    <div class="note">
      ${dealStructure(recipient, dealTermsByCreator)}
    </div>
    <div class="note good">
      <strong>#yap:</strong> ${displayedYap} of ${videos.length} paid video rows contain the literal #yap tag. Talking videos without the literal hashtag are priced at the non-talking terms.
    </div>
    <h2>Per-video calculation</h2>
    <table>
      <colgroup>
        <col style="width:3%"><col style="width:5%"><col style="width:6%"><col style="width:29%"><col style="width:8%">
        <col style="width:9%"><col style="width:13%"><col style="width:5%"><col style="width:7%"><col style="width:7%"><col style="width:8%">
      </colgroup>
      <thead><tr>
        <th class="num">#</th><th>Thumbnail</th><th>Posted</th><th>Video</th><th>Account</th>
        <th class="num">Total views</th><th class="num">7-day views minus paid ads</th>
        <th>#yap</th><th class="num">CPM</th><th class="num">Fixed</th><th class="num">Pay</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="footer">
      Calculated for August 1-31, 2026. Views use each video&rsquo;s first seven days intersecting August after any matched paid-ad views. Per-video values are rounded by the payout engine; the total-pay column is authoritative. This report is a calculation record, not proof of transfer.
    </div>`,
  );
}

async function ensureThumbnails(videos) {
  mkdirSync(THUMBNAIL_CACHE, { recursive: true });
  mkdirSync(VIDEO_FRAME_CACHE, { recursive: true });
  let next = 0;
  const failures = [];
  async function worker() {
    while (next < videos.length) {
      const video = videos[next];
      next += 1;
      const destination = thumbnailPath(video);
      try {
        if (readFileSync(destination).length > 500) continue;
      } catch {}
      const platform = video.platform === "INSTAGRAM_REELS" ? "instagram" : "tiktok";
      let thumbnailUrl = `https://assets.viral.app/${platform}/videos/thumbnail/${encodeURIComponent(video.platformVideoId)}.webp`;
      try {
        let response = await fetch(thumbnailUrl);
        if (!response.ok || !String(response.headers.get("content-type")).startsWith("image/")) {
          let fallbackUrl = null;
          try {
            fallbackUrl = execFileSync(
              "yt-dlp",
              ["--skip-download", "--quiet", "--no-warnings", "--print", "%(thumbnail)s", video.url],
              { encoding: "utf8", timeout: 120_000 },
            ).trim().split("\n").at(-1);
          } catch {
            fallbackUrl = null;
          }
          if (!fallbackUrl || fallbackUrl === "NA") {
            const outputTemplate = path.join(VIDEO_FRAME_CACHE, `${video.platformVideoId}.%(ext)s`);
            let downloadedVideo = readdirSync(VIDEO_FRAME_CACHE)
              .map((file) => path.join(VIDEO_FRAME_CACHE, file))
              .find((file) => path.basename(file).startsWith(`${video.platformVideoId}.`));
            if (!downloadedVideo) {
              execFileSync(
                "yt-dlp",
                [
                  "--no-warnings",
                  "--format",
                  "best[height<=720]/best",
                  "--output",
                  outputTemplate,
                  video.url,
                ],
                { stdio: "ignore", timeout: 180_000 },
              );
              downloadedVideo = readdirSync(VIDEO_FRAME_CACHE)
                .map((file) => path.join(VIDEO_FRAME_CACHE, file))
                .find((file) => path.basename(file).startsWith(`${video.platformVideoId}.`));
            }
            if (!downloadedVideo) throw new Error("video download did not produce a file");
            execFileSync(
              "ffmpeg",
              [
                "-y",
                "-ss",
                "00:00:01",
                "-i",
                downloadedVideo,
                "-frames:v",
                "1",
                "-vf",
                "scale=360:-1",
                destination,
              ],
              { stdio: "ignore", timeout: 60_000 },
            );
            rmSync(downloadedVideo, { force: true });
            if (readFileSync(destination).length <= 500) {
              throw new Error("extracted video frame was empty");
            }
            continue;
          }
          thumbnailUrl = fallbackUrl;
          response = await fetch(thumbnailUrl);
        }
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const bytes = Buffer.from(await response.arrayBuffer());
        if (bytes.length <= 500) throw new Error("thumbnail response was empty");
        writeFileSync(destination, bytes);
      } catch (error) {
        failures.push(`${video.platformVideoId}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(16, videos.length) }, () => worker()));
  if (failures.length > 0) {
    throw new Error(`Missing ${failures.length} report thumbnail(s): ${failures.slice(0, 5).join("; ")}`);
  }
}

function queueReport(settlement) {
  const rows = settlement.recipients
    .map(
      (recipient, index) => `<tr>
        <td class="num">${index + 1}</td>
        <td><strong>${escapeHtml(recipient.name)}</strong><br><span class="small">${escapeHtml(recipient.handles.map((handle) => `@${handle}`).join(" + "))}</span></td>
        <td>${escapeHtml(recipient.creatorNames.join(" + "))}</td>
        <td class="num">${integer(recipient.videoCount)}</td>
        <td class="num">${integer(recipient.grossViews)}</td>
        <td class="num">${integer(recipient.yapTagged)}</td>
        <td class="num">${integer(recipient.yapDowngrades)}</td>
        <td class="num"><strong>${money(recipient.totalPay)}</strong></td>
        <td>${escapeHtml(recipient.status)}</td>
      </tr>`,
    )
    .join("");
  const exceptionRows = settlement.exceptions
    .map(
      (exception) => `<tr>
        <td><strong>${escapeHtml(exception.creator)}</strong></td>
        <td>${escapeHtml(exception.claim)}</td>
        <td class="num">${exception.amount == null ? "TBD" : money(exception.amount)}</td>
        <td><span class="pill ${exception.resolved ? "yes" : "no"}">${escapeHtml(exception.action)}</span> ${escapeHtml(exception.status)}</td>
      </tr>`,
    )
    .join("");
  return documentHtml(
    "August 2026 creator payment queue",
    `<div class="page-header">
      <div><div class="eyebrow">GoTall payout control sheet</div><h1>August 2026 payment queue</h1><div class="subtitle">Current August payouts separated from historical claims</div></div>
      <div><div class="amount">${money(settlement.totals.totalPay)}</div><div class="status">${settlement.totals.recipients} recipients | ${settlement.totals.videos} videos</div></div>
    </div>
    <div class="stats">
      ${stat("Recipients", integer(settlement.totals.recipients))}
      ${stat("Local creators", integer(settlement.totals.localCreators))}
      ${stat("Videos", integer(settlement.totals.videos))}
      ${stat("Gross views", integer(settlement.totals.grossViews))}
      ${stat("Fixed pay", money(settlement.totals.fixedPay))}
      ${stat("CPM pay", money(settlement.totals.cpmPay))}
    </div>
    <div class="note good"><strong>August queue:</strong> amounts below are calculated and frozen. None are marked transferred because no independent PayPal, Wise, bank, Zelle, or ledger evidence was found in this run.</div>
    <div class="note"><strong>Independent TikTok reconciliation:</strong> all ${integer(settlement.coverageAudit.originalSettlementTikToks)} TikToks already in the reports were present in the owned tracker. The cross-check found ${integer(settlement.coverageAudit.candidatesMissingFromOriginalSettlement)} candidates omitted by the original Viral inventory; ${integer(settlement.coverageAudit.includedOwnedReconciliationRows)} eligible GoTall rows were added, ${integer(settlement.coverageAudit.excludedUnrelatedRows)} unrelated posts were excluded, and no eligible rows remain unresolved. Added payout: ${money(settlement.coverageAudit.includedOwnedReconciliationPay)}.</div>
    <div class="note warn"><strong>One-cent upper bound:</strong> one Mogg carryover was below Viral.app's top-100 floor. The report uses the response floor of 20 views, paying a conservative maximum of $0.01 rather than underpaying or holding the creator's full August amount.</div>
    <table>
      <colgroup><col style="width:3%"><col style="width:20%"><col style="width:17%"><col style="width:6%"><col style="width:10%"><col style="width:7%"><col style="width:8%"><col style="width:9%"><col style="width:20%"></colgroup>
      <thead><tr><th class="num">#</th><th>Payment recipient</th><th>Creator records</th><th class="num">Videos</th><th class="num">Gross views</th><th class="num">#yap</th><th class="num">Downgrades</th><th class="num">Amount</th><th>Status</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <h2>Historical claims - separate hold queue</h2>
    <div class="note hold"><strong>Do not add these claims to the August transfer amounts.</strong> They remain separate until transfer evidence or defensible source data resolves them.</div>
    <table>
      <colgroup><col style="width:20%"><col style="width:31%"><col style="width:12%"><col style="width:37%"></colgroup>
      <thead><tr><th>Creator</th><th>Claim</th><th class="num">Claim amount</th><th>Status</th></tr></thead>
      <tbody>${exceptionRows}</tbody>
    </table>
    <div class="footer">Mom creators Maddy and mumtipswithginny are excluded because they are paid elsewhere. Creators without a deal applicable to August are excluded from payout warnings. Unrelated posts on otherwise eligible creator accounts are also excluded. Complete calculation and reconciliation artifacts are saved beside this PDF.</div>`,
  );
}

function exceptionReport(settlement) {
  const cards = settlement.exceptions
    .map(
      (exception) => `<div class="card ${exception.resolved ? "good" : "hold"}">
        <div class="eyebrow">${escapeHtml(exception.status)}</div>
        <h2>${escapeHtml(exception.creator)}</h2>
        <h3>${escapeHtml(exception.claim)}${exception.amount == null ? "" : ` | ${money(exception.amount)}`}</h3>
        <p>${escapeHtml(exception.finding)}</p>
      </div>`,
    )
    .join("");
  const discord = settlement.discordAudit;
  return documentHtml(
    "Historical payout exception status",
    `<div class="page-header">
      <div><div class="eyebrow">GoTall exception audit</div><h1>Historical payout exception status</h1><div class="subtitle">Evidence reviewed through September 2, 2026</div></div>
      <div><div class="amount" style="color:var(--red)">2 holds + 1 check</div><div class="status">Kai resolved with no top-up</div></div>
    </div>
    <div class="note hold"><strong>Outcome:</strong> Brady and Bledar's June claim remain on hold. Kai is resolved with no additional payment due. The vibedude / HeightPredictionGuy amount is agreed at $387.50, but it remains outside the August queue until external transfer history confirms that it was not already sent.</div>
    <div class="two-col">${cards}</div>
    <h2>Discord bot check</h2>
    <div class="card">
      <p><strong>Live result:</strong> ${escapeHtml(discord.result)}</p>
      <p><strong>Access:</strong> ${escapeHtml(discord.access)}</p>
      <p><strong>Evidence boundary:</strong> ${escapeHtml(discord.evidenceBoundary)}</p>
      <p class="mono small">Brady ${escapeHtml(discord.channels.Brady)} | Kai ${escapeHtml(discord.channels.Kai)} | Bledar ${escapeHtml(discord.channels.Bledar)} | HeightPredictionGuy ${escapeHtml(discord.channels.HeightPredictionGuy)}</p>
    </div>
    <h2>Resolution detail</h2>
    <table>
      <colgroup><col style="width:15%"><col style="width:21%"><col style="width:14%"><col style="width:50%"></colgroup>
      <thead><tr><th>Creator</th><th>Resolved portion</th><th>Current action</th><th>What is still missing</th></tr></thead>
      <tbody>
        <tr><td><strong>Brady</strong></td><td>Revised incomplete estimate is $456.02.</td><td><span class="pill no">HOLD</span></td><td>Historical Viral tracker coverage sufficient to validate a final July amount, plus transfer evidence.</td></tr>
        <tr><td><strong>Kai</strong></td><td>The owner confirmed the reported shortfall was a misunderstanding.</td><td><span class="pill yes">NO TOP-UP</span></td><td>Nothing. The historical claim is closed with $0 additional due.</td></tr>
        <tr><td><strong>Bledar</strong></td><td>July reconciles to $1,108.72 across both accounts.</td><td><span class="pill no">HOLD JUNE $81.10</span></td><td>Frozen June receipt or transfer-time report proving the alleged $1,454 transfer against the $1,535.10 calculation.</td></tr>
        <tr><td><strong>vibedude33 / HeightPredictionGuy</strong></td><td>Same-person identity, 78 unique GoTall Instagram rows, and final amount of $387.50 are supported.</td><td><span class="pill no">CHECK TRANSFER</span></td><td>Independent PayPal, Wise, bank, or other transfer proof. Pay $387.50 only if the agreed amount was not already sent.</td></tr>
      </tbody>
    </table>
    <h2>Frozen evidence used</h2>
    <ul class="small">
      <li>July revised UGC receipt and per-creator audit pages.</li>
      <li>Brady Viral tracker-loss evidence JSON.</li>
      <li>vibedude invoice audit report, audit JSON, and 78-row video audit CSV.</li>
      <li>Complete live GoTall - Management channel histories and prior payment reconciliation artifacts.</li>
      <li>Current live payout-ledger query: zero rows. This is not proof that no off-platform transfer occurred.</li>
    </ul>
    <div class="footer">This report distinguishes calculation evidence from transfer evidence. A payout report, invoice, or missing database row does not prove that money was or was not sent externally.</div>`,
  );
}

function renderPdf(htmlPath, pdfPath) {
  mkdirSync(path.dirname(CHROME_PROFILE), { recursive: true });
  execFileSync(
    "google-chrome",
    [
      "--headless",
      "--no-sandbox",
      "--disable-gpu",
      "--allow-file-access-from-files",
      `--user-data-dir=${CHROME_PROFILE}`,
      "--no-pdf-header-footer",
      `--print-to-pdf=${pdfPath}`,
      `file://${htmlPath}`,
    ],
    { stdio: "ignore" },
  );
}

async function main() {
  const settlement = JSON.parse(readFileSync(SETTLEMENT_PATH, "utf8"));
  const dealTermsByCreator = await loadDealTerms();
  const sampleIndex = process.argv.indexOf("--sample");
  if (sampleIndex >= 0) {
    const requested = process.argv[sampleIndex + 1];
    if (!requested) throw new Error("--sample requires a recipient name or key");
    const recipient = settlement.recipients.find(
      (row) => row.key === requested || slug(row.name) === slug(requested),
    );
    if (!recipient) throw new Error(`Unknown sample recipient: ${requested}`);
    const sampleVideos = visibleVideos(recipient);
    await ensureThumbnails(sampleVideos);
    rmSync(SAMPLE_TMP, { recursive: true, force: true });
    rmSync(SAMPLE_OUT, { recursive: true, force: true });
    mkdirSync(SAMPLE_TMP, { recursive: true });
    mkdirSync(SAMPLE_OUT, { recursive: true });
    const htmlPath = path.join(SAMPLE_TMP, `${slug(recipient.name)}-sample.html`);
    const pdfPath = path.join(
      SAMPLE_OUT,
      `${slug(recipient.name)}-august-2026-payout-report-sample.pdf`,
    );
    writeFileSync(htmlPath, creatorReport(settlement, recipient, dealTermsByCreator));
    renderPdf(htmlPath, pdfPath);
    console.log(JSON.stringify({ recipient: recipient.name, paidVideoRows: sampleVideos.length, pdfPath }, null, 2));
    return;
  }

  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });

  const queueHtml = path.join(TMP, "00-august-2026-payment-queue.html");
  const queuePdf = path.join(OUT, "00-august-2026-payment-queue.pdf");
  writeFileSync(queueHtml, queueReport(settlement));
  renderPdf(queueHtml, queuePdf);

  const exceptionHtml = path.join(TMP, "01-historical-exception-status.html");
  const exceptionPdf = path.join(OUT, "01-historical-exception-status.pdf");
  writeFileSync(exceptionHtml, exceptionReport(settlement));
  renderPdf(exceptionHtml, exceptionPdf);

  const creatorPdfs = [];
  await ensureThumbnails(settlement.recipients.flatMap(visibleVideos));
  settlement.recipients.forEach((recipient, index) => {
    const prefix = String(index + 10).padStart(2, "0");
    const base = `${prefix}-${slug(recipient.name)}-august-2026-payout-report`;
    const htmlPath = path.join(TMP, `${base}.html`);
    const pdfPath = path.join(OUT, `${base}.pdf`);
    writeFileSync(htmlPath, creatorReport(settlement, recipient, dealTermsByCreator));
    renderPdf(htmlPath, pdfPath);
    creatorPdfs.push(pdfPath);
  });

  execFileSync("pdfunite", [queuePdf, exceptionPdf, ...creatorPdfs, PACKET]);
  copyFileSync(
    path.join(ROOT, "payouts/2026-08/final-settlement/payment-sheet-2026-08.csv"),
    path.join(OUT, "payment-sheet-2026-08.csv"),
  );
  copyFileSync(
    path.join(ROOT, "payouts/2026-08/final-settlement/all-videos-2026-08.csv"),
    path.join(OUT, "all-videos-2026-08.csv"),
  );
  copyFileSync(SETTLEMENT_PATH, path.join(OUT, "settlement.json"));
  for (const file of [
    "excluded-videos-summary.csv",
    "exception-status.json",
    "owned-tiktok-content-review.json",
    "owned-tiktok-missing-candidates.csv",
    "owned-tiktok-paid-view-recovery.json",
    "owned-tiktok-reconciliation.json",
    "owned-tiktok-reconciliation.md",
    "owned-tiktok-video-analysis.json",
    "owned-tiktok-window-recovery.csv",
    "owned-tiktok-window-recovery.json",
  ]) {
    copyFileSync(
      path.join(ROOT, "payouts/2026-08/final-settlement", file),
      path.join(OUT, file),
    );
  }
  const checksumLines = readdirSync(OUT)
    .filter((file) => file !== "SHA256SUMS.txt")
    .sort()
    .map((file) => {
      const digest = createHash("sha256")
        .update(readFileSync(path.join(OUT, file)))
        .digest("hex");
      return `${digest}  ${file}`;
    });
  writeFileSync(path.join(OUT, "SHA256SUMS.txt"), checksumLines.join("\n") + "\n");

  console.log(
    JSON.stringify(
      {
        outputDirectory: OUT,
        individualCreatorReports: creatorPdfs.length,
        controlReports: 2,
        packet: PACKET,
      },
      null,
      2,
    ),
  );
}

await main();
