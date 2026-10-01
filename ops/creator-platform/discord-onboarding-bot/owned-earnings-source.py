"""Read owned tracker evidence by native account identity; never change tracking state."""
import datetime,json,sqlite3,sys,time

DB='/var/lib/creator-tracker/state/gotall-viral.db'

def export(request, connection=None):
    start=datetime.date.fromisoformat(request['start_date'])
    end=datetime.date.fromisoformat(request['end_date'])
    if not 0 <= (end-start).days < 90: raise ValueError('Invalid report range')
    accounts=request['accounts']
    if not accounts or len(accounts)>20: raise ValueError('Verified account IDs required')
    since=int(datetime.datetime.combine(start-datetime.timedelta(days=90),datetime.time(),datetime.timezone.utc).timestamp()*1000)
    until=int(datetime.datetime.combine(end+datetime.timedelta(days=1),datetime.time(),datetime.timezone.utc).timestamp()*1000)
    c=connection or sqlite3.connect('file:'+DB+'?mode=ro',uri=True,timeout=20)
    c.row_factory=sqlite3.Row
    result={'captured_at':int(time.time()*1000),'accounts':[],'videos':[]}
    # A read transaction keeps the inventory, observations and finalizations consistent.
    c.execute('BEGIN')
    try:
        seen=set()
        for account in accounts:
            key=(account['platform'].lower(),str(account['native_account_id']))
            if key in seen: continue
            seen.add(key)
            rows=c.execute('SELECT id,handle,native_account_id,platform FROM creators WHERE platform=? AND native_account_id=?',key).fetchall()
            if len(rows)!=1: raise ValueError('Owned tracker account missing or ambiguous')
            a=dict(rows[0]);result['accounts'].append(a)
            for row in c.execute('SELECT * FROM videos WHERE creator_id=? AND posted_at>=? AND posted_at<? ORDER BY posted_at,id',(a['id'],since,until)).fetchall():
                v=dict(row)
                observations=[dict(o) for o in c.execute("SELECT id,observed_at,source_observed_at,source,confidence,is_complete,views,availability,evidence_manifest_sha256 FROM video_metric_observations WHERE video_id=? AND confidence='direct' ORDER BY observed_at,id",(v['id'],))]
                final=c.execute('SELECT * FROM video_window_finalizations WHERE video_id=? ORDER BY finalized_at DESC,id DESC LIMIT 1',(v['id'],)).fetchone()
                result['videos'].append({'id':str(v['id']),'native_account_id':a['native_account_id'],'handle':a['handle'],'platform':v['platform'],'sourceVideoId':v['platform_video_id'],'url':v['url'],'caption':v['description'],'publishedAt':v['posted_at'],'excluded':bool(v['excluded']),'availability':v['availability'],'observations':observations,'finalization':dict(final) if final else None})
        return result
    finally:
        c.rollback()
        if connection is None:c.close()

if __name__=='__main__': print(json.dumps(export(json.load(sys.stdin))))
