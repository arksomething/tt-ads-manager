#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

const ROOT = "/home/ark296/projects/tt-ads-manager";
const WEB = path.join(ROOT, "web");
const DEFAULT_INVOICE =
  "/home/ark296/.codex/attachments/0d2018b1-ae45-49f2-b635-0672cb8978af/invoice 8.13.26 (1).docx";
const DEFAULT_OUT = path.join(
  ROOT,
  "payouts/2026-08/disputes/2026-08-16-vibedude-invoice-audit",
);
const EXPECTED_USERNAME = "vibedude33";
const PLATFORM_ACCOUNT_ID = "16237116894";
const CORRECT_CPM_USD = 0.5;
const INVOICE_CPM_USD = 1;

function readEnvFile(file) {
  if (!existsSync(file)) return {};
  const result = {};
  for (const rawLine of readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = rawLine.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
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

function decodeXmlText(value) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'");
}

function parseInvoice(docxPath) {
  const xml = execFileSync("unzip", ["-p", docxPath, "word/document.xml"], {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
  const text = decodeXmlText(
    xml
      .replaceAll("<w:tab/>", "\t")
      .replaceAll("</w:p>", "\n")
      .replace(/<[^>]+>/g, ""),
  );
  const rows = [];
  const rowPattern =
    /https:\/\/www\.instagram\.com\/vibedude33\/reel\/([^/\s]+)\/?\s*\((july|aug)\s+(\d+)\)\s*\$(\d+(?:\.\d+)?)/gi;
  for (const match of text.matchAll(rowPattern)) {
    const month = match[2].toLowerCase() === "july" ? "07" : "08";
    rows.push({
      invoiceRow: rows.length + 1,
      shortcode: match[1],
      invoiceDate: `2026-${month}-${String(Number(match[3])).padStart(2, "0")}`,
      invoicePayAtOneCpmUsd: Number(match[4]),
    });
  }
  const totalMatch = text.match(/Total cost:\s*\$(\d+(?:\.\d+)?)/i);
  if (!totalMatch) throw new Error("Invoice total was not found.");
  if (rows.length === 0) throw new Error("No invoice rows were found.");
  return { rows, statedTotalUsd: Number(totalMatch[1]) };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchJsonWithRetry(url, apiKey) {
  let lastError;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { Accept: "application/json", "x-api-key": apiKey },
      });
      if (!response.ok) {
        const body = await response.text();
        throw new Error(`HTTP ${response.status}: ${body.slice(0, 300)}`);
      }
      return {
        payload: await response.json(),
        creditsConsumed: Number(
          response.headers.get("x-viral-credits-consumed") ?? 0,
        ),
        creditsRemaining: Number(
          response.headers.get("x-viral-credits-benefited-remaining") ?? 0,
        ),
      };
    } catch (error) {
      lastError = error;
      if (attempt < 4) await sleep(attempt * 1200);
    }
  }
  throw lastError;
}

