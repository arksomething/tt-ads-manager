#!/usr/bin/env python3
"""Resumable, read-only Viral.app archive. Only POSTs are documented CSV exports."""
import argparse, csv, datetime as dt, hashlib, io, json, math, os, re, sqlite3, time
from pathlib import Path
from urllib.parse import urlsplit
import requests

ROOT = Path('/home/ark296/archives/viral-app/2026-09-24')
REPO = Path('/home/ark296/projects/tt-ads-manager')
os.umask(0o077)

def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + '.tmp')
    temp.write_text(json.dumps(value, ensure_ascii=False, indent=2))
    temp.replace(path)

def entity_identity(row):
    if row.get('platform') and row.get('platformVideoId'):
        return row['platform']+':'+row['platformVideoId']
    return str(row.get('id') or json.dumps(row,sort_keys=True))

class Archive:
    def __init__(self):
        self.env = {}
        for f in ['.env', '.env.local']:
            for line in (REPO/'web'/f).read_text().splitlines():
                m = re.match(r'(?:export\s+)?([A-Z_]+)=(.*)', line.strip())
                if m: self.env[m[1]] = m[2].strip().strip('"').strip("'")
        self.base = self.env.get('VIRAL_APP_BASE_URL', self.env.get('DATA_PROVIDER_BASE_URL')).rstrip('/')
        assert self.base == 'https://viral.app/api/v1', 'Unexpected provider origin'
        self.session = requests.Session()
        self.session.headers.update({'x-api-key': self.env.get('VIRAL_APP_API_KEY', self.env.get('DATA_PROVIDER_API_KEY')), 'Accept':'application/json'})
        self.spec = json.loads((ROOT/'spec/openapi.json').read_text())
        self.last = 0
        self.db = sqlite3.connect(ROOT/'archive.sqlite3',timeout=60)
        self.db.executescript('''CREATE TABLE IF NOT EXISTS requests
          (key TEXT PRIMARY KEY, method TEXT, path TEXT, parameters TEXT, status INTEGER,
           captured_at TEXT, file TEXT, sha256 TEXT, bytes INTEGER, error TEXT);
          CREATE TABLE IF NOT EXISTS collections
          (name TEXT PRIMARY KEY, expected_rows INTEGER, exported_rows INTEGER, unique_rows INTEGER, file TEXT);
          CREATE TABLE IF NOT EXISTS downloads
          (name TEXT PRIMARY KEY, file TEXT, rows INTEGER, expected_rows INTEGER, bytes INTEGER, sha256 TEXT);
          CREATE TABLE IF NOT EXISTS entities
          (collection TEXT, identity TEXT, payload_json TEXT, PRIMARY KEY(collection,identity));''')

    def request(self, path, params=None, body=None, refresh=False):
        method = 'POST' if body is not None else 'GET'
        assert method == 'GET' or path.endswith('/export'), 'Archive cannot mutate workspace'
        assert not path.startswith('/live/'), 'No live lookups or extra-credit collection'
        params = params or {}
        key = hashlib.sha256(json.dumps([method,path,params,body],sort_keys=True).encode()).hexdigest()
        previous = self.db.execute('select status,file from requests where key=?',(key,)).fetchone()
        if previous and previous[0] == 200 and not refresh:
            return json.loads((ROOT/previous[1]).read_text())
        payload = None
        for attempt in range(7):
            cooldown=ROOT/'cooldown.json'
            if cooldown.exists():
                wait=json.loads(cooldown.read_text()).get('until',0)-time.time()
                if wait>0:
                    print('RATE LIMIT waiting',round(wait),'seconds; checkpoint preserved',flush=True)
                    time.sleep(wait+2)
            time.sleep(max(0, 1.1-(time.monotonic()-self.last)))
            self.last = time.monotonic()
            try:
                r = self.session.request(method,self.base+path,params=params,json=body,timeout=(15,180),allow_redirects=False)
            except requests.RequestException as e:
                if attempt < 6:
                    time.sleep(min(60,2**attempt));continue
                self.db.execute('insert or replace into requests values (?,?,?,?,?,?,?,?,?,?)',(key,method,path,json.dumps(params if body is None else body),0,dt.datetime.now(dt.timezone.utc).isoformat(),None,None,0,type(e).__name__))
                self.db.commit();print('FAILED network',path,flush=True);return None
            if r.status_code == 429 or r.status_code in (408,500,502,503,504):
                if attempt < 6:
                    delay=r.headers.get('Retry-After','')
                    wait=float(delay) if delay.isdigit() else max(5,2**attempt)
                    if r.status_code==429:
                        write_json(ROOT/'cooldown.json',{'until':time.time()+wait,'reason':'Provider Retry-After','path':path})
                        print('RATE LIMIT',path,'retry after',wait,flush=True)
                    else:time.sleep(wait)
                    continue
            break
        dest=Path('raw')/(key+'.json')
        (ROOT/dest).write_bytes(r.content)
        try: payload=r.json()
        except ValueError: payload=None
        error=None if r.status_code==200 else (payload.get('message') if isinstance(payload,dict) else 'non-JSON error')
        self.db.execute('insert or replace into requests values (?,?,?,?,?,?,?,?,?,?)',(key,method,path,json.dumps(params if body is None else body),r.status_code,dt.datetime.now(dt.timezone.utc).isoformat(),str(dest),hashlib.sha256(r.content).hexdigest(),len(r.content),error))
        self.db.commit()
        if r.status_code != 200:
            print('FAILED',r.status_code,path,error,flush=True)
            if r.status_code == 401: raise RuntimeError('Archive authentication failed; stopping')
            return None
        return payload

    def collection(self, path, name=None, params=None):
        name=name or path.strip('/').replace('/','_'); params=params or {}
        rows=[];page=1;expected=None
        while True:
            result=self.request(path,{**params,'page':page,'perPage':100})
            if result is None: break
            batch=result.get('data') if isinstance(result,dict) else result
            if not isinstance(batch,list):raise RuntimeError('Unexpected collection schema: '+path)
            rows.extend(batch)
            if expected is None:expected=result.get('totalRows',result.get('total')) if isinstance(result,dict) else len(result)
            count=result.get('pageCount',math.ceil(expected/100) if expected is not None else 1) if isinstance(result,dict) else 1
            if page >= count: break
            if not batch:raise RuntimeError('Empty page before advertised end: '+path)
            page+=1
        unique={entity_identity(r):r for r in rows}
        dest=Path('exports')/(name+'.json');write_json(ROOT/dest,rows)
        self.db.execute('insert or replace into collections values (?,?,?,?,?)',(name,expected,len(rows),len(unique),str(dest)))
        self.db.execute('delete from entities where collection=?',(name,))
        for k,r in unique.items():self.db.execute('insert or replace into entities values (?,?,?)',(name,k,json.dumps(r,ensure_ascii=False)))
        self.db.commit();print('COLLECTION',name,len(rows),'expected',expected,flush=True)
        return rows

    def export(self,path,body,name):
        dest=Path('exports')/(name+'.csv')
        prior=self.db.execute('select sha256 from downloads where name=?',(name,)).fetchone()
        if prior and (ROOT/dest).exists() and hashlib.sha256((ROOT/dest).read_bytes()).hexdigest()==prior[0]:return
        for attempt in range(2):
            result=self.request(path,body=body,refresh=True)
            if not result:return
            url=result['downloadUrl'];assert urlsplit(url).scheme=='https'
            # Never send API credentials to the object-storage download host.
            try:
                r=requests.get(url,timeout=(15,180));r.raise_for_status()
            except requests.RequestException:
                if not attempt:continue
                print('FAILED download',name,flush=True);return
            raw=r.content
            count=max(0,sum(1 for _ in csv.reader(io.StringIO(raw.decode('utf-8-sig'))))-1)
            if count!=result['rowCount']:raise RuntimeError(f'CSV row mismatch: {name} {count}/{result["rowCount"]}')
            (ROOT/dest).write_bytes(raw)
            self.db.execute('insert or replace into downloads values (?,?,?,?,?,?)',(name,str(dest),count,result['rowCount'],len(raw),hashlib.sha256(raw).hexdigest()))
            self.db.commit();print('EXPORT',name,count,'rows',len(raw),'bytes',flush=True);return

    def metrics(self,path,template):
        p=next(x for x in self.spec['paths'][template]['get']['parameters'] if x['name']=='metrics')
        values=p['schema']['items']['enum']
        # Live validation enforces six even though OpenAPI omits maxItems.
        merged={}
        for offset in range(0,len(values),6):
            result=self.request(path,{'aggregation':'day',**{f'metrics[{i}]':v for i,v in enumerate(values[offset:offset+6])}})
            if result is None:return None
            for row in result.get('dailyMetrics',[]):merged.setdefault(row['date'],{}).update(row)
        return {'aggregation':'day','dailyMetrics':[merged[d] for d in sorted(merged)]}

    def core(self):
        self.request('/organization/subscription')
        accounts=self.collection('/accounts/tracked',params={'viewMode':'all'})
        self.collection('/accounts',params={'viewMode':'all'})
        tracked=self.collection('/videos/tracked',params={'viewMode':'all'})
        videos=self.collection('/videos','videos_visible',{'viewMode':'all','visibility':'visible'})
        excluded=self.collection('/videos','videos_excluded',{'viewMode':'all','visibility':'excluded'})
        self.collection('/videos/excluded','excluded_settings')
        for path in ['/projects','/tags','/creators','/campaigns','/jobs','/applications','/apps']:
            self.collection(path)
        for path in ['/accounts/tracked/count','/creators/counts','/applications/counts','/payouts/counts','/tags/workflows','/tags/account-rules','/tags/creator-rules','/tracking/status']:
            self.request(path)
        for status in ['paid','due','upcoming','canceled']:
            rows=self.collection('/payouts/'+status)
            if status=='paid':
                for row in rows:
                    if row.get('id'):self.request('/payouts/'+row['id']+'/breakdown')
        for endpoint in ['creators','campaigns','jobs','applications']:
            p=ROOT/'exports'/(endpoint+'.json')
            for row in json.loads(p.read_text()):
                if row.get('id'):self.request('/'+endpoint+'/'+row['id'])
        for a in accounts:
            path='/accounts/'+a['platform']+'/'+a['platformAccountId']
            self.request(path);self.metrics(path+'/metrics','/accounts/{platform}/{platformAccountId}/metrics')
        for f in ['all','archived']:
            result=self.request('/chat/threads',{'scope':'org','filter':f})
            for row in (result or {}).get('threads',[]):
                if not row['chatId'].startswith('crchat_'):continue
                cursor=None;seen=set()
                while True:
                    params={'limit':100}
                    if cursor:params.update({f'cursor[{k}]':v for k,v in cursor.items()})
                    page=self.request('/chat/threads/'+row['chatId']+'/messages',params)
                    if not page:break
                    cursor=page.get('nextCursor')
                    if not cursor:break
                    token=json.dumps(cursor,sort_keys=True)
                    if token in seen:raise RuntimeError('Repeated chat cursor')
                    seen.add(token)
        self.export('/accounts/export',{'viewMode':'all'},'accounts_native')
        for visibility in ['visible','excluded']:
            self.export('/videos/export',{'viewMode':'all','visibility':visibility},'videos_'+visibility+'_native')
        allrows=videos+excluded
        dates=[str(r.get('publishedAt') or r.get('createdAt') or '')[:10] for r in allrows+accounts]
        dates=[d for d in dates if re.fullmatch(r'20\d\d-\d\d-\d\d',d)]
        start=min(dates) if dates else '2020-01-01'
        today=dt.datetime.now(dt.timezone.utc).date()
        start=dt.date.fromisoformat(start).replace(day=1)
        write_json(ROOT/'date-scope.json',{'start':str(start),'through':str(today),'basis':'Earliest retained video publication or tracked account creation, rounded down to month; no claim about records removed by provider.'})
        month=start
        while month<=today:
            nxt=(month.replace(day=28)+dt.timedelta(days=4)).replace(day=1)
            end=min(today,nxt-dt.timedelta(days=1))
            body={'dateRange':{'from':str(month),'to':str(end)},'viewMode':'all','publicationMode':'allEligible'}
            self.export('/analytics/video-daily-gains/export',body,'daily_gains_'+str(month)[:7])
            month=nxt
        projects=json.loads((ROOT/'exports/projects.json').read_text())
        for project in [None]+[p['id'] for p in projects]:
            params={'dateRange[from]':str(start),'dateRange[to]':str(today),'viewMode':'all','publicationMode':'allEligible'}
            if project:params['projects[0]']=project
            self.request('/analytics/kpis',params)
            enum=next(p for p in self.spec['paths']['/analytics/metrics']['get']['parameters'] if p['name']=='metrics')['schema']['items']['enum']
            for offset in range(0,len(enum),6):
                self.request('/analytics/metrics',{**params,'aggregation':'day',**{f'metrics[{i}]':v for i,v in enumerate(enum[offset:offset+6])}})
        print('CORE COMPLETE',flush=True)

    def bulk(self):
        """Preserve irreplaceable historical rows before optional detail calls."""
        self.export('/accounts/export',{'viewMode':'all'},'accounts_native')
        for visibility in ['visible','excluded']:
            self.export('/videos/export',{'viewMode':'all','visibility':visibility},'videos_'+visibility+'_native')
        rows=json.loads((ROOT/'exports/videos_visible.json').read_text())+json.loads((ROOT/'exports/videos_excluded.json').read_text())
        dates=[r['publishedAt'][:10] for r in rows if r.get('publishedAt')]
        dates.extend(r['createdAt'][:10] for r in json.loads((ROOT/'exports/accounts_tracked.json').read_text()) if r.get('createdAt'))
        today=dt.datetime.now(dt.timezone.utc).date();month=dt.date.fromisoformat(min(dates)).replace(day=1)
        write_json(ROOT/'date-scope.json',{'start':str(month),'through':str(today),'basis':'Earliest retained video publication or account tracking creation, rounded down to month.'})
        while month<=today:
            nxt=(month.replace(day=28)+dt.timedelta(days=4)).replace(day=1);end=min(today,nxt-dt.timedelta(days=1))
            self.export('/analytics/video-daily-gains/export',{'dateRange':{'from':str(month),'to':str(end)},'viewMode':'all','publicationMode':'allEligible'},'daily_gains_'+str(month)[:7])
            month=nxt
        print('BULK HISTORY COMPLETE',flush=True)

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('phase',choices=['core','bulk']);args=p.parse_args()
    getattr(Archive(),args.phase)()
