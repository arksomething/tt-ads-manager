import { beforeEach, describe, expect, it, vi } from "vitest";

import { adminStaffGrantConfirmation } from "@/lib/admin-staff-access";
import {
  getAdminStaffDirectory,
  normalizeAdminStaffDirectory,
  normalizeAdminStaffMutation,
  parseAdminStaffAccessInput,
} from "@/server/admin/staff";

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ rpc: mocks.rpc }),
}));

const admin = {
  email: "admin@example.com",
  role: "admin",
  active: true,
  emailConfirmed: true,
  authUserId: "must-not-leak",
  providerMetadata: { provider: "google" },
};
const reviewer = {
  email: "reviewer@example.com",
  role: "reviewer",
  active: false,
  emailConfirmed: true,
};
const event = {
  actor: "admin@example.com",
  targetEmail: "reviewer@example.com",
  priorRole: null,
  priorActive: null,
  newRole: "reviewer",
  newActive: true,
  outcome: "added",
  createdAt: "2026-09-03T12:00:00.000Z",
  actorUserId: "must-not-leak",
  recoveryReference: "must-not-leak",
};

describe("admin staff data", () => {
  beforeEach(() => mocks.rpc.mockReset());

  it("normalizes complete minimal rows and discards unknown auth fields", () => {
    const directory = normalizeAdminStaffDirectory({
      staffMembers: [admin, reviewer],
      recentEvents: [event],
    });
    expect(directory).toEqual({
      staffMembers: [
        { email: admin.email, role: "admin", active: true, emailConfirmed: true },
        { email: reviewer.email, role: "reviewer", active: false, emailConfirmed: true },
      ],
      recentEvents: [{
        actor: "admin@example.com",
        targetEmail: "reviewer@example.com",
        priorRole: null,
        priorActive: null,
        newRole: "reviewer",
        newActive: true,
        outcome: "added",
        createdAt: "2026-09-03T12:00:00.000Z",
      }],
    });
    expect(JSON.stringify(directory)).not.toContain("must-not-leak");
    expect(JSON.stringify(directory)).not.toContain("providerMetadata");
    expect(JSON.stringify(directory)).not.toContain("recoveryReference");
  });

  it("preserves verified empty arrays but rejects malformed staff or audit evidence", () => {
    expect(normalizeAdminStaffDirectory({ staffMembers: [], recentEvents: [] })).toEqual({
      staffMembers: [],
      recentEvents: [],
    });
    expect(normalizeAdminStaffDirectory(null)).toBeNull();
    expect(normalizeAdminStaffDirectory({ staffMembers: [admin] })).toBeNull();
    expect(normalizeAdminStaffDirectory({ staffMembers: [{ ...admin, email: "Admin@example.com" }], recentEvents: [] })).toBeNull();
    expect(normalizeAdminStaffDirectory({ staffMembers: [{ ...admin, active: "yes" }], recentEvents: [] })).toBeNull();
    expect(normalizeAdminStaffDirectory({ staffMembers: [admin, { ...reviewer, email: admin.email }], recentEvents: [] })).toBeNull();
    expect(normalizeAdminStaffDirectory({
      staffMembers: [admin],
      recentEvents: [{ ...event, outcome: "reactivated" }],
    })).toBeNull();
    expect(normalizeAdminStaffDirectory({
      staffMembers: [admin],
      recentEvents: [{ ...event, actor: "arbitrary privileged system" }],
    })).toBeNull();
  });

  it("normalizes mutation envelopes without leaking extra response data", () => {
    const result = normalizeAdminStaffMutation({
      staffMember: admin,
      requestOutcome: "added",
      authUser: { encryptedPassword: "must-not-leak" },
    }, { email: admin.email, role: "admin" });
    expect(result).toEqual({
      staffMember: { email: admin.email, role: "admin", active: true, emailConfirmed: true },
      requestOutcome: "added",
    });
    expect(JSON.stringify(result)).not.toContain("encryptedPassword");
    expect(normalizeAdminStaffMutation(
      { staffMember: admin, requestOutcome: "updated" },
      { email: admin.email, role: "admin" },
    )).toBeNull();
    expect(normalizeAdminStaffMutation(
      { staffMember: admin, requestOutcome: "added" },
      { email: "different@example.com", role: "admin" },
    )).toBeNull();
    expect(normalizeAdminStaffMutation(
      { staffMember: { ...admin, active: false }, requestOutcome: "added" },
      { email: admin.email, role: "admin" },
    )).toBeNull();
  });

  it("keeps reviewer input simple and requires target-specific admin confirmation", () => {
    expect(parseAdminStaffAccessInput({
      email: "  New.Staff@Example.COM ",
      role: "reviewer",
    })).toEqual({ email: "new.staff@example.com", role: "reviewer", confirmation: null });

    const confirmation = adminStaffGrantConfirmation("new.admin@example.com");
    expect(parseAdminStaffAccessInput({
      email: "New.Admin@Example.com",
      role: "admin",
      confirmation,
    })).toEqual({ email: "new.admin@example.com", role: "admin", confirmation });

    expect(parseAdminStaffAccessInput({ email: "new.admin@example.com", role: "admin" })).toBeNull();
    expect(parseAdminStaffAccessInput({
      email: "new.admin@example.com",
      role: "admin",
      confirmation: "GRANT ADMIN ACCESS",
    })).toBeNull();
    expect(parseAdminStaffAccessInput({
      email: "staff@example.com",
      role: "reviewer",
      confirmation: "GRANT ADMIN ACCESS TO staff@example.com",
    })).toBeNull();
    expect(parseAdminStaffAccessInput({ email: "staff@example.com", role: "owner" })).toBeNull();
    expect(parseAdminStaffAccessInput({ email: "staff@example.com", role: "admin", active: true })).toBeNull();
  });

  it("loads only through the staff directory RPC and rejects malformed success data", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { staffMembers: [admin], recentEvents: [event] }, error: null });
    await expect(getAdminStaffDirectory()).resolves.toEqual({
      staffMembers: [{ email: admin.email, role: "admin", active: true, emailConfirmed: true }],
      recentEvents: [expect.objectContaining({ targetEmail: event.targetEmail, outcome: "added" })],
    });
    expect(mocks.rpc).toHaveBeenCalledWith("get_creator_staff_directory");

    mocks.rpc.mockResolvedValueOnce({ data: { staffMembers: null, recentEvents: [] }, error: null });
    await expect(getAdminStaffDirectory()).rejects.toThrow("invalid data");
  });
});
