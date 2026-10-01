import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {webhookQueue,webhookServer,webhookPump} from './jotform-webhook.mjs';
test('HTTP webhook authenticates before durably queuing and never stores posted signatures',async()=>{
 const db=new DatabaseSync(':memory:'),q=webhookQueue(db),secret='a'.repeat(64),s=webhookServer({secret,queue:q});
 await new Promise(r=>s.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${s.address().port}`;
 try {
 assert.equal((await fetch(base+'/wrong',{method:'POST'})).status,404);assert.equal(q.pending(),undefined);
 assert.equal((await fetch(base+'/jotform/'+secret)).status,405);
 assert.equal((await fetch(base+'/jotform/'+secret,{method:'POST',body:'signature=FAKE&submissionID=123'})).status,202);
 assert.equal(q.pending(),1);
 assert.equal((await fetch(base+'/jotform/'+secret,{method:'POST',body:new FormData()})).status,202);assert.equal(q.pending(),2);
 assert.equal((await fetch(base+'/jotform/'+secret,{method:'POST',body:'x'.repeat(1024*1024+1)})).status,413);assert.equal(q.pending(),2);
 assert.ok(!JSON.stringify(db.prepare('SELECT * FROM jotform_webhook_queue').all()).includes('FAKE'));
 }finally{s.closeAllConnections();await new Promise(r=>s.close(r));db.close();}
});
test('queue survives worker recreation, retains concurrent events and retries API errors',async()=>{
 const db=new DatabaseSync(':memory:'),q=webhookQueue(db);let now=0,calls=0,fail=true;
 q.enqueue();const pump=webhookPump(webhookQueue(db),async()=>{calls++;if(fail)throw Error('API down');q.enqueue();},{now:()=>now});
 await pump();assert.equal(q.pending(),1);await pump();assert.equal(calls,1);
 now=30000;fail=false;await pump();assert.equal(q.pending(),2);
 now=32000;const restarted=webhookPump(webhookQueue(db),async()=>{calls++;},{now:()=>now});await restarted();assert.equal(q.pending(),undefined);db.close();
});
