-- Creator content attribution and finance ledger foundation.
--
-- Creator submissions are claims, not proof. A submission becomes a canonical
-- post only after a reviewer/service-role match. Provider identities and
-- observation pointers are first-class so the in-house tracker can attach
-- evidence later without rewriting creator-entered history.
--
-- Money uses integer minor units. Earning and settlement amounts are immutable;
-- only guarded, forward-only state transitions are allowed. This migration does
-- not initiate payouts and must not be interpreted as proof of payment.

create extension if not exists pgcrypto;

create or replace function public.creator_content_require_staff(
  require_admin boolean default false
)
returns uuid
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
declare
  actor_id uuid := auth.uid();
begin
  if coalesce(auth.role(), '') = 'service_role' then
    return actor_id;
  end if;

  if actor_id is null or not exists (
    select 1
    from public.staff_members staff
    where staff.auth_user_id = actor_id
      and staff.active
      and (
        (require_admin and staff.role = 'admin')
        or (not require_admin and staff.role in ('reviewer', 'admin'))
      )
  ) then
    raise exception 'Staff access required.' using errcode = '42501';
  end if;

  return actor_id;
end;
$$;

create table public.creator_posts (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.creator_accounts(auth_user_id) on delete cascade,
  platform_account_id uuid references public.creator_platform_accounts(id) on delete set null,
  platform text not null check (platform in ('TIKTOK', 'INSTAGRAM_REELS')),
  native_post_id text check (
    native_post_id is null or char_length(native_post_id) between 1 and 191
  ),
  canonical_url text check (
    canonical_url is null or (
      char_length(canonical_url) between 12 and 2048
      and canonical_url ~* '^https://'
    )
  ),
  published_at timestamptz,
  first_seen_at timestamptz not null default now(),
  attribution_state text not null default 'creator_claimed' check (
    attribution_state in ('unattributed', 'creator_claimed', 'verified', 'disputed')
  ),
  attribution_method text not null check (
    attribution_method in ('submission', 'provider_discovery', 'manual', 'import')
  ),
  attributed_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (native_post_id is not null or canonical_url is not null)
);

create unique index creator_posts_native_identity
  on public.creator_posts (platform, native_post_id)
  where native_post_id is not null;

create unique index creator_posts_canonical_url_identity
  on public.creator_posts (platform, canonical_url)
  where canonical_url is not null;

create index creator_posts_account_published
  on public.creator_posts (account_id, published_at desc nulls last, created_at desc);

create table public.creator_content_submissions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.creator_accounts(auth_user_id) on delete cascade,
  enrollment_id uuid not null references public.creator_enrollments(id) on delete restrict,
  platform_account_id uuid references public.creator_platform_accounts(id) on delete set null,
  platform text not null check (platform in ('TIKTOK', 'INSTAGRAM_REELS')),
  submitted_url text not null check (
    char_length(submitted_url) between 12 and 2048
    and submitted_url ~* '^https://'
  ),
  declared_native_post_id text check (
    declared_native_post_id is null
    or char_length(declared_native_post_id) between 1 and 191
  ),
  creator_note text check (
    creator_note is null or char_length(creator_note) <= 1000
  ),
  match_state text not null default 'submitted' check (
    match_state in (
      'submitted',
      'matching',
      'matched',
      'needs_review',
      'rejected',
      'withdrawn'
    )
  ),
  matched_post_id uuid references public.creator_posts(id) on delete restrict,
  submitted_at timestamptz not null default now(),
  matched_at timestamptz,
  matched_by uuid references auth.users(id) on delete set null,
  review_note text check (review_note is null or char_length(review_note) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, submitted_url),
  check (
    (match_state = 'matched' and matched_post_id is not null and matched_at is not null)
    or (match_state <> 'matched')
  )
);

create index creator_content_submissions_account_recent
  on public.creator_content_submissions (account_id, submitted_at desc);

create index creator_content_submissions_review_queue
  on public.creator_content_submissions (match_state, submitted_at)
  where match_state in ('submitted', 'matching', 'needs_review');

