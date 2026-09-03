#!/bin/bash
set -euo pipefail

export PATH='/opt/creator-tracker/node/v24.20.0/bin:/usr/bin:/bin'
export GIT_CONFIG_GLOBAL=/dev/null
export GIT_CONFIG_NOSYSTEM=1
export GIT_TERMINAL_PROMPT=0
unset NODE_OPTIONS NODE_PATH LD_PRELOAD LD_LIBRARY_PATH LD_AUDIT BASH_ENV ENV \
  OPENAI_API_KEY CODEX_API_KEY SSH_AUTH_SOCK DBUS_SESSION_BUS_ADDRESS \
  GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_OBJECT_DIRECTORY \
  GIT_ALTERNATE_OBJECT_DIRECTORIES GIT_EXTERNAL_DIFF GIT_SSH GIT_SSH_COMMAND \
  GIT_CONFIG_COUNT GIT_CONFIG_KEY_0 GIT_CONFIG_VALUE_0 || true

readonly state_root='/var/lib/creator-tracker-autopilot'
readonly inbox_dir="$state_root/inbox"
readonly processing_dir="$state_root/processing"
readonly producing_dir="$state_root/producing"
readonly ready_dir="$state_root/ready"
readonly runs_dir="$state_root/runs"
readonly prompt_template='/usr/local/share/creator-tracker-autopilot/PROMPT.md'
readonly output_schema='/usr/local/share/creator-tracker-autopilot/result.schema.json'
readonly result_validator='/usr/local/libexec/creator-tracker-validate-codex-result'
readonly releases_root='/opt/creator-tracker/releases'
readonly current_selector='/opt/creator-tracker/current'
readonly codex_bin='/opt/creator-tracker-autopilot/codex/0.149.0/codex'
readonly code_mode_host='/opt/creator-tracker-autopilot/codex/0.149.0/codex-code-mode-host'
readonly codex_checksum='/opt/creator-tracker-autopilot/codex/0.149.0/SHA256SUMS'
readonly codex_home="$state_root/codex-home"
readonly codex_profile="$codex_home/autopilot.config.toml"
readonly lock_file='/run/creator-tracker-autopilot/agent/codex.lock'
readonly -a ready_artifacts=(
  incident.json
  processed-incident.json
  prompt.md
  events.jsonl
  stderr.log
  codex-result.json
  candidate.patch
  git-status.txt
  changed-paths.txt
  changed-paths.nul
  base-app-commit
  base-release-id
  codex-exit-code
  candidate-policy.json
)

fail() {
  printf 'creator-tracker Codex incident: %s\n' "$*" >&2
  exit 1
}

write_fallback_result() {
  local target="$1"
  local exit_code="$2"
  local summary="$3"
  python3 -I - "$target" "$exit_code" "$summary" <<'PY'
import json, sys
with open(sys.argv[1], "w", encoding="utf-8") as handle:
    json.dump({
        "status": "failed",
        "summary": sys.argv[3],
        "root_cause": f"The constrained incident worker failed with exit {sys.argv[2]} before trusted verification.",
        "actions_taken": ["Preserved the immutable incident and bounded execution evidence."],
        "verification": [],
        "changed_files": [],
        "production_recommendation": "operator_action_required",
    }, handle, sort_keys=True)
    handle.write("\n")
PY
  chmod 0600 "$target"
}

emit_ready() {
  local target_dir="$1"
  local artifact published
  for artifact in "${ready_artifacts[@]}"; do
    [[ ! -L "$target_dir/$artifact" && -f "$target_dir/$artifact" ]] || \
      fail "READY artifact is missing or unsafe: $artifact"
    chmod 0600 "$target_dir/$artifact"
  done
  (
    cd "$target_dir"
    sha256sum "${ready_artifacts[@]}" >READY-SHA256SUMS
  )
  chmod 0600 "$target_dir/READY-SHA256SUMS"
  python3 -I - "$target_dir" "${ready_artifacts[@]}" <<'PY'
import os, pathlib, sys
root = pathlib.Path(sys.argv[1])
for name in sys.argv[2:] + ["READY-SHA256SUMS"]:
    descriptor = os.open(root / name, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)
PY
  /usr/bin/python3 -I - "$target_dir" <<'PY'
import hashlib, json, os, pathlib, sys, time
report = pathlib.Path(sys.argv[1])
manifest = (report / "READY-SHA256SUMS").read_bytes()
payload = json.dumps({
    "format_version": 1,
    "manifest_sha256": hashlib.sha256(manifest).hexdigest(),
    "ready_at_epoch": int(time.time()),
    "report_id": report.name,
}, sort_keys=True, separators=(",", ":")) + "\n"
temporary = report / ".READY.tmp"
descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o400)
try:
    with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
        handle.write(payload)
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temporary, report / "READY")
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
  published="$ready_dir/$(basename -- "$target_dir")"
  [[ ! -e "$published" && ! -L "$published" ]] || \
    fail 'READY publication target already exists'
  mv -T -- "$target_dir" "$published"
  python3 -I - "$producing_dir" "$ready_dir" <<'PY'
