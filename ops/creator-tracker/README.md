# Creator tracker host units

These are the reviewed source definitions for the laptop execution plane. The
new design uses root system units and a root-owned atomic selector
`/opt/creator-tracker/current`; no production service executes the mutable
GoTall or tracker-ops worktree. It is not active merely because these files or a
release artifact exist: installation, activation, timer enablement, and source
coverage are separate gates.

Direct-source health is deliberately evidence-based rather than inferred from
process state. The durable request guard retains any account/IP circuit across
process exit and reboot; while a circuit is open, affected scheduler ticks make
no TikTok request. Eligible typed public-source blocking can use the guarded
paid fallback, while local pacing, parser failures, and untrusted runtime errors
spend no provider credits. Viral provider reconciliation remains a labeled
continuity source. An active process or successful timer exit is not proof that
creator coverage is complete.

## Unit inventory

| Unit | Schedule and command |
| --- | --- |
| `creator-tracker-worker.service` | Long-running loopback dashboard; restart after any unexpected exit |
| `creator-tracker-roster-refresh.timer` | Every 30 minutes; invokes due TikTok profile discovery |
| `creator-tracker-scheduler-tick.timer` | Every 3 minutes; drains the paced TikTok account queue, then evaluates day-seven windows |
| `creator-tracker-instagram-discovery.timer` | Every 30 minutes after the guarded credit rearm; drains due Instagram profile discovery |
| `creator-tracker-instagram-scheduler.timer` | Every 5 minutes after the guarded credit rearm; observes due Instagram accounts/videos while the shared three-minute finalizer evaluates targets |
| `creator-tracker-provider-reconcile.timer` | Every 12 hours; refreshes the labeled Viral migration safety net |
| `creator-tracker-canonical-delivery.timer` | Every minute; drains leased canonical outbox batches without holding the SQLite writer flock during HTTPS |
| `creator-tracker-raw-verifier.timer` | Every 5 minutes; independently verifies source CAS bytes, seals the verifier-owned archive, and writes attestations |
| `creator-tracker-dashboard-health.timer` | Every 2 minutes; checks dashboard, job markers, and owned-source coverage |

The timer names are historical: “roster refresh” does not fetch Viral.app every
30 minutes. It runs owned discovery against the already-imported roster and only
selects accounts whose database due time has arrived.

The TikTok scheduler wakes every three minutes, but the durable public-request
guard can admit at most one account-profile request every nine minutes and no
more than seven starts in any trailing hour, 80 in any trailing 12 hours, or
160 in any trailing 24 hours. The target-aware planner proves the current full
roster against those rolling limits before dispatch. A rejected wake performs
no TikTok request, and the guard state survives process exit and reboot.

All timer definitions have `Persistent=true`, so an enabled timer catches up
after suspend or reboot. This says nothing about a timer that is currently
disabled. Most timers use bounded fixed jitter. The raw verifier instead uses
an exact five-minute calendar so its run duration is not added to its capacity
interval; systemd naturally does not start a second copy while the oneshot is
active. Frequent local jobs also have boot-relative triggers. The provider
timer intentionally does not:
its former `OnActiveSec` re-armed after every daemon reload and caused extra
provider calls. It now runs only on its 12-hour calendar, with `Persistent=true`
handling an actually missed calendar event. Classic cron is not used.

`creator-tracker.slice` bounds all installed tracker jobs together:

- `CPUQuota=200%`
- `MemoryHigh=1536M`
- `MemoryMax=2G`
- `MemorySwapMax=512M`
- `TasksMax=384`
- systemd-oomd memory-pressure handling at 70%

## Tracking policy

Viral.app is the current continuity source and migration safety net, not
evidence that direct polling works. Provider and local roster counts are
volatile and must be read from the latest sealed capture and live database.
Stable IDs and per-account `maxVideos` settings are retained without treating
the provider row count as complete local coverage.

- A positive `maxVideos` is copied exactly as the profile discovery cap.
- Reaching that cap is `capped`, not proof of complete account coverage.
- `maxVideos=0` means profile-only, not unlimited. New-post discovery stays off,
  while existing seeded videos continue through metric polling.
- Provider-seeded counters are typed `provider` baselines and cannot masquerade
  as owned/direct cutoff evidence.

