import {loadOwnedEarningsSource} from '../creator-platform/discord-onboarding-bot/owned-earnings-loader.mjs';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import '../creator-platform/discord-onboarding-bot/calculator-loader.mjs';
console.log=(...args)=>console.error(...args);
console.info=console.log;
for(const file of ['.env','.env.local'])process.loadEnvFile(fileURLToPath(new URL(`../../web/${file}`,import.meta.url)));
const {prisma}=await import('../../web/src/lib/db.ts');
const {getOrganizationUgcPayData}=await import('../../web/src/server/ugc-pay/queries.ts');
try {
  const input=JSON.parse(readFileSync(0,'utf8'));
  if(input.operation==='creators') {
    const query=String(input.query||'');
    const rows=await prisma.campaignCreator.findMany({where:query?{creator:{displayName:{contains:query,mode:'insensitive'}}}:{},take:100,select:{id:true,creator:{select:{id:true,displayName:true}},campaign:{select:{id:true,name:true}}}});
    process.stdout.write(JSON.stringify({creators:rows,limited:rows.length===100}));
  } else {
  const ownRange=input.operation==='own_range';
  if(!ownRange&&!/^\d{4}-(0[1-9]|1[0-2])$/u.test(input.month))throw Error('Invalid month');
  const creator=await prisma.campaignCreator.findUnique({where:{id:input.campaign_creator_id},select:{id:true,creatorId:true,campaign:{select:{id:true,organizationId:true,organization:{select:{slug:true}}}}}});
  if(!creator)throw Error('Creator not found');
  if(ownRange&&creator.campaign.organizationId!==input.organization_id)throw Error('Creator organization mismatch');
  const terms=await prisma.campaignCreatorDeal.findMany({where:{campaignCreatorId:creator.id},orderBy:{id:'asc'}});
  const overrides=await prisma.campaignCreatorVideoDeal.findMany({where:{campaignCreatorId:creator.id},orderBy:{id:'asc'}});
  const today=new Date().toISOString().slice(0,10);
  let startDate,endDate;
  if(ownRange){
    startDate=input.start_date;endDate=input.end_date;
    for(const day of [startDate,endDate])if(!/^\d{4}-\d{2}-\d{2}$/u.test(day)||new Date(day).toISOString().slice(0,10)!==day)throw Error('Invalid date');
    if(startDate>endDate||endDate>today||(new Date(endDate)-new Date(startDate))/86400000>=90)throw Error('Invalid date range');
  }else{
    const [year,month]=input.month.split('-').map(Number),last=new Date(Date.UTC(year,month,0)).toISOString().slice(0,10);
    startDate=input.month+'-01';endDate=last<today?last:today;
    if(startDate>today)throw Error('Future report period');
  }
  const ownedTracker=await loadOwnedEarningsSource(prisma,{creatorId:creator.creatorId,organizationId:creator.campaign.organizationId,startDate,endDate});
  const data=await getOrganizationUgcPayData({organizationSlug:creator.campaign.organization.slug,creatorAccess:{ownedTracker,organizationId:creator.campaign.organizationId,creatorId:creator.creatorId,campaignCreatorId:creator.id,applyDealViewWindows:true,waitForPaidLookup:true},searchParams:{campaign:creator.campaign.id,startDate,endDate,payMode:'gained',videoFetchMode:'global',reportTimeZone:'UTC'},includePaidViews:true});
  const after=await prisma.campaignCreatorDeal.findMany({where:{campaignCreatorId:creator.id},orderBy:{id:'asc'}});
  const afterOverrides=await prisma.campaignCreatorVideoDeal.findMany({where:{campaignCreatorId:creator.id},orderBy:{id:'asc'}});
  if(JSON.stringify(terms)!==JSON.stringify(after)||JSON.stringify(overrides)!==JSON.stringify(afterOverrides))throw Error('Terms changed during calculation');
  if(data.errorMessage||(!data.summary?.creators&&data.warnings?.length))throw Error('Incomplete calculation');
  if(ownRange){
    if(data.creators.some(row=>row.campaignCreatorId!==creator.id))throw Error('Calculator scope mismatch');
    const own=data.creators.find(row=>row.campaignCreatorId===creator.id);
    if(!own||!terms.length)throw Error('Creator terms or calculation unavailable');
    const fields=['currency','deal','dealPeriods','grossViews','paidViewsDeducted','payableViews','fixedPay','videoPay','totalPay','videoCount','exactPaidVideoCount','unknownPaidVideoCount'];
    process.stdout.write(JSON.stringify({status:'estimate',start_date:startDate,end_date:endDate,timezone:'UTC',calculated_at:new Date().toISOString(),coverage_warnings_present:Boolean(data.warnings?.length),earnings:Object.fromEntries(fields.map(key=>[key,own[key]])),note:'Estimated earned activity in this date range under saved calculator terms, not confirmed payout or unpaid balance. Fixed fees follow their recognition dates. Recent video windows can still accrue; missing paid-view coverage can change the result. If coverage warnings are present, disclose that the calculation has unresolved coverage limitations. Verified applicable policy overrides conflicting implementation.'}));
  }else{
  process.stdout.write(JSON.stringify({status:'preliminary',campaign_creator_id:creator.id,month:input.month,calculated_at:new Date().toISOString(),summary:data.summary,warnings:data.warnings,creators:data.creators,note:'Existing UGC calculator preview, not an approved payout or proof of transfer. No report was posted to Discord.'}));
  }
  }
} finally {await prisma.$disconnect();}
