import assert from "node:assert/strict";
import test from "node:test";

import {
  canUseSingularCreativeIdAsVideoSignal,
  getSingularRowsForTikTokAdGroup,
} from "../src/lib/singular-row-association.ts";

function row(overrides = {}) {
  return {
    rowKey: "row-1",
    creativeId: "ad-1",
    ...overrides,
  };
}

test("creator payout mode excludes Singular name-only ad group associations", () => {
  const result = getSingularRowsForTikTokAdGroup({
    groupAdId: "ad-1",
    groupNameKeys: ["same video"],
    groupIdsByNameKey: new Map([["same video", new Set(["ad-1"])]]),
    rowsByCreativeId: new Map(),
    rowsByNameKey: new Map([["same video", [row({ rowKey: "name-row" })]]]),
    mode: "exact-ad-id-only",
  });

  assert.deepEqual(result.rows, []);
  assert.equal(result.matchedByAdId, false);
  assert.equal(result.blockedNameOnlyMatch, true);
});

test("creator payout mode keeps exact Singular ad ID associations only", () => {
  const exactRow = row({ rowKey: "exact-row", creativeId: "ad-1" });
  const nameRow = row({ rowKey: "name-row", creativeId: "other-ad" });
  const result = getSingularRowsForTikTokAdGroup({
    groupAdId: "ad-1",
    groupNameKeys: ["same video"],
    groupIdsByNameKey: new Map([["same video", new Set(["ad-1"])]]),
    rowsByCreativeId: new Map([["ad-1", [exactRow]]]),
    rowsByNameKey: new Map([["same video", [nameRow]]]),
    mode: "exact-ad-id-only",
  });

  assert.deepEqual(result.rows, [exactRow]);
  assert.equal(result.matchedByAdId, true);
  assert.equal(result.blockedNameOnlyMatch, false);
});

test("internal mode can still use unique Singular name associations", () => {
  const nameRow = row({ rowKey: "name-row" });
  const result = getSingularRowsForTikTokAdGroup({
    groupAdId: "ad-1",
    groupNameKeys: ["same video"],
    groupIdsByNameKey: new Map([["same video", new Set(["ad-1"])]]),
    rowsByCreativeId: new Map(),
    rowsByNameKey: new Map([["same video", [nameRow]]]),
    mode: "ad-id-or-name",
  });

  assert.deepEqual(result.rows, [nameRow]);
  assert.equal(result.matchedByAdId, false);
});

test("creator payout mode does not reuse the ad ID as the video signal", () => {
  assert.equal(
    canUseSingularCreativeIdAsVideoSignal({
      creativeId: "ad-1",
      groupAdId: "ad-1",
      mode: "exact-ad-id-only",
    }),
    false,
  );
  assert.equal(
    canUseSingularCreativeIdAsVideoSignal({
      creativeId: "post-1",
      groupAdId: "ad-1",
      mode: "exact-ad-id-only",
    }),
    true,
  );
});
