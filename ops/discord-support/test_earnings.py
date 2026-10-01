import unittest
from unittest.mock import AsyncMock,patch
import earnings
import support


class EarningsTests(unittest.IsolatedAsyncioTestCase):
    async def test_unlinked_creator_never_runs_calculator(self):
        with patch.object(earnings,'binding',AsyncMock(return_value=None)),patch.object(earnings.asyncio,'create_subprocess_exec',AsyncMock()) as spawn:
            result=await earnings.estimate('g','c','u','2026-09-01','2026-09-03')
        self.assertEqual(result['status'],'not_linked')
        spawn.assert_not_called()

    async def test_tool_uses_verified_request_identity(self):
        bound=support.SupportTools(None,None,{},'g','c','u','m')
        bound.readable_channel=AsyncMock()
        with patch.object(earnings,'estimate',AsyncMock(return_value={'status':'estimate'})) as estimate:
            await bound.my_earnings('2026-09-01','2026-09-03')
        estimate.assert_awaited_once_with('g','c','u','2026-09-01','2026-09-03')
        bound.readable_channel.assert_awaited_once_with('c')

    async def test_channel_denial_prevents_earnings_read(self):
        bound=support.SupportTools(None,None,{},'g','c','u','m')
        bound.readable_channel=AsyncMock(side_effect=PermissionError())
        with patch.object(earnings,'estimate',AsyncMock()) as estimate:
            with self.assertRaises(PermissionError):await bound.my_earnings('2026-09-01','2026-09-03')
        estimate.assert_not_called()

    def test_invalid_windows(self):
        for start,end in [('2026-09-04','2026-09-03'),('2026-02-30','2026-03-01'),('2026-01-01','2026-09-01')]:
            with self.assertRaises(ValueError):earnings.validate_dates(start,end)

    async def test_verified_admin_gets_operator_tools_not_creators(self):
        api=AsyncMock()
        async def get(path):
            if '/members/' in path:return {'roles':['admin']}
            return [{'id':'admin','permissions':'8'}]
        api.get.side_effect=get
        bound=support.SupportTools(api,None,{'staff_roles':[]},'g','c','u','m')
        self.assertTrue((await bound.authenticate())['operator'])
        api.get.side_effect=None
        api.get.return_value={'roles':[]}
        self.assertFalse((await bound.authenticate())['operator'])
