import assert from "node:assert/strict";
import test from "node:test";

import {
  canAccessDashboardSection,
  getDashboardNavGroupsForRole,
  getDashboardWorkspaceEntryHref,
  getDefaultDashboardHrefForRole,
} from "../src/components/org-dashboard/mock-data.ts";
import {
  canEditCreatorPortalDealTerms,
  canManageCreatorDeals,
  canOpenCreatorPayLinks,
  canReadOrganizationCampaignData,
} from "../src/server/auth/roles.ts";

test("limits BLAZIE profile navigation to Blazie-approved tabs", () => {
  assert.equal(canAccessDashboardSection("BLAZIE", "blazie"), true);
  assert.equal(canAccessDashboardSection("BLAZIE", "ugc-pay"), true);
  assert.equal(canAccessDashboardSection("BLAZIE", "video-manager"), true);
  assert.equal(canAccessDashboardSection("BLAZIE", "format-comparison"), true);
  assert.equal(canAccessDashboardSection("BLAZIE", "revenue"), false);
  assert.equal(canAccessDashboardSection("BLAZIE", "links"), false);

  const items = getDashboardNavGroupsForRole("BLAZIE").flatMap(
    (group) => group.items,
  );

  assert.deepEqual(
    items.map((item) => item.key),
    ["ugc-pay", "blazie", "video-manager", "format-comparison"],
  );
  assert.equal(getDefaultDashboardHrefForRole("gotal", "BLAZIE"), "/org/gotal/blazie");
});

test("opens BLAZIE workspaces directly on the Blazie tab", () => {
  assert.equal(
    getDashboardWorkspaceEntryHref({
      organization: {
        slug: "gotal",
      },
      role: "BLAZIE",
    }),
    "/org/gotal/blazie",
  );
});

test("keeps full dashboard navigation for normal profiles", () => {
  assert.equal(canAccessDashboardSection("ADMIN", "revenue"), true);
  assert.ok(getDashboardNavGroupsForRole("ADMIN").flatMap((group) => group.items).length > 1);
  assert.equal(getDefaultDashboardHrefForRole("gotal", "ADMIN"), "/org/gotal");
  assert.equal(
    getDashboardWorkspaceEntryHref({
      organization: {
        slug: "gotal",
      },
      role: "ADMIN",
    }),
    "/org/gotal",
  );
});

test("lets BLAZIE reports read organization campaign data without full navigation", () => {
  assert.equal(canReadOrganizationCampaignData("BLAZIE"), true);
  assert.equal(canReadOrganizationCampaignData("MEMBER"), false);
});

test("lets BLAZIE open creator pay links without full org management", () => {
  assert.equal(canOpenCreatorPayLinks("BLAZIE"), true);
  assert.equal(canOpenCreatorPayLinks("ADMIN"), true);
  assert.equal(canOpenCreatorPayLinks("MEMBER"), false);
});

test("lets BLAZIE manage creator deal terms without full org management", () => {
  assert.equal(canManageCreatorDeals("BLAZIE"), true);
  assert.equal(canManageCreatorDeals("ADMIN"), true);
  assert.equal(canManageCreatorDeals("MEMBER"), false);
});

test("only logged-in account roles or campaign managers can edit creator portal deals", () => {
  assert.equal(
    canEditCreatorPortalDealTerms({ organizationRole: null }),
    false,
  );
  assert.equal(
    canEditCreatorPortalDealTerms({ organizationRole: "MEMBER" }),
    false,
  );
  assert.equal(
    canEditCreatorPortalDealTerms({
      campaignCanManage: true,
      organizationRole: "MEMBER",
    }),
    true,
  );
  assert.equal(
    canEditCreatorPortalDealTerms({ organizationRole: "BLAZIE" }),
    true,
  );
  assert.equal(
    canEditCreatorPortalDealTerms({ organizationRole: "ADMIN" }),
    true,
  );
});
