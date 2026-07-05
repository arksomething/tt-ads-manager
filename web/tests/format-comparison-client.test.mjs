import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("format comparison renders report data while source proceeds are pending", async () => {
  const source = await readFile(
    "src/app/org/[organizationSlug]/format-comparison/format-comparison-client.tsx",
    "utf8",
  );

  assert.doesNotMatch(source, /if \(currentData\.isPending\)\s*{/);
  assert.match(source, /Source proceeds pending/);
  assert.match(source, /<FormatRanking data=\{currentData\} \/>/);
});

test("format comparison only renders seven video cards per day", async () => {
  const source = await readFile(
    "src/app/org/[organizationSlug]/format-comparison/format-comparison-client.tsx",
    "utf8",
  );

  assert.match(source, /const DAILY_VIDEO_CARD_LIMIT = 7;/);
  assert.match(source, /const visibleRows = day\.rows\.slice\(0, DAILY_VIDEO_CARD_LIMIT\);/);
});
