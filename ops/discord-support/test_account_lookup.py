import unittest
from unittest.mock import patch,AsyncMock
import account_lookup as lookup

class AccountLookupTests(unittest.TestCase):
    def setUp(self):
        self.row={'guild_id':'g','discord_user_id':'u','channel_id':'c','platform':'tiktok','handle':'h','native_account_id':'n','active':True,'tracked_videos':1}
        self.match={'platform':'tiktok','native_account_id':'n','links':[{'campaign_creator_id':'cc','organization_id':'org'}]}

    def resolve(self,rows=None,matches=None,verified=None):
        return lookup.resolve(rows if rows is not None else [self.row],matches if matches is not None else [self.match],'g','c','u',verified or {})

    def test_current_match_and_deduplication(self):
        result=self.resolve([self.row,self.row])
        self.assertEqual(len(result['accounts']),1)
        self.assertEqual(result['pending_accounts'],[])

    def test_missing_and_ambiguous_never_guess(self):
        for links in [[],self.match['links']*2]:
            result=self.resolve(matches=[{**self.match,'links':links}])
            self.assertEqual(result['accounts'],[])
            self.assertTrue(result['pending_accounts'])

    def test_owner_conflicts_symmetric(self):
        other={**self.row,'discord_user_id':'other'}
        for rows in [[self.row,other],[other,self.row]]:
            self.assertEqual(self.resolve(rows)['accounts'],[])
        self.assertEqual(self.resolve(verified={'g':{'other':{'accounts':self.match['links']}}})['accounts'],[])

    def test_untracked_and_wrong_channel_denied(self):
        self.assertIsNone(self.resolve([{**self.row,'channel_id':'elsewhere'}]))
        self.assertEqual(self.resolve([{**self.row,'tracked_videos':0}])['accounts'],[])

    def test_changed_records_immediately_visible(self):
        self.assertTrue(self.resolve()['accounts'])
        self.assertEqual(self.resolve(matches=[])['accounts'],[])

class OnDemandTests(unittest.IsolatedAsyncioTestCase):
    async def test_each_request_reads_current_data(self):
        row={'guild_id':'1245112089647775877','discord_user_id':'u','channel_id':'c','platform':'tiktok','handle':'h'}
        with patch.object(lookup,'read_json',AsyncMock(side_effect=[[row],[],[row],[]])) as read:
            for _ in range(2):
                result=await lookup.lookup(row['guild_id'],'c','u',{})
                self.assertTrue(result['pending_accounts'])
        self.assertEqual(read.await_count,4)

    async def test_other_guild_does_not_read_test_accounts(self):
        with patch.object(lookup,'read_json',AsyncMock()) as read:
            self.assertIsNone(await lookup.lookup('production','c','u',{}))
        read.assert_not_called()