create table public.creator_content_submission_events (
  id bigint generated always as identity primary key,
  submission_id uuid not null references public.creator_content_submissions(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  event_type text not null check (
    char_length(event_type) between 2 and 80
    and event_type ~ '^[a-z][a-z0-9._-]*$'
  ),
  metadata jsonb not null default '{}'::jsonb check (
    jsonb_typeof(metadata) = 'object' and pg_column_size(metadata) <= 16384
  ),
  created_at timestamptz not null default now()
);

create table public.creator_post_provider_identities (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.creator_posts(id) on delete cascade,
  provider text not null check (
    char_length(provider) between 2 and 80
    and provider ~ '^[a-z][a-z0-9._-]*$'
  ),
  external_post_id text not null check (char_length(external_post_id) between 1 and 191),
  external_account_id text check (
    external_account_id is null or char_length(external_account_id) between 1 and 191
  ),
  identity_kind text not null default 'provider' check (
    identity_kind in ('native', 'provider', 'tracker', 'import')
  ),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (provider, external_post_id)
);

create index creator_post_provider_identities_post
  on public.creator_post_provider_identities (post_id);

create table public.creator_post_observations (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.creator_posts(id) on delete cascade,
  provider_identity_id uuid references public.creator_post_provider_identities(id) on delete set null,
  source_system text not null check (
    char_length(source_system) between 2 and 80
    and source_system ~ '^[a-z][a-z0-9._-]*$'
  ),
  external_observation_id text not null check (
    char_length(external_observation_id) between 1 and 191
  ),
  external_run_id text check (
    external_run_id is null or char_length(external_run_id) between 1 and 191
  ),
  observed_at timestamptz not null,
  view_count bigint check (view_count is null or view_count >= 0),
  like_count bigint check (like_count is null or like_count >= 0),
  comment_count bigint check (comment_count is null or comment_count >= 0),
  share_count bigint check (share_count is null or share_count >= 0),
  raw_archive_ref text check (
    raw_archive_ref is null or char_length(raw_archive_ref) <= 1024
  ),
  payload_sha256 text check (
    payload_sha256 is null or payload_sha256 ~ '^[a-f0-9]{64}$'
  ),
  recorded_at timestamptz not null default now(),
  unique (source_system, external_observation_id)
);

create index creator_post_observations_post_recent
  on public.creator_post_observations (post_id, observed_at desc);

create table public.creator_earning_entries (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.creator_accounts(auth_user_id) on delete restrict,
  enrollment_id uuid not null references public.creator_enrollments(id) on delete restrict,
  post_id uuid references public.creator_posts(id) on delete restrict,
  source_key text not null unique check (char_length(source_key) between 2 and 191),
  category text not null check (
    char_length(category) between 2 and 80
    and category ~ '^[a-z][a-z0-9._-]*$'
  ),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  currency_exponent smallint not null default 2 check (currency_exponent between 0 and 4),
  amount_minor bigint not null check (amount_minor <> 0),
  state text not null default 'estimated' check (
    state in ('estimated', 'pending', 'approved', 'paid', 'reconciled')
  ),
  period_start date,
  period_end date,
  earned_at timestamptz not null,
  calculation_basis jsonb not null default '{}'::jsonb check (
    jsonb_typeof(calculation_basis) = 'object'
    and pg_column_size(calculation_basis) <= 32768
  ),
  supersedes_entry_id uuid references public.creator_earning_entries(id) on delete restrict,
  approved_at timestamptz,
  paid_at timestamptz,
  reconciled_at timestamptz,
  external_reference text check (
    external_reference is null or char_length(external_reference) <= 191
  ),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (period_end is null or period_start is null or period_end >= period_start),
  check (state not in ('approved', 'paid', 'reconciled') or approved_at is not null),
  check (state not in ('paid', 'reconciled') or paid_at is not null),
  check (state not in ('paid', 'reconciled') or external_reference is not null),
  check (state <> 'reconciled' or reconciled_at is not null)
);

create unique index creator_earning_entries_one_superseding_entry
  on public.creator_earning_entries (supersedes_entry_id)
  where supersedes_entry_id is not null;

create index creator_earning_entries_account_earned
  on public.creator_earning_entries (account_id, earned_at desc);

create index creator_earning_entries_open_state
  on public.creator_earning_entries (state, earned_at)
  where state in ('estimated', 'pending', 'approved', 'paid');

create table public.creator_earning_state_events (
  id bigint generated always as identity primary key,
  earning_entry_id uuid not null references public.creator_earning_entries(id) on delete restrict,
  from_state text check (
    from_state is null or from_state in ('estimated', 'pending', 'approved', 'paid', 'reconciled')
  ),
  to_state text not null check (
    to_state in ('estimated', 'pending', 'approved', 'paid', 'reconciled')
  ),
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_role text,
  reason text check (reason is null or char_length(reason) <= 1000),
  external_reference text check (
    external_reference is null or char_length(external_reference) <= 191
  ),
  created_at timestamptz not null default now()
);

create table public.creator_settlements (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.creator_accounts(auth_user_id) on delete restrict,
  enrollment_id uuid not null references public.creator_enrollments(id) on delete restrict,
  idempotency_key text not null unique check (char_length(idempotency_key) between 2 and 191),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  currency_exponent smallint not null check (currency_exponent between 0 and 4),
  total_minor bigint not null check (total_minor > 0),
  state text not null default 'pending' check (
    state in ('pending', 'approved', 'paid', 'reconciled')
  ),
  period_start date,
  period_end date,
  payout_provider text check (
    payout_provider is null or (
      char_length(payout_provider) between 2 and 80
      and payout_provider ~ '^[a-z][a-z0-9._-]*$'
    )
  ),
  external_payout_id text check (
    external_payout_id is null or char_length(external_payout_id) <= 191
  ),
  approved_at timestamptz,
  paid_at timestamptz,
  reconciled_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (period_end is null or period_start is null or period_end >= period_start),
  check (state not in ('approved', 'paid', 'reconciled') or approved_at is not null),
  check (state not in ('paid', 'reconciled') or paid_at is not null),
  check (state <> 'reconciled' or reconciled_at is not null),
  check (
    state not in ('paid', 'reconciled')
    or (payout_provider is not null and external_payout_id is not null)
  )
);

create index creator_settlements_account_created
  on public.creator_settlements (account_id, created_at desc);

create table public.creator_settlement_lines (
  settlement_id uuid not null references public.creator_settlements(id) on delete restrict,
  earning_entry_id uuid not null unique references public.creator_earning_entries(id) on delete restrict,
  amount_minor bigint not null check (amount_minor <> 0),
  created_at timestamptz not null default now(),
  primary key (settlement_id, earning_entry_id)
);

create table public.creator_settlement_state_events (
  id bigint generated always as identity primary key,
  settlement_id uuid not null references public.creator_settlements(id) on delete restrict,
  from_state text check (
    from_state is null or from_state in ('pending', 'approved', 'paid', 'reconciled')
  ),
  to_state text not null check (
    to_state in ('pending', 'approved', 'paid', 'reconciled')
  ),
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_role text,
  reason text check (reason is null or char_length(reason) <= 1000),
  created_at timestamptz not null default now()
);

create trigger creator_posts_touch_updated_at
before update on public.creator_posts
for each row execute function public.creator_touch_updated_at();

create trigger creator_content_submissions_touch_updated_at
before update on public.creator_content_submissions
for each row execute function public.creator_touch_updated_at();

create trigger creator_earning_entries_touch_updated_at
before update on public.creator_earning_entries
for each row execute function public.creator_touch_updated_at();

create trigger creator_settlements_touch_updated_at
before update on public.creator_settlements
for each row execute function public.creator_touch_updated_at();

create or replace function public.creator_guard_earning_entry()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Earning ledger entries cannot be deleted.';
  end if;

  if (to_jsonb(new) - array[
    'state', 'approved_at', 'paid_at', 'reconciled_at',
    'external_reference', 'updated_at'
  ]) is distinct from (to_jsonb(old) - array[
    'state', 'approved_at', 'paid_at', 'reconciled_at',
    'external_reference', 'updated_at'
  ]) then
    raise exception 'Earning facts are immutable; create a superseding entry.';
  end if;

  if old.external_reference is not null
    and new.external_reference is distinct from old.external_reference then
    raise exception 'Earning provider evidence is write-once.' using errcode = '22023';
  end if;

  if old.external_reference is null
    and new.external_reference is not null
    and new.state not in ('paid', 'reconciled') then
    raise exception 'Earning provider evidence requires a paid or reconciled state.'
      using errcode = '22023';
  end if;

  if new.state = old.state then
    return new;
  end if;

  if new.state in ('paid', 'reconciled') and exists (
    select 1
    from public.creator_settlement_lines line
    where line.earning_entry_id = old.id
      and line.settlement_id::text is distinct from nullif(
        current_setting('creator.settlement_transition_id', true),
        ''
      )
  ) then
    raise exception 'Settled earnings can be advanced only by their owning settlement.'
      using errcode = '22023';
  end if;

  if not (
    (old.state = 'estimated' and new.state = 'pending')
    or (old.state = 'pending' and new.state = 'approved')
    or (old.state = 'approved' and new.state = 'paid')
    or (old.state = 'paid' and new.state = 'reconciled')
  ) then
    raise exception 'Invalid earning state transition from % to %.', old.state, new.state
      using errcode = '22023';
  end if;

  if new.state = 'approved' then new.approved_at := coalesce(new.approved_at, now()); end if;
  if new.state = 'paid' then new.paid_at := coalesce(new.paid_at, now()); end if;
  if new.state = 'reconciled' then new.reconciled_at := coalesce(new.reconciled_at, now()); end if;
  return new;
end;
$$;

create trigger creator_guard_earning_entry
before update or delete on public.creator_earning_entries
for each row execute function public.creator_guard_earning_entry();

create or replace function public.creator_record_earning_state_event()
returns trigger
language plpgsql
set search_path = public, auth, pg_temp
as $$
begin
  if tg_op = 'INSERT' or new.state is distinct from old.state then
    insert into public.creator_earning_state_events (
      earning_entry_id,
      from_state,
      to_state,
      actor_user_id,
      actor_role,
      reason,
      external_reference
    ) values (
      new.id,
      case when tg_op = 'INSERT' then null else old.state end,
      new.state,
      auth.uid(),
      auth.role(),
      nullif(current_setting('creator.transition_reason', true), ''),
      new.external_reference
    );
  end if;
  return new;
end;
$$;

create trigger creator_record_earning_state_event
after insert or update on public.creator_earning_entries
for each row execute function public.creator_record_earning_state_event();

create or replace function public.creator_guard_settlement()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Settlements cannot be deleted.';
  end if;

  if (to_jsonb(new) - array[
    'state', 'approved_at', 'paid_at', 'reconciled_at',
    'payout_provider', 'external_payout_id', 'updated_at'
  ]) is distinct from (to_jsonb(old) - array[
    'state', 'approved_at', 'paid_at', 'reconciled_at',
    'payout_provider', 'external_payout_id', 'updated_at'
  ]) then
    raise exception 'Settlement facts are immutable.';
  end if;

  if old.payout_provider is not null
    and new.payout_provider is distinct from old.payout_provider then
    raise exception 'Settlement payout provider evidence is write-once.' using errcode = '22023';
  end if;

  if old.external_payout_id is not null
    and new.external_payout_id is distinct from old.external_payout_id then
    raise exception 'Settlement payout ID evidence is write-once.' using errcode = '22023';
  end if;

  if (
    (old.payout_provider is null and new.payout_provider is not null)
    or (old.external_payout_id is null and new.external_payout_id is not null)
  ) and new.state not in ('paid', 'reconciled') then
    raise exception 'Settlement payout evidence requires a paid or reconciled state.'
      using errcode = '22023';
  end if;

  if new.state = old.state then
    return new;
  end if;

  if not (
    (old.state = 'pending' and new.state = 'approved')
    or (old.state = 'approved' and new.state = 'paid')
    or (old.state = 'paid' and new.state = 'reconciled')
  ) then
    raise exception 'Invalid settlement state transition from % to %.', old.state, new.state
      using errcode = '22023';
  end if;

  if new.state = 'approved' then new.approved_at := coalesce(new.approved_at, now()); end if;
  if new.state = 'paid' then new.paid_at := coalesce(new.paid_at, now()); end if;
  if new.state = 'reconciled' then new.reconciled_at := coalesce(new.reconciled_at, now()); end if;
  return new;
end;
$$;

create trigger creator_guard_settlement
before update or delete on public.creator_settlements
for each row execute function public.creator_guard_settlement();

create or replace function public.creator_prevent_ledger_audit_changes()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'Ledger audit events and settlement lines are append-only.';
end;
$$;

create trigger creator_guard_earning_state_events
before update or delete on public.creator_earning_state_events
for each row execute function public.creator_prevent_ledger_audit_changes();

create trigger creator_guard_settlement_lines
before update or delete on public.creator_settlement_lines
for each row execute function public.creator_prevent_ledger_audit_changes();

create trigger creator_guard_settlement_state_events
before update or delete on public.creator_settlement_state_events
for each row execute function public.creator_prevent_ledger_audit_changes();

create trigger creator_guard_content_submission_events
before update or delete on public.creator_content_submission_events
for each row execute function public.creator_prevent_ledger_audit_changes();

create trigger creator_guard_post_observations
before update or delete on public.creator_post_observations
for each row execute function public.creator_prevent_ledger_audit_changes();

create or replace function public.creator_record_settlement_state_event()
returns trigger
language plpgsql
set search_path = public, auth, pg_temp
as $$
begin
  if tg_op = 'INSERT' or new.state is distinct from old.state then
    insert into public.creator_settlement_state_events (
      settlement_id,
      from_state,
      to_state,
      actor_user_id,
      actor_role,
      reason
    ) values (
      new.id,
      case when tg_op = 'INSERT' then null else old.state end,
      new.state,
      auth.uid(),
      auth.role(),
      nullif(current_setting('creator.transition_reason', true), '')
    );
  end if;
  return new;
end;
$$;

create trigger creator_record_settlement_state_event
after insert or update on public.creator_settlements
for each row execute function public.creator_record_settlement_state_event();

create or replace function public.submit_creator_content(content_input jsonb)
returns table (submission_id uuid, match_state text)
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  current_user_id uuid := auth.uid();
  active_enrollment_id uuid;
  submitted_platform text := upper(btrim(coalesce(content_input->>'platform', '')));
  submitted_url_value text := btrim(coalesce(content_input->>'url', ''));
  submitted_native_id text := nullif(btrim(coalesce(content_input->>'nativePostId', '')), '');
  submitted_note text := nullif(btrim(coalesce(content_input->>'note', '')), '');
  submitted_platform_account_id uuid;
  new_submission_id uuid;
begin
  if current_user_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  select enrollment.id
  into active_enrollment_id
  from public.creator_enrollments enrollment
  where enrollment.account_id = current_user_id
    and enrollment.status = 'active'
  limit 1;

  if active_enrollment_id is null then
    raise exception 'An active creator enrollment is required.' using errcode = '42501';
  end if;

  if submitted_platform not in ('TIKTOK', 'INSTAGRAM_REELS') then
    raise exception 'Choose TikTok or Instagram.' using errcode = '22023';
  end if;

  if submitted_url_value !~* '^https://' or char_length(submitted_url_value) > 2048 then
    raise exception 'Enter a valid HTTPS post URL.' using errcode = '22023';
  end if;

  if submitted_platform = 'TIKTOK'
    and submitted_url_value !~* '^https://([a-z0-9-]+\.)*tiktok\.com/' then
    raise exception 'Enter a TikTok URL for a TikTok submission.' using errcode = '22023';
  end if;

  if submitted_platform = 'INSTAGRAM_REELS'
    and submitted_url_value !~* '^https://([a-z0-9-]+\.)*instagram\.com/' then
    raise exception 'Enter an Instagram URL for an Instagram submission.' using errcode = '22023';
  end if;

  if submitted_native_id is not null and (
    char_length(submitted_native_id) > 191
    or submitted_native_id !~ '^[A-Za-z0-9._:-]+$'
  ) then
    raise exception 'The native post ID is not valid.' using errcode = '22023';
  end if;

  if submitted_note is not null and char_length(submitted_note) > 1000 then
    raise exception 'The submission note is too long.' using errcode = '22023';
  end if;

  if nullif(btrim(coalesce(content_input->>'platformAccountId', '')), '') is not null then
    begin
      submitted_platform_account_id := (content_input->>'platformAccountId')::uuid;
    exception when invalid_text_representation then
      raise exception 'The creator account selection is not valid.' using errcode = '22023';
    end;

    if not exists (
      select 1
      from public.creator_platform_accounts platform_account
      where platform_account.id = submitted_platform_account_id
        and platform_account.account_id = current_user_id
        and platform_account.platform = submitted_platform
        and platform_account.status = 'verified'
    ) then
      raise exception 'That verified creator account is unavailable.' using errcode = '42501';
    end if;
  end if;

  insert into public.creator_content_submissions (
    account_id,
    enrollment_id,
    platform_account_id,
    platform,
    submitted_url,
    declared_native_post_id,
    creator_note
  ) values (
    current_user_id,
    active_enrollment_id,
    submitted_platform_account_id,
    submitted_platform,
    submitted_url_value,
    submitted_native_id,
    submitted_note
  )
  returning id into new_submission_id;

  insert into public.creator_content_submission_events (
    submission_id,
    actor_user_id,
    event_type,
    metadata
  ) values (
    new_submission_id,
    current_user_id,
    'submitted',
    jsonb_build_object(
      'platform', submitted_platform,
      'has_declared_native_id', submitted_native_id is not null,
      'has_verified_platform_account', submitted_platform_account_id is not null
    )
  );

  return query select new_submission_id, 'submitted'::text;
exception
  when unique_violation then
    raise exception 'This post URL has already been submitted.' using errcode = '23505';
end;
$$;

create or replace function public.match_creator_content_submission(
  target_submission_id uuid,
  match_input jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  staff_actor uuid;
  submission_record public.creator_content_submissions%rowtype;
  target_post_id uuid;
  requested_post_id uuid;
  target_post_record public.creator_posts%rowtype;
  native_identity_post public.creator_posts%rowtype;
  url_identity_post public.creator_posts%rowtype;
  matched_native_id text := nullif(btrim(coalesce(match_input->>'nativePostId', '')), '');
  matched_url text := nullif(btrim(coalesce(match_input->>'canonicalUrl', '')), '');
  provider_key text := lower(nullif(btrim(coalesce(match_input->>'provider', '')), ''));
  provider_post_id text := nullif(btrim(coalesce(match_input->>'providerPostId', '')), '');
  provider_account_id text := nullif(btrim(coalesce(match_input->>'providerAccountId', '')), '');
  provider_identity_result uuid;
begin
  staff_actor := public.creator_content_require_staff(false);

  select * into submission_record
  from public.creator_content_submissions submission
  where submission.id = target_submission_id
  for update;

  if not found or submission_record.match_state in ('matched', 'rejected', 'withdrawn') then
    raise exception 'Submission is not available for matching.' using errcode = '22023';
  end if;

  matched_url := coalesce(matched_url, submission_record.submitted_url);
  matched_native_id := coalesce(matched_native_id, submission_record.declared_native_post_id);

  if matched_native_id is null and matched_url is null then
    raise exception 'A native post ID or canonical URL is required.' using errcode = '22023';
  end if;
  if matched_url is not null and (
    char_length(matched_url) not between 12 and 2048
    or matched_url !~* '^https://'
  ) then
    raise exception 'The canonical post URL is not valid.' using errcode = '22023';
  end if;

  -- Staff review and tracker ingestion share this platform-scoped lock. It
  -- makes resolving a native ID plus canonical URL one atomic identity
  -- decision instead of allowing concurrent writers to create crossed pairs.
  perform pg_advisory_xact_lock(
    hashtextextended('creator-post-identity:' || submission_record.platform, 0)
  );

  select * into native_identity_post
  from public.creator_posts post
  where post.platform = submission_record.platform
    and post.native_post_id = matched_native_id
  for update;

  select * into url_identity_post
  from public.creator_posts post
  where post.platform = submission_record.platform
    and post.canonical_url = matched_url
  for update;

  if native_identity_post.id is not null
    and url_identity_post.id is not null
    and native_identity_post.id <> url_identity_post.id then
    raise exception 'The native post ID and canonical URL belong to different canonical posts.'
      using errcode = '23505';
  end if;

  if nullif(btrim(coalesce(match_input->>'postId', '')), '') is not null then
    begin
      requested_post_id := (match_input->>'postId')::uuid;
    exception when invalid_text_representation then
      raise exception 'The post selection is not valid.' using errcode = '22023';
    end;

    select * into target_post_record
    from public.creator_posts post
    where post.id = requested_post_id
      and post.account_id = submission_record.account_id
      and post.platform = submission_record.platform
    for update;

    if target_post_record.id is null then
      raise exception 'The post does not belong to this creator and platform.' using errcode = '22023';
    end if;

    if (native_identity_post.id is not null and native_identity_post.id <> target_post_record.id)
      or (url_identity_post.id is not null and url_identity_post.id <> target_post_record.id) then
      raise exception 'The selected post conflicts with the supplied native ID or canonical URL.'
        using errcode = '23505';
    end if;

    target_post_id := target_post_record.id;
  elsif native_identity_post.id is not null then
    target_post_record := native_identity_post;
    target_post_id := native_identity_post.id;
  elsif url_identity_post.id is not null then
    target_post_record := url_identity_post;
    target_post_id := url_identity_post.id;
  end if;

  if target_post_id is null then
    insert into public.creator_posts (
      account_id,
      platform_account_id,
      platform,
      native_post_id,
      canonical_url,
      published_at,
      attribution_state,
      attribution_method,
      attributed_by
    ) values (
      submission_record.account_id,
      submission_record.platform_account_id,
      submission_record.platform,
      matched_native_id,
      matched_url,
      nullif(match_input->>'publishedAt', '')::timestamptz,
      'verified',
      'manual',
      staff_actor
    ) returning * into target_post_record;

    target_post_id := target_post_record.id;
  else
    if target_post_record.account_id <> submission_record.account_id then
      raise exception 'That post identity is attributed to another creator.' using errcode = '23505';
    end if;

    if target_post_record.platform_account_id is not null
      and submission_record.platform_account_id is not null
      and target_post_record.platform_account_id <> submission_record.platform_account_id then
      raise exception 'That post identity belongs to another verified platform account.'
        using errcode = '23505';
    end if;
    if target_post_record.native_post_id is not null
      and matched_native_id is not null
      and target_post_record.native_post_id <> matched_native_id then
      raise exception 'The canonical post already has a different native post ID.'
        using errcode = '23505';
    end if;
    if target_post_record.canonical_url is not null
      and matched_url is not null
      and target_post_record.canonical_url <> matched_url then
      raise exception 'The native post ID already has a different canonical URL.'
        using errcode = '23505';
    end if;

    update public.creator_posts
    set platform_account_id = coalesce(creator_posts.platform_account_id, submission_record.platform_account_id),
        native_post_id = coalesce(creator_posts.native_post_id, matched_native_id),
        canonical_url = coalesce(creator_posts.canonical_url, matched_url),
        published_at = coalesce(
          creator_posts.published_at,
          nullif(match_input->>'publishedAt', '')::timestamptz
        ),
        attribution_state = case
          when creator_posts.attribution_state in ('unattributed', 'creator_claimed') then 'verified'
          else creator_posts.attribution_state
        end,
        attributed_by = coalesce(creator_posts.attributed_by, staff_actor),
        updated_at = now()
    where creator_posts.id = target_post_id;
  end if;

  if (provider_key is null) <> (provider_post_id is null) then
    raise exception 'Provider and provider post ID must be supplied together.' using errcode = '22023';
  end if;

  if provider_key is not null then
    if provider_key !~ '^[a-z][a-z0-9._-]{1,79}$' then
      raise exception 'Provider key is not valid.' using errcode = '22023';
    end if;

    insert into public.creator_post_provider_identities (
      post_id,
      provider,
      external_post_id,
      external_account_id,
      identity_kind
    ) values (
      target_post_id,
      provider_key,
      provider_post_id,
      provider_account_id,
      'provider'
    )
    on conflict (provider, external_post_id) do update
    set last_seen_at = now(),
        external_account_id = coalesce(
          excluded.external_account_id,
          creator_post_provider_identities.external_account_id
        )
    where creator_post_provider_identities.post_id = excluded.post_id;

    select identity.id into provider_identity_result
    from public.creator_post_provider_identities identity
    where identity.provider = provider_key
      and identity.external_post_id = provider_post_id
      and identity.post_id = target_post_id;

    if provider_identity_result is null then
      raise exception 'Provider post identity belongs to another canonical post.' using errcode = '23505';
    end if;
  end if;

  update public.creator_content_submissions
  set match_state = 'matched',
      matched_post_id = target_post_id,
      matched_at = now(),
      matched_by = staff_actor,
      review_note = nullif(btrim(coalesce(match_input->>'reviewNote', '')), '')
  where id = target_submission_id;

  insert into public.creator_content_submission_events (
    submission_id,
    actor_user_id,
    event_type,
    metadata
  ) values (
    target_submission_id,
    staff_actor,
    'matched',
    jsonb_build_object('post_id', target_post_id, 'method', 'manual')
  );

  return target_post_id;
end;
$$;

create or replace function public.set_creator_content_review_state(
  target_submission_id uuid,
  target_state text,
  reviewer_note text default null
)
returns text
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  staff_actor uuid;
  normalized_state text := lower(btrim(coalesce(target_state, '')));
begin
  staff_actor := public.creator_content_require_staff(false);

  if normalized_state not in ('matching', 'needs_review', 'rejected') then
    raise exception 'Review state is not valid.' using errcode = '22023';
  end if;

  if reviewer_note is not null and char_length(reviewer_note) > 1000 then
    raise exception 'Review note is too long.' using errcode = '22023';
  end if;

  update public.creator_content_submissions
  set match_state = normalized_state,
      review_note = nullif(btrim(reviewer_note), '')
  where id = target_submission_id
    and match_state not in ('matched', 'rejected', 'withdrawn');

  if not found then
    raise exception 'Submission is not available for review.' using errcode = '22023';
  end if;

  insert into public.creator_content_submission_events (
    submission_id,
    actor_user_id,
    event_type,
    metadata
  ) values (
    target_submission_id,
    staff_actor,
    normalized_state,
    jsonb_build_object('has_review_note', nullif(btrim(reviewer_note), '') is not null)
  );

  return normalized_state;
end;
$$;

create or replace function public.record_creator_post_observation(
  observation_input jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  ignored_actor uuid;
  target_post_id uuid;
  target_provider_identity_id uuid;
  existing_post_id uuid;
  source_key text := lower(btrim(coalesce(observation_input->>'sourceSystem', '')));
  external_observation_key text := btrim(coalesce(observation_input->>'externalObservationId', ''));
  new_observation_id uuid;
begin
  ignored_actor := public.creator_content_require_staff(false);

  begin
    target_post_id := (observation_input->>'postId')::uuid;
  exception when invalid_text_representation then
    raise exception 'The post selection is not valid.' using errcode = '22023';
  end;

  if not exists (select 1 from public.creator_posts where id = target_post_id) then
    raise exception 'Post not found.' using errcode = '22023';
  end if;

  if nullif(btrim(coalesce(observation_input->>'providerIdentityId', '')), '') is not null then
    begin
      target_provider_identity_id := (observation_input->>'providerIdentityId')::uuid;
    exception when invalid_text_representation then
      raise exception 'The provider identity is not valid.' using errcode = '22023';
    end;

    if not exists (
      select 1 from public.creator_post_provider_identities identity
      where identity.id = target_provider_identity_id
        and identity.post_id = target_post_id
    ) then
      raise exception 'The provider identity does not belong to that post.' using errcode = '22023';
    end if;
  end if;

  if source_key !~ '^[a-z][a-z0-9._-]{1,79}$'
    or char_length(external_observation_key) not between 1 and 191 then
    raise exception 'Observation source identity is not valid.' using errcode = '22023';
  end if;

  insert into public.creator_post_observations (
    post_id,
    provider_identity_id,
    source_system,
    external_observation_id,
    external_run_id,
    observed_at,
    view_count,
    like_count,
    comment_count,
    share_count,
    raw_archive_ref,
    payload_sha256
  ) values (
    target_post_id,
    target_provider_identity_id,
    source_key,
    external_observation_key,
    nullif(btrim(coalesce(observation_input->>'externalRunId', '')), ''),
    (observation_input->>'observedAt')::timestamptz,
    nullif(observation_input->>'viewCount', '')::bigint,
    nullif(observation_input->>'likeCount', '')::bigint,
    nullif(observation_input->>'commentCount', '')::bigint,
    nullif(observation_input->>'shareCount', '')::bigint,
    nullif(btrim(coalesce(observation_input->>'rawArchiveRef', '')), ''),
    nullif(lower(btrim(coalesce(observation_input->>'payloadSha256', ''))), '')
  )
  on conflict (source_system, external_observation_id) do nothing
  returning id into new_observation_id;

  if new_observation_id is null then
    select observation.id, observation.post_id
    into new_observation_id, existing_post_id
    from public.creator_post_observations observation
    where observation.source_system = source_key
      and observation.external_observation_id = external_observation_key;

    if existing_post_id is distinct from target_post_id then
      raise exception 'Observation identity belongs to another post.' using errcode = '23505';
    end if;

    if not exists (
      select 1
      from public.creator_post_observations observation
      where observation.id = new_observation_id
        and observation.post_id = target_post_id
        and observation.provider_identity_id is not distinct from target_provider_identity_id
        and observation.external_run_id is not distinct from
          nullif(btrim(coalesce(observation_input->>'externalRunId', '')), '')
        and observation.observed_at = (observation_input->>'observedAt')::timestamptz
        and observation.view_count is not distinct from
          nullif(observation_input->>'viewCount', '')::bigint
        and observation.like_count is not distinct from
          nullif(observation_input->>'likeCount', '')::bigint
        and observation.comment_count is not distinct from
          nullif(observation_input->>'commentCount', '')::bigint
        and observation.share_count is not distinct from
          nullif(observation_input->>'shareCount', '')::bigint
        and observation.raw_archive_ref is not distinct from
          nullif(btrim(coalesce(observation_input->>'rawArchiveRef', '')), '')
        and observation.payload_sha256 is not distinct from
          nullif(lower(btrim(coalesce(observation_input->>'payloadSha256', ''))), '')
    ) then
      raise exception 'Observation identity was reused with different immutable evidence.'
        using errcode = '23505';
    end if;
  end if;

  return new_observation_id;
end;
$$;

create or replace function public.record_creator_earning(earning_input jsonb)
returns uuid
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  staff_actor uuid;
  target_account_id uuid;
  target_enrollment_id uuid;
  target_post_id uuid;
  superseded_entry_id uuid;
  initial_state text := lower(coalesce(nullif(btrim(earning_input->>'state'), ''), 'estimated'));
  normalized_currency text := upper(btrim(coalesce(earning_input->>'currency', '')));
  new_earning_id uuid;
begin
  staff_actor := public.creator_content_require_staff(true);

  begin
    target_account_id := (earning_input->>'accountId')::uuid;
    target_enrollment_id := nullif(earning_input->>'enrollmentId', '')::uuid;
    target_post_id := nullif(earning_input->>'postId', '')::uuid;
    superseded_entry_id := nullif(earning_input->>'supersedesEntryId', '')::uuid;
  exception when invalid_text_representation then
    raise exception 'The earning account, enrollment, or post ID is invalid.' using errcode = '22023';
  end;

  if initial_state not in ('estimated', 'pending') then
    raise exception 'New earnings must begin as estimated or pending.' using errcode = '22023';
  end if;

  if normalized_currency !~ '^[A-Z]{3}$' then
    raise exception 'Currency must be an ISO three-letter code.' using errcode = '22023';
  end if;

  if target_enrollment_id is null then
    select enrollment.id into target_enrollment_id
    from public.creator_enrollments enrollment
    where enrollment.account_id = target_account_id
    order by enrollment.created_at desc
    limit 1;
  end if;

  if target_enrollment_id is null or not exists (
    select 1 from public.creator_enrollments enrollment
    where enrollment.id = target_enrollment_id
      and enrollment.account_id = target_account_id
  ) then
    raise exception 'The enrollment does not belong to that creator.' using errcode = '22023';
  end if;

  if target_post_id is not null and not exists (
    select 1 from public.creator_posts post
    where post.id = target_post_id and post.account_id = target_account_id
  ) then
    raise exception 'The post does not belong to that creator.' using errcode = '22023';
  end if;

  if superseded_entry_id is not null and not exists (
    select 1
    from public.creator_earning_entries prior_earning
    where prior_earning.id = superseded_entry_id
      and prior_earning.account_id = target_account_id
      and prior_earning.enrollment_id = target_enrollment_id
      and prior_earning.currency = normalized_currency
      and prior_earning.currency_exponent = coalesce(
        nullif(earning_input->>'currencyExponent', '')::smallint,
        2
      )
  ) then
    raise exception 'A superseded earning must belong to the same creator and currency.'
      using errcode = '22023';
  end if;

  insert into public.creator_earning_entries (
    account_id,
    enrollment_id,
    post_id,
    source_key,
    category,
    currency,
    currency_exponent,
    amount_minor,
    state,
    period_start,
    period_end,
    earned_at,
    calculation_basis,
    supersedes_entry_id,
    created_by
  ) values (
    target_account_id,
    target_enrollment_id,
    target_post_id,
    btrim(coalesce(earning_input->>'sourceKey', '')),
    lower(btrim(coalesce(earning_input->>'category', ''))),
    normalized_currency,
    coalesce(nullif(earning_input->>'currencyExponent', '')::smallint, 2),
    (earning_input->>'amountMinor')::bigint,
    initial_state,
    nullif(earning_input->>'periodStart', '')::date,
    nullif(earning_input->>'periodEnd', '')::date,
    (earning_input->>'earnedAt')::timestamptz,
    coalesce(earning_input->'calculationBasis', '{}'::jsonb),
    superseded_entry_id,
    staff_actor
  ) returning id into new_earning_id;

  return new_earning_id;
end;
$$;

create or replace function public.transition_creator_earning(
  target_earning_id uuid,
  target_state text,
  transition_reason text,
  provider_reference text default null
)
returns text
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  ignored_actor uuid;
  normalized_state text := lower(btrim(coalesce(target_state, '')));
  requested_provider_reference text := nullif(btrim(coalesce(provider_reference, '')), '');
  current_provider_reference text;
begin
  ignored_actor := public.creator_content_require_staff(true);

  if transition_reason is null or char_length(btrim(transition_reason)) not between 2 and 1000 then
    raise exception 'A transition reason is required.' using errcode = '22023';
  end if;

  select earning.external_reference
  into current_provider_reference
  from public.creator_earning_entries earning
  where earning.id = target_earning_id
  for update;

  if not found then
    raise exception 'Earning entry not found.' using errcode = '22023';
  end if;

  if requested_provider_reference is not null
    and normalized_state not in ('paid', 'reconciled') then
    raise exception 'Provider evidence can be recorded only with a paid or reconciled state.'
      using errcode = '22023';
  end if;

  if current_provider_reference is not null
    and requested_provider_reference is not null
    and requested_provider_reference <> current_provider_reference then
    raise exception 'Earning provider evidence does not match the existing reference.'
      using errcode = '22023';
  end if;

  if normalized_state in ('paid', 'reconciled')
    and coalesce(current_provider_reference, requested_provider_reference) is null then
    raise exception 'A provider reference is required before marking an earning paid.'
      using errcode = '22023';
  end if;

  if normalized_state in ('paid', 'reconciled') and exists (
    select 1
    from public.creator_settlement_lines line
    where line.earning_entry_id = target_earning_id
  ) then
    raise exception 'Settled earnings must be advanced through their settlement.'
      using errcode = '22023';
  end if;

  perform set_config('creator.transition_reason', btrim(transition_reason), true);

  update public.creator_earning_entries
  set state = normalized_state,
      external_reference = coalesce(external_reference, requested_provider_reference)
  where id = target_earning_id;

  return normalized_state;
end;
$$;

create or replace function public.create_creator_settlement(settlement_input jsonb)
returns uuid
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  staff_actor uuid;
  target_account_id uuid;
  target_enrollment_id uuid;
  earning_ids uuid[];
  earning_count integer;
  matching_count integer;
  settlement_currency text;
  settlement_currency_exponent smallint;
  settlement_total bigint;
  new_settlement_id uuid;
begin
  staff_actor := public.creator_content_require_staff(true);

  begin
    target_account_id := (settlement_input->>'accountId')::uuid;
    target_enrollment_id := (settlement_input->>'enrollmentId')::uuid;
    select array_agg(value::uuid)
    into earning_ids
    from jsonb_array_elements_text(settlement_input->'earningEntryIds');
  exception when invalid_text_representation then
    raise exception 'Settlement account, enrollment, or earning IDs are invalid.' using errcode = '22023';
  end;

  earning_count := coalesce(cardinality(earning_ids), 0);
  if earning_count < 1 or earning_count > 1000 then
    raise exception 'A settlement needs between one and 1000 earning entries.' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.creator_enrollments enrollment
    where enrollment.id = target_enrollment_id and enrollment.account_id = target_account_id
  ) then
    raise exception 'The enrollment does not belong to that creator.' using errcode = '22023';
  end if;

  -- Serialize settlement creation against any independent earning transition.
  -- Stable ordering also avoids deadlocks when two overlapping batches race.
  perform earning.id
  from public.creator_earning_entries earning
  where earning.id = any(earning_ids)
  order by earning.id
  for update;

  select count(*), min(currency), min(currency_exponent), sum(amount_minor)
  into matching_count, settlement_currency, settlement_currency_exponent, settlement_total
  from public.creator_earning_entries earning
  where earning.id = any(earning_ids)
    and earning.account_id = target_account_id
    and earning.enrollment_id = target_enrollment_id
    and earning.state = 'approved'
    and not exists (
      select 1 from public.creator_settlement_lines line
      where line.earning_entry_id = earning.id
    );

  if matching_count <> earning_count then
    raise exception 'Every earning must be approved, unsettled, and belong to the creator.' using errcode = '22023';
  end if;

  if (
    select count(distinct (currency, currency_exponent))
    from public.creator_earning_entries where id = any(earning_ids)
  ) <> 1 then
    raise exception 'A settlement can contain only one currency and minor-unit exponent.' using errcode = '22023';
  end if;

  if settlement_total <= 0 then
    raise exception 'Settlement total must be positive.' using errcode = '22023';
  end if;

  insert into public.creator_settlements (
    account_id,
    enrollment_id,
    idempotency_key,
    currency,
    currency_exponent,
    total_minor,
    period_start,
    period_end,
    payout_provider,
    created_by
  ) values (
    target_account_id,
    target_enrollment_id,
    btrim(coalesce(settlement_input->>'idempotencyKey', '')),
    settlement_currency,
    settlement_currency_exponent,
    settlement_total,
    nullif(settlement_input->>'periodStart', '')::date,
    nullif(settlement_input->>'periodEnd', '')::date,
    nullif(lower(btrim(coalesce(settlement_input->>'payoutProvider', ''))), ''),
    staff_actor
  ) returning id into new_settlement_id;

  insert into public.creator_settlement_lines (
    settlement_id,
    earning_entry_id,
    amount_minor
  )
  select new_settlement_id, earning.id, earning.amount_minor
  from public.creator_earning_entries earning
  where earning.id = any(earning_ids);

  return new_settlement_id;
end;
$$;

create or replace function public.transition_creator_settlement(
  target_settlement_id uuid,
  target_state text,
  transition_reason text,
  provider_key text default null,
  provider_payout_id text default null
)
returns text
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  ignored_actor uuid;
  normalized_state text := lower(btrim(coalesce(target_state, '')));
  requested_provider_key text := nullif(lower(btrim(coalesce(provider_key, ''))), '');
  requested_payout_id text := nullif(btrim(coalesce(provider_payout_id, '')), '');
  current_state text;
  current_provider_key text;
  current_payout_id text;
  settlement_account_id uuid;
  settlement_enrollment_id uuid;
  settlement_currency text;
  settlement_currency_exponent smallint;
  settlement_total bigint;
  line_count integer;
  invalid_line_count integer;
  expected_payout_id text;
begin
  ignored_actor := public.creator_content_require_staff(true);

  if transition_reason is null or char_length(btrim(transition_reason)) not between 2 and 1000 then
    raise exception 'A transition reason is required.' using errcode = '22023';
  end if;

  select
    settlement.state,
    settlement.payout_provider,
    settlement.external_payout_id,
    settlement.account_id,
    settlement.enrollment_id,
    settlement.currency,
    settlement.currency_exponent,
    settlement.total_minor
  into
    current_state,
    current_provider_key,
    current_payout_id,
    settlement_account_id,
    settlement_enrollment_id,
    settlement_currency,
    settlement_currency_exponent,
    settlement_total
  from public.creator_settlements settlement
  where settlement.id = target_settlement_id
  for update;

  if not found then
    raise exception 'Settlement not found.' using errcode = '22023';
  end if;

  if (requested_provider_key is not null or requested_payout_id is not null)
    and normalized_state not in ('paid', 'reconciled') then
    raise exception 'Payout evidence can be recorded only with a paid or reconciled state.'
      using errcode = '22023';
  end if;

  if current_provider_key is not null
    and requested_provider_key is not null
    and requested_provider_key <> current_provider_key then
    raise exception 'Payout provider does not match the existing evidence.' using errcode = '22023';
  end if;

  if current_payout_id is not null
    and requested_payout_id is not null
    and requested_payout_id <> current_payout_id then
    raise exception 'Payout ID does not match the existing evidence.' using errcode = '22023';
  end if;

  if normalized_state in ('paid', 'reconciled')
    and coalesce(current_payout_id, requested_payout_id) is null then
    raise exception 'A provider payout ID is required before marking paid.' using errcode = '22023';
  end if;

  if normalized_state in ('paid', 'reconciled')
    and coalesce(current_provider_key, requested_provider_key) is null then
    raise exception 'A payout provider is required before marking paid.' using errcode = '22023';
  end if;

  if normalized_state in ('paid', 'reconciled') then
    expected_payout_id := coalesce(current_payout_id, requested_payout_id);

    -- Lock the complete batch before validating or advancing it. This prevents an
    -- earning from being changed independently between the validation and update.
    perform earning.id
    from public.creator_settlement_lines line
    join public.creator_earning_entries earning
      on earning.id = line.earning_entry_id
    where line.settlement_id = target_settlement_id
    order by earning.id
    for update of earning;

    select count(*)
    into line_count
    from public.creator_settlement_lines line
    join public.creator_earning_entries earning
      on earning.id = line.earning_entry_id
    where line.settlement_id = target_settlement_id
      and earning.account_id = settlement_account_id
      and earning.enrollment_id = settlement_enrollment_id
      and earning.currency = settlement_currency
      and earning.currency_exponent = settlement_currency_exponent;

    if line_count < 1 or (
      select coalesce(sum(line.amount_minor), 0)
      from public.creator_settlement_lines line
      where line.settlement_id = target_settlement_id
    ) <> settlement_total then
      raise exception 'Settlement lines do not match the immutable settlement total.'
        using errcode = '22023';
    end if;

    if line_count <> (
      select count(*)
      from public.creator_settlement_lines line
      where line.settlement_id = target_settlement_id
    ) then
      raise exception 'Settlement lines do not match the settlement creator or currency.'
        using errcode = '22023';
    end if;

    if normalized_state = 'paid' then
      select count(*)
      into invalid_line_count
      from public.creator_settlement_lines line
      join public.creator_earning_entries earning
        on earning.id = line.earning_entry_id
      where line.settlement_id = target_settlement_id
        and not (
          (current_state = 'approved' and earning.state = 'approved' and earning.external_reference is null)
          or (
            current_state = 'paid'
            and earning.state = 'paid'
            and earning.external_reference = expected_payout_id
          )
        );
    else
      select count(*)
      into invalid_line_count
      from public.creator_settlement_lines line
      join public.creator_earning_entries earning
        on earning.id = line.earning_entry_id
      where line.settlement_id = target_settlement_id
        and not (
          (
            current_state = 'paid'
            and earning.state = 'paid'
            and earning.external_reference = expected_payout_id
          )
          or (
            current_state = 'reconciled'
            and earning.state = 'reconciled'
            and earning.external_reference = expected_payout_id
          )
        );
    end if;

    if invalid_line_count <> 0 then
      raise exception 'Settlement earning states or payout evidence do not match the requested transition.'
        using errcode = '22023';
    end if;
  end if;

  perform set_config('creator.transition_reason', btrim(transition_reason), true);

  if normalized_state in ('paid', 'reconciled') then
    perform set_config(
      'creator.settlement_transition_id',
      target_settlement_id::text,
      true
    );
  end if;

  update public.creator_settlements
  set state = normalized_state,
      payout_provider = coalesce(payout_provider, requested_provider_key),
      external_payout_id = coalesce(external_payout_id, requested_payout_id)
  where id = target_settlement_id;

  if normalized_state = 'paid' then
    update public.creator_earning_entries earning
    set state = 'paid',
        external_reference = coalesce(
          earning.external_reference,
          current_payout_id,
          requested_payout_id
        )
    from public.creator_settlement_lines line
    where line.settlement_id = target_settlement_id
      and line.earning_entry_id = earning.id
      and earning.state = 'approved'
      and earning.external_reference is null;
  elsif normalized_state = 'reconciled' then
    update public.creator_earning_entries earning
    set state = 'reconciled'
    from public.creator_settlement_lines line
    where line.settlement_id = target_settlement_id
      and line.earning_entry_id = earning.id
      and earning.state = 'paid'
      and earning.external_reference = coalesce(current_payout_id, requested_payout_id);
  end if;

  return normalized_state;
end;
$$;

create or replace function public.get_own_content_workspace()
returns jsonb
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select jsonb_build_object(
    'canSubmit', exists (
      select 1 from public.creator_enrollments enrollment
      where enrollment.account_id = auth.uid() and enrollment.status = 'active'
    ),
    'platformAccounts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', platform_account.id,
        'platform', platform_account.platform,
        'handle', platform_account.current_handle
      ) order by platform_account.platform, platform_account.normalized_handle)
      from public.creator_platform_accounts platform_account
      where platform_account.account_id = auth.uid()
        and platform_account.status = 'verified'
    ), '[]'::jsonb),
    'submissions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', submission.id,
        'platform', submission.platform,
        'url', submission.submitted_url,
        'declaredNativePostId', submission.declared_native_post_id,
        'matchState', submission.match_state,
        'matchedPostId', submission.matched_post_id,
        'submittedAt', submission.submitted_at,
        'matchedAt', submission.matched_at,
        'creatorNote', submission.creator_note
      ) order by submission.submitted_at desc)
      from public.creator_content_submissions submission
      where submission.account_id = auth.uid()
    ), '[]'::jsonb),
    'posts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', post.id,
        'platform', post.platform,
        'nativePostId', post.native_post_id,
        'canonicalUrl', post.canonical_url,
        'publishedAt', post.published_at,
        'attributionState', post.attribution_state,
        'latestObservation', (
          select jsonb_build_object(
            'observedAt', observation.observed_at,
            'viewCount', observation.view_count::text,
            'likeCount', observation.like_count::text,
            'commentCount', observation.comment_count::text,
            'shareCount', observation.share_count::text
          )
          from public.creator_post_observations observation
          where observation.post_id = post.id
          order by observation.observed_at desc
          limit 1
        )
      ) order by post.published_at desc nulls last, post.created_at desc)
      from public.creator_posts post
      where post.account_id = auth.uid()
    ), '[]'::jsonb)
  )
  where auth.uid() is not null;
