import { describe, expect, it } from "vitest";

import { normalizeAdminCreatorProfile, normalizeAdminWorkspace } from "@/server/admin/workspace";

const summary = {
  creatorCount: 1,
  activeCreatorCount: 1,
  applicationAttentionCount: 0,
  verifiedPlatformAccountCount: 1,
  publishedPostCount: 1,
  contentAttentionCount: 0,
  observedPostCount: 1,
  knownDeltaPostCount: 0,
  viewsGained: null,
  discordConnectedCount: 1,
};

const workspace = {
  range: { start: "2026-08-25", end: "2026-08-31" },
  summary,
  earnings: [],
  settlements: [],
  dailyActivity: [{ date: "2026-08-31", posts: 1, submissions: 0, observedPosts: 1 }],
  creators: [{
    accountId: "11111111-1111-4111-8111-111111111111",
    name: "Creator",
    email: "creator@example.com",
    lifecycleStatus: "active",
    applicationId: null,
    applicationStatus: null,
    enrollmentStatus: "active",
    joinedAt: "2026-08-01T12:00:00Z",
    approvedAt: "2026-08-02T12:00:00Z",
    platforms: [],
    postCount: 1,
    openSubmissionCount: 0,
    lastPostAt: "2026-08-31T12:00:00Z",
    lastActivityAt: "2026-08-31T12:00:00Z",
  }],
};

describe("admin workspace data boundaries", () => {
  it("accepts complete zero counts but rejects missing or malformed counts", () => {
    expect(normalizeAdminWorkspace(workspace)).toMatchObject({
      summary: { contentAttentionCount: 0, viewsGained: null },
    });
    expect(normalizeAdminWorkspace({
      ...workspace,
      summary: { ...summary, creatorCount: null },
    })).toBeNull();
    expect(normalizeAdminWorkspace({
      ...workspace,
      dailyActivity: [{ date: "2026-08-31", posts: "unknown", submissions: 0, observedPosts: 1 }],
    })).toBeNull();
  });

  it("rejects partial creator-profile arrays instead of claiming an empty ledger", () => {
    const base = {
      account: { id: "11111111-1111-4111-8111-111111111111" },
      application: null,
      enrollment: null,
      agreement: null,
      platformClaims: [],
      posts: [],
      submissions: [],
      earnings: [],
      settlements: [],
      scripts: [],
    };
    expect(normalizeAdminCreatorProfile(base)).not.toBeNull();
    expect(normalizeAdminCreatorProfile({
      ...base,
      earnings: [{ id: "valid-shape" }, null],
    })).toBeNull();
  });
});
