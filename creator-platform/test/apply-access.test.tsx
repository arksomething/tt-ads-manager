import { beforeEach, describe, expect, it, vi } from "vitest";

import ApplyPage from "@/app/apply/page";

const mocks = vi.hoisted(() => ({
  account: vi.fn(),
  accountState: vi.fn(),
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

describe("creator application access", () => {
  beforeEach(() => {
    mocks.account.mockReset();
    mocks.accountState.mockReset();
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
});
