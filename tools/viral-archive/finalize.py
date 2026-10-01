#!/usr/bin/env python3
"""Build portable offline access, coverage inventory, and verified archive ZIP."""
import csv,datetime as dt,hashlib,html,json,os,re,shutil,sqlite3,zipfile
from pathlib import Path
from urllib.parse import quote
os.umask(0o077)
ROOT=Path('/home/ark296/archives/viral-app/2026-09-24')

def direct_url(v):
    p=v.get('platform');native=str(v.get('platformVideoId',''));owner=str(v.get('accountUsername') or v.get('username') or '')
    if p=='tiktok':return 'https://www.tiktok.com/@'+quote(owner or 'unknown',safe='')+('/photo/' if v.get('contentType')=='slideshow' else '/video/')+quote(native,safe='')
    if p=='instagram':return 'https://www.instagram.com/reel/'+quote(native,safe='')+'/'
    if p=='youtube':return 'https://www.youtube.com/watch?v='+quote(native,safe='')
    if p=='facebook':return 'https://www.facebook.com/reel/'+quote(native,safe='')
    return ''

def safe_cell(v):
    if isinstance(v,(dict,list)):v=json.dumps(v,ensure_ascii=False)
    if isinstance(v,str) and v.startswith(('=','+','-','@')):return "'"+v
    return v

