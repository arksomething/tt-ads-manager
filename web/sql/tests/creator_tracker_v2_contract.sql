\set ON_ERROR_STOP on

-- This contract runs only against the disposable PostgreSQL instance created by
-- scripts/verify-creator-tracker-v2-migration.sh. It deliberately exercises the
-- real PostgreSQL parser, catalogs, privileges, RLS policies, foreign keys, and
-- triggers instead of treating SQL text matching as migration verification.

CREATE SCHEMA creator_tracker_v2_contract;

CREATE FUNCTION creator_tracker_v2_contract.assert_true(
  condition boolean,
  failure_message text
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF condition IS DISTINCT FROM true THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = failure_message;
  END IF;
END
$$;

CREATE FUNCTION creator_tracker_v2_contract.expect_error(
  statement text,
  expected_sqlstate text,
  expected_message_fragment text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  actual_sqlstate text;
  actual_message text;
BEGIN
  BEGIN
    EXECUTE statement;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS
      actual_sqlstate = RETURNED_SQLSTATE,
      actual_message = MESSAGE_TEXT;

    IF actual_sqlstate <> expected_sqlstate THEN
      RAISE EXCEPTION USING
        ERRCODE = 'P0001',
        MESSAGE = format(
          'expected SQLSTATE %s but got %s from %s: %s',
          expected_sqlstate,
          actual_sqlstate,
          statement,
          actual_message
        );
    END IF;

    IF expected_message_fragment IS NOT NULL
       AND position(expected_message_fragment IN actual_message) = 0 THEN
      RAISE EXCEPTION USING
        ERRCODE = 'P0001',
        MESSAGE = format(
          'expected error containing %L from %s, got: %s',
          expected_message_fragment,
          statement,
          actual_message
        );
    END IF;

    RETURN;
  END;

  RAISE EXCEPTION USING
    ERRCODE = 'P0001',
    MESSAGE = format('expected SQLSTATE %s but statement succeeded: %s', expected_sqlstate, statement);
END
$$;

DO $$
DECLARE
  expected_tables text[] := ARRAY[
    'account_handle_history',
    'creator_platform_accounts',
    'creators',
    'ingestion_batches',
    'raw_object_manifests',
    'role_tenant_grants',
    'source_coverage_windows',
    'tracking_failures',
    'tracking_runs',
    'video_observations',
    'video_window_finalization_locks',
    'video_window_finalizations',
    'videos'
  ];
  actual_tables text[];
  capability_role text;
BEGIN
  IF current_setting('server_version_num')::integer < 170000 THEN
    RAISE EXCEPTION 'contract requires PostgreSQL 17 or newer';
  END IF;

  SELECT array_agg(table_name ORDER BY table_name)
  INTO actual_tables
  FROM information_schema.tables
  WHERE table_schema = 'creator_tracker_v2'
    AND table_type = 'BASE TABLE';

  IF actual_tables IS DISTINCT FROM expected_tables THEN
    RAISE EXCEPTION 'unexpected V2 table contract: expected %, got %', expected_tables, actual_tables;
  END IF;

  IF (
    SELECT count(*)
    FROM pg_catalog.pg_class relation
    JOIN pg_catalog.pg_namespace namespace_row ON namespace_row.oid = relation.relnamespace
    WHERE namespace_row.nspname = 'creator_tracker_v2'
      AND relation.relkind = 'r'
      AND relation.relname <> 'role_tenant_grants'
      AND relation.relrowsecurity
      AND relation.relforcerowsecurity
  ) <> 12 THEN
    RAISE EXCEPTION 'all twelve tenant data tables must have enabled and forced RLS';
  END IF;

  IF NOT (
    SELECT relation.relrowsecurity
    FROM pg_catalog.pg_class relation
    JOIN pg_catalog.pg_namespace namespace_row ON namespace_row.oid = relation.relnamespace
    WHERE namespace_row.nspname = 'creator_tracker_v2'
      AND relation.relname = 'role_tenant_grants'
  ) THEN
    RAISE EXCEPTION 'the role tenant grant map must have RLS enabled';
  END IF;

  FOREACH capability_role IN ARRAY ARRAY[
    'creator_tracker_v2_reader',
    'creator_tracker_v2_ingest',
    'creator_tracker_v2_finalizer',
    'creator_tracker_v2_settlement_locker'
  ]
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_roles
      WHERE rolname = capability_role
        AND NOT rolcanlogin
        AND NOT rolsuper
        AND NOT rolcreatedb
        AND NOT rolcreaterole
        AND NOT rolinherit
        AND NOT rolreplication
        AND NOT rolbypassrls
    ) THEN
      RAISE EXCEPTION 'capability role % is missing or overprivileged', capability_role;
    END IF;

    IF has_table_privilege(
      capability_role,
      'public."Organization"',
      'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
    ) THEN
      RAISE EXCEPTION 'capability role % can reach a legacy public table', capability_role;
    END IF;

    IF has_table_privilege(
      capability_role,
      'creator_tracker_v2.role_tenant_grants',
      'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
    ) THEN
      RAISE EXCEPTION 'capability role % can read or mutate the admin grant map', capability_role;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_auth_members membership
    JOIN pg_catalog.pg_roles member_role ON member_role.oid = membership.member
    WHERE member_role.rolname IN (
      'creator_tracker_v2_reader',
      'creator_tracker_v2_ingest',
      'creator_tracker_v2_finalizer',
      'creator_tracker_v2_settlement_locker'
    )
  ) THEN
    RAISE EXCEPTION 'capability roles must remain leaf roles';
  END IF;

  IF has_schema_privilege('public', 'creator_tracker_v2', 'USAGE') THEN
    RAISE EXCEPTION 'PUBLIC must not have access to the V2 schema';
  END IF;
