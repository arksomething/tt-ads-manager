"""Read-only, source-timestamp comparison against the reconciled Viral inventory."""
import argparse
import collections
import datetime
import json
import sqlite3
import time

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--database', default='/var/lib/creator-tracker/state/gotall-viral.db')
parser.add_argument('--snapshot', default='/var/lib/creator-tracker/imports/viral-app-tracker-current.json')
args = parser.parse_args()
now = int(time.time() * 1000)
day = 86400000
db = sqlite3.connect(f'file:{args.database}?mode=ro', uri=True)
db.row_factory = sqlite3.Row
with open(args.snapshot) as stream:
    snapshot = json.load(stream)
local = {(r['platform'], r['platform_video_id']): dict(r) for r in db.execute('''
  SELECT v.id,v.platform,v.platform_video_id,v.posted_at,v.first_seen_at,
         c.handle,v.excluded,c.active,
         max(coalesce(o.source_observed_at,o.observed_at)) AS direct_at
  FROM videos v JOIN creators c ON c.id=v.creator_id
  LEFT JOIN video_metric_observations o ON o.video_id=v.id
    AND o.confidence='direct' AND o.is_complete=1 AND o.views IS NOT NULL
  GROUP BY v.id
''')}
rows = []
for video in snapshot['videos']:
    raw_time = video.get('providerLoadedAt')
    loaded = int(datetime.datetime.fromisoformat(raw_time.replace('Z', '+00:00')).timestamp()*1000) if raw_time else None
    match = local.get((video['platform'], video['nativeVideoId']))
    category = 'provider_stale_or_unavailable'
    if loaded is not None and now-day <= loaded <= now and video.get('lastErrorCode') is None and video.get('viewCount') is not None:
        if match is None:
            category = 'missing_local_video'
        elif not match['active'] or match['excluded']:
            category = 'local_scope_excluded'
        elif match['direct_at'] is not None and match['direct_at'] >= now-day:
            category = 'fresh_direct'
        else:
            age = now - (match['posted_at'] or match['first_seen_at'])
            interval = (7*day if age >= 30*day else 3*day) if video['platform']=='instagram' else day
            if age >= 90*day:
                category = 'age_cutoff_gap'
            elif match['direct_at'] is not None and now-match['direct_at'] < interval:
                category = 'slower_cadence_gap'
            else:
                category = 'collection_gap'
    rows.append(dict(platform=video['platform'], handle=video.get('accountHandle'),
        nativeVideoId=video['nativeVideoId'], localVideoId=match['id'] if match else None,
        providerLoadedAt=raw_time, providerError=video.get('lastErrorCode'),
        lastDirectAt=match['direct_at'] if match else None, category=category))
summary = {platform: dict(collections.Counter(r['category'] for r in rows if r['platform']==platform))
           for platform in ('tiktok','instagram')}
print(json.dumps(dict(generatedAt=datetime.datetime.now(datetime.timezone.utc).isoformat(),
    snapshot=snapshot['artifact'], freshnessHours=24, summary=summary, videos=rows), indent=2))
