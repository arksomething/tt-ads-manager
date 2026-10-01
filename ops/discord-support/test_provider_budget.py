import tempfile
import unittest
from pathlib import Path
from provider_budget import ProviderBudget


class ProviderBudgetTests(unittest.TestCase):
    def test_cache_and_spacing_survive_new_connections(self):
        with tempfile.TemporaryDirectory() as d:
            path=Path(d)/'budget.db'
            first=ProviderBudget(path)
            key,cached,wait=first.reserve('singular','status',{'report_id':'1'},now=1000)
            self.assertEqual(wait,0)
            second=ProviderBudget(path)
            self.assertGreater(second.reserve('singular','status',{'report_id':'2'},now=1001)[2],0)
            self.assertGreater(second.reserve('singular','status',{'report_id':'1'},now=1015)[2],0)
            first.cache(key,{'verified':True})
            self.assertEqual(second.reserve('singular','status',{'report_id':'1'},now=1001)[1],{'verified':True})
            first.close();second.close()

    def test_tiktok_hourly_limit_and_provider_independence(self):
        with tempfile.TemporaryDirectory() as d:
            b=ProviderBudget(Path(d)/'budget.db')
            for i in range(60):self.assertEqual(b.reserve('tiktok','report',{'page':i},now=1000+3*i)[2],0)
            self.assertGreater(b.reserve('tiktok','report',{'page':61},now=1300)[2],0)
            self.assertEqual(b.reserve('singular','status',{},now=1300)[2],0)
            b.close()

    def test_report_creation_daily_cap_survives_restart(self):
        with tempfile.TemporaryDirectory() as d:
            path=Path(d)/'budget.db';b=ProviderBudget(path)
            for i in range(12):self.assertEqual(b.reserve('singular','/create_async_report',{'day':i},now=1000+i*20)[2],0)
            b.close();b=ProviderBudget(path)
            self.assertGreater(b.reserve('singular','/create_async_report',{'day':13},now=2000)[2],0)
            b.backoff('tiktok',120)
            self.assertGreater(b.reserve('tiktok','report',{})[2],0)
            b.close()
