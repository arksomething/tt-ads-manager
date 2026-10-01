import {randomBytes, createHash} from 'node:crypto';

export const JOTFORM_ID = '262582983401057';
export const TOKEN_FIELD = 'gotallAgreementToken';
export const POLL_INTERVAL = 5 * 60_000;

export function migrateJotform(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS jotform_requests (
    token TEXT PRIMARY KEY, creator_id TEXT NOT NULL, issued_at TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1
  );
  CREATE UNIQUE INDEX IF NOT EXISTS jotform_active_creator ON jotform_requests(creator_id) WHERE active=1;
  CREATE TABLE IF NOT EXISTS jotform_receipts (
    submission_id TEXT PRIMARY KEY, token TEXT NOT NULL, creator_id TEXT NOT NULL,
    checked_at TEXT NOT NULL, complete INTEGER NOT NULL, checks_json TEXT NOT NULL,
    response_hash TEXT NOT NULL
  );`);
}

export function isDefaultAgreement(value) {
  try { const u=new URL(value); return u.protocol==='https:' && ['form.jotform.com','www.jotform.com','jotform.com'].includes(u.hostname) && u.pathname===`/${JOTFORM_ID}`; }
  catch { return false; }
}

function answer(s,id) { return s.answers?.[id]?.answer; }
function namePresent(a) { return Boolean(a && typeof a==='object' && String(a.first||'').trim() && String(a.last||'').trim()); }
function datePresent(a) {
  if(!a || typeof a!=='object')return false;
  const y=Number(a.year),m=Number(a.month),d=Number(a.day);
  const date=new Date(Date.UTC(y,m-1,d));
  return y>=2000 && y<=2100 && date.getUTCFullYear()===y && date.getUTCMonth()===m-1 && date.getUTCDate()===d;
}
function signaturePresent(a) {
  if(typeof a!=='string')return false;
  try { const u=new URL(a); return u.protocol==='https:' && ['jotform.com','jotform.co','jotform.me','jotform.pro','jotformeu.com','jotformz.com'].some(h=>u.hostname===h||u.hostname.endsWith('.'+h)) && /\/uploads\//.test(u.pathname); }
  catch { return false; }
}

// A provider receipt proves that fields were submitted, not signer identity,
// capacity, or a guardian's authority. Automatic onboarding is not legal verification.
export function inspectSubmission(s, token) {
  const checks={
    correctForm:String(s.form_id)===JOTFORM_ID,
    active:s.status==='ACTIVE',
    linked:typeof token==='string' && token.length===64 && answer(s,'66')===token,
    creatorName:namePresent(answer(s,'49')),
    creatorSignature:signaturePresent(answer(s,'50')),
    creatorDate:datePresent(answer(s,'52')),
    guardianName:namePresent(answer(s,'55')),
    guardianSignature:signaturePresent(answer(s,'56')),
    guardianDate:datePresent(answer(s,'58')),
  };
  const guardianAny=['55','56','58'].some(id=>{
    const a=answer(s,id); return typeof a==='object'&&a!==null?Object.values(a).some(Boolean):Boolean(a);
  });
  checks.guardianSectionConsistent=!guardianAny || (checks.guardianName&&checks.guardianSignature&&checks.guardianDate);
  return {checks,complete:['correctForm','active','linked','creatorName','creatorSignature','creatorDate','guardianSectionConsistent'].every(k=>checks[k])};
}

export function jotformClient(apiKey, request=fetch) {
  return async path=>{
    let r;
    try {r=await request(`https://api.jotform.com${path}`,{headers:{APIKEY:apiKey},signal:AbortSignal.timeout(20_000),redirect:'error'});}
    catch {throw new Error('Jotform connection unavailable. No signature approval was recorded.');}
    let data;try{data=await r.json();}catch{throw new Error('Jotform returned an invalid response.');}
    if(!r.ok||data.responseCode!==200)throw new Error(`Jotform API unavailable (HTTP ${r.status}, code ${data.responseCode}). No signature approval was recorded.`);
    return data.content;
  };
}