async function fetchLiveAccountVideos({ baseUrl, apiKey, invoiceShortcodes }) {
  const videos = [];
  let nextPageToken = null;
  let creditsConsumed = 0;
  let creditsRemaining = null;
  let page = 0;
  do {
    page += 1;
    const url = new URL(
      `live/instagram/accounts/${PLATFORM_ACCOUNT_ID}/videos`,
      baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`,
    );
    if (nextPageToken) url.searchParams.set("pageToken", nextPageToken);
    const result = await fetchJsonWithRetry(url, apiKey);
    const pageVideos = Array.isArray(result.payload?.videos)
      ? result.payload.videos
      : [];
    videos.push(...pageVideos);
    creditsConsumed += result.creditsConsumed;
    creditsRemaining = result.creditsRemaining || creditsRemaining;
    nextPageToken = result.payload?.nextPageToken ?? null;
    const found = new Set(
      videos
        .map((video) => video.platform_video_id)
        .filter((shortcode) => invoiceShortcodes.has(shortcode)),
    );
    console.log(
      `[live page ${page}] ${pageVideos.length} videos; ${found.size}/${invoiceShortcodes.size} invoice rows found`,
    );
    if (found.size === invoiceShortcodes.size) break;
    if (page >= 20) throw new Error("Stopped after 20 live-video pages.");
  } while (nextPageToken);
  return { videos, creditsConsumed, creditsRemaining, pagesFetched: page };
}

function roundMoney(value) {
  return Number(value.toFixed(2));
}

function csvCell(value) {
  const text = value == null ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function getRowStatus(row) {
  const issues = [];
  if (!row.liveFound) issues.push("missing_live_video");
  if (row.liveFound && row.owner !== EXPECTED_USERNAME) {
    issues.push("owner_mismatch");
  }
  if (row.liveFound && row.liveDate !== row.invoiceDate) {
    issues.push("date_mismatch");
  }
  if (
    row.liveFound &&
    row.currentViews < row.minimumPlausibleViewsAtRoundedOneCpm
  ) {
    issues.push("claimed_views_above_current_counter");
  }
  return issues.length ? issues.join(";") : "plausible_current_counter";
}

const invoicePath = process.argv[2] || DEFAULT_INVOICE;
const outputDirectory = process.argv[3] || DEFAULT_OUT;
const env = {
  ...readEnvFile(path.join(WEB, ".env")),
  ...readEnvFile(path.join(WEB, ".env.local")),
  ...process.env,
};
const providerBaseUrl = env.VIRAL_APP_BASE_URL ?? env.DATA_PROVIDER_BASE_URL;
const providerApiKey = env.VIRAL_APP_API_KEY ?? env.DATA_PROVIDER_API_KEY;
if (!providerBaseUrl || !providerApiKey) {
  throw new Error("viral.app credentials are unavailable.");
}

const invoice = parseInvoice(invoicePath);
const duplicateShortcodes = [...new Set(
  invoice.rows
    .map((row) => row.shortcode)
    .filter(
      (shortcode, index, values) =>
        values.indexOf(shortcode) !== index,
    ),
)];
const invoiceShortcodes = new Set(invoice.rows.map((row) => row.shortcode));
const live = await fetchLiveAccountVideos({
  baseUrl: providerBaseUrl,
  apiKey: providerApiKey,
  invoiceShortcodes,
});
const liveByShortcode = new Map(
  live.videos.map((video) => [video.platform_video_id, video]),
);

const rows = invoice.rows.map((invoiceRow) => {
  const video = liveByShortcode.get(invoiceRow.shortcode) ?? null;
  const currentViews = Number(video?.view_count ?? 0);
  const row = {
    ...invoiceRow,
    url: `https://www.instagram.com/vibedude33/reel/${invoiceRow.shortcode}/`,
    correctedInvoicePayAt050CpmUsd: roundMoney(
      invoiceRow.invoicePayAtOneCpmUsd *
        (CORRECT_CPM_USD / INVOICE_CPM_USD),
    ),
    invoiceImpliedViewsAtOneCpm: Math.round(
      (invoiceRow.invoicePayAtOneCpmUsd / INVOICE_CPM_USD) * 1000,
    ),
    minimumPlausibleViewsAtRoundedOneCpm: Math.max(
      0,
      Math.round(
        ((invoiceRow.invoicePayAtOneCpmUsd - 0.5) / INVOICE_CPM_USD) *
          1000,
      ),
    ),
    liveFound: Boolean(video),
    owner: video?.account_username ?? null,
    accountDisplayName: video?.account_display_name ?? null,
    liveDate: video?.published_at?.slice(0, 10) ?? null,
    currentViews: video ? currentViews : null,
    currentLifetimePayAt050CpmUsd: video
      ? roundMoney(currentViews * 0.0005)
      : null,
    currentViewsMinusInvoiceImplied: video
      ? currentViews -
        Math.round(
          (invoiceRow.invoicePayAtOneCpmUsd / INVOICE_CPM_USD) * 1000,
        )
      : null,
    likeCount: video?.like_count ?? null,
    commentCount: video?.comment_count ?? null,
    caption: video?.caption ?? null,
  };
  row.status = getRowStatus(row);
  return row;
});

