# Discord local-desktop handoff — 2026-09-07

> Historical checkpoint. The September 10 implementation integrates the flow and
> Blazie messages into the deployed test runtime. Read [README.md](README.md) and
> [MESSAGE-SOURCES.md](MESSAGE-SOURCES.md) for current behavior and verification.

This is an unfinished development checkpoint, not a production-readiness claim.
Read this file first when continuing the Codex task on the local Windows desktop.

## Get the checkpoint locally

Branch: `codex/discord-local-handoff-2026-09-07` on
`https://github.com/arksomething/tt-ads-manager` (public repository).
For a new local checkout:

```powershell
git clone --branch codex/discord-local-handoff-2026-09-07 https://github.com/arksomething/tt-ads-manager.git
cd tt-ads-manager
```

For an existing clean checkout, fetch origin and switch to that branch. Preserve
any local work first; do not hard-reset. Open this local folder in Codex and use
the continuation prompt at the end of this document.

## Scope and decisions

- Do all Discord writes and manual testing in Retconned's test server only:
  guild `1245112089647775877`. Do not change the production creator server.
- Application/bot: GoTall - Management, `1534630446959427686`.
- Creators onboard in Discord; the web app is principally for earnings/payment
  graphs. Each creator keeps an individual private channel as its category moves
  through New / Onboarding, Active Creators, Inactive / At Risk, Not Active
  Creators. Roles are access controls, not substitutes for individual channels.
- Application: name, phone, platform handles, location/timezone; best video is
  optional. Validate it only when supplied.
- Flow: warmup, staff account review, agreement, signed agreement, seven-day
  trial, active creator. Blazie follows up; account and agreement checks must
  actually gate progression. Provide clear guidance, payouts, policies and docs.
- Three missed posting days without notice get daily gentle reminders, followed
  by four full days At Risk with daily warnings that mention consequences.
  Approved exceptions pause enforcement. Do not kick real users in test mode.
- Correct spelling is `#partner`, but that requirement is under review. Do not
  make its absence a finalized rejection rule. `#yap`, the GoTall plug and TikTok
  @GoTall mention are requested checks; automated detection is not implemented.
- Requested tiers: 50k/$20, 100k/$50, 300k/$100, 1m/$300. Draft flow assumes the
  highest reached tier, not cumulative tiers; confirm payment semantics before
  enabling real settlement. Estimates are not payment proof.
- User wants the entire flow polished, functional and manually tested in the
  Discord UI using local desktop tools, not merely unit-tested.

## What exists, and what does not

`bot.mjs` is the existing standalone Node 24 Gateway/REST + SQLite test bot.
`creator-platform/test/discord-onboarding-bot.test.ts` covers its helper behavior.
Best-video optionality and deduplicated mention IDs were fixed previously.
Saved applications with incomplete welcome delivery are repaired on startup.

`flow.mjs` is a NEW, UNINTEGRATED draft of the lifecycle, UI cards, validation,
guarded transitions and updated inactivity policy. It passes a syntax check,
but has no dedicated behavior tests and is not imported by the running bot.
Do not present its behavior as deployed. Its test signing is a simulation,
not a real signature or legally executed agreement.

Important old-runtime gaps to fix:

- `/progress` allows arbitrary stage changes; real account/agreement gates and
  trial completion/review are incomplete.
- Old inactivity logic uses four total days, not the requested three plus four;
  At Risk scheduling/copy needs correction.
- Old `/video-check` asks staff for flags and uses misspelled `patner`; it is
  neither automatic content detection nor a production payout implementation.
- Staff authorization needs explicit role checks, not only owner/Manage Guild.
- Add durable, idempotent transitions/reminders and retry recovery; verify
  privacy/permissions when moving categories; prevent duplicate channels.
- The installer copies only `bot.mjs`; update it to copy dependencies before
  importing `flow.mjs` or adding other runtime modules.

Next: integrate/test the draft, improve creator/staff messages and controls,
exercise every transition and failure path, then manually test Discord as both
creator and staff. Check optional fields, retries/duplicate submissions, access
isolation, notices, timezones, all seven inactivity days, resume, trial and
agreement boundaries. Clearly separate simulated evidence from real provider
verification. Do not enable real payouts, contracts or production kicks merely
to complete testing.

## Existing remote runtime — reuse it, do not duplicate it

Remote SSH host alias used by the desktop project: `xps`.
Repository: `/home/ark296/projects/tt-ads-manager`.
Service: `gotall-discord-onboarding-test.service` (observed active at handoff).
Installed code: `/usr/local/lib/gotall-discord-onboarding-test/bot.mjs`.
Pinned Node: `/usr/local/lib/gotall-discord-onboarding-test/node`.
Persistent state: `/var/lib/gotall-discord-onboarding-test/onboarding.sqlite3`.
Service account: `gotall-discord`.
Unit source: `ops/creator-platform/systemd/gotall-discord-onboarding-test.service`.

The repo copy and installed copy are separate. The unfinished draft has not
been deployed. Do not reset/delete SQLite or run a second Gateway process with
the same token. The legacy production reminder worker is separate and out of
scope; do not stop or modify it.

The test start channel is `1545056638480810095`; existing Evan private channel
is `1545060421395021944`. Retconned user/owner is `571179674323910667`.
Use current Discord evidence to verify resources before making changes.