END
$$;

INSERT INTO public."Organization" (id)
VALUES ('ctv2_contract_org_a'), ('ctv2_contract_org_b');

CREATE ROLE ctv2_contract_ingest LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE ctv2_contract_reader LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE ctv2_contract_finalizer LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE ctv2_contract_locker LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;

GRANT creator_tracker_v2_ingest TO ctv2_contract_ingest;
GRANT creator_tracker_v2_reader TO ctv2_contract_reader;
GRANT creator_tracker_v2_finalizer TO ctv2_contract_finalizer;
GRANT creator_tracker_v2_settlement_locker TO ctv2_contract_locker;

GRANT USAGE ON SCHEMA creator_tracker_v2_contract
TO ctv2_contract_ingest, ctv2_contract_reader, ctv2_contract_finalizer, ctv2_contract_locker;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA creator_tracker_v2_contract
TO ctv2_contract_ingest, ctv2_contract_reader, ctv2_contract_finalizer, ctv2_contract_locker;

INSERT INTO creator_tracker_v2.role_tenant_grants (
  database_role,
  organization_id,
  can_read,
  can_ingest,
  can_finalize,
  can_lock
)
VALUES
  ('ctv2_contract_ingest', 'ctv2_contract_org_a', true, true, false, false),
  ('ctv2_contract_reader', 'ctv2_contract_org_a', true, false, false, false),
  ('ctv2_contract_finalizer', 'ctv2_contract_org_a', true, false, true, false),
  ('ctv2_contract_locker', 'ctv2_contract_org_a', true, false, false, true);

SELECT creator_tracker_v2_contract.expect_error(
  $sql$
    UPDATE creator_tracker_v2.role_tenant_grants
    SET can_read = false
    WHERE database_role = 'ctv2_contract_ingest'
      AND organization_id = 'ctv2_contract_org_a'
  $sql$,
  '23514',
  'role_tenant_grants_derived_capabilities_need_read_ck'
);

SELECT creator_tracker_v2_contract.expect_error(
  $sql$
    INSERT INTO creator_tracker_v2.role_tenant_grants (
      database_role, organization_id, can_read, can_ingest
    ) VALUES ('creator_tracker_v2_ingest', 'ctv2_contract_org_a', true, true)
  $sql$,
  '23514',
  'concrete, inheriting, non-superuser login'
);

INSERT INTO creator_tracker_v2.creators (
  id, organization_id, legacy_creator_id, display_name
)
VALUES (
  '01890f1a-0000-7000-8000-000000000003',
  'ctv2_contract_org_b',
  'legacy-b',
  'Tenant B creator'
);

