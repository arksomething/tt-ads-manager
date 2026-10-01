# Video tracking API operations

The client API is hosted by the isolated `gotall-creator-platform` Vercel
project. Base path: `/api/tracking/v1`. The reference is at `/tracking-api` and
the machine-readable contract at `/api/tracking/v1/openapi.json`.

## Organizations and keys

Operators provision organizations. Clients can rotate/revoke scoped keys but
cannot create organizations, increase quotas, or grant scopes they do not hold.
Use the creator project's own Supabase environment for this command:

```bash
node --env-file=/absolute/path/to/creator-project.env \
  ops/creator-platform/tracking-api/provision.mjs \
  --name 'Customer name' --output /absolute/private/path/customer-key.json
```

The output file is created with `0600` permissions and must not already exist.
Never paste keys into documentation or commit them. Store keys on client
servers. A key with `keys:manage` and both tracking scopes is an organization
administrator. Default limits: 100 subscriptions, 120 requests/minute shared
across all organization keys. SQL operations serialize per organization to
enforce the limit during concurrent submissions.

All tracking tables use RLS with no anonymous/authenticated table grants.
Only the server-side service-role RPCs operate on them. Read RPCs enforce
subscription entitlement for videos, jobs, and observations. Paused
subscriptions retain read access; deleted subscriptions do not. Public facts
may be collected once for matching targets. Client-provided owner constraints
are included in target deduplication so an invalid owner claim cannot poison
another client's target. Resolved provider-native ownership is pinned after
the first successful collection.

## Collection

`tracking-api-worker.timer` runs every three minutes. It leases one due job,
collects through the installed creator collector's existing ScrapeCreators
adapters, and completes the job through its private API. Its key is separate
from all client keys. It runs under `creator-tracker-writer` and the existing
writer flock, sharing the durable provider credit guard. It neither bypasses
the credit reserve nor resets a blocked guard. Each job allows at most three
provider requests/credits. Existing collector schedules remain intact.

Account scans discover up to ten recent videos. Individually subscribed videos
continue polling even when they disappear from a profile's recent window.
Targets are due every twelve hours after success, with exponential retries
from thirty minutes to twelve hours after failure. Empty inventories remain
unconfirmed. Missing counters are null. API observations are labeled provider
evidence and are not a payout-finalization contract. This worker does not claim
independent raw-byte verification.

Worker leases expire after ten minutes. Crashed jobs are retried up to three
leases, then fail visibly and wait an hour for the next scheduled job. A stale
worker cannot complete a newly leased job. Replaying the same completed lease
does not duplicate observations. Pausing or deleting the last subscription
cancels queued collection; an in-flight request may finish.

Instagram currently requires the numeric owner account ID in addition to the
profile or video URL. This preserves the existing adapter's identity check.
TikTok accepts canonical profile/video URLs directly. Shortened links and
unsupported platforms are rejected before dispatch; the server never fetches
an arbitrary client URL.

The checked-in worker and launcher are installed as a root-owned, immutable
versioned directory under `/opt/tracking-api-worker/releases/<hash>`, selected
by `/opt/tracking-api-worker/current`. API credentials are loaded through
systemd's `LoadCredential` from `/etc/tracking-api/worker.env`. Provider
credentials remain in their existing collector-only authority and are never
uploaded to Vercel. The unit joins `creator-tracker.slice` for resource limits.

## Existing tracker data

An operator can bind a collector source organization to an API organization
in `tracking_source_bindings`. Worker sync imports committed batches only,
projects public video facts, preserves observation timestamps and source
confidence, and remembers imported batch IDs. Source sync runs independently
of canonical ingestion so an API projection error does not reject uploads.
Imported subscriptions start paused because the original collector already
owns their collection schedule; their observations continue updating through
the source bridge. API clients can explicitly resume additional collection.
Unbound source organizations are never imported.

## Verification and deployment

```bash
pg_virtualenv bash ops/creator-platform/tracking-api/test-database.sh
npm run creator:verify
```

The SQL test uses a disposable PostgreSQL cluster. It exercises tenant
isolation, key expiration/revocation, atomic limits, idempotency, worker leases,
null metrics, pause/delete behavior, and source imports.

The database runner also exercises simultaneous connections for quota, shared
target deduplication, idempotency and rate enforcement; crashed leases and
fencing; counter regressions; owner mismatch rollback; and out-of-order source
batches. It requires the creator app's installed `pg` dependency.

For production HTTP regression checks, run `live-adversarial-test.mjs` using
`node --env-file=/absolute/private/creator-project.env`. It creates temporary
clients, tests authorization, malformed requests, concurrent replay, pagination
and rate limits, and removes its clients in `finally`. It reuses a known public
video. Never run it against a different database with the hard-coded production
API URL.

`live-collection-test.mjs URL [NUMERIC_OWNER_ID]` uses the same environment,
creates a temporary client, waits up to ten minutes for a due target's real
collection, verifies fresh observations, and cleans up. This consumes provider
credits under the normal worker guard; it does not bypass refresh cooldowns.

Apply the two tracking migrations using `manage-database.mjs --migrate`, with
`SUPABASE_ACCESS_TOKEN` available to that process (or `--management-env` pointing
to its provider-level authority). The script verifies the Supabase project ID
and name and records each migration in the migration ledger. `--export-env`
writes only the matching creator project's API keys to an owner-only file for
operator commands; it does not rotate keys. Vercel sensitive environment
values may be blank in `vercel env pull` output even when configured correctly.

Follow `../README.md` for an isolated Vercel staging root and explicit project
dry run. Never deploy this app through the legacy Vercel link. Production
verification must cover an authenticated submission, worker completion,
observations, and rejection of a second organization's access. Docs/OpenAPI
HTTP 200 alone does not establish collection health.

Inspect `systemctl status tracking-api-worker.timer tracking-api-worker.service`
and the worker journal for status. The worker logs job IDs and bounded error
codes only. API failures include request IDs. A healthy timer does not imply
fresh data: inspect each subscription's collection state and last-success time.

V1 does not include webhooks, billing, or public self-service signup. Capacity
is bounded by the single shared collector and provider balance; the twelve-hour
cadence is a scheduling target, not an SLA. Expand workers only with measured
provider capacity and appropriate organization limits.
