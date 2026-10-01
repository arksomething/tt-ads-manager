"""Replay Discord snapshots through production routing/agent with fixture-only tools.

Only model inference uses network. Never constructs DiscordAPI, starts the gateway,
delivers an outbox, runs a shell or calls a real provider/business tool.
"""
import argparse
import asyncio
import copy
from contextlib import ExitStack
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace as NS
from unittest.mock import patch
from urllib.parse import urlsplit, parse_qs

import support
import triage


class ReplayAPI:
    def __init__(self, case):
        self.case=case
        self.calls=[]
        self.guild=str(case['guild'])
        self.cutoff=int(case['message_id'])
        self.channels={str(c['id']):c for c in case['channels']}
        self.messages={str(cid):[m for m in rows if int(m['id'])<=self.cutoff]
                       for cid,rows in case['messages'].items()}

    async def get(self, path):
        self.calls.append(path)
        parsed=urlsplit(path);parts=parsed.path.strip('/').split('/');query=parse_qs(parsed.query)
        if parts==['guilds',self.guild]:return {'id':self.guild,'owner_id':str(self.case['config'].get('owner',support.OWNER_ID))}
        if parts==['guilds',self.guild,'roles']:
            return [{'id':self.guild,'permissions':'66560'},*self.case.get('roles',[])]
        if parts[:3]==['guilds',self.guild,'members'] and len(parts)==4:
            return {'roles':self.case.get('member_roles',{}).get(parts[3],[])}
        if len(parts)>=2 and parts[0]=='channels' and parts[1] in self.channels:
            cid=parts[1]
            if len(parts)==2:
                # Access is an explicit fixture assumption, not reconstructed role history.
                return {**self.channels[cid],'guild_id':self.guild,'type':0,'permission_overwrites':[]}
            if len(parts)>=3 and parts[2]=='messages':
                rows=sorted(self.messages.get(cid,[]),key=lambda m:int(m['id']),reverse=True)
                if len(parts)==4:
                    for m in rows:
                        if m['id']==parts[3]:return copy.deepcopy(m)
                    raise PermissionError('Message unavailable at replay cutoff')
                before=int(query.get('before',[str(self.cutoff+1)])[0])
                limit=min(int(query.get('limit',['50'])[0]),100)
                return copy.deepcopy([m for m in rows if int(m['id'])<before][:limit])
        raise PermissionError('No accessible fixture for this Discord resource')

    async def request(self,*args,**kwargs):
        raise PermissionError('Replay cannot mutate Discord')


def tools_class(case, calls):
    class ReplayTools(support.SupportTools):
        def registry(self):
            registry=super().registry()
            # Every callback is replaced. New tools default to unavailable, never live.
            for name in registry.tool_names:
                tool=registry.get(name)
                local={'channel_history':self.channel_history,'program_guides':self.program_guides,
                       'open_support_case':self.open_support_case,'resolve_support_case':self.resolve_support_case}
                original=local.get(name)
                async def fixture_call(_name=name,_original=original,**kwargs):
                    calls.append({'tool':_name,'arguments':kwargs})
                    if _original is not None:
                        return await _original(**kwargs)  # ReplayAPI or temporary SQLite only.
                    fixtures=case.get('tool_results',{})
                    if _name in fixtures:
                        value=fixtures[_name]
                        if isinstance(value,list):
                            index=sum(c['tool']==_name for c in calls)-1
                            return copy.deepcopy(value[min(index,len(value)-1)]) if value else {'status':'unavailable'}
                        return copy.deepcopy(value)
                    return {'status':'unavailable','replay_fixture_missing':True,
                            'note':'No historical tool evidence was supplied. This does not establish a live outage or zero result.'}
                registry.register(support.BoundTool(name,tool.description,tool.parameters.get('properties',{}),
                                                   tool.parameters.get('required',[]),fixture_call))
            return registry
    return ReplayTools


