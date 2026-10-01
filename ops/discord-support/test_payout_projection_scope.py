import importlib.util,json,unittest
from pathlib import Path
from unittest.mock import patch
from types import SimpleNamespace
spec=importlib.util.spec_from_file_location('payout_projection',Path(__file__).parents[1]/'creator-platform/discord-onboarding-bot/hub-payout-export.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)

class ProjectionScopeTests(unittest.TestCase):
    def test_payout_projection_uses_verified_ids_not_handles(self):
        def read(path,*args,**kwargs):
            if str(path).endswith('gotall-discord-deal-bindings.json'):
                return json.dumps({'owner':{'campaign_creator_id':'verified-cc','organization_id':'org'}})
            return 'DATABASE_URL=postgresql://user:password@localhost/db'
        with patch.object(module.Path,'read_text',read),patch.object(module.subprocess,'run',return_value=SimpleNamespace(returncode=0,stdout='[]\n[]\n[]')) as run:
            result=module.export([{'creator_id':'owner','accounts_json':'[]'},{'creator_id':'unverified','accounts_json':'[]'}])
        sql=run.call_args.kwargs['input']
        self.assertIn('verified-cc',sql)
        self.assertIn('p."organizationId"=m.organization_id',sql)
        self.assertIn('cc.id=m.campaign_creator_id',sql)
        self.assertNotIn('CreatorPlatformAccount',sql)
        self.assertNotIn('unverified',sql)
        self.assertEqual(result['records'],[])
