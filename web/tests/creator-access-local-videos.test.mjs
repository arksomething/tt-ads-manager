import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCreatorAccessLedgerVideos,
  buildCreatorAccessViewTallyRows,
  filterCreatorAccessPayableRowsByMode,
  filterCreatorAccessLedgerVideos,
  getCreatorAccessMissingSourceVideoCount,
  getCreatorAccessPaidLookupSourceVideoIds,
} from "../src/server/ugc-pay/creator-access-local-videos.ts";

function video(overrides = {}) {
  return {
    id: "local-video-1",
    sourceVideoId: "source-video-1",
    videoUrl: "https://www.tiktok.com/@creator/video/1",
    titleOrCaption: "Video 1",
    publishedAt: new Date("2026-04-10T12:00:00.000Z"),
    createdAt: new Date("2026-04-10T12:05:00.000Z"),
    views: 1_000,
    creator: {
      displayName: "Creator",
      platformAccounts: [{ handle: "creator_", platform: "TIKTOK" }],
    },
    ...overrides,
  };
}

function paidRow(overrides = {}) {
  return {
    sourceVideoId: "source-video-1",
    matchedSparkItemIds: [],
    paidViews: 125,
    paidStatus: "yes",
    paidStatusReason: "exact_post_match",
    matchedAdIds: ["ad-1"],
    unresolvedPostBackedAdIds: [],
    unresolvedNonPostBackedAdIds: [],
    unresolvedPostBackedGroupCount: 0,
    unresolvedNonPostBackedGroupCount: 0,
    attributionSources: ["report_item_id"],
    ...overrides,
  };
}

test("creator portal local rows keep every local video even without paid rows", () => {
  const rows = buildCreatorAccessViewTallyRows({
    videos: [
      video(),
      video({
        id: "local-video-2",
        sourceVideoId: "source-video-2",
        views: 500,
      }),
      video({
        id: "local-video-3",
        sourceVideoId: null,
        views: 250,
      }),
    ],
    periodRows: [
      {
        sourceVideoId: "source-video-1",
        views: 1_000,
        currentViews: 1_200,
      },
      {
        sourceVideoId: "source-video-2",
        views: 500,
        currentViews: 500,
      },
    ],
    paidRows: [paidRow()],
    lookupWindowUnresolvedPostBackedGroupCount: 2,
  });

  assert.equal(rows.length, 3);
  assert.deepEqual(
    rows.map((row) => row.sourceVideoId),
    ["source-video-1", "source-video-2", "local:local-video-3"],
  );
  assert.equal(rows[0].paidStatus, "yes");
  assert.equal(rows[0].views, 1_000);
  assert.equal(rows[0].currentViews, 1_200);
  assert.equal(rows[0].paidViews, 125);
  assert.equal(rows[0].organicViewsEstimate, 875);
  assert.equal(rows[1].paidStatus, "unknown");
  assert.equal(rows[1].views, 500);
  assert.equal(rows[1].paidViews, null);
  assert.equal(rows[2].paidStatus, "unknown");
  assert.equal(rows[2].views, 0);
});

test("creator portal period rows are enrichment and cannot drop local videos", () => {
  const rows = buildCreatorAccessViewTallyRows({
    videos: [
      video({
        id: "local-video-1",
        sourceVideoId: "source-video-1",
        views: 10_000,
      }),
      video({
        id: "local-video-2",
        sourceVideoId: "source-video-2",
        views: 5_000,
      }),
    ],
    periodRows: [
      {
        sourceVideoId: "source-video-1",
        views: 42,
      },
    ],
    paidRows: [],
  });

  assert.equal(rows.length, 2);
  assert.deepEqual(
    rows.map((row) => row.views),
    [42, 0],
  );
  assert.deepEqual(
    rows.map((row) => row.currentViews),
    [10_000, 5_000],
  );
});

test("creator portal ledger filters out older videos with no period views", () => {
  const rows = filterCreatorAccessLedgerVideos({
    videos: [
      video({
        id: "posted-in-period",
        sourceVideoId: "posted-in-period",
        publishedAt: new Date("2026-05-26T12:00:00.000Z"),
      }),
      video({
        id: "older-with-period-views",
        sourceVideoId: "older-with-period-views",
        publishedAt: new Date("2026-04-10T12:00:00.000Z"),
      }),
      video({
        id: "older-with-zero-period-views",
        sourceVideoId: "older-with-zero-period-views",
        publishedAt: new Date("2026-04-11T12:00:00.000Z"),
      }),
      video({
        id: "older-missing-period-row",
        sourceVideoId: "older-missing-period-row",
        publishedAt: new Date("2026-04-12T12:00:00.000Z"),
      }),
    ],
    periodRows: [
      {
        sourceVideoId: "older-with-period-views",
        views: 25,
      },
      {
        sourceVideoId: "older-with-zero-period-views",
        views: 0,
      },
    ],
    periodStart: new Date("2026-05-25T00:00:00.000Z"),
    periodEndExclusive: new Date("2026-06-02T00:00:00.000Z"),
  });

  assert.deepEqual(
    rows.map((row) => row.id),
    ["posted-in-period", "older-with-period-views"],
  );
});

