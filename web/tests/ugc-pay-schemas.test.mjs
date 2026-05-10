import assert from "node:assert/strict";
import test from "node:test";

import {
  upsertCampaignCreatorDealSchema,
  upsertCampaignCreatorVideoDealSchema,
} from "../src/server/payouts/schemas.ts";

const CreatorDealPaidTrafficMetric = {
  IMPRESSIONS: "IMPRESSIONS",
};

const CreatorDealPerVideoCapScope = {
  CPM: "CPM",
  NONE: "NONE",
  TOTAL: "TOTAL",
};

function issuePaths(result) {
  return result.error?.issues.map((issue) => issue.path.join(".")) ?? [];
}

test("creator deal schema coerces defaults and blank optional money fields", () => {
  const parsed = upsertCampaignCreatorDealSchema.parse({
    dealId: "deal-period-1",
    campaignCreatorId: "campaign-creator-1",
    currency: " usd ",
    effectiveStartDate: "2026-05-01",
    effectiveEndDate: "",
    fixedFee: "",
    fixedFeePerVideo: "12.50",
    cpmAmount: "",
    paidTrafficMetric: undefined,
    deductPaidTraffic: true,
    viewCapPerVideo: "",
    viewWindowDays: "",
    payoutCapPerVideo: "",
    perVideoCapScope: undefined,
    payoutCapTotal: "",
    notes: "  custom creator terms  ",
  });

  assert.equal(parsed.dealId, "deal-period-1");
  assert.equal(parsed.currency, "USD");
  assert.equal(parsed.fixedFee, undefined);
  assert.equal(parsed.fixedFeePerVideo, 12.5);
  assert.equal(parsed.cpmAmount, 1);
  assert.equal(parsed.paidTrafficMetric, CreatorDealPaidTrafficMetric.IMPRESSIONS);
  assert.equal(parsed.viewWindowDays, 30);
  assert.equal(parsed.payoutCapPerVideo, 100);
  assert.equal(parsed.perVideoCapScope, CreatorDealPerVideoCapScope.CPM);
  assert.equal(parsed.effectiveEndDate, undefined);
});

test("creator deal schema rejects end and fixed-fee dates before the start date", () => {
  const result = upsertCampaignCreatorDealSchema.safeParse({
    campaignCreatorId: "campaign-creator-1",
    currency: "USD",
    effectiveStartDate: "2026-05-10",
    effectiveEndDate: "2026-05-09",
    fixedFeeRecognitionDate: "2026-05-08",
    deductPaidTraffic: true,
  });

  assert.equal(result.success, false);
  assert.deepEqual(issuePaths(result).sort(), [
    "effectiveEndDate",
    "fixedFeeRecognitionDate",
  ]);
});

test("creator deal schema rejects zero CPM when a CPM or total cap is active", () => {
  for (const perVideoCapScope of [
    CreatorDealPerVideoCapScope.CPM,
    CreatorDealPerVideoCapScope.TOTAL,
  ]) {
    const result = upsertCampaignCreatorDealSchema.safeParse({
      campaignCreatorId: "campaign-creator-1",
      currency: "USD",
      effectiveStartDate: "2026-05-01",
      cpmAmount: "0",
      payoutCapPerVideo: "100",
      perVideoCapScope,
      deductPaidTraffic: true,
    });

    assert.equal(result.success, false);
    assert.deepEqual(issuePaths(result), ["cpmAmount"]);
  }
});

test("creator deal schema allows zero CPM when per-video caps are disabled", () => {
  const parsed = upsertCampaignCreatorDealSchema.parse({
    campaignCreatorId: "campaign-creator-1",
    currency: "USD",
    effectiveStartDate: "2026-05-01",
    cpmAmount: "0",
    perVideoCapScope: CreatorDealPerVideoCapScope.NONE,
    deductPaidTraffic: true,
  });

  assert.equal(parsed.cpmAmount, 0);
  assert.equal(parsed.perVideoCapScope, CreatorDealPerVideoCapScope.NONE);
});

test("video deal schema trims source video ids and applies defaults", () => {
  const parsed = upsertCampaignCreatorVideoDealSchema.parse({
    campaignCreatorId: "campaign-creator-1",
    sourceVideoId: " video-123 ",
    fixedFeePerVideo: "",
    cpmAmount: "",
    paidTrafficMetric: undefined,
    deductPaidTraffic: false,
    viewCapPerVideo: "",
    payoutCapPerVideo: "",
    perVideoCapScope: undefined,
    notes: "",
  });

  assert.equal(parsed.sourceVideoId, "video-123");
  assert.equal(parsed.fixedFeePerVideo, undefined);
  assert.equal(parsed.cpmAmount, 1);
  assert.equal(parsed.paidTrafficMetric, CreatorDealPaidTrafficMetric.IMPRESSIONS);
  assert.equal(parsed.deductPaidTraffic, false);
  assert.equal(parsed.payoutCapPerVideo, 100);
  assert.equal(parsed.perVideoCapScope, CreatorDealPerVideoCapScope.CPM);
  assert.equal(parsed.notes, undefined);
});

test("video deal schema rejects zero CPM when a payout cap is active", () => {
  const result = upsertCampaignCreatorVideoDealSchema.safeParse({
    campaignCreatorId: "campaign-creator-1",
    sourceVideoId: "video-123",
    cpmAmount: "0",
    payoutCapPerVideo: "100",
    perVideoCapScope: CreatorDealPerVideoCapScope.CPM,
    deductPaidTraffic: true,
  });

  assert.equal(result.success, false);
  assert.deepEqual(issuePaths(result), ["cpmAmount"]);
});
