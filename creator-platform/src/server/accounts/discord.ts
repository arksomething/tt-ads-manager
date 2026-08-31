import { createClient } from "@/lib/supabase/server";

export const DISCORD_REMINDER_TOPICS = [
  "account",
  "onboarding",
  "posting",
  "performance",
  "payments",
] as const;

export type DiscordReminderTopic = (typeof DISCORD_REMINDER_TOPICS)[number];

export type CreatorDiscordConnectionState =
  | "unlinked"
  | "linked_not_member"
  | "connected"
  | "needs_attention"
  | "disconnected"
  | "unavailable";

export type CreatorDiscordConnection = {
  state: CreatorDiscordConnectionState;
  discordUserId: string | null;
  username: string | null;
  displayName: string | null;
  guildMember: boolean | null;
  verifiedAt: string | null;
  disconnectedAt: string | null;
};

export type CreatorDiscordPreferences = {
  dmOptIn: boolean;
  timezone: string;
  quietHoursStart: string;
  quietHoursEnd: string;
  topics: Record<DiscordReminderTopic, boolean>;
};

export type CreatorDiscordReminderState =
  | "scheduled"
  | "sent"
  | "retry"
  | "blocked"
  | "cancelled"
  | "dead";

export type CreatorDiscordReminder = {
  id: string;
  topic: DiscordReminderTopic | "other";
  state: CreatorDiscordReminderState;
  label: string;
  occurredAt: string | null;
};

export type CreatorDiscordOverview = {
  connection: CreatorDiscordConnection;
  preferences: CreatorDiscordPreferences;
  reminders: CreatorDiscordReminder[];
  connectionAvailable: boolean;
  preferencesAvailable: boolean;
  historyAvailable: boolean;
};

type UnknownRecord = Record<string, unknown>;

const DEFAULT_TOPICS: Record<DiscordReminderTopic, boolean> = {
  account: true,
  onboarding: true,
  posting: false,
  performance: false,
  payments: true,
};

export const DEFAULT_DISCORD_PREFERENCES: CreatorDiscordPreferences = {
  dmOptIn: false,
  timezone: "UTC",
  quietHoursStart: "21:00",
  quietHoursEnd: "09:00",
  topics: DEFAULT_TOPICS,
};