import os, sys
for name in sys.argv[1:]:
    descriptor = os.open(name, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)
PY
  report_dir="$published"
}

incident=''
incident_id='unknown'
report_dir=''
codex_exit=125
completed=0
finalize_failure() {
  exit_code=$?
  if ((exit_code != 0 && completed == 0)) && [[ -n "$incident" && -f "$incident" && ! -L "$incident" ]]; then
    failure_dir="$report_dir"
    if [[ -z "$failure_dir" || ! -d "$failure_dir" || -L "$failure_dir" ]]; then
      failure_dir="$(mktemp -d "$producing_dir/${incident_id}.attempt.XXXXXX")"
    fi
    chmod 0700 "$failure_dir"
    cp -- "$incident" "$failure_dir/incident.json" 2>/dev/null || true
    mv -T -- "$incident" "$failure_dir/processed-incident.json" 2>/dev/null || true
    python3 -I - "$failure_dir" "$exit_code" <<'PY' || true
import json, pathlib, sys
report = pathlib.Path(sys.argv[1])
exit_code = sys.argv[2]
try:
    incident = json.loads((report / "incident.json").read_text(encoding="utf-8"))
except Exception:
    incident = {}
defaults = {
    "prompt.md": "Creator tracker incident runner failed before prompt assembly.\n",
    "events.jsonl": "",
    "stderr.log": f"incident runner exit={exit_code}\n",
    "candidate.patch": "",
    "git-status.txt": "",
    "changed-paths.txt": "",
    "changed-paths.nul": "",
    "base-app-commit": f"{incident.get('app_commit', 'unknown')}\n",
    "base-release-id": f"{incident.get('release_id', 'unknown')}\n",
    "codex-exit-code": f"{exit_code}\n",
    "candidate-policy.json": '{"allowed_paths":[],"rejected_paths":["runner_failure"],"safe":false}\n',
}
for name, content in defaults.items():
    path = report / name
    if not path.exists():
        path.write_text(content, encoding="utf-8")
PY
    write_fallback_result \
      "$failure_dir/codex-result.json" "$exit_code" \
      "Codex incident runner failed before READY handoff with exit $exit_code." 2>/dev/null || true
    emit_ready "$failure_dir" 2>/dev/null && completed=1 || true
  fi
  return "$exit_code"
}
trap finalize_failure EXIT

readonly service_uid="$(id -u)"
readonly service_gid="$(id -g)"
for trusted_dir in "$processing_dir" "$producing_dir" "$codex_home"; do
  [[ ! -L "$trusted_dir" && -d "$trusted_dir" ]] || fail "unsafe runtime directory: $trusted_dir"
  [[ "$(stat -c '%u:%g:%a' -- "$trusted_dir")" == "$service_uid:$service_gid:700" ]] || \
    fail "runtime directory ownership mismatch: $trusted_dir"
done
[[ ! -L "$ready_dir" && -d "$ready_dir" && \
   "$(stat -c '%U:%G:%a' -- "$ready_dir")" == \
     'root:creator-tracker-codex:770' ]] || \
  fail 'READY handoff directory ownership mismatch'
[[ ! -L "$runs_dir" && -d "$runs_dir" ]] || fail "unsafe runtime directory: $runs_dir"
runs_identity="$(stat -c '%u:%g:%a' -- "$runs_dir")"
[[ "$runs_identity" == "$service_uid:$service_gid:700" || "$runs_identity" == '0:0:1777' ]] || \
  fail "ephemeral workspace ownership mismatch: $runs_dir"
[[ ! -L "$codex_bin" && -f "$codex_bin" && -x "$codex_bin" ]] || fail 'pinned Codex binary is unavailable'
[[ "$(stat -c '%u:%g:%a:%h' -- "$codex_bin")" == '0:0:555:1' ]] || \
  fail 'pinned Codex binary ownership is unsafe'
