import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCreatorPortalDirectoryLinkHref,
  buildCreatorPortalDirectoryOpenHref,
  buildCreatorPortalDirectoryRows,
  getCreatorPortalDirectorySummary,
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
