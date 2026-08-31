-- Verified Discord identity and durable creator-notification delivery.
--
-- The browser never receives the bot token, OAuth access/refresh tokens are
-- never persisted, and rendered message bodies are not stored. The database
-- owns consent, idempotency, leases, retry state, and delivery receipts so a
-- rebooted worker can resume without duplicating logical notifications.

create extension if not exists pgcrypto;

create or replace function public.creator_valid_discord_snowflake(candidate text)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select candidate ~ '^[0-9]{17,20}$';
$$;

create or replace function public.creator_require_service_role()
returns void
language plpgsql
stable
set search_path = public, auth, pg_temp
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;
end;
$$;

create table public.discord_oauth_attempts (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.creator_accounts(auth_user_id) on delete cascade,
  state_hash text not null unique check (state_hash ~ '^[a-f0-9]{64}$'),
  return_path text not null check (
    char_length(return_path) between 1 and 512
    and left(return_path, 1) = '/'
    and left(return_path, 2) <> '//'
    and position(E'\\' in return_path) = 0
    and return_path !~ '[[:cntrl:]]'
  ),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  check (consumed_at is null or consumed_at >= created_at)
);

create index discord_oauth_attempts_account_created
  on public.discord_oauth_attempts (account_id, created_at desc);

create unique index discord_oauth_attempts_one_active_account
  on public.discord_oauth_attempts (account_id)
  where consumed_at is null;

create table public.creator_discord_connections (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.creator_accounts(auth_user_id) on delete cascade,
  discord_user_id text not null check (public.creator_valid_discord_snowflake(discord_user_id)),
  username text not null check (char_length(username) between 1 and 32),
  global_name text check (global_name is null or char_length(global_name) between 1 and 32),
  discriminator text check (discriminator is null or discriminator ~ '^[0-9]{1,4}$'),
  avatar_hash text check (avatar_hash is null or char_length(avatar_hash) between 1 and 128),
  guild_id text not null check (public.creator_valid_discord_snowflake(guild_id)),
  membership_status text not null check (
    membership_status in ('member', 'not_member', 'unknown', 'disconnected')
  ),
  dm_channel_id text check (
    dm_channel_id is null or public.creator_valid_discord_snowflake(dm_channel_id)
  ),
  desired_managed_role_keys text[] not null default '{}'::text[] check (
    desired_managed_role_keys <@ array['onboarding', 'active', 'at_risk', 'top_performer']::text[]
  ),
  managed_role_revision integer not null default 0 check (managed_role_revision >= 0),
  connected_at timestamptz not null default now(),
  last_verified_at timestamptz not null default now(),
  membership_checked_at timestamptz not null default now(),
  disconnected_at timestamptz,
  updated_at timestamptz not null default now(),
  check (
    (membership_status = 'disconnected' and disconnected_at is not null)
    or (membership_status <> 'disconnected' and disconnected_at is null)
  )
);

create unique index creator_discord_connections_one_active_account
  on public.creator_discord_connections (account_id)
  where disconnected_at is null;

create unique index creator_discord_connections_one_active_discord_user
  on public.creator_discord_connections (discord_user_id)
  where disconnected_at is null;

create index creator_discord_connections_account_history
  on public.creator_discord_connections (account_id, connected_at desc);

create table public.creator_discord_preferences (
  account_id uuid primary key references public.creator_accounts(auth_user_id) on delete cascade,
  discord_opt_in boolean not null default false,
  discord_opted_in_at timestamptz,
  timezone text not null default 'UTC' check (
    char_length(timezone) between 3 and 64
    and timezone ~ '^(UTC|[A-Za-z][A-Za-z0-9._+-]*(/[A-Za-z0-9._+-]+)+)$'
  ),
  quiet_hours_enabled boolean not null default true,
  quiet_start time without time zone not null default time '21:00',
  quiet_end time without time zone not null default time '09:00',
  updated_at timestamptz not null default now(),
  check (discord_opt_in = (discord_opted_in_at is not null))
);

create table public.creator_discord_subscriptions (
  account_id uuid not null references public.creator_accounts(auth_user_id) on delete cascade,
  topic text not null check (
    topic in ('account', 'onboarding', 'posting', 'performance', 'payments')
  ),
  enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (account_id, topic)
);

create table public.creator_notifications (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.creator_accounts(auth_user_id) on delete cascade,
  event_key text not null check (
    char_length(event_key) between 1 and 160
    and event_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
  ),
  topic text not null check (
    topic in ('account', 'onboarding', 'posting', 'performance', 'payments')
  ),
  notification_type text not null check (
    char_length(notification_type) between 1 and 80
    and notification_type ~ '^[a-z][a-z0-9._-]*$'
  ),
  title text not null check (char_length(title) between 1 and 140),
  action_path text check (
    action_path is null or (
      char_length(action_path) between 1 and 512
      and left(action_path, 1) = '/'
      and left(action_path, 2) <> '//'
      and position(E'\\' in action_path) = 0
      and action_path !~ '[[:cntrl:]]'
    )
  ),
  template_key text not null check (
    char_length(template_key) between 1 and 80
    and template_key ~ '^[a-z][a-z0-9._-]*$'
  ),
  template_version integer not null check (template_version between 1 and 10000),
  variables jsonb not null default '{}'::jsonb check (
    jsonb_typeof(variables) = 'object' and pg_column_size(variables) <= 16384
  ),
  payload_sha256 text not null check (payload_sha256 ~ '^[a-f0-9]{64}$'),
  source_occurred_at timestamptz not null,
  scheduled_for timestamptz not null default now(),
  expires_at timestamptz not null,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  unique (account_id, event_key),
  check (expires_at > scheduled_for),
  check (cancelled_at is null or cancelled_at >= created_at)
);

create index creator_notifications_account_schedule
  on public.creator_notifications (account_id, scheduled_for desc);

create table public.creator_notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references public.creator_notifications(id) on delete cascade,
  idempotency_key text not null unique check (char_length(idempotency_key) between 1 and 240),
  channel text not null default 'discord' check (channel = 'discord'),
  state text not null default 'scheduled' check (
    state in (
      'scheduled',
      'leased',
      'sending',
      'sent',
      'retry',
      'blocked',
      'delivery_unknown',
      'cancelled',
      'dead'
    )
  ),
  provider_nonce text not null unique check (
    char_length(provider_nonce) between 1 and 25
    and provider_nonce ~ '^[A-Za-z0-9._-]+$'
  ),
  available_at timestamptz not null,
  lease_token uuid,
  leased_by text check (leased_by is null or char_length(leased_by) between 1 and 80),
  leased_at timestamptz,
  lease_expires_at timestamptz,
  attempt_count integer not null default 0 check (attempt_count between 0 and 1000),
  -- Ambiguous provider acceptance is durable across leases and policy deferrals.
  -- A recovery lease is evidence-only: the worker must not blindly POST again.
  recovery_required boolean not null default false,
  target_connection_id uuid references public.creator_discord_connections(id) on delete set null,
  target_discord_user_id text check (
    target_discord_user_id is null or public.creator_valid_discord_snowflake(target_discord_user_id)
  ),
  target_dm_channel_id text check (
    target_dm_channel_id is null or public.creator_valid_discord_snowflake(target_dm_channel_id)
  ),
  provider_message_id text check (
    provider_message_id is null or public.creator_valid_discord_snowflake(provider_message_id)
  ),
  provider_channel_id text check (
    provider_channel_id is null or public.creator_valid_discord_snowflake(provider_channel_id)
  ),
  sent_at timestamptz,
  last_error_code text check (last_error_code is null or char_length(last_error_code) <= 80),
  blocked_reason text check (blocked_reason is null or char_length(blocked_reason) <= 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (notification_id, channel),
  check (
    (state in ('leased', 'sending') and lease_token is not null and leased_by is not null
      and leased_at is not null and lease_expires_at is not null)
    or
    (state not in ('leased', 'sending') and lease_token is null and leased_by is null
      and leased_at is null and lease_expires_at is null)
  ),
  check (
    (state = 'sent' and sent_at is not null and provider_message_id is not null)
    or state <> 'sent'
  )
);

create index creator_notification_deliveries_claim
  on public.creator_notification_deliveries (state, available_at, created_at)
  where state in ('scheduled', 'retry', 'delivery_unknown');

create table public.creator_notification_delivery_attempts (
  id bigint generated always as identity primary key,
  delivery_id uuid not null references public.creator_notification_deliveries(id) on delete cascade,
  attempt_number integer not null check (attempt_number > 0),
  lease_token uuid not null,
  worker_id text not null check (char_length(worker_id) between 1 and 80),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  outcome text check (
    outcome is null or outcome in (
      'sent', 'retry', 'blocked', 'delivery_unknown', 'cancelled', 'dead'
    )
  ),
  provider_status integer check (provider_status is null or provider_status between 100 and 599),
  provider_error_code text check (
    provider_error_code is null or char_length(provider_error_code) <= 80
  ),
  provider_response_sha256 text check (
    provider_response_sha256 is null or provider_response_sha256 ~ '^[a-f0-9]{64}$'
  ),
  receipt jsonb not null default '{}'::jsonb check (
    jsonb_typeof(receipt) = 'object' and pg_column_size(receipt) <= 4096
  ),
  unique (delivery_id, attempt_number),
  unique (delivery_id, lease_token),
  check ((completed_at is null) = (outcome is null))
);

create sequence public.creator_discord_role_authority_revision_seq;

create table public.creator_discord_role_sync_jobs (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.creator_accounts(auth_user_id) on delete cascade,
  connection_id uuid references public.creator_discord_connections(id) on delete set null,
  discord_user_id text not null check (public.creator_valid_discord_snowflake(discord_user_id)),
  desired_role_keys text[] not null default '{}'::text[] check (
    desired_role_keys <@ array['onboarding', 'active', 'at_risk', 'top_performer']::text[]
  ),
  authority_revision bigint not null unique default
    nextval('public.creator_discord_role_authority_revision_seq'::regclass),
  idempotency_key text not null unique check (char_length(idempotency_key) between 1 and 200),
  state text not null default 'scheduled' check (
    state in ('scheduled', 'leased', 'completed', 'retry', 'blocked', 'cancelled', 'dead')
  ),
  available_at timestamptz not null default now(),
  lease_token uuid,
  leased_by text check (leased_by is null or char_length(leased_by) between 1 and 80),
  leased_at timestamptz,
  lease_expires_at timestamptz,
  attempt_count integer not null default 0 check (attempt_count between 0 and 1000),
  last_completion_lease_token uuid,
  last_receipt jsonb not null default '{}'::jsonb check (
    jsonb_typeof(last_receipt) = 'object' and pg_column_size(last_receipt) <= 4096
  ),
  last_error_code text check (last_error_code is null or char_length(last_error_code) <= 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (state = 'leased' and lease_token is not null and leased_by is not null
      and leased_at is not null and lease_expires_at is not null)
    or
    (state <> 'leased' and lease_token is null and leased_by is null
      and leased_at is null and lease_expires_at is null)
  )
);

alter sequence public.creator_discord_role_authority_revision_seq
owned by public.creator_discord_role_sync_jobs.authority_revision;

create index creator_discord_role_sync_jobs_claim
  on public.creator_discord_role_sync_jobs (state, available_at, created_at)
  where state in ('scheduled', 'retry');

