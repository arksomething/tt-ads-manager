"""Public video observations and aggregate business indicators, never payout records."""
import asyncio
from datetime import date, datetime, timezone, timedelta
import json
import re
import uuid
from urllib.parse import urlparse
import services
from audit_conversion_data import query as superwall_query


def video_id(url):
    parsed=urlparse(url)
    if parsed.scheme!='https' or parsed.hostname not in {'www.tiktok.com','tiktok.com'} or parsed.params or parsed.username or parsed.password:
        raise ValueError('Use a full public TikTok video link, not a shortened redirect.')
    match=re.fullmatch(r'/@[^/]+/video/(\d+)/?',parsed.path)
    if not match:raise ValueError('Use the full video link containing its numeric video ID.')
    return match[1]


async def video_metrics(url, source='viral', day='', after_id=0, end_day=''):
    vid=video_id(url)
    days=[]
    if day:
        start=date.fromisoformat(day);end=date.fromisoformat(end_day or day)
        if not 0<=(end-start).days<31:raise ValueError('Request 1-31 days per window; use consecutive windows for longer history.')
        days=[(start+timedelta(days=i)).isoformat() for i in range((end-start).days+1)]
    elif end_day:raise ValueError('Provide day as the start of the window.')
    if source=='viral':
        response=await services.query('viral','/videos/tiktok/'+vid)
        if not response.get('verified'):return response
        data=response.get('result')
        if not isinstance(data,dict):raise ValueError('Provider video response is incomplete')
        fields=('platformVideoId','caption','publishedAt','loadAt','viewCount','organicViewCount','paidViewCount','likeCount','commentCount','shareCount')
        result={'source':'viral.app','preferred':True,'video':{k:data.get(k) for k in fields},'note':'Public content metrics, not proof of purchases or conversion lift.'}
        if days:
            if not data.get('orgAccountId'):return {**result,'daily_status':'No account mapping; daily gain unavailable.'}
            observations=[]
            for selected_day in days:
                daily=await services.query('viral','/analytics/top-videos',{'platforms':'tiktok','viewMode':'internal','publicationMode':'allEligible','onlyPublished':'false','dateRange[from]':selected_day,'dateRange[to]':selected_day,'accounts':data['orgAccountId'],'metric':'viewCountInPeriod','limit':100},preserve_structure=True)
                if not daily.get('verified') or daily.get('truncated'):
                    observations.append({'date':selected_day,'matched':False,'viewCountInPeriod':None,'note':'Provider read failed or was truncated; unknown, not zero.'})
                    continue
                payload=daily.get('result',{})
                rows=payload if isinstance(payload,list) else payload.get('data',[]) if isinstance(payload,dict) else []
                if isinstance(rows,dict):rows=rows.get('videos',rows.get('data',[]))
                hits=[r for r in rows if isinstance(r,dict) and str(r.get('platformVideoId'))==vid] if isinstance(rows,list) else []
                observations.append({'date':selected_day,'matched':bool(hits),'viewCountInPeriod':hits[0].get('viewCountInPeriod') if hits else None,'note':'Provider top-100 query; a missing video is unknown, not zero.'})
            result['daily']=observations if end_day else observations[0]
        return result
    if source!='beta_tracker':raise ValueError('Choose viral or beta_tracker')
    cursor=int(after_id)
    if cursor<0:raise ValueError('Invalid cursor')
    code="""import sqlite3,sys,json
d=sqlite3.connect('file:/var/lib/creator-tracker/state/gotall-viral.db?mode=ro',uri=True)
d.row_factory=sqlite3.Row
rows=d.execute('SELECT o.id,o.observed_at,o.source_observed_at,o.source,o.confidence,o.is_complete,o.views,o.availability FROM video_metric_observations o JOIN videos v ON v.id=o.video_id WHERE v.platform_video_id=? AND v.platform=? AND o.id>? ORDER BY o.id LIMIT 501',(sys.argv[1],'tiktok',int(sys.argv[2]))).fetchall()
print(json.dumps({'source':'beta_tracker','beta':True,'observations':[dict(r) for r in rows[:500]],'next_after_id':rows[499]['id'] if len(rows)>500 else None,'note':'Raw observations, not daily deltas. Preserve sources, incomplete samples and time gaps.'}))
"""
    proc=await asyncio.create_subprocess_exec('systemd-run','--user','--wait','--pipe','--quiet','--collect','--unit=gotall-video-read-'+uuid.uuid4().hex,'--property=RuntimeMaxSec=20',
        'sudo','-n','/usr/bin/python3','-c',code,vid,str(cursor),stdout=asyncio.subprocess.PIPE,stderr=asyncio.subprocess.DEVNULL)
    try:output,_=await asyncio.wait_for(proc.communicate(),timeout=25)
    except (asyncio.TimeoutError,asyncio.CancelledError):
        proc.kill();await proc.wait();raise
    if proc.returncode:raise ValueError('Beta tracker read unavailable; do not infer missing views are zero')
    return json.loads(output)


def indexed_rows(rows):
    result=[]
    averages={key:sum(float(r[key]) for r in rows)/len(rows) if rows else 0 for key in ('purchases','trials')}
    for row in rows:
        result.append({'date':row['date'],**{key+'_index':round(100*float(row[key])/averages[key],1) if averages[key]>0 else None for key in averages}})
    return {'source':'Superwall production','daily':result,'baseline':'Selected-period daily mean = 100. Purchases and trials are separate indices.',
            'note':'Company-wide relative activity, not video-attributed lift. Renewals excluded. Missing dates remain missing, not zero; partial days and reporting delays affect results. No exact company financial totals are returned.'}


async def business_activity(start_date,end_date):
    start=date.fromisoformat(start_date);end=date.fromisoformat(end_date)
    today=datetime.now(timezone.utc).date()
    if not 0<=(end-start).days<90 or end>today:raise ValueError('Choose 1-90 UTC days, not future dates.')
    sql="""SELECT toString(toDate(purchasedAt,'UTC')) date,
        uniqExactIf(tuple(applicationId,coalesce(nullIf(transactionId,''),id)), periodType='NORMAL') purchases,
        uniqExactIf(tuple(applicationId,coalesce(nullIf(transactionId,''),id)), periodType='TRIAL') trials
        FROM open_revenue.attributed_events_by_ts_rep WHERE {scope}
        AND name='initial_purchase' AND purchasedAt>=toDateTime('START','UTC')
        AND purchasedAt<toDateTime('END','UTC')+INTERVAL 1 DAY
        GROUP BY date ORDER BY date FORMAT JSONEachRow""".replace('START',start.isoformat()).replace('END',end.isoformat())
    rows=await asyncio.to_thread(superwall_query,sql)
    return {**indexed_rows(rows),'current_day_incomplete':end==today}
