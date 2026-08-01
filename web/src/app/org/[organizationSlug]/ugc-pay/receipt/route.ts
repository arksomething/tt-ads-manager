import { NextRequest, NextResponse } from "next/server";

import { type DashboardSearchParams } from "@/server/dashboard/filters";
import { getOrganizationUgcPayData } from "@/server/ugc-pay/queries";

type RouteContext = {
  params: Promise<unknown>;
};

async function getOrganizationSlug(context: RouteContext) {
  const params = await context.params;

  if (
    typeof params === "object" &&
    params !== null &&
    "organizationSlug" in params &&
    typeof params.organizationSlug === "string"
  ) {
    return params.organizationSlug;
  }

  throw new Error("Organization slug is missing.");
}

function csvValue(value: unknown) {
  if (value === null || value === undefined) {
    return "";
  }

  const text =
    value instanceof Date ? value.toISOString().slice(0, 10) : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csvRow(values: unknown[]) {
  return values.map(csvValue).join(",");
}

export async function GET(request: NextRequest, context: RouteContext) {
  const organizationSlug = await getOrganizationSlug(context);
  const searchParams: DashboardSearchParams = {};

  for (const [key, value] of request.nextUrl.searchParams.entries()) {
    searchParams[key] = value;
  }

  const data = await getOrganizationUgcPayData({
    organizationSlug,
    searchParams,
  });

  const lines: string[] = [];

  lines.push(csvRow(["UGC Pay receipt"]));
  lines.push(csvRow(["Organization", organizationSlug]));
  lines.push(csvRow(["Campaign", data.selectedCampaignLabel]));
  lines.push(csvRow(["Period start", data.startDate]));
  lines.push(csvRow(["Period end", data.endDate]));
  lines.push(csvRow(["Pay basis", data.payMode]));
  lines.push(csvRow(["View window mode", data.viewWindowMode]));
  lines.push(csvRow(["Video fetch mode", data.videoFetchMode]));
  lines.push(csvRow(["Report time zone", data.reportTimeZone]));
  lines.push(csvRow(["Generated at (UTC)", new Date().toISOString()]));
  lines.push(csvRow(["Total pay", data.summary.totalPay]));
  lines.push(csvRow(["Fixed pay", data.summary.fixedPay]));
  lines.push(csvRow(["Video pay", data.summary.videoPay]));
  lines.push(csvRow(["Gross views", data.summary.grossViews]));
  lines.push(csvRow(["Paid views deducted", data.summary.paidViewsDeducted]));
  lines.push(csvRow(["Payable views", data.summary.payableViews]));
  lines.push(csvRow(["Creators", data.summary.creators]));
  lines.push(csvRow(["Videos", data.summary.videos]));

  if (data.warnings.length > 0) {
    lines.push(csvRow(["Warnings", data.warnings.join(" | ")]));
  }

  lines.push("");
  lines.push(csvRow(["CREATORS"]));
  lines.push(
    csvRow([
      "Creator",
      "TikTok handle",
      "Campaign",
      "Currency",
      "Videos",
      "Gross views",
      "Paid views deducted",
      "Payable views",
      "Fixed pay",
      "Video pay",
      "Total pay",
      "Custom deal",
      "Cap reached",
    ]),
  );

  for (const creator of data.creators) {
    lines.push(
      csvRow([
        creator.creatorName,
        creator.tiktokHandle,
        creator.campaignName,
        creator.currency,
        creator.videoCount,
        creator.grossViews,
        creator.paidViewsDeducted,
        creator.payableViews,
        creator.fixedPay,
        creator.videoPay,
        creator.totalPay,
        creator.hasCustomDeal ? "yes" : "no",
        creator.videoCapReached || creator.creatorTotalCapApplied ? "yes" : "no",
      ]),
    );
  }

  lines.push("");
  lines.push(csvRow(["VIDEOS"]));
  lines.push(
    csvRow([
      "Creator",
      "Video URL",
      "Title",
      "Posted",
      "Talking",
      "Gross views",
      "Paid views deducted",
      "Payable views",
      "CPM",
      "Fixed fee per video",
      "CPM pay",
      "Video pay",
      "Paid status",
      "Deal override",
    ]),
  );

  for (const video of data.videos) {
    lines.push(
      csvRow([
        video.creatorName,
        video.videoUrl,
        video.titleOrCaption,
        video.publishedAt ?? video.createdAt,
        video.isTalking ? "yes" : "no",
        video.grossViews,
        video.paidViewsDeducted,
        video.payableViews,
        video.cpmAmount,
        video.fixedFeePerVideo,
        video.cpmPay,
        video.videoPay,
        video.paidStatus,
        video.hasVideoDealOverride ? "yes" : "no",
      ]),
    );
  }

  const filename = `ugc-pay-receipt_${data.startDate}_${data.endDate}.csv`;

  return new NextResponse(lines.join("\r\n") + "\r\n", {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