SELECT creator_tracker_v2_contract.expect_error(
  $sql$
    INSERT INTO creator_tracker_v2.creators (
      id, organization_id, display_name
    ) VALUES (
      '01890f1a-0000-4000-8000-000000000099',
      'ctv2_contract_org_a',
      'not uuid v7'
    )
  $sql$,
  '23514',
  'uuid_v7_check'
);

SET SESSION AUTHORIZATION ctv2_contract_ingest;

SELECT creator_tracker_v2_contract.assert_true(
  creator_tracker_v2.has_tenant_access('ctv2_contract_org_a', 'ingest'),
  'ingest login must have its explicit tenant capability'
);
SELECT creator_tracker_v2_contract.assert_true(
  NOT creator_tracker_v2.has_tenant_access('ctv2_contract_org_b', 'ingest'),
  'ingest login must not inherit access to another tenant'
);
SET ROLE creator_tracker_v2_ingest;
-- False becomes division by zero, so this statement is a hard assertion while
-- the shared capability role intentionally has no access to test helpers.
SELECT 1 / creator_tracker_v2.has_tenant_access(
  'ctv2_contract_org_a',
  'ingest'
)::integer AS set_role_keeps_login_tenant;
RESET ROLE;
SELECT creator_tracker_v2_contract.assert_true(
  (SELECT count(*) = 0 FROM creator_tracker_v2.creators),
  'tenant A ingestion must not see tenant B rows'
);

SELECT creator_tracker_v2_contract.expect_error(
  $sql$
    INSERT INTO creator_tracker_v2.creators (
      id, organization_id, display_name
    ) VALUES (
      '01890f1a-0000-7000-8000-000000000004',
      'ctv2_contract_org_b',
      'cross tenant write'
    )
  $sql$,
  '42501',
  'row-level security policy'
);

INSERT INTO creator_tracker_v2.ingestion_batches (
  id, organization_id, idempotency_key, source, collector_instance_id,
  schema_version, payload_sha256, status, received_at, accepted_at,
  item_count, observation_count
)
VALUES
  (
    '01890f1a-0000-7000-8000-000000000021', 'ctv2_contract_org_a',
    'contract-batch-baseline', 'tiktok_ytdlp', 'contract-worker', 1,
    repeat('a', 64), 'accepted', '2026-08-22T23:57:00Z', '2026-08-22T23:57:01Z', 1, 1
  ),
  (
    '01890f1a-0000-7000-8000-000000000022', 'ctv2_contract_org_a',
    'contract-batch-cutoff', 'tiktok_ytdlp', 'contract-worker', 1,
    repeat('b', 64), 'accepted', '2026-08-29T23:59:00Z', '2026-08-29T23:59:01Z', 1, 1
  ),
  (
    '01890f1a-0000-7000-8000-000000000023', 'ctv2_contract_org_a',
    'contract-batch-partial', 'tiktok_ytdlp', 'contract-worker', 1,
    repeat('c', 64), 'accepted', '2026-08-30T00:09:00Z', '2026-08-30T00:09:01Z', 0, 0
  );

SELECT creator_tracker_v2_contract.expect_error(
  $sql$
    INSERT INTO creator_tracker_v2.ingestion_batches (
      id, organization_id, idempotency_key, source, collector_instance_id,
      schema_version, payload_sha256, status, received_at, accepted_at
    ) VALUES (
      '01890f1a-0000-7000-8000-000000000024', 'ctv2_contract_org_a',
      'contract-batch-baseline', 'tiktok_ytdlp', 'contract-worker', 1,
      repeat('d', 64), 'accepted', '2026-08-30T00:10:00Z', '2026-08-30T00:10:01Z'
    )
  $sql$,
  '23505',
  'ingestion_batches_idempotency_uq'
);

