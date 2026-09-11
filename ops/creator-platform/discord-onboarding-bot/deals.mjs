import * as flow from './flow.mjs';
import {randomUUID} from 'node:crypto';
const actor=i=>i.member?.user?.id??i.user?.id;
const button=(id,label,style=2)=>({type:2,style,label,custom_id:`gt:deal:${id}`});
const row=(...components)=>({type:1,components});
const fields={
 rates:[['currency','Currency','USD'],['fixedFee','Fixed fee (optional)','0'],['fixedFeePerVideo','Fee per video (optional)','0'],['cpmAmount','Pay per 1,000 views','1'],['fixedFeeRecognitionDate','Fixed fee recognition date (optional)','YYYY-MM-DD']],
 limits:[['viewWindowDays','View window days (optional)','7'],['viewCapPerVideo','View cap per video (optional)',''],['payoutCapPerVideo','Payout cap per video (optional)','100'],['perVideoCapScope','Cap applies to','View earnings, all earnings, or no cap'],['payoutCapTotal','Total payout cap (optional)','']],
 rules:[['effectiveStartDate','Effective start date','YYYY-MM-DD'],['effectiveEndDate','Effective end date (optional)','YYYY-MM-DD'],['deductPaidTraffic','Exclude paid views?','yes or no'],['paidTrafficMetric','Measure paid traffic using','Impressions or video plays'],['agreementUrl','Full agreement link (optional)','https://...']],
 terms:[['notes','Additional terms and requirements','Posting quota, eligibility, cross-posting, payment timing and other agreed terms.']],
};
export function migrateDeals(db){db.exec(`
 CREATE TABLE IF NOT EXISTS creator_imported_deals (creator_id TEXT NOT NULL,deal_id TEXT NOT NULL,payload_json TEXT NOT NULL,PRIMARY KEY(creator_id,deal_id));
 CREATE TABLE IF NOT EXISTS creator_deal_versions (creator_id TEXT NOT NULL,version INTEGER NOT NULL,payload_json TEXT NOT NULL,actor_id TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(creator_id,version));
 CREATE TABLE IF NOT EXISTS creator_deal_drafts (creator_id TEXT NOT NULL,actor_id TEXT NOT NULL,base_version INTEGER NOT NULL,revision INTEGER NOT NULL,payload_json TEXT NOT NULL,PRIMARY KEY(creator_id,actor_id));
 CREATE TABLE IF NOT EXISTS creator_deal_bindings (creator_id TEXT PRIMARY KEY,campaign_creator_id TEXT NOT NULL,organization_id TEXT NOT NULL,display_name TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS creator_shared_deal_history (creator_id TEXT NOT NULL,version_id TEXT NOT NULL,payload_json TEXT NOT NULL,PRIMARY KEY(creator_id,version_id));
 CREATE TABLE IF NOT EXISTS creator_deal_outbox (id TEXT PRIMARY KEY,creator_id TEXT NOT NULL,campaign_creator_id TEXT NOT NULL,organization_id TEXT NOT NULL,actor_id TEXT NOT NULL,source_deal_id TEXT NOT NULL,expected_version_id TEXT NOT NULL,terms_json TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',result_json TEXT,error TEXT,created_at TEXT NOT NULL,settled INTEGER NOT NULL DEFAULT 0);
 CREATE UNIQUE INDEX IF NOT EXISTS one_pending_deal ON creator_deal_outbox(creator_id) WHERE status='pending';
`);}
function binding(db,c){return db.prepare('SELECT * FROM creator_deal_bindings WHERE creator_id=?').get(c.discord_user_id);}
function latest(db,id){return db.prepare('SELECT * FROM creator_deal_versions WHERE creator_id=? ORDER BY version DESC LIMIT 1').get(id);}
function imported(db,id){return db.prepare('SELECT payload_json FROM creator_imported_deals WHERE creator_id=?').all(id).map(r=>JSON.parse(r.payload_json)).sort((a,b)=>String(b.effectiveStartDate).localeCompare(String(a.effectiveStartDate)));}
function fingerprint(d={}){return JSON.stringify(['id','dealVersionId',...Object.values(fields).flat().map(([k])=>k)].map(k=>[k,d[k]==null?'':k.endsWith('Date')?String(d[k]).slice(0,10):String(d[k])]));}
export function currentDeal(db,c){
 const version=latest(db,c.discord_user_id);
 if(version&&!binding(db,c))return {data:JSON.parse(version.payload_json),version:version.version,source:'Test-server deal',updated:version.created_at};
 const today=new Date().toISOString().slice(0,10),deals=imported(db,c.discord_user_id);
 const linked=binding(db,c),found=deals.find(d=>(!linked||d.campaignCreatorId===linked.campaign_creator_id)&&String(d.effectiveStartDate).slice(0,10)<=today&&(!d.effectiveEndDate||String(d.effectiveEndDate).slice(0,10)>=today));
 return found?{data:found,version:0,source:linked?'Shared calculator deal':'Imported GoTall dashboard deal',updated:found.updatedAt}:null;
}
const display=v=>v===null||v===undefined||v===''?'Not specified':flow.markdown(String(v),1000);
function money(v,d){return v===null||v===undefined||v===''?'Not specified':`${display(v)} ${display(d.currency)}`;}
function render(d){return [
 {name:'Compensation',value:`Currency: ${display(d.currency)}\nFixed fee: ${money(d.fixedFee,d)}\nFixed fee recognition date: ${display(d.fixedFeeRecognitionDate?.slice(0,10))}\nPer-video fee: ${money(d.fixedFeePerVideo,d)}\nCPM (per 1,000 views): ${money(d.cpmAmount,d)}`},
 {name:'Limits & counting',value:`View window: ${d.viewWindowDays??'Not specified'} days\nView cap per video: ${d.viewCapPerVideo??'None specified'}\nPayout cap per video: ${money(d.payoutCapPerVideo,d)}\nCap applies to: ${display(d.perVideoCapScope)}\nTotal payout cap: ${money(d.payoutCapTotal,d)}`},
 {name:'Dates & paid traffic',value:`Effective from: ${display(d.effectiveStartDate?.slice(0,10))}\nEffective until: ${display(d.effectiveEndDate?.slice(0,10))}\nDeduct paid traffic: ${d.deductPaidTraffic===true?'Yes':d.deductPaidTraffic===false?'No':'Not specified'}\nPaid-traffic metric: ${display(d.paidTrafficMetric)}`},
 ];}
