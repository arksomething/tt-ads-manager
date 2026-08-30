#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
audit_script="${root_dir}/ops/creator-platform/bin/audit-credentials.mjs"
inventory_script="${root_dir}/ops/creator-platform/bin/inventory-project-envs.mjs"
catalog="${root_dir}/ops/creator-platform/credentials.catalog.json"
example="${root_dir}/ops/creator-platform/credentials.env.example"
vercel_project="${root_dir}/ops/creator-platform/vercel-project.json"

node --check "${audit_script}"
node --check "${inventory_script}"
node -e 'JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"))' "${catalog}"
node -e '
  const project = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));
  if (project.projectName !== "gotall-creator-platform") process.exit(1);
  if (project.rootDirectory !== "web" || project.framework !== "nextjs") process.exit(1);
  if (project.deploymentState !== "reserved-no-deployment") process.exit(1);
' "${vercel_project}"

node -e '
  const fs = require("node:fs");
  const catalog = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const example = fs.readFileSync(process.argv[2], "utf8");
  const discord = catalog.sources.find((source) => source.id === "hermes-discord-management");
  const collector = catalog.sources.find((source) => source.id === "owned-collector");
  if (discord?.path !== "${HOME}/.hermes/.env") process.exit(1);
  if (!discord.expectedVariables.includes("DISCORD_BOT_TOKEN")) process.exit(1);
  if (!collector?.expectedVariables.includes("INSTAGRAM_PROVIDER_CREDIT_RESERVE")) process.exit(1);
  if (!example.includes("INSTAGRAM_PROVIDER_CREDIT_RESERVE=100")) process.exit(1);
  if (!example.includes("DISCORD_CLIENT_ID=1534630446959427686")) process.exit(1);
  if (example.includes("DISCORD_CLIENT_ID=1433587504908341269")) process.exit(1);
' "${catalog}" "${example}"

if rg -n '(sk_live_|sk_test_|-----BEGIN .*PRIVATE KEY-----|[A-Za-z0-9_-]{48,})' \
  "${catalog}" "${example}"; then
  echo "credential contract appears to contain secret material" >&2
  exit 1
fi

report="$(node "${audit_script}")"
node -e '
  const report = JSON.parse(process.argv[1]);
  if (report.valuesExposed !== false) process.exit(1);
  if (!Array.isArray(report.sources) || report.sources.length === 0) process.exit(1);
' "${report}"

inventory="$(node "${inventory_script}")"
node -e '
  const inventory = JSON.parse(process.argv[1]);
  if (inventory.valuesExposed !== false) process.exit(1);
  if (inventory.fileCount !== inventory.files.length) process.exit(1);
  if (inventory.files.some((file) => Object.values(file.variables).some((state) => !["present", "empty"].includes(state)))) process.exit(1);
' "${inventory}"

echo "creator-platform credential catalog verified"
