import assert from "node:assert/strict";
import test from "node:test";

import {
  applyCreatorPortalDirectoryLastPostControls,
  buildCreatorPortalDirectoryLinkHref,
  buildCreatorPortalDirectoryOpenHref,
  buildCreatorPortalDirectoryRows,
  buildCreatorPortalLastPostAtByCreatorId,
  getCreatorPortalDirectorySummary,
  parseCreatorPortalDirectoryPostedWithinMonths,
  resolveCreatorPortalDirectoryLastPostView,
} from "../src/server/creator-portal/directory.ts";

function createCampaignCreator(overrides = {}) {
  return {
    id: "campaign_creator_1",
    createdAt: new Date("2026-05-01T00:00:00.000Z"),
    creatorId: "creator_1",
    campaign: {
      id: "campaign_1",
      name: "Campaign 1",
    },
    creator: {
      id: "creator_1",
      displayName: "Creator 1",
      platformAccounts: [{ handle: "creatorone" }],
    },
    portalAccesses: [],
    ...overrides,
  };
}

test("creator portal directory keeps every campaign creator row visible", () => {
  const campaignCreators = [
    createCampaignCreator({
      id: "campaign_creator_1",
      creatorId: "creator_1",
      portalAccesses: [
        {
          id: "revoked_access",
          revokedAt: new Date("2026-05-10T00:00:00.000Z"),
          createdAt: new Date("2026-05-01T00:00:00.000Z"),
          updatedAt: new Date("2026-05-10T00:00:00.000Z"),
        },
        {
          id: "older_active_access",
          linkPath: "/creator/link/older",
          revokedAt: null,
          createdAt: new Date("2026-05-03T00:00:00.000Z"),
          updatedAt: new Date("2026-05-03T00:00:00.000Z"),
        },
        {
          id: "newer_active_access",
          linkPath: "/creator/link/newer",
          revokedAt: null,
          createdAt: new Date("2026-05-05T00:00:00.000Z"),
          updatedAt: new Date("2026-05-05T00:00:00.000Z"),
        },
      ],
    }),
    createCampaignCreator({
      id: "campaign_creator_2",
      creatorId: "creator_2",
      creator: {
        id: "creator_2",
        displayName: "Creator 2",
        platformAccounts: [],
      },
      portalAccesses: [],
    }),
    createCampaignCreator({
      id: "campaign_creator_3",
      creatorId: "creator_3",
      campaign: {
        id: "campaign_2",
        name: "Campaign 2",
      },
    }),
  ];

  const rows = buildCreatorPortalDirectoryRows(campaignCreators);
  const summary = getCreatorPortalDirectorySummary(campaignCreators);

  assert.equal(rows.length, 3);
  assert.deepEqual(
    rows.map((row) => row.campaignCreator.id),
    ["campaign_creator_1", "campaign_creator_2", "campaign_creator_3"],
  );
  assert.equal(rows[0].activeAccess?.id, "newer_active_access");
  assert.equal(rows[0].activeAccess?.linkPath, "/creator/link/newer");
  assert.equal(rows[0].activeAccessCount, 2);
  assert.equal(rows[1].activeAccess, null);
  assert.deepEqual(summary, {
    creatorRows: 3,
    activeLinks: 2,
    campaigns: 2,
  });
});

test("creator portal directory open buttons use a normal navigable URL", () => {
  assert.equal(
    buildCreatorPortalDirectoryOpenHref("gotall", "campaign creator 1"),
    "/org/gotall/ugc-pay/open?campaignCreatorId=campaign+creator+1",
  );
});

test("creator portal directory links can carry creator page date defaults", () => {
  const defaults = {
    startDate: "2026-06-01",
    endDate: "2026-06-30",
    payMode: "posted",
    viewWindowMode: "all",
  };

  assert.equal(
    buildCreatorPortalDirectoryOpenHref("gotall", "campaign creator 1", defaults),
    "/org/gotall/ugc-pay/open?campaignCreatorId=campaign+creator+1&startDate=2026-06-01&endDate=2026-06-30&payMode=posted&viewWindowMode=all",
  );
  assert.equal(
    buildCreatorPortalDirectoryLinkHref("/creator/link/token", defaults),
    "/creator/link/token?startDate=2026-06-01&endDate=2026-06-30&payMode=posted&viewWindowMode=all",
  );
});

