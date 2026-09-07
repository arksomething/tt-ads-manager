-- Fail-closed SignWell provisioning and verified, idempotent webhook updates.
-- The provider remains disabled in the web runtime until an approved template,
-- rotated API key, webhook ID, and explicit send flag are all configured.

alter table public.agreement_records
  add column if not exists provisioning_token uuid,
  add column if not exists provisioning_started_at timestamptz,
  add column if not exists signing_requested_at timestamptz,
  add column if not exists last_provider_error_code text,
  add column if not exists provider_template_id text,
  add column if not exists deal_terms_sha256 text,
  add column if not exists completed_artifact_ref text,
  add column if not exists completed_artifact_size_bytes bigint,
  add column if not exists completed_artifact_archived_at timestamptz;

alter table public.agreement_records
  drop constraint if exists agreement_records_signwell_evidence_shape;

alter table public.agreement_records
  add constraint agreement_records_signwell_evidence_shape
  check (
    (provider_template_id is null or provider_template_id ~ '^[0-9a-fA-F-]{20,80}$')
    and (deal_terms_sha256 is null or deal_terms_sha256 ~ '^[a-f0-9]{64}$')
    and (
      completed_artifact_ref is null
      or (
        char_length(completed_artifact_ref) between 20 and 1024
        and completed_artifact_ref !~ '(^|/)\.\.(/|$)'
      )
    )
    and (completed_artifact_size_bytes is null or completed_artifact_size_bytes between 1 and 33554432)
    and (
      status <> 'completed'
      or (
        completion_evidence_sha256 is not null
        and completed_artifact_ref is not null
        and completed_artifact_size_bytes is not null
        and completed_artifact_archived_at is not null
        and provider_template_id is not null
        and deal_terms_sha256 is not null
      )
    )
  );

-- Supabase Storage is present in production but not in the disposable SQL
-- harness. Create a private artifact bucket only when that managed schema is
-- available; agreement completion still fails closed unless the web runtime
-- archives the audited PDF and supplies its hash/reference.
do $migration$
begin
  if to_regclass('storage.buckets') is not null then
    execute $sql$
      insert into storage.buckets (id, name, public)
      values ('creator-agreements', 'creator-agreements', false)
      on conflict (id) do update set public = false
    $sql$;
  end if;
end
$migration$;

alter table public.agreement_events
  add column if not exists external_agreement_id text;

alter table public.agreement_events
  drop constraint if exists agreement_events_external_agreement_id_length;

alter table public.agreement_events
  add constraint agreement_events_external_agreement_id_length
  check (
    external_agreement_id is null
    or char_length(external_agreement_id) between 20 and 191
  );

create index if not exists agreement_events_pending_provider_document
  on public.agreement_events (provider, external_agreement_id, processing_status)
  where agreement_id is null and external_agreement_id is not null;

alter table public.agreement_records
  drop constraint if exists agreement_records_provisioning_lease_complete;

alter table public.agreement_records
  add constraint agreement_records_provisioning_lease_complete
  check (
    (provisioning_token is null and provisioning_started_at is null)
    or (provisioning_token is not null and provisioning_started_at is not null)
  );

create or replace function public.get_own_agreement_signing_context()
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
    agreement_record.sent_at,
    agreement_record.completed_at
  from public.agreement_records agreement_record
  join public.creator_enrollments enrollment_record
    on enrollment_record.id = agreement_record.enrollment_id
  where enrollment_record.account_id = current_user_id
  order by agreement_record.created_at desc
  limit 1;
end;
$$;

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
  where enrollment.account_id = current_user_id
  order by agreement.created_at desc
  limit 1
  for update of agreement;

  if agreement_record.id is null then
    raise exception 'No assigned creator agreement was found.' using errcode = '22023';
  end if;

  if agreement_record.status not in ('preparing', 'pending', 'error') then
    raise exception 'The agreement cannot be prepared from its current state.' using errcode = '22023';
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

  if agreement_record.provisioning_token is not null
    and agreement_record.provisioning_started_at > now() - interval '10 minutes'
  then
    raise exception 'Agreement preparation is already in progress.' using errcode = '55P03';
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

