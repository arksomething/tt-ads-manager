import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/admin/applications/[applicationId]/review/route";

const applicationId = "11111111-1111-4111-8111-111111111111";
const dealVersionId = "22222222-2222-4222-8222-222222222222";
const dealSnapshotHash = "a".repeat(64);
const mocks = vi.hoisted(() => ({ getClaims: vi.fn(), rpc: vi.fn() }));

vi.mock("@/lib/server-env", () => ({ hasSupabaseAuthEnv: () => true }));
vi.mock("@/lib/supabase/server", () => ({
  createRouteHandlerClient: () => ({
    auth: { getClaims: mocks.getClaims },
    rpc: mocks.rpc,
  }),
}));

function request(body: unknown, origin = "https://gotall-creator-platform.vercel.app") {
  return new NextRequest(
    `https://gotall-creator-platform.vercel.app/api/admin/applications/${applicationId}/review`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify(body),
    },
  );
}

const context = { params: Promise.resolve({ applicationId }) };

describe("admin application decision API", () => {
  beforeEach(() => {
    mocks.getClaims.mockReset();
    mocks.rpc.mockReset();
    mocks.getClaims.mockResolvedValue({ data: { claims: { sub: "staff-1" } }, error: null });
  });

  it("submits a validated approval only through the staff RPC", async () => {
    mocks.rpc.mockResolvedValue({
      data: [{
        application_id: applicationId,
        application_status: "approved",
        lifecycle_status: "agreement_pending",
        enrollment_id: "enrollment-1",
        agreement_id: "agreement-1",
      }],
      error: null,
    });

    const response = await POST(request({
      action: "approve",
      applicantMessage: "Welcome to the program.",
      staffNote: "Identity reviewed.",
      dealReviewConfirmed: true,
      expectedDealVersionId: dealVersionId,
      expectedDealSnapshotHash: dealSnapshotHash,
      status: "attacker-selected-status",
      reviewerId: "attacker-selected-reviewer",
    }), context);

    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("review_creator_application_v2", {
      target_application_id: applicationId,
      review_action: "approve",
      applicant_message: "Welcome to the program.",
      staff_note: "Identity reviewed.",
      deal_review_confirmed: true,
      expected_deal_version_id: dealVersionId,
      expected_deal_snapshot_sha256: dealSnapshotHash,
    });
    await expect(response.json()).resolves.toMatchObject({
      applicationId,
      status: "approved",
      lifecycleStatus: "agreement_pending",
    });
  });

  it("rejects approval unless the exact deal UUID and snapshot are confirmed", async () => {
    for (const body of [
      { action: "approve" },
      {
        action: "approve",
        dealReviewConfirmed: true,
        expectedDealVersionId: dealVersionId,
        expectedDealSnapshotHash: "not-a-hash",
      },
      {
        action: "approve",
        dealReviewConfirmed: false,
        expectedDealVersionId: dealVersionId,
        expectedDealSnapshotHash: dealSnapshotHash,
      },
    ]) {
      const response = await POST(request(body), context);
      expect(response.status).toBe(400);
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("rejects deal-confirmation fields on a non-approval action", async () => {
    const response = await POST(request({
      action: "start_review",
      dealReviewConfirmed: true,
      expectedDealVersionId: dealVersionId,
      expectedDealSnapshotHash: dealSnapshotHash,
    }), context);

    expect(response.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("requires session identity and a creator-facing adverse-decision message", async () => {
    const missingMessage = await POST(request({ action: "request_changes" }), context);
    expect(missingMessage.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();

    mocks.getClaims.mockResolvedValue({ data: { claims: null }, error: new Error("expired") });
    const unsigned = await POST(request({
      action: "reject",
      applicantMessage: "We cannot continue with this application.",
    }), context);
    expect(unsigned.status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("rejects cross-origin writes before reading the session", async () => {
    const response = await POST(
      request({ action: "start_review" }, "https://attacker.example"),
      context,
    );

    expect(response.status).toBe(403);
    expect(mocks.getClaims).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["42501", 403, /reviewer access/i],
    ["P0002", 404, /not found/i],
    ["55000", 409, /default deal/i],
    ["22023", 409, /no longer valid/i],
  ])("maps safe RPC code %s to HTTP %i", async (code, status, message) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code } });
    const response = await POST(request({ action: "start_review" }), context);
    expect(response.status).toBe(status);
    expect((await response.json()).error).toMatch(message);
  });
});
