"""Operator-only provider reads and existing-engine report generation."""
import asyncio
import json
import re
import time
import uuid
from pathlib import Path
from urllib.parse import urlsplit

import httpx
from dotenv import dotenv_values
import operations
from provider_budget import ProviderBudget


def credentials():
    values={}
    for name in ['.env','.env.local']:
        values.update({k:v for k,v in dotenv_values(operations.REPO/'web'/name).items() if v})
    return values


def providers():
    e=credentials()
    return {
        'viral':(e.get('VIRAL_APP_BASE_URL',''),{'x-api-key':e.get('VIRAL_APP_API_KEY','')},'GET'),
        'viewsbase':(e.get('VIEWSBASE_BASE_URL',''),{'Cookie':f"{e.get('VIEWSBASE_SESSION_COOKIE_NAME','')}={e.get('VIEWSBASE_SESSION_COOKIE_VALUE','')}"},'GET'),
        'adapty':(e.get('ADAPTY_DASHBOARD_BASE_URL',''),{'Authorization':'Bearer '+e.get('ADAPTY_DASHBOARD_TOKEN',''),
            'ADAPTY_DASHBOARD_APP_ID':e.get('ADAPTY_DASHBOARD_APP_ID',''),
            'ADAPTY_DASHBOARD_COMPANY_ID':e.get('ADAPTY_DASHBOARD_COMPANY_ID','')},'POST'),
        'singular':('https://api.singular.net',{'Authorization':e.get('SINGULAR_API_KEY','')},'GET'),
        'tiktok':('https://business-api.tiktok.com',{'Access-Token':e.get('TIKTOK_ACCESS_TOKEN','')},'GET'),
    }


def configured(base,headers):
    return bool(base and all(v and v not in {'=','Bearer '} for v in headers.values()))


def catalog():
    return {'providers':[{'name':name,'configured':None if name=='tiktok' and not configured(base,headers) else configured(base,headers),'method':method,
                         'credential_note':'Saved active GoTall advertiser connection is checked on request; provide advertiser_id.' if name=='tiktok' else 'Server-held credentials.'}
                         for name,(base,headers,method) in providers().items()],
            'reports':'Existing UGC calculator; campaign_creator_id and YYYY-MM. Preview only; no delivery or payment.',
            'limits':'Configured does not mean authenticated. Read-only provider requests; no arbitrary origins, personal messages, payments or secret output.'}


def clean(value):
    if isinstance(value,dict):
        return {k:('[REDACTED_SECRET]' if re.search(r'token|secret|password|api.?key|credential|connection.?string',k,re.I) else clean(v)) for k,v in value.items()}
    if isinstance(value,list):return [clean(v) for v in value]
    if isinstance(value,str):return operations.redact(value)
    return value


