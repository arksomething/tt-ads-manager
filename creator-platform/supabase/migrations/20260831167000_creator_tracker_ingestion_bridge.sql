-- Additive bridge from the laptop-owned creator tracker into the creator-first
-- platform. The wire payload remains the sealed creator-tracker v2 contract.
-- Provider facts are retained even before a creator has signed up. Only a
-- verified stable native account identity may be promoted into account-owned
-- canonical posts and observations.

create extension if not exists pgcrypto;

create table public.creator_tracker_ingest_batches (
  id uuid primary key,
  organization_id text not null check (char_length(organization_id) between 1 and 256),
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 512),
  source text not null check (char_length(source) between 1 and 128),
  collector_instance_id text not null check (char_length(collector_instance_id) between 1 and 256),
  schema_version smallint not null check (schema_version = 2),
  request_key_id text not null check (
    char_length(request_key_id) between 1 and 64
    and request_key_id ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'
  ),
  payload_sha256 text not null check (payload_sha256 ~ '^[a-f0-9]{64}$'),
  produced_at timestamptz not null,
  status text not null default 'receiving' check (status in ('receiving', 'committed')),
  item_count integer not null check (item_count between 1 and 2000),
  observation_count integer not null check (observation_count between 0 and 2000),
  failure_count integer not null check (failure_count between 0 and 2000),
  retained_count integer not null default 0 check (retained_count >= 0),
  matched_count integer not null default 0 check (matched_count >= 0),
  unmatched_count integer not null default 0 check (unmatched_count >= 0),
  error_count integer not null default 0 check (error_count >= 0),
  metadata jsonb not null default '{}'::jsonb check (
    jsonb_typeof(metadata) = 'object' and pg_column_size(metadata) <= 131072
  ),
  received_at timestamptz not null default now(),
  committed_at timestamptz,
  unique (organization_id, idempotency_key),
  check (observation_count <= item_count and failure_count <= item_count),
  check (
    (status = 'committed' and committed_at is not null
      and retained_count + matched_count + unmatched_count + error_count = item_count)
    or (status = 'receiving' and committed_at is null)
  )
);

create index creator_tracker_ingest_batches_recent
  on public.creator_tracker_ingest_batches (received_at desc);

create table public.creator_tracker_staged_entities (
  organization_id text not null,
  entity_type text not null check (
    entity_type in (
      'creator', 'account', 'run', 'raw_manifest', 'raw_manifest_entry',
      'video', 'handle_event', 'observation', 'failure', 'coverage_window'
    )
  ),
  tracker_entity_id uuid not null,
  latest_batch_id uuid not null references public.creator_tracker_ingest_batches(id) on delete restrict,
  payload_sha256 text not null check (payload_sha256 ~ '^[a-f0-9]{64}$'),
  payload jsonb not null check (
    jsonb_typeof(payload) = 'object' and pg_column_size(payload) <= 262144
  ),
  platform text check (platform is null or platform in ('tiktok', 'instagram', 'youtube')),
  native_account_id text check (
    native_account_id is null or char_length(native_account_id) between 1 and 256
  ),
  tracker_account_id uuid,
  tracker_video_id uuid,
  canonical_platform_account_id uuid references public.creator_platform_accounts(id) on delete set null,
  canonical_post_id uuid references public.creator_posts(id) on delete set null,
  canonical_provider_identity_id uuid references public.creator_post_provider_identities(id) on delete set null,
  canonical_observation_id uuid references public.creator_post_observations(id) on delete set null,
  resolution_state text not null check (
    resolution_state in ('retained', 'matched', 'unmatched', 'error')
  ),
  resolution_code text not null check (
    char_length(resolution_code) between 2 and 80
    and resolution_code ~ '^[a-z][a-z0-9._-]*$'
  ),
  resolution_detail text check (
    resolution_detail is null or char_length(resolution_detail) <= 500
  ),
  first_received_at timestamptz not null default now(),
  last_received_at timestamptz not null default now(),
  primary key (organization_id, entity_type, tracker_entity_id)
);

create index creator_tracker_staged_entities_native_account
  on public.creator_tracker_staged_entities (platform, native_account_id)
  where entity_type = 'account' and native_account_id is not null;

create index creator_tracker_staged_entities_unmatched
  on public.creator_tracker_staged_entities (resolution_state, entity_type, last_received_at)
  where resolution_state in ('unmatched', 'error');

create index creator_tracker_staged_entities_account_videos
  on public.creator_tracker_staged_entities (organization_id, tracker_account_id, entity_type)
  where tracker_account_id is not null;

