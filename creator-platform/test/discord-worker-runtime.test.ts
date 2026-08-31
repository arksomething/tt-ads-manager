import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  classifyDiscordFailure,
  journalRow,
  markJournalSending,
  normalizeRenderFailure,
  openJournal,
  prepareJournal,
  probeDiscordBot,
  processDelivery,
  processRoleJob,
  pruneAcknowledgedJournal,
  renderTemplate,
  requestSignature,
  runCycle,
} from "../../ops/creator-platform/discord-worker/worker.mjs";

const deliveryId = "018f55b0-0ad2-7aa3-8bbc-1f18b6252e7c";
const leaseToken = "018f55b0-0ad2-7aa3-8bbc-1f18b6252e7d";
const discordUserId = "1505873205846478848";
const dmChannelId = "1505873205846478849";

function workerConfig() {
  return {
    apiOrigin: "https://gotall-creator-platform.vercel.app",
    botToken: "test-bot-token",
    workerSecret: "s".repeat(48),
    workerId: "gotall-xps-discord-worker",
    bootId: "018f55b0-0ad2-7aa3-8bbc-1f18b6252e7b",
    guildId: "1400610531189985310",
    roleIds: {},
  };
}

function leasedMessage(overrides: Record<string, unknown> = {}) {
  return {
    deliveryId,
    leaseToken,
    attemptNumber: 1,
    discordUserId,
    dmChannelId: null,
    templateKey: "creator.test",
    templateVersion: 1,
    variables: {},
    providerNonce: "gotall-test-nonce",
    requiresRecovery: false,
    ...overrides,
  };
}

