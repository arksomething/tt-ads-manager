#!/usr/bin/env node
import { startInspiration } from './inspiration.mjs';
import {assertRuntime,runtimeAllowed} from './runtime-scope.mjs';
import { syncResourceGuidance } from './resource-guidance.mjs';
import {webhookQueue,webhookServer,webhookPump} from './jotform-webhook.mjs';
import {replyBody} from './audit.mjs';
import {hubCommands} from './hubs.mjs';
import { publicCreatorResponse, saveDraftUpload } from './media.mjs';

import { readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import {protectOffboardingChannelWrites} from './offboarding.mjs';
import { createWorkspace, migrate, privateOverwrites } from "./workspace.mjs";
import * as flow from "./flow.mjs";
import {adminCommand,handleAdminCommand} from './admin.mjs';
import { TEST_GUILD_ID, startCard, statusCard, evaluateVideo, inactivityDecision, payoutForViews, validateApplication, sanitizeChannelName, normalizeMentionUsers } from "./flow.mjs";
export { evaluateVideo, inactivityDecision, payoutForViews, validateApplication, sanitizeChannelName, normalizeMentionUsers };

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
const CHECK_INTERVAL_MS = 60_000;

const commandDefinitions = [
  adminCommand,
  ...hubCommands,
  {name:"deal",description:"View your full creator deal and agreement"},
  {name:"apply",description:"Start or reopen your GoTall creator application"},
  {name:"status",description:"Open creator workspace controls",options:[{name:"creator",description:"Creator to inspect (staff only)",type:6,required:false}]},
  {name:"setup",description:"Repair the server layout and onboarding card",default_member_permissions:"32"},
  {name:"invite",description:"Create a one-use creator invite",default_member_permissions:"32",options:[{name:"hours",description:"Hours before expiry",type:4,required:false,min_value:1,max_value:168}]},
  {name:"video-check",description:"Record a manual content assessment and payout estimate",default_member_permissions:"32",options:[
    {name:"url",description:"Video URL",type:3,required:true},
    {name:"views",description:"Observed views (staff supplied)",type:4,required:true,min_value:0},
    {name:"plug",description:"GoTall plug appears in the video",type:5,required:true},
    {name:"mention",description:"Description mentions @GoTall",type:5,required:true},
    {name:"yap",description:"Description contains #yap",type:5,required:true},
    {name:"partner",description:"Provisional #partner marker (not a rejection gate)",type:5,required:true},
    {name:"creator",description:"Creator (defaults to this channel)",type:6,required:false},
  ]},
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

export async function api(config, pathname, init = {}, attempt = 0) {
  const response = await fetch(`${API}${pathname}`, {
    ...init,
    headers: {
      Authorization: `Bot ${config.token}`,
      ...(init.body instanceof FormData ? {} : {"Content-Type": "application/json"}),
      "User-Agent": "GoTallOnboardingBot/1.0",
      ...init.headers,
    },
    signal: AbortSignal.timeout(20_000),
  });
  const raw = await response.text();
  let body = {};
  try { body = raw ? JSON.parse(raw) : {}; } catch { body = {}; }
  if(response.status===429&&attempt<6) {
    await new Promise(resolve=>setTimeout(resolve,Math.max(1000,Number(body.retry_after||5)*1000)));
    return api(config,pathname,init,attempt+1);
  }
  if (!response.ok) {
    const details=[];
    const collect=(value,path='')=>{
      if(!value||typeof value!=='object')return;
      for(const entry of value._errors||[])details.push(`${path}: ${entry.message}`);
      for(const [key,child] of Object.entries(value))if(key!=='_errors')collect(child,path?`${path}.${key}`:key);
    };
    collect(body.errors);
    const error = new Error(`Discord could not complete this request (HTTP ${response.status}, code ${body.code ?? 'unknown'}): ${body.message ?? 'request failed'}${details.length?' — '+details.join('; ').slice(0,1200):''}`);
    error.status = response.status;
    error.code = body.code;
    throw error;
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
  migrate(database);
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
    channel = await protectOffboardingChannelWrites(database,config,api,resourceMap)(config, `/guilds/${config.guildId}/channels`, {
      method: "POST",
      body: JSON.stringify({ name, type, parent_id: parentId, permission_overwrites: overwrites }),
    });
    channels.push(channel);
  }
  setResource(database, key, channel.id);
  return channel.id;
}

export async function ensureGuildResources(config, database) {
  assertRuntime(config);
  const safeApi=protectOffboardingChannelWrites(database,config,api,resourceMap);
  const [guild, roles, channels, bot] = await Promise.all([
    api(config, `/guilds/${config.guildId}`),
    api(config, `/guilds/${config.guildId}/roles`),
    api(config, `/guilds/${config.guildId}/channels`),
    api(config, "/users/@me"),
  ]);
  config.applicationId = bot.id;
  config.ownerId = guild.owner_id;

  const onboardingRoleId = await findOrCreateRole(config, database, roles, "role_onboarding", "Onboarding", 0xf5c542);
  const newcomerRoleId = await findOrCreateRole(config, database, roles, "role_newcomer", "Newcomer", 0x99aab5);
  const activeRoleId = await findOrCreateRole(config, database, roles, "role_active", "Active Creator", 0x57f287);
  const atRiskRoleId = await findOrCreateRole(config, database, roles, "role_at_risk", "Inactive / At Risk", 0xed4245);
  const staffRoleId = await findOrCreateRole(config, database, roles, "role_staff", "Manager", 0x5865f2);
  if(roles.find(r=>r.id===staffRoleId)?.name!=='Manager'||!roles.find(r=>r.id===staffRoleId)?.mentionable)
    await safeApi(config,`/guilds/${config.guildId}/roles/${staffRoleId}`,{method:'PATCH',body:JSON.stringify({name:'Manager',mentionable:true})});

  config.staffRoleId = staffRoleId;
  const founderRoleId=await findOrCreateRole(config,database,roles,'role_founder','Founder',0xe6bb49);
  const adminRoleId=await findOrCreateRole(config,database,roles,'role_admin','Admin',0x7799bb);
  const adminPermissions=BigInt(roles.find(r=>r.id===adminRoleId)?.permissions||'0')|ADMINISTRATOR;
  try {
    await safeApi(config,`/guilds/${config.guildId}/roles/${adminRoleId}`,{method:'PATCH',body:JSON.stringify({permissions:adminPermissions.toString(),hoist:false})});
  } catch(error) {
    if(!String(error.message).includes('50013'))throw error;
    console.warn('Admin role needs Administrator enabled by the server owner; bot cannot grant this permission.');
  }
  // Preserve founders' authority through Admin when retiring Founder privileges.
  const members=await safeApi(config,`/guilds/${config.guildId}/members?limit=1000`);
  for(const member of members)if(member.roles.includes(founderRoleId)&&!member.roles.includes(adminRoleId))
    await safeApi(config,`/guilds/${config.guildId}/members/${member.user.id}/roles/${adminRoleId}`,{method:'PUT'});
  const founder=roles.find(r=>r.id===founderRoleId);
  if(founder?.permissions!=='0')await safeApi(config,`/guilds/${config.guildId}/roles/${founderRoleId}`,{method:'PATCH',body:JSON.stringify({permissions:'0',hoist:true,mentionable:false})});
  const scriptsRoleId=await findOrCreateRole(config,database,roles,'role_scripts','Scripts',0x50aa80);
  await findOrCreateRole(config,database,roles,'role_new_deal','New Deal',0x5798cc);
  const onboardingCategoryId = await findOrCreateChannel(config, database, channels, "category_onboarding", "New / Onboarding", 4);
  const activeCategoryId = await findOrCreateChannel(config, database, channels, "category_active", "Active Creators", 4);
  const atRiskCategoryId = await findOrCreateChannel(config, database, channels, "category_at_risk", "Inactive / At Risk", 4);
  const inactiveCategoryId = await findOrCreateChannel(config, database, channels, "category_inactive", "Not Active Creators", 4);
  const reviewOverwrites=[
    {id:config.guildId,type:0,allow:'0',deny:VIEW_CHANNEL.toString()},
    {id:staffRoleId,type:0,allow:CREATOR_CHANNEL_ALLOW.toString(),deny:'0'},
    {id:adminRoleId,type:0,allow:CREATOR_CHANNEL_ALLOW.toString(),deny:'0'},
    ...[bot.id,guild.owner_id].map(id=>({id,type:1,allow:CREATOR_CHANNEL_ALLOW.toString(),deny:'0'})),
  ];
  const reviewId=await findOrCreateChannel(config,database,channels,'channel_staff_reviews','onboarding-reviews',0,null,reviewOverwrites);
  await safeApi(config,`/channels/${reviewId}`,{method:'PATCH',body:JSON.stringify({name:'onboarding-reviews',permission_overwrites:reviewOverwrites})});
  const videoReviewId=await findOrCreateChannel(config,database,channels,'channel_video_reviews','video-reviews',0,null,reviewOverwrites);
  await safeApi(config,`/channels/${videoReviewId}`,{method:'PATCH',body:JSON.stringify({permission_overwrites:reviewOverwrites})});
  const scriptsOverwrites=[
    {id:config.guildId,type:0,allow:'0',deny:(VIEW_CHANNEL|SEND_MESSAGES|(1n<<35n)|(1n<<36n)|(1n<<38n)).toString()},
    {id:scriptsRoleId,type:0,allow:(VIEW_CHANNEL|READ_MESSAGE_HISTORY).toString(),deny:(SEND_MESSAGES|(1n<<35n)|(1n<<36n)|(1n<<38n)).toString()},
    ...[staffRoleId,adminRoleId].map(id=>({id,type:0,allow:(CREATOR_CHANNEL_ALLOW|(1n<<17n)).toString(),deny:'0'})),
    ...[bot.id,guild.owner_id].map(id=>({id,type:1,allow:CREATOR_CHANNEL_ALLOW.toString(),deny:'0'}))];
  const scriptsId=await findOrCreateChannel(config,database,channels,'channel_scripts','scripts',0,null,scriptsOverwrites);
  await safeApi(config,`/channels/${scriptsId}`,{method:'PATCH',body:JSON.stringify({permission_overwrites:scriptsOverwrites})});

  await findOrCreateRole(config,database,roles,'role_hub_access','Creator Hub Access',0x57f287);

  const startHereOverwrites = [
    { id: config.guildId, type: 0, allow: "0", deny: (VIEW_CHANNEL | SEND_MESSAGES).toString() },
    { id: newcomerRoleId, type: 0, allow: (VIEW_CHANNEL | READ_MESSAGE_HISTORY).toString(), deny: SEND_MESSAGES.toString() },
    { id: bot.id, type: 1, allow: CREATOR_CHANNEL_ALLOW.toString(), deny: "0" },
  ];
  const legacyRoleId=resourceMap(database).role_legacy;
  if(legacyRoleId)startHereOverwrites.push({id:legacyRoleId,type:0,allow:'0',deny:VIEW_CHANNEL.toString()});
  for(const id of [staffRoleId,adminRoleId])startHereOverwrites.push({id,type:0,allow:CREATOR_CHANNEL_ALLOW.toString(),deny:'0'});
  const startHereId = await findOrCreateChannel(
    config, database, channels, "channel_start_here", "start-here", 0,
    onboardingCategoryId, startHereOverwrites,
  );
  await safeApi(config,`/channels/${startHereId}`,{method:'PATCH',body:JSON.stringify({permission_overwrites:startHereOverwrites})});
  if (!resourceMap(database).message_start_here) {
    const message = await safeApi(config, `/channels/${startHereId}/messages`, {
      method: "POST",
      body: JSON.stringify({
        ...startCard(),
        allowed_mentions: { parse: [] },
      }),
    }).catch(() => null);
    if (message?.id) setResource(database, "message_start_here", message.id);
  }

  await syncResourceGuidance({config,database,roles,channels,bot,api:safeApi,findRole:findOrCreateRole,findChannel:findOrCreateChannel,resources:resourceMap,save:setResource});

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
        input("name", "What should we call you?", "Alex", 80,1,true,"Your preferred name or nickname — whatever you’d like the team to call you."),
        input("phone", "Phone number", "+1 202 555 0147", 30,1,true,"Include your country code. This is shared with the team in your creator workspace."),
        input("location", "Location / timezone", "London, UK / Europe/London", 100,1,true,"Enter your city and country or timezone. We’ll use this to set your posting day."),
        input("platforms", "Usernames and platforms", "TikTok, Instagram, YouTube, Facebook usernames", 400, 2,true,"List the social accounts you use. Campaign profile links are collected after this application."),
        input("best_video", "Best video link (optional)", "https://www.tiktok.com/...", 500, 1, false,"Share a sample of your work, or leave this blank. A sample is not required to apply."),
      ],
    },
  };
}

