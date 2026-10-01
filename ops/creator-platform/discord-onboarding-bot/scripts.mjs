import * as flow from './flow.mjs';
import {runtimeAllowed} from './runtime-scope.mjs';

export function migrateScripts(db) {
  db.exec('CREATE TABLE IF NOT EXISTS legacy_participants (creator_id TEXT PRIMARY KEY,cutover_at TEXT NOT NULL)');
  db.exec(`CREATE TABLE IF NOT EXISTS scripts (id TEXT PRIMARY KEY,channel_id TEXT NOT NULL,author_id TEXT NOT NULL,body TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS script_drafts (creator_id TEXT NOT NULL,script_id TEXT NOT NULL,url TEXT NOT NULL,status TEXT NOT NULL,submitted_at TEXT NOT NULL,reviewed_at TEXT,PRIMARY KEY(creator_id,script_id));
    CREATE TABLE IF NOT EXISTS trial_reports (creator_id TEXT NOT NULL,trial_end TEXT NOT NULL,payload TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(creator_id,trial_end));`);
}

export function firstPublication(c,value,now=Date.now()) {
  if(c.cohort==='legacy')throw Error('Legacy creators keep their existing arrangement; no new trial is required.');
  if(c.trial_started_at)throw Error('Your first publication is already recorded.');
  if(!c.agreement_signed_at||!c.warmup_approved_at||!c.first_video_approved_at)throw Error('Complete warm-up, sign your agreement and get your first draft approved before posting.');
  if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/u.test(value))throw Error('Use a date and time with timezone, for example 2026-09-13T14:30:00Z.');
  const at=Date.parse(value);
  if(!Number.isFinite(at)||at>now||at<Math.max(...[c.warmup_approved_at,c.agreement_signed_at,c.first_video_approved_at].map(Date.parse)))throw Error('The first publication must be after warm-up, signing and draft approval, and cannot be in the future.');
  return {stage:'trial',draft_resume_stage:null,trial_started_at:new Date(at).toISOString(),trial_ends_at:new Date(at+7*flow.DAY).toISOString(),first_publication_source:'creator_confirmation',updated_at:new Date(now).toISOString(),sync_pending:1};
}

export function trialReport(db,c,now=Date.now()) {
  const start=Date.parse(c.trial_started_at),end=Date.parse(c.trial_ends_at);
  const source=db.prepare('SELECT * FROM creator_hub_sources WHERE creator_id=?').get(c.discord_user_id);
  const provider=source?.preferred==='tracker'?'tracker':'viral';
  const rows=db.prepare('SELECT * FROM creator_hub_metrics WHERE creator_id=? AND provider=? AND published_at>=? AND published_at<? ORDER BY published_at').all(c.discord_user_id,provider,start,end).filter(r=>['tiktok','instagram'].includes(r.platform));
  const fields=['tiktok','instagram'].map(platform=>{
    const posts=rows.filter(r=>r.platform===platform),known=posts.filter(r=>r.views!==null);
    return {name:platform==='tiktok'?'TikTok':'Instagram',value:posts.length?`${posts.length} observed posts; ${known.length} with view data.\nLatest observed views: ${known.length?known.reduce((sum,r)=>sum+r.views,0).toLocaleString('en-US'):'unavailable'}.\nLatest observation: ${Math.max(...posts.map(r=>r.observed_at||0))?new Date(Math.max(...posts.map(r=>r.observed_at||0))).toISOString():'unavailable'}.`:'No observations available. This does not establish zero posts or zero views.'};
  });
  const drafts=db.prepare('SELECT status,count(*) n FROM script_drafts WHERE creator_id=? AND submitted_at>=? AND submitted_at<? GROUP BY status').all(c.discord_user_id,c.trial_started_at,c.trial_ends_at);
  fields.push({name:'Drafts',value:drafts.length?drafts.map(r=>`${r.status}: ${r.n}`).join('\n'):'No script-draft records in this interval.'});
  return flow.card(`Trial review: ${flow.markdown(c.name,80)}`,`Trial decision due: ${c.trial_ends_at}. Judy: review this preliminary report before the deadline and decide whether to continue, extend or end participation. The trial may still be in progress.\n\nPeriod: ${c.trial_started_at} to ${c.trial_ends_at}. The trial starts at the first-post confirmation click. Time off does not pause it.\n\nSource: ${provider}. These are latest available snapshots for posts published during the trial, not exact end-of-trial view counts or payable views. Missing or stale coverage requires investigation. YouTube and Facebook metrics are not tracked.\n\n[Open creator status]({status_link})`,0x8b9c87,fields);
}

