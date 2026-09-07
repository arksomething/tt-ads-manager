#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";

const API = "https://discord.com/api/v10";
const VIEW_CHANNEL = 1n << 10n;
const SEND_MESSAGES = 1n << 11n;
const EMBED_LINKS = 1n << 14n;
const ATTACH_FILES = 1n << 15n;
const READ_MESSAGE_HISTORY = 1n << 16n;
const MANAGE_GUILD = 1n << 5n;
const ADMINISTRATOR = 1n << 3n;
const CREATOR_CHANNEL_ALLOW = VIEW_CHANNEL | SEND_MESSAGES | EMBED_LINKS |
  ATTACH_FILES | READ_MESSAGE_HISTORY;
const FOLLOW_UP_MS = 24 * 60 * 60_000;
const CHECK_INTERVAL_MS = 60_000;

const stages = new Set(["warmup", "account_ready", "agreement", "active"]);

const commandDefinitions = [
  { name: "apply", description: "Start or reopen your GoTall creator application" },
  {
    name: "status",
    description: "Show a creator's onboarding status",
    options: [{ name: "creator", description: "Creator to inspect", type: 6, required: false }],
  },
  {
    name: "progress",
    description: "Move a creator to the next onboarding stage",
    options: [
      {
        name: "stage", description: "New stage", type: 3, required: true,
        choices: [
          { name: "Warmup", value: "warmup" },
          { name: "Account ready", value: "account_ready" },
          { name: "Agreement", value: "agreement" },
          { name: "Active creator", value: "active" },
        ],
      },
      { name: "creator", description: "Creator (defaults to this channel)", type: 6, required: false },
    ],
  },
  {
    name: "agreement",
    description: "Mark a creator ready for the agreement",
    options: [{ name: "creator", description: "Creator (defaults to this channel)", type: 6, required: false }],
  },
  {
    name: "posted",
    description: "Record that a creator posted today",
    options: [{ name: "creator", description: "Creator (defaults to this channel)", type: 6, required: false }],
  },
  {
    name: "exception",
    description: "Pause inactivity enforcement for a creator",
    options: [
      { name: "days", description: "Number of exception days", type: 4, required: true, min_value: 1, max_value: 30 },
      { name: "reason", description: "Internal reason", type: 3, required: true, max_length: 200 },
      { name: "creator", description: "Creator (defaults to this channel)", type: 6, required: false },
    ],
  },
  {
    name: "video-check",
    description: "Test GoTall video eligibility and milestone payout",
    options: [
      { name: "url", description: "Video URL", type: 3, required: true },
      { name: "views", description: "Current views", type: 4, required: true, min_value: 0 },
      { name: "plug", description: "GoTall plug appears in the video", type: 5, required: true },
      { name: "mention", description: "Description mentions @GoTall", type: 5, required: true },
      { name: "yap", description: "Description contains #yap", type: 5, required: true },
      { name: "patner", description: "Description contains #patner", type: 5, required: true },
      { name: "creator", description: "Creator (defaults to this channel)", type: 6, required: false },
    ],
  },
  {
    name: "test-reminder",
    description: "Send the current onboarding follow-up immediately",
    options: [{ name: "creator", description: "Creator (defaults to this channel)", type: 6, required: false }],
  },
  {
    name: "simulate-inactive",
    description: "Test the inactivity workflow without waiting",
    options: [
      { name: "days", description: "Days since the last post", type: 4, required: true, min_value: 0, max_value: 30 },
      { name: "creator", description: "Creator (defaults to this channel)", type: 6, required: false },
    ],
  },
  {
    name: "invite",
    description: "Create a one-use creator invite",
    options: [{ name: "hours", description: "Hours before expiry", type: 4, required: false, min_value: 1, max_value: 168 }],
  },
  { name: "setup", description: "Create or repair the GoTall test-server layout" },
  {
    name: "reset-creator",
    description: "Reset a test creator so they can apply again",
    options: [
      { name: "creator", description: "Creator to reset", type: 6, required: true },
      { name: "delete-channel", description: "Also delete their private channel", type: 5, required: false },
    ],
  },
];

function requiredEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function readCredential(name) {
  const directory = requiredEnvironment("CREDENTIALS_DIRECTORY");
  const value = readFileSync(`${directory}/${name}`, "utf8").trim();
  if (!value) throw new Error(`Credential ${name} is empty.`);
  return value;
}

function safeText(value, maximum = 500) {
  return typeof value === "string"
    ? value.replace(/[\u0000-\u001f\u007f]/gu, " ").trim().slice(0, maximum)
    : "";
}

export function sanitizeChannelName(value) {
  const slug = safeText(value, 80)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 70);
  return slug || "creator";
}

