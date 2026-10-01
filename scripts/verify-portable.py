#!/usr/bin/env python3
"""Offline service/tool checks. Host, database, and live-provider gates are separate."""
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
bot = ROOT / "ops/creator-platform/discord-onboarding-bot"
node_tests = sorted(bot.glob("*.test.mjs")) + sorted((ROOT / "ops/creator-tracker-monitor/test").glob("*.test.mjs"))
commands = [
    [sys.executable, "-m", "unittest", "discover", "-s", "scripts/tests"],
    ["node", "--test", *[str(p.relative_to(ROOT)) for p in node_tests]],
    [sys.executable, "-m", "unittest", "discover", "-s", "ops/creator-tracker-autopilot/tests"],
    [sys.executable, "-m", "unittest", "discover", "-s", "tools/video-analysis"],
    [sys.executable, "-m", "unittest", "discover", "-s", "tools/viral-archive"],
]
# Hyphenated filenames cannot be collected by unittest discover. Execute these
# fixture-backed scripts individually. test-versioned-deals.py requires a local
# PostgreSQL 17 cluster and a migration argument; keep that integration gate separate.
for name in ("test-tracker-bridge.py", "test-hub-metrics-bridge.py", "test-owned-earnings-source.py",
             "test-september-deal-reconciliation.py"):
    commands.append([sys.executable, str((bot / name).relative_to(ROOT))])

for command in commands:
    print("+ " + " ".join(command), flush=True)
    subprocess.run(command, cwd=ROOT, check=True)
