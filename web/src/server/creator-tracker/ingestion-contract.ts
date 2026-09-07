import { z } from "zod";

const UUID_V7 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const NO_CONTROL_CHARACTERS = /^[^\u0000-\u001f\u007f]*$/;
const ISO_TIMESTAMP_WITH_OFFSET =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
const RESERVED_METADATA_KEY = "_creatorTrackerIngestion";
const RAW_STORAGE_KEY =
  /^creator-tracker\/raw\/v1\/sha256\/([0-9a-f]{2})\/([0-9a-f]{64})$/;
const RAW_JSON_MEDIA_TYPE = "application/json";

export const CREATOR_TRACKER_INGEST_PATH =
  "/api/v1/creator-tracker/ingestion/batches";
export const CREATOR_TRACKER_SCHEMA_VERSION = 2 as const;
export const CREATOR_TRACKER_MAX_BODY_BYTES = 2 * 1024 * 1024;
export const CREATOR_TRACKER_MAX_BATCH_ITEMS = 2_000;

const uuidV7 = z.string().regex(UUID_V7, "must be a canonical lowercase UUIDv7");
const uuidV4 = z.string().regex(UUID_V4, "must be a canonical lowercase UUIDv4");
const sha256 = z.string().regex(SHA256, "must be a lowercase SHA-256 hex digest");
const timestamp = z
  .string()
  .max(35)
  .regex(ISO_TIMESTAMP_WITH_OFFSET, "must be an ISO-8601 timestamp with an offset")
  .refine((value) => Number.isFinite(Date.parse(value)), "must be a real timestamp");

const safeHttpsUrl = z
  .url()
  .max(2_048)
  .refine((value) => {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.username === "" &&
      url.password === "" &&
      url.hash === "" &&
      !["localhost", "localhost.localdomain"].includes(url.hostname) &&
      !/(?:^|\.)(?:local|internal)$/.test(url.hostname) &&
      !/%(?:2e|2f|5c)/i.test(value)
    );
  }, "must be an HTTPS URL without credentials, fragments, or local/traversal ambiguity");

type CreatorPlatform = "tiktok" | "instagram" | "youtube";

function isPlatformProfileUrl(value: string, valuePlatform: CreatorPlatform) {
  const url = new URL(value);
  if (url.search !== "") return false;
  switch (valuePlatform) {
    case "tiktok":
      return (
        ["tiktok.com", "www.tiktok.com"].includes(url.hostname) &&
        /^\/@[A-Za-z0-9._-]{1,64}\/?$/.test(url.pathname)
      );
    case "instagram":
      return (
        ["instagram.com", "www.instagram.com"].includes(url.hostname) &&
        /^\/[A-Za-z0-9._]{1,64}\/?$/.test(url.pathname)
      );
    case "youtube":
      return (
        ["youtube.com", "www.youtube.com"].includes(url.hostname) &&
        /^\/(?:@[A-Za-z0-9._-]{1,100}|channel\/[A-Za-z0-9_-]{1,100}|c\/[A-Za-z0-9._-]{1,100}|user\/[A-Za-z0-9._-]{1,100})\/?$/.test(
          url.pathname,
        )
      );
  }
}

function isPlatformVideoUrl(value: string, valuePlatform: CreatorPlatform) {
  const url = new URL(value);
  switch (valuePlatform) {
    case "tiktok":
      return (
        ["tiktok.com", "www.tiktok.com"].includes(url.hostname) &&
        url.search === "" &&
        /^\/@[A-Za-z0-9._-]{1,64}\/video\/[0-9]{1,32}\/?$/.test(url.pathname)
      );
    case "instagram":
      return (
        ["instagram.com", "www.instagram.com"].includes(url.hostname) &&
        url.search === "" &&
        /^\/(?:p|reel|tv)\/[A-Za-z0-9_-]{1,128}\/?$/.test(url.pathname)
      );
    case "youtube":
      if (url.hostname === "youtu.be") {
        return url.search === "" && /^\/[A-Za-z0-9_-]{1,128}\/?$/.test(url.pathname);
      }
      return (
        ["youtube.com", "www.youtube.com"].includes(url.hostname) &&
        url.pathname === "/watch" &&
        url.searchParams.size === 1 &&
        /^[A-Za-z0-9_-]{1,128}$/.test(url.searchParams.get("v") ?? "")
      );
  }
}

function boundedString(max: number) {
  return z
    .string()
    .min(1)
    .max(max)
    .refine((value) => value === value.trim(), "must not have surrounding whitespace")
    .regex(NO_CONTROL_CHARACTERS, "must not contain control characters");
}

function nullable<T extends z.ZodType>(schema: T) {
  return schema.nullish().transform((value) => value ?? null);
}

