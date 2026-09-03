#!/bin/bash
set -euo pipefail

export PATH='/opt/creator-tracker/node/v24.20.0/bin:/usr/sbin:/usr/bin:/sbin:/bin'
export GIT_CONFIG_GLOBAL=/dev/null
export GIT_CONFIG_NOSYSTEM=1
export GIT_TERMINAL_PROMPT=0
export GIT_OPTIONAL_LOCKS=0
unset NODE_OPTIONS NODE_PATH LD_PRELOAD LD_LIBRARY_PATH LD_AUDIT BASH_ENV ENV \
  OPENAI_API_KEY CODEX_API_KEY SSH_AUTH_SOCK DBUS_SESSION_BUS_ADDRESS \
  GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_OBJECT_DIRECTORY \
  GIT_ALTERNATE_OBJECT_DIRECTORIES GIT_EXTERNAL_DIFF GIT_SSH GIT_SSH_COMMAND \
  GIT_CONFIG_COUNT GIT_CONFIG_KEY_0 GIT_CONFIG_VALUE_0 || true

readonly state_root='/var/lib/creator-tracker-autopilot'
readonly ready_root="$state_root/ready"
readonly verification_root="$state_root/verification/processing"
readonly rejected_root="$state_root/verification/rejected"
readonly reports_root="$state_root/reports"
readonly runs_root='/var/lib/creator-tracker-autopilot-verifier'
readonly releases_root='/opt/creator-tracker/releases'
readonly current_selector='/opt/creator-tracker/current'
readonly activation_lock='/opt/creator-tracker/activation.lock'
readonly activation_marker='/opt/creator-tracker/ACTIVATION_IN_PROGRESS'
readonly autopilot='/usr/local/libexec/creator-tracker-autopilot'
readonly result_schema='/usr/local/share/creator-tracker-autopilot/result.schema.json'
readonly result_validator='/usr/local/libexec/creator-tracker-validate-codex-result'
readonly verifier_user='creator-tracker-verifier'
readonly lock_file="$state_root/verification/verifier.lock"
readonly command_log_bytes=$((48 * 1024 * 1024))
readonly -a ready_artifacts=(
  incident.json processed-incident.json prompt.md events.jsonl stderr.log
  codex-result.json candidate.patch git-status.txt changed-paths.txt changed-paths.nul
  base-app-commit base-release-id codex-exit-code candidate-policy.json
)
readonly -a derived_artifacts=(
  result.json trusted-candidate-policy.json trusted-verification.log
  trusted-verification-exit SHA256SUMS COMPLETE
)
readonly -a persistent_artifacts=(verifier-attempts)
readonly -a final_artifacts=(
  "${ready_artifacts[@]}"
  READY-SHA256SUMS READY
  "${persistent_artifacts[@]}"
  result.json trusted-candidate-policy.json trusted-verification.log
  trusted-verification-exit
)

fail() {
  printf 'creator-tracker trusted verifier: %s\n' "$*" >&2
  exit 1
}

fsync_dir() {
  /usr/bin/python3 -I - "$1" <<'PY'
import os, sys
descriptor = os.open(sys.argv[1], os.O_RDONLY | os.O_DIRECTORY)
try:
    os.fsync(descriptor)
finally:
    os.close(descriptor)
PY
}

fsync_files() {
  /usr/bin/python3 -I - "$@" <<'PY'
import os, sys
for name in sys.argv[1:]:
    descriptor = os.open(name, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)
PY
}