For the first seven days, each known publication receives fourteen fixed
targets at `published_at + 12h * n`, for `n=1..14`. Every target accepts a
complete owned-direct observation within three hours on either side. Failed
attempts retry the same target after 30 minutes only while that fixed window is
still open; historical expired windows remain review evidence and are never
backfilled with invented timing. From day 8 through day 89, one daily profile
scan per account updates all active older videos returned by that scan. This is
one request per account, not one request for all creators. At exactly 90 days,
metric counters freeze and the video leaves both due work and incidental metric
persistence while identity, availability, and evidence history remain.

Positive-limit TikTok discovery targets approximately two account scans per
day; profile-only accounts use one daily scan unless a first-week target is
already due. Instagram uses the same target/daily/freeze policy through its
guarded account batching. The frequent timers only drain due work in bounded
batches. Separate platform markers keep source failures independently visible.

Day-seven finalization evaluates the exact `published_at + 168 hours` target.
It selects the closest raw-verified owned-direct observation within the
symmetric three-hour window; an equally distant post-target sample wins the
tie. Missing, provider-only, invalid, or regressing evidence remains
`needs_review`; there is no interpolation, backdating, or payable zero.

## Configuration

The checked-in example contains no secrets and points to the active wrappers:

```bash
install -d -m 700 "$HOME/.config/creator-tracker"
install -m 600 ops/creator-tracker/creator-tracker.env.example \
  "$HOME/.config/creator-tracker/env"
```

Executable paths are not configurable. Every systemd role is hard-mapped by the
sealed supervisor to `/opt/creator-tracker/current/bin/*`; executable-looking
values left in the host environment are ignored and removed at activation.
`VIRAL_APP_CREDENTIALS_PATH` contains only the canonical absolute path to an
owner-only credential file. Credential values do not belong in unit files,
command lines, or this host environment file.

The owned Instagram adapter uses `SCRAPECREATORS_API_KEY` from GoTall's
owner-only `.env.local`; it is never copied into the systemd environment file,
unit, command line, marker, or journal. Keep the Instagram timers stopped until
that key is present, provider credit is healthy, and the documented bounded
smoke/rearm gate has passed.

The sealed wrapper holds descriptor-backed locks under
`/run/creator-tracker/locks/` and writes only non-secret status, success, and
failure markers below `/var/lib/creator-tracker/state/<role>/`. All SQLite
writes run as the single no-login `creator-tracker-writer` identity. Scheduled
discovery, polling, migration, and provider jobs additionally share the
`owned-tracker-writer` flock. Canonical delivery does not hold that flock
across HTTPS: its short SQLite lease/ack transactions are fenced and use the
same writer identity. Frequent schedulers use a
non-blocking lock and retry at their next tick; lower-frequency discovery and
provider jobs wait at most five minutes so a short poll cannot starve their
whole interval. Same-job or frequent-scheduler contention exits 75 and timer
units treat that as benign overlap. A provider writer-lock timeout exits 76 and
receives at most three consecutive systemd attempts inside a two-hour window.
Successful provider activations reset that counter; otherwise systemd would
count legitimate/manual successes and could suppress a later timer tick.
Runtime locks
disappear on reboot; kernel-held `flock` ownership means
there is no stale lock to clear after a crash. The dashboard and health roles
are read-only. Health takes both the shared writer flock and canonical
delivery's job flock non-blocking before its checkpoint-only coverage snapshot,
so either kind of in-flight WAL transaction defers that probe instead of
producing a false failure. The two shared locks grant only the health and writer
service identities read/write descriptor access; the health role still has no
database write permission. The raw verifier is read-only for SQLite and the source CAS,
while it alone can write the separate verified archive. The dashboard and
canonical uploader cannot write either CAS. The long-running worker updates
its status heartbeat every 30 seconds and owns a separate process group for
clean shutdown of launcher children.

