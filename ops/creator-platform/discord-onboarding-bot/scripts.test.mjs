import {test} from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from './bot.mjs';
import {createScripts,firstPublication,trialReport} from './scripts.mjs';
import {createWorkspace,patchCreator,isStaff} from './workspace.mjs';
import * as flow from './flow.mjs';
const now=Date.parse('2026-09-13T12:00:00Z');
test('Admin and Manager authorize staff actions, Founder is display only',()=>{
  const resources={role_staff:'manager',role_admin:'admin',role_founder:'founder'};
  const check=(roles,permissions='0')=>isStaff({member:{user:{id:'person'},roles,permissions}},{ownerId:'owner'},resources);
  assert.equal(check(['manager']),true);
  assert.equal(check(['admin']),true);
  assert.equal(check(['founder']),false);
  assert.equal(check([], '8'),true);
  assert.equal(check([], '32'),false);
});
test('editing a script updates its existing notification without another ping',async()=>{
  const f=await setup();try {
    f.db.prepare('INSERT INTO scripts VALUES (?,?,?,?,?)').run('700','scripts','staff','Old script',new Date(now).toISOString());
    patchCreator(f.db,'1',{current_script_id:'700'});
    f.db.prepare('INSERT INTO deliveries VALUES (?,?,?,?,?)').run('script:700:1','channel-1',JSON.stringify({embeds:[{description:'Old script'}]}),'800',new Date(now).toISOString());
    const patches=[];
    const s=createScripts(f.db,f.config,{resourceMap:()=>r,patch:(id,p)=>patchCreator(f.db,id,p),enqueue:()=>assert.fail('No new announcement'),api:async(config,path,init={})=>{
      if(path.includes('/members/'))return {roles:['manager']};
      if(init.method==='PATCH'){patches.push(JSON.parse(init.body));return {};}
      return {embeds:[{description:'Old script'}]};
    }});
    await s.ingest({id:'700',channel_id:'scripts',author:{id:'staff'},content:'Updated script'});
    assert.equal(patches[0].embeds[0].description,'Updated script');
    assert.deepEqual(patches[0].allowed_mentions,{parse:[]});
    assert.equal(f.db.prepare('SELECT body FROM scripts WHERE id=?').get('700').body,'Updated script');
  }finally{f.db.close();}
});
test('creator guide directs technical review to owner and keeps support in server',()=>{
  const guide=flow.creatorGuide({cohort:'new'},{user_reviewer_blazie:'judy',channel_scripts:'scripts'},'owner');
  assert.match(guide.embeds[0].description,/tag <@owner>/);
  assert.match(guide.embeds[0].description,/not in DMs/);
  assert.match(guide.embeds[0].description,/Evan and Blazie can both see/);
  assert.doesNotMatch(guide.embeds[0].description,/Managers/);
  assert.deepEqual(guide.allowed_mentions,{parse:[]});
  assert.match(flow.creatorGuide({cohort:'legacy'}).embeds[0].description,/existing deal and approval arrangements/);
});
test('idle directory is concise, hides completed scripts and omits trial dates for full-time creators',()=>{
  const c={cohort:'new',stage:'trial',trial_ends_at:'2026-09-20T12:00:00Z',current_script:{id:'1',channel_id:'2',body:'Old approved script'}};
  const trial=flow.statusCard(c);
  assert.match(trial.embeds[0].description,/No active script right now/);
  assert.match(trial.embeds[0].description,/Your trial ends on <t:\d+:D>/);
  assert.doesNotMatch(JSON.stringify(trial),/Old approved script|Latest script|Publish approved/);
  const active=flow.statusCard({...c,stage:'active'});
  assert.match(active.embeds[0].description,/No active script right now/);
  assert.match(active.embeds[0].description,/your main contact/);
  assert.match(active.embeds[0].description,/not in DMs/);
  assert.doesNotMatch(active.embeds[0].description,/Your trial ends/);
  assert.ok(active.components.flatMap(r=>r.components).some(b=>b.label==='Payment hub'));
});
const r={channel_scripts:'scripts',channel_script_library:'library',role_scripts:'scripts-role',role_staff:'manager',user_reviewer_blazie:'judy',role_founder:'founder',role_admin:'admin',channel_staff_reviews:'onboarding',channel_video_reviews:'videos'};
test('unchanged accepted scripts remain readable after the coach leaves; edits still require authorization',async()=>{
 const f=await setup();try {
  f.db.prepare('INSERT INTO scripts VALUES (?,?,?,?,?)').run('700','scripts','departed','Accepted script',new Date(now).toISOString());
  const s=createScripts(f.db,f.config,{resourceMap:()=>r,patch:()=>{},enqueue:()=>assert.fail('No replay'),api:async()=>{throw Object.assign(new Error('Unknown Member'),{status:404,code:10007});}});
  const message={id:'700',channel_id:'scripts',author:{id:'departed'},content:'Accepted script'};
  assert.equal(await s.ingest(message),false);
  await assert.rejects(s.ingest({...message,content:'Unauthorized new content'}),/Unknown Member/);
  assert.equal(f.db.prepare('SELECT body FROM scripts WHERE id=?').get('700').body,'Accepted script');
 }finally{f.db.close();}
});
async function setup() {
  const db=await openDatabase(':memory:');
  for(const [id,cohort,access] of [['1','new',1],['2','legacy',1],['3','legacy',0]]) {
    db.prepare('INSERT INTO creators(discord_user_id,name,phone,location,platforms,best_video,channel_id,stage,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)').run(id,`Creator ${id}`,'','UTC','','',`channel-${id}`,'active',new Date(now).toISOString(),new Date(now).toISOString());
    patchCreator(db,id,{cohort,scripts_access:access,agreement_signed_at:'2026-09-10T00:00:00Z',warmup_approved_at:'2026-09-09T00:00:00Z',first_video_approved_at:'2026-09-11T00:00:00Z',timezone:'UTC'});
  }
  const deliveries=[];
  const config={guildId:flow.TEST_GUILD_ID,testMode:true,ownerId:'owner',applicationId:'bot'};
  const scripts=createScripts(db,config,{resourceMap:()=>r,patch:(id,p)=>patchCreator(db,id,p),enqueue:(id,channel,payload)=>deliveries.push({id,channel,payload}),api:async(c,path)=>({roles:path.endsWith('/staff')?['manager']:path.endsWith('/founder-user')?['founder','admin']:path.endsWith('/stranger')||path.endsWith('/3')?[]:['scripts-role']})});
  return {db,scripts,deliveries,config,c:id=>db.prepare('SELECT * FROM creators WHERE discord_user_id=?').get(id)};
}
test('scripts require authorized role mention, notify new cohort only, and preserve legacy workflow',async()=>{
  const f=await setup();try {
    const m={id:'100',guild_id:flow.TEST_GUILD_ID,channel_id:'scripts',author:{id:'staff'},mention_roles:['scripts-role'],content:'Today: film this script',timestamp:new Date(now).toISOString()};
    assert.equal(await f.scripts.ingest({...m,author:{id:'stranger'}}),false);
    assert.equal(await f.scripts.ingest({...m,mention_roles:[]}),false);
    assert.equal(await f.scripts.ingest({...m,guild_id:'production'}),false);
    assert.equal(await f.scripts.ingest(m),true);assert.equal(await f.scripts.ingest(m),false);
    assert.equal(f.deliveries.length,1);assert.deepEqual(f.deliveries[0].payload.allowed_mentions,{parse:[],users:['1']});
    assert.equal(f.c('1').stage,'first_video');assert.equal(f.c('1').draft_resume_stage,'active');
    assert.equal(f.c('2').stage,'active');assert.equal(f.c('2').current_script_id,'100');assert.equal(f.c('3').current_script_id,null);
    assert.match(JSON.stringify(flow.statusCard(f.scripts.decorate(f.c('1')))),/Today: film this script/);
    const recurring=flow.statusCard(f.scripts.decorate(f.c('1')));
    assert.equal(recurring.embeds[0].title,'🎬 Your next script');
    assert.doesNotMatch(JSON.stringify(recurring),/Step 5|Submit first video|Explore your Creator Hub|Choose your format/);
    const buttons=recurring.components.flatMap(r=>r.components);
    assert.ok(buttons.some(b=>b.label==='Submit draft'));
    assert.ok(buttons.some(b=>b.label==='Payment hub'));
    assert.match(f.deliveries[0].payload.embeds[0].description,/Today: film this script/);
    assert.equal(flow.inlineScript({body:'<@&123456> A new idea'}),'A new idea');
    assert.doesNotMatch(JSON.stringify(flow.statusCard(f.scripts.decorate(f.c('2')))),/gt:first_video/);
    patchCreator(f.db,'1',{stage:'first_video_review',submitted_script_id:'100',first_video_url:'https://example.com/draft'});
    await f.scripts.ingest({...m,id:'101',author:{id:'founder-user'}});
    assert.equal(f.c('1').stage,'first_video');assert.equal(f.c('1').submitted_script_id,null);assert.equal(f.c('1').current_script_id,'101');
    assert.equal(await f.scripts.ingest({...m,id:'102',channel_id:'library'}),false);
    assert.equal(f.c('1').current_script_id,'101');
    assert.equal(f.deliveries.length,2);

    assert.equal(await f.scripts.ingest({...m,id:'103',channel_id:'unrelated'}),false);
  }finally{f.db.close();}
});
test('trial starts only at declared first publication after prerequisites and lasts exactly 168 hours',()=>{
  const c={cohort:'new',warmup_approved_at:'2026-09-09T00:00:00Z',agreement_signed_at:'2026-09-10T00:00:00Z',first_video_approved_at:'2026-09-11T00:00:00Z'};
  const p=firstPublication(c,'2026-09-12T10:00:00Z',now);
  assert.equal(p.stage,'trial');assert.equal(p.trial_ends_at,'2026-09-19T10:00:00.000Z');
  assert.equal(p.first_publication_source,'creator_confirmation');assert.equal(p.last_post_at,undefined);
  assert.throws(()=>firstPublication({...c,cohort:'legacy'},'2026-09-12T10:00:00Z',now),/Legacy/);
  assert.throws(()=>firstPublication({...c,trial_started_at:p.trial_started_at},p.trial_started_at,now),/already/);
  assert.throws(()=>firstPublication(c,'2026-09-20T10:00:00Z',now),/future/);
  assert.throws(()=>firstPublication(c,'2026-09-10T10:00:00Z',now),/after/);
  assert.throws(()=>firstPublication({...c,first_video_approved_at:null},'2026-09-12T10:00:00Z',now),/approved/);
  assert.equal(flow.transition({...c,stage:'hub_ready'},'open_hub',{now}).trial_started_at,undefined);
});
test('redacted gateway script text is fetched before notification and persistence',async()=>{
  const f=await setup();try {
    const scripts=createScripts(f.db,f.config,{resourceMap:()=>r,patch:(id,p)=>patchCreator(f.db,id,p),enqueue:()=>{},api:async(config,path)=>path.includes('/messages/')?{content:'<@&123456> Film this idea'}:{roles:['manager','scripts-role']}});
    await scripts.ingest({id:'500',channel_id:'scripts',author:{id:'staff'},mention_roles:['scripts-role'],content:''});
    assert.equal(f.db.prepare('SELECT body FROM scripts WHERE id=?').get('500').body,'<@&123456> Film this idea');
  }finally{f.db.close();}
});
test('recurring script draft is reviewed in video channel and approval restores lifecycle without posting checks',async()=>{
  const f=await setup();try {
    const sent=[],resources={...r,role_onboarding:'onboard',role_active:'active',role_at_risk:'risk',category_onboarding:'new',category_active:'live'};
    const w=createWorkspace(f.config,f.db,{resourceMap:()=>resources,input:flow.formInput,editReply:async()=>{},api:async(config,path,init={})=>{
      if(path.includes('/members/'))return {roles:['scripts-role']};
      if(path.includes('/messages?'))return sent.filter(m=>m.channel===path.split('/')[2]);
      if(init.method==='POST'&&path.endsWith('/messages')){const m={...JSON.parse(init.body),id:String(sent.length+1000),author:{id:'bot'},channel:path.split('/')[2]};sent.push(m);return m;}
      return {};
    }});
    const message={id:'300',channel_id:'scripts',author:{id:'owner'},mention_roles:['scripts-role'],content:'New script',timestamp:new Date(now).toISOString()};
    await w.scripts.ingest(message);
    const interaction=(action,fields={},staff=false,id=action)=>({id,type:5,channel_id:'channel-1',member:{user:{id:staff?'owner':'1'},roles:staff?['manager']:[]},data:{custom_id:`gt:${action}`,components:[{components:Object.entries(fields).map(([custom_id,value])=>({custom_id,value}))}]}});
    await w.handle(interaction('first_video',{url:'https://example.com/draft.mp4'}));
    assert.equal(f.c('1').stage,'first_video_review');
    const review=sent.find(m=>m.channel==='videos');assert.ok(review);assert.match(JSON.stringify(review),/scripts\/300/);
    assert.equal(sent.some(m=>m.channel==='onboarding'),false);
    await w.handle(interaction('approve_first_video',{},true));
    assert.equal(f.c('1').stage,'active');assert.equal(f.c('1').draft_resume_stage,null);
    assert.equal(f.db.prepare('SELECT status FROM script_drafts WHERE creator_id=?').get('1').status,'approved');
    assert.match(JSON.stringify(sent.find(m=>m.embeds?.[0]?.title==='🔥 Your video is approved — time to post!')),/No published links/);
    assert.equal(f.db.prepare('SELECT count(*) n FROM creator_posts').get().n,0);
    await assert.rejects(w.handle({...interaction('first_video',{url:'https://example.com/x'},false,'legacy-draft'),channel_id:'channel-2',member:{user:{id:'2'},roles:[]}}),/Legacy/);
  }finally{f.db.close();}
});
test('trial report is due once at trial end and never substitutes unavailable observations with zero',async()=>{
  const f=await setup();try {
    patchCreator(f.db,'1',{stage:'trial',trial_started_at:'2026-09-06T12:00:00Z',trial_ends_at:'2026-09-13T12:00:00Z'});
    f.scripts.reports(now-flow.DAY-1);assert.equal(f.deliveries.length,0);
    f.scripts.reports(now-flow.DAY);f.scripts.reports(now);assert.equal(f.deliveries.length,1);
    assert.equal(f.deliveries[0].channel,'onboarding');assert.deepEqual(f.deliveries[0].payload.allowed_mentions,{parse:[],users:['judy'],roles:['manager']});
    assert.match(JSON.stringify(trialReport(f.db,f.c('1'),now)),/does not establish zero/);
    assert.equal(f.c('1').stage,'trial');
  }finally{f.db.close();}
});