validate_ready() {
  local report="$1" owner_uid="$2" owner_gid="$3"
  /usr/bin/python3 -I - "$report" "$owner_uid" "$owner_gid" "${ready_artifacts[@]}" <<'PY'
import hashlib, json, os, pathlib, re, stat, sys, time
report = pathlib.Path(sys.argv[1])
owner_uid, owner_gid = int(sys.argv[2]), int(sys.argv[3])
artifacts = sys.argv[4:]
expected = set(artifacts) | {"READY-SHA256SUMS", "READY"}
limits = {
    "events.jsonl": 128 << 20, "stderr.log": 32 << 20,
    "candidate.patch": 32 << 20, "git-status.txt": 8 << 20,
    "changed-paths.txt": 8 << 20, "changed-paths.nul": 8 << 20,
    "prompt.md": 4 << 20, "incident.json": 2 << 20,
    "processed-incident.json": 2 << 20,
    "codex-result.json": 1 << 20, "candidate-policy.json": 1 << 20,
}
def digest(path):
    value = hashlib.sha256()
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(descriptor, "rb") as handle:
        while chunk := handle.read(1 << 20):
            value.update(chunk)
    return value.hexdigest()
info = report.lstat()
if report.is_symlink() or not report.is_dir() or info.st_uid != owner_uid or info.st_gid != owner_gid or stat.S_IMODE(info.st_mode) != 0o700:
    raise SystemExit("unsafe READY directory")
if {path.name for path in report.iterdir()} != expected:
    raise SystemExit("READY directory has missing or unexpected entries")
total = 0
for name in artifacts + ["READY-SHA256SUMS"]:
    path = report / name
    info = path.lstat()
    limit = limits.get(name, 64 << 10)
    if path.is_symlink() or not path.is_file() or info.st_uid != owner_uid or info.st_gid != owner_gid or info.st_nlink != 1 or stat.S_IMODE(info.st_mode) != 0o600 or info.st_size > limit:
        raise SystemExit(f"unsafe READY artifact: {name}")
    total += info.st_size
if total > 192 << 20:
    raise SystemExit("READY report exceeds total size limit")
marker_path = report / "READY"
marker_info = marker_path.lstat()
if marker_path.is_symlink() or not marker_path.is_file() or marker_info.st_uid != owner_uid or marker_info.st_gid != owner_gid or marker_info.st_nlink != 1 or stat.S_IMODE(marker_info.st_mode) != 0o400 or marker_info.st_size > 4096:
    raise SystemExit("unsafe READY marker")
manifest = (report / "READY-SHA256SUMS").read_bytes()
marker = json.loads(marker_path.read_text(encoding="utf-8"))
if set(marker) != {"format_version", "manifest_sha256", "ready_at_epoch", "report_id"} or marker.get("format_version") != 1 or marker.get("report_id") != report.name or not isinstance(marker.get("ready_at_epoch"), int) or marker["ready_at_epoch"] > int(time.time()) + 60 or hashlib.sha256(manifest).hexdigest() != marker.get("manifest_sha256"):
    raise SystemExit("READY marker does not bind the manifest")
hashes = {}
for line in manifest.decode("ascii").splitlines():
    value, separator, name = line.partition("  ")
    if separator != "  " or re.fullmatch(r"[0-9a-f]{64}", value) is None or name in hashes:
        raise SystemExit("invalid READY checksum manifest")
    hashes[name] = value
if set(hashes) != set(artifacts):
    raise SystemExit("READY checksum manifest has the wrong files")
for name, expected_hash in hashes.items():
    if digest(report / name) != expected_hash:
        raise SystemExit(f"READY checksum mismatch: {name}")
PY
}

sanitize_processing() {
  local report="$1" expected_uid="$2" expected_gid="$3"
  /usr/bin/python3 -I - "$report" "$expected_uid" "$expected_gid" \
    "${ready_artifacts[@]}" -- "${persistent_artifacts[@]}" -- \
    "${derived_artifacts[@]}" <<'PY'
import os, pathlib, re, stat, sys
report = pathlib.Path(sys.argv[1])
codex_uid, codex_gid = int(sys.argv[2]), int(sys.argv[3])
first_divider = sys.argv.index("--")
second_divider = sys.argv.index("--", first_divider + 1)
ready = sys.argv[4:first_divider]
persistent = sys.argv[first_divider + 1:second_divider]
derived = sys.argv[second_divider + 1:]
expected = set(ready) | {"READY-SHA256SUMS", "READY"}
allowed = expected | set(persistent) | set(derived) | {
    ".COMPLETE.tmp", ".SHA256SUMS.tmp", ".verifier-attempts.tmp"
}
info = report.lstat()
if report.is_symlink() or not report.is_dir() or (info.st_uid, info.st_gid) not in {(0, 0), (codex_uid, codex_gid)} or stat.S_IMODE(info.st_mode) != 0o700:
    raise SystemExit("unsafe processing directory")
os.chown(report, 0, 0)
names = {entry.name for entry in report.iterdir()}
if not expected.issubset(names) or not names.issubset(allowed):
    raise SystemExit("processing directory has missing or unexpected entries")
for name in names - expected:
    path = report / name
    if stat.S_ISDIR(path.lstat().st_mode):
        raise SystemExit("unsafe partial verification directory")
    if name in persistent:
        descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
        try:
            info = os.fstat(descriptor)
            value = os.read(descriptor, 17)
        finally:
            os.close(descriptor)
        if (
            not stat.S_ISREG(info.st_mode)
            or info.st_uid != 0
            or info.st_gid != 0
            or info.st_nlink != 1
            or stat.S_IMODE(info.st_mode) != 0o600
            or len(value) > 16
            or re.fullmatch(rb"[1-9][0-9]*\n", value) is None
        ):
            raise SystemExit("unsafe persistent verification artifact")
        continue
    path.unlink()
for name in ready + ["READY-SHA256SUMS", "READY"]:
    path = report / name
    info = path.lstat()
    if path.is_symlink() or not path.is_file() or info.st_nlink != 1:
        raise SystemExit(f"unsafe processing artifact: {name}")
    os.chown(path, 0, 0)
    os.chmod(path, 0o400 if name == "READY" else 0o600)
PY
}