Services execute the supervisor and health probe sealed inside the selected
root-owned release. Unit definitions are sealed in the same artifact and
activation installs those exact definitions before cutover. The supervisor
hard-maps roles and never trusts executable paths from the owner-writable host
environment. Every unit removes dynamic-loader and interpreter startup
variables before its first process, invokes absolute Bash in privileged mode,
pins a system-only `PATH`, and starts in the selected immutable application
tree. Activation verifies those effective systemd properties, not just the
unit-file text. The selector points to
`/opt/creator-tracker/releases/<sha256-release-id>`. That composite ID binds the
full GoTall commit, pinned Node hash, installer/verifier/activation code,
supervisor, health checker, and unit bundle. Every release also contains the
exact archived source, `npm ci` dependency tree, and deterministic sanitized
Next.js build. Files are root-owned, read-only, hash-manifested, and rejected
for extra files, changed modes, unsafe links, hard links, or ownership drift.

## Immutable collector releases

Build only from an explicit Git ref and from a preinstalled, root-owned
release-tools bundle. A user-owned copy of the installer refuses to elevate.
Seal the reviewed checked-in tools without root first; the command prints a
manifest-derived `release_tools_id` and `prepared_path` for independent review
and root import. The root import must preserve that exact ID as
`/opt/creator-tracker/release-tools/<release_tools_id>`, change the copied tree
to root ownership, keep it non-writable, and verify `TOOLS_MANIFEST.sha256`
before any bundled executable is invoked:

```bash
ops/creator-tracker/bin/prepare-release-tools-bundle.sh \
  --output-parent /var/tmp/creator-tracker-release-tools/ark296
```

The exact Node v24.20.0 Linux x64 archive is pinned by SHA-256 and installed
root-owned below `/opt/creator-tracker/node/v24.20.0`; NVM and other
user-writable Node/npm paths are rejected. The installer exports the selected
commit into root staging and delegates dependency/build code to the dedicated
no-login `creator-tracker-builder`, which has no home, credentials, sudo, or
service state. The networked dependency phase runs `npm ci --ignore-scripts`
and the required `npm audit`; lifecycle code and release verification run with
a private network and `npm rebuild --offline`.

The deterministic `.next/BUILD_ID` must equal the composite release ID. All
live Next dotenv names and project `.npmrc` files fail closed. The sealed
runtime does not use a repository database or imports directory. Those live at:

- `/var/lib/creator-tracker/state/gotall-viral.db`;
- `/var/lib/creator-tracker/imports`;
- `/var/lib/creator-tracker/raw-evidence-v1` (writer-owned source CAS); and
- `/var/lib/creator-tracker/verified-raw-evidence-v1` (verifier-owned archive).

The external dotenv file is never passed to Node. A sealed, non-executable
parser rejects duplicate, unknown, loader, Bash, Node, and TSX startup keys,
then emits only the small allowlist for the requested release role. Every Node
process starts through `env -i`; provider reconciliation receives only its
named, separately validated credential-file path, and the dashboard receives
only its authentication values. Canonical delivery is rendered only from
`/home/ark296/.config/creator-tracker/pending/canonical-ingestion.env`; its runtime role
gets the endpoint and HMAC keys, while the separate one-shot seed role gets
only the PostgreSQL URL, CA, and one validated organization. Raw verification
is rendered only from the independent
`/home/ark296/.config/creator-tracker/pending/raw-verifier.env`. Neither pending source is
deleted during activation or rollback.

Install is atomic within `/opt`: a hidden root-owned staging directory is fully
verified, then renamed to `/opt/creator-tracker/releases/<release-id>`. An
existing ID is never overwritten and a fresh build must reproduce the same
manifests byte-for-byte. Install
does not activate, restart a service, or enable a timer:

```bash
/opt/creator-tracker/release-tools/TOOLS_SHA256/bin/install-node-runtime.sh
/opt/creator-tracker/release-tools/TOOLS_SHA256/bin/install-collector-release.sh \
  --source-repo /home/ark296/projects/gotall-viral-dash \
  --ref FULL_GIT_COMMIT
```

Activation separately verifies the installed release, quiesces the system and
legacy-user timers first, and waits up to 95 minutes for an already-running
oneshot to finish normally. It never sends a stop signal to an active provider
or writer job. If the bounded drain cannot complete, activation aborts before
changing the persistent tuple and resumes only the timers and dashboard worker
that it found running. After a clean drain it stops the non-provider dashboard
worker, fences every job lock, and continues. This ordering prevents a release
from stranding the shared paid-provider credit lease halfway through a request.
With the writer fences held, a read-only database gate also refuses activation
if the shared lease is still `request_pending`, including a lease orphaned by
an earlier external stop.
Do not pre-stop the services by hand; invoke the sealed activator while the
current runtime is live and let it perform the drain.

