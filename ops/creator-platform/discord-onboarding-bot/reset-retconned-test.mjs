// Explicit operator-only reset. Never touches the source tracker or Jotform.
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,mkdirSync,writeFileSync,renameSync,chownSync,chmodSync,statSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';

assert.equal(process.argv[2],'--confirm-retconned-reset');
assert.equal(process.getuid(),0,'Run as root so the archive stays private.');
const guild='1245112089647775877',user='571179674323910667';
const path='/var/lib/gotall-discord-onboarding-test/onboarding.sqlite3';
const token=readFileSync('/run/credentials/gotall-discord-onboarding-test.service/discord-bot-token','utf8').trim();
const bot='gotall-discord-onboarding-test.service';
const timers=['gotall-discord-hub-metrics.timer','gotall-discord-deals.timer','gotall-discord-earnings.timer'];
const workers=timers.map(t=>t.replace('.timer','.service'));
async function api(route,method='GET') {
  for(let n=0;n<5;n++) {
    const r=await fetch(`https://discord.com/api/v10${route}`,{method,headers:{Authorization:`Bot ${token}`},signal:AbortSignal.timeout(30000)});
    const data=r.status===204?null:await r.json();
    if(r.status===429){await new Promise(resolve=>setTimeout(resolve,Math.ceil(Number(data.retry_after)*1000)+100));continue;}
    if(r.status===404&&method==='DELETE')return null;
    if(!r.ok)throw new Error(`Discord ${method} failed: HTTP ${r.status}`);
    return data;
  }
  throw new Error('Discord rate limit did not clear.');
}
async function messages(channel) {
  const all=[];let before;
  for(let page=0;page<50;page++) {
    const rows=await api(`/channels/${channel}/messages?limit=100${before?`&before=${before}`:''}`);
    all.push(...rows);if(rows.length<100)return all;before=rows.at(-1).id;
  }
  throw new Error('Archive exceeds 5000 messages; no reset performed.');
}
const member=await api(`/guilds/${guild}/members/${user}`);
assert.equal(member.user.username,'retconned.');
const me=await api('/users/@me');
let d=new DatabaseSync(path,{readOnly:true});
const creators=d.prepare('SELECT discord_user_id,channel_id FROM creators').all();
assert.equal(creators.length,1,'This whole test-state reset requires exactly one creator.');
assert.equal(creators[0].discord_user_id,user);
const channel=creators[0].channel_id;
assert.equal((await api(`/channels/${channel}`)).guild_id,guild);
const resources=d.prepare('SELECT * FROM resources').all();
const ids=Object.fromEntries(resources.map(r=>[r.key,r.discord_id]));
const delivered=new Set(d.prepare('SELECT message_id FROM deliveries WHERE channel_id=?').all(ids.channel_staff_reviews).map(r=>r.message_id));
d.close();
const ownMessages=await messages(channel);
const staffMessages=(await messages(ids.channel_staff_reviews)).filter(m=>m.author?.id===me.id&&(delivered.has(m.id)||JSON.stringify(m).includes(user)||JSON.stringify(m).includes(channel)));
const archive=`/var/backups/gotall-discord-test/reset-${new Date().toISOString().replace(/[:.]/g,'-')}`;
mkdirSync(archive,{recursive:true,mode:0o700});
writeFileSync(`${archive}/discord-messages.json`,JSON.stringify({guild,user,channel,ownMessages,staffMessages},null,2),{mode:0o600,flag:'wx'});
const activeTimers=timers.filter(unit=>{try{return execFileSync('systemctl',['is-active',unit],{encoding:'utf8'}).trim()==='active';}catch{return false;}});
let stopped=false;
try {
  execFileSync('systemctl',['stop',...timers,...workers,bot]);stopped=true;
  d=new DatabaseSync(path);
  assert.equal(d.prepare('SELECT count(*) n FROM creators').get().n,1);
  assert.equal(d.prepare('SELECT discord_user_id FROM creators').get().discord_user_id,user);
  assert.equal(d.prepare("SELECT count(*) n FROM creator_deal_outbox WHERE status='pending'").get().n,0,'Pending real deal publication must settle before reset.');
  const schema=d.prepare("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 WHEN 'view' THEN 2 ELSE 3 END").all();
  d.exec('PRAGMA wal_checkpoint(TRUNCATE)');d.close();
  const freshPath=`${path}.fresh-reset`;
  assert.equal(existsSync(freshPath),false);
  const fresh=new DatabaseSync(freshPath);
  for(const row of schema)fresh.exec(row.sql);
  for(const r of resources)fresh.prepare('INSERT INTO resources VALUES (?,?,?)').run(r.key,r.discord_id,r.updated_at);
  assert.equal(fresh.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
  fresh.close();
  const ownership=statSync(path);chownSync(freshPath,ownership.uid,ownership.gid);chmodSync(freshPath,0o600);
  // Keep the original database intact, including immutable earnings audit rows.
  renameSync(path,`${archive}/onboarding.sqlite3`);
  renameSync(freshPath,path);
  for(const key of ['role_onboarding','role_active','role_at_risk','role_hub_access']) {
    if(ids[key]&&member.roles.includes(ids[key]))await api(`/guilds/${guild}/members/${user}/roles/${ids[key]}`,'DELETE');
  }
  for(const m of staffMessages)await api(`/channels/${ids.channel_staff_reviews}/messages/${m.id}`,'DELETE');
  await api(`/channels/${channel}`,'DELETE');
  writeFileSync(`${archive}/reset.json`,JSON.stringify({guild,user,old_channel:channel,creator_messages_archived:ownMessages.length,staff_messages_removed:staffMessages.length,reset_at:new Date().toISOString()},null,2),{mode:0o600});
  console.log(JSON.stringify({reset:true,archive,creator_messages_archived:ownMessages.length,staff_messages_removed:staffMessages.length,start_channel:ids.channel_start_here}));
} finally {
  if(stopped)execFileSync('systemctl',['start',bot,...activeTimers]);
}
