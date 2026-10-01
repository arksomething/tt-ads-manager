import {createHash,randomUUID} from 'node:crypto';
import {card,button,row,markdown,DAY} from './flow.mjs';

const VIEW=1n<<10n, CONNECT=1n<<20n, ADMIN=8n;
const READ_ONLY=VIEW|(1n<<16n);
// Explicit member denies keep managed-role grants from reopening posting or thread actions.
const ANNOUNCEMENTS_DENY=[0,4,6,11,12,13,14,15,17,18,20,21,22,23,24,25,28,29,31,32,33,34,35,36,37,38,39,42,44,45,46,48,49,50,51,52].reduce((p,b)=>p|(1n<<BigInt(b)),0n);
const payoutMonth=c=>new Date(c.payout_at).toLocaleString('en-US',{month:'long',year:'numeric',timeZone:'UTC'});
const SUPPORT=VIEW|(1n<<11n)|(1n<<14n)|(1n<<15n)|(1n<<16n);
const iso=n=>new Date(n).toISOString();
const stamp=s=>s?`<t:${Math.floor(Date.parse(s)/1000)}:F>`:'not recorded';
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const snowTime=id=>Number((BigInt(id)>>22n)+1420070400000n);
const messageTime=m=>Date.parse(m.timestamp)||snowTime(m.id);
const digest=m=>hash([m.content||'',m.embeds||[],(m.attachments||[]).map(a=>[a.id,a.filename,a.size]),m.edited_timestamp||null]);
const absent=e=>e.status===404&&[10007,10013].includes(e.code);

export function migrateOffboarding(db) {
  if(!db.prepare('PRAGMA table_info(creators)').all().some(c=>c.name==='offboarding_id'))db.exec('ALTER TABLE creators ADD COLUMN offboarding_id TEXT');
  db.exec(`CREATE TABLE IF NOT EXISTS offboarding_previews(id TEXT PRIMARY KEY,creator_id TEXT NOT NULL,actor_id TEXT NOT NULL,expires_at TEXT NOT NULL,payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS offboarding_cases(
      id TEXT PRIMARY KEY,creator_id TEXT NOT NULL,channel_id TEXT NOT NULL,actor_id TEXT NOT NULL,reason TEXT NOT NULL,started_at TEXT NOT NULL,payout_at TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'open',snapshot TEXT NOT NULL,notice_message_id TEXT,notice_at TEXT,access_verified_at TEXT,
      report_message_id TEXT,report_at TEXT,report_hash TEXT,settlement TEXT NOT NULL DEFAULT 'unverified',settlement_evidence TEXT,
      hold_reason TEXT,last_creator_at TEXT,last_staff_at TEXT,last_creator_id TEXT,last_staff_id TEXT,reply_to_id TEXT,
      history_checked_at TEXT,history_cursor TEXT,kicked_at TEXT,error TEXT,updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS offboarding_events(id TEXT PRIMARY KEY,case_id TEXT NOT NULL,actor_id TEXT NOT NULL,action TEXT NOT NULL,payload TEXT NOT NULL,at TEXT NOT NULL);`);
}

