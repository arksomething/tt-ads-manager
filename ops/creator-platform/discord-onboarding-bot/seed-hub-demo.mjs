// Explicit, repeatable fixture for retconned's server only. No tracker or payment-provider writes.
import {openDatabase} from '/usr/local/lib/gotall-discord-onboarding-test/bot.mjs';
import {TEST_GUILD_ID} from '/usr/local/lib/gotall-discord-onboarding-test/flow.mjs';
if(process.argv[2]!==TEST_GUILD_ID||process.argv[3]!=='571179674323910667')throw Error('Specify retconned test guild and creator IDs.');
const uid=process.argv[3],db=await openDatabase('/var/lib/gotall-discord-onboarding-test/onboarding.sqlite3');
const c=db.prepare('SELECT * FROM creators WHERE discord_user_id=?').get(uid);
if(!c||c.channel_id!=='1547582575609126982')throw Error('The expected test creator channel was not found.');
const originalAccounts=c.campaign_accounts;
const now=new Date().toISOString();
const samples=[
 {id:'7683358255162133773',date:'2026-09-09T03:57:28.748Z',views:18420,status:'ok',title:'AliGoTall · September 9'},
 {id:'7682994908826733837',date:'2026-09-08T03:06:12.489Z',views:null,status:'pending',title:'AliGoTall · September 8'},
];
db.exec('BEGIN IMMEDIATE');
try {
 for(const [index,s] of samples.entries()) {
  const key=`tiktok:hub-demo:${uid}:${s.id}`,group=`hub-demo:${uid}:${s.id}`;
  db.prepare('INSERT OR IGNORE INTO creator_posts VALUES (?,?,?,?)').run(key,uid,`https://www.tiktok.com/@aligotall/video/${s.id}`,s.date);
  db.prepare(`INSERT INTO creator_post_meta (video_key,submission_id,title,views,last_checked_at,tracking_status,sample_label)
   VALUES (?,?,?,?,?,?,?) ON CONFLICT(video_key) DO UPDATE SET views=excluded.views,last_checked_at=excluded.last_checked_at,tracking_status=excluded.tracking_status`).run(key,group,s.title,s.views,s.views===null?null:now,s.status,'AliGoTall public links');
  if(index===0) {
   const igKey=`instagram:hub-demo:${uid}:${s.id}`;
   db.prepare('INSERT OR IGNORE INTO creator_posts VALUES (?,?,?,?)').run(igKey,uid,'https://example.com/instagram/sample-published-post',s.date);
   db.prepare('INSERT OR IGNORE INTO creator_post_meta (video_key,submission_id,title,views,last_checked_at,tracking_status,sample_label) VALUES (?,?,?,?,?,?,?)').run(igKey,group,s.title,5600,now,'ok','Instagram placeholder');
  }
 }
 const statements=[
  {month:'2026-09',status:'draft',items:[{label:'Example eligible organic views',amount_cents:2450},{label:'Example base component',amount_cents:5000}],paid:0,note:'Illustrative calculation only. This is not AliGoTall’s agreement or actual earnings.'},
  {month:'2026-08',status:'processing',items:[{label:'Example eligible organic views',amount_cents:8450},{label:'Example base component',amount_cents:10000}],paid:0,note:'Example of a finalized statement awaiting transfer. No transfer is actually running.',expected:'2026-09-12'},
  {month:'2026-07',status:'paid',items:[{label:'Example eligible organic views',amount_cents:6000},{label:'Example base component',amount_cents:10000}],paid:16000,note:'Example completed payment; no actual payment was made.',paidAt:'2026-08-03T12:00:00Z'},
 ];
 for(const s of statements) {
  const prior=db.prepare('SELECT sample_label FROM creator_statements WHERE creator_id=? AND month=?').get(uid,s.month);
  if(prior&&!prior.sample_label)throw Error('Refusing to replace a non-sample statement.');
  db.prepare(`INSERT INTO creator_statements (creator_id,month,currency,status,items_json,paid_cents,updated_at,paid_at,expected_date,note,sample_label)
    VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(creator_id,month) DO UPDATE SET status=excluded.status,items_json=excluded.items_json,paid_cents=excluded.paid_cents,updated_at=excluded.updated_at,paid_at=excluded.paid_at,expected_date=excluded.expected_date,note=excluded.note,sample_label=excluded.sample_label`).run(uid,s.month,'USD',s.status,JSON.stringify(s.items),s.paid,now,s.paidAt||null,s.expected||null,s.note,'Retconned demonstration');
 }
 db.prepare('UPDATE creators SET sync_pending=1 WHERE discord_user_id=?').run(uid);
 if(db.prepare('SELECT campaign_accounts FROM creators WHERE discord_user_id=?').get(uid).campaign_accounts!==originalAccounts)throw Error('Account details changed unexpectedly.');
 db.exec('COMMIT');
 console.log('Seeded two sample video groups and three sample statements for retconned only. Account settings unchanged.');
}catch(e){db.exec('ROLLBACK');throw e;}finally{db.close();}
