import importlib.util, unittest, tempfile, sqlite3, os
spec=importlib.util.spec_from_file_location('bridge',os.path.join(os.path.dirname(__file__),'tracker-bridge.py'));b=importlib.util.module_from_spec(spec);spec.loader.exec_module(b)
class BridgeTests(unittest.TestCase):
    def row(self,**kw):return dict(attempted_at=100,completed_at=200,status='error',source='tiktok_ytdlp',error_code='YTDLP_PRIVATE_PROFILE',message='',**kw)
    def test_private(self):self.assertEqual(b.classify(self.row(),300),'private')
    def test_transient(self):
        for code in ['YTDLP_HTTP_ERROR','YTDLP_AUTH_REQUIRED','YTDLP_BLOCKED','YTDLP_PROCESS_FAILED','DISCOVERY_FAILED']:
            row=self.row();row['error_code']=code;self.assertIsNone(b.classify(row,300))
    def test_tombstone(self):
        row=self.row();row.update(error_code='YTDLP_NOT_FOUND',message='HTTP 404');self.assertIsNone(b.classify(row,300))
        row['message']='status_deleted';self.assertEqual(b.classify(row,300),'unavailable')
    def test_stale(self):self.assertIsNone(b.classify(self.row(),49*3600000))
    def test_recovery(self):
        row=self.row();row['status']='complete';self.assertEqual(b.classify(row,300),'healthy')
    def test_urls(self):
        self.assertEqual(b.account('https://www.instagram.com/test/'),('instagram','test'))
        for url in ['https://example.com','https://instagram.com/reel/test/']:
            with self.assertRaises(ValueError):b.account(url)
    def test_notification_episode(self):
        with tempfile.TemporaryDirectory() as folder:
            old=b.BOT;b.BOT=os.path.join(folder,'bot.db')
            try:
                with sqlite3.connect(b.BOT) as db:
                    db.executescript('CREATE TABLE creators(discord_user_id TEXT,stage TEXT,first_video_approved_at TEXT,campaign_accounts TEXT,channel_id TEXT,status_message_id TEXT); CREATE TABLE deliveries(id TEXT PRIMARY KEY,channel_id TEXT,payload TEXT,created_at TEXT);')
                    db.execute('INSERT INTO creators VALUES (?,?,?,?,?,?)',('123','hub_ready','2026-09-10','https://www.tiktok.com/@test','channel','card'))
                r=dict(discord_user_id='123',platform='tiktok',handle='test',account_id=1,active=True,state='private',evidence=1)
                b.ingest([r]);r['evidence']=2;b.ingest([r])
                with sqlite3.connect(b.BOT) as db:self.assertEqual(db.execute('SELECT count(*) FROM deliveries').fetchone()[0],1)
                r['state']=None;b.ingest([r])
                r.update(state='healthy',evidence=3);b.ingest([r]);b.ingest([r])
                with sqlite3.connect(b.BOT) as db:self.assertEqual(db.execute('SELECT count(*) FROM deliveries').fetchone()[0],2)
                r.update(state='private',evidence=4);b.ingest([r])
                with sqlite3.connect(b.BOT) as db:self.assertEqual(db.execute('SELECT count(*) FROM deliveries').fetchone()[0],3)
            finally:b.BOT=old
unittest.main()
