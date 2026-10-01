#!/usr/bin/env python3
"""Reject private runtime files and recognizable credentials in Git's source tree.

Only paths and rule names are printed, never matching credential values. This is
a bounded hygiene check, not a claim that arbitrary secrets can all be detected.
"""
import argparse
import fnmatch
from pathlib import Path, PurePosixPath
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
GENERATED_DIRS = {"node_modules", ".next", ".vercel", ".venv", "venv", "coverage", "__pycache__"}
LOCAL_ROOTS = {"tmp", "output", "payouts", "reports", ".claude", ".wrangler"}
PRIVATE_CAPTURES = (
    "ops/discord-admin-audits/*.json",
    "ops/creator-platform/discord-onboarding-bot/legacy-scripts-review.json",
    "ops/discord-support/*-results.json",
    "ops/discord-support/*verification*.json",
    "ops/discord-support/*EVALUATION.md",
    "ops/discord-support/CONVERSION-DATA-AUDIT.md",
)
CREDENTIALS = {
    "private key": rb"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----",
    "GitHub token": rb"\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b",
    "API key": rb"\bsk-(?:proj-|or-v1-)?[A-Za-z0-9_-]{24,}\b",
    "AWS access key": rb"\b(?:AKIA|ASIA)[A-Z0-9]{16}\b",
}


def violations(name, content):
    path = PurePosixPath(name)
    rules = []
    if set(path.parts) & GENERATED_DIRS or path.parts[0] in LOCAL_ROOTS:
        rules.append("local/generated artifact")
    if path.name == ".env" or (path.name.startswith(".env.") and not path.name.endswith(".example")):
        rules.append("environment file")
    if any(fnmatch.fnmatch(path.name, pattern) for pattern in (
        "*.secret", "*.credentials", "*.credentials.env", "*.p8", "*.pem",
        "*.cookies", "*.sqlite3*", "*.tsbuildinfo", "*.log",
    )) or ("ops" in path.parts and "private" in path.parts):
        rules.append("private runtime file")
    if any(fnmatch.fnmatch(name, pattern) for pattern in PRIVATE_CAPTURES):
        rules.append("private operational capture")
    for rule, pattern in CREDENTIALS.items():
        if re.search(pattern, content):
            rules.append(rule)
    return rules


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--index", action="store_true", help="Check exact staged bytes before committing")
    args = parser.parse_args()
    names = subprocess.check_output(["git", "ls-files", "-z"], cwd=ROOT).decode().split("\0")
    failures = []
    for name in filter(None, names):
        if args.index:
            content = subprocess.check_output(["git", "show", f":{name}"], cwd=ROOT)
        else:
            path = ROOT / name
            if not path.is_file():
                failures.append((name, "tracked file missing from checkout"))
                continue
            content = path.read_bytes()
        failures.extend((name, rule) for rule in violations(name, content))
    for name, rule in failures:
        print(f"{name}: {rule}", file=sys.stderr)
    if failures:
        return 1
    print(f"Repository hygiene passed ({len(names) - 1} tracked files).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
