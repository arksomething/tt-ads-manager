import assert from "node:assert/strict";
import test from "node:test";

import { getDefaultUgcPayStartDateForEndDate } from "../src/lib/ugc-pay-date-defaults.ts";

test("defaults creator pay posted mode to seven calendar days ending on the pay date", () => {
  assert.equal(getDefaultUgcPayStartDateForEndDate("2026-05-09"), "2026-05-03");
});

test("defaults the creator portal compact filter to the last seven days", () => {
  assert.deepEqual(
    {
      startDate: getDefaultUgcPayStartDateForEndDate("2026-04-30"),
      endDate: "2026-04-30",
    },
    {
      startDate: "2026-04-24",
      endDate: "2026-04-30",
    },
  );
});
