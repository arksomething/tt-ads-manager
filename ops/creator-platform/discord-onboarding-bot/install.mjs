#!/usr/bin/env node

import { spawnSync } from "node:child_process";
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

sudo(["true"]);
run('/usr/bin/python3',['-c','import reportlab']);
// Validate every dependency before interrupting the existing service.
for (const name of ["bot.mjs", "flow.mjs", "workspace.mjs", "admin.mjs", "messages.mjs", "media.mjs", "timezone.mjs", "hubs.mjs", "deals.mjs", "audit.mjs"]) run(nodeSource, ["--check", join(here,name)]);
spawnSync("sudo", ["-n", "systemctl", "stop", "gotall-discord-onboarding-test.service"], { stdio: "ignore" });
sudo(["install", "-d", "-o", "root", "-g", "root", "-m", "0755", runtime]);
for (const name of ["bot.mjs", "flow.mjs", "workspace.mjs", "admin.mjs", "messages.mjs", "media.mjs", "timezone.mjs", "hubs.mjs", "deals.mjs", "audit.mjs"]) {
  sudo(["install", "-o", "root", "-g", "root", "-m", "0555", join(here,name), `${runtime}/${name}`]);
}
sudo(["install", "-o", "root", "-g", "root", "-m", "0755", nodeSource, nodeTarget]);
run(nodeTarget, ["--check", target]);
sudo(["install", "-m", "0644", unitSource, "/etc/systemd/system/gotall-discord-onboarding-test.service"]);
for(const name of ["hub-metrics-bridge.py","hub-payout-export.py","shared-deal-worker.py"])sudo(["install", "-o", "root", "-g", "root", "-m", "0555", join(here,name), `${runtime}/${name}`]);
for(const name of ["earnings-worker.py","earnings_audit.py","earnings_pdf.py","calculator-loader.mjs","export-calculated-earnings.mjs"])sudo(["install", "-o", "root", "-g", "root", "-m", "0555", join(here,name), `${runtime}/${name}`]);
for(const name of ["gotall-discord-hub-metrics.service","gotall-discord-hub-metrics.timer"])sudo(["install","-m","0644",join(here,name),`/etc/systemd/system/${name}`]);
for(const name of ["gotall-discord-deals.service","gotall-discord-deals.timer"])sudo(["install","-m","0644",join(here,name),`/etc/systemd/system/${name}`]);
for(const name of ["gotall-discord-earnings.service","gotall-discord-earnings.timer"])sudo(["install","-m","0644",join(here,name),`/etc/systemd/system/${name}`]);
sudo(["systemctl", "daemon-reload"]);
sudo(["systemctl", "enable", "--now", "gotall-discord-onboarding-test.service"]);
sudo(["systemctl", "is-active", "gotall-discord-onboarding-test.service"]);
sudo(["systemctl", "enable", "--now", "gotall-discord-hub-metrics.timer"]);
sudo(["systemctl", "enable", "--now", "gotall-discord-deals.timer"]);
sudo(["systemctl", "enable", "--now", "gotall-discord-earnings.timer"]);
process.stdout.write("GoTall onboarding test bot installed and active.\n");

