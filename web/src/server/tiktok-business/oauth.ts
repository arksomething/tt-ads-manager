import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";

import { Prisma } from "@/lib/prisma-shim";

import { getTikTokBusinessOauthEnv } from "@/lib/server-env";
import { prisma } from "@/lib/db";

import { requestTikTokBusinessApi } from "./client";

const TIKTOK_OAUTH_STATE_COOKIE_NAME = "billionviews.tiktok.oauth.state";
const TIKTOK_OAUTH_PENDING_SELECTION_COOKIE_NAME =
  "billionviews.tiktok.oauth.pending";
const TIKTOK_OAUTH_STATE_MAX_AGE_SECONDS = 60 * 15;
const TIKTOK_OAUTH_PENDING_MAX_AGE_SECONDS = 60 * 10;

type QueryPrimitiveRecord = Record<string, unknown>;

type TikTokOauthTokenResponse = {
  accessToken: string;
  refreshToken: string | null;
  tokenType: string | null;
  accessTokenExpiresAt: Date | null;
  refreshTokenExpiresAt: Date | null;
  scope: string | null;
  rawPayload: QueryPrimitiveRecord;
};

export type TikTokAuthorizedAdvertiser = {
  advertiserId: string;
  advertiserName: string | null;
  businessCenterId: string | null;
  rawPayload: QueryPrimitiveRecord;
};

type TikTokAuthorizedAdvertiserCandidate = {
  advertiserId: string | null;
  advertiserName: string | null;
  businessCenterId: string | null;
  rawPayload: QueryPrimitiveRecord;
};

type TikTokOrganizationOauthStatePayload = {
  kind: "organization";
  nonce: string;
  organizationSlug: string;
  returnTo: string;
};

export type TikTokPublicOauthStatePayload = {
  kind: "public";
  nonce: string;
  returnTo: string;
};

export type TikTokOauthStatePayload =
  | TikTokOrganizationOauthStatePayload
  | TikTokPublicOauthStatePayload;

export type TikTokPendingAdvertiserSelection = {
  organizationSlug: string;
  returnTo: string;
  advertisers: TikTokAuthorizedAdvertiser[];
};

type TikTokPendingAdvertiserSelectionPayload = TikTokPendingAdvertiserSelection & {
  token: {
    accessToken: string;
    refreshToken: string | null;
    tokenType: string | null;
    accessTokenExpiresAt: string | null;
    refreshTokenExpiresAt: string | null;
    scope: string | null;
  };
  createdAt: string;
};

function isRecord(value: unknown): value is QueryPrimitiveRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getFirstString(record: QueryPrimitiveRecord, keys: string[]) {
  for (const key of keys) {
    const value = record[key];

    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }

    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }

  return null;
}

function getFirstNumber(record: QueryPrimitiveRecord, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    const numberValue =
      typeof value === "number"
        ? value
        : typeof value === "string"
          ? Number(value)
          : null;

    if (typeof numberValue === "number" && Number.isFinite(numberValue)) {
      return numberValue;
    }
  }

  return null;
}

function normalizeScopeValue(value: unknown) {
  if (Array.isArray(value)) {
    const scopes = value
      .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
      .filter(Boolean);

    return scopes.length > 0 ? scopes.join(",") : null;
  }

  if (typeof value !== "string") {
    return null;
  }

  const scopes = value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  return scopes.length > 0 ? scopes.join(",") : null;
}

function secondsToDate(value: number | null) {
  if (typeof value !== "number" || value <= 0) {
    return null;
  }

  return new Date(Date.now() + value * 1000);
}

function encodeStatePayload(payload: TikTokOauthStatePayload) {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodeStatePayload(value: string) {
  try {
    const parsed = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    ) as unknown;

    if (!isRecord(parsed)) {
      return null;
    }

    const nonce = getFirstString(parsed, ["nonce"]);
    const kind = getFirstString(parsed, ["kind"]);
    const returnTo = getFirstString(parsed, ["returnTo"]);

    if (!nonce || !returnTo) {
      return null;
    }

    if (kind === "public") {
      return {
        kind: "public",
        nonce,
        returnTo,
      } satisfies TikTokPublicOauthStatePayload;
    }

    const organizationSlug = getFirstString(parsed, ["organizationSlug"]);

    if (!organizationSlug) {
      return null;
    }

    return {
      kind: "organization",
      nonce,
      organizationSlug,
      returnTo,
    } satisfies TikTokOrganizationOauthStatePayload;
  } catch {
    return null;
  }
}