[[ ! -L "$code_mode_host" && -f "$code_mode_host" && -x "$code_mode_host" && \
   "$(stat -c '%u:%g:%a:%h' -- "$code_mode_host")" == '0:0:555:1' ]] || \
  fail 'pinned Codex code-mode host ownership is unsafe'
[[ ! -L "$codex_checksum" && -f "$codex_checksum" && \
   "$(stat -c '%u:%g:%a:%h' -- "$codex_checksum")" == '0:0:444:1' ]] || \
  fail 'pinned Codex checksum is unsafe'
(cd "$(dirname "$codex_bin")" && sha256sum --status -c "$codex_checksum") || \
  fail 'pinned Codex binary checksum failed'
[[ "$($codex_bin --version)" == 'codex-cli 0.149.0' ]] || fail 'pinned Codex version mismatch'
[[ ! -L "$codex_profile" && -f "$codex_profile" && \
   "$(stat -c '%u:%g:%a:%h' -- "$codex_profile")" == '0:0:444:1' ]] || \
  fail 'managed Codex permission profile is unsafe'
[[ ! -L "$result_validator" && -f "$result_validator" && -x "$result_validator" && \
   "$(stat -c '%u:%g:%a:%h' -- "$result_validator")" == '0:0:555:1' ]] || \
  fail 'managed result validator is unsafe'
exec 9>"$lock_file"
flock -n 9 || exit 0