record_verifier_start() {
  local report="$1" maximum="$2"
  /usr/bin/python3 -I - "$report" "$maximum" <<'PY'
import os, pathlib, re, stat, sys
report = pathlib.Path(sys.argv[1])
maximum = int(sys.argv[2])
counter = report / "verifier-attempts"
temporary = report / ".verifier-attempts.tmp"
current = 0
if counter.exists() or counter.is_symlink():
    descriptor = os.open(counter, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        info = os.fstat(descriptor)
        value = os.read(descriptor, 17)
    finally:
        os.close(descriptor)
    if (
        not stat.S_ISREG(info.st_mode)
        or info.st_uid != 0
        or info.st_gid != 0
        or info.st_nlink != 1
        or stat.S_IMODE(info.st_mode) != 0o600
        or re.fullmatch(rb"[1-9][0-9]*\n", value) is None
    ):
        raise SystemExit("unsafe verifier attempt counter")
    current = int(value)
if current >= maximum:
    raise SystemExit("verifier attempt limit exhausted")
descriptor = os.open(
    temporary,
    os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC,
    0o600,
)
try:
    os.fchown(descriptor, 0, 0)
    os.fchmod(descriptor, 0o600)
    with os.fdopen(descriptor, "wb", closefd=False) as handle:
        handle.write(f"{current + 1}\n".encode("ascii"))
        handle.flush()
        os.fsync(handle.fileno())
finally:
    os.close(descriptor)
os.replace(temporary, counter)
directory = os.open(report, os.O_RDONLY | os.O_DIRECTORY)
try:
    os.fsync(directory)
finally:
    os.close(directory)
print(current + 1)
PY
}

write_completion() {
  local report="$1"
  /usr/bin/python3 -I - "$report" <<'PY'
import hashlib, json, os, pathlib, sys, time
report = pathlib.Path(sys.argv[1])
manifest = (report / "SHA256SUMS").read_bytes()
payload = json.dumps({
    "format_version": 1,
    "manifest_sha256": hashlib.sha256(manifest).hexdigest(),
    "completed_at_epoch": int(time.time()),
}, sort_keys=True, separators=(",", ":")) + "\n"
temporary = report / ".COMPLETE.tmp"
descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o400)
try:
    with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
        handle.write(payload)
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temporary, report / "COMPLETE")
    directory = os.open(report, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(directory)
    finally:
        os.close(directory)
finally:
    try:
        temporary.unlink()
    except FileNotFoundError:
        pass
PY
}

validate_runtime_path() {
  local path="$1" expected="$2"
  [[ ! -L "$path" && -d "$path" ]] || fail "unsafe runtime directory: $path"
  [[ "$(stat -c '%U:%G:%a' -- "$path")" == "$expected" ]] || \
    fail "runtime directory ownership mismatch: $path"
}

quarantine_report() {
  local source="$1" source_parent="$2"
  local target="$rejected_root/$(basename -- "$source")"
  [[ ! -e "$target" && ! -L "$target" ]] || fail 'rejected report already exists'
  # Claim the directory before rename. This is both crash-resumable and needed
  # because the verifier intentionally lacks broad DAC override capability.
  chown root:root "$source"
  chmod 0700 "$source"
  mv -T -- "$source" "$target"
  fsync_dir "$source_parent"
  fsync_dir "$rejected_root"
}

readonly codex_uid="$(id -u creator-tracker-codex)"
readonly codex_gid="$(id -g creator-tracker-codex)"
readonly verifier_uid="$(id -u "$verifier_user")"
readonly verifier_gid="$(id -g "$verifier_user")"
readonly -a verifier_privdrop=(
  /usr/bin/setpriv
  "--reuid=$verifier_uid"
  "--regid=$verifier_gid"
  --clear-groups
  --inh-caps=-all
  --ambient-caps=-all
  --no-new-privs
)
[[ "$(id -nG "$verifier_user")" == "$verifier_user" ]] || \
  fail 'verifier has supplementary groups'
"${verifier_privdrop[@]}" /usr/bin/python3 -I - \
  "$verifier_uid" "$verifier_gid" <<'PY' || \
  fail 'verifier privilege drop preflight failed'
import os, pathlib, sys
if os.getuid() != int(sys.argv[1]) or os.getgid() != int(sys.argv[2]) or os.getgroups():
    raise SystemExit("verifier identity was not isolated")
status = {}
for line in pathlib.Path("/proc/self/status").read_text(encoding="ascii").splitlines():
    key, separator, value = line.partition(":")
    if separator:
        status[key] = value.strip()
for key in ("CapInh", "CapPrm", "CapEff", "CapAmb"):
    if int(status.get(key, "1"), 16) != 0:
        raise SystemExit(f"verifier retained {key}")
if status.get("NoNewPrivs") != "1":
    raise SystemExit("verifier privilege drop lacks no_new_privs")
PY
/usr/bin/python3 -I - <<'PY' || fail 'verifier host runtime namespace is visible'
import pathlib, stat
root = pathlib.Path("/run")
expected = {
    pathlib.Path("/run/systemd"): (0, 0, 0o755),
    pathlib.Path("/run/systemd/incoming"): (0, 0, 0o600),
}
observed = {}
stack = [root]
while stack:
    directory = stack.pop()
    for entry in directory.iterdir():
        info = entry.lstat()
        if not stat.S_ISDIR(info.st_mode) or entry.is_symlink():
            raise SystemExit("private runtime contains a non-directory endpoint")
        observed[entry] = (info.st_uid, info.st_gid, stat.S_IMODE(info.st_mode))
        stack.append(entry)
if observed != expected:
    raise SystemExit("private runtime contents are not exact")
PY
validate_runtime_path "$ready_root" 'root:creator-tracker-codex:770'
validate_runtime_path "$verification_root" 'root:root:700'
validate_runtime_path "$rejected_root" 'root:root:700'
validate_runtime_path "$reports_root" 'root:root:700'
validate_runtime_path "$runs_root" 'root:root:711'
[[ ! -L "$result_schema" && -f "$result_schema" && \
   "$(stat -c '%U:%G:%a:%h' -- "$result_schema")" == 'root:root:444:1' ]] || \
  fail 'trusted result schema is unsafe'