$$;

create or replace function public.get_own_earnings_workspace()
returns jsonb
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select jsonb_build_object(
    'entries', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', earning.id,
        'postId', earning.post_id,
        'category', earning.category,
        'currency', earning.currency,
        'currencyExponent', earning.currency_exponent,
        'amountMinor', earning.amount_minor::text,
        'state', earning.state,
        'periodStart', earning.period_start,
        'periodEnd', earning.period_end,
        'earnedAt', earning.earned_at,
        'approvedAt', earning.approved_at,
        'paidAt', earning.paid_at,
        'reconciledAt', earning.reconciled_at
      ) order by earning.earned_at desc, earning.created_at desc)
      from public.creator_earning_entries earning
      where earning.account_id = auth.uid()
    ), '[]'::jsonb),
    'settlements', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', settlement.id,
        'currency', settlement.currency,
        'currencyExponent', settlement.currency_exponent,
        'totalMinor', settlement.total_minor::text,
        'state', settlement.state,
        'periodStart', settlement.period_start,
        'periodEnd', settlement.period_end,
        'payoutProvider', settlement.payout_provider,
        'approvedAt', settlement.approved_at,
        'paidAt', settlement.paid_at,
        'reconciledAt', settlement.reconciled_at,
        'createdAt', settlement.created_at
      ) order by settlement.created_at desc)
      from public.creator_settlements settlement
      where settlement.account_id = auth.uid()
    ), '[]'::jsonb)
  )
  where auth.uid() is not null;
