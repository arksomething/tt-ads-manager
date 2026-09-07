#!/usr/bin/env node

import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = "/home/ark296/projects/tt-ads-manager";
const WEB = path.join(ROOT, "web");
const OUT = path.join(
  ROOT,
  "payouts/2026-07/disputes/2026-08-12-michael-three-claims",
);
const RECEIPT = path.join(
  ROOT,
  "payouts/2026-07/audit-reports-rev2/receipt.csv",
);
const VERIFICATION = path.join(
  ROOT,
  "payouts/2026-07/audit-reports-rev2/verification.json",
);
const PAYMENT_SHEET = path.join(
  ROOT,
  "payouts/2026-07/payment-sheet-2026-07.csv",
);
const LEGACY_MASTER_RECEIPT = path.join(
  ROOT,
  "payouts/2026-07/ugc-pay-receipt_2026-07-01_2026-07-31_master.csv",
);
const ZIP =
  "/home/ark296/.codex/attachments/bc930418-132d-4184-a457-751dfd27f60d/gotall-july-final-v2 (1).zip";
const INVOICE = path.join(ROOT, "tmp/pdfs/invoice-july.pdf");
const CAMPAIGN_ID = "8a7bd7e4-94c8-4dfe-a7c4-7a7b59024292";

const require = createRequire(path.join(WEB, "package.json"));
const { Client } = require("pg");

function readEnvFile(file) {
  if (!existsSync(file)) return {};
  const result = {};
  for (const rawLine of readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[match[1]] = value;
  }
  return result;
}

