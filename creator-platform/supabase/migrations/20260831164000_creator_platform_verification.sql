-- Creator-owned campaign account setup and provider-neutral bio verification.
-- Application handles remain provisional until a verifier or staff reviewer
-- records a stable native account ID and hashed evidence.

create table public.creator_platform_account_claims (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.creator_accounts(auth_user_id) on delete cascade,
  application_handle_id uuid not null unique references public.creator_application_handles(id) on delete restrict,
  platform text not null check (platform in ('TIKTOK', 'INSTAGRAM_REELS')),
  entered_handle text not null check (char_length(entered_handle) between 1 and 80),
  normalized_handle text not null check (
    char_length(normalized_handle) between 1 and 64
    and normalized_handle ~ '^[a-z0-9._-]+$'
  ),
  status text not null default 'pending_code'
    check (status in ('pending_code', 'checking', 'needs_attention', 'verified', 'revoked')),
  bio_code text not null check (bio_code ~ '^GT-[A-F0-9]{8}$'),
  code_issued_at timestamptz not null default now(),
  code_expires_at timestamptz not null default (now() + interval '7 days'),
  last_check_requested_at timestamptz,
  last_checked_at timestamptz,
  last_error_code text,
  creator_message text check (creator_message is null or char_length(creator_message) between 3 and 500),
  native_account_id text check (
    native_account_id is null or char_length(native_account_id) between 1 and 191
  ),
  ownership_evidence_sha256 text check (
    ownership_evidence_sha256 is null or ownership_evidence_sha256 ~ '^[a-f0-9]{64}$'
  ),
  ownership_verified_at timestamptz,
  verified_by uuid references public.staff_members(auth_user_id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, platform, normalized_handle),
  check (code_expires_at > code_issued_at),
  check (
    (
      status = 'verified'
      and native_account_id is not null
      and ownership_evidence_sha256 is not null
      and ownership_verified_at is not null
    )
    or (
      status <> 'verified'
      and ownership_verified_at is null
    )
  )
);

create unique index creator_platform_claims_native_identity
  on public.creator_platform_account_claims (platform, native_account_id)
  where native_account_id is not null and status = 'verified';

create table public.creator_platform_verification_jobs (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references public.creator_platform_account_claims(id) on delete cascade,
  state text not null default 'queued'
    check (state in ('queued', 'leased', 'retry', 'succeeded', 'failed', 'cancelled')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  available_at timestamptz not null default now(),
  leased_at timestamptz,
  lease_expires_at timestamptz,
  leased_by text,
  result_code text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (state = 'leased' and leased_at is not null and lease_expires_at is not null and leased_by is not null)
    or state <> 'leased'
  ),
  check (
    (state in ('succeeded', 'failed', 'cancelled') and completed_at is not null)
    or (state not in ('succeeded', 'failed', 'cancelled') and completed_at is null)
  )
);

create unique index creator_platform_verification_one_active_job
  on public.creator_platform_verification_jobs (claim_id)
  where state in ('queued', 'leased', 'retry');

create index creator_platform_verification_jobs_due
  on public.creator_platform_verification_jobs (available_at, created_at)
  where state in ('queued', 'retry');

