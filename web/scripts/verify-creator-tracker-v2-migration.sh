#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
web_dir="$(cd -- "${script_dir}/.." && pwd)"
sql_dir="${web_dir}/sql"
migration_file="/sql/20260830_add_creator_tracker_v2.sql"
contract_file="/sql/tests/creator_tracker_v2_contract.sql"
raw_verification_migration_file="/sql/20260830_add_creator_tracker_v2_raw_verification.sql"
producer_run_binding_migration_file="/sql/20260830_bind_creator_tracker_v2_producer_runs.sql"
raw_verifier_provider_run_proof_migration_file="/sql/20260830_add_creator_tracker_v2_raw_verifier_provider_run_proof.sql"
raw_verification_contract_file="/sql/tests/creator_tracker_v2_raw_verification_contract.sql"
raw_verifier_provider_run_proof_contract_file="/sql/tests/creator_tracker_v2_raw_verifier_provider_run_proof_contract.sql"

# Pin the multi-architecture PostgreSQL 17 image so a verifier rerun exercises
# the same database build. An explicit override is useful only for deliberate
# compatibility testing; this script never accepts or connects to a live DB URL.
postgres_image="${CREATOR_TRACKER_V2_VERIFY_IMAGE:-postgres@sha256:18cfe3ef5e6815560c98237d6216d1e5119702fb0f3894c8785dd58b8bbe5d73}"
verification_container="codex-creator-tracker-v2-verify-$$"

