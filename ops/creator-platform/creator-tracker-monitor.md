# Creator tracker off-host monitor

This monitor asks the owner to act only when the laptop-hosted creator tracker
stops checking in or the autopilot explicitly reports
`operator_action_required`. The evaluation clock, incident state, retry queue,
and email sender all run off the laptop.

It detects and records all signed health states, but ordinary runtime failures
remain silent while automatic recovery is pending. It cannot collect creator
data or run laptop-side repair while the laptop itself is unavailable.

## Timing and behavior

- The reporter sends one signed heartbeat every 60 seconds.
- Supabase evaluates every minute.
- A heartbeat is stale after 300 seconds, including exactly at the boundary.
- Raw `failing` and `degraded` heartbeats remain live and non-paging while
  automatic recovery is pending. A runtime email incident opens only when the
  signed heartbeat is `failing` and its issue codes contain the explicit
  `operator_action_required` marker. A marker on a non-failing heartbeat is
  retained but cannot authorize email. Other issue codes are diagnostic only.
- The reporter reads only the autopilot's dedicated four-field health export,
  never its private state. One or two consecutive incident probes are degraded;
  later probes reflect the autopilot lifecycle, but only the explicit operator
  marker pages. A missing, malformed, more-than-60-seconds-future, or
  15-minute-old export remains a recorded failure. The autopilot timer itself
  must remain both active and enabled.
- After a reboot, stale/missing autopilot state and timer startup receive a
  ten-minute automatic-recovery grace plus one durable, unconsumed same-boot
  resume allowance. The first later reporter gap longer than three minutes
  spends that allowance and extends grace to ten minutes after resume, even if
  the laptop suspended during initial startup. Another allowance is earned only
  after ten continuous minutes with both the autopilot export and timer
  confirmed available. Repeated gaps therefore cannot suppress escalation
  indefinitely, and a reporter crash before health collection cannot erase an
  already-earned allowance. Heartbeats continue, so a resumed laptop resolves
  liveness silently; a fresh explicit operator/integrity outcome can still page
  immediately.
- The direct coverage probe still fails closed if
  `first_week_targets_imminent_uncovered` is missing or invalid. Those raw
  failures are recorded for the autopilot; they do not email the owner until
  the explicit operator marker is present.
- A direct probe that emits no metrics and carries one of the two exact,
  verified read-only snapshot contention errors is degraded for that minute,
  rather than opening and immediately recovering an incident. Any valid metrics
  are evaluated first, so an imminent uncovered target is still recorded even
  if the process also reports contention; unknown probe failures remain
  recorded failures.
- An unresolved action-required incident repeats after 12 hours. An unsent
  alert is retried instead of creating reminder backlog.
- Provider and network failures remain in the durable outbox and retry
  indefinitely with a delay capped at 30 minutes.
- Immediately before contacting Resend, the Edge sender revalidates the fenced
  lease, open incident, current source state, and action marker in one database
  transaction. A sent completion is rejected unless that authorization was
  recorded on the current lease. Invalid legacy items are refused individually
  and cannot block another valid delivery in the same batch.
- A returned laptop heartbeat resolves a liveness incident silently. Removing
  the operator marker resolves a runtime incident silently. Recovery emails are
  not sent; the absence of another action email is intentional.
- If an incident resolves before its initial email is sent, its pending or
  unfenced leased email work is cancelled so it cannot be claimed or retried.
  The current-state authorization RPC is the external-send point-of-no-return:
  a heartbeat that resolves the incident in the few milliseconds between that
  authorization and the Resend request does not cancel the fenced lease, so the
  provider receipt remains recorded honestly. The action was current when it
  crossed that fence, even if the email arrives just after recovery.

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
2. On a new installation, apply
   `creator-platform/supabase/migrations/20260903090000_creator_tracker_deadman_monitor.sql`.
   It schedules the one-minute cron but seeds `creator-tracker-xps` disabled, so
   the job is a no-op during setup.
3. Install the Edge Function secrets and deploy the action-only
   `creator-tracker-monitor-tick` with JWT verification enabled. On an existing,
   enabled installation, first pause its off-host cron invocation and confirm no
   prior Edge invocation remains in flight, then deploy this Edge version. Until
   the next migration exists, its missing authorization RPC makes every delivery
   fail closed before Resend. Keep cron paused through the migration below.
4. Apply
   `creator-platform/supabase/migrations/20260903230000_creator_tracker_operator_alerts.sql`,
   followed by
   `creator-platform/supabase/migrations/20260903233000_creator_tracker_monitor_delivery_fence.sql`.
   Never install this send-authorization guard while the prior Edge sender is
   still active: that sender contacts Resend before creating the authorization
   record required by the new database trigger. Resume cron only after the
   migration and Edge version are both verified.
5. Store the three named Vault entries. Never embed their values in a migration
   or a `cron.job` command.
6. Install/update the autopilot first and enable its timer. The monitor installer
   safely creates and validates the dedicated `0750` health directory, runs one
   autopilot probe, then requires its `status.json` to be a fresh
   `root:creator-tracker-health` `0640` file before enabling the reporter timer.
   It fails closed if this boundary or the enabled, active autopilot timer is
   absent.
7. Start the laptop reporter and require a committed 201 response from
   `/api/v1/creator-tracker/heartbeat`. An exact retry after response loss gets
   the original receipt as 200 with `replayed: true`.
8. Through a service-role RPC, call
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
4. Stop only the laptop reporter for six minutes. Confirm one
   `Action needed: reconnect the creator tracker laptop` email and an open
   `heartbeat_stale` incident.
5. Restart it. Confirm the incident resolves without a recovery email and no
   unsent action request remains claimable.
6. Exercise raw `failing` heartbeats without `operator_action_required` and
   confirm they are recorded without opening a runtime incident or sending an
   email.
7. Exercise a signed heartbeat containing `operator_action_required`. Confirm
   one `Action needed: review the creator tracker repair` email, then remove the
   marker and confirm silent resolution. A reminder must not appear before the
   12-hour interval.

This stack cannot report a total Supabase outage from inside Supabase itself. A
second-provider uptime check for the Edge endpoint and cron freshness is the
remaining monitor-of-monitor layer.
