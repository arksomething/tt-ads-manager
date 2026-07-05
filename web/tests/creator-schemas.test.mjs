import assert from "node:assert/strict";
import test from "node:test";

import { normalizeTikTokHandleInput } from "../src/server/creators/handles.ts";

test("normalizes TikTok handle inputs", () => {
  assert.equal(normalizeTikTokHandleInput("@creator.handle"), "creator.handle");
  assert.equal(normalizeTikTokHandleInput("creator.handle"), "creator.handle");
  assert.equal(
    normalizeTikTokHandleInput("https://www.tiktok.com/@creator.handle"),
    "creator.handle",
  );
  assert.equal(
    normalizeTikTokHandleInput("https://www.tiktok.com/@creator.handle?lang=en"),
    "creator.handle",
  );
});

test("leaves invalid handle text for the schema to reject", () => {
  assert.equal(normalizeTikTokHandleInput("bad handle!"), "bad handle!");
});
