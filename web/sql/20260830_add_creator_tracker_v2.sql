-- Canonical creator/video tracking ledger (V2).
--
-- This schema is intentionally isolated from the legacy application tables. The
-- only legacy dependency is the organization tenant key. No payout, statement,
-- settlement, or payment table is referenced or granted to the tracking roles.
-- IDs are application-generated UUIDv7 values; the database never substitutes a
-- random UUID because doing so would weaken import locality and reproducibility.

CREATE SCHEMA IF NOT EXISTS creator_tracker_v2;

CREATE EXTENSION IF NOT EXISTS citext WITH SCHEMA public;

DO $$
DECLARE
  role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY[
    'creator_tracker_v2_reader',
    'creator_tracker_v2_ingest',
    'creator_tracker_v2_finalizer',
    'creator_tracker_v2_settlement_locker'
  ]
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = role_name) THEN
      EXECUTE format(
        'CREATE ROLE %I NOLOGIN NOINHERIT',
        role_name
      );
    END IF;

    -- Managed PostgreSQL operators such as Supabase's project `postgres` role
    -- can create ordinary roles but cannot restate SUPERUSER/REPLICATION/
    -- BYPASSRLS attributes, even as their negative forms. Refuse an unsafe
    -- pre-existing role from the catalog, then alter only attributes that the
    -- database owner is permitted to tighten. Newly-created roles inherit the
    -- safe PostgreSQL defaults for every checked capability.
    IF EXISTS (
      SELECT 1
      FROM pg_catalog.pg_roles
      WHERE rolname = role_name
        AND (
          rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls
        )
    ) THEN
      RAISE EXCEPTION 'creator tracker capability role % has a privileged attribute', role_name;
    END IF;

    EXECUTE format(
      'ALTER ROLE %I WITH NOLOGIN NOINHERIT',
      role_name
    );

    IF EXISTS (
      SELECT 1
      FROM pg_catalog.pg_roles
      WHERE rolname = role_name
        AND (
          rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR
          rolcreaterole OR rolreplication OR rolbypassrls
        )
    ) THEN
      RAISE EXCEPTION 'creator tracker capability role % is not fail-closed', role_name;
    END IF;

    -- These are leaf capability roles. If a pre-existing role with the same name
    -- inherits another role, fail closed instead of accidentally inheriting access
    -- to legacy application or payment tables.
    IF EXISTS (
      SELECT 1
      FROM pg_catalog.pg_auth_members membership
      JOIN pg_catalog.pg_roles member_role ON member_role.oid = membership.member
      WHERE member_role.rolname = role_name
    ) THEN
      RAISE EXCEPTION 'creator tracker capability role % must not be a member of another role', role_name;
    END IF;
  END LOOP;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_type type_row
    JOIN pg_catalog.pg_namespace namespace_row ON namespace_row.oid = type_row.typnamespace
    WHERE namespace_row.nspname = 'creator_tracker_v2'
      AND type_row.typname = 'uuid_v7'
  ) THEN
    CREATE DOMAIN creator_tracker_v2.uuid_v7 AS uuid
      CHECK (substring(VALUE::text FROM 15 FOR 1) = '7');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_type type_row
    JOIN pg_catalog.pg_namespace namespace_row ON namespace_row.oid = type_row.typnamespace
    WHERE namespace_row.nspname = 'creator_tracker_v2'
      AND type_row.typname = 'sha256_hex'
  ) THEN
    CREATE DOMAIN creator_tracker_v2.sha256_hex AS text
      CHECK (VALUE ~ '^[0-9a-f]{64}$');
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_type t
    JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'creator_tracker_v2' AND t.typname = 'platform'
  ) THEN
    CREATE TYPE creator_tracker_v2.platform AS ENUM ('tiktok', 'instagram', 'youtube');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_type t
    JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'creator_tracker_v2' AND t.typname = 'account_tracking_state'
  ) THEN
    CREATE TYPE creator_tracker_v2.account_tracking_state AS ENUM (
      'pending', 'active', 'paused', 'restricted', 'quarantined', 'closed'
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_type t
    JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'creator_tracker_v2' AND t.typname = 'discovery_tier'
  ) THEN
    CREATE TYPE creator_tracker_v2.discovery_tier AS ENUM ('hot', 'active', 'cool', 'archive');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_type t
    JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'creator_tracker_v2' AND t.typname = 'video_availability'
  ) THEN
    CREATE TYPE creator_tracker_v2.video_availability AS ENUM (
      'available', 'private', 'deleted', 'restricted', 'not_found', 'unknown'
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_type t
    JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'creator_tracker_v2' AND t.typname = 'video_tracking_state'
  ) THEN
    CREATE TYPE creator_tracker_v2.video_tracking_state AS ENUM (
      'active', 'cooling', 'archived', 'paused', 'needs_review'
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_type t
    JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'creator_tracker_v2' AND t.typname = 'observation_tier'
  ) THEN
    CREATE TYPE creator_tracker_v2.observation_tier AS ENUM (
      'hot', 'day_0_2', 'day_3_8', 'day_9_30', 'day_31_90', 'archive'
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_type t
    JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'creator_tracker_v2' AND t.typname = 'published_at_source'
  ) THEN
    CREATE TYPE creator_tracker_v2.published_at_source AS ENUM (
      'platform', 'provider', 'url', 'legacy_import', 'unknown'
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_type t
    JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'creator_tracker_v2' AND t.typname = 'evidence_confidence'
  ) THEN
    CREATE TYPE creator_tracker_v2.evidence_confidence AS ENUM (
      'verified', 'high', 'low', 'unknown', 'direct', 'provider', 'inferred', 'legacy'
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_type t
    JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'creator_tracker_v2' AND t.typname = 'ingestion_status'
  ) THEN
    CREATE TYPE creator_tracker_v2.ingestion_status AS ENUM ('accepted', 'rejected');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_type t
    JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'creator_tracker_v2' AND t.typname = 'run_status'
  ) THEN
    CREATE TYPE creator_tracker_v2.run_status AS ENUM (
      'complete', 'partial', 'capped', 'rate_limited', 'auth_required', 'failed'
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_type t
    JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'creator_tracker_v2' AND t.typname = 'retention_class'
  ) THEN
    CREATE TYPE creator_tracker_v2.retention_class AS ENUM (
      'operational', 'contract', 'settlement', 'legal_hold'
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_type t
    JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'creator_tracker_v2' AND t.typname = 'coverage_status'
  ) THEN
    CREATE TYPE creator_tracker_v2.coverage_status AS ENUM (
      'complete', 'partial', 'capped', 'stale', 'failed', 'unknown'
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_type t
    JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'creator_tracker_v2' AND t.typname = 'finalization_policy'
  ) THEN
    CREATE TYPE creator_tracker_v2.finalization_policy AS ENUM ('first_n_hours');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_type t
    JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'creator_tracker_v2' AND t.typname = 'finalization_status'
  ) THEN
    CREATE TYPE creator_tracker_v2.finalization_status AS ENUM (
      'pending', 'final', 'needs_review', 'void'
    );
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS creator_tracker_v2.role_tenant_grants (
  database_role name NOT NULL,
  organization_id text NOT NULL,
  can_read boolean NOT NULL DEFAULT false,
  can_ingest boolean NOT NULL DEFAULT false,
  can_finalize boolean NOT NULL DEFAULT false,
  can_lock boolean NOT NULL DEFAULT false,
  granted_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  granted_by name NOT NULL DEFAULT current_user,
  PRIMARY KEY (database_role, organization_id),
  CONSTRAINT role_tenant_grants_organization_fk
    FOREIGN KEY (organization_id)
    REFERENCES public."Organization" (id)
    ON DELETE RESTRICT,
  CONSTRAINT role_tenant_grants_some_access_ck
    CHECK (can_read OR can_ingest OR can_finalize OR can_lock),
  CONSTRAINT role_tenant_grants_derived_capabilities_need_read_ck
    CHECK (can_read OR NOT (can_ingest OR can_finalize OR can_lock))
);

