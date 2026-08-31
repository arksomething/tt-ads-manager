#!/usr/bin/env node

import {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { hostname } from "node:os";
import { readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";

const DISCORD_API_ORIGIN = "https://discord.com/api/v10";
const DEFAULT_POLL_MS = 15_000;
const DEFAULT_SCHEDULE_MS = 5 * 60_000;
const DEFAULT_HEARTBEAT_MS = 30_000;
const FETCH_TIMEOUT_MS = 20_000;
const JOURNAL_ACKNOWLEDGED_RETENTION_MS = 30 * 24 * 60 * 60_000;
const BOT_CIRCUIT_BACKOFF_MS = 15 * 60_000;
const MANAGE_ROLES_PERMISSION = 1n << 28n;

const managedRoleKeys = [
  "onboarding",
  "active",
  "at_risk",
  "top_performer",
];

const templates = Object.freeze({
  "creator.test:1": ({ appUrl }) =>
    `Your GoTall Discord reminders are connected. This is the test you requested.\n\nManage reminders: ${appUrl}/account/discord\nReplies to this message are not monitored.`,
  "application.received:1": ({ appUrl }) =>
    `We received your GoTall creator application. We will notify you when its status changes.\n\nView status: ${appUrl}/application/status\nReplies to this message are not monitored.`,
  "application.status:1": ({ appUrl, status }) => {
    const labels = {
      approved: "Your GoTall creator application was approved.",
      in_review: "Your GoTall creator application is now in review.",
      rejected: "There is an update to your GoTall creator application.",
    };
    const line = labels[status];
    if (!line) throw new Error("unsupported_application_status");
    return `${line}\n\nView the update: ${appUrl}/application/status\nReplies to this message are not monitored.`;
  },
  "agreement.ready:1": ({ appUrl }) =>
    `Your GoTall creator agreement is ready to review.\n\nReview it securely: ${appUrl}/onboarding/agreement\nReplies to this message are not monitored.`,
  "agreement.reminder:1": ({ appUrl }) =>
    `Reminder: your GoTall creator agreement is still waiting for review.\n\nContinue securely: ${appUrl}/onboarding/agreement\nReplies to this message are not monitored.`,
});

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function constantTimeEqual(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

export function requestSignature({
  secret,
  timestamp,
  nonce,
  workerId,
  method,
  pathname,
  body,
}) {
  const bodyHash = sha256(body);
  const canonical = [
    "v1",
    String(timestamp),
    nonce,
    workerId,
    method.toUpperCase(),
    pathname,
    bodyHash,
  ].join("\n");
  return `v1=${createHmac("sha256", secret).update(canonical).digest("hex")}`;
}

function parsePositiveInteger(value, fallback, minimum, maximum) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : fallback;
}

function requiredEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function readCredential(name) {
  const credentialDirectory = requiredEnvironment("CREDENTIALS_DIRECTORY");
  const value = readFileSync(`${credentialDirectory}/${name}`, "utf8").trim();
  if (!value) throw new Error(`Credential ${name} is empty.`);
  return value;
}

function normalizeOrigin(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/") {
    throw new Error("CREATOR_DISCORD_API_ORIGIN must be an HTTPS origin.");
  }
  return url.origin;
}

function snowflake(value) {
  const normalized = String(value ?? "");
  if (!/^\d{17,20}$/u.test(normalized)) throw new Error("invalid_discord_snowflake");
  return normalized;
}

function safeString(value, maximum = 120) {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u001f\u007f]/gu, " ").trim().slice(0, maximum);
}

export function renderTemplate(message, appUrl) {
  const templateKey = `${message.templateKey}:${message.templateVersion}`;
  const renderer = templates[templateKey];
  if (!renderer) throw new Error("unsupported_template_version");

  const rawVariables =
    message.variables && typeof message.variables === "object" && !Array.isArray(message.variables)
      ? message.variables
      : {};
  const variables = Object.fromEntries(
    Object.entries(rawVariables).map(([key, value]) => [key, safeString(value)]),
  );
  const content = renderer({ ...variables, appUrl });
  if (content.length > 2_000) throw new Error("rendered_message_too_long");
  return content;
}

export function normalizeRenderFailure(error) {
  return error?.message === "rendered_message_too_long"
    ? "rendered_message_too_long"
    : "unsupported_template_version";
}