create table public.creator_tracker_ingest_items (
  id bigint generated always as identity primary key,
  batch_id uuid not null references public.creator_tracker_ingest_batches(id) on delete restrict,
  entity_type text not null check (
    entity_type in (
      'creator', 'account', 'run', 'raw_manifest', 'raw_manifest_entry',
      'video', 'handle_event', 'observation', 'failure', 'coverage_window'
    )
  ),
  item_index integer not null check (item_index between 0 and 1999),
  tracker_entity_id uuid not null,
  payload_sha256 text not null check (payload_sha256 ~ '^[a-f0-9]{64}$'),
  payload jsonb not null check (
    jsonb_typeof(payload) = 'object' and pg_column_size(payload) <= 262144
  ),
  outcome text not null check (outcome in ('retained', 'matched', 'unmatched', 'error')),
  resolution_code text not null check (
    char_length(resolution_code) between 2 and 80
    and resolution_code ~ '^[a-z][a-z0-9._-]*$'
  ),
  resolution_detail text check (
    resolution_detail is null or char_length(resolution_detail) <= 500
  ),
  canonical_platform_account_id uuid references public.creator_platform_accounts(id) on delete set null,
  canonical_post_id uuid references public.creator_posts(id) on delete set null,
  canonical_provider_identity_id uuid references public.creator_post_provider_identities(id) on delete set null,
  canonical_observation_id uuid references public.creator_post_observations(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (batch_id, entity_type, item_index)
);

create index creator_tracker_ingest_items_outcome
  on public.creator_tracker_ingest_items (outcome, entity_type, created_at);

create or replace function public.creator_tracker_prevent_audit_mutation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'Creator tracker ingestion evidence is append-only.' using errcode = '55000';
end;
$$;

create trigger creator_tracker_ingest_items_append_only
before update or delete on public.creator_tracker_ingest_items
for each row execute function public.creator_tracker_prevent_audit_mutation();

create trigger creator_tracker_observations_immutable
before update or delete on public.creator_post_observations
for each row execute function public.creator_tracker_prevent_audit_mutation();

create or replace function public.ingest_creator_tracker_batch(
  batch_input jsonb,
  request_key_id text,
  request_payload_sha256 text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, extensions, public, auth, pg_temp
as $$
#variable_conflict use_variable
declare
  batch_record public.creator_tracker_ingest_batches%rowtype;
  batch_json jsonb;
  batch_id uuid;
  organization_id text;
  idempotency_key text;
  source_key text;
  collector_id text;
  produced_timestamp timestamptz;
  expected_item_count integer;
  expected_observation_count integer;
  expected_failure_count integer;
  retained_total integer := 0;
  matched_total integer := 0;
  unmatched_total integer := 0;
  error_total integer := 0;
  collection_key text;
  entity_kind text;
  item_record record;
  item_payload jsonb;
  item_id uuid;
  item_hash text;
  item_outcome text;
  item_code text;
  item_detail text;
  item_platform text;
  canonical_platform text;
  item_native_account_id text;
  tracker_account uuid;
  tracker_video uuid;
  platform_account_id uuid;
  canonical_account_id uuid;
  canonical_post_id uuid;
  provider_identity_id uuid;
  canonical_observation_id uuid;
  incoming_canonical_url text;
  staged_account public.creator_tracker_staged_entities%rowtype;
  staged_video public.creator_tracker_staged_entities%rowtype;
  existing_stage public.creator_tracker_staged_entities%rowtype;
  existing_post public.creator_posts%rowtype;
  url_identity_post public.creator_posts%rowtype;
  existing_identity public.creator_post_provider_identities%rowtype;
  existing_observation public.creator_post_observations%rowtype;
  observed_timestamp timestamptz;
  published_timestamp timestamptz;
  view_metric bigint;
  like_metric bigint;
  comment_metric bigint;
  share_metric bigint;
  raw_archive_reference text;
  raw_payload_hash text;
  committed_timestamp timestamptz;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Service-role access required.' using errcode = '42501';
  end if;

  if jsonb_typeof(batch_input) <> 'object'
    or (batch_input->>'schemaVersion')::integer <> 2
    or jsonb_typeof(batch_input->'batch') <> 'object' then
    raise exception 'DATABASE_CONTRACT_REJECTED' using errcode = '22023';
  end if;

  batch_json := batch_input->'batch';
  batch_id := (batch_json->>'id')::uuid;
  organization_id := batch_json->>'organizationId';
  idempotency_key := batch_json->>'idempotencyKey';
  source_key := batch_json->>'source';
  collector_id := batch_json->>'collectorInstanceId';
  produced_timestamp := (batch_json->>'producedAt')::timestamptz;

  if request_key_id !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
    or request_payload_sha256 !~ '^[a-f0-9]{64}$'
    or char_length(organization_id) not between 1 and 256
    or char_length(idempotency_key) not between 1 and 512 then
    raise exception 'DATABASE_CONTRACT_REJECTED' using errcode = '22023';
  end if;

  expected_item_count :=
    jsonb_array_length(batch_input->'creators') +
    jsonb_array_length(batch_input->'accounts') +
    jsonb_array_length(batch_input->'runs') +
    jsonb_array_length(batch_input->'rawManifests') +
    jsonb_array_length(batch_input->'rawManifestEntries') +
    jsonb_array_length(batch_input->'videos') +
    jsonb_array_length(batch_input->'handleEvents') +
    jsonb_array_length(batch_input->'observations') +
    jsonb_array_length(batch_input->'failures') +
    jsonb_array_length(batch_input->'coverageWindows');
  expected_observation_count := jsonb_array_length(batch_input->'observations');
  expected_failure_count := jsonb_array_length(batch_input->'failures');

  if expected_item_count not between 1 and 2000 then
    raise exception 'DATABASE_CONTRACT_REJECTED' using errcode = '22023';
  end if;

  -- Serialize an organization's durable outbox. Simultaneous exact retries
  -- wait for the first transaction and then receive its committed identity.
  perform pg_advisory_xact_lock(
    hashtextextended('creator-platform-ingest:' || organization_id, 0)
  );

  select * into batch_record
  from public.creator_tracker_ingest_batches existing_batch
  where existing_batch.organization_id = batch_json->>'organizationId'
    and existing_batch.idempotency_key = batch_json->>'idempotencyKey'
  for update;

  if batch_record.id is not null then
    if batch_record.id <> batch_id
      or batch_record.payload_sha256 <> request_payload_sha256
      or batch_record.source <> source_key
      or batch_record.collector_instance_id <> collector_id
      or batch_record.schema_version <> 2
      or batch_record.item_count <> expected_item_count
      or batch_record.observation_count <> expected_observation_count
      or batch_record.failure_count <> expected_failure_count
      or batch_record.status <> 'committed' then
      raise exception 'IDEMPOTENCY_KEY_REUSED' using errcode = '23505';
    end if;

    return jsonb_build_object(
      'batchId', batch_record.id,
      'organizationId', batch_record.organization_id,
      'idempotencyKey', batch_record.idempotency_key,
      'payloadSha256', batch_record.payload_sha256,
      'committedAt', batch_record.committed_at,
      'itemCount', batch_record.item_count,
      'observationCount', batch_record.observation_count,
      'failureCount', batch_record.failure_count,
      'replayed', true
    );
  end if;

  insert into public.creator_tracker_ingest_batches (
    id, organization_id, idempotency_key, source, collector_instance_id,
    schema_version, request_key_id, payload_sha256, produced_at, item_count,
    observation_count, failure_count, metadata
  ) values (
    batch_id, organization_id, idempotency_key, source_key, collector_id,
    2, request_key_id, request_payload_sha256, produced_timestamp,
    expected_item_count, expected_observation_count, expected_failure_count,
    coalesce(batch_json->'metadata', '{}'::jsonb)
  );

  foreach collection_key in array array[
    'creators', 'accounts', 'runs', 'rawManifests', 'rawManifestEntries',
    'videos', 'handleEvents', 'observations', 'failures', 'coverageWindows'
  ] loop
    entity_kind := case collection_key
      when 'creators' then 'creator'
      when 'accounts' then 'account'
      when 'runs' then 'run'
      when 'rawManifests' then 'raw_manifest'
      when 'rawManifestEntries' then 'raw_manifest_entry'
      when 'videos' then 'video'
      when 'handleEvents' then 'handle_event'
      when 'observations' then 'observation'
      when 'failures' then 'failure'
      else 'coverage_window'
    end;

    for item_record in
      select value as payload, (ordinality - 1)::integer as item_index
      from jsonb_array_elements(batch_input->collection_key) with ordinality
    loop
      item_payload := item_record.payload;
      item_id := (item_payload->>'id')::uuid;
      item_hash := encode(digest(convert_to(item_payload::text, 'UTF8'), 'sha256'), 'hex');
      item_outcome := 'retained';
      item_code := 'evidence_retained';
      item_detail := null;
      item_platform := null;
      canonical_platform := null;
      item_native_account_id := null;
      tracker_account := null;
      tracker_video := null;
      platform_account_id := null;
      canonical_account_id := null;
      canonical_post_id := null;
      provider_identity_id := null;
      canonical_observation_id := null;
      incoming_canonical_url := null;

      select * into existing_stage
      from public.creator_tracker_staged_entities staged
      where staged.organization_id = organization_id
        and staged.entity_type = entity_kind
        and staged.tracker_entity_id = item_id
      for update;

      begin
        if entity_kind = 'account'
          and existing_stage.tracker_entity_id is not null
          and (
            existing_stage.payload->>'creatorId' is distinct from item_payload->>'creatorId'
            or existing_stage.platform is distinct from item_payload->>'platform'
            or (
              existing_stage.native_account_id is not null
              and existing_stage.native_account_id is distinct from
                nullif(item_payload->>'nativeAccountId', '')
            )
          ) then
          raise exception 'staged_account_identity_conflict';
        end if;
        if entity_kind = 'video'
          and existing_stage.tracker_entity_id is not null
          and (
            existing_stage.payload->>'creatorId' is distinct from item_payload->>'creatorId'
            or existing_stage.payload->>'accountId' is distinct from item_payload->>'accountId'
            or existing_stage.platform is distinct from item_payload->>'platform'
            or existing_stage.payload->>'nativeVideoId' is distinct from item_payload->>'nativeVideoId'
            or existing_stage.payload->>'firstSeenAt' is distinct from item_payload->>'firstSeenAt'
          ) then
          raise exception 'staged_video_identity_conflict';
        end if;
        if entity_kind = 'observation'
          and existing_stage.tracker_entity_id is not null
          and existing_stage.payload_sha256 <> item_hash then
          raise exception 'staged_observation_conflict';
        end if;

        if entity_kind = 'account' then
          item_platform := item_payload->>'platform';
          item_native_account_id := nullif(item_payload->>'nativeAccountId', '');
          canonical_platform := case item_platform
            when 'tiktok' then 'TIKTOK'
            when 'instagram' then 'INSTAGRAM_REELS'
            else null
          end;

          if canonical_platform is null then
            item_outcome := 'unmatched';
            item_code := 'platform_not_supported';
            item_detail := 'The provider account is retained in staging; this creator platform is not supported yet.';
          elsif item_native_account_id is null then
            item_outcome := 'unmatched';
            item_code := 'stable_account_id_missing';
            item_detail := 'The provider account is retained in staging without a stable native account ID.';
          else
            select verified_account.id, verified_account.account_id
            into platform_account_id, canonical_account_id
            from public.creator_platform_accounts verified_account
            where verified_account.platform = canonical_platform
              and verified_account.native_account_id = item_native_account_id
              and verified_account.status = 'verified';

            if platform_account_id is null then
              item_outcome := 'unmatched';
              item_code := 'verified_account_not_found';
              item_detail := 'The provider account is retained in staging until stable ownership is verified.';
            else
              if existing_stage.canonical_platform_account_id is not null
                and existing_stage.canonical_platform_account_id <> platform_account_id then
                raise exception 'staged_canonical_link_conflict';
              end if;
              item_outcome := 'matched';
              item_code := 'verified_account_matched';
            end if;
          end if;
        elsif entity_kind = 'video' then
          item_platform := item_payload->>'platform';
          tracker_account := (item_payload->>'accountId')::uuid;
          incoming_canonical_url := nullif(item_payload->>'canonicalUrl', '');

          select * into staged_account
          from public.creator_tracker_staged_entities staged
          where staged.organization_id = organization_id
            and staged.entity_type = 'account'
            and staged.tracker_entity_id = tracker_account;

          item_native_account_id := staged_account.native_account_id;
          platform_account_id := staged_account.canonical_platform_account_id;
          canonical_platform := case item_platform
            when 'tiktok' then 'TIKTOK'
            when 'instagram' then 'INSTAGRAM_REELS'
            else null
          end;
          select verified_account.account_id
          into canonical_account_id
          from public.creator_platform_accounts verified_account
          where verified_account.id = platform_account_id
            and verified_account.status = 'verified'
            and verified_account.platform = canonical_platform
            and verified_account.native_account_id = staged_account.native_account_id;

          if staged_account.tracker_entity_id is null then
            item_outcome := 'unmatched';
            item_code := 'tracker_account_not_staged';
            item_detail := 'The provider post is retained until its account identity is delivered.';
          elsif staged_account.platform is distinct from item_platform then
            raise exception 'staged_account_platform_mismatch';
          elsif canonical_platform is null then
            item_outcome := 'unmatched';
            item_code := 'platform_not_supported';
            item_detail := 'The provider post is retained in staging for an unsupported creator platform.';
          elsif staged_account.resolution_state <> 'matched'
            or platform_account_id is null or canonical_account_id is null then
            item_outcome := 'unmatched';
            item_code := case
              when staged_account.resolution_state <> 'matched'
                then coalesce(staged_account.resolution_code, 'verified_account_not_found')
              else 'verified_account_not_found'
            end;
            item_detail := 'The provider post is retained until its stable account identity is verified.';
          else
            if existing_stage.canonical_platform_account_id is not null
              and existing_stage.canonical_platform_account_id <> platform_account_id then
              raise exception 'staged_canonical_link_conflict';
            end if;

            -- Serialize the two-key identity decision across every tracker
            -- organization and the staff matching RPC. A URL and native ID
            -- must either resolve to the same canonical row or fail closed.
            perform pg_advisory_xact_lock(
              hashtextextended('creator-post-identity:' || canonical_platform, 0)
            );

            select * into existing_post
            from public.creator_posts post
            where post.platform = canonical_platform
              and post.native_post_id = item_payload->>'nativeVideoId'
            for update;

            select * into url_identity_post
            from public.creator_posts post
            where post.platform = canonical_platform
              and post.canonical_url = incoming_canonical_url
            for update;

            if existing_post.id is not null
              and url_identity_post.id is not null
              and existing_post.id <> url_identity_post.id then
              raise exception 'post_identity_conflict';
            end if;

            if existing_post.id is null and url_identity_post.id is not null then
              existing_post := url_identity_post;
            end if;

            if existing_post.id is null then
              insert into public.creator_posts (
                account_id, platform_account_id, platform, native_post_id,
                canonical_url, published_at, first_seen_at,
                attribution_state, attribution_method
              ) values (
                canonical_account_id, platform_account_id, canonical_platform,
                item_payload->>'nativeVideoId', incoming_canonical_url,
                nullif(item_payload->>'publishedAt', '')::timestamptz,
                (item_payload->>'firstSeenAt')::timestamptz,
                'verified', 'provider_discovery'
              )
              on conflict do nothing
              returning * into existing_post;

              if existing_post.id is null then
                select * into existing_post
                from public.creator_posts post
                where post.platform = canonical_platform
                  and post.native_post_id = item_payload->>'nativeVideoId'
                for update;

                select * into url_identity_post
                from public.creator_posts post
                where post.platform = canonical_platform
                  and post.canonical_url = incoming_canonical_url
                for update;

                if existing_post.id is not null
                  and url_identity_post.id is not null
                  and existing_post.id <> url_identity_post.id then
                  raise exception 'post_identity_conflict';
                end if;
                if existing_post.id is null then
                  existing_post := url_identity_post;
                end if;
              end if;
            end if;

            if existing_post.id is null
              or existing_post.account_id <> canonical_account_id
              or (existing_post.platform_account_id is not null
                and existing_post.platform_account_id <> platform_account_id)
              or (existing_post.native_post_id is not null
                and existing_post.native_post_id <> item_payload->>'nativeVideoId')
              or (existing_post.canonical_url is not null
                and incoming_canonical_url is not null
                and existing_post.canonical_url <> incoming_canonical_url) then
              raise exception 'post_identity_conflict';
            end if;
            if existing_stage.canonical_post_id is not null
              and existing_stage.canonical_post_id <> existing_post.id then
              raise exception 'staged_canonical_link_conflict';
            end if;

            canonical_post_id := existing_post.id;
            update public.creator_posts
            set platform_account_id = coalesce(creator_posts.platform_account_id, platform_account_id),
                native_post_id = coalesce(creator_posts.native_post_id, item_payload->>'nativeVideoId'),
                canonical_url = coalesce(creator_posts.canonical_url, incoming_canonical_url),
                published_at = coalesce(creator_posts.published_at, nullif(item_payload->>'publishedAt', '')::timestamptz),
                attribution_state = case
                  when creator_posts.attribution_state in ('unattributed', 'creator_claimed') then 'verified'
                  else creator_posts.attribution_state
                end
            where id = canonical_post_id;

              select * into existing_identity
              from public.creator_post_provider_identities identity
              where identity.provider = 'creator_tracker_v2'
                and identity.external_post_id = item_id::text
              for update;

              if existing_identity.id is null then
                insert into public.creator_post_provider_identities (
                  post_id, provider, external_post_id, external_account_id,
                  identity_kind, first_seen_at, last_seen_at
                ) values (
                  canonical_post_id, 'creator_tracker_v2', item_id::text,
                  item_native_account_id, 'tracker',
                  (item_payload->>'firstSeenAt')::timestamptz,
                  (item_payload->>'lastSeenAt')::timestamptz
                )
                on conflict do nothing
                returning * into existing_identity;

                if existing_identity.id is null then
                  select * into existing_identity
                  from public.creator_post_provider_identities identity
                  where identity.provider = 'creator_tracker_v2'
                    and identity.external_post_id = item_id::text
                  for update;
                end if;
              end if;

              if existing_identity.id is null
                or existing_identity.post_id <> canonical_post_id
                or (existing_identity.external_account_id is not null
                  and existing_identity.external_account_id <> item_native_account_id) then
                raise exception 'provider_identity_conflict';
              end if;
              if existing_stage.canonical_provider_identity_id is not null
                and existing_stage.canonical_provider_identity_id <> existing_identity.id then
                raise exception 'staged_canonical_link_conflict';
              end if;

              provider_identity_id := existing_identity.id;
              update public.creator_post_provider_identities
              set external_account_id = coalesce(external_account_id, item_native_account_id),
                  last_seen_at = greatest(last_seen_at, (item_payload->>'lastSeenAt')::timestamptz)
              where id = provider_identity_id;

            item_outcome := 'matched';
            item_code := 'canonical_post_matched';
          end if;
        elsif entity_kind = 'observation' then
          tracker_video := (item_payload->>'videoId')::uuid;
          select * into staged_video
          from public.creator_tracker_staged_entities staged
          where staged.organization_id = organization_id
            and staged.entity_type = 'video'
            and staged.tracker_entity_id = tracker_video;

          item_platform := staged_video.platform;
          item_native_account_id := staged_video.native_account_id;
          tracker_account := staged_video.tracker_account_id;
          platform_account_id := staged_video.canonical_platform_account_id;
          canonical_post_id := staged_video.canonical_post_id;
          provider_identity_id := staged_video.canonical_provider_identity_id;

          if staged_video.tracker_entity_id is null then
            item_outcome := 'unmatched';
            item_code := 'tracker_video_not_staged';
            item_detail := 'The observation is retained until its provider post identity is delivered.';
          elsif staged_video.resolution_state <> 'matched'
            or canonical_post_id is null or provider_identity_id is null then
            item_outcome := 'unmatched';
            item_code := coalesce(staged_video.resolution_code, 'verified_account_not_found');
            item_detail := 'The observation is retained until its provider account is ownership-verified.';
          else
            select * into staged_account
            from public.creator_tracker_staged_entities staged
            where staged.organization_id = organization_id
              and staged.entity_type = 'account'
              and staged.tracker_entity_id = staged_video.tracker_account_id;

            canonical_platform := case staged_video.platform
              when 'tiktok' then 'TIKTOK'
              when 'instagram' then 'INSTAGRAM_REELS'
              else null
            end;
            select verified_account.account_id
            into canonical_account_id
            from public.creator_platform_accounts verified_account
            where verified_account.id = platform_account_id
              and verified_account.status = 'verified'
              and verified_account.platform = canonical_platform
              and verified_account.native_account_id = staged_video.native_account_id;
            select * into existing_post
            from public.creator_posts post
            where post.id = canonical_post_id;
            select * into existing_identity
            from public.creator_post_provider_identities identity
            where identity.id = provider_identity_id;

            if staged_account.tracker_entity_id is null
              or staged_account.resolution_state <> 'matched'
              or staged_account.platform is distinct from staged_video.platform
              or staged_account.native_account_id is distinct from staged_video.native_account_id
              or staged_account.canonical_platform_account_id is distinct from platform_account_id
              or canonical_account_id is null
              or existing_post.id is null
              or existing_post.account_id <> canonical_account_id
              or existing_post.platform_account_id is distinct from platform_account_id
              or existing_post.platform <> canonical_platform
              or existing_identity.id is null
              or existing_identity.post_id <> canonical_post_id
              or existing_identity.external_account_id is distinct from staged_video.native_account_id then
              raise exception 'staged_attribution_inconsistent';
            end if;

            observed_timestamp := (item_payload->>'observedAt')::timestamptz;
            view_metric := nullif(item_payload->>'views', '')::bigint;
            like_metric := nullif(item_payload->>'likes', '')::bigint;
            comment_metric := nullif(item_payload->>'comments', '')::bigint;
            share_metric := nullif(item_payload->>'shares', '')::bigint;

            select manifest.payload->>'storageKey', manifest.payload->>'sha256'
            into raw_archive_reference, raw_payload_hash
            from public.creator_tracker_staged_entities manifest
            where manifest.organization_id = organization_id
              and manifest.entity_type = 'raw_manifest'
              and manifest.tracker_entity_id = (item_payload->>'rawManifestId')::uuid;

            insert into public.creator_post_observations (
              post_id, provider_identity_id, source_system,
              external_observation_id, external_run_id, observed_at,
              view_count, like_count, comment_count, share_count,
              raw_archive_ref, payload_sha256
            ) values (
              canonical_post_id, provider_identity_id, 'creator_tracker_v2',
              item_id::text, item_payload->>'runId', observed_timestamp,
              view_metric, like_metric, comment_metric, share_metric,
              raw_archive_reference, raw_payload_hash
            )
            on conflict (source_system, external_observation_id) do nothing
            returning id into canonical_observation_id;

            if canonical_observation_id is null then
              select * into existing_observation
              from public.creator_post_observations observation
              where observation.source_system = 'creator_tracker_v2'
                and observation.external_observation_id = item_id::text;

              if existing_observation.id is null
                or existing_observation.post_id <> canonical_post_id
                or existing_observation.provider_identity_id is distinct from provider_identity_id
                or existing_observation.external_run_id is distinct from (item_payload->>'runId')
                or existing_observation.observed_at <> observed_timestamp
                or existing_observation.view_count is distinct from view_metric
                or existing_observation.like_count is distinct from like_metric
                or existing_observation.comment_count is distinct from comment_metric
                or existing_observation.share_count is distinct from share_metric
                or existing_observation.raw_archive_ref is distinct from raw_archive_reference
                or existing_observation.payload_sha256 is distinct from raw_payload_hash then
                raise exception 'observation_identity_conflict';
              end if;
              canonical_observation_id := existing_observation.id;
            end if;

            item_outcome := 'matched';
            item_code := 'canonical_observation_matched';
          end if;
        end if;
      exception when others then
        item_outcome := 'error';
        item_code := case sqlerrm
          when 'post_identity_conflict' then 'post_identity_conflict'
          when 'provider_identity_conflict' then 'provider_identity_conflict'
          when 'observation_identity_conflict' then 'observation_identity_conflict'
          when 'staged_canonical_link_conflict' then 'staged_canonical_link_conflict'
          when 'staged_attribution_inconsistent' then 'staged_attribution_inconsistent'
          when 'staged_account_platform_mismatch' then 'staged_account_platform_mismatch'
          when 'staged_account_identity_conflict' then 'staged_account_identity_conflict'
          when 'staged_video_identity_conflict' then 'staged_video_identity_conflict'
          when 'staged_observation_conflict' then 'staged_observation_conflict'
          else 'projection_error'
        end;
        item_detail := case sqlerrm
          when 'staged_account_identity_conflict' then 'The same tracker account ID was delivered with a different stable native account ID.'
          when 'staged_video_identity_conflict' then 'The same tracker video ID was delivered with a different stable native post ID.'
          when 'staged_observation_conflict' then 'The same tracker observation ID was delivered with different immutable evidence.'
          when 'staged_canonical_link_conflict' then 'An existing staged identity cannot be rebound to a different canonical creator record.'
          when 'staged_attribution_inconsistent' then 'The staged video, account, and verified canonical ownership links do not agree.'
          when 'staged_account_platform_mismatch' then 'The staged account platform does not match the provider post platform.'
          else left(sqlerrm, 500)
        end;
        platform_account_id := null;
        canonical_post_id := null;
        provider_identity_id := null;
        canonical_observation_id := null;
      end;

      select * into existing_stage
      from public.creator_tracker_staged_entities staged
      where staged.organization_id = organization_id
        and staged.entity_type = entity_kind
        and staged.tracker_entity_id = item_id
      for update;

      if existing_stage.tracker_entity_id is not null
        and item_code in (
          'staged_account_identity_conflict',
          'staged_video_identity_conflict',
          'staged_observation_conflict',
          'staged_canonical_link_conflict',
          'staged_attribution_inconsistent',
          'staged_account_platform_mismatch'
        ) then
        platform_account_id := existing_stage.canonical_platform_account_id;
        canonical_post_id := existing_stage.canonical_post_id;
        provider_identity_id := existing_stage.canonical_provider_identity_id;
        canonical_observation_id := existing_stage.canonical_observation_id;
      elsif existing_stage.tracker_entity_id is null then
        insert into public.creator_tracker_staged_entities (
          organization_id, entity_type, tracker_entity_id, latest_batch_id,
          payload_sha256, payload, platform, native_account_id,
          tracker_account_id, tracker_video_id, canonical_platform_account_id,
          canonical_post_id, canonical_provider_identity_id,
          canonical_observation_id, resolution_state, resolution_code,
          resolution_detail
        ) values (
          organization_id, entity_kind, item_id, batch_id,
          item_hash, item_payload, item_platform, item_native_account_id,
          tracker_account, tracker_video, platform_account_id,
          canonical_post_id, provider_identity_id, canonical_observation_id,
          item_outcome, item_code, item_detail
        );
      else
        update public.creator_tracker_staged_entities
        set latest_batch_id = batch_id,
            payload_sha256 = item_hash,
            payload = item_payload,
            platform = coalesce(item_platform, creator_tracker_staged_entities.platform),
            native_account_id = coalesce(item_native_account_id, creator_tracker_staged_entities.native_account_id),
            tracker_account_id = coalesce(tracker_account, creator_tracker_staged_entities.tracker_account_id),
            tracker_video_id = coalesce(tracker_video, creator_tracker_staged_entities.tracker_video_id),
            canonical_platform_account_id = coalesce(platform_account_id, creator_tracker_staged_entities.canonical_platform_account_id),
            canonical_post_id = coalesce(canonical_post_id, creator_tracker_staged_entities.canonical_post_id),
            canonical_provider_identity_id = coalesce(provider_identity_id, creator_tracker_staged_entities.canonical_provider_identity_id),
            canonical_observation_id = coalesce(canonical_observation_id, creator_tracker_staged_entities.canonical_observation_id),
            resolution_state = item_outcome,
            resolution_code = item_code,
            resolution_detail = item_detail,
            last_received_at = now()
        where creator_tracker_staged_entities.organization_id = organization_id
          and creator_tracker_staged_entities.entity_type = entity_kind
          and creator_tracker_staged_entities.tracker_entity_id = item_id;
      end if;

      insert into public.creator_tracker_ingest_items (
        batch_id, entity_type, item_index, tracker_entity_id, payload_sha256,
        payload, outcome, resolution_code, resolution_detail,
        canonical_platform_account_id, canonical_post_id,
        canonical_provider_identity_id, canonical_observation_id
      ) values (
        batch_id, entity_kind, item_record.item_index, item_id, item_hash,
        item_payload, item_outcome, item_code, item_detail,
        platform_account_id, canonical_post_id,
        provider_identity_id, canonical_observation_id
      );

      case item_outcome
        when 'retained' then retained_total := retained_total + 1;
        when 'matched' then matched_total := matched_total + 1;
        when 'unmatched' then unmatched_total := unmatched_total + 1;
        else error_total := error_total + 1;
      end case;
    end loop;
  end loop;

  committed_timestamp := clock_timestamp();
  update public.creator_tracker_ingest_batches
  set status = 'committed',
      retained_count = retained_total,
      matched_count = matched_total,
      unmatched_count = unmatched_total,
      error_count = error_total,
      committed_at = committed_timestamp
  where id = batch_id;

  return jsonb_build_object(
    'batchId', batch_id,
    'organizationId', organization_id,
    'idempotencyKey', idempotency_key,
    'payloadSha256', request_payload_sha256,
    'committedAt', committed_timestamp,
    'itemCount', expected_item_count,
    'observationCount', expected_observation_count,
    'failureCount', expected_failure_count,
    'replayed', false
  );
end;
$$;

-- The original staff RPC overwrote an existing observation on idempotency
-- conflict. Replace it additively so all callers now use insert-or-compare and
-- the append-only trigger can enforce the same evidence rule.
create or replace function public.record_creator_post_observation(
  observation_input jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  ignored_actor uuid;
  target_post_id uuid;
  target_provider_identity_id uuid;
  source_key text := lower(btrim(coalesce(observation_input->>'sourceSystem', '')));
  external_observation_key text := btrim(coalesce(observation_input->>'externalObservationId', ''));
  run_key text := nullif(btrim(coalesce(observation_input->>'externalRunId', '')), '');
  observed_timestamp timestamptz;
  view_metric bigint;
  like_metric bigint;
  comment_metric bigint;
  share_metric bigint;
  archive_reference text := nullif(btrim(coalesce(observation_input->>'rawArchiveRef', '')), '');
  payload_hash text := nullif(lower(btrim(coalesce(observation_input->>'payloadSha256', ''))), '');
  existing_observation public.creator_post_observations%rowtype;
  new_observation_id uuid;
begin
  ignored_actor := public.creator_content_require_staff(false);
  target_post_id := (observation_input->>'postId')::uuid;
  target_provider_identity_id := nullif(observation_input->>'providerIdentityId', '')::uuid;
  observed_timestamp := (observation_input->>'observedAt')::timestamptz;
  view_metric := nullif(observation_input->>'viewCount', '')::bigint;
  like_metric := nullif(observation_input->>'likeCount', '')::bigint;
  comment_metric := nullif(observation_input->>'commentCount', '')::bigint;
  share_metric := nullif(observation_input->>'shareCount', '')::bigint;

  if not exists (select 1 from public.creator_posts where id = target_post_id) then
    raise exception 'Post not found.' using errcode = '22023';
  end if;
  if target_provider_identity_id is not null and not exists (
    select 1 from public.creator_post_provider_identities identity
    where identity.id = target_provider_identity_id and identity.post_id = target_post_id
  ) then
    raise exception 'The provider identity does not belong to that post.' using errcode = '22023';
  end if;
  if source_key !~ '^[a-z][a-z0-9._-]{1,79}$'
    or char_length(external_observation_key) not between 1 and 191 then
    raise exception 'Observation source identity is not valid.' using errcode = '22023';
  end if;

  insert into public.creator_post_observations (
    post_id, provider_identity_id, source_system, external_observation_id,
    external_run_id, observed_at, view_count, like_count, comment_count,
    share_count, raw_archive_ref, payload_sha256
  ) values (
    target_post_id, target_provider_identity_id, source_key,
    external_observation_key, run_key, observed_timestamp, view_metric,
    like_metric, comment_metric, share_metric, archive_reference, payload_hash
  )
  on conflict (source_system, external_observation_id) do nothing
  returning id into new_observation_id;

  if new_observation_id is not null then
    return new_observation_id;
  end if;

  select * into existing_observation
  from public.creator_post_observations observation
  where observation.source_system = source_key
    and observation.external_observation_id = external_observation_key;

  if existing_observation.id is null
    or existing_observation.post_id <> target_post_id
    or existing_observation.provider_identity_id is distinct from target_provider_identity_id
    or existing_observation.external_run_id is distinct from run_key
    or existing_observation.observed_at <> observed_timestamp
    or existing_observation.view_count is distinct from view_metric
    or existing_observation.like_count is distinct from like_metric
    or existing_observation.comment_count is distinct from comment_metric
    or existing_observation.share_count is distinct from share_metric
    or existing_observation.raw_archive_ref is distinct from archive_reference
    or existing_observation.payload_sha256 is distinct from payload_hash then
    raise exception 'Observation identity was reused with different immutable evidence.' using errcode = '23505';
  end if;

  return existing_observation.id;
end;
$$;

create or replace function public.get_creator_tracker_ingestion_status(
  recent_limit integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
declare
  ignored_actor uuid;
  bounded_limit integer := greatest(1, least(coalesce(recent_limit, 50), 200));
begin
  ignored_actor := public.creator_content_require_staff(false);

  return jsonb_build_object(
    'summary', jsonb_build_object(
      'committedBatches', (
        select count(*)::integer
        from public.creator_tracker_ingest_batches
        where status = 'committed'
      ),
      'stagedAccounts', (
        select count(*)::integer
        from public.creator_tracker_staged_entities
        where entity_type = 'account'
      ),
      'stagedVideos', (
        select count(*)::integer
        from public.creator_tracker_staged_entities
        where entity_type = 'video'
      ),
      'stagedObservations', (
        select count(*)::integer
        from public.creator_tracker_staged_entities
        where entity_type = 'observation'
      ),
      'unmatchedAccounts', (
        select count(*)::integer
        from public.creator_tracker_staged_entities
        where entity_type = 'account' and resolution_state = 'unmatched'
      ),
      'unmatchedVideos', (
        select count(*)::integer
        from public.creator_tracker_staged_entities
        where entity_type = 'video' and resolution_state = 'unmatched'
      ),
      'unmatchedObservations', (
        select count(*)::integer
        from public.creator_tracker_staged_entities
        where entity_type = 'observation' and resolution_state = 'unmatched'
      ),
      'projectionErrors', (
        select count(*)::integer
        from public.creator_tracker_ingest_items
        where outcome = 'error'
      ),
      'lastCommittedAt', (
        select max(committed_at)
        from public.creator_tracker_ingest_batches
        where status = 'committed'
      )
    ),
    'recentBatches', coalesce((
      select jsonb_agg(jsonb_build_object(
        'batchId', recent.id,
        'organizationId', recent.organization_id,
        'source', recent.source,
        'committedAt', recent.committed_at,
        'itemCount', recent.item_count,
        'matchedCount', recent.matched_count,
        'unmatchedCount', recent.unmatched_count,
        'errorCount', recent.error_count
      ) order by recent.committed_at desc)
      from (
        select *
        from public.creator_tracker_ingest_batches
        where status = 'committed'
        order by committed_at desc
        limit bounded_limit
      ) recent
    ), '[]'::jsonb),
    'unresolved', coalesce((
      select jsonb_agg(jsonb_build_object(
        'entityType', unresolved.entity_type,
        'trackerEntityId', unresolved.tracker_entity_id,
        'platform', unresolved.platform,
        'nativeAccountId', unresolved.native_account_id,
        'resolutionState', unresolved.resolution_state,
        'resolutionCode', unresolved.resolution_code,
        'resolutionDetail', unresolved.resolution_detail,
        'lastReceivedAt', unresolved.last_received_at
      ) order by unresolved.last_received_at desc)
      from (
        select *
        from public.creator_tracker_staged_entities
        where resolution_state in ('unmatched', 'error')
        order by last_received_at desc
        limit bounded_limit
      ) unresolved
    ), '[]'::jsonb)
  );
end;
$$;

alter table public.creator_tracker_ingest_batches enable row level security;
alter table public.creator_tracker_staged_entities enable row level security;
alter table public.creator_tracker_ingest_items enable row level security;

revoke all on public.creator_tracker_ingest_batches from public, anon, authenticated;
revoke all on public.creator_tracker_staged_entities from public, anon, authenticated;
revoke all on public.creator_tracker_ingest_items from public, anon, authenticated;

revoke execute on function public.ingest_creator_tracker_batch(jsonb, text, text)
  from public, anon, authenticated;
grant execute on function public.ingest_creator_tracker_batch(jsonb, text, text)
  to service_role;

revoke execute on function public.get_creator_tracker_ingestion_status(integer)
  from public, anon;
grant execute on function public.get_creator_tracker_ingestion_status(integer)
  to authenticated, service_role;

revoke execute on function public.creator_tracker_prevent_audit_mutation() from public;

comment on table public.creator_tracker_ingest_batches is
  'Durable post-commit receipts for the signed laptop creator-tracker v2 delivery contract.';
comment on table public.creator_tracker_staged_entities is
  'Provider-tracked identities and facts retained before creator signup. A staged account is not ownership verification.';
comment on table public.creator_tracker_ingest_items is
  'Immutable per-batch projection audit. Unmatched is explicit and preserves the supplied non-secret evidence instead of becoming zero.';
