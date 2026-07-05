import assert from "node:assert/strict";
import test from "node:test";

import { hasPendingCreatorPortalData } from "../src/server/creator-portal/pending.ts";

test("creator portal does not hide the ledger for bounded paid matching timeouts", () => {
  assert.equal(
    hasPendingCreatorPortalData([
      "Paid traffic matching did not finish within 25 seconds, so paid delivery remains unknown for unmatched rows. Refresh this page to retry exact paid matching.",
    ]),
    false,
  );
});

test("creator portal waits for Singular pending statuses", () => {
  assert.equal(
    hasPendingCreatorPortalData(["Singular report status is running."]),
    true,
  );
  assert.equal(
    hasPendingCreatorPortalData([
      "Singular is still preparing the report for this date window. This page will check again automatically.",
    ]),
    true,
  );
  assert.equal(
    hasPendingCreatorPortalData([
      "Singular report status is started. This page will check again automatically and reuse the export once it is ready.",
    ]),
    true,
  );
});

test("creator portal does not hide the ledger for non-pending diagnostics", () => {
  assert.equal(
    hasPendingCreatorPortalData(["TikTok credentials are missing."]),
    false,
  );
  assert.equal(
    hasPendingCreatorPortalData([
      "TikTok returned 24 ad groups without a resolvable TikTok post ID. Those rows were excluded from per-video tallies.",
    ]),
    false,
  );
});
