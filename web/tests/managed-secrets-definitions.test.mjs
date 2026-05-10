import assert from "node:assert/strict";
import test from "node:test";

import {
  getManagedSecretDefinition,
  isManagedSecretKey,
  managedSecretDefinitions,
} from "../src/server/settings/managed-secrets-definitions.ts";

test("limits settings token resets to the supported production secrets", () => {
  assert.deepEqual(
    managedSecretDefinitions.map((definition) => definition.key),
    [
      "VIEWSBASE_SESSION_COOKIE_VALUE",
      "ADAPTY_API_KEY",
      "ADAPTY_DASHBOARD_TOKEN",
    ],
  );
  assert.equal(isManagedSecretKey("ADAPTY_DASHBOARD_TOKEN"), true);
  assert.equal(isManagedSecretKey("AUTH_SECRET"), false);
});

test("returns user-facing metadata for managed production secrets", () => {
  assert.equal(
    getManagedSecretDefinition("VIEWSBASE_SESSION_COOKIE_VALUE")?.shortLabel,
    "ViewsBase",
  );
});
