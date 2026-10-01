"""Offline tests: no network, no yt-dlp, no ffmpeg."""
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import video_analysis as va


def fake_folder(root: Path, vid: str = "123") -> Path:
    folder = root / vid
    folder.mkdir(parents=True)
    (folder / "meta.json").write_text(json.dumps({"id": vid, "caption": "hi", "duration": 12}))
    (folder / "video.mp4").write_bytes(b"\x00" * 16)
    (folder / "clip.mp4").write_bytes(b"\x00" * 16)
    return folder


FAKE_PATHS = {"clip": "", "frames_dir": "", "sheet": "", "frame_count": 3, "duration": 12.0}


class LinkTests(unittest.TestCase):
    def test_full_links_yield_numeric_id(self):
        self.assertEqual(va.video_id("https://www.tiktok.com/@a.b_c/video/7684808368661237006"), "7684808368661237006")
        self.assertEqual(va.video_id("https://www.tiktok.com/@a/video/1?is_from_webapp=1"), "1")
        self.assertEqual(va.video_id("https://m.tiktok.com/@a/video/1"), "1")

    def test_short_links_resolve_later(self):
        self.assertIsNone(va.video_id("https://vm.tiktok.com/ZMabc/"))
        self.assertIsNone(va.video_id("https://www.tiktok.com/t/ZTabc/"))

    def test_non_tiktok_rejected(self):
        for url in ("http://www.tiktok.com/@a/video/1", "https://tiktok.com.evil.test/@a/video/1", "https://youtube.com/x", "file:///etc/passwd"):
            with self.assertRaises(va.VideoError) as ctx:
                va.video_id(url)
            self.assertEqual(ctx.exception.code, "bad_link")


class ParseTests(unittest.TestCase):
    def test_fenced_and_prefixed_json(self):
        self.assertEqual(va.parse_json('```json\n{"a": 1}\n```'), {"a": 1})
        self.assertEqual(va.parse_json('Sure:\n{"a": {"b": 2}} trailing'), {"a": {"b": 2}})

    def test_garbage_raises(self):
        with self.assertRaises(va.VideoError):
            va.parse_json("no json here")
        with self.assertRaises(va.VideoError):
            va.parse_json("{not: valid}")


class WatchTests(unittest.TestCase):
    def test_watch_calls_model_once_then_serves_cache(self):
        calls = []

        def fake_call(clip, prompt, model, max_tokens):
            calls.append(model)
            return {"summary": "s", "creator_speaks": True}, {"total_tokens": 10}

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            fake_folder(root)
            with patch.object(va, "fetch", return_value=root / "123"), \
                 patch.object(va, "derive", return_value=FAKE_PATHS), \
                 patch.object(va, "_call", fake_call):
                first = va.watch("https://www.tiktok.com/@a/video/123", root=root)
                second = va.watch("https://www.tiktok.com/@a/video/123", root=root)
                careful = va.watch("https://www.tiktok.com/@a/video/123", model="careful", root=root)
        self.assertEqual(calls, ["google/gemini-3.5-flash-lite", va.CAREFUL_MODEL])
        self.assertFalse(first["cached"]); self.assertTrue(second["cached"]); self.assertFalse(careful["cached"])
        self.assertEqual(second["report"]["summary"], "s")
        self.assertEqual(second["meta"]["caption"], "hi")
        self.assertEqual(second["usage"], {"total_tokens": 10})

    def test_ask_is_cached_per_question(self):
        calls = []

        def fake_call(clip, prompt, model, max_tokens):
            calls.append(prompt)
            return {"answer": "yes", "evidence": [], "confidence": 0.9}, {}

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            fake_folder(root)
            with patch.object(va, "fetch", return_value=root / "123"), \
                 patch.object(va, "derive", return_value=FAKE_PATHS), \
                 patch.object(va, "_call", fake_call):
                a = va.ask("https://www.tiktok.com/@a/video/123", "Is  the app   shown?", root=root)
                b = va.ask("https://www.tiktok.com/@a/video/123", "Is the app shown?", root=root)
                c = va.ask("https://www.tiktok.com/@a/video/123", "Who is on camera?", root=root)
                with self.assertRaises(ValueError):
                    va.ask("https://www.tiktok.com/@a/video/123", "hi", root=root)
        self.assertEqual(len(calls), 2)
        self.assertTrue(calls[0].endswith("Question: Is the app shown?"))
        self.assertEqual((a["cached"], b["cached"], c["cached"]), (False, True, False))
        self.assertEqual(b["question"], "Is the app shown?")


