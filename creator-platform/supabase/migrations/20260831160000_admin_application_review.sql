-- Staff-reviewed creator application lifecycle.
--
-- All reads and mutations in this migration derive the reviewer from auth.uid().
-- The web application never receives the service-role credential, and applicant
-- reads remain limited to the explicitly public decision message.

alter table public.creator_applications
  drop constraint if exists creator_applications_status_check;

alter table public.creator_applications
  add constraint creator_applications_status_check
  check (status in (
    'submitted',
    'in_review',
    'changes_requested',
    'approved',
    'rejected',
    'withdrawn'
  ));

alter table public.creator_applications
  add column if not exists decision_message text,
  add column if not exists review_revision integer not null default 0;

alter table public.creator_applications
  drop constraint if exists creator_applications_decision_message_length;

alter table public.creator_applications
  add constraint creator_applications_decision_message_length
  check (
    decision_message is null
    or char_length(decision_message) between 1 and 2000
  );

alter table public.creator_applications
  drop constraint if exists creator_applications_review_note_length;

alter table public.creator_applications
  add constraint creator_applications_review_note_length
  check (review_note is null or char_length(review_note) between 1 and 4000);

alter table public.creator_applications
  drop constraint if exists creator_applications_review_revision_nonnegative;

alter table public.creator_applications
  add constraint creator_applications_review_revision_nonnegative
  check (review_revision >= 0);

comment on column public.creator_applications.decision_message is
  'Applicant-safe review message. Internal reviewer notes remain in review_note and the staff-only event ledger.';

comment on column public.creator_applications.review_revision is
  'Number of staff-requested revisions the creator has resubmitted.';

-- A placeholder agreement is created atomically with approval, but is not
-- presented as ready to sign until a provider adapter promotes it from
-- `preparing`. This keeps the enrollment/deal snapshot complete without making
-- a false delivery claim or triggering the existing agreement-ready reminders.
alter table public.agreement_records
  drop constraint if exists agreement_records_status_check;

alter table public.agreement_records
  add constraint agreement_records_status_check
  check (status in (
    'preparing',
    'pending',
    'sent',
    'viewed',
    'creator_accepted',
    'completed',
    'declined',
    'voided',
    'error'
  ));

-- Submission remains one-shot unless a staff reviewer explicitly requests a
-- revision. A requested revision uses the same validated public endpoint, then
-- returns to `submitted` while retaining the immutable audit events.
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
  existing_application_status text;
  submitted_application_id uuid;
  submitted_revision integer := 0;
  submitted_name text := btrim(coalesce(application_input->>'name', ''));
  submitted_phone text := regexp_replace(btrim(coalesce(application_input->>'phoneNumber', '')), '[^0-9+]', '', 'g');
  submitted_discord text := btrim(coalesce(application_input->>'discordUsername', ''));
  submitted_accounts jsonb := application_input->'accounts';
  account_item jsonb;
  account_platform text;
  entered_handle text;
  normalized_handle text;
  account_count integer;
  is_revision boolean := false;
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

  -- Serialize first submission and resubmission against this creator account.
  insert into public.creator_accounts (auth_user_id, email_snapshot, lifecycle_status)
  values (current_user_id, current_user_email, 'application_pending')
  on conflict (auth_user_id) do update
  set email_snapshot = excluded.email_snapshot;

  select application_record.id, application_record.status
  into existing_application_id, existing_application_status
  from public.creator_applications application_record
  where application_record.account_id = current_user_id
  for update;

  if existing_application_id is not null
    and existing_application_status <> 'changes_requested'
  then
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

  if existing_application_id is null then
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
    returning id, review_revision
    into submitted_application_id, submitted_revision;
  else
    is_revision := true;

    update public.creator_applications application_record
    set name = submitted_name,
        phone_e164 = submitted_phone,
        discord_username = submitted_discord,
        status = 'submitted',
        submitted_at = now(),
        reviewed_at = null,
        reviewed_by = null,
        review_note = null,
        decision_message = null,
        review_revision = application_record.review_revision + 1
    where application_record.id = existing_application_id
    returning application_record.id, application_record.review_revision
    into submitted_application_id, submitted_revision;

    delete from public.creator_application_handles handle_record
    where handle_record.application_id = submitted_application_id;
  end if;

  update public.creator_accounts
  set lifecycle_status = 'application_pending'
  where auth_user_id = current_user_id;

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
    case when is_revision then 'resubmitted' else 'submitted' end,
    jsonb_build_object(
      'account_count', account_count,
      'review_revision', submitted_revision
    )
  );

  return query select submitted_application_id, 'submitted'::text;
