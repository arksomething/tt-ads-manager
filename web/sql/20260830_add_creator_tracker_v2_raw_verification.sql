-- Recursive raw-object verification for creator tracker V2.
--
-- This versioned follow-up leaves the already-applied base migration intact.
-- Ingestion records a content-addressed aggregate manifest and every ordered
-- response object it names. Those rows remain explicitly unverified. A
-- separate least-privilege verifier must full-read every child, recompute and
-- full-read the canonical aggregate, and append one atomic attestation group
-- before settlement finalization can consume the evidence.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc function_row
    JOIN pg_catalog.pg_namespace namespace_row
      ON namespace_row.oid = function_row.pronamespace
    WHERE namespace_row.nspname = 'creator_tracker_v2'
      AND function_row.proname = 'raw_manifest_has_fresh_recursive_verification'
  ) AND (EXISTS (
    SELECT 1
    FROM creator_tracker_v2.video_window_finalizations
    WHERE status = 'final'
  ) OR EXISTS (
    SELECT 1 FROM creator_tracker_v2.video_window_finalization_locks
  )) THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'recursive raw verification upgrade requires zero pre-existing final results or settlement locks';
  END IF;
END
$$;

-- A CAS object is reusable. Each run still receives its own immutable manifest
-- row and lineage FK, but identical bytes across runs or tenants must not
-- conflict merely because their canonical storage key is identical.
ALTER TABLE creator_tracker_v2.raw_object_manifests
  DROP CONSTRAINT IF EXISTS raw_object_manifests_storage_key_uq;

CREATE INDEX IF NOT EXISTS raw_object_manifests_storage_key_idx
  ON creator_tracker_v2.raw_object_manifests (storage_key);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles
    WHERE rolname = 'creator_tracker_v2_raw_verifier'
  ) THEN
    CREATE ROLE creator_tracker_v2_raw_verifier NOLOGIN NOINHERIT;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles
    WHERE rolname = 'creator_tracker_v2_raw_verifier'
      AND (
        rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole
        OR rolreplication OR rolbypassrls
      )
  ) THEN
    RAISE EXCEPTION 'creator tracker raw verifier role is not fail-closed';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_auth_members membership
    JOIN pg_catalog.pg_roles member_role ON member_role.oid = membership.member
    WHERE member_role.rolname = 'creator_tracker_v2_raw_verifier'
  ) THEN
    RAISE EXCEPTION 'creator tracker raw verifier role must not be a member of another role';
  END IF;

  ALTER ROLE creator_tracker_v2_raw_verifier WITH NOLOGIN NOINHERIT;
END
$$;

ALTER TABLE creator_tracker_v2.role_tenant_grants
  ADD COLUMN IF NOT EXISTS can_verify_raw boolean NOT NULL DEFAULT false;

ALTER TABLE creator_tracker_v2.role_tenant_grants
  DROP CONSTRAINT IF EXISTS role_tenant_grants_some_access_ck,
  DROP CONSTRAINT IF EXISTS role_tenant_grants_derived_capabilities_need_read_ck;

