\set ON_ERROR_STOP on

-- Base V2 fixtures already contain the day-0/day-7 observations. This
-- follow-up contract adds canonical aggregate headers and every child response,
-- then proves only an independent recursive full-read can unlock settlement.

CREATE ROLE ctv2_contract_raw_verifier
  LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
GRANT creator_tracker_v2_raw_verifier TO ctv2_contract_raw_verifier;
GRANT USAGE ON SCHEMA creator_tracker_v2_contract TO ctv2_contract_raw_verifier;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA creator_tracker_v2_contract
  TO ctv2_contract_raw_verifier;

INSERT INTO creator_tracker_v2.role_tenant_grants (
  database_role, organization_id, can_read, can_verify_raw
)
VALUES (
  'ctv2_contract_raw_verifier', 'ctv2_contract_org_a', true, true
);

SELECT creator_tracker_v2_contract.expect_error(
  $sql$
    UPDATE creator_tracker_v2.role_tenant_grants
    SET can_verify_raw = true
    WHERE database_role = 'ctv2_contract_ingest'
      AND organization_id = 'ctv2_contract_org_a'
  $sql$,
  '23514',
  'raw-verifier role membership'
);

-- Even a concrete member login is ineligible for a tenant capability if it
-- carries cluster-level privileges that could bypass the intended boundary.
CREATE ROLE ctv2_contract_privileged_verifier
  LOGIN INHERIT NOSUPERUSER CREATEDB CREATEROLE REPLICATION NOBYPASSRLS;
GRANT creator_tracker_v2_raw_verifier TO ctv2_contract_privileged_verifier;

SELECT creator_tracker_v2_contract.expect_error(
  $sql$
    INSERT INTO creator_tracker_v2.role_tenant_grants (
      database_role, organization_id, can_read, can_verify_raw
    ) VALUES (
      'ctv2_contract_privileged_verifier', 'ctv2_contract_org_a', true, true
    )
  $sql$,
  '23514',
  'unprivileged login'
);

SET SESSION AUTHORIZATION ctv2_contract_ingest;

-- Viral continuity is truthful provider evidence: one page-scoped run, one
-- aggregate, and one provider page child. It is valid inventory evidence but
-- remains categorically ineligible for payable direct finalization.
INSERT INTO creator_tracker_v2.ingestion_batches (
  id, organization_id, idempotency_key, source, collector_instance_id,
  schema_version, payload_sha256, status, received_at, accepted_at,
  item_count, observation_count
)
VALUES (
  '01890f1a-0000-7000-8000-000000000025', 'ctv2_contract_org_a',
  'contract-provider-page', 'viral_app_provider', 'contract-worker', 2,
  repeat('d', 64), 'accepted', '2026-08-30T00:04:00Z',
  '2026-08-30T00:04:01Z', 4, 1
);

INSERT INTO creator_tracker_v2.tracking_runs (
  id, organization_id, ingestion_batch_id, worker_id, adapter, adapter_version,
  request_id, request_started_at, response_received_at, completed_at, status,
  pages_expected, pages_fetched, items_expected, items_seen, items_written
)
VALUES (
  '01890f1a-0000-7000-8000-000000000034', 'ctv2_contract_org_a',
  '01890f1a-0000-7000-8000-000000000025', 'contract-worker',
  'viral_app_provider', 'contract-v1', 'contract-provider-videos-page-1',
  '2026-08-30T00:04:00Z', '2026-08-30T00:04:02Z',
  '2026-08-30T00:04:03Z', 'complete', 1, 1, 1, 1, 1
);

INSERT INTO creator_tracker_v2.raw_object_manifests (
  id, organization_id, run_id, source, storage_key, sha256, byte_length,
  content_type, source_observed_at, fetched_at, retention_class, retain_until
)
VALUES (
  '01890f1a-0000-7000-8000-000000000056', 'ctv2_contract_org_a',
  '01890f1a-0000-7000-8000-000000000034', 'viral_app_provider',
  'creator-tracker/raw/v1/sha256/aa/' || repeat('a', 64), repeat('a', 64), 96,
  'application/json', '2026-08-30T00:04:02Z', '2026-08-30T00:04:02Z',
  'operational', '2026-11-30T00:04:02Z'
);

