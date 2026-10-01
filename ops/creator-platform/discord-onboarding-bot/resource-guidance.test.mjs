import test from 'node:test';
import assert from 'node:assert/strict';
import { guidanceCards, resourcePermissions, syncResourceGuidance, TEST_RESOURCE_GUILD, VIEW, WRITE } from './resource-guidance.mjs';
import { accessTutorials, syncAccessTutorials, accessDirectory } from './app-access-guidance.mjs';

test('app access has brief native tutorials and explicit no-charge checks',async()=>{
  const directory=accessDirectory({channel_app_access:'channel',message_access_ios:'ios',message_access_android:'android'});
  assert.match(directory.embeds[0].description,/On iOS\?\*\* \[Click here\]\(https:\/\/discord.com\/channels\/1245112089647775877\/channel\/ios\)/);
  assert.match(directory.embeds[0].description,/On Android\?\*\* \[Click here\]\(https:\/\/discord.com\/channels\/1245112089647775877\/channel\/android\)/);
  assert.equal(accessTutorials.length,3);
  for(const tutorial of accessTutorials) {
    assert.ok(tutorial.description.length<1500);
    assert.doesNotMatch(tutorial.description,/notion|vercel/);
    assert.match(tutorial.description,/creator channel/);
  }
  for(const key of ['ios','android_unlock']) {
    const text=accessTutorials.find(t=>t.key===key).description;
    assert.match(text,/You will not be charged/);
    assert.match(text,/Stop before confirming/);
  }
  await assert.rejects(()=>syncAccessTutorials({config:{guildId:'production',testMode:true}}),/not enabled/);
});

