"""Calculate requested snapshots using the existing GoTall earnings engine."""
import json,sqlite3,subprocess,sys,hashlib,uuid
from earnings_audit import reconcile
DB='/var/lib/gotall-discord-onboarding-test/onboarding.sqlite3'
ROOT='/usr/local/lib/gotall-discord-onboarding-test/'
def db():
 c=sqlite3.connect(DB,timeout=20);c.row_factory=sqlite3.Row;return c
def export():
 with db() as c:return [dict(r) for r in c.execute("SELECT creator_id,month,request_id FROM creator_earnings WHERE state='pending' ORDER BY requested_at LIMIT 1")]
def ingest(results):
 with db() as c:
  for r in results:
   if r.get('error'):
    c.execute("UPDATE creator_earnings SET state='error',error=? WHERE creator_id=? AND month=? AND request_id=?",(r['error'],r['creator_id'],r['month'],r['request_id']))
   else:
    current=c.execute('SELECT request_id FROM creator_earnings WHERE creator_id=? AND month=?',(r['creator_id'],r['month'])).fetchone()
    if not current or current['request_id']!=r['request_id']:continue
    prior=c.execute('SELECT payload_json FROM creator_earnings_audits WHERE request_id=?',(r['request_id'],)).fetchone()
    if prior:payload=prior['payload_json']
    else:
     data={**r['result'],'audit_id':str(uuid.uuid4()),'audit_checks':reconcile(r['result'])}
     payload=json.dumps(data,sort_keys=True,separators=(',',':'),ensure_ascii=False)
     digest=hashlib.sha256(payload.encode()).hexdigest()
     c.execute('INSERT INTO creator_earnings_audits VALUES (?,?,?,?,?,?,?)',(data['audit_id'],r['creator_id'],r['month'],r['request_id'],payload,digest,data['calculated_at']))
    c.execute("UPDATE creator_earnings SET state='ready',payload_json=?,error=NULL WHERE creator_id=? AND month=? AND request_id=?",(payload,r['creator_id'],r['month'],r['request_id']))
 return {'processed':len(results)}
def child(mode,data=None):
 return json.loads(subprocess.check_output(['/usr/sbin/runuser','-u','gotall-discord','--','python3',ROOT+'earnings-worker.py',mode],input=json.dumps(data).encode(),timeout=30))
if __name__=='__main__':
 mode=sys.argv[1]
 if mode=='export':out=export()
 elif mode=='ingest':out=ingest(json.load(sys.stdin))
 elif mode=='run':
  results=[]
  for r in child('export'):
   try:
    run=subprocess.run(['/usr/sbin/runuser','-u','ark296','--',ROOT+'node',ROOT+'export-calculated-earnings.mjs'],input=json.dumps([r]),text=True,capture_output=True,timeout=180)
    if run.returncode:raise ValueError('Calculator failed')
    result=json.loads(run.stdout)[0]
    if result['creator_id']!=r['creator_id'] or result['month']!=r['month'] or result.get('error'):raise ValueError('Invalid calculation')
    if result['summary']['creators']==0 and result.get('warnings'):raise ValueError('Missing source data')
    results.append({**r,'result':result})
   except (ValueError,KeyError,IndexError,subprocess.SubprocessError):
    results.append({**r,'error':'The calculator could not load complete source data. Choose Refresh to retry.'})
  out=child('ingest',results)
 else:raise ValueError('Unknown operation')
 print(json.dumps(out))