export function classifyDiscordFailure(status, payload, retryAfterHeader) {
  const providerCode = Number.isInteger(payload?.code) ? payload.code : null;
  const payloadRetry = Number(payload?.retry_after);
  const headerRetry = Number(retryAfterHeader);
  const retryAfterSeconds = Number.isFinite(payloadRetry) && payloadRetry >= 0
    ? payloadRetry
    : Number.isFinite(headerRetry) && headerRetry >= 0
      ? headerRetry
      : null;

  if (status === 429) {
    return { outcome: "retry", errorClass: "rate_limited", providerCode, retryAfterSeconds };
  }
  if (status === 401) {
    return {
      outcome: "retry",
      errorClass: "bot_unauthorized",
      providerCode,
      retryAfterSeconds: null,
      systemic: true,
    };
  }
  if (providerCode === 50007) {
    return { outcome: "terminal", errorClass: "dm_blocked", providerCode, retryAfterSeconds: null };
  }
  if (providerCode === 50001 || providerCode === 50013) {
    return {
      outcome: "retry",
      errorClass: "bot_guild_access",
      providerCode,
      retryAfterSeconds: null,
      systemic: true,
    };
  }
  if (status === 403 || status === 404) {
    return { outcome: "terminal", errorClass: "discord_forbidden", providerCode, retryAfterSeconds: null };
  }
  if (status >= 500) {
    return { outcome: "retry", errorClass: "discord_unavailable", providerCode, retryAfterSeconds: null };
  }
  return { outcome: "terminal", errorClass: "discord_rejected", providerCode, retryAfterSeconds: null };
}

function retryAtFromFailure(failure, attemptNumber) {
  if (failure.systemic) {
    return new Date(Date.now() + BOT_CIRCUIT_BACKOFF_MS).toISOString();
  }
  if (failure.retryAfterSeconds !== null) {
    const jitterMs = Math.floor(Math.random() * 500);
    return new Date(Date.now() + failure.retryAfterSeconds * 1_000 + jitterMs).toISOString();
  }

  const steps = [15, 60, 300, 900, 3_600, 21_600];
  const ceilingSeconds = steps[Math.min(Math.max(attemptNumber - 1, 0), steps.length - 1)];
  return new Date(Date.now() + Math.floor(Math.random() * ceilingSeconds * 1_000)).toISOString();
}

