import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import './calculator-loader.mjs';
console.log=(...args)=>console.error(...args);
console.info=console.log;
for(const file of ['.env','.env.local'])process.loadEnvFile(`/home/ark296/projects/tt-ads-manager/web/${file}`);
const {prisma}=await import('/home/ark296/projects/tt-ads-manager/web/src/lib/db.ts');
const {getOrganizationUgcPayData}=await import('/home/ark296/projects/tt-ads-manager/web/src/server/ugc-pay/queries.ts');
const input=JSON.parse(readFileSync(0,'utf8'));
const bindings=JSON.parse(readFileSync('/etc/gotall-discord-deal-bindings.json','utf8'));
const output=[];
for(const request of input){
 const binding=bindings[request.creator_id];if(!binding)continue;
 if(!/^\d{4}-(0[1-9]|1[0-2])$/u.test(request.month))throw Error('Invalid month');
 const cc=await prisma.campaignCreator.findFirst({where:{id:binding.campaign_creator_id,campaign:{organizationId:binding.organization_id}},select:{id:true,creatorId:true,campaign:{select:{id:true,organization:{select:{slug:true}}}}}});
 if(!cc)throw Error('Campaign creator not found');
 const terms=await prisma.campaignCreatorDeal.findMany({where:{campaignCreatorId:cc.id},orderBy:{id:'asc'}});
 const overrides=await prisma.campaignCreatorVideoDeal.findMany({where:{campaignCreatorId:cc.id},orderBy:{id:'asc'}});
 const [year,month]=request.month.split('-').map(Number),last=new Date(Date.UTC(year,month,0)).toISOString().slice(0,10),today=new Date().toISOString().slice(0,10);
 const result=await getOrganizationUgcPayData({organizationSlug:cc.campaign.organization.slug,creatorAccess:{organizationId:binding.organization_id,creatorId:cc.creatorId,campaignCreatorId:cc.id,applyDealViewWindows:true,waitForPaidLookup:true},searchParams:{campaign:cc.campaign.id,startDate:request.month+'-01',endDate:last<today?last:today,payMode:'gained',videoFetchMode:'global',reportTimeZone:'UTC'},includePaidViews:true});
 const after=await prisma.campaignCreatorDeal.findMany({where:{campaignCreatorId:cc.id},orderBy:{id:'asc'}});
 const afterOverrides=await prisma.campaignCreatorVideoDeal.findMany({where:{campaignCreatorId:cc.id},orderBy:{id:'asc'}});
 if(JSON.stringify(terms)!==JSON.stringify(after)||JSON.stringify(overrides)!==JSON.stringify(afterOverrides))throw Error('Deal terms changed during calculation; retry.');
 const engine=Object.fromEntries(['queries.ts','calculations.ts','creator-access-local-videos.ts'].map(name=>[name,createHash('sha256').update(readFileSync(`/home/ark296/projects/tt-ads-manager/web/src/server/ugc-pay/${name}`)).digest('hex')]));
 output.push({creator_id:request.creator_id,month:request.month,calculated_at:new Date().toISOString(),summary:result.summary,creators:result.creators,warnings:result.warnings,error:result.errorMessage,start_date:result.startDate,end_date:result.endDate,mode:result.payMode,audit_inputs:{report_timezone:'UTC',provider:'GoTall UGC calculator / viral.app and TikTok paid-view lookup',view_window:'Published deal window for each video',terms,video_overrides:overrides,engine_sha256:engine}});
}
process.stdout.write(JSON.stringify(output));
