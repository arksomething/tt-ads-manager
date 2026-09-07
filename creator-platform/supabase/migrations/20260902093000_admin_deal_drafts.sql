-- Admin deal-draft control plane.
--
-- This migration deliberately does not seed a deal, import the public sample,
-- activate a default, or expose activation/retirement over the authenticated
-- API. Draft content is always supplied by an administrator and remains
-- fail-closed until it is sealed, approved, and bound to a verified signing
-- template in later, separately reviewed workflows.

alter table public.program_deal_versions
  add column if not exists economics_json jsonb,
  add column if not exists economics_sha256 text,
  add column if not exists snapshot_sha256 text,
  add column if not exists draft_revision integer not null default 1,
  add column if not exists change_note text,
  add column if not exists sealed_at timestamptz,
  add column if not exists sealed_by uuid references public.staff_members(auth_user_id) on delete restrict,
  add column if not exists updated_at timestamptz not null default now();

alter table public.program_deal_versions
  drop constraint if exists program_deal_versions_status_check;

alter table public.program_deal_versions
  add constraint program_deal_versions_status_check
  check (status in ('draft', 'sealed', 'active', 'retired'));

alter table public.program_deal_versions
  add constraint program_deal_versions_draft_revision_positive
  check (draft_revision > 0),
  add constraint program_deal_versions_economics_sha256_format
  check (economics_sha256 is null or economics_sha256 ~ '^[a-f0-9]{64}$'),
  add constraint program_deal_versions_snapshot_sha256_format
  check (snapshot_sha256 is null or snapshot_sha256 ~ '^[a-f0-9]{64}$'),
  add constraint program_deal_versions_change_note_length
  check (change_note is null or char_length(change_note) <= 2000);

create or replace function public.admin_deal_jsonb_integer(
  candidate jsonb,
  nullable boolean default true,
  maximum numeric default 9007199254740991
)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog, public, pg_temp
as $$
declare
  numeric_candidate numeric;
