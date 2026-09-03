# Creator tracker autopilot

This is the incident layer above the sealed creator tracker. It is deliberately
separate from `creator-tracker-dashboard-health.service`, because that health
check remains red while inherited coverage debt exists and would otherwise
launch an agent every two minutes.

## Behavior

- A root-owned sentinel runs every five minutes and survives reboot with
  `Persistent=true`.
- It ignores historical overdue/unresolved totals and harmless lock-contention
  exit 75. It freezes a best-observed baseline for inherited debt and detects
  new regressions above it. Irreversible target miss/outside-window counters are
  edge-triggered: an increase must still be confirmed and durably dispatched,
  then that observed count becomes the accepted baseline so the historical miss
  cannot relaunch Codex forever. A later increase has a new baseline-scoped
  incident identity. It watches release identity, the release-bound
  cutover proof, disk reserve, enabled/active timers, worker heartbeat,
  successful job-marker ages, coverage telemetry freshness, TikTok capacity,
  the shared credit guard, per-target misses, and the three-hour TikTok
  freshness ceiling.
- It may start an enabled reviewed timer, restart the dashboard worker, and,
  after two confirming probes of an uncovered target near its first-week
  deadline, request non-blocking starts of the already-authorized TikTok and
  Instagram scheduler services. The risk counter is source-neutral, so each
  scheduler lane is evaluated independently. A lane must be idle, loaded,
  sealed, and backed by its own enabled/active sealed timer. TikTok capacity and
  fallback gates and Instagram configuration and credit gates must also be
  ready. The sentinel never enables a lane or bypasses a provider guard. Before
  any action it holds the tracker activation lock, rechecks the current provider
  gates, verifies the current cutover proof, the complete sealed release, and
  the exact effective service and timer units with no drop-ins. It suppresses
  itself during activation and the post-activation cutover grace period.
- Automatic actions have a 30-minute per-unit cooldown and a twelve-action
  daily ceiling. The sentinel never resets systemd rate limits, rearms credits,
  enables a disabled timer, or bypasses the Instagram spend guard.
- The same incident must survive three consecutive probes. Capacity pressure
  and clustered TikTok window misses must also persist for at least 45 minutes,
  so ordinary queue wobble does not burn an agent run. A continuous issue is
  dispatched once initially. A trusted status-only or no-action diagnosis may
  receive one more investigation after six hours; the second status-only result
  is final for that continuous episode. If the issue clears and later returns it
  becomes a new episode. Dispatches are limited to three per day, with a
  six-hour same-fingerprint cooldown. Historical target-outcome regressions are
  accepted into their edge-triggered baseline only after a trusted status-only
  result, so a candidate or dead letter cannot disappear while the baseline
  prevents an irreversible old miss from consuming the retry.
  Persistent credit, storage, disabled-unit, cutover, and release-integrity
  faults are treated as operator-only instead of wasting Codex runs on actions
  it cannot safely take. They still require the normal three-probe confirmation.
- Every probe also publishes a separate four-field health export under
  `/var/lib/creator-tracker-autopilot-health/`. It contains only a timestamp,
  health level, and one generic reason code; release IDs, issue details, account
  data, and Codex metadata remain in the private autopilot state. Confirming
  incidents and queued/running Codex work remain degraded and silent, including
  an incident that could not be dispatched because the daily budget is full.
  Only a true `operator_required` outcome or an integrity/unknown state exports
  failing. The first two incomplete coverage-baseline reads are expected
  bootstrap and remain degraded while later probes finish them. On the third
  partial read, or after 15 minutes from the first one, the missing baseline
  enters normal incident evaluation instead of remaining silent indefinitely.
  Release, cutover, storage, timer, unit-integrity, and worker faults bypass this
  bootstrap grace immediately; intentional activation maintenance remains
  suppressed. An export 15 minutes old is failing at the off-host reporter,
  subject to the reporter's reboot/resume automatic-recovery grace.
