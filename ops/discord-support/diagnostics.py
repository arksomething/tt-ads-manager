"""Read-only repository source diagnostics, excluding private runtime artifacts."""
import asyncio
import json
import os
import re
import tempfile
import time
import uuid
from pathlib import Path

import sandbox
import operations

FILES={name:sandbox.REPO/'ops/creator-platform/discord-onboarding-bot'/name
       for name in ['messages.mjs','flow.mjs','workspace.mjs','hubs.mjs']}
FILES['calculations.ts']=sandbox.REPO/'web/src/server/ugc-pay/calculations.ts'

SOURCE_ROOTS={'web','creator-platform','ops','tools','supabase'}
EXCLUDED_DIRS={'node_modules','output','reports','payouts','tmp','data','fixtures',
               '__pycache__','dist','build','coverage','shell_snapshots','backups','exports','tests','__tests__','evals'}
SOURCE_EXTENSIONS={'.py','.js','.jsx','.ts','.tsx','.mjs','.cjs','.mts','.cts','.sql','.sh'}
DOC_NAMES={'README.md','AGENTS.md','ARCHITECTURE.md','DEPLOYMENT.md','support-policy.md',
           'SCRIPTS-TRIAL.md','ADMIN-GUIDE.md'}


def source_files(repo):
    for directory, dirs, files in os.walk(repo, followlinks=False):
        path=Path(directory)
        dirs[:]=sorted(d for d in dirs if not d.startswith('.') and d not in EXCLUDED_DIRS
                       and not (path/d).is_symlink() and (path!=repo or d in SOURCE_ROOTS))
        for name in sorted(files):
            file=path/name
            if name.startswith(('test_','evaluate_','eval_')) or any(part in name for part in ('.test.','.spec.')):continue
            if file.is_symlink() or name.startswith('.') or file.stat().st_size>512_000:continue
            if file.suffix in SOURCE_EXTENSIONS or name in DOC_NAMES:yield file


def snapshot_source(repo, target):
    total=0
    for file in source_files(repo):
        text=file.read_text(errors='replace')
        # Retain implementation, omit comments containing historical personal examples.
        if file.suffix in SOURCE_EXTENSIONS:
            text=re.sub(r'/\*[\s\S]*?\*/','',text)
            text='\n'.join(line for line in text.splitlines() if not line.lstrip().startswith(('//','#')))
        text=operations.redact(text)
        total+=len(text.encode())
        if total>24_000_000:raise ValueError('Repository source snapshot exceeded safety bound')
        destination=target/file.relative_to(repo)
        destination.parent.mkdir(parents=True,exist_ok=True)
        destination.write_text(text)


async def read_terminal(command):
    if not command.strip() or len(command)>4000:raise ValueError('Bounded diagnostic command required')
    directory=operations.STATE/'diagnostics';directory.mkdir(exist_ok=True,mode=0o700)
    with tempfile.TemporaryDirectory(prefix='view-',dir=directory) as temp:
        root=Path(temp)
        code=root/'code';code.mkdir()
        snapshot_source(sandbox.REPO,code)
        for name,path in FILES.items():
            # Comments contain historical named payout examples. Do not include
            # comments, git history, datasets, credentials or other creators' records.
            text=re.sub(r'/\*[\s\S]*?\*/','',path.read_text())
            text='\n'.join(l for l in text.splitlines() if not l.lstrip().startswith('//'))
            (code/name).write_text(operations.redact(text))
        statuses={}
        for service in ['gotall-discord-onboarding-test.service','creator-tracker-worker.service']:
            proc=await asyncio.create_subprocess_exec('systemctl','is-active',service,stdout=asyncio.subprocess.PIPE,stderr=asyncio.subprocess.DEVNULL)
            output,_=await proc.communicate();statuses[service]=output.decode().strip()
        (root/'status.json').write_text(json.dumps({'checked_at':time.time(),'services':statuses,
            'note':'Service liveness only; not payout coverage, payment confirmation or proof a feature works.'}))
        (root/'README.txt').write_text('Read code/ for repository source: web/, creator-platform/, ops/, tools/, supabase/ and selected operational docs. Use rg --files code, then targeted rg and sed. Data, reports, fixtures, hidden files, symlinks, dependencies, private artifacts and credentials are excluded. status.json is service liveness only. Use channel/report tools for your own records. Source describes implementation, not individual deal authority or proof of deployment; distinguish test workflows from production.')
        with tempfile.TemporaryFile() as output:
            proc=await asyncio.create_subprocess_exec('systemd-run','--user','--wait','--pipe','--quiet','--collect',
                '--unit=gotall-diagnostic-'+uuid.uuid4().hex,'--property=MemoryMax=256M','--property=TasksMax=32',
                '--property=RuntimeMaxSec=12','--property=LimitFSIZE=1M',*sandbox.diagnostic(root,command),
                stdout=output,stderr=output)
            try:await asyncio.wait_for(proc.wait(),timeout=18)
            except asyncio.TimeoutError:
                proc.kill();await proc.wait()
                return {'status':'timed_out','note':'Diagnostic did not complete.'}
            output.seek(0)
            return {'status':'completed','exit_code':proc.returncode,'output':output.read(12000).decode(errors='replace'),
                    'scope':'read-only repository source and selected docs; private artifacts excluded; service liveness is not coverage health'}