async def run_case(case, mode='full'):
    api=ReplayAPI(case)
    cid=str(case['channel_id']);mid=str(case['message_id'])
    current=next(m for m in api.messages[cid] if m['id']==mid)
    calls=[];direct=[];typing=[]
    class Typing:
        async def __aenter__(self):typing.append(True)
        async def __aexit__(self,*args):pass
    async def reply(content,**kwargs):direct.append(content)
    channel=NS(id=int(cid),category_id=int(api.channels[cid].get('parent_id') or 0),
               permissions_for=lambda _:NS(view_channel=case.get('public',False)),typing=Typing)
    reference=current.get('message_reference',{}).get('message_id')
    message=NS(id=int(mid),channel=channel,content=current.get('content',''),
        attachments=[NS(filename=a.get('filename','attachment')) for a in current.get('attachments',[])],
        guild=NS(id=int(case['guild']),owner_id=int(case['config'].get('owner',support.OWNER_ID)),default_role=object()),
        author=NS(id=int(current['author']['id']),bot=current['author'].get('bot',False),
                  roles=[NS(id=int(r)) for r in case.get('member_roles',{}).get(current['author']['id'],[])]),
        reference=NS(message_id=int(reference)) if reference else None,
        mentions=[NS(id=int(m['id'])) for m in current.get('mentions',[])],reply=reply)
    original_answer=support.answer_question
    async def answer(*args,**kwargs):
        if mode=='route':return '',{'silent':True},[]
        return await original_answer(*args,**kwargs,now_utc=current.get('timestamp','')[:10])
    with tempfile.TemporaryDirectory(prefix='discord-replay-') as directory:
        store=support.Store(Path(directory)/'support.sqlite3')
        client=support.SupportClient({'guilds':{str(case['guild']):case['config']}},api,store)
        for old in case.get('delivered_replies',[]):
            if int(old['delivered'])<int(mid):
                store.enqueue('reply-'+old['source'],cid,'Historical reply')
                store.db.execute('UPDATE outbox SET delivered=? WHERE id=?',(old['delivered'],'reply-'+old['source']));store.db.commit()
        baseline={r['id'] for r in store.db.execute('SELECT id FROM outbox')}
        with ExitStack() as patches:
            patches.enter_context(patch.object(support.discord,'TextChannel',NS))
            patches.enter_context(patch.object(support,'SupportTools',tools_class(case,calls)))
            patches.enter_context(patch.object(support,'answer_question',answer))
            patches.enter_context(patch.object(support.operations,'recent_jobs',return_value=[]))
            patches.enter_context(patch.object(triage,'DEBOUNCE_SECONDS',0))
            await client.on_message(message)
        decisions=[dict(r) for r in store.db.execute('SELECT * FROM triage_decisions')]
        outbox=[dict(r) for r in store.db.execute('SELECT * FROM outbox') if r['id'] not in baseline]
        turns=[dict(r) for r in store.db.execute('SELECT * FROM turns')]
        cases=[dict(r) for r in store.db.execute('SELECT * FROM cases')]
        # These are captured intentions, never delivery receipts.
        result={'name':case['name'],'mode':mode,'question':current.get('content',''),
                'decision':decisions[-1] if decisions else None,'turns':turns,'outbox':outbox,
                'direct_replies':direct,'tools':calls,'cases':cases,'typing_started':bool(typing),
                'discord_reads':api.calls,'limitations':case.get('limitations',[]),
                'legacy_keyword_match':support.automatic_faq(message,case['config'])}
        failures=[]
        expected=case.get('expect',{})
        routed=bool(turns)
        if 'respond' in expected and routed!=expected['respond']:failures.append('routing')
        if mode=='full':
            names={c['tool'] for c in calls}
            text='\n'.join(r['content'] for r in outbox if r['id'].startswith('reply-'))
            for name in expected.get('tools',[]):
                if name not in names:failures.append('missing_tool:'+name)
            for name in expected.get('no_tools',[]):
                if name in names:failures.append('unexpected_tool:'+name)
            for phrase in expected.get('contains',[]):
                if phrase.casefold() not in text.casefold():failures.append('missing_text:'+phrase)
            for phrase in expected.get('not_contains',[]):
                if phrase.casefold() in text.casefold():failures.append('forbidden_text:'+phrase)
            if any(json.loads(t['usage'] or '{}').get('failed') for t in turns):failures.append('agent_failed')
        if any(json.loads(d['usage']).get('failed') for d in decisions):failures.append('triage_failed')
        result['checks']={'passed':not failures,'failures':failures,'expected':expected}
        store.db.close()
        await client.close()
        return result


