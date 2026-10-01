import assert from 'node:assert/strict';
import test from 'node:test';
import { applyReviewedVideoExclusion, getReviewedVideoExclusion, REVIEWED_VIDEO_EXCLUSIONS } from '../src/server/ugc-pay/reviewed-video-exclusions.ts';
import { calculateUgcPayVideoAmounts } from '../src/server/ugc-pay/calculations.ts';
const deal={fixedFeePerVideo:25,cpmAmount:1,paidTrafficMetric:'IMPRESSIONS',deductPaidTraffic:true,viewCapPerVideo:null,payoutCapPerVideo:100,perVideoCapScope:'CPM',notes:null};
const identity=(sourceVideoId)=>({organizationId:'org_public_tt_ads_manager',sourceVideoId,videoUrl:`https://www.tiktok.com/@renamed_account/video/${sourceVideoId}`});
function amount(d,payMode){return calculateUgcPayVideoAmounts({grossViews:2000000,paidStatus:'unknown',paidViews:0,deal:d,fixedFeePerVideo:d.fixedFeePerVideo,gainedViewCapContext:null,payMode});}
test('every confirmed exclusion blocks both fixed and CPM pay in posted and gained calculations',()=>{
 for(const row of REVIEWED_VIDEO_EXCLUSIONS)for(const mode of ['posted','gained']){
  const d=applyReviewedVideoExclusion(deal,identity(row.sourceVideoId));const out=amount(d,mode);
  assert.equal(out.videoPay,0);assert.equal(out.cpmPay,0);assert.equal(out.payableViews,0);assert.equal(d.fixedFeePerVideo,0);assert.match(d.notes,/Not payable/);
 }
 assert.equal(deal.fixedFeePerVideo,25);
});
test('changing creator rates or video overrides cannot restore pay for a confirmed exclusion',()=>{
 const edited={...deal,cpmAmount:50,fixedFeePerVideo:1000,perVideoCapScope:'NONE'};
 assert.equal(amount(applyReviewedVideoExclusion(edited,identity('7671324275168578838')),'posted').videoPay,0);
});
test('unreviewed videos, other organizations and other platforms preserve their payment terms',()=>{
 for(const id of [{...identity('7671324275168578838'),organizationId:'other-org'},identity('9999999999999999999'),{...identity('7671324275168578838'),videoUrl:'https://www.instagram.com/reel/7671324275168578838/'},{...identity('7671324275168578838'),sourceVideoId:'('}])assert.equal(applyReviewedVideoExclusion(deal,id),deal);
 assert.equal(amount(deal,'posted').videoPay,125);
});
test('renamed accounts and native carousel URLs retain the reviewed exclusion',()=>{
 const id=identity('7685429928845823253');id.videoUrl=id.videoUrl.replace('/video/','/photo/');assert.ok(getReviewedVideoExclusion(id));
 assert.equal(getReviewedVideoExclusion({...id,videoUrl:'https://www.tiktok.com/@someone/video/7671324275168578838'}),null);
});
