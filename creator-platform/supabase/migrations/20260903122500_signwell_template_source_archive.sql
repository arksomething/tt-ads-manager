-- Application-immutable, tamper-evident source evidence for SignWell production
-- templates. This control is deliberately not described as storage-level WORM:
-- trusted infrastructure operators retain storage administration capabilities,
-- while every application read rechecks the stored bytes against this record.
--
-- Browser callers never provide an authoritative template hash. The upload
-- route computes SHA-256 over the accepted bytes, writes an unguessable object
-- to a private bucket with upsert disabled, and then calls the service-role-only
-- archive RPC. Browser-accessible binding and verification RPCs accept only the
-- resulting artifact ID and copy every identity field from this table.

create table public.program_deal_template_source_artifacts (
  id uuid primary key default gen_random_uuid(),
  deal_version_id uuid not null
    references public.program_deal_versions(id) on delete restrict,
  provider text not null check (provider = 'signwell'),
  provider_environment text not null check (provider_environment = 'production'),
  provider_template_id text not null
    check (provider_template_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  deal_snapshot_sha256 text not null
    check (deal_snapshot_sha256 ~ '^[a-f0-9]{64}$'),
  source_sha256 text not null
    check (source_sha256 ~ '^[a-f0-9]{64}$'),
  storage_bucket text not null
    check (storage_bucket = 'creator-deal-template-sources'),
  storage_path text not null
    check (
      char_length(storage_path) between 40 and 512
      and storage_path !~ '(^|/)\.\.(/|$)'
      and storage_path !~ '[\\]'
    ),
  original_filename text not null
    check (
      char_length(original_filename) between 1 and 200
      and original_filename !~ '[/\\]'
    ),
  content_type text not null
    check (content_type in (
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    )),
  byte_size bigint not null check (byte_size between 1 and 4194304),
  uploaded_by uuid not null
    references public.staff_members(auth_user_id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (deal_version_id),
  unique (provider, provider_environment, provider_template_id),
  unique (storage_bucket, storage_path),
  check (
    (content_type = 'application/pdf'
      and lower(original_filename) like '%.pdf'
      and lower(storage_path) like '%.pdf')
    or
    (content_type = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      and lower(original_filename) like '%.docx'
      and lower(storage_path) like '%.docx')
  )
);

create or replace function public.prevent_program_deal_template_source_artifact_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  raise exception 'Program deal template source artifacts are immutable.' using errcode = '55000';
end;
$$;

create trigger prevent_program_deal_template_source_artifact_row_mutation
before update or delete on public.program_deal_template_source_artifacts
for each row execute function public.prevent_program_deal_template_source_artifact_mutation();

create trigger prevent_program_deal_template_source_artifact_truncate
before truncate on public.program_deal_template_source_artifacts
for each statement execute function public.prevent_program_deal_template_source_artifact_mutation();

alter table public.program_deal_template_source_artifacts enable row level security;
revoke all on public.program_deal_template_source_artifacts
from public, anon, authenticated, service_role;

-- Supabase Storage is absent from some disposable SQL harnesses. Production
-- gets a private, size- and MIME-restricted bucket with no browser policies;
-- only the server-side service-role client can read or write these objects.
do $migration$
begin
  if to_regclass('storage.buckets') is not null then
    execute $sql$
      insert into storage.buckets (
        id, name, public, file_size_limit, allowed_mime_types
      ) values (
        'creator-deal-template-sources',
        'creator-deal-template-sources',
        false,
        4194304,
        array[
          'application/pdf',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        ]::text[]
      )
      on conflict (id) do update
      set public = false,
          file_size_limit = excluded.file_size_limit,
          allowed_mime_types = excluded.allowed_mime_types
    $sql$;
  end if;
end
$migration$;

alter table public.program_deal_signing_bindings
  add column source_artifact_id uuid
    references public.program_deal_template_source_artifacts(id) on delete restrict;

create unique index program_deal_signing_bindings_source_artifact_unique
  on public.program_deal_signing_bindings (source_artifact_id)
  where source_artifact_id is not null;

-- This trigger prevents future pending/verified production bindings from
-- bypassing the immutable artifact even through a stale privileged function.
-- Pre-migration rows remain stored but fail readiness and cannot be updated
-- into a usable state without an exact archived source.
create or replace function public.enforce_program_deal_signing_binding_source_artifact()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.provider = 'signwell'
    and new.provider_environment = 'production'
    and new.status in ('pending', 'verified')
    and not exists (
      select 1
      from public.program_deal_template_source_artifacts artifact
      where artifact.id = new.source_artifact_id
        and artifact.deal_version_id = new.deal_version_id
        and artifact.provider = new.provider
        and artifact.provider_environment = new.provider_environment
        and artifact.provider_template_id = new.provider_template_id
        and artifact.source_sha256 = new.provider_template_sha256
        and artifact.deal_snapshot_sha256 = new.bound_snapshot_sha256
    )
  then
    raise exception 'The signing binding must match one immutable server-hashed source artifact.'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger enforce_program_deal_signing_binding_source_artifact
before insert or update on public.program_deal_signing_bindings
for each row execute function public.enforce_program_deal_signing_binding_source_artifact();

-- Cheap authorization gate used before parsing a potentially multi-megabyte
-- multipart body. Deal existence is checked only after the active-admin check,
-- so the function does not expose deal identifiers to non-admin callers.
create or replace function public.authorize_admin_program_deal_template_source_upload(
  target_deal_version_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
declare
  actor_id uuid := auth.uid();
begin
  if not exists (
    select 1 from public.staff_members
    where auth_user_id = actor_id and active and role = 'admin'
  ) then
    raise exception 'Administrator access required.' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.program_deal_versions where id = target_deal_version_id
  ) then
    raise exception 'Deal version was not found.' using errcode = 'P0002';
  end if;
  return true;
end;
$$;

create or replace function public.prepare_admin_program_deal_template_source_upload(
  target_deal_version_id uuid,
  expected_snapshot_sha256 text,
  provider_template_id_input text
)
returns boolean
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  actor_id uuid := auth.uid();
  normalized_snapshot text := btrim(coalesce(expected_snapshot_sha256, ''));
  normalized_template_id text := btrim(coalesce(provider_template_id_input, ''));
  deal_record public.program_deal_versions%rowtype;
begin
  if not exists (
    select 1 from public.staff_members
    where auth_user_id = actor_id and active and role = 'admin'
  ) then
    raise exception 'Administrator access required.' using errcode = '42501';
  end if;
  if normalized_snapshot !~ '^[a-f0-9]{64}$'
    or normalized_template_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  then
    raise exception 'Template source upload evidence is invalid.' using errcode = '22023';
  end if;

  select * into deal_record
  from public.program_deal_versions
  where id = target_deal_version_id
  for share;
  if not found then
    raise exception 'Deal version was not found.' using errcode = 'P0002';
  end if;
  if deal_record.status <> 'sealed' then
    raise exception 'Only a sealed deal snapshot can receive a template source.' using errcode = '55000';
  end if;
  if deal_record.snapshot_sha256 is distinct from normalized_snapshot then
    raise exception 'The sealed deal snapshot changed. Refresh before uploading the source.'
      using errcode = '40001';
  end if;
  if exists (
    select 1 from public.program_deal_template_source_artifacts
    where deal_version_id = target_deal_version_id
  ) then
    raise exception 'An immutable template source is already archived for this deal version.'
      using errcode = '55000';
  end if;

  return true;
end;
$$;

create or replace function public.archive_admin_program_deal_template_source(
  target_deal_version_id uuid,
  actor_user_id_input uuid,
  expected_snapshot_sha256 text,
  provider_template_id_input text,
  source_sha256_input text,
  storage_path_input text,
  original_filename_input text,
  content_type_input text,
  byte_size_input bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  normalized_snapshot text := btrim(coalesce(expected_snapshot_sha256, ''));
  normalized_template_id text := btrim(coalesce(provider_template_id_input, ''));
  normalized_source_hash text := lower(btrim(coalesce(source_sha256_input, '')));
  normalized_storage_path text := btrim(coalesce(storage_path_input, ''));
  normalized_filename text := btrim(coalesce(original_filename_input, ''));
  normalized_content_type text := lower(btrim(coalesce(content_type_input, '')));
  deal_record public.program_deal_versions%rowtype;
  artifact_record public.program_deal_template_source_artifacts%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role' or actor_user_id_input is null then
    raise exception 'Service-role access required.' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.staff_members
    where auth_user_id = actor_user_id_input and active and role = 'admin'
  ) then
    raise exception 'Active administrator attribution is required.' using errcode = '42501';
  end if;
  if normalized_snapshot !~ '^[a-f0-9]{64}$'
    or normalized_template_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or normalized_source_hash !~ '^[a-f0-9]{64}$'
    or char_length(normalized_filename) not between 1 and 200
    or normalized_filename ~ '[/\\]'
    or char_length(normalized_storage_path) not between 40 and 512
    or normalized_storage_path !~ ('^' || target_deal_version_id::text || '/[0-9a-f-]{36}\.(pdf|docx)$')
    or normalized_storage_path ~ '(^|/)\.\.(/|$)'
    or normalized_content_type not in (
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    )
    or byte_size_input is null
    or byte_size_input not between 1 and 4194304
    or (
      normalized_content_type = 'application/pdf'
      and (lower(normalized_filename) not like '%.pdf' or lower(normalized_storage_path) not like '%.pdf')
    )
    or (
      normalized_content_type = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      and (lower(normalized_filename) not like '%.docx' or lower(normalized_storage_path) not like '%.docx')
    )
  then
    raise exception 'Archived template source evidence is invalid.' using errcode = '22023';
  end if;

  select * into deal_record
  from public.program_deal_versions
  where id = target_deal_version_id
  for update;
  if not found then
    raise exception 'Deal version was not found.' using errcode = 'P0002';
  end if;
  if deal_record.status <> 'sealed' then
    raise exception 'Only a sealed deal snapshot can receive a template source.' using errcode = '55000';
  end if;
  if deal_record.snapshot_sha256 is distinct from normalized_snapshot then
    raise exception 'The sealed deal snapshot changed before the source was archived.'
      using errcode = '40001';
  end if;

  insert into public.program_deal_template_source_artifacts (
    deal_version_id, provider, provider_environment, provider_template_id,
    deal_snapshot_sha256, source_sha256, storage_bucket, storage_path,
    original_filename, content_type, byte_size, uploaded_by
  ) values (
    target_deal_version_id, 'signwell', 'production', normalized_template_id,
    normalized_snapshot, normalized_source_hash, 'creator-deal-template-sources',
    normalized_storage_path, normalized_filename, normalized_content_type,
    byte_size_input, actor_user_id_input
  )
  returning * into artifact_record;

  insert into public.program_deal_events (
    deal_version_id, event_type, actor_user_id, draft_revision,
    from_status, to_status, metadata
  ) values (
    target_deal_version_id, 'signwell_template_source_archived', actor_user_id_input,
    deal_record.draft_revision, 'sealed', 'sealed',
    jsonb_build_object(
      'provider', 'signwell',
      'environment', 'production',
      'templateId', normalized_template_id,
      'sourceArtifactId', artifact_record.id,
      'templateSourceSha256', normalized_source_hash,
      'snapshotHash', normalized_snapshot,
      'originalFilename', normalized_filename,
      'contentType', normalized_content_type,
      'byteSize', byte_size_input
    )
  );

  return jsonb_build_object(
    'id', artifact_record.id,
    'dealVersionId', artifact_record.deal_version_id,
    'provider', artifact_record.provider,
    'environment', artifact_record.provider_environment,
    'templateId', artifact_record.provider_template_id,
    'snapshotHash', artifact_record.deal_snapshot_sha256,
    'sourceSha256', artifact_record.source_sha256,
    'storageBucket', artifact_record.storage_bucket,
    'storagePath', artifact_record.storage_path,
    'originalFilename', artifact_record.original_filename,
    'contentType', artifact_record.content_type,
    'byteSize', artifact_record.byte_size,
    'uploadedBy', artifact_record.uploaded_by,
    'createdAt', artifact_record.created_at
  );
end;
$$;

create or replace function public.get_admin_program_deal_template_source_artifact(
  target_deal_version_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
declare
  actor_id uuid := auth.uid();
  artifact_record public.program_deal_template_source_artifacts%rowtype;
begin
  if not exists (
    select 1 from public.staff_members
    where auth_user_id = actor_id and active and role in ('reviewer', 'admin')
  ) then
    raise exception 'Reviewer access required.' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.program_deal_versions where id = target_deal_version_id
  ) then
    raise exception 'Deal version was not found.' using errcode = 'P0002';
  end if;

  select * into artifact_record
  from public.program_deal_template_source_artifacts
  where deal_version_id = target_deal_version_id;
  if not found then return null; end if;

  return jsonb_build_object(
    'id', artifact_record.id,
    'dealVersionId', artifact_record.deal_version_id,
    'provider', artifact_record.provider,
    'environment', artifact_record.provider_environment,
    'templateId', artifact_record.provider_template_id,
    'snapshotHash', artifact_record.deal_snapshot_sha256,
    'sourceSha256', artifact_record.source_sha256,
    'storageBucket', artifact_record.storage_bucket,
    'storagePath', artifact_record.storage_path,
    'originalFilename', artifact_record.original_filename,
    'contentType', artifact_record.content_type,
    'byteSize', artifact_record.byte_size,
    'uploadedBy', artifact_record.uploaded_by,
    'createdAt', artifact_record.created_at
  );
end;
$$;

-- Server-only metadata lookup for the byte-integrity gate. Direct table access
-- stays revoked from service_role; this narrow function returns exactly one
-- normalized artifact envelope and nothing else.
create or replace function public.get_server_program_deal_template_source_artifact(
  target_deal_version_id uuid,
  source_artifact_id_input uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
declare
  artifact_record public.program_deal_template_source_artifacts%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Service-role access required.' using errcode = '42501';
  end if;
  if target_deal_version_id is null then
    raise exception 'Deal version is required.' using errcode = '22023';
  end if;

  select * into artifact_record
  from public.program_deal_template_source_artifacts
  where deal_version_id = target_deal_version_id
    and (source_artifact_id_input is null or id = source_artifact_id_input);
  if not found then return null; end if;

  return jsonb_build_object(
    'id', artifact_record.id,
    'dealVersionId', artifact_record.deal_version_id,
    'provider', artifact_record.provider,
    'environment', artifact_record.provider_environment,
    'templateId', artifact_record.provider_template_id,
    'snapshotHash', artifact_record.deal_snapshot_sha256,
    'sourceSha256', artifact_record.source_sha256,
    'storageBucket', artifact_record.storage_bucket,
    'storagePath', artifact_record.storage_path,
    'originalFilename', artifact_record.original_filename,
    'contentType', artifact_record.content_type,
    'byteSize', artifact_record.byte_size,
    'uploadedBy', artifact_record.uploaded_by,
    'createdAt', artifact_record.created_at
  );
end;
$$;

-- Add the artifact foreign key to provider evidence shown in the existing
-- strict deal-detail response. The archive itself is loaded through its own
-- narrowly scoped RPC so an archived-but-not-yet-bound source is still visible.
create or replace function public.get_admin_program_deal_detail(target_deal_version_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
declare
  actor_id uuid := auth.uid();
  deal_record public.program_deal_versions%rowtype;
  result jsonb;
begin
  if not exists (
    select 1 from public.staff_members
    where auth_user_id = actor_id and active and role in ('reviewer', 'admin')
  ) then
    raise exception 'Reviewer access required.' using errcode = '42501';
  end if;

  select * into deal_record from public.program_deal_versions
  where id = target_deal_version_id;
  if not found then return null; end if;

  result := public.admin_program_deal_version_summary(deal_record.id) || jsonb_build_object(
    'termsMarkdown', deal_record.terms_markdown,
    'economics', deal_record.economics_json,
    'changeNote', deal_record.change_note,
    'providerBindings', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', binding.id,
        'sourceArtifactId', binding.source_artifact_id,
        'provider', binding.provider,
        'environment', binding.provider_environment,
        'templateId', binding.provider_template_id,
        'templateHash', binding.provider_template_sha256,
        'boundSnapshotHash', binding.bound_snapshot_sha256,
        'status', binding.status,
        'configuredBy', binding.configured_by,
        'verifiedBy', binding.verified_by,
        'verificationMethod', binding.verification_method,
        'verifiedAt', binding.verified_at,
        'updatedAt', binding.updated_at
      ) order by binding.created_at)
      from public.program_deal_signing_bindings binding
      where binding.deal_version_id = deal_record.id
    ), '[]'::jsonb),
    'approvals', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', approval.id,
        'kind', approval.approval_kind,
        'status', approval.status,
        'snapshotHash', approval.snapshot_sha256,
        'approvedBy', approval.approved_by,
        'note', approval.note,
        'approvedAt', approval.approved_at,
        'revokedBy', approval.revoked_by,
        'revocationNote', approval.revocation_note,
        'revokedAt', approval.revoked_at
      ) order by approval.approval_kind)
      from public.program_deal_approvals approval
      where approval.deal_version_id = deal_record.id
    ), '[]'::jsonb),
    'auditEvents', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', event.id,
        'type', event.event_type,
        'actorUserId', event.actor_user_id,
        'draftRevision', event.draft_revision,
        'fromStatus', event.from_status,
        'toStatus', event.to_status,
        'metadata', event.metadata,
        'createdAt', event.created_at
      ) order by event.created_at desc, event.id desc)
      from public.program_deal_events event
      where event.deal_version_id = deal_record.id
    ), '[]'::jsonb)
  );

  return result;
