import assert from "node:assert/strict";
import test from "node:test";

import {
  getDateRangeCacheControl,
  getDateRangeCacheHeaders,
  NO_STORE_CACHE_CONTROL,
  SHORT_PRIVATE_CACHE_CONTROL,
} from "../src/lib/cache-control.ts";

const today = new Date("2026-05-10T15:30:00.000Z");

test("uses no-store when a date range includes today", () => {
  assert.equal(
    getDateRangeCacheControl({
      endDate: "2026-05-10",
      startDate: "2026-05-04",
      today,
    }),
    NO_STORE_CACHE_CONTROL,
  );
  assert.deepEqual(
    getDateRangeCacheHeaders({
      endDate: "2026-05-12",
      startDate: "2026-05-10",
      today,
    }),
    {
      "Cache-Control": NO_STORE_CACHE_CONTROL,
    },
  );
});

test("treats the current New York date as today for evening reports", () => {
  assert.equal(
    getDateRangeCacheControl({
      endDate: "2026-05-10",
      startDate: "2026-05-04",
      today: new Date("2026-05-11T00:30:00.000Z"),
    }),
    NO_STORE_CACHE_CONTROL,
  );
});

test("allows short private caching for completed historical ranges", () => {
  assert.equal(
    getDateRangeCacheControl({
      endDate: "2026-05-09",
      startDate: "2026-05-04",
      today,
    }),
    SHORT_PRIVATE_CACHE_CONTROL,
  );
});

test("can treat missing dates as today-backed dynamic queries", () => {
  assert.equal(
    getDateRangeCacheControl({
      endDate: null,
      missingDateIncludesToday: true,
      startDate: null,
      today,
    }),
    NO_STORE_CACHE_CONTROL,
  );
});
