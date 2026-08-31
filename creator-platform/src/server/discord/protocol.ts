const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const sha256Pattern = /^[a-f0-9]{64}$/u;
const workerIdPattern = /^[a-z0-9][a-z0-9._-]{2,63}$/u;

export type LeaseInput = {
  workerId: string;
  bootId: string;
  protocolVersion: 1;
  maxMessages: number;
  leaseSeconds: number;
};

export type RoleLeaseInput = {
  workerId: string;
  bootId: string;
  protocolVersion: 1;
  maxJobs: number;
  leaseSeconds: number;
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function integer(value: unknown, minimum: number, maximum: number) {
  return Number.isInteger(value) && Number(value) >= minimum && Number(value) <= maximum
    ? Number(value)
    : null;
}

export function parseLeaseInput(value: unknown): LeaseInput | null {
  const input = record(value);
  if (!input) return null;
  const maxMessages = integer(input.maxMessages, 1, 25);
  const leaseSeconds = integer(input.leaseSeconds, 30, 300);
  if (
    typeof input.workerId !== "string" ||
    !workerIdPattern.test(input.workerId) ||
    typeof input.bootId !== "string" ||
    !uuidPattern.test(input.bootId) ||
    input.protocolVersion !== 1 ||
    maxMessages === null ||
    leaseSeconds === null
  ) return null;
  return {
    workerId: input.workerId,
    bootId: input.bootId,
    protocolVersion: 1,
    maxMessages,
    leaseSeconds,
  };
}

export function parseRoleLeaseInput(value: unknown): RoleLeaseInput | null {
  const input = record(value);
  if (!input) return null;
  const maxJobs = integer(input.maxJobs, 1, 25);
  const leaseSeconds = integer(input.leaseSeconds, 30, 300);
  if (
    typeof input.workerId !== "string" ||
    !workerIdPattern.test(input.workerId) ||
    typeof input.bootId !== "string" ||
    !uuidPattern.test(input.bootId) ||
    input.protocolVersion !== 1 ||
    maxJobs === null ||
    leaseSeconds === null
  ) return null;
  return {
    workerId: input.workerId,
    bootId: input.bootId,
    protocolVersion: 1,
    maxJobs,
    leaseSeconds,
  };
}

export function parseLeaseToken(value: unknown) {
  const input = record(value);
  return typeof input?.leaseToken === "string" && uuidPattern.test(input.leaseToken)
    ? input.leaseToken.toLowerCase()
    : null;
}

function nullableSnowflake(value: unknown) {
  return value === null || value === undefined
    ? null
    : typeof value === "string" && /^\d{17,20}$/u.test(value)
      ? value
      : undefined;
}

function nullableInteger(value: unknown, minimum: number, maximum: number) {
  return value === null || value === undefined
    ? null
    : integer(value, minimum, maximum) ?? undefined;
}

function nullableIso(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return undefined;
  return new Date(value).toISOString();
}

const deliveryOutcomes = new Set(["sent", "retry", "terminal", "unknown"]);
const errorClasses = new Set([
  "rate_limited",
  "bot_unauthorized",
  "bot_guild_access",
  "dm_blocked",
  "not_guild_member",
  "discord_forbidden",
  "discord_unavailable",
  "discord_rejected",
  "network_error",
  "ambiguous_send_timeout",
  "unsupported_template_version",
  "rendered_message_too_long",
]);

export function parseDeliveryCompletion(value: unknown) {
  const input = record(value);
  if (!input || typeof input.leaseToken !== "string" || !uuidPattern.test(input.leaseToken)) {
    return null;
  }
  if (typeof input.outcome !== "string" || !deliveryOutcomes.has(input.outcome)) return null;

  const discordChannelId = nullableSnowflake(input.discordChannelId);
  const discordMessageId = nullableSnowflake(input.discordMessageId);
  const httpStatus = nullableInteger(input.httpStatus, 100, 599);
  const discordCode = nullableInteger(input.discordCode, 0, 99_999_999);
  const retryAt = nullableIso(input.retryAt);
  const deliveredAt = nullableIso(input.deliveredAt);
  if (
    discordChannelId === undefined || discordMessageId === undefined ||
    httpStatus === undefined || discordCode === undefined ||
    retryAt === undefined || deliveredAt === undefined
  ) return null;

  if (input.outcome === "sent") {
    if (!discordChannelId || !discordMessageId || deliveredAt === null) return null;
    if (typeof input.renderedSha256 !== "string" || !sha256Pattern.test(input.renderedSha256)) {
      return null;
    }
  }
  if (input.outcome === "retry" && retryAt === null) return null;

  const errorClass = input.errorClass === null || input.errorClass === undefined
    ? null
    : typeof input.errorClass === "string" && errorClasses.has(input.errorClass)
      ? input.errorClass
      : undefined;
  if (errorClass === undefined) return null;

  return {
    leaseToken: input.leaseToken.toLowerCase(),
    result: {
      outcome: input.outcome,
      error_class: errorClass,
      http_status: httpStatus,
      discord_code: discordCode,
      retry_at: retryAt,
      delivered_at: deliveredAt,
      discord_channel_id: discordChannelId,
      discord_message_id: discordMessageId,
      rendered_sha256:
        typeof input.renderedSha256 === "string" ? input.renderedSha256 : null,
    },
  };
}

const roleOutcomes = new Set(["synced", "retry", "blocked"]);
const roleKeys = new Set(["onboarding", "active", "at_risk", "top_performer"]);

export function parseRoleCompletion(value: unknown) {
  const input = record(value);
  if (
    !input ||
    typeof input.leaseToken !== "string" ||
    !uuidPattern.test(input.leaseToken) ||
    typeof input.outcome !== "string" ||
    !roleOutcomes.has(input.outcome)
  ) return null;

  const observedRoleKeys = input.observedRoleKeys === undefined
    ? []
    : Array.isArray(input.observedRoleKeys) && input.observedRoleKeys.every(
      (key) => typeof key === "string" && roleKeys.has(key),
    )
      ? [...new Set(input.observedRoleKeys)]
      : null;
  const retryAt = nullableIso(input.retryAt);
  const completedAt = nullableIso(input.completedAt);
  const httpStatus = nullableInteger(input.httpStatus, 100, 599);
  const discordCode = nullableInteger(input.discordCode, 0, 99_999_999);
  if (
    observedRoleKeys === null || retryAt === undefined || completedAt === undefined ||
    httpStatus === undefined || discordCode === undefined
  ) return null;
  if (input.outcome === "retry" && retryAt === null) return null;

  const errorClass = input.errorClass === undefined || input.errorClass === null
    ? null
    : typeof input.errorClass === "string" && errorClasses.has(input.errorClass)
      ? input.errorClass
      : undefined;
  if (errorClass === undefined) return null;

  return {
    leaseToken: input.leaseToken.toLowerCase(),
    result: {
      outcome: input.outcome,
      observed_role_keys: observedRoleKeys,
      retry_at: retryAt,
      completed_at: completedAt,
      error_class: errorClass,
      http_status: httpStatus,
      discord_code: discordCode,
    },
  };
}

export function mapDeliveryLeaseRow(value: unknown) {
  const row = record(value) ?? {};
  return {
    deliveryId: row.delivery_id ?? null,
    leaseToken: row.lease_token ?? null,
    attemptNumber: row.attempt_number ?? 0,
    discordUserId: row.discord_user_id ?? null,
    dmChannelId: row.dm_channel_id ?? null,
    templateKey: row.template_key ?? null,
    templateVersion: row.template_version ?? 0,
    variables: record(row.variables) ?? {},
    providerNonce: row.provider_nonce ?? null,
    expiresAt: row.expires_at ?? null,
    // Missing/invalid state metadata is treated as recovery-required so a
    // route/schema version skew cannot turn a prior uncertain POST into a send.
    requiresRecovery: row.requires_recovery === false ? false : true,
  };
}

export function mapRoleLeaseRow(value: unknown) {
  const row = record(value) ?? {};
  return {
    jobId: row.job_id ?? null,
    leaseToken: row.lease_token ?? null,
    discordUserId: row.discord_user_id ?? null,
    desiredRoleKeys: Array.isArray(row.desired_role_keys) ? row.desired_role_keys : [],
    attemptNumber: row.attempt_number ?? 0,
  };
}
