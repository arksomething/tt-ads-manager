import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  evaluateVideo,
  inactivityDecision,
  normalizeMentionUsers,
  openDatabase,
  payoutForViews,
  sanitizeChannelName,
  validateApplication,
} from "../../ops/creator-platform/discord-onboarding-bot/bot.mjs";

describe("Discord onboarding test bot", () => {
  it("normalizes creator names into stable channel slugs", () => {
    expect(sanitizeChannelName(" Áli GoTall!! ")).toBe("ali-gotall");
    expect(sanitizeChannelName("🔥🔥")).toBe("creator");
  });

  it("deduplicates the owner when the owner is also the test applicant", () => {
    expect(normalizeMentionUsers([
      "571179674323910667",
      "571179674323910667",
      "invalid",
    ])).toEqual(["571179674323910667"]);
  });

  it("requires core answers while allowing an omitted best video", () => {
    expect(validateApplication({
      name: "Ali Example",
      phone: "+1 555 123 4567",
      location: "New York / ET",
      platforms: "TikTok @ali",
      bestVideo: "https://tiktok.com/example",
    })).toMatchObject({ ok: true });
    expect(validateApplication({
      name: "Ali Example",
      phone: "+1 555 123 4567",
      location: "New York / ET",
      platforms: "TikTok @ali",
      bestVideo: "",
    })).toMatchObject({ ok: true, value: { bestVideo: "" } });
    expect(validateApplication({
      name: "Ali Example",
      phone: "nope",
      location: "New York / ET",
      platforms: "TikTok @ali",
      bestVideo: "http://tiktok.com/example",
    })).toMatchObject({ ok: false });
  });

  it("uses the highest reached milestone", () => {
    expect([49_999, 50_000, 100_000, 300_000, 1_000_000].map(payoutForViews))
      .toEqual([0, 20, 50, 100, 500]);
  });

  it("estimates only videos with required markers while partner remains provisional", () => {
    expect(evaluateVideo({ plug: true, mention: true, yap: true, partner: true, views: 100_000 }))
      .toMatchObject({ eligible: true, missing: [], payout: 50 });
    expect(evaluateVideo({ plug: false, mention: true, yap: true, partner: false, views: 1_000_000 }))
      .toMatchObject({ eligible: false, missing: ["GoTall plug in the video"], payout: 0 });
  });

  it("moves creators at three days and waits four full At Risk days before simulated removal", () => {
    const now = Date.parse("2026-09-03T12:00:00.000Z");
    expect(inactivityDecision({ stage: "active", lastPostAt: "2026-08-31T12:00:00.000Z", now }))
      .toBe("at_risk");
    expect(inactivityDecision({ stage: "at_risk", lastPostAt: "2026-08-27T12:00:00.000Z", riskStartedAt: "2026-08-30T12:00:00.000Z", now, testMode: true }))
      .toBe("would_remove");
    expect(inactivityDecision({
      stage: "active",
      lastPostAt: "2026-08-20T12:00:00.000Z",
      exceptionUntil: "2026-09-04T12:00:00.000Z",
      now,
    })).toBe("excepted");
  });

  it("adds the welcome receipt column when opening an existing database", async () => {
    const directory = mkdtempSync(join(tmpdir(), "gotall-onboarding-schema-"));
    const database = await openDatabase(join(directory, "test.sqlite3"));
    try {
      const columns = database.prepare("PRAGMA table_info(creators)").all() as Array<{ name: string }>;
      expect(columns.map((column) => column.name)).toContain("welcome_sent_at");
    } finally {
      database.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