test("posted-within-months parsing defaults to 2 and supports all", () => {
  assert.equal(parseCreatorPortalDirectoryPostedWithinMonths(undefined), 2);
  assert.equal(parseCreatorPortalDirectoryPostedWithinMonths(null), 2);
  assert.equal(parseCreatorPortalDirectoryPostedWithinMonths(""), 2);
  assert.equal(parseCreatorPortalDirectoryPostedWithinMonths("abc"), 2);
  assert.equal(parseCreatorPortalDirectoryPostedWithinMonths("0"), 2);
  assert.equal(parseCreatorPortalDirectoryPostedWithinMonths("99"), 2);
  assert.equal(parseCreatorPortalDirectoryPostedWithinMonths("2.5"), 2);
  assert.equal(parseCreatorPortalDirectoryPostedWithinMonths("1"), 1);
  assert.equal(parseCreatorPortalDirectoryPostedWithinMonths("6"), 6);
  assert.equal(parseCreatorPortalDirectoryPostedWithinMonths("all"), null);
});

test("last-post filter keeps creators that posted within the window", () => {
  const now = new Date("2026-08-01T12:00:00.000Z");
  const rows = buildCreatorPortalDirectoryRows([
    createCampaignCreator({ id: "cc_recent", creatorId: "creator_recent" }),
    createCampaignCreator({ id: "cc_stale", creatorId: "creator_stale" }),
    createCampaignCreator({ id: "cc_boundary", creatorId: "creator_boundary" }),
    createCampaignCreator({ id: "cc_silent", creatorId: "creator_silent" }),
  ]);
  const lastPostAtByCreatorId = new Map([
    ["creator_recent", new Date("2026-07-15T00:00:00.000Z")],
    ["creator_stale", new Date("2026-04-30T00:00:00.000Z")],
    ["creator_boundary", new Date("2026-06-01T12:00:00.000Z")],
  ]);

  const filtered = applyCreatorPortalDirectoryLastPostControls({
    rows,
    lastPostAtByCreatorId,
    postedWithinMonths: 2,
    sortByLastPost: false,
    now,
  });

  assert.deepEqual(
    filtered.map((row) => row.campaignCreator.id),
    ["cc_recent", "cc_boundary"],
  );

  const unfiltered = applyCreatorPortalDirectoryLastPostControls({
    rows,
    lastPostAtByCreatorId,
    postedWithinMonths: null,
    sortByLastPost: false,
    now,
  });

  assert.deepEqual(
    unfiltered.map((row) => row.campaignCreator.id),
    ["cc_recent", "cc_stale", "cc_boundary", "cc_silent"],
  );
});

test("last-post sort orders newest first with no-post creators last", () => {
  const now = new Date("2026-08-01T12:00:00.000Z");
  const rows = buildCreatorPortalDirectoryRows([
    createCampaignCreator({ id: "cc_a", creatorId: "creator_a" }),
    createCampaignCreator({ id: "cc_b", creatorId: "creator_b" }),
    createCampaignCreator({ id: "cc_c", creatorId: "creator_c" }),
    createCampaignCreator({ id: "cc_d", creatorId: "creator_d" }),
  ]);
  const lastPostAtByCreatorId = new Map([
    ["creator_a", new Date("2026-06-10T00:00:00.000Z")],
    ["creator_b", new Date("2026-07-20T00:00:00.000Z")],
    ["creator_d", new Date("2026-07-01T00:00:00.000Z")],
  ]);

  const sorted = applyCreatorPortalDirectoryLastPostControls({
    rows,
    lastPostAtByCreatorId,
    postedWithinMonths: null,
    sortByLastPost: true,
    now,
  });

  assert.deepEqual(
    sorted.map((row) => row.campaignCreator.id),
    ["cc_b", "cc_d", "cc_a", "cc_c"],
  );

  const input = rows.map((row) => row.campaignCreator.id);
  assert.deepEqual(input, ["cc_a", "cc_b", "cc_c", "cc_d"]);
});

