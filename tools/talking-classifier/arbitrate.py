#!/usr/bin/env python3
"""Audio-only arbitration for videos where the two video models disagree.

Extracts the audio track (no visuals — immune to the lip-sync trap) and asks an
audio-capable model to type it: human speech / song / TTS / music only.
human_speech => talking; everything else => non-talking.
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
PROMPT = (
    'Listen to this audio from a TikTok. Return ONLY JSON: '
    '{"type": "human_speech|song|tts|music_only|mixed", '
    '"transcript_first_10s": string, "reasoning": string}. '
    "human_speech = a person talking/narrating in their own natural voice "
    "(counts even over background music). song = sung lyrics / music vocals. "
    "tts = synthetic text-to-speech voice. mixed = clear human narration plus "
    "song segments."
)


def extract_audio(url: str, dest: Path) -> Path | None:
    video = dest / "v.mp4"
    audio = dest / "a.mp3"
    try:
        subprocess.run(["yt-dlp", "--quiet", "--no-warnings", "-f", "mp4", "-o", str(video), url],
                       check=True, timeout=120, capture_output=True)
        subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", str(video), "-t", "20", "-vn", "-b:a", "64k", str(audio)],
                       check=True, timeout=60, capture_output=True)
    except Exception:
        return None
    return audio if audio.exists() else None


def ask(audio: Path, model: str) -> dict:
    body = {"model": model, "messages": [{"role": "user", "content": [
        {"type": "text", "text": PROMPT},
        {"type": "input_audio", "input_audio": {
            "data": base64.b64encode(audio.read_bytes()).decode(), "format": "mp3"}},
    ]}], "max_tokens": 300, "temperature": 0}
    request = urllib.request.Request(OPENROUTER_URL, data=json.dumps(body).encode(), headers={
        "Authorization": "Bearer " + os.environ["OPENROUTER_API_KEY"],
        "Content-Type": "application/json", "X-Title": "tt-ads-talking-arbiter"})
    with urllib.request.urlopen(request, timeout=120) as response:
        text = json.load(response)["choices"][0]["message"]["content"].strip()
    if text.startswith("```"):
        text = text.strip("`").removeprefix("json").strip()
    return json.loads(text[text.find("{"):text.rfind("}") + 1])


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, help="audit results JSON")
    parser.add_argument("--output", required=True)
    parser.add_argument("--model", default="google/gemini-2.5-flash")
    parser.add_argument("--workers", type=int, default=6)
    args = parser.parse_args()

    records = json.load(open(args.input))
    disputed = [r for r in records
                if r.get("predicted") and r.get("audit_predicted")
                and r["predicted"] != r["audit_predicted"]]
    print(f"disputed: {len(disputed)} / {len(records)}", flush=True)
    lock = threading.Lock()
    finished = [0]

    def work(record):
        with tempfile.TemporaryDirectory() as tmp:
            audio = extract_audio(record["url"], Path(tmp))
            if not audio:
                record["arbiter_error"] = "audio_extract_failed"
                return record
            for attempt in range(3):
                try:
                    verdict = ask(audio, args.model)
                    kind = verdict.get("type", "unclear")
                    record["arbiter_type"] = kind
                    record["arbiter_transcript"] = verdict.get("transcript_first_10s")
                    record["final"] = "talking" if kind in ("human_speech", "mixed") else "non-talking"
                    record.pop("arbiter_error", None)
                    return record
                except Exception as error:  # noqa: BLE001
                    record["arbiter_error"] = str(error)[:200]
                    time.sleep(10 * (attempt + 1))
        return record

    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = [pool.submit(work, r) for r in disputed]
        for future in as_completed(futures):
            record = future.result()
            with lock:
                finished[0] += 1
                print(f"[{finished[0]}/{len(disputed)}] {record['creator']} {record.get('posted','')} "
                      f"seed={record.get('predicted')} gemini={record.get('audit_predicted')} "
                      f"audio={record.get('arbiter_type','ERR')} -> final={record.get('final','?')}", flush=True)

    # agreements: final = the agreed value
    for record in records:
        if "final" not in record and record.get("predicted") and record.get("audit_predicted"):
            if record["predicted"] == record["audit_predicted"]:
                record["final"] = record["predicted"]
    json.dump(records, open(args.output, "w"), indent=1)
    resolved = sum(1 for r in records if r.get("final"))
    print(f"final verdicts: {resolved} / {len(records)}", flush=True)


if __name__ == "__main__":
    main()
