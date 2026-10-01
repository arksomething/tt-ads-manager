"""Resolve current approved accounts on demand; no mapping cache or background jobs."""
import asyncio
import json
import uuid
from pathlib import Path


async def read_json(*command, request=None):
    proc=await asyncio.create_subprocess_exec(*command,stdin=asyncio.subprocess.PIPE,stdout=asyncio.subprocess.PIPE,stderr=asyncio.subprocess.DEVNULL)
    try:
        out,_=await asyncio.wait_for(proc.communicate(json.dumps(request).encode() if request is not None else None),90)
    except (asyncio.TimeoutError,asyncio.CancelledError):
        proc.kill();await proc.wait();raise
    if proc.returncode:raise ValueError('Account lookup unavailable; do not guess earnings.')
    return json.loads(out)


def resolve(rows,matches,guild,channel,user,verified):
    target=(str(guild),str(user))
    own=[r for r in rows if (str(r['guild_id']),str(r['discord_user_id']))==target]
    if not own or any(str(r['channel_id'])!=str(channel) for r in own):return None
    index={(m['platform'],str(m['native_account_id'])):m['links'] for m in matches}
    claimed={}
    for g,users in verified.items():
        for u,b in users.items():
            for a in b.get('accounts') or ([b] if b.get('campaign_creator_id') else []):
                claimed.setdefault(a['campaign_creator_id'],set()).add((str(g),str(u)))
    # Collect all owners before resolving, so conflicts cannot depend on row order.
    for r in rows:
        for link in index.get((r['platform'],str(r.get('native_account_id'))),[]):
            claimed.setdefault(link['campaign_creator_id'],set()).add((str(r['guild_id']),str(r['discord_user_id'])))
    accounts={};pending=[]
    for r in own:
        links=index.get((r['platform'],str(r.get('native_account_id'))),[])
        if not r.get('active') or not r.get('tracked_videos') or len(links)!=1 or claimed[links[0]['campaign_creator_id']]-{target}:
            pending.append({'platform':r['platform'],'handle':r['handle']})
        else:accounts[links[0]['campaign_creator_id']]=links[0]
    return {'channel_id':str(channel),'accounts':list(accounts.values()),'pending_accounts':pending,'test_fixture':str(guild)=='1245112089647775877'}


async def lookup(guild,channel,user,verified):
    if str(guild) not in ['1245112089647775877','1400610531189985310']:return None
    # Use the existing user-service broker, as payment-profile reads do. The
    # gateway remains NoNewPrivileges; this fixed command exposes only the
    # root-owned bridge's read-only identity operation, never caller commands.
    rows=await read_json('systemd-run','--user','--wait','--pipe','--quiet','--collect',
        '--unit=gotall-account-lookup-'+uuid.uuid4().hex,'--property=RuntimeMaxSec=60',
        'sudo','-n','/usr/bin/python3','/usr/local/lib/gotall-discord-onboarding-test/tracker-bridge.py','identities')
    if not any(str(r['guild_id'])==str(guild) and str(r['discord_user_id'])==str(user) and str(r['channel_id'])==str(channel) for r in rows):return None
    matches=await read_json(str(Path.home()/'.nvm/versions/node/v24.12.0/bin/node'),str(Path(__file__).with_name('creator-records.mjs')),request={'operation':'match_tracked','accounts':rows})
    return resolve(rows,matches,guild,channel,user,verified)
