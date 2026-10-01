import {createServer} from 'node:http';
import {timingSafeEqual} from 'node:crypto';

// Payloads contain contract data. Never log or persist them: a webhook only
// requests a fresh authenticated provider scan, not approval from posted fields.
export function webhookQueue(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS jotform_webhook_queue(id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, requested_at TEXT NOT NULL)`);
  return {
    enqueue(){db.prepare(`INSERT INTO jotform_webhook_queue VALUES(1,1,?) ON CONFLICT(id) DO UPDATE SET revision=revision+1,requested_at=excluded.requested_at`).run(new Date().toISOString());},
    pending(){return db.prepare('SELECT revision FROM jotform_webhook_queue WHERE id=1').get()?.revision;},
    complete(revision){db.prepare('DELETE FROM jotform_webhook_queue WHERE id=1 AND revision=?').run(revision);},
  };
}
export function webhookServer({secret,queue,onQueued=()=>{}}) {
  if(!/^[a-f0-9]{64}$/.test(secret))throw Error('Webhook credential must be 32 random bytes in hex.');
  const expected=Buffer.from(`/jotform/${secret}`);
  return createServer({requestTimeout:10000,headersTimeout:10000},(req,res)=>{
    res.setHeader('Cache-Control','no-store');
    const path=Buffer.from(req.url||'');
    if(path.length!==expected.length||!timingSafeEqual(path,expected)){res.writeHead(404);res.end();req.resume();return;}
    if(req.method!=='POST'){res.writeHead(405,{Allow:'POST'});res.end();req.resume();return;}
    let bytes=0,done=false;
    req.on('data',chunk=>{
      bytes+=chunk.length;
      if(bytes>1024*1024&&!done){done=true;res.writeHead(413,{Connection:'close'});res.end();}
    });
    req.on('error',()=>{done=true;});
    req.on('end',()=>{
      if(done)return;
      try {queue.enqueue();res.writeHead(202);res.end('Accepted');onQueued();}
      catch {if(!res.headersSent){res.writeHead(503);res.end();}}
    });
  });
}
export function webhookPump(queue,check,{now=Date.now,onError=()=>{}}={}) {
  let busy=false,next=0;
  return async()=>{
    if(busy||now()<next)return;
    const revision=queue.pending();if(!revision)return;
    busy=true;
    try {await check();queue.complete(revision);next=now()+2000;}
    catch {next=now()+30000;onError();}
    finally {busy=false;}
  };
}