test('Discord Scripts and New Deal roles are authoritative after one-time provisioning',async()=>{
  const f=await setup();try {
    const roles=new Set(),writes=[],deliveries=[];
    const scripts=createScripts(f.db,f.config,{resourceMap:()=>({...r,role_new_deal:'new-deal'}),patch:(id,p)=>patchCreator(f.db,id,p),enqueue:(...args)=>deliveries.push(args),api:async(config,path,init={})=>{
      if(path.endsWith('/staff'))return {roles:['manager']};
      if(path.includes('/roles/')){const role=path.split('/').at(-1);writes.push(init.method);if(init.method==='PUT')roles.add(role);else roles.delete(role);}
      return {roles:[...roles]};
    }});
    await scripts.reconcile(f.c('1'));
    assert.equal(writes.length,0,'onboarding and draft approval do not grant either role');
    patchCreator(f.db,'1',{first_publication_source:'creator_confirmation',trial_started_at:new Date(now).toISOString()});
    const c=await scripts.reconcile(f.c('1'));
    assert.equal(c.cohort,'new');assert.equal(c.scripts_access,1);assert.deepEqual([...roles],['scripts-role','new-deal']);
    roles.delete('scripts-role');roles.delete('new-deal');
    const legacy=await scripts.reconcile(f.c('1'));
    assert.equal(legacy.cohort,'legacy');assert.equal(legacy.scripts_access,0);assert.equal(writes.length,2);
    roles.add('scripts-role');
    assert.equal((await scripts.reconcile(f.c('1'))).scripts_access,1);
    assert.equal(f.c('1').cohort,'legacy');assert.equal(writes.length,2);
    roles.add('new-deal');assert.equal((await scripts.reconcile(f.c('1'))).cohort,'new');
  }finally{f.db.close();}
});
