import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  getOwnCreatorApplication,
  normalizeCreatorApplicationSnapshot,
} from "@/server/accounts/application";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ rpc: mocks.rpc }),
}));

const applicationRow = {
  application_id: "application-1",
  applicant_name: "Dylan Smith",
  phone_e164: "+15555550123",
  discord_username: "dylan",
  application_status: "submitted",
  submitted_at: "2026-08-30T16:30:00.000Z",
  reviewed_at: null,
  creator_accounts: [
    { platform: "TIKTOK", handle: "@dylan.grows" },
    { platform: "INSTAGRAM_REELS", handle: "dylan.builds" },
  ],
};

describe("own creator application", () => {
  beforeEach(() => {
    mocks.rpc.mockReset();
  });

  it("normalizes the applicant-safe RPC snapshot", () => {
    expect(normalizeCreatorApplicationSnapshot([applicationRow])).toEqual({
      id: "application-1",
      name: "Dylan Smith",
      phoneNumber: "+15555550123",
      discordUsername: "dylan",
      status: "submitted",
      submittedAt: "2026-08-30T16:30:00.000Z",
      reviewedAt: null,
      accounts: [
        { platform: "TIKTOK", handle: "@dylan.grows" },
        { platform: "INSTAGRAM_REELS", handle: "dylan.builds" },
      ],
    });
  });

  it("returns null for an empty or incomplete RPC result", () => {
    expect(normalizeCreatorApplicationSnapshot([])).toBeNull();
    expect(normalizeCreatorApplicationSnapshot([{ ...applicationRow, applicant_name: null }])).toBeNull();
  });

  it("calls only the applicant-safe RPC and rejects provider errors", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: [applicationRow], error: null });
    await expect(getOwnCreatorApplication()).resolves.toMatchObject({
      id: "application-1",
      name: "Dylan Smith",
    });
    expect(mocks.rpc).toHaveBeenCalledWith("get_own_creator_application");

    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: "XX000" } });
    await expect(getOwnCreatorApplication()).rejects.toThrow(
      "Could not load the creator application.",
    );
  });
});
