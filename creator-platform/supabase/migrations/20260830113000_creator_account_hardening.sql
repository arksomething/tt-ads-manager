-- Harden the already-live creator account boundary without rewriting history.
-- Application handles are unverified claims. Legal deal content remains
-- immutable after activation, while default deal rotation remains operable.

-- A handle supplied in an application is not evidence that the applicant owns
-- it. Keep duplicate prevention inside one application, but do not let an
-- unverified claim reserve a public handle globally.
do $migration$
declare
  global_handle_constraint name;
begin
  for global_handle_constraint in
    select constraint_record.conname
    from pg_constraint constraint_record
    where constraint_record.conrelid = 'public.creator_application_handles'::regclass
      and constraint_record.contype = 'u'
      and pg_get_constraintdef(constraint_record.oid) = 'UNIQUE (platform, normalized_handle)'
  loop
    execute format(
      'alter table public.creator_application_handles drop constraint %I',
      global_handle_constraint
    );
  end loop;
end;
$migration$;

-- Also remove an equivalent standalone index if one was added outside the
-- tracked migration. Constraint-backed indexes disappear with the constraint
-- above and are excluded here.
do $migration$
declare
  global_handle_index record;
begin
  for global_handle_index in
    select index_namespace.nspname as schema_name,
           index_relation.relname as index_name
    from pg_index index_record
    join pg_class index_relation
      on index_relation.oid = index_record.indexrelid
    join pg_namespace index_namespace
      on index_namespace.oid = index_relation.relnamespace
    where index_record.indrelid = 'public.creator_application_handles'::regclass
      and index_record.indisunique
      and index_record.indnkeyatts = 2
      and pg_get_indexdef(index_record.indexrelid, 1, true) = 'platform'
      and pg_get_indexdef(index_record.indexrelid, 2, true) = 'normalized_handle'
      and not exists (
        select 1
        from pg_constraint constraint_record
        where constraint_record.conindid = index_record.indexrelid
      )
  loop
    execute format(
      'drop index %I.%I',
      global_handle_index.schema_name,
      global_handle_index.index_name
    );
  end loop;
end;
$migration$;

comment on table public.creator_application_handles is
  'Provisional, applicant-entered handle claims. These rows are not ownership verification and do not reserve a handle across applications.';

-- Verified ownership is deliberately separate from provisional application
-- claims. Provider-native account IDs, rather than mutable/recyclable handles,
-- are the global identity boundary.
create table if not exists public.creator_platform_accounts (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.creator_accounts(auth_user_id) on delete cascade,
  platform text not null check (platform in ('TIKTOK', 'INSTAGRAM_REELS')),
  native_account_id text not null check (char_length(native_account_id) between 1 and 191),
  current_handle text not null check (char_length(current_handle) between 1 and 80),
  normalized_handle text not null check (
    char_length(normalized_handle) between 1 and 64
    and normalized_handle ~ '^[a-z0-9._-]+$'
  ),
  ownership_verification_method text not null
    check (char_length(ownership_verification_method) between 2 and 80),
  ownership_evidence_sha256 text not null
    check (ownership_evidence_sha256 ~ '^[a-f0-9]{64}$'),
  ownership_verified_at timestamptz not null,
  status text not null default 'verified'
    check (status in ('verified', 'revoked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (platform, native_account_id)
);

drop trigger if exists creator_platform_accounts_touch_updated_at
on public.creator_platform_accounts;

create trigger creator_platform_accounts_touch_updated_at
before update on public.creator_platform_accounts
for each row execute function public.creator_touch_updated_at();

alter table public.creator_platform_accounts enable row level security;
revoke all on public.creator_platform_accounts from public, anon, authenticated;

comment on table public.creator_platform_accounts is
  'Verified creator-platform ownership keyed by stable provider-native account ID. No application claim is promoted here without external ownership evidence.';

-- Submission is one-shot. Once any application row exists for an account, the
-- applicant cannot use the public RPC to rewrite identity fields, handles,
-- status, reviewer identity, timestamps, or review notes.
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
  existing_application_id uuid;
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

  select creator_applications.id
  into existing_application_id
  from public.creator_applications
  where account_id = current_user_id
  for update;

  if existing_application_id is not null then
    raise exception 'An application has already been submitted for this account.'
      using errcode = '42501';
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
  returning id into submitted_application_id;

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
    if exists (
      select 1 from public.creator_applications
      where account_id = current_user_id
    ) then
      raise exception 'An application has already been submitted for this account.'
        using errcode = '42501';
    end if;

    raise exception 'List each creator handle only once per platform.'
      using errcode = '22023';
end;
$$;

-- This is the column-safe application read boundary. In particular it omits
-- reviewed_by and review_note; a future public decision message must be stored
-- in a separately reviewed applicant-facing column rather than exposing staff
-- notes.
create or replace function public.get_own_creator_application()
returns table (
  application_id uuid,
  applicant_name text,
  phone_e164 text,
  discord_username text,
  application_status text,
  submitted_at timestamptz,
  reviewed_at timestamptz,
  creator_accounts jsonb
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
    application_record.id,
    application_record.name,
    application_record.phone_e164,
    application_record.discord_username,
    application_record.status,
    application_record.submitted_at,
    application_record.reviewed_at,
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'platform', handle_record.platform,
            'handle', handle_record.entered_handle
          )
          order by handle_record.platform, handle_record.normalized_handle
        )
        from public.creator_application_handles handle_record
        where handle_record.application_id = application_record.id
      ),
      '[]'::jsonb
    )
  from public.creator_applications application_record
  where application_record.account_id = current_user_id;
