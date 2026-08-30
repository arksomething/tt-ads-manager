import { describe, expect, it } from "vitest";

import {
  CREATOR_APPLICATION_PLATFORMS,
  findDuplicateCreatorAccountIndex,
  normalizeApplicationPhone,
  normalizeCreatorHandle,
  PROGRAM_DEFAULT_DEAL,
  validateCreatorApplicationInput,
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

  it("validates and trims the server submission contract", () => {
    expect(validateCreatorApplicationInput({
      name: "  Dylan Smith ",
      phoneNumber: " +1 555 555 0123 ",
      discordUsername: " dylan ",
      accounts: [
        { platform: "TIKTOK", handle: " @Dylan.Grows " },
        { platform: "INSTAGRAM_REELS", handle: "dylan.grows" },
      ],
      userId: "must-not-be-trusted",
      deal: "must-not-be-trusted",
    })).toEqual({
      ok: true,
      value: {
        name: "Dylan Smith",
        phoneNumber: "+15555550123",
        discordUsername: "dylan",
        accounts: [
          { platform: "TIKTOK", handle: "@Dylan.Grows" },
          { platform: "INSTAGRAM_REELS", handle: "dylan.grows" },
        ],
      },
    });
  });

  it("rejects invalid platforms, phone numbers, and duplicate accounts", () => {
    expect(validateCreatorApplicationInput({
      name: "Dylan Smith",
      phoneNumber: "123",
      discordUsername: "dylan",
      accounts: [{ platform: "YOUTUBE", handle: "dylan" }],
    })).toEqual({ ok: false, error: "Enter a valid phone number." });

    expect(validateCreatorApplicationInput({
      name: "Dylan Smith",
      phoneNumber: "+1 555 555 0123",
      discordUsername: "dylan",
      accounts: [
        { platform: "TIKTOK", handle: "@Dylan.Grows" },
        { platform: "TIKTOK", handle: "dylan.grows" },
      ],
    })).toEqual({ ok: false, error: "Each platform and handle may be listed only once." });

    expect(validateCreatorApplicationInput({
      name: "Dylan Smith",
      phoneNumber: "+1 555 555 0123",
      discordUsername: "dylan",
      accounts: [{ platform: "TIKTOK", handle: "dylán" }],
    })).toEqual({ ok: false, error: "Enter a valid handle for every creator account." });
  });

  it("requires a country code and produces normalized E.164 phone values", () => {
    expect(normalizeApplicationPhone("+1 (555) 555-0123")).toBe("+15555550123");
    expect(normalizeApplicationPhone("1 555 555 0123")).toBeNull();
    expect(normalizeApplicationPhone("+1 call-me-now")).toBeNull();
  });
});
