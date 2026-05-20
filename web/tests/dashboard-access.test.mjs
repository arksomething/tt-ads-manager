import assert from "node:assert/strict";
import test from "node:test";

import {
  canAccessDashboardSection,
  getDashboardNavGroupsForRole,
  getDefaultDashboardHrefForRole,
} from "../src/components/org-dashboard/mock-data.ts";
import { canReadOrganizationCampaignData } from "../src/server/auth/roles.ts";

test("limits BLAZIE profile navigation to the Blazie tab", () => {
  assert.equal(canAccessDashboardSection("BLAZIE", "blazie"), true);
  assert.equal(canAccessDashboardSection("BLAZIE", "revenue"), false);

  const items = getDashboardNavGroupsForRole("BLAZIE").flatMap(
    (group) => group.items,
  );

  assert.deepEqual(
    items.map((item) => item.key),
    ["blazie"],
  );
  assert.equal(getDefaultDashboardHrefForRole("gotal", "BLAZIE"), "/org/gotal/blazie");
});

test("keeps full dashboard navigation for normal profiles", () => {
  assert.equal(canAccessDashboardSection("ADMIN", "revenue"), true);
  assert.ok(getDashboardNavGroupsForRole("ADMIN").flatMap((group) => group.items).length > 1);
  assert.equal(getDefaultDashboardHrefForRole("gotal", "ADMIN"), "/org/gotal");
});

test("lets BLAZIE reports read organization campaign data without full navigation", () => {
  assert.equal(canReadOrganizationCampaignData("BLAZIE"), true);
  assert.equal(canReadOrganizationCampaignData("MEMBER"), false);
});
