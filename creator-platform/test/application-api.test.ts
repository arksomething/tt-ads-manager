import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/applications/route";

const mocks = vi.hoisted(() => ({
  getClaims: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@/lib/server-env", () => ({
  hasSupabaseAuthEnv: () => true,
}));

vi.mock("@/lib/supabase/server", () => ({
  createRouteHandlerClient: () => ({
    auth: { getClaims: mocks.getClaims },
    rpc: mocks.rpc,
  }),
}));

const application = {
  name: "Dylan Smith",
  phoneNumber: "+1 555 555 0123",
  discordUsername: "dylan",
  accounts: [{ platform: "TIKTOK", handle: "@dylan.grows" }],
};

const normalizedApplication = {
  ...application,
  phoneNumber: "+15555550123",
};

function requestFor(body: unknown, extraHeaders?: Record<string, string>) {
  return new NextRequest("https://gotall-creator-platform.vercel.app/api/applications", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://gotall-creator-platform.vercel.app",
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });
}

describe("creator application API", () => {
  beforeEach(() => {
    mocks.getClaims.mockReset();
    mocks.rpc.mockReset();
  });

  it("derives account identity from the session and submits only validated application input", async () => {
    mocks.getClaims.mockResolvedValue({
      data: { claims: { sub: "account-1", email: "dylan@example.com" } },
      error: null,
    });
    mocks.rpc.mockResolvedValue({
      data: [{ application_id: "application-1", status: "submitted" }],
      error: null,
    });

    const response = await POST(requestFor({
      ...application,
      userId: "attacker-selected-user",
      status: "approved",
      dealId: "attacker-selected-deal",
    }));

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      applicationId: "application-1",
      status: "submitted",
    });
    expect(mocks.rpc).toHaveBeenCalledWith("submit_creator_application", {
      application_input: normalizedApplication,
    });
  });

  it("rejects unsigned sessions before invoking the submission RPC", async () => {
    mocks.getClaims.mockResolvedValue({ data: { claims: null }, error: new Error("expired") });

    const response = await POST(requestFor(application));

    expect(response.status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("rejects cross-origin and invalid application requests", async () => {
    const crossOrigin = await POST(requestFor(application, { Origin: "https://attacker.example" }));
    expect(crossOrigin.status).toBe(403);
    expect(mocks.getClaims).not.toHaveBeenCalled();

    const invalid = await POST(requestFor({ ...application, phoneNumber: "123" }));
    expect(invalid.status).toBe(400);
    expect(mocks.getClaims).not.toHaveBeenCalled();
  });

  it.each([
    ["23505", 409, /already connected/i],
    ["22023", 400, /check the application details/i],
    ["42501", 403, /not allowed/i],
  ])("maps safe RPC code %s to HTTP %i", async (code, status, message) => {
    mocks.getClaims.mockResolvedValue({
      data: { claims: { sub: "account-1", email: "dylan@example.com" } },
      error: null,
    });
    mocks.rpc.mockResolvedValue({ data: null, error: { code } });

    const response = await POST(requestFor(application));

    expect(response.status).toBe(status);
    const body = await response.json();
    expect(body.error).toMatch(message);
  });
});
