import { getDiscordOAuthConfig } from "@/lib/discord/config";
import { createClient } from "@/lib/supabase/server";

type UnknownRecord = Record<string, unknown>;

export type DiscordStaffRole = "reviewer" | "admin";

export type DiscordStaffMembership = {
  role: DiscordStaffRole;
};

export type DiscordOperationsConfiguration = {
  oauthConfigured: boolean;
  callbackConfigured: boolean;
};

export type DiscordQueueCounts = {
  scheduled: number;
  leased: number;
  sending: number;
  retry: number;
  blocked: number;
  deliveryUnknown: number;
  sent: number;
  cancelled: number;
  dead: number;
  actionable: number;
};

export type DiscordWorkerHealth = {
  state: "healthy" | "degraded" | "draining" | "stale" | "unavailable";
  version: string | null;
  status: "healthy" | "degraded" | "draining" | null;
  queueDepth: number | null;
  lastSeenAt: string | null;
  ageSeconds: number | null;
};

export type DiscordDeliveryFailure = {
  attemptNumber: number | null;
  deliveryState: "retry" | "blocked" | "delivery_unknown" | "dead";
  outcome: "retry" | "blocked" | "delivery_unknown" | "dead" | null;
  errorCode: string;
  providerStatus: number | null;
  attemptedAt: string | null;
};

export type DiscordOperationsOverview = {
  queue: DiscordQueueCounts & {
    oldestActionableAt: string | null;
    oldestAgeSeconds: number | null;
  };
  connections: {
    linked: number;
    members: number;
    dmBlocked: number;
    dmChannelPending: number;
  };
  roleSync: {
    scheduled: number;
    leased: number;
    retry: number;
    completed: number;
    cancelled: number;
    dead: number;
    queued: number;
    failures: number;
  };
  worker: DiscordWorkerHealth;
  recentFailures: DiscordDeliveryFailure[];
};

export const DISCORD_WORKER_STALE_AFTER_SECONDS = 120;

