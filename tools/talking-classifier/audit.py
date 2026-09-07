#!/usr/bin/env python3
"""Second-opinion audit pass: different video model + GoTall-relevance check."""
from __future__ import annotations
import argparse, base64, json, os, subprocess, tempfile, threading, time, urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
MAX_SECONDS = 22
PROMPT = """You are auditing a TikTok video. Answer two questions and return ONLY compact JSON:

1. talking: does the creator's own SPEECH drive the video? Their voice on camera
   or as voiceover = true. Only music / trending audio / song vocals / lip-sync /
   robotic text-to-speech = false.
2. gotall_related: is the video's actual topic human height/growth (growing
   taller, being short/tall, height anxiety, posture for height, height tips)
   or does it promote/mention GoTall? Judge the visible content and audio topic,
   not the creator's username.

{"talking": true|false, "gotall_related": true|false, "confidence": 0.0-1.0, "evidence": "one sentence"}"""

def download(url, dest):
    out = dest / "video.mp4"
    try:
        subprocess.run(["yt-dlp","--quiet","--no-warnings","-f","mp4","--max-filesize","80M","-o",str(out),url],
                       check=True, timeout=120, capture_output=True)
    except Exception:
        return None
    return out if out.exists() else None

def trim(src, dest):
    out = dest / "clip.mp4"
    try:
        subprocess.run(["ffmpeg","-y","-v","error","-i",str(src),"-t",str(MAX_SECONDS),
                        "-vf","scale='min(480,iw)':-2","-c:v","libx264","-preset","veryfast",
                        "-crf","30","-c:a","aac","-b:a","64k",str(out)],
                       check=True, timeout=120, capture_output=True)
    except Exception:
        return None
    return out if out.exists() else None

def ask(clip, model):
    body = {"model": model, "messages": [{"role": "user", "content": [
        {"type": "text", "text": PROMPT},
        {"type": "video_url", "video_url": {"url": "data:video/mp4;base64," + base64.b64encode(clip.read_bytes()).decode()}},
    ]}], "max_tokens": 4000, "temperature": 0, "reasoning": {"max_tokens": 2000}}
    request = urllib.request.Request(OPENROUTER_URL, data=json.dumps(body).encode(), headers={
        "Authorization": "Bearer " + os.environ["OPENROUTER_API_KEY"],
        "Content-Type": "application/json", "HTTP-Referer": "https://localhost", "X-Title": "tt-ads-talking-audit"})
    with urllib.request.urlopen(request, timeout=180) as response:
        payload = json.load(response)
    text = payload["choices"][0]["message"]["content"].strip()
    if text.startswith("```"):
        text = text.strip("`").removeprefix("json").strip()
    return json.loads(text[text.find("{"):text.rfind("}") + 1])

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--model", default="google/gemini-2.5-pro")
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--workers", type=int, default=6)
    parser.add_argument("--resume-from", default="")
    args = parser.parse_args()
    items = json.load(open(args.input))
    if args.limit:
        items = items[:args.limit]
    done = {}
    if os.path.exists(args.resume_from):
        for r in json.load(open(args.resume_from)):
            if r.get("audit_predicted"):
                done[r["url"]] = r
    lock = threading.Lock()
    results = [None] * len(items)
    finished = [0]

    def work(index, item):
        if item["url"] in done:
            return index, done[item["url"]]
        record = dict(item)
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            raw = download(item["url"], tmp_path)
            clip = trim(raw, tmp_path) if raw else None
            if not clip:
                record["audit_error"] = "download_or_trim_failed"
            else:
                for attempt in range(3):
                    try:
                        verdict = ask(clip, args.model)
                        record["audit_predicted"] = "talking" if verdict.get("talking") else "non-talking"
                        record["gotall_related"] = bool(verdict.get("gotall_related"))
                        record["audit_confidence"] = verdict.get("confidence")
                        record["audit_evidence"] = verdict.get("evidence")
                        record.pop("audit_error", None)
                        break
                    except Exception as error:  # noqa: BLE001
                        record["audit_error"] = str(error)[:200]
                        time.sleep(10 * (attempt + 1))
        return index, record

    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = [pool.submit(work, i, item) for i, item in enumerate(items)]
        for future in as_completed(futures):
            index, record = future.result()
            with lock:
                results[index] = record
                finished[0] += 1
                first = record.get("predicted", "?")
                second = record.get("audit_predicted", "ERR")
                mark = " *** DISAGREE ***" if first not in ("?", second) and second != "ERR" else ""
                print(f"[{finished[0]}/{len(items)}] {record['creator']} {record.get('posted','')} seed={first} gemini={second} gotall={record.get('gotall_related')}{mark}", flush=True)
                json.dump([r for r in results if r], open(args.output, "w"), indent=1)

if __name__ == "__main__":
    main()