INSERT INTO creator_tracker_v2.raw_object_manifest_sets (
  raw_manifest_id, organization_id, run_id, producer_run_id,
  store_version, purpose,
  response_count, total_response_bytes, sealed
)
VALUES
  (
    '01890f1a-0000-7000-8000-000000000051', 'ctv2_contract_org_a',
    '01890f1a-0000-7000-8000-000000000031',
    '550e8400-e29b-41d4-a716-446655440001', 1, 'video_observation',
    1, 64, true
  ),
  (
    '01890f1a-0000-7000-8000-000000000052', 'ctv2_contract_org_a',
    '01890f1a-0000-7000-8000-000000000032',
    '550e8400-e29b-41d4-a716-446655440002', 1, 'video_observation',
    1, 64, true
  ),
  (
    '01890f1a-0000-7000-8000-000000000056', 'ctv2_contract_org_a',
    '01890f1a-0000-7000-8000-000000000034',
    '550e8400-e29b-41d4-a716-446655440006', 1, 'provider_reconciliation',
    1, 48, true
  );

SELECT creator_tracker_v2_contract.expect_error(
  $sql$
    INSERT INTO creator_tracker_v2.raw_object_manifest_entries (
      id, organization_id, raw_manifest_id, run_id, ordinal, adapter,
      request_kind, source_observed_at_ms, media_type, storage_key, sha256,
      byte_length
    ) VALUES (
      '01890f1a-0000-7000-8000-0000000000e5', 'ctv2_contract_org_a',
      '01890f1a-0000-7000-8000-000000000056',
      '01890f1a-0000-7000-8000-000000000034', 0, 'viral_app_provider',
      'profile_page', 1788048242000, 'application/json',
      'creator-tracker/raw/v1/sha256/bb/' || repeat('b', 64), repeat('b', 64), 48
    )
  $sql$,
  '23514',
  'truthfully match its adapter'
);

INSERT INTO creator_tracker_v2.raw_object_manifest_entries (
  id, organization_id, raw_manifest_id, run_id, ordinal, adapter,
  request_kind, source_observed_at_ms, media_type, storage_key, sha256,
  byte_length
)
VALUES
  (
    '01890f1a-0000-7000-8000-0000000000e1', 'ctv2_contract_org_a',
    '01890f1a-0000-7000-8000-000000000051',
    '01890f1a-0000-7000-8000-000000000031', 0, 'tiktok_ytdlp',
    'post_detail', 1787443230000, 'application/json',
    'creator-tracker/raw/v1/sha256/55/' || repeat('5', 64), repeat('5', 64), 64
  ),
  (
    '01890f1a-0000-7000-8000-0000000000e2', 'ctv2_contract_org_a',
    '01890f1a-0000-7000-8000-000000000052',
    '01890f1a-0000-7000-8000-000000000032', 0, 'tiktok_ytdlp',
    'post_detail', 1788048150000, 'application/json',
    'creator-tracker/raw/v1/sha256/66/' || repeat('6', 64), repeat('6', 64), 64
  ),
  (
    '01890f1a-0000-7000-8000-0000000000e5', 'ctv2_contract_org_a',
    '01890f1a-0000-7000-8000-000000000056',
    '01890f1a-0000-7000-8000-000000000034', 0, 'viral_app_provider',
    'provider_videos_page', 1788048242000, 'application/json',
    'creator-tracker/raw/v1/sha256/bb/' || repeat('b', 64), repeat('b', 64), 48
  );

