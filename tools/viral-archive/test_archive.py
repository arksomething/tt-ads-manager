import importlib.util,json,sqlite3,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('archive',Path(__file__).with_name('archive.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

class ArchiveTests(unittest.TestCase):
    def test_null_provider_ids_do_not_collapse_distinct_videos(self):
        rows=[{'id':None,'platform':'tiktok','platformVideoId':str(i)} for i in range(3)]
        self.assertEqual(len({m.entity_identity(r) for r in rows}),3)

    def test_metrics_merges_all_fields_in_six_field_chunks_without_filling_missing(self):
        a=object.__new__(m.Archive);a.spec={'paths':{'template':{'get':{'parameters':[{'name':'metrics','schema':{'items':{'enum':['a','b','c','d','e','f','g']}}}]}}}}
        calls=[]
        def request(path,params):
            calls.append(params)
            return {'dailyMetrics':[{'date':'2026-01-01',**({'a':0,'b':None} if len(calls)==1 else {'g':7})}]}
        a.request=request
        result=a.metrics('/video/metrics','template')
        self.assertEqual(len(calls),2);self.assertEqual(calls[1]['metrics[0]'],'g')
        self.assertEqual(result['dailyMetrics'],[{'date':'2026-01-01','a':0,'b':None,'g':7}])

    def test_total_based_pagination_does_not_stop_after_first_page(self):
        with tempfile.TemporaryDirectory() as d,patch.object(m,'ROOT',Path(d)):
            a=object.__new__(m.Archive);a.db=sqlite3.connect(':memory:')
            a.db.executescript('create table collections(name,expected_rows,exported_rows,unique_rows,file);create table entities(collection,identity,payload_json);')
            calls=[]
            def request(path,params):
                calls.append(params['page']);return {'total':101,'data':[{'id':str(i)} for i in (range(100) if params['page']==1 else [100])]}
            a.request=request;rows=a.collection('/payouts/paid')
            self.assertEqual(calls,[1,2]);self.assertEqual(len(rows),101)

    def test_unknown_response_shape_fails_visibly(self):
        a=object.__new__(m.Archive);a.request=lambda *args:{'unexpectedRows':[{'id':'x'}]}
        with self.assertRaisesRegex(RuntimeError,'Unexpected collection schema'):a.collection('/videos')

if __name__=='__main__':unittest.main()