test("default last-post filter falls back to all rows instead of emptying the directory", () => {
  const now = new Date("2026-08-01T12:00:00.000Z");
  const rows = buildCreatorPortalDirectoryRows([
    createCampaignCreator({ id: "cc_old", creatorId: "creator_old" }),
    createCampaignCreator({ id: "cc_none", creatorId: "creator_none" }),
  ]);
  const lastPostAtByCreatorId = new Map([
    ["creator_old", new Date("2026-04-01T00:00:00.000Z")],
  ]);

  const defaultView = resolveCreatorPortalDirectoryLastPostView({
    rows,
    lastPostAtByCreatorId,
    requestedMonths: 2,
    isExplicit: false,
    sortByLastPost: false,
    now,
  });

  assert.equal(defaultView.fallbackApplied, true);
  assert.equal(defaultView.effectiveMonths, null);
  assert.deepEqual(
    defaultView.rows.map((row) => row.campaignCreator.id),
    ["cc_old", "cc_none"],
  );

  const explicitView = resolveCreatorPortalDirectoryLastPostView({
    rows,
    lastPostAtByCreatorId,
    requestedMonths: 2,
    isExplicit: true,
    sortByLastPost: false,
    now,
  });

  assert.equal(explicitView.fallbackApplied, false);
  assert.deepEqual(explicitView.rows, []);
});

test("last-post filter does not fall back when some rows match", () => {
  const now = new Date("2026-08-01T12:00:00.000Z");
  const rows = buildCreatorPortalDirectoryRows([
    createCampaignCreator({ id: "cc_recent", creatorId: "creator_recent" }),
    createCampaignCreator({ id: "cc_old", creatorId: "creator_old" }),
  ]);
  const lastPostAtByCreatorId = new Map([
    ["creator_recent", new Date("2026-07-20T00:00:00.000Z")],
    ["creator_old", new Date("2026-03-01T00:00:00.000Z")],
  ]);

  const view = resolveCreatorPortalDirectoryLastPostView({
    rows,
    lastPostAtByCreatorId,
    requestedMonths: 2,
    isExplicit: false,
    sortByLastPost: false,
    now,
  });

  assert.equal(view.fallbackApplied, false);
  assert.equal(view.effectiveMonths, 2);
  assert.deepEqual(
    view.rows.map((row) => row.campaignCreator.id),
    ["cc_recent"],
  );
});

test("last-post dates prefer the freshest of local and tracked-account sources", () => {
  const lastPostAtByCreatorId = buildCreatorPortalLastPostAtByCreatorId({
    creators: [
      { creatorId: "creator_live", displayName: "Live Creator", handles: ["@LiveHandle"] },
      { creatorId: "creator_local", displayName: "Local Creator", handles: ["localhandle"] },
      { creatorId: "creator_name_match", displayName: "Name Match", handles: [] },
      { creatorId: "creator_unknown", displayName: "Unknown", handles: ["nowhere"] },
    ],
    localLastPostAtByCreatorId: new Map([
      ["creator_live", new Date("2026-05-01T00:00:00.000Z")],
      ["creator_local", new Date("2026-07-30T00:00:00.000Z")],
    ]),
    trackedAccounts: [
      {
        username: "livehandle",
        displayName: "Live Creator",
        latestVideoPublishedAt: new Date("2026-07-31T17:00:00.000Z"),
      },
      {
        username: "localhandle",
        displayName: "Local Creator",
        latestVideoPublishedAt: new Date("2026-06-01T00:00:00.000Z"),
      },
      {
        username: null,
        displayName: "name match",
        latestVideoPublishedAt: new Date("2026-07-20T00:00:00.000Z"),
      },
      {
        username: "someoneelse",
        displayName: "Someone Else",
        latestVideoPublishedAt: null,
      },
    ],
  });

  assert.equal(
    lastPostAtByCreatorId.get("creator_live")?.toISOString(),
    "2026-07-31T17:00:00.000Z",
  );
  assert.equal(
    lastPostAtByCreatorId.get("creator_local")?.toISOString(),
    "2026-07-30T00:00:00.000Z",
  );
  assert.equal(
    lastPostAtByCreatorId.get("creator_name_match")?.toISOString(),
    "2026-07-20T00:00:00.000Z",
  );
  assert.equal(lastPostAtByCreatorId.has("creator_unknown"), false);
});