INSERT INTO creator_tracker_v2.video_observations (
  id, organization_id, video_id, run_id, adapter, metric_schema_version,
  request_started_at, observed_at, source_observed_at, views,
  availability, is_complete, confidence, raw_manifest_id, idempotency_key
)
VALUES (
  '01890f1a-0000-7000-8000-000000000064', 'ctv2_contract_org_a',
  '01890f1a-0000-7000-8000-000000000041',
  '01890f1a-0000-7000-8000-000000000034', 'viral_app_provider', 1,
  '2026-08-30T00:04:00Z', '2026-08-30T00:04:02Z',
  '2026-08-30T00:04:02Z', 1001, 'available', true, 'provider',
  '01890f1a-0000-7000-8000-000000000056', 'contract-provider-observation'
);

-- Coverage carries only run + aggregate hash in the applied base schema.
INSERT INTO creator_tracker_v2.raw_object_manifests (
  id, organization_id, run_id, source, storage_key, sha256, byte_length,
  content_type, source_observed_at, fetched_at, retention_class, retain_until
)
VALUES (
  '01890f1a-0000-7000-8000-000000000054', 'ctv2_contract_org_a',
  '01890f1a-0000-7000-8000-000000000032', 'tiktok_ytdlp',
  'creator-tracker/raw/v1/sha256/44/' || repeat('4', 64), repeat('4', 64), 64,
  'application/json', '2026-08-30T00:02:40Z', '2026-08-30T00:02:40Z',
  'contract', '2033-08-30T00:02:40Z'
);

INSERT INTO creator_tracker_v2.raw_object_manifest_sets (
  raw_manifest_id, organization_id, run_id, producer_run_id,
  store_version, purpose,
  response_count, total_response_bytes, sealed
)
VALUES (
  '01890f1a-0000-7000-8000-000000000054', 'ctv2_contract_org_a',
  '01890f1a-0000-7000-8000-000000000032',
  '550e8400-e29b-41d4-a716-446655440002', 1, 'account_discovery',
  1, 32, true
);

INSERT INTO creator_tracker_v2.raw_object_manifest_entries (
  id, organization_id, raw_manifest_id, run_id, ordinal, adapter,
  request_kind, source_observed_at_ms, media_type, storage_key, sha256,
  byte_length
)
VALUES (
  '01890f1a-0000-7000-8000-0000000000e4', 'ctv2_contract_org_a',
  '01890f1a-0000-7000-8000-000000000054',
  '01890f1a-0000-7000-8000-000000000032', 0, 'tiktok_ytdlp',
  'profile_page', 1788048160000, 'application/json',
  'creator-tracker/raw/v1/sha256/88/' || repeat('8', 64), repeat('8', 64), 32
);

-- Same exact aggregate bytes in a second run reuse the CAS key while keeping a
-- separate run-scoped manifest row and lineage identity.
INSERT INTO creator_tracker_v2.raw_object_manifests (
  id, organization_id, run_id, source, storage_key, sha256, byte_length,
  content_type, source_observed_at, fetched_at, retention_class, retain_until
)
VALUES (
  '01890f1a-0000-7000-8000-000000000055', 'ctv2_contract_org_a',
  '01890f1a-0000-7000-8000-000000000033', 'tiktok_ytdlp',
  'creator-tracker/raw/v1/sha256/11/' || repeat('1', 64), repeat('1', 64), 128,
  'application/json', '2026-08-30T00:10:30Z', '2026-08-30T00:10:30Z',
  'operational', '2026-11-30T00:10:30Z'
);

SELECT creator_tracker_v2_contract.assert_true(
  (
    SELECT count(*) = 2
    FROM creator_tracker_v2.raw_object_manifests
    WHERE storage_key = 'creator-tracker/raw/v1/sha256/11/' || repeat('1', 64)
  ),
  'identical CAS bytes must be reusable by manifests in two runs'
);

