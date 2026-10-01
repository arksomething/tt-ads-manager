import unittest
from unittest.mock import AsyncMock,patch
import support
import earnings


class CreatorRecordTests(unittest.IsolatedAsyncioTestCase):
    async def test_non_admin_cannot_publish(self):
        bound=support.SupportTools(None,None,{},'g','c','u','m')
        bound.require_staff_data_channel=AsyncMock(return_value={'administrator':False})
        with patch.object(support.creator_records,'request',AsyncMock()) as request:
            with self.assertRaises(PermissionError):await bound.publish_creator_deal('cc','deal','version',{})
        request.assert_not_called()

    async def test_admin_identity_and_version_forwarded(self):
        bound=support.SupportTools(None,None,{},'g','c','u','m')
        identity={'administrator':True,'user_id':'u'}
        bound.require_staff_data_channel=AsyncMock(return_value=identity)
        with patch.object(support.creator_records,'request',AsyncMock(return_value={'status':'published'})) as request:
            await bound.publish_creator_deal('cc','d','v',{'cpmAmount':'2'})
        payload,actual=request.call_args.args
        self.assertEqual(actual,identity)
        self.assertEqual(payload['expected_version_id'],'v')

    async def test_combined_accounts_all_required(self):
        linked={'accounts':[{'campaign_creator_id':'one'},{'campaign_creator_id':'two'}]}
        with patch.object(earnings,'binding',AsyncMock(return_value=linked)),patch.object(earnings,'calculate',AsyncMock(side_effect=[{'status':'estimate','earnings':{'totalPay':1}},{'status':'unavailable'}])):
            result=await earnings.estimate('g','c','u','2026-09-01','2026-09-03')
        self.assertEqual(result['status'],'unavailable')
        self.assertNotIn('accounts',result)
