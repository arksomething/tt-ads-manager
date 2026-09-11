import * as flow from './flow.mjs';

const arg=(name,description,type=3,required=true,extra={})=>({name,description,type,required,...extra});
const creator=()=>arg('creator','Select the creator to manage; this never defaults to the admin’s own account.',6);
const reason=()=>arg('reason','Explain the decision clearly; account-change and leave reasons are shown to the creator.',3,true,{max_length:500});
const page=()=>arg('page','Page number, starting at 1. Results are limited to 10 per page.',4,false,{min_value:1,max_value:10000});
const sub=(name,description,options=[])=>({type:1,name,description,options});
export const adminCommand={name:'creator',description:'Manage GoTall creators: reviews, agreements, trial, leave, history and recovery.',default_member_permissions:'32',options:[
  sub('deal','View or edit a creator’s complete deal and version history.',[creator()]),
  sub('help','Read the staff command guide, permissions, stage rules and available actions.'),
  sub('list','Find creators needing account review, trial review, leave decisions or sync recovery.',[
    arg('queue','Choose a work queue; defaults to all creators.',3,false,{choices:[['All creators','all'],['Account review','accounts'],['Trial review due','trials'],['Pending time off','leave'],['At Risk','risk'],['Sync pending','sync']].map(([name,value])=>({name,value}))}),page()]),
  sub('status','Inspect a creator’s current stage, deadlines, pending leave and channel link.',[creator()]),
  sub('posts','List submitted video links for manual review; does not verify content or views.',[creator(),page()]),
  sub('history','Review who changed this creator’s flow and when, plus staff notes.',[creator(),page()]),
  sub('note','Save a private staff note; does not message the creator or change their stage.',[creator(),arg('text','Internal note. Do not include passwords, tokens or unnecessary personal information.',3,true,{max_length:500})]),
  sub('approve-account','Approve reviewed profiles and unlock warm-up; does not start the trial.',[creator()]),
  sub('request-changes','Return accounts to setup and show the creator exactly what needs correcting.',[creator(),reason()]),
  sub('attach-agreement','Save the creator-specific signing URL after warm-up approval; does not send it yet.',[creator(),arg('url','Full HTTPS signing URL for this creator. Run send-agreement after attaching it.',3,true,{max_length:500})]),
  sub('send-agreement','Send the Jotform agreement after staff warm-up approval.',[creator()]),
  sub('trial','Pass an ended trial or extend its deadline by three days; no stage skipping.',[creator(),arg('decision','Pass requires a verified agreement and an elapsed trial deadline.',3,true,{choices:[{name:'Pass completed trial',value:'pass'},{name:'Extend trial by three days',value:'extend'}]})]),
  sub('approve-leave','Pause checks for 1–30 days from now; request dates are not applied automatically.',[creator(),arg('days','Days starting now. Existing later expiry is preserved; this does not schedule future leave.',4,true,{min_value:1,max_value:30}),reason()]),
  sub('decline-leave','Decline a pending request and send the reason; waiting days remain protected.',[creator(),reason()]),
  sub('reopen','Restart a closed creator at account setup; clears approval, agreement and trial dates.',[creator(),arg('confirm','Set true to acknowledge the reset. Previous post history is retained.',5)]),
  sub('retry','Retry this creator’s status, channel and role sync without changing their stage.',[creator()]),
  sub('preview','Preview inactivity and trial deadlines up to 30 days ahead without changing anything.',[creator(),arg('days','Days ahead to preview. This does not move the clock or simulate a signature.',4,true,{min_value:0,max_value:30})]),
  sub('health','Show pending syncs and message deliveries; does not inspect or expose credentials.'),
]};

