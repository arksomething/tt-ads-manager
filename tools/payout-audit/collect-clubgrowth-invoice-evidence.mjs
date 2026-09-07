#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = "/home/ark296/projects/tt-ads-manager";
const OUT = path.join(
  ROOT,
  "payouts/2026-07/disputes/2026-08-12-michael-three-claims",
);
const WEB = path.join(ROOT, "web");
const INFLU_RX_ACCOUNT_ID = "orgacc_BnXAGYx9kCQp";

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

const env = {
  ...readEnvFile(path.join(WEB, ".env")),
  ...readEnvFile(path.join(WEB, ".env.local")),
  ...process.env,
};

// Transcribed from Michael Que's invoice-july.pdf Slack attachment. The
// invoice states a $0.50 CPM and a $61.85 total.
const invoiceRows = [
  ["2026-07-06", "DadrCmERrf9", 1.40],
  ["2026-07-06", "DadrWq9RSfJ", 1.95],
  ["2026-07-07", "DagRC6mRyhG", 1.60],
  ["2026-07-07", "DagRNaOR6XB", 3.20],
  ["2026-07-07", "DagRbfERoTA", 1.45],
  ["2026-07-08", "DaivIupxMB-", 1.30],
  ["2026-07-08", "DaivWLQxVNE", 1.80],
  ["2026-07-08", "DaivdcGxA_5", 1.60],
  ["2026-07-09", "DalbUMMRyUG", 4.70],
  ["2026-07-09", "DalbpM3BdA1", 1.40],
  ["2026-07-09", "Dalc3xJRPcl", 1.90],
  ["2026-07-17", "Da6EW4RxWGK", 1.20],
  ["2026-07-17", "Da6Eq9Wx6cn", 1.50],
  ["2026-07-17", "Da6FeUiRnkO", 1.50],
  ["2026-07-17", "Da6F2mlRbrm", 2.10],
  ["2026-07-19", "Da-sjnBRlg0", 1.40],
  ["2026-07-19", "Da-suRhxKiO", 1.00],
  ["2026-07-19", "Da-s13vxk1j", 1.30],
  ["2026-07-19", "Da-tArWRkLC", 1.30],
  ["2026-07-19", "Da-tT5Hxr1D", 1.40],
  ["2026-07-23", "DbJkXF_x2Qe", 1.30],
  ["2026-07-23", "DbJkjAjREoq", 1.75],
  ["2026-07-23", "DbJlLmmR69t", 1.30],
  ["2026-07-23", "DbJlYWNRJtz", 1.30],
  ["2026-07-23", "DbJlrnQR-wb", 1.70],
  ["2026-07-23", "DbJm0kjxGxT", 1.40],
  ["2026-07-24", "DbRSdrdRdWq", 1.10],
  ["2026-07-24", "DbRSu61xGLs", 1.60],
  ["2026-07-24", "DbRS6dfRTFw", 1.50],
  ["2026-07-24", "DbRTReIRWgt", 1.20],
  ["2026-07-25", "DbTvPl2Rpcv", 1.10],
  ["2026-07-25", "DbTvZLWxyWl", 1.30],
  ["2026-07-25", "DbTvk_Wx0MW", 1.20],
  ["2026-07-25", "DbTvtkNRRwv", 2.00],
  ["2026-07-26", "DbWRKt-R-vZ", 1.65],
  ["2026-07-26", "DbWRV_zRqUW", 1.10],
  ["2026-07-26", "DbWRtmBRiC7", 2.20],
  ["2026-07-26", "DbWUKFMxmVx", 1.25],
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function parseEmbed(html) {
  const match = html.match(/"contextJSON":"((?:\\.|[^"\\])*)"/);
  if (!match) throw new Error("Instagram embed did not contain contextJSON");
  const context = JSON.parse(JSON.parse(`"${match[1]}"`));
  const media = context?.gql_data?.shortcode_media;
  if (!media) throw new Error("Instagram embed did not contain shortcode_media");
  return {
    owner: media.owner?.username ?? null,
    currentPublicVideoViews: Number(media.video_view_count ?? 0),
    postedAtUtc: media.taken_at_timestamp
      ? new Date(Number(media.taken_at_timestamp) * 1000).toISOString()
      : null,
    caption: media.edge_media_to_caption?.edges?.[0]?.node?.text ?? null,
  };
}