INSERT INTO creator_tracker_v2.tracking_runs (
  id, organization_id, ingestion_batch_id, worker_id, adapter, adapter_version,
  request_id, request_started_at, response_received_at, completed_at, status,
  completeness_reason, pages_expected, pages_fetched, items_expected, items_seen, items_written
)
VALUES
  (
    '01890f1a-0000-7000-8000-000000000031', 'ctv2_contract_org_a',
    '01890f1a-0000-7000-8000-000000000021', 'contract-worker', 'tiktok_ytdlp', '2026.08.19',
    'contract-run-baseline', '2026-08-22T23:58:00Z', '2026-08-23T00:00:30Z',
    '2026-08-23T00:01:00Z', 'complete', NULL, 1, 1, 1, 1, 1
  ),
  (
    '01890f1a-0000-7000-8000-000000000032', 'ctv2_contract_org_a',
    '01890f1a-0000-7000-8000-000000000022', 'contract-worker', 'tiktok_ytdlp', '2026.08.19',
    'contract-run-cutoff', '2026-08-29T23:59:30Z', '2026-08-30T00:02:30Z',
    '2026-08-30T00:03:00Z', 'complete', NULL, 1, 1, 1, 1, 1
  ),
  (
    '01890f1a-0000-7000-8000-000000000033', 'ctv2_contract_org_a',
    '01890f1a-0000-7000-8000-000000000023', 'contract-worker', 'tiktok_ytdlp', '2026.08.19',
    'contract-run-partial', '2026-08-30T00:09:30Z', '2026-08-30T00:10:30Z',
    '2026-08-30T00:11:00Z', 'partial', 'rate limited before enumeration completed', 2, 1, 2, 1, 0
  );

INSERT INTO creator_tracker_v2.creators (
  id, organization_id, legacy_creator_id, display_name
)
VALUES
  ('01890f1a-0000-7000-8000-000000000001', 'ctv2_contract_org_a', 'legacy-a-1', 'Creator A1'),
  ('01890f1a-0000-7000-8000-000000000002', 'ctv2_contract_org_a', 'legacy-a-2', 'Creator A2');

INSERT INTO creator_tracker_v2.creator_platform_accounts (
  id, organization_id, creator_id, platform, native_account_id, current_handle,
  tracking_state, first_seen_at
)
VALUES
  (
    '01890f1a-0000-7000-8000-000000000011', 'ctv2_contract_org_a',
    '01890f1a-0000-7000-8000-000000000001', 'tiktok', 'native-account-a1',
    'creator_a1', 'active', '2026-08-23T00:00:00Z'
  ),
  (
    '01890f1a-0000-7000-8000-000000000012', 'ctv2_contract_org_a',
    '01890f1a-0000-7000-8000-000000000002', 'tiktok', 'native-account-a2',
    'creator_a2', 'active', '2026-08-23T00:00:00Z'
  );

INSERT INTO creator_tracker_v2.videos (
  id, organization_id, creator_id, account_id, platform, native_video_id,
  published_at, published_at_source, published_at_confidence,
  first_seen_at, last_seen_at, first_seen_run_id, availability
)
VALUES (
  '01890f1a-0000-7000-8000-000000000041', 'ctv2_contract_org_a',
  '01890f1a-0000-7000-8000-000000000001',
  '01890f1a-0000-7000-8000-000000000011', 'tiktok', 'native-video-a1',
  '2026-08-23T00:00:00Z', 'platform', 'verified',
  '2026-08-23T00:00:00Z', '2026-08-30T00:02:00Z',
  '01890f1a-0000-7000-8000-000000000031', 'available'
);

SELECT creator_tracker_v2_contract.expect_error(
  $sql$
    INSERT INTO creator_tracker_v2.videos (
      id, organization_id, creator_id, account_id, platform, native_video_id,
      first_seen_at, last_seen_at, first_seen_run_id
    ) VALUES (
      '01890f1a-0000-7000-8000-000000000042', 'ctv2_contract_org_a',
      '01890f1a-0000-7000-8000-000000000002',
      '01890f1a-0000-7000-8000-000000000011', 'tiktok', 'mismatched-owner-video',
      '2026-08-23T00:00:00Z', '2026-08-23T00:00:00Z',
      '01890f1a-0000-7000-8000-000000000031'
    )
  $sql$,
  '23503',
  'videos_account_creator_platform_fk'
);

