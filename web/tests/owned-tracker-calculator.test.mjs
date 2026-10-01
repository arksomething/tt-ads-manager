import assert from 'node:assert/strict';
import test from 'node:test';
import {registerHooks,stripTypeScriptTypes} from 'node:module';
import {existsSync,readFileSync} from 'node:fs';
import {fileURLToPath,pathToFileURL} from 'node:url';

const root=fileURLToPath(new URL('../src/',import.meta.url));
const start=Date.parse('2026-09-01T00:00:00Z'),day=86400000;
const creator={id:'creator',displayName:'Creator',isTalking:true,platformAccounts:[{handle:'creator',platform:'TIKTOK',sourceAccountId:'native'}]};
const deal={id:'deal',currency:'USD',effectiveStartDate:new Date('2026-07-01'),effectiveEndDate:null,fixedFee:null,fixedFeeRecognitionDate:null,fixedFeePerVideo:10,cpmAmount:1,paidTrafficMetric:'VIDEO_PLAY_ACTIONS',deductPaidTraffic:true,viewCapPerVideo:null,viewWindowDays:7,payoutCapPerVideo:300,perVideoCapScope:'TOTAL',payoutCapTotal:null,notes:null};
globalThis.__ownedTest={
 prisma:{campaign:{findMany:async()=>[{id:'campaign',name:'Campaign'}]},campaignCreator:{findMany:async()=>[{id:'cc',creatorId:'creator',campaignId:'campaign',campaign:{id:'campaign',name:'Campaign'},creator,deals:[deal]}]},campaignCreatorVideoDeal:{findMany:async()=>[]},videoContentClassification:{findMany:async()=>[]}},
 paid:async args=>{
  assert.equal(args.metric,'video_play_actions');
  return {rows:args.sourceVideoIds.map(sourceVideoId=>({sourceVideoId,paidViews:0,paidStatus:'no',matchedSparkItemIds:[],matchedAdIds:[],unresolvedPostBackedAdIds:[],unresolvedNonPostBackedAdIds:[],attributionSources:[],paidStatusReason:'no_exact_post_match'})),warnings:[],unresolvedPostBackedGroupCount:0,unresolvedNonPostBackedGroupCount:0};
 }
};
registerHooks({
 resolve(specifier,context,next){
  let path=specifier.startsWith('@/')?root+specifier.slice(2):specifier.startsWith('.')&&context.parentURL?fileURLToPath(new URL(specifier,context.parentURL)):null;
  if(path)for(const suffix of ['', '.ts','.tsx'])if(existsSync(path+suffix)&&/\.[cm]?[jt]sx?$/.test(path+suffix))return {url:pathToFileURL(path+suffix).href,shortCircuit:true};
  return next(specifier,context);
 },
 load(url,context,next){
  const mocks={
   '/lib/db.ts':'export const prisma=globalThis.__ownedTest.prisma;',
   '/server/auth/organizations.ts':'export const requireOrganizationMembership=()=>{throw Error("Unexpected auth");};',
   '/server/campaigns/queries.ts':'export const getAccessibleCampaignOptionsForMembership=()=>[];export const getAccessibleCampaignWhere=()=>({});',
   '/server/videos/queries.ts':'export const getOrganizationViewTallyData=()=>{throw Error("Viral endpoint must not be called");};export const resolveViewTallyCreatorIdForLocalCreator=getOrganizationViewTallyData;',
   '/server/tiktok-business/reporting.ts':'export const getPaidViewsForSourceVideosForCreatorForOrganization=globalThis.__ownedTest.paid;',
  };
  for(const [suffix,source] of Object.entries(mocks))if(url.endsWith(suffix))return {format:'module',source,shortCircuit:true};
  if(url.endsWith('.ts'))return {format:'module',source:stripTypeScriptTypes(readFileSync(fileURLToPath(url),'utf8'),{mode:'transform'}),shortCircuit:true};
  return next(url,context);
 }
});
const {getOrganizationUgcPayData}=await import('../src/server/ugc-pay/queries.ts');
test('creator earnings calculate every owned post without Viral or the empty legacy Video table',async()=>{
 const evidence={captured_at:Date.now(),accounts:[{platform:'tiktok',native_account_id:'native',handle:'creator'}],videos:Array.from({length:130},(_,i)=>({
  id:String(i),sourceVideoId:String(i),native_account_id:'native',platform:'tiktok',handle:'creator',publishedAt:start,url:`https://www.tiktok.com/@creator/video/${i}`,caption:i===129?'#ad':'#ad #yap',excluded:false,availability:'available',
  observations:[{id:i,observed_at:start+7*day,source_observed_at:start+7*day,confidence:'direct',is_complete:1,availability:'available',views:1000}],
  finalization:{status:'final',cutoff_at:start+7*day,gross_views:1000,selected_final_observation_id:i,finalization_sha256:'hash',exception_code:null}
 }))};
 const result=await getOrganizationUgcPayData({organizationSlug:'gotall',creatorAccess:{organizationId:'org_public_tt_ads_manager',creatorId:'creator',campaignCreatorId:'cc',applyDealViewWindows:true,ownedTracker:evidence},searchParams:{campaign:'campaign',startDate:'2026-09-01',endDate:'2026-09-29',payMode:'gained',reportTimeZone:'UTC'},includePaidViews:true});
 assert.equal(result.summary.videos,130);
 assert.equal(result.summary.videoFixedPay,1300);
 assert.equal(result.summary.cpmPay,129.50);
 assert.equal(result.summary.totalPay,1429.50);
 assert.equal(result.videos.find(v=>v.sourceVideoId==='129').cpmAmount,.5);
 assert.equal(result.videos[0].viewEvidence.state,'final');
 assert.equal(result.warnings.some(w=>w.includes('100')),false);
});