function recordValue(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function recordsValue(value: unknown): UnknownRecord[] {
  return Array.isArray(value)
    ? value.flatMap((candidate) => {
        const record = recordValue(candidate);
        return record ? [record] : [];
      })
    : [];
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function booleanValue(value: unknown) {
  return typeof value === "boolean" ? value : null;
}

function firstString(record: UnknownRecord | null, keys: string[]) {
  for (const key of keys) {
    const value = stringValue(record?.[key]);
    if (value) return value;
  }
  return null;
}

function firstBoolean(record: UnknownRecord | null, keys: string[]) {
  for (const key of keys) {
    const value = booleanValue(record?.[key]);
    if (value !== null) return value;
  }
  return null;
}

function normalizeTime(value: unknown, fallback: string) {
  const time = stringValue(value);
  const match = time?.match(/^(\d{2}):(\d{2})/u);
  return match ? `${match[1]}:${match[2]}` : fallback;
}

function normalizeTopic(value: unknown): DiscordReminderTopic | null {
  const topic = stringValue(value)?.toLowerCase();
  return DISCORD_REMINDER_TOPICS.find((candidate) => candidate === topic) ?? null;
}

export function normalizeDiscordConnection(
  value: unknown,
  available = true,
): CreatorDiscordConnection {
  if (!available) {
    return {
      state: "unavailable",
      discordUserId: null,
      username: null,
      displayName: null,
      guildMember: null,
      verifiedAt: null,
      disconnectedAt: null,
    };
  }

  const record = Array.isArray(value) ? recordValue(value[0]) : recordValue(value);
  if (!record) {
    return {
      state: "unlinked",
      discordUserId: null,
      username: null,
      displayName: null,
      guildMember: null,
      verifiedAt: null,
      disconnectedAt: null,
    };
  }

  const discordUserId = firstString(record, [
    "discord_user_id",
    "native_user_id",
    "provider_user_id",
  ]);
  const username = firstString(record, [
    "discord_username_snapshot",
    "username_snapshot",
    "discord_username",
    "username",
  ]);
  const displayName = firstString(record, [
    "discord_global_name_snapshot",
    "global_name_snapshot",
    "display_name_snapshot",
    "global_name",
    "display_name",
  ]);
  const status = firstString(record, ["connection_status", "status", "state"])
    ?.toLowerCase();
  const membershipStatus = firstString(record, [
    "guild_membership_status",
    "membership_status",
    "guild_status",
  ])?.toLowerCase();
  const memberFlag = firstBoolean(record, [
    "is_guild_member",
    "guild_member",
    "in_guild",
  ]);
  const guildMember = memberFlag ?? (
    membershipStatus === "member" || membershipStatus === "active"
      ? true
      : membershipStatus === "not_member" || membershipStatus === "missing"
        ? false
        : null
  );
  const disconnectedAt = firstString(record, ["disconnected_at", "revoked_at"]);
  const disconnected = Boolean(disconnectedAt) || [
    "disconnected",
    "revoked",
    "disabled",
  ].includes(status ?? "");
  const needsAttention = [
    "needs_attention",
    "error",
    "invalid",
    "reauthorization_required",
  ].includes(status ?? "");

  let state: CreatorDiscordConnectionState;
  if (disconnected) state = "disconnected";
  else if (needsAttention || !discordUserId) state = "needs_attention";
  else if (guildMember === false) state = "linked_not_member";
  else if (guildMember === true) state = "connected";
  else state = "needs_attention";

  return {
    state,
    discordUserId,
    username,
    displayName,
    guildMember,
    verifiedAt: firstString(record, [
      "last_verified_at",
      "verified_at",
      "connected_at",
      "updated_at",
    ]),
    disconnectedAt,
  };
}

export function normalizeDiscordPreferences(
  preferenceValue: unknown,
  subscriptionValue: unknown,
): CreatorDiscordPreferences {
  const record = Array.isArray(preferenceValue)
    ? recordValue(preferenceValue[0])
    : recordValue(preferenceValue);
  const topics = { ...DEFAULT_TOPICS };

  for (const subscription of recordsValue(subscriptionValue)) {
    const topic = normalizeTopic(
      subscription.topic ?? subscription.notification_topic ?? subscription.kind,
    );
    const enabled = firstBoolean(subscription, ["enabled", "subscribed", "opted_in"]);
    if (topic && enabled !== null) topics[topic] = enabled;
  }

  for (const topic of DISCORD_REMINDER_TOPICS) {
    const value = firstBoolean(record, [
      `${topic}_enabled`,
      `topic_${topic}`,
      `notify_${topic}`,
    ]);
    if (value !== null) topics[topic] = value;
  }

  // Posting and performance messages remain unavailable until their source
  // tracking and deal gates are authoritative, even if stale data says true.
  topics.posting = false;
  topics.performance = false;

  return {
    dmOptIn: firstBoolean(record, [
      "discord_opt_in",
      "discord_dm_opt_in",
      "dm_opt_in",
      "enabled",
    ]) ?? false,
    timezone: firstString(record, ["timezone", "time_zone"])
      ?? DEFAULT_DISCORD_PREFERENCES.timezone,
    quietHoursStart: normalizeTime(
      record?.quiet_hours_start ?? record?.quiet_start_local ?? record?.quiet_start,
      DEFAULT_DISCORD_PREFERENCES.quietHoursStart,
    ),
    quietHoursEnd: normalizeTime(
      record?.quiet_hours_end ?? record?.quiet_end_local ?? record?.quiet_end,
      DEFAULT_DISCORD_PREFERENCES.quietHoursEnd,
    ),
    topics,
  };
}

function normalizeReminderState(value: unknown): CreatorDiscordReminderState {
  const status = stringValue(value)?.toLowerCase();
  if (["accepted", "delivered", "sent", "succeeded"].includes(status ?? "")) return "sent";
  if (["retry", "retrying", "retry_scheduled", "delivery_unknown"].includes(status ?? "")) return "retry";
  if (["blocked", "suppressed", "opted_out"].includes(status ?? "")) return "blocked";
  if (["cancelled", "canceled"].includes(status ?? "")) return "cancelled";
  if (["dead", "failed", "permanent_failure", "exhausted"].includes(status ?? "")) return "dead";
  return "scheduled";
}

function timestampValue(record: UnknownRecord | null) {
  return firstString(record, [
    "accepted_at",
    "sent_at",
    "delivered_at",
    "next_attempt_at",
    "available_at",
    "scheduled_for",
    "scheduled_at",
    "created_at",
  ]);
}

function timestampNumber(record: UnknownRecord | null) {
  const value = timestampValue(record);
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isNaN(parsed) ? 0 : parsed;
}

function notificationLabel(record: UnknownRecord) {
  return firstString(record, ["title", "label", "subject"])
    ?? (() => {
      const topic = normalizeTopic(record.topic ?? record.notification_topic ?? record.kind);
      return topic
        ? `${topic[0].toUpperCase()}${topic.slice(1)} reminder`
        : "Discord reminder";
    })();
}

export function normalizeDiscordReminders(
  notificationValue: unknown,
  deliveryValue: unknown,
): CreatorDiscordReminder[] {
  const deliveries = recordsValue(deliveryValue);

  return recordsValue(notificationValue)
    .flatMap((notification) => {
      const id = firstString(notification, ["id", "notification_id"]);
      if (!id) return [];

      const matchingDeliveries = deliveries
        .filter((delivery) => firstString(delivery, ["notification_id"]) === id)
        .sort((left, right) => timestampNumber(right) - timestampNumber(left));
      const delivery = matchingDeliveries[0] ?? null;
      const state = notification.cancelled_at
        ? "cancelled"
        : normalizeReminderState(
            delivery?.delivery_status
              ?? delivery?.state
              ?? delivery?.status
              ?? notification.delivery_status
              ?? notification.status,
          );

      return [{
        id,
        topic: normalizeTopic(
          notification.topic ?? notification.notification_topic ?? notification.kind,
        ) ?? "other",
        state,
        label: notificationLabel(notification),
        occurredAt: timestampValue(delivery) ?? timestampValue(notification),
      } satisfies CreatorDiscordReminder];
    })
    .sort((left, right) => {
      const leftTime = left.occurredAt ? Date.parse(left.occurredAt) : 0;
      const rightTime = right.occurredAt ? Date.parse(right.occurredAt) : 0;
      return rightTime - leftTime;
    })
    .slice(0, 12);
}

export async function getCreatorDiscordOverview(
  accountId: string,
): Promise<CreatorDiscordOverview> {
  const supabase = await createClient();
  const [connectionResult, preferenceResult, subscriptionResult, notificationResult] =
    await Promise.all([
      supabase
        .from("creator_discord_connections")
        .select("discord_user_id, username, global_name, membership_status, connected_at, last_verified_at, disconnected_at")
        .eq("account_id", accountId)
        .order("connected_at", { ascending: false })
        .limit(1),
      supabase
        .from("creator_discord_preferences")
        .select("discord_opt_in, timezone, quiet_hours_enabled, quiet_start, quiet_end")
        .eq("account_id", accountId)
        .limit(1),
      supabase
        .from("creator_discord_subscriptions")
        .select("topic, enabled")
        .eq("account_id", accountId),
      supabase
        .from("creator_notifications")
        .select("id, topic, title, scheduled_for, cancelled_at, created_at, creator_notification_deliveries(id, notification_id, state, available_at, sent_at, created_at)")
        .eq("account_id", accountId)
        .order("scheduled_for", { ascending: false })
        .limit(12),
    ]);

  const connectionAvailable = !connectionResult.error;
  const preferencesAvailable = !preferenceResult.error && !subscriptionResult.error;
  const historyAvailable = !notificationResult.error;
  const notifications = recordsValue(notificationResult.data);
  const deliveries = notifications.flatMap((notification) =>
    recordsValue(notification.creator_notification_deliveries),
  );

  return {
    connection: normalizeDiscordConnection(connectionResult.data, connectionAvailable),
    preferences: normalizeDiscordPreferences(
      preferencesAvailable ? preferenceResult.data : null,
      preferencesAvailable ? subscriptionResult.data : null,
    ),
    reminders: historyAvailable
      ? normalizeDiscordReminders(notifications, deliveries)
      : [],
    connectionAvailable,
    preferencesAvailable,
    historyAvailable,
  };
}
