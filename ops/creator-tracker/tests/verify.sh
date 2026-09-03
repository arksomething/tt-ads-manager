#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
tracker_dir="$repo_root/ops/creator-tracker"
wrapper="$tracker_dir/bin/run-contained-job.sh"
health="$tracker_dir/bin/check-dashboard-health.sh"
runtime_installer="$tracker_dir/bin/install-yt-dlp-runtime.sh"
release_installer="$tracker_dir/bin/install-collector-release.sh"
release_verifier="$tracker_dir/bin/verify-collector-release.sh"
release_activator="$tracker_dir/bin/activate-collector-release.sh"
activation_boundary="$tracker_dir/bin/activation-boundary.py"
system_state_helper="$tracker_dir/bin/activation-system-state.py"
user_unit_helper="$tracker_dir/bin/activation-user-units.py"
durable_state_helper="$tracker_dir/bin/durable-state.py"
node_installer="$tracker_dir/bin/install-node-runtime.sh"
builder="$tracker_dir/bin/build-collector-release.sh"
canonical_seed_runner="$tracker_dir/bin/run-canonical-seed.sh"
cutover_runner="$tracker_dir/bin/run-cutover-completeness.sh"
instagram_credit_rearm_runner="$tracker_dir/bin/run-instagram-credit-rearm.sh"
raw_verifier_provision_runner="$tracker_dir/bin/run-raw-verifier-provision.sh"
cutover_result_validator="$tracker_dir/bin/validate-cutover-result.py"
release_tools_preparer="$tracker_dir/bin/prepare-release-tools-bundle.sh"
readonly -a expected_unit_files=(
  creator-tracker-canonical-delivery.service
  creator-tracker-canonical-delivery.timer
  creator-tracker-dashboard-health.service
  creator-tracker-dashboard-health.timer
  creator-tracker-instagram-discovery.service
  creator-tracker-instagram-discovery.timer
  creator-tracker-instagram-scheduler.service
  creator-tracker-instagram-scheduler.timer
  creator-tracker-provider-reconcile.service
  creator-tracker-provider-reconcile.timer
  creator-tracker-raw-verifier.service
  creator-tracker-raw-verifier.timer
  creator-tracker-roster-refresh.service
  creator-tracker-roster-refresh.timer
  creator-tracker-scheduler-tick.service
  creator-tracker-scheduler-tick.timer
  creator-tracker-worker.service
  creator-tracker.slice
)

bash -n "$wrapper" "$health" "$runtime_installer" \
  "$release_installer" "$release_verifier" "$release_activator" \
  "$node_installer" "$builder" "$canonical_seed_runner" "$cutover_runner" \
  "$instagram_credit_rearm_runner" "$raw_verifier_provision_runner" \
  "$release_tools_preparer"
python3 -I - "$tracker_dir/bin" <<'PY'
from pathlib import Path
import re
import sys

for path in Path(sys.argv[1]).glob("*.sh"):
    for line_number, line in enumerate(path.read_text().splitlines(), 1):
        match = re.match(r"^\s*local\s+(.+)$", line)
        if match is None:
            continue
        body = match.group(1)
        assignments = list(re.finditer(r"(?<!\S)([A-Za-z_][A-Za-z0-9_]*)=", body))
        prior_names: list[str] = []
        for index, assignment in enumerate(assignments):
            value_end = assignments[index + 1].start() if index + 1 < len(assignments) else len(body)
            value = body[assignment.end():value_end]
            for prior_name in prior_names:
                if re.search(rf"\$(?:{re.escape(prior_name)}\b|\{{{re.escape(prior_name)}(?:\}}|[:?+\-]))", value):
                    raise SystemExit(
                        f"{path}:{line_number}: local assignment expands {prior_name} "
                        "before the same local command assigns it"
                    )
            prior_names.append(assignment.group(1))
PY
grep -Fq \
  "InaccessiblePaths='/root -/etc/creator-tracker -/opt/creator-tracker/releases -/opt/creator-tracker/activation-transactions -/var/lib/creator-tracker/state -/var/lib/creator-tracker/imports -/var/lib/creator-tracker/raw-evidence-v1 -/var/lib/creator-tracker/verified-raw-evidence-v1'" \
  "$release_installer"
python3 -I - <<PY
from pathlib import Path
for path in Path("$tracker_dir/bin").glob("*.py"):
    compile(path.read_text(), str(path), "exec")
PY
python3 -I - "$cutover_result_validator" <<'PY'
import importlib.util
import json
from pathlib import Path
import subprocess
import sys