Activation then installs the sealed unit definitions, verifies their exact
`/opt` launcher mapping, runs the effective unit checks for privileged Bash,
environment removal, `PATH`, and working directory, runs the
new release's explicit database migration followed by strict schema
verification, proves that freshly recreated WAL/SHM files remain writable only
by the writer and readable by each read-only role, and only then atomically
changes `current`. Legacy database/import migration is transactional and
rollbackable; root never performs recursive operations in the user-owned repo.
It does not restart or enable anything.

The first deployment uses an identity-only preparation step so the nonsecret
writer UID can be placed in the separate raw-verifier pending credential. This
step creates/verifies only service identities and state roots:

```bash
/opt/creator-tracker/releases/SHA256_RELEASE_ID/bin/activate-release \
  --prepare-identities
/opt/creator-tracker/releases/SHA256_RELEASE_ID/bin/run-raw-verifier-provision
/opt/creator-tracker/releases/SHA256_RELEASE_ID/bin/activate-release \
  --release SHA256_RELEASE_ID --expected-current none
```

The provision runner executes the immutable, reviewed provisioning CLI as
`ark296` in a transient service with `NoNewPrivileges=true`, an empty protected
home, no sudo/su path, and only the two fixed read-only inputs plus the pending
output directory exposed. Candidate JavaScript therefore never runs as root or
as an unconstrained sudo-capable login session.

On a first cutover, activation prints a root-owned transaction ID and records
an exact restoration boundary. The boundary includes the legacy SQLite main
file and its WAL, SHM, and rollback-journal sidecars; a stable two-pass legacy
imports inventory; the live database/imports/CAS/configuration trees; the
selector; exact managed system-unit, mask, wants, and requires links; and
root-owned content-hashed snapshots of safe single-link legacy user units.
Before the canonical seed or any provider, delivery, verifier, or other writer
tick, that committed cutover can be transactionally returned to the legacy
tuple:

```bash
/opt/creator-tracker/releases/SHA256_RELEASE_ID/bin/activate-release \
  --restore-legacy \
  --transaction PRINTED_FIRST_CUTOVER_TRANSACTION_ID \
  --expected-current SHA256_RELEASE_ID
```

The restoration preflights every destination and refuses if the selector,
sealed release, transaction marker, effective units or their persistent
enablement state, history, database/WAL state, provider imports, either CAS,
rendered configuration, or any legacy database sidecar has changed since the
commit. This is the explicit boundary that prevents discarding provider,
canonical-delivery, seed, or verifier archive writes. It restores the exact
legacy user/system unit state but does not restart anything. Activation and
restoration use a durable prepared/mutating/committed phase journal: the marker
and its parent are synced before the first mutation, affected data is synced
before commit, and marker removal is synced last. If either operation is
interrupted while `ACTIVATION_IN_PROGRESS` exists, stop all managed units and
run the same sealed activator with `--recover`; recovery reconciles the phase,
status, selector, and boundary. It never rolls a committed activation backward
merely because a stale crash marker survived.

Before starting any managed unit on the first canonical deployment, freeze and
review the sealed dry-run `planSha256`, then run the replay-safe apply
through the sealed one-shot runner. The runner refuses unless the selected
release is current, every managed service and timer is inactive, the activation
and writer locks are free, and the organization matches the dedicated sealed
credential. Candidate Node code runs only as `creator-tracker-writer` inside a
hardened transient systemd unit; there is no persistent seed service.

```bash
/opt/creator-tracker/current/bin/run-canonical-seed \
  --dry-run \
  --organization-id ORGANIZATION

/opt/creator-tracker/current/bin/run-canonical-seed \
  --apply \
  --organization-id ORGANIZATION \
  --confirm-plan-sha256 REVIEWED_PLAN_SHA256 \
  --confirm-legacy-observations-have-no-raw-evidence
```

