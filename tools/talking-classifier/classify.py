#!/usr/bin/env python3
"""Classify TikTok videos as talking / non-talking with an OpenRouter video model.

Based on phone-farm's evaluate_video_with_openrouter.py call pattern (data-URL
video into chat completions). Talking = the creator's own speech (on-camera or
voiceover) drives the video; non-talking = music/text-overlay content.

Usage:
  classify.py --input videos.json --output results.json [--model MODEL]

Input JSON: [{"creator": str, "url": str, "label": str?}, ...]
Output JSON adds: predicted, confidence, evidence, error.
"""
from __future__ import annotations

import argparse
import base64
import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

MODEL = "google/gemini-2.5-pro"
OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
MAX_SECONDS = 22
PROMPT = """You are classifying a TikTok video as "talking" or "non-talking".

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


def download(url: str, dest: Path) -> Path | None:
    out = dest / "video.mp4"
    try:
        subprocess.run(
            ["yt-dlp", "--quiet", "--no-warnings", "-f", "mp4", "--max-filesize", "80M",
             "-o", str(out), url],
            check=True, timeout=120, capture_output=True,
        )
    except Exception:
        return None
    return out if out.exists() else None


def trim(src: Path, dest: Path) -> Path | None:
    out = dest / "clip.mp4"
    try:
        subprocess.run(
            ["ffmpeg", "-y", "-v", "error", "-i", str(src), "-t", str(MAX_SECONDS),
             "-vf", "scale='min(480,iw)':-2", "-c:v", "libx264", "-preset", "veryfast",
             "-crf", "30", "-c:a", "aac", "-b:a", "64k", str(out)],
            check=True, timeout=120, capture_output=True,
        )
    except Exception:
        return None
    return out if out.exists() else None


def classify(clip: Path, model: str) -> dict:
    body = {
        "model": model,
        "messages": [{
            "role": "user",
            "content": [
                {"type": "text", "text": PROMPT},
                {"type": "video_url",
                 "video_url": {"url": "data:video/mp4;base64," + base64.b64encode(clip.read_bytes()).decode()}},
            ],
        }],
        "max_tokens": 300,
        "temperature": 0,
    }
    request = urllib.request.Request(
        OPENROUTER_URL,
        data=json.dumps(body).encode(),
        headers={
            "Authorization": "Bearer " + os.environ["OPENROUTER_API_KEY"],
            "Content-Type": "application/json",
            "HTTP-Referer": "https://localhost",
            "X-Title": "tt-ads-talking-classifier",
        },
    )
    with urllib.request.urlopen(request, timeout=180) as response:
        payload = json.load(response)
    text = payload["choices"][0]["message"]["content"].strip()
    if text.startswith("```"):
        text = text.strip("`").removeprefix("json").strip()
    start, end = text.find("{"), text.rfind("}")
    return json.loads(text[start:end + 1])


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--model", default=MODEL)
    args = parser.parse_args()

    if not os.environ.get("OPENROUTER_API_KEY"):
        raise SystemExit("OPENROUTER_API_KEY is not set")

    items = json.load(open(args.input))
    results = []
    for index, item in enumerate(items):
        record = dict(item)
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            raw = download(item["url"], tmp_path)
            clip = trim(raw, tmp_path) if raw else None
            if not clip:
                record["error"] = "download_or_trim_failed"
            else:
                for attempt in range(3):
                    try:
                        verdict = classify(clip, args.model)
                        record["predicted"] = "talking" if verdict.get("talking") else "non-talking"
                        record["confidence"] = verdict.get("confidence")
                        record["evidence"] = verdict.get("evidence")
                        break
                    except Exception as error:  # noqa: BLE001
                        record["error"] = str(error)[:200]
                        time.sleep(10 * (attempt + 1))
        results.append(record)
        status = record.get("predicted", "ERR")
        expected = record.get("label", "?")
        mark = "" if expected == "?" else (" MATCH" if status == expected else " *** MISMATCH ***")
        print(f"[{index + 1}/{len(items)}] {item['creator']} {item.get('posted','')} -> {status} (want {expected}){mark}", flush=True)
        json.dump(results, open(args.output, "w"), indent=1)

    labeled = [r for r in results if r.get("label") and r.get("predicted")]
    if labeled:
        correct = sum(1 for r in labeled if r["label"] == r["predicted"])
        print(f"ACCURACY: {correct}/{len(labeled)} = {correct / len(labeled):.0%}", flush=True)


if __name__ == "__main__":
    main()