-- The ingestion capability can record claims but cannot attest its own bytes.
SELECT creator_tracker_v2_contract.expect_error(
  $sql$
    INSERT INTO creator_tracker_v2.raw_object_verifications (
      id, organization_id, raw_manifest_id, raw_manifest_entry_id,
      verification_session_id, run_id, storage_key, sha256, byte_length,
      verification_method, verifier_instance_id, idempotency_key
    ) VALUES (
      '01890f1a-0000-7000-8000-0000000000c0', 'ctv2_contract_org_a',
      '01890f1a-0000-7000-8000-000000000051',
      '01890f1a-0000-7000-8000-0000000000e1',
      '01890f1a-0000-7000-8000-0000000000d0',
      '01890f1a-0000-7000-8000-000000000031',
      'creator-tracker/raw/v1/sha256/55/' || repeat('5', 64),
      repeat('5', 64), 64, 'sha256_full_read_v1', 'ingest-must-not-attest',
      'ingest-self-attestation'
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
      coverage_id, status, calculation_version, finalized_at,
      finalization_sha256
    ) VALUES (
      '01890f1a-0000-7000-8000-0000000000b1', 'ctv2_contract_org_a',
      '01890f1a-0000-7000-8000-000000000041', 'first_n_hours',
      'day7-raw-verified-v1', '2026-08-23T00:00:00Z',
      '2026-08-30T00:00:00Z', '01890f1a-0000-7000-8000-000000000061',
      '2026-08-23T00:00:00Z', '01890f1a-0000-7000-8000-000000000062',
      '01890f1a-0000-7000-8000-000000000062', 120, 900, 100, 800,
      '01890f1a-0000-7000-8000-000000000081', 'final', 'contract-v2',
      '2026-08-30T00:07:00Z', repeat('9', 64)
    )
  $sql$,
  '23514',
  'fresh recursively verified direct native evidence for every selected observation'
);

RESET SESSION AUTHORIZATION;
SET SESSION AUTHORIZATION ctv2_contract_raw_verifier;

SELECT creator_tracker_v2_contract.assert_true(
  creator_tracker_v2.has_tenant_access('ctv2_contract_org_a', 'verify_raw'),
  'raw verifier login must have its explicit tenant verification capability'
);
SELECT creator_tracker_v2_contract.assert_true(
  NOT creator_tracker_v2.has_tenant_access('ctv2_contract_org_b', 'verify_raw'),
  'raw verifier must not inherit another tenant'
);
SELECT creator_tracker_v2_contract.expect_error(
  'SELECT count(*) FROM creator_tracker_v2.videos',
  '42501',
  'permission denied'
);

SELECT creator_tracker_v2_contract.expect_error(
  $sql$
    INSERT INTO creator_tracker_v2.raw_object_verifications (
      id, organization_id, raw_manifest_id, raw_manifest_entry_id,
      verification_session_id, run_id, storage_key, sha256, byte_length,
      verification_method, verifier_instance_id, idempotency_key
    ) VALUES (
      '01890f1a-0000-7000-8000-0000000000c0', 'ctv2_contract_org_a',
      '01890f1a-0000-7000-8000-000000000051',
      '01890f1a-0000-7000-8000-0000000000e1',
      '01890f1a-0000-7000-8000-0000000000d0',
      '01890f1a-0000-7000-8000-000000000031',
      'creator-tracker/raw/v1/sha256/55/' || repeat('5', 64),
      repeat('0', 64), 63, 'sha256_full_read_v1', 'contract-verifier',
      'mismatched-child-attestation'
    )
  $sql$,
  '23514',
  'exactly match a full-read manifest entry'
);

SELECT creator_tracker_v2_contract.expect_error(
  $sql$
    INSERT INTO creator_tracker_v2.raw_object_verifications (
      id, organization_id, raw_manifest_id, raw_manifest_entry_id,
      verification_session_id, run_id, storage_key, sha256, byte_length,
      verification_method, verifier_instance_id, idempotency_key
    ) VALUES (
      '01890f1a-0000-7000-8000-0000000000c0', 'ctv2_contract_org_a',
      '01890f1a-0000-7000-8000-000000000051', NULL,
      '01890f1a-0000-7000-8000-0000000000d0',
      '01890f1a-0000-7000-8000-000000000031',
      'creator-tracker/raw/v1/sha256/11/' || repeat('1', 64),
      repeat('1', 64), 128, 'sha256_full_read_recursive_manifest_v1',
      'contract-verifier', 'aggregate-with-missing-child'
    )
  $sql$,
  '23514',
  'every child full-read in the same transaction'
);