test('compiled guidance fits Discord limits and consolidates current requirements without pings', () => {
  const resources = Object.fromEntries(['scripts','posting_checklist','app_access','assets','winning_formats','resource_faq','creator_guide','resource_announcements','legacy_submit','legacy_accounts'].map(k => [`channel_${k}`, '123456789012345678']));
  for(const key of ['ios','android','android_unlock'])resources[`message_access_${key}`]='123456789012345679';
  const cards = guidanceCards(resources);
  for (const body of Object.values(cards)) {
    assert.ok(body.embeds[0].description.length <= 4096);
    assert.ok(body.embeds[0].description.length + body.embeds[0].title.length + 40 < 6000);
    assert.deepEqual(body.allowed_mentions, { parse: [] });
    assert.doesNotMatch(JSON.stringify(body), /undefined|@everyone|@here/);
  }
  for (const key of ['creator_guide','posting_checklist','resource_faq','assets']) {
    assert.match(cards[key].embeds[0].description, /3 seconds/);
    assert.doesNotMatch(cards[key].embeds[0].description, /1\.5 seconds/);
  }
  assert.match(cards.posting_checklist.embeds[0].description, /#yap.*talking videos only/);
  assert.match(cards.posting_checklist.embeds[0].description, /Indefinitely/);
  for (const key of ['creator_guide','posting_checklist','resource_faq']) {
    assert.match(cards[key].embeds[0].description, /2 distinct approved videos per day/);
    assert.match(cards[key].embeds[0].description, /Legacy creators keep their agreed/);
  }
  assert.match(cards.creator_guide.embeds[0].description, /No manual invoice/);
  assert.doesNotMatch(cards.creator_guide.embeds[0].description, /\$|seven.day|bank transfer.*1st/i);
  const assets = cards.assets.embeds[0].description;
  assert.match(assets, /1RYq-wo_0eg_vxNTFsMtCBRjhXaGNv8oE/);
  assert.match(assets, /1G209VBPRlh0dQa1IxupnjEXq_xKs8pCC/);
  assert.doesNotMatch(assets, /13suZVywWDR-5yec_Vdm1d5pgHPi1INxN|1C7MWIlkK-9YjV1S3y1BFUUTYTc6i_EEP/);
});

function effective(overwrites, roles) {
  const everyone = overwrites.find(o => o.id === TEST_RESOURCE_GUILD);
  let allow = BigInt(everyone.allow), deny = BigInt(everyone.deny);
  for (const o of overwrites.filter(o => o.type === 0 && roles.includes(o.id))) { allow |= BigInt(o.allow); deny |= BigInt(o.deny); }
  return (0n & ~deny) | allow;
}

test('resources deny creator messages and threads, including combined roles; community is writable', () => {
  const p = resourcePermissions(TEST_RESOURCE_GUILD, ['active','legacy','onboarding'], ['manager','founder'], 'bot');
  assert.equal(effective(p, ['active','legacy']) & VIEW, VIEW);
  assert.equal(effective(p, ['active','legacy']) & WRITE, 0n);
  assert.equal(effective(p, ['active','manager']) & WRITE, WRITE);
  assert.equal(effective(p, []) & VIEW, 0n);
  const legacy = resourcePermissions(TEST_RESOURCE_GUILD, ['legacy'], ['manager','founder'], 'bot', true);
  assert.equal(effective(legacy, ['new-deal','active','scripts']) & VIEW, 0n);
  assert.equal(effective(legacy, ['legacy']) & WRITE, WRITE);
});

function fixture() {
  const r = { role_staff:'manager',role_founder:'founder',role_admin:'admin',role_scripts:'scripts-role',role_onboarding:'onboarding',role_active:'active',role_hub_access:'hub',role_at_risk:'risk',channel_scripts:'scripts',channel_script_library:'library' };
  const channels = [{id:'scripts'}, {id:'library'}], messages = new Map(), calls = [];
  let seq = 100;
  const f = { config:{guildId:TEST_RESOURCE_GUILD,testMode:true},database:{},roles:[],channels,bot:{id:'bot'},resources:()=>({...r}),save:(_db,k,id)=>r[k]=id,
    findRole:async()=> 'legacy',
    findChannel:async(_config,_db,_roles,key,name,type,parent,permissions)=> {
      if(!r[key]) { r[key]=String(++seq);channels.push({id:r[key],name,type,parent_id:parent,permission_overwrites:permissions}); }
      return r[key];
    },
    api:async(_config,path,init={})=> {
      calls.push({path,...init});
      const parts=path.split('/');
      if(init.body instanceof FormData) {
        const payload=JSON.parse(init.body.get('payload_json'));
        payload.attachments=[{id:String(++seq),filename:init.body.get('files[0]').name,size:init.body.get('files[0]').size}];
        init={...init,body:JSON.stringify(payload)};
      }
      if(parts[3]==='pins') {messages.get(parts[4]).pinned=true;return {};}
      if(parts[3]?.startsWith('messages')) {
        if(init.method==='POST') {const m={...JSON.parse(init.body),id:String(++seq),author:{id:'bot'},channel_id:parts[2]};messages.set(m.id,m);return m;}
        if(parts[4]) {
          const m=messages.get(parts[4]);if(!m)throw Object.assign(Error('not found'),{status:404});
          if(init.method==='PATCH')Object.assign(m,JSON.parse(init.body));return m;
        }
        return [...messages.values()].filter(m=>m.channel_id===parts[2]);
      }
      const c=channels.find(c=>c.id===parts[2]);if(c&&init.body)Object.assign(c,JSON.parse(init.body));return c||{};
    },
  };
  return {f,r,messages,calls};
}

test('publishing is test-only, edits existing pinned cards, archives duplicate scripts without deletion',async()=>{
  const {f,r,messages,calls}=fixture();
  await assert.rejects(()=>syncResourceGuidance({...f,config:{guildId:'production',testMode:true}}),/not enabled/);
  assert.equal(calls.length,0);
  await syncResourceGuidance(f);
  const count=messages.size;
  assert.equal(count,17);
  assert.ok([...messages.values()].every(m=>m.pinned));
  assert.equal(r.channel_script_library,'scripts');
  const scripts=f.channels.find(c=>c.id==='scripts');
  assert.equal(effective(scripts.permission_overwrites,['scripts-role'])&VIEW,VIEW);
  assert.equal(effective(scripts.permission_overwrites,['scripts-role'])&WRITE,0n);
  assert.equal(effective(scripts.permission_overwrites,['active'])&VIEW,0n);
  assert.equal(f.channels.find(c=>c.id==='library').name,'archived-script-library');
  assert.equal(effective(f.channels.find(c=>c.id==='library').permission_overwrites,['legacy','active','manager'])&VIEW,0n);
  delete r.message_resource_creator_guide;
  const uploadCount=calls.filter(c=>c.body instanceof FormData).length;
  assert.equal(uploadCount,3);
  await syncResourceGuidance(f);
  assert.equal(messages.size,count);
  assert.equal(calls.filter(c=>c.body instanceof FormData).length,uploadCount);
  assert.equal([...messages.values()].filter(m=>m.attachments?.[0]?.filename?.endsWith('.mp4')).length,3);
  assert.ok(!calls.some(c=>c.method==='DELETE'));
});