export function adminHelp() {
  return flow.card('GoTall staff command guide',
    '**Start here:** `/creator list` finds work; `/creator status creator:@name` shows the current step. Select the creator explicitly for every individual action.\n\n'+
    '**Deals**\n`/creator deal creator:@name` opens a summary with Full terms and History. Choose Edit deal, review the changes and effective date, then publish. A Live deal card updates the named creator’s real calculator deal; sandbox cards stay local.\n\n'+
    '**Accounts and agreements**\n`approve-account` after checking profiles, or `request-changes reason:…` to return them to setup. Use Staff controls for warm-up approval, then `send-agreement`. Staff controls also verify signing, review first videos and open the Hub. There is no force-stage or force-sign command.\n\n'+
    '**Posting and trial**\n`posts` lists submissions. Use `/video-check` to record a manual assessment and estimate. `trial decision:pass` requires the deadline to have elapsed; `extend` adds three days.\n\n'+
    '**Time off**\n`approve-leave days:… reason:…` starts now, not on dates written in the request. `decline-leave` requires a pending request. Waiting days remain protected.\n\n'+
    '**Records and recovery**\n`history` shows actions and notes; `note` is staff-only. `health` and the sync queue expose pending work. `retry` attempts the selected creator’s sync. `reopen confirm:true` resets a closed creator’s onboarding but retains post history. `preview` changes nothing.\n\n'+
    '**Access and limits**\nServer-only; replies are private. Owner, Administrator, Manage Server or GoTall Staff is required at execution. Discord initially exposes `/creator` to Manage Server/admins; grant GoTall Staff access in Server Settings → Integrations → this app → Commands.\n\n'+
    '**Verification:** signing and video checks currently require staff review. Check status/history before retrying an action that timed out.');
}