function getOAuthCookiePrefix() {
  const useSecureCookies = process.env.AUTH_URL
    ? process.env.AUTH_URL.startsWith("https://")
    : process.env.NODE_ENV === "production";

  return useSecureCookies ? "__Secure-" : "";
}

function getTikTokOauthCookieName(name: string) {
  return `${getOAuthCookiePrefix()}${name}`;
}

export function getTikTokOauthStateCookieName() {
  return getTikTokOauthCookieName(TIKTOK_OAUTH_STATE_COOKIE_NAME);
}

export function getTikTokOauthPendingSelectionCookieName() {
  return getTikTokOauthCookieName(TIKTOK_OAUTH_PENDING_SELECTION_COOKIE_NAME);
}

export function getTikTokOauthCookieOptions(maxAge: number) {
  const secure = process.env.AUTH_URL
    ? process.env.AUTH_URL.startsWith("https://")
    : process.env.NODE_ENV === "production";

  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure,
    path: "/",
    maxAge,
  };
}

function safeCompare(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

function getEncryptionKey() {
  const secret = process.env.AUTH_SECRET;

  if (!secret || secret.length < 32) {
    throw new Error(
      "AUTH_SECRET must be configured before using TikTok OAuth in this environment.",
    );
  }

  return createHash("sha256").update(secret, "utf8").digest();
}

function sealPendingSelectionPayload(
  payload: TikTokPendingAdvertiserSelectionPayload,
) {
  const key = getEncryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const plaintext = Buffer.from(JSON.stringify(payload), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [iv, ciphertext, authTag]
    .map((buffer) => buffer.toString("base64url"))
    .join(".");
}

function unsealPendingSelectionPayload(value: string) {
  try {
    const [ivValue, ciphertextValue, authTagValue] = value.split(".");

    if (!ivValue || !ciphertextValue || !authTagValue) {
      return null;
    }

    const key = getEncryptionKey();
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(ivValue, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(authTagValue, "base64url"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(ciphertextValue, "base64url")),
      decipher.final(),
    ]);
    const parsed = JSON.parse(plaintext.toString("utf8")) as unknown;

    if (!isRecord(parsed)) {
      return null;
    }

    const organizationSlug = getFirstString(parsed, ["organizationSlug"]);
    const returnTo = getFirstString(parsed, ["returnTo"]);
    const createdAt = getFirstString(parsed, ["createdAt"]);
    const tokenValue = parsed.token;
    const advertisersValue = parsed.advertisers;

    if (
      !organizationSlug ||
      !returnTo ||
      !createdAt ||
      !isRecord(tokenValue) ||
      !Array.isArray(advertisersValue)
    ) {
      return null;
    }

    const advertisers = advertisersValue
      .filter(isRecord)
      .map((advertiser) => ({
        advertiserId: getFirstString(advertiser, ["advertiserId"]),
        advertiserName: getFirstString(advertiser, ["advertiserName"]),
        businessCenterId: getFirstString(advertiser, ["businessCenterId"]),
        rawPayload: isRecord(advertiser.rawPayload) ? advertiser.rawPayload : advertiser,
      }))
      .filter(
        (
          advertiser,
        ): advertiser is TikTokAuthorizedAdvertiser & { advertiserId: string } =>
          Boolean(advertiser.advertiserId),
      );

    if (advertisers.length === 0) {
      return null;
    }

    return {
      organizationSlug,
      returnTo,
      advertisers,
      token: {
        accessToken: getFirstString(tokenValue, ["accessToken"]) ?? "",
        refreshToken: getFirstString(tokenValue, ["refreshToken"]),
        tokenType: getFirstString(tokenValue, ["tokenType"]),
        accessTokenExpiresAt:
          getFirstString(tokenValue, ["accessTokenExpiresAt"]),
        refreshTokenExpiresAt:
          getFirstString(tokenValue, ["refreshTokenExpiresAt"]),
        scope: getFirstString(tokenValue, ["scope"]),
      },
      createdAt,
    } satisfies TikTokPendingAdvertiserSelectionPayload;
  } catch {
    return null;
  }
}

function getDefaultReturnPath(organizationSlug: string) {
  return `/org/${organizationSlug}/integrations`;
}

function sanitizeReturnPath(organizationSlug: string, value: string | null) {
  if (!value) {
    return getDefaultReturnPath(organizationSlug);
  }

  return value.startsWith(`/org/${organizationSlug}`)
    ? value
    : getDefaultReturnPath(organizationSlug);
}

export function createTikTokOauthState(args: {
  organizationSlug: string;
  returnTo?: string | null;
}) {
  return encodeStatePayload({
    kind: "organization",
    nonce: randomUUID(),
    organizationSlug: args.organizationSlug,
    returnTo: sanitizeReturnPath(args.organizationSlug, args.returnTo ?? null),
  });
}

export function createTikTokPublicOauthState(args: { returnTo: string }) {
  return encodeStatePayload({
    kind: "public",
    nonce: randomUUID(),
    returnTo: args.returnTo,
  });
}

export function validateTikTokOauthState(args: {
  expectedState: string | undefined;
  receivedState: string | null;
}) {
  if (!args.expectedState || !args.receivedState) {
    throw new Error("Missing TikTok OAuth state.");
  }

  if (!safeCompare(args.expectedState, args.receivedState)) {
    throw new Error("TikTok OAuth state validation failed.");
  }

  const payload = decodeStatePayload(args.receivedState);

  if (!payload) {
    throw new Error("TikTok OAuth state payload was invalid.");
  }

  return payload;
}

export function buildTikTokAuthorizationUrl(args: { state: string }) {
  const env = getTikTokBusinessOauthEnv();
  const url = new URL(env.TIKTOK_AUTH_URL);

  url.searchParams.set("app_id", env.TIKTOK_APP_ID);
  url.searchParams.set("redirect_uri", env.TIKTOK_REDIRECT);
  url.searchParams.set("state", args.state);

  return url;
}

export async function exchangeTikTokAuthCode(args: { authCode: string }) {
  const env = getTikTokBusinessOauthEnv();
  const payload = await requestTikTokBusinessApi<QueryPrimitiveRecord>({
    method: "POST",
    path: "/open_api/v1.3/oauth2/access_token/",
    body: {
      app_id: env.TIKTOK_APP_ID,
      secret: env.TIKTOK_SECRET,
      auth_code: args.authCode,
    },
  });

  const accessToken = getFirstString(payload, ["access_token", "accessToken"]);

  if (!accessToken) {
    throw new Error("TikTok OAuth did not return an access token.");
  }

  return {
    accessToken,
    refreshToken: getFirstString(payload, ["refresh_token", "refreshToken"]),
    tokenType: getFirstString(payload, ["token_type", "tokenType"]),
    accessTokenExpiresAt: secondsToDate(
      getFirstNumber(payload, ["expires_in", "access_token_expires_in"]),
    ),
    refreshTokenExpiresAt: secondsToDate(
      getFirstNumber(payload, [
        "refresh_expires_in",
        "refresh_token_expires_in",
      ]),
    ),
    scope: normalizeScopeValue(payload.scope),
    rawPayload: payload,
  } satisfies TikTokOauthTokenResponse;
}

export async function getAuthorizedTikTokAdvertisers(args: {
  accessToken: string;
}) {
  const env = getTikTokBusinessOauthEnv();
  const payload = await requestTikTokBusinessApi<QueryPrimitiveRecord>({
    accessToken: args.accessToken,
    method: "GET",
    path: "/open_api/v1.3/oauth2/advertiser/get/",
    query: {
      app_id: env.TIKTOK_APP_ID,
      secret: env.TIKTOK_SECRET,
    },
  });
  const listValue = Array.isArray(payload.list)
    ? payload.list
    : Array.isArray(payload.advertisers)
      ? payload.advertisers
      : Array.isArray(payload.authorized_advertisers)
        ? payload.authorized_advertisers
        : [];

  return listValue
    .filter(isRecord)
    .map((advertiser: QueryPrimitiveRecord) => ({
      advertiserId: getFirstString(advertiser, ["advertiser_id", "advertiserId"]),
      advertiserName: getFirstString(advertiser, [
        "advertiser_name",
        "advertiserName",
        "name",
      ]),
      businessCenterId: getFirstString(advertiser, ["bc_id", "bcId"]),
      rawPayload: advertiser,
    }))
    .filter(
      (
        advertiser: TikTokAuthorizedAdvertiserCandidate,
      ): advertiser is TikTokAuthorizedAdvertiser =>
        Boolean(advertiser.advertiserId),
    );
}

export async function saveTikTokOauthAccount(args: {
  organizationId: string;
  advertiser: TikTokAuthorizedAdvertiser;
  token: TikTokOauthTokenResponse;
}) {
  return prisma.organizationTikTokAccount.upsert({
    where: {
      organizationId_advertiserId: {
        organizationId: args.organizationId,
        advertiserId: args.advertiser.advertiserId,
      },
    },
    update: {
      advertiserName: args.advertiser.advertiserName ?? undefined,
      accessToken: args.token.accessToken,
      refreshToken: args.token.refreshToken,
      tokenType: args.token.tokenType,
      accessTokenExpiresAt: args.token.accessTokenExpiresAt,
      refreshTokenExpiresAt: args.token.refreshTokenExpiresAt,
      scope: (args.token.scope ?? undefined) as Prisma.InputJsonValue | undefined,
      status: "ACTIVE",
      lastValidatedAt: new Date(),
    },
    create: {
      organizationId: args.organizationId,
      advertiserId: args.advertiser.advertiserId,
      advertiserName: args.advertiser.advertiserName,
      accessToken: args.token.accessToken,
      refreshToken: args.token.refreshToken,
      tokenType: args.token.tokenType,
      accessTokenExpiresAt: args.token.accessTokenExpiresAt,
      refreshTokenExpiresAt: args.token.refreshTokenExpiresAt,
      scope: (args.token.scope ?? undefined) as Prisma.InputJsonValue | undefined,
      status: "ACTIVE",
      lastValidatedAt: new Date(),
    },
  });
}

export function createPendingAdvertiserSelectionCookieValue(args: {
  organizationSlug: string;
  returnTo: string;
  advertisers: TikTokAuthorizedAdvertiser[];
  token: TikTokOauthTokenResponse;
}) {
  return sealPendingSelectionPayload({
    organizationSlug: args.organizationSlug,
    returnTo: sanitizeReturnPath(args.organizationSlug, args.returnTo),
    advertisers: args.advertisers,
    token: {
      accessToken: args.token.accessToken,
      refreshToken: args.token.refreshToken,
      tokenType: args.token.tokenType,
      accessTokenExpiresAt: args.token.accessTokenExpiresAt?.toISOString() ?? null,
      refreshTokenExpiresAt: args.token.refreshTokenExpiresAt?.toISOString() ?? null,
      scope: args.token.scope,
    },
    createdAt: new Date().toISOString(),
  });
}

export function readPendingAdvertiserSelectionCookieValue(
  value: string | undefined,
) {
  if (!value) {
    return null;
  }

  const payload = unsealPendingSelectionPayload(value);

  if (!payload) {
    return null;
  }

  const createdAt = new Date(payload.createdAt);

  if (Number.isNaN(createdAt.getTime())) {
    return null;
  }

  if (Date.now() - createdAt.getTime() > TIKTOK_OAUTH_PENDING_MAX_AGE_SECONDS * 1000) {
    return null;
  }

  return payload;
}

export async function saveTikTokOauthPendingAdvertiserSelection(args: {
  organizationId: string;
  advertiserId: string;
  pendingSelection: ReturnType<typeof readPendingAdvertiserSelectionCookieValue>;
}) {
  if (!args.pendingSelection) {
    throw new Error("No pending TikTok advertiser selection was found.");
  }

  const advertiser = args.pendingSelection.advertisers.find(
    (candidate) => candidate.advertiserId === args.advertiserId,
  );

  if (!advertiser) {
    throw new Error("That TikTok advertiser is no longer available for selection.");
  }

  return saveTikTokOauthAccount({
    organizationId: args.organizationId,
    advertiser,
    token: {
      accessToken: args.pendingSelection.token.accessToken,
      refreshToken: args.pendingSelection.token.refreshToken,
      tokenType: args.pendingSelection.token.tokenType,
      accessTokenExpiresAt: args.pendingSelection.token.accessTokenExpiresAt
        ? new Date(args.pendingSelection.token.accessTokenExpiresAt)
        : null,
      refreshTokenExpiresAt: args.pendingSelection.token.refreshTokenExpiresAt
        ? new Date(args.pendingSelection.token.refreshTokenExpiresAt)
        : null,
      scope: args.pendingSelection.token.scope,
      rawPayload: advertiser.rawPayload,
    },
  });
}

export function getTikTokOauthStateMaxAgeSeconds() {
  return TIKTOK_OAUTH_STATE_MAX_AGE_SECONDS;
}

export function getTikTokOauthPendingMaxAgeSeconds() {
  return TIKTOK_OAUTH_PENDING_MAX_AGE_SECONDS;
}

export function getTikTokOauthReturnPath(organizationSlug: string) {
  return getDefaultReturnPath(organizationSlug);
}
