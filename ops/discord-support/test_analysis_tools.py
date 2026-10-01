import unittest
from unittest.mock import patch
import analysis_tools


class DailyTests(unittest.IsolatedAsyncioTestCase):
    async def test_window_fetches_metadata_once_and_keeps_missing_days(self):
        calls=[]
        async def query(service,path,parameters=None,**kwargs):
            calls.append(path)
            if '/videos/tiktok/' in path:
                return {'verified':True,'result':{'orgAccountId':'account','platformVideoId':'123'}}
            if parameters['dateRange[from]']=='2026-09-10':return {'verified':False}
            return {'verified':True,'result':[{'platformVideoId':'123','viewCountInPeriod':12}]}
        with patch.object(analysis_tools.services,'query',query):
            result=await analysis_tools.video_metrics('https://www.tiktok.com/@a/video/123',day='2026-09-09',end_day='2026-09-10')
        self.assertEqual(len(calls),3)
        self.assertEqual([r['viewCountInPeriod'] for r in result['daily']],[12,None])

    async def test_large_daily_result_is_filtered_before_model_output(self):
        async def query(service,path,parameters=None,**kwargs):
            if '/videos/tiktok/' in path:
                return {'verified':True,'result':{'orgAccountId':'account','platformVideoId':'123'}}
            self.assertTrue(kwargs.get('preserve_structure'))
            return {'verified':True,'result':[{'platformVideoId':'other','caption':'x'*20000},{'platformVideoId':'123','viewCountInPeriod':456}]}
        with patch.object(analysis_tools.services,'query',query):
            result=await analysis_tools.video_metrics('https://www.tiktok.com/@a/video/123',day='2026-09-10')
        self.assertEqual(result['daily']['viewCountInPeriod'],456)
        self.assertNotIn('other',str(result))


class AnalysisTests(unittest.TestCase):
    def test_public_video_url_only(self):
        self.assertEqual(analysis_tools.video_id('https://www.tiktok.com/@a/video/123'),'123')
        for url in ('http://localhost/video/123','https://tiktok.com.evil.test/@a/video/123','https://www.tiktok.com/@a/video/1;rm'):
            with self.assertRaises(ValueError):analysis_tools.video_id(url)

    def test_business_indices_do_not_disclose_counts(self):
        result=analysis_tools.indexed_rows([{'date':'2026-09-01','purchases':40,'trials':20},{'date':'2026-09-02','purchases':60,'trials':20}])
        self.assertEqual(result['daily'][0]['purchases_index'],80)
        self.assertEqual(result['daily'][1]['purchases_index'],120)
        self.assertNotIn('purchases',result['daily'][0])
        self.assertNotIn('trials',result['daily'][0])
        self.assertIsNone(analysis_tools.indexed_rows([{'date':'d','purchases':0,'trials':0}])['daily'][0]['purchases_index'])
