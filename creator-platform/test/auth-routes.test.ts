import { NextRequest, type NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST as forgotPassword } from "@/app/api/auth/forgot-password/route";
import { POST as resetPassword } from "@/app/api/auth/reset-password/route";
import { POST as signUp } from "@/app/api/auth/sign-up/route";
import { GET as confirmAuth } from "@/app/auth/confirm/route";
import { getAppOrigin } from "@/lib/server-env";
import {
  parsePasswordRecoveryProof,
  passwordRecoveryCookieName,
  serializePasswordRecoveryProof,
} from "@/server/auth/recovery";

const mocks = vi.hoisted(() => ({
  authResponse: null as NextResponse | null,
  exchangeCodeForSession: vi.fn(),
  resetPasswordForEmail: vi.fn(),
  signUp: vi.fn(),
  updateUser: vi.fn(),
  verifyOtp: vi.fn(),
}));

vi.mock("@/lib/supabase/server", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/lib/supabase/server")
  >();

  return {
    ...actual,
    createRouteHandlerClient: (_request: NextRequest, response: NextResponse) => {
      mocks.authResponse = response;
      return {
        auth: {
          exchangeCodeForSession: mocks.exchangeCodeForSession,
          resetPasswordForEmail: mocks.resetPasswordForEmail,
          signUp: mocks.signUp,
          updateUser: mocks.updateUser,
          verifyOtp: mocks.verifyOtp,
        },
      };
    },
  };
});

function formRequest(
  pathname: string,
  values: Record<string, string>,
  origin = "https://untrusted-proxy.example",
  headers: Record<string, string> = {},
) {
  return new NextRequest(new URL(pathname, origin), {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      ...headers,
    },
    body: new URLSearchParams(values),
  });
}

function resetRequest(cookie?: string) {
  return formRequest(
    "/api/auth/reset-password",
    {
      password: "a secure password",
      passwordConfirm: "a secure password",
    },
    "https://untrusted-proxy.example",
    cookie ? { cookie } : {},
  );
}