export function validateApplication(fields) {
  const name = safeText(fields.name, 80);
  const phone = safeText(fields.phone, 30);
  const location = safeText(fields.location, 100);
  const platforms = safeText(fields.platforms, 400);
  const bestVideo = safeText(fields.bestVideo, 500);
  if (name.length < 2) return { ok: false, error: "Please enter your full name." };
  if (!/^[+()\d .-]{7,30}$/u.test(phone)) {
    return { ok: false, error: "Please enter a valid phone number, including country code." };
  }
  if (location.length < 2) return { ok: false, error: "Please enter your city/country or timezone." };
  if (platforms.length < 3) return { ok: false, error: "Please enter at least one platform and username." };
  if (bestVideo) {
    try {
      const url = new URL(bestVideo);
      if (url.protocol !== "https:") throw new Error("not https");
    } catch {
      return { ok: false, error: "When provided, best video must be a complete https:// link." };
    }
  }
  return { ok: true, value: { name, phone, location, platforms, bestVideo } };
}

export function payoutForViews(views) {
  if (!Number.isInteger(views) || views < 0) return 0;
  if (views >= 1_000_000) return 300;
  if (views >= 300_000) return 100;
  if (views >= 100_000) return 50;
  if (views >= 50_000) return 20;
  return 0;
}

export function evaluateVideo({ plug, mention, yap, patner, views }) {
  const missing = [];
  if (!plug) missing.push("GoTall plug in the video");
  if (!mention) missing.push("@GoTall in the description");
  if (!yap) missing.push("#yap");
  if (!patner) missing.push("#patner");
  const eligible = missing.length === 0;
  return { eligible, missing, payout: eligible ? payoutForViews(views) : 0 };
}

/**
 * @param {{stage: string, lastPostAt: string | null, exceptionUntil?: string | null, now?: number, testMode?: boolean}} input
 */
export function inactivityDecision({ stage, lastPostAt, exceptionUntil = null, now = Date.now(), testMode = false }) {
  if (!['active', 'at_risk'].includes(stage) || !lastPostAt) return "none";
  if (exceptionUntil && Date.parse(exceptionUntil) > now) return "excepted";
  const days = Math.floor((now - Date.parse(lastPostAt)) / (24 * 60 * 60_000));
  if (days >= 4) return testMode ? "would_remove" : "remove";
  if (days >= 3 && stage === "active") return "at_risk";
  return "none";
}

async function api(config, pathname, init = {}) {
  const response = await fetch(`${API}${pathname}`, {
    ...init,
    headers: {
      Authorization: `Bot ${config.token}`,
      "Content-Type": "application/json",
      "User-Agent": "GoTallOnboardingBot/1.0",
      ...init.headers,
    },
    signal: AbortSignal.timeout(20_000),
  });
  const raw = await response.text();
  let body = {};
  try { body = raw ? JSON.parse(raw) : {}; } catch { body = {}; }
  if (!response.ok) {
    throw new Error(`discord_${response.status}_${body.code ?? "unknown"}_${body.message ?? "request_failed"}`);
  }
  return body;
}

