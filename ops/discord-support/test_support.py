import asyncio
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import support


class StoreTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.store=support.Store(Path(self.tmp.name)/"state.db")
    def tearDown(self):
        self.store.db.close();self.tmp.cleanup()

    def test_dedup_and_limits_survive_restart(self):
        for i in range(12):self.assertEqual(self.store.admit(str(i),'g','c','u','q',1000+i),'accepted')
        self.assertEqual(self.store.admit('0','g','c','u','q',1100),'duplicate')
        self.assertEqual(self.store.admit('13','g','c','u','q',1100),'limited')
        self.store.db.close();self.store=support.Store(Path(self.tmp.name)/'state.db')
        self.assertEqual(self.store.admit('14','g','c','u','q',1100),'limited')
        self.assertEqual(self.store.admit('15','g','c','u','q',5000),'accepted')

    def test_history_is_per_creator_channel_and_guild(self):
        self.store.admit('1','g','c','u','private question')
        self.store.finish('1','private answer',{})
        self.assertEqual(len(self.store.history('g','c','u')),2)
        for scope in [('g','c','other'),('g','other','u'),('other','c','u')]:self.assertEqual(self.store.history(*scope),[])

    def test_beta_notice_is_first_reply_only_and_preserves_terms(self):
        reply=support.first_reply_notice(self.store,'g','c','u','Hello')
        self.assertIn('currently in beta',reply)
        self.assertNotIn('Payment',reply)
        self.store.admit('1','g','c','u','Hello')
        self.store.finish('1',reply,{})
        self.assertEqual(support.first_reply_notice(self.store,'g','c','u','Next'),'Next')
        self.assertIn('currently in beta',support.first_reply_notice(self.store,'g','c','other','Hello'))

    def test_fifth_answered_repeat_is_limited_but_failures_and_corrections_are_not(self):
        for i in range(4):
            self.assertEqual(self.store.admit(str(i),'g','c','u','My performance?',1000+i),'accepted')
            self.store.finish(str(i),'Here is your report',{})
        self.assertEqual(self.store.admit('5','g','c','u','my PERFORMANCE!',1010),'repeated')
        self.assertEqual(self.store.admit('6','g','c','u','My performance for August?',1010),'accepted')
        self.store.finish('6',support.SAFE_FAILURE,{})
        self.assertEqual(self.store.admit('7','g','c','u','My performance for August?',1011),'accepted')
        self.assertEqual(self.store.admit('8','g','other','u','My performance?',1011),'accepted')

    def test_history_retains_more_than_three_turns(self):
        for i in range(8):
            self.store.admit(str(i),'g','c','u',f'Question {i}')
            self.store.finish(str(i),f'Answer {i}',{})
        self.assertEqual(len(self.store.history('g','c','u')),16)

    def test_case_dedup_notification_and_resolution(self):
        first=self.store.open_case('123','g','c','u','payment','Payment missing','review','manager')
        again=self.store.open_case('124','g','c','u','payment','Still missing','review','manager')
        self.assertEqual(first['case_id'],again['case_id'])
        self.assertTrue(again['updated_existing'])
        self.assertEqual(self.store.db.execute('SELECT count(*) FROM cases').fetchone()[0],1)
        self.assertIn('not found',self.store.resolve('123','wrong','review','Investigated payment'))
        self.assertIn('queued',self.store.resolve('123','g','review','Transfer still pending; contact staff tomorrow.'))
        self.assertIn('already',self.store.resolve('123','g','review','Duplicate attempt'))
        rows=self.store.db.execute("SELECT * FROM outbox WHERE id='resolved-123'").fetchall()
        self.assertEqual(len(rows),1);self.assertEqual(rows[0]['user'],'u');self.assertIsNone(rows[0]['role'])

    def test_delivery_matches_source_and_author(self):
        row={'id':'reply-123','content':'hello'}
        msg={'author':{'id':str(support.BOT_ID)},'content':'hello','message_reference':{'message_id':'123'}}
        self.assertTrue(support.delivered_match(row,msg))
        msg['message_reference']['message_id']='999';self.assertFalse(support.delivered_match(row,msg))
        msg['message_reference']['message_id']='123';msg['author']['id']='other';self.assertFalse(support.delivered_match(row,msg))

    def test_interrupted_turn_recovery_does_not_rerun_model(self):
        self.store.admit('123','g','c','u','question')
        self.store.recover_interrupted();self.store.recover_interrupted()
        self.assertEqual(self.store.db.execute('SELECT count(*) FROM outbox').fetchone()[0],1)
        self.assertEqual(self.store.db.execute('SELECT state FROM turns').fetchone()[0],'failed')

    def test_web_search_cache_and_limits_survive_restart(self):
        status,key,result=self.store.admit_web_search('u','  Verity   meme ',1000)
        self.assertEqual((status,key,result),('search','verity meme',None))
        self.store.cache_web_search(key,'source results',1000)
        self.assertEqual(self.store.admit_web_search('u','VERITY MEME',1001),('cached',key,'source results'))
        for i in range(support.WEB_SEARCH_USER_HOURLY_LIMIT-1):
            self.assertEqual(self.store.admit_web_search('u',f'query {i}',1002+i)[0],'search')
        self.assertEqual(self.store.admit_web_search('u','one too many',1010)[0],'limited')
        path=Path(self.tmp.name)/'state.db'
        self.store.db.close();self.store=support.Store(path)
        self.assertEqual(self.store.admit_web_search('u','still limited',1011)[0],'limited')
        self.assertEqual(self.store.admit_web_search('u','later',5000)[0],'search')


class ToolTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.api=SimpleNamespace(get=AsyncMock(return_value=[]))
        self.tmp=tempfile.TemporaryDirectory()
        self.store=support.Store(Path(self.tmp.name)/'state.db')
        self.bound=support.SupportTools(self.api,self.store,{'staff_roles':['staff'],'guide_channels':[]},'g','private','creator','123')

    def tearDown(self):
        self.store.db.close();self.tmp.cleanup()

    async def test_no_shell_or_cross_channel_tool(self):
        registry=self.bound.registry()
        names={t['function']['name'] for t in registry.get_definitions()}
        self.assertEqual(names,{'web_search','guidance_channels','staff_guidance','channel_history','payout_report','program_guides','open_support_case','read_terminal','forward_to_michael','video_metrics','business_activity','my_earnings','video_analysis','video_transcript'})
        result=await registry.execute('payout_report',{'channel_id':'victim'})
        self.assertIn('channel_id',result);self.api.get.assert_not_awaited()

    async def test_web_search_is_bounded_cached_and_tracks_source_links(self):
        self.bound.web_search_tool.execute=AsyncMock(return_value='1. Verity trend\n   https://example.com/verity\n   A public snippet')
        first=await self.bound.web_search('viral Verity meme')
        second=await self.bound.web_search('  VIRAL  verity MEME ')
        self.assertEqual(first['status'],'searched')
        self.assertEqual(second['status'],'cached')
        self.bound.web_search_tool.execute.assert_awaited_once_with(query='viral Verity meme',count=5)
        self.assertIn('https://example.com/verity',self.bound.evidence_links)
        self.assertIn('untrusted',first['warning'].casefold())

    async def test_web_search_rejects_private_queries_before_network(self):
        self.bound.web_search_tool.execute=AsyncMock()
        for query in [
            'https://discord.com/channels/1/2/3 summarize this',
            'email creator@example.com payout',
            'bank account 12345678',
            'api_key=supersecret',
        ]:
            with self.assertRaises(PermissionError):await self.bound.web_search(query)
        self.bound.web_search_tool.execute.assert_not_awaited()

    async def test_report_fetch_stays_bound_even_with_other_message_id(self):
        self.api.get.side_effect=[{'id':'555','author':{'id':'attacker'},'attachments':[{'filename':'payout.pdf'}]}, {'roles':[]}]
        answer=await self.bound.payout_report(message_id='555')
        self.assertEqual(self.api.get.await_args_list[0].args,('/channels/private/messages/555',))
        self.assertIn('no trusted',answer['status'])

    async def test_staff_author_is_verified_from_discord_roles(self):
        self.api.get.return_value={'roles':['staff']}
        message={'id':'1','author':{'id':'manager'},'timestamp':'2026-09-12','content':'approved'}
        await self.bound.verify_author(message)
        self.assertTrue(self.bound.summary(message)['staff_author_verified'])
        self.api.get.assert_awaited_once_with('/guilds/g/members/manager')

    async def test_trusted_reports_only(self):
        attachment={'filename':'august-payout.pdf','id':'a'}
        self.assertEqual(self.bound.report_attachments({'author':{'id':'attacker'},'attachments':[attachment]}),[])
        self.assertEqual(self.bound.report_attachments({'author':{'id':str(support.BOT_ID)},'attachments':[attachment]}),[attachment])

    async def test_query_is_data_not_path(self):
        self.bound.readable_channel=AsyncMock()
        await self.bound.channel_history('../../secrets')
        self.api.get.assert_awaited_once_with('/channels/private/messages?limit=25')

    async def test_history_paginates_empty_search_pages_without_claiming_exhaustion(self):
        self.bound.readable_channel=AsyncMock()
        self.api.get.return_value=[{'id':str(200-i),'content':'unrelated'} for i in range(25)]
        result=await self.bound.channel_history('needle')
        self.assertEqual(result['next_before'],'176')
        self.assertFalse(result['history_exhausted'])
        self.assertEqual(result['messages'],[])
        self.api.get.return_value=[]
        result=await self.bound.channel_history('needle',before='176')
        self.assertTrue(result['history_exhausted'])
        self.api.get.assert_awaited_with('/channels/private/messages?limit=25&before=176')

    async def test_history_enforces_member_overwrites_not_bot_access(self):
        channel={'guild_id':'g','type':0,'permission_overwrites':[{'id':'creator','type':1,'deny':'1024','allow':'0'}]}
        async def get(path):
            if path=='/channels/123':return channel
            if path=='/guilds/g':return {'owner_id':'someone-else'}
            if path.endswith('/members/creator'):return {'roles':[]}
            if path.endswith('/roles'):return [{'id':'g','permissions':str(1024|65536)}]
            raise AssertionError('Must not retrieve messages before authorization')
        self.api.get.side_effect=get
        with self.assertRaises(PermissionError):await self.bound.channel_history(channel_id='123')
        channel['permission_overwrites']=[]
        await self.bound.readable_channel('123')
        channel['guild_id']='another-guild'
        with self.assertRaises(PermissionError):await self.bound.readable_channel('123')

    async def test_provider_call_budget(self):
        provider=support.BudgetProvider()
        with patch.object(support.codex.OpenAICodexProvider,'_call_codex',new=AsyncMock(return_value='ok')) as call:
            for _ in range(24):await provider._call_codex(messages=[])
            with self.assertRaises(RuntimeError):await provider._call_codex(messages=[])
            self.assertEqual(call.await_count,24)

    async def test_provider_context_budget(self):
        with self.assertRaises(RuntimeError):await support.BudgetProvider()._call_codex(messages=[{'content':'x'*240001}])
        with patch.object(support.codex.OpenAICodexProvider,'_call_codex',new=AsyncMock(return_value='ok')):
            self.assertEqual(await support.BudgetProvider()._call_codex(messages=[{'content':'x'*61000}]),'ok')
            self.assertEqual(await support.BudgetProvider(True)._call_codex(messages=[{'content':'x'*250000}]),'ok')


