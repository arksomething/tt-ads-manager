import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import AdminApplicationDetailPage from "@/app/admin/applications/[applicationId]/page";
import AdminApplicationsPage from "@/app/admin/applications/page";

const applicationId = "11111111-1111-4111-8111-111111111111";
const mocks = vi.hoisted(() => ({
  account: vi.fn(),
  staff: vi.fn(),
  queue: vi.fn(),
  detail: vi.fn(),
  deals: vi.fn(),
  redirect: vi.fn((path: string) => { throw new Error(`redirect:${path}`); }),
  notFound: vi.fn(() => { throw new Error("not-found"); }),
  refresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
  notFound: mocks.notFound,
  useRouter: () => ({ refresh: mocks.refresh }),
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={String(href)} {...props}>{children}</a>
  ),
}));

vi.mock("@/lib/server-env", () => ({ hasSupabaseAuthEnv: () => true }));
vi.mock("@/server/auth/session", () => ({ getCurrentAccount: mocks.account }));
vi.mock("@/server/admin/applications", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/server/admin/applications")>();
  return {
    ...original,
    getCurrentApplicationStaffMembership: mocks.staff,
    getStaffApplicationQueue: mocks.queue,
    getStaffApplicationDetail: mocks.detail,
  };
});
vi.mock("@/server/admin/deals", () => ({ getAdminDealCatalog: mocks.deals }));

const dealSnapshotHash = "a".repeat(64);
const activeDefaultDeal = {
  id: "44444444-4444-4444-8444-444444444444",
  dealKey: "standard-creator",
  version: 2,
  label: "Standard creator agreement",
  status: "active" as const,
  isDefault: true,
  draftRevision: 4,
  termsHash: "b".repeat(64),
  economicsHash: "c".repeat(64),
  snapshotHash: dealSnapshotHash,
  providerTemplateHash: "d".repeat(64),
  assignmentCount: 0,
  providerBindingCount: 1,
  approvalCount: 2,
  businessApprovalCount: 1,
  legalApprovalCount: 1,
  readinessBlockerCount: 0,
  activationReady: true,
  readinessBlockers: [],
  createdAt: "2026-09-01T12:00:00.000Z",
  updatedAt: "2026-09-02T12:00:00.000Z",
  effectiveAt: "2026-09-02T12:00:00.000Z",
  sealedAt: "2026-09-02T11:00:00.000Z",
};

const queueItem = {
  id: applicationId,
  name: "Dylan Smith",
  email: "dylan@example.com",
  discordUsername: "dylan",
  status: "submitted" as const,
  lifecycleStatus: "application_pending",
  submittedAt: "2026-08-31T12:00:00.000Z",
  reviewedAt: null,
  reviewRevision: 0,
  handleCount: 2,
  platforms: ["TIKTOK", "INSTAGRAM_REELS"] as const,
};

const detail = {
  ...queueItem,
  accountId: "22222222-2222-4222-8222-222222222222",
  phoneNumber: "+15555550123",
  decisionMessage: null,
  staffNote: null,
  handles: [{
    id: "33333333-3333-4333-8333-333333333333",
    platform: "TIKTOK" as const,
    handle: "@dylan.grows",
    normalizedHandle: "dylan.grows",
  }],
  enrollment: null,
  agreement: null,
  auditEvents: [{
    id: 1,
    type: "submitted",
    actorUserId: "22222222-2222-4222-8222-222222222222",
    createdAt: "2026-08-31T12:00:00.000Z",
    fromStatus: null,
    toStatus: null,
    applicantMessage: null,
    staffNote: null,
    reviewRevision: 0,
  }],
};