CREATE TABLE IF NOT EXISTS creator_tracker_v2.creators (
  id creator_tracker_v2.uuid_v7 PRIMARY KEY,
  organization_id text NOT NULL,
  legacy_creator_id text,
  display_name text NOT NULL,
  state text NOT NULL DEFAULT 'active'
    CHECK (state IN ('pending', 'active', 'paused', 'closed', 'quarantined')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT creators_organization_fk
    FOREIGN KEY (organization_id)
    REFERENCES public."Organization" (id)
    ON DELETE RESTRICT,
  CONSTRAINT creators_tenant_id_uq UNIQUE (organization_id, id),
  CONSTRAINT creators_timestamp_order_ck CHECK (updated_at >= created_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS creators_tenant_legacy_uq
  ON creator_tracker_v2.creators (organization_id, legacy_creator_id)
  WHERE legacy_creator_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS creator_tracker_v2.ingestion_batches (
  id creator_tracker_v2.uuid_v7 PRIMARY KEY,
  organization_id text NOT NULL,
  idempotency_key text NOT NULL CHECK (btrim(idempotency_key) <> ''),
  source text NOT NULL CHECK (btrim(source) <> ''),
  collector_instance_id text NOT NULL CHECK (btrim(collector_instance_id) <> ''),
  schema_version smallint NOT NULL CHECK (schema_version > 0),
  payload_sha256 creator_tracker_v2.sha256_hex NOT NULL,
  status creator_tracker_v2.ingestion_status NOT NULL,
  received_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  accepted_at timestamptz,
  item_count integer NOT NULL DEFAULT 0 CHECK (item_count >= 0),
  observation_count integer NOT NULL DEFAULT 0 CHECK (observation_count >= 0),
  failure_count integer NOT NULL DEFAULT 0 CHECK (failure_count >= 0),
  rejection_code text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT ingestion_batches_organization_fk
    FOREIGN KEY (organization_id)
    REFERENCES public."Organization" (id)
    ON DELETE RESTRICT,
  CONSTRAINT ingestion_batches_tenant_id_uq UNIQUE (organization_id, id),
  CONSTRAINT ingestion_batches_idempotency_uq UNIQUE (organization_id, idempotency_key),
  CONSTRAINT ingestion_batches_status_shape_ck CHECK (
    (status = 'accepted' AND accepted_at IS NOT NULL AND rejection_code IS NULL)
    OR
    (status = 'rejected' AND accepted_at IS NULL AND rejection_code IS NOT NULL)
  ),
  CONSTRAINT ingestion_batches_timestamp_order_ck CHECK (
    accepted_at IS NULL OR accepted_at >= received_at
  )
);

CREATE TABLE IF NOT EXISTS creator_tracker_v2.creator_platform_accounts (
  id creator_tracker_v2.uuid_v7 PRIMARY KEY,
  organization_id text NOT NULL,
  creator_id creator_tracker_v2.uuid_v7 NOT NULL,
  platform creator_tracker_v2.platform NOT NULL,
  native_account_id text,
  current_handle public.citext,
  profile_url text,
  tracking_state creator_tracker_v2.account_tracking_state NOT NULL DEFAULT 'pending',
  discovery_tier creator_tracker_v2.discovery_tier NOT NULL DEFAULT 'active',
  first_seen_at timestamptz NOT NULL,
  last_discovery_at timestamptz,
  last_success_at timestamptz,
  last_complete_discovery_run_id creator_tracker_v2.uuid_v7,
  next_discovery_at timestamptz,
  consecutive_failures integer NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
  last_error_code text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT creator_platform_accounts_organization_fk
    FOREIGN KEY (organization_id)
    REFERENCES public."Organization" (id)
    ON DELETE RESTRICT,
  CONSTRAINT creator_platform_accounts_creator_fk
    FOREIGN KEY (organization_id, creator_id)
    REFERENCES creator_tracker_v2.creators (organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT creator_platform_accounts_tenant_id_uq UNIQUE (organization_id, id),
  CONSTRAINT creator_platform_accounts_tenant_id_platform_uq UNIQUE (organization_id, id, platform),
  CONSTRAINT creator_platform_accounts_tenant_id_creator_platform_uq
    UNIQUE (organization_id, id, creator_id, platform),
  CONSTRAINT creator_platform_accounts_native_id_state_ck CHECK (
    native_account_id IS NOT NULL OR tracking_state = 'quarantined'
  ),
  CONSTRAINT creator_platform_accounts_timestamp_order_ck CHECK (
    updated_at >= created_at
    AND (last_discovery_at IS NULL OR last_discovery_at >= first_seen_at)
    AND (last_success_at IS NULL OR last_success_at >= first_seen_at)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS creator_platform_accounts_native_id_uq
  ON creator_tracker_v2.creator_platform_accounts (organization_id, platform, native_account_id)
  WHERE native_account_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS creator_platform_accounts_due_idx
  ON creator_tracker_v2.creator_platform_accounts (tracking_state, next_discovery_at)
  WHERE tracking_state IN ('pending', 'active', 'restricted');

CREATE INDEX IF NOT EXISTS creator_platform_accounts_creator_idx
  ON creator_tracker_v2.creator_platform_accounts (organization_id, creator_id, platform);

CREATE TABLE IF NOT EXISTS creator_tracker_v2.videos (
  id creator_tracker_v2.uuid_v7 PRIMARY KEY,
  organization_id text NOT NULL,
  creator_id creator_tracker_v2.uuid_v7 NOT NULL,
  account_id creator_tracker_v2.uuid_v7 NOT NULL,
  platform creator_tracker_v2.platform NOT NULL,
  native_video_id text NOT NULL CHECK (btrim(native_video_id) <> ''),
  canonical_url text,
  published_at timestamptz,
  published_at_source creator_tracker_v2.published_at_source NOT NULL DEFAULT 'unknown',
  published_at_confidence creator_tracker_v2.evidence_confidence NOT NULL DEFAULT 'unknown'
    CHECK (published_at_confidence IN ('verified', 'high', 'low', 'unknown')),
  first_seen_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  first_seen_run_id creator_tracker_v2.uuid_v7 NOT NULL,
  caption_first text,
  caption_current text,
  hashtags_first text[] NOT NULL DEFAULT '{}',
  duration_ms integer CHECK (duration_ms IS NULL OR duration_ms >= 0),
  availability creator_tracker_v2.video_availability NOT NULL DEFAULT 'unknown',
  tracking_state creator_tracker_v2.video_tracking_state NOT NULL DEFAULT 'active',
  observation_tier creator_tracker_v2.observation_tier NOT NULL DEFAULT 'hot',
  last_observation_at timestamptz,
  next_observation_at timestamptz,
  latest_observation_id creator_tracker_v2.uuid_v7,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT videos_organization_fk
    FOREIGN KEY (organization_id)
    REFERENCES public."Organization" (id)
    ON DELETE RESTRICT,
  CONSTRAINT videos_creator_fk
    FOREIGN KEY (organization_id, creator_id)
    REFERENCES creator_tracker_v2.creators (organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT videos_account_creator_platform_fk
    FOREIGN KEY (organization_id, account_id, creator_id, platform)
    REFERENCES creator_tracker_v2.creator_platform_accounts (organization_id, id, creator_id, platform)
    ON DELETE RESTRICT,
  CONSTRAINT videos_tenant_id_uq UNIQUE (organization_id, id),
  CONSTRAINT videos_tenant_video_id_uq UNIQUE (organization_id, platform, native_video_id),
  CONSTRAINT videos_timestamp_order_ck CHECK (
    last_seen_at >= first_seen_at
    AND updated_at >= created_at
    AND (last_observation_at IS NULL OR last_observation_at >= first_seen_at)
  )
);

CREATE INDEX IF NOT EXISTS videos_due_idx
  ON creator_tracker_v2.videos (tracking_state, next_observation_at)
  WHERE tracking_state IN ('active', 'cooling', 'needs_review');

CREATE INDEX IF NOT EXISTS videos_account_published_idx
  ON creator_tracker_v2.videos (organization_id, account_id, published_at DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS videos_creator_published_idx
  ON creator_tracker_v2.videos (organization_id, creator_id, published_at DESC NULLS LAST);

CREATE TABLE IF NOT EXISTS creator_tracker_v2.tracking_runs (
  id creator_tracker_v2.uuid_v7 PRIMARY KEY,
  organization_id text NOT NULL,
  ingestion_batch_id creator_tracker_v2.uuid_v7 NOT NULL,
  worker_id text NOT NULL CHECK (btrim(worker_id) <> ''),
  adapter text NOT NULL CHECK (btrim(adapter) <> ''),
  adapter_version text NOT NULL CHECK (btrim(adapter_version) <> ''),
  request_id text NOT NULL CHECK (btrim(request_id) <> ''),
  scheduled_for timestamptz,
  request_started_at timestamptz NOT NULL,
  response_received_at timestamptz,
  completed_at timestamptz NOT NULL,
  status creator_tracker_v2.run_status NOT NULL,
  completeness_reason text,
  cursor_in text,
  cursor_out text,
  pages_expected integer CHECK (pages_expected IS NULL OR pages_expected >= 0),
  pages_fetched integer CHECK (pages_fetched IS NULL OR pages_fetched >= 0),
  items_expected integer CHECK (items_expected IS NULL OR items_expected >= 0),
  items_seen integer CHECK (items_seen IS NULL OR items_seen >= 0),
  items_written integer CHECK (items_written IS NULL OR items_written >= 0),
  http_status integer CHECK (http_status IS NULL OR http_status BETWEEN 100 AND 599),
  error_code text,
  error_detail jsonb CHECK (error_detail IS NULL OR jsonb_typeof(error_detail) = 'object'),
  raw_manifest_sha256 creator_tracker_v2.sha256_hex,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT tracking_runs_organization_fk
    FOREIGN KEY (organization_id)
    REFERENCES public."Organization" (id)
    ON DELETE RESTRICT,
  CONSTRAINT tracking_runs_batch_fk
    FOREIGN KEY (organization_id, ingestion_batch_id)
    REFERENCES creator_tracker_v2.ingestion_batches (organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT tracking_runs_tenant_id_uq UNIQUE (organization_id, id),
  CONSTRAINT tracking_runs_request_uq UNIQUE (organization_id, adapter, request_id),
  CONSTRAINT tracking_runs_timestamp_order_ck CHECK (
    (response_received_at IS NULL OR response_received_at >= request_started_at)
    AND completed_at >= request_started_at
  ),
  CONSTRAINT tracking_runs_status_shape_ck CHECK (
    (status = 'complete' AND error_code IS NULL)
    OR
    (status <> 'complete' AND completeness_reason IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS tracking_runs_completed_idx
  ON creator_tracker_v2.tracking_runs (organization_id, completed_at DESC);

CREATE INDEX IF NOT EXISTS tracking_runs_status_idx
  ON creator_tracker_v2.tracking_runs (organization_id, status, completed_at DESC);

CREATE TABLE IF NOT EXISTS creator_tracker_v2.raw_object_manifests (
  id creator_tracker_v2.uuid_v7 PRIMARY KEY,
  organization_id text NOT NULL,
  run_id creator_tracker_v2.uuid_v7 NOT NULL,
  source text NOT NULL CHECK (btrim(source) <> ''),
  endpoint text,
  storage_key text NOT NULL CHECK (btrim(storage_key) <> ''),
  sha256 creator_tracker_v2.sha256_hex NOT NULL,
  byte_length bigint NOT NULL CHECK (byte_length >= 0),
  content_type text NOT NULL CHECK (btrim(content_type) <> ''),
  source_observed_at timestamptz,
  fetched_at timestamptz NOT NULL,
  retention_class creator_tracker_v2.retention_class NOT NULL,
  retain_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT raw_object_manifests_organization_fk
    FOREIGN KEY (organization_id)
    REFERENCES public."Organization" (id)
    ON DELETE RESTRICT,
  CONSTRAINT raw_object_manifests_run_fk
    FOREIGN KEY (organization_id, run_id)
    REFERENCES creator_tracker_v2.tracking_runs (organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT raw_object_manifests_tenant_id_uq UNIQUE (organization_id, id),
  CONSTRAINT raw_object_manifests_tenant_run_id_uq UNIQUE (organization_id, run_id, id),
  CONSTRAINT raw_object_manifests_run_hash_uq UNIQUE (organization_id, run_id, sha256, source),
  CONSTRAINT raw_object_manifests_storage_key_uq UNIQUE (storage_key),
  CONSTRAINT raw_object_manifests_retention_ck CHECK (
    (retention_class = 'legal_hold' AND retain_until IS NULL)
    OR (
      retention_class <> 'legal_hold'
      AND (retain_until IS NULL OR retain_until >= fetched_at)
    )
  )
);

CREATE INDEX IF NOT EXISTS raw_object_manifests_hash_idx
  ON creator_tracker_v2.raw_object_manifests (organization_id, sha256);

CREATE TABLE IF NOT EXISTS creator_tracker_v2.account_handle_history (
  id creator_tracker_v2.uuid_v7 PRIMARY KEY,
  organization_id text NOT NULL,
  account_id creator_tracker_v2.uuid_v7 NOT NULL,
  handle public.citext NOT NULL CHECK (btrim(handle::text) <> ''),
  valid_from timestamptz NOT NULL,
  valid_to timestamptz,
  source_run_id creator_tracker_v2.uuid_v7 NOT NULL,
  is_verified boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT account_handle_history_organization_fk
    FOREIGN KEY (organization_id)
    REFERENCES public."Organization" (id)
    ON DELETE RESTRICT,
  CONSTRAINT account_handle_history_account_fk
    FOREIGN KEY (organization_id, account_id)
    REFERENCES creator_tracker_v2.creator_platform_accounts (organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT account_handle_history_run_fk
    FOREIGN KEY (organization_id, source_run_id)
    REFERENCES creator_tracker_v2.tracking_runs (organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT account_handle_history_tenant_id_uq UNIQUE (organization_id, id),
  CONSTRAINT account_handle_history_interval_ck CHECK (valid_to IS NULL OR valid_to > valid_from)
);

CREATE UNIQUE INDEX IF NOT EXISTS account_handle_history_one_current_idx
  ON creator_tracker_v2.account_handle_history (organization_id, account_id)
  WHERE valid_to IS NULL;

CREATE INDEX IF NOT EXISTS account_handle_history_handle_idx
  ON creator_tracker_v2.account_handle_history (organization_id, handle, valid_from DESC);

CREATE TABLE IF NOT EXISTS creator_tracker_v2.video_observations (
  id creator_tracker_v2.uuid_v7 PRIMARY KEY,
  organization_id text NOT NULL,
  video_id creator_tracker_v2.uuid_v7 NOT NULL,
  run_id creator_tracker_v2.uuid_v7 NOT NULL,
  adapter text NOT NULL CHECK (btrim(adapter) <> ''),
  metric_schema_version smallint NOT NULL CHECK (metric_schema_version > 0),
  scheduled_for timestamptz,
  request_started_at timestamptz NOT NULL,
  observed_at timestamptz NOT NULL,
  source_observed_at timestamptz,
  ingested_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  source_timezone text,
  views bigint CHECK (views IS NULL OR views >= 0),
  likes bigint CHECK (likes IS NULL OR likes >= 0),
  comments bigint CHECK (comments IS NULL OR comments >= 0),
  shares bigint CHECK (shares IS NULL OR shares >= 0),
  saves bigint CHECK (saves IS NULL OR saves >= 0),
  availability creator_tracker_v2.video_availability NOT NULL,
  http_status integer CHECK (http_status IS NULL OR http_status BETWEEN 100 AND 599),
  is_complete boolean NOT NULL,
  confidence creator_tracker_v2.evidence_confidence NOT NULL
    CHECK (confidence IN ('direct', 'provider', 'inferred', 'legacy')),
  counter_regression boolean NOT NULL DEFAULT false,
  raw_manifest_id creator_tracker_v2.uuid_v7,
  idempotency_key text NOT NULL CHECK (btrim(idempotency_key) <> ''),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT video_observations_organization_fk
    FOREIGN KEY (organization_id)
    REFERENCES public."Organization" (id)
    ON DELETE RESTRICT,
  CONSTRAINT video_observations_video_fk
    FOREIGN KEY (organization_id, video_id)
    REFERENCES creator_tracker_v2.videos (organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT video_observations_run_fk
    FOREIGN KEY (organization_id, run_id)
    REFERENCES creator_tracker_v2.tracking_runs (organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT video_observations_raw_manifest_fk
    FOREIGN KEY (organization_id, run_id, raw_manifest_id)
    REFERENCES creator_tracker_v2.raw_object_manifests (organization_id, run_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT video_observations_tenant_id_uq UNIQUE (organization_id, id),
  CONSTRAINT video_observations_tenant_video_id_uq UNIQUE (organization_id, video_id, id),
  CONSTRAINT video_observations_idempotency_uq UNIQUE (organization_id, idempotency_key),
  CONSTRAINT video_observations_timestamp_order_ck CHECK (observed_at >= request_started_at),
  CONSTRAINT video_observations_complete_shape_ck CHECK (
    NOT is_complete
    OR availability <> 'available'
    OR views IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS video_observations_video_time_idx
  ON creator_tracker_v2.video_observations (organization_id, video_id, observed_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS video_observations_run_idx
  ON creator_tracker_v2.video_observations (organization_id, run_id);

CREATE TABLE IF NOT EXISTS creator_tracker_v2.tracking_failures (
  id creator_tracker_v2.uuid_v7 PRIMARY KEY,
  organization_id text NOT NULL,
  run_id creator_tracker_v2.uuid_v7 NOT NULL,
  target_type text NOT NULL
    CHECK (target_type IN ('organization', 'account', 'video', 'page', 'window')),
  account_id creator_tracker_v2.uuid_v7,
  video_id creator_tracker_v2.uuid_v7,
  target_key text,
  stage text NOT NULL CHECK (btrim(stage) <> ''),
  error_code text NOT NULL CHECK (btrim(error_code) <> ''),
  http_status integer CHECK (http_status IS NULL OR http_status BETWEEN 100 AND 599),
  retryable boolean NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(detail) = 'object'),
  occurred_at timestamptz NOT NULL,
  resolved_by_run_id creator_tracker_v2.uuid_v7,
  idempotency_key text NOT NULL CHECK (btrim(idempotency_key) <> ''),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT tracking_failures_organization_fk
    FOREIGN KEY (organization_id)
    REFERENCES public."Organization" (id)
    ON DELETE RESTRICT,
  CONSTRAINT tracking_failures_run_fk
    FOREIGN KEY (organization_id, run_id)
    REFERENCES creator_tracker_v2.tracking_runs (organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT tracking_failures_account_fk
    FOREIGN KEY (organization_id, account_id)
    REFERENCES creator_tracker_v2.creator_platform_accounts (organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT tracking_failures_video_fk
    FOREIGN KEY (organization_id, video_id)
    REFERENCES creator_tracker_v2.videos (organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT tracking_failures_resolved_run_fk
    FOREIGN KEY (organization_id, resolved_by_run_id)
    REFERENCES creator_tracker_v2.tracking_runs (organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT tracking_failures_tenant_id_uq UNIQUE (organization_id, id),
  CONSTRAINT tracking_failures_idempotency_uq UNIQUE (organization_id, idempotency_key),
  CONSTRAINT tracking_failures_target_shape_ck CHECK (
    (target_type = 'account' AND account_id IS NOT NULL AND video_id IS NULL)
    OR
    (target_type = 'video' AND video_id IS NOT NULL AND account_id IS NULL)
    OR
    (target_type IN ('organization', 'page', 'window')
      AND account_id IS NULL AND video_id IS NULL AND target_key IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS tracking_failures_unresolved_idx
  ON creator_tracker_v2.tracking_failures (organization_id, retryable, occurred_at DESC)
  WHERE resolved_by_run_id IS NULL;

CREATE INDEX IF NOT EXISTS tracking_failures_run_idx
  ON creator_tracker_v2.tracking_failures (organization_id, run_id);

CREATE TABLE IF NOT EXISTS creator_tracker_v2.source_coverage_windows (
  id creator_tracker_v2.uuid_v7 PRIMARY KEY,
  organization_id text NOT NULL,
  platform creator_tracker_v2.platform,
  account_id creator_tracker_v2.uuid_v7,
  source text NOT NULL CHECK (btrim(source) <> ''),
  window_start timestamptz NOT NULL,
  window_end timestamptz NOT NULL,
  run_id creator_tracker_v2.uuid_v7 NOT NULL,
  status creator_tracker_v2.coverage_status NOT NULL,
  expected_count integer CHECK (expected_count IS NULL OR expected_count >= 0),
  discovered_count integer CHECK (discovered_count IS NULL OR discovered_count >= 0),
  observed_count integer CHECK (observed_count IS NULL OR observed_count >= 0),
  pages_expected integer CHECK (pages_expected IS NULL OR pages_expected >= 0),
  pages_fetched integer CHECK (pages_fetched IS NULL OR pages_fetched >= 0),
  missing_native_ids text[] NOT NULL DEFAULT '{}',
  warning_codes text[] NOT NULL DEFAULT '{}',
  computed_at timestamptz NOT NULL,
  evidence_sha256 creator_tracker_v2.sha256_hex NOT NULL,
  idempotency_key text NOT NULL CHECK (btrim(idempotency_key) <> ''),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT source_coverage_windows_organization_fk
    FOREIGN KEY (organization_id)
    REFERENCES public."Organization" (id)
    ON DELETE RESTRICT,
  CONSTRAINT source_coverage_windows_account_platform_fk
    FOREIGN KEY (organization_id, account_id, platform)
    REFERENCES creator_tracker_v2.creator_platform_accounts (organization_id, id, platform)
    ON DELETE RESTRICT,
  CONSTRAINT source_coverage_windows_run_fk
    FOREIGN KEY (organization_id, run_id)
    REFERENCES creator_tracker_v2.tracking_runs (organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT source_coverage_windows_tenant_id_uq UNIQUE (organization_id, id),
  CONSTRAINT source_coverage_windows_idempotency_uq UNIQUE (organization_id, idempotency_key),
  CONSTRAINT source_coverage_windows_scope_ck CHECK (
    (account_id IS NULL AND platform IS NULL)
    OR
    (account_id IS NULL AND platform IS NOT NULL)
    OR
    (account_id IS NOT NULL AND platform IS NOT NULL)
  ),
  CONSTRAINT source_coverage_windows_window_ck CHECK (window_end > window_start),
  CONSTRAINT source_coverage_windows_computed_after_window_ck CHECK (computed_at >= window_end),
  CONSTRAINT source_coverage_windows_complete_ck CHECK (
    status <> 'complete'
    OR (
      cardinality(missing_native_ids) = 0
      AND cardinality(warning_codes) = 0
      AND (pages_expected IS NULL OR pages_fetched = pages_expected)
      AND (expected_count IS NULL OR discovered_count = expected_count)
      AND (
        pages_expected IS NOT NULL
        OR expected_count IS NOT NULL
      )
    )
  )
);

CREATE INDEX IF NOT EXISTS source_coverage_windows_scope_idx
  ON creator_tracker_v2.source_coverage_windows (
    organization_id, account_id, source, window_end DESC
  );

CREATE INDEX IF NOT EXISTS source_coverage_windows_status_idx
  ON creator_tracker_v2.source_coverage_windows (organization_id, status, computed_at DESC);

CREATE TABLE IF NOT EXISTS creator_tracker_v2.video_window_finalizations (
  id creator_tracker_v2.uuid_v7 PRIMARY KEY,
  organization_id text NOT NULL,
  video_id creator_tracker_v2.uuid_v7 NOT NULL,
  policy_type creator_tracker_v2.finalization_policy NOT NULL,
  policy_version text NOT NULL CHECK (btrim(policy_version) <> ''),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  supersedes_id creator_tracker_v2.uuid_v7,
  window_start timestamptz NOT NULL,
  cutoff_at timestamptz NOT NULL,
  baseline_observation_id creator_tracker_v2.uuid_v7,
  baseline_at timestamptz,
  pre_cutoff_observation_id creator_tracker_v2.uuid_v7,
  post_cutoff_observation_id creator_tracker_v2.uuid_v7,
  selected_final_observation_id creator_tracker_v2.uuid_v7,
  cutoff_slippage_seconds integer,
  gross_views bigint CHECK (gross_views IS NULL OR gross_views >= 0),
  paid_views bigint CHECK (paid_views IS NULL OR paid_views >= 0),
  eligible_views bigint CHECK (eligible_views IS NULL OR eligible_views >= 0),
  coverage_id creator_tracker_v2.uuid_v7,
  status creator_tracker_v2.finalization_status NOT NULL,
  exception_code text,
  calculation_version text NOT NULL CHECK (btrim(calculation_version) <> ''),
  finalized_at timestamptz,
  finalization_sha256 creator_tracker_v2.sha256_hex,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT video_window_finalizations_organization_fk
    FOREIGN KEY (organization_id)
    REFERENCES public."Organization" (id)
    ON DELETE RESTRICT,
  CONSTRAINT video_window_finalizations_video_fk
    FOREIGN KEY (organization_id, video_id)
    REFERENCES creator_tracker_v2.videos (organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT video_window_finalizations_baseline_observation_fk
    FOREIGN KEY (organization_id, video_id, baseline_observation_id)
    REFERENCES creator_tracker_v2.video_observations (organization_id, video_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT video_window_finalizations_pre_observation_fk
    FOREIGN KEY (organization_id, video_id, pre_cutoff_observation_id)
    REFERENCES creator_tracker_v2.video_observations (organization_id, video_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT video_window_finalizations_post_observation_fk
    FOREIGN KEY (organization_id, video_id, post_cutoff_observation_id)
    REFERENCES creator_tracker_v2.video_observations (organization_id, video_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT video_window_finalizations_selected_observation_fk
    FOREIGN KEY (organization_id, video_id, selected_final_observation_id)
    REFERENCES creator_tracker_v2.video_observations (organization_id, video_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT video_window_finalizations_coverage_fk
    FOREIGN KEY (organization_id, coverage_id)
    REFERENCES creator_tracker_v2.source_coverage_windows (organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT video_window_finalizations_supersedes_fk
    FOREIGN KEY (organization_id, video_id, supersedes_id)
    REFERENCES creator_tracker_v2.video_window_finalizations (organization_id, video_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT video_window_finalizations_tenant_id_uq UNIQUE (organization_id, id),
  CONSTRAINT video_window_finalizations_tenant_video_id_uq UNIQUE (organization_id, video_id, id),
  CONSTRAINT video_window_finalizations_logical_revision_uq UNIQUE (
    organization_id, video_id, policy_type, policy_version, window_start, cutoff_at, revision
  ),
  CONSTRAINT video_window_finalizations_supersedes_uq UNIQUE (supersedes_id),
  CONSTRAINT video_window_finalizations_window_ck CHECK (cutoff_at > window_start),
  CONSTRAINT video_window_finalizations_status_shape_ck CHECK (
    (status = 'pending'
      AND finalized_at IS NULL
      AND finalization_sha256 IS NULL)
    OR
    (status = 'final'
      AND baseline_observation_id IS NOT NULL
      AND baseline_at IS NOT NULL
      AND post_cutoff_observation_id IS NOT NULL
      AND selected_final_observation_id IS NOT NULL
      AND coverage_id IS NOT NULL
      AND cutoff_slippage_seconds IS NOT NULL
      AND gross_views IS NOT NULL
      AND paid_views IS NOT NULL
      AND eligible_views IS NOT NULL
      AND paid_views <= gross_views
      AND eligible_views <= gross_views
      AND exception_code IS NULL
      AND finalized_at IS NOT NULL
      AND finalization_sha256 IS NOT NULL)
    OR
    (status IN ('needs_review', 'void')
      AND exception_code IS NOT NULL
      AND finalized_at IS NOT NULL
      AND finalization_sha256 IS NOT NULL)
  ),
  CONSTRAINT video_window_finalizations_revision_shape_ck CHECK (
    (revision = 1 AND supersedes_id IS NULL)
    OR
    (revision > 1 AND supersedes_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS video_window_finalizations_video_idx
  ON creator_tracker_v2.video_window_finalizations (
    organization_id, video_id, cutoff_at DESC, revision DESC
  );

CREATE INDEX IF NOT EXISTS video_window_finalizations_status_idx
  ON creator_tracker_v2.video_window_finalizations (organization_id, status, cutoff_at DESC);

CREATE TABLE IF NOT EXISTS creator_tracker_v2.video_window_finalization_locks (
  id creator_tracker_v2.uuid_v7 PRIMARY KEY,
  organization_id text NOT NULL,
  finalization_id creator_tracker_v2.uuid_v7 NOT NULL,
  finalization_sha256 creator_tracker_v2.sha256_hex NOT NULL,
  lock_manifest_sha256 creator_tracker_v2.sha256_hex NOT NULL,
  locked_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  locked_by text NOT NULL CHECK (btrim(locked_by) <> ''),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT video_window_finalization_locks_organization_fk
    FOREIGN KEY (organization_id)
    REFERENCES public."Organization" (id)
    ON DELETE RESTRICT,
  CONSTRAINT video_window_finalization_locks_finalization_fk
    FOREIGN KEY (organization_id, finalization_id)
    REFERENCES creator_tracker_v2.video_window_finalizations (organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT video_window_finalization_locks_tenant_id_uq UNIQUE (organization_id, id),
  CONSTRAINT video_window_finalization_locks_one_per_finalization_uq UNIQUE (finalization_id)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conname = 'creator_platform_accounts_last_complete_run_fk'
      AND conrelid = 'creator_tracker_v2.creator_platform_accounts'::regclass
  ) THEN
    ALTER TABLE creator_tracker_v2.creator_platform_accounts
      ADD CONSTRAINT creator_platform_accounts_last_complete_run_fk
      FOREIGN KEY (organization_id, last_complete_discovery_run_id)
      REFERENCES creator_tracker_v2.tracking_runs (organization_id, id)
      ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conname = 'videos_first_seen_run_fk'
      AND conrelid = 'creator_tracker_v2.videos'::regclass
  ) THEN
    ALTER TABLE creator_tracker_v2.videos
      ADD CONSTRAINT videos_first_seen_run_fk
      FOREIGN KEY (organization_id, first_seen_run_id)
      REFERENCES creator_tracker_v2.tracking_runs (organization_id, id)
      ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conname = 'videos_latest_observation_fk'
      AND conrelid = 'creator_tracker_v2.videos'::regclass
  ) THEN
    ALTER TABLE creator_tracker_v2.videos
      ADD CONSTRAINT videos_latest_observation_fk
      FOREIGN KEY (organization_id, id, latest_observation_id)
      REFERENCES creator_tracker_v2.video_observations (organization_id, video_id, id)
      ON DELETE RESTRICT;
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION creator_tracker_v2.has_tenant_access(
  requested_organization_id text,
  requested_capability text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, creator_tracker_v2
AS $$
DECLARE
  actor_role name;
BEGIN
  IF requested_capability NOT IN ('read', 'ingest', 'finalize', 'lock') THEN
    RETURN false;
  END IF;

  -- Tenant grants belong to a concrete login, never to a shared capability
  -- role. session_user remains the authenticated login even when a pool uses
  -- SET ROLE to activate one of the NOLOGIN capability roles.
  actor_role := session_user::name;

  RETURN EXISTS (
    SELECT 1
    FROM creator_tracker_v2.role_tenant_grants tenant_grant
    WHERE tenant_grant.database_role = actor_role
      AND tenant_grant.organization_id = requested_organization_id
      AND CASE requested_capability
        WHEN 'read' THEN tenant_grant.can_read
        WHEN 'ingest' THEN tenant_grant.can_ingest
        WHEN 'finalize' THEN tenant_grant.can_finalize
        WHEN 'lock' THEN tenant_grant.can_lock
        ELSE false
      END
  );
END
$$;

CREATE OR REPLACE FUNCTION creator_tracker_v2.validate_role_tenant_grant()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  login_row pg_catalog.pg_roles%ROWTYPE;
BEGIN
  SELECT * INTO login_row
  FROM pg_catalog.pg_roles
  WHERE rolname = NEW.database_role;

  IF NOT FOUND
     OR NOT login_row.rolcanlogin
     OR NOT login_row.rolinherit
     OR login_row.rolsuper
     OR login_row.rolbypassrls THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'tenant access may only be granted to a concrete, inheriting, non-superuser login';
  END IF;

  IF NEW.can_ingest
     AND NOT pg_catalog.pg_has_role(NEW.database_role, 'creator_tracker_v2_ingest', 'MEMBER') THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'ingest access requires ingest role membership';
  END IF;

  IF NEW.can_finalize
     AND NOT pg_catalog.pg_has_role(NEW.database_role, 'creator_tracker_v2_finalizer', 'MEMBER') THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'finalize access requires finalizer role membership';
  END IF;

  IF NEW.can_lock
     AND NOT pg_catalog.pg_has_role(NEW.database_role, 'creator_tracker_v2_settlement_locker', 'MEMBER') THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'lock access requires settlement-locker role membership';
  END IF;

  IF NEW.can_read
     AND NOT (
       pg_catalog.pg_has_role(NEW.database_role, 'creator_tracker_v2_reader', 'MEMBER')
       OR pg_catalog.pg_has_role(NEW.database_role, 'creator_tracker_v2_ingest', 'MEMBER')
       OR pg_catalog.pg_has_role(NEW.database_role, 'creator_tracker_v2_finalizer', 'MEMBER')
       OR pg_catalog.pg_has_role(NEW.database_role, 'creator_tracker_v2_settlement_locker', 'MEMBER')
     ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'read access requires creator-tracker role membership';
  END IF;

  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION creator_tracker_v2.reject_evidence_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION USING
    ERRCODE = '55000',
    MESSAGE = format('%I.%I is append-only; corrections require a new row', TG_TABLE_SCHEMA, TG_TABLE_NAME);
END
$$;

CREATE OR REPLACE FUNCTION creator_tracker_v2.protect_creator_identity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF (NEW.organization_id, NEW.id, NEW.legacy_creator_id, NEW.created_at)
      IS DISTINCT FROM
     (OLD.organization_id, OLD.id, OLD.legacy_creator_id, OLD.created_at) THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'canonical creator identity is immutable';
  END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION creator_tracker_v2.protect_account_identity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF (NEW.organization_id, NEW.id, NEW.creator_id, NEW.platform, NEW.first_seen_at, NEW.created_at)
      IS DISTINCT FROM
     (OLD.organization_id, OLD.id, OLD.creator_id, OLD.platform, OLD.first_seen_at, OLD.created_at) THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'canonical account identity is immutable';
  END IF;

  IF OLD.native_account_id IS NOT NULL
     AND NEW.native_account_id IS DISTINCT FROM OLD.native_account_id THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'a resolved native account id is immutable';
  END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION creator_tracker_v2.protect_video_identity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF (
    NEW.organization_id,
    NEW.id,
    NEW.creator_id,
    NEW.account_id,
    NEW.platform,
    NEW.native_video_id,
    NEW.first_seen_at,
    NEW.first_seen_run_id,
    NEW.caption_first,
    NEW.hashtags_first,
    NEW.created_at
  ) IS DISTINCT FROM (
    OLD.organization_id,
    OLD.id,
    OLD.creator_id,
    OLD.account_id,
    OLD.platform,
    OLD.native_video_id,
    OLD.first_seen_at,
    OLD.first_seen_run_id,
    OLD.caption_first,
    OLD.hashtags_first,
    OLD.created_at
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'canonical video identity and first evidence are immutable';
  END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION creator_tracker_v2.validate_video_observation_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  run_row creator_tracker_v2.tracking_runs%ROWTYPE;
BEGIN
  SELECT * INTO STRICT run_row
  FROM creator_tracker_v2.tracking_runs
  WHERE organization_id = NEW.organization_id
    AND id = NEW.run_id;

  IF NEW.adapter <> run_row.adapter
     OR NEW.request_started_at < run_row.request_started_at
     OR NEW.observed_at > run_row.completed_at THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'an observation must match its run adapter and execution interval';
  END IF;

  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION creator_tracker_v2.validate_source_coverage_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  run_row creator_tracker_v2.tracking_runs%ROWTYPE;
BEGIN
  SELECT * INTO STRICT run_row
  FROM creator_tracker_v2.tracking_runs
  WHERE organization_id = NEW.organization_id
    AND id = NEW.run_id;

  IF NEW.source <> run_row.adapter
     OR NEW.window_end > run_row.completed_at
     OR NEW.computed_at < run_row.completed_at THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'coverage must match its run adapter and completed execution interval';
  END IF;

  IF NEW.status = 'complete' AND run_row.status <> 'complete' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'complete coverage requires a complete tracking run';
  END IF;

  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION creator_tracker_v2.protect_handle_history()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'account handle history cannot be deleted';
  END IF;

  IF (
    NEW.organization_id,
    NEW.id,
    NEW.account_id,
    NEW.handle,
    NEW.valid_from,
    NEW.source_run_id,
    NEW.is_verified,
    NEW.created_at
  ) IS DISTINCT FROM (
    OLD.organization_id,
    OLD.id,
    OLD.account_id,
    OLD.handle,
    OLD.valid_from,
    OLD.source_run_id,
    OLD.is_verified,
    OLD.created_at
  ) OR OLD.valid_to IS NOT NULL OR NEW.valid_to IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'a handle interval may only be closed once by setting valid_to';
  END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION creator_tracker_v2.reject_overlapping_handle_interval()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(NEW.organization_id || ':' || NEW.account_id::text, 0)
  );

  IF EXISTS (
    SELECT 1
    FROM creator_tracker_v2.account_handle_history existing
    WHERE existing.organization_id = NEW.organization_id
      AND existing.account_id = NEW.account_id
      AND existing.id <> NEW.id
      AND tstzrange(existing.valid_from, existing.valid_to, '[)')
          && tstzrange(NEW.valid_from, NEW.valid_to, '[)')
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23P01',
      MESSAGE = 'account handle validity intervals may not overlap';
  END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION creator_tracker_v2.validate_finalization_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  previous_row creator_tracker_v2.video_window_finalizations%ROWTYPE;
  coverage_row creator_tracker_v2.source_coverage_windows%ROWTYPE;
  video_account_id creator_tracker_v2.uuid_v7;
  video_platform creator_tracker_v2.platform;
  baseline_row creator_tracker_v2.video_observations%ROWTYPE;
  selected_row creator_tracker_v2.video_observations%ROWTYPE;
  pre_row creator_tracker_v2.video_observations%ROWTYPE;
  post_row creator_tracker_v2.video_observations%ROWTYPE;
  expected_slippage integer;
BEGIN
  IF NEW.supersedes_id IS NULL THEN
    IF NEW.revision <> 1 THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'first finalization revision must be 1';
    END IF;
  ELSE
    SELECT * INTO STRICT previous_row
    FROM creator_tracker_v2.video_window_finalizations
    WHERE organization_id = NEW.organization_id
      AND video_id = NEW.video_id
      AND id = NEW.supersedes_id;

    IF NEW.revision <> previous_row.revision + 1
       OR (NEW.policy_type, NEW.policy_version, NEW.window_start, NEW.cutoff_at)
          IS DISTINCT FROM
          (previous_row.policy_type, previous_row.policy_version, previous_row.window_start, previous_row.cutoff_at) THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'a finalization correction must preserve the logical window and increment revision by one';
    END IF;
  END IF;

  IF NEW.status <> 'final' THEN
    RETURN NEW;
  END IF;

  SELECT * INTO STRICT coverage_row
  FROM creator_tracker_v2.source_coverage_windows
  WHERE organization_id = NEW.organization_id
    AND id = NEW.coverage_id;

  SELECT account_id, platform INTO STRICT video_account_id, video_platform
  FROM creator_tracker_v2.videos
  WHERE organization_id = NEW.organization_id
    AND id = NEW.video_id;

  IF coverage_row.status <> 'complete'
     OR coverage_row.window_start > NEW.window_start
     OR coverage_row.window_end < NEW.cutoff_at
     OR coverage_row.platform IS DISTINCT FROM video_platform
     OR (coverage_row.account_id IS NOT NULL AND coverage_row.account_id <> video_account_id) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'a final result requires complete matching coverage across the entire window';
  END IF;

  SELECT * INTO STRICT baseline_row
  FROM creator_tracker_v2.video_observations
  WHERE organization_id = NEW.organization_id
    AND video_id = NEW.video_id
    AND id = NEW.baseline_observation_id;

  SELECT * INTO STRICT selected_row
  FROM creator_tracker_v2.video_observations
  WHERE organization_id = NEW.organization_id
    AND video_id = NEW.video_id
    AND id = NEW.selected_final_observation_id;

  IF NEW.pre_cutoff_observation_id IS NOT NULL THEN
    SELECT * INTO STRICT pre_row
    FROM creator_tracker_v2.video_observations
    WHERE organization_id = NEW.organization_id
      AND video_id = NEW.video_id
      AND id = NEW.pre_cutoff_observation_id;
  END IF;

  SELECT * INTO STRICT post_row
  FROM creator_tracker_v2.video_observations
  WHERE organization_id = NEW.organization_id
    AND video_id = NEW.video_id
    AND id = NEW.post_cutoff_observation_id;

  expected_slippage := extract(epoch FROM (selected_row.observed_at - NEW.cutoff_at))::integer;

  IF NOT baseline_row.is_complete
     OR NOT selected_row.is_complete
     OR NOT post_row.is_complete
     OR baseline_row.availability <> 'available'
     OR selected_row.availability <> 'available'
     OR post_row.availability <> 'available'
     OR baseline_row.views IS NULL
     OR selected_row.views IS NULL
     OR post_row.views IS NULL
     OR baseline_row.raw_manifest_id IS NULL
     OR selected_row.raw_manifest_id IS NULL
     OR post_row.raw_manifest_id IS NULL
     OR baseline_row.counter_regression
     OR selected_row.counter_regression
     OR post_row.counter_regression
     OR baseline_row.observed_at <> NEW.baseline_at
     OR baseline_row.observed_at > NEW.window_start
     OR NEW.selected_final_observation_id <> NEW.post_cutoff_observation_id
     OR selected_row.observed_at < NEW.cutoff_at
     OR post_row.observed_at < NEW.cutoff_at
     OR (NEW.pre_cutoff_observation_id IS NOT NULL AND (
       NOT pre_row.is_complete
       OR pre_row.availability <> 'available'
       OR pre_row.views IS NULL
       OR pre_row.raw_manifest_id IS NULL
       OR pre_row.counter_regression
       OR pre_row.observed_at > NEW.cutoff_at
     ))
     OR NEW.cutoff_slippage_seconds IS DISTINCT FROM expected_slippage
     OR selected_row.views < baseline_row.views
     OR NEW.gross_views IS DISTINCT FROM selected_row.views - baseline_row.views
     OR NEW.paid_views > NEW.gross_views
     OR NEW.eligible_views IS DISTINCT FROM greatest(NEW.gross_views - NEW.paid_views, 0::bigint) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'finalization metrics or evidence timestamps do not match their immutable observations';
  END IF;

  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION creator_tracker_v2.validate_finalization_lock_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  finalization_row creator_tracker_v2.video_window_finalizations%ROWTYPE;
BEGIN
  SELECT * INTO STRICT finalization_row
  FROM creator_tracker_v2.video_window_finalizations
  WHERE organization_id = NEW.organization_id
    AND id = NEW.finalization_id;

  IF finalization_row.status <> 'final'
     OR finalization_row.finalization_sha256 IS DISTINCT FROM NEW.finalization_sha256 THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'only a final row with an exactly matching hash can be settlement-locked';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS creators_protect_identity ON creator_tracker_v2.creators;
CREATE TRIGGER creators_protect_identity
BEFORE UPDATE ON creator_tracker_v2.creators
FOR EACH ROW EXECUTE FUNCTION creator_tracker_v2.protect_creator_identity();

DROP TRIGGER IF EXISTS role_tenant_grants_validate ON creator_tracker_v2.role_tenant_grants;
CREATE TRIGGER role_tenant_grants_validate
BEFORE INSERT OR UPDATE ON creator_tracker_v2.role_tenant_grants
FOR EACH ROW EXECUTE FUNCTION creator_tracker_v2.validate_role_tenant_grant();

DROP TRIGGER IF EXISTS accounts_protect_identity ON creator_tracker_v2.creator_platform_accounts;
CREATE TRIGGER accounts_protect_identity
BEFORE UPDATE ON creator_tracker_v2.creator_platform_accounts
FOR EACH ROW EXECUTE FUNCTION creator_tracker_v2.protect_account_identity();

DROP TRIGGER IF EXISTS videos_protect_identity ON creator_tracker_v2.videos;
CREATE TRIGGER videos_protect_identity
BEFORE UPDATE ON creator_tracker_v2.videos
FOR EACH ROW EXECUTE FUNCTION creator_tracker_v2.protect_video_identity();

DROP TRIGGER IF EXISTS observations_validate_insert ON creator_tracker_v2.video_observations;
CREATE TRIGGER observations_validate_insert
BEFORE INSERT ON creator_tracker_v2.video_observations
FOR EACH ROW EXECUTE FUNCTION creator_tracker_v2.validate_video_observation_insert();

DROP TRIGGER IF EXISTS coverage_validate_insert ON creator_tracker_v2.source_coverage_windows;
CREATE TRIGGER coverage_validate_insert
BEFORE INSERT ON creator_tracker_v2.source_coverage_windows
FOR EACH ROW EXECUTE FUNCTION creator_tracker_v2.validate_source_coverage_insert();

DROP TRIGGER IF EXISTS handle_history_protect_mutation ON creator_tracker_v2.account_handle_history;
CREATE TRIGGER handle_history_protect_mutation
BEFORE UPDATE OR DELETE ON creator_tracker_v2.account_handle_history
FOR EACH ROW EXECUTE FUNCTION creator_tracker_v2.protect_handle_history();

DROP TRIGGER IF EXISTS handle_history_reject_overlap ON creator_tracker_v2.account_handle_history;
CREATE TRIGGER handle_history_reject_overlap
BEFORE INSERT OR UPDATE ON creator_tracker_v2.account_handle_history
FOR EACH ROW EXECUTE FUNCTION creator_tracker_v2.reject_overlapping_handle_interval();

DROP TRIGGER IF EXISTS finalizations_validate_insert ON creator_tracker_v2.video_window_finalizations;
CREATE TRIGGER finalizations_validate_insert
BEFORE INSERT ON creator_tracker_v2.video_window_finalizations
FOR EACH ROW EXECUTE FUNCTION creator_tracker_v2.validate_finalization_insert();

DROP TRIGGER IF EXISTS finalization_locks_validate_insert ON creator_tracker_v2.video_window_finalization_locks;
CREATE TRIGGER finalization_locks_validate_insert
BEFORE INSERT ON creator_tracker_v2.video_window_finalization_locks
FOR EACH ROW EXECUTE FUNCTION creator_tracker_v2.validate_finalization_lock_insert();

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'ingestion_batches',
    'tracking_runs',
    'raw_object_manifests',
    'video_observations',
    'tracking_failures',
    'source_coverage_windows',
    'video_window_finalizations',
    'video_window_finalization_locks'
  ]
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS reject_evidence_mutation ON creator_tracker_v2.%I', table_name);
    EXECUTE format(
      'CREATE TRIGGER reject_evidence_mutation BEFORE UPDATE OR DELETE ON creator_tracker_v2.%I FOR EACH ROW EXECUTE FUNCTION creator_tracker_v2.reject_evidence_mutation()',
      table_name
    );
  END LOOP;
END
$$;

ALTER TABLE creator_tracker_v2.role_tenant_grants ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'creators',
    'ingestion_batches',
    'creator_platform_accounts',
    'videos',
    'tracking_runs',
    'raw_object_manifests',
    'account_handle_history',
    'video_observations',
    'tracking_failures',
    'source_coverage_windows',
    'video_window_finalizations',
    'video_window_finalization_locks'
  ]
  LOOP
    EXECUTE format('ALTER TABLE creator_tracker_v2.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE creator_tracker_v2.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_read ON creator_tracker_v2.%I', table_name);
    EXECUTE format(
      'CREATE POLICY tenant_read ON creator_tracker_v2.%I FOR SELECT TO creator_tracker_v2_reader, creator_tracker_v2_ingest, creator_tracker_v2_finalizer, creator_tracker_v2_settlement_locker USING (creator_tracker_v2.has_tenant_access(organization_id, ''read''))',
      table_name
    );
  END LOOP;
END
$$;

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'creators',
    'ingestion_batches',
    'creator_platform_accounts',
    'videos',
    'tracking_runs',
    'raw_object_manifests',
    'account_handle_history',
    'video_observations',
    'tracking_failures',
    'source_coverage_windows'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS tenant_ingest_insert ON creator_tracker_v2.%I', table_name);
    EXECUTE format(
      'CREATE POLICY tenant_ingest_insert ON creator_tracker_v2.%I FOR INSERT TO creator_tracker_v2_ingest WITH CHECK (creator_tracker_v2.has_tenant_access(organization_id, ''ingest''))',
      table_name
    );
  END LOOP;

  FOREACH table_name IN ARRAY ARRAY['creators', 'creator_platform_accounts', 'videos', 'account_handle_history']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS tenant_ingest_update ON creator_tracker_v2.%I', table_name);
    EXECUTE format(
      'CREATE POLICY tenant_ingest_update ON creator_tracker_v2.%I FOR UPDATE TO creator_tracker_v2_ingest USING (creator_tracker_v2.has_tenant_access(organization_id, ''ingest'')) WITH CHECK (creator_tracker_v2.has_tenant_access(organization_id, ''ingest''))',
      table_name
    );
  END LOOP;
END
$$;

DROP POLICY IF EXISTS tenant_finalize_insert ON creator_tracker_v2.video_window_finalizations;
CREATE POLICY tenant_finalize_insert
ON creator_tracker_v2.video_window_finalizations
FOR INSERT
TO creator_tracker_v2_finalizer
WITH CHECK (creator_tracker_v2.has_tenant_access(organization_id, 'finalize'));

DROP POLICY IF EXISTS tenant_lock_insert ON creator_tracker_v2.video_window_finalization_locks;
CREATE POLICY tenant_lock_insert
ON creator_tracker_v2.video_window_finalization_locks
FOR INSERT
TO creator_tracker_v2_settlement_locker
WITH CHECK (creator_tracker_v2.has_tenant_access(organization_id, 'lock'));

REVOKE ALL PRIVILEGES ON SCHEMA creator_tracker_v2 FROM PUBLIC;
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA creator_tracker_v2 FROM PUBLIC;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA creator_tracker_v2 FROM PUBLIC;
REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA creator_tracker_v2 FROM PUBLIC;

-- Enforce that the V2 capability roles cannot reach any legacy public table,
-- including payment-domain tables. Future cross-domain reads must go through a
-- separately reviewed API/view rather than a broad table grant.
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public
  FROM creator_tracker_v2_reader,
       creator_tracker_v2_ingest,
       creator_tracker_v2_finalizer,
       creator_tracker_v2_settlement_locker;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public
  FROM creator_tracker_v2_reader,
       creator_tracker_v2_ingest,
       creator_tracker_v2_finalizer,
       creator_tracker_v2_settlement_locker;
REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public
  FROM creator_tracker_v2_reader,
       creator_tracker_v2_ingest,
       creator_tracker_v2_finalizer,
       creator_tracker_v2_settlement_locker;

ALTER DEFAULT PRIVILEGES IN SCHEMA creator_tracker_v2 REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA creator_tracker_v2 REVOKE ALL ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA creator_tracker_v2 REVOKE ALL ON FUNCTIONS FROM PUBLIC;

GRANT USAGE ON SCHEMA creator_tracker_v2
  TO creator_tracker_v2_reader,
     creator_tracker_v2_ingest,
     creator_tracker_v2_finalizer,
     creator_tracker_v2_settlement_locker;

GRANT USAGE ON TYPE creator_tracker_v2.uuid_v7,
                    creator_tracker_v2.sha256_hex,
                    creator_tracker_v2.platform,
                    creator_tracker_v2.account_tracking_state,
                    creator_tracker_v2.discovery_tier,
                    creator_tracker_v2.video_availability,
                    creator_tracker_v2.video_tracking_state,
                    creator_tracker_v2.observation_tier,
                    creator_tracker_v2.published_at_source,
                    creator_tracker_v2.evidence_confidence,
                    creator_tracker_v2.ingestion_status,
                    creator_tracker_v2.run_status,
                    creator_tracker_v2.retention_class,
                    creator_tracker_v2.coverage_status,
                    creator_tracker_v2.finalization_policy,
                    creator_tracker_v2.finalization_status
  TO creator_tracker_v2_reader,
     creator_tracker_v2_ingest,
     creator_tracker_v2_finalizer,
     creator_tracker_v2_settlement_locker;

GRANT EXECUTE ON FUNCTION creator_tracker_v2.has_tenant_access(text, text)
  TO creator_tracker_v2_reader,
     creator_tracker_v2_ingest,
     creator_tracker_v2_finalizer,
     creator_tracker_v2_settlement_locker;

GRANT SELECT ON
  creator_tracker_v2.creators,
  creator_tracker_v2.ingestion_batches,
  creator_tracker_v2.creator_platform_accounts,
  creator_tracker_v2.videos,
  creator_tracker_v2.tracking_runs,
  creator_tracker_v2.raw_object_manifests,
  creator_tracker_v2.account_handle_history,
  creator_tracker_v2.video_observations,
  creator_tracker_v2.tracking_failures,
  creator_tracker_v2.source_coverage_windows,
  creator_tracker_v2.video_window_finalizations,
  creator_tracker_v2.video_window_finalization_locks
TO creator_tracker_v2_reader,
   creator_tracker_v2_ingest,
   creator_tracker_v2_finalizer,
   creator_tracker_v2_settlement_locker;

GRANT INSERT, UPDATE ON
  creator_tracker_v2.creators,
  creator_tracker_v2.creator_platform_accounts,
  creator_tracker_v2.videos,
  creator_tracker_v2.account_handle_history
TO creator_tracker_v2_ingest;

GRANT INSERT ON
  creator_tracker_v2.ingestion_batches,
  creator_tracker_v2.tracking_runs,
  creator_tracker_v2.raw_object_manifests,
  creator_tracker_v2.video_observations,
  creator_tracker_v2.tracking_failures,
  creator_tracker_v2.source_coverage_windows
TO creator_tracker_v2_ingest;

GRANT INSERT ON creator_tracker_v2.video_window_finalizations
  TO creator_tracker_v2_finalizer;

GRANT INSERT ON creator_tracker_v2.video_window_finalization_locks
  TO creator_tracker_v2_settlement_locker;

COMMENT ON SCHEMA creator_tracker_v2 IS
  'Canonical tenant-scoped creator/video evidence ledger. Isolated from legacy payment tables.';
COMMENT ON TABLE creator_tracker_v2.role_tenant_grants IS
  'Admin-only mapping from a concrete database login role to explicit organization capabilities.';
COMMENT ON TABLE creator_tracker_v2.video_observations IS
  'Append-only cumulative metric evidence. Null means unknown; zero means explicitly observed zero.';
COMMENT ON TABLE creator_tracker_v2.video_window_finalizations IS
  'Append-only versioned contract-window result. Corrections insert a revision; they never rewrite evidence.';
COMMENT ON TABLE creator_tracker_v2.video_window_finalization_locks IS
  'Append-only settlement lock proving the exact hash of a final window result.';
