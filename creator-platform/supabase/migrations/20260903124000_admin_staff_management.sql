-- Minimal administrator-managed staff access with an immutable audit ledger.
--
-- Staff can only be added from an existing, confirmed creator-platform auth
-- account. Active memberships are immutable through the browser boundary, and
-- inactive memberships can only be reactivated with their stored role. There
-- is no browser-callable deactivate, delete, demotion, or zero-admin bypass.

create table public.creator_staff_access_events (
  id bigint generated always as identity primary key,
  actor_kind text not null check (actor_kind in ('staff', 'service_role', 'db_owner')),
  actor_user_id uuid,
  actor_email_snapshot text,
  actor_reference text,
  target_user_id uuid not null,
  target_email_snapshot text not null,
  prior_role text check (prior_role is null or prior_role in ('reviewer', 'admin')),
  prior_active boolean,
  new_role text not null check (new_role in ('reviewer', 'admin')),
  new_active boolean not null check (new_active),
  request_outcome text not null check (request_outcome in ('added', 'reactivated')),
  created_at timestamptz not null default now(),
  check (
    actor_kind = 'staff'
      and actor_user_id is not null
      and actor_email_snapshot is not null
      and actor_reference is null
    or actor_kind in ('service_role', 'db_owner')
      and actor_user_id is null
      and actor_email_snapshot is null
      and char_length(btrim(actor_reference)) between 6 and 200
  ),
  check (
    actor_email_snapshot is null
    or actor_email_snapshot = lower(btrim(actor_email_snapshot))
      and actor_email_snapshot ~ '^[^[:space:]@]+@[^[:space:]@]+$'
  ),
  check (
    target_email_snapshot = lower(btrim(target_email_snapshot))
    and target_email_snapshot ~ '^[^[:space:]@]+@[^[:space:]@]+$'
  ),
  check (
    request_outcome = 'added'
      and prior_role is null
      and prior_active is null
    or request_outcome = 'reactivated'
      and prior_role = new_role
      and prior_active is false
  )
);

alter table public.creator_staff_access_events enable row level security;
revoke all on table public.creator_staff_access_events from public, anon, authenticated, service_role;
revoke all on sequence public.creator_staff_access_events_id_seq from public, anon, authenticated, service_role;

create or replace function public.reject_creator_staff_access_event_mutation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'Staff access audit events are immutable.' using errcode = '55000';
end;
$$;

create trigger creator_staff_access_events_are_immutable
before update or delete on public.creator_staff_access_events
for each row execute function public.reject_creator_staff_access_event_mutation();

create trigger creator_staff_access_events_reject_truncate
before truncate on public.creator_staff_access_events
for each statement execute function public.reject_creator_staff_access_event_mutation();

revoke execute on function public.reject_creator_staff_access_event_mutation()
  from public, anon, authenticated;

create or replace function public.get_creator_staff_directory()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
declare
  directory_members jsonb;
  recent_events jsonb;
begin
  if not public.creator_is_active_staff('admin') then
    raise exception 'Administrator access required.' using errcode = '42501';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'email', lower(btrim(auth_user.email)),
        'role', staff.role,
        'active', staff.active,
        'emailConfirmed', auth_user.email_confirmed_at is not null
      )
      order by
        staff.active desc,
        case staff.role when 'admin' then 0 else 1 end,
        lower(btrim(auth_user.email))
    ),
    '[]'::jsonb
  )
  into directory_members
  from public.staff_members staff
  join auth.users auth_user on auth_user.id = staff.auth_user_id;

  select coalesce(
    jsonb_agg(
      event_row.event_value
      order by event_row.created_at desc, event_row.id desc
    ),
    '[]'::jsonb
  )
  into recent_events
  from (
    select
      access_event.id,
      access_event.created_at,
      jsonb_build_object(
        'actor', case access_event.actor_kind
          when 'staff' then access_event.actor_email_snapshot
          when 'service_role' then 'Restricted service-role recovery'
          else 'Restricted DB-owner recovery'
        end,
        'targetEmail', access_event.target_email_snapshot,
        'priorRole', access_event.prior_role,
        'priorActive', access_event.prior_active,
        'newRole', access_event.new_role,
        'newActive', access_event.new_active,
        'outcome', access_event.request_outcome,
        'createdAt', access_event.created_at
      ) as event_value
    from public.creator_staff_access_events access_event
    order by access_event.created_at desc, access_event.id desc
    limit 20
  ) event_row;

  return jsonb_build_object(
    'staffMembers', directory_members,
    'recentEvents', recent_events
  );