function temporaryJournal() {
  const directory = mkdtempSync(join(tmpdir(), "gotall-discord-worker-"));
  return {
    directory,
    path: join(directory, "journal.sqlite"),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("persistent creator Discord worker", () => {
  it("renders only reviewed templates without arbitrary staff content", () => {
    expect(renderTemplate({
      templateKey: "creator.test",
      templateVersion: 1,
      variables: { arbitraryBody: "@everyone" },
    }, "https://gotall-creator-platform.vercel.app")).toContain("test you requested");
    expect(() => renderTemplate({
      templateKey: "staff.free_text",
      templateVersion: 1,
      variables: { body: "hello" },
    }, "https://gotall-creator-platform.vercel.app")).toThrow("unsupported_template_version");
  });

  it("normalizes renderer failures to completion API error classes", () => {
    expect(normalizeRenderFailure(new Error("unsupported_application_status")))
      .toBe("unsupported_template_version");
    expect(normalizeRenderFailure(new Error("rendered_message_too_long")))
      .toBe("rendered_message_too_long");
  });

  it("honors Discord retry semantics and treats closed DMs as terminal", () => {
    expect(classifyDiscordFailure(429, { retry_after: 2.75 }, null)).toMatchObject({
      outcome: "retry",
      errorClass: "rate_limited",
      retryAfterSeconds: 2.75,
    });
    expect(classifyDiscordFailure(403, { code: 50007 }, null)).toMatchObject({
      outcome: "terminal",
      errorClass: "dm_blocked",
    });
    expect(classifyDiscordFailure(401, { code: 0 }, null)).toMatchObject({
      outcome: "retry",
      errorClass: "bot_unauthorized",
      systemic: true,
    });
    expect(classifyDiscordFailure(403, { code: 50013 }, null)).toMatchObject({
      outcome: "retry",
      errorClass: "bot_guild_access",
      systemic: true,
    });
  });

  it("signs exact request bodies and installs a restart-persistent hardened service", () => {
    expect(requestSignature({
      secret: "s".repeat(48),
      timestamp: 1_800_000_000,
      nonce: "018f55b0-0ad2-7aa3-8bbc-1f18b6252e7a",
      workerId: "gotall-xps-discord-worker",
      method: "POST",
      pathname: "/api/internal/discord/v1/lease",
      body: "{}",
    })).toMatch(/^v1=[a-f0-9]{64}$/u);

    const unit = readFileSync(
      join(process.cwd(), "../ops/creator-platform/systemd/gotall-creator-discord-worker.service"),
      "utf8",
    );
    expect(unit).toContain("Restart=always");
    expect(unit).toContain("User=gotall-discord");
    expect(unit).toContain("Group=gotall-discord");
    expect(unit).toContain("WantedBy=multi-user.target");
    expect(unit).toContain(
      "ExecStart=/usr/local/lib/gotall-creator-discord-worker/node " +
      "/usr/local/lib/gotall-creator-discord-worker/worker.mjs",
    );
    expect(unit).toContain("LoadCredentialEncrypted=discord-bot-token:");
    expect(unit).toContain("LoadCredentialEncrypted=discord-worker-secret:");
    expect(unit).toContain("StateDirectory=gotall-creator-discord-worker");
    expect(unit).toContain("NoNewPrivileges=true");
    expect(unit).toContain("ProtectHome=true");
    expect(unit).not.toContain("/home/");
    expect(unit).not.toContain("MemoryDenyWriteExecute=true");

    const installer = readFileSync(
      join(process.cwd(), "../ops/creator-platform/discord-worker/install.mjs"),
      "utf8",
    );
    expect(installer).toContain('const serviceUser = "gotall-discord"');
    expect(installer).toContain('const runtimeDirectory = "/usr/local/lib/gotall-creator-discord-worker"');
    expect(installer).toContain('"--shell", "/usr/sbin/nologin"');
    expect(installer).toContain(
      'installRuntimeFile(workerSource, installedWorker, "0555")',
    );
    expect(installer).toContain('["mv", "-f", "--", temporaryPath, targetPath]');
    expect(installer).toContain('run(installedNode, ["--check", installedWorker])');
    expect(installer).toContain('if (wasActive) sudo(["systemctl", "stop", serviceName])');
    expect(installer).toContain('if (start || wasActive)');
    expect(installer).toContain('"chown", "-R", `${serviceUser}:${serviceUser}`, stateDirectory');
  });

  it("rechecks live guild membership before any DM and terminates departed members", async () => {
    const temporary = temporaryJournal();
    const database = await openJournal(temporary.path);
    const completions: Array<Record<string, unknown>> = [];
    const requests: string[] = [];
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      requests.push(url);
      if (url.endsWith(`/deliveries/${deliveryId}/begin`)) {
        return Response.json({ ready: true });
      }
      if (url.endsWith(`/guilds/1400610531189985310/members/${discordUserId}`)) {
        return Response.json({ code: 10007, message: "Unknown Member" }, { status: 404 });
      }
      if (url.endsWith(`/deliveries/${deliveryId}/complete`)) {
        completions.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return Response.json({ state: "dead" });
      }
      throw new Error(`unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    try {
      await processDelivery(workerConfig(), database, leasedMessage());

      expect(completions).toEqual([
        expect.objectContaining({
          outcome: "terminal",
          errorClass: "not_guild_member",
          httpStatus: 404,
          discordCode: 10007,
        }),
      ]);
      expect(requests.some((url) => url.endsWith("/users/@me/channels"))).toBe(false);
      expect(requests.some((url) => /\/channels\/\d+\/messages(?:\?|$)/u.test(url))).toBe(false);
      expect(journalRow(database, deliveryId).state).toBe("acknowledged");
    } finally {
      database.close();
      rmSync(temporary.directory, { recursive: true, force: true });
    }
  });

  it("rebinds safe prepared work from creator A to B and clears A's DM channel", async () => {
    const temporary = temporaryJournal();
    const database = await openJournal(temporary.path);
    const creatorA = discordUserId;
    const channelA = dmChannelId;
    const creatorB = "1505873205846478855";
    const channelB = "1505873205846478856";
    const providerMessageId = "1505873205846478857";
    const initial = leasedMessage({ discordUserId: creatorA, dmChannelId: channelA });
    const rebound = leasedMessage({
      leaseToken: "018f55b0-0ad2-7aa3-8bbc-1f18b6252f96",
      discordUserId: creatorB,
      dmChannelId: null,
    });
    const requests: string[] = [];
    const completions: Array<Record<string, unknown>> = [];
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      requests.push(url);
      if (url.endsWith(`/deliveries/${deliveryId}/begin`)) {
        return Response.json({ ready: true });
      }
      if (url.endsWith(`/guilds/1400610531189985310/members/${creatorB}`)) {
        return Response.json({ user: { id: creatorB } });
      }
      if (url.endsWith("/users/@me/channels")) {
        expect(JSON.parse(String(init?.body))).toEqual({ recipient_id: creatorB });
        return Response.json({ id: channelB });
      }
      if (url === `https://discord.com/api/v10/channels/${channelB}/messages`) {
        return Response.json({ id: providerMessageId });
      }
      if (url.endsWith(`/deliveries/${deliveryId}/complete`)) {
        completions.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return Response.json({ state: "sent" });
      }
      throw new Error(`unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    try {
      prepareJournal(database, initial);
      expect(journalRow(database, deliveryId)).toMatchObject({
        state: "prepared",
        discord_user_id: creatorA,
        dm_channel_id: channelA,
      });

      await processDelivery(workerConfig(), database, rebound);

      expect(requests.some((url) => url.includes(creatorA))).toBe(false);
      expect(requests.some((url) => url.includes(`/channels/${channelA}/`))).toBe(false);
      expect(completions).toEqual([
        expect.objectContaining({
          outcome: "sent",
          discordChannelId: channelB,
          discordMessageId: providerMessageId,
        }),
      ]);
      expect(journalRow(database, deliveryId)).toMatchObject({
        state: "acknowledged",
        discord_user_id: creatorB,
        dm_channel_id: channelB,
      });
    } finally {
      database.close();
      rmSync(temporary.directory, { recursive: true, force: true });
    }
  });

  it("fails closed if an ambiguous creator A lease is incorrectly retargeted to B", async () => {
    const temporary = temporaryJournal();
    const database = await openJournal(temporary.path);
    const creatorA = discordUserId;
    const channelA = dmChannelId;
    const creatorB = "1505873205846478855";
    const channelB = "1505873205846478856";
    const initial = leasedMessage({ discordUserId: creatorA, dmChannelId: channelA });
    const recoveryLease = leasedMessage({
      leaseToken: "018f55b0-0ad2-7aa3-8bbc-1f18b6252f97",
      discordUserId: creatorB,
      dmChannelId: channelB,
      requiresRecovery: true,
    });
    const requests: string[] = [];
    const completions: Array<Record<string, unknown>> = [];
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      requests.push(url);
      if (url.endsWith(`/deliveries/${deliveryId}/begin`)) {
        return Response.json({ ready: true });
      }
      if (url.endsWith(`/deliveries/${deliveryId}/complete`)) {
        completions.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return Response.json({ state: "dead" });
      }
      throw new Error(`unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    try {
      prepareJournal(database, initial);
      markJournalSending(database, deliveryId, {
        dmChannelId: channelA,
        renderedSha256: "c".repeat(64),
      });

      await processDelivery(workerConfig(), database, recoveryLease);

      expect(requests.some((url) => url.includes(creatorB))).toBe(false);
      expect(requests.some((url) => url.includes(`/channels/${channelB}/`))).toBe(false);
      expect(requests.some((url) => url.startsWith("https://discord.com/"))).toBe(false);
      expect(completions).toEqual([
        expect.objectContaining({
          outcome: "terminal",
          errorClass: "ambiguous_send_timeout",
        }),
      ]);
      expect(journalRow(database, deliveryId)).toMatchObject({
        state: "acknowledged",
        discord_user_id: creatorA,
        dm_channel_id: channelA,
      });
    } finally {
      database.close();
      rmSync(temporary.directory, { recursive: true, force: true });
    }
  });

  it("fails closed when central recovery is required but the local journal was lost", async () => {
    const temporary = temporaryJournal();
    const database = await openJournal(temporary.path);
    const completions: Array<Record<string, unknown>> = [];
    const requests: string[] = [];
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      requests.push(url);
      if (url.endsWith(`/deliveries/${deliveryId}/begin`)) {
        return Response.json({ ready: true });
      }
      if (url.endsWith(`/deliveries/${deliveryId}/complete`)) {
        completions.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return Response.json({ state: "dead" });
      }
      throw new Error(`unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    try {
      await processDelivery(workerConfig(), database, leasedMessage({
        dmChannelId,
        requiresRecovery: true,
      }));

      expect(completions).toEqual([
        expect.objectContaining({
          outcome: "terminal",
          errorClass: "ambiguous_send_timeout",
        }),
      ]);
      expect(requests.some((url) => url.startsWith("https://discord.com/"))).toBe(false);
      expect(journalRow(database, deliveryId).state).toBe("acknowledged");
    } finally {
      database.close();
      rmSync(temporary.directory, { recursive: true, force: true });
    }
  });

  it("stays fail-closed after a recovery-only lease is centrally deferred", async () => {
    const firstJournal = temporaryJournal();
    const firstDatabase = await openJournal(firstJournal.path);
    const firstRequests: string[] = [];
    const firstFetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      firstRequests.push(url);
      if (url.endsWith(`/deliveries/${deliveryId}/begin`)) {
        return Response.json({ ready: false });
      }
      throw new Error(`unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", firstFetch);

    try {
      await processDelivery(workerConfig(), firstDatabase, leasedMessage({
        dmChannelId,
        requiresRecovery: true,
      }));
      expect(firstRequests).toHaveLength(1);
      expect(firstRequests[0]).toContain(`/deliveries/${deliveryId}/begin`);
    } finally {
      firstDatabase.close();
      rmSync(firstJournal.directory, { recursive: true, force: true });
    }

    // The durable central marker must remain true when begin releases the row
    // to retry. Even after SQLite disappears during that deferral, a later
    // lease is still evidence-only and cannot contact Discord.
    const replacementJournal = temporaryJournal();
    const replacementDatabase = await openJournal(replacementJournal.path);
    const secondRequests: string[] = [];
    const completions: Array<Record<string, unknown>> = [];
    const secondFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      secondRequests.push(url);
      if (url.endsWith(`/deliveries/${deliveryId}/begin`)) {
        return Response.json({ ready: true });
      }
      if (url.endsWith(`/deliveries/${deliveryId}/complete`)) {
        completions.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return Response.json({ state: "dead" });
      }
      throw new Error(`unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", secondFetch);

    try {
      await processDelivery(workerConfig(), replacementDatabase, leasedMessage({
        leaseToken: "018f55b0-0ad2-7aa3-8bbc-1f18b6252f95",
        attemptNumber: 2,
        dmChannelId,
        requiresRecovery: true,
      }));
      expect(completions).toEqual([
        expect.objectContaining({
          outcome: "terminal",
          errorClass: "ambiguous_send_timeout",
        }),
      ]);
      expect(secondRequests.some((url) => url.startsWith("https://discord.com/"))).toBe(false);
    } finally {
      replacementDatabase.close();
      rmSync(replacementJournal.directory, { recursive: true, force: true });
    }
  });

  it("preserves the first send timestamp across re-leases and never retries an ambiguous POST", async () => {
    const temporary = temporaryJournal();
    const database = await openJournal(temporary.path);
    const initial = leasedMessage({ dmChannelId });
    const firstSendAt = new Date(Date.now() - 30_000).toISOString();
    const completions: Array<Record<string, unknown>> = [];
    const requests: string[] = [];

    try {
      prepareJournal(database, initial);
      markJournalSending(database, deliveryId, {
        dmChannelId,
        renderedSha256: "a".repeat(64),
      });
      database.prepare(`
        UPDATE delivery_journal
        SET send_started_at = ?, updated_at = ?
        WHERE delivery_id = ?
      `).run(firstSendAt, firstSendAt, deliveryId);

      const reLeased = leasedMessage({
        leaseToken: "018f55b0-0ad2-7aa3-8bbc-1f18b6252e7e",
        dmChannelId,
      });
      prepareJournal(database, reLeased);
      expect(journalRow(database, deliveryId)).toMatchObject({
        send_started_at: firstSendAt,
        updated_at: firstSendAt,
        lease_token: reLeased.leaseToken,
      });

      const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        requests.push(url);
        if (url.endsWith(`/deliveries/${deliveryId}/begin`)) {
          return Response.json({ ready: true });
        }
        if (url.endsWith(`/channels/${dmChannelId}/messages?limit=25`)) {
          return Response.json([]);
        }
        if (url.endsWith(`/deliveries/${deliveryId}/complete`)) {
          completions.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
          return Response.json({ state: "dead" });
        }
        throw new Error(`unexpected request: ${url}`);
      });
      vi.stubGlobal("fetch", fetchMock);

      await processDelivery(workerConfig(), database, reLeased);

      expect(completions).toEqual([
        expect.objectContaining({
          outcome: "terminal",
          errorClass: "ambiguous_send_timeout",
        }),
      ]);
      expect(requests.some((url) =>
        url === `https://discord.com/api/v10/channels/${dmChannelId}/messages`
      )).toBe(false);
      expect(requests.some((url) => url.includes("/guilds/"))).toBe(false);
      expect(journalRow(database, deliveryId)).toMatchObject({
        state: "acknowledged",
        send_started_at: firstSendAt,
      });
    } finally {
      database.close();
      rmSync(temporary.directory, { recursive: true, force: true });
    }
  });

  it("fails closed when ambiguous-send evidence lookup is unavailable", async () => {
    const temporary = temporaryJournal();
    const database = await openJournal(temporary.path);
    const message = leasedMessage({ dmChannelId });
    const completions: Array<Record<string, unknown>> = [];
    const requests: string[] = [];

    try {
      prepareJournal(database, message);
      markJournalSending(database, deliveryId, {
        dmChannelId,
        renderedSha256: "a".repeat(64),
      });
      const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        requests.push(url);
        if (url.endsWith(`/deliveries/${deliveryId}/begin`)) {
          return Response.json({ ready: true });
        }
        if (url.endsWith(`/channels/${dmChannelId}/messages?limit=25`)) {
          return Response.json({ message: "Unavailable" }, { status: 503 });
        }
        if (url.endsWith(`/deliveries/${deliveryId}/complete`)) {
          completions.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
          return Response.json({ state: "dead" });
        }
        throw new Error(`unexpected request: ${url}`);
      });
      vi.stubGlobal("fetch", fetchMock);

      await processDelivery(workerConfig(), database, message);

      expect(completions).toEqual([
        expect.objectContaining({
          outcome: "terminal",
          errorClass: "ambiguous_send_timeout",
        }),
      ]);
      expect(requests.some((url) =>
        url === `https://discord.com/api/v10/channels/${dmChannelId}/messages`
      )).toBe(false);
      expect(requests.some((url) => url.includes("/guilds/"))).toBe(false);
      expect(journalRow(database, deliveryId).state).toBe("acknowledged");
    } finally {
      database.close();
      rmSync(temporary.directory, { recursive: true, force: true });
    }
  });

  it("keeps systemic evidence lookup failures unknown across local journal loss", async () => {
    const firstJournal = temporaryJournal();
    const firstDatabase = await openJournal(firstJournal.path);
    const completions: Array<Record<string, unknown>> = [];
    const requests: string[] = [];
    const message = leasedMessage({ dmChannelId, requiresRecovery: true });

    try {
      prepareJournal(firstDatabase, message);
      markJournalSending(firstDatabase, deliveryId, {
        dmChannelId,
        renderedSha256: "a".repeat(64),
      });
      const firstFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        requests.push(url);
        if (url.endsWith(`/deliveries/${deliveryId}/begin`)) {
          return Response.json({ ready: true });
        }
        if (url.endsWith(`/channels/${dmChannelId}/messages?limit=25`)) {
          return Response.json({ code: 0, message: "401: Unauthorized" }, { status: 401 });
        }
        if (url.endsWith(`/deliveries/${deliveryId}/complete`)) {
          const completion = JSON.parse(String(init?.body)) as Record<string, unknown>;
          completions.push(completion);
          return Response.json({ state: "delivery_unknown" });
        }
        throw new Error(`unexpected request: ${url}`);
      });
      vi.stubGlobal("fetch", firstFetch);

      const firstResult = await processDelivery(workerConfig(), firstDatabase, message);
      expect(firstResult).toMatchObject({ systemicFailure: "bot_unauthorized" });
      expect(completions).toEqual([
        expect.objectContaining({
          outcome: "unknown",
          errorClass: "bot_unauthorized",
          httpStatus: 401,
        }),
      ]);
      expect(journalRow(firstDatabase, deliveryId).state).toBe("sending");
    } finally {
      firstDatabase.close();
      rmSync(firstJournal.directory, { recursive: true, force: true });
    }

    // Simulate a reinstall or disk loss after the central row was preserved as
    // delivery_unknown. Its next lease carries requiresRecovery=true, so an
    // empty replacement journal must terminate for review without Discord I/O.
    const replacementJournal = temporaryJournal();
    const replacementDatabase = await openJournal(replacementJournal.path);
    const secondRequests: string[] = [];
    const secondCompletions: Array<Record<string, unknown>> = [];
    const secondFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      secondRequests.push(url);
      if (url.endsWith(`/deliveries/${deliveryId}/begin`)) {
        return Response.json({ ready: true });
      }
      if (url.endsWith(`/deliveries/${deliveryId}/complete`)) {
        const completion = JSON.parse(String(init?.body)) as Record<string, unknown>;
        secondCompletions.push(completion);
        return Response.json({ state: "dead" });
      }
      throw new Error(`unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", secondFetch);

    try {
      await processDelivery(workerConfig(), replacementDatabase, leasedMessage({
        leaseToken: "018f55b0-0ad2-7aa3-8bbc-1f18b6252f90",
        attemptNumber: 2,
        dmChannelId,
        requiresRecovery: true,
      }));

      expect(secondCompletions).toEqual([
        expect.objectContaining({
          outcome: "terminal",
          errorClass: "ambiguous_send_timeout",
        }),
      ]);
      expect(secondRequests.some((url) => url.startsWith("https://discord.com/"))).toBe(false);
      expect(journalRow(replacementDatabase, deliveryId).state).toBe("acknowledged");
    } finally {
      replacementDatabase.close();
      rmSync(replacementJournal.directory, { recursive: true, force: true });
    }
  });

  it("persists recovered Discord evidence before retrying a failed central ACK", async () => {
    const temporary = temporaryJournal();
    const database = await openJournal(temporary.path);
    const providerMessageId = "1505873205846478851";
    const message = leasedMessage({ dmChannelId, requiresRecovery: true });
    let completionCalls = 0;
    let recoveryLookups = 0;
    let messagePosts = 0;
    const completions: Array<Record<string, unknown>> = [];
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith(`/deliveries/${deliveryId}/begin`)) {
        return Response.json({ ready: true });
      }
      if (url.endsWith(`/channels/${dmChannelId}/messages?limit=25`)) {
        recoveryLookups += 1;
        return Response.json([{
          id: providerMessageId,
          nonce: message.providerNonce,
          content: "Recovered test message",
        }]);
      }
      if (url === `https://discord.com/api/v10/channels/${dmChannelId}/messages`) {
        messagePosts += 1;
        return Response.json({ id: "1505873205846478852" });
      }
      if (url.endsWith(`/deliveries/${deliveryId}/complete`)) {
        completionCalls += 1;
        const completion = JSON.parse(String(init?.body)) as Record<string, unknown>;
        completions.push(completion);
        if (completionCalls === 1) {
          return Response.json({ error: "temporary" }, { status: 503 });
        }
        return Response.json({ state: "sent" });
      }
      throw new Error(`unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    try {
      prepareJournal(database, message);
      markJournalSending(database, deliveryId, {
        dmChannelId,
        renderedSha256: "b".repeat(64),
      });

      await expect(processDelivery(workerConfig(), database, message)).rejects.toThrow(
        "worker_api_503_temporary",
      );
      expect(journalRow(database, deliveryId)).toMatchObject({
        state: "discord_accepted",
        provider_message_id: providerMessageId,
        rendered_sha256: "b".repeat(64),
      });

      await processDelivery(workerConfig(), database, leasedMessage({
        leaseToken: "018f55b0-0ad2-7aa3-8bbc-1f18b6252f91",
        attemptNumber: 2,
        dmChannelId,
        requiresRecovery: true,
      }));

      expect(completions).toHaveLength(2);
      expect(completions.every((completion) => completion.outcome === "sent")).toBe(true);
      expect(completions.every((completion) => completion.discordMessageId === providerMessageId))
        .toBe(true);
      expect(recoveryLookups).toBe(1);
      expect(messagePosts).toBe(0);
      expect(journalRow(database, deliveryId).state).toBe("acknowledged");
    } finally {
      database.close();
      rmSync(temporary.directory, { recursive: true, force: true });
    }
  });

  it.each([
    ["a connection reset", () => { throw new TypeError("fetch failed"); }],
    ["a Discord 503", () => Response.json({ message: "Unavailable" }, { status: 503 })],
  ])("never blind-retries after %s during Create Message", async (_label, firstFailure) => {
    const temporary = temporaryJournal();
    const database = await openJournal(temporary.path);
    const completions: Array<Record<string, unknown>> = [];
    let messagePosts = 0;
    let recoveryLookups = 0;
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith(`/deliveries/${deliveryId}/begin`)) {
        return Response.json({ ready: true });
      }
      if (url.endsWith(`/guilds/1400610531189985310/members/${discordUserId}`)) {
        return Response.json({ user: { id: discordUserId } });
      }
      if (url === `https://discord.com/api/v10/channels/${dmChannelId}/messages`) {
        messagePosts += 1;
        return firstFailure();
      }
      if (url.endsWith(`/channels/${dmChannelId}/messages?limit=25`)) {
        recoveryLookups += 1;
        return Response.json([]);
      }
      if (url.endsWith(`/deliveries/${deliveryId}/complete`)) {
        const completion = JSON.parse(String(init?.body)) as Record<string, unknown>;
        completions.push(completion);
        return Response.json({ state: completion.outcome === "unknown" ? "delivery_unknown" : "dead" });
      }
      throw new Error(`unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    try {
      await processDelivery(workerConfig(), database, leasedMessage({ dmChannelId }));
      expect(completions[0]).toMatchObject({
        outcome: "unknown",
        errorClass: "ambiguous_send_timeout",
      });
      expect(journalRow(database, deliveryId).state).toBe("sending");

      await processDelivery(workerConfig(), database, leasedMessage({
        leaseToken: "018f55b0-0ad2-7aa3-8bbc-1f18b6252f80",
        attemptNumber: 2,
        dmChannelId,
      }));

      expect(messagePosts).toBe(1);
      expect(recoveryLookups).toBe(1);
      expect(completions[1]).toMatchObject({
        outcome: "terminal",
        errorClass: "ambiguous_send_timeout",
      });
      expect(journalRow(database, deliveryId).state).toBe("acknowledged");
    } finally {
      database.close();
      rmSync(temporary.directory, { recursive: true, force: true });
    }
  });

  it("opens a systemic circuit on bot 401 and leaves later leased messages untouched", async () => {
    const temporary = temporaryJournal();
    const database = await openJournal(temporary.path);
    const secondDeliveryId = "018f55b0-0ad2-7aa3-8bbc-1f18b6252e7f";
    const first = leasedMessage({ dmChannelId });
    const second = leasedMessage({
      deliveryId: secondDeliveryId,
      leaseToken: "018f55b0-0ad2-7aa3-8bbc-1f18b6252f7a",
      providerNonce: "gotall-second-nonce",
      dmChannelId,
    });
    const requests: string[] = [];
    const completions: Array<Record<string, unknown>> = [];
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      requests.push(url);
      if (url.endsWith("/api/internal/discord/v1/lease")) {
        return Response.json({ messages: [first, second] });
      }
      if (url.endsWith(`/deliveries/${deliveryId}/begin`)) {
        return Response.json({ ready: true });
      }
      if (url.endsWith(`/guilds/1400610531189985310/members/${discordUserId}`)) {
        return Response.json({ code: 0, message: "401: Unauthorized" }, { status: 401 });
      }
      if (url.endsWith(`/deliveries/${deliveryId}/complete`)) {
        completions.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return Response.json({ state: "retry" });
      }
      throw new Error(`unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    try {
      const result = await runCycle(workerConfig(), database);

      expect(result).toMatchObject({ systemicFailure: "bot_unauthorized" });
      expect(completions).toHaveLength(1);
      expect(completions[0]).toMatchObject({
        outcome: "retry",
        errorClass: "bot_unauthorized",
        httpStatus: 401,
      });
      expect(Date.parse(String(completions[0].retryAt))).toBeGreaterThan(Date.now() + 14 * 60_000);
      expect(requests.some((url) => url.includes(`/deliveries/${secondDeliveryId}/begin`))).toBe(false);
      expect(requests.some((url) => url.endsWith("/api/internal/discord/v1/roles/lease"))).toBe(false);
      expect(journalRow(database, deliveryId).state).toBe("prepared");
      expect(journalRow(database, secondDeliveryId)).toBeUndefined();
    } finally {
      database.close();
      rmSync(temporary.directory, { recursive: true, force: true });
    }
  });

  it("still opens the circuit when the systemic completion ACK is unavailable", async () => {
    const temporary = temporaryJournal();
    const database = await openJournal(temporary.path);
    const secondDeliveryId = "018f55b0-0ad2-7aa3-8bbc-1f18b6252f93";
    const first = leasedMessage({ dmChannelId });
    const second = leasedMessage({
      deliveryId: secondDeliveryId,
      leaseToken: "018f55b0-0ad2-7aa3-8bbc-1f18b6252f94",
      providerNonce: "gotall-third-nonce",
      dmChannelId,
    });
    const requests: string[] = [];
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      requests.push(url);
      if (url.endsWith("/api/internal/discord/v1/lease")) {
        return Response.json({ messages: [first, second] });
      }
      if (url.endsWith(`/deliveries/${deliveryId}/begin`)) {
        return Response.json({ ready: true });
      }
      if (url.endsWith(`/guilds/1400610531189985310/members/${discordUserId}`)) {
        return Response.json({ code: 0, message: "401: Unauthorized" }, { status: 401 });
      }
      if (url.endsWith(`/deliveries/${deliveryId}/complete`)) {
        return Response.json({ error: "temporary" }, { status: 503 });
      }
      throw new Error(`unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    try {
      const result = await runCycle(workerConfig(), database);

      expect(result).toMatchObject({ systemicFailure: "bot_unauthorized" });
      expect(requests.some((url) => url.includes(`/deliveries/${secondDeliveryId}/begin`)))
        .toBe(false);
      expect(requests.some((url) => url.endsWith("/api/internal/discord/v1/roles/lease")))
        .toBe(false);
      expect(journalRow(database, secondDeliveryId)).toBeUndefined();
    } finally {
      database.close();
      rmSync(temporary.directory, { recursive: true, force: true });
    }
  });

  it.each([
    [403, 50013, "Missing Permissions"],
    [404, 10011, "Unknown Role"],
  ])("opens the same circuit for bot-wide role authority failure %i/%i", async (
    failureStatus,
    failureCode,
    failureMessage,
  ) => {
    const temporary = temporaryJournal();
    const database = await openJournal(temporary.path);
    const firstJobId = "018f55b0-0ad2-7aa3-8bbc-1f18b6252f7b";
    const secondJobId = "018f55b0-0ad2-7aa3-8bbc-1f18b6252f7c";
    const secondUserId = "1505873205846478850";
    const managedRoleId = "1505873205846478854";
    const requests: string[] = [];
    const roleCompletions: Array<Record<string, unknown>> = [];
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      requests.push(url);
      if (url.endsWith("/api/internal/discord/v1/lease")) {
        return Response.json({ messages: [] });
      }
      if (url.endsWith("/api/internal/discord/v1/roles/lease")) {
        return Response.json({
          jobs: [
            {
              jobId: firstJobId,
              leaseToken,
              discordUserId,
              desiredRoleKeys: ["onboarding"],
              attemptNumber: 1,
            },
            {
              jobId: secondJobId,
              leaseToken: "018f55b0-0ad2-7aa3-8bbc-1f18b6252f7d",
              discordUserId: secondUserId,
              desiredRoleKeys: ["onboarding"],
              attemptNumber: 1,
            },
          ],
        });
      }
      if (url.endsWith(`/guilds/1400610531189985310/members/${discordUserId}`)) {
        if (failureCode === 50013) {
          return Response.json(
            { code: failureCode, message: failureMessage },
            { status: failureStatus },
          );
        }
        return Response.json({ user: { id: discordUserId }, roles: [] });
      }
      if (url.includes(`/guilds/1400610531189985310/members/${discordUserId}/roles/`)) {
        return Response.json(
          { code: failureCode, message: failureMessage },
          { status: failureStatus },
        );
      }
      if (url.endsWith(`/roles/${firstJobId}/complete`)) {
        roleCompletions.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return Response.json({ state: "retry" });
      }
      throw new Error(`unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    try {
      const result = await runCycle({
        ...workerConfig(),
        roleIds: { onboarding: managedRoleId },
      }, database);

      expect(result).toMatchObject({ systemicFailure: "bot_guild_access" });
      expect(roleCompletions).toEqual([
        expect.objectContaining({
          outcome: "retry",
          errorClass: "bot_guild_access",
          httpStatus: failureStatus,
          discordCode: failureCode,
        }),
      ]);
      expect(requests.some((url) => url.includes(secondUserId))).toBe(false);
      expect(requests.some((url) => url.endsWith(`/roles/${secondJobId}/complete`))).toBe(false);
    } finally {
      database.close();
      rmSync(temporary.directory, { recursive: true, force: true });
    }
  });

  it("marks a creator not-member when a role mutation races with guild departure", async () => {
    const jobId = "018f55b0-0ad2-7aa3-8bbc-1f18b6252f92";
    const onboardingRoleId = "1505873205846478853";
    const completions: Array<Record<string, unknown>> = [];
    const requests: string[] = [];
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      requests.push(url);
      if (url.endsWith(`/guilds/1400610531189985310/members/${discordUserId}`)) {
        return Response.json({ user: { id: discordUserId }, roles: [] });
      }
      if (url.endsWith(
        `/guilds/1400610531189985310/members/${discordUserId}/roles/${onboardingRoleId}`,
      )) {
        return Response.json({ code: 10007, message: "Unknown Member" }, { status: 404 });
      }
      if (url.endsWith(`/roles/${jobId}/complete`)) {
        completions.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return Response.json({ state: "blocked" });
      }
      throw new Error(`unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const config = {
      ...workerConfig(),
      roleIds: { onboarding: onboardingRoleId },
    };
    const result = await processRoleJob(config, {
      jobId,
      leaseToken,
      discordUserId,
      desiredRoleKeys: ["onboarding"],
      attemptNumber: 1,
    });

    expect(result).toMatchObject({ handled: true, systemicFailure: null });
    expect(completions).toEqual([
      expect.objectContaining({
        outcome: "blocked",
        errorClass: "not_guild_member",
        httpStatus: 404,
        discordCode: 10007,
      }),
    ]);
    expect(requests.filter((url) => url.includes(`/roles/${onboardingRoleId}`))).toHaveLength(1);
  });

  it("closes the circuit only after bot guild permissions and hierarchy validate", async () => {
    const botUserId = "1534630446959427686";
    const botRoleId = "1534630446959427687";
    const roleIds = {
      onboarding: "1505873205846478848",
      active: "1502369330254446602",
      at_risk: "1505873740506988595",
      top_performer: "1502367775845515295",
    };
    let botRolePosition = 10;
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/users/@me")) {
        return Response.json({ id: botUserId, bot: true });
      }
      if (url.endsWith(`/guilds/1400610531189985310/members/${botUserId}`)) {
        return Response.json({ user: { id: botUserId }, roles: [botRoleId] });
      }
      if (url.endsWith("/guilds/1400610531189985310/roles")) {
        return Response.json([
          { id: "1400610531189985310", position: 0, permissions: "0", managed: false },
          { id: botRoleId, position: botRolePosition, permissions: "268435456", managed: true },
          ...Object.values(roleIds).map((id, index) => ({
            id,
            position: index + 1,
            permissions: "0",
            managed: false,
          })),
        ]);
      }
      throw new Error(`unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const config = { ...workerConfig(), roleIds };

    await expect(probeDiscordBot(config)).resolves.toBeUndefined();

    botRolePosition = 1;
    await expect(probeDiscordBot(config)).rejects.toThrow("bot_guild_access");
  });

  it("resets a definitive 429 journal row so its retry can send", async () => {
    const temporary = temporaryJournal();
    const database = await openJournal(temporary.path);
    const completions: Array<Record<string, unknown>> = [];
    let messagePosts = 0;
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith(`/deliveries/${deliveryId}/begin`)) {
        return Response.json({ ready: true });
      }
      if (url.endsWith(`/guilds/1400610531189985310/members/${discordUserId}`)) {
        return Response.json({ user: { id: discordUserId } });
      }
      if (url === `https://discord.com/api/v10/channels/${dmChannelId}/messages`) {
        messagePosts += 1;
        return messagePosts === 1
          ? Response.json({ retry_after: 1 }, { status: 429 })
          : Response.json({ id: "1505873205846478851" });
      }
      if (url.endsWith(`/deliveries/${deliveryId}/complete`)) {
        const completion = JSON.parse(String(init?.body)) as Record<string, unknown>;
        completions.push(completion);
        return Response.json({ state: completion.outcome });
      }
      throw new Error(`unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    try {
      await processDelivery(workerConfig(), database, leasedMessage({ dmChannelId }));
      expect(journalRow(database, deliveryId).state).toBe("prepared");

      await processDelivery(workerConfig(), database, leasedMessage({
        leaseToken: "018f55b0-0ad2-7aa3-8bbc-1f18b6252f7e",
        attemptNumber: 2,
        dmChannelId,
      }));

      expect(messagePosts).toBe(2);
      expect(completions.map((completion) => completion.outcome)).toEqual(["retry", "sent"]);
      expect(journalRow(database, deliveryId).state).toBe("acknowledged");
    } finally {
      database.close();
      rmSync(temporary.directory, { recursive: true, force: true });
    }
  });

  it("can send after a definitive DM-block response is later unblocked centrally", async () => {
    const temporary = temporaryJournal();
    const database = await openJournal(temporary.path);
    const completions: Array<Record<string, unknown>> = [];
    let messagePosts = 0;
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith(`/deliveries/${deliveryId}/begin`)) {
        return Response.json({ ready: true });
      }
      if (url.endsWith(`/guilds/1400610531189985310/members/${discordUserId}`)) {
        return Response.json({ user: { id: discordUserId } });
      }
      if (url === `https://discord.com/api/v10/channels/${dmChannelId}/messages`) {
        messagePosts += 1;
        return messagePosts === 1
          ? Response.json({ code: 50007, message: "Cannot send messages to this user" }, { status: 403 })
          : Response.json({ id: "1505873205846478851" });
      }
      if (url.endsWith(`/deliveries/${deliveryId}/complete`)) {
        const completion = JSON.parse(String(init?.body)) as Record<string, unknown>;
        completions.push(completion);
        return Response.json({ state: completion.outcome });
      }
      throw new Error(`unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    try {
      await processDelivery(workerConfig(), database, leasedMessage({ dmChannelId }));
      expect(journalRow(database, deliveryId).state).toBe("acknowledged");

      await processDelivery(workerConfig(), database, leasedMessage({
        leaseToken: "018f55b0-0ad2-7aa3-8bbc-1f18b6252f7f",
        attemptNumber: 2,
        dmChannelId,
      }));

      expect(messagePosts).toBe(2);
      expect(completions).toEqual([
        expect.objectContaining({ outcome: "terminal", errorClass: "dm_blocked" }),
        expect.objectContaining({ outcome: "sent" }),
      ]);
      expect(journalRow(database, deliveryId).state).toBe("acknowledged");
    } finally {
      database.close();
      rmSync(temporary.directory, { recursive: true, force: true });
    }
  });

  it("prunes only recovery-safe acknowledged journal rows after 30 days", async () => {
    const temporary = temporaryJournal();
    const database = await openJournal(temporary.path);
    const now = Date.parse("2026-08-31T12:00:00.000Z");
    const insert = database.prepare(`
      INSERT INTO delivery_journal (
        delivery_id, provider_nonce, discord_user_id, lease_token, state, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `);

    try {
      insert.run("old-ack", "nonce-old-ack", discordUserId, leaseToken, "acknowledged", "2026-07-01T00:00:00.000Z");
      insert.run("recent-ack", "nonce-recent", discordUserId, leaseToken, "acknowledged", "2026-08-20T00:00:00.000Z");
      insert.run("old-unknown", "nonce-unknown", discordUserId, leaseToken, "unknown", "2026-07-01T00:00:00.000Z");
      insert.run("old-sending", "nonce-sending", discordUserId, leaseToken, "sending", "2026-07-01T00:00:00.000Z");

      expect(pruneAcknowledgedJournal(database, now)).toBe(1);
      expect(database.prepare("SELECT delivery_id FROM delivery_journal ORDER BY delivery_id").all())
        .toEqual([
          { delivery_id: "old-sending" },
          { delivery_id: "old-unknown" },
          { delivery_id: "recent-ack" },
        ]);
    } finally {
      database.close();
      rmSync(temporary.directory, { recursive: true, force: true });
    }
  });
});
