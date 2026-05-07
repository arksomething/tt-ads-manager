#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const webRoot = path.resolve(path.dirname(scriptPath), "..");
const repoRoot = path.resolve(webRoot, "..");

function parseArgs(argv) {
  const options = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (!arg.startsWith("--")) {
      continue;
    }

    const withoutPrefix = arg.slice(2);
    const equalsIndex = withoutPrefix.indexOf("=");
    let key = withoutPrefix;
    let value = true;

    if (equalsIndex >= 0) {
      key = withoutPrefix.slice(0, equalsIndex);
      value = withoutPrefix.slice(equalsIndex + 1);
    } else if (argv[index + 1] && !argv[index + 1].startsWith("--")) {
      value = argv[index + 1];
      index += 1;
    }

    options[key.replaceAll("-", "_")] = value;
  }

  return options;
}

function boolOption(options, name, fallback = false) {
  const value = options[name.replaceAll("-", "_")];

  if (value === undefined) {
    return fallback;
  }

  if (typeof value === "boolean") {
    return value;
  }

  return !["0", "false", "no", "off"].includes(String(value).toLowerCase());
}

function fileExists(filePath) {
  try {
    return statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function parseEnvValue(rawValue) {
  let value = rawValue.trim();

  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }

  return value
    .replaceAll("\\n", "\n")
    .replaceAll('\\"', '"')
    .replaceAll("\\'", "'");
}

function parseEnvFile(filePath) {
  const values = {};
  const text = readFileSync(filePath, "utf8");

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);

    if (match) {
      values[match[1]] = parseEnvValue(match[2]);
    }
  }

  return values;
}

function loadEnv(options) {
  const envFiles = [
    path.join(webRoot, ".env"),
    path.join(webRoot, ".env.local"),
    path.join(repoRoot, ".env"),
    path.join(repoRoot, ".env.local"),
    path.join(webRoot, ".vercel", ".env.production.local"),
    path.join(repoRoot, ".vercel", ".env.production.local"),
  ];

  if (options.env_file) {
    envFiles.push(path.resolve(process.cwd(), String(options.env_file)));
  }

  const loaded = {};

  for (const envFile of envFiles) {
    if (fileExists(envFile)) {
      Object.assign(loaded, parseEnvFile(envFile));
    }
  }

  return {
    ...loaded,
    ...process.env,
  };
}

function firstEnv(env, keys) {
  for (const key of keys) {
    const value = env[key];

    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }

  return null;
}

function required(value, label) {
  if (!value) {
    throw new Error(`Missing required ${label}.`);
  }

  return value;
}

function envLine(key, value) {
  return `${key}=${JSON.stringify(value ?? "")}`;
}

function buildCredentialEnv(env, options) {
  const supabaseUrl = required(
    firstEnv(env, ["SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"]),
    "SUPABASE_URL",
  );
  const supabaseServiceKey = required(
    firstEnv(env, ["SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SK"]),
    "SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SK",
  );
  const allowWrites = boolOption(options, "read_only", false) ? "0" : "1";
  const defaultOrg = options.default_org || env.TT_ADS_DEFAULT_ORG_SLUG || "";

  return [
    "# Installed by tt-ads-manager/scripts/install-openclaw-tiktok-ads.mjs",
    "# Keep this file chmod 600 inside the OpenClaw container.",
    envLine("TIKTOK_BUSINESS_BASE_URL", env.TIKTOK_BUSINESS_BASE_URL || "https://business-api.tiktok.com"),
    envLine("TIKTOK_AUTH_URL", env.TIKTOK_AUTH_URL || "https://business-api.tiktok.com/portal/auth"),
    envLine("TIKTOK_APP_ID", required(firstEnv(env, ["TIKTOK_APP_ID"]), "TIKTOK_APP_ID")),
    envLine("TIKTOK_SECRET", required(firstEnv(env, ["TIKTOK_SECRET"]), "TIKTOK_SECRET")),
    envLine("SUPABASE_URL", supabaseUrl),
    envLine("SUPABASE_SERVICE_ROLE_KEY", supabaseServiceKey),
    envLine("TT_ADS_ALLOW_WRITES", allowWrites),
    envLine("TT_ADS_DEFAULT_ORG_SLUG", defaultOrg),
    "",
  ].join("\n");
}