export async function handleAdminCommand(config,db,i,w) {
  if(config.guildId!==flow.TEST_GUILD_ID || !config.testMode || i.guild_id!==config.guildId)throw Error('Management commands are restricted to the configured server.');
  if(!w.staff(i))throw Error('GoTall staff access is required. Ask an admin to assign GoTall Staff or Manage Server.');
  const command=i.data?.options?.[0];
  const name=command?.name, v=Object.fromEntries((command?.options??[]).map(o=>[o.name,o.value]));
  if(!adminCommand.options.some(s=>s.name===name))throw Error('Unknown management command. Use /creator help.');
  const reply=data=>w.reply(i,data);
  const pageNumber=v.page??1;
  if(!Number.isInteger(pageNumber)||pageNumber<1||pageNumber>10000)throw Error('Page must be an integer from 1 to 10000.');
  const offset=(pageNumber-1)*10;
  if(name==='help')return reply(adminHelp());
  if(name==='health') {
    const pending=db.prepare('SELECT COUNT(*) n FROM creators WHERE sync_pending=1').get().n;
    const deliveries=db.prepare('SELECT COUNT(*) n FROM deliveries WHERE message_id IS NULL').get().n;
    return reply(flow.card('Staff work queue',`**Creators awaiting sync:** ${pending}\n**Messages awaiting delivery:** ${deliveries}\n\nUse /creator list queue:sync and /creator retry for a specific creator. Discord rate limits may require waiting; retry does not bypass them.\n\nThis checks saved queue state, not signing providers, video trackers or competing Gateway sessions.`));
  }
  if(name==='list') {
    const filters={all:'1=1',accounts:"stage='account_review'",trials:"stage='trial' AND trial_ends_at IS NOT NULL AND julianday(trial_ends_at)<=julianday('now')",leave:'notice_pending=1',risk:"stage='at_risk'",sync:'sync_pending=1'};
    const filter=filters[v.queue??'all'];if(!filter)throw Error('Choose a valid work queue.');
    const total=db.prepare(`SELECT COUNT(*) n FROM creators WHERE ${filter}`).get().n;
    const rows=db.prepare(`SELECT * FROM creators WHERE ${filter} ORDER BY updated_at,discord_user_id LIMIT 10 OFFSET ?`).all(offset);
    return reply(flow.card(`Creator queue · ${v.queue??'all'}`,`Page ${pageNumber} · ${total} total\n\n`+(rows.map(c=>`**${flow.markdown(c.name,80)}** · ${c.stage}\n<#${c.channel_id}>${c.notice_pending?' · leave pending':''}${c.sync_pending?' · sync pending':''}`).join('\n\n')||'No creators on this page.')+'\n\nRun /creator status with the creator selected before making a decision.'));
  }
  if(typeof v.creator!=='string')throw Error('Select a creator explicitly.');
  const c=db.prepare('SELECT * FROM creators WHERE discord_user_id=?').get(v.creator);
  if(!c)throw Error('This member has no creator application. Ask them to apply in #start-here.');
  if(name==='deal')return w.handle({...i,data:{custom_id:`gt:deal:${c.discord_user_id}:view`}});
  if(name==='status') {
    const panel=flow.staffCard(c,config.testMode);
    // Buttons resolve by channel; outside the creator channel use explicit slash targeting instead.
    if(i.channel_id!==c.channel_id)panel.components=[];
    panel.content=`Creator: <@${c.discord_user_id}> · Stage: **${c.stage}** · <#${c.channel_id}>${c.sync_pending?'\nDiscord sync is pending. The saved stage may be newer than the channel heading.':''}`;
    return reply(panel);
  }
  if(name==='posts') {
    const total=db.prepare('SELECT COUNT(*) n FROM creator_posts WHERE creator_id=?').get(c.discord_user_id).n;
    const rows=db.prepare('SELECT * FROM creator_posts WHERE creator_id=? ORDER BY submitted_at DESC,video_key LIMIT 10 OFFSET ?').all(c.discord_user_id,offset);
    return reply(flow.card('Submitted posts · '+flow.markdown(c.name,80),`Page ${pageNumber} · ${total} total\nLinks are submissions, not verified views or payout approvals.${rows.length?'':'\nNo posts on this page.'}`,0x8b9c87,rows.map(p=>({name:'Submitted '+p.submitted_at,value:p.url}))));
  }
  if(name==='history') {
    const rows=db.prepare(`SELECT actor_id,action,at,NULL note FROM flow_events WHERE creator_id=? UNION ALL SELECT actor_id,'staff note' action,at,note FROM staff_notes WHERE creator_id=? ORDER BY at DESC LIMIT 5 OFFSET ?`).all(c.discord_user_id,c.discord_user_id,(pageNumber-1)*5);
    return reply(flow.card('Staff history · '+flow.markdown(c.name,80),`Page ${pageNumber} · newest first · up to 5 complete records${rows.length?'':'\nNo history on this page.'}`,0x8b9c87,rows.map(r=>({name:r.at+' · '+r.action,value:`${r.actor_id==='scheduler'?'Scheduler':`<@${r.actor_id}>`}${r.note?'\n'+flow.markdown(r.note,500):''}`}))));
  }
  if(name==='note') {
    const note=flow.text(v.text,500);if(!note)throw Error('Enter a staff note.');
    db.prepare('INSERT OR IGNORE INTO staff_notes VALUES (?,?,?,?,?)').run(i.id,c.discord_user_id,i.member.user.id,note,new Date().toISOString());
    return reply('Staff note saved. It is visible in /creator history; no message was sent to the creator.');
  }
  if(name==='retry') {
    await w.sync(c);
    return reply(`Status, channel and roles synchronized for <#${c.channel_id}>. No stage changed. Queued notifications are retried separately by the scheduler.`);
  }
  const actions={'approve-account':'approve_account','request-changes':'changes','attach-agreement':'agreement_link','send-agreement':'send_agreement',trial:v.decision==='pass'?'pass_trial':v.decision==='extend'?'extend_trial':null,'approve-leave':'exception','decline-leave':'deny_leave',reopen:'reopen',preview:'test_clock'};
  const action=actions[name];if(!action)throw Error('Choose a valid command option.');
  if(name==='reopen'&&v.confirm!==true)throw Error('Reopen clears approval, agreement and trial dates. Use confirm:true to acknowledge this reset.');
  if(['request-changes','approve-leave','decline-leave'].includes(name)&&!flow.text(v.reason,500))throw Error('A clear reason is required.');
  if(name==='approve-leave'&&(!Number.isInteger(v.days)||v.days<1||v.days>30))throw Error('Choose 1–30 days starting now.');
  if(name==='preview'&&(!Number.isInteger(v.days)||v.days<0||v.days>30))throw Error('Choose 0–30 days ahead.');
  const fields={reason:v.reason,url:v.url,days:v.days};
  return w.handle({...i,channel_id:c.channel_id,data:{custom_id:`gt:form:${action}`,components:[{components:Object.entries(fields).filter(([,value])=>value!==undefined).map(([custom_id,value])=>({custom_id,value:String(value)}))}]}});
}
