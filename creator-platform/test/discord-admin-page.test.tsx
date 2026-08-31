import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import DiscordAdminPage from "@/app/admin/discord/page";
import type { DiscordOperationsOverview } from "@/server/admin/discord";

const mocks = vi.hoisted(() => ({
  authEnv: vi.fn(() => true),
  account: vi.fn(),
  staff: vi.fn(),
  configuration: vi.fn(),
  overview: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`);
  }),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={String(href)} {...props}>{children}</a>
  ),
}));

vi.mock("@/lib/server-env", () => ({ hasSupabaseAuthEnv: mocks.authEnv }));
vi.mock("@/server/auth/session", () => ({ getCurrentAccount: mocks.account }));
vi.mock("@/server/admin/discord", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/server/admin/discord")>();
  return {
    ...original,
    getCurrentDiscordStaffMembership: mocks.staff,
    getDiscordOperationsConfiguration: mocks.configuration,
    getDiscordOperationsOverview: mocks.overview,
  };
});

function overview(): DiscordOperationsOverview {
  return {
    queue: {
      scheduled: 3,
      leased: 1,
      sending: 0,
      retry: 2,
      blocked: 4,
      deliveryUnknown: 1,
      sent: 31,
      cancelled: 2,
      dead: 1,
      actionable: 7,
      oldestActionableAt: "2026-08-31T11:30:00.000Z",
      oldestAgeSeconds: 1_800,
    },
    connections: {
      linked: 22,
      members: 19,
      dmBlocked: 2,
      dmChannelPending: 6,
    },
    roleSync: {
      scheduled: 2,
      leased: 1,
      retry: 1,
      completed: 18,
      cancelled: 0,
      dead: 1,
      queued: 4,
      failures: 1,
    },
    worker: {
      state: "healthy",
      version: "1.0.0",
      status: "healthy",
      queueDepth: 7,
      lastSeenAt: "2026-08-31T11:59:30.000Z",
      ageSeconds: 30,
    },
    recentFailures: [{
      attemptNumber: 2,
      deliveryState: "blocked",
      outcome: "blocked",
      errorCode: "dm_blocked",
      providerStatus: 403,
      attemptedAt: "2026-08-31T11:58:00.000Z",
    }],
  };
}

describe("Discord staff operations page", () => {
  beforeEach(() => {
    mocks.authEnv.mockReturnValue(true);
    mocks.account.mockReset();
    mocks.staff.mockReset();
    mocks.configuration.mockReset();
    mocks.overview.mockReset();
    mocks.redirect.mockClear();
    mocks.account.mockResolvedValue({ id: "staff-user", email: "reviewer@example.com" });
    mocks.staff.mockResolvedValue({ role: "reviewer" });
    mocks.configuration.mockReturnValue({ oauthConfigured: true, callbackConfigured: true });
    mocks.overview.mockResolvedValue(overview());
  });

  it("redirects unsigned users to sign in with the exact return path", async () => {
    mocks.account.mockResolvedValue(null);

    await expect(DiscordAdminPage()).rejects.toThrow(
      "redirect:/auth/sign-in?next=%2Fadmin%2Fdiscord",
    );
    expect(mocks.staff).not.toHaveBeenCalled();
  });

  it("redirects authenticated nonstaff accounts without loading operations data", async () => {
    mocks.staff.mockResolvedValue(null);

    await expect(DiscordAdminPage()).rejects.toThrow("redirect:/account");
    expect(mocks.overview).not.toHaveBeenCalled();
  });

  it("renders a read-only operational view for a live reviewer membership", async () => {
    render(await DiscordAdminPage());

    expect(screen.getByRole("heading", { name: "Identity, reminders, and worker health." })).toBeInTheDocument();
    expect(screen.getByText("Reviewer access")).toBeInTheDocument();
    expect(screen.getByText("Worker heartbeat is fresh")).toBeInTheDocument();
    expect(screen.getByText("Oldest actionable 30 min ago")).toBeInTheDocument();
    expect(screen.getByText("dm_blocked")).toBeInTheDocument();
    expect(screen.getByText("DM blocked").nextSibling).toHaveTextContent("2");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("shows honest unavailable state after staff access passes", async () => {
    mocks.overview.mockRejectedValue(new Error("snapshot unavailable"));

    render(await DiscordAdminPage());

    expect(screen.getByRole("alert")).toHaveTextContent("Operations data is unavailable");
    expect(screen.getByRole("alert")).toHaveTextContent("No queue, worker, connection, or delivery-health claim is being made");
    expect(screen.queryByText("0", { selector: "dd" })).not.toBeInTheDocument();
  });
});