exception
  when unique_violation then
    raise exception 'List each creator handle only once per platform.'
      using errcode = '22023';
end;
$$;

-- Recreate the applicant-safe RPC to include only the public decision message.
-- Internal notes, staff IDs, and audit metadata remain outside this boundary.
drop function if exists public.get_own_creator_application();

create function public.get_own_creator_application()
returns table (
  application_id uuid,
  applicant_name text,
  phone_e164 text,
  discord_username text,
  application_status text,
  submitted_at timestamptz,
  reviewed_at timestamptz,
  decision_message text,
  review_revision integer,
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
    application_record.decision_message,
    application_record.review_revision,
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

create or replace function public.get_staff_creator_application_queue(
  application_status_filter text default null
)
returns table (applications jsonb)
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
declare
  current_staff_id uuid := auth.uid();
  normalized_filter text := nullif(lower(btrim(coalesce(application_status_filter, ''))), '');
begin
  if not exists (
    select 1
    from public.staff_members staff
    where staff.auth_user_id = current_staff_id
      and staff.active
      and staff.role in ('reviewer', 'admin')
  ) then
    raise exception 'Reviewer access required.' using errcode = '42501';
  end if;

  if normalized_filter is not null
    and normalized_filter not in (
      'submitted', 'in_review', 'changes_requested', 'approved', 'rejected', 'withdrawn'
    )
  then
    raise exception 'Unsupported application status filter.' using errcode = '22023';
  end if;

  return query
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', application_record.id,
        'name', application_record.name,
        'email', creator_account.email_snapshot,
        'discordUsername', application_record.discord_username,
        'status', application_record.status,
        'lifecycleStatus', creator_account.lifecycle_status,
        'submittedAt', application_record.submitted_at,
        'reviewedAt', application_record.reviewed_at,
        'reviewRevision', application_record.review_revision,
        'handleCount', (
          select count(*)::integer
          from public.creator_application_handles handle_record
          where handle_record.application_id = application_record.id
        ),
        'platforms', coalesce(
          (
            select jsonb_agg(platform_record.platform order by platform_record.platform)
            from (
              select distinct handle_record.platform
              from public.creator_application_handles handle_record
              where handle_record.application_id = application_record.id
            ) platform_record
          ),
          '[]'::jsonb
        )
      )
      order by
        case application_record.status
          when 'submitted' then 0
          when 'in_review' then 1
          when 'changes_requested' then 2
          else 3
        end,
        application_record.submitted_at asc
    ),
    '[]'::jsonb
  )
  from public.creator_applications application_record
  join public.creator_accounts creator_account
    on creator_account.auth_user_id = application_record.account_id
  where normalized_filter is null
    or application_record.status = normalized_filter;
end;
$$;

create or replace function public.get_staff_creator_application(
  target_application_id uuid
)
returns table (application jsonb)
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
declare
  current_staff_id uuid := auth.uid();
