import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  getCurrentApplicationStaffMembership,
  getStaffApplicationDetail,
  getStaffApplicationQueue,
  normalizeStaffApplicationDetail,
  normalizeStaffApplicationQueue,
} from "@/server/admin/applications";

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ rpc: mocks.rpc }),
}));

const queueRow = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Dylan Smith",
  email: "dylan@example.com",
  discordUsername: "dylan",
  status: "submitted",
  lifecycleStatus: "application_pending",
  submittedAt: "2026-08-31T12:00:00.000Z",
  reviewedAt: null,
  reviewRevision: 0,
  handleCount: 2,
  platforms: ["TIKTOK", "INSTAGRAM_REELS"],
  serviceRoleKey: "must-not-leak",
};

const detailRow = {
  ...queueRow,
  accountId: "22222222-2222-4222-8222-222222222222",
  phoneNumber: "+15555550123",
  decisionMessage: null,
  staffNote: "Strong creator history.",
  handles: [{
    id: "33333333-3333-4333-8333-333333333333",
    platform: "TIKTOK",
    handle: "@dylan.grows",
    normalizedHandle: "dylan.grows",
  }],
  enrollment: null,
  agreement: null,
  auditEvents: [{
    id: 4,
    type: "review_started",
    actorUserId: "44444444-4444-4444-8444-444444444444",
    metadata: {
      from_status: "submitted",
      to_status: "in_review",
      staff_note: "Strong creator history.",
      raw_provider_token: "must-not-leak",
    },
    createdAt: "2026-08-31T13:00:00.000Z",
  }],
};

describe("admin creator application data", () => {
  beforeEach(() => mocks.rpc.mockReset());

  it("normalizes a complete queue and discards unknown fields", () => {
    const result = normalizeStaffApplicationQueue([{ applications: [queueRow] }]);

    expect(result).toEqual([{
      id: queueRow.id,
      name: "Dylan Smith",
      email: "dylan@example.com",
      discordUsername: "dylan",
      status: "submitted",
      lifecycleStatus: "application_pending",
      submittedAt: "2026-08-31T12:00:00.000Z",
      reviewedAt: null,
      reviewRevision: 0,
      handleCount: 2,
      platforms: ["TIKTOK", "INSTAGRAM_REELS"],
    }]);
    expect(JSON.stringify(result)).not.toContain("must-not-leak");
  });

  it("preserves a valid empty queue but rejects malformed envelopes and rows", () => {
    expect(normalizeStaffApplicationQueue([{ applications: [] }])).toEqual([]);
    expect(normalizeStaffApplicationQueue(null)).toBeNull();
    expect(normalizeStaffApplicationQueue([{ applications: [{
      ...queueRow,
      platforms: ["TIKTOK", "UNTRUSTED"],
    }] }])).toBeNull();
  });

  it("normalizes detail and only exposes reviewed audit metadata keys", () => {
    const result = normalizeStaffApplicationDetail([{ application: detailRow }]);

    expect(result).toMatchObject({
      id: queueRow.id,
      phoneNumber: "+15555550123",
      staffNote: "Strong creator history.",
      handles: [{ platform: "TIKTOK", normalizedHandle: "dylan.grows" }],
      auditEvents: [{
        type: "review_started",
        fromStatus: "submitted",
        toStatus: "in_review",
        staffNote: "Strong creator history.",
      }],
    });
    expect(JSON.stringify(result)).not.toContain("raw_provider_token");
    expect(JSON.stringify(result)).not.toContain("must-not-leak");
  });

  it("rejects partial detail evidence instead of silently omitting it", () => {
    expect(normalizeStaffApplicationDetail([{ application: {
      ...detailRow,
      handles: [...detailRow.handles, { id: "malformed" }],
    } }])).toBeNull();
    expect(normalizeStaffApplicationDetail([{ application: {
      ...detailRow,
      auditEvents: undefined,
    } }])).toBeNull();
  });

  it("uses only the staff RPC boundaries", async () => {
    mocks.rpc
      .mockResolvedValueOnce({ data: [{ staff_role: "reviewer", active: true }], error: null })
      .mockResolvedValueOnce({ data: [{ applications: [queueRow] }], error: null })
      .mockResolvedValueOnce({ data: [{ application: detailRow }], error: null });

    await expect(getCurrentApplicationStaffMembership()).resolves.toEqual({ role: "reviewer" });
    await expect(getStaffApplicationQueue("submitted")).resolves.toHaveLength(1);
    await expect(getStaffApplicationDetail(queueRow.id)).resolves.toMatchObject({ id: queueRow.id });

    expect(mocks.rpc).toHaveBeenNthCalledWith(1, "get_current_staff_member");
    expect(mocks.rpc).toHaveBeenNthCalledWith(2, "get_staff_creator_application_queue", {
      application_status_filter: "submitted",
    });
    expect(mocks.rpc).toHaveBeenNthCalledWith(3, "get_staff_creator_application", {
      target_application_id: queueRow.id,
    });
  });

  it("throws on malformed RPC payloads while preserving a real not-found result", async () => {
    mocks.rpc
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: [], error: null })
      .mockResolvedValueOnce({
        data: [{ application: { ...detailRow, handles: [{ id: "malformed" }] } }],
        error: null,
      });

    await expect(getStaffApplicationQueue("all")).rejects.toThrow("invalid data");
    await expect(getStaffApplicationDetail(queueRow.id)).resolves.toBeNull();
    await expect(getStaffApplicationDetail(queueRow.id)).rejects.toThrow("invalid data");
  });
});