describe("creator auth routes", () => {
  beforeEach(() => {
    vi.stubEnv("APP_ORIGIN", "https://creators.gotall.com");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "publishable-key");

    mocks.authResponse = null;
    mocks.exchangeCodeForSession.mockReset();
    mocks.resetPasswordForEmail.mockReset();
    mocks.signUp.mockReset();
    mocks.updateUser.mockReset();
    mocks.verifyOtp.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("preserves the Supabase PKCE verifier cookie on the email-confirmation redirect", async () => {
    mocks.signUp.mockImplementation(async () => {
      mocks.authResponse?.cookies.set("sb-test-code-verifier", "pkce-verifier", {
        httpOnly: true,
        path: "/",
      });
      mocks.authResponse?.headers.set(
        "Cache-Control",
        "private, no-cache, no-store, must-revalidate, max-age=0",
      );
      return { data: { session: null }, error: null };
    });

    const response = await signUp(
      formRequest("/api/auth/sign-up", {
        email: "creator@example.com",
        password: "a secure password",
        passwordConfirm: "a secure password",
        next: "/apply",
      }),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toContain("/auth/sign-in?");
    expect(response.cookies.get("sb-test-code-verifier")?.value).toBe(
      "pkce-verifier",
    );
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocks.signUp).toHaveBeenCalledWith({
      email: "creator@example.com",
      password: "a secure password",
      options: {
        emailRedirectTo:
          "https://creators.gotall.com/auth/confirm?next=%2Fapply",
      },
    });
  });

  it("uses APP_ORIGIN for password-recovery callbacks instead of the request host", async () => {
    mocks.resetPasswordForEmail.mockResolvedValue({ data: {}, error: null });

    await forgotPassword(
      formRequest("/api/auth/forgot-password", {
        email: "creator@example.com",
      }),
    );

    expect(mocks.resetPasswordForEmail).toHaveBeenCalledWith(
      "creator@example.com",
      {
        redirectTo:
          "https://creators.gotall.com/auth/confirm?next=%2Fauth%2Freset-password",
      },
    );
  });

  it("allows request-origin fallback only for loopback development URLs", () => {
    vi.stubEnv("APP_ORIGIN", "");

    expect(getAppOrigin("http://localhost:3000/auth/sign-up")).toBe(
      "http://localhost:3000",
    );
    expect(() => getAppOrigin("https://attacker.example/auth/sign-up")).toThrow(
      /APP_ORIGIN is required/i,
    );

    vi.stubEnv("APP_ORIGIN", "https://creators.gotall.com/not-an-origin");
    expect(() => getAppOrigin("http://localhost:3000")).toThrow(
      /without a path/i,
    );
  });

  it("moves a recovery code into a short-lived HttpOnly cookie without consuming it", async () => {
    const response = await confirmAuth(
      new NextRequest(
        "https://creators.gotall.com/auth/confirm?code=recovery-code&next=%2Fauth%2Freset-password&sb_flow_id=flow-id-123",
      ),
    );

    const cookie = response.cookies.get(passwordRecoveryCookieName);
    expect(response.headers.get("location")).toBe(
      "https://creators.gotall.com/auth/reset-password",
    );
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe("lax");
    expect(parsePasswordRecoveryProof(cookie?.value)).toEqual({
      method: "pkce",
      credential: "recovery-code",
      flowId: "flow-id-123",
    });
    expect(mocks.exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it("does not let an ordinary signed-in session reset a password without recovery proof", async () => {
    const response = await resetPassword(resetRequest());

    expect(response.headers.get("location")).toContain("/auth/forgot-password?");
    expect(mocks.exchangeCodeForSession).not.toHaveBeenCalled();
    expect(mocks.verifyOtp).not.toHaveBeenCalled();
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it("rejects a well-formed but forged recovery cookie after server verification", async () => {
    mocks.exchangeCodeForSession.mockResolvedValue({
      data: { session: null, user: null, redirectType: null },
      error: new Error("invalid recovery code"),
    });
    const forgedProof = serializePasswordRecoveryProof({
      method: "pkce",
      credential: "attacker-created-code",
      flowId: null,
    });
    const response = await resetPassword(
      resetRequest(`${passwordRecoveryCookieName}=${forgedProof}`),
    );

    expect(response.headers.get("location")).toContain("/auth/forgot-password?");
    expect(mocks.exchangeCodeForSession).toHaveBeenCalledWith(
      "attacker-created-code",
      undefined,
    );
    expect(mocks.verifyOtp).not.toHaveBeenCalled();
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it("rejects a valid non-recovery PKCE exchange before updating the password", async () => {
    mocks.exchangeCodeForSession.mockResolvedValue({
      data: {
        session: { access_token: "token" },
        user: { id: "creator-1" },
        redirectType: null,
      },
      error: null,
    });
    const proof = serializePasswordRecoveryProof({
      method: "pkce",
      credential: "confirmation-code",
      flowId: null,
    });

    const response = await resetPassword(
      resetRequest(`${passwordRecoveryCookieName}=${proof}`),
    );

    expect(response.headers.get("location")).toContain("/auth/forgot-password?");
    expect(mocks.updateUser).not.toHaveBeenCalled();
    expect(response.cookies.get(passwordRecoveryCookieName)?.value).toBe("");
  });

  it("updates the password only after Supabase verifies a recovery exchange", async () => {
    mocks.exchangeCodeForSession.mockResolvedValue({
      data: {
        session: { access_token: "token" },
        user: { id: "creator-1" },
        redirectType: "recovery",
      },
      error: null,
    });
    mocks.updateUser.mockResolvedValue({ data: {}, error: null });
    const proof = serializePasswordRecoveryProof({
      method: "pkce",
      credential: "recovery-code",
      flowId: "flow-id-123",
    });

    const response = await resetPassword(
      resetRequest(`${passwordRecoveryCookieName}=${proof}`),
    );

    expect(mocks.exchangeCodeForSession).toHaveBeenCalledWith(
      "recovery-code",
      { flowId: "flow-id-123" },
    );
    expect(mocks.updateUser).toHaveBeenCalledWith({
      password: "a secure password",
    });
    expect(response.headers.get("location")).toContain("/account?notice=");
    expect(response.cookies.get(passwordRecoveryCookieName)?.value).toBe("");
  });
});
