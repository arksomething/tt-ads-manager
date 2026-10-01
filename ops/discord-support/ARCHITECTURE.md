# Operations architecture map

Source map updated October 1, 2026. Deployment notes include historical verified
snapshots; recheck the named target before changing it.

## One Discord identity, several independent runtimes

Management bot ID: `1534630446959427686`.

| Component | Source | Runtime / responsibility |
| --- | --- | --- |
| AI support / operator | `ops/discord-support/support.py`, `operations.py`, policy/skill files | User service `gotall-nanobot.service`; runs this checkout directly; Nanobot + Codex login; mentions/replies, support cases, operator jobs |
| Static onboarding bot | `ops/creator-platform/discord-onboarding-bot/` | System service `gotall-discord-onboarding-test.service`; installed copies in `/usr/local/lib/gotall-discord-onboarding-test`; production cutover documented in `CUTOVER.md`, historical test suffix retained |
| Creator web Discord worker | `ops/creator-platform/discord-worker/` | System service `gotall-creator-discord-worker.service`; separate creator-platform reminder/role workflow |
| Legacy web / payout calculator | `web/` | Existing linked Vercel project; separate from creator-platform |
| Creator platform web / tracking API | `creator-platform/` | Vercel `gotall-creator-platform`; separate environment/database/deployment identity |
| Creator tracker | `ops/creator-tracker/`, selected web tracking code | System service `creator-tracker-worker.service`, loopback port 4410, root-owned versioned releases and `/var/lib/creator-tracker` state |

Hermes Discord is disabled; Hermes still serves other integrations. Do not enable
a second AI listener or replace unrelated Hermes configuration. Onboarding and
support legitimately share the bot credential and own different event handlers.

## Discord scope and identity

Production creators guild: `1400610531189985310` (GoTall Creators).
Test guild: `1245112089647775877` (Retconned). Do not describe a test-only change
as a production creator-server release. Static onboarding now targets production
after the September 14 cutover; the service name retains its historical test suffix.
Blazie is `1470834529077035195` / `judydoesugc`, a former staff member who left
September 16, 2026. Older role snapshots do not establish current access or
operator authority. Operator settings are in
`~/.local/state/gotall-nanobot/config.json`; runtime reads the authenticated member
for every privileged tool. Source policy governs decisions once identity passes.

## Static bot editing map

- `messages.mjs`: supplied onboarding copy, links and payment-help instructions.
- `flow.mjs`: lifecycle/state transitions, stage cards, policy constants and FAQ.
- `workspace.mjs`: command/component handling, review/notification workflows.
- `hubs.mjs`: hub channels, content and access synchronization.
- `admin.mjs`, `deals.mjs`: staff controls and deal workflows.
- `jotform.mjs`, `jotform-webhook.mjs`: signing evidence and webhook integration.
- `audit.mjs`, `earnings_audit.py`, `export-calculated-earnings.mjs`: earnings audit
  export and report generation. Read EARNINGS-AUDITS.md before treating output as final.
- `workspace.test.mjs`, `media.test.mjs` and neighboring tests cover changed paths.
- `AGENTS.md` in this directory defines required creator notifications, staff
  review routing and automatic channel naming. Preserve those behaviors.

State is `/var/lib/gotall-discord-onboarding-test/onboarding.sqlite3`. Resources
map logical roles/channels to Discord IDs. Use read-only SQLite connections for
inspection; use normal workflow code for changes whenever possible. Back up via
SQLite backup before direct corrections; copying only a live .sqlite3 omits WAL.

## Payout and account evidence

- `web/src/server/ugc-pay/calculations.ts` and corresponding tests: calculation
  semantics. `queries.ts`: actual selected inputs, deal windows and creator scope.
- `web/src/server/payouts/queries.ts`: recorded payouts; internal ledger status is
  not independently verified provider settlement.
- `ops/creator-platform/discord-onboarding-bot/SHARED-DEALS.md` and
  `EARNINGS-AUDITS.md`: deal publication/versioning and frozen audit snapshots.
- `ops/creator-platform/tracking-api/README.md`: tracking contracts and credentials.
  Organization-scoped access is broader than one creator; constrain the actual
  lookup to the requester and stable account IDs. Test records are not production.
- Reports in `payouts/`, `reports/`, `output/` may be historical/provisional. Match
  creator, period, version, underlying source coverage and actual provider evidence.
- Credentials reside in existing service credential stores and local environments;
  read only the necessary configured credential in-process. Never cat or transmit
  complete environment files. Availability of a shell does not prove a provider
  account is configured. Verify the actual supported provider API for payment checks.

September 12 setup check found DATABASE_URL in the legacy local environment but
no PayPal/Wise/Mercury/Stripe key names in the inspected legacy, creator local or
Hermes environment files. Other protected service stores were not exhaustively
inventoried. Do not advertise live transfer verification as connected based on
terminal access alone. Investigate the existing configured integration first;
if none is available, report the missing provider connection explicitly.

For missing views use tracking coverage health, not just HTTP 200. Empty inventory,
404 or deactivated accounts do not mean zero views or zero owed. See
`ops/creator-tracker/README.md` before repair/reconciliation/credit changes.

## Operator job execution

`run_command` starts `gotall-support-job-<id>.service` through the user systemd
manager. Owner jobs retain host-user access. Blazie jobs execute in a bubblewrap project
view without personal home files, credentials, network, host sudo or user-bus
sockets. Gateway/security files are read-only. A fixed deploy_static_bot route
performs verification and installation without executing source-controlled installers.
No new AI process is started. Job request/result files under Nanobot state contain
actor, source message and outcome. A job can survive a gateway deployment. Output
is bounded and known credentials redacted; this is not a guarantee for arbitrary
output. Skill instructions must avoid printing sensitive data in the first place.
Jobs explicitly prepend the installed Node 24.12.0 toolchain to PATH; the user
systemd manager otherwise resolves Node 18, which cannot run this onboarding code.

Do not give these tools to ordinary creators based on their message content.
Source cleanup should preserve separate entry points, database boundaries and
release targets. Do not merge these services merely because they share a bot.

## Slack and creator read-only diagnostics (current)

Hermes bot identity forwards accepted payouts to Michael Que only. Michael handles
sending payments and makes the final decision; bugs use the Discord support queue.
slack_forward.py exposes chat.postMessage only, to the configured recipient. No
personal Slack OAuth or history/search endpoint is exposed. Receiving details flow
from a creator-bound profile or that creator's own message to Michael; tool output
contains delivery status only. payment_profile.py owns the fixed read-only lookup.

sandbox.py defines the isolated filesystem views. diagnostics.py supplies sanitized
source snippets and current service-liveness data, not a raw repository or private
bank database. Source editing is available to owner/Blazie only. Personal credentials
and DMs are not mounted into non-owner command execution. Inspect actual checks in
test_forwarding.py when changing those boundaries.