create table public.creator_discord_worker_heartbeats (
  worker_id text primary key check (
    char_length(worker_id) between 1 and 80
    and worker_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
  ),
  instance_id text check (instance_id is null or char_length(instance_id) between 1 and 120),
  worker_version text check (worker_version is null or char_length(worker_version) between 1 and 80),
  status text not null default 'healthy' check (status in ('healthy', 'degraded', 'draining')),
  capabilities text[] not null default '{}'::text[],
  queue_depth integer check (queue_depth is null or queue_depth >= 0),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.creator_discord_worker_requests (
  request_nonce uuid primary key,
  worker_id text not null check (
    char_length(worker_id) between 1 and 80
    and worker_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
  ),
  request_timestamp timestamptz not null,
  body_sha256 text not null check (body_sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  check (expires_at > created_at)
);

create index creator_discord_worker_requests_expiry
  on public.creator_discord_worker_requests (expires_at);

create trigger creator_discord_connections_touch_updated_at
before update on public.creator_discord_connections
for each row execute function public.creator_touch_updated_at();

create trigger creator_discord_preferences_touch_updated_at
before update on public.creator_discord_preferences
for each row execute function public.creator_touch_updated_at();

create trigger creator_discord_subscriptions_touch_updated_at
before update on public.creator_discord_subscriptions
for each row execute function public.creator_touch_updated_at();

create trigger creator_notification_deliveries_touch_updated_at
before update on public.creator_notification_deliveries
for each row execute function public.creator_touch_updated_at();

create trigger creator_discord_role_sync_jobs_touch_updated_at
before update on public.creator_discord_role_sync_jobs
for each row execute function public.creator_touch_updated_at();

create trigger creator_discord_worker_heartbeats_touch_updated_at
before update on public.creator_discord_worker_heartbeats
for each row execute function public.creator_touch_updated_at();

create or replace function public.creator_seed_discord_defaults()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.creator_discord_preferences (account_id)
  values (new.auth_user_id)
  on conflict (account_id) do nothing;

  insert into public.creator_discord_subscriptions (account_id, topic, enabled)
  select new.auth_user_id, topic_name, topic_name not in ('posting', 'performance')
  from unnest(array['account', 'onboarding', 'posting', 'performance', 'payments']::text[]) topic_name
  on conflict (account_id, topic) do nothing;

  return new;
end;
$$;

create trigger creator_accounts_seed_discord_defaults
after insert on public.creator_accounts
for each row execute function public.creator_seed_discord_defaults();

insert into public.creator_discord_preferences (account_id)
select auth_user_id from public.creator_accounts
on conflict (account_id) do nothing;

insert into public.creator_discord_subscriptions (account_id, topic, enabled)
select creator_accounts.auth_user_id,
       topics.topic,
       topics.topic not in ('posting', 'performance')
from public.creator_accounts
cross join unnest(array['account', 'onboarding', 'posting', 'performance', 'payments']::text[]) topics(topic)
on conflict (account_id, topic) do nothing;

create or replace function public.creator_discord_desired_role_keys(target_account_id uuid)
returns text[]
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case lifecycle_status
    when 'active' then array['active']::text[]
    when 'suspended' then '{}'::text[]
    when 'closed' then '{}'::text[]
    else array['onboarding']::text[]
  end
  from public.creator_accounts
  where auth_user_id = target_account_id;
$$;

create or replace function public.creator_enqueue_discord_role_sync_job(
  target_account_id uuid,
  target_connection_id uuid,
  target_discord_user_id text,
  target_role_keys text[],
  reassertion_key text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  normalized_role_keys text[];
  role_job_key text;
  role_job_id uuid;
  role_job_authority_revision bigint;
  current_role_keys text[];
  current_role_revision integer;
  existing_job_state text;
begin
  select coalesce(array_agg(distinct role_key order by role_key), '{}'::text[])
  into normalized_role_keys
  from unnest(coalesce(target_role_keys, '{}'::text[])) role_key;

  if not normalized_role_keys <@ array['onboarding', 'active', 'at_risk', 'top_performer']::text[] then
    raise exception 'Unsupported managed Discord role key.' using errcode = '22023';
  end if;

  if reassertion_key is not null
    and reassertion_key !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  then
    raise exception 'Role reassertion key must be a lease UUID.' using errcode = '22023';
  end if;

  -- Managed roles are authoritative per Discord identity, including across a
  -- disconnect/reconnect that creates a new connection row. Serialize every
  -- producer for that identity before deciding which reconciliation is latest.
  perform pg_advisory_xact_lock(hashtextextended(target_discord_user_id, 104729));

  select connection.desired_managed_role_keys,
         connection.managed_role_revision
  into current_role_keys, current_role_revision
  from public.creator_discord_connections connection
  where connection.id = target_connection_id
  for update;

  if not found then
    raise exception 'Discord connection was not found for role reconciliation.'
      using errcode = '22023';
  end if;

  if reassertion_key is not null then
    role_job_key := target_connection_id::text || ':late:' || reassertion_key;

    select role_job.id into role_job_id
    from public.creator_discord_role_sync_jobs role_job
    where role_job.idempotency_key = role_job_key;

    if role_job_id is not null then
      return role_job_id;
    end if;

    -- A late worker may have changed provider roles after its lease expired.
    -- Advance authority unconditionally and reconcile the current desired set.
    update public.creator_discord_connections
    set desired_managed_role_keys = normalized_role_keys,
        managed_role_revision = managed_role_revision + 1
    where id = target_connection_id
    returning managed_role_revision into current_role_revision;
  else
    if current_role_keys is distinct from normalized_role_keys then
      update public.creator_discord_connections
      set desired_managed_role_keys = normalized_role_keys,
          managed_role_revision = managed_role_revision + 1
      where id = target_connection_id
      returning managed_role_revision into current_role_revision;
    end if;

    role_job_key := target_connection_id::text || ':' || current_role_revision::text;

    select role_job.id, role_job.state
    into role_job_id, existing_job_state
    from public.creator_discord_role_sync_jobs role_job
    where role_job.idempotency_key = role_job_key;

    -- A live or successfully completed reconciliation already represents this
    -- exact connection revision. Retrying the same lifecycle transition must not
    -- manufacture another role operation.
    if role_job_id is not null
      and existing_job_state in ('scheduled', 'leased', 'retry', 'completed')
    then
      return role_job_id;
    end if;

    -- A blocked/cancelled/dead revision is immutable audit history. If the same
    -- desired set becomes authoritative again, advance the connection revision
    -- and create a new job rather than reopening an old operation.
    if role_job_id is not null then
      update public.creator_discord_connections
      set managed_role_revision = managed_role_revision + 1
      where id = target_connection_id
      returning managed_role_revision into current_role_revision;

      role_job_key := target_connection_id::text || ':' || current_role_revision::text;
    end if;
  end if;

  insert into public.creator_discord_role_sync_jobs (
    account_id,
    connection_id,
    discord_user_id,
    desired_role_keys,
    idempotency_key
  ) values (
    target_account_id,
    target_connection_id,
    target_discord_user_id,
    normalized_role_keys,
    role_job_key
  )
  returning id, authority_revision
  into role_job_id, role_job_authority_revision;

  -- Only the newest intent for a Discord identity may remain claimable. Do not
  -- revoke an in-flight lease: the newest job waits for it, then converges the
  -- final role set after that older worker finishes or its lease expires.
  update public.creator_discord_role_sync_jobs role_job
  set state = 'cancelled',
      lease_token = null,
      leased_by = null,
      leased_at = null,
      lease_expires_at = null,
      last_error_code = 'superseded'
  where role_job.discord_user_id = target_discord_user_id
    and role_job.authority_revision < role_job_authority_revision
    and role_job.state in ('scheduled', 'retry', 'blocked');

  return role_job_id;
end;
$$;

create or replace function public.creator_queue_discord_role_sync_after_lifecycle_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  active_connection public.creator_discord_connections%rowtype;
begin
  if new.lifecycle_status is not distinct from old.lifecycle_status then
    return new;
  end if;

  select connection.* into active_connection
  from public.creator_discord_connections connection
  where connection.account_id = new.auth_user_id
    and connection.disconnected_at is null
    and connection.membership_status = 'member'
  limit 1;

  if active_connection.id is not null then
    perform public.creator_enqueue_discord_role_sync_job(
      new.auth_user_id,
      active_connection.id,
      active_connection.discord_user_id,
      public.creator_discord_desired_role_keys(new.auth_user_id)
    );
  end if;

  return new;
end;
$$;

create trigger creator_accounts_queue_discord_role_sync
after update of lifecycle_status on public.creator_accounts
for each row execute function public.creator_queue_discord_role_sync_after_lifecycle_change();

create or replace function public.create_discord_oauth_attempt(
  state_hash text,
  return_path text,
  expires_at timestamptz
)
returns table (attempt_id uuid, attempt_expires_at timestamptz)
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  current_account_id uuid := auth.uid();
  created_attempt_id uuid;
begin
  if current_account_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  if $1 !~ '^[a-f0-9]{64}$' then
    raise exception 'OAuth state hash must be a lowercase SHA-256 digest.' using errcode = '22023';
  end if;

  if char_length($2) not between 1 and 512
    or left($2, 1) <> '/'
    or left($2, 2) = '//'
    or position(E'\\' in $2) > 0
    or $2 ~ '[[:cntrl:]]'
  then
    raise exception 'OAuth return path must be a safe local path.' using errcode = '22023';
  end if;

  if $3 <= now() + interval '30 seconds'
    or $3 > now() + interval '30 minutes'
  then
    raise exception 'OAuth attempt expiry must be between 30 seconds and 30 minutes.'
      using errcode = '22023';
  end if;

  -- Starting again replaces any prior unconsumed state for this account. The
  -- partial unique index also closes the concurrent double-start race.
  delete from public.discord_oauth_attempts oauth_attempt
  where oauth_attempt.account_id = current_account_id
    and oauth_attempt.consumed_at is null;

  insert into public.discord_oauth_attempts (
    account_id,
    state_hash,
    return_path,
    expires_at
  ) values (
    current_account_id,
    $1,
    $2,
    $3
  )
  returning id into created_attempt_id;

  return query select created_attempt_id, $3;
end;
$$;

create or replace function public.consume_discord_oauth_attempt(hash text)
returns table (account_id uuid, return_path text)
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
begin
  perform public.creator_require_service_role();

  if $1 !~ '^[a-f0-9]{64}$' then
    return;
  end if;

  return query
  with consumed_attempt as (
    update public.discord_oauth_attempts as oauth_attempt
    set consumed_at = now()
    where oauth_attempt.state_hash = $1
      and oauth_attempt.consumed_at is null
      and oauth_attempt.expires_at > now()
    returning oauth_attempt.account_id, oauth_attempt.return_path
  )
  select consumed_attempt.account_id, consumed_attempt.return_path
  from consumed_attempt;
end;
$$;

create or replace function public.set_creator_discord_preferences(preference_input jsonb)
returns table (
  discord_opt_in boolean,
  timezone text,
  quiet_hours_enabled boolean,
  quiet_start time without time zone,
  quiet_end time without time zone,
  topics jsonb,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  current_account_id uuid := auth.uid();
  existing_preferences public.creator_discord_preferences%rowtype;
  requested_opt_in boolean;
  requested_timezone text;
  requested_quiet_enabled boolean;
  requested_quiet_start time without time zone;
  requested_quiet_end time without time zone;
  requested_topics jsonb;
  topic_record record;
begin
  if current_account_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  if jsonb_typeof(preference_input) <> 'object'
    or pg_column_size(preference_input) > 8192
  then
    raise exception 'Discord preferences must be a small JSON object.' using errcode = '22023';
  end if;

  insert into public.creator_discord_preferences (account_id)
  values (current_account_id)
  on conflict (account_id) do nothing;

  select * into existing_preferences
  from public.creator_discord_preferences
  where account_id = current_account_id
  for update;

  if preference_input ? 'discord_opt_in'
    and jsonb_typeof(preference_input->'discord_opt_in') <> 'boolean'
  then
    raise exception 'discord_opt_in must be a boolean.' using errcode = '22023';
  end if;

  if preference_input ? 'quiet_hours_enabled'
    and jsonb_typeof(preference_input->'quiet_hours_enabled') <> 'boolean'
  then
    raise exception 'quiet_hours_enabled must be a boolean.' using errcode = '22023';
  end if;

  requested_opt_in := case
    when preference_input ? 'discord_opt_in'
      then (preference_input->>'discord_opt_in')::boolean
    else existing_preferences.discord_opt_in
  end;
  requested_quiet_enabled := case
    when preference_input ? 'quiet_hours_enabled'
      then (preference_input->>'quiet_hours_enabled')::boolean
    else existing_preferences.quiet_hours_enabled
  end;
  requested_timezone := case
    when preference_input ? 'timezone'
      then btrim(coalesce(preference_input->>'timezone', ''))
    else existing_preferences.timezone
  end;

  if not exists (
    select 1 from pg_timezone_names where name = requested_timezone
  ) then
    raise exception 'Choose a valid IANA timezone.' using errcode = '22023';
  end if;

  begin
    requested_quiet_start := case
      when preference_input ? 'quiet_start'
        then (preference_input->>'quiet_start')::time without time zone
      else existing_preferences.quiet_start
    end;
    requested_quiet_end := case
      when preference_input ? 'quiet_end'
        then (preference_input->>'quiet_end')::time without time zone
      else existing_preferences.quiet_end
    end;
  exception when invalid_datetime_format then
    raise exception 'Quiet hours must use HH:MM time values.' using errcode = '22023';
  end;

  requested_topics := preference_input->'topics';
  if requested_topics is not null
    and jsonb_typeof(requested_topics) not in ('array', 'object')
  then
    raise exception 'topics must be an array or topic-to-boolean object.' using errcode = '22023';
  end if;

  insert into public.creator_discord_subscriptions (account_id, topic, enabled)
  select current_account_id, topic_name, topic_name not in ('posting', 'performance')
  from unnest(array['account', 'onboarding', 'posting', 'performance', 'payments']::text[]) topic_name
  on conflict (account_id, topic) do nothing;

  if jsonb_typeof(requested_topics) = 'array' then
    if exists (
      select 1
      from jsonb_array_elements(requested_topics) topic_value
      where jsonb_typeof(topic_value) <> 'string'
        or trim(both '"' from topic_value::text) not in (
          'account', 'onboarding', 'posting', 'performance', 'payments'
        )
    ) then
      raise exception 'Unsupported Discord notification topic.' using errcode = '22023';
    end if;

    update public.creator_discord_subscriptions as subscription
    set enabled = requested_topics ? subscription.topic
    where subscription.account_id = current_account_id;
  elsif jsonb_typeof(requested_topics) = 'object' then
    for topic_record in select key, value from jsonb_each(requested_topics)
    loop
      if topic_record.key not in ('account', 'onboarding', 'posting', 'performance', 'payments')
        or jsonb_typeof(topic_record.value) <> 'boolean'
      then
        raise exception 'Unsupported Discord notification topic.' using errcode = '22023';
      end if;

      update public.creator_discord_subscriptions
      set enabled = (topic_record.value #>> '{}')::boolean
      where account_id = current_account_id
        and topic = topic_record.key;
    end loop;
  end if;

  -- Posting/performance reminders stay fail-closed until canonical in-house
  -- tracking events and reviewed templates are launched. Client payloads cannot
  -- opt into these dormant categories early.
  update public.creator_discord_subscriptions
  set enabled = false
  where account_id = current_account_id
    and topic in ('posting', 'performance')
    and enabled;

  update public.creator_discord_preferences
  set discord_opt_in = requested_opt_in,
      discord_opted_in_at = case
        when requested_opt_in and not existing_preferences.discord_opt_in then now()
        when requested_opt_in then existing_preferences.discord_opted_in_at
        else null
      end,
      timezone = requested_timezone,
      quiet_hours_enabled = requested_quiet_enabled,
      quiet_start = requested_quiet_start,
      quiet_end = requested_quiet_end
  where account_id = current_account_id;

  if requested_opt_in then
    update public.creator_notification_deliveries as delivery
    set state = 'scheduled',
        available_at = greatest(delivery.available_at, now()),
        blocked_reason = null,
        last_error_code = null
    from public.creator_notifications as notification,
         public.creator_discord_preferences as preferences
    where delivery.notification_id = notification.id
      and notification.account_id = current_account_id
      and preferences.account_id = current_account_id
      and preferences.discord_opt_in
      and preferences.discord_opted_in_at is not null
      and delivery.state = 'blocked'
      and delivery.blocked_reason in (
        'discord_opt_out', 'predates_discord_opt_in', 'topic_disabled'
      )
      and (
        notification.notification_type <> 'creator_test'
        or notification.template_key <> 'creator.test'
      )
      and notification.source_occurred_at >= preferences.discord_opted_in_at
      and notification.scheduled_for >= preferences.discord_opted_in_at
      and notification.cancelled_at is null
      and notification.expires_at > now();
  else
    update public.creator_notification_deliveries as delivery
    set state = case
          when notification.notification_type = 'creator_test'
            and notification.template_key = 'creator.test' then 'cancelled'
          else 'blocked'
        end,
        recovery_required = delivery.recovery_required or delivery.state = 'sending',
        available_at = now(),
        lease_token = null,
        leased_by = null,
        leased_at = null,
        lease_expires_at = null,
        blocked_reason = case
          when notification.notification_type = 'creator_test'
            and notification.template_key = 'creator.test'
            then 'creator_test_opted_out'
          else 'discord_opt_out'
        end,
        last_error_code = null
    from public.creator_notifications as notification
    where delivery.notification_id = notification.id
      and notification.account_id = current_account_id
      and delivery.state in (
        'scheduled', 'leased', 'sending', 'retry', 'blocked', 'delivery_unknown'
      );
  end if;

  return query
  select
    preferences.discord_opt_in,
    preferences.timezone,
    preferences.quiet_hours_enabled,
    preferences.quiet_start,
    preferences.quiet_end,
    (
      select coalesce(jsonb_object_agg(subscription.topic, subscription.enabled order by subscription.topic), '{}'::jsonb)
      from public.creator_discord_subscriptions subscription
      where subscription.account_id = current_account_id
    ),
    preferences.updated_at
  from public.creator_discord_preferences preferences
  where preferences.account_id = current_account_id;
end;
$$;

create or replace function public.upsert_creator_discord_connection(
  account_id uuid,
  identity jsonb,
  membership_status text
)
returns table (
  connection_id uuid,
  linked_account_id uuid,
  discord_user_id text,
  username text,
  global_name text,
  avatar_hash text,
  guild_id text,
  membership_state text,
  dm_channel_id text,
  connected_at timestamptz,
  last_verified_at timestamptz
)
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  discord_id text := btrim(coalesce($2->>'id', ''));
  discord_username text := btrim(coalesce($2->>'username', ''));
  discord_global_name text := nullif(btrim(coalesce($2->>'global_name', '')), '');
  discord_discriminator text := nullif(btrim(coalesce($2->>'discriminator', '')), '');
  discord_avatar_hash text := nullif(btrim(coalesce($2->>'avatar', '')), '');
  target_guild_id text := btrim(coalesce($2->>'guild_id', ''));
  supplied_dm_channel_id text := nullif(btrim(coalesce($2->>'dm_channel_id', '')), '');
  existing_connection public.creator_discord_connections%rowtype;
  prior_connection public.creator_discord_connections%rowtype;
  conflicting_account_id uuid;
  desired_roles text[];
begin
  perform public.creator_require_service_role();

  if not exists (select 1 from public.creator_accounts where auth_user_id = $1) then
    raise exception 'Creator account was not found.' using errcode = '22023';
  end if;

  if jsonb_typeof($2) <> 'object' or pg_column_size($2) > 8192 then
    raise exception 'Discord identity must be a small JSON object.' using errcode = '22023';
  end if;

  if not public.creator_valid_discord_snowflake(discord_id)
    or not public.creator_valid_discord_snowflake(target_guild_id)
  then
    raise exception 'Discord user and guild IDs must be snowflakes.' using errcode = '22023';
  end if;

  if char_length(discord_username) not between 1 and 32
    or (discord_global_name is not null and char_length(discord_global_name) not between 1 and 32)
    or (discord_discriminator is not null and discord_discriminator !~ '^[0-9]{1,4}$')
    or (discord_avatar_hash is not null and char_length(discord_avatar_hash) > 128)
    or (supplied_dm_channel_id is not null and not public.creator_valid_discord_snowflake(supplied_dm_channel_id))
  then
    raise exception 'Discord identity fields are invalid.' using errcode = '22023';
  end if;

  if $3 not in ('member', 'not_member', 'unknown') then
    raise exception 'Unsupported Discord membership status.' using errcode = '22023';
  end if;

  -- Serialize both sides of the one-active-link invariant before touching the
  -- partial unique indexes. A Discord identity is never silently transferred.
  perform pg_advisory_xact_lock(hashtextextended($1::text, 104729));
  perform pg_advisory_xact_lock(hashtextextended(discord_id, 104729));

  select connection.account_id into conflicting_account_id
  from public.creator_discord_connections connection
  where connection.discord_user_id = discord_id
    and connection.disconnected_at is null
    and connection.account_id <> $1
  for update;

  if conflicting_account_id is not null then
    raise exception 'That Discord account is already connected to another creator account.'
      using errcode = '23505';
  end if;

  select connection.* into prior_connection
  from public.creator_discord_connections connection
  where connection.account_id = $1
    and connection.disconnected_at is null
  for update;

  if prior_connection.id is not null and prior_connection.discord_user_id <> discord_id then
    update public.creator_discord_connections
    set membership_status = 'disconnected',
        disconnected_at = now()
    where id = prior_connection.id;

    perform public.creator_enqueue_discord_role_sync_job(
      $1,
      prior_connection.id,
      prior_connection.discord_user_id,
      '{}'::text[]
    );
  end if;

  select connection.* into existing_connection
  from public.creator_discord_connections connection
  where connection.account_id = $1
    and connection.discord_user_id = discord_id
    and connection.disconnected_at is null
  for update;

  if existing_connection.id is null then
    insert into public.creator_discord_connections (
      account_id,
      discord_user_id,
      username,
      global_name,
      discriminator,
      avatar_hash,
      guild_id,
      membership_status,
      dm_channel_id
    ) values (
      $1,
      discord_id,
      discord_username,
      discord_global_name,
      discord_discriminator,
      discord_avatar_hash,
      target_guild_id,
      $3,
      supplied_dm_channel_id
    )
    returning * into existing_connection;
  else
    update public.creator_discord_connections
    set username = discord_username,
        global_name = discord_global_name,
        discriminator = discord_discriminator,
        avatar_hash = discord_avatar_hash,
        guild_id = target_guild_id,
        membership_status = $3,
        dm_channel_id = coalesce(
          supplied_dm_channel_id,
          creator_discord_connections.dm_channel_id
        ),
        last_verified_at = now(),
        membership_checked_at = now()
    where id = existing_connection.id
    returning * into existing_connection;
  end if;

  insert into public.creator_discord_preferences (account_id)
  values ($1)
  on conflict on constraint creator_discord_preferences_pkey do nothing;

  insert into public.creator_discord_subscriptions (account_id, topic, enabled)
  select $1, topic_name, topic_name not in ('posting', 'performance')
  from unnest(array['account', 'onboarding', 'posting', 'performance', 'payments']::text[]) topic_name
  on conflict on constraint creator_discord_subscriptions_pkey do nothing;

  desired_roles := case
    when $3 = 'member' then public.creator_discord_desired_role_keys($1)
    else '{}'::text[]
  end;

  perform public.creator_enqueue_discord_role_sync_job(
    $1,
    existing_connection.id,
    discord_id,
    desired_roles
  );

  if $3 = 'member' then
    update public.creator_notification_deliveries as delivery
    set state = 'scheduled',
        available_at = greatest(delivery.available_at, now()),
        blocked_reason = null,
        last_error_code = null
    from public.creator_notifications as notification
    join public.creator_discord_preferences preferences
      on preferences.account_id = notification.account_id
     and preferences.discord_opt_in
     and preferences.discord_opted_in_at is not null
    join public.creator_discord_subscriptions subscription
      on subscription.account_id = notification.account_id
     and subscription.topic = notification.topic
     and subscription.enabled
    where delivery.notification_id = notification.id
      and notification.account_id = $1
      and delivery.state = 'blocked'
      and delivery.blocked_reason in (
        'discord_not_connected', 'discord_connection_changed', 'not_guild_member'
      )
      and (
        notification.notification_type <> 'creator_test'
        or notification.template_key <> 'creator.test'
      )
      and notification.source_occurred_at >= preferences.discord_opted_in_at
      and notification.scheduled_for >= preferences.discord_opted_in_at
      and notification.cancelled_at is null
      and notification.expires_at > now();
  end if;

  return query select
    existing_connection.id,
    existing_connection.account_id,
    existing_connection.discord_user_id,
    existing_connection.username,
    existing_connection.global_name,
    existing_connection.avatar_hash,
    existing_connection.guild_id,
    existing_connection.membership_status,
    existing_connection.dm_channel_id,
    existing_connection.connected_at,
    existing_connection.last_verified_at;
end;
$$;

create or replace function public.disconnect_creator_discord()
returns table (disconnected boolean, discord_user_id text)
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  current_account_id uuid := auth.uid();
  active_connection public.creator_discord_connections%rowtype;
begin
  if current_account_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(current_account_id::text, 104729));

  select connection.* into active_connection
  from public.creator_discord_connections connection
  where connection.account_id = current_account_id
    and connection.disconnected_at is null
  for update;

  update public.creator_discord_preferences
  set discord_opt_in = false,
      discord_opted_in_at = null
  where account_id = current_account_id;

  if active_connection.id is null then
    return query select false, null::text;
    return;
  end if;

  update public.creator_discord_connections
  set membership_status = 'disconnected',
      disconnected_at = now()
  where id = active_connection.id;

  update public.creator_notification_deliveries as delivery
  set state = 'cancelled',
      available_at = now(),
      lease_token = null,
      leased_by = null,
      leased_at = null,
      lease_expires_at = null,
      blocked_reason = 'discord_disconnected'
  from public.creator_notifications as notification
  where delivery.notification_id = notification.id
    and notification.account_id = current_account_id
    and delivery.state in ('scheduled', 'leased', 'retry', 'blocked', 'delivery_unknown');

  perform public.creator_enqueue_discord_role_sync_job(
    current_account_id,
    active_connection.id,
    active_connection.discord_user_id,
    '{}'::text[]
  );

  return query select true, active_connection.discord_user_id;
end;
$$;

create or replace function public.creator_mark_discord_connection_not_member(
  target_connection_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_account_id uuid;
  target_discord_user_id text;
begin
  select connection.account_id, connection.discord_user_id
  into target_account_id, target_discord_user_id
  from public.creator_discord_connections connection
  where connection.id = target_connection_id
    and connection.disconnected_at is null
  for update;

  if target_account_id is null then
    return null;
  end if;

  update public.creator_discord_connections
  set membership_status = 'not_member',
      membership_checked_at = now()
  where id = target_connection_id;

  update public.creator_notification_deliveries as delivery
  set state = case
        when notification.notification_type = 'creator_test'
          and notification.template_key = 'creator.test' then 'cancelled'
        else 'blocked'
      end,
      recovery_required = delivery.recovery_required or delivery.state = 'sending',
      available_at = now(),
      lease_token = null,
      leased_by = null,
      leased_at = null,
      lease_expires_at = null,
      blocked_reason = case
        when notification.notification_type = 'creator_test'
          and notification.template_key = 'creator.test'
          then 'creator_test_membership_lost'
        else 'not_guild_member'
      end,
      last_error_code = 'not_guild_member'
  from public.creator_notifications notification
  where delivery.notification_id = notification.id
    and notification.account_id = target_account_id
    and delivery.state in (
      'scheduled', 'leased', 'sending', 'retry', 'blocked', 'delivery_unknown'
    );

  update public.creator_discord_role_sync_jobs
  set state = 'cancelled',
      lease_token = null,
      leased_by = null,
      leased_at = null,
      lease_expires_at = null,
      last_error_code = 'not_guild_member'
  where discord_user_id = target_discord_user_id
    and state in ('scheduled', 'retry');

  return target_account_id;
end;
$$;

create or replace function public.enqueue_creator_notification(notification_input jsonb)
returns table (
  notification_id uuid,
  delivery_id uuid,
  notification_created boolean,
  delivery_state text
)
language plpgsql
security definer
set search_path = pg_catalog, extensions, public, auth, pg_temp
as $$
declare
  target_account_id uuid;
  submitted_event_key text;
  submitted_topic text;
  submitted_notification_type text;
  submitted_title text;
  submitted_action_path text;
  submitted_template_key text;
  submitted_template_version integer;
  submitted_variables jsonb;
  submitted_source_occurred_at timestamptz;
  submitted_scheduled_for timestamptz;
  submitted_expires_at timestamptz;
  normalized_payload jsonb;
  submitted_payload_sha256 text;
  existing_payload_sha256 text;
  existing_source_occurred_at timestamptz;
  existing_scheduled_for timestamptz;
  existing_expires_at timestamptz;
  created_notification_id uuid;
  created_delivery_id uuid;
  created_row_count integer;
  was_created boolean := false;
begin
  perform public.creator_require_service_role();

  if jsonb_typeof(notification_input) <> 'object'
    or pg_column_size(notification_input) > 32768
  then
    raise exception 'Notification input must be a small JSON object.' using errcode = '22023';
  end if;

  begin
    target_account_id := (notification_input->>'account_id')::uuid;
    submitted_template_version := coalesce((notification_input->>'template_version')::integer, 1);
    submitted_scheduled_for := coalesce(
      nullif(notification_input->>'scheduled_for', '')::timestamptz,
      now()
    );
    submitted_source_occurred_at := coalesce(
      nullif(notification_input->>'source_occurred_at', '')::timestamptz,
      submitted_scheduled_for
    );
    submitted_expires_at := coalesce(
      nullif(notification_input->>'expires_at', '')::timestamptz,
      submitted_scheduled_for + interval '7 days'
    );
  exception
    when invalid_text_representation or datetime_field_overflow then
      raise exception 'Notification identifiers, version, or timestamps are invalid.'
        using errcode = '22023';
  end;

  submitted_event_key := btrim(coalesce(notification_input->>'event_key', ''));
  submitted_topic := btrim(coalesce(notification_input->>'topic', ''));
  submitted_notification_type := btrim(coalesce(notification_input->>'notification_type', ''));
  submitted_title := btrim(coalesce(notification_input->>'title', ''));
  submitted_action_path := nullif(btrim(coalesce(notification_input->>'action_path', '')), '');
  submitted_template_key := btrim(coalesce(notification_input->>'template_key', ''));
  submitted_variables := coalesce(notification_input->'variables', '{}'::jsonb);

  -- The first accepted occurrence fixes all scheduling timestamps for a logical
  -- event. Canonical source rows can be touched later (for example reviewed_at
  -- can be corrected) without turning every scheduler tick into a payload-hash
  -- conflict or moving an already-published reminder window.
  select existing_notification.source_occurred_at,
         existing_notification.scheduled_for,
         existing_notification.expires_at
  into existing_source_occurred_at, existing_scheduled_for, existing_expires_at
  from public.creator_notifications existing_notification
  where existing_notification.account_id = target_account_id
    and existing_notification.event_key = submitted_event_key;

  if found then
    submitted_source_occurred_at := existing_source_occurred_at;
    submitted_scheduled_for := existing_scheduled_for;
    submitted_expires_at := existing_expires_at;
  end if;

  if target_account_id is null
    or not exists (select 1 from public.creator_accounts where auth_user_id = target_account_id)
  then
    raise exception 'Creator account was not found.' using errcode = '22023';
  end if;

  if char_length(submitted_event_key) not between 1 and 160
    or submitted_event_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
  then
    raise exception 'event_key is invalid.' using errcode = '22023';
  end if;

  if submitted_topic not in ('account', 'onboarding', 'posting', 'performance', 'payments') then
    raise exception 'Unsupported notification topic.' using errcode = '22023';
  end if;

  if char_length(submitted_notification_type) not between 1 and 80
    or submitted_notification_type !~ '^[a-z][a-z0-9._-]*$'
    or char_length(submitted_title) not between 1 and 140
    or char_length(submitted_template_key) not between 1 and 80
    or submitted_template_key !~ '^[a-z][a-z0-9._-]*$'
    or submitted_template_version not between 1 and 10000
  then
    raise exception 'Notification type, title, or template is invalid.' using errcode = '22023';
  end if;

  if submitted_action_path is not null and (
    char_length(submitted_action_path) not between 1 and 512
    or left(submitted_action_path, 1) <> '/'
    or left(submitted_action_path, 2) = '//'
    or position(E'\\' in submitted_action_path) > 0
    or submitted_action_path ~ '[[:cntrl:]]'
  ) then
    raise exception 'Notification action_path must be a safe local path.' using errcode = '22023';
  end if;

  if jsonb_typeof(submitted_variables) <> 'object'
    or pg_column_size(submitted_variables) > 16384
  then
    raise exception 'Notification variables must be a small JSON object.' using errcode = '22023';
  end if;

  if (submitted_notification_type = 'creator_test') <>
      (submitted_template_key = 'creator.test')
    or (
      submitted_notification_type = 'creator_test'
      and (submitted_topic <> 'account' or submitted_template_version <> 1)
    )
  then
    raise exception 'Creator test notifications must use only creator.test version 1 on account.'
      using errcode = '22023';
  end if;

  if submitted_notification_type = 'creator_test' then
    if not exists (
      select 1
      from public.creator_discord_preferences preferences
      join public.creator_discord_subscriptions subscription
        on subscription.account_id = preferences.account_id
       and subscription.topic = 'account'
       and subscription.enabled
      join public.creator_discord_connections connection
        on connection.account_id = preferences.account_id
       and connection.disconnected_at is null
       and connection.membership_status = 'member'
      where preferences.account_id = target_account_id
        and preferences.discord_opt_in
    ) then
      raise exception 'Connect Discord, join the creator server, and enable account reminders first.'
        using errcode = '42501';
    end if;
  end if;

  if submitted_expires_at <= submitted_scheduled_for
    or submitted_expires_at > submitted_scheduled_for + interval '90 days'
  then
    raise exception 'Notification expiry must follow its schedule by no more than 90 days.'
      using errcode = '22023';
  end if;

  normalized_payload := jsonb_build_object(
    'account_id', target_account_id,
    'event_key', submitted_event_key,
    'topic', submitted_topic,
    'notification_type', submitted_notification_type,
    'title', submitted_title,
    'action_path', submitted_action_path,
    'template_key', submitted_template_key,
    'template_version', submitted_template_version,
    'variables', submitted_variables,
    'source_occurred_at', submitted_source_occurred_at,
    'scheduled_for', submitted_scheduled_for,
    'expires_at', submitted_expires_at
  );
  submitted_payload_sha256 := encode(
    digest(convert_to(normalized_payload::text, 'UTF8'), 'sha256'),
    'hex'
  );

  insert into public.creator_notifications (
    account_id,
    event_key,
    topic,
    notification_type,
    title,
    action_path,
    template_key,
    template_version,
    variables,
    payload_sha256,
    source_occurred_at,
    scheduled_for,
    expires_at
  ) values (
    target_account_id,
    submitted_event_key,
    submitted_topic,
    submitted_notification_type,
    submitted_title,
    submitted_action_path,
    submitted_template_key,
    submitted_template_version,
    submitted_variables,
    submitted_payload_sha256,
    submitted_source_occurred_at,
    submitted_scheduled_for,
    submitted_expires_at
  )
  on conflict (account_id, event_key) do nothing
  returning id into created_notification_id;

  get diagnostics created_row_count = row_count;
  was_created := created_row_count = 1;

  if not was_created then
    select existing_notification.id, existing_notification.payload_sha256
    into created_notification_id, existing_payload_sha256
    from public.creator_notifications existing_notification
    where existing_notification.account_id = target_account_id
      and existing_notification.event_key = submitted_event_key
    for update;

    if existing_payload_sha256 <> submitted_payload_sha256 then
      raise exception 'event_key already exists with a different notification payload.'
        using errcode = '23505';
    end if;
  end if;

  insert into public.creator_notification_deliveries (
    notification_id,
    idempotency_key,
    provider_nonce,
    available_at
  ) values (
    created_notification_id,
    target_account_id::text || ':discord:' || submitted_event_key,
    'd' || encode(gen_random_bytes(12), 'hex'),
    submitted_scheduled_for
  )
  on conflict on constraint creator_notification_deliveries_notification_id_channel_key do nothing
  returning id into created_delivery_id;

  if created_delivery_id is null then
    select delivery.id into created_delivery_id
    from public.creator_notification_deliveries delivery
    where delivery.notification_id = created_notification_id
      and delivery.channel = 'discord';
  end if;

  -- The in-app ledger is durable regardless of Discord consent. The Discord
  -- outbox is fail-closed: an automated event must occur and be scheduled no
  -- earlier than the creator's current false->true opt-in watermark.
  update public.creator_notification_deliveries delivery
  set state = 'blocked',
      blocked_reason = case
        when not exists (
          select 1
          from public.creator_discord_preferences preferences
          where preferences.account_id = target_account_id
            and preferences.discord_opt_in
            and preferences.discord_opted_in_at is not null
        ) then 'discord_opt_out'
        else 'predates_discord_opt_in'
      end
  where delivery.id = created_delivery_id
    and delivery.state in ('scheduled', 'retry', 'delivery_unknown')
    and (
      submitted_notification_type <> 'creator_test'
      or submitted_template_key <> 'creator.test'
    )
    and (
      not exists (
        select 1
        from public.creator_discord_preferences preferences
        where preferences.account_id = target_account_id
          and preferences.discord_opt_in
          and preferences.discord_opted_in_at is not null
      )
      or exists (
        select 1
        from public.creator_discord_preferences preferences
        where preferences.account_id = target_account_id
          and preferences.discord_opt_in
          and preferences.discord_opted_in_at is not null
          and (
            submitted_source_occurred_at < preferences.discord_opted_in_at
            or submitted_scheduled_for < preferences.discord_opted_in_at
          )
      )
    );

  return query
  select
    created_notification_id,
    created_delivery_id,
    was_created,
    delivery.state
  from public.creator_notification_deliveries delivery
  where delivery.id = created_delivery_id;
end;
$$;

create or replace function public.enqueue_creator_discord_test(target_account_id uuid)
returns table (
  notification_id uuid,
  delivery_id uuid,
  notification_created boolean,
  delivery_state text
)
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  hour_start timestamptz := date_trunc('hour', now());
  enqueue_result record;
begin
  perform public.creator_require_service_role();

  -- The delegated enqueue runs in this transaction and owns the authoritative
  -- active-member, global-opt-in, and account-topic prerequisite checks for
  -- every creator_test notification, including calls to the generic RPC.
  select * into enqueue_result
  from public.enqueue_creator_notification(jsonb_build_object(
    'account_id', $1,
    'event_key', 'creator-discord-test:' || $1::text || ':' ||
      to_char(timezone('UTC', hour_start), 'YYYY-MM-DD"T"HH24'),
    'topic', 'account',
    'notification_type', 'creator_test',
    'title', 'Discord reminder test',
    'action_path', '/account/discord',
    'template_key', 'creator.test',
    'template_version', 1,
    'variables', '{}'::jsonb,
    'scheduled_for', hour_start,
    'expires_at', hour_start + interval '2 hours'
  ));

  -- Preference/link recovery never resurrects an old test. A new explicit
  -- click may re-arm the same once-per-hour row only when no provider attempt
  -- ever began and every current prerequisite was revalidated above.
  if enqueue_result.delivery_state = 'cancelled' then
    update public.creator_notification_deliveries delivery
    set state = 'scheduled',
        available_at = now(),
        blocked_reason = null,
        last_error_code = null
    from public.creator_notifications notification
    where delivery.id = enqueue_result.delivery_id
      and delivery.notification_id = notification.id
      and delivery.state = 'cancelled'
      and delivery.attempt_count = 0
      and not delivery.recovery_required
      and delivery.blocked_reason in (
        'creator_test_opted_out',
        'creator_test_membership_lost',
        'creator_test_connectivity_lost',
        'discord_disconnected'
      )
      and notification.notification_type = 'creator_test'
      and notification.template_key = 'creator.test'
      and notification.cancelled_at is null
      and notification.expires_at > now();

    if found then
      enqueue_result.delivery_state := 'scheduled';
    end if;
  end if;

  return query select
    enqueue_result.notification_id,
    enqueue_result.delivery_id,
    enqueue_result.notification_created,
    enqueue_result.delivery_state;
end;
$$;

create or replace function public.claim_creator_notification_deliveries(
  worker_id text,
  max_messages integer,
  lease_seconds integer
)
returns table (
  delivery_id uuid,
  lease_token uuid,
  attempt_number integer,
  requires_recovery boolean,
  discord_user_id text,
  dm_channel_id text,
  template_key text,
  template_version integer,
  variables jsonb,
  provider_nonce text,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
begin
  perform public.creator_require_service_role();

  if $1 !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$'
    or $2 not between 1 and 100
    or $3 not between 15 and 300
  then
    raise exception 'Invalid notification lease request.' using errcode = '22023';
  end if;

  -- A crash before begin is safely retryable. A crash after begin becomes an
  -- evidence-only recovery lease; the worker must never issue a blind resend.
  update public.creator_notification_deliveries
  set state = case when state = 'sending' then 'delivery_unknown' else 'retry' end,
      recovery_required = recovery_required or state = 'sending',
      available_at = now(),
      lease_token = null,
      leased_by = null,
      leased_at = null,
      lease_expires_at = null,
      last_error_code = 'lease_expired'
  where state in ('leased', 'sending')
    and lease_expires_at <= now();

  -- Defensive repair for rows written by an older function version. Once an
  -- outcome is ambiguous, leases and begin-time policy checks cannot erase it.
  update public.creator_notification_deliveries
  set recovery_required = true
  where state = 'delivery_unknown'
    and not recovery_required;

  update public.creator_notification_deliveries as delivery
  set state = 'cancelled',
      available_at = now(),
      lease_token = null,
      leased_by = null,
      leased_at = null,
      lease_expires_at = null,
      blocked_reason = 'notification_expired'
  from public.creator_notifications notification
  where delivery.notification_id = notification.id
    and delivery.state in ('scheduled', 'retry', 'blocked', 'delivery_unknown')
    and (notification.cancelled_at is not null or notification.expires_at <= now());

  return query
  with claim_candidates as (
    select
      delivery.id,
      delivery.recovery_required,
      connection.id as connection_id,
      connection.discord_user_id,
      connection.dm_channel_id
    from public.creator_notification_deliveries delivery
    join public.creator_notifications notification
      on notification.id = delivery.notification_id
    left join lateral (
      select discord_connection.id,
             discord_connection.discord_user_id,
             discord_connection.dm_channel_id
      from public.creator_discord_connections discord_connection
      where discord_connection.account_id = notification.account_id
        and discord_connection.disconnected_at is null
        and discord_connection.membership_status = 'member'
      limit 1
    ) connection on true
    where delivery.state in ('scheduled', 'retry', 'delivery_unknown')
      and delivery.available_at <= now()
      and notification.scheduled_for <= now()
      and notification.cancelled_at is null
      and notification.expires_at > now()
    order by delivery.available_at, delivery.created_at, delivery.id
    for update of delivery skip locked
    limit $2
  ), claimed as (
    update public.creator_notification_deliveries delivery
    set state = 'leased',
        lease_token = gen_random_uuid(),
        leased_by = $1,
        leased_at = now(),
        lease_expires_at = now() + make_interval(secs => $3),
        -- Recovery is evidence reconciliation for the original ambiguous POST.
        -- Never retarget it to a creator's newer Discord identity.
        target_connection_id = case
          when claim_candidates.recovery_required then delivery.target_connection_id
          else claim_candidates.connection_id
        end,
        target_discord_user_id = case
          when claim_candidates.recovery_required then delivery.target_discord_user_id
          else claim_candidates.discord_user_id
        end,
        target_dm_channel_id = case
          when claim_candidates.recovery_required then delivery.target_dm_channel_id
          else claim_candidates.dm_channel_id
        end,
        blocked_reason = null
    from claim_candidates
    where delivery.id = claim_candidates.id
    returning delivery.id,
              delivery.notification_id,
              delivery.lease_token,
              delivery.attempt_count + 1 as prospective_attempt_number,
              claim_candidates.recovery_required as requires_recovery,
              delivery.target_discord_user_id,
              delivery.target_dm_channel_id,
              delivery.provider_nonce
  )
  select
    claimed.id,
    claimed.lease_token,
    claimed.prospective_attempt_number,
    claimed.requires_recovery,
    claimed.target_discord_user_id,
    claimed.target_dm_channel_id,
    notification.template_key,
    notification.template_version,
    notification.variables,
    claimed.provider_nonce,
    notification.expires_at
  from claimed
  join public.creator_notifications notification
    on notification.id = claimed.notification_id
  order by notification.scheduled_for, claimed.id;
end;
$$;

create or replace function public.begin_creator_notification_delivery(
  delivery_id uuid,
  lease_token uuid
)
returns table (ready boolean, state text, reason text)
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  delivery_context record;
  local_now timestamp without time zone;
  quiet_end_local timestamp without time zone;
  resume_at timestamptz;
  local_day_start timestamptz;
  local_day_end timestamptz;
  last_automated_sent_at timestamptz;
  automated_sent_today integer;
  cadence_resume_at timestamptz;
  target_account_for_lock uuid;
begin
  perform public.creator_require_service_role();

  select notification.account_id
  into target_account_for_lock
  from public.creator_notification_deliveries delivery
  join public.creator_notifications notification
    on notification.id = delivery.notification_id
  where delivery.id = $1;

  if target_account_for_lock is not null then
    perform pg_advisory_xact_lock(hashtextextended(target_account_for_lock::text, 104729));
  end if;

  select
    delivery.*,
    notification.account_id,
    notification.topic,
    notification.notification_type,
    notification.template_key,
    notification.source_occurred_at as notification_source_occurred_at,
    notification.scheduled_for as notification_scheduled_for,
    notification.expires_at as notification_expires_at,
    notification.cancelled_at as notification_cancelled_at,
    preferences.discord_opt_in,
    preferences.discord_opted_in_at,
    preferences.timezone as creator_timezone,
    preferences.quiet_hours_enabled,
    preferences.quiet_start,
    preferences.quiet_end,
    subscription.enabled as topic_enabled,
    connection.id as current_connection_id,
    connection.discord_user_id as current_discord_user_id
  into delivery_context
  from public.creator_notification_deliveries delivery
  join public.creator_notifications notification
    on notification.id = delivery.notification_id
  left join public.creator_discord_preferences preferences
    on preferences.account_id = notification.account_id
  left join public.creator_discord_subscriptions subscription
    on subscription.account_id = notification.account_id
   and subscription.topic = notification.topic
  left join public.creator_discord_connections connection
    on connection.account_id = notification.account_id
   and connection.disconnected_at is null
   and connection.membership_status = 'member'
  where delivery.id = $1
  for update of delivery;

  if not found then
    return query select false, 'dead'::text, 'delivery_not_found'::text;
    return;
  end if;

  if delivery_context.state <> 'leased'
    or delivery_context.lease_token is distinct from $2
  then
    return query select false, delivery_context.state, 'lease_not_current'::text;
    return;
  end if;

  if delivery_context.lease_expires_at <= now() then
    update public.creator_notification_deliveries
    set state = 'retry',
        available_at = now(),
        lease_token = null,
        leased_by = null,
        leased_at = null,
        lease_expires_at = null,
        last_error_code = 'lease_expired_before_begin'
    where id = $1;

    return query select false, 'retry'::text, 'lease_expired_before_begin'::text;
    return;
  end if;

  if delivery_context.notification_cancelled_at is not null
    or delivery_context.notification_expires_at <= now()
  then
    update public.creator_notification_deliveries
    set state = 'cancelled',
        lease_token = null,
        leased_by = null,
        leased_at = null,
        lease_expires_at = null,
        blocked_reason = 'notification_expired'
    where id = $1;

    return query select false, 'cancelled'::text, 'notification_expired'::text;
    return;
  end if;

  if coalesce(delivery_context.discord_opt_in, false) is false
    or (
      (
        delivery_context.notification_type <> 'creator_test'
        or delivery_context.template_key <> 'creator.test'
      )
      and (
        delivery_context.discord_opted_in_at is null
        or delivery_context.notification_source_occurred_at < delivery_context.discord_opted_in_at
        or delivery_context.notification_scheduled_for < delivery_context.discord_opted_in_at
      )
    )
    or coalesce(delivery_context.topic_enabled, false) is false
    or (
      not delivery_context.recovery_required
      and (
        delivery_context.current_connection_id is null
        or delivery_context.target_connection_id is distinct from delivery_context.current_connection_id
        or delivery_context.target_discord_user_id is distinct from delivery_context.current_discord_user_id
      )
    )
  then
    update public.creator_notification_deliveries
    set state = case
          when delivery_context.notification_type = 'creator_test'
            and delivery_context.template_key = 'creator.test' then 'cancelled'
          else 'blocked'
        end,
        lease_token = null,
        leased_by = null,
        leased_at = null,
        lease_expires_at = null,
        blocked_reason = case
          when delivery_context.notification_type = 'creator_test'
            and delivery_context.template_key = 'creator.test'
            and coalesce(delivery_context.discord_opt_in, false) is false
            then 'creator_test_opted_out'
          when delivery_context.notification_type = 'creator_test'
            and delivery_context.template_key = 'creator.test'
            then 'creator_test_connectivity_lost'
          when coalesce(delivery_context.discord_opt_in, false) is false then 'discord_opt_out'
          when (
              delivery_context.notification_type <> 'creator_test'
              or delivery_context.template_key <> 'creator.test'
            )
            and (
              delivery_context.discord_opted_in_at is null
              or delivery_context.notification_source_occurred_at < delivery_context.discord_opted_in_at
              or delivery_context.notification_scheduled_for < delivery_context.discord_opted_in_at
            ) then 'predates_discord_opt_in'
          when coalesce(delivery_context.topic_enabled, false) is false then 'topic_disabled'
          when delivery_context.current_connection_id is null then 'discord_not_connected'
          else 'discord_connection_changed'
        end
    where id = $1;

    return query
    select false,
      case
        when delivery_context.notification_type = 'creator_test'
          and delivery_context.template_key = 'creator.test' then 'cancelled'
        else 'blocked'
      end,
      case
        when delivery_context.notification_type = 'creator_test'
          and delivery_context.template_key = 'creator.test'
          and coalesce(delivery_context.discord_opt_in, false) is false
          then 'creator_test_opted_out'
        when delivery_context.notification_type = 'creator_test'
          and delivery_context.template_key = 'creator.test'
          then 'creator_test_connectivity_lost'
        when coalesce(delivery_context.discord_opt_in, false) is false then 'discord_opt_out'
        when (
            delivery_context.notification_type <> 'creator_test'
            or delivery_context.template_key <> 'creator.test'
          )
          and (
            delivery_context.discord_opted_in_at is null
            or delivery_context.notification_source_occurred_at < delivery_context.discord_opted_in_at
            or delivery_context.notification_scheduled_for < delivery_context.discord_opted_in_at
          ) then 'predates_discord_opt_in'
        when coalesce(delivery_context.topic_enabled, false) is false then 'topic_disabled'
        when delivery_context.current_connection_id is null then 'discord_not_connected'
        else 'discord_connection_changed'
      end;
    return;
  end if;

  -- A creator-requested test is an immediate confirmation action. It keeps the
  -- same hourly idempotency and consent prerequisites but intentionally bypasses
  -- quiet hours; all automated reminders remain subject to quiet hours.
  if (
      delivery_context.notification_type <> 'creator_test'
      or delivery_context.template_key <> 'creator.test'
    )
    and delivery_context.quiet_hours_enabled
    and delivery_context.quiet_start <> delivery_context.quiet_end
  then
    local_now := timezone(delivery_context.creator_timezone, now());

    if (
      delivery_context.quiet_start < delivery_context.quiet_end
      and local_now::time >= delivery_context.quiet_start
      and local_now::time < delivery_context.quiet_end
    ) or (
      delivery_context.quiet_start > delivery_context.quiet_end
      and (
        local_now::time >= delivery_context.quiet_start
        or local_now::time < delivery_context.quiet_end
      )
    ) then
      quiet_end_local := local_now::date + delivery_context.quiet_end;
      if delivery_context.quiet_start > delivery_context.quiet_end
        and local_now::time >= delivery_context.quiet_start
      then
        quiet_end_local := quiet_end_local + interval '1 day';
      end if;
      resume_at := quiet_end_local at time zone delivery_context.creator_timezone;

      update public.creator_notification_deliveries
      set state = 'retry',
          available_at = greatest(resume_at, now() + interval '1 minute'),
          lease_token = null,
          leased_by = null,
          leased_at = null,
          lease_expires_at = null,
          blocked_reason = 'quiet_hours'
      where id = $1;

      return query select false, 'retry'::text, 'quiet_hours'::text;
      return;
    end if;
  end if;

  if (
      delivery_context.notification_type <> 'creator_test'
      or delivery_context.template_key <> 'creator.test'
    )
  then
    local_now := timezone(delivery_context.creator_timezone, now());
    local_day_start := local_now::date::timestamp
      at time zone delivery_context.creator_timezone;
    local_day_end := (local_now::date + 1)::timestamp
      at time zone delivery_context.creator_timezone;

    select count(*)::integer,
           max(coalesce(prior_delivery.sent_at, prior_delivery.leased_at, prior_delivery.updated_at))
    into automated_sent_today, last_automated_sent_at
    from public.creator_notification_deliveries prior_delivery
    join public.creator_notifications prior_notification
      on prior_notification.id = prior_delivery.notification_id
    where prior_notification.account_id = delivery_context.account_id
      and (
        prior_notification.notification_type <> 'creator_test'
        or prior_notification.template_key <> 'creator.test'
      )
      and prior_delivery.state in ('sent', 'sending', 'delivery_unknown')
      and coalesce(prior_delivery.sent_at, prior_delivery.leased_at, prior_delivery.updated_at) >= local_day_start
      and coalesce(prior_delivery.sent_at, prior_delivery.leased_at, prior_delivery.updated_at) < local_day_end;

    cadence_resume_at := null;
    if automated_sent_today >= 2 then
      cadence_resume_at := local_day_end;
    end if;
    if last_automated_sent_at is not null
      and last_automated_sent_at + interval '4 hours' > now()
    then
      cadence_resume_at := greatest(
        coalesce(cadence_resume_at, last_automated_sent_at + interval '4 hours'),
        last_automated_sent_at + interval '4 hours'
      );
    end if;

    if cadence_resume_at is not null then
      update public.creator_notification_deliveries
      set state = 'retry',
          available_at = cadence_resume_at,
          lease_token = null,
          leased_by = null,
          leased_at = null,
          lease_expires_at = null,
          blocked_reason = case
            when automated_sent_today >= 2 then 'daily_cadence'
            else 'four_hour_cadence'
          end
      where id = $1;

      return query
      select false,
             'retry'::text,
             case
               when automated_sent_today >= 2 then 'daily_cadence'
               else 'four_hour_cadence'
             end;
      return;
    end if;
  end if;

  update public.creator_notification_deliveries
  set state = 'sending',
      attempt_count = attempt_count + 1
  where id = $1;

  insert into public.creator_notification_delivery_attempts (
    delivery_id, attempt_number, lease_token, worker_id
  ) values (
    $1, delivery_context.attempt_count + 1, $2, delivery_context.leased_by
  ) on conflict do nothing;

  return query select true, 'sending'::text, null::text;
end;
$$;

create or replace function public.complete_creator_notification_delivery(
  delivery_id uuid,
  lease_token uuid,
  result jsonb
)
returns table (state text, receipt jsonb)
language plpgsql
security definer
set search_path = pg_catalog, extensions, public, auth, pg_temp
as $$
declare
  delivery_record public.creator_notification_deliveries%rowtype;
  prior_attempt record;
  requested_outcome text;
  final_state text;
  supplied_message_id text;
  supplied_channel_id text;
  supplied_error_code text;
  supplied_response_hash text;
  supplied_provider_status integer;
  supplied_discord_code integer;
  supplied_retry_at timestamptz;
  supplied_delivered_at timestamptz;
  supplied_rendered_sha256 text;
  next_available_at timestamptz;
  safe_receipt jsonb;
begin
  perform public.creator_require_service_role();

  select attempt.outcome, attempt.receipt
  into prior_attempt
  from public.creator_notification_delivery_attempts attempt
  where attempt.delivery_id = $1
    and attempt.lease_token = $2
    and attempt.completed_at is not null;

  if found then
    return query select prior_attempt.outcome, prior_attempt.receipt;
    return;
  end if;

  if jsonb_typeof($3) <> 'object' or pg_column_size($3) > 16384 then
    raise exception 'Delivery result must be a small JSON object.' using errcode = '22023';
  end if;

  select delivery.* into delivery_record
  from public.creator_notification_deliveries delivery
  where delivery.id = $1
  for update;

  if delivery_record.id is null then
    raise exception 'Delivery was not found.' using errcode = '22023';
  end if;

  if delivery_record.state <> 'sending'
    or delivery_record.lease_token is distinct from $2
  then
    raise exception 'Delivery lease is not current.' using errcode = '55000';
  end if;

  requested_outcome := lower(btrim(coalesce(
    $3->>'outcome', $3->>'state', $3->>'status', ''
  )));
  if requested_outcome not in (
    'sent', 'retry', 'terminal', 'unknown',
    'blocked', 'delivery_unknown', 'cancelled', 'dead'
  ) then
    raise exception 'Unsupported delivery completion state.' using errcode = '22023';
  end if;

  supplied_message_id := nullif(btrim(coalesce(
    $3->>'discord_message_id', $3->>'provider_message_id', ''
  )), '');
  supplied_channel_id := nullif(btrim(coalesce(
    $3->>'discord_channel_id', $3->>'provider_channel_id', ''
  )), '');
  supplied_error_code := left(nullif(btrim(coalesce(
    $3->>'error_class', $3->>'error_code', ''
  )), ''), 80);
  supplied_rendered_sha256 := nullif(btrim(coalesce($3->>'rendered_sha256', '')), '');
  supplied_response_hash := encode(digest(convert_to($3::text, 'UTF8'), 'sha256'), 'hex');

  begin
    supplied_provider_status := nullif(coalesce(
      $3->>'http_status', $3->>'provider_status', ''
    ), '')::integer;
    supplied_discord_code := nullif($3->>'discord_code', '')::integer;
    supplied_retry_at := nullif($3->>'retry_at', '')::timestamptz;
    supplied_delivered_at := nullif($3->>'delivered_at', '')::timestamptz;
  exception
    when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow then
      raise exception 'Delivery provider status or timestamps are invalid.' using errcode = '22023';
  end;

  if supplied_provider_status is not null and supplied_provider_status not between 100 and 599 then
    raise exception 'Delivery provider status is invalid.' using errcode = '22023';
  end if;

  if supplied_error_code is not null and supplied_error_code not in (
    'rate_limited',
    'bot_unauthorized',
    'bot_guild_access',
    'dm_blocked',
    'not_guild_member',
    'discord_forbidden',
    'discord_unavailable',
    'discord_rejected',
    'network_error',
    'ambiguous_send_timeout',
    'unsupported_template_version',
    'rendered_message_too_long'
  ) then
    raise exception 'Unsupported delivery error class.' using errcode = '22023';
  end if;

  if supplied_discord_code is not null and supplied_discord_code not between 0 and 99999999 then
    raise exception 'Discord provider code is invalid.' using errcode = '22023';
  end if;

  if supplied_error_code = 'not_guild_member' and not (
    requested_outcome = 'terminal'
    and supplied_provider_status = 404
    and supplied_discord_code = 10007
  ) then
    raise exception 'not_guild_member requires terminal Discord 404/10007 evidence.'
      using errcode = '22023';
  end if;

  if supplied_error_code in ('bot_unauthorized', 'bot_guild_access')
    and requested_outcome not in ('retry', 'unknown')
  then
    raise exception 'Systemic Discord access failures must remain retryable or recovery-unknown.'
      using errcode = '22023';
  end if;

  if supplied_rendered_sha256 is not null and supplied_rendered_sha256 !~ '^[a-f0-9]{64}$' then
    raise exception 'Rendered message digest is invalid.' using errcode = '22023';
  end if;

  if requested_outcome = 'sent' and (
    not public.creator_valid_discord_snowflake(supplied_message_id)
    or not public.creator_valid_discord_snowflake(supplied_channel_id)
    or supplied_delivered_at is null
    or supplied_delivered_at > now() + interval '5 minutes'
    or supplied_rendered_sha256 is null
  ) then
    raise exception 'A sent delivery requires Discord IDs, delivery time, and rendered digest.'
      using errcode = '22023';
  end if;

  if requested_outcome = 'retry' and supplied_retry_at is null then
    raise exception 'A retry delivery requires retry_at.' using errcode = '22023';
  end if;

  final_state := case requested_outcome
    when 'unknown' then 'delivery_unknown'
    when 'terminal' then case
      when supplied_error_code in ('dm_blocked', 'not_guild_member') then 'blocked'
      else 'dead'
    end
    else requested_outcome
  end;

  final_state := case
    -- Definite retries are dead-lettered after eight real send attempts.
    -- Ambiguous acceptance always receives an evidence-only recovery lease,
    -- even when the ambiguous POST was the eighth attempt.
    when final_state = 'retry'
      and delivery_record.attempt_count >= 8
      and coalesce(supplied_error_code, '') not in ('bot_unauthorized', 'bot_guild_access')
      then 'dead'
    else final_state
  end;

  next_available_at := case
    when final_state = 'retry' then greatest(
      now() + interval '1 second',
      least(supplied_retry_at, now() + interval '7 days')
    )
    when final_state = 'delivery_unknown' then now() + interval '60 seconds'
    else delivery_record.available_at
  end;

  safe_receipt := jsonb_strip_nulls(jsonb_build_object(
    'discord_message_id', supplied_message_id,
    'discord_channel_id', supplied_channel_id,
    'http_status', supplied_provider_status,
    'discord_code', supplied_discord_code,
    'error_class', supplied_error_code,
    'rendered_sha256', supplied_rendered_sha256,
    'delivered_at', supplied_delivered_at,
    'retry_at', supplied_retry_at,
    'completed_at', now()
  ));

  update public.creator_notification_deliveries as delivery
  set state = final_state,
      available_at = next_available_at,
      recovery_required = case
        when final_state = 'delivery_unknown' then true
        when final_state in ('sent', 'dead') then false
        else delivery.recovery_required
      end,
      lease_token = null,
      leased_by = null,
      leased_at = null,
      lease_expires_at = null,
      provider_message_id = case when final_state = 'sent' then supplied_message_id else provider_message_id end,
      provider_channel_id = case when final_state = 'sent' then supplied_channel_id else provider_channel_id end,
      sent_at = case when final_state = 'sent' then supplied_delivered_at else sent_at end,
      last_error_code = case when final_state = 'sent' then null else supplied_error_code end,
      blocked_reason = case when final_state = 'blocked' then coalesce(supplied_error_code, 'provider_blocked') else null end
  where id = $1;

  update public.creator_notification_delivery_attempts as delivery_attempt
  set completed_at = now(),
      outcome = final_state,
      provider_status = supplied_provider_status,
      provider_error_code = supplied_error_code,
      provider_response_sha256 = supplied_response_hash,
      receipt = safe_receipt
  where delivery_attempt.delivery_id = $1
    and delivery_attempt.lease_token = $2;

  if not found then
    raise exception 'Delivery attempt receipt was not initialized.' using errcode = '55000';
  end if;

  if final_state = 'sent' then
    update public.creator_discord_connections
    set dm_channel_id = supplied_channel_id
    where id = delivery_record.target_connection_id
      and discord_user_id = delivery_record.target_discord_user_id
      and disconnected_at is null;
  elsif supplied_error_code = 'not_guild_member' then
    perform public.creator_mark_discord_connection_not_member(
      delivery_record.target_connection_id
    );
  end if;

  return query select final_state, safe_receipt;
end;
$$;

create or replace function public.schedule_creator_reminder_tick()
returns table (scheduled_count integer, recovered_count integer, cancelled_count integer)
language plpgsql
security definer
set search_path = pg_catalog, extensions, public, auth, pg_temp
as $$
declare
  newly_scheduled_count integer := 0;
  unblocked_count integer := 0;
  recovered_delivery_count integer := 0;
  cancelled_delivery_count integer := 0;
  derived_notification_count integer := 0;
  application_source record;
  agreement_source record;
  reminder_window record;
  enqueue_result record;
begin
  perform public.creator_require_service_role();

  -- Project canonical application rows into the in-app notification ledger.
  -- Discord is only a delivery channel; consent is rechecked later at begin.
  for application_source in
    select application.id,
           application.account_id,
           application.status,
           application.submitted_at,
           coalesce(application.reviewed_at, application.submitted_at) as status_at
    from public.creator_applications application
  loop
    for enqueue_result in
      select * from public.enqueue_creator_notification(jsonb_build_object(
        'account_id', application_source.account_id,
        'event_key', 'application:' || application_source.id::text || ':submitted',
        'topic', 'account',
        'notification_type', 'application.received',
        'title', 'Application received',
        'action_path', '/application/status',
        'template_key', 'application.received',
        'template_version', 1,
        'variables', '{}'::jsonb,
        'source_occurred_at', application_source.submitted_at,
        'scheduled_for', application_source.submitted_at,
        'expires_at', application_source.submitted_at + interval '90 days'
      ))
    loop
      if enqueue_result.notification_created then
        derived_notification_count := derived_notification_count + 1;
      end if;
    end loop;

    if application_source.status in ('in_review', 'approved', 'rejected') then
      for enqueue_result in
        select * from public.enqueue_creator_notification(jsonb_build_object(
          'account_id', application_source.account_id,
          'event_key', 'application:' || application_source.id::text ||
            ':status:' || application_source.status,
          'topic', 'account',
          'notification_type', 'application.status',
          'title', 'Application update',
          'action_path', '/application/status',
          'template_key', 'application.status',
          'template_version', 1,
          'variables', jsonb_build_object('status', application_source.status),
          'source_occurred_at', application_source.status_at,
          'scheduled_for', application_source.status_at,
          'expires_at', application_source.status_at + interval '90 days'
        ))
      loop
        if enqueue_result.notification_created then
          derived_notification_count := derived_notification_count + 1;
        end if;
      end loop;
    elsif application_source.status = 'withdrawn' then
      update public.creator_notifications notification
      set cancelled_at = coalesce(notification.cancelled_at, now())
      where notification.account_id = application_source.account_id
        and notification.event_key like
          'application:' || application_source.id::text || ':%'
        and notification.cancelled_at is null
        and not exists (
          select 1
          from public.creator_notification_deliveries delivery
          where delivery.notification_id = notification.id
            and delivery.state = 'sent'
        );
    end if;
  end loop;

  -- Pending agreement reminders use the agreement's immutable creation time,
  -- so repeated ticks and pending->sent->viewed transitions keep one schedule.
  for agreement_source in
    select agreement.id,
           enrollment.account_id,
           agreement.status,
           agreement.created_at,
           coalesce(
             agreement.completed_at,
             agreement.creator_accepted_at,
             agreement.updated_at,
             agreement.created_at
           ) as terminal_at
    from public.agreement_records agreement
    join public.creator_enrollments enrollment
      on enrollment.id = agreement.enrollment_id
  loop
    if agreement_source.status in ('pending', 'sent', 'viewed') then
      for enqueue_result in
        select * from public.enqueue_creator_notification(jsonb_build_object(
          'account_id', agreement_source.account_id,
          'event_key', 'agreement:' || agreement_source.id::text || ':ready',
          'topic', 'onboarding',
          'notification_type', 'agreement.ready',
          'title', 'Creator agreement ready',
          'action_path', '/onboarding/agreement',
          'template_key', 'agreement.ready',
          'template_version', 1,
          'variables', '{}'::jsonb,
          'source_occurred_at', agreement_source.created_at,
          'scheduled_for', agreement_source.created_at,
          'expires_at', agreement_source.created_at + interval '90 days'
        ))
      loop
        if enqueue_result.notification_created then
          derived_notification_count := derived_notification_count + 1;
        end if;
      end loop;

      for reminder_window in
        select *
        from (values
          ('day1'::text, interval '24 hours'),
          ('day3'::text, interval '72 hours'),
          ('day7'::text, interval '7 days')
        ) windows(window_key, delay)
      loop
        for enqueue_result in
          select * from public.enqueue_creator_notification(jsonb_build_object(
            'account_id', agreement_source.account_id,
            'event_key', 'agreement:' || agreement_source.id::text ||
              ':reminder:' || reminder_window.window_key,
            'topic', 'onboarding',
            'notification_type', 'agreement.reminder',
            'title', 'Creator agreement reminder',
            'action_path', '/onboarding/agreement',
            'template_key', 'agreement.reminder',
            'template_version', 1,
            'variables', '{}'::jsonb,
            'source_occurred_at', agreement_source.created_at,
            'scheduled_for', agreement_source.created_at + reminder_window.delay,
            'expires_at', agreement_source.created_at + reminder_window.delay + interval '30 days'
          ))
        loop
          if enqueue_result.notification_created then
            derived_notification_count := derived_notification_count + 1;
          end if;
        end loop;
      end loop;
    elsif agreement_source.status in (
      'creator_accepted', 'completed', 'declined', 'voided', 'error'
    ) then
      update public.creator_notifications notification
      set cancelled_at = coalesce(notification.cancelled_at, now())
      where notification.account_id = agreement_source.account_id
        and notification.event_key like
          'agreement:' || agreement_source.id::text || ':%'
        and notification.cancelled_at is null
        and (
          notification.scheduled_for > agreement_source.terminal_at
          or not exists (
            select 1
            from public.creator_notification_deliveries delivery
            where delivery.notification_id = notification.id
              and delivery.state = 'sent'
          )
        );
    end if;
  end loop;

  update public.creator_notification_deliveries
  set state = case when state = 'sending' then 'delivery_unknown' else 'retry' end,
      recovery_required = recovery_required or state = 'sending',
      available_at = now(),
      lease_token = null,
      leased_by = null,
      leased_at = null,
      lease_expires_at = null,
      last_error_code = 'lease_expired'
  where state in ('leased', 'sending')
    and lease_expires_at <= now();
  get diagnostics recovered_delivery_count = row_count;

  update public.creator_notification_deliveries
  set recovery_required = true
  where state = 'delivery_unknown'
    and not recovery_required;

  update public.creator_notification_deliveries as delivery
  set state = 'cancelled',
      available_at = now(),
      lease_token = null,
      leased_by = null,
      leased_at = null,
      lease_expires_at = null,
      blocked_reason = 'notification_expired'
  from public.creator_notifications notification
  where delivery.notification_id = notification.id
    and delivery.state in ('scheduled', 'retry', 'blocked', 'delivery_unknown')
    and (notification.cancelled_at is not null or notification.expires_at <= now());
  get diagnostics cancelled_delivery_count = row_count;

  insert into public.creator_notification_deliveries (
    notification_id,
    idempotency_key,
    provider_nonce,
    available_at
  )
  select
    notification.id,
    notification.account_id::text || ':discord:' || notification.event_key,
    'd' || encode(gen_random_bytes(12), 'hex'),
    notification.scheduled_for
  from public.creator_notifications notification
  where notification.cancelled_at is null
    and notification.expires_at > now()
    and not exists (
      select 1
      from public.creator_notification_deliveries delivery
      where delivery.notification_id = notification.id
        and delivery.channel = 'discord'
    )
  on conflict do nothing;
  get diagnostics newly_scheduled_count = row_count;

  update public.creator_notification_deliveries delivery
  set state = 'blocked',
      blocked_reason = case
        when not exists (
          select 1
          from public.creator_discord_preferences preferences
          where preferences.account_id = notification.account_id
            and preferences.discord_opt_in
            and preferences.discord_opted_in_at is not null
        ) then 'discord_opt_out'
        else 'predates_discord_opt_in'
      end
  from public.creator_notifications notification
  where delivery.notification_id = notification.id
    and delivery.state = 'scheduled'
    and (
      notification.notification_type <> 'creator_test'
      or notification.template_key <> 'creator.test'
    )
    and (
      not exists (
        select 1
        from public.creator_discord_preferences preferences
        where preferences.account_id = notification.account_id
          and preferences.discord_opt_in
          and preferences.discord_opted_in_at is not null
      )
      or exists (
        select 1
        from public.creator_discord_preferences preferences
        where preferences.account_id = notification.account_id
          and preferences.discord_opt_in
          and preferences.discord_opted_in_at is not null
          and (
            notification.source_occurred_at < preferences.discord_opted_in_at
            or notification.scheduled_for < preferences.discord_opted_in_at
          )
      )
    );

  update public.creator_notification_deliveries as delivery
  set state = 'scheduled',
      available_at = greatest(notification.scheduled_for, now()),
      blocked_reason = null,
      last_error_code = null
  from public.creator_notifications notification
  join public.creator_discord_preferences preferences
    on preferences.account_id = notification.account_id
   and preferences.discord_opt_in
   and preferences.discord_opted_in_at is not null
  join public.creator_discord_subscriptions subscription
    on subscription.account_id = notification.account_id
   and subscription.topic = notification.topic
   and subscription.enabled
  join public.creator_discord_connections connection
    on connection.account_id = notification.account_id
   and connection.disconnected_at is null
   and connection.membership_status = 'member'
  where delivery.notification_id = notification.id
    and delivery.state = 'blocked'
    and delivery.blocked_reason in (
      'discord_opt_out', 'predates_discord_opt_in', 'topic_disabled',
      'discord_not_connected', 'discord_connection_changed', 'not_guild_member'
    )
    and (
      notification.notification_type <> 'creator_test'
      or notification.template_key <> 'creator.test'
    )
    and notification.source_occurred_at >= preferences.discord_opted_in_at
    and notification.scheduled_for >= preferences.discord_opted_in_at
    and notification.cancelled_at is null
    and notification.expires_at > now();
  get diagnostics unblocked_count = row_count;

  delete from public.discord_oauth_attempts
  where expires_at < now() - interval '1 day'
     or consumed_at < now() - interval '1 day';

  delete from public.creator_discord_worker_requests
  where expires_at <= now();

  return query
  select derived_notification_count + newly_scheduled_count + unblocked_count,
         recovered_delivery_count,
         cancelled_delivery_count;
end;
$$;

create or replace function public.consume_creator_discord_worker_request(
  worker_id text,
  request_nonce uuid,
  request_timestamp timestamptz,
  body_sha256 text
)
returns boolean
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  inserted_nonce uuid;
begin
  perform public.creator_require_service_role();

  if $1 !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$'
    or $4 !~ '^[a-f0-9]{64}$'
    or abs(extract(epoch from (now() - $3))) > 300
  then
    return false;
  end if;

  delete from public.creator_discord_worker_requests
  where expires_at <= now();

  insert into public.creator_discord_worker_requests (
    request_nonce,
    worker_id,
    request_timestamp,
    body_sha256,
    expires_at
  ) values (
    $2,
    $1,
    $3,
    $4,
    -- Accepted requests may be timestamped almost five minutes in the future.
    -- Retain the nonce for ten minutes so it cannot be pruned and replayed
    -- while that signed timestamp is still inside the acceptance window.
    now() + interval '10 minutes'
  )
  on conflict on constraint creator_discord_worker_requests_pkey do nothing
  returning creator_discord_worker_requests.request_nonce into inserted_nonce;

  return inserted_nonce is not null;
end;
$$;

create or replace function public.record_creator_discord_worker_heartbeat(input jsonb)
returns table (heartbeat_worker_id text, last_seen_at timestamptz)
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  submitted_worker_id text;
  submitted_instance_id text;
  submitted_version text;
  submitted_status text;
  submitted_capabilities text[];
  submitted_queue_depth integer;
  submitted_protocol_version integer;
  submitted_observed_at timestamptz;
begin
  perform public.creator_require_service_role();

  if jsonb_typeof($1) <> 'object' or pg_column_size($1) > 8192 then
    raise exception 'Heartbeat must be a small JSON object.' using errcode = '22023';
  end if;

  submitted_worker_id := btrim(coalesce($1->>'worker_id', ''));
  submitted_instance_id := nullif(btrim(coalesce(
    $1->>'boot_id', $1->>'instance_id', ''
  )), '');
  submitted_version := nullif(btrim(coalesce(
    $1->>'worker_version', $1->>'version', ''
  )), '');
  submitted_status := lower(btrim(coalesce($1->>'status', 'healthy')));

  begin
    submitted_protocol_version := coalesce(($1->>'protocol_version')::integer, 1);
    submitted_observed_at := coalesce(
      nullif($1->>'observed_at', '')::timestamptz,
      now()
    );
  exception
    when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow then
      raise exception 'Heartbeat protocol or observation time is invalid.' using errcode = '22023';
  end;

  if submitted_worker_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$'
    or submitted_instance_id is null
    or submitted_instance_id !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
    or submitted_version is null
    or char_length(submitted_version) > 80
    or submitted_protocol_version <> 1
    or abs(extract(epoch from (now() - submitted_observed_at))) > 300
    or submitted_status not in ('healthy', 'degraded', 'draining')
  then
    raise exception 'Heartbeat identity or status is invalid.' using errcode = '22023';
  end if;

  if $1 ? 'capabilities' and jsonb_typeof($1->'capabilities') <> 'array' then
    raise exception 'Heartbeat capabilities must be an array.' using errcode = '22023';
  end if;

  select coalesce(array_agg(distinct capability order by capability), '{}'::text[])
  into submitted_capabilities
  from jsonb_array_elements_text(coalesce($1->'capabilities', '[]'::jsonb)) capability;

  if exists (
    select 1 from unnest(submitted_capabilities) capability
    where capability !~ '^[a-z][a-z0-9._-]{0,79}$'
  ) then
    raise exception 'Heartbeat capability is invalid.' using errcode = '22023';
  end if;

  begin
    submitted_queue_depth := nullif($1->>'queue_depth', '')::integer;
  exception when invalid_text_representation or numeric_value_out_of_range then
    raise exception 'Heartbeat queue depth is invalid.' using errcode = '22023';
  end;

  if submitted_queue_depth is not null and submitted_queue_depth < 0 then
    raise exception 'Heartbeat queue depth is invalid.' using errcode = '22023';
  end if;

  insert into public.creator_discord_worker_heartbeats (
    worker_id,
    instance_id,
    worker_version,
    status,
    capabilities,
    queue_depth,
    last_seen_at
  ) values (
    submitted_worker_id,
    submitted_instance_id,
    submitted_version,
    submitted_status,
    submitted_capabilities,
    submitted_queue_depth,
    submitted_observed_at
  )
  on conflict (worker_id) do update
  set instance_id = excluded.instance_id,
      worker_version = excluded.worker_version,
      status = excluded.status,
      capabilities = excluded.capabilities,
      queue_depth = excluded.queue_depth,
      last_seen_at = excluded.last_seen_at;

  return query
  select heartbeat.worker_id, heartbeat.last_seen_at
  from public.creator_discord_worker_heartbeats heartbeat
  where heartbeat.worker_id = submitted_worker_id;
end;
$$;

create or replace function public.claim_creator_discord_role_sync_jobs(
  worker_id text,
  max_jobs integer,
  lease_seconds integer
)
returns table (
  job_id uuid,
  lease_token uuid,
  discord_user_id text,
  desired_role_keys text[],
  attempt_number integer
)
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
begin
  perform public.creator_require_service_role();

  if $1 !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$'
    or $2 not between 1 and 100
    or $3 not between 15 and 300
  then
    raise exception 'Invalid role-sync lease request.' using errcode = '22023';
  end if;

  -- A lease from an older authority revision may have applied stale roles
  -- before its worker disappeared. Cancel that operation and let the newest
  -- revision converge. Only the newest revision itself is retried.
  update public.creator_discord_role_sync_jobs role_job
  set state = case
        when exists (
          select 1
          from public.creator_discord_role_sync_jobs newer_job
          where newer_job.discord_user_id = role_job.discord_user_id
            and newer_job.authority_revision > role_job.authority_revision
        ) then 'cancelled'
        when role_job.attempt_count >= 8 then 'dead'
        else 'retry'
      end,
      available_at = now(),
      lease_token = null,
      leased_by = null,
      leased_at = null,
      lease_expires_at = null,
      last_error_code = case
        when exists (
          select 1
          from public.creator_discord_role_sync_jobs newer_job
          where newer_job.discord_user_id = role_job.discord_user_id
            and newer_job.authority_revision > role_job.authority_revision
        ) then 'superseded'
        else 'lease_expired'
      end
  where role_job.state = 'leased'
    and role_job.lease_expires_at <= now();

  return query
  with claim_candidates as (
    select role_job.id
    from public.creator_discord_role_sync_jobs role_job
    where role_job.state in ('scheduled', 'retry')
      and role_job.available_at <= now()
      and not exists (
        select 1
        from public.creator_discord_role_sync_jobs newer_job
        where newer_job.discord_user_id = role_job.discord_user_id
          and newer_job.authority_revision > role_job.authority_revision
      )
      and not exists (
        select 1
        from public.creator_discord_role_sync_jobs leased_job
        where leased_job.discord_user_id = role_job.discord_user_id
          and leased_job.state = 'leased'
      )
    order by role_job.available_at, role_job.authority_revision, role_job.id
    for update of role_job skip locked
    limit $2
  ), claimed as (
    update public.creator_discord_role_sync_jobs role_job
    set state = 'leased',
        lease_token = gen_random_uuid(),
        leased_by = $1,
        leased_at = now(),
        lease_expires_at = now() + make_interval(secs => $3),
        attempt_count = role_job.attempt_count + 1,
        last_error_code = null
    from claim_candidates
    where role_job.id = claim_candidates.id
    returning role_job.id,
              role_job.lease_token,
              role_job.discord_user_id,
              role_job.desired_role_keys,
              role_job.attempt_count
  )
  select claimed.id,
         claimed.lease_token,
         claimed.discord_user_id,
         claimed.desired_role_keys,
         claimed.attempt_count
  from claimed
  order by claimed.id;
end;
$$;

create or replace function public.complete_creator_discord_role_sync_job(
  job_id uuid,
  lease_token uuid,
  result jsonb
)
returns table (state text, receipt jsonb)
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  job_record public.creator_discord_role_sync_jobs%rowtype;
  requested_outcome text;
  final_state text;
  supplied_error_code text;
  supplied_http_status integer;
  supplied_discord_code integer;
  supplied_retry_at timestamptz;
  supplied_completed_at timestamptz;
  applied_role_keys text[];
  safe_receipt jsonb;
  completion_superseded boolean;
  reassert_connection public.creator_discord_connections%rowtype;
  job_discord_user_id text;
begin
  perform public.creator_require_service_role();

  if jsonb_typeof($3) <> 'object' or pg_column_size($3) > 16384 then
    raise exception 'Role-sync result must be a small JSON object.' using errcode = '22023';
  end if;

  -- Match every producer's lock order: Discord-identity advisory lock first,
  -- then connection/job row locks. This prevents a late completion from
  -- deadlocking against a concurrent lifecycle or reconnect reconciliation.
  select role_job.discord_user_id into job_discord_user_id
  from public.creator_discord_role_sync_jobs role_job
  where role_job.id = $1;

  if job_discord_user_id is null then
    raise exception 'Role-sync job was not found.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(job_discord_user_id, 104729));

  select role_job.* into job_record
  from public.creator_discord_role_sync_jobs role_job
  where role_job.id = $1
  for update;

  if job_record.id is null then
    raise exception 'Role-sync job was not found.' using errcode = '22023';
  end if;

  if job_record.last_completion_lease_token = $2 then
    return query select job_record.state, job_record.last_receipt;
    return;
  end if;

  if job_record.state <> 'leased' or job_record.lease_token is distinct from $2 then
    -- Discord has no provider-side fencing token. If an expired worker resumes
    -- after a newer reconciliation, its late side effect may have made roles
    -- stale again. Idempotently enqueue one fresh authority revision keyed by
    -- that stale lease so the current desired set is guaranteed to run last.
    select connection.* into reassert_connection
    from public.creator_discord_connections connection
    where connection.discord_user_id = job_record.discord_user_id
      and connection.disconnected_at is null
      and connection.membership_status = 'member'
    limit 1;

    if reassert_connection.id is not null then
      perform public.creator_enqueue_discord_role_sync_job(
        reassert_connection.account_id,
        reassert_connection.id,
        reassert_connection.discord_user_id,
        public.creator_discord_desired_role_keys(reassert_connection.account_id),
        $2::text
      );
    end if;

    return query select 'cancelled'::text, jsonb_build_object(
      'late_completion', true,
      'reasserted', reassert_connection.id is not null
    );
    return;
  end if;

  requested_outcome := lower(btrim(coalesce(
    $3->>'outcome', $3->>'state', $3->>'status', ''
  )));
  if requested_outcome not in (
    'synced', 'retry', 'blocked', 'completed', 'cancelled', 'dead'
  ) then
    raise exception 'Unsupported role-sync completion state.' using errcode = '22023';
  end if;

  if ($3 ? 'observed_role_keys' and jsonb_typeof($3->'observed_role_keys') <> 'array')
    or ($3 ? 'applied_role_keys' and jsonb_typeof($3->'applied_role_keys') <> 'array')
  then
    raise exception 'observed_role_keys must be an array.' using errcode = '22023';
  end if;

  select coalesce(array_agg(distinct role_key order by role_key), '{}'::text[])
  into applied_role_keys
  from jsonb_array_elements_text(coalesce(
    $3->'observed_role_keys', $3->'applied_role_keys', '[]'::jsonb
  )) role_key;

  if not applied_role_keys <@ array['onboarding', 'active', 'at_risk', 'top_performer']::text[] then
    raise exception 'Role-sync receipt contains an unmanaged role key.' using errcode = '22023';
  end if;

  if requested_outcome in ('synced', 'completed')
    and not (
      applied_role_keys @> job_record.desired_role_keys
      and job_record.desired_role_keys @> applied_role_keys
    )
  then
    raise exception 'Completed role sync must attest to the exact desired managed-role set.'
      using errcode = '22023';
  end if;

  supplied_error_code := left(nullif(btrim(coalesce(
    $3->>'error_class', $3->>'error_code', ''
  )), ''), 80);
  begin
    supplied_http_status := nullif($3->>'http_status', '')::integer;
    supplied_discord_code := nullif($3->>'discord_code', '')::integer;
    supplied_retry_at := nullif($3->>'retry_at', '')::timestamptz;
    supplied_completed_at := nullif($3->>'completed_at', '')::timestamptz;
  exception
    when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow then
      raise exception 'Role-sync provider status or timestamps are invalid.' using errcode = '22023';
  end;

  if supplied_http_status is not null and supplied_http_status not between 100 and 599 then
    raise exception 'Role-sync HTTP status is invalid.' using errcode = '22023';
  end if;

  if supplied_discord_code is not null and supplied_discord_code not between 0 and 99999999 then
    raise exception 'Role-sync Discord code is invalid.' using errcode = '22023';
  end if;

  if supplied_error_code is not null and supplied_error_code not in (
    'rate_limited',
    'bot_unauthorized',
    'bot_guild_access',
    'not_guild_member',
    'discord_forbidden',
    'discord_unavailable',
    'discord_rejected',
    'network_error'
  ) then
    raise exception 'Unsupported role-sync error class.' using errcode = '22023';
  end if;

  if supplied_error_code in ('bot_unauthorized', 'bot_guild_access')
    and requested_outcome <> 'retry'
  then
    raise exception 'Systemic role-sync access failures must remain retryable.'
      using errcode = '22023';
  end if;

  if supplied_error_code = 'not_guild_member' and not (
    requested_outcome = 'blocked'
    and supplied_http_status = 404
    and supplied_discord_code = 10007
  ) then
    raise exception 'Role not_guild_member requires blocked Discord 404/10007 evidence.'
      using errcode = '22023';
  end if;

  if requested_outcome = 'retry' and supplied_retry_at is null then
    raise exception 'A role-sync retry requires retry_at.' using errcode = '22023';
  end if;

  final_state := case requested_outcome
    when 'synced' then 'completed'
    else requested_outcome
  end;

  final_state := case
    when final_state = 'retry'
      and job_record.attempt_count >= 8
      and coalesce(supplied_error_code, '') not in ('bot_unauthorized', 'bot_guild_access')
      then 'dead'
    else final_state
  end;

  select exists (
    select 1
    from public.creator_discord_role_sync_jobs newer_job
    where newer_job.discord_user_id = job_record.discord_user_id
      and newer_job.authority_revision > job_record.authority_revision
  ) into completion_superseded;

  if completion_superseded then
    final_state := 'cancelled';
  end if;

  safe_receipt := jsonb_strip_nulls(jsonb_build_object(
    'observed_role_keys', to_jsonb(applied_role_keys),
    'error_class', supplied_error_code,
    'http_status', supplied_http_status,
    'discord_code', supplied_discord_code,
    'completed_at', coalesce(supplied_completed_at, now()),
    'retry_at', supplied_retry_at
  ));

  update public.creator_discord_role_sync_jobs
  set state = final_state,
      available_at = case
        when final_state = 'retry' then greatest(
          now() + interval '1 second',
          least(supplied_retry_at, now() + interval '7 days')
        )
        else available_at
      end,
      lease_token = null,
      leased_by = null,
      leased_at = null,
      lease_expires_at = null,
      last_completion_lease_token = $2,
      last_receipt = safe_receipt,
      last_error_code = case
        when completion_superseded then 'superseded'
        when final_state = 'completed' then null
        else supplied_error_code
      end
  where id = $1;

  if supplied_error_code = 'not_guild_member' then
    perform public.creator_mark_discord_connection_not_member(job_record.connection_id);
  end if;

  return query select final_state, safe_receipt;
end;
$$;

create or replace function public.get_current_staff_member()
returns table (staff_role text, active boolean)
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
declare
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  return query
  select staff.role, staff.active
  from public.staff_members staff
  where staff.auth_user_id = current_user_id;
end;
$$;

create or replace function public.get_creator_discord_operations_overview()
returns table (overview jsonb)
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
declare
  current_user_id uuid := auth.uid();
begin
  if not exists (
    select 1
    from public.staff_members staff
    where staff.auth_user_id = current_user_id
      and staff.active
      and staff.role in ('reviewer', 'admin')
  ) then
    raise exception 'Reviewer access required.' using errcode = '42501';
  end if;

  return query
  select jsonb_build_object(
    'delivery_counts', (
      select jsonb_object_agg(delivery_state, state_count order by delivery_state)
      from (
        select expected_state.delivery_state,
               count(delivery.id)::integer as state_count
        from unnest(array[
          'scheduled', 'leased', 'sending', 'sent', 'retry', 'blocked',
          'delivery_unknown', 'cancelled', 'dead'
        ]::text[]) expected_state(delivery_state)
        left join public.creator_notification_deliveries delivery
          on delivery.state = expected_state.delivery_state
        group by expected_state.delivery_state
      ) delivery_state_counts
    ),
    'oldest_actionable', (
      select jsonb_build_object(
        'available_at', min(delivery.available_at),
        'created_at', min(delivery.created_at)
      )
      from public.creator_notification_deliveries delivery
      where delivery.state in ('scheduled', 'retry', 'delivery_unknown')
    ),
    'connections', (
      select jsonb_build_object(
        'active_count', count(*) filter (where connection.disconnected_at is null),
        'member_count', count(*) filter (
          where connection.disconnected_at is null and connection.membership_status = 'member'
        ),
        'member_without_dm_channel_count', count(*) filter (
          where connection.disconnected_at is null
            and connection.membership_status = 'member'
            and connection.dm_channel_id is null
        ),
        'dm_blocked_count', (
          select count(*)::integer
          from public.creator_discord_connections blocked_connection
          join lateral (
            select delivery.state, delivery.last_error_code
            from public.creator_notification_deliveries delivery
            where delivery.target_connection_id = blocked_connection.id
            order by delivery.updated_at desc, delivery.id desc
            limit 1
          ) latest_delivery on true
          where blocked_connection.disconnected_at is null
            and latest_delivery.state = 'blocked'
            and latest_delivery.last_error_code = 'dm_blocked'
        )
      )
      from public.creator_discord_connections connection
    ),
    'role_sync', (
      select jsonb_build_object(
        'counts', (
          select jsonb_object_agg(role_state, state_count order by role_state)
          from (
            select expected_state.role_state,
                   count(role_job.id)::integer as state_count
            from unnest(array[
              'scheduled', 'leased', 'completed', 'retry', 'blocked', 'cancelled', 'dead'
            ]::text[]) expected_state(role_state)
            left join public.creator_discord_role_sync_jobs role_job
              on role_job.state = expected_state.role_state
            group by expected_state.role_state
          ) role_state_counts
        ),
        'failure_count', count(*) filter (where role_job.state in ('blocked', 'dead'))
      )
      from public.creator_discord_role_sync_jobs role_job
    ),
    'worker', (
      select jsonb_build_object(
        'worker_version', heartbeat.worker_version,
        'status', heartbeat.status,
        'last_seen_at', heartbeat.last_seen_at,
        'queue_depth', heartbeat.queue_depth
      )
      from public.creator_discord_worker_heartbeats heartbeat
      order by heartbeat.last_seen_at desc
      limit 1
    ),
    'recent_delivery_failures', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'attempt_number', recent_failure.attempt_number,
          'delivery_state', recent_failure.delivery_state,
          'outcome', recent_failure.outcome,
          'error_code', recent_failure.provider_error_code,
          'provider_status', recent_failure.provider_status,
          'started_at', recent_failure.started_at,
          'completed_at', recent_failure.completed_at
        ) order by recent_failure.started_at desc
      )
      from (
        select attempt.attempt_number,
               delivery.state as delivery_state,
               attempt.outcome,
               attempt.provider_error_code,
               attempt.provider_status,
               attempt.started_at,
               attempt.completed_at
        from public.creator_notification_delivery_attempts attempt
        join public.creator_notification_deliveries delivery
          on delivery.id = attempt.delivery_id
        where attempt.outcome in ('retry', 'blocked', 'delivery_unknown', 'dead')
        order by attempt.started_at desc
        limit 10
      ) recent_failure
    ), '[]'::jsonb)
  );
end;
$$;

alter table public.discord_oauth_attempts enable row level security;
alter table public.creator_discord_connections enable row level security;
alter table public.creator_discord_preferences enable row level security;
alter table public.creator_discord_subscriptions enable row level security;
alter table public.creator_notifications enable row level security;
alter table public.creator_notification_deliveries enable row level security;
alter table public.creator_notification_delivery_attempts enable row level security;
alter table public.creator_discord_role_sync_jobs enable row level security;
alter table public.creator_discord_worker_heartbeats enable row level security;
alter table public.creator_discord_worker_requests enable row level security;

create policy creator_discord_connections_read_own
on public.creator_discord_connections for select to authenticated
using (account_id = auth.uid());

create policy creator_discord_preferences_read_own
on public.creator_discord_preferences for select to authenticated
using (account_id = auth.uid());

create policy creator_discord_subscriptions_read_own
on public.creator_discord_subscriptions for select to authenticated
using (account_id = auth.uid());

create policy creator_notifications_read_own
on public.creator_notifications for select to authenticated
using (account_id = auth.uid());

create policy creator_notification_deliveries_read_own
on public.creator_notification_deliveries for select to authenticated
using (exists (
  select 1
  from public.creator_notifications notification
  where notification.id = creator_notification_deliveries.notification_id
    and notification.account_id = auth.uid()
));

revoke all on public.discord_oauth_attempts from public, anon, authenticated;
revoke all on public.creator_discord_connections from public, anon, authenticated;
revoke all on public.creator_discord_preferences from public, anon, authenticated;
revoke all on public.creator_discord_subscriptions from public, anon, authenticated;
revoke all on public.creator_notifications from public, anon, authenticated;
revoke all on public.creator_notification_deliveries from public, anon, authenticated;
revoke all on public.creator_notification_delivery_attempts from public, anon, authenticated;
revoke all on public.creator_discord_role_sync_jobs from public, anon, authenticated;
revoke all on public.creator_discord_worker_heartbeats from public, anon, authenticated;
revoke all on public.creator_discord_worker_requests from public, anon, authenticated;
revoke all on sequence public.creator_notification_delivery_attempts_id_seq
from public, anon, authenticated;
revoke all on sequence public.creator_discord_role_authority_revision_seq
from public, anon, authenticated;

grant select (
  account_id, discord_user_id, username, global_name, membership_status,
  connected_at, last_verified_at, disconnected_at
) on public.creator_discord_connections to authenticated;
grant select (
  account_id, discord_opt_in, timezone, quiet_hours_enabled, quiet_start,
  quiet_end, updated_at
) on public.creator_discord_preferences to authenticated;
grant select (account_id, topic, enabled)
on public.creator_discord_subscriptions to authenticated;
grant select (
  id, account_id, topic, title, scheduled_for, cancelled_at, created_at
) on public.creator_notifications to authenticated;
grant select (
  id, notification_id, state, available_at, sent_at, created_at
) on public.creator_notification_deliveries to authenticated;

revoke execute on function public.creator_valid_discord_snowflake(text)
from public, anon, authenticated;
revoke execute on function public.creator_require_service_role()
from public, anon, authenticated;
revoke execute on function public.creator_seed_discord_defaults()
from public, anon, authenticated;
revoke execute on function public.creator_discord_desired_role_keys(uuid)
from public, anon, authenticated;
revoke execute on function public.creator_enqueue_discord_role_sync_job(uuid, uuid, text, text[], text)
from public, anon, authenticated;
revoke execute on function public.creator_queue_discord_role_sync_after_lifecycle_change()
from public, anon, authenticated;
revoke execute on function public.creator_mark_discord_connection_not_member(uuid)
from public, anon, authenticated;

revoke execute on function public.create_discord_oauth_attempt(text, text, timestamptz)
from public, anon, authenticated;
grant execute on function public.create_discord_oauth_attempt(text, text, timestamptz)
to authenticated;

revoke execute on function public.set_creator_discord_preferences(jsonb)
from public, anon, authenticated;
grant execute on function public.set_creator_discord_preferences(jsonb)
to authenticated;

revoke execute on function public.disconnect_creator_discord()
from public, anon, authenticated;
grant execute on function public.disconnect_creator_discord()
to authenticated;

revoke execute on function public.consume_discord_oauth_attempt(text)
from public, anon, authenticated;
grant execute on function public.consume_discord_oauth_attempt(text)
to service_role;

revoke execute on function public.upsert_creator_discord_connection(uuid, jsonb, text)
from public, anon, authenticated;
grant execute on function public.upsert_creator_discord_connection(uuid, jsonb, text)
to service_role;

revoke execute on function public.enqueue_creator_notification(jsonb)
from public, anon, authenticated;
grant execute on function public.enqueue_creator_notification(jsonb)
to service_role;

revoke execute on function public.enqueue_creator_discord_test(uuid)
from public, anon, authenticated;
grant execute on function public.enqueue_creator_discord_test(uuid)
to service_role;

revoke execute on function public.claim_creator_notification_deliveries(text, integer, integer)
from public, anon, authenticated;
grant execute on function public.claim_creator_notification_deliveries(text, integer, integer)
to service_role;

revoke execute on function public.begin_creator_notification_delivery(uuid, uuid)
from public, anon, authenticated;
grant execute on function public.begin_creator_notification_delivery(uuid, uuid)
to service_role;

revoke execute on function public.complete_creator_notification_delivery(uuid, uuid, jsonb)
from public, anon, authenticated;
grant execute on function public.complete_creator_notification_delivery(uuid, uuid, jsonb)
to service_role;

revoke execute on function public.schedule_creator_reminder_tick()
from public, anon, authenticated;
grant execute on function public.schedule_creator_reminder_tick()
to service_role;

revoke execute on function public.consume_creator_discord_worker_request(text, uuid, timestamptz, text)
from public, anon, authenticated;
grant execute on function public.consume_creator_discord_worker_request(text, uuid, timestamptz, text)
to service_role;

revoke execute on function public.record_creator_discord_worker_heartbeat(jsonb)
from public, anon, authenticated;
grant execute on function public.record_creator_discord_worker_heartbeat(jsonb)
to service_role;

revoke execute on function public.claim_creator_discord_role_sync_jobs(text, integer, integer)
from public, anon, authenticated;
grant execute on function public.claim_creator_discord_role_sync_jobs(text, integer, integer)
to service_role;

revoke execute on function public.complete_creator_discord_role_sync_job(uuid, uuid, jsonb)
from public, anon, authenticated;
grant execute on function public.complete_creator_discord_role_sync_job(uuid, uuid, jsonb)
to service_role;

revoke execute on function public.get_current_staff_member()
from public, anon, authenticated;
grant execute on function public.get_current_staff_member()
to authenticated;

revoke execute on function public.get_creator_discord_operations_overview()
from public, anon, authenticated;
grant execute on function public.get_creator_discord_operations_overview()
to authenticated;

comment on table public.discord_oauth_attempts is
  'Single-use SHA-256 OAuth state digests. Discord OAuth tokens are never stored.';
comment on table public.creator_discord_connections is
  'Verified Discord identity and guild-membership snapshot; no OAuth or bot token material.';
comment on table public.creator_discord_preferences is
  'Creator consent and quiet-hours policy. Discord delivery is opt-in and defaults off.';
comment on table public.creator_notifications is
  'Idempotent logical creator notifications with reviewed template references and variables, never rendered bodies.';
comment on table public.creator_notification_deliveries is
  'Durable Discord delivery state with stable provider nonces, leases, and provider receipts.';
comment on table public.creator_discord_role_sync_jobs is
  'Deterministic managed-role reconciliation. Jobs expose semantic keys, never raw Discord role IDs.';
comment on table public.creator_discord_worker_requests is
  'Five-minute single-use request nonces for HMAC-authenticated worker API replay prevention.';
