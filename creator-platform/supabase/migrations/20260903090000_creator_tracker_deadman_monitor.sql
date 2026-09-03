-- Off-host dead-man monitoring for the laptop-hosted creator tracker.
--
-- The Vercel receiver commits heartbeats with server time. Supabase owns stale
-- evaluation, incident state, and a separate operations-email outbox. A
-- one-minute pg_cron job invokes the Edge Function, so loss of laptop power or
-- network cannot also disable alert delivery.

create extension if not exists pgcrypto;
create extension if not exists pg_net;
create extension if not exists pg_cron;

create table public.creator_tracker_monitor_sources (
  monitor_id text primary key check (
    char_length(monitor_id) between 3 and 64
    and monitor_id ~ '^[a-z0-9][a-z0-9._-]*$'
  ),
  enabled boolean not null default false,
  enabled_at timestamptz,
  expected_interval_seconds integer not null default 60
    check (expected_interval_seconds between 30 and 300),
  stale_after_seconds integer not null default 300
    check (stale_after_seconds between 120 and 3600),
  repeat_after_seconds integer not null default 1800
    check (repeat_after_seconds between 300 and 86400),
  last_received_at timestamptz,
  last_observed_at timestamptz,
  last_request_timestamp timestamptz,
  last_boot_id uuid,
  last_sequence bigint check (
    last_sequence is null or last_sequence between 0 and 9007199254740991
  ),
  last_status text check (
    last_status is null or last_status in ('healthy', 'degraded', 'failing')
  ),
  last_issue_codes text[] not null default '{}'::text[],
  last_release_id text check (
    last_release_id is null
    or (
      char_length(last_release_id) between 1 and 128
      and last_release_id !~ '[[:cntrl:][:space:]]'
    )
  ),
  last_body_sha256 text check (
    last_body_sha256 is null or last_body_sha256 ~ '^[a-f0-9]{64}$'
  ),
  last_evaluated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (enabled = (enabled_at is not null)),
  check (stale_after_seconds >= expected_interval_seconds * 2),
  check (
    (last_received_at is null and last_observed_at is null and last_boot_id is null and last_sequence is null)
    or
    (last_received_at is not null and last_observed_at is not null and last_boot_id is not null and last_sequence is not null)
  )
);

create table public.creator_tracker_monitor_requests (
  request_nonce uuid primary key,
  monitor_id text not null references public.creator_tracker_monitor_sources(monitor_id)
    on update cascade on delete restrict,
  request_timestamp timestamptz not null,
  body_sha256 text not null check (body_sha256 ~ '^[a-f0-9]{64}$'),
  received_at timestamptz not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  check (expires_at > received_at)
);

create index creator_tracker_monitor_requests_expiry
  on public.creator_tracker_monitor_requests (expires_at);

create table public.creator_tracker_monitor_incidents (
  id uuid primary key default gen_random_uuid(),
  monitor_id text not null references public.creator_tracker_monitor_sources(monitor_id)
    on update cascade on delete restrict,
  incident_kind text not null default 'heartbeat_stale'
    check (incident_kind in ('heartbeat_stale', 'runtime_failing')),
  state text not null default 'open' check (state in ('open', 'resolved')),
  outage_started_at timestamptz not null,
  opened_at timestamptz not null default now(),
  last_repeat_queued_at timestamptz not null default now(),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (state = 'open' and resolved_at is null)
    or (state = 'resolved' and resolved_at is not null)
  ),
  check (outage_started_at <= opened_at),
  check (resolved_at is null or resolved_at >= outage_started_at)
);

create unique index creator_tracker_monitor_one_open_incident
  on public.creator_tracker_monitor_incidents (monitor_id, incident_kind)
  where state = 'open';

create index creator_tracker_monitor_incidents_history
  on public.creator_tracker_monitor_incidents (monitor_id, opened_at desc);

