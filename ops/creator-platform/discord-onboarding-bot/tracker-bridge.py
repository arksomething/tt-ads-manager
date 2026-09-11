"""Bridge approved Discord campaign accounts to the existing owned tracker.
Each database is accessed as its existing service user; no provider keys needed.
"""
import datetime, hashlib, json, re, sqlite3, subprocess, sys, time
from urllib.parse import urlparse
BOT='/var/lib/gotall-discord-onboarding-test/onboarding.sqlite3'
TRACKER='/var/lib/creator-tracker/state/gotall-viral.db'
SCRIPT='/usr/local/lib/gotall-discord-onboarding-test/tracker-bridge.py'
STAGES=('hub_ready','trial','active','at_risk')

def connect(path):
    db=sqlite3.connect(path,timeout=30);db.row_factory=sqlite3.Row
    db.execute('PRAGMA foreign_keys=ON');return db

def account(url):
    u=urlparse(url);platform={'www.tiktok.com':'tiktok','tiktok.com':'tiktok','www.instagram.com':'instagram','instagram.com':'instagram'}.get(u.hostname)
    handle=u.path.strip('/').lstrip('@')
    if u.scheme!='https' or not platform or not re.fullmatch(r'[A-Za-z0-9_.]+',handle):raise ValueError('Invalid approved account URL')
    return platform,handle.lower()

def classify(row,now):
    if not row:return None
    if not row['attempted_at']<=row['completed_at']<=now or now-row['completed_at']>48*3600000:return None
    if row['status'] in ('complete','capped','profile_only'):return 'healthy'
    if (row['source'],row['error_code']) in [('tiktok_ytdlp','YTDLP_PRIVATE_PROFILE'),('scrapecreators_instagram','INSTAGRAM_PRIVATE_PROFILE')]:return 'private'
    # Generic 404/auth/extractor errors are NOT proof of a broken account.
    if row['source']=='tiktok_ytdlp' and row['error_code']=='YTDLP_NOT_FOUND' and 'status_deleted' in (row['message'] or '').lower():return 'unavailable'
    return None

def export():
    with connect(BOT) as db:
        return [dict(c) for c in db.execute("SELECT discord_user_id,name,campaign_accounts,first_video_approved_at,channel_id,status_message_id FROM creators WHERE first_video_approved_at IS NOT NULL AND stage IN ('hub_ready','trial','active','at_risk')")]

def track(creators):
    results=[];now=int(time.time()*1000)
    with connect(TRACKER) as db:
        for c in creators:
            for url in (c['campaign_accounts'] or '').splitlines():
                platform,handle=account(url)
                row=db.execute('SELECT * FROM creators WHERE platform=? AND handle=?',(platform,handle)).fetchone()
                if not row:
                    cur=db.execute('INSERT INTO creators (handle,platform,display_name,active,source_kind,provider_requested_tracking_limit) VALUES (?,?,?,1,?,150)',(handle,platform,c['name'],'manual'))
                    aid=cur.lastrowid
                    db.execute('INSERT INTO creator_handle_history (creator_id,platform,handle,first_seen_at,last_seen_at,first_seen_source,last_seen_source) VALUES (?,?,?,?,?,?,?)',(aid,platform,handle,now,now,'discord_first_video_approval','discord_first_video_approval'))
                    db.execute('INSERT INTO creator_tracking_state (creator_id,next_discovery_at) VALUES (?,?)',(aid,now))
                    row=db.execute('SELECT * FROM creators WHERE id=?',(aid,)).fetchone()
                # Never overwrite existing identity, limits, lifecycle or payout settings.
                d=db.execute('SELECT * FROM account_discovery_results WHERE creator_id=? ORDER BY completed_at DESC,id DESC LIMIT 1',(row['id'],)).fetchone()
                history=db.execute('SELECT first_seen_at FROM creator_handle_history WHERE creator_id=? AND platform=? AND handle=?',(row['id'],platform,handle)).fetchone()
                approved=int(datetime.datetime.fromisoformat(c['first_video_approved_at'].replace('Z','+00:00')).timestamp()*1000)
                valid=d and d['attempted_at']>=max(approved,history['first_seen_at'] if history else 0)
                results.append({**c,'platform':platform,'handle':handle,'account_id':row['id'],'active':bool(row['active']),'state':classify(d,now) if valid else None,'evidence':d['id'] if d else None})
    return results

