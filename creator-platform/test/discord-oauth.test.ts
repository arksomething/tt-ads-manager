import { NextRequest, type NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET as discordCallback } from "@/app/api/integrations/discord/callback/route";
import { POST as disconnectDiscord } from "@/app/api/integrations/discord/disconnect/route";
import { GET as startDiscord } from "@/app/api/integrations/discord/start/route";
import { getDiscordGuildInviteUrl } from "@/lib/discord/config";
import {
  createDiscordOAuthState,
  hashDiscordOAuthState,
} from "@/server/discord/state";

const mocks = vi.hoisted(() => ({
  adminRpc: vi.fn(),
  authResponse: null as NextResponse | null,
  fetch: vi.fn(),
  getUser: vi.fn(),
  userRpc: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ rpc: mocks.adminRpc }),
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
        auth: { getUser: mocks.getUser },
        rpc: mocks.userRpc,
      };
    },
  };
});

const appOrigin = "https://creators.gotall.com";
const discordRedirect =
  "https://gethyperspeed.com/api/integrations/discord/callback";
const accountId = "6d0c2d65-478f-4075-a08c-04c7bf397347";

function creatorRequest(
  path: string,
  init?: ConstructorParameters<typeof NextRequest>[1],
) {
  return new NextRequest(new URL(path, appOrigin), init);
}