create table public.creator_tracker_monitor_deliveries (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.creator_tracker_monitor_incidents(id)
    on delete restrict,
  monitor_id text not null references public.creator_tracker_monitor_sources(monitor_id)
    on update cascade on delete restrict,
  event_kind text not null check (event_kind in ('opened', 'repeat', 'recovered')),
  dedupe_key text not null unique check (char_length(dedupe_key) between 16 and 256),
  event_payload jsonb not null check (
    jsonb_typeof(event_payload) = 'object' and pg_column_size(event_payload) <= 8192
  ),
  state text not null default 'pending'
    check (state in ('pending', 'leased', 'retry', 'sent', 'cancelled')),
  available_at timestamptz not null default now(),
  -- Operations alerts retry indefinitely. A provider or credential outage must
  -- not silently dead-letter the one message that says collection is down.
  attempt_count integer not null default 0 check (attempt_count >= 0),
  lease_token uuid,
  leased_by text check (
    leased_by is null
    or (
      char_length(leased_by) between 3 and 64
      and leased_by ~ '^[a-z0-9][a-z0-9._-]*$'
    )
  ),
  leased_at timestamptz,
  lease_expires_at timestamptz,
  completion_lease_token uuid,
  provider_status integer check (provider_status is null or provider_status between 100 and 599),
  provider_message_id text check (
    provider_message_id is null
    or (
      char_length(provider_message_id) between 1 and 128
      and provider_message_id ~ '^[A-Za-z0-9_-]+$'
    )
  ),
  provider_receipt_sha256 text check (
    provider_receipt_sha256 is null or provider_receipt_sha256 ~ '^[a-f0-9]{64}$'
  ),
  last_error_code text check (
    last_error_code is null
    or (
      char_length(last_error_code) between 1 and 64
      and last_error_code ~ '^[a-z0-9][a-z0-9._:-]*$'
    )
  ),
  sent_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (state = 'leased' and lease_token is not null and leased_by is not null and leased_at is not null and lease_expires_at is not null)
    or
    (state <> 'leased' and lease_token is null and leased_by is null and leased_at is null and lease_expires_at is null)
  ),
  check ((state = 'sent') = (sent_at is not null)),
  check ((state in ('sent', 'cancelled')) = (completed_at is not null))
);

create index creator_tracker_monitor_deliveries_claimable
  on public.creator_tracker_monitor_deliveries (available_at, created_at)
  where state in ('pending', 'retry');

create index creator_tracker_monitor_deliveries_incident
  on public.creator_tracker_monitor_deliveries (incident_id, created_at);

insert into public.creator_tracker_monitor_sources (
  monitor_id,
  enabled,
  expected_interval_seconds,
  stale_after_seconds,
  repeat_after_seconds
) values (
  'creator-tracker-xps',
  false,
  60,
  300,
  1800
)
on conflict (monitor_id) do nothing;

alter table public.creator_tracker_monitor_sources enable row level security;
alter table public.creator_tracker_monitor_requests enable row level security;
alter table public.creator_tracker_monitor_incidents enable row level security;
alter table public.creator_tracker_monitor_deliveries enable row level security;

