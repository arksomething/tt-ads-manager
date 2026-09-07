#!/usr/bin/env node

/**
 * Build the frozen August 2026 creator settlement from the complete Viral.app
 * inventory/window exports plus the pay engine receipt.
 *
 * The receipt remains authoritative for paid-view deductions and rows that the
 * standalone inventory missed. The standalone inventory fills provider top-100
 * gaps. The mandatory #yap policy is then applied per video.
 */

import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = "/home/ark296/projects/tt-ads-manager";
const require = createRequire(path.join(ROOT, "web/package.json"));
const { Client } = require("pg");

const CAMPAIGN_ID = "8a7bd7e4-94c8-4dfe-a7c4-7a7b59024292";
const PERIOD_START = "2026-08-01";
const PERIOD_END = "2026-08-31";
const VIDEO_WINDOW_START = "2026-07-25";
const OUT = path.join(ROOT, "payouts/2026-08/final-settlement");
const RECEIPT_PATH = path.join(ROOT, "payouts/2026-08/audit-reports/receipt.csv");
const JULY_RECEIPT_PATH = path.join(ROOT, "payouts/2026-07/audit-reports-rev2/receipt.csv");
const SOURCE_DIR = path.join(OUT, "source");
const INVENTORY_PATH = path.join(SOURCE_DIR, "viral-august-inventory.json");
const WINDOW_PATH = path.join(SOURCE_DIR, "viral-august-window-results.json");
const ANALYSIS_PATH = path.join(SOURCE_DIR, "viral-august-video-analysis.json");
const OWNED_RECONCILIATION_PATH = path.join(OUT, "owned-tiktok-reconciliation.json");
const OWNED_EXPORT_PATH = path.join(OUT, "owned-tiktok-window-export.json");
const OWNED_RECOVERY_PATH = path.join(OUT, "owned-tiktok-window-recovery.json");
const OWNED_ANALYSIS_PATH = path.join(OUT, "owned-tiktok-video-analysis.json");
const OWNED_PAID_PATH = path.join(OUT, "owned-tiktok-paid-view-recovery.json");
const OWNED_CONTENT_REVIEW_PATH = path.join(OUT, "owned-tiktok-content-review.json");

