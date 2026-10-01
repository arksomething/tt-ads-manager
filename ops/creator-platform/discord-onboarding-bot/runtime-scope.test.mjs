import {test} from 'node:test';
import assert from 'node:assert/strict';
import {runtimeAllowed,PRODUCTION_GUILD_ID} from './runtime-scope.mjs';
import {openDatabase,handleInteraction,legacyApplicant,handleGuildMemberAdd} from './bot.mjs';
test('production requires an explicit enablement and real mode',()=>{
 assert.equal(runtimeAllowed({guildId:PRODUCTION_GUILD_ID,testMode:false}),false);
 assert.equal(runtimeAllowed({guildId:PRODUCTION_GUILD_ID,testMode:true,productionApproved:true}),false);
 assert.equal(runtimeAllowed({guildId:'unknown',testMode:false,productionApproved:true}),false);
 assert.equal(runtimeAllowed({guildId:PRODUCTION_GUILD_ID,testMode:false,productionApproved:true}),true);
 assert.equal(runtimeAllowed({guildId:'1245112089647775877',testMode:true}),true);
});
test('a human join receives the configured Newcomer role',async()=>{
 const db=await openDatabase(':memory:'),old=globalThis.fetch,calls=[];
 db.prepare('INSERT INTO resources VALUES(?,?,?)').run('role_newcomer','newcomer-role',new Date().toISOString());
 globalThis.fetch=async(url,init)=>{calls.push({url,method:init.method});return new Response('{}',{status:200});};
 try {
  assert.equal(await handleGuildMemberAdd({guildId:PRODUCTION_GUILD_ID,token:'test'},db,{guild_id:PRODUCTION_GUILD_ID,user:{id:'new-user',bot:false}}),true);
  assert.match(calls[0].url,/members\/new-user\/roles\/newcomer-role$/u);
  assert.equal(calls[0].method,'PUT');
  assert.equal(await handleGuildMemberAdd({guildId:PRODUCTION_GUILD_ID,token:'test'},db,{guild_id:PRODUCTION_GUILD_ID,user:{id:'bot-user',bot:true}}),false);
 }finally{globalThis.fetch=old;db.close();}
});
test('enabled production application interaction receives a real modal callback',async()=>{
 const db=await openDatabase(':memory:'),old=globalThis.fetch,calls=[];
 globalThis.fetch=async(url,init)=>{calls.push({url,body:JSON.parse(init.body)});return new Response('{}');};
 try {
  await handleInteraction({guildId:PRODUCTION_GUILD_ID,testMode:false,productionApproved:true,token:'test'},db,{guild_id:PRODUCTION_GUILD_ID,id:'interaction',token:'test',type:3,member:{user:{id:'new'}},data:{custom_id:'gt:apply'}});
  assert.equal(calls.length,1);assert.equal(calls[0].body.type,9);
  assert.equal(calls[0].body.data.custom_id,'gotall-apply-v1');
 }finally{globalThis.fetch=old;db.close();}
});
test('legacy role blocks button, slash command and previously opened forms without creating a creator',async()=>{
 const db=await openDatabase(':memory:'),old=globalThis.fetch,calls=[];
 db.prepare('INSERT INTO resources VALUES(?,?,?)').run('role_legacy','legacy-role',new Date().toISOString());
 globalThis.fetch=async(url,init)=>{calls.push(JSON.parse(init.body));return new Response('{}');};
 try {
  for(const input of [{type:3,data:{custom_id:'gt:apply'}},{type:2,data:{name:'apply'}},{type:5,data:{custom_id:'gotall-apply-v1',components:[]}}]) {
   await handleInteraction({guildId:PRODUCTION_GUILD_ID,testMode:false,productionApproved:true,token:'test'},db,{guild_id:PRODUCTION_GUILD_ID,id:'interaction',token:'test',member:{user:{id:'legacy-user'},roles:['legacy-role']},...input});
   assert.equal(calls.at(-1).type,4);assert.equal(calls.at(-1).data.flags,64);
   assert.match(calls.at(-1).data.content,/legacy creator/);
  }
  assert.equal(db.prepare('SELECT count(*) n FROM creators').get().n,0);
  assert(legacyApplicant(db,{member:{user:{id:'legacy-user'},roles:[]}}));
 }finally{globalThis.fetch=old;db.close();}
});
