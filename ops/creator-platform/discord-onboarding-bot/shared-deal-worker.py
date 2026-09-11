"""Privileged transport for the bot outbox. Secrets stay with the application owner.
The root-owned binding file is the allowlist for real campaign creator writes.
"""
import json,os,re,sqlite3,subprocess,sys
from pathlib import Path
from urllib.parse import urlparse,parse_qs,unquote
SCRIPT='/usr/local/lib/gotall-discord-onboarding-test/shared-deal-worker.py'
BOT='/var/lib/gotall-discord-onboarding-test/onboarding.sqlite3'
BINDINGS='/etc/gotall-discord-deal-bindings.json'
def pg_env():
 values={}
 for filename in ['.env','.env.local']:
  for line in (Path('/home/ark296/projects/tt-ads-manager/web')/filename).read_text().splitlines():
   m=re.match(r'(?:export\s+)?([A-Z_]+)=(.*)',line.strip())
   if m:values[m[1]]=m[2].strip().strip('"').strip("'")
 u=urlparse(values['DATABASE_URL'])
 return {**os.environ,'PGHOST':u.hostname,'PGPORT':str(u.port or 5432),'PGUSER':unquote(u.username or ''),'PGPASSWORD':unquote(u.password or ''),'PGDATABASE':u.path.lstrip('/'),'PGSSLMODE':parse_qs(u.query).get('sslmode',['require'])[0],'PGCONNECT_TIMEOUT':'10','PGOPTIONS':'-c statement_timeout=15000 -c lock_timeout=5000'}
def query(sql):
 return subprocess.run(['/usr/bin/psql','-X','-q','-t','-A','-v','ON_ERROR_STOP=1'],input=sql,text=True,env=pg_env(),capture_output=True,timeout=25)
def quote(v):return "'"+str(v).replace("'","''")+"'"
def publish(r):
 binding=json.loads(Path(BINDINGS).read_text()).get(r['creator_id'])
 if not binding or r['campaign_creator_id']!=binding['campaign_creator_id'] or r['organization_id']!=binding['organization_id']:
  return {'id':r['id'],'status':'rejected','error':'This creator is not enabled for real deal updates.'}
 terms=json.loads(r['terms_json'])
 allowed={'currency','effectiveStartDate','effectiveEndDate','fixedFee','fixedFeeRecognitionDate','fixedFeePerVideo','cpmAmount','paidTrafficMetric','deductPaidTraffic','viewCapPerVideo','viewWindowDays','payoutCapPerVideo','perVideoCapScope','payoutCapTotal','notes','agreementUrl'}
 terms={k:v for k,v in terms.items() if k in allowed}
 args=[r['id'],binding['organization_id'],binding['campaign_creator_id'],r['source_deal_id'],r['expected_version_id'],'discord:'+r['actor_id'],json.dumps(terms)]
 sql='SELECT public.gotall_publish_creator_deal('+','.join(quote(v) for v in args[:-1])+','+quote(args[-1])+'::jsonb);'
 sql+='SELECT coalesce(jsonb_agg(to_jsonb(d)),\'[]\') FROM public."CampaignCreatorDeal" d WHERE "campaignCreatorId"='+quote(binding['campaign_creator_id'])+' AND "organizationId"='+quote(binding['organization_id'])+';'
 result=query(sql)
 if result.returncode:
  known=['The deal changed. Reopen it and review a fresh draft.','Choose today or a future effective date','These dates overlap another scheduled deal','The new deal cannot precede the selected deal','Complete the deal terms','End date must follow start date','Amounts and limits must not be negative','View limits must be positive','Set compensation']
  error=next((s for s in known if s in result.stderr),None)
  return {'id':r['id'],'status':'rejected' if error else 'pending','error':error or 'Connection unavailable; publication will retry safely.'}
 lines=result.stdout.strip().splitlines();published=json.loads(lines[0]);published['_relatedDeals']=json.loads(lines[1])
 return {'id':r['id'],'status':'published','result':published}
def db():
 c=sqlite3.connect(BOT,timeout=20);c.row_factory=sqlite3.Row;return c
def export():
 with db() as c:return [dict(r) for r in c.execute("SELECT * FROM creator_deal_outbox WHERE status='pending' ORDER BY created_at LIMIT 10")]
def ingest(results):
 with db() as c:
  for r in results:
   c.execute('UPDATE creator_deal_outbox SET status=?,result_json=?,error=? WHERE id=? AND status=?',(r['status'],json.dumps(r.get('result')),r.get('error'),r['id'],'pending'))
 return {'processed':len(results)}
def child(user,mode,data=None):
 return json.loads(subprocess.check_output(['/usr/sbin/runuser','-u',user,'--','/usr/bin/python3',SCRIPT,mode],input=json.dumps(data).encode(),timeout=45))
if __name__=='__main__':
 mode=sys.argv[1]
 if mode=='export':out=export()
 elif mode=='ingest':out=ingest(json.load(sys.stdin))
 elif mode=='publish':out=publish(json.load(sys.stdin))
 elif mode=='run':
  out=child('gotall-discord','ingest',[child('ark296','publish',r) for r in child('gotall-discord','export')])
 else:raise ValueError('Unsupported operation')
 print(json.dumps(out))
