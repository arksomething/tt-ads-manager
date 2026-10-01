"""Reconcile historical delivery evidence with live Discord membership and database IDs."""
import asyncio,json,re
from pathlib import Path
import support
import operations

ROOT=operations.REPO

async def main():
    settlement=json.loads((ROOT/'payouts/2026-08/final-settlement/settlement.json').read_text())
    receipt=ROOT/'payouts/2026-08/final-settlement/discord-delivery-receipt.md'
    normalize=lambda s:re.sub(r'[^a-z0-9]','',s.lower())
    recipients={normalize(r['name']):r for r in settlement['recipients']}
    matches=re.findall(r'^- (.+?): https://discord.com/channels/(\d+)/(\d+)/(\d+)$',receipt.read_text(),re.M)
    ids=list({c['creatorId'] for r in recipients.values() for c in r['creators']})
    proc=await asyncio.create_subprocess_exec(str(Path.home()/'.nvm/versions/node/v24.12.0/bin/node'),str(Path(__file__).with_name('creator-records.mjs')),stdin=asyncio.subprocess.PIPE,stdout=asyncio.subprocess.PIPE,stderr=asyncio.subprocess.PIPE)
    out,err=await proc.communicate(json.dumps({'operation':'resolve','creator_ids':ids}).encode())
    if proc.returncode:raise RuntimeError('Database identity lookup failed: '+operations.redact(err.decode())[-500:])
    rows=json.loads(out)
    api=support.DiscordAPI(support.bot_token())
    bindings={};audit=[]
    cfg=json.loads((support.STATE/'config.json').read_text())['guilds']
    for name,guild,channel,mid in matches:
        recipient=recipients.get(normalize(name))
        if not recipient:
            audit.append({'name':name,'status':'recipient_unresolved'});continue
        try:
            ch=await api.get(f'/channels/{channel}')
            message=await api.get(f'/channels/{channel}/messages/{mid}')
        except Exception:
            audit.append({'name':name,'status':'channel_or_delivery_unavailable'});continue
        roles=await api.get(f'/guilds/{guild}/roles')
        staff=set(cfg[guild]['staff_roles'])|{r['id'] for r in roles if int(r['permissions'])&8}
        if ch.get('guild_id')!=guild or str(message.get('author',{}).get('id'))!=str(support.BOT_ID) or not message.get('attachments'):
            audit.append({'name':name,'status':'delivery_not_verified'});continue
        candidates=[]
        for ow in ch.get('permission_overwrites',[]):
            if ow['type']!=1 or not int(ow.get('allow',0))&1024 or int(ow.get('deny',0))&1024:continue
            try:member=await api.get(f"/guilds/{guild}/members/{ow['id']}")
            except Exception:continue
            if member.get('user',{}).get('bot') or set(member.get('roles',[]))&staff or str(ow['id'])==str(support.OWNER_ID):continue
            candidates.append(str(ow['id']))
        selected=[]
        for creator in recipient['creators']:
            found=[r for r in rows if r['creatorId']==creator['creatorId'] and r['campaignId']==settlement['campaignId']]
            if len(found)!=1:break
            selected.append({'campaign_creator_id':found[0]['id'],'organization_id':found[0]['campaign']['organizationId']})
        if len(candidates)!=1 or len(selected)!=len(recipient['creators']):
            audit.append({'name':name,'status':'identity_ambiguous','members':len(candidates),'accounts':len(selected)});continue
        user=candidates[0]
        if user in bindings.get(guild,{}):raise ValueError('Duplicate recipient identity; review required')
        bindings.setdefault(guild,{})[user]={'channel_id':channel,'accounts':selected,'display_name':name,'verified_at':__import__('datetime').datetime.now(__import__('datetime').timezone.utc).isoformat(),'evidence':f'https://discord.com/channels/{guild}/{channel}/{mid}'}
        audit.append({'name':name,'status':'verified','accounts':len(selected)})
    operations.save(support.STATE/'verified-creator-bindings.json',bindings)
    operations.save(support.STATE/'creator-binding-audit.json',audit)
    print(json.dumps(audit))

if __name__=='__main__':asyncio.run(main())
