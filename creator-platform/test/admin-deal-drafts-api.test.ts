import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PATCH } from "@/app/api/admin/deals/[dealId]/route";
import { POST as sealDeal } from "@/app/api/admin/deals/[dealId]/seal/route";
import { POST as createDeal } from "@/app/api/admin/deals/route";
import { emptyAdminDealEconomics } from "@/server/admin/deals";

const mocks = vi.hoisted(() => ({ getClaims: vi.fn(), rpc: vi.fn() }));

vi.mock("@/lib/server-env", () => ({ hasSupabaseAuthEnv: () => true }));
vi.mock("@/lib/supabase/server", () => ({
  createRouteHandlerClient: () => ({
    auth: { getClaims: mocks.getClaims },
    rpc: mocks.rpc,
  }),
}));

const origin = "https://gotall-creator-platform.vercel.app";
const dealId = "11111111-1111-4111-8111-111111111111";
const hash = "a".repeat(64);
const economics = emptyAdminDealEconomics();
const detail = {
  id: dealId,
  dealKey: "standard",
  version: 1,
  label: "Standard deal",
  status: "draft",
  isDefault: false,
  draftRevision: 1,
  termsHash: hash,
  economicsHash: hash,
  snapshotHash: hash,
  providerTemplateHash: null,
  assignmentCount: 0,
  providerBindingCount: 0,
  approvalCount: 0,
  businessApprovalCount: 0,
  legalApprovalCount: 0,
  readinessBlockerCount: 4,
  activationReady: false,
  readinessBlockers: ["a", "b", "c", "d"],
  createdAt: "2026-09-02T12:00:00.000Z",
  updatedAt: "2026-09-02T12:00:00.000Z",
  effectiveAt: null,
  sealedAt: null,
  termsMarkdown: "Draft terms",
  economics,
  changeNote: null,
  providerBindings: [],
  approvals: [],
  auditEvents: [],
};

function request(path: string, method: string, body: unknown, requestOrigin = origin) {
  return new NextRequest(`${origin}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Origin: requestOrigin },
    body: JSON.stringify(body),
  });
}

const context = { params: Promise.resolve({ dealId }) };

describe("admin deal draft API", () => {
  beforeEach(() => {
    mocks.getClaims.mockReset();
    mocks.rpc.mockReset();
    mocks.getClaims.mockResolvedValue({ data: { claims: { sub: "staff-1" } }, error: null });
    mocks.rpc.mockResolvedValue({ data: detail, error: null });
  });

  it("creates through the admin RPC without accepting browser-owned fields", async () => {
    const rejected = await createDeal(request("/api/admin/deals", "POST", {
      dealKey: "standard",
      label: "Standard deal",
      termsMarkdown: "Draft terms",
      economics,
      status: "active",
      version: 9,
      actorUserId: "attacker",
      snapshotHash: hash,
    }));
    expect(rejected.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();

    const response = await createDeal(request("/api/admin/deals", "POST", {
      dealKey: "STANDARD",
      label: "Standard deal",
      termsMarkdown: "Draft terms",
      economics,
      changeNote: "Initial draft",
    }));
    expect(response.status).toBe(201);
    expect(mocks.rpc).toHaveBeenCalledWith("create_admin_program_deal_draft", {
      deal_key_input: "standard",
      label_input: "Standard deal",
      terms_markdown_input: "Draft terms",
      economics_input: economics,
      change_note_input: "Initial draft",
    });
  });

  it("uses the supplied draft revision only for optimistic concurrency", async () => {
    const response = await PATCH(request(`/api/admin/deals/${dealId}`, "PATCH", {
      revision: 4,
      label: "Revised standard deal",
      changeNote: "Clarified title",
    }), context);
    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("update_admin_program_deal_draft", {
      target_deal_version_id: dealId,
      expected_draft_revision: 4,
      draft_patch: {
        label: "Revised standard deal",
        changeNote: "Clarified title",
      },
    });
  });

  it("seals without exposing activation and maps stale revisions safely", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: "40001" } });
    const stale = await sealDeal(request(`/api/admin/deals/${dealId}/seal`, "POST", {
      revision: 4,
    }), context);
    expect(stale.status).toBe(409);
    expect((await stale.json()).error).toMatch(/changed in another session/i);

    mocks.rpc.mockResolvedValueOnce({ data: { ...detail, status: "sealed" }, error: null });
    const response = await sealDeal(request(`/api/admin/deals/${dealId}/seal`, "POST", {
      revision: 5,
      changeNote: "Ready for approvals",
    }), context);
    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenLastCalledWith("seal_admin_program_deal_draft", {
      target_deal_version_id: dealId,
      expected_draft_revision: 5,
      change_note_input: "Ready for approvals",
    });
    expect(JSON.stringify(await response.json())).not.toContain("activate");
  });

  it("rejects float micros, cross-origin writes, unsigned sessions, and non-admin RPCs", async () => {
    const invalidEconomics = await createDeal(request("/api/admin/deals", "POST", {
      dealKey: "standard",
      label: "Standard deal",
      termsMarkdown: "Draft terms",
      economics: { ...economics, fixedFeeMicros: 1.25 },
    }));
    expect(invalidEconomics.status).toBe(400);

    const crossOrigin = await PATCH(request(`/api/admin/deals/${dealId}`, "PATCH", {
      revision: 1,
      label: "Changed",
    }, "https://attacker.example"), context);
    expect(crossOrigin.status).toBe(403);

    mocks.getClaims.mockResolvedValueOnce({ data: { claims: null }, error: new Error("expired") });
    const unsigned = await PATCH(request(`/api/admin/deals/${dealId}`, "PATCH", {
      revision: 1,
      label: "Changed",
    }), context);
    expect(unsigned.status).toBe(401);

    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: "42501" } });
    const reviewer = await PATCH(request(`/api/admin/deals/${dealId}`, "PATCH", {
      revision: 1,
      label: "Changed",
    }), context);
    expect(reviewer.status).toBe(403);
  });
});
