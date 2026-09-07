import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import AdminDealDetailPage from "@/app/admin/deals/[dealVersionId]/page";
import AdminDealsPage from "@/app/admin/deals/page";

const dealVersionId = "11111111-1111-4111-8111-111111111111";

const mocks = vi.hoisted(() => ({
  requireStaff: vi.fn(),
  catalog: vi.fn(),
  detail: vi.fn(),
  templateSource: vi.fn(),
  notFound: vi.fn(() => { throw new Error("not-found"); }),
  push: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  notFound: mocks.notFound,
  useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={String(href)} {...props}>{children}</a>
  ),
}));
vi.mock("@/server/admin/access", () => ({ requireCreatorStaff: mocks.requireStaff }));
vi.mock("@/server/admin/deal-template-source", () => ({
  getAdminDealTemplateSourceArtifact: mocks.templateSource,
}));
vi.mock("@/server/admin/deals", () => ({
  adminDealActivationConfirmation: "ACTIVATE THIS EXACT SEALED DEAL SNAPSHOT AS THE DEFAULT",
  getAdminDealCatalog: mocks.catalog,
  getAdminDealDetail: mocks.detail,
  signWellBindingVerificationAttestation:
    "I verified this exact SignWell production template source against this sealed deal snapshot.",
}));

const economics = {
  schemaVersion: 1 as const,
  currency: "USD",
  currencyExponent: 2,
  measurementWindowSeconds: 604800,
  measurementWindowAnchor: "published_at" as const,
  paidImpressionsPolicy: "exclude_verified" as const,
  invalidTrafficPolicy: "exclude_verified" as const,
  fixedFeeMicros: 0,
  creatorAggregateCapMicros: null,
  minimumQualifiedViews: null,
  crossPostPolicy: "separate_eligible_post" as const,
  paymentDueDays: null,
  minimumPayoutMicros: null,
  tiers: {
    baseline: { rateMicrosPerThousand: 500000, perPostCapMicros: 100000000, qualification: "Accepted standard post" },
    talking: { rateMicrosPerThousand: 1000000, perPostCapMicros: 300000000, qualification: "Accepted talking post" },
  },
};

const version = {
  id: dealVersionId,
  dealKey: "standard-creator",
  version: 1,
  label: "Standard creator agreement",
  status: "draft" as const,
  isDefault: false,
  draftRevision: 3,
  termsHash: "a".repeat(64),
  economicsHash: "b".repeat(64),
  snapshotHash: "c".repeat(64),
  providerTemplateHash: null,
  assignmentCount: 0,
  providerBindingCount: 0,
  approvalCount: 0,
  businessApprovalCount: 0,
  legalApprovalCount: 0,
  readinessBlockerCount: 3,
  activationReady: false,
  readinessBlockers: [
    "Seal the immutable deal snapshot.",
    "Record legal approval for this exact snapshot.",
    "Verify exactly one signing-provider template binding.",
  ],
  createdAt: "2026-09-01T12:00:00Z",
  updatedAt: "2026-09-02T12:00:00Z",
  effectiveAt: null,
  sealedAt: null,
};

const detail = {
  ...version,
  providerBindingCount: 1,
  termsMarkdown: "# Creator agreement\n\nExact database terms.\n\n## Content rights\nGoTall owns accepted deliverables.",
  economics,
  changeNote: "Initial internal draft",
  providerBindings: [{
    id: "22222222-2222-4222-8222-222222222222",
    sourceArtifactId: null,
    provider: "signwell" as const,
    environment: "production",
    templateId: "33333333-3333-4333-8333-333333333333",
    templateHash: "d".repeat(64),
    boundSnapshotHash: "c".repeat(64),
    status: "verified" as const,
    configuredBy: "44444444-4444-4444-8444-444444444444",
    verifiedBy: "44444444-4444-4444-8444-444444444444",
    verificationMethod: "manual_admin_attestation" as const,
    verifiedAt: "2026-09-02T11:30:00Z",
    updatedAt: "2026-09-02T11:30:00Z",
  }],
  approvals: [],
  auditEvents: [{
    id: 1,
    type: "draft_updated",
    actorUserId: "admin-1",
    draftRevision: 3,
    fromStatus: "draft" as const,
    toStatus: "draft" as const,
    metadata: { changedFields: ["terms_markdown"], changeNote: "Initial internal draft", snapshotHash: "c".repeat(64) },
    createdAt: "2026-09-02T12:00:00Z",
  }],
};

