import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/admin/staff/route";
import { adminStaffGrantConfirmation } from "@/lib/admin-staff-access";

const mocks = vi.hoisted(() => ({ getClaims: vi.fn(), rpc: vi.fn() }));

vi.mock("@/lib/server-env", () => ({ hasSupabaseAuthEnv: () => true }));
vi.mock("@/lib/supabase/server", () => ({
  createRouteHandlerClient: () => ({
    auth: { getClaims: mocks.getClaims },
    rpc: mocks.rpc,
  }),
}));

const origin = "https://gotall-creator-platform.vercel.app";
const member = {
  email: "staff@example.com",
  role: "reviewer",
  active: true,
  emailConfirmed: true,
};

function request(
  body: unknown,
  options: { origin?: string | null; contentType?: string; contentLength?: string } = {},
) {
  const headers: Record<string, string> = { "Content-Type": options.contentType ?? "application/json" };
  const requestOrigin = options.origin === undefined ? origin : options.origin;
  if (requestOrigin) headers.Origin = requestOrigin;
  if (options.contentLength) headers["Content-Length"] = options.contentLength;
  return new NextRequest(`${origin}/api/admin/staff`, {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("admin staff API", () => {
  beforeEach(() => {
    mocks.getClaims.mockReset();
    mocks.rpc.mockReset();
    mocks.getClaims.mockResolvedValue({ data: { claims: { sub: "admin-1" } }, error: null });
    mocks.rpc.mockResolvedValue({
      data: { staffMember: member, requestOutcome: "added" },
      error: null,
    });
  });

  it("adds or reactivates only by normalized email and selected role", async () => {
    const response = await POST(request({
      email: "  Staff@Example.COM ",
      role: "reviewer",
    }));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(mocks.rpc).toHaveBeenCalledWith("add_or_reactivate_creator_staff", {
      target_email: "staff@example.com",
      target_role: "reviewer",
      admin_confirmation: null,
    });
    await expect(response.json()).resolves.toEqual({
      staffMember: member,
      requestOutcome: "added",
    });
  });

  it("requires the exact target-specific phrase for new administrator access", async () => {
    const email = "new.admin@example.com";
    const missing = await POST(request({ email, role: "admin" }));
    expect(missing.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();

    const incorrect = await POST(request({
      email,
      role: "admin",
      confirmation: "GRANT ADMIN ACCESS",
    }));
    expect(incorrect.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();

    mocks.rpc.mockResolvedValueOnce({
      data: {
        staffMember: { ...member, email, role: "admin" },
        requestOutcome: "added",
      },
      error: null,
    });
    const confirmation = adminStaffGrantConfirmation(email);
    const response = await POST(request({ email, role: "admin", confirmation }));
    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("add_or_reactivate_creator_staff", {
      target_email: email,
      target_role: "admin",
      admin_confirmation: confirmation,
    });
  });

  it("rejects browser-owned fields and invalid roles before reading the session", async () => {
    for (const body of [
      { email: "staff@example.com", role: "owner" },
      { email: "staff@example.com", role: "admin", active: false },
      { email: "not-an-email", role: "reviewer" },
    ]) {
      const response = await POST(request(body));
      expect(response.status).toBe(400);
    }
    expect(mocks.getClaims).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("enforces JSON, exact origin, header bounds, and measured body bounds", async () => {
    const wrongType = await POST(request({ email: member.email, role: member.role }, {
      contentType: "text/plain",
    }));
    expect(wrongType.status).toBe(415);

    const crossOrigin = await POST(request({ email: member.email, role: member.role }, {
      origin: "https://attacker.example",
    }));
    expect(crossOrigin.status).toBe(403);

    const missingOrigin = await POST(request({ email: member.email, role: member.role }, {
      origin: null,
    }));
    expect(missingOrigin.status).toBe(403);
    expect(await missingOrigin.json()).toEqual({ error: "A same-origin browser request is required." });

    const oversizedHeader = await POST(request({ email: member.email, role: member.role }, {
      contentLength: "4097",
    }));
    expect(oversizedHeader.status).toBe(413);

    const oversizedBody = await POST(request(JSON.stringify({
      email: member.email,
      role: member.role,
      padding: "x".repeat(4_096),
    })));
    expect(oversizedBody.status).toBe(413);

    expect(mocks.getClaims).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("requires a signed-in account before the privileged RPC", async () => {
    mocks.getClaims.mockResolvedValue({ data: { claims: null }, error: new Error("expired") });
    const response = await POST(request({ email: member.email, role: member.role }));
    expect(response.status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["42501", 403, /administrator access/i],
    ["P0002", 404, /existing confirmed/i],
    ["55000", 409, /does not change roles/i],
    ["22023", 422, /exact confirmation phrase/i],
    ["XX000", 503, /no access change is being claimed/i],
  ])("maps safe RPC code %s to HTTP %i", async (code, status, message) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code } });
    const response = await POST(request({ email: member.email, role: member.role }));
    expect(response.status).toBe(status);
    expect((await response.json()).error).toMatch(message);
  });

  it("fails closed when a successful RPC response is incomplete", async () => {
    mocks.rpc.mockResolvedValue({
      data: {
        staffMember: { ...member, emailConfirmed: "yes" },
        requestOutcome: "added",
        authProvider: "must-not-leak",
      },
      error: null,
    });
    const response = await POST(request({ email: member.email, role: member.role }));
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.error).toMatch(/verified response was incomplete/i);
    expect(JSON.stringify(body)).not.toContain("must-not-leak");
  });

  it("fails closed when a successful RPC response names a different account or role", async () => {
    for (const staffMember of [
      { ...member, email: "different@example.com" },
      { ...member, role: "admin" },
      { ...member, active: false },
      { ...member, emailConfirmed: false },
    ]) {
      mocks.rpc.mockResolvedValueOnce({
        data: { staffMember, requestOutcome: "added" },
        error: null,
      });
      const response = await POST(request({ email: member.email, role: member.role }));
      expect(response.status).toBe(503);
    }
  });
});
