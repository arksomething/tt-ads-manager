#!/usr/bin/env python3
"""TikTok link -> downloaded video -> structured visual + audio analysis.

One shared engine for coding agents (CLI) and the Discord support agent (import).

    video_analysis.py URL                 # structured "watch report" as JSON
    video_analysis.py URL --transcript    # fast transcript only (~3s once downloaded)
    video_analysis.py URL --ask "..."     # free-form question about the video
    video_analysis.py URL --fetch-only    # download + frames only, no model call

Cached layers under $VIDEO_ANALYSIS_CACHE (default ~/.cache/tt-video-analysis)/<video id>/:

  fetch      video.mp4 (or audio-only for slideshow posts) + meta.json   (yt-dlp, once)
  derive     audio.mp3, clip.mp4, frames/, sheet.jpg                     (ffmpeg, once)
  analyze    report-<hash>.json / ask-<hash>.json / transcript-<hash>.json (model, once per prompt+model)

Download/transcode failures are classified (see FAILURES) and recorded under
<cache>/_failures/ so a private or deleted video is answered from the record instead
of re-downloaded; permanent ones never retry, transient ones wait RETRY_COOLDOWN
unless --refresh. Model-stage failures and mode refusals (slideshow) are never recorded.

Perception model: Gemini 3.5 Flash-Lite via OpenRouter (native video + audio input).
Transcript model: Gemini 3.5 Flash-Lite (audio only). The talking-classifier in
tools/talking-classifier is deliberately NOT touched.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import math
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
WATCH_MODEL = "google/gemini-3.5-flash-lite"
CAREFUL_MODEL = "google/gemini-3.1-pro-preview"
TRANSCRIPT_MODEL = "google/gemini-3.5-flash-lite"
MODELS = {"fast": WATCH_MODEL, "careful": CAREFUL_MODEL}
CLIP_SECONDS = 90          # what the model sees; TikToks are usually far shorter
MAX_FRAMES = 24            # contact-sheet / frames dir budget
MAX_FILESIZE = "120M"
RETRY_COOLDOWN = 15 * 60   # seconds before a transient failure may be retried
KEY_FILES = [Path.home() / ".config/gotall-nanobot/video.env"]

TIKTOK_HOSTS = {"www.tiktok.com", "tiktok.com", "m.tiktok.com", "vm.tiktok.com", "vt.tiktok.com"}
FULL_LINK = re.compile(r"^https://(?:www\.|m\.)?tiktok\.com/@[^/]+/video/(\d+)/?(?:\?.*)?$")

# code -> (retryable, advice). Order matters: first pattern match wins in classify_failure.
FAILURES = {
    "private":          (False, "The video is private. Ask the creator for a public link; do not retry."),
    "unavailable":      (False, "The video was removed or is not available on TikTok. Do not retry."),
    "login_required":   (False, "TikTok requires a login (age-gated or restricted). Cannot be fetched; do not retry."),
    "bad_link":         (False, "This is not a TikTok video link. Use https://www.tiktok.com/@user/video/<id>."),
    "no_media":         (False, "TikTok returned no downloadable media for this post. Do not retry."),
    "slideshow_no_video": (False, "This is a photo slideshow post: audio and transcript are available, visual analysis is not."),
    "rate_limited":     (True,  "TikTok is rate limiting downloads from this host. Wait 15 minutes before retrying."),
    "tiktok_blocked":   (True,  "TikTok changed its page or blocked the extractor. Update yt-dlp, then retry later."),
    "network":          (True,  "Network problem reaching TikTok. Retry after a few minutes."),
    "transcode_failed": (True,  "ffmpeg could not process the download. Retry once with --refresh; if it repeats, the file is corrupt."),
    "model_rejected":   (False, "The model provider rejected the request (payload too large or invalid). Do not retry unchanged."),
    "model_unavailable": (True, "The model provider is unavailable or slow. Retry in a few minutes."),
    "not_configured":   (False, "OPENROUTER_API_KEY is not set for this process. Configure it; retrying will not help."),
    "malformed_output": (True,  "The model returned unparseable output. Retry once; use --model careful if it repeats."),
}
FAILURE_PATTERNS = [
    ("private", r"private video|is private|private account"),
    ("login_required", r"log ?in|sign ?in|age[- ]restricted|cookies"),
    ("unavailable", r"status code 10204|video not available|not available|unavailable|removed|does not exist|404"),
    ("bad_link", r"unsupported url|not a valid url|is not a valid|invalid url"),
    ("rate_limited", r"429|too many requests|rate limit"),
    ("network", r"unable to download webpage|timed out|timeout|connection|name resolution|network is unreachable|reset by peer|eof occurred"),
    ("tiktok_blocked", r"unable to extract|failed to parse json|unable to find|extractor"),
]

WATCH_PROMPT = """You are analysing a short-form TikTok video for a creator-marketing team.
Watch the whole clip and listen to the audio. Return ONLY compact JSON with exactly these keys:

{
 "summary": "2-3 sentences: what happens and why a viewer would watch",
 "hook": "what the first ~2 seconds do to stop the scroll (visual + text + audio)",
 "format": "talking_head|voiceover|text_overlay|lip_sync|skit|slideshow|vlog|tutorial|other",
 "creator_speaks": true|false,
 "speech_type": "human_speech|song|tts|none|mixed",
 "transcript": "verbatim words spoken by a human voice (not song lyrics); empty string if none",
 "on_screen_text": [{"t": seconds, "text": "exact overlay/caption text"}],
 "scenes": [{"start": seconds, "end": seconds, "description": "shot, action, camera"}],
 "people": "who is on camera, approximate age/gender presentation, count",
 "setting": "location and context",
 "brands": [{"name": "app/product/brand shown or named", "how": "shown on screen|named in speech|text overlay", "t": seconds}],
 "audio": {"music": true|false, "description": "trending sound / original / silence, mood"},
 "editing_style": "cuts, transitions, effects, pacing, captions style",
 "call_to_action": "any CTA said or shown, else empty string",
 "quality_flags": ["watermark","repost","low_resolution","black_bars","mismatched_audio","other"],
 "confidence": 0.0-1.0,
 "notes": "anything the team should know that the fields above miss"
}

Rules: human speech means a real person's natural voice (on camera or as voiceover), even over music.
Song vocals and robotic TTS are not human speech. Listen to the audio before deciding: if you can
hear a natural voice speaking words, speech_type is human_speech and creator_speaks is true, and
transcript must contain those words. creator_speaks must be true whenever speech_type is
human_speech or mixed. Timestamps are seconds from the start of the clip.
Do not invent text you cannot read; write "(illegible)" instead. Keep arrays under 25 items."""

ASK_PROMPT = """You are answering a question about a short-form TikTok video for a creator-marketing team.
Watch the whole clip and listen to the audio, then answer the question below precisely.
Cite timestamps (seconds) for anything you saw or heard. If the video does not contain the
answer, say so plainly instead of guessing. Return ONLY compact JSON:
{"answer": "...", "evidence": [{"t": seconds, "what": "..."}], "confidence": 0.0-1.0}

Question: """

TRANSCRIPT_PROMPT = """Transcribe the human speech in this TikTok audio verbatim, with punctuation.
Exclude song lyrics and do not describe the music. Return ONLY compact JSON:
{"transcript": "...", "speech_type": "human_speech|song|tts|none|mixed", "language": "ISO code",
 "segments": [{"start": seconds, "end": seconds, "text": "..."}]}