-- Child reads and the recomputed aggregate attestation are atomic and share a
-- server timestamp, verifier instance, and explicit session identifier.
BEGIN;
INSERT INTO creator_tracker_v2.raw_object_verifications (
  id, organization_id, raw_manifest_id, raw_manifest_entry_id,
  verification_session_id, run_id, storage_key, sha256, byte_length,
  verification_method, verifier_instance_id, idempotency_key
)
VALUES (
  '01890f1a-0000-7000-8000-0000000000c1', 'ctv2_contract_org_a',
  '01890f1a-0000-7000-8000-000000000051',
  '01890f1a-0000-7000-8000-0000000000e1',
  '01890f1a-0000-7000-8000-0000000000d1',
  '01890f1a-0000-7000-8000-000000000031',
  'creator-tracker/raw/v1/sha256/55/' || repeat('5', 64),
  repeat('5', 64), 64, 'sha256_full_read_v1', 'contract-verifier',
  'verified-baseline-child-v1'
);
INSERT INTO creator_tracker_v2.raw_object_verifications (
  id, organization_id, raw_manifest_id, raw_manifest_entry_id,
  verification_session_id, run_id, storage_key, sha256, byte_length,
  verification_method, verifier_instance_id, idempotency_key
)
VALUES (
  '01890f1a-0000-7000-8000-0000000000c2', 'ctv2_contract_org_a',
  '01890f1a-0000-7000-8000-000000000051', NULL,
  '01890f1a-0000-7000-8000-0000000000d1',
  '01890f1a-0000-7000-8000-000000000031',
  'creator-tracker/raw/v1/sha256/11/' || repeat('1', 64),
  repeat('1', 64), 128, 'sha256_full_read_recursive_manifest_v1',
  'contract-verifier', 'verified-baseline-aggregate-v1'
);
INSERT INTO creator_tracker_v2.raw_object_verifications (
  id, organization_id, raw_manifest_id, raw_manifest_entry_id,
  verification_session_id, run_id, storage_key, sha256, byte_length,
  verification_method, verifier_instance_id, idempotency_key
)
VALUES (
  '01890f1a-0000-7000-8000-0000000000c3', 'ctv2_contract_org_a',
  '01890f1a-0000-7000-8000-000000000052',
  '01890f1a-0000-7000-8000-0000000000e2',
  '01890f1a-0000-7000-8000-0000000000d2',
  '01890f1a-0000-7000-8000-000000000032',
  'creator-tracker/raw/v1/sha256/66/' || repeat('6', 64),
  repeat('6', 64), 64, 'sha256_full_read_v1', 'contract-verifier',
  'verified-cutoff-child-v1'
);
INSERT INTO creator_tracker_v2.raw_object_verifications (
  id, organization_id, raw_manifest_id, raw_manifest_entry_id,
  verification_session_id, run_id, storage_key, sha256, byte_length,
  verification_method, verifier_instance_id, idempotency_key
)
VALUES (
  '01890f1a-0000-7000-8000-0000000000c4', 'ctv2_contract_org_a',
  '01890f1a-0000-7000-8000-000000000052', NULL,
  '01890f1a-0000-7000-8000-0000000000d2',
  '01890f1a-0000-7000-8000-000000000032',
  'creator-tracker/raw/v1/sha256/22/' || repeat('2', 64),
  repeat('2', 64), 128, 'sha256_full_read_recursive_manifest_v1',
  'contract-verifier', 'verified-cutoff-aggregate-v1'
);
INSERT INTO creator_tracker_v2.raw_object_verifications (
  id, organization_id, raw_manifest_id, raw_manifest_entry_id,
  verification_session_id, run_id, storage_key, sha256, byte_length,
  verification_method, verifier_instance_id, idempotency_key
)
VALUES (
  '01890f1a-0000-7000-8000-0000000000c9', 'ctv2_contract_org_a',
  '01890f1a-0000-7000-8000-000000000056',
  '01890f1a-0000-7000-8000-0000000000e5',
  '01890f1a-0000-7000-8000-0000000000d5',
  '01890f1a-0000-7000-8000-000000000034',
  'creator-tracker/raw/v1/sha256/bb/' || repeat('b', 64),
  repeat('b', 64), 48, 'sha256_full_read_v1', 'contract-verifier',
  'verified-provider-child-v1'
);
INSERT INTO creator_tracker_v2.raw_object_verifications (
  id, organization_id, raw_manifest_id, raw_manifest_entry_id,
  verification_session_id, run_id, storage_key, sha256, byte_length,
  verification_method, verifier_instance_id, idempotency_key
)
VALUES (
  '01890f1a-0000-7000-8000-0000000000ca', 'ctv2_contract_org_a',
  '01890f1a-0000-7000-8000-000000000056', NULL,
  '01890f1a-0000-7000-8000-0000000000d5',
  '01890f1a-0000-7000-8000-000000000034',
  'creator-tracker/raw/v1/sha256/aa/' || repeat('a', 64),
  repeat('a', 64), 96, 'sha256_full_read_recursive_manifest_v1',
  'contract-verifier', 'verified-provider-aggregate-v1'
);
COMMIT;

