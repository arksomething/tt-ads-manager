import assert from "node:assert/strict";
import test from "node:test";

import {
  NON_TALKING_VIDEO_CPM_AMOUNT,
  applyUgcPayVideoContentTypeCpm,
  applyUgcPayVideoDealOverride,
  calculateUgcPayVideoAmounts,
} from "../src/server/ugc-pay/calculations.ts";
import {
  getCreatorDealFromForm,
  getVideoDealOverrideFromForm,
  recalculateCreatorWithDeal,
  recalculateCreatorWithVideoDeal,
} from "../src/lib/ugc-pay-local-recalculation.ts";

function deal(overrides = {}) {
  return {
    fixedFeePerVideo: null,
    cpmAmount: 2,
    paidTrafficMetric: "IMPRESSIONS",
    deductPaidTraffic: true,
    viewCapPerVideo: null,
    payoutCapPerVideo: 1_000,
    perVideoCapScope: "NONE",
    notes: null,
    ...overrides,
  };
}

function calculateWithDeal(currentDeal) {
  return calculateVideo({
    grossViews: 12_000,
    paidStatus: "no",
    paidViews: 0,
    deal: currentDeal,
    fixedFeePerVideo: currentDeal.fixedFeePerVideo ?? 0,
  });
}

function calculateVideo(overrides = {}) {
  const currentDeal = overrides.deal ?? deal();

  return calculateUgcPayVideoAmounts({
    grossViews: 12_000,
    paidStatus: "no",
    paidViews: 0,
    deal: currentDeal,
    fixedFeePerVideo: currentDeal.fixedFeePerVideo ?? 0,
    gainedViewCapContext: null,
    payMode: "posted",
    ...overrides,
  });
}

test("creator deal CPM changes the expected CPM and CPM pay", () => {
  const original = calculateWithDeal(deal({ cpmAmount: 2 }));
  const edited = calculateWithDeal(deal({ cpmAmount: 5 }));

  assert.equal(original.cpmAmount, 2);
  assert.equal(original.cpmPay, 24);
  assert.equal(original.videoPay, 24);

  assert.equal(edited.cpmAmount, 5);
  assert.equal(edited.cpmPay, 60);
  assert.equal(edited.videoPay, 60);
});

test("per-video CPM override replaces the creator CPM for that video", () => {
  const creatorDeal = deal({ cpmAmount: 2 });
  const videoDeal = {
    fixedFeePerVideo: null,
    cpmAmount: 7,
    paidTrafficMetric: "IMPRESSIONS",
    deductPaidTraffic: true,
    viewCapPerVideo: null,
    payoutCapPerVideo: null,
    perVideoCapScope: "NONE",
    notes: "special video terms",
  };

  const withoutOverride = calculateWithDeal(creatorDeal);
  const effectiveVideoDeal = applyUgcPayVideoDealOverride(creatorDeal, videoDeal);
  const withOverride = calculateWithDeal(effectiveVideoDeal);

  assert.equal(withoutOverride.cpmAmount, 2);
  assert.equal(withoutOverride.cpmPay, 24);

  assert.equal(effectiveVideoDeal.cpmAmount, 7);
  assert.equal(withOverride.cpmAmount, 7);
  assert.equal(withOverride.cpmPay, 84);
  assert.equal(withOverride.videoPay, 84);
});

test("non-talking videos use the content CPM unless a video override exists", () => {
  const creatorDeal = deal({ cpmAmount: 2 });
  const nonTalkingDeal = applyUgcPayVideoContentTypeCpm(creatorDeal, {
    isTalking: false,
    hasVideoDealOverride: false,
  });
  const explicitOverrideDeal = applyUgcPayVideoContentTypeCpm(
    applyUgcPayVideoDealOverride(creatorDeal, {
      fixedFeePerVideo: null,
      cpmAmount: 7,
      paidTrafficMetric: "IMPRESSIONS",
      deductPaidTraffic: true,
      viewCapPerVideo: null,
      payoutCapPerVideo: null,
      perVideoCapScope: "NONE",
      notes: null,
    }),
    {
      isTalking: false,
      hasVideoDealOverride: true,
    },
  );

  assert.equal(NON_TALKING_VIDEO_CPM_AMOUNT, 0.5);
  assert.equal(nonTalkingDeal.cpmAmount, NON_TALKING_VIDEO_CPM_AMOUNT);
  assert.equal(calculateWithDeal(nonTalkingDeal).cpmPay, 6);
  assert.equal(explicitOverrideDeal.cpmAmount, 7);
  assert.equal(calculateWithDeal(explicitOverrideDeal).cpmPay, 84);
});