begin
  if candidate is null or candidate = 'null'::jsonb then
    return nullable;
  end if;

  if jsonb_typeof(candidate) <> 'number' then
    return false;
  end if;

  numeric_candidate := (candidate #>> '{}')::numeric;
  return numeric_candidate = trunc(numeric_candidate)
    and numeric_candidate >= 0
    and numeric_candidate <= maximum;
exception when others then
  return false;
end;
$$;

create or replace function public.admin_deal_placeholder_free(candidate text)
returns boolean
language sql
immutable
set search_path = pg_catalog, public, pg_temp
as $$
  select candidate is not null
    and btrim(candidate) <> ''
    and candidate !~* '(\[\s*(to[ _-]?approve|tbd|todo|fixme|sample|date)|\{\{|\?\?|<\s*(tbd|todo)|(^|[^[:alnum:]_])(placeholder|non[ _-]?binding|not[ _-]+for[ _-]+signature|sample([ _-]?draft)?)([^[:alnum:]_]|$))';
$$;

create or replace function public.admin_deal_economics_valid(
  economics jsonb,
  require_complete boolean default false
)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog, public, pg_temp
as $$
declare
  allowed_keys constant text[] := array[
    'schemaVersion', 'currency', 'currencyExponent',
    'measurementWindowSeconds', 'measurementWindowAnchor',
    'paidImpressionsPolicy', 'invalidTrafficPolicy', 'fixedFeeMicros',
    'creatorAggregateCapMicros', 'minimumQualifiedViews',
    'crossPostPolicy', 'paymentDueDays', 'minimumPayoutMicros', 'tiers'
  ];
  tier_keys constant text[] := array[
    'rateMicrosPerThousand', 'perPostCapMicros', 'qualification'
  ];
  tier_name text;
  tier jsonb;
  currency_value text;
  anchor_value text;
  paid_policy text;
  invalid_policy text;
  cross_post_policy text;
  qualification_value text;
begin
  if economics is null or jsonb_typeof(economics) <> 'object' then
    return false;
  end if;

  if not economics ?& allowed_keys then
    return false;
  end if;

  if exists (
    select 1 from jsonb_object_keys(economics) key_name
    where not (key_name = any (allowed_keys))
  ) then
    return false;
  end if;

  if economics -> 'schemaVersion' <> '1'::jsonb then
    return false;
  end if;

  currency_value := economics ->> 'currency';
  if currency_value is not null and currency_value !~ '^[A-Z]{3}$' then
    return false;
  end if;

  if not public.admin_deal_jsonb_integer(economics -> 'currencyExponent', true, 6)
    or not public.admin_deal_jsonb_integer(economics -> 'measurementWindowSeconds', true, 31557600)
    or not public.admin_deal_jsonb_integer(economics -> 'fixedFeeMicros', true)
    or not public.admin_deal_jsonb_integer(economics -> 'creatorAggregateCapMicros', true)
    or not public.admin_deal_jsonb_integer(economics -> 'minimumQualifiedViews', true)
    or not public.admin_deal_jsonb_integer(economics -> 'paymentDueDays', true, 3650)
    or not public.admin_deal_jsonb_integer(economics -> 'minimumPayoutMicros', true)
  then
    return false;
  end if;

  anchor_value := economics ->> 'measurementWindowAnchor';
  paid_policy := economics ->> 'paidImpressionsPolicy';
  invalid_policy := economics ->> 'invalidTrafficPolicy';
  cross_post_policy := economics ->> 'crossPostPolicy';

  if anchor_value is not null and anchor_value <> 'published_at' then
    return false;
  end if;
  if paid_policy is not null
    and paid_policy not in ('include', 'exclude_verified', 'exclude_all')
  then
    return false;
  end if;
  if invalid_policy is not null
    and invalid_policy not in ('exclude_verified', 'exclude_all')
  then
    return false;
  end if;
  if cross_post_policy is not null
    and cross_post_policy not in (
      'separate_eligible_post', 'single_deliverable', 'campaign_brief'
    )
  then
    return false;
  end if;

  if jsonb_typeof(economics -> 'tiers') <> 'object'
    or not (economics -> 'tiers') ?& array['baseline', 'talking']
    or exists (
      select 1 from jsonb_object_keys(economics -> 'tiers') key_name
      where key_name not in ('baseline', 'talking')
    )
  then
    return false;
  end if;

  foreach tier_name in array array['baseline', 'talking'] loop
    tier := economics -> 'tiers' -> tier_name;
    if jsonb_typeof(tier) <> 'object'
      or not tier ?& tier_keys
      or exists (
        select 1 from jsonb_object_keys(tier) key_name
        where not (key_name = any (tier_keys))
      )
      or not public.admin_deal_jsonb_integer(tier -> 'rateMicrosPerThousand', true)
      or not public.admin_deal_jsonb_integer(tier -> 'perPostCapMicros', true)
    then
      return false;
    end if;

    qualification_value := tier ->> 'qualification';
    if qualification_value is not null
      and (char_length(btrim(qualification_value)) < 2
        or char_length(qualification_value) > 2000)
    then
      return false;
    end if;

    if require_complete and (
      (tier -> 'rateMicrosPerThousand') = 'null'::jsonb
      or ((tier ->> 'rateMicrosPerThousand')::numeric) <= 0
      or (tier -> 'perPostCapMicros') = 'null'::jsonb
      or ((tier ->> 'perPostCapMicros')::numeric) <= 0
      or not public.admin_deal_placeholder_free(qualification_value)
    ) then
      return false;
    end if;
  end loop;

  if require_complete and (
    currency_value is null
    or (economics -> 'currencyExponent') = 'null'::jsonb
    or (economics -> 'measurementWindowSeconds') = 'null'::jsonb
    or ((economics ->> 'measurementWindowSeconds')::numeric) <= 0
    or anchor_value is null
    or paid_policy is null
    or invalid_policy is null
    or (economics -> 'fixedFeeMicros') = 'null'::jsonb
    or (economics -> 'minimumQualifiedViews') = 'null'::jsonb
    or cross_post_policy is null
    or (economics -> 'paymentDueDays') = 'null'::jsonb
    or ((economics ->> 'paymentDueDays')::numeric) <= 0
    or (economics -> 'minimumPayoutMicros') = 'null'::jsonb
  ) then
    return false;
  end if;

  return true;
exception when others then
  return false;
end;
$$;

-- Replace the original terms-only trigger with canonical legal, economics, and
-- combined-snapshot hashes. jsonb::text is canonical inside PostgreSQL: object
-- keys are ordered and insignificant input whitespace is removed.
drop trigger if exists hash_program_deal_terms on public.program_deal_versions;

create or replace function public.hash_program_deal_terms()
returns trigger
language plpgsql
set search_path = pg_catalog, extensions, public, pg_temp
as $$
begin
  new.terms_sha256 := encode(
    digest(convert_to(new.terms_markdown, 'UTF8'), 'sha256'),
    'hex'
  );
  new.economics_sha256 := case
    when new.economics_json is null then null
    else encode(
      digest(convert_to(new.economics_json::text, 'UTF8'), 'sha256'),
      'hex'
    )
  end;
  new.snapshot_sha256 := encode(
    digest(
      convert_to(
        jsonb_build_object(
          'dealKey', new.deal_key,
          'version', new.version,
          'label', new.label,
          'termsMarkdown', new.terms_markdown,
          'economics', new.economics_json
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
  return new;
end;
$$;

create trigger hash_program_deal_terms
before insert or update of deal_key, version, label, terms_markdown, economics_json
on public.program_deal_versions
for each row execute function public.hash_program_deal_terms();

-- Backfill only hashes and bookkeeping for any pre-existing deal rows. No
-- economics, legal terms, defaults, or approval state are invented here.
-- The earlier immutability trigger must be absent during this one-time hash
-- backfill because it rejects every write to a retired row, including writes
-- to columns that did not exist when that row was retired.
drop trigger if exists prevent_finalized_deal_changes
on public.program_deal_versions;

update public.program_deal_versions
set economics_sha256 = case
      when economics_json is null then null
      else encode(extensions.digest(convert_to(economics_json::text, 'UTF8'), 'sha256'), 'hex')
    end,
    snapshot_sha256 = encode(
      extensions.digest(
        convert_to(
          jsonb_build_object(
            'dealKey', deal_key,
            'version', version,
            'label', label,
            'termsMarkdown', terms_markdown,
            'economics', economics_json
          )::text,
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    ),
    updated_at = created_at;

alter table public.program_deal_versions
  alter column snapshot_sha256 set not null;

create table public.program_deal_signing_bindings (
  id uuid primary key default gen_random_uuid(),
  deal_version_id uuid not null
    references public.program_deal_versions(id) on delete restrict,
  provider text not null check (provider in ('signwell')),
  provider_environment text not null check (char_length(provider_environment) between 2 and 40),
  provider_template_id text not null check (char_length(provider_template_id) between 2 and 255),
  provider_template_sha256 text not null check (provider_template_sha256 ~ '^[a-f0-9]{64}$'),
  bound_snapshot_sha256 text not null check (bound_snapshot_sha256 ~ '^[a-f0-9]{64}$'),
  status text not null default 'pending' check (status in ('pending', 'verified', 'disabled')),
  configured_by uuid not null references public.staff_members(auth_user_id) on delete restrict,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (deal_version_id, provider, provider_environment),
  check ((status = 'verified') = (verified_at is not null))
);

create table public.program_deal_approvals (
  id uuid primary key default gen_random_uuid(),
  deal_version_id uuid not null references public.program_deal_versions(id) on delete restrict,
  approval_kind text not null check (approval_kind in ('business', 'legal')),
  status text not null check (status in ('approved', 'revoked')),
  snapshot_sha256 text not null check (snapshot_sha256 ~ '^[a-f0-9]{64}$'),
  approved_by uuid not null references public.staff_members(auth_user_id) on delete restrict,
  note text check (note is null or char_length(note) <= 2000),
  approved_at timestamptz not null default now(),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (deal_version_id, approval_kind),
  check ((status = 'revoked') = (revoked_at is not null))
);

create table public.program_deal_events (
  id bigint generated always as identity primary key,
  deal_version_id uuid not null references public.program_deal_versions(id) on delete restrict,
  event_type text not null check (char_length(event_type) between 3 and 80),
  actor_user_id uuid not null references public.staff_members(auth_user_id) on delete restrict,
  draft_revision integer not null check (draft_revision > 0),
  from_status text,
  to_status text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index program_deal_events_version_created_idx
  on public.program_deal_events (deal_version_id, created_at desc, id desc);

create or replace function public.prevent_program_deal_event_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  raise exception 'Program deal events are append-only.' using errcode = '55000';
end;
$$;

create trigger prevent_program_deal_event_mutation
before update or delete on public.program_deal_events
for each row execute function public.prevent_program_deal_event_mutation();

alter table public.program_deal_signing_bindings enable row level security;
alter table public.program_deal_approvals enable row level security;
alter table public.program_deal_events enable row level security;

revoke all on public.program_deal_signing_bindings from public, anon, authenticated;
revoke all on public.program_deal_approvals from public, anon, authenticated;
revoke all on public.program_deal_events from public, anon, authenticated;
revoke usage, select on sequence public.program_deal_events_id_seq
from public, anon, authenticated;

-- A sealed snapshot is immutable. Operational status/default transitions may
-- still move sealed -> active -> retired through a future privileged workflow.
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
    if new.status not in ('draft', 'sealed') then
      raise exception 'A draft deal version must be sealed before activation.';
    end if;
    return new;
  end if;

  if new.id is distinct from old.id
    or new.deal_key is distinct from old.deal_key
    or new.version is distinct from old.version
    or new.label is distinct from old.label
    or new.terms_markdown is distinct from old.terms_markdown
    or new.terms_sha256 is distinct from old.terms_sha256
    or new.economics_json is distinct from old.economics_json
    or new.economics_sha256 is distinct from old.economics_sha256
    or new.snapshot_sha256 is distinct from old.snapshot_sha256
    or new.draft_revision is distinct from old.draft_revision
    or new.change_note is distinct from old.change_note
    or new.sealed_at is distinct from old.sealed_at
    or new.sealed_by is distinct from old.sealed_by
    or new.created_by is distinct from old.created_by
    or new.created_at is distinct from old.created_at
    or new.updated_at is distinct from old.updated_at
  then
    raise exception 'Sealed deal legal terms, economics, hashes, and revision are immutable.';
  end if;

  if old.status = 'sealed' then
    if new.status not in ('sealed', 'active') then
      raise exception 'A sealed deal version can only remain sealed or become active.';
    end if;
    if new.status = 'sealed' and (new.is_default or new.effective_at is not null) then
      raise exception 'A sealed deal cannot be a default or have an effective date.';
    end if;
    return new;
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

-- Preserve the old atomic rotation implementation for a future privileged
-- activation boundary, but require a sealed target and remove browser access.
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
    select 1 from public.staff_members
    where auth_user_id = administrator_id and active and role = 'admin'
  ) then
    raise exception 'Administrator access required.' using errcode = '42501';
  end if;

  lock table public.program_deal_versions in share row exclusive mode;

  select status, effective_at into target_status, target_effective_at
  from public.program_deal_versions
  where id = target_deal_version_id
  for update;

  if target_status is null then
    raise exception 'Deal version was not found.' using errcode = 'P0002';
  end if;
  if target_status not in ('sealed', 'active') then
    raise exception 'Only a sealed deal version can be activated.' using errcode = '22023';
  end if;
  if target_effective_at > now() then
    raise exception 'A future deal version cannot become the current default.' using errcode = '22023';
  end if;

  select id into previous_default_id
  from public.program_deal_versions
  where is_default and status = 'active'
  limit 1 for update;

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
  set status = 'active', is_default = true,
      effective_at = coalesce(effective_at, now())
  where id = target_deal_version_id;

  return target_deal_version_id;
end;
$$;

revoke execute on function public.rotate_default_program_deal_version(uuid, boolean)
from public, anon, authenticated;
revoke execute on function public.retire_program_deal_version(uuid)
from public, anon, authenticated;
revoke insert, update, delete on public.program_deal_versions
from public, anon, authenticated;

-- Preserve the existing assigned-creator RLS read while preventing internal
-- draft notes and staff identifiers added above from becoming directly
-- queryable merely because the original table-level SELECT grant predates
-- these columns.
revoke select on public.program_deal_versions from authenticated;
grant select (
  id, deal_key, version, label, terms_markdown, terms_sha256,
  economics_json, economics_sha256, snapshot_sha256, status, is_default,
  effective_at, created_at, sealed_at
) on public.program_deal_versions to authenticated;

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
  where binding.deal_version_id = target_deal_version_id
    and binding.status = 'verified'
    and binding.provider_environment = 'production'
    and binding.bound_snapshot_sha256 = deal_record.snapshot_sha256;
  if verified_binding_count <> 1 then
    blockers := array_append(blockers, 'Verify exactly one production signing template against this snapshot.');
  end if;

  select count(*) filter (where approval.approval_kind = 'business'),
         count(*) filter (where approval.approval_kind = 'legal')
  into business_approval_count, legal_approval_count
  from public.program_deal_approvals approval
  where approval.deal_version_id = target_deal_version_id
    and approval.status = 'approved'
    and approval.snapshot_sha256 = deal_record.snapshot_sha256;

  if business_approval_count <> 1 then
    blockers := array_append(blockers, 'Record business approval for this exact snapshot.');
  end if;
  if legal_approval_count <> 1 then
    blockers := array_append(blockers, 'Record legal approval for this exact snapshot.');
  end if;

  return blockers;
end;
$$;

create or replace function public.admin_program_deal_version_summary(target_deal_version_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  deal_record public.program_deal_versions%rowtype;
  blockers text[];
  assignment_count integer;
  binding_count integer;
  business_count integer;
  legal_count integer;
  template_hash text;
begin
  select * into deal_record from public.program_deal_versions
  where id = target_deal_version_id;
  if not found then return null; end if;

  blockers := public.admin_program_deal_readiness(target_deal_version_id);
  select count(*) into assignment_count from public.creator_enrollments
  where deal_version_id = target_deal_version_id;
  select count(*), min(provider_template_sha256)
  into binding_count, template_hash
  from public.program_deal_signing_bindings
  where deal_version_id = target_deal_version_id
    and status = 'verified'
    and provider_environment = 'production'
    and bound_snapshot_sha256 = deal_record.snapshot_sha256;
  select count(*) filter (where approval_kind = 'business'),
         count(*) filter (where approval_kind = 'legal')
  into business_count, legal_count
  from public.program_deal_approvals
  where deal_version_id = target_deal_version_id
    and status = 'approved'
    and snapshot_sha256 = deal_record.snapshot_sha256;

  return jsonb_build_object(
    'id', deal_record.id,
    'dealKey', deal_record.deal_key,
    'version', deal_record.version,
    'label', deal_record.label,
    'status', deal_record.status,
    'isDefault', deal_record.is_default,
    'draftRevision', deal_record.draft_revision,
    'termsHash', deal_record.terms_sha256,
    'economicsHash', deal_record.economics_sha256,
    'snapshotHash', deal_record.snapshot_sha256,
    'providerTemplateHash', template_hash,
    'assignmentCount', assignment_count,
    'providerBindingCount', binding_count,
    'approvalCount', business_count + legal_count,
    'businessApprovalCount', business_count,
    'legalApprovalCount', legal_count,
    'readinessBlockerCount', cardinality(blockers),
    'activationReady', cardinality(blockers) = 0,
    'readinessBlockers', to_jsonb(blockers),
    'createdAt', deal_record.created_at,
    'updatedAt', deal_record.updated_at,
    'effectiveAt', deal_record.effective_at,
    'sealedAt', deal_record.sealed_at
  );
end;
$$;

create or replace function public.get_admin_program_deal_catalog()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
declare
  actor_id uuid := auth.uid();
  versions jsonb;
  default_version jsonb;
begin
  if not exists (
    select 1 from public.staff_members
    where auth_user_id = actor_id and active and role in ('reviewer', 'admin')
  ) then
    raise exception 'Reviewer access required.' using errcode = '42501';
  end if;

  select coalesce(
    jsonb_agg(public.admin_program_deal_version_summary(deal.id)
      order by deal.deal_key, deal.version desc),
    '[]'::jsonb
  ) into versions
  from public.program_deal_versions deal;

  select public.admin_program_deal_version_summary(deal.id)
  into default_version
  from public.program_deal_versions deal
  where deal.status = 'active' and deal.is_default
  limit 1;

  return jsonb_build_object(
    'defaultVersion', default_version,
    'versions', versions
  );
end;
$$;

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
        'templateHash', binding.provider_template_sha256,
        'boundSnapshotHash', binding.bound_snapshot_sha256,
        'status', binding.status,
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

create or replace function public.create_admin_program_deal_draft(
  deal_key_input text,
  label_input text,
  terms_markdown_input text,
  economics_input jsonb,
  change_note_input text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  actor_id uuid := auth.uid();
  normalized_key text := lower(btrim(coalesce(deal_key_input, '')));
  normalized_label text := btrim(coalesce(label_input, ''));
  normalized_terms text := btrim(coalesce(terms_markdown_input, ''));
  normalized_note text := nullif(btrim(coalesce(change_note_input, '')), '');
  next_version integer;
  created_id uuid;
begin
  if not exists (
    select 1 from public.staff_members
    where auth_user_id = actor_id and active and role = 'admin'
  ) then
    raise exception 'Administrator access required.' using errcode = '42501';
  end if;

  if normalized_key !~ '^[a-z0-9][a-z0-9_-]{1,79}$' then
    raise exception 'Deal key is invalid.' using errcode = '22023';
  end if;
  if char_length(normalized_label) not between 2 and 120
    or char_length(normalized_terms) not between 1 and 100000
    or (normalized_note is not null and char_length(normalized_note) > 2000)
    or not public.admin_deal_economics_valid(economics_input, false)
  then
    raise exception 'Draft content is invalid.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('program_deal:' || normalized_key, 0));
  select coalesce(max(version), 0) + 1 into next_version
  from public.program_deal_versions where deal_key = normalized_key;

  insert into public.program_deal_versions (
    deal_key, version, label, terms_markdown, economics_json, status,
    is_default, created_by, change_note, updated_at
  ) values (
    normalized_key, next_version, normalized_label, normalized_terms,
    economics_input, 'draft', false, actor_id, normalized_note, now()
  ) returning id into created_id;

  insert into public.program_deal_events (
    deal_version_id, event_type, actor_user_id, draft_revision,
    from_status, to_status, metadata
  ) values (
    created_id, 'draft_created', actor_id, 1, null, 'draft',
    jsonb_build_object('changeNote', normalized_note)
  );

  return public.get_admin_program_deal_detail(created_id);
end;
$$;

create or replace function public.update_admin_program_deal_draft(
  target_deal_version_id uuid,
  expected_draft_revision integer,
  draft_patch jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  actor_id uuid := auth.uid();
  deal_record public.program_deal_versions%rowtype;
  next_label text;
  next_terms text;
  next_economics jsonb;
  next_note text;
  changed_fields text[] := array[]::text[];
begin
  if not exists (
    select 1 from public.staff_members
    where auth_user_id = actor_id and active and role = 'admin'
  ) then
    raise exception 'Administrator access required.' using errcode = '42501';
  end if;
  if expected_draft_revision is null or expected_draft_revision <= 0
    or draft_patch is null or jsonb_typeof(draft_patch) <> 'object'
    or exists (
      select 1 from jsonb_object_keys(draft_patch) key_name
      where key_name not in ('label', 'termsMarkdown', 'economics', 'changeNote')
    )
    or not (draft_patch ? 'label' or draft_patch ? 'termsMarkdown' or draft_patch ? 'economics')
  then
    raise exception 'Draft patch is invalid.' using errcode = '22023';
  end if;

  select * into deal_record from public.program_deal_versions
  where id = target_deal_version_id for update;
  if not found then
    raise exception 'Deal version was not found.' using errcode = 'P0002';
  end if;
  if deal_record.status <> 'draft' then
    raise exception 'Only a draft deal version can be edited.' using errcode = '55000';
  end if;
  if deal_record.draft_revision <> expected_draft_revision then
    raise exception 'Draft revision is stale.' using errcode = '40001';
  end if;

  next_label := case when draft_patch ? 'label'
    then btrim(coalesce(draft_patch ->> 'label', '')) else deal_record.label end;
  next_terms := case when draft_patch ? 'termsMarkdown'
    then btrim(coalesce(draft_patch ->> 'termsMarkdown', '')) else deal_record.terms_markdown end;
  next_economics := case when draft_patch ? 'economics'
    then draft_patch -> 'economics' else deal_record.economics_json end;
  next_note := case when draft_patch ? 'changeNote'
    then nullif(btrim(coalesce(draft_patch ->> 'changeNote', '')), '')
    else deal_record.change_note end;

  if char_length(next_label) not between 2 and 120
    or char_length(next_terms) not between 1 and 100000
    or (next_note is not null and char_length(next_note) > 2000)
    or not public.admin_deal_economics_valid(next_economics, false)
  then
    raise exception 'Draft content is invalid.' using errcode = '22023';
  end if;

  if next_label is distinct from deal_record.label then changed_fields := array_append(changed_fields, 'label'); end if;
  if next_terms is distinct from deal_record.terms_markdown then changed_fields := array_append(changed_fields, 'termsMarkdown'); end if;
  if next_economics is distinct from deal_record.economics_json then changed_fields := array_append(changed_fields, 'economics'); end if;
  if cardinality(changed_fields) = 0 then
    raise exception 'Draft patch did not change content.' using errcode = '22023';
  end if;

  update public.program_deal_versions
  set label = next_label,
      terms_markdown = next_terms,
      economics_json = next_economics,
      draft_revision = draft_revision + 1,
      change_note = next_note,
      updated_at = now()
  where id = target_deal_version_id;

  insert into public.program_deal_events (
    deal_version_id, event_type, actor_user_id, draft_revision,
    from_status, to_status, metadata
  ) values (
    target_deal_version_id, 'draft_updated', actor_id,
    expected_draft_revision + 1, 'draft', 'draft',
    jsonb_build_object('changedFields', to_jsonb(changed_fields), 'changeNote', next_note)
  );

  return public.get_admin_program_deal_detail(target_deal_version_id);
end;
$$;

create or replace function public.seal_admin_program_deal_draft(
  target_deal_version_id uuid,
  expected_draft_revision integer,
  change_note_input text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  actor_id uuid := auth.uid();
  deal_record public.program_deal_versions%rowtype;
  normalized_note text := nullif(btrim(coalesce(change_note_input, '')), '');
begin
  if not exists (
    select 1 from public.staff_members
    where auth_user_id = actor_id and active and role = 'admin'
  ) then
    raise exception 'Administrator access required.' using errcode = '42501';
  end if;
  if expected_draft_revision is null or expected_draft_revision <= 0
    or (normalized_note is not null and char_length(normalized_note) > 2000)
  then
    raise exception 'Seal request is invalid.' using errcode = '22023';
  end if;

  select * into deal_record from public.program_deal_versions
  where id = target_deal_version_id for update;
  if not found then
    raise exception 'Deal version was not found.' using errcode = 'P0002';
  end if;
  if deal_record.status <> 'draft' then
    raise exception 'Only a draft deal version can be sealed.' using errcode = '55000';
  end if;
  if deal_record.draft_revision <> expected_draft_revision then
    raise exception 'Draft revision is stale.' using errcode = '40001';
  end if;
  if char_length(btrim(deal_record.terms_markdown)) < 200
    or not public.admin_deal_placeholder_free(deal_record.label)
    or not public.admin_deal_placeholder_free(deal_record.terms_markdown)
  then
    raise exception 'Resolve all placeholders and complete the legal terms before sealing.' using errcode = '22023';
  end if;
  if not public.admin_deal_economics_valid(deal_record.economics_json, true) then
    raise exception 'Complete every required economic rule before sealing.' using errcode = '22023';
  end if;

  update public.program_deal_versions
  set status = 'sealed',
      draft_revision = draft_revision + 1,
      change_note = coalesce(normalized_note, change_note),
      sealed_at = now(),
      sealed_by = actor_id,
      updated_at = now()
  where id = target_deal_version_id;

  insert into public.program_deal_events (
    deal_version_id, event_type, actor_user_id, draft_revision,
    from_status, to_status, metadata
  ) values (
    target_deal_version_id, 'draft_sealed', actor_id,
    expected_draft_revision + 1, 'draft', 'sealed',
    jsonb_build_object(
      'snapshotHash', deal_record.snapshot_sha256,
      'changeNote', coalesce(normalized_note, deal_record.change_note)
    )
  );

  return public.get_admin_program_deal_detail(target_deal_version_id);
end;
$$;

revoke execute on function public.admin_deal_jsonb_integer(jsonb, boolean, numeric)
from public, anon, authenticated;
revoke execute on function public.admin_deal_placeholder_free(text)
from public, anon, authenticated;
revoke execute on function public.admin_deal_economics_valid(jsonb, boolean)
from public, anon, authenticated;
revoke execute on function public.admin_program_deal_readiness(uuid)
from public, anon, authenticated;
revoke execute on function public.admin_program_deal_version_summary(uuid)
from public, anon, authenticated;
revoke execute on function public.prevent_program_deal_event_mutation()
from public, anon, authenticated;

revoke execute on function public.get_admin_program_deal_catalog()
from public, anon;
grant execute on function public.get_admin_program_deal_catalog()
to authenticated;
revoke execute on function public.get_admin_program_deal_detail(uuid)
from public, anon;
grant execute on function public.get_admin_program_deal_detail(uuid)
to authenticated;

revoke execute on function public.create_admin_program_deal_draft(text, text, text, jsonb, text)
from public, anon;
grant execute on function public.create_admin_program_deal_draft(text, text, text, jsonb, text)
to authenticated;
revoke execute on function public.update_admin_program_deal_draft(uuid, integer, jsonb)
from public, anon;
grant execute on function public.update_admin_program_deal_draft(uuid, integer, jsonb)
to authenticated;
revoke execute on function public.seal_admin_program_deal_draft(uuid, integer, text)
from public, anon;
grant execute on function public.seal_admin_program_deal_draft(uuid, integer, text)
to authenticated;

comment on table public.program_deal_versions is
  'Versioned creator deals. Drafts are editable through admin RPCs; sealed/active/retired snapshots are immutable. No deal is seeded by migrations.';
comment on table public.program_deal_events is
  'Append-only audit ledger for deal draft creation, revisions, and sealing.';
comment on table public.program_deal_signing_bindings is
  'Environment-scoped signing-provider bindings with independently supplied template-content and bound-snapshot hashes. Browser clients have no direct access.';
comment on table public.program_deal_approvals is
  'Business/legal approval state bound to an exact immutable deal snapshot hash. Browser clients have no direct access.';
comment on function public.get_admin_program_deal_catalog() is
  'Reviewer/admin catalog with fail-closed signing, approval, assignment, and activation-readiness counts.';
comment on function public.create_admin_program_deal_draft(text, text, text, jsonb, text) is
  'Admin-only draft creation with locked automatic per-key version allocation and server-owned identity/status/hash fields.';
comment on function public.seal_admin_program_deal_draft(uuid, integer, text) is
  'Admin-only immutable sealing; rejects stale revisions, placeholders, and incomplete economic rules. It never activates a deal.';

-- Deliberately no INSERT into program_deal_versions and no execution of the
-- default-rotation function. The public sample JSON/DOCX is not a data source.