async function fetchEmbed(shortcode) {
  const url = `https://www.instagram.com/reel/${shortcode}/embed/captioned/`;
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0",
        },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return { url, ...parseEmbed(await response.text()) };
    } catch (error) {
      lastError = error;
      await sleep(attempt * 1200);
    }
  }
  throw lastError;
}

async function fetchProviderVideos(startDate, endDate) {
  const base = env.VIRAL_APP_BASE_URL ?? env.DATA_PROVIDER_BASE_URL;
  const apiKey = env.VIRAL_APP_API_KEY ?? env.DATA_PROVIDER_API_KEY;
  if (!base || !apiKey) throw new Error("viral.app credentials are unavailable");
  const url = new URL(
    "analytics/top-videos",
    base.endsWith("/") ? base : `${base}/`,
  );
  for (const [key, value] of Object.entries({
    platforms: "instagram",
    viewMode: "internal",
    publicationMode: "allEligible",
    onlyPublished: "false",
    "dateRange[from]": startDate,
    "dateRange[to]": endDate,
    accounts: INFLU_RX_ACCOUNT_ID,
    metric: "viewCountInPeriod",
    limit: "100",
  })) {
    url.searchParams.set(key, value);
  }
  const response = await fetch(url, {
    headers: { Accept: "application/json", "x-api-key": apiKey },
  });
  if (!response.ok) {
    throw new Error(`viral.app analytics HTTP ${response.status}`);
  }
  const payload = await response.json();
  if (Array.isArray(payload)) return payload;
  for (const key of ["data", "rows", "results", "videos"]) {
    if (Array.isArray(payload?.[key])) return payload[key];
  }
  return [];
}

async function searchTrackedProviderVideo(shortcode) {
  const base = env.VIRAL_APP_BASE_URL ?? env.DATA_PROVIDER_BASE_URL;
  const apiKey = env.VIRAL_APP_API_KEY ?? env.DATA_PROVIDER_API_KEY;
  const url = new URL("videos/tracked", base.endsWith("/") ? base : `${base}/`);
  for (const [key, value] of Object.entries({
    search: shortcode,
    platforms: "instagram",
    viewMode: "internal",
    page: "1",
    perPage: "100",
  })) {
    url.searchParams.set(key, value);
  }
  const response = await fetch(url, {
    headers: { Accept: "application/json", "x-api-key": apiKey },
  });
  if (!response.ok) throw new Error(`viral.app video search HTTP ${response.status}`);
  const payload = await response.json();
  return Array.isArray(payload?.data) ? payload.data : [];
}

