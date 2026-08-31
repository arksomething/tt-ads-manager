import { createHash, randomBytes } from "node:crypto";

const statePattern = /^[A-Za-z0-9_-]{43}$/;
const discordAccountPath = "/account/discord";

export function createDiscordOAuthState() {
  return randomBytes(32).toString("base64url");
}

export function isDiscordOAuthState(value: string | null | undefined) {
  return Boolean(value && statePattern.test(value));
}

export function hashDiscordOAuthState(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function sanitizeDiscordReturnPath(value: string | null | undefined) {
  return value === discordAccountPath ? value : discordAccountPath;
}
