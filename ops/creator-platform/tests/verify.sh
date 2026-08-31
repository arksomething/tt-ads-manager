#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
audit_script="${root_dir}/ops/creator-platform/bin/audit-credentials.mjs"
inventory_script="${root_dir}/ops/creator-platform/bin/inventory-project-envs.mjs"
catalog="${root_dir}/ops/creator-platform/credentials.catalog.json"
example="${root_dir}/ops/creator-platform/credentials.env.example"
vercel_project="${root_dir}/ops/creator-platform/vercel-project.json"
supabase_project="${root_dir}/ops/creator-platform/supabase-project.json"

node --check "${audit_script}"
node --check "${inventory_script}"
node -e 'JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"))' "${catalog}"
node -e '
  const project = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));
  if (project.projectName !== "gotall-creator-platform") process.exit(1);
  if (project.projectId !== "qubkgekdpyntuanzqqeu") process.exit(1);
  if (project.region !== "us-east-1" || project.state !== "creator-account-backend-hardened-live") process.exit(1);
  if (project.emailSender !== "accounts@gotall.app" || project.emailConfirmationRequired !== true) process.exit(1);
  if (project.passwordChangeReauthentication !== true || project.passwordChangeNotifications !== true) process.exit(1);
  if (!project.migrations?.includes("creator-platform/supabase/migrations/20260830113000_creator_account_hardening.sql")) process.exit(1);
  if (!project.migrations?.includes("creator-platform/supabase/migrations/20260830120000_creator_account_state_fix.sql")) process.exit(1);
  if (!project.migrations?.includes("creator-platform/supabase/migrations/20260831100000_creator_account_real_home.sql")) process.exit(1);
  if (project.agreementProvider !== null) process.exit(1);
' "${supabase_project}"
node -e '
  const project = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));
  if (project.projectName !== "gotall-creator-platform") process.exit(1);
  if (project.rootDirectory !== "creator-platform" || project.framework !== "nextjs") process.exit(1);
  if (project.deploymentState !== "creator-real-account-flow-live") process.exit(1);
  if (project.currentPreviewDomain !== "gotall-creator-platform.vercel.app") process.exit(1);
  if (!project.latestProductionDeploymentId?.startsWith("dpl_")) process.exit(1);
' "${vercel_project}"

node -e '
  const fs = require("node:fs");
  const catalog = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const example = fs.readFileSync(process.argv[2], "utf8");
  const discord = catalog.sources.find((source) => source.id === "hermes-discord-management");
  const collector = catalog.sources.find((source) => source.id === "owned-collector");
  const legacyWeb = catalog.sources.find((source) => source.id === "legacy-web-integrations");
  const creatorPlatform = catalog.sources.find((source) => source.id === "creator-platform-local");
  const agreements = catalog.platformRequirements.find((area) => area.area === "agreements");
  const creatorDiscordVariables = [
    "DISCORD_CLIENT_ID",
    "DISCORD_CLIENT_SECRET",
    "DISCORD_OAUTH_REDIRECT_URI",
    "DISCORD_GUILD_ID",
    "DISCORD_ONBOARDING_ROLE_ID",
    "DISCORD_ACTIVE_ROLE_ID",
    "DISCORD_AT_RISK_ROLE_ID",
    "DISCORD_TOP_PERFORMER_ROLE_ID",
  ];
  const creatorAuthVariables = [
    "APP_ORIGIN",
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
  ];
  const creatorAgreementVariables = [
    "AGREEMENT_PROVIDER",
    "AGREEMENT_API_KEY",
    "AGREEMENT_WEBHOOK_SECRET",
    "AGREEMENT_TEMPLATE_ID",
  ];
  if (discord?.path !== "${HOME}/.hermes/.env") process.exit(1);
  if (!discord.expectedVariables.includes("DISCORD_BOT_TOKEN")) process.exit(1);
  if (!collector?.expectedVariables.includes("INSTAGRAM_PROVIDER_CREDIT_RESERVE")) process.exit(1);
  if (creatorPlatform?.path !== "${HOME}/projects/tt-ads-manager/creator-platform/.env.local") process.exit(1);
  if (!creatorDiscordVariables.every((name) => creatorPlatform.expectedVariables.includes(name))) process.exit(1);
  if (!creatorAuthVariables.every((name) => creatorPlatform.expectedVariables.includes(name))) process.exit(1);
  if (!creatorAgreementVariables.every((name) => creatorPlatform.expectedVariables.includes(name))) process.exit(1);
  if (agreements?.state !== "signwell-key-installed-adapter-pending") process.exit(1);
  if (!agreements.available.some((item) => item.includes("sensitive AGREEMENT_API_KEY"))) process.exit(1);
  if (agreements.missing.includes("agreement API key")) process.exit(1);
  if (!agreements.missing.some((item) => item.includes("rotation of the chat-exposed SignWell API key"))) process.exit(1);
  if (legacyWeb.expectedVariables.some((name) => name.startsWith("DISCORD_"))) process.exit(1);
  if (!example.includes("INSTAGRAM_PROVIDER_CREDIT_RESERVE=100")) process.exit(1);
  if (!example.includes("DISCORD_CLIENT_ID=1534630446959427686")) process.exit(1);
  if (!example.includes("APP_ORIGIN=https://gotall-creator-platform.vercel.app")) process.exit(1);
  if (!example.includes("AGREEMENT_PROVIDER=signwell")) process.exit(1);
  if (example.includes("E_SIGNATURE_PROVIDER=")) process.exit(1);
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