create or replace function public.record_creator_tracker_monitor_heartbeat(
  heartbeat_input jsonb,
  request_nonce uuid,
  request_timestamp timestamptz,
  request_body_sha256 text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, extensions, public, auth, pg_temp
as $$
declare
  heartbeat_monitor_id text;
  heartbeat_boot_id uuid;
  heartbeat_sequence bigint;
  heartbeat_observed_at timestamptz;
  heartbeat_status text;
  heartbeat_issue_codes text[];
  heartbeat_release_id text;
  receipt_time timestamptz := clock_timestamp();
  prior_request public.creator_tracker_monitor_requests%rowtype;
  source_record public.creator_tracker_monitor_sources%rowtype;
begin
  perform public.creator_require_service_role();
  perform pg_advisory_xact_lock(hashtextextended('creator-tracker-monitor-evaluator', 17389));

  if jsonb_typeof(heartbeat_input) <> 'object'
    or pg_column_size(heartbeat_input) > 8192
    or not heartbeat_input ?& array[
      'schemaVersion', 'monitorId', 'bootId', 'sequence', 'observedAt',
      'status', 'issueCodes', 'releaseId'
    ]
    or exists (
      select 1
      from jsonb_object_keys(heartbeat_input) as input_key
      where input_key not in (
        'schemaVersion', 'monitorId', 'bootId', 'sequence', 'observedAt',
        'status', 'issueCodes', 'releaseId'
      )
    )
  then
    raise exception 'Monitor heartbeat must match schema version 1.' using errcode = '22023';
  end if;

  heartbeat_monitor_id := heartbeat_input->>'monitorId';
  heartbeat_status := heartbeat_input->>'status';
  heartbeat_release_id := nullif(heartbeat_input->>'releaseId', '');
  if jsonb_typeof(heartbeat_input->'schemaVersion') <> 'number'
    or heartbeat_input->>'schemaVersion' <> '1'
    or jsonb_typeof(heartbeat_input->'monitorId') <> 'string'
    or heartbeat_monitor_id !~ '^[a-z0-9][a-z0-9._-]{2,63}$'
    or jsonb_typeof(heartbeat_input->'status') <> 'string'
    or heartbeat_status not in ('healthy', 'degraded', 'failing')
    or request_body_sha256 !~ '^[a-f0-9]{64}$'
    or abs(extract(epoch from (receipt_time - request_timestamp))) > 300
  then
    raise exception 'Monitor heartbeat authentication metadata is invalid.' using errcode = '22023';
  end if;

  if jsonb_typeof(heartbeat_input->'issueCodes') <> 'array'
    or jsonb_array_length(heartbeat_input->'issueCodes') > 32
    or exists (
      select 1
      from jsonb_array_elements(heartbeat_input->'issueCodes') as issue(value)
      where jsonb_typeof(issue.value) <> 'string'
        or issue.value #>> '{}' !~ '^[a-z0-9][a-z0-9._:-]{0,63}$'
    )
  then
    raise exception 'Monitor issue codes are invalid.' using errcode = '22023';
  end if;

  select coalesce(array_agg(issue.value #>> '{}' order by issue.ordinality), '{}'::text[])
  into heartbeat_issue_codes
  from jsonb_array_elements(heartbeat_input->'issueCodes') with ordinality
    as issue(value, ordinality);
  if cardinality(heartbeat_issue_codes) <> cardinality(array(select distinct unnest(heartbeat_issue_codes))) then
    raise exception 'Monitor issue codes must be unique.' using errcode = '22023';
  end if;

  begin
    heartbeat_boot_id := (heartbeat_input->>'bootId')::uuid;
    heartbeat_sequence := (heartbeat_input->>'sequence')::bigint;
    heartbeat_observed_at := (heartbeat_input->>'observedAt')::timestamptz;
  exception when others then
    raise exception 'Monitor heartbeat fields are invalid.' using errcode = '22023';
  end;
  if heartbeat_input->>'bootId' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or jsonb_typeof(heartbeat_input->'sequence') <> 'number'
    or heartbeat_input->>'sequence' !~ '^(0|[1-9][0-9]{0,15})$'
    or heartbeat_sequence not between 0 and 9007199254740991
    or jsonb_typeof(heartbeat_input->'observedAt') <> 'string'
    or abs(extract(epoch from (receipt_time - heartbeat_observed_at))) > 300
    or jsonb_typeof(heartbeat_input->'releaseId') not in ('string', 'null')
    or (
      heartbeat_release_id is not null
      and (
        char_length(heartbeat_release_id) not between 1 and 128
        or heartbeat_release_id !~ '^[A-Za-z0-9][A-Za-z0-9._:@/+~-]{0,127}$'
      )
    )
  then
    raise exception 'Monitor heartbeat fields are invalid.' using errcode = '22023';
  end if;

  delete from public.creator_tracker_monitor_requests
  where expires_at <= receipt_time;

  select monitor_source.* into source_record
  from public.creator_tracker_monitor_sources monitor_source
  where monitor_source.monitor_id = heartbeat_monitor_id
  for update;
  if source_record.monitor_id is null then
    raise exception 'Monitor source is not provisioned.' using errcode = '22023';
  end if;

  select request_record.* into prior_request
  from public.creator_tracker_monitor_requests request_record
  where request_record.request_nonce = record_creator_tracker_monitor_heartbeat.request_nonce
  for update;

  if prior_request.request_nonce is not null then
    if prior_request.monitor_id = heartbeat_monitor_id
      and prior_request.request_timestamp = record_creator_tracker_monitor_heartbeat.request_timestamp
      and prior_request.body_sha256 = request_body_sha256
    then
      return jsonb_build_object(
        'monitorId', prior_request.monitor_id,
        'receivedAt', prior_request.received_at,
        'replayed', true
      );
    end if;
    raise exception 'MONITOR_REQUEST_REPLAYED' using errcode = '23505';
  end if;

  if source_record.last_observed_at is not null
    and heartbeat_observed_at < source_record.last_observed_at
  then
    raise exception 'Monitor heartbeat moved backwards.' using errcode = '22023';
  end if;
  if source_record.last_boot_id = heartbeat_boot_id
    and heartbeat_sequence <= source_record.last_sequence
  then
    raise exception 'Monitor heartbeat sequence did not advance.' using errcode = '22023';
  end if;

  insert into public.creator_tracker_monitor_requests (
    request_nonce,
    monitor_id,
    request_timestamp,
    body_sha256,
    received_at,
    expires_at
  ) values (
    record_creator_tracker_monitor_heartbeat.request_nonce,
    heartbeat_monitor_id,
    record_creator_tracker_monitor_heartbeat.request_timestamp,
    request_body_sha256,
    receipt_time,
    -- Longer than both sides of the five-minute signing window, including the
    -- exact boundary, so a captured request never becomes replayable.
    receipt_time + interval '11 minutes'
  );

  update public.creator_tracker_monitor_sources
  set last_received_at = receipt_time,
      last_observed_at = heartbeat_observed_at,
      last_request_timestamp = record_creator_tracker_monitor_heartbeat.request_timestamp,
      last_boot_id = heartbeat_boot_id,
      last_sequence = heartbeat_sequence,
      last_status = heartbeat_status,
      last_issue_codes = heartbeat_issue_codes,
      last_release_id = heartbeat_release_id,
      last_body_sha256 = request_body_sha256,
      updated_at = receipt_time
  where monitor_id = heartbeat_monitor_id;

  -- Liveness and runtime health are separate. A signed failing heartbeat still
  -- refreshes the dead-man clock, but it immediately opens a runtime incident.
  -- Degraded coverage remains live and non-paging.
  if source_record.enabled and heartbeat_status = 'failing' then
    insert into public.creator_tracker_monitor_incidents (
      monitor_id,
      incident_kind,
      outage_started_at,
      opened_at,
      last_repeat_queued_at,
      created_at,
      updated_at
    ) values (
      heartbeat_monitor_id,
      'runtime_failing',
      receipt_time,
      receipt_time,
      receipt_time,
      receipt_time,
      receipt_time
    )
    on conflict (monitor_id, incident_kind) where state = 'open' do nothing;

    insert into public.creator_tracker_monitor_deliveries (
      incident_id,
      monitor_id,
      event_kind,
      dedupe_key,
      event_payload,
      available_at
    )
    select incident.id,
      heartbeat_monitor_id,
      'opened',
      'creator-tracker-monitor:' || incident.id::text || ':opened',
      jsonb_build_object(
        'schemaVersion', 1,
        'monitorId', heartbeat_monitor_id,
        'incidentKind', 'runtime_failing',
        'eventKind', 'opened',
        'outageStartedAt', incident.outage_started_at,
        'incidentOpenedAt', incident.opened_at,
        'lastReceivedAt', receipt_time,
        'lastStatus', heartbeat_status,
        'issueCodes', to_jsonb(heartbeat_issue_codes),
        'releaseId', heartbeat_release_id
      ),
      receipt_time
    from public.creator_tracker_monitor_incidents incident
    where incident.monitor_id = heartbeat_monitor_id
      and incident.incident_kind = 'runtime_failing'
      and incident.state = 'open'
    on conflict (dedupe_key) do nothing;
  end if;

  with resolved as (
    update public.creator_tracker_monitor_incidents incident
    set state = 'resolved',
        resolved_at = receipt_time,
        updated_at = receipt_time
    where incident.monitor_id = heartbeat_monitor_id
      and incident.state = 'open'
      and (
        incident.incident_kind = 'heartbeat_stale'
        or (
          incident.incident_kind = 'runtime_failing'
          and heartbeat_status <> 'failing'
        )
      )
    returning incident.*
  ),
  cancelled as (
    update public.creator_tracker_monitor_deliveries delivery
    set state = 'cancelled',
        completed_at = receipt_time,
        last_error_code = 'incident_recovered',
        updated_at = receipt_time
    from resolved
    where delivery.incident_id = resolved.id
      and delivery.event_kind = 'repeat'
      and delivery.state in ('pending', 'retry')
    returning delivery.id
  )
  insert into public.creator_tracker_monitor_deliveries (
    incident_id,
    monitor_id,
    event_kind,
    dedupe_key,
    event_payload,
    available_at
  )
  select resolved.id,
    heartbeat_monitor_id,
    'recovered',
    'creator-tracker-monitor:' || resolved.id::text || ':recovered',
    jsonb_build_object(
      'schemaVersion', 1,
      'monitorId', heartbeat_monitor_id,
      'incidentKind', resolved.incident_kind,
      'eventKind', 'recovered',
      'outageStartedAt', resolved.outage_started_at,
      'incidentOpenedAt', resolved.opened_at,
      'recoveredAt', receipt_time,
      'outageDurationSeconds', greatest(0, floor(extract(epoch from (receipt_time - resolved.outage_started_at)))::bigint),
      'lastReceivedAt', receipt_time,
      'lastStatus', heartbeat_status,
      'issueCodes', to_jsonb(heartbeat_issue_codes),
      'releaseId', heartbeat_release_id
    ),
    receipt_time
  from resolved
  on conflict (dedupe_key) do nothing;

  return jsonb_build_object(
    'monitorId', heartbeat_monitor_id,
    'receivedAt', receipt_time,
    'replayed', false
  );
end;
$$;

create or replace function public.set_creator_tracker_monitor_enabled(
  target_monitor_id text,
  target_enabled boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  changed_source public.creator_tracker_monitor_sources%rowtype;
  change_time timestamptz := clock_timestamp();
begin
  perform public.creator_require_service_role();
  perform pg_advisory_xact_lock(hashtextextended('creator-tracker-monitor-evaluator', 17389));

  if target_enabled is null then
    raise exception 'Monitor enabled state is required.' using errcode = '22023';
  end if;

  select source.* into changed_source
  from public.creator_tracker_monitor_sources source
  where source.monitor_id = target_monitor_id
  for update;
  if changed_source.monitor_id is null then
    raise exception 'Monitor source is not provisioned.' using errcode = '22023';
  end if;
  if target_enabled and (
    changed_source.last_received_at is null
    or changed_source.last_received_at <= now() - make_interval(secs => changed_source.stale_after_seconds)
  ) then
    raise exception 'A fresh heartbeat is required before enabling the monitor.' using errcode = '22023';
  end if;

  update public.creator_tracker_monitor_sources
  set enabled = target_enabled,
      enabled_at = case when target_enabled then coalesce(enabled_at, change_time) else null end,
      updated_at = change_time
  where monitor_id = target_monitor_id
  returning * into changed_source;

  if not target_enabled then
    with resolved as (
      update public.creator_tracker_monitor_incidents incident
      set state = 'resolved',
          resolved_at = change_time,
          updated_at = change_time
      where incident.monitor_id = target_monitor_id
        and incident.state = 'open'
      returning incident.id
    )
    update public.creator_tracker_monitor_deliveries delivery
    set state = 'cancelled',
        completed_at = change_time,
        last_error_code = 'monitor_disabled',
        updated_at = change_time
    from resolved
    where delivery.incident_id = resolved.id
      and delivery.state in ('pending', 'retry');
  end if;

  return jsonb_build_object(
    'monitorId', changed_source.monitor_id,
    'enabled', changed_source.enabled,
    'enabledAt', changed_source.enabled_at,
    'lastReceivedAt', changed_source.last_received_at
  );
end;
$$;

create or replace function public.lease_creator_tracker_monitor_deliveries(
  worker_id text,
  max_deliveries integer default 10,
  lease_seconds integer default 120
)
returns table (
  delivery_id uuid,
  lease_token uuid,
  event_kind text,
  event_payload jsonb,
  attempt_number integer
)
language plpgsql
security definer
set search_path = pg_catalog, extensions, public, auth, pg_temp
as $$
declare
  evaluation_time timestamptz := clock_timestamp();
begin
  perform public.creator_require_service_role();

  if worker_id !~ '^[a-z0-9][a-z0-9._-]{2,63}$'
    or max_deliveries not between 1 and 25
    or lease_seconds not between 30 and 300
  then
    raise exception 'Monitor delivery lease input is invalid.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('creator-tracker-monitor-evaluator', 17389));

  update public.creator_tracker_monitor_sources
  set last_evaluated_at = evaluation_time
  where enabled;

  update public.creator_tracker_monitor_deliveries delivery
  set state = 'retry',
      available_at = evaluation_time,
      last_error_code = 'lease_expired',
      completed_at = null,
      completion_lease_token = null,
      lease_token = null,
      leased_by = null,
      leased_at = null,
      lease_expires_at = null,
      updated_at = evaluation_time
  where delivery.state = 'leased'
    and delivery.lease_expires_at <= evaluation_time;

  insert into public.creator_tracker_monitor_incidents (
    monitor_id,
    outage_started_at,
    opened_at,
    last_repeat_queued_at,
    created_at,
    updated_at
  )
  select source.monitor_id,
         source.last_received_at + make_interval(secs => source.stale_after_seconds),
         evaluation_time,
         evaluation_time,
         evaluation_time,
         evaluation_time
  from public.creator_tracker_monitor_sources source
  where source.enabled
    and source.last_received_at is not null
    and source.last_received_at <= evaluation_time - make_interval(secs => source.stale_after_seconds)
  on conflict (monitor_id, incident_kind) where state = 'open' do nothing;

  insert into public.creator_tracker_monitor_incidents (
    monitor_id,
    incident_kind,
    outage_started_at,
    opened_at,
    last_repeat_queued_at,
    created_at,
    updated_at
  )
  select source.monitor_id,
         'runtime_failing',
         source.last_received_at,
         evaluation_time,
         evaluation_time,
         evaluation_time,
         evaluation_time
  from public.creator_tracker_monitor_sources source
  where source.enabled
    and source.last_received_at is not null
    and source.last_status = 'failing'
  on conflict (monitor_id, incident_kind) where state = 'open' do nothing;

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
  select incident.id,
         incident.monitor_id,
         'opened',
         'creator-tracker-monitor:' || incident.id::text || ':opened',
         jsonb_build_object(
           'schemaVersion', 1,
           'monitorId', incident.monitor_id,
           'incidentKind', incident.incident_kind,
           'eventKind', 'opened',
           'outageStartedAt', incident.outage_started_at,
           'incidentOpenedAt', incident.opened_at,
           'lastReceivedAt', source.last_received_at,
           'lastStatus', source.last_status,
           'issueCodes', to_jsonb(source.last_issue_codes),
           'releaseId', source.last_release_id
         ),
         evaluation_time,
         evaluation_time,
         evaluation_time
  from public.creator_tracker_monitor_incidents incident
  join public.creator_tracker_monitor_sources source
    on source.monitor_id = incident.monitor_id
  where incident.state = 'open'
    and source.enabled
  on conflict (dedupe_key) do nothing;

  with repeat_due as (
    select incident.id
    from public.creator_tracker_monitor_incidents incident
    join public.creator_tracker_monitor_sources source
      on source.monitor_id = incident.monitor_id
    where incident.state = 'open'
      and source.enabled
      and incident.last_repeat_queued_at <=
        evaluation_time - make_interval(secs => source.repeat_after_seconds)
      and not exists (
        select 1
        from public.creator_tracker_monitor_deliveries outstanding
        where outstanding.incident_id = incident.id
          and outstanding.state in ('pending', 'leased', 'retry')
      )
    for update of incident
  ),
  marked as (
    update public.creator_tracker_monitor_incidents incident
    set last_repeat_queued_at = evaluation_time,
        updated_at = evaluation_time
    from repeat_due
    where incident.id = repeat_due.id
    returning incident.*
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
         'repeat',
         'creator-tracker-monitor:' || marked.id::text || ':repeat:' ||
           floor(extract(epoch from evaluation_time) / source.repeat_after_seconds)::bigint::text,
         jsonb_build_object(
           'schemaVersion', 1,
           'monitorId', marked.monitor_id,
           'incidentKind', marked.incident_kind,
           'eventKind', 'repeat',
           'outageStartedAt', marked.outage_started_at,
           'incidentOpenedAt', marked.opened_at,
           'repeatQueuedAt', evaluation_time,
           'outageDurationSeconds', greatest(0, floor(extract(epoch from (evaluation_time - marked.outage_started_at)))::bigint),
           'lastReceivedAt', source.last_received_at,
           'lastStatus', source.last_status,
           'issueCodes', to_jsonb(source.last_issue_codes),
           'releaseId', source.last_release_id
         ),
         evaluation_time,
         evaluation_time,
         evaluation_time
  from marked
  join public.creator_tracker_monitor_sources source
    on source.monitor_id = marked.monitor_id
  on conflict (dedupe_key) do nothing;

  return query
  with claimable as (
    select delivery.id
    from public.creator_tracker_monitor_deliveries delivery
    where delivery.state in ('pending', 'retry')
      and delivery.available_at <= evaluation_time
    order by delivery.created_at, delivery.id
    for update skip locked
    limit max_deliveries
  ),
  claimed as (
    update public.creator_tracker_monitor_deliveries delivery
    set state = 'leased',
        attempt_count = delivery.attempt_count + 1,
        lease_token = gen_random_uuid(),
        leased_by = lease_creator_tracker_monitor_deliveries.worker_id,
        leased_at = evaluation_time,
        lease_expires_at = evaluation_time + make_interval(secs => lease_seconds),
        completion_lease_token = null,
        updated_at = evaluation_time
    from claimable
    where delivery.id = claimable.id
    returning delivery.id,
              delivery.lease_token,
              delivery.event_kind,
              delivery.event_payload,
              delivery.attempt_count
  )
  select claimed.id,
         claimed.lease_token,
         claimed.event_kind,
         claimed.event_payload,
         claimed.attempt_count::integer
  from claimed;
end;
$$;

create or replace function public.complete_creator_tracker_monitor_delivery(
  target_delivery_id uuid,
  target_lease_token uuid,
  result_input jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  delivery_record public.creator_tracker_monitor_deliveries%rowtype;
  outcome text := lower(btrim(coalesce(result_input->>'outcome', '')));
  receipt_digest text := nullif(lower(btrim(coalesce(result_input->>'providerReceiptSha256', ''))), '');
  provider_receipt_id text := nullif(btrim(coalesce(result_input->>'providerMessageId', '')), '');
  failure_code text := nullif(lower(btrim(coalesce(result_input->>'errorCode', ''))), '');
  provider_code integer;
  retry_after_seconds integer;
  final_state text;
begin
  perform public.creator_require_service_role();

  if jsonb_typeof(result_input) <> 'object' or pg_column_size(result_input) > 4096 then
    raise exception 'Monitor delivery result is invalid.' using errcode = '22023';
  end if;
  begin
    provider_code := nullif(result_input->>'providerStatus', '')::integer;
    retry_after_seconds := nullif(result_input->>'retryAfterSeconds', '')::integer;
  exception when others then
    raise exception 'Monitor delivery result fields are invalid.' using errcode = '22023';
  end;

  select delivery.* into delivery_record
  from public.creator_tracker_monitor_deliveries delivery
  where delivery.id = target_delivery_id
  for update;
  if delivery_record.id is null then
    return jsonb_build_object('accepted', false, 'state', 'missing');
  end if;
  if delivery_record.completion_lease_token = target_lease_token
    and delivery_record.state in ('sent', 'retry', 'cancelled')
  then
    return jsonb_build_object(
      'accepted', true,
      'state', delivery_record.state,
      'replayed', true
    );
  end if;
  if delivery_record.state <> 'leased'
    or delivery_record.lease_token is distinct from target_lease_token
    or delivery_record.lease_expires_at <= now()
  then
    return jsonb_build_object('accepted', false, 'state', delivery_record.state);
  end if;

  if outcome = 'sent' then
    if provider_code is null
      or provider_code not between 200 and 299
      or receipt_digest is null
      or receipt_digest !~ '^[a-f0-9]{64}$'
      or provider_receipt_id is null
      or provider_receipt_id !~ '^[A-Za-z0-9_-]{1,128}$'
    then
      raise exception 'Sent monitor delivery receipt is invalid.' using errcode = '22023';
    end if;
    final_state := 'sent';
  elsif outcome = 'retry' then
    if failure_code is null
      or failure_code !~ '^[a-z0-9][a-z0-9._:-]{0,63}$'
      or retry_after_seconds is null
      or retry_after_seconds not between 30 and 3600
      or (provider_code is not null and provider_code not between 100 and 599)
    then
      raise exception 'Monitor delivery retry is invalid.' using errcode = '22023';
    end if;
    final_state := 'retry';
  else
    raise exception 'Monitor delivery outcome is invalid.' using errcode = '22023';
  end if;

  update public.creator_tracker_monitor_deliveries
  set state = final_state,
      available_at = case
        when final_state = 'retry' then now() + make_interval(secs => retry_after_seconds)
        else available_at
      end,
      completion_lease_token = target_lease_token,
      provider_status = provider_code,
      provider_message_id = case when final_state = 'sent' then provider_receipt_id else null end,
      provider_receipt_sha256 = case when final_state = 'sent' then receipt_digest else null end,
      last_error_code = case when final_state = 'retry' then failure_code else null end,
      sent_at = case when final_state = 'sent' then now() else null end,
      completed_at = case when final_state = 'sent' then now() else null end,
      lease_token = null,
      leased_by = null,
      leased_at = null,
      lease_expires_at = null,
      updated_at = now()
  where id = target_delivery_id;

  return jsonb_build_object('accepted', true, 'state', final_state, 'replayed', false);
end;
$$;

create or replace function public.invoke_creator_tracker_monitor_edge_tick()
returns bigint
language plpgsql
security definer
set search_path = pg_catalog, extensions, public, vault, net, pg_temp
as $$
declare
  edge_url text;
  anon_key text;
  tick_secret text;
  request_id bigint;
begin
  -- Keep the cron harmless until a fresh heartbeat has been received and the
  -- source has explicitly been enabled after Edge Function secret setup.
  if not exists (
    select 1 from public.creator_tracker_monitor_sources source where source.enabled
  ) then
    return null;
  end if;

  select decrypted_secret into edge_url
  from vault.decrypted_secrets
  where name = 'creator_tracker_monitor_edge_url';
  select decrypted_secret into anon_key
  from vault.decrypted_secrets
  where name = 'creator_tracker_monitor_anon_key';
  select decrypted_secret into tick_secret
  from vault.decrypted_secrets
  where name = 'creator_tracker_monitor_tick_secret';

  if edge_url is null
    or edge_url !~ '^https://[A-Za-z0-9.-]+/functions/v1/creator-tracker-monitor-tick$'
    or anon_key is null
    or tick_secret is null
    or octet_length(tick_secret) < 32
  then
    raise exception 'Creator tracker monitor Edge Function is not configured.'
      using errcode = '55000';
  end if;

  select net.http_post(
    url := edge_url,
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'authorization', 'Bearer ' || anon_key,
      'apikey', anon_key,
      'x-gotall-monitor-tick-secret', tick_secret
    ),
    body := jsonb_build_object('schemaVersion', 1),
    timeout_milliseconds := 15000
  ) into request_id;
  return request_id;
end;
$$;

do $$
declare
  old_job_id bigint;
begin
  for old_job_id in
    select jobid from cron.job where jobname = 'creator-tracker-monitor-every-minute'
  loop
    perform cron.unschedule(old_job_id);
  end loop;
  perform cron.schedule(
    'creator-tracker-monitor-every-minute',
    '* * * * *',
    'select public.invoke_creator_tracker_monitor_edge_tick();'
  );
end;
$$;

revoke all on public.creator_tracker_monitor_sources from public, anon, authenticated;
revoke all on public.creator_tracker_monitor_requests from public, anon, authenticated;
revoke all on public.creator_tracker_monitor_incidents from public, anon, authenticated;
revoke all on public.creator_tracker_monitor_deliveries from public, anon, authenticated;

revoke execute on function public.record_creator_tracker_monitor_heartbeat(jsonb, uuid, timestamptz, text)
from public, anon, authenticated;
grant execute on function public.record_creator_tracker_monitor_heartbeat(jsonb, uuid, timestamptz, text)
to service_role;

revoke execute on function public.set_creator_tracker_monitor_enabled(text, boolean)
from public, anon, authenticated;
grant execute on function public.set_creator_tracker_monitor_enabled(text, boolean)
to service_role;

revoke execute on function public.lease_creator_tracker_monitor_deliveries(text, integer, integer)
from public, anon, authenticated;
grant execute on function public.lease_creator_tracker_monitor_deliveries(text, integer, integer)
to service_role;

revoke execute on function public.complete_creator_tracker_monitor_delivery(uuid, uuid, jsonb)
from public, anon, authenticated;
grant execute on function public.complete_creator_tracker_monitor_delivery(uuid, uuid, jsonb)
to service_role;

revoke execute on function public.invoke_creator_tracker_monitor_edge_tick()
from public, anon, authenticated, service_role;
