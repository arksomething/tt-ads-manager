import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/content-submissions/route";

const mocks = vi.hoisted(() => ({ getClaims: vi.fn(), rpc: vi.fn() }));

vi.mock("@/lib/server-env", () => ({ hasSupabaseAuthEnv: () => true }));
vi.mock("@/lib/supabase/server", () => ({
  createRouteHandlerClient: () => ({
    auth: { getClaims: mocks.getClaims },
    rpc: mocks.rpc,
  }),
}));

function requestFor(body: unknown, origin = "https://gotall-creator-platform.vercel.app") {
  return new NextRequest("https://gotall-creator-platform.vercel.app/api/content-submissions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify(body),
  });
}

const submission = {
  platform: "TIKTOK",
  url: "https://www.tiktok.com/@creator/video/123",
  nativePostId: "123",
};

describe("content submission API", () => {
  beforeEach(() => {
    mocks.getClaims.mockReset();
    mocks.rpc.mockReset();
  });

  it("derives creator identity from auth and invokes the guarded RPC", async () => {
    mocks.getClaims.mockResolvedValue({ data: { claims: { sub: "creator-1" } }, error: null });
    mocks.rpc.mockResolvedValue({
      data: [{ submission_id: "submission-1", match_state: "submitted" }],
      error: null,
    });

    const response = await POST(requestFor({
      ...submission,
      accountId: "attacker-account",
      matchState: "matched",
      earnings: 9999,
    }));

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      submissionId: "submission-1",
      matchState: "submitted",
    });
    expect(mocks.rpc).toHaveBeenCalledWith("submit_creator_content", {
      content_input: submission,
    });
  });

  it("rejects invalid, cross-origin, and unsigned requests before writing", async () => {
    expect((await POST(requestFor(submission, "https://attacker.example"))).status).toBe(403);
    expect((await POST(requestFor({ ...submission, url: "https://instagram.com/reel/1" }))).status).toBe(400);
    expect(mocks.getClaims).not.toHaveBeenCalled();

    mocks.getClaims.mockResolvedValue({ data: { claims: null }, error: { message: "expired" } });
    expect((await POST(requestFor(submission))).status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["23505", "duplicate", 409, /already been submitted/i],
    ["22023", "invalid", 400, /check the post details/i],
    ["42501", "An active creator enrollment is required.", 403, /enrollment is active/i],
  ])("maps safe RPC failure %s", async (code, message, status, expected) => {
    mocks.getClaims.mockResolvedValue({ data: { claims: { sub: "creator-1" } }, error: null });
    mocks.rpc.mockResolvedValue({ data: null, error: { code, message } });
    const response = await POST(requestFor(submission));
    expect(response.status).toBe(status);
    expect((await response.json()).error).toMatch(expected);
  });
});