path = Path(sys.argv[1])
spec = importlib.util.spec_from_file_location("creator_tracker_cutover_result", path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
expected = 45
base = {
    "event": "creator_tracker_provider_cutover_completeness_v1",
    "status": "pending",
    "reason": "LOCAL_DELIVERY_PENDING",
    "selectedBy": "latest",
    "captureSetId": "a" * 64,
    "producerRunId": "11111111-1111-4111-8111-111111111111",
    "organizationId": "org-fixture",
    "frozenCreatedAtMs": 1788055200000,
    "frozenFirstOutboxId": 101,
    "frozenLastOutboxId": 149,
    "deliveryPending": True,
    "rawAttestationPending": False,
    "centralChecked": False,
    "outbox": {"expected": expected, "delivered": 4, "pending": 41,
               "leased": 0, "retry": 0},
    "receipts": {"expected": expected, "matched": 4},
    "projection": {
        "sourceRows": {"expected": 4322, "matched": 4322},
        "creators": {"expected": 98, "matched": 98},
        "accounts": {"expected": 98, "matched": 98},
        "videos": {"expected": 4224, "matched": 4224},
        "observations": {"expected": 4200, "matched": 4200},
        "cadenceSuppressed": {"expected": 24, "matched": 24},
    },
    "producerRuns": {"expected": expected, "localMatched": expected,
                     "centralMatched": None},
    "manifests": {"expected": expected, "localCatalogMatched": expected,
                  "sourceCasMatched": expected, "centralMatched": None,
                  "aggregateAttested": None, "archiveCasMatched": None},
}
parsed = module.parse(json.dumps(base, separators=(",", ":")).encode())
assert parsed == ("pending", "latest", base["producerRunId"],
                  base["captureSetId"], True, False, expected, 101, 149,
                  "4322:98:98:4224:4200:24")
validated = subprocess.run(
    [str(path)], input=json.dumps(base, separators=(",", ":")),
    text=True, check=True, capture_output=True,
)
assert validated.stderr == ""
assert validated.stdout.rstrip("\n").split("\t") == [
    "pending", "latest", base["producerRunId"], base["captureSetId"],
    "1", "0", str(expected), "101", "149", "4322:98:98:4224:4200:24",
]
raw_pending = {
    **base,
    "reason": "RAW_ATTESTATION_PENDING",
    "selectedBy": "producer_run_id",
    "deliveryPending": False,
    "rawAttestationPending": True,
    "centralChecked": True,
    "outbox": {"expected": expected, "delivered": expected, "pending": 0,
               "leased": 0, "retry": 0},
    "receipts": {"expected": expected, "matched": expected},
    "producerRuns": {"expected": expected, "localMatched": expected,
                     "centralMatched": expected},
    "manifests": {"expected": expected, "localCatalogMatched": expected,
                  "sourceCasMatched": expected, "centralMatched": expected,
                  "aggregateAttested": expected - 1, "archiveCasMatched": None},
}
assert module.parse(json.dumps(raw_pending).encode())[5] is True
complete = {
    **raw_pending,
    "status": "complete",
    "reason": "COMPLETE",
    "rawAttestationPending": False,
    "manifests": {**raw_pending["manifests"],
                  "aggregateAttested": expected, "archiveCasMatched": expected},
}
assert module.parse(json.dumps(complete).encode())[0] == "complete"
for invalid in (
    {**complete, "selectedBy": "latest", "deliveryPending": True},
    {**complete, "unexpected": "field"},
    {**complete, "outbox": {**complete["outbox"], "delivered": expected - 1}},
    {**complete, "frozenLastOutboxId": 140},
    {**complete, "projection": {**complete["projection"],
       "videos": {"expected": 4224, "matched": 4223}}},
):
    try:
        module.parse(json.dumps(invalid).encode())
    except RuntimeError:
        pass
    else:
        raise AssertionError("cutover validator accepted inconsistent evidence")
PY
python3 -I - "$activation_boundary" <<'PY'
import importlib.util
import os
from pathlib import Path
import sys
import tempfile

path = Path(sys.argv[1])
spec = importlib.util.spec_from_file_location("creator_tracker_activation_boundary", path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
with tempfile.TemporaryDirectory(prefix="creator-tracker-boundary-") as temporary:
    root = Path(temporary)
    database = root / "state.db"
    database.write_bytes(b"before")
    tree = root / "objects"
    tree.mkdir()
    (tree / "one").write_bytes(b"object-one")
    optional = root / "optional"
    manifest = root / "boundary.json"
    specifications = {
        "database": ("file", str(database)),
        "objects": ("tree", str(tree)),
        "optional": ("optional-file", str(optional)),
    }
    module.write_manifest(str(manifest), specifications)
    module.verify_manifest(
        str(manifest), specifications, manifest_owner=os.getuid(),
    )
    database.write_bytes(b"after!")
    try:
        module.verify_manifest(
            str(manifest), specifications, manifest_owner=os.getuid(),
        )
    except RuntimeError as error:
        assert "crossed" in str(error)
    else:
        raise AssertionError("database content drift did not close the rollback boundary")
    database.write_bytes(b"before")
    (tree / "linked").symlink_to(tree / "one")
    try:
        module.capture_inventory(specifications)
    except RuntimeError as error:
        assert "symlink" in str(error)
    else:
        raise AssertionError("symlinked boundary inventory was accepted")
    (tree / "linked").unlink()
    os.link(tree / "one", tree / "linked")
    try:
        module.capture_inventory(specifications)
    except RuntimeError as error:
        assert "single-link" in str(error)
    else:
        raise AssertionError("hard-linked boundary inventory was accepted")
with tempfile.TemporaryDirectory(prefix="creator-tracker-wal-boundary-") as temporary:
    root = Path(temporary)
    database = root / "legacy.db"
    wal = root / "legacy.db-wal"
    database.write_bytes(b"unchanged-main")
    wal.write_bytes(b"wal-before")
    manifest = root / "boundary.json"
    specifications = {
        "legacyDatabase": ("file", str(database)),
        "legacyDatabaseWal": ("optional-file", str(wal)),
    }
    module.write_manifest(str(manifest), specifications)
    wal.write_bytes(b"wal-after!")
    try:
        module.verify_manifest(
            str(manifest), specifications, manifest_owner=os.getuid(),
        )
    except RuntimeError as error:
        assert "crossed" in str(error)
    else:
        raise AssertionError("WAL-only logical database drift crossed the boundary")
with tempfile.TemporaryDirectory(prefix="creator-tracker-flat-boundary-") as temporary:
    root = Path(temporary)
    imports = root / "imports"
    imports.mkdir()
    (imports / "page.json").write_text("{}")
    specifications = {
        "legacyProviderImports": ("optional-flat-tree", str(imports)),
    }
    module.capture_inventory(specifications)
    nested = imports / "nested"
    nested.mkdir()
    try:
        module.capture_inventory(specifications)
    except RuntimeError as error:
        assert "nested" in str(error)
    else:
        raise AssertionError("recursive legacy imports tree was accepted")
PY
python3 -I - "$tracker_dir/bin/activation-database.py" <<'PY'
import importlib.util
import json
from pathlib import Path
import sqlite3
import sys
import tempfile

sys.dont_write_bytecode = True
path = Path(sys.argv[1])
spec = importlib.util.spec_from_file_location("creator_tracker_activation_database", path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
with tempfile.TemporaryDirectory(prefix="creator-tracker-provider-lease-") as temporary:
    database_path = Path(temporary) / "state.db"
    database = sqlite3.connect(database_path)
    database.execute(
        "CREATE TABLE sync_state (source TEXT PRIMARY KEY, status TEXT, message TEXT)"
    )
    state = {
        "version": 1,
        "state": "ready",
        "reason": None,
        "runId": "fixture-run",
        "requestNumber": 1,
        "reserveCredits": 100,
        "creditsRemaining": 2_000,
        "observedAtMs": 1_788_425_534_563,
        "claimedAtMs": None,
    }
    database.execute(
        "INSERT INTO sync_state (source, status, message) VALUES (?, ?, ?)",
        (
            "instagram_provider_credit_guard",
            "ok",
            "instagram_credit_global_v1=" + json.dumps(
                state, separators=(",", ":")
            ),
        ),
    )
    database.commit()
    database.close()
    module.assert_provider_lease_settled(str(database_path))

    database = sqlite3.connect(database_path)
    pending = {
        **state,
        "state": "request_pending",
        "reason": "request_pending",
        "claimedAtMs": 1_788_425_530_000,
    }
    database.execute(
        "UPDATE sync_state SET status = ?, message = ?",
        (
            "running",
            "instagram_credit_global_v1=" + json.dumps(
                pending, separators=(",", ":")
            ),
        ),
    )
    database.commit()
    database.close()
    try:
        module.assert_provider_lease_settled(str(database_path))
    except RuntimeError as error:
        assert "request_pending" in str(error)
    else:
        raise AssertionError("activation accepted an unsettled paid-provider lease")

    database = sqlite3.connect(database_path)
    database.execute(
        "UPDATE sync_state SET status = 'error', message = ?",
        (
            "instagram_credit_global_v1=" + json.dumps(
                state, separators=(",", ":")
            ),
        ),
    )
    database.commit()
    database.close()
    try:
        module.assert_provider_lease_settled(str(database_path))
    except RuntimeError as error:
        assert "inconsistent" in str(error)
    else:
        raise AssertionError("activation accepted an inconsistent provider lease")

    database = sqlite3.connect(database_path)
    database.execute(
        "UPDATE sync_state SET status = 'error', message = 'malformed'"
    )
    database.commit()
    database.close()
    try:
        module.assert_provider_lease_settled(str(database_path))
    except RuntimeError as error:
        assert "malformed" in str(error)
    else:
        raise AssertionError("activation accepted a malformed paid-provider lease")
PY
python3 -I - "$system_state_helper" "$user_unit_helper" "$durable_state_helper" <<'PY'
import importlib.util
import os
from pathlib import Path
import tempfile
import sys

def load(name, raw_path):
    path = Path(raw_path)
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

system_state = load("creator_tracker_system_state", sys.argv[1])
user_state = load("creator_tracker_user_state", sys.argv[2])
durable = load("creator_tracker_durable", sys.argv[3])
uid = os.getuid()
gid = os.getgid()

with tempfile.TemporaryDirectory(prefix="creator-tracker-system-state-") as temporary:
    root = Path(temporary)
    system = root / "system"
    snapshot = root / "snapshot"
    manifest = root / "manifest.json"
    system.mkdir(mode=0o700)
    service = system / "creator-tracker-worker.service"
    service.write_text("old-service\n")
    service.chmod(0o600)
    alias = root / "external-alias"
    os.link(service, alias)
    try:
        system_state.scan(str(system), uid)
    except RuntimeError as error:
        assert "single-link" in str(error)
    else:
        raise AssertionError("hard-linked system unit was accepted")
    alias.unlink()
    wants = system / "default.target.wants"
    wants.mkdir(mode=0o700)
    (wants / service.name).symlink_to(f"../{service.name}")
    system_state.snapshot(str(system), str(snapshot), str(manifest), uid)
    system_state.remove(str(system), str(snapshot), str(manifest), uid)
    assert not service.exists() and not (wants / service.name).exists()
    service.write_text("candidate-service\n")
    service.chmod(0o600)
    system_state.preflight_restore(str(system), str(snapshot), str(manifest), uid)
    system_state.restore(str(system), str(snapshot), str(manifest), uid)
    assert service.read_text() == "old-service\n"
    assert os.readlink(wants / service.name) == f"../{service.name}"

with tempfile.TemporaryDirectory(prefix="creator-tracker-user-state-") as temporary:
    root = Path(temporary)
    user = root / "user"
    snapshot = root / "snapshot"
    manifest = root / "manifest.json"
    user.mkdir(mode=0o700)
    timer = user / "creator-tracker-provider-reconcile.timer"
    timer.write_text("legacy-timer\n")
    timer.chmod(0o600)
    wants = user / "timers.target.wants"
    wants.mkdir(mode=0o700)
    (wants / timer.name).symlink_to(f"../{timer.name}")
    user_state.snapshot(str(user), str(snapshot), str(manifest), uid)
    user_state.remove(str(user), str(snapshot), str(manifest), uid)
    assert not timer.exists() and not (wants / timer.name).exists()
    conflict = user / "creator-tracker-worker.service"
    conflict.write_text("conflict\n")
    conflict.chmod(0o600)
    try:
        user_state.preflight(str(user), str(snapshot), str(manifest), uid)
    except RuntimeError as error:
        assert "conflicting" in str(error)
    else:
        raise AssertionError("user-unit restore accepted a destination conflict")
    conflict.unlink()
    user_state.restore(str(user), str(snapshot), str(manifest), uid)
    assert timer.read_text() == "legacy-timer\n"
    assert os.readlink(wants / timer.name) == f"../{timer.name}"
    expected = user_state.load(str(manifest), str(snapshot), uid)
    (wants / timer.name).unlink()
    assert not user_state.restored_matches_expected(str(user), expected, uid)

with tempfile.TemporaryDirectory(prefix="creator-tracker-durable-") as temporary:
    root = Path(temporary)
    target = root / "status"
    durable.replace_payload(str(target), b"prepared\n", 0o600, uid, gid)
    assert target.read_bytes() == b"prepared\n"
    durable.replace_symlink("releases/" + "a" * 64, str(root / "current"), uid, gid)
    assert os.readlink(root / "current") == "releases/" + "a" * 64
    durable.durable_unlink(str(root / "current"))
    assert not (root / "current").exists()
    durable.fsync_tree(str(root))
PY
python3 -I - <<PY
import base64
import importlib.util
from pathlib import Path
from types import SimpleNamespace

path = Path("$tracker_dir/bin/render-collector-config.py")
spec = importlib.util.spec_from_file_location("creator_tracker_renderer", path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
certificate = b"-----BEGIN CERTIFICATE-----\nfixture\n-----END CERTIFICATE-----\n"
source = {
    "CREATOR_TRACKER_V2_DATABASE_URL":
        "postgresql://seed:secret@db.example.invalid/postgres?sslmode=verify-full",
    "CREATOR_TRACKER_V2_DATABASE_CA_B64": base64.b64encode(certificate).decode(),
    "CREATOR_INGEST_ALLOWED_ORGANIZATION_IDS": "org-fixture",
    "CREATOR_INGEST_CURRENT_KEY_ID": "fixture-key",
    "CREATOR_INGEST_CURRENT_SECRET_B64": base64.b64encode(b"x" * 48).decode(),
    "CREATOR_TRACKER_INGEST_ENDPOINT":
        "https://example.invalid/api/v1/creator-tracker/ingestion/batches",
}
delivery, seed = module.canonical_role_values(source)
assert delivery["CREATOR_TRACKER_INGEST_ENDPOINT_URL"] == source["CREATOR_TRACKER_INGEST_ENDPOINT"]
assert "CREATOR_TRACKER_V2_DATABASE_URL" not in delivery
assert "CREATOR_INGEST_ALLOWED_ORGANIZATION_IDS" not in delivery
assert seed == {
    "CREATOR_TRACKER_V2_DATABASE_URL": source["CREATOR_TRACKER_V2_DATABASE_URL"],
    "CREATOR_TRACKER_V2_DATABASE_CA_B64": source["CREATOR_TRACKER_V2_DATABASE_CA_B64"],
    "CREATOR_TRACKER_CANONICAL_SEED_ORGANIZATION_ID": "org-fixture",
}
assert module.ROLE_KEYS["provider-reconcile"] == (
    "CREATOR_TRACKER_PROVIDER_ORGANIZATION_ID",
)
assert module.ROLE_KEYS["instagram-credit-rearm"] == (
    "SCRAPECREATORS_API_KEY",
    "SCRAPECREATORS_PROVIDER_CREDIT_RESERVE",
)
assert module.RAW_VERIFIER_DEFAULTS == {
    "CREATOR_TRACKER_RAW_VERIFIER_REVERIFY_AFTER_SECONDS": "604800",
    "CREATOR_TRACKER_RAW_VERIFIER_MANIFEST_LIMIT": "200",
    "CREATOR_TRACKER_RAW_VERIFIER_SCHEDULE_INTERVAL_SECONDS": "300",
    "CREATOR_TRACKER_RAW_VERIFIER_NEW_MANIFEST_SLA_SECONDS": "900",
    "CREATOR_TRACKER_RAW_VERIFIER_EXPECTED_NEW_MANIFESTS_PER_DAY": "90",
    "CREATOR_TRACKER_RAW_VERIFIER_RETENTION_DAYS": "180",
    "CREATOR_TRACKER_RAW_VERIFIER_REVERIFY_SLA_SECONDS": "86400",
    "CREATOR_TRACKER_RAW_VERIFIER_MIN_READ_BYTES_PER_SECOND": "16777216",
    "CREATOR_TRACKER_RAW_VERIFIER_PER_OBJECT_OVERHEAD_MS": "10",
    "CREATOR_TRACKER_RAW_VERIFIER_MAX_TICK_SECONDS": "240",
}
module.pwd.getpwnam = lambda name: SimpleNamespace(pw_uid=1234)
raw_verifier = {
    "CREATOR_TRACKER_RAW_VERIFIER_DATABASE_URL":
        "postgresql://verifier@db.example.invalid/postgres",
    "CREATOR_TRACKER_RAW_VERIFIER_ORGANIZATION_ID": "org-fixture",
    "CREATOR_TRACKER_RAW_VERIFIER_INSTANCE_ID": "laptop-fixture",
    "CREATOR_TRACKER_RAW_EVIDENCE_ROOT":
        "/var/lib/creator-tracker/raw-evidence-v1",
    "CREATOR_TRACKER_RAW_EVIDENCE_OWNER_UID": "1234",
    "CREATOR_TRACKER_RAW_VERIFIER_ARCHIVE_ROOT":
        "/var/lib/creator-tracker/verified-raw-evidence-v1",
    **module.RAW_VERIFIER_DEFAULTS,
}
module.validate_raw_verifier(raw_verifier)
for key, value in (
    ("CREATOR_TRACKER_RAW_VERIFIER_SCHEDULE_INTERVAL_SECONDS", "60"),
    ("CREATOR_TRACKER_RAW_VERIFIER_MAX_TICK_SECONDS", "300"),
    ("CREATOR_TRACKER_RAW_VERIFIER_MIN_READ_BYTES_PER_SECOND", "1048575"),
    ("CREATOR_TRACKER_RAW_VERIFIER_PER_OBJECT_OVERHEAD_MS", "1001"),
):
    try:
        module.validate_raw_verifier({**raw_verifier, key: value})
    except RuntimeError:
        pass
    else:
        raise AssertionError(f"raw verifier renderer accepted unsafe {key}")
try:
    module.canonical_role_values({**source, "UNKNOWN_SECRET": "must-fail"})
except RuntimeError:
    pass
else:
    raise AssertionError("canonical renderer accepted an unknown credential key")
for invalid in (
    {key: value for key, value in source.items()
     if key != "CREATOR_INGEST_CURRENT_SECRET_B64"},
    {
        **source,
        "CREATOR_INGEST_PREVIOUS_KEY_ID": "bad key id",
        "CREATOR_INGEST_PREVIOUS_SECRET_B64":
            base64.b64encode(b"y" * 48).decode(),
    },
):
    try:
        module.canonical_role_values(invalid)
    except RuntimeError:
        pass
    else:
        raise AssertionError("canonical renderer accepted an incomplete or invalid HMAC pair")
PY
grep -Fq 'write_new(credentials / "cutover-verify.env", dotenv(raw_verifier))' \
  "$tracker_dir/bin/render-collector-config.py"
mapfile -t actual_unit_files < <(
  find "$tracker_dir/systemd" -mindepth 1 -maxdepth 1 -type f -printf '%f\n' |
    LC_ALL=C sort
)
mapfile -t sorted_expected_unit_files < <(printf '%s\n' "${expected_unit_files[@]}" | LC_ALL=C sort)
[[ "${actual_unit_files[*]}" == "${sorted_expected_unit_files[*]}" ]]
systemd-analyze verify "${expected_unit_files[@]/#/$tracker_dir/systemd/}"

for timer_file in "$tracker_dir"/systemd/creator-tracker-*.timer; do
  grep -Fq 'Persistent=true' "$timer_file"
  grep -Fq '[Install]' "$timer_file"
  grep -Fq 'WantedBy=timers.target' "$timer_file"
done
for service_file in "$tracker_dir"/systemd/creator-tracker-*.service; do
  expected_proc_subset=pid
  case "${service_file##*/}" in
    creator-tracker-roster-refresh.service|creator-tracker-scheduler-tick.service)
      expected_proc_subset=all
      ;;
  esac
  grep -Fq '/opt/creator-tracker/current/bin/run-contained-job' \
    "$service_file"
  grep -Fqx 'WorkingDirectory=/opt/creator-tracker/current/app' "$service_file"
  grep -Fqx 'Environment=PATH=/usr/bin:/bin' "$service_file"
  grep -Fqx 'UnsetEnvironment=LD_PRELOAD LD_LIBRARY_PATH LD_AUDIT BASH_ENV ENV SHELLOPTS BASHOPTS BASH_LOADABLES_PATH NODE_OPTIONS NODE_PATH PYTHONPATH PYTHONHOME PYTHONSTARTUP PERL5OPT PERL5LIB RUBYOPT RUBYLIB GCONV_PATH TSX_TSCONFIG_PATH CREATOR_TRACKER_RUNTIME_DIR CREATOR_TRACKER_STATE_DIR CREATOR_TRACKER_TEST_ONLY_ALLOW_ARBITRARY_COMMAND CREATOR_TRACKER_TEST_ONLY_SKIP_COVERAGE' \
    "$service_file"
  grep -Eq '^ExecStart=/bin/bash --noprofile --norc -p -- /opt/creator-tracker/current/bin/run-contained-job [a-z0-9-]+$' \
    "$service_file"
  grep -Eq '^User=creator-tracker-(writer|dashboard|health|raw-verifier)$' "$service_file"
  grep -Eq '^Group=creator-tracker-(writer|dashboard|health|raw-verifier)$' "$service_file"
  grep -Fqx 'ProtectHome=tmpfs' "$service_file"
  grep -Fqx 'ProtectSystem=strict' "$service_file"
  grep -Fqx 'ProtectProc=invisible' "$service_file"
  grep -Fqx "ProcSubset=$expected_proc_subset" "$service_file"
  grep -Fqx 'RestrictNamespaces=true' "$service_file"
  grep -Fqx 'CapabilityBoundingSet=' "$service_file"
  grep -Fqx 'AmbientCapabilities=' "$service_file"
  grep -Eq '^EnvironmentFile=/etc/creator-tracker/runtime/[a-z0-9-]+\.env$' "$service_file"
  grep -Eq '^LoadCredential=role-env:/etc/creator-tracker/credentials/[a-z0-9-]+\.env$' "$service_file"
  if grep -Eq '^Exec(StartPre|StartPost|Reload|Stop|StopPost|Condition)=' "$service_file"; then
    printf 'creator-tracker unit contains an unexpected lifecycle command: %s\n' \
      "$service_file" >&2
    exit 1
  fi
  if grep -Fq '.local/libexec/creator-tracker' "$service_file"; then
    printf 'creator-tracker unit still executes a user-writable launcher\n' >&2
    exit 1
  fi
done
[[ "$(head -n 1 -- "$wrapper")" == '#!/bin/bash -p' ]]
[[ "$(head -n 1 -- "$health")" == '#!/bin/bash -p' ]]
[[ "$(head -n 1 -- "$release_verifier")" == '#!/bin/bash -p' ]]
[[ "$(head -n 1 -- "$canonical_seed_runner")" == '#!/bin/bash -p' ]]
[[ "$(head -n 1 -- "$cutover_runner")" == '#!/bin/bash -p' ]]
[[ "$(head -n 1 -- "$raw_verifier_provision_runner")" == '#!/bin/bash -p' ]]
[[ "$(head -n 1 -- "$release_tools_preparer")" == '#!/bin/bash' ]]
for network_service in \
  creator-tracker-roster-refresh.service \
  creator-tracker-scheduler-tick.service \
  creator-tracker-provider-reconcile.service \
  creator-tracker-canonical-delivery.service \
  creator-tracker-raw-verifier.service \
  creator-tracker-instagram-discovery.service \
  creator-tracker-instagram-scheduler.service; do
  grep -Fqx 'Wants=network-online.target' "$tracker_dir/systemd/$network_service"
  grep -Fqx 'After=network-online.target' "$tracker_dir/systemd/$network_service"
done
if rg -q '^ExecStartPre=.*nm-online' "$tracker_dir"/systemd/creator-tracker-*.service; then
  printf '%s\n' 'creator-tracker: sealed services retain a mutable pre-start lane' >&2
  exit 1
fi
if grep -Eq \
  '^CREATOR_TRACKER_INSTAGRAM_(DISCOVERY|SCHEDULER)_EXECUTABLE=' \
  "$tracker_dir/creator-tracker.env.example"; then
  printf '%s\n' \
    'creator-tracker: example enables Instagram before credential smoke' >&2
  exit 1
fi

grep -Fq 'instagram-discovery) release_role=instagram-discovery' "$wrapper"
grep -Fq 'instagram-scheduler) release_role=instagram-scheduler' "$wrapper"
grep -Fq 'instagram-credit-rearm' "$wrapper"
grep -Fq 'canonical-delivery) release_role=canonical-delivery' "$wrapper"
grep -Fq 'raw-verifier) release_role=raw-verifier' "$wrapper"
grep -Fq 'command_args=("$sealed_release_root/bin/$release_role")' "$wrapper"
grep -Fq 'sealed_wrapper' "$wrapper"
if rg -q 'CREATOR_TRACKER_.*_EXECUTABLE' "$wrapper"; then
  printf 'sealed supervisor still trusts an executable path from the environment\n' >&2
  exit 1
fi
grep -Fq 'roster-refresh|provider-reconcile|instagram-discovery|instagram-credit-rearm|migrate-database)' "$wrapper"
grep -Fq 'scheduler-tick)' "$wrapper"
grep -Fq 'instagram-scheduler)' "$wrapper"
instagram_lock_source="$(sed -n '/^  instagram-scheduler)/,/^    ;;/p' "$wrapper")"
grep -Fq 'writer_lock_wait_seconds=300' <<<"$instagram_lock_source"
scheduler_lock_source="$(sed -n '/^  scheduler-tick)/,/^    ;;/p' "$wrapper")"
if grep -Fq 'writer_lock_wait_seconds=' <<<"$scheduler_lock_source"; then
  printf '%s\n' 'creator-tracker: TikTok scheduler must retain nonblocking writer admission' >&2
  exit 1
fi
grep -Fq 'instagram_priority_lock_file="$lock_dir/instagram-scheduler.lock"' "$wrapper"
grep -Fq 'priority_lock_busy' "$wrapper"
grep -Fq 'secondary_lock_name=canonical-delivery' "$wrapper"
grep -Fq 'writer_lock_name=owned-tracker-writer' "$wrapper"
grep -Fq 'writer_lock_wait_seconds=300' "$wrapper"
grep -Fq 'writer_lock_timeout_exit=76' "$wrapper"
grep -Fq 'TimeoutStartSec=15min' \
  "$tracker_dir/systemd/creator-tracker-instagram-scheduler.service"
grep -Fq 'instagram_scheduler_max="${CREATOR_TRACKER_INSTAGRAM_SCHEDULER_SUCCESS_MAX_AGE_SECONDS:-660}"' \
  "$health"
grep -Fqx 'CREATOR_TRACKER_INSTAGRAM_SCHEDULER_SUCCESS_MAX_AGE_SECONDS=660' \
  "$tracker_dir/creator-tracker.env.example"
grep -Fq 'Restart=on-failure' \
  "$tracker_dir/systemd/creator-tracker-provider-reconcile.service"
grep -Fq 'RestartSec=5min' \
  "$tracker_dir/systemd/creator-tracker-provider-reconcile.service"
grep -Fq 'StartLimitIntervalSec=2h' \
  "$tracker_dir/systemd/creator-tracker-provider-reconcile.service"
grep -Fq 'StartLimitBurst=3' \
  "$tracker_dir/systemd/creator-tracker-provider-reconcile.service"
grep -Fq 'StartLimitIntervalSec=10min' \
  "$tracker_dir/systemd/creator-tracker-canonical-delivery.service"
grep -Fq 'StartLimitBurst=20' \
  "$tracker_dir/systemd/creator-tracker-canonical-delivery.service"
grep -Fq 'TimeoutStartSec=90min' \
  "$tracker_dir/systemd/creator-tracker-provider-reconcile.service"
grep -Fq 'OnCalendar=*-*-* 02,14:17:00 UTC' \
  "$tracker_dir/systemd/creator-tracker-provider-reconcile.timer"
grep -Fq 'OnCalendar=*-*-* *:0/5:00' \
  "$tracker_dir/systemd/creator-tracker-raw-verifier.timer"
grep -Fq 'StartLimitIntervalSec=30min' \
  "$tracker_dir/systemd/creator-tracker-raw-verifier.service"
grep -Fq 'StartLimitBurst=8' \
  "$tracker_dir/systemd/creator-tracker-raw-verifier.service"
grep -Fq 'OnCalendar=*:0/3' \
  "$tracker_dir/systemd/creator-tracker-scheduler-tick.timer"
if grep -Eq '^OnUnit(In)?activeSec=' \
  "$tracker_dir/systemd/creator-tracker-raw-verifier.timer"; then
  printf '%s\n' 'raw verifier cadence still adds prior run duration to its five-minute interval' >&2
  exit 1
fi
if grep -Eq '^On(Active|Boot|Startup)Sec=' \
  "$tracker_dir/systemd/creator-tracker-provider-reconcile.timer"; then
  printf 'provider timer must not re-arm a relative trigger on daemon reload\n' >&2
  exit 1
fi
grep -Fq 'Restart=always' \
  "$tracker_dir/systemd/creator-tracker-worker.service"
grep -Fq 'OnCalendar=*-*-* *:03,33:00' \
  "$tracker_dir/systemd/creator-tracker-roster-refresh.timer"
grep -Fq '/usr/bin/setsid --wait -- "${command_args[@]}" &' "$wrapper"
grep -Fq 'worker_status="$state_dir/collector-worker/status"' "$health"
grep -Fq 'instagram_discovery_success="$state_dir/instagram-discovery/success"' "$health"
grep -Fq 'instagram_scheduler_success="$state_dir/instagram-scheduler/success"' "$health"
grep -Fq 'canonical_delivery_success="$state_dir/canonical-delivery/success"' "$health"
grep -Fq 'raw_verifier_success="$state_dir/raw-verifier/success"' "$health"
grep -Fq 'storage_metrics="$state_dir/raw-verifier/storage.metrics"' "$health"
grep -Fq 'CREATOR_TRACKER_STORAGE_MIN_FREE_BYTES:-21474836480' "$health"
grep -Fq 'raw evidence storage metrics are missing or unsafe' "$health"
grep -Fq 'storage reserve is below floor' "$health"
grep -Fq 'cutover_success="$state_dir/cutover-completeness/success"' "$health"
grep -Fq 'canonical cutover completeness marker is missing or unsafe' "$health"
grep -Fq 'canonical cutover result does not match its marker' "$health"
grep -Fq 'status_file="$health_dir/status"' "$wrapper"
grep -Fq 'success_file="$health_dir/success"' "$wrapper"
grep -Fq 'failure_file="$health_dir/failure"' "$wrapper"
test "$(grep -Fc 'chmod 0640 "$tmp"' "$wrapper")" -ge 3
grep -Fq 'mv -fT -- "$tmp" "$status_file"' "$wrapper"
grep -Fq 'mv -fT -- "$tmp" "$marker_file"' "$wrapper"
grep -Fq 'write_storage_metrics()' "$wrapper"
grep -Fq "local source_root='/var/lib/creator-tracker/raw-evidence-v1'" "$wrapper"
grep -Fq "local archive_root='/var/lib/creator-tracker/verified-raw-evidence-v1'" "$wrapper"
grep -Fq '((source_growth >= 0 && archive_growth >= 0)) || return 1' "$wrapper"
grep -Fq 'raw evidence storage metrics could not be recorded' "$wrapper"
grep -Fq '/usr/bin/sync -f "$metrics_file"' "$wrapper"
grep -Fq "expected_storage_metric_keys=\$'archive_cas_bytes\\narchive_growth_bytes" "$health"
grep -Fq "coverage_executable='/opt/creator-tracker/current/bin/check-coverage'" "$health"
if rg -q 'CREATOR_TRACKER_(COVERAGE|INSTAGRAM_.*|PROVIDER)_EXECUTABLE' "$health"; then
  printf 'sealed health checker still trusts executable configuration\n' >&2
  exit 1
fi
grep -Fq "readonly ytdlp_version='2026.08.19'" "$runtime_installer"
grep -Fq "readonly ytdlp_sha256='58162f9bfdc27458ea47bfcb311cf47028f17d8154a8bf7d689861d46399230a'" \
  "$runtime_installer"
grep -Fq "readonly ytdlp_sha512='e51e26f77622a1bf75cdaee869698aebe892d4afd105e677118eb8dfbacef9d34933e7b3c0f1091f3f7f94518ac03bb2504e69be85991c31d61e5e8faeb85f37'" \
  "$runtime_installer"
grep -Fq "readonly signing_key_fingerprint='AC0CBBE6848D6A873464AF4E57CF65933B5A7581'" \
  "$runtime_installer"
grep -Fq 'releases/download/${ytdlp_version}/yt-dlp_linux' "$runtime_installer"
grep -Fq 'readonly install_dir="/opt/creator-tracker/yt-dlp/${ytdlp_version}"' \
  "$runtime_installer"
grep -Fq 'readonly install_path="$install_dir/yt-dlp_linux"' "$runtime_installer"
grep -Fq -- "--proto '=https'" "$runtime_installer"
grep -Fq 'sha256sum "$download_path"' "$runtime_installer"
grep -Fq 'sudo -n install -o root -g root -m 0555' "$runtime_installer"
grep -Fq 'sudo -n mv -f -- "$staged_path" "$install_path"' "$runtime_installer"
grep -Fq -- '--list-impersonate-targets' "$runtime_installer"
grep -Fq -- '--verify "$tmp_dir/SHA2-256SUMS.sig"' "$runtime_installer"
grep -Fq -- '--verify "$tmp_dir/SHA2-512SUMS.sig"' "$runtime_installer"
grep -Fq '"${source_git[@]}" archive --format=tar "$commit"' "$release_installer"
grep -Fq 'creator-tracker-builder' "$release_installer"
grep -Fq 'ci --ignore-scripts' "$builder"
grep -Fq 'audit --audit-level=low' "$builder"
grep -Fq 'rebuild --offline' "$builder"
grep -Fq '"$tool_bin/node" "$npm_cli" test' "$builder"
grep -Fq '"$tool_bin/node" "$npm_cli" run typecheck' "$builder"
grep -Fq '"$tool_bin/node" "$npm_cli" run build' "$builder"
verify_phase="$(awk '
  /^  verify\)$/ { capture=1 }
  capture { print }
  capture && /^    ;;/ { exit }
' "$builder")"
if rg -q 'audit|verify:release' <<<"$verify_phase"; then
  printf '%s\n' 'private verification phase still depends on the network-backed npm audit' >&2
  exit 1
fi
grep -Fq "'GOTALL_SHADOW_MODE=0'" "$builder"
grep -Fq "'GOTALL_MODE_ZERO_FIXTURE=1'" "$builder"
grep -Fq 'VIRAL_DB_PATH=$build_fixture/gotall-build.db' "$builder"
grep -Fq 'build_fixture="/tmp/creator-tracker-release-build-$release_id"' \
  "$builder"
grep -Fq 'candidate javascript performs' <(tr '[:upper:]' '[:lower:]' <"$builder")
grep -Fq '"$tool_bin/node" --import tsx --input-type=module' "$builder"
grep -Fq -- "-e \"await import('./src/db/index.ts')\"" "$builder"
[[ "$(grep -Fc 'VIRAL_DB_PATH=$build_fixture/gotall-build.db' "$builder")" -eq 2 ]]
bootstrap_line="$(grep -nF -- "-e \"await import('./src/db/index.ts')\"" "$builder" | cut -d: -f1)"
build_line="$(grep -nF '"$tool_bin/node" "$npm_cli" run build' "$builder" | cut -d: -f1)"
[[ "$bootstrap_line" -lt "$build_line" ]]
grep -Fq 'env -i' "$release_installer"
grep -Fq -- '--property=ProcSubset=all --property=RestrictNamespaces=yes' \
  "$release_installer"
grep -Fq -- '--property=PrivateNetwork=yes' "$release_installer"
grep -Fq -- "--property=RestrictAddressFamilies='AF_UNIX AF_INET AF_INET6'" \
  "$release_installer"
grep -Fq 'otherwise disconnected private network namespace' "$release_installer"
grep -Fq 'chown -hR root:root "$release_stage" "$build_home" "$npm_cache"' \
  "$release_installer"
grep -Fq 'Revoke its traversal group from the whole candidate' "$release_installer"
grep -Fq -- '-/etc/creator-tracker /var/lib/creator-tracker' \
  "$raw_verifier_provision_runner"
grep -Fq -- '-/home/ark296/.ssh -/home/ark296/.aws -/home/ark296/.config/gcloud' \
  "$raw_verifier_provision_runner"
grep -Fq 'HOME=$build_home' "$builder"
grep -Fq 'NPM_CONFIG_USERCONFIG=/dev/null' "$builder"
grep -Fq 'node_gyp="${npm_cli%/bin/npm-cli.js}/node_modules/node-gyp/bin/node-gyp.js"' \
  "$builder"
grep -Fq 'rebuild --release --force_build=1' "$builder"
grep -Fq '"NPM_CONFIG_NODEDIR=${tool_bin%/bin}"' "$builder"
grep -Fq 'cp --reflink=never --preserve=mode,timestamps --' "$builder"
grep -Fq "source-built runtime addon still has an unsafe inode alias" "$builder"
grep -Fq "13.0.3 ]] || fail 'better-sqlite3 release version is not the reviewed pin'" \
  "$builder"
grep -Fq 'unlink -- "$native_prebuild"' "$builder"
grep -Fq 'BETTER_SQLITE3_EXPECTED_BINDING="$native_build"' "$builder"
grep -Fq '/opt/creator-tracker/node/v24.20.0' "$builder"
grep -Fq "archive_sha256='2f2c0da162318f0de47665410c7c8c2ed3d36c8f3105de4bbc61176c70a7cbf2'" \
  "$node_installer"
grep -Fq 'verify_immutable_provenance' "$node_installer"
grep -Fq 'find "$install_dir" -xdev -type d -exec chmod 0555 {} +' "$node_installer"
grep -Fq 'find "$extract" -xdev -type d -exec chmod 0555 {} +' "$node_installer"
grep -Fq 'reviewed root-controlled release-tools bundle' "$release_installer"
grep -Fq 'release-tools bundle ownership, mutability, or inventory is unsafe' "$release_installer"
grep -Fq 'TOOLS_MANIFEST.sha256' "$release_installer"
grep -Fq 'release-tools manifest does not exactly cover every bundled file' "$release_installer"
grep -Fq 'TOOLS_MANIFEST.sha256' "$node_installer"
grep -Fq 'prepare the content-addressed bundle without root privileges' \
  "$release_tools_preparer"
grep -Fq 'TOOLS_MANIFEST.sha256' "$release_tools_preparer"
grep -Fq 'install -d -o root -g root -m 0751 /var/lib/creator-tracker' "$release_installer"
grep -Fq 'install -d -o root -g creator-tracker-builder -m 0710' \
  "$release_installer"
grep -Fq "'root creator-tracker-builder 710'" "$release_installer"
grep -Fq 'install -m 0755 "$supervisor" "$release_stage/bin/run-contained-job"' \
  "$release_installer"
grep -Fq 'install -m 0755 "$health_checker" "$release_stage/bin/check-dashboard-health"' \
  "$release_installer"
grep -Fq 'install -m 0755 "$canonical_seed_runner" "$release_stage/bin/run-canonical-seed"' \
  "$release_installer"
grep -Fq 'install -m 0755 "$cutover_runner" "$release_stage/bin/run-cutover-completeness"' \
  "$release_installer"
grep -Fq '"$release_stage/bin/run-instagram-credit-rearm"' "$release_installer"
grep -Fq '"$release_stage/bin/run-raw-verifier-provision"' "$release_installer"
grep -Fq 'install -m 0755 "$cutover_result_validator" "$release_stage/bin/validate-cutover-result"' \
  "$release_installer"
grep -Fq 'ops/owned-tracker/release-env.mjs' "$release_installer"
grep -Fq '/usr/bin/env -i --' "$release_verifier"
grep -Fq 'unknown key is forbidden' "$release_verifier"
grep -Fq "tracked_basename" "$release_installer"
grep -Fq ".env.example" "$release_installer"
if grep -Fq 'ls-tree -r --name-only "$commit" |' "$release_installer"; then
  printf 'release dotenv guard must not use an early-closing ls-tree pipeline\n' >&2
  exit 1
fi
grep -Fq 'cp --reflink=never --preserve=mode,timestamps' "$release_installer"
grep -Fq "readonly release_parent='/opt/creator-tracker/releases'" "$release_installer"
grep -Fq 'mv -T -- "$root_stage" "$target"' "$release_installer"
grep -Fq '"$root_stage/bin/verify-release" --root-staged' "$release_installer"
grep -Fq 'MANIFEST.sha256' "$release_verifier"
grep -Fq 'find "$release_dir" -xdev -type f -links +1' "$release_verifier"
grep -Fq 'release symlink escapes the release' "$release_verifier"
grep -Fq -- '--expected-current' "$release_activator"
grep -Fq -- '--allow-rollback' "$release_activator"
grep -Fq -- '--recover' "$release_activator"
grep -Fq -- '--prepare-identities' "$release_activator"
grep -Fq -- '--restore-legacy' "$release_activator"
grep -Fq 'legacy-restore-boundary.json' "$release_activator"
grep -Fq 'activation-boundary" verify' "$release_activator"
grep -Fq 'activation-boundary" record' "$release_activator"
grep -Fq 'mutable state crossed the recorded first-cutover restoration boundary' \
  "$activation_boundary"
legacy_restore_source="$(sed -n '/^restore_committed_first_cutover()/,/^}/p' "$release_activator")"
grep -Fq 'assert_existing_identities' <<<"$legacy_restore_source"
if grep -Fq 'prepare_identities_and_state' <<<"$legacy_restore_source"; then
  printf '%s\n' 'legacy restoration mutates bounded state before boundary verification' >&2
  exit 1
fi
grep -Fq '"legacyDatabase": ("file", "/home/ark296/projects/gotall-viral-dash/data/gotall-viral.db")' \
  "$activation_boundary"
grep -Fq '"legacyDatabaseWal": (' "$activation_boundary"
grep -Fq '"legacyDatabaseShm": (' "$activation_boundary"
grep -Fq '"legacyDatabaseJournal": (' "$activation_boundary"
grep -Fq '"legacyProviderImports": (' "$activation_boundary"
grep -Fq 'mutable state changed between stable inventory passes' "$activation_boundary"
boundary_record_line="$(grep -nF 'activation-boundary" record' "$release_activator" | cut -d: -f1)"
commit_status_line="$(grep -nF 'durable_text "$transaction/status" committed' \
  "$release_activator" | tail -n1 | cut -d: -f1)"
[[ "$boundary_record_line" -lt "$commit_status_line" ]]
prepare_dispatch="$(awk '
  /^if \[\[ "\$mode" == prepare-identities \]\]; then$/ { capture=1 }
  capture { print }
  capture && /^fi$/ { exit }
' "$release_activator")"
grep -Fq 'prepare_identities_and_state' <<<"$prepare_dispatch"
grep -Fq 'exit 0' <<<"$prepare_dispatch"
if rg -q 'systemctl|selector|config_dir|database|provider_imports|raw_evidence|verified_raw_evidence|render-config|unit_files' \
    <<<"$prepare_dispatch"; then
  printf '%s\n' 'prepare-identities dispatch can mutate activation/config/database state' >&2
  exit 1
fi
prepare_function="$(awk '
  /^prepare_identities_and_state\(\) \{$/ { capture=1 }
  capture { print }
  capture && /^}$/ { exit }
' "$release_activator")"
if rg -q 'systemctl|selector|config_dir|provider_imports|raw_evidence|verified_raw_evidence|render-config|unit_files|"\$database"|\b(cp|mv|rm)\b' \
    <<<"$prepare_function"; then
  printf '%s\n' 'prepare-identities helper exceeds identities and state-root creation' >&2
  exit 1
fi
grep -Fq "readonly marker='/opt/creator-tracker/ACTIVATION_IN_PROGRESS'" "$release_activator"
grep -Fq "readonly activation_lock='/opt/creator-tracker/activation.lock'" "$release_activator"
grep -Fq "readonly system_unit_dir='/etc/systemd/system'" "$release_activator"
grep -Fq '/usr/bin/flock -n "$activation_fd"' "$release_activator"
grep -Fq 'expected-current CAS changed before selector mutation' "$release_activator"
grep -Fq 'database.backup' "$release_activator"
grep -Fq 'setfacl --restore="$transaction/database.acl"' "$release_activator"
snapshot_live_state_source="$(sed -n '/^snapshot_live_state()/,/^}/p' "$release_activator")"
if rg -q 'getfacl.*database-(wal|shm)' <<<"$snapshot_live_state_source"; then
  printf '%s\n' 'rollback ACL journal still names ephemeral SQLite sidecars' >&2
  exit 1
fi
grep -Fq 'quarantine_legacy_user_units "$transaction"' "$release_activator"
grep -Fq 'snapshot_legacy_user_units "$transaction"' "$release_activator"
grep -Fq 'preflight_legacy_user_units "$transaction"' "$release_activator"
grep -Fq 'remove_system_unit_state "$transaction"' "$release_activator"
grep -Fq 'preflight_system_units "$transaction"' "$release_activator"
if rg -q 'mv -T -- "\$path" "\$target"|rm -rf -- "\$user_unit_dir"' "$release_activator"; then
  printf '%s\n' 'legacy user-unit quarantine still moves mutable owner inodes or recurses in home' >&2
  exit 1
fi
marker_publish_line="$(grep -nF '"$durable_state" copy "$transaction/marker" "$marker"' "$release_activator" | cut -d: -f1)"
phase_mutating_line="$(grep -nF 'durable_text "$transaction/phase" mutating' "$release_activator" | cut -d: -f1)"
first_mutation_line="$(grep -nF 'quarantine_legacy_user_units "$transaction"' "$release_activator" | tail -n1 | cut -d: -f1)"
phase_committed_line="$(grep -nF 'durable_text "$transaction/phase" committed' "$release_activator" | tail -n1 | cut -d: -f1)"
marker_unlink_line="$(grep -nF 'durable_unlink "$marker"' "$release_activator" | tail -n1 | cut -d: -f1)"
[[ "$marker_publish_line" -lt "$phase_mutating_line" && \
   "$phase_mutating_line" -lt "$first_mutation_line" && \
   "$phase_committed_line" -lt "$marker_unlink_line" ]]
grep -Fq 'transaction was already durably committed' "$release_activator"
grep -Fq 'committed transaction status without a committed phase is ambiguous' "$release_activator"
grep -Fq 'activation recovery must use the transaction candidate release' "$release_activator"
grep -Fq 'prepared legacy restoration conflicts with the current selector' "$release_activator"
# Bash does not permit a function-local variable to shadow a global readonly
# variable. Exercise assert_installed_units with the exact top-level name that
# previously caused activation to fail after staging the candidate tuple.
(
  eval "$(sed -n '/^assert_installed_units()/,/^}/p' "$release_activator")"
  readonly release='/fixture/candidate'
  unit_files=()
  service_units=()
  assert_no_unit_overrides() { :; }
  assert_installed_units "$release"
)
# Exercise the exact pure decision functions used by --recover at each durable
# kill boundary. Static ordering above proves where those phases are published;
# these cases prove a precommit crash rolls back and a committed crash never
# discards the new tuple.
eval "$(sed -n \
  -e '/^activation_recovery_action()/,/^}/p' \
  -e '/^legacy_restore_recovery_action()/,/^}/p' \
  "$release_activator")"
fail() { printf 'fixture recovery failure: %s\n' "$*" >&2; exit 1; }
old_release=none
new_release="$(printf 'a%.0s' {1..64})"
for phase in prepared mutating rolling-back; do
  [[ "$(activation_recovery_action "$phase" '' "$old_release" \
    "$old_release" "$new_release")" == rollback-activation ]]
done
[[ "$(activation_recovery_action rolling-back rolled-back "$old_release" \
  "$old_release" "$new_release")" == rollback-activation ]]
[[ "$(activation_recovery_action committed '' "$new_release" \
  "$old_release" "$new_release")" == finalize-activation ]]
[[ "$(activation_recovery_action committed committed "$new_release" \
  "$old_release" "$new_release")" == finalize-activation ]]
[[ "$(activation_recovery_action rolled-back rolled-back "$old_release" \
  "$old_release" "$new_release")" == finalize-rollback ]]
if (activation_recovery_action mutating committed "$new_release" \
    "$old_release" "$new_release") >/dev/null 2>&1; then
  printf '%s\n' 'ambiguous committed activation status was accepted' >&2
  exit 1
fi
[[ "$(legacy_restore_recovery_action prepared committed "$new_release" \
  "$old_release" "$new_release")" == preflight-restore ]]
[[ "$(legacy_restore_recovery_action mutating committed "$new_release" \
  "$old_release" "$new_release")" == resume-restore ]]
[[ "$(legacy_restore_recovery_action mutating committed "$old_release" \
  "$old_release" "$new_release")" == resume-restore ]]
[[ "$(legacy_restore_recovery_action committed committed "$old_release" \
  "$old_release" "$new_release")" == finalize-restore ]]
if (legacy_restore_recovery_action committed committed "$new_release" \
    "$old_release" "$new_release") >/dev/null 2>&1; then
  printf '%s\n' 'committed legacy restore with new selector was accepted' >&2
  exit 1
fi

# Exercise the activation quiesce protocol independently of systemd. An active
# paid-provider job must be allowed to settle while only its timer is stopped;
# activation may stop the non-provider dashboard worker only after the drain.
activation_quiesce_source=''
for function_name in \
  activation_systemctl activation_user_systemctl activation_unit_state \
  activation_unit_result activation_state_is_busy \
  activation_state_should_restore activation_append_unique \
  activation_stop_unit activation_start_unit activation_sleep \
  stop_activation_timers verify_activation_drained_job_results \
  wait_for_activation_jobs_to_drain stop_activation_workers \
  restore_quiesced_runtime quiesce_runtime_for_activation; do
  function_source="$(sed -n "/^${function_name}()/,/^}/p" "$release_activator")"
  [[ -n "$function_source" ]]
  activation_quiesce_source+="$function_source"$'\n'
