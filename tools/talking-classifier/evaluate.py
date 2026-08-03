#!/usr/bin/env python3
"""Eval harness: current video-model classifier vs audio-first pipeline.

Ground truth comes from the corrected payment receipt (user-audited labels).
For each video we run:
  A. the production video-model prompt (classify.py, gemini-2.5-pro), and
  B. audio typing (arbitrate.py prompt, audio track only), where
     human_speech/mixed => talking, everything else => non-talking.
The report shows each pipeline's confusion matrix, plus the combined rule
(#yap caption => talking; else audio verdict; video verdict only as fallback).

Usage: evaluate.py --input eval.json --output results.json [--workers 6]
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
MAX_SECONDS = 22

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


def openrouter(body: dict) -> dict:
    request = urllib.request.Request(
        OPENROUTER_URL,
        data=json.dumps(body).encode(),
        headers={
            "Authorization": "Bearer " + os.environ["OPENROUTER_API_KEY"],
            "Content-Type": "application/json",
            "X-Title": "tt-ads-talking-eval",
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
    video = tmp / "v.mp4"
    clip = tmp / "clip.mp4"
    audio = tmp / "a.mp3"
    try:
        subprocess.run(["yt-dlp", "--quiet", "--no-warnings", "-f", "mp4",
                        "--max-filesize", "80M", "-o", str(video), url],
                       check=True, timeout=120, capture_output=True)
        subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", str(video), "-t", str(MAX_SECONDS),
                        "-vf", "scale='min(480,iw)':-2", "-c:v", "libx264", "-preset", "veryfast",
                        "-crf", "30", "-c:a", "aac", "-b:a", "64k", str(clip)],
                       check=True, timeout=120, capture_output=True)
        subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", str(video), "-t", "20",
                        "-vn", "-b:a", "64k", str(audio)],
                       check=True, timeout=60, capture_output=True)
    except Exception:
        pass
    return (clip if clip.exists() else None, audio if audio.exists() else None)


def evaluate_one(record: dict) -> dict:
    with tempfile.TemporaryDirectory() as tmp:
        clip, audio = prepare(record["url"], Path(tmp))

        if clip:
            verdict = with_retries(lambda: openrouter({
                "model": VIDEO_MODEL,
                "messages": [{"role": "user", "content": [
                    {"type": "text", "text": VIDEO_PROMPT},
                    {"type": "video_url", "video_url": {
                        "url": "data:video/mp4;base64," + base64.b64encode(clip.read_bytes()).decode()}},
                ]}],
                "max_tokens": 4000, "reasoning": {"max_tokens": 2000}, "temperature": 0,
            }), record, "video_error")
            if verdict is not None:
                record["video_predicted"] = "talking" if verdict.get("talking") else "non-talking"
                record["video_confidence"] = verdict.get("confidence")
                record["video_evidence"] = verdict.get("evidence")

        if audio:
            verdict = with_retries(lambda: openrouter({
                "model": AUDIO_MODEL,
                "messages": [{"role": "user", "content": [
                    {"type": "text", "text": AUDIO_PROMPT},
                    {"type": "input_audio", "input_audio": {
                        "data": base64.b64encode(audio.read_bytes()).decode(), "format": "mp3"}},
                ]}],
                "max_tokens": 500, "temperature": 0,
            }), record, "audio_error")
            if verdict is not None:
                record["audio_type"] = verdict.get("type")
                record["audio_transcript"] = verdict.get("transcript_first_10s")
                record["audio_predicted"] = (
                    "talking" if verdict.get("type") in ("human_speech", "mixed") else "non-talking"
                )

    # combined pipeline: caption rule > audio > video
    if "#yap" in (record.get("caption") or "").lower():
        record["combined_predicted"] = "talking"
        record["combined_source"] = "caption-#yap"
    elif record.get("audio_predicted"):
        record["combined_predicted"] = record["audio_predicted"]
        record["combined_source"] = "audio"
    elif record.get("video_predicted"):
        record["combined_predicted"] = record["video_predicted"]
        record["combined_source"] = "video-fallback"
    return record


def confusion(records: list[dict], key: str) -> str:
    have = [r for r in records if r.get(key) and r.get("label")]
    tp = sum(1 for r in have if r["label"] == "talking" and r[key] == "talking")
    tn = sum(1 for r in have if r["label"] == "non-talking" and r[key] == "non-talking")
    fp = sum(1 for r in have if r["label"] == "non-talking" and r[key] == "talking")
    fn = sum(1 for r in have if r["label"] == "talking" and r[key] == "non-talking")
    total = len(have)
    accuracy = (tp + tn) / total if total else 0
    return (f"{key}: n={total} acc={accuracy:.0%} | false-talking (non-talking→talking): {fp} | "
            f"false-non-talking (talking→non-talking): {fn}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--workers", type=int, default=6)
    args = parser.parse_args()

    if not os.environ.get("OPENROUTER_API_KEY"):
        raise SystemExit("OPENROUTER_API_KEY is not set")

    records = json.load(open(args.input))
    lock = threading.Lock()
    finished = [0]

    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {pool.submit(evaluate_one, dict(r)): i for i, r in enumerate(records)}
        results: list[dict | None] = [None] * len(records)
        for future in as_completed(futures):
            index = futures[future]
            record = future.result()
            results[index] = record
            with lock:
                finished[0] += 1
                print(f"[{finished[0]}/{len(records)}] {record['creator']} {record.get('posted','')} "
                      f"label={record.get('label')} video={record.get('video_predicted','ERR')} "
                      f"audio={record.get('audio_predicted','ERR')}({record.get('audio_type','-')}) "
                      f"combined={record.get('combined_predicted','ERR')}", flush=True)
                json.dump([r for r in results if r], open(args.output, "w"), indent=1)

    final = [r for r in results if r]
    json.dump(final, open(args.output, "w"), indent=1)
    print()
    for key in ("video_predicted", "audio_predicted", "combined_predicted"):
        print(confusion(final, key), flush=True)


if __name__ == "__main__":
    main()
