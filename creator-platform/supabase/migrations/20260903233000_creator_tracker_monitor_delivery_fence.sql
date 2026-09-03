-- Treat current-state delivery authorization as the external-send
-- point-of-no-return. A heartbeat may resolve the incident immediately after
-- authorization, but it must not cancel the fenced lease while the provider
-- request and receipt completion are still in progress.

select pg_advisory_xact_lock(hashtextextended('creator-tracker-monitor-evaluator', 17389));

create or replace function public.creator_tracker_monitor_resolve_silently()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  with resolved as (
    update public.creator_tracker_monitor_incidents incident
    set state = 'resolved',
        resolved_at = clock_timestamp(),
        updated_at = clock_timestamp()
    where incident.monitor_id = new.monitor_id
      and incident.state = 'open'
      and (
        not new.enabled
        or (
          incident.incident_kind = 'heartbeat_stale'
          and new.last_received_at is distinct from old.last_received_at
        )
        or (
          incident.incident_kind = 'runtime_failing'
          and not (
            new.last_status = 'failing'
            and new.last_issue_codes
              @> array['operator_action_required']::text[]
          )
        )
      )
    returning incident.id
  )
  update public.creator_tracker_monitor_deliveries delivery
  set state = 'cancelled',
      completed_at = clock_timestamp(),
      completion_lease_token = null,
      lease_token = null,
      leased_by = null,
      leased_at = null,
      lease_expires_at = null,
      last_error_code = 'incident_resolved_silently',
      updated_at = clock_timestamp()
  from resolved
  where delivery.incident_id = resolved.id
    and delivery.event_kind in ('opened', 'repeat', 'recovered')
    and delivery.state in ('pending', 'leased', 'retry')
    and not (
      delivery.state = 'leased'
      and delivery.send_authorized_at is not null
      and delivery.leased_at is not null
      and delivery.send_authorized_at >= delivery.leased_at
      and delivery.send_authorized_at <= clock_timestamp()
    );

  return new;
end;
$$;

-- Older evaluator versions measured the repeat from enqueue time. Anchor every
-- still-open incident to its most recent successful provider receipt so a
-- delivery recovered from a long provider outage cannot be followed by an
-- immediate nominally-12-hour reminder.
with latest_sent as (
  select delivery.incident_id,
         max(delivery.sent_at) as last_sent_at
  from public.creator_tracker_monitor_deliveries delivery
  where delivery.state = 'sent'
    and delivery.event_kind in ('opened', 'repeat')
    and delivery.sent_at is not null
  group by delivery.incident_id
)
update public.creator_tracker_monitor_incidents incident
set last_repeat_queued_at = greatest(
      incident.last_repeat_queued_at,
      latest_sent.last_sent_at
    ),
    updated_at = clock_timestamp()
from latest_sent
where incident.id = latest_sent.incident_id
  and incident.state = 'open'
  and incident.last_repeat_queued_at < latest_sent.last_sent_at;

revoke all on function public.creator_tracker_monitor_resolve_silently()
from public, anon, authenticated, service_role;
