"""Discord-facing wrappers around tools/video-analysis: public TikTok links only, budgeted, trimmed.

Failures come back as ValueError text that carries the engine's failure code, whether a retry
can help, and what to do instead, so the agent never loops on a private or deleted video.
"""
import asyncio
import hashlib
import sys
import analysis_tools
import operations
from provider_budget import ProviderBudget

ENGINE = operations.REPO/'tools'/'video-analysis'
if str(ENGINE) not in sys.path: sys.path.insert(0, str(ENGINE))
import video_analysis  # noqa: E402

CACHE = operations.STATE/'video-cache'
PROVIDER = 'openrouter'
TIMEOUT = 300
MAX_TRANSCRIPT = 4000
MAX_ITEMS = 25


def failure_text(error):
    """One line the model can act on: code, what happened, and whether to retry."""
    verdict = 'Retry later may help.' if error.retryable else 'PERMANENT: do not retry this link.'
    seen = f' Seen {error.attempts} time(s) before.' if error.cached else ''
    return f'Video analysis failed [{error.code}]: {error}. {verdict} {error.advice}{seen}'


def _public_video(meta, *keys):
    return {k: meta.get(k) for k in keys}


def trim_report(result):
    """Model-facing subset: no host paths, bounded arrays, public metadata only."""
    report = dict(result.get('report') or {})
    if isinstance(report.get('transcript'), str) and len(report['transcript']) > MAX_TRANSCRIPT:
        report['transcript'] = report['transcript'][:MAX_TRANSCRIPT] + ' …[truncated]'
    for key in ('on_screen_text', 'scenes', 'brands', 'quality_flags'):
        if isinstance(report.get(key), list): report[key] = report[key][:MAX_ITEMS]
    return {
        'video': _public_video(result.get('meta') or {}, 'id', 'url', 'author_name', 'caption', 'duration', 'posted_at', 'views', 'likes', 'comments'),
        'analysis': report,
        'model': result.get('model'),
        'analyzed_at': result.get('analyzed_at'),
        'cached': bool(result.get('cached')),
        'note': 'Model-generated description of the public video; verify anything payout-relevant against saved terms and reports.',
    }


def trim_answer(result):
    return {
        'video': _public_video(result.get('meta') or {}, 'id', 'url', 'author_name', 'duration'),
        'question': result.get('question'),
        'answer': str(result.get('answer', ''))[:3000],
        'evidence': (result.get('evidence') or [])[:MAX_ITEMS] if isinstance(result.get('evidence'), list) else [],
        'confidence': result.get('confidence'),
        'model': result.get('model'),
        'cached': bool(result.get('cached')),
    }


def trim_transcript(result):
    text = str(result.get('transcript') or '')
    if len(text) > MAX_TRANSCRIPT: text = text[:MAX_TRANSCRIPT] + ' …[truncated]'
    meta = result.get('meta') or {}
    return {
        'video': _public_video(meta, 'id', 'url', 'author_name', 'caption', 'duration', 'posted_at', 'kind'),
        'transcript': text,
        'speech_type': result.get('speech_type'),
        'language': result.get('language'),
        'segments': (result.get('segments') or [])[:MAX_ITEMS * 2],
        'model': result.get('model'),
        'cached': bool(result.get('cached')),
        'note': 'Verbatim human speech only; song lyrics excluded. speech_type is a model read, not the payout classification.',
    }


async def _budgeted(path, parameters, fn):
    budget = ProviderBudget()
    try:
        key, cached, wait = budget.reserve(PROVIDER, path, parameters)
        if cached is not None: return {**cached, 'cached': True}
        if wait: return {'status': 'budget_wait', 'retry_after_seconds': wait, 'note': 'Shared video-analysis budget; wait and retry, do not bypass through shell.'}
        try:
            result = await asyncio.wait_for(asyncio.to_thread(fn), timeout=TIMEOUT)
        except video_analysis.VideoError as error:
            raise ValueError(failure_text(error)) from error
        except asyncio.TimeoutError as error:
            raise ValueError('Video analysis timed out [network]. Retry later may help; if it repeats, the video is unusually large.') from error
        budget.cache(key, result, 86400)
        return result
    finally: budget.close()


def _vid(video_url):
    return analysis_tools.video_id(video_url)  # full public link only, same rule as video_metrics


def _model(model):
    if model not in video_analysis.MODELS: raise ValueError('model must be fast or careful')
    # Cache against the resolved model so changing an alias cannot reuse the
    # previous model's report from the provider-budget cache.
    return video_analysis.MODELS[model]


async def watch(video_url, model='fast'):
    vid = _vid(video_url); model = _model(model)
    return await _budgeted('watch/'+vid, {'model': model},
                           lambda: trim_report(video_analysis.watch(video_url, model, CACHE)))


async def transcribe(video_url):
    vid = _vid(video_url)
    return await _budgeted('transcript/'+vid, {},
                           lambda: trim_transcript(video_analysis.transcript(video_url, root=CACHE)))


async def ask(video_url, question, model='fast'):
    vid = _vid(video_url); model = _model(model)
    question = ' '.join(str(question).split())
    if not 5 <= len(question) <= 500: raise ValueError('Ask one complete question of at most 500 characters.')
    digest = hashlib.sha256(question.encode()).hexdigest()[:16]
    return await _budgeted('ask/'+vid, {'model': model, 'q': digest},
                           lambda: trim_answer(video_analysis.ask(video_url, question, model, CACHE)))