test("per-video fixed fee and total cap still use the overridden CPM", () => {
  const effectiveVideoDeal = applyUgcPayVideoDealOverride(
    deal({
      cpmAmount: 2,
      fixedFeePerVideo: 10,
      payoutCapPerVideo: 50,
      perVideoCapScope: "TOTAL",
    }),
    {
      fixedFeePerVideo: 15,
      cpmAmount: 8,
      paidTrafficMetric: "IMPRESSIONS",
      deductPaidTraffic: true,
      viewCapPerVideo: null,
      payoutCapPerVideo: 80,
      perVideoCapScope: "TOTAL",
      notes: null,
    },
  );
  const result = calculateWithDeal(effectiveVideoDeal);

  assert.equal(result.cpmAmount, 8);
  assert.equal(result.rawCpmPay, 96);
  assert.equal(result.cpmPay, 65);
  assert.equal(result.videoPay, 80);
  assert.equal(result.viewCapReached, true);
});

test("CPM cap limits CPM pay without limiting fixed per-video fee", () => {
  const result = calculateVideo({
    grossViews: 100_000,
    deal: deal({
      cpmAmount: 2,
      fixedFeePerVideo: 20,
      payoutCapPerVideo: 50,
      perVideoCapScope: "CPM",
    }),
  });

  assert.equal(result.rawCpmPay, 200);
  assert.equal(result.cpmPay, 50);
  assert.equal(result.videoPay, 70);
  assert.equal(result.viewCapReached, true);
});

test("total cap limits fixed and CPM pay together", () => {
  const result = calculateVideo({
    grossViews: 100_000,
    deal: deal({
      cpmAmount: 2,
      fixedFeePerVideo: 20,
      payoutCapPerVideo: 50,
      perVideoCapScope: "TOTAL",
    }),
  });

  assert.equal(result.rawCpmPay, 200);
  assert.equal(result.cpmPay, 30);
  assert.equal(result.videoPay, 50);
  assert.equal(result.viewCapReached, true);
});

test("NONE cap scope leaves CPM and fixed pay uncapped", () => {
  const result = calculateVideo({
    grossViews: 100_000,
    deal: deal({
      cpmAmount: 2,
      fixedFeePerVideo: 20,
      payoutCapPerVideo: 50,
      perVideoCapScope: "NONE",
    }),
  });

  assert.equal(result.rawCpmPay, 200);
  assert.equal(result.cpmPay, 200);
  assert.equal(result.videoPay, 220);
  assert.equal(result.viewCapReached, false);
});

test("paid traffic deduction reduces payable views only for paid videos", () => {
  const paidVideo = calculateVideo({
    grossViews: 10_000,
    paidStatus: "yes",
    paidViews: 3_000,
    deal: deal({ cpmAmount: 2 }),
  });
  const organicVideo = calculateVideo({
    grossViews: 10_000,
    paidStatus: "no",
    paidViews: 3_000,
    deal: deal({ cpmAmount: 2 }),
  });

  assert.equal(paidVideo.paidViewsDeducted, 3_000);
  assert.equal(paidVideo.payableViews, 7_000);
  assert.equal(paidVideo.cpmPay, 14);

  assert.equal(organicVideo.paidViewsDeducted, 0);
  assert.equal(organicVideo.payableViews, 10_000);
  assert.equal(organicVideo.cpmPay, 20);
});

test("view cap reduces payable views before CPM pay is calculated", () => {
  const result = calculateVideo({
    grossViews: 10_000,
    deal: deal({
      cpmAmount: 2,
      viewCapPerVideo: 4_000,
    }),
  });

  assert.equal(result.uncappedPayableViews, 10_000);
  assert.equal(result.payableViews, 4_000);
  assert.equal(result.cpmPay, 8);
  assert.equal(result.viewCapReached, true);
});