const metadata = z
  .record(z.string().min(1).max(128), z.unknown())
  .superRefine((value, context) => {
    if (Object.hasOwn(value, RESERVED_METADATA_KEY)) {
      context.addIssue({
        code: "custom",
        message: `${RESERVED_METADATA_KEY} is reserved by the ingestion service`,
      });
    }

    if (Buffer.byteLength(JSON.stringify(value), "utf8") > 64 * 1024) {
      context.addIssue({ code: "custom", message: "metadata exceeds 64 KiB" });
    }
  });

const platform = z.enum(["tiktok", "instagram", "youtube"]);
const accountTrackingState = z.enum([
  "pending",
  "active",
  "paused",
  "restricted",
  "quarantined",
  "closed",
]);
const discoveryTier = z.enum(["hot", "active", "cool", "archive"]);
const availability = z.enum([
  "available",
  "private",
  "deleted",
  "restricted",
  "not_found",
  "unknown",
]);
const videoTrackingState = z.enum([
  "active",
  "cooling",
  "archived",
  "paused",
  "needs_review",
]);
const observationTier = z.enum([
  "hot",
  "day_0_2",
  "day_3_8",
  "day_9_30",
  "day_31_90",
  "archive",
]);
const nonNegativeInteger = z.number().int().nonnegative();
const nullableNonNegativeInteger = nullable(nonNegativeInteger);
const httpStatus = nullable(z.number().int().min(100).max(599));
const positiveSafeInteger = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const epochMilliseconds = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const rawEvidenceAdapter = z.enum([
  "tiktok_ytdlp",
  "scrapecreators_tiktok",
  "scrapecreators_instagram",
  "viral_app_provider",
  "tiktok_display_api",
  "instagram_graph_api",
]);
const rawManifestPurpose = z.enum([
  "account_discovery",
  "video_observation",
  "credit_rearm",
  "provider_reconciliation",
]);
const rawRequestKind = z.enum([
  "profile_page",
  "post_detail",
  "profile_info",
  "video_list",
  "video_query",
  "provider_accounts_page",
  "provider_videos_page",
]);

function rawEvidenceVocabularyMatches(
  adapter: z.infer<typeof rawEvidenceAdapter>,
  purpose: z.infer<typeof rawManifestPurpose>,
  requestKind: z.infer<typeof rawRequestKind>,
): boolean {
  const kindMatchesAdapter =
    (adapter === "tiktok_ytdlp" &&
      ["profile_page", "post_detail"].includes(requestKind)) ||
    (["scrapecreators_tiktok", "scrapecreators_instagram"].includes(adapter) &&
      ["profile_page", "post_detail", "profile_info", "video_query"].includes(
        requestKind,
      )) ||
    (["tiktok_display_api", "instagram_graph_api"].includes(adapter) &&
      ["profile_info", "video_list", "video_query"].includes(requestKind)) ||
    (adapter === "viral_app_provider" &&
      ["provider_accounts_page", "provider_videos_page"].includes(requestKind));
  if (!kindMatchesAdapter) return false;
  if (purpose === "provider_reconciliation") {
    return (
      adapter === "viral_app_provider" &&
      ["provider_accounts_page", "provider_videos_page"].includes(requestKind)
    );
  }
  if (adapter === "viral_app_provider") return false;
  if (purpose === "video_observation") {
    return ["post_detail", "video_query"].includes(requestKind);
  }
  if (purpose === "account_discovery") {
    return ["profile_page", "profile_info", "video_list"].includes(requestKind);
  }
  return purpose === "credit_rearm";
}

const rawStorageKey = z
  .string()
  .min(1)
  .max(1_024)
  .regex(RAW_STORAGE_KEY, "must be a canonical creator-tracker/raw object key");

function validateRawStorageKey(
  value: { storageKey: string; sha256: string },
  context: z.RefinementCtx,
) {
  const storageKeyMatch = RAW_STORAGE_KEY.exec(value.storageKey);
  if (
    !storageKeyMatch ||
    storageKeyMatch[1] !== storageKeyMatch[2]?.slice(0, 2) ||
    storageKeyMatch[2] !== value.sha256
  ) {
    context.addIssue({
      code: "custom",
      path: ["storageKey"],
      message: "must embed the object SHA-256 with its matching two-character shard",
    });
  }
}

const evidenceLink = {
  evidenceRunId: uuidV7,
  rawManifestId: uuidV7,
};

const creator = z
  .object({
    id: uuidV7,
    legacyCreatorId: nullable(boundedString(256)),
    displayName: boundedString(256),
    state: z.enum(["pending", "active", "paused", "closed", "quarantined"]),
    metadata,
    ...evidenceLink,
  })
  .strict();