export async function openDatabase(pathname) {
  await mkdir(dirname(pathname), { recursive: true, mode: 0o700 });
  const database = new DatabaseSync(pathname);
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS resources (
      key TEXT PRIMARY KEY,
      discord_id TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS creators (
      discord_user_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      location TEXT NOT NULL,
      platforms TEXT NOT NULL,
      best_video TEXT NOT NULL,
      channel_id TEXT NOT NULL UNIQUE,
      stage TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_followup_at TEXT,
      trial_started_at TEXT,
      last_post_at TEXT,
      exception_until TEXT,
      exception_reason TEXT,
      removed_at TEXT,
      welcome_sent_at TEXT
    );
    CREATE TABLE IF NOT EXISTS video_checks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      discord_user_id TEXT NOT NULL,
      url TEXT NOT NULL,
      views INTEGER NOT NULL,
      eligible INTEGER NOT NULL,
      payout INTEGER NOT NULL,
      missing_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  const creatorColumns = database.prepare("PRAGMA table_info(creators)").all();
  if (!creatorColumns.some((column) => column.name === "welcome_sent_at")) {
    database.exec("ALTER TABLE creators ADD COLUMN welcome_sent_at TEXT");
  }
  return database;
}

function resourceMap(database) {
  return Object.fromEntries(
    database.prepare("SELECT key, discord_id FROM resources").all()
      .map((row) => [row.key, row.discord_id]),
  );
}

function setResource(database, key, id) {
  database.prepare(`
    INSERT INTO resources (key, discord_id, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET discord_id = excluded.discord_id, updated_at = excluded.updated_at
  `).run(key, id, new Date().toISOString());
}

async function findOrCreateRole(config, database, roles, key, name, color) {
  const cached = resourceMap(database)[key];
  let role = roles.find((item) => item.id === cached) ?? roles.find((item) => item.name === name);
  if (!role) {
    role = await api(config, `/guilds/${config.guildId}/roles`, {
      method: "POST",
      body: JSON.stringify({ name, color, hoist: false, mentionable: false, permissions: "0" }),
    });
    roles.push(role);
  }
  setResource(database, key, role.id);
  return role.id;
}

async function findOrCreateChannel(config, database, channels, key, name, type, parentId = null, overwrites = undefined) {
  const cached = resourceMap(database)[key];
  let channel = channels.find((item) => item.id === cached) ??
    channels.find((item) => item.name === name && item.type === type && (parentId === null || item.parent_id === parentId));
  if (!channel) {
    channel = await api(config, `/guilds/${config.guildId}/channels`, {
      method: "POST",
      body: JSON.stringify({ name, type, parent_id: parentId, permission_overwrites: overwrites }),
    });
    channels.push(channel);
  }
  setResource(database, key, channel.id);
  return channel.id;
}

export async function ensureGuildResources(config, database) {
  const [guild, roles, channels, bot] = await Promise.all([
    api(config, `/guilds/${config.guildId}`),
    api(config, `/guilds/${config.guildId}/roles`),
    api(config, `/guilds/${config.guildId}/channels`),
    api(config, "/users/@me"),
  ]);
  config.applicationId = bot.id;
  config.ownerId = guild.owner_id;

  const onboardingRoleId = await findOrCreateRole(config, database, roles, "role_onboarding", "Onboarding", 0xf5c542);
  const activeRoleId = await findOrCreateRole(config, database, roles, "role_active", "Active Creator", 0x57f287);
  const atRiskRoleId = await findOrCreateRole(config, database, roles, "role_at_risk", "Inactive / At Risk", 0xed4245);
  const staffRoleId = await findOrCreateRole(config, database, roles, "role_staff", "GoTall Staff", 0x5865f2);

  const onboardingCategoryId = await findOrCreateChannel(config, database, channels, "category_onboarding", "New / Onboarding", 4);
  const activeCategoryId = await findOrCreateChannel(config, database, channels, "category_active", "Active Creators", 4);
  const atRiskCategoryId = await findOrCreateChannel(config, database, channels, "category_at_risk", "Inactive / At Risk", 4);
  const inactiveCategoryId = await findOrCreateChannel(config, database, channels, "category_inactive", "Not Active Creators", 4);

  const startHereOverwrites = [
    { id: config.guildId, type: 0, allow: (VIEW_CHANNEL | READ_MESSAGE_HISTORY).toString(), deny: SEND_MESSAGES.toString() },
    { id: bot.id, type: 1, allow: CREATOR_CHANNEL_ALLOW.toString(), deny: "0" },
  ];
  const startHereId = await findOrCreateChannel(
    config, database, channels, "channel_start_here", "start-here", 0,
    onboardingCategoryId, startHereOverwrites,
  );
  if (!resourceMap(database).message_start_here) {
    const message = await api(config, `/channels/${startHereId}/messages`, {
      method: "POST",
      body: JSON.stringify({
        content: "**GoTall creator testing**\nRun `/apply` and answer all five questions. The bot will create your private creator channel automatically. Staff can generate a one-use invite with `/invite`.",
        allowed_mentions: { parse: [] },
      }),
    }).catch(() => null);
    if (message?.id) setResource(database, "message_start_here", message.id);
  }

  return {
    guild, bot, onboardingRoleId, activeRoleId, atRiskRoleId, staffRoleId,
    onboardingCategoryId, activeCategoryId, atRiskCategoryId, inactiveCategoryId, startHereId,
  };
}

function modalResponse() {
  return {
    type: 9,
    data: {
      custom_id: "gotall-apply-v1",
      title: "GoTall creator application",
      components: [
        input("name", "Full name", "What should the team call you?", 80),
        input("phone", "Phone number", "+1 555 123 4567", 30),
        input("location", "Location / timezone", "London, UK / GMT+1", 100),
        input("platforms", "Usernames and platforms", "TikTok @name; Instagram @name", 400, 2),
        input("best_video", "Best video link (optional)", "https://www.tiktok.com/...", 500, 1, false),
      ],
    },
  };
}

function input(customId, label, placeholder, maxLength, style = 1, required = true) {
  return {
    type: 1,
    components: [{ type: 4, custom_id: customId, label, placeholder, style, required, max_length: maxLength }],
  };
}

function modalValues(interaction) {
  const values = {};
  for (const row of interaction.data?.components ?? []) {
    for (const component of row.components ?? []) values[component.custom_id] = component.value;
  }
  return values;
}

function option(interaction, name) {
  return interaction.data?.options?.find((item) => item.name === name)?.value;
}

function actorId(interaction) {
  return interaction.member?.user?.id ?? interaction.user?.id ?? "";
}

function isAdmin(interaction, config) {
  if (actorId(interaction) === config.ownerId) return true;
  const permissions = BigInt(interaction.member?.permissions ?? "0");
  return (permissions & (MANAGE_GUILD | ADMINISTRATOR)) !== 0n;
}

function creatorByContext(database, interaction, allowSelf = false) {
  const selected = option(interaction, "creator");
  if (selected) return database.prepare("SELECT * FROM creators WHERE discord_user_id = ?").get(String(selected));
  const byChannel = database.prepare("SELECT * FROM creators WHERE channel_id = ?").get(interaction.channel_id);
  if (byChannel) return byChannel;
  if (allowSelf) return database.prepare("SELECT * FROM creators WHERE discord_user_id = ?").get(actorId(interaction));
  return null;
}

async function interactionCallback(config, interaction, data) {
  await api(config, `/interactions/${interaction.id}/${interaction.token}/callback`, {
    method: "POST", body: JSON.stringify(data),
  });
}

async function defer(config, interaction) {
  await interactionCallback(config, interaction, { type: 5, data: { flags: 64 } });
}

async function editReply(config, interaction, content) {
  await api(config, `/webhooks/${config.applicationId}/${interaction.token}/messages/@original`, {
    method: "PATCH",
    body: JSON.stringify({ content: safeText(content, 1900), allowed_mentions: { parse: [] } }),
  });
}

export function normalizeMentionUsers(userIds) {
  return [...new Set(userIds.map(String))]
    .filter((id) => /^\d{17,20}$/u.test(id));
}

async function channelMessage(config, channelId, content, userIds = []) {
  const mentionUsers = normalizeMentionUsers(userIds);
  return api(config, `/channels/${channelId}/messages`, {
    method: "POST",
    body: JSON.stringify({
      content,
      allowed_mentions: { parse: [], users: mentionUsers },
    }),
  });
}

async function setRole(config, userId, roleId, add) {
  await api(config, `/guilds/${config.guildId}/members/${userId}/roles/${roleId}`, {
    method: add ? "PUT" : "DELETE",
    body: add ? "{}" : undefined,
  });
}

async function createCreatorChannel(config, database, application, userId) {
  const resources = resourceMap(database);
  const channel = await api(config, `/guilds/${config.guildId}/channels`, {
    method: "POST",
    body: JSON.stringify({
      name: `🟡-${sanitizeChannelName(application.name)}`,
      type: 0,
      parent_id: resources.category_onboarding,
      topic: `GoTall creator • user ${userId} • stage warmup`,
      permission_overwrites: [
        { id: config.guildId, type: 0, allow: "0", deny: VIEW_CHANNEL.toString() },
        { id: userId, type: 1, allow: CREATOR_CHANNEL_ALLOW.toString(), deny: "0" },
        { id: config.applicationId, type: 1, allow: CREATOR_CHANNEL_ALLOW.toString(), deny: "0" },
        { id: resources.role_staff, type: 0, allow: CREATOR_CHANNEL_ALLOW.toString(), deny: "0" },
        { id: config.ownerId, type: 1, allow: CREATOR_CHANNEL_ALLOW.toString(), deny: "0" },
      ],
    }),
  });
  return channel.id;
}

function applicationWelcomeContent(config, application, userId) {
  return `<@${userId}> <@${config.ownerId}> welcome to your private GoTall onboarding channel.\n\n` +
    `**Application**\n• Name: ${application.name}\n• Phone: ${application.phone}\n` +
    `• Location/timezone: ${application.location}\n• Platforms: ${application.platforms}\n` +
    `• Best video: ${application.best_video || application.bestVideo || "Not provided"}\n\n` +
    `**Warmup**\n1. Complete the new account's profile so it looks real.\n` +
    `2. Spend 20–30 minutes a day naturally watching, liking, and saving content in the niche.\n` +
    `3. Do not mass-follow, spam actions, or post until staff validates the account.\n` +
    `4. Staff will follow up here. Once approved, they will run \`/progress\` and move you to the agreement.`;
}

async function completeApplicationSetup(config, database, creator) {
  const resources = resourceMap(database);
  await setRole(config, creator.discord_user_id, resources.role_onboarding, true);
  await setRole(config, creator.discord_user_id, resources.role_active, false).catch(() => {});
  await setRole(config, creator.discord_user_id, resources.role_at_risk, false).catch(() => {});
  await channelMessage(
    config,
    creator.channel_id,
    applicationWelcomeContent(config, creator, creator.discord_user_id),
    [creator.discord_user_id, config.ownerId],
  );
  database.prepare("UPDATE creators SET welcome_sent_at=?, updated_at=? WHERE discord_user_id=?")
    .run(new Date().toISOString(), new Date().toISOString(), creator.discord_user_id);
}

async function repairPendingApplications(config, database) {
  const pending = database.prepare(
    "SELECT * FROM creators WHERE removed_at IS NULL AND welcome_sent_at IS NULL",
  ).all();
  for (const creator of pending) {
    try {
      await completeApplicationSetup(config, database, creator);
      console.log(new Date().toISOString(), `repaired application setup for ${creator.discord_user_id}`);
    } catch (error) {
      console.error(new Date().toISOString(), "application repair", creator.discord_user_id, error.message);
    }
  }
}

async function handleApplication(config, database, interaction) {
  const values = modalValues(interaction);
  const checked = validateApplication({
    name: values.name, phone: values.phone, location: values.location,
    platforms: values.platforms, bestVideo: values.best_video,
  });
  await defer(config, interaction);
  if (!checked.ok) return editReply(config, interaction, checked.error);

  const userId = actorId(interaction);
  const existing = database.prepare("SELECT * FROM creators WHERE discord_user_id = ?").get(userId);
  if (existing && !existing.removed_at) {
    if (!existing.welcome_sent_at) {
      database.prepare(`UPDATE creators SET name=?, phone=?, location=?, platforms=?, best_video=?, updated_at=?
        WHERE discord_user_id=?`)
        .run(
          checked.value.name, checked.value.phone, checked.value.location,
          checked.value.platforms, checked.value.bestVideo, new Date().toISOString(), userId,
        );
      const refreshed = database.prepare("SELECT * FROM creators WHERE discord_user_id = ?").get(userId);
      await completeApplicationSetup(config, database, refreshed);
      return editReply(config, interaction, `Application setup repaired. Your private channel is <#${existing.channel_id}>.`);
    }
    return editReply(config, interaction, `You already have a creator channel: <#${existing.channel_id}>.`);
  }

  await ensureGuildResources(config, database);
  const channelId = await createCreatorChannel(config, database, checked.value, userId);
  const now = new Date().toISOString();
  database.prepare(`
    INSERT INTO creators (
      discord_user_id, name, phone, location, platforms, best_video, channel_id,
      stage, created_at, updated_at, last_followup_at, removed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'warmup', ?, ?, ?, NULL)
    ON CONFLICT(discord_user_id) DO UPDATE SET
      name=excluded.name, phone=excluded.phone, location=excluded.location,
      platforms=excluded.platforms, best_video=excluded.best_video,
      channel_id=excluded.channel_id, stage='warmup', updated_at=excluded.updated_at,
      last_followup_at=excluded.last_followup_at, removed_at=NULL
  `).run(
    userId, checked.value.name, checked.value.phone, checked.value.location,
    checked.value.platforms, checked.value.bestVideo, channelId, now, now, now,
  );
  await completeApplicationSetup(config, database, {
    discord_user_id: userId,
    channel_id: channelId,
    name: checked.value.name,
    phone: checked.value.phone,
    location: checked.value.location,
    platforms: checked.value.platforms,
    best_video: checked.value.bestVideo,
  });
  return editReply(config, interaction, `Application saved. Your private channel is <#${channelId}>.`);
}

function progressCopy(stage) {
  if (stage === "warmup") return "Warmup is in progress. Keep using the account naturally and wait for staff validation before posting.";
  if (stage === "account_ready") return "Account validated. It looks like a real, usable creator account. Staff will prepare the agreement next.";
  if (stage === "agreement") return "Your account is approved for the agreement stage. Review the exact terms supplied by GoTall and ask questions here before signing.";
  return "You are now an Active Creator. Your seven-day trial starts today. Read the posting rules, payout policy, and content checks below.";
}

async function progressCreator(config, database, creator, stage) {
  const resources = resourceMap(database);
  const now = new Date().toISOString();
  const active = stage === "active";
  database.prepare(`
    UPDATE creators SET stage=?, updated_at=?, trial_started_at=CASE WHEN ? THEN COALESCE(trial_started_at, ?) ELSE trial_started_at END,
      last_post_at=CASE WHEN ? THEN COALESCE(last_post_at, ?) ELSE last_post_at END, removed_at=NULL
    WHERE discord_user_id=?
  `).run(stage, now, active ? 1 : 0, now, active ? 1 : 0, now, creator.discord_user_id);
  await setRole(config, creator.discord_user_id, resources.role_onboarding, !active);
  await setRole(config, creator.discord_user_id, resources.role_active, active);
  await setRole(config, creator.discord_user_id, resources.role_at_risk, false);
  await api(config, `/channels/${creator.channel_id}`, {
    method: "PATCH",
    body: JSON.stringify({
      name: `${active ? "🟢" : "🟡"}-${sanitizeChannelName(creator.name)}`,
      parent_id: active ? resources.category_active : resources.category_onboarding,
      topic: `GoTall creator • user ${creator.discord_user_id} • stage ${stage}`,
    }),
  });
  let copy = `<@${creator.discord_user_id}> **Stage updated: ${stage.replaceAll("_", " ")}**\n${progressCopy(stage)}`;
  if (active) {
    copy += "\n\n**Posting and payouts**\n• Post consistently during the seven-day trial.\n" +
      "• Every qualifying description must include `@GoTall`, `#yap`, and `#patner`.\n" +
      "• The GoTall plug must actually appear in the video. A missing requirement means the video does not count.\n" +
      "• Milestones: 50K = $20, 100K = $50, 300K = $100, 1M = $300.\n" +
      "• Three missed posting days moves the channel to At Risk. Four days triggers removal unless staff records an exception.";
  }
  await channelMessage(config, creator.channel_id, copy, [creator.discord_user_id]);
}

async function sendFollowup(config, database, creator, forced = false) {
  const now = Date.now();
  if (!forced && creator.last_followup_at && now - Date.parse(creator.last_followup_at) < FOLLOW_UP_MS) return false;
  const messages = {
    warmup: "Daily follow-up: how is the account warmup going? Reply here with what you completed and any problems.",
    account_ready: "Daily follow-up: your account is validated. Staff is preparing the agreement stage.",
    agreement: "Daily follow-up: your agreement is waiting. Review the terms and reply here with questions or confirmation.",
    at_risk: "Posting follow-up: you are currently At Risk. Post today or ask staff for an exception if there is an urgent problem.",
  };
  const content = messages[creator.stage];
  if (!content) return false;
  await channelMessage(config, creator.channel_id, `<@${creator.discord_user_id}> ${content}`, [creator.discord_user_id]);
  database.prepare("UPDATE creators SET last_followup_at=?, updated_at=? WHERE discord_user_id=?")
    .run(new Date(now).toISOString(), new Date(now).toISOString(), creator.discord_user_id);
  return true;
}

async function applyInactivityDecision(config, database, creator, decision) {
  const resources = resourceMap(database);
  if (decision === "at_risk") {
    database.prepare("UPDATE creators SET stage='at_risk', updated_at=? WHERE discord_user_id=?")
      .run(new Date().toISOString(), creator.discord_user_id);
    await setRole(config, creator.discord_user_id, resources.role_active, false);
    await setRole(config, creator.discord_user_id, resources.role_at_risk, true);
    await api(config, `/channels/${creator.channel_id}`, {
      method: "PATCH",
      body: JSON.stringify({ name: `🔥-${sanitizeChannelName(creator.name)}`, parent_id: resources.category_at_risk }),
    });
    await channelMessage(config, creator.channel_id,
      `<@${creator.discord_user_id}> you have missed three posting days and are now **Inactive / At Risk**. Post today or contact staff for an exception.`,
      [creator.discord_user_id],
    );
  } else if (decision === "would_remove") {
    const now = new Date().toISOString();
    database.prepare("UPDATE creators SET stage='removal_due', removed_at=?, updated_at=? WHERE discord_user_id=?")
      .run(now, now, creator.discord_user_id);
    await setRole(config, creator.discord_user_id, resources.role_active, false).catch(() => {});
    await setRole(config, creator.discord_user_id, resources.role_at_risk, false).catch(() => {});
    await api(config, `/channels/${creator.channel_id}`, {
      method: "PATCH",
      body: JSON.stringify({ name: `⚫-${sanitizeChannelName(creator.name)}`, parent_id: resources.category_inactive }),
    });
    await channelMessage(config, creator.channel_id,
      `**Test mode:** four missed posting days reached. Production enforcement would remove <@${creator.discord_user_id}> now.`,
      [creator.discord_user_id],
    );
  } else if (decision === "remove") {
    await api(config, `/guilds/${config.guildId}/members/${creator.discord_user_id}`, { method: "DELETE" });
    database.prepare("UPDATE creators SET stage='removed', removed_at=?, updated_at=? WHERE discord_user_id=?")
      .run(new Date().toISOString(), new Date().toISOString(), creator.discord_user_id);
    await api(config, `/channels/${creator.channel_id}`, {
      method: "PATCH",
      body: JSON.stringify({ name: `⚫-${sanitizeChannelName(creator.name)}`, parent_id: resources.category_inactive }),
    });
  }
}

async function runScheduledChecks(config, database) {
  for (const creator of database.prepare("SELECT * FROM creators WHERE removed_at IS NULL").all()) {
    if (["warmup", "account_ready", "agreement"].includes(creator.stage)) {
      await sendFollowup(config, database, creator).catch((error) => console.error(new Date().toISOString(), "followup", error.message));
    }
    const decision = inactivityDecision({
      stage: creator.stage, lastPostAt: creator.last_post_at,
      exceptionUntil: creator.exception_until, testMode: config.testMode,
    });
    if (["at_risk", "would_remove", "remove"].includes(decision)) {
      await applyInactivityDecision(config, database, creator, decision)
        .catch((error) => console.error(new Date().toISOString(), "inactivity", error.message));
    }
  }
}

async function handleCommand(config, database, interaction) {
  const name = interaction.data?.name;
  if (name === "apply") return interactionCallback(config, interaction, modalResponse());
  await defer(config, interaction);

  if (name === "status") {
    const selected = option(interaction, "creator");
    if (selected && String(selected) !== actorId(interaction) && !isAdmin(interaction, config)) {
      return editReply(config, interaction, "Only GoTall staff can inspect another creator's status.");
    }
    const creator = creatorByContext(database, interaction, true);
    if (!creator) return editReply(config, interaction, "No creator record was found. Run `/apply` first.");
    const trialEnd = creator.trial_started_at
      ? new Date(Date.parse(creator.trial_started_at) + 7 * 24 * 60 * 60_000).toISOString().slice(0, 10)
      : "not started";
    return editReply(config, interaction,
      `**${creator.name}**\nStage: ${creator.stage.replaceAll("_", " ")}\nChannel: <#${creator.channel_id}>\n` +
      `Location/timezone: ${creator.location}\nPlatforms: ${creator.platforms}\nTrial ends: ${trialEnd}`,
    );
  }

  if (!isAdmin(interaction, config)) return editReply(config, interaction, "This command is for GoTall staff.");
  if (name === "setup") {
    const resources = await ensureGuildResources(config, database);
    return editReply(config, interaction, `Server layout is ready. Start in <#${resources.startHereId}>.`);
  }
  if (name === "invite") {
    const resources = await ensureGuildResources(config, database);
    const hours = Number(option(interaction, "hours") ?? 24);
    const invite = await api(config, `/channels/${resources.startHereId}/invites`, {
      method: "POST",
      body: JSON.stringify({ max_age: hours * 3600, max_uses: 1, unique: true, temporary: false }),
    });
    return editReply(config, interaction, `One-use invite (${hours}h): https://discord.gg/${invite.code}`);
  }

  const creator = creatorByContext(database, interaction);
  if (!creator) return editReply(config, interaction, "Run this inside a creator channel or choose a creator.");

  if (name === "progress" || name === "agreement") {
    const stage = name === "agreement" ? "agreement" : String(option(interaction, "stage") ?? "");
    if (!stages.has(stage)) return editReply(config, interaction, "Invalid onboarding stage.");
    await progressCreator(config, database, creator, stage);
    return editReply(config, interaction, `${creator.name} moved to ${stage.replaceAll("_", " ")}.`);
  }
  if (name === "posted") {
    const now = new Date().toISOString();
    const wasAtRisk = creator.stage === "at_risk";
    database.prepare("UPDATE creators SET last_post_at=?, stage='active', removed_at=NULL, updated_at=? WHERE discord_user_id=?")
      .run(now, now, creator.discord_user_id);
    const resources = resourceMap(database);
    await setRole(config, creator.discord_user_id, resources.role_active, true);
    await setRole(config, creator.discord_user_id, resources.role_at_risk, false);
    if (wasAtRisk) {
      await api(config, `/channels/${creator.channel_id}`, {
        method: "PATCH",
        body: JSON.stringify({ name: `🟢-${sanitizeChannelName(creator.name)}`, parent_id: resources.category_active }),
      });
    }
    await channelMessage(config, creator.channel_id, `<@${creator.discord_user_id}> posting activity recorded for today.`, [creator.discord_user_id]);
    return editReply(config, interaction, `Posting recorded for ${creator.name}.`);
  }
  if (name === "exception") {
    const days = Number(option(interaction, "days"));
    const reason = safeText(option(interaction, "reason"), 200);
    const until = new Date(Date.now() + days * 24 * 60 * 60_000).toISOString();
    database.prepare("UPDATE creators SET exception_until=?, exception_reason=?, updated_at=? WHERE discord_user_id=?")
      .run(until, reason, new Date().toISOString(), creator.discord_user_id);
    await channelMessage(config, creator.channel_id,
      `<@${creator.discord_user_id}> staff paused inactivity enforcement through ${until.slice(0, 10)}.`,
      [creator.discord_user_id],
    );
    return editReply(config, interaction, `Exception recorded for ${creator.name}: ${reason}`);
  }
  if (name === "test-reminder") {
    const sent = await sendFollowup(config, database, creator, true);
    return editReply(config, interaction, sent ? "Follow-up sent." : "This stage has no onboarding follow-up.");
  }
  if (name === "simulate-inactive") {
    if (creator.stage !== "active" && creator.stage !== "at_risk") {
      return editReply(config, interaction, "Activate this creator before testing inactivity.");
    }
    const days = Number(option(interaction, "days"));
    const lastPostAt = new Date(Date.now() - days * 24 * 60 * 60_000).toISOString();
    database.prepare("UPDATE creators SET last_post_at=?, updated_at=? WHERE discord_user_id=?")
      .run(lastPostAt, new Date().toISOString(), creator.discord_user_id);
    const decision = inactivityDecision({ stage: creator.stage, lastPostAt, exceptionUntil: creator.exception_until, testMode: config.testMode });
    await applyInactivityDecision(config, database, creator, decision);
    return editReply(config, interaction, `Simulated ${days} missed day(s). Result: ${decision.replaceAll("_", " ")}.`);
  }
  if (name === "video-check") {
    const url = safeText(option(interaction, "url"), 500);
    const views = Number(option(interaction, "views"));
    const result = evaluateVideo({
      plug: option(interaction, "plug") === true,
      mention: option(interaction, "mention") === true,
      yap: option(interaction, "yap") === true,
      patner: option(interaction, "patner") === true,
      views,
    });
    database.prepare(`INSERT INTO video_checks
      (discord_user_id,url,views,eligible,payout,missing_json,created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(creator.discord_user_id, url, views, result.eligible ? 1 : 0, result.payout, JSON.stringify(result.missing), new Date().toISOString());
    const copy = result.eligible
      ? `✅ **Eligible video**\n${url}\n${views.toLocaleString()} views → **$${result.payout} milestone payout**.`
      : `⚠️ **Video does not count**\n${url}\nMissing: ${result.missing.join(", ")}\nPayout: **$0**.`;
    await channelMessage(config, creator.channel_id, copy);
    return editReply(config, interaction, result.eligible ? `Eligible: $${result.payout}.` : `Not eligible: ${result.missing.join(", ")}.`);
  }
  if (name === "reset-creator") {
    const deleteChannel = option(interaction, "delete-channel") === true;
    const resources = resourceMap(database);
    await setRole(config, creator.discord_user_id, resources.role_onboarding, false).catch(() => {});
    await setRole(config, creator.discord_user_id, resources.role_active, false).catch(() => {});
    await setRole(config, creator.discord_user_id, resources.role_at_risk, false).catch(() => {});
    database.prepare("DELETE FROM video_checks WHERE discord_user_id=?").run(creator.discord_user_id);
    database.prepare("DELETE FROM creators WHERE discord_user_id=?").run(creator.discord_user_id);
    if (deleteChannel) await api(config, `/channels/${creator.channel_id}`, { method: "DELETE" });
    return editReply(config, interaction, `Reset ${creator.name}${deleteChannel ? " and deleted the private channel" : ""}.`);
  }
  return editReply(config, interaction, "Unknown command.");
}

export async function handleInteraction(config, database, interaction) {
  if (interaction.guild_id !== config.guildId) return;
  try {
    if (interaction.type === 2) await handleCommand(config, database, interaction);
    else if (interaction.type === 5 && interaction.data?.custom_id === "gotall-apply-v1") {
      await handleApplication(config, database, interaction);
    }
  } catch (error) {
    console.error(new Date().toISOString(), "interaction", interaction.data?.name ?? interaction.data?.custom_id, error.message);
    try { await editReply(config, interaction, `Something failed: ${safeText(error.message, 300)}`); } catch {}
  }
}

export async function registerCommands(config) {
  await api(config, `/applications/${config.applicationId}/guilds/${config.guildId}/commands`, {
    method: "PUT", body: JSON.stringify(commandDefinitions),
  });
}

function connectGateway(config, database) {
  let heartbeat = null;
  let sequence = null;
  let reconnectDelay = 1_000;
  const connect = async () => {
    try {
      const gateway = await api(config, "/gateway/bot");
      const socket = new WebSocket(`${gateway.url}/?v=10&encoding=json`);
      socket.addEventListener("message", async (event) => {
        const packet = JSON.parse(String(event.data));
        if (packet.s !== null && packet.s !== undefined) sequence = packet.s;
        if (packet.op === 10) {
          heartbeat = setInterval(() => socket.send(JSON.stringify({ op: 1, d: sequence })), packet.d.heartbeat_interval);
          socket.send(JSON.stringify({ op: 2, d: {
            token: config.token, intents: 1,
            properties: { os: process.platform, browser: "gotall-onboarding", device: "gotall-onboarding" },
          } }));
        } else if (packet.op === 7 || packet.op === 9) {
          socket.close();
        } else if (packet.t === "READY") {
          reconnectDelay = 1_000;
          console.log(new Date().toISOString(), `ready as ${packet.d.user.username} in test guild ${config.guildId}`);
        } else if (packet.t === "INTERACTION_CREATE") {
          void handleInteraction(config, database, packet.d);
        }
      });
      socket.addEventListener("close", () => {
        if (heartbeat) clearInterval(heartbeat);
        heartbeat = null;
        setTimeout(connect, reconnectDelay);
        reconnectDelay = Math.min(reconnectDelay * 2, 30_000);
      });
      socket.addEventListener("error", (event) => console.error(new Date().toISOString(), "gateway error", event.message ?? "websocket"));
    } catch (error) {
      console.error(new Date().toISOString(), "gateway connect", error.message);
      setTimeout(connect, reconnectDelay);
      reconnectDelay = Math.min(reconnectDelay * 2, 30_000);
    }
  };
  void connect();
}

function loadConfig() {
  return {
    token: readCredential("discord-bot-token"),
    guildId: requiredEnvironment("DISCORD_TEST_GUILD_ID"),
    databasePath: requiredEnvironment("DISCORD_ONBOARDING_DATABASE_PATH"),
    testMode: process.env.DISCORD_TEST_MODE !== "false",
    applicationId: "",
    ownerId: "",
  };
}

async function main() {
  const config = loadConfig();
  const database = await openDatabase(config.databasePath);
  const resources = await ensureGuildResources(config, database);
  await repairPendingApplications(config, database);
  await registerCommands(config);
  console.log(new Date().toISOString(), `registered ${commandDefinitions.length} commands; start channel ${resources.startHereId}`);
  connectGateway(config, database);
  setInterval(() => void runScheduledChecks(config, database), CHECK_INTERVAL_MS);
  void runScheduledChecks(config, database);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(new Date().toISOString(), error.message);
    process.exitCode = 1;
  });
}
