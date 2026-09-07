import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST as matchContent } from "@/app/api/admin/content/match/route";
import { POST as reviewContent } from "@/app/api/admin/content/review/route";
import { POST as mutateFinance } from "@/app/api/admin/finance/route";

const mocks = vi.hoisted(() => ({ getClaims: vi.fn(), rpc: vi.fn() }));

vi.mock("@/lib/supabase/server", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/supabase/server")>(),
  createRouteHandlerClient: () => ({
    auth: { getClaims: mocks.getClaims },
    rpc: mocks.rpc,
  }),
}));

const origin = "https://gotall-creator-platform.vercel.app";
const submissionId = "11111111-1111-4111-8111-111111111111";
const accountId = "22222222-2222-4222-8222-222222222222";
const enrollmentId = "33333333-3333-4333-8333-333333333333";
const earningId = "44444444-4444-4444-8444-444444444444";

function formRequest(path: string, values: Array<[string, string]>, requestOrigin = origin) {
  const form = new FormData();
  for (const [key, value] of values) form.append(key, value);
  return new NextRequest(`${origin}${path}`, {
    method: "POST",
    headers: { Origin: requestOrigin },
    body: form,
  });
}

describe("admin content and finance mutation routes", () => {
  beforeEach(() => {
    vi.stubEnv("APP_ORIGIN", origin);
    mocks.getClaims.mockReset();
    mocks.rpc.mockReset();
    mocks.getClaims.mockResolvedValue({ data: { claims: { sub: "admin-1" } }, error: null });
    mocks.rpc.mockResolvedValue({ data: null, error: null });
  });

  it("saves a reviewed content state through the staff-authorized RPC", async () => {
    const response = await reviewContent(formRequest("/api/admin/content/review", [
      ["submissionId", submissionId],
      ["state", "needs_review"],
      ["note", "Native ID needs confirmation"],
    ]));

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toContain("notice=Submission+marked+for+attention");
    expect(mocks.rpc).toHaveBeenCalledWith("set_creator_content_review_state", {
      target_submission_id: submissionId,
      target_state: "needs_review",
      reviewer_note: "Native ID needs confirmation",
    });
  });

  it("passes a normalized attribution payload without accepting a provider half-pair", async () => {
    const invalid = await matchContent(formRequest("/api/admin/content/match", [
      ["submissionId", submissionId],
      ["canonicalUrl", "https://www.tiktok.com/@creator/video/123"],
      ["provider", "tracker"],
    ]));
    expect(invalid.headers.get("location")).toContain("Provider+and+provider+post+ID");
    expect(mocks.rpc).not.toHaveBeenCalled();

    const response = await matchContent(formRequest("/api/admin/content/match", [
      ["submissionId", submissionId],
      ["canonicalUrl", "https://www.tiktok.com/@creator/video/123"],
      ["nativePostId", "123"],
      ["publishedAt", "2026-08-31T12:30"],
      ["provider", "tracker"],
      ["providerPostId", "provider-123"],
      ["providerAccountId", "account-123"],
    ]));
    expect(response.status).toBe(303);
    expect(mocks.rpc).toHaveBeenCalledWith("match_creator_content_submission", {
      target_submission_id: submissionId,
      match_input: expect.objectContaining({
        canonicalUrl: "https://www.tiktok.com/@creator/video/123",
        publishedAt: "2026-08-31T12:30:00Z",
        provider: "tracker",
        providerPostId: "provider-123",
      }),
    });
  });

  it("creates a deterministic pending settlement without payout fields", async () => {
    const response = await mutateFinance(formRequest("/api/admin/finance", [
      ["action", "create_settlement"],
      ["accountId", accountId],
      ["enrollmentId", enrollmentId],
      ["earningEntryId", earningId],
    ]));

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toContain("No+payout+was+sent");
    expect(mocks.rpc).toHaveBeenCalledWith("create_creator_settlement", {
      settlement_input: {
        accountId,
        enrollmentId,
        earningEntryIds: [earningId],
        idempotencyKey: expect.stringMatching(/^admin-ledger-v1:[a-f0-9]{64}$/u),
      },
    });
  });

  it("exposes only safe forward ledger transitions and rejects cross-origin writes", async () => {
    const paidAttempt = await mutateFinance(formRequest("/api/admin/finance", [
      ["action", "transition_earning"],
      ["earningId", earningId],
      ["nextState", "paid"],
      ["reason", "Manual payout"],
    ]));
    expect(paidAttempt.headers.get("location")).toContain("valid+earning+transition");
    expect(mocks.rpc).not.toHaveBeenCalled();

    const crossOrigin = await reviewContent(formRequest(
      "/api/admin/content/review",
      [["submissionId", submissionId], ["state", "matching"]],
      "https://attacker.example",
    ));
    expect(crossOrigin.headers.get("location")).toContain("Request+origin+was+not+accepted");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
