"""Eval cases adapted from audited historical bot conversations, not live mutations.
Source message IDs identify observed failures. Context snippets are deliberately
minimal fixtures; not a reconstruction of historical permissions/edited messages.
"""
import asyncio,hashlib,json,sys,re
from pathlib import Path
from unittest.mock import patch
import support
import evaluate_context_search as base
import evaluate_staff_guidance as f
from audit_context_results import audit

CASES=[
 {'name':'known_instagram_handle','source':'1550335256505225248','variant':'handle','operator':True,'question':'please add that insta account to the system','context':['@as.tallasdrago - insta'],'identify':'as.tallasdrago'},
 {'name':'cpm_arithmetic','source':'1548509016941133895','variant':'plain','question':'what is the pay per view thingy? like for ex "100 for 100k?"','cpm':True,'no_escalation':True},
 {'name':'carryover_window','source':'1548509202593480887','variant':'plain','question':"what if this month I don't have 1k views on each of my vids but next month they do reach 1k",'contains':['seven'],'no_escalation':True},
 {'name':'invoice_workflow','source':'1548621987738550283','variant':'plain','question':'for the payment you want me to send a invoice of the current vids i already posted for this months ?','no_escalation':True},
 {'name':'unwatched_example','source':'1548719459127132292','variant':'audio','question':"The example video says ‘he was so sad’, i just checked again and can’t find ‘pranking my brother that he is not gonna reach 6’0’ anywhere",'no_media_claim':True},
]
class API(base.API):
 def __init__(self,variant):
  super().__init__(variant)
  if variant=='handle':self.pages[f.CHANNEL]=[f.msg(int(f.MID)-1,'@as.tallasdrago - insta',f.AUTHOR)]
  if variant=='audio':self.pages[f.CHANNEL]=[
   f.msg(int(f.MID)-1,'The sound should have been "pranking my brother that he is not gonna reach 6 foot" not "he was so sad".'),
   f.msg(int(f.MID)-2,'Original format instructions: use the whispering TikTok AI voiceover. Follow the pacing and structure of the finished example: https://drive.google.com/file/d/reference-unavailable/view')]
ORIGINAL_ANSWER=support.answer_question
async def answer(*args,**kwargs):
 args=list(args)
 if base.CASE.get().get('operator'):args[5]=str(support.OWNER_ID)
 return await ORIGINAL_ANSWER(*args,**kwargs)
ORIGINAL_GRADE=base.grade
def grade(c,r):
 issues=ORIGINAL_GRADE(c,r)+audit(r);ans=r.get('answer','').replace('**','');trace=r['trace']
 if c.get('identify') and c['identify'] not in ans:issues.append('did not identify supplied handle')
 if c.get('identify') and re.search(r'(?:please (?:send|provide)|still need|need you to).{0,35}(?:handle|profile link)',ans,re.I):issues.append('asked again for supplied handle')
 if c.get('no_escalation') and any(t['tool']=='open_support_case' for t in trace):issues.append('unnecessary escalation for explainable general question')
 if c.get('cpm'):
  if not re.search(r'(?:\$1(?:\.00)?|1 dollar)\s*(?:per|for|/)\s*(?:1,?000|1k)\b',ans,re.I):issues.append('missing correct hypothetical CPM calculation')
  if not re.search(r'example|hypothetical|if|not.{0,35}(?:rate|deal)|actual|agreed',ans,re.I):issues.append('hypothetical rate presented without qualification')
 if c['name']=='invoice_workflow' and not re.search(r"(?:no|not|don.t|isn.t|aren.t|without).{0,65}invoice|invoice.{0,40}(?:not required|not needed|unnecessary)",ans,re.I):issues.append('missing current invoice workflow answer')
 if c.get('no_media_claim'):
  if re.search(r"(?:you.re right.{0,25}mismatch|(?:I|we) (?:watched|checked|heard|verified|confirmed).{0,35}(?:video|audio|example)|(?:^|[.!?]\s+)(?:the )?(?:video|example) (?:does|clearly|actually) (?:say|contain|show))",ans,re.I):issues.append('unsupported media agreement or observation')
  if not re.search(r"(?:can.t|cannot|haven.t|not|unable).{0,45}(?:verify|verified|watch|watched|inspect|confirm)|(?:you|your).{0,25}(?:report|describ|check)",ans,re.I):issues.append('missing attribution or media uncertainty')
 return issues
async def main():
 with patch.object(base,'CASES',CASES),patch.object(base,'API',API),patch.object(base,'grade',grade),patch.object(support,'answer_question',answer):await base.main()
 p=Path(sys.argv[sys.argv.index('--output')+1]);d=json.loads(p.read_text());d['observed_suite_sha256']=hashlib.sha256(Path(__file__).read_bytes()).hexdigest();p.write_text(json.dumps(d,indent=2))
if __name__=='__main__':asyncio.run(main())