done
eval "$activation_quiesce_source"

(
  activation_timer_units=(fixture-instagram.timer)
  activation_drain_service_units=(fixture-instagram.service)
  activation_worker_units=(fixture-dashboard.service)
  declare -A fixture_state=(
    [fixture-instagram.timer]=active
    [fixture-instagram.service]=active
    [fixture-dashboard.service]=active
  )
  declare -A fixture_result=(
    [fixture-instagram.service]=success
  )
  declare -a fixture_calls=()
  lease_state=request_pending
  lease_owner_running=1
  lease_orphaned=0
  activation_systemctl() {
    local operation="$1"
    local unit="${2:-}"
    case "$operation" in
      is-active) printf '%s\n' "${fixture_state[$unit]:-inactive}" ;;
      show) printf '%s\n' "${fixture_result[$unit]:-success}" ;;
      stop)
        fixture_calls+=("stop:$unit")
        if [[ "$unit" == fixture-instagram.service ]]; then
          lease_owner_running=0
          lease_orphaned=1
        fi
        fixture_state[$unit]=inactive
        ;;
      start)
        fixture_calls+=("start:$unit")
        fixture_state[$unit]=active
        ;;
      *) return 64 ;;
    esac
  }
  activation_user_systemctl() {
    case "$1" in
      is-active) printf '%s\n' inactive ;;
      show) printf '%s\n' success ;;
      stop|start) return 0 ;;
      *) return 64 ;;
    esac
  }
  activation_sleep() {
    fixture_calls+=(sleep)
    fixture_state[fixture-instagram.service]=inactive
    lease_state=ready
    lease_owner_running=0
  }

  quiesce_runtime_for_activation 5 0
  [[ "$lease_state" == ready && "$lease_owner_running" -eq 0 && \
     "$lease_orphaned" -eq 0 ]]
  [[ "${activation_observed_system_jobs[*]}" == fixture-instagram.service ]]
  [[ " ${fixture_calls[*]} " == \
     *' stop:fixture-instagram.timer sleep stop:fixture-dashboard.service '* ]]
  [[ " ${fixture_calls[*]} " != *' stop:fixture-instagram.service '* ]]
  restore_quiesced_runtime
  [[ " ${fixture_calls[*]} " == \
     *' start:fixture-dashboard.service start:fixture-instagram.timer '* ]]
)