const env = {
  ...readEnvFile(path.join(WEB, ".env")),
  ...readEnvFile(path.join(WEB, ".env.local")),
  ...process.env,
};

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (inQuotes) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index++;
        } else {
          inQuotes = false;
        }
      } else {
        field += character;
      }
    } else if (character === '"') {
      inQuotes = true;
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
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function sectionRows(csv, sectionName) {
  const rows = parseCsv(csv);
  const start = rows.findIndex((row) => row[0] === sectionName);
  if (start < 0 || !rows[start + 1]) return [];
  const headers = rows[start + 1];
  const data = [];
  for (let index = start + 2; index < rows.length; index++) {
    const row = rows[index];
    if (!row.some(Boolean)) break;
    const record = Object.fromEntries(
      headers.map((header, column) => [header, row[column] ?? ""]),
    );
    data.push(record);
  }
  return data;
}

function sha256(file) {
  return existsSync(file)
    ? createHash("sha256").update(readFileSync(file)).digest("hex")
    : null;
}

function projectProviderAccount(account) {
  return {
    id: account.id ?? null,
    platform: account.platform ?? null,
    platformAccountId: account.platformAccountId ?? null,
    username: account.username ?? account.initialUsername ?? null,
    displayName: account.displayName ?? null,
    maxVideos: account.maxVideos ?? null,
    individualVideos: account.individualVideos ?? null,
    totalVideosTracked: account.totalVideosTracked ?? null,
    totalVideosRetained: account.totalVideosRetained ?? null,
    totalVideosPublished: account.totalVideosPublished ?? null,
    analyticsLatestLoadAt: account.analyticsLatestLoadAt ?? null,
    latestVideoPublishedAt: account.latestVideoPublishedAt ?? null,
    lastErrorAt: account.lastErrorAt ?? null,
    lastErrorCode: account.lastErrorCode ?? null,
    orgCreatorId: account.orgCreatorId ?? null,
  };
}

function unzipText(entry) {
  return execFileSync("unzip", ["-p", ZIP, entry], { encoding: "utf8" });
}

function getCreatorRowsFromReceipt(text, handles) {
  return sectionRows(text, "CREATORS").filter((row) =>
    handles.includes(row["TikTok handle"]),
  );
}

function getPaymentSheetRows(text, handles) {
  const rows = parseCsv(text);
  const headers = rows[0] ?? [];
  return rows
    .slice(1)
    .map((row) =>
      Object.fromEntries(headers.map((header, column) => [header, row[column] ?? ""])),
    )
    .filter((row) =>
      handles.includes((row["TikTok handle"] ?? "").replace(/^@/, "")),
    );
}

function getPerCreatorSummary(text) {
  const rows = parseCsv(text);
  const headerIndex = rows.findIndex((row) => row[0] === "Creator");
  if (headerIndex < 0 || !rows[headerIndex + 1]) return null;
  return Object.fromEntries(
    rows[headerIndex].map((header, column) => [
      header,
      rows[headerIndex + 1][column] ?? "",
    ]),
  );
}

async function fetchProviderPage(platform, page = 1) {
  const base = env.VIRAL_APP_BASE_URL ?? env.DATA_PROVIDER_BASE_URL;
  const apiKey = env.VIRAL_APP_API_KEY ?? env.DATA_PROVIDER_API_KEY;
  if (!base || !apiKey) throw new Error("viral.app credentials are unavailable");
  const url = new URL("accounts/tracked", base.endsWith("/") ? base : `${base}/`);
  url.searchParams.set("page", String(page));
  url.searchParams.set("perPage", "100");
  url.searchParams.set("platforms", platform);
  url.searchParams.set("viewMode", "internal");
  const response = await fetch(url, {
    headers: { Accept: "application/json", "x-api-key": apiKey },
  });
  if (!response.ok) throw new Error(`viral.app ${platform}: HTTP ${response.status}`);
  return response.json();
}

async function fetchProviderAccounts(platform) {
  const first = await fetchProviderPage(platform, 1);
  const records = [...(first.data ?? [])];
  for (let page = 2; page <= Number(first.pageCount ?? 1); page++) {
    const next = await fetchProviderPage(platform, page);
    records.push(...(next.data ?? []));
  }
  return records;
}

async function getCampaignEvidence() {
  const databaseUrl = env.DATABASE_URL?.replace(
    /sslmode=[^&]+/,
    "sslmode=no-verify",
  );
  if (!databaseUrl) throw new Error("DATABASE_URL is unavailable");
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const creators = await client.query(
      `
        SELECT
          cc.id AS "campaignCreatorId",
          c.id AS "creatorId",
          c."displayName",
          c."isTalking",
          cc."payoutStatus",
          pa.handle,
          pa."sourceAccountId"
        FROM "CampaignCreator" cc
        JOIN "Creator" c ON c.id = cc."creatorId"
        LEFT JOIN "CreatorPlatformAccount" pa
          ON pa."creatorId" = c.id AND pa.platform = 'TIKTOK'
        WHERE cc."campaignId" = $1
        ORDER BY lower(c."displayName"), lower(COALESCE(pa.handle, ''))
      `,
      [CAMPAIGN_ID],
    );
    const selected = creators.rows.filter((row) => {
      const identity = `${row.displayName ?? ""} ${row.handle ?? ""}`.toLowerCase();
      return (
        identity.includes("adam") ||
        identity.includes("heightprediction") ||
        identity.includes("club.growth") ||
        identity.includes("clubgrowth")
      );
    });
    const ids = selected.map((row) => row.campaignCreatorId);
    const creatorIds = selected.map((row) => row.creatorId);
    const deals = ids.length
      ? await client.query(
          `
            SELECT
              "campaignCreatorId",
              "effectiveStartDate",
              "effectiveEndDate",
              "cpmAmount",
              "viewWindowDays",
              "payoutCapPerVideo",
              "perVideoCapScope",
              "payoutCapTotal"
            FROM "CampaignCreatorDeal"
            WHERE "campaignCreatorId" = ANY($1::text[])
            ORDER BY "campaignCreatorId", "effectiveStartDate"
          `,
          [ids],
        )
      : { rows: [] };
    const payouts = creatorIds.length
      ? await client.query(
          `
            SELECT
              "creatorId",
              "campaignCreatorId",
              amount,
              currency,
              status,
              "payoutDate",
              "paymentMethod",
              "createdAt",
              "updatedAt"
            FROM "Payout"
            WHERE "creatorId" = ANY($1::text[])
               OR "campaignCreatorId" = ANY($2::text[])
            ORDER BY "createdAt"
          `,
          [creatorIds, ids],
        )
      : { rows: [] };
    return {
      campaignId: CAMPAIGN_ID,
      campaignCreatorCount: new Set(creators.rows.map((row) => row.creatorId)).size,
      selectedCreators: selected,
      selectedDeals: deals.rows,
      payoutRecords: payouts.rows,
      clubgrowthCampaignMatchCount: creators.rows.filter((row) =>
        `${row.displayName ?? ""} ${row.handle ?? ""}`
          .toLowerCase()
          .replace(/[^a-z0-9]/g, "")
          .includes("clubgrowth"),
      ).length,
    };
  } finally {
    await client.end();
  }
}

