import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import AdminContentPage from "@/app/admin/content/page";
import AdminFinancePage from "@/app/admin/finance/page";

const mocks = vi.hoisted(() => ({
  requireStaff: vi.fn(),
  content: vi.fn(),
  finance: vi.fn(),
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={String(href)} {...props}>{children}</a>
  ),
}));
vi.mock("@/server/admin/access", () => ({ requireCreatorStaff: mocks.requireStaff }));
vi.mock("@/server/admin/content-finance", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/server/admin/content-finance")>(),
  getAdminContentQueue: mocks.content,
  getAdminFinanceLedger: mocks.finance,
}));

const accountId = "22222222-2222-4222-8222-222222222222";
const enrollmentId = "33333333-3333-4333-8333-333333333333";
const earningId = "44444444-4444-4444-8444-444444444444";

describe("admin content and finance pages", () => {
  beforeEach(() => {
    mocks.requireStaff.mockReset();
    mocks.content.mockReset();
    mocks.finance.mockReset();
    mocks.requireStaff.mockResolvedValue({
      account: { id: "admin-1", email: "admin@example.com" },
      staff: { role: "admin" },
    });
    mocks.content.mockResolvedValue([]);
    mocks.finance.mockResolvedValue({ entries: [], settlements: [] });
  });

  it("renders a real review and canonical attribution surface", async () => {
    mocks.content.mockResolvedValue([{
      id: "11111111-1111-4111-8111-111111111111",
      accountId,
      platform: "TIKTOK",
      url: "https://www.tiktok.com/@creator/video/123",
      declaredNativePostId: "123",
      matchState: "submitted",
      matchedPostId: null,
      submittedAt: "2026-08-31T12:00:00Z",
    }]);

    render(await AdminContentPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByRole("heading", { name: "Content review" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Open post/i })).toHaveAttribute(
      "href",
      "https://www.tiktok.com/@creator/video/123",
    );
    expect(screen.getByRole("button", { name: "Save review state" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm attribution" })).toBeInTheDocument();
    expect(screen.getByText(/does not invent metrics, earnings, or provider observations/i)).toBeInTheDocument();
  });

  it("does not convert a failed queue load into an empty-queue claim", async () => {
    mocks.content.mockRejectedValue(new Error("database unavailable"));
    render(await AdminContentPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByRole("alert")).toHaveTextContent(/queue is unavailable/i);
    expect(screen.queryByRole("heading", { name: "No open submissions" })).not.toBeInTheDocument();
  });

  it("renders exact ledger states and keeps payout execution unavailable", async () => {
    mocks.finance.mockResolvedValue({
      entries: [{
        id: earningId,
        accountId,
        enrollmentId,
        postId: null,
        sourceKey: "campaign:creator:week-1",
        category: "base_views",
        currency: "USD",
        currencyExponent: 2,
        amountMinor: "12500",
        state: "approved",
        periodStart: null,
        periodEnd: null,
        earnedAt: "2026-08-31T12:00:00Z",
        approvedAt: "2026-08-31T13:00:00Z",
        paidAt: null,
        reconciledAt: null,
        externalReference: null,
        settlementId: null,
      }],
      settlements: [],
    });

    render(await AdminFinancePage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByRole("heading", { name: "Finance ledger" })).toBeInTheDocument();
    expect(screen.getByText("Payout execution is not configured")).toBeInTheDocument();
    expect(screen.getAllByText("USD 125.00").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Record pending settlement" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /send payout/i })).not.toBeInTheDocument();
  });

  it("does not load ledger data for reviewers", async () => {
    mocks.requireStaff.mockResolvedValue({
      account: { id: "reviewer-1", email: "reviewer@example.com" },
      staff: { role: "reviewer" },
    });
    render(await AdminFinancePage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByRole("alert")).toHaveTextContent(/administrator access is required/i);
    expect(mocks.finance).not.toHaveBeenCalled();
  });
});
