# Creator tracker host units

These are the reviewed source units for the laptop execution plane. The original
TikTok, provider, dashboard, and health units were copied into
`~/.config/systemd/user`, configured through the owner-only
`~/.config/creator-tracker/env`, enabled, and started on 2026-08-28. Instagram
units are installed and loaded separately but remain disabled until they pass a
credentialed smoke test. Executables are absolute wrappers under
`/home/ark296/projects/gotall-viral-dash/ops/owned-tracker`.

The deployment is live but deliberately reports unhealthy coverage while source
blockers remain. An active unit or HTTP 200 is process evidence, not proof that
all creators are being tracked.

## Unit inventory

| Unit | Schedule and command |
| --- | --- |
| `creator-tracker-worker.service` | Long-running loopback dashboard; restart after any unexpected exit |
| `creator-tracker-roster-refresh.timer` | Every 30 minutes; invokes due TikTok profile discovery |
| `creator-tracker-scheduler-tick.timer` | Every 5 minutes; observes due videos, then evaluates day-seven windows |
| `creator-tracker-instagram-discovery.timer` | Installed but disabled; every 30 minutes after credentialed smoke, drains due Instagram profile discovery |
| `creator-tracker-instagram-scheduler.timer` | Installed but disabled; every 5 minutes after credentialed smoke, observes due Instagram videos and evaluates day-seven windows |
| `creator-tracker-provider-reconcile.timer` | Every 12 hours; refreshes the labeled Viral migration safety net |
| `creator-tracker-dashboard-health.timer` | Every 2 minutes; checks dashboard, job markers, and owned-source coverage |

The timer names are historical: “roster refresh” does not fetch Viral.app every
30 minutes. It runs owned discovery against the already-imported roster and only
selects accounts whose database due time has arrived.

All timers have `Persistent=true`, wall-clock schedules, bounded jitter, and
boot triggers so missed work catches up after suspend, reboot, or logout. Linger
is enabled for `ark296`; classic cron is not used.

`creator-tracker.slice` bounds all installed tracker jobs together:

- `CPUQuota=200%`
- `MemoryHigh=1536M`
- `MemoryMax=2G`
- `MemorySwapMax=512M`
- `TasksMax=384`
- systemd-oomd memory-pressure handling at 70%

## Tracking policy

Viral.app is the migration safety net, not the canonical polling engine. The captured
2026-08-28 export contains 98 accounts (90 TikTok, 8 Instagram) and 4,318 linked
videos (3,875 TikTok, 443 Instagram). Stable IDs and per-account `maxVideos`
settings are retained.

- A positive `maxVideos` is copied exactly as the profile discovery cap.
- Reaching that cap is `capped`, not proof of complete account coverage.
- `maxVideos=0` means profile-only, not unlimited. New-post discovery stays off,
  while existing seeded videos continue through metric polling.
- Provider-seeded counters are typed `provider` baselines and cannot masquerade
  as owned/direct cutoff evidence.

TikTok and Instagram account discovery are due every 12 hours. Video counter
observations are due every 12 hours from publication through the exact 168-hour
cutoff, then every 24 hours. The frequent timers only drain due work in bounded
batches. Failed discovery and observation attempts wait 30 minutes before
retry. The separate platform units make success markers and source failures
independently visible while sharing the same resource slice and ledger.

Day-seven finalization uses `published_at + 168 hours` with an inclusive 12-hour
grace. It retains both bounding observations, stores slippage, and selects only
the first complete direct post-cutoff observation within grace. Missing,
provider-only, invalid, or regressing evidence remains `needs_review`; there is
no interpolation or payable zero.

## Configuration

The checked-in example contains no secrets and points to the active wrappers:

```bash
install -d -m 700 "$HOME/.config/creator-tracker"
install -m 600 ops/creator-tracker/creator-tracker.env.example \
  "$HOME/.config/creator-tracker/env"
```

Executable values must remain absolute executable paths with no inline shell or
arguments. `VIRAL_APP_CREDENTIALS_PATH` contains only the canonical absolute
path to an owner-only credential file. Credential values do not belong in unit
files, command lines, or this host environment file.

The owned Instagram adapter uses `SCRAPECREATORS_API_KEY` from GoTall's
owner-only `.env.local`; it is never copied into the systemd environment file,
unit, command line, marker, or journal. Keep the Instagram executable variables
unset in the installed host environment until that key is present and a
single-account read-only-source smoke test has passed.

The generic wrapper holds descriptor-backed locks under
`$XDG_RUNTIME_DIR/creator-tracker/locks/` and writes only non-secret status,
success, and failure markers under
`~/.local/state/creator-tracker/health/`. Every SQLite writer shares the
`owned-tracker-writer` lock, preventing discovery, polling, provider import, and
Instagram jobs from overlapping WAL ownership. Frequent schedulers use a
non-blocking lock and retry at their next tick; lower-frequency discovery and
provider jobs wait at most five minutes so a short poll cannot starve their
whole interval. Same-job or frequent-scheduler contention exits 75 and timer
units treat that as benign overlap. A provider writer-lock timeout exits 76 and
receives at most three systemd attempts inside a two-hour window. Runtime locks
disappear on reboot; kernel-held `flock` ownership means
there is no stale lock to clear after a crash. The long-running worker updates
its status heartbeat every 30 seconds and owns a separate process group for
clean shutdown of launcher children.

Services execute reviewed copies of the supervisor and health probe from
`~/.local/libexec/creator-tracker/`, not the mutable repository files. Update
those installed copies only after the source self-test passes; compare them
byte-for-byte during audits. Collector entry points remain absolute paths in the
private host environment so their deployment target stays explicit.

