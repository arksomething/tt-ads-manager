import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  getOwnContentWorkspace,
  normalizeCreatorContentWorkspace,
} from "@/server/accounts/content";
import {
  formatMinorUnits,
  getOwnEarningsWorkspace,
  normalizeCreatorEarningsWorkspace,
} from "@/server/accounts/earnings";

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ rpc: mocks.rpc }),
}));

describe("creator content and earnings workspaces", () => {
  beforeEach(() => mocks.rpc.mockReset());

  it("normalizes real post observations while preserving missing counters", () => {
    expect(normalizeCreatorContentWorkspace({
      canSubmit: true,
      platformAccounts: [{
        id: "platform-account-1",
        platform: "TIKTOK",
        handle: "creator",
      }],
      submissions: [{
        id: "submission-1",
        platform: "TIKTOK",
        url: "https://tiktok.com/@creator/video/123",
        declaredNativePostId: "123",
        matchState: "matched",
        matchedPostId: "post-1",
        submittedAt: "2026-08-31T10:00:00Z",
        matchedAt: "2026-08-31T11:00:00Z",
        creatorNote: null,
      }],
      posts: [{
        id: "post-1",
        platform: "TIKTOK",
        nativePostId: "123",
        canonicalUrl: "https://tiktok.com/@creator/video/123",
        publishedAt: null,
        attributionState: "verified",
        latestObservation: {
          observedAt: "2026-08-31T12:00:00Z",
          viewCount: "4200",
          likeCount: null,
          commentCount: "32",
          shareCount: null,
        },
      }],
    })).toMatchObject({
      canSubmit: true,
      posts: [{ latestObservation: { viewCount: "4200", likeCount: null } }],
    });
  });

  it("uses safe empty collections and rejects malformed RPC envelopes", () => {
    expect(normalizeCreatorContentWorkspace({
      canSubmit: false,
      platformAccounts: [],
      submissions: [],
      posts: [],
    })).toEqual({ canSubmit: false, platformAccounts: [], submissions: [], posts: [] });
    expect(normalizeCreatorContentWorkspace({ submissions: [], posts: [] })).toBeNull();

    expect(normalizeCreatorEarningsWorkspace({ entries: [], settlements: [] }))
      .toEqual({ entries: [], settlements: [] });
    expect(normalizeCreatorEarningsWorkspace(null)).toBeNull();
  });

  it("fails closed instead of hiding malformed content or finance rows", () => {
    expect(normalizeCreatorContentWorkspace({
      canSubmit: true,
      platformAccounts: [],
      submissions: [],
      posts: [{ id: "post-without-platform" }],
    })).toBeNull();

    expect(normalizeCreatorEarningsWorkspace({
      entries: [{ id: "earning-without-an-amount" }],
      settlements: [],
    })).toBeNull();
  });

  it("keeps minor-unit formatting exact and aware of currency exponent", () => {
    expect(formatMinorUnits("123456", "USD", 2)).toBe("USD 1,234.56");
    expect(formatMinorUnits("-501", "USD", 2)).toBe("-USD 5.01");
    expect(formatMinorUnits("4200", "JPY", 0)).toBe("JPY 4,200");
  });

  it("loads only creator-safe RPCs and fails closed on provider errors", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: { canSubmit: false, platformAccounts: [], submissions: [], posts: [] },
      error: null,
    });
    await expect(getOwnContentWorkspace()).resolves.toMatchObject({ canSubmit: false });
    expect(mocks.rpc).toHaveBeenLastCalledWith("get_own_content_workspace");

    mocks.rpc.mockResolvedValueOnce({ data: { entries: [], settlements: [] }, error: null });
    await expect(getOwnEarningsWorkspace()).resolves.toEqual({ entries: [], settlements: [] });
    expect(mocks.rpc).toHaveBeenLastCalledWith("get_own_earnings_workspace");

    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: "XX000" } });
    await expect(getOwnContentWorkspace()).rejects.toThrow("Could not load");
  });
});