mapfile -t queued < <(find "$inbox_dir" -maxdepth 1 -type f -name '*.json' -printf '%f\n' | LC_ALL=C sort)
((${#queued[@]} > 0)) || exit 0
incident_name="${queued[0]}"
incident_id="${incident_name%.json}"
[[ "$incident_id" =~ ^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{16}$ ]] || fail 'queued incident name is unsafe'

incident_source="$inbox_dir/$incident_name"
[[ ! -L "$incident_source" && -f "$incident_source" && \
   "$(stat -c '%U:%G:%a:%h' -- "$incident_source")" == \
     'root:creator-tracker-codex:440:1' ]] || fail 'incident handoff ownership is unsafe'
incident="$(mktemp "$processing_dir/$incident_id.processing.XXXXXX")"
cp --no-preserve=ownership -- "$incident_source" "$incident"
chmod 0600 "$incident"

report_dir="$(mktemp -d "$producing_dir/${incident_id}.attempt.XXXXXX")"
chmod 0700 "$report_dir"
run_dir="$runs_dir/$incident_id.$$.run"
workspace="$run_dir/gotall-viral-dash"
sandbox_home="$run_dir/home"
tmp_dir="$run_dir/tmp"
for new_dir in "$run_dir"; do
  [[ ! -e "$new_dir" && ! -L "$new_dir" ]] || fail "incident directory already exists: $new_dir"
  mkdir -m 0700 -- "$new_dir"
done
mkdir -m 0700 -- "$sandbox_home" "$tmp_dir"

mapfile -t incident_identity < <(python3 -I - "$incident" <<'PY'
import json, re, sys
with open(sys.argv[1], encoding="utf-8") as handle:
    incident = json.load(handle)
release_id = incident.get("release_id")
app_commit = incident.get("app_commit")
snapshot = incident.get("snapshot")
if not isinstance(release_id, str) or re.fullmatch(r"[0-9a-f]{64}", release_id) is None:
    raise SystemExit("incident release id is missing or invalid")
if not isinstance(app_commit, str) or re.fullmatch(r"[0-9a-f]{40}", app_commit) is None:
    raise SystemExit("incident app commit is missing or invalid")
if not isinstance(snapshot, dict):
    raise SystemExit("incident snapshot is missing")
selector = snapshot.get("selector_identity")
activation = snapshot.get("activation")
cutover = snapshot.get("cutover")
if (
    not isinstance(selector, dict)
    or not isinstance(selector.get("inode"), int)
    or not isinstance(selector.get("mtime_ns"), int)
    or not isinstance(activation, dict)
    or activation.get("lock_valid") is not True
    or activation.get("lock_held") is not False
    or activation.get("marker_present") is not False
    or not isinstance(cutover, dict)
    or cutover.get("ready") is not True
    or not isinstance(cutover.get("activation_epoch"), int)
    or snapshot.get("release_integrity", {}).get("ready") is not True
):
    raise SystemExit("incident was not bound to a safe activation and cutover state")
print(release_id)
print(app_commit)
print(selector["inode"])
print(selector["mtime_ns"])
print(cutover["activation_epoch"])
PY
)
release_id="${incident_identity[0]:-}"
app_commit="${incident_identity[1]:-}"
selector_inode="${incident_identity[2]:-}"
selector_mtime_ns="${incident_identity[3]:-}"
incident_activation_epoch="${incident_identity[4]:-}"
release="$releases_root/$release_id"

[[ "$(readlink -f -- "$current_selector")" == "$release" ]] || fail 'queued release is no longer active'
[[ ! -e /opt/creator-tracker/ACTIVATION_IN_PROGRESS ]] || fail 'activation began after incident dispatch'
python3 -I - "$current_selector" "$selector_inode" "$selector_mtime_ns" <<'PY'
import os, sys
stat = os.lstat(sys.argv[1])
if stat.st_ino != int(sys.argv[2]) or stat.st_mtime_ns != int(sys.argv[3]):
    raise SystemExit("active selector changed after incident dispatch")
PY
[[ "$(<"$release/RELEASE_ID")" == "$release_id" ]] || fail 'sealed release id does not match'
[[ "$(<"$release/APP_COMMIT")" == "$app_commit" ]] || fail 'sealed app commit does not match'
"$release/bin/verify-release" --installed "$release" "$release_id" >/dev/null || \
  fail 'sealed release verification failed'

# Build the incident workspace only from the immutable installed release. This
# avoids exposing mutable repositories (and their local dotenv files) to the
# model-generated command sandbox. Build output and dependencies are omitted;
# the exact release dependency tree is mounted read-only through a symlink.
install -d -m 0700 "$workspace"
tar -C "$release/app" \
  --exclude='./node_modules' \
  --exclude='./.next' \
  --exclude='./tsconfig.tsbuildinfo' \
  -cf - . | tar -C "$workspace" -xf -
chmod -R u+rwX "$workspace"
git -C "$workspace" init -q -b "codex/autopilot-$incident_id"
git -C "$workspace" config user.name 'Creator Tracker Autopilot'
git -C "$workspace" config user.email 'creator-tracker-autopilot@localhost'
git -C "$workspace" config core.hooksPath /dev/null
git -C "$workspace" add -A
git -C "$workspace" commit -q -m "Sealed creator tracker baseline $app_commit"
baseline_commit="$(git -C "$workspace" rev-parse HEAD)"
git_config_sha256="$(sha256sum "$workspace/.git/config" | awk '{print $1}')"
ln -s -- "$release/app/node_modules" "$workspace/node_modules"

prompt_file="$report_dir/prompt.md"
{
  cat "$prompt_template"
  printf '\n## Sanitized incident manifest\n\n```json\n'
  cat "$incident"
  printf '```\n'
} >"$prompt_file"
chmod 0600 "$prompt_file"

events="$report_dir/events.jsonl"
final="$report_dir/codex-result.json"
set +e
env -i \
  HOME="$codex_home" \
  USER=creator-tracker-codex \
  LOGNAME=creator-tracker-codex \
  CODEX_HOME="$codex_home" \
  TMPDIR="$tmp_dir" \
  PATH=/usr/bin:/bin \
  LANG=C.UTF-8 \
  LC_ALL=C.UTF-8 \
  TERM=xterm-256color \
  /usr/bin/timeout --signal=TERM --kill-after=30s 25m \
  "$codex_bin" -a never exec \
    --ignore-user-config \
    --ignore-rules \
    --strict-config \
    --profile autopilot \
    --ephemeral \
    --json \
    --model gpt-5.6-sol \
    -c "shell_environment_policy.set={PATH=\"/opt/creator-tracker/node/v24.20.0/bin:/usr/bin:/bin\",HOME=\"$sandbox_home\",TMPDIR=\"$tmp_dir\",CI=\"1\",GIT_OPTIONAL_LOCKS=\"0\",GIT_CONFIG_GLOBAL=\"/dev/null\",GIT_CONFIG_NOSYSTEM=\"1\"}" \
    -C "$workspace" \
    --output-schema "$output_schema" \
    --output-last-message "$final" \
    - <"$prompt_file" >"$events" 2>"$report_dir/stderr.log"
codex_exit=$?
set -e

[[ "$(readlink -f -- "$current_selector")" == "$release" ]] || \
  fail 'active release changed during Codex execution'
[[ ! -e /opt/creator-tracker/ACTIVATION_IN_PROGRESS ]] || \
  fail 'activation began during Codex execution'
python3 -I - "$current_selector" "$selector_inode" "$selector_mtime_ns" <<'PY'
import os, sys
value = os.lstat(sys.argv[1])
if value.st_ino != int(sys.argv[2]) or value.st_mtime_ns != int(sys.argv[3]):
    raise SystemExit("active selector changed during Codex execution")
PY

# Never invoke Git after model-controlled commands unless its execution
# configuration remains byte-identical to the root-seeded baseline. The
# permission profile also makes .git explicitly read-only.
[[ ! -L "$workspace/.git/config" && -f "$workspace/.git/config" ]] || \
  fail 'candidate altered Git configuration type'
[[ "$(sha256sum "$workspace/.git/config" | awk '{print $1}')" == "$git_config_sha256" ]] || \
  fail 'candidate altered Git execution configuration'

# Intent-to-add makes newly created source/tests appear in the binary patch.
# This is evidence extraction under the already unprivileged Codex identity;
# the root verifier independently reapplies the patch and derives its real paths.
(
  cd "$workspace"
  /usr/bin/git -c core.hooksPath=/dev/null -c core.fsmonitor=false \
    add -N -- . >/dev/null 2>&1 || true
  /usr/bin/git -c core.hooksPath=/dev/null -c core.fsmonitor=false \
    diff --no-renames --binary --no-ext-diff "$baseline_commit" >"$report_dir/candidate.patch"
  /usr/bin/git -c core.hooksPath=/dev/null -c core.fsmonitor=false \
    diff --no-renames --name-status --no-ext-diff "$baseline_commit" >"$report_dir/changed-paths.txt"
  /usr/bin/git -c core.hooksPath=/dev/null -c core.fsmonitor=false \
    diff --no-renames --name-only -z --no-ext-diff "$baseline_commit" >"$report_dir/changed-paths.nul"
  /usr/bin/git -c core.hooksPath=/dev/null -c core.fsmonitor=false \
    status --short --untracked-files=all --no-ahead-behind >"$report_dir/git-status.txt"
)
printf '%s\n' "$app_commit" >"$report_dir/base-app-commit"
printf '%s\n' "$release_id" >"$report_dir/base-release-id"
printf '%s\n' "$codex_exit" >"$report_dir/codex-exit-code"
cp -- "$incident" "$report_dir/incident.json"

policy_ok=true
if ! python3 -I - "$workspace" "$report_dir/changed-paths.nul" "$report_dir/candidate-policy.json" "$release/app/node_modules" <<'PY'
import json, os, pathlib, sys
workspace = pathlib.Path(sys.argv[1]).resolve()
raw = pathlib.Path(sys.argv[2]).read_bytes()
expected_dependencies = sys.argv[4]
paths = [item.decode("utf-8", "strict") for item in raw.split(b"\0") if item]
allowed = []
rejected = []
for path in paths:
    safe_name = (
        path.startswith("src/sync/")
        or path.startswith("tests/")
    ) and not any(part in {".git", "node_modules", ".."} for part in pathlib.PurePosixPath(path).parts)
    target = workspace / path
    if target.is_symlink() or (target.exists() and not target.is_file()):
        safe_name = False
    (allowed if safe_name else rejected).append(path)
dependencies = workspace / "node_modules"
if not dependencies.is_symlink() or os.readlink(dependencies) != expected_dependencies:
    rejected.append("node_modules")
result = {"allowed_paths": allowed, "rejected_paths": rejected, "safe": not rejected}
with open(sys.argv[3], "w", encoding="utf-8") as handle:
    json.dump(result, handle, sort_keys=True)
    handle.write("\n")
raise SystemExit(0 if not rejected else 1)
PY
then
  policy_ok=false
fi

result_valid=false
if ((codex_exit == 0)) && /usr/bin/python3 -I "$result_validator" "$output_schema" "$final"; then
  result_valid=true
else
  write_fallback_result \
    "$final" "$codex_exit" \
    "Codex exited $codex_exit or returned an invalid result; trusted verification was not claimed."
fi

cp -- "$incident" "$report_dir/processed-incident.json"
emit_ready "$report_dir"
/usr/bin/unlink "$incident"
python3 -I - "$processing_dir" <<'PY'
import os, sys
descriptor = os.open(sys.argv[1], os.O_RDONLY | os.O_DIRECTORY)
try:
    os.fsync(descriptor)
finally:
    os.close(descriptor)
PY
completed=1
printf 'creator-tracker Codex incident READY: %s report=%s result_valid=%s policy_ok=%s\n' \
  "$incident_id" "$report_dir" "$result_valid" "$policy_ok"