const receiptText = readFileSync(RECEIPT, "utf8");
const creatorRows = sectionRows(receiptText, "CREATORS");
const videoRows = sectionRows(receiptText, "VIDEOS");
const creatorMatches = creatorRows.filter((row) =>
  ["adam.gotall", "7552076425029813262"].includes(row["TikTok handle"]),
);
const videoMatches = videoRows.filter((row) =>
  ["Adam", "HeightPredictionGuy"].includes(row.Creator),
);
const disputedHandles = ["adam.gotall", "7552076425029813262"];
const zipReceiptText = unzipText("2026-07/audit-reports/receipt.csv");
const zipPaymentSheetText = unzipText("2026-07/payment-sheet-2026-07.csv");
const zipAdamCreatorText = unzipText("2026-07/creators/adam.gotall.csv");
const zipHeightCreatorText = unzipText(
  "2026-07/creators/7552076425029813262.csv",
);

const [campaign, tiktokAccounts, instagramAccounts] = await Promise.all([
  getCampaignEvidence(),
  fetchProviderAccounts("tiktok"),
  fetchProviderAccounts("instagram"),
]);

const relevantTikTokAccounts = tiktokAccounts
  .filter((account) => {
    const identity = `${account.username ?? ""} ${account.initialUsername ?? ""}`
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
    return ["adamgotall", "heightpredictionguy", "clubgrowth"].some((needle) =>
      identity.includes(needle),
    );
  })
  .map(projectProviderAccount);
const relevantInstagramAccounts = instagramAccounts
  .filter((account) => {
    const identity = `${account.username ?? ""} ${account.initialUsername ?? ""}`
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
    return ["clubgrowth", "influ_rx", "influrx"].some((needle) =>
      identity.includes(needle.replace(/[^a-z0-9]/g, "")),
    );
  })
  .map(projectProviderAccount);

const evidence = {
  generatedAtUtc: new Date().toISOString(),
  scope: "July 2026 final payment batch: clubgrowth, Adam, HeightPredictionGuy",
  sourceHashes: {
    suppliedZipSha256: sha256(ZIP),
    michaelInvoicePdfSha256: sha256(INVOICE),
    finalCleanReceiptSha256: sha256(RECEIPT),
    finalVerificationSha256: sha256(VERIFICATION),
    paymentSheetSha256: sha256(PAYMENT_SHEET),
  },
  finalVerification: JSON.parse(readFileSync(VERIFICATION, "utf8")),
  suppliedZipConsistency: {
    paymentSheetRows: getPaymentSheetRows(zipPaymentSheetText, disputedHandles),
    correctedAuditReceiptRows: getCreatorRowsFromReceipt(
      zipReceiptText,
      disputedHandles,
    ),
    stalePerCreatorRows: [
      getPerCreatorSummary(zipAdamCreatorText),
      getPerCreatorSummary(zipHeightCreatorText),
    ],
  },
  legacyLocalMasterRows: getCreatorRowsFromReceipt(
    readFileSync(LEGACY_MASTER_RECEIPT, "utf8"),
    disputedHandles,
  ),
  campaign,
  provider: {
    relevantTikTokAccounts,
    trackedInstagramAccountCount: instagramAccounts.length,
    relevantInstagramAccounts,
  },
  receipt: {
    creatorMatches,
    adamVideos: videoMatches.filter((row) => row.Creator === "Adam"),
    heightPredictionGuyVideos: videoMatches.filter(
      (row) => row.Creator === "HeightPredictionGuy",
    ),
    clubgrowthWarningPresent: receiptText.includes(
      "Could not associate club.growth with a local creator record",
    ),
    clubgrowthCreatorRowPresent: creatorRows.some((row) =>
      `${row.Creator} ${row["TikTok handle"]}`
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "")
        .includes("clubgrowth"),
    ),
  },
};

mkdirSync(OUT, { recursive: true });
writeFileSync(
  path.join(OUT, "live-and-local-evidence.json"),
  `${JSON.stringify(evidence, null, 2)}\n`,
);

console.log(
  JSON.stringify(
    {
      generatedAtUtc: evidence.generatedAtUtc,
      finalVerification: evidence.finalVerification,
      campaign: evidence.campaign,
      relevantTikTokAccounts,
      trackedInstagramAccountCount: instagramAccounts.length,
      relevantInstagramAccounts,
      receiptCreators: creatorMatches,
      adamVideoRows: evidence.receipt.adamVideos.length,
      heightPredictionVideoRows: evidence.receipt.heightPredictionGuyVideos.length,
      clubgrowthWarningPresent: evidence.receipt.clubgrowthWarningPresent,
      clubgrowthCreatorRowPresent: evidence.receipt.clubgrowthCreatorRowPresent,
    },
    null,
    2,
  ),
);
