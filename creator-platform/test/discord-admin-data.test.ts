import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DISCORD_WORKER_STALE_AFTER_SECONDS,
  getDiscordOperationsConfiguration,
  normalizeDiscordOperationsOverview,
} from "@/server/admin/discord";

const now = new Date("2026-08-31T12:00:00.000Z");

describe("Discord staff operations normalization", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("normalizes queue and role counts without trusting malformed values", () => {
    const result = normalizeDiscordOperationsOverview([{
      overview: {
        delivery_counts: {
          scheduled: "4",
          leased: 2,
          sending: 1,
          retry: "3",
          delivery_unknown: 2,
          blocked: -5,
          sent: "not-a-count",
          cancelled: 1.5,
          dead: 6,
          future_state: 999,
        },
        oldest_actionable: {
          available_at: "2026-08-31T11:30:00.000Z",
        },
        role_sync: {
          counts: {
            scheduled: "2",
            leased: 1,
            retry: "4",
            completed: 30,
            cancelled: -1,
            dead: 3,
          },
          failure_count: "3",
        },
      },
    }], now);

    expect(result.queue).toMatchObject({
      scheduled: 4,
      leased: 2,
      sending: 1,
      retry: 3,
      deliveryUnknown: 2,
      blocked: 0,
      sent: 0,
      cancelled: 0,
      dead: 6,
      actionable: 12,
      oldestAgeSeconds: 1_800,
    });
    expect(result.roleSync).toMatchObject({
      queued: 7,
      completed: 30,
      cancelled: 0,
      dead: 3,
      failures: 3,
    });
    expect(JSON.stringify(result)).not.toContain("future_state");
    expect(JSON.stringify(result)).not.toContain("999");
  });

  it("marks a heartbeat stale after the four-heartbeat safety window", () => {
    const stale = normalizeDiscordOperationsOverview({
      overview: {
        worker: {
          worker_version: "1.0.0",
          status: "healthy",
          queue_depth: 0,
          last_seen_at: new Date(
            now.getTime() - (DISCORD_WORKER_STALE_AFTER_SECONDS + 1) * 1_000,
          ).toISOString(),
        },
      },
    }, now);
    const fresh = normalizeDiscordOperationsOverview({
      overview: {
        worker: {
          worker_version: "1.0.0",
          status: "healthy",
          queue_depth: 0,
          last_seen_at: new Date(
            now.getTime() - DISCORD_WORKER_STALE_AFTER_SECONDS * 1_000,
          ).toISOString(),
        },
      },
    }, now);

    expect(stale.worker.state).toBe("stale");
    expect(stale.worker.ageSeconds).toBe(121);
    expect(fresh.worker.state).toBe("healthy");
  });

  it("discards raw payloads, identities, secrets, receipts, and unsafe error text", () => {
    const result = normalizeDiscordOperationsOverview({
      overview: {
        client_secret: "oauth-secret-must-not-leak",
        bot_token: "bot-token-must-not-leak",
        notification_variables: { private: "raw-message-material" },
        connections: {
          active_count: 8,
          member_count: 7,
          dm_blocked_count: 2,
          member_without_dm_channel_count: 3,
          discord_user_id: "571179674323910667",
        },
        recent_delivery_failures: [{
          attempt_id: 44,
          delivery_id: "internal-delivery-id",
          attempt_number: 2,
          delivery_state: "sent",
          outcome: "blocked",
          error_code: "<script>raw provider body</script>",
          provider_status: 403,
          completed_at: "2026-08-31T11:59:00.000Z",
          receipt: { body: "raw-provider-response" },
          discord_user_id: "571179674323910667",
        }],
      },
    }, now);
    const rendered = JSON.stringify(result);

    expect(result.connections).toEqual({
      linked: 8,
      members: 7,
      dmBlocked: 2,
      dmChannelPending: 3,
    });
    expect(result.recentFailures).toEqual([{
      attemptNumber: 2,
      deliveryState: "blocked",
      outcome: "blocked",
      errorCode: "unspecified",
      providerStatus: 403,
      attemptedAt: "2026-08-31T11:59:00.000Z",
    }]);
    for (const forbidden of [
      "oauth-secret-must-not-leak",
      "bot-token-must-not-leak",
      "raw-message-material",
      "raw-provider-response",
      "571179674323910667",
      "internal-delivery-id",
      "<script>",
    ]) {
      expect(rendered).not.toContain(forbidden);
    }
  });

  it("reports callback and OAuth configuration independently without returning values", () => {
    vi.stubEnv(
      "DISCORD_OAUTH_REDIRECT_URI",
      "https://gethyperspeed.com/api/integrations/discord/callback",
    );
    vi.stubEnv("DISCORD_CLIENT_ID", "");
    vi.stubEnv("DISCORD_CLIENT_SECRET", "");
    vi.stubEnv("DISCORD_GUILD_ID", "");

    const status = getDiscordOperationsConfiguration();

    expect(status).toEqual({
      oauthConfigured: false,
      callbackConfigured: true,
    });
    expect(JSON.stringify(status)).not.toContain("gethyperspeed.com");
  });
});
