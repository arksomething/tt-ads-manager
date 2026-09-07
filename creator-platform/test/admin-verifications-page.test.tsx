import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import VerificationAdminPage from "@/app/admin/verifications/page";

const mocks = vi.hoisted(() => ({
  account: vi.fn(),
  staff: vi.fn(),
  queue: vi.fn(),
  redirect: vi.fn((path: string) => { throw new Error(`redirect:${path}`); }),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={String(href)} {...props}>{children}</a>
  ),
}));
vi.mock("@/lib/server-env", () => ({ hasSupabaseAuthEnv: () => true }));
vi.mock("@/server/auth/session", () => ({ getCurrentAccount: mocks.account }));
vi.mock("@/server/admin/discord", () => ({
  getCurrentDiscordStaffMembership: mocks.staff,
}));
vi.mock("@/server/accounts/platform-verification", () => ({
  getCreatorPlatformVerificationQueue: mocks.queue,
}));

describe("admin campaign-account verification page", () => {
  beforeEach(() => {
    mocks.account.mockReset();
    mocks.staff.mockReset();
    mocks.queue.mockReset();
    mocks.redirect.mockClear();
    mocks.account.mockResolvedValue({ id: "staff-1", email: "admin@example.com" });
    mocks.staff.mockResolvedValue({ role: "admin" });
    mocks.queue.mockResolvedValue([]);
  });

  it("preserves the valid empty queue state", async () => {
    render(await VerificationAdminPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByRole("heading", { name: "Campaign-account verification" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "No campaign accounts are waiting." })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("does not present a failed queue request as an empty queue", async () => {
    mocks.queue.mockRejectedValue(new Error("database unavailable"));

    render(await VerificationAdminPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByRole("alert")).toHaveTextContent("Verification queue is unavailable");
    expect(screen.queryByRole("heading", { name: "No campaign accounts are waiting." })).not.toBeInTheDocument();
  });

  it("fails closed when staff membership cannot be checked", async () => {
    mocks.staff.mockRejectedValue(new Error("database unavailable"));

    render(await VerificationAdminPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByRole("alert")).toHaveTextContent("staff access check could not be loaded");
    expect(mocks.queue).not.toHaveBeenCalled();
  });
});
