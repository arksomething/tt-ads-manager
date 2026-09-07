import { describe, expect, it } from "vitest";

import { validateCreatorContentInput } from "@/lib/creator-content";

describe("creator content input", () => {
  it("normalizes a valid creator post and drops attacker-selected fields", () => {
    expect(validateCreatorContentInput({
      platform: "tiktok",
      url: "https://www.tiktok.com/@creator/video/123#comments",
      nativePostId: "123",
      platformAccountId: "d9428888-122b-4f22-9f8e-fadce93715ed",
      note: "  First campaign post  ",
      accountId: "attacker-selected-account",
      matchState: "matched",
      earnings: 999999,
    })).toEqual({
      ok: true,
      value: {
        platform: "TIKTOK",
        url: "https://www.tiktok.com/@creator/video/123",
        nativePostId: "123",
        platformAccountId: "d9428888-122b-4f22-9f8e-fadce93715ed",
        note: "First campaign post",
      },
    });
  });

  it("requires the URL host to match the selected platform", () => {
    expect(validateCreatorContentInput({
      platform: "TIKTOK",
      url: "https://www.instagram.com/reel/ABC/",
    })).toEqual({ ok: false, error: "Enter a TikTok URL for this submission." });

    expect(validateCreatorContentInput({
      platform: "INSTAGRAM_REELS",
      url: "https://tiktok.com.evil.example/@creator/video/123",
    })).toEqual({ ok: false, error: "Enter an Instagram URL for this submission." });
  });

  it("rejects credentials, invalid native IDs, and malformed account IDs", () => {
    expect(validateCreatorContentInput({
      platform: "TIKTOK",
      url: "https://user:password@tiktok.com/@creator/video/123",
    })).toMatchObject({ ok: false });
    expect(validateCreatorContentInput({
      platform: "TIKTOK",
      url: "https://tiktok.com/@creator/video/123",
      nativePostId: "id with spaces",
    })).toEqual({ ok: false, error: "Check the optional native post ID." });
    expect(validateCreatorContentInput({
      platform: "TIKTOK",
      url: "https://tiktok.com/@creator/video/123",
      platformAccountId: "not-a-uuid",
    })).toEqual({ ok: false, error: "Choose a valid connected creator account." });
  });
});