Keep every persistent managed unit disabled after the seed. Run one provider
reconciliation capture, confirm the oneshot finished successfully, then run the
sealed completeness gate:

```bash
systemctl start creator-tracker-provider-reconcile.service
systemctl show creator-tracker-provider-reconcile.service \
  -p ActiveState -p Result -p ExecMainStatus
/opt/creator-tracker/current/bin/run-cutover-completeness
```

The gate freezes the latest provider capture by its persisted producer-run and
capture-set identities, monotonic first/last outbox IDs, and reconciled
projection totals. It holds the provider-writer fence and repeatedly runs
canonical delivery or independent raw verification only when the validated
read-only result identifies that queue as pending. It succeeds only at exactly
zero undelivered capture pages, with every capture producer run matched
centrally and every source manifest independently archived and attested. A
newer provider capture appearing during an anchored check is a mismatch, not a
silent pass. The one-hour bound is fail-closed; there is no fixed-count blind
loop. The gate writes a release- and result-hash-bound success marker used by
health. Only after that marker exists may the worker and approved timers be
enabled.

Verify the selected tree at any time without touching runtime state:

```bash
/opt/creator-tracker/current/bin/verify-release --installed \
  "$(readlink -f /opt/creator-tracker/current)" SHA256_RELEASE_ID
```

The release entrypoint hard-pins shadow mode and the external database path.
The built dashboard runs `next start` from that release's sanitized `.next`
artifact; TypeScript collectors use that release's `tsx`, source, dependencies,
and pinned Node executable. A concurrent edit in either repository therefore
cannot change an in-flight or later scheduled collector tick.

TikTok collection also uses a root-owned, versioned, checksum-pinned upstream
runtime at `/opt/creator-tracker/yt-dlp/2026.08.19/yt-dlp_linux`. The
application refuses an unexpected version, checksum, owner, mode, link, file
type, or missing Chrome impersonation target and never falls back to the
distribution's stale `/usr/bin/yt-dlp`. Install or repair the exact reviewed
runtime before enabling TikTok jobs:

```bash
/opt/creator-tracker/release-tools/TOOLS_SHA256/bin/install-yt-dlp-runtime.sh
```

The installer downloads only the pinned HTTPS GitHub release and tagged public
key, requires the reviewed signing-key fingerprint, verifies both signed
SHA-256 and SHA-512 manifests, then verifies the binary's hashes, reported
version, and impersonation transport before an atomic root-owned read-only
install. It is idempotent when the correct artifact is already present. The
full Linux release is required because it includes the browser-impersonation
transport TikTok's current web challenge needs; the dependency-light zipapp is
not an equivalent production runtime.

## Health contract

`creator-tracker-dashboard-health.service` succeeds only when all of these are
true:

- `http://127.0.0.1:4410/api/health` returns the configured HTTP 200;
- worker state is `running` and its heartbeat is no older than 120 seconds;
- the TikTok scheduler has succeeded in the last 600 seconds;
- TikTok discovery has succeeded in the last 5,400 seconds;
- the Instagram scheduler has succeeded in the last 660 seconds (covering its
  five-minute timer interval, bounded writer wait, and timer jitter; health
  itself defers while the writer is active);
- Instagram discovery has succeeded in the last 5,400 seconds;
- provider reconciliation has succeeded in the last 50,400 seconds;
- canonical delivery has succeeded in the last 300 seconds;
- raw verification has succeeded in the last 900 seconds;
- the current release has a hash-bound complete cutover result for one frozen
  provider capture, with zero pending delivery and raw attestations;
- the raw verifier's CAS byte/growth metrics are no older than 900 seconds;
- `/var/lib/creator-tracker` has at least the configured free-space reserve
  (20 GiB by default);
- no active TikTok account has unresolved discovery state;
- no active Instagram account has unresolved discovery state;
- no active Instagram video is more than 20 minutes overdue under its own
  12-hour hot or 24-hour old direct-observation cadence; and
- the newest complete direct TikTok observation is no older than 20 minutes.

The endpoint itself only proves web-process liveness. The health unit is
expected to stay failed while source coverage is degraded.

