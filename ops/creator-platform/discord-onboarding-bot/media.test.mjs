import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveVideo, resolvePublishedField, draftAttachment, saveDraftUpload, publicCreatorResponse } from './media.mjs';

test('published fields accept pasted links and test placeholders without mixing platforms',async()=>{
  assert.equal((await resolvePublishedField('example.com','instagram',{testMode:true})).key,'instagram:example:/');
  await assert.rejects(resolvePublishedField('example.com','instagram'),/instagram.com/);
  assert.equal((await resolvePublishedField('IG: (instagram.com/reels/ABC/?igsh=123)','instagram')).key,'instagram:ABC');
  assert.equal((await resolvePublishedField('tiktok.com/@demo/video/123','tiktok')).key,'tiktok:123');
  await assert.rejects(resolvePublishedField('tiktok.com/@demo/video/123','instagram'),/instagram.com/);
  await assert.rejects(resolvePublishedField('instagram.com/demo','instagram'),/not the account profile/);
});

test('Manager review responses are shared only in the authorized staff channel',()=>{
  for(const custom_id of ['gt:review:123:approve_account','gt:form:review:123:changes']) {
    const i={type:3,channel_id:'reviews',data:{custom_id},member:{user:{id:'manager'}}};
    assert.equal(publicCreatorResponse(i,null,'start','reviews',true),true);
    assert.equal(publicCreatorResponse(i,null,'start','reviews',false),false);
    assert.equal(publicCreatorResponse({...i,channel_id:'creator-room'},null,'start','reviews',true),false);
  }
});

const file={id:'1',filename:'draft.mp4',size:3,content_type:'video/mp4',url:'https://cdn.discordapp.com/attachments/1/2/draft.mp4?ex=abc'};
const interaction={id:'123',channel_id:'channel',member:{user:{id:'creator'}},type:5,data:{custom_id:'gt:form:first_video',components:[{type:18,component:{type:19,custom_id:'video_file',values:['1']}}],resolved:{attachments:{'1':file}}}};
test('TikTok copied share text resolves and deduplicates against original post',async()=>{
  const calls=[];
  const video=await resolveVideo('Watch this! https://vm.tiktok.com/ABC/ Shared via TikTok',async url=>{
    calls.push(url);return new Response(null,{status:302,headers:{location:'https://www.tiktok.com/@creator/video/12345?share=1'}});
  });
  assert.equal(video.key,'tiktok:12345');assert.equal(calls.length,1);
  assert.deepEqual(video,await resolveVideo('https://www.tiktok.com/@creator/video/12345'));
});
test('share resolution blocks external redirects, loops and unsupported input',async()=>{
  let calls=0;
  await assert.rejects(resolveVideo('https://vt.tiktok.com/ABC/',async()=>{calls++;return new Response(null,{status:302,headers:{location:'https://127.0.0.1/admin'}});}),/Could not/);
  assert.equal(calls,1);
  calls=0;
  await assert.rejects(resolveVideo('https://vt.tiktok.com/ABC/',async()=>{calls++;return new Response(null,{status:302,headers:{location:'/ABC/'}});}),/Could not/);
  assert.equal(calls,6);
  await assert.rejects(resolveVideo('https://vm.tiktok.com.evil.example/ABC/',()=>{throw new Error('Must not request');}),/Could not/);
  await assert.rejects(resolveVideo('https://vm.tiktok.com/A https://vm.tiktok.com/B'),/one/);
});
test('modal uploads use resolved attachments and validate video, size and source',()=>{
  assert.equal(draftAttachment(interaction),file);
  const modalUpload=structuredClone(interaction);
  modalUpload.data.resolved.attachments['1'].url='https://cdn.discordapp.com/ephemeral-attachments/123/456/draft.mp4?ex=abc';
  assert.equal(draftAttachment(modalUpload).id,'1');
  for(const patch of [{content_type:'text/html'},{size:26*1024*1024},{url:'https://example.com/a.mp4'},{filename:'x.exe'}]){
    const i=structuredClone(interaction);Object.assign(i.data.resolved.attachments['1'],patch);
    assert.throws(()=>draftAttachment(i));
  }
});
test('upload is archived as an attachment and stored through durable channel message link',async()=>{
  let posted;
  const api=async(c,path,init)=>{
    if(!init)return [];
    posted=init.body;return {id:'message'};
  };
  assert.equal(await saveDraftUpload({guildId:'guild'},interaction,file,api,async()=>new Response(new Uint8Array([1,2,3]))),'https://discord.com/channels/guild/channel/message');
  assert.ok(posted instanceof FormData);
  assert.equal((await posted.get('files[0]').arrayBuffer()).byteLength,3);
  assert.equal(JSON.parse(posted.get('payload_json')).allowed_mentions.parse.length,0);
});
test('start-here button replies and application receipts are private while creator channels stay public',()=>{
  for(const custom_id of ['gt:guide','gt:resume','gotall-apply-v1']) {
    const i={...interaction,channel_id:'start',data:{custom_id}};
    assert.equal(publicCreatorResponse(i,null,'start'),false);
  }
  assert.equal(publicCreatorResponse(interaction,{discord_user_id:'creator'},'start'),true);
  for(const action of ['guide','help','resume'])assert.equal(publicCreatorResponse({...interaction,data:{custom_id:'gt:'+action}},{discord_user_id:'creator'},'start'),false);
});
test('creator responses are channel visible; staff actions and cross-channel requests stay private',()=>{
  const c={discord_user_id:'creator'};
  for(const action of ['accounts','ready','first_video','post','leave','signed','complete_warmup'])assert.equal(publicCreatorResponse({...interaction,data:{custom_id:'gt:form:'+action}},c),true);
  for(const action of ['staff','approve_account','confirm_signature','profile','review_posts','exception','test_clock'])assert.equal(publicCreatorResponse({...interaction,data:{custom_id:'gt:'+action}},c),false);
  assert.equal(publicCreatorResponse(interaction,{discord_user_id:'someone_else'}),false);
});