test("creator portal ledger includes queried provider videos missing from local db", () => {
  const rows = buildCreatorAccessLedgerVideos({
    accountHandle: "creator_",
    creatorName: "Creator",
    videos: [
      video({
        id: "local-video-1",
        sourceVideoId: "source-video-1",
        publishedAt: new Date("2026-04-10T12:00:00.000Z"),
      }),
    ],
    periodRows: [
      {
        sourceVideoId: "source-video-1",
        views: 25,
      },
      {
        sourceVideoId: "provider-only-video",
        views: 100,
        currentViews: 300,
        titleOrCaption: "Provider-only video",
        publishedAt: new Date("2026-05-28T12:00:00.000Z"),
        videoUrl: "https://www.tiktok.com/@creator_/video/provider-only-video",
      },
      {
        sourceVideoId: "provider-zero-view-video",
        views: 0,
        publishedAt: new Date("2026-05-29T12:00:00.000Z"),
      },
    ],
    periodStart: new Date("2026-05-25T00:00:00.000Z"),
    periodEndExclusive: new Date("2026-06-02T00:00:00.000Z"),
  });

  assert.deepEqual(
    rows.map((row) => row.id),
    ["local-video-1", "provider:provider-only-video"],
  );
  assert.equal(rows[1].sourceVideoId, "provider-only-video");
  assert.equal(rows[1].titleOrCaption, "Provider-only video");
  assert.equal(rows[1].views, 300);
});

test("creator portal view tally rows price provider-only ledger videos", () => {
  const rows = buildCreatorAccessViewTallyRows({
    videos: [
      video({
        id: "provider:provider-only-video",
        sourceVideoId: "provider-only-video",
        videoUrl: "https://www.tiktok.com/@creator_/video/provider-only-video",
        titleOrCaption: "Provider-only video",
        publishedAt: new Date("2026-05-28T12:00:00.000Z"),
        views: 300,
      }),
    ],
    periodRows: [
      {
        sourceVideoId: "provider-only-video",
        views: 100,
        currentViews: 300,
        titleOrCaption: "Provider title",
      },
    ],
    paidRows: [
      paidRow({
        sourceVideoId: "provider-only-video",
        paidViews: 10,
      }),
    ],
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, "provider:provider-only-video");
  assert.equal(rows[0].sourceVideoId, "provider-only-video");
  assert.equal(rows[0].titleOrCaption, "Provider title");
  assert.equal(rows[0].views, 100);
  assert.equal(rows[0].currentViews, 300);
  assert.equal(rows[0].paidStatus, "yes");
  assert.equal(rows[0].paidViews, 10);
});

test("creator portal view tally rows preserve thumbnails", () => {
  const rows = buildCreatorAccessViewTallyRows({
    videos: [
      video({
        sourceVideoId: "source-video-1",
        thumbnailUrl: "https://cdn.example.com/local.jpg",
      }),
      video({
        id: "source-video-2",
        sourceVideoId: "source-video-2",
        thumbnailUrl: "https://cdn.example.com/local-2.jpg",
      }),
    ],
    periodRows: [
      {
        sourceVideoId: "source-video-1",
        views: 100,
        thumbnailUrl: "https://cdn.example.com/provider.jpg",
      },
    ],
    paidRows: [],
  });

  assert.equal(rows[0].thumbnailUrl, "https://cdn.example.com/provider.jpg");
  assert.equal(rows[1].thumbnailUrl, "https://cdn.example.com/local-2.jpg");
});

test("creator portal posted mode filters payable rows to post dates", () => {
  const rows = buildCreatorAccessViewTallyRows({
    videos: [
      video({
        id: "older-with-period-views",
        sourceVideoId: "older-with-period-views",
        publishedAt: new Date("2026-04-10T12:00:00.000Z"),
      }),
      video({
        id: "posted-in-period",
        sourceVideoId: "posted-in-period",
        publishedAt: new Date("2026-05-28T12:00:00.000Z"),
      }),
    ],
    periodRows: [
      {
        sourceVideoId: "older-with-period-views",
        views: 25,
      },
      {
        sourceVideoId: "posted-in-period",
        views: 100,
      },
    ],
    paidRows: [],
  });

  assert.deepEqual(
    filterCreatorAccessPayableRowsByMode({
      payMode: "gained",
      rows,
      periodStart: new Date("2026-05-25T00:00:00.000Z"),
      periodEndExclusive: new Date("2026-06-02T00:00:00.000Z"),
    }).map((row) => row.id),
    ["older-with-period-views", "posted-in-period"],
  );
  assert.deepEqual(
    filterCreatorAccessPayableRowsByMode({
      payMode: "posted",
      rows,
      periodStart: new Date("2026-05-25T00:00:00.000Z"),
      periodEndExclusive: new Date("2026-06-02T00:00:00.000Z"),
    }).map((row) => row.id),
    ["posted-in-period"],
  );
});

test("creator portal paid lookup uses unique real TikTok post IDs only", () => {
  const videos = [
    video({ sourceVideoId: " source-video-1 " }),
    video({ id: "duplicate", sourceVideoId: "source-video-1" }),
    video({ id: "missing", sourceVideoId: null }),
  ];

  assert.deepEqual(getCreatorAccessPaidLookupSourceVideoIds(videos), [
    "source-video-1",
  ]);
  assert.equal(getCreatorAccessMissingSourceVideoCount(videos), 1);
});