export function removalDeadline(c) {
  if(!c.notice_at||!c.report_at)return {at:null,blocked:'Waiting for the stop-posting notice and final report delivery.'};
  if(c.hold_reason)return {at:null,blocked:c.hold_reason};
  if(!['paid','no_balance'].includes(c.settlement))return {at:null,blocked:'Final payment or an evidence-backed no-balance review is outstanding.'};
  if(c.last_creator_id&&c.reply_to_id!==c.last_creator_id)return {at:null,blocked:'A creator message is awaiting a human staff reply.'};
  const at=Math.max(Date.parse(c.payout_at),Date.parse(c.notice_at),Date.parse(c.report_at)+14*DAY,c.last_staff_at?Date.parse(c.last_staff_at)+7*DAY:0);
  if(!Number.isFinite(at))return {at:null,blocked:'A required date is invalid.'};
  return {at,blocked:null};
}
export function effectivePermissions(member,channel,roles,guild) {
  if(member.user.id===guild.owner_id)return ~0n;
  let p=BigInt(roles.find(r=>r.id===guild.id)?.permissions||0);
  for(const r of roles)if(member.roles.includes(r.id))p|=BigInt(r.permissions);
  if(p&ADMIN)return ~0n;
  const entries=channel.permission_overwrites||[];
  const all=entries.find(o=>o.id===guild.id&&o.type===0);
  if(all)p=(p&~BigInt(all.deny))|BigInt(all.allow);
  let allow=0n,deny=0n;
  for(const o of entries)if(o.type===0&&member.roles.includes(o.id)){allow|=BigInt(o.allow);deny|=BigInt(o.deny);}
  p=(p&~deny)|allow;
  const own=entries.find(o=>o.type===1&&o.id===member.user.id);
  return own?(p&~BigInt(own.deny))|BigInt(own.allow):p;
}
// Resource setup replaces whole overwrite arrays. Reapply the authoritative cases
// in the same request so a restart cannot hide Announcements or reopen other access.
export function protectOffboardingChannelWrites(db,config,request,resources) {
  return async (cfg,path,init={})=>{
    if(typeof init.body==='string'&&['POST','PATCH'].includes(init.method)) {
      const body=JSON.parse(init.body);
      if(Array.isArray(body.permission_overwrites)) {
        const cases=db.prepare('SELECT creator_id,channel_id FROM offboarding_cases WHERE id IN (SELECT offboarding_id FROM creators WHERE offboarding_id IS NOT NULL)').all();
        const r=resources(db);
        if(cases.length&&r.role_offboarded) {
          const channel=path.match(/^\/channels\/([^/]+)$/)?.[1];
          const ids=new Set(cases.map(c=>c.creator_id));
          body.permission_overwrites=body.permission_overwrites.filter(o=>!(o.type===1&&ids.has(o.id))&&!(o.type===0&&o.id===r.role_offboarded));
          body.permission_overwrites.push({id:r.role_offboarded,type:0,allow:'0',deny:(VIEW|CONNECT).toString()});
          for(const c of cases)body.permission_overwrites.push({id:c.creator_id,type:1,
            allow:(channel===c.channel_id?SUPPORT:channel===r.channel_resource_announcements?READ_ONLY:0n).toString(),
            deny:(channel===c.channel_id?0n:channel===r.channel_resource_announcements?ANNOUNCEMENTS_DENY:VIEW|CONNECT).toString()});
          init={...init,body:JSON.stringify(body)};
        }
      }
    }
    return request(cfg,path,init);
  };
}

export function payoutDate(value,now=Date.now()) {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value||''))throw Error('Use the next payout date as YYYY-MM-DD (UTC).');
  const at=Date.parse(value+'T23:59:59.999Z');
  if(!Number.isFinite(at)||iso(at).slice(0,10)!==value||at<now)throw Error('Choose a valid next payout date today or later.');
  return iso(at);
}

