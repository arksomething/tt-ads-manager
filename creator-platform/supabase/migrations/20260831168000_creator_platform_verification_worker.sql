-- Durable, provider-neutral worker boundary for campaign-account ownership
-- verification. The database, not a scraper process, owns leases, retry state,
-- code-rotation fencing, collision protection, and the audit trail.

alter table public.creator_platform_verification_jobs
  add column lease_token uuid,
  add column max_attempts smallint not null default 5
    check (max_attempts between 1 and 10),
  add column claim_code_issued_at timestamptz,
  add column claim_code_sha256 text
    check (claim_code_sha256 is null or claim_code_sha256 ~ '^[a-f0-9]{64}$'),
  add column result_native_account_id text
    check (
      result_native_account_id is null
      or (
        char_length(result_native_account_id) between 1 and 191
        and result_native_account_id !~ '[[:cntrl:]]'
      )
    ),
  add column result_evidence_sha256 text
    check (
      result_evidence_sha256 is null
      or result_evidence_sha256 ~ '^[a-f0-9]{64}$'
    );

-- A migration may be applied while an older, unfenced worker experiment has a
-- row leased. Recover it before requiring a lease token.
update public.creator_platform_verification_jobs
set state = 'retry',
    available_at = now(),
    result_code = 'legacy_lease_recovered'
where state = 'leased' and lease_token is null;

alter table public.creator_platform_verification_jobs
  add constraint creator_platform_verification_lease_fenced
  check (
    state <> 'leased'
    or (
      lease_token is not null
      and leased_at is not null
      and lease_expires_at is not null
      and leased_by is not null
      and claim_code_issued_at is not null
      and claim_code_sha256 is not null
    )
  );

