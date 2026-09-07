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
spawnSync("sudo", ["-n", "systemctl", "stop", "gotall-discord-onboarding-test.service"], { stdio: "ignore" });
sudo(["install", "-d", "-o", "root", "-g", "root", "-m", "0755", runtime]);
sudo(["install", "-o", "root", "-g", "root", "-m", "0555", source, target]);
sudo(["install", "-o", "root", "-g", "root", "-m", "0755", nodeSource, nodeTarget]);
run(nodeTarget, ["--check", target]);
sudo(["install", "-m", "0644", unitSource, "/etc/systemd/system/gotall-discord-onboarding-test.service"]);
sudo(["systemctl", "daemon-reload"]);
sudo(["systemctl", "enable", "--now", "gotall-discord-onboarding-test.service"]);
sudo(["systemctl", "is-active", "gotall-discord-onboarding-test.service"]);
process.stdout.write("GoTall onboarding test bot installed and active.\n");
