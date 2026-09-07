-- Guarded release workflow for immutable creator-deal snapshots.
--
-- This migration exposes no direct table writes and does not call the legacy
-- default-rotation function. Every release mutation is admin-only, is bound to
-- the exact sealed snapshot hash supplied by the browser, and appends an audit
-- event. SignWell verification is a separate, explicit manual attestation over
-- a previously recorded pending production binding; callers never supply a
-- status field.

alter table public.program_deal_signing_bindings
  add column verified_by uuid
    references public.staff_members(auth_user_id) on delete restrict,
  add column verification_method text;

alter table public.program_deal_signing_bindings
  add constraint program_deal_signing_bindings_verified_actor_required
  check (
    (status = 'verified') = (
      verified_by is not null
      and verification_method = 'manual_admin_attestation'
    )
  );

alter table public.program_deal_approvals
  add column revoked_by uuid
    references public.staff_members(auth_user_id) on delete restrict,
  add column revocation_note text;

alter table public.program_deal_approvals
  add constraint program_deal_approvals_revocation_actor_required
  check (
    (status = 'revoked') = (
      revoked_by is not null
      and revoked_at is not null
      and revocation_note is not null
    )
  ),
  add constraint program_deal_approvals_revocation_note_length
  check (
    revocation_note is null
    or char_length(revocation_note) between 4 and 2000
  ),
  add constraint program_deal_approvals_legal_note_required
  check (
    approval_kind <> 'legal'
    or (
      note is not null
      and char_length(btrim(note)) between 4 and 2000
    )
  );

-- Readiness independently revalidates the release evidence. Mutation-time
-- checks are not trusted as a substitute: both approvers and the binding
-- verifier must still be active administrators, and the two approval kinds
-- must belong to distinct authenticated accounts at the moment readiness is
-- evaluated. This control does not independently prove distinct human identity.
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

  if not found then
    return array['Deal version was not found.'];
  end if;

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
      'Verify exactly one production SignWell template source against this snapshot.'
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

-- Expose all stored evidence needed to verify a release decision in the admin
-- detail response. The provider ID is deliberately not inferred from a hash.
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

