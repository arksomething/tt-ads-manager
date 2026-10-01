"""Live REST readback of cohort isolation, archived resources and tutorial links."""
import asyncio,json,subprocess
import support
G='1400610531189985310'
BASE='/var/lib/gotall-discord-cutover-20260914/'
def load(name):return json.loads(subprocess.check_output(['sudo','-n','cat',BASE+name]))
def permissions(channel,roles,member,guild):
    if member['user']['id']==guild['owner_id']:return (1<<53)-1
    bits=0
    for r in roles:
        if r['id']==G or r['id'] in member['roles']:bits|=int(r['permissions'])
    if bits&8:return (1<<53)-1
    overwrites=channel.get('permission_overwrites',[])
    for entries in [[p for p in overwrites if p['id']==G], [p for p in overwrites if p['type']==0 and p['id'] in member['roles']], [p for p in overwrites if p['type']==1 and p['id']==member['user']['id']]]:
        allow=deny=0
        for p in entries:allow|=int(p['allow']);deny|=int(p['deny'])
        bits=(bits&~deny)|allow
    return bits
async def main():
    api=support.DiscordAPI(support.bot_token());before=load('before.json');roster=load('roster.json');r=load('applied.json')['resources']
    channels={c['id']:c for c in await api.get(f'/guilds/{G}/channels')};roles=await api.get(f'/guilds/{G}/roles');guild=await api.get(f'/guilds/{G}')
    def perm(channel,member):return permissions(channels[channel],roles,member,guild)
    members={}
    for row in roster:
        for uid in row['current']:members[uid]=await api.get(f'/guilds/{G}/members/{uid}')
    archived=[c for c in channels.values() if c.get('parent_id')==r['category_resource_archive']]
    for row in roster:
        for uid in row['current']:
            m=members[uid]
            assert perm(row['channel_id'],m)&1024
            assert not perm(r['channel_start_here'],m)&1024
            for c in archived:assert not perm(c['id'],m)&1024
            assert perm(r['channel_legacy_submit'],m)&2048
            assert not perm(r['channel_creator_guide'],m)&2048
            for other in roster:
                if uid not in other['current']:assert not perm(other['channel_id'],m)&1024
    new={'user':{'id':'new-test-persona'},'roles':[r['role_active'],r['role_scripts'],r['role_new_deal']]}
    assert not perm(r['channel_legacy_submit'],new)&1024
    assert perm(r['channel_scripts'],new)&1024 and not perm(r['channel_scripts'],new)&2048
    manager={'user':{'id':'manager-test-persona'},'roles':[r['role_staff']]}
    for key in ['channel_scripts','channel_creator_guide','channel_legacy_submit','channel_staff_reviews','channel_video_reviews']:assert perm(r[key],manager)&2048
    assert not perm(r['channel_admin_commands'],manager)&1024
    for c in archived:assert not perm(c['id'],manager)&1024
    tutorials=await api.get(f"/channels/{r['channel_app_access']}/messages?limit=100")
    assert len([m for m in tutorials if any(a['filename'].endswith('.mp4') for a in m.get('attachments',[]))])==3
    assert '1245112089647775877' not in json.dumps(tutorials)
    oldgeneral=next(c for c in before['channels'] if c['id']=='1481528794337509438')
    assert channels[oldgeneral['id']]['permission_overwrites']==oldgeneral['permission_overwrites']
    commands=await api.get(f'/applications/1534630446959427686/guilds/{G}/commands')
    names={c['name'] for c in commands};assert {'apply','status','creator','predict','bestvideos'}<=names
    assert not names&{'agents','approvals','approve','terminal','exec'}
    result={'creator_members_checked':len(members),'private_channels_checked':len(roster),'archived_channels_hidden':len(archived),'legacy_and_new_deal_isolation':True,'manager_write_access':True,'native_tutorial_videos':3,'general_unchanged':True,'commands':sorted(names)}
    support.STATE.joinpath('production-cutover-verification.json').write_text(json.dumps(result,indent=2))
    print(json.dumps(result))
asyncio.run(main())
