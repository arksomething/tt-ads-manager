-- Separate an assigned legal document from an actively leased provider job.
-- This closes the approval-to-SignWell deadlock without weakening provider
-- deduplication or the ten-minute provisioning lease.

alter table public.agreement_records
  drop constraint if exists agreement_records_status_check;

alter table public.agreement_records
  add constraint agreement_records_status_check
  check (status in (
    'assigned',
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

-- Only repair untouched approval placeholders. A real provider attempt keeps
-- `preparing`, including an expired attempt that is eligible for a controlled
-- lease recovery below.
update public.agreement_records
set status = 'assigned'
where status = 'preparing'
  and provider = 'unassigned'
  and provider_environment = 'pending_adapter'
  and external_agreement_id is null
  and provider_template_id is null
  and provisioning_token is null
  and provisioning_started_at is null
  and signing_requested_at is null;

-- Bind every agreement's immutable deal snapshot to the same deal assigned to
-- its enrollment. The primary key on `id` is not sufficient as a composite FK
-- target, so retain an explicit unique enrollment/deal identity.
alter table public.creator_enrollments
  add constraint creator_enrollments_id_deal_version_id_key
  unique (id, deal_version_id);

alter table public.agreement_records
  add constraint agreement_records_enrollment_deal_version_fkey
  foreign key (enrollment_id, deal_version_id)
  references public.creator_enrollments (id, deal_version_id)
  on delete cascade;

-- Keep the current staff-review implementation intact while changing its
-- approval placeholder to the truthful, non-leased `assigned` state. Abort if
-- the installed definition is unfamiliar rather than performing a broad edit.
do $migration$
declare
  current_definition text;
  patched_definition text;
  preparing_occurrences integer;
begin
  select pg_get_functiondef(
    'public.review_creator_application(uuid,text,text,text)'::regprocedure
  ) into current_definition;

  if current_definition is null then
    raise exception 'review_creator_application(uuid,text,text,text) is not installed.';
  end if;

  preparing_occurrences := (
    char_length(current_definition)
    - char_length(replace(current_definition, '''preparing''', ''))
  ) / char_length('''preparing''');

  if preparing_occurrences = 1 then
    patched_definition := replace(
      current_definition,
      '''preparing''',
      '''assigned'''
    );
    execute patched_definition;
  elsif preparing_occurrences = 0
    and position('''assigned''' in current_definition) > 0
  then
    null;
  else
    raise exception 'The application approval agreement-state mapping was not recognized.';
  end if;
end
$migration$;

-- The original approval RPC predates atomic agreement creation and must not be
-- callable by browser roles. All approvals go through review_creator_application.
revoke execute on function public.approve_creator_application(uuid)
from public, anon, authenticated;

-- Return the lease timestamp so the application can distinguish a fresh
-- in-flight preparation from an expired attempt. PostgreSQL cannot change a
-- function's table return shape with CREATE OR REPLACE, so replace it explicitly.
drop function public.get_own_agreement_signing_context();

create function public.get_own_agreement_signing_context()
returns table (
  agreement_id uuid,
  enrollment_id uuid,
  deal_version_id uuid,
  provider text,
  provider_environment text,
  external_agreement_id text,
  agreement_status text,
  signer_name text,
  signer_email text,
  provisioning_started_at timestamptz,
  sent_at timestamptz,
  completed_at timestamptz
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
    agreement_record.id,
    agreement_record.enrollment_id,
    agreement_record.deal_version_id,
    agreement_record.provider,
    agreement_record.provider_environment,
    agreement_record.external_agreement_id,
    agreement_record.status,
    agreement_record.signer_name_snapshot,
    agreement_record.signer_email_snapshot,
    agreement_record.provisioning_started_at,
    agreement_record.sent_at,
    agreement_record.completed_at
  from public.agreement_records agreement_record
  join public.creator_enrollments enrollment_record
    on enrollment_record.id = agreement_record.enrollment_id
    and enrollment_record.deal_version_id = agreement_record.deal_version_id
  where enrollment_record.account_id = current_user_id
  order by agreement_record.created_at desc
  limit 1;
end;
$$;

revoke execute on function public.get_own_agreement_signing_context()
from public, anon;
grant execute on function public.get_own_agreement_signing_context()
to authenticated;

create or replace function public.begin_own_signwell_agreement_provisioning(
  target_account_id uuid,
  target_environment text
)
returns table (
  agreement_id uuid,
  provisioning_token uuid,
  enrollment_id uuid,
  deal_version_id uuid,
  deal_terms_sha256 text,
  signer_name text,
  signer_email text,
  external_agreement_id text
)
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  current_user_id uuid := target_account_id;
  normalized_environment text := lower(btrim(coalesce(target_environment, '')));
  agreement_record public.agreement_records%rowtype;
  next_token uuid := gen_random_uuid();
begin
  if coalesce(auth.role(), '') <> 'service_role' or current_user_id is null then
    raise exception 'Service-role access required.' using errcode = '42501';
  end if;

  if normalized_environment not in ('test', 'production') then
    raise exception 'Unsupported agreement environment.' using errcode = '22023';
  end if;

  select agreement.*
  into agreement_record
  from public.agreement_records agreement
  join public.creator_enrollments enrollment
    on enrollment.id = agreement.enrollment_id
    and enrollment.deal_version_id = agreement.deal_version_id
  where enrollment.account_id = current_user_id
  order by agreement.created_at desc
  limit 1
  for update of agreement;

  if agreement_record.id is null then
    raise exception 'No assigned creator agreement was found.' using errcode = '22023';
  end if;

  if agreement_record.status not in ('assigned', 'pending', 'error', 'preparing') then
    raise exception 'The agreement cannot be prepared from its current state.' using errcode = '22023';
  end if;

  -- Preserve the provider-wide lease fence even if an asynchronous provider
  -- event changes the visible status before the original request finishes.
  if agreement_record.provisioning_token is not null
    and (
      agreement_record.provisioning_started_at is null
      or agreement_record.provisioning_started_at > now() - interval '10 minutes'
    )
  then
    raise exception 'Agreement preparation is already in progress.' using errcode = '55P03';
  end if;

  -- `preparing` always means a provider job was leased. It may be recovered
  -- only after the same ten-minute fence used by the route and UI. A missing
  -- timestamp is malformed state, not permission to create another document.
  if agreement_record.status = 'preparing'
    and (
      agreement_record.provisioning_started_at is null
      or agreement_record.provisioning_started_at > now() - interval '10 minutes'
    )
  then
    raise exception 'Agreement preparation is already in progress.' using errcode = '55P03';
  end if;

  if exists (
    select 1
    from public.creator_enrollments enrollment_record
    join public.creator_application_handles required_handle
      on required_handle.application_id = enrollment_record.application_id
    left join public.creator_platform_account_claims claim_record
      on claim_record.application_handle_id = required_handle.id
    where enrollment_record.id = agreement_record.enrollment_id
      and coalesce(claim_record.status, 'missing') <> 'verified'
  ) then
    raise exception 'Verify every campaign account before preparing the agreement.' using errcode = '42501';
  end if;

  update public.agreement_records
  set provider = 'signwell',
      provider_environment = normalized_environment,
      status = 'preparing',
      provisioning_token = next_token,
      provisioning_started_at = now(),
      last_provider_error_code = null
  where id = agreement_record.id;

  return query select
    agreement_record.id,
    next_token,
    agreement_record.enrollment_id,
    agreement_record.deal_version_id,
    (
      select deal_version.terms_sha256
      from public.program_deal_versions deal_version
      where deal_version.id = agreement_record.deal_version_id
    ),
    agreement_record.signer_name_snapshot,
    agreement_record.signer_email_snapshot,
    agreement_record.external_agreement_id;
end;
$$;

revoke execute on function public.begin_own_signwell_agreement_provisioning(uuid, text)
from public, anon, authenticated;
grant execute on function public.begin_own_signwell_agreement_provisioning(uuid, text)
to service_role;

comment on function public.get_own_agreement_signing_context() is
  'Creator-owned agreement snapshot including the provisioning lease timestamp used for safe retry presentation.';

comment on function public.begin_own_signwell_agreement_provisioning(uuid, text) is
  'Service-role-only SignWell lease acquisition from assigned, pending, error, or preparing after the ten-minute lease expires.';