const invoiceRowsSumUsd = roundMoney(
  rows.reduce((sum, row) => sum + row.invoicePayAtOneCpmUsd, 0),
);
const correctedRowsSumUsd = roundMoney(
  rows.reduce((sum, row) => sum + row.correctedInvoicePayAt050CpmUsd, 0),
);
const invoiceImpliedViewsTotal = rows.reduce(
  (sum, row) => sum + row.invoiceImpliedViewsAtOneCpm,
  0,
);
const currentLifetimeViewsTotal = rows.reduce(
  (sum, row) => sum + (row.currentViews ?? 0),
  0,
);
const rowsWithIssues = rows.filter(
  (row) => row.status !== "plausible_current_counter",
);
const currentRoundedAmountBelowClaimRows = rows
  .filter(
    (row) =>
      row.liveFound &&
      Math.round(row.currentViews / 1000) < row.invoicePayAtOneCpmUsd,
  )
  .map((row) => ({
    shortcode: row.shortcode,
    invoicePayAtOneCpmUsd: row.invoicePayAtOneCpmUsd,
    currentViews: row.currentViews,
  }));
const captionsMissingGotallRows = rows
  .filter(
    (row) =>
      row.liveFound && !String(row.caption ?? "").toLowerCase().includes("gotall"),
  )
  .map((row) => row.shortcode);
const summary = {
  generatedAtUtc: new Date().toISOString(),
  invoicePath,
  expectedAccount: EXPECTED_USERNAME,
  platformAccountId: PLATFORM_ACCOUNT_ID,
  invoiceRowCount: rows.length,
  uniqueInvoiceVideoCount: invoiceShortcodes.size,
  duplicateShortcodes,
  invoiceStatedTotalUsd: invoice.statedTotalUsd,
  invoiceRowsSumAtOneCpmUsd: invoiceRowsSumUsd,
  invoiceArithmeticDiscrepancyUsd: roundMoney(
    invoiceRowsSumUsd - invoice.statedTotalUsd,
  ),
  halfOfStatedTotalUsd: roundMoney(invoice.statedTotalUsd / 2),
  correctedRowsSumAt050CpmUsd: correctedRowsSumUsd,
  correctedTotalDiscrepancyVsHalfStatedUsd: roundMoney(
    correctedRowsSumUsd - invoice.statedTotalUsd / 2,
  ),
  livePagesFetched: live.pagesFetched,
  liveVideosFetched: live.videos.length,
  liveCreditsConsumed: live.creditsConsumed,
  liveCreditsRemaining: live.creditsRemaining,
  liveRowsResolved: rows.filter((row) => row.liveFound).length,
  liveRowsMissing: rows.filter((row) => !row.liveFound).map((row) => row.shortcode),
  ownerMismatchRows: rows
    .filter((row) => row.owner && row.owner !== EXPECTED_USERNAME)
    .map((row) => row.shortcode),
  dateMismatchRows: rows
    .filter((row) => row.liveDate && row.liveDate !== row.invoiceDate)
    .map((row) => ({
      shortcode: row.shortcode,
      invoiceDate: row.invoiceDate,
      liveDate: row.liveDate,
    })),
  rowsWithClaimAboveCurrentCounter: rows
    .filter(
      (row) =>
        row.liveFound &&
        row.currentViews < row.minimumPlausibleViewsAtRoundedOneCpm,
    )
    .map((row) => ({
      shortcode: row.shortcode,
      invoicePayAtOneCpmUsd: row.invoicePayAtOneCpmUsd,
      currentViews: row.currentViews,
      minimumPlausibleViewsAtRoundedOneCpm:
        row.minimumPlausibleViewsAtRoundedOneCpm,
    })),
  currentRoundedAmountBelowClaimRows,
  captionsMissingGotallRows,
  rowsWithAnyIssue: rowsWithIssues.map((row) => ({
    shortcode: row.shortcode,
    status: row.status,
  })),
  invoiceImpliedViewsTotal,
  currentLifetimeViewsAcrossInvoiceRows: currentLifetimeViewsTotal,
  currentViewsAboveInvoiceImplied: currentLifetimeViewsTotal - invoiceImpliedViewsTotal,
  currentViewsPercentAboveInvoiceImplied: Number(
    ((currentLifetimeViewsTotal / invoiceImpliedViewsTotal - 1) * 100).toFixed(2),
  ),
  currentLifetimePayAt050CpmUsd: roundMoney(
    currentLifetimeViewsTotal * 0.0005,
  ),
  viewConclusion:
    currentRoundedAmountBelowClaimRows.length === 0 &&
    captionsMissingGotallRows.length === 0
      ? "The view audit passes: every current counter supports its rounded $1 CPM invoice line, and every caption mentions GoTall."
      : "One or more view or campaign-content checks need review.",
  metadataConclusion:
    rowsWithIssues.length === 0
      ? "The invoice metadata matches the live records."
      : "The video identities and owners match, but the invoice contains publication-date errors.",
  limitation:
    "Current lifetime counters can disprove impossible overclaims but cannot reconstruct historical first-seven-day or payment-window views. The corrected invoice figure halves each visible line item; it is not a policy-window settlement.",
};

