import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";

const invoicePath =
  process.argv[2] ??
  "/home/ark296/.codex/attachments/249d2f9f-1800-4cd0-bd24-6f821a0e76ab/Invoice%20August.pdf.pdf";
const settlementPath = new URL(
  "../../payouts/2026-08/final-settlement/settlement.json",
  import.meta.url,
);
const outputPath = new URL(
  "../../payouts/2026-08/final-settlement/mogg3d-invoice-reconciliation.json",
  import.meta.url,
);

function roundMoney(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function parseInvoice(text) {
  return [...text.matchAll(/(https:\/\/www\.tiktok\.com\/t\/[^\s]+) \((\d{1,2})\/(\d{1,2})\) \$(\d+(?:\.\d+)?)/gmu)].map(
    ([, shortUrl, month, day, claimedAmount]) => ({
      shortUrl,
      publishedDate: `2026-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
      claimedAmount: Number(claimedAmount),
    }),
  );
}

async function resolveVideoId(item) {
  const response = await fetch(item.shortUrl, {
    method: "HEAD",
    redirect: "manual",
    headers: { "User-Agent": "Mozilla/5.0" },
  });
  const location = response.headers.get("location") ?? "";
  const match = location.match(/\/video\/(\d+)/u);
  return { ...item, status: response.status, location, videoId: match?.[1] ?? null };
}

async function resolveInBatches(items, size = 8) {
  const resolved = [];
  for (let index = 0; index < items.length; index += size) {
    resolved.push(...(await Promise.all(items.slice(index, index + size).map(resolveVideoId))));
  }
  return resolved;
}

const invoiceText = execFileSync("pdftotext", [invoicePath, "-"], { encoding: "utf8" });
const invoiceRows = parseInvoice(invoiceText);
const settlement = JSON.parse(await readFile(settlementPath, "utf8"));
const recipient = settlement.recipients.find((item) => item.name === "Mogg3d");
if (!recipient) throw new Error("Mogg3d recipient not found in settlement");

const resolved = await resolveInBatches(invoiceRows);
const videosById = new Map(recipient.videos.map((video) => [video.platformVideoId, video]));
const compared = resolved.map((invoice) => {
  const settlementVideo = videosById.get(invoice.videoId) ?? null;
  return {
    ...invoice,
    settlementFound: Boolean(settlementVideo),
    settlementPublishedDate: settlementVideo?.publishedDate ?? null,
    settlementAmount: settlementVideo?.videoPay ?? null,
    fixedFee: settlementVideo?.fixedFee ?? null,
    cpmPay: settlementVideo?.cpmPay ?? null,
    payableViews: settlementVideo?.payableViews ?? null,
    hasYap: settlementVideo?.hasYap ?? null,
    difference: settlementVideo
      ? roundMoney(settlementVideo.videoPay - invoice.claimedAmount)
      : null,
  };
});

const invoiceVideoIds = new Set(compared.map((row) => row.videoId).filter(Boolean));
const missingFromInvoice = recipient.videos
  .filter((video) => video.publishedDate.startsWith("2026-08") && !invoiceVideoIds.has(video.platformVideoId))
  .map((video) => ({
    videoId: video.platformVideoId,
    url: video.url,
    publishedDate: video.publishedDate,
    settlementAmount: video.videoPay,
    fixedFee: video.fixedFee,
    cpmPay: video.cpmPay,
    payableViews: video.payableViews,
    hasYap: video.hasYap,
  }));
const julyCarryovers = recipient.videos
  .filter((video) => video.publishedDate.startsWith("2026-07"))
  .map((video) => ({
    videoId: video.platformVideoId,
    url: video.url,
    publishedDate: video.publishedDate,
    settlementAmount: video.videoPay,
    fixedFee: video.fixedFee,
    cpmPay: video.cpmPay,
    payableViews: video.payableViews,
    hasYap: video.hasYap,
  }));

const audit = {
  generatedAt: new Date().toISOString(),
  invoicePath,
  invoice: {
    rowCount: invoiceRows.length,
    statedTotal: 1488,
    parsedTotal: roundMoney(invoiceRows.reduce((sum, row) => sum + row.claimedAmount, 0)),
    resolvedCount: compared.filter((row) => row.videoId).length,
    matchedSettlementCount: compared.filter((row) => row.settlementFound).length,
  },
  settlement: {
    augustPosts: recipient.augustPosts,
    julyCarryovers: recipient.julyCarryovers,
    fixedPay: recipient.fixedPay,
    cpmPay: recipient.cpmPay,
    totalPay: recipient.totalPay,
  },
  reconciliation: {
    matchedInvoiceClaimedTotal: roundMoney(
      compared.filter((row) => row.settlementFound).reduce((sum, row) => sum + row.claimedAmount, 0),
    ),
    matchedSettlementTotal: roundMoney(
      compared.filter((row) => row.settlementFound).reduce((sum, row) => sum + row.settlementAmount, 0),
    ),
    matchedCalculationDifference: roundMoney(
      compared.filter((row) => row.settlementFound).reduce((sum, row) => sum + row.difference, 0),
    ),
    missingAugustPostCount: missingFromInvoice.length,
    missingAugustPostTotal: roundMoney(missingFromInvoice.reduce((sum, row) => sum + row.settlementAmount, 0)),
    julyCarryoverCount: julyCarryovers.length,
    julyCarryoverTotal: roundMoney(julyCarryovers.reduce((sum, row) => sum + row.settlementAmount, 0)),
    finalDifference: roundMoney(recipient.totalPay - 1488),
  },
  compared,
  missingFromInvoice,
  julyCarryovers,
};

await writeFile(outputPath, `${JSON.stringify(audit, null, 2)}\n`);
console.log(JSON.stringify({ output: outputPath.pathname, ...audit.invoice, ...audit.reconciliation }, null, 2));
