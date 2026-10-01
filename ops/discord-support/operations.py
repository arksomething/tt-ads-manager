"""Staff terminal jobs. Authorization is supplied by the Discord adapter.

Jobs run as the existing host operator, independently of gateway restarts. This
is an operational capability, not an untrusted-code sandbox.
"""
from __future__ import annotations

import asyncio
import json
import os
import re
import signal
import subprocess
import sys
import time
import uuid
from pathlib import Path
import sandbox

REPO = Path(__file__).resolve().parents[2]
STATE = Path(os.environ.get("GOTALL_SUPPORT_STATE", str(Path.home()/".local/state/gotall-nanobot")))
JOBS = STATE / "jobs"


def save(path, value):
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(value, ensure_ascii=False))
    tmp.chmod(0o600)
    tmp.replace(path)


def redact(text):
    # Defense in depth, not a claim that arbitrary terminal output is secret-free.
    for path in [Path.home()/".codex/auth.json", Path.home()/".hermes/.env",
                 Path.home()/".config/gotall-nanobot/video.env",
                 REPO/"web/.env.local", REPO/"creator-platform/.env.local"]:
        if not path.exists():
            continue
        try:
            raw = path.read_text()
            if path.suffix == ".json":
                def strings(x):
                    if isinstance(x, dict):
                        for v in x.values(): yield from strings(v)
                    elif isinstance(x, str): yield x
                values = strings(json.loads(raw))
            else:
                values = [line.split("=", 1)[1].strip().strip('"\'') for line in raw.splitlines()
                          if "=" in line and not line.lstrip().startswith("#")]
            for value in values:
                # Public Discord IDs must survive inside source links.
                if value.isdecimal() and re.search(r'(?m)^[A-Z_]*(?:GUILD|CHANNEL|ROLE|USER|APPLICATION|OWNER)_ID=[\"\']?' + re.escape(value) + r'[\"\']?\s*$', raw):
                    continue
                if len(value) >= 12: text = text.replace(value, "[REDACTED_SECRET]")
        except (OSError, ValueError):
            pass
    text = re.sub(r"(?i)(authorization\s*[:=]\s*(?:bearer|bot)\s+)\S+", r"\1[REDACTED_SECRET]", text)
    text = re.sub(r"eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+", "[REDACTED_SECRET]", text)
    text = re.sub(r'(?i)("(?:access_token|refresh_token|token|api_key|secret|password)"\s*:\s*")[^"]*(")', r'\1[REDACTED_SECRET]\2', text)
    return text


async def start_job(command, cwd, identity, recipe=None):
    if not command.strip() or len(command) > 24000:
        raise ValueError("Command required, maximum 24000 characters")
    directory = Path(cwd or REPO).resolve()
    if not directory.is_dir(): raise ValueError("Working directory does not exist")
    JOBS.mkdir(parents=True, exist_ok=True, mode=0o700)
    source = {k:identity[k] for k in ('guild','channel','user_id','source_message')}
    jid = uuid.uuid5(uuid.NAMESPACE_URL, json.dumps([source, command, str(directory),recipe], sort_keys=True)).hex
    if (JOBS/f"{jid}.request.json").exists(): return job_status(jid, identity)
    request = {"job_id": jid, "command": command, "cwd": str(directory),
               "identity": identity, "created_at": time.time(), 'recipe':recipe}
    save(JOBS/f"{jid}.request.json", request)
    save(JOBS/f"{jid}.result.json", {"job_id": jid, "state": "starting"})
    # The user service manager owns the child, so restarting Nanobot does not
    # kill deployment midway. Never interpolate the command into this argv.
    proc = await asyncio.create_subprocess_exec(
        "systemd-run", "--user", "--quiet", "--collect", f"--unit=gotall-support-job-{jid}",
        "--property=RuntimeMaxSec=960", "--property=MemoryMax=3G", "--property=CPUQuota=150%",
        "--property=LimitFSIZE=16M",
        "--property=UMask=0077", "--property=StandardOutput=null", "--property=StandardError=null",
        f"--setenv=GOTALL_SUPPORT_STATE={STATE}",
        sys.executable, str(Path(__file__).resolve()), "run", jid,
        stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL)
    if await proc.wait():
        save(JOBS/f"{jid}.result.json", {"job_id": jid, "state": "launch_failed"})
        return {"job_id": jid, "state": "launch_failed", "note": "No command execution confirmed."}
    await asyncio.sleep(1)
    return job_status(jid, identity)