function callbackAttempt(returnPath = "/account/discord") {
  return {
    data: [{ account_id: accountId, return_path: returnPath }],
    error: null,
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function mockSuccessfulDiscordProvider() {
  mocks.fetch
    .mockResolvedValueOnce(
      jsonResponse({
        access_token: "temporary-access-token",
        refresh_token: "temporary-refresh-token",
        token_type: "Bearer",
      }),
    )
    .mockResolvedValueOnce(
      jsonResponse({
        id: "571179674323910667",
        username: "creator_name",
        global_name: "Creator Name",
        avatar: "avatar-hash",
      }),
    )
    .mockResolvedValueOnce(jsonResponse({ roles: [] }))
    .mockResolvedValueOnce(new Response(null, { status: 200 }));
}

describe("creator Discord OAuth", () => {
  beforeEach(() => {
    vi.stubEnv("APP_ORIGIN", appOrigin);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "publishable-key");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-key-with-safe-length");
    vi.stubEnv("DISCORD_CLIENT_ID", "1534630446959427686");
    vi.stubEnv("DISCORD_CLIENT_SECRET", "discord-client-secret-for-tests");
    vi.stubEnv("DISCORD_OAUTH_REDIRECT_URI", discordRedirect);
    vi.stubEnv("DISCORD_GUILD_ID", "1400610531189985310");

    mocks.adminRpc.mockReset();
    mocks.authResponse = null;
    mocks.fetch.mockReset();
    mocks.getUser.mockReset();
    mocks.userRpc.mockReset();
    vi.stubGlobal("fetch", mocks.fetch);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("requires a signed-in creator before creating an OAuth attempt", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: null },
      error: new Error("expired session"),
    });

    const response = await startDiscord(
      creatorRequest("/api/integrations/discord/start?returnTo=%2Faccount%2Fdiscord"),
    );

    expect(response.status).toBe(303);
    const location = new URL(response.headers.get("location")!);
    expect(location.pathname).toBe("/auth/sign-in");
    expect(location.searchParams.get("next")).toBe("/account/discord");
    expect(mocks.userRpc).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("requires a confirmed email before creating an OAuth attempt", async () => {
    mocks.getUser.mockResolvedValue({
      data: {
        user: {
          id: accountId,
          email: "creator@example.com",
          email_confirmed_at: null,
        },
      },
      error: null,
    });

    const response = await startDiscord(
      creatorRequest("/api/integrations/discord/start"),
    );

    expect(response.status).toBe(303);
    expect(new URL(response.headers.get("location")!).pathname).toBe(
      "/auth/check-email",
    );
    expect(mocks.userRpc).not.toHaveBeenCalled();
  });

  it("uses exact minimal scopes, an exact registered redirect, and only a state hash at rest", async () => {
    mocks.getUser.mockResolvedValue({
      data: {
        user: {
          id: accountId,
          email: "creator@example.com",
          email_confirmed_at: "2026-08-31T12:00:00.000Z",
        },
      },
      error: null,
    });
    mocks.userRpc.mockResolvedValue({ data: [{ attempt_id: "attempt-1" }], error: null });

    const response = await startDiscord(
      creatorRequest("/api/integrations/discord/start?returnTo=%2Faccount%2Fdiscord"),
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    const authorization = new URL(response.headers.get("location")!);
    const state = authorization.searchParams.get("state")!;
    expect(`${authorization.origin}${authorization.pathname}`).toBe(
      "https://discord.com/oauth2/authorize",
    );
    expect(authorization.searchParams.get("client_id")).toBe(
      "1534630446959427686",
    );
    expect(authorization.searchParams.get("response_type")).toBe("code");
    expect(authorization.searchParams.get("redirect_uri")).toBe(discordRedirect);
    expect(authorization.searchParams.get("scope")).toBe(
      "identify guilds.members.read",
    );
    expect(response.headers.get("location")).not.toContain(
      "discord-client-secret-for-tests",
    );
    expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const [, args] = mocks.userRpc.mock.calls[0];
    expect(mocks.userRpc).toHaveBeenCalledWith(
      "create_discord_oauth_attempt",
      expect.objectContaining({
        state_hash: hashDiscordOAuthState(state),
        return_path: "/account/discord",
      }),
    );
    expect(JSON.stringify(args)).not.toContain(state);
    const expiry = Date.parse(args.expires_at);
    expect(expiry).toBeGreaterThan(Date.now() + 9 * 60 * 1_000);
    expect(expiry).toBeLessThanOrEqual(Date.now() + 10 * 60 * 1_000);
  });

  it("generates independent 256-bit OAuth states", () => {
    const first = createDiscordOAuthState();
    const second = createDiscordOAuthState();

    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(second).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(second).not.toBe(first);
    expect(hashDiscordOAuthState(first)).toMatch(/^[a-f0-9]{64}$/);
  });

  it("accepts only clean first-party Discord invite URLs", () => {
    vi.stubEnv("DISCORD_GUILD_INVITE_URL", "https://discord.gg/tTYXKu4kDj");
    expect(getDiscordGuildInviteUrl()).toBe("https://discord.gg/tTYXKu4kDj");

    vi.stubEnv("DISCORD_GUILD_INVITE_URL", "https://attacker.example/invite/test");
    expect(() => getDiscordGuildInviteUrl()).toThrow(/Discord invite URL/i);
  });

  it("does not store an attacker-selected return URL", async () => {
    mocks.getUser.mockResolvedValue({
      data: {
        user: {
          id: accountId,
          email: "creator@example.com",
          email_confirmed_at: "2026-08-31T12:00:00.000Z",
        },
      },
      error: null,
    });
    mocks.userRpc.mockResolvedValue({ data: [], error: null });

    await startDiscord(
      creatorRequest(
        "/api/integrations/discord/start?returnTo=https%3A%2F%2Fattacker.example%2Fsteal",
      ),
    );

    expect(mocks.userRpc.mock.calls[0][1].return_path).toBe("/account/discord");
  });

  it("rejects a missing or malformed callback state before touching Discord", async () => {
    const missing = await discordCallback(
      creatorRequest("/api/integrations/discord/callback?code=provider-code"),
    );
    const malformed = await discordCallback(
      creatorRequest(
        "/api/integrations/discord/callback?code=provider-code&state=not-valid",
      ),
    );

    expect(missing.status).toBe(303);
    expect(malformed.status).toBe(303);
    expect(mocks.adminRpc).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("rejects an expired attempt before exchanging a provider code", async () => {
    const state = createDiscordOAuthState();
    mocks.adminRpc.mockResolvedValue({ data: [], error: null });

    const response = await discordCallback(
      creatorRequest(
        `/api/integrations/discord/callback?code=provider-code&state=${state}`,
      ),
    );

    expect(response.headers.get("location")).toContain("invalid+or+has+expired");
    expect(mocks.adminRpc).toHaveBeenCalledWith(
      "consume_discord_oauth_attempt",
      { hash: hashDiscordOAuthState(state) },
    );
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("consumes a denied attempt and rejects its replay before exchanging a code", async () => {
    const state = createDiscordOAuthState();
    mocks.adminRpc
      .mockResolvedValueOnce(callbackAttempt())
      .mockResolvedValueOnce({ data: [], error: null });

    const denied = await discordCallback(
      creatorRequest(
        `/api/integrations/discord/callback?error=access_denied&state=${state}`,
      ),
    );
    const replay = await discordCallback(
      creatorRequest(
        `/api/integrations/discord/callback?code=provider-code&state=${state}`,
      ),
    );

    expect(denied.headers.get("location")).toContain("cancelled");
    expect(replay.headers.get("location")).toContain("expired");
    expect(mocks.adminRpc).toHaveBeenCalledTimes(2);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("consumes state before exchange, verifies identity and membership, and never persists OAuth tokens", async () => {
    const state = createDiscordOAuthState();
    mocks.adminRpc.mockImplementation(async (name: string) => {
      if (name === "consume_discord_oauth_attempt") return callbackAttempt();
      return { data: [{ connection_id: "connection-1" }], error: null };
    });
    mockSuccessfulDiscordProvider();

    const response = await discordCallback(
      creatorRequest(
        `/api/integrations/discord/callback?code=provider-code&state=${state}`,
      ),
    );

    expect(response.status).toBe(303);
    const location = new URL(response.headers.get("location")!);
    expect(location.origin).toBe(appOrigin);
    expect(location.pathname).toBe("/account/discord");
    expect(location.searchParams.get("notice")).toBe("Discord account connected.");
    expect(mocks.adminRpc.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.fetch.mock.invocationCallOrder[0],
    );

    const upsertCall = mocks.adminRpc.mock.calls.find(
      ([name]) => name === "upsert_creator_discord_connection",
    );
    expect(upsertCall).toEqual([
      "upsert_creator_discord_connection",
      {
        account_id: accountId,
        identity: {
          id: "571179674323910667",
          username: "creator_name",
          global_name: "Creator Name",
          avatar: "avatar-hash",
          guild_id: "1400610531189985310",
        },
        membership_status: "member",
      },
    ]);
    expect(JSON.stringify(upsertCall)).not.toContain("temporary-access-token");
    expect(JSON.stringify(upsertCall)).not.toContain("temporary-refresh-token");

    const tokenRequest = mocks.fetch.mock.calls[0][1] as RequestInit;
    expect(String(tokenRequest.body)).toContain(
      `redirect_uri=${encodeURIComponent(discordRedirect)}`,
    );
    expect(mocks.fetch.mock.calls.at(-1)?.[0]).toBe(
      "https://discord.com/api/v10/oauth2/token/revoke",
    );
  });

  it("falls back to the account page when stored return data is unsafe", async () => {
    const state = createDiscordOAuthState();
    mocks.adminRpc.mockResolvedValue(callbackAttempt("//attacker.example/steal"));

    const response = await discordCallback(
      creatorRequest(
        `/api/integrations/discord/callback?error=access_denied&state=${state}`,
      ),
    );

    const location = new URL(response.headers.get("location")!);
    expect(location.origin).toBe(appOrigin);
    expect(location.pathname).toBe("/account/discord");
  });

  it("records a verified identity as not a guild member when Discord returns 404", async () => {
    const state = createDiscordOAuthState();
    mocks.adminRpc.mockImplementation(async (name: string) => {
      if (name === "consume_discord_oauth_attempt") return callbackAttempt();
      return { data: [{ connection_id: "connection-1" }], error: null };
    });
    mocks.fetch
      .mockResolvedValueOnce(
        jsonResponse({
          access_token: "temporary-access-token",
          token_type: "Bearer",
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          id: "571179674323910667",
          username: "creator_name",
          global_name: null,
          avatar: null,
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));

    const response = await discordCallback(
      creatorRequest(
        `/api/integrations/discord/callback?code=provider-code&state=${state}`,
      ),
    );

    expect(response.headers.get("location")).toContain("connected");
    expect(mocks.adminRpc).toHaveBeenCalledWith(
      "upsert_creator_discord_connection",
      expect.objectContaining({ membership_status: "not_member" }),
    );
  });

  it("returns a safe duplicate-identity error and still revokes the temporary token", async () => {
    const state = createDiscordOAuthState();
    mocks.adminRpc.mockImplementation(async (name: string) => {
      if (name === "consume_discord_oauth_attempt") return callbackAttempt();
      return {
        data: null,
        error: { code: "23505", message: "raw database identity detail" },
      };
    });
    mockSuccessfulDiscordProvider();

    const response = await discordCallback(
      creatorRequest(
        `/api/integrations/discord/callback?code=provider-code&state=${state}`,
      ),
    );

    const location = response.headers.get("location")!;
    expect(location).toContain("already+linked");
    expect(location).not.toContain("raw+database");
    expect(mocks.fetch.mock.calls.at(-1)?.[0]).toBe(
      "https://discord.com/api/v10/oauth2/token/revoke",
    );
  });

  it("does not expose raw Discord token-exchange errors", async () => {
    const state = createDiscordOAuthState();
    mocks.adminRpc.mockResolvedValue(callbackAttempt());
    mocks.fetch.mockResolvedValueOnce(
      jsonResponse(
        { error: "invalid_grant", error_description: "sensitive provider detail" },
        401,
      ),
    );

    const response = await discordCallback(
      creatorRequest(
        `/api/integrations/discord/callback?code=provider-code&state=${state}`,
      ),
    );

    const location = response.headers.get("location")!;
    expect(location).toContain("could+not+verify");
    expect(location).not.toContain("sensitive+provider");
  });

  it("requires same-origin authenticated requests to disconnect", async () => {
    const crossOrigin = await disconnectDiscord(
      creatorRequest("/api/integrations/discord/disconnect", {
        method: "POST",
        headers: { Origin: "https://attacker.example" },
      }),
    );
    expect(crossOrigin.status).toBe(303);
    expect(mocks.getUser).not.toHaveBeenCalled();

    mocks.getUser.mockResolvedValue({
      data: { user: { id: accountId, email: "creator@example.com" } },
      error: null,
    });
    mocks.userRpc.mockResolvedValue({ data: null, error: null });
    const success = await disconnectDiscord(
      creatorRequest("/api/integrations/discord/disconnect", {
        method: "POST",
        headers: { Origin: appOrigin },
      }),
    );

    expect(success.status).toBe(303);
    expect(success.headers.get("location")).toContain("disconnected");
    expect(mocks.userRpc).toHaveBeenCalledWith("disconnect_creator_discord");
  });
});
