"""Read-only tracker/provider projection into the Discord test bot's private cache."""
import datetime,json,sqlite3,subprocess,sys,time
BOT='/var/lib/gotall-discord-onboarding-test/onboarding.sqlite3'
TRACKER='/var/lib/creator-tracker/state/gotall-viral.db'
SCRIPT='/usr/local/lib/gotall-discord-onboarding-test/hub-metrics-bridge.py'
SOURCES={'viral':("viral_app_provider","viral_app_seed"),'tracker':("tiktok_ytdlp","tiktok_ytdlp_incidental_alignment","scrapecreators","scrapecreators_tiktok_incidental_alignment","scrapecreators_instagram")}

def db(path,readonly=True):
    c=sqlite3.connect('file:'+path+('?mode=ro' if readonly else '?mode=rw'),uri=True,timeout=20);c.row_factory=sqlite3.Row;return c

def export():
    with db(BOT) as c:
        return [dict(r) for r in c.execute('SELECT creator_id,accounts_json FROM creator_hub_sources')]

def project(configs):
    result=[];now=int(time.time()*1000);cutoff=now-180*86400000
    with db(TRACKER) as c:
        for config in configs:
            records=[];coverage=[]
            for a in json.loads(config['accounts_json']):
                account=c.execute('SELECT id FROM creators WHERE platform=? AND lower(handle)=?',(a['platform'],a['handle'].lower())).fetchone()
                if not account:
                    coverage.append({'platform':a['platform'],'handle':a['handle'],'found':False});continue
                coverage.append({'platform':a['platform'],'handle':a['handle'],'found':True})
                for source,adapters in SOURCES.items():
                    placeholders=','.join('?' for _ in adapters)
                    rows=c.execute(f'''SELECT v.platform_video_id,v.platform,v.url,v.description,v.posted_at,
                        o.views,o.observed_at,o.source_observed_at,o.is_complete,o.availability,o.source,o.confidence
                        FROM videos v JOIN video_metric_observations o ON o.id=(
                          SELECT id FROM video_metric_observations WHERE video_id=v.id AND source IN ({placeholders}) AND confidence=?
                          ORDER BY observed_at DESC,id DESC LIMIT 1)
                        WHERE v.creator_id=? AND v.posted_at>=? ORDER BY v.posted_at DESC LIMIT 500''',(*adapters,'provider' if source=='viral' else 'direct',account['id'],cutoff))
                    for r in rows:
                        d=dict(r);d['provider']=source;d['handle']=a['handle'];d['views']=r['views'] if r['is_complete'] else None;records.append(d)
            result.append({'creator_id':config['creator_id'],'accounts_json':config['accounts_json'],'records':records,'coverage':coverage,'refreshed_at':now})
    return result

def ingest(results):
    with db(BOT,False) as c:
        total=0
        for r in results:
            config=c.execute('SELECT accounts_json FROM creator_hub_sources WHERE creator_id=?',(r['creator_id'],)).fetchone()
            if not config or config['accounts_json']!=r['accounts_json']:continue
            c.execute('DELETE FROM creator_hub_metrics WHERE creator_id=?',(r['creator_id'],))
            for m in r['records']:
                c.execute('INSERT INTO creator_hub_metrics (creator_id,provider,platform,video_id,url,title,published_at,views,observed_at,adapter,availability,handle) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',(r['creator_id'],m['provider'],m['platform'],m['platform_video_id'],m['url'],m['description'] or '',m['posted_at'],m['views'],m['source_observed_at'] or m['observed_at'],m['source'],m['availability'],m['handle']))
                total+=1
            c.execute('UPDATE creator_hub_sources SET refreshed_at=?,coverage_json=? WHERE creator_id=?',(r['refreshed_at'],json.dumps(r['coverage']),r['creator_id']))
            c.execute('UPDATE creators SET sync_pending=1 WHERE discord_user_id=?',(r['creator_id'],))
    return {'creators':len(results),'observations':total}

def ingest_payouts(result):
    with db(BOT,False) as c:
        for owner in result['owners']:
            if not c.execute('SELECT 1 FROM creator_hub_sources WHERE creator_id=?',(owner,)).fetchone():continue
            c.execute('DELETE FROM creator_hub_payout_records WHERE creator_id=?',(owner,))
            c.execute('DELETE FROM creator_imported_deals WHERE creator_id=?',(owner,))
            c.execute('DELETE FROM creator_shared_deal_history WHERE creator_id=?',(owner,))
            for version in result.get('history',[]):
                if version['creator_id']==owner:c.execute('INSERT INTO creator_shared_deal_history VALUES (?,?,?)',(owner,version['id'],json.dumps(version)))
            for deal in result.get('deals',[]):
                if deal['creator_id']==owner:c.execute('INSERT INTO creator_imported_deals VALUES (?,?,?)',(owner,deal['id'],json.dumps(deal)))
            for r in result['records']:
                if r['creator_id']!=owner:continue
                c.execute('INSERT INTO creator_hub_payout_records VALUES (?,?,?,?,?,?,?)',(owner,r['id'],r['amount_cents'],r['currency'],r['status'],r['payout_date'],r['updated_at']))
            c.execute('INSERT INTO creator_hub_payout_sync VALUES (?,?) ON CONFLICT(creator_id) DO UPDATE SET checked_at=excluded.checked_at',(owner,int(time.time()*1000)))
            c.execute('UPDATE creators SET sync_pending=1 WHERE discord_user_id=?',(owner,))
    return {'recorded_transfers':len(result['records'])}

def child(user,mode,data=None):
    return json.loads(subprocess.check_output(['/usr/sbin/runuser','-u',user,'--','/usr/bin/python3',SCRIPT,mode],input=json.dumps(data).encode(),timeout=45))

if __name__=='__main__':
    mode=sys.argv[1]
    if mode=='export':out=export()
    elif mode=='project':out=project(json.load(sys.stdin))
    elif mode=='ingest':out=ingest(json.load(sys.stdin))
    elif mode=='ingest-payouts':out=ingest_payouts(json.load(sys.stdin))
    elif mode=='run':
        configs=child('gotall-discord','export')
        out=child('gotall-discord','ingest',child('creator-tracker-writer','project',configs))
        try:
            payouts=json.loads(subprocess.check_output(['/usr/sbin/runuser','-u','ark296','--','/usr/bin/python3','/usr/local/lib/gotall-discord-onboarding-test/hub-payout-export.py'],input=json.dumps(configs).encode(),timeout=35))
            out.update(child('gotall-discord','ingest-payouts',payouts))
        except (subprocess.SubprocessError,ValueError):
            out['payment_sync']='unavailable; last successful records retained'

    else:raise ValueError('Unknown mode')
    print(json.dumps(out))
