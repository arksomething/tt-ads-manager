-- Keep staff-only auth accounts out of the creator operations population.
--
-- The original workspace/profile projections remain the source of truth for
-- every field and metric. They are renamed to private implementation details,
-- stripped of client execution privileges, and wrapped with the participant
-- boundary introduced here. A participant is an account with an application
-- or an enrollment; merely granting an account a staff role does not make it
-- a creator.

alter function public.get_creator_admin_workspace(date, date)
  rename to get_creator_admin_workspace_unfiltered_20260831166000;

alter function public.get_creator_admin_profile(uuid)
  rename to get_creator_admin_profile_unfiltered_20260831166000;

revoke execute on function public.get_creator_admin_workspace_unfiltered_20260831166000(date, date)
  from public, anon, authenticated;
revoke execute on function public.get_creator_admin_profile_unfiltered_20260831166000(uuid)
  from public, anon, authenticated;

create function public.get_creator_admin_workspace(
  range_start date default (current_date - 6),
  range_end date default current_date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
declare
  workspace_result jsonb;
  participant_creators jsonb;
  participant_count integer;
  active_participant_count integer;
begin
  if not public.creator_is_active_staff('reviewer') then
    raise exception 'Reviewer access required.' using errcode = '42501';
  end if;

  -- The implementation function retains the original reporting-range
  -- validation and all projection behavior.
  workspace_result := public.get_creator_admin_workspace_unfiltered_20260831166000(
    range_start,
    range_end
  );

  with participant_rows as (
    select creator_row.value as creator, creator_row.ordinality
    from jsonb_array_elements(
      coalesce(workspace_result -> 'creators', '[]'::jsonb)
    ) with ordinality as creator_row(value, ordinality)
    where exists (
      select 1
      from public.creator_applications application_record
      where application_record.account_id = (creator_row.value ->> 'accountId')::uuid
    )
    or exists (
      select 1
      from public.creator_enrollments enrollment_record
      where enrollment_record.account_id = (creator_row.value ->> 'accountId')::uuid
    )
  )
  select
    coalesce(
      jsonb_agg(participant_rows.creator order by participant_rows.ordinality),
      '[]'::jsonb
    ),
    count(*)::integer,
    count(*) filter (
      where participant_rows.creator ->> 'lifecycleStatus' = 'active'
    )::integer
  into participant_creators, participant_count, active_participant_count
  from participant_rows;

  workspace_result := jsonb_set(
    workspace_result,
    '{creators}',
    participant_creators,
    true
  );
  workspace_result := jsonb_set(
    workspace_result,
    '{summary,creatorCount}',
    to_jsonb(participant_count),
    true
  );
  workspace_result := jsonb_set(
    workspace_result,
    '{summary,activeCreatorCount}',
    to_jsonb(active_participant_count),
    true
  );

  return workspace_result;
end;
$$;

create function public.get_creator_admin_profile(target_account_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
declare
  profile_result jsonb;
begin
  if not public.creator_is_active_staff('reviewer') then
    raise exception 'Reviewer access required.' using errcode = '42501';
  end if;

  -- Delegate only after enforcing the same reviewer boundary as the original
  -- projection. The retained implementation repeats that check defensively.
  profile_result := public.get_creator_admin_profile_unfiltered_20260831166000(
    target_account_id
  );

  if not exists (
    select 1
    from public.creator_applications application_record
    where application_record.account_id = target_account_id
  ) and not exists (
    select 1
    from public.creator_enrollments enrollment_record
    where enrollment_record.account_id = target_account_id
  ) then
    raise exception 'Creator account was not found.' using errcode = 'P0002';
  end if;

  return profile_result;
end;
$$;

revoke execute on function public.get_creator_admin_workspace(date, date) from public, anon;
revoke execute on function public.get_creator_admin_profile(uuid) from public, anon;
grant execute on function public.get_creator_admin_workspace(date, date) to authenticated;
grant execute on function public.get_creator_admin_profile(uuid) to authenticated;

comment on function public.get_creator_admin_workspace(date, date) is
  'Staff-only creator operations projection. Creator counts and directory rows require an application or enrollment; view gains remain null unless both boundary observations exist.';
comment on function public.get_creator_admin_profile(uuid) is
  'Staff-only creator profile projection. Staff-only and other nonparticipant accounts are not creator profiles.';
comment on function public.get_creator_admin_workspace_unfiltered_20260831166000(date, date) is
  'Private implementation snapshot retained for the participant-filtered admin workspace wrapper.';
comment on function public.get_creator_admin_profile_unfiltered_20260831166000(uuid) is
  'Private implementation snapshot retained for the participant-filtered admin profile wrapper.';
