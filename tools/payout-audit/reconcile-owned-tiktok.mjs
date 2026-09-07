#!/usr/bin/env node

/**
 * Compare a frozen August settlement with the laptop-owned TikTok inventory.
 *
 * The owned export is produced by a read-only query against the creator tracker.
 * This script resolves accounts to production campaign creators using native
 * platform account IDs first, applies deal dates, and never invents payment
 * amounts when the historical seven-day counter is unavailable.
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
const DEFAULT_SETTLEMENT = path.join(
  ROOT,
  "payouts/2026-08/final-settlement/settlement.json",
);
const DEFAULT_OWNED_EXPORT = path.join(
  ROOT,
  "payouts/2026-08/final-settlement/owned-tiktok-window-export.json",
);
const DEFAULT_VIRAL_INVENTORY = path.join(
  ROOT,
  "payouts/2026-08/final-settlement/source/viral-august-inventory.json",
);
const DEFAULT_OUTPUT = path.join(ROOT, "payouts/2026-08/final-settlement");
const MOM_CREATOR_NAMES = new Set(["maddy", "mumtipswithginny"]);

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
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

function dateOnly(timestamp) {
  return new Date(Number(timestamp)).toISOString().slice(0, 10);
}

function addDays(date, days) {
  const parsed = new Date(`${date}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function dateApplies(deal, publishedDate) {
  return (
    deal.effectiveStartDate <= publishedDate &&
    (deal.effectiveEndDate == null || deal.effectiveEndDate >= publishedDate)
  );
}

function uniqueByCreator(candidates) {
  const unique = new Map();
  for (const candidate of candidates) unique.set(candidate.creatorId, candidate);
  return [...unique.values()];
}

function csvCell(value) {
  const text = value == null ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function toCsv(rows) {
  return rows.map((row) => row.map(csvCell).join(",")).join("\n") + "\n";
}

function hasYap(row) {
  return /(?:^|\s)#yap(?:\s|$|[^a-z0-9_])/i.test(
    `${row.caption ?? ""} ${row.hashtags ?? ""}`,
  );
}

function mentionsGoTall(row) {
  return /(?:@|#)?go\s*tall|gotall/i.test(`${row.caption ?? ""} ${row.hashtags ?? ""}`);
}

async function loadCampaignData() {
  const databaseUrl = readEnvironment("DATABASE_URL").replace(
    /sslmode=[^&]+/,
    "sslmode=no-verify",
  );
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const creators = await client.query(
        `SELECT cr.id AS "creatorId", cr."displayName", cc.id AS "campaignCreatorId"
         FROM "CampaignCreator" cc
         JOIN "Creator" cr ON cr.id = cc."creatorId"
         WHERE cc."campaignId" = $1`,
        [CAMPAIGN_ID],
      );
    const accounts = await client.query(
        `SELECT cr.id AS "creatorId", pa.platform, pa.handle, pa."sourceAccountId"
         FROM "CampaignCreator" cc
         JOIN "Creator" cr ON cr.id = cc."creatorId"
         JOIN "CreatorPlatformAccount" pa ON pa."creatorId" = cr.id
         WHERE cc."campaignId" = $1`,
        [CAMPAIGN_ID],
      );
    const deals = await client.query(
        `SELECT cr.id AS "creatorId", d.id,
                to_char(d."effectiveStartDate", 'YYYY-MM-DD') AS "effectiveStartDate",
                to_char(d."effectiveEndDate", 'YYYY-MM-DD') AS "effectiveEndDate",
                d."fixedFeePerVideo"::float8 AS "fixedFeePerVideo",
                d."cpmAmount"::float8 AS "cpmAmount",
                d."payoutCapPerVideo"::float8 AS "payoutCapPerVideo",
                d."perVideoCapScope", d."deductPaidTraffic", d."viewWindowDays"
         FROM "CampaignCreatorDeal" d
         JOIN "CampaignCreator" cc ON cc.id = d."campaignCreatorId"
         JOIN "Creator" cr ON cr.id = cc."creatorId"
         WHERE cc."campaignId" = $1
         ORDER BY d."effectiveStartDate"`,
        [CAMPAIGN_ID],
      );
    const overrides = await client.query(
        `SELECT cr.id AS "creatorId", vd."sourceVideoId"
         FROM "CampaignCreatorVideoDeal" vd
         JOIN "CampaignCreator" cc ON cc.id = vd."campaignCreatorId"
         JOIN "Creator" cr ON cr.id = cc."creatorId"
         WHERE cc."campaignId" = $1`,
        [CAMPAIGN_ID],
      );
    return {
      creators: creators.rows,
      accounts: accounts.rows,
      deals: deals.rows,
      overrides: overrides.rows,
    };
  } finally {
    await client.end();
  }
}

function buildLookup(campaign) {
  const bySource = new Map();
  const byHandle = new Map();
  for (const account of campaign.accounts) {
    if (String(account.platform).toLowerCase() !== "tiktok") continue;
    if (account.sourceAccountId) {
      if (!bySource.has(account.sourceAccountId)) bySource.set(account.sourceAccountId, []);
      bySource.get(account.sourceAccountId).push(account);
    }
    const handle = normalizeHandle(account.handle);
    if (!byHandle.has(handle)) byHandle.set(handle, []);
    byHandle.get(handle).push(account);
  }
  return { bySource, byHandle };
}

function resolveAccount(row, lookup) {
  let candidates = uniqueByCreator(lookup.bySource.get(row.nativeAccountId) ?? []);
  let method = "sourceAccountId";
  if (candidates.length === 0) {
    candidates = uniqueByCreator(lookup.byHandle.get(normalizeHandle(row.handle)) ?? []);
    method = "handle";
  }
  if (candidates.length === 1) return { account: candidates[0], method };
  if (candidates.length > 1) return { account: null, method: "ambiguous" };
  return { account: null, method: "unmatched" };
}

function summarizeByCreator(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = row.creatorId;
    if (!groups.has(key)) {
      groups.set(key, {
        creatorId: key,
        creator: row.creator,
        handles: new Set(),
        missingVideos: 0,
        augustPosts: 0,
        julyCarryovers: 0,
        directIndependent: 0,
        providerOnly: 0,
        explicitGoTallMentions: 0,
        yapTagged: 0,
        knownAugustFixedFees: 0,
        finalSevenDayCounters: 0,
        countersNeedingReview: 0,
      });
    }
    const group = groups.get(key);
    group.handles.add(row.handle);
    group.missingVideos += 1;
    if (row.publishedDate >= PERIOD_START) group.augustPosts += 1;
    else group.julyCarryovers += 1;
    if (row.independentOwnedEvidence) group.directIndependent += 1;
    else group.providerOnly += 1;
    if (row.mentionsGoTall) group.explicitGoTallMentions += 1;
    if (row.hasYap) group.yapTagged += 1;
    group.knownAugustFixedFees += row.knownAugustFixedFee;
    if (row.finalizationStatus === "final" && row.finalizedGrossViews != null) {
      group.finalSevenDayCounters += 1;
    } else {
      group.countersNeedingReview += 1;
    }
  }
  return [...groups.values()]
    .map((group) => ({ ...group, handles: [...group.handles].sort() }))
    .sort((left, right) => right.missingVideos - left.missingVideos || left.creator.localeCompare(right.creator));
}

async function main() {
  const settlementPath = argument("--settlement", DEFAULT_SETTLEMENT);
  const ownedExportPath = argument("--owned-export", DEFAULT_OWNED_EXPORT);
  const viralInventoryPath = argument("--viral-inventory", DEFAULT_VIRAL_INVENTORY);
  const outputDirectory = argument("--output", DEFAULT_OUTPUT);
  const settlement = JSON.parse(readFileSync(settlementPath, "utf8"));
  const owned = JSON.parse(readFileSync(ownedExportPath, "utf8"));
  const viralInventory = JSON.parse(readFileSync(viralInventoryPath, "utf8"));
  const viralTikTokByVideoId = new Map(
    viralInventory
      .filter((row) => String(row.platform).toLowerCase() === "tiktok")
      .map((row) => [String(row.platformVideoId), row]),
  );
  const campaign = await loadCampaignData();
  const creatorById = new Map(campaign.creators.map((creator) => [creator.creatorId, creator]));
  const dealsByCreator = new Map();
  for (const deal of campaign.deals) {
    if (!dealsByCreator.has(deal.creatorId)) dealsByCreator.set(deal.creatorId, []);
    dealsByCreator.get(deal.creatorId).push(deal);
  }
  const overrideKeys = new Set(
    campaign.overrides.map((override) => `${override.creatorId}:${override.sourceVideoId}`),
  );
  const lookup = buildLookup(campaign);
  const settlementTikTok = settlement.recipients
    .flatMap((recipient) => recipient.videos)
    .filter((video) => video.platform === "TIKTOK");
  const settlementByVideoId = new Map(
    settlementTikTok.map((video) => [video.platformVideoId, video]),
  );
  const ownedByVideoId = new Map(owned.rows.map((row) => [row.platformVideoId, row]));
  const classifications = [];
  const candidates = [];

  for (const row of owned.rows) {
    const publishedDate = dateOnly(row.postedAt);
    if (publishedDate < VIDEO_WINDOW_START || publishedDate > PERIOD_END) continue;
    if (addDays(publishedDate, 6) < PERIOD_START) {
      classifications.push({
        row,
        publishedDate,
        status: "first_seven_days_do_not_intersect_august",
      });
      continue;
    }
    const resolution = resolveAccount(row, lookup);
    if (!resolution.account) {
      classifications.push({ row, publishedDate, status: resolution.method });
      continue;
    }
    const creator = creatorById.get(resolution.account.creatorId);
    if (!creator) {
      classifications.push({ row, publishedDate, status: "not_in_campaign" });
      continue;
    }
    if (MOM_CREATOR_NAMES.has(normalizeHandle(creator.displayName))) {
      classifications.push({ row, publishedDate, status: "mom_creator_paid_elsewhere" });
      continue;
    }
    const deals = (dealsByCreator.get(creator.creatorId) ?? []).filter((deal) =>
      dateApplies(deal, publishedDate),
    );
    const deal = deals.at(-1);
    if (!deal) {
      classifications.push({ row, publishedDate, creator, status: "no_applicable_deal" });
      continue;
    }
    if (settlementByVideoId.has(row.platformVideoId)) {
      classifications.push({ row, publishedDate, creator, deal, status: "present_in_settlement" });
      continue;
    }
    const hasVideoDealOverride = overrideKeys.has(`${creator.creatorId}:${row.platformVideoId}`);
    const candidate = {
      platformVideoId: row.platformVideoId,
      url: row.url,
      publishedDate,
      postedAt: row.postedAt,
      creatorId: creator.creatorId,
      creator: creator.displayName,
      campaignCreatorId: creator.campaignCreatorId,
      handle: row.handle,
      nativeAccountId: row.nativeAccountId,
      viralTrackedAccountId: row.viralTrackedAccountId,
      inViralInventory: viralTikTokByVideoId.has(row.platformVideoId),
      matchMethod: resolution.method,
      sourceKind: row.sourceKind,
      completeDirectObservations: row.completeDirectObservations,
      independentOwnedEvidence:
        row.sourceKind === "owned_tiktok" && row.completeDirectObservations > 0,
      availability: row.availability,
      publishedAtSource: row.publishedAtSource,
      publishedAtConfidence: row.publishedAtConfidence,
      caption: row.caption,
      hasYap: hasYap(row),
      mentionsGoTall: mentionsGoTall(row),
      hasVideoDealOverride,
      dealId: deal.id,
      dealEffectiveStartDate: deal.effectiveStartDate,
      dealEffectiveEndDate: deal.effectiveEndDate,
      fixedFeePerVideo: deal.fixedFeePerVideo,
      baseCpm: deal.cpmAmount,
      effectiveCpm:
        deal.cpmAmount > 0.5 && !hasYap(row) && !hasVideoDealOverride ? 0.5 : deal.cpmAmount,
      payoutCapPerVideo: deal.payoutCapPerVideo,
      knownAugustFixedFee:
        publishedDate >= PERIOD_START ? Number(deal.fixedFeePerVideo ?? 0) : 0,
      finalizationStatus: row.finalizationStatus,
      finalizedGrossViews: row.finalizedGrossViews,
      calculationStatus:
        row.finalizationStatus === "final" && row.finalizedGrossViews != null
          ? "counter_available_but_paid_view_reconciliation_required"
          : "historical_seven_day_counter_unavailable",
    };
    candidates.push(candidate);
    classifications.push({ row, publishedDate, creator, deal, status: "missing_candidate" });
  }

  const settlementNotInOwned = settlementTikTok
    .filter((video) => !ownedByVideoId.has(video.platformVideoId))
    .map((video) => ({
      platformVideoId: video.platformVideoId,
      creator: video.creatorName,
      handle: video.accountHandle,
      publishedDate: video.publishedDate,
      url: video.url,
    }));
  candidates.sort(
    (left, right) =>
      left.creator.localeCompare(right.creator) ||
      left.publishedDate.localeCompare(right.publishedDate) ||
      left.platformVideoId.localeCompare(right.platformVideoId),
  );
  const creators = summarizeByCreator(candidates);
  const statusCounts = Object.fromEntries(
    Object.entries(
      classifications.reduce((counts, item) => {
        counts[item.status] = (counts[item.status] ?? 0) + 1;
        return counts;
      }, {}),
    ).sort(([left], [right]) => left.localeCompare(right)),
  );
  const summary = {
    ownedWindowVideos: owned.rows.length,
    viralInventoryTikTokVideos: viralTikTokByVideoId.size,
    settlementTikTokVideos: settlementTikTok.length,
    settlementVideosMissingFromOwned: settlementNotInOwned.length,
    dealApplicableOwnedVideos: statusCounts.present_in_settlement + statusCounts.missing_candidate,
    presentInSettlement: statusCounts.present_in_settlement,
    missingCandidates: candidates.length,
    missingFromViralInventory: candidates.filter((row) => !row.inViralInventory).length,
    inViralInventoryButNotSettlement: candidates.filter((row) => row.inViralInventory).length,
    independentOwnedMissingCandidates: candidates.filter((row) => row.independentOwnedEvidence).length,
    providerOnlyMissingCandidates: candidates.filter((row) => !row.independentOwnedEvidence).length,
    missingAugustPosts: candidates.filter((row) => row.publishedDate >= PERIOD_START).length,
    missingJulyCarryovers: candidates.filter((row) => row.publishedDate < PERIOD_START).length,
    explicitGoTallMentions: candidates.filter((row) => row.mentionsGoTall).length,
    knownAugustFixedFeeExposure: Number(
      candidates.reduce((total, row) => total + row.knownAugustFixedFee, 0).toFixed(2),
    ),
    candidatesWithFinalSevenDayCounter: candidates.filter(
      (row) => row.finalizationStatus === "final" && row.finalizedGrossViews != null,
    ).length,
    candidatesWithoutFinalSevenDayCounter: candidates.filter(
      (row) => row.finalizationStatus !== "final" || row.finalizedGrossViews == null,
    ).length,
  };
  const report = {
    generatedAt: new Date().toISOString(),
    campaignId: CAMPAIGN_ID,
    period: { start: PERIOD_START, end: PERIOD_END, videoWindowStart: VIDEO_WINDOW_START },
    source: owned,
    settlementPath,
    viralInventoryPath,
    methodology: [
      "Resolve owned nativeAccountId to production CreatorPlatformAccount.sourceAccountId first.",
      "Treat repeated account keys for one local creator as one match; ambiguity requires different creators.",
      "Exclude mom creators and creators without a deal applicable on the publication date.",
      "Compare stable TikTok platform video IDs, not URLs, captions, or display names.",
      "Do not calculate a top-up when a defensible historical seven-day counter is unavailable.",
    ],
    statusCounts,
    summary,
    creators,
    settlementNotInOwned,
    candidates,
  };

  mkdirSync(outputDirectory, { recursive: true });
  writeFileSync(
    path.join(outputDirectory, "owned-tiktok-reconciliation.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  writeFileSync(
    path.join(outputDirectory, "owned-tiktok-missing-candidates.csv"),
    toCsv([
      [
        "Creator",
        "Handle",
        "Published date",
        "TikTok video ID",
        "URL",
        "Independent owned evidence",
        "In Viral inventory",
        "Direct observations",
        "Explicit GoTall mention",
        "#yap",
        "Fixed fee",
        "Base CPM",
        "Effective CPM",
        "Seven-day counter status",
        "Seven-day views",
        "Caption",
      ],
      ...candidates.map((row) => [
        row.creator,
        row.handle,
        row.publishedDate,
        row.platformVideoId,
        row.url,
        row.independentOwnedEvidence ? "yes" : "no",
        row.inViralInventory ? "yes" : "no",
        row.completeDirectObservations,
        row.mentionsGoTall ? "yes" : "no",
        row.hasYap ? "yes" : "no",
        row.knownAugustFixedFee.toFixed(2),
        row.baseCpm.toFixed(2),
        row.effectiveCpm.toFixed(2),
        row.calculationStatus,
        row.finalizedGrossViews ?? "",
        row.caption,
      ]),
    ]),
  );
  writeFileSync(
    path.join(outputDirectory, "owned-tiktok-reconciliation.md"),
    `# August 2026 owned TikTok reconciliation\n\n` +
      `Generated: ${report.generatedAt}\n\n` +
      `## Result\n\n` +
      `- Settlement TikTok videos: **${summary.settlementTikTokVideos}**\n` +
      `- Settlement videos absent from owned inventory: **${summary.settlementVideosMissingFromOwned}**\n` +
      `- Deal-applicable owned TikTok videos: **${summary.dealApplicableOwnedVideos}**\n` +
      `- Owned videos missing from settlement: **${summary.missingCandidates}**\n` +
      `- Missing from Viral inventory / present there but omitted from settlement: **${summary.missingFromViralInventory} / ${summary.inViralInventoryButNotSettlement}**\n` +
      `- Independently observed missing candidates: **${summary.independentOwnedMissingCandidates}**\n` +
      `- Missing August posts / July carryovers: **${summary.missingAugustPosts} / ${summary.missingJulyCarryovers}**\n` +
      `- Explicit GoTall caption/hashtag mentions: **${summary.explicitGoTallMentions}**\n` +
      `- Known August fixed-fee exposure before CPM: **$${summary.knownAugustFixedFeeExposure.toFixed(2)}**\n` +
      `- Candidates with / without a defensible owned seven-day counter: **${summary.candidatesWithFinalSevenDayCounter} / ${summary.candidatesWithoutFinalSevenDayCounter}**\n\n` +
      `## Payment decision\n\n` +
      `The current August PDFs are not safe to send unchanged. Stable TikTok IDs prove the existing ${summary.settlementTikTokVideos} TikTok rows are covered, but ${summary.missingCandidates} deal-applicable owned rows are absent. This reconciliation does not invent CPM top-ups from current counters; missing historical seven-day counters require provider recovery or another frozen source.\n\n` +
      `## By creator\n\n` +
      `| Creator | Handles | Missing | August | Carryover | Direct | GoTall mention | Known fixed fees | Counters needing review |\n` +
      `| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |\n` +
      creators
        .map(
          (row) =>
            `| ${row.creator} | ${row.handles.map((handle) => `@${handle}`).join(", ")} | ${row.missingVideos} | ${row.augustPosts} | ${row.julyCarryovers} | ${row.directIndependent} | ${row.explicitGoTallMentions} | $${row.knownAugustFixedFees.toFixed(2)} | ${row.countersNeedingReview} |`,
        )
        .join("\n") +
      `\n\n## Boundaries\n\n` +
      `- An explicit GoTall mention is supporting evidence, not the only eligibility rule.\n` +
      `- Profile posts for other sponsors or unrelated content remain review candidates until campaign eligibility is confirmed.\n` +
      `- Owned current counters cannot reconstruct an already-expired seven-day payment window.\n` +
      `- No payment, payout status, or production mapping was changed.\n`,
  );

  console.log(JSON.stringify({ summary, creators }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