async function readJsonResponse(response) {
  const raw = await response.text();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function discordFetch(config, pathname, init = {}) {
  const response = await fetch(`${DISCORD_API_ORIGIN}${pathname}`, {
    ...init,
    headers: {
      Authorization: `Bot ${config.botToken}`,
      "Content-Type": "application/json",
      "User-Agent": "GoTallCreatorDiscordWorker/1.0",
      ...init.headers,
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  const payload = await readJsonResponse(response);
  if (!response.ok) {
    const failure = classifyDiscordFailure(
      response.status,
      payload,
      response.headers.get("retry-after"),
    );
    const error = new Error(failure.errorClass);
    error.discordFailure = failure;
    error.httpStatus = response.status;
    throw error;
  }
  return payload;
}

async function signedApi(config, pathname, bodyObject) {
  const body = JSON.stringify(bodyObject);
  const timestamp = Math.floor(Date.now() / 1_000);
  const nonce = randomUUID();
  const signature = requestSignature({
    secret: config.workerSecret,
    timestamp,
    nonce,
    workerId: config.workerId,
    method: "POST",
    pathname,
    body,
  });
  const response = await fetch(`${config.apiOrigin}${pathname}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-GoTall-Worker-Id": config.workerId,
      "X-GoTall-Worker-Timestamp": String(timestamp),
      "X-GoTall-Worker-Nonce": nonce,
      "X-GoTall-Worker-Signature": signature,
    },
    body,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  const payload = await readJsonResponse(response);
  if (!response.ok) {
    throw new Error(`worker_api_${response.status}_${safeString(payload.error, 60)}`);
  }
  return payload;
}

async function openJournal(pathname) {
  await mkdir(dirname(pathname), { recursive: true, mode: 0o700 });
  const database = new DatabaseSync(pathname);
  database.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;");
  database.exec(`
    CREATE TABLE IF NOT EXISTS delivery_journal (
      delivery_id TEXT PRIMARY KEY,
      provider_nonce TEXT NOT NULL,
      discord_user_id TEXT NOT NULL,
      dm_channel_id TEXT,
      lease_token TEXT NOT NULL,
      state TEXT NOT NULL CHECK (state IN ('prepared', 'sending', 'discord_accepted', 'acknowledged', 'unknown')),
      provider_message_id TEXT,
      rendered_sha256 TEXT,
      send_started_at TEXT,
      updated_at TEXT NOT NULL
    );
  `);
  const columns = database.prepare("PRAGMA table_info(delivery_journal)").all();
  if (!columns.some((column) => column.name === "send_started_at")) {
    database.exec("ALTER TABLE delivery_journal ADD COLUMN send_started_at TEXT;");
  }
  pruneAcknowledgedJournal(database);
  return database;
}

function pruneAcknowledgedJournal(
  database,
  nowMs = Date.now(),
  retentionMs = JOURNAL_ACKNOWLEDGED_RETENTION_MS,
) {
  if (!Number.isFinite(nowMs) || !Number.isFinite(retentionMs) || retentionMs <= 0) {
    throw new Error("invalid_journal_retention");
  }
  const cutoff = new Date(nowMs - retentionMs).toISOString();
  return database.prepare(`
    DELETE FROM delivery_journal
    WHERE state = 'acknowledged'
      AND updated_at < ?
  `).run(cutoff).changes;
}

function journalRow(database, deliveryId) {
  return database.prepare("SELECT * FROM delivery_journal WHERE delivery_id = ?").get(deliveryId);
}

function prepareJournal(database, message) {
  database.prepare(`
    INSERT INTO delivery_journal (
      delivery_id, provider_nonce, discord_user_id, dm_channel_id,
      lease_token, state, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'prepared', ?)
    ON CONFLICT(delivery_id) DO UPDATE SET
      lease_token = excluded.lease_token,
      discord_user_id = CASE
        WHEN delivery_journal.state IN ('sending', 'unknown', 'discord_accepted')
          THEN delivery_journal.discord_user_id
        ELSE excluded.discord_user_id
      END,
      dm_channel_id = CASE
        WHEN delivery_journal.state IN ('sending', 'unknown', 'discord_accepted')
          THEN delivery_journal.dm_channel_id
        ELSE excluded.dm_channel_id
      END
  `).run(
    message.deliveryId,
    message.providerNonce,
    message.discordUserId,
    message.dmChannelId ?? null,
    message.leaseToken,
    new Date().toISOString(),
  );
}

function markJournalSending(database, deliveryId, { dmChannelId, renderedSha256 }) {
  const now = new Date().toISOString();
  database.prepare(`
    UPDATE delivery_journal
    SET state = 'sending',
        dm_channel_id = ?,
        rendered_sha256 = ?,
        send_started_at = COALESCE(send_started_at, ?),
        updated_at = ?
    WHERE delivery_id = ?
  `).run(dmChannelId, renderedSha256, now, now, deliveryId);
}

function updateJournal(database, deliveryId, fields) {
  const allowed = [
    "state",
    "dm_channel_id",
    "provider_message_id",
    "rendered_sha256",
    "lease_token",
  ];
  const entries = Object.entries(fields).filter(([key]) => allowed.includes(key));
  entries.push(["updated_at", new Date().toISOString()]);
  const assignments = entries.map(([key]) => `${key} = ?`).join(", ");
  database.prepare(`UPDATE delivery_journal SET ${assignments} WHERE delivery_id = ?`).run(
    ...entries.map(([, value]) => value),
    deliveryId,
  );
}

async function acknowledgeDelivery(config, message, result) {
  return signedApi(
    config,
    `/api/internal/discord/v1/deliveries/${message.deliveryId}/complete`,
    { leaseToken: message.leaseToken, ...result },
  );
}

async function preserveSystemicFailure(promise, errorClass) {
  try {
    return await promise;
  } catch (error) {
    if (errorClass && error && typeof error === "object") {
      error.systemicFailure = errorClass;
    }
    throw error;
  }
}

async function findMessageByNonce(config, channelId, nonce) {
  const messages = await discordFetch(
    config,
    `/channels/${snowflake(channelId)}/messages?limit=25`,
    { method: "GET" },
  );
  return Array.isArray(messages)
    ? messages.find((message) => String(message.nonce ?? "") === nonce)
    : null;
}

function systemicDiscordError(errorClass, { httpStatus = null, providerCode = null } = {}) {
  const error = new Error(errorClass);
  error.discordFailure = {
    outcome: "retry",
    errorClass,
    providerCode,
    retryAfterSeconds: null,
    systemic: true,
  };
  error.httpStatus = httpStatus;
  return error;
}

async function fetchCurrentGuildMember(config, discordUserId) {
  const expectedUserId = snowflake(discordUserId);
  try {
    const member = await discordFetch(
      config,
      `/guilds/${config.guildId}/members/${expectedUserId}`,
      { method: "GET" },
    );
    if (String(member?.user?.id ?? "") !== expectedUserId) {
      throw systemicDiscordError("bot_guild_access");
    }
    return member;
  } catch (error) {
    if (
      error?.httpStatus === 404 &&
      error?.discordFailure?.providerCode === 10007
    ) {
      const membershipError = new Error("not_guild_member");
      membershipError.discordFailure = {
        outcome: "terminal",
        errorClass: "not_guild_member",
        providerCode: 10007,
        retryAfterSeconds: null,
      };
      membershipError.httpStatus = 404;
      throw membershipError;
    }
    if (
      error?.httpStatus === 403 ||
      error?.httpStatus === 404 ||
      error?.discordFailure?.providerCode === 10004
    ) {
      throw systemicDiscordError("bot_guild_access", {
        httpStatus: error?.httpStatus ?? null,
        providerCode: error?.discordFailure?.providerCode ?? null,
      });
    }
    throw error;
  }
}

async function requireCurrentGuildMembership(config, discordUserId) {
  await fetchCurrentGuildMember(config, discordUserId);
}

async function recoverAmbiguousDelivery(config, database, message, row) {
  if (
    !row.dm_channel_id ||
    (row.state !== "sending" && row.state !== "unknown")
  ) return null;

  let existing = null;
  try {
    existing = await findMessageByNonce(config, row.dm_channel_id, row.provider_nonce);
  } catch (error) {
    if (error?.discordFailure?.systemic) {
      // The POST outcome remains uncertain even when the bot itself cannot
      // perform the evidence lookup. Keep the authoritative row in
      // delivery_unknown while opening the worker-wide circuit; storing this
      // as an ordinary retry could permit a blind resend after journal loss.
      await preserveSystemicFailure(
        acknowledgeDelivery(config, message, {
          outcome: "unknown",
          errorClass: error.discordFailure.errorClass,
          httpStatus: error?.httpStatus ?? null,
          discordCode: error.discordFailure.providerCode,
        }),
        error.discordFailure.errorClass,
      );
      return { handled: true, systemicFailure: error.discordFailure.errorClass };
    }
    // A failed evidence lookup is ambiguous too. Discord does not promise a
    // duration in which nonce de-duplication remains effective, so recovery
    // must never turn an uncertain POST into another POST.
  }

  if (existing?.id) {
    const providerMessageId = snowflake(existing.id);
    const renderedSha256 = row.rendered_sha256 || sha256(String(existing.content ?? ""));
    // Persist positive Discord evidence before acknowledging centrally. If the
    // completion call fails, the next lease re-ACKs this exact message ID and
    // never falls through to an ambiguous terminal result or a second POST.
    updateJournal(database, message.deliveryId, {
      state: "discord_accepted",
      provider_message_id: providerMessageId,
      rendered_sha256: renderedSha256,
    });
    await acknowledgeDelivery(config, message, {
      outcome: "sent",
      discordChannelId: row.dm_channel_id,
      discordMessageId: providerMessageId,
      renderedSha256,
      deliveredAt: new Date().toISOString(),
    });
    updateJournal(database, message.deliveryId, { state: "acknowledged" });
    return { handled: true, systemicFailure: null };
  }

  await acknowledgeDelivery(config, message, {
    outcome: "terminal",
    errorClass: "ambiguous_send_timeout",
  });
  updateJournal(database, message.deliveryId, { state: "acknowledged" });
  return { handled: true, systemicFailure: null };
}

async function processDelivery(config, database, message) {
  prepareJournal(database, message);
  const row = journalRow(database, message.deliveryId);

  const begin = await signedApi(
    config,
    `/api/internal/discord/v1/deliveries/${message.deliveryId}/begin`,
    { leaseToken: message.leaseToken },
  );
  if (!begin.ready) return;

  const hasLocalAmbiguousState =
    row.state === "sending" || row.state === "unknown" || row.state === "discord_accepted";
  const recoveryIdentityMismatch = hasLocalAmbiguousState && (
    String(message.discordUserId ?? "") !== String(row.discord_user_id ?? "") ||
    (
      message.dmChannelId && row.dm_channel_id &&
      String(message.dmChannelId) !== String(row.dm_channel_id)
    )
  );
  if (recoveryIdentityMismatch) {
    // A recovery lease must be pinned to the same recipient as the local send
    // evidence. Fail closed on schema/protocol skew so an A-channel receipt can
    // never be written onto a relinked B connection.
    await acknowledgeDelivery(config, message, {
      outcome: "terminal",
      errorClass: "ambiguous_send_timeout",
    });
    updateJournal(database, message.deliveryId, { state: "acknowledged" });
    return { handled: true, systemicFailure: null };
  }

  const hasRecoveryEvidence =
    row.state === "discord_accepted"
      ? Boolean(row.provider_message_id && row.dm_channel_id)
      : (row.state === "sending" || row.state === "unknown")
        ? Boolean(row.dm_channel_id)
        : false;
  if (message.requiresRecovery !== false && !hasRecoveryEvidence) {
    await acknowledgeDelivery(config, message, {
      outcome: "terminal",
      errorClass: "ambiguous_send_timeout",
    });
    updateJournal(database, message.deliveryId, { state: "acknowledged" });
    return { handled: true, systemicFailure: null };
  }

  if (row.state === "discord_accepted" && row.provider_message_id && row.dm_channel_id) {
    await acknowledgeDelivery(config, message, {
      outcome: "sent",
      discordChannelId: row.dm_channel_id,
      discordMessageId: row.provider_message_id,
      renderedSha256: row.rendered_sha256,
      deliveredAt: row.updated_at,
    });
    updateJournal(database, message.deliveryId, { state: "acknowledged" });
    return;
  }

  const recovery = await recoverAmbiguousDelivery(config, database, message, row);
  if (recovery?.handled) return recovery;

  let content;
  try {
    content = renderTemplate(message, config.apiOrigin);
  } catch (error) {
    await acknowledgeDelivery(config, message, {
      outcome: "terminal",
      // Keep the worker/API error vocabulary closed. Template-specific
      // renderer errors must not poison completion and leave the lease looping.
      errorClass: normalizeRenderFailure(error),
    });
    updateJournal(database, message.deliveryId, { state: "acknowledged" });
    return;
  }
  const renderedSha256 = sha256(content);
  let dmChannelId = row.dm_channel_id || message.dmChannelId;
  let messageSendStarted = false;

  try {
    // OAuth membership is only a point-in-time link check. Revalidate with the
    // bot immediately before every actual creator DM send so departed members
    // cannot continue receiving reminders from a stale connection row.
    await requireCurrentGuildMembership(config, message.discordUserId);

    if (!dmChannelId) {
      const dm = await discordFetch(config, "/users/@me/channels", {
        method: "POST",
        body: JSON.stringify({ recipient_id: snowflake(message.discordUserId) }),
      });
      dmChannelId = snowflake(dm.id);
    }

    markJournalSending(database, message.deliveryId, {
      dmChannelId,
      renderedSha256,
    });

    messageSendStarted = true;
    const sent = await discordFetch(config, `/channels/${dmChannelId}/messages`, {
      method: "POST",
      body: JSON.stringify({
        content,
        nonce: message.providerNonce,
        enforce_nonce: true,
        allowed_mentions: { parse: [] },
      }),
    });
    const providerMessageId = snowflake(sent.id);
    updateJournal(database, message.deliveryId, {
      state: "discord_accepted",
      provider_message_id: providerMessageId,
    });
    await acknowledgeDelivery(config, message, {
      outcome: "sent",
      discordChannelId: dmChannelId,
      discordMessageId: providerMessageId,
      renderedSha256,
      deliveredAt: new Date().toISOString(),
    });
    updateJournal(database, message.deliveryId, { state: "acknowledged" });
  } catch (error) {
    if (error?.name === "TimeoutError" || error?.name === "AbortError") {
      if (messageSendStarted) {
        // Keep the local row in `sending`. On the next lease recovery searches
        // Discord by the stable nonce; without positive evidence it terminates
        // for manual review and never issues another message POST.
        await acknowledgeDelivery(config, message, {
          outcome: "unknown",
          errorClass: "ambiguous_send_timeout",
        });
      } else {
        await acknowledgeDelivery(config, message, {
          outcome: "retry",
          errorClass: "network_error",
          retryAt: new Date(Date.now() + 15_000).toISOString(),
        });
      }
      return;
    }

    const currentJournal = journalRow(database, message.deliveryId);
    if (
      messageSendStarted &&
      (
        !error?.discordFailure ||
        (Number.isInteger(error?.httpStatus) && error.httpStatus >= 500)
      ) &&
      currentJournal?.state === "sending"
    ) {
      await acknowledgeDelivery(config, message, {
        outcome: "unknown",
        errorClass: "ambiguous_send_timeout",
      });
      return;
    }
    if (!error?.discordFailure && currentJournal?.state === "discord_accepted") {
      // Discord acceptance is durable locally. Let the central lease expire;
      // the next lease will ACK this exact message ID without another send.
      throw error;
    }

    const failure = error?.discordFailure ?? {
      outcome: "retry",
      errorClass: "network_error",
      providerCode: null,
      retryAfterSeconds: null,
    };
    if (error?.discordFailure) {
      // An HTTP response is definitive: Discord did not accept this POST.
      // Reset known failures before central completion so a lost ACK cannot
      // make the next lease enter ambiguous-send recovery.
      updateJournal(database, message.deliveryId, { state: "prepared" });
    }
    await preserveSystemicFailure(
      acknowledgeDelivery(config, message, {
        outcome: failure.outcome,
        errorClass: failure.errorClass,
        httpStatus: error?.httpStatus ?? null,
        discordCode: failure.providerCode,
        retryAt: failure.outcome === "retry"
          ? retryAtFromFailure(failure, message.attemptNumber)
          : null,
      }),
      failure.systemic ? failure.errorClass : null,
    );
    if (failure.outcome === "terminal") {
      updateJournal(database, message.deliveryId, { state: "acknowledged" });
    }
    return failure.systemic
      ? { handled: true, systemicFailure: failure.errorClass }
      : { handled: true, systemicFailure: null };
  }
}

function desiredRoleIds(config, desiredRoleKeys) {
  const uniqueKeys = [...new Set(Array.isArray(desiredRoleKeys) ? desiredRoleKeys : [])];
  if (uniqueKeys.some((key) => !managedRoleKeys.includes(key))) {
    throw new Error("unsupported_managed_role_key");
  }
  return new Set(uniqueKeys.map((key) => config.roleIds[key]));
}

async function processRoleJob(config, job) {
  const completePath = `/api/internal/discord/v1/roles/${job.jobId}/complete`;
  try {
    const member = await fetchCurrentGuildMember(config, job.discordUserId);
    const currentRoles = new Set(Array.isArray(member.roles) ? member.roles.map(String) : []);
    const desired = desiredRoleIds(config, job.desiredRoleKeys);
    const managed = new Set(Object.values(config.roleIds));

    for (const roleId of managed) {
      if (desired.has(roleId) && !currentRoles.has(roleId)) {
        await discordFetch(
          config,
          `/guilds/${config.guildId}/members/${job.discordUserId}/roles/${roleId}`,
          { method: "PUT", body: "{}" },
        );
      } else if (!desired.has(roleId) && currentRoles.has(roleId)) {
        await discordFetch(
          config,
          `/guilds/${config.guildId}/members/${job.discordUserId}/roles/${roleId}`,
          { method: "DELETE", body: "{}" },
        );
      }
    }

    await signedApi(config, completePath, {
      leaseToken: job.leaseToken,
      outcome: "synced",
      observedRoleKeys: job.desiredRoleKeys,
      completedAt: new Date().toISOString(),
    });
    return { handled: true, systemicFailure: null };
  } catch (error) {
    const discordFailure = error?.discordFailure;
    // The member can leave between the initial GET and a subsequent role
    // mutation. Normalize exact Unknown Member evidence from either point so
    // the completion RPC atomically marks the creator connection not_member.
    const failure = error?.httpStatus === 404 && discordFailure?.providerCode === 10007
      ? {
          outcome: "terminal",
          errorClass: "not_guild_member",
          providerCode: 10007,
          retryAfterSeconds: null,
        }
      : error?.httpStatus === 404 && [10004, 10011].includes(discordFailure?.providerCode)
        ? {
            outcome: "retry",
            errorClass: "bot_guild_access",
            providerCode: discordFailure.providerCode,
            retryAfterSeconds: null,
            systemic: true,
          }
      : discordFailure ?? {
          outcome: "retry",
          errorClass: "network_error",
          providerCode: null,
          retryAfterSeconds: null,
        };
    await preserveSystemicFailure(
      signedApi(config, completePath, {
        leaseToken: job.leaseToken,
        outcome: failure.outcome === "retry" ? "retry" : "blocked",
        errorClass: failure.errorClass,
        httpStatus: error?.httpStatus ?? null,
        discordCode: failure.providerCode,
        retryAt: failure.outcome === "retry"
          ? retryAtFromFailure(failure, job.attemptNumber)
          : null,
      }),
      failure.systemic ? failure.errorClass : null,
    );
    return failure.systemic
      ? { handled: true, systemicFailure: failure.errorClass }
      : { handled: true, systemicFailure: null };
  }
}

async function runCycle(config, database) {
  const lease = await signedApi(config, "/api/internal/discord/v1/lease", {
    workerId: config.workerId,
    bootId: config.bootId,
    protocolVersion: 1,
    maxMessages: 10,
    leaseSeconds: 120,
    templateVersions: Object.fromEntries(
      Object.keys(templates).map((key) => key.split(":")),
    ),
  });
  for (const message of lease.messages ?? []) {
    let result;
    try {
      result = await processDelivery(config, database, message);
    } catch (error) {
      if (error?.systemicFailure) {
        return { handled: true, systemicFailure: error.systemicFailure };
      }
      throw error;
    }
    if (result?.systemicFailure) return result;
  }

  const roles = await signedApi(config, "/api/internal/discord/v1/roles/lease", {
    workerId: config.workerId,
    bootId: config.bootId,
    protocolVersion: 1,
    maxJobs: 10,
    leaseSeconds: 120,
  });
  for (const job of roles.jobs ?? []) {
    let result;
    try {
      result = await processRoleJob(config, job);
    } catch (error) {
      if (error?.systemicFailure) {
        return { handled: true, systemicFailure: error.systemicFailure };
      }
      throw error;
    }
    if (result?.systemicFailure) return result;
  }
  return { handled: true, systemicFailure: null };
}

async function recordHeartbeat(config, status) {
  await signedApi(config, "/api/internal/discord/v1/heartbeat", {
    workerId: config.workerId,
    bootId: config.bootId,
    protocolVersion: 1,
    workerVersion: "1.1.0",
    status,
    observedAt: new Date().toISOString(),
  });
}

async function probeDiscordBot(config) {
  const identity = await discordFetch(config, "/users/@me", { method: "GET" });
  const botUserId = String(identity?.id ?? "");
  if (!/^\d{17,20}$/u.test(botUserId) || identity?.bot !== true) {
    throw systemicDiscordError("bot_unauthorized");
  }

  const [member, roles] = await Promise.all([
    discordFetch(
      config,
      `/guilds/${config.guildId}/members/${botUserId}`,
      { method: "GET" },
    ),
    discordFetch(config, `/guilds/${config.guildId}/roles`, { method: "GET" }),
  ]);
  if (
    String(member?.user?.id ?? "") !== botUserId ||
    !Array.isArray(member?.roles) ||
    !Array.isArray(roles)
  ) {
    throw systemicDiscordError("bot_guild_access");
  }

  const rolesById = new Map(roles.map((role) => [String(role?.id ?? ""), role]));
  const targetRoles = Object.values(config.roleIds).map((roleId) => rolesById.get(roleId));
  if (targetRoles.some((role) => !role || role.managed === true)) {
    throw systemicDiscordError("bot_guild_access");
  }

  const botRoles = [config.guildId, ...member.roles.map(String)]
    .map((roleId) => rolesById.get(roleId))
    .filter(Boolean);
  if (botRoles.length === 0) throw systemicDiscordError("bot_guild_access");

  let botPermissions = 0n;
  try {
    for (const role of botRoles) botPermissions |= BigInt(role.permissions);
  } catch {
    throw systemicDiscordError("bot_guild_access");
  }
  const botHighestPosition = Math.max(
    ...botRoles.map((role) => Number.isInteger(role.position) ? role.position : -1),
  );
  if (
    (botPermissions & MANAGE_ROLES_PERMISSION) === 0n ||
    targetRoles.some((role) => !Number.isInteger(role.position) || botHighestPosition <= role.position)
  ) {
    throw systemicDiscordError("bot_guild_access");
  }
}

function configuration() {
  const apiOrigin = normalizeOrigin(requiredEnvironment("CREATOR_DISCORD_API_ORIGIN"));
  return {
    apiOrigin,
    botToken: readCredential("discord-bot-token"),
    workerSecret: readCredential("discord-worker-secret"),
    workerId: process.env.CREATOR_DISCORD_WORKER_ID?.trim() || `${hostname()}-creator-discord`,
    bootId: randomUUID(),
    guildId: snowflake(requiredEnvironment("DISCORD_GUILD_ID")),
    roleIds: {
      onboarding: snowflake(requiredEnvironment("DISCORD_ONBOARDING_ROLE_ID")),
      active: snowflake(requiredEnvironment("DISCORD_ACTIVE_ROLE_ID")),
      at_risk: snowflake(requiredEnvironment("DISCORD_AT_RISK_ROLE_ID")),
      top_performer: snowflake(requiredEnvironment("DISCORD_TOP_PERFORMER_ROLE_ID")),
    },
    journalPath: requiredEnvironment("CREATOR_DISCORD_JOURNAL_PATH"),
    pollMs: parsePositiveInteger(process.env.CREATOR_DISCORD_POLL_MS, DEFAULT_POLL_MS, 1_000, 60_000),
  };
}

async function main() {
  process.umask(0o077);
  const config = configuration();
  const database = await openJournal(config.journalPath);
  let nextScheduleAt = 0;
  let nextHeartbeatAt = 0;
  let discordCircuitDegraded = false;
  let discordClaimsSuppressedUntil = 0;
  let stopped = false;
  const stop = () => { stopped = true; };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);

  while (!stopped) {
    const cycleStarted = Date.now();
    try {
      if (cycleStarted >= nextScheduleAt) {
        await signedApi(config, "/api/internal/discord/v1/schedule", {
          workerId: config.workerId,
          bootId: config.bootId,
          protocolVersion: 1,
        });
        nextScheduleAt = cycleStarted + DEFAULT_SCHEDULE_MS;
      }
      if (cycleStarted >= nextHeartbeatAt) {
        await recordHeartbeat(
          config,
          discordCircuitDegraded ? "degraded" : "healthy",
        );
        nextHeartbeatAt = cycleStarted + DEFAULT_HEARTBEAT_MS;
      }

      if (
        discordCircuitDegraded &&
        cycleStarted >= discordClaimsSuppressedUntil
      ) {
        try {
          await probeDiscordBot(config);
          discordCircuitDegraded = false;
          discordClaimsSuppressedUntil = 0;
          await recordHeartbeat(config, "healthy");
          nextHeartbeatAt = Date.now() + DEFAULT_HEARTBEAT_MS;
        } catch {
          discordClaimsSuppressedUntil = Date.now() + BOT_CIRCUIT_BACKOFF_MS;
        }
      }

      if (!discordCircuitDegraded) {
        const cycleResult = await runCycle(config, database);
        if (cycleResult?.systemicFailure) {
          discordCircuitDegraded = true;
          discordClaimsSuppressedUntil = Date.now() + BOT_CIRCUIT_BACKOFF_MS;
          await recordHeartbeat(config, "degraded");
          nextHeartbeatAt = Date.now() + DEFAULT_HEARTBEAT_MS;
        }
      }
    } catch (error) {
      const message = safeString(error?.message, 160) || "worker_cycle_failed";
      process.stderr.write(`${new Date().toISOString()} ${message}\n`);
    }

    const elapsed = Date.now() - cycleStarted;
    await new Promise((resolve) => setTimeout(resolve, Math.max(250, config.pollMs - elapsed)));
  }
  database.close();
}

const invokedAsScript = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;
if (invokedAsScript) {
  main().catch((error) => {
    process.stderr.write(`${safeString(error?.message, 160) || "worker_failed"}\n`);
    process.exitCode = 1;
  });
}

export {
  constantTimeEqual,
  journalRow,
  managedRoleKeys,
  markJournalSending,
  openJournal,
  prepareJournal,
  processDelivery,
  processRoleJob,
  pruneAcknowledgedJournal,
  requireCurrentGuildMembership,
  runCycle,
  probeDiscordBot,
  templates,
};
