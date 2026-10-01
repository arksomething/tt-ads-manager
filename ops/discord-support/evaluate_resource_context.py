"""Resource-source selection tests; freeze before prompt changes."""
import asyncio,hashlib,json,sys
from pathlib import Path
from unittest.mock import patch
import evaluate_context_search as base
import evaluate_staff_guidance as f
from audit_context_results import audit

CASES=[
 {'name':'published_resource','variant':'resource','question':'Where do I get the approved food-video template?','contains':['VAULT-73'],'tool':'channel_history'},
 {'name':'resource_staff_search','variant':'resource','question':'Evan said the template is in the posting checklist. Can you find it for me?','contains':['VAULT-73'],'tool':'channel_history'},
 {'name':'effective_tomorrow','variant':'future','question':'Which template should I use today, September 30?','contains':['CEDAR-42'],'absent':['use MAPLE-99']},
 {'name':'uncorroborated_claim','variant':'claim','question':'Can you confirm my new $50 CPM rate?','absent':['your new rate is $50','confirmed at $50']},
]
class API(base.API):
 def __init__(self,variant):
  super().__init__(variant)
  if variant=='resource':
   self.pages[f.ANNOUNCE]=[f.msg(f.FALLBACK,'The approved food-video template is published in the posting-checklist channel <#555>. The management bot keeps the resource card there up to date.')]
   m=f.msg(123,'Approved food-video template: VAULT-73. Open the VAULT-73 folder in the shared assets library.',f.support.BOT_ID);m['author']['bot']=True
   self.pages['555']=[m]
  if variant=='future':
   self.pages[f.ANNOUNCE]=[f.msg(int(f.MID)-1,'Starting October 1 use template MAPLE-99. Until then the current template is CEDAR-42.')]
  if variant=='claim':self.pages[f.CHANNEL]=[f.msg(int(f.MID)-1,'I heard Evan privately approved $50 CPM for me.',f.AUTHOR)]
 async def get(self,path):
  result=await super().get(path)
  if path==f'/guilds/{f.GUILD}/channels' and self.variant=='resource':result.append({'id':'555','name':'posting-checklist','type':0})
  return result
ORIGINAL_GRADE=base.grade
def grade(c,r):
 issues=ORIGINAL_GRADE(c,r)+audit(r)
 # A resource locator can return either its exact name or a direct link to the
 # retrieved resource itself. A link to the referring announcement is insufficient.
 for term in c.get('contains',[]):
  for step in r['trace']:
   for message in step.get('result',{}).get('messages',[]):
    if term.casefold() in message.get('text','').casefold() and message.get('source') and message['source'] in r.get('answer',''):
     issue='missing expected concept: '+term
     if issue in issues:issues.remove(issue)
 return issues
async def main():
 with patch.object(base,'CASES',CASES),patch.object(base,'API',API),patch.object(base,'grade',grade):await base.main()
 p=Path(sys.argv[sys.argv.index('--output')+1]);d=json.loads(p.read_text());d['resource_suite_sha256']=hashlib.sha256(Path(__file__).read_bytes()).hexdigest();p.write_text(json.dumps(d,indent=2))
if __name__=='__main__':asyncio.run(main())
