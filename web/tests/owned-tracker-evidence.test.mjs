import assert from 'node:assert/strict';
import test from 'node:test';
import {priceableOwnedWindow,verifyOwnedInventory} from '../src/server/ugc-pay/owned-tracker-evidence.ts';
import {calculateUgcPayVideoAmounts,normalizeMoney} from '../src/server/ugc-pay/calculations.ts';
const day=86400000, start=Date.parse('2026-09-01T00:00:00Z');
const obs=(id,time,views,extra={})=>({id,observed_at:time,source_observed_at:time,views,confidence:'direct',is_complete:1,availability:'available',source:'tiktok_ytdlp',evidence_manifest_sha256:'evidence',...extra});
const video=(extra={})=>({id:'1',native_account_id:'account',handle:'creator',platform:'tiktok',sourceVideoId:'post',url:'https://www.tiktok.com/@creator/video/1',caption:'#yap',publishedAt:start,excluded:false,availability:'available',observations:[obs(1,start+7*day-1000,500)],finalization:{status:'final',cutoff_at:start+7*day,gross_views:500,selected_final_observation_id:1,policy_version:'owned',finalization_sha256:'hash',exception_code:null},...extra});
const range={start,endExclusive:start+29*day,now:start+29*day,windowDays:7};

test('half-cent earnings use consistent decimal rounding',()=>{
 for(const [input,expected] of [[18.395,18.40],[13.135,13.14],[11.235,11.24],[.015,.02],[-18.395,-18.40],[18.394,18.39],[(10+1.505)-10,1.51],[(10+1.235)-10,1.24]])assert.equal(normalizeMoney(input),expected);
 for(const views of [1505,1235]){
  const a=calculateUgcPayVideoAmounts({grossViews:views,paidViews:0,paidStatus:'no',fixedFeePerVideo:10,payMode:'gained',gainedViewCapContext:null,deal:{fixedFeePerVideo:10,cpmAmount:1,paidTrafficMetric:'VIDEO_PLAY_ACTIONS',deductPaidTraffic:true,viewCapPerVideo:null,payoutCapPerVideo:300,perVideoCapScope:'TOTAL',notes:null}});
  assert.equal(normalizeMoney(10+a.cpmPay),a.videoPay);
 }
});

test('uses finalized seven-day observation and ignores lifetime/provider counters',()=>{
 const v=video();v.observations.push(obs(2,start+20*day,999999),obs(3,start+7*day,999999,{confidence:'provider'}));
 const result=priceableOwnedWindow(v,range);assert.equal(result.views,500);assert.equal(result.state,'final');assert.equal(result.observationId,1);
});
test('complete inventory includes more than 100 posts and zero-view posts',()=>{
 const videos=Array.from({length:130},(_,i)=>video({id:String(i),sourceVideoId:String(i),observations:[obs(i,start+day,0)],finalization:null}));
 verifyOwnedInventory({captured_at:range.now,accounts:[{native_account_id:'account',platform:'tiktok',handle:'creator'}],videos},['account'],range.now);
 const rows=videos.map(v=>priceableOwnedWindow(v,range));assert.equal(rows.length,130);assert.equal(rows[129].views,0);
});
test('missing carryover baseline stays unpriced even when cumulative cap context is used',()=>{
 const result=priceableOwnedWindow(video({publishedAt:start-day,finalization:null,observations:[obs(1,start+5*day,9000)]}),range);
 assert.equal(result.views,null);assert.equal(result.grossViewsAtPeriodEnd,result.grossViewsBeforePeriod);
 const amount=calculateUgcPayVideoAmounts({grossViews:result.views??0,paidViews:0,paidStatus:'no',fixedFeePerVideo:0,payMode:'gained',gainedViewCapContext:result,deal:{fixedFeePerVideo:10,cpmAmount:1,paidTrafficMetric:'IMPRESSION',deductPaidTraffic:true,viewCapPerVideo:null,payoutCapPerVideo:300,perVideoCapScope:'TOTAL',notes:null}});
 assert.equal(amount.videoPay,0);assert.ok(result.warnings.some(w=>w.includes('baseline unavailable')));
});
test('carryover splits cumulative views and retains context for cap already consumed',()=>{
 const result=priceableOwnedWindow(video({publishedAt:start-day,finalization:null,observations:[obs(1,start,400),obs(2,start+6*day,900)]}),range);
 assert.equal(result.views,500);assert.equal(result.grossViewsBeforePeriod,400);assert.equal(result.grossViewsAtPeriodEnd,900);
});
test('approximate month boundary is disclosed and outside tolerance is not accepted',()=>{
 let result=priceableOwnedWindow(video({publishedAt:start-day,finalization:null,observations:[obs(1,start+3600000,400),obs(2,start+6*day,900)]}),range);
 assert.equal(result.views,500);assert.ok(result.warnings.some(w=>w.includes('approximate')));
 result=priceableOwnedWindow(video({publishedAt:start-day,finalization:null,observations:[obs(1,start+4*3600000,400),obs(2,start+6*day,900)]}),range);assert.equal(result.views,null);
});
test('recent videos accrue only observations before report end; missing is not zero',()=>{
 const result=priceableOwnedWindow(video({publishedAt:start+27*day,finalization:null,observations:[obs(1,start+28*day,100),obs(2,start+30*day,999)]}),range);
 assert.equal(result.views,100);assert.equal(result.state,'accruing');
 const missing=priceableOwnedWindow(video({observations:[],finalization:null}),range);assert.equal(missing.views,null);assert.equal(missing.state,'unavailable');
});
test('rejects cross-creator data, stale source, duplicate IDs and mismatched finalization',()=>{
 const data={captured_at:range.now,accounts:[{native_account_id:'account',platform:'tiktok',handle:'creator'}],videos:[video()]};
 assert.throws(()=>verifyOwnedInventory(data,['someone-else'],range.now));
 assert.throws(()=>verifyOwnedInventory(data,['account'],range.now+3600000));
 assert.throws(()=>verifyOwnedInventory({...data,videos:[video(),video()]},['account'],range.now));
 const v=video();v.finalization.gross_views=1234;assert.equal(priceableOwnedWindow(v,range).state,'needs_review');
});
