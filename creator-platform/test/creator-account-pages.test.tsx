import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import AccountPage from "@/app/account/page";
import ApplicationStatusPage from "@/app/application/status/page";

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

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={String(href)} {...props}>{children}</a>
  ),
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

vi.mock("@/server/accounts/application", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/server/accounts/application")>();
  return {
    ...original,
    getOwnCreatorApplication: mocks.application,
  };
});

const application = {
  id: "application-1",
  name: "Dylan Smith",
  phoneNumber: "+15555550123",
  discordUsername: "dylan",
  status: "submitted",
  submittedAt: "2026-08-30T16:30:00.000Z",
  reviewedAt: null,
  accounts: [
    { platform: "TIKTOK" as const, handle: "@dylan.grows" },
    { platform: "INSTAGRAM_REELS" as const, handle: "dylan.builds" },
  ],
};

describe("real creator account pages", () => {
  beforeEach(() => {
    mocks.account.mockReset();
    mocks.accountState.mockReset();
    mocks.application.mockReset();
    mocks.redirect.mockClear();
    mocks.account.mockResolvedValue({
      id: "creator-1",
      email: "dylan@example.com",
    });
    mocks.application.mockResolvedValue(application);
  });

  it("renders persisted creator details and a real protected next action", async () => {
    mocks.accountState.mockResolvedValue({
      nextPath: "/application/status",
      profileState: "application_pending",
      applicationState: "submitted",
      agreementState: null,
    });

    render(await AccountPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByRole("heading", { name: "Welcome, Dylan." })).toBeInTheDocument();
    expect(screen.getByText("dylan@example.com")).toBeInTheDocument();
    expect(screen.getByText("+15555550123")).toBeInTheDocument();
    expect(screen.getByText("dylan", { selector: "dd" })).toBeInTheDocument();
    expect(screen.getByText("@dylan.grows")).toBeInTheDocument();
    expect(screen.getByText("@dylan.builds")).toBeInTheDocument();
    expect(screen.getByText("Submitted Aug 30, 2026")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View application status" })).toHaveAttribute(
      "href",
      "/application/status",
    );
    expect(document.querySelector('a[href="/preview/creator"]')).toBeNull();
  });

  it("keeps saved details visible and fails closed when account state is unavailable", async () => {
    mocks.accountState.mockRejectedValue(new Error("database unavailable"));

    render(await AccountPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByRole("alert")).toHaveTextContent(/onboarding state is temporarily unavailable/i);
    expect(screen.getByRole("heading", { name: "Submitted details" })).toBeInTheDocument();
    expect(screen.getByText("Submitted", { selector: "dd" })).toBeInTheDocument();
    expect(screen.getByText(/cannot determine your next action/i)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /continue application/i })).not.toBeInTheDocument();
  });

  it("shows the persisted application snapshot on the review-status page", async () => {
    mocks.accountState.mockResolvedValue({
      nextPath: "/onboarding/agreement",
      profileState: "agreement_pending",
      applicationState: "approved",
      agreementState: "pending",
    });
    mocks.application.mockResolvedValue({ ...application, status: "approved" });

    render(await ApplicationStatusPage());

    expect(screen.getByRole("heading", { name: "Your application is approved." })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Submitted details" })).toBeInTheDocument();
    expect(screen.getByText("@dylan.grows")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Continue to agreement" })).toHaveAttribute(
      "href",
      "/onboarding/agreement",
    );
    expect(document.querySelector('a[href="/preview/creator"]')).toBeNull();
  });

  it("shows saved status without redirecting or inventing an action during a state outage", async () => {
    mocks.accountState.mockRejectedValue(new Error("database unavailable"));

    render(await ApplicationStatusPage());

    expect(screen.getByRole("heading", { name: "Your application is in." })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(/review state is temporarily unavailable/i);
    expect(screen.getByRole("heading", { name: "Submitted details" })).toBeInTheDocument();
    expect(screen.getByText(/cannot determine your next action/i)).toBeInTheDocument();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("treats /account as the active protected destination", async () => {
    mocks.accountState.mockResolvedValue({
      nextPath: "/account",
      profileState: "active",
      applicationState: "approved",
      agreementState: "completed",
    });
    mocks.application.mockResolvedValue({ ...application, status: "approved" });

    render(await ApplicationStatusPage());

    expect(screen.getByText("Your creator account is active.")).toBeInTheDocument();
    expect(document.querySelector('a[href="/preview/creator"]')).toBeNull();
  });
});