-- Persist the provider draft before it can be sent. This turns a failure after
-- provider creation into an unsent orphan draft instead of an untracked live
-- signature request, and lets later retries resume the same known document.
create or replace function public.attach_own_signwell_agreement_document(
  target_account_id uuid,
  target_agreement_id uuid,
  target_provisioning_token uuid,
  signwell_document_id text,
  signwell_template_id text,
  bound_deal_terms_sha256 text
)
returns uuid
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  current_user_id uuid := target_account_id;
begin
  if coalesce(auth.role(), '') <> 'service_role' or current_user_id is null then
    raise exception 'Service-role access required.' using errcode = '42501';
  end if;

  if signwell_document_id !~ '^[0-9a-fA-F-]{20,80}$' then
    raise exception 'The provider document ID is invalid.' using errcode = '22023';
  end if;

  if signwell_template_id !~ '^[0-9a-fA-F-]{20,80}$'
    or bound_deal_terms_sha256 !~ '^[a-f0-9]{64}$'
  then
    raise exception 'The provider template binding is invalid.' using errcode = '22023';
  end if;

  update public.agreement_records agreement
  set external_agreement_id = signwell_document_id,
      provider_template_id = signwell_template_id,
      deal_terms_sha256 = bound_deal_terms_sha256,
      status = 'preparing',
      last_provider_error_code = null
  from public.creator_enrollments enrollment
  where agreement.id = target_agreement_id
    and agreement.enrollment_id = enrollment.id
    and enrollment.account_id = current_user_id
    and agreement.provider = 'signwell'
    and agreement.provisioning_token = target_provisioning_token
    and exists (
      select 1
      from public.program_deal_versions deal_version
      where deal_version.id = agreement.deal_version_id
        and deal_version.terms_sha256 = bound_deal_terms_sha256
    )
    and (
      agreement.external_agreement_id is null
      or agreement.external_agreement_id = signwell_document_id
    );

  if not found then
    raise exception 'Agreement provisioning lease was not accepted.' using errcode = '42501';
  end if;

  return target_agreement_id;
end;
$$;

create or replace function public.complete_own_signwell_agreement_provisioning(
  target_account_id uuid,
  target_agreement_id uuid,
  target_provisioning_token uuid,
  signwell_document_id text
)
returns uuid
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  current_user_id uuid := target_account_id;
begin
  if coalesce(auth.role(), '') <> 'service_role' or current_user_id is null then
    raise exception 'Service-role access required.' using errcode = '42501';
  end if;

  if signwell_document_id !~ '^[0-9a-fA-F-]{20,80}$' then
    raise exception 'The provider document ID is invalid.' using errcode = '22023';
  end if;

  update public.agreement_records agreement
  set status = case when agreement.status = 'completed' then 'completed' else 'sent' end,
      sent_at = coalesce(agreement.sent_at, now()),
      signing_requested_at = coalesce(agreement.signing_requested_at, now()),
      provisioning_token = null,
      provisioning_started_at = null,
      last_provider_error_code = null
  from public.creator_enrollments enrollment
  where agreement.id = target_agreement_id
    and agreement.enrollment_id = enrollment.id
    and enrollment.account_id = current_user_id
    and agreement.provider = 'signwell'
    and agreement.provisioning_token = target_provisioning_token
    and agreement.external_agreement_id = signwell_document_id;

  if not found then
    raise exception 'Agreement provisioning lease was not accepted.' using errcode = '42501';
  end if;

  return target_agreement_id;
end;
$$;

create or replace function public.fail_own_signwell_agreement_provisioning(
  target_account_id uuid,
  target_agreement_id uuid,
  target_provisioning_token uuid,
  provider_error_code text
)
returns uuid
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  current_user_id uuid := target_account_id;
  safe_error_code text := lower(btrim(coalesce(provider_error_code, 'provider_error')));
begin
  if coalesce(auth.role(), '') <> 'service_role' or current_user_id is null then
    raise exception 'Service-role access required.' using errcode = '42501';
  end if;

  if safe_error_code !~ '^[a-z0-9._:-]{2,80}$' then
    safe_error_code := 'provider_error';
  end if;

  update public.agreement_records agreement
  set status = 'error',
      provisioning_token = null,
      provisioning_started_at = null,
      last_provider_error_code = safe_error_code
  from public.creator_enrollments enrollment
  where agreement.id = target_agreement_id
    and agreement.enrollment_id = enrollment.id
    and enrollment.account_id = current_user_id
    and agreement.provisioning_token = target_provisioning_token;

  if not found then
    raise exception 'Agreement provisioning lease was not accepted.' using errcode = '42501';
  end if;

  return target_agreement_id;
