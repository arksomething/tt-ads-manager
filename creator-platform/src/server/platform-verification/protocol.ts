const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const workerIdPattern = /^[a-z0-9][a-z0-9._-]{2,63}$/u;
const sha256Pattern = /^[a-f0-9]{64}$/u;
const noControlCharacters = /^[^\u0000-\u001f\u007f]*$/u;

const terminalFailureCodes = new Set([
  "account_not_found",
  "bio_code_missing",
  "profile_private",
  "handle_mismatch",
  "native_id_missing",
  "unsupported_platform",
]);
const retryFailureCodes = new Set([
  "provider_rate_limited",
  "provider_unavailable",
  "provider_authentication_failed",
  "network_error",
  "provider_response_invalid",
]);

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function onlyKeys(input: Record<string, unknown>, keys: ReadonlySet<string>) {
  return Object.keys(input).every((key) => keys.has(key));
}

function integer(value: unknown, minimum: number, maximum: number) {
  return Number.isInteger(value) && Number(value) >= minimum && Number(value) <= maximum
    ? Number(value)
    : null;
}

function common(input: Record<string, unknown>) {
  if (
    input.protocolVersion !== 1
    || typeof input.workerId !== "string"
    || !workerIdPattern.test(input.workerId)
  ) return null;
  return { protocolVersion: 1 as const, workerId: input.workerId };
}

export function parseVerificationLeaseInput(value: unknown) {
  const input = record(value);
  if (!input || !onlyKeys(input, new Set([
    "protocolVersion", "workerId", "bootId", "maxJobs", "leaseSeconds",
  ]))) return null;
  const shared = common(input);
  const maxJobs = integer(input.maxJobs, 1, 25);
  const leaseSeconds = integer(input.leaseSeconds, 30, 300);
  if (
    !shared
    || typeof input.bootId !== "string"
    || !uuidPattern.test(input.bootId)
    || maxJobs === null
    || leaseSeconds === null
  ) return null;
  return { ...shared, bootId: input.bootId.toLowerCase(), maxJobs, leaseSeconds };
}

const completionCommonKeys = ["protocolVersion", "workerId", "jobId", "leaseToken", "outcome"];

export function parseVerificationCompletionInput(value: unknown) {
  const input = record(value);
  if (!input) return null;
  const shared = common(input);
  if (
    !shared
    || typeof input.jobId !== "string"
    || !uuidPattern.test(input.jobId)
    || typeof input.leaseToken !== "string"
    || !uuidPattern.test(input.leaseToken)
  ) return null;

  if (input.outcome === "verified") {
    if (!onlyKeys(input, new Set([
      ...completionCommonKeys,
      "nativeAccountId",
      "codeMatched",
      "evidenceReference",
      "observedBioSha256",
      "observedAt",
    ]))) return null;
    const nativeAccountId = typeof input.nativeAccountId === "string"
      ? input.nativeAccountId.trim()
      : "";
    const evidenceReference = typeof input.evidenceReference === "string"
      ? input.evidenceReference.trim()
      : "";
    const observedAt = typeof input.observedAt === "string" && Number.isFinite(Date.parse(input.observedAt))
      ? new Date(input.observedAt).toISOString()
      : null;
    if (
      nativeAccountId.length < 1
      || nativeAccountId.length > 191
      || !noControlCharacters.test(nativeAccountId)
      || input.codeMatched !== true
      || evidenceReference.length < 8
      || evidenceReference.length > 2_000
      || !noControlCharacters.test(evidenceReference)
      || typeof input.observedBioSha256 !== "string"
      || !sha256Pattern.test(input.observedBioSha256)
      || !observedAt
    ) return null;
    return {
      ...shared,
      jobId: input.jobId.toLowerCase(),
      leaseToken: input.leaseToken.toLowerCase(),
      result: {
        outcome: "verified",
        nativeAccountId,
        codeMatched: true,
        evidenceReference,
        observedBioSha256: input.observedBioSha256,
        observedAt,
      },
    } as const;
  }

  if (input.outcome === "failed") {
    if (!onlyKeys(input, new Set([...completionCommonKeys, "failureCode"]))) return null;
    if (typeof input.failureCode !== "string" || !terminalFailureCodes.has(input.failureCode)) {
      return null;
    }
    return {
      ...shared,
      jobId: input.jobId.toLowerCase(),
      leaseToken: input.leaseToken.toLowerCase(),
      result: { outcome: "failed", failureCode: input.failureCode },
    } as const;
  }

  return null;
}

export function parseVerificationRetryInput(value: unknown) {
  const input = record(value);
  if (!input || !onlyKeys(input, new Set([
    "protocolVersion", "workerId", "jobId", "leaseToken", "failureCode", "backoffSeconds",
  ]))) return null;
  const shared = common(input);
  const backoffSeconds = integer(input.backoffSeconds, 30, 21_600);
  if (
    !shared
    || typeof input.jobId !== "string"
    || !uuidPattern.test(input.jobId)
    || typeof input.leaseToken !== "string"
    || !uuidPattern.test(input.leaseToken)
    || typeof input.failureCode !== "string"
    || !retryFailureCodes.has(input.failureCode)
    || backoffSeconds === null
  ) return null;
  return {
    ...shared,
    jobId: input.jobId.toLowerCase(),
    leaseToken: input.leaseToken.toLowerCase(),
    retry: { failureCode: input.failureCode, backoffSeconds },
  };
}

export function parseVerificationReapInput(value: unknown) {
  const input = record(value);
  if (!input || !onlyKeys(input, new Set(["protocolVersion", "workerId", "maxJobs"]))) {
    return null;
  }
  const shared = common(input);
  const maxJobs = integer(input.maxJobs, 1, 500);
  return shared && maxJobs !== null ? { ...shared, maxJobs } : null;
}

export function mapVerificationLease(value: unknown) {
  const row = record(value) ?? {};
  return {
    jobId: row.job_id ?? null,
    claimId: row.claim_id ?? null,
    leaseToken: row.lease_token ?? null,
    attemptNumber: row.attempt_number ?? null,
    platform: row.platform ?? null,
    enteredHandle: row.entered_handle ?? null,
    normalizedHandle: row.normalized_handle ?? null,
    bioCode: row.bio_code ?? null,
    codeExpiresAt: row.code_expires_at ?? null,
  };
}

export function mapVerificationResult(value: unknown) {
  const row = record(value) ?? {};
  return {
    accepted: row.accepted === true,
    state: typeof row.final_state === "string" ? row.final_state : "unknown",
    resultCode: typeof row.result_code === "string" ? row.result_code : null,
    ...(typeof row.available_at === "string" ? { availableAt: row.available_at } : {}),
  };
}

export function mapVerificationReap(value: unknown) {
  const row = record(value) ?? {};
  return {
    inspectedCount: typeof row.inspected_count === "number" ? row.inspected_count : 0,
    retryCount: typeof row.retry_count === "number" ? row.retry_count : 0,
    failedCount: typeof row.failed_count === "number" ? row.failed_count : 0,
    cancelledCount: typeof row.cancelled_count === "number" ? row.cancelled_count : 0,
  };
}
