import type { NextRequest } from "next/server";

import { getDiscordOAuthConfig } from "@/lib/discord/config";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  exchangeDiscordAuthorizationCode,
  fetchDiscordIdentity,
  fetchDiscordMembershipStatus,
  revokeDiscordAccessToken,
} from "@/server/discord/oauth";
import { discordAccountRedirect } from "@/server/discord/http";
import {
  hashDiscordOAuthState,
  isDiscordOAuthState,
  sanitizeDiscordReturnPath,
} from "@/server/discord/state";

export const dynamic = "force-dynamic";

function resultRecord(value: unknown) {
  const row = Array.isArray(value) ? value[0] : value;
  return row && typeof row === "object" && !Array.isArray(row)
    ? (row as Record<string, unknown>)
    : null;
}

function recordString(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isUniqueViolation(error: unknown) {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      String((error as { code?: unknown }).code) === "23505",
  );
}

export async function GET(request: NextRequest) {
  const rawState = request.nextUrl.searchParams.get("state");
  if (!isDiscordOAuthState(rawState)) {
    return discordAccountRedirect(request, null, {
      error: "That Discord connection request is invalid or has expired.",
    });
  }

  let admin: ReturnType<typeof createAdminClient>;
  let attempt: Record<string, unknown> | null;
  try {
    admin = createAdminClient();
    const { data, error } = await admin.rpc("consume_discord_oauth_attempt", {
      hash: hashDiscordOAuthState(rawState!),
    });
    attempt = error ? null : resultRecord(data);
  } catch {
    attempt = null;
  }

  if (!attempt) {
    return discordAccountRedirect(request, null, {
      error: "That Discord connection request is invalid or has expired.",
    });
  }

  const accountId = recordString(attempt, "account_id");
  const returnPath = sanitizeDiscordReturnPath(
    recordString(attempt, "return_path"),
  );
  if (!accountId) {
    return discordAccountRedirect(request, returnPath, {
      error: "That Discord connection request is invalid or has expired.",
    });
  }

  // A provider denial still consumes the one-time state, preventing a later
  // code from being replayed against an abandoned authorization attempt.
  if (request.nextUrl.searchParams.has("error")) {
    return discordAccountRedirect(request, returnPath, {
      error: "Discord connection was cancelled.",
    });
  }

  const code = request.nextUrl.searchParams.get("code")?.trim() ?? "";
  if (!code || code.length > 2_048) {
    return discordAccountRedirect(request, returnPath, {
      error: "Discord did not return a valid authorization code.",
    });
  }

  let accessToken: string | null = null;
  let config: ReturnType<typeof getDiscordOAuthConfig> | null = null;
  try {
    config = getDiscordOAuthConfig();
    const token = await exchangeDiscordAuthorizationCode(config, code);
    accessToken = token.accessToken;
    const identity = await fetchDiscordIdentity(config, accessToken);
    const membershipStatus = await fetchDiscordMembershipStatus(
      config,
      accessToken,
    );

    const { error } = await admin!.rpc("upsert_creator_discord_connection", {
      account_id: accountId,
      identity,
      membership_status: membershipStatus,
    });

    if (error) {
      return discordAccountRedirect(request, returnPath, {
        error: isUniqueViolation(error)
          ? "That Discord account is already linked to another creator account."
          : "We could not save the Discord connection. Please try again.",
      });
    }

    return discordAccountRedirect(request, returnPath, {
      notice: "Discord account connected.",
    });
  } catch {
    return discordAccountRedirect(request, returnPath, {
      error: "We could not verify the Discord account. Please try again.",
    });
  } finally {
    if (config && accessToken) {
      await revokeDiscordAccessToken(config, accessToken);
    }
  }
}