# A stuck provider job makes activation abort at the bounded deadline. The
# activator must not signal it, must not stop the dashboard worker, and must
# resume a timer it quiesced. The request_pending lease remains owned by the
# still-running fixture job rather than becoming an orphan.
(
  activation_timer_units=(fixture-instagram.timer)
  activation_drain_service_units=(fixture-instagram.service)
  activation_worker_units=(fixture-dashboard.service)
  declare -A fixture_state=(
    [fixture-instagram.timer]=active
    [fixture-instagram.service]=active
    [fixture-dashboard.service]=active
  )
  declare -a fixture_calls=()
  lease_state=request_pending
  lease_owner_running=1
  activation_systemctl() {
    local operation="$1"
    local unit="${2:-}"
    case "$operation" in
      is-active) printf '%s\n' "${fixture_state[$unit]:-inactive}" ;;
      show) printf '%s\n' success ;;
      stop) fixture_calls+=("stop:$unit"); fixture_state[$unit]=inactive ;;
      start) fixture_calls+=("start:$unit"); fixture_state[$unit]=active ;;
      *) return 64 ;;
    esac
  }
  activation_user_systemctl() {
    case "$1" in
      is-active) printf '%s\n' inactive ;;
      show) printf '%s\n' success ;;
      stop|start) return 0 ;;
      *) return 64 ;;
    esac
  }
  activation_sleep() { fixture_calls+=(sleep); }

  if quiesce_runtime_for_activation 0 0 2>/dev/null; then
    printf '%s\n' 'activation accepted a provider job past its drain deadline' >&2
    exit 1
  fi
  [[ "$lease_state" == request_pending && "$lease_owner_running" -eq 1 ]]
  [[ " ${fixture_calls[*]} " != *' stop:fixture-instagram.service '* ]]
  [[ " ${fixture_calls[*]} " != *' stop:fixture-dashboard.service '* ]]
  restore_quiesced_runtime
  [[ " ${fixture_calls[*]} " == *' start:fixture-instagram.timer '* ]]
)