create table public.creator_platform_verification_worker_requests (
  request_nonce uuid primary key,
  worker_id text not null check (
    char_length(worker_id) between 3 and 64
    and worker_id ~ '^[a-z0-9][a-z0-9._-]*$'
  ),
  request_timestamp timestamptz not null,
  body_sha256 text not null check (body_sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  check (expires_at > created_at)
);

create index creator_platform_verification_worker_requests_expiry
  on public.creator_platform_verification_worker_requests (expires_at);

alter table public.creator_platform_verification_worker_requests enable row level security;
revoke all on public.creator_platform_verification_worker_requests
from public, anon, authenticated;

create or replace function public.consume_creator_platform_verification_worker_request(
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

  if $1 !~ '^[a-z0-9][a-z0-9._-]{2,63}$'
    or $4 !~ '^[a-f0-9]{64}$'
    or abs(extract(epoch from (now() - $3))) > 300
  then
    return false;
  end if;

  delete from public.creator_platform_verification_worker_requests
  where expires_at <= now();

  insert into public.creator_platform_verification_worker_requests (
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
    -- A signed timestamp may be almost five minutes in the future. Keep the
    -- nonce long enough that it cannot become replayable inside that window.
    now() + interval '10 minutes'
  )
  on conflict on constraint creator_platform_verification_worker_requests_pkey
  do nothing
  returning creator_platform_verification_worker_requests.request_nonce
  into inserted_nonce;

  return inserted_nonce is not null;
end;
$$;

-- Any staff decision, revocation, or code rotation supersedes outstanding
-- machine work. Worker completion also checks claim status and the code
-- issuance snapshot, so this trigger is defense in depth rather than the only
-- fence.
create or replace function public.cancel_creator_platform_verification_work()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status <> 'checking'
    and (
      old.status is distinct from new.status
      or old.bio_code is distinct from new.bio_code
      or old.code_issued_at is distinct from new.code_issued_at
    )
  then
    update public.creator_platform_verification_jobs
    set state = 'cancelled',
        completed_at = now(),
        result_code = case
          when old.bio_code is distinct from new.bio_code
            or old.code_issued_at is distinct from new.code_issued_at
            then 'code_rotated'
          when new.status = 'verified' then 'superseded_by_verification'
          when new.status = 'needs_attention' then 'superseded_by_review'
          else 'claim_unavailable'
        end
    where claim_id = new.id
      and state in ('queued', 'leased', 'retry');
  end if;

  return new;
end;
$$;

create trigger cancel_creator_platform_verification_work_after_claim_change
after update of status, bio_code, code_issued_at
on public.creator_platform_account_claims
for each row execute function public.cancel_creator_platform_verification_work();

-- Repeated creator clicks are an idempotent lookup while any job is active.
-- In particular, they cannot move a retry's database-owned available_at back
-- to now. A short per-claim cooldown also bounds new jobs and audit events
-- after a terminal result.
create or replace function public.request_creator_platform_verification(
  target_claim_id uuid
)
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

  select verification_job.id into existing_job_id
  from public.creator_platform_verification_jobs verification_job
  where verification_job.claim_id = claim_record.id
    and verification_job.state in ('queued', 'leased', 'retry')
  order by verification_job.created_at desc
  limit 1
  for update;

  if existing_job_id is not null then
    -- Do not rewrite state, result_code, available_at, claim timestamps, or the
    -- audit log. The existing durable job is the idempotent result.
    return existing_job_id;
  end if;

  if claim_record.last_check_requested_at is not null
    and claim_record.last_check_requested_at > now() - interval '60 seconds'
  then
    raise exception 'Wait before requesting another verification check.'
      using errcode = '22023';
  end if;

  insert into public.creator_platform_verification_jobs (claim_id)
  values (claim_record.id)
  returning id into verification_job_id;

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

-- Replace the creator rotation RPC so an expired check can never strand a
-- claim in `checking`. Rotating cancels queued, retrying, and currently leased
-- work; a late result therefore cannot pass the lease fence.
create or replace function public.rotate_creator_platform_verification_code(
  target_claim_id uuid
)
returns text
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  current_user_id uuid := auth.uid();
  claim_record public.creator_platform_account_claims%rowtype;
  next_code text;
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

  if claim_record.status in ('verified', 'revoked')
    or (
      claim_record.status = 'checking'
      and claim_record.code_expires_at > now()
    )
  then
    raise exception 'This verification code cannot be replaced.' using errcode = '22023';
  end if;

  next_code := 'GT-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));

  -- Do this before changing the claim as an explicit fence. The claim trigger
  -- repeats the cancellation safely if another active row is ever introduced.
  update public.creator_platform_verification_jobs
  set state = 'cancelled',
      completed_at = now(),
      result_code = 'code_rotated'
  where claim_id = claim_record.id
    and state in ('queued', 'leased', 'retry');

  update public.creator_platform_account_claims
  set bio_code = next_code,
      code_issued_at = now(),
      code_expires_at = now() + interval '7 days',
      status = 'pending_code',
      last_check_requested_at = null,
      last_checked_at = null,
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
    'code_rotated',
    jsonb_build_object('cancelled_active_work', true)
  );

  return next_code;
end;
$$;

create or replace function public.reap_creator_platform_verification_jobs(
  requested_max_jobs integer default 100
)
returns table (
  inspected_count integer,
  retry_count integer,
  failed_count integer,
  cancelled_count integer
)
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  candidate_record record;
  job_record public.creator_platform_verification_jobs%rowtype;
  claim_record public.creator_platform_account_claims%rowtype;
  inspected_total integer := 0;
  retry_total integer := 0;
  failed_total integer := 0;
  cancelled_total integer := 0;
begin
  perform public.creator_require_service_role();

  if requested_max_jobs is null or requested_max_jobs not between 1 and 500 then
    raise exception 'Reap limit must be between 1 and 500.' using errcode = '22023';
  end if;

  for candidate_record in
    select
      verification_job.id,
      verification_job.claim_id
    from public.creator_platform_verification_jobs verification_job
    join public.creator_platform_account_claims claim_record
      on claim_record.id = verification_job.claim_id
    where verification_job.state in ('queued', 'leased', 'retry')
      and (
        claim_record.status <> 'checking'
        or claim_record.code_expires_at <= now()
        or verification_job.attempt_count >= verification_job.max_attempts
        or (
          verification_job.state = 'leased'
          and verification_job.lease_expires_at <= now()
        )
    )
    order by verification_job.created_at
    limit requested_max_jobs
  loop
    -- Lock claims before jobs, matching staff-review and completion lock order.
    -- A second reaper may have selected the same candidate; the state is
    -- rechecked after both locks are held.
    select * into claim_record
    from public.creator_platform_account_claims
    where id = candidate_record.claim_id
    for update;

    if claim_record.id is null then
      continue;
    end if;

    select * into job_record
    from public.creator_platform_verification_jobs
    where id = candidate_record.id and claim_id = candidate_record.claim_id
    for update;

    if job_record.id is null
      or job_record.state not in ('queued', 'leased', 'retry')
      or not (
        claim_record.status <> 'checking'
        or claim_record.code_expires_at <= now()
        or job_record.attempt_count >= job_record.max_attempts
        or (
          job_record.state = 'leased'
          and job_record.lease_expires_at <= now()
        )
      )
    then
      continue;
    end if;

    inspected_total := inspected_total + 1;

    if claim_record.status <> 'checking' then
      update public.creator_platform_verification_jobs
      set state = 'cancelled',
          completed_at = now(),
          result_code = 'claim_unavailable'
      where id = job_record.id;
      cancelled_total := cancelled_total + 1;
    elsif claim_record.code_expires_at <= now() then
      update public.creator_platform_verification_jobs
      set state = 'failed',
          completed_at = now(),
          result_code = 'code_expired'
      where id = job_record.id;

      update public.creator_platform_account_claims
      set status = 'needs_attention',
          last_checked_at = now(),
          last_error_code = 'code_expired',
          creator_message = 'Your verification code expired. Replace it and request a new check.'
      where id = claim_record.id and status = 'checking';
      failed_total := failed_total + 1;
    elsif job_record.attempt_count >= job_record.max_attempts then
      update public.creator_platform_verification_jobs
      set state = 'failed',
          completed_at = now(),
          result_code = 'attempt_limit_exhausted'
      where id = job_record.id;

      update public.creator_platform_account_claims
      set status = 'needs_attention',
          last_checked_at = now(),
          last_error_code = 'attempt_limit_exhausted',
          creator_message = 'Automatic verification could not finish. Staff can review this account.'
      where id = claim_record.id and status = 'checking';
      failed_total := failed_total + 1;
    else
      update public.creator_platform_verification_jobs
      set state = 'retry',
          available_at = now(),
          completed_at = null,
          result_code = 'lease_expired'
      where id = job_record.id;

      update public.creator_platform_account_claims
      set last_checked_at = now(),
          last_error_code = 'lease_expired',
          creator_message = null
      where id = claim_record.id and status = 'checking';
      retry_total := retry_total + 1;
    end if;

    insert into public.creator_platform_verification_events (
      claim_id,
      event_type,
      metadata
    ) values (
      claim_record.id,
      'job_reaped',
      jsonb_build_object(
        'job_id', job_record.id,
        'prior_state', job_record.state,
        'attempt_count', job_record.attempt_count
      )
    );
  end loop;

  return query select inspected_total, retry_total, failed_total, cancelled_total;
end;
$$;

create or replace function public.lease_creator_platform_verification_jobs(
  worker_id text,
  requested_max_jobs integer default 10,
  requested_lease_seconds integer default 120
)
returns table (
  job_id uuid,
  claim_id uuid,
  lease_token uuid,
  attempt_number integer,
  platform text,
  entered_handle text,
  normalized_handle text,
  bio_code text,
  code_expires_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, extensions, public, auth, pg_temp
as $$
begin
  perform public.creator_require_service_role();

  if worker_id !~ '^[a-z0-9][a-z0-9._-]{2,63}$'
    or requested_max_jobs is null
    or requested_max_jobs not between 1 and 25
    or requested_lease_seconds is null
    or requested_lease_seconds not between 30 and 300
  then
    raise exception 'Verification lease request is invalid.' using errcode = '22023';
  end if;

  perform * from public.reap_creator_platform_verification_jobs(
    least(500, greatest(25, requested_max_jobs * 4))
  );

  return query
  with candidates as (
    select verification_job.id
    from public.creator_platform_verification_jobs verification_job
    join public.creator_platform_account_claims claim_record
      on claim_record.id = verification_job.claim_id
    where verification_job.state in ('queued', 'retry')
      and verification_job.available_at <= now()
      and verification_job.attempt_count < verification_job.max_attempts
      and claim_record.status = 'checking'
      and claim_record.code_expires_at > now()
    order by verification_job.available_at, verification_job.created_at
    for update of verification_job skip locked
    limit requested_max_jobs
  ), leased as (
    update public.creator_platform_verification_jobs verification_job
    set state = 'leased',
        attempt_count = verification_job.attempt_count + 1,
        leased_at = now(),
        lease_expires_at = now() + make_interval(secs => requested_lease_seconds),
        leased_by = worker_id,
        lease_token = gen_random_uuid(),
        claim_code_issued_at = claim_record.code_issued_at,
        claim_code_sha256 = encode(
          digest(convert_to(claim_record.bio_code, 'UTF8'), 'sha256'),
          'hex'
        ),
        result_code = null,
        completed_at = null
    from candidates, public.creator_platform_account_claims claim_record
    where verification_job.id = candidates.id
      and claim_record.id = verification_job.claim_id
    returning
      verification_job.id,
      verification_job.claim_id,
      verification_job.lease_token,
      verification_job.attempt_count,
      claim_record.platform,
      claim_record.entered_handle,
      claim_record.normalized_handle,
      claim_record.bio_code,
      claim_record.code_expires_at
  )
  select * from leased;
end;
$$;

create or replace function public.complete_creator_platform_verification_job(
  target_job_id uuid,
  target_lease_token uuid,
  result_input jsonb
)
returns table (
  accepted boolean,
  final_state text,
  result_code text
)
language plpgsql
security definer
set search_path = pg_catalog, extensions, public, auth, pg_temp
as $$
declare
  job_record public.creator_platform_verification_jobs%rowtype;
  claim_record public.creator_platform_account_claims%rowtype;
  preliminary_claim_id uuid;
  worker_outcome text := lower(btrim(coalesce(result_input->>'outcome', '')));
  failure_code text := lower(btrim(coalesce(result_input->>'failureCode', '')));
  native_id text := btrim(coalesce(result_input->>'nativeAccountId', ''));
  evidence_reference text := btrim(coalesce(result_input->>'evidenceReference', ''));
  observed_bio_sha256 text := lower(btrim(coalesce(result_input->>'observedBioSha256', '')));
  observed_at timestamptz;
  evidence_hash text;
  canonical_account_id uuid;
  creator_message_text text;
begin
  perform public.creator_require_service_role();

  select verification_job.claim_id into preliminary_claim_id
  from public.creator_platform_verification_jobs
  where id = target_job_id;

  if preliminary_claim_id is null then
    return query select false, 'missing'::text, 'job_not_found'::text;
    return;
  end if;

  -- Staff review locks the claim before touching its jobs. Use the same order
  -- here so a reviewer and a worker cannot deadlock each other.
  select * into claim_record
  from public.creator_platform_account_claims
  where id = preliminary_claim_id
  for update;

  select * into job_record
  from public.creator_platform_verification_jobs
  where id = target_job_id and claim_id = preliminary_claim_id
  for update;

  if job_record.id is null or claim_record.id is null then
    return query select false, 'missing'::text, 'job_not_found'::text;
    return;
  end if;

  -- A repeated delivery of the same fenced terminal receipt is idempotent.
  if job_record.state in ('succeeded', 'failed')
    and job_record.lease_token = target_lease_token
  then
    return query select true, job_record.state, job_record.result_code;
    return;
  end if;

  if job_record.state <> 'leased'
    or job_record.lease_token is distinct from target_lease_token
    or job_record.lease_expires_at <= now()
  then
    return query select false, job_record.state, 'stale_lease'::text;
    return;
  end if;

  if claim_record.status <> 'checking'
    or claim_record.code_expires_at <= now()
    or claim_record.code_issued_at is distinct from job_record.claim_code_issued_at
    or encode(
      digest(convert_to(claim_record.bio_code, 'UTF8'), 'sha256'),
      'hex'
    ) is distinct from job_record.claim_code_sha256
  then
    update public.creator_platform_verification_jobs
    set state = 'cancelled',
        completed_at = now(),
        result_code = 'claim_fence_changed'
    where id = job_record.id;
    return query select false, 'cancelled'::text, 'claim_fence_changed'::text;
    return;
  end if;

  if worker_outcome = 'verified' then
    if char_length(native_id) not between 1 and 191
      or native_id ~ '[[:cntrl:]]'
    then
      raise exception 'A stable native account ID is required.' using errcode = '22023';
    end if;

    if result_input->'codeMatched' is distinct from 'true'::jsonb
      or observed_bio_sha256 !~ '^[a-f0-9]{64}$'
      or char_length(evidence_reference) not between 8 and 2000
      or evidence_reference ~ '[[:cntrl:]]'
    then
      raise exception 'Bio-code evidence is invalid.' using errcode = '22023';
    end if;

    begin
      observed_at := nullif(result_input->>'observedAt', '')::timestamptz;
    exception when others then
      raise exception 'Evidence time is invalid.' using errcode = '22023';
    end;

    if observed_at is null
      or observed_at < claim_record.code_issued_at
      or observed_at > claim_record.code_expires_at
      or observed_at > now() + interval '5 minutes'
    then
      raise exception 'Evidence time is outside the active code window.' using errcode = '22023';
    end if;

    evidence_hash := encode(
      digest(
        convert_to(
          concat_ws(
            ':',
            'bio_code_worker_v1',
            claim_record.platform,
            native_id,
            claim_record.bio_code,
            observed_bio_sha256,
            evidence_reference,
            observed_at::text,
            job_record.leased_by
          ),
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    );

    -- Stable provider-native identities are global. Check both the canonical
    -- identity table and an already-promoted claim before changing either.
    if exists (
      select 1
      from public.creator_platform_accounts canonical_account
      where canonical_account.platform = claim_record.platform
        and canonical_account.native_account_id = native_id
        and canonical_account.account_id <> claim_record.account_id
    ) or exists (
      select 1
      from public.creator_platform_account_claims other_claim
      where other_claim.id <> claim_record.id
        and other_claim.platform = claim_record.platform
        and other_claim.native_account_id = native_id
        and other_claim.status = 'verified'
    ) then
      update public.creator_platform_verification_jobs
      set state = 'failed',
          completed_at = now(),
          result_code = 'native_identity_conflict',
          result_native_account_id = native_id,
          result_evidence_sha256 = evidence_hash
      where id = job_record.id;

      update public.creator_platform_account_claims
      set status = 'needs_attention',
          last_checked_at = now(),
          last_error_code = 'native_identity_conflict',
          creator_message = 'This account needs staff review before it can be linked.'
      where id = claim_record.id and status = 'checking';

      insert into public.creator_platform_verification_events (
        claim_id,
        event_type,
        metadata
      ) values (
        claim_record.id,
        'verification_identity_conflict',
        jsonb_build_object(
          'job_id', job_record.id,
          'worker_id', job_record.leased_by,
          'native_account_id', native_id,
          'evidence_sha256', evidence_hash
        )
      );

      return query select true, 'failed'::text, 'native_identity_conflict'::text;
      return;
    end if;

    -- Updating a canonical identity is allowed only when it already belongs to
    -- this creator. A concurrent conflicting insert produces no returned row.
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
      native_id,
      claim_record.entered_handle,
      claim_record.normalized_handle,
      'bio_code_worker_v1',
      evidence_hash,
      observed_at,
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
    returning public.creator_platform_accounts.id into canonical_account_id;

    if canonical_account_id is null then
      update public.creator_platform_verification_jobs
      set state = 'failed',
          completed_at = now(),
          result_code = 'native_identity_conflict',
          result_native_account_id = native_id,
          result_evidence_sha256 = evidence_hash
      where id = job_record.id;

      update public.creator_platform_account_claims
      set status = 'needs_attention',
          last_checked_at = now(),
          last_error_code = 'native_identity_conflict',
          creator_message = 'This account needs staff review before it can be linked.'
      where id = claim_record.id and status = 'checking';

      insert into public.creator_platform_verification_events (
        claim_id,
        event_type,
        metadata
      ) values (
        claim_record.id,
        'verification_identity_conflict',
        jsonb_build_object(
          'job_id', job_record.id,
          'worker_id', job_record.leased_by,
          'native_account_id', native_id,
          'evidence_sha256', evidence_hash
        )
      );

      return query select true, 'failed'::text, 'native_identity_conflict'::text;
      return;
    end if;

    update public.creator_platform_verification_jobs
    set state = 'succeeded',
        completed_at = now(),
        result_code = 'verified_machine',
        result_native_account_id = native_id,
        result_evidence_sha256 = evidence_hash
    where id = job_record.id;

    update public.creator_platform_account_claims
    set status = 'verified',
        native_account_id = native_id,
        ownership_evidence_sha256 = evidence_hash,
        ownership_verified_at = observed_at,
        verified_by = null,
        last_checked_at = now(),
        last_error_code = null,
        creator_message = null
    where id = claim_record.id and status = 'checking';

    insert into public.creator_platform_verification_events (
      claim_id,
      event_type,
      metadata
    ) values (
      claim_record.id,
      'verified_machine',
      jsonb_build_object(
        'job_id', job_record.id,
        'worker_id', job_record.leased_by,
        'native_account_id', native_id,
        'evidence_sha256', evidence_hash,
        'observed_at', observed_at
      )
    );

    return query select true, 'succeeded'::text, 'verified_machine'::text;
    return;
  end if;

  if worker_outcome <> 'failed' or failure_code not in (
    'account_not_found',
    'bio_code_missing',
    'profile_private',
    'handle_mismatch',
    'native_id_missing',
    'unsupported_platform'
  ) then
    raise exception 'Verification completion outcome is invalid.' using errcode = '22023';
  end if;

  creator_message_text := case failure_code
    when 'account_not_found' then 'We could not find this account. Check the handle and try again.'
    when 'bio_code_missing' then 'We found the account, but the current verification code was not in its public bio.'
    when 'profile_private' then 'The account must be public while ownership is checked.'
    when 'handle_mismatch' then 'The provider returned a different account for this handle. Staff can review it.'
    when 'native_id_missing' then 'The provider did not return a stable account ID. Staff can review it.'
    else 'Automatic verification is not supported for this account. Staff can review it.'
  end;

  update public.creator_platform_verification_jobs
  set state = 'failed',
      completed_at = now(),
      result_code = failure_code
  where id = job_record.id;

  update public.creator_platform_account_claims
  set status = 'needs_attention',
      last_checked_at = now(),
      last_error_code = failure_code,
      creator_message = creator_message_text
  where id = claim_record.id and status = 'checking';

  insert into public.creator_platform_verification_events (
    claim_id,
    event_type,
    metadata
  ) values (
    claim_record.id,
    'verification_failed_machine',
    jsonb_build_object(
      'job_id', job_record.id,
      'worker_id', job_record.leased_by,
      'failure_code', failure_code
    )
  );

  return query select true, 'failed'::text, failure_code;
end;
$$;

create or replace function public.retry_creator_platform_verification_job(
  target_job_id uuid,
  target_lease_token uuid,
  retry_input jsonb
)
returns table (
  accepted boolean,
  final_state text,
  result_code text,
  available_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, extensions, public, auth, pg_temp
as $$
declare
  job_record public.creator_platform_verification_jobs%rowtype;
  claim_record public.creator_platform_account_claims%rowtype;
  preliminary_claim_id uuid;
  failure_code text := lower(btrim(coalesce(retry_input->>'failureCode', '')));
  backoff_seconds integer;
  scheduled_at timestamptz;
begin
  perform public.creator_require_service_role();

  if failure_code not in (
    'provider_rate_limited',
    'provider_unavailable',
    'provider_authentication_failed',
    'network_error',
    'provider_response_invalid'
  ) then
    raise exception 'Verification retry code is invalid.' using errcode = '22023';
  end if;

  begin
    backoff_seconds := (retry_input->>'backoffSeconds')::integer;
  exception when others then
    raise exception 'Verification retry delay is invalid.' using errcode = '22023';
  end;
  if backoff_seconds is null or backoff_seconds not between 30 and 21600 then
    raise exception 'Verification retry delay is invalid.' using errcode = '22023';
  end if;

  select verification_job.claim_id into preliminary_claim_id
  from public.creator_platform_verification_jobs
  where id = target_job_id;

  if preliminary_claim_id is null then
    return query select false, 'missing'::text, 'job_not_found'::text, null::timestamptz;
    return;
  end if;

  select * into claim_record
  from public.creator_platform_account_claims
  where id = preliminary_claim_id
  for update;

  select * into job_record
  from public.creator_platform_verification_jobs
  where id = target_job_id and claim_id = preliminary_claim_id
  for update;

  if job_record.id is null or claim_record.id is null then
    return query select false, 'missing'::text, 'job_not_found'::text, null::timestamptz;
    return;
  end if;

  if job_record.state = 'retry'
    and job_record.lease_token = target_lease_token
    and job_record.result_code = failure_code
  then
    return query select true, 'retry'::text, failure_code, job_record.available_at;
    return;
  end if;

  if job_record.state <> 'leased'
    or job_record.lease_token is distinct from target_lease_token
    or job_record.lease_expires_at <= now()
  then
    return query select false, job_record.state, 'stale_lease'::text, job_record.available_at;
    return;
  end if;

  if claim_record.status <> 'checking'
    or claim_record.code_expires_at <= now()
    or claim_record.code_issued_at is distinct from job_record.claim_code_issued_at
    or encode(
      digest(convert_to(claim_record.bio_code, 'UTF8'), 'sha256'),
      'hex'
    ) is distinct from job_record.claim_code_sha256
  then
    update public.creator_platform_verification_jobs
    set state = 'cancelled',
        completed_at = now(),
        result_code = 'claim_fence_changed'
    where id = job_record.id;
    return query select false, 'cancelled'::text, 'claim_fence_changed'::text, null::timestamptz;
    return;
  end if;

  if job_record.attempt_count >= job_record.max_attempts then
    update public.creator_platform_verification_jobs
    set state = 'failed',
        completed_at = now(),
        result_code = 'attempt_limit_exhausted'
    where id = job_record.id;

    update public.creator_platform_account_claims
    set status = 'needs_attention',
        last_checked_at = now(),
        last_error_code = 'attempt_limit_exhausted',
        creator_message = 'Automatic verification could not finish. Staff can review this account.'
    where id = claim_record.id and status = 'checking';

    return query
    select true, 'failed'::text, 'attempt_limit_exhausted'::text, null::timestamptz;
    return;
  end if;

  scheduled_at := now() + make_interval(secs => backoff_seconds);
  update public.creator_platform_verification_jobs
  set state = 'retry',
      available_at = scheduled_at,
      completed_at = null,
      result_code = failure_code
  where id = job_record.id;

  update public.creator_platform_account_claims
  set last_checked_at = now(),
      last_error_code = failure_code,
      creator_message = null
  where id = claim_record.id and status = 'checking';

  insert into public.creator_platform_verification_events (
    claim_id,
    event_type,
    metadata
  ) values (
    claim_record.id,
    'verification_retry_scheduled',
    jsonb_build_object(
      'job_id', job_record.id,
      'worker_id', job_record.leased_by,
      'failure_code', failure_code,
      'available_at', scheduled_at,
      'attempt_count', job_record.attempt_count
    )
  );

  return query select true, 'retry'::text, failure_code, scheduled_at;
end;
$$;

revoke execute on function public.consume_creator_platform_verification_worker_request(
  text, uuid, timestamptz, text
) from public, anon, authenticated;
grant execute on function public.consume_creator_platform_verification_worker_request(
  text, uuid, timestamptz, text
) to service_role;

revoke execute on function public.cancel_creator_platform_verification_work()
from public, anon, authenticated;

revoke execute on function public.reap_creator_platform_verification_jobs(integer)
from public, anon, authenticated;
grant execute on function public.reap_creator_platform_verification_jobs(integer)
to service_role;

revoke execute on function public.lease_creator_platform_verification_jobs(text, integer, integer)
from public, anon, authenticated;
grant execute on function public.lease_creator_platform_verification_jobs(text, integer, integer)
to service_role;

revoke execute on function public.complete_creator_platform_verification_job(uuid, uuid, jsonb)
from public, anon, authenticated;
grant execute on function public.complete_creator_platform_verification_job(uuid, uuid, jsonb)
to service_role;

revoke execute on function public.retry_creator_platform_verification_job(uuid, uuid, jsonb)
from public, anon, authenticated;
grant execute on function public.retry_creator_platform_verification_job(uuid, uuid, jsonb)
to service_role;

comment on table public.creator_platform_verification_worker_requests is
  'Single-use request nonces for the signed, provider-neutral account-verification worker API.';

comment on function public.lease_creator_platform_verification_jobs(text, integer, integer) is
  'Service-only SKIP LOCKED lease. Each token is fenced to one claim bio-code issuance.';

comment on function public.complete_creator_platform_verification_job(uuid, uuid, jsonb) is
  'Service-only idempotent completion. Machine verification requires a stable native ID and hashed bio-code evidence; staff and code-rotation decisions remain authoritative.';