def main():
    db=sqlite3.connect(ROOT/'archive.sqlite3');db.row_factory=sqlite3.Row
    videos=[]
    for name in ['videos_visible','videos_excluded']:
        for v in json.loads((ROOT/'exports'/(name+'.json')).read_text()):videos.append({**v,'directVideoUrl':direct_url(v),'excluded':name=='videos_excluded'})
    fields=['platform','platformVideoId','accountUsername','directVideoUrl','publishedAt','caption','viewCount','organicViewCount','paidViewCount','likeCount','commentCount','shareCount','bookmarkCount','durationSeconds','loadAt','tracking_status','lastErrorCode','excluded','orgAccountId','platformAccountId','videoTags']
    with (ROOT/'exports/videos_with_links.csv').open('w',newline='') as f:
        w=csv.DictWriter(f,fieldnames=fields);w.writeheader()
        for v in videos:w.writerow({k:safe_cell(v.get(k)) for k in fields})
    db.executescript('CREATE TABLE IF NOT EXISTS video_links(platform TEXT,native_video_id TEXT,direct_url TEXT,PRIMARY KEY(platform,native_video_id)); CREATE TABLE IF NOT EXISTS history_imports(file TEXT PRIMARY KEY,rows INTEGER,sha256 TEXT);')
    db.executemany('insert or replace into video_links values (?,?,?)',[(v['platform'],v['platformVideoId'],v['directVideoUrl']) for v in videos]);db.commit()
    db.executescript('CREATE TABLE IF NOT EXISTS metric_series(scope_type TEXT,identity TEXT,bucket_start TEXT,bucket_end TEXT,values_json TEXT,PRIMARY KEY(scope_type,identity,bucket_start)); CREATE TABLE IF NOT EXISTS preserved_response_index(original_path TEXT,file TEXT,cache_key TEXT,fetched_at TEXT,sha256 TEXT,PRIMARY KEY(original_path));')
    series={}
    for row in db.execute("select path,file,parameters from requests where status=200 and path like '%/metrics'"):
        response=json.loads((ROOT/row['file']).read_text())
        pieces=row['path'].strip('/').split('/');kind=pieces[0];identity='/'.join(pieces[1:-1]) or 'all'
        if kind=='analytics':
            filters={k:v for k,v in json.loads(row['parameters']).items() if not k.startswith(('metrics[','dateRange[')) and k!='aggregation'}
            identity=json.dumps(filters,sort_keys=True)
        for bucket in response.get('dailyMetrics',[]):
            key=(kind,identity,bucket['date']);series.setdefault(key,{}).update(bucket)
    db.execute('delete from metric_series')
    db.executemany('insert into metric_series values (?,?,?,?,?)',[(k[0],k[1],k[2],v.get('endDate'),json.dumps(v,ensure_ascii=False)) for k,v in series.items()])
    preserved=json.loads((ROOT/'local-preserved/index.json').read_text())
    db.executemany('insert or replace into preserved_response_index values (?,?,?,?,?)',[(v['original_path'],v['file'],v.get('cache_key'),v.get('fetched_at'),v['sha256']) for v in preserved]);db.commit()
    history_counts={}
    for path in sorted((ROOT/'exports').glob('daily_gains_*.csv')):
        digest=hashlib.sha256(path.read_bytes()).hexdigest()
        prior=db.execute('select rows,sha256 from history_imports where file=?',(path.name,)).fetchone()
        if prior and prior['sha256']==digest:history_counts[path.name]=prior['rows'];continue
        with path.open(newline='',encoding='utf-8-sig') as f:
            reader=csv.DictReader(f);headers=reader.fieldnames
            if not headers:
                history_counts[path.name]=0
                db.execute('insert or replace into history_imports values (?,?,?)',(path.name,0,digest));db.commit()
                continue
            columns=[re.sub('[^a-z0-9]+','_',x.lower()).strip('_') or 'value' for x in headers]
            if len(set(columns))!=len(columns):raise ValueError('Ambiguous CSV headers')
            names=','.join('"'+x+'" TEXT' for x in columns)
            db.execute('CREATE TABLE IF NOT EXISTS video_daily_gains (archive_file TEXT,'+names+')')
            actual=[r[1] for r in db.execute('pragma table_info(video_daily_gains)')][1:]
            if actual!=columns:raise ValueError('Daily export columns changed')
            db.execute('delete from video_daily_gains where archive_file=?',(path.name,));batch=[];n=0
            for row in reader:
                batch.append([path.name]+[row[h] for h in headers]);n+=1
                if len(batch)==1000:
                    db.executemany('insert into video_daily_gains values ('+','.join('?' for _ in batch[0])+')',batch);batch=[]
            if batch:db.executemany('insert into video_daily_gains values ('+','.join('?' for _ in batch[0])+')',batch)
            db.execute('insert or replace into history_imports values (?,?,?)',(path.name,n,digest));db.commit();history_counts[path.name]=n
    if db.execute("select 1 from sqlite_master where type='table' and name='video_daily_gains'").fetchone():
        db.execute('create index if not exists daily_video_lookup on video_daily_gains(platform,platformvideoid,date)')
        db.execute('create index if not exists daily_creator_lookup on video_daily_gains(accountusername,date)');db.commit()
    collections=[dict(r) for r in db.execute('select * from collections')]
    errors=[dict(r) for r in db.execute('select method,path,parameters,status,error from requests where status<>200')]
    for e in errors:
        e['later_success_for_same_endpoint']=bool(db.execute('select 1 from requests where path=? and status=200 limit 1',(e['path'],)).fetchone())
    downloads=[dict(r) for r in db.execute('select * from downloads')]
    coverage={'created_at':dt.datetime.now(dt.timezone.utc).isoformat(),'collections':collections,'csv_exports':downloads,'daily_history_rows':sum(history_counts.values()),'metric_series_buckets':len(series),'videos_without_publication_or_counter':sum(v.get('publishedAt') is None or v.get('viewCount') is None for v in videos),'history_files':history_counts,'diagnostic_errors':errors,'integrity_check':db.execute('pragma integrity_check').fetchone()[0]}
    (ROOT/'coverage.json').write_text(json.dumps(coverage,indent=2));db.close()
    local=json.loads((ROOT/'local-preserved/index.json').read_text())
    historic=json.loads((ROOT/'exports/historical_video_index.json').read_text()) if (ROOT/'exports/historical_video_index.json').exists() else []
    current_ids={(v['platform'],v['platformVideoId']) for v in videos}
    old_only=[{**v,'viewCount':None,'historicalOnly':True} for v in historic if (v['platform'],v['platformVideoId']) not in current_ids]
    browse=videos+old_only
    scope=json.loads((ROOT/'date-scope.json').read_text()) if (ROOT/'date-scope.json').exists() else {}
    readme=f'''# Viral.app historical archive — September 24, 2026

Open `index.html` in a browser to search {len(browse):,} videos: {len(videos):,} from the current API inventory and {len(old_only):,} additional identities preserved only in older captures. Links open directly on the social platform without Viral.app. Public posts still depend on their original platform and creator; deleted/private posts are not preserved as playable media.

## Files
- `exports/videos_with_links.csv`: readable current inventory, captions, metrics and direct links. Formula-like text is prefixed for spreadsheet safety; raw JSON preserves original text.
- `exports/historical_video_index.csv`: older captured video identities, direct links and exact source JSON pointers. The SQLite `historical_video_evidence` table indexes each preserved record and keeps period-specific views separate from lifetime views.
- `exports/accounts_native.csv`, `videos_visible_native.csv`: provider-generated inventory CSVs.
- `exports/daily_gains_YYYY-MM.csv`: provider-generated daily video history. {sum(history_counts.values()):,} rows exported for {scope.get('start','unknown')} through {scope.get('through','unknown')}.
- `exports/supplemental_history_*.csv`: 95 provider history rows for the two zero-view videos absent from the bulk daily-gains export.
- `exports/*.json`: complete paginated resource collections, including tracked settings, tags, projects, apps and any accessible Creator Hub/payout records.
- `archive.sqlite3`: queryable request index, entities, video links, CSV history and export verification. SQLite opens independently of Viral.app.
- `metric_series` inside SQLite preserves exported account and workspace/project daily trends; `preserved_response_index` locates older captured responses.
- `raw/`: original API response bytes. The `requests` table maps files to endpoints, query parameters, capture times and SHA-256 checksums. Export-link responses contain short-lived URLs; their CSV contents are saved locally.
- `local-preserved/`: {len(local):,} older local Viral-derived source artifacts and tracker import snapshots, separately labeled with original provenance. They are historical captures, not fresh API observations.
- `spec/openapi.json`: provider API contract captured with this archive.
- `coverage.json`: expected versus exported row counts, CSV verification and diagnostic failures.
- `SHA256SUMS`: file integrity checks; run `sha256sum -c SHA256SUMS` from this folder.

## Evidence and limits
This preserves the records exposed to the configured Viral.app workspace key at capture time. It does not claim recovery of provider-deleted records or data Viral.app never collected. Daily metrics may be provider-computed, zero-filled or aggregated; they are not independently observed exact-time samples and must not silently replace contractual cutoff evidence. Current inventory, older local captures and daily gains are kept distinct. No subscription, tracking settings, payout instructions or payment state was changed. No `/live/` collection endpoints were used. Original video/audio/image files are not downloaded.

The bulk video-history export contains rows through September 23, 2026; the September 24 inventory is a separate current snapshot. See `history-reconciliation.json` and `videos-without-daily-history.json` for gaps. Three inventory records have provider `NOT_FOUND` with missing counters/publication time. Two zero-counter records have no bulk daily-gains rows, but their separate 47-row and 48-row provider history exports are saved. Those states are preserved, not replaced with invented history. Tracking-run logs are limited by the public API to the most recent 30 days and 100 runs. Official export reference: https://viral.app/docs/brands/analytics#export-data

## Query examples
```sql
SELECT name,expected_rows,exported_rows FROM collections;
SELECT direct_url FROM video_links WHERE native_video_id='VIDEO_ID';
SELECT json_extract(payload_json,'$.accountUsername') AS creator,
       json_extract(payload_json,'$.platformVideoId') AS video,
       json_extract(payload_json,'$.viewCount') AS latest_views
FROM entities WHERE collection='videos_visible';
PRAGMA table_info(video_daily_gains);
```

## Refresh
The included exporter resumes completed requests instead of overwriting old captures. To collect a later snapshot, use a new archive directory. Credentials are read from the existing private application environment and are not included. The full archive is private creator/business data; share it deliberately.
'''
    (ROOT/'README.md').write_text(readme)
    records=[{'p':v['platform'],'id':v['platformVideoId'],'u':v.get('accountUsername') or '', 'd':v.get('publishedAt') or '', 'c':v.get('caption') or '', 'views':v.get('viewCount'),'url':v['directVideoUrl'],'h':bool(v.get('historicalOnly'))} for v in browse]
    data=json.dumps(records,ensure_ascii=False).replace('<','\\u003c')
    page='''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Viral.app archive</title><style>body{font:16px system-ui;margin:3rem auto;padding:0 1.5rem;max-width:1150px;color:#17222e;background:#f7f9fb}h1{font-size:2rem}input{font:inherit;padding:.8rem;width:min(90%,650px);border:1px solid #aaa;border-radius:6px}table{border-collapse:collapse;width:100%;background:white}td,th{padding:.8rem;text-align:left;border-bottom:1px solid #dde3e8}td:nth-child(3){max-width:450px;word-break:break-word}a{color:#1559a2}button{padding:.6rem;margin:1rem .5rem 1rem 0}small{color:#56616e}</style><h1>Viral.app historical archive</h1><p>Saved September 24, 2026. Search the inventory and open posts directly on TikTok or Instagram.</p><p><a href="README.md">Archive guide</a> · <a href="exports/videos_with_links.csv">Video inventory CSV</a> · <a href="coverage.json">Coverage and verification</a> · <a href="archive.sqlite3">SQLite database</a></p><p><small>Links require the original post to remain public. Video files are not included. Historical daily data is in the exports folder.</small></p><input id="search" aria-label="Search videos" placeholder="Search creator, caption or video ID"><p id="count"></p><button id="prev">Previous</button><button id="next">Next</button><table><thead><tr><th>Creator</th><th>Published</th><th>Caption</th><th>Latest views</th><th>Video</th></tr></thead><tbody id="rows"></tbody></table><script>const records=DATA;let page=0;const q=document.querySelector('#search');function render(){let term=q.value.toLowerCase();let found=records.filter(v=>(v.u+' '+v.c+' '+v.id).toLowerCase().includes(term));page=Math.max(0,Math.min(page,Math.ceil(found.length/100)-1));document.querySelector('#count').textContent=found.length.toLocaleString()+' matching videos — page '+(page+1);let body=document.querySelector('#rows');body.replaceChildren();for(let v of found.slice(page*100,page*100+100)){let tr=document.createElement('tr');for(let text of [v.u+' ('+v.p+')',v.d.slice(0,10),v.c.slice(0,240),v.views==null?'Unavailable':v.views.toLocaleString()]){let td=document.createElement('td');td.textContent=text;tr.append(td)}let td=document.createElement('td'),a=document.createElement('a');a.href=v.url;a.textContent='Open post';a.target='_blank';a.rel='noopener noreferrer';td.append(a);tr.append(td);body.append(tr)}}q.oninput=()=>{page=0;render()};document.querySelector('#prev').onclick=()=>{page--;render()};document.querySelector('#next').onclick=()=>{page++;render()};render();</script></html>'''.replace('DATA',data)
    page=page.replace("v.views==null?'Unavailable':v.views.toLocaleString()", "v.h?'Historical capture':v.views==null?'Unavailable':v.views.toLocaleString()")
    page=page.replace('Historical daily data is in the exports folder.',f'Historical daily data is in the exports folder. Includes {len(old_only):,} older videos absent from the current API inventory; their old counts are not shown as current views.')
    (ROOT/'index.html').write_text(page)
    code=ROOT/'exporter';code.mkdir(exist_ok=True)
    for source in Path(__file__).parent.glob('*.py'):shutil.copyfile(source,code/source.name)
    excluded={'SHA256SUMS','progress.log','cooldown.json'}
    files=sorted(p for p in ROOT.rglob('*') if p.is_file() and p.name not in excluded and not p.name.endswith(('.tmp','-journal')) and '__pycache__' not in p.parts)
    checks=''.join(hashlib.sha256(p.read_bytes()).hexdigest()+'  '+str(p.relative_to(ROOT))+'\n' for p in files)
    (ROOT/'SHA256SUMS').write_text(checks);files.append(ROOT/'SHA256SUMS')
    dest=ROOT.parent/(ROOT.name+'-viral-app-archive.zip')
    with zipfile.ZipFile(dest,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=6) as z:
        for p in files:z.write(p,str(Path(ROOT.name)/p.relative_to(ROOT)))
    with zipfile.ZipFile(dest) as z:
        bad=z.testzip()
        if bad:raise RuntimeError('ZIP integrity failure: '+bad)
    result={'files':len(files),'uncompressed_bytes':sum(p.stat().st_size for p in files),'zip_bytes':dest.stat().st_size,'current_videos':len(videos),'searchable_videos':len(browse),'historical_only_videos':len(old_only),'daily_history_rows':sum(history_counts.values()),'zip':str(dest)}
    (ROOT.parent/(ROOT.name+'-archive-summary.json')).write_text(json.dumps(result,indent=2));print(json.dumps(result))

if __name__=='__main__':main()