$$;

create or replace function public.get_admin_content_queue(result_limit integer default 100)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
declare
  ignored_actor uuid;
begin
  ignored_actor := public.creator_content_require_staff(false);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', submission.id,
      'accountId', submission.account_id,
      'platform', submission.platform,
      'url', submission.submitted_url,
      'declaredNativePostId', submission.declared_native_post_id,
      'matchState', submission.match_state,
      'matchedPostId', submission.matched_post_id,
      'submittedAt', submission.submitted_at
    ) order by submission.submitted_at)
    from (
      select *
      from public.creator_content_submissions
      where match_state in ('submitted', 'matching', 'needs_review')
      order by submitted_at
      limit greatest(1, least(coalesce(result_limit, 100), 500))
    ) submission
  ), '[]'::jsonb);
end;
$$;

create or replace function public.get_admin_finance_ledger(result_limit integer default 250)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
declare
  ignored_actor uuid;
begin
  ignored_actor := public.creator_content_require_staff(true);
  return jsonb_build_object(
    'entries', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', earning.id,
        'accountId', earning.account_id,
        'enrollmentId', earning.enrollment_id,
        'postId', earning.post_id,
        'sourceKey', earning.source_key,
        'category', earning.category,
        'currency', earning.currency,
        'currencyExponent', earning.currency_exponent,
        'amountMinor', earning.amount_minor::text,
        'state', earning.state,
        'periodStart', earning.period_start,
        'periodEnd', earning.period_end,
        'earnedAt', earning.earned_at,
        'approvedAt', earning.approved_at,
        'paidAt', earning.paid_at,
        'reconciledAt', earning.reconciled_at,
        'externalReference', earning.external_reference,
        'settlementId', (
          select line.settlement_id
          from public.creator_settlement_lines line
          where line.earning_entry_id = earning.id
        )
      ) order by earning.earned_at desc)
      from (
        select * from public.creator_earning_entries
        order by earned_at desc, created_at desc
        limit greatest(1, least(coalesce(result_limit, 250), 1000))
      ) earning
    ), '[]'::jsonb),
    'settlements', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', settlement.id,
        'accountId', settlement.account_id,
        'enrollmentId', settlement.enrollment_id,
        'currency', settlement.currency,
        'currencyExponent', settlement.currency_exponent,
        'totalMinor', settlement.total_minor::text,
        'state', settlement.state,
        'periodStart', settlement.period_start,
        'periodEnd', settlement.period_end,
        'payoutProvider', settlement.payout_provider,
        'externalPayoutId', settlement.external_payout_id,
        'approvedAt', settlement.approved_at,
        'paidAt', settlement.paid_at,
        'reconciledAt', settlement.reconciled_at,
        'createdAt', settlement.created_at,
        'earningEntryIds', coalesce((
          select jsonb_agg(line.earning_entry_id order by line.created_at)
          from public.creator_settlement_lines line
          where line.settlement_id = settlement.id
        ), '[]'::jsonb)
      ) order by settlement.created_at desc)
      from (
        select * from public.creator_settlements
        order by created_at desc
        limit greatest(1, least(coalesce(result_limit, 250), 1000))
      ) settlement
    ), '[]'::jsonb)
  );