export function createJotform(db,{apiKey,request,onReceipt=()=>{},onIncomplete=()=>{},reprocessComplete=false}={}) {
  migrateJotform(db);
  const enabled=Boolean(apiKey), api=enabled?jotformClient(apiKey,request):null;
  let nextPoll=0;
  const active=id=>db.prepare('SELECT * FROM jotform_requests WHERE creator_id=? AND active=1').get(id);
  function issue(c,url,now=Date.now()) {
    if(!enabled||!isDefaultAgreement(url))return url;
    let row=active(c.discord_user_id);
    if(!row){row={token:randomBytes(32).toString('hex'),creator_id:c.discord_user_id,issued_at:new Date(now).toISOString()};db.prepare('INSERT INTO jotform_requests(token,creator_id,issued_at) VALUES (?,?,?)').run(row.token,row.creator_id,row.issued_at);}
    const u=new URL(url);u.searchParams.set(TOKEN_FIELD,row.token);return u.href;
  }
  function invalidate(id) {db.prepare('UPDATE jotform_requests SET active=0 WHERE creator_id=? AND active=1').run(id);}
  function receipt(id) {
    return db.prepare(`SELECT r.* FROM jotform_receipts r JOIN jotform_requests q ON q.token=r.token
      WHERE q.creator_id=? AND q.active=1 ORDER BY r.complete DESC,r.checked_at DESC,r.submission_id DESC LIMIT 1`).get(id);
  }
  function ingest(s,now=Date.now()) {
    if(!/^\d{10,30}$/.test(String(s.id||''))||String(s.form_id)!==JOTFORM_ID)return null;
    const token=answer(s,'66'); if(typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token))return null;
    const q=db.prepare('SELECT * FROM jotform_requests WHERE token=? AND active=1').get(token);
    if(!q)return null;
    const c=db.prepare('SELECT * FROM creators WHERE discord_user_id=?').get(q.creator_id);
    if(!c||!['agreement','agreement_review'].includes(c.stage)||!isDefaultAgreement(c.agreement_url))return null;
    if(new URL(c.agreement_url).searchParams.get(TOKEN_FIELD)!==token)return null;
    const result=inspectSubmission(s,token),hash=createHash('sha256').update(JSON.stringify(s)).digest('hex');
    const prior=db.prepare('SELECT * FROM jotform_receipts WHERE submission_id=?').get(String(s.id));
    if(prior&&prior.token!==token)throw new Error('Jotform submission was already linked to another agreement.');
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare(`INSERT INTO jotform_receipts VALUES (?,?,?,?,?,?,?) ON CONFLICT(submission_id) DO UPDATE SET checked_at=excluded.checked_at,complete=excluded.complete,checks_json=excluded.checks_json,response_hash=excluded.response_hash`).run(String(s.id),token,q.creator_id,new Date(now).toISOString(),Number(result.complete),JSON.stringify(result.checks),hash);
      if(result.complete && (!prior||!prior.complete||reprocessComplete))onReceipt(c,{id:String(s.id),...result},now);
      if(!result.complete)onIncomplete(c,{id:String(s.id),...result},now);
      db.exec('COMMIT');
    }catch(e){db.exec('ROLLBACK');throw e;}
    return result;
  }
  async function poll(now=Date.now(),force=false) {
    if(!enabled||(!force&&now<nextPoll))return;
    nextPoll=now+POLL_INTERVAL;
    const pending=db.prepare(`SELECT q.token FROM jotform_requests q JOIN creators c ON c.discord_user_id=q.creator_id WHERE q.active=1 AND c.stage IN ('agreement','agreement_review')`).all();
    if(!pending.length)return;
    const questions=await api(`/form/${JOTFORM_ID}/questions`);
    if(questions['66']?.name!==TOKEN_FIELD || questions['50']?.type!=='control_signature' || questions['56']?.type!=='control_signature')throw new Error('Jotform field schema changed; signature processing paused.');
    for(let offset=0;offset<1000;offset+=100){
      const rows=await api(`/form/${JOTFORM_ID}/submissions?limit=100&offset=${offset}&orderby=created_at&direction=DESC`);
      if(!Array.isArray(rows))throw new Error('Jotform submission list is invalid.');
      for(const s of rows)ingest(s,now);
      if(rows.length<100)return;
    }
    throw new Error('Jotform scan exceeded 1000 submissions; staff should check the integration backlog.');
  }
  async function verify(c,now=Date.now()) {
    if(!enabled||!isDefaultAgreement(c.agreement_url))return null;
    const q=active(c.discord_user_id);if(!q)return null; // Existing legacy staff-reviewed agreements.
    let r=receipt(c.discord_user_id);
    if(!r?.complete){await poll(now,true);r=receipt(c.discord_user_id);}
    if(!r?.complete)throw new Error('No complete Jotform submission is linked yet. Have the creator use Review & sign and complete their name, signature and date. Staff must also check any required guardian section.');
    const s=await api(`/submission/${r.submission_id}`),result=inspectSubmission(s,q.token);
    if(String(s.id)!==r.submission_id||!result.complete)throw new Error('The Jotform submission is no longer complete or does not match this creator. Approval stopped.');
    return {submissionId:r.submission_id,checks:result.checks};
  }
  return {enabled,issue,invalidate,receipt,ingest,poll,verify};
}
