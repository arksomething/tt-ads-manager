import asyncio
import copy
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace as NS
import unittest
from unittest.mock import AsyncMock, patch

import replay
import support
import triage


def fixture(name='pay_question'):
    return next(c for c in json.loads(Path(__file__).with_name('fixtures').joinpath('conversations.json').read_text())['cases'] if c['name']==name)


class TriageTests(unittest.IsolatedAsyncioTestCase):
    async def test_only_valid_tool_free_decision_can_start_work(self):
        for content,finish,calls in [('garbage','stop',[]),('{"action":"send_money","reason":"yes"}','stop',[]),('{"action":"answer","reason":"help"}','error',[]),('{"action":"answer","reason":"help"}','stop',[{}])]:
            provider=NS(chat=AsyncMock(return_value=NS(content=content,finish_reason=finish,tool_calls=calls,usage={})))
            result=await triage.classify(provider,'model',{},[])
            self.assertEqual(result['action'],'ignore');self.assertTrue(result['usage']['failed'])
        provider=NS(chat=AsyncMock(return_value=NS(content='{"action":"investigate","reason":"unanswered pay question"}',finish_reason='stop',tool_calls=[],usage={})))
        self.assertEqual((await triage.classify(provider,'model',{},[]))['action'],'investigate')
        self.assertIsNone(provider.chat.call_args.kwargs['tools'])

    async def test_ignore_never_types_calls_agent_or_enqueues(self):
        with patch.object(triage,'classify',AsyncMock(return_value={'action':'ignore','reason':'status'})),patch.object(support.AgentRunner,'run',AsyncMock()) as run:
            result=await replay.run_case(fixture('exam_status'))
        run.assert_not_awaited()
        self.assertFalse(result['typing_started']);self.assertFalse(result['outbox']);self.assertFalse(result['turns'])
        self.assertTrue(result['checks']['passed'])

    async def test_question_without_old_keywords_reaches_agent(self):
        from nanobot.agent.runner import AgentRunResult
        with patch.object(triage,'classify',AsyncMock(return_value={'action':'investigate','reason':'pay'})),patch.object(support.AgentRunner,'run',AsyncMock(return_value=AgentRunResult(final_content='Checking your payout.',messages=[],tools_used=[]))) as run:
            result=await replay.run_case(fixture())
        run.assert_awaited_once();self.assertTrue(result['typing_started'])
        self.assertTrue(any('Checking your payout.' in r['content'] for r in result['outbox']))

    async def test_model_silent_outcome_does_not_send_failure_or_notice(self):
        from nanobot.agent.runner import AgentRunResult
        for tools in [[],['channel_history']]:
            with patch.object(triage,'classify',AsyncMock(return_value={'action':'answer','reason':'uncertain'})),patch.object(support.AgentRunner,'run',AsyncMock(return_value=AgentRunResult(final_content='[NO_REPLY]',messages=[],tools_used=tools))):
                result=await replay.run_case(fixture('exam_status'))
            self.assertFalse(result['outbox']);self.assertEqual(result['turns'][0]['state'],'silent')

    async def test_scope_stays_closed_even_if_classifier_would_respond(self):
        for change in ['public','staff','mention_human','human_reply','command']:
            case=fixture();m=case['messages']['7'][-1]
            if change=='public':case['public']=True
            elif change=='staff':case['member_roles']={'12':['77']}
            elif change=='mention_human':m['mentions']=[{'id':'123456'}]
            elif change=='human_reply':m['message_reference']={'message_id':'90'}
            else:m['content']='/help'
            with patch.object(triage,'classify',AsyncMock()) as classify:
                result=await replay.run_case(case)
            classify.assert_not_awaited();self.assertFalse(result['turns']);self.assertFalse(result['typing_started'])

    async def test_owner_mentioned_support_reaches_answer_path(self):
        from nanobot.agent.runner import AgentRunResult
        case=fixture();m=case['messages']['7'][-1]
        m['mentions']=[{'id':str(support.OWNER_ID)}]
        m['content']=f'<@{support.OWNER_ID}> Hey Evan, do I authorize each new TikTok for Spark Ads?'
        with patch.object(triage,'classify',AsyncMock(return_value={'action':'answer','reason':'routine support'})) as classify,patch.object(support.AgentRunner,'run',AsyncMock(return_value=AgentRunResult(final_content='Account authorization differs from individual video codes.',messages=[],tools_used=[]))) as run:
            result=await replay.run_case(case)
        classify.assert_awaited_once();run.assert_awaited_once()
        self.assertTrue(result['outbox'])

    def test_staff_mentions_are_candidates_but_other_creators_are_not(self):
        message=NS(channel=NS(id=7),author=NS(id=12,roles=[]),reference=None,
                   mentions=[NS(id=50,roles=[NS(id=77)])],content='When is payment?')
        self.assertTrue(triage.candidate(message,{'staff_roles':['77']},support.OWNER_ID))
        message.mentions.append(NS(id=51,roles=[]))
        self.assertFalse(triage.candidate(message,{'staff_roles':['77']},support.OWNER_ID))

    async def test_new_admin_role_cannot_gain_automatic_operator_work(self):
        case=fixture();case['member_roles']={'12':['88']};case['roles']=[{'id':'88','permissions':'8'}]
        with patch.object(triage,'classify',AsyncMock(return_value={'action':'investigate','reason':'help'})),patch.object(support.AgentRunner,'run',AsyncMock()) as run:
            result=await replay.run_case(case)
        run.assert_not_awaited();self.assertFalse(result['outbox'])
        self.assertEqual(result['turns'][0]['state'],'silent')

    def test_decisions_deduplicate_and_limits_survive_restart(self):
        with tempfile.TemporaryDirectory() as tmp:
            store=support.Store(Path(tmp)/'s.db')
            m=NS(id=1,guild=NS(id=1),channel=NS(id=7),author=NS(id=12))
            with patch.object(triage,'USER_HOURLY_LIMIT',1):
                self.assertTrue(triage.reserve(store.db,m,1000));self.assertFalse(triage.reserve(store.db,m,1001))
                store.db.close();store=support.Store(Path(tmp)/'s.db');m.id=2
                self.assertFalse(triage.reserve(store.db,m,1002));self.assertTrue(triage.reserve(store.db,m,5000))
            self.assertEqual(store.db.execute('SELECT count(*) FROM turns').fetchone()[0],0)
            store.db.close()

    async def test_newer_human_message_cancels_pending_intervention(self):
        with tempfile.TemporaryDirectory() as tmp:
            store=support.Store(Path(tmp)/'s.db');api=NS(get=AsyncMock(return_value=[{'id':'101','author':{'id':'99'},'content':'I answered this.'}]))
            client=support.SupportClient({},api,store)
            m=NS(id=100,guild=NS(id=1),channel=NS(id=7),author=NS(id=12,roles=[]),reference=None,mentions=[],content='Can I get my pay?')
            client.channel_latest[7]=100
            with patch.object(triage,'DEBOUNCE_SECONDS',0),patch.object(triage,'classify',AsyncMock()) as classify:
                self.assertFalse(await client.automatic_decision(m,{}))
            classify.assert_not_awaited();self.assertEqual(store.db.execute('SELECT reason FROM triage_decisions').fetchone()[0],'superseded')
            store.db.close();await client.close()

    async def test_human_answer_during_model_work_suppresses_automatic_reply(self):
        class Typing:
            async def __aenter__(self):pass
            async def __aexit__(self,*args):pass
        with tempfile.TemporaryDirectory() as tmp:
            store=support.Store(Path(tmp)/'s.db');client=support.SupportClient({},None,store)
            m=NS(id=100,guild=NS(id=1),channel=NS(id=7,typing=Typing),author=NS(id=12),reply=AsyncMock())
            store.admit('100','1','7','12','Help');client.channel_latest[7]=100
            async def answer(*args):
                client.channel_latest[7]=101
                return 'Redundant answer',{},[]
            with patch.object(support,'answer_question',answer):await client.process_message(m,{'_automatic':True},'Help')
            self.assertEqual(store.db.execute('SELECT state FROM turns').fetchone()[0],'silent')
            self.assertEqual(store.db.execute('SELECT count(*) FROM outbox').fetchone()[0],0)
            store.db.close();await client.close()


