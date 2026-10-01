# video-analysis

TikTok link → downloaded video → structured visual + audio analysis. One engine,
two consumers: coding agents call the CLI, the Discord support agent imports it
through `ops/discord-support/video_tools.py`.

```bash
tools/video-analysis/video_analysis.py https://www.tiktok.com/@creator/video/123   # watch report
tools/video-analysis/video_analysis.py URL --transcript                               # words only, ~3s after download
tools/video-analysis/video_analysis.py URL --ask "Is the app UI shown on screen?"     # one question
tools/video-analysis/video_analysis.py URL --fetch-only                               # frames only, no model
tools/video-analysis/video_analysis.py URL --model careful                            # Gemini 3.1 Pro
```

Output is JSON on stdout. Short links (`vm.tiktok.com/...`) are resolved by yt-dlp.

## What you get

- `report` (watch mode): summary, hook, format, `creator_speaks`, `speech_type`,
  verbatim transcript of human speech, timestamped on-screen text, scenes, people,
  setting, brands shown or named, audio, editing style, CTA, quality flags,
  confidence, notes.
- `answer` + timestamped `evidence` (ask mode).
- `meta`: public post metadata from yt-dlp (author, caption, duration, views, likes, comments, posted_at).
- `paths`: local files an agent can open directly. `sheet.jpg` is a contact sheet
  (up to 24 frames, timestamp = index × `frame_interval_seconds`); `frames/` holds the
  individual JPEGs; `clip.mp4` is the 480p, ≤90s clip the model saw; `audio.mp3` is the full track.
- `usage`: OpenRouter token and actual cost accounting; cost varies with clip and output length.

## Transcript mode

`--transcript` extracts the audio track and sends only that to Gemini 3.5 Flash-Lite.
Measured: 2.5s and $0.0007 for a 30s clip once the video is cached, about 10s from a
cold link. Returns verbatim human speech (song lyrics excluded), `speech_type`,
`language` and timed `segments`. Works on photo slideshow posts too, which have an
audio track but no video; those posts refuse `watch`/`ask` with `slideshow_no_video`.

## Failures explain themselves and do not repeat

Every failure is a `VideoError` with a `code`, a `retryable` flag and `advice`; the CLI
prints that as JSON on stderr and exits 2 for permanent codes, 1 for transient ones.
Codes: `private`, `unavailable`, `login_required`, `bad_link`, `no_media`,
`slideshow_no_video`, `model_rejected`, `not_configured` (permanent);
`rate_limited`, `network`, `tiktok_blocked`, `transcode_failed`, `model_unavailable`,
`malformed_output` (transient, 15 minute cooldown).

Download and transcode failures are written to `<cache>/_failures/<video id>.json`
with an attempt count. A permanent failure is answered from that record forever without
touching TikTok; a transient one is answered from the record until the cooldown passes.
`--refresh` forces one real attempt. A later success deletes the record. Model-stage
failures, `slideshow_no_video` and `not_configured` describe the provider, the mode or
the host rather than the post, so they are never recorded against a video.

## Model

Gemini 3.5 Flash-Lite via OpenRouter (`google/gemini-3.5-flash-lite`) reads the clip's video
and audio natively. `--model careful` switches to `google/gemini-3.1-pro-preview`.
Any OpenRouter id that accepts `video_url` input also works.

Flash-Lite is the default for new watch reports and questions. Existing reports
remain cached under their original model IDs. The Discord wrapper also keys its
result cache by resolved model ID, so changing the default does not return an
older model's cached report. Exact caption text and ambiguous details still need
selective review; the format pilot did not establish transcription parity.

The key comes from `OPENROUTER_API_KEY`, else `~/.config/gotall-nanobot/video.env`
(the file the Nanobot service reads; mode 600).

## Cache

`$VIDEO_ANALYSIS_CACHE` or `~/.cache/tt-video-analysis/<video id>/`. Download and
frame extraction happen once per video; each distinct prompt+model pair is cached
as `report-<hash>.json` / `ask-<hash>.json`. `--refresh` re-downloads and re-analyses.
The support bot uses its own cache under the service state directory.

## Not the payout classifier

`tools/talking-classifier/pipeline.py` keeps its audited Gemini 2.5 models and
its own prompts; this module shares nothing with it. Use `creator_speaks` /
`speech_type` here as a fast read, not as the payout verdict.

Tests: `python3 -m unittest discover -s tools/video-analysis` (offline, no network or ffmpeg).