begin
  if not exists (
    select 1
    from public.staff_members staff
    where staff.auth_user_id = current_staff_id
      and staff.active
      and staff.role in ('reviewer', 'admin')
  ) then
    raise exception 'Reviewer access required.' using errcode = '42501';
  end if;

  return query
  select jsonb_build_object(
    'id', application_record.id,
    'accountId', application_record.account_id,
    'name', application_record.name,
    'email', creator_account.email_snapshot,
    'phoneNumber', application_record.phone_e164,
    'discordUsername', application_record.discord_username,
    'status', application_record.status,
    'lifecycleStatus', creator_account.lifecycle_status,
    'submittedAt', application_record.submitted_at,
    'reviewedAt', application_record.reviewed_at,
    'decisionMessage', application_record.decision_message,
    'staffNote', application_record.review_note,
    'reviewRevision', application_record.review_revision,
    'handles', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', handle_record.id,
            'platform', handle_record.platform,
            'handle', handle_record.entered_handle,
            'normalizedHandle', handle_record.normalized_handle
          )
          order by handle_record.platform, handle_record.normalized_handle
        )
        from public.creator_application_handles handle_record
        where handle_record.application_id = application_record.id
      ),
      '[]'::jsonb
    ),
    'enrollment', case
      when enrollment_record.id is null then null
      else jsonb_build_object(
        'id', enrollment_record.id,
        'status', enrollment_record.status,
        'approvedAt', enrollment_record.approved_at,
        'dealVersionId', enrollment_record.deal_version_id,
        'dealLabel', deal_record.label,
        'dealVersion', deal_record.version
      )
    end,
    'agreement', case
      when agreement_record.id is null then null
      else jsonb_build_object(
        'id', agreement_record.id,
        'provider', agreement_record.provider,
        'status', agreement_record.status,
        'createdAt', agreement_record.created_at
      )
    end,
    'auditEvents', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', event_record.id,
            'type', event_record.event_type,
            'actorUserId', event_record.actor_user_id,
            'metadata', event_record.metadata,
            'createdAt', event_record.created_at
          )
          order by event_record.created_at desc, event_record.id desc
        )
        from public.creator_application_events event_record
        where event_record.application_id = application_record.id
      ),
      '[]'::jsonb
    )
  )
  from public.creator_applications application_record
  join public.creator_accounts creator_account
    on creator_account.auth_user_id = application_record.account_id
  left join public.creator_enrollments enrollment_record
    on enrollment_record.application_id = application_record.id
  left join public.program_deal_versions deal_record
    on deal_record.id = enrollment_record.deal_version_id
  left join lateral (
    select agreement.*
    from public.agreement_records agreement
    where agreement.enrollment_id = enrollment_record.id
    order by agreement.created_at desc
    limit 1
  ) agreement_record on true
  where application_record.id = target_application_id;
end;
$$;

