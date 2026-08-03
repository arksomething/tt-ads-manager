#!/usr/bin/env python3
"""Production talking/non-talking pipeline — one command, parallel, resumable.

Decision chain per video:
  1. Caption rule: "#yap" in caption => talking (standing GoTall rule, no model).
  2. Video model (gemini-2.5-pro, 22s clip) and audio typing (gemini-2.5-flash,
     20s track) run in parallel. If they agree => that verdict.
  3. Disagreement => full-length audio arbitration (entire track, asks where
     speech starts + transcript). human_speech/mixed => talking.

Eval (Aug 2026, 60 user-audited hard cases): video model 88% with ZERO
false-talking; disagreements are lyric-driven edge cases — exactly what the
arbitration step exists for. The big real-world error source is videos never
classified at all (creator-default inheritance), so run this over EVERY video
in a pay window, not just disputed ones.

Usage:
  pipeline.py --input videos.json --output results.json [--workers 6]
Input:  [{"creator": str, "url": str, "caption": str?, "label": str?}, ...]
Output: adds final, final_source, plus per-model fields. Resumes: existing
        output rows with a "final" are skipped.
"""
from __future__ import annotations

import argparse
import base64
import json
import os
import subprocess
import tempfile
import threading
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
VIDEO_MODEL = "google/gemini-2.5-pro"
AUDIO_MODEL = "google/gemini-2.5-flash"
CLIP_SECONDS = 22

VIDEO_PROMPT = """You are classifying a TikTok video as "talking" or "non-talking".

Definitions:
- "talking": the creator's own SPEECH drives the video — they speak on camera
  (moving lips, addressing viewer) or narrate with their own voiceover. Speech
  must be a human voice belonging to the video's creator/narrator, not song
  lyrics.
- "non-talking": no creator speech — background music / trending audio / song
  only, content carried by text overlays, captions, b-roll, or lip-syncing to
  a song. A video where the only voice is a song's vocals is non-talking.
  Text-to-speech (robotic TTS voice) reading captions counts as non-talking.

Use BOTH the audio track and visuals (lip movement synchronized with speech,
vlog-style framing vs text-overlay-over-b-roll style). If audio is unavailable,
judge from visuals: sustained on-camera mouth movement matching a person
addressing the camera indicates talking; pure text-overlay content with the
person posing/exercising/walking indicates non-talking.

Return ONLY valid compact JSON:
{"talking": true|false, "confidence": 0.0-1.0, "evidence": "one sentence"}"""

AUDIO_PROMPT = (
    'Listen to this audio from a TikTok. Return ONLY JSON: '
    '{"type": "human_speech|song|tts|music_only|mixed", '
    '"transcript_first_10s": string, "reasoning": string}. '
    "human_speech = a person talking/narrating in their own natural voice "
    "(counts even over background music). song = sung lyrics / music vocals. "
    "tts = synthetic text-to-speech voice. mixed = clear human narration plus "
    "song segments."
)

ARBITER_PROMPT = (
    'Listen to the ENTIRE audio track of a TikTok. Return ONLY JSON: '
    '{"type": "human_speech|song|tts|music_only|mixed", '
    '"speech_starts_at_seconds": number|null, "transcript": string, '
    '"reasoning": string}. human_speech = a person talking/narrating in their '
    "own natural voice (counts even over background music). song = sung "
    "lyrics / music vocals only. tts = synthetic text-to-speech. mixed = "
    "clear human narration plus song segments."
)


def openrouter(body: dict) -> dict:
    request = urllib.request.Request(
        OPENROUTER_URL,
        data=json.dumps(body).encode(),
        headers={
            "Authorization": "Bearer " + os.environ["OPENROUTER_API_KEY"],
            "Content-Type": "application/json",
            "X-Title": "tt-ads-talking-pipeline",
        },
    )
    with urllib.request.urlopen(request, timeout=180) as response:
        text = json.load(response)["choices"][0]["message"]["content"].strip()
    if text.startswith("```"):
        text = text.strip("`").removeprefix("json").strip()
    return json.loads(text[text.find("{"):text.rfind("}") + 1])


def with_retries(fn, record, key):
    for attempt in range(3):
        try:
            return fn()
        except Exception as error:  # noqa: BLE001
            record[key] = str(error)[:200]
            time.sleep(8 * (attempt + 1))
    return None


def prepare(url: str, tmp: Path):
    """Returns (clip.mp4 (22s, downscaled), clip audio mp3 (20s), full audio mp3)."""
    video = tmp / "v.mp4"
    clip = tmp / "clip.mp4"
    audio = tmp / "a.mp3"
    full_audio = tmp / "full.mp3"
    try:
        subprocess.run(["yt-dlp", "--quiet", "--no-warnings", "-f", "mp4",
                        "--max-filesize", "80M", "-o", str(video), url],
                       check=True, timeout=120, capture_output=True)
        subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", str(video), "-t", str(CLIP_SECONDS),
                        "-vf", "scale='min(480,iw)':-2", "-c:v", "libx264", "-preset", "veryfast",
                        "-crf", "30", "-c:a", "aac", "-b:a", "64k", str(clip)],
                       check=True, timeout=120, capture_output=True)
        subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", str(video), "-t", "20",
                        "-vn", "-b:a", "64k", str(audio)],
                       check=True, timeout=60, capture_output=True)
        subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", str(video),
                        "-vn", "-b:a", "64k", str(full_audio)],
                       check=True, timeout=60, capture_output=True)
    except Exception:
        pass
    return (
        clip if clip.exists() else None,
        audio if audio.exists() else None,
        full_audio if full_audio.exists() else None,
    )


