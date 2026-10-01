import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';

assert.equal(process.getuid(),0);
assert.equal(process.argv[2],'--confirm-retconned-reset');
const guild='1245112089647775877',user='571179674323910667';
const service='gotall-discord-onboarding-test.service';
const token=readFileSync(`/run/credentials/${service}/discord-bot-token`,'utf8').trim();
async function api(path,method='GET') {
  for(let n=0;n<6;n++) {
    const r=await fetch('https://discord.com/api/v10'+path,{method,headers:{Authorization:'Bot '+token},signal:AbortSignal.timeout(30000)});
    if(r.status===429){const d=await r.json();await new Promise(resolve=>setTimeout(resolve,d.retry_after*1000+100));continue;}
    if(r.status===204||(r.status===404&&method==='DELETE'))return null;
    assert.ok(r.ok,`Discord HTTP ${r.status}`);return r.json();
  }
  throw Error('Discord retry limit reached');
}
assert.equal((await api(`/guilds/${guild}/members/${user}`)).user.username,'retconned.');
execFileSync('systemctl',['stop',service]);
try {
  const db=new DatabaseSync('/var/lib/gotall-discord-onboarding-test/onboarding.sqlite3');
  const creator=db.prepare('SELECT * FROM creators WHERE discord_user_id=?').get(user);
  assert.ok(creator);
  assert.equal((await api(`/channels/${creator.channel_id}`)).guild_id,guild);
  const others=JSON.stringify(db.prepare('SELECT * FROM creators WHERE discord_user_id<>? ORDER BY discord_user_id').all(user));
  const r=Object.fromEntries(db.prepare('SELECT key,discord_id FROM resources').all().map(x=>[x.key,x.discord_id]));
  const archive=`/var/backups/gotall-discord-test/one-creator-${Date.now()}`;
  mkdirSync(archive,{recursive:true,mode:0o700});
  db.exec(`VACUUM INTO '${archive}/onboarding.sqlite3'`);
  const messages=[];let before;
  for(let page=0;page<50;page++){
    const rows=await api(`/channels/${creator.channel_id}/messages?limit=100${before?`&before=${before}`:''}`);
    messages.push(...rows);if(rows.length<100)break;
    assert.ok(page<49,'Channel archive limit exceeded');before=rows.at(-1).id;
  }
  writeFileSync(`${archive}/messages.json`,JSON.stringify(messages),{mode:0o600});
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('UPDATE jotform_requests SET active=0 WHERE creator_id=?').run(user);
    db.prepare('DELETE FROM creator_post_meta WHERE video_key IN (SELECT video_key FROM creator_posts WHERE creator_id=?)').run(user);
    for(const table of ['creator_posts','script_drafts','trial_reports','tracker_account_links','creator_hub_sources','creator_hub_metrics'])db.prepare(`DELETE FROM ${table} WHERE creator_id=?`).run(user);
    for(const d of db.prepare('SELECT id,channel_id,payload FROM deliveries').all()) {
      const p=JSON.parse(d.payload);
      if(d.channel_id===creator.channel_id||p.approval_creator_id===user||p.review_creator_id===user)db.prepare("UPDATE deliveries SET message_id='cancelled-account-reset' WHERE id=? AND message_id IS NULL").run(d.id);
    }
    db.prepare('DELETE FROM creators WHERE discord_user_id=?').run(user);
    assert.equal(JSON.stringify(db.prepare('SELECT * FROM creators WHERE discord_user_id<>? ORDER BY discord_user_id').all(user)),others);
    db.exec('COMMIT');
  }catch(e){db.exec('ROLLBACK');throw e;}
  for(const key of ['role_onboarding','role_active','role_at_risk','role_hub_access','role_scripts','role_new_deal'])if(r[key])await api(`/guilds/${guild}/members/${user}/roles/${r[key]}`,'DELETE');
  await api(`/channels/${creator.channel_id}`,'DELETE');
  const member=await api(`/guilds/${guild}/members/${user}`);
  assert.ok(!['role_scripts','role_new_deal','role_active','role_hub_access','role_onboarding','role_at_risk'].some(k=>member.roles.includes(r[k])));
  console.log(JSON.stringify({reset:true,otherCreatorsUnchanged:true,archive,startChannel:r.channel_start_here}));
  db.close();
}finally{execFileSync('systemctl',['start',service]);}
