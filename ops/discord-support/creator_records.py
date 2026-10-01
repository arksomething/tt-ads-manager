"""Typed reads and versioned writes through the existing shared deal engine."""
import asyncio
import hashlib
import json
from pathlib import Path
import services


async def request(payload,identity):
    payload={**payload,'actor':'discord:'+str(identity['user_id'])}
    payload['request_id']=hashlib.sha256(json.dumps([identity,payload],sort_keys=True).encode()).hexdigest()
    if len(json.dumps(payload))>20000:raise ValueError('Deal update too large')
    node=Path.home()/'.nvm/versions/node/v24.12.0/bin/node'
    proc=await asyncio.create_subprocess_exec(str(node),str(Path(__file__).with_name('creator-records.mjs')),stdin=asyncio.subprocess.PIPE,stdout=asyncio.subprocess.PIPE,stderr=asyncio.subprocess.DEVNULL)
    try:out,_=await asyncio.wait_for(proc.communicate(json.dumps(payload).encode()),60)
    except (asyncio.TimeoutError,asyncio.CancelledError):
        proc.kill();await proc.wait();raise
    if proc.returncode:
        return {'status':'unconfirmed','request_id':payload['request_id'],'note':'Operation was rejected or could not be confirmed. Read current terms before retrying; a stale version, invalid effective dates, or unavailable connection may require review. Do not claim a change succeeded.'}
    result=services.clean(json.loads(out))
    if payload['operation']=='publish':
        directory=services.operations.STATE/'deal-actions';directory.mkdir(exist_ok=True,mode=0o700)
        services.operations.save(directory/(payload['request_id']+'.json'),{'identity':identity,'request':payload,'result':result})
    return result
