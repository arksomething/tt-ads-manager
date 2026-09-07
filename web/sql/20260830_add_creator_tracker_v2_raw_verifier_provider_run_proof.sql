-- Narrow central proof contract for independently verified provider captures.
--
-- The raw verifier must prove that the immutable producer run it read locally
-- is the same provider-page run accepted by the canonical ledger. It still may
-- not read tracking_runs, ingestion_batches, or any legacy/payment table. A
-- dedicated NOLOGIN definer owns this one bounded function and receives only
-- the column privileges needed to answer an explicit tenant-scoped ID set.

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_roles
    WHERE rolname = 'creator_tracker_v2_raw_proof_owner'
  ) THEN
    CREATE ROLE creator_tracker_v2_raw_proof_owner NOLOGIN NOINHERIT;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_roles
    WHERE rolname = 'creator_tracker_v2_raw_proof_owner'
      AND (
        rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole
        OR rolreplication OR rolbypassrls
      )
  ) THEN
    RAISE EXCEPTION
      'creator tracker raw proof owner role is not fail-closed';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_auth_members membership
    JOIN pg_catalog.pg_roles member_role
      ON member_role.oid = membership.member
    WHERE member_role.rolname = 'creator_tracker_v2_raw_proof_owner'
  ) THEN
    RAISE EXCEPTION
      'creator tracker raw proof owner must not be a member of another role';
  END IF;

  ALTER ROLE creator_tracker_v2_raw_proof_owner WITH NOLOGIN NOINHERIT;

  -- PostgreSQL requires the migration operator to be able to SET ROLE to the
  -- new owner while creating or replacing its function. Keeping this internal
  -- membership makes retries idempotent; the operator already owns the schema
  -- and the proof owner remains a leaf, NOLOGIN role.
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_auth_members membership
    JOIN pg_catalog.pg_roles granted_role
      ON granted_role.oid = membership.roleid
    JOIN pg_catalog.pg_roles member_role
      ON member_role.oid = membership.member
    WHERE granted_role.rolname = 'creator_tracker_v2_raw_proof_owner'
      AND member_role.rolname = current_user
      AND membership.set_option
  ) THEN
    EXECUTE pg_catalog.format(
      'GRANT creator_tracker_v2_raw_proof_owner TO %I WITH SET TRUE',
      current_user
    );
  END IF;
END
$$;

REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public
  FROM creator_tracker_v2_raw_proof_owner;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public
  FROM creator_tracker_v2_raw_proof_owner;
REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public
  FROM creator_tracker_v2_raw_proof_owner;

GRANT USAGE ON SCHEMA creator_tracker_v2
  TO creator_tracker_v2_raw_proof_owner;
GRANT USAGE ON TYPE creator_tracker_v2.uuid_v7,
                    creator_tracker_v2.sha256_hex,
                    creator_tracker_v2.ingestion_status,
                    creator_tracker_v2.run_status
  TO creator_tracker_v2_raw_proof_owner,
     creator_tracker_v2_raw_verifier;
GRANT EXECUTE ON FUNCTION creator_tracker_v2.has_tenant_access(text, text)
  TO creator_tracker_v2_raw_proof_owner;

-- Column grants keep the SECURITY DEFINER surface materially narrower than a
-- table grant. FORCE RLS remains active and the policies below call the
-- session-user tenant map, so definer execution cannot cross the caller's
-- organization.
GRANT SELECT (
  organization_id, producer_run_id, run_id, raw_manifest_id, purpose
) ON creator_tracker_v2.raw_object_manifest_sets
  TO creator_tracker_v2_raw_proof_owner;
GRANT SELECT (
  organization_id, id, run_id, source
) ON creator_tracker_v2.raw_object_manifests
  TO creator_tracker_v2_raw_proof_owner;
GRANT SELECT (
  organization_id, id, ingestion_batch_id, adapter, adapter_version,
  request_id, request_started_at, response_received_at, completed_at, status,
  completeness_reason, pages_expected, pages_fetched, items_expected,
  items_seen, items_written, http_status, raw_manifest_sha256, error_detail
) ON creator_tracker_v2.tracking_runs
  TO creator_tracker_v2_raw_proof_owner;
GRANT SELECT (
  organization_id, id, idempotency_key, payload_sha256, status, item_count,
  observation_count, failure_count
) ON creator_tracker_v2.ingestion_batches
  TO creator_tracker_v2_raw_proof_owner;

DROP POLICY IF EXISTS tenant_raw_proof_select
  ON creator_tracker_v2.raw_object_manifest_sets;
CREATE POLICY tenant_raw_proof_select
ON creator_tracker_v2.raw_object_manifest_sets
FOR SELECT
TO creator_tracker_v2_raw_proof_owner
USING (creator_tracker_v2.has_tenant_access(organization_id, 'read'));

DROP POLICY IF EXISTS tenant_raw_proof_select
  ON creator_tracker_v2.raw_object_manifests;
CREATE POLICY tenant_raw_proof_select
ON creator_tracker_v2.raw_object_manifests
FOR SELECT
TO creator_tracker_v2_raw_proof_owner
USING (creator_tracker_v2.has_tenant_access(organization_id, 'read'));