function addUtcDays(dateOnly, days) {
  const date = new Date(`${dateOnly}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

const results = [];
for (let index = 0; index < invoiceRows.length; index++) {
  const [invoiceDate, shortcode, invoicePayUsd] = invoiceRows[index];
  process.stdout.write(`[${index + 1}/${invoiceRows.length}] ${shortcode} `);
  try {
    const publicEvidence = await fetchEmbed(shortcode);
    results.push({
      invoiceRow: index + 1,
      invoiceDate,
      shortcode,
      invoicePayUsd,
      invoiceImpliedViewsAt050Cpm: Math.round((invoicePayUsd / 0.5) * 1000),
      ...publicEvidence,
      currentPublicPayAt050CpmUsd: Number(
        ((publicEvidence.currentPublicVideoViews / 1000) * 0.5).toFixed(2),
      ),
      error: null,
    });
    console.log("ok");
  } catch (error) {
    results.push({
      invoiceRow: index + 1,
      invoiceDate,
      shortcode,
      invoicePayUsd,
      invoiceImpliedViewsAt050Cpm: Math.round((invoicePayUsd / 0.5) * 1000),
      error: String(error?.message ?? error),
    });
    console.log(`failed: ${String(error?.message ?? error)}`);
  }
  await sleep(250);
}

const julyProviderVideos = await fetchProviderVideos("2026-07-01", "2026-07-31");
const julyProviderByShortcode = new Map(
  julyProviderVideos.map((video) => [video.platformVideoId, video]),
);

// Re-run each distinct creator-policy window. The July batch pays gained views
// that overlap the first seven calendar days starting on the published date.
const policyGroups = new Map();
for (const row of results) {
  const providerVideo = julyProviderByShortcode.get(row.shortcode);
  const publishedDate = providerVideo?.publishedDate ?? row.invoiceDate;
  const startDate = publishedDate > "2026-07-01" ? publishedDate : "2026-07-01";
  const naturalEnd = addUtcDays(publishedDate, 6);
  const endDate = naturalEnd < "2026-07-31" ? naturalEnd : "2026-07-31";
  const key = `${startDate}:${endDate}`;
  if (!policyGroups.has(key)) policyGroups.set(key, { startDate, endDate });
}
for (const video of julyProviderVideos) {
  const publishedDate = video.publishedDate;
  if (!publishedDate) continue;
  const startDate = publishedDate > "2026-07-01" ? publishedDate : "2026-07-01";
  const naturalEnd = addUtcDays(publishedDate, 6);
  const endDate = naturalEnd < "2026-07-31" ? naturalEnd : "2026-07-31";
  const key = `${startDate}:${endDate}`;
  if (!policyGroups.has(key)) policyGroups.set(key, { startDate, endDate });
}

const policyVideosByGroup = new Map();
for (const [key, group] of policyGroups) {
  policyVideosByGroup.set(
    key,
    await fetchProviderVideos(group.startDate, group.endDate),
  );
  await sleep(200);
}

for (const row of results) {
  const monthly = julyProviderByShortcode.get(row.shortcode) ?? null;
  const publishedDate = monthly?.publishedDate ?? row.invoiceDate;
  const startDate = publishedDate > "2026-07-01" ? publishedDate : "2026-07-01";
  const naturalEnd = addUtcDays(publishedDate, 6);
  const endDate = naturalEnd < "2026-07-31" ? naturalEnd : "2026-07-31";
  const policy = (policyVideosByGroup.get(`${startDate}:${endDate}`) ?? []).find(
    (video) => video.platformVideoId === row.shortcode,
  );
  row.providerAccount = monthly?.accountUsername ?? policy?.accountUsername ?? null;
  row.providerPublishedDate = monthly?.publishedDate ?? policy?.publishedDate ?? null;
  row.providerCurrentViews = Number(monthly?.viewCount ?? policy?.viewCount ?? 0) || null;
  row.providerJulyViews = Number(monthly?.viewCountInPeriod ?? 0) || null;
  row.policyWindowStart = startDate;
  row.policyWindowEnd = endDate;
  row.providerFirstSevenDayJulyViews = Number(policy?.viewCountInPeriod ?? 0) || null;
  row.policyPayAt050CpmUsd = policy
    ? Number((Number(policy.viewCountInPeriod ?? 0) * 0.0005).toFixed(2))
    : null;
}

const invoiceShortcodes = new Set(results.map((row) => row.shortcode));
const providerOnlyRows = julyProviderVideos
  .filter((video) => !invoiceShortcodes.has(video.platformVideoId))
  .map((video) => {
    const publishedDate = video.publishedDate;
    const startDate = publishedDate > "2026-07-01" ? publishedDate : "2026-07-01";
    const naturalEnd = addUtcDays(publishedDate, 6);
    const endDate = naturalEnd < "2026-07-31" ? naturalEnd : "2026-07-31";
    const policy = (policyVideosByGroup.get(`${startDate}:${endDate}`) ?? []).find(
      (candidate) => candidate.platformVideoId === video.platformVideoId,
    );
    const policyViews = Number(policy?.viewCountInPeriod ?? 0);
    return {
      shortcode: video.platformVideoId,
      url: `https://www.instagram.com/reel/${video.platformVideoId}/`,
      providerAccount: video.accountUsername,
      providerPublishedDate: publishedDate,
      providerJulyViews: Number(video.viewCountInPeriod ?? 0),
      policyWindowStart: startDate,
      policyWindowEnd: endDate,
      providerFirstSevenDayJulyViews: policyViews,
      policyPayAt050CpmUsd: Number((policyViews * 0.0005).toFixed(2)),
      caption: video.caption ?? null,
    };
  });