create or replace function public.review_creator_application(
  target_application_id uuid,
  review_action text,
  applicant_message text default null,
  staff_note text default null
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
  public_message text := nullif(btrim(coalesce(applicant_message, '')), '');
  internal_note text := nullif(btrim(coalesce(staff_note, '')), '');
  application_record public.creator_applications%rowtype;
  target_email text;
  default_deal_id uuid;
  created_enrollment_id uuid;
  created_agreement_id uuid;
  next_application_status text;
  next_lifecycle_status text;
  audit_event_type text;
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

  if normalized_action not in ('start_review', 'request_changes', 'reject', 'approve') then
    raise exception 'Unsupported review action.' using errcode = '22023';
  end if;

  if public_message is not null and char_length(public_message) > 2000 then
    raise exception 'Applicant message is too long.' using errcode = '22023';
  end if;

  if internal_note is not null and char_length(internal_note) > 4000 then
    raise exception 'Internal note is too long.' using errcode = '22023';
  end if;

  if normalized_action in ('request_changes', 'reject') and public_message is null then
    raise exception 'An applicant-facing message is required for this decision.'
      using errcode = '22023';
  end if;

  select application.*
  into application_record
  from public.creator_applications application
  where application.id = target_application_id
  for update;

  if application_record.id is null then
    raise exception 'Application was not found.' using errcode = 'P0002';
  end if;

  select creator_account.email_snapshot
  into target_email
  from public.creator_accounts creator_account
  where creator_account.auth_user_id = application_record.account_id;

  if normalized_action = 'start_review' then
    if application_record.status <> 'submitted' then
      raise exception 'Only a submitted application can enter review.' using errcode = '22023';
    end if;

    next_application_status := 'in_review';
    next_lifecycle_status := 'application_in_review';
    audit_event_type := 'review_started';
    public_message := null;
  elsif normalized_action = 'request_changes' then
    if application_record.status not in ('submitted', 'in_review') then
      raise exception 'This application cannot request changes from its current state.'
        using errcode = '22023';
    end if;

    next_application_status := 'changes_requested';
    next_lifecycle_status := 'application_pending';
    audit_event_type := 'changes_requested';
  elsif normalized_action = 'reject' then
    if application_record.status not in ('submitted', 'in_review', 'changes_requested') then
      raise exception 'This application cannot be rejected from its current state.'
        using errcode = '22023';
    end if;

    next_application_status := 'rejected';
    next_lifecycle_status := 'closed';
    audit_event_type := 'rejected';
  else
    if application_record.status not in ('submitted', 'in_review') then
      raise exception 'Only a submitted or in-review application can be approved.'
        using errcode = '22023';
    end if;

    select deal_version.id
    into default_deal_id
    from public.program_deal_versions deal_version
    where deal_version.is_default
      and deal_version.status = 'active'
      and deal_version.effective_at <= now()
    order by deal_version.version desc
    limit 1
    for share;

    if default_deal_id is null then
      raise exception 'No active default deal version is configured.' using errcode = '55000';
    end if;

    insert into public.creator_enrollments (
      account_id,
      application_id,
      deal_version_id,
      approved_by
    ) values (
      application_record.account_id,
      application_record.id,
      default_deal_id,
      reviewer_id
    )
    returning id into created_enrollment_id;

    insert into public.agreement_records (
      enrollment_id,
      deal_version_id,
      provider,
      provider_environment,
      signer_name_snapshot,
      signer_email_snapshot,
      status
    ) values (
      created_enrollment_id,
      default_deal_id,
      'unassigned',
      'pending_adapter',
      application_record.name,
      target_email,
      'preparing'
    )
    returning id into created_agreement_id;

    next_application_status := 'approved';
    next_lifecycle_status := 'agreement_pending';
    audit_event_type := 'approved';
    public_message := coalesce(
      public_message,
      'Your creator application was approved. Continue to the onboarding steps in your account.'
    );
  end if;

  update public.creator_applications
  set status = next_application_status,
      reviewed_at = now(),
      reviewed_by = reviewer_id,
      review_note = internal_note,
      decision_message = public_message
  where id = application_record.id;

  update public.creator_accounts
  set lifecycle_status = next_lifecycle_status
  where auth_user_id = application_record.account_id;

  insert into public.creator_application_events (
    application_id,
    actor_user_id,
    event_type,
    metadata
  ) values (
    application_record.id,
    reviewer_id,
    audit_event_type,
    jsonb_strip_nulls(jsonb_build_object(
      'from_status', application_record.status,
      'to_status', next_application_status,
      'applicant_message', public_message,
      'staff_note', internal_note,
      'review_revision', application_record.review_revision,
      'deal_version_id', default_deal_id,
      'enrollment_id', created_enrollment_id,
      'agreement_id', created_agreement_id
    ))
  );

  return query
  select
    application_record.id,
    next_application_status,
    next_lifecycle_status,
    created_enrollment_id,
    created_agreement_id;
end;
$$;

revoke execute on function public.submit_creator_application(jsonb)
from public, anon;
grant execute on function public.submit_creator_application(jsonb)
to authenticated;

revoke execute on function public.get_own_creator_application()
from public, anon;
grant execute on function public.get_own_creator_application()
to authenticated;

revoke execute on function public.get_staff_creator_application_queue(text)
from public, anon;
grant execute on function public.get_staff_creator_application_queue(text)
to authenticated;

revoke execute on function public.get_staff_creator_application(uuid)
from public, anon;
grant execute on function public.get_staff_creator_application(uuid)
to authenticated;

revoke execute on function public.review_creator_application(uuid, text, text, text)
from public, anon;
grant execute on function public.review_creator_application(uuid, text, text, text)
to authenticated;

comment on function public.get_staff_creator_application_queue(text) is
  'Reviewer-only application queue. Authorization is derived from auth.uid() inside the database.';

comment on function public.get_staff_creator_application(uuid) is
  'Reviewer-only application detail including staff notes and append-only application events.';

comment on function public.review_creator_application(uuid, text, text, text) is
  'Atomic staff decision boundary for review, change request, rejection, approval, enrollment, deal assignment, placeholder agreement, lifecycle, and audit state.';
