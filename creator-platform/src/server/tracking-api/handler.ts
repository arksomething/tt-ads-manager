import { randomUUID } from "node:crypto";
import { ZodError } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { readBoundedCreatorTrackerBody, CreatorTrackerIngestionRequestError } from "@/lib/creator-tracker/ingestion-auth";
import { ApiError, hashToken, keyInput, newApiKey, normalizeTarget, parsePage, subscriptionInput, updateInput, uuid, workerCompletion } from "./contract";

type Client = ReturnType<typeof createAdminClient>;
type Auth = { organization_id: string; key_id: string; scopes: string[]; remaining: number; limit: number; reset_at: string };
const statusByCode: Record<string, number> = { UNAUTHORIZED: 401, NOT_FOUND: 404, RATE_LIMITED: 429, IDEMPOTENCY_CONFLICT: 409, SUBSCRIPTION_LIMIT: 409, IDENTITY_CONFLICT: 409, SUBSCRIPTION_PAUSED: 409, REFRESH_TOO_SOON: 429, LEASE_CONFLICT: 409 };

function checked(data: unknown, error: unknown): Record<string, unknown> {
  if (error || !data || typeof data !== "object") throw new ApiError(503, "SERVICE_UNAVAILABLE");
  const value = data as Record<string, unknown>;
  if (typeof value.error === "string") throw new ApiError(statusByCode[value.error] ?? 400, value.error);
  return value;
}
async function rpc(client: Client, name: string, input: Record<string, unknown>) {
  const { data, error } = await client.rpc(name, input);
  return checked(data, error);
}
async function body(request: Request) {
  if (request.headers.get("content-type")?.split(";", 1)[0].trim() !== "application/json") throw new ApiError(415, "JSON_REQUIRED");
  const bytes = await readBoundedCreatorTrackerBody(request, 65536);
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw new ApiError(400, "INVALID_JSON"); }
}
function scope(auth: Auth, needed: string) {
  if (!auth.scopes.includes(needed)) throw new ApiError(403, "INSUFFICIENT_SCOPE");
}
function id(value: string | undefined) {
  if (!value || !uuid.safeParse(value).success) throw new ApiError(404, "NOT_FOUND");
  return value;
}

