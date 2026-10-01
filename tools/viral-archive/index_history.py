#!/usr/bin/env python3
"""Index older provider captures without relabeling them as current evidence."""
import csv,json,os,sqlite3
from pathlib import Path
from finalize import direct_url,safe_cell
os.umask(0o077)
ROOT=Path('/home/ark296/archives/viral-app/2026-09-24')

def walk(value,pointer=''):
    if isinstance(value,dict):
        if value.get('platform') and (value.get('platformVideoId') or value.get('nativeVideoId')):
            yield value,pointer
        for k,v in value.items():yield from walk(v,pointer+'/'+str(k).replace('~','~0').replace('/','~1'))
    elif isinstance(value,list):
        for i,v in enumerate(value):yield from walk(v,pointer+'/'+str(i))

def main():
    db=sqlite3.connect(ROOT/'archive.sqlite3',timeout=60)
    db.executescript('''CREATE TABLE IF NOT EXISTS historical_video_evidence
    (platform TEXT,native_video_id TEXT,source_file TEXT,json_pointer TEXT,captured_at TEXT,
    request_key TEXT,latest_views REAL,period_views REAL,
    PRIMARY KEY(platform,native_video_id,source_file,json_pointer));''')
    sources=json.loads((ROOT/'local-preserved/index.json').read_text())
    for p in (ROOT/'local-preserved/tracker-imports').glob('viral-app-tracker-*.json'):
        sources.append({'file':str(p.relative_to(ROOT)),'fetched_at':None,'cache_key':None})
    videos={};count=0
    db.execute('delete from historical_video_evidence')
    for entry in sources:
        root=json.loads((ROOT/entry['file']).read_text())
        for record,pointer in walk(root):
            platform=record.get('platform');native=str(record.get('platformVideoId') or record.get('nativeVideoId'))
            if platform not in ('tiktok','instagram','facebook','youtube','snapchat'):continue
            stamp=entry.get('fetched_at') or record.get('providerLoadedAt') or ''
            key=(platform,native);prior=videos.get(key)
            candidate={'platform':platform,'platformVideoId':native,'accountUsername':record.get('accountUsername') or record.get('accountHandle') or record.get('username') or '',
                'publishedAt':record.get('publishedAt') or record.get('publishedDate'),'caption':record.get('caption') or record.get('description') or '',
                'contentType':record.get('contentType'),'capturedAt':stamp,'sourceFile':entry['file'],'jsonPointer':pointer}
            if prior is None or candidate['capturedAt']>prior['capturedAt']:videos[key]=candidate
            def number(v):return v if isinstance(v,(int,float)) else None
            db.execute('insert or replace into historical_video_evidence values (?,?,?,?,?,?,?,?)',(platform,native,entry['file'],pointer,stamp,entry.get('cache_key'),number(record.get('viewCount')),number(record.get('viewCountInPeriod'))));count+=1
    db.execute('create index if not exists historical_video_identity on historical_video_evidence(platform,native_video_id)');db.commit();db.close()
    rows=sorted(videos.values(),key=lambda v:(v['accountUsername'],str(v['publishedAt'])))
    for row in rows:row['directVideoUrl']=direct_url(row)
    (ROOT/'exports/historical_video_index.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2))
    with (ROOT/'exports/historical_video_index.csv').open('w',newline='') as f:
        w=csv.DictWriter(f,fieldnames=['platform','platformVideoId','accountUsername','publishedAt','directVideoUrl','capturedAt','sourceFile','jsonPointer']);w.writeheader()
        for row in rows:w.writerow({k:safe_cell(row.get(k)) for k in w.fieldnames})
    current={(r['platform'],r['platformVideoId']) for r in json.loads((ROOT/'exports/videos_visible.json').read_text())}
    summary={'historical_video_identities':len(rows),'evidence_records_indexed':count,'historical_only_video_identities':len(videos.keys()-current)}
    (ROOT/'historical-index-summary.json').write_text(json.dumps(summary,indent=2));print(json.dumps(summary))

if __name__=='__main__':main()