end;
$$;

alter table public.creator_posts enable row level security;
alter table public.creator_content_submissions enable row level security;
alter table public.creator_content_submission_events enable row level security;
alter table public.creator_post_provider_identities enable row level security;
alter table public.creator_post_observations enable row level security;
alter table public.creator_earning_entries enable row level security;
alter table public.creator_earning_state_events enable row level security;
alter table public.creator_settlements enable row level security;
alter table public.creator_settlement_lines enable row level security;
alter table public.creator_settlement_state_events enable row level security;

create policy creator_posts_read_own
on public.creator_posts for select to authenticated
using (account_id = auth.uid());

create policy creator_content_submissions_read_own
on public.creator_content_submissions for select to authenticated
using (account_id = auth.uid());

create policy creator_post_observations_read_own
on public.creator_post_observations for select to authenticated
using (exists (
  select 1 from public.creator_posts post
  where post.id = creator_post_observations.post_id
    and post.account_id = auth.uid()
));

create policy creator_earning_entries_read_own
on public.creator_earning_entries for select to authenticated
using (account_id = auth.uid());

create policy creator_settlements_read_own
on public.creator_settlements for select to authenticated
using (account_id = auth.uid());

create policy creator_settlement_lines_read_own
on public.creator_settlement_lines for select to authenticated
using (exists (
  select 1 from public.creator_settlements settlement
  where settlement.id = creator_settlement_lines.settlement_id
    and settlement.account_id = auth.uid()
));

