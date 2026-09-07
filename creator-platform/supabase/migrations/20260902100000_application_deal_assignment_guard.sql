-- Require an explicit, current deal-snapshot review before staff approval can
-- assign a creator. Non-approval review actions continue through the same
-- atomic implementation without accepting deal-confirmation inputs.

create or replace function public.review_creator_application_v2(
  target_application_id uuid,
  review_action text,
  applicant_message text default null,
  staff_note text default null,
  deal_review_confirmed boolean default false,
  expected_deal_version_id uuid default null,
  expected_deal_snapshot_sha256 text default null
)
returns table (
  application_id uuid,
  application_status text,
  lifecycle_status text,
  enrollment_id uuid,
  agreement_id uuid
)
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  reviewer_id uuid := auth.uid();
  normalized_action text := lower(btrim(coalesce(review_action, '')));
  normalized_expected_snapshot text := nullif(
    btrim(coalesce(expected_deal_snapshot_sha256, '')),
    ''
  );
  default_deal public.program_deal_versions%rowtype;
  readiness_blockers text[];
begin
  if not exists (
    select 1
    from public.staff_members staff
    where staff.auth_user_id = reviewer_id
      and staff.active
      and staff.role in ('reviewer', 'admin')
  ) then
    raise exception 'Reviewer access required.' using errcode = '42501';
  end if;

  if normalized_action = 'approve' then
    if deal_review_confirmed is not true
      or expected_deal_version_id is null
      or normalized_expected_snapshot is null
      or normalized_expected_snapshot !~ '^[a-f0-9]{64}$'
    then
      raise exception 'Confirm the exact active deal snapshot before approval.'
        using errcode = '22023';
    end if;

    -- Lock the authoritative default through the delegated approval. The
    -- legacy function re-reads this same row in this transaction, so it cannot
    -- rotate between confirmation and enrollment creation.
    select deal_version.*
    into default_deal
    from public.program_deal_versions deal_version
    where deal_version.is_default
      and deal_version.status = 'active'
      and deal_version.effective_at <= now()
    order by deal_version.version desc
    limit 1
    for share;

    if default_deal.id is null then
      raise exception 'No effective active default deal version is configured.'
        using errcode = '55000';
    end if;

    if default_deal.id is distinct from expected_deal_version_id
      or default_deal.snapshot_sha256 is distinct from normalized_expected_snapshot
    then
      raise exception 'The active default deal changed. Refresh and review it again.'
        using errcode = '22023';
    end if;

    readiness_blockers := public.admin_program_deal_readiness(default_deal.id);
    if readiness_blockers is null or cardinality(readiness_blockers) <> 0 then
      raise exception 'The active default deal is not ready for creator assignment.'
        using errcode = '55000';
    end if;
  else
    if coalesce(deal_review_confirmed, false)
      or expected_deal_version_id is not null
      or expected_deal_snapshot_sha256 is not null
    then
      raise exception 'Deal confirmation is accepted only for approval.'
        using errcode = '22023';
    end if;
  end if;

  -- PostgreSQL functions execute atomically with their caller. Delegate the
  -- existing application-state, enrollment, agreement, and audit mutation so
  -- this guard does not create a second approval implementation.
  return query
  select *
  from public.review_creator_application(
    target_application_id,
    review_action,
    applicant_message,
    staff_note
  );
end;
$$;

-- Browser roles may enter the approval boundary only through the guarded
-- wrapper. Its definer retains permission to call the legacy implementation.
revoke execute on function public.review_creator_application(uuid, text, text, text)
from public, anon, authenticated;

revoke execute on function public.review_creator_application_v2(uuid, text, text, text, boolean, uuid, text)
from public, anon;
grant execute on function public.review_creator_application_v2(uuid, text, text, text, boolean, uuid, text)
to authenticated;

comment on function public.review_creator_application_v2(uuid, text, text, text, boolean, uuid, text) is
  'Authenticated staff application-review boundary. Approval requires an explicitly confirmed, ready, effective active-default deal UUID and immutable snapshot hash.';
