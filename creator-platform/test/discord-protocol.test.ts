import { describe, expect, it } from "vitest";

import {
  mapDeliveryLeaseRow,
  parseDeliveryCompletion,
  parseLeaseInput,
  parseRoleCompletion,
} from "@/server/discord/protocol";

const leaseToken = "018f55b0-0ad2-7aa3-8bbc-1f18b6252e7a";

describe("creator Discord reminder protocol", () => {
  it("bounds worker leases and maps only the fixed delivery contract", () => {
    expect(parseLeaseInput({
      workerId: "gotall-xps-discord-worker",
      bootId: "018f55b0-0ad2-7aa3-8bbc-1f18b6252e7b",
      protocolVersion: 1,
      maxMessages: 25,
      leaseSeconds: 120,
    })).not.toBeNull();
    expect(parseLeaseInput({
      workerId: "gotall-xps-discord-worker",
      bootId: "018f55b0-0ad2-7aa3-8bbc-1f18b6252e7b",
      protocolVersion: 1,
      maxMessages: 2_000,
      leaseSeconds: 120,
    })).toBeNull();

    expect(mapDeliveryLeaseRow({
      delivery_id: "delivery-1",
      template_key: "creator.test",
      template_version: 1,
      variables: {},
      raw_provider_payload: "must-not-leak",
    })).not.toHaveProperty("rawProviderPayload");
    expect(mapDeliveryLeaseRow({ requires_recovery: false })).toMatchObject({
      requiresRecovery: false,
    });
    expect(mapDeliveryLeaseRow({ requires_recovery: true })).toMatchObject({
      requiresRecovery: true,
    });
    expect(mapDeliveryLeaseRow({})).toMatchObject({ requiresRecovery: true });
  });

  it("requires a complete Discord receipt for sent and a future time for retry", () => {
    expect(parseDeliveryCompletion({
      leaseToken,
      outcome: "sent",
      discordChannelId: "1400610531189985310",
      discordMessageId: "1505873205846478848",
      renderedSha256: "a".repeat(64),
      deliveredAt: "2026-08-31T12:00:00.000Z",
    })).toMatchObject({ result: { outcome: "sent" } });

    expect(parseDeliveryCompletion({ leaseToken, outcome: "sent" })).toBeNull();
    expect(parseDeliveryCompletion({ leaseToken, outcome: "retry" })).toBeNull();
    expect(parseDeliveryCompletion({
      leaseToken,
      outcome: "unknown",
      errorClass: "bot_unauthorized",
      httpStatus: 401,
      discordCode: 0,
    })).toMatchObject({
      result: {
        outcome: "unknown",
        error_class: "bot_unauthorized",
        http_status: 401,
      },
    });
    expect(parseDeliveryCompletion({
      leaseToken,
      outcome: "retry",
      errorClass: "rate_limited",
      retryAt: "2026-08-31T12:05:00.000Z",
    })).toMatchObject({ result: { outcome: "retry", error_class: "rate_limited" } });

    expect(parseDeliveryCompletion({
      leaseToken,
      outcome: "terminal",
      errorClass: "not_guild_member",
      httpStatus: 404,
      discordCode: 10007,
    })).toMatchObject({
      result: { outcome: "terminal", error_class: "not_guild_member" },
    });
  });

  it("rejects arbitrary Discord role IDs and role names", () => {
    expect(parseRoleCompletion({
      leaseToken,
      outcome: "synced",
      observedRoleKeys: ["onboarding", "active"],
      completedAt: "2026-08-31T12:00:00.000Z",
    })).not.toBeNull();
    expect(parseRoleCompletion({
      leaseToken,
      outcome: "synced",
      observedRoleKeys: ["Administrator"],
    })).toBeNull();
  });
});
