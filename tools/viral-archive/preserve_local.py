#!/usr/bin/env python3
"""Preserve already captured Viral responses before temporary caches disappear."""
import hashlib,json,os,shutil
from pathlib import Path
os.umask(0o077)
ROOT=Path('/home/ark296/archives/viral-app/2026-09-24')
REPO=Path('/home/ark296/projects/tt-ads-manager')
sources=[]
for name in ['audit-viral-cache-bench','ttads-aug26-viral.krdvzx','audit-viral-cache-paged','august-viral-cache.FbXwEY']:
    sources.extend((Path('/tmp')/name).glob('*.json'))
for pattern in ['**/*viral*.json','**/provider-windows*.json']:
    sources.extend((REPO/'payouts').glob(pattern))
records=[]
for source in sorted(set(sources)):
    raw=source.read_bytes();obj=json.loads(raw)
    if source.parent.parent==Path('/tmp'):
        key=obj.get('cacheKey','')
        if 'viral.app/' not in key:continue
    digest=hashlib.sha256(raw).hexdigest();dest=ROOT/'local-preserved/objects'/(digest+'.json')
    dest.parent.mkdir(parents=True,exist_ok=True)
    if not dest.exists():dest.write_bytes(raw)
    records.append({'original_path':str(source),'file':str(dest.relative_to(ROOT)),'sha256':digest,'bytes':len(raw),
        'cache_key':obj.get('cacheKey') if isinstance(obj,dict) else None,
        'fetched_at':obj.get('fetchedAt') if isinstance(obj,dict) else None})
(ROOT/'local-preserved/index.json').write_text(json.dumps(records,indent=2))
print(json.dumps({'source_files':len(records),'unique_objects':len({r['sha256'] for r in records}),
    'unique_bytes':sum(p.stat().st_size for p in (ROOT/'local-preserved/objects').glob('*.json'))}))