def snapshot_case(snapshot, mid, cfg):
    for entry in snapshot['channels']:
        target=next((m for m in entry['messages'] if m['id']==mid),None)
        if target:
            return {'name':'historical-'+mid,'guild':snapshot['guild'],'channel_id':entry['channel']['id'],
                'message_id':mid,'config':cfg,'channels':[entry['channel']],
                'messages':{entry['channel']['id']:entry['messages']},
                'limitations':['Only messages at or before the target ID are visible.',
                               'Author channel access is assumed; historical staff roles are not reconstructed.',
                               'Missing reports/provider results are unavailable fixtures, not evidence of a live failure.']}
    raise ValueError('Message not found in snapshot')


def write_report(path, results):
    lines=['# Discord conversation replay','',
           'Real model inference; Discord and business tools use isolated fixtures. No messages or actions were delivered.',
           'Routing and content checks are regression checks, not proof of real-world resolution. Missing historical tools are explicitly unavailable.', '']
    for r in results:
        lines.extend(['## '+r['name'],'','Question: '+r.get('question',''),'',
                      'Decision: '+str((r.get('decision') or {}).get('action','explicit request or scope skip')),
                      'Checks: '+('PASS' if r['checks']['passed'] else ', '.join(r['checks']['failures'])),''])
        for t in r.get('turns',[]):
            if t.get('answer'):lines.extend([t['answer'],''])
        if not r.get('outbox'):lines.extend(['No outgoing message.',''])
        if r.get('tools'):lines.extend(['Tools: '+', '.join(c['tool'] for c in r['tools']),''])
        for c in r.get('cases',[]):lines.extend(['Simulated support case: '+c['details'],''])
    path.write_text('\n'.join(lines));path.chmod(0o600)


async def main():
    parser=argparse.ArgumentParser(description=__doc__)
    source=parser.add_mutually_exclusive_group(required=True)
    source.add_argument('--fixtures',type=Path)
    source.add_argument('--snapshot',type=Path)
    parser.add_argument('--message-id',action='append',default=[])
    parser.add_argument('--config',type=Path,help='Routing config for a historical snapshot')
    parser.add_argument('--mode',choices=['route','full'],default='full')
    parser.add_argument('--case',action='append',default=[])
    parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args()
    if args.fixtures:cases=json.loads(args.fixtures.read_text())['cases']
    else:
        if not args.message_id or not args.config:parser.error('--snapshot requires --message-id and --config')
        snapshot=json.loads(args.snapshot.read_text());cfg=json.loads(args.config.read_text())['guilds'][snapshot['guild']]
        cases=[snapshot_case(snapshot,mid,cfg) for mid in args.message_id]
    if args.case:cases=[c for c in cases if c['name'] in args.case]
    if not cases:parser.error('No matching cases')
    support.logger.remove()
    support.codex.get_codex_token=support.read_codex_session
    results=[]
    args.output.parent.mkdir(parents=True,exist_ok=True)
    for case in cases:
        try:result=await asyncio.wait_for(run_case(case,args.mode),timeout=240)
        except Exception as error:result={'name':case['name'],'error':type(error).__name__,'checks':{'passed':False,'failures':['replay_error']}}
        results.append(result)
        args.output.write_text(json.dumps({'mode':'model inference with isolated Discord and fixture-only tools','results':results},indent=2))
        args.output.chmod(0o600)
        write_report(args.output.with_suffix('.md'),results)
        print(json.dumps({'name':case['name'],'decision':(result.get('decision') or {}).get('action'),
                          'checks':result['checks'],'answers':[t['answer'] for t in result.get('turns',[])]}),flush=True)
    return all(r['checks']['passed'] for r in results)


if __name__=='__main__':raise SystemExit(0 if asyncio.run(main()) else 1)