async def query(service,path,parameters=None,*,preserve_structure=False):
    if service=='supabase':
        raise ValueError('Legacy database browsing is retired. Use Viral.app for video performance or the beta tracker with explicit labeling. Use dedicated deal and payout tools for financial records.')
    if service in {'singular','tiktok'}:
        return await paid_query(service,path,parameters or {})
    entries=providers()
    if service not in entries:raise ValueError('Use service_catalog to choose a configured provider.')
    base,headers,method=entries[service]
    if not configured(base,headers):raise ValueError('Provider credentials are not configured.')
    if not re.fullmatch(r'/[A-Za-z0-9_./-]*',path) or '..' in path or path.startswith('//'):raise ValueError('Use a relative API path; supply query values separately.')
    if urlsplit(base).scheme!='https' or urlsplit(base).username:raise ValueError('Provider origin is not a trusted HTTPS configuration.')
    if service=='adapty' and path not in {'/asa-metadata/campaigns/','/asa-metadata/v3/campaign/metrics/total/'}:raise ValueError('Only existing read-only Adapty analytics routes are enabled.')
    if service=='viewsbase' and path not in {'/api/dashboard/videos','/api/payment-summary/daily-spend','/api/stats','/api/analytics/campaign','/api/payment-summary'}:raise ValueError('Use existing Viewsbase analytics routes from the repo client.')
    if re.search(r'logout|delete|remove|refresh|trigger|sync|revoke|transfer|send',path,re.I):raise ValueError('This tool is for provider reads, not action endpoints.')
    values=parameters or {}
    if len(json.dumps(values))>12000:raise ValueError('Bounded request required.')
    async with httpx.AsyncClient(timeout=30,follow_redirects=False) as client:
        async with client.stream(method,base.rstrip('/')+path,headers=headers,
                                 **({'json':values} if method=='POST' else {'params':values})) as response:
            if response.status_code>=300:return {'service':service,'status':response.status_code,'verified':False,'note':'Provider rejected the read; no result inferred.'}
            data=bytearray()
            async for chunk in response.aiter_bytes():
                data.extend(chunk)
                if len(data)>1_000_000:raise ValueError('Provider response too large; narrow or paginate the request.')
    try:result=clean(json.loads(data))
    except (ValueError,UnicodeError):return {'service':service,'verified':False,'note':'Expected JSON but received another format; session may have expired.'}
    encoded=json.dumps(result,ensure_ascii=False)
    truncated=len(encoded)>18000 and not preserve_structure
    return {'service':service,'verified':True,'truncated':truncated,'result':encoded[:18000] if truncated else result}


async def paid_query(service,path,parameters):
    routes={
        'singular':{'/api/v2.0/create_async_report','/api/v2.0/get_report_status','/api/v2.0/data_availability_status','/api/v2.0/reporting/filters'},
        'tiktok':{'/open_api/v1.3/report/integrated/get/','/open_api/v1.3/ad/get/','/open_api/v1.3/campaign/get/'},
    }
    if path not in routes[service]:raise ValueError('Choose a supported reporting route; writes and arbitrary URLs are not supported.')
    if len(json.dumps(parameters))>12000:raise ValueError('Bounded request required')
    if any(re.search(r'token|api.?key|authorization|secret',k,re.I) for k in parameters):raise ValueError('Credentials are server-held')
    base,headers,_=providers()[service]
    if service=='tiktok' and not configured(base,headers):
        node=Path.home()/'.nvm/versions/node/v24.12.0/bin/node'
        proc=await asyncio.create_subprocess_exec(str(node),str(Path(__file__).with_name('tiktok-report-credential.mjs')),
            stdin=asyncio.subprocess.PIPE,stdout=asyncio.subprocess.PIPE,stderr=asyncio.subprocess.DEVNULL)
        try:output,_=await asyncio.wait_for(proc.communicate(json.dumps({'advertiser_id':parameters.get('advertiser_id')}).encode()),timeout=20)
        except (asyncio.TimeoutError,asyncio.CancelledError):
            proc.kill();await proc.wait();raise
        if proc.returncode:raise ValueError('No verified GoTall TikTok reporting connection for this advertiser')
        headers={'Access-Token':json.loads(output)['accessToken']}
    if not configured(base,headers):raise ValueError('Reporting credential is not configured for this tool')
    values=dict(parameters)
    create=path.endswith('/create_async_report')
    if create:
        from datetime import date
        start=date.fromisoformat(values['start_date']);end=date.fromisoformat(values['end_date'])
        if not 0<=(end-start).days<30:raise ValueError('Report windows must be 1-30 days')
        values['format']='json'
    if service=='tiktok':
        values['page_size']=min(100,max(1,int(values.get('page_size',100))))
        values={k:json.dumps(v) if isinstance(v,(list,dict)) else v for k,v in values.items()}
    budget=ProviderBudget()
    try:
        key,cached,wait=budget.reserve(service,path,values)
        if cached is not None:return {**cached,'cached':True}
        if wait:return {'service':service,'verified':False,'status':'budget_wait','retry_after_seconds':wait,'note':'Shared API budget or provider cooldown. Do not bypass with a terminal request.'}
        async with httpx.AsyncClient(timeout=30,follow_redirects=False) as client:
            response=await client.request('POST' if create else 'GET',base+path,headers=headers,**({'data':values} if create else {'params':values}))
        if response.status_code==429:
            try:delay=float(response.headers.get('Retry-After','60'))
            except ValueError:
                from email.utils import parsedate_to_datetime
                try:delay=max(60,parsedate_to_datetime(response.headers['Retry-After']).timestamp()-time.time())
                except (ValueError,TypeError,KeyError):delay=60
            budget.backoff(service,delay)
            return {'service':service,'verified':False,'status':429,'retry_after_seconds':max(60,delay)}
        if response.status_code>=300:return {'service':service,'verified':False,'status':response.status_code}
        if len(response.content)>1_000_000:raise ValueError('Response too large; narrow the report')
        data=response.json()
        if service=='tiktok' and data.get('code',0)!=0:
            budget.backoff(service,60)
            return {'service':service,'verified':False,'code':data.get('code'),'note':'Provider rejected request; cooldown applied.'}
        if service=='singular' and data.get('status',0) not in (0,'0',None):
            budget.backoff(service,60)
            return {'service':service,'verified':False,'note':'Provider rejected report request; cooldown applied.'}
        result={'service':service,'verified':True,'result':clean(data),'cached':False}
        budget.cache(key,result,86400 if create else 15 if path.endswith('/get_report_status') else 900)
        return result
    finally:budget.close()