class RoutingTests(unittest.TestCase):
    def test_faq_filter(self):
        message=SimpleNamespace(channel=SimpleNamespace(id=7),author=SimpleNamespace(id=12,roles=[]),reference=None,mentions=[])
        for content in ['When am I getting paid?', "TestFlight app is not working", 'How do I upload my video?', 'Any scripts for today?', "I haven't been paid"]:
            message.content=content
            self.assertTrue(support.automatic_faq(message,{}),content)
        for content in ['thanks!', 'I posted my video today', 'what is your favorite movie?', '> Why is my payout low?', '/payout help', 'https://www.tiktok.com/@aligotall/video/7684808368661237006?is_from_webapp=1&sender_device=pc', 'my video https://example.com/video?question=yes']:
            message.content=content
            self.assertFalse(support.automatic_faq(message,{}),content)

    def test_only_retrieved_discord_links_survive(self):
        valid='https://discord.com/channels/1/2/3'
        answer=f'See [source]({valid}) and https://discord.com/channels/[REDACTED_SECRET]/2/3'
        result=support.checked_citations(answer,{valid})
        self.assertIn(valid,result)
        self.assertEqual(support.checked_citations('[Scripts](https://discord.com/channels/1/2/999)',{valid}),'Scripts')
        self.assertEqual(support.checked_citations(valid+'.',{valid}),valid+'.')
        self.assertNotIn('REDACTED_SECRET',result)
        self.assertNotIn('https://discord.com/channels/1/2/999',support.checked_citations('https://discord.com/channels/1/2/999',{valid}))

    def test_only_private_allowlisted_text_channels(self):
        channel=SimpleNamespace(id=7,category_id=8,permissions_for=lambda role:SimpleNamespace(view_channel=False))
        message=SimpleNamespace(channel=channel,guild=SimpleNamespace(default_role=object()))
        with patch.object(support.discord,'TextChannel',SimpleNamespace):
            self.assertTrue(support.SupportClient.authorized_channel(None,message,{'categories':[8]}))
            self.assertTrue(support.SupportClient.authorized_channel(None,message,{'categories':['8']}))
            channel.id=10
            self.assertTrue(support.SupportClient.authorized_channel(None,message,{'channels':['10'],'categories':[]}))
            channel.id=7
            self.assertFalse(support.SupportClient.authorized_channel(None,message,{'categories':[9]}))
            channel.permissions_for=lambda role:SimpleNamespace(view_channel=True)
            self.assertFalse(support.SupportClient.authorized_channel(None,message,{'categories':['8']}))

    def test_invalid_allowlist_ids_fail_closed(self):
        channel=SimpleNamespace(id=7,category_id=8,permissions_for=lambda role:SimpleNamespace(view_channel=False))
        message=SimpleNamespace(channel=channel,guild=SimpleNamespace(default_role=object()))
        with patch.object(support.discord,'TextChannel',SimpleNamespace):
            cfg={'review_channel':None,'admin_commands_channel':'','channels':['bad'],'categories':[None,'also-bad']}
            self.assertFalse(support.SupportClient.authorized_channel(None,message,cfg))


