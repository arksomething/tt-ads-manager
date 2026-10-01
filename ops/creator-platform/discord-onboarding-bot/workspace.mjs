import {migrateOffboarding,createOffboarding} from './offboarding.mjs';
import {migrateDeals,createDeals,dealCard} from './deals.mjs';
import {createJotform,migrateJotform,isDefaultAgreement} from './jotform.mjs';
import {auditLog,auditDownload} from './audit.mjs';
import {migrateHubs,postsCard,paymentsCard,monthKey,requestEarnings,earningsBreakdown} from './hubs.mjs';
import { resolveVideo, resolvePublishedField, draftAttachment } from './media.mjs';
import { parseTimezone } from './timezone.mjs';
import {messageCopy,creatorSuccess,creatorDecision,accountCreationGuide} from "./messages.mjs";
import { createHash } from "node:crypto";
import { readFileSync } from 'node:fs';
import * as flow from "./flow.mjs";
import {migrateScripts,createScripts,firstPublication} from './scripts.mjs';

export function paymentCountry(c) {
  const names=new Intl.DisplayNames(['en'],{type:'region'});
  const parts=String(c.location||'').split(/[,/|]/u).map(s=>s.trim().toLowerCase());
  const aliases={usa:'US',uk:'GB','united states of america':'US'};
  for(const part of parts) {
    if(aliases[part])return names.of(aliases[part]);
    for(let a=65;a<=90;a++)for(let b=65;b<=90;b++) {
      const code=String.fromCharCode(a,b),name=names.of(code);
      if(name!==code&&(part===code.toLowerCase()||part===name.toLowerCase()))return name;
    }
  }
  try {
    const matches=readFileSync('/usr/share/zoneinfo/zone.tab','utf8').split('\n').filter(line=>!line.startsWith('#')).map(line=>line.split('\t')).filter(row=>row[2]===c.timezone);
    if(matches.length===1)return names.of(matches[0][0]);
  }catch{}
  return '';
}

