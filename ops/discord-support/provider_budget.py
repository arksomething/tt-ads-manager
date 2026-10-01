"""Persistent bot-wide provider budgets and response cache, independent of prompts."""
import hashlib
import json
import sqlite3
import time
import operations


class ProviderBudget:
    def __init__(self, path=None):
        self.db=sqlite3.connect(path or operations.STATE/'provider-budget.sqlite3',timeout=10)
        self.db.executescript('''
            CREATE TABLE IF NOT EXISTS requests(provider TEXT, at REAL, kind TEXT);
            CREATE INDEX IF NOT EXISTS requests_at ON requests(provider,at);
            CREATE TABLE IF NOT EXISTS cooldown(provider TEXT PRIMARY KEY, until REAL);
            CREATE TABLE IF NOT EXISTS cache(key TEXT PRIMARY KEY, expires REAL, body TEXT);
            CREATE TABLE IF NOT EXISTS pending(key TEXT PRIMARY KEY, until REAL);
        ''')

    def reserve(self, provider, path, parameters, now=None):
        now=time.time() if now is None else now
        key=hashlib.sha256(json.dumps([provider,path,parameters],sort_keys=True).encode()).hexdigest()
        self.db.execute('BEGIN IMMEDIATE')
        try:
            cached=self.db.execute('SELECT body FROM cache WHERE key=? AND expires>?',(key,now)).fetchone()
            if cached:
                self.db.commit();return key,json.loads(cached[0]),0
            pending=self.db.execute('SELECT until FROM pending WHERE key=? AND until>?',(key,now)).fetchone()
            if pending:
                self.db.commit();return key,None,max(1,int(pending[0]-now)+1)
            last=self.db.execute('SELECT max(at) FROM requests WHERE provider=?',(provider,)).fetchone()[0]
            until=self.db.execute('SELECT until FROM cooldown WHERE provider=?',(provider,)).fetchone()
            wait=max(0,(until[0] if until else 0)-now,(last or 0)+(10 if provider=='singular' else 2)-now)
            for seconds,limit in ((3600,60),(86400,300)):
                count,earliest=self.db.execute('SELECT count(*),min(at) FROM requests WHERE provider=? AND at>?',(provider,now-seconds)).fetchone()
                if count>=limit:wait=max(wait,earliest+seconds-now)
            kind='create' if path.endswith('/create_async_report') else 'read'
            if kind=='create':
                count,earliest=self.db.execute("SELECT count(*),min(at) FROM requests WHERE provider=? AND kind='create' AND at>?",(provider,now-86400)).fetchone()
                if count>=12:wait=max(wait,earliest+86400-now)
            if wait>0:
                self.db.commit();return key,None,max(1,int(wait)+1)
            self.db.execute('INSERT INTO requests VALUES(?,?,?)',(provider,now,kind))
            self.db.execute('INSERT OR REPLACE INTO pending VALUES(?,?)',(key,now+(86400 if kind=='create' else 120)))
            self.db.execute('DELETE FROM requests WHERE at<?',(now-172800,))
            self.db.execute('DELETE FROM cache WHERE expires<?',(now,))
            self.db.commit();return key,None,0
        except BaseException:
            self.db.rollback();raise

    def cache(self,key,result,seconds=900):
        with self.db:
            self.db.execute('INSERT OR REPLACE INTO cache VALUES(?,?,?)',(key,time.time()+seconds,json.dumps(result)))
            self.db.execute('DELETE FROM pending WHERE key=?',(key,))

    def backoff(self,provider,seconds):
        with self.db:self.db.execute('INSERT INTO cooldown VALUES(?,?) ON CONFLICT(provider) DO UPDATE SET until=max(until,excluded.until)',(provider,time.time()+max(60,seconds)))

    def close(self):self.db.close()
