import os
import hashlib
import time
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import provider_budget
import video_tools


FULL = {
    'report': {'summary': 's', 'creator_speaks': True, 'transcript': 'x' * 5000, 'scenes': [{'start': i} for i in range(40)]},
    'meta': {'id': '123', 'url': 'https://www.tiktok.com/@a/video/123', 'author_name': 'a', 'caption': 'c', 'duration': 17, 'views': 5, 'author': 'internal-id'},
    'paths': {'video': '/home/x/secret/video.mp4'}, 'model': 'google/gemini-3.8-flash', 'usage': {'cost': 0.005}, 'cached': False, 'analyzed_at': 1,
}


class TrimTests(unittest.TestCase):
    def test_report_drops_paths_and_bounds_sizes(self):
        out = video_tools.trim_report(FULL)
        self.assertNotIn('paths', out); self.assertNotIn('/home/', str(out)); self.assertNotIn('internal-id', str(out))
        self.assertEqual(len(out['analysis']['scenes']), video_tools.MAX_ITEMS)
        self.assertTrue(out['analysis']['transcript'].endswith('[truncated]'))
        self.assertEqual(out['video']['views'], 5)
        self.assertEqual(out['model'], 'google/gemini-3.8-flash')

    def test_answer_shape(self):
        out = video_tools.trim_answer({'meta': FULL['meta'], 'question': 'q', 'answer': 'a', 'evidence': [{'t': 1}], 'confidence': 0.5, 'model': 'm', 'cached': True})
        self.assertEqual(out['answer'], 'a'); self.assertEqual(out['evidence'], [{'t': 1}]); self.assertTrue(out['cached'])


class ToolTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        db = Path(self.tmp.name) / 'budget.sqlite3'
        self.patch = patch.object(video_tools, 'ProviderBudget', lambda path=None: provider_budget.ProviderBudget(db))
        self.patch.start(); self.addCleanup(self.patch.stop)

    async def test_watch_requires_full_public_link(self):
        for url in ('https://vm.tiktok.com/ZMabc/', 'https://youtube.com/watch?v=1', 'https://www.tiktok.com/@a'):
            with self.assertRaises(ValueError):
                await video_tools.watch(url)

    async def test_watch_runs_engine_off_loop_and_caches_in_budget(self):
        calls = []

        def engine(url, model, root):
            calls.append((url, model, root)); return FULL

        with patch.object(video_tools.video_analysis, 'watch', engine):
            first = await video_tools.watch('https://www.tiktok.com/@a/video/123')
            second = await video_tools.watch('https://www.tiktok.com/@a/video/123')
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0][1:], ('google/gemini-3.5-flash-lite', video_tools.CACHE))
        self.assertEqual(first['analysis']['summary'], 's'); self.assertEqual(second, {**first, 'cached': True})

    async def test_watch_does_not_reuse_old_fast_alias_cache(self):
        budget = video_tools.ProviderBudget()
        try:
            key, _, _ = budget.reserve(video_tools.PROVIDER, 'watch/123', {'model': 'fast'}, now=time.time()-10)
            budget.cache(key, video_tools.trim_report(FULL), 86400)
        finally:
            budget.close()
        fresh = {**FULL, 'model': 'google/gemini-3.5-flash-lite'}
        with patch.object(video_tools.video_analysis, 'watch', return_value=fresh) as engine:
            first = await video_tools.watch('https://www.tiktok.com/@a/video/123')
            second = await video_tools.watch('https://www.tiktok.com/@a/video/123')
        engine.assert_called_once_with('https://www.tiktok.com/@a/video/123', 'google/gemini-3.5-flash-lite', video_tools.CACHE)
        self.assertEqual(first['model'], 'google/gemini-3.5-flash-lite')
        self.assertTrue(second['cached'])

    async def test_ask_does_not_reuse_old_fast_alias_cache(self):
        question = 'Is the app shown?'
        budget = video_tools.ProviderBudget()
        try:
            key, _, _ = budget.reserve(video_tools.PROVIDER, 'ask/123', {'model': 'fast', 'q': hashlib.sha256(question.encode()).hexdigest()[:16]}, now=time.time()-10)
            budget.cache(key, {'answer': 'old answer', 'model': 'google/gemini-3.8-flash'}, 86400)
        finally:
            budget.close()
        fresh = {**FULL, 'model': 'google/gemini-3.5-flash-lite', 'question': question, 'answer': 'new answer', 'evidence': []}
        with patch.object(video_tools.video_analysis, 'ask', return_value=fresh) as engine:
            result = await video_tools.ask('https://www.tiktok.com/@a/video/123', question)
        engine.assert_called_once_with('https://www.tiktok.com/@a/video/123', question, 'google/gemini-3.5-flash-lite', video_tools.CACHE)
        self.assertEqual(result['answer'], 'new answer')

    async def test_engine_failure_names_cause_and_retry_verdict(self):
        def engine(url, model, root): raise video_tools.video_analysis.VideoError('private', 'TikTok lookup failed: private video', attempts=3, cached=True)
        with patch.object(video_tools.video_analysis, 'watch', engine):
            with self.assertRaises(ValueError) as ctx:
                await video_tools.watch('https://www.tiktok.com/@a/video/123')
        text=str(ctx.exception)
        self.assertIn('[private]', text); self.assertIn('PERMANENT: do not retry', text); self.assertIn('Seen 3 time(s)', text)

    async def test_transient_failure_says_retry_may_help(self):
        def transient(url, model, root): raise video_tools.video_analysis.VideoError('rate_limited', 'TikTok download failed: 429')
        with patch.object(video_tools.video_analysis, 'watch', transient):
            with self.assertRaises(ValueError) as ctx:
                await video_tools.watch('https://www.tiktok.com/@a/video/124')
        self.assertIn('Retry later may help', str(ctx.exception)); self.assertNotIn('PERMANENT', str(ctx.exception))

    async def test_transcript_tool_trims_and_caches(self):
        calls=[]
        def engine(url, root=None, **kw):
            calls.append(url); return {'transcript':'x'*5000,'speech_type':'human_speech','language':'en','segments':[{'start':0,'end':1,'text':'x'}]*80,'model':'m','cached':False,'meta':{'id':'123','url':'u','author_name':'a','kind':'video','author':'internal'}}
        with patch.object(video_tools.video_analysis,'transcript',engine):
            first=await video_tools.transcribe('https://www.tiktok.com/@a/video/123')
            second=await video_tools.transcribe('https://www.tiktok.com/@a/video/123')
        self.assertEqual(len(calls),1)
        self.assertTrue(first['transcript'].endswith('[truncated]')); self.assertEqual(len(first['segments']),50)
        self.assertNotIn('internal',str(first)); self.assertTrue(second['cached'])

    async def test_budget_spacing_returns_wait_not_second_call(self):
        calls = []

        def engine(url, model, root): calls.append(url); return FULL

        with patch.object(video_tools.video_analysis, 'watch', engine):
            await video_tools.watch('https://www.tiktok.com/@a/video/123')
            other = await video_tools.watch('https://www.tiktok.com/@a/video/124')
        self.assertEqual(len(calls), 1)
        self.assertEqual(other['status'], 'budget_wait'); self.assertGreater(other['retry_after_seconds'], 0)

    async def test_ask_validates_question_and_model(self):
        with self.assertRaises(ValueError):
            await video_tools.ask('https://www.tiktok.com/@a/video/123', 'hi')
        with self.assertRaises(ValueError):
            await video_tools.ask('https://www.tiktok.com/@a/video/123', 'What is shown on screen?', model='gpt-4')

        def engine(url, question, model, root): return {**FULL, 'question': question, 'answer': 'yes', 'evidence': [], 'confidence': 1}
        with patch.object(video_tools.video_analysis, 'ask', engine):
            out = await video_tools.ask('https://www.tiktok.com/@a/video/123', '  What   is shown? ', model='careful')
        self.assertEqual(out['question'], 'What is shown?'); self.assertEqual(out['answer'], 'yes')


if __name__ == '__main__':
    unittest.main()