[[ ! -L "$result_validator" && -f "$result_validator" && -x "$result_validator" && \
   "$(stat -c '%U:%G:%a:%h' -- "$result_validator")" == 'root:root:555:1' ]] || \
  fail 'trusted result validator is unsafe'
[[ ! -L "$autopilot" && -f "$autopilot" && -x "$autopilot" && \
   "$(stat -c '%U:%G:%a:%h' -- "$autopilot")" == 'root:root:555:1' ]] || \
  fail 'trusted cutover verifier is unsafe'
"$autopilot" verify-autopilot-artifacts >/dev/null || \
  fail 'autopilot artifact preflight failed'

exec 9>"$lock_file"
flock -n 9 || exit 0

/usr/bin/python3 -I - "$ready_root" "$verification_root" "$rejected_root" <<'PY'
import hashlib, os, pathlib, re, stat, sys
attempt = re.compile(r"^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{16}\.attempt\.[A-Za-z0-9]{6}$")
rejected = pathlib.Path(sys.argv[3])
for source_raw in sys.argv[1:3]:
    source = pathlib.Path(source_raw)
    changed = False
    for entry in list(source.iterdir()):
        info = entry.lstat()
        valid = attempt.fullmatch(entry.name) is not None and stat.S_ISDIR(info.st_mode)
        if valid:
            continue
        if stat.S_ISDIR(info.st_mode) and not stat.S_ISLNK(info.st_mode):
            os.chown(entry, 0, 0, follow_symlinks=False)
            os.chmod(entry, 0o700, follow_symlinks=False)
        digest = hashlib.sha256(
            os.fsencode(str(source)) + b"\0" + os.fsencode(entry.name)
        ).hexdigest()[:24]
        target = rejected / f"invalid-{digest}-{os.getpid()}"
        os.rename(entry, target)
        changed = True
    if changed:
        descriptor = os.open(source, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
descriptor = os.open(rejected, os.O_RDONLY | os.O_DIRECTORY)
try:
    os.fsync(descriptor)
finally:
    os.close(descriptor)
PY

mapfile -t processing_names < <(
  find "$verification_root" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | LC_ALL=C sort
)
if ((${#processing_names[@]} > 0)); then
  report_name="${processing_names[0]}"
  processing_report="$verification_root/$report_name"
else
  mapfile -t ready_names < <(
    find "$ready_root" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | LC_ALL=C sort
  )
  ((${#ready_names[@]} > 0)) || exit 0
  report_name="${ready_names[0]}"
  ready_report="$ready_root/$report_name"
  processing_report="$verification_root/$report_name"
  [[ "$report_name" =~ ^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{16}\.attempt\.[A-Za-z0-9]{6}$ ]] || \
    fail 'READY report name is unsafe'
  [[ ! -e "$processing_report" && ! -L "$processing_report" ]] || \
    fail 'verification report already exists'
  ready_owner="$(stat -c '%u:%g' -- "$ready_report")"
  if [[ "$ready_owner" == "$codex_uid:$codex_gid" ]]; then
    if ! validate_ready "$ready_report" "$codex_uid" "$codex_gid"; then
      quarantine_report "$ready_report" "$ready_root"
      fail 'invalid READY report was quarantined'
    fi
  elif [[ "$ready_owner" != '0:0' ]]; then
    quarantine_report "$ready_report" "$ready_root"
    fail 'READY report owner was invalid and was quarantined'
  fi
  if ! sanitize_processing "$ready_report" "$codex_uid" "$codex_gid" ||
     ! validate_ready "$ready_report" 0 0; then
    quarantine_report "$ready_report" "$ready_root"
    fail 'READY report could not be claimed safely and was quarantined'
  fi
  mv -T -- "$ready_report" "$processing_report"
  fsync_dir "$ready_root"
  fsync_dir "$verification_root"
fi

[[ "$report_name" =~ ^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{16}\.attempt\.[A-Za-z0-9]{6}$ ]] || \
  fail 'processing report name is unsafe'
final_report="$reports_root/$report_name"
[[ ! -e "$final_report" && ! -L "$final_report" ]] || fail 'final report already exists'
if ! sanitize_processing "$processing_report" "$codex_uid" "$codex_gid" ||
   ! validate_ready "$processing_report" 0 0; then
  quarantine_report "$processing_report" "$verification_root"
  fail 'invalid processing report was quarantined'
fi
if ! verifier_start_number="$(record_verifier_start "$processing_report" 2)"; then
  quarantine_report "$processing_report" "$verification_root"
  fail 'verifier attempt limit exhausted; report was quarantined'
fi

mapfile -t identity < <(/usr/bin/python3 -I - "$processing_report" <<'PY'
import json, pathlib, re, sys
report = pathlib.Path(sys.argv[1])
release_id = (report / "base-release-id").read_text(encoding="utf-8").strip()
app_commit = (report / "base-app-commit").read_text(encoding="utf-8").strip()
incident = json.loads((report / "incident.json").read_text(encoding="utf-8"))
selector = incident.get("snapshot", {}).get("selector_identity", {})
cutover = incident.get("snapshot", {}).get("cutover", {})
issues = incident.get("issues", [])
if re.fullmatch(r"[0-9a-f]{64}", release_id) is None or re.fullmatch(r"[0-9a-f]{40}", app_commit) is None or incident.get("release_id") != release_id or incident.get("app_commit") != app_commit or not isinstance(selector.get("inode"), int) or not isinstance(selector.get("mtime_ns"), int) or not isinstance(cutover.get("activation_epoch"), int) or not isinstance(issues, list):
    raise SystemExit("invalid READY release identity")
print(release_id)
print(app_commit)
print(selector["inode"])
print(selector["mtime_ns"])
print(cutover["activation_epoch"])
print("true" if "integration_smoke_test" in issues else "false")
PY
)
release_id="${identity[0]:-}"
app_commit="${identity[1]:-}"
selector_inode="${identity[2]:-}"
selector_mtime_ns="${identity[3]:-}"
incident_activation_epoch="${identity[4]:-}"
smoke="${identity[5]:-false}"
if [[ ! "$release_id" =~ ^[0-9a-f]{64}$ || ! "$app_commit" =~ ^[0-9a-f]{40}$ ||
      ! "$selector_inode" =~ ^[0-9]+$ || ! "$selector_mtime_ns" =~ ^[0-9]+$ ||
      ! "$incident_activation_epoch" =~ ^[0-9]+$ ]]; then
  quarantine_report "$processing_report" "$verification_root"
  fail 'invalid READY identity was quarantined'
fi
release="$releases_root/$release_id"

lock_identity="$(stat -c '%d:%i:%U:%G:%a:%h:%F' -- "$activation_lock")"
case "$lock_identity" in
  *:root:root:600:1:regular*) ;;
  *) fail 'activation lock is unsafe' ;;
esac
exec 8<"$activation_lock"
fd_identity="$(stat -Lc '%d:%i:%U:%G:%a:%h:%F' -- "/proc/$$/fd/8")"
[[ "$fd_identity" == "$lock_identity" ]] || fail 'activation lock changed during open'
flock -n 8 || exit 75
[[ ! -e "$activation_marker" && ! -L "$activation_marker" ]] || \
  fail 'activation began during verification'

trusted_log="$processing_report/trusted-verification.log"
: >"$trusted_log"
chmod 0600 "$trusted_log"
environment_safe=true
if [[ "$(readlink -f -- "$current_selector")" != "$release" ]]; then
  environment_safe=false
  printf '%s\n' 'Active release changed after incident dispatch.' >>"$trusted_log"
fi
if ! /usr/bin/python3 -I - "$current_selector" "$selector_inode" "$selector_mtime_ns" <<'PY'
import os, sys
value = os.lstat(sys.argv[1])
if value.st_ino != int(sys.argv[2]) or value.st_mtime_ns != int(sys.argv[3]):
    raise SystemExit("active selector changed after incident dispatch")
PY
then
  environment_safe=false
  printf '%s\n' 'Active selector identity changed after incident dispatch.' >>"$trusted_log"
fi
if [[ ! -f "$release/RELEASE_ID" || ! -f "$release/APP_COMMIT" || \
      "$(<"$release/RELEASE_ID")" != "$release_id" || \
      "$(<"$release/APP_COMMIT")" != "$app_commit" ]] || \
   ! "$release/bin/verify-release" --installed "$release" "$release_id" >/dev/null; then
  environment_safe=false
  printf '%s\n' 'Sealed release verification failed.' >>"$trusted_log"
fi

set +e
cutover_json="$("$autopilot" verify-current-cutover 2>>"$trusted_log")"
cutover_exit=$?
set -e
if ((cutover_exit != 0)) || ! /usr/bin/python3 -I - \
  "$cutover_json" "$release_id" "$incident_activation_epoch" <<'PY'
import json, sys
value = json.loads(sys.argv[1])
cutover = value.get("cutover", {})
if value.get("release_id") != sys.argv[2] or value.get("release_identity_valid") is not True or cutover.get("ready") is not True or cutover.get("activation_epoch") != int(sys.argv[3]):
    raise SystemExit("cutover proof no longer matches incident")
PY
then
  environment_safe=false
  printf '%s\n' 'Current cutover proof no longer matches the incident.' >>"$trusted_log"
fi

prepare_workspace() {
  local purpose="$1" workspace
  workspace="$(mktemp -d "$runs_root/$report_name.$purpose.XXXXXX")"
  chmod 0700 "$workspace"
  set +e
  tar -C "$release/app" \
    --exclude='./node_modules' --exclude='./.next' --exclude='./tsconfig.tsbuildinfo' \
    --mode='u+rwX' -cf - . | \
    tar -C "$workspace" --no-same-owner --no-same-permissions \
      --delay-directory-restore -xf -
  local -a pipeline_status=("${PIPESTATUS[@]}")
  set -e
  ((pipeline_status[0] == 0 && pipeline_status[1] == 0)) || \
    fail 'sealed workspace export failed'
  find "$workspace" -xdev -type d -exec chmod u+rwx {} +
  find "$workspace" -xdev -type f -exec chmod u+rw {} +
  chown -R "$verifier_uid:$verifier_gid" "$workspace"
  printf '%s\n' "$workspace"
}

apply_candidate() {
  local workspace="$1"
  "${verifier_privdrop[@]}" \
    /usr/bin/env -i HOME=/tmp TMPDIR=/tmp PATH=/usr/bin:/bin \
      GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 GIT_OPTIONAL_LOCKS=0 \
      /usr/bin/git -C "$workspace" apply --no-index --binary --whitespace=nowarn - \
      <"$processing_report/candidate.patch" 8<&- 9<&-
}

policy_workspace=''
apply_exit=0
if [[ "$environment_safe" == true ]]; then
  policy_workspace="$(prepare_workspace policy)"
  if [[ -s "$processing_report/candidate.patch" ]]; then
    set +e
    apply_candidate "$policy_workspace" >>"$trusted_log" 2>&1
    apply_exit=$?
    set -e
  fi
else
  apply_exit=98
fi

/usr/bin/python3 -I - \
  "$release/app" "$policy_workspace" "$processing_report/changed-paths.nul" \
  "$processing_report/trusted-candidate-policy.json" "$apply_exit" <<'PY'
import hashlib, json, os, pathlib, stat, sys
baseline_raw, workspace_raw, claimed_raw, output_raw, apply_raw = sys.argv[1:]
baseline = pathlib.Path(baseline_raw)
workspace = pathlib.Path(workspace_raw) if workspace_raw else None
apply_exit = int(apply_raw)
ignored_roots = {".git", ".next", "node_modules"}
ignored_files = {"tsconfig.tsbuildinfo"}

def tree(root):
    result = {}
    stack = [(root, "")]
    while stack:
        directory, prefix = stack.pop()
        with os.scandir(directory) as entries:
            for entry in entries:
                rel = f"{prefix}/{entry.name}" if prefix else entry.name
                if rel.split("/", 1)[0] in ignored_roots or rel in ignored_files:
                    continue
                info = entry.stat(follow_symlinks=False)
                if stat.S_ISDIR(info.st_mode):
                    stack.append((pathlib.Path(entry.path), rel))
                elif stat.S_ISREG(info.st_mode):
                    digest = hashlib.sha256()
                    descriptor = os.open(entry.path, os.O_RDONLY | os.O_NOFOLLOW)
                    with os.fdopen(descriptor, "rb") as handle:
                        while chunk := handle.read(1 << 20):
                            digest.update(chunk)
                    # Extraction permissions are intentionally normalized for
                    # the verifier identity. Candidate authority is content-
                    # only; a mode-only Git patch will still be rejected when
                    # its claimed path has no corresponding content change.
                    result[rel] = ("file", digest.hexdigest())
                elif stat.S_ISLNK(info.st_mode):
                    result[rel] = ("symlink", os.readlink(entry.path))
                else:
                    result[rel] = ("special", stat.S_IFMT(info.st_mode))
    return result

raw = pathlib.Path(claimed_raw).read_bytes()
rejected, claimed = [], []
for item in raw.split(b"\0"):
    if not item:
        continue
    try:
        claimed.append(item.decode("utf-8", "strict"))
    except UnicodeDecodeError:
        rejected.append("claimed_path_not_utf8")
claimed_unique = sorted(set(claimed))
actual = []
if len(claimed) != len(claimed_unique):
    rejected.append("duplicate_claimed_path")
if apply_exit == 0 and workspace is not None:
    before, after = tree(baseline), tree(workspace)
    actual = sorted(
        path for path in before.keys() | after.keys()
        if before.get(path) != after.get(path)
    )
else:
    rejected.append("candidate_patch_apply_failed_or_stale_release")
if workspace is not None and any(
    os.path.lexists(workspace / name)
    for name in (".git", ".next", "node_modules", "tsconfig.tsbuildinfo")
):
    rejected.append("candidate_created_excluded_path")
if actual != claimed_unique:
    rejected.append("claimed_path_mismatch")
allowed = []
for path in actual:
    pure = pathlib.PurePosixPath(path)
    safe = (
        not pure.is_absolute()
        and ".." not in pure.parts
        and not any(part in {".git", "node_modules"} for part in pure.parts)
        and (path.startswith("src/sync/") or path.startswith("tests/"))
    )
    if workspace is not None:
        target = workspace / path
        if target.is_symlink() or (target.exists() and not target.is_file()):
            safe = False
    if safe:
        allowed.append(path)
    else:
        rejected.append(path)
payload = {
    "actual_paths": actual,
    "allowed_paths": allowed,
    "claimed_paths": claimed_unique,
    "claim_matches": actual == claimed_unique,
    "rejected_paths": sorted(set(rejected)),
    "safe": not rejected,
}
with open(output_raw, "w", encoding="utf-8") as handle:
    json.dump(payload, handle, sort_keys=True)
    handle.write("\n")
PY
chmod 0600 "$processing_report/trusted-candidate-policy.json"

mapfile -t policy_values < <(/usr/bin/python3 -I - \
  "$processing_report/trusted-candidate-policy.json" <<'PY'
import json, sys
with open(sys.argv[1], encoding="utf-8") as handle:
    value = json.load(handle)
print("true" if value["safe"] else "false")
print(len(value["actual_paths"]))
PY
)
policy_safe="${policy_values[0]:-false}"
changed_count="${policy_values[1]:-0}"

run_verification_command() {
  local verification_command="$1" workspace
  workspace="$(prepare_workspace "$verification_command")" || return $?
  if [[ -s "$processing_report/candidate.patch" ]]; then
    set +e
    apply_candidate "$workspace" >>"$trusted_log" 2>&1
    local apply_status=$?
    set -e
    ((apply_status == 0)) || return "$apply_status"
  fi
  # prepare_workspace deliberately hands this tree to the unprivileged
  # verifier. The root coordinator has no broad DAC override, so these setup
  # writes must run under that same identity before the tree is sealed again.
  "${verifier_privdrop[@]}" \
    /usr/bin/ln -s -- "$release/app/node_modules" "$workspace/node_modules" || \
    return $?
  "${verifier_privdrop[@]}" \
    /usr/bin/install -d -m 0700 \
      "$workspace/.verify-home" "$workspace/.verify-tmp" || return $?
  "${verifier_privdrop[@]}" \
    /usr/bin/install -m 0600 /dev/null \
      "$workspace/.verify-tmp/tsconfig.tsbuildinfo" || return $?
  "${verifier_privdrop[@]}" \
    /usr/bin/ln -s -- '.verify-tmp/tsconfig.tsbuildinfo' \
      "$workspace/tsconfig.tsbuildinfo" || return $?

  # Candidate tests execute as a separate unprivileged identity against a
  # root-owned, read-only tree. Only HOME, TMPDIR, and the incremental compiler
  # cache target remain writable, so a test cannot swap the reviewed candidate
  # bytes before claiming success.
  chown -hR root:root "$workspace" || return $?
  find "$workspace" -xdev -type d -exec chmod a+rx,a-w {} + || return $?
  find "$workspace" -xdev -type f -exec chmod a+r,a-w {} + || return $?
  chown -R "$verifier_uid:$verifier_gid" \
    "$workspace/.verify-home" "$workspace/.verify-tmp" || return $?
  chmod 0700 "$workspace/.verify-home" "$workspace/.verify-tmp" || return $?
  chmod 0600 "$workspace/.verify-tmp/tsconfig.tsbuildinfo" || return $?
  "${verifier_privdrop[@]}" \
    /usr/bin/test -r "$workspace/package.json" || return $?
  printf '\n[%s]\n' "$verification_command" >>"$trusted_log"
  set +e
  /usr/bin/timeout --signal=TERM --kill-after=30s 10m \
    "${verifier_privdrop[@]}" \
    /usr/bin/env -i \
      HOME="$workspace/.verify-home" TMPDIR="$workspace/.verify-tmp" CI=1 TZ=UTC \
      PATH=/opt/creator-tracker/node/v24.20.0/bin:/usr/bin:/bin \
      /bin/bash --noprofile --norc -c \
        'umask 0022; exec "$@"' verifier-npm \
        /opt/creator-tracker/node/v24.20.0/bin/npm --prefix "$workspace" \
          run "$verification_command" 8<&- 9<&- 2>&1 |
    /usr/bin/head -c "$command_log_bytes" >>"$trusted_log"
  local -a pipeline_status=("${PIPESTATUS[@]}")
  set -e
  ((pipeline_status[0] == 0)) || return "${pipeline_status[0]}"
  [[ -L "$workspace/node_modules" && \
     "$(readlink -- "$workspace/node_modules")" == "$release/app/node_modules" ]] || \
    return 96
  [[ -L "$workspace/tsconfig.tsbuildinfo" && \
     "$(readlink -- "$workspace/tsconfig.tsbuildinfo")" == \
       '.verify-tmp/tsconfig.tsbuildinfo' ]] || return 95
  if find "$workspace" -xdev \
      \( -path "$workspace/.verify-home" -o -path "$workspace/.verify-tmp" \) -prune -o \
      \( -type f -o -type d \) \
      \( ! -uid 0 -o ! -gid 0 -o -perm /222 \) -print -quit | grep -q .; then
    return 94
  fi
  return 0
}

trusted_exit=0
if [[ "$environment_safe" != true ]]; then
  trusted_exit=98
  printf '%s\n' \
    'Trusted execution skipped because the incident binding is stale or unsafe.' \
    >>"$trusted_log"
elif [[ "$policy_safe" != true ]]; then
  trusted_exit=97
  printf '%s\n' 'Candidate patch or changed-path evidence failed trusted policy.' \
    >>"$trusted_log"
elif ((changed_count > 0)) || [[ "$smoke" == true ]]; then
  for verification_command in test typecheck; do
    if run_verification_command "$verification_command"; then
      :
    else
      trusted_exit=$?
      break
    fi
  done
else
  printf '%s\n' 'No candidate diff required trusted test execution.' >>"$trusted_log"
fi

if ! /usr/bin/python3 -I - \
  "$processing_report/events.jsonl" "$smoke" <<'PY'
import json, pathlib, sys
completed_command = False
fatal_event = False
for raw in pathlib.Path(sys.argv[1]).read_text(encoding="utf-8").splitlines():
    event = json.loads(raw)
    item = event.get("item") if isinstance(event, dict) else None
    if event.get("type") == "turn.failed":
        fatal_event = True
    if isinstance(item, dict) and item.get("type") == "error":
        fatal_event = True
    if (
        event.get("type") == "item.completed"
        and isinstance(item, dict)
        and item.get("type") == "command_execution"
        and item.get("status") == "completed"
        and item.get("exit_code") == 0
    ):
        completed_command = True
smoke = sys.argv[2] == "true"
raise SystemExit(0 if not fatal_event and (not smoke or completed_command) else 1)
PY
then
  trusted_exit=93
  printf '%s\n' \
    'Codex event stream has a fatal tool error or lacks the required smoke command.' \
    >>"$trusted_log"
fi

# Recheck the release-bound cutover while the activation lock is still held.
if [[ ! -e "$activation_marker" && ! -L "$activation_marker" ]]; then
  set +e
  final_cutover="$("$autopilot" verify-current-cutover 2>>"$trusted_log")"
  final_cutover_exit=$?
  set -e
else
  final_cutover=''
  final_cutover_exit=1
fi
if ((final_cutover_exit != 0)) || ! /usr/bin/python3 -I - \
  "$final_cutover" "$release_id" "$incident_activation_epoch" <<'PY'
import json, sys
value = json.loads(sys.argv[1])
cutover = value.get("cutover", {})
if value.get("release_id") != sys.argv[2] or value.get("release_identity_valid") is not True or cutover.get("ready") is not True or cutover.get("activation_epoch") != int(sys.argv[3]):
    raise SystemExit("cutover changed before report publication")
PY
then
  trusted_exit=98
  environment_safe=false
  printf '%s\n' 'Release or cutover binding changed before final publication.' \
    >>"$trusted_log"
fi

printf '%s\n' "$trusted_exit" >"$processing_report/trusted-verification-exit"
chmod 0600 "$processing_report/trusted-verification-exit"

source_valid=true
if ! "$result_validator" "$result_schema" "$processing_report/codex-result.json"; then
  source_valid=false
  printf '%s\n' 'Codex result failed schema validation in trusted verifier.' >>"$trusted_log"
fi

/usr/bin/python3 -I - \
  "$processing_report/codex-result.json" \
  "$processing_report/trusted-candidate-policy.json" \
  "$trusted_exit" "$source_valid" "$smoke" \
  "$processing_report/result.json" <<'PY'
import json, sys
source_path, policy_path, trusted_raw, source_valid_raw, smoke_raw, output_path = sys.argv[1:]
with open(policy_path, encoding="utf-8") as handle:
    policy = json.load(handle)
if source_valid_raw == "true":
    with open(source_path, encoding="utf-8") as handle:
        result = json.load(handle)
else:
    result = {
        "status": "failed",
        "summary": "The constrained Codex result was invalid.",
        "root_cause": "The model runner did not produce a schema-valid result.",
        "actions_taken": ["Preserved the immutable incident and execution evidence."],
        "verification": [],
        "changed_files": [],
        "production_recommendation": "operator_action_required",
    }
trusted_exit = int(trusted_raw)
actual = policy["actual_paths"]
candidate_valid = policy["safe"] and trusted_exit == 0
if actual and result["status"] == "verified_candidate" and candidate_valid:
    result["production_recommendation"] = "review_candidate"
    result["verification"].append(
        "Fresh networkless trusted test and typecheck commands passed."
    )
elif actual:
    result["status"] = "needs_human"
    result["production_recommendation"] = "operator_action_required"
    result["verification"].append(
        "Trusted path policy or isolated verification did not accept the candidate."
    )
elif result["status"] == "verified_candidate":
    result["status"] = "needs_human"
    result["production_recommendation"] = "operator_action_required"
    result["verification"].append("No candidate diff exists to verify.")
elif smoke_raw == "true" and candidate_valid and result["status"] == "no_action":
    result["production_recommendation"] = "none"
    result["verification"].append(
        "Pristine sealed release test and typecheck commands passed in the trusted harness."
    )
elif smoke_raw == "true":
    result["status"] = "needs_human"
    result["production_recommendation"] = "operator_action_required"
    result["verification"].append(
        "The Codex command-execution smoke proof or trusted harness failed."
    )
elif result["status"] == "no_action" and candidate_valid:
    result["production_recommendation"] = "none"
else:
    if result["status"] == "no_action":
        result["status"] = "needs_human"
    result["production_recommendation"] = "operator_action_required"
result["changed_files"] = actual
with open(output_path, "w", encoding="utf-8") as handle:
    json.dump(result, handle, sort_keys=True)
    handle.write("\n")
PY
chmod 0600 "$processing_report/result.json"
"$result_validator" "$result_schema" "$processing_report/result.json" || \
  fail 'trusted final result failed schema validation'

fsync_files "$processing_report/"*
(
  cd "$processing_report"
  sha256sum "${final_artifacts[@]}" >SHA256SUMS
)
chmod 0600 "$processing_report/SHA256SUMS"
fsync_files "$processing_report/"*
write_completion "$processing_report"
mv -T -- "$processing_report" "$final_report"
fsync_dir "$verification_root"
fsync_dir "$reports_root"
printf 'creator-tracker trusted verification complete: %s report=%s exit=%s\n' \
  "$report_name" "$final_report" "$trusted_exit"