mkdirSync(outputDirectory, { recursive: true });
writeFileSync(
  path.join(outputDirectory, "audit.json"),
  `${JSON.stringify({ summary, rows }, null, 2)}\n`,
);

const columns = [
  "invoiceRow",
  "invoiceDate",
  "shortcode",
  "url",
  "invoicePayAtOneCpmUsd",
  "correctedInvoicePayAt050CpmUsd",
  "invoiceImpliedViewsAtOneCpm",
  "minimumPlausibleViewsAtRoundedOneCpm",
  "currentViews",
  "currentViewsMinusInvoiceImplied",
  "currentLifetimePayAt050CpmUsd",
  "owner",
  "accountDisplayName",
  "liveDate",
  "likeCount",
  "commentCount",
  "status",
];
writeFileSync(
  path.join(outputDirectory, "video-audit.csv"),
  `${columns.join(",")}\n${rows
    .map((row) => columns.map((column) => csvCell(row[column])).join(","))
    .join("\n")}\n`,
);

const markdownRows = rows.map(
  (row) =>
    `| ${row.invoiceRow} | ${row.invoiceDate} | [${row.shortcode}](${row.url}) | ${row.currentViews?.toLocaleString("en-US") ?? "missing"} | $${row.invoicePayAtOneCpmUsd.toFixed(2)} | $${row.correctedInvoicePayAt050CpmUsd.toFixed(2)} | ${row.status} |`,
);
const report = `# @vibedude33 invoice audit

Generated: ${summary.generatedAtUtc}

## Result

- Invoice rows: **${summary.invoiceRowCount}** (${summary.uniqueInvoiceVideoCount} unique videos)
- Rows resolved live: **${summary.liveRowsResolved}/${summary.invoiceRowCount}**
- Wrong-owner rows: **${summary.ownerMismatchRows.length}**
- Publication-date mismatches: **${summary.dateMismatchRows.length}**
- Claims above plausible current counters: **${summary.rowsWithClaimAboveCurrentCounter.length}**
- Current rounded counters below claimed line amounts: **${summary.currentRoundedAmountBelowClaimRows.length}**
- Captions missing a GoTall mention: **${summary.captionsMissingGotallRows.length}**
- Current lifetime views across the 78 rows: **${summary.currentLifetimeViewsAcrossInvoiceRows.toLocaleString("en-US")}**
- Views implied by the rounded $1-CPM lines: **${summary.invoiceImpliedViewsTotal.toLocaleString("en-US")}**
- Current views above the invoice-implied total: **${summary.currentViewsAboveInvoiceImplied.toLocaleString("en-US")} (${summary.currentViewsPercentAboveInvoiceImplied.toFixed(2)}%)**
- Invoice stated total: **$${summary.invoiceStatedTotalUsd.toFixed(2)}**
- Visible line-item sum at $1 CPM: **$${summary.invoiceRowsSumAtOneCpmUsd.toFixed(2)}**
- Visible line-item sum corrected to $0.50 CPM: **$${summary.correctedRowsSumAt050CpmUsd.toFixed(2)}**
- Half of the stated total: **$${summary.halfOfStatedTotalUsd.toFixed(2)}**
- Difference between those corrected totals: **$${summary.correctedTotalDiscrepancyVsHalfStatedUsd.toFixed(2)}**

**View verdict:** ${summary.viewConclusion}

**Invoice-quality verdict:** ${summary.metadataConclusion}

## Important limitation

${summary.limitation}

## Every invoice video

| # | Invoice date | Reel | Current views | Invoice line | Corrected line | Audit |
|---:|---|---|---:|---:|---:|---|
${markdownRows.join("\n")}
`;
writeFileSync(path.join(outputDirectory, "REPORT.md"), report);

console.log(JSON.stringify(summary, null, 2));
