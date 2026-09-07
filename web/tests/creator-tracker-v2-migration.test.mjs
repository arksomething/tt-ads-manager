import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const migrationPath = path.join(webRoot, "sql", "20260830_add_creator_tracker_v2.sql");
const contractPath = path.join(webRoot, "sql", "tests", "creator_tracker_v2_contract.sql");
const verifierPath = path.join(webRoot, "scripts", "verify-creator-tracker-v2-migration.sh");
const packagePath = path.join(webRoot, "package.json");

const [migration, contract, verifier, packageJsonText] = await Promise.all([
  readFile(migrationPath, "utf8"),
  readFile(contractPath, "utf8"),
  readFile(verifierPath, "utf8"),
  readFile(packagePath, "utf8"),
]);

const packageJson = JSON.parse(packageJsonText);

function tableBlock(tableName, nextTableName) {
  const start = migration.indexOf(`CREATE TABLE IF NOT EXISTS creator_tracker_v2.${tableName}`);
  assert.notEqual(start, -1, `missing ${tableName} table`);
  const end = nextTableName
    ? migration.indexOf(`CREATE TABLE IF NOT EXISTS creator_tracker_v2.${nextTableName}`, start + 1)
    : migration.length;
  assert.notEqual(end, -1, `could not find table after ${tableName}`);
  return migration.slice(start, end);
}