INSERT INTO creator_tracker_v2.raw_object_manifests (
  id, organization_id, run_id, source, storage_key, sha256, byte_length,
  content_type, source_observed_at, fetched_at, retention_class, retain_until
)
VALUES
  (
    '01890f1a-0000-7000-8000-000000000051', 'ctv2_contract_org_a',
    '01890f1a-0000-7000-8000-000000000031', 'tiktok_ytdlp',
    'creator-tracker/raw/v1/sha256/11/' || repeat('1', 64), repeat('1', 64), 128, 'application/json',
    '2026-08-23T00:00:30Z', '2026-08-23T00:00:30Z', 'contract', '2033-08-23T00:00:30Z'
  ),
  (
    '01890f1a-0000-7000-8000-000000000052', 'ctv2_contract_org_a',
    '01890f1a-0000-7000-8000-000000000032', 'tiktok_ytdlp',
    'creator-tracker/raw/v1/sha256/22/' || repeat('2', 64), repeat('2', 64), 128, 'application/json',
    '2026-08-30T00:02:30Z', '2026-08-30T00:02:30Z', 'contract', '2033-08-30T00:02:30Z'
  );

INSERT INTO creator_tracker_v2.video_observations (
  id, organization_id, video_id, run_id, adapter, metric_schema_version,
  request_started_at, observed_at, views, likes, comments, shares, saves,
  availability, is_complete, confidence, raw_manifest_id, idempotency_key
)
VALUES
  (
    '01890f1a-0000-7000-8000-000000000061', 'ctv2_contract_org_a',
    '01890f1a-0000-7000-8000-000000000041',
    '01890f1a-0000-7000-8000-000000000031', 'tiktok_ytdlp', 1,
    '2026-08-22T23:59:00Z', '2026-08-23T00:00:00Z', 100, 10, 1, 1, 0,
    'available', true, 'direct', '01890f1a-0000-7000-8000-000000000051',
    'contract-observation-baseline'
  ),
  (
    '01890f1a-0000-7000-8000-000000000062', 'ctv2_contract_org_a',
    '01890f1a-0000-7000-8000-000000000041',
    '01890f1a-0000-7000-8000-000000000032', 'tiktok_ytdlp', 1,
    '2026-08-29T23:59:30Z', '2026-08-30T00:02:00Z', 1000, 100, 10, 10, 5,
    'available', true, 'direct', '01890f1a-0000-7000-8000-000000000052',
    'contract-observation-cutoff'
  );

SELECT creator_tracker_v2_contract.expect_error(
  $sql$
    INSERT INTO creator_tracker_v2.video_observations (
      id, organization_id, video_id, run_id, adapter, metric_schema_version,
      request_started_at, observed_at, views, availability, is_complete,
      confidence, idempotency_key
    ) VALUES (
      '01890f1a-0000-7000-8000-000000000063', 'ctv2_contract_org_a',
      '01890f1a-0000-7000-8000-000000000041',
      '01890f1a-0000-7000-8000-000000000032', 'scrapecreators', 1,
      '2026-08-29T23:59:30Z', '2026-08-30T00:02:00Z', 1000,
      'available', true, 'provider', 'contract-observation-wrong-adapter'
    )
  $sql$,
  '23514',
  'match its run adapter'
);

INSERT INTO creator_tracker_v2.account_handle_history (
  id, organization_id, account_id, handle, valid_from, source_run_id, is_verified
)
VALUES (
  '01890f1a-0000-7000-8000-000000000071', 'ctv2_contract_org_a',
  '01890f1a-0000-7000-8000-000000000011', 'creator_a1',
  '2026-08-23T00:00:00Z', '01890f1a-0000-7000-8000-000000000031', true
);

UPDATE creator_tracker_v2.account_handle_history
SET valid_to = '2026-08-29T00:00:00Z'
WHERE id = '01890f1a-0000-7000-8000-000000000071';

INSERT INTO creator_tracker_v2.account_handle_history (
  id, organization_id, account_id, handle, valid_from, source_run_id, is_verified
)
VALUES (
  '01890f1a-0000-7000-8000-000000000072', 'ctv2_contract_org_a',
  '01890f1a-0000-7000-8000-000000000011', 'creator_a1_new',
  '2026-08-29T00:00:00Z', '01890f1a-0000-7000-8000-000000000032', true
);

