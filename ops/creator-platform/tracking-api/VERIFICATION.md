# Production verification: 2026-09-12

- Project: `gotall-creator-platform`; no legacy deployment or apex cutover.
- Deployment: `dpl_7vBMKyMHMzyd1G8YbB7PshaB9SFG` (READY).
- Reference: https://gotall-creator-platform.vercel.app/tracking-api
- Both tracking migrations applied to the dedicated creator Supabase project.
- Existing source bootstrap imported 870 batches, 102 subscriptions, 4,807
  videos, and 21,256 observations. These are bootstrap counts, not live totals.
- GoTall subscription quota is 500 to accommodate the imported accounts.
  New organizations default to 100.
- Systemd worker timer enabled; last verified service result was success.

## Automated checks

- Tracking API tests: 25 passed.
- Disposable PostgreSQL integration tests: core RPCs and source bridge passed.
- Lint, TypeScript checking, and production build passed.
- Full creator suite: 574 passed, 6 failed. Five failures are in existing
  SignWell open-route tests whose mocks omit the archive-integrity gate; one
  source-archive migration test matches guarded activation SQL with an
  overbroad regex. These failures were not repaired as part of the API work.

## Live checks

- Authenticated reads, tenant isolation, scoped-key enforcement and revocation.
- Submission acceptance, idempotent replay, conflicting replay rejection.
- TikTok video job completed and returned a fresh observation.
- TikTok account job completed and discovered ten recent videos.
- Instagram video job completed and returned an observation.
- Pause blocked manual refresh; delete removed subscription access.
- Temporary verification subscriptions deleted and isolation client removed.
- Production docs at 1440px and 390px: no horizontal overflow or page errors.

Passing these checks demonstrates the tested flows, not an unlimited collection
capacity or freshness SLA. See README.md for provider limits and V1 boundaries.

## Thorough follow-up: 2026-09-12, approximately 08:00 UTC

- Production HTTP adversarial suite: 52 assertions passed, including 12
  simultaneous idempotent submissions, cross-client reads/mutations, scope
  escalation rejection, revocation, malformed/oversized bodies, cursor
  validation, history pagination, and an exact concurrent 5-request rate limit.
- PostgreSQL adversarial suite: 28 assertions passed with up to 20 concurrent
  connections. Covered quotas, shared target deduplication, rate enforcement,
  replay, ten competing workers, expired leases, third-attempt exhaustion,
  stale-worker fencing, blocked-provider backoff, owner rollback, append-only
  observations, null versus zero, and counter regressions.
- Source bridge tests passed across a 20-batch chunk boundary when account and
  video foundations belonged to a later batch than their observations. Replay,
  unbound source exclusion, and all tracking table/RPC public-role permissions
  also passed.
- Fresh Instagram account submission succeeded on attempt one, returning four
  fresh observations in 17 seconds. Together with the initial release tests,
  all four collection paths were exercised: TikTok account/video and Instagram
  account/video. Temporary test clients were removed.
- Live readback: 4 succeeded API jobs, 0 failed, 0 running, 0 queued; 4,811 videos
  and 21,278 observations. These are point-in-time counts, not freshness proof
  for every imported account.
- Full application suite rerun: 574 passed, the same 6 SignWell failures remain.
  Lint and typecheck passed again.

No API implementation defect was found by this follow-up. This was bounded
concurrency testing, not sustained load/soak testing or an independent security
audit. The single worker handles one job per three-minute timer tick; do not
promise the twelve-hour target to arbitrarily many active subscriptions.