create or replace function public.record_admin_program_deal_approval(
  target_deal_version_id uuid,
  approval_kind_input text,
  expected_snapshot_sha256 text,
  note_input text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  actor_id uuid := auth.uid();
  normalized_kind text := lower(btrim(coalesce(approval_kind_input, '')));
  normalized_snapshot text := btrim(coalesce(expected_snapshot_sha256, ''));
  normalized_note text := nullif(btrim(coalesce(note_input, '')), '');
  deal_record public.program_deal_versions%rowtype;
  existing_approval public.program_deal_approvals%rowtype;
  other_approver uuid;
begin
  perform 1 from public.staff_members
  where auth_user_id = actor_id and active and role = 'admin'
  for share;
  if not found then
    raise exception 'Administrator access required.' using errcode = '42501';
  end if;
  if normalized_kind not in ('business', 'legal')
    or normalized_snapshot !~ '^[a-f0-9]{64}$'
    or (
      normalized_kind = 'legal'
      and (normalized_note is null or char_length(normalized_note) < 4)
    )
    or (normalized_note is not null and char_length(normalized_note) > 2000)
  then
    raise exception 'Approval request is invalid.' using errcode = '22023';
  end if;

  select * into deal_record
  from public.program_deal_versions
  where id = target_deal_version_id
  for update;
  if not found then
    raise exception 'Deal version was not found.' using errcode = 'P0002';
  end if;
  if deal_record.status <> 'sealed' then
    raise exception 'Only a sealed deal snapshot can be approved.' using errcode = '55000';
  end if;
  if deal_record.snapshot_sha256 is distinct from normalized_snapshot then
    raise exception 'The sealed deal snapshot changed. Refresh before approving.' using errcode = '40001';
  end if;

  select * into existing_approval
  from public.program_deal_approvals
  where deal_version_id = target_deal_version_id
    and approval_kind = normalized_kind
  for update;
  if found and existing_approval.status = 'approved' then
    if existing_approval.snapshot_sha256 = normalized_snapshot
      and existing_approval.approved_by = actor_id
      and existing_approval.note is not distinct from normalized_note
    then
      return public.get_admin_program_deal_detail(target_deal_version_id);
    end if;
    raise exception 'An active approval must be explicitly revoked before replacement.'
      using errcode = '55000';
  end if;

  select approval.approved_by into other_approver
  from public.program_deal_approvals approval
  join public.staff_members approver
    on approver.auth_user_id = approval.approved_by
   and approver.active
   and approver.role = 'admin'
  where approval.deal_version_id = target_deal_version_id
    and approval.approval_kind <> normalized_kind
    and approval.status = 'approved'
    and approval.snapshot_sha256 = normalized_snapshot
  for update of approval;

  if other_approver = actor_id then
    raise exception 'Business and legal approvals require distinct active administrators.'
      using errcode = '42501';
  end if;

  insert into public.program_deal_approvals (
    deal_version_id, approval_kind, status, snapshot_sha256,
    approved_by, note, approved_at, revoked_at, revoked_by,
    revocation_note, created_at, updated_at
  ) values (
    target_deal_version_id, normalized_kind, 'approved', normalized_snapshot,
    actor_id, normalized_note, now(), null, null, null, now(), now()
  )
  on conflict (deal_version_id, approval_kind) do update
  set status = 'approved',
      snapshot_sha256 = excluded.snapshot_sha256,
      approved_by = excluded.approved_by,
      note = excluded.note,
      approved_at = now(),
      revoked_at = null,
      revoked_by = null,
      revocation_note = null,
      updated_at = now();

  insert into public.program_deal_events (
    deal_version_id, event_type, actor_user_id, draft_revision,
    from_status, to_status, metadata
  ) values (
    target_deal_version_id, 'snapshot_approval_recorded', actor_id,
    deal_record.draft_revision, 'sealed', 'sealed',
    jsonb_build_object(
      'approvalKind', normalized_kind,
      'snapshotHash', normalized_snapshot,
      'note', normalized_note
    )
  );

  return public.get_admin_program_deal_detail(target_deal_version_id);
end;
$$;

create or replace function public.revoke_admin_program_deal_approval(
  target_deal_version_id uuid,
  approval_kind_input text,
  expected_snapshot_sha256 text,
  revocation_note_input text
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  actor_id uuid := auth.uid();
  normalized_kind text := lower(btrim(coalesce(approval_kind_input, '')));
  normalized_snapshot text := btrim(coalesce(expected_snapshot_sha256, ''));
  normalized_note text := btrim(coalesce(revocation_note_input, ''));
  deal_record public.program_deal_versions%rowtype;
  approval_record public.program_deal_approvals%rowtype;
begin
  perform 1 from public.staff_members
  where auth_user_id = actor_id and active and role = 'admin'
  for share;
  if not found then
    raise exception 'Administrator access required.' using errcode = '42501';
  end if;
  if normalized_kind not in ('business', 'legal')
    or normalized_snapshot !~ '^[a-f0-9]{64}$'
    or char_length(normalized_note) not between 4 and 2000
  then
    raise exception 'Approval revocation request is invalid.' using errcode = '22023';
  end if;

  select * into deal_record
  from public.program_deal_versions
  where id = target_deal_version_id
  for update;
  if not found then
    raise exception 'Deal version was not found.' using errcode = 'P0002';
  end if;
  if deal_record.status not in ('sealed', 'active') then
    raise exception 'Only a sealed or active deal approval can be revoked.' using errcode = '55000';
  end if;
  if deal_record.snapshot_sha256 is distinct from normalized_snapshot then
    raise exception 'The deal snapshot changed. Refresh before revoking approval.' using errcode = '40001';
  end if;

  select * into approval_record
  from public.program_deal_approvals
  where deal_version_id = target_deal_version_id
    and approval_kind = normalized_kind
  for update;
  if not found or approval_record.status <> 'approved'
    or approval_record.snapshot_sha256 is distinct from normalized_snapshot
  then
    raise exception 'A matching active approval was not found.' using errcode = '55000';
  end if;

  update public.program_deal_approvals
  set status = 'revoked',
      revoked_at = now(),
      revoked_by = actor_id,
      revocation_note = normalized_note,
      updated_at = now()
  where id = approval_record.id;

  insert into public.program_deal_events (
    deal_version_id, event_type, actor_user_id, draft_revision,
    from_status, to_status, metadata
  ) values (
    target_deal_version_id, 'snapshot_approval_revoked', actor_id,
    deal_record.draft_revision, deal_record.status, deal_record.status,
    jsonb_build_object(
      'approvalKind', normalized_kind,
      'snapshotHash', normalized_snapshot,
      'originalApprover', approval_record.approved_by,
      'revocationNote', normalized_note,
      'newAssignmentsBlocked', deal_record.status = 'active'
    )
  );

  return public.get_admin_program_deal_detail(target_deal_version_id);
end;
$$;

create or replace function public.record_admin_program_deal_signwell_binding(
  target_deal_version_id uuid,
  expected_snapshot_sha256 text,
  provider_template_id_input text,
  provider_template_sha256_input text
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  actor_id uuid := auth.uid();
  normalized_snapshot text := btrim(coalesce(expected_snapshot_sha256, ''));
  normalized_template_id text := btrim(coalesce(provider_template_id_input, ''));
  normalized_template_hash text := btrim(coalesce(provider_template_sha256_input, ''));
  deal_record public.program_deal_versions%rowtype;
  binding_record public.program_deal_signing_bindings%rowtype;
begin
  perform 1 from public.staff_members
  where auth_user_id = actor_id and active and role = 'admin'
  for share;
  if not found then
    raise exception 'Administrator access required.' using errcode = '42501';
  end if;
  if normalized_snapshot !~ '^[a-f0-9]{64}$'
    or normalized_template_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or normalized_template_hash !~ '^[a-f0-9]{64}$'
  then
    raise exception 'SignWell binding evidence is invalid.' using errcode = '22023';
  end if;

  select * into deal_record
  from public.program_deal_versions
  where id = target_deal_version_id
  for update;
  if not found then
    raise exception 'Deal version was not found.' using errcode = 'P0002';
  end if;
  if deal_record.status <> 'sealed' then
    raise exception 'Only a sealed deal snapshot can receive a signing binding.' using errcode = '55000';
  end if;
  if deal_record.snapshot_sha256 is distinct from normalized_snapshot then
    raise exception 'The sealed deal snapshot changed. Refresh before recording the binding.'
      using errcode = '40001';
  end if;

  select * into binding_record
  from public.program_deal_signing_bindings
  where deal_version_id = target_deal_version_id
    and provider = 'signwell'
    and provider_environment = 'production'
  for update;

  if found and binding_record.status = 'verified' then
    if binding_record.provider_template_id = normalized_template_id
      and binding_record.provider_template_sha256 = normalized_template_hash
      and binding_record.bound_snapshot_sha256 = normalized_snapshot
    then
      return public.get_admin_program_deal_detail(target_deal_version_id);
    end if;
    raise exception 'A verified production binding cannot be silently replaced.' using errcode = '55000';
  end if;

  insert into public.program_deal_signing_bindings (
    deal_version_id, provider, provider_environment, provider_template_id,
    provider_template_sha256, bound_snapshot_sha256, status, configured_by,
    verified_at, verified_by, verification_method, created_at, updated_at
  ) values (
    target_deal_version_id, 'signwell', 'production', normalized_template_id,
    normalized_template_hash, normalized_snapshot, 'pending', actor_id,
    null, null, null, now(), now()
  )
  on conflict (deal_version_id, provider, provider_environment) do update
  set provider_template_id = excluded.provider_template_id,
      provider_template_sha256 = excluded.provider_template_sha256,
      bound_snapshot_sha256 = excluded.bound_snapshot_sha256,
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
      'templateId', normalized_template_id,
      'templateSourceSha256', normalized_template_hash,
      'snapshotHash', normalized_snapshot,
      'verificationState', 'pending_manual_attestation'
    )
  );

  return public.get_admin_program_deal_detail(target_deal_version_id);
end;
$$;

create or replace function public.verify_admin_program_deal_signwell_binding(
  target_deal_version_id uuid,
  expected_snapshot_sha256 text,
  provider_template_id_input text,
  provider_template_sha256_input text,
  verification_attestation text
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  actor_id uuid := auth.uid();
  required_attestation constant text :=
    'I verified this exact SignWell production template source against this sealed deal snapshot.';
  normalized_snapshot text := btrim(coalesce(expected_snapshot_sha256, ''));
  normalized_template_id text := btrim(coalesce(provider_template_id_input, ''));
  normalized_template_hash text := btrim(coalesce(provider_template_sha256_input, ''));
  deal_record public.program_deal_versions%rowtype;
  binding_record public.program_deal_signing_bindings%rowtype;
begin
  perform 1 from public.staff_members
  where auth_user_id = actor_id and active and role = 'admin'
  for share;
  if not found then
    raise exception 'Administrator access required.' using errcode = '42501';
  end if;
  if verification_attestation is distinct from required_attestation
    or normalized_snapshot !~ '^[a-f0-9]{64}$'
    or normalized_template_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or normalized_template_hash !~ '^[a-f0-9]{64}$'
  then
    raise exception 'Explicit SignWell evidence attestation is required.' using errcode = '22023';
  end if;

  select * into deal_record
  from public.program_deal_versions
  where id = target_deal_version_id
  for update;
  if not found then
    raise exception 'Deal version was not found.' using errcode = 'P0002';
  end if;
  if deal_record.status <> 'sealed' then
    raise exception 'Only a sealed deal snapshot can receive binding verification.' using errcode = '55000';
  end if;
  if deal_record.snapshot_sha256 is distinct from normalized_snapshot then
    raise exception 'The sealed deal snapshot changed. Refresh before verifying the binding.'
      using errcode = '40001';
  end if;

  select * into binding_record
  from public.program_deal_signing_bindings
  where deal_version_id = target_deal_version_id
    and provider = 'signwell'
    and provider_environment = 'production'
  for update;
  if not found then
    raise exception 'Record the pending production binding before verification.' using errcode = '55000';
  end if;
  if binding_record.provider_template_id is distinct from normalized_template_id
    or binding_record.provider_template_sha256 is distinct from normalized_template_hash
    or binding_record.bound_snapshot_sha256 is distinct from normalized_snapshot
  then
    raise exception 'The supplied SignWell evidence does not match the pending binding.'
      using errcode = '40001';
  end if;
  if binding_record.status = 'disabled' then
    raise exception 'A disabled signing binding cannot be verified.' using errcode = '55000';
  end if;
  if binding_record.status = 'verified' then
    return public.get_admin_program_deal_detail(target_deal_version_id);
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
      'templateId', normalized_template_id,
      'templateSourceSha256', normalized_template_hash,
      'snapshotHash', normalized_snapshot,
      'verificationMethod', 'manual_admin_attestation',
      'attestationText', required_attestation
    )
  );

  return public.get_admin_program_deal_detail(target_deal_version_id);