## Secrets: no regeneration required by this move

No credentials, cookies, private payout exports, runtime databases, or environment
files are included in this Git handoff. They remain intact on xps or in the
existing provider configuration. Moving development to Windows does not require
rotating/recreating working secrets. Existing missing, invalid or previously
flagged credentials are separate readiness issues; this handoff does not certify
all providers are production-ready.

Recommended approach: run the Codex task and Discord GUI on Windows, edit this
checkout there, and deploy/restart the existing test runtime over SSH on xps.
This needs no local copy of the bot token. Confirm local SSH access first:

```powershell
ssh xps "systemctl is-active gotall-discord-onboarding-test.service"
```

If the alias is absent, reuse the existing Codex remote connection's host/user
and SSH identity rather than generating new provider credentials.

Credential inventory (paths only, never print contents):

- Bot: `/etc/credstore.encrypted/gotall-creator-discord-bot-token.cred` on xps.
  systemd decrypts it into `CREDENTIALS_DIRECTORY/discord-bot-token` at runtime.
  Do not copy the host-encrypted file to Windows and expect it to decrypt there.
- Existing plaintext source, only if a deliberate private transfer is needed:
  `/home/ark296/.hermes/.env`, variable `DISCORD_BOT_TOKEN`. Extract only the
  required variable using a secret-safe transfer; never copy the whole file to
  the repository, terminal output, chat, or GitHub.
- Legacy web environment: `web/.env` and `web/.env.local` on xps; these are NOT
  creator-platform environment files. Keep app credentials purpose-isolated.
- Creator-platform production secrets are in the existing Vercel project
  `gotall-creator-platform`. No local `creator-platform/.env.local` was present
  at handoff. If local web execution is needed, retrieve existing values into
  an ignored local file using authenticated Vercel access with the explicit
  creator-platform project. Do not reuse the legacy root `.vercel` link.
- Full path/variable catalog: `ops/creator-platform/credentials.catalog.json`.
  It describes expected sources; verify existence instead of assuming all exist.

Do not enable a second bot runtime locally unless deliberately stopping only
the test service and securely transferring the needed credential/state. The
recommended local-GUI/remote-runtime workflow avoids that migration entirely.

## Verification and deployment

Node 24 is required (`node:sqlite`). From repo root:

```sh
node --check ops/creator-platform/discord-onboarding-bot/bot.mjs
node --check ops/creator-platform/discord-onboarding-bot/flow.mjs
npm --prefix creator-platform test -- --run test/discord-onboarding-bot.test.ts
npm run creator:verify
```

For legacy web changes, use its documented test/typecheck/build commands too.
The full snapshot includes concurrent creator-platform, tracker, web and audit
source work; it is intentionally not limited to the Discord files.

The installer is Linux/systemd-only. After reviewing and testing code, run it
on xps from the repo root, not on Windows:

```sh
node ops/creator-platform/discord-onboarding-bot/install.mjs
```

Fix its module-copy behavior before deploying an integrated `flow.mjs`.
Follow the existing isolated creator-platform deployment instructions for web
changes; do not cut over domains or deploy the legacy root project by mistake.

### Results at handoff

- Existing Discord helper tests: 7/7 passed; bot and draft flow syntax checks pass.
- Full creator-platform suite: 549 passed, 6 failed across 102 test files.
  Five failures are in `test/signwell-open-route.test.ts` (archive integrity,
  resume and error expectations); one is in
  `test/signwell-template-source-archive-migration.test.ts` (default-state regex).
  Accordingly `creator:verify` is not green; its chained later steps did not run.
- Independently run creator-platform lint, production build and typecheck all
  pass. Typecheck was rerun successfully after build; a first overlapping run
  raced Next's generated type files. Run these sequentially in future.
- Legacy web verification was not rerun for this checkpoint. No application or
  bot deployment was performed by this handoff operation.
- Gitleaks scanned the staged snapshot and nine outgoing existing commits.
  Findings were UUID fixtures in mocked provisioning/lease tests, not live
  credentials. An additional comparison against existing environment secrets
  found only a non-secret cookie-name setting, not cookie contents. Secret scans
  reduce risk but are not a blanket certification of the repository's history.
- `git diff --cached --check` passes after trailing-blank-line cleanup.
- Private artifacts remain on xps: ignored `payouts/`, `output/`, `tmp/`, local
  worktrees/caches, environments and runtime state were deliberately not pushed.

## Local desktop access

No general desktop-control tool was exposed to the remote task. The available
personal-browser connection did not return a usable session; no manual Discord
GUI test has been demonstrated. Enable Computer Use on the local desktop,
start/continue a local task, and verify actual tools and Discord login before
claiming manual coverage. The chat transcript itself is not stored by Git.

Suggested local task prompt:

> Read ops/creator-platform/discord-onboarding-bot/LOCAL-HANDOFF.md. Continue the
> unfinished Discord-native creator flow. Use my local Computer Use tools for
> manual Discord QA and the existing xps runtime/credentials over SSH. Keep all
> Discord writes in Retconned's test guild. Implement and verify the entire flow,
> preserve unrelated work, and report untested/provider-blocked pieces honestly.
