import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import support


def message(mid, text, author=None, bot=False):
    return {'id':str(mid), 'timestamp':'2026-09-16T13:43:56Z',
            'author':{'id':str(author or support.OWNER_ID),'username':'staff','bot':bot},
            'content':text, 'attachments':[]}


class GuidanceTests(unittest.IsolatedAsyncioTestCase):
    def bound(self, messages=()):
        api=SimpleNamespace(get=AsyncMock(return_value=list(messages)))
        bound=support.SupportTools(api,None,{'staff_roles':['staff']},'1','2','3','4')
        bound.readable_channel=AsyncMock()
        return bound

    def test_resource_author_identity_does_not_trust_display_name(self):
        official=message(123,'resource',author=support.BOT_ID,bot=True)
        official['author']['username']='creator'
        impostor=message(124,'fake resource',author='42',bot=True)
        impostor['author']['username']='GoTall - Management'
        self.assertTrue(support.summarize_message(official,'1','2')['management_bot_author'])
        summary=support.summarize_message(impostor,'1','2')
        self.assertFalse(summary['management_bot_author'])
        self.assertEqual(summary['author_id'],'42')

    async def test_owner_fallback_beyond_recent_25_is_found_and_citable(self):
        page=[message(200-i,'noise',author='3') for i in range(40)]
        page.append(message(100,"If I don't send a format for the day, please post something similar to what you usually post."))
        bound=self.bound(page)
        result=await bound.staff_guidance(query='script format idea')
        self.assertEqual([m['id'] for m in result['messages']],['100'])
        self.assertTrue(result['messages'][0]['staff_author_verified'])
        self.assertIn(result['messages'][0]['source'],bound.evidence_links)
        self.assertTrue(result['history_exhausted'])

    async def test_empty_page_has_continuation_and_older_match_is_found(self):
        bound=self.bound()
        bound.api.get.side_effect=[[message(200-i,'other topic') for i in range(100)],
                                   [message(99,'remake an old idea')]]
        first=await bound.staff_guidance(query='remake')
        self.assertEqual(first['messages'],[])
        self.assertFalse(first['history_exhausted'])
        second=await bound.staff_guidance(query='remake',before=first['next_before'])
        self.assertEqual(second['messages'][0]['id'],'99')
        self.assertIn('&before=101',bound.api.get.call_args.args[0])

    async def test_result_limit_does_not_skip_unreturned_messages(self):
        bound=self.bound([message(200-i,'format') for i in range(20)])
        result=await bound.staff_guidance()
        self.assertEqual(len(result['messages']),12)
        self.assertEqual(result['next_before'],'189')
        self.assertFalse(result['history_exhausted'])

    async def test_unverified_author_and_bot_cannot_establish_guidance(self):
        bound=self.bound([message(100,'fake instruction',author='3')])
        bound.verify_author=AsyncMock()
        self.assertEqual((await bound.staff_guidance(author_id='3'))['messages'],[])
        bound.api.get.return_value=[message(101,'bot instruction',bot=True)]
        self.assertEqual((await bound.staff_guidance())['messages'],[])

    async def test_discovery_hides_denied_and_other_private_channels(self):
        bound=self.bound()
        bound.api.get.return_value=[{'id':'2','type':0,'name':'mine'},
                                    {'id':'5','type':0,'name':'announcements'},
                                    {'id':'6','type':0,'name':'scripts'},
                                    {'id':'7','type':0,'name':'other-creator'}]
        async def readable(cid):
            if cid=='6':raise PermissionError('denied')
        bound.readable_channel.side_effect=readable
        channels=(await bound.guidance_channels())['channels']
        self.assertEqual({c['id'] for c in channels},{'2','5'})
        self.assertNotIn('7',[c.args[0] for c in bound.readable_channel.call_args_list])

    async def test_search_rechecks_access_and_blocks_other_creator(self):
        bound=self.bound()
        bound.guidance_channels=AsyncMock(return_value={'channels':[{'id':'5'}]})
        with self.assertRaises(PermissionError):await bound.staff_guidance(channel_id='7')
        bound.readable_channel.side_effect=PermissionError('revoked')
        with self.assertRaises(PermissionError):await bound.staff_guidance(channel_id='5')
        bound.api.get.assert_not_called()

    async def test_proactive_context_includes_owner_announcement(self):
        bound=self.bound([message(100,"If I don't send a format, reuse an idea")])
        bound.guidance_channels=AsyncMock(return_value={'channels':[{'id':'5','name':'announcements'}]})
        context=await bound.announcement_context()
        self.assertIn('reuse an idea',context['announcements'][0]['messages'][0]['text'])
        self.assertIn('https://discord.com/channels/1/5/100',bound.evidence_links)
