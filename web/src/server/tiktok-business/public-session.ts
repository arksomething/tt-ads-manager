import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

const TIKTOK_PUBLIC_CONNECTION_COOKIE_NAME = "billionviews.tiktok.public.connection";
const TIKTOK_PUBLIC_CONNECTION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
const TIKTOK_PUBLIC_PENDING_SELECTION_COOKIE_NAME =
  "billionviews.tiktok.public.pending";
const TIKTOK_PUBLIC_PENDING_SELECTION_MAX_AGE_SECONDS = 60 * 10;

type TikTokPublicConnectionPayload = {
  advertiserId: string;
  advertiserName: string | null;
  accessToken: string;
  savedAt: string;
};

type TikTokPublicPendingAdvertiser = {
  advertiserId: string;
  advertiserName: string | null;
};

type TikTokPublicPendingSelectionPayload = {
  returnTo: string;
  advertisers: TikTokPublicPendingAdvertiser[];
  accessToken: string;
  createdAt: string;
};

function getCookiePrefix() {
  const secure = process.env.AUTH_URL
    ? process.env.AUTH_URL.startsWith("https://")
    : process.env.NODE_ENV === "production";

  return secure ? "__Secure-" : "";
}

function getEncryptionKey() {
  const secret = process.env.AUTH_SECRET;

  if (!secret || secret.length < 32) {
    throw new Error(
      "AUTH_SECRET must be configured before saving TikTok credentials.",
    );
  }

  return createHash("sha256").update(secret, "utf8").digest();
}

function sealPayload(payload: unknown) {
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

function unsealPayload(value: string) {
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
    return JSON.parse(plaintext.toString("utf8")) as unknown;
  } catch {
    return null;
  }
}

export type TikTokPublicConnection = {
  advertiserId: string;
  advertiserName: string | null;
  accessToken: string;
  savedAt: Date;
};

export function getTikTokPublicConnectionCookieName() {
  return `${getCookiePrefix()}${TIKTOK_PUBLIC_CONNECTION_COOKIE_NAME}`;
}

export function getTikTokPublicPendingSelectionCookieName() {
  return `${getCookiePrefix()}${TIKTOK_PUBLIC_PENDING_SELECTION_COOKIE_NAME}`;
}

export function getTikTokPublicConnectionCookieOptions(maxAge: number) {
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

export function getTikTokPublicConnectionMaxAgeSeconds() {
  return TIKTOK_PUBLIC_CONNECTION_MAX_AGE_SECONDS;
}

export function getTikTokPublicPendingSelectionMaxAgeSeconds() {
  return TIKTOK_PUBLIC_PENDING_SELECTION_MAX_AGE_SECONDS;
}

export function getTikTokPublicReturnPath() {
  return "/tiktok-paid-views";
}

export function sanitizeTikTokPublicReturnPath(value: string | null | undefined) {
  if (!value || !value.startsWith("/tiktok-paid-views")) {
    return getTikTokPublicReturnPath();
  }

  return value;
}

export function createTikTokPublicConnectionCookieValue(args: {
  advertiserId: string;
  advertiserName?: string | null;
  accessToken: string;
}) {
  const advertiserId = args.advertiserId.trim();
  const accessToken = args.accessToken.trim();

  if (advertiserId.length === 0) {
    throw new Error("Advertiser ID is required.");
  }

  if (accessToken.length === 0) {
    throw new Error("Access token is required.");
  }

  return sealPayload({
    advertiserId,
    advertiserName: args.advertiserName?.trim() || null,
    accessToken,
    savedAt: new Date().toISOString(),
  });
}

export function readTikTokPublicConnectionCookieValue(value: string | undefined) {
  if (!value) {
    return null;
  }

  const parsed = unsealPayload(value) as Partial<TikTokPublicConnectionPayload> | null;

  if (
    !parsed ||
    typeof parsed.advertiserId !== "string" ||
    parsed.advertiserId.trim().length === 0 ||
    typeof parsed.accessToken !== "string" ||
    parsed.accessToken.trim().length === 0 ||
    typeof parsed.savedAt !== "string"
  ) {
    return null;
  }

  const savedAt = new Date(parsed.savedAt);

  if (Number.isNaN(savedAt.getTime())) {
    return null;
  }

  return {
    advertiserId: parsed.advertiserId.trim(),
    advertiserName:
      typeof parsed.advertiserName === "string" &&
      parsed.advertiserName.trim().length > 0
        ? parsed.advertiserName.trim()
        : null,
    accessToken: parsed.accessToken.trim(),
    savedAt,
  } satisfies TikTokPublicConnection;
}

export type TikTokPublicPendingSelection = {
  returnTo: string;
  advertisers: TikTokPublicPendingAdvertiser[];
  accessToken: string;
  createdAt: Date;
};

export function createTikTokPublicPendingSelectionCookieValue(args: {
  returnTo?: string | null;
  advertisers: TikTokPublicPendingAdvertiser[];
  accessToken: string;
}) {
  const advertisers = args.advertisers
    .map((advertiser) => ({
      advertiserId: advertiser.advertiserId.trim(),
      advertiserName: advertiser.advertiserName?.trim() || null,
    }))
    .filter((advertiser) => advertiser.advertiserId.length > 0);
  const accessToken = args.accessToken.trim();

  if (advertisers.length === 0) {
    throw new Error("At least one advertiser is required.");
  }

  if (accessToken.length === 0) {
    throw new Error("Access token is required.");
  }

  return sealPayload({
    returnTo: sanitizeTikTokPublicReturnPath(args.returnTo),
    advertisers,
    accessToken,
    createdAt: new Date().toISOString(),
  } satisfies TikTokPublicPendingSelectionPayload);
}

export function readTikTokPublicPendingSelectionCookieValue(value: string | undefined) {
  if (!value) {
    return null;
  }

  const parsed = unsealPayload(value) as Partial<TikTokPublicPendingSelectionPayload> | null;

  if (
    !parsed ||
    typeof parsed.returnTo !== "string" ||
    typeof parsed.accessToken !== "string" ||
    !Array.isArray(parsed.advertisers) ||
    typeof parsed.createdAt !== "string"
  ) {
    return null;
  }

  const advertisers = parsed.advertisers
    .filter((advertiser) => typeof advertiser === "object" && advertiser !== null)
    .map((advertiser) => ({
      advertiserId:
        typeof advertiser.advertiserId === "string"
          ? advertiser.advertiserId.trim()
          : "",
      advertiserName:
        typeof advertiser.advertiserName === "string" &&
        advertiser.advertiserName.trim().length > 0
          ? advertiser.advertiserName.trim()
          : null,
    }))
    .filter((advertiser) => advertiser.advertiserId.length > 0);

  if (advertisers.length === 0 || parsed.accessToken.trim().length === 0) {
    return null;
  }

  const createdAt = new Date(parsed.createdAt);

  if (Number.isNaN(createdAt.getTime())) {
    return null;
  }

  if (
    Date.now() - createdAt.getTime() >
    TIKTOK_PUBLIC_PENDING_SELECTION_MAX_AGE_SECONDS * 1000
  ) {
    return null;
  }

  return {
    returnTo: sanitizeTikTokPublicReturnPath(parsed.returnTo),
    advertisers,
    accessToken: parsed.accessToken.trim(),
    createdAt,
  } satisfies TikTokPublicPendingSelection;
}