export function createOffboarding(db,config,{api,resourceMap,setResource,enqueue,patch,staff,reply}) {
  const get=id=>db.prepare('SELECT * FROM offboarding_cases WHERE id=?').get(id);
  const active=c=>c?.offboarding_id?get(c.offboarding_id):null;
  const creator=id=>db.prepare('SELECT * FROM creators WHERE discord_user_id=?').get(id);
  const actor=i=>i.member?.user?.id||i.user?.id;
  const save=(id,changes)=>{const entries=Object.entries({...changes,updated_at:iso(Date.now())});db.prepare(`UPDATE offboarding_cases SET ${entries.map(([k])=>k+'=?').join(',')} WHERE id=?`).run(...entries.map(([,v])=>v),id);};
  const event=(c,who,action,payload,id=randomUUID())=>db.prepare('INSERT OR IGNORE INTO offboarding_events VALUES(?,?,?,?,?,?)').run(id,c.id,who,action,JSON.stringify(payload),iso(Date.now()));
  const request=(path,init)=>api(config,path,init);
  const member=id=>request(`/guilds/${config.guildId}/members/${id}`);
  const status=c=>{
    const issues=db.prepare('SELECT count(*) n FROM creator_hub_issues WHERE creator_id=? AND resolved_at IS NULL').get(c.creator_id).n;
    const d=issues?{at:null,blocked:'An open reported issue needs to be resolved.'}:removalDeadline(c);
    return card('Offboarded · payment and support',`New GoTall posting has stopped. You can read Announcements and use this private channel for final payment, missing post links and questions. All other channels are hidden.\n\n**Expected payout:** Around the start of ${payoutMonth(c)}\n**Final report delivered:** ${stamp(c.report_at)}\n**Payment review:** ${c.settlement==='paid'?'Payment recorded':c.settlement==='no_balance'?'No outstanding balance recorded':'Pending'}\n**Server removal:** ${c.state==='kicked'?stamp(c.kicked_at):d.at?stamp(iso(d.at)):'On hold'}\n${d.blocked?`\n${markdown(d.blocked,500)}\n`:''}\nRemoval is no earlier than 14 days after the final report and 7 days after a human staff reply to your message. Unanswered messages pause removal.`,0x859c8c);
  };
  async function ensureResources() {
    let r=resourceMap(db);
    const roles=await request(`/guilds/${config.guildId}/roles`);
    let role=roles.find(x=>x.id===r.role_offboarded)||roles.find(x=>x.name==='Offboarded'&&!x.managed);
    if(!role)role=await request(`/guilds/${config.guildId}/roles`,{method:'POST',body:JSON.stringify({name:'Offboarded',permissions:'0',mentionable:false,hoist:false,color:0x859c8c})});
    if(role.permissions!=='0'||role.mentionable||role.hoist)await request(`/guilds/${config.guildId}/roles/${role.id}`,{method:'PATCH',body:JSON.stringify({permissions:'0',mentionable:false,hoist:false})});
    setResource(db,'role_offboarded',role.id);
    const channels=await request(`/guilds/${config.guildId}/channels`);
    let category=channels.find(x=>x.id===r.category_offboarded)||channels.find(x=>x.type===4&&x.name==='Offboarded Creators');
    const overwrites=[{id:config.guildId,type:0,deny:VIEW.toString(),allow:'0'},...[r.role_staff,r.role_admin].filter(Boolean).map(id=>({id,type:0,allow:SUPPORT.toString(),deny:'0'})),{id:config.applicationId,type:1,allow:SUPPORT.toString(),deny:'0'}];
    if(!category)category=await request(`/guilds/${config.guildId}/channels`,{method:'POST',body:JSON.stringify({name:'Offboarded Creators',type:4,permission_overwrites:overwrites})});
    setResource(db,'category_offboarded',category.id);
    return resourceMap(db);
  }
  async function inspect(c) {
    const [guild,roles,channels,target,bot]=await Promise.all([request(`/guilds/${config.guildId}`),request(`/guilds/${config.guildId}/roles`),request(`/guilds/${config.guildId}/channels`),member(c.discord_user_id),member(config.applicationId)]);
    const r=resourceMap(db),staffRoles=[r.role_staff,r.role_admin];
    if(target.user.bot||target.user.id===guild.owner_id||target.roles.some(id=>staffRoles.includes(id)||BigInt(roles.find(x=>x.id===id)?.permissions||0)&ADMIN))throw Error('This account is a bot, owner or staff member; ordinary creator offboarding cannot restrict it.');
    const own=channels.find(x=>x.id===c.channel_id);
    if(!own||own.type!==0)throw Error('The creator’s private text channel is missing.');
    const announcements=channels.find(x=>x.id===r.channel_resource_announcements);
    if(!announcements||![0,5].includes(announcements.type)||announcements.id===own.id)throw Error('The configured Announcements channel is missing or invalid; no access changes can be verified.');
    const botTop=Math.max(0,...roles.filter(x=>bot.roles.includes(x.id)).map(x=>x.position));
    if(target.roles.some(id=>(roles.find(x=>x.id===id)?.position??Infinity)>=botTop))throw Error('The bot’s role must be above every creator role before offboarding.');
    const bp=effectivePermissions(bot,own,roles,guild);
    if(!(bp&ADMIN))throw Error('The bot needs Administrator for a complete server-wide access audit. No permissions were changed.');
    return {guild,roles,channels,target,bot,own,announcements};
  }
  async function preview(i,c,reason,date) {
    if(!staff(i))throw Error('Manager or Admin access is required.');
    if(active(c))return reply(i,status(active(c)));
    if(!reason?.trim()||reason.length>500)throw Error('Provide a creator-facing reason (up to 500 characters).');
    const payout_at=payoutDate(date),snapshot=await inspect(c),token=randomUUID();
    const payload={reason,payout_at,version:hash([c.updated_at,c.stage,c.offboarding_id,snapshot.target.roles]),snapshot};
    db.prepare('INSERT INTO offboarding_previews VALUES(?,?,?,?,?)').run(token,c.discord_user_id,actor(i),iso(Date.now()+15*60_000),JSON.stringify(payload));
    return reply(i,{...card('Review creator offboarding',`**${markdown(c.name)}** · <#${c.channel_id}>\n\n**Message:** Please stop creating and posting new GoTall content. ${markdown(reason)}\n\nTheir private channel stays open through the next payout date (${stamp(payout_at)}) and final-payment follow-up. They keep read access to Announcements and full support access to their own channel only. Other program roles and access will be removed. Creator-facing payout timing is around the start of ${payoutMonth({payout_at})}. Records and existing-post tracking remain.\n\nRemoval waits for a verified final report, settled payment/no balance, no holds and no unanswered creator message; then uses the later of report +14 days or human reply +7 days.\n\nThis applies only to this creator. Confirm within 15 minutes.`),components:[row(button(`offboard_confirm:${token}`,'Offboard creator',4))],allowed_mentions:{parse:[]}});
  }
  async function confirm(i,token) {
    if(!staff(i))throw Error('Manager or Admin access is required.');
    const p=db.prepare('SELECT * FROM offboarding_previews WHERE id=?').get(token);
    if(!p||p.actor_id!==actor(i)||Date.parse(p.expires_at)<Date.now())throw Error('This preview expired or belongs to another staff member. Run /creator offboard again.');
    let c=creator(p.creator_id);
    if(active(c))return reply(i,status(active(c)));
    const payload=JSON.parse(p.payload),snapshot=await inspect(c);
    if(payload.version!==hash([c.updated_at,c.stage,c.offboarding_id,snapshot.target.roles]))throw Error('The creator changed since this preview. Run /creator offboard again.');
    const at=iso(Date.now()),id=token;
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('INSERT INTO offboarding_cases(id,creator_id,channel_id,actor_id,reason,started_at,payout_at,snapshot,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run(id,c.discord_user_id,c.channel_id,actor(i),payload.reason,at,payload.payout_at,JSON.stringify({creator:{stage:c.stage,cohort:c.cohort,scripts_access:c.scripts_access},roles:snapshot.target.roles,overwrites:snapshot.channels.map(x=>({id:x.id,permission_overwrites:x.permission_overwrites}))}),at);
      patch(c.discord_user_id,{offboarding_id:id,stage:'removed',removed_at:at,scripts_access:0,draft_resume_stage:null,notice_pending:0,sync_pending:1,updated_at:at});
      db.prepare('UPDATE jotform_requests SET active=0 WHERE creator_id=?').run(c.discord_user_id);
      // Queued program notices must not arrive after the stop-work decision.
      db.prepare("UPDATE deliveries SET message_id='superseded-by-offboarding' WHERE channel_id=? AND message_id IS NULL").run(c.channel_id);
      event(get(id),actor(i),'offboarding_confirmed',{payout_at:payload.payout_at},i.id);
      db.exec('COMMIT');
    }catch(e){db.exec('ROLLBACK');throw e;}
    try{await sync(creator(c.discord_user_id));}catch(e){save(id,{error:e.message});}
    return reply(i,`Offboarding saved for <#${c.channel_id}>. ${get(id).access_verified_at?'Program access verified as restricted.':'Access updates are pending; the scheduler will retry.'} The private channel and payment records are retained. Use /creator offboarding status to follow progress.`);
  }
  async function sync(c) {
    let record=active(c);if(!record)return;
    // Verify the identity/authority boundary before mutating any member grants.
    let state;
    try{state=await inspect(c);}catch(e){if(absent(e)){save(record.id,{access_verified_at:null});patch(c.discord_user_id,{sync_pending:0});return;}throw e;}
    const r=await ensureResources(),role=r.role_offboarded;
    const deny=VIEW|CONNECT;
    // Shared deny plus removal of conflicting roles/member allows; never overwrite unrelated entries.
    const channels=await request(`/guilds/${config.guildId}/channels`);
    for(const ch of channels) {
      const o=(ch.permission_overwrites||[]).find(x=>x.id===role&&x.type===0);
      if(!o||(BigInt(o.deny)&deny)!==deny||(BigInt(o.allow)&deny)!==0n)await request(`/channels/${ch.id}/permissions/${role}`,{method:'PUT',body:JSON.stringify({type:0,allow:(BigInt(o?.allow||0)&~deny).toString(),deny:(BigInt(o?.deny||0)|deny).toString()})});
      if(ch.id!==c.channel_id&&ch.id!==state.announcements.id&&(ch.permission_overwrites||[]).some(x=>x.type===1&&x.id===c.discord_user_id&&BigInt(x.allow)!==0n))await request(`/channels/${ch.id}/permissions/${c.discord_user_id}`,{method:'DELETE'});
    }
    const announcementGrant=(state.announcements.permission_overwrites||[]).find(x=>x.type===1&&x.id===c.discord_user_id);
    if(announcementGrant?.allow!==READ_ONLY.toString()||announcementGrant?.deny!==ANNOUNCEMENTS_DENY.toString())await request(`/channels/${state.announcements.id}/permissions/${c.discord_user_id}`,{method:'PUT',body:JSON.stringify({type:1,allow:READ_ONLY.toString(),deny:ANNOUNCEMENTS_DENY.toString()})});
    const ownGrant=(state.own.permission_overwrites||[]).find(x=>x.type===1&&x.id===c.discord_user_id);
    if(ownGrant?.allow!==SUPPORT.toString()||ownGrant?.deny!=='0')await request(`/channels/${c.channel_id}/permissions/${c.discord_user_id}`,{method:'PUT',body:JSON.stringify({type:1,allow:SUPPORT.toString(),deny:'0'})});
    if(state.own.parent_id!==r.category_offboarded)await request(`/channels/${c.channel_id}`,{method:'PATCH',body:JSON.stringify({parent_id:r.category_offboarded})});
    if(!state.target.roles.includes(role))await request(`/guilds/${config.guildId}/members/${c.discord_user_id}/roles/${role}`,{method:'PUT'});
    for(const id of state.target.roles)if(id!==role&&!state.roles.find(x=>x.id===id)?.managed)await request(`/guilds/${config.guildId}/members/${c.discord_user_id}/roles/${id}`,{method:'DELETE'});
    // Disconnect, including sessions that started before permission removal.
    if(!record.access_verified_at||c.sync_pending)try{await request(`/guilds/${config.guildId}/members/${c.discord_user_id}`,{method:'PATCH',body:JSON.stringify({channel_id:null})});}catch(e){if(e.code!==40032)throw e;}
    let updated=await inspect(c);
    for(const ch of updated.channels)if(ch.id!==c.channel_id&&ch.id!==updated.announcements.id&&ch.type!==4&&(effectivePermissions(updated.target,ch,updated.roles,updated.guild)&VIEW)) {
      // A managed integration role can override the shared deny. A member deny closes that gap.
      await request(`/channels/${ch.id}/permissions/${c.discord_user_id}`,{method:'PUT',body:JSON.stringify({type:1,allow:'0',deny:deny.toString()})});
    }
    updated=await inspect(c);
    const visible=updated.channels.filter(ch=>ch.type!==4&&(effectivePermissions(updated.target,ch,updated.roles,updated.guild)&VIEW)).map(ch=>ch.id);
    const own=effectivePermissions(updated.target,updated.own,updated.roles,updated.guild);
    const announcementAccess=effectivePermissions(updated.target,updated.announcements,updated.roles,updated.guild);
    if(visible.length!==2||!visible.includes(c.channel_id)||!visible.includes(updated.announcements.id)||(own&SUPPORT)!==SUPPORT||(announcementAccess&READ_ONLY)!==READ_ONLY||(announcementAccess&ANNOUNCEMENTS_DENY)!==0n)throw Error('Access verification failed: only the private support channel and read-only Announcements may remain accessible.');
    save(record.id,{access_verified_at:iso(Date.now())});
    await syncCard(c);
    patch(c.discord_user_id,{sync_pending:0});
    record=get(record.id);
    if(!record.notice_message_id)enqueue(`offboarding-notice:${record.id}`,c.channel_id,{
      ...card('Your GoTall participation',`Please stop creating or posting new GoTall content from this notice onward. ${markdown(record.reason)}\n\nIf you have already-approved work in progress or scheduled, please tell us here. You do not need to delete existing posts.\n\nYour payout is expected around the start of the new month (${payoutMonth(record)}). We will review your existing work under the terms agreed with you. You can still read <#${state.announcements.id}> and use this private channel for payment and questions; all other channels are hidden.\n\nServer removal is no earlier than 14 days after your final payment report and 7 days after our human reply to a message from you. Unanswered messages, unresolved payment or a reported dispute pause removal.\n\n[Open your status]({status_link})`),content:`<@${c.discord_user_id}>`,allowed_mentions:{parse:[],users:[c.discord_user_id]},approval_creator_id:c.discord_user_id,offboarding_case_id:record.id});
  }
  async function syncCard(c) {
    const rec=active(c);let id=c.status_message_id;const payload=status(rec);
    payload.components=[row(button('payments','Payments'),button('my_deal','My deal'))];
    if(id)try{await request(`/channels/${c.channel_id}/messages/${id}`,{method:'PATCH',body:JSON.stringify(payload)});}catch(e){if(e.status!==404)throw e;id=null;}
    if(!id){const m=await request(`/channels/${c.channel_id}/messages`,{method:'POST',body:JSON.stringify({...payload,nonce:hash(['offboard-card',rec.id]).slice(0,24),enforce_nonce:true})});id=m.id;patch(c.discord_user_id,{status_message_id:id});}
  }
  function delivered(id,m) {
    const c=get(id);if(!c||c.notice_message_id)return;
    save(id,{notice_message_id:m.id,notice_at:iso(messageTime(m))});
    event(c,'delivery','notice_delivered',{message_id:m.id});
  }
  async function isHumanStaff(m) {
    if(m.author?.bot||m.webhook_id||!m.author?.id)return false;
    if(m.author.id===config.ownerId)return true;
    try{const x=await member(m.author.id);return staff({member:x});}catch(e){if(absent(e))return false;throw e;}
  }
  async function observe(m) {
    if(!m.id||!m.author||m.author.bot||m.webhook_id||m.type!==undefined&&![0,19].includes(m.type))return;
    const c=db.prepare("SELECT * FROM offboarding_cases WHERE channel_id=? AND state='open' ORDER BY started_at DESC LIMIT 1").get(m.channel_id);
    if(!c||messageTime(m)<Date.parse(c.started_at))return;
    const at=iso(messageTime(m));
    if(m.author.id===c.creator_id) {
      if(!c.last_creator_id||BigInt(m.id)>BigInt(c.last_creator_id)) {
        save(c.id,{last_creator_id:m.id,last_creator_at:at});event(c,m.author.id,'creator_message',{message_id:m.id},`creator-message:${m.id}`);
        const r=resourceMap(db);
        if(r.channel_staff_reviews&&r.role_staff)enqueue(`offboard-question:${m.id}`,r.channel_staff_reviews,{...card('Offboarded creator needs a reply',`<@${c.creator_id}> sent a message. Removal is paused until a human reply.\n\n[Open message](https://discord.com/channels/${config.guildId}/${c.channel_id}/${m.id})`),content:`<@&${r.role_staff}>`,allowed_mentions:{parse:[],roles:[r.role_staff]}});
      }
    }else if(m.id!==c.report_message_id&&c.last_creator_id&&BigInt(m.id)>BigInt(c.last_creator_id)&&(!c.last_staff_id||BigInt(m.id)>BigInt(c.last_staff_id))&&await isHumanStaff(m)) {
      const ref=m.message_reference?.message_id;
      // A reply to an older question does not resolve a newer creator message.
      if(ref&&BigInt(ref)<BigInt(c.last_creator_id))return;
      save(c.id,{last_staff_id:m.id,last_staff_at:at,reply_to_id:c.last_creator_id});event(c,m.author.id,'staff_reply',{message_id:m.id,creator_message_id:c.last_creator_id},`staff-reply:${m.id}`);
    }
  }
  async function reconcileHistory(c,now=Date.now()) {
    // Page backwards from the current head. Never advance the cursor on a partial scan.
    const all=[];let before,complete=false;
    for(let page=0;page<100;page++) {
      const rows=await request(`/channels/${c.channel_id}/messages?limit=100${before?`&before=${before}`:''}`);
      if(!Array.isArray(rows)||rows.some(m=>!m.id||!m.author))throw Error('Channel history is unavailable; removal is paused.');
      for(const m of rows)if((!c.history_cursor||BigInt(m.id)>BigInt(c.history_cursor))&&messageTime(m)>=Date.parse(c.started_at))all.push({...m,channel_id:c.channel_id});
      if(rows.length<100||rows.some(m=>c.history_cursor&&BigInt(m.id)<=BigInt(c.history_cursor)||messageTime(m)<Date.parse(c.started_at))){complete=true;break;}
      before=rows.at(-1).id;
    }
    if(!complete)throw Error('Channel history scan is incomplete; removal is paused.');
    all.sort((a,b)=>BigInt(a.id)<BigInt(b.id)?-1:1);
    for(const m of all)await observe(m);
    save(c.id,{history_checked_at:iso(now),...(all.length?{history_cursor:all.at(-1).id}:{})});
  }
  async function registerReport(i,c,url) {
    const match=String(url).match(/^https:\/\/(?:www\.)?discord\.com\/channels\/(\d+)\/(\d+)\/(\d+)$/);
    if(!match||match[1]!==config.guildId||match[2]!==c.channel_id)throw Error('Provide the final report message link from this creator’s private channel.');
    const m=await request(`/channels/${c.channel_id}/messages/${match[3]}`),rec=active(c);
    if(!rec.notice_at||messageTime(m)<Date.parse(rec.notice_at)||messageTime(m)>Date.now())throw Error('The final report must be delivered after the offboarding notice.');
    if([c.status_message_id,rec.notice_message_id].includes(m.id)||m.author?.id!==config.applicationId&&!await isHumanStaff(m))throw Error('Use an actual report delivered by staff or the GoTall bot.');
    if(!m.content&&!m.embeds?.length&&!m.attachments?.length)throw Error('The report message has no content.');
    if(rec.report_message_id===m.id&&rec.report_hash===digest(m))return;
    // Corrected/replacement reports always grant a fresh 14 days from verification (or later edit).
    const at=rec.report_message_id?Date.now():Math.max(messageTime(m),Date.parse(m.edited_timestamp)||0);
    save(rec.id,{report_message_id:m.id,report_at:iso(at),report_hash:digest(m),settlement:'unverified',settlement_evidence:null,...(rec.last_staff_id===m.id?{reply_to_id:null,last_staff_id:null,last_staff_at:null}:{})});
    event(rec,actor(i),'final_report_registered',{message_id:m.id,report_at:iso(at)});
  }
  async function manage(i,c,name,v) {
    if(!staff(i))throw Error('Manager or Admin access is required.');
    let rec=active(c);if(!rec)throw Error('This creator has no offboarding case.');
    if(name==='report')await registerReport(i,c,v.message);
    else if(name==='settlement') {
      if(!rec.report_message_id)throw Error('Register the delivered final report before reviewing final settlement.');
      if(!['paid','no_balance','unverified'].includes(v.state)||!v.evidence?.trim())throw Error('Choose a settlement state and record the transfer or no-balance review evidence.');
      save(rec.id,{settlement:v.state,settlement_evidence:v.evidence});event(rec,actor(i),'settlement_review',{state:v.state,evidence:v.evidence});
    }else if(name==='hold') {
      if(!v.reason?.trim())throw Error('Give the hold reason.');
      save(rec.id,{hold_reason:v.reason});event(rec,actor(i),'hold',{reason:v.reason});
    }else if(name==='release') {
      if(!v.reason?.trim())throw Error('Explain why the hold is resolved.');
      save(rec.id,{hold_reason:null});event(rec,actor(i),'hold_released',{reason:v.reason});
    }else if(name==='payout-date') {
      save(rec.id,{payout_at:payoutDate(v.date)});event(rec,actor(i),'payout_date',{date:v.date});
    }else if(!['status','retry'].includes(name))throw Error('Unknown offboarding control.');
    if(name==='retry')await sync(c);
    if(name!=='status')await syncCard(creator(c.discord_user_id));
    rec=get(rec.id);
    return reply(i,{...status(rec),content:`<#${c.channel_id}>\nAccess verified: ${stamp(rec.access_verified_at)}${rec.error?'\nNeeds attention: '+markdown(rec.error,500):''}`,allowed_mentions:{parse:[]}});
  }
  async function rejoined(c) {
    const rec=active(c);if(!rec)return;
    save(rec.id,{state:'open',kicked_at:null,access_verified_at:null,hold_reason:'Creator rejoined; staff must review before another removal.'});
    patch(c.discord_user_id,{sync_pending:1});
    await sync(creator(c.discord_user_id));
  }
  async function tick(now=Date.now()) {
    for(let rec of db.prepare("SELECT * FROM offboarding_cases WHERE state='open'").all()) {
      try {
        const c=creator(rec.creator_id);if(c?.offboarding_id!==rec.id)continue;
        try{await member(rec.creator_id);}catch(e){
          if(!absent(e))throw e;
          save(rec.id,{state:'departed',error:null});event(rec,'scheduler','member_absent',{});continue;
        }
        // Recover a crash between durable delivery receipt and the notice callback.
        if(!rec.notice_at) {
          const receipt=db.prepare('SELECT message_id FROM deliveries WHERE id=?').get(`offboarding-notice:${rec.id}`);
          if(/^\d+$/.test(receipt?.message_id||''))delivered(rec.id,await request(`/channels/${rec.channel_id}/messages/${receipt.message_id}`));
        }
        await sync(c);rec=get(rec.id);
        if(!rec.notice_at)continue;
        await reconcileHistory(rec,now);rec=get(rec.id);
        // Open reported issues also block removal, independent of a staff-reply timestamp.
        const issues=db.prepare('SELECT count(*) n FROM creator_hub_issues WHERE creator_id=? AND resolved_at IS NULL').get(rec.creator_id).n;
        const d=removalDeadline(rec);
        if(issues||!d.at||now<d.at){save(rec.id,{error:null});await syncCard(creator(rec.creator_id));continue;}
        const report=await request(`/channels/${rec.channel_id}/messages/${rec.report_message_id}`);
        if(digest(report)!==rec.report_hash)throw Error('Final report changed. Register the corrected report before removal.');
        // Revalidate history and a human reply immediately before the destructive action.
        if(rec.last_staff_id) {
          const m=await request(`/channels/${rec.channel_id}/messages/${rec.last_staff_id}`);
          if(!await isHumanStaff(m))throw Error('The last human reply cannot be verified; removal is paused.');
        }
        await inspect(c);
        await reconcileHistory(get(rec.id),Date.now());rec=get(rec.id);
        const latest=removalDeadline(rec);
        if(!latest.at||Date.now()<latest.at)continue;
        event(rec,'scheduler','kick_attempt',{deadline:iso(latest.at)});
        await request(`/guilds/${config.guildId}/members/${rec.creator_id}`,{method:'DELETE',headers:{'X-Audit-Log-Reason':'Creator offboarding: final report and support grace period completed'}});
        let gone=false;try{await member(rec.creator_id);}catch(e){if(absent(e))gone=true;else throw e;}
        if(!gone)throw Error('Server removal has not been verified.');
        save(rec.id,{state:'kicked',kicked_at:iso(Date.now()),error:null});event(rec,'scheduler','kick_verified',{});
        const r=resourceMap(db);
        if(r.channel_staff_reviews)enqueue(`offboarding-complete:${rec.id}`,r.channel_staff_reviews,{...card('Creator offboarding completed',`<@${rec.creator_id}> was removed after the final-report and reply grace periods. Final settlement was recorded. The private channel and records are retained: <#${rec.channel_id}>.`),allowed_mentions:{parse:[]}});
        await syncCard(creator(rec.creator_id));
      }catch(e) {
        const message=String(e.message).slice(0,500);const previous=get(rec.id);
        save(rec.id,{error:message,access_verified_at:null});
        if(previous.error!==message) {
          const r=resourceMap(db);
          if(r.channel_staff_reviews)enqueue(`offboarding-error:${rec.id}:${hash(message).slice(0,16)}`,r.channel_staff_reviews,{...card('Offboarding needs attention',`<#${rec.channel_id}>\n${markdown(message)}`),content:r.role_staff?`<@&${r.role_staff}>`:'',allowed_mentions:{parse:[],roles:r.role_staff?[r.role_staff]:[]}});
        }
      }
    }
  }
  return {active,get,status,ensureResources,preview,confirm,manage,sync,syncCard,delivered,observe,reconcileHistory,rejoined,tick};
}
