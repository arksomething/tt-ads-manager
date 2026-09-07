import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  getAdminContentQueue,
  getAdminFinanceLedger,
  normalizeAdminContentQueue,
  normalizeAdminFinanceLedger,
} from "@/server/admin/content-finance";

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ rpc: mocks.rpc }),
}));

const entry = {
  id: "11111111-1111-4111-8111-111111111111",
  accountId: "22222222-2222-4222-8222-222222222222",
  enrollmentId: "33333333-3333-4333-8333-333333333333",
  postId: null,
  sourceKey: "campaign:creator:week-1",
  category: "base_views",
  currency: "USD",
  currencyExponent: 2,
  amountMinor: "12500",
  state: "approved",
  periodStart: "2026-08-24",
  periodEnd: "2026-08-30",
  earnedAt: "2026-08-31T12:00:00Z",
  approvedAt: "2026-08-31T13:00:00Z",
  paidAt: null,
  reconciledAt: null,
  externalReference: null,
  settlementId: null,
  serviceRoleKey: "must-not-leak",
};

const settlement = {
  id: "44444444-4444-4444-8444-444444444444",
  accountId: entry.accountId,
  enrollmentId: entry.enrollmentId,
  currency: "USD",
  currencyExponent: 2,
  totalMinor: "12500",
  state: "paid",
  periodStart: null,
  periodEnd: null,
  payoutProvider: "wise",
  externalPayoutId: "transfer-123",
  approvedAt: "2026-08-31T14:00:00Z",
  paidAt: "2026-08-31T15:00:00Z",
  reconciledAt: null,
  createdAt: "2026-08-31T13:30:00Z",
  earningEntryIds: [entry.id],
  providerToken: "must-not-leak",
};

describe("admin content and finance data", () => {
  beforeEach(() => mocks.rpc.mockReset());

  it("normalizes only open content review fields", () => {
    const queue = normalizeAdminContentQueue([{
      id: "55555555-5555-4555-8555-555555555555",
      accountId: entry.accountId,
      platform: "TIKTOK",
      url: "https://www.tiktok.com/@creator/video/123",
      declaredNativePostId: "123",
      matchState: "needs_review",
      matchedPostId: null,
      submittedAt: "2026-08-31T12:00:00Z",
      rawProviderResponse: "must-not-leak",
    }]);

    expect(queue).not.toBeNull();
    expect(queue).toHaveLength(1);
    expect(queue![0]).toMatchObject({ platform: "TIKTOK", matchState: "needs_review" });
    expect(JSON.stringify(queue)).not.toContain("must-not-leak");
  });

  it("retains exact enrollment, settlement membership, and non-secret payout evidence", () => {
    const ledger = normalizeAdminFinanceLedger({ entries: [entry], settlements: [settlement] });
    expect(ledger).toMatchObject({
      entries: [{ enrollmentId: entry.enrollmentId, settlementId: null }],
      settlements: [{
        enrollmentId: entry.enrollmentId,
        payoutProvider: "wise",
        externalPayoutId: "transfer-123",
        earningEntryIds: [entry.id],
      }],
    });
    expect(JSON.stringify(ledger)).not.toContain("must-not-leak");
  });

  it("fails closed instead of presenting malformed provider rows as an empty queue or partial ledger", () => {
    expect(normalizeAdminContentQueue({ queue: [] })).toBeNull();
    expect(normalizeAdminContentQueue([{ id: "incomplete-submission" }])).toBeNull();
    expect(normalizeAdminFinanceLedger({
      entries: [entry, { id: "incomplete-earning" }],
      settlements: [],
    })).toBeNull();
  });

  it("loads through the staff RPC boundaries with bounded limits", async () => {
    mocks.rpc
      .mockResolvedValueOnce({ data: [], error: null })
      .mockResolvedValueOnce({ data: { entries: [entry], settlements: [settlement] }, error: null });

    await expect(getAdminContentQueue(900)).resolves.toEqual([]);
    await expect(getAdminFinanceLedger(9_000)).resolves.toMatchObject({ entries: [{ id: entry.id }] });
    expect(mocks.rpc).toHaveBeenNthCalledWith(1, "get_admin_content_queue", { result_limit: 500 });
    expect(mocks.rpc).toHaveBeenNthCalledWith(2, "get_admin_finance_ledger", { result_limit: 1000 });
  });
});