function run(command, args, options = {}) {
  execFileSync(command, args, {
    stdio: options.capture ? "pipe" : "inherit",
    encoding: "utf8",
  });
}

function shQuote(value) {
  return `'${String(value).replaceAll("'", "'\"'\"'")}'`;
}

function ssh(host, command) {
  run("ssh", ["-o", "BatchMode=yes", host, command]);
}

function scp(localPath, host, remotePath) {
  run("scp", ["-q", localPath, `${host}:${remotePath}`]);
}

function usage() {
  return `
Install TikTok Ads CLI access into the OpenClaw container.

Usage:
  node scripts/install-openclaw-tiktok-ads.mjs \\
    --host ubuntu@187.77.26.142 \\
    --container openclaw-rujh-openclaw-1 \\
    [--default-org <organization-slug>] \\
    [--read-only]

By default, the installed bot env permits writes, but every mutation still
requires an explicit --execute flag at command time. Pass --read-only to block
all write execution inside the CLI.
`.trim();
}

function main() {
  const options = parseArgs(process.argv.slice(2));

  if (boolOption(options, "help")) {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  const host = required(options.host, "--host");
  const container = required(options.container, "--container");
  const env = loadEnv(options);
  const tempDir = mkdtempSync(path.join(tmpdir(), "tt-ads-openclaw-"));
  const remoteDir = `/tmp/${path.basename(tempDir)}`;

  try {
    const cliSource = path.join(webRoot, "scripts", "tiktok-business-cli.mjs");
    const skillSource = path.join(repoRoot, "openclaw", "tiktok-ads", "SKILL.md");
    const cliTemp = path.join(tempDir, "tt-ads");
    const skillTemp = path.join(tempDir, "SKILL.md");
    const envTemp = path.join(tempDir, "tiktok-ads.env");

    writeFileSync(cliTemp, readFileSync(cliSource));
    writeFileSync(skillTemp, readFileSync(skillSource));
    writeFileSync(envTemp, buildCredentialEnv(env, options), { mode: 0o600 });
    chmodSync(cliTemp, 0o755);
    chmodSync(skillTemp, 0o644);

    ssh(host, `rm -rf ${shQuote(remoteDir)} && mkdir -p ${shQuote(remoteDir)}`);
    scp(cliTemp, host, `${remoteDir}/tt-ads`);
    scp(skillTemp, host, `${remoteDir}/SKILL.md`);
    scp(envTemp, host, `${remoteDir}/tiktok-ads.env`);
    ssh(
      host,
      [
        `sudo docker exec ${shQuote(container)} sh -lc ${shQuote(
          "mkdir -p /data/.openclaw/bin /data/.openclaw/credentials /data/.openclaw/skills/tiktok-ads && chmod 700 /data/.openclaw/credentials",
        )}`,
        `sudo docker cp ${shQuote(`${remoteDir}/tt-ads`)} ${shQuote(`${container}:/data/.openclaw/bin/tt-ads`)}`,
        `sudo docker cp ${shQuote(`${remoteDir}/SKILL.md`)} ${shQuote(`${container}:/data/.openclaw/skills/tiktok-ads/SKILL.md`)}`,
        `sudo docker cp ${shQuote(`${remoteDir}/tiktok-ads.env`)} ${shQuote(`${container}:/data/.openclaw/credentials/tiktok-ads.env`)}`,
        `sudo docker exec ${shQuote(container)} sh -lc ${shQuote(
          "chown -R node:node /data/.openclaw/bin /data/.openclaw/skills/tiktok-ads /data/.openclaw/credentials/tiktok-ads.env && chmod 755 /data/.openclaw/bin/tt-ads && chmod 600 /data/.openclaw/credentials/tiktok-ads.env",
        )}`,
        `sudo docker exec ${shQuote(container)} /data/.openclaw/bin/tt-ads env-check --env-file /data/.openclaw/credentials/tiktok-ads.env`,
        `rm -rf ${shQuote(remoteDir)}`,
      ].join(" && "),
    );

    process.stdout.write(
      `Installed tt-ads into ${container}. Use /data/.openclaw/bin/tt-ads help inside OpenClaw.\n`,
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

main();
