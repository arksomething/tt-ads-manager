import { describe, expect, it } from "vitest";

import {
  normalizeDiscordConnection,
  normalizeDiscordPreferences,
  normalizeDiscordReminders,
} from "@/server/accounts/discord";

describe("creator Discord read model", () => {
  it("distinguishes all persisted connection states", () => {
    expect(normalizeDiscordConnection([]).state).toBe("unlinked");
    expect(normalizeDiscordConnection([], false).state).toBe("unavailable");
    expect(normalizeDiscordConnection([{ discord_user_id: "1", guild_membership_status: "not_member" }]).state).toBe("linked_not_member");
    expect(normalizeDiscordConnection([{ discord_user_id: "1", guild_membership_status: "member" }]).state).toBe("connected");
    expect(normalizeDiscordConnection([{ discord_user_id: "1", status: "needs_attention" }]).state).toBe("needs_attention");
    expect(normalizeDiscordConnection([{ discord_user_id: "1", status: "disconnected" }]).state).toBe("disconnected");
  });

  it("keeps explicit DM consent off by default and forces gated topics off", () => {
    expect(normalizeDiscordPreferences([], [])).toEqual({
      dmOptIn: false,
      timezone: "UTC",
      quietHoursStart: "21:00",
      quietHoursEnd: "09:00",
      topics: {
        account: true,
        onboarding: true,
        posting: false,
        performance: false,
        payments: true,
      },
    });

    expect(normalizeDiscordPreferences(
      [{ dm_opt_in: true, timezone: "UTC", quiet_hours_start: "22:30:00", quiet_hours_end: "08:15:00" }],
      [{ topic: "posting", enabled: true }, { topic: "payments", enabled: false }],
    )).toMatchObject({
      dmOptIn: true,
      timezone: "UTC",
      quietHoursStart: "22:30",
      quietHoursEnd: "08:15",
      topics: { posting: false, performance: false, payments: false },
    });
  });

  it("maps provider acceptance to sent while preserving retry and terminal states", () => {
    const notifications = [
      { id: "n1", topic: "onboarding", title: "Agreement ready", created_at: "2026-08-31T14:00:00Z" },
      { id: "n2", topic: "payments", status: "cancelled", created_at: "2026-08-31T13:00:00Z" },
      { id: "n3", topic: "account", status: "dead", created_at: "2026-08-31T12:00:00Z" },
    ];
    const deliveries = [
      { notification_id: "n1", status: "accepted", accepted_at: "2026-08-31T15:00:00Z" },
      { notification_id: "n2", status: "retry_scheduled", next_attempt_at: "2026-08-31T16:00:00Z" },
    ];

    expect(normalizeDiscordReminders(notifications, deliveries)).toEqual([
      expect.objectContaining({ id: "n2", state: "retry" }),
      expect.objectContaining({ id: "n1", state: "sent" }),
      expect.objectContaining({ id: "n3", state: "dead" }),
    ]);
  });
});