end;
$$;

create or replace function public.activate_admin_program_deal_default(
  target_deal_version_id uuid,
  expected_snapshot_sha256 text,
  activation_confirmation text
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  actor_id uuid := auth.uid();
  required_confirmation constant text :=
    'ACTIVATE THIS EXACT SEALED DEAL SNAPSHOT AS THE DEFAULT';
  normalized_snapshot text := btrim(coalesce(expected_snapshot_sha256, ''));
  deal_record public.program_deal_versions%rowtype;
  previous_default public.program_deal_versions%rowtype;
  readiness_blockers text[];
begin
  if actor_id is null then
    raise exception 'Administrator access required.' using errcode = '42501';
  end if;
  if activation_confirmation is distinct from required_confirmation
    or normalized_snapshot !~ '^[a-f0-9]{64}$'
  then
    raise exception 'Exact snapshot activation confirmation is required.' using errcode = '22023';
  end if;

  -- Prevent evidence, staff-role, or default changes from racing the final
  -- readiness evaluation and handoff.
  lock table public.staff_members in share mode;
  lock table public.program_deal_versions,
             public.program_deal_approvals,
             public.program_deal_signing_bindings
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
    raise exception 'The sealed deal snapshot changed. Refresh before activation.' using errcode = '40001';
  end if;
  if deal_record.status = 'active' and deal_record.is_default then
    readiness_blockers := public.admin_program_deal_readiness(deal_record.id);
    if readiness_blockers is null or cardinality(readiness_blockers) <> 0 then
      raise exception 'The current default no longer satisfies release readiness.' using errcode = '55000';
    end if;
    return public.get_admin_program_deal_detail(target_deal_version_id);
  end if;
  if deal_record.status <> 'sealed' or deal_record.is_default
    or deal_record.effective_at is not null
  then
    raise exception 'Only an unactivated sealed deal snapshot can become the default.'
      using errcode = '55000';
  end if;

  -- Recompute under the evidence locks; a stale UI readiness flag is never an
  -- activation input.
  readiness_blockers := public.admin_program_deal_readiness(deal_record.id);
  if readiness_blockers is null or cardinality(readiness_blockers) <> 0 then
    raise exception 'The sealed deal snapshot is not ready for activation.' using errcode = '55000';
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
      'previousDefaultDealVersionId', previous_default.id,
      'activationConfirmation', required_confirmation,
      'readinessRecomputedUnderLock', true
    )
  );

  return public.get_admin_program_deal_detail(target_deal_version_id);
