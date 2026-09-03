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
  new regressions above it. It watches release identity, the release-bound
  cutover proof, disk reserve, enabled/active timers, worker heartbeat,
  successful job-marker ages, coverage telemetry freshness, TikTok capacity,
  the shared credit guard, per-target misses, and the three-hour TikTok
  freshness ceiling.
- It may only start an enabled reviewed timer, restart the dashboard worker,
  and never launches provider jobs directly. A disabled timer is escalated
  because it may represent intentional maintenance. Before any action it holds
  the tracker activation lock, verifies the current cutover proof, the complete
  sealed release, and the exact effective unit with no drop-ins. It suppresses
  itself during activation and the post-activation cutover grace period.
- Automatic actions have a 30-minute per-unit cooldown and a twelve-action
  daily ceiling. The sentinel never resets systemd rate limits, rearms credits,
  enables a disabled timer, or bypasses the Instagram spend guard.
- The same incident must survive three consecutive probes. Capacity pressure
  and clustered TikTok window misses must also persist for at least 45 minutes,
  so ordinary queue wobble does not burn an agent run. A continuous issue is
  dispatched once; if it clears and later returns it becomes a new episode.
  Dispatches are limited to two per day, with a six-hour same-fingerprint
  cooldown.
  Credit, storage, disabled-unit, cutover, and release-integrity faults remain
  operator-required instead of wasting Codex runs on actions it cannot safely
  take.
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
- Only a checksummed report with a zero trusted-verification exit and a coherent
  final outcome acknowledges the incident. An internal runner or verifier
  failure receives one bounded retry. The verifier also persists a two-start
  limit for each claimed handoff. Exhausted or structurally rejected work moves
  to the durable dead-letter path instead of looping or silently disappearing.
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

The production install uses two dedicated system identities with no login or
supplementary groups: one for Codex and one for candidate verification. Install
root-owned copies of the four executables, prompt, schema, permission profile,
artifact manifest, tmpfiles policy, and units. Pin both the Codex 0.149.0 binary
and its matching `codex-code-mode-host` under
`/opt/creator-tracker-autopilot/codex/0.149.0/` with a root-owned checksum. Copy
`auth.json` into the dedicated `codex-home` as a `0600` credential without ever
printing it, then run `systemd-tmpfiles`, `daemon-reload`, the read-only
`inspect`, and one manual healthy probe. Run the install verifier with
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
