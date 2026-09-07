-- Bind every SignWell document to the immutable combined deal snapshot.
-- `deal_terms_sha256` is retained as legal-text evidence, but it is no longer
-- accepted as the provider-template gate because it excludes economics.

alter table public.agreement_records
  add column if not exists deal_snapshot_sha256 text;

alter table public.agreement_records
  drop constraint if exists agreement_records_signwell_evidence_shape;

alter table public.agreement_records
  add constraint agreement_records_signwell_evidence_shape
  check (
    (provider_template_id is null or provider_template_id ~ '^[0-9a-fA-F-]{20,80}$')
    and (deal_terms_sha256 is null or deal_terms_sha256 ~ '^[a-f0-9]{64}$')
    and (deal_snapshot_sha256 is null or deal_snapshot_sha256 ~ '^[a-f0-9]{64}$')
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
        and deal_snapshot_sha256 is not null
      )
    )
  );

-- Expose the stored attachment evidence for resumable sent/viewed documents.
-- Assigned records correctly return NULL until a provider draft is attached.
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
  provider_template_id text,
  deal_snapshot_sha256 text,
  verified_provider_template_id text,
  verified_deal_snapshot_sha256 text,
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
    agreement_record.provider_template_id,
    agreement_record.deal_snapshot_sha256,
    verified_binding.provider_template_id,
    verified_binding.bound_snapshot_sha256,
    agreement_record.provisioning_started_at,
    agreement_record.sent_at,
    agreement_record.completed_at
  from public.agreement_records agreement_record
  join public.creator_enrollments enrollment_record
    on enrollment_record.id = agreement_record.enrollment_id
    and enrollment_record.deal_version_id = agreement_record.deal_version_id
  left join public.program_deal_versions deal_version
    on deal_version.id = agreement_record.deal_version_id
    and deal_version.status in ('active', 'retired')
  left join public.program_deal_signing_bindings verified_binding
    on verified_binding.deal_version_id = deal_version.id
    and verified_binding.provider = 'signwell'
    and verified_binding.provider_environment = 'production'
    and verified_binding.status = 'verified'
    and verified_binding.bound_snapshot_sha256 = deal_version.snapshot_sha256
    and exists (
      select 1
      from public.program_deal_template_source_artifacts source_artifact
      where source_artifact.id = verified_binding.source_artifact_id
        and source_artifact.deal_version_id = verified_binding.deal_version_id
        and source_artifact.provider = verified_binding.provider
        and source_artifact.provider_environment = verified_binding.provider_environment
        and source_artifact.provider_template_id = verified_binding.provider_template_id
        and source_artifact.source_sha256 = verified_binding.provider_template_sha256
        and source_artifact.deal_snapshot_sha256 = verified_binding.bound_snapshot_sha256
    )
  where enrollment_record.account_id = current_user_id
  order by agreement_record.created_at desc
  limit 1;
end;
$$;

revoke execute on function public.get_own_agreement_signing_context()
from public, anon;
grant execute on function public.get_own_agreement_signing_context()
to authenticated;

-- PostgreSQL cannot replace a TABLE-returning function when its output column
-- changes, so explicitly replace the service-role lease contract.
drop function public.begin_own_signwell_agreement_provisioning(uuid, text);

