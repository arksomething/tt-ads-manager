#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
audit_script="${root_dir}/ops/creator-platform/bin/audit-credentials.mjs"
inventory_script="${root_dir}/ops/creator-platform/bin/inventory-project-envs.mjs"
catalog="${root_dir}/ops/creator-platform/credentials.catalog.json"
example="${root_dir}/ops/creator-platform/credentials.env.example"
vercel_project="${root_dir}/ops/creator-platform/vercel-project.json"
supabase_project="${root_dir}/ops/creator-platform/supabase-project.json"
google_cloud_project="${root_dir}/ops/creator-platform/google-cloud-project.json"
confirmation_template="${root_dir}/ops/creator-platform/auth-email-templates/confirm-signup.html"
recovery_template="${root_dir}/ops/creator-platform/auth-email-templates/reset-password.html"

node --check "${audit_script}"
node --check "${inventory_script}"
for template in "${confirmation_template}" "${recovery_template}"; do
  [[ -f "${template}" && ! -L "${template}" ]]
  grep -Fq '{{ .RedirectTo }}' "${template}"
  grep -Fq '{{ .TokenHash }}' "${template}"
  if grep -Fq '{{ .ConfirmationURL }}' "${template}"; then
    printf 'creator-platform auth template still uses the browser-fragment confirmation URL: %s\n' "${template}" >&2
    exit 1
  fi
done
grep -Fq 'type=email' "${confirmation_template}"
grep -Fq 'type=recovery' "${recovery_template}"
node -e 'JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"))' "${catalog}"
node -e '
  const project = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));
  if (project.projectName !== "gotall-creator-platform") process.exit(1);
  if (project.projectId !== "qubkgekdpyntuanzqqeu") process.exit(1);
  if (project.region !== "us-east-1" || project.state !== "creator-operations-and-ingestion-schema-live") process.exit(1);
  if (project.emailSender !== "accounts@gotall.app" || project.emailConfirmationRequired !== true) process.exit(1);
  if (project.passwordChangeReauthentication !== true || project.passwordChangeNotifications !== true) process.exit(1);
  if (!project.migrations?.includes("creator-platform/supabase/migrations/20260830113000_creator_account_hardening.sql")) process.exit(1);
  if (!project.migrations?.includes("creator-platform/supabase/migrations/20260830120000_creator_account_state_fix.sql")) process.exit(1);
  if (!project.migrations?.includes("creator-platform/supabase/migrations/20260831100000_creator_account_real_home.sql")) process.exit(1);
  if (!project.migrations?.includes("creator-platform/supabase/migrations/20260831140000_creator_discord_reminders.sql")) process.exit(1);
  const operationsMigrations = [
    "20260831160000_admin_application_review.sql",
    "20260831162000_creator_content_earnings.sql",
    "20260831163000_creator_content_library.sql",
    "20260831164000_creator_platform_verification.sql",
    "20260831165000_signwell_agreement_adapter.sql",
    "20260831166000_creator_admin_workspace.sql",
    "20260831167000_creator_tracker_ingestion_bridge.sql",
    "20260831168000_creator_platform_verification_worker.sql",
    "20260901090000_signwell_in_progress_resumable.sql",
    "20260902090000_agreement_assignment_safety.sql",
    "20260902093000_admin_deal_drafts.sql",
    "20260902100000_application_deal_assignment_guard.sql",
    "20260903121000_admin_participant_integrity.sql",
  ].map((name) => `creator-platform/supabase/migrations/${name}`);
  if (!project.migrations?.includes("creator-platform/supabase/migrations/20260831141000_creator_pgcrypto_search_path.sql")) process.exit(1);
  if (!operationsMigrations.every((migration) => project.migrations?.includes(migration))) process.exit(1);
  if (project.latestAppliedMigration !== "creator-platform/supabase/migrations/20260903121000_admin_participant_integrity.sql") process.exit(1);
  if (project.agreementProvider !== "signwell" || project.storageProvider !== "supabase-storage") process.exit(1);
  if (project.agreementAssignmentState !== "assigned-before-provider-lease-live") process.exit(1);
  if (project.dealControlPlaneState !== "admin-drafts-sealing-and-exact-approval-guard-live") process.exit(1);
  if (project.staffBootstrapState !== "one-explicit-active-admin-live") process.exit(1);
