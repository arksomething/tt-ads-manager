import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

export const CREATOR_PORTAL_COOKIE_NAME = "bv_creator_portal";
export const CREATOR_PORTAL_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;
export const CREATOR_PORTAL_COOKIE_PATH = "/creator";

export function getCreatorPortalSessionCookieOptions() {
  return {
    httpOnly: true,
    maxAge: CREATOR_PORTAL_SESSION_MAX_AGE_SECONDS,
    path: CREATOR_PORTAL_COOKIE_PATH,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
  };
}

export function generateCreatorPortalLinkToken() {
  return randomBytes(32).toString("base64url");
}

export function hashCreatorPortalSecret(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function getCreatorPortalEncryptionKey(secret: string) {
  return createHash("sha256").update(secret, "utf8").digest();
}

export function encryptCreatorPortalLinkToken(token: string, secret: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv(
    "aes-256-gcm",
    getCreatorPortalEncryptionKey(secret),
    iv,
  );
  const ciphertext = Buffer.concat([
    cipher.update(token, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return [
    "v1",
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

export function decryptCreatorPortalLinkToken(value: string, secret: string) {
  const [version, ivValue, tagValue, ciphertextValue, extra] = value.split(".");

  if (
    version !== "v1" ||
    !ivValue ||
    !tagValue ||
    !ciphertextValue ||
    extra
  ) {
    return null;
  }

  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      getCreatorPortalEncryptionKey(secret),
      Buffer.from(ivValue, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(tagValue, "base64url"));

    return Buffer.concat([
      decipher.update(Buffer.from(ciphertextValue, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}

function signCreatorPortalSession(accessId: string, secret: string) {
  return createHmac("sha256", secret).update(accessId, "utf8").digest("base64url");
}

function constantTimeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

export function createCreatorPortalSessionValue(accessId: string, secret: string) {
  return `${accessId}.${signCreatorPortalSession(accessId, secret)}`;
}

export function verifyCreatorPortalSessionValue(
  value: string | undefined,
  secret: string,
) {
  if (!value) {
    return null;
  }

  const [accessId, signature, extra] = value.split(".");

  if (!accessId || !signature || extra) {
    return null;
  }

  const expectedSignature = signCreatorPortalSession(accessId, secret);
  return constantTimeEqual(signature, expectedSignature) ? accessId : null;
}