RESET SESSION AUTHORIZATION;
SET SESSION AUTHORIZATION ctv2_contract_finalizer;

SELECT creator_tracker_v2_contract.expect_error(
  $sql$
    INSERT INTO creator_tracker_v2.video_window_finalizations (
      id, organization_id, video_id, policy_type, policy_version, window_start,
      cutoff_at, baseline_observation_id, baseline_at,
      post_cutoff_observation_id, selected_final_observation_id,
      cutoff_slippage_seconds, gross_views, paid_views, eligible_views,
      coverage_id, status, calculation_version, finalized_at,
      finalization_sha256
    ) VALUES (
      '01890f1a-0000-7000-8000-0000000000b1', 'ctv2_contract_org_a',
      '01890f1a-0000-7000-8000-000000000041', 'first_n_hours',
      'day7-raw-verified-v1', '2026-08-23T00:00:00Z',
      '2026-08-30T00:00:00Z', '01890f1a-0000-7000-8000-000000000061',
      '2026-08-23T00:00:00Z', '01890f1a-0000-7000-8000-000000000062',
      '01890f1a-0000-7000-8000-000000000062', 120, 900, 100, 800,
      '01890f1a-0000-7000-8000-000000000081', 'final', 'contract-v2',
      '2026-08-30T00:07:00Z', repeat('9', 64)
    )
  $sql$,
  '23514',
  'fresh recursively verified direct native coverage'
);

RESET SESSION AUTHORIZATION;
SET SESSION AUTHORIZATION ctv2_contract_raw_verifier;
BEGIN;
INSERT INTO creator_tracker_v2.raw_object_verifications (
  id, organization_id, raw_manifest_id, raw_manifest_entry_id,
  verification_session_id, run_id, storage_key, sha256, byte_length,
  verification_method, verifier_instance_id, idempotency_key
)
VALUES (
  '01890f1a-0000-7000-8000-0000000000c5', 'ctv2_contract_org_a',
  '01890f1a-0000-7000-8000-000000000054',
  '01890f1a-0000-7000-8000-0000000000e4',
  '01890f1a-0000-7000-8000-0000000000d3',
  '01890f1a-0000-7000-8000-000000000032',
  'creator-tracker/raw/v1/sha256/88/' || repeat('8', 64),
  repeat('8', 64), 32, 'sha256_full_read_v1', 'contract-verifier',
  'verified-coverage-child-v1'
);
INSERT INTO creator_tracker_v2.raw_object_verifications (
  id, organization_id, raw_manifest_id, raw_manifest_entry_id,
  verification_session_id, run_id, storage_key, sha256, byte_length,
  verification_method, verifier_instance_id, idempotency_key
)
VALUES (
  '01890f1a-0000-7000-8000-0000000000c6', 'ctv2_contract_org_a',
  '01890f1a-0000-7000-8000-000000000054', NULL,
  '01890f1a-0000-7000-8000-0000000000d3',
  '01890f1a-0000-7000-8000-000000000032',
  'creator-tracker/raw/v1/sha256/44/' || repeat('4', 64),
  repeat('4', 64), 64, 'sha256_full_read_recursive_manifest_v1',
  'contract-verifier', 'verified-coverage-aggregate-v1'
);
COMMIT;

