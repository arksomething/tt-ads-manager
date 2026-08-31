#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function parseDotenvValue(source, key) {
  for (const rawLine of source.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1 || line.slice(0, separator).trim() !== key) continue;
    let value = line.slice(separator + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) value = value.slice(1, -1);
    return value;
  }
  return "";
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: options.input ? ["pipe", "pipe", "pipe"] : ["ignore", "pipe", "pipe"],
    input: options.input,
  });
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || "command failed").trim();
    throw new Error(`${command} failed: ${detail.slice(0, 300)}`);
  }
  return result.stdout.trim();
}

function sudo(args, options = {}) {
  return run("sudo", ["-n", ...args], options);
}

function encryptCredential(name, value, outputPath) {
  const temporaryPath = `/run/gotall-${name}-${randomUUID()}.cred`;
  try {
    sudo(
      [
        "systemd-creds",
        "encrypt",
        "--with-key=host",
        `--name=${name}`,
        "-",
        temporaryPath,
      ],
      { input: value },
    );
    sudo(["install", "-m", "0600", temporaryPath, outputPath]);
  } finally {
    const cleanup = spawnSync("sudo", ["-n", "unlink", temporaryPath], {
      stdio: "ignore",
    });
    if (cleanup.error) throw cleanup.error;
  }
}

function installRuntimeFile(sourcePath, targetPath, mode) {
  const temporaryPath = `${targetPath}.${randomUUID()}.tmp`;
  try {
    sudo([
      "install", "-o", "root", "-g", "root", "-m", mode,
      sourcePath, temporaryPath,
    ]);
    sudo(["mv", "-f", "--", temporaryPath, targetPath]);
  } finally {
    spawnSync("sudo", ["-n", "unlink", temporaryPath], { stdio: "ignore" });
  }
}

const start = process.argv.includes("--start");
const taskHome = homedir();
const here = dirname(fileURLToPath(import.meta.url));
const workerSource = join(here, "worker.mjs");
const unitSource = join(here, "../systemd/gotall-creator-discord-worker.service");
const unitTarget = "/etc/systemd/system/gotall-creator-discord-worker.service";
const credentialDirectory = "/etc/credstore.encrypted";
const serviceUser = "gotall-discord";
const runtimeDirectory = "/usr/local/lib/gotall-creator-discord-worker";
const stateDirectory = "/var/lib/gotall-creator-discord-worker";
const hermesEnv = readFileSync(join(taskHome, ".hermes/.env"), "utf8");
const botToken = parseDotenvValue(hermesEnv, "DISCORD_BOT_TOKEN");
const workerSecret = process.env.DISCORD_REMINDER_WORKER_SECRET?.trim() ?? "";
const requiredNode = join(taskHome, ".nvm/versions/node/v24.12.0/bin/node");

if (!botToken) throw new Error("The Management bot token is not installed in Hermes.");
if (Buffer.byteLength(workerSecret, "utf8") < 32) {
  throw new Error("DISCORD_REMINDER_WORKER_SECRET must contain at least 32 bytes.");
}
try {
  const version = run(requiredNode, ["--version"]);
  if (!version.startsWith("v24.")) throw new Error("unexpected version");
} catch {
  throw new Error("The pinned Node.js 24 runtime required by the SQLite journal is not installed.");
}

process.umask(0o077);
sudo(["true"]);
const serviceName = "gotall-creator-discord-worker.service";
const wasActive = spawnSync(
  "sudo",
  ["-n", "systemctl", "is-active", "--quiet", serviceName],
  { stdio: "ignore" },
).status === 0;
if (wasActive) sudo(["systemctl", "stop", serviceName]);

let serviceGroupExists = true;
try {
  run("getent", ["group", serviceUser]);
} catch {
  serviceGroupExists = false;
}
if (!serviceGroupExists) sudo(["groupadd", "--system", serviceUser]);

let serviceAccountExists = true;
try {
  run("getent", ["passwd", serviceUser]);
} catch {
  serviceAccountExists = false;
}
if (!serviceAccountExists) {
  sudo([
    "useradd",
    "--system",
    "--gid", serviceUser,
    "--home-dir", "/nonexistent",
    "--no-create-home",
    "--shell", "/usr/sbin/nologin",
    serviceUser,
  ]);
}
sudo([
  "usermod",
  "--gid", serviceUser,
  "--home", "/nonexistent",
  "--shell", "/usr/sbin/nologin",
  serviceUser,
]);
sudo(["install", "-d", "-o", "root", "-g", "root", "-m", "0755", runtimeDirectory]);
const installedNode = join(runtimeDirectory, "node");
const installedWorker = join(runtimeDirectory, "worker.mjs");
installRuntimeFile(requiredNode, installedNode, "0755");
installRuntimeFile(workerSource, installedWorker, "0555");
if (!run(installedNode, ["--version"]).startsWith("v24.")) {
  throw new Error("The installed creator Discord runtime is not Node.js 24.");
}
run(installedNode, ["--check", installedWorker]);
sudo([
  "install", "-d", "-o", serviceUser, "-g", serviceUser, "-m", "0700",
  stateDirectory,
]);
sudo(["chown", "-R", `${serviceUser}:${serviceUser}`, stateDirectory]);
sudo(["systemd-creds", "setup"]);
sudo(["install", "-d", "-m", "0700", credentialDirectory]);
encryptCredential(
  "discord-bot-token",
  botToken,
  join(credentialDirectory, "gotall-creator-discord-bot-token.cred"),
);
encryptCredential(
  "discord-worker-secret",
  workerSecret,
  join(credentialDirectory, "gotall-creator-discord-worker-secret.cred"),
);
sudo(["install", "-m", "0644", unitSource, unitTarget]);
sudo(["systemctl", "daemon-reload"]);

if (start) sudo(["systemctl", "enable", serviceName]);
if (start || wasActive) {
  sudo(["systemctl", "start", serviceName]);
  sudo(["systemctl", "is-active", serviceName]);
}

process.stdout.write(
  start
    ? "Creator Discord worker installed, enabled, and active.\n"
    : wasActive
      ? "Creator Discord worker installed and restarted in its prior enablement state.\n"
      : "Creator Discord worker runtime, credentials, and unit installed but not started.\n",
);