const MOM_CREATOR_NAMES = new Set(["maddy", "mumtipswithginny"]);
const DISCORD_CHANNELS = {
  Brady: "1498823851797250178",
  Kai: "1510663794043519157",
  Bledar: "1444092726399340626",
  HeightPredictionGuy: "1514997557187575828",
};

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (character !== "\r") {
      field += character;
    }
  }
  if (field || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function csvCell(value) {
  const text = value == null ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function toCsv(rows) {
  return rows.map((row) => row.map(csvCell).join(",")).join("\n") + "\n";
}

function parseReceipt(receiptPath) {
  const rows = parseCsv(readFileSync(receiptPath, "utf8"));
  const creatorsIndex = rows.findIndex((row) => row[0] === "CREATORS");
  const videosIndex = rows.findIndex((row) => row[0] === "VIDEOS");
  if (creatorsIndex < 0 || videosIndex < 0) {
    throw new Error(`Invalid receipt: ${receiptPath}`);
  }
  const meta = Object.fromEntries(
    rows.slice(0, creatorsIndex).filter((row) => row.length === 2),
  );
  const creators = rows
    .slice(creatorsIndex + 2, videosIndex)
    .filter((row) => row[0])
    .map((row) => ({
      name: row[0],
      handle: row[1],
      videoCount: Number(row[4]),
      totalPay: Number(row[10]),
    }));
  const videos = rows
    .slice(videosIndex + 2)
    .filter((row) => row[0] && row[1])
    .map((row) => ({
      creatorName: row[0],
      url: row[1],
      caption: row[2],
      publishedDate: row[3],
      calculatorTalking: row[4] === "yes",
      grossViews: Number(row[5]),
      paidViewsDeducted: Number(row[6]),
      payableViews: Number(row[7]),
      cpm: Number(row[8]),
      fixedFee: Number(row[9]),
      cpmPay: Number(row[10]),
      videoPay: Number(row[11]),
      paidStatus: row[12],
      hasVideoDealOverride: row[13] === "yes",
    }));
  return { meta, creators, videos };
}

function readEnvironment(name) {
  for (const envPath of [path.join(ROOT, "web/.env.local"), path.join(ROOT, "web/.env")]) {
    let text = "";
    try {
      text = readFileSync(envPath, "utf8");
    } catch {
      continue;
    }
    const match = text.match(new RegExp(`^${name}="?([^"\\n]+)"?`, "m"));
    if (match) return match[1];
  }
  throw new Error(`${name} is not configured`);
}

function normalizeHandle(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/^@/, "")
    .replace(/[^a-z0-9]/g, "");
}

function platformFromValue(value) {
  const normalized = String(value ?? "").toLowerCase();
  return normalized.includes("instagram") ? "INSTAGRAM_REELS" : "TIKTOK";
}

function extractVideoIdentity(url) {
  const platform = platformFromValue(url);
  const id =
    (url.match(/\/video\/([^/?]+)/i) ?? [])[1] ??
    (url.match(/\/reel\/([^/?]+)/i) ?? [])[1] ??
    null;
  return id ? { platform, id, key: `${platform}:${id}` } : null;
}

function inventoryKey(row) {
  return `${platformFromValue(row.platform)}:${row.platformVideoId}`;
}

function money(value) {
  return Number(Number(value).toFixed(2));
}

function hasYap(caption) {
  return /(?:^|\s)#yap(?:\s|$|[^a-z0-9_])/i.test(String(caption ?? ""));
}

function dateApplies(deal, postedDate) {
  return (
    deal.effectiveStartDate <= postedDate &&
    (deal.effectiveEndDate == null || deal.effectiveEndDate >= postedDate)
  );
}

function calculateAmount({ grossViews, paidViews, paidStatus, deal, fixedFee, priorGrossViews }) {
  const viewCaps = [];
  if (deal.viewCapPerVideo != null) viewCaps.push(deal.viewCapPerVideo);
  if (deal.cpmAmount > 0 && deal.perVideoCapScope === "CPM") {
    viewCaps.push((deal.payoutCapPerVideo / deal.cpmAmount) * 1_000);
  } else if (deal.cpmAmount > 0 && deal.perVideoCapScope === "TOTAL") {
    viewCaps.push((Math.max(deal.payoutCapPerVideo - fixedFee, 0) / deal.cpmAmount) * 1_000);
  }
  const cap = viewCaps.length > 0 ? Math.min(...viewCaps) : null;
  const grossViewsInsideCap =
    cap == null
      ? grossViews
      : Math.max(
          Math.min(priorGrossViews + grossViews, cap) - Math.min(priorGrossViews, cap),
          0,
        );
  const paidViewsDeducted = Math.min(
    deal.deductPaidTraffic && paidStatus === "yes" ? paidViews : 0,
    grossViewsInsideCap,
  );
  const payableViews = Math.max(grossViewsInsideCap - paidViewsDeducted, 0);
  const rawCpmPay = (payableViews / 1_000) * deal.cpmAmount;
  let cpmPay = rawCpmPay;
  let videoPay = fixedFee + rawCpmPay;
  if (deal.perVideoCapScope === "CPM") {
    cpmPay = Math.min(cpmPay, deal.payoutCapPerVideo);
    videoPay = fixedFee + cpmPay;
  } else if (deal.perVideoCapScope === "TOTAL") {
    videoPay = Math.min(videoPay, deal.payoutCapPerVideo);
    cpmPay = Math.max(videoPay - fixedFee, 0);
  }
  return {
    grossViewsInsideCap,
    paidViewsDeducted,
    payableViews,
    cpmPay: money(cpmPay),
    videoPay: money(videoPay),
    capReached: cap != null && grossViewsInsideCap < grossViews,
  };
}

function uniqueByCreator(candidates) {
  const unique = new Map();
  for (const candidate of candidates) unique.set(candidate.creatorId, candidate);
  return [...unique.values()];
}

function recipientIdentity(creator) {
  const name = normalizeHandle(creator.displayName);
  if (name === "bledargotall" || name === "bledarrrrgotall") {
    return { key: "bledar-combined", name: "Bledar - combined accounts" };
  }
  if (name === "mansuhngotall" || name === "heightmuncher67") {
    return { key: "mansuhn-heightmuncher-combined", name: "Mansuhn / heightmuncher67" };
  }
  if (name === "gotallmatthew" || name === "matthewgotall") {
    return { key: "matthew-combined", name: "Matthew - combined accounts" };
  }
  return { key: creator.creatorId, name: creator.displayName };
}

async function loadCampaignData() {
  const databaseUrl = readEnvironment("DATABASE_URL").replace(
    /sslmode=[^&]+/,
    "sslmode=no-verify",
  );
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const creatorsResult = await client.query(
      `
        SELECT cr.id AS "creatorId", cr."displayName", cr."isTalking",
               cc.id AS "campaignCreatorId", cc."dealStatus", cc."payoutStatus"
        FROM "CampaignCreator" cc
        JOIN "Creator" cr ON cr.id = cc."creatorId"
        WHERE cc."campaignId" = $1
      `,
      [CAMPAIGN_ID],
    );
    const accountsResult = await client.query(
      `
        SELECT cr.id AS "creatorId", pa.platform, pa.handle,
               pa."sourceAccountId"
        FROM "CampaignCreator" cc
        JOIN "Creator" cr ON cr.id = cc."creatorId"
        JOIN "CreatorPlatformAccount" pa ON pa."creatorId" = cr.id
        WHERE cc."campaignId" = $1
      `,
      [CAMPAIGN_ID],
    );
    const dealsResult = await client.query(
      `
        SELECT cr.id AS "creatorId", d.id,
               to_char(d."effectiveStartDate", 'YYYY-MM-DD') AS "effectiveStartDate",
               to_char(d."effectiveEndDate", 'YYYY-MM-DD') AS "effectiveEndDate",
               d."fixedFeePerVideo"::float8 AS "fixedFeePerVideo",
               d."cpmAmount"::float8 AS "cpmAmount",
               d."paidTrafficMetric", d."deductPaidTraffic",
               d."viewCapPerVideo", d."payoutCapPerVideo"::float8 AS "payoutCapPerVideo",
               d."perVideoCapScope", d."viewWindowDays", d.notes
        FROM "CampaignCreatorDeal" d
        JOIN "CampaignCreator" cc ON cc.id = d."campaignCreatorId"
        JOIN "Creator" cr ON cr.id = cc."creatorId"
        WHERE cc."campaignId" = $1
        ORDER BY d."effectiveStartDate"
      `,
      [CAMPAIGN_ID],
    );
    const overridesResult = await client.query(
      `
        SELECT cr.id AS "creatorId", vd."sourceVideoId",
               vd."fixedFeePerVideo"::float8 AS "fixedFeePerVideo",
               vd."cpmAmount"::float8 AS "cpmAmount", vd."paidTrafficMetric",
               vd."deductPaidTraffic", vd."viewCapPerVideo",
               vd."payoutCapPerVideo"::float8 AS "payoutCapPerVideo",
               vd."perVideoCapScope", vd.notes
        FROM "CampaignCreatorVideoDeal" vd
        JOIN "CampaignCreator" cc ON cc.id = vd."campaignCreatorId"
        JOIN "Creator" cr ON cr.id = cc."creatorId"
        WHERE cc."campaignId" = $1
      `,
      [CAMPAIGN_ID],
    );
    return {
      creators: creatorsResult.rows,
      accounts: accountsResult.rows,
      deals: dealsResult.rows,
      overrides: overridesResult.rows,
    };
  } finally {
    await client.end();
  }
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const receipt = parseReceipt(RECEIPT_PATH);
  const julyReceipt = parseReceipt(JULY_RECEIPT_PATH);
  const inventory = JSON.parse(readFileSync(INVENTORY_PATH, "utf8"));
  const windowRows = JSON.parse(readFileSync(WINDOW_PATH, "utf8"));
  const analysisRows = JSON.parse(readFileSync(ANALYSIS_PATH, "utf8"));
  const ownedReconciliation = JSON.parse(readFileSync(OWNED_RECONCILIATION_PATH, "utf8"));
  const ownedExport = JSON.parse(readFileSync(OWNED_EXPORT_PATH, "utf8"));
  const ownedRecovery = JSON.parse(readFileSync(OWNED_RECOVERY_PATH, "utf8"));
  const ownedAnalysisRows = JSON.parse(readFileSync(OWNED_ANALYSIS_PATH, "utf8"));
  const ownedPaidRecovery = JSON.parse(readFileSync(OWNED_PAID_PATH, "utf8"));
  const ownedContentReview = JSON.parse(readFileSync(OWNED_CONTENT_REVIEW_PATH, "utf8"));
  const campaign = await loadCampaignData();

  const creatorById = new Map(campaign.creators.map((creator) => [creator.creatorId, creator]));
  const accountsBySource = new Map();
  const accountsByHandle = new Map();
  const accountsByCreator = new Map();
  for (const account of campaign.accounts) {
    const platform = platformFromValue(account.platform);
    const enriched = { ...account, platform };
    if (account.sourceAccountId) {
      const key = `${platform}:${account.sourceAccountId}`;
      if (!accountsBySource.has(key)) accountsBySource.set(key, []);
      accountsBySource.get(key).push(enriched);
    }
    const handleKey = `${platform}:${normalizeHandle(account.handle)}`;
    if (!accountsByHandle.has(handleKey)) accountsByHandle.set(handleKey, []);
    accountsByHandle.get(handleKey).push(enriched);
    if (!accountsByCreator.has(account.creatorId)) accountsByCreator.set(account.creatorId, []);
    accountsByCreator.get(account.creatorId).push(enriched);
  }

  const dealsByCreator = new Map();
  for (const deal of campaign.deals) {
    if (!dealsByCreator.has(deal.creatorId)) dealsByCreator.set(deal.creatorId, []);
    dealsByCreator.get(deal.creatorId).push(deal);
  }
  const overridesByKey = new Map(
    campaign.overrides.map((override) => [
      `${override.creatorId}:${override.sourceVideoId}`,
      override,
    ]),
  );

  const receiptCreatorByName = new Map(receipt.creators.map((row) => [row.name, row]));
  const julyByVideoId = new Map();
  for (const video of julyReceipt.videos) {
    const identity = extractVideoIdentity(video.url);
    if (identity) julyByVideoId.set(identity.id, video);
  }
  const inventoryByKey = new Map(inventory.map((row) => [inventoryKey(row), row]));
  const windowByKey = new Map(windowRows.map((row) => [inventoryKey(row), row]));
  const analysisByKey = new Map(analysisRows.map((row) => [inventoryKey(row), row]));
  const ownedAnalysisById = new Map(
    ownedAnalysisRows.map((row) => [String(row.platformVideoId), row]),
  );
  const ownedPaidById = new Map(
    ownedPaidRecovery.rows.map((row) => [String(row.sourceVideoId), row]),
  );
  const ownedTotalViewsById = new Map(
    ownedExport.rows.map((row) => [String(row.platformVideoId), Number(row.maxDirectViews ?? 0)]),
  );

  function resolveAccount({ platform, sourceAccountId, handle }) {
    let candidates = [];
    let method = null;
    if (sourceAccountId) {
      candidates = uniqueByCreator(
        accountsBySource.get(`${platform}:${sourceAccountId}`) ?? [],
      );
      if (candidates.length > 0) method = "sourceAccountId";
    }
    if (candidates.length === 0 && handle) {
      candidates = uniqueByCreator(
        accountsByHandle.get(`${platform}:${normalizeHandle(handle)}`) ?? [],
      );
      if (candidates.length > 0) method = "handle";
    }
    if (candidates.length === 1) return { account: candidates[0], method };
    if (candidates.length > 1) {
      return {
        account: null,
        method: "ambiguous",
        ambiguity: candidates.map((candidate) => candidate.creatorId),
      };
    }
    return { account: null, method: "unmatched" };
  }

  const merged = new Map();
  for (const raw of receipt.videos) {
    const identity = extractVideoIdentity(raw.url);
    if (!identity) continue;
    const creatorSummary = receiptCreatorByName.get(raw.creatorName);
    const resolved = resolveAccount({
      platform: identity.platform,
      handle: creatorSummary?.handle ?? raw.creatorName,
    });
    merged.set(identity.key, {
      key: identity.key,
      platform: identity.platform,
      platformVideoId: identity.id,
      url: raw.url,
      caption: raw.caption,
      publishedDate: raw.publishedDate,
      raw,
      resolved,
      source: "receipt-only",
    });
  }

  for (const inventoryRow of inventory) {
    const key = inventoryKey(inventoryRow);
    const windowRow = windowByKey.get(key);
    const analysis = analysisByKey.get(key);
    const platform = platformFromValue(inventoryRow.platform);
    const resolved = resolveAccount({
      platform,
      sourceAccountId: inventoryRow.platformAccountId,
      handle: inventoryRow.accountUsername,
    });
    const existing = merged.get(key);
    const base = existing ?? {
      key,
      platform,
      platformVideoId: inventoryRow.platformVideoId,
      raw: null,
      source: "inventory-only",
    };
    merged.set(key, {
      ...base,
      url: inventoryRow.url ?? base.url,
      caption: inventoryRow.caption ?? base.caption,
      publishedDate: inventoryRow.publishedDate ?? base.publishedDate,
      inventory: inventoryRow,
      window: windowRow?.window ?? null,
      analysis,
      resolved: resolved.account ? resolved : base.resolved,
      source: existing ? "receipt+inventory" : "inventory-only",
    });
  }

  for (const recoveredRow of ownedRecovery.rows) {
    const platformVideoId = String(recoveredRow.platformVideoId);
    const key = `TIKTOK:${platformVideoId}`;
    if (merged.has(key)) {
      throw new Error(`Owned reconciliation row already exists in settlement inventory: ${key}`);
    }
    const review = ownedContentReview.videoDecisions[platformVideoId] ?? {
      eligible: ownedContentReview.defaultDecision === "eligible",
      reason: "applicable campaign deal and no conflicting campaign evidence",
    };
    const recoveredWindow = review.windowOverride
      ? { ...recoveredRow.window, ...review.windowOverride }
      : recoveredRow.window;
    if (review.eligible && recoveredWindow.views == null) {
      throw new Error(`Eligible owned reconciliation row has no payout-window views: ${key}`);
    }
    const resolved = resolveAccount({
      platform: "TIKTOK",
      sourceAccountId: recoveredRow.nativeAccountId,
      handle: recoveredRow.handle,
    });
    merged.set(key, {
      key,
      platform: "TIKTOK",
      platformVideoId,
      url: recoveredRow.url,
      caption: recoveredRow.caption,
      publishedDate: recoveredRow.publishedDate,
      inventory: {
        platform: "tiktok",
        platformVideoId,
        url: recoveredRow.url,
        caption: recoveredRow.caption,
        publishedDate: recoveredRow.publishedDate,
        accountUsername: recoveredRow.handle,
        platformAccountId: recoveredRow.nativeAccountId,
        hasYap: recoveredRow.hasYap,
      },
      window: recoveredWindow,
      analysis: ownedAnalysisById.get(platformVideoId) ?? null,
      paid: ownedPaidById.get(platformVideoId) ?? null,
      resolved,
      review,
      source: "owned-reconciliation",
      raw: null,
    });
  }

  const excluded = [];
  const calculatedVideos = [];
  for (const row of merged.values()) {
    if (row.publishedDate < VIDEO_WINDOW_START || row.publishedDate > PERIOD_END) {
      excluded.push({ ...row, reason: "outside source video range" });
      continue;
    }
    if (row.review?.eligible === false) {
      excluded.push({ ...row, reason: row.review.reason });
      continue;
    }
    if (!row.raw && row.window?.status === "outside_august") {
      excluded.push({ ...row, reason: "first seven days do not intersect August" });
      continue;
    }
    const account = row.resolved?.account;
    if (!account) {
      excluded.push({
        ...row,
        reason:
          row.resolved?.method === "ambiguous"
            ? "ambiguous across different local creators"
            : "no local creator/account match",
      });
      continue;
    }
    const creator = creatorById.get(account.creatorId);
    if (!creator) {
      excluded.push({ ...row, reason: "no campaign creator" });
      continue;
    }
    if (MOM_CREATOR_NAMES.has(normalizeHandle(creator.displayName))) {
      excluded.push({ ...row, creator, reason: "mom creator - paid elsewhere" });
      continue;
    }
    const applicableDeals = (dealsByCreator.get(creator.creatorId) ?? []).filter((deal) =>
      dateApplies(deal, row.publishedDate),
    );
    const deal = applicableDeals.at(-1);
    if (!deal) {
      excluded.push({ ...row, creator, reason: "no applicable August deal" });
      continue;
    }

    const override = overridesByKey.get(`${creator.creatorId}:${row.platformVideoId}`) ?? null;
    const effectiveBaseDeal = override
      ? {
          ...deal,
          fixedFeePerVideo: override.fixedFeePerVideo,
          cpmAmount: override.cpmAmount ?? deal.cpmAmount,
          paidTrafficMetric: override.paidTrafficMetric,
          deductPaidTraffic: override.deductPaidTraffic,
          viewCapPerVideo: override.viewCapPerVideo,
          payoutCapPerVideo: override.payoutCapPerVideo ?? deal.payoutCapPerVideo,
          perVideoCapScope: override.perVideoCapScope,
          notes: override.notes ?? deal.notes,
        }
      : deal;
    const taggedYap = row.inventory?.hasYap ?? hasYap(row.caption);
    const talkingTier = effectiveBaseDeal.cpmAmount > 0.5;
    const yapDowngrade = talkingTier && !taggedYap && override == null;
    const effectiveDeal = yapDowngrade
      ? {
          ...effectiveBaseDeal,
          cpmAmount: 0.5,
          payoutCapPerVideo: 100,
          perVideoCapScope: "CPM",
        }
      : effectiveBaseDeal;
    const postedInPeriod =
      row.publishedDate >= PERIOD_START && row.publishedDate <= PERIOD_END;
    const fixedFee = postedInPeriod ? Number(effectiveDeal.fixedFeePerVideo ?? 0) : 0;
    const grossViews = Number(row.raw?.grossViews ?? row.window?.views ?? 0);
    const paidViews = Number(row.raw?.paidViewsDeducted ?? row.paid?.paidViews ?? 0);
    const paidStatus = row.raw?.paidStatus ?? row.paid?.paidStatus ?? "unknown";
    const priorReceiptRow = julyByVideoId.get(row.platformVideoId);
    let priorGrossViews = row.publishedDate < PERIOD_START
      ? Number(priorReceiptRow?.grossViews ?? 0)
      : 0;
    let priorCapContext = priorReceiptRow ? "july receipt" : "not needed";
    if (row.publishedDate < PERIOD_START && !priorReceiptRow) {
      const currentViews = Number(row.inventory?.viewCount ?? 0);
      const tentativeCap =
        effectiveDeal.cpmAmount > 0 && effectiveDeal.perVideoCapScope === "CPM"
          ? (effectiveDeal.payoutCapPerVideo / effectiveDeal.cpmAmount) * 1_000
          : null;
      if (tentativeCap != null && currentViews >= tentativeCap) {
        priorGrossViews = Math.max(currentViews - grossViews, 0);
        priorCapContext = "conservative current counter fallback";
      } else {
        priorCapContext = "below cap - prior split immaterial";
      }
    }

    let result;
    let amountSource;
    const rawAlreadyMatchesPolicy =
      row.raw &&
      !yapDowngrade &&
      Number(row.raw.cpm) === Number(effectiveDeal.cpmAmount) &&
      Number(row.raw.fixedFee) === fixedFee;
    if (rawAlreadyMatchesPolicy) {
      result = {
        grossViewsInsideCap: row.raw.payableViews + row.raw.paidViewsDeducted,
        paidViewsDeducted: row.raw.paidViewsDeducted,
        payableViews: row.raw.payableViews,
        cpmPay: row.raw.cpmPay,
        videoPay: row.raw.videoPay,
        capReached: row.raw.payableViews < row.raw.grossViews - row.raw.paidViewsDeducted,
      };
      amountSource = "calculator receipt";
    } else {
      result = calculateAmount({
        grossViews,
        paidViews,
        paidStatus,
        deal: effectiveDeal,
        fixedFee,
        priorGrossViews,
      });
      amountSource = row.raw
        ? yapDowngrade
          ? "receipt repriced for #yap"
          : "receipt recalculated"
        : row.source === "owned-reconciliation"
          ? row.window?.status === "conservative_top100_upper_bound"
            ? "owned reconciliation - conservative Viral upper bound"
            : "owned reconciliation - Viral window recovery"
          : "complete Viral inventory";
    }

    calculatedVideos.push({
      key: row.key,
      platform: row.platform,
      platformVideoId: row.platformVideoId,
      url: row.url,
      caption: row.caption,
      publishedDate: row.publishedDate,
      creatorId: creator.creatorId,
      creatorName: creator.displayName,
      campaignCreatorId: creator.campaignCreatorId,
      accountHandle: row.inventory?.accountUsername ?? account.handle,
      sourceAccountId: row.inventory?.platformAccountId ?? account.sourceAccountId,
      matchMethod: row.resolved.method,
      source: row.source,
      reconciliationNote: row.review?.reason ?? null,
      windowBasis: row.window?.basis ?? null,
      windowStatus: row.window?.status ?? (row.raw ? "receipt" : "unknown"),
      totalViews: Number(
        row.inventory?.viewCount ?? ownedTotalViewsById.get(row.platformVideoId) ?? grossViews,
      ),
      grossViews,
      paidViewsDeducted: result.paidViewsDeducted,
      payableViews: result.payableViews,
      hasYap: taggedYap,
      yapPolicyApplies: talkingTier,
      yapDowngrade,
      workerClassification:
        row.analysis?.final ??
        (row.raw ? (row.raw.calculatorTalking ? "talking" : "non-talking") : "not analyzed"),
      workerEvidence: row.analysis?.video_evidence ?? null,
      baseCpm: Number(effectiveBaseDeal.cpmAmount),
      effectiveCpm: Number(effectiveDeal.cpmAmount),
      payoutCapPerVideo: Number(effectiveDeal.payoutCapPerVideo),
      perVideoCapScope: effectiveDeal.perVideoCapScope,
      fixedFee,
      cpmPay: result.cpmPay,
      videoPay: result.videoPay,
      capReached: result.capReached,
      priorCapContext,
      amountSource,
      hasVideoDealOverride: override != null,
    });
  }

  calculatedVideos.sort(
    (left, right) =>
      right.videoPay - left.videoPay ||
      left.publishedDate.localeCompare(right.publishedDate) ||
      left.platformVideoId.localeCompare(right.platformVideoId),
  );

  const creators = new Map();
  for (const video of calculatedVideos) {
    if (!creators.has(video.creatorId)) {
      const creator = creatorById.get(video.creatorId);
      creators.set(video.creatorId, {
        creatorId: video.creatorId,
        displayName: video.creatorName,
        recipient: recipientIdentity(creator),
        handles: new Set(),
        platforms: new Set(),
        videos: [],
      });
    }
    const creator = creators.get(video.creatorId);
    creator.handles.add(video.accountHandle);
    creator.platforms.add(video.platform);
    creator.videos.push(video);
  }

  const creatorRows = [...creators.values()].map((creator) => ({
    creatorId: creator.creatorId,
    displayName: creator.displayName,
    recipientKey: creator.recipient.key,
    recipientName: creator.recipient.name,
    handles: [...creator.handles].sort(),
    platforms: [...creator.platforms].sort(),
    videoCount: creator.videos.length,
    augustPosts: creator.videos.filter((video) => video.publishedDate >= PERIOD_START).length,
    julyCarryovers: creator.videos.filter((video) => video.publishedDate < PERIOD_START).length,
    grossViews: creator.videos.reduce((sum, video) => sum + video.grossViews, 0),
    paidViewsDeducted: creator.videos.reduce(
      (sum, video) => sum + video.paidViewsDeducted,
      0,
    ),
    payableViews: creator.videos.reduce((sum, video) => sum + video.payableViews, 0),
    fixedPay: money(creator.videos.reduce((sum, video) => sum + video.fixedFee, 0)),
    cpmPay: money(creator.videos.reduce((sum, video) => sum + video.cpmPay, 0)),
    totalPay: money(creator.videos.reduce((sum, video) => sum + video.videoPay, 0)),
    yapTagged: creator.videos.filter((video) => video.hasYap).length,
    yapDowngrades: creator.videos.filter((video) => video.yapDowngrade).length,
    workerTalking: creator.videos.filter((video) => video.workerClassification === "talking").length,
    workerNonTalking: creator.videos.filter(
      (video) => video.workerClassification === "non-talking",
    ).length,
    workerUnavailable: creator.videos.filter(
      (video) => !["talking", "non-talking"].includes(video.workerClassification),
    ).length,
    inventoryOnlyVideos: creator.videos.filter((video) => video.source === "inventory-only").length,
    ownedReconciliationVideos: creator.videos.filter(
      (video) => video.source === "owned-reconciliation",
    ).length,
    receiptOnlyVideos: creator.videos.filter((video) => video.source === "receipt-only").length,
  }));
  // The calculator rounds cpm pay and total video pay independently per row.
  // Derive the displayed aggregate CPM component from total minus fixed so the
  // recipient-level components always reconcile exactly to the amount to send.
  for (const creator of creatorRows) {
    creator.cpmPay = money(creator.totalPay - creator.fixedPay);
  }
  creatorRows.sort((left, right) => right.totalPay - left.totalPay);

  const recipientsMap = new Map();
  for (const creator of creatorRows) {
    if (!recipientsMap.has(creator.recipientKey)) {
      recipientsMap.set(creator.recipientKey, {
        key: creator.recipientKey,
        name: creator.recipientName,
        creators: [],
      });
    }
    recipientsMap.get(creator.recipientKey).creators.push(creator);
  }
  const recipients = [...recipientsMap.values()]
    .map((recipient) => {
      const recipientVideos = calculatedVideos.filter((video) =>
        recipient.creators.some((creator) => creator.creatorId === video.creatorId),
      );
      return {
        ...recipient,
        creatorNames: recipient.creators.map((creator) => creator.displayName),
        handles: [...new Set(recipient.creators.flatMap((creator) => creator.handles))].sort(),
        videoCount: recipientVideos.length,
        augustPosts: recipientVideos.filter((video) => video.publishedDate >= PERIOD_START).length,
        julyCarryovers: recipientVideos.filter((video) => video.publishedDate < PERIOD_START).length,
        grossViews: recipientVideos.reduce((sum, video) => sum + video.grossViews, 0),
        paidViewsDeducted: recipientVideos.reduce(
          (sum, video) => sum + video.paidViewsDeducted,
          0,
        ),
        payableViews: recipientVideos.reduce((sum, video) => sum + video.payableViews, 0),
        fixedPay: money(recipientVideos.reduce((sum, video) => sum + video.fixedFee, 0)),
        cpmPay: money(recipientVideos.reduce((sum, video) => sum + video.cpmPay, 0)),
        totalPay: money(recipientVideos.reduce((sum, video) => sum + video.videoPay, 0)),
        yapTagged: recipientVideos.filter((video) => video.hasYap).length,
        yapDowngrades: recipientVideos.filter((video) => video.yapDowngrade).length,
        workerTalking: recipientVideos.filter(
          (video) => video.workerClassification === "talking",
        ).length,
        workerNonTalking: recipientVideos.filter(
          (video) => video.workerClassification === "non-talking",
        ).length,
        workerUnavailable: recipientVideos.filter(
          (video) => !["talking", "non-talking"].includes(video.workerClassification),
        ).length,
        inventoryOnlyVideos: recipientVideos.filter(
          (video) => video.source === "inventory-only",
        ).length,
        ownedReconciliationVideos: recipientVideos.filter(
          (video) => video.source === "owned-reconciliation",
        ).length,
        receiptOnlyVideos: recipientVideos.filter(
          (video) => video.source === "receipt-only",
        ).length,
        videos: recipientVideos,
        status: recipientVideos.some(
          (video) => video.windowStatus === "conservative_top100_upper_bound",
        )
          ? "CALCULATED - READY TO SEND; includes $0.01 conservative upper bound; transfer not verified"
          : "CALCULATED - READY TO SEND; transfer not verified",
      };
    })
    .filter((recipient) => recipient.totalPay > 0)
    .sort((left, right) => right.totalPay - left.totalPay);
  for (const recipient of recipients) {
    recipient.cpmPay = money(recipient.totalPay - recipient.fixedPay);
  }

  const exceptions = [
    {
      creator: "Brady",
      claim: "Incomplete July estimate",
      amount: 456.02,
      action: "HOLD",
      status: "UNRESOLVED - HOLD HISTORICAL TOP-UP",
      resolved: false,
      finding:
        "The revised July estimate is $456.02, but Viral tracker history loss prevents validating it as a final amount. The complete GoTall - Management channel history contains no later resolution or transfer confirmation.",
    },
    {
      creator: "Kai",
      claim: "Reported missing-video claim",
      amount: 0,
      action: "NO TOP-UP",
      status: "RESOLVED - NO ADDITIONAL PAYMENT DUE",
      resolved: true,
      finding:
        "Kai reported receiving EUR 383 against nearly EUR 600 on August 6, but the owner has confirmed that this was a misunderstanding rather than an unpaid balance. No additional payment is due. Blaize's preliminary reply that the team would check is not treated as authoritative payout evidence.",
    },
    {
      creator: "Bledar",
      claim: "June $81.10 claim",
      amount: 81.1,
      action: "HOLD",
      status: "UNRESOLVED - HOLD HISTORICAL TOP-UP",
      resolved: false,
      finding:
        "July is reconciled at $1,108.72 across both accounts. The GoTall - Management channel corroborates that Bledar raised the June $81.10 difference, but it does not prove the claim; there is no frozen June receipt, transfer-time report, or later resolution.",
    },
    {
      creator: "vibedude33 / HeightPredictionGuy",
      claim: "Agreed invoice payment",
      amount: 387.5,
      action: "CHECK TRANSFER",
      status: "AMOUNT AGREED - VERIFY WHETHER TRANSFERRED",
      resolved: false,
      finding:
        "The creator explicitly identified $387.50 as the final payment in the GoTall - Management channel and staff acknowledged it. That resolves the intended amount, but not the transfer: later follow-ups asked when it would arrive, and no payment confirmation, payout-ledger row, or receipt was found. Check external transfer history; pay $387.50 only if it was not already sent.",
    },
  ];

  const totalPay = money(recipients.reduce((sum, recipient) => sum + recipient.totalPay, 0));
  const settlement = {
    generatedAt: new Date().toISOString(),
    organization: "gotall",
    campaignId: CAMPAIGN_ID,
    period: { start: PERIOD_START, end: PERIOD_END, timezone: "UTC" },
    settings: {
      payMode: "gained",
      videoWindowStart: VIDEO_WINDOW_START,
      viewWindowMode: "first-days",
      globalViewWindowDays: 7,
      videoFetchMode: "per-creator",
      includeInstagram: true,
      yapRule:
        "Talking-tier video requires #yap. Missing #yap is repriced to $0.50 CPM with a $100 CPM cap. Fixed per-video fees remain payable.",
    },
    sources: {
      receipt: RECEIPT_PATH,
      julyReceipt: JULY_RECEIPT_PATH,
      inventory: INVENTORY_PATH,
      windows: WINDOW_PATH,
      workerAnalysis: ANALYSIS_PATH,
      ownedTrackerReconciliation: OWNED_RECONCILIATION_PATH,
      ownedWindowRecovery: OWNED_RECOVERY_PATH,
      ownedWorkerAnalysis: OWNED_ANALYSIS_PATH,
      ownedPaidViewRecovery: OWNED_PAID_PATH,
      ownedContentReview: OWNED_CONTENT_REVIEW_PATH,
      rawReceiptTotal: Number(receipt.meta["Total pay"]),
      rawReceiptVideos: Number(receipt.meta.Videos),
      viralInventoryVideos: inventory.length,
    },
    matchingPolicy: [
      "Match sourceAccountId to Viral platformAccountId first.",
      "Treat repeated keys from the same Viral account ID as one match.",
      "Only call a match ambiguous when different local creators collide.",
      "Exclude creators without a deal applicable to the video publication date.",
      "Exclude Maddy and mumtipswithginny because mom creators are paid elsewhere.",
      "Use the owned tracker only as an independent TikTok inventory cross-check; calculate recovered rows with Viral.app payout-window counters.",
      "Exclude unrelated profile or other-campaign posts after caption and visual review.",
    ],
    totals: {
      recipients: recipients.length,
      localCreators: creatorRows.filter((creator) => creator.totalPay > 0).length,
      videos: recipients.reduce((sum, recipient) => sum + recipient.videoCount, 0),
      augustPosts: recipients.reduce((sum, recipient) => sum + recipient.augustPosts, 0),
      julyCarryovers: recipients.reduce((sum, recipient) => sum + recipient.julyCarryovers, 0),
      grossViews: recipients.reduce((sum, recipient) => sum + recipient.grossViews, 0),
      paidViewsDeducted: recipients.reduce(
        (sum, recipient) => sum + recipient.paidViewsDeducted,
        0,
      ),
      payableViews: recipients.reduce((sum, recipient) => sum + recipient.payableViews, 0),
      fixedPay: money(recipients.reduce((sum, recipient) => sum + recipient.fixedPay, 0)),
      cpmPay: money(totalPay - recipients.reduce((sum, recipient) => sum + recipient.fixedPay, 0)),
      totalPay,
      yapTagged: recipients.reduce((sum, recipient) => sum + recipient.yapTagged, 0),
      yapDowngrades: recipients.reduce((sum, recipient) => sum + recipient.yapDowngrades, 0),
      workerTalking: recipients.reduce((sum, recipient) => sum + recipient.workerTalking, 0),
      workerNonTalking: recipients.reduce(
        (sum, recipient) => sum + recipient.workerNonTalking,
        0,
      ),
      workerUnavailable: recipients.reduce(
        (sum, recipient) => sum + recipient.workerUnavailable,
        0,
      ),
    },
    coverageAudit: {
      ownedWindowTikToks: ownedReconciliation.summary.ownedWindowVideos,
      originalSettlementTikToks: ownedReconciliation.summary.settlementTikTokVideos,
      originalSettlementIdsMissingFromOwned:
        ownedReconciliation.summary.settlementVideosMissingFromOwned,
      candidatesMissingFromOriginalSettlement: ownedRecovery.summary.candidates,
      recoveredWithViralCounter: ownedRecovery.summary.found,
      confirmedZeroByCompleteViralResult: ownedRecovery.summary.completeZero,
      conservativelyBoundedRows: Object.values(ownedContentReview.videoDecisions).filter(
        (decision) => decision.windowOverride?.status === "conservative_top100_upper_bound",
      ).length,
      excludedUnrelatedRows: Object.values(ownedContentReview.videoDecisions).filter(
        (decision) => decision.eligible === false,
      ).length,
      includedOwnedReconciliationRows: calculatedVideos.filter(
        (video) => video.source === "owned-reconciliation",
      ).length,
      includedOwnedReconciliationViews: calculatedVideos
        .filter((video) => video.source === "owned-reconciliation")
        .reduce((sum, video) => sum + video.grossViews, 0),
      includedOwnedReconciliationPay: money(
        calculatedVideos
          .filter((video) => video.source === "owned-reconciliation")
          .reduce((sum, video) => sum + video.videoPay, 0),
      ),
      unresolvedEligibleRows: ownedRecovery.rows.filter((row) => {
        const decision = ownedContentReview.videoDecisions[String(row.platformVideoId)] ?? {
          eligible: ownedContentReview.defaultDecision === "eligible",
        };
        return decision.eligible && row.window.views == null && !decision.windowOverride;
      }).length,
      paidViewRecoveryStatus:
        "No exact paid delivery was matched for the recovered rows. Paid status remains unknown where external ad-post mapping was unresolved; no paid views were deducted without exact evidence.",
    },
    discordAudit: {
      attemptedAt: new Date().toISOString(),
      botId: "1534630446959427686",
      botUsername: "GoTall - Management",
      guildId: "1400610531189985310",
      channels: DISCORD_CHANNELS,
      result:
        "Live reads succeeded for all four private creator channels using GoTall - Management, and the complete available message histories were reviewed.",
      access:
        "No channel self-add was required. GoTall - Management already has Administrator, Manage Channels, View Channel, and Read Message History permissions.",
      histories: {
        Brady: { messages: 414, start: "2026-04-28", end: "2026-09-02" },
        Kai: { messages: 406, start: "2026-05-31", end: "2026-09-02" },
        Bledar: { messages: 669, start: "2025-11-28", end: "2026-09-02" },
        HeightPredictionGuy: { messages: 132, start: "2026-06-12", end: "2026-08-25" },
      },
      evidenceBoundary:
        "Live private-channel evidence was reviewed through each channel's latest available message, together with frozen payout artifacts. Discord messages can establish what was discussed or agreed, but do not by themselves prove that an external transfer occurred.",
    },
    recipients,
    creators: creatorRows,
    exceptions,
    excludedSummary: Object.entries(
      excluded.reduce((summary, row) => {
        summary[row.reason] = (summary[row.reason] ?? 0) + 1;
        return summary;
      }, {}),
    )
      .map(([reason, count]) => ({ reason, count }))
      .sort((left, right) => right.count - left.count),
  };

  writeFileSync(path.join(OUT, "settlement.json"), JSON.stringify(settlement, null, 2) + "\n");
  writeFileSync(
    path.join(OUT, "payment-sheet-2026-08.csv"),
    toCsv([
      [
        "Payment recipient",
        "Creator accounts",
        "Handles",
        "August pay USD",
        "Videos",
        "August posts",
        "July carryovers",
        "Gross views",
        "Paid views deducted",
        "Payable views",
        "#yap tagged",
        "#yap downgrades",
        "Status",
      ],
      ...recipients.map((recipient) => [
        recipient.name,
        recipient.creatorNames.join(" + "),
        recipient.handles.map((handle) => `@${handle}`).join(" + "),
        recipient.totalPay.toFixed(2),
        recipient.videoCount,
        recipient.augustPosts,
        recipient.julyCarryovers,
        recipient.grossViews,
        recipient.paidViewsDeducted,
        recipient.payableViews,
        recipient.yapTagged,
        recipient.yapDowngrades,
        recipient.status,
      ]),
      ["TOTAL", "", "", totalPay.toFixed(2), settlement.totals.videos],
    ]),
  );
  writeFileSync(
    path.join(OUT, "all-videos-2026-08.csv"),
    toCsv([
      [
        "Recipient",
        "Creator",
        "Handle",
        "Platform",
        "Published",
        "Video ID",
        "URL",
        "Caption",
        "Gross August-window views",
        "Paid views deducted",
        "Payable views",
        "#yap",
        "Worker classification",
        "#yap downgrade",
        "Base CPM",
        "Effective CPM",
        "Fixed fee",
        "CPM pay",
        "Video pay",
        "Data source",
        "Match method",
      ],
      ...recipients.flatMap((recipient) =>
        recipient.videos.map((video) => [
          recipient.name,
          video.creatorName,
          `@${video.accountHandle}`,
          video.platform,
          video.publishedDate,
          video.platformVideoId,
          video.url,
          video.caption,
          video.grossViews,
          video.paidViewsDeducted,
          video.payableViews,
          video.hasYap ? "yes" : "no",
          video.workerClassification,
          video.yapDowngrade ? "yes" : "no",
          video.baseCpm,
          video.effectiveCpm,
          video.fixedFee.toFixed(2),
          video.cpmPay.toFixed(2),
          video.videoPay.toFixed(2),
          video.amountSource,
          video.matchMethod,
        ]),
      ),
    ]),
  );
  writeFileSync(
    path.join(OUT, "excluded-videos-summary.csv"),
    toCsv([
      ["Reason", "Count"],
      ...settlement.excludedSummary.map((row) => [row.reason, row.count]),
    ]),
  );
  writeFileSync(path.join(OUT, "exception-status.json"), JSON.stringify(exceptions, null, 2) + "\n");

  console.log(
    JSON.stringify(
      {
        recipients: settlement.totals.recipients,
        localCreators: settlement.totals.localCreators,
        videos: settlement.totals.videos,
        totalPay: settlement.totals.totalPay,
        rawReceiptTotal: settlement.sources.rawReceiptTotal,
        yapDowngrades: settlement.totals.yapDowngrades,
        paymentSheet: path.join(OUT, "payment-sheet-2026-08.csv"),
      },
      null,
      2,
    ),
  );
}

await main();