end;
$$;

-- Readiness now requires the verified binding to retain its exact immutable
-- source artifact. Existing unarchived bindings therefore fail closed.
create or replace function public.admin_program_deal_readiness(target_deal_version_id uuid)
returns text[]
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  deal_record public.program_deal_versions%rowtype;
  blockers text[] := array[]::text[];
  verified_binding_count integer;
  business_approval_count integer;
  legal_approval_count integer;
  distinct_approval_actor_count integer;
begin
  select * into deal_record
  from public.program_deal_versions
  where id = target_deal_version_id;
  if not found then return array['Deal version was not found.']; end if;

  if deal_record.status not in ('sealed', 'active') then
    blockers := array_append(blockers, 'Seal the immutable deal snapshot.');
  end if;
  if not public.admin_deal_placeholder_free(deal_record.label)
    or not public.admin_deal_placeholder_free(deal_record.terms_markdown)
  then
    blockers := array_append(blockers, 'Resolve every placeholder in the legal terms.');
  end if;
  if not public.admin_deal_economics_valid(deal_record.economics_json, true) then
    blockers := array_append(blockers, 'Complete and validate every required economic rule.');
  end if;

  select count(*) into verified_binding_count
  from public.program_deal_signing_bindings binding
  join public.program_deal_template_source_artifacts artifact
    on artifact.id = binding.source_artifact_id
   and artifact.deal_version_id = binding.deal_version_id
   and artifact.provider = binding.provider
   and artifact.provider_environment = binding.provider_environment
   and artifact.provider_template_id = binding.provider_template_id
   and artifact.source_sha256 = binding.provider_template_sha256
   and artifact.deal_snapshot_sha256 = binding.bound_snapshot_sha256
  join public.staff_members verifier
    on verifier.auth_user_id = binding.verified_by
   and verifier.active
   and verifier.role = 'admin'
  where binding.deal_version_id = target_deal_version_id
    and binding.provider = 'signwell'
    and binding.status = 'verified'
    and binding.provider_environment = 'production'
    and binding.verification_method = 'manual_admin_attestation'
    and binding.provider_template_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and binding.provider_template_sha256 ~ '^[a-f0-9]{64}$'
    and binding.bound_snapshot_sha256 = deal_record.snapshot_sha256;
  if verified_binding_count <> 1 then
    blockers := array_append(
      blockers,
      'Archive and manually verify exactly one production SignWell template source against this snapshot.'
    );
  end if;

  select count(*) filter (where approval.approval_kind = 'business'),
         count(*) filter (
           where approval.approval_kind = 'legal'
             and approval.note is not null
             and char_length(btrim(approval.note)) between 4 and 2000
         ),
         count(distinct approval.approved_by)
  into business_approval_count, legal_approval_count, distinct_approval_actor_count
  from public.program_deal_approvals approval
  join public.staff_members approver
    on approver.auth_user_id = approval.approved_by
   and approver.active
   and approver.role = 'admin'
  where approval.deal_version_id = target_deal_version_id
    and approval.status = 'approved'
    and approval.snapshot_sha256 = deal_record.snapshot_sha256;

  if business_approval_count <> 1 then
    blockers := array_append(blockers, 'Record business approval by an active administrator for this exact snapshot.');
  end if;
  if legal_approval_count <> 1 then
    blockers := array_append(blockers, 'Record legal approval by an active administrator for this exact snapshot.');
  end if;
  if business_approval_count = 1
    and legal_approval_count = 1
    and distinct_approval_actor_count <> 2
  then
    blockers := array_append(
      blockers,
      'Business and legal approvals must come from two distinct active administrators.'
    );
  end if;

  return blockers;
