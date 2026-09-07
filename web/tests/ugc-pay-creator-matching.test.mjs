import assert from "node:assert/strict";
import test from "node:test";

import {
  getMatchedUgcPayTrackedCreatorOptions,
  getPayoutWarningCampaignCreators,
  isExternallyPaidMomCreatorRow,
} from "../src/lib/ugc-pay-creator-matching.ts";

function campaignCreator(overrides = {}) {
  return {
    id: overrides.id ?? "creator-one",
    creator: {
      displayName: overrides.displayName ?? "Creator One",
      platformAccounts: overrides.platformAccounts ?? [],
    },
    deals: overrides.deals ?? [],
  };
}

test("repeated label and handle keys from the same Viral account remain one match", () => {
  const option = {
    id: "viral-row-one",
    platformAccountId: "native-one",
    label: "@creator.one",
    meta: "@creator.one",
  };
  const result = getMatchedUgcPayTrackedCreatorOptions({
    campaignCreators: [
      campaignCreator({
        platformAccounts: [{ handle: "creator.one", sourceAccountId: null }],
      }),
    ],
    creatorOptions: [option],
  });

  assert.deepEqual(result.matchedOptions, [option]);
  assert.deepEqual(result.unmatchedCampaignCreators, []);
});

test("duplicate Viral rows with the same platform account ID collapse to one match", () => {
  const first = {
    id: "viral-row-one",
    platformAccountId: "native-one",
    label: "Creator One",
    meta: "@shared",
  };
  const second = {
    id: "viral-row-two",
    platformAccountId: "native-one",
    label: "Creator One renamed",
    meta: "@shared",
  };
  const result = getMatchedUgcPayTrackedCreatorOptions({
    campaignCreators: [
      campaignCreator({
        platformAccounts: [{ handle: "shared", sourceAccountId: null }],
      }),
    ],
    creatorOptions: [first, second],
  });

  assert.deepEqual(result.matchedOptions, [first]);
  assert.deepEqual(result.unmatchedCampaignCreators, []);
});

test("a key shared by different Viral accounts remains ambiguous", () => {
  const creator = campaignCreator({
    platformAccounts: [{ handle: "shared", sourceAccountId: null }],
  });
  const result = getMatchedUgcPayTrackedCreatorOptions({
    campaignCreators: [creator],
    creatorOptions: [
      {
        id: "viral-row-one",
        platformAccountId: "native-one",
        label: "One",
        meta: "@shared",
      },
      {
        id: "viral-row-two",
        platformAccountId: "native-two",
        label: "Two",
        meta: "@shared",
      },
    ],
  });

  assert.deepEqual(result.matchedOptions, []);
  assert.deepEqual(result.unmatchedCampaignCreators, [creator]);
});

test("native source account IDs win before handles and names", () => {
  const nativeMatch = {
    id: "viral-native",
    platformAccountId: "native-correct",
    label: "Renamed creator",
    meta: "@renamed.creator",
  };
  const handleMatch = {
    id: "viral-handle",
    platformAccountId: "native-wrong",
    label: "Creator One",
    meta: "@creator.one",
  };
  const result = getMatchedUgcPayTrackedCreatorOptions({
    campaignCreators: [
      campaignCreator({
        displayName: "Creator One",
        platformAccounts: [
          { handle: "creator.one", sourceAccountId: "native-correct" },
        ],
      }),
    ],
    creatorOptions: [handleMatch, nativeMatch],
  });

  assert.deepEqual(result.matchedOptions, [nativeMatch]);
});

test("payout warnings include only creators with a deal overlapping the range", () => {
  const augustDeal = {
    effectiveStartDate: new Date("2026-08-01T00:00:00.000Z"),
    effectiveEndDate: new Date("2026-08-31T00:00:00.000Z"),
  };
  const creators = [
    campaignCreator({ id: "august", deals: [augustDeal] }),
    campaignCreator({ id: "no-deal" }),
    campaignCreator({
      id: "expired",
      deals: [{
        effectiveStartDate: new Date("2026-07-01T00:00:00.000Z"),
        effectiveEndDate: new Date("2026-07-31T00:00:00.000Z"),
      }],
    }),
    campaignCreator({
      id: "maddy",
      displayName: "Maddy",
      platformAccounts: [{ handle: "maddymomoftwo" }],
      deals: [augustDeal],
    }),
    campaignCreator({
      id: "mumtips",
      displayName: "mumtipswithginny",
      platformAccounts: [{ handle: "mumtipswithginny" }],
      deals: [augustDeal],
    }),
  ];

  assert.deepEqual(
    getPayoutWarningCampaignCreators(
      creators,
      new Date("2026-08-01T00:00:00.000Z"),
      new Date("2026-08-31T00:00:00.000Z"),
    ).map((creator) => creator.id),
    ["august"],
  );
});

test("externally paid mom creator rows are removed from payout inputs", () => {
  assert.equal(
    isExternallyPaidMomCreatorRow({
      creatorName: "Maddy",
      accountHandle: "maddymomoftwo",
    }),
    true,
  );
  assert.equal(
    isExternallyPaidMomCreatorRow({
      creatorName: "mumtipswithginny",
      accountHandle: "mumtipswithginny",
    }),
    true,
  );
  assert.equal(
    isExternallyPaidMomCreatorRow({
      creatorName: "Regular creator",
      accountHandle: "regular.creator",
    }),
    false,
  );
});
