import unittest
from unittest.mock import AsyncMock
from types import SimpleNamespace
from pathlib import Path
import tempfile
import support, diagnostics
import evaluate_observed_quality as observed
from audit_context_results import audit

class GradingTests(unittest.TestCase):
 def result(self,answer,trace=None):return {'answer':answer,'trace':trace or []}
 def test_handle_must_be_in_answer(self):
  c=observed.CASES[0]
  self.assertTrue(observed.grade(c,self.result('What is your handle?', [{'tool':'channel_history','args':{},'result':{'text':c['identify']}}])))
 def test_cpm_requires_actual_calculation(self):
  c=observed.CASES[1]
  self.assertTrue(observed.grade(c,self.result('You asked about 100k.')))
  self.assertFalse(observed.grade(c,self.result('In your example, $1 per 1,000 views. Your actual rate depends on your agreement.')))
 def test_invoice_requires_answer(self):
  self.assertTrue(observed.grade(observed.CASES[3],self.result('Ask Evan.')))
 def test_media_agreement_fails(self):
  self.assertTrue(observed.grade(observed.CASES[4],self.result("You're right to flag the mismatch.")))
 def test_unperformed_escalation_fails(self):
  self.assertTrue(audit(self.result('I asked Managers to check.')))
  self.assertTrue(audit(self.result("I've flagged this for review.")))
 def test_cached_failure_is_not_network_retry(self):
  trace=[{'tool':'staff_guidance','args':{},'result':{'error':'offline'}},{'tool':'channel_history','args':{},'result':{'error':'offline','cached_failure':True}}]
  self.assertFalse(audit(self.result('Unavailable.',trace)))
 def test_diagnostics_exclude_test_and_eval_data(self):
  with tempfile.TemporaryDirectory() as d:
   root=Path(d);(root/'ops').mkdir()
   for name in ['support.py','test_support.py','evaluate_observed_quality.py']:(root/'ops'/name).write_text('value="private example"')
   self.assertEqual([p.name for p in diagnostics.source_files(root)],['support.py'])

class RetrievalTests(unittest.IsolatedAsyncioTestCase):
 def bound(self):
  b=support.SupportTools(SimpleNamespace(get=AsyncMock()),None,{'staff_roles':['staff']},'1','2','3','4')
  b.readable_channel=AsyncMock();return b
 async def test_failed_channel_is_not_retried_across_tools(self):
  b=self.bound();b.api.get.side_effect=RuntimeError('offline')
  with self.assertRaises(RuntimeError):await b.staff_guidance()
  second=await b.channel_history()
  self.assertTrue(second['cached_failure']);self.assertEqual(b.api.get.await_count,1)
 async def test_any_verified_staff(self):
  b=self.bound()
  b.api.get.return_value=[{'id':'9','author':{'id':'8'},'content':'Approved pack','timestamp':'2026-09-29','attachments':[]}]
  async def verify(m):m['member']={'roles':['staff']}
  b.verify_author=verify
  r=await b.staff_guidance(author_id='staff')
  self.assertTrue(r['messages'][0]['staff_author_verified'])

 async def test_configured_guidance_discovered_without_name_pattern(self):
  b=self.bound();b.cfg['guide_channels']=['8']
  b.api.get.return_value=[{'id':'8','name':'creator-hub','type':0}]
  self.assertEqual((await b.guidance_channels())['channels'],[{'id':'8','name':'creator-hub'}])
 async def test_proactive_failure_blocks_later_history_read(self):
  b=self.bound();b.guidance_channels=AsyncMock(return_value={'channels':[{'id':'2','name':'announcements'}]})
  b.api.get.side_effect=RuntimeError('offline')
  context=await b.announcement_context()
  self.assertIn('unavailable',context['announcements'][0]['status'])
  self.assertTrue((await b.channel_history())['cached_failure'])
  self.assertEqual(b.api.get.await_count,1)
 async def test_initial_deal_context_reaches_older_pages(self):
  import evaluate_staff_guidance as f
  api=f.FixtureAPI('normal')
  api.pages[f.CHANNEL]=[f.msg(int(f.MID)-i-1,'Routine progress.',f.AUTHOR) for i in range(125)]+[f.msg(int(f.MID)-200,'Your agreed rate is $2.75 per thousand eligible views.')]
  b=support.SupportTools(api,None,{'staff_roles':['staff']},f.GUILD,f.CHANNEL,f.AUTHOR,f.MID)
  context=await b.creator_context()
  self.assertIn('$2.75',context['potential_deal_context']['messages'][0]['text'])
  self.assertTrue(context['potential_deal_context']['messages'][0]['staff_author_verified'])

class SemanticGradingTests(unittest.TestCase):
 def test_paraphrases_and_conditions_are_not_false_failures(self):
  import evaluate_context_search as base
  import evaluate_quality_holdout as holdout
  self.assertFalse(base.grade({'contains':['remake','pending','2nd']},{'answer':'Remaking is allowed; no resolution recorded. Usually October 2.','trace':[]}))
  case=next(c for c in holdout.CASES if c['name']=='spark_no_confirmation')
  self.assertFalse(holdout.grade(case,{'answer':'Account-level works if your authorization is active.','trace':[]}))
  self.assertTrue(holdout.grade(case,{'answer':'Your authorization is active at account level.','trace':[]}))
