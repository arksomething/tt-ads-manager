import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import CreatorAssetsPage from "@/app/account/assets/page";
import CreatorScriptsPage from "@/app/account/scripts/page";
import AdminScriptsPage from "@/app/admin/scripts/page";

const mocks = vi.hoisted(() => ({
  authEnv: vi.fn(() => true),
  account: vi.fn(),
  staff: vi.fn(),
  adminOverview: vi.fn(),
  creatorLibrary: vi.fn(),
  redirect: vi.fn((path: string) => { throw new Error(`redirect:${path}`); }),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a href={String(href)} {...props}>{children}</a>,
}));
vi.mock("@/lib/server-env", () => ({ hasSupabaseAuthEnv: mocks.authEnv }));
vi.mock("@/server/auth/session", () => ({ getCurrentAccount: mocks.account }));
vi.mock("@/server/admin/discord", () => ({ getCurrentDiscordStaffMembership: mocks.staff }));
vi.mock("@/server/content/library", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/server/content/library")>(),
  getContentAdminOverview: mocks.adminOverview,
  getOwnCreatorContentLibrary: mocks.creatorLibrary,
}));

describe("creator content pages", () => {
  beforeEach(() => {
    mocks.account.mockResolvedValue({ id: "account-1", email: "creator@example.com" });
    mocks.staff.mockResolvedValue({ role: "reviewer" });
    mocks.adminOverview.mockResolvedValue({ scripts: [], assets: [], creators: [] });
    mocks.creatorLibrary.mockResolvedValue({ scripts: [], assets: [] });
    mocks.redirect.mockClear();
  });

  it("protects the staff script library", async () => {
    mocks.staff.mockResolvedValue(null);
    await expect(AdminScriptsPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("redirect:/account");
    expect(mocks.adminOverview).not.toHaveBeenCalled();
  });

  it("renders operational staff script controls", async () => {
    mocks.adminOverview.mockResolvedValue({
      creators: [{ enrollmentId: "enroll-1", name: "Ari", email: "ari@example.com", status: "active" }],
      assets: [],
      scripts: [{ id: "script-1", title: "Opening hook", summary: "Intro", bodyMarkdown: "Start strong", status: "published", revision: 1, publishedAt: null, updatedAt: "", assignments: [] }],
    });
    render(await AdminScriptsPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByRole("heading", { name: "Script library" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Opening hook" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Assign" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Archive" })).toBeInTheDocument();
  });

  it("does not present a failed staff overview as an empty library", async () => {
    mocks.adminOverview.mockRejectedValue(new Error("invalid provider payload"));

    render(await AdminScriptsPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByRole("alert")).toHaveTextContent("Script data is unavailable");
    expect(screen.queryByRole("heading", { name: "No scripts yet" })).not.toBeInTheDocument();
  });

  it("renders honest creator empty states", async () => {
    render(await CreatorScriptsPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByRole("heading", { name: "No scripts assigned yet" })).toBeInTheDocument();
    render(await CreatorAssetsPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByRole("heading", { name: "No assets assigned yet" })).toBeInTheDocument();
  });

  it("does not report an empty library when its data load failed", async () => {
    mocks.creatorLibrary.mockRejectedValue(new Error("unavailable"));
    render(await CreatorScriptsPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByRole("alert")).toHaveTextContent("No assignment claim is being made");
  });
});