const account = z
  .object({
    id: uuidV7,
    creatorId: uuidV7,
    platform,
    nativeAccountId: nullable(boundedString(256)),
    profileUrl: nullable(safeHttpsUrl),
    trackingState: accountTrackingState,
    discoveryTier,
    firstSeenAt: timestamp,
    lastDiscoveryAt: nullable(timestamp),
    lastSuccessAt: nullable(timestamp),
    lastCompleteDiscoveryRunId: nullable(uuidV7),
    nextDiscoveryAt: nullable(timestamp),
    consecutiveFailures: nonNegativeInteger.max(1_000_000),
    lastErrorCode: nullable(boundedString(128)),
    metadata,
    ...evidenceLink,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.nativeAccountId === null && value.trackingState !== "quarantined") {
      context.addIssue({
        code: "custom",
        path: ["nativeAccountId"],
        message: "is required unless trackingState is quarantined",
      });
    }
    if (
      value.profileUrl !== null &&
      !isPlatformProfileUrl(value.profileUrl, value.platform)
    ) {
      context.addIssue({
        code: "custom",
        path: ["profileUrl"],
        message: "must be a canonical profile URL for platform",
      });
    }

    const firstSeenAt = Date.parse(value.firstSeenAt);
    for (const field of ["lastDiscoveryAt", "lastSuccessAt"] as const) {
      const candidate = value[field];
      if (candidate !== null && Date.parse(candidate) < firstSeenAt) {
        context.addIssue({
          code: "custom",
          path: [field],
          message: "must not precede firstSeenAt",
        });
      }
    }
  });

const trackingRun = z
  .object({
    id: uuidV7,
    workerId: boundedString(256),
    adapter: boundedString(128),
    adapterVersion: boundedString(128),
    requestId: boundedString(512),
    scheduledFor: nullable(timestamp),
    requestStartedAt: timestamp,
    responseReceivedAt: nullable(timestamp),
    completedAt: timestamp,
    status: z.enum([
      "complete",
      "partial",
      "capped",
      "rate_limited",
      "auth_required",
      "failed",
    ]),
    completenessReason: nullable(boundedString(512)),
    cursorIn: nullable(boundedString(2_048)),
    cursorOut: nullable(boundedString(2_048)),
    pagesExpected: nullableNonNegativeInteger,
    pagesFetched: nullableNonNegativeInteger,
    itemsExpected: nullableNonNegativeInteger,
    itemsSeen: nullableNonNegativeInteger,
    itemsWritten: nullableNonNegativeInteger,
    httpStatus,
    errorCode: nullable(boundedString(128)),
    errorDetail: nullable(metadata),
    rawManifestSha256: sha256,
  })
  .strict()
  .superRefine((value, context) => {
    const started = Date.parse(value.requestStartedAt);
    const completed = Date.parse(value.completedAt);
    if (completed < started) {
      context.addIssue({
        code: "custom",
        path: ["completedAt"],
        message: "must not precede requestStartedAt",
      });
    }
    if (
      value.responseReceivedAt !== null &&
      (Date.parse(value.responseReceivedAt) < started ||
        Date.parse(value.responseReceivedAt) > completed)
    ) {
      context.addIssue({
        code: "custom",
        path: ["responseReceivedAt"],
        message: "must fall inside the run execution interval",
      });
    }
    if (
      value.scheduledFor !== null &&
      Date.parse(value.scheduledFor) > started
    ) {
      context.addIssue({
        code: "custom",
        path: ["scheduledFor"],
        message: "must not follow requestStartedAt",
      });
    }
    if (value.status === "complete") {
      if (value.errorCode !== null) {
        context.addIssue({
          code: "custom",
          path: ["errorCode"],
          message: "must be null for a complete run",
        });
      }
    } else if (value.completenessReason === null) {
      context.addIssue({
        code: "custom",
        path: ["completenessReason"],
        message: "is required for a non-complete run",
      });
    }
  });