# A job that drains by failing is not a safe cutover boundary. Refuse the
# activation without signalling the service or stopping the dashboard worker.
(
  activation_timer_units=(fixture-instagram.timer)
  activation_drain_service_units=(fixture-instagram.service)
  activation_worker_units=(fixture-dashboard.service)
  declare -A fixture_state=(
    [fixture-instagram.timer]=active
    [fixture-instagram.service]=active
    [fixture-dashboard.service]=active
  )
  declare -A fixture_result=(
    [fixture-instagram.service]=exit-code
  )
  declare -a fixture_calls=()
  activation_systemctl() {
    local operation="$1"
    local unit="${2:-}"
    case "$operation" in
      is-active) printf '%s\n' "${fixture_state[$unit]:-inactive}" ;;
      show) printf '%s\n' "${fixture_result[$unit]:-success}" ;;
      stop) fixture_calls+=("stop:$unit"); fixture_state[$unit]=inactive ;;
      start) fixture_calls+=("start:$unit"); fixture_state[$unit]=active ;;
      *) return 64 ;;
    esac
  }
  activation_user_systemctl() {
    case "$1" in
      is-active) printf '%s\n' inactive ;;
      show) printf '%s\n' success ;;
      stop|start) return 0 ;;
      *) return 64 ;;
    esac
  }
  activation_sleep() { fixture_state[fixture-instagram.service]=failed; }

  if quiesce_runtime_for_activation 5 0 2>/dev/null; then
    printf '%s\n' 'activation accepted an unsuccessfully drained provider job' >&2
    exit 1
  fi
  [[ " ${fixture_calls[*]} " != *' stop:fixture-instagram.service '* ]]
  [[ " ${fixture_calls[*]} " != *' stop:fixture-dashboard.service '* ]]
  restore_quiesced_runtime
  [[ " ${fixture_calls[*]} " == *' start:fixture-instagram.timer '* ]]
)

