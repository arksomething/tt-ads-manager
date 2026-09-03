# Creator tracker off-host monitor

This monitor alerts when the laptop-hosted creator tracker stops checking in or
keeps checking in while reporting a failing runtime. The evaluation clock,
incident state, retry queue, and email sender all run off the laptop.

It detects and reports an outage; it does not collect creator data while the
laptop is unavailable. Every incident still requires checking the affected
time window and backfilling it when necessary.

## Timing and behavior

- The reporter sends one signed heartbeat every 60 seconds.
- Supabase evaluates every minute.
- A heartbeat is stale after 300 seconds, including exactly at the boundary.
- A `failing` heartbeat opens a separate incident immediately.
- `degraded` remains live and non-paging; its issue codes are retained for the
  alert if the heartbeat later stops.
- The reporter reads only the autopilot's dedicated four-field health export,
  never its private state. One or two consecutive incident probes are degraded;
  the third is failing. A missing, malformed, more-than-60-seconds-future, or
  15-minute-old export is failing. The autopilot timer itself must remain both
  active and enabled.
- The direct coverage probe fails closed if
  `first_week_targets_imminent_uncovered` is missing or invalid, and pages when
  it is greater than zero. This forward-looking counter is separate from frozen
  historical debt, so old unrepairable misses do not page.
- A direct probe that emits no metrics and carries one of the two exact,
  verified read-only snapshot contention errors is degraded for that minute,
  rather than opening and immediately recovering an incident. Any valid metrics
  are evaluated first, so an imminent uncovered target still pages even if the
  process also reports contention; unknown probe failures remain failing.
- An unresolved incident repeats after 30 minutes. An unsent alert is retried
  instead of creating repeat backlog.
- Provider and network failures remain in the durable outbox and retry
  indefinitely with a delay capped at 30 minutes.
- The first healthy or degraded heartbeat resolves either incident once and
  enqueues a recovery email.

## Credential boundaries

Create independent random secrets; never reuse ingestion, Discord, provider,
authentication, or payment credentials.

Vercel needs:

- `CREATOR_TRACKER_MONITOR_SECRET`: raw UTF-8 HMAC secret, at least 32 bytes;
  share only with the laptop reporter.

The Supabase Edge Function needs:

- `CREATOR_TRACKER_MONITOR_TICK_SECRET`: at least 32 bytes;
- `RESEND_API_KEY`: a narrowly scoped Resend sender credential;
- `CREATOR_TRACKER_MONITOR_EMAIL_FROM`: a sender on a verified domain;
- `CREATOR_TRACKER_MONITOR_EMAIL_TO`: one to five comma-separated recipients.

Supabase supplies `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to the Edge
Function. Do not put the service-role key in Vault or the cron command.

Vault needs these names:

- `creator_tracker_monitor_edge_url`: the full HTTPS URL ending in
  `/functions/v1/creator-tracker-monitor-tick`;
- `creator_tracker_monitor_anon_key`: the project's public/anon JWT used by the
  Edge gateway;
- `creator_tracker_monitor_tick_secret`: the same tick secret installed only in
  the Edge Function.

## Activation order

1. Add `CREATOR_TRACKER_MONITOR_SECRET` to the isolated
   `gotall-creator-platform` Vercel project and deploy the reviewed creator
   platform bundle.
2. Apply
   `creator-platform/supabase/migrations/20260903090000_creator_tracker_deadman_monitor.sql`.
   It schedules the one-minute cron but seeds `creator-tracker-xps` disabled, so
   the job is a no-op during setup.
3. Install the Edge Function secrets and deploy
   `creator-tracker-monitor-tick` with JWT verification enabled.
4. Store the three named Vault entries. Never embed their values in a migration
   or a `cron.job` command.
5. Install/update the autopilot first and enable its timer. The monitor installer
   safely creates and validates the dedicated `0750` health directory, runs one
   autopilot probe, then requires its `status.json` to be a fresh
   `root:creator-tracker-health` `0640` file before enabling the reporter timer.
   It fails closed if this boundary or the enabled, active autopilot timer is
   absent.
6. Start the laptop reporter and require a committed 201 response from
   `/api/v1/creator-tracker/heartbeat`. An exact retry after response loss gets
   the original receipt as 200 with `replayed: true`.
7. Through a service-role RPC, call
   `set_creator_tracker_monitor_enabled('creator-tracker-xps', true)`. Enabling
   fails closed unless the database has a heartbeat newer than five minutes.

## Production proof

After activation, verify all of the following rather than treating cron enqueue
as delivery proof:

1. `creator_tracker_monitor_sources.last_received_at` advances about every
   minute using database time.
2. `cron.job` has one active `creator-tracker-monitor-every-minute` entry with
   the `* * * * *` schedule.
3. Recent `cron.job_run_details` entries succeed, corresponding `pg_net`
   responses are HTTP 2xx, and `last_evaluated_at` advances every minute. A
   successful cron row alone proves only that the asynchronous request queued.
4. Stop only the laptop reporter for six minutes. Confirm one real urgent email
   and an open `heartbeat_stale` incident.
5. Restart it. Confirm one recovery email and a resolved incident with the
   measured outage duration.
6. Exercise a `failing` reporter state separately and confirm an immediate
   `runtime_failing` email, followed by recovery on `degraded` or `healthy`.
7. Inspect the incident window and backfill any creator data that may have been
   missed.

This stack cannot report a total Supabase outage from inside Supabase itself. A
second-provider uptime check for the Edge endpoint and cron freshness is the
remaining monitor-of-monitor layer.