class ReplayIsolationTests(unittest.IsolatedAsyncioTestCase):
    async def test_future_messages_and_unlisted_channels_are_inaccessible(self):
        case=fixture();future=copy.deepcopy(case['messages']['7'][-1]);future.update(id='101',content='THE FUTURE ANSWER')
        case['messages']['7'].append(future);api=replay.ReplayAPI(case)
        self.assertNotIn('THE FUTURE ANSWER',json.dumps(await api.get('/channels/7/messages?limit=100')))
        for path in ['/channels/7/messages/101','/channels/999/messages','/guilds/999/roles']:
            with self.assertRaises(PermissionError):await api.get(path)
        with self.assertRaises(PermissionError):await api.request('POST','/channels/7/messages')

    async def test_every_live_tool_is_replaced_including_new_tools(self):
        case=fixture();calls=[]
        with tempfile.TemporaryDirectory() as tmp:
            store=support.Store(Path(tmp)/'s.db')
            bound=replay.tools_class(case,calls)(replay.ReplayAPI(case),store,case['config'],'1','7','12','100')
            bound.operator=True
            with patch.object(support.SupportTools,'run_command',AsyncMock(side_effect=AssertionError('LIVE SHELL'))) as live:
                registry=bound.registry()
                result=await registry.execute('run_command',{'command':'touch /tmp/should-never-exist'})
                self.assertIn('replay_fixture_missing',str(result));live.assert_not_awaited()
                for name in registry.tool_names:
                    self.assertEqual(registry.get(name).callback.__name__,'fixture_call')
            result=await registry.execute('open_support_case',{'topic':'payout','details':'Missing historical payout report.'})
            self.assertEqual(store.db.execute('SELECT count(*) FROM cases').fetchone()[0],1)
            self.assertIsNone(store.db.execute('SELECT delivered FROM outbox').fetchone()[0]);store.db.close()

    async def test_unknown_tool_class_is_wrapped_not_executed(self):
        class NewTool(support.Tool):
            @property
            def name(self):return 'future_network_tool'
            @property
            def description(self):return 'Would call a live service'
            @property
            def parameters(self):return {'type':'object','properties':{}}
            async def execute(self,**kwargs):raise AssertionError('Live tool executed')
        registry=support.ToolRegistry();registry.register(NewTool())
        cls=replay.tools_class(fixture(),[])
        bound=cls(None,None,{},'1','7','12','100')
        with patch.object(support.SupportTools,'registry',return_value=registry):
            result=await bound.registry().execute('future_network_tool',{})
        self.assertIn('replay_fixture_missing',str(result))
