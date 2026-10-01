"""Filesystem views for diagnostics and delegated code work. No host home/network."""
from pathlib import Path

REPO=Path(__file__).resolve().parents[2]


def base():
    args=['/usr/bin/bwrap','--unshare-all','--die-with-parent','--new-session','--cap-drop','ALL',
          '--clearenv','--ro-bind','/usr','/usr','--symlink','usr/bin','/bin',
          '--symlink','usr/lib','/lib','--symlink','usr/lib64','/lib64',
          '--proc','/proc','--dev','/dev','--tmpfs','/tmp',
          '--dir',str(Path.home()),'--setenv','HOME',str(Path.home()),
          '--setenv','PATH','/opt/node/bin:/usr/bin:/bin', '--setenv','LANG','C.UTF-8']
    node=Path.home()/'.nvm/versions/node/v24.12.0'
    if node.exists():args+=['--ro-bind',str(node),'/opt/node']
    return args


def diagnostic(snapshot, command):
    return base()+['--ro-bind',str(snapshot),'/workspace','--chdir','/workspace','--','/bin/bash','-c',command]


def project(command, cwd):
    args=base()+['--dir',str(REPO)]
    # Expose source/dependencies, not repository dumps, environment files, git
    # history, personal credential stores, user bus sockets or other projects.
    files=['AGENTS.md','README.md','package.json']
    for app in ['web','creator-platform']:
        for p in (REPO/app).glob('*'):
            if p.is_file() and p.suffix in {'.json','.mjs','.js','.ts','.mts','.cts'} and not p.name.startswith('.'):
                files.append(str(p.relative_to(REPO)))
        for name in ['src','tests','test','public','node_modules','supabase']:
            path=REPO/app/name
            if path.exists() and not path.is_symlink():
                flag='--bind' if name in {'src','tests','test','public'} else '--ro-bind'
                args += [flag,str(path),str(path)]
    for rel in ['ops','supabase','ops/discord-support','ops/creator-platform/discord-onboarding-bot']:
        path=REPO/rel
        if path.exists():args += ['--bind' if rel=='ops/creator-platform/discord-onboarding-bot' else '--ro-bind',str(path),str(path)]
    for rel in files:
        path=REPO/rel
        if path.exists() and not path.is_symlink():args+=['--ro-bind',str(path),str(path)]
    for rel in ['web/.next','creator-platform/.next']:
        args+=['--dir',str(REPO/rel)]
    for app in ['web','creator-platform']:
        for name in ['.vite-temp','.vite']:
            path=REPO/app/'node_modules'/name
            if path.exists():args+=['--tmpfs',str(path)]
    return args+['--chdir',str(cwd),'--','/bin/bash','-c',command]