const rawManifest = z
  .object({
    id: uuidV7,
    runId: uuidV7,
    // The CAS aggregate was sealed before local entities were mapped to their
    // canonical UUIDv7 identities. Persist its exact producer UUID separately
    // so an independent verifier can bind the bytes back to this canonical run.
    producerRunId: uuidV4,
    source: rawEvidenceAdapter,
    endpoint: nullable(safeHttpsUrl),
    storageKey: rawStorageKey,
    sha256,
    byteLength: positiveSafeInteger,
    contentType: z.literal(RAW_JSON_MEDIA_TYPE),
    sourceObservedAt: nullable(timestamp),
    fetchedAt: timestamp,
    retentionClass: z.enum(["operational", "contract", "settlement", "legal_hold"]),
    retainUntil: nullable(timestamp),
    storeVersion: z.literal(1),
    purpose: rawManifestPurpose,
    responseCount: z.number().int().positive().max(2_000),
    totalResponseBytes: positiveSafeInteger,
    sealed: z.literal(true),
  })
  .strict()
  .superRefine((value, context) => {
    validateRawStorageKey(value, context);
    if (
      value.retentionClass === "legal_hold" &&
      value.retainUntil !== null
    ) {
      context.addIssue({
        code: "custom",
        path: ["retainUntil"],
        message: "must be null for legal_hold evidence",
      });
    }
    if (
      value.retentionClass !== "legal_hold" &&
      value.retainUntil !== null &&
      Date.parse(value.retainUntil) < Date.parse(value.fetchedAt)
    ) {
      context.addIssue({
        code: "custom",
        path: ["retainUntil"],
        message: "must not precede fetchedAt",
      });
    }
  });

const rawManifestEntry = z
  .object({
    id: uuidV7,
    rawManifestId: uuidV7,
    runId: uuidV7,
    ordinal: z.number().int().nonnegative().max(1_999),
    adapter: rawEvidenceAdapter,
    requestKind: rawRequestKind,
    sourceObservedAtMs: epochMilliseconds,
    mediaType: z.literal(RAW_JSON_MEDIA_TYPE),
    storageKey: rawStorageKey,
    sha256,
    byteLength: positiveSafeInteger,
  })
  .strict()
  .superRefine(validateRawStorageKey);

const video = z
  .object({
    id: uuidV7,
    creatorId: uuidV7,
    accountId: uuidV7,
    platform,
    nativeVideoId: boundedString(512),
    canonicalUrl: nullable(safeHttpsUrl),
    publishedAt: nullable(timestamp),
    publishedAtSource: z.enum([
      "platform",
      "provider",
      "url",
      "legacy_import",
      "unknown",
    ]),
    publishedAtConfidence: z.enum(["verified", "high", "low", "unknown"]),
    firstSeenAt: timestamp,
    lastSeenAt: timestamp,
    firstSeenRunId: uuidV7,
    captionFirst: nullable(z.string().max(10_000).regex(NO_CONTROL_CHARACTERS)),
    captionCurrent: nullable(z.string().max(10_000).regex(NO_CONTROL_CHARACTERS)),
    hashtagsFirst: z.array(boundedString(256)).max(100),
    durationMs: nullableNonNegativeInteger,
    availability,
    trackingState: videoTrackingState,
    observationTier,
    nextObservationAt: nullable(timestamp),
    metadata,
    ...evidenceLink,
  })
  .strict()
  .superRefine((value, context) => {
    if (Date.parse(value.lastSeenAt) < Date.parse(value.firstSeenAt)) {
      context.addIssue({
        code: "custom",
        path: ["lastSeenAt"],
        message: "must not precede firstSeenAt",
      });
    }
    if (
      value.publishedAt !== null &&
      Date.parse(value.publishedAt) > Date.parse(value.lastSeenAt)
    ) {
      context.addIssue({
        code: "custom",
        path: ["publishedAt"],
        message: "must not follow lastSeenAt",
      });
    }
    if (
      value.canonicalUrl !== null &&
      !isPlatformVideoUrl(value.canonicalUrl, value.platform)
    ) {
      context.addIssue({
        code: "custom",
        path: ["canonicalUrl"],
        message: "must be a canonical video URL for platform",
      });
    }
  });

const handleEvent = z
  .object({
    id: uuidV7,
    accountId: uuidV7,
    handle: boundedString(256),
    validFrom: timestamp,
    sourceRunId: uuidV7,
    rawManifestId: uuidV7,
    isVerified: z.boolean(),
  })
  .strict();