RESET SESSION AUTHORIZATION;
SET SESSION AUTHORIZATION ctv2_contract_finalizer;

SELECT creator_tracker_v2_contract.expect_error(
  $sql$
    INSERT INTO creator_tracker_v2.video_window_finalizations (
      id, organization_id, video_id, policy_type, policy_version, window_start,
      cutoff_at, baseline_observation_id, baseline_at,
      post_cutoff_observation_id, selected_final_observation_id,
      cutoff_slippage_seconds, gross_views, paid_views, eligible_views,
      coverage_id, status, calculation_version, finalized_at,
      finalization_sha256
    ) VALUES (
      '01890f1a-0000-7000-8000-0000000000b2', 'ctv2_contract_org_a',
      '01890f1a-0000-7000-8000-000000000041', 'first_n_hours',
      'provider-must-not-pay-v1', '2026-08-23T00:00:00Z',
      '2026-08-30T00:00:00Z', '01890f1a-0000-7000-8000-000000000064',
      '2026-08-30T00:04:02Z', '01890f1a-0000-7000-8000-000000000064',
      '01890f1a-0000-7000-8000-000000000064', 242, 1001, 0, 1001,
      '01890f1a-0000-7000-8000-000000000081', 'final', 'contract-v2',
      '2026-08-30T00:07:00Z', repeat('7', 64)
    )
  $sql$,
  '23514',
  'fresh recursively verified direct native evidence'
);

INSERT INTO creator_tracker_v2.video_window_finalizations (
  id, organization_id, video_id, policy_type, policy_version, window_start,
  cutoff_at, baseline_observation_id, baseline_at,
  post_cutoff_observation_id, selected_final_observation_id,
  cutoff_slippage_seconds, gross_views, paid_views, eligible_views,
  coverage_id, status, calculation_version, finalized_at, finalization_sha256
)
VALUES (
  '01890f1a-0000-7000-8000-0000000000b1', 'ctv2_contract_org_a',
  '01890f1a-0000-7000-8000-000000000041', 'first_n_hours',
  'day7-raw-verified-v1', '2026-08-23T00:00:00Z',
  '2026-08-30T00:00:00Z', '01890f1a-0000-7000-8000-000000000061',
  '2026-08-23T00:00:00Z', '01890f1a-0000-7000-8000-000000000062',
  '01890f1a-0000-7000-8000-000000000062', 120, 900, 100, 800,
  '01890f1a-0000-7000-8000-000000000081', 'final', 'contract-v2',
  '2026-08-30T00:07:00Z', repeat('9', 64)
);

RESET SESSION AUTHORIZATION;

-- Freshness is evaluated against the time settlement is attempted. An old
-- immutable attestation cannot survive object deletion indefinitely.
SELECT creator_tracker_v2_contract.assert_true(
  NOT creator_tracker_v2.raw_manifest_has_fresh_recursive_verification(
    'ctv2_contract_org_a', '01890f1a-0000-7000-8000-000000000031',
    '01890f1a-0000-7000-8000-000000000051',
    transaction_timestamp() + interval '25 hours'
  ),
  'recursive verification must expire after 24 hours'
);

