# Deployment and rollback map

Run commands from `/home/ark296/projects/tt-ads-manager` unless stated otherwise.
Read applicable AGENTS.md. Preserve concurrent edits. Before deployment capture
the changed-file list, verify the relevant tests, identify the runtime and verify
the result on that target. Do not mistake a successful build for a live change.

## Nanobot AI support and operations

Verify: `~/.local/share/gotall-nanobot/venv/bin/python -m unittest discover -s ops/discord-support -p 'test_*.py' -v`.

Deploy: `~/.local/share/gotall-nanobot/venv/bin/python ops/discord-support/deploy.py`.
From the bot itself append `--after-message SOURCE_MESSAGE_ID`; its terminal job
waits until the foreground reply is delivered, then restarts safely. Policy and
operations skill are re-read each request; Python/config changes require restart.
The deployer runs tests before restart and verifies `gateway_ready` after restart.
It installs the unit but never regenerates Discord resources or resets config.

State: `~/.local/state/gotall-nanobot/`, with support.sqlite3, config.json, terminal
jobs and Discord action receipts. Preserve it on every release and rollback.
Rollback the requested code files from a captured pre-edit snapshot, run tests,
then deploy again. Before edits take your own current snapshot; the
`rollback-before-operations/` state directory is the September 12 baseline only.
Do not restore that old baseline over subsequent unrelated fixes.

Live checks: `systemctl --user is-active gotall-nanobot.service`; targeted
`journalctl --user -u gotall-nanobot.service` for fresh gateway_ready and real
delivery_verified. Logs deliberately omit creator content. Functional changes
need an actual behavior check as well. Do not post unsolicited creator tests.

## Static onboarding bot

Target is the existing Retconned TEST guild. Source directory is
`ops/creator-platform/discord-onboarding-bot/`. The system service executes
installed copies, so merely editing messages.mjs does not update live behavior.

Use Node 24 (available at `~/.nvm/versions/node/v24.12.0/bin/node`):

```sh
node --test ops/creator-platform/discord-onboarding-bot/workspace.test.mjs ops/creator-platform/discord-onboarding-bot/media.test.mjs
npm run creator:verify
node ops/creator-platform/discord-onboarding-bot/install.mjs
sudo -n systemctl is-active gotall-discord-onboarding-test.service
```

Run additional neighboring tests for changed features. Inspect any broader check
failure; do not repeat historical README claims as current results. Capture the
installed runtime directory before deployment. The installer copies modules,
updates the unit and restarts; it preserves SQLite. Verify fresh gateway readiness,
hash the relevant installed/source module, and inspect the actual changed card or
message. Existing Discord messages may need an explicit refresh; do not assume a
code update rewrites already-posted content. Use established sync handlers.

Rollback: reinstall the captured previous runtime and restart the same service;
preserve the database. Schema changes need their own compatible rollback plan.
Never deploy the test bot into the production guild without an explicit cutover.

## Legacy web

From web/: `npm test`, `npm run typecheck`, `npm run build`.
Deploy from REPO ROOT: `npx vercel deploy --prod` (never from web/, which becomes
web/web with the linked root). Keep `.vercel/` and `web/.vercel/` links intact.
Verify the target deployment and affected authenticated workflow. Capture prior
deployment ID/aliases and use Vercel rollback for that project if needed.

## Creator platform web

Run `npm run creator:verify` from repo root. Confirm project and organization IDs
against `ops/creator-platform/vercel-project.json`. Follow the isolated staging
procedure in `ops/creator-platform/README.md`, Deployment isolation section:
stage only reviewed creator-platform/, exclude .env/dependencies/build artifacts,
and pass `vercel deploy --dry --project gotall-creator-platform` scope inspection
before deployment. Do not deploy the entire repo or reuse the legacy link.
Preserve current production aliases; this does not authorize apex-domain cutover.

## Creator tracker / provider workers

Read `ops/creator-tracker/README.md` for the root-owned versioned release installer,
validation, release receipts and rollback procedure. Do not overwrite its running
source directly or reset coverage/credit guards to obtain a green check.
The tracking API has a separate worker described in
`ops/creator-platform/tracking-api/README.md`. Verify which worker owns the data.
HTTP `/api/health` proves liveness only; check coverage and source evidence too.

## Minimum change receipt

Record requested outcome + Discord source message, files/records changed, checks,
deployment target, live verification and rollback reference. For money questions
also distinguish calculated, finalized, recorded and provider-confirmed states.
Command jobs and Discord mutation receipts provide execution audit, not a substitute
for verifying that the user's requested outcome happened.

## Delegated deployment and privacy

Blazie uses deploy_static_bot, not a general host-shell installer. The fixed helper
runs the required verification inside his isolated project view, then copies only
fixed onboarding runtime modules, keeps a runtime backup, restarts the existing
test service and checks installed hashes. Failed checks block this route. The
owner retains the original deployment commands above. AI gateway and credential
handling code are read-only to delegated terminals and remain owner-managed.