def job_status(jid, identity):
    if not re.fullmatch(r"[0-9a-f]{32}", jid): raise ValueError("Invalid job ID")
    request = json.loads((JOBS/f"{jid}.request.json").read_text())
    if request["identity"]["guild"] != identity["guild"]:
        raise PermissionError("Job belongs to another guild")
    result = json.loads((JOBS/f"{jid}.result.json").read_text())
    if result['state'] in {'completed','timed_out','launch_failed'}:
        (JOBS/f'{jid}.observed').touch(mode=0o600)
    if result["state"] in {"starting", "running"} and time.time()-request["created_at"] > 1000:
        return {"job_id": jid, "state": "interrupted_or_unknown",
                "note": "Inspect actual state before retrying; a mutation may have completed."}
    return result


def recent_jobs(identity, limit=6):
    """Small internal context for natural-language follow-ups, scoped to requester."""
    matches = []
    for path in JOBS.glob('*.request.json'):
        try:
            request = json.loads(path.read_text())
            actor = request['identity']
            if any(actor.get(k) != identity.get(k) for k in ('guild','channel','user_id')):
                continue
            if request['created_at'] < time.time()-86400: continue
            result = json.loads(path.with_name(request['job_id']+'.result.json').read_text())
            matches.append({'job_id':request['job_id'], 'source_message':actor['source_message'],
                            'created_at':request['created_at'], 'state':result['state']})
        except (OSError,ValueError,KeyError):
            continue
    return sorted(matches, key=lambda x:x['created_at'], reverse=True)[:limit]


def run_job(jid):
    if not re.fullmatch(r"[0-9a-f]{32}", jid): raise ValueError("Invalid job ID")
    request = json.loads((JOBS/f"{jid}.request.json").read_text())
    result_path = JOBS/f"{jid}.result.json"
    save(result_path, {"job_id": jid, "state": "running", "started_at": time.time()})
    # Only the bounded tail enters agent context. Raw logs stay in a 0600 file.
    log = JOBS/f"{jid}.log"
    with log.open("wb") as out:
        log.chmod(0o600)
        env = dict(os.environ)
        # The systemd manager's default Node is 18; these applications and the
        # onboarding SQLite runtime require the installed Node 24 toolchain.
        node_bin = Path.home()/'.nvm/versions/node/v24.12.0/bin'
        env['PATH'] = str(node_bin)+':'+env.get('PATH','/usr/local/bin:/usr/bin:/bin')
        if request.get('recipe')=='static_deploy':
            argv=[sys.executable,str(REPO/'ops/discord-support/deploy_static.py')]
        elif request.get('identity',{}).get('user_id') not in {None,'571179674323910667'}:
            argv=sandbox.project(request['command'],request['cwd'])
        else:
            argv=["/bin/bash", "-c", request["command"]]
        proc = subprocess.Popen(argv, cwd=request["cwd"], env=env,
                                stdout=out, stderr=subprocess.STDOUT, start_new_session=True)
        try:
            code = proc.wait(timeout=900)
            state = "completed"
        except subprocess.TimeoutExpired:
            os.killpg(proc.pid, signal.SIGKILL)
            proc.wait()
            code, state = None, "timed_out"
    with log.open("rb") as stream:
        stream.seek(max(0, log.stat().st_size-14000))
        output = redact(stream.read().decode("utf-8", errors="replace"))
    save(result_path, {"job_id": jid, "state": state, "exit_code": code,
                       "output": output, "finished_at": time.time(),
                       "note": "Exit status is command execution evidence, not verification of the requested business outcome."})
    log.unlink(missing_ok=True)


if __name__ == "__main__":
    run_job(sys.argv[2])
