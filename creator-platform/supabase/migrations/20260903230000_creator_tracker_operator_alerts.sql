-- Page the owner only after the laptop has explicitly exhausted automatic
-- recovery. Raw failing health remains recorded for diagnosis, but it is not
-- itself an instruction to email a person.

select pg_advisory_xact_lock(hashtextextended('creator-tracker-monitor-evaluator', 17389));

alter table public.creator_tracker_monitor_sources
  alter column repeat_after_seconds set default 43200;

alter table public.creator_tracker_monitor_deliveries
  add column if not exists send_authorized_at timestamptz;

update public.creator_tracker_monitor_sources
set repeat_after_seconds = 43200,
    updated_at = clock_timestamp()
where repeat_after_seconds is distinct from 43200;

create or replace function public.creator_tracker_monitor_require_operator_marker()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if new.incident_kind = 'runtime_failing'
    and not exists (
      select 1
      from public.creator_tracker_monitor_sources source
      where source.monitor_id = new.monitor_id
        and source.last_status = 'failing'
        and source.last_issue_codes @> array['operator_action_required']::text[]
    )
  then
    -- The signed heartbeat is still retained on the monitor source. Suppress
    -- only the human-facing incident while automatic recovery is pending.
    return null;
  end if;
  return new;
end;
$$;

drop trigger if exists creator_tracker_monitor_operator_marker
on public.creator_tracker_monitor_incidents;

create trigger creator_tracker_monitor_operator_marker
before insert on public.creator_tracker_monitor_incidents
for each row
execute function public.creator_tracker_monitor_require_operator_marker();

create or replace function public.creator_tracker_monitor_suppress_recovery_email()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if new.event_kind = 'recovered' then
    return null;
  end if;
  return new;
end;
$$;

drop trigger if exists creator_tracker_monitor_no_recovery_email
on public.creator_tracker_monitor_deliveries;

create trigger creator_tracker_monitor_no_recovery_email
before insert on public.creator_tracker_monitor_deliveries
for each row
execute function public.creator_tracker_monitor_suppress_recovery_email();

create or replace function public.creator_tracker_monitor_guard_send_authorization()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if new.state = 'leased' then
    if old.state <> 'leased'
      or new.lease_token is distinct from old.lease_token
    then
      new.send_authorized_at := null;
    end if;
  elsif new.state = 'sent' and old.state = 'leased' then
    if old.send_authorized_at is null
      or old.send_authorized_at < old.leased_at
      or old.send_authorized_at > clock_timestamp()
    then
      raise exception 'Monitor delivery was not authorized immediately before send.'
        using errcode = '55000';
    end if;
  elsif new.state <> 'sent' then
    new.send_authorized_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists creator_tracker_monitor_send_authorization
on public.creator_tracker_monitor_deliveries;

create trigger creator_tracker_monitor_send_authorization
before update on public.creator_tracker_monitor_deliveries
for each row
execute function public.creator_tracker_monitor_guard_send_authorization();

create or replace function public.creator_tracker_monitor_resolve_silently()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  -- This runs inside the signed-heartbeat transaction, immediately after the
  -- source row is refreshed and before the legacy function can enqueue a
  -- recovery email. A returned heartbeat resolves liveness; removing the
  -- explicit operator marker resolves the human-action incident.
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
    and delivery.state in ('pending', 'leased', 'retry');

  return new;
end;
$$;

drop trigger if exists creator_tracker_monitor_silent_resolution
on public.creator_tracker_monitor_sources;

create trigger creator_tracker_monitor_silent_resolution
after update of enabled, last_received_at, last_status, last_issue_codes
on public.creator_tracker_monitor_sources
for each row
when (
  new.enabled is distinct from old.enabled
  or new.last_received_at is distinct from old.last_received_at
  or new.last_status is distinct from old.last_status
  or new.last_issue_codes is distinct from old.last_issue_codes
)
execute function public.creator_tracker_monitor_resolve_silently();

