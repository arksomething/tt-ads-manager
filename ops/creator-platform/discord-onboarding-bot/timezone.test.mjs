import {test} from 'node:test';
import assert from 'node:assert/strict';
import {directTimezone,parseTimezone} from './timezone.mjs';
import {localDay} from './flow.mjs';
test('common timezone names, cities and offsets normalize without AI',async()=>{
  for(const [value,expected] of [['GMT+8','+08:00'],['UTC+05:30','+05:30'],['+0530','+05:30'],['UTC-3.5','-03:30'],['Manila','Asia/Manila'],['New York','America/New_York'],['america/new_york','America/New_York'],['UTC','UTC']])
    assert.equal(await parseTimezone(value,{request:()=>{throw Error('Must not call AI');}}),expected);
  assert.equal(directTimezone('CST'),null);
  assert.equal(directTimezone('GMT+25'),null);
  assert.equal(localDay(Date.parse('2026-09-10T16:30:00Z'),'+08:00'),localDay(Date.parse('2026-09-11T00:30:00Z'),'UTC'));
});
test('AI results validated; ambiguity and outages do not save guessed zones',async()=>{
  let sent;
  const request=async(url,init)=>{sent=JSON.parse(init.body);return Response.json({choices:[{message:{content:JSON.stringify({timezone:'Asia/Shanghai',ambiguous:false})}}]});};
  assert.equal(await parseTimezone('I live in Shanghai, China',{key:'test',request}),'Asia/Shanghai');
  assert.deepEqual(JSON.parse(sent.messages[1].content),{timezone_text:'I live in Shanghai, China'});
  for(const result of [{timezone:'Mars/City',ambiguous:false},{timezone:'Asia/Shanghai',ambiguous:true},{timezone:null,ambiguous:true}])
    await assert.rejects(parseTimezone('CST',{key:'test',request:async()=>Response.json({choices:[{message:{content:JSON.stringify(result)}}]})}),/unclear/);
  await assert.rejects(parseTimezone('some unfamiliar place',{key:'test',request:async()=>new Response('',{status:500})}),/temporarily unavailable/);
});
