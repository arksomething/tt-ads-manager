import { describe, expect, it } from "vitest";

import {
  CREATOR_APPLICATION_PLATFORMS,
  findDuplicateCreatorAccountIndex,
  normalizeCreatorHandle,
  PROGRAM_DEFAULT_DEAL,
} from "@/lib/creator-application";

describe("creator application contract", () => {
  it("exposes only the launch-supported platforms and a server-assigned deal", () => {
    expect(CREATOR_APPLICATION_PLATFORMS).toEqual([
      { value: "TIKTOK", label: "TikTok" },
      { value: "INSTAGRAM_REELS", label: "Instagram" },
    ]);
    expect(PROGRAM_DEFAULT_DEAL.assignment).toBe("server-on-acceptance");
  });

  it("normalizes handles and finds duplicates only within the same platform", () => {
    expect(normalizeCreatorHandle("  @@Dylan.Grows ")).toBe("dylan.grows");
    expect(findDuplicateCreatorAccountIndex([
      { platform: "TIKTOK", handle: "@Dylan.Grows" },
      { platform: "INSTAGRAM_REELS", handle: "dylan.grows" },
      { platform: "TIKTOK", handle: "dylan.grows" },
    ])).toBe(2);
  });
});