TikTok collection also uses a root-owned, versioned, checksum-pinned upstream
runtime at `/opt/creator-tracker/yt-dlp/2026.08.19/yt-dlp_linux`. The
application refuses an unexpected version, checksum, owner, mode, link, file
type, or missing Chrome impersonation target and never falls back to the
distribution's stale `/usr/bin/yt-dlp`. Install or repair the exact reviewed
runtime before enabling TikTok jobs:

```bash
ops/creator-tracker/bin/install-yt-dlp-runtime.sh
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
- when its executable is configured, the Instagram scheduler has succeeded in
  the last 600 seconds;
- when its executable is configured, Instagram discovery has succeeded in the
  last 5,400 seconds;
- provider reconciliation has succeeded in the last 50,400 seconds;
- no active TikTok account has unresolved discovery state;
- no active Instagram account has unresolved discovery state;
- no active Instagram video is more than 20 minutes overdue under its own
  12-hour hot or 24-hour old direct-observation cadence; and
- the newest complete direct TikTok observation is no older than 20 minutes.

The endpoint itself only proves web-process liveness. The health unit is
expected to stay failed while source coverage is degraded.

As of the 2026-08-29 activation audit, TikTok is not subject to a blanket
laptop/IP block. The root-owned, signed-manifest-verified yt-dlp 2026.08.19
runtime resolves discovery for 86 of 90 active TikTok accounts and never falls
back to `/usr/bin/yt-dlp`. The four account-specific exceptions are
`dgetstaller` and `gotall.dan` (private or embedding-disabled), `gar.213`
(private), and `gt66784` (HTTP 403). Direct catch-up has produced 55 complete
observations across 54 of 4,563 TikTok videos and 13 locked day-seven finals;
remaining overdue work drains through bounded persistent timer ticks. The
optional ScrapeCreators TikTok fallback remains explicitly disabled with
`TIKTOK_FALLBACK=off` even though a key is present; public TikTok collection
itself is functioning.

Instagram's adapter and unit files are installed. The owner-only key passed an
exactly-one-request identity/counter smoke; a separate bounded 3-request
discovery resolved 1 account and wrote 29 complete direct video observations.
Seven accounts and 422 videos remain overdue. Both Instagram timers remain
disabled because the last provider response reported only 95 credits, which is
not enough for the remaining 451-video inventory and recurring cadence. The
adapter must not be described as fully live until provider capacity is
replenished, the full bounded catch-up completes, and both success markers are
fresh. Legacy payouts remain in force.

## Verification and operation

Validate checked-in files before copying them:

```bash
bash -n ops/creator-tracker/bin/install-yt-dlp-runtime.sh
bash -n ops/creator-tracker/bin/run-contained-job.sh
bash -n ops/creator-tracker/bin/check-dashboard-health.sh
systemd-analyze --user verify ops/creator-tracker/systemd/*.service \
  ops/creator-tracker/systemd/*.timer \
  ops/creator-tracker/systemd/*.slice
ops/creator-tracker/tests/verify.sh
```

Inspect live state with the managed user-service tools:

```bash
agent-jobctl verify
agent-jobctl services
agent-jobctl timers
agent-jobctl status creator-tracker-worker.service
agent-jobctl logs creator-tracker-roster-refresh.service
agent-jobctl logs creator-tracker-scheduler-tick.service
agent-jobctl logs creator-tracker-instagram-discovery.service
agent-jobctl logs creator-tracker-instagram-scheduler.service
agent-jobctl logs creator-tracker-provider-reconcile.service
agent-jobctl logs creator-tracker-dashboard-health.service
systemctl --user show creator-tracker.slice \
  -p MemoryCurrent -p MemoryPeak -p MemoryHigh -p MemoryMax \
  -p MemorySwapCurrent -p MemorySwapMax -p TasksCurrent
```

To reinstall reviewed copies after a unit change:

```bash
install -d -m 700 "$HOME/.local/libexec/creator-tracker"
install -m 700 \
  ops/creator-tracker/bin/run-contained-job.sh \
  ops/creator-tracker/bin/check-dashboard-health.sh \
  "$HOME/.local/libexec/creator-tracker/"
install -d -m 700 "$HOME/.config/systemd/user"
install -m 644 ops/creator-tracker/systemd/* \
  "$HOME/.config/systemd/user/"
agent-jobctl reload
systemd-analyze --user verify \
  "$HOME/.config/systemd/user/creator-tracker"*.service \
  "$HOME/.config/systemd/user/creator-tracker"*.timer \
  "$HOME/.config/systemd/user/creator-tracker.slice"
agent-jobctl enable creator-tracker-roster-refresh.timer
agent-jobctl enable creator-tracker-scheduler-tick.timer
agent-jobctl enable creator-tracker-provider-reconcile.timer
agent-jobctl enable creator-tracker-worker.service
agent-jobctl enable creator-tracker-dashboard-health.timer
```

The Instagram credential smoke and bounded single-account database proof have
passed. Its persistent guard is currently blocked at a 100-credit reserve with
95 last observed. Enable the two Instagram timers only after provider credits
cover the initial backlog plus measured daily use, the guard is explicitly
rearmed from timestamped evidence, and the Instagram executable values have
been added to the private host environment:

```bash
agent-jobctl enable creator-tracker-instagram-discovery.timer
agent-jobctl enable creator-tracker-instagram-scheduler.timer
```

Do not delete failures, ledger rows, or finalizations to clear a health alarm.
Resolve the adapter/credential/network cause and let persistent timers catch up
from database due times. Networked jobs wait up to 60 seconds for
NetworkManager at each start because this user manager has no usable
`network-online.target`; collector paths still use bounded request timeouts,
typed retries, idempotency, and explicit coverage state.