create or replace function public.authorize_creator_tracker_monitor_delivery(
  target_delivery_id uuid,
  target_lease_token uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth, pg_temp
as $$
declare
  check_time timestamptz := clock_timestamp();
  delivery_id uuid;
  target_incident_id uuid;
  delivery_state text;
  delivery_event_kind text;
  delivery_event_payload jsonb;
  delivery_attempt_count integer;
  delivery_lease_token uuid;
  delivery_leased_at timestamptz;
  delivery_lease_expires_at timestamptz;
  incident_monitor_id text;
  incident_kind text;
  incident_state text;
  incident_outage_started_at timestamptz;
  incident_opened_at timestamptz;
  source_enabled boolean;
  source_last_received_at timestamptz;
  source_stale_after_seconds integer;
  source_last_status text;
  source_last_issue_codes text[];
  source_last_release_id text;
  is_authorized boolean := false;
  refusal_code text := 'delivery_not_authorized';
begin
  perform public.creator_require_service_role();
  perform pg_advisory_xact_lock(hashtextextended('creator-tracker-monitor-evaluator', 17389));

  select delivery.id,
         incident.id,
         delivery.state,
         delivery.event_kind,
         delivery.event_payload,
         delivery.attempt_count,
         delivery.lease_token,
         delivery.leased_at,
         delivery.lease_expires_at,
         incident.monitor_id,
         incident.incident_kind,
         incident.state,
         incident.outage_started_at,
         incident.opened_at,
         source.enabled,
         source.last_received_at,
         source.stale_after_seconds,
         source.last_status,
         source.last_issue_codes,
         source.last_release_id
  into delivery_id,
       target_incident_id,
       delivery_state,
       delivery_event_kind,
       delivery_event_payload,
       delivery_attempt_count,
       delivery_lease_token,
       delivery_leased_at,
       delivery_lease_expires_at,
       incident_monitor_id,
       incident_kind,
       incident_state,
       incident_outage_started_at,
       incident_opened_at,
       source_enabled,
       source_last_received_at,
       source_stale_after_seconds,
       source_last_status,
       source_last_issue_codes,
       source_last_release_id
  from public.creator_tracker_monitor_deliveries delivery
  join public.creator_tracker_monitor_incidents incident
    on incident.id = delivery.incident_id
  join public.creator_tracker_monitor_sources source
    on source.monitor_id = incident.monitor_id
  where delivery.id = target_delivery_id
  for update of delivery, incident, source;

  if delivery_id is null then
    return jsonb_build_object(
      'authorized', false,
      'state', 'missing',
      'reasonCode', 'delivery_missing'
    );
  end if;
  if delivery_state <> 'leased'
    or delivery_lease_token is distinct from target_lease_token
    or delivery_lease_expires_at <= check_time
  then
    return jsonb_build_object(
      'authorized', false,
      'state', delivery_state,
      'reasonCode', 'lease_not_current'
    );
  end if;

  if incident_state = 'open' and source_enabled then
    if incident_kind = 'heartbeat_stale' then
      is_authorized := source_last_received_at is not null
        and source_last_received_at <= check_time
          - make_interval(secs => source_stale_after_seconds);
      refusal_code := 'heartbeat_is_fresh';
    elsif incident_kind = 'runtime_failing' then
      is_authorized := source_last_status = 'failing'
        and source_last_issue_codes
          @> array['operator_action_required']::text[];
      refusal_code := 'operator_action_not_required';
    else
      refusal_code := 'incident_kind_not_alertable';
    end if;
  elsif incident_state <> 'open' then
    refusal_code := 'incident_resolved';
  else
    refusal_code := 'monitor_disabled';
  end if;

  if not is_authorized
    or delivery_event_kind not in ('opened', 'repeat')
    or delivery_event_payload->>'incidentKind'
      is distinct from incident_kind
  then
    update public.creator_tracker_monitor_deliveries
    set state = 'cancelled',
        completed_at = check_time,
        completion_lease_token = null,
        lease_token = null,
        leased_by = null,
        leased_at = null,
        lease_expires_at = null,
        send_authorized_at = null,
        last_error_code = case
          when delivery_event_kind not in ('opened', 'repeat')
            then 'delivery_event_retired'
          when delivery_event_payload->>'incidentKind'
            is distinct from incident_kind
            then 'delivery_incident_mismatch'
          else refusal_code
        end,
        updated_at = check_time
    where id = delivery_id;
    return jsonb_build_object(
      'authorized', false,
      'state', 'cancelled',
      'reasonCode', refusal_code
    );
  end if;

  -- The current source row is the durable result of the latest authenticated
  -- heartbeat. Canonicalize the queued payload from that row so a delivery
  -- created before this policy can still carry the current, signed decision
  -- marker instead of being authorized from stale historical JSON.
  delivery_event_payload := delivery_event_payload || jsonb_build_object(
    'schemaVersion', 1,
    'monitorId', incident_monitor_id,
    'incidentKind', incident_kind,
    'eventKind', delivery_event_kind,
    'outageStartedAt', incident_outage_started_at,
    'incidentOpenedAt', incident_opened_at,
    'lastReceivedAt', source_last_received_at,
    'lastStatus', source_last_status,
    'issueCodes', to_jsonb(source_last_issue_codes),
    'releaseId', source_last_release_id
  );

  -- Reset the reminder clock at the last authorized provider attempt. This is
  -- inside the evaluator advisory lock and after the incident row was locked,
  -- so it cannot invert the heartbeat's incident-to-delivery lock order. A
  -- provider outage can therefore never produce a back-to-back reminder as
  -- soon as its original delivery retry succeeds.
  update public.creator_tracker_monitor_incidents incident
  set last_repeat_queued_at = greatest(incident.last_repeat_queued_at, check_time),
      updated_at = check_time
  where incident.id = target_incident_id
    and incident.state = 'open';

  update public.creator_tracker_monitor_deliveries
  set event_payload = delivery_event_payload,
      send_authorized_at = check_time,
      updated_at = check_time
  where id = delivery_id;

  return jsonb_build_object(
    'authorized', true,
    'state', 'leased',
    'deliveryId', delivery_id,
    'leaseToken', delivery_lease_token,
    'eventKind', delivery_event_kind,
    'eventPayload', delivery_event_payload,
    'attemptNumber', delivery_attempt_count,
    'authorizedAt', check_time
  );
end;
$$;

-- Retire every recovery email that has not already been delivered. Recovery
-- remains visible in incident history without generating another notification.
update public.creator_tracker_monitor_deliveries
set state = 'cancelled',
    completed_at = clock_timestamp(),
    completion_lease_token = null,
    lease_token = null,
    leased_by = null,
    leased_at = null,
    lease_expires_at = null,
    last_error_code = 'recovery_email_retired',
    updated_at = clock_timestamp()
where event_kind = 'recovered'
  and state in ('pending', 'leased', 'retry');

-- Resolve today's pre-policy runtime incident and cancel all of its unsent
-- opened, repeat, or recovery work. Sent deliveries remain immutable evidence.
with non_action_incidents as (
  select incident.id
  from public.creator_tracker_monitor_incidents incident
  join public.creator_tracker_monitor_sources source
    on source.monitor_id = incident.monitor_id
  where incident.incident_kind = 'runtime_failing'
    and not (
      source.last_status = 'failing'
      and source.last_issue_codes
        @> array['operator_action_required']::text[]
    )
), resolved as (
  update public.creator_tracker_monitor_incidents incident
  set state = 'resolved',
      resolved_at = coalesce(incident.resolved_at, clock_timestamp()),
      updated_at = clock_timestamp()
  from non_action_incidents target
  where incident.id = target.id
    and incident.state = 'open'
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
    last_error_code = 'operator_marker_required',
    updated_at = clock_timestamp()
where delivery.incident_id in (select id from non_action_incidents)
  and delivery.event_kind in ('opened', 'repeat', 'recovered')
  and delivery.state in ('pending', 'leased', 'retry');

-- A pre-policy runtime incident may already have sent its raw-failure email
-- before the explicit operator marker existed. If that incident is actionable
-- now and has no claimable delivery, queue one deterministic action request
-- immediately instead of making the owner wait for the first 12-hour repeat.
with action_incidents as (
  select incident.id,
         incident.monitor_id,
         incident.incident_kind,
         incident.outage_started_at,
         incident.opened_at,
         source.last_received_at,
         source.last_status,
         source.last_issue_codes,
         source.last_release_id
  from public.creator_tracker_monitor_incidents incident
  join public.creator_tracker_monitor_sources source
    on source.monitor_id = incident.monitor_id
  where incident.state = 'open'
    and incident.incident_kind = 'runtime_failing'
    and source.enabled
    and source.last_status = 'failing'
    and source.last_issue_codes
      @> array['operator_action_required']::text[]
    and not exists (
      select 1
      from public.creator_tracker_monitor_deliveries outstanding
      where outstanding.incident_id = incident.id
        and outstanding.state in ('pending', 'leased', 'retry')
    )
    and not exists (
      select 1
      from public.creator_tracker_monitor_deliveries prior_action
      where prior_action.dedupe_key =
        'creator-tracker-monitor:' || incident.id::text || ':operator-action'
    )
    and not exists (
      select 1
      from public.creator_tracker_monitor_deliveries sent_action
      where sent_action.incident_id = incident.id
        and sent_action.state = 'sent'
        and sent_action.event_kind in ('opened', 'repeat')
        and sent_action.event_payload->'issueCodes'
          @> '["operator_action_required"]'::jsonb
    )
), marked as (
  update public.creator_tracker_monitor_incidents incident
  set last_repeat_queued_at = clock_timestamp(),
      updated_at = clock_timestamp()
  from action_incidents actionable
  where incident.id = actionable.id
  returning actionable.*,
            incident.last_repeat_queued_at as action_queued_at
)
insert into public.creator_tracker_monitor_deliveries (
  incident_id,
  monitor_id,
  event_kind,
  dedupe_key,
  event_payload,
  available_at,
  created_at,
  updated_at
)
select marked.id,
       marked.monitor_id,
       'opened',
       'creator-tracker-monitor:' || marked.id::text || ':operator-action',
       jsonb_build_object(
         'schemaVersion', 1,
         'monitorId', marked.monitor_id,
         'incidentKind', marked.incident_kind,
         'eventKind', 'opened',
         'outageStartedAt', marked.outage_started_at,
         'incidentOpenedAt', marked.opened_at,
         'operatorActionQueuedAt', marked.action_queued_at,
         'lastReceivedAt', marked.last_received_at,
         'lastStatus', marked.last_status,
         'issueCodes', to_jsonb(marked.last_issue_codes),
         'releaseId', marked.last_release_id
       ),
       marked.action_queued_at,
       marked.action_queued_at,
       marked.action_queued_at
from marked
on conflict (dedupe_key) do nothing;

revoke all on function public.creator_tracker_monitor_require_operator_marker()
from public, anon, authenticated, service_role;
revoke all on function public.creator_tracker_monitor_suppress_recovery_email()
from public, anon, authenticated, service_role;
revoke all on function public.creator_tracker_monitor_guard_send_authorization()
from public, anon, authenticated, service_role;
revoke all on function public.creator_tracker_monitor_resolve_silently()
from public, anon, authenticated, service_role;
revoke execute on function public.authorize_creator_tracker_monitor_delivery(uuid, uuid)
from public, anon, authenticated;
grant execute on function public.authorize_creator_tracker_monitor_delivery(uuid, uuid)
to service_role;
