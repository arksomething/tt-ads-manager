"""Verify and deploy the existing Nanobot service, without touching Discord setup."""
import argparse
import os
import shutil
import sqlite3
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
STATE = Path(os.environ.get('GOTALL_SUPPORT_STATE', str(Path.home()/'.local/state/gotall-nanobot')))
PYTHON = Path.home()/'.local/share/gotall-nanobot/venv/bin/python'


def run(*args, **kwargs):
    return subprocess.run(args, check=True, text=True, **kwargs)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--after-message', help='Wait for this request reply to be delivered before self-restart')
    args = parser.parse_args()
    run(str(PYTHON), '-m', 'unittest', 'discover', '-s', str(HERE), '-p', 'test_*.py', '-v')
    if args.after_message:
        deadline = time.monotonic()+360
        while time.monotonic() < deadline:
            with sqlite3.connect(f'file:{STATE}/support.sqlite3?mode=ro', uri=True) as db:
                delivered = db.execute('SELECT delivered FROM outbox WHERE id=?', ('reply-'+args.after_message,)).fetchone()
            if delivered and delivered[0]: break
            time.sleep(2)
        else:
            raise RuntimeError('Reply was not delivered; service left running without restart')
    destination = Path.home()/'.config/systemd/user/gotall-nanobot.service'
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(HERE/'gotall-nanobot.service', destination)
    since = time.strftime('%Y-%m-%d %H:%M:%S', time.localtime())
    run('systemctl', '--user', 'daemon-reload')
    run('systemctl', '--user', 'restart', 'gotall-nanobot.service')
    for _ in range(30):
        result = run('journalctl', '--user', '-u', 'gotall-nanobot.service', '--since', since,
                     '--no-pager', '-o', 'cat', capture_output=True)
        if 'gateway_ready' in result.stdout:
            run('systemctl', '--user', 'is-active', 'gotall-nanobot.service')
            run(str(PYTHON),str(HERE/'healthcheck.py'))
            print('Deployed Nanobot; fresh Discord gateway and authenticated model verified. State and other services preserved.')
            return
        time.sleep(1)
    raise RuntimeError('Restarted but no fresh gateway_ready observed; inspect service logs')


if __name__ == '__main__': main()
