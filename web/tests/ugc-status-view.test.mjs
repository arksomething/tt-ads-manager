import assert from "node:assert/strict";
import test from "node:test";

import { getInitialDetailedStatisticsOpen } from "../src/lib/ugc-status-view.ts";

test("keeps detailed statistics collapsed by default for Blazie", () => {
  assert.equal(getInitialDetailedStatisticsOpen("blazie"), false);
});

test("keeps detailed statistics collapsed by default outside Blazie", () => {
  assert.equal(getInitialDetailedStatisticsOpen("default"), false);
  assert.equal(getInitialDetailedStatisticsOpen(), false);
});
