// Explicit production cutover. Snapshots contain private membership; keep outside the repo.
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {api as request,openDatabase,ensureGuildResources} from './bot.mjs';
import {resourcePermissions} from './resource-guidance.mjs';
const guildId='1400610531189985310',botId='1534630446959427686';
const dir=process.env.CUTOVER_DIR;
if(!dir)throw Error('CUTOVER_DIR is required');
mkdirSync(dir,{recursive:true,mode:0o700});
const config={guildId,token:readFileSync('/run/credentials/gotall-discord-onboarding-test.service/discord-bot-token','utf8').trim(),testMode:false,productionApproved:true};
const api=async(path,init={})=>{
 for(let n=0;;n++)try{return await request(config,path,init);}catch(e){if(e.status!==429||n>=8)throw e;await new Promise(r=>setTimeout(r,10000));}
};
const save=(name,value)=>writeFileSync(`${dir}/${name}`,JSON.stringify(value,null,2),{mode:0o600});
const load=name=>JSON.parse(readFileSync(`${dir}/${name}`,'utf8'));
const categories=new Set(['1492406840447991961','1492407020106678303','1492407167423352863','1496975271486689280','1524754775735009331']);
const mode=process.argv[2];
if(mode==='snapshot') {
 if(existsSync(`${dir}/before.json`))throw Error('Snapshot already exists; do not overwrite rollback evidence.');
 const guild=await api(`/guilds/${guildId}`),roles=await api(`/guilds/${guildId}/roles`),channels=await api(`/guilds/${guildId}/channels`);
 let members=[],after='0';
 for(;;){const page=await api(`/guilds/${guildId}/members?limit=1000&after=${after}`);members.push(...page);if(page.length<1000)break;after=page.at(-1).user.id;}
 const commands=await api(`/applications/${botId}/guilds/${guildId}/commands`);
 save('before.json',{guild,roles,channels,members,commands});
 const staffRoles=new Set(roles.filter(r=>['Founder','Admin','- CREATOR MANAGR -','Manager'].includes(r.name)||(BigInt(r.permissions)&8n)).map(r=>r.id));
 const staff=new Set(members.filter(m=>m.user.bot||m.user.id===guild.owner_id||m.roles.some(r=>staffRoles.has(r))).map(m=>m.user.id));
 const review=JSON.parse(readFileSync(new URL('./legacy-scripts-review.json',import.meta.url),'utf8'));
 const roster=channels.filter(c=>c.type===0&&categories.has(c.parent_id)).map(c=>{
   const owners=c.permission_overwrites.filter(p=>p.type===1&&(BigInt(p.allow)&1024n)&&!staff.has(p.id)).map(p=>p.id);
   const current=owners.filter(id=>members.some(m=>m.user.id===id));
   const known=review.creators.find(r=>r.channelId===c.id);
   const active=['1492407167423352863','1524754775735009331'].includes(c.parent_id);
   const scripts=active&&(known?.scripts==='yes'||(!known&&c.parent_id==='1524754775735009331'));
   return {channel_id:c.id,name:c.name,owners,current,scripts,needs_review:current.length!==1||!known||known.scripts==='review'};
 });
 save('roster.json',roster);
 console.log(JSON.stringify({channels:channels.length,creator_channels:roster.length,current_creators:new Set(roster.flatMap(r=>r.current)).size,manual_review:roster.filter(r=>r.needs_review).map(r=>({name:r.name,owners:r.current.length})),bot_admin:members.find(m=>m.user.id===botId).roles.some(id=>roles.some(r=>r.id===id&&(BigInt(r.permissions)&8n)))}));
} else if(mode==='prepare') {
 if(existsSync(`${dir}/production.sqlite3`))throw Error('Prepared database already exists.');
 const before=load('before.json'),roster=load('roster.json');
 const db=await openDatabase(`${dir}/production.sqlite3`);
 const set=(k,v)=>db.prepare('INSERT OR REPLACE INTO resources VALUES(?,?,?)').run(k,v,new Date().toISOString());
 for(const [key,id] of Object.entries({role_staff:'1502684705491910686',role_admin:'1423139415382818866',role_founder:'1401287371739365496',category_onboarding:'1492406840447991961',category_at_risk:'1492407020106678303',category_inactive:'1496975271486689280',channel_legacy_submit:'1401971472163012741',channel_legacy_accounts:'1423052483982397631',user_reviewer_blazie:'1470834529077035195'}))set(key,id);
 const now=new Date().toISOString();
 for(const r of roster) {
  for(const id of r.owners)db.prepare('INSERT OR IGNORE INTO legacy_participants VALUES(?,?)').run(id,now);
  // Shared channels retain their access, but never guess a single earnings owner.
  if(r.current.length!==1)continue;
  db.prepare(`INSERT INTO creators(discord_user_id,name,phone,location,platforms,best_video,channel_id,stage,created_at,updated_at,cohort,scripts_access,workflow_roles_initialized,sync_pending,campaign_accounts) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(r.current[0],r.name,'','','','',r.channel_id,'active',now,now,'legacy',Number(r.scripts),1,1,'');
 }
 set('production_cutover_guild',guildId);
 db.close();console.log('Prepared fresh production database; no test creators or simulated agreements copied.');
} else if(mode==='import-verified') {
 await import('./calculator-loader.mjs');
 for(const file of ['.env','.env.local'])process.loadEnvFile(new URL(`../../../web/${file}`,import.meta.url));
 const {prisma}=await import('../../../web/src/lib/db.ts');
 const db=await openDatabase(`${dir}/production.sqlite3`),allowlist={};let count=0;
 try {
 const bindings=JSON.parse(readFileSync('/home/ark296/.local/state/gotall-nanobot/verified-creator-bindings.json','utf8'))[guildId]||{};
 for(const [user,b] of Object.entries(bindings)) {
  const c=db.prepare('SELECT * FROM creators WHERE discord_user_id=? AND channel_id=?').get(user,b.channel_id);
  if(!c)continue;
  const accounts=b.accounts||(b.campaign_creator_id?[b]:[]);
  if(accounts.length!==1)continue;
  const link=accounts[0];
  const cc=await prisma.campaignCreator.findFirst({where:{id:link.campaign_creator_id,campaign:{organizationId:link.organization_id,organization:{slug:'gotall'}}},select:{creatorId:true}});
  if(!cc)throw Error('Verified creator no longer exists');
  const deals=await prisma.campaignCreatorDeal.findMany({where:{campaignCreatorId:link.campaign_creator_id,organizationId:link.organization_id}});
  for(const d of deals)db.prepare('INSERT OR REPLACE INTO creator_imported_deals VALUES(?,?,?)').run(user,d.id,JSON.stringify(d));
  db.prepare('INSERT OR REPLACE INTO creator_deal_bindings VALUES(?,?,?,?)').run(user,link.campaign_creator_id,link.organization_id,c.name);
  const profiles=await prisma.creatorPlatformAccount.findMany({where:{creatorId:cc.creatorId,platform:{in:['TIKTOK','INSTAGRAM_REELS']}},select:{platform:true,handle:true}});
  const source=profiles.filter(p=>p.handle).map(p=>({platform:p.platform==='TIKTOK'?'tiktok':'instagram',handle:p.handle.replace(/^@/u,'')}));
  db.prepare('INSERT OR REPLACE INTO creator_hub_sources(creator_id,accounts_json) VALUES(?,?)').run(user,JSON.stringify(source));
  allowlist[user]=link;count++;
 }
 db.prepare('INSERT OR REPLACE INTO resources VALUES(?,?,?)').run('user_technical_contact','571179674323910667',new Date().toISOString());
 save('production-deal-allowlist.json',allowlist);
 console.log('Imported existing verified terms without changing payout database:',count);
 }finally{db.close();await prisma.$disconnect();}
} else if(mode==='apply') {
 const before=load('before.json'),roster=load('roster.json');
 const db=await openDatabase(`${dir}/production.sqlite3`);
 const set=(k,v)=>db.prepare('INSERT OR REPLACE INTO resources VALUES(?,?,?)').run(k,v,new Date().toISOString());
 let roles=await api(`/guilds/${guildId}/roles`);
 let legacy=roles.find(r=>r.name==='Legacy');
 if(!legacy)legacy=await api(`/guilds/${guildId}/roles`,{method:'POST',body:JSON.stringify({name:'Legacy',permissions:'0',color:0x859c8c,mentionable:false})});
 set('role_legacy',legacy.id);
 let channels=await api(`/guilds/${guildId}/channels`);
 let archive=channels.find(c=>c.name==='Resource Archive'&&c.type===4);
 if(!archive)archive=await api(`/guilds/${guildId}/channels`,{method:'POST',body:JSON.stringify({name:'Resource Archive',type:4,permission_overwrites:resourcePermissions(guildId,[],[],botId)})});
 set('category_resource_archive',archive.id);
 const preserved=new Set(['1401971472163012741','1423052483982397631']);
 for(const c of before.channels.filter(c=>c.type!==4&&['1450438764412272742','1450439001080201226'].includes(c.parent_id)&&!preserved.has(c.id))) {
   await api(`/channels/${c.id}`,{method:'PATCH',body:JSON.stringify({parent_id:archive.id,permission_overwrites:resourcePermissions(guildId,[],[],botId)})});
 }
 await ensureGuildResources(config,db);
 const resources=Object.fromEntries(db.prepare('SELECT key,discord_id FROM resources').all().map(r=>[r.key,r.discord_id]));
 for(const r of roster) {
  for(const id of r.current) {
   await api(`/guilds/${guildId}/members/${id}/roles/${legacy.id}`,{method:'PUT'});
   if(r.scripts)await api(`/guilds/${guildId}/members/${id}/roles/${resources.role_scripts}`,{method:'PUT'});
  }
  const old=before.channels.find(c=>c.id===r.channel_id);
  const overwrite=old.permission_overwrites.filter(p=>![resources.role_staff,resources.role_admin].includes(p.id));
  for(const id of [resources.role_staff,resources.role_admin])overwrite.push({id,type:0,allow:'117760',deny:'0'});
  await api(`/channels/${r.channel_id}`,{method:'PATCH',body:JSON.stringify({permission_overwrites:overwrite})});
 }
 // No historical message is treated as a fresh assignment at cutover.
 const messages=await api(`/channels/${resources.channel_scripts}/messages?limit=1`);
 if(messages.length)set('scripts_cursor',messages[0].id);
 const staffPerms=resourcePermissions(guildId,[],[resources.role_staff,resources.role_admin],botId,true);
 let adminChannel=(await api(`/guilds/${guildId}/channels`)).find(c=>c.name==='admin-commands');
 const adminPerms=resourcePermissions(guildId,[],[resources.role_admin],botId,true);
 if(!adminChannel)adminChannel=await api(`/guilds/${guildId}/channels`,{method:'POST',body:JSON.stringify({name:'admin-commands',type:0,permission_overwrites:adminPerms})});
 set('channel_admin_commands',adminChannel.id);
 for(const id of ['1407632652764315748','1407634653724278834','1548307409989140551'])await api(`/channels/${id}`,{method:'PATCH',body:JSON.stringify({permission_overwrites:staffPerms})});
 const unknown=roster.filter(r=>r.needs_review);
 const sent=await api(`/channels/${resources.channel_staff_reviews}/messages`,{method:'POST',body:JSON.stringify({content:`<@1470834529077035195> Production cutover: existing creator channels and deals are preserved. Please confirm the account owner or script eligibility for these channels manually:\n${unknown.map(r=>`<#${r.channel_id}>`).join('\n')}`,allowed_mentions:{parse:[],users:['1470834529077035195']}})});
 save('applied.json',{resources:{...resources,channel_admin_commands:adminChannel.id},review_message:sent.id,at:new Date().toISOString()});
 db.close();console.log('Resources, legacy roles and roster applied. Runtime not switched yet.');
} else if(mode==='verify') {
 const before=load('before.json'),applied=load('applied.json'),roster=load('roster.json');
 const channels=await api(`/guilds/${guildId}/channels`),r=applied.resources;
 for(const c of before.channels)if(!channels.some(x=>x.id===c.id))throw Error('Original channel missing: '+c.id);
 for(const c of roster){const live=channels.find(x=>x.id===c.channel_id);if(live.parent_id!==before.channels.find(x=>x.id===c.channel_id).parent_id)throw Error('Legacy channel moved');}
 for(const [key,id] of Object.entries(r).filter(([k])=>k.startsWith('channel_legacy_'))) {
  const c=channels.find(c=>c.id===id);if(!c?.permission_overwrites.some(p=>p.id===r.role_legacy&&(BigInt(p.allow)&1024n)))throw Error('Legacy access missing '+key);
 }
 for(const row of roster)for(const id of row.current){const member=await api(`/guilds/${guildId}/members/${id}`);if(!member.roles.includes(r.role_legacy)||member.roles.includes(r.role_new_deal))throw Error('Legacy cohort violation');}
 const summary={all_original_channels_preserved:true,legacy_channels_preserved:roster.length,new_deal_granted_to_legacy:false,at:new Date().toISOString()};
 save('verified.json',summary);console.log(JSON.stringify(summary));
} else throw Error('Use snapshot, prepare, apply or verify');
