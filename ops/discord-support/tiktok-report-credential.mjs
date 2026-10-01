// Internal credential pipe only; never register this runner as an agent tool.
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import '../creator-platform/discord-onboarding-bot/calculator-loader.mjs';
console.log=()=>{};
console.info=()=>{};
for(const file of ['.env','.env.local'])process.loadEnvFile(fileURLToPath(new URL(`../../web/${file}`,import.meta.url)));
const {prisma}=await import('../../web/src/lib/db.ts');
try {
  const {advertiser_id}=JSON.parse(readFileSync(0,'utf8'));
  if(!/^\d+$/.test(String(advertiser_id||'')))throw Error('Advertiser ID required');
  const organizations=await prisma.organization.findMany({where:{name:{equals:'GoTall',mode:'insensitive'}},select:{id:true}});
  if(organizations.length!==1)throw Error('GoTall organization mapping is ambiguous');
  const account=await prisma.organizationTikTokAccount.findUnique({where:{organizationId_advertiserId:{organizationId:organizations[0].id,advertiserId:String(advertiser_id)}},select:{accessToken:true,status:true,accessTokenExpiresAt:true}});
  if(!account||account.status!=='ACTIVE'||(account.accessTokenExpiresAt&&account.accessTokenExpiresAt<=new Date()))throw Error('No active reporting credential');
  process.stdout.write(JSON.stringify({accessToken:account.accessToken}));
} finally {await prisma.$disconnect();}