SELECT creator_tracker_v2_contract.expect_error(
  $sql$
    INSERT INTO creator_tracker_v2.account_handle_history (
      id, organization_id, account_id, handle, valid_from, valid_to,
      source_run_id, is_verified
    ) VALUES (
      '01890f1a-0000-7000-8000-000000000073', 'ctv2_contract_org_a',
      '01890f1a-0000-7000-8000-000000000011', 'overlap',
      '2026-08-28T00:00:00Z', '2026-08-30T00:00:00Z',
      '01890f1a-0000-7000-8000-000000000032', true
    )
  $sql$,
  '23P01',
  'may not overlap'
);

SELECT creator_tracker_v2_contract.expect_error(
  $sql$
    INSERT INTO creator_tracker_v2.source_coverage_windows (
      id, organization_id, platform, source, window_start, window_end, run_id,
      status, expected_count, discovered_count, observed_count,
      computed_at, evidence_sha256, idempotency_key
    ) VALUES (
      '01890f1a-0000-7000-8000-000000000083', 'ctv2_contract_org_a', 'tiktok',
      'tiktok_ytdlp', '2026-08-23T00:00:00Z', '2026-08-30T00:10:00Z',
      '01890f1a-0000-7000-8000-000000000033', 'complete', 1, 1, 1,
      '2026-08-30T00:12:00Z', repeat('3', 64), 'contract-coverage-partial-run'
    )
  $sql$,
  '23514',
  'complete tracking run'
);

INSERT INTO creator_tracker_v2.source_coverage_windows (
  id, organization_id, platform, account_id, source, window_start, window_end,
  run_id, status, expected_count, discovered_count, observed_count,
  pages_expected, pages_fetched, computed_at, evidence_sha256, idempotency_key
)
VALUES
  (
    '01890f1a-0000-7000-8000-000000000081', 'ctv2_contract_org_a', 'tiktok',
    '01890f1a-0000-7000-8000-000000000011', 'tiktok_ytdlp',
    '2026-08-23T00:00:00Z', '2026-08-30T00:00:00Z',
    '01890f1a-0000-7000-8000-000000000032', 'complete', 1, 1, 1, 1, 1,
    '2026-08-30T00:03:00Z', repeat('4', 64), 'contract-coverage-valid'
  ),
  (
    '01890f1a-0000-7000-8000-000000000082', 'ctv2_contract_org_a', 'instagram',
    NULL, 'tiktok_ytdlp', '2026-08-23T00:00:00Z', '2026-08-30T00:00:00Z',
    '01890f1a-0000-7000-8000-000000000032', 'complete', 1, 1, 1, 1, 1,
    '2026-08-30T00:03:00Z', repeat('5', 64), 'contract-coverage-wrong-platform'
  );

SELECT creator_tracker_v2_contract.expect_error(
  $sql$
    INSERT INTO creator_tracker_v2.video_window_finalizations (
      id, organization_id, video_id, policy_type, policy_version, window_start,
      cutoff_at, baseline_observation_id, baseline_at,
      post_cutoff_observation_id, selected_final_observation_id,
      cutoff_slippage_seconds, gross_views, paid_views, eligible_views,
      coverage_id, status, calculation_version, finalized_at, finalization_sha256
    ) VALUES (
      '01890f1a-0000-7000-8000-000000000093', 'ctv2_contract_org_a',
      '01890f1a-0000-7000-8000-000000000041', 'first_n_hours', 'day7-v1',
      '2026-08-23T00:00:00Z', '2026-08-30T00:00:00Z',
      '01890f1a-0000-7000-8000-000000000061', '2026-08-23T00:00:00Z',
      '01890f1a-0000-7000-8000-000000000062',
      '01890f1a-0000-7000-8000-000000000062', 120, 900, 100, 800,
      '01890f1a-0000-7000-8000-000000000081', 'final', 'contract-v1',
      '2026-08-30T00:05:00Z', repeat('f', 64)
    )
  $sql$,
  '42501',
  'permission denied'
);

RESET SESSION AUTHORIZATION;

