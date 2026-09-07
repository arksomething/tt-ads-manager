import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [migration, contract, verifier] = await Promise.all([
  readFile(
    path.join(
      webRoot,
      "sql",
      "20260830_add_creator_tracker_v2_raw_verifier_provider_run_proof.sql",
    ),
    "utf8",
  ),
  readFile(
    path.join(
      webRoot,
      "sql",
      "tests",
      "creator_tracker_v2_raw_verifier_provider_run_proof_contract.sql",
    ),
    "utf8",
  ),
  readFile(
    path.join(webRoot, "scripts", "verify-creator-tracker-v2-migration.sh"),
    "utf8",
  ),
]);

test("provider-run proof is a bounded tenant-scoped SECURITY DEFINER contract", () => {
  assert.match(
    migration,
    /raw_verifier_provider_capture_run_proof\(\s*requested_organization_id text,\s*requested_producer_run_ids text\[\]/,
  );
  assert.match(migration, /STABLE\s+SECURITY DEFINER\s+SET search_path = pg_catalog/);
  assert.match(migration, /session_user::name,[\s\S]*creator_tracker_v2_raw_verifier/);
  assert.match(
    migration,
    /has_tenant_access\(\s*requested_organization_id,\s*'read'/,
  );
  assert.match(migration, /requested_count > 400/);
  assert.match(migration, /requested producer run IDs must be unique/);
  assert.match(migration, /canonical lowercase UUIDv4 values/);
  assert.match(migration, /manifest_set\.purpose = 'provider_reconciliation'/);
  assert.match(migration, /tracking_run\.adapter = 'viral_app_provider'/);
  assert.match(migration, /manifest\.source = 'viral_app_provider'/);
  assert.match(migration, /JOIN creator_tracker_v2\.tracking_runs/);
  assert.match(migration, /JOIN creator_tracker_v2\.ingestion_batches/);
  assert.match(migration, /extract\(epoch FROM tracking_run\.request_started_at\) \* 1000/);
  assert.match(migration, /jsonb_typeof\(tracking_run\.error_detail -> 'endpoint'\) = 'string'/);
  assert.match(migration, /REVOKE ALL PRIVILEGES ON TABLE creator_tracker_v2\.tracking_runs,[\s\S]*FROM creator_tracker_v2_raw_verifier/);
  assert.doesNotMatch(
    migration,
    /GRANT SELECT(?:\s*\([^)]*\))? ON creator_tracker_v2\.(?:tracking_runs|ingestion_batches)[\s\S]{0,100}TO creator_tracker_v2_raw_verifier/,
  );
});

test("provider-run proof uses a fail-closed leaf owner with column-only central access", () => {
  assert.match(
    migration,
    /CREATE ROLE creator_tracker_v2_raw_proof_owner NOLOGIN NOINHERIT/,
  );
  assert.match(migration, /rolsuper OR rolcreatedb OR rolcreaterole/);
  assert.match(migration, /raw proof owner must not be a member of another role/);
  assert.match(migration, /GRANT SELECT \([\s\S]*\) ON creator_tracker_v2\.tracking_runs/);
  assert.match(migration, /GRANT SELECT \([\s\S]*\) ON creator_tracker_v2\.ingestion_batches/);
  assert.match(migration, /CREATE POLICY tenant_raw_proof_select[\s\S]*TO creator_tracker_v2_raw_proof_owner/);
  assert.match(migration, /REVOKE CREATE ON SCHEMA creator_tracker_v2/);
  assert.match(
    migration,
    /GRANT EXECUTE ON FUNCTION[\s\S]*raw_verifier_provider_capture_run_proof\(text, text\[\]\)[\s\S]*TO creator_tracker_v2_raw_verifier/,
  );
  assert.match(
    migration,
    /REVOKE ALL PRIVILEGES ON FUNCTION[\s\S]*FROM PUBLIC,[\s\S]*creator_tracker_v2_settlement_locker/,
  );
});

test("PostgreSQL contract proves exact fields, order, isolation, and negative access", () => {
  assert.match(contract, /proof\.batch_payload_sha256::text = repeat\('c', 64\)/);
  assert.match(contract, /proof\.request_started_at_ms = 1788048300123/);
  assert.match(contract, /proof\.response_received_at_ms = 1788048302654/);
  assert.match(contract, /proof\.completed_at_ms = 1788048303999/);
  assert.match(contract, /proof\.endpoint = '\/videos'/);
  assert.match(contract, /proof\.page_number = 2/);
  assert.match(contract, /WITH ORDINALITY/);
  assert.match(contract, /direct native producer runs must not be exposed/);
  assert.match(contract, /ctv2_contract_org_b/);
  assert.match(contract, /NULL::text\[\]/);
  assert.match(contract, /ARRAY\[401\]/);
  assert.match(contract, /must be unique/);
  assert.match(contract, /canonical lowercase UUIDv4/);
  assert.match(contract, /SELECT count\(\*\) FROM creator_tracker_v2\.tracking_runs/);
  assert.match(contract, /SET SESSION AUTHORIZATION ctv2_contract_reader/);
  assert.match(contract, /SET ROLE creator_tracker_v2_raw_verifier/);
  assert.match(
    contract,
    /raw-verifier provider-run proof PostgreSQL contract passed/,
  );
});

test("disposable PostgreSQL 17 verifier retries the additive proof migration", () => {
  assert.equal(
    verifier.split(
      '"${migration_psql_command[@]}" --quiet --file "${raw_verifier_provider_run_proof_migration_file}"',
    ).length - 1,
    3,
  );
  assert.match(
    verifier,
    /"\$\{postgres_psql_command\[@\]\}" --quiet --file "\$\{raw_verifier_provider_run_proof_contract_file\}"/,
  );
});