DROP POLICY IF EXISTS tenant_raw_proof_select
  ON creator_tracker_v2.tracking_runs;
CREATE POLICY tenant_raw_proof_select
ON creator_tracker_v2.tracking_runs
FOR SELECT
TO creator_tracker_v2_raw_proof_owner
USING (creator_tracker_v2.has_tenant_access(organization_id, 'read'));

DROP POLICY IF EXISTS tenant_raw_proof_select
  ON creator_tracker_v2.ingestion_batches;
CREATE POLICY tenant_raw_proof_select
ON creator_tracker_v2.ingestion_batches
FOR SELECT
TO creator_tracker_v2_raw_proof_owner
USING (creator_tracker_v2.has_tenant_access(organization_id, 'read'));

-- CREATE OR REPLACE is performed as the durable NOLOGIN owner, rather than as
-- the deployment login. CREATE is removed from that owner immediately after
-- the function is defined.
GRANT CREATE ON SCHEMA creator_tracker_v2
  TO creator_tracker_v2_raw_proof_owner;
SET ROLE creator_tracker_v2_raw_proof_owner;

CREATE OR REPLACE FUNCTION creator_tracker_v2.raw_verifier_provider_capture_run_proof(
  requested_organization_id text,
  requested_producer_run_ids text[]
)
RETURNS TABLE (
  producer_run_id text,
  canonical_run_id creator_tracker_v2.uuid_v7,
  ingestion_batch_id creator_tracker_v2.uuid_v7,
  batch_idempotency_key text,
  batch_payload_sha256 creator_tracker_v2.sha256_hex,
  batch_status creator_tracker_v2.ingestion_status,
  batch_item_count integer,
  batch_observation_count integer,
  batch_failure_count integer,
  adapter text,
  adapter_version text,
  request_id text,
  request_started_at_ms bigint,
  response_received_at_ms bigint,
  completed_at_ms bigint,
  run_status creator_tracker_v2.run_status,
  completeness_reason text,
  pages_expected integer,
  pages_fetched integer,
  items_expected integer,
  items_seen integer,
  items_written integer,
  http_status integer,
  raw_manifest_sha256 creator_tracker_v2.sha256_hex,
  endpoint text,
  page_number integer,
  page_count integer,
  total_rows integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  requested_count integer;
BEGIN
  IF NOT pg_catalog.pg_has_role(
    session_user::name,
    'creator_tracker_v2_raw_verifier'::name,
    'MEMBER'
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'provider capture run proof requires raw-verifier role membership';
  END IF;

  IF requested_organization_id IS NULL
     OR pg_catalog.btrim(requested_organization_id) = ''
     OR requested_organization_id <> pg_catalog.btrim(requested_organization_id)
     OR pg_catalog.length(requested_organization_id) > 255 THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'requested organization ID is invalid';
  END IF;

  IF NOT creator_tracker_v2.has_tenant_access(
    requested_organization_id,
    'read'
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'provider capture run proof tenant access denied';
  END IF;

  requested_count := pg_catalog.cardinality(requested_producer_run_ids);
  IF requested_producer_run_ids IS NULL
     OR requested_count IS NULL
     OR requested_count < 1
     OR requested_count > 400
     OR pg_catalog.array_ndims(requested_producer_run_ids) <> 1
     OR pg_catalog.array_lower(requested_producer_run_ids, 1) <> 1 THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'requested producer run IDs must be a one-dimensional array of 1 to 400 values';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.unnest(requested_producer_run_ids) AS requested_id(value)
    WHERE requested_id.value IS NULL
       OR requested_id.value !~
         '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'requested producer run IDs must be canonical lowercase UUIDv4 values';
  END IF;

  IF (
    SELECT pg_catalog.count(*) <> pg_catalog.count(DISTINCT requested_id.value)
    FROM pg_catalog.unnest(requested_producer_run_ids) AS requested_id(value)
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'requested producer run IDs must be unique';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM creator_tracker_v2.raw_object_manifest_sets AS manifest_set
    JOIN pg_catalog.unnest(requested_producer_run_ids) AS requested_id(value)
      ON requested_id.value = manifest_set.producer_run_id
    WHERE manifest_set.organization_id = requested_organization_id
      AND manifest_set.purpose = 'provider_reconciliation'
    GROUP BY manifest_set.producer_run_id
    HAVING pg_catalog.count(*) > 1
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'provider producer run identity is ambiguous';
  END IF;

  RETURN QUERY
  WITH requested AS (
    SELECT requested_row.value AS requested_producer_run_id,
           requested_row.ordinal
    FROM pg_catalog.unnest(requested_producer_run_ids)
      WITH ORDINALITY AS requested_row(value, ordinal)
  )
  SELECT
    manifest_set.producer_run_id,
    tracking_run.id,
    tracking_run.ingestion_batch_id,
    ingestion_batch.idempotency_key,
    ingestion_batch.payload_sha256,
    ingestion_batch.status,
    ingestion_batch.item_count,
    ingestion_batch.observation_count,
    ingestion_batch.failure_count,
    tracking_run.adapter,
    tracking_run.adapter_version,
    tracking_run.request_id,
    pg_catalog.floor(
      extract(epoch FROM tracking_run.request_started_at) * 1000
    )::bigint,
    CASE
      WHEN tracking_run.response_received_at IS NULL THEN NULL
      ELSE pg_catalog.floor(
        extract(epoch FROM tracking_run.response_received_at) * 1000
      )::bigint
    END,
    pg_catalog.floor(
      extract(epoch FROM tracking_run.completed_at) * 1000
    )::bigint,
    tracking_run.status,
    tracking_run.completeness_reason,
    tracking_run.pages_expected,
    tracking_run.pages_fetched,
    tracking_run.items_expected,
    tracking_run.items_seen,
    tracking_run.items_written,
    tracking_run.http_status,
    tracking_run.raw_manifest_sha256,
    CASE
      WHEN pg_catalog.jsonb_typeof(tracking_run.error_detail -> 'endpoint') = 'string'
      THEN tracking_run.error_detail ->> 'endpoint'
      ELSE NULL
    END,
    CASE
      WHEN pg_catalog.jsonb_typeof(tracking_run.error_detail -> 'page') = 'number'
      THEN CASE
        WHEN tracking_run.error_detail ->> 'page' ~ '^-?(0|[1-9][0-9]{0,10})$'
        THEN CASE
          WHEN (tracking_run.error_detail ->> 'page')::numeric
            BETWEEN -2147483648 AND 2147483647
          THEN (tracking_run.error_detail ->> 'page')::integer
          ELSE NULL
        END
        ELSE NULL
      END
      ELSE NULL
    END,
    CASE
      WHEN pg_catalog.jsonb_typeof(tracking_run.error_detail -> 'pageCount') = 'number'
      THEN CASE
        WHEN tracking_run.error_detail ->> 'pageCount' ~ '^-?(0|[1-9][0-9]{0,10})$'
        THEN CASE
          WHEN (tracking_run.error_detail ->> 'pageCount')::numeric
            BETWEEN -2147483648 AND 2147483647
          THEN (tracking_run.error_detail ->> 'pageCount')::integer
          ELSE NULL
        END
        ELSE NULL
      END
      ELSE NULL
    END,
    CASE
      WHEN pg_catalog.jsonb_typeof(tracking_run.error_detail -> 'totalRows') = 'number'
      THEN CASE
        WHEN tracking_run.error_detail ->> 'totalRows' ~ '^-?(0|[1-9][0-9]{0,10})$'
        THEN CASE
          WHEN (tracking_run.error_detail ->> 'totalRows')::numeric
            BETWEEN -2147483648 AND 2147483647
          THEN (tracking_run.error_detail ->> 'totalRows')::integer
          ELSE NULL
        END
        ELSE NULL
      END
      ELSE NULL
    END
  FROM requested
  JOIN creator_tracker_v2.raw_object_manifest_sets AS manifest_set
    ON manifest_set.organization_id = requested_organization_id
   AND manifest_set.producer_run_id = requested.requested_producer_run_id
   AND manifest_set.purpose = 'provider_reconciliation'
  JOIN creator_tracker_v2.raw_object_manifests AS manifest
    ON manifest.organization_id = manifest_set.organization_id
   AND manifest.id = manifest_set.raw_manifest_id
   AND manifest.run_id = manifest_set.run_id
   AND manifest.source = 'viral_app_provider'
  JOIN creator_tracker_v2.tracking_runs AS tracking_run
    ON tracking_run.organization_id = manifest.organization_id
   AND tracking_run.id = manifest.run_id
   AND tracking_run.adapter = 'viral_app_provider'
  JOIN creator_tracker_v2.ingestion_batches AS ingestion_batch
    ON ingestion_batch.organization_id = tracking_run.organization_id
   AND ingestion_batch.id = tracking_run.ingestion_batch_id
  ORDER BY requested.ordinal;
END
$$;

REVOKE ALL PRIVILEGES ON FUNCTION
  creator_tracker_v2.raw_verifier_provider_capture_run_proof(text, text[])
FROM PUBLIC,
     creator_tracker_v2_reader,
     creator_tracker_v2_ingest,
     creator_tracker_v2_finalizer,
     creator_tracker_v2_settlement_locker;
GRANT EXECUTE ON FUNCTION
  creator_tracker_v2.raw_verifier_provider_capture_run_proof(text, text[])
TO creator_tracker_v2_raw_verifier;

COMMENT ON FUNCTION
  creator_tracker_v2.raw_verifier_provider_capture_run_proof(text, text[])
IS 'Bounded tenant-scoped proof of canonical provider page runs for the independent raw verifier; does not expose direct or legacy tracking rows.';

RESET ROLE;
REVOKE CREATE ON SCHEMA creator_tracker_v2
  FROM creator_tracker_v2_raw_proof_owner;

-- Reassert that the external verifier still has no direct central-run access.
REVOKE ALL PRIVILEGES ON TABLE creator_tracker_v2.tracking_runs,
                               creator_tracker_v2.ingestion_batches
  FROM creator_tracker_v2_raw_verifier;

COMMIT;
