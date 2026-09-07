import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import AgreementPage from "@/app/onboarding/agreement/page";

const mocks = vi.hoisted(() => ({
  account: vi.fn(),
  accountState: vi.fn(),
  agreement: vi.fn(),
  deal: vi.fn(),
  readiness: vi.fn(),
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

vi.mock("@/lib/server-env", () => ({ hasSupabaseAuthEnv: () => true }));

vi.mock("@/lib/agreements/signwell", () => ({
  getSignWellReadiness: mocks.readiness,
}));

vi.mock("@/server/auth/session", () => ({
  getCurrentAccount: mocks.account,
}));

vi.mock("@/server/accounts/state", () => ({
  getCreatorAccountState: mocks.accountState,
}));

vi.mock("@/server/accounts/agreement", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/server/accounts/agreement")>();
  return {
    ...original,
    getOwnAgreementSigningContext: mocks.agreement,
    getOwnAssignedDealVersion: mocks.deal,
  };
});

const baseAgreement = {
  id: "agreement-1",
  enrollmentId: "enrollment-1",
  dealVersionId: "deal-1",
  provider: "signwell",
  providerEnvironment: "test",
  externalAgreementId: null,
  status: "assigned",
  signerName: "Creator Name",
  signerEmail: "creator@example.com",
  providerTemplateId: null,
  dealSnapshotSha256: null,
  verifiedProviderTemplateId: "c0593039-c093-4fd4-af40-ee59af4ff92f",
  verifiedDealSnapshotSha256: "a".repeat(64),
  provisioningStartedAt: null,
  sentAt: null,
  completedAt: null,
};

describe("creator agreement preparation actions", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-02T16:00:00.000Z"));
    mocks.account.mockResolvedValue({ id: "creator-1", email: "creator@example.com" });
    mocks.accountState.mockResolvedValue({
      nextPath: "/onboarding/agreement",
      profileState: "agreement_pending",
      applicationState: "approved",
      agreementState: "assigned",
    });
    mocks.deal.mockResolvedValue({
      id: "deal-1",
      dealKey: "standard",
      version: 1,
      label: "Standard creator agreement",
      termsMarkdown: "## Compensation\n\nAssigned terms.",
      termsSha256: "a".repeat(64),
      effectiveAt: "2026-09-01T00:00:00.000Z",
    });
    mocks.readiness.mockReturnValue({ readyToSend: true, testMode: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("offers preparation for a newly assigned agreement", async () => {
    mocks.agreement.mockResolvedValue(baseAgreement);

    render(await AgreementPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByRole("button", { name: "Prepare and review agreement" })).toBeInTheDocument();
  });

  it("keeps preparation locked without a verified per-deal database binding", async () => {
    mocks.agreement.mockResolvedValue({
      ...baseAgreement,
      verifiedProviderTemplateId: null,
      verifiedDealSnapshotSha256: null,
    });

    render(await AgreementPage({ searchParams: Promise.resolve({}) }));

    expect(screen.queryByRole("button", { name: "Prepare and review agreement" })).not.toBeInTheDocument();
    expect(screen.getByText("Not released")).toBeInTheDocument();
    expect(screen.getByText(/locked until the assigned terms and approved provider template are ready/i))
      .toBeInTheDocument();
  });

  it("keeps a fresh preparing lease refresh-only", async () => {
    mocks.accountState.mockResolvedValue({
      nextPath: "/onboarding/agreement",
      profileState: "agreement_pending",
      applicationState: "approved",
      agreementState: "preparing",
    });
    mocks.agreement.mockResolvedValue({
      ...baseAgreement,
      status: "preparing",
      provisioningStartedAt: "2026-09-02T15:55:00.000Z",
    });

    render(await AgreementPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByRole("link", { name: "Refresh status" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /retry agreement preparation/i })).not.toBeInTheDocument();
  });

  it("offers a retry only after the preparing lease expires", async () => {
    mocks.accountState.mockResolvedValue({
      nextPath: "/onboarding/agreement",
      profileState: "agreement_pending",
      applicationState: "approved",
      agreementState: "preparing",
    });
    mocks.agreement.mockResolvedValue({
      ...baseAgreement,
      status: "preparing",
      provisioningStartedAt: "2026-09-02T15:49:59.000Z",
    });

    render(await AgreementPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByRole("button", { name: "Retry agreement preparation" })).toBeInTheDocument();
    expect(screen.getByText(/did not finish within ten minutes/i)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Refresh status" })).not.toBeInTheDocument();
  });
});