class FetchTests(unittest.TestCase):
    def test_fetch_skips_download_when_cached(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            fake_folder(root)
            with patch.object(va, "run") as run:
                folder = va.fetch("https://www.tiktok.com/@a/video/123", root)
            run.assert_not_called()
            self.assertEqual(folder, root / "123")

    def test_fetch_writes_public_metadata_from_yt_dlp(self):
        info = {"id": "999", "webpage_url": "https://www.tiktok.com/@x/video/999", "uploader": "x",
                "description": "cap #yap", "duration": 17, "view_count": 5, "like_count": 1, "timestamp": 1}

        def fake_run(cmd, timeout, what):
            if cmd[1] == "-j":
                return type("R", (), {"stdout": json.dumps(info) + "\n"})()
            Path(cmd[cmd.index("-o") + 1]).write_bytes(b"\x00")
            return type("R", (), {"stdout": ""})()

        with tempfile.TemporaryDirectory() as tmp, patch.object(va, "run", fake_run):
            folder = va.fetch("https://vm.tiktok.com/ZMshort/", Path(tmp))
            meta = json.loads((folder / "meta.json").read_text())
            downloaded = (folder / "video.mp4").exists()
        self.assertEqual(folder.name, "999")
        self.assertEqual((meta["caption"], meta["views"], meta["author_name"]), ("cap #yap", 5, "x"))
        self.assertTrue(downloaded)

    def test_download_failure_is_a_video_error(self):
        def fake_run(cmd, timeout, what):
            if cmd[1] == "-j":
                return type("R", (), {"stdout": json.dumps({"id": "7"}) + "\n"})()
            return type("R", (), {"stdout": ""})()  # no file written

        with tempfile.TemporaryDirectory() as tmp, patch.object(va, "run", fake_run):
            with self.assertRaises(va.VideoError) as ctx:
                va.fetch("https://www.tiktok.com/@a/video/7", Path(tmp))
            self.assertEqual(ctx.exception.code, "no_media"); self.assertFalse(ctx.exception.retryable)
            self.assertTrue((Path(tmp) / "_failures" / "7.json").exists())


class KeyTests(unittest.TestCase):
    def test_key_from_env_then_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            keyfile = Path(tmp) / "video.env"
            keyfile.write_text("# OPENROUTER_API_KEY=old\nOPENROUTER_API_KEY='from-file'\n")
            with patch.dict(va.os.environ, {"OPENROUTER_API_KEY": "from-env"}):
                self.assertEqual(va.api_key(), "from-env")
            with patch.dict(va.os.environ, {"OPENROUTER_API_KEY": ""}), patch.object(va, "KEY_FILES", [keyfile]):
                self.assertEqual(va.api_key(), "from-file")
            with patch.dict(va.os.environ, {"OPENROUTER_API_KEY": ""}), patch.object(va, "KEY_FILES", [Path(tmp) / "missing"]):
                with self.assertRaises(va.VideoError):
                    va.api_key()


class FailureTests(unittest.TestCase):
    def test_classify_yt_dlp_errors(self):
        cases = {
            "ERROR: [TikTok] 123: Video not available, status code 10204": "unavailable",
            "ERROR: This video is private": "private",
            "ERROR: [TikTok] Log in for access": "login_required",
            "ERROR: Unsupported URL: https://x": "bad_link",
            "HTTP Error 429: Too Many Requests": "rate_limited",
            "ERROR: Unable to download webpage: <urlopen error timed out>": "network",
            "ERROR: [tiktok] Failed to parse JSON": "tiktok_blocked",
            "something new": "tiktok_blocked",
        }
        for text, code in cases.items():
            self.assertEqual(va.classify_failure(text), code, text)

    def test_error_carries_advice_and_serialises(self):
        e = va.VideoError("private", "TikTok lookup failed: private")
        self.assertFalse(e.retryable); self.assertIn("do not retry", e.advice)
        d = e.to_dict(); self.assertEqual((d["code"], d["retryable"], d["attempts"]), ("private", False, 1))

    @staticmethod
    def _failing_subprocess(stderr, calls=None):
        import subprocess
        def fake(cmd, **kwargs):
            if calls is not None: calls.append(cmd[:2])
            raise subprocess.CalledProcessError(1, cmd, stderr=stderr)
        return fake

    def test_permanent_failure_is_recorded_and_not_retried(self):
        calls = []
        with tempfile.TemporaryDirectory() as tmp, patch.object(va.subprocess, "run", self._failing_subprocess("ERROR: [TikTok] 7: Video not available, status code 10204", calls)):
            root = Path(tmp)
            with self.assertRaises(va.VideoError) as first:
                va.fetch("https://www.tiktok.com/@a/video/7", root)
            with self.assertRaises(va.VideoError) as second:
                va.fetch("https://www.tiktok.com/@a/video/7", root)
            with self.assertRaises(va.VideoError) as third:
                va.watch("https://www.tiktok.com/@a/video/7", root=root)
        self.assertEqual(len(calls), 1)  # one network attempt, ever
        self.assertEqual(first.exception.code, "unavailable"); self.assertFalse(first.exception.cached)
        self.assertTrue(second.exception.cached); self.assertTrue(third.exception.cached)
        self.assertIn("do not retry", third.exception.advice.lower())

    def test_transient_failure_waits_for_cooldown_then_retries(self):
        calls = []
        with tempfile.TemporaryDirectory() as tmp, patch.object(va.subprocess, "run", self._failing_subprocess("HTTP Error 429: Too Many Requests", calls)):
            root = Path(tmp); url = "https://www.tiktok.com/@a/video/8"
            with self.assertRaises(va.VideoError) as e1: va.fetch(url, root)
            with self.assertRaises(va.VideoError) as e2: va.fetch(url, root)
            self.assertEqual(len(calls), 1); self.assertTrue(e1.exception.retryable); self.assertTrue(e2.exception.cached)
            self.assertIn("wait", str(e2.exception))
            with self.assertRaises(va.VideoError): va.fetch(url, root, refresh=True)   # refresh forces a try
            self.assertEqual(len(calls), 2)
            rec = root / "_failures" / "8.json"; data = json.loads(rec.read_text()); data["last_seen"] -= va.RETRY_COOLDOWN + 1
            rec.write_text(json.dumps(data))
            with self.assertRaises(va.VideoError) as e3: va.fetch(url, root)              # cooldown elapsed
            self.assertEqual(len(calls), 3); self.assertFalse(e3.exception.cached); self.assertEqual(e3.exception.attempts, 3)

    def test_success_clears_failure_record(self):
        state = {"fail": True}
        def fake_run(cmd, **kwargs):
            if state["fail"]: raise __import__("subprocess").CalledProcessError(1, cmd, stderr="timed out")
            if cmd[1] == "-j": return type("R", (), {"stdout": json.dumps({"id": "9"}) + "\n", "stderr": ""})()
            Path(cmd[cmd.index("-o") + 1]).write_bytes(b"\x00"); return type("R", (), {"stdout": "", "stderr": ""})()
        with tempfile.TemporaryDirectory() as tmp, patch.object(va.subprocess, "run", fake_run):
            root = Path(tmp); url = "https://www.tiktok.com/@a/video/9"
            with self.assertRaises(va.VideoError): va.fetch(url, root)
            state["fail"] = False
            self.assertTrue(va.fetch(url, root, refresh=True).exists())
            self.assertFalse((root / "_failures" / "9.json").exists())

    def test_not_configured_is_not_recorded_against_the_video(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); folder = fake_folder(root)
            with patch.object(va, "derive", return_value={**FAKE_PATHS, "clip": str(folder / "clip.mp4")}), patch.dict(va.os.environ, {"OPENROUTER_API_KEY": ""}), \
                 patch.object(va, "KEY_FILES", []):
                with self.assertRaises(va.VideoError) as ctx:
                    va.watch("https://www.tiktok.com/@a/video/123", root=root)
            self.assertEqual(ctx.exception.code, "not_configured")
            self.assertFalse((root / "_failures").exists())


class SlideshowAndTranscriptTests(unittest.TestCase):
    def test_slideshow_downloads_audio_only_and_refuses_visual_analysis(self):
        info = {"id": "55", "formats": [{"format_id": "play_addr", "ext": "mp3", "vcodec": "none"}], "description": "slides"}
        def fake_run(cmd, timeout, what, code_on_error=None):
            if cmd[1] == "-j": return type("R", (), {"stdout": json.dumps(info) + "\n"})()
            if cmd[0] == "yt-dlp":
                Path(cmd[cmd.index("-o") + 1].replace("%(ext)s", "mp3")).write_bytes(b"\x00"); return type("R", (), {"stdout": ""})()
            Path(cmd[-1]).write_bytes(b"\x00"); return type("R", (), {"stdout": ""})()   # ffmpeg -> audio.mp3
        with tempfile.TemporaryDirectory() as tmp, patch.object(va, "run", fake_run):
            root = Path(tmp); folder = va.fetch("https://www.tiktok.com/@a/video/55", root)
            self.assertEqual(va._meta(folder)["kind"], "slideshow")
            self.assertTrue((folder / "audio.mp3").exists()); self.assertFalse((folder / "video.mp4").exists())
            with self.assertRaises(va.VideoError) as ctx:
                va.watch("https://www.tiktok.com/@a/video/55", root=root)
            self.assertEqual(ctx.exception.code, "slideshow_no_video"); self.assertFalse(ctx.exception.retryable)
            with patch.object(va, "_call_audio", return_value=({"transcript": "hi there", "speech_type": "human_speech", "language": "en", "segments": []}, {})):
                t = va.transcript("https://www.tiktok.com/@a/video/55", root=root)
            self.assertEqual(t["transcript"], "hi there"); self.assertEqual(t["meta"]["kind"], "slideshow")

    def test_transcript_is_cached_and_skips_frame_derivation(self):
        calls = []
        def fake_audio(audio, prompt, model, max_tokens):
            calls.append(model); return {"transcript": " words ", "speech_type": "human_speech", "language": "en", "segments": [{"start": 0, "end": 1, "text": "words"}]}, {"cost": 0.0007}
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); fake_folder(root); (root / "123" / "audio.mp3").write_bytes(b"\x00")
            with patch.object(va, "_call_audio", fake_audio), patch.object(va, "derive") as derive:
                a = va.transcript("https://www.tiktok.com/@a/video/123", root=root)
                b = va.transcript("https://www.tiktok.com/@a/video/123", root=root)
            derive.assert_not_called()
        self.assertEqual(calls, [va.TRANSCRIPT_MODEL])
        self.assertEqual((a["transcript"], a["cached"], b["cached"]), ("words", False, True))
        self.assertEqual(b["segments"][0]["text"], "words")


class CliTests(unittest.TestCase):
    def test_exit_codes_distinguish_permanent_from_transient(self):
        import io, contextlib
        err = io.StringIO()
        with contextlib.redirect_stderr(err):
            code = va.main(["https://youtube.com/watch?v=1", "--transcript"])
        self.assertEqual(code, 2); self.assertEqual(json.loads(err.getvalue())["code"], "bad_link")
        with tempfile.TemporaryDirectory() as tmp:
            err = io.StringIO()
            with patch.object(va.subprocess, "run", FailureTests._failing_subprocess("HTTP Error 429")), contextlib.redirect_stderr(err):
                code = va.main(["https://www.tiktok.com/@a/video/1", "--transcript", "--cache", tmp])
            self.assertEqual(code, 1); self.assertTrue(json.loads(err.getvalue())["retryable"])


if __name__ == "__main__":
    unittest.main()
