import assert from "node:assert/strict";
import test from "node:test";

import {
  getCreatorPortalFeedSort,
  sortCreatorPortalFeedVideos,
} from "../src/lib/creator-portal-feed.ts";

function video(overrides = {}) {
  return {
    createdAt: new Date("2026-05-01T00:00:00.000Z"),
    grossViews: 0,
    payableViews: 0,
    publishedAt: null,
    titleOrCaption: "Untitled",
    videoPay: 0,
    ...overrides,
  };
}

test("creator portal feed defaults to most-viewed sorting", () => {
  assert.equal(getCreatorPortalFeedSort(undefined), "views");
  assert.equal(getCreatorPortalFeedSort("views"), "views");
  assert.equal(getCreatorPortalFeedSort("date"), "date");
  assert.equal(getCreatorPortalFeedSort("unexpected"), "views");
});

test("creator portal feed can sort by most views", () => {
  const rows = sortCreatorPortalFeedVideos(
    [
      video({
        titleOrCaption: "Middle",
        grossViews: 250,
        payableViews: 200,
        publishedAt: new Date("2026-05-04T00:00:00.000Z"),
      }),
      video({
        titleOrCaption: "Top",
        grossViews: 1_000,
        payableViews: 900,
        publishedAt: new Date("2026-04-20T00:00:00.000Z"),
      }),
      video({
        titleOrCaption: "Tie newer",
        grossViews: 250,
        payableViews: 200,
        publishedAt: new Date("2026-05-05T00:00:00.000Z"),
      }),
    ],
    "views",
  );

  assert.deepEqual(
    rows.map((row) => row.titleOrCaption),
    ["Top", "Tie newer", "Middle"],
  );
});

test("creator portal feed can sort by newest date", () => {
  const rows = sortCreatorPortalFeedVideos(
    [
      video({
        titleOrCaption: "Older high views",
        grossViews: 10_000,
        publishedAt: new Date("2026-04-20T00:00:00.000Z"),
      }),
      video({
        titleOrCaption: "Newest lower views",
        grossViews: 100,
        publishedAt: new Date("2026-05-10T00:00:00.000Z"),
      }),
      video({
        titleOrCaption: "Created fallback",
        grossViews: 500,
        createdAt: new Date("2026-05-08T00:00:00.000Z"),
        publishedAt: null,
      }),
    ],
    "date",
  );

  assert.deepEqual(
    rows.map((row) => row.titleOrCaption),
    ["Newest lower views", "Created fallback", "Older high views"],
  );
});