' "${supabase_project}"

node -e '
  const fs = require("fs");
  const project = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  if (project.projectId !== "gotall-creator-platform") process.exit(1);
  if (project.firebaseProjectId !== "gotall-creator-platform") process.exit(1);
  if (project.legacyGotallProjectModified !== false) process.exit(1);
  if (project.supabaseOAuthCallback !== "https://qubkgekdpyntuanzqqeu.supabase.co/auth/v1/callback") process.exit(1);
  if (project.billingEnabled !== true || project.identityPlatformInitialized !== true) process.exit(1);
  if (project.googleOAuthState !== "production-start-and-client-credentials-verified") process.exit(1);
' "${google_cloud_project}"
node -e '
  const project = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));
  if (project.projectName !== "gotall-creator-platform") process.exit(1);
  if (project.rootDirectory !== "creator-platform" || project.framework !== "nextjs") process.exit(1);
  if (project.deploymentState !== "creator-operations-web-live-provider-actions-gated") process.exit(1);
  if (project.currentPreviewDomain !== "gotall-creator-platform.vercel.app") process.exit(1);
  if (project.currentProductionAlias !== "gotall-creator-platform.vercel.app") process.exit(1);
  if (project.productionDomain !== "gotall-creator-platform.vercel.app") process.exit(1);
  if (project.intendedApexDomain !== "gethyperspeed.com" || project.discordCallbackDomain !== "gethyperspeed.com") process.exit(1);
  if (project.latestProductionDeploymentId !== "dpl_CT6MNLWkgAbFFRQKy9dwMcbVsnwn") process.exit(1);
  if (project.discordCallbackWorkerVersionId !== "84979fb5-bcd8-4fb8-99d7-58975f6e5a17") process.exit(1);
' "${vercel_project}"

