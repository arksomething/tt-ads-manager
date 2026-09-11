import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

export function auditLog(db,c,month,page=0) {
  if(!/^\d{4}-\d{2}$/.test(month))throw new Error('Choose a valid month.');
  page=Math.max(0,Math.floor(Number(page)||0));
  const rows=db.prepare('SELECT audit_id,created_at,payload_json FROM creator_earnings_audits WHERE creator_id=? AND month=? ORDER BY created_at DESC LIMIT 5 OFFSET ?').all(c.discord_user_id,month,page*4);
  const shown=rows.slice(0,4);
  const button=(id,label)=>({type:2,style:2,custom_id:`gt:${id}`,label});
  return {content:'',embeds:[{title:`Calculation audit log · ${month}`,description:shown.length?shown.map((r,n)=>{const p=JSON.parse(r.payload_json);return `**${page*4+n+1}. ${p.summary.totalPay} ${p.creators?.[0]?.currency||'USD'}** · ${r.created_at}\nAudit: \`${r.audit_id}\``;}).join('\n\n'):'No calculation snapshots yet. Open Payments and choose Refresh.',footer:{text:'Preserved calculation snapshots. Estimates are not finalized payments.'}}],components:[...shown.map((r,n)=>({type:1,components:[button(`audit_pdf:${r.audit_id}`,`Download calculation ${page*4+n+1}`)]})),...(rows.length>4||page? [{type:1,components:[...(page?[button(`audit_log:${month}:${page-1}`,'Previous')]:[]),...(rows.length>4?[button(`audit_log:${month}:${page+1}`,'Next')]:[])]}]:[])].slice(0,5),allowed_mentions:{parse:[]}};
}

export function auditDownload(db,c,id) {
  const record=db.prepare('SELECT * FROM creator_earnings_audits WHERE audit_id=? AND creator_id=?').get(id,c.discord_user_id);
  if(!record)throw new Error('This calculation audit is not available for your account.');
  if(createHash('sha256').update(record.payload_json).digest('hex')!==record.sha256)throw new Error('Audit integrity check failed. Contact a manager.');
  const result=spawnSync('/usr/bin/python3',[fileURLToPath(new URL('./earnings_pdf.py',import.meta.url))],{input:JSON.stringify(record),timeout:20000,maxBuffer:10*1024*1024});
  if(result.status!==0||!result.stdout?.subarray(0,5).equals(Buffer.from('%PDF-')))throw new Error('The PDF could not be generated. Please try again.');
  const stem=`earnings-${record.month}-${id.slice(0,8)}`;
  return {content:'Your calculation snapshot and audit inputs. This is an earnings estimate; unresolved source checks are listed in the report.',embeds:[],components:[],allowed_mentions:{parse:[]},files:[{name:`${stem}.pdf`,data:result.stdout,contentType:'application/pdf'},{name:`${stem}.json`,data:Buffer.from(record.payload_json),contentType:'application/json'}]};
}

export function replyBody(content) {
  const {files,...payload}=content;
  if(!files?.length)return JSON.stringify(payload);
  const form=new FormData();
  form.set('payload_json',JSON.stringify({...payload,attachments:files.map((f,n)=>({id:n,filename:f.name}))}));
  files.forEach((f,n)=>form.set(`files[${n}]`,new Blob([f.data],{type:f.contentType}),f.name));
  return form;
}

