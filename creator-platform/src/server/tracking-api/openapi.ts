const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const id = { type: "string", format: "uuid" };
const time = { type: ["string", "null"], format: "date-time" };
const counter = { type: ["integer", "null"], minimum: 0, maximum: Number.MAX_SAFE_INTEGER };
const object = (properties: Record<string, unknown>, required = Object.keys(properties)) => ({ type: "object", properties, required });
const json = (schema: unknown) => ({ "application/json": { schema } });
const response = (schema: unknown, description = "Success") => ({ description, content: json(schema) });
const errors = Object.fromEntries([400, 401, 403, 404, 409, 413, 415, 422, 429, 503].map((code) => [String(code), response(ref("Error"), `HTTP ${code}; inspect error.code and x-request-id. Retry 429 using Retry-After.`)]));
const item = (name: string) => object({ data: ref(name) });
const list = (name: string) => object({ data: { type: "array", items: ref(name) }, next_cursor: { type: ["string", "null"], format: "uuid" } });
const page = [
  { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 50 } },
  { name: "after", in: "query", schema: id, description: "Opaque continuation value from next_cursor. Results are ordered by ID, not timestamp." },
];
const pathId = { name: "id", in: "path", required: true, schema: id };
const subscriptionFilter = { name: "subscription_id", in: "query", schema: id };
const idempotency = { name: "Idempotency-Key", in: "header", required: true, schema: { type: "string", pattern: "^[A-Za-z0-9._:-]{1,128}$" }, description: "Unique per organization and request. Reusing a key with changed input returns 409. Retained for the lifetime of the organization." };
const get = (operationId: string, schema: unknown, parameters: unknown[] = []) => ({ operationId, parameters, responses: { "200": response(schema), ...errors } });