revoke all on public.creator_posts from public, anon, authenticated;
revoke all on public.creator_content_submissions from public, anon, authenticated;
revoke all on public.creator_content_submission_events from public, anon, authenticated;
revoke all on public.creator_post_provider_identities from public, anon, authenticated;
revoke all on public.creator_post_observations from public, anon, authenticated;
revoke all on public.creator_earning_entries from public, anon, authenticated;
revoke all on public.creator_earning_state_events from public, anon, authenticated;
revoke all on public.creator_settlements from public, anon, authenticated;
revoke all on public.creator_settlement_lines from public, anon, authenticated;
revoke all on public.creator_settlement_state_events from public, anon, authenticated;

revoke execute on function public.creator_content_require_staff(boolean) from public, anon, authenticated;
revoke execute on function public.submit_creator_content(jsonb) from public, anon;
revoke execute on function public.match_creator_content_submission(uuid, jsonb) from public, anon;
revoke execute on function public.set_creator_content_review_state(uuid, text, text) from public, anon;
revoke execute on function public.record_creator_post_observation(jsonb) from public, anon;
revoke execute on function public.record_creator_earning(jsonb) from public, anon;
revoke execute on function public.transition_creator_earning(uuid, text, text, text) from public, anon;
revoke execute on function public.create_creator_settlement(jsonb) from public, anon;
revoke execute on function public.transition_creator_settlement(uuid, text, text, text, text) from public, anon;
revoke execute on function public.get_own_content_workspace() from public, anon;
revoke execute on function public.get_own_earnings_workspace() from public, anon;
revoke execute on function public.get_admin_content_queue(integer) from public, anon;
revoke execute on function public.get_admin_finance_ledger(integer) from public, anon;