ALTER TABLE creator_tracker_v2.role_tenant_grants
  ADD CONSTRAINT role_tenant_grants_some_access_ck
    CHECK (can_read OR can_ingest OR can_finalize OR can_lock OR can_verify_raw),
  ADD CONSTRAINT role_tenant_grants_derived_capabilities_need_read_ck
    CHECK (can_read OR NOT (can_ingest OR can_finalize OR can_lock OR can_verify_raw));

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
  IF requested_capability NOT IN ('read', 'ingest', 'finalize', 'lock', 'verify_raw') THEN
    RETURN false;
  END IF;

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
        WHEN 'verify_raw' THEN tenant_grant.can_verify_raw
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
     OR login_row.rolcreatedb
     OR login_row.rolcreaterole
     OR login_row.rolreplication
     OR login_row.rolbypassrls THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'tenant access may only be granted to a concrete, inheriting, unprivileged login';
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

  IF NEW.can_verify_raw
     AND NOT pg_catalog.pg_has_role(NEW.database_role, 'creator_tracker_v2_raw_verifier', 'MEMBER') THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'raw verification access requires raw-verifier role membership';
  END IF;

  IF NEW.can_read
     AND NOT (
       pg_catalog.pg_has_role(NEW.database_role, 'creator_tracker_v2_reader', 'MEMBER')
       OR pg_catalog.pg_has_role(NEW.database_role, 'creator_tracker_v2_ingest', 'MEMBER')
       OR pg_catalog.pg_has_role(NEW.database_role, 'creator_tracker_v2_finalizer', 'MEMBER')
       OR pg_catalog.pg_has_role(NEW.database_role, 'creator_tracker_v2_settlement_locker', 'MEMBER')
       OR pg_catalog.pg_has_role(NEW.database_role, 'creator_tracker_v2_raw_verifier', 'MEMBER')
     ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'read access requires creator-tracker role membership';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_roles inherited_role
    WHERE inherited_role.rolname <> NEW.database_role
      AND pg_catalog.pg_has_role(
        NEW.database_role,
        inherited_role.oid,
        'MEMBER'
      )
      AND inherited_role.rolname NOT IN (
        'creator_tracker_v2_reader',
        'creator_tracker_v2_ingest',
        'creator_tracker_v2_finalizer',
        'creator_tracker_v2_settlement_locker',
        'creator_tracker_v2_raw_verifier'
      )
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'tenant access logins may inherit only leaf creator-tracker capability roles';
  END IF;

  RETURN NEW;
END
$$;

-- Replacing the trigger closes future writes; this audit also fails the
-- upgrade if an already-applied grant targets a login that is now ineligible.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM creator_tracker_v2.role_tenant_grants tenant_grant
    LEFT JOIN pg_catalog.pg_roles login_role
      ON login_role.rolname = tenant_grant.database_role
    WHERE login_role.oid IS NULL
       OR NOT login_role.rolcanlogin
       OR NOT login_role.rolinherit
       OR login_role.rolsuper
       OR login_role.rolcreatedb
       OR login_role.rolcreaterole
       OR login_role.rolreplication
       OR login_role.rolbypassrls
       OR EXISTS (
         SELECT 1
         FROM pg_catalog.pg_roles inherited_role
         WHERE inherited_role.rolname <> tenant_grant.database_role
           AND pg_catalog.pg_has_role(
             tenant_grant.database_role,
             inherited_role.oid,
             'MEMBER'
           )
           AND inherited_role.rolname NOT IN (
             'creator_tracker_v2_reader',
             'creator_tracker_v2_ingest',
             'creator_tracker_v2_finalizer',
             'creator_tracker_v2_settlement_locker',
             'creator_tracker_v2_raw_verifier'
           )
       )
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '55000',
      MESSAGE = 'existing tenant grant targets an ineligible or over-privileged login';
  END IF;
END
$$;

-- Header fields that belong to the canonical aggregate bytes but were not in
-- the applied base table. Keeping them in an append-only child table preserves
-- old manifest rows without rewriting evidence.
CREATE TABLE IF NOT EXISTS creator_tracker_v2.raw_object_manifest_sets (
  raw_manifest_id creator_tracker_v2.uuid_v7 PRIMARY KEY,
  organization_id text NOT NULL,
  run_id creator_tracker_v2.uuid_v7 NOT NULL,
  store_version smallint NOT NULL CHECK (store_version = 1),
  purpose text NOT NULL CHECK (
    purpose IN ('account_discovery', 'video_observation', 'credit_rearm')
  ),
  response_count integer NOT NULL CHECK (response_count BETWEEN 1 AND 2000),
  total_response_bytes bigint NOT NULL CHECK (total_response_bytes > 0),
  sealed boolean NOT NULL CHECK (sealed),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT raw_object_manifest_sets_manifest_fk
    FOREIGN KEY (organization_id, run_id, raw_manifest_id)
    REFERENCES creator_tracker_v2.raw_object_manifests (organization_id, run_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT raw_object_manifest_sets_tenant_run_id_uq
    UNIQUE (organization_id, run_id, raw_manifest_id)
);

CREATE TABLE IF NOT EXISTS creator_tracker_v2.raw_object_manifest_entries (
  id creator_tracker_v2.uuid_v7 PRIMARY KEY,
  organization_id text NOT NULL,
  raw_manifest_id creator_tracker_v2.uuid_v7 NOT NULL,
  run_id creator_tracker_v2.uuid_v7 NOT NULL,
  ordinal integer NOT NULL CHECK (ordinal BETWEEN 0 AND 1999),
  adapter text NOT NULL CHECK (
    adapter IN ('tiktok_ytdlp', 'scrapecreators_tiktok', 'scrapecreators_instagram')
  ),
  request_kind text NOT NULL CHECK (request_kind IN ('profile_page', 'post_detail')),
  source_observed_at_ms bigint NOT NULL CHECK (
    source_observed_at_ms BETWEEN 0 AND 9007199254740991
  ),
  media_type text NOT NULL CHECK (media_type = 'application/json'),
  storage_key text NOT NULL,
  sha256 creator_tracker_v2.sha256_hex NOT NULL,
  byte_length bigint NOT NULL CHECK (byte_length > 0),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT raw_object_manifest_entries_set_fk
    FOREIGN KEY (organization_id, run_id, raw_manifest_id)
    REFERENCES creator_tracker_v2.raw_object_manifest_sets (
      organization_id, run_id, raw_manifest_id
    )
    ON DELETE RESTRICT,
  CONSTRAINT raw_object_manifest_entries_tenant_id_uq
    UNIQUE (organization_id, id),
  CONSTRAINT raw_object_manifest_entries_tenant_set_id_uq
    UNIQUE (organization_id, run_id, raw_manifest_id, id),
  CONSTRAINT raw_object_manifest_entries_ordinal_uq
    UNIQUE (organization_id, raw_manifest_id, ordinal),
  CONSTRAINT raw_object_manifest_entries_cas_key_ck CHECK (
    storage_key = 'creator-tracker/raw/v1/sha256/'
      || left(sha256::text, 2) || '/' || sha256::text
  )
);

CREATE INDEX IF NOT EXISTS raw_object_manifest_entries_hash_idx
  ON creator_tracker_v2.raw_object_manifest_entries (organization_id, sha256);

CREATE TABLE IF NOT EXISTS creator_tracker_v2.raw_object_verifications (
  id creator_tracker_v2.uuid_v7 PRIMARY KEY,
  organization_id text NOT NULL,
  raw_manifest_id creator_tracker_v2.uuid_v7 NOT NULL,
  raw_manifest_entry_id creator_tracker_v2.uuid_v7,
  verification_session_id creator_tracker_v2.uuid_v7,
  run_id creator_tracker_v2.uuid_v7 NOT NULL,
  storage_key text NOT NULL CHECK (btrim(storage_key) <> ''),
  sha256 creator_tracker_v2.sha256_hex NOT NULL,
  byte_length bigint NOT NULL CHECK (byte_length > 0),
  verification_method text NOT NULL,
  verifier_instance_id text NOT NULL CHECK (btrim(verifier_instance_id) <> ''),
  verified_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  idempotency_key text NOT NULL CHECK (btrim(idempotency_key) <> ''),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT raw_object_verifications_organization_fk
    FOREIGN KEY (organization_id)
    REFERENCES public."Organization" (id)
    ON DELETE RESTRICT,
  CONSTRAINT raw_object_verifications_manifest_fk
    FOREIGN KEY (organization_id, run_id, raw_manifest_id)
    REFERENCES creator_tracker_v2.raw_object_manifests (organization_id, run_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT raw_object_verifications_tenant_id_uq
    UNIQUE (organization_id, id),
  CONSTRAINT raw_object_verifications_idempotency_uq
    UNIQUE (organization_id, idempotency_key),
  CONSTRAINT raw_object_verifications_timestamp_order_ck
    CHECK (created_at >= verified_at)
);

-- Upgrade safely if an earlier draft of this follow-up created the table.
ALTER TABLE creator_tracker_v2.raw_object_verifications
  ADD COLUMN IF NOT EXISTS raw_manifest_entry_id creator_tracker_v2.uuid_v7,
  ADD COLUMN IF NOT EXISTS verification_session_id creator_tracker_v2.uuid_v7,
  DROP CONSTRAINT IF EXISTS raw_object_verifications_one_per_manifest_uq,
  DROP CONSTRAINT IF EXISTS raw_object_verifications_entry_fk,
  DROP CONSTRAINT IF EXISTS raw_object_verifications_verification_method_check,
  DROP CONSTRAINT IF EXISTS raw_object_verifications_method_ck;

ALTER TABLE creator_tracker_v2.raw_object_verifications
  ADD CONSTRAINT raw_object_verifications_entry_fk
    FOREIGN KEY (
      organization_id, run_id, raw_manifest_id, raw_manifest_entry_id
    )
    REFERENCES creator_tracker_v2.raw_object_manifest_entries (
      organization_id, run_id, raw_manifest_id, id
    )
    ON DELETE RESTRICT,
  ADD CONSTRAINT raw_object_verifications_method_ck CHECK (
    verification_method IN (
      'sha256_full_read_v1',
      'sha256_full_read_recursive_manifest_v1'
    )
  );

CREATE INDEX IF NOT EXISTS raw_object_verifications_hash_idx
  ON creator_tracker_v2.raw_object_verifications (organization_id, sha256);

CREATE INDEX IF NOT EXISTS raw_object_verifications_target_freshness_idx
  ON creator_tracker_v2.raw_object_verifications (
    organization_id, raw_manifest_id, raw_manifest_entry_id, verified_at DESC
  );

CREATE OR REPLACE FUNCTION creator_tracker_v2.validate_raw_manifest_set_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  manifest_row creator_tracker_v2.raw_object_manifests%ROWTYPE;
  run_row creator_tracker_v2.tracking_runs%ROWTYPE;
BEGIN
  SELECT * INTO manifest_row
  FROM creator_tracker_v2.raw_object_manifests
  WHERE organization_id = NEW.organization_id
    AND run_id = NEW.run_id
    AND id = NEW.raw_manifest_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '23503',
      MESSAGE = 'raw manifest set must reference a tenant-matching aggregate manifest';
  END IF;

  SELECT * INTO run_row
  FROM creator_tracker_v2.tracking_runs
  WHERE organization_id = NEW.organization_id
    AND id = NEW.run_id;

  IF manifest_row.content_type <> 'application/json'
     OR manifest_row.byte_length <= 0
     OR manifest_row.source NOT IN (
       'tiktok_ytdlp', 'scrapecreators_tiktok', 'scrapecreators_instagram'
     )
     OR run_row.id IS NULL
     OR manifest_row.source <> run_row.adapter
     OR manifest_row.fetched_at < run_row.request_started_at
     OR manifest_row.fetched_at > run_row.completed_at
     OR manifest_row.source_observed_at IS NULL
     OR manifest_row.source_observed_at < run_row.request_started_at
     OR manifest_row.source_observed_at > manifest_row.fetched_at
     OR manifest_row.storage_key <> 'creator-tracker/raw/v1/sha256/'
       || left(manifest_row.sha256::text, 2) || '/' || manifest_row.sha256::text THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'aggregate manifest must be a canonical content-addressed JSON object';
  END IF;

  NEW.created_at := transaction_timestamp();
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION creator_tracker_v2.validate_raw_manifest_entry_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  set_row creator_tracker_v2.raw_object_manifest_sets%ROWTYPE;
  manifest_row creator_tracker_v2.raw_object_manifests%ROWTYPE;
  run_row creator_tracker_v2.tracking_runs%ROWTYPE;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('creator-tracker-v2-raw:' || NEW.raw_manifest_id::text, 0)
  );

  SELECT * INTO set_row
  FROM creator_tracker_v2.raw_object_manifest_sets
  WHERE organization_id = NEW.organization_id
    AND run_id = NEW.run_id
    AND raw_manifest_id = NEW.raw_manifest_id;

  SELECT * INTO manifest_row
  FROM creator_tracker_v2.raw_object_manifests
  WHERE organization_id = NEW.organization_id
    AND run_id = NEW.run_id
    AND id = NEW.raw_manifest_id;

  SELECT * INTO run_row
  FROM creator_tracker_v2.tracking_runs
  WHERE organization_id = NEW.organization_id
    AND id = NEW.run_id;

  IF set_row.raw_manifest_id IS NULL
     OR manifest_row.id IS NULL
     OR run_row.id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '23503',
      MESSAGE = 'raw manifest entry must reference its tenant-matching set and run';
  END IF;

  IF NEW.ordinal >= set_row.response_count
     OR NEW.adapter <> manifest_row.source
     OR NEW.adapter <> run_row.adapter
     OR ((set_row.purpose = 'video_observation') IS DISTINCT FROM
         (NEW.request_kind = 'post_detail'))
     OR pg_catalog.to_timestamp(NEW.source_observed_at_ms::numeric / 1000)
       < run_row.request_started_at
     OR pg_catalog.to_timestamp(NEW.source_observed_at_ms::numeric / 1000)
       > run_row.completed_at
     OR pg_catalog.to_timestamp(NEW.source_observed_at_ms::numeric / 1000)
       > manifest_row.fetched_at THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'raw manifest entry does not match its sealed aggregate or run';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM creator_tracker_v2.raw_object_verifications verification
    WHERE verification.organization_id = NEW.organization_id
      AND verification.raw_manifest_id = NEW.raw_manifest_id
      AND verification.raw_manifest_entry_id IS NULL
      AND verification.verification_method = 'sha256_full_read_recursive_manifest_v1'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '55000',
      MESSAGE = 'a recursively verified aggregate cannot accept later child entries';
  END IF;

  NEW.created_at := transaction_timestamp();
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION creator_tracker_v2.validate_raw_object_verification_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  manifest_row creator_tracker_v2.raw_object_manifests%ROWTYPE;
  entry_row creator_tracker_v2.raw_object_manifest_entries%ROWTYPE;
  set_row creator_tracker_v2.raw_object_manifest_sets%ROWTYPE;
  actual_count bigint;
  actual_total numeric;
  minimum_ordinal integer;
  maximum_ordinal integer;
  latest_source_observed_at timestamptz;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('creator-tracker-v2-raw:' || NEW.raw_manifest_id::text, 0)
  );

  -- Verifier evidence uses database time only. A capability login cannot make
  -- an old read appear fresh or predate its manifest with caller timestamps.
  NEW.verified_at := transaction_timestamp();
  NEW.created_at := transaction_timestamp();

  IF NEW.verification_session_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'raw verification requires an explicit verification session';
  END IF;

  SELECT * INTO manifest_row
  FROM creator_tracker_v2.raw_object_manifests
  WHERE organization_id = NEW.organization_id
    AND run_id = NEW.run_id
    AND id = NEW.raw_manifest_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '23503',
      MESSAGE = 'raw verification must reference a tenant-matching manifest';
  END IF;

  IF NEW.raw_manifest_entry_id IS NOT NULL THEN
    SELECT * INTO entry_row
    FROM creator_tracker_v2.raw_object_manifest_entries
    WHERE organization_id = NEW.organization_id
      AND run_id = NEW.run_id
      AND raw_manifest_id = NEW.raw_manifest_id
      AND id = NEW.raw_manifest_entry_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = '23503',
        MESSAGE = 'child verification must reference a tenant-matching manifest entry';
    END IF;

    IF NEW.verification_method <> 'sha256_full_read_v1'
       OR (NEW.storage_key, NEW.sha256, NEW.byte_length)
            IS DISTINCT FROM
          (entry_row.storage_key, entry_row.sha256, entry_row.byte_length) THEN
      RAISE EXCEPTION USING ERRCODE = '23514',
        MESSAGE = 'child verification must exactly match a full-read manifest entry';
    END IF;

    RETURN NEW;
  END IF;

  SELECT * INTO set_row
  FROM creator_tracker_v2.raw_object_manifest_sets
  WHERE organization_id = NEW.organization_id
    AND run_id = NEW.run_id
    AND raw_manifest_id = NEW.raw_manifest_id;

  IF NOT FOUND
     OR NEW.verification_method <> 'sha256_full_read_recursive_manifest_v1'
     OR (NEW.storage_key, NEW.sha256, NEW.byte_length)
          IS DISTINCT FROM
        (manifest_row.storage_key, manifest_row.sha256, manifest_row.byte_length) THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'aggregate verification must exactly match a recursive full-read manifest';
  END IF;

  SELECT count(*), COALESCE(sum(byte_length), 0), min(ordinal), max(ordinal),
         TIMESTAMPTZ 'epoch' + max(source_observed_at_ms) * INTERVAL '1 millisecond'
    INTO actual_count, actual_total, minimum_ordinal, maximum_ordinal,
         latest_source_observed_at
  FROM creator_tracker_v2.raw_object_manifest_entries
  WHERE organization_id = NEW.organization_id
    AND run_id = NEW.run_id
    AND raw_manifest_id = NEW.raw_manifest_id;

  IF actual_count <> set_row.response_count
     OR actual_total <> set_row.total_response_bytes
     OR minimum_ordinal <> 0
     OR maximum_ordinal <> set_row.response_count - 1
     OR manifest_row.source_observed_at IS DISTINCT FROM latest_source_observed_at THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'recursive verification requires the complete contiguous manifest entry set';
  END IF;

  -- Canonical-manifest verification is one atomic unit: each child must have
  -- been full-read earlier in this same transaction and verification session.
  IF EXISTS (
    SELECT 1
    FROM creator_tracker_v2.raw_object_manifest_entries entry
    WHERE entry.organization_id = NEW.organization_id
      AND entry.run_id = NEW.run_id
      AND entry.raw_manifest_id = NEW.raw_manifest_id
      AND NOT EXISTS (
        SELECT 1
        FROM creator_tracker_v2.raw_object_verifications child_verification
        WHERE child_verification.organization_id = entry.organization_id
          AND child_verification.run_id = entry.run_id
          AND child_verification.raw_manifest_id = entry.raw_manifest_id
          AND child_verification.raw_manifest_entry_id = entry.id
          AND child_verification.verification_session_id = NEW.verification_session_id
          AND child_verification.verifier_instance_id = NEW.verifier_instance_id
          AND child_verification.created_at = NEW.created_at
          AND child_verification.verified_at = NEW.verified_at
          AND child_verification.verification_method = 'sha256_full_read_v1'
          AND child_verification.storage_key = entry.storage_key
          AND child_verification.sha256 = entry.sha256
          AND child_verification.byte_length = entry.byte_length
      )
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'recursive verification requires every child full-read in the same transaction';
  END IF;

  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION creator_tracker_v2.raw_manifest_has_fresh_recursive_verification(
  requested_organization_id text,
  requested_run_id creator_tracker_v2.uuid_v7,
  requested_manifest_id creator_tracker_v2.uuid_v7,
  as_of timestamptz
)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = pg_catalog, creator_tracker_v2
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM creator_tracker_v2.raw_object_manifests manifest
    JOIN creator_tracker_v2.raw_object_manifest_sets manifest_set
      ON manifest_set.organization_id = manifest.organization_id
     AND manifest_set.run_id = manifest.run_id
     AND manifest_set.raw_manifest_id = manifest.id
    JOIN creator_tracker_v2.raw_object_verifications aggregate_verification
      ON aggregate_verification.organization_id = manifest.organization_id
     AND aggregate_verification.run_id = manifest.run_id
     AND aggregate_verification.raw_manifest_id = manifest.id
     AND aggregate_verification.raw_manifest_entry_id IS NULL
     AND aggregate_verification.verification_method =
       'sha256_full_read_recursive_manifest_v1'
     AND aggregate_verification.storage_key = manifest.storage_key
     AND aggregate_verification.sha256 = manifest.sha256
     AND aggregate_verification.byte_length = manifest.byte_length
     AND aggregate_verification.verified_at >= as_of - interval '24 hours'
     AND aggregate_verification.verified_at <= as_of
    WHERE manifest.organization_id = requested_organization_id
      AND manifest.run_id = requested_run_id
      AND manifest.id = requested_manifest_id
      AND manifest.content_type = 'application/json'
      AND manifest.byte_length > 0
      AND manifest_set.store_version = 1
      AND manifest_set.sealed
      AND manifest.source_observed_at = (
        SELECT TIMESTAMPTZ 'epoch'
          + max(counted_entry.source_observed_at_ms) * INTERVAL '1 millisecond'
        FROM creator_tracker_v2.raw_object_manifest_entries counted_entry
        WHERE counted_entry.organization_id = manifest.organization_id
          AND counted_entry.run_id = manifest.run_id
          AND counted_entry.raw_manifest_id = manifest.id
      )
      AND manifest.storage_key = 'creator-tracker/raw/v1/sha256/'
        || left(manifest.sha256::text, 2) || '/' || manifest.sha256::text
      AND manifest_set.response_count = (
        SELECT count(*)
        FROM creator_tracker_v2.raw_object_manifest_entries counted_entry
        WHERE counted_entry.organization_id = manifest.organization_id
          AND counted_entry.run_id = manifest.run_id
          AND counted_entry.raw_manifest_id = manifest.id
      )
      AND manifest_set.total_response_bytes = (
        SELECT COALESCE(sum(counted_entry.byte_length), 0)
        FROM creator_tracker_v2.raw_object_manifest_entries counted_entry
        WHERE counted_entry.organization_id = manifest.organization_id
          AND counted_entry.run_id = manifest.run_id
          AND counted_entry.raw_manifest_id = manifest.id
      )
      AND 0 = (
        SELECT min(counted_entry.ordinal)
        FROM creator_tracker_v2.raw_object_manifest_entries counted_entry
        WHERE counted_entry.organization_id = manifest.organization_id
          AND counted_entry.run_id = manifest.run_id
          AND counted_entry.raw_manifest_id = manifest.id
      )
      AND manifest_set.response_count - 1 = (
        SELECT max(counted_entry.ordinal)
        FROM creator_tracker_v2.raw_object_manifest_entries counted_entry
        WHERE counted_entry.organization_id = manifest.organization_id
          AND counted_entry.run_id = manifest.run_id
          AND counted_entry.raw_manifest_id = manifest.id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM creator_tracker_v2.raw_object_manifest_entries entry
        WHERE entry.organization_id = manifest.organization_id
          AND entry.run_id = manifest.run_id
          AND entry.raw_manifest_id = manifest.id
          AND NOT EXISTS (
            SELECT 1
            FROM creator_tracker_v2.raw_object_verifications child_verification
            WHERE child_verification.organization_id = entry.organization_id
              AND child_verification.run_id = entry.run_id
              AND child_verification.raw_manifest_id = entry.raw_manifest_id
              AND child_verification.raw_manifest_entry_id = entry.id
              AND child_verification.verification_session_id =
                aggregate_verification.verification_session_id
              AND child_verification.verifier_instance_id =
                aggregate_verification.verifier_instance_id
              AND child_verification.created_at = aggregate_verification.created_at
              AND child_verification.verified_at = aggregate_verification.verified_at
              AND child_verification.verification_method = 'sha256_full_read_v1'
              AND child_verification.storage_key = entry.storage_key
              AND child_verification.sha256 = entry.sha256
              AND child_verification.byte_length = entry.byte_length
              AND child_verification.verified_at >= as_of - interval '24 hours'
              AND child_verification.verified_at <= as_of
          )
      )
  );
$$;

CREATE OR REPLACE FUNCTION creator_tracker_v2.require_finalization_raw_verification()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  coverage_row creator_tracker_v2.source_coverage_windows%ROWTYPE;
BEGIN
  IF NEW.status IS DISTINCT FROM 'final' THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    WITH required_observation_ids AS (
      SELECT observation_id
      FROM unnest(ARRAY[
        NEW.baseline_observation_id::uuid,
        NEW.pre_cutoff_observation_id::uuid,
        NEW.post_cutoff_observation_id::uuid,
        NEW.selected_final_observation_id::uuid
      ]) AS required(observation_id)
      WHERE observation_id IS NOT NULL
    )
    SELECT 1
    FROM required_observation_ids required
    LEFT JOIN creator_tracker_v2.video_observations observation
      ON observation.organization_id = NEW.organization_id
     AND observation.video_id = NEW.video_id
     AND observation.id = required.observation_id
    WHERE observation.id IS NULL
       OR observation.raw_manifest_id IS NULL
       OR NOT COALESCE(
         creator_tracker_v2.raw_manifest_has_fresh_recursive_verification(
           observation.organization_id,
           observation.run_id,
           observation.raw_manifest_id,
           transaction_timestamp()
         ),
         false
       )
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'finalization requires fresh recursive raw verification for every selected observation';
  END IF;

  SELECT * INTO coverage_row
  FROM creator_tracker_v2.source_coverage_windows
  WHERE organization_id = NEW.organization_id
    AND id = NEW.coverage_id;

  IF NOT FOUND OR NOT EXISTS (
    SELECT 1
    FROM creator_tracker_v2.raw_object_manifests manifest
    WHERE manifest.organization_id = coverage_row.organization_id
      AND manifest.run_id = coverage_row.run_id
      AND manifest.sha256 = coverage_row.evidence_sha256
      AND creator_tracker_v2.raw_manifest_has_fresh_recursive_verification(
        manifest.organization_id,
        manifest.run_id,
        manifest.id,
        transaction_timestamp()
      )
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'finalization requires fresh recursive raw verification for coverage';
  END IF;

  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS raw_manifest_sets_validate_insert
  ON creator_tracker_v2.raw_object_manifest_sets;
CREATE TRIGGER raw_manifest_sets_validate_insert
BEFORE INSERT ON creator_tracker_v2.raw_object_manifest_sets
FOR EACH ROW
EXECUTE FUNCTION creator_tracker_v2.validate_raw_manifest_set_insert();

DROP TRIGGER IF EXISTS raw_manifest_sets_reject_mutation
  ON creator_tracker_v2.raw_object_manifest_sets;
CREATE TRIGGER raw_manifest_sets_reject_mutation
BEFORE UPDATE OR DELETE ON creator_tracker_v2.raw_object_manifest_sets
FOR EACH ROW
EXECUTE FUNCTION creator_tracker_v2.reject_evidence_mutation();

DROP TRIGGER IF EXISTS raw_manifest_entries_validate_insert
  ON creator_tracker_v2.raw_object_manifest_entries;
CREATE TRIGGER raw_manifest_entries_validate_insert
BEFORE INSERT ON creator_tracker_v2.raw_object_manifest_entries
FOR EACH ROW
EXECUTE FUNCTION creator_tracker_v2.validate_raw_manifest_entry_insert();

DROP TRIGGER IF EXISTS raw_manifest_entries_reject_mutation
  ON creator_tracker_v2.raw_object_manifest_entries;
CREATE TRIGGER raw_manifest_entries_reject_mutation
BEFORE UPDATE OR DELETE ON creator_tracker_v2.raw_object_manifest_entries
FOR EACH ROW
EXECUTE FUNCTION creator_tracker_v2.reject_evidence_mutation();

DROP TRIGGER IF EXISTS raw_object_verifications_validate_insert
  ON creator_tracker_v2.raw_object_verifications;
CREATE TRIGGER raw_object_verifications_validate_insert
BEFORE INSERT ON creator_tracker_v2.raw_object_verifications
FOR EACH ROW
EXECUTE FUNCTION creator_tracker_v2.validate_raw_object_verification_insert();

DROP TRIGGER IF EXISTS raw_object_verifications_reject_mutation
  ON creator_tracker_v2.raw_object_verifications;
CREATE TRIGGER raw_object_verifications_reject_mutation
BEFORE UPDATE OR DELETE ON creator_tracker_v2.raw_object_verifications
FOR EACH ROW
EXECUTE FUNCTION creator_tracker_v2.reject_evidence_mutation();

DROP TRIGGER IF EXISTS finalizations_require_raw_verification
  ON creator_tracker_v2.video_window_finalizations;
CREATE TRIGGER finalizations_require_raw_verification
BEFORE INSERT ON creator_tracker_v2.video_window_finalizations
FOR EACH ROW
EXECUTE FUNCTION creator_tracker_v2.require_finalization_raw_verification();

ALTER TABLE creator_tracker_v2.raw_object_manifest_sets ENABLE ROW LEVEL SECURITY;
ALTER TABLE creator_tracker_v2.raw_object_manifest_sets FORCE ROW LEVEL SECURITY;
ALTER TABLE creator_tracker_v2.raw_object_manifest_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE creator_tracker_v2.raw_object_manifest_entries FORCE ROW LEVEL SECURITY;
ALTER TABLE creator_tracker_v2.raw_object_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE creator_tracker_v2.raw_object_verifications FORCE ROW LEVEL SECURITY;

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'raw_object_manifest_sets',
    'raw_object_manifest_entries'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS tenant_read ON creator_tracker_v2.%I', table_name);
    EXECUTE format(
      'CREATE POLICY tenant_read ON creator_tracker_v2.%I FOR SELECT TO creator_tracker_v2_reader, creator_tracker_v2_ingest, creator_tracker_v2_finalizer, creator_tracker_v2_settlement_locker, creator_tracker_v2_raw_verifier USING (creator_tracker_v2.has_tenant_access(organization_id, ''read''))',
      table_name
    );
    EXECUTE format('DROP POLICY IF EXISTS tenant_ingest_insert ON creator_tracker_v2.%I', table_name);
    EXECUTE format(
      'CREATE POLICY tenant_ingest_insert ON creator_tracker_v2.%I FOR INSERT TO creator_tracker_v2_ingest WITH CHECK (creator_tracker_v2.has_tenant_access(organization_id, ''ingest''))',
      table_name
    );
  END LOOP;
END
$$;

DROP POLICY IF EXISTS tenant_read
  ON creator_tracker_v2.raw_object_verifications;
CREATE POLICY tenant_read
ON creator_tracker_v2.raw_object_verifications
FOR SELECT
TO creator_tracker_v2_reader,
   creator_tracker_v2_ingest,
   creator_tracker_v2_finalizer,
   creator_tracker_v2_settlement_locker,
   creator_tracker_v2_raw_verifier
USING (creator_tracker_v2.has_tenant_access(organization_id, 'read'));

DROP POLICY IF EXISTS tenant_verify_raw_insert
  ON creator_tracker_v2.raw_object_verifications;
CREATE POLICY tenant_verify_raw_insert
ON creator_tracker_v2.raw_object_verifications
FOR INSERT
TO creator_tracker_v2_raw_verifier
WITH CHECK (creator_tracker_v2.has_tenant_access(organization_id, 'verify_raw'));

-- The verifier reads only raw-evidence tables. It cannot inspect observations,
-- finalizations, creator identities, legacy tables, or payment tables.
DROP POLICY IF EXISTS tenant_read ON creator_tracker_v2.raw_object_manifests;
CREATE POLICY tenant_read
ON creator_tracker_v2.raw_object_manifests
FOR SELECT
TO creator_tracker_v2_reader,
   creator_tracker_v2_ingest,
   creator_tracker_v2_finalizer,
   creator_tracker_v2_settlement_locker,
   creator_tracker_v2_raw_verifier
USING (creator_tracker_v2.has_tenant_access(organization_id, 'read'));

REVOKE ALL PRIVILEGES ON TABLE creator_tracker_v2.raw_object_manifest_sets FROM PUBLIC;
REVOKE ALL PRIVILEGES ON TABLE creator_tracker_v2.raw_object_manifest_entries FROM PUBLIC;
REVOKE ALL PRIVILEGES ON TABLE creator_tracker_v2.raw_object_verifications FROM PUBLIC;
REVOKE ALL PRIVILEGES ON FUNCTION creator_tracker_v2.validate_raw_manifest_set_insert() FROM PUBLIC;
REVOKE ALL PRIVILEGES ON FUNCTION creator_tracker_v2.validate_raw_manifest_entry_insert() FROM PUBLIC;
REVOKE ALL PRIVILEGES ON FUNCTION creator_tracker_v2.validate_raw_object_verification_insert() FROM PUBLIC;
REVOKE ALL PRIVILEGES ON FUNCTION creator_tracker_v2.raw_manifest_has_fresh_recursive_verification(
  text, creator_tracker_v2.uuid_v7, creator_tracker_v2.uuid_v7, timestamptz
) FROM PUBLIC;
REVOKE ALL PRIVILEGES ON FUNCTION creator_tracker_v2.require_finalization_raw_verification() FROM PUBLIC;

REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public
  FROM creator_tracker_v2_raw_verifier;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public
  FROM creator_tracker_v2_raw_verifier;
REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public
  FROM creator_tracker_v2_raw_verifier;

GRANT USAGE ON SCHEMA creator_tracker_v2
  TO creator_tracker_v2_raw_verifier;
GRANT USAGE ON TYPE creator_tracker_v2.uuid_v7,
                    creator_tracker_v2.sha256_hex
  TO creator_tracker_v2_raw_verifier;
GRANT EXECUTE ON FUNCTION creator_tracker_v2.has_tenant_access(text, text)
  TO creator_tracker_v2_raw_verifier;
GRANT EXECUTE ON FUNCTION creator_tracker_v2.raw_manifest_has_fresh_recursive_verification(
  text, creator_tracker_v2.uuid_v7, creator_tracker_v2.uuid_v7, timestamptz
) TO creator_tracker_v2_finalizer;

GRANT SELECT ON
  creator_tracker_v2.raw_object_manifest_sets,
  creator_tracker_v2.raw_object_manifest_entries
TO creator_tracker_v2_reader,
   creator_tracker_v2_ingest,
   creator_tracker_v2_finalizer,
   creator_tracker_v2_settlement_locker,
   creator_tracker_v2_raw_verifier;

GRANT SELECT ON creator_tracker_v2.raw_object_manifests
  TO creator_tracker_v2_raw_verifier;
GRANT SELECT ON creator_tracker_v2.raw_object_verifications
  TO creator_tracker_v2_reader,
     creator_tracker_v2_ingest,
     creator_tracker_v2_finalizer,
     creator_tracker_v2_settlement_locker,
     creator_tracker_v2_raw_verifier;
GRANT INSERT ON
  creator_tracker_v2.raw_object_manifest_sets,
  creator_tracker_v2.raw_object_manifest_entries
TO creator_tracker_v2_ingest;
GRANT INSERT ON creator_tracker_v2.raw_object_verifications
  TO creator_tracker_v2_raw_verifier;

COMMENT ON TABLE creator_tracker_v2.raw_object_manifest_sets IS
  'Append-only canonical aggregate headers; rows are externally pre-stored and unverified at ingestion.';
COMMENT ON TABLE creator_tracker_v2.raw_object_manifest_entries IS
  'Append-only ordered child response objects named by a canonical aggregate manifest.';
COMMENT ON TABLE creator_tracker_v2.raw_object_verifications IS
  'Append-only server-timestamped full-read attestations. Recursive aggregate attestations require every child in the same transaction.';
