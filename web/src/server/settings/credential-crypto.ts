import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const ENCRYPTION_VERSION = "v1";

function getKeyMaterial() {
  const source =
    process.env.INTEGRATION_CREDENTIALS_KEY ||
    process.env.AUTH_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SK;

  if (!source || source.length < 32) {
    throw new Error(
      "Set AUTH_SECRET or INTEGRATION_CREDENTIALS_KEY before saving integration credentials.",
    );
  }

  return createHash("sha256").update(source, "utf8").digest();
}

function toBase64Url(value: Buffer) {
  return value.toString("base64url");
}

function fromBase64Url(value: string) {
  return Buffer.from(value, "base64url");
}

export function encryptCredentialValue(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getKeyMaterial(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [
    ENCRYPTION_VERSION,
    toBase64Url(iv),
    toBase64Url(authTag),
    toBase64Url(ciphertext),
  ].join(":");
}

export function decryptCredentialValue(value: string) {
  const [version, ivValue, authTagValue, ciphertextValue] = value.split(":");

  if (
    version !== ENCRYPTION_VERSION ||
    !ivValue ||
    !authTagValue ||
    !ciphertextValue
  ) {
    throw new Error("Unsupported integration credential format.");
  }

  const decipher = createDecipheriv(
    "aes-256-gcm",
    getKeyMaterial(),
    fromBase64Url(ivValue),
  );
  decipher.setAuthTag(fromBase64Url(authTagValue));

  return Buffer.concat([
    decipher.update(fromBase64Url(ciphertextValue)),
    decipher.final(),
  ]).toString("utf8");
}
