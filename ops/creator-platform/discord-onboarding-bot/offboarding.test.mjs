import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from './bot.mjs';
import {createWorkspace,patchCreator} from './workspace.mjs';
import {createOffboarding,removalDeadline,effectivePermissions,payoutDate,protectOffboardingChannelWrites} from './offboarding.mjs';
import {adminCommand,handleAdminCommand} from './admin.mjs';
import {createScripts} from './scripts.mjs';
import {DAY} from './flow.mjs';
const iso=n=>new Date(n).toISOString(),now=Date.now(),uid='222222222222222222',staffId='333333333333333333',botId='444444444444444444',gid='1245112089647775877';
const clone=x=>structuredClone(x);
const sn=(t,n=0)=>String((BigInt(t)-1420070400000n)*4194304n+BigInt(n));

async function fixture(cohort='legacy') {
 const db=await openDatabase(':memory:');
 db.prepare('INSERT INTO creators(discord_user_id,name,phone,location,platforms,best_video,channel_id,stage,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(uid,'Creator','','UTC','','','555555555555555555','active',iso(now-40*DAY),iso(now-40*DAY));
 patchCreator(db,uid,{cohort,scripts_access:1,workflow_roles_initialized:0});
 const config={guildId:gid,ownerId:staffId,applicationId:botId,testMode:true};
 const resources={role_staff:'staff',role_admin:'admin',role_scripts:'scripts',role_legacy:'legacy',role_offboarded:'off',category_offboarded:'offcat',channel_staff_reviews:'review',role_new_deal:'newdeal',channel_resource_announcements:'announcements'};
 const roles=[{id:gid,permissions:'1024',position:0},{id:'legacy',permissions:'0',position:1},{id:'scripts',permissions:'0',position:2},{id:'managed',permissions:'0',position:3,managed:true},{id:'off',name:'Offboarded',permissions:'0',position:4},{id:'staff',permissions:'0',position:6},{id:'admin',permissions:'8',position:9},{id:'botrole',permissions:'8',position:10,managed:true}];
 const members=new Map([[uid,{user:{id:uid},roles:['legacy','scripts','managed']}],[staffId,{user:{id:staffId},roles:['staff']}],[botId,{user:{id:botId,bot:true},roles:['botrole']}]]);
 const channels=[{id:'offcat',name:'Offboarded Creators',type:4,permission_overwrites:[]},{id:'555555555555555555',name:'creator',parent_id:'old',type:0,permission_overwrites:[{id:gid,type:0,allow:'0',deny:'1024'},{id:uid,type:1,allow:'117760',deny:'0'}]},{id:'shared',type:0,permission_overwrites:[{id:'scripts',type:0,allow:'1024',deny:'0'},{id:'managed',type:0,allow:'1024',deny:'0'}]},{id:'other',type:0,permission_overwrites:[{id:gid,type:0,allow:'0',deny:'1024'},{id:uid,type:1,allow:'1024',deny:'0'}]}];
 channels.push({id:'announcements',type:0,permission_overwrites:[{id:gid,type:0,allow:'0',deny:'1024'},{id:'managed',type:0,allow:String((1n<<11n)|(1n<<35n)|(1n<<38n)),deny:'0'}]});
 const messages=[],calls=[],replies=[];let n=0,fail=null;
 const missing=()=>Object.assign(Error('Unknown Member'),{status:404,code:10007});
 const api=async(_config,path,init={})=>{
  calls.push({path,...init});if(fail?.(path,init))throw Error('simulated unavailable');
  const method=init.method||'GET',body=init.body?JSON.parse(init.body):null;
  if(path===`/guilds/${gid}`)return {id:gid,owner_id:staffId};
  if(path===`/guilds/${gid}/roles`)return clone(roles);
  if(path===`/guilds/${gid}/channels`)return clone(channels);
  const mem=path.match(/\/members\/([^/]+)(?:\/roles\/(.+))?$/);
  if(mem){const m=members.get(mem[1]);if(!m)throw missing();if(mem[2]){m.roles=m.roles.filter(x=>x!==mem[2]);if(method==='PUT')m.roles.push(mem[2]);return {};}if(method==='DELETE'){members.delete(mem[1]);return {};}return clone(m);}
  const perm=path.match(/^\/channels\/(.+)\/permissions\/(.+)$/);
  if(perm){const c=channels.find(x=>x.id===perm[1]);c.permission_overwrites=c.permission_overwrites.filter(x=>x.id!==perm[2]);if(method==='PUT')c.permission_overwrites.push({id:perm[2],...body});return {};}
  const list=path.match(/^\/channels\/(.+)\/messages\?limit=100(?:&before=(\d+))?$/);
  if(list)return clone(messages.filter(m=>m.channel_id===list[1]&&(!list[2]||BigInt(m.id)<BigInt(list[2]))).sort((a,b)=>BigInt(a.id)>BigInt(b.id)?-1:1).slice(0,100));
  const msg=path.match(/^\/channels\/(.+)\/messages(?:\/(\d+))?$/);
  if(msg){
   if(method==='POST'){const m={id:sn(Date.now(),++n),channel_id:msg[1],timestamp:iso(Date.now()),author:{id:botId,bot:true},...body};messages.push(m);return clone(m);}
   const m=messages.find(m=>m.channel_id===msg[1]&&m.id===msg[2]);if(!m)throw Object.assign(Error('Unknown Message'),{status:404,code:10008});
   if(method==='PATCH')Object.assign(m,body);return clone(m);
  }
  const ch=path.match(/^\/channels\/([^/]+)$/);if(ch){const c=channels.find(x=>x.id===ch[1]);if(method==='PATCH')Object.assign(c,body);return clone(c);}
  throw Error('Unhandled '+method+' '+path);
 };
 const staff=i=>i.member?.user?.id===staffId||i.member?.roles?.includes('staff');
 const enqueue=(id,channel,payload)=>db.prepare('INSERT OR IGNORE INTO deliveries(id,channel_id,payload,created_at) VALUES(?,?,?,?)').run(id,channel,JSON.stringify(payload),iso(Date.now()));
 const io={api,resourceMap:()=>resources,setResource:(_db,k,v)=>{resources[k]=v;},enqueue,patch:(id,p)=>patchCreator(db,id,p),staff,reply:async(i,p)=>{replies.push(p);return p;}};
 const o=createOffboarding(db,config,io),c=()=>db.prepare('SELECT * FROM creators WHERE discord_user_id=?').get(uid);
 const interaction=(id='action')=>({id,guild_id:gid,channel_id:'review',member:{user:{id:staffId},roles:['staff']}});
 const message=(who,at,content='message',extra={})=>{const m={id:sn(at,++n),channel_id:'555555555555555555',timestamp:iso(at),author:{id:who,bot:who===botId},content,type:0,...extra};messages.push(m);return m;};
 async function begin(){await o.preview(interaction(),c(),'Ending the trial',iso(now+DAY).slice(0,10));const token=db.prepare('SELECT id FROM offboarding_previews').get().id;await o.confirm(interaction('confirm'),token);return o.active(c());}
 function set(changes){const rec=o.active(c());db.prepare(`UPDATE offboarding_cases SET ${Object.keys(changes).map(k=>k+'=?').join(',')} WHERE id=?`).run(...Object.values(changes),rec.id);}
 async function mature(){let rec=await begin();const notice=message(botId,now-30*DAY,'stop'),report=message(botId,now-20*DAY,'Final payment report');set({started_at:iso(now-31*DAY),notice_at:notice.timestamp,notice_message_id:notice.id,payout_at:iso(now-DAY),history_cursor:notice.id});await o.manage(interaction(),c(),'report',{message:`https://discord.com/channels/${gid}/555555555555555555/${report.id}`});await o.manage(interaction(),c(),'settlement',{state:'paid',evidence:'Transfer reference verified'});return {notice,report};}
 return {db,config,resources,roles,members,channels,messages,calls,replies,api,io,o,c,interaction,message,begin,set,mature,fail:f=>{fail=f;}};
}

test('deadline uses later report/reply/payout and pauses on any unanswered message, payment or hold',()=>{
 const c={notice_at:iso(now-20*DAY),payout_at:iso(now-5*DAY),report_at:iso(now-10*DAY),settlement:'paid'};
 assert.equal(removalDeadline(c).at,now+4*DAY);
 assert.equal(removalDeadline({...c,last_staff_at:iso(now-1*DAY)}).at,now+6*DAY);
 assert.equal(removalDeadline({...c,last_staff_at:iso(now-9*DAY)}).at,now+4*DAY);
 for(const delta of [{settlement:'unverified'},{report_at:null},{hold_reason:'Dispute'},{last_creator_id:'123',reply_to_id:'122'}])assert.equal(removalDeadline({...c,...delta}).at,null);
 assert.equal(removalDeadline({...c,payout_at:iso(now+20*DAY)}).at,now+20*DAY);
 assert.throws(()=>payoutDate('2026-02-30',0));assert.throws(()=>payoutDate('2020-01-01'));
});
for(const cohort of ['legacy','new'])test(`${cohort} offboarding removes grants, handles managed role conflicts, and preserves private support`,async()=>{
 const f=await fixture(cohort);try {
  const rec=await f.begin();assert(rec.access_verified_at);assert.equal(f.c().stage,'removed');assert.equal(f.c().cohort,cohort);
  assert.deepEqual(f.members.get(uid).roles.sort(),['managed','off']);
  const visible=f.channels.filter(x=>x.type!==4&&(effectivePermissions(f.members.get(uid),x,f.roles,{id:gid,owner_id:staffId})&1024n)).map(x=>x.id);
  assert.deepEqual(visible,['555555555555555555','announcements']);
  const read=effectivePermissions(f.members.get(uid),f.channels.find(x=>x.id==='announcements'),f.roles,{id:gid,owner_id:staffId});
  assert.equal(read&(1024n|65536n),1024n|65536n);assert.equal(read&((1n<<11n)|(1n<<35n)|(1n<<38n)),0n);
  assert.equal(f.channels.find(x=>x.id==='555555555555555555').parent_id,'offcat');
  const queued=f.db.prepare('SELECT payload FROM deliveries').get();assert.deepEqual(JSON.parse(queued.payload).allowed_mentions,{parse:[],users:[uid]});
  const scripts=createScripts(f.db,f.config,{api:f.api,resourceMap:()=>f.resources,enqueue:()=>{},patch:(id,p)=>patchCreator(f.db,id,p)});
  await scripts.reconcile(f.c());await assert.rejects(scripts.setRoles(f.c(),true,'legacy'),/offboarded/);
  assert.deepEqual(f.members.get(uid).roles.sort(),['managed','off']);
 }finally{f.db.close();}
});
test('confirmation is actor-bound and rejects stale previews and privileged targets',async()=>{
 const f=await fixture();try {
  await f.o.preview(f.interaction(),f.c(),'Stop',iso(now+DAY).slice(0,10));const token=f.db.prepare('SELECT id FROM offboarding_previews').get().id;
  await assert.rejects(f.o.confirm({...f.interaction(),member:{user:{id:uid},roles:['staff']}},token),/another staff/);
  patchCreator(f.db,uid,{updated_at:iso(now)});await assert.rejects(f.o.confirm(f.interaction(),token),/changed/);
  f.members.get(uid).roles.push('admin');await assert.rejects(f.o.preview(f.interaction(),f.c(),'Stop',iso(now+DAY).slice(0,10)),/staff/);
  assert.equal(f.c().offboarding_id,null);
 }finally{f.db.close();}
});
test('human replies clear unanswered state; bots and replies to an older message do not',async()=>{
 const f=await fixture();try {
  await f.begin();const first=f.message(uid,now+1000),last=f.message(uid,now+2000);await f.o.observe(first);await f.o.observe(last);
  await f.o.observe(f.message(botId,now+3000));assert.equal(f.o.active(f.c()).reply_to_id,null);
  await f.o.observe(f.message(staffId,now+4000,'answer',{message_reference:{message_id:first.id}}));assert.equal(f.o.active(f.c()).reply_to_id,null);
  const answer=f.message(staffId,now+5000,'answer',{message_reference:{message_id:last.id}});await f.o.observe(answer);assert.equal(f.o.active(f.c()).reply_to_id,last.id);
  const fresh=f.message(uid,now+6000);await f.o.observe(fresh);assert.equal(removalDeadline({...f.o.active(f.c()),notice_at:iso(now),report_at:iso(now),settlement:'paid'}).at,null);
 }finally{f.db.close();}
});
test('final report requires correct channel, authority and notice, and corrections restart its grace period',async()=>{
 const f=await fixture();try {
  await f.begin();f.set({notice_at:iso(now-10000),notice_message_id:'123'});
  const fake=f.message(uid,now-5000,'report');await assert.rejects(f.o.manage(f.interaction(),f.c(),'report',{message:`https://discord.com/channels/${gid}/555555555555555555/${fake.id}`}),/actual report/);
  const m=f.message(botId,now-5000,'final');const url=`https://discord.com/channels/${gid}/555555555555555555/${m.id}`;
  await f.o.manage(f.interaction(),f.c(),'report',{message:url});const at=f.o.active(f.c()).report_at;
  await f.o.manage(f.interaction(),f.c(),'report',{message:url});assert.equal(f.o.active(f.c()).report_at,at);
  m.content='corrected';await f.o.manage(f.interaction(),f.c(),'report',{message:url});assert(Date.parse(f.o.active(f.c()).report_at)>Date.parse(at));assert.equal(f.o.active(f.c()).settlement,'unverified');
 }finally{f.db.close();}
});
test('history reconciliation catches missed creator messages across restart and never counts the report as a reply',async()=>{
 const f=await fixture();try {
  const {report}=await f.mature();const question=f.message(uid,now-21*DAY,'payment problem');report.author={id:staffId};
  await f.o.reconcileHistory(f.o.active(f.c()));const rec=f.o.active(f.c());assert.equal(rec.last_creator_id,question.id);assert.equal(rec.reply_to_id,null);
  await f.o.tick();assert(f.members.has(uid));
 }finally{f.db.close();}
});
test('due, paid case is kicked and verified; channel and history are retained',async()=>{
 const f=await fixture();try {
  await f.mature();await f.o.tick();assert(!f.members.has(uid));assert.equal(f.o.active(f.c()).state,'kicked');assert(f.channels.some(c=>c.id==='555555555555555555'));
  const count=f.calls.filter(c=>c.method==='DELETE'&&c.path===`/guilds/${gid}/members/${uid}`).length;await f.o.tick();assert.equal(count,1);
 }finally{f.db.close();}
});
for(const reason of ['message','unpaid','hold','issue','edited report','history error'])test(`automatic kick is blocked by ${reason}`,async()=>{
 const f=await fixture();try {
  const {report}=await f.mature();
  if(reason==='message')f.message(uid,now-1000);
  if(reason==='unpaid')f.set({settlement:'unverified'});
  if(reason==='hold')f.set({hold_reason:'Unresolved dispute'});
  if(reason==='issue')f.db.prepare('INSERT INTO creator_hub_issues(id,creator_id,kind,month,details,created_at) VALUES(?,?,?,?,?,?)').run('issue',uid,'payments','2026-09','Incorrect',iso(now));
  if(reason==='edited report')report.content='Changed';
  if(reason==='history error')f.fail(p=>p.includes('/messages?'));
  await f.o.tick();assert(f.members.has(uid));assert(!f.calls.some(c=>c.method==='DELETE'&&c.path===`/guilds/${gid}/members/${uid}`));
 }finally{f.db.close();}
});
test('rejoining restores restriction and holds a new removal; it never grants Newcomer or program roles',async()=>{
 const f=await fixture();try {
  await f.mature();await f.o.tick();f.members.set(uid,{user:{id:uid},roles:['scripts']});await f.o.rejoined(f.c());
  assert.deepEqual(f.members.get(uid).roles,['off']);assert.equal(f.o.active(f.c()).state,'open');assert(f.o.active(f.c()).hold_reason);
 }finally{f.db.close();}
});
test('workspace delivery records notice and offboarding blocks stale buttons while retaining payment support',async()=>{
 const f=await fixture();try {
  await f.begin();const w=createWorkspace(f.config,f.db,{...f.io,editReply:async(c,i,p)=>f.replies.push(p),input:()=>{},callback:()=>{}});
  await w.deliver();const rec=f.o.active(f.c());assert(rec.notice_at);assert(rec.notice_message_id);assert.equal(f.messages.filter(m=>m.embeds?.[0]?.title==='Your GoTall participation').length,1);
  await w.deliver();assert.equal(f.messages.filter(m=>m.embeds?.[0]?.title==='Your GoTall participation').length,1);
  await w.handle({...f.interaction(),channel_id:'555555555555555555',data:{custom_id:'gt:reopen'}});assert.equal(f.c().stage,'removed');
  assert(adminCommand.options.length<=25);const group=adminCommand.options.find(x=>x.name==='offboarding');assert(group.options.some(x=>x.name==='report'));
  await handleAdminCommand(f.config,f.db,{...f.interaction(),data:{options:[{name:'offboarding',options:[{name:'hold',options:[{name:'creator',value:uid},{name:'reason',value:'Dispute'}]}]}]}},w);assert.equal(f.o.active(f.c()).hold_reason,'Dispute');
 }finally{f.db.close();}
});

test('partial permission failure resumes without duplicate notice and never removes the member',async()=>{
 const f=await fixture();try {
  f.fail((p,i)=>p.endsWith('/roles/scripts')&&i.method==='DELETE');
  let rec=await f.begin();assert(rec.error);assert.equal(rec.access_verified_at,null);assert(f.members.has(uid));
  f.fail(null);await f.o.tick();rec=f.o.active(f.c());assert(rec.access_verified_at);assert(f.members.has(uid));
  assert.deepEqual(f.members.get(uid).roles.sort(),['managed','off']);
  assert.equal(f.db.prepare("SELECT count(*) n FROM deliveries WHERE id LIKE 'offboarding-notice:%'").get().n,1);
 }finally{f.db.close();}
});
test('notice recovery still catches a creator message sent before the delayed notice',async()=>{
 const f=await fixture();try {
  const rec=await f.begin();f.set({started_at:iso(now-10000)});
  const question=f.message(uid,now-5000,'Unpaid work'),notice=f.message(botId,now-1000,'Stop posting');
  f.db.prepare('UPDATE deliveries SET message_id=? WHERE id=?').run(notice.id,`offboarding-notice:${rec.id}`);
  await f.o.tick();const updated=f.o.active(f.c());assert.equal(updated.notice_message_id,notice.id);assert.equal(updated.last_creator_id,question.id);assert.equal(updated.reply_to_id,null);
 }finally{f.db.close();}
});
test('history scan follows pagination and deleted reply blocks a due removal',async()=>{
 const f=await fixture();try {
  await f.mature();const question=f.message(uid,now-10*DAY,'Question');
  for(let k=0;k<105;k++)f.message(botId,now-9*DAY+k,'Automated message');
  await f.o.reconcileHistory(f.o.active(f.c()));assert.equal(f.o.active(f.c()).last_creator_id,question.id);
  const answer=f.message(staffId,now-8*DAY,'Resolved');await f.o.observe(answer);
  f.messages.splice(f.messages.indexOf(answer),1);await f.o.tick();assert(f.members.has(uid));assert.match(f.o.active(f.c()).error,/Unknown Message/);
 }finally{f.db.close();}
});
test('legacy end-trial interaction cannot bypass the offboarding preview and payment date',async()=>{
 const f=await fixture();try {
  const w=createWorkspace(f.config,f.db,{...f.io,editReply:async()=>{},input:()=>{},callback:()=>{}});
  await assert.rejects(w.handle({...f.interaction(),channel_id:'555555555555555555',data:{custom_id:'gt:form:end_trial'}}),/creator offboard/);
  assert.equal(f.c().stage,'active');assert.equal(f.c().offboarding_id,null);
 }finally{f.db.close();}
});

test('offboarding requires a valid configured announcements channel before changing access',async()=>{
 const f=await fixture();try {
  f.resources.channel_resource_announcements='missing';
  await assert.rejects(f.o.preview(f.interaction(),f.c(),'Participation ending',iso(now+DAY).slice(0,10)),/Announcements channel/);
  assert.equal(f.c().offboarding_id,null);assert(!f.calls.some(x=>x.method&&x.method!=='GET'));
 }finally{f.db.close();}
});
test('announcement access repairs drift without opening other channels and notice uses approximate month-start payout',async()=>{
 const f=await fixture();try {
  await f.begin();const announcement=f.channels.find(x=>x.id==='announcements');
  announcement.permission_overwrites.find(x=>x.type===1&&x.id===uid).allow=String(1024n|65536n|2048n);
  await f.o.sync(f.c());
  const permissions=effectivePermissions(f.members.get(uid),announcement,f.roles,{id:gid,owner_id:staffId});
  assert.equal(permissions&2048n,0n);assert.equal(permissions&(1024n|65536n),1024n|65536n);
  const payload=JSON.parse(f.db.prepare("SELECT payload FROM deliveries WHERE id LIKE 'offboarding-notice:%'").get().payload);
  assert.match(payload.embeds[0].description,/expected around the start of the new month/);
  assert.match(payload.embeds[0].description,/<#announcements>/);assert.match(payload.embeds[0].description,/all other channels are hidden/);
  assert.doesNotMatch(payload.embeds[0].description,/next payout date/);
 }finally{f.db.close();}
});


test('startup overwrite replacement preserves announcements and closes conflicting member grants atomically',async()=>{
 const f=await fixture();try {
  await f.begin();
  const guarded=protectOffboardingChannelWrites(f.db,f.config,f.api,()=>f.resources);
  // Emulate resource setup replacing every overwrite, including a legacy allow.
  for(const channel of ['announcements','other'])await guarded(f.config,`/channels/${channel}`,{method:'PATCH',body:JSON.stringify({permission_overwrites:[{id:gid,type:0,allow:'1024',deny:'0'},{id:uid,type:1,allow:'2048',deny:'0'},{id:'staff',type:0,allow:'117760',deny:'0'}]})});
  const a=f.channels.find(x=>x.id==='announcements'),other=f.channels.find(x=>x.id==='other'),m=f.members.get(uid),g={id:gid,owner_id:staffId};
  const p=effectivePermissions(m,a,f.roles,g);
  assert.equal(p&(1024n|65536n),1024n|65536n);assert.equal(p&(2048n|(1n<<35n)|(1n<<38n)),0n);
  assert.equal(effectivePermissions(m,other,f.roles,g)&1024n,0n);
  assert.deepEqual(a.permission_overwrites.find(o=>o.id==='staff'),{id:'staff',type:0,allow:'117760',deny:'0'});
 }finally{f.db.close();}
});