end;
$$;

create or replace function public.add_or_reactivate_creator_staff(
  target_email text,
  target_role text,
  admin_confirmation text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  current_user_id uuid := auth.uid();
  current_user_email text;
  normalized_email text := lower(btrim(coalesce(target_email, '')));
  normalized_role text := lower(btrim(coalesce(target_role, '')));
  required_admin_confirmation text;
  target_user_id uuid;
  existing_role text;
  existing_active boolean;
  membership_exists boolean := false;
  request_outcome text := 'already_active';
begin
  if not public.creator_is_active_staff('admin') then
    raise exception 'Administrator access required.' using errcode = '42501';
  end if;

  select lower(btrim(auth_user.email))
  into current_user_email
  from auth.users auth_user
  where auth_user.id = current_user_id;

  if current_user_email is null then
    raise exception 'Administrator identity is unavailable.' using errcode = '42501';
  end if;

  if char_length(normalized_email) not between 3 and 254
    or normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+$'
  then
    raise exception 'Enter a valid account email.' using errcode = '22023';
  end if;

  if normalized_role not in ('reviewer', 'admin') then
    raise exception 'Choose reviewer or admin access.' using errcode = '22023';
  end if;

  required_admin_confirmation := 'GRANT ADMIN ACCESS TO ' || normalized_email;
  if normalized_role = 'admin'
    and admin_confirmation is distinct from required_admin_confirmation
  then
    raise exception 'Exact administrator access confirmation is required.'
      using errcode = '22023';
  end if;
  if normalized_role = 'reviewer'
    and nullif(btrim(coalesce(admin_confirmation, '')), '') is not null
  then
    raise exception 'Administrator confirmation is not accepted for reviewer access.'
      using errcode = '22023';
  end if;

  -- Match one canonical email exactly after trim/lower normalization. Joining
  -- creator_accounts proves this is an account created by this application;
  -- the confirmation condition prevents pre-verification access grants.
  select auth_user.id
  into target_user_id
  from auth.users auth_user
  join public.creator_accounts creator_account
    on creator_account.auth_user_id = auth_user.id
  where lower(btrim(coalesce(auth_user.email, ''))) = normalized_email
    and auth_user.email_confirmed_at is not null
  for update of auth_user;

  if target_user_id is null then
    raise exception 'No existing confirmed creator-platform account matches that email.'
      using errcode = 'P0002';
  end if;

  select staff.role, staff.active
  into existing_role, existing_active
  from public.staff_members staff
  where staff.auth_user_id = target_user_id
  for update;
  membership_exists := found;

  -- Neither active nor inactive memberships can change roles through this
  -- boundary. Reactivation means restoring the exact stored membership.
  if membership_exists and existing_role <> normalized_role then
    raise exception 'Existing staff roles cannot be changed through this recovery path.'
      using errcode = '55000';
  end if;

  if membership_exists and existing_active then
    request_outcome := 'already_active';
  elsif membership_exists then
    update public.staff_members staff
    set active = true
    where staff.auth_user_id = target_user_id
      and not staff.active;
    request_outcome := 'reactivated';
  else
    insert into public.staff_members (auth_user_id, role, active)
    values (target_user_id, normalized_role, true);
    request_outcome := 'added';
  end if;

  if request_outcome in ('added', 'reactivated') then
    insert into public.creator_staff_access_events (
      actor_kind,
      actor_user_id,
      actor_email_snapshot,
      target_user_id,
      target_email_snapshot,
      prior_role,
      prior_active,
      new_role,
      new_active,
      request_outcome
    ) values (
      'staff',
      current_user_id,
      current_user_email,
      target_user_id,
      normalized_email,
      case when membership_exists then existing_role else null end,
      case when membership_exists then existing_active else null end,
      normalized_role,
      true,
      request_outcome
    );
  end if;

  return jsonb_build_object(
    'staffMember', jsonb_build_object(
      'email', normalized_email,
      'role', normalized_role,
      'active', true,
      'emailConfirmed', true
    ),
    'requestOutcome', request_outcome
  );
end;
$$;

-- Deliberately not browser-callable. This narrow break-glass function exists
-- only for the zero-active-admin runbook and is executable by service_role or
-- the database owner. It refuses to run while any active admin exists.
create or replace function public.recover_zero_active_creator_admin(
  target_email text,
  recovery_reference text,
  recovery_confirmation text
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  normalized_email text := lower(btrim(coalesce(target_email, '')));
  normalized_reference text := btrim(coalesce(recovery_reference, ''));
  required_confirmation text;
  recovery_actor_kind text := case
    when auth.role() = 'service_role' then 'service_role'
    else 'db_owner'
  end;
  target_user_id uuid;
  existing_role text;
  existing_active boolean;
  membership_exists boolean := false;
  request_outcome text;
begin
  if coalesce(auth.role(), '') <> 'service_role'
    and session_user <> current_user
  then
    raise exception 'Service-role or direct database-owner access required.'
      using errcode = '42501';
  end if;

  lock table public.staff_members in share row exclusive mode;

  if exists (
    select 1 from public.staff_members staff
    where staff.active and staff.role = 'admin'
  ) then
    raise exception 'Zero-admin recovery is unavailable while an active administrator exists.'
      using errcode = '55000';
  end if;

  if char_length(normalized_email) not between 3 and 254
    or normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+$'
    or char_length(normalized_reference) not between 6 and 200
  then
    raise exception 'Recovery input is invalid.' using errcode = '22023';
  end if;

  required_confirmation := 'RECOVER ADMIN ACCESS FOR ' || normalized_email;
  if recovery_confirmation is distinct from required_confirmation then
    raise exception 'Exact zero-admin recovery confirmation is required.'
      using errcode = '22023';
  end if;

  select auth_user.id
  into target_user_id
  from auth.users auth_user
  join public.creator_accounts creator_account
    on creator_account.auth_user_id = auth_user.id
  where lower(btrim(coalesce(auth_user.email, ''))) = normalized_email
    and auth_user.email_confirmed_at is not null
  for update of auth_user;

  if target_user_id is null then
    raise exception 'No existing confirmed creator-platform account matches that email.'
      using errcode = 'P0002';
  end if;

  select staff.role, staff.active
  into existing_role, existing_active
  from public.staff_members staff
  where staff.auth_user_id = target_user_id
  for update;
  membership_exists := found;

  if membership_exists and (existing_active or existing_role <> 'admin') then
    raise exception 'Recovery target must be a new membership or an inactive administrator.'
      using errcode = '55000';
  end if;

  if membership_exists then
    update public.staff_members staff
    set active = true
    where staff.auth_user_id = target_user_id
      and not staff.active
      and staff.role = 'admin';
    request_outcome := 'reactivated';
  else
    insert into public.staff_members (auth_user_id, role, active)
    values (target_user_id, 'admin', true);
    request_outcome := 'added';
  end if;

  insert into public.creator_staff_access_events (
    actor_kind,
    actor_reference,
    target_user_id,
    target_email_snapshot,
    prior_role,
    prior_active,
    new_role,
    new_active,
    request_outcome
  ) values (
    recovery_actor_kind,
    normalized_reference,
    target_user_id,
    normalized_email,
    case when membership_exists then existing_role else null end,
    case when membership_exists then existing_active else null end,
    'admin',
    true,
    request_outcome
  );

  return jsonb_build_object(
    'staffMember', jsonb_build_object(
      'email', normalized_email,
      'role', 'admin',
      'active', true,
      'emailConfirmed', true
    ),
    'requestOutcome', request_outcome
  );
end;
$$;

revoke execute on function public.get_creator_staff_directory()
  from public, anon, authenticated;
grant execute on function public.get_creator_staff_directory()
  to authenticated;

revoke execute on function public.add_or_reactivate_creator_staff(text, text, text)
  from public, anon, authenticated;
grant execute on function public.add_or_reactivate_creator_staff(text, text, text)
  to authenticated;

revoke execute on function public.recover_zero_active_creator_admin(text, text, text)
  from public, anon, authenticated;
grant execute on function public.recover_zero_active_creator_admin(text, text, text)
  to service_role;

comment on table public.creator_staff_access_events is
  'Append-only staff access ledger. Browser projections omit user IDs, recovery references, and auth-provider internals.';
comment on function public.get_creator_staff_directory() is
  'Admin-only minimal staff identity, access state, and recent access events; excludes auth-provider metadata and credentials.';
comment on function public.add_or_reactivate_creator_staff(text, text, text) is
  'Admin-only add/reactivate boundary for one exact confirmed account. Existing roles remain immutable.';
comment on function public.recover_zero_active_creator_admin(text, text, text) is
  'Service-role or DB-owner break-glass recovery, available only while zero active administrators exist.';
