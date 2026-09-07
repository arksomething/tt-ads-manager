import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST as requestCheck } from "@/app/api/onboarding/accounts/check/route";
import { POST as reviewClaim } from "@/app/api/admin/verifications/review/route";

const mocks = vi.hoisted(() => ({ getClaims: vi.fn(), rpc: vi.fn() }));

vi.mock("@/lib/supabase/server", () => ({
  createRouteHandlerClient: () => ({
    auth: { getClaims: mocks.getClaims },
    rpc: mocks.rpc,
  }),
}));

const claimId = "92d0f7e2-3f8f-4ce5-a1af-d93b7b84d011";

function formRequest(path: string, values: Record<string, string>, origin = "https://gotall-creator-platform.vercel.app") {
  const form = new FormData();
  for (const [key, value] of Object.entries(values)) form.set(key, value);
  return new NextRequest(`https://gotall-creator-platform.vercel.app${path}`, {
    method: "POST",
    headers: { Origin: origin },
    body: form,
  });
}

describe("campaign-account verification routes", () => {
  beforeEach(() => {
    mocks.getClaims.mockReset();
    mocks.rpc.mockReset();
    mocks.getClaims.mockResolvedValue({ data: { claims: { sub: "user-1" } }, error: null });
    mocks.rpc.mockResolvedValue({ data: claimId, error: null });
  });

  it("queues a creator-owned durable verification job", async () => {
    const response = await requestCheck(formRequest("/api/onboarding/accounts/check", { claimId }));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toContain("notice=Verification+check+queued");
    expect(mocks.rpc).toHaveBeenCalledWith("request_creator_platform_verification", {
      target_claim_id: claimId,
    });
  });

  it("rejects cross-origin verification mutations", async () => {
    const response = await requestCheck(formRequest(
      "/api/onboarding/accounts/check",
      { claimId },
      "https://attacker.example",
    ));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toContain("error=Request+origin+was+not+accepted");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("passes only validated review input to the staff-authorized RPC", async () => {
    const response = await reviewClaim(formRequest("/api/admin/verifications/review", {
      claimId,
      decision: "approve",
      nativeAccountId: "native-123",
      evidenceReference: "https://instagram.com/creator",
      note: "Matched public bio",
      accountId: "attacker-selected-account",
    }));
    expect(response.status).toBe(303);
    expect(mocks.rpc).toHaveBeenCalledWith("review_creator_platform_claim", {
      target_claim_id: claimId,
      review_input: {
        decision: "approve",
        nativeAccountId: "native-123",
        evidenceReference: "https://instagram.com/creator",
        note: "Matched public bio",
      },
    });
  });
});
