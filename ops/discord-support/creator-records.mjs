import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import '../creator-platform/discord-onboarding-bot/calculator-loader.mjs';
for(const file of ['.env','.env.local'])process.loadEnvFile(fileURLToPath(new URL(`../../web/${file}`,import.meta.url)));
const {prisma}=await import('../../web/src/lib/db.ts');
const input=JSON.parse(readFileSync(0,'utf8'));
try{
 const orgs=await prisma.organization.findMany({where:{slug:'gotall'},select:{id:true}});
 if(orgs.length!==1)throw Error('GoTall organization unresolved');
 const organizationId=orgs[0].id;
 if(input.operation==='match_tracked'){
  const result=[];
  for(const account of input.accounts){
   const platform={tiktok:'TIKTOK',instagram:'INSTAGRAM_REELS'}[account.platform];
   if(!platform||!account.native_account_id||!account.tracked_videos)continue;
   const matched=await prisma.creatorPlatformAccount.findMany({where:{platform,sourceAccountId:String(account.native_account_id),creator:{organizationId}},select:{creatorId:true}});
   const ids=[...new Set(matched.map(r=>r.creatorId))];
   const links=ids.length===1?await prisma.campaignCreator.findMany({where:{creatorId:ids[0],campaign:{organizationId}},select:{id:true,campaignId:true}}):[];
   result.push({platform:account.platform,native_account_id:account.native_account_id,links:links.map(r=>({campaign_creator_id:r.id,organization_id:organizationId})),status:links.length===1?'matched':'missing_or_ambiguous_payout_record'});
  }
  process.stdout.write(JSON.stringify(result));
 }else if(input.operation==='resolve'){
  const rows=await prisma.campaignCreator.findMany({where:{campaign:{organizationId},creatorId:{in:input.creator_ids}},select:{id:true,creatorId:true,campaignId:true,campaign:{select:{organizationId:true}},creator:{select:{displayName:true}}}});
  process.stdout.write(JSON.stringify(rows));
 }else{
  const cc=await prisma.campaignCreator.findFirst({where:{id:input.campaign_creator_id,campaign:{organizationId}},select:{id:true,creatorId:true,creator:{select:{displayName:true}}}});
  if(!cc)throw Error('Creator not found in GoTall');
  if(input.operation==='read'){
   const deals=await prisma.$queryRaw`SELECT * FROM public."CampaignCreatorDeal" WHERE "organizationId"=${organizationId} AND "campaignCreatorId"=${cc.id} ORDER BY "effectiveStartDate"`;
   const overrides=await prisma.campaignCreatorVideoDeal.findMany({where:{organizationId,campaignCreatorId:cc.id}});
   process.stdout.write(JSON.stringify({creator:cc,deals,video_overrides:overrides}));
  }else if(input.operation==='publish'){
   const allowed=new Set(['currency','effectiveStartDate','effectiveEndDate','fixedFee','fixedFeeRecognitionDate','fixedFeePerVideo','cpmAmount','paidTrafficMetric','deductPaidTraffic','viewCapPerVideo','viewWindowDays','payoutCapPerVideo','perVideoCapScope','payoutCapTotal','notes','agreementUrl']);
   if(!input.terms||Object.keys(input.terms).some(k=>!allowed.has(k)))throw Error('Unsupported deal field');
   const result=await prisma.$queryRaw`SELECT public.gotall_publish_creator_deal(${input.request_id}::text,${organizationId}::text,${cc.id}::text,${input.source_deal_id}::text,${input.expected_version_id}::text,${input.actor}::text,${JSON.stringify(input.terms)}::jsonb) AS deal`;
   const deal=result[0].deal;
   const verifiedRows=await prisma.$queryRaw`SELECT * FROM public."CampaignCreatorDeal" WHERE id=${deal.id} AND "organizationId"=${organizationId} AND "campaignCreatorId"=${cc.id}`;
   const verified=verifiedRows[0];
   if(!verified||verified.dealVersionId!==deal.dealVersionId)throw Error('Readback mismatch; inspect before retrying');
   process.stdout.write(JSON.stringify({status:'published',deal:verified,request_id:input.request_id}));
  }else throw Error('Unsupported operation');
 }
}finally{await prisma.$disconnect();}