# The idle path is immediate and deterministic: quiesce the live timer, stop
# only the long-running non-provider worker, then leave both stopped for the
# existing migration/cutover gates.
(
  activation_timer_units=(fixture-instagram.timer)
  activation_drain_service_units=(fixture-instagram.service)
  activation_worker_units=(fixture-dashboard.service)
  declare -A fixture_state=(
    [fixture-instagram.timer]=active
    [fixture-instagram.service]=inactive
    [fixture-dashboard.service]=active
  )
  declare -a fixture_calls=()
  sleep_calls=0
  activation_systemctl() {
    local operation="$1"
    local unit="${2:-}"
    case "$operation" in
      is-active) printf '%s\n' "${fixture_state[$unit]:-inactive}" ;;
      show) printf '%s\n' success ;;
      stop) fixture_calls+=("stop:$unit"); fixture_state[$unit]=inactive ;;
      start) fixture_calls+=("start:$unit"); fixture_state[$unit]=active ;;
      *) return 64 ;;
    esac
  }
  activation_user_systemctl() {
    case "$1" in
      is-active) printf '%s\n' inactive ;;
      show) printf '%s\n' success ;;
      stop|start) return 0 ;;
      *) return 64 ;;
    esac
  }
  activation_sleep() { sleep_calls=$((sleep_calls + 1)); }

  quiesce_runtime_for_activation 0 0
  [[ "$sleep_calls" -eq 0 && ${#activation_observed_system_jobs[@]} -eq 0 ]]
  [[ "${fixture_calls[*]}" == \
     'stop:fixture-instagram.timer stop:fixture-dashboard.service' ]]
  [[ "$activation_runtime_restore_required" -eq 1 ]]
)

quiesce_call_line="$(grep -nF 'quiesce_runtime_for_activation \' \
  "$release_activator" | tail -n1 | cut -d: -f1)"
fence_call_line="$(grep -nF 'acquire_job_locks' "$release_activator" | \
  tail -n1 | cut -d: -f1)"
provider_lease_line="$(grep -nF 'assert-provider-lease-settled' \
  "$release_activator" | cut -d: -f1)"
[[ "$quiesce_call_line" -lt "$fence_call_line" && \
   "$fence_call_line" -lt "$provider_lease_line" && \
   "$provider_lease_line" -lt "$marker_publish_line" ]]
grep -Fq 'restore_quiesced_runtime' "$release_activator"
grep -Fq 'activation_drain_timeout_seconds=5700' "$release_activator"
grep -Fq 'paid-provider credit lease is still request_pending' \
  "$tracker_dir/bin/activation-database.py"
grep -Fq 'ensure_system_identity creator-tracker-raw-verifier creator-tracker-raw-evidence' "$release_activator"
grep -Fq '"$data_dir/cutover-completeness"' "$release_activator"
grep -Fq 'd /var/lib/creator-tracker/state/cutover-completeness 0750 root creator-tracker-health -' \
  "$tracker_dir/tmpfiles.d/creator-tracker.conf"
grep -Fqx \
  'a /run/creator-tracker/locks/canonical-delivery.lock - - - - u:creator-tracker-writer:rw-,u:creator-tracker-health:rw-,m::rw-,o::---' \
  "$tracker_dir/tmpfiles.d/creator-tracker.conf"
grep -Fqx \
  'a /run/creator-tracker/locks/owned-tracker-writer.lock - - - - u:creator-tracker-writer:rw-,u:creator-tracker-health:rw-,m::rw-,o::---' \
  "$tracker_dir/tmpfiles.d/creator-tracker.conf"
grep -Fq "canonical-delivery|owned-tracker-writer)" "$release_activator"
grep -Fq "user_acl='u:creator-tracker-writer:rw-,u:creator-tracker-health:rw-'" \
  "$release_activator"
grep -Fq "sed '/^$/d' | LC_ALL=C sort" "$release_activator"
grep -Fq 'shared health/writer lock ACL is not exact' "$release_activator"
grep -Fq 'migrate-provider-imports' "$release_activator"
grep -Fq 'apply_provider_imports_acl' "$release_activator"
grep -Fq 'assert_provider_imports_tree' "$release_activator"
grep -Fq 'old-imports-present' "$release_activator"
grep -Fq '$3 == candidate' "$release_activator"
python3 -I - "$release_activator" <<'PY'
from pathlib import Path
import re
import sys

source = Path(sys.argv[1]).read_text()
inventory = re.search(r"^db_directory_acl\(\) \{\n(.*?)^\}", source, re.M | re.S)
apply_acl = re.search(r"^apply_database_acl\(\) \{\n(.*?)^\}", source, re.M | re.S)
assert inventory is not None and apply_acl is not None
for role in ("dashboard", "health", "raw-verifier"):
    assert f"default:user:creator-tracker-{role}:r--" in inventory.group(1)
    assert f"default:user:creator-tracker-{role}:r-x" not in inventory.group(1)
    assert f"u:creator-tracker-{role}:r--" in apply_acl.group(1)
assert "default:user:creator-tracker-writer:rw-" in inventory.group(1)
assert "default:user:creator-tracker-writer:rwx" not in inventory.group(1)
assert "u:creator-tracker-writer:rw-" in apply_acl.group(1)
PY
for service in roster-refresh scheduler-tick instagram-discovery \
  instagram-scheduler provider-reconcile canonical-delivery raw-verifier \
  dashboard-health; do
  grep -Fq "creator-tracker-$service.service" "$release_activator"
done
grep -Fq 'active|activating|deactivating|reloading' "$release_activator"
grep -Fq '"$release/bin/migrate-database"' "$release_activator"
if sed -n '/migration_unit=/,/assert_database_acl/p' "$release_activator" | \
    grep -Fq 'run-contained-job'; then
  printf '%s\n' 'activation migration re-enters the writer-locking job wrapper' >&2
  exit 1
fi
grep -Fq 'effective ExecStart is not the sealed role mapping' "$release_activator"
grep -Fq 'effective process isolation is incomplete' "$release_activator"
grep -Fq 'Services were not restarted and timers were not enabled.' "$release_activator"
grep -Fq 'instagram-credit-rearm:creator-tracker-writer' "$release_activator"
grep -Fq '/run/creator-tracker/locks/instagram-credit-rearm.lock' \
  "$tracker_dir/tmpfiles.d/creator-tracker.conf"
grep -Fq "mkdir -m 0700 -- \"\$transaction\" || fail 'activation transaction ID already exists'" \
  "$release_activator"
grep -Fq 'runner release is not the current sealed release' "$canonical_seed_runner"
grep -Fq 'managed unit must be inactive during the one-time seed' "$canonical_seed_runner"
grep -Fq 'User=creator-tracker-writer' "$canonical_seed_runner"
grep -Fq 'LoadCredential=role-env:$credential' "$canonical_seed_runner"
grep -Fq 'TimeoutStartSec=180min' "$canonical_seed_runner"
grep -Fq 'InaccessiblePaths=' "$canonical_seed_runner"
grep -Fq -- '--database-path "$database"' "$canonical_seed_runner"
grep -Fq -- '--database-path "$external_database"' \
  /home/ark296/projects/gotall-viral-dash/ops/owned-tracker/release-entrypoint
grep -Fq 'runner release is not the current sealed release' \
  "$instagram_credit_rearm_runner"
grep -Fq -- '--confirm-provider-launch-balance-at-least-1250' \
  "$instagram_credit_rearm_runner"
grep -Fq -- '--confirm-provider-top-up-one-request' \
  "$instagram_credit_rearm_runner"
grep -Fq 'LoadCredential=role-env:$credential' "$instagram_credit_rearm_runner"
grep -Fq '"$release/bin/run-contained-job"' "$instagram_credit_rearm_runner"
grep -Fq 'instagram-credit-rearm' "$instagram_credit_rearm_runner"
grep -Fq 'the production cutover marker belongs to another release' \
  "$instagram_credit_rearm_runner"
grep -Fq 'systemctl enable --now "$discovery_timer" "$scheduler_timer"' \
  "$instagram_credit_rearm_runner"
grep -Fq 'persistent managed unit must not be enabled before the cutover gate' \
  "$cutover_runner"
grep -Fq '/usr/bin/flock -n "$writer_fd"' "$cutover_runner"
grep -Fq '/usr/bin/flock -n "$delivery_fd"' "$cutover_runner"
grep -Fq '/usr/bin/flock -n "$verifier_fd"' "$cutover_runner"
grep -Fq 'User=creator-tracker-raw-verifier' "$cutover_runner"
grep -Fq 'User=creator-tracker-writer' "$cutover_runner"
grep -Fq '"$release/bin/cutover-verify" "${role_args[@]}"' "$cutover_runner"
grep -Fq '"$result_validator" <"$scratch/result.json"' "$cutover_runner"
grep -Fq 'cutover drain exceeded its one-hour verified time bound' "$cutover_runner"
grep -Fq '"$check_selected" == producer_run_id' "$cutover_runner"
grep -Fq '"$check_first_outbox" == "$frozen_first_outbox_id"' "$cutover_runner"
grep -Fq '"$check_projection" == "$projection_summary"' "$cutover_runner"
grep -Fq '/usr/bin/sync -f "$cutover_state/result.json"' "$cutover_runner"
grep -Fq '/usr/bin/sync -f "$cutover_state"' "$cutover_runner"
eval "$(sed -n '/^cutover_advance_action()/,/^}/p' "$cutover_runner")"
[[ "$(cutover_advance_action pending 1 0 0)" == delivery ]]
[[ "$(cutover_advance_action pending 0 1 1)" == raw-verifier ]]
[[ "$(cutover_advance_action complete 0 0 1)" == finish ]]
[[ "$(cutover_advance_action complete 0 0 0)" == recheck ]]
if (cutover_advance_action pending 0 0 1) >/dev/null 2>&1; then
  printf '%s\n' 'pending cutover without an advanceable queue was accepted' >&2
  exit 1
fi
cutover_check_source="$(sed -n '/^run_cutover_check()/,/^}/p' "$cutover_runner")"
delivery_source="$(sed -n '/^run_delivery_once()/,/^}/p' "$cutover_runner")"
raw_source="$(sed -n '/^run_verifier_once()/,/^}/p' "$cutover_runner")"
if grep -Fq 'SuccessExitStatus=75' <<<"$cutover_check_source"; then
  printf '%s\n' 'cutover verifier pending exit 75 is still normalized to zero' >&2
  exit 1
fi
grep -Fq '[[ "$exit_code" == 75 ]]' <<<"$cutover_check_source"
grep -Fq 'SuccessExitStatus=75' <<<"$delivery_source"
grep -Fq 'SuccessExitStatus=75' <<<"$raw_source"
grep -Fq 'User=ark296' "$raw_verifier_provision_runner"
grep -Fq 'NoNewPrivileges=yes' "$raw_verifier_provision_runner"
grep -Fq 'ProtectHome=tmpfs' "$raw_verifier_provision_runner"
grep -Fq 'ReadOnlyPaths=$admin_env $canonical_env' "$raw_verifier_provision_runner"
grep -Fq "InaccessiblePaths='-/usr/bin/sudo" "$raw_verifier_provision_runner"
grep -Fq '"$release/runtime/node" --import tsx' "$raw_verifier_provision_runner"
if rg -q '(npm|npx|pnpm|yarn)[[:space:]]' "$raw_verifier_provision_runner"; then
  printf '%s\n' 'raw verifier provisioning invokes a package lifecycle tool' >&2
  exit 1
fi
if rg -q '/home/ark296/projects/gotall-viral-dash/ops/owned-tracker/' \
  "$tracker_dir/creator-tracker.env.example"; then
  printf '%s\n' 'creator-tracker example still executes the mutable worktree' >&2
  exit 1
fi

tmp_dir="$(mktemp -d)"
cleanup() {
  if [[ -n "${signal_supervisor_pid:-}" ]]; then
    kill -TERM "$signal_supervisor_pid" 2>/dev/null || true
    wait "$signal_supervisor_pid" 2>/dev/null || true
  fi
  if [[ -n "${server_pid:-}" ]]; then
    kill "$server_pid" 2>/dev/null || true
    wait "$server_pid" 2>/dev/null || true
  fi
  chmod -R u+w -- "$tmp_dir" >/dev/null 2>&1 || true
  rm -rf -- "$tmp_dir"
}
trap cleanup EXIT

# Privileged Bash ignores BASH_ENV before the first line of a sealed runtime
# script. The unit-level UnsetEnvironment protects the dynamic loader before
# Bash itself starts; the exact directive is asserted above and by the sealed
# release verifier.
bash_env_marker="$tmp_dir/bash-env-injected"
bash_env_payload="$tmp_dir/malicious-bash-env"
privileged_script="$tmp_dir/privileged-script"
printf 'printf injected >%q\n' "$bash_env_marker" >"$bash_env_payload"
printf '%s\n' '#!/bin/bash -p' 'printf clean >/dev/null' >"$privileged_script"
chmod 0700 "$bash_env_payload" "$privileged_script"
BASH_ENV="$bash_env_payload" \
  /bin/bash --noprofile --norc -p -- "$privileged_script"
[[ ! -e "$bash_env_marker" ]]

# Seal and verify a minimal composite release, then prove that a post-seal byte
# change is detected. This uses a fake Node executable and no credentials or
# database.
fixture_app_commit=1111111111111111111111111111111111111111
fixture_node="$tmp_dir/fixture-node"
printf '%s\n' '#!/usr/bin/env bash' 'printf "v1.2.3\\n"' >"$fixture_node"
chmod 0755 "$fixture_node"
fixture_node_sha256="$(sha256sum "$fixture_node" | awk '{print $1}')"
fixture_npm_cli_sha256=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
fixture_ops_inputs="$tmp_dir/fixture-ops-inputs.sha256"
printf '%s\n' 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa  bin/fixture' \
  >"$fixture_ops_inputs"
fixture_ops_bundle_sha256="$(sha256sum "$fixture_ops_inputs" | awk '{print $1}')"
fixture_release_id="$(printf 'format_version=3\napp_commit=%s\nnode_sha256=%s\nnpm_cli_sha256=%s\nops_bundle_sha256=%s\n' \
  "$fixture_app_commit" "$fixture_node_sha256" "$fixture_npm_cli_sha256" \
  "$fixture_ops_bundle_sha256" | \
  sha256sum | awk '{print $1}')"
fixture_release="$tmp_dir/releases/$fixture_release_id"
mkdir -p \
  "$fixture_release/app/ops/owned-tracker" \
  "$fixture_release/app/.next" \
  "$fixture_release/app/node_modules/next/dist/bin" \
  "$fixture_release/app/node_modules/tsx/dist" \
  "$fixture_release/app/node_modules/better-sqlite3" \
  "$fixture_release/bin" \
  "$fixture_release/runtime" \
  "$fixture_release/systemd" \
  "$fixture_release/tmpfiles.d"
printf '%s\n' \
  '#!/bin/bash -p' \
  '# /usr/bin/env -i --' \
  'exit 0' \
  >"$fixture_release/app/ops/owned-tracker/release-entrypoint"
printf '%s\n' \
  'const keys = ["NODE_OPTIONS", "NODE_PATH", "LD_PRELOAD", "BASH_ENV", "ENV", "SHELLOPTS"];' \
  'const dashboardKey = "DASH_EXTRA_USERS";' \
  'const configuredMarker = "SCRAPECREATORS_API_KEY_CONFIGURED";' \
  'if (key.startsWith("TSX_")) throw new Error("runtime injection key is forbidden");' \
  'throw new Error("unknown key is forbidden");' \
  >"$fixture_release/app/ops/owned-tracker/release-env.mjs"
printf '%s\n' \
  'export const activationDatabaseFixture = true;' \
  >"$fixture_release/app/ops/owned-tracker/activation-database.mjs"
install -m 0755 "$fixture_node" "$fixture_release/runtime/node"
chmod 0755 \
  "$fixture_release/app/ops/owned-tracker/release-entrypoint"
chmod 0644 \
  "$fixture_release/app/ops/owned-tracker/release-env.mjs" \
  "$fixture_release/app/ops/owned-tracker/activation-database.mjs"
printf '%s\n' "$fixture_release_id" >"$fixture_release/app/.next/BUILD_ID"
printf 'fixture-next\n' >"$fixture_release/app/node_modules/next/dist/bin/next"
printf 'fixture-tsx\n' >"$fixture_release/app/node_modules/tsx/dist/loader.mjs"
install -m 0755 "$release_verifier" "$fixture_release/bin/verify-release"
install -m 0755 "$wrapper" "$fixture_release/bin/run-contained-job"
install -m 0755 "$health" "$fixture_release/bin/check-dashboard-health"
install -m 0755 "$release_activator" "$fixture_release/bin/activate-release"
install -m 0755 "$canonical_seed_runner" "$fixture_release/bin/run-canonical-seed"
install -m 0755 "$cutover_runner" "$fixture_release/bin/run-cutover-completeness"
install -m 0755 "$instagram_credit_rearm_runner" \
  "$fixture_release/bin/run-instagram-credit-rearm"
install -m 0755 "$raw_verifier_provision_runner" \
  "$fixture_release/bin/run-raw-verifier-provision"
for trusted_helper in render-config activation-boundary activation-database probe-database-access \
  migrate-provider-imports; do
  printf '%s\n' '#!/usr/bin/env python3' 'raise SystemExit(0)' \
    >"$fixture_release/bin/$trusted_helper"
  chmod 0755 "$fixture_release/bin/$trusted_helper"
done
for trusted_helper in activation-system-state activation-user-units durable-state; do
  helper_source="$tracker_dir/bin/${trusted_helper}.py"
  install -m 0755 "$helper_source" "$fixture_release/bin/$trusted_helper"
done
install -m 0755 "$cutover_result_validator" "$fixture_release/bin/validate-cutover-result"
for role in roster-refresh scheduler-tick instagram-discovery instagram-scheduler \
  instagram-credit-rearm \
  provider-reconcile canonical-delivery canonical-replay canonical-seed raw-verifier cutover-verify migrate-database \
  collector-worker check-coverage; do
  ln -s ../app/ops/owned-tracker/release-entrypoint "$fixture_release/bin/$role"
done
for unit_file in "${expected_unit_files[@]}"; do
  install -m 0644 "$tracker_dir/systemd/$unit_file" "$fixture_release/systemd/$unit_file"
done
install -m 0644 "$tracker_dir/tmpfiles.d/creator-tracker.conf" \
  "$fixture_release/tmpfiles.d/creator-tracker.conf"
printf '%s\n' "$fixture_release_id" >"$fixture_release/RELEASE_ID"
printf '%s\n' "$fixture_app_commit" >"$fixture_release/APP_COMMIT"
printf 'v1.2.3\n' >"$fixture_release/NODE_VERSION"
printf '%s\n' "$fixture_node_sha256" >"$fixture_release/NODE_SHA256"
printf '%s\n' "$fixture_npm_cli_sha256" >"$fixture_release/NPM_CLI_SHA256"
cp -- "$fixture_ops_inputs" "$fixture_release/OPS_INPUTS.sha256"
printf '%s\n' "$fixture_ops_bundle_sha256" \
  >"$fixture_release/OPS_BUNDLE_SHA256"
printf 'format_version=3\nrelease_id=%s\napp_commit=%s\n' \
  "$fixture_release_id" "$fixture_app_commit" >"$fixture_release/RELEASE_INFO"
printf '%s\n' "$fixture_release_id" \
  >"$fixture_release/.creator-tracker-unsealed-release"
printf 'safe-template-only\n' >"$fixture_release/app/.env.example"

# The sealed inventory is exact: an extra lifecycle unit must be rejected before
# any release can be copied to the system manager.
printf '%s\n' '[Unit]' 'Description=unexpected fixture' \
  >"$fixture_release/systemd/unexpected.target"
set +e
"$release_verifier" --seal-staged "$fixture_release" "$fixture_release_id" \
  >"$tmp_dir/unexpected-unit-release.out" 2>&1
unexpected_unit_release_exit=$?
set -e
[[ "$unexpected_unit_release_exit" -ne 0 ]]
if ! grep -Fq 'unexpected sealed systemd inventory entry: unexpected.target' \
    "$tmp_dir/unexpected-unit-release.out"; then
  cat "$tmp_dir/unexpected-unit-release.out" >&2
  exit 1
fi
rm -- "$fixture_release/systemd/unexpected.target"

printf 'must-never-be-archived\n' >"$fixture_release/app/.env.production.local"
set +e
"$release_verifier" --seal-staged "$fixture_release" "$fixture_release_id" \
  >"$tmp_dir/live-dotenv-release.out" 2>&1
live_dotenv_release_exit=$?
set -e
[[ "$live_dotenv_release_exit" -ne 0 ]]
grep -Fq 'release contains a live dotenv file' "$tmp_dir/live-dotenv-release.out"
rm -- "$fixture_release/app/.env.production.local"
"$release_verifier" --seal-staged "$fixture_release" "$fixture_release_id" >/dev/null
"$release_verifier" --staged "$fixture_release" "$fixture_release_id" >/dev/null

# Retain the pre-copy manifest identity. A coherent same-UID rewrite that also
# regenerates MANIFEST.sha256 must still differ from the digest captured before
# the privileged root copy.
expected_fixture_manifest_sha256="$(sha256sum "$fixture_release/MANIFEST.sha256" | awk '{print $1}')"
poisoned_release="$tmp_dir/poisoned-release"
cp -a -- "$fixture_release" "$poisoned_release"
chmod u+w "$poisoned_release/runtime/node" "$poisoned_release/MANIFEST.sha256"
printf '\npoisoned-runtime-byte\n' >>"$poisoned_release/runtime/node"
(
  cd "$poisoned_release"
  find . -xdev -type f ! -name MANIFEST.sha256 -print0 |
    LC_ALL=C sort -z | xargs -0 -r sha256sum >MANIFEST.sha256
)
poisoned_fixture_manifest_sha256="$(sha256sum "$poisoned_release/MANIFEST.sha256" | awk '{print $1}')"
[[ "$poisoned_fixture_manifest_sha256" != "$expected_fixture_manifest_sha256" ]]
grep -Fq 'expected_manifest_sha256=' "$release_installer"
grep -Fq 'sealed staging inventories changed before the privileged copy completed' \
  "$release_installer"
grep -Fq 'safe.directory=$source_repo' "$release_installer"
grep -Fq -- '--no-replace-objects' "$release_installer"

chmod u+w "$fixture_release/RELEASE_INFO"
printf 'tampered=1\n' >>"$fixture_release/RELEASE_INFO"
set +e
"$release_verifier" --staged "$fixture_release" "$fixture_release_id" \
  >"$tmp_dir/tampered-release.out" 2>&1
tampered_release_exit=$?
set -e
[[ "$tampered_release_exit" -ne 0 ]]
grep -Eq 'mode is not|inventory or hash changed|manifest verification failed' \
  "$tmp_dir/tampered-release.out"

# A user-owned copy cannot elevate into the release builder. This is also the
# same-UID swap boundary: only a preinstalled immutable release-tools bundle is
# accepted before sudo or any candidate inspection.
set +e
"$release_installer" \
  --source-repo "$repo_root" \
  --ref HEAD \
  --prepare-only "$tmp_dir/dotenv-blocked" \
  >"$tmp_dir/untrusted-installer.out" 2>&1
untrusted_installer_exit=$?
set -e
[[ "$untrusted_installer_exit" -ne 0 ]]
grep -Fq 'reviewed root-controlled release-tools bundle' \
  "$tmp_dir/untrusted-installer.out"

fake_executable="$tmp_dir/succeed"
printf '%s\n' '#!/usr/bin/env bash' 'exit 0' >"$fake_executable"
chmod 0700 "$fake_executable"
blocking_executable="$tmp_dir/block-briefly"
printf '%s\n' \
  '#!/usr/bin/env bash' \
  'printf started >"${FAKE_STARTED_FILE:?}"' \
  'sleep 1' \
  >"$blocking_executable"
chmod 0700 "$blocking_executable"
mkdir -p "$tmp_dir/runtime" "$tmp_dir/state"

env \
  XDG_RUNTIME_DIR="$tmp_dir/runtime" \
  XDG_STATE_HOME="$tmp_dir/state" \
  FAKE_STARTED_FILE="$tmp_dir/discovery-started" \
  CREATOR_TRACKER_HEARTBEAT_INTERVAL_SECONDS=5 \
  CREATOR_TRACKER_TEST_ONLY_ALLOW_ARBITRARY_COMMAND=1 \
  /bin/bash "$wrapper" instagram-discovery -- "$blocking_executable" &
discovery_pid=$!
for _attempt in {1..50}; do
  [[ -s "$tmp_dir/discovery-started" ]] && break
  sleep 0.02
done
[[ -s "$tmp_dir/discovery-started" ]]
set +e
env \
  XDG_RUNTIME_DIR="$tmp_dir/runtime" \
  XDG_STATE_HOME="$tmp_dir/state" \
  CREATOR_TRACKER_HEARTBEAT_INTERVAL_SECONDS=5 \
  CREATOR_TRACKER_TEST_ONLY_ALLOW_ARBITRARY_COMMAND=1 \
  /bin/bash "$wrapper" instagram-discovery -- "$fake_executable"
duplicate_exit=$?
set -e
[[ "$duplicate_exit" -eq 75 ]]
grep -Fq 'state=lock_busy' \
  "$tmp_dir/state/creator-tracker/health/instagram-discovery.lock-busy"

set +e
env \
  XDG_RUNTIME_DIR="$tmp_dir/runtime" \
  XDG_STATE_HOME="$tmp_dir/state" \
  CREATOR_TRACKER_HEARTBEAT_INTERVAL_SECONDS=5 \
  CREATOR_TRACKER_TEST_ONLY_ALLOW_ARBITRARY_COMMAND=1 \
  /bin/bash "$wrapper" dashboard-health -- "$fake_executable"
health_overlap_exit=$?
set -e
[[ "$health_overlap_exit" -eq 75 ]]
grep -Fq 'state=writer_lock_busy' \
  "$tmp_dir/state/creator-tracker/health/dashboard-health.writer-lock-busy"

set +e
env \
  XDG_RUNTIME_DIR="$tmp_dir/runtime" \
  XDG_STATE_HOME="$tmp_dir/state" \
  CREATOR_TRACKER_HEARTBEAT_INTERVAL_SECONDS=5 \
  CREATOR_TRACKER_TEST_ONLY_ALLOW_ARBITRARY_COMMAND=1 \
  /bin/bash "$wrapper" scheduler-tick -- "$fake_executable"
tiktok_overlap_exit=$?
set -e
[[ "$tiktok_overlap_exit" -eq 75 ]]
grep -Fq 'state=writer_lock_busy' \
  "$tmp_dir/state/creator-tracker/health/scheduler-tick.writer-lock-busy"

instagram_wait_start_ns="$(date +%s%N)"
env \
  XDG_RUNTIME_DIR="$tmp_dir/runtime" \
  XDG_STATE_HOME="$tmp_dir/state" \
  FAKE_STARTED_FILE="$tmp_dir/instagram-started" \
  CREATOR_TRACKER_HEARTBEAT_INTERVAL_SECONDS=5 \
  CREATOR_TRACKER_TEST_ONLY_ALLOW_ARBITRARY_COMMAND=1 \
  /bin/bash "$wrapper" instagram-scheduler -- "$blocking_executable" &
instagram_wait_pid=$!
instagram_priority_held=0
for _attempt in {1..50}; do
  if ! /usr/bin/flock -n \
    "$tmp_dir/runtime/creator-tracker/locks/instagram-scheduler.lock" \
    /usr/bin/true; then
    instagram_priority_held=1
    break
  fi
  sleep 0.02
done
[[ "$instagram_priority_held" -eq 1 ]]

set +e
env \
  XDG_RUNTIME_DIR="$tmp_dir/runtime" \
  XDG_STATE_HOME="$tmp_dir/state" \
  CREATOR_TRACKER_HEARTBEAT_INTERVAL_SECONDS=5 \
  CREATOR_TRACKER_TEST_ONLY_ALLOW_ARBITRARY_COMMAND=1 \
  /bin/bash "$wrapper" scheduler-tick -- "$fake_executable"
tiktok_priority_exit=$?
set -e
[[ "$tiktok_priority_exit" -eq 75 ]]
grep -Fq 'state=priority_lock_busy' \
  "$tmp_dir/state/creator-tracker/health/scheduler-tick.priority-lock-busy"

wait "$instagram_wait_pid"
instagram_wait_elapsed_ns=$(($(date +%s%N) - instagram_wait_start_ns))
((instagram_wait_elapsed_ns >= 100000000))
((instagram_wait_elapsed_ns < 4000000000))
[[ ! -e "$tmp_dir/state/creator-tracker/health/instagram-scheduler.writer-lock-busy" ]]

# A low-frequency writer waits for the same database lock instead of losing its
# entire provider interval to a short scheduler/discovery overlap.
env \
  XDG_RUNTIME_DIR="$tmp_dir/runtime" \
  XDG_STATE_HOME="$tmp_dir/state" \
  CREATOR_TRACKER_HEARTBEAT_INTERVAL_SECONDS=5 \
  CREATOR_TRACKER_TEST_ONLY_ALLOW_ARBITRARY_COMMAND=1 \
  /bin/bash "$wrapper" provider-reconcile -- "$fake_executable"
wait "$discovery_pid"
env \
  XDG_RUNTIME_DIR="$tmp_dir/runtime" \
  XDG_STATE_HOME="$tmp_dir/state" \
  CREATOR_TRACKER_HEARTBEAT_INTERVAL_SECONDS=5 \
  CREATOR_TRACKER_TEST_ONLY_ALLOW_ARBITRARY_COMMAND=1 \
  /bin/bash "$wrapper" instagram-scheduler -- "$fake_executable"

health_start_ns="$(date +%s%N)"
env \
  XDG_RUNTIME_DIR="$tmp_dir/runtime" \
  XDG_STATE_HOME="$tmp_dir/state" \
  CREATOR_TRACKER_HEARTBEAT_INTERVAL_SECONDS=5 \
  CREATOR_TRACKER_TEST_ONLY_ALLOW_ARBITRARY_COMMAND=1 \
  /bin/bash "$wrapper" dashboard-health -- "$fake_executable"
health_elapsed_ns=$(($(date +%s%N) - health_start_ns))
((health_elapsed_ns < 4000000000))

grep -Fq 'job=instagram-discovery' \
  "$tmp_dir/state/creator-tracker/health/instagram-discovery.success"
grep -Fq 'state=succeeded' \
  "$tmp_dir/state/creator-tracker/health/instagram-discovery.success"
grep -Fq 'state=succeeded' \
  "$tmp_dir/state/creator-tracker/health/provider-reconcile.success"
grep -Fq 'job=instagram-scheduler' \
  "$tmp_dir/state/creator-tracker/health/instagram-scheduler.success"
grep -Fq 'state=succeeded' \
  "$tmp_dir/state/creator-tracker/health/instagram-scheduler.success"
grep -Fq 'state=succeeded' \
  "$tmp_dir/state/creator-tracker/health/dashboard-health.success"

# Canonical delivery intentionally does not hold the ordinary writer flock
# across HTTPS. Its job lock still fences every lease/ack transaction, so health
# must defer while that second writer lane is active.
env \
  XDG_RUNTIME_DIR="$tmp_dir/runtime" \
  XDG_STATE_HOME="$tmp_dir/state" \
  FAKE_STARTED_FILE="$tmp_dir/delivery-started" \
  CREATOR_TRACKER_HEARTBEAT_INTERVAL_SECONDS=5 \
  CREATOR_TRACKER_TEST_ONLY_ALLOW_ARBITRARY_COMMAND=1 \
  /bin/bash "$wrapper" canonical-delivery -- "$blocking_executable" &
delivery_pid=$!
for _attempt in {1..50}; do
  [[ -s "$tmp_dir/delivery-started" ]] && break
  sleep 0.02
done
[[ -s "$tmp_dir/delivery-started" ]]
set +e
env \
  XDG_RUNTIME_DIR="$tmp_dir/runtime" \
  XDG_STATE_HOME="$tmp_dir/state" \
  CREATOR_TRACKER_HEARTBEAT_INTERVAL_SECONDS=5 \
  CREATOR_TRACKER_TEST_ONLY_ALLOW_ARBITRARY_COMMAND=1 \
  /bin/bash "$wrapper" dashboard-health -- "$fake_executable"
health_delivery_overlap_exit=$?
set -e
[[ "$health_delivery_overlap_exit" -eq 75 ]]
grep -Fq 'state=secondary_lock_busy' \
  "$tmp_dir/state/creator-tracker/health/dashboard-health.secondary-lock-busy"
wait "$delivery_pid"

process_tree_executable="$tmp_dir/process-tree"
printf '%s\n' \
  '#!/usr/bin/env bash' \
  'sleep 300 &' \
  'grandchild_pid=$!' \
  'printf "%s %s\n" "$$" "$grandchild_pid" >"${FAKE_PROCESS_TREE_FILE:?}"' \
  'wait "$grandchild_pid"' \
  >"$process_tree_executable"
chmod 0700 "$process_tree_executable"
env \
  XDG_RUNTIME_DIR="$tmp_dir/runtime" \
  XDG_STATE_HOME="$tmp_dir/state" \
  FAKE_PROCESS_TREE_FILE="$tmp_dir/process-tree.pids" \
  CREATOR_TRACKER_HEARTBEAT_INTERVAL_SECONDS=5 \
  CREATOR_TRACKER_TEST_ONLY_ALLOW_ARBITRARY_COMMAND=1 \
  /bin/bash "$wrapper" signal-test -- "$process_tree_executable" &
signal_supervisor_pid=$!
for _attempt in {1..50}; do
  [[ -s "$tmp_dir/process-tree.pids" ]] && break
  sleep 0.02
done
[[ -s "$tmp_dir/process-tree.pids" ]]
read -r managed_pid descendant_pid <"$tmp_dir/process-tree.pids"
kill -TERM "$signal_supervisor_pid"
set +e
wait "$signal_supervisor_pid"
signal_exit=$?
set -e
signal_supervisor_pid=''
[[ "$signal_exit" -eq 0 ]]
for stopped_pid in "$managed_pid" "$descendant_pid"; do
  if kill -0 "$stopped_pid" 2>/dev/null; then
    printf 'creator-tracker: process %s survived the supervisor signal\n' \
      "$stopped_pid" >&2
    exit 1
  fi
done
grep -Fq 'state=stopped' \
  "$tmp_dir/state/creator-tracker/health/signal-test.status"

port_file="$tmp_dir/http-port"
node -e '
  const fs = require("node:fs");
  const http = require("node:http");
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/plain" });
    response.end("ok");
  });
  server.listen(0, "127.0.0.1", () => {
    fs.writeFileSync(process.argv[1], String(server.address().port));
  });