grant execute on function public.submit_creator_content(jsonb) to authenticated;
grant execute on function public.get_own_content_workspace() to authenticated;
grant execute on function public.get_own_earnings_workspace() to authenticated;
grant execute on function public.match_creator_content_submission(uuid, jsonb) to authenticated, service_role;
grant execute on function public.set_creator_content_review_state(uuid, text, text) to authenticated, service_role;
grant execute on function public.record_creator_post_observation(jsonb) to authenticated, service_role;
grant execute on function public.record_creator_earning(jsonb) to authenticated, service_role;
grant execute on function public.transition_creator_earning(uuid, text, text, text) to authenticated, service_role;
grant execute on function public.create_creator_settlement(jsonb) to authenticated, service_role;
grant execute on function public.transition_creator_settlement(uuid, text, text, text, text) to authenticated, service_role;
grant execute on function public.get_admin_content_queue(integer) to authenticated, service_role;
grant execute on function public.get_admin_finance_ledger(integer) to authenticated, service_role;

revoke execute on function public.creator_guard_earning_entry() from public;
revoke execute on function public.creator_record_earning_state_event() from public;
revoke execute on function public.creator_guard_settlement() from public;
revoke execute on function public.creator_record_settlement_state_event() from public;
revoke execute on function public.creator_prevent_ledger_audit_changes() from public;

comment on table public.creator_content_submissions is
  'Creator-entered post claims. A submitted URL or native ID is not verified attribution.';
comment on table public.creator_posts is
  'Canonical attributed posts, ready to be linked to provider identities and tracker observations.';
comment on table public.creator_post_observations is
  'Append-oriented metric snapshots with stable external observation and run linkage.';
comment on table public.creator_earning_entries is
  'Immutable earning facts in integer minor units with forward-only lifecycle states.';
comment on table public.creator_settlements is
  'Auditable settlement batches. Paid is valid only with provider evidence; this table never initiates money movement.';