TikTok public-profile discovery and observation are live. The provider fallback
is also admitted in `auto` mode from a non-secret readiness marker; the health
role never receives the provider credential itself. Account-specific private,
embedding-disabled, empty-profile, and missing-item results remain explicit
coverage debt. Viral reconciliation is the roster/settings continuity source,
not the source of owned metric observations or new-video discovery.

Instagram discovery and observation are live on their persistent timers. The
latest paid run observed all 18 due rows, charged 24 credits, and left 24,724
credits with a 100-credit reserve; the following scheduler turns were idle and
free. Health remains degraded until the unresolved account and TikTok source
coverage debt are resolved. Timer/process liveness and a ready provider balance
are not claims of complete historical coverage. Legacy payouts remain in force.

## Raw-evidence retention and capacity

The source and independently sealed archive CAS are append-only and retained
indefinitely for this cutover. No scheduled job deletes raw evidence and this
release intentionally contains no destructive garbage collector. Each
successful verifier tick records source bytes, archive bytes, per-tick growth,
and filesystem availability; health fails if those metrics are stale, either
CAS shrinks unexpectedly, or the free-space reserve is breached. The verifier
runs on the fixed five-minute calendar with a 240-second tick budget, a
15-minute new-manifest SLA, a seven-day reverify interval, a one-day overdue
reverify SLA, and an explicit byte/object throughput model. These are capacity
guards, not a deletion policy.

Before any future archival or deletion is introduced, define and approve a
separate retention policy covering legal holds, authoritative archive location,
restore verification, minimum evidence age, capacity forecasts, and audited
destruction receipts. Until then, add storage or stop new capture when the
reserve alarm fires; do not delete either CAS to clear health.

## Verification and operation

Validate checked-in files before copying them:

```bash
bash -n ops/creator-tracker/bin/install-yt-dlp-runtime.sh
bash -n ops/creator-tracker/bin/install-collector-release.sh
bash -n ops/creator-tracker/bin/verify-collector-release.sh
bash -n ops/creator-tracker/bin/activate-collector-release.sh
bash -n ops/creator-tracker/bin/run-canonical-seed.sh
bash -n ops/creator-tracker/bin/run-cutover-completeness.sh
bash -n ops/creator-tracker/bin/run-instagram-credit-rearm.sh
bash -n ops/creator-tracker/bin/run-raw-verifier-provision.sh
bash -n ops/creator-tracker/bin/run-contained-job.sh
bash -n ops/creator-tracker/bin/check-dashboard-health.sh
python3 -I -m py_compile ops/creator-tracker/bin/*.py
systemd-analyze verify ops/creator-tracker/systemd/*.service \
  ops/creator-tracker/systemd/*.timer \
  ops/creator-tracker/systemd/*.slice
ops/creator-tracker/tests/verify.sh
```

Inspect live state with the system manager. A successful status is still not a
coverage claim:

```bash
systemctl status creator-tracker-worker.service
systemctl list-timers 'creator-tracker-*'
journalctl -u creator-tracker-provider-reconcile.service
journalctl -u creator-tracker-canonical-delivery.service
journalctl -u creator-tracker-raw-verifier.service
systemctl show creator-tracker.slice \
  -p MemoryCurrent -p MemoryPeak -p MemoryHigh -p MemoryMax \
  -p MemorySwapCurrent -p MemorySwapMax -p TasksCurrent
```

To reinstall reviewed copies after a unit change:

