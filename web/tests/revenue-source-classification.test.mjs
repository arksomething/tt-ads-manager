import assert from "node:assert/strict";
import test from "node:test";

import {
  getRevenueSourceKind,
  isOrganicSingularLabel,
  splitCommaSeparatedList,
} from "../src/server/revenue/source-classification.ts";

const tiktokPatterns = ["tiktok", "tik tok"];
const applePatterns = ["apple search ads", "asa"];
const creatorPatterns = splitCommaSeparatedList("social custom");

test("classifies Singular social custom as organic creator revenue", () => {
  assert.equal(
    getRevenueSourceKind({
      applePatterns,
      creatorPatterns,
      label: "social (Custom)",
      tiktokPatterns,
    }),
    "organic",
  );
  assert.equal(isOrganicSingularLabel("social (Custom)", creatorPatterns), true);
});

test("classifies provider No Data as organic unattributed revenue", () => {
  assert.equal(
    getRevenueSourceKind({
      applePatterns,
      creatorPatterns,
      label: "No Data",
      tiktokPatterns,
    }),
    "organic",
  );
  assert.equal(isOrganicSingularLabel("No Data", creatorPatterns), true);
});

test("classifies Superwall organic fallback as unattributed revenue", () => {
  assert.equal(
    getRevenueSourceKind({
      applePatterns,
      creatorPatterns,
      label: "Organic / unattributed",
      tiktokPatterns,
    }),
    "organic",
  );
});

test("keeps true paid sources in the paid bucket", () => {
  assert.equal(
    getRevenueSourceKind({
      applePatterns,
      creatorPatterns,
      label: "Facebook",
      tiktokPatterns,
    }),
    "paid",
  );
});