test("creator tracker V2 migration defines the isolated canonical ledger exactly once", () => {
  const expectedTables = [
    "account_handle_history",
    "creator_platform_accounts",
    "creators",
    "ingestion_batches",
    "raw_object_manifests",
    "role_tenant_grants",
    "source_coverage_windows",
    "tracking_failures",
    "tracking_runs",
    "video_observations",
    "video_window_finalization_locks",
    "video_window_finalizations",
    "videos",
  ];

  const actualTables = [...migration.matchAll(
    /CREATE TABLE IF NOT EXISTS creator_tracker_v2\.([a-z_]+)/g,
  )].map((match) => match[1]).sort();

  assert.deepEqual(actualTables, expectedTables);
  assert.match(migration, /CREATE SCHEMA IF NOT EXISTS creator_tracker_v2;/);
  assert.doesNotMatch(migration, /\b(?:DROP SCHEMA|DROP TABLE|TRUNCATE)\b/i);

  const references = [...migration.matchAll(/REFERENCES\s+([^\s(]+)/g)].map((match) => match[1]);
  assert.ok(references.length > 20, "expected composite tenant foreign keys");
  for (const reference of references) {
    assert.ok(
      reference.startsWith("creator_tracker_v2.") || reference === 'public."Organization"',
      `unexpected dependency outside the isolated tracker boundary: ${reference}`,
    );
  }
});

test("migration contains no duplicated or truncated column and FK artifacts", () => {
  const ingestionBatches = tableBlock("ingestion_batches", "creator_platform_accounts");
  assert.equal(
    (ingestionBatches.match(/^\s*schema_version\s+smallint\b/gm) ?? []).length,
    1,
    "schema_version must be declared exactly once",
  );

  const trackingFailures = tableBlock("tracking_failures", "source_coverage_windows");
  assert.equal(
    (trackingFailures.match(/CONSTRAINT tracking_failures_resolved_run_fk/g) ?? []).length,
    1,
    "resolved-run FK must be declared exactly once",
  );
  assert.doesNotMatch(
    trackingFailures,
    /ON DELETE RESTRICT\s*,?\s*ON DELETE RESTRICT/,
    "resolved-run FK must not contain duplicated delete actions",
  );
});

test("tenant identity, evidence, and coverage constraints close payment-safety gaps", () => {
  assert.match(
    migration,
    /UNIQUE \(organization_id, id, creator_id, platform\)/,
  );
  assert.match(
    migration,
    /FOREIGN KEY \(organization_id, account_id, creator_id, platform\)[\s\S]*?REFERENCES creator_tracker_v2\.creator_platform_accounts \(organization_id, id, creator_id, platform\)/,
  );
  assert.match(migration, /first_seen_run_id creator_tracker_v2\.uuid_v7 NOT NULL/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION creator_tracker_v2\.validate_video_observation_insert/);
  assert.match(migration, /NEW\.adapter <> run_row\.adapter/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION creator_tracker_v2\.validate_source_coverage_insert/);
  assert.match(migration, /NEW\.status = 'complete' AND run_row\.status <> 'complete'/);
  assert.match(migration, /coverage_row\.platform IS DISTINCT FROM video_platform/);
  assert.match(migration, /baseline_row\.raw_manifest_id IS NULL/);
  assert.match(migration, /post_row\.raw_manifest_id IS NULL/);
  assert.match(migration, /NEW\.selected_final_observation_id <> NEW\.post_cutoff_observation_id/);
  assert.match(migration, /NEW\.paid_views > NEW\.gross_views/);
  assert.match(migration, /role_tenant_grants_derived_capabilities_need_read_ck/);
  assert.match(migration, /actor_role := session_user::name/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION creator_tracker_v2\.validate_role_tenant_grant/);
  assert.match(migration, /tenant access may only be granted to a concrete, inheriting, non-superuser login/);
});

test("evidence is append-only and capability roles remain narrowly separated", () => {
  const appendOnlyTables = [
    "ingestion_batches",
    "tracking_runs",
    "raw_object_manifests",
    "video_observations",
    "tracking_failures",
    "source_coverage_windows",
    "video_window_finalizations",
    "video_window_finalization_locks",
  ];

  for (const tableName of appendOnlyTables) {
    assert.match(
      migration,
      new RegExp(`['\"]${tableName}['\"]`),
      `${tableName} must be in the append-only trigger set`,
    );
  }

  assert.match(migration, /CREATE TRIGGER reject_evidence_mutation BEFORE UPDATE OR DELETE/);
  assert.doesNotMatch(migration, /GRANT\s+(?:[^;]*\bDELETE\b|[^;]*\bTRUNCATE\b)/i);
  assert.match(
    migration,
    /GRANT INSERT ON creator_tracker_v2\.video_window_finalizations\s+TO creator_tracker_v2_finalizer;/,
  );
  assert.match(
    migration,
    /GRANT INSERT ON creator_tracker_v2\.video_window_finalization_locks\s+TO creator_tracker_v2_settlement_locker;/,
  );
  assert.match(migration, /REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public/);
  assert.match(migration, /ALTER TABLE creator_tracker_v2\.%I FORCE ROW LEVEL SECURITY/);
});

test("PostgreSQL contract exercises real tenancy and immutable finalization behavior", () => {
  for (const login of ["ingest", "reader", "finalizer", "locker"]) {
    assert.match(contract, new RegExp(`SET SESSION AUTHORIZATION ctv2_contract_${login}`));
  }

  assert.match(contract, /expected V2 table contract|unexpected V2 table contract/);
  assert.match(contract, /tenant A ingestion must not see tenant B rows/);
  assert.match(contract, /videos_account_creator_platform_fk/);
  assert.match(contract, /complete tracking run/);
  assert.match(contract, /complete matching coverage/);
  assert.match(contract, /do not match their immutable observations/);
  assert.match(contract, /exactly matching hash/);
  assert.match(contract, /append-only/);
  assert.match(contract, /creator_tracker_v2 PostgreSQL contract passed/);
});

test("verifier uses only an isolated pinned PostgreSQL container and retries the migration", () => {
  assert.match(
    verifier,
    /postgres@sha256:18cfe3ef5e6815560c98237d6216d1e5119702fb0f3894c8785dd58b8bbe5d73/,
  );
  assert.match(verifier, /--network none/);
  assert.match(verifier, /--volume "\$\{sql_dir\}:\/sql:ro"/);
  assert.match(verifier, /trap cleanup EXIT INT TERM/);
  assert.match(
    verifier,
    /CREATE ROLE ctv2_migrator LOGIN CREATEROLE NOSUPERUSER NOCREATEDB NOINHERIT NOREPLICATION NOBYPASSRLS/,
  );
  assert.match(verifier, /-U ctv2_migrator/);
  assert.equal(
    verifier.split('"${migration_psql_command[@]}" --quiet --file "${migration_file}"').length - 1,
    2,
    "verifier must execute the migration twice",
  );
  assert.match(verifier, /--quiet --file "\$\{contract_file\}"/);
  assert.doesNotMatch(verifier, /DATABASE_URL|--publish|-p\s+[0-9]/);
});

test("web package exposes the disposable PostgreSQL verification gate", () => {
  assert.equal(
    packageJson.scripts["verify:creator-tracker-v2-migration"],
    "bash scripts/verify-creator-tracker-v2-migration.sh",
  );
});