const observation = z
  .object({
    id: uuidV7,
    videoId: uuidV7,
    runId: uuidV7,
    adapter: boundedString(128),
    metricSchemaVersion: z.number().int().min(1).max(32_767),
    scheduledFor: nullable(timestamp),
    requestStartedAt: timestamp,
    observedAt: timestamp,
    sourceObservedAt: nullable(timestamp),
    sourceTimezone: nullable(boundedString(128)),
    views: nullableNonNegativeInteger,
    likes: nullableNonNegativeInteger,
    comments: nullableNonNegativeInteger,
    shares: nullableNonNegativeInteger,
    saves: nullableNonNegativeInteger,
    availability,
    httpStatus,
    isComplete: z.boolean(),
    confidence: z.enum(["direct", "provider", "inferred", "legacy"]),
    counterRegression: z.boolean(),
    rawManifestId: uuidV7,
    idempotencyKey: boundedString(512),
  })
  .strict()
  .superRefine((value, context) => {
    if (Date.parse(value.observedAt) < Date.parse(value.requestStartedAt)) {
      context.addIssue({
        code: "custom",
        path: ["observedAt"],
        message: "must not precede requestStartedAt",
      });
    }
    if (
      value.scheduledFor !== null &&
      Date.parse(value.scheduledFor) > Date.parse(value.requestStartedAt)
    ) {
      context.addIssue({
        code: "custom",
        path: ["scheduledFor"],
        message: "must not follow requestStartedAt",
      });
    }
    if (
      value.sourceObservedAt !== null &&
      Date.parse(value.sourceObservedAt) > Date.parse(value.observedAt)
    ) {
      context.addIssue({
        code: "custom",
        path: ["sourceObservedAt"],
        message: "must not follow observedAt",
      });
    }
    if (value.isComplete && value.availability === "available" && value.views === null) {
      context.addIssue({
        code: "custom",
        path: ["views"],
        message: "is required for a complete available observation",
      });
    }
  });

const failure = z
  .object({
    id: uuidV7,
    runId: uuidV7,
    targetType: z.enum(["organization", "account", "video", "page", "window"]),
    accountId: nullable(uuidV7),
    videoId: nullable(uuidV7),
    targetKey: nullable(boundedString(512)),
    stage: boundedString(128),
    errorCode: boundedString(128),
    httpStatus,
    retryable: z.boolean(),
    detail: metadata,
    occurredAt: timestamp,
    resolvedByRunId: nullable(uuidV7),
    idempotencyKey: boundedString(512),
  })
  .strict()
  .superRefine((value, context) => {
    const validShape =
      (value.targetType === "account" && value.accountId !== null && value.videoId === null) ||
      (value.targetType === "video" && value.videoId !== null && value.accountId === null) ||
      (["organization", "page", "window"].includes(value.targetType) &&
        value.accountId === null &&
        value.videoId === null &&
        value.targetKey !== null);
    if (!validShape) {
      context.addIssue({ code: "custom", message: "target fields do not match targetType" });
    }
  });

const coverageWindow = z
  .object({
    id: uuidV7,
    platform: nullable(platform),
    accountId: nullable(uuidV7),
    source: boundedString(128),
    windowStart: timestamp,
    windowEnd: timestamp,
    runId: uuidV7,
    status: z.enum(["complete", "partial", "capped", "stale", "failed", "unknown"]),
    expectedCount: nullableNonNegativeInteger,
    discoveredCount: nullableNonNegativeInteger,
    observedCount: nullableNonNegativeInteger,
    pagesExpected: nullableNonNegativeInteger,
    pagesFetched: nullableNonNegativeInteger,
    missingNativeIds: z.array(boundedString(512)).max(2_000),
    warningCodes: z.array(boundedString(128)).max(100),
    computedAt: timestamp,
    evidenceSha256: sha256,
    idempotencyKey: boundedString(512),
  })
  .strict()
  .superRefine((value, context) => {
    if ((value.accountId === null) !== (value.platform === null) && value.accountId !== null) {
      context.addIssue({
        code: "custom",
        message: "platform is required when accountId is present",
      });
    }
    if (Date.parse(value.windowEnd) <= Date.parse(value.windowStart)) {
      context.addIssue({ code: "custom", path: ["windowEnd"], message: "must follow windowStart" });
    }
    if (Date.parse(value.computedAt) < Date.parse(value.windowEnd)) {
      context.addIssue({ code: "custom", path: ["computedAt"], message: "must not precede windowEnd" });
    }
    if (value.status === "complete") {
      const countsMatch =
        value.expectedCount === null || value.discoveredCount === value.expectedCount;
      const pagesMatch =
        value.pagesExpected === null || value.pagesFetched === value.pagesExpected;
      if (
        value.missingNativeIds.length > 0 ||
        value.warningCodes.length > 0 ||
        !countsMatch ||
        !pagesMatch ||
        (value.pagesExpected === null && value.expectedCount === null)
      ) {
        context.addIssue({ code: "custom", message: "complete coverage has incomplete evidence" });
      }
    }
  });

const batch = z
  .object({
    id: uuidV7,
    organizationId: boundedString(256),
    idempotencyKey: boundedString(512),
    source: boundedString(128),
    collectorInstanceId: boundedString(256),
    producedAt: timestamp,
    metadata,
  })
  .strict();

