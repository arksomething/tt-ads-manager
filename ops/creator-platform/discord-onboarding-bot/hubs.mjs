import * as flow from './flow.mjs';

const button=(id,label,style=2,disabled=false)=>({type:2,style,label,custom_id:`gt:${id}`,disabled});
const row=(...components)=>({type:1,components});
const safe=flow.markdown;
const stamp=value=>value&&Number.isFinite(Date.parse(value))?`<t:${Math.floor(Date.parse(value)/1000)}:f>`:'Not checked yet';
export const hubCommands=['posts','payments'].map(name=>({name,description:name==='posts'?'See your published posts, links and tracking status':'See your monthly statement, payment status and saved method',options:[{name:'month',description:'Month to view, e.g. 2026-09 (defaults to this month)',type:3,required:false,min_length:7,max_length:7},{name:'source',description:'Metrics source to display',type:3,required:false,choices:[{name:'viral.app',value:'viral'},{name:'New tracker',value:'tracker'},{name:'Submitted links',value:'submitted'}]}]})).map(command=>command.name==='payments'?{...command,description:'See earned compensation and update payment details',options:command.options.filter(option=>option.name!=='source')}:command);

export function migrateHubs(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS creator_earnings (creator_id TEXT NOT NULL,month TEXT NOT NULL,state TEXT NOT NULL,request_id TEXT NOT NULL,payload_json TEXT,error TEXT,requested_at TEXT NOT NULL,PRIMARY KEY(creator_id,month));
    CREATE TABLE IF NOT EXISTS creator_earnings_audits (audit_id TEXT PRIMARY KEY,creator_id TEXT NOT NULL,month TEXT NOT NULL,request_id TEXT NOT NULL UNIQUE,payload_json TEXT NOT NULL,sha256 TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE TRIGGER IF NOT EXISTS immutable_earnings_audit_update BEFORE UPDATE ON creator_earnings_audits BEGIN SELECT RAISE(ABORT,'Calculation audits are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS immutable_earnings_audit_delete BEFORE DELETE ON creator_earnings_audits BEGIN SELECT RAISE(ABORT,'Calculation audits are immutable'); END;
    CREATE TABLE IF NOT EXISTS creator_hub_payout_sync (creator_id TEXT PRIMARY KEY,checked_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS creator_hub_payout_records (
      creator_id TEXT NOT NULL,record_id TEXT NOT NULL,amount_cents INTEGER NOT NULL,currency TEXT NOT NULL,
      status TEXT NOT NULL,payout_date TEXT,updated_at TEXT,PRIMARY KEY(creator_id,record_id)
    );
    CREATE TABLE IF NOT EXISTS creator_hub_sources (
      creator_id TEXT PRIMARY KEY, preferred TEXT NOT NULL DEFAULT 'viral', accounts_json TEXT NOT NULL,
      preview_label TEXT, refreshed_at INTEGER, coverage_json TEXT
    );
    CREATE TABLE IF NOT EXISTS creator_hub_metrics (
      creator_id TEXT NOT NULL, provider TEXT NOT NULL, platform TEXT NOT NULL, video_id TEXT NOT NULL,
      url TEXT NOT NULL,title TEXT,published_at INTEGER NOT NULL,views INTEGER,observed_at INTEGER,
      adapter TEXT,availability TEXT,handle TEXT,
      PRIMARY KEY(creator_id,provider,platform,video_id)
    );
    CREATE TABLE IF NOT EXISTS creator_post_meta (
      video_key TEXT PRIMARY KEY REFERENCES creator_posts(video_key) ON DELETE CASCADE,
      submission_id TEXT NOT NULL, title TEXT, views INTEGER, last_checked_at TEXT,
      tracking_status TEXT NOT NULL DEFAULT 'pending', sample_label TEXT
    );
    CREATE TABLE IF NOT EXISTS creator_statements (
      creator_id TEXT NOT NULL, month TEXT NOT NULL, currency TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('draft','approved','processing','paid','failed')),
      items_json TEXT NOT NULL, paid_cents INTEGER NOT NULL DEFAULT 0 CHECK(paid_cents>=0),
      updated_at TEXT NOT NULL, paid_at TEXT, expected_date TEXT, note TEXT, sample_label TEXT,
      PRIMARY KEY(creator_id,month)
    );
    CREATE TABLE IF NOT EXISTS creator_hub_issues (
      id TEXT PRIMARY KEY, creator_id TEXT NOT NULL, kind TEXT NOT NULL, month TEXT NOT NULL,
      details TEXT NOT NULL, created_at TEXT NOT NULL, resolved_at TEXT, resolution TEXT
    );
  `);
}
export function monthKey(input,c={},now=new Date()) {
  if(input) {
    if(!/^20\d{2}-(0[1-9]|1[0-2])$/u.test(input))throw Error('Use a month like 2026-09.');
    return input;
  }
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:c.timezone||'UTC',year:'numeric',month:'2-digit'}).formatToParts(now);
  return `${parts.find(p=>p.type==='year').value}-${parts.find(p=>p.type==='month').value}`;
}
export function shiftMonth(month,delta) {
  const d=new Date(`${month}-15T12:00:00Z`);d.setUTCMonth(d.getUTCMonth()+delta);return d.toISOString().slice(0,7);
}
const monthName=m=>new Intl.DateTimeFormat('en-US',{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(`${m}-15T12:00:00Z`));
const money=(n,currency)=>new Intl.NumberFormat('en-US',{style:'currency',currency}).format(n/100);
const sourceLink=(url,label)=>{try {const u=new URL(url);return u.protocol==='https:'?`[${label}](<${u.href}>)`:label;}catch{return label;}};
const platform=p=>p.video_key.startsWith('instagram:')?'Instagram':p.video_key.startsWith('tiktok:')?'TikTok':'Post';
function issues(db,c,kind,month) {
  const pending=db.prepare('SELECT id FROM creator_hub_issues WHERE creator_id=? AND kind=? AND month=? AND resolved_at IS NULL').all(c.discord_user_id,kind,month);
  return pending.length?'\n\n**Support:** Your report is with the managers. You’ll be notified here when they respond.':'';
}
const sourceNames={viral:'viral.app',tracker:'New tracker',submitted:'Submitted links'};
export function hubSource(db,c,source) {
  const config=db.prepare('SELECT * FROM creator_hub_sources WHERE creator_id=?').get(c.discord_user_id);
  source=source||config?.preferred||'submitted';
  if(!Object.hasOwn(sourceNames,source))throw Error('Choose viral.app, New tracker or Submitted links.');
  return {source,config};
}
function sourceRows(db,c,source,month) {
  return db.prepare('SELECT * FROM creator_hub_metrics WHERE creator_id=? AND provider=? ORDER BY published_at DESC,video_id').all(c.discord_user_id,source)
    .filter(m=>monthKey(null,c,new Date(m.published_at))===month);
}
function sourceInfo(db,c,source,config,month) {
  if(source==='submitted')return '';
  const data=sourceRows(db,c,source,month),latest=Math.max(0,...data.map(m=>m.observed_at||0));
  return `**Metrics source: ${sourceNames[source]}**${config?.preview_label?` · Preview account: ${safe(config.preview_label)}`:''}\n${data.length} observed platform posts · Latest observation: ${latest?stamp(new Date(latest).toISOString()):'Unavailable'}\nCache refreshed: ${config?.refreshed_at?stamp(new Date(config.refreshed_at).toISOString()):'Waiting for connection'}\n${source==='viral'?'Uses the existing viral.app reconciliation feed.':'Uses only observations from the new tracker; viral.app data is not substituted.'}\n`;
}
function sourceButtons(kind,month) {
  return row(button(`source_${kind}:${month}${kind==='posts'?':0':''}:viral`,'viral.app'),button(`source_${kind}:${month}${kind==='posts'?':0':''}:tracker`,'New tracker'),button(`source_${kind}:${month}${kind==='posts'?':0':''}:submitted`,'Submitted links'));
}
export function postsCard(db,c,resources={},month,page=0,source) {
  month=monthKey(month,c);
  const selected=hubSource(db,c,source);source=selected.source;
  if(!Number.isInteger(page)||page<0)throw Error('Invalid post page.');
  let posts=db.prepare(`SELECT p.*,m.submission_id,m.title,m.views,m.last_checked_at,m.tracking_status,m.sample_label
    FROM creator_posts p LEFT JOIN creator_post_meta m ON m.video_key=p.video_key
    WHERE p.creator_id=? ORDER BY p.submitted_at DESC,p.video_key`).all(c.discord_user_id)
    .filter(p=>monthKey(null,c,new Date(p.submitted_at))===month);
  if(source!=='submitted')posts=sourceRows(db,c,source,month).map(m=>({
    video_key:`${m.platform}:${m.video_id}`,submission_id:`${m.platform}:${m.video_id}`,url:m.url,
    title:`@${m.handle} · ${(m.title||'Published post').slice(0,65)}`,views:m.views,
    last_checked_at:m.observed_at?new Date(m.observed_at).toISOString():null,
    tracking_status:m.views===null?'pending':m.availability==='private'?'private':m.availability==='unavailable'?'unavailable':'ok'
  }));
  const groups=new Map();
  for(const p of posts){const key=p.submission_id||p.video_key;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(p);}
  const list=[...groups.values()],pages=Math.max(1,Math.ceil(list.length/4));page=Math.min(page,pages-1);
  const fields=list.slice(page*4,page*4+4).map((group,index)=>{
    const platforms=group.map(platform),missing=['TikTok','Instagram'].filter(p=>!platforms.includes(p));
    const lines=group.map(p=>`${sourceLink(p.url,platform(p))} · ${p.views===null||p.views===undefined?'Views unavailable':`${Number(p.views).toLocaleString('en-US')} views`}\n${({ok:'Tracking updated',private:'Account private — check your settings',unavailable:'Account unavailable — contact your manager',pending:'Recorded · awaiting tracker update'})[p.tracking_status]||'Recorded · awaiting tracker update'} · ${stamp(p.last_checked_at)}${p.last_checked_at&&Date.now()-Date.parse(p.last_checked_at)>48*3600000?' · Snapshot older than 48 hours':''}`);
    if(source==='submitted'&&missing.length)lines.push(`**Missing:** ${missing.join(' and ')} link. Use **Report a problem** to supply or correct it.`);
    return {name:`${page*4+index+1}. ${safe(group[0].title||'Published video',90)}`,value:lines.join('\n')};
  });
  const samples=[...new Set(posts.map(p=>p.sample_label).filter(Boolean))];
  const description=`**${monthName(month)}** · ${list.length} recorded video${list.length===1?'':'s'} · ${posts.length} platform link${posts.length===1?'':'s'}\n${source==='submitted'?'Grouped by submission and recorded month':'Listed by publication month; cross-platform posts are separate observations'} (${safe(c.timezone||'UTC')}).\n\n${sourceInfo(db,c,source,selected.config,month)}\n${posts.length?'Tracking views are snapshots, not confirmed payable views. Missing data does not mean zero views.':source==='submitted'?'No published links recorded for this month. Use **Submitted post** after publishing your approved video.':'No observations from this source for this month. Try another month or source. This does not mean there are no posts.'}${samples.length?`\n\n**Sample data:** ${safe(samples.join(', '),150)}. View counts and tracking states are simulated.`:''}${issues(db,c,'posts',month)}`;
  return {...flow.card('🎬 Your posts',description,0x8b9c87,fields),allowed_mentions:{parse:[]},components:[row(button(`posts:${month}:${page-1}:${source}`,'Previous page',2,page===0),button(`posts:${month}:${page+1}:${source}`,'Next page',2,page+1>=pages),button(`posts:${month}:${page}:${source}`,'Refresh')),row(button(`posts:${shiftMonth(month,-1)}:0:${source}`,'Previous month'),button(`posts:${shiftMonth(month,1)}:0:${source}`,'Next month'),button('post','Submitted post',1)),row(button(`hub_issue:posts:${month}`,'Report a problem'),button(`payments:${month}:${source}`,'Payments')),sourceButtons('posts',month)]};
}

export function statementAmounts(s) {
  const items=JSON.parse(s.items_json);
  if(!Array.isArray(items)||items.length>20||!items.every(i=>typeof i.label==='string'&&Number.isSafeInteger(i.amount_cents)))throw Error('The statement needs a manager to check its line items.');
  const total=items.reduce((sum,i)=>sum+i.amount_cents,0);
  if(!Number.isSafeInteger(total)||total<0||!Number.isSafeInteger(s.paid_cents)||s.paid_cents>total)throw Error('The statement totals need a manager to check them.');
  return {items,total,outstanding:total-s.paid_cents};
}
export function requestEarnings(db,c,month){
 month=monthKey(month,c);
 if(month>new Date().toISOString().slice(0,7))return;
 if(!db.prepare('SELECT 1 FROM creator_deal_bindings WHERE creator_id=?').get(c.discord_user_id))return;
 const prior=db.prepare('SELECT * FROM creator_earnings WHERE creator_id=? AND month=?').get(c.discord_user_id,month);
 if(prior?.state==='pending'||(prior?.state==='ready'&&Date.now()-Date.parse(prior.payload_json?JSON.parse(prior.payload_json).calculated_at:prior.requested_at)<60000))return;
 const now=new Date().toISOString();
 db.prepare("INSERT INTO creator_earnings(creator_id,month,state,request_id,requested_at) VALUES (?,?,'pending',?,?) ON CONFLICT(creator_id,month) DO UPDATE SET state='pending',request_id=excluded.request_id,requested_at=excluded.requested_at,error=NULL").run(c.discord_user_id,month,`${c.discord_user_id}:${month}:${now}`,now);
}
export function earningsBreakdown(db,c,month){
 month=monthKey(month,c);
 const row=db.prepare('SELECT payload_json FROM creator_earnings WHERE creator_id=? AND month=?').get(c.discord_user_id,month);
 const data=row?.payload_json?JSON.parse(row.payload_json):null;
 const description=data?`**${monthName(month)}** · ${data.mode==='gained'?'Views gained during this month':'Videos posted during this month'}\nDeal-specific counting windows, rates and caps apply.\n\n${data.warnings?.length?data.warnings.map(w=>`• ${safe(w,500)}`).join('\n'):'No source warnings.'}\n\nCalculated ${stamp(data.calculated_at)}.\nThis is earned compensation, not a record of transfers.`:'No calculation is available yet. Open Payments and choose Refresh.';
 return {...flow.card('Calculation details',description.slice(0,3900)),allowed_mentions:{parse:[]},components:[row(button(`payments:${month}`,'Payments'))]};
}
export function paymentsCard(db,c,resources={},month,source) {
  month=monthKey(month,c);
  const selected=hubSource(db,c,source);source=selected.source;
  let statement=db.prepare('SELECT * FROM creator_statements WHERE creator_id=? AND month=?').get(c.discord_user_id,month);
  if(selected.config&&statement?.sample_label)statement=null;
  const base=flow.paymentCard(c,resources),saved=JSON.parse(c.payment_details||'null');
  const earnings=db.prepare('SELECT * FROM creator_earnings WHERE creator_id=? AND month=?').get(c.discord_user_id,month);
  const calculation=earnings?.payload_json?JSON.parse(earnings.payload_json):null;
  let summary=earnings?.state==='pending'?'**Calculating your earnings…**\nChoose Refresh shortly to see the result.':earnings?.error?`**Calculation unavailable**\n${safe(earnings.error,200)}\nChoose Refresh to retry.`:'**Earnings: Not calculated yet**\nChoose Refresh to calculate this month’s payout.';
  if(statement) {
    const {items,total}=statementAmounts(statement),draft=statement.status==='draft';
    summary=`**${draft?'Estimated earnings':'Approved payout'}: ${money(total,statement.currency)}**${draft?'\nPending confirmation':''}\n\n**Breakdown**\n${items.map(i=>`• ${safe(i.label,100)}: ${money(i.amount_cents,statement.currency)}`).join('\n')}\n\nUpdated ${stamp(statement.updated_at)}${statement.sample_label?'\nSample statement: amounts are simulated.':''}`;
  }
  if(calculation&&(!statement||statement.status==='draft')){
    const s=calculation.summary,currency=calculation.creators?.[0]?.currency||'USD',pending=s.unknownPaidVideos||0;
    summary=`**Estimated payout: ${money(Math.round(s.totalPay*100),currency)}**\n${calculation.start_date} – ${calculation.end_date}\n\n**Breakdown**\nPer-video fees: ${money(Math.round(s.videoFixedPay*100),currency)}\nView earnings: ${money(Math.round(s.cpmPay*100),currency)}${s.fixedPay?`\nFixed fees: ${money(Math.round(s.fixedPay*100),currency)}`:''}\n${s.videos} videos · ${Number(s.payableViews).toLocaleString('en-US')} payable views\n\n${pending?`Paid-view checks are pending for ${pending} videos. The estimate may change.\n`:''}${calculation.warnings?.some(w=>!/paid traffic matching/i.test(w))?'Some source data may be incomplete; see Calculation details.\n':''}Calculated ${stamp(calculation.calculated_at)}.${earnings.state==='pending'?'\nUpdating the calculation… Refresh shortly.':earnings.error?'\nThe latest refresh failed; this is the previous calculation.':''}`;
  }
  const method={wise:'Wise',paypal:'PayPal',bank:'Bank transfer'}[saved?.method]||'Not selected';
  const contact=resources.role_staff?`<@&${resources.role_staff}>`:'your managers';
  const linked=db.prepare('SELECT display_name FROM creator_deal_bindings WHERE creator_id=?').get(c.discord_user_id);
  base.embeds[0].description=`**${monthName(month)}**${linked?` · ${safe(linked.display_name)}`:''}\n${summary}\n\n**Payment method:** ${method} · ${safe(saved?.currency||'USD')}\nUpdate your details below.\n\nPayments typically happen after month-end. Contact ${contact} here for help.${issues(db,c,'payments',month)}`;
  base.components=[row(button(`payments:${shiftMonth(month,-1)}:${source}`,'Previous month'),button(`payments:${shiftMonth(month,1)}:${source}`,'Next month',2,month>=new Date().toISOString().slice(0,7)),button(`payments:${month}:${source}`,'Refresh')),row(button(`audit_log:${month}`,'Audit log'),...(calculation?.audit_id?[button(`audit_pdf:${calculation.audit_id}`,'Download PDF')]:[]),button(`earnings_details:${month}`,'Calculation details'),button('my_deal','My deal'),button(`hub_issue:payments:${month}`,'Report a problem')),base.components[0]];
  return base;
}