```bash
# Build/install a new composite release; activation quiesces timers and waits
# for existing jobs to drain before the migration gate and sealed-unit install.
/opt/creator-tracker/release-tools/TOOLS_SHA256/bin/install-collector-release.sh \
  --source-repo /home/ark296/projects/gotall-viral-dash \
  --ref FULL_GIT_COMMIT
/opt/creator-tracker/releases/SHA256_RELEASE_ID/bin/activate-release \
  --release SHA256_RELEASE_ID --expected-current CURRENT_RELEASE_OR_NONE
/opt/creator-tracker/current/bin/run-cutover-completeness
current_release="$(basename -- "$(readlink -f -- /opt/creator-tracker/current)")"
cutover_marker=/var/lib/creator-tracker/state/cutover-completeness/success
sudo grep -Fqx 'format_version=2' "$cutover_marker"
sudo grep -Fqx 'status=complete' "$cutover_marker"
test "$(sudo awk -F= '$1 == "release_id" { print $2 }' "$cutover_marker")" = \
  "$current_release"
sudo /bin/bash -c \
  '/opt/creator-tracker/current/bin/validate-cutover-result < /var/lib/creator-tracker/state/cutover-completeness/result.json' | \
  awk -F '\t' '$1 == "complete" && $2 == "producer_run_id" && $5 == 0 && $6 == 0 { valid = 1 } END { exit !valid }'
systemctl enable --now \
  creator-tracker-roster-refresh.timer \
  creator-tracker-scheduler-tick.timer \
  creator-tracker-instagram-discovery.timer \
  creator-tracker-instagram-scheduler.timer \
  creator-tracker-provider-reconcile.timer \
  creator-tracker-canonical-delivery.timer \
  creator-tracker-raw-verifier.timer \
  creator-tracker-worker.service \
  creator-tracker-dashboard-health.timer
```

The release-bound completeness gate is complete. The intentionally enabled set
is the worker plus all eight persistent timers: TikTok roster/scheduler,
Instagram discovery/scheduler, provider reconcile, canonical delivery, raw
verification, and dashboard health. The current 2026-09-03 deployment is sealed
release
`2397a18bf91487231f0c4817ad795cb74906e1cd333d299c87e7f7f38385f76b`
(app commit `62c5fb56cb8a36aa3c6944a252802f38bf71575e`), with a complete
45-page cutover for producer run `d3b5fa9f-a6fe-47d4-8602-361ea400adae`
and capture set
`61c6cd754be5a29a99ddf3417d0724ca223c9c86ed82070ed7fc47c9d8343170`.
The result has zero pending delivery rows and zero pending raw attestations.

A persisted TikTok circuit-open state suppresses network traffic without
disabling the timers, so paced collection resumes after cooldown without an
operator or reboot losing the schedule. Failed resource-aware profile retries
are labeled and admitted only in the 15-start recovery lane; a failed retry or
permanent account failure cannot reclaim the shared writer until its next
ordinary 12-hour/24-hour interval. The 2026-09-03 activation smoke planner was
feasible at 128/160 starts in the rolling 24-hour window and 68/80 in the busiest
12-hour window, with zero clustered target-window misses. Ordinary daily
deferrals stay visible but do not masquerade as first-week SLA failures.

The activation rearm and live Instagram smoke runs left the shared provider
guard `ready` at 24,619 credits with a 100-credit reserve as of 00:05 ET on
2026-09-03. A real discovery pass continued after one zero-charge terminal
not-found account and evaluated 360 returned videos across six due accounts;
real observation passes committed 392 rows. If future telemetry becomes
missing, malformed, or depleted, the spend guard still fails closed. Rearm only
after an operator independently confirms replenished launch capacity. The
sealed one-shot command accepts the exact confirmations below, makes one
identity-validated request, requires a reconstructed pre-request capacity of at
least 1,250 credits, writes durable audit evidence, and enables both persistent
Instagram timers only after every gate succeeds:

```bash
/opt/creator-tracker/current/bin/run-instagram-credit-rearm \
  --handle=KNOWN_INSTAGRAM_HANDLE \
  --confirm-provider-launch-balance-at-least-1250 \
  --confirm-provider-top-up-one-request
```

The activation smoke proves that collection and scheduling are live; it does
not erase inherited coverage debt. The 00:05 ET health snapshot still reported
8 unresolved TikTok accounts, 1 unresolved Instagram account, 380 overdue
TikTok videos, and 53 overdue Instagram videos. The persistent timers continue
to drain eligible work, while permanent account failures remain explicit.

Do not invoke that command without the stated capacity and one-request
confirmations. A low, malformed, missing, or identity-mismatched response
consumes at most the one confirmed request, remains fail-closed, and leaves both
timers disabled. Direct `systemctl enable` is not the rearm procedure.

Do not delete failures, ledger rows, or finalizations to clear a health alarm.
Resolve the adapter, credential, capacity, or network cause before re-enabling a
direct timer. Networked system units order after `network-online.target` and
collector paths still use bounded request timeouts, typed retries, idempotency,
and explicit coverage state.
