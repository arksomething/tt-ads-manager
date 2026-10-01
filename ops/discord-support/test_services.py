import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import httpx
import services
import support


class ServiceTests(unittest.IsolatedAsyncioTestCase):
    async def test_legacy_database_not_exposed_or_queried(self):
        self.assertNotIn('supabase', services.providers())
        self.assertNotIn('supabase', [p['name'] for p in services.catalog()['providers']])
        with patch.object(services.httpx,'AsyncClient') as client:
            with self.assertRaisesRegex(ValueError, 'Legacy database browsing is retired'):
                await services.query('supabase','/rest/v1/Video')
            client.assert_not_called()

    async def test_broker_uses_fixed_origin_and_does_not_follow_redirects(self):
        seen=[]
        def handle(request):
            seen.append(request)
            return httpx.Response(302,headers={'location':'https://attacker.example/'})
        client=httpx.AsyncClient(transport=httpx.MockTransport(handle),follow_redirects=False)
        with patch.object(services,'providers',return_value={'viral':('https://api.example/v1',{'x-api-key':'private'},'GET')}),patch.object(services.httpx,'AsyncClient',return_value=client):
            result=await services.query('viral','/accounts/tracked',{'limit':1})
        self.assertFalse(result['verified']);self.assertEqual(len(seen),1)
        self.assertEqual(str(seen[0].url),'https://api.example/v1/accounts/tracked?limit=1')
        self.assertNotIn('private',json.dumps(result))

    async def test_rejects_origin_escape_and_action_routes(self):
        with patch.object(services,'providers',return_value={'viral':('https://api.example',{'x-api-key':'private'},'GET')}):
            for path in ['https://attacker.example/','//attacker.example/','/../secret','/%2e%2e/','/accounts/delete','/accounts?token=private']:
                with self.assertRaises(ValueError):await services.query('viral',path)

    def test_response_credentials_removed(self):
        self.assertEqual(services.clean({'rows':[{'api_key':'unknown-secret','views':12}]}),{'rows':[{'api_key':'[REDACTED_SECRET]','views':12}]})

    async def test_nonoperators_and_creator_channels_cannot_query_business_data(self):
        api=SimpleNamespace(get=AsyncMock(return_value={'roles':[]}))
        cfg={'staff_roles':['staff'],'operators':['operator'],'review_channel':'staff-review'}
        b=support.SupportTools(api,None,cfg,'g','staff-review','creator','m')
        with patch.object(services,'query',new=AsyncMock()) as query:
            with self.assertRaises(PermissionError):await b.service_query('viral','/accounts')
            query.assert_not_awaited()
            b.author='operator';b.channel='creator-channel';api.get.return_value={'roles':['staff']}
            with self.assertRaises(PermissionError):await b.service_query('viral','/accounts')
            query.assert_not_awaited()
            b.channel='staff-review'
            with tempfile.TemporaryDirectory() as directory,patch.object(support,'STATE',Path(directory)):
                query.return_value={'verified':True,'result':[]}
                self.assertTrue((await b.service_query('viral','/accounts'))['verified'])
            query.assert_awaited_once()
            cfg['admin_commands_channel']='admin-commands'
            b.channel='admin-commands'
            with tempfile.TemporaryDirectory() as directory,patch.object(support,'STATE',Path(directory)):
                self.assertTrue((await b.service_query('viral','/accounts'))['verified'])

    async def test_reports_use_fixed_engine_and_deduplicate_without_delivery(self):
        result={'status':'preliminary','summary':{'amount':10}}
        proc=SimpleNamespace(communicate=AsyncMock(return_value=(json.dumps(result).encode(),b'')),returncode=0)
        with tempfile.TemporaryDirectory() as directory,patch.object(services.operations,'STATE',Path(directory)),patch.object(services.asyncio,'create_subprocess_exec',new=AsyncMock(return_value=proc)) as spawn:
            first=await services.report('creator-id','2026-09',{'user_id':'operator','source_message':'m'})
            second=await services.report('creator-id','2026-09',{'user_id':'operator','source_message':'m'})
            self.assertEqual(first,second);spawn.assert_awaited_once()
            self.assertTrue(spawn.call_args.args[1].endswith('/report-runner.mjs'))
            self.assertEqual(json.loads(proc.communicate.call_args.args[0]),{'campaign_creator_id':'creator-id','month':'2026-09'})
            with self.assertRaises(ValueError):await services.report('../escape','2026-09',{})