test("gained-view cap uses cumulative context to calculate in-window payable views", () => {
  const result = calculateVideo({
    grossViews: 8_000,
    deal: deal({
      cpmAmount: 2,
      payoutCapPerVideo: 20,
      perVideoCapScope: "CPM",
    }),
    gainedViewCapContext: {
      grossViewsBeforePeriod: 7_000,
      grossViewsAtPeriodEnd: 15_000,
    },
    payMode: "gained",
  });

  assert.equal(result.grossViewsInsideCap, 3_000);
  assert.equal(result.payableViews, 3_000);
  assert.equal(result.cpmPay, 6);
  assert.equal(result.viewCapReached, true);
});

function creatorDeal(overrides = {}) {
  return {
    id: null,
    currency: "USD",
    effectiveStartDate: new Date("2026-05-01T00:00:00.000Z"),
    effectiveEndDate: null,
    fixedFee: null,
    fixedFeeRecognitionDate: null,
    fixedFeePerVideo: null,
    cpmAmount: 1,
    paidTrafficMetric: "IMPRESSIONS",
    deductPaidTraffic: true,
    viewCapPerVideo: null,
    viewWindowDays: 7,
    payoutCapPerVideo: 100,
    perVideoCapScope: "NONE",
    payoutCapTotal: null,
    notes: null,
    isDefault: true,
    ...overrides,
  };
}

function videoRow(overrides = {}) {
  return {
    campaignCreatorId: "campaign-creator-1",
    campaignId: "campaign-1",
    campaignName: "Campaign",
    creatorId: "creator-1",
    creatorName: "Creator",
    currency: "USD",
    videoId: "video-1",
    sourceVideoId: "source-video-1",
    videoUrl: "https://example.com/video",
    titleOrCaption: "Video",
    publishedAt: new Date("2026-05-04T00:00:00.000Z"),
    createdAt: new Date("2026-05-04T00:00:00.000Z"),
    isTalking: true,
    grossViews: 10_000,
    paidViewsDeducted: 0,
    payableViews: 10_000,
    fixedFeePerVideo: 0,
    cpmAmount: 1,
    paidTrafficMetric: "IMPRESSIONS",
    deductPaidTraffic: true,
    viewCapPerVideo: null,
    payoutCapPerVideo: 100,
    perVideoCapScope: "NONE",
    hasVideoDealOverride: false,
    videoDealId: null,
    videoDealNotes: null,
    cpmPay: 10,
    videoPay: 10,
    viewCapReached: false,
    creatorTotalCapApplied: false,
    paidStatus: "no",
    matchedAdIds: [],
    ...overrides,
  };
}

function creatorRow(overrides = {}) {
  const baseDeal = creatorDeal();
  const videos = [
    videoRow(),
    videoRow({
      videoId: "video-2",
      sourceVideoId: "source-video-2",
      grossViews: 5_000,
      payableViews: 5_000,
      cpmPay: 5,
      videoPay: 5,
    }),
  ];

  return {
    campaignCreatorId: "campaign-creator-1",
    campaignId: "campaign-1",
    campaignName: "Campaign",
    creatorId: "creator-1",
    creatorName: "Creator",
    tiktokHandle: "creator",
    hasCustomDeal: false,
    currency: "USD",
    deal: baseDeal,
    defaultDeal: baseDeal,
    grossViews: 15_000,
    paidViewsDeducted: 0,
    payableViews: 15_000,
    fixedPay: 0,
    videoPay: 15,
    totalPay: 15,
    videoCount: 2,
    exactPaidVideoCount: 2,
    unknownPaidVideoCount: 0,
    videoDealOverrideCount: 0,
    videoCapReached: false,
    creatorTotalCapApplied: false,
    videos,
    ...overrides,
  };
}

function creatorForm(overrides = {}) {
  const formData = new FormData();
  const values = {
    campaignCreatorId: "campaign-creator-1",
    currency: "USD",
    effectiveStartDate: "2026-05-01",
    effectiveEndDate: "",
    fixedFee: "",
    fixedFeeRecognitionDate: "",
    fixedFeePerVideo: "",
    cpmAmount: "3",
    paidTrafficMetric: "IMPRESSIONS",
    viewCapPerVideo: "",
    viewWindowDays: "7",
    payoutCapPerVideo: "100",
    perVideoCapScope: "NONE",
    payoutCapTotal: "",
    notes: "",
    deductPaidTraffic: "on",
    ...overrides,
  };

  for (const [key, value] of Object.entries(values)) {
    if (value !== null) {
      formData.set(key, value);
    }
  }

  return formData;
}

