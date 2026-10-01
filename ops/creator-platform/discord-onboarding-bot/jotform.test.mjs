import {test} from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from './bot.mjs';
import {createWorkspace,patchCreator} from './workspace.mjs';
import {createJotform,inspectSubmission,jotformClient,JOTFORM_ID} from './jotform.mjs';
import * as flow from './flow.mjs';
import {webhookQueue,webhookPump} from './jotform-webhook.mjs';

const uid='222222222222222222',manager='333333333333333333',url=`https://form.jotform.com/${JOTFORM_ID}`;
const date={year:'2026',month:'09',day:'11'};
function submission(token,changes={}) {
  return {id:'7000000000000000000',form_id:JOTFORM_ID,status:'ACTIVE',answers:{
    '66':{answer:token},'49':{answer:{first:'Test',last:'Creator'}},
    '50':{answer:'https://www.jotform.com/uploads/test/262582983401057/signature.png'},'52':{answer:date},
  },...changes};
}
async function fixture() {
  const db=await openDatabase(':memory:');
  const at=new Date().toISOString();
  db.prepare('INSERT INTO creators(discord_user_id,name,phone,location,platforms,best_video,channel_id,stage,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)').run(uid,'Test Creator','','UTC','','','channel','agreement',at,at);
  patchCreator(db,uid,{agreement_url:url,account_approved_at:at,warmup_approved_at:at,timezone:'UTC'});
  return db;
}
test('provider validation rejects wrong form, status, link, invalid signature and partial guardian',()=>{
  const token='a'.repeat(64),s=submission(token);
  assert.equal(inspectSubmission(s,token).complete,true);
  for(const bad of [{...s,form_id:'123'},{...s,status:'DELETED'},{...s,answers:{...s.answers,'66':{answer:'b'.repeat(64)}}},{...s,answers:{...s.answers,'50':{answer:'https://evil.example/signature.png'}}},{...s,answers:{...s.answers,'52':{answer:{year:'2026',month:'02',day:'31'}}}},{...s,answers:{...s.answers,'55':{answer:{first:'Parent',last:'Creator'}}}}])assert.equal(inspectSubmission(bad,token).complete,false);
  assert.equal(inspectSubmission({...s,answers:{...s.answers,'55':{answer:{first:'Parent',last:'Creator'}},'56':s.answers['50'],'58':{answer:date}}},token).complete,true);
});
test('unique links, unmatched submissions, replay and reopened agreement isolation',async()=>{
  const db=await fixture();try{
    const events=[],j=createJotform(db,{apiKey:'fixture',onReceipt:(c,r)=>events.push(r)});
    const c=db.prepare('SELECT * FROM creators').get(),link=j.issue(c,url);
    assert.equal(j.issue(c,url),link);
    assert.equal(j.issue(c,'https://other.example/contract'),'https://other.example/contract');
    patchCreator(db,uid,{agreement_url:link});
    const token=new URL(link).searchParams.get('gotallAgreementToken');
    assert.equal(j.ingest(submission('b'.repeat(64))),null);
    const s=submission(token);j.ingest(s);j.ingest(s);
    assert.equal(events.length,1);assert.equal(j.receipt(uid).complete,1);
    j.invalidate(uid);const next=j.issue(c,url);assert.notEqual(next,link);
    patchCreator(db,uid,{agreement_url:next});
    assert.equal(j.ingest(s),null);assert.equal(j.receipt(uid),undefined);
    assert.equal(db.prepare('SELECT count(*) n FROM jotform_receipts').get().n,1);
  }finally{db.close();}
});
test('incomplete agreement explains guardian date and missing creator fields once across retries and restart',async()=>{
  const db=await fixture();try {
    let w=createWorkspace({jotformApiKey:'fixture'},db,{});
    const link=w.jotform.issue(w.creator(uid),url);patchCreator(db,uid,{agreement_url:link});
    const s=submission(new URL(link).searchParams.get('gotallAgreementToken'));
    s.answers['58']={answer:date};
    w.jotform.ingest(s);w.jotform.ingest(s);
    w=createWorkspace({jotformApiKey:'fixture'},db,{});w.jotform.ingest(s);
    let rows=db.prepare('SELECT payload FROM deliveries').all();assert.equal(rows.length,1);
    const p=JSON.parse(rows[0].payload);
    assert.match(p.embeds[0].description,/optional parent\/guardian/);
    assert.match(p.embeds[0].description,/clear the entire section, including its date/);
    assert.match(p.embeds[0].description,/\{status_link\}/);
    assert.equal(p.content,`<@${uid}>`);assert.deepEqual(p.allowed_mentions,{parse:[],users:[uid]});
    assert.equal(w.creator(uid).stage,'agreement');
    delete s.answers['49'];delete s.answers['50'];delete s.answers['52'];w.jotform.ingest(s);
    rows=db.prepare('SELECT payload FROM deliveries').all();assert.equal(rows.length,2);
    const message=JSON.parse(rows[1].payload).embeds[0].description;
    assert.match(message,/full name is missing/);assert.match(message,/signature is missing/);assert.match(message,/signing date is missing/);
  }finally{db.close();}
});
test('API authentication uses headers and never follows redirects or logs provider data',async()=>{
  let seen;const api=jotformClient('secret-fixture',async(u,o)=>{seen={u,o};return {ok:true,json:async()=>({responseCode:200,content:[]})};});
  await api('/form/262582983401057/submissions');
  assert.equal(seen.o.headers.APIKEY,'secret-fixture');assert.equal(seen.o.redirect,'error');assert.ok(!seen.u.includes('secret-fixture'));
  await assert.rejects(jotformClient('fixture',async()=>{throw Error('private provider response');})('/user'),e=>!e.message.includes('private provider response'));
});
test('revalidation blocks deleted submissions and API failures',async()=>{
  const db=await fixture();try{
    let rows=[],single,fail=false,requests=[];
    const request=async u=>{requests.push(u);if(fail)throw Error('offline');return {ok:true,json:async()=>({responseCode:200,content:u.includes('/questions')?{'66':{name:'gotallAgreementToken'},'50':{type:'control_signature'},'56':{type:'control_signature'}}:u.includes('/submission/')?single:u.includes('offset=100')?rows:[]})};};
    const j=createJotform(db,{apiKey:'fixture',request}),c=db.prepare('SELECT * FROM creators').get(),link=j.issue(c,url);
    patchCreator(db,uid,{agreement_url:link});const token=new URL(link).searchParams.get('gotallAgreementToken');single=submission(token);j.ingest(single);
    assert.equal((await j.verify({...c,agreement_url:link})).submissionId,single.id);
    single={...single,status:'DELETED'};await assert.rejects(j.verify({...c,agreement_url:link}),/no longer complete/);
    fail=true;await assert.rejects(j.verify({...c,agreement_url:link}),/unavailable/);
  }finally{db.close();}
});
test('poll paginates, waits five minutes, and resumes after a restart',async()=>{
  const db=await fixture();try{
    let linked,requests=0,events=0;
    const request=async u=>{requests++;return {ok:true,status:200,json:async()=>({responseCode:200,content:u.includes('/questions')?{'66':{name:'gotallAgreementToken'},'50':{type:'control_signature'},'56':{type:'control_signature'}}:u.includes('offset=100')?[linked]:Array.from({length:100},(_,i)=>submission('b'.repeat(64),{id:String(8000000000000000000n+BigInt(i))}))})};};
    let j=createJotform(db,{apiKey:'fixture',request,onReceipt:()=>events++});
    const c=db.prepare('SELECT * FROM creators').get(),link=j.issue(c,url);
    patchCreator(db,uid,{agreement_url:link});linked=submission(new URL(link).searchParams.get('gotallAgreementToken'));
    await j.poll(1_000_000);assert.equal(requests,3);assert.equal(events,1);
    await j.poll(1_000_001);assert.equal(requests,3);
    j=createJotform(db,{apiKey:'fixture',request,onReceipt:()=>events++});
    await j.poll(1_000_002);assert.equal(requests,6);assert.equal(events,1);assert.equal(j.receipt(uid).complete,1);
  }finally{db.close();}
});
test('missing signature cannot be approved through the API path',async()=>{
  const db=await fixture();try{
    const request=async u=>({ok:true,status:200,json:async()=>({responseCode:200,content:u.includes('/questions')?{'66':{name:'gotallAgreementToken'},'50':{type:'control_signature'},'56':{type:'control_signature'}}:[]})});
    const j=createJotform(db,{apiKey:'fixture',request});const c=db.prepare('SELECT * FROM creators').get();
    const link=j.issue(c,url);patchCreator(db,uid,{agreement_url:link});
    const s=submission(new URL(link).searchParams.get('gotallAgreementToken'));delete s.answers['50'];
    j.ingest(s);await assert.rejects(j.verify({...c,agreement_url:link}),/No complete Jotform submission/);
    assert.equal(db.prepare('SELECT agreement_signed_at FROM creators').get().agreement_signed_at,null);
  }finally{db.close();}
});
test('provider receipt automatically advances and notifies creator and Manager exactly once',async()=>{
  const db=await fixture();try {
    const messages=[],replies=[],resources={role_staff:'staff',role_onboarding:'onboarding',role_active:'active',role_at_risk:'risk',category_onboarding:'new',category_active:'live',category_at_risk:'risk',category_inactive:'done',channel_staff_reviews:'reviews'};
    let data=[];
    const request=async u=>({ok:true,status:200,json:async()=>({responseCode:200,content:u.includes('/questions')?{'66':{name:'gotallAgreementToken'},'50':{type:'control_signature'},'56':{type:'control_signature'}}:u.includes('/submission/')?data[0]:data})});
    const config={guildId:flow.TEST_GUILD_ID,testMode:true,applicationId:'bot',ownerId:'owner',jotformApiKey:'fixture'};
    const w=createWorkspace(config,db,{jotformFetch:request,resourceMap:()=>resources,input:flow.formInput,editReply:async(c,i,p)=>replies.push(p),api:async(c,path,init={})=>{
      if(path.includes('/messages?'))return messages;
      if(!init.method&&path==='/channels/channel')return {name:'🟡-test-creator',parent_id:'new',topic:`GoTall creator • user ${uid}`};
      if(init.method==='POST'&&path.endsWith('/messages')){const m={...JSON.parse(init.body),id:String(messages.length+1),author:{id:'bot'}};messages.push(m);return m;}
      return {};
    }});
    await w.sync(w.creator(uid));const linked=w.creator(uid),token=new URL(linked.agreement_url).searchParams.get('gotallAgreementToken');assert.equal(token.length,64);
    const now=Date.now();await w.jotform.poll(now,true);
    data=[submission(token)];await w.schedule(now+1000);assert.equal(w.creator(uid).stage,'agreement');
    const queue=webhookQueue(db);queue.enqueue();
    await webhookPump(queue,()=>w.schedule(now+1000,true))();assert.equal(queue.pending(),undefined);
    assert.equal(w.creator(uid).stage,'first_video');assert.ok(w.creator(uid).agreement_signed_at);
    assert.equal(w.creator(uid).agreement_source,'jotform_api');
    const receipts=()=>messages.filter(m=>m.embeds?.[0]?.title==='🎥 You’re ready for your first video!');
    assert.equal(receipts().length,1);assert.deepEqual(receipts()[0].allowed_mentions,{parse:[],users:[uid]});
    const managerAlerts=messages.filter(m=>m.content==='<@&staff>');assert.equal(managerAlerts.length,1);assert.match(JSON.stringify(managerAlerts[0]),/7000000000000000000/);
    assert.deepEqual(managerAlerts[0].allowed_mentions,{parse:[],roles:['staff']});
    assert.match(managerAlerts[0].embeds[0].description,/automatically moved to first-video/);
    assert.ok(!JSON.stringify(managerAlerts[0]).includes('confirm_signature'));
    await w.jotform.poll(Date.now(),true);await w.schedule();assert.equal(receipts().length,1);
    const i={id:'stale-signed-button',channel_id:'channel',type:3,member:{user:{id:uid},roles:[],permissions:'0'},data:{custom_id:'gt:signed'}};
    await w.handle(i);assert.equal(w.creator(uid).stage,'first_video');assert.equal(w.creator(uid).agreement_source,'jotform_api');
    assert.match(w.creator(uid).signature_evidence,/7000000000000000000/);
    assert.equal(messages.filter(m=>m.embeds?.[0]?.title==='🎥 You’re ready for your first video!').length,1);
    await w.handle(i);assert.equal(messages.filter(m=>m.embeds?.[0]?.title==='🎥 You’re ready for your first video!').length,1);
    assert.equal(messages.filter(m=>m.content==='<@&staff>').length,1);
  }finally{db.close();}
});

