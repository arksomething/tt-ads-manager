"""Regression cases from the September 23 production conversation audit."""
import asyncio
import json
import tempfile
import time
import unittest
from pathlib import Path
from types import SimpleNamespace as NS
from unittest.mock import AsyncMock, patch
import support
import account_lookup
from nanobot.agent.runner import AgentRunResult


class StoreFixture(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.store=support.Store(Path(self.tmp.name)/'support.db')
    def tearDown(self):
        self.store.db.close();self.tmp.cleanup()

    def test_failed_provider_answers_are_not_successful_or_reused(self):
        for i in range(5):
            self.assertEqual(self.store.admit(str(i),'g','c','u','Can you give me a video idea?'),'accepted')
            self.store.finish(str(i),'Error calling Codex (RuntimeError): Codex login needs renewal by the account owner',{})
        self.assertEqual(self.store.history('g','c','u'),[])
        self.assertEqual(self.store.db.execute("SELECT count(*) FROM turns WHERE state='failed'").fetchone()[0],5)
        # Old deployments persisted provider errors as done: exclude these too.
        self.store.db.execute("UPDATE turns SET state='done'")
        self.assertEqual(self.store.history('g','c','u'),[])
        self.assertEqual(self.store.admit('6','g','c','u','Can you give me a video idea?'),'accepted')

    def test_short_followup_requires_same_user_delivered_question_and_recent_channel(self):
        self.store.admit('1','1','7','12','payment')
        self.store.finish('1','Do you want your report, expected amount, or payment status?',{},'7')
        msg=NS(guild=NS(id=1),channel=NS(id=7),author=NS(id=12),reference=None,mentions=[],content='payment status')
        self.assertFalse(support.conversational_followup(msg,{},self.store))
        self.store.db.execute("UPDATE outbox SET delivered='100'")
        self.assertTrue(support.conversational_followup(msg,{},self.store))
        for key,value in [('author',NS(id=13)),('channel',NS(id=8)),('guild',NS(id=2)),('reference',NS(message_id=99)),('mentions',[NS(id=33)]),('content','Thanks!')]:
            changed=NS(**{**vars(msg),key:value})
            self.assertFalse(support.conversational_followup(changed,{},self.store),key)
        self.store.db.execute('UPDATE turns SET created=?',(time.time()-601,))
        self.assertFalse(support.conversational_followup(msg,{},self.store))

    def test_queued_restart_notifies_without_claiming_action_started(self):
        self.store.admit('1','g','c','u','request',queued=True)
        self.store.recover_interrupted()
        row=self.store.db.execute('SELECT * FROM turns').fetchone()
        self.assertEqual(row['state'],'failed')
        self.assertIn('before I could start',row['answer'])
        self.assertEqual(len(self.store.db.execute('SELECT * FROM outbox').fetchall()),1)


class RichContextTests(unittest.IsolatedAsyncioTestCase):
    def message(self,mid,**more):
        return {'id':mid,'timestamp':'2026-09-23T01:00:00Z','author':{'id':'bot','username':'bot','bot':True},'content':'','attachments':[],**more}

    async def test_guides_keep_embeds_buttons_and_survive_deleted_or_denied_channel(self):
        guide=self.message('1',embeds=[{'title':'Get GoTall','description':'Install using https://testflight.apple.com/join/example','fields':[{'name':'Cost','value':'Test purchase only'}]}],components=[{'type':1,'components':[{'type':2,'label':'Warm-up guide','url':'https://example.com/warmup'}]}])
        async def get(path):
            if '/deleted/' in path:raise RuntimeError('Discord HTTP 404')
            return [guide]
        bound=support.SupportTools(NS(get=AsyncMock(side_effect=get)),None,{'guide_channels':['deleted','denied','visible']},'g','c','u','m')
        async def readable(cid):
            if cid=='denied':raise PermissionError()
        bound.readable_channel=AsyncMock(side_effect=readable)
        result=await bound.program_guides()
        self.assertTrue(result['partial'])
        self.assertEqual(result['unavailable_channels'],['deleted','denied'])
        text=result['guides'][0]['text']
        for value in ['Get GoTall','testflight.apple.com','Test purchase only','https://example.com/warmup']:self.assertIn(value,text)
        self.assertEqual(len(result['guides']),1)
        self.assertIn('https://discord.com/channels/g/visible/1',bound.evidence_links)

    async def test_search_matches_embed_text_without_marking_bot_as_staff(self):
        bound=support.SupportTools(NS(get=AsyncMock(return_value=[self.message('1',embeds=[{'description':'Your approved Instagram account'}])])),None,{'staff_roles':['staff']},'g','c','u','m')
        bound.readable_channel=AsyncMock();bound.verify_author=AsyncMock()
        result=await bound.channel_history('instagram')
        self.assertEqual(len(result['messages']),1)
        self.assertFalse(result['messages'][0]['staff_author_verified'])

    async def test_operator_receives_existing_handle_without_tool_request(self):
        with tempfile.TemporaryDirectory() as tmp:
            store=support.Store(Path(tmp)/'s.db')
            captured=[]
            async def authenticate(bound):
                bound.operator=True
                return {'user_id':'u','operator':True}
            async def run(spec):
                captured.extend(spec.initial_messages)
                return AgentRunResult(final_content='The supplied account is @as.tallasdrago.',messages=[])
            with patch.object(support.SupportTools,'readable_channel',AsyncMock()),patch.object(support.SupportTools,'authenticate',authenticate),patch.object(support.SupportTools,'creator_context',AsyncMock(return_value={'recent':{'messages':[{'text':'@as.tallasdrago - insta'}]}})),patch.object(support.AgentRunner,'run',AsyncMock(side_effect=run)),patch.object(support.operations,'recent_jobs',return_value=[]):
                await support.answer_question(None,store,{},'g','c','u','m','please add that insta account')
            self.assertIn('@as.tallasdrago',json.dumps(captured))
            store.db.close()

    async def test_structured_provider_failure_never_leaks_raw_error(self):
        for error,tools in [('Codex login needs renewal by the account owner',[]),('Unexpected upstream failure',[]),('Codex login needs renewal by the account owner',['run_command'])]:
            with tempfile.TemporaryDirectory() as tmp:
                store=support.Store(Path(tmp)/'s.db')
                result=AgentRunResult(final_content='private upstream detail',messages=[],error=error,stop_reason='error',tools_used=tools)
                with patch.object(support.SupportTools,'readable_channel',AsyncMock()),patch.object(support.SupportTools,'authenticate',AsyncMock(return_value={})),patch.object(support.SupportTools,'creator_context',AsyncMock(return_value={})),patch.object(support.AgentRunner,'run',AsyncMock(return_value=result)):
                    answer,usage,_=await support.answer_question(None,store,{},'g','c','u','m','help')
                self.assertTrue(usage['failed']);self.assertNotIn('private upstream',answer)
                self.assertEqual(answer,support.AUTH_FAILURE if 'Codex' in error and not tools else support.SAFE_FAILURE)
                store.db.close()

    async def test_identity_broker_uses_fixed_read_only_operation(self):
        with patch.object(account_lookup,'read_json',AsyncMock(return_value=[])) as read:
            self.assertIsNone(await account_lookup.lookup('1400610531189985310','c','u',{}))
        command=read.call_args.args
        self.assertEqual(command[:3],('systemd-run','--user','--wait'))
        self.assertEqual(command[-5:],('sudo','-n','/usr/bin/python3','/usr/local/lib/gotall-discord-onboarding-test/tracker-bridge.py','identities'))
        self.assertNotIn('c',command);self.assertNotIn('u',command)


class QueueTests(unittest.IsolatedAsyncioTestCase):
    async def test_busy_requests_are_serialized_deduplicated_and_completed(self):
        class Typing:
            async def __aenter__(self):return self
            async def __aexit__(self,*args):pass
        with tempfile.TemporaryDirectory() as tmp:
            store=support.Store(Path(tmp)/'s.db')
            cfg={'categories':[8],'review_channel':'9','staff_roles':[]}
            client=support.SupportClient({'guilds':{'1':cfg}},None,store)
            channel=NS(id=7,category_id=8,permissions_for=lambda _:NS(view_channel=False),typing=Typing)
            def msg(mid,mention=True):
                return NS(id=mid,channel=channel,guild=NS(id=1,owner_id=99,default_role=object()),author=NS(id=12,bot=False,roles=[]),reference=None,content=(f'<@{support.BOT_ID}> ' if mention else '')+'How do I upload my video?',mentions=[NS(id=support.BOT_ID)] if mention else [],reply=AsyncMock())
            started=asyncio.Event();release=asyncio.Event();calls=[]
            async def answer(*args):
                calls.append(args[-2])
                if len(calls)==1:started.set();await release.wait()
                return 'Checked.',{},[]
            with patch.object(support.discord,'TextChannel',NS),patch.object(client,'automatic_decision',AsyncMock(return_value=True)),patch.object(support,'answer_question',answer):
                first=asyncio.create_task(client.on_message(msg(1)))
                await started.wait()
                second_msg=msg(2)
                second=asyncio.create_task(client.on_message(second_msg))
                third=asyncio.create_task(client.on_message(msg(3,False)))
                await asyncio.sleep(.02)
                self.assertEqual(calls,[1]);self.assertEqual(client.waiting,2)
                self.assertEqual(store.db.execute("SELECT count(*) FROM turns WHERE state='queued'").fetchone()[0],2)
                await client.on_message(second_msg)
                self.assertEqual(second_msg.reply.await_count,1)
                release.set();await asyncio.gather(first,second,third)
            self.assertEqual(calls,[1,2,3]);self.assertEqual(client.waiting,0)
            self.assertEqual(store.db.execute("SELECT count(*) FROM outbox").fetchone()[0],3)
            store.db.close()

    async def test_bare_mention_is_investigated_with_context(self):
        class Typing:
            async def __aenter__(self):return self
            async def __aexit__(self,*args):pass
        with tempfile.TemporaryDirectory() as tmp:
            store=support.Store(Path(tmp)/'s.db')
            cfg={'categories':[8],'review_channel':'9','staff_roles':[]}
            client=support.SupportClient({'guilds':{'1':cfg}},None,store)
            message=NS(id=1,channel=NS(id=7,category_id=8,permissions_for=lambda _:NS(view_channel=False),typing=Typing),guild=NS(id=1,owner_id=99,default_role=object()),author=NS(id=12,bot=False),reference=None,content=f'<@{support.BOT_ID}>',mentions=[NS(id=support.BOT_ID)],reply=AsyncMock())
            with patch.object(support.discord,'TextChannel',NS),patch.object(support,'answer_question',AsyncMock(return_value=('Read your previous message.',{},[]))) as run:
                await client.on_message(message)
            self.assertIn('preceding conversation',run.call_args.args[-1]);message.reply.assert_not_awaited()
            store.db.close()

class FollowthroughTests(unittest.IsolatedAsyncioTestCase):
    async def test_job_wait_reads_completion_without_relaunching_and_rechecks_actor(self):
        bound=support.SupportTools(None,None,{},'g','c','u','m')
        bound.require_operator=AsyncMock(return_value={'guild':'g'})
        with patch.object(support.operations,'job_status',side_effect=[{'state':'running'},{'state':'completed','exit_code':1,'output':'Verification failed'}]) as status,patch.object(support.asyncio,'sleep',AsyncMock()) as sleep:
            result=await bound.command_status('a'*32)
        self.assertEqual(result['exit_code'],1)
        self.assertEqual(status.call_count,2);sleep.assert_awaited_once();self.assertEqual(bound.require_operator.await_count,2)

    async def test_case_closure_rechecks_operator_and_scope_and_notifies_once(self):
        with tempfile.TemporaryDirectory() as tmp:
            store=support.Store(Path(tmp)/'s.db')
            store.open_case('123','g','creator-channel','creator','access','Cannot access the app','review','manager')
            bound=support.SupportTools(None,store,{'review_channel':'review','admin_commands_channel':'admin'},'g','creator-channel','staff','new-request')
            bound.require_operator=AsyncMock(return_value={});bound.readable_channel=AsyncMock()
            await bound.resolve_support_case('123','Evan confirmed app access was restored.')
            await bound.resolve_support_case('123','Evan confirmed app access was restored.')
            self.assertIsNotNone(store.db.execute('SELECT resolved FROM cases').fetchone()[0])
            self.assertEqual(store.db.execute("SELECT count(*) FROM outbox WHERE id='resolved-123'").fetchone()[0],1)
            bound.readable_channel.assert_awaited_with('creator-channel')
            bound.channel='other-creator'
            with self.assertRaises(PermissionError):await bound.resolve_support_case('123','Confirmed and resolved.')
            bound.channel='admin';bound.require_operator=AsyncMock(side_effect=PermissionError())
            with self.assertRaises(PermissionError):await bound.resolve_support_case('123','Confirmed and resolved.')
            store.db.close()

    def test_current_coach_and_workflow_questions(self):
        for content in ['How do I get in contact with my coach?','Do I need to do anything else?','Hey do you guys do bank transfers?']:
            m=NS(channel=NS(id=7),author=NS(id=12,roles=[]),reference=None,mentions=[],content=content)
            self.assertTrue(support.automatic_faq(m,{}),content)
        from knowledge import business_context
        context=business_context(True)
        self.assertIn('former team member',context)
        self.assertIn('interim content coach',context)
        self.assertNotIn('Judy can confirm',context+support.BETA_NOTICE)