node -e '
  const fs = require("node:fs");
  const catalog = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const example = fs.readFileSync(process.argv[2], "utf8");
  const discord = catalog.sources.find((source) => source.id === "hermes-discord-management");
  const discordAutomation = catalog.platformRequirements.find((area) => area.area === "discord-automation");
  const collector = catalog.sources.find((source) => source.id === "owned-collector");
  const collectorHost = catalog.sources.find((source) => source.id === "collector-host-config");
  const legacyWeb = catalog.sources.find((source) => source.id === "legacy-web-integrations");
  const creatorPlatform = catalog.sources.find((source) => source.id === "creator-platform-local");
  const agreements = catalog.platformRequirements.find((area) => area.area === "agreements");
  const collectorIngestion = catalog.platformRequirements.find((area) => area.area === "collector-cloud-ingestion");
  const verificationWorker = catalog.platformRequirements.find((area) => area.area === "campaign-account-verification-worker");
  const creatorDiscordVariables = [
    "DISCORD_CLIENT_ID",
    "DISCORD_CLIENT_SECRET",
    "DISCORD_OAUTH_REDIRECT_URI",
    "DISCORD_GUILD_ID",
    "DISCORD_GUILD_INVITE_URL",
    "DISCORD_REMINDER_WORKER_SECRET",
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
    "AGREEMENT_CREATOR_PLACEHOLDER",
    "AGREEMENT_ARCHIVE_ENABLED",
    "AGREEMENT_SEND_ENABLED",
    "AGREEMENT_TEST_MODE",
    "AGREEMENT_LIVE_MODE_APPROVED",
  ];
  const creatorIngestionVariables = [
    "CREATOR_INGEST_ALLOWED_ORGANIZATION_IDS",
    "CREATOR_INGEST_CURRENT_KEY_ID",
    "CREATOR_INGEST_CURRENT_SECRET_B64",
    "CREATOR_INGEST_PREVIOUS_KEY_ID",
    "CREATOR_INGEST_PREVIOUS_SECRET_B64",
    "CREATOR_TRACKER_V2_DATABASE_URL",
    "CREATOR_TRACKER_V2_DATABASE_CA_B64",
  ];
  if (discord?.path !== "${HOME}/.hermes/.env") process.exit(1);
  if (!discord.expectedVariables.includes("DISCORD_BOT_TOKEN")) process.exit(1);
  if (discordAutomation?.state !== "discord-infrastructure-live-launch-gated") process.exit(1);
  if (!discordAutomation.available.some((item) => item.includes("Cloudflare callback proxy version 84979fb5-bcd8-4fb8-99d7-58975f6e5a17"))) process.exit(1);
  if (!discordAutomation.available.some((item) => item.includes("healthy production heartbeat"))) process.exit(1);
  if (discordAutomation.missing.length !== 2) process.exit(1);
  if (!discordAutomation.missing.includes("rotation of the chat-exposed DISCORD_CLIENT_SECRET before launch")) process.exit(1);
  if (!discordAutomation.missing.includes("explicitly consenting OAuth, test-DM, role, opt-out, and disconnect E2E proof")) process.exit(1);
  if (!collector?.expectedVariables.includes("INSTAGRAM_PROVIDER_CREDIT_RESERVE")) process.exit(1);
  if (creatorPlatform?.path !== "${HOME}/projects/tt-ads-manager/creator-platform/.env.local") process.exit(1);
  if (!creatorDiscordVariables.every((name) => creatorPlatform.expectedVariables.includes(name))) process.exit(1);
  if (!creatorAuthVariables.every((name) => creatorPlatform.expectedVariables.includes(name))) process.exit(1);
  if (!creatorAgreementVariables.every((name) => creatorPlatform.expectedVariables.includes(name))) process.exit(1);
  const obsoleteAgreementVariables = [
    "AGREEMENT_TEMPLATE_ID",
    "AGREEMENT_TEMPLATE_TERMS_SHA256",
    "AGREEMENT_TEMPLATE_DEAL_SNAPSHOT_SHA256",
  ];
  if (!obsoleteAgreementVariables.every((name) => creatorPlatform.obsoleteVariables?.includes(name))) process.exit(1);
  if (obsoleteAgreementVariables.some((name) => creatorPlatform.expectedVariables.includes(name))) process.exit(1);
  if (!creatorIngestionVariables.every((name) => creatorPlatform.expectedVariables.includes(name))) process.exit(1);
  if (!collectorHost?.expectedVariables.includes("VIRAL_APP_CREDENTIALS_PATH")) process.exit(1);
  if (!collectorHost.expectedVariables.includes("CREATOR_TRACKER_DASHBOARD_HEALTH_URL")) process.exit(1);
  if (collectorHost.expectedVariables.some((name) => name.endsWith("_EXECUTABLE"))) process.exit(1);
  if (!creatorPlatform.expectedVariables.includes("CREATOR_VERIFICATION_WORKER_SECRET_B64")) process.exit(1);
  if (agreements?.state !== "signwell-adapter-live-send-gated") process.exit(1);
  if (!agreements.available.some((item) => item.includes("sensitive AGREEMENT_API_KEY"))) process.exit(1);
  if (!agreements.available.some((item) => item.includes("draft-before-send adapter"))) process.exit(1);
  if (agreements.missing.includes("agreement API key")) process.exit(1);
  if (!agreements.missing.some((item) => item.includes("rotation of the chat-exposed SignWell API key"))) process.exit(1);
  if (collectorIngestion?.state !== "production-dual-store-delivery-live") process.exit(1);
  if (!collectorIngestion.available.some((item) => item.includes("matching current HMAC credential"))) process.exit(1);
  if (!collectorIngestion.available.some((item) => item.includes("normalized creator_tracker_v2 store"))) process.exit(1);
  if (!collectorIngestion.available.some((item) => item.includes("45-page cutover"))) process.exit(1);
  if (collectorIngestion.missing.length !== 0) process.exit(1);
  if (verificationWorker?.state !== "contract-built-activation-gated") process.exit(1);
  if (!verificationWorker.missing.includes("CREATOR_VERIFICATION_WORKER_SECRET_B64")) process.exit(1);
  if (legacyWeb.expectedVariables.some((name) => name.startsWith("DISCORD_"))) process.exit(1);
  if (!example.includes("INSTAGRAM_PROVIDER_CREDIT_RESERVE=100")) process.exit(1);
  if (!example.includes("DISCORD_CLIENT_ID=1534630446959427686")) process.exit(1);
  if (!example.includes("DISCORD_GUILD_INVITE_URL=https://discord.gg/")) process.exit(1);
  if (!example.includes("DISCORD_REMINDER_WORKER_SECRET=")) process.exit(1);
  if (!example.includes("APP_ORIGIN=https://gotall-creator-platform.vercel.app")) process.exit(1);
  if (!example.includes("AGREEMENT_PROVIDER=signwell")) process.exit(1);
  if (!example.includes("Obsolete and ignored: AGREEMENT_TEMPLATE_ID")) process.exit(1);
  if (!example.includes("AGREEMENT_SEND_ENABLED=false")) process.exit(1);
  if (!example.includes("AGREEMENT_LIVE_MODE_APPROVED=false")) process.exit(1);
  if (!example.includes("CREATOR_INGEST_ALLOWED_ORGANIZATION_IDS=org_public_tt_ads_manager")) process.exit(1);
  if (!example.includes("CREATOR_TRACKER_V2_DATABASE_URL=")) process.exit(1);
  if (!example.includes("CREATOR_TRACKER_V2_DATABASE_CA_B64=")) process.exit(1);
  if (!example.includes("CREATOR_VERIFICATION_WORKER_SECRET_B64=")) process.exit(1);
  if (example.includes("E_SIGNATURE_PROVIDER=")) process.exit(1);
  if (example.includes("DISCORD_CLIENT_ID=1433587504908341269")) process.exit(1);