SET SESSION AUTHORIZATION ctv2_contract_reader;
SELECT creator_tracker_v2_contract.assert_true(
  (SELECT count(*) = 2 FROM creator_tracker_v2.creators),
  'reader must see exactly the two tenant A creators and no tenant B creator'
);
SELECT creator_tracker_v2_contract.expect_error(
  $sql$
    INSERT INTO creator_tracker_v2.creators (
      id, organization_id, display_name
    ) VALUES (
      '01890f1a-0000-7000-8000-000000000005',
      'ctv2_contract_org_a',
      'reader write attempt'
    )
  $sql$,
  '42501',
  'permission denied'
);
RESET SESSION AUTHORIZATION;

SET SESSION AUTHORIZATION ctv2_contract_finalizer;

SELECT creator_tracker_v2_contract.expect_error(
  $sql$
    INSERT INTO creator_tracker_v2.video_window_finalizations (
      id, organization_id, video_id, policy_type, policy_version, window_start,
      cutoff_at, baseline_observation_id, baseline_at,
      post_cutoff_observation_id, selected_final_observation_id,
      cutoff_slippage_seconds, gross_views, paid_views, eligible_views,
      coverage_id, status, calculation_version, finalized_at, finalization_sha256
    ) VALUES (
      '01890f1a-0000-7000-8000-000000000093', 'ctv2_contract_org_a',
      '01890f1a-0000-7000-8000-000000000041', 'first_n_hours', 'day7-v1',
      '2026-08-23T00:00:00Z', '2026-08-30T00:00:00Z',
      '01890f1a-0000-7000-8000-000000000061', '2026-08-23T00:00:00Z',
      '01890f1a-0000-7000-8000-000000000062',
      '01890f1a-0000-7000-8000-000000000062', 120, 900, 100, 800,
      '01890f1a-0000-7000-8000-000000000082', 'final', 'contract-v1',
      '2026-08-30T00:05:00Z', repeat('f', 64)
    )
  $sql$,
  '23514',
  'complete matching coverage'
);

SELECT creator_tracker_v2_contract.expect_error(
  $sql$
    INSERT INTO creator_tracker_v2.video_window_finalizations (
      id, organization_id, video_id, policy_type, policy_version, window_start,
      cutoff_at, baseline_observation_id, baseline_at,
      post_cutoff_observation_id, selected_final_observation_id,
      cutoff_slippage_seconds, gross_views, paid_views, eligible_views,
      coverage_id, status, calculation_version, finalized_at, finalization_sha256
    ) VALUES (
      '01890f1a-0000-7000-8000-000000000094', 'ctv2_contract_org_a',
      '01890f1a-0000-7000-8000-000000000041', 'first_n_hours', 'day7-v1',
      '2026-08-23T00:00:00Z', '2026-08-30T00:00:00Z',
      '01890f1a-0000-7000-8000-000000000061', '2026-08-23T00:00:00Z',
      '01890f1a-0000-7000-8000-000000000062',
      '01890f1a-0000-7000-8000-000000000062', 120, 901, 100, 801,
      '01890f1a-0000-7000-8000-000000000081', 'final', 'contract-v1',
      '2026-08-30T00:05:00Z', repeat('e', 64)
    )
  $sql$,
  '23514',
  'do not match their immutable observations'
);

INSERT INTO creator_tracker_v2.video_window_finalizations (
  id, organization_id, video_id, policy_type, policy_version, window_start,
  cutoff_at, baseline_observation_id, baseline_at,
  post_cutoff_observation_id, selected_final_observation_id,
  cutoff_slippage_seconds, gross_views, paid_views, eligible_views,
  coverage_id, status, calculation_version, finalized_at, finalization_sha256
)
VALUES (
  '01890f1a-0000-7000-8000-000000000091', 'ctv2_contract_org_a',
  '01890f1a-0000-7000-8000-000000000041', 'first_n_hours', 'day7-v1',
  '2026-08-23T00:00:00Z', '2026-08-30T00:00:00Z',
  '01890f1a-0000-7000-8000-000000000061', '2026-08-23T00:00:00Z',
  '01890f1a-0000-7000-8000-000000000062',
  '01890f1a-0000-7000-8000-000000000062', 120, 900, 100, 800,
  '01890f1a-0000-7000-8000-000000000081', 'final', 'contract-v1',
  '2026-08-30T00:05:00Z', repeat('f', 64)
);

