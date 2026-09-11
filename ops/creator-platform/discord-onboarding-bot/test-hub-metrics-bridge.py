import importlib.util,json,os,sqlite3,tempfile,time,unittest
spec=importlib.util.spec_from_file_location('bridge',os.path.join(os.path.dirname(__file__),'hub-metrics-bridge.py'))
b=importlib.util.module_from_spec(spec);spec.loader.exec_module(b)

class BridgeTests(unittest.TestCase):
 def test_sources_are_separate_and_projection_does_not_write_tracker(self):
  with tempfile.TemporaryDirectory() as d:
   path=os.path.join(d,'tracker.db');b.TRACKER=path;c=sqlite3.connect(path)
   c.executescript('CREATE TABLE creators(id INTEGER,platform TEXT,handle TEXT); CREATE TABLE videos(id INTEGER,creator_id INTEGER,platform_video_id TEXT,platform TEXT,url TEXT,description TEXT,posted_at INTEGER); CREATE TABLE video_metric_observations(id INTEGER,video_id INTEGER,source TEXT,confidence TEXT,observed_at INTEGER,source_observed_at INTEGER,views INTEGER,is_complete INTEGER,availability TEXT);')
   now=int(time.time()*1000)
   c.execute('INSERT INTO creators VALUES(1,?,?)',('tiktok','demo'))
   c.execute('INSERT INTO videos VALUES(1,1,?,?,?,?,?)',('123','tiktok','https://www.tiktok.com/@demo/video/123','Demo',now-86400000))
   for i,source,confidence,views in [(1,'viral_app_provider','provider',100),(2,'tiktok_ytdlp','direct',200),(3,'legacy_shadow','legacy',999),(4,'tiktok_ytdlp','provider',888)]:
    c.execute('INSERT INTO video_metric_observations VALUES(?,1,?,?,?,?,?,1,?)',(i,source,confidence,now+i,None,views,'public'))
   c.commit();before=c.total_changes;c.close()
   data=b.project([{'creator_id':'owner','accounts_json':json.dumps([{'platform':'tiktok','handle':'demo'}])}])
   self.assertEqual({r['provider']:r['views'] for r in data[0]['records']},{'viral':100,'tracker':200})
   with sqlite3.connect(path) as c:self.assertEqual(c.execute('SELECT count(*) FROM video_metric_observations').fetchone()[0],4)
   empty=b.project([{'creator_id':'other','accounts_json':json.dumps([{'platform':'tiktok','handle':'missing'}])}])
   self.assertEqual(empty[0]['records'],[]);self.assertFalse(empty[0]['coverage'][0]['found'])

if __name__=='__main__':unittest.main()