cleanup() {
  docker rm --force "${verification_container}" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

if ! command -v docker >/dev/null 2>&1; then
  echo "creator tracker V2 verification requires Docker" >&2
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "the Docker daemon is unavailable for creator tracker V2 verification" >&2
  exit 1
fi

if [[ ! -f "${sql_dir}/20260830_add_creator_tracker_v2.sql" ]]; then
  echo "missing creator tracker V2 migration" >&2
  exit 1
fi

if [[ ! -f "${sql_dir}/tests/creator_tracker_v2_contract.sql" ]]; then
  echo "missing creator tracker V2 PostgreSQL contract" >&2
  exit 1
fi
if [[ ! -f "${sql_dir}/20260830_add_creator_tracker_v2_raw_verification.sql" ]]; then
  echo "missing creator tracker V2 raw verification migration" >&2
  exit 1
fi
if [[ ! -f "${sql_dir}/tests/creator_tracker_v2_raw_verification_contract.sql" ]]; then
  echo "missing creator tracker V2 raw verification PostgreSQL contract" >&2
  exit 1
fi
if [[ ! -f "${sql_dir}/20260830_bind_creator_tracker_v2_producer_runs.sql" ]]; then
  echo "missing creator tracker V2 producer run binding migration" >&2
  exit 1
fi
if [[ ! -f "${sql_dir}/20260830_add_creator_tracker_v2_raw_verifier_provider_run_proof.sql" ]]; then
  echo "missing creator tracker V2 raw-verifier provider-run proof migration" >&2
  exit 1
fi
if [[ ! -f "${sql_dir}/tests/creator_tracker_v2_raw_verifier_provider_run_proof_contract.sql" ]]; then
  echo "missing creator tracker V2 raw-verifier provider-run proof PostgreSQL contract" >&2
  exit 1
fi

if ! docker image inspect "${postgres_image}" >/dev/null 2>&1; then
  docker pull "${postgres_image}"
fi

docker run \
  --detach \
  --rm \
  --name "${verification_container}" \
  --network none \
  --tmpfs /var/lib/postgresql/data:rw,nosuid,nodev,noexec,size=512m \
  --env POSTGRES_HOST_AUTH_METHOD=trust \
  --volume "${sql_dir}:/sql:ro" \
  "${postgres_image}" >/dev/null

database_ready=0
for _attempt in $(seq 1 60); do
  if ! docker inspect --format '{{.State.Running}}' "${verification_container}" 2>/dev/null | grep -qx true; then
    docker logs "${verification_container}" >&2 || true
    echo "the disposable PostgreSQL verifier stopped before becoming ready" >&2
    exit 1
  fi

  if docker exec "${verification_container}" \
      pg_isready -h 127.0.0.1 -U postgres -d postgres >/dev/null 2>&1; then
    database_ready=1
    break
  fi
  sleep 1
done

if [[ "${database_ready}" != 1 ]]; then
  docker logs "${verification_container}" >&2 || true
  echo "the disposable PostgreSQL verifier did not become ready within 60 seconds" >&2
  exit 1
fi

postgres_psql_command=(
  docker exec
  --env 'PGOPTIONS=-c client_min_messages=warning'
  "${verification_container}"
  psql
  -h 127.0.0.1
  -X
  -v ON_ERROR_STOP=1
  -U postgres
  -d postgres
)

"${postgres_psql_command[@]}" --command \
  "CREATE EXTENSION IF NOT EXISTS citext WITH SCHEMA public;
   CREATE ROLE ctv2_migrator LOGIN CREATEROLE NOSUPERUSER NOCREATEDB NOINHERIT NOREPLICATION NOBYPASSRLS;
   GRANT CREATE ON DATABASE postgres TO ctv2_migrator;
   GRANT USAGE, CREATE ON SCHEMA public TO ctv2_migrator;" >/dev/null

migration_psql_command=(
  docker exec
  --env 'PGOPTIONS=-c client_min_messages=warning'
  "${verification_container}"
  psql
  -h 127.0.0.1
  -X
  -v ON_ERROR_STOP=1
  -U ctv2_migrator
  -d postgres
)

"${migration_psql_command[@]}" --command \
  'CREATE TABLE public."Organization" (id text PRIMARY KEY);' >/dev/null

# The first execution proves a clean install. The second execution proves the
# migration can be retried safely after an uncertain delivery acknowledgement.
"${migration_psql_command[@]}" --quiet --file "${migration_file}" >/dev/null
"${migration_psql_command[@]}" --quiet --file "${migration_file}" >/dev/null

# The contract validates catalog shape and performs real writes as four narrow
# login roles to prove tenant isolation, idempotency, append-only evidence,
# coverage certification, finalization safety, and settlement lock separation.
"${postgres_psql_command[@]}" --quiet --file "${contract_file}"

# The base contract deliberately creates one final result and lock. Remove only
# those disposable test fixtures before proving that the live-style follow-up
# refuses to grandfather any unverified settlement result.
"${postgres_psql_command[@]}" --command \
  "TRUNCATE TABLE creator_tracker_v2.video_window_finalization_locks,
                  creator_tracker_v2.video_window_finalizations;" >/dev/null

# The base ledger is already live, so its immutable contract runs first. The
# separate follow-up then proves an idempotent upgrade and independently gates
# settlement on full-read raw-object attestations.
"${migration_psql_command[@]}" --quiet --file "${raw_verification_migration_file}" >/dev/null
"${migration_psql_command[@]}" --quiet --file "${raw_verification_migration_file}" >/dev/null
"${migration_psql_command[@]}" --quiet --file "${producer_run_binding_migration_file}" >/dev/null
"${migration_psql_command[@]}" --quiet --file "${producer_run_binding_migration_file}" >/dev/null
"${migration_psql_command[@]}" --quiet --file "${raw_verifier_provider_run_proof_migration_file}" >/dev/null
"${migration_psql_command[@]}" --quiet --file "${raw_verifier_provider_run_proof_migration_file}" >/dev/null
"${postgres_psql_command[@]}" --quiet --file "${raw_verification_contract_file}"
"${postgres_psql_command[@]}" --quiet --file "${raw_verifier_provider_run_proof_contract_file}"
# The already-applied base migration is never replayed after its additive
# successor, because doing so would temporarily restore the older vocabulary.
# A retry of the additive generation after verified finalizations exist must
# remain safe and idempotent.
"${migration_psql_command[@]}" --quiet --file "${producer_run_binding_migration_file}" >/dev/null
"${migration_psql_command[@]}" --quiet --file "${raw_verifier_provider_run_proof_migration_file}" >/dev/null

echo "creator tracker V2 migrations verified on disposable PostgreSQL 17"
