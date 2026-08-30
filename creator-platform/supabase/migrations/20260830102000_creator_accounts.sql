-- Creator-first account, application, enrollment, and agreement boundary.
-- This schema intentionally lives in the dedicated creator-platform Supabase
-- project. Do not apply it to the legacy CRM or the consumer GoTall project.

create extension if not exists pgcrypto;

create table public.creator_accounts (
  auth_user_id uuid primary key references auth.users(id) on delete cascade,
  email_snapshot text not null,
  lifecycle_status text not null default 'email_unverified'
    check (lifecycle_status in (
      'email_unverified',
      'profile_incomplete',
      'application_pending',
      'application_in_review',
      'agreement_pending',
      'active',
      'suspended',
      'closed'
    )),
  legacy_creator_id text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.creator_applications (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null unique references public.creator_accounts(auth_user_id) on delete cascade,
  name text not null check (char_length(name) between 2 and 120),
  phone_e164 text not null check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  discord_username text not null check (char_length(discord_username) between 2 and 64),
  status text not null default 'submitted'
    check (status in ('submitted', 'in_review', 'approved', 'rejected', 'withdrawn')),
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null,
  review_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.creator_application_handles (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.creator_applications(id) on delete cascade,
  platform text not null check (platform in ('TIKTOK', 'INSTAGRAM_REELS')),
  entered_handle text not null check (char_length(entered_handle) between 1 and 80),
  normalized_handle text not null check (
    char_length(normalized_handle) between 1 and 64
    and normalized_handle ~ '^[a-z0-9._-]+$'
  ),
  created_at timestamptz not null default now(),
  unique (application_id, platform, normalized_handle),
  unique (platform, normalized_handle)
);

create table public.program_deal_versions (
  id uuid primary key default gen_random_uuid(),
  deal_key text not null,
  version integer not null check (version > 0),
  label text not null,
  terms_markdown text not null,
  terms_sha256 text not null check (terms_sha256 ~ '^[a-f0-9]{64}$'),
  status text not null default 'draft' check (status in ('draft', 'active', 'retired')),
  is_default boolean not null default false,
  effective_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (deal_key, version),
  check (status <> 'active' or effective_at is not null)
);

create or replace function public.hash_program_deal_terms()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.terms_sha256 = encode(digest(convert_to(new.terms_markdown, 'UTF8'), 'sha256'), 'hex');
  return new;
end;
$$;

create trigger hash_program_deal_terms
before insert or update of terms_markdown on public.program_deal_versions
for each row execute function public.hash_program_deal_terms();

create unique index program_deal_versions_one_default
  on public.program_deal_versions (is_default)
  where is_default and status = 'active';

create table public.staff_members (
  auth_user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('reviewer', 'admin')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.creator_enrollments (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null unique references public.creator_accounts(auth_user_id) on delete cascade,
  application_id uuid not null unique references public.creator_applications(id) on delete restrict,
  deal_version_id uuid not null references public.program_deal_versions(id) on delete restrict,
  legacy_creator_id text unique,
  status text not null default 'agreement_pending'
    check (status in ('agreement_pending', 'active', 'paused', 'ended')),
  approved_by uuid not null references public.staff_members(auth_user_id) on delete restrict,
  approved_at timestamptz not null default now(),
  activated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.agreement_records (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references public.creator_enrollments(id) on delete cascade,
  deal_version_id uuid not null references public.program_deal_versions(id) on delete restrict,
  provider text not null,
  provider_environment text,
  external_agreement_id text,
  signer_name_snapshot text not null,
  signer_email_snapshot text not null,
  status text not null default 'pending'
    check (status in ('pending', 'sent', 'viewed', 'creator_accepted', 'completed', 'declined', 'voided', 'error')),
  sent_at timestamptz,
  creator_accepted_at timestamptz,
  completed_at timestamptz,
  completion_evidence_sha256 text check (
    completion_evidence_sha256 is null or completion_evidence_sha256 ~ '^[a-f0-9]{64}$'
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (enrollment_id, deal_version_id),
  unique (provider, provider_environment, external_agreement_id)
);

create table public.agreement_events (
  id uuid primary key default gen_random_uuid(),
  agreement_id uuid references public.agreement_records(id) on delete cascade,
  provider text not null,
  external_event_id text not null,
  event_type text not null,
  event_timestamp timestamptz,
  payload_sha256 text not null check (payload_sha256 ~ '^[a-f0-9]{64}$'),
  verified boolean not null default false,
  processing_status text not null default 'received'
    check (processing_status in ('received', 'processed', 'ignored', 'failed')),
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (provider, external_event_id)
);

create table public.creator_application_events (
  id bigint generated always as identity primary key,
  application_id uuid not null references public.creator_applications(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  event_type text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.creator_claim_invitations (
  id uuid primary key default gen_random_uuid(),
  legacy_creator_id text not null,
  token_sha256 text not null unique check (token_sha256 ~ '^[a-f0-9]{64}$'),
  invited_email text,
  expires_at timestamptz not null,
  consumed_by uuid references public.creator_accounts(auth_user_id) on delete set null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  check ((consumed_by is null) = (consumed_at is null))
);

create or replace function public.creator_touch_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger creator_accounts_touch_updated_at
before update on public.creator_accounts
for each row execute function public.creator_touch_updated_at();

create trigger creator_applications_touch_updated_at
before update on public.creator_applications
for each row execute function public.creator_touch_updated_at();

create trigger creator_enrollments_touch_updated_at
before update on public.creator_enrollments
for each row execute function public.creator_touch_updated_at();

create trigger agreement_records_touch_updated_at
before update on public.agreement_records
for each row execute function public.creator_touch_updated_at();

create or replace function public.sync_creator_account_from_auth()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
begin
  insert into public.creator_accounts (
    auth_user_id,
    email_snapshot,
    lifecycle_status
  ) values (
    new.id,
    lower(coalesce(new.email, '')),
    case when new.email_confirmed_at is null then 'email_unverified' else 'profile_incomplete' end
  )
  on conflict (auth_user_id) do update
  set email_snapshot = excluded.email_snapshot,
      lifecycle_status = case
        when public.creator_accounts.lifecycle_status = 'email_unverified'
          and new.email_confirmed_at is not null
        then 'profile_incomplete'
        else public.creator_accounts.lifecycle_status
      end;

  return new;
end;
$$;

create trigger sync_creator_account_after_auth_change
after insert or update of email, email_confirmed_at on auth.users
for each row execute function public.sync_creator_account_from_auth();

create or replace function public.submit_creator_application(application_input jsonb)
returns table (application_id uuid, status text)
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  current_user_id uuid := auth.uid();
  current_user_email text;
  current_user_confirmed_at timestamptz;
  existing_status text;
  submitted_application_id uuid;
  submitted_name text := btrim(coalesce(application_input->>'name', ''));
  submitted_phone text := regexp_replace(btrim(coalesce(application_input->>'phoneNumber', '')), '[^0-9+]', '', 'g');
  submitted_discord text := btrim(coalesce(application_input->>'discordUsername', ''));
  submitted_accounts jsonb := application_input->'accounts';
  account_item jsonb;
  account_platform text;
  entered_handle text;
  normalized_handle text;
  account_count integer;
begin
  if current_user_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  select lower(email), email_confirmed_at
  into current_user_email, current_user_confirmed_at
  from auth.users
  where id = current_user_id;

  if current_user_confirmed_at is null then
    raise exception 'Confirm your email before applying.' using errcode = '42501';
  end if;

  if char_length(submitted_name) not between 2 and 120 then
    raise exception 'Enter your full name.' using errcode = '22023';
  end if;

  if submitted_phone !~ '^\+[1-9][0-9]{7,14}$' then
    raise exception 'Enter a phone number with country code.' using errcode = '22023';
  end if;

  if char_length(submitted_discord) not between 2 and 64 then
    raise exception 'Enter your Discord username.' using errcode = '22023';
  end if;

  if jsonb_typeof(submitted_accounts) <> 'array' then
    raise exception 'Add at least one creator account.' using errcode = '22023';
  end if;

  account_count := jsonb_array_length(submitted_accounts);
  if account_count < 1 or account_count > 10 then
    raise exception 'Add between one and ten creator accounts.' using errcode = '22023';
  end if;

  insert into public.creator_accounts (auth_user_id, email_snapshot, lifecycle_status)
  values (current_user_id, current_user_email, 'application_pending')
  on conflict (auth_user_id) do update
  set email_snapshot = excluded.email_snapshot,
      lifecycle_status = case
        when public.creator_accounts.lifecycle_status in ('email_unverified', 'profile_incomplete', 'application_pending')
        then 'application_pending'
        else public.creator_accounts.lifecycle_status
      end;

  select creator_applications.status
  into existing_status
  from public.creator_applications
  where account_id = current_user_id
  for update;

  if existing_status in ('approved', 'withdrawn') then
    raise exception 'This application can no longer be edited.' using errcode = '42501';
  end if;

  insert into public.creator_applications (
    account_id,
    name,
    phone_e164,
    discord_username,
    status,
    submitted_at
  ) values (
    current_user_id,
    submitted_name,
    submitted_phone,
    submitted_discord,
    'submitted',
    now()
  )
  on conflict (account_id) do update
  set name = excluded.name,
      phone_e164 = excluded.phone_e164,
      discord_username = excluded.discord_username,
      status = 'submitted',
      submitted_at = now(),
      reviewed_at = null,
      reviewed_by = null,
      review_note = null
  returning id into submitted_application_id;

  delete from public.creator_application_handles
  where creator_application_handles.application_id = submitted_application_id;

  for account_item in select value from jsonb_array_elements(submitted_accounts)
  loop
    account_platform := upper(btrim(coalesce(account_item->>'platform', '')));
    entered_handle := btrim(coalesce(account_item->>'handle', ''));
    normalized_handle := lower(regexp_replace(entered_handle, '^@+', ''));

    if account_platform not in ('TIKTOK', 'INSTAGRAM_REELS') then
      raise exception 'Choose TikTok or Instagram for every creator account.' using errcode = '22023';
    end if;

    if normalized_handle !~ '^[a-z0-9._-]{1,64}$' then
      raise exception 'Enter a valid creator handle.' using errcode = '22023';
    end if;

    insert into public.creator_application_handles (
      application_id,
      platform,
      entered_handle,
      normalized_handle
    ) values (
      submitted_application_id,
      account_platform,
      entered_handle,
      normalized_handle
    );
  end loop;

  insert into public.creator_application_events (
    application_id,
    actor_user_id,
    event_type,
    metadata
  ) values (
    submitted_application_id,
    current_user_id,
    'submitted',
    jsonb_build_object('account_count', account_count)
  );

  return query select submitted_application_id, 'submitted'::text;
exception
  when unique_violation then
    raise exception 'One of those creator handles is already connected to another account.' using errcode = '23505';
end;
$$;

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
    ca.lifecycle_status,
    app.id,
    app.status,
    agr.status,
    case
      when current_user_confirmed_at is null then '/auth/check-email'
      when app.id is null then '/apply'
      when app.status in ('submitted', 'in_review', 'rejected') then '/application/status'
      when enrollment.id is null then '/application/status'
      when agr.id is null or agr.status <> 'completed' then '/onboarding/agreement'
      else '/preview/creator'
    end
  from public.creator_accounts ca
  left join public.creator_applications app on app.account_id = ca.auth_user_id
  left join public.creator_enrollments enrollment on enrollment.account_id = ca.auth_user_id
  left join lateral (
    select agreement_records.status
    from public.agreement_records
    where agreement_records.enrollment_id = enrollment.id
    order by agreement_records.created_at desc
    limit 1
  ) agr on true
  where ca.auth_user_id = current_user_id;
end;
$$;

create or replace function public.approve_creator_application(target_application_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  reviewer_id uuid := auth.uid();
  target_account_id uuid;
  default_deal_id uuid;
  enrollment_id uuid;
begin
  if not exists (
    select 1 from public.staff_members
    where auth_user_id = reviewer_id and active and role in ('reviewer', 'admin')
  ) then
    raise exception 'Reviewer access required.' using errcode = '42501';
  end if;

  select account_id into target_account_id
  from public.creator_applications
  where id = target_application_id and status in ('submitted', 'in_review')
  for update;

  if target_account_id is null then
    raise exception 'Application is not available for approval.' using errcode = '22023';
  end if;

  select id into default_deal_id
  from public.program_deal_versions
  where is_default and status = 'active' and effective_at <= now()
  order by version desc
  limit 1;

  if default_deal_id is null then
    raise exception 'No active default deal version is configured.' using errcode = '55000';
  end if;

  update public.creator_applications
  set status = 'approved', reviewed_at = now(), reviewed_by = reviewer_id
  where id = target_application_id;

  insert into public.creator_enrollments (
    account_id,
    application_id,
    deal_version_id,
    approved_by
  ) values (
    target_account_id,
    target_application_id,
    default_deal_id,
    reviewer_id
  )
  returning id into enrollment_id;

  update public.creator_accounts
  set lifecycle_status = 'agreement_pending'
  where auth_user_id = target_account_id;

  insert into public.creator_application_events (
    application_id,
    actor_user_id,
    event_type,
    metadata
  ) values (
    target_application_id,
    reviewer_id,
    'approved',
    jsonb_build_object('deal_version_id', default_deal_id, 'enrollment_id', enrollment_id)
  );

  return enrollment_id;
end;
$$;

create or replace function public.prevent_finalized_deal_changes()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' and old.status <> 'draft' then
    raise exception 'Finalized deal versions are immutable.';
  end if;

  if tg_op = 'UPDATE' and old.status <> 'draft' then
    raise exception 'Finalized deal versions are immutable.';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger prevent_finalized_deal_changes
before update or delete on public.program_deal_versions
for each row execute function public.prevent_finalized_deal_changes();

alter table public.creator_accounts enable row level security;
alter table public.creator_applications enable row level security;
alter table public.creator_application_handles enable row level security;
alter table public.program_deal_versions enable row level security;
alter table public.staff_members enable row level security;
alter table public.creator_enrollments enable row level security;
alter table public.agreement_records enable row level security;
alter table public.agreement_events enable row level security;
alter table public.creator_application_events enable row level security;
alter table public.creator_claim_invitations enable row level security;

create policy creator_accounts_read_own
on public.creator_accounts for select to authenticated
using (auth.uid() = auth_user_id);

create policy creator_applications_read_own
on public.creator_applications for select to authenticated
using (auth.uid() = account_id);

create policy creator_application_handles_read_own
on public.creator_application_handles for select to authenticated
using (exists (
  select 1 from public.creator_applications
  where creator_applications.id = creator_application_handles.application_id
    and creator_applications.account_id = auth.uid()
));

create policy creator_enrollments_read_own
on public.creator_enrollments for select to authenticated
using (auth.uid() = account_id);

create policy assigned_deal_versions_read_own
on public.program_deal_versions for select to authenticated
using (exists (
  select 1 from public.creator_enrollments
  where creator_enrollments.deal_version_id = program_deal_versions.id
    and creator_enrollments.account_id = auth.uid()
));

create policy agreement_records_read_own
on public.agreement_records for select to authenticated
using (exists (
  select 1 from public.creator_enrollments
  where creator_enrollments.id = agreement_records.enrollment_id
    and creator_enrollments.account_id = auth.uid()
));

revoke all on all tables in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated;

grant select on public.creator_accounts to authenticated;
grant select on public.creator_applications to authenticated;
grant select on public.creator_application_handles to authenticated;
grant select on public.program_deal_versions to authenticated;
grant select on public.creator_enrollments to authenticated;
grant select on public.agreement_records to authenticated;

grant execute on function public.submit_creator_application(jsonb) to authenticated;
grant execute on function public.get_creator_account_state() to authenticated;
grant execute on function public.approve_creator_application(uuid) to authenticated;

revoke execute on function public.sync_creator_account_from_auth() from public;
revoke execute on function public.creator_touch_updated_at() from public;
revoke execute on function public.hash_program_deal_terms() from public;
revoke execute on function public.prevent_finalized_deal_changes() from public;

comment on table public.creator_accounts is 'One isolated creator-portal account per verified Supabase Auth user.';
comment on table public.program_deal_versions is 'Immutable legal/business deal revisions; activation is blocked until a complete version is inserted.';
comment on table public.agreement_records is 'Provider-neutral agreement state. Browser return URLs are never authoritative completion evidence.';