end;
$$;

create or replace function public.process_signwell_agreement_event(event_input jsonb)
returns text
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  external_event_key text := btrim(coalesce(event_input->>'externalEventId', ''));
  event_type_value text := lower(btrim(coalesce(event_input->>'eventType', '')));
  document_id_value text := btrim(coalesce(event_input->>'documentId', ''));
  payload_hash text := lower(btrim(coalesce(event_input->>'payloadSha256', '')));
  artifact_hash text := lower(btrim(coalesce(event_input->>'artifactSha256', '')));
  artifact_ref text := btrim(coalesce(event_input->>'artifactRef', ''));
  artifact_size bigint;
  event_timestamp_value timestamptz;
  agreement_record public.agreement_records%rowtype;
  existing_event public.agreement_events%rowtype;
  inserted_event_id uuid;
  mapped_status text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Service-role access required.' using errcode = '42501';
  end if;

  if char_length(external_event_key) not between 20 and 191
    or payload_hash !~ '^[a-f0-9]{64}$'
    or char_length(document_id_value) not between 20 and 191
  then
    raise exception 'Malformed agreement event.' using errcode = '22023';
  end if;

  begin
    event_timestamp_value := (event_input->>'eventTimestamp')::timestamptz;
  exception when others then
    raise exception 'Malformed agreement event timestamp.' using errcode = '22023';
  end;

  begin
    artifact_size := nullif(event_input->>'artifactSizeBytes', '')::bigint;
  exception when others then
    raise exception 'Malformed agreement artifact size.' using errcode = '22023';
  end;

  select * into agreement_record
  from public.agreement_records
  where provider = 'signwell'
    and external_agreement_id = document_id_value
  for update;

  insert into public.agreement_events (
    agreement_id,
    external_agreement_id,
    provider,
    external_event_id,
    event_type,
    event_timestamp,
    payload_sha256,
    verified,
    processing_status,
    processed_at
  ) values (
    agreement_record.id,
    document_id_value,
    'signwell',
    external_event_key,
    event_type_value,
    event_timestamp_value,
    payload_hash,
    true,
    'received',
    null
  )
  on conflict (provider, external_event_id) do nothing
  returning id into inserted_event_id;

  if inserted_event_id is null then
    select event_record.*
    into existing_event
    from public.agreement_events event_record
    where event_record.provider = 'signwell'
      and event_record.external_event_id = external_event_key
    for update;

    if existing_event.payload_sha256 is distinct from payload_hash
      or existing_event.external_agreement_id is distinct from document_id_value
      or existing_event.event_type is distinct from event_type_value
      or existing_event.event_timestamp is distinct from event_timestamp_value
    then
      raise exception 'Agreement event identity was reused with different evidence.'
        using errcode = '23505';
    end if;

    if existing_event.processing_status <> 'received' then
      return 'duplicate';
    end if;

    inserted_event_id := existing_event.id;
  end if;

  -- A draft-created event can race the database attachment. Store it first and
  -- ask the provider to retry; once the document is attached, the same event is
  -- processed idempotently instead of being discarded.
  if agreement_record.id is null then
    return 'pending';
  end if;

  update public.agreement_events
  set agreement_id = agreement_record.id
  where id = inserted_event_id and agreement_id is null;

  mapped_status := case event_type_value
    when 'document_created' then null
    when 'document_sent' then 'sent'
    when 'document_viewed' then 'viewed'
    when 'document_in_progress' then 'creator_accepted'
    when 'document_signed' then 'creator_accepted'
    when 'document_completed' then 'completed'
    when 'document_declined' then 'declined'
    when 'document_expired' then 'voided'
    when 'document_canceled' then 'voided'
    when 'document_bounced' then 'error'
    when 'document_error' then 'error'
    else null
  end;

  if mapped_status is null then
    update public.agreement_events
    set processing_status = 'ignored', processed_at = now()
    where id = inserted_event_id;
    return 'ignored';
  end if;

  -- Completion is terminal and earlier duplicated/out-of-order events cannot
  -- make the account look unsigned again.
  if agreement_record.status = 'completed' then
    update public.agreement_events
    set agreement_id = agreement_record.id,
        processing_status = 'processed',
        processed_at = now()
    where id = inserted_event_id;
    return 'processed';
  end if;

  if mapped_status = 'completed' then
    -- The web route performs this RPC before touching provider storage. Only a
    -- known, unfinished agreement asks it to fetch the completed artifact;
    -- unrelated account-wide webhook documents remain retained but unarchived.
    if artifact_hash = '' and artifact_ref = '' and artifact_size is null then
      return 'artifact_required';
    end if;

    if artifact_hash !~ '^[a-f0-9]{64}$'
      or char_length(artifact_ref) not between 20 and 1024
      or artifact_ref ~ '(^|/)\.\.(/|$)'
      or artifact_size not between 1 and 33554432
    then
      raise exception 'Completed agreement artifact evidence is required.'
        using errcode = '22023';
    end if;

    update public.agreement_records
    set status = 'completed',
        creator_accepted_at = coalesce(creator_accepted_at, event_timestamp_value),
        completed_at = event_timestamp_value,
        completion_evidence_sha256 = artifact_hash,
        completed_artifact_ref = artifact_ref,
        completed_artifact_size_bytes = artifact_size,
        completed_artifact_archived_at = now(),
        last_provider_error_code = null
    where id = agreement_record.id;

    update public.creator_enrollments
    set status = 'active',
        activated_at = coalesce(activated_at, event_timestamp_value)
    where id = agreement_record.enrollment_id;

    update public.creator_accounts account_record
    set lifecycle_status = 'active'
    from public.creator_enrollments enrollment_record
    where enrollment_record.id = agreement_record.enrollment_id
      and account_record.auth_user_id = enrollment_record.account_id;
  elsif agreement_record.status not in ('declined', 'voided') then
    update public.agreement_records
    set status = case
          when status = 'creator_accepted' and mapped_status in ('sent', 'viewed')
            then status
          when status = 'viewed' and mapped_status = 'sent'
            then status
          else mapped_status
        end,
        sent_at = case
          when mapped_status = 'sent' then coalesce(sent_at, event_timestamp_value)
          else sent_at
        end,
        creator_accepted_at = case
          when mapped_status = 'creator_accepted' then coalesce(creator_accepted_at, event_timestamp_value)
          else creator_accepted_at
        end,
        last_provider_error_code = case
          when mapped_status = 'error' then event_type_value
          else null
        end
    where id = agreement_record.id;
  end if;

  update public.agreement_events
  set processing_status = 'processed', processed_at = now()
  where id = inserted_event_id;

  return 'processed';
