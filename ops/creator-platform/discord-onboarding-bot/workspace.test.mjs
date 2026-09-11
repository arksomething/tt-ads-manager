import {dealCard,validateDealSection,currentDeal} from './deals.mjs';
import {postsCard,paymentsCard,statementAmounts,monthKey,hubCommands} from './hubs.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase,handleInteraction} from './bot.mjs';
import * as flow from './flow.mjs';
import {createWorkspace,approveLeave,isStaff,privateOverwrites,patchCreator} from './workspace.mjs';
import {adminCommand,handleAdminCommand} from './admin.mjs';
import {creatorSuccess,messageCopy,creatorDecision} from './messages.mjs';

const now=Date.parse('2026-09-07T12:00:00Z'), iso=t=>new Date(t).toISOString();
const config={guildId:flow.TEST_GUILD_ID,testMode:true,applicationId:'1534630446959427686',ownerId:'571179674323910667'};
const uid='222222222222222222', other='333333333333333333';
const resources={role_staff:'staff',role_onboarding:'onboard',role_active:'active',role_at_risk:'risk',category_onboarding:'new',category_active:'live',category_at_risk:'riskcat',category_inactive:'done',channel_start_here:'start'};
async function fixture({channelFailure=false,topicFailure=false,staffReviews=false}={}) {
  const db=await openDatabase(':memory:');
  db.prepare('INSERT INTO creators (discord_user_id,name,phone,location,platforms,best_video,channel_id,stage,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)').run(uid,'Test Creator','+15555555555','New York','TikTok @test','','channel','warmup',iso(now),iso(now));
  const calls=[], messages=[], replies=[], modals=[];
  let fail=false;
  const api=async(c,path,init={})=>{
    calls.push({path,...init});
    if(path===`/guilds/${config.guildId}/members/${other}`&&!init.method)return {roles:['staff']};
    if(topicFailure&&path==='/channels/channel'&&init.method==='PATCH'&&Object.hasOwn(JSON.parse(init.body),'topic'))throw Object.assign(new Error('Topic rate limited'),{status:429});
    if(path==='/channels/channel' && init.method==='PATCH' && channelFailure)throw new Error('Discord channel rate limit');
    if(path==='/channels/channel' && !init.method)return {name:'🟡-test-creator',parent_id:'new'};
    if(fail&&init.method==='PATCH'){fail=false;throw new Error('Discord unavailable');}
    if(path.includes('/messages?'))return messages;
    if(path.includes('/messages/pins/')&&init.method==='PUT') {
      const m=messages.find(m=>m.id===path.split('/').at(-1));if(m)m.pinned=true;return {};
    }
    if(!init.method&&/\/messages\/\d+$/u.test(path))return messages.find(m=>m.id===path.split('/').at(-1))||{};
    if(init.method==='POST'&&path.endsWith('/messages')) {
      const m={...JSON.parse(init.body),id:String(messages.length+1),author:{id:config.applicationId}};messages.push(m);return m;
    }
    return {};
  };
  const w=createWorkspace(config,db,{api,resourceMap:()=>staffReviews?{...resources,channel_staff_reviews:'reviews',user_reviewer_blazie:other}:resources,setResource:()=>{},callback:async(c,i,p)=>modals.push(p),editReply:async(c,i,p)=>replies.push(p),input:flow.formInput,saveUpload:async()=> 'https://discord.com/channels/guild/channel/upload'});
  let n=0;
  const interaction=(action,fields={},user=uid,id=String(++n))=>({id,channel_id:'channel',guild_id:config.guildId,type:5,member:{user:{id:user},roles:user===other?['staff']:[],permissions:'0'},data:{custom_id:`gt:${action}`,components:[{components:Object.entries(fields).map(([custom_id,value])=>({custom_id,value}))}]}});
  return {db,w,calls,messages,replies,modals,interaction,fail:()=>{fail=true;},c:()=>w.creator(uid)};
}

test('application timezone is reused and account modal respects Discord field limits',async()=>{
  const f=await fixture();
  try {
    await f.w.sync(f.c());
    assert.equal(f.c().timezone,'America/New_York');
    await f.w.openModal({...f.interaction('accounts'),type:3},'accounts');
    const components=f.modals.at(-1).data.components;
    assert.doesNotMatch(components[0].content,/timezone/i);
    for(const item of components.filter(c=>c.type===18)) {
      assert.ok(item.label.length<=45);
      assert.ok(item.description.length<=100);
      assert.ok(item.component.placeholder.length<=100);
    }
    assert.equal(components.some(c=>c.component?.custom_id==='timezone'),false);
    assert.deepEqual(components.filter(c=>c.type===18).map(c=>c.component.custom_id),['instagram','tiktok']);
    await f.w.handle(f.interaction('accounts',{instagram:'@demo',tiktok:'tiktok.com/@demo'}));
    assert.equal(f.c().timezone,'America/New_York');
    assert.equal(f.c().campaign_accounts,'https://www.instagram.com/demo/\nhttps://www.tiktok.com/@demo');
    assert.throws(()=>flow.parseAccountFields('https://tiktok.com/@wrong','@demo'),/belongs to tiktok/);
    assert.throws(()=>flow.parseAccountFields('','@demo'),/Instagram field/);
    assert.equal(f.c().stage,'account_review');
    patchCreator(f.db,uid,{stage:'warmup'});
    await f.w.handle(f.interaction('accounts',{accounts:'TT: @demo\nIG: @demo',timezone:'GMT+8'}));
    assert.equal(f.c().timezone,'+08:00');
  } finally {f.db.close();}
});

test('ambiguous application location asks for clarification without blocking onboarding',async()=>{
  const f=await fixture();
  try {
    patchCreator(f.db,uid,{location:'CST'});
    await f.w.sync(f.c());
    assert.equal(f.c().timezone,null);
    assert.ok(f.c().timezone_lookup_at);
    await f.w.openModal({...f.interaction('accounts'),type:3},'accounts');
    assert.equal(f.modals.at(-1).data.components.at(-1).component.required,true);
  } finally {f.db.close();}
});

test('submitting accounts enters review and alerts staff once',async()=>{
  const f=await fixture({staffReviews:true});
  try {
    const i=f.interaction('accounts',{instagram:'@creator',tiktok:'@creator',timezone:'UTC'});
    await f.w.handle(i);
    assert.equal(f.c().stage,'account_review');
    const alerts=()=>f.messages.filter(m=>m.embeds?.[0]?.title==='🔎 Accounts ready for review');
    assert.equal(alerts().length,1);
    assert.equal(alerts()[0].content,`<@&${resources.role_staff}>`);
    assert.deepEqual(alerts()[0].allowed_mentions,{parse:[],roles:[resources.role_staff]});
    await f.w.handle(i);
    assert.equal(alerts().length,1);
    assert.ok(!JSON.stringify(flow.statusCard(f.c())).includes('Send for review'));
  }finally{f.db.close();}
});