end;
$$;

revoke select on public.creator_applications from public, anon, authenticated;
revoke select on public.creator_application_handles from public, anon, authenticated;
revoke execute on function public.get_own_creator_application() from public, anon;
grant execute on function public.get_own_creator_application() to authenticated;

comment on function public.get_own_creator_application() is
  'Applicant-safe application snapshot. Internal reviewer IDs and staff review notes are intentionally omitted.';

-- Replace the original blanket finalized-row lock. Legal and business content
-- is still immutable after activation, but status/default metadata may follow
-- controlled operational transitions.
drop trigger if exists prevent_finalized_deal_changes
on public.program_deal_versions;

-- Heal any pre-constraint state the original partial unique index allowed.
update public.program_deal_versions
set is_default = false
where is_default and status <> 'active';

do $migration$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.program_deal_versions'::regclass
      and conname = 'program_deal_versions_default_requires_active'
  ) then
    alter table public.program_deal_versions
      add constraint program_deal_versions_default_requires_active
      check (not is_default or status = 'active');
  end if;
end;
$migration$;

create or replace function public.prevent_finalized_deal_changes()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception 'Finalized deal versions are immutable.';
    end if;

    return old;
  end if;

  if old.status = 'draft' then
    if new.status = 'retired' then
      raise exception 'A draft deal version must be activated before it can be retired.';
    end if;

    return new;
  end if;

  if new.id is distinct from old.id
    or new.deal_key is distinct from old.deal_key
    or new.version is distinct from old.version
    or new.label is distinct from old.label
    or new.terms_markdown is distinct from old.terms_markdown
    or new.terms_sha256 is distinct from old.terms_sha256
    or new.effective_at is distinct from old.effective_at
    or new.created_by is distinct from old.created_by
    or new.created_at is distinct from old.created_at
  then
    raise exception 'Finalized deal legal terms, version, and core content are immutable.';
  end if;

  if old.status = 'active' then
    if new.status not in ('active', 'retired') then
      raise exception 'An active deal version can only remain active or be retired.';
    end if;

    if new.status = 'retired' and new.is_default then
      raise exception 'Remove default status before retiring a deal version.';
    end if;

    return new;
  end if;

  if old.status = 'retired' then
    raise exception 'Retired deal versions are immutable.';
  end if;

  raise exception 'Unsupported deal version transition.';
end;
$$;

create trigger prevent_finalized_deal_changes
before update or delete on public.program_deal_versions
for each row execute function public.prevent_finalized_deal_changes();

