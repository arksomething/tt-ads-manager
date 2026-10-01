import { NEW_DEAL_POSTING } from './messages.mjs';
import {assertRuntime} from './runtime-scope.mjs';
import { syncAccessTutorials } from './app-access-guidance.mjs';
export const RESOURCE_GUIDANCE_VERSION = '2026-09-16';
export const TEST_RESOURCE_GUILD = '1245112089647775877';
export const VIEW = 1n << 10n;
export const READ = 1n << 16n;
export const WRITE = (1n << 11n) | (1n << 35n) | (1n << 36n) | (1n << 38n) | (1n << 31n) | (1n << 49n) | (1n << 50n);
const STAFF = VIEW | READ | WRITE | (1n << 14n) | (1n << 15n) | (1n << 13n);

export function resourcePermissions(guildId, readers, staff, botId, writable = false) {
  return [
    { id: guildId, type: 0, allow: '0', deny: (VIEW | WRITE).toString() },
    ...[...new Set(readers)].filter(Boolean).filter(id => !staff.includes(id)).map(id => ({ id, type: 0, allow: (VIEW | READ | (writable ? WRITE : 0n)).toString(), deny: (writable ? 0n : WRITE).toString() })),
    ...[...new Set(staff)].filter(Boolean).map(id => ({ id, type: 0, allow: STAFF.toString(), deny: '0' })),
    { id: botId, type: 1, allow: STAFF.toString(), deny: '0' },
  ];
}

function card(title, description) {
  return { content: '', embeds: [{ title, description, color: 0x8b9c87, author: { name: 'GoTall Creators' }, footer: { text: 'GoTall creators' } }], allowed_mentions: { parse: [] }, components: [] };
}