const columns = {
  cohort:"TEXT NOT NULL DEFAULT 'new'",scripts_access:"INTEGER NOT NULL DEFAULT 1",workflow_roles_initialized:"INTEGER NOT NULL DEFAULT 0",current_script_id:"TEXT",submitted_script_id:"TEXT",draft_resume_stage:"TEXT",first_publication_source:"TEXT",
  payment_details:"TEXT", payment_updated_at:"TEXT", account_update_requested_at:"TEXT",
  warmup_approved_at:"TEXT", signature_evidence:"TEXT", first_video_url:"TEXT", first_video_note:"TEXT", first_video_approved_at:"TEXT",
  timezone:"TEXT", timezone_lookup_at:"TEXT", campaign_accounts:"TEXT", account_resume_stage:"TEXT", review_note:"TEXT", account_approved_at:"TEXT",
  account_approved_by:"TEXT", agreement_url:"TEXT", agreement_signed_at:"TEXT", agreement_source:"TEXT",
  trial_ends_at:"TEXT", trial_completed_at:"TEXT", risk_started_at:"TEXT", resume_stage:"TEXT",
  last_warning_at:"TEXT", notice_pending:"INTEGER NOT NULL DEFAULT 0", notice_requested_at:"TEXT",
  status_message_id:"TEXT", sync_pending:"INTEGER NOT NULL DEFAULT 1",
  discord_member_missing_at:"TEXT",
};
export function migrate(database) {
  const existing = new Set(database.prepare("PRAGMA table_info(creators)").all().map(c=>c.name));
  for (const [name,type] of Object.entries(columns)) if (!existing.has(name)) database.exec(`ALTER TABLE creators ADD COLUMN ${name} ${type}`);
  database.exec(`
    CREATE TABLE IF NOT EXISTS flow_events (id TEXT PRIMARY KEY, creator_id TEXT NOT NULL, actor_id TEXT NOT NULL, action TEXT NOT NULL, at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS creator_posts (video_key TEXT PRIMARY KEY, creator_id TEXT NOT NULL, url TEXT NOT NULL, submitted_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS deliveries (id TEXT PRIMARY KEY, channel_id TEXT NOT NULL, payload TEXT NOT NULL, message_id TEXT, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS staff_notes (id TEXT PRIMARY KEY, creator_id TEXT NOT NULL, actor_id TEXT NOT NULL, note TEXT NOT NULL, at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS additional_account_requests (id TEXT PRIMARY KEY,creator_id TEXT NOT NULL,links TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',created_at TEXT NOT NULL,reviewed_by TEXT);
  `);
  migrateHubs(database);
  migrateDeals(database);
  migrateJotform(database);
  migrateScripts(database);
  migrateOffboarding(database);
}
export function patchCreator(db, id, patch) {
  const keys = Object.keys(patch);
  if (!keys.length) return;
  db.prepare(`UPDATE creators SET ${keys.map(k=>`${k}=?`).join(",")} WHERE discord_user_id=?`).run(...keys.map(k=>patch[k]),id);
}
export function backfillFourPlatformAccounts(db,guildId,now=Date.now()) {
  if(guildId!==flow.TEST_GUILD_ID)throw new Error('Account backfill is restricted to the test server.');
  const at=new Date(now).toISOString(),updated=[];
  db.exec('BEGIN IMMEDIATE');
  try {
    for(const c of db.prepare('SELECT * FROM creators').all()) {
      patchCreator(db,c.discord_user_id,{sync_pending:1});
      if(['removed','removal_due'].includes(c.stage)||!flow.missingAccounts(c.campaign_accounts).length)continue;
      const event=`four-platform-accounts:v1:${c.discord_user_id}`;
      if(db.prepare('SELECT 1 FROM flow_events WHERE id=?').get(event))continue;
      patchCreator(db,c.discord_user_id,{stage:'warmup',account_resume_stage:['warmup','account_review'].includes(c.stage)?null:c.stage,account_update_requested_at:at,updated_at:at});
      db.prepare('INSERT INTO flow_events VALUES (?,?,?,?,?)').run(event,c.discord_user_id,'system','four_platform_accounts_required',at);
      const payload={...flow.card('Add your YouTube and Facebook accounts','Campaign accounts and cross-posting are now required on **TikTok, Instagram, YouTube and Facebook**.\n\nChoose **Add account links** on your status card. Your saved links are prefilled; add the missing accounts and submit all four for review. Your previous progress is saved and will resume after approval.\n\nGet drafts approved before publishing. No published links are required. Metrics are tracked only for TikTok and Instagram.\n\n[Open your status]({status_link})'),content:`<@${c.discord_user_id}>`,allowed_mentions:{parse:[],users:[c.discord_user_id]},approval_creator_id:c.discord_user_id};
      db.prepare('INSERT OR IGNORE INTO deliveries (id,channel_id,payload,created_at) VALUES (?,?,?,?)').run(event,c.channel_id,JSON.stringify(payload),at);
      updated.push(c.discord_user_id);
    }
    db.exec('COMMIT');return updated;
  }catch(e){db.exec('ROLLBACK');throw e;}
}
export function privateOverwrites(config, resources, userId) {
  const allow = String((1n<<10n)|(1n<<11n)|(1n<<14n)|(1n<<15n)|(1n<<16n));
  const entries = [
    {id:config.guildId,type:0,allow:"0",deny:String(1n<<10n)},
    ...[userId,config.applicationId,config.ownerId].map(id=>({id,type:1,allow,deny:"0"})),
    {id:resources.role_staff,type:0,allow,deny:"0"},
    ...(resources.role_admin?[{id:resources.role_admin,type:0,allow,deny:'0'}]:[]),
  ];
  return [...new Map(entries.map(e=>[`${e.type}:${e.id}`,e])).values()];
}
export function isStaff(interaction, config, resources) {
  const user = interaction.member?.user?.id ?? interaction.user?.id;
  return user === config.ownerId || (interaction.member?.roles ?? []).some(id=>[resources.role_staff,resources.role_admin].includes(id)) ||
    (BigInt(interaction.member?.permissions ?? "0") & (1n<<3n)) !== 0n;
}
export function approveLeave(c, days, reason, now=Date.now()) {
  if (!["trial","active","at_risk"].includes(c.stage)) throw new Error("Leave applies during the trial or active posting.");
  if (!Number.isInteger(days) || days<1 || days>30 || !reason) throw new Error("Enter 1–30 days and a reason.");
  const until = now+days*flow.DAY;
  // Shift the risk deadline by the entire paused interval, including pending notice.
  const pauseStart = Math.min(now, Date.parse(c.notice_requested_at || new Date(now).toISOString()));
  const priorEnd = Math.max(pauseStart, Date.parse(c.exception_until || new Date(pauseStart).toISOString()));
  const effectiveEnd = Math.max(until,priorEnd);
  return { exception_until:new Date(effectiveEnd).toISOString(), exception_reason:reason, notice_pending:0,
    notice_requested_at:null, ...(c.risk_started_at?{risk_started_at:new Date(Date.parse(c.risk_started_at)+Math.max(0,effectiveEnd-priorEnd)).toISOString()}:{}),
    updated_at:new Date(now).toISOString() };
}
export function createWorkspace(config, db, io) {
  const {api, resourceMap, setResource, callback, editReply, input, saveUpload} = io;
  const creator = id=>db.prepare("SELECT * FROM creators WHERE discord_user_id=?").get(id);
  const actor = i=>i.member?.user?.id ?? i.user?.id ?? "";
  const staff = i=>isStaff(i,config,resourceMap(db));
  const reply = (i,data)=>editReply(config,i,typeof data==='string'?{content:data,embeds:[],components:[],allowed_mentions:{parse:[]}}:data);
  const requireStaff = i=>{if(!staff(i)) throw new Error("These controls are for GoTall staff.");};
  const current = i=>{
    const target=i.data?.custom_id?.match(/^gt:(?:form:)?review:(\d+):/u)?.[1];
    if(target) {
      requireStaff(i);
      const r=resourceMap(db);
      if(![r.channel_staff_reviews,r.channel_video_reviews].filter(Boolean).includes(i.channel_id))throw new Error('Use these controls in the staff review channel.');
    }
    const c=target?creator(target):db.prepare("SELECT * FROM creators WHERE channel_id=?").get(i.channel_id);
    if(!c) throw new Error("Open your private creator channel first.");
    if(c.discord_user_id!==actor(i) && !staff(i)) throw new Error("This is another creator’s workspace.");
    return c;
  };
  const values = flow.modalValues;
  const modal = (i,id,title,fields)=>{
    const target=i.data?.custom_id?.match(/^gt:review:(\d+):/u)?.[1];
    return callback(config,i,{type:9,data:{custom_id:`gt:form:${target?`review:${target}:`:''}${id}`,title,components:fields}});
  };
  const enqueue = (id,channel,payload)=>db.prepare("INSERT OR IGNORE INTO deliveries (id,channel_id,payload,created_at) VALUES (?,?,?,?)").run(id,channel,JSON.stringify(payload),new Date().toISOString());
  const offboarding=createOffboarding(db,config,{api,resourceMap,setResource,enqueue,patch:(id,p)=>patchCreator(db,id,p),staff,reply});
  const offboardSupport=action=>/^(payments(?::|$)|posts(?::|$)|audit_log:|audit_pdf:|earnings_details:|payment_profile$|my_deal$|pay_(wise|paypal|bank)$|hub_issue:|hub_resolve:|resume$)/.test(action||'');
  const scripts=createScripts(db,config,{api,resourceMap:()=>resourceMap(db),enqueue,patch:(id,p)=>patchCreator(db,id,p)});
  const transact = (i,c,action,patch,extra=()=>{})=>{
    db.exec("BEGIN IMMEDIATE");
    try {
      if(db.prepare("SELECT 1 FROM flow_events WHERE id=?").get(i.id)){db.exec("ROLLBACK");return false;}
      extra();
      patchCreator(db,c.discord_user_id,{...patch,sync_pending:1});
      db.prepare("INSERT INTO flow_events VALUES (?,?,?,?,?)").run(i.id,c.discord_user_id,actor(i),action,new Date().toISOString());
      db.exec("COMMIT");return true;
    } catch(e){db.exec("ROLLBACK");throw e;}
  };
  const deals=createDeals(db,{guildId:config.guildId,testMode:config.testMode,staff,reply,enqueue,deliver,modal:(i,payload)=>callback(config,i,payload)});
  const jotform=createJotform(db,{apiKey:config.jotformApiKey,request:io.jotformFetch,reprocessComplete:true,onIncomplete:(c,receipt)=>{
    if(offboarding.active(c))return;
    const checks=receipt.checks,problems=[];
    if(!checks.creatorName)problems.push('Your full name is missing or incomplete.');
    if(!checks.creatorSignature)problems.push('Your signature is missing or invalid.');
    if(!checks.creatorDate)problems.push('Your signing date is missing or invalid.');
    if(!checks.guardianSectionConsistent)problems.push('The optional parent/guardian section is partially filled in. If no guardian is required, clear the entire section, including its date. If a guardian is required, complete their name, signature and date.');
    if(!checks.active)problems.push('This submission is no longer active.');
    const key=createHash('sha256').update(JSON.stringify(checks)).digest('hex').slice(0,16);
    enqueue(`jotform-incomplete:${receipt.id}:${key}`,c.channel_id,{
      ...flow.card('Agreement needs attention',`We received your agreement, but could not open the next step:\n\n${problems.map(p=>`- ${p}`).join('\n')}\n\nCorrect your submission if Jotform lets you edit it. Otherwise, ask the team here to help resolve it.\n\n[Open your status]({status_link})`),
      content:`<@${c.discord_user_id}>`,allowed_mentions:{parse:[],users:[c.discord_user_id]},approval_creator_id:c.discord_user_id,
    });
  },onReceipt:(c,receipt,now)=>{
    if(offboarding.active(c))return;
    const event=`jotform-auto:${receipt.id}`;
    if(db.prepare('SELECT 1 FROM flow_events WHERE id=?').get(event))return;
    if(!c.account_approved_at||!c.warmup_approved_at)throw new Error('Account and warm-up approval are required before automatic signing progression.');
    const reviews=resourceMap(db).channel_staff_reviews;
    if(!reviews)throw new Error('Signing notification channel is not configured.');
    const at=new Date(now).toISOString();
    patchCreator(db,c.discord_user_id,{stage:'first_video',agreement_signed_at:at,agreement_source:'jotform_api',signature_evidence:`Jotform ${receipt.id}; linked submission with complete signature fields; automatically advanced`,sync_pending:1,updated_at:at});
    db.prepare('INSERT INTO flow_events VALUES (?,?,?,?,?)').run(event,c.discord_user_id,'jotform','agreement_signed',at);
    db.prepare("UPDATE deliveries SET message_id='superseded-by-auto-signing' WHERE id=? AND message_id IS NULL").run(`jotform-received:${receipt.id}`);
    db.prepare("UPDATE deliveries SET message_id='superseded-by-auto-signing' WHERE id LIKE ? AND message_id IS NULL").run(`jotform-incomplete:${receipt.id}:%`);
    enqueue(`jotform-signed:${receipt.id}`,c.channel_id,{
      ...flow.card('🎥 You’re ready for your first video!','Your signed agreement was received from Jotform. First-video preparation is now open. Choose your format with the team and submit your draft for review before posting.\n\n[Open your next step]({status_link}).'),
      content:`<@${c.discord_user_id}>`,allowed_mentions:{parse:[],users:[c.discord_user_id]},approval_creator_id:c.discord_user_id,
    });
    enqueue(`jotform-signed-manager:${receipt.id}`,reviews,{
      ...flow.card('📄 Creator agreement signed',`${flow.markdown(c.name)} signed their linked Jotform agreement and automatically moved to first-video preparation. No signature approval action is needed.\n\n[Open Jotform submission](https://www.jotform.com/submission/${receipt.id})\n[Open creator status]({status_link})`),
      signing_notice:true,approval_creator_id:c.discord_user_id,
    });
  }});
  function signingCreator(c) {
    const r=jotform.receipt(c.discord_user_id);
    const script=c.submitted_script_id?db.prepare('SELECT channel_id FROM scripts WHERE id=?').get(c.submitted_script_id):null;
    return {...c,...(r?{jotform_receipt:r}:{}),...(script?{submitted_script_url:`https://discord.com/channels/${config.guildId}/${script.channel_id}/${c.submitted_script_id}`}:{})};
  }
  async function deliver() {
    deals.settle();
    for(const item of db.prepare("SELECT * FROM deliveries WHERE message_id IS NULL ORDER BY created_at LIMIT 30").all()) {
      const nonce=createHash('sha256').update(item.id).digest('hex').slice(0,24);
      const payload=JSON.parse(item.payload);
      const closed=offboarding.active(db.prepare('SELECT * FROM creators WHERE channel_id=?').get(item.channel_id));
      if(closed&&!payload.offboarding_case_id&&!/^(hub-resolution:|deal-|payment-|earnings-)/.test(item.id)) {
        db.prepare("UPDATE deliveries SET message_id='superseded-by-offboarding' WHERE id=?").run(item.id);continue;
      }
      const offboardingCaseId=payload.offboarding_case_id;delete payload.offboarding_case_id;
      if(payload.signing_notice) {
        const reviewer=resourceMap(db).role_staff;
        if(!reviewer)continue;
        payload.content=`<@&${reviewer}>`;
        payload.allowed_mentions={parse:[],roles:[reviewer]};
        delete payload.signing_notice;
      }
      if(payload.review_creator_id) {
        const review=creator(payload.review_creator_id), reviewer=resourceMap(db).role_staff;
        const expected=payload.review_stage||'warmup_review';
        if(!review||(expected==='first_video_review'&&review.cohort==='legacy')||(expected!=='post'&&(expected==='leave'?!review.notice_pending:review.stage!==expected))) {
          db.prepare('UPDATE deliveries SET message_id=? WHERE id=?').run('resolved-before-notification',item.id);continue;
        }
        if(!reviewer||!review?.status_message_id||review.sync_pending)continue;
        payload.content=`<@&${reviewer}>`;
        payload.allowed_mentions={parse:[],roles:[reviewer]};
        const controls=flow.staffCard(signingCreator(review),config.testMode);
        payload.components=controls.components.map(row=>({...row,components:row.components.map(button=>({...button,custom_id:button.custom_id.replace('gt:',`gt:review:${review.discord_user_id}:`)}))}));
        if(expected==='post')payload.components=[];
        payload.embeds[0].fields=controls.embeds[0].fields;
        payload.embeds[0].description=payload.embeds[0].description.replace(', then choose **Staff controls**.', '. Review and take action below.');
        payload.embeds[0].description=payload.embeds[0].description.replace('{status_link}',`https://discord.com/channels/${config.guildId}/${review.channel_id}/${review.status_message_id}`);
        delete payload.review_creator_id;
        delete payload.review_stage;
      }
      if(payload.approval_creator_id) {
        const approved=creator(payload.approval_creator_id);
        // Wait for the current status card to be saved, including retry recovery.
        if(!approved?.status_message_id||approved.sync_pending)continue;
        payload.embeds[0].description=payload.embeds[0].description.replace('{status_link}',`https://discord.com/channels/${config.guildId}/${approved.channel_id}/${approved.status_message_id}`);
        delete payload.approval_creator_id;
      }
      // Search the persistent marker before retrying an ambiguous POST, even after Discord's nonce window.
      const recent=await api(config,`/channels/${item.channel_id}/messages?limit=100`);
      let message=recent.find(m=>m.author?.id===config.applicationId && m.embeds?.some(e=>e.footer?.text===`GoTall · ${nonce}` || (Date.parse(e.timestamp)===Date.parse(item.created_at) && e.title===payload.embeds?.[0]?.title && e.footer?.text==='GoTall creators')));
      if(!message) {
        payload.embeds=(payload.embeds?.length?payload.embeds:[{description:payload.content||"An update from the team"}]).map(e=>({...e,timestamp:item.created_at,footer:{text:'GoTall creators'}}));
        message=await api(config,`/channels/${item.channel_id}/messages`,{method:'POST',body:JSON.stringify({...payload,nonce,enforce_nonce:true})});
      }
      db.prepare("UPDATE deliveries SET message_id=? WHERE id=?").run(message.id,item.id);
      if(offboardingCaseId)offboarding.delivered(offboardingCaseId,message);
    }
  }
  async function sync(c) {
    if(offboarding.active(c))return offboarding.sync(c);
    c=await scripts.reconcile(c);
    if(jotform.enabled&&['agreement','agreement_review'].includes(c.stage)&&isDefaultAgreement(c.agreement_url)) {
      const url=jotform.issue(c,c.agreement_url);
      if(url!==c.agreement_url){patchCreator(db,c.discord_user_id,{agreement_url:url});c=creator(c.discord_user_id);}
    }
    if(!c.timezone && !c.timezone_lookup_at) {
      let timezone=null;
      try { timezone=await parseTimezone(c.location,io.timezoneOptions); } catch {}
      patchCreator(db,c.discord_user_id,{timezone,timezone_lookup_at:new Date().toISOString()});
      c=creator(c.discord_user_id);
    }
    if(c.first_video_approved_at&&c.campaign_accounts) {
      const accounts=c.campaign_accounts.split('\n').filter(link=>['tiktok','instagram'].includes(flow.accountPlatform(link))).map(link=>{const u=new URL(link);return {platform:flow.accountPlatform(link),handle:u.pathname.replace(/^\/@?/u,'').replace(/\/$/u,'').toLowerCase()};});
      db.prepare(`INSERT INTO creator_hub_sources (creator_id,accounts_json) VALUES (?,?) ON CONFLICT(creator_id) DO UPDATE SET accounts_json=excluded.accounts_json WHERE creator_hub_sources.preview_label IS NULL`).run(c.discord_user_id,JSON.stringify(accounts));
    }
    const r=resourceMap(db), lifecycle=c.draft_resume_stage||c.stage,live=['trial','active'].includes(lifecycle), risk=lifecycle==='at_risk', done=['removed','removal_due'].includes(c.stage);
    const hasPublished=Boolean(db.prepare('SELECT 1 FROM creator_posts WHERE creator_id=? LIMIT 1').get(c.discord_user_id));
    const payload=flow.statusCard(scripts.decorate({...c,has_published:hasPublished}),config.testMode,{...r,ownerId:r.user_technical_contact||config.ownerId});
    for(const embed of payload.embeds||[]) {
      if(embed.description)embed.description=embed.description.replaceAll(flow.TEST_GUILD_ID,config.guildId);
      for(const field of embed.fields||[])field.value=field.value.replaceAll(flow.TEST_GUILD_ID,config.guildId);
    }
    let messageId=c.status_message_id;
    if(messageId) {
      try {await api(config,`/channels/${c.channel_id}/messages/${messageId}`,{method:'PATCH',body:JSON.stringify(payload)});}
      catch(e){if(e.status!==404) throw e;messageId=null;}
    }
    if(!messageId) {
      const recent=await api(config,`/channels/${c.channel_id}/messages?limit=100`);
      const prior=recent.find(m=>m.author?.id===config.applicationId && m.embeds?.some(e=>['Your channel. Your progress. Your team.','GoTall creators','Test server · No real signatures, payments or removals'].includes(e.footer?.text)) && m.components?.some(r=>r.components?.some(b=>b.custom_id==='gt:staff')));
      const message=prior??await api(config,`/channels/${c.channel_id}/messages`,{method:'POST',body:JSON.stringify({...payload,nonce:`ws${c.discord_user_id}`,enforce_nonce:true})});
      messageId=message.id;
      if(prior) await api(config,`/channels/${c.channel_id}/messages/${messageId}`,{method:'PATCH',body:JSON.stringify(payload)});
    }
    patchCreator(db,c.discord_user_id,{status_message_id:messageId,welcome_sent_at:c.welcome_sent_at||new Date().toISOString()});
    // Legacy channel membership, categories and cosmetic roles are not new-deal lifecycle state.
    if(c.cohort==='legacy') {
      const current=await api(config,`/channels/${c.channel_id}/messages/${messageId}`);
      if(!current.pinned)await api(config,`/channels/${c.channel_id}/pins/${messageId}`,{method:'PUT'});
      patchCreator(db,c.discord_user_id,{sync_pending:0});return;
    }
    // Payment hub messages are snapshots. Refresh/open actions render current data.
    const channel=await api(config,`/channels/${c.channel_id}`);
    const accounts=String(c.campaign_accounts||'').split('\n');
    const handleLink=accounts.find(link=>/^https:\/\/www\.tiktok\.com\//u.test(link))||accounts.find(link=>/^https:\/\/www\.instagram\.com\//u.test(link));
    const handle=handleLink?new URL(handleLink).pathname.replace(/^\/@?/u,'').replace(/\/$/u,''):'';
    const name=`${risk?'🟠':done?'⚫':live?'🟢':'🟡'}-${flow.sanitizeChannelName(c.name)}${handle?`-${handle.replace(/[@.]/gu,'')}`:''}`.slice(0,100);
    const parent=r[risk?'category_at_risk':done?'category_inactive':live?'category_active':'category_onboarding'];
    await api(config,`/channels/${c.channel_id}`,{method:'PATCH',body:JSON.stringify({
      // Discord separately limits renames; do not send unchanged name/category fields.
      ...(channel.name===name?{}:{name}),
      ...(channel.parent_id===parent?{}:{parent_id:parent}),
      permission_overwrites:privateOverwrites(config,r,c.discord_user_id),
    })});
    const currentCard=await api(config,`/channels/${c.channel_id}/messages/${messageId}`);
    if(!currentCard.pinned) {
      try {await api(config,`/channels/${c.channel_id}/messages/pins/${messageId}`,{method:'PUT'});}
      catch(e){if(e.status!==403)throw e;console.error('Status card pin requires Pin Messages permission',c.channel_id);}
    }
    for(const [role,on] of [[r.role_onboarding,!live&&!risk&&!done],[r.role_active,live],[r.role_at_risk,risk]]) {
      await api(config,`/guilds/${config.guildId}/members/${c.discord_user_id}/roles/${role}`,{method:on?'PUT':'DELETE'});
    }
    if(r.role_newcomer)await api(config,`/guilds/${config.guildId}/members/${c.discord_user_id}/roles/${r.role_newcomer}`,{method:'DELETE'});
    if(r.role_hub_access)await api(config,`/guilds/${config.guildId}/members/${c.discord_user_id}/roles/${r.role_hub_access}`,{method:['first_video','first_video_review','hub_ready','trial','active','at_risk'].includes(lifecycle)?'PUT':'DELETE'});
    // Topics have a separate restrictive edit limit. Keep identity stable and put
    // the changing stage only in the status card; legacy-topic cleanup must not
    // block roles, Hub access or workflow receipts when Discord rate limits it.
    const topic=`GoTall creator • user ${c.discord_user_id}`;
    if(channel.topic!==topic) {
      try { await api(config,`/channels/${c.channel_id}`,{method:'PATCH',body:JSON.stringify({topic})}); }
      catch(e) { if(e.status!==429) throw e; }
    }
    patchCreator(db,c.discord_user_id,{sync_pending:0});
    const pendingReview={
      account_review:['🔎 Accounts ready for review','submitted their account details. Please review the profiles and approve them or request changes.'],
      warmup_review:['🔎 Warm-up ready for review','marked their warm-up complete. Please review their account/setup and approve warm-up or request changes.'],
      agreement_review:['📄 Signing confirmation ready for review','reported signing their agreement. Verify the submitted agreement before approving the next step.'],
      first_video_review:['🎥 Video ready for review',`submitted a video draft. Please review it and approve or request revisions.${c.first_video_url?`\n\n[Open submitted draft](<${c.first_video_url}>)`:''}`],
    }[c.stage];
    const reviewChannel=c.stage==='first_video_review'?r.channel_video_reviews:r.channel_staff_reviews;
    if(c.cohort!=='legacy'&&pendingReview&&reviewChannel&&!(c.stage==='agreement_review'&&jotform.enabled&&isDefaultAgreement(c.agreement_url)))enqueue(`${c.stage==='warmup_review'?'warmup-review':'staff-review:'+c.stage}:${c.discord_user_id}:${c.updated_at}`,reviewChannel,{
      ...flow.card(pendingReview[0],`${flow.markdown(c.name)} has ${pendingReview[1]}\n\n[Open the creator’s status card]({status_link}), then choose **Staff controls**.`),
      review_creator_id:c.discord_user_id,review_stage:c.stage,
    });
    if(c.notice_pending&&r.channel_staff_reviews)enqueue(`leave-review:${c.discord_user_id}:${c.notice_requested_at}`,r.channel_staff_reviews,{
      ...flow.card('📅 Time-off request needs review',`${flow.markdown(c.name)} requested time off.\n\n${flow.markdown(c.exception_reason||'',500)}\n\n[Open the creator’s status card]({status_link}) and choose **Staff controls** to review the request.`),
      review_creator_id:c.discord_user_id,review_stage:'leave',
    });
  }

  async function refresh(i,c) {
    try { await sync(creator(c.discord_user_id)); await deliver(); }
    catch { return reply(i,"Your action was saved. Discord could not finish updating the card, channel or roles. You don’t need to submit again; we’ll retry automatically. Check the current status card in this channel for the latest step."); }
    const updated=creator(c.discord_user_id);
    const action=i.data?.custom_id?.replace(/^gt:(?:form:)?(?:review:\d+:)?/u,'');
    if(action==='first_posted')return reply(i,{
      ...flow.card('Set up your payment details',`Your first post is confirmed. Add your payment details so the team has what it needs to arrange your payments.\n\nYou will receive video ideas every day in <#${resourceMap(db).channel_scripts}>. When a new idea arrives in the scripts channel, film your draft and submit it here in your creator channel using your status card. Wait for the team's approval before publishing.`),
      content:'',allowed_mentions:{parse:[]},
      components:[flow.row(flow.button('payments','Payment details',1))],
    });
    const receipt={complete_warmup:'Warm-up sent for staff review.',approve_warmup:'Warm-up approved and contract sent. The creator has been notified to review and sign.',signed:'Signing confirmation sent. Staff must verify the Jotform submission.',confirm_signature:'Signature verification recorded. First-video preparation is open.',first_video:'Draft received. Wait for staff approval before posting.',approve_first_video:'Draft approved. The creator can publish it.',open_hub:'Creator Hub opened. The trial starts with first publication.',revise_first_video:'Video changes requested.',accounts:'Your accounts have been submitted for review. We’ll notify you when the team has reviewed them.',ready:'Accounts sent for review. Wait for the team’s decision here.',post:'Published links recorded. Thanks for sharing your posts.',leave:'Time-off request sent. Missed-day checks are paused while staff review your dates.',exception:`Time off approved until ${updated.exception_until?`<t:${Math.floor(Date.parse(updated.exception_until)/1000)}:F>`:''}. The approved period starts now.`,approve_account:'Accounts approved. The creator should complete warm-up and request review.',send_agreement:'Agreement step opened. Staff verify signing before first-video preparation.',test_signed:'Test signature recorded. First-video preparation is open; no real agreement was signed.',pass_trial:'Trial approved. The creator can continue posting as an active creator.',extend_trial:'Trial extended by three days. The new review date is on the status card.',changes:'Changes requested. The creator can edit their accounts and resubmit.',agreement_link:'Signing link saved. Choose Send agreement to make it available to the creator.',deny_leave:'Time-off request declined. Your reason was sent to the creator.',reopen:'Onboarding reopened at account setup. The creator needs a new account review and agreement.'}[action] || 'Saved. Your current step is on the status card.';
    const link=updated.status_message_id?`https://discord.com/channels/${config.guildId}/${updated.channel_id}/${updated.status_message_id}`:null;
    const detail=action==='first_video'&&updated.first_video_url?`\n\n[Review submitted draft](<${updated.first_video_url}>)`:action==='post'?`\n\n${db.prepare('SELECT url FROM creator_posts WHERE creator_id=? ORDER BY submitted_at DESC LIMIT 1').get(c.discord_user_id)?.url||''}`:'';
    const signingStatus=action==='signed'&&jotform.enabled&&isDefaultAgreement(updated.agreement_url)
      ? (updated.agreement_signed_at?'Your signed agreement was received. First-video preparation is open.':'Your signature has not been confirmed yet. Complete your personal Review & sign form; we will check again automatically.') : null;
    await reply(i,(signingStatus||creatorSuccess(action,updated)||receipt)+detail+(link?`\n\n[Open current status and next action](${link})`:''));
    if(action==='post') {
      enqueue(`payment-setup:${c.discord_user_id}`,c.channel_id,paymentsCard(db,updated,resourceMap(db)));
      await deliver();
    }
  }
  async function publishStart() {
    const r=resourceMap(db), payload=flow.startCard();
    if(r.message_start_here) {
      try{return await api(config,`/channels/${r.channel_start_here}/messages/${r.message_start_here}`,{method:'PATCH',body:JSON.stringify(payload)});}
      catch(e){if(e.status!==404)throw e;}
    }
    const m=await api(config,`/channels/${r.channel_start_here}/messages`,{method:'POST',body:JSON.stringify({...payload,nonce:'gotall-start-v2',enforce_nonce:true})});
    setResource(db,'message_start_here',m.id);
  }
  async function openModal(i,action) {
    if(action.startsWith('deal:'))return deals.open(i);
    if(action==='test_clock')throw new Error('Date previews are available through the staff-only /creator preview command.');
    const c=await scripts.reconcile(current(i));
    if(offboarding.active(c)&&!offboardSupport(action))throw Error('This creator is offboarded. Payment support remains available; new work is closed.');
    if(action==='add_accounts') {
      if(['removed','removal_due'].includes(c.stage))throw Error('Account additions are unavailable after leaving the program.');
      if(c.discord_user_id!==actor(i))throw Error('Only this creator can add accounts.');
      if(!c.first_video_approved_at&&c.cohort!=='legacy')throw Error('Finish account setup first.');
      return modal(i,action,'Add more accounts',[input('accounts','New profile links','One TikTok, Instagram, YouTube or Facebook profile per line',1000,2,true,'Existing accounts stay unchanged. The team will review these additions.')]);
    }
    if(action==='reopen'&&(c.cohort==='legacy'||db.prepare('SELECT 1 FROM legacy_participants WHERE creator_id=?').get(c.discord_user_id)))throw Error('Existing creators keep their original arrangement and cannot restart new-deal onboarding.');
    if(c.cohort==='legacy'&&['approve_first_video','revise_first_video'].includes(action))throw Error('Legacy creators do not need draft approval.');
    if(action.startsWith('manual_next:')) {
      requireStaff(i);
      const expected=action.split(':')[1],next=c.stage==='at_risk'&&c.resume_stage==='trial'?'trial':flow.MANUAL_NEXT[c.stage];
      if(c.stage!==expected||!next)throw Error('Refresh Staff controls before advancing.');
      return modal(i,action,'Manually advance creator',[
        input('reason','Reason and evidence reference','Explain the problem and what you checked.',500,2,true,'Internal audit note. For signing, record the actual submission reference and checks.'),
        input('confirm',`Type ${next} to confirm`,next,40,1,true,`Current: ${c.stage}. This bypasses the normal step checks.`)
      ]);
    }
    const staffActions=['changes','agreement_link','exception','deny_leave','test_clock','confirm_signature','revise_first_video'];
    if(staffActions.includes(action)||action.startsWith('hub_resolve:'))requireStaff(i);
    else if(c.discord_user_id!==actor(i)) throw new Error("Creator forms must be submitted by the creator.");
    if(action.startsWith('hub_issue:')) {
      const [,kind,month]=action.split(':');
      if(!['posts','payments'].includes(kind))throw Error('Unknown report type.');
      monthKey(month,c);
      return modal(i,action,kind==='posts'?'Report a post problem':'Report a payment problem',[
        input('details','What should the team check?','Describe the issue; include any relevant post links.',1000,2,true,'Include missing or corrected links, or explain the payment issue. Do not include bank details.')
      ]);
    }
    if(action.startsWith('hub_resolve:')) {
      const id=action.slice('hub_resolve:'.length);
      const issue=db.prepare('SELECT * FROM creator_hub_issues WHERE id=? AND creator_id=?').get(id,c.discord_user_id);
      if(!issue||issue.resolved_at)throw Error('This report is no longer open.');
      return modal(i,action,'Resolve creator report',[input('resolution','Resolution and next steps','Explain what was corrected or what the creator should do.',1000,2,true,'This response will be sent to the creator.')]);
    }
    const forms={
      first_video:[c.draft_resume_stage?'Submit draft':'Submit first video draft',[input('url','Draft link (or upload below)','https://...',500,1,false,'Provide a link OR upload one video. Staff must approve before publication.'),{type:18,label:'Upload video (optional)',description:'MP4, MOV, WebM or M4V; up to 25 MB and your Discord upload limit.',component:{type:19,custom_id:'video_file',min_values:0,max_values:1,required:false}}]],
      confirm_signature:['Verify completed agreement',[input('reason','Submission reference and checks','Jotform submission ID; guardian checked if needed',500,2,true,'Verify the actual completed agreement before recording this. A chat confirmation is not proof.')]],
      revise_first_video:['Request video changes',[input('reason','Changes needed before approval','Explain the changes to make.',500,2)]],
      accounts:['Submit accounts for review',[
        input('instagram','Instagram','@yourname or instagram.com/yourname',200,1,true,'Your Instagram handle or profile link.'),
        input('tiktok','TikTok','@yourname or tiktok.com/@yourname',200,1,true,'Your TikTok handle or profile link.'),
        input('youtube','YouTube','@yourname or youtube.com/@yourname',200,1,true,'Your YouTube channel handle or link.'),
        input('facebook','Facebook','facebook.com/yourpage',200,1,true,'Your Facebook profile or Page link.'),
        ...(!c.timezone?[input('timezone','Posting timezone','Manila, America/New_York or GMT+8',100,1,true,'Sets your posting day. Enter your city, timezone or UTC offset.')]:[])
      ]],
      post:['Submit your published links',[
        input('tiktok_url','TikTok post link','https://www.tiktok.com/@name/video/...',500,1,true,'Paste the published video link or TikTok share link.'),
        input('instagram_url','Instagram post link','https://www.instagram.com/reel/...',500,1,true,'Paste the Instagram reel or post link for the same video.'),
        input('youtube_url','YouTube post link','https://www.youtube.com/shorts/...',500,1,true,'Paste the YouTube video or Shorts link for the same video.'),
        input('facebook_url','Facebook post link','https://www.facebook.com/reel/...',500,1,true,'Paste the Facebook reel, video or share link for the same video.')
      ]],
      leave:['Request time off',[input('reason','Dates, return date and reason','Away Sep 8–9; back Sep 10. Family trip.',500,2,true,'Submitting pauses checks while staff review. Staff confirm the approved expiry separately.')]],
      changes:['Request account changes',[input('reason','What needs to change?','Give the creator clear next steps.',500,2)]],
      agreement_link:['Agreement signing link',[input('url','Creator-specific https signing link','https://...',500)]],
      exception:['Approve time off from now',[input('days','Days from now (1–30)','2',2,1,true,'Starts when you submit. Dates in the creator’s message are not applied automatically.'),input('reason','Reason for approval','Approved time away',500,2,true,'Explain the approved period. An existing later expiry will not be shortened.')]],
      deny_leave:['Decline time off',[input('reason','Reason and next steps','Explain the decision to the creator.',500,2)]],
      test_clock:['Preview future dates',[input('days','Days ahead (0–30)','7',2)]],
    };
    if(['pay_wise','pay_paypal','pay_bank'].includes(action)) {
      const method=action.slice(4),saved=JSON.parse(c.payment_details||'{}');
      const fields=[input('recipient',method!=='paypal'?'Account-holder name':'Account-holder name (optional)','Name on your receiving account',100,1,method!=='paypal'),input('country','Receiving country','Your receiving country',80),input('currency','Receiving currency','USD',3)];
      fields[1].component.value=saved.country||paymentCountry(c);
      fields[2].component.value=saved.currency||'USD';
      if(method==='bank')fields.push(input('bank','Bank name','Your bank',100),input('destination','US bank receiving details','Account number, 9-digit ACH routing number, checking or savings',1000,2,true,'US bank accounts only. For international bank transfers, choose Wise.'));
      else fields.push(input('destination',method==='paypal'?'PayPal email':'International bank details or Wise ID',method==='paypal'?'you@example.com':'Bank name, account/IBAN, routing/SWIFT; or Wise email/Wisetag',1000,2,true,method==='paypal'?'Email linked to the receiving PayPal account.':'Include local receiving details and required recipient address, or your Wise email/Wisetag.'));
      for(const field of fields)if(saved[field.component.custom_id]&&(saved.method===method||field.component.custom_id!=='destination'))field.component.value=saved[field.component.custom_id];
      forms[action]=[`${method==='paypal'?'PayPal':method==='wise'?'Wise':'Bank transfer'} payment details`,fields];
    }
    if(!forms[action])return false;
    if(action==='post')throw Error('Published links are no longer required. After your first approved video is live, use First video posted on your status card.');
    if(action==='first_video'&&c.cohort==='legacy')throw Error('Legacy creators do not need draft approval. Your existing deal is unchanged.');
    if(action==='accounts'&&!['warmup','account_review'].includes(c.stage))throw new Error('Account answers can be edited during setup or account review.');
    if(action==='accounts') {
      if(c.stage==='account_review')forms.accounts[0]='Edit account answers';
      for(const field of forms.accounts[1]) {
        const platform=field.component?.custom_id;
        if(!flow.REQUIRED_PLATFORMS.includes(platform))continue;
        const saved=String(c.campaign_accounts||'').split('\n').find(link=>{
          try {return new URL(link).hostname.replace(/^www\./u,'')===`${platform}.com`;} catch {return false;}
        });
        if(saved)field.component.value=saved;
      }
    }
    if(action==='post'&&!['hub_ready','trial','active','at_risk'].includes(c.stage))throw new Error('You can submit published links once staff approve your first video.');
    if(action==='leave'&&!['trial','active','at_risk'].includes(c.stage))throw new Error('Time-off requests open when your trial starts.');
    if(action==='first_video'&&c.stage!=='first_video')throw new Error('Draft submission is available after signature verification.');
    if(action==='test_clock'&&!config.testMode)throw new Error('Date previews are unavailable.');
    await modal(i,action,...forms[action]);return true;
  }
  async function handle(i) {
    if(i.data?.custom_id?.startsWith('gt:offboard_confirm:')) {
      const result=await offboarding.confirm(i,i.data.custom_id.slice('gt:offboard_confirm:'.length));await deliver();return result;
    }
    if(/^gt:(?:form:)?deal:/u.test(i.data?.custom_id||''))return deals.handle(i);
    const action=i.data?.custom_id?.replace(/^gt:(?:form:)?(?:review:\d+:)?/u,'')?.replace(/^source_(posts|payments):/u,'$1:');
    if(action==='end_trial')throw Error('Use /creator offboard with a reason and next payout date to end participation and preserve final-payment support.');
    if(action!=='resume') {const selected=current(i);if(offboarding.active(selected)&&!offboardSupport(action))return reply(i,offboarding.status(offboarding.active(selected)));}
    if(i.data?.custom_id?.startsWith('gt:source_')) {
      const c=current(i),parts=action.split(':'),source=parts[parts.length-1];
      if(!['viral','tracker','submitted'].includes(source))throw Error('Unknown metrics source.');
      if(c.discord_user_id===actor(i))db.prepare('UPDATE creator_hub_sources SET preferred=? WHERE creator_id=?').run(source,c.discord_user_id);
    }
    if(action==='payments'||action.startsWith('payments:')){const c=current(i);requestEarnings(db,c,action.split(':')[1]);return reply(i,paymentsCard(db,c,resourceMap(db),action.split(':')[1],action.split(':')[2]));}
    if(action.startsWith('audit_log:'))return reply(i,auditLog(db,current(i),action.split(':')[1],action.split(':')[2]));
    if(action.startsWith('audit_pdf:'))return reply(i,auditDownload(db,current(i),action.split(':')[1]));
    if(action.startsWith('earnings_details:'))return reply(i,earningsBreakdown(db,current(i),action.split(':')[1],Number(action.split(':')[2]||0)));
    if(action==='posts'||action.startsWith('posts:'))return reply(i,postsCard(db,current(i),resourceMap(db),action.split(':')[1],Number(action.split(':')[2]||0),action.split(':')[3]));

    if(action==='payment_profile'){requireStaff(i);const c=current(i);const p=JSON.parse(c.payment_details||'null');return reply(i,p?flow.card('Payment details',Object.entries(p).map(([k,v])=>`**${k}:** ${flow.markdown(v,1000)}`).join('\n')):'No payment details saved yet.');}
    if(action==='my_deal')return reply(i,dealCard(db,current(i),staff(i)));
    if(action.startsWith('faq:'))return reply(i,flow.faqCard(Number(action.split(':')[1])));
    if(action==='guide')return reply(i,flow.creatorGuide(current(i),resourceMap(db),resourceMap(db).user_technical_contact||config.ownerId));
    if(action==='commands'){current(i);return reply(i,flow.creatorCommandsCard());}
    if(action==='resume') {
      const c=creator(actor(i));
      return reply(i,c?`Here’s your channel: <#${c.channel_id}>.`:'Click Get started to fill out your application.');
    }
    const c=await scripts.reconcile(current(i));
    if(action==='add_accounts'||action.startsWith('approve_accounts:')||action.startsWith('reject_accounts:')) {
      if(action==='add_accounts') {
        if(['removed','removal_due'].includes(c.stage))throw Error('Account additions are unavailable after leaving the program.');
        if(c.discord_user_id!==actor(i))throw Error('Only this creator can add accounts.');
        if(!c.first_video_approved_at&&c.cohort!=='legacy')throw Error('Finish account setup first.');
        const links=flow.parseAccountLinks(values(i).accounts,{requireAll:false,multiple:true}).split('\n').filter(url=>!String(c.campaign_accounts||'').split('\n').includes(url));
        if(!links.length)return reply(i,'These accounts are already saved.');
        const review=resourceMap(db);
        if(!review.channel_staff_reviews)throw Error('Account review is unavailable. Ask the team in this channel.');
        db.prepare('INSERT OR IGNORE INTO additional_account_requests(id,creator_id,links,created_at) VALUES (?,?,?,?)').run(i.id,c.discord_user_id,links.join('\n'),new Date().toISOString());
        enqueue(`additional-accounts:${i.id}`,review.channel_staff_reviews,{...flow.card('Review additional accounts',`${flow.markdown(c.name)}\n\n${links.join('\n')}\n\nVerify these accounts belong to this creator. Their current progress and deal stay unchanged.`),content:`<@&${review.role_staff}>`,allowed_mentions:{parse:[],roles:[review.role_staff]},components:[flow.row({...flow.button(`review:${c.discord_user_id}:approve_accounts:${i.id}`,'Approve accounts',3)},{...flow.button(`review:${c.discord_user_id}:reject_accounts:${i.id}`,'Decline',4)})]});
        await deliver();return reply(i,'Your new accounts are with the team for review. Your existing accounts and progress are unchanged.');
      }
      requireStaff(i);
      const id=action.split(':')[1],request=db.prepare('SELECT * FROM additional_account_requests WHERE id=? AND creator_id=?').get(id,c.discord_user_id);
      if(!request||request.status!=='pending')return reply(i,'This account request has already been handled.');
      const approved=action.startsWith('approve_accounts:');
      if(approved) {
        const additions=request.links.split('\n');
        const conflict=db.prepare('SELECT discord_user_id,campaign_accounts FROM creators WHERE discord_user_id<>?').all(c.discord_user_id).some(other=>String(other.campaign_accounts||'').split('\n').some(url=>additions.includes(url)));
        if(conflict)throw Error('An account is already linked to another creator. Resolve ownership before approving.');
        patchCreator(db,c.discord_user_id,{campaign_accounts:[...new Set([...String(c.campaign_accounts||'').split('\n').filter(Boolean),...additions])].join('\n'),sync_pending:1});
      }
      db.prepare('UPDATE additional_account_requests SET status=?,reviewed_by=? WHERE id=?').run(approved?'approved':'rejected',actor(i),id);
      enqueue(`additional-accounts-result:${id}`,c.channel_id,flow.card(approved?'Your accounts are approved':'Your account additions need review',approved?'Your new accounts have been added. TikTok and Instagram tracking will connect automatically; YouTube and Facebook metrics are not tracked. Your deal and progress are unchanged.':'The team could not approve these additions. Ask in this channel before resubmitting.'));
      await sync(creator(c.discord_user_id));await deliver();return reply(i,approved?'Additional accounts approved.':'Account additions declined.');
    }
    if(action.startsWith('manual_next:')) {
      requireStaff(i);
      if(i.type!==5)throw Error('Open the manual advance form from Staff controls.');
      if(db.prepare('SELECT 1 FROM flow_events WHERE id=?').get(i.id))return refresh(i,c);
      const v=values(i),reason=flow.text(v.reason,500),patch=flow.manualAdvance(c,action.split(':')[1],reason,actor(i));
      if(v.confirm!==patch.stage)throw Error(`Type ${patch.stage} to confirm the next step.`);
      transact(i,c,action,patch,()=>{
        db.prepare('INSERT INTO staff_notes VALUES (?,?,?,?,?)').run(`manual:${i.id}`,c.discord_user_id,actor(i),`Manual advance ${c.stage} -> ${patch.stage}: ${reason}`,new Date().toISOString());
        enqueue(`manual-advance:${i.id}`,c.channel_id,{
          ...flow.card('Your next step is open',`The team moved your onboarding forward.\n\n**${flow.STAGES[patch.stage]?.[0]||patch.stage}**\n${({account_review:'The team will review your accounts. Wait for their approval.',warmup_review:'The team will review your warm-up. Wait for their approval.',first_video_review:'Work with the team to review your draft. Wait for approval before publishing.',hub_ready:'Your draft has been approved manually. The team can now open Creator Hub.',trial:'Your trial is open. Follow the posting instructions on your status card.',active:'Continue getting drafts approved before publishing. No published links are required.'})[patch.stage]||flow.STAGES[patch.stage]?.[1]||'Continue with the team in this channel.'}\n\n[Open your status card for the next action]({status_link}).`),
          content:`<@${c.discord_user_id}>`,allowed_mentions:{parse:[],users:[c.discord_user_id]},approval_creator_id:c.discord_user_id,
        });
      });
      return refresh(i,c);
    }
    if(action==='staff'){requireStaff(i);return reply(i,flow.staffCard(signingCreator(c),config.testMode));}
    if(action==='help')return reply(i,flow.helpCard(c));
    if(action==='profile') {requireStaff(i);return reply(i,flow.card('Application details',`**Name:** ${flow.markdown(c.name)}\n**Phone:** ${flow.markdown(c.phone)}\n**Location:** ${flow.markdown(c.location)}\n**Platforms:** ${flow.markdown(c.platforms)}\n**Best video:** ${flow.markdown(c.best_video||'Not provided')}`));}
    if(action==='review_posts') {
      requireStaff(i);
      const posts=db.prepare('SELECT * FROM creator_posts WHERE creator_id=? ORDER BY submitted_at DESC LIMIT 10').all(c.discord_user_id);
      return reply(i,flow.card('Recent posts',posts.map(p=>`${p.url}\nSubmitted ${p.submitted_at.slice(0,10)}`).join('\n\n')||'No posts submitted yet. Once a creator sends a link, you can record your review with /video-check.'));
    }
    if(db.prepare('SELECT 1 FROM flow_events WHERE id=?').get(i.id))return refresh(i,c);
    const v=values(i), now=Date.now();
    if(action.startsWith('hub_issue:')) {
      if(c.discord_user_id!==actor(i))throw Error('Only the creator can submit this report.');
      const [,kind,month]=action.split(':');monthKey(month,c);
      if(!['posts','payments'].includes(kind))throw Error('Unknown report type.');
      const details=flow.text(v.details,1000);if(!details)throw Error('Describe the problem for your manager.');
      const prior=db.prepare('SELECT id FROM creator_hub_issues WHERE creator_id=? AND kind=? AND month=? AND resolved_at IS NULL').get(c.discord_user_id,kind,month);
      if(prior)return reply(i,'Your report for this month is already with the managers. Add any extra details in this private channel.');
      const r=resourceMap(db);if(!r.channel_staff_reviews||!r.role_staff)throw Error('The manager review channel needs to be configured before reports can be submitted.');
      transact(i,c,action,{},()=>{
        db.prepare('INSERT INTO creator_hub_issues (id,creator_id,kind,month,details,created_at) VALUES (?,?,?,?,?,?)').run(i.id,c.discord_user_id,kind,month,details,new Date(now).toISOString());
        enqueue(`hub-report:${i.id}`,r.channel_staff_reviews,{
          ...flow.card(kind==='posts'?'🎬 Post problem reported':'💸 Payment problem reported',`${flow.markdown(c.name)} · ${month}\n\n${flow.markdown(details,1000)}\n\n[Open creator channel](https://discord.com/channels/${config.guildId}/${c.channel_id})\nCheck and correct the underlying records, then resolve this report with an explanation.`),
          content:`<@&${r.role_staff}>`,allowed_mentions:{parse:[],roles:[r.role_staff]},components:[{type:1,components:[{type:2,style:1,label:'Resolve report',custom_id:`gt:review:${c.discord_user_id}:hub_resolve:${i.id}`}]}]
        });
      });
      await deliver();
      return reply(i,{...(kind==='posts'?postsCard(db,creator(c.discord_user_id),r,month):paymentsCard(db,creator(c.discord_user_id),r,month)),content:'✅ Your report is with the managers. We’ll notify you here when they respond.'});
    }
    if(action.startsWith('hub_resolve:')) {
      requireStaff(i);const id=action.slice('hub_resolve:'.length);
      const issue=db.prepare('SELECT * FROM creator_hub_issues WHERE id=? AND creator_id=?').get(id,c.discord_user_id);
      if(!issue||issue.resolved_at)throw Error('This report is no longer open.');
      const resolution=flow.text(v.resolution,1000);if(!resolution)throw Error('Explain the resolution and next steps.');
      transact(i,c,action,{},()=>{
        db.prepare('UPDATE creator_hub_issues SET resolved_at=?,resolution=? WHERE id=?').run(new Date(now).toISOString(),resolution,id);
        enqueue(`hub-resolution:${id}`,c.channel_id,{...flow.card('Your report has been resolved',`${issue.month} · ${issue.kind}\n\n${flow.markdown(resolution,1000)}\n\nUse /${issue.kind} to check the latest information. [Open your status card]({status_link}).`),content:`<@${c.discord_user_id}>`,allowed_mentions:{parse:[],users:[c.discord_user_id]},approval_creator_id:c.discord_user_id});
      });
      await sync(creator(c.discord_user_id));await deliver();
      return reply(i,'Report resolved. The creator has been notified with your explanation.');
    }

    if(['pay_wise','pay_paypal','pay_bank'].includes(action)) {
      if(c.discord_user_id!==actor(i))throw new Error('Only this creator can update payment details.');
      const method=action.slice(4),p={method};
      for(const key of ['recipient','country','currency','destination',...(method==='bank'?['bank']:[])]) {
        p[key]=flow.text(v[key],key==='destination'?1000:100);
        if(!p[key]&&!(key==='recipient'&&method==='paypal'))throw new Error(`Please complete ${key}.`);
      }
      p.currency=p.currency.toUpperCase();
      if(!/^[A-Z]{3}$/u.test(p.currency))throw new Error('Use a three-letter currency code, such as USD, GBP or EUR.');
      if(method==='paypal'&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(p.destination))throw new Error('Enter the email linked to your PayPal account.');
      if(method==='bank'&&!/^(us|usa|united states(?: of america)?)$/iu.test(p.country))throw new Error('US bank transfer is for US accounts. Choose Wise for international bank transfers.');
      if(method==='bank'&&p.currency!=='USD')throw new Error('US bank transfers require USD. Choose Wise for other receiving currencies.');
      if(c.payment_details===JSON.stringify(p))return reply(i,'Your saved payment details are unchanged.');
      transact(i,c,action,{payment_details:JSON.stringify(p),payment_updated_at:new Date(now).toISOString()});
      const r=resourceMap(db);
      if(r.channel_staff_reviews)enqueue(`payment-details:${i.id}`,r.channel_staff_reviews,{...flow.card('💸 Payment details saved',`${flow.markdown(c.name)} updated their preferred payment method to ${method}. Open the private details to check them.`),content:`<@&${r.role_staff}>`,allowed_mentions:{parse:[],roles:[r.role_staff]},components:[{type:1,components:[{type:2,style:2,label:'View payment details',custom_id:`gt:review:${c.discord_user_id}:payment_profile`}]}]});
      await deliver();
      await sync(creator(c.discord_user_id));
      return reply(i,{...paymentsCard(db,creator(c.discord_user_id),r),content:'✅ Your payment details are saved.'});
    }
    let patch,extra=()=>{};
    const creatorActions=['accounts','ready','post','first_posted','leave','test_signed','complete_warmup','signed','first_video'];
    if(creatorActions.includes(action)) {if(c.discord_user_id!==actor(i))throw new Error('Only this creator can submit that action.');}
    else requireStaff(i);
    if(action==='first_posted') {
      patch=firstPublication(c,new Date(now).toISOString(),now);
    } else if(action==='accounts') {
      if(!['warmup','account_review'].includes(c.stage))throw new Error('Account answers can be edited during setup or account review.');
      patch={campaign_accounts:('instagram' in v||'tiktok' in v)?flow.parseAccountFields(v.instagram,v.tiktok,v.youtube,v.facebook):flow.parseAccountLinks(v.accounts),timezone:flow.text(v.timezone,100)?await parseTimezone(flow.text(v.timezone,100),io.timezoneOptions):c.timezone||await parseTimezone(c.location,io.timezoneOptions)};
      if(c.stage==='account_review'&&patch.campaign_accounts===c.campaign_accounts&&patch.timezone===c.timezone)
        return reply(i,'Your answers are unchanged and are still with the team for review.');
      Object.assign(patch,c.stage==='account_review'?{stage:'account_review'}:flow.transition({...c,...patch},'submit_accounts',{now}));
    } else if(action==='first_video') {
      if(c.cohort==='legacy')throw Error('Legacy creators do not need draft approval.');
      if(c.stage!=='first_video')throw new Error('Draft submission is available after signature verification.');
      const file=draftAttachment(i), link=flow.text(v.url,500);
      if(Boolean(file)===Boolean(link))throw new Error('Provide either one video upload or one draft link.');
      const url=file?await saveUpload(i,file):flow.httpsUrl(link);
      patch=flow.transition(c,'submit_first_video',{now,value:url||''});
      patch.submitted_script_id=c.current_script_id;
      if(c.current_script_id)extra=()=>db.prepare('INSERT INTO script_drafts VALUES (?,?,?,?,?,?) ON CONFLICT(creator_id,script_id) DO UPDATE SET url=excluded.url,status=excluded.status,submitted_at=excluded.submitted_at,reviewed_at=NULL').run(c.discord_user_id,c.current_script_id,url,'review',new Date(now).toISOString(),null);
    } else if(action==='post') {
      throw Error('Published links are no longer required. Use First video posted once to record your trial start.');
    } else if(action==='leave') {
      if(!['trial','active','at_risk'].includes(c.stage))throw new Error('Leave is available during trial or active posting.');
      if(c.notice_pending)return reply(i,'Your time-off request is already with the team. We’ll get back to you here.');
      const reason=flow.text(v.reason,500);if(!reason)throw new Error('Add the dates and reason.');
      patch={notice_pending:1,notice_requested_at:new Date(now).toISOString(),exception_reason:reason};
      extra=()=>enqueue(`leave:${i.id}`,c.channel_id,flow.card('Time-off request received',`${flow.markdown(reason)}\n\nThe team will review this here. Missed days won’t count against you while you wait.`));
    } else if(action==='exception')patch=approveLeave(c,Number(v.days),flow.text(v.reason,500),now);
    else if(action==='deny_leave') {
      if(!c.notice_pending)throw new Error('No leave request is pending.');
      const reason=flow.text(v.reason,500);if(!reason)throw new Error('Add a reason.');
      const paused=now-Date.parse(c.notice_requested_at);
      patch={notice_pending:0,notice_requested_at:null,exception_reason:reason,...(c.risk_started_at?{risk_started_at:new Date(Date.parse(c.risk_started_at)+paused).toISOString()}:{exception_until:new Date(now).toISOString()})};
      extra=()=>enqueue(`leave-decision:${i.id}`,c.channel_id,flow.card('An update on your time off',`Your request wasn’t approved.\n\n${flow.markdown(reason)}\n\nPlease resume posting. The days you spent waiting for this decision won’t count against you.`));
    } else if(action==='agreement_link') {
      if(c.stage!=='agreement_ready')throw new Error('Approve warm-up before attaching an agreement.');
      const url=flow.httpsUrl(v.url);if(!url)throw new Error('Enter a complete https:// signing link.');patch={agreement_url:url};
    } else if(action==='test_clock') {
      if(i.type!==2)throw new Error('Use the staff-only /creator preview command for date previews.');
      if(!config.testMode)throw new Error('Date previews are unavailable.');
      const days=Number(v.days);if(!Number.isInteger(days)||days<0||days>30)throw new Error('Enter 0–30 days.');
      const at=now+days*flow.DAY;
      const decision=c.notice_pending?'pending leave':flow.inactivityDecision({stage:c.stage,lastPostAt:c.last_post_at,exceptionUntil:c.exception_until,riskStartedAt:c.risk_started_at,timezone:c.timezone||'UTC',now:at,testMode:true});
      return reply(i,flow.card('Timeline preview',`${days} day(s) ahead: **${decision}**.\nTrial review: ${c.trial_ends_at&&at>=Date.parse(c.trial_ends_at)?'due':'not due'}.\n\nThis preview does not change dates, roles, or membership. A new At Risk period always lasts four full days from entry.`));
    } else if(action==='confirm_signature'&&jotform.enabled&&isDefaultAgreement(c.agreement_url)) {
      await jotform.poll(now,true);
      if(!creator(c.discord_user_id).agreement_signed_at)throw new Error('No complete linked signature has been received yet. Automatic checks will continue.');
      return refresh(i,c);
    } else if(action==='signed'&&jotform.enabled&&isDefaultAgreement(c.agreement_url)) {
      if(c.agreement_signed_at)return refresh(i,c);
      if(!['agreement','agreement_review'].includes(c.stage))throw new Error('The agreement step is not open.');
      patch={stage:c.stage};
    } else if(['pass_trial','extend_trial','end_trial'].includes(action)) {
      patch=flow.transition({...c,stage:c.draft_resume_stage||c.stage},action,{now});
      if(c.draft_resume_stage&&action!=='end_trial'){patch.draft_resume_stage=patch.stage||c.draft_resume_stage;patch.stage=c.stage;}
    } else patch=flow.transition(c,{ready:'submit_accounts',changes:'request_changes'}[action]||action,{now,testMode:config.testMode,value:flow.text(v.reason,500),actor:actor(i)});
    if(action==='approve_account') {
      flow.parseAccountLinks(c.campaign_accounts);
      if(c.account_resume_stage)Object.assign(patch,{stage:c.account_resume_stage,account_resume_stage:null});
      if(c.account_update_requested_at) {
        const pause=now-Date.parse(c.account_update_requested_at);
        for(const key of ['trial_ends_at','risk_started_at'])if(c[key])patch[key]=new Date(Date.parse(c[key])+pause).toISOString();
        if(['trial','active','at_risk'].includes(c.account_resume_stage))patch.exception_until=new Date(Math.max(now,Date.parse(c.exception_until||'1970-01-01'))).toISOString();
        patch.account_update_requested_at=null;
      }
    }
    if(['approve_first_video','revise_first_video'].includes(action)) {
      if(c.submitted_script_id)extra=()=>db.prepare('UPDATE script_drafts SET status=?,reviewed_at=? WHERE creator_id=? AND script_id=?').run(action==='approve_first_video'?'approved':'changes',new Date(now).toISOString(),c.discord_user_id,c.submitted_script_id);
      if(action==='approve_first_video') {
        const newer=c.current_script_id&&c.submitted_script_id!==c.current_script_id;
        patch.stage=newer?'first_video':c.draft_resume_stage||'hub_ready';
        if(!newer)patch.draft_resume_stage=null;
      }
    }
    if(['approve_warmup','send_agreement'].includes(action))patch.agreement_url=jotform.issue(c,patch.agreement_url,now);
    if(action==='confirm_signature') {
      const receipt=await jotform.verify(c,now);
      if(receipt){patch.agreement_source='staff_verified_jotform_api';patch.signature_evidence=`Jotform ${receipt.submissionId}; provider fields checked; staff review: ${flow.text(v.reason,500)}`;}
    }
    if(action==='reopen')patch.agreement_url=null;
    const notification=action==='approve_account'&&c.account_resume_stage?['Your accounts are approved','Your TikTok, Instagram, YouTube and Facebook accounts are approved. Your previous onboarding progress has been restored. Open your status card to continue.']:creatorDecision(action,{...c,...patch},flow.markdown(v.reason||'',500));
    if(action==='approve_first_video'&&notification&&c.submitted_script_id){notification[1]+=`\n\nApproved script: ${signingCreator(c).submitted_script_url}`;if(c.current_script_id!==c.submitted_script_id)notification[1]+='\nA newer script is waiting on your status card; it needs its own draft approval.';}
    const savedExtra=extra;
    if(notification)extra=()=>{savedExtra();enqueue(`creator-decision:${i.id}`,c.channel_id,{
      ...flow.card(...notification),
      content:`<@${c.discord_user_id}>`,allowed_mentions:{parse:[],users:[c.discord_user_id]},approval_creator_id:c.discord_user_id,
    });};
    const finalExtra=()=>{extra();if(action==='reopen'||action==='agreement_link')jotform.invalidate(c.discord_user_id);};
    transact(i,c,action,{...patch,updated_at:new Date(now).toISOString()},finalExtra);
    if(action==='signed')try{await jotform.poll(now,true);}catch(e){console.error('Jotform receipt check',e.message);}
    return refresh(i,c);
  }
  async function schedule(now=Date.now(),forceJotform=false) {
    await offboarding.tick(now);
    const unavailable=new Set();
    for(const c of db.prepare("SELECT * FROM creators WHERE stage NOT IN ('removed','removal_due')").all()) {
      try{const member=await scripts.reconcile(c);if(member.discord_member_missing_at)unavailable.add(c.discord_user_id);}
      catch(e){console.error('Workflow role reconciliation',c.discord_user_id,e.message);unavailable.add(c.discord_user_id);}
    }
    try{await scripts.poll(now);}catch(e){console.error('Script processing',e.message);}
    try{scripts.reports(now);}catch(e){console.error('Trial report processing',e.message);}
    try{await jotform.poll(now,forceJotform);}catch(e){if(forceJotform)throw e;console.error('Jotform polling',e.message);}
    for(let c of db.prepare('SELECT * FROM creators').all()) {
      try {
        if(offboarding.active(c)||unavailable.has(c.discord_user_id))continue;
        if(c.sync_pending) {
          try {await sync(c);} catch(e){console.error('workspace pending sync',c.discord_user_id,e.message);}
        }
        if(['trial','active','at_risk'].includes(c.stage)||c.cohort==='legacy')continue;
        if(c.notice_pending||Date.parse(c.exception_until)>now)continue;
        let decision=flow.inactivityDecision({stage:c.stage,lastPostAt:c.last_post_at,exceptionUntil:c.exception_until,riskStartedAt:c.risk_started_at,now,testMode:config.testMode,timezone:c.timezone||'UTC'});
        if(['at_risk','would_remove'].includes(decision)) {
          const action=decision==='at_risk'?'risk':'offboard';
          const id=`schedule:${c.discord_user_id}:${action}:${c.last_post_at}:${c.risk_started_at||''}`;
          transact({id,user:{id:'scheduler'}},c,action,flow.transition(c,action,{now,testMode:config.testMode}));
          c=creator(c.discord_user_id);
          try {await sync(c);} catch(e){console.error('workspace pending sync',c.discord_user_id,e.message);}
        }
        if(['none','excepted'].includes(decision)&&!['warmup','account_review','account_ready','warmup_review','agreement_ready','agreement','agreement_review','first_video','first_video_review','hub_ready'].includes(c.stage))continue;
        const onboarding=!['trial','active','at_risk','removal_due'].includes(c.stage);
        if(onboarding) {
          // Do not repeat the welcome on the next scheduler tick, or chase a
          // creator while the next action belongs to staff.
          if(!['warmup','account_ready','agreement','first_video'].includes(c.stage))continue;
          const lastActivity=Math.max(...[c.created_at,c.updated_at,c.last_followup_at].map(t=>Date.parse(t)||0));
          if(now-lastActivity<flow.DAY)continue;
        }
        const day=flow.localDay(now,c.timezone||'UTC');
        const payload=c.stage==='removal_due'?flow.card('You are now an inactive creator','The four-day At Risk deadline passed without a submitted post. Your active-creator access has been removed. Contact the team here to discuss returning.'):
          ['trial','active','at_risk'].includes(c.stage)?{...flow.card('',''),embeds:[flow.reminderCopy(c,now)]}:
          flow.card('Your next onboarding step',{
            warmup:'Finish setting up your accounts, then choose Add account links to submit them for review.',
            account_ready:'Finish the warm-up guide, then choose Warm-up complete on your status card.',
            agreement:'Choose Review & sign on your status card. Your next step opens automatically after submission.',
            first_video:'When your draft is ready, choose Submit first video on your status card. You can upload a video or send a link.',
          }[c.stage]+'\n\nNeed help? Ask the team in this channel.');
        enqueue(`daily:${c.discord_user_id}:${c.stage}:${day}`,c.channel_id,{...payload,content:`<@${c.discord_user_id}>`,allowed_mentions:{parse:[],users:[c.discord_user_id]}});
        if(onboarding)patchCreator(db,c.discord_user_id,{last_followup_at:new Date(now).toISOString()});
      } catch(e){console.error('workspace sync',c.discord_user_id,e.message);}
    }
    await deliver();
    db.prepare('INSERT INTO resources(key,discord_id,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET discord_id=excluded.discord_id,updated_at=excluded.updated_at').run('workflow_schedule_last_completed',JSON.stringify({unavailable_creators:[...unavailable]}),new Date(now).toISOString());
  }
  return {handle,openModal,sync,schedule,publishStart,deliver,staff,reply,creator,jotform,scripts,offboarding};
}