function videoForm(overrides = {}) {
  const formData = new FormData();
  const values = {
    campaignCreatorId: "campaign-creator-1",
    sourceVideoId: "source-video-1",
    fixedFeePerVideo: "",
    cpmAmount: "5",
    paidTrafficMetric: "IMPRESSIONS",
    viewCapPerVideo: "",
    payoutCapPerVideo: "100",
    perVideoCapScope: "NONE",
    notes: "override",
    deductPaidTraffic: "on",
    ...overrides,
  };

  for (const [key, value] of Object.entries(values)) {
    if (value !== null) {
      formData.set(key, value);
    }
  }

  return formData;
}

test("local creator deal save recalculates only the creator rows from existing videos", () => {
  const creator = creatorRow();
  const nextDeal = getCreatorDealFromForm(creator, creatorForm());
  const recalculated = recalculateCreatorWithDeal({
    creator,
    deal: nextDeal,
    hasCustomDeal: true,
    options: {
      startDate: "2026-05-01",
      endDate: "2026-05-09",
      payMode: "posted",
    },
  });

  assert.equal(recalculated.hasCustomDeal, true);
  assert.equal(recalculated.deal.cpmAmount, 3);
  assert.equal(recalculated.videoPay, 45);
  assert.equal(recalculated.totalPay, 45);
  assert.deepEqual(
    recalculated.videos.map((video) => video.videoPay).sort((left, right) => left - right),
    [15, 30],
  );
});

test("local creator deal save preserves non-talking video CPM", () => {
  const creator = creatorRow({
    videos: [
      videoRow({
        isTalking: false,
        cpmAmount: 0.5,
        cpmPay: 5,
        videoPay: 5,
      }),
      videoRow({
        videoId: "video-2",
        sourceVideoId: "source-video-2",
        grossViews: 5_000,
        payableViews: 5_000,
        cpmPay: 5,
        videoPay: 5,
      }),
    ],
  });
  const nextDeal = getCreatorDealFromForm(
    creator,
    creatorForm({
      cpmAmount: "4",
    }),
  );
  const recalculated = recalculateCreatorWithDeal({
    creator,
    deal: nextDeal,
    hasCustomDeal: true,
    options: {
      startDate: "2026-05-01",
      endDate: "2026-05-09",
      payMode: "posted",
    },
  });
  const nonTalkingVideo = recalculated.videos.find(
    (row) => row.sourceVideoId === "source-video-1",
  );
  const talkingVideo = recalculated.videos.find(
    (row) => row.sourceVideoId === "source-video-2",
  );

  assert.ok(nonTalkingVideo);
  assert.ok(talkingVideo);
  assert.equal(nonTalkingVideo.cpmAmount, 0.5);
  assert.equal(nonTalkingVideo.videoPay, 5);
  assert.equal(talkingVideo.cpmAmount, 4);
  assert.equal(talkingVideo.videoPay, 20);
  assert.equal(recalculated.totalPay, 25);
});

test("local per-video override save recalculates the selected video and creator totals", () => {
  const creator = creatorRow();
  const video = creator.videos.find(
    (row) => row.sourceVideoId === "source-video-1",
  );
  assert.ok(video);

  const videoDeal = getVideoDealOverrideFromForm(video, videoForm());
  const recalculated = recalculateCreatorWithVideoDeal({
    creator,
    sourceVideoId: video.sourceVideoId,
    videoOverride: videoDeal,
    options: {
      startDate: "2026-05-01",
      endDate: "2026-05-09",
      payMode: "posted",
    },
  });

  const editedVideo = recalculated.videos.find(
    (row) => row.sourceVideoId === "source-video-1",
  );
  const untouchedVideo = recalculated.videos.find(
    (row) => row.sourceVideoId === "source-video-2",
  );

  assert.ok(editedVideo);
  assert.ok(untouchedVideo);
  assert.equal(editedVideo.hasVideoDealOverride, true);
  assert.equal(editedVideo.cpmAmount, 5);
  assert.equal(editedVideo.videoPay, 50);
  assert.equal(untouchedVideo.cpmAmount, 1);
  assert.equal(untouchedVideo.videoPay, 5);
  assert.equal(recalculated.videoDealOverrideCount, 1);
  assert.equal(recalculated.totalPay, 55);
});
