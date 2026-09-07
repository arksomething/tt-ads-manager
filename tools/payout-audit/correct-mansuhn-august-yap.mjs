#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = "/home/ark296/projects/tt-ads-manager";
const SETTLEMENT_PATH = path.join(
  ROOT,
  "payouts/2026-08/final-settlement/settlement.json",
);
const VIDEOS_PATH = path.join(
  ROOT,
  "payouts/2026-08/final-settlement/all-videos-2026-08.csv",
);
const PAYMENT_SHEET_PATH = path.join(
  ROOT,
  "payouts/2026-08/final-settlement/payment-sheet-2026-08.csv",
);

const RECIPIENT_KEY = "mansuhn-heightmuncher-combined";
const CREATOR_ID = "0e031d1d-a866-4b13-8c66-df274b1dac8b";
const AFFECTED_VIDEO_IDS = new Set([
  "7669667956875332894",
  "7670020694352153886",
  "7670584245743635743",
  "7670994973722021150",
  "7671842429921774879",
  "7672206057971698974",
  "7672530494247947550",
  "7673236699358530847",
  "7673767870442032415",
  "7674137975088860447",
  "7674518801068707103",
  "7674785720862625055",
]);

function money(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sum(values) {
  return money(values.reduce((total, value) => total + Number(value), 0));
}

function recalculateSummary(summary, videos) {
  summary.fixedPay = sum(videos.map((video) => video.fixedFee));
  summary.cpmPay = sum(videos.map((video) => video.cpmPay));
  summary.totalPay = sum(videos.map((video) => video.videoPay));
}

function parseCsvLine(line) {
  const fields = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (quoted) {
      if (character === '"' && line[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      fields.push(field);
      field = "";
    } else {
      field += character;
    }
  }
  fields.push(field);
  return fields;
}

function csvField(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function csvLine(fields) {
  return fields.map(csvField).join(",");
}

const settlement = JSON.parse(readFileSync(SETTLEMENT_PATH, "utf8"));
const recipient = settlement.recipients.find((row) => row.key === RECIPIENT_KEY);
assert(recipient, `Missing recipient ${RECIPIENT_KEY}`);

const affected = recipient.videos.filter((video) =>
  AFFECTED_VIDEO_IDS.has(String(video.platformVideoId)),
);
assert(affected.length === AFFECTED_VIDEO_IDS.size, "Affected video set is incomplete");

const alreadyCorrected = affected.every(
  (video) => video.effectiveCpm === 1 && video.hasVideoDealOverride === true,
);

let increase = 0;
if (!alreadyCorrected) {
  for (const video of affected) {
    assert(video.creatorId === CREATOR_ID, `Unexpected creator for ${video.platformVideoId}`);
    assert(video.creatorName === "heightmuncher67", `Unexpected creator name for ${video.platformVideoId}`);
    assert(video.hasYap === true, `Missing literal #yap on ${video.platformVideoId}`);
    assert(video.workerClassification === "talking", `Not classified talking: ${video.platformVideoId}`);
    assert(video.effectiveCpm === 0.5, `Unexpected prior CPM on ${video.platformVideoId}`);
    assert(video.fixedFee === 0, `Unexpected fixed fee on ${video.platformVideoId}`);

    const priorPay = video.videoPay;
    const correctedPay = money(video.payableViews / 1_000);
    video.baseCpm = 1;
    video.effectiveCpm = 1;
    video.payoutCapPerVideo = 300;
    video.perVideoCapScope = "CPM";
    video.cpmPay = correctedPay;
    video.videoPay = correctedPay;
    video.amountSource = "manual policy correction - talking #yap rate";
    video.reconciliationNote =
      "Corrected from $0.50 to $1.00 CPM after creator review; literal #yap and talking classification verified.";
    video.hasVideoDealOverride = true;
    increase += correctedPay - priorPay;
  }

  increase = money(increase);
  assert(increase === 5.01, `Expected a $5.01 correction, got $${increase.toFixed(2)}`);

  const heightmuncherVideos = recipient.videos.filter(
    (video) => video.creatorId === CREATOR_ID,
  );
  const heightmuncherSummary = recipient.creators.find(
    (creator) => creator.creatorId === CREATOR_ID,
  );
  assert(heightmuncherSummary, "Missing heightmuncher67 recipient summary");
  recalculateSummary(heightmuncherSummary, heightmuncherVideos);

  const creatorSummary = settlement.creators.find(
    (creator) => creator.creatorId === CREATOR_ID,
  );
  assert(creatorSummary, "Missing heightmuncher67 global creator summary");
  recalculateSummary(creatorSummary, heightmuncherVideos);

  recalculateSummary(recipient, recipient.videos);
  settlement.totals.cpmPay = money(settlement.totals.cpmPay + increase);
  settlement.totals.totalPay = money(settlement.totals.totalPay + increase);
}

assert(recipient.totalPay === 20.44, `Expected corrected total $20.44, got $${recipient.totalPay}`);
recipient.status =
  "CORRECTED - READY TO SEND; 12 talking #yap rows on heightmuncher67 repriced to $1.00 CPM; transfer not verified";
recipient.correction = {
  correctedAt: "2026-09-03",
  reason: "12 talking heightmuncher67 videos with literal #yap were incorrectly left at the account's legacy $0.50 CPM rate.",
  affectedVideos: 12,
  priorTotalPay: 15.43,
  increase: 5.01,
  correctedTotalPay: 20.44,
};

writeFileSync(SETTLEMENT_PATH, `${JSON.stringify(settlement, null, 2)}\n`);

const videoLines = readFileSync(VIDEOS_PATH, "utf8").trimEnd().split("\n");
const correctedCsvIds = new Set();
for (let index = 1; index < videoLines.length; index += 1) {
  const fields = parseCsvLine(videoLines[index]);
  if (!AFFECTED_VIDEO_IDS.has(fields[5])) continue;
  const video = affected.find((row) => String(row.platformVideoId) === fields[5]);
  fields[14] = "1";
  fields[15] = "1";
  fields[17] = Number(video.cpmPay).toFixed(2);
  fields[18] = Number(video.videoPay).toFixed(2);
  fields[19] = "manual policy correction - talking #yap rate";
  videoLines[index] = csvLine(fields);
  correctedCsvIds.add(fields[5]);
}
assert(correctedCsvIds.size === AFFECTED_VIDEO_IDS.size, "CSV correction set is incomplete");
writeFileSync(VIDEOS_PATH, `${videoLines.join("\n")}\n`);

const paymentLines = readFileSync(PAYMENT_SHEET_PATH, "utf8").trimEnd().split("\n");
let recipientRowFound = false;
let totalRowFound = false;
for (let index = 1; index < paymentLines.length; index += 1) {
  const fields = parseCsvLine(paymentLines[index]);
  if (fields[0] === "Mansuhn / heightmuncher67") {
    fields[3] = "20.44";
    fields[12] = recipient.status;
    paymentLines[index] = csvLine(fields);
    recipientRowFound = true;
  } else if (fields[0] === "TOTAL") {
    fields[3] = Number(settlement.totals.totalPay).toFixed(2);
    paymentLines[index] = csvLine(fields);
    totalRowFound = true;
  }
}
assert(recipientRowFound, "Payment-sheet recipient row was not found");
assert(totalRowFound, "Payment-sheet total row was not found");
writeFileSync(PAYMENT_SHEET_PATH, `${paymentLines.join("\n")}\n`);

console.log(
  JSON.stringify(
    {
      recipient: recipient.name,
      affectedVideos: affected.length,
      priorTotalPay: 15.43,
      increase: 5.01,
      correctedTotalPay: recipient.totalPay,
      alreadyCorrected,
    },
    null,
    2,
  ),
);
