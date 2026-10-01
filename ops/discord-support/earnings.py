"""Identity-bound calculator estimates. Caller never supplies a creator/database ID."""
import asyncio
from datetime import date, datetime, timezone
import json
from pathlib import Path
import uuid
import services
import account_lookup


def validate_dates(start_date,end_date):
    start=date.fromisoformat(start_date);end=date.fromisoformat(end_date)
    if not 0<=(end-start).days<90 or end>datetime.now(timezone.utc).date():
        raise ValueError('Choose 1-90 UTC calendar days ending no later than today.')
    return start.isoformat(),end.isoformat()


async def binding(guild,channel,user):
    verified={}
    for path in [Path('/etc/gotall-discord-creator-bindings.json'),services.operations.STATE/'verified-creator-bindings.json']:
        if path.exists():
            for g,users in json.loads(path.read_text()).items():
                for u,value in users.items():verified.setdefault(g,{}).setdefault(u,value)
    match=verified.get(str(guild),{}).get(str(user))
    if match and str(match.get('channel_id'))!=str(channel):return None
    current=await account_lookup.lookup(guild,channel,user,verified)
    if current:return current
    if match:return match
    # Existing owner-approved calculator bindings are test fixtures, not live identities.
    if str(guild)!='1245112089647775877':return None
    code="""import sqlite3,sys,json
d=sqlite3.connect('file:/var/lib/gotall-discord-onboarding-test/onboarding.sqlite3?mode=ro',uri=True)
r=d.execute('SELECT 1 FROM creators WHERE discord_user_id=? AND channel_id=?',(sys.argv[1],sys.argv[2])).fetchone()
b=json.load(open('/etc/gotall-discord-deal-bindings.json')).get(sys.argv[1]) if r else None
print(json.dumps(dict(b,test_fixture=True) if b else None))
"""
    proc=await asyncio.create_subprocess_exec('systemd-run','--user','--wait','--pipe','--quiet','--collect','--unit=gotall-earnings-binding-'+uuid.uuid4().hex,'--property=RuntimeMaxSec=15','sudo','-n','/usr/bin/python3','-c',code,str(user),str(channel),stdout=asyncio.subprocess.PIPE,stderr=asyncio.subprocess.DEVNULL)
    try:out,_=await asyncio.wait_for(proc.communicate(),20)
    except (asyncio.TimeoutError,asyncio.CancelledError):
        proc.kill();await proc.wait();raise
    if proc.returncode:raise ValueError('Creator mapping unavailable; do not guess the account.')
    return json.loads(out)


async def estimate(guild,channel,user,start_date,end_date):
    start_date,end_date=validate_dates(start_date,end_date)
    linked=await binding(guild,channel,user)
    if not linked:return {'status':'not_linked','note':'No verified calculator identity for this requester in this channel. Staff must link their account; do not guess from a handle or show another creator report.'}
    if linked.get('pending_accounts'):return {'status':'mapping_pending','note':'Some approved accounts are still awaiting tracked videos, payout records or ownership review. A complete earnings total is not yet available.'}
    accounts=linked.get('accounts') or ([linked] if linked.get('campaign_creator_id') else [])
    if not accounts:return {'status':'mapping_pending','note':'Tracking identity recorded; no verified payout account or terms are available yet.'}
    estimates=[]
    for account in accounts:
        result=await calculate(account,start_date,end_date)
        if result.get('status')!='estimate':return {'status':'unavailable','note':'At least one linked account could not be calculated. Do not present a partial amount as total earnings.'}
        estimates.append(result)
    if len(estimates)==1:return {**estimates[0],'test_fixture':bool(linked.get('test_fixture'))}
    return {'status':'estimate','accounts':estimates,'test_fixture':bool(linked.get('test_fixture')),'note':'All verified linked calculator accounts included. Keep currencies separate; never count overlapping account results twice.'}


async def calculate(linked,start_date,end_date):
    proc=await asyncio.create_subprocess_exec(str(Path.home()/'.nvm/versions/node/v24.12.0/bin/node'),str(Path(__file__).with_name('report-runner.mjs')),stdin=asyncio.subprocess.PIPE,stdout=asyncio.subprocess.PIPE,stderr=asyncio.subprocess.DEVNULL,cwd=services.operations.REPO)
    request={'operation':'own_range','campaign_creator_id':linked['campaign_creator_id'],'organization_id':linked['organization_id'],'start_date':start_date,'end_date':end_date}
    try:out,_=await asyncio.wait_for(proc.communicate(json.dumps(request).encode()),180)
    except (asyncio.TimeoutError,asyncio.CancelledError):
        proc.kill();await proc.wait();raise
    if proc.returncode:return {'status':'unavailable','note':'The earnings estimate could not be verified. Do not infer zero or a confirmed payout; staff review may be needed.'}
    return services.clean(json.loads(out))