function recordValue(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function firstRecord(value: unknown): UnknownRecord | null {
  if (Array.isArray(value)) return recordValue(value[0]);
  return recordValue(value);
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function countValue(value: unknown) {
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string" && /^\d+$/u.test(value.trim())
      ? Number(value)
      : Number.NaN;

  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function nullableCountValue(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const count = countValue(value);
  return count === 0 && value !== 0 && value !== "0" ? null : count;
}

function timestampValue(value: unknown) {
  const candidate = stringValue(value);
  if (!candidate || Number.isNaN(Date.parse(candidate))) return null;
  return candidate;
}

function ageInSeconds(timestamp: string | null, now: Date) {
  if (!timestamp) return null;
  const age = Math.floor((now.getTime() - Date.parse(timestamp)) / 1000);
  return Number.isFinite(age) ? Math.max(0, age) : null;
}

function safeVersion(value: unknown) {
  const candidate = stringValue(value);
  if (!candidate || candidate.length > 80 || !/^[A-Za-z0-9][A-Za-z0-9._+-]*$/u.test(candidate)) {
    return null;
  }
  return candidate;
}

function safeErrorCode(value: unknown) {
  const candidate = stringValue(value);
  if (!candidate || candidate.length > 80 || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(candidate)) {
    return "unspecified";
  }
  return candidate;
}

function deliveryState(value: unknown): DiscordDeliveryFailure["deliveryState"] | null {
  const candidate = stringValue(value)?.toLowerCase();
  return candidate === "retry"
    || candidate === "blocked"
    || candidate === "delivery_unknown"
    || candidate === "dead"
    ? candidate
    : null;
}

function failureOutcome(value: unknown): DiscordDeliveryFailure["outcome"] {
  return deliveryState(value);
}

function providerStatus(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isInteger(parsed) && parsed >= 100 && parsed <= 599 ? parsed : null;
}

function normalizeFailure(value: unknown): DiscordDeliveryFailure | null {
  const record = recordValue(value);
  if (!record) return null;

  const state = deliveryState(record.delivery_state ?? record.state)
    ?? deliveryState(record.outcome);
  if (!state) return null;

  const attemptNumber = nullableCountValue(record.attempt_number);

  return {
    attemptNumber: attemptNumber && attemptNumber > 0 ? attemptNumber : null,
    deliveryState: state,
    outcome: failureOutcome(record.outcome),
    errorCode: safeErrorCode(record.error_code),
    providerStatus: providerStatus(record.provider_status),
    attemptedAt: timestampValue(record.completed_at) ?? timestampValue(record.started_at),
  };
}

function normalizeWorker(value: unknown, now: Date): DiscordWorkerHealth {
  const record = recordValue(value);
  if (!record) {
    return {
      state: "unavailable",
      version: null,
      status: null,
      queueDepth: null,
      lastSeenAt: null,
      ageSeconds: null,
    };
  }

  const lastSeenAt = timestampValue(record.last_seen_at);
  const ageSeconds = ageInSeconds(lastSeenAt, now);
  const rawStatus = stringValue(record.status)?.toLowerCase();
  const status = rawStatus === "healthy" || rawStatus === "degraded" || rawStatus === "draining"
    ? rawStatus
    : null;
  const state = ageSeconds === null
    ? "unavailable"
    : ageSeconds > DISCORD_WORKER_STALE_AFTER_SECONDS
      ? "stale"
      : status ?? "unavailable";

  return {
    state,
    version: safeVersion(record.worker_version),
    status,
    queueDepth: nullableCountValue(record.queue_depth),
    lastSeenAt,
    ageSeconds,
  };
}

/**
 * Turns the narrowly scoped staff RPC result into the only fields the page is
 * allowed to render. Unknown keys (including notification variables, receipts,
 * Discord IDs, OAuth material, and service credentials) are discarded.
 */
export function normalizeDiscordOperationsOverview(
  value: unknown,
  now = new Date(),
): DiscordOperationsOverview {
  const row = firstRecord(value);
  const root = recordValue(row?.overview) ?? row ?? {};
  const deliveries = recordValue(root.delivery_counts);
  const oldestActionable = recordValue(root.oldest_actionable);
  const connections = recordValue(root.connections);
  const roleSync = recordValue(root.role_sync);
  const roleCounts = recordValue(roleSync?.counts);

  const queueBase = {
    scheduled: countValue(deliveries?.scheduled),
    leased: countValue(deliveries?.leased),
    sending: countValue(deliveries?.sending),
    retry: countValue(deliveries?.retry),
    blocked: countValue(deliveries?.blocked),
    deliveryUnknown: countValue(deliveries?.delivery_unknown),
    sent: countValue(deliveries?.sent),
    cancelled: countValue(deliveries?.cancelled),
    dead: countValue(deliveries?.dead),
  };
  const oldestActionableAt = timestampValue(oldestActionable?.available_at)
    ?? timestampValue(oldestActionable?.created_at);

  const roleScheduled = countValue(roleCounts?.scheduled);
  const roleLeased = countValue(roleCounts?.leased);
  const roleRetry = countValue(roleCounts?.retry);

  return {
    queue: {
      ...queueBase,
      actionable: queueBase.scheduled
        + queueBase.leased
        + queueBase.sending
        + queueBase.retry
        + queueBase.deliveryUnknown,
      oldestActionableAt,
      oldestAgeSeconds: ageInSeconds(oldestActionableAt, now),
    },
    connections: {
      linked: countValue(connections?.active_count),
      members: countValue(connections?.member_count),
      dmBlocked: countValue(connections?.dm_blocked_count),
      dmChannelPending: countValue(connections?.member_without_dm_channel_count),
    },
    roleSync: {
      scheduled: roleScheduled,
      leased: roleLeased,
      retry: roleRetry,
      completed: countValue(roleCounts?.completed),
      cancelled: countValue(roleCounts?.cancelled),
      dead: countValue(roleCounts?.dead),
      queued: roleScheduled + roleLeased + roleRetry,
      failures: countValue(roleSync?.failure_count),
    },
    worker: normalizeWorker(root.worker, now),
    recentFailures: Array.isArray(root.recent_delivery_failures)
      ? root.recent_delivery_failures.flatMap((failure) => {
          const normalized = normalizeFailure(failure);
          return normalized ? [normalized] : [];
        }).slice(0, 10)
      : [],
  };
}

export function getDiscordOperationsConfiguration(): DiscordOperationsConfiguration {
  let callbackConfigured = false;
  try {
    const callback = new URL(process.env.DISCORD_OAUTH_REDIRECT_URI?.trim() ?? "");
    callbackConfigured = callback.protocol === "https:"
      && !callback.username
      && !callback.password
      && !callback.hash
      && callback.pathname === "/api/integrations/discord/callback";
  } catch {
    // The staff page reports the configuration as unavailable without exposing
    // the invalid value or the reason a secret-bearing configuration failed.
  }

  try {
    getDiscordOAuthConfig();
    return {
      oauthConfigured: true,
      callbackConfigured,
    };
  } catch {
    return {
      oauthConfigured: false,
      callbackConfigured,
    };
  }
}

export async function getCurrentDiscordStaffMembership(): Promise<DiscordStaffMembership | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_current_staff_member");
  if (error) throw error;

  const record = firstRecord(data);
  const role = stringValue(record?.staff_role);
  if (record?.active !== true || (role !== "reviewer" && role !== "admin")) return null;

  return { role };
}

export async function getDiscordOperationsOverview(): Promise<DiscordOperationsOverview> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_creator_discord_operations_overview");
  if (error) throw error;
  return normalizeDiscordOperationsOverview(data);
}