const NON_TALKING_SCRIPT_CHANNEL = '1549053045738840174';
const NON_TALKING_ROLE = '1549053371137400893';

export function createScripts(db,config,{api,resourceMap,enqueue,patch}) {
  let nextPoll=0;
  async function lookupMember(c) {
    // Keep membership absence separate from employment/deal state. Recheck so
    // a returning member can recover without a manual database edit.
    if(c.discord_member_missing_at&&Date.now()-Date.parse(c.discord_member_missing_at)<300_000)return null;
    try {
      const result=await api(config,`/guilds/${config.guildId}/members/${c.discord_user_id}`);
      if(!Array.isArray(result.roles))throw Error('Cannot determine creator workflow roles.');
      if(c.discord_member_missing_at)patch(c.discord_user_id,{discord_member_missing_at:null});
      return result;
    }catch(e){
      if(e.status!==404||e.code!==10007)throw e;
      const at=new Date().toISOString();patch(c.discord_user_id,{discord_member_missing_at:at});
      console.error('Creator no longer in guild; isolated from workflow',c.discord_user_id);
      return null;
    }
  }
  async function setRoles(c,eligible,cohort) {
    if(c.offboarding_id)throw Error('This creator is offboarded; program roles cannot be granted.');
    if(cohort==='new'&&(c.cohort==='legacy'||db.prepare('SELECT 1 FROM legacy_participants WHERE creator_id=?').get(c.discord_user_id)))throw Error('Existing creators cannot enroll in the new deal.');
    const r=resourceMap();
    if(!r.role_scripts||!r.role_new_deal)throw Error('Workflow roles are not configured yet.');
    for(const [role,on] of [[r.role_scripts,eligible],[r.role_new_deal,cohort==='new']])await api(config,`/guilds/${config.guildId}/members/${c.discord_user_id}/roles/${role}`,{method:on?'PUT':'DELETE'});
    patch(c.discord_user_id,{workflow_roles_initialized:1,sync_pending:1});
    return reconcile({...c,workflow_roles_initialized:1});
  }
  async function reconcile(c) {
    if(c.offboarding_id)return c;
    if(db.prepare('SELECT 1 FROM legacy_participants WHERE creator_id=?').get(c.discord_user_id)) {
      patch(c.discord_user_id,{cohort:'legacy'});c={...c,cohort:'legacy'};
    }
    const r=resourceMap();
    if(!r.role_new_deal||!r.role_scripts)return c;
    let currentMember=await lookupMember(c);
    if(!currentMember)return {...c,discord_member_missing_at:c.discord_member_missing_at||new Date().toISOString()};
    c={...c,discord_member_missing_at:null};
    if(!c.workflow_roles_initialized) {
      // New applicants earn these roles at first publication, never at signup.
      if(c.cohort!=='legacy'&&!c.first_publication_source) {
        const member=currentMember;
        if(!Array.isArray(member.roles))throw Error('Cannot determine creator workflow roles.');
        if(!member.roles.some(id=>[r.role_scripts,r.role_new_deal].includes(id)))return c;
        const changes={workflow_roles_initialized:1,cohort:member.roles.includes(r.role_new_deal)?'new':'legacy',scripts_access:Number(member.roles.includes(r.role_scripts)),sync_pending:1};
        patch(c.discord_user_id,changes);return {...c,...changes};
      }
      // Subsequent manual role edits win after this one-time grant.
      for(const [role,on] of [[r.role_scripts,c.scripts_access],[r.role_new_deal,c.cohort!=='legacy']]) {
        if(on)await api(config,`/guilds/${config.guildId}/members/${c.discord_user_id}/roles/${role}`,{method:'PUT'});
      }
      patch(c.discord_user_id,{workflow_roles_initialized:1});
    }
    currentMember=await lookupMember(c);
    if(!currentMember)return {...c,discord_member_missing_at:new Date().toISOString()};
    const locked=db.prepare('SELECT 1 FROM legacy_participants WHERE creator_id=?').get(c.discord_user_id);
    const changes={cohort:!locked&&currentMember.roles.includes(r.role_new_deal)?'new':'legacy',scripts_access:Number(currentMember.roles.includes(r.role_scripts)),workflow_roles_initialized:1};
    if(changes.cohort!==c.cohort||changes.scripts_access!==c.scripts_access)changes.sync_pending=1;
    patch(c.discord_user_id,changes);
    return {...c,...changes};
  }
  const decorate=c=>({...c,current_script:c.current_script_id?db.prepare('SELECT * FROM scripts WHERE id=?').get(c.current_script_id):null});
  async function ingestNonTalking(message) {
    if(!runtimeAllowed(config)||config.guildId!=='1400610531189985310')return false;
    if(message.guild_id&&message.guild_id!==config.guildId)return false;
    if(message.channel_id!==NON_TALKING_SCRIPT_CHANNEL||message.author?.bot)return false;
    const sender=await api(config,`/guilds/${config.guildId}/members/${message.author.id}`);
    const r=resourceMap();
    if(message.author.id!==config.ownerId&&!sender.roles?.some(id=>[r.role_staff,r.role_admin].includes(id)))return false;
    const body=String(message.content||'').trim().slice(0,4000);
    if(!body)return false;
    const recipients=[];
    for(const c of db.prepare("SELECT * FROM creators WHERE stage NOT IN ('removed','removal_due')").all()) {
      try{const m=await lookupMember(c);if(m?.roles.includes(NON_TALKING_ROLE))recipients.push(c);}
      catch(e){console.error('Non-talking recipient unavailable',c.discord_user_id,e.message);}
    }
    for(const c of recipients)enqueue(`non-talking-script:${message.id}:${c.discord_user_id}`,c.channel_id,{
      ...flow.card('🎬 New non-talking video idea',`Check <#${NON_TALKING_SCRIPT_CHANNEL}> for today’s idea and make your video using it.

[Open this idea](https://discord.com/channels/${config.guildId}/${NON_TALKING_SCRIPT_CHANNEL}/${message.id})

Submit your draft here and wait for approval before publishing.`),
      content:`<@${c.discord_user_id}>`,allowed_mentions:{parse:[],users:[c.discord_user_id]},approval_creator_id:c.discord_user_id,
    });
    return recipients.length>0;
  }

  async function ingest(message) {
    if(!runtimeAllowed(config))return false;
    const r=resourceMap();
    if(message.author===undefined&&message.id&&message.channel_id===r.channel_scripts)message={...message,...await api(config,`/channels/${message.channel_id}/messages/${message.id}`)};
    if(message.guild_id&&message.guild_id!==config.guildId)return false;
    if(message.channel_id!==r.channel_scripts||message.author?.bot)return false;
    const prior=db.prepare('SELECT * FROM scripts WHERE id=?').get(message.id);
    if(!prior&&!message.mention_roles?.includes(r.role_scripts))return false;
    if(!message.content) {
      const full=await api(config,`/channels/${message.channel_id}/messages/${message.id}`);
      message={...message,content:full.content||''};
    }
    // Reading an unchanged, previously accepted script must not depend on its
    // former author's current guild membership. Actual edits still authorize.
    if(prior&&prior.body===String(message.content||'').slice(0,4000))return false;
    const member=await api(config,`/guilds/${config.guildId}/members/${message.author.id}`);
    if(message.author.id!==config.ownerId&&!member.roles?.some(id=>[r.role_staff,r.role_admin].includes(id)))return false;
    if(prior) {
      const body=String(message.content||'').slice(0,4000);
      if(prior.body===body)return false;
      for(const d of db.prepare('SELECT * FROM deliveries WHERE id LIKE ?').all(`script:${message.id}:%`)) {
        const payload=JSON.parse(d.payload);
        payload.embeds[0].description=payload.embeds[0].description.replace(flow.inlineScript(prior),flow.inlineScript({body}));
        if(d.message_id&&/^\d+$/u.test(d.message_id)) {
          const current=await api(config,`/channels/${d.channel_id}/messages/${d.message_id}`);
          current.embeds[0].description=current.embeds[0].description.replace(flow.inlineScript(prior),flow.inlineScript({body}));
          await api(config,`/channels/${d.channel_id}/messages/${d.message_id}`,{method:'PATCH',body:JSON.stringify({embeds:current.embeds,allowed_mentions:{parse:[]}})});
        }
        db.prepare('UPDATE deliveries SET payload=? WHERE id=?').run(JSON.stringify(payload),d.id);
      }
      db.prepare('UPDATE scripts SET body=? WHERE id=?').run(body,message.id);
      db.prepare('UPDATE creators SET sync_pending=1 WHERE current_script_id=?').run(message.id);
      return true;
    }
    const recipients=[];
    for(let c of db.prepare("SELECT * FROM creators WHERE stage NOT IN ('removed','removal_due')").all()) {
      try {
      c=await reconcile(c);
      if(c.discord_member_missing_at)continue;
      const m=await lookupMember(c);
      if(m?.roles.includes(r.role_scripts))recipients.push(c);
      }catch(e){console.error('Script recipient unavailable',c.discord_user_id,e.message);}
    }
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('INSERT INTO scripts VALUES (?,?,?,?,?)').run(message.id,message.channel_id,message.author.id,String(message.content||'').slice(0,4000),message.timestamp||new Date().toISOString());
      for(const c of recipients) {
        const changes={current_script_id:message.id,sync_pending:1};
        if(c.cohort!=='legacy'&&['hub_ready','trial','active','at_risk','first_video','first_video_review'].includes(c.stage)) {
          Object.assign(changes,{draft_resume_stage:c.draft_resume_stage||(['first_video','first_video_review'].includes(c.stage)?null:c.stage),stage:'first_video',first_video_url:null,first_video_note:null,submitted_script_id:null});
          db.prepare("UPDATE script_drafts SET status='superseded' WHERE creator_id=? AND status IN ('pending','submitted','review','revisions_requested')").run(c.discord_user_id);
        }
        patch(c.discord_user_id,changes);
        if(c.cohort==='legacy')continue;
        enqueue(`script:${message.id}:${c.discord_user_id}`,c.channel_id,{...flow.card('🎬 Your script is out!',`${flow.inlineScript({body:message.content})}\n\n[Original script](https://discord.com/channels/${config.guildId}/${message.channel_id}/${message.id})\n\nFilm this idea and submit your draft here. Wait for approval before publishing.\n\n👇 [Open your draft status]({status_link})`),components:[flow.row(flow.button('payments','Payment hub'),flow.button('posts','Creator stats'),flow.button('my_deal','My deal')),flow.row(flow.button('faq:0','FAQ'),flow.button('leave','Request time off'))],content:`<@${c.discord_user_id}>`,allowed_mentions:{parse:[],users:[c.discord_user_id]},approval_creator_id:c.discord_user_id});
      }
      db.exec('COMMIT');return true;
    }catch(e){db.exec('ROLLBACK');throw e;}
  }
  async function poll(now=Date.now()) {
    if(now<nextPoll)return;nextPoll=now+30_000;
    const r=resourceMap();
    for(const channel of [r.channel_scripts].filter(Boolean)) {
    const cursorKey=channel===r.channel_scripts?'scripts_cursor':'script_library_cursor';
    const cursor=r[cursorKey]||'0';let before,all=[];
    for(let page=0;page<20;page++) {
      const rows=await api(config,`/channels/${channel}/messages?limit=100${before?`&before=${before}`:''}`);
      for(const m of rows)if(db.prepare('SELECT 1 FROM scripts WHERE id=?').get(m.id)) {
        try{await ingest({...m,channel_id:channel,guild_id:config.guildId});}
        catch(e){console.error('Existing script refresh failed',m.id,e.message);}
      }
      const fresh=rows.filter(m=>BigInt(m.id)>BigInt(cursor));all.push(...fresh);
      if(rows.length<100||fresh.length<rows.length)break;
      if(page===19)throw Error('Scripts backlog exceeds 2000 messages; cursor preserved for review.');
      before=rows.at(-1).id;
    }
    all.sort((a,b)=>BigInt(a.id)<BigInt(b.id)?-1:1);
    for(const m of all) {await ingest({...m,channel_id:channel,guild_id:config.guildId});db.prepare('INSERT INTO resources VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET discord_id=excluded.discord_id,updated_at=excluded.updated_at').run(cursorKey,m.id,new Date(now).toISOString());}
    }
  }
  function reports(now=Date.now()) {
    const r=resourceMap();if(!r.channel_staff_reviews||!r.role_staff)return;
    for(const c of db.prepare("SELECT * FROM creators WHERE cohort='new' AND trial_ends_at IS NOT NULL AND trial_completed_at IS NULL AND stage NOT IN ('removed','removal_due')").all()) {
      if(Date.parse(c.trial_ends_at)-flow.DAY>now||db.prepare('SELECT 1 FROM trial_reports WHERE creator_id=? AND trial_end=?').get(c.discord_user_id,c.trial_ends_at))continue;
      if(!r.user_reviewer_blazie)throw Error('Configure Judy before trial reports can be sent.');
      const payload={...trialReport(db,c,now),content:`<@${r.user_reviewer_blazie}> <@&${r.role_staff}>`,allowed_mentions:{parse:[],users:[r.user_reviewer_blazie],roles:[r.role_staff]},approval_creator_id:c.discord_user_id};
      db.exec('BEGIN IMMEDIATE');try {db.prepare('INSERT INTO trial_reports VALUES (?,?,?,?)').run(c.discord_user_id,c.trial_ends_at,JSON.stringify(payload),new Date(now).toISOString());enqueue(`trial-report:${c.discord_user_id}:${c.trial_ends_at}`,r.channel_staff_reviews,payload);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
    }
  }
  return {decorate,ingest,ingestNonTalking,poll,reports,reconcile,setRoles};
}