end;
$$;

revoke execute on function public.get_own_agreement_signing_context() from public, anon;
revoke execute on function public.begin_own_signwell_agreement_provisioning(uuid, text) from public, anon, authenticated;
revoke execute on function public.attach_own_signwell_agreement_document(uuid, uuid, uuid, text, text, text) from public, anon, authenticated;
revoke execute on function public.complete_own_signwell_agreement_provisioning(uuid, uuid, uuid, text) from public, anon, authenticated;
revoke execute on function public.fail_own_signwell_agreement_provisioning(uuid, uuid, uuid, text) from public, anon, authenticated;
revoke execute on function public.process_signwell_agreement_event(jsonb) from public, anon, authenticated;

grant execute on function public.get_own_agreement_signing_context() to authenticated;
grant execute on function public.begin_own_signwell_agreement_provisioning(uuid, text) to service_role;
grant execute on function public.attach_own_signwell_agreement_document(uuid, uuid, uuid, text, text, text) to service_role;
grant execute on function public.complete_own_signwell_agreement_provisioning(uuid, uuid, uuid, text) to service_role;
grant execute on function public.fail_own_signwell_agreement_provisioning(uuid, uuid, uuid, text) to service_role;
grant execute on function public.process_signwell_agreement_event(jsonb) to service_role;

comment on function public.process_signwell_agreement_event(jsonb) is
  'Service-role-only processing for timestamp-checked, HMAC-verified SignWell events. Completion activates the enrollment and account exactly once.';
