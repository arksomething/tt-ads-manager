import type { DiscordOAuthConfig } from "@/lib/discord/config";

const discordApiOrigin = "https://discord.com";

type DiscordToken = {
  accessToken: string;
};

export type DiscordIdentity = {
  id: string;
  username: string;
  global_name: string | null;
  avatar: string | null;
  guild_id: string;
};

export type DiscordMembershipStatus = "member" | "not_member";

function recordValue(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function requiredString(record: Record<string, unknown>, key: string) {
  const value = record[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("Discord returned an invalid response.");
  }
  return value.trim();
}

function nullableString(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

async function responseJson(response: Response) {
  try {
    return await response.json() as unknown;
  } catch {
    throw new Error("Discord returned an invalid response.");
  }
}

export function buildDiscordAuthorizationUrl(
  config: DiscordOAuthConfig,
  state: string,
) {
  const url = new URL("/oauth2/authorize", discordApiOrigin);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("scope", "identify guilds.members.read");
  url.searchParams.set("state", state);
  return url;
}

export async function exchangeDiscordAuthorizationCode(
  config: DiscordOAuthConfig,
  code: string,
): Promise<DiscordToken> {
  const response = await fetch(`${discordApiOrigin}/api/v10/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: "authorization_code",
      code,
      redirect_uri: config.redirectUri,
    }),
    cache: "no-store",
  });

  if (!response.ok) throw new Error("Discord authorization failed.");
  const body = recordValue(await responseJson(response));
  if (!body) throw new Error("Discord returned an invalid response.");

  const accessToken = requiredString(body, "access_token");
  const tokenType = requiredString(body, "token_type");
  if (tokenType.toLowerCase() !== "bearer") {
    throw new Error("Discord returned an invalid response.");
  }

  return { accessToken };
}

export async function fetchDiscordIdentity(
  config: DiscordOAuthConfig,
  accessToken: string,
): Promise<DiscordIdentity> {
  const response = await fetch(`${discordApiOrigin}/api/v10/users/@me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });

  if (!response.ok) throw new Error("Discord identity verification failed.");
  const body = recordValue(await responseJson(response));
  if (!body) throw new Error("Discord returned an invalid response.");

  const id = requiredString(body, "id");
  if (!/^\d{17,20}$/.test(id)) {
    throw new Error("Discord returned an invalid response.");
  }

  return {
    id,
    username: requiredString(body, "username"),
    global_name: nullableString(body, "global_name"),
    avatar: nullableString(body, "avatar"),
    guild_id: config.guildId,
  };
}

export async function fetchDiscordMembershipStatus(
  config: DiscordOAuthConfig,
  accessToken: string,
): Promise<DiscordMembershipStatus> {
  const response = await fetch(
    `${discordApiOrigin}/api/v10/users/@me/guilds/${config.guildId}/member`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    },
  );

  if (response.status === 404) return "not_member";
  if (!response.ok) throw new Error("Discord membership verification failed.");

  // Parse the body so an intermediary's non-JSON success page cannot be
  // mistaken for verified guild membership.
  if (!recordValue(await responseJson(response))) {
    throw new Error("Discord returned an invalid response.");
  }
  return "member";
}

export async function revokeDiscordAccessToken(
  config: DiscordOAuthConfig,
  accessToken: string,
) {
  try {
    await fetch(`${discordApiOrigin}/api/v10/oauth2/token/revoke`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        token: accessToken,
        token_type_hint: "access_token",
      }),
      cache: "no-store",
    });
  } catch {
    // The identity is already verified and no token is retained. Revocation is
    // deliberately best effort so a Discord outage cannot make the callback
    // replayable or erase the verified connection.
  }
}
