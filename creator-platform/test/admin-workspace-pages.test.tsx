import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import AdminCreatorProfilePage from "@/app/admin/creators/[accountId]/page";
import AdminCreatorsPage from "@/app/admin/creators/page";
import AdminHomePage from "@/app/admin/page";

const accountId = "11111111-1111-4111-8111-111111111111";

const mocks = vi.hoisted(() => ({
  requireStaff: vi.fn(),
  workspace: vi.fn(),
  profile: vi.fn(),
  notFound: vi.fn(() => { throw new Error("not-found"); }),
}));

vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={String(href)} {...props}>{children}</a>
  ),
}));
vi.mock("@/server/admin/access", () => ({ requireCreatorStaff: mocks.requireStaff }));
vi.mock("@/server/admin/workspace", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/server/admin/workspace")>(),
  getAdminWorkspace: mocks.workspace,
  getAdminCreatorProfile: mocks.profile,
}));

const workspace = {
  range: { start: "2026-08-25", end: "2026-08-31" },
  summary: {
    creatorCount: 1,
    activeCreatorCount: 1,
    applicationAttentionCount: 1,
    verifiedPlatformAccountCount: 1,
    publishedPostCount: 1,
    contentAttentionCount: 1,
    observedPostCount: 1,
    knownDeltaPostCount: 0,
    viewsGained: null,
    discordConnectedCount: 1,
  },
  earnings: [{ currency: "USD", currencyExponent: 2, state: "estimated", amountMinor: "1250", count: 1 }],
  settlements: [],
  dailyActivity: [{ date: "2026-08-31", posts: 1, submissions: 1, observedPosts: 1 }],
  creators: [{
    accountId,
    name: "Dylan Smith",
    email: "dylan@example.com",
    lifecycleStatus: "active",
    applicationId: "22222222-2222-4222-8222-222222222222",
    applicationStatus: "approved",
    enrollmentStatus: "active",
    joinedAt: "2026-08-01T12:00:00Z",
    approvedAt: "2026-08-02T12:00:00Z",
    platforms: [{ platform: "TIKTOK", handle: "dylan.grows", status: "verified" }],
    postCount: 1,
    openSubmissionCount: 1,
    lastPostAt: "2026-08-31T12:00:00Z",
    lastActivityAt: "2026-08-31T12:00:00Z",
  }],
};

const profile = {
  account: { id: accountId, email: "dylan@example.com", lifecycleStatus: "active", createdAt: "2026-08-01T12:00:00Z" },
  application: { id: "22222222-2222-4222-8222-222222222222", name: "Dylan Smith", status: "approved", discordUsername: "dylan", phoneNumber: "+15555550123" },
  enrollment: { status: "active", approvedAt: "2026-08-02T12:00:00Z", activatedAt: "2026-08-03T12:00:00Z" },
  agreement: { status: "completed", provider: "signwell", completedAt: "2026-08-03T12:00:00Z" },
  platformClaims: [{ id: "claim-1", platform: "TIKTOK", handle: "dylan.grows", status: "verified", verifiedAt: "2026-08-03T12:00:00Z" }],
  posts: [{ id: "post-1", platform: "TIKTOK", nativePostId: "native-1", url: "https://www.tiktok.com/@dylan/video/1", publishedAt: "2026-08-31T12:00:00Z", attributionState: "matched", latestObservation: null }],
  submissions: [],
  earnings: [{ id: "earning-1", category: "base_views", currency: "USD", currencyExponent: 2, amountMinor: "1250", state: "estimated", earnedAt: "2026-08-31T12:00:00Z", postId: "post-1" }],
  settlements: [],
  scripts: [],
};

describe("creator admin workspace pages", () => {
  beforeEach(() => {
    mocks.requireStaff.mockReset();
    mocks.workspace.mockReset();
    mocks.profile.mockReset();
    mocks.notFound.mockClear();
    mocks.requireStaff.mockResolvedValue({ account: { id: "staff-1" }, staff: { role: "reviewer" } });
    mocks.workspace.mockResolvedValue(workspace);
    mocks.profile.mockResolvedValue(profile);
  });

  it("keeps uncovered view deltas explicitly unknown and separates earnings state", async () => {
    render(await AdminHomePage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByRole("heading", { name: "Program health" })).toBeInTheDocument();
    expect(screen.getByText("Unknown")).toBeInTheDocument();
    expect(screen.getByText(/0 of 1 observed posts have both range boundaries/i)).toBeInTheDocument();
    expect(screen.getByText("Estimated · 1 record")).toBeInTheDocument();
    expect(screen.getByText("USD 12.50")).toBeInTheDocument();
    expect(screen.getByTitle("1 posts, 1 submissions, 1 observed posts").querySelector("span"))
      .toHaveTextContent("3");
  });

  it("formats a known view delta without changing its evidence boundary", async () => {
    mocks.workspace.mockResolvedValue({
      ...workspace,
      summary: { ...workspace.summary, knownDeltaPostCount: 1, viewsGained: "12345" },
    });
    render(await AdminHomePage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByText("12,345")).toBeInTheDocument();
    expect(screen.getByText(/1 of 1 observed posts have both range boundaries/i)).toBeInTheDocument();
  });

  it("passes a valid user-selected date range to the reporting projection", async () => {
    render(await AdminHomePage({
      searchParams: Promise.resolve({ start: "2026-08-01", end: "2026-08-31" }),
    }));
    expect(mocks.workspace).toHaveBeenCalledWith("2026-08-01", "2026-08-31");
  });

  it("filters the real creator directory without inventing another account total", async () => {
    render(await AdminCreatorsPage({ searchParams: Promise.resolve({ q: "dylan.grows" }) }));

    expect(screen.getByRole("heading", { name: "Creators" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Dylan Smith" })).toHaveAttribute("href", `/admin/creators/${accountId}`);
    expect(screen.getByText("1 matching 1 total accounts")).toBeInTheDocument();
  });

  it("renders missing post observations as unknown rather than zero", async () => {
    render(await AdminCreatorProfilePage({ params: Promise.resolve({ accountId }) }));

    expect(screen.getByRole("heading", { name: "Dylan Smith" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Attributed posts and latest observations" })).toBeInTheDocument();
    expect(screen.getAllByText("Unknown")).toHaveLength(4);
    expect(screen.getByText("Estimated")).toBeInTheDocument();
    expect(screen.getByText("USD 12.50")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "No settlements recorded" })).toBeInTheDocument();
  });
});
