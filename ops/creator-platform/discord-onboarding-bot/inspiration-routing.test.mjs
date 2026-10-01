import test from 'node:test';
import assert from 'node:assert/strict';
import {handleInteraction} from './bot.mjs';
test('production inspiration is routed before the onboarding guild guard',async()=>{
 let called=0;
 const raw={guild_id:'1400610531189985310',type:2,data:{name:'predict'}};
 const config={inspiration:{owns:i=>i===raw,handle:async()=>{called++;return true;}}};
 assert.equal(await handleInteraction(config,null,raw),true);assert.equal(called,1);
});
test('production onboarding remains rejected even with inspiration enabled',async()=>{
 let called=0;
 const config={inspiration:{owns:()=>false,handle:()=>{called++;}}};
 await handleInteraction(config,null,{guild_id:'1400610531189985310',type:2,data:{name:'apply'}});
 assert.equal(called,0);
});
