import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import operations
import support


class ContextTests(unittest.IsolatedAsyncioTestCase):
    async def test_loads_reply_and_verified_deal_before_answering(self):
        def message(mid, text, author='creator'):
            return {'id':mid,'timestamp':'2026-09-13T00:00:00Z',
                    'author':{'id':author,'username':author},'content':text,'attachments':[]}
        current=message('question','eligibility')
        current['message_reference']={'message_id':'parent'}
        parent=message('parent','Can you review https://example.com/my-video?')
        deal=message('deal','Your agreed rate is specific to talking videos.','manager')
        async def get(path):
            if path.endswith('/messages?limit=100') or path.endswith('/messages?limit=25'):return [current,deal]
            if path.endswith('/messages/parent'):return parent
            return {'roles':['staff'] if path.endswith('/manager') else []}
        api=SimpleNamespace(get=AsyncMock(side_effect=get))
        bound=support.SupportTools(api,None,{'staff_roles':['staff']},'1','2','creator','question')
        bound.readable_channel=AsyncMock()
        context=await bound.creator_context()
        self.assertEqual(context['reply_to']['id'],'parent')
        self.assertIn('my-video',context['reply_to']['text'])
        verified=[m for m in context['potential_deal_context']['messages'] if m['id']=='deal']
        self.assertTrue(verified[0]['staff_author_verified'])
        self.assertIn('https://discord.com/channels/1/2/parent',bound.evidence_links)
        self.assertTrue(all('/channels/2/' in call.args[0] or '/guilds/1/' in call.args[0] for call in api.get.await_args_list))

    def test_public_ids_survive_but_credentials_are_redacted(self):
        with tempfile.TemporaryDirectory() as directory:
            home=Path(directory)
            (home/'.hermes').mkdir()
            (home/'.hermes/.env').write_text('DISCORD_GUILD_ID=1400610531189985310\nDISCORD_BOT_TOKEN=super-private-test-token\n')
            with patch.object(operations.Path,'home',return_value=home),patch.object(operations,'REPO',home):
                result=operations.redact('https://discord.com/channels/1400610531189985310/2/3 super-private-test-token')
            self.assertIn('1400610531189985310',result)
            self.assertNotIn('super-private-test-token',result)
            self.assertIn('[REDACTED_SECRET]',result)
