import { NextRequest, type NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST as savePreferences } from "@/app/api/integrations/discord/preferences/route";
import { POST as sendTest } from "@/app/api/integrations/discord/test/route";

const mocks = vi.hoisted(() => ({
  adminRpc: vi.fn(),
  authResponse: null as NextResponse | null,
  getClaims: vi.fn(),
  userRpc: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ rpc: mocks.adminRpc }),
}));

vi.mock("@/lib/supabase/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase/server")>();
  return {
    ...actual,
    createRouteHandlerClient: (_request: NextRequest, response: NextResponse) => {
      mocks.authResponse = response;
      return {
        auth: { getClaims: mocks.getClaims },
        rpc: mocks.userRpc,
      };
    },
  };
});

const appOrigin = "https://gotall-creator-platform.vercel.app";
const accountId = "6d0c2d65-478f-4075-a08c-04c7bf397347";

function formRequest(path: string, form: FormData, includeOrigin = true) {
  return new NextRequest(new URL(path, appOrigin), {
    method: "POST",
    headers: includeOrigin ? { Origin: appOrigin } : undefined,
    body: form,
  });
}

function preferenceForm() {
  const form = new FormData();
  form.set("dmOptIn", "on");
  form.set("timezone", "America/New_York");
  form.set("quietHoursStart", "21:00");
  form.set("quietHoursEnd", "09:00");
  for (const topic of ["Account", "Onboarding", "Posting", "Performance", "Payments"]) {
    form.set(`topic${topic}`, "on");
  }
  return form;
}

describe("creator Discord preference actions", () => {
  beforeEach(() => {
    vi.stubEnv("APP_ORIGIN", appOrigin);
    mocks.adminRpc.mockReset();
    mocks.getClaims.mockReset();
    mocks.userRpc.mockReset();
    mocks.getClaims.mockResolvedValue({
      data: { claims: { sub: accountId } },
      error: null,
    });
  });

  afterEach(() => vi.unstubAllEnvs());

  it("saves explicit consent and fail-closed topic preferences", async () => {
    mocks.userRpc.mockResolvedValue({ data: [{}], error: null });
    const response = await savePreferences(
      formRequest("/api/integrations/discord/preferences", preferenceForm()),
    );
    expect(response.status).toBe(303);
    expect(new URL(response.headers.get("location")!).searchParams.get("notice")).toMatch(/saved/i);
    expect(mocks.userRpc).toHaveBeenCalledWith("set_creator_discord_preferences", {
      preference_input: {
        discord_opt_in: true,
        timezone: "America/New_York",
        quiet_start: "21:00",
        quiet_end: "09:00",
        topics: {
          account: true,
          onboarding: true,
          posting: false,
          performance: false,
          payments: true,
        },
      },
    });
  });

  it("requires the canonical browser origin", async () => {
    const response = await savePreferences(
      formRequest("/api/integrations/discord/preferences", preferenceForm(), false),
    );
    expect(response.status).toBe(303);
    expect(new URL(response.headers.get("location")!).searchParams.get("error")).toMatch(/origin/i);
    expect(mocks.userRpc).not.toHaveBeenCalled();
  });

  it("uses the atomic server-enforced creator test enqueue", async () => {
    mocks.adminRpc.mockResolvedValue({
      data: [{ delivery_id: "delivery-1", delivery_state: "scheduled" }],
      error: null,
    });
    const response = await sendTest(
      formRequest("/api/integrations/discord/test", new FormData()),
    );
    expect(response.status).toBe(303);
    expect(new URL(response.headers.get("location")!).searchParams.get("notice")).toMatch(/queued/i);
    expect(mocks.adminRpc).toHaveBeenCalledWith("enqueue_creator_discord_test", {
      target_account_id: accountId,
    });
    expect(JSON.stringify(mocks.adminRpc.mock.calls[0])).not.toContain("content");
  });

  it.each([
    ["sent", /already accepted by Discord this hour/i],
    ["cancelled", /no new test was queued/i],
    ["delivery_unknown", /needs review/i],
  ])("reports the existing %s test state without claiming a new queue", async (state, message) => {
    mocks.adminRpc.mockResolvedValue({
      data: [{ delivery_id: "delivery-1", delivery_state: state }],
      error: null,
    });
    const response = await sendTest(
      formRequest("/api/integrations/discord/test", new FormData()),
    );
    expect(response.status).toBe(303);
    expect(new URL(response.headers.get("location")!).searchParams.get("notice")).toMatch(message);
  });

  it("fails closed when the database does not return a recognized test state", async () => {
    mocks.adminRpc.mockResolvedValue({ data: [{ delivery_id: "delivery-1" }], error: null });
    const response = await sendTest(
      formRequest("/api/integrations/discord/test", new FormData()),
    );
    expect(response.status).toBe(303);
    expect(new URL(response.headers.get("location")!).searchParams.get("error")).toMatch(/could not confirm/i);
  });
});