' "${catalog}" "${example}"

node - "${catalog}" "${example}" <<'NODE'
const fs = require("node:fs");
const catalog = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const example = fs.readFileSync(process.argv[3], "utf8");
const explicitSecret = /sk_(?:live|test)_|-----BEGIN .*PRIVATE KEY-----/u;
const opaqueToken = /[A-Za-z0-9_-]{48,}/u;

function rejectSecret(value, location) {
  if (explicitSecret.test(value) || opaqueToken.test(value)) {
    throw new Error(`credential contract appears to contain secret material at ${location}`);
  }
}

function inspect(value, location, parentKey = "") {
  if (parentKey === "expectedVariables") return;
  if (typeof value === "string") {
    rejectSecret(value, location);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => inspect(entry, `${location}[${index}]`, parentKey));
    return;
  }
  if (value && typeof value === "object") {
    Object.entries(value).forEach(([key, entry]) =>
      inspect(entry, `${location}.${key}`, key),
    );
  }
}

inspect(catalog, "credentials.catalog.json");
for (const [index, rawLine] of example.split(/\r?\n/u).entries()) {
  const line = rawLine.trim();
  if (line.length === 0 || line.startsWith("#")) continue;
  const separator = line.indexOf("=");
  if (separator < 1) throw new Error(`invalid credential example line ${index + 1}`);
  rejectSecret(line.slice(separator + 1), `credentials.env.example:${index + 1}`);
}
NODE

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