end;
$$;

revoke execute on function public.admin_program_deal_readiness(uuid)
from public, anon, authenticated;

revoke execute on function public.record_admin_program_deal_approval(uuid, text, text, text)
from public, anon;
grant execute on function public.record_admin_program_deal_approval(uuid, text, text, text)
to authenticated;

revoke execute on function public.revoke_admin_program_deal_approval(uuid, text, text, text)
from public, anon;
grant execute on function public.revoke_admin_program_deal_approval(uuid, text, text, text)
to authenticated;

revoke execute on function public.record_admin_program_deal_signwell_binding(uuid, text, text, text)
from public, anon;
grant execute on function public.record_admin_program_deal_signwell_binding(uuid, text, text, text)
to authenticated;

revoke execute on function public.verify_admin_program_deal_signwell_binding(uuid, text, text, text, text)
from public, anon;
grant execute on function public.verify_admin_program_deal_signwell_binding(uuid, text, text, text, text)
to authenticated;

revoke execute on function public.activate_admin_program_deal_default(uuid, text, text)
from public, anon;
grant execute on function public.activate_admin_program_deal_default(uuid, text, text)
to authenticated;

-- The historical generic rotator remains unavailable to every browser role.
revoke execute on function public.rotate_default_program_deal_version(uuid, boolean)
from public, anon, authenticated;
revoke execute on function public.retire_program_deal_version(uuid)
from public, anon, authenticated;

comment on column public.program_deal_signing_bindings.provider_template_sha256 is
  'Admin-supplied SHA-256 of the exact controlled/exported SignWell template source. It is never derived from the template ID.';
comment on function public.record_admin_program_deal_approval(uuid, text, text, text) is
  'Admin-only business/legal approval for an explicitly supplied immutable sealed snapshot. The two current approvals require distinct active admins.';
comment on function public.revoke_admin_program_deal_approval(uuid, text, text, text) is
  'Admin-only exact-snapshot approval revocation with required reason and append-only audit event. Existing creator assignments are unchanged.';
comment on function public.record_admin_program_deal_signwell_binding(uuid, text, text, text) is
  'Admin-only recording of an exact pending production SignWell template ID, independently computed source SHA-256, and sealed snapshot hash. It does not verify the binding.';
comment on function public.verify_admin_program_deal_signwell_binding(uuid, text, text, text, text) is
  'Admin-only manual verification of a matching pending production SignWell binding. Exact evidence and the full attestation phrase are required; callers never set status.';
comment on function public.activate_admin_program_deal_default(uuid, text, text) is
  'Admin-only exact-snapshot activation. Readiness is recomputed while evidence/default tables are locked and the prior default is retired atomically.';