describe("admin deal workspace", () => {
  beforeEach(() => {
    mocks.requireStaff.mockReset();
    mocks.catalog.mockReset();
    mocks.detail.mockReset();
    mocks.templateSource.mockReset();
    mocks.notFound.mockClear();
    mocks.push.mockReset();
    mocks.refresh.mockReset();
    vi.unstubAllGlobals();
    mocks.requireStaff.mockResolvedValue({ account: { id: "admin-1" }, staff: { role: "admin" } });
    mocks.catalog.mockResolvedValue({ defaultVersion: null, versions: [version] });
    mocks.detail.mockResolvedValue(detail);
    mocks.templateSource.mockResolvedValue(null);
  });

  it("separates the non-binding sample, reports a fail-closed default, and offers only draft creation", async () => {
    render(await AdminDealsPage());

    expect(screen.getByRole("heading", { name: "Deal versions" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Deals" })).toHaveAttribute("href", "/admin/deals");
    expect(screen.getByText("Reference only · Non-binding")).toBeInTheDocument();
    expect(screen.getByText(/cannot be activated, assigned, or sent for signature/i)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Approvals remain fail-closed" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create internal draft" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /activate/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /import/i })).not.toBeInTheDocument();
  });

  it("keeps reviewers read-only and does not render any mutation control", async () => {
    mocks.requireStaff.mockResolvedValue({ account: { id: "reviewer-1" }, staff: { role: "reviewer" } });
    render(await AdminDealsPage());

    expect(screen.getByText(/Reviewer access is read-only/i)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("starts with blank terms, then creates an internal draft with structured economics and never activates it", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ deal: { id: dealVersionId } }),
    }));
    render(await AdminDealsPage());

    expect(screen.getByLabelText("Legal terms")).toHaveValue("");
    await user.type(screen.getByLabelText(/^Deal key/), "standard-creator");
    await user.type(screen.getByLabelText("Internal label"), "Standard creator agreement");
    await user.type(screen.getByLabelText("Legal terms"), "# Reviewed creator agreement");
    await user.click(screen.getByRole("button", { name: "Create internal draft" }));

    expect(fetch).toHaveBeenCalledWith("/api/admin/deals", expect.objectContaining({ method: "POST" }));
    const options = vi.mocked(fetch).mock.calls[0]?.[1] as RequestInit;
    const payload = JSON.parse(String(options.body));
    expect(payload).toMatchObject({
      dealKey: "standard-creator",
      label: "Standard creator agreement",
      termsMarkdown: "# Reviewed creator agreement",
      economics: {
        schemaVersion: 1,
        currency: "USD",
        measurementWindowSeconds: 604800,
        tiers: {
          baseline: { rateMicrosPerThousand: 500000, perPostCapMicros: 100000000 },
          talking: { rateMicrosPerThousand: 1000000, perPostCapMicros: 300000000 },
        },
      },
    });
    expect(payload).not.toHaveProperty("status");
    expect(payload).not.toHaveProperty("isDefault");
    expect(mocks.push).toHaveBeenCalledWith(`/admin/deals/${dealVersionId}`);
  });

  it("renders exact database terms, hashes, blockers, and admin-only draft controls", async () => {
    render(await AdminDealDetailPage({ params: Promise.resolve({ dealVersionId }) }));

    expect(screen.getByRole("heading", { name: "Standard creator agreement" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Creator agreement" })).toBeInTheDocument();
    expect(screen.getByText("Exact database terms.")).toBeInTheDocument();
    expect(screen.getByText("a".repeat(64))).toBeInTheDocument();
    expect(screen.getByText(`Bound snapshot ${"c".repeat(64)}`)).toBeInTheDocument();
    expect(screen.getByText("Seal the immutable deal snapshot.")).toBeInTheDocument();
    expect(screen.getByText(/contracting entity and creator eligibility, including minors/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save draft revision" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Seal immutable version" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /activate/i })).not.toBeInTheDocument();
  });

  it("saves against the loaded optimistic draft revision without changing lifecycle state", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ deal: { id: dealVersionId } }),
    }));
    render(await AdminDealDetailPage({ params: Promise.resolve({ dealVersionId }) }));

    await user.click(screen.getByRole("button", { name: "Save draft revision" }));

    expect(fetch).toHaveBeenCalledWith(`/api/admin/deals/${dealVersionId}`, expect.objectContaining({ method: "PATCH" }));
    const options = vi.mocked(fetch).mock.calls[0]?.[1] as RequestInit;
    const payload = JSON.parse(String(options.body));
    expect(payload).toMatchObject({ revision: 3, label: detail.label, termsMarkdown: detail.termsMarkdown });
    expect(payload).not.toHaveProperty("status");
    expect(payload).not.toHaveProperty("isDefault");
    expect(await screen.findByRole("status")).toHaveTextContent(/remains internal, non-binding, and unassigned/i);
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it("seals the loaded revision without exposing activation or sending", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ deal: { id: dealVersionId } }),
    }));
    render(await AdminDealDetailPage({ params: Promise.resolve({ dealVersionId }) }));

    await user.click(screen.getByRole("button", { name: "Seal immutable version" }));

    expect(fetch).toHaveBeenCalledWith(`/api/admin/deals/${dealVersionId}/seal`, expect.objectContaining({ method: "POST" }));
    const options = vi.mocked(fetch).mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(options.body))).toEqual({ revision: 3 });
    expect(await screen.findByRole("status")).toHaveTextContent(/not active, assigned, or available for signing/i);
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: /activate/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /send/i })).not.toBeInTheDocument();
  });

  it("reports a rejected mutation without claiming a save or refreshing", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      json: vi.fn().mockResolvedValue({ error: "The loaded draft revision is stale." }),
    }));
    render(await AdminDealDetailPage({ params: Promise.resolve({ dealVersionId }) }));

    await user.click(screen.getByRole("button", { name: "Save draft revision" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/draft revision is stale/i);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("does not expose edit or seal controls to a reviewer", async () => {
    mocks.requireStaff.mockResolvedValue({ account: { id: "reviewer-1" }, staff: { role: "reviewer" } });
    render(await AdminDealDetailPage({ params: Promise.resolve({ dealVersionId }) }));

    expect(screen.getAllByText(/Reviewer access is read-only/i).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Save draft revision" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Seal immutable version" })).not.toBeInTheDocument();
  });
});
