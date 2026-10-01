"""Provision support routing without changing existing creator channels/commands.

Run with this directory's pinned Nanobot environment. Does not start the service
or change Hermes; those are separate, reviewable cutover steps.
"""
import asyncio
import json
import support


async def main():
    support.STATE.mkdir(parents=True,exist_ok=True,mode=0o700)
    api=support.DiscordAPI(support.bot_token())
    config={"guilds":{}}
    target=support.STATE/'config.json'
    previous=json.loads(target.read_text()) if target.exists() else {'guilds':{}}
    config={**previous,'guilds':{}}
    try:
        me=await api.get('/users/@me')
        assert int(me['id'])==support.BOT_ID,'Unexpected bot'
        for gid,manager,categories in [
            ('1400610531189985310','1502684705491910686',[1492406840447991961,1492407020106678303,1492407167423352863,1496975271486689280,1524754775735009331]),
            ('1245112089647775877','1545056631518142618',[1545056633183404084,1545056634097770558,1545056636551303209,1545056637457399881]),
        ]:
            guild=await api.get('/guilds/'+gid)
            roles=await api.get('/guilds/'+gid+'/roles')
            assert any(r['id']==manager for r in roles),'Manager role unavailable'
            staff=[r['id'] for r in roles if r['id']==manager or r['name'] in ['Admin','Founder']]
            channels=await api.get('/guilds/'+gid+'/channels')
            if gid=='1245112089647775877':
                review=next(c for c in channels if c['id']=='1547508539260538960')
            else:
                review=next((c for c in channels if c['name']=='support-review' and c['type']==0),None)
                if review is None:
                    overwrites=[{'id':gid,'type':0,'allow':'0','deny':'1024'},
                        *[{'id':r,'type':0,'allow':'117760','deny':'0'} for r in staff],
                        {'id':str(support.BOT_ID),'type':1,'allow':'117760','deny':'0'},
                        {'id':str(support.OWNER_ID),'type':1,'allow':'117760','deny':'0'}]
                    review=await api.request('POST','/guilds/'+gid+'/channels',json={
                        'name':'support-review','type':0,'topic':'Private creator support cases. Resolve with !support-resolve CASE_ID explanation after correcting underlying records.',
                        'permission_overwrites':overwrites})
            # Fail closed if an existing similarly named review channel is public.
            assert any(o['id']==gid and int(o['deny'])&1024 for o in review.get('permission_overwrites',[])),'Review channel must deny everyone'
            assert any(o['id']==manager and int(o['allow'])&1024 for o in review.get('permission_overwrites',[])),'Manager needs review access'
            existing=previous['guilds'].get(gid,{})
            config['guilds'][gid]={**existing,'owner':guild['owner_id'],'manager_role':manager,'staff_roles':staff,
                'review_channel':review['id'],'categories':categories,'channels':[],
                'operators':existing.get('operators',[]),
                'guide_channels':existing.get('guide_channels',['1481512246155808778','1481512610326253588','1481517558312997016','1481519190262288384'] if gid=='1400610531189985310' else [])}
            print(json.dumps({'guild':guild['name'],'review_channel':review['id'],'private_creator_channels':sum(c.get('parent_id') in set(map(str,categories)) and c['type']==0 for c in channels)}))
        target.write_text(json.dumps(config,indent=2)+'\n');target.chmod(0o600)
    finally:await api.http.aclose()


if __name__=='__main__':asyncio.run(main())
