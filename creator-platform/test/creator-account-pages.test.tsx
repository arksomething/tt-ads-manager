import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import AccountPage from "@/app/account/page";
import ApplicationStatusPage from "@/app/application/status/page";

const mocks = vi.hoisted(() => ({
  account: vi.fn(),
  accountState: vi.fn(),
  application: vi.fn(),
  home: vi.fn(),
  signWellReadiness: vi.fn(),
  staff: vi.fn(),
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

vi.mock("@/lib/agreements/signwell", () => ({
  getSignWellReadiness: mocks.signWellReadiness,
}));

vi.mock("@/server/auth/session", () => ({
  getCurrentAccount: mocks.account,
}));

vi.mock("@/server/accounts/state", () => ({
  getCreatorAccountState: mocks.accountState,
}));

vi.mock("@/server/admin/discord", () => ({
  getCurrentDiscordStaffMembership: mocks.staff,
}));

vi.mock("@/server/accounts/home", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/server/accounts/home")>();
  return {
    ...original,
    getCreatorHomeOverview: mocks.home,
  };
});

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
  decisionMessage: null,
  reviewRevision: 0,
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
    mocks.home.mockReset();
    mocks.signWellReadiness.mockReset();
    mocks.staff.mockReset();
    mocks.redirect.mockClear();
    mocks.account.mockResolvedValue({
      id: "creator-1",
      email: "dylan@example.com",
    });
    mocks.application.mockResolvedValue(application);
    mocks.signWellReadiness.mockReturnValue({
      readyToSend: false,
      testMode: true,
    });
    mocks.staff.mockResolvedValue(null);
    mocks.home.mockResolvedValue({
      availability: { content: true, earnings: true, library: true, updates: true },
      viewCoverage: {
        state: "empty",
        knownViews: null,
        totalPostCount: 0,
        postsWithKnownViews: 0,
        latestObservedAt: null,
      },
      postsLastSevenDays: 0,
      undatedPostCount: 0,
      openSubmissionCount: 0,
      earningEntryCount: 0,
      activity: Array.from({ length: 30 }, (_, index) => ({
        date: `2026-08-${String(index + 2).padStart(2, "0")}`,
        postCount: 0,
        submissionCount: 0,
      })),
      earningSummaries: [],
      scripts: [],
      updates: [],
    });
  });

  it("shows the four-step application state and hides the workspace before activation", async () => {
    mocks.accountState.mockResolvedValue({
      nextPath: "/application/status",
      profileState: "application_pending",
      applicationState: "submitted",
      agreementState: null,
    });

    render(await AccountPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByRole("heading", { name: "Welcome, Dylan." })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Application received" })).toBeInTheDocument();

    const progress = screen.getByRole("list", { name: "Creator onboarding progress" });
    const steps = within(progress).getAllByRole("listitem");
    expect(steps).toHaveLength(4);
    expect(steps[0]).toHaveTextContent("AccountComplete");
    expect(steps[1]).toHaveAttribute("aria-current", "step");
    expect(steps[1]).toHaveTextContent("ApplicationReceived");
    expect(steps[2]).toHaveTextContent("ProfilesLocked");
    expect(steps[3]).toHaveTextContent("AgreementLocked");
    expect(screen.getByRole("link", { name: "View submitted application" })).toHaveAttribute(
      "href",
      "/application/status#submitted-application",
    );
    expect(screen.queryByRole("heading", { name: "What is recorded right now" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Program tools" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Content" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Submitted details" })).not.toBeInTheDocument();
  });

  it("fails closed without exposing the workspace when onboarding state is unavailable", async () => {
    mocks.accountState.mockRejectedValue(new Error("database unavailable"));

    render(await AccountPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByRole("alert")).toHaveTextContent(/onboarding state is temporarily unavailable/i);
    expect(screen.getByRole("heading", { name: "We couldn’t load your next step" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Try again" })).toHaveAttribute("href", "/account");
    expect(screen.queryByRole("heading", { name: "What is recorded right now" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Program tools" })).not.toBeInTheDocument();
  });

  it("keeps staff operations discoverable without completing creator onboarding", async () => {
    mocks.accountState.mockResolvedValue({
      nextPath: "/apply",
      profileState: "profile_incomplete",
      applicationState: null,
      agreementState: null,
    });
    mocks.application.mockResolvedValue(null);
    mocks.staff.mockResolvedValue({ role: "admin" });

    render(await AccountPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByRole("link", { name: "Creator operations" })).toHaveAttribute("href", "/admin");
    expect(screen.getByRole("heading", { name: "You’re ready to apply" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Ready to create" })).not.toBeInTheDocument();
    expect(mocks.home).not.toHaveBeenCalled();
  });

  it("shows a real assigned next action for an active creator without adding a quota", async () => {
    mocks.accountState.mockResolvedValue({
      nextPath: "/account",
      profileState: "active",
      applicationState: "approved",
      agreementState: "completed",
    });
    mocks.application.mockResolvedValue({ ...application, status: "approved" });
    mocks.home.mockResolvedValue({
      availability: { content: true, earnings: true, library: true, updates: true },
      viewCoverage: {
        state: "partial",
        knownViews: "4200",
        totalPostCount: 2,
        postsWithKnownViews: 1,
        latestObservedAt: "2026-08-31T12:00:00.000Z",
      },
      postsLastSevenDays: 1,
      undatedPostCount: 1,
      openSubmissionCount: 0,
      earningEntryCount: 0,
      activity: Array.from({ length: 30 }, (_, index) => ({
        date: `2026-08-${String(index + 2).padStart(2, "0")}`,
        postCount: index === 29 ? 1 : 0,
        submissionCount: 0,
      })),
      earningSummaries: [],
      scripts: [{
        assignmentId: "assignment-1",
        title: "Creator retention hook",
        summary: "",
        bodyMarkdown: "Use the approved hook.",
        revision: 1,
        note: "",
        dueAt: "2026-09-02T16:00:00.000Z",
        state: "assigned",
        assignedAt: "2026-08-31T12:00:00.000Z",
      }],
      updates: [],
    });

    render(await AccountPage({ searchParams: Promise.resolve({}) }));

    expect(screen.queryByRole("list", { name: "Creator onboarding progress" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Ready to create" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Program tools" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Creator retention hook" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open assigned script" })).toHaveAttribute(
      "href",
      "/account/scripts",
    );
    expect(screen.getByText("4.2K")).toBeInTheDocument();
    expect(screen.getByText("1 of 2 recorded posts have a view count.")).toBeInTheDocument();
    expect(screen.queryByText(/streak|quota|posting goal|required posts|missed post/iu)).not.toBeInTheDocument();
  });

  it("shows an approved creator that profile verification is the next step", async () => {
    mocks.accountState.mockResolvedValue({
      nextPath: "/onboarding/accounts",
      profileState: "agreement_pending",
      applicationState: "approved",
      agreementState: "pending",
    });
    mocks.application.mockResolvedValue({ ...application, status: "approved" });

    render(await ApplicationStatusPage());

    expect(screen.getByRole("heading", { name: "You’re approved—verify your profiles" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Verify creator profiles" })).toHaveAttribute(
      "href",
      "/onboarding/accounts",
    );
    const progress = screen.getByRole("list", { name: "Creator onboarding progress" });
    const steps = within(progress).getAllByRole("listitem");
    expect(steps[0]).toHaveTextContent("AccountComplete");
    expect(steps[1]).toHaveTextContent("ApplicationComplete");
    expect(steps[2]).toHaveAttribute("aria-current", "step");
    expect(steps[2]).toHaveTextContent("ProfilesAction required");
    expect(steps[3]).toHaveTextContent("AgreementLocked");
    expect(screen.getByRole("heading", { name: "Submitted details" })).toBeInTheDocument();
  });

  it("shows the assigned agreement step and keeps the persisted application snapshot", async () => {
    mocks.accountState.mockResolvedValue({
      nextPath: "/onboarding/agreement",
      profileState: "agreement_pending",
      applicationState: "approved",
      agreementState: "pending",
    });
    mocks.application.mockResolvedValue({ ...application, status: "approved" });
    mocks.signWellReadiness.mockReturnValue({ readyToSend: true, testMode: true });

    render(await ApplicationStatusPage());

    expect(screen.getByRole("heading", { name: "Your agreement is ready to review" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Submitted details" })).toBeInTheDocument();
    expect(screen.getByText("@dylan.grows")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Review agreement" })).toHaveAttribute(
      "href",
      "/onboarding/agreement",
    );
    const progress = screen.getByRole("list", { name: "Creator onboarding progress" });
    const steps = within(progress).getAllByRole("listitem");
    for (const step of steps.slice(0, 3)) expect(step).toHaveAttribute("data-state", "complete");
    expect(steps[3]).toHaveAttribute("aria-current", "step");
    expect(steps[3]).toHaveTextContent("AgreementReady to review");
  });

  it("shows saved status without redirecting or inventing an action during a state outage", async () => {
    mocks.accountState.mockRejectedValue(new Error("database unavailable"));

    render(await ApplicationStatusPage());

    expect(screen.getByRole("heading", { name: "We couldn’t load your next step" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(/review state is temporarily unavailable/i);
    expect(screen.getByRole("heading", { name: "Submitted details" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Try again" })).toHaveAttribute("href", "/account");
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("shows a staff change request and gives the creator a revision path", async () => {
    mocks.accountState.mockResolvedValue({
      nextPath: "/application/status",
      profileState: "application_pending",
      applicationState: "changes_requested",
      agreementState: null,
    });
    mocks.application.mockResolvedValue({
      ...application,
      status: "changes_requested",
      decisionMessage: "Replace the old Instagram handle before we continue.",
    });

    render(await ApplicationStatusPage());

    expect(screen.getByRole("heading", { name: "We need one update" })).toBeInTheDocument();
    expect(screen.getByText("Replace the old Instagram handle before we continue.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Make requested changes" })).toHaveAttribute("href", "/apply");
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

    expect(screen.getByRole("heading", { name: "You’re in" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open creator workspace" })).toHaveAttribute(
      "href",
      "/account#creator-command-center-title",
    );
    const progress = screen.getByRole("list", { name: "Creator onboarding progress" });
    for (const step of within(progress).getAllByRole("listitem")) {
      expect(step).toHaveAttribute("data-state", "complete");
    }
  });
});
