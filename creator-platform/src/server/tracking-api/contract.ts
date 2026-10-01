import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";

export const scopes = ["tracking:read", "tracking:write", "keys:manage"] as const;
export const uuid = z.uuid();
export const metadata = z.record(z.string().max(80), z.union([z.string().max(500), z.number().finite(), z.boolean(), z.null()]))
  .refine((value) => Buffer.byteLength(JSON.stringify(value)) <= 2048, "Metadata exceeds 2048 bytes.");
export const subscriptionInput = z.object({
  url: z.url().max(2048),
  native_account_id: z.string().regex(/^\d{1,64}$/).optional(),
  metadata: metadata.default({}),
}).strict();
export const updateInput = z.object({ state: z.enum(["active", "paused"]).optional(), metadata: metadata.optional() }).strict()
  .refine((value) => Object.keys(value).length > 0);
export const keyInput = z.object({
  name: z.string().trim().min(1).max(120),
  scopes: z.array(z.enum(scopes)).min(1).max(3),
  expires_at: z.iso.datetime({ offset: true }).refine((value) => Date.parse(value) > Date.now(), "Expiration must be in the future.").optional(),
}).strict();

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string = code) { super(message); }
}

export function hashToken(value: string) { return createHash("sha256").update(value).digest("hex"); }
export function newApiKey() {
  const token = `trk_live_${randomBytes(32).toString("hex")}`;
  return { token, token_hash: hashToken(token), prefix: token.slice(0, 17) };
}

export function normalizeTarget(input: z.infer<typeof subscriptionInput>) {
  const url = new URL(input.url);
  if (url.protocol !== "https:" || url.username || url.password || url.port || /%|\\/.test(url.pathname)) {
    throw new ApiError(422, "INVALID_TARGET", "Use a full HTTPS TikTok or Instagram profile/video URL.");
  }
  const host = url.hostname.replace(/^www\./, "");
  const path = url.pathname.replace(/\/+$/, "");
  let platform: "tiktok" | "instagram";
  let kind: "account" | "video";
  let identity: string;
  let canonical: string;
  if (host === "tiktok.com") {
    platform = "tiktok";
    const match = /^\/@([A-Za-z0-9._]{1,64})(?:\/video\/(\d{1,32}))?$/.exec(path);
    if (!match) throw new ApiError(422, "INVALID_TARGET");
    kind = match[2] ? "video" : "account";
    identity = match[2] ?? match[1].toLowerCase();
    canonical = `https://www.tiktok.com/@${match[1].toLowerCase()}${match[2] ? `/video/${match[2]}` : ""}`;
  } else if (host === "instagram.com") {
    platform = "instagram";
    const video = /^\/(?:p|reel|tv)\/([A-Za-z0-9_-]{1,128})$/.exec(path);
    const account = /^\/([A-Za-z0-9._]{1,64})$/.exec(path);
    if (!video && (!account || ["explore", "accounts", "direct", "reels", "stories", "p", "reel", "tv"].includes(account[1].toLowerCase()))) throw new ApiError(422, "INVALID_TARGET");
    kind = video ? "video" : "account";
    identity = video?.[1] ?? account![1].toLowerCase();
    canonical = video ? `https://www.instagram.com/reel/${identity}/` : `https://www.instagram.com/${identity}/`;
    if (!input.native_account_id) throw new ApiError(422, "NATIVE_ACCOUNT_ID_REQUIRED", "Instagram requires the numeric owner account ID for identity verification.");
  } else {
    throw new ApiError(422, "UNSUPPORTED_PLATFORM", "Supported platforms are TikTok and Instagram. Shortened links are not accepted.");
  }
  return { platform, kind, identity, url: canonical, native_account_id: input.native_account_id ?? null, metadata: input.metadata };
}

export function parsePage(url: URL) {
  const allowed = new Set(["limit", "after", "subscription_id"]);
  for (const key of url.searchParams.keys()) {
    if (!allowed.has(key) || url.searchParams.getAll(key).length !== 1) throw new ApiError(400, "INVALID_QUERY");
  }
  const limit = url.searchParams.get("limit") ?? "50";
  if (!/^[1-9]\d{0,2}$/.test(limit) || Number(limit) > 100) throw new ApiError(400, "INVALID_LIMIT");
  const after = url.searchParams.get("after");
  const subscription = url.searchParams.get("subscription_id");
  if ((after !== null && !uuid.safeParse(after).success) || (subscription !== null && !uuid.safeParse(subscription).success)) throw new ApiError(400, "INVALID_CURSOR");
  return { limit: Number(limit), after, subscription };
}

const counter = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable();
export const workerVideo = z.object({
  native_video_id: z.string().min(1).max(128), native_account_id: z.string().min(1).max(128),
  url: z.url().max(2048), caption: z.string().max(10000).nullable(),
  published_at: z.iso.datetime({ offset: true }).nullable(),
  observed_at: z.iso.datetime({ offset: true }).refine((v) => Date.parse(v) <= Date.now() + 300000),
  source: z.enum(["scrapecreators_tiktok", "scrapecreators_instagram"]),
  views: counter, likes: counter, comments: counter, shares: counter, saves: counter,
}).strict();
export const workerCompletion = z.object({
  job_id: uuid, lease_token: uuid,
  result: z.union([
    z.object({ videos: z.array(workerVideo).max(100), coverage: z.enum(["complete", "capped", "empty_unconfirmed"]), native_account_id: z.string().min(1).max(128).optional() }).strict(),
    z.object({ error_code: z.string().regex(/^[A-Z][A-Z0-9_]{1,79}$/), blocked: z.boolean().default(false) }).strict(),
  ]),
}).strict();