def ingest(results):
    now=datetime.datetime.now(datetime.timezone.utc).isoformat()
    with connect(BOT) as db:
        db.execute('CREATE TABLE IF NOT EXISTS tracker_account_links (creator_id TEXT,platform TEXT,handle TEXT,tracker_id INTEGER,issue TEXT,PRIMARY KEY(creator_id,platform))')
        for r in results:
            c=db.execute('SELECT * FROM creators WHERE discord_user_id=?',(r['discord_user_id'],)).fetchone()
            if not c or c['stage'] not in STAGES or not c['first_video_approved_at']:continue
            if (r['platform'],r['handle']) not in [account(u) for u in c['campaign_accounts'].splitlines()]:continue
            prior=db.execute('SELECT * FROM tracker_account_links WHERE creator_id=? AND platform=?',(c['discord_user_id'],r['platform'])).fetchone()
            old=prior['issue'] if prior and prior['handle']==r['handle'] else None
            issue=r['state'] if r['state'] in ('private','unavailable') else None if r['state']=='healthy' else old
            if r['state'] and issue!=old:
                label=('TikTok' if r['platform']=='tiktok' else 'Instagram')+' · @'+r['handle']
                if issue=='private':body=f'Your {label} account is private, so we can’t track its posts. Please switch it to public. If you changed accounts, ask your manager to update the saved handle. We’ll recheck automatically.'
                elif issue=='unavailable':body=f'The platform reports your {label} account as unavailable. Please check the account and restore access if possible, or tell your manager if your handle changed. We’ll recheck automatically.'
                else:body=f'Your {label} account is accessible again. Tracking can continue — thanks!'
                payload={'content':'<@'+c['discord_user_id']+'>','allowed_mentions':{'parse':[],'users':[c['discord_user_id']]},'embeds':[{'title':'⚠️ Please check your creator account' if issue else '✅ Account tracking restored','description':body+f"\n\n[Open your creator directory](https://discord.com/channels/1245112089647775877/{c['channel_id']}/{c['status_message_id']})",'footer':{'text':'GoTall creators'}}]}
                key=f"tracker-account:{c['discord_user_id']}:{r['platform']}:{r['handle']}:{r['evidence']}:{issue or 'healthy'}"
                db.execute('INSERT OR IGNORE INTO deliveries (id,channel_id,payload,created_at) VALUES (?,?,?,?)',(key,c['channel_id'],json.dumps(payload),now))
            db.execute('INSERT INTO tracker_account_links VALUES (?,?,?,?,?) ON CONFLICT(creator_id,platform) DO UPDATE SET handle=excluded.handle,tracker_id=excluded.tracker_id,issue=excluded.issue',(c['discord_user_id'],r['platform'],r['handle'],r['account_id'],issue))
    return {'accounts_linked':len(results),'inactive_existing_accounts':sum(not r['active'] for r in results)}

def child(user,mode,data=None):
    return json.loads(subprocess.check_output(['/usr/sbin/runuser','-u',user,'--','/usr/bin/python3',SCRIPT,mode],input=json.dumps(data).encode(),timeout=90))

if __name__=='__main__':
    mode=sys.argv[1]
    if mode=='export':result=export()
    elif mode=='track':result=track(json.load(sys.stdin))
    elif mode=='ingest':result=ingest(json.load(sys.stdin))
    elif mode=='run':result=child('gotall-discord','ingest',child('creator-tracker-writer','track',child('gotall-discord','export')))
    else:raise ValueError('Unknown mode')
    print(json.dumps(result))
