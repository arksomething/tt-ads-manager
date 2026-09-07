import { beforeEach, describe, expect, it, vi } from "vitest";

import ApplyPage from "@/app/apply/page";

const mocks = vi.hoisted(() => ({
  account: vi.fn(),
  accountState: vi.fn(),
  application: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`);
  }),
}));

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
}));

vi.mock("@/lib/server-env", () => ({
  hasSupabaseAuthEnv: () => true,
}));

vi.mock("@/server/auth/session", () => ({
  getCurrentAccount: mocks.account,
}));

vi.mock("@/server/accounts/state", () => ({
  getCreatorAccountState: mocks.accountState,
}));

vi.mock("@/server/accounts/application", () => ({
  getOwnCreatorApplication: mocks.application,
}));

describe("creator application access", () => {
  beforeEach(() => {
    mocks.account.mockReset();
    mocks.accountState.mockReset();
    mocks.application.mockReset();
    mocks.redirect.mockClear();
  });

  it.each([
    ["submitted", "/application/status"],
    ["in_review", "/application/status"],
    ["rejected", "/application/status"],
    ["approved", "/onboarding/agreement"],
  ])("routes an existing %s application to %s", async (applicationState, nextPath) => {
    mocks.account.mockResolvedValue({ id: "creator-1", email: "creator@example.com" });
    mocks.accountState.mockResolvedValue({
      nextPath,
      profileState: "active",
      applicationState,
      agreementState: applicationState === "approved" ? "pending" : null,
    });

    await expect(ApplyPage()).rejects.toThrow(`redirect:${nextPath}`);
  });

  it("renders the application only when the account state explicitly points to /apply", async () => {
    mocks.account.mockResolvedValue({ id: "creator-1", email: "creator@example.com" });
    mocks.accountState.mockResolvedValue({
      nextPath: "/apply",
      profileState: "active",
      applicationState: null,
      agreementState: null,
    });

    const page = await ApplyPage();

    expect(page.type).toBe("main");
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("prefills the application when staff explicitly requested a revision", async () => {
    mocks.account.mockResolvedValue({ id: "creator-1", email: "creator@example.com" });
    mocks.accountState.mockResolvedValue({
      nextPath: "/application/status",
      profileState: "application_pending",
      applicationState: "changes_requested",
      agreementState: null,
    });
    mocks.application.mockResolvedValue({
      id: "application-1",
      name: "Dylan Smith",
      phoneNumber: "+15555550123",
      discordUsername: "dylan",
      status: "changes_requested",
      submittedAt: "2026-08-31T12:00:00.000Z",
      reviewedAt: "2026-08-31T13:00:00.000Z",
      decisionMessage: "Update the Instagram handle.",
      reviewRevision: 0,
      accounts: [{ platform: "INSTAGRAM_REELS", handle: "@dylan" }],
    });

    const page = await ApplyPage();

    expect(page.type).toBe("main");
    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(mocks.application).toHaveBeenCalledOnce();
  });
});
