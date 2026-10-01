#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { lstatSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (result.status !== 0) throw new Error((result.stderr || result.stdout || `${command} failed`).trim());
  return result.stdout.trim();
}

function sudo(args) { return run("sudo", ["-n", ...args]); }

const here = dirname(fileURLToPath(import.meta.url));
const source = join(here, "bot.mjs");
const unitSource = join(here, "../systemd/gotall-discord-onboarding-test.service");
const runtime = "/usr/local/lib/gotall-discord-onboarding-test";
const target = `${runtime}/bot.mjs`;
const nodeSource = join(homedir(), ".nvm/versions/node/v24.12.0/bin/node");
const nodeTarget = `${runtime}/node`;
run(nodeSource,['--check',join(here,'runtime-scope.mjs')]);

sudo(["true"]);
run('/usr/bin/python3',['-c','import reportlab']);
// Validate every dependency before interrupting the existing service.
for (const name of ["bot.mjs", "flow.mjs", "workspace.mjs", "admin.mjs", "messages.mjs", "media.mjs", "timezone.mjs", "hubs.mjs", "deals.mjs", "audit.mjs", "jotform.mjs", "jotform-webhook.mjs", "scripts.mjs", "inspiration.mjs", "resource-guidance.mjs", "app-access-guidance.mjs", "offboarding.mjs"]) run(nodeSource, ["--check", join(here,name)]);
const inspirationSource = join(here, "../../discord-inspiration-bot");
run("npm", ["run", "build", "--prefix", inspirationSource]);
spawnSync("sudo", ["-n", "systemctl", "stop", "gotall-discord-onboarding-test.service"], { stdio: "ignore" });
sudo(["install", "-d", "-o", "root", "-g", "root", "-m", "0755", runtime]);
sudo(['install','-o','root','-g','root','-m','0555',join(here,'runtime-scope.mjs'),`${runtime}/runtime-scope.mjs`]);
for (const name of ["bot.mjs", "flow.mjs", "workspace.mjs", "admin.mjs", "messages.mjs", "media.mjs", "timezone.mjs", "hubs.mjs", "deals.mjs", "audit.mjs", "jotform.mjs", "jotform-webhook.mjs", "scripts.mjs", "inspiration.mjs", "resource-guidance.mjs", "app-access-guidance.mjs", "offboarding.mjs"]) {
  sudo(["install", "-o", "root", "-g", "root", "-m", "0555", join(here,name), `${runtime}/${name}`]);
}
sudo(["install", "-d", "-m", "0755", `${runtime}/inspiration`]);
sudo(["rsync", "-a", "--chown=root:root", join(here, "assets"), `${runtime}/`]);
for (const name of ["dist", "assets", "package.json"]) sudo(["rsync", "-a", "--chown=root:root", join(inspirationSource, name), `${runtime}/inspiration/`]);
const modulesTarget = `${runtime}/inspiration/node_modules`;
if (lstatSync(modulesTarget, {throwIfNoEntry:false})?.isSymbolicLink()) sudo(["unlink", modulesTarget]);
sudo(["install", "-d", "-m", "0755", modulesTarget]);
sudo(["rsync", "-a", "--chown=root:root", `${inspirationSource}/node_modules/`, `${modulesTarget}/`]);
sudo(["install", "-o", "root", "-g", "root", "-m", "0755", nodeSource, nodeTarget]);
run(nodeTarget, ["--check", target]);
sudo(["install", "-m", "0644", unitSource, "/etc/systemd/system/gotall-discord-onboarding-test.service"]);
for(const name of ["hub-metrics-bridge.py","hub-payout-export.py","shared-deal-worker.py","tracker-bridge.py"])sudo(["install", "-o", "root", "-g", "root", "-m", "0555", join(here,name), `${runtime}/${name}`]);
for(const name of ["earnings-worker.py","owned-earnings-source.py","owned-earnings-loader.mjs","earnings_audit.py","earnings_pdf.py","calculator-loader.mjs","export-calculated-earnings.mjs"])sudo(["install", "-o", "root", "-g", "root", "-m", "0555", join(here,name), `${runtime}/${name}`]);
for(const name of ["gotall-discord-hub-metrics.service","gotall-discord-hub-metrics.timer"])sudo(["install","-m","0644",join(here,name),`/etc/systemd/system/${name}`]);
for(const name of ["gotall-discord-deals.service","gotall-discord-deals.timer"])sudo(["install","-m","0644",join(here,name),`/etc/systemd/system/${name}`]);
for(const name of ["gotall-discord-earnings.service","gotall-discord-earnings.timer"])sudo(["install","-m","0644",join(here,name),`/etc/systemd/system/${name}`]);
sudo(["install", "-d", "-m", "0755", "/etc/systemd/system/gotall-discord-onboarding-test.service.d"]);
sudo(["install", "-m", "0644", join(here, "inspiration.conf"), "/etc/systemd/system/gotall-discord-onboarding-test.service.d/inspiration.conf"]);
sudo(["systemctl", "daemon-reload"]);
sudo(["systemctl", "enable", "--now", "gotall-discord-onboarding-test.service"]);
sudo(["systemctl", "is-active", "gotall-discord-onboarding-test.service"]);
sudo(["systemctl", "enable", "--now", "gotall-discord-hub-metrics.timer"]);
sudo(["systemctl", "enable", "--now", "gotall-discord-deals.timer"]);
sudo(["systemctl", "enable", "--now", "gotall-discord-earnings.timer"]);
process.stdout.write("GoTall onboarding test bot installed and active.\n");
