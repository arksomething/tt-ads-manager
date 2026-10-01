"""Fixed deployment route for delegated edits; never execute an edited installer."""
import hashlib
import subprocess
import time
from pathlib import Path
import sandbox

REPO=sandbox.REPO
SOURCE=REPO/'ops/creator-platform/discord-onboarding-bot'
TARGET=Path('/usr/local/lib/gotall-discord-onboarding-test')
MODULES=['bot.mjs','flow.mjs','workspace.mjs','admin.mjs','messages.mjs','media.mjs','timezone.mjs',
         'hubs.mjs','deals.mjs','audit.mjs','jotform.mjs','jotform-webhook.mjs','runtime-scope.mjs',
         'scripts.mjs','inspiration.mjs','resource-guidance.mjs','app-access-guidance.mjs']


def main():
    subprocess.run(sandbox.project('node --test ops/creator-platform/discord-onboarding-bot/workspace.test.mjs ops/creator-platform/discord-onboarding-bot/media.test.mjs && npm run creator:verify',REPO),check=True)
    # Snapshot reviewed bytes so a concurrent edit cannot alter files between
    # syntax validation and installation. Only fixed runtime module names ship.
    import tempfile
    with tempfile.TemporaryDirectory(prefix='gotall-static-release-') as temp:
        staged=Path(temp)
        for name in MODULES:
            source=SOURCE/name
            if source.is_symlink():raise ValueError('Runtime module cannot be a symlink')
            (staged/name).write_bytes(source.read_bytes())
            subprocess.run([str(Path.home()/'.nvm/versions/node/v24.12.0/bin/node'),'--check',str(staged/name)],check=True)
        backup=Path('/var/lib/gotall-discord-onboarding-test')/('runtime-backup-'+str(int(time.time())))
        subprocess.run(['sudo','-n','cp','-a',str(TARGET),str(backup)],check=True)
        for name in MODULES:
            subprocess.run(['sudo','-n','install','-o','root','-g','root','-m','0555',str(staged/name),str(TARGET/name)],check=True)
        subprocess.run(['sudo','-n','systemctl','restart','gotall-discord-onboarding-test.service'],check=True)
        subprocess.run(['systemctl','is-active','gotall-discord-onboarding-test.service'],check=True)
        for name in MODULES:
            if hashlib.sha256((staged/name).read_bytes()).digest()!=hashlib.sha256((TARGET/name).read_bytes()).digest():
                raise RuntimeError('Installed bytes mismatch')
        print('Installed and verified runtime module hashes in the existing test-server service. Verify the changed Discord behavior next. Backup:',backup)


if __name__=='__main__':main()
