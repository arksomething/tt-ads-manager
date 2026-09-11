import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {migrateHubs} from './hubs.mjs';
import {auditLog,auditDownload,replyBody} from './audit.mjs';
test('audits cannot be changed or deleted and history remains creator scoped with pagination',()=>{
 const db=new DatabaseSync(':memory:');migrateHubs(db);
 const insert=db.prepare('INSERT INTO creator_earnings_audits VALUES (?,?,?,?,?,?,?)');
 for(let n=0;n<7;n++)insert.run('a'+n,'owner','2026-09','r'+n,JSON.stringify({summary:{totalPay:n},creators:[]}), 'hash',`2026-09-11T00:00:0${n}Z`);
 assert.throws(()=>db.exec('DELETE FROM creator_earnings_audits'),/immutable/);
 assert.throws(()=>db.exec("UPDATE creator_earnings_audits SET sha256='changed'"),/immutable/);
 const first=auditLog(db,{discord_user_id:'owner'},'2026-09');
 assert.equal(first.components.length,5);assert.equal(first.components.at(-1).components[0].label,'Next');
 assert.match(auditLog(db,{discord_user_id:'other'},'2026-09').embeds[0].description,/No calculation/);
 assert.throws(()=>auditDownload(db,{discord_user_id:'other'},'a0'),/not available/);
 assert.throws(()=>auditDownload(db,{discord_user_id:'owner'},'a0'),/integrity/);
 db.close();
});
test('PDF replies use multipart bytes and preserve Discord attachment metadata',async()=>{
 const form=replyBody({content:'Audit',files:[{name:'audit.pdf',data:Buffer.from('%PDF-example'),contentType:'application/pdf'}]});
 assert.ok(form instanceof FormData);assert.equal(await form.get('files[0]').text(),'%PDF-example');
 assert.deepEqual(JSON.parse(form.get('payload_json')).attachments,[{id:0,filename:'audit.pdf'}]);
 assert.equal(replyBody({content:'Plain'}),JSON.stringify({content:'Plain'}));
});