test('previous complete review receipts are reprocessed once by automatic progression',async()=>{
  const db=await fixture();try {
    const c=db.prepare('SELECT * FROM creators').get();
    const legacy=createJotform(db,{apiKey:'fixture'}),link=legacy.issue(c,url);
    patchCreator(db,uid,{agreement_url:link,stage:'agreement_review'});
    const s=submission(new URL(link).searchParams.get('gotallAgreementToken'));
    legacy.ingest(s);
    db.prepare('INSERT INTO flow_events VALUES (?,?,?,?,?)').run(`jotform:${s.id}`,uid,'jotform','submission_received',new Date().toISOString());
    const w=createWorkspace({jotformApiKey:'fixture'},db,{resourceMap:()=>({channel_staff_reviews:'reviews'})});
    w.jotform.ingest(s);w.jotform.ingest(s);
    assert.equal(w.creator(uid).stage,'first_video');
    assert.equal(db.prepare("SELECT count(*) n FROM flow_events WHERE action='agreement_signed'").get().n,1);
    assert.equal(db.prepare('SELECT count(*) n FROM deliveries').get().n,2);
  }finally{db.close();}
});

test('incomplete signing and notification configuration failures cannot partly advance onboarding',async()=>{
  const db=await fixture();try {
    const w=createWorkspace({jotformApiKey:'fixture'},db,{resourceMap:()=>({})});
    const c=w.creator(uid),link=w.jotform.issue(c,url);patchCreator(db,uid,{agreement_url:link});
    const s=submission(new URL(link).searchParams.get('gotallAgreementToken'));
    const incomplete={...s,answers:{...s.answers,'50':{answer:''}}};
    w.jotform.ingest(incomplete);
    assert.equal(w.creator(uid).stage,'agreement');assert.equal(w.creator(uid).agreement_signed_at,null);
    assert.throws(()=>w.jotform.ingest(s),/notification channel/);
    assert.equal(w.creator(uid).stage,'agreement');assert.equal(w.jotform.receipt(uid).complete,0);
    assert.equal(db.prepare('SELECT count(*) n FROM deliveries').get().n,1);
    assert.match(JSON.parse(db.prepare('SELECT payload FROM deliveries').get().payload).embeds[0].description,/signature is missing/);
    const ready=createWorkspace({jotformApiKey:'fixture'},db,{resourceMap:()=>({channel_staff_reviews:'reviews'})});
    ready.jotform.ingest(s);assert.equal(ready.creator(uid).stage,'first_video');
    assert.equal(db.prepare("SELECT message_id FROM deliveries WHERE id LIKE 'jotform-incomplete:%'").get().message_id,'superseded-by-auto-signing');
  }finally{db.close();}
});