def classify_one(record: dict) -> dict:
    if "#yap" in (record.get("caption") or "").lower():
        record["final"] = "talking"
        record["final_source"] = "caption-#yap"
        return record

    with tempfile.TemporaryDirectory() as tmp:
        clip, audio, full_audio = prepare(record["url"], Path(tmp))

        if not clip and not audio:
            record["final_source"] = "error"
            record["error"] = "download_failed"
            return record

        video_verdict = None
        if clip:
            video_verdict = with_retries(lambda: openrouter({
                "model": VIDEO_MODEL,
                "messages": [{"role": "user", "content": [
                    {"type": "text", "text": VIDEO_PROMPT},
                    {"type": "video_url", "video_url": {
                        "url": "data:video/mp4;base64," + base64.b64encode(clip.read_bytes()).decode()}},
                ]}],
                "max_tokens": 4000, "reasoning": {"max_tokens": 2000}, "temperature": 0,
            }), record, "video_error")
        if video_verdict is not None:
            record["video_predicted"] = "talking" if video_verdict.get("talking") else "non-talking"
            record["video_evidence"] = video_verdict.get("evidence")

        audio_verdict = None
        if audio:
            audio_verdict = with_retries(lambda: openrouter({
                "model": AUDIO_MODEL,
                "messages": [{"role": "user", "content": [
                    {"type": "text", "text": AUDIO_PROMPT},
                    {"type": "input_audio", "input_audio": {
                        "data": base64.b64encode(audio.read_bytes()).decode(), "format": "mp3"}},
                ]}],
                "max_tokens": 500, "temperature": 0,
            }), record, "audio_error")
        if audio_verdict is not None:
            record["audio_type"] = audio_verdict.get("type")
            record["audio_predicted"] = (
                "talking" if audio_verdict.get("type") in ("human_speech", "mixed") else "non-talking"
            )

        video_predicted = record.get("video_predicted")
        audio_predicted = record.get("audio_predicted")

        if video_predicted and audio_predicted and video_predicted == audio_predicted:
            record["final"] = video_predicted
            record["final_source"] = "agreement"
            return record

        if video_predicted and not audio_predicted:
            record["final"] = video_predicted
            record["final_source"] = "video-only"
            return record

        if audio_predicted and not video_predicted:
            record["final"] = audio_predicted
            record["final_source"] = "audio-only"
            return record

        # disagreement: full-length audio arbitration
        if full_audio:
            arbiter = with_retries(lambda: openrouter({
                "model": AUDIO_MODEL,
                "messages": [{"role": "user", "content": [
                    {"type": "text", "text": ARBITER_PROMPT},
                    {"type": "input_audio", "input_audio": {
                        "data": base64.b64encode(full_audio.read_bytes()).decode(), "format": "mp3"}},
                ]}],
                "max_tokens": 600, "temperature": 0,
            }), record, "arbiter_error")
            if arbiter is not None:
                record["arbiter_type"] = arbiter.get("type")
                record["arbiter_transcript"] = arbiter.get("transcript")
                record["final"] = (
                    "talking" if arbiter.get("type") in ("human_speech", "mixed") else "non-talking"
                )
                record["final_source"] = "full-audio-arbitration"
                return record

        record["final"] = video_predicted or audio_predicted or None
        record["final_source"] = "fallback"
        return record


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--workers", type=int, default=6)
    args = parser.parse_args()

    if not os.environ.get("OPENROUTER_API_KEY"):
        raise SystemExit("OPENROUTER_API_KEY is not set")

    records = json.load(open(args.input))
    done_by_url: dict[str, dict] = {}
    if os.path.exists(args.output):
        for record in json.load(open(args.output)):
            if record.get("final"):
                done_by_url[record["url"]] = record

    lock = threading.Lock()
    finished = [0]
    results: list[dict | None] = [None] * len(records)

    def run(index: int, record: dict) -> tuple[int, dict]:
        if record["url"] in done_by_url:
            return index, done_by_url[record["url"]]
        return index, classify_one(dict(record))

    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = [pool.submit(run, i, r) for i, r in enumerate(records)]
        for future in as_completed(futures):
            index, record = future.result()
            results[index] = record
            with lock:
                finished[0] += 1
                print(f"[{finished[0]}/{len(records)}] {record.get('creator','?')} "
                      f"{record.get('posted','')} -> {record.get('final','ERR')} "
                      f"({record.get('final_source','')})", flush=True)
                json.dump([r for r in results if r], open(args.output, "w"), indent=1)

    final = [r for r in results if r]
    json.dump(final, open(args.output, "w"), indent=1)
    talking = sum(1 for r in final if r.get("final") == "talking")
    non_talking = sum(1 for r in final if r.get("final") == "non-talking")
    unresolved = sum(1 for r in final if not r.get("final"))
    print(f"\ntalking={talking} non-talking={non_talking} unresolved={unresolved}", flush=True)
    labeled = [r for r in final if r.get("label") and r.get("final")]
    if labeled:
        correct = sum(1 for r in labeled if r["label"] == r["final"])
        print(f"ACCURACY vs labels: {correct}/{len(labeled)} = {correct / len(labeled):.0%}", flush=True)


if __name__ == "__main__":
    main()