function input(customId, label, placeholder, maxLength, style = 1, required = true, description = '') {
  return flow.formInput(customId,label,placeholder,maxLength,style,required,description);
}

function modalValues(interaction) {
  return flow.modalValues(interaction);
}

function option(interaction, name) {
  return interaction.data?.options?.find((item) => item.name === name)?.value;
}

function actorId(interaction) {
  return interaction.member?.user?.id ?? interaction.user?.id ?? "";
}

function isAdmin(interaction, config) {
  if (actorId(interaction) === config.ownerId) return true;
  if ((interaction.member?.roles ?? []).includes(config.staffRoleId)) return true;
  const permissions = BigInt(interaction.member?.permissions ?? "0");
  return (permissions & ADMINISTRATOR) !== 0n;
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
  interaction.acknowledged = true;
}

async function defer(config, interaction, publicly = false) {
  await interactionCallback(config, interaction, { type: 5, data: publicly ? {} : { flags: 64 } });
}

async function editReply(config, interaction, content) {
  await api(config, `/webhooks/${config.applicationId}/${interaction.token}/messages/@original`, {
    method: "PATCH",
    body: replyBody(typeof content === "string" ? { content: content.slice(0,1900), allowed_mentions: { parse: [] } } : content),
  });
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

export async function handleGuildMemberAdd(config, database, member) {
  if (member.guild_id !== config.guildId || member.user?.bot) return false;
  const existing=database.prepare('SELECT * FROM creators WHERE discord_user_id=?').get(member.user.id);
  if(existing?.offboarding_id) {await workspace(config,database).offboarding.rejoined(existing);return true;}
  const roleId = resourceMap(database).role_newcomer;
  if (!roleId) throw new Error("Newcomer role is not configured.");
  await setRole(config, member.user.id, roleId, true);
  return true;
}

async function createCreatorChannel(config, database, application, userId) {
  const resources = resourceMap(database);
  const channels = await api(config, `/guilds/${config.guildId}/channels`);
  const previous = channels.filter(c => c.type === 0 && (c.topic === `GoTall creator • user ${userId}` || c.topic?.startsWith(`GoTall creator • user ${userId} •`)));
  if (previous.length > 1) throw new Error("Multiple creator channels need staff review.");
  if (previous.length === 1) return previous[0].id;
  const channel = await api(config, `/guilds/${config.guildId}/channels`, {
    method: "POST",
    body: JSON.stringify({
      name: `🟡-${sanitizeChannelName(application.name)}`,
      type: 0,
      parent_id: resources.category_onboarding,
      topic: `GoTall creator • user ${userId}`,
      permission_overwrites: privateOverwrites(config, resources, userId),
    }),
  });
  return channel.id;
}

export function legacyApplicant(database, interaction) {
  const userId=actorId(interaction),legacyRole=resourceMap(database).role_legacy;
  const legacy=Boolean(database.prepare('SELECT 1 FROM legacy_participants WHERE creator_id=?').get(userId)) ||
    database.prepare('SELECT cohort FROM creators WHERE discord_user_id=?').get(userId)?.cohort==='legacy' ||
    Boolean(legacyRole&&interaction.member?.roles?.includes(legacyRole));
  if(legacy)database.prepare('INSERT OR IGNORE INTO legacy_participants VALUES(?,?)').run(userId,new Date().toISOString());
  return legacy;
}
const LEGACY_ONBOARDING_NOTICE='You are already a legacy creator. Your existing deal stays unchanged, and new-deal onboarding is not available to you. Keep using your creator channel; ask Judy there if you need help.';

async function handleApplication(config, database, interaction) {
  if(legacyApplicant(database,interaction))return editReply(config,interaction,LEGACY_ONBOARDING_NOTICE);
  const values = modalValues(interaction);
  const checked = validateApplication({
    name: values.name, phone: values.phone, location: values.location,
    platforms: values.platforms, bestVideo: values.best_video,
  });
  if (!checked.ok) return editReply(config, interaction, checked.error);

  const userId = actorId(interaction);
  if(database.prepare('SELECT 1 FROM legacy_participants WHERE creator_id=?').get(userId))return editReply(config,interaction,'Your existing creator arrangement is preserved. Contact Judy in your creator channel; new-deal onboarding is not available for existing creators.');
  const existing = database.prepare("SELECT * FROM creators WHERE discord_user_id = ?").get(userId);
  if (existing) {
    if (!existing.welcome_sent_at) {
      database.prepare(`UPDATE creators SET name=?, phone=?, location=?, platforms=?, best_video=?, updated_at=?
        WHERE discord_user_id=?`)
        .run(
          checked.value.name, checked.value.phone, checked.value.location,
          checked.value.platforms, checked.value.bestVideo, new Date().toISOString(), userId,
        );
      const refreshed = database.prepare("SELECT * FROM creators WHERE discord_user_id = ?").get(userId);
      await workspace(config, database).sync(refreshed);
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
  await workspace(config, database).sync(workspace(config, database).creator(userId));
  return editReply(config, interaction, `🎉 You’re officially inside! Your application is saved.\nYour private onboarding room is <#${channelId}>. That’s where you’ll work directly with the team while getting set up.`);
}

const workspaces = new WeakMap();
function workspace(config, database) {
  if (!workspaces.has(database)) workspaces.set(database, createWorkspace(config,database,{
    api,resourceMap,setResource,callback:interactionCallback,editReply,input,
    saveUpload:(i,file)=>saveDraftUpload(config,i,file,api),
  }));
  return workspaces.get(database);
}
let pending = Promise.resolve();
function serialized(work) {
  const result = pending.then(work);
  pending = result.catch(()=>{});
  return result;
}
async function handleCommand(config, database, interaction) {
  const w=workspace(config,database), name=interaction.data?.name;
  if(name==='creator')return handleAdminCommand(config,database,interaction,w);
  if(name==='deal') {
    const c=w.creator(actorId(interaction));if(!c)return w.reply(interaction,'Start onboarding to create your workspace.');
    return w.handle({...interaction,data:{custom_id:`gt:deal:${c.discord_user_id}:view`}});
  }
  if(['posts','payments'].includes(name)) {
    const c=w.creator(actorId(interaction));
    if(!c)return w.reply(interaction,'Start onboarding in #start-here to create your workspace.');
    if(interaction.channel_id!==c.channel_id)return w.reply(interaction,`Open your private creator channel <#${c.channel_id}> and run /${name} there.`);
    return w.handle({...interaction,data:{custom_id:`gt:${name}:${option(interaction,'month')||''}${name==='posts'?':0':''}:${option(interaction,'source')||''}`}});
  }
  if(name==='status') {
    const c=creatorByContext(database,interaction,true);
    if(!c)return editReply(config,interaction,'Use Start onboarding in #start-here.');
    if(c.discord_user_id!==actorId(interaction)&&!w.staff(interaction))throw new Error('Only staff can inspect another creator.');
    return w.reply(interaction,statusCard(c,config.testMode));
  }
  if(!w.staff(interaction))throw new Error('This command is for GoTall staff.');
  if(name==='setup') {
    await ensureGuildResources(config,database);await w.publishStart();
    return editReply(config,interaction,'Workspace layout and onboarding card updated.');
  }
  if(name==='invite') {
    const r=resourceMap(database);
    const invite=await api(config,`/channels/${r.channel_start_here}/invites`,{method:'POST',body:JSON.stringify({max_age:Number(option(interaction,'hours')??24)*3600,max_uses:1,unique:true,temporary:false})});
    return editReply(config,interaction,`One-use invite: https://discord.gg/${invite.code}`);
  }
  const c=creatorByContext(database,interaction);
  if(!c)throw new Error('Use this inside a creator channel or select a creator.');
  if(name==='video-check') {
    const result=evaluateVideo({plug:option(interaction,'plug')===true,mention:option(interaction,'mention')===true,yap:option(interaction,'yap')===true,partner:option(interaction,'partner')===true,views:Number(option(interaction,'views'))});
    database.prepare('INSERT INTO video_checks (discord_user_id,url,views,eligible,payout,missing_json,created_at) VALUES (?,?,?,?,?,?,?)').run(c.discord_user_id,safeText(option(interaction,'url'),500),Number(option(interaction,'views')),result.eligible?1:0,result.payout,JSON.stringify(result.missing),new Date().toISOString());
    return editReply(config,interaction,`Manual staff assessment: ${result.eligible?'required markers confirmed':'missing '+result.missing.join(', ')}. Draft highest-tier bonus estimate: $${result.payout}; stacking is unconfirmed and the conditional $500 monthly base is not included. ${result.policyNotes.join(' ')} No payment approved or sent.`);
  }
  return w.reply(interaction,{...statusCard(c,config.testMode),content:'Use the workspace buttons and Staff controls. Legacy commands cannot skip account approval, signing, or trial review.'});
}
export async function handleInteraction(config, database, interaction) {
  if (config.inspiration?.owns(interaction)) return config.inspiration.handle(interaction);
  if(!runtimeAllowed(config) || interaction.guild_id!==config.guildId)return;
  try {
    const w=workspace(config,database), id=interaction.data?.custom_id;
    const applying=(interaction.type===2&&interaction.data?.name==='apply') ||
      (interaction.type===3&&id==='gt:apply') || (interaction.type===5&&id==='gotall-apply-v1');
    if(applying&&database.prepare('SELECT offboarding_id FROM creators WHERE discord_user_id=?').get(actorId(interaction))?.offboarding_id)return await interactionCallback(config,interaction,{type:4,data:{content:'Your program participation is closed. Use your private channel for payment support or ask staff about returning.',flags:64}});
    if(applying&&legacyApplicant(database,interaction))return await interactionCallback(config,interaction,{type:4,data:{content:LEGACY_ONBOARDING_NOTICE,flags:64,allowed_mentions:{parse:[]}}});
    if(id==='gt:test_signed'||id==='gt:form:test_signed')throw new Error('This control is no longer available. Use Review & sign on your current status card.');
    if((interaction.type===2&&interaction.data?.name==='apply')||(interaction.type===3&&id==='gt:apply'))return await interactionCallback(config,interaction,modalResponse());
    if(interaction.type===3&&/^gt:deal:\d+:edit_/u.test(id||''))return await w.openModal(interaction,id.slice(3));
    const buttonAction=id?.replace(/^gt:(?:review:\d+:)?/u,'');
    if(interaction.type===3 && (buttonAction?.startsWith('hub_issue:')||buttonAction?.startsWith('hub_resolve:')))return await w.openModal(interaction,buttonAction);
    if(interaction.type===3 && buttonAction?.startsWith('manual_next:'))return await w.openModal(interaction,buttonAction);
    if(interaction.type===3 && ['pay_wise','pay_paypal','pay_bank','accounts','add_accounts','post','leave','changes','agreement_link','exception','deny_leave','test_clock','first_video','confirm_signature','revise_first_video'].includes(buttonAction))return await w.openModal(interaction,buttonAction);
    const channelCreator=database.prepare('SELECT * FROM creators WHERE channel_id=?').get(interaction.channel_id || '');
    await defer(config,interaction,publicCreatorResponse(interaction,channelCreator,resourceMap(database).channel_start_here,resourceMap(database).channel_staff_reviews,w.staff(interaction)));
    await serialized(async()=>{
      if(interaction.type===2)await handleCommand(config,database,interaction);
      else if(interaction.type===5&&id==='gotall-apply-v1')await handleApplication(config,database,interaction);
      else if([3,5].includes(interaction.type)&&id?.startsWith('gt:'))await w.handle(interaction);
      else await editReply(config,interaction,'This control has expired. Use /status.');
    });
  } catch(error) {
    console.error(new Date().toISOString(),'interaction',error.message);
    const channelCreator=database.prepare('SELECT * FROM creators WHERE channel_id=?').get(interaction.channel_id || '');
    const data={content:String(error.message||'Something went wrong. Please try again.').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/gu,' ').slice(0,1800),...(publicCreatorResponse(interaction,channelCreator,resourceMap(database).channel_start_here)?{}:{flags:64}),allowed_mentions:{parse:[]}};
    try {
      if(!interaction.acknowledged)await interactionCallback(config,interaction,{type:4,data});
      else await editReply(config,interaction,data.content);
    } catch {}
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
            token: config.token, intents: 515,
            properties: { os: process.platform, browser: "gotall-onboarding", device: "gotall-onboarding" },
          } }));
        } else if (packet.op === 7 || packet.op === 9) {
          socket.close();
        } else if (packet.t === "READY") {
          reconnectDelay = 1_000;
          console.log(new Date().toISOString(), `ready as ${packet.d.user.username} in guild ${config.guildId}`);
        } else if (packet.t === "INTERACTION_CREATE") {
          void handleInteraction(config, database, packet.d);
        } else if (packet.t === "GUILD_MEMBER_ADD") {
          void serialized(() => handleGuildMemberAdd(config, database, packet.d))
            .catch(error => console.error("Newcomer role", error.message));
        } else if(['MESSAGE_CREATE','MESSAGE_UPDATE'].includes(packet.t)&&packet.d.guild_id===config.guildId) {
          void serialized(async()=>{const w=workspace(config,database);if(packet.t==='MESSAGE_CREATE')await w.offboarding.observe(packet.d);const nonTalking=packet.t==='MESSAGE_CREATE'&&await w.scripts.ingestNonTalking(packet.d);const script=await w.scripts.ingest(packet.d);if(nonTalking||script)await w.schedule();}).catch(e=>console.error('Script delivery',e.message));
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
    jotformApiKey: process.env.GOTALL_JOTFORM_ENABLED === 'true' ? readCredential('jotform-api-key') : undefined,
    guildId: process.env.DISCORD_GUILD_ID || requiredEnvironment("DISCORD_TEST_GUILD_ID"),
    productionApproved: process.env.DISCORD_PRODUCTION_ENABLED === 'true',
    databasePath: requiredEnvironment("DISCORD_ONBOARDING_DATABASE_PATH"),
    testMode: process.env.DISCORD_TEST_MODE !== "false",
    applicationId: "",
    ownerId: "",
  };
}