class DispatchTests(unittest.IsolatedAsyncioTestCase):
    async def test_mention_runs_agent_and_queues_reply_once(self):
        class Typing:
            async def __aenter__(self):return self
            async def __aexit__(self,*args):pass
        with tempfile.TemporaryDirectory() as tmp:
            store=support.Store(Path(tmp)/'state.db')
            cfg={'categories':[8],'review_channel':'9','staff_roles':['staff']}
            client=support.SupportClient({'guilds':{'1':cfg}},None,store)
            channel=SimpleNamespace(id=7,category_id=8,permissions_for=lambda role:SimpleNamespace(view_channel=False),typing=Typing)
            message=SimpleNamespace(id=100,channel=channel,author=SimpleNamespace(id=12,bot=False),guild=SimpleNamespace(id=1,owner_id=99,default_role=object()),reference=None,content=f'<@{support.BOT_ID}> why my payout?',mentions=[SimpleNamespace(id=support.BOT_ID)],reply=AsyncMock())
            with patch.object(support.discord,'TextChannel',SimpleNamespace),patch.object(client,'automatic_decision',AsyncMock(return_value=False)),patch.object(support,'answer_question',new=AsyncMock(return_value=('Verified answer',{'total_tokens':100},['payout_report']))) as agent:
                await client.on_message(message);await client.on_message(message)
                self.assertEqual(agent.await_count,1)
                row=store.db.execute('SELECT * FROM outbox').fetchone()
                self.assertEqual(row['id'],'reply-100');self.assertEqual(row['channel'],'7')
                self.assertEqual(row['content'],'Verified answer')
                message.id=101;message.mentions=[];message.content="thanks, sounds good"
                await client.on_message(message);self.assertEqual(agent.await_count,1)
                store.enqueue('job-example','7','That step has finished.')
                store.db.execute("UPDATE outbox SET delivered='200' WHERE id='job-example'");store.db.commit()
                message.id=102;message.content='check it';message.reference=SimpleNamespace(message_id=200)
                await client.on_message(message);self.assertEqual(agent.await_count,2)
            store.db.close()

    async def test_automatic_faq_dispatch_and_quiet_skips(self):
        class Typing:
            async def __aenter__(self):return self
            async def __aexit__(self,*args):pass
        with tempfile.TemporaryDirectory() as tmp:
            store=support.Store(Path(tmp)/'state.db')
            cfg={'categories':[8],'review_channel':'9','staff_roles':['77']}
            client=support.SupportClient({'guilds':{'1':cfg}},None,store)
            channel=SimpleNamespace(id=7,category_id=8,permissions_for=lambda role:SimpleNamespace(view_channel=False),typing=Typing)
            message=SimpleNamespace(id=300,channel=channel,author=SimpleNamespace(id=12,bot=False,roles=[]),guild=SimpleNamespace(id=1,owner_id=99,default_role=object()),reference=None,content='Why is my payout lower than expected?',mentions=[],reply=AsyncMock())
            async def decision(m,c):return support.triage.candidate(m,c,support.OWNER_ID)
            with patch.object(support.discord,'TextChannel',SimpleNamespace),patch.object(client,'automatic_decision',decision),patch.object(support,'answer_question',new=AsyncMock(return_value=('Checked report',{},['payout_report']))) as agent:
                await client.on_message(message);await client.on_message(message)
                self.assertEqual(agent.await_count,1)
                self.assertEqual(store.db.execute('SELECT content FROM outbox').fetchone()[0],'Checked report')
                message.id=301;message.author.roles=[SimpleNamespace(id=77)]
                await client.on_message(message)
                message.author.roles=[];message.reference=SimpleNamespace(message_id=999)
                await client.on_message(message)
                message.reference=None;channel.permissions_for=lambda role:SimpleNamespace(view_channel=True)
                await client.on_message(message)
                self.assertEqual(agent.await_count,1)
            store.db.close()

    async def test_nonstaff_cannot_resolve(self):
        with tempfile.TemporaryDirectory() as tmp:
            store=support.Store(Path(tmp)/'state.db')
            client=support.SupportClient({'guilds':{'1':{'review_channel':'9','staff_roles':['staff']}}},None,store)
            message=SimpleNamespace(channel=SimpleNamespace(id=9),author=SimpleNamespace(id=12,bot=False,roles=[]),guild=SimpleNamespace(id=1,owner_id=99),content='!support-resolve 123 it is fixed',reply=AsyncMock())
            await client.on_message(message)
            message.reply.assert_not_awaited()
            store.db.close()


if __name__=='__main__':unittest.main()
