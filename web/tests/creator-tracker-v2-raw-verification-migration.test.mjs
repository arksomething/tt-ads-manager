import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [migration, producerBinding, contract, verifier] = await Promise.all([
  readFile(
    path.join(webRoot, "sql", "20260830_add_creator_tracker_v2_raw_verification.sql"),
    "utf8",
  ),
  readFile(
    path.join(webRoot, "sql", "20260830_bind_creator_tracker_v2_producer_runs.sql"),
    "utf8",
  ),
  readFile(
    path.join(webRoot, "sql", "tests", "creator_tracker_v2_raw_verification_contract.sql"),
    "utf8",
  ),
  readFile(
    path.join(webRoot, "scripts", "verify-creator-tracker-v2-migration.sh"),
    "utf8",
  ),
]);

test("raw verification is a separate idempotent migration with a leaf capability", () => {
  assert.match(migration, /CREATE ROLE creator_tracker_v2_raw_verifier NOLOGIN NOINHERIT/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS can_verify_raw boolean NOT NULL DEFAULT false/);
  assert.match(migration, /raw_object_verifications/);
  assert.match(migration, /requires zero pre-existing final results or settlement locks/);
  assert.match(migration, /DROP CONSTRAINT IF EXISTS raw_object_manifests_storage_key_uq/);
  assert.match(migration, /DROP CONSTRAINT IF EXISTS raw_object_verifications_one_per_manifest_uq/);
  assert.match(migration, /raw_object_manifest_sets/);
  assert.match(migration, /raw_object_manifest_entries/);
  assert.match(migration, /verification_session_id/);
  assert.match(migration, /verification_method = 'sha256_full_read_v1'/);
  assert.match(migration, /sha256_full_read_recursive_manifest_v1/);
  assert.match(migration, /every child full-read in the same transaction/);
  assert.match(migration, /verified_at >= as_of - interval '24 hours'/);
  assert.match(migration, /login_row\.rolcreatedb/);
  assert.match(migration, /login_row\.rolcreaterole/);
  assert.match(migration, /login_row\.rolreplication/);
  assert.match(migration, /only leaf creator-tracker capability roles/);
  assert.match(migration, /existing tenant grant targets an ineligible or over-privileged login/);
  assert.match(migration, /BEFORE UPDATE OR DELETE ON creator_tracker_v2\.raw_object_verifications/);
  assert.match(migration, /GRANT INSERT ON creator_tracker_v2\.raw_object_verifications\s+TO creator_tracker_v2_raw_verifier/);
  assert.doesNotMatch(
    migration,
    /GRANT INSERT ON creator_tracker_v2\.raw_object_verifications[\s\S]{0,100}creator_tracker_v2_ingest/,
  );
  assert.doesNotMatch(migration, /ALTER TABLE creator_tracker_v2\.raw_object_manifests\s+ADD COLUMN/);
});

test("producer run binding preserves canonical UUIDv7 lineage and exact aggregate identity", () => {
  assert.match(producerBinding, /ADD COLUMN IF NOT EXISTS producer_run_id text/);
  assert.match(producerBinding, /ALTER COLUMN producer_run_id SET NOT NULL/);
  assert.match(producerBinding, /canonical lowercase UUIDv4 embedded as runId/i);
  assert.match(producerBinding, /zero unbound raw manifest sets/);
  assert.match(producerBinding, /validate_raw_manifest_set_insert/);
  assert.match(producerBinding, /viral_app_provider/);
  assert.match(producerBinding, /tiktok_display_api/);
  assert.match(producerBinding, /instagram_graph_api/);
  assert.match(producerBinding, /provider_reconciliation/);
  assert.match(producerBinding, /provider_accounts_page/);
  assert.match(producerBinding, /provider_videos_page/);
  assert.match(producerBinding, /observation\.confidence <> 'direct'/);
  assert.match(producerBinding, /fresh recursively verified direct native evidence/);
  assert.match(contract, /550e8400-e29b-41d4-a716-446655440001/);
  assert.equal(
    verifier.split(
      '"${migration_psql_command[@]}" --quiet --file "${producer_run_binding_migration_file}"',
    ).length - 1,
    3,
  );
});

test("finalization requires fresh recursive observation and coverage evidence", () => {
  assert.match(migration, /finalizations_require_raw_verification/);
  assert.match(migration, /NEW\.baseline_observation_id/);
  assert.match(migration, /NEW\.pre_cutoff_observation_id/);
  assert.match(migration, /NEW\.post_cutoff_observation_id/);
  assert.match(migration, /NEW\.selected_final_observation_id/);
  assert.match(migration, /raw_manifest_has_fresh_recursive_verification/);
  assert.match(migration, /aggregate_verification\.storage_key = manifest\.storage_key/);
  assert.match(migration, /aggregate_verification\.sha256 = manifest\.sha256/);
  assert.match(migration, /aggregate_verification\.byte_length = manifest\.byte_length/);
  assert.match(migration, /child_verification\.raw_manifest_entry_id = entry\.id/);
  assert.match(migration, /manifest\.run_id = coverage_row\.run_id/);
  assert.match(migration, /manifest\.sha256 = coverage_row\.evidence_sha256/);
});

test("PostgreSQL contract proves recursive denial, CAS reuse, freshness, and immutability", () => {
  assert.match(contract, /ingest-must-not-attest/);
  assert.match(
    contract,
    /fresh recursively verified direct native evidence for every selected observation/,
  );
  assert.match(contract, /mismatched-child-attestation/);
  assert.match(contract, /aggregate-with-missing-child/);
  assert.match(contract, /fresh recursively verified direct native coverage/);
  assert.match(contract, /verified-baseline-aggregate-v1/);
  assert.match(contract, /verified-cutoff-aggregate-v1/);
  assert.match(contract, /verified-coverage-aggregate-v1/);
  assert.match(contract, /verified-provider-aggregate-v1/);
  assert.match(contract, /provider-must-not-pay-v1/);
  assert.match(contract, /provider_videos_page/);
  assert.match(contract, /identical CAS bytes must be reusable/);
  assert.match(contract, /recursive verification must expire after 24 hours/);
  assert.match(contract, /ctv2_contract_privileged_verifier/);
  assert.match(contract, /UPDATE creator_tracker_v2\.raw_object_verifications/);
  assert.match(contract, /DELETE FROM creator_tracker_v2\.raw_object_verifications/);
  assert.match(contract, /raw verification PostgreSQL contract passed/);
});

test("disposable verifier preserves migration generations and retries only the additive successor", () => {
  assert.equal(
    verifier.split(
      '"${migration_psql_command[@]}" --quiet --file "${raw_verification_migration_file}"',
    ).length - 1,
    2,
  );
  assert.match(verifier, /already-applied base migration is never replayed after its additive/);
  const firstMigration = verifier.indexOf(
    '"${raw_verification_migration_file}"',
  );
  const contractRun = verifier.lastIndexOf(
    '"${raw_verification_contract_file}"',
  );
  assert.ok(firstMigration >= 0 && firstMigration < contractRun);
});