async function main() {
  const config = loadConfig();
  assertRuntime(config);
  const database = await openDatabase(config.databasePath);
  if(!config.testMode&&resourceMap(database).production_cutover_guild!==config.guildId)throw Error('Production roster must be imported before startup.');
  const resources = await ensureGuildResources(config, database);
  await workspace(config,database).offboarding.ensureResources();
  await workspace(config,database).publishStart();
  // Refresh existing status cards when a release changes the copy or controls.
  database.prepare("UPDATE creators SET sync_pending=1").run();
  await registerCommands(config);
  console.log(new Date().toISOString(), `registered ${commandDefinitions.length} commands; start channel ${resources.startHereId}`);
  let startingInspiration = false;
  const initializeInspiration = async () => {
    if (config.inspiration || startingInspiration) return;
    startingInspiration = true;
    try { config.inspiration = await startInspiration(config, readCredential); }
    catch (error) { console.error('Inspiration initialization failed; retrying:', error.message); }
    finally { startingInspiration = false; }
  };
  await initializeInspiration();
  if (process.env.GOTALL_INSPIRATION_ENABLED === 'true') setInterval(() => void initializeInspiration(), 60000);
  connectGateway(config, database);
  let checking = false;
  const check = async () => {
    if(checking) return; checking = true;
    try { await serialized(()=>workspace(config,database).schedule()); }
    catch(error) { console.error("schedule",error.message); }
    finally { checking = false; }
  };
  setInterval(()=>void check(),CHECK_INTERVAL_MS);
  void check();
  if(process.env.GOTALL_JOTFORM_WEBHOOK_PORT) {
    if(!config.jotformApiKey)throw Error('Webhook requires Jotform API access.');
    const queue=webhookQueue(database);
    const pump=webhookPump(queue,()=>serialized(()=>workspace(config,database).schedule(Date.now(),true)),{onError:()=>console.error('Jotform webhook verification failed; queued for retry.')});
    const server=webhookServer({secret:readCredential('jotform-webhook-secret'),queue,onQueued:()=>void pump()});
    server.on('error',()=>{console.error('Jotform webhook listener failed.');process.exit(1);});
    server.listen(Number(process.env.GOTALL_JOTFORM_WEBHOOK_PORT),'127.0.0.1',()=>console.log('Jotform webhook listener ready.'));
    setInterval(()=>void pump(),1000);void pump();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(new Date().toISOString(), error.message);
    process.exitCode = 1;
  });
}
