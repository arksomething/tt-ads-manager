import importlib.util,sqlite3,unittest
from pathlib import Path

spec=importlib.util.spec_from_file_location('owned_source',Path(__file__).with_name('owned-earnings-source.py'))
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)

class SourceTests(unittest.TestCase):
    def setUp(self):
        self.db=sqlite3.connect(':memory:')
        self.db.executescript('''
        CREATE TABLE creators(id INTEGER, handle TEXT, native_account_id TEXT, platform TEXT);
        CREATE TABLE videos(id INTEGER,creator_id INTEGER,posted_at INTEGER,platform_video_id TEXT,url TEXT,description TEXT,excluded INTEGER,availability TEXT,platform TEXT);
        CREATE TABLE video_metric_observations(id INTEGER,video_id INTEGER,observed_at INTEGER,source_observed_at INTEGER,source TEXT,confidence TEXT,is_complete INTEGER,views INTEGER,availability TEXT,evidence_manifest_sha256 TEXT);
        CREATE TABLE video_window_finalizations(id INTEGER,video_id INTEGER,finalized_at INTEGER,status TEXT);
        INSERT INTO creators VALUES(1,'renamed','native-one','tiktok'),(2,'other','native-two','tiktok');
        ''')
        for i in range(130):
            self.db.execute('INSERT INTO videos VALUES(?,?,?,?,?,?,?,?,?)',(i,1,1788220800000,str(i),'https://example.test','#yap',0,'available','tiktok'))
            self.db.execute('INSERT INTO video_metric_observations VALUES(?,?,?,?,?,?,?,?,?,?)',(i,i,1788307200000,1788307200000,'owned','direct',1,0,'available','hash'))
        self.db.execute("INSERT INTO videos VALUES(999,2,1788220800000,'other','url','caption',0,'available','tiktok')")
        self.db.execute("INSERT INTO video_metric_observations VALUES(999,0,1788307200000,1788307200000,'viral','provider',1,999999,'available','hash')")
        self.db.commit()
        self.request={'start_date':'2026-09-01','end_date':'2026-09-29','accounts':[{'platform':'tiktok','native_account_id':'native-one'}]}
    def tearDown(self):self.db.close()
    def test_full_inventory_native_identity_and_direct_only(self):
        result=module.export(self.request,self.db)
        self.assertEqual(len(result['videos']),130)
        self.assertEqual(result['accounts'][0]['handle'],'renamed')
        self.assertEqual(result['videos'][0]['observations'][0]['views'],0)
        self.assertEqual(len(result['videos'][0]['observations']),1)
        self.assertNotIn('other',[v['sourceVideoId'] for v in result['videos']])
    def test_missing_identity_and_invalid_dates_fail_closed(self):
        self.request['accounts'][0]['native_account_id']='missing'
        with self.assertRaises(ValueError):module.export(self.request,self.db)
        self.request['end_date']='2027-09-01'
        with self.assertRaises(ValueError):module.export(self.request,self.db)

if __name__=='__main__':unittest.main()