-- Atomically hand the default to an existing draft/active version. Only an
-- active administrator may invoke this operation. If requested, the prior
-- default is retired in the same transaction, so approval never observes two
-- defaults or a partially applied handoff.
create or replace function public.rotate_default_program_deal_version(
  target_deal_version_id uuid,
  retire_previous boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  administrator_id uuid := auth.uid();
  target_status text;
  target_effective_at timestamptz;
  previous_default_id uuid;
begin
  if not exists (
    select 1
    from public.staff_members
    where auth_user_id = administrator_id
      and active
      and role = 'admin'
  ) then
    raise exception 'Administrator access required.' using errcode = '42501';
  end if;

  lock table public.program_deal_versions in share row exclusive mode;

  select status, effective_at
  into target_status, target_effective_at
  from public.program_deal_versions
  where id = target_deal_version_id
  for update;

  if target_status is null then
    raise exception 'Deal version was not found.' using errcode = '22023';
  end if;

  if target_status = 'retired' then
    raise exception 'A retired deal version cannot become the default.' using errcode = '22023';
  end if;

  if target_effective_at > now() then
    raise exception 'A future deal version cannot become the current default.' using errcode = '22023';
  end if;

  select id
  into previous_default_id
  from public.program_deal_versions
  where is_default and status = 'active'
  limit 1
  for update;

  if previous_default_id = target_deal_version_id then
    return target_deal_version_id;
  end if;

  if previous_default_id is not null then
    update public.program_deal_versions
    set is_default = false,
        status = case when retire_previous then 'retired' else 'active' end
    where id = previous_default_id;
  end if;

  update public.program_deal_versions
  set status = 'active',
      is_default = true,
      effective_at = coalesce(effective_at, now())
  where id = target_deal_version_id;

  return target_deal_version_id;
end;
$$;

-- Retire an active non-default version without changing its legal content. A
-- current default must first be handed off through the atomic rotation RPC.
create or replace function public.retire_program_deal_version(
  target_deal_version_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  administrator_id uuid := auth.uid();
  target_status text;
  target_is_default boolean;
begin
  if not exists (
    select 1
    from public.staff_members
    where auth_user_id = administrator_id
      and active
      and role = 'admin'
  ) then
    raise exception 'Administrator access required.' using errcode = '42501';
  end if;

  select status, is_default
  into target_status, target_is_default
  from public.program_deal_versions
  where id = target_deal_version_id
  for update;

  if target_status is null then
    raise exception 'Deal version was not found.' using errcode = '22023';
  end if;

  if target_status <> 'active' then
    raise exception 'Only an active deal version can be retired.' using errcode = '22023';
  end if;

  if target_is_default then
    raise exception 'Rotate the default before retiring this deal version.' using errcode = '22023';
  end if;

  update public.program_deal_versions
  set status = 'retired'
  where id = target_deal_version_id;

  return target_deal_version_id;
end;
$$;

revoke execute on function public.rotate_default_program_deal_version(uuid, boolean)
from public, anon;
grant execute on function public.rotate_default_program_deal_version(uuid, boolean)
to authenticated;

revoke execute on function public.retire_program_deal_version(uuid)
from public, anon;
grant execute on function public.retire_program_deal_version(uuid)
to authenticated;

revoke execute on function public.prevent_finalized_deal_changes() from public;

comment on function public.rotate_default_program_deal_version(uuid, boolean) is
  'Admin-only atomic default handoff. It never changes finalized legal terms or version content.';

comment on function public.retire_program_deal_version(uuid) is
  'Admin-only retirement for active non-default deal versions. Finalized legal content remains immutable.';

-- Provider completion is authoritative only when both its timestamp and hashed
-- completion evidence have been persisted. Other states cannot pre-populate
-- fields that would make an incomplete agreement look complete.
do $migration$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.agreement_records'::regclass
      and conname = 'agreement_records_completed_evidence_required'
  ) then
    alter table public.agreement_records
      add constraint agreement_records_completed_evidence_required
      check (
        (
          status = 'completed'
          and completed_at is not null
          and completion_evidence_sha256 is not null
        )
        or (
          status <> 'completed'
          and completed_at is null
          and completion_evidence_sha256 is null
        )
      );
  end if;
end;
$migration$;

-- Intentionally do not seed program_deal_versions. Approval remains fail-closed
-- until reviewed legal terms are inserted and an administrator explicitly
-- activates them as the default.
