"""Fixed-recipient forwarding using Hermes's bot token. No Slack reading API."""
import hashlib
import json
import uuid
from pathlib import Path
import httpx
import operations


def token():
    for line in (Path.home()/'.hermes/.env').read_text().splitlines():
        if line.startswith('SLACK_BOT_TOKEN='):
            return line.split('=',1)[1].strip().strip('\"\'')
    raise RuntimeError('Slack bot token unavailable')


async def forward(key, text):
    config=json.loads((operations.STATE/'config.json').read_text()).get('slack_forward',{})
    if not config.get('enabled') or not config.get('michael_user_id'):
        return {'state':'not_configured','note':'No message sent; Michael forwarding is not configured.'}
    directory=operations.STATE/'slack-forwards';directory.mkdir(exist_ok=True,mode=0o700)
    event=hashlib.sha256(key.encode()).hexdigest()
    content_hash=hashlib.sha256(text.encode()).hexdigest()
    path=directory/f'{event}.json'
    if path.exists():
        prior=json.loads(path.read_text())
        if prior.get('content_hash') and prior['content_hash']!=content_hash:
            return {'state':'needs_review','note':'This payout was already forwarded with different details. Do not claim the new details were delivered; coordinate a correction with staff.'}
        return prior
    operations.save(path,{'state':'outcome_unknown','note':'Delivery may have happened; do not resend blindly.'})
    async with httpx.AsyncClient(timeout=20) as client:
        response=await client.post('https://slack.com/api/chat.postMessage',headers={'Authorization':'Bearer '+token()},
            json={'channel':config['michael_user_id'],'text':text[:3900],'mrkdwn':False,
                  'unfurl_links':False,'unfurl_media':False,'client_msg_id':str(uuid.UUID(event[:32]))})
        response.raise_for_status();data=response.json()
    if not data.get('ok'):
        result={'state':'failed','error':data.get('error','unknown'),'note':'No successful delivery confirmed.'}
    else:
        result={'state':'sent','recipient':'Michael','channel':data['channel'],'ts':data['ts'],'content_hash':content_hash}
    operations.save(path,result)
    return result
