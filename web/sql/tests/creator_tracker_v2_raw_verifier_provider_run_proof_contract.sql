\set ON_ERROR_STOP on

-- This contract runs after the base, recursive-verification, and producer-run
-- migrations in the disposable PostgreSQL 17 verifier. It proves the raw
-- verifier can obtain exact canonical provider-run proof without gaining a
-- direct read path to tracking_runs or ingestion_batches.

DO $$
DECLARE
  proof_function pg_catalog.pg_proc%ROWTYPE;
  proof_owner pg_catalog.pg_roles%ROWTYPE;
BEGIN
  SELECT function_row.* INTO proof_function
  FROM pg_catalog.pg_proc function_row
  JOIN pg_catalog.pg_namespace namespace_row
    ON namespace_row.oid = function_row.pronamespace
  WHERE namespace_row.nspname = 'creator_tracker_v2'
    AND function_row.proname = 'raw_verifier_provider_capture_run_proof'
    AND pg_catalog.pg_get_function_identity_arguments(function_row.oid) =
      'requested_organization_id text, requested_producer_run_ids text[]';

  IF proof_function.oid IS NULL
     OR NOT proof_function.prosecdef
     OR proof_function.provolatile <> 's'
     OR proof_function.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] THEN
    RAISE EXCEPTION 'provider run proof function is not stable, definer-owned, and search-path locked';
  END IF;

  SELECT role_row.* INTO proof_owner
  FROM pg_catalog.pg_roles role_row
  WHERE role_row.rolname = 'creator_tracker_v2_raw_proof_owner';

  IF proof_owner.oid IS NULL
     OR proof_owner.rolcanlogin
     OR proof_owner.rolinherit
     OR proof_owner.rolsuper
     OR proof_owner.rolcreatedb
     OR proof_owner.rolcreaterole
     OR proof_owner.rolreplication
     OR proof_owner.rolbypassrls
     OR proof_function.proowner <> proof_owner.oid THEN
    RAISE EXCEPTION 'provider run proof owner is missing, overprivileged, or does not own the function';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_auth_members membership
    WHERE membership.member = proof_owner.oid
  ) THEN
    RAISE EXCEPTION 'provider run proof owner must remain a leaf role';
  END IF;

  IF pg_catalog.has_schema_privilege(
       'creator_tracker_v2_raw_proof_owner', 'creator_tracker_v2', 'CREATE'
     ) THEN
    RAISE EXCEPTION 'provider run proof owner retained schema create privilege';
  END IF;

  IF NOT pg_catalog.has_function_privilege(
       'creator_tracker_v2_raw_verifier', proof_function.oid, 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege('public', proof_function.oid, 'EXECUTE')
     OR pg_catalog.has_function_privilege(
       'creator_tracker_v2_reader', proof_function.oid, 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'creator_tracker_v2_ingest', proof_function.oid, 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'creator_tracker_v2_finalizer', proof_function.oid, 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'creator_tracker_v2_settlement_locker', proof_function.oid, 'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'provider run proof execute grant is broader than the raw verifier';
  END IF;

  IF pg_catalog.has_table_privilege(
       'creator_tracker_v2_raw_verifier',
       'creator_tracker_v2.tracking_runs',
       'SELECT'
     )
     OR pg_catalog.has_table_privilege(
       'creator_tracker_v2_raw_verifier',
       'creator_tracker_v2.ingestion_batches',
       'SELECT'
     ) THEN
    RAISE EXCEPTION 'raw verifier gained direct central-run table access';
  END IF;
END
$$;

SET SESSION AUTHORIZATION ctv2_contract_ingest;

INSERT INTO creator_tracker_v2.ingestion_batches (
  id, organization_id, idempotency_key, source, collector_instance_id,
  schema_version, payload_sha256, status, received_at, accepted_at,
  item_count, observation_count, failure_count
)
VALUES (
  '01890f1a-0000-7000-8000-000000000026', 'ctv2_contract_org_a',
  'gotall-viral-dash:provider-page-batch:550e8400-e29b-41d4-a716-446655440007:'
    || repeat('e', 64),
  'viral_app_provider', 'laptop-provider', 2, repeat('c', 64), 'accepted',
  '2026-08-30T00:05:04Z', '2026-08-30T00:05:04.001Z', 7, 5, 2
);

INSERT INTO creator_tracker_v2.tracking_runs (
  id, organization_id, ingestion_batch_id, worker_id, adapter,
  adapter_version, request_id, request_started_at, response_received_at,
  completed_at, status, completeness_reason, pages_expected, pages_fetched,
  items_expected, items_seen, items_written, http_status, error_detail,
  raw_manifest_sha256
)
VALUES (
  '01890f1a-0000-7000-8000-000000000035', 'ctv2_contract_org_a',
  '01890f1a-0000-7000-8000-000000000026', 'laptop-provider',
  'viral_app_provider', 'viral-app-provider-page-v1',
  'gotall-viral-dash:provider-page:550e8400-e29b-41d4-a716-446655440007',
  '2026-08-30T00:05:00.123456Z', '2026-08-30T00:05:02.654321Z',
  '2026-08-30T00:05:03.999999Z', 'complete', NULL,
  1, 1, 43, 43, 43, 200,
  jsonb_build_object(
    'producerRunId', '550e8400-e29b-41d4-a716-446655440007',
    'endpoint', '/videos',
    'page', 2,
    'pageCount', 3,
    'totalRows', 243
  ),
  repeat('e', 64)
);

INSERT INTO creator_tracker_v2.raw_object_manifests (
  id, organization_id, run_id, source, endpoint, storage_key, sha256,
  byte_length, content_type, source_observed_at, fetched_at, retention_class,
  retain_until
)
VALUES (
  '01890f1a-0000-7000-8000-000000000057', 'ctv2_contract_org_a',
  '01890f1a-0000-7000-8000-000000000035', 'viral_app_provider',
  'https://api.viral.app/videos?page=2',
  'creator-tracker/raw/v1/sha256/ee/' || repeat('e', 64), repeat('e', 64),
  111, 'application/json', '2026-08-30T00:05:02.654Z',
  '2026-08-30T00:05:03.999Z', 'operational', '2026-11-30T00:05:04Z'
);

INSERT INTO creator_tracker_v2.raw_object_manifest_sets (
  raw_manifest_id, organization_id, run_id, producer_run_id, store_version,
  purpose, response_count, total_response_bytes, sealed
)
VALUES (
  '01890f1a-0000-7000-8000-000000000057', 'ctv2_contract_org_a',
  '01890f1a-0000-7000-8000-000000000035',
  '550e8400-e29b-41d4-a716-446655440007', 1,
  'provider_reconciliation', 1, 59, true
);

INSERT INTO creator_tracker_v2.raw_object_manifest_entries (
  id, organization_id, raw_manifest_id, run_id, ordinal, adapter,
  request_kind, source_observed_at_ms, media_type, storage_key, sha256,
  byte_length
)
VALUES (
  '01890f1a-0000-7000-8000-0000000000e6', 'ctv2_contract_org_a',
  '01890f1a-0000-7000-8000-000000000057',
  '01890f1a-0000-7000-8000-000000000035', 0, 'viral_app_provider',
  'provider_videos_page', 1788048302654, 'application/json',
  'creator-tracker/raw/v1/sha256/ff/' || repeat('f', 64), repeat('f', 64), 59
);

RESET SESSION AUTHORIZATION;
SET SESSION AUTHORIZATION ctv2_contract_raw_verifier;

SELECT creator_tracker_v2_contract.expect_error(
  'SELECT count(*) FROM creator_tracker_v2.tracking_runs',
  '42501',
  'permission denied'
);
SELECT creator_tracker_v2_contract.expect_error(
  'SELECT count(*) FROM creator_tracker_v2.ingestion_batches',
  '42501',
  'permission denied'
);

SELECT creator_tracker_v2_contract.assert_true(
  (
    SELECT count(*) = 1
    FROM creator_tracker_v2.raw_verifier_provider_capture_run_proof(
      'ctv2_contract_org_a',
      ARRAY['550e8400-e29b-41d4-a716-446655440007']
    )
  ),
  'explicit provider producer run must resolve to exactly one canonical proof row'
);

SELECT creator_tracker_v2_contract.assert_true(
  (
    SELECT
      proof.producer_run_id = '550e8400-e29b-41d4-a716-446655440007'
      AND proof.canonical_run_id::text = '01890f1a-0000-7000-8000-000000000035'
      AND proof.ingestion_batch_id::text = '01890f1a-0000-7000-8000-000000000026'
      AND proof.batch_idempotency_key =
        'gotall-viral-dash:provider-page-batch:550e8400-e29b-41d4-a716-446655440007:'
          || repeat('e', 64)
      AND proof.batch_payload_sha256::text = repeat('c', 64)
      AND proof.batch_status::text = 'accepted'
      AND proof.batch_item_count = 7
      AND proof.batch_observation_count = 5
      AND proof.batch_failure_count = 2
      AND proof.adapter = 'viral_app_provider'
      AND proof.adapter_version = 'viral-app-provider-page-v1'
      AND proof.request_id =
        'gotall-viral-dash:provider-page:550e8400-e29b-41d4-a716-446655440007'
      AND proof.request_started_at_ms = 1788048300123
      AND proof.response_received_at_ms = 1788048302654
      AND proof.completed_at_ms = 1788048303999
      AND proof.run_status::text = 'complete'
      AND proof.completeness_reason IS NULL
      AND proof.pages_expected = 1
      AND proof.pages_fetched = 1
      AND proof.items_expected = 43
      AND proof.items_seen = 43
      AND proof.items_written = 43
      AND proof.http_status = 200
      AND proof.raw_manifest_sha256::text = repeat('e', 64)
      AND proof.endpoint = '/videos'
      AND proof.page_number = 2
      AND proof.page_count = 3
      AND proof.total_rows = 243
    FROM creator_tracker_v2.raw_verifier_provider_capture_run_proof(
      'ctv2_contract_org_a',
      ARRAY['550e8400-e29b-41d4-a716-446655440007']
    ) AS proof
  ),
  'provider run proof must preserve every canonical identity, count, status, timestamp, and page field'
);

SELECT creator_tracker_v2_contract.assert_true(
  (
    SELECT pg_catalog.array_agg(proof.producer_run_id ORDER BY proof.ordinality) =
      ARRAY[
        '550e8400-e29b-41d4-a716-446655440007',
        '550e8400-e29b-41d4-a716-446655440006'
      ]
    FROM creator_tracker_v2.raw_verifier_provider_capture_run_proof(
      'ctv2_contract_org_a',
      ARRAY[
        '550e8400-e29b-41d4-a716-446655440007',
        '550e8400-e29b-41d4-a716-446655440006'
      ]
    ) WITH ORDINALITY AS proof(
      producer_run_id, canonical_run_id, ingestion_batch_id,
      batch_idempotency_key, batch_payload_sha256, batch_status,
      batch_item_count, batch_observation_count, batch_failure_count, adapter,
      adapter_version, request_id, request_started_at_ms,
      response_received_at_ms, completed_at_ms, run_status,
      completeness_reason, pages_expected, pages_fetched, items_expected,
      items_seen, items_written, http_status, raw_manifest_sha256, endpoint,
      page_number, page_count, total_rows, ordinality
    )
  ),
  'proof rows must preserve the caller requested producer-run order'
);

-- The older provider fixture deliberately carries no page metadata. The proof
-- function surfaces null rather than manufacturing a value for the app to
-- accept.
SELECT creator_tracker_v2_contract.assert_true(
  (
    SELECT proof.endpoint IS NULL
       AND proof.page_number IS NULL
       AND proof.page_count IS NULL
       AND proof.total_rows IS NULL
    FROM creator_tracker_v2.raw_verifier_provider_capture_run_proof(
      'ctv2_contract_org_a',
      ARRAY['550e8400-e29b-41d4-a716-446655440006']
    ) AS proof
  ),
  'missing page metadata must remain null for fail-closed app validation'
);

SELECT creator_tracker_v2_contract.assert_true(
  (
    SELECT count(*) = 0
    FROM creator_tracker_v2.raw_verifier_provider_capture_run_proof(
      'ctv2_contract_org_a',
      ARRAY['550e8400-e29b-41d4-a716-446655440001']
    )
  ),
  'direct native producer runs must not be exposed by the provider proof contract'
);

SELECT creator_tracker_v2_contract.expect_error(
  $sql$
    SELECT *
    FROM creator_tracker_v2.raw_verifier_provider_capture_run_proof(
      'ctv2_contract_org_b',
      ARRAY['550e8400-e29b-41d4-a716-446655440007']
    )
  $sql$,
  '42501',
  'tenant access denied'
);
SELECT creator_tracker_v2_contract.expect_error(
  $sql$
    SELECT *
    FROM creator_tracker_v2.raw_verifier_provider_capture_run_proof(
      'ctv2_contract_org_a', NULL::text[]
    )
  $sql$,
  '22023',
  '1 to 400'
);
SELECT creator_tracker_v2_contract.expect_error(
  $sql$
    SELECT *
    FROM creator_tracker_v2.raw_verifier_provider_capture_run_proof(
      'ctv2_contract_org_a', ARRAY[]::text[]
    )
  $sql$,
  '22023',
  '1 to 400'
);
SELECT creator_tracker_v2_contract.expect_error(
  $sql$
    SELECT *
    FROM creator_tracker_v2.raw_verifier_provider_capture_run_proof(
      'ctv2_contract_org_a',
      pg_catalog.array_fill(
        '550e8400-e29b-41d4-a716-446655440007'::text,
        ARRAY[401]
      )
    )
  $sql$,
  '22023',
  '1 to 400'
);
SELECT creator_tracker_v2_contract.expect_error(
  $sql$
    SELECT *
    FROM creator_tracker_v2.raw_verifier_provider_capture_run_proof(
      'ctv2_contract_org_a',
      ARRAY[
        '550e8400-e29b-41d4-a716-446655440007',
        '550e8400-e29b-41d4-a716-446655440007'
      ]
    )
  $sql$,
  '22023',
  'must be unique'
);
SELECT creator_tracker_v2_contract.expect_error(
  $sql$
    SELECT *
    FROM creator_tracker_v2.raw_verifier_provider_capture_run_proof(
      'ctv2_contract_org_a',
      ARRAY['550E8400-E29B-41D4-A716-446655440007']
    )
  $sql$,
  '22023',
  'canonical lowercase UUIDv4'
);
SELECT creator_tracker_v2_contract.expect_error(
  $sql$
    SELECT *
    FROM creator_tracker_v2.raw_verifier_provider_capture_run_proof(
      'ctv2_contract_org_a',
      ARRAY[['550e8400-e29b-41d4-a716-446655440007']]
    )
  $sql$,
  '22023',
  'one-dimensional'
);

-- SET ROLE must not change which login the tenant gate evaluates.
SET ROLE creator_tracker_v2_raw_verifier;
SELECT 1 / (count(*) = 1)::integer AS set_role_keeps_raw_verifier_session_tenant
FROM creator_tracker_v2.raw_verifier_provider_capture_run_proof(
  'ctv2_contract_org_a',
  ARRAY['550e8400-e29b-41d4-a716-446655440007']
);
RESET ROLE;
RESET SESSION AUTHORIZATION;

SET SESSION AUTHORIZATION ctv2_contract_reader;
SELECT creator_tracker_v2_contract.expect_error(
  $sql$
    SELECT *
    FROM creator_tracker_v2.raw_verifier_provider_capture_run_proof(
      'ctv2_contract_org_a',
      ARRAY['550e8400-e29b-41d4-a716-446655440007']
    )
  $sql$,
  '42501',
  'permission denied'
);
RESET SESSION AUTHORIZATION;

\echo 'creator_tracker_v2 raw-verifier provider-run proof PostgreSQL contract passed'