export const creatorTrackerIngestionSchema = z
  .object({
    schemaVersion: z.literal(CREATOR_TRACKER_SCHEMA_VERSION),
    batch,
    creators: z.array(creator).max(1_000),
    accounts: z.array(account).max(1_000),
    runs: z.array(trackingRun).min(1).max(500),
    rawManifests: z.array(rawManifest).min(1).max(1_000),
    rawManifestEntries: z.array(rawManifestEntry).min(1).max(2_000),
    videos: z.array(video).max(2_000),
    handleEvents: z.array(handleEvent).max(1_000),
    observations: z.array(observation).max(2_000),
    failures: z.array(failure).max(2_000),
    coverageWindows: z.array(coverageWindow).max(1_000),
  })
  .strict()
  .superRefine((value, context) => {
    const arrays = [
      ["creators", value.creators],
      ["accounts", value.accounts],
      ["runs", value.runs],
      ["rawManifests", value.rawManifests],
      ["rawManifestEntries", value.rawManifestEntries],
      ["videos", value.videos],
      ["handleEvents", value.handleEvents],
      ["observations", value.observations],
      ["failures", value.failures],
      ["coverageWindows", value.coverageWindows],
    ] as const;

    const itemCount = arrays.reduce((sum, [, entries]) => sum + entries.length, 0);
    if (itemCount > CREATOR_TRACKER_MAX_BATCH_ITEMS) {
      context.addIssue({
        code: "custom",
        message: `batch exceeds ${CREATOR_TRACKER_MAX_BATCH_ITEMS} total items`,
      });
    }

    for (const [name, entries] of arrays) {
      const ids = new Set<string>();
      entries.forEach((entry, index) => {
        if (ids.has(entry.id)) {
          context.addIssue({
            code: "custom",
            path: [name, index, "id"],
            message: `duplicates an id in ${name}`,
          });
        }
        ids.add(entry.id);
      });
    }

    for (const [name, entries] of [
      ["observations", value.observations],
      ["failures", value.failures],
      ["coverageWindows", value.coverageWindows],
    ] as const) {
      const keys = new Set<string>();
      entries.forEach((entry, index) => {
        if (keys.has(entry.idempotencyKey)) {
          context.addIssue({
            code: "custom",
            path: [name, index, "idempotencyKey"],
            message: `duplicates an idempotency key in ${name}`,
          });
        }
        keys.add(entry.idempotencyKey);
      });
    }

    const runs = new Map(value.runs.map((entry) => [entry.id, entry]));
    const manifests = new Map(value.rawManifests.map((entry) => [entry.id, entry]));
    const entriesByManifest = new Map<string, typeof value.rawManifestEntries>();
    for (const entry of value.rawManifestEntries) {
      const entries = entriesByManifest.get(entry.rawManifestId) ?? [];
      entries.push(entry);
      entriesByManifest.set(entry.rawManifestId, entries);
    }
    const manifestsByRunAndHash = new Set(
      value.rawManifests.map((entry) => `${entry.runId}:${entry.sha256}`),
    );

    function requireRun(runId: string, path: (string | number)[]) {
      const run = runs.get(runId);
      if (!run) {
        context.addIssue({ code: "custom", path, message: "must reference a run in this batch" });
      }
      return run;
    }

    function requireManifest(
      manifestId: string,
      runId: string,
      path: (string | number)[],
    ) {
      const manifest = manifests.get(manifestId);
      if (!manifest || manifest.runId !== runId) {
        context.addIssue({
          code: "custom",
          path,
          message: "must reference a raw manifest for the same run in this batch",
        });
      }
      return manifest;
    }

    value.runs.forEach((run, index) => {
      if (!manifestsByRunAndHash.has(`${run.id}:${run.rawManifestSha256}`)) {
        context.addIssue({
          code: "custom",
          path: ["runs", index, "rawManifestSha256"],
          message: "must match a raw manifest for this run",
        });
      }
      if (Date.parse(run.completedAt) > Date.parse(value.batch.producedAt)) {
        context.addIssue({
          code: "custom",
          path: ["runs", index, "completedAt"],
          message: "must not follow batch.producedAt",
        });
      }
    });

    value.rawManifests.forEach((manifest, index) => {
      const run = requireRun(manifest.runId, ["rawManifests", index, "runId"]);
      if (run) {
        if (manifest.source !== run.adapter) {
          context.addIssue({
            code: "custom",
            path: ["rawManifests", index, "source"],
            message: "must match the run adapter",
          });
        }
        if (
          Date.parse(manifest.fetchedAt) < Date.parse(run.requestStartedAt) ||
          Date.parse(manifest.fetchedAt) > Date.parse(run.completedAt)
        ) {
          context.addIssue({
            code: "custom",
            path: ["rawManifests", index, "fetchedAt"],
            message: "must fall inside the run execution interval",
          });
        }
        if (
          manifest.sourceObservedAt !== null &&
          Date.parse(manifest.sourceObservedAt) > Date.parse(manifest.fetchedAt)
        ) {
          context.addIssue({
            code: "custom",
            path: ["rawManifests", index, "sourceObservedAt"],
            message: "must not follow fetchedAt",
          });
        }

        const entries = entriesByManifest.get(manifest.id) ?? [];
        const ordinals = [...entries]
          .map((entry) => entry.ordinal)
          .sort((left, right) => left - right);
        const totalResponseBytes = entries.reduce(
          (total, entry) => total + entry.byteLength,
          0,
        );
        if (
          entries.length !== manifest.responseCount ||
          ordinals.some((ordinal, ordinalIndex) => ordinal !== ordinalIndex) ||
          totalResponseBytes !== manifest.totalResponseBytes
        ) {
          context.addIssue({
            code: "custom",
            path: ["rawManifests", index],
            message: "responseCount, contiguous ordinals, and totalResponseBytes must match every child response",
          });
        }
        const latestSourceObservedAt = Math.max(
          ...entries.map((entry) => entry.sourceObservedAtMs),
        );
        if (
          manifest.sourceObservedAt === null ||
          Date.parse(manifest.sourceObservedAt) !== latestSourceObservedAt
        ) {
          context.addIssue({
            code: "custom",
            path: ["rawManifests", index, "sourceObservedAt"],
            message: "must equal the latest child response sourceObservedAt",
          });
        }
      }
    });

    value.rawManifestEntries.forEach((entry, index) => {
      const run = requireRun(entry.runId, ["rawManifestEntries", index, "runId"]);
      const manifest = requireManifest(
        entry.rawManifestId,
        entry.runId,
        ["rawManifestEntries", index, "rawManifestId"],
      );
      if (run) {
        if (entry.adapter !== run.adapter) {
          context.addIssue({
            code: "custom",
            path: ["rawManifestEntries", index, "adapter"],
            message: "must match the run adapter",
          });
        }
        const sourceObservedAt = entry.sourceObservedAtMs;
        if (
          sourceObservedAt < Date.parse(run.requestStartedAt) ||
          sourceObservedAt > Date.parse(run.completedAt)
        ) {
          context.addIssue({
            code: "custom",
            path: ["rawManifestEntries", index, "sourceObservedAtMs"],
            message: "must fall inside the run execution interval",
          });
        }
      }
      if (
        manifest &&
        !rawEvidenceVocabularyMatches(
          entry.adapter,
          manifest.purpose,
          entry.requestKind,
        )
      ) {
        context.addIssue({
          code: "custom",
          path: ["rawManifestEntries", index, "requestKind"],
          message: "must truthfully match the adapter and aggregate manifest purpose",
        });
      }
    });

    for (const [name, entries] of [
      ["creators", value.creators],
      ["accounts", value.accounts],
      ["videos", value.videos],
    ] as const) {
      entries.forEach((entry, index) => {
        requireRun(entry.evidenceRunId, [name, index, "evidenceRunId"]);
        requireManifest(entry.rawManifestId, entry.evidenceRunId, [name, index, "rawManifestId"]);
      });
    }

    const accountPlatforms = new Map(
      value.accounts.map((entry) => [entry.id, entry.platform]),
    );
    value.videos.forEach((entry, index) => {
      const incomingPlatform = accountPlatforms.get(entry.accountId);
      if (incomingPlatform && incomingPlatform !== entry.platform) {
        context.addIssue({
          code: "custom",
          path: ["videos", index, "platform"],
          message: "must match the incoming account platform",
        });
      }
      const run = runs.get(entry.evidenceRunId);
      if (
        run &&
        (Date.parse(entry.lastSeenAt) < Date.parse(run.requestStartedAt) ||
          Date.parse(entry.lastSeenAt) > Date.parse(run.completedAt))
      ) {
        context.addIssue({
          code: "custom",
          path: ["videos", index, "lastSeenAt"],
          message: "must fall inside the evidence run interval",
        });
      }
    });

    value.accounts.forEach((entry, index) => {
      const run = runs.get(entry.evidenceRunId);
      if (run && Date.parse(entry.firstSeenAt) > Date.parse(run.completedAt)) {
        context.addIssue({
          code: "custom",
          path: ["accounts", index, "firstSeenAt"],
          message: "must not follow the evidence run",
        });
      }
      if (
        run &&
        entry.lastDiscoveryAt !== null &&
        (Date.parse(entry.lastDiscoveryAt) < Date.parse(run.requestStartedAt) ||
          Date.parse(entry.lastDiscoveryAt) > Date.parse(run.completedAt))
      ) {
        context.addIssue({
          code: "custom",
          path: ["accounts", index, "lastDiscoveryAt"],
          message: "must fall inside the evidence run interval",
        });
      }
    });

    const handleAccounts = new Set<string>();
    value.handleEvents.forEach((entry, index) => {
      if (handleAccounts.has(entry.accountId)) {
        context.addIssue({
          code: "custom",
          path: ["handleEvents", index, "accountId"],
          message: "only one handle change per account is allowed in a batch",
        });
      }
      handleAccounts.add(entry.accountId);
      requireRun(entry.sourceRunId, ["handleEvents", index, "sourceRunId"]);
      requireManifest(entry.rawManifestId, entry.sourceRunId, ["handleEvents", index, "rawManifestId"]);
      const run = runs.get(entry.sourceRunId);
      if (
        run &&
        (Date.parse(entry.validFrom) < Date.parse(run.requestStartedAt) ||
          Date.parse(entry.validFrom) > Date.parse(run.completedAt))
      ) {
        context.addIssue({
          code: "custom",
          path: ["handleEvents", index, "validFrom"],
          message: "must fall inside the source run interval",
        });
      }
    });

    value.observations.forEach((entry, index) => {
      const run = requireRun(entry.runId, ["observations", index, "runId"]);
      requireManifest(entry.rawManifestId, entry.runId, ["observations", index, "rawManifestId"]);
      if (run) {
        if (entry.adapter !== run.adapter) {
          context.addIssue({
            code: "custom",
            path: ["observations", index, "adapter"],
            message: "must match the run adapter",
          });
        }
        if (
          Date.parse(entry.requestStartedAt) < Date.parse(run.requestStartedAt) ||
          Date.parse(entry.observedAt) > Date.parse(run.completedAt)
        ) {
          context.addIssue({
            code: "custom",
            path: ["observations", index],
            message: "must fall inside the run execution interval",
          });
        }
      }
    });

    value.failures.forEach((entry, index) => {
      const run = requireRun(entry.runId, ["failures", index, "runId"]);
      if (
        run &&
        (Date.parse(entry.occurredAt) < Date.parse(run.requestStartedAt) ||
          Date.parse(entry.occurredAt) > Date.parse(run.completedAt))
      ) {
        context.addIssue({
          code: "custom",
          path: ["failures", index, "occurredAt"],
          message: "must fall inside the run execution interval",
        });
      }
    });

    value.coverageWindows.forEach((entry, index) => {
      const run = requireRun(entry.runId, ["coverageWindows", index, "runId"]);
      if (!manifestsByRunAndHash.has(`${entry.runId}:${entry.evidenceSha256}`)) {
        context.addIssue({
          code: "custom",
          path: ["coverageWindows", index, "evidenceSha256"],
          message: "must match a raw manifest for this run",
        });
      }
      if (run) {
        if (entry.source !== run.adapter) {
          context.addIssue({
            code: "custom",
            path: ["coverageWindows", index, "source"],
            message: "must match the run adapter",
          });
        }
        if (
          Date.parse(entry.windowEnd) > Date.parse(run.completedAt) ||
          Date.parse(entry.computedAt) < Date.parse(run.completedAt)
        ) {
          context.addIssue({
            code: "custom",
            path: ["coverageWindows", index],
            message: "must match the completed run interval",
          });
        }
        if (entry.status === "complete" && run.status !== "complete") {
          context.addIssue({
            code: "custom",
            path: ["coverageWindows", index, "status"],
            message: "complete coverage requires a complete run",
          });
        }
      }
      if (Date.parse(entry.computedAt) > Date.parse(value.batch.producedAt)) {
        context.addIssue({
          code: "custom",
          path: ["coverageWindows", index, "computedAt"],
          message: "must not follow batch.producedAt",
        });
      }
    });
  });

export type CreatorTrackerIngestionBatch = z.infer<
  typeof creatorTrackerIngestionSchema
>;

export interface CreatorTrackerIngestionCounts {
  itemCount: number;
  observationCount: number;
  failureCount: number;
}

export function deriveIngestionCounts(
  payload: CreatorTrackerIngestionBatch,
): CreatorTrackerIngestionCounts {
  return {
    itemCount:
      payload.creators.length +
      payload.accounts.length +
      payload.runs.length +
      payload.rawManifests.length +
      payload.rawManifestEntries.length +
      payload.videos.length +
      payload.handleEvents.length +
      payload.observations.length +
      payload.failures.length +
      payload.coverageWindows.length,
    observationCount: payload.observations.length,
    failureCount: payload.failures.length,
  };
}

export function withIngestionLineage(
  metadataValue: Record<string, unknown>,
  batchId: string,
  runId: string,
  rawManifestId: string,
) {
  return {
    ...metadataValue,
    [RESERVED_METADATA_KEY]: {
      batchId,
      runId,
      rawManifestId,
      rawBytes: "externally_pre_stored_unverified",
    },
  };
}