create function public.begin_own_signwell_agreement_provisioning(
  target_account_id uuid,
  target_environment text
)
returns table (
  agreement_id uuid,
  provisioning_token uuid,
  enrollment_id uuid,
  deal_version_id uuid,
  deal_snapshot_sha256 text,
  provider_template_id text,
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
  deal_snapshot_hash text;
  verified_template_id text;
  verified_binding_count integer;
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

  select count(*),
         min(deal_version.snapshot_sha256),
         min(binding.provider_template_id)
  into verified_binding_count, deal_snapshot_hash, verified_template_id
  from public.program_deal_versions deal_version
  join public.program_deal_signing_bindings binding
    on binding.deal_version_id = deal_version.id
    and binding.provider = 'signwell'
    and binding.provider_environment = 'production'
    and binding.status = 'verified'
    and binding.bound_snapshot_sha256 = deal_version.snapshot_sha256
  join public.program_deal_template_source_artifacts source_artifact
    on source_artifact.id = binding.source_artifact_id
    and source_artifact.deal_version_id = binding.deal_version_id
    and source_artifact.provider = binding.provider
    and source_artifact.provider_environment = binding.provider_environment
    and source_artifact.provider_template_id = binding.provider_template_id
    and source_artifact.source_sha256 = binding.provider_template_sha256
    and source_artifact.deal_snapshot_sha256 = binding.bound_snapshot_sha256
  where deal_version.id = agreement_record.deal_version_id
    and deal_version.status in ('active', 'retired');

  if verified_binding_count <> 1
    or verified_template_id is null
    or deal_snapshot_hash is null
    or deal_snapshot_hash !~ '^[a-f0-9]{64}$'
  then
    raise exception 'Exactly one verified production template must match the assigned immutable deal snapshot.'
      using errcode = '55000';
  end if;

  -- A known provider document may only be resumed when it already carries the
  -- same combined snapshot in the same provider environment. Test and live
  -- documents are distinct evidence and must never be relabeled across modes.
  if agreement_record.external_agreement_id is not null
    and (
      agreement_record.provider is distinct from 'signwell'
      or agreement_record.provider_environment is distinct from normalized_environment
      or agreement_record.deal_snapshot_sha256 is distinct from deal_snapshot_hash
      or agreement_record.provider_template_id is distinct from verified_template_id
    )
  then
    raise exception 'The attached provider document does not match the assigned deal snapshot.'
      using errcode = '55000';
  end if;

  if agreement_record.external_agreement_id is null
    and (
      agreement_record.deal_snapshot_sha256 is not null
      or agreement_record.provider_template_id is not null
    )
  then
    raise exception 'The agreement snapshot evidence is incomplete.' using errcode = '55000';
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
      provider_environment = case
        when agreement_record.external_agreement_id is null then normalized_environment
        else agreement_record.provider_environment
      end,
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
    deal_snapshot_hash,
    verified_template_id,
    agreement_record.signer_name_snapshot,
    agreement_record.signer_email_snapshot,
    agreement_record.external_agreement_id;
end;
$$;

revoke execute on function public.begin_own_signwell_agreement_provisioning(uuid, text)
from public, anon, authenticated;
grant execute on function public.begin_own_signwell_agreement_provisioning(uuid, text)
to service_role;

-- Rename the RPC argument as well as its semantics. An older service client
-- sending `bound_deal_terms_sha256` will fail before it can mutate a record.
drop function public.attach_own_signwell_agreement_document(uuid, uuid, uuid, text, text, text);

create function public.attach_own_signwell_agreement_document(
  target_account_id uuid,
  target_agreement_id uuid,
  target_provisioning_token uuid,
  signwell_document_id text,
  signwell_template_id text,
  bound_deal_snapshot_sha256 text
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
    or bound_deal_snapshot_sha256 !~ '^[a-f0-9]{64}$'
  then
    raise exception 'The provider template binding is invalid.' using errcode = '22023';
  end if;

  update public.agreement_records agreement
  set external_agreement_id = signwell_document_id,
      provider_template_id = signwell_template_id,
      deal_terms_sha256 = deal_version.terms_sha256,
      deal_snapshot_sha256 = bound_deal_snapshot_sha256,
      status = 'preparing',
      last_provider_error_code = null
  from public.creator_enrollments enrollment,
       public.program_deal_versions deal_version
  where agreement.id = target_agreement_id
    and agreement.enrollment_id = enrollment.id
    and agreement.deal_version_id = enrollment.deal_version_id
    and deal_version.id = agreement.deal_version_id
    and enrollment.account_id = current_user_id
    and agreement.provider = 'signwell'
    and agreement.provisioning_token = target_provisioning_token
    and deal_version.status in ('active', 'retired')
    and deal_version.snapshot_sha256 = bound_deal_snapshot_sha256
    and exists (
      select 1
      from public.program_deal_signing_bindings binding
      join public.program_deal_template_source_artifacts source_artifact
        on source_artifact.id = binding.source_artifact_id
        and source_artifact.deal_version_id = binding.deal_version_id
        and source_artifact.provider = binding.provider
        and source_artifact.provider_environment = binding.provider_environment
        and source_artifact.provider_template_id = binding.provider_template_id
        and source_artifact.source_sha256 = binding.provider_template_sha256
        and source_artifact.deal_snapshot_sha256 = binding.bound_snapshot_sha256
      where binding.deal_version_id = deal_version.id
        and binding.provider = 'signwell'
        and binding.provider_environment = 'production'
        and binding.provider_template_id = signwell_template_id
        and binding.bound_snapshot_sha256 = bound_deal_snapshot_sha256
        and binding.status = 'verified'
    )
    and (
      (
        agreement.external_agreement_id is null
        and agreement.provider_template_id is null
        and agreement.deal_snapshot_sha256 is null
      )
      or (
        agreement.external_agreement_id = signwell_document_id
        and agreement.provider_template_id = signwell_template_id
        and agreement.deal_snapshot_sha256 = bound_deal_snapshot_sha256
      )
    );

  if not found then
    raise exception 'Agreement provisioning lease was not accepted.' using errcode = '42501';
  end if;

  return target_agreement_id;
end;
$$;

revoke execute on function public.attach_own_signwell_agreement_document(uuid, uuid, uuid, text, text, text)
from public, anon, authenticated;
grant execute on function public.attach_own_signwell_agreement_document(uuid, uuid, uuid, text, text, text)
to service_role;

-- Finalization also checks the stored combined snapshot so no legacy or
-- partially attached provider document can be promoted to sent.
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
    and agreement.deal_version_id = enrollment.deal_version_id
    and enrollment.account_id = current_user_id
    and agreement.provider = 'signwell'
    and agreement.provisioning_token = target_provisioning_token
    and agreement.external_agreement_id = signwell_document_id
    and agreement.deal_snapshot_sha256 is not null
    and exists (
      select 1
      from public.program_deal_versions deal_version
      join public.program_deal_signing_bindings binding
        on binding.deal_version_id = deal_version.id
        and binding.provider = 'signwell'
        and binding.provider_environment = 'production'
        and binding.provider_template_id = agreement.provider_template_id
        and binding.bound_snapshot_sha256 = deal_version.snapshot_sha256
        and binding.status = 'verified'
      join public.program_deal_template_source_artifacts source_artifact
        on source_artifact.id = binding.source_artifact_id
        and source_artifact.deal_version_id = binding.deal_version_id
        and source_artifact.provider = binding.provider
        and source_artifact.provider_environment = binding.provider_environment
        and source_artifact.provider_template_id = binding.provider_template_id
        and source_artifact.source_sha256 = binding.provider_template_sha256
        and source_artifact.deal_snapshot_sha256 = binding.bound_snapshot_sha256
      where deal_version.id = agreement.deal_version_id
        and deal_version.status in ('active', 'retired')
        and deal_version.snapshot_sha256 = agreement.deal_snapshot_sha256
    );

  if not found then
    raise exception 'Agreement provisioning lease was not accepted.' using errcode = '42501';
  end if;

  return target_agreement_id;
end;
$$;

revoke execute on function public.complete_own_signwell_agreement_provisioning(uuid, uuid, uuid, text)
from public, anon, authenticated;
grant execute on function public.complete_own_signwell_agreement_provisioning(uuid, uuid, uuid, text)
to service_role;

comment on column public.agreement_records.deal_snapshot_sha256 is
  'Combined immutable legal-terms and economics snapshot bound to the provider document.';

comment on function public.get_own_agreement_signing_context() is
  'Creator-owned agreement state with stored combined-snapshot evidence for fail-closed provider resume.';

comment on function public.begin_own_signwell_agreement_provisioning(uuid, text) is
  'Service-role-only SignWell lease returning the assigned immutable snapshot and its exactly-one verified production template, including retained retired assignments.';

comment on function public.attach_own_signwell_agreement_document(uuid, uuid, uuid, text, text, text) is
  'Service-role-only attachment that accepts only the assigned combined deal snapshot and preserves terms evidence separately.';
