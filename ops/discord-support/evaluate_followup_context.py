"""Second frozen suite: conversational continuity and evidence applicability.
All source reads use fixtures; mutation tools stay intercepted by the base harness.
"""
import asyncio,hashlib,json,sys
from pathlib import Path
from unittest.mock import patch
import support
import evaluate_context_search as base
import evaluate_staff_guidance as f
from audit_context_results import audit

CASES=[
 {'name':'estimate_not_transfer','variant':'normal','prior':('My September 1–16 estimate?','Your estimated earnings for September 1–16 are $84.25 USD. This is not proof of transfer.'),'question':'So has that been paid?','absent':['has been paid','already paid'],'max_calls':1},
 {'name':'stale_bot_correction','variant':'fresh_rule','prior':('No script today?','You must wait for Evan. Old ideas cannot be reused.'),'question':'Are you sure? Can you check what Evan said?','contains':['remake'],'absent':['must wait'],'max_calls':2},
 {'name':'expired_exception','variant':'expired','question':'What asset pack should I use today, September 30?','contains':['CEDAR-42']},
 {'name':'tentative_status','variant':'tentative','question':'Is my account definitely connected already?','absent':['definitely connected','confirmed your account is connected']},
 {'name':'resolved_lookup','variant':'normal','prior':('My earnings for September 1 through 16?','Your account lookup is unavailable, so I cannot calculate an amount.'),'question':'Try checking those same dates again please.','contains':['84.25'],'tool':'my_earnings'},
 {'name':'two_part_request','variant':'normal','question':'When is payment, and what did I earn September 1 through 16?','contains':['2nd','84.25'],'tool':'my_earnings','max_calls':1},
 {'name':'clarified_followup','variant':'normal','prior':('payment','Do you mean the usual payment schedule or whether your transfer was sent?'),'question':'the usual schedule','contains':['2nd'],'max_calls':0},
 {'name':'pending_case','variant':'pending','prior':('My account lookup failed.','Case 123 is awaiting staff investigation; no fix is confirmed.'),'question':'Any update on that?','contains':['pending'],'absent':['resolved','fixed now'],'max_calls':1},
]
class API(base.API):
 def __init__(self,variant):
  super().__init__(variant)
  if variant=='fresh_rule':self.pages[f.CHANNEL]=[f.msg(int(f.MID)-1,'If no new script arrives, remake one of your usual formats with fresh footage and keep the plug guidelines.')]
  if variant=='expired':
   self.pages[f.ANNOUNCE]=[f.msg(f.FALLBACK,'The standard asset pack for food clips is CEDAR-42.')]
   self.pages[f.CHANNEL]=[f.msg(int(f.MID)-1,'For September 29 only, use BIRCH-17. This one-day exception expires at the end of September 29; from September 30 use the standard pack again.')]
  if variant=='tentative':self.pages[f.CHANNEL]=[f.msg(int(f.MID)-1,'Your account should be connected, but I have not checked the authorization dashboard yet.')]
class Store(support.Store):
 def __init__(self,path):
  super().__init__(path);c=base.CASE.get()
  if c.get('prior'):
   self.admit('90',f.GUILD,f.CHANNEL,f.AUTHOR,c['prior'][0]);self.finish('90',c['prior'][1],{})
  if c['variant']=='pending':
   self.db.execute('INSERT INTO cases(id,guild,channel,author,topic,details,source,created) VALUES(?,?,?,?,?,?,?,?)',('123',f.GUILD,f.CHANNEL,f.AUTHOR,'account','Account lookup unavailable. Staff investigation is pending; no resolution recorded.','90',1));self.db.commit()
ORIGINAL_GRADE=base.grade
def grade(c,r):
 issues=ORIGINAL_GRADE(c,r)+audit(r)
 if c['name']=='resolved_lookup':
  calls=[t for t in r['trace'] if t['tool']=='my_earnings']
  if not calls or calls[0]['args']!={'start_date':'2026-09-01','end_date':'2026-09-16'}:issues.append('did not retain requested dates')
 if c['name']=='pending_case' and any(t['tool']=='open_support_case' for t in r['trace']):issues.append('duplicate case attempted')
 return issues
async def main():
 with patch.object(base,'CASES',CASES),patch.object(base,'API',API),patch.object(base,'grade',grade),patch.object(support,'Store',Store):await base.main()
 path=Path(sys.argv[sys.argv.index('--output')+1]);d=json.loads(path.read_text());d['followup_suite_sha256']=hashlib.sha256(Path(__file__).read_bytes()).hexdigest();path.write_text(json.dumps(d,indent=2))
if __name__=='__main__':asyncio.run(main())