test('edit answers prefills saved accounts and updates pending review',async()=>{
  const f=await fixture();
  try {
    await f.w.handle(f.interaction('accounts',{instagram:'@first',tiktok:'@first',timezone:'UTC'}));
    assert.match(JSON.stringify(flow.statusCard(f.c())),/Edit answers/);
    await f.w.openModal({...f.interaction('accounts'),type:3},'accounts');
    const fields=f.modals.at(-1).data.components.filter(c=>c.type===18);
    assert.equal(fields[0].component.value,'https://www.instagram.com/first/');
    assert.equal(fields[1].component.value,'https://www.tiktok.com/@first');
    await f.w.handle(f.interaction('accounts',{instagram:'@updated',tiktok:'@first'}));
    assert.equal(f.c().stage,'account_review');
    assert.match(f.c().campaign_accounts,/instagram.com\/updated\//);
    assert.ok(f.calls.some(call=>call.path==='/channels/channel'&&call.method==='PATCH'&&JSON.parse(call.body).name==='🟡-test-creator-first'));
    patchCreator(f.db,uid,{stage:'account_ready'});
    await assert.rejects(f.w.handle(f.interaction('accounts',{instagram:'@other',tiktok:'@other'})),/during setup or account review/);
  }finally{f.db.close();}
});

test('Manager alert controls target the creator and preserve modal routing',async()=>{
  const f=await fixture({staffReviews:true});
  try {
    await f.w.handle(f.interaction('accounts',{instagram:'@demo',tiktok:'@demo',timezone:'UTC'}));
    const alert=f.messages.find(m=>m.embeds?.[0]?.title==='🔎 Accounts ready for review');
    assert.ok(alert.components.flatMap(r=>r.components).some(b=>b.custom_id===`gt:review:${uid}:approve_account`));
    const i={...f.interaction('changes',{},other),channel_id:'reviews',type:3,data:{custom_id:`gt:review:${uid}:changes`}};
    await f.w.openModal(i,'changes');
    assert.equal(f.modals.at(-1).data.custom_id,`gt:form:review:${uid}:changes`);
    const submit={...f.interaction('changes',{reason:'Update the bio'},other),channel_id:'reviews'};
    submit.data.custom_id=`gt:form:review:${uid}:changes`;
    await f.w.handle(submit);
    assert.equal(f.c().stage,'warmup');
    const unauthorized={...i,member:{user:{id:uid},roles:[]}};
    await assert.rejects(f.w.openModal(unauthorized,'changes'),/staff/);
  }finally{f.db.close();}
});

test('first video grants Hub resources without starting the trial',async()=>{
  const f=await fixture();
  resources.role_hub_access='hub-access';resources.channel_app_access='app-guide';resources.channel_assets='assets';
  try {
    patchCreator(f.db,uid,{stage:'first_video'});
    await f.w.sync(f.c());
    assert.ok(f.calls.some(call=>call.path.endsWith('/roles/hub-access')&&call.method==='PUT'));
    assert.equal(f.c().trial_started_at,null);
    const description=f.messages.at(-1).embeds[0].description;
    assert.match(description,/<#app-guide>/);assert.match(description,/<#assets>/);
    assert.match(description,/Wait for approval before posting/);
  }finally{delete resources.role_hub_access;delete resources.channel_app_access;delete resources.channel_assets;f.db.close();}
});

test('published submission saves both platform links atomically and alerts once',async()=>{
  const f=await fixture({staffReviews:true});
  try {
    patchCreator(f.db,uid,{stage:'active',timezone:'UTC'});
    await assert.rejects(f.w.handle(f.interaction('post',{tiktok_url:'https://www.tiktok.com/@demo/video/123',instagram_url:''})),/Both links/);
    assert.equal(f.db.prepare('SELECT count(*) n FROM creator_posts').get().n,0);
    const fields={tiktok_url:'https://www.tiktok.com/@demo/video/123',instagram_url:'https://www.instagram.com/reel/ABC/'};
    await f.w.handle(f.interaction('post',fields));
    assert.equal(f.db.prepare('SELECT count(*) n FROM creator_posts').get().n,2);
    const directory=f.calls.filter(call=>call.method==='PATCH'&&call.path.includes('/messages/')).map(call=>JSON.parse(call.body)).find(body=>body.embeds?.[0]?.title==='📌 Your creator directory')||f.messages.find(body=>body.embeds?.[0]?.title==='📌 Your creator directory');
    assert.ok(directory);
    assert.equal(f.messages.filter(m=>m.embeds?.[0]?.title==='💸 Your payment hub').length,1);
    const alerts=f.messages.filter(m=>m.embeds?.[0]?.title==='🎉 Posts published');
    assert.equal(alerts.length,1);assert.match(alerts[0].embeds[0].description,/\[TikTok\]/);assert.match(alerts[0].embeds[0].description,/\[Instagram\]/);
    await f.w.handle(f.interaction('post',fields));
    assert.equal(f.db.prepare('SELECT count(*) n FROM creator_posts').get().n,2);
  }finally{f.db.close();}
});

test('payment forms save privately, prefill edits and restrict manager detail access',async()=>{
  const f=await fixture({staffReviews:true});
  try {
    for(const method of ['wise','paypal','bank']) {
      await f.w.openModal({...f.interaction('pay_'+method),type:3},'pay_'+method);
      const fields=f.modals.at(-1).data.components;
      assert.ok(fields.length<=5);
      assert.equal(fields[0].component.required,method==='bank');
      assert.equal(fields[2].component.value,'USD');
      for(const field of fields){assert.ok(field.label.length<=45);assert.ok((field.description||'').length<=100);}
    }
    await f.w.handle(f.interaction('pay_paypal',{recipient:'',country:'US',currency:'usd',destination:'creator@example.com'}));
    assert.equal(JSON.parse(f.c().payment_details).currency,'USD');
    const hub=f.replies.at(-1);
    assert.match(hub.embeds[0].description,/PayPal · USD/);
    assert.match(hub.embeds[0].description,/Not calculated yet/);
    assert.ok(!JSON.stringify(hub).includes('creator@example.com'));
    assert.deepEqual(hub.allowed_mentions,{parse:[]});
    const alert=f.messages.find(m=>m.embeds?.[0]?.title==='💸 Payment details saved');
    assert.ok(alert);assert.ok(!JSON.stringify(alert).includes('creator@example.com'));
    await f.w.openModal({...f.interaction('pay_paypal'),type:3},'pay_paypal');
    assert.equal(f.modals.at(-1).data.components.at(-1).component.value,'creator@example.com');
    const i={...f.interaction('payment_profile'),channel_id:'reviews'};i.data.custom_id=`gt:review:${uid}:payment_profile`;
    await assert.rejects(f.w.handle(i),/staff/);
    i.member={user:{id:other},roles:['staff']};await f.w.handle(i);
    assert.match(f.replies.at(-1).embeds[0].description,/creator@example.com/);
  }finally{f.db.close();}
});

test('uploaded draft reaches staff review; empty or ambiguous submissions do not',async()=>{
  const f=await fixture();
  try {
    patchCreator(f.db,uid,{stage:'first_video'});
    await assert.rejects(f.w.handle(f.interaction('first_video')),/either/);
    const i=f.interaction('first_video');
    i.data.components.push({type:18,component:{type:19,custom_id:'video_file',values:['file']}});
    i.data.resolved={attachments:{file:{id:'file',filename:'draft.mp4',size:3,content_type:'video/mp4',url:'https://cdn.discordapp.com/attachments/1/2/draft.mp4'}}};
    const both=structuredClone(i);both.data.components[0].components.push({custom_id:'url',value:'https://example.com/draft.mp4'});
    await assert.rejects(f.w.handle(both),/either/);
    assert.equal(f.c().stage,'first_video');
    await f.w.handle(i);
    assert.equal(f.c().stage,'first_video_review');
    assert.equal(f.c().first_video_url,'https://discord.com/channels/guild/channel/upload');
    assert.match(f.replies.at(-1).content,/Review submitted draft/);
    assert.match(JSON.stringify(flow.staffCard(f.c(),true)),/guild\/channel\/upload/);
  } finally { f.db.close(); }
});

test('interaction deferral makes creator receipts public and staff controls private',async()=>{
  const f=await fixture(), original=globalThis.fetch, callbacks=[];
  try {
    globalThis.fetch=async(url,init={})=>{
      if(url.endsWith('/callback'))callbacks.push(JSON.parse(init.body));
      return new Response('{}',{status:200});
    };
    await handleInteraction(config,f.db,{...f.interaction('accounts'),token:'test'});
    assert.equal(callbacks.at(-1).type,5);
    assert.equal(callbacks.at(-1).data.flags,undefined);
    await handleInteraction(config,f.db,{...f.interaction('staff',{},config.ownerId),token:'test'});
    assert.equal(callbacks.at(-1).data.flags,64);
  } finally {globalThis.fetch=original;f.db.close();}
});

test('welcome says Start onboarding and reminders wait for inactivity without duplicating it',async()=>{
  assert.equal(flow.startCard().components[0].components[0].label,'Start onboarding');
  assert.match(flow.startCard().embeds[0].description,/Choose Start onboarding/);
  const f=await fixture();
  try {
    patchCreator(f.db,uid,{sync_pending:0,last_followup_at:iso(now)});
    await f.w.schedule(now+60000);
    assert.equal(f.messages.length,0);
    await f.w.schedule(now+flow.DAY);
    assert.equal(f.messages.length,1);
    assert.equal(f.messages[0].embeds[0].title,'Your next onboarding step');
    assert.doesNotMatch(f.messages[0].embeds[0].description,/Welcome|YOUR ONBOARDING/);
    await f.w.schedule(now+flow.DAY+60000);
    assert.equal(f.messages.length,1);
    patchCreator(f.db,uid,{stage:'account_review'});
    await f.w.schedule(now+3*flow.DAY);
    assert.equal(f.messages.length,1);
    patchCreator(f.db,uid,{stage:'first_video',updated_at:iso(now+3*flow.DAY)});
    await f.w.schedule(now+3*flow.DAY+60000);
    assert.equal(f.messages.length,1);
  } finally {f.db.close();}
});

test('account setup requires TikTok and Instagram profiles and excludes YouTube',async()=>{
  const f=await fixture();
  try {
    for(const accounts of ['https://www.youtube.com/@test','https://www.tiktok.com/@test','https://www.tiktok.com/@test https://www.instagram.com/reel/123/','https://www.tiktok.com/@test https://www.instagram.com/test/ https://youtube.com/@test'])
      await assert.rejects(f.w.handle(f.interaction('accounts',{accounts,timezone:'UTC'})),/both your TikTok and Instagram/);
    await f.w.handle(f.interaction('accounts',{accounts:'https://www.tiktok.com/@test\nhttps://www.instagram.com/test/',timezone:'UTC'}));
    assert.equal(f.c().campaign_accounts,'https://www.tiktok.com/@test\nhttps://www.instagram.com/test/');
  }finally{f.db.close();}
});

test('labeled account handles and profile links normalize without AI',()=>{
  const expected='https://www.tiktok.com/@example\nhttps://www.instagram.com/example/';
  for(const input of ['TikTok: @Example\nInstagram: @Example','TT account = example; IG handle: @example','TikTok username example Instagram account example','tiktok.com/@Example instagram.com/Example?igsh=123','TikTok: https://www.tiktok.com/@example\nIG: example'])assert.equal(flow.parseAccountLinks(input),expected);
  for(const input of ['@example\n@example','TikTok: @example','TikTok: instagram.com/example\nIG: example','TikTok: @example\nYouTube: @example','TikTok: @example\nIG: instagram.com/reel/123','TikTok: https://tiktok.com.evil.test/@example\nIG: example'])assert.throws(()=>flow.parseAccountLinks(input));
});

test('account errors identify the token and exact parser failure',()=>{
  assert.throws(()=>flow.parseAccountLinks('TikTok: @evan'),/Instagram account is missing/);
  assert.throws(()=>flow.parseAccountLinks('@evan IG: @evan'),/couldn’t parse “@evan”.*\nThis entry has no recognized platform label/);
  assert.throws(()=>flow.parseAccountLinks('TT: instagram.com/evan IG: evan'),/label says tiktok, but this URL belongs to instagram/);
  assert.throws(()=>flow.parseAccountLinks('TT: @bad! IG: evan'),/unsupported characters/);
});
test('creator receipts reuse supplied copy and preserve next steps',()=>{
  const c={name:'Evan',timezone:'America/New_York'};
  assert.match(creatorSuccess('accounts',c),/Nice work, Evan.*accounts are submitted for review/s);
  assert.doesNotMatch(creatorSuccess('accounts',c),/Send for review/);
  assert.ok(messageCopy(8,c.name).includes('Got it, Evan.'));
  assert.match(creatorSuccess('first_video',c),/Got it, Evan/);
  for(const action of ['accounts','ready','complete_warmup','signed','first_video','post','leave'])assert.doesNotMatch(creatorSuccess(action,c),/undefined/);
  assert.equal(creatorSuccess('approve_account',c),undefined);
});

test('staff cards omit debug previews while the staff slash command remains available',()=>{
  for(const stage of Object.keys(flow.STAGES))assert.doesNotMatch(JSON.stringify(flow.staffCard({name:'Evan',stage},true)),/test_clock|Preview future dates/);
  assert.ok(adminCommand.options.some(o=>o.name==='preview'));
  assert.ok(adminCommand.options.some(o=>o.name==='health'));
});

test('account approval pings only the creator once with the current status link',async()=>{
  const f=await fixture();
  try {
    patchCreator(f.db,uid,{stage:'account_review',campaign_accounts:'https://www.tiktok.com/@test\nhttps://www.instagram.com/test/',timezone:'UTC'});
    const i=f.interaction('approve_account',{},other);
    await f.w.handle(i);
    const notices=()=>f.messages.filter(m=>m.embeds?.[0]?.title==='🎉 Your accounts are approved!');
    assert.equal(notices().length,1);
    assert.equal(notices()[0].content,`<@${uid}>`);
    assert.deepEqual(notices()[0].allowed_mentions,{parse:[],users:[uid]});
    assert.ok(notices()[0].embeds[0].description.includes(`https://discord.com/channels/${config.guildId}/channel/${f.c().status_message_id}`));
    assert.equal(notices()[0].approval_creator_id,undefined);
    await f.w.handle(i);await f.w.deliver();
    assert.equal(notices().length,1);
  }finally{f.db.close();}
});

test('warm-up completion alerts the reviewer only in the staff channel, once',async()=>{
  const f=await fixture({staffReviews:true});
  try {
    patchCreator(f.db,uid,{stage:'account_ready'});
    const i=f.interaction('complete_warmup');
    await f.w.handle(i);
    const alerts=()=>f.calls.filter(c=>c.method==='POST'&&c.path==='/channels/reviews/messages');
    assert.equal(alerts().length,1);
    const payload=JSON.parse(alerts()[0].body);
    assert.equal(payload.content,`<@&${resources.role_staff}>`);
    assert.deepEqual(payload.allowed_mentions,{parse:[],roles:[resources.role_staff]});
    assert.match(payload.embeds[0].description,/take action below/);
    assert.ok(payload.embeds[0].description.includes(`/channel/${f.c().status_message_id}`));
    await f.w.handle(i);
    assert.equal(alerts().length,1);
  }finally{f.db.close();}
});

test('admin decisions notify creators with next steps; warm-up approval pings once',async()=>{
  for(const action of ['approve_account','approve_warmup','send_agreement','confirm_signature','approve_first_video','changes','revise_first_video','pass_trial','extend_trial','exception','deny_leave','reopen']) {
    const note=creatorDecision(action,{name:'Evan',exception_until:iso(now+flow.DAY)},'Fix the opening hook.');
    assert.ok(note[1].includes('{status_link}'),action);
    assert.doesNotMatch(note.join(' '),/undefined|NaN/);
  }
  assert.equal(creatorDecision('agreement_link',{}),null);
  const f=await fixture();
  try {
    patchCreator(f.db,uid,{stage:'warmup_review',account_approved_at:iso(now)});
    const i=f.interaction('approve_warmup',{},other);await f.w.handle(i);
    assert.equal(f.c().stage,'agreement');
    assert.ok(f.c().warmup_approved_at);
    assert.ok(f.c().agreement_url.startsWith('https://'));
    assert.ok(flow.statusCard(f.c(),true).components.flatMap(r=>r.components).some(b=>b.label==='Review & sign'&&b.url===f.c().agreement_url));
    const notices=()=>f.messages.filter(m=>m.embeds?.[0]?.title==='✅ Warm-up approved — your contract is ready!');
    assert.equal(notices().length,1);
    assert.equal(notices()[0].content,`<@${uid}>`);
    assert.deepEqual(notices()[0].allowed_mentions,{parse:[],users:[uid]});
    assert.match(notices()[0].embeds[0].description,/Review & sign/);
    assert.ok(notices()[0].embeds[0].description.includes(`/channel/${f.c().status_message_id}`));
    await f.w.handle(i);assert.equal(notices().length,1);
  }finally{f.db.close();}
});

test('combined warm-up approval preserves a custom contract and checks prerequisites',()=>{
  const c={stage:'warmup_review',account_approved_at:iso(now),agreement_url:'https://example.com/personal-contract'};
  const result=flow.transition(c,'approve_warmup',{now});
  assert.equal(result.stage,'agreement');assert.equal(result.agreement_url,c.agreement_url);
  assert.throws(()=>flow.transition({...c,account_approved_at:null},'approve_warmup',{now}),/Account approval/);
  assert.throws(()=>flow.transition({...c,agreement_url:'invalid'},'approve_warmup',{now}),/valid HTTPS/);
});

test('status card is pinned once and stays pinned across every workflow stage',async()=>{
  const f=await fixture();
  try {
    await f.w.sync(f.c());
    const id=f.c().status_message_id;
    assert.equal(f.messages.find(m=>m.id===id).pinned,true);
    for(const stage of Object.keys(flow.STAGES)) {
      patchCreator(f.db,uid,{stage});await f.w.sync(f.c());
      assert.equal(f.c().status_message_id,id);
    }
    const pins=()=>f.calls.filter(c=>c.path.includes('/messages/pins/')&&c.method==='PUT');
    assert.equal(pins().length,1);
    f.messages.find(m=>m.id===id).pinned=false;
    await f.w.sync(f.c());assert.equal(pins().length,2);
  }finally{f.db.close();}
});

test('drafts, revisions, published posts and leave all notify the staff reviewer',async()=>{
  const f=await fixture({staffReviews:true});
  try {
    patchCreator(f.db,uid,{stage:'first_video'});
    await f.w.handle(f.interaction('first_video',{url:'https://example.com/v1.mp4'}));
    const alerts=()=>f.calls.filter(c=>c.path==='/channels/reviews/messages'&&c.method==='POST').map(c=>JSON.parse(c.body));
    assert.equal(alerts().length,1);
    assert.match(alerts()[0].embeds[0].description,/v1.mp4/);
    await f.w.handle(f.interaction('revise_first_video',{reason:'Fix hook'},other));
    await f.w.handle(f.interaction('first_video',{url:'https://example.com/v2.mp4'}));
    assert.equal(alerts().length,2);
    assert.match(alerts()[1].embeds[0].description,/v2.mp4/);
    patchCreator(f.db,uid,{stage:'trial'});
    await f.w.handle(f.interaction('post',{url:'https://www.tiktok.com/@test/video/123'}));
    await f.w.handle(f.interaction('leave',{reason:'Away tomorrow'}));
    assert.equal(alerts().length,4);
    for(const m of alerts())assert.deepEqual(m.allowed_mentions,{parse:[],roles:[resources.role_staff]});
    assert.equal(BigInt(privateOverwrites(config,resources,uid).find(o=>o.id===uid).allow)&(1n<<51n),0n);
  }finally{f.db.close();}
});

test('first-video approval pings the creator to post and immediately enables reporting links',async()=>{
  const f=await fixture();
  try {
    patchCreator(f.db,uid,{stage:'first_video_review',agreement_signed_at:iso(now),first_video_url:'https://example.com/draft.mp4'});
    const i=f.interaction('approve_first_video',{},other);await f.w.handle(i);
    const m=f.messages.find(m=>m.embeds?.[0]?.title==='🔥 Your video is approved — time to post!');
    assert.equal(m.content,`<@${uid}>`);
    assert.deepEqual(m.allowed_mentions,{parse:[],users:[uid]});
    assert.match(m.embeds[0].description,/TikTok and Instagram/);
    assert.match(m.embeds[0].description,/Submitted post/);
    assert.ok(flow.statusCard(f.c(),true).components.flatMap(r=>r.components).some(b=>b.custom_id==='gt:post'));
    await f.w.openModal({...f.interaction('post'),type:3},'post');
    await f.w.handle(f.interaction('post',{url:'https://www.tiktok.com/@test/video/456'}));
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM creator_posts').get().n,1);
    assert.equal(f.c().stage,'hub_ready');
    assert.equal(f.c().trial_started_at,null);
  }finally{f.db.close();}
});

test('visible cards contain no test copy or signature simulation buttons',()=>{
  for(const stage of Object.keys(flow.STAGES)) {
    const c={name:'Evan',stage,timezone:'UTC',exception_until:null};
    for(const card of [flow.statusCard(c,true),flow.staffCard(c,true),flow.helpCard(c)])assert.doesNotMatch(JSON.stringify(card),/test server|test action|simulate signature|test_signed|deadline passed · test/i);
  }
  assert.doesNotMatch(JSON.stringify(flow.guideCard()),/test server/i);
});

test('preferred names allow nicknames and preserve multiword names in greetings',()=>{
  const fields={phone:'+15555555555',location:'NY',platforms:'TikTok @example'};
  assert.equal(flow.validateApplication({...fields,name:'Q'}).ok,true);
  assert.equal(flow.validateApplication({...fields,name:'  Mary Jane  '}).value.name,'Mary Jane');
  assert.equal(flow.validateApplication({...fields,name:'   '}).ok,false);
  assert.match(messageCopy(5,'Mary Jane'),/Nice work, Mary Jane/);
});

test('account parsing tolerates common pasted formatting without guessing a platform',()=>{
  const expected='https://www.tiktok.com/@example\nhttps://www.instagram.com/example/';
  for(const input of ['• Tik Tok： @ example\n• IG — @example','1. TikTok profile: (@example)\n2. Instagram link: <instagram.com/example/>','TT@example\nIG@example','http://m.tiktok.com/example instagram.com/@example/','[TikTok](https://www.tiktok.com/@example)\n[Instagram](https://instagram.com/example/)'])assert.equal(flow.parseAccountLinks(input),expected,input);
  assert.doesNotThrow(()=>flow.parseAccountLinks('TT: unusually_long_handle_for_staff_to_review\nIG: name..with.dots'));
  assert.throws(()=>flow.parseAccountLinks('@unlabeled\n@unlabeled'),/platform label/);
});

test('trial and agreement stage gates cannot be skipped',()=>{
  assert.throws(()=>flow.transition({stage:'warmup'},'pass_trial',{now}),/unavailable/);
  assert.throws(()=>flow.transition({stage:'account_ready'},'send_agreement',{now,testMode:true}),/unavailable/);
  assert.throws(()=>flow.transition({stage:'trial'},'pass_trial',{now}),/signed/);
  assert.throws(()=>flow.transition({stage:'trial',agreement_signed_at:iso(now),trial_ends_at:iso(now+1)},'pass_trial',{now}),/not ended/);
  assert.equal(flow.transition({stage:'trial',agreement_signed_at:iso(now-7*flow.DAY),trial_ends_at:iso(now)},'pass_trial',{now}).stage,'active');
  assert.throws(()=>flow.transition({stage:'agreement'},'test_signed',{now,testMode:false}),/test server/);
});
test('three missed days then four full days at risk',()=>{
  const base={stage:'active',lastPostAt:iso(now),timezone:'UTC',testMode:true};
  assert.equal(flow.inactivityDecision({...base,now}), 'none');
  for(const day of [1,2])assert.equal(flow.inactivityDecision({...base,now:now+day*flow.DAY}),'reminder');
  assert.equal(flow.inactivityDecision({...base,now:now+3*flow.DAY}),'at_risk');
  for(const day of [3,4,5,6])assert.equal(flow.inactivityDecision({...base,stage:'at_risk',riskStartedAt:iso(now+3*flow.DAY),now:now+day*flow.DAY}),'warning');
  assert.equal(flow.inactivityDecision({...base,stage:'at_risk',riskStartedAt:iso(now+3*flow.DAY),now:now+7*flow.DAY}),'would_remove');
  assert.throws(()=>flow.transition({stage:'at_risk',risk_started_at:iso(now)},'offboard',{now:now+flow.DAY,testMode:true}),/full At Risk/);
});
test('timezone boundaries and DST use local dates',()=>{
  assert.equal(flow.localDay(Date.parse('2026-03-08T07:01:00Z'),'America/New_York'),flow.localDay(Date.parse('2026-03-08T06:59:00Z'),'America/New_York'));
  assert.equal(flow.missedDays({last_post_at:'2026-09-07T01:00:00Z',timezone:'America/New_York'},Date.parse('2026-09-07T12:00:00Z')),1);
  assert.throws(()=>flow.validateTimezone('New York'),/timezone/);
});
test('leave preserves all remaining risk time and pending pause',()=>{
  const c={stage:'at_risk',risk_started_at:iso(now-flow.DAY),notice_requested_at:iso(now-flow.DAY/2)};
  const p=approveLeave(c,2,'Family leave',now);
  assert.equal(Date.parse(p.risk_started_at),now+1.5*flow.DAY);
  assert.equal(p.notice_pending,0);
  assert.equal(flow.inactivityDecision({stage:'at_risk',lastPostAt:iso(now-4*flow.DAY),riskStartedAt:p.risk_started_at,exceptionUntil:p.exception_until,now:now+flow.DAY,testMode:true}),'excepted');
});
test('highest tier is an estimate and partner is provisional',()=>{
  assert.deepEqual([49999,50000,100000,300000,1000000].map(flow.payoutForViews),[0,20,50,100,500]);
  assert.equal(flow.evaluateVideo({plug:true,mention:true,yap:true,partner:false,views:100000}).eligible,true);
  assert.deepEqual(flow.evaluateVideo({plug:false,mention:true,yap:true,partner:false,views:100000}).missing,['GoTall plug in the video']);
});
test('optional video, core phone validation, canonical duplicate URLs',()=>{
  assert.equal(flow.validateApplication({name:'Test',phone:'+15555555555',location:'NY',platforms:'TikTok @a',bestVideo:''}).ok,true);
  assert.equal(flow.validateApplication({name:'Test',phone:'-------',location:'NY',platforms:'TikTok @a'}).ok,false);
  assert.equal(flow.canonicalVideo('https://www.tiktok.com/@a/video/123?tracking=1').key,flow.canonicalVideo('https://www.tiktok.com/@a/video/123').key);
  assert.throws(()=>flow.canonicalVideo('https://tiktok.com.evil.example/@a/video/123'));
});
test('staff role and channel isolation',()=>{
  assert.equal(isStaff({member:{user:{id:other},roles:['staff']}},config,resources),true);
  assert.equal(isStaff({member:{user:{id:uid},roles:['active']}},config,resources),false);
  const overwrites=privateOverwrites(config,resources,config.ownerId);
  assert.equal(overwrites.filter(o=>o.id===config.ownerId).length,1);
  assert.equal(overwrites.find(o=>o.id===config.guildId).deny,'1024');
  assert.equal(overwrites.some(o=>o.id==='active'),false);
});
test('creator-to-staff lifecycle, repeated event, duplicate post, retry delivery',async()=>{
  const f=await fixture();
  try {
    await f.w.handle(f.interaction('accounts',{accounts:'https://www.tiktok.com/@test https://www.instagram.com/test/',timezone:'America/New_York'}));
    assert.equal(f.c().stage,'account_review');
    await assert.rejects(f.w.handle(f.interaction('approve_account')),/staff/);
    await f.w.handle(f.interaction('approve_account',{},other));
    await f.w.handle(f.interaction('complete_warmup'));
    await f.w.handle(f.interaction('approve_warmup',{},other));
    await f.w.handle(f.interaction('test_signed'));
    assert.equal(f.c().stage,'first_video');
    await f.w.handle(f.interaction('first_video',{url:'https://example.com/draft.mp4'}));
    await f.w.handle(f.interaction('approve_first_video',{},other));
    await f.w.handle(f.interaction('open_hub',{},other));
    assert.equal(f.c().stage,'trial');
    const i=f.interaction('extend_trial',{},other);
    await f.w.handle(i);const end=f.c().trial_ends_at;
    await f.w.handle(i);assert.equal(f.c().trial_ends_at,end);
    await f.w.handle(f.interaction('post',{url:'https://www.tiktok.com/@test/video/123'}));
    const post=f.c().last_post_at;
    await f.w.handle(f.interaction('post',{url:'https://www.tiktok.com/@test/video/123?x=1'}));
    assert.equal(f.c().last_post_at,post);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM creator_posts').get().n,1);
    f.fail();await f.w.handle(f.interaction('leave',{reason:'Tomorrow away'}));
    assert.equal(f.c().notice_pending,1);assert.equal(f.c().sync_pending,1);
    await f.w.schedule();assert.equal(f.c().sync_pending,0);
    const count=f.messages.length;await f.w.schedule();assert.equal(f.messages.length,count);
    assert.equal(f.c().stage,'trial');
    assert.equal(f.calls.some(c=>c.method==='DELETE'&&/members\/\d+$/.test(c.path)),false);
  } finally {f.db.close();}
});
test('posting cannot skip signing and another creator cannot access forms',async()=>{
  const f=await fixture();try{
    await assert.rejects(f.w.handle(f.interaction('post',{url:'https://www.tiktok.com/@a/video/123'})),/unavailable/);
    const i=f.interaction('accounts',{},'444444444444444444');
    await assert.rejects(f.w.openModal(i,'accounts'),/another creator/);
    assert.equal(f.c().stage,'warmup');
  }finally{f.db.close();}
});
test('wrong guild and live mode are ignored before accessing Discord',async()=>{
  const db=await openDatabase(':memory:');try{
    await handleInteraction({...config,guildId:'production'},db,{guild_id:'production'});
    await handleInteraction({...config,testMode:false},db,{guild_id:config.guildId});
  }finally{db.close();}
});
test('resuming posting restores the trial rather than promoting to active',()=>{
  assert.equal(flow.transition({stage:'at_risk',resume_stage:'trial'},'post',{now}).stage,'trial');
});

test('described modal fields accept Discord label responses and legacy responses',async()=>{
  const input=flow.formInput('timezone','Posting timezone','America/New_York',80,1,true,'Used to count posting days.');
  assert.equal(input.type,18);assert.ok(input.description);
  assert.equal(input.component.custom_id,'timezone');assert.equal(input.component.required,true);
  const f=await fixture();try{
    const i=f.interaction('accounts');
    i.data.components=[{type:18,component:{type:4,custom_id:'accounts',value:'https://www.tiktok.com/@test_name https://www.instagram.com/test_name/'}},{type:18,component:{type:4,custom_id:'timezone',value:'America/New_York'}}];
    await f.w.handle(i);
    assert.equal(f.c().timezone,'America/New_York');assert.equal(f.c().stage,'account_review');
    assert.match(f.replies.at(-1).content,/submitted for review/);
    assert.match(f.replies.at(-1).content,/discord.com\/channels\//);
    assert.deepEqual(flow.modalValues(f.interaction('accounts',{timezone:'UTC'})),{timezone:'UTC'});
  }finally{f.db.close();}
});

test('unchanged channel name is omitted and channel failure does not block status or deadlines',async()=>{
  const f=await fixture({channelFailure:true});try{
    await assert.rejects(f.w.sync(f.c()),/rate limit/);
    const body=JSON.parse(f.calls.find(c=>c.path==='/channels/channel'&&c.method==='PATCH').body);
    assert.equal('name' in body,false);assert.equal('parent_id' in body,false);
    assert.ok(f.c().status_message_id);
    patchCreator(f.db,uid,{stage:'at_risk',risk_started_at:iso(now-4*flow.DAY),last_post_at:iso(now-7*flow.DAY),sync_pending:1});
    await f.w.schedule(now);
    assert.equal(f.c().stage,'removal_due');assert.equal(f.c().sync_pending,1);
    assert.ok(f.calls.some(c=>c.path.includes('/messages/')&&c.method==='PATCH'&&c.body.includes('Posting deadline passed')));
    assert.ok(f.messages.some(m=>m.embeds?.[0]?.title==='Posting deadline passed'));
  }finally{f.db.close();}
});

const adminInteraction=(name,values={},user=other,id='admin-'+name)=>({id,type:2,guild_id:config.guildId,channel_id:'staff-room',member:{user:{id:user},roles:user===other?['staff']:[],permissions:'0'},data:{name:'creator',options:[{name,type:1,options:Object.entries(values).map(([name,value])=>({name,value}))}]}});
test('management commands require staff and explicit targets, including private reads',async()=>{
 const f=await fixture();try{
  await assert.rejects(handleAdminCommand(config,f.db,adminInteraction('history',{creator:uid},uid),f.w),/staff access/);
  await assert.rejects(handleAdminCommand(config,f.db,adminInteraction('approve-account'),f.w),/Select a creator/);
  await assert.rejects(handleAdminCommand(config,f.db,{...adminInteraction('help'),guild_id:'other'},f.w),/restricted/);
  await handleAdminCommand(config,f.db,adminInteraction('status',{creator:uid}),f.w);
  assert.deepEqual(f.replies.at(-1).components,[]);
 }finally{f.db.close();}
});
test('slash transitions use the same gates, explicit creator and idempotent event receipts',async()=>{
 const f=await fixture();try{
  await assert.rejects(handleAdminCommand(config,f.db,adminInteraction('approve-account',{creator:uid}),f.w),/unavailable/);
  patchCreator(f.db,uid,{stage:'account_review'});
  const i=adminInteraction('approve-account',{creator:uid});
  await handleAdminCommand(config,f.db,i,f.w);await handleAdminCommand(config,f.db,i,f.w);
  assert.equal(f.c().stage,'account_ready');assert.equal(f.c().account_approved_by,other);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM flow_events WHERE id=?').get(i.id).n,1);
  patchCreator(f.db,uid,{stage:'trial',agreement_signed_at:iso(Date.now()),trial_ends_at:iso(Date.now()+flow.DAY)});
  await assert.rejects(handleAdminCommand(config,f.db,adminInteraction('trial',{creator:uid,decision:'pass'}),f.w),/not ended/);
  patchCreator(f.db,uid,{stage:'removal_due'});
  await assert.rejects(handleAdminCommand(config,f.db,adminInteraction('reopen',{creator:uid,confirm:false}),f.w),/confirm:true/);
  await handleAdminCommand(config,f.db,adminInteraction('reopen',{creator:uid,confirm:true}),f.w);
  assert.equal(f.c().stage,'warmup');assert.equal(f.c().trial_ends_at,null);
 }finally{f.db.close();}
});
test('management leave, private notes, queue and history work across channels',async()=>{
 const f=await fixture();try{
  patchCreator(f.db,uid,{stage:'active',notice_pending:1,notice_requested_at:iso(Date.now())});
  await assert.rejects(handleAdminCommand(config,f.db,adminInteraction('approve-leave',{creator:uid,days:31,reason:'Travel'}),f.w),/1–30/);
  await handleAdminCommand(config,f.db,adminInteraction('approve-leave',{creator:uid,days:2,reason:'Travel'}),f.w);
  assert.equal(f.c().notice_pending,0);assert.ok(Date.parse(f.c().exception_until)>Date.now()+flow.DAY);
  const i=adminInteraction('note',{creator:uid,text:'Review profile on return.'});
  const messages=f.messages.length;
  await handleAdminCommand(config,f.db,i,f.w);await handleAdminCommand(config,f.db,i,f.w);
  assert.equal(f.messages.length,messages);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM staff_notes').get().n,1);
  await handleAdminCommand(config,f.db,adminInteraction('history',{creator:uid}),f.w);
  assert.match(JSON.stringify(f.replies.at(-1)),/Review profile on return/);
  await handleAdminCommand(config,f.db,adminInteraction('list',{queue:'leave'}),f.w);
  assert.match(f.replies.at(-1).embeds[0].description,/0 total/);
 }finally{f.db.close();}
});
test('slash schema stays within Discord limits and describes every argument',()=>{
 assert.ok(adminCommand.options.length<=25);
 for(const s of adminCommand.options){
  assert.ok(s.description.length>0&&s.description.length<=100);
  let optional=false;
  for(const o of s.options){assert.ok(o.description.length>0&&o.description.length<=100);if(!o.required)optional=true;else assert.equal(optional,false);}
 }
});

test('Blazie signing and first-video reviews require staff and cannot unlock Hub early',async()=>{
 const f=await fixture();try{
  await f.w.handle(f.interaction('accounts',{accounts:'https://www.tiktok.com/@test https://www.instagram.com/test/',timezone:'UTC'}));
  await f.w.handle(f.interaction('approve_account',{},other));
  await assert.rejects(f.w.handle(f.interaction('send_agreement',{},other)),/unavailable/);
  await f.w.handle(f.interaction('complete_warmup'));
  await assert.rejects(f.w.handle(f.interaction('approve_warmup')),/staff/);
  await f.w.handle(f.interaction('approve_warmup',{},other));
  assert.equal(f.c().agreement_url,'https://form.jotform.com/262506982690062');
  await f.w.handle(f.interaction('signed'));
  assert.equal(f.c().agreement_signed_at,null);
  await assert.rejects(f.w.handle(f.interaction('confirm_signature',{reason:'123'})),/staff/);
  await assert.rejects(f.w.handle(f.interaction('confirm_signature',{},other)),/reference/);
  await f.w.handle(f.interaction('confirm_signature',{reason:'Verified submission test-123; adult creator'},other));
  assert.equal(f.c().agreement_source,'staff_verified_jotform');
  await assert.rejects(f.w.handle(f.interaction('open_hub',{},other)),/unavailable/);
  await assert.rejects(f.w.handle(f.interaction('post',{url:'https://www.tiktok.com/@test/video/123'})),/unavailable/);
  await f.w.handle(f.interaction('first_video',{url:'https://example.com/draft'}));
  await f.w.handle(f.interaction('revise_first_video',{reason:'Make GoTall visible'},other));
  assert.equal(f.c().stage,'first_video');
  assert.match(flow.statusCard(f.c()).embeds[0].fields.find(x=>x.name==='Requested video changes').value,/GoTall visible/);
  await f.w.handle(f.interaction('first_video',{url:'https://example.com/draft-v2'}));
  await assert.rejects(f.w.handle(f.interaction('approve_first_video')),/staff/);
  await f.w.handle(f.interaction('approve_first_video',{},other));
  assert.equal(f.c().stage,'hub_ready');
  assert.equal(f.c().trial_started_at,null);
  assert.equal(f.calls.some(x=>x.method==='PUT'&&x.path.endsWith('/roles/active')),false);
  const i=f.interaction('open_hub',{},other);
  await f.w.handle(i); await f.w.handle(i);
  assert.equal(f.c().stage,'trial');
  assert.equal(Date.parse(f.c().trial_ends_at)-Date.parse(f.c().trial_started_at),7*flow.DAY);
  assert.equal(f.messages.filter(m=>m.embeds?.[0]?.title==='Your Creator Hub is open').length,1);
 }finally{f.db.close();}
});

test('new copy, placeholders, revised bonus boundaries and all three post platforms',async()=>{
 const {messageCopy}=await import('./messages.mjs');
 for(let n=1;n<=10;n++){
  const copy=messageCopy(n,'Evan Test');
  assert.doesNotMatch(copy,/\{\{first_name\}\}|\[NOTION|\[AGREEMENT LINK\]/);
  assert.ok(copy.length<4096);
 }
 assert.match(messageCopy(2,'Evan'),/https:\/\/example.com\/gotall\/account-creation/);
 assert.match(messageCopy(4),/placeholder, coming soon/);
 assert.match(messageCopy(7),/winning-formats/);
 assert.match(messageCopy(6),/262506982690062/);
 assert.match(flow.guideCard().embeds[0].description,/\$500 monthly completion payment/);
 for(const [views,expected] of [[49999,0],[50000,20],[99999,20],[100000,50],[299999,50],[300000,100],[499999,100],[500000,250],[699999,250],[700000,350],[999999,350],[1000000,500],[1999999,500],[2000000,1000]])assert.equal(flow.payoutForViews(views),expected);
 assert.equal(flow.canonicalVideo('https://youtube.com/shorts/abcdefghijk').key,flow.canonicalVideo('https://youtu.be/abcdefghijk').key);
 assert.equal(flow.canonicalVideo('https://youtube.com/watch?v=abcdefghijk').key,'youtube:abcdefghijk');
 assert.throws(()=>flow.canonicalVideo('https://youtube.com.evil.example/watch?v=abcdefghijk'));
});


test('topic rate limits do not block approvals or roles and topic has no changing stage',async()=>{
  const f=await fixture({topicFailure:true});try{
    patchCreator(f.db,uid,{stage:'account_review'});
    await f.w.handle(f.interaction('approve_account',{},other));
    assert.equal(f.c().stage,'account_ready');
    assert.equal(f.c().sync_pending,0);
    assert.match(f.replies.at(-1).content,/Accounts approved/);
    const patches=f.calls.filter(c=>c.path==='/channels/channel'&&c.method==='PATCH').map(c=>JSON.parse(c.body));
    assert.equal(Object.hasOwn(patches[0],'topic'),false);
    assert.equal(patches.at(-1).topic,`GoTall creator • user ${uid}`);
    assert.ok(f.calls.some(c=>c.path.endsWith('/roles/onboard')&&c.method==='PUT'));
  }finally{f.db.close();}
});


test('posts hub groups platform pairs, paginates and isolates owners and months',async()=>{
 const f=await fixture();
 try {
  patchCreator(f.db,uid,{timezone:'UTC'});
  for(let n=0;n<5;n++)for(const platform of ['tiktok','instagram']) {
   const key=`${platform}:fixture:${n}`;
   f.db.prepare('INSERT INTO creator_posts VALUES (?,?,?,?)').run(key,uid,`https://example.com/${platform}/${n}`,'2026-09-08T12:00:00Z');
   f.db.prepare('INSERT INTO creator_post_meta (video_key,submission_id,views,tracking_status) VALUES (?,?,?,?)').run(key,`pair:${n}`,platform==='tiktok'?1200:null,'pending');
  }
  f.db.prepare('INSERT INTO creator_posts VALUES (?,?,?,?)').run('tiktok:other',other,'https://example.com/other','2026-09-08T12:00:00Z');
  const first=postsCard(f.db,f.c(),resources,'2026-09',0);
  assert.equal(first.embeds[0].fields.length,4);assert.match(first.embeds[0].description,/5 recorded videos · 10 platform links/);
  assert.match(first.embeds[0].fields[0].value,/Views unavailable/);assert.ok(!JSON.stringify(first).includes('/other'));
  assert.equal(postsCard(f.db,f.c(),resources,'2026-09',1).embeds[0].fields.length,1);
  assert.match(postsCard(f.db,f.c(),resources,'2026-08').embeds[0].description,/No published links/);
  await assert.rejects(f.w.handle(f.interaction('posts:2026-09',{},'444444444444444444')),/another creator/);
  assert.throws(()=>postsCard(f.db,f.c(),resources,'2026-13'),/month/);
  assert.equal(monthKey(null,{timezone:'America/New_York'},new Date('2026-09-01T01:00:00Z')),'2026-08');
 }finally{f.db.close();}
});

test('payments distinguish estimates from owed money and calculate outstanding cents',async()=>{
 const f=await fixture();
 try {
  assert.match(paymentsCard(f.db,f.c(),resources,'2026-09').embeds[0].description,/Not calculated yet/);
  const statement={items_json:JSON.stringify([{label:'Eligible views',amount_cents:12450},{label:'Adjustment',amount_cents:-500}]),paid_cents:2000};
  assert.equal(statementAmounts(statement).outstanding,9950);
  f.db.prepare('INSERT INTO creator_statements (creator_id,month,currency,status,items_json,paid_cents,updated_at,sample_label) VALUES (?,?,?,?,?,?,?,?)').run(uid,'2026-09','USD','draft',statement.items_json,0,iso(now),'Simulated');
  const draft=paymentsCard(f.db,f.c(),resources,'2026-09');
  assert.match(draft.embeds[0].description,/Estimated earnings.*119.50/s);assert.match(draft.embeds[0].description,/Pending confirmation/);assert.match(draft.embeds[0].description,/simulated/);
  f.db.prepare("UPDATE creator_statements SET status='approved',paid_cents=2000 WHERE creator_id=?").run(uid);
  assert.match(paymentsCard(f.db,f.c(),resources,'2026-09').embeds[0].description,/Approved payout.*119.50/);
  assert.match(paymentsCard(f.db,{...f.c(),discord_user_id:other},resources,'2026-09').embeds[0].description,/Not calculated yet/);
  assert.throws(()=>statementAmounts({...statement,paid_cents:999999}),/totals/);
  assert.throws(()=>statementAmounts({...statement,items_json:'[{"label":"bad","amount_cents":1.5}]'}),/line items/);
 }finally{f.db.close();}
});

test('hub reports notify Manager once and manager resolutions notify the right creator once',async()=>{
 const f=await fixture({staffReviews:true});
 try {
  const i=f.interaction('hub_issue:payments:2026-09',{details:'Payment has not arrived.'},uid,'987654321');
  await f.w.openModal({...i,type:3},'hub_issue:payments:2026-09');
  assert.equal(f.modals.at(-1).data.custom_id,'gt:form:hub_issue:payments:2026-09');
  await f.w.handle(i);
  await f.w.handle(f.interaction('hub_issue:payments:2026-09',{details:'Duplicate follow-up'}));
  const alerts=f.messages.filter(m=>m.embeds?.[0]?.title==='💸 Payment problem reported');
  assert.equal(alerts.length,1);assert.deepEqual(alerts[0].allowed_mentions,{parse:[],roles:['staff']});
  assert.match(paymentsCard(f.db,f.c(),resources,'2026-09').embeds[0].description,/report is with the managers/);
  const resolution=f.interaction('hub_resolve:987654321',{resolution:'Your payment is scheduled. Check Payments.'},other,'987654322');
  resolution.channel_id='reviews';resolution.data.custom_id=`gt:form:review:${uid}:hub_resolve:987654321`;
  await assert.rejects(f.w.handle({...resolution,member:{user:{id:uid},roles:[]}}),/staff/);
  await f.w.handle(resolution);await f.w.deliver();
  const notices=f.messages.filter(m=>m.embeds?.[0]?.title==='Your report has been resolved');
  assert.equal(notices.length,1);assert.deepEqual(notices[0].allowed_mentions,{parse:[],users:[uid]});
  assert.ok(f.db.prepare('SELECT resolved_at FROM creator_hub_issues').get().resolved_at);
 }finally{f.db.close();}
});

test('posts and payments slash commands render privately and validate month input',async()=>{
 const f=await fixture(),original=globalThis.fetch,calls=[];
 try {
  globalThis.fetch=async(url,init={})=>{calls.push({url,body:init.body?JSON.parse(init.body):{}});return new Response('{}',{status:200});};
  for(const name of ['posts','payments']) {
   await handleInteraction(config,f.db,{...f.interaction(name),type:2,token:'test',data:{name,options:[{name:'month',value:'2026-09'}]}});
   assert.equal(calls.filter(c=>c.url.endsWith('/callback')).at(-1).body.data.flags,64);
   assert.match(calls.at(-1).body.embeds[0].title,name==='posts'?/Your posts/:/payment hub/);
  }
  assert.deepEqual(hubCommands.map(c=>c.name),['posts','payments']);
 }finally{globalThis.fetch=original;f.db.close();}
});


test('live source selection keeps provider observations separate and hides simulated money',async()=>{
 const f=await fixture();
 try {
  patchCreator(f.db,uid,{timezone:'UTC'});
  f.db.prepare('INSERT INTO creator_hub_sources (creator_id,accounts_json,preview_label) VALUES (?,?,?)').run(uid,'[]','@example');
  for(const [provider,views] of [['viral',1200],['tracker',1800]])f.db.prepare('INSERT INTO creator_hub_metrics (creator_id,provider,platform,video_id,url,title,published_at,views,observed_at,adapter,availability,handle) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(uid,provider,'tiktok','123','https://www.tiktok.com/@example/video/123','Example',Date.parse('2026-09-09'),views,Date.parse('2026-09-10'),provider,'public','example');
  const viral=postsCard(f.db,f.c(),resources,'2026-09',0,'viral');
  const tracker=postsCard(f.db,f.c(),resources,'2026-09',0,'tracker');
  assert.match(viral.embeds[0].fields[0].value,/1,200 views/);assert.doesNotMatch(viral.embeds[0].fields[0].value,/1,800/);
  assert.match(tracker.embeds[0].fields[0].value,/1,800 views/);assert.doesNotMatch(tracker.embeds[0].fields[0].value,/Missing.*Instagram/);
  assert.match(viral.components[0].components[2].custom_id,/:viral$/);
  for(const card of [viral,tracker,paymentsCard(f.db,f.c(),resources,'2026-09','viral')]) {
    const ids=card.components.flatMap(row=>row.components.map(button=>button.custom_id));
    assert.equal(new Set(ids).size,ids.length);
  }
  await f.w.handle(f.interaction('source_posts:2026-09:0:tracker'));
  assert.equal(f.db.prepare('SELECT preferred FROM creator_hub_sources WHERE creator_id=?').get(uid).preferred,'tracker');
  assert.match(f.replies.at(-1).embeds[0].description,/Metrics source: New tracker/);
  f.db.prepare('INSERT INTO creator_statements (creator_id,month,currency,status,items_json,paid_cents,updated_at,sample_label) VALUES (?,?,?,?,?,?,?,?)').run(uid,'2026-09','USD','paid','[{"label":"Demo","amount_cents":10000}]',10000,iso(now),'Sample');
  const payments=paymentsCard(f.db,f.c(),resources,'2026-09','viral');
  assert.match(payments.embeds[0].description,/Not calculated yet/);assert.doesNotMatch(payments.embeds[0].description,/100.00/);
  assert.throws(()=>postsCard(f.db,f.c(),resources,'2026-09',0,'invalid'),/Choose/);
 }finally{f.db.close();}
});


test('payments show calculated compensation without any payout records and refresh is deduplicated',async()=>{
 const f=await fixture();
 try{
  f.db.prepare('INSERT INTO creator_deal_bindings VALUES (?,?,?,?)').run(uid,'cc','org','@example');
  await f.w.handle(f.interaction('payments:2026-09'));
  const request=f.db.prepare('SELECT * FROM creator_earnings').get();assert.equal(request.state,'pending');
  await f.w.handle(f.interaction('payments:2026-09'));
  assert.equal(f.db.prepare('SELECT request_id FROM creator_earnings').get().request_id,request.request_id);
  const calculation={start_date:'2026-09-01',end_date:'2026-09-11',calculated_at:new Date().toISOString(),mode:'gained',summary:{totalPay:463.29,videoFixedPay:370,cpmPay:93.29,fixedPay:0,payableViews:93303,videos:53,unknownPaidVideos:53},creators:[{currency:'USD'}],warnings:['Some paid-view checks remain incomplete.']};
  f.db.prepare("UPDATE creator_earnings SET state='ready',payload_json=?").run(JSON.stringify(calculation));
  const card=paymentsCard(f.db,f.c(),resources,'2026-09');
  assert.match(card.embeds[0].description,/Estimated payout.*463.29/);
  assert.match(card.embeds[0].description,/Per-video fees.*370.00/);
  assert.match(card.embeds[0].description,/pending for 53 videos/);
  assert.doesNotMatch(card.embeds[0].description,/Recorded transfers|No finalized|:R>/);
  await f.w.handle(f.interaction('payments:2026-09'));
  assert.equal(f.db.prepare('SELECT state FROM creator_earnings').get().state,'ready');
  assert.doesNotMatch(paymentsCard(f.db,{...f.c(),discord_user_id:other},resources,'2026-09').embeds[0].description,/463.29/);
 }finally{f.db.close();}
});

test('recorded transfers stay separate from earnings and scoped to their creator',async()=>{
 const f=await fixture();
 try {
  f.db.prepare('INSERT INTO creator_hub_payout_sync VALUES (?,?)').run(uid,Date.now());
  f.db.prepare('INSERT INTO creator_hub_payout_records VALUES (?,?,?,?,?,?,?)').run(uid,'real-record',12500,'USD','PAID','2026-09-03','2026-09-03');
  f.db.prepare('INSERT INTO creator_hub_payout_records VALUES (?,?,?,?,?,?,?)').run(other,'other-record',99999,'USD','PAID','2026-09-03','2026-09-03');
  const description=paymentsCard(f.db,f.c(),resources,'2026-09').embeds[0].description;
  assert.match(description,/Not calculated yet/);assert.doesNotMatch(description,/125.00|PAID/);
  assert.doesNotMatch(description,/999.99/);assert.doesNotMatch(description,/Recorded transfers/);
 }finally{f.db.close();}
});


test('deal edits stay private drafts, publish a complete version and notify once',async()=>{
 const f=await fixture();
 try {
  const initial={currency:'USD',fixedFee:'100',fixedFeePerVideo:null,cpmAmount:'1',effectiveStartDate:'2026-09-01',effectiveEndDate:null,viewWindowDays:7,viewCapPerVideo:null,payoutCapPerVideo:'300',payoutCapTotal:null,perVideoCapScope:'CPM',deductPaidTraffic:true,paidTrafficMetric:'IMPRESSIONS',notes:'Post one video daily.'};
  f.db.prepare('INSERT INTO creator_imported_deals VALUES (?,?,?)').run(uid,'source',JSON.stringify(initial));
  const edit=f.interaction(`deal:${uid}:edit_rates:-1`,{},other);edit.data.custom_id=`gt:deal:${uid}:edit_rates:-1`;
  await assert.rejects(f.w.openModal({...edit,member:{user:{id:uid},roles:[]}},`deal:${uid}:edit_rates:-1`),/managers/);
  await f.w.openModal(edit,`deal:${uid}:edit_rates:-1`);
  assert.equal(f.modals.at(-1).data.components[0].component.value,'USD');
  for(const section of ['limits','rules','terms']) {
    await f.w.openModal(f.interaction(`deal:${uid}:edit_${section}:-1`,{},other),`deal:${uid}:edit_${section}:-1`);
    for(const field of f.modals.at(-1).data.components)assert.ok(field.label.length<=45);
  }
  const save=f.interaction(`deal:${uid}:save_rates:0`,{currency:'USD',fixedFee:'120',fixedFeePerVideo:'',cpmAmount:'1.50',fixedFeeRecognitionDate:''},other);
  await f.w.handle(save);
  assert.equal(currentDeal(f.db,f.c()).data.fixedFee,'100');
  assert.equal(f.messages.filter(m=>m.embeds?.[0]?.title==='📄 Your deal has been updated').length,0);
  assert.match(f.replies.at(-1).embeds[0].title,/draft/);
  await assert.rejects(f.w.handle(save),/draft changed/);
  const publish=f.interaction(`deal:${uid}:publish:1`,{},other);
  await f.w.handle(publish);await f.w.deliver();
  assert.equal(currentDeal(f.db,f.c()).version,1);assert.equal(currentDeal(f.db,f.c()).data.fixedFee,'120');
  const messages=f.messages.filter(m=>m.embeds?.[0]?.title==='📄 Your deal has been updated');
  assert.equal(messages.length,1);assert.deepEqual(messages[0].allowed_mentions,{parse:[],users:[uid]});
  await assert.rejects(f.w.handle(publish),/draft changed/);
  assert.equal(f.db.prepare('SELECT count(*) n FROM creator_deal_versions').get().n,1);
  await assert.rejects(f.w.handle(f.interaction(`deal:${uid}:view`,{},'444444444444444444')),/another creator/);
  assert.throws(()=>validateDealSection('rates',{currency:'USD',cpmAmount:'-1'}),/non-negative/);
  assert.throws(()=>validateDealSection('rules',{effectiveStartDate:'2026-02-30'}),/valid date/);
 }finally{f.db.close();}
});

test('deal summary hides details and managers get an edit menu with a change preview',async()=>{
 const f=await fixture();
 try{
  const initial={currency:'USD',cpmAmount:'1',effectiveStartDate:'2026-09-01',viewWindowDays:7,perVideoCapScope:'CPM',payoutCapPerVideo:'100',deductPaidTraffic:true,paidTrafficMetric:'IMPRESSIONS',notes:'Detailed posting requirements.'};
  f.db.prepare('INSERT INTO creator_imported_deals VALUES (?,?,?)').run(uid,'source',JSON.stringify(initial));
  const compact=dealCard(f.db,f.c(),true);
  assert.match(compact.embeds[0].description,/1 USD/);
  assert.equal(compact.embeds.length,1);
  assert.ok(!JSON.stringify(compact).includes(initial.notes));
  assert.deepEqual(compact.components[0].components.map(b=>b.label),['Full terms','History','Edit deal']);
  await f.w.handle(f.interaction(`deal:${uid}:full`,{},uid));
  assert.match(JSON.stringify(f.replies.at(-1)),/Detailed posting requirements/);
  await assert.rejects(f.w.handle(f.interaction(`deal:${uid}:edit`,{},uid)),/managers/);
  await f.w.handle(f.interaction(`deal:${uid}:edit`,{},other));
  assert.deepEqual(f.replies.at(-1).components[0].components.map(b=>b.label),['Pay & rates','Caps & limits','Dates & counting','Written terms']);
  await f.w.handle(f.interaction(`deal:${uid}:save_rates:0`,{currency:'USD',cpmAmount:'2'},other));
  assert.match(f.replies.at(-1).embeds[0].fields[0].value,/1 → 2/);
  assert.equal(currentDeal(f.db,f.c()).data.cpmAmount,'1');
 }finally{f.db.close();}
});

test('real deal publication uses an outbox and only confirms after shared database success',async()=>{
 const f=await fixture();
 try{
  const initial={id:'source',organizationId:'org',campaignCreatorId:'cc',dealVersionId:'v1',currency:'USD',cpmAmount:'1',effectiveStartDate:'2026-09-01',viewWindowDays:7,perVideoCapScope:'CPM',payoutCapPerVideo:'100',deductPaidTraffic:true,paidTrafficMetric:'IMPRESSIONS'};
  f.db.prepare('INSERT INTO creator_imported_deals VALUES (?,?,?)').run(uid,'source',JSON.stringify(initial));
  f.db.prepare('INSERT INTO creator_deal_bindings VALUES (?,?,?,?)').run(uid,'cc','org','@real-creator');
  await f.w.handle(f.interaction(`deal:${uid}:edit`,{},other));
  await f.w.handle(f.interaction(`deal:${uid}:save_rates:0`,{currency:'USD',cpmAmount:'2'},other));
  assert.match(f.replies.at(-1).embeds[0].description,/@real-creator/);
  assert.ok(f.replies.at(-1).components.flatMap(r=>r.components).some(b=>b.label==='Publish real deal'));
  await f.w.handle(f.interaction(`deal:${uid}:publish:1`,{},other));
  assert.equal(currentDeal(f.db,f.c()).data.cpmAmount,'1');
  const request=f.db.prepare('SELECT * FROM creator_deal_outbox').get();
  assert.equal(request.expected_version_id,'v1');assert.equal(request.status,'pending');
  assert.equal(f.db.prepare('SELECT count(*) n FROM creator_deal_versions').get().n,0);
  await assert.rejects(f.w.handle(f.interaction(`deal:${uid}:publish:1`,{},other)),/in progress/);
  const updated={...initial,id:'new',dealVersionId:'v2',cpmAmount:'2',effectiveStartDate:new Date().toISOString().slice(0,10)};
  f.db.prepare("UPDATE creator_deal_outbox SET status='published',result_json=?").run(JSON.stringify(updated));
  await f.w.deliver();await f.w.deliver();
  assert.equal(currentDeal(f.db,f.c()).data.cpmAmount,'2');
  assert.equal(f.messages.filter(m=>m.embeds?.[0]?.title==='📄 Deal published').length,1);
  assert.equal(f.db.prepare('SELECT count(*) n FROM creator_deal_drafts').get().n,0);
 }finally{f.db.close();}
});

test('scheduled shared deals stay separate and managers can edit their own source version',async()=>{
 const f=await fixture();
 try{
  const tomorrow=new Date(Date.now()+86400000).toISOString().slice(0,10);
  const source={id:'current',organizationId:'org',campaignCreatorId:'cc',dealVersionId:'v1',currency:'USD',cpmAmount:'1',effectiveStartDate:'2026-01-01',viewWindowDays:7,perVideoCapScope:'CPM',payoutCapPerVideo:'100',deductPaidTraffic:true,paidTrafficMetric:'IMPRESSIONS'};
  const scheduled={...source,id:'scheduled',dealVersionId:'v2',effectiveStartDate:tomorrow,cpmAmount:'2'};
  for(const d of [source,scheduled])f.db.prepare('INSERT INTO creator_imported_deals VALUES (?,?,?)').run(uid,d.id,JSON.stringify(d));
  f.db.prepare('INSERT INTO creator_deal_bindings VALUES (?,?,?,?)').run(uid,'cc','org','@real-creator');
  assert.equal(currentDeal(f.db,f.c()).data.cpmAmount,'1');
  assert.match(dealCard(f.db,f.c(),true).embeds[0].description,/Scheduled update/);
  await f.w.handle(f.interaction(`deal:${uid}:change:scheduled`,{},other));
  assert.equal(JSON.parse(f.db.prepare('SELECT payload_json FROM creator_deal_drafts').get().payload_json).effectiveStartDate,tomorrow);
  await f.w.handle(f.interaction(`deal:${uid}:save_rates:0`,{currency:'USD',cpmAmount:'3'},other));
  await f.w.handle(f.interaction(`deal:${uid}:publish:1`,{},other));
  assert.equal(f.db.prepare('SELECT expected_version_id FROM creator_deal_outbox').get().expected_version_id,'v2');
 }finally{f.db.close();}
});

test('two manager drafts cannot overwrite a newly published deal',async()=>{
 const f=await fixture();
 try {
  const initial={currency:'USD',cpmAmount:'1',effectiveStartDate:'2026-09-01',perVideoCapScope:'NONE',deductPaidTraffic:false,paidTrafficMetric:'IMPRESSIONS'};
  f.db.prepare('INSERT INTO creator_imported_deals VALUES (?,?,?)').run(uid,'source',JSON.stringify(initial));
  for(const user of [other,config.ownerId])await f.w.openModal(f.interaction(`deal:${uid}:edit_terms:-1`,{},user),`deal:${uid}:edit_terms:-1`);
  await f.w.handle(f.interaction(`deal:${uid}:publish:0`,{},other));
  await assert.rejects(f.w.handle(f.interaction(`deal:${uid}:publish:0`,{},config.ownerId)),/newer deal/);
  assert.equal(f.db.prepare('SELECT count(*) n FROM creator_deal_versions').get().n,1);
 }finally{f.db.close();}
});