-- Re-verification is append-only and repeatable; it never mutates an earlier
-- attestation and is not blocked by a one-row-per-manifest constraint.
SET SESSION AUTHORIZATION ctv2_contract_raw_verifier;
BEGIN;
INSERT INTO creator_tracker_v2.raw_object_verifications (
  id, organization_id, raw_manifest_id, raw_manifest_entry_id,
  verification_session_id, run_id, storage_key, sha256, byte_length,
  verification_method, verifier_instance_id, idempotency_key
)
VALUES (
  '01890f1a-0000-7000-8000-0000000000c7', 'ctv2_contract_org_a',
  '01890f1a-0000-7000-8000-000000000051',
  '01890f1a-0000-7000-8000-0000000000e1',
  '01890f1a-0000-7000-8000-0000000000d4',
  '01890f1a-0000-7000-8000-000000000031',
  'creator-tracker/raw/v1/sha256/55/' || repeat('5', 64),
  repeat('5', 64), 64, 'sha256_full_read_v1', 'contract-verifier',
  'verified-baseline-child-v2'
);
INSERT INTO creator_tracker_v2.raw_object_verifications (
  id, organization_id, raw_manifest_id, raw_manifest_entry_id,
  verification_session_id, run_id, storage_key, sha256, byte_length,
  verification_method, verifier_instance_id, idempotency_key
)
VALUES (
  '01890f1a-0000-7000-8000-0000000000c8', 'ctv2_contract_org_a',
  '01890f1a-0000-7000-8000-000000000051', NULL,
  '01890f1a-0000-7000-8000-0000000000d4',
  '01890f1a-0000-7000-8000-000000000031',
  'creator-tracker/raw/v1/sha256/11/' || repeat('1', 64),
  repeat('1', 64), 128, 'sha256_full_read_recursive_manifest_v1',
  'contract-verifier', 'verified-baseline-aggregate-v2'
);
COMMIT;
RESET SESSION AUTHORIZATION;

SET SESSION AUTHORIZATION ctv2_contract_ingest;
SELECT creator_tracker_v2_contract.expect_error(
  $sql$
    INSERT INTO creator_tracker_v2.raw_object_manifest_entries (
      id, organization_id, raw_manifest_id, run_id, ordinal, adapter,
      request_kind, source_observed_at_ms, media_type, storage_key, sha256,
      byte_length
    ) VALUES (
      '01890f1a-0000-7000-8000-0000000000e9', 'ctv2_contract_org_a',
      '01890f1a-0000-7000-8000-000000000051',
      '01890f1a-0000-7000-8000-000000000031', 0, 'tiktok_ytdlp',
      'post_detail', 1787443230000, 'application/json',
      'creator-tracker/raw/v1/sha256/99/' || repeat('9', 64), repeat('9', 64), 64
    )
  $sql$,
  '55000',
  'cannot accept later child entries'
);
RESET SESSION AUTHORIZATION;

SELECT creator_tracker_v2_contract.expect_error(
  $sql$
    UPDATE creator_tracker_v2.raw_object_verifications
    SET verifier_instance_id = 'mutated'
    WHERE id = '01890f1a-0000-7000-8000-0000000000c1'
  $sql$,
  '55000',
  'append-only'
);
SELECT creator_tracker_v2_contract.expect_error(
  $sql$
    DELETE FROM creator_tracker_v2.raw_object_verifications
    WHERE id = '01890f1a-0000-7000-8000-0000000000c1'
  $sql$,
  '55000',
  'append-only'
);

SELECT creator_tracker_v2_contract.assert_true(
  (SELECT count(*) = 10 FROM creator_tracker_v2.raw_object_verifications),
  'four recursive evidence sets plus one append-only re-verification must exist'
);
SELECT creator_tracker_v2_contract.assert_true(
  (SELECT count(*) = 1 FROM creator_tracker_v2.video_window_finalizations),
  'manifest-only attempts must fail and exactly one verified finalization must exist'
);

\echo 'creator_tracker_v2 recursive raw verification PostgreSQL contract passed'
