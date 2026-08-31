export type DiscordOAuthConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  guildId: string;
};

export function getDiscordGuildInviteUrl() {
  const value = process.env.DISCORD_GUILD_INVITE_URL?.trim();
  if (!value) return null;

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("DISCORD_GUILD_INVITE_URL must be an absolute Discord invite URL.");
  }
  const supportedHost = url.hostname === "discord.gg" || url.hostname === "discord.com";
  const supportedPath = url.hostname === "discord.gg"
    ? /^\/[A-Za-z0-9-]+\/?$/u.test(url.pathname)
    : /^\/invite\/[A-Za-z0-9-]+\/?$/u.test(url.pathname);
  if (
    url.protocol !== "https:" || !supportedHost || !supportedPath ||
    url.username || url.password || url.search || url.hash
  ) {
    throw new Error("DISCORD_GUILD_INVITE_URL must be a clean Discord invite URL.");
  }
  return url.toString();
}

function requiredSecret(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function parseSnowflake(name: string, value: string) {
  if (!/^\d{17,20}$/.test(value)) {
    throw new Error(`${name} must be a Discord snowflake.`);
  }
  return value;
}

function isLoopbackHostname(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

function parseRedirectUri(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("DISCORD_OAUTH_REDIRECT_URI must be an absolute URL.");
  }

  const localHttp = url.protocol === "http:" && isLoopbackHostname(url.hostname);
  if (
    (url.protocol !== "https:" && !localHttp) ||
    url.username ||
    url.password ||
    url.hash
  ) {
    throw new Error(
      "DISCORD_OAUTH_REDIRECT_URI must be an HTTPS URL without credentials or a fragment.",
    );
  }

  return url.toString();
}

export function getDiscordOAuthConfig(): DiscordOAuthConfig {
  const clientId = parseSnowflake(
    "DISCORD_CLIENT_ID",
    requiredSecret("DISCORD_CLIENT_ID"),
  );
  const clientSecret = requiredSecret("DISCORD_CLIENT_SECRET");
  const redirectUri = parseRedirectUri(
    requiredSecret("DISCORD_OAUTH_REDIRECT_URI"),
  );
  const guildId = parseSnowflake(
    "DISCORD_GUILD_ID",
    requiredSecret("DISCORD_GUILD_ID"),
  );

  if (clientSecret.length < 16) {
    throw new Error("DISCORD_CLIENT_SECRET is not valid.");
  }

  return { clientId, clientSecret, redirectUri, guildId };
}
