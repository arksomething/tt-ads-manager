import {
  createHash,
  createHmac,
  timingSafeEqual,
  X509Certificate,
} from "node:crypto";
import { isIP } from "node:net";

import {
  CREATOR_TRACKER_INGEST_PATH,
  CREATOR_TRACKER_MAX_BODY_BYTES,
} from "@/lib/creator-tracker/ingestion-contract";

const keyIdPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const sha256Pattern = /^[0-9a-f]{64}$/u;
const signaturePattern = /^v1=([0-9a-f]{64})$/u;
const maximumClockSkewSeconds = 300;
const minimumKeyBytes = 32;
const maximumKeyBytes = 128;
const noControlOrWhitespace = /^[^\u0000-\u0020\u007f]+$/u;

export class CreatorTrackerIngestionConfigurationError extends Error {
  constructor() {
    super("Creator tracker ingestion is not configured.");
    this.name = "CreatorTrackerIngestionConfigurationError";
  }
}

export class CreatorTrackerIngestionRequestError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string) {
    super(code);
    this.name = "CreatorTrackerIngestionRequestError";
    this.status = status;
    this.code = code;
  }
}

export type CreatorTrackerIngestionKey = {
  id: string;
  secret: Buffer;
};

export type CreatorTrackerIngestionRuntimeConfig = {
  databaseUrl: string;
  databaseTls: {
    ca: string;
    servername: string;
    rejectUnauthorized: true;
  };
  allowedOrganizationIds: ReadonlySet<string>;
  keys: ReadonlyMap<string, CreatorTrackerIngestionKey>;
};

function decodeSecret(value: string | undefined) {
  if (
    !value ||
    value.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]+={0,2}$/u.test(value)
  ) {
    throw new CreatorTrackerIngestionConfigurationError();
  }

  const decoded = Buffer.from(value, "base64");
  if (
    decoded.length < minimumKeyBytes ||
    decoded.length > maximumKeyBytes ||
    decoded.toString("base64") !== value
  ) {
    throw new CreatorTrackerIngestionConfigurationError();
  }
  return decoded;
}

function parseKey(id: string | undefined, secret: string | undefined) {
  if (!id || !keyIdPattern.test(id)) {
    throw new CreatorTrackerIngestionConfigurationError();
  }
  return { id, secret: decodeSecret(secret) } satisfies CreatorTrackerIngestionKey;
}

function parseDatabaseUrl(value: string | undefined) {
  if (!value) {
    throw new CreatorTrackerIngestionConfigurationError();
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new CreatorTrackerIngestionConfigurationError();
  }

  if (
    !["postgres:", "postgresql:"].includes(parsed.protocol) ||
    !parsed.hostname ||
    isIP(parsed.hostname) !== 0 ||
    !parsed.username ||
    !parsed.password ||
    parsed.pathname.length < 2 ||
    parsed.hash !== ""
  ) {
    throw new CreatorTrackerIngestionConfigurationError();
  }

  const parameters = [...parsed.searchParams.keys()];
  if (
    parameters.some((parameter) => parameter !== "sslmode") ||
    parsed.searchParams.getAll("sslmode").length !== 1 ||
    !["require", "verify-full"].includes(
      parsed.searchParams.get("sslmode") ?? "",
    )
  ) {
    throw new CreatorTrackerIngestionConfigurationError();
  }

  // pg-connection-string lets URL TLS parameters replace the explicit ssl
  // object. Remove the reviewed marker and always pass the pinned CA instead.
  parsed.searchParams.delete("sslmode");
  return { connectionString: parsed.toString(), servername: parsed.hostname };
}

function parseDatabaseCa(value: string | undefined) {
  if (
    !value ||
    value.length > 128 * 1024 ||
    value.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]+={0,2}$/u.test(value)
  ) {
    throw new CreatorTrackerIngestionConfigurationError();
  }

  const decoded = Buffer.from(value, "base64");
  if (decoded.toString("base64") !== value) {
    throw new CreatorTrackerIngestionConfigurationError();
  }
  const pem = decoded.toString("utf8");
  const certificateBlocks =
    pem.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/gu) ?? [];
  const remaining = certificateBlocks.reduce(
    (text, certificate) => text.replace(certificate, ""),
    pem,
  );
  if (certificateBlocks.length === 0 || remaining.trim() !== "") {
    throw new CreatorTrackerIngestionConfigurationError();
  }
  try {
    const certificates = certificateBlocks.map(
      (certificate) => new X509Certificate(certificate),
    );
    if (!certificates.some((certificate) => certificate.ca)) {
      throw new Error("CA bundle has no CA certificate");
    }
  } catch {
    throw new CreatorTrackerIngestionConfigurationError();
  }
  return pem;
}