async def report(campaign_creator_id,month,identity):
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,100}',campaign_creator_id) or not re.fullmatch(r'\d{4}-(0[1-9]|1[0-2])',month):raise ValueError('Choose a campaign creator and YYYY-MM.')
    key=uuid.uuid5(uuid.NAMESPACE_URL,json.dumps([identity,campaign_creator_id,month],sort_keys=True)).hex
    directory=operations.STATE/'reports';directory.mkdir(exist_ok=True,mode=0o700)
    destination=directory/(key+'.json')
    if destination.exists():return {'report_id':key,**json.loads(destination.read_text())}
    node=Path.home()/'.nvm/versions/node/v24.12.0/bin/node'
    proc=await asyncio.create_subprocess_exec(str(node),str(Path(__file__).with_name('report-runner.mjs')),
         stdin=asyncio.subprocess.PIPE,stdout=asyncio.subprocess.PIPE,stderr=asyncio.subprocess.DEVNULL,cwd=operations.REPO)
    try:stdout,_=await asyncio.wait_for(proc.communicate(json.dumps({'campaign_creator_id':campaign_creator_id,'month':month}).encode()),timeout=180)
    except (asyncio.TimeoutError,asyncio.CancelledError):
        proc.kill();await proc.wait();raise
    if proc.returncode:raise ValueError('Calculator failed; no report or zero payout inferred.')
    result=clean(json.loads(stdout))
    operations.save(destination,result)
    return {'report_id':key,**result}


async def report_creators(query):
    if len(query)>100:raise ValueError('Use a short creator name or handle.')
    node=Path.home()/'.nvm/versions/node/v24.12.0/bin/node'
    proc=await asyncio.create_subprocess_exec(str(node),str(Path(__file__).with_name('report-runner.mjs')),
        stdin=asyncio.subprocess.PIPE,stdout=asyncio.subprocess.PIPE,stderr=asyncio.subprocess.DEVNULL,cwd=operations.REPO)
    try:out,_=await asyncio.wait_for(proc.communicate(json.dumps({'operation':'creators','query':query}).encode()),timeout=30)
    except (asyncio.TimeoutError,asyncio.CancelledError):
        proc.kill();await proc.wait();raise
    if proc.returncode:raise ValueError('Creator lookup failed; database access is unverified.')
    return clean(json.loads(out))
