import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import DiscordAccountPage from "@/app/account/discord/page";
import AccountPage from "@/app/account/page";
import type { CreatorDiscordOverview } from "@/server/accounts/discord";

const mocks = vi.hoisted(() => ({
  authEnv: vi.fn(() => true),
  account: vi.fn(),
  accountState: vi.fn(),
  application: vi.fn(),
  overview: vi.fn(),
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
  hasSupabaseAuthEnv: mocks.authEnv,
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

vi.mock("@/server/accounts/discord", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/server/accounts/discord")>();
  return {
    ...original,
    getCreatorDiscordOverview: mocks.overview,
  };
});

vi.mock("@/server/admin/discord", () => ({
  getCurrentDiscordStaffMembership: mocks.staff,
}));

const application = {
  id: "application-1",
  name: "Dylan Smith",
  phoneNumber: "+15555550123",
  discordUsername: "typed.application.name",
  status: "approved",
  submittedAt: "2026-08-30T16:30:00.000Z",
  reviewedAt: null,
  accounts: [],
};

function overview(
  state: CreatorDiscordOverview["connection"]["state"] = "unlinked",
): CreatorDiscordOverview {
  const hasIdentity = state !== "unlinked" && state !== "unavailable";
  return {
    connection: {
      state,
      discordUserId: hasIdentity ? "571179674323910667" : null,
      username: hasIdentity ? "verified.creator" : null,
      displayName: hasIdentity ? "Verified Creator" : null,
      guildMember: state === "connected" ? true : state === "linked_not_member" ? false : null,
      verifiedAt: hasIdentity ? "2026-08-31T15:00:00.000Z" : null,
      disconnectedAt: state === "disconnected" ? "2026-08-31T16:00:00.000Z" : null,
    },
    preferences: {
      dmOptIn: false,
      timezone: "America/New_York",
      quietHoursStart: "21:00",
      quietHoursEnd: "09:00",
      topics: {
        account: true,
        onboarding: true,
        posting: false,
        performance: false,
        payments: true,
      },
    },
    reminders: [],
    connectionAvailable: state !== "unavailable",
    preferencesAvailable: true,
    historyAvailable: true,
  };
}

describe("creator Discord settings page", () => {
  beforeEach(() => {
    mocks.authEnv.mockReturnValue(true);
    mocks.account.mockReset();
    mocks.accountState.mockReset();
    mocks.application.mockReset();
    mocks.overview.mockReset();
    mocks.staff.mockReset();
    mocks.redirect.mockClear();
    mocks.account.mockResolvedValue({ id: "creator-1", email: "dylan@example.com" });
    mocks.accountState.mockResolvedValue({
      nextPath: "/account",
      profileState: "active",
      applicationState: "approved",
      agreementState: "completed",
    });
    mocks.application.mockResolvedValue(application);
    mocks.overview.mockResolvedValue(overview());
    mocks.staff.mockResolvedValue(null);
  });

  it("protects the settings route with the exact return path", async () => {
    mocks.account.mockResolvedValue(null);

    await expect(
      DiscordAccountPage({ searchParams: Promise.resolve({}) }),
    ).rejects.toThrow("redirect:/auth/sign-in?next=%2Faccount%2Fdiscord");
  });

  it("shows an unlinked state and the production OAuth start action", async () => {
    render(await DiscordAccountPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByRole("heading", { name: "Connect your Discord account" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Connect Discord" })).toHaveAttribute(
      "href",
      "/api/integrations/discord/start?returnTo=%2Faccount%2Fdiscord",
    );
    expect(screen.getByRole("heading", { name: "typed.application.name" })).toBeInTheDocument();
    expect(screen.getByText(/not a verified Discord identity/i)).toBeInTheDocument();
  });

  it.each([
    ["linked_not_member", "Discord is linked, but not in GoTall Creators", "Not a member"],
    ["connected", "Discord is verified", "Member at last check"],
    ["needs_attention", "Discord needs to be reconnected", "Not verified"],
    ["disconnected", "Discord is disconnected", "Not verified"],
  ] as const)("renders the %s connection state without replacing the application entry", async (state, heading, membership) => {
    mocks.overview.mockResolvedValue(overview(state));

    render(await DiscordAccountPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByRole("heading", { name: heading })).toBeInTheDocument();
    expect(screen.getByText("Verified Creator")).toBeInTheDocument();
    expect(screen.getByText("@verified.creator")).toBeInTheDocument();
    expect(screen.getByText(membership, { selector: "dd" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "typed.application.name" })).toBeInTheDocument();
  });

  it("fails closed when the real integration state cannot be loaded", async () => {
    mocks.overview.mockRejectedValue(new Error("database unavailable"));

    render(await DiscordAccountPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByRole("heading", { name: "Discord status is temporarily unavailable" })).toBeInTheDocument();
    expect(screen.getByText(/No connection claim is being made/i)).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(/preferences are temporarily unavailable/i);
    expect(screen.queryByRole("link", { name: /connect discord/i })).not.toBeInTheDocument();
  });

  it("defaults Discord DMs off, applies quiet hours, and disables gated topics", async () => {
    render(await DiscordAccountPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByRole("checkbox", { name: /Allow Discord direct messages/i })).not.toBeChecked();
    expect(screen.getByLabelText("Quiet hours start")).toHaveValue("21:00");
    expect(screen.getByLabelText("Quiet hours end")).toHaveValue("09:00");
    expect(screen.getByRole("checkbox", { name: /^Posting/i })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: /^Performance/i })).toBeDisabled();
    expect(screen.getByText(/tracking is authoritative/i)).toBeInTheDocument();
    expect(screen.getByText(/tracking and deal attribution gates are authoritative/i)).toBeInTheDocument();
  });

  it("uses honest delivery labels and never presents Discord acceptance as a read receipt", async () => {
    const connected = overview("connected");
    connected.preferences.dmOptIn = true;
    connected.reminders = [
      {
        id: "notification-1",
        topic: "onboarding",
        state: "sent",
        label: "Agreement ready",
        occurredAt: "2026-08-31T15:00:00.000Z",
      },
      {
        id: "notification-2",
        topic: "payments",
        state: "retry",
        label: "Payment update",
        occurredAt: "2026-08-31T14:00:00.000Z",
      },
      {
        id: "notification-3",
        topic: "account",
        state: "scheduled",
        label: "Account update",
        occurredAt: "2026-08-31T13:00:00.000Z",
      },
      {
        id: "notification-4",
        topic: "account",
        state: "blocked",
        label: "Blocked update",
        occurredAt: "2026-08-31T12:00:00.000Z",
      },
      {
        id: "notification-5",
        topic: "onboarding",
        state: "cancelled",
        label: "Cancelled update",
        occurredAt: "2026-08-31T11:00:00.000Z",
      },
      {
        id: "notification-6",
        topic: "payments",
        state: "dead",
        label: "Failed update",
        occurredAt: "2026-08-31T10:00:00.000Z",
      },
    ];
    mocks.overview.mockResolvedValue(connected);

    render(await DiscordAccountPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByText("Accepted by Discord")).toBeInTheDocument();
    expect(screen.getByText("Retry scheduled")).toBeInTheDocument();
    expect(screen.getByText("Scheduled")).toBeInTheDocument();
    expect(screen.getByText("Blocked")).toBeInTheDocument();
    expect(screen.getByText("Cancelled")).toBeInTheDocument();
    expect(screen.getByText("Delivery failed")).toBeInTheDocument();
    expect(screen.getByText(/does not mean the message was opened or read/i)).toBeInTheDocument();
    expect(screen.queryByText(/^Read$/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send test" })).toBeEnabled();
  });

  it("disables the test action when account reminders are not enabled", async () => {
    const connected = overview("connected");
    connected.preferences.dmOptIn = true;
    connected.preferences.topics.account = false;
    mocks.overview.mockResolvedValue(connected);

    render(await DiscordAccountPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByRole("button", { name: "Send test" })).toBeDisabled();
  });

  it("adds a Discord integration destination to the real account page", async () => {
    render(await AccountPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByRole("link", { name: "Manage Discord" })).toHaveAttribute(
      "href",
      "/account/discord",
    );
  });

  it("gives staff a discoverable Discord operations destination", async () => {
    mocks.staff.mockResolvedValue({ role: "reviewer" });

    render(await AccountPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByRole("link", { name: "Open operations" })).toHaveAttribute(
      "href",
      "/admin/discord",
    );
  });
});