export function loadCreatorTrackerIngestionRuntimeConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): CreatorTrackerIngestionRuntimeConfig {
  const current = parseKey(
    environment.CREATOR_INGEST_CURRENT_KEY_ID,
    environment.CREATOR_INGEST_CURRENT_SECRET_B64,
  );
  const keys = new Map<string, CreatorTrackerIngestionKey>([[current.id, current]]);

  const previousId = environment.CREATOR_INGEST_PREVIOUS_KEY_ID;
  const previousSecret = environment.CREATOR_INGEST_PREVIOUS_SECRET_B64;
  if (Boolean(previousId) !== Boolean(previousSecret)) {
    throw new CreatorTrackerIngestionConfigurationError();
  }
  if (previousId && previousSecret) {
    const previous = parseKey(previousId, previousSecret);
    if (previous.id === current.id) {
      throw new CreatorTrackerIngestionConfigurationError();
    }
    keys.set(previous.id, previous);
  }

  const organizationIds = (
    environment.CREATOR_INGEST_ALLOWED_ORGANIZATION_IDS ?? ""
  )
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (
    organizationIds.length === 0 ||
    organizationIds.some(
      (entry) => entry.length > 256 || !noControlOrWhitespace.test(entry),
    )
  ) {
    throw new CreatorTrackerIngestionConfigurationError();
  }

  const database = parseDatabaseUrl(
    environment.CREATOR_TRACKER_V2_DATABASE_URL,
  );
  return {
    databaseUrl: database.connectionString,
    databaseTls: {
      ca: parseDatabaseCa(environment.CREATOR_TRACKER_V2_DATABASE_CA_B64),
      servername: database.servername,
      rejectUnauthorized: true,
    },
    allowedOrganizationIds: new Set(organizationIds),
    keys,
  };
}

export async function readBoundedCreatorTrackerBody(
  request: Request,
  maximumBytes = CREATOR_TRACKER_MAX_BODY_BYTES,
) {
  const declaredLength = request.headers.get("content-length");
  if (
    declaredLength !== null &&
    (!/^\d+$/u.test(declaredLength) || Number(declaredLength) > maximumBytes)
  ) {
    throw new CreatorTrackerIngestionRequestError(413, "PAYLOAD_TOO_LARGE");
  }

  if (!request.body) return Buffer.alloc(0);

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > maximumBytes) {
        await reader.cancel();
        throw new CreatorTrackerIngestionRequestError(413, "PAYLOAD_TOO_LARGE");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), byteLength);
}

function requestSigningPayload(
  keyId: string,
  timestamp: string,
  contentSha256: string,
) {
  return [
    "creator-tracker-ingest-v1",
    "POST",
    CREATOR_TRACKER_INGEST_PATH,
    keyId,
    timestamp,
    contentSha256,
  ].join("\n");
}

export function signCreatorTrackerIngestionRequest(
  secret: Uint8Array,
  keyId: string,
  timestamp: string,
  contentSha256: string,
) {
  return `v1=${createHmac("sha256", secret)
    .update(requestSigningPayload(keyId, timestamp, contentSha256), "utf8")
    .digest("hex")}`;
}

export function authenticateCreatorTrackerIngestionRequest(
  request: Request,
  body: Uint8Array,
  config: CreatorTrackerIngestionRuntimeConfig,
  now = Date.now(),
) {
  const url = new URL(request.url);
  if (
    request.method !== "POST" ||
    url.pathname !== CREATOR_TRACKER_INGEST_PATH ||
    url.search !== ""
  ) {
    throw new CreatorTrackerIngestionRequestError(400, "INVALID_REQUEST_TARGET");
  }

  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
    throw new CreatorTrackerIngestionRequestError(415, "UNSUPPORTED_MEDIA_TYPE");
  }
  const contentEncoding = request.headers.get("content-encoding");
  if (contentEncoding && contentEncoding.toLowerCase() !== "identity") {
    throw new CreatorTrackerIngestionRequestError(
      415,
      "UNSUPPORTED_CONTENT_ENCODING",
    );
  }

  const keyId = request.headers.get("x-creator-ingest-key-id") ?? "";
  const timestamp = request.headers.get("x-creator-ingest-timestamp") ?? "";
  const claimedHash = request.headers.get("x-creator-ingest-content-sha256") ?? "";
  const suppliedSignature = request.headers.get("x-creator-ingest-signature") ?? "";
  if (
    !keyIdPattern.test(keyId) ||
    !/^\d{10}$/u.test(timestamp) ||
    !sha256Pattern.test(claimedHash) ||
    !signaturePattern.test(suppliedSignature)
  ) {
    throw new CreatorTrackerIngestionRequestError(401, "AUTHENTICATION_FAILED");
  }

  const timestampSeconds = Number(timestamp);
  if (
    !Number.isSafeInteger(timestampSeconds) ||
    Math.abs(Math.floor(now / 1_000) - timestampSeconds) > maximumClockSkewSeconds
  ) {
    throw new CreatorTrackerIngestionRequestError(401, "AUTHENTICATION_FAILED");
  }

  const actualHash = createHash("sha256").update(body).digest("hex");
  if (!timingSafeEqual(Buffer.from(actualHash), Buffer.from(claimedHash))) {
    throw new CreatorTrackerIngestionRequestError(401, "AUTHENTICATION_FAILED");
  }

  const selectedKey = config.keys.get(keyId);
  const verificationSecret = selectedKey?.secret ?? Buffer.alloc(minimumKeyBytes);
  const expectedSignature = signCreatorTrackerIngestionRequest(
    verificationSecret,
    keyId,
    timestamp,
    claimedHash,
  );
  if (
    !selectedKey ||
    expectedSignature.length !== suppliedSignature.length ||
    !timingSafeEqual(
      Buffer.from(expectedSignature, "ascii"),
      Buffer.from(suppliedSignature, "ascii"),
    )
  ) {
    throw new CreatorTrackerIngestionRequestError(401, "AUTHENTICATION_FAILED");
  }

  return { key: selectedKey, payloadSha256: actualHash };
}

export function signCreatorTrackerCommitReceipt(
  secret: Uint8Array,
  receiptBody: string,
) {
  const receiptHash = createHash("sha256").update(receiptBody, "utf8").digest("hex");
  return `v1=${createHmac("sha256", secret)
    .update(`creator-tracker-commit-receipt-v1\n${receiptHash}`, "utf8")
    .digest("hex")}`;
}