' "$port_file" &
server_pid=$!
for _attempt in {1..50}; do
  [[ -s "$port_file" ]] && break
  sleep 0.05
done
[[ -s "$port_file" ]]
http_port="$(<"$port_file")"
now_epoch="$(date +%s)"
health_dir="$tmp_dir/state/creator-tracker/health"

printf 'state=running\nupdated_at_epoch=%s\n' "$now_epoch" \
  >"$health_dir/collector-worker.status"
for marker in scheduler-tick roster-refresh instagram-discovery instagram-scheduler \
  provider-reconcile canonical-delivery raw-verifier; do
  printf 'state=succeeded\nat_epoch=%s\n' "$now_epoch" \
    >"$health_dir/$marker.success"
done

# curl must not auto-load a caller-controlled config before probing localhost.
# `trace` is deliberately sticky: it would create the marker if .curlrc were
# consulted even though the command supplies its own URL and output path.
mkdir -p "$tmp_dir/curl-home"
printf 'trace = "%s"\n' "$tmp_dir/curl-config-loaded" \
  >"$tmp_dir/curl-home/.curlrc"
env \
  XDG_STATE_HOME="$tmp_dir/state" \
  CURL_HOME="$tmp_dir/curl-home" \
  CREATOR_TRACKER_DASHBOARD_HEALTH_URL="http://127.0.0.1:$http_port/health" \
  CREATOR_TRACKER_TEST_ONLY_SKIP_COVERAGE=1 \
  /bin/bash "$health" >/dev/null
[[ ! -e "$tmp_dir/curl-config-loaded" ]]

mv "$health_dir/instagram-discovery.success" \
  "$health_dir/instagram-discovery.success.disabled"
if env \
  XDG_STATE_HOME="$tmp_dir/state" \
  CREATOR_TRACKER_DASHBOARD_HEALTH_URL="http://127.0.0.1:$http_port/health" \
  CREATOR_TRACKER_TEST_ONLY_SKIP_COVERAGE=1 \
  /bin/bash "$health" >"$tmp_dir/unhealthy.out" 2>&1; then
  printf '%s\n' 'health probe accepted a missing Instagram discovery marker' >&2
  exit 1
fi
grep -Fq 'missing instagram-discovery-success marker' "$tmp_dir/unhealthy.out"

printf '%s\n' 'creator-tracker ops verification: ok'
