import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import CreatorContentPage from "@/app/account/content/page";
import CreatorEarningsPage from "@/app/account/earnings/page";

const mocks = vi.hoisted(() => ({
  account: vi.fn(),
  content: vi.fn(),
  earnings: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`);
  }),
  refresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
  useRouter: () => ({ refresh: mocks.refresh }),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={String(href)} {...props}>{children}</a>
  ),
}));
vi.mock("@/lib/server-env", () => ({ hasSupabaseAuthEnv: () => true }));
vi.mock("@/server/auth/session", () => ({ getCurrentAccount: mocks.account }));
vi.mock("@/server/accounts/content", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/server/accounts/content")>(),
  getOwnContentWorkspace: mocks.content,
}));
vi.mock("@/server/accounts/earnings", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/server/accounts/earnings")>(),
  getOwnEarningsWorkspace: mocks.earnings,
}));

describe("creator content and earnings pages", () => {
  beforeEach(() => {
    mocks.account.mockReset();
    mocks.content.mockReset();
    mocks.earnings.mockReset();
    mocks.redirect.mockClear();
    mocks.account.mockResolvedValue({ id: "creator-1", email: "creator@example.com" });
  });

  it("renders an honest empty content state and the active-enrollment gate", async () => {
    mocks.content.mockResolvedValue({
      canSubmit: false,
      platformAccounts: [],
      submissions: [],
      posts: [],
    });
    render(await CreatorContentPage());

    expect(screen.getByRole("heading", { name: "Your content" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "No posts submitted yet" })).toBeInTheDocument();
    expect(screen.getByText(/does not mean you have no views/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Submit published post" })).toBeDisabled();
  });

  it("fails closed instead of rendering an empty content workspace during an outage", async () => {
    mocks.content.mockRejectedValue(new Error("database unavailable"));
    render(await CreatorContentPage());
    expect(screen.getByRole("alert")).toHaveTextContent(/temporarily unavailable/i);
    expect(screen.queryByText("No posts matched yet")).not.toBeInTheDocument();
  });

  it("labels no earnings as unknown rather than showing a zero balance", async () => {
    mocks.earnings.mockResolvedValue({ entries: [], settlements: [] });
    render(await CreatorEarningsPage());
    expect(screen.getByRole("heading", { name: "No earnings have been posted yet" })).toBeInTheDocument();
    expect(screen.getByText(/unknown balance, not a zero balance/i)).toBeInTheDocument();
    expect(screen.queryByText(/\$0(?:\.00)?/u)).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "No settlement records yet" })).toBeInTheDocument();
  });

  it("keeps estimated and paid entries visibly separate", async () => {
    mocks.earnings.mockResolvedValue({
      entries: [
        {
          id: "earning-1",
          postId: "post-1",
          category: "base_views",
          currency: "USD",
          currencyExponent: 2,
          amountMinor: "12345",
          state: "estimated",
          periodStart: null,
          periodEnd: null,
          earnedAt: "2026-08-31T12:00:00Z",
          approvedAt: null,
          paidAt: null,
          reconciledAt: null,
        },
        {
          id: "earning-2",
          postId: null,
          category: "bonus",
          currency: "USD",
          currencyExponent: 2,
          amountMinor: "5000",
          state: "paid",
          periodStart: null,
          periodEnd: null,
          earnedAt: "2026-08-30T12:00:00Z",
          approvedAt: "2026-08-30T13:00:00Z",
          paidAt: "2026-08-31T12:00:00Z",
          reconciledAt: null,
        },
      ],
      settlements: [],
    });
    render(await CreatorEarningsPage());
    expect(screen.getAllByText("USD 123.45").length).toBeGreaterThan(0);
    expect(screen.getAllByText("USD 50.00").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Estimated").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Paid").length).toBeGreaterThan(0);
  });
});
