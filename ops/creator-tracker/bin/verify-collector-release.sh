#!/bin/bash -p
set -euo pipefail

export PATH='/usr/bin:/bin'
unset NODE_OPTIONS NODE_PATH LD_PRELOAD LD_LIBRARY_PATH LD_AUDIT BASH_ENV ENV || true

usage() {
  printf '%s\n' \
    'usage: verify-collector-release.sh --installed RELEASE_DIR RELEASE_ID' \
    '       verify-collector-release.sh --root-staged RELEASE_DIR RELEASE_ID' \
    '       verify-collector-release.sh --staged RELEASE_DIR RELEASE_ID' \
    '       verify-collector-release.sh --seal-staged RELEASE_DIR RELEASE_ID' >&2
  exit 64
}

fail() {
  printf 'creator-tracker release verification: %s\n' "$*" >&2
  exit 1
}

mode="${1:-}"
release_dir="${2:-}"
expected_release_id="${3:-}"
[[ "$mode" =~ ^--(installed|root-staged|staged|seal-staged)$ && $# == 3 ]] || usage
[[ "$expected_release_id" =~ ^[0-9a-f]{64}$ ]] || fail 'expected release ID is not a SHA-256 value'
[[ "$release_dir" == /* && ! -L "$release_dir" && -d "$release_dir" ]] || fail 'release directory must be an absolute real directory'
release_dir="$(realpath -- "$release_dir")"
[[ "$release_dir" != / ]] || fail 'refusing the filesystem root'

if [[ "$mode" == --installed ]]; then
  [[ "$release_dir" == "/opt/creator-tracker/releases/$expected_release_id" ]] || \
    fail 'installed release path does not exactly match its release ID'
  expected_uid=0
  expected_gid=0
elif [[ "$mode" == --root-staged ]]; then
  [[ "$release_dir" == /opt/creator-tracker/releases/.* ]] || \
    fail 'root staging directory is outside the release parent'
  expected_uid=0
  expected_gid=0
else
  [[ "$release_dir" != /opt/creator-tracker/* ]] || \
    fail 'user-owned staging may not be under /opt/creator-tracker'
  expected_uid="$(id -u)"
  expected_gid="$(id -g)"
fi

[[ ! -L "$release_dir/RELEASE_ID" && -f "$release_dir/RELEASE_ID" ]] || \
  fail 'RELEASE_ID is missing'
[[ "$(<"$release_dir/RELEASE_ID")" == "$expected_release_id" ]] || \
  fail 'RELEASE_ID does not match the requested release'
[[ ! -L "$release_dir/APP_COMMIT" && -f "$release_dir/APP_COMMIT" && \
   "$(<"$release_dir/APP_COMMIT")" =~ ^[0-9a-f]{40}([0-9a-f]{24})?$ ]] || \
  fail 'APP_COMMIT is missing or invalid'

check_required_tree() {
  local entrypoint="$release_dir/app/ops/owned-tracker/release-entrypoint"
  local env_parser="$release_dir/app/ops/owned-tracker/release-env.mjs"
  local node="$release_dir/runtime/node"
  local ops_bundle_sha256 derived_release_id
  [[ -f "$entrypoint" && ! -L "$entrypoint" ]] || fail 'release entrypoint is missing'
  [[ -x "$entrypoint" ]] || fail 'release entrypoint is not executable'
  [[ "$(head -n 1 -- "$entrypoint")" == '#!/bin/bash -p' ]] || \
    fail 'release entrypoint does not use the absolute privileged Bash interpreter'
  [[ -f "$env_parser" && ! -L "$env_parser" && ! -x "$env_parser" ]] || \
    fail 'sealed release environment parser is missing or executable'
  grep -Fq '/usr/bin/env -i --' "$entrypoint" || \
    fail 'release entrypoint does not launch from an empty environment'
  if grep -E -q -- '--env-file|node_env_arg|source[[:space:]].*\.env|\.[[:space:]].*\.env' \
    "$entrypoint"; then
    fail 'release entrypoint can load an unfiltered dotenv file'
  fi
  for injection_key in NODE_OPTIONS NODE_PATH LD_PRELOAD BASH_ENV ENV SHELLOPTS; do
    grep -Fq "\"$injection_key\"" "$env_parser" || \
      fail "release environment parser does not reject $injection_key"
  done
  grep -Fq 'key.startsWith("TSX_")' "$env_parser" || \
    fail 'release environment parser does not reject TSX startup keys'
  grep -Fq 'unknown key is forbidden' "$env_parser" || \
    fail 'release environment parser does not reject unknown keys'
  grep -Fq 'DASH_EXTRA_USERS' "$env_parser" || \
    fail 'release environment parser omits dashboard multi-user credentials'
  grep -Fq 'SCRAPECREATORS_API_KEY_CONFIGURED' "$env_parser" || \
    fail 'release environment parser does not derive the health readiness marker'
  [[ -f "$node" && ! -L "$node" && -x "$node" ]] || fail 'pinned Node runtime is missing'
  [[ -s "$release_dir/app/.next/BUILD_ID" ]] || fail 'Next.js build artifact is missing'
  [[ "$(<"$release_dir/app/.next/BUILD_ID")" == "$expected_release_id" ]] || \
    fail 'Next.js build ID does not match the release ID'
  [[ -f "$release_dir/app/node_modules/next/dist/bin/next" ]] || fail 'Next.js runtime dependency is missing'
  [[ -f "$release_dir/app/node_modules/tsx/dist/loader.mjs" ]] || fail 'tsx runtime dependency is missing'
  [[ -d "$release_dir/app/node_modules/better-sqlite3" ]] || fail 'SQLite runtime dependency is missing'
  [[ -f "$release_dir/bin/verify-release" && ! -L "$release_dir/bin/verify-release" && \
     -x "$release_dir/bin/verify-release" ]] || fail 'installed release verifier is missing'
  [[ -f "$release_dir/bin/run-contained-job" && \
     ! -L "$release_dir/bin/run-contained-job" && \
     -x "$release_dir/bin/run-contained-job" ]] || fail 'sealed job supervisor is missing'
  [[ -f "$release_dir/bin/check-dashboard-health" && \
     ! -L "$release_dir/bin/check-dashboard-health" && \
     -x "$release_dir/bin/check-dashboard-health" ]] || fail 'sealed health checker is missing'
  [[ -f "$release_dir/bin/activate-release" && \
     ! -L "$release_dir/bin/activate-release" && \
     -x "$release_dir/bin/activate-release" ]] || fail 'sealed release activator is missing'
  [[ -f "$release_dir/bin/run-canonical-seed" && \
     ! -L "$release_dir/bin/run-canonical-seed" && \
     -x "$release_dir/bin/run-canonical-seed" ]] || \
    fail 'sealed one-shot canonical seed runner is missing'
  [[ -f "$release_dir/bin/run-cutover-completeness" && \
     ! -L "$release_dir/bin/run-cutover-completeness" && \
     -x "$release_dir/bin/run-cutover-completeness" ]] || \
    fail 'sealed cutover completeness runner is missing'
  [[ -f "$release_dir/bin/run-instagram-credit-rearm" && \
     ! -L "$release_dir/bin/run-instagram-credit-rearm" && \
     -x "$release_dir/bin/run-instagram-credit-rearm" ]] || \
    fail 'sealed Instagram credit rearm runner is missing'
  [[ -f "$release_dir/bin/run-raw-verifier-provision" && \
     ! -L "$release_dir/bin/run-raw-verifier-provision" && \
     -x "$release_dir/bin/run-raw-verifier-provision" ]] || \
    fail 'sealed raw verifier provision runner is missing'
  for trusted_helper in render-config activation-boundary activation-system-state \
    activation-user-units durable-state activation-database probe-database-access \
    migrate-provider-imports validate-cutover-result; do
    [[ -f "$release_dir/bin/$trusted_helper" && ! -L "$release_dir/bin/$trusted_helper" && \
       -x "$release_dir/bin/$trusted_helper" ]] || \
      fail "trusted activation helper is missing: $trusted_helper"
  done
  if grep -Eq 'app/ops/owned-tracker/(release-env|activation-database)\.mjs' \
      "$release_dir/bin/activate-release"; then
    fail 'root activation can execute candidate application JavaScript'
  fi
  [[ -f "$release_dir/tmpfiles.d/creator-tracker.conf" && \
     ! -L "$release_dir/tmpfiles.d/creator-tracker.conf" ]] || \
    fail 'sealed tmpfiles definition is missing'
  [[ "$(head -n 1 -- "$release_dir/bin/run-contained-job")" == '#!/bin/bash -p' && \
     "$(head -n 1 -- "$release_dir/bin/check-dashboard-health")" == '#!/bin/bash -p' && \
     "$(head -n 1 -- "$release_dir/bin/activate-release")" == '#!/bin/bash -p' && \
     "$(head -n 1 -- "$release_dir/bin/run-instagram-credit-rearm")" == '#!/bin/bash -p' ]] || \
    fail 'sealed runtime scripts do not use the absolute privileged Bash interpreter'
  for activation_marker in \
    '--expected-current' \
    '--restore-legacy' \
    '/opt/creator-tracker/ACTIVATION_IN_PROGRESS' \
    '/opt/creator-tracker/activation.lock' \
    '/etc/systemd/system' \
    'systemctl daemon-reload' \
    'migrate-database' \
    'database.backup' \
    'setfacl --restore'; do
    grep -Fq -- "$activation_marker" "$release_dir/bin/activate-release" || \
      fail "sealed activator omits transaction control: $activation_marker"
  done
  grep -Fq '/usr/bin/flock -n "$activation_fd"' "$release_dir/bin/activate-release" || \
    fail 'sealed activator does not hold the global activation flock'
  grep -Fq "readonly system_unit_dir='/etc/systemd/system'" \
    "$release_dir/bin/activate-release" || \
    fail 'sealed activator does not target the root system manager'
  if grep -Eq 'install .*\$user_unit_dir/[^)]*\$unit' \
      "$release_dir/bin/activate-release"; then
    fail 'sealed activator installs owner-writable production units'
  fi
  local instagram_rearm_runner="$release_dir/bin/run-instagram-credit-rearm"
  for rearm_marker in \
    'runner release is not the current sealed release' \
    'LoadCredential=role-env:$credential' \
    '--confirm-provider-launch-balance-at-least-1250' \
    '--confirm-provider-top-up-one-request' \
    'the production cutover marker belongs to another release' \
    '"$release/bin/run-contained-job"' \
    'systemctl enable --now "$discovery_timer" "$scheduler_timer"'; do
    grep -Fq -- "$rearm_marker" "$instagram_rearm_runner" || \
      fail "sealed Instagram credit rearm runner omits its safety gate: $rearm_marker"
  done
  if grep -Fq 'provider-source.env' "$instagram_rearm_runner"; then
    fail 'Instagram credit rearm runner can receive the Viral provider credential'
  fi
  [[ -f "$release_dir/NODE_VERSION" && -f "$release_dir/NODE_SHA256" && \
     -f "$release_dir/NPM_CLI_SHA256" && \
     -f "$release_dir/OPS_INPUTS.sha256" && \
     -f "$release_dir/OPS_BUNDLE_SHA256" ]] || fail 'release provenance is missing'
  [[ "$(sha256sum -- "$node" | awk '{print $1}')" == "$(<"$release_dir/NODE_SHA256")" ]] || \
    fail 'pinned Node runtime hash does not match'
  [[ "$($node --version)" == "$(<"$release_dir/NODE_VERSION")" ]] || \
    fail 'pinned Node runtime version does not match'
  ops_bundle_sha256="$(sha256sum -- "$release_dir/OPS_INPUTS.sha256" | awk '{print $1}')"
  [[ "$ops_bundle_sha256" == "$(<"$release_dir/OPS_BUNDLE_SHA256")" ]] || \
    fail 'ops bundle provenance hash does not match'
  derived_release_id="$(printf 'format_version=3\napp_commit=%s\nnode_sha256=%s\nnpm_cli_sha256=%s\nops_bundle_sha256=%s\n' \
    "$(<"$release_dir/APP_COMMIT")" "$(<"$release_dir/NODE_SHA256")" \
    "$(<"$release_dir/NPM_CLI_SHA256")" "$ops_bundle_sha256" | sha256sum | awk '{print $1}')"
  [[ "$derived_release_id" == "$expected_release_id" ]] || \
    fail 'composite release identity does not match its provenance'

  local role target
  for role in roster-refresh scheduler-tick instagram-discovery instagram-scheduler \
    instagram-credit-rearm \
    provider-reconcile canonical-delivery canonical-replay canonical-seed raw-verifier cutover-verify migrate-database \
    collector-worker check-coverage; do
    [[ -L "$release_dir/bin/$role" ]] || fail "release role is not a symlink: $role"
    target="$(readlink -- "$release_dir/bin/$role")"
    [[ "$target" == ../app/ops/owned-tracker/release-entrypoint ]] || \
      fail "release role has an unexpected target: $role"
  done

  local unit_file unit_path unit_basename expected_proc_subset
  local -a unit_files=(
    creator-tracker-dashboard-health.service \
    creator-tracker-dashboard-health.timer \
    creator-tracker-canonical-delivery.service \
    creator-tracker-canonical-delivery.timer \
    creator-tracker-instagram-discovery.service \
    creator-tracker-instagram-discovery.timer \
    creator-tracker-instagram-scheduler.service \
    creator-tracker-instagram-scheduler.timer \
    creator-tracker-provider-reconcile.service \
    creator-tracker-provider-reconcile.timer \
    creator-tracker-raw-verifier.service \
    creator-tracker-raw-verifier.timer \
    creator-tracker-roster-refresh.service \
    creator-tracker-roster-refresh.timer \
    creator-tracker-scheduler-tick.service \
    creator-tracker-scheduler-tick.timer \
    creator-tracker-worker.service \
    creator-tracker.slice
  )
  declare -A expected_unit=()
  for unit_file in "${unit_files[@]}"; do
    expected_unit["$unit_file"]=1
    [[ -f "$release_dir/systemd/$unit_file" && \
       ! -L "$release_dir/systemd/$unit_file" ]] || \
      fail "sealed systemd unit is missing: $unit_file"
  done
  while IFS= read -r -d '' unit_path; do
    unit_basename="${unit_path##*/}"
    [[ -f "$unit_path" && ! -L "$unit_path" && \
       -n "${expected_unit[$unit_basename]:-}" ]] || \
      fail "unexpected sealed systemd inventory entry: $unit_basename"
  done < <(find "$release_dir/systemd" -mindepth 1 -maxdepth 1 -print0 | LC_ALL=C sort -z)
  local tmpfiles_path="$release_dir/tmpfiles.d/creator-tracker.conf"
  [[ "$(find "$release_dir/tmpfiles.d" -mindepth 1 -maxdepth 1 -printf '%f\n')" == \
     creator-tracker.conf ]] || fail 'sealed tmpfiles inventory is not exact'
  for lock_name in collector-worker dashboard-health roster-refresh scheduler-tick \
    instagram-discovery instagram-scheduler instagram-credit-rearm \
    provider-reconcile canonical-delivery \
    raw-verifier owned-tracker-writer; do
    grep -Fq "/run/creator-tracker/locks/$lock_name.lock" "$tmpfiles_path" || \
      fail "tmpfiles definition omits root runtime lock: $lock_name"
  done
  grep -Fqx \
    'a /run/creator-tracker/locks/canonical-delivery.lock - - - - u:creator-tracker-writer:rw-,u:creator-tracker-health:rw-,m::rw-,o::---' \
    "$tmpfiles_path" || fail 'canonical-delivery lock omits the exact health/writer ACL'
  grep -Fqx \
    'a /run/creator-tracker/locks/owned-tracker-writer.lock - - - - u:creator-tracker-writer:rw-,u:creator-tracker-health:rw-,m::rw-,o::---' \
    "$tmpfiles_path" || fail 'shared writer lock omits the exact health/writer ACL'
  if grep -R -E -q '\.local/libexec/creator-tracker|CREATOR_TRACKER_.*_EXECUTABLE' \
    "$release_dir/systemd"; then
    fail 'sealed systemd units retain a mutable executable path'
  fi
  local service_path service_name role_name expected_user
  declare -A service_roles=(
    [creator-tracker-worker.service]=collector-worker
    [creator-tracker-roster-refresh.service]=roster-refresh
    [creator-tracker-scheduler-tick.service]=scheduler-tick
    [creator-tracker-instagram-discovery.service]=instagram-discovery
    [creator-tracker-instagram-scheduler.service]=instagram-scheduler
    [creator-tracker-provider-reconcile.service]=provider-reconcile
    [creator-tracker-canonical-delivery.service]=canonical-delivery
    [creator-tracker-raw-verifier.service]=raw-verifier
    [creator-tracker-dashboard-health.service]=dashboard-health
  )
  declare -A service_users=(
    [creator-tracker-worker.service]=creator-tracker-dashboard
    [creator-tracker-roster-refresh.service]=creator-tracker-writer
    [creator-tracker-scheduler-tick.service]=creator-tracker-writer
    [creator-tracker-instagram-discovery.service]=creator-tracker-writer
    [creator-tracker-instagram-scheduler.service]=creator-tracker-writer
    [creator-tracker-provider-reconcile.service]=creator-tracker-writer
    [creator-tracker-canonical-delivery.service]=creator-tracker-writer
    [creator-tracker-raw-verifier.service]=creator-tracker-raw-verifier
    [creator-tracker-dashboard-health.service]=creator-tracker-health
  )
  local required_unset='UnsetEnvironment=LD_PRELOAD LD_LIBRARY_PATH LD_AUDIT BASH_ENV ENV SHELLOPTS BASHOPTS BASH_LOADABLES_PATH NODE_OPTIONS NODE_PATH PYTHONPATH PYTHONHOME PYTHONSTARTUP PERL5OPT PERL5LIB RUBYOPT RUBYLIB GCONV_PATH TSX_TSCONFIG_PATH CREATOR_TRACKER_RUNTIME_DIR CREATOR_TRACKER_STATE_DIR CREATOR_TRACKER_TEST_ONLY_ALLOW_ARBITRARY_COMMAND CREATOR_TRACKER_TEST_ONLY_SKIP_COVERAGE'
  while IFS= read -r -d '' service_path; do
    service_name="${service_path##*/}"
    role_name="${service_roles[$service_name]}"
    expected_user="${service_users[$service_name]}"
    grep -Fqx 'WorkingDirectory=/opt/creator-tracker/current/app' "$service_path" || \
      fail "sealed service retains a mutable working directory: $service_path"
    grep -Fqx 'Environment=PATH=/usr/bin:/bin' "$service_path" || \
      fail "sealed service does not pin a system-only PATH: $service_path"
    grep -Fqx "$required_unset" "$service_path" || \
      fail "sealed service does not remove interpreter injection variables: $service_path"
    grep -Eq '^ExecStart=/bin/bash --noprofile --norc -p -- /opt/creator-tracker/current/bin/run-contained-job [a-z0-9-]+$' \
      "$service_path" || \
      fail "sealed service does not use privileged absolute Bash: $service_path"
    grep -Fqx "User=$expected_user" "$service_path" || \
      fail "sealed service does not use its isolated no-login UID: $service_name"
    grep -Fqx "Group=$expected_user" "$service_path" || \
      fail "sealed service does not use its isolated primary group: $service_name"
    grep -Fqx 'ProtectProc=invisible' "$service_path" || \
      fail "sealed service does not hide cross-UID proc state: $service_name"
    expected_proc_subset=pid
    case "$service_name" in
      creator-tracker-roster-refresh.service|creator-tracker-scheduler-tick.service)
        expected_proc_subset=all
        ;;
    esac
    grep -Fqx "ProcSubset=$expected_proc_subset" "$service_path" || \
      fail "sealed service exposes non-process procfs: $service_name"
    grep -Fqx 'RestrictNamespaces=true' "$service_path" || \
      fail "sealed service can create or join namespaces: $service_name"
    grep -Fqx 'CapabilityBoundingSet=' "$service_path" || \
      fail "sealed service retains a capability bounding set: $service_name"
    grep -Fqx 'AmbientCapabilities=' "$service_path" || \
      fail "sealed service retains ambient capabilities: $service_name"
    grep -Fqx "EnvironmentFile=/etc/creator-tracker/runtime/$role_name.env" "$service_path" || \
      fail "sealed service does not use its root runtime file: $service_name"
    credential_role="$role_name"
    [[ "$role_name" != dashboard-health ]] || credential_role=check-coverage
    grep -Fqx "LoadCredential=role-env:/etc/creator-tracker/credentials/$credential_role.env" \
      "$service_path" || fail "sealed service does not use its role credential: $service_name"
    if grep -Eq '^Exec(StartPre|StartPost|Reload|Stop|StopPost)=' "$service_path"; then
      fail "sealed service contains an unexpected lifecycle command: $service_name"
    fi
    if grep -Eq '/home/ark296/projects/(gotall-viral-dash/\.env|tt-ads-manager/web/\.env)|%h/\.config' \
      "$service_path"; then
      fail "sealed service exposes a mutable source credential: $service_name"
    fi
  done < <(find "$release_dir/systemd" -maxdepth 1 -type f -name '*.service' -print0)
  grep -Fqx 'LoadCredential=provider-env:/etc/creator-tracker/credentials/provider-source.env' \
    "$release_dir/systemd/creator-tracker-provider-reconcile.service" || \
    fail 'provider service does not receive its private sanitized credential'
  if grep -R -F 'provider-source.env' "$release_dir/systemd" | \
      grep -v 'creator-tracker-provider-reconcile.service' >/dev/null; then
    fail 'a non-provider service can receive the Viral provider credential'
  fi
  if grep -R -F 'credentials/raw-verifier.env' "$release_dir/systemd" | \
      grep -v 'creator-tracker-raw-verifier.service' >/dev/null; then
    fail 'a non-verifier service can receive the raw verifier credential'
  fi
  grep -Fqx 'LoadCredential=role-env:/etc/creator-tracker/credentials/raw-verifier.env' \
    "$release_dir/systemd/creator-tracker-raw-verifier.service" || \
    fail 'raw verifier does not receive its dedicated credential'
  if grep -R -Fq 'credentials/canonical-seed.env' "$release_dir/systemd"; then
    fail 'canonical seed credential must never be attached to a persistent unit'
  fi
  for scraper_unit in creator-tracker-roster-refresh.service \
    creator-tracker-scheduler-tick.service creator-tracker-instagram-discovery.service \
    creator-tracker-instagram-scheduler.service creator-tracker-provider-reconcile.service; do
    grep -Fqx 'BindPaths=/var/lib/creator-tracker/raw-evidence-v1' \
      "$release_dir/systemd/$scraper_unit" || fail "scraper lacks private raw evidence CAS: $scraper_unit"
  done
  for non_scraper_unit in creator-tracker-worker.service \
    creator-tracker-dashboard-health.service creator-tracker-canonical-delivery.service; do
    if grep -Fq 'BindPaths=/var/lib/creator-tracker/raw-evidence-v1' \
      "$release_dir/systemd/$non_scraper_unit"; then
      fail "non-scraper can access raw evidence CAS: $non_scraper_unit"
    fi
    grep -Fqx 'InaccessiblePaths=/var/lib/creator-tracker/raw-evidence-v1' \
      "$release_dir/systemd/$non_scraper_unit" || \
      fail "non-scraper does not hide raw evidence CAS: $non_scraper_unit"
  done
  grep -Fqx 'BindReadOnlyPaths=/var/lib/creator-tracker/raw-evidence-v1' \
    "$release_dir/systemd/creator-tracker-raw-verifier.service" || \
    fail 'raw verifier does not have read-only source evidence access'
  grep -Fqx 'BindPaths=/var/lib/creator-tracker/verified-raw-evidence-v1' \
    "$release_dir/systemd/creator-tracker-raw-verifier.service" || \
    fail 'raw verifier does not have archive write access'
  for non_verifier_unit in creator-tracker-worker.service \
    creator-tracker-dashboard-health.service creator-tracker-provider-reconcile.service \
    creator-tracker-canonical-delivery.service creator-tracker-roster-refresh.service \
    creator-tracker-scheduler-tick.service creator-tracker-instagram-discovery.service \
    creator-tracker-instagram-scheduler.service; do
    grep -Fqx 'InaccessiblePaths=/var/lib/creator-tracker/verified-raw-evidence-v1' \
      "$release_dir/systemd/$non_verifier_unit" || \
      fail "non-verifier does not hide verified evidence archive: $non_verifier_unit"
  done
  grep -Fqx 'Persistent=true' \
    "$release_dir/systemd/creator-tracker-canonical-delivery.timer" || \
    fail 'canonical delivery timer is not reboot persistent'
  grep -Fqx 'OnCalendar=*-*-* *:*:00' \
    "$release_dir/systemd/creator-tracker-canonical-delivery.timer" || \
    fail 'canonical delivery timer is not scheduled every minute'
  if grep -R -Fq '/home/ark296/projects/gotall-viral-dash/data' "$release_dir/systemd"; then
    fail 'sealed systemd inventory still binds mutable repository data'
  fi

  local live_dotenv_found=0 dotenv_path dotenv_basename
  while IFS= read -r -d '' dotenv_path; do
    dotenv_basename="${dotenv_path##*/}"
    if [[ "$dotenv_basename" == .env || \
          ( "$dotenv_basename" == .env.* && "$dotenv_basename" != .env.example ) ]]; then
      live_dotenv_found=1
    fi
  done < <(find "$release_dir/app" -xdev -name '.env*' -print0)
  if ((live_dotenv_found != 0)); then
    fail 'release contains a live dotenv file'
  fi
  if find "$release_dir/app" -path '*/data/gotall-viral.db*' -print -quit | grep -q .; then
    fail 'release contains a database copy instead of the external database'
  fi
}

write_inventories() {
  local sentinel="$release_dir/.creator-tracker-unsealed-release"
  [[ ! -L "$sentinel" && -f "$sentinel" && "$(<"$sentinel")" == "$expected_release_id" ]] || \
    fail 'staging seal sentinel is missing or invalid'
  [[ ! -e "$release_dir/MANIFEST.sha256" && ! -e "$release_dir/SYMLINKS.tsv" && \
     ! -e "$release_dir/DIRECTORIES.tsv" ]] || fail 'staging tree is already sealed'

  local path raw_target resolved
  while IFS= read -r -d '' path; do
    [[ "$path" != *$'\n'* && "$path" != *$'\t'* ]] || fail 'release path contains a newline or tab'
  done < <(find "$release_dir" -xdev -mindepth 1 -print0)
  while IFS= read -r -d '' path; do
    raw_target="$(readlink -- "$path")"
    [[ "$raw_target" != /* && "$raw_target" != *$'\n'* && "$raw_target" != *$'\t'* ]] || \
      fail "unsafe release symlink: $path"
    resolved="$(readlink -f -- "$path")" || fail "broken release symlink: $path"
    [[ "$resolved" == "$release_dir"/* ]] || fail "release symlink escapes the release: $path"
  done < <(find "$release_dir" -xdev -type l -print0)

  rm -- "$sentinel"
  (
    cd -- "$release_dir"
    find . -xdev -mindepth 1 -type d -printf '%P\n' | LC_ALL=C sort
  ) >"$release_dir/DIRECTORIES.tsv"
  (
    cd -- "$release_dir"
    find . -xdev -type l -printf '%P\t%l\n' | LC_ALL=C sort
  ) >"$release_dir/SYMLINKS.tsv"
  : >"$release_dir/MANIFEST.sha256"
  find "$release_dir" -xdev -type d -exec chmod 0555 {} +
  while IFS= read -r -d '' path; do
    [[ "$path" == "$release_dir/MANIFEST.sha256" ]] && continue
    if [[ -x "$path" ]]; then chmod 0555 -- "$path"; else chmod 0444 -- "$path"; fi
  done < <(find "$release_dir" -xdev -type f -print0)
  (
    cd -- "$release_dir"
    find . -xdev -type f ! -name MANIFEST.sha256 -print0 | \
      LC_ALL=C sort -z | xargs -0 -r sha256sum
  ) >"$release_dir/MANIFEST.sha256"
  chmod 0444 "$release_dir/MANIFEST.sha256" \
    "$release_dir/DIRECTORIES.tsv" "$release_dir/SYMLINKS.tsv"
}

check_required_tree
if [[ "$mode" == --seal-staged ]]; then
  write_inventories
  mode=--staged
fi

[[ -f "$release_dir/MANIFEST.sha256" && -f "$release_dir/SYMLINKS.tsv" && \
   -f "$release_dir/DIRECTORIES.tsv" ]] || fail 'release manifests are missing'

if find "$release_dir" -xdev \( ! -uid "$expected_uid" -o ! -gid "$expected_gid" \) -print -quit | grep -q .; then
  fail 'release contains a path with the wrong owner or group'
fi
if find "$release_dir" -xdev -type d ! -perm 0555 -print -quit | grep -q .; then
  fail 'release contains a directory whose mode is not 0555'
fi
if find "$release_dir" -xdev -type f ! \( -perm 0444 -o -perm 0555 \) -print -quit | grep -q .; then
  fail 'release contains a file whose mode is not 0444 or 0555'
fi
if find "$release_dir" -xdev -type f -links +1 -print -quit | grep -q .; then
  fail 'release contains a multiply-linked regular file'
fi
if find "$release_dir" -xdev ! -type d ! -type f ! -type l -print -quit | grep -q .; then
  fail 'release contains a special filesystem object'
fi

tmp_dir="$(mktemp -d)"
cleanup() { rm -rf -- "$tmp_dir"; }
trap cleanup EXIT
(
  cd -- "$release_dir"
  find . -xdev -mindepth 1 -type d -printf '%P\n' | LC_ALL=C sort
) >"$tmp_dir/DIRECTORIES.tsv"
cmp -s "$release_dir/DIRECTORIES.tsv" "$tmp_dir/DIRECTORIES.tsv" || fail 'directory inventory changed'
(
  cd -- "$release_dir"
  find . -xdev -type l -printf '%P\t%l\n' | LC_ALL=C sort
) >"$tmp_dir/SYMLINKS.tsv"
cmp -s "$release_dir/SYMLINKS.tsv" "$tmp_dir/SYMLINKS.tsv" || fail 'symlink inventory changed'

while IFS= read -r -d '' path; do
  target="$(readlink -f -- "$path")" || fail "broken release symlink: $path"
  [[ "$target" == "$release_dir"/* ]] || fail "release symlink escapes the release: $path"
done < <(find "$release_dir" -xdev -type l -print0)

(
  cd -- "$release_dir"
  find . -xdev -type f ! -name MANIFEST.sha256 -print0 | \
    LC_ALL=C sort -z | xargs -0 -r sha256sum
) >"$tmp_dir/MANIFEST.sha256"
cmp -s "$release_dir/MANIFEST.sha256" "$tmp_dir/MANIFEST.sha256" || fail 'file inventory or hash changed'
(
  cd -- "$release_dir"
  sha256sum --strict -c MANIFEST.sha256 >/dev/null
) || fail 'manifest verification failed'

printf 'creator-tracker release verified: %s (%s)\n' "$expected_release_id" "${mode#--}"
