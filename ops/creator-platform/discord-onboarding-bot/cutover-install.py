"""Install the reviewed production roster into the existing single management runtime."""
import json,os,shutil,sqlite3,subprocess
from pathlib import Path

ROOT=Path('/home/ark296/projects/tt-ads-manager')
SOURCE=ROOT/'ops/creator-platform/discord-onboarding-bot'
BACKUP=Path('/var/lib/gotall-discord-cutover-20260914')
RUNTIME=Path('/usr/local/lib/gotall-discord-onboarding-test')
STATE=Path('/var/lib/gotall-discord-onboarding-test')
SUPPORT=Path('/home/ark296/.local/state/gotall-nanobot')
def run(*args):subprocess.run(args,check=True)
if os.geteuid()!=0:raise RuntimeError('Run as root for fixed service deployment')
if (BACKUP/'installed.json').exists():raise RuntimeError('Already installed; use the preserved rollback checkpoint')
applied=json.loads((BACKUP/'applied.json').read_text())
assert (BACKUP/'production-deal-allowlist.json').exists()
with sqlite3.connect(SUPPORT/'support.sqlite3') as db:
 if db.execute("SELECT count(*) FROM turns WHERE state='running'").fetchone()[0]:raise RuntimeError('Wait for active support turns before switching')
shutil.copytree(RUNTIME,BACKUP/'runtime-before',dirs_exist_ok=False)
for path in [Path('/etc/gotall-discord-deal-bindings.json'),SUPPORT/'config.json']:
 shutil.copy2(path,BACKUP/(path.name+'.before'))
timers=['gotall-discord-hub-metrics','gotall-discord-deals','gotall-discord-earnings','gotall-discord-tracker-bridge']
for name in timers:run('systemctl','stop',name+'.timer',name+'.service')
run('systemctl','stop','gotall-discord-onboarding-test.service')
with sqlite3.connect(STATE/'onboarding.sqlite3') as db,sqlite3.connect(BACKUP/'test-before.sqlite3') as dest:db.backup(dest)
for suffix in ['','-wal','-shm']:(STATE/('onboarding.sqlite3'+suffix)).unlink(missing_ok=True)
shutil.copy2(BACKUP/'production.sqlite3',STATE/'onboarding.sqlite3')
shutil.chown(STATE/'onboarding.sqlite3',user='gotall-discord',group='gotall-discord')
os.chmod(STATE/'onboarding.sqlite3',0o600)
for name in ['bot.mjs','flow.mjs','workspace.mjs','admin.mjs','scripts.mjs','resource-guidance.mjs','app-access-guidance.mjs','runtime-scope.mjs','tracker-bridge.py']:
 shutil.copyfile(SOURCE/name,RUNTIME/name);os.chmod(RUNTIME/name,0o555)
target=Path('/etc/systemd/system/gotall-discord-onboarding-test.service.d/production.conf')
shutil.copyfile(SOURCE/'production.conf',target)
shutil.copyfile(BACKUP/'production-deal-allowlist.json','/etc/gotall-discord-deal-bindings.json')
os.chmod('/etc/gotall-discord-deal-bindings.json',0o644)
r=applied['resources'];config=json.loads((SUPPORT/'config.json').read_text());g=config['guilds']['1400610531189985310']
g['staff_roles']=[r['role_staff'],r['role_admin']];g['admin_roles']=[r['role_admin']]
g['admin_commands_channel']=r['channel_admin_commands']
g['guide_channels']=[r['channel_'+k] for k in ['creator_guide','posting_checklist','resource_faq','app_access','assets','winning_formats','legacy_details']]
g['categories']=list(dict.fromkeys([str(x) for x in g['categories']]+[r['category_active'],r['category_onboarding'],r['category_at_risk'],r['category_inactive']]))
(SUPPORT/'config.json').write_text(json.dumps(config,indent=2)+'\n')
shutil.chown(SUPPORT/'config.json',user='ark296',group='ark296');os.chmod(SUPPORT/'config.json',0o600)
run('systemctl','daemon-reload')
run('systemctl','start','gotall-discord-onboarding-test.service')
for name in timers:run('systemctl','start',name+'.timer')
(BACKUP/'installed.json').write_text(json.dumps({'guild':'1400610531189985310','runtime':str(RUNTIME),'test_database_backup':'test-before.sqlite3'}))
print('Production runtime installed; backups retained. Verify Gateway and creator cards next.')