export const trackingOpenApi = {
  openapi: "3.1.0",
  info: { title: "Video Tracking API", version: "1.0.0", description: "Organization-isolated TikTok and Instagram tracking. Submit profiles or videos, poll collection jobs, and read observations. API keys are server-to-server credentials. Collection is asynchronous and subject to provider capacity; missing metrics are null. Provider observations are not raw-verified payout evidence." },
  servers: [{ url: "/api/tracking/v1" }],
  security: [{ ApiKey: [] }],
  paths: {
    "/organization": { get: get("getOrganization", item("Organization")) },
    "/subscriptions": {
      get: get("listSubscriptions", list("Subscription"), page),
      post: { operationId: "createSubscription", description: "Requires tracking:write. Starts or resumes tracking a canonical URL. Instagram also requires the numeric native_account_id of the owner. Account scans discover up to ten recent videos; capped does not mean full history. Scheduling targets 12-hour collection. An immediate refresh is limited to once per hour after a successful collection.", parameters: [idempotency], requestBody: { required: true, content: json(ref("SubscriptionInput")) }, responses: { "202": response(ref("Mutation"), "Subscription accepted; job_id may be null when current observations already exist."), ...errors } },
    },
    "/subscriptions/{id}": {
      get: get("getSubscription", item("Subscription"), [pathId]),
      patch: { operationId: "updateSubscription", parameters: [pathId], requestBody: { required: true, content: json(object({ state: { enum: ["active", "paused"] }, metadata: ref("Metadata") }, [])) }, responses: { "200": response(ref("Mutation")), ...errors } },
      delete: { operationId: "deleteSubscription", description: "Stops this organization's subscription and removes its API access through this subscription. Other subscriptions are unaffected. Historical observations are retained. An already-running request may finish.", parameters: [pathId], responses: { "200": response(ref("Mutation")), ...errors } },
    },
    "/subscriptions/{id}/refreshes": { post: { operationId: "refreshSubscription", parameters: [pathId, idempotency], responses: { "202": response(ref("Mutation")), ...errors } } },
    "/videos": { get: get("listVideos", list("Video"), [...page, subscriptionFilter]) },
    "/videos/{id}": { get: get("getVideo", item("Video"), [pathId]) },
    "/videos/{id}/observations": { get: { ...get("listObservations", list("Observation"), [pathId, ...page]), description: "Requires tracking:read. Append-only observations. Sort by observed_at client-side for a chronological chart; cursor order is by ID. A paused subscription retains read access." } },
    "/jobs": { get: get("listJobs", list("Job"), [...page, subscriptionFilter]) },
    "/jobs/{id}": { get: get("getJob", item("Job"), [pathId]) },
    "/keys": {
      get: get("listKeys", list("Key"), page),
      post: { operationId: "createKey", description: "Requires keys:manage. May only grant scopes held by the caller. The token is returned once; only its hash is stored. Create a replacement, update your client, then revoke the old key.", requestBody: { required: true, content: json(object({ name: { type: "string", minLength: 1, maxLength: 120 }, scopes: { type: "array", minItems: 1, maxItems: 3, items: { enum: ["tracking:read", "tracking:write", "keys:manage"] } }, expires_at: { type: "string", format: "date-time" } }, ["name", "scopes"])) }, responses: { "201": response(object({ data: { allOf: [ref("Key"), object({ token: { type: "string" } })] } })), ...errors } },
    },
    "/keys/{id}": { delete: { operationId: "revokeKey", parameters: [pathId], responses: { "200": response(object({ data: object({ id, revoked: { const: true } }) })), ...errors } } },
  },
  components: {
    securitySchemes: { ApiKey: { type: "http", scheme: "bearer", bearerFormat: "trk_live_..." } },
    schemas: {
      Error: object({ error: object({ code: { type: "string" }, message: { type: "string" }, request_id: id, issues: { type: "array", items: object({ path: { type: "string" }, message: { type: "string" } }) } }, ["code", "message", "request_id"]) }),
      Metadata: { type: "object", description: "Private to the organization. Maximum 2048 UTF-8 JSON bytes.", additionalProperties: { type: ["string", "number", "boolean", "null"] } },
      Organization: object({ id, name: { type: "string" }, subscription_limit: { type: "integer" }, requests_per_minute: { type: "integer" }, created_at: time }),
      SubscriptionInput: { ...object({ url: { type: "string", format: "uri", maxLength: 2048 }, native_account_id: { type: "string", pattern: "^\\d{1,64}$", description: "Required for Instagram; the numeric ID of the account which owns the profile/video." }, metadata: ref("Metadata") }, ["url"]), additionalProperties: false },
      Subscription: object({ id, state: { enum: ["active", "paused"] }, metadata: ref("Metadata"), created_at: time, updated_at: time, platform: { enum: ["tiktok", "instagram"] }, kind: { enum: ["account", "video"] }, url: { type: "string" }, native_account_id: { type: ["string", "null"] }, collection_state: { enum: ["pending", "active", "retrying", "blocked"] }, coverage: { enum: ["unknown", "complete", "capped", "empty_unconfirmed"] }, last_success_at: time, next_collection_at: time, last_error_code: { type: ["string", "null"] } }),
      Mutation: object({ data: object({ id, state: { enum: ["active", "paused", "deleted"] }, metadata: ref("Metadata"), created_at: time, updated_at: time }), job_id: { type: ["string", "null"], format: "uuid" }, replayed: { type: "boolean" } }),
      Video: object({ id, platform: { enum: ["tiktok", "instagram"] }, native_video_id: { type: "string" }, native_account_id: { type: ["string", "null"] }, url: { type: ["string", "null"] }, caption: { type: ["string", "null"] }, published_at: time, created_at: time, latest_observation: { anyOf: [ref("Observation"), { type: "null" }] } }),
      Observation: object({ id, video_id: id, observed_at: time, source_observed_at: time, source: { type: "string" }, confidence: { enum: ["direct", "provider", "inferred", "legacy"] }, views: counter, likes: counter, comments: counter, shares: counter, saves: counter, availability: { type: "string" }, is_complete: { type: "boolean" }, counter_regression: { type: "boolean" } }),
      Job: object({ id, state: { enum: ["queued", "running", "succeeded", "failed", "cancelled"] }, attempts: { type: "integer" }, error_code: { type: ["string", "null"] }, created_at: time, completed_at: time }),
      Key: object({ id, name: { type: "string" }, prefix: { type: "string" }, scopes: { type: "array", items: { type: "string" } }, created_at: time, expires_at: time, revoked_at: time, last_used_at: time }),
    },
  },
};