SELECT creator_tracker_v2_contract.expect_error(
  $sql$
    INSERT INTO creator_tracker_v2.video_window_finalization_locks (
      id, organization_id, finalization_id, finalization_sha256,
      lock_manifest_sha256, locked_by
    ) VALUES (
      '01890f1a-0000-7000-8000-0000000000a2', 'ctv2_contract_org_a',
      '01890f1a-0000-7000-8000-000000000091', repeat('f', 64),
      repeat('a', 64), 'finalizer-cannot-lock'
    )
  $sql$,
  '42501',
  'permission denied'
);

RESET SESSION AUTHORIZATION;

SELECT creator_tracker_v2_contract.expect_error(
  $sql$
    UPDATE creator_tracker_v2.video_observations
    SET views = 1001
    WHERE id = '01890f1a-0000-7000-8000-000000000062'
  $sql$,
  '55000',
  'append-only'
);
SELECT creator_tracker_v2_contract.expect_error(
  $sql$
    DELETE FROM creator_tracker_v2.video_window_finalizations
    WHERE id = '01890f1a-0000-7000-8000-000000000091'
  $sql$,
  '55000',
  'append-only'
);

SET SESSION AUTHORIZATION ctv2_contract_locker;

SELECT creator_tracker_v2_contract.expect_error(
  $sql$
    INSERT INTO creator_tracker_v2.video_window_finalization_locks (
      id, organization_id, finalization_id, finalization_sha256,
      lock_manifest_sha256, locked_by
    ) VALUES (
      '01890f1a-0000-7000-8000-0000000000a2', 'ctv2_contract_org_a',
      '01890f1a-0000-7000-8000-000000000091', repeat('0', 64),
      repeat('a', 64), 'contract-locker'
    )
  $sql$,
  '23514',
  'exactly matching hash'
);

INSERT INTO creator_tracker_v2.video_window_finalization_locks (
  id, organization_id, finalization_id, finalization_sha256,
  lock_manifest_sha256, locked_by
)
VALUES (
  '01890f1a-0000-7000-8000-0000000000a1', 'ctv2_contract_org_a',
  '01890f1a-0000-7000-8000-000000000091', repeat('f', 64),
  repeat('a', 64), 'contract-locker'
);

SELECT creator_tracker_v2_contract.expect_error(
  $sql$
    INSERT INTO creator_tracker_v2.video_window_finalizations (
      id, organization_id, video_id, policy_type, policy_version, revision,
      window_start, cutoff_at, status, exception_code, calculation_version,
      finalized_at, finalization_sha256
    ) VALUES (
      '01890f1a-0000-7000-8000-000000000095', 'ctv2_contract_org_a',
      '01890f1a-0000-7000-8000-000000000041', 'first_n_hours', 'day7-v2', 1,
      '2026-08-23T00:00:00Z', '2026-08-30T00:00:00Z', 'needs_review',
      'LOCKER_CANNOT_FINALIZE', 'contract-v1', '2026-08-30T00:06:00Z', repeat('d', 64)
    )
  $sql$,
  '42501',
  'permission denied'
);

RESET SESSION AUTHORIZATION;

SELECT creator_tracker_v2_contract.expect_error(
  $sql$
    UPDATE creator_tracker_v2.video_window_finalization_locks
    SET locked_by = 'mutated'
    WHERE id = '01890f1a-0000-7000-8000-0000000000a1'
  $sql$,
  '55000',
  'append-only'
);

SELECT creator_tracker_v2_contract.assert_true(
  (SELECT count(*) = 1 FROM creator_tracker_v2.video_window_finalizations),
  'exactly one valid finalization must remain after rejected writes'
);
SELECT creator_tracker_v2_contract.assert_true(
  (SELECT count(*) = 1 FROM creator_tracker_v2.video_window_finalization_locks),
  'exactly one matching settlement lock must remain after rejected writes'
);

\echo 'creator_tracker_v2 PostgreSQL contract passed'