- Persistent incidents launch `codex exec` against a new isolated clone of the
  exact active sealed source and dependencies. It runs under the dedicated
  no-login `creator-tracker-codex` account with a pinned root-owned Codex binary,
  a dedicated auth store, a 25-minute agent timeout, 4 GiB memory cap, 2 GiB
  ephemeral workspace cap, 150% CPU cap, and one global lock. A named permission profile denies filesystem reads
  outside the workspace and minimal tool/runtime paths and disables network for
  model-generated commands. User config, rules, hooks, MCPs, subagents, mutable
  development repositories, production state, provider credentials, Docker,
  SSH, systemd control, and web search are excluded.
- The runner publishes a checksummed `READY` handoff. A second, root-owned,
  networkless service resumes that handoff after crashes or reboots, reapplies
  the candidate as a separate unprivileged `creator-tracker-verifier` user,
  derives the real changed paths independently, and reruns tests and typechecking
  in fresh workspaces. Codex cannot write the trusted result or completion
  marker. Its test namespace has no network interfaces and a private empty
  `/run`, so host resolver, service-manager, container, VPN, and logging sockets
  are unavailable to candidate code.
- Only a structurally complete checksummed report with a parseable trusted
  verification exit and a coherent final outcome is folded into notification
  state. A verified candidate that needs review, an allowlisted concrete
  external/operator action, a complete `needs_human` or `failed` outcome, a
  nonzero trusted-verification exit, an exhausted or rejected attempt, or an
  unavailable pipeline becomes `operator_required`. A no-action result and an
  external/data diagnosis without a concrete safe owner action remain
  status-only and do not page. An incomplete or malformed attempt can receive
  one bounded retry; the verifier also persists a two-start limit for each
  claimed handoff, so failures cannot loop or silently disappear.
- Codex can diagnose and prepare a tested candidate patch. It cannot deploy,
  mutate production data, rearm credits, alter payouts, or contact creators.
  Candidate paths are independently restricted to `src/sync/` and `tests/`;
  tests and typechecking run again inside the networkless verifier service.
  Unknown code changes remain reviewable, checksummed artifacts under
  `/var/lib/creator-tracker-autopilot/reports/`.

This design automatically repairs known operational failures and automatically
starts a constrained investigator for unfamiliar ones. It does not pretend an
LLM can safely guarantee a correct unattended production code deployment.

## Production bootstrap

The production install uses three dedicated system identities with no login or
supplementary groups: one each for Codex, candidate verification, and the
sanitized health reader. Install
root-owned copies of the four executables, prompt, schema, permission profile,
artifact manifest, tmpfiles policy, and units. Pin both the Codex 0.149.0 binary
and its matching `codex-code-mode-host` under
`/opt/creator-tracker-autopilot/codex/0.149.0/` with a root-owned checksum. Copy
`auth.json` into the dedicated `codex-home` as a `0600` credential without ever
printing it, then run `systemd-tmpfiles`, `daemon-reload`, the read-only
`inspect`, and one manual probe to create the sanitized monitor export. Run the
install verifier with
`VERIFY_AUTOPILOT_TIMER=0`, enqueue an end-to-end smoke incident, and manually
run one probe after Codex publishes `READY` so the still-disabled timer routes
the trusted verifier. Enable the timer only after the smoke report is complete,
then rerun the install verifier without the override. The exact
source-to-installed byte comparisons are enforced by:

```bash
sudo bash ops/creator-tracker-autopilot/tests/verify-installed.sh
```

For rollback, disable only `creator-tracker-autopilot.timer` and stop both
`creator-tracker-codex-incident.service` and
`creator-tracker-codex-verifier.service`. Leave the creator tracker itself and
all incident evidence untouched.

## Verification and operations

```bash
bash ops/creator-tracker-autopilot/tests/verify.sh
sudo /usr/bin/python3 -I /usr/local/libexec/creator-tracker-autopilot inspect
sudo systemctl status creator-tracker-autopilot.timer
sudo systemctl status creator-tracker-codex-incident.service
sudo /usr/bin/python3 -I /usr/local/libexec/creator-tracker-autopilot status
```

The integration smoke incident is safe and makes no source changes:

```bash
sudo /usr/bin/python3 -I /usr/local/libexec/creator-tracker-autopilot enqueue-smoke
```

The laptop must be powered on and able to reach the internet for Codex to run.
A separate hosted dead-man heartbeat is still required to detect and notify on
a completely powered-off laptop or total network outage.