create table public.creator_platform_verification_events (
  id bigint generated always as identity primary key,
  claim_id uuid not null references public.creator_platform_account_claims(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  event_type text not null check (char_length(event_type) between 2 and 80),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create trigger creator_platform_claims_touch_updated_at
before update on public.creator_platform_account_claims
for each row execute function public.creator_touch_updated_at();

create trigger creator_platform_verification_jobs_touch_updated_at
before update on public.creator_platform_verification_jobs
for each row execute function public.creator_touch_updated_at();

create or replace function public.seed_creator_platform_claims()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
begin
  if new.status = 'approved' then
    insert into public.creator_platform_account_claims (
      account_id,
      application_handle_id,
      platform,
      entered_handle,
      normalized_handle,
      bio_code
    )
    select
      new.account_id,
      handle_record.id,
      handle_record.platform,
      handle_record.entered_handle,
      handle_record.normalized_handle,
      'GT-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))
    from public.creator_application_handles handle_record
    where handle_record.application_id = new.id
    on conflict (application_handle_id) do nothing;
  end if;

  return new;
end;
$$;

create trigger seed_creator_platform_claims_after_application_review
after insert or update of status on public.creator_applications
for each row execute function public.seed_creator_platform_claims();

insert into public.creator_platform_account_claims (
  account_id,
  application_handle_id,
  platform,
  entered_handle,
  normalized_handle,
  bio_code
)
select
  application_record.account_id,
  handle_record.id,
  handle_record.platform,
  handle_record.entered_handle,
  handle_record.normalized_handle,
  'GT-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))
from public.creator_applications application_record
join public.creator_application_handles handle_record
  on handle_record.application_id = application_record.id
where application_record.status = 'approved'
on conflict (application_handle_id) do nothing;

create or replace function public.get_own_creator_platform_setup()
returns table (
  claim_id uuid,
  platform text,
  entered_handle text,
  claim_status text,
  bio_code text,
  code_expires_at timestamptz,
  code_expired boolean,
  last_check_requested_at timestamptz,
  last_checked_at timestamptz,
  last_error_code text,
  creator_message text,
  native_account_id text,
  ownership_verified_at timestamptz,
  verification_job_state text
)
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
  select
    claim_record.id,
    claim_record.platform,
    claim_record.entered_handle,
    claim_record.status,
    claim_record.bio_code,
    claim_record.code_expires_at,
    claim_record.code_expires_at <= now(),
    claim_record.last_check_requested_at,
    claim_record.last_checked_at,
    claim_record.last_error_code,
    claim_record.creator_message,
    claim_record.native_account_id,
    claim_record.ownership_verified_at,
    latest_job.state
  from public.creator_platform_account_claims claim_record
  left join lateral (
    select verification_job.state
    from public.creator_platform_verification_jobs verification_job
    where verification_job.claim_id = claim_record.id
    order by verification_job.created_at desc
    limit 1
  ) latest_job on true
  where claim_record.account_id = current_user_id
  order by claim_record.platform, claim_record.normalized_handle;
end;
$$;

create or replace function public.request_creator_platform_verification(target_claim_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  current_user_id uuid := auth.uid();
  claim_record public.creator_platform_account_claims%rowtype;
  existing_job_id uuid;
  verification_job_id uuid;
begin
  if current_user_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  select * into claim_record
  from public.creator_platform_account_claims
  where id = target_claim_id and account_id = current_user_id
  for update;

  if claim_record.id is null then
    raise exception 'Campaign account was not found.' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.creator_enrollments enrollment_record
    join public.creator_applications application_record
      on application_record.id = enrollment_record.application_id
    where enrollment_record.account_id = current_user_id
      and application_record.status = 'approved'
      and enrollment_record.status in ('agreement_pending', 'active', 'paused')
  ) then
    raise exception 'An approved enrollment is required.' using errcode = '42501';
  end if;

  if claim_record.status = 'verified' then
    raise exception 'This campaign account is already verified.' using errcode = '22023';
  end if;

  if claim_record.status = 'revoked' then
    raise exception 'This campaign account cannot be checked.' using errcode = '42501';
  end if;

  if claim_record.code_expires_at <= now() then
    raise exception 'Your verification code expired. Replace it before checking again.'
      using errcode = '22023';
  end if;

  select id into existing_job_id
  from public.creator_platform_verification_jobs
  where claim_id = claim_record.id
    and state in ('queued', 'leased', 'retry')
  order by created_at desc
  limit 1;

  if existing_job_id is not null then
    update public.creator_platform_verification_jobs
    set available_at = case when state = 'leased' then available_at else now() end,
        state = case when state = 'leased' then state else 'queued' end,
        result_code = null
    where id = existing_job_id
    returning id into verification_job_id;
  else
    insert into public.creator_platform_verification_jobs (claim_id)
    values (claim_record.id)
    returning id into verification_job_id;
  end if;

  update public.creator_platform_account_claims
  set status = 'checking',
      last_check_requested_at = now(),
      last_error_code = null,
      creator_message = null
  where id = claim_record.id;

  insert into public.creator_platform_verification_events (
    claim_id,
    actor_user_id,
    event_type,
    metadata
  ) values (
    claim_record.id,
    current_user_id,
    'check_requested',
    jsonb_build_object('job_id', verification_job_id)
  );

  return verification_job_id;
end;
$$;

create or replace function public.rotate_creator_platform_verification_code(target_claim_id uuid)
returns text
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  current_user_id uuid := auth.uid();
  next_code text;
begin
  if current_user_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  next_code := 'GT-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));

  update public.creator_platform_account_claims
  set bio_code = next_code,
      code_issued_at = now(),
      code_expires_at = now() + interval '7 days',
      status = 'pending_code',
      last_error_code = null,
      creator_message = null
  where id = target_claim_id
    and account_id = current_user_id
    and status in ('pending_code', 'needs_attention');

  if not found then
    raise exception 'This verification code cannot be replaced.' using errcode = '22023';
  end if;

  update public.creator_platform_verification_jobs
  set state = 'cancelled', completed_at = now(), result_code = 'code_rotated'
  where claim_id = target_claim_id and state in ('queued', 'retry');

  insert into public.creator_platform_verification_events (
    claim_id,
    actor_user_id,
    event_type
  ) values (
    target_claim_id,
    current_user_id,
    'code_rotated'
  );

  return next_code;
end;
$$;

create or replace function public.get_creator_platform_verification_queue()
returns table (
  claim_id uuid,
  creator_name text,
  creator_email text,
  platform text,
  entered_handle text,
  claim_status text,
  bio_code text,
  code_expires_at timestamptz,
  last_check_requested_at timestamptz,
  last_checked_at timestamptz,
  last_error_code text
)
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
declare
  reviewer_id uuid := auth.uid();
begin
  if not exists (
    select 1 from public.staff_members
    where auth_user_id = reviewer_id and active and role in ('reviewer', 'admin')
  ) then
    raise exception 'Reviewer access required.' using errcode = '42501';
  end if;

  return query
  select
    claim_record.id,
    application_record.name,
    account_record.email_snapshot,
    claim_record.platform,
    claim_record.entered_handle,
    claim_record.status,
    claim_record.bio_code,
    claim_record.code_expires_at,
    claim_record.last_check_requested_at,
    claim_record.last_checked_at,
    claim_record.last_error_code
  from public.creator_platform_account_claims claim_record
  join public.creator_accounts account_record
    on account_record.auth_user_id = claim_record.account_id
  join public.creator_application_handles handle_record
    on handle_record.id = claim_record.application_handle_id
  join public.creator_applications application_record
    on application_record.id = handle_record.application_id
  where claim_record.status <> 'revoked'
  order by
    case claim_record.status
      when 'checking' then 0
      when 'needs_attention' then 1
      when 'pending_code' then 2
      else 3
    end,
    claim_record.last_check_requested_at desc nulls last,
    claim_record.created_at;
end;
$$;

create or replace function public.review_creator_platform_claim(
  target_claim_id uuid,
  review_input jsonb
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, extensions, public, auth, pg_temp
as $$
declare
  reviewer_id uuid := auth.uid();
  review_decision text := lower(btrim(coalesce(review_input->>'decision', '')));
  reviewed_native_id text := btrim(coalesce(review_input->>'nativeAccountId', ''));
  evidence_reference text := btrim(coalesce(review_input->>'evidenceReference', ''));
  reviewer_note text := left(btrim(coalesce(review_input->>'note', '')), 500);
  claim_record public.creator_platform_account_claims%rowtype;
  evidence_hash text;
  verified_platform_account_id uuid;
begin
  if not exists (
    select 1 from public.staff_members
    where auth_user_id = reviewer_id and active and role in ('reviewer', 'admin')
  ) then
    raise exception 'Reviewer access required.' using errcode = '42501';
  end if;

  select * into claim_record
  from public.creator_platform_account_claims
  where id = target_claim_id and status <> 'revoked'
  for update;

  if claim_record.id is null then
    raise exception 'Campaign account was not found.' using errcode = '22023';
  end if;

  if claim_record.status = 'verified' then
    raise exception 'A verified campaign account cannot be reviewed again.' using errcode = '22023';
  end if;

  if review_decision = 'approve' then
    if char_length(reviewed_native_id) not between 1 and 191 then
      raise exception 'A stable native account ID is required.' using errcode = '22023';
    end if;

    if char_length(evidence_reference) not between 8 and 2000 then
      raise exception 'A review evidence reference is required.' using errcode = '22023';
    end if;

    if exists (
      select 1
      from public.creator_platform_accounts canonical_account
      where canonical_account.platform = claim_record.platform
        and canonical_account.native_account_id = reviewed_native_id
        and canonical_account.account_id <> claim_record.account_id
    ) then
      raise exception 'That native account is already verified for another creator.'
        using errcode = '23505';
    end if;

    evidence_hash := encode(
      digest(
        convert_to(
          claim_record.platform || ':' || reviewed_native_id || ':' || evidence_reference,
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    );

    insert into public.creator_platform_accounts (
      account_id,
      platform,
      native_account_id,
      current_handle,
      normalized_handle,
      ownership_verification_method,
      ownership_evidence_sha256,
      ownership_verified_at,
      status
    ) values (
      claim_record.account_id,
      claim_record.platform,
      reviewed_native_id,
      claim_record.entered_handle,
      claim_record.normalized_handle,
      'bio_code_manual_review',
      evidence_hash,
      now(),
      'verified'
    )
    on conflict (platform, native_account_id) do update
    set current_handle = excluded.current_handle,
        normalized_handle = excluded.normalized_handle,
        ownership_verification_method = excluded.ownership_verification_method,
        ownership_evidence_sha256 = excluded.ownership_evidence_sha256,
        ownership_verified_at = excluded.ownership_verified_at,
        status = 'verified'
    where public.creator_platform_accounts.account_id = claim_record.account_id
    returning public.creator_platform_accounts.id into verified_platform_account_id;

    if verified_platform_account_id is null then
      raise exception 'That native account is already verified for another creator.'
        using errcode = '23505';
    end if;

    update public.creator_platform_account_claims
    set status = 'verified',
        native_account_id = reviewed_native_id,
        ownership_evidence_sha256 = evidence_hash,
        ownership_verified_at = now(),
        verified_by = reviewer_id,
        last_checked_at = now(),
        last_error_code = null,
        creator_message = null
    where id = claim_record.id;

    update public.creator_platform_verification_jobs
    set state = 'succeeded',
        completed_at = now(),
        result_code = 'verified_manual'
    where claim_id = claim_record.id and state in ('queued', 'retry');
  elsif review_decision = 'reject' then
    if char_length(reviewer_note) < 3 then
      raise exception 'Tell the creator what needs attention.' using errcode = '22023';
    end if;

    update public.creator_platform_account_claims
    set status = 'needs_attention',
        last_checked_at = now(),
        last_error_code = 'manual_review_failed',
        creator_message = reviewer_note
    where id = claim_record.id;

    update public.creator_platform_verification_jobs
    set state = 'failed',
        completed_at = now(),
        result_code = 'manual_review_failed'
    where claim_id = claim_record.id and state in ('queued', 'retry');
  else
    raise exception 'Choose approve or reject.' using errcode = '22023';
  end if;

  insert into public.creator_platform_verification_events (
    claim_id,
    actor_user_id,
    event_type,
    metadata
  ) values (
    claim_record.id,
    reviewer_id,
    case when review_decision = 'approve' then 'verified_manual' else 'review_failed' end,
    jsonb_strip_nulls(jsonb_build_object(
      'native_account_id', nullif(reviewed_native_id, ''),
      'note', nullif(reviewer_note, '')
    ))
  );

  return claim_record.id;
end;
$$;

-- Approved creators must verify every handle they applied with before the
-- agreement gate. This honors the latest flexible handle/platform application
-- rather than forcing a TikTok-and-Instagram pair when the creator uses one.
create or replace function public.get_creator_account_state()
returns table (
  account_status text,
  application_id uuid,
  application_status text,
  agreement_status text,
  next_path text
)
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  current_user_id uuid := auth.uid();
  current_user_confirmed_at timestamptz;
begin
  if current_user_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  select email_confirmed_at into current_user_confirmed_at
  from auth.users where id = current_user_id;

  if current_user_confirmed_at is not null then
    update public.creator_accounts
    set lifecycle_status = 'profile_incomplete'
    where auth_user_id = current_user_id
      and lifecycle_status = 'email_unverified';
  end if;

  return query
  select
    account_record.lifecycle_status,
    application_record.id,
    application_record.status,
    agreement_record.status,
    case
      when current_user_confirmed_at is null then '/auth/check-email'
      when application_record.id is null then '/apply'
      when application_record.status <> 'approved' then '/application/status'
      when enrollment_record.id is null then '/application/status'
      when exists (
        select 1
        from public.creator_application_handles required_handle
        left join public.creator_platform_account_claims claim_record
          on claim_record.application_handle_id = required_handle.id
        where required_handle.application_id = application_record.id
          and coalesce(claim_record.status, 'missing') <> 'verified'
      ) then '/onboarding/accounts'
      when agreement_record.status is null or agreement_record.status <> 'completed'
        then '/onboarding/agreement'
      else '/account'
    end
  from public.creator_accounts account_record
  left join public.creator_applications application_record
    on application_record.account_id = account_record.auth_user_id
  left join public.creator_enrollments enrollment_record
    on enrollment_record.account_id = account_record.auth_user_id
  left join lateral (
    select agreement_records.status
    from public.agreement_records
    where agreement_records.enrollment_id = enrollment_record.id
    order by agreement_records.created_at desc
    limit 1
  ) agreement_record on true
  where account_record.auth_user_id = current_user_id;
end;
$$;

alter table public.creator_platform_account_claims enable row level security;
alter table public.creator_platform_verification_jobs enable row level security;
alter table public.creator_platform_verification_events enable row level security;

revoke all on public.creator_platform_account_claims from public, anon, authenticated;
revoke all on public.creator_platform_verification_jobs from public, anon, authenticated;
revoke all on public.creator_platform_verification_events from public, anon, authenticated;

revoke execute on function public.seed_creator_platform_claims() from public, anon, authenticated;
revoke execute on function public.get_own_creator_platform_setup() from public, anon;
revoke execute on function public.request_creator_platform_verification(uuid) from public, anon;
revoke execute on function public.rotate_creator_platform_verification_code(uuid) from public, anon;
revoke execute on function public.get_creator_platform_verification_queue() from public, anon;
revoke execute on function public.review_creator_platform_claim(uuid, jsonb) from public, anon;

grant execute on function public.get_own_creator_platform_setup() to authenticated;
grant execute on function public.request_creator_platform_verification(uuid) to authenticated;
grant execute on function public.rotate_creator_platform_verification_code(uuid) to authenticated;
grant execute on function public.get_creator_platform_verification_queue() to authenticated;
grant execute on function public.review_creator_platform_claim(uuid, jsonb) to authenticated;
grant execute on function public.get_creator_account_state() to authenticated;

comment on table public.creator_platform_account_claims is
  'Creator-owned campaign account claims seeded from approved application handles. A claim is not canonical until ownership evidence and a stable provider-native ID are recorded.';

comment on table public.creator_platform_verification_jobs is
  'Durable provider-neutral bio verification work. Queued work survives web and collector restarts.';
