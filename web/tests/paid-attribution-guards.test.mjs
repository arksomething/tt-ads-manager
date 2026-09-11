import assert from 'node:assert/strict';
import test from 'node:test';
import {hasPaidDelivery,needsPostMapping,getResolvedVideoPaidStatus} from '../src/server/tiktok-business/paid-attribution-guards.ts';
test('zero-delivery and invalid rows cannot taint creator paid status',()=>{
 assert.deepEqual([0,-1,NaN,Infinity,12].map(metricValue=>hasPaidDelivery({metricValue})),[false,false,false,false,true]);
});
test('ad-only delivery and exact post matches do not wait for Singular',()=>{
 const base={itemIds:[],postBackingStatus:'unknown',totalValue:20};
 assert.equal(needsPostMapping(base),true);
 assert.equal(needsPostMapping({...base,postBackingStatus:'non_post_backed'}),false);
 assert.equal(needsPostMapping({...base,itemIds:['post']}),false);
 assert.equal(needsPostMapping({...base,totalValue:0}),false);
});

test('known ad-only delivery does not mark unrelated public posts unknown',()=>{
 const input={matchedReportRowCount:0,hasAmbiguousMatch:false,hadAnyPaidRows:true,hasOpaqueReportRows:false,hasPendingExternalResolution:false,unresolvedUnknownGroupCount:0,onlyNonPostBackedDelivery:true};
 assert.equal(getResolvedVideoPaidStatus(input).paidStatus,'no');
 assert.equal(getResolvedVideoPaidStatus({...input,unresolvedUnknownGroupCount:1}).paidStatus,'unknown');
 assert.equal(getResolvedVideoPaidStatus({...input,hasPendingExternalResolution:true}).paidStatus,'unknown');
 assert.equal(getResolvedVideoPaidStatus({...input,matchedReportRowCount:1}).paidStatus,'yes');
});