speech_type human_speech = a real person's natural voice (on camera or voiceover), even over music;
song = only sung vocals; tts = synthetic voice reading text; none = no words. If there is no human
speech, transcript is an empty string and segments is an empty list."""


class VideoError(RuntimeError):
    """Classified failure. `code` is a FAILURES key; `retryable` says whether trying again can help."""

    def __init__(self, code: str, message: str, attempts: int = 1, cached: bool = False):
        retryable, advice = FAILURES.get(code, (True, "Unknown failure; retry later."))
        self.code, self.retryable, self.advice, self.attempts, self.cached = code, retryable, advice, attempts, cached
        super().__init__(message)

    def to_dict(self) -> dict:
        return {"error": str(self), "code": self.code, "retryable": self.retryable, "advice": self.advice,
                "attempts": self.attempts, "from_failure_record": self.cached}


def classify_failure(stderr: str) -> str:
    text = (stderr or "").lower()
    for code, pattern in FAILURE_PATTERNS:
        if re.search(pattern, text):
            return code
    return "tiktok_blocked"


# --------------------------------------------------------------------------- helpers

def cache_root() -> Path:
    return Path(os.environ.get("VIDEO_ANALYSIS_CACHE") or Path.home() / ".cache/tt-video-analysis")


def api_key() -> str:
    key = os.environ.get("OPENROUTER_API_KEY", "").strip()
    if key:
        return key
    for path in KEY_FILES:
        try:
            for line in path.read_text().splitlines():
                line = line.strip()
                if line.startswith("OPENROUTER_API_KEY=") and not line.startswith("#"):
                    return line.split("=", 1)[1].strip().strip("\"'")
        except OSError:
            continue
    raise VideoError("not_configured", "OPENROUTER_API_KEY is not configured")


def video_id(url: str) -> str | None:
    """Numeric id for a full link, None for a short link (resolved by yt-dlp), error otherwise."""
    url = url.strip()
    match = FULL_LINK.match(url)
    if match:
        return match[1]
    host = re.match(r"^https://([^/?#]+)/", url)
    if not host or host[1] not in TIKTOK_HOSTS:
        raise VideoError("bad_link", "Use a public TikTok video link.")
    return None


def run(cmd: list[str], timeout: int, what: str, code_on_error: str | None = None) -> subprocess.CompletedProcess:
    try:
        return subprocess.run(cmd, check=True, timeout=timeout, capture_output=True, text=True)
    except FileNotFoundError as error:
        raise VideoError("not_configured", f"{cmd[0]} is not installed") from error
    except subprocess.TimeoutExpired as error:
        raise VideoError("network", f"{what} timed out") from error
    except subprocess.CalledProcessError as error:
        tail = ((error.stderr or "").strip().splitlines() or [""])[-1]
        code = code_on_error or classify_failure(error.stderr)
        raise VideoError(code, f"{what} failed: {tail[:200]}") from error


def _hash(*parts: str) -> str:
    return hashlib.sha256("\x1f".join(parts).encode()).hexdigest()[:16]


def _probe_duration(media: Path) -> float | None:
    try:
        out = run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                   "-of", "default=nw=1:nk=1", str(media)], 60, "ffprobe", "transcode_failed")
        return float(out.stdout.strip())
    except (VideoError, ValueError):
        return None


# --------------------------------------------------------------------------- failure records

def _failure_path(root: Path, url: str, vid: str | None) -> Path:
    return root / "_failures" / f"{vid or _hash(url)}.json"


def _check_failure_record(root: Path, url: str, vid: str | None, refresh: bool) -> None:
    """Raise immediately if this video already failed permanently, or transiently within the cooldown."""
    path = _failure_path(root, url, vid)
    if not path.exists():
        return
    try:
        rec = json.loads(path.read_text())
    except ValueError:
        path.unlink(missing_ok=True)
        return
    retryable = FAILURES.get(rec.get("code"), (True, ""))[0]
    age = time.time() - float(rec.get("last_seen", 0))
    if not retryable and not refresh:
        raise VideoError(rec["code"], rec.get("message", rec["code"]), attempts=int(rec.get("attempts", 1)), cached=True)
    if retryable and age < RETRY_COOLDOWN and not refresh:
        wait = int(RETRY_COOLDOWN - age)
        raise VideoError(rec["code"], f"{rec.get('message', rec['code'])} (last tried {int(age)}s ago; wait {wait}s)",
                         attempts=int(rec.get("attempts", 1)), cached=True)


NOT_RECORDED = {"not_configured", "slideshow_no_video"}   # host config / mode-specific refusals, not video properties


def _record_failure(root: Path, url: str, vid: str | None, error: VideoError) -> VideoError:
    if error.code in NOT_RECORDED:
        return error
    path = _failure_path(root, url, vid)
    path.parent.mkdir(parents=True, exist_ok=True)
    attempts = 1
    if path.exists():
        try:
            attempts = int(json.loads(path.read_text()).get("attempts", 0)) + 1
        except ValueError:
            pass
    path.write_text(json.dumps({"code": error.code, "message": str(error), "url": url, "video_id": vid,
                                "attempts": attempts, "first_seen": int(time.time()) if attempts == 1 else None,
                                "last_seen": int(time.time())}))
    error.attempts = attempts
    return error


def _clear_failure(root: Path, url: str, vid: str | None) -> None:
    _failure_path(root, url, vid).unlink(missing_ok=True)


# --------------------------------------------------------------------------- fetch / derive

def fetch(url: str, root: Path | None = None, refresh: bool = False) -> Path:
    """Download the post once; returns its cache directory (meta.json + video.mp4, or audio-only for slideshows)."""
    root = root or cache_root()
    vid = video_id(url)
    _check_failure_record(root, url, vid, refresh)
    folder = root / vid if vid else None
    if folder and not refresh and (folder / "meta.json").exists() and \
            ((folder / "video.mp4").exists() or (folder / "audio.mp3").exists()):
        return folder
    try:
        return _fetch_uncached(url, root, vid, refresh)
    except VideoError as error:
        raise _record_failure(root, url, vid, error) from None


def _fetch_uncached(url: str, root: Path, vid: str | None, refresh: bool) -> Path:
    info = run(["yt-dlp", "-j", "--no-warnings", "--no-playlist", url], 90, "TikTok lookup")
    try:
        raw = json.loads(info.stdout.splitlines()[0])
    except (ValueError, IndexError) as error:
        raise VideoError("tiktok_blocked", "TikTok lookup returned no metadata") from error
    vid = str(raw.get("id") or vid or "")
    if not vid:
        raise VideoError("tiktok_blocked", "TikTok lookup returned no video id")
    folder = root / vid
    folder.mkdir(parents=True, exist_ok=True)
    formats = raw.get("formats") or []
    has_video = any((f.get("vcodec") or "none") != "none" or (f.get("ext") in ("mp4", "webm")) for f in formats) or not formats
    kind = "video" if has_video else "slideshow"
    meta = {
        "id": vid,
        "kind": kind,
        "url": raw.get("webpage_url") or url,
        "author": raw.get("uploader_id") or raw.get("uploader") or raw.get("channel"),
        "author_name": raw.get("uploader") or raw.get("channel"),
        "caption": raw.get("description") or raw.get("title") or "",
        "duration": raw.get("duration"),
        "posted_at": raw.get("timestamp"),
        "views": raw.get("view_count"),
        "likes": raw.get("like_count"),
        "comments": raw.get("comment_count"),
        "reposts": raw.get("repost_count"),
        "fetched_at": int(time.time()),
    }
    (folder / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1))
    if kind == "video":
        video = folder / "video.mp4"
        if refresh or not video.exists():
            run(["yt-dlp", "--quiet", "--no-warnings", "--no-playlist", "-f", "mp4",
                 "--max-filesize", MAX_FILESIZE, "-o", str(video), url], 180, "TikTok download")
            if not video.exists():
                raise VideoError("no_media", "TikTok download produced no file (oversized or empty media)")
    else:
        audio = folder / "audio.mp3"
        if refresh or not audio.exists():
            run(["yt-dlp", "--quiet", "--no-warnings", "--no-playlist", "-f", "ba/b",
                 "--max-filesize", MAX_FILESIZE, "-o", str(folder / "slideshow_audio.%(ext)s"), url], 180, "TikTok audio download")
            src = next(iter(folder.glob("slideshow_audio.*")), None)
            if not src:
                raise VideoError("no_media", "Slideshow post has no downloadable audio")
            run(["ffmpeg", "-y", "-v", "error", "-i", str(src), "-vn", "-b:a", "64k", str(audio)], 120, "audio extract", "transcode_failed")
            src.unlink(missing_ok=True)
    _clear_failure(root, url, vid)
    return folder


def _meta(folder: Path) -> dict:
    return json.loads((folder / "meta.json").read_text())


def derive_audio(folder: Path, refresh: bool = False) -> Path:
    audio = folder / "audio.mp3"
    if refresh or not audio.exists():
        run(["ffmpeg", "-y", "-v", "error", "-i", str(folder / "video.mp4"), "-vn", "-b:a", "64k", str(audio)],
            120, "audio extract", "transcode_failed")
    return audio


def derive(folder: Path, refresh: bool = False) -> dict:
    """Make the model-facing clip, the audio track, sampled frames and a contact sheet."""
    if _meta(folder).get("kind") == "slideshow":
        raise VideoError("slideshow_no_video", "Photo slideshow post: no video track to analyse")
    video = folder / "video.mp4"
    clip, frames, sheet = folder / "clip.mp4", folder / "frames", folder / "sheet.jpg"
    audio = derive_audio(folder, refresh)
    duration = _probe_duration(video) or float(CLIP_SECONDS)
    if refresh or not clip.exists():
        run(["ffmpeg", "-y", "-v", "error", "-i", str(video), "-t", str(CLIP_SECONDS),
             "-vf", "scale='min(480,iw)':-2", "-c:v", "libx264", "-preset", "veryfast", "-crf", "30",
             "-c:a", "aac", "-b:a", "64k", "-movflags", "+faststart", str(clip)], 180, "clip encode", "transcode_failed")
    interval = max(1, math.ceil(min(duration, CLIP_SECONDS) / MAX_FRAMES))
    if refresh or not frames.is_dir() or not any(frames.glob("*.jpg")):
        frames.mkdir(exist_ok=True)
        for old in frames.glob("*.jpg"):
            old.unlink()
        run(["ffmpeg", "-y", "-v", "error", "-i", str(video), "-t", str(CLIP_SECONDS),
             "-vf", f"fps=1/{interval},scale='min(360,iw)':-2", "-q:v", "4",
             str(frames / f"t%03d_x{interval}s.jpg")], 180, "frame sampling", "transcode_failed")
    if refresh or not sheet.exists():
        cols = 4
        rows = max(1, math.ceil(min(MAX_FRAMES, math.ceil(min(duration, CLIP_SECONDS) / interval)) / cols))
        run(["ffmpeg", "-y", "-v", "error", "-i", str(video), "-t", str(CLIP_SECONDS),
             "-vf", f"fps=1/{interval},scale=240:-2,tile={cols}x{rows}", "-frames:v", "1", "-q:v", "4",
             str(sheet)], 180, "contact sheet", "transcode_failed")
    return {
        "video": str(video), "clip": str(clip), "audio": str(audio),
        "frames_dir": str(frames), "sheet": str(sheet), "frame_interval_seconds": interval,
        "frame_count": len(list(frames.glob("*.jpg"))), "duration": duration,
    }


# --------------------------------------------------------------------------- model

def parse_json(text: str) -> dict:
    text = text.strip()
    if text.startswith("```"):
        text = text.strip("`").removeprefix("json").strip()
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end < start:
        raise VideoError("malformed_output", "model returned no JSON object")
    try:
        return json.loads(text[start:end + 1])
    except ValueError as error:
        raise VideoError("malformed_output", "model returned malformed JSON") from error


def openrouter(body: dict, timeout: int = 240) -> tuple[dict, dict]:
    """Returns (parsed JSON content, usage)."""
    request = urllib.request.Request(
        OPENROUTER_URL, data=json.dumps(body).encode(),
        headers={"Authorization": "Bearer " + api_key(), "Content-Type": "application/json",
                 "X-Title": "tt-ads-video-analysis"})
    last: Exception | None = None
    for attempt in range(3):
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                payload = json.load(response)
            choice = payload["choices"][0]["message"]["content"]
            return parse_json(choice), payload.get("usage") or {}
        except urllib.error.HTTPError as error:
            last = error
            if error.code in (400, 401, 402, 403, 404, 413):
                raise VideoError("model_rejected", f"model request rejected (HTTP {error.code})") from error
        except VideoError as error:
            last = error
            if error.code == "not_configured":
                raise
        except (urllib.error.URLError, TimeoutError, KeyError, IndexError) as error:
            last = error
        time.sleep(5 * (attempt + 1))
    if isinstance(last, VideoError):
        raise last
    raise VideoError("model_unavailable", f"model request failed: {type(last).__name__}")


def _video_block(clip: Path) -> dict:
    return {"type": "video_url", "video_url": {
        "url": "data:video/mp4;base64," + base64.b64encode(clip.read_bytes()).decode()}}


def _audio_block(audio: Path) -> dict:
    return {"type": "input_audio", "input_audio": {"data": base64.b64encode(audio.read_bytes()).decode(), "format": "mp3"}}


def _call(clip: Path, prompt: str, model: str, max_tokens: int) -> tuple[dict, dict]:
    return openrouter({
        "model": model,
        "messages": [{"role": "user", "content": [{"type": "text", "text": prompt}, _video_block(clip)]}],
        # Keep medium effort, as used in the comparative video pilot. The provider
        # controls its token budget; observation quality still needs selective review.
        "max_tokens": max_tokens, "temperature": 0, "reasoning": {"effort": "medium"},
    })


def _call_audio(audio: Path, prompt: str, model: str, max_tokens: int) -> tuple[dict, dict]:
    return openrouter({
        "model": model,
        "messages": [{"role": "user", "content": [{"type": "text", "text": prompt}, _audio_block(audio)]}],
        "max_tokens": max_tokens, "temperature": 0, "reasoning": {"effort": "low"},
    })


def _guarded(root: Path, url: str, vid: str | None, fn):
    """Run a derive step; persist classified failures so callers stop retrying hopeless videos.
    Model-stage failures are deliberately not recorded: they describe the provider, not the post."""
    try:
        return fn()
    except VideoError as error:
        raise _record_failure(root, url, vid, error) from None


def watch(url: str, model: str = WATCH_MODEL, root: Path | None = None, refresh: bool = False) -> dict:
    """Structured watch report for a TikTok link; cached per video + model + prompt."""
    model = MODELS.get(model, model)
    root = root or cache_root()
    folder = fetch(url, root, refresh)
    vid = folder.name
    paths = _guarded(root, url, vid, lambda: derive(folder, refresh))
    meta = _meta(folder)
    cache = folder / f"report-{_hash(model, WATCH_PROMPT)}.json"
    if cache.exists() and not refresh:
        return {**json.loads(cache.read_text()), "meta": meta, "paths": paths, "cached": True}
    started = time.time()
    report, usage = _call(Path(paths["clip"]), WATCH_PROMPT, model, 6000)
    result = {"report": report, "model": model, "usage": usage,
              "analyzed_at": int(started), "seconds": round(time.time() - started, 1)}
    cache.write_text(json.dumps(result, ensure_ascii=False, indent=1))
    return {**result, "meta": meta, "paths": paths, "cached": False}


def transcript(url: str, model: str = TRANSCRIPT_MODEL, root: Path | None = None, refresh: bool = False) -> dict:
    """Fast audio-only transcript; works for video posts and photo slideshows. Cached per video + model."""
    root = root or cache_root()
    folder = fetch(url, root, refresh)
    vid = folder.name
    meta = _meta(folder)
    audio = folder / "audio.mp3" if meta.get("kind") == "slideshow" else \
        _guarded(root, url, vid, lambda: derive_audio(folder, refresh))
    cache = folder / f"transcript-{_hash(model, TRANSCRIPT_PROMPT)}.json"
    if cache.exists() and not refresh:
        return {**json.loads(cache.read_text()), "meta": meta, "audio": str(audio), "cached": True}
    started = time.time()
    out, usage = _call_audio(audio, TRANSCRIPT_PROMPT, model, 3000)
    result = {"transcript": str(out.get("transcript") or "").strip(), "speech_type": out.get("speech_type"),
              "language": out.get("language"), "segments": out.get("segments") if isinstance(out.get("segments"), list) else [],
              "model": model, "usage": usage, "analyzed_at": int(started), "seconds": round(time.time() - started, 1)}
    cache.write_text(json.dumps(result, ensure_ascii=False, indent=1))
    return {**result, "meta": meta, "audio": str(audio), "cached": False}


def ask(url: str, question: str, model: str = WATCH_MODEL, root: Path | None = None, refresh: bool = False) -> dict:
    """Free-form question about a TikTok link; cached per video + model + question."""
    question = " ".join(str(question).split())
    if len(question) < 5:
        raise ValueError("Ask a complete question about the video.")
    model = MODELS.get(model, model)
    root = root or cache_root()
    folder = fetch(url, root, refresh)
    vid = folder.name
    paths = _guarded(root, url, vid, lambda: derive(folder, refresh))
    meta = _meta(folder)
    cache = folder / f"ask-{_hash(model, ASK_PROMPT, question)}.json"
    if cache.exists() and not refresh:
        return {**json.loads(cache.read_text()), "meta": meta, "paths": paths, "cached": True}
    started = time.time()
    answer, usage = _call(Path(paths["clip"]), ASK_PROMPT + question, model, 3000)
    result = {"question": question, **answer, "model": model, "usage": usage,
              "analyzed_at": int(started), "seconds": round(time.time() - started, 1)}
    cache.write_text(json.dumps(result, ensure_ascii=False, indent=1))
    return {**result, "meta": meta, "paths": paths, "cached": False}


# --------------------------------------------------------------------------- CLI

def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("url", help="TikTok video link (full or short)")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--ask", metavar="QUESTION", help="free-form question instead of the watch report")
    mode.add_argument("--transcript", action="store_true", help="fast transcript only (audio model, ~3s after download)")
    mode.add_argument("--fetch-only", action="store_true", help="download and derive frames only; no model call")
    parser.add_argument("--model", default="fast", help="fast (Gemini 3.5 Flash-Lite), careful (Gemini 3.1 Pro) or an OpenRouter id")
    parser.add_argument("--refresh", action="store_true", help="ignore caches and failure records")
    parser.add_argument("--cache", type=Path, help="cache root (default $VIDEO_ANALYSIS_CACHE or ~/.cache/tt-video-analysis)")
    args = parser.parse_args(argv)
    try:
        if args.fetch_only:
            folder = fetch(args.url, args.cache, args.refresh)
            result = {"meta": _meta(folder), "paths": derive(folder, args.refresh)}
        elif args.transcript:
            result = transcript(args.url, root=args.cache, refresh=args.refresh)
        elif args.ask:
            result = ask(args.url, args.ask, args.model, args.cache, args.refresh)
        else:
            result = watch(args.url, args.model, args.cache, args.refresh)
    except VideoError as error:
        print(json.dumps(error.to_dict()), file=sys.stderr)
        return 1 if error.retryable else 2
    except ValueError as error:
        print(json.dumps({"error": str(error), "code": "bad_request", "retryable": False,
                          "advice": "Fix the arguments and call again."}), file=sys.stderr)
        return 2
    print(json.dumps(result, ensure_ascii=False, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