describe("admin application review pages", () => {
  beforeEach(() => {
    mocks.account.mockReset();
    mocks.staff.mockReset();
    mocks.queue.mockReset();
    mocks.detail.mockReset();
    mocks.deals.mockReset();
    mocks.redirect.mockClear();
    mocks.notFound.mockClear();
    mocks.refresh.mockClear();
    mocks.account.mockResolvedValue({ id: "staff-1", email: "reviewer@example.com" });
    mocks.staff.mockResolvedValue({ role: "reviewer" });
    mocks.queue.mockResolvedValue([queueItem]);
    mocks.detail.mockResolvedValue(detail);
    mocks.deals.mockResolvedValue({ defaultVersion: null, versions: [] });
  });

  it("keeps the queue behind live staff membership", async () => {
    mocks.staff.mockResolvedValue(null);

    await expect(AdminApplicationsPage({ searchParams: Promise.resolve({}) }))
      .rejects.toThrow("redirect:/account");
    expect(mocks.queue).not.toHaveBeenCalled();
  });

  it("renders real queue fields and status filtering", async () => {
    render(await AdminApplicationsPage({
      searchParams: Promise.resolve({ status: "submitted" }),
    }));

    expect(screen.getByRole("heading", { name: "Application review" })).toBeInTheDocument();
    expect(screen.getByText("Dylan Smith")).toBeInTheDocument();
    expect(screen.getByText("dylan@example.com")).toBeInTheDocument();
    expect(screen.getByText("2 submitted")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Dylan Smith/i })).toHaveAttribute(
      "href",
      `/admin/applications/${applicationId}`,
    );
    expect(mocks.queue).toHaveBeenCalledWith("submitted");
  });

  it("does not present a failed queue read as an empty application view", async () => {
    mocks.queue.mockRejectedValue(new Error("invalid provider payload"));

    render(await AdminApplicationsPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByRole("alert")).toHaveTextContent("application queue is unavailable");
    expect(screen.queryByText("No applications in this view")).not.toBeInTheDocument();
  });

  it("renders detail, audit history, and a working review mutation form", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ status: "in_review" }),
    } as Response);

    render(await AdminApplicationDetailPage({
      params: Promise.resolve({ applicationId }),
    }));

    expect(screen.getByRole("heading", { name: "Dylan Smith" })).toBeInTheDocument();
    expect(screen.getByText("@dylan.grows")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Audit history" })).toBeInTheDocument();
    expect(screen.getByText("Submitted", { selector: "strong" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Begin review" }));

    expect(fetchSpy).toHaveBeenCalledWith(
      `/api/admin/applications/${applicationId}/review`,
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"action":"start_review"'),
      }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent("now in review");
    expect(mocks.refresh).toHaveBeenCalledOnce();
    fetchSpy.mockRestore();
  });

  it("does not turn a failed detail read into an empty or current-state claim", async () => {
    mocks.detail.mockRejectedValue(new Error("database unavailable"));

    render(await AdminApplicationDetailPage({
      params: Promise.resolve({ applicationId }),
    }));

    expect(screen.getByRole("alert")).toHaveTextContent("temporarily unavailable");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("blocks approval when no eligible active default deal exists", async () => {
    const user = userEvent.setup();
    render(await AdminApplicationDetailPage({
      params: Promise.resolve({ applicationId }),
    }));

    await user.selectOptions(screen.getByLabelText("Decision"), "approve");
    expect(screen.getByRole("alert")).toHaveTextContent("No eligible active default deal");
    expect(screen.getByRole("button", { name: "Approval blocked" })).toBeDisabled();
  });

  it("requires confirmation and submits the exact eligible default snapshot", async () => {
    const user = userEvent.setup();
    mocks.deals.mockResolvedValue({
      defaultVersion: activeDefaultDeal,
      versions: [activeDefaultDeal],
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ status: "approved" }),
    } as Response);

    render(await AdminApplicationDetailPage({
      params: Promise.resolve({ applicationId }),
    }));
    await user.selectOptions(screen.getByLabelText("Decision"), "approve");

    const submit = screen.getByRole("button", {
      name: "Approve and assign Standard creator agreement v2",
    });
    expect(screen.getByText(dealSnapshotHash)).toBeInTheDocument();
    expect(submit).toBeDisabled();

    await user.click(screen.getByRole("checkbox", {
      name: /confirm this exact snapshot will be assigned/i,
    }));
    expect(submit).toBeEnabled();
    await user.click(submit);

    const options = fetchSpy.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(options.body))).toMatchObject({
      action: "approve",
      dealReviewConfirmed: true,
      expectedDealVersionId: activeDefaultDeal.id,
      expectedDealSnapshotHash: dealSnapshotHash,
    });
    fetchSpy.mockRestore();
  });
});