export function guidanceCards(r) {
  const channel = key => `<#${r[`channel_${key}`]}>`;
  const judy = '<@1470834529077035195>', evan = '<@571179674323910667>';
  return {
    creator_guide: card('Your GoTall creator guide', `**Your GoTall Team**\n**Judy / Blazie - your main contact**\nQuestions about scripts, feedback, posting or your next step? Ask ${judy} in your creator channel. For technical review or something broken, tag ${evan} with a screenshot and what happened. Keep it in the server, not DMs, so Evan and Blazie can see what has already been covered.\n\n**Your Routine**\n${NEW_DEAL_POSTING} Legacy creators keep their agreed posting schedule. Follow the current direction from the team. Creators with Scripts receive daily ideas in ${channel('scripts')}. Film your draft and follow the review instructions in your private creator channel. A new assigned script replaces unfinished work; old examples are inspiration, not new assignments.\n\n**Before You Post**\nCreate in English for a Tier-1 audience, such as the US, Canada or Australia. Show the GoTall prediction screenshot within the first **10 seconds**, full-screen by itself for at least **3 seconds**, with the logo readable. Keep speech clear, lighting clean and pacing tight. No other brand promotions or hateful content in GoTall videos.\n\n**Your Profile & Caption**\nBio: **Tracking my height + building better habits with @gotallapp**\nFirst caption line: **Height tracking + better habits with @gotallapp**\nTalking videos: add **#yap**. Non-talking videos: leave it off.\n\n**After Posting**\nReply to real viewer questions and keep the conversation going. Use the TikTok poll in ${channel('posting_checklist')} where available. Follow the advertising-authorization instructions in your private channel; Judy can help if they are missing.\n\n**Payments & Time Off**\nUse **Payment hub** on your status card for payment details and **My deal** for your own terms. Tell Judy the month if a payment looks wrong; never paste banking details into chat. No manual invoice is needed unless the team asks you to resolve a specific issue. Use **Request time off** with your dates, or ask Judy in your channel.\n\n**Everything Else**\n${channel('app_access')} - free app access\n${channel('assets')} - screenshots and creative assets\n${channel('winning_formats')} - examples and filming tips\n${channel('posting_checklist')} - complete posting checklist\n${channel('resource_faq')} - quick answers`),
    welcome_resources: card('Welcome to GoTall', `Your creator channel is your home base for the team, feedback and your next step.\n\n**Meet the team**\n${judy} handles scripts, content feedback and day-to-day questions. Tag ${evan} for technical review with a screenshot and what happened. Keep conversations in the server rather than DMs.\n\n**Start here**\nRead ${channel('creator_guide')} for the essentials. App access, assets and examples are in Creator Hub. Your private status card has your own next action and payment controls.\n\n**Updates**\n${channel('resource_announcements')} is for current team updates. Video ideas are in ${channel('scripts')} for creators with Scripts access.`),
    posting_checklist: card('Your posting checklist', `${NEW_DEAL_POSTING} Legacy creators keep their agreed schedule.\n\n**Film It Clearly**\nUse English and your agreed content direction for a Tier-1 audience. Show a GoTall prediction screenshot within the first **10 seconds**, full-screen by itself for at least **3 seconds**. Keep the logo visible. Use clear lighting, clean cuts and speech louder than the background music.\n\n**Keep It On Brand**\nNo other brand promotions in the same video. No hate, racism, sexism or extremist content. Do not turn old example scripts into unsupported claims or invented personal results.\n\n**Check Your Text**\nBio: **Tracking my height + building better habits with @gotallapp**\nFirst caption line: **Height tracking + better habits with @gotallapp**\nAdd **#yap** to talking videos only. Keep the app mention visible before the caption expands.\n\n**Follow Your Review Step**\nUse the instructions in your private creator channel before publishing. An approval covers that draft, not a different video.\n\n**Add the TikTok Poll**\nQuestion: **Why do you want to use the GoTall App?**\nOptions: **Want to grow taller** / **Just curious**\nDuration: **Indefinitely**\n[Poll tutorial](https://vt.tiktok.com/ZSCYStCrD/). If the option is unavailable, tell Judy in your creator channel.\n\n**Stay Involved**\nAnswer genuine viewer questions. When someone asks for the app, reply with **GoTall - Height Predictor**, available on the App Store and Google Play.\n\n**Advertising Access**\nComplete the authorization the team sends in your private channel using the account you post GoTall content from. Confirm there when done; ask Judy if the link or QR code is missing. Do not share account passwords.`),
    resource_faq: card('Quick answers', `**How often should I post?**\n${NEW_DEAL_POSTING} Legacy creators keep their agreed schedule.\n\n**How long should the screenshot appear?**\nAt least **3 seconds**, full-screen by itself, within the first 10 seconds.\n\n**Where do I get a script?**\n${channel('scripts')} is the daily idea source for creators with Scripts access. Follow the current direction in your private channel; old examples do not override it.\n\n**Do I need an invoice?**\nNo manual invoice is needed as part of the normal process. The team calculates earnings. Your own deal controls your rate, caps and eligible views.\n\n**When is my payment coming?**\nCheck Payment hub for your payment information. Ask Judy in your creator channel with the month concerned. Processing and arrival are different; we will check your payment before promising a date.\n\n**The app is asking me to pay.**\nUse ${channel('app_access')}. If access still fails, tag ${evan} in your creator channel with a screenshot. Do not pay just to get past it.\n\n**Can I change accounts or try another format?**\nAsk Judy first so the team can check the plan and keep your account records correct. Keep your old account until outstanding payments have been checked.\n\n**Need help or a break?**\nKeep questions in your creator channel. Use Request time off with your dates, or ask Judy there.`),
    app_access: card('Get GoTall for free', `Choose your phone below. Each guide has a short video you can watch here in Discord.\n\n**iPhone**\n[Install and unlock GoTall](https://discord.com/channels/${TEST_RESOURCE_GUILD}/${r.channel_app_access}/${r.message_access_ios})\n\n**Android**\n[1. Install GoTall](https://discord.com/channels/${TEST_RESOURCE_GUILD}/${r.channel_app_access}/${r.message_access_android})\n[2. Unlock free access](https://discord.com/channels/${TEST_RESOURCE_GUILD}/${r.channel_app_access}/${r.message_access_android_unlock})\n\n**Before confirming any purchase**\nThe Apple or Google payment sheet must explicitly say it is a test and you will not be charged. If it does not, stop and tag ${evan} in your creator channel with a screenshot.`),
    assets: card('Your GoTall assets', `**Prediction Screenshots**\n[Open the GoTall Creator Assets folder](https://drive.google.com/drive/folders/1RYq-wo_0eg_vxNTFsMtCBRjhXaGNv8oE?usp=drive_link). You can also capture the app screen needed for your assigned video.\n\n**App Demo**\n[Open the iMessage screen recording](https://drive.google.com/file/d/1G209VBPRlh0dQa1IxupnjEXq_xKs8pCC/view). Use it when it matches your current brief, not as a new assignment.\n\n**Keep It Readable**\nDo not crop or obscure the GoTall logo. Show prediction screenshots full-screen by themselves for at least **3 seconds**, within the first 10 seconds.\n\n**Missing an Asset?**\nAsk Judy in your creator channel for the logo or file you need. Tell us if a shared file will not open.`),
    winning_formats: card('Make your next video stronger', `**Start With Your Current Brief**\nUse the team's current direction. These are reference examples, not a replacement for an assigned script.\n\n**Hook, Then Show**\nGive the viewer a reason to stay in the first second. Remove dead air and unnecessary setup. Keep the app integration clear and your delivery natural.\n\n**Make It Easy to Watch**\nUse clean lighting, readable screens and a clear voice above the music. Change the shot when it helps the story; keep the required screenshot on screen for **3 seconds**.\n\n**Examples Shared by the Team**\n[Talking-format reference](https://www.tiktok.com/@dobbingotall/video/7663224704299240735)\n[Creator example highlighted in top-performing videos](https://www.tiktok.com/@gotallash/video/7622784805012262175)\n[Voice-over tutorial shared with the latest format](https://vt.tiktok.com/ZSqBcTVag/)\n\n**Bring Your Own Idea**\nSend the concept or a reference in your creator channel and discuss it with Judy. Study the execution of older examples; do not copy unsupported claims or assume every historical format is still approved.`),
    creator_community: card('Your creator community', `Share progress, ideas and encouragement here.\n\nKeep personal feedback, technical problems, account changes and payment questions in your own creator channel so the team can follow the full conversation. Never post banking details or account passwords here.`),
    resource_announcements: card('GoTall updates', `Current team updates will appear here. The standing guidance is in ${channel('creator_guide')} and ${channel('posting_checklist')}.\n\nAsk questions in your creator channel so the team can help with your situation.`),
    legacy_details: card('Your existing creator arrangement', `**Your Deal Stays Yours**\nKeep your existing agreed terms and approval arrangements. Moving the server layout does not change your rate or restart onboarding. If you were already onboarding, finish under the old terms.\n\n**Your Existing Channels**\n${channel('legacy_submit')} - submit videos using your existing workflow\n${channel('legacy_accounts')} - share account links with the team\nThese channels are for Legacy creators and managers.\n\n**Payments**\nThe team calculates earnings; you do not need to make a manual invoice. Your agreed rate, cap and eligible-view window still apply. Ask Judy about the month or video concerned rather than comparing your deal with somebody else's. Never paste banking details here.\n\n**Coming Back After a Break?**\nYour legacy status and original deal stay with you. Speak to Judy before returning; active access and Scripts are not automatically restored.\n\n**Resources**\nThe shared Creator Hub is still yours to use. Follow the current creative checklist, including the **3-second** screenshot requirement.`),
    legacy_submit: card('Legacy video submissions', 'Keep using this channel for your existing video-submission workflow. Your agreed terms and approval arrangements are unchanged. For personal feedback or payment questions, ask in your creator channel.'),
    legacy_accounts: card('Legacy account links', 'Share the profile link for your GoTall account here. Ask Judy before changing accounts, and keep your old account until the team has checked outstanding payments. Never share login details.'),
    resource_audit: card('Resource consolidation - staff review', `**Test server only - ${RESOURCE_GUIDANCE_VERSION}**\nProduction source: 13 Details / Server Info channels, 2,644 messages exported with pagination. Message and attachment references are preserved in a protected local export; this is not a downloaded-media or thread backup.\n\n**Reconciled**\n3-second screenshots (owner decision); current March bio/caption; talking-only #yap; July no-manual-invoice update; creator-channel support instead of DMs; legacy deals preserved.\n\n**Retained as Guidance**\nPoll settings and manual advertising authorization from existing announcements. Neither is a new automated approval gate. Linked media has not been fully watched or independently validated.\n\n**Do Not Republish as Current Policy**\nOld promo codes, temporary app outages, invoice tutorials, superseded rates/caps and blanket first-video bonuses. View-window/payment disputes must use the actual deal and records, not a general announcement.\n\n**Needs Staff Review**\nThe source requests staged comments from another account: the new guide uses genuine viewer replies instead. Old scripts include unsupported growth claims and personal-result claims: these were not republished. The factory-reset/proxy audience tutorial is not a default setup instruction. The advertising QR is not republished as a permanent link; Judy handles current authorization. Historical format bans and "only this format" messages need confirmation before becoming standing guidance.\n\n**Archive**\nThe retired test script-library stays hidden with its content intact. Production archival, owner/cohort imports and permission changes have not run.`),
  };
}