export function dealCard(db,c,staff=false,draft=null,expanded=false){
 const current=currentDeal(db,c),d=draft?JSON.parse(draft.payload_json):current?.data;
 const base=`${c.discord_user_id}`;
 const summary=d?[
  d.cpmAmount!=null?`**${money(d.cpmAmount,d)}** / 1,000 views`:null,
  Number(d.fixedFee)?`${money(d.fixedFee,d)} fixed fee`:null,
  Number(d.fixedFeePerVideo)?`${money(d.fixedFeePerVideo,d)} per video`:null,
  d.payoutCapPerVideo!=null&&d.perVideoCapScope!=='NONE'?`${money(d.payoutCapPerVideo,d)} per-video cap${d.perVideoCapScope==='CPM'?' (view earnings)':''}`:null,
  d.payoutCapTotal!=null?`${money(d.payoutCapTotal,d)} total cap`:null,
  `${d.viewWindowDays?`First ${d.viewWindowDays} days`:'View window not set'} · ${d.deductPaidTraffic?'Paid views excluded':'Paid views included'}`,
  `From **${display(d.effectiveStartDate?.slice(0,10))}**${d.effectiveEndDate?` through ${display(d.effectiveEndDate.slice(0,10))}`:''}`
 ].filter(Boolean).join('\n'):'';
 const result=flow.card(draft?'✏️ Review deal draft':expanded?'📄 Full deal':'📄 Your deal',summary,0x8b9c87,expanded&&d?render(d):[]);
 if(draft&&staff){
  const old=JSON.parse(d._baseSource||'{}');
  const changes=Object.values(fields).flat().filter(([key])=>String(old[key]??'')!==String(d[key]??''));
  if(!expanded){
   const lines=changes.map(([key,label])=>key==='notes'||key==='agreementUrl'?`**${label}:** Updated — see Full terms`:`**${label.replace(' (optional)','')}:** ${display(key.endsWith('Date')?old[key]?.slice(0,10):old[key])} → ${display(key.endsWith('Date')?d[key]?.slice(0,10):d[key])}`);
   const chunks=[''];for(const line of lines){if(chunks.at(-1).length+line.length>1000)chunks.push('');chunks[chunks.length-1]+=(chunks.at(-1)?'\n':'')+line;}
   result.embeds[0].fields=chunks.map((value,index)=>({name:index?'More changes':'Changes to publish',value:value||'No changes yet.'}));
  }
  result.embeds[0].description+='\n\nUnpublished · Check the changes and effective date before publishing.';
 }
 if(!d)result.embeds[0].description='No current deal is recorded. Ask a manager to add your terms. No rates or caps are assumed.';
 if(expanded&&d?.notes)result.embeds.push({title:'Additional terms',description:String(d.notes).slice(0,4000)});
 const preview=db.prepare('SELECT preview_label FROM creator_hub_sources WHERE creator_id=?').get(c.discord_user_id)?.preview_label;
 const linked=binding(db,c);
 if(linked)result.embeds[0].description=`**${flow.markdown(linked.display_name)}**\n${result.embeds[0].description}`;
 result.embeds[0].footer={text:linked?'Live deal · Used by the payout calculator':preview?'Sandbox preview · Changes do not affect real payouts':current?`${current.source} · ${current.version?`v${current.version}`:'Source record'}`:'GoTall creators'};
 if(linked&&draft)result.embeds[0].description+='\nPublishing changes this creator’s real deal. Finalized payment amounts stay locked.';
 const pending=db.prepare("SELECT id FROM creator_deal_outbox WHERE creator_id=? AND status='pending'").get(c.discord_user_id);
 if(pending)result.embeds[0].description+='\n\n⏳ Publishing… Refresh this view shortly.';
 const url=d?.agreementUrl||(!preview?c.agreement_url:null);
 if(expanded&&!url&&d)result.embeds[0].description+='\nNo agreement document linked.';
 if(expanded&&url&&/^https:\/\//u.test(url))result.embeds[0].description+=`\n\n[Open full agreement](<${url}>)`;
 result.allowed_mentions={parse:[]};
 result.components=[row(button(`${base}:${expanded?'view':'full'}`,expanded?'Summary':'Full terms'),button(`${base}:history:0`,'History'),...(staff?[button(`${base}:edit`,'Edit deal',1)]:[]))];
 const upcoming=linked?imported(db,base).filter(x=>x.campaignCreatorId===linked.campaign_creator_id&&x.effectiveStartDate.slice(0,10)>new Date().toISOString().slice(0,10)).sort((a,b)=>a.effectiveStartDate.localeCompare(b.effectiveStartDate))[0]:null;
 if(upcoming&&!draft){result.embeds[0].description+=`\n\nScheduled update: **${upcoming.effectiveStartDate.slice(0,10)}**`;result.components[0].components.push(button(`${base}:import:${upcoming.id}`,'Scheduled deal'));}
 if(staff&&draft&&!pending)result.components.push(row(button(`${base}:publish:${draft.revision}`,linked?'Publish real deal':'Publish changes',3),button(`${base}:discard:${draft.revision}`,'Discard draft',2)));
 return result;
}
function date(value,required=false){
 if(!value){if(required)throw Error('An effective start date is required.');return null;}
 if(!/^\d{4}-\d{2}-\d{2}$/u.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value)throw Error('Use a valid date in YYYY-MM-DD format.');return value;
}
export function validateDealSection(section,values){
 if(!fields[section])throw Error('Unknown deal section.');const out={};
 for(const [key] of fields[section]){
  const value=String(values[key]??'').trim();
  if(['fixedFee','fixedFeePerVideo','cpmAmount','payoutCapPerVideo','payoutCapTotal'].includes(key)){
   if(!value){out[key]=null;continue;}if(!/^\d{1,9}(\.\d{1,2})?$/u.test(value))throw Error('Amounts must be non-negative with at most two decimal places.');out[key]=value;
  }else if(['viewWindowDays','viewCapPerVideo'].includes(key)){
   if(!value){out[key]=null;continue;}if(!/^\d+$/u.test(value)||!Number.isSafeInteger(Number(value))||Number(value)<1||Number(value)>2147483647)throw Error('View limits must be positive whole numbers.');out[key]=Number(value);
  }else if(key.endsWith('Date'))out[key]=date(value,key==='effectiveStartDate');
  else if(key==='currency'){if(!/^[A-Z]{3}$/u.test(value.toUpperCase()))throw Error('Use a three-letter currency.');out[key]=value.toUpperCase();}
  else if(key==='perVideoCapScope'){const normalized=({'VIEW EARNINGS':'CPM','ALL EARNINGS':'TOTAL','NO CAP':'NONE'})[value.toUpperCase()]||value.toUpperCase();if(!['CPM','TOTAL','NONE'].includes(normalized))throw Error('Cap scope must be CPM, TOTAL or NONE.');out[key]=normalized;}
  else if(key==='deductPaidTraffic'){if(!['yes','no'].includes(value.toLowerCase()))throw Error('Enter yes or no for paid-traffic deduction.');out[key]=value.toLowerCase()==='yes';}
  else if(key==='paidTrafficMetric'){const normalized=value.toUpperCase()==='VIDEO PLAYS'?'VIDEO_PLAY_ACTIONS':value.toUpperCase();if(!['IMPRESSIONS','VIDEO_PLAY_ACTIONS'].includes(normalized))throw Error('Choose impressions or video plays.');out[key]=normalized;}
  else if(key==='agreementUrl'){if(value&&(!flow.httpsUrl(value)))throw Error('Use a complete HTTPS agreement link.');out[key]=value||null;}
  else {if(value.length>3000)throw Error('Keep additional terms within 3,000 characters, or link the full agreement.');out[key]=value;}
 }
 return out;
}
export function createDeals(db,io){
 function context(i){
  const id=i.data.custom_id.replace(/^gt:(?:form:)?deal:/u,'').split(':')[0];
  const c=db.prepare('SELECT * FROM creators WHERE discord_user_id=?').get(id);
  if(!c)throw Error('Creator not found.');
  if(c.discord_user_id!==actor(i)&&!io.staff(i))throw Error('This is another creator’s deal.');
  return {c,parts:i.data.custom_id.replace(/^gt:(?:form:)?deal:/u,'').split(':'),staff:io.staff(i)};
 }
 function draft(c,i){return db.prepare('SELECT * FROM creator_deal_drafts WHERE creator_id=? AND actor_id=?').get(c.discord_user_id,actor(i));}
 function ensureDraft(c,i,selected=null){
  if(db.prepare("SELECT 1 FROM creator_deal_outbox WHERE creator_id=? AND status='pending'").get(c.discord_user_id))throw Error('A publication is in progress. Wait for its result before editing.');
  let d=draft(c,i);if(selected&&d)throw Error('Finish or discard your current draft before editing the scheduled deal.');
  if(!d){const live=selected?{data:selected,version:0}:currentDeal(db,c),today=new Date().toISOString().slice(0,10);db.prepare('INSERT INTO creator_deal_drafts VALUES (?,?,?,?,?)').run(c.discord_user_id,actor(i),live?.version||0,0,JSON.stringify({...live?.data,...(binding(db,c)?{effectiveStartDate:live?.data.effectiveStartDate?.slice(0,10)>today?live.data.effectiveStartDate.slice(0,10):today}:{}),_draftId:randomUUID(),_baseSource:JSON.stringify(live?.data||{})}));d=draft(c,i);}return d;
 }
 async function open(i){
  const {c,parts,staff}=context(i);if(!staff)throw Error('Only managers can edit deals.');
  const section=parts[1].replace('edit_','');if(!fields[section])throw Error('Unknown deal section.');
  const d=ensureDraft(c,i),values=JSON.parse(d.payload_json);
  const components=fields[section].map(([key,label,placeholder])=>{
   const required=['currency','effectiveStartDate','deductPaidTraffic','perVideoCapScope','paidTrafficMetric'].includes(key);
   const field=flow.formInput(key,label,placeholder,key==='notes'?3000:key==='agreementUrl'?500:100,key==='notes'?2:1,required);
   const raw=values[key];if(raw!==null&&raw!==undefined){const value=key==='deductPaidTraffic'?(raw?'yes':'no'):key==='perVideoCapScope'?({CPM:'View earnings',TOTAL:'All earnings',NONE:'No cap'})[raw]:key==='paidTrafficMetric'?(raw==='VIDEO_PLAY_ACTIONS'?'Video plays':'Impressions'):key.endsWith('Date')?String(raw).slice(0,10):String(raw);if(value.length>field.component.max_length)throw Error('This source text is too long for this form. Use the full agreement link.');field.component.value=value;}return field;
  });
  return io.modal(i,{type:9,data:{title:'Edit deal · '+section,custom_id:`gt:form:deal:${c.discord_user_id}:save_${section}:${d.revision}`,components}});
 }
 async function handle(i){
  const {c,parts,staff}=context(i),action=parts[1],revision=Number(parts[2]);
  if(action==='view'||action==='full')return io.reply(i,dealCard(db,c,staff,staff?draft(c,i):null,action==='full'));
  if(action==='change'){
   if(!staff)throw Error('Only managers can edit deals.');
   const selected=imported(db,c.discord_user_id).find(d=>d.id===parts[2]&&d.campaignCreatorId===binding(db,c)?.campaign_creator_id&&d.effectiveStartDate.slice(0,10)>=new Date().toISOString().slice(0,10));
   if(!selected)throw Error('Reopen the scheduled deal.');
   return io.reply(i,dealCard(db,c,true,ensureDraft(c,i,selected)));
  }
  if(action==='edit'){
   if(!staff)throw Error('Only managers can edit deals.');
   const saved=ensureDraft(c,i),card=flow.card('Edit deal','Choose what to change. You’ll review everything before publishing.');
   card.components=[row(...Object.keys(fields).map(section=>button(`${c.discord_user_id}:edit_${section}:${saved.revision}`,{rates:'Pay & rates',limits:'Caps & limits',rules:'Dates & counting',terms:'Written terms'}[section]))),row(button(`${c.discord_user_id}:view`,'Review draft',1))];
   return io.reply(i,card);
  }
  if(action==='history'){
   const versions=db.prepare('SELECT version,created_at,actor_id FROM creator_deal_versions WHERE creator_id=? ORDER BY version DESC').all(c.discord_user_id);
   const shared=db.prepare('SELECT * FROM creator_shared_deal_history WHERE creator_id=?').all(c.discord_user_id).map(r=>({...r,data:JSON.parse(r.payload_json)})).sort((a,b)=>String(b.data.createdAt).localeCompare(String(a.data.createdAt)));
   const records=shared.length?shared.map(r=>({action:`shared:${r.version_id}`,label:`${String(r.data.terms.effectiveStartDate).slice(0,10)} · v${r.data.revision}`,text:`**${String(r.data.terms.effectiveStartDate).slice(0,10)}** · v${r.data.revision} · ${flow.markdown(r.data.actor)}`})):[...versions.map(v=>({action:`version:${v.version}`,label:`Version ${v.version}`,text:`Version ${v.version} · ${v.created_at.slice(0,10)} · <@${v.actor_id}>`})),...imported(db,c.discord_user_id).map(d=>({action:`import:${d.id}`,label:`Source ${String(d.effectiveStartDate).slice(0,10)}`,text:`Imported · ${String(d.effectiveStartDate).slice(0,10)} → ${d.effectiveEndDate?String(d.effectiveEndDate).slice(0,10):'No end date'}`}))];
   if(!Number.isInteger(revision)||revision<0)throw Error('Invalid history page.');
   const page=Math.min(revision,Math.max(0,Math.ceil(records.length/4)-1)),visible=records.slice(page*4,page*4+4);
   const card=flow.card('Deal history',visible.map(v=>v.text).join('\n')||'No deal history yet.');
   card.allowed_mentions={parse:[]};card.components=[];
   if(visible.length)card.components.push(row(...visible.map(v=>button(`${c.discord_user_id}:${v.action}`,v.label))));
   card.components.push(row(...(page>0?[button(`${c.discord_user_id}:history:${page-1}`,'Previous')]:[]),button(`${c.discord_user_id}:view`,'Current deal'),...(page*4+4<records.length?[button(`${c.discord_user_id}:history:${page+1}`,'Next')]:[])));
   return io.reply(i,card);
  }
  if(action==='import'){
   const r=db.prepare('SELECT payload_json FROM creator_imported_deals WHERE creator_id=? AND deal_id=?').get(c.discord_user_id,parts[2]);if(!r)throw Error('Source deal not found.');
   const source=JSON.parse(r.payload_json),scheduled=source.effectiveStartDate.slice(0,10)>new Date().toISOString().slice(0,10);
   const card=dealCard(db,c,false,{payload_json:r.payload_json},true);card.embeds[0].title=scheduled?'Scheduled deal':'Imported deal history';card.embeds[0].description=scheduled?`Takes effect **${source.effectiveStartDate.slice(0,10)}**`:'Historical source record. These terms may no longer be current.';
   if(scheduled&&staff)card.components.push(row(button(`${c.discord_user_id}:change:${source.id}`,'Edit scheduled deal',1)));return io.reply(i,card);
  }
  if(action==='shared'){
   const r=db.prepare('SELECT payload_json FROM creator_shared_deal_history WHERE creator_id=? AND version_id=?').get(c.discord_user_id,parts[2]);if(!r)throw Error('Version not found.');
   const v=JSON.parse(r.payload_json),card=dealCard(db,c,false,{payload_json:JSON.stringify(v.terms)},true);card.embeds[0].title=`Deal history · v${v.revision}`;card.embeds[0].description=`Published ${v.createdAt.slice(0,10)} · Historical terms`;return io.reply(i,card);
  }
  if(action==='version'){
   const v=db.prepare('SELECT * FROM creator_deal_versions WHERE creator_id=? AND version=?').get(c.discord_user_id,revision);if(!v)throw Error('Version not found.');
   const card=dealCard(db,c,false,{...v,payload_json:v.payload_json},true);card.embeds[0].title=`Deal · version ${revision}`;card.embeds[0].description=`Published ${v.created_at}. Historical terms; these may no longer be current.`;return io.reply(i,card);
  }
  if(!staff)throw Error('Only managers can edit deals.');
  if(db.prepare("SELECT 1 FROM creator_deal_outbox WHERE creator_id=? AND status='pending'").get(c.discord_user_id))throw Error('A publication is in progress. Wait for its result before editing.');
  const d=draft(c,i);if(!d||d.revision!==revision)throw Error('This draft changed. Reopen the deal before editing or publishing.');
  if(action==='discard'){db.prepare('DELETE FROM creator_deal_drafts WHERE creator_id=? AND actor_id=?').run(c.discord_user_id,actor(i));return io.reply(i,dealCard(db,c,true));}
  if(action.startsWith('save_')){
   const patch=validateDealSection(action.slice(5),flow.modalValues(i));
   db.prepare('UPDATE creator_deal_drafts SET payload_json=?,revision=revision+1 WHERE creator_id=? AND actor_id=? AND revision=?').run(JSON.stringify({...JSON.parse(d.payload_json),...patch}),c.discord_user_id,actor(i),revision);
   return io.reply(i,dealCard(db,c,true,draft(c,i)));
  }
  if(action!=='publish')throw Error('Unknown deal action.');
  const terms=JSON.parse(d.payload_json);
  const draftId=terms._draftId;delete terms._draftId;
  const baseSource=terms._baseSource;delete terms._baseSource;
  const comparison=binding(db,c)?imported(db,c.discord_user_id).find(x=>x.id===JSON.parse(baseSource||'{}').id):currentDeal(db,c)?.data;
  if(d.base_version===0&&fingerprint(comparison)!==fingerprint(JSON.parse(baseSource||'{}')))throw Error('The imported deal changed. Discard this draft and reopen the current deal.');
  if(!terms.currency||!terms.effectiveStartDate||typeof terms.deductPaidTraffic!=='boolean'||!terms.perVideoCapScope||!terms.paidTrafficMetric)throw Error('Complete rates, limits, and dates/rules before publishing.');
  if(terms.cpmAmount==null&&terms.fixedFee==null&&terms.fixedFeePerVideo==null)throw Error('Set at least one compensation amount.');
  if(terms.effectiveEndDate&&terms.effectiveEndDate.slice(0,10)<terms.effectiveStartDate.slice(0,10))throw Error('End date cannot be before start date.');
  const linked=binding(db,c);
  if(linked){
   const source=JSON.parse(baseSource||'{}');
   if(!source.dealVersionId||source.campaignCreatorId!==linked.campaign_creator_id)throw Error('Refresh the shared deal before publishing.');
   if(terms.effectiveStartDate.slice(0,10)<new Date().toISOString().slice(0,10))throw Error('Choose today or a future effective date.');
   const requestId=`discord-deal:${c.discord_user_id}:${draftId||i.id}:${revision}`;
   db.prepare('INSERT OR IGNORE INTO creator_deal_outbox(id,creator_id,campaign_creator_id,organization_id,actor_id,source_deal_id,expected_version_id,terms_json,created_at) VALUES (?,?,?,?,?,?,?,?,?)').run(requestId,c.discord_user_id,linked.campaign_creator_id,linked.organization_id,actor(i),source.id,source.dealVersionId,JSON.stringify(terms),new Date().toISOString());
   return io.reply(i,dealCard(db,c,true,d));
  }
  db.exec('BEGIN IMMEDIATE');
  try{
   const version=latest(db,c.discord_user_id)?.version||0;if(version!==d.base_version)throw Error('Another manager published a newer deal. Discard this draft and start from the current version.');
   db.prepare('INSERT INTO creator_deal_versions VALUES (?,?,?,?,?)').run(c.discord_user_id,version+1,JSON.stringify(terms),actor(i),new Date().toISOString());
   db.prepare('DELETE FROM creator_deal_drafts WHERE creator_id=? AND actor_id=?').run(c.discord_user_id,actor(i));
   db.prepare('INSERT INTO flow_events VALUES (?,?,?,?,?)').run(i.id,c.discord_user_id,actor(i),'publish_deal',new Date().toISOString());
   io.enqueue(`deal-published:${c.discord_user_id}:${version+1}`,c.channel_id,{...flow.card('📄 Your deal has been updated',`Version ${version+1} · Effective ${terms.effectiveStartDate.slice(0,10)}\n\nOpen **My deal** to review the full terms. Contact your manager here if anything needs correcting. This update does not sign an agreement or change recorded payments.${c.status_message_id?`\n\n[Open your creator directory](https://discord.com/channels/1245112089647775877/${c.channel_id}/${c.status_message_id})`:""}`),content:`<@${c.discord_user_id}>`,allowed_mentions:{parse:[],users:[c.discord_user_id]},components:[row(button(`${c.discord_user_id}:view`,'My deal',1))]});
   db.exec('COMMIT');
  }catch(e){db.exec('ROLLBACK');throw e;}
  await io.deliver();return io.reply(i,dealCard(db,c,true));
 }
 function settle(){
  for(const r of db.prepare("SELECT * FROM creator_deal_outbox WHERE status IN ('published','rejected') AND settled=0").all()){
   const c=db.prepare('SELECT * FROM creators WHERE discord_user_id=?').get(r.creator_id);if(!c)continue;
   const linked=binding(db,c),result=JSON.parse(r.result_json||'null');
   db.exec('BEGIN IMMEDIATE');
   try{
    if(r.status==='published'){
     for(const source of result._relatedDeals||[result])db.prepare('INSERT OR REPLACE INTO creator_imported_deals VALUES (?,?,?)').run(r.creator_id,source.id,JSON.stringify(source));
     db.prepare('DELETE FROM creator_deal_drafts WHERE creator_id=? AND actor_id=?').run(r.creator_id,r.actor_id);
    }
    io.enqueue(`deal-result:${r.id}`,c.channel_id,{
     ...flow.card(r.status==='published'?'📄 Deal published':'Deal publication needs attention',r.status==='published'?`**${flow.markdown(linked?.display_name||c.name)}** · Effective **${result.effectiveStartDate.slice(0,10)}**\n\nThe payout calculator now uses this deal for its effective period. Previously finalized payment amounts are unchanged.\n\n[Open creator directory](https://discord.com/channels/1245112089647775877/${c.channel_id}/${c.status_message_id})`:flow.markdown(r.error||'Reopen the deal and try again.')),
     content:`<@${r.actor_id}>`,allowed_mentions:{parse:[],users:[r.actor_id]},components:[row(button(`${r.creator_id}:view`,'View deal',1))]
    });
    db.prepare('UPDATE creator_deal_outbox SET settled=1 WHERE id=?').run(r.id);
    db.exec('COMMIT');
   }catch(e){db.exec('ROLLBACK');throw e;}
  }
 }
 return {handle,open,settle};
}