end;
$$;

create or replace function public.record_admin_program_deal_signwell_binding_from_artifact(
  target_deal_version_id uuid,
  expected_snapshot_sha256 text,
  source_artifact_id_input uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  actor_id uuid := auth.uid();
  normalized_snapshot text := btrim(coalesce(expected_snapshot_sha256, ''));
  deal_record public.program_deal_versions%rowtype;
  artifact_record public.program_deal_template_source_artifacts%rowtype;
  binding_record public.program_deal_signing_bindings%rowtype;
begin
  perform 1 from public.staff_members
  where auth_user_id = actor_id and active and role = 'admin'
  for share;
  if not found then
    raise exception 'Administrator access required.' using errcode = '42501';
  end if;
  if normalized_snapshot !~ '^[a-f0-9]{64}$' or source_artifact_id_input is null then
    raise exception 'Archived SignWell binding evidence is invalid.' using errcode = '22023';
  end if;

  select * into deal_record
  from public.program_deal_versions
  where id = target_deal_version_id
  for update;
  if not found then raise exception 'Deal version was not found.' using errcode = 'P0002'; end if;
  if deal_record.status <> 'sealed' then
    raise exception 'Only a sealed deal snapshot can receive a signing binding.' using errcode = '55000';
  end if;
  if deal_record.snapshot_sha256 is distinct from normalized_snapshot then
    raise exception 'The sealed deal snapshot changed. Refresh before recording the binding.'
      using errcode = '40001';
  end if;

  select * into artifact_record
  from public.program_deal_template_source_artifacts
  where id = source_artifact_id_input
    and deal_version_id = target_deal_version_id
    and provider = 'signwell'
    and provider_environment = 'production'
    and deal_snapshot_sha256 = normalized_snapshot
  for share;
  if not found then
    raise exception 'The immutable template source does not match this deal snapshot.'
      using errcode = '22023';
  end if;

  select * into binding_record
  from public.program_deal_signing_bindings
  where deal_version_id = target_deal_version_id
    and provider = 'signwell'
    and provider_environment = 'production'
  for update;
  if found and binding_record.status = 'verified' then
    if binding_record.source_artifact_id = artifact_record.id
      and binding_record.provider_template_id = artifact_record.provider_template_id
      and binding_record.provider_template_sha256 = artifact_record.source_sha256
      and binding_record.bound_snapshot_sha256 = artifact_record.deal_snapshot_sha256
    then
      return public.get_admin_program_deal_detail(target_deal_version_id);
    end if;
    raise exception 'A verified production binding cannot be silently replaced.' using errcode = '55000';
  end if;

  insert into public.program_deal_signing_bindings (
    deal_version_id, provider, provider_environment, provider_template_id,
    provider_template_sha256, bound_snapshot_sha256, source_artifact_id,
    status, configured_by, verified_at, verified_by, verification_method,
    created_at, updated_at
  ) values (
    target_deal_version_id, 'signwell', 'production', artifact_record.provider_template_id,
    artifact_record.source_sha256, artifact_record.deal_snapshot_sha256,
    artifact_record.id, 'pending', actor_id, null, null, null, now(), now()
  )
  on conflict (deal_version_id, provider, provider_environment) do update
  set provider_template_id = excluded.provider_template_id,
      provider_template_sha256 = excluded.provider_template_sha256,
      bound_snapshot_sha256 = excluded.bound_snapshot_sha256,
      source_artifact_id = excluded.source_artifact_id,
      status = 'pending',
      configured_by = excluded.configured_by,
      verified_at = null,
      verified_by = null,
      verification_method = null,
      updated_at = now();

  insert into public.program_deal_events (
    deal_version_id, event_type, actor_user_id, draft_revision,
    from_status, to_status, metadata
  ) values (
    target_deal_version_id, 'signwell_binding_recorded', actor_id,
    deal_record.draft_revision, 'sealed', 'sealed',
    jsonb_build_object(
      'provider', 'signwell',
      'environment', 'production',
      'templateId', artifact_record.provider_template_id,
      'sourceArtifactId', artifact_record.id,
      'templateSourceSha256', artifact_record.source_sha256,
      'snapshotHash', artifact_record.deal_snapshot_sha256,
      'verificationState', 'pending_manual_attestation'
    )
  );

  return public.get_admin_program_deal_detail(target_deal_version_id);
end;
$$;

create or replace function public.verify_admin_program_deal_signwell_binding_from_artifact(
  target_deal_version_id uuid,
  actor_user_id_input uuid,
  expected_snapshot_sha256 text,
  source_artifact_id_input uuid,
  verification_attestation text
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  actor_id uuid := actor_user_id_input;
  required_attestation constant text :=
    'I verified this exact SignWell production template source against this sealed deal snapshot.';
  normalized_snapshot text := btrim(coalesce(expected_snapshot_sha256, ''));
  deal_record public.program_deal_versions%rowtype;
  artifact_record public.program_deal_template_source_artifacts%rowtype;
  binding_record public.program_deal_signing_bindings%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role' or actor_id is null then
    raise exception 'Service-role access with administrator attribution required.'
      using errcode = '42501';
  end if;
  perform 1 from public.staff_members
  where auth_user_id = actor_id and active and role = 'admin'
  for share;
  if not found then raise exception 'Administrator access required.' using errcode = '42501'; end if;
  if verification_attestation is distinct from required_attestation
    or normalized_snapshot !~ '^[a-f0-9]{64}$'
    or source_artifact_id_input is null
  then
    raise exception 'Explicit archived-source attestation is required.' using errcode = '22023';
  end if;

  select * into deal_record
  from public.program_deal_versions
  where id = target_deal_version_id
  for update;
  if not found then raise exception 'Deal version was not found.' using errcode = 'P0002'; end if;
  if deal_record.status <> 'sealed' then
    raise exception 'Only a sealed deal snapshot can receive binding verification.' using errcode = '55000';
  end if;
  if deal_record.snapshot_sha256 is distinct from normalized_snapshot then
    raise exception 'The sealed deal snapshot changed. Refresh before verifying the binding.'
      using errcode = '40001';
  end if;

  select * into artifact_record
  from public.program_deal_template_source_artifacts
  where id = source_artifact_id_input
    and deal_version_id = target_deal_version_id
    and provider = 'signwell'
    and provider_environment = 'production'
    and deal_snapshot_sha256 = normalized_snapshot
  for share;
  if not found then
    raise exception 'The immutable template source does not match this deal snapshot.'
      using errcode = '22023';
  end if;

  select * into binding_record
  from public.program_deal_signing_bindings
  where deal_version_id = target_deal_version_id
    and provider = 'signwell'
    and provider_environment = 'production'
  for update;
  if not found then
    raise exception 'Record the archived source as the pending production binding first.'
      using errcode = '55000';
  end if;
  if binding_record.source_artifact_id is distinct from artifact_record.id
    or binding_record.provider_template_id is distinct from artifact_record.provider_template_id
    or binding_record.provider_template_sha256 is distinct from artifact_record.source_sha256
    or binding_record.bound_snapshot_sha256 is distinct from artifact_record.deal_snapshot_sha256
  then
    raise exception 'The pending binding does not match the immutable archived source.'
      using errcode = '40001';
  end if;
  if binding_record.status = 'disabled' then
    raise exception 'A disabled signing binding cannot be verified.' using errcode = '55000';
  end if;
  if binding_record.status = 'verified' then
    return jsonb_build_object(
      'dealVersionId', target_deal_version_id,
      'sourceArtifactId', artifact_record.id,
      'verified', true
    );
  end if;

  update public.program_deal_signing_bindings
  set status = 'verified',
      verified_at = now(),
      verified_by = actor_id,
      verification_method = 'manual_admin_attestation',
      updated_at = now()
  where id = binding_record.id;

  insert into public.program_deal_events (
    deal_version_id, event_type, actor_user_id, draft_revision,
    from_status, to_status, metadata
  ) values (
    target_deal_version_id, 'signwell_binding_verified', actor_id,
    deal_record.draft_revision, 'sealed', 'sealed',
    jsonb_build_object(
      'provider', 'signwell',
      'environment', 'production',
      'templateId', artifact_record.provider_template_id,
      'sourceArtifactId', artifact_record.id,
      'templateSourceSha256', artifact_record.source_sha256,
      'snapshotHash', artifact_record.deal_snapshot_sha256,
      'verificationMethod', 'manual_admin_attestation',
      'attestationText', required_attestation,
      'integrityCheckedAt', statement_timestamp(),
      'integrityMethod', 'server_private_storage_download_size_structure_sha256'
    )
  );

  return jsonb_build_object(
    'dealVersionId', target_deal_version_id,
    'sourceArtifactId', artifact_record.id,
    'verified', true
  );
end;
$$;

-- Activation is also a server-only integrity-gated mutation. The application
-- must first download and validate source_artifact_id_input, then call this RPC
-- with the authenticated administrator's explicit user ID for attribution.
create or replace function public.activate_admin_program_deal_default_from_verified_artifact(
  target_deal_version_id uuid,
  actor_user_id_input uuid,
  expected_snapshot_sha256 text,
  source_artifact_id_input uuid,
  activation_confirmation text
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  actor_id uuid := actor_user_id_input;
  required_confirmation constant text :=
    'ACTIVATE THIS EXACT SEALED DEAL SNAPSHOT AS THE DEFAULT';
  normalized_snapshot text := btrim(coalesce(expected_snapshot_sha256, ''));
  deal_record public.program_deal_versions%rowtype;
  previous_default public.program_deal_versions%rowtype;
  readiness_blockers text[];
  exact_binding_count integer;
  integrity_source_hash text;
begin
  if coalesce(auth.role(), '') <> 'service_role' or actor_id is null then
    raise exception 'Service-role access with administrator attribution required.'
      using errcode = '42501';
  end if;
  if activation_confirmation is distinct from required_confirmation
    or normalized_snapshot !~ '^[a-f0-9]{64}$'
    or source_artifact_id_input is null
  then
    raise exception 'Exact snapshot and source-artifact activation evidence is required.'
      using errcode = '22023';
  end if;

  -- Prevent artifact metadata, evidence, staff-role, or default changes from
  -- racing the final readiness evaluation and handoff.
  lock table public.staff_members in share mode;
  lock table public.program_deal_versions,
             public.program_deal_approvals,
             public.program_deal_signing_bindings,
             public.program_deal_template_source_artifacts
    in share row exclusive mode;

  if not exists (
    select 1 from public.staff_members
    where auth_user_id = actor_id and active and role = 'admin'
  ) then
    raise exception 'Administrator access required.' using errcode = '42501';
  end if;

  select * into deal_record
  from public.program_deal_versions
  where id = target_deal_version_id
  for update;
  if not found then
    raise exception 'Deal version was not found.' using errcode = 'P0002';
  end if;
  if deal_record.snapshot_sha256 is distinct from normalized_snapshot then
    raise exception 'The sealed deal snapshot changed. Refresh before activation.'
      using errcode = '40001';
  end if;

  select count(*), min(artifact.source_sha256)
  into exact_binding_count, integrity_source_hash
  from public.program_deal_signing_bindings binding
  join public.program_deal_template_source_artifacts artifact
    on artifact.id = binding.source_artifact_id
   and artifact.id = source_artifact_id_input
   and artifact.deal_version_id = binding.deal_version_id
   and artifact.provider = binding.provider
   and artifact.provider_environment = binding.provider_environment
   and artifact.provider_template_id = binding.provider_template_id
   and artifact.source_sha256 = binding.provider_template_sha256
   and artifact.deal_snapshot_sha256 = binding.bound_snapshot_sha256
  where binding.deal_version_id = target_deal_version_id
    and binding.provider = 'signwell'
    and binding.provider_environment = 'production'
    and binding.status = 'verified'
    and binding.bound_snapshot_sha256 = normalized_snapshot;
  if exact_binding_count <> 1 then
    raise exception 'The integrity-checked source artifact is not the verified production binding.'
      using errcode = '55000';
  end if;

  if deal_record.status = 'active' and deal_record.is_default then
    readiness_blockers := public.admin_program_deal_readiness(deal_record.id);
    if readiness_blockers is null or cardinality(readiness_blockers) <> 0 then
      raise exception 'The current default no longer satisfies release readiness.'
        using errcode = '55000';
    end if;
    return jsonb_build_object(
      'dealVersionId', target_deal_version_id,
      'sourceArtifactId', source_artifact_id_input,
      'activated', true
    );
  end if;
  if deal_record.status <> 'sealed' or deal_record.is_default
    or deal_record.effective_at is not null
  then
    raise exception 'Only an unactivated sealed deal snapshot can become the default.'
      using errcode = '55000';
  end if;

  readiness_blockers := public.admin_program_deal_readiness(deal_record.id);
  if readiness_blockers is null or cardinality(readiness_blockers) <> 0 then
    raise exception 'The sealed deal snapshot is not ready for activation.'
      using errcode = '55000';
  end if;

  select * into previous_default
  from public.program_deal_versions
  where is_default and status = 'active'
  limit 1
  for update;

  if previous_default.id is not null then
    update public.program_deal_versions
    set is_default = false,
        status = 'retired'
    where id = previous_default.id;

    insert into public.program_deal_events (
      deal_version_id, event_type, actor_user_id, draft_revision,
      from_status, to_status, metadata
    ) values (
      previous_default.id, 'default_replaced_and_retired', actor_id,
      previous_default.draft_revision, 'active', 'retired',
      jsonb_build_object(
        'replacementDealVersionId', deal_record.id,
        'replacementSnapshotHash', normalized_snapshot
      )
    );
  end if;

  update public.program_deal_versions
  set status = 'active',
      is_default = true,
      effective_at = now()
  where id = deal_record.id;

  insert into public.program_deal_events (
    deal_version_id, event_type, actor_user_id, draft_revision,
    from_status, to_status, metadata
  ) values (
    deal_record.id, 'default_activated', actor_id,
    deal_record.draft_revision, 'sealed', 'active',
    jsonb_build_object(
      'snapshotHash', normalized_snapshot,
      'sourceArtifactId', source_artifact_id_input,
      'templateSourceSha256', integrity_source_hash,
      'previousDefaultDealVersionId', previous_default.id,
      'activationConfirmation', required_confirmation,
      'readinessRecomputedUnderLock', true,
      'integrityCheckedAt', statement_timestamp(),
      'integrityMethod', 'server_private_storage_download_size_structure_sha256'
    )
  );

  return jsonb_build_object(
    'dealVersionId', target_deal_version_id,
    'sourceArtifactId', source_artifact_id_input,
    'activated', true
  );
end;
$$;

revoke execute on function public.prevent_program_deal_template_source_artifact_mutation()
from public, anon, authenticated, service_role;
revoke execute on function public.enforce_program_deal_signing_binding_source_artifact()
from public, anon, authenticated, service_role;

revoke execute on function public.authorize_admin_program_deal_template_source_upload(uuid)
from public, anon, service_role;
grant execute on function public.authorize_admin_program_deal_template_source_upload(uuid)
to authenticated;

revoke execute on function public.prepare_admin_program_deal_template_source_upload(uuid, text, text)
from public, anon;
grant execute on function public.prepare_admin_program_deal_template_source_upload(uuid, text, text)
to authenticated;

revoke execute on function public.archive_admin_program_deal_template_source(uuid, uuid, text, text, text, text, text, text, bigint)
from public, anon, authenticated;
grant execute on function public.archive_admin_program_deal_template_source(uuid, uuid, text, text, text, text, text, text, bigint)
to service_role;

revoke execute on function public.get_admin_program_deal_template_source_artifact(uuid)
from public, anon;
grant execute on function public.get_admin_program_deal_template_source_artifact(uuid)
to authenticated;

revoke execute on function public.get_server_program_deal_template_source_artifact(uuid, uuid)
from public, anon, authenticated;
grant execute on function public.get_server_program_deal_template_source_artifact(uuid, uuid)
to service_role;

revoke execute on function public.record_admin_program_deal_signwell_binding_from_artifact(uuid, text, uuid)
from public, anon;
grant execute on function public.record_admin_program_deal_signwell_binding_from_artifact(uuid, text, uuid)
to authenticated;

revoke execute on function public.verify_admin_program_deal_signwell_binding_from_artifact(uuid, uuid, text, uuid, text)
from public, anon, authenticated;
grant execute on function public.verify_admin_program_deal_signwell_binding_from_artifact(uuid, uuid, text, uuid, text)
to service_role;

revoke execute on function public.activate_admin_program_deal_default_from_verified_artifact(uuid, uuid, text, uuid, text)
from public, anon, authenticated;
grant execute on function public.activate_admin_program_deal_default_from_verified_artifact(uuid, uuid, text, uuid, text)
to service_role;

-- Supersede the browser-hash-authoritative release functions from migration
-- 122. They remain defined for migration history but are no longer callable by
-- browser roles, and the binding trigger rejects unarchived production writes.
revoke execute on function public.record_admin_program_deal_signwell_binding(uuid, text, text, text)
from public, anon, authenticated;
revoke execute on function public.verify_admin_program_deal_signwell_binding(uuid, text, text, text, text)
from public, anon, authenticated;
revoke execute on function public.activate_admin_program_deal_default(uuid, text, text)
from public, anon, authenticated, service_role;

comment on table public.program_deal_template_source_artifacts is
  'Application-immutable, tamper-evident metadata for the exact server-hashed PDF or DOCX archived before a SignWell production template can be released. This is not storage-level WORM.';
comment on column public.program_deal_signing_bindings.source_artifact_id is
  'Application-immutable source artifact whose server-computed hash, provider template ID, and deal snapshot were copied into this binding.';
comment on function public.authorize_admin_program_deal_template_source_upload(uuid) is
  'Authenticated active-admin authorization check intended to run before parsing a template-source multipart body.';
comment on function public.archive_admin_program_deal_template_source(uuid, uuid, text, text, text, text, text, text, bigint) is
  'Service-role-only tamper-evident archive registration after the server has validated, hashed, and privately stored the source bytes.';
comment on function public.get_server_program_deal_template_source_artifact(uuid, uuid) is
  'Service-role-only metadata envelope for the server byte-integrity gate; direct service-role table access remains revoked.';
comment on function public.record_admin_program_deal_signwell_binding_from_artifact(uuid, text, uuid) is
  'Admin-only pending SignWell binding copied from one application-immutable, server-hashed source artifact; no browser hash is accepted.';
comment on function public.verify_admin_program_deal_signwell_binding_from_artifact(uuid, uuid, text, uuid, text) is
  'Service-role-only manual attestation mutation after application byte-integrity validation, with explicit authenticated-admin attribution; no provider-content API verification is claimed.';
comment on function public.activate_admin_program_deal_default_from_verified_artifact(uuid, uuid, text, uuid, text) is
  'Service-role-only default activation after application byte-integrity validation, with explicit authenticated-admin attribution and exact source binding.';

-- Intentionally no source artifact, binding, approval, deal version, or default
-- is seeded by this migration. Release remains fail-closed.