export async function handleTrackingApi(request: Request, path: string[], createClient = createAdminClient) {
  const requestId = randomUUID();
  const headers = new Headers({ "content-type": "application/json", "cache-control": "private, no-store", "x-request-id": requestId });
  const respond = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers });
  try {
    const token = request.headers.get("authorization")?.match(/^Bearer (trk_live_[a-f0-9]{64})$/)?.[1];
    if (!token) throw new ApiError(401, "UNAUTHORIZED");
    const client = createClient();
    const { data: authentication, error } = await client.rpc("tracking_authenticate", { p_hash: hashToken(token) });
    if (authentication?.error === "RATE_LIMITED") headers.set("retry-after", String(authentication.retry_after ?? 60));
    const auth = checked(authentication, error) as unknown as Auth;
    headers.set("x-ratelimit-limit", String(auth.limit));
    headers.set("x-ratelimit-remaining", String(auth.remaining));
    headers.set("x-ratelimit-reset", auth.reset_at);
    const method = request.method;
    const [resource, resourceId, action] = path;
    if (path.length > 3) throw new ApiError(404, "NOT_FOUND");

    if (resource === "organization" && path.length === 1 && method === "GET") {
      scope(auth, "tracking:read");
      const { data, error } = await client.from("tracking_organizations").select("id,name,subscription_limit,requests_per_minute,created_at").eq("id", auth.organization_id).single();
      return respond({ data: checked(data, error) });
    }
    if (resource === "keys" && path.length <= 2) {
      scope(auth, "keys:manage");
      const columns = "id,name,prefix,scopes,created_at,expires_at,revoked_at,last_used_at";
      if (method === "GET" && !resourceId) {
        const page = parsePage(new URL(request.url));
        let query = client.from("tracking_api_keys").select(columns).eq("organization_id", auth.organization_id).order("id").limit(page.limit + 1);
        if (page.after) query = query.gt("id", page.after);
        const { data, error } = await query;
        if (error) throw new ApiError(503, "SERVICE_UNAVAILABLE");
        const rows = data ?? [];
        return respond({ data: rows.slice(0, page.limit), next_cursor: rows.length > page.limit ? rows[page.limit - 1].id : null });
      }
      if (method === "POST" && !resourceId) {
        const input = keyInput.parse(await body(request));
        if (input.scopes.some((item) => !auth.scopes.includes(item))) throw new ApiError(403, "SCOPE_ESCALATION");
        const { token, ...key } = newApiKey();
        const { data, error } = await client.from("tracking_api_keys").insert({ ...input, ...key, organization_id: auth.organization_id }).select(columns).single();
        return respond({ data: { ...checked(data, error), token } }, 201);
      }
      if (method === "DELETE" && resourceId) {
        const { data, error } = await client.from("tracking_api_keys").update({ revoked_at: new Date().toISOString() }).eq("id", id(resourceId)).eq("organization_id", auth.organization_id).select("id").maybeSingle();
        if (error) throw new ApiError(503, "SERVICE_UNAVAILABLE");
        if (!data) throw new ApiError(404, "NOT_FOUND");
        return respond({ data: { id: data.id, revoked: true } });
      }
    }
    if (resource === "subscriptions" && ((method === "POST" && path.length === 1) || (method === "PATCH" && path.length === 2) || (method === "DELETE" && path.length === 2) || (method === "POST" && path.length === 3 && action === "refreshes"))) {
      scope(auth, "tracking:write");
      const operation = path.length === 1 ? "subscribe" : action === "refreshes" ? "refresh" : method === "DELETE" ? "delete" : "update";
      const input = operation === "subscribe" ? normalizeTarget(subscriptionInput.parse(await body(request))) : operation === "update" ? { ...updateInput.parse(await body(request)), id: id(resourceId) } : { id: id(resourceId) };
      const key = request.headers.get("idempotency-key");
      if ((operation === "subscribe" || operation === "refresh") && !key) throw new ApiError(400, "IDEMPOTENCY_KEY_REQUIRED");
      if (key !== null && !/^[A-Za-z0-9._:-]{1,128}$/.test(key)) throw new ApiError(400, "INVALID_IDEMPOTENCY_KEY");
      const result = await rpc(client, "tracking_mutate", { p_org: auth.organization_id, p_operation: operation, p_input: input, p_key: key, p_hash: hashToken(JSON.stringify({ operation, input })) });
      const subscription = result.subscription as Record<string, unknown>;
      const { organization_id: _organization, target_id: _target, ...safe } = subscription;
      void _organization; void _target;
      if (result.job_id) headers.set("location", `/api/tracking/v1/jobs/${result.job_id}`);
      return respond({ data: safe, job_id: result.job_id, replayed: result.replayed }, operation === "subscribe" || operation === "refresh" ? 202 : 200);
    }
    if (method === "GET" && ((["subscriptions", "videos", "jobs"].includes(resource) && path.length <= 2) || (resource === "videos" && action === "observations" && path.length === 3))) {
      scope(auth, "tracking:read");
      const page = parsePage(new URL(request.url));
      const observations = action === "observations";
      const result = await rpc(client, "tracking_read", {
        p_org: auth.organization_id, p_resource: observations ? "observations" : resource,
        p_id: resourceId && !observations ? id(resourceId) : null,
        p_video: observations ? id(resourceId) : null, p_after: page.after, p_limit: page.limit, p_subscription: page.subscription,
      });
      const rows = result.data as { id: string }[];
      if (resourceId && !observations) {
        if (!rows.length) throw new ApiError(404, "NOT_FOUND");
        return respond({ data: rows[0] });
      }
      return respond({ data: rows.slice(0, page.limit), next_cursor: rows.length > page.limit ? rows[page.limit - 1].id : null });
    }
    throw new ApiError(404, "NOT_FOUND");
  } catch (error) {
    if (error instanceof ZodError) return respond({ error: { code: "VALIDATION_ERROR", message: "Request validation failed.", issues: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })), request_id: requestId } }, 422);
    const known = error instanceof ApiError || error instanceof CreatorTrackerIngestionRequestError;
    const status = known ? error.status : 503;
    if (status === 401) headers.set("www-authenticate", "Bearer");
    if (status === 429 && !headers.has("retry-after")) headers.set("retry-after", "3600");
    return respond({ error: { code: known ? error.code : "SERVICE_UNAVAILABLE", message: known ? error.message : "The tracking service is temporarily unavailable.", request_id: requestId } }, status);
  }
}

export async function handleTrackingWorker(request: Request, action: "lease" | "complete" | "sync", createClient = createAdminClient) {
  const headers = { "content-type": "application/json", "cache-control": "no-store" };
  try {
    const token = request.headers.get("authorization")?.match(/^Bearer (trk_worker_[a-f0-9]{64})$/)?.[1];
    if (!token) throw new ApiError(401, "UNAUTHORIZED");
    const client = createClient();
    const args: Record<string, unknown> = { p_hash: hashToken(token) };
    if (action === "complete") {
      const parsed = workerCompletion.parse(await body(request));
      Object.assign(args, { p_job: parsed.job_id, p_lease: parsed.lease_token, p_result: parsed.result });
    }
    const data = await rpc(client, action === "sync" ? "tracking_sync_sources" : `tracking_worker_${action}`, args);
    return new Response(JSON.stringify(data), { headers });
  } catch (error) {
    return new Response(JSON.stringify({ error: { code: error instanceof ApiError ? error.code : error instanceof ZodError ? "VALIDATION_ERROR" : "SERVICE_UNAVAILABLE" } }), { status: error instanceof ApiError ? error.status : error instanceof ZodError ? 422 : 503, headers });
  }
}