const roundMoney = (value) => Number(value.toFixed(2));
const successful = results.filter((row) => !row.error);
const providerResolved = results.filter(
  (row) => row.providerFirstSevenDayJulyViews != null,
);
const missingProviderSearches = {};
for (const row of results.filter(
  (candidate) => candidate.providerFirstSevenDayJulyViews == null,
)) {
  missingProviderSearches[row.shortcode] = await searchTrackedProviderVideo(
    row.shortcode,
  );
}
const summary = {
  generatedAtUtc: new Date().toISOString(),
  invoiceLabel: "club.growth - JULY CPM - $0.5",
  invoiceStatedTotalUsd: 61.85,
  invoiceRowCount: invoiceRows.length,
  invoiceRowsSumUsd: roundMoney(
    invoiceRows.reduce((sum, row) => sum + row[2], 0),
  ),
  publicRowsResolved: successful.length,
  publicRowsFailed: results.length - successful.length,
  publicOwnerCounts: Object.fromEntries(
    [...new Set(successful.map((row) => row.owner))].map((owner) => [
      owner,
      successful.filter((row) => row.owner === owner).length,
    ]),
  ),
  invoiceImpliedViewsTotal: results.reduce(
    (sum, row) => sum + row.invoiceImpliedViewsAt050Cpm,
    0,
  ),
  currentPublicViewsTotal: successful.reduce(
    (sum, row) => sum + row.currentPublicVideoViews,
    0,
  ),
  currentPublicPayAt050CpmUsd: roundMoney(
    successful.reduce((sum, row) => sum + row.currentPublicVideoViews, 0) *
      0.0005,
  ),
  connectedProviderAccount: "influ.rx",
  providerJulyRowsReturned: julyProviderVideos.length,
  invoiceRowsResolvedInProvider: providerResolved.length,
  invoiceRowsMissingFromProvider: results
    .filter((row) => row.providerFirstSevenDayJulyViews == null)
    .map((row) => row.shortcode),
  missingInvoiceRowsTrackedSearchCounts: Object.fromEntries(
    Object.entries(missingProviderSearches).map(([shortcode, rows]) => [
      shortcode,
      rows.length,
    ]),
  ),
  invoiceRowsWithProviderDateMismatch: results.filter(
    (row) =>
      row.providerPublishedDate && row.invoiceDate !== row.providerPublishedDate,
  ).length,
  providerFirstSevenDayJulyViewsTotal: providerResolved.reduce(
    (sum, row) => sum + row.providerFirstSevenDayJulyViews,
    0,
  ),
  policyPayAt050CpmUsd: roundMoney(
    providerResolved.reduce((sum, row) => sum + row.policyPayAt050CpmUsd, 0),
  ),
  providerRowsMissingFromInvoice: providerOnlyRows.map((row) => row.shortcode),
  providerOnlyFirstSevenDayJulyViewsTotal: providerOnlyRows.reduce(
    (sum, row) => sum + row.providerFirstSevenDayJulyViews,
    0,
  ),
  providerOnlyPolicyPayAt050CpmUsd: roundMoney(
    providerOnlyRows.reduce((sum, row) => sum + row.policyPayAt050CpmUsd, 0),
  ),
  limitation:
    "Instagram embed counts are current public counters. Historical policy-window values come from the connected viral.app account and remain incomplete if an invoice row is missing there.",
};

mkdirSync(OUT, { recursive: true });
writeFileSync(
  path.join(OUT, "clubgrowth-instagram-public-evidence.json"),
  `${JSON.stringify(
    { summary, rows: results, providerOnlyRows, missingProviderSearches },
    null,
    2,
  )}\n`,
);

const csvCell = (value) => {
  const text = value == null ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};
const columns = [
  "invoiceRow",
  "invoiceDate",
  "shortcode",
  "url",
  "owner",
  "postedAtUtc",
  "invoicePayUsd",
  "invoiceImpliedViewsAt050Cpm",
  "currentPublicVideoViews",
  "currentPublicPayAt050CpmUsd",
  "providerAccount",
  "providerPublishedDate",
  "providerJulyViews",
  "policyWindowStart",
  "policyWindowEnd",
  "providerFirstSevenDayJulyViews",
  "policyPayAt050CpmUsd",
  "error",
];
writeFileSync(
  path.join(OUT, "clubgrowth-instagram-public-evidence.csv"),
  `${columns.join(",")}\n${results
    .map((row) => columns.map((column) => csvCell(row[column])).join(","))
    .join("\n")}\n`,
);

console.log(JSON.stringify(summary, null, 2));