export async function syncResourceGuidance({ config, database, roles, channels, bot, api, findRole, findChannel, resources, save }) {
  assertRuntime(config);
  const request = api;
  api = async (...args) => {
    for (let attempt = 0; ; attempt++) {
      try { return await request(...args); }
      catch (error) {
        if (error.status !== 429 || attempt >= 4) throw error;
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }
  };
  const legacy = await findRole(config, database, roles, 'role_legacy', 'Legacy', 0x859c8c);
  let r = resources(database);
  const staff = [r.role_staff, r.role_admin];
  // Shared server resources become visible when first-video preparation opens.
  // Account setup, warm-up and signing stay in the creator's private room.
  const readers = [r.role_active, r.role_hub_access, legacy];
  const hubReaders = [r.role_active, r.role_hub_access, legacy];
  const shared = resourcePermissions(config.guildId, readers, staff, bot.id);
  const legacyOnly = resourcePermissions(config.guildId, [legacy], staff, bot.id);
  const staffOnly = resourcePermissions(config.guildId, [], staff, bot.id);
  const archiveOnly = resourcePermissions(config.guildId, [], [], bot.id);
  async function ensure(key, name, type, parent, permissions) {
    const id = await findChannel(config, database, channels, key, name, type, parent, permissions);
    await api(config, `/channels/${id}`, { method: 'PATCH', body: JSON.stringify({ name, ...(type === 0 ? { parent_id: parent } : {}), permission_overwrites: permissions }) });
    return id;
  }
  const info = await ensure('category_server_info', 'Server Info', 4, null, shared);
  const details = await ensure('category_details', 'Details', 4, null, shared);
  const hub = await ensure('category_hub', 'Creator Hub', 4, null, resourcePermissions(config.guildId, hubReaders, staff, bot.id));
  const old = await ensure('category_legacy_details', 'Legacy Details', 4, null, legacyOnly);
  const archive = await ensure('category_resource_archive', 'Resource Archive', 4, null, archiveOnly);
  const staffCategory = config.testMode ? await ensure('category_resource_staff', 'Resource Review', 4, null, staffOnly) : null;
  const definitions = [
    ['welcome_resources', 'welcome', info], ['resource_announcements', 'announcements', info],
    ['creator_guide', 'creator-guide', details], ['posting_checklist', 'posting-checklist', details], ['resource_faq', 'faq', details],
    ['app_access', 'get-the-app', hub], ['assets', 'assets', hub], ['winning_formats', 'winning-formats', hub], ['creator_community', 'creator-community', hub],
    ['legacy_details', 'legacy-guide', old], ['legacy_submit', 'submit-your-video', old], ['legacy_accounts', 'drop-your-tiktok', old],
    ...(config.testMode ? [['resource_audit', 'resource-audit', staffCategory]] : []),
  ];
  for (const [key, name, parent] of definitions) {
    const writable = ['creator_community', 'legacy_submit', 'legacy_accounts'].includes(key);
    const permissions = key === 'resource_audit' ? staffOnly : resourcePermissions(config.guildId, key.startsWith('legacy_') ? [legacy] : parent === hub ? hubReaders : readers, staff, bot.id, writable);
    await ensure(`channel_${key}`, name, 0, parent, permissions);
  }
  // Retire the duplicate without deleting its history or redirecting old IDs.
  r = resources(database);
  if (r.channel_script_library && r.channel_script_library !== r.channel_scripts) {
    const retired = channels.find(c => c.id === r.channel_script_library);
    if (retired) {
      await api(config, `/channels/${retired.id}`, { method: 'PATCH', body: JSON.stringify({ name: 'archived-script-library', parent_id: archive, permission_overwrites: archiveOnly }) });
      save(database, 'channel_archived_script_library', retired.id);
    }
  }
  save(database, 'channel_script_library', r.channel_scripts);
  const scriptPermissions = resourcePermissions(config.guildId, [r.role_scripts], staff, bot.id);
  for (const entry of scriptPermissions) {
    if (entry.type === 0 && staff.includes(entry.id)) entry.allow = (BigInt(entry.allow) | (1n << 17n)).toString();
  }
  await api(config, `/channels/${r.channel_scripts}`, { method: 'PATCH', body: JSON.stringify({ parent_id: hub, permission_overwrites: scriptPermissions }) });
  r = resources(database);
  await syncAccessTutorials({config,database,bot,api,resources,save});
  r = resources(database);
  const cards = guidanceCards(r);
  for(const body of Object.values(cards))for(const embed of body.embeds)embed.description=embed.description.replaceAll(TEST_RESOURCE_GUILD,config.guildId);
  if(!config.testMode)delete cards.resource_audit;
  for (const [key, body] of Object.entries(cards)) {
    const channelId = r[`channel_${key}`];
    const messageKey = key === 'app_access' ? 'message_app_access' : `message_resource_${key}`;
    let id = r[messageKey], existing;
    if (id) {
      try { existing = await api(config, `/channels/${channelId}/messages/${id}`); }
      catch (error) { if (error.status !== 404) throw error; }
    }
    if (!existing) {
      // Recover a successful send if the process died before saving its ID.
      const recent = await api(config, `/channels/${channelId}/messages?limit=100`);
      existing = recent.find(m => m.author?.id === bot.id && m.embeds?.[0]?.title === body.embeds[0].title);
      id = existing?.id;
    }
    if (existing) {
      await api(config, `/channels/${channelId}/messages/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
    } else {
      const sent = await api(config, `/channels/${channelId}/messages`, { method: 'POST', body: JSON.stringify(body) });
      id = sent.id;
    }
    save(database, messageKey, id);
    if (!existing?.pinned) await api(config, `/channels/${channelId}/pins/${id}`, { method: 'PUT' });
  }
  return resources(database);
}
