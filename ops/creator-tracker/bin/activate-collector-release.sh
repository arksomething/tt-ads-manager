#!/bin/bash -p
set -euo pipefail

export PATH='/usr/sbin:/usr/bin:/sbin:/bin'
unset NODE_OPTIONS NODE_PATH LD_PRELOAD LD_LIBRARY_PATH LD_AUDIT BASH_ENV ENV || true

readonly owner_uid=1000
readonly owner_user=ark296
readonly app_repo='/home/ark296/projects/gotall-viral-dash'
readonly owner_env="$app_repo/.env.local"
readonly legacy_database="$app_repo/data/gotall-viral.db"
readonly legacy_provider_imports="$app_repo/data/imports"
readonly data_root='/var/lib/creator-tracker'
readonly data_dir="$data_root/state"
readonly database="$data_dir/gotall-viral.db"
readonly provider_imports="$data_root/imports"
readonly raw_evidence="$data_root/raw-evidence-v1"
readonly verified_raw_evidence="$data_root/verified-raw-evidence-v1"
readonly provider_env='/home/ark296/projects/tt-ads-manager/web/.env'
readonly host_env='/home/ark296/.config/creator-tracker/env'
readonly canonical_env='/home/ark296/.config/creator-tracker/pending/canonical-ingestion.env'
readonly raw_verifier_env='/home/ark296/.config/creator-tracker/pending/raw-verifier.env'
readonly release_parent='/opt/creator-tracker/releases'
readonly selector='/opt/creator-tracker/current'
readonly marker='/opt/creator-tracker/ACTIVATION_IN_PROGRESS'
readonly activation_lock='/opt/creator-tracker/activation.lock'
readonly history='/opt/creator-tracker/activation-history.tsv'
readonly transaction_parent='/opt/creator-tracker/activation-transactions'
readonly system_unit_dir='/etc/systemd/system'
readonly user_unit_dir='/home/ark296/.config/systemd/user'
readonly config_dir='/etc/creator-tracker'
readonly tmpfiles_target='/etc/tmpfiles.d/creator-tracker.conf'

readonly -a unit_files=(
  creator-tracker-dashboard-health.service
  creator-tracker-dashboard-health.timer
  creator-tracker-canonical-delivery.service
  creator-tracker-canonical-delivery.timer
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
readonly -a service_units=(
  creator-tracker-dashboard-health.service
  creator-tracker-canonical-delivery.service
  creator-tracker-instagram-discovery.service
  creator-tracker-instagram-scheduler.service
  creator-tracker-provider-reconcile.service
  creator-tracker-raw-verifier.service
  creator-tracker-roster-refresh.service
  creator-tracker-scheduler-tick.service
  creator-tracker-worker.service
)
readonly -a activation_timer_units=(
  creator-tracker-roster-refresh.timer
  creator-tracker-scheduler-tick.timer
  creator-tracker-instagram-discovery.timer
  creator-tracker-instagram-scheduler.timer
  creator-tracker-provider-reconcile.timer
  creator-tracker-canonical-delivery.timer
  creator-tracker-raw-verifier.timer
  creator-tracker-dashboard-health.timer
)
readonly -a activation_drain_service_units=(
  creator-tracker-roster-refresh.service
  creator-tracker-scheduler-tick.service
  creator-tracker-instagram-discovery.service
  creator-tracker-instagram-scheduler.service
  creator-tracker-provider-reconcile.service
  creator-tracker-canonical-delivery.service
  creator-tracker-raw-verifier.service
  creator-tracker-dashboard-health.service
)
readonly -a activation_worker_units=(
  creator-tracker-worker.service
)
readonly activation_drain_timeout_seconds=5700
readonly activation_drain_poll_seconds=1
readonly -a managed_units=(
  creator-tracker-worker.service
  creator-tracker-roster-refresh.service creator-tracker-roster-refresh.timer
  creator-tracker-scheduler-tick.service creator-tracker-scheduler-tick.timer
  creator-tracker-instagram-discovery.service creator-tracker-instagram-discovery.timer
  creator-tracker-instagram-scheduler.service creator-tracker-instagram-scheduler.timer
  creator-tracker-provider-reconcile.service creator-tracker-provider-reconcile.timer
  creator-tracker-raw-verifier.service creator-tracker-raw-verifier.timer
  creator-tracker-dashboard-health.service creator-tracker-dashboard-health.timer
  creator-tracker-canonical-delivery.service creator-tracker-canonical-delivery.timer
)
readonly -a jobs=(
  collector-worker dashboard-health roster-refresh scheduler-tick
  instagram-discovery instagram-scheduler instagram-credit-rearm
  provider-reconcile canonical-delivery
  raw-verifier migrate-database owned-tracker-writer
)

declare -a activation_restore_system_timers=()
declare -a activation_restore_user_timers=()
declare -a activation_restore_system_workers=()
declare -a activation_restore_user_workers=()
declare -a activation_observed_system_jobs=()
declare -a activation_observed_user_jobs=()
activation_runtime_restore_required=0

fail() {
  printf 'creator-tracker activation: %s\n' "$*" >&2
  exit 1
}

usage() {
  printf '%s\n' \
    'usage: activate-release --release RELEASE_ID --expected-current RELEASE_ID|none [--allow-rollback]' \
    '       activate-release --prepare-identities' \
    '       activate-release --restore-legacy --transaction TRANSACTION_ID --expected-current RELEASE_ID' \
    '       activate-release --recover' >&2
  exit 64
}

canonical_self="$(readlink -f -- "${BASH_SOURCE[0]}")"
[[ "$canonical_self" =~ ^/opt/creator-tracker/releases/[0-9a-f]{64}/bin/activate-release$ ]] || \
  fail 'activation must run from a sealed /opt release'
readonly self_release_dir="${canonical_self%/bin/activate-release}"
readonly self_release_id="${self_release_dir##*/}"
readonly durable_state="$self_release_dir/bin/durable-state"
readonly system_state="$self_release_dir/bin/activation-system-state"
readonly user_unit_state="$self_release_dir/bin/activation-user-units"
read -r self_uid self_gid self_mode self_links < <(stat -c '%u %g %a %h' -- "$canonical_self")
[[ "$self_uid" == 0 && "$self_gid" == 0 && "$self_links" == 1 && \
   $((8#$self_mode & 8#022)) == 0 ]] || fail 'activation executable is not root-controlled'

if ((EUID != 0)); then
  exec sudo -n /usr/bin/env -i -- PATH=/usr/sbin:/usr/bin:/sbin:/bin \
    LANG=C.UTF-8 LC_ALL=C.UTF-8 \
    /bin/bash --noprofile --norc -p -- "$canonical_self" "$@"
fi

mode=activate
release_id=''
expected_current=''
transaction_id=''
allow_rollback=0
while (($# > 0)); do
  case "$1" in
    --release) (($# >= 2)) || usage; release_id="$2"; shift 2 ;;
    --expected-current) (($# >= 2)) || usage; expected_current="$2"; shift 2 ;;
    --allow-rollback) allow_rollback=1; shift ;;
    --transaction) (($# >= 2)) || usage; transaction_id="$2"; shift 2 ;;
    --prepare-identities)
      [[ "$mode" == activate && -z "$release_id" ]] || usage
      mode=prepare-identities
      shift
      ;;
    --recover) [[ "$mode" == activate && -z "$release_id" ]] || usage; mode=recover; shift ;;
    --restore-legacy)
      [[ "$mode" == activate && -z "$release_id" ]] || usage
      mode=restore-legacy
      shift
      ;;
    *) usage ;;
  esac
done
if [[ "$mode" == activate ]]; then
  [[ "$release_id" =~ ^[0-9a-f]{64}$ ]] || usage
  [[ -z "$transaction_id" && \
     ("$expected_current" == none || "$expected_current" =~ ^[0-9a-f]{64}$) ]] || usage
elif [[ "$mode" == recover ]]; then
  [[ -z "$release_id" && -z "$expected_current" && -z "$transaction_id" && \
     "$allow_rollback" == 0 ]] || usage
elif [[ "$mode" == restore-legacy ]]; then
  [[ -z "$release_id" && "$expected_current" =~ ^[0-9a-f]{64}$ && \
     "$transaction_id" =~ ^[A-Za-z0-9._-]+$ && "$allow_rollback" == 0 ]] || usage
else
  [[ -z "$release_id" && -z "$expected_current" && -z "$transaction_id" && \
     "$allow_rollback" == 0 ]] || usage
fi

install -d -o root -g root -m 0755 /opt/creator-tracker "$release_parent"
install -d -o root -g root -m 0700 "$transaction_parent"
touch "$activation_lock"
chown root:root "$activation_lock"
chmod 0600 "$activation_lock"
exec {activation_fd}<>"$activation_lock"
/usr/bin/flock -n "$activation_fd" || fail 'another activation or recovery holds the global lock'

current_id() {
  if [[ ! -e "$selector" && ! -L "$selector" ]]; then
    printf '%s\n' none
    return
  fi
  [[ -L "$selector" && "$(stat -c '%u:%g' -- "$selector")" == 0:0 ]] || \
    fail 'current selector is not a root-owned symlink'
  local resolved
  resolved="$(readlink -f -- "$selector")"
  [[ "$resolved" =~ ^/opt/creator-tracker/releases/([0-9a-f]{64})$ ]] || \
    fail 'current selector does not resolve to a sealed release'
  printf '%s\n' "${BASH_REMATCH[1]}"
}

user_systemctl() {
  /usr/sbin/runuser -u "$owner_user" -- /usr/bin/env -i -- \
    HOME=/home/ark296 USER="$owner_user" LOGNAME="$owner_user" \
    PATH=/usr/bin:/bin XDG_RUNTIME_DIR=/run/user/$owner_uid \
    DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/$owner_uid/bus \
    /usr/bin/systemctl --user "$@"
}

activation_systemctl() {
  /usr/bin/systemctl "$@"
}

activation_user_systemctl() {
  user_systemctl "$@"
}

activation_unit_state() {
  local manager="$1"
  local unit="$2"
  case "$manager" in
    system) activation_systemctl is-active "$unit" 2>/dev/null || true ;;
    user) activation_user_systemctl is-active "$unit" 2>/dev/null || true ;;
    *) return 64 ;;
  esac
}

activation_unit_result() {
  local manager="$1"
  local unit="$2"
  case "$manager" in
    system)
      activation_systemctl show "$unit" --property=Result --value 2>/dev/null || true
      ;;
    user)
      activation_user_systemctl show "$unit" --property=Result --value 2>/dev/null || true
      ;;
    *) return 64 ;;
  esac
}

activation_state_is_busy() {
  case "$1" in
    active|activating|deactivating|reloading) return 0 ;;
    *) return 1 ;;
  esac
}

activation_state_should_restore() {
  case "$1" in
    active|activating|reloading) return 0 ;;
    *) return 1 ;;
  esac
}

activation_append_unique() {
  local array_name="$1"
  local unit="$2"
  local existing
  case "$array_name" in
    activation_restore_system_timers|activation_restore_user_timers|\
    activation_restore_system_workers|activation_restore_user_workers|\
    activation_observed_system_jobs|activation_observed_user_jobs) ;;
    *) return 64 ;;
  esac
  local -n target_array="$array_name"
  for existing in "${target_array[@]}"; do
    [[ "$existing" != "$unit" ]] || return 0
  done
  target_array+=("$unit")
}

activation_stop_unit() {
  local manager="$1"
  local unit="$2"
  case "$manager" in
    system) activation_systemctl stop "$unit" ;;
    user) activation_user_systemctl stop "$unit" ;;
    *) return 64 ;;
  esac
}

activation_start_unit() {
  local manager="$1"
  local unit="$2"
  case "$manager" in
    system) activation_systemctl start "$unit" ;;
    user) activation_user_systemctl start "$unit" ;;
    *) return 64 ;;
  esac
}

activation_sleep() {
  /bin/sleep "$1"
}

stop_activation_timers() {
  local manager unit state restore_array
  for manager in system user; do
    if [[ "$manager" == system ]]; then
      restore_array=activation_restore_system_timers
    else
      restore_array=activation_restore_user_timers
    fi
    for unit in "${activation_timer_units[@]}"; do
      state="$(activation_unit_state "$manager" "$unit")"
      if activation_state_should_restore "$state"; then
        activation_append_unique "$restore_array" "$unit"
      fi
      if activation_state_is_busy "$state"; then
        if ! activation_stop_unit "$manager" "$unit"; then
          printf 'creator-tracker activation: could not quiesce %s timer %s\n' \
            "$manager" "$unit" >&2
          return 1
        fi
      fi
      state="$(activation_unit_state "$manager" "$unit")"
      if activation_state_is_busy "$state"; then
        printf 'creator-tracker activation: %s timer remained %s after quiesce: %s\n' \
          "$manager" "$state" "$unit" >&2
        return 1
      fi
    done
  done
}

verify_activation_drained_job_results() {
  local manager array_name unit result
  for manager in system user; do
    if [[ "$manager" == system ]]; then
      array_name=activation_observed_system_jobs
    else
      array_name=activation_observed_user_jobs
    fi
    local -n observed_jobs="$array_name"
    for unit in "${observed_jobs[@]}"; do
      result="$(activation_unit_result "$manager" "$unit")"
      if [[ "$result" != success ]]; then
        printf 'creator-tracker activation: drained %s job did not finish safely (%s): %s\n' \
          "$manager" "${result:-unknown}" "$unit" >&2
        return 1
      fi
    done
  done
}

wait_for_activation_jobs_to_drain() {
  local timeout_seconds="$1"
  local poll_seconds="$2"
  local started_seconds manager unit state observed_array
  local -a busy_jobs=()
  [[ "$timeout_seconds" =~ ^[0-9]+$ && \
     "$poll_seconds" =~ ^[0-9]+([.][0-9]+)?$ ]] || return 64
  started_seconds=$SECONDS
  while true; do
    busy_jobs=()
    for manager in system user; do
      if [[ "$manager" == system ]]; then
        observed_array=activation_observed_system_jobs
      else
        observed_array=activation_observed_user_jobs
      fi
      for unit in "${activation_drain_service_units[@]}"; do
        state="$(activation_unit_state "$manager" "$unit")"
        if activation_state_is_busy "$state"; then
          busy_jobs+=("$manager:$unit:$state")
          activation_append_unique "$observed_array" "$unit"
        fi
      done
    done
    if ((${#busy_jobs[@]} == 0)); then
      verify_activation_drained_job_results
      return
    fi
    if ((SECONDS - started_seconds >= timeout_seconds)); then
      printf 'creator-tracker activation: timed out waiting for jobs to drain without termination: %s\n' \
        "${busy_jobs[*]}" >&2
      return 1
    fi
    activation_sleep "$poll_seconds"
  done
}

stop_activation_workers() {
  local manager unit state restore_array
  for manager in system user; do
    if [[ "$manager" == system ]]; then
      restore_array=activation_restore_system_workers
    else
      restore_array=activation_restore_user_workers
    fi
    for unit in "${activation_worker_units[@]}"; do
      state="$(activation_unit_state "$manager" "$unit")"
      if activation_state_should_restore "$state"; then
        activation_append_unique "$restore_array" "$unit"
      fi
      if activation_state_is_busy "$state"; then
        if ! activation_stop_unit "$manager" "$unit"; then
          printf 'creator-tracker activation: could not stop non-provider worker %s:%s\n' \
            "$manager" "$unit" >&2
          return 1
        fi
      fi
      state="$(activation_unit_state "$manager" "$unit")"
      if activation_state_is_busy "$state"; then
        printf 'creator-tracker activation: non-provider worker remained %s: %s:%s\n' \
          "$state" "$manager" "$unit" >&2
        return 1
      fi
    done
  done
}

restore_quiesced_runtime() {
  local manager unit failed
  ((activation_runtime_restore_required != 0)) || return 0
  failed=0
  for manager in system user; do
    local worker_array timer_array
    if [[ "$manager" == system ]]; then
      worker_array=activation_restore_system_workers
      timer_array=activation_restore_system_timers
    else
      worker_array=activation_restore_user_workers
      timer_array=activation_restore_user_timers
    fi
    local -n restore_workers="$worker_array"
    local -n restore_timers="$timer_array"
    for unit in "${restore_workers[@]}"; do
      if ! activation_start_unit "$manager" "$unit"; then
        printf 'creator-tracker activation: could not resume %s worker %s\n' \
          "$manager" "$unit" >&2
        failed=1
      fi
    done
    for unit in "${restore_timers[@]}"; do
      if ! activation_start_unit "$manager" "$unit"; then
        printf 'creator-tracker activation: could not resume %s timer %s\n' \
          "$manager" "$unit" >&2
        failed=1
      fi
    done
  done
  activation_runtime_restore_required=0
  ((failed == 0))
}

quiesce_runtime_for_activation() {
  local timeout_seconds="$1"
  local poll_seconds="$2"
  activation_restore_system_timers=()
  activation_restore_user_timers=()
  activation_restore_system_workers=()
  activation_restore_user_workers=()
  activation_observed_system_jobs=()
  activation_observed_user_jobs=()
  activation_runtime_restore_required=1
  stop_activation_timers || return
  wait_for_activation_jobs_to_drain "$timeout_seconds" "$poll_seconds" || return
  stop_activation_workers || return
}

durable_text() {
  "$durable_state" text "$1" 0600 0 0 "$2"
}

durable_unlink() {
  "$durable_state" unlink "$1"
}

activation_recovery_action() {
  local phase="$1" status="$2" current="$3" old="$4" new="$5"
  if [[ "$phase" == committed ]]; then
    [[ "$status" == committed || -z "$status" ]] || \
      fail 'committed activation phase conflicts with transaction status'
    [[ "$current" == "$new" ]] || \
      fail 'committed activation phase conflicts with the current selector'
    printf '%s\n' finalize-activation
    return
  fi
  [[ "$status" != committed ]] || \
    fail 'committed transaction status without a committed phase is ambiguous'
  case "$phase:$status" in
    prepared:|mutating:|rolling-back:|rolling-back:rolled-back)
      printf '%s\n' rollback-activation
      ;;
    rolled-back:rolled-back)
      [[ "$current" == "$old" ]] || \
        fail 'rolled-back activation phase conflicts with the current selector'
      printf '%s\n' finalize-rollback
      ;;
    *) fail 'activation transaction phase or status is invalid' ;;
  esac
}

legacy_restore_recovery_action() {
  local phase="$1" status="$2" current="$3" old="$4" new="$5"
  case "$phase:$status" in
    committed:committed|committed:legacy-restored)
      [[ "$current" == "$old" ]] || \
        fail 'committed legacy-restore phase conflicts with the current selector'
      printf '%s\n' finalize-restore
      ;;
    prepared:committed)
      [[ "$current" == "$new" ]] || \
        fail 'prepared legacy restoration conflicts with the current selector'
      printf '%s\n' preflight-restore
      ;;
    mutating:committed)
      [[ "$current" == "$new" || "$current" == "$old" ]] || \
        fail 'mutating legacy restoration conflicts with the current selector'
      printf '%s\n' resume-restore
      ;;
    *) fail 'legacy-restore transaction phase or status is invalid' ;;
  esac
}

assert_units_inactive() {
  local unit state
  for unit in "${managed_units[@]}"; do
    state="$(systemctl is-active "$unit" 2>/dev/null || true)"
    case "$state" in active|activating|deactivating|reloading)
      fail "stop system unit $unit before activation" ;;
    esac
    state="$(user_systemctl is-active "$unit" 2>/dev/null || true)"
    case "$state" in active|activating|deactivating|reloading)
      fail "stop legacy user unit $unit before activation" ;;
    esac
  done
}

assert_system_identity() {
  local name="$1" allowed_extra="${2:-}" entry primary_group groups expected_groups
  getent group "$name" >/dev/null || fail "service group is missing: $name"
  entry="$(getent passwd "$name")"
  [[ -n "$entry" ]] || fail "service identity is missing: $name"
  IFS=: read -r _ _ _ primary_group _ home shell <<<"$entry"
  [[ "$home" == /nonexistent && "$shell" == /usr/sbin/nologin ]] || \
    fail "service identity $name has an unsafe home or shell"
  [[ "$(getent group "$name" | cut -d: -f3)" == "$primary_group" ]] || \
    fail "service identity $name does not use its isolated primary group"
  groups="$(id -Gn "$name")"
  expected_groups="$name${allowed_extra:+ $allowed_extra}"
  [[ "$(tr ' ' '\n' <<<"$groups" | LC_ALL=C sort | tr '\n' ' ' | sed 's/ $//')" == \
     "$(tr ' ' '\n' <<<"$expected_groups" | LC_ALL=C sort | tr '\n' ' ' | sed 's/ $//')" ]] || \
    fail "service identity $name has unexpected supplemental groups: $groups"
}

ensure_system_identity() {
  local name="$1" allowed_extra="${2:-}"
  if ! getent group "$name" >/dev/null; then
    groupadd --system "$name"
  fi
  if ! getent passwd "$name" >/dev/null; then
    useradd --system --gid "$name" --home-dir /nonexistent --no-create-home \
      --shell /usr/sbin/nologin "$name"
  fi
  if [[ -n "$allowed_extra" ]]; then
    usermod --append --groups "$allowed_extra" "$name"
  fi
  assert_system_identity "$name" "$allowed_extra"
}

assert_existing_identities() {
  getent group creator-tracker-raw-evidence >/dev/null || \
    fail 'raw evidence reader group is missing'
  assert_system_identity creator-tracker-writer
  assert_system_identity creator-tracker-dashboard
  assert_system_identity creator-tracker-health
  assert_system_identity creator-tracker-raw-verifier creator-tracker-raw-evidence
}

prepare_identities_and_state() {
  local name job user
  if ! getent group creator-tracker-raw-evidence >/dev/null; then
    groupadd --system creator-tracker-raw-evidence
  fi
  for name in creator-tracker-writer creator-tracker-dashboard \
    creator-tracker-health; do
    ensure_system_identity "$name"
  done
  ensure_system_identity creator-tracker-raw-verifier creator-tracker-raw-evidence
  [[ "$(stat -c '%U:%G:%a' -- /var/lib)" == root:root:* && ! -L /var/lib ]] || \
    fail '/var/lib is not a root-controlled real directory'
  if [[ -e "$data_root" || -L "$data_root" ]]; then
    [[ -d "$data_root" && ! -L "$data_root" && \
       "$(stat -c '%U %G %a' -- "$data_root")" == 'root root 751' ]] || \
      fail 'creator tracker data root is not the fixed root-controlled directory'
  fi
  install -d -o root -g root -m 0751 "$data_root"
  if [[ -e "$data_dir" || -L "$data_dir" ]]; then
    [[ -d "$data_dir" && ! -L "$data_dir" && \
       "$(stat -c '%U:%G' -- "$data_dir")" == root:root ]] || \
      fail 'database state path is replaceable or service-owned'
  fi
  if [[ ! -e "$data_dir" && ! -L "$data_dir" ]]; then
    install -d -o root -g root -m 0700 "$data_dir"
  fi
  while IFS=: read -r job user; do
    install -d -o "$user" -g creator-tracker-health -m 2750 \
      "$data_dir/$job"
  done <<'EOF'
collector-worker:creator-tracker-dashboard
dashboard-health:creator-tracker-health
roster-refresh:creator-tracker-writer
scheduler-tick:creator-tracker-writer
instagram-discovery:creator-tracker-writer
instagram-scheduler:creator-tracker-writer
instagram-credit-rearm:creator-tracker-writer
provider-reconcile:creator-tracker-writer
canonical-delivery:creator-tracker-writer
migrate-database:creator-tracker-writer
raw-verifier:creator-tracker-raw-verifier
EOF
  install -d -o root -g creator-tracker-health -m 0750 \
    "$data_dir/cutover-completeness"
}

if [[ "$mode" == prepare-identities ]]; then
  [[ ! -e "$marker" && ! -L "$marker" ]] || \
    fail 'identity preparation is refused while activation recovery is pending'
  prepare_identities_and_state
  printf 'creator-tracker-writer uid=%s\n' "$(id -u creator-tracker-writer)"
  printf 'creator-tracker-dashboard uid=%s\n' "$(id -u creator-tracker-dashboard)"
  printf 'creator-tracker-health uid=%s\n' "$(id -u creator-tracker-health)"
  printf 'creator-tracker-raw-verifier uid=%s\n' "$(id -u creator-tracker-raw-verifier)"
  exit 0
fi

prepare_runtime_locks() {
  local job lock user_acl
  install -d -o root -g root -m 0755 /run/creator-tracker /run/creator-tracker/locks
  for job in "${jobs[@]}"; do
    lock="/run/creator-tracker/locks/$job.lock"
    if [[ ! -e "$lock" ]]; then install -o root -g root -m 0660 /dev/null "$lock"; fi
    [[ -f "$lock" && ! -L "$lock" ]] || fail "unsafe runtime lock: $lock"
    chown root:root "$lock"
    chmod 0660 "$lock"
    setfacl -b "$lock"
    case "$job" in
      collector-worker) user_acl='u:creator-tracker-dashboard:rw-' ;;
      dashboard-health) user_acl='u:creator-tracker-health:rw-' ;;
      raw-verifier) user_acl='u:creator-tracker-raw-verifier:rw-' ;;
      canonical-delivery|owned-tracker-writer)
        user_acl='u:creator-tracker-writer:rw-,u:creator-tracker-health:rw-'
        ;;
      provider-reconcile|migrate-database)
        user_acl='u:creator-tracker-writer:rw-'
        ;;
      *) user_acl='u:creator-tracker-writer:rw-' ;;
    esac
    setfacl -m "$user_acl",g::---,m::rw-,o::--- "$lock"
  done
  local shared_lock actual_acl expected_acl
  expected_acl="$(printf '%s\n' \
    'group::---' \
    'mask::rw-' \
    'other::---' \
    'user::rw-' \
    'user:creator-tracker-health:rw-' \
    'user:creator-tracker-writer:rw-' | LC_ALL=C sort)"
  for shared_lock in owned-tracker-writer canonical-delivery; do
    actual_acl="$(getfacl -cp -- "/run/creator-tracker/locks/$shared_lock.lock" | \
      sed '/^$/d' | LC_ALL=C sort)"
    [[ "$actual_acl" == "$expected_acl" ]] || \
      fail "shared health/writer lock ACL is not exact: $shared_lock"
  done
}

verify_release() {
  local candidate_id="$1"
  local candidate="$release_parent/$candidate_id"
  [[ -x "$candidate/bin/verify-release" ]] || fail 'installed release verifier is missing'
  "$candidate/bin/verify-release" --installed "$candidate" "$candidate_id"
}

assert_no_unit_overrides() {
  local unit base suffix path runtime_link
  for unit in "${unit_files[@]}"; do
    for base in /run/systemd/system /run/systemd/generator \
      /run/systemd/generator.early /run/systemd/generator.late \
      /etc/systemd/system /usr/local/lib/systemd/system /usr/lib/systemd/system; do
      for suffix in .d .wants .requires; do
        path="$base/$unit$suffix"
        [[ ! -e "$path" && ! -L "$path" ]] || \
          fail "unexpected system unit override or dependency directory: $path"
      done
    done
    for base in /run/systemd/system /run/systemd/generator \
      /run/systemd/generator.early /run/systemd/generator.late; do
      [[ ! -e "$base/$unit" && ! -L "$base/$unit" ]] || \
        fail "unexpected runtime unit definition or mask: $base/$unit"
      while IFS= read -r -d '' runtime_link; do
        fail "unexpected runtime unit dependency link: $runtime_link"
      done < <(find "$base" -mindepth 2 -maxdepth 2 \
        \( -path '*.wants/'"$unit" -o -path '*.requires/'"$unit" \) \
        -print0 2>/dev/null)
    done
  done
}

snapshot_legacy_user_units() {
  local transaction="$1"
  [[ -d "$user_unit_dir" && ! -L "$user_unit_dir" && \
     "$(stat -c '%u %a' -- "$user_unit_dir")" == "$owner_uid 700" ]] || \
    fail 'legacy user unit root must be an owner-only real directory'
  "$user_unit_state" snapshot "$user_unit_dir" \
    "$transaction/old-user-unit-files" "$transaction/user-unit-state.json" \
    "$owner_uid" "$owner_uid"
}

quarantine_legacy_user_units() {
  local transaction="$1"
  "$user_unit_state" remove "$user_unit_dir" \
    "$transaction/old-user-unit-files" "$transaction/user-unit-state.json" \
    "$owner_uid" "$owner_uid"
  user_systemctl daemon-reload
}

preflight_legacy_user_units() {
  local transaction="$1"
  "$user_unit_state" preflight "$user_unit_dir" \
    "$transaction/old-user-unit-files" "$transaction/user-unit-state.json" \
    "$owner_uid" "$owner_uid"
}

restore_legacy_user_units() {
  local transaction="$1"
  "$user_unit_state" restore "$user_unit_dir" \
    "$transaction/old-user-unit-files" "$transaction/user-unit-state.json" \
    "$owner_uid" "$owner_uid"
  user_systemctl daemon-reload
}

snapshot_units() {
  local transaction="$1"
  install -d -o root -g root -m 0700 "$transaction/old-units"
  "$system_state" snapshot "$system_unit_dir" \
    "$transaction/old-system-unit-files" "$transaction/system-unit-state.json"
  if [[ -e "$tmpfiles_target" || -L "$tmpfiles_target" ]]; then
    [[ -f "$tmpfiles_target" && ! -L "$tmpfiles_target" && \
       "$(stat -c '%u %g %h' -- "$tmpfiles_target")" == '0 0 1' ]] || \
      fail 'existing tracker tmpfiles definition is not a regular file'
    cp -a -- "$tmpfiles_target" "$transaction/old-units/creator-tracker.tmpfiles"
  fi
}

remove_system_unit_state() {
  local transaction="$1"
  "$system_state" remove "$system_unit_dir" \
    "$transaction/old-system-unit-files" "$transaction/system-unit-state.json"
}

preflight_system_units() {
  local transaction="$1"
  "$system_state" preflight "$system_unit_dir" \
    "$transaction/old-system-unit-files" "$transaction/system-unit-state.json"
}

restore_units() {
  local transaction="$1"
  "$system_state" restore "$system_unit_dir" \
    "$transaction/old-system-unit-files" "$transaction/system-unit-state.json"
  rm -f -- "$tmpfiles_target"
  if [[ -f "$transaction/old-units/creator-tracker.tmpfiles" ]]; then
    install -o root -g root -m 0644 "$transaction/old-units/creator-tracker.tmpfiles" \
      "$tmpfiles_target"
  fi
  systemctl daemon-reload
}

assert_installed_units() {
  local candidate_release="$1" unit fragment source dropins installed_exec expected_job markers enablement expected_proc_subset
  declare -A expected_jobs=(
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
  declare -A expected_users=(
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
  assert_no_unit_overrides
  for unit in "${unit_files[@]}"; do
    cmp -s -- "$candidate_release/systemd/$unit" "$system_unit_dir/$unit" || \
      fail "installed unit differs from sealed unit: $unit"
    [[ "$(stat -c '%u %g %a %h' -- "$system_unit_dir/$unit")" == '0 0 644 1' ]] || \
      fail "installed unit ownership or mode is unsafe: $unit"
    fragment="$(systemctl show "$unit" --property=FragmentPath --value)"
    source="$(systemctl show "$unit" --property=SourcePath --value)"
    dropins="$(systemctl show "$unit" --property=DropInPaths --value)"
    [[ "$fragment" == "$system_unit_dir/$unit" && -z "$source" && -z "$dropins" ]] || \
      fail "effective unit provenance is not exact: $unit"
    enablement="$(systemctl is-enabled "$unit" 2>/dev/null || true)"
    case "$enablement" in
      enabled|enabled-runtime|linked|linked-runtime|alias)
        fail "managed unit is enabled before the verified cutover gate: $unit"
        ;;
    esac
  done
  for unit in "${service_units[@]}"; do
    expected_job="${expected_jobs[$unit]}"
    expected_proc_subset=pid
    case "$unit" in
      creator-tracker-roster-refresh.service|creator-tracker-scheduler-tick.service)
        expected_proc_subset=all
        ;;
    esac
    installed_exec="$(systemctl show "$unit" --property=ExecStart --value)"
    markers="${installed_exec//[^\{]/}"
    [[ "$installed_exec" == *"argv[]=/bin/bash --noprofile --norc -p -- /opt/creator-tracker/current/bin/run-contained-job $expected_job ;"* &&
       "${#markers}" == 1 ]] || \
      fail "effective ExecStart is not the sealed role mapping: $unit"
    [[ "$(systemctl show "$unit" --property=User --value)" == "${expected_users[$unit]}" &&
       "$(systemctl show "$unit" --property=Group --value)" == "${expected_users[$unit]}" ]] || \
      fail "effective service identity is not role-isolated: $unit"
    for lifecycle in ExecStartPre ExecStartPost ExecReload ExecStop ExecStopPost; do
      [[ -z "$(systemctl show "$unit" --property="$lifecycle" --value)" ]] || \
        fail "unexpected effective $lifecycle command: $unit"
    done
    [[ "$(systemctl show "$unit" --property=ProtectProc --value)" == invisible &&
       "$(systemctl show "$unit" --property=ProcSubset --value)" == "$expected_proc_subset" &&
       "$(systemctl show "$unit" --property=RestrictNamespaces --value)" == yes &&
       "$(systemctl show "$unit" --property=NoNewPrivileges --value)" == yes ]] || \
      fail "effective process isolation is incomplete: $unit"
  done
}

acquire_job_locks() {
  local lock_file legacy_lock fd
  for job in "${jobs[@]}"; do
    lock_file="/run/creator-tracker/locks/$job.lock"
    [[ -f "$lock_file" && ! -L "$lock_file" ]] || fail "missing root runtime lock: $job"
    exec {fd}<>"$lock_file"
    /usr/bin/flock -n "$fd" || fail "job lock is busy: $job"
    lock_fds+=("$fd")
    legacy_lock="/run/user/$owner_uid/creator-tracker/locks/$job.lock"
    if [[ -f "$legacy_lock" && ! -L "$legacy_lock" ]]; then
      exec {fd}<>"$legacy_lock"
      /usr/bin/flock -n "$fd" || fail "legacy job lock is busy: $job"
      lock_fds+=("$fd")
    fi
  done
}

db_directory_acl() {
  cat <<'EOF'
user::rwx
user:creator-tracker-dashboard:r-x
user:creator-tracker-health:r-x
user:creator-tracker-raw-verifier:r-x
user:creator-tracker-writer:rwx
group::---
mask::rwx
other::---
default:user::rwx
default:user:creator-tracker-dashboard:r--
default:user:creator-tracker-health:r--
default:user:creator-tracker-raw-verifier:r--
default:user:creator-tracker-writer:rw-
default:group::---
default:mask::rwx
default:other::---

EOF
}

db_file_acl() {
  cat <<'EOF'
user::rw-
user:creator-tracker-dashboard:r--
user:creator-tracker-health:r--
user:creator-tracker-raw-verifier:r--
user:creator-tracker-writer:rw-
group::---
mask::rw-
other::---

EOF
}

assert_provider_imports_tree() {
  local path owner actual expected
  [[ -d "$provider_imports" && ! -L "$provider_imports" && \
     "$(readlink -f -- "$provider_imports")" == "$provider_imports" ]] || \
    fail 'provider imports path is not a canonical real directory'
  [[ "$(stat -c '%U:%G %a' -- "$provider_imports")" == 'root:root 770' ]] || \
    fail 'provider imports root is not root-controlled with mode 0770'
  expected=$'user::rwx\nuser:creator-tracker-writer:rwx\ngroup::---\nmask::rwx\nother::---'
  actual="$(getfacl -cp --absolute-names "$provider_imports")"
  [[ "$actual" == "$expected" ]] || fail 'provider imports root ACL inventory drifted'
  while IFS= read -r -d '' path; do
    [[ -f "$path" && ! -L "$path" && "$(stat -c '%h' -- "$path")" == 1 ]] || \
      fail "provider imports contains a nested or unsafe entry: $path"
    owner="$(stat -c '%U:%G %a' -- "$path")"
    [[ "$owner" == 'creator-tracker-writer:creator-tracker-writer 600' ]] || \
      fail "provider imports file provenance drifted: $path"
    [[ "$(getfacl -cp --absolute-names "$path")" == \
      $'user::rw-\ngroup::---\nother::---' ]] || \
      fail "provider imports ACL inventory drifted: $path"
  done < <(find "$provider_imports" -xdev -mindepth 1 -print0)
}

apply_provider_imports_acl() {
  local path
  if [[ ! -e "$provider_imports" && ! -L "$provider_imports" ]]; then
    install -d -o root -g root -m 0700 "$provider_imports"
    chmod 0770 "$provider_imports"
    setfacl -m u::rwx,u:creator-tracker-writer:rwx,g::---,m::rwx,o::--- \
      "$provider_imports"
  fi
  assert_provider_imports_tree
}

apply_database_acl() {
  local path
  chown root:root "$data_dir"
  chmod 0770 "$data_dir"
  setfacl -b -k "$data_dir"
  setfacl -m u::rwx,u:creator-tracker-dashboard:r-x,u:creator-tracker-health:r-x,\
u:creator-tracker-raw-verifier:r-x,u:creator-tracker-writer:rwx,\
g::---,m::rwx,o::--- "$data_dir"
  # SQLite copies the database's 0660 mode to WAL/SHM creation. File children
  # must inherit exact file permissions, without latent execute bits that are
  # merely hidden by the ACL mask. The directory's access ACL above retains
  # traversal, while its defaults deliberately use regular-file permissions.
  setfacl -d -m u::rwx,u:creator-tracker-dashboard:r--,u:creator-tracker-health:r--,\
u:creator-tracker-raw-verifier:r--,u:creator-tracker-writer:rw-,\
g::---,m::rwx,o::--- "$data_dir"
  for path in "$database" "$database-wal" "$database-shm"; do
    [[ -e "$path" ]] || continue
    [[ -f "$path" && ! -L "$path" ]] || fail "database path is not a regular file: $path"
    chown creator-tracker-writer:creator-tracker-writer "$path"
    chmod 0660 "$path"
    setfacl -b "$path"
    setfacl -m u::rw-,u:creator-tracker-dashboard:r--,u:creator-tracker-health:r--,\
u:creator-tracker-raw-verifier:r--,u:creator-tracker-writer:rw-,\
g::---,m::rw-,o::--- "$path"
  done
  apply_provider_imports_acl
}

assert_database_acl() {
  local path expected actual
  [[ "$(stat -c '%u %G %a' -- "$data_dir")" == '0 root 770' ]] || \
    fail 'database directory owner or ACL mode drifted'
  expected="$(db_directory_acl | LC_ALL=C sort)"
  actual="$(getfacl -cp --absolute-names "$data_dir" | LC_ALL=C sort)"
  [[ "$actual" == "$expected" ]] || fail 'database directory ACL inventory drifted'
  expected="$(db_file_acl | LC_ALL=C sort)"
  for path in "$database" "$database-wal" "$database-shm"; do
    [[ -e "$path" ]] || continue
    [[ -f "$path" && ! -L "$path" && "$(stat -c '%U %G %a %h' -- "$path")" == \
       'creator-tracker-writer creator-tracker-writer 660 1' ]] || \
      fail "database file mode/link count drifted: $path"
    actual="$(getfacl -cp --absolute-names "$path" | LC_ALL=C sort)"
    [[ "$actual" == "$expected" ]] || fail "database file ACL inventory drifted: $path"
  done
  [[ ! -e "$database-journal" && ! -L "$database-journal" ]] || \
    fail 'rollback-journal residue is forbidden for the sealed WAL database'
  assert_provider_imports_tree
}

assert_raw_evidence_tree() {
  local path
  [[ -d "$raw_evidence" && ! -L "$raw_evidence" && \
     "$(readlink -f -- "$raw_evidence")" == "$raw_evidence" ]] || \
    fail 'raw evidence source path is not canonical'
  while IFS= read -r -d '' path; do
    if [[ -d "$path" && ! -L "$path" ]]; then
      [[ "$(stat -c '%U %G %a' -- "$path")" == \
        'creator-tracker-writer creator-tracker-raw-evidence 2750' ]] || \
        fail "raw evidence directory provenance drifted: $path"
    else
      [[ -f "$path" && ! -L "$path" && "$(stat -c '%U %G %a %h' -- "$path")" == \
        'creator-tracker-writer creator-tracker-raw-evidence 640 1' ]] || \
        fail "raw evidence object provenance drifted: $path"
    fi
  done < <(find "$raw_evidence" -xdev -print0)
  [[ -d "$verified_raw_evidence" && ! -L "$verified_raw_evidence" && \
     "$(stat -c '%U %G %a' -- "$verified_raw_evidence")" == \
       'creator-tracker-raw-verifier creator-tracker-raw-verifier 700' ]] || \
    fail 'verified raw evidence archive is not verifier-private'
  while IFS= read -r -d '' path; do
    if [[ -d "$path" && ! -L "$path" ]]; then
      [[ "$(stat -c '%U %G %a' -- "$path")" == \
        'creator-tracker-raw-verifier creator-tracker-raw-verifier 700' ]] || \
        fail "verified archive directory provenance drifted: $path"
    else
      [[ -f "$path" && ! -L "$path" && "$(stat -c '%U %G %a %h' -- "$path")" == \
        'creator-tracker-raw-verifier creator-tracker-raw-verifier 600 1' ]] || \
        fail "verified archive object provenance drifted: $path"
    fi
  done < <(find "$verified_raw_evidence" -xdev -print0)
}

apply_raw_evidence_acl() {
  local path
  if [[ ! -e "$raw_evidence" && ! -L "$raw_evidence" ]]; then
    install -d -o creator-tracker-writer -g creator-tracker-raw-evidence -m 2750 \
      "$raw_evidence"
  fi
  if [[ ! -e "$verified_raw_evidence" && ! -L "$verified_raw_evidence" ]]; then
    install -d -o creator-tracker-raw-verifier -g creator-tracker-raw-verifier \
      -m 0700 "$verified_raw_evidence"
  fi
  for path in "$raw_evidence" "$verified_raw_evidence"; do
    [[ -d "$path" && ! -L "$path" ]] || fail "raw evidence root is unsafe: $path"
    if find "$path" -xdev ! -type d ! -type f -print -quit | grep -q . || \
       find "$path" -xdev -type f -links +1 -print -quit | grep -q .; then
      fail "raw evidence tree contains an unsafe entry: $path"
    fi
  done
  assert_raw_evidence_tree
}

snapshot_live_state() {
  local transaction="$1" backup_source path
  : >"$transaction/database.acl"
  getfacl -p --absolute-names "$data_dir" >>"$transaction/database.acl"
  if [[ -e "$database" || -L "$database" ]]; then
    assert_database_acl
    printf '%s\n' yes >"$transaction/old-database-present"
    backup_source="$database"
    # WAL/SHM are deliberately removed during rollback and recreated from the
    # directory's exact default ACL. Journal only persistent paths so ACL
    # restoration cannot fail on those correctly absent ephemeral sidecars.
    getfacl -p --absolute-names "$database" >>"$transaction/database.acl"
  else
    [[ -f "$legacy_database" && ! -L "$legacy_database" && \
       "$(stat -c '%u %a %h' -- "$legacy_database")" == "$owner_uid 600 1" ]] || \
      fail 'legacy database is not a fixed owner-only regular file for first migration'
    printf '%s\n' no >"$transaction/old-database-present"
    backup_source="$legacy_database"
  fi

  if [[ -d "$provider_imports" && ! -L "$provider_imports" ]]; then
    assert_provider_imports_tree
    printf '%s\n' yes >"$transaction/old-imports-present"
    cp -a -- "$provider_imports" "$transaction/old-provider-imports"
  elif [[ ! -e "$provider_imports" && ! -L "$provider_imports" ]]; then
    printf '%s\n' no >"$transaction/old-imports-present"
  else
    fail 'provider imports path is unsafe before activation'
  fi

  for path in "$raw_evidence" "$verified_raw_evidence"; do
    local marker_name acl_name
    if [[ "$path" == "$raw_evidence" ]]; then
      marker_name=old-raw-evidence-present
      acl_name=raw-evidence.acl
    else
      marker_name=old-verified-raw-evidence-present
      acl_name=verified-raw-evidence.acl
    fi
    if [[ -d "$path" && ! -L "$path" ]]; then
      if find "$path" -xdev ! -type d ! -type f -print -quit | grep -q . || \
         find "$path" -xdev -type f -links +1 -print -quit | grep -q .; then
        fail "raw evidence tree is unsafe before activation: $path"
      fi
      printf '%s\n' yes >"$transaction/$marker_name"
      getfacl -R -p --absolute-names "$path" >"$transaction/$acl_name"
    elif [[ ! -e "$path" && ! -L "$path" ]]; then
      printf '%s\n' no >"$transaction/$marker_name"
    else
      fail "raw evidence root is unsafe before activation: $path"
    fi
  done
  chmod 0600 "$transaction"/old-*-present "$transaction/database.acl"
  "$release/bin/activation-database" backup "$backup_source" \
    "$transaction/database.backup" "$transaction/database-backup.json"
  "$release/bin/activation-database" verify "$transaction/database.backup" ignored \
    "$transaction/database-backup.json"
}

materialize_database() {
  local transaction="$1" staged
  if [[ "$(<"$transaction/old-database-present")" == yes ]]; then
    return 0
  fi
  [[ ! -e "$database" && ! -L "$database" ]] || \
    fail 'live database appeared during first migration'
  staged="$data_dir/.creator-tracker-database.$(basename -- "$transaction")"
  cp --reflink=never -- "$transaction/database.backup" "$staged"
  cmp -s -- "$transaction/database.backup" "$staged" || \
    fail 'database migration copy does not match its verified backup'
  chown creator-tracker-writer:creator-tracker-writer "$staged"
  chmod 0600 "$staged"
  mv -T -- "$staged" "$database"
}

migrate_legacy_imports() {
  local transaction="$1" staging_parent staging path writer_uid writer_gid
  [[ "$(<"$transaction/old-imports-present")" == no ]] || return 0
  if [[ ! -e "$legacy_provider_imports" && ! -L "$legacy_provider_imports" ]]; then
    return 0
  fi
  [[ -d "$legacy_provider_imports" && ! -L "$legacy_provider_imports" && \
     "$(stat -c '%u %a' -- "$legacy_provider_imports")" == "$owner_uid 700" ]] || \
    fail 'legacy provider imports root is not a fixed owner-only directory'
  staging_parent="$data_root/migration-staging"
  install -d -o root -g root -m 0751 "$staging_parent"
  staging="$staging_parent/$(basename -- "$transaction")"
  install -d -o root -g root -m 0700 "$staging"
  writer_uid="$(id -u creator-tracker-writer)"
  writer_gid="$(id -g creator-tracker-writer)"
  /usr/bin/python3 -I "$release/bin/migrate-provider-imports" \
    "$legacy_provider_imports" "$staging" "$writer_uid" "$writer_gid"
  while IFS= read -r -d '' path; do
    if [[ "$path" == "$staging" ]]; then
      continue
    fi
    [[ "$(dirname -- "$path")" == "$staging" && -f "$path" && ! -L "$path" && \
       "$(stat -c '%h' -- "$path")" == 1 ]] || \
      fail "staged legacy import contains an unsafe entry: $path"
  done < <(find "$staging" -xdev -print0)
  chmod 0770 "$staging"
  setfacl -b -k "$staging"
  setfacl -m u::rwx,u:creator-tracker-writer:rwx,g::---,m::rwx,o::--- "$staging"
  find "$staging" -xdev -type f -exec chown creator-tracker-writer:creator-tracker-writer {} +
  find "$staging" -xdev -type f -exec chmod 0600 {} +
  find "$staging" -xdev -type f -exec setfacl -b {} +
  [[ ! -e "$provider_imports" && ! -L "$provider_imports" ]] || \
    fail 'provider imports target appeared during migration'
  mv -T -- "$staging" "$provider_imports"
}

verify_database_role_access() {
  local transaction="$1" probe unit ready stop reader reader_unit state attempts
  probe="/run/creator-tracker/database-probe-$(basename -- "$transaction")"
  install -d -o creator-tracker-writer -g creator-tracker-writer -m 0700 "$probe"
  ready="$probe/ready"
  stop="$probe/stop"
  unit="creator-tracker-wal-probe-${release_id:0:12}-$$"
  systemd-run --quiet --collect --unit="$unit" \
    --property=User=creator-tracker-writer --property=Group=creator-tracker-writer \
    --property=NoNewPrivileges=yes --property=CapabilityBoundingSet= \
    --property=AmbientCapabilities= --property=PrivateDevices=yes \
    --property=PrivateTmp=yes --property=PrivateIPC=yes \
    --property=PrivateMounts=yes --property=ProtectHome=tmpfs \
    --property=ProtectSystem=strict --property=ProtectProc=invisible \
    --property=ProcSubset=pid --property=RestrictNamespaces=yes \
    --property=RestrictAddressFamilies=AF_UNIX \
    --property="BindPaths=$data_dir $probe" \
    /usr/bin/python3 -I "$release/bin/probe-database-access" writer \
      "$database" "$ready" "$stop"
  attempts=0
  while [[ ! -f "$ready" && $attempts -lt 200 ]]; do
    state="$(systemctl is-active "$unit.service" 2>/dev/null || true)"
    [[ "$state" == active || "$state" == activating ]] || \
      fail 'writer WAL recreation probe stopped before its ready marker'
    sleep 0.05
    attempts=$((attempts + 1))
  done
  [[ -f "$ready" ]] || fail 'writer WAL recreation probe did not become ready'
  [[ -f "$database-wal" && -f "$database-shm" ]] || \
    fail 'writer probe did not recreate both WAL sidecars'
  assert_database_acl
  for reader in creator-tracker-dashboard creator-tracker-health \
    creator-tracker-raw-verifier; do
    reader_unit="creator-tracker-db-reader-${reader#creator-tracker-}-${release_id:0:8}-$$"
    systemd-run --quiet --wait --pipe --collect --unit="$reader_unit" \
      --property=User="$reader" --property=Group="$reader" \
      --property=NoNewPrivileges=yes --property=CapabilityBoundingSet= \
      --property=AmbientCapabilities= --property=PrivateDevices=yes \
      --property=PrivateTmp=yes --property=PrivateIPC=yes \
      --property=PrivateMounts=yes --property=ProtectHome=tmpfs \
      --property=ProtectSystem=strict --property=ProtectProc=invisible \
      --property=ProcSubset=pid --property=RestrictNamespaces=yes \
      --property=RestrictAddressFamilies=AF_UNIX \
      --property="BindReadOnlyPaths=$data_dir" \
      /usr/bin/python3 -I "$release/bin/probe-database-access" reader "$database"
  done
  install -o root -g root -m 0444 /dev/null "$stop"
  attempts=0
  while [[ "$(systemctl is-active "$unit.service" 2>/dev/null || true)" == active && \
           $attempts -lt 200 ]]; do
    sleep 0.05
    attempts=$((attempts + 1))
  done
  systemctl stop "$unit.service" >/dev/null 2>&1 || true
  rm -rf -- "$probe"
}

restore_database() {
  local transaction="$1" release_id_for_backup restore_tmp old_database_present
  local old_imports_present old_raw_present old_verified_raw_present
  release_id_for_backup="$(<"$transaction/new-release")"
  "$release_parent/$release_id_for_backup/bin/activation-database" \
    verify "$transaction/database.backup" ignored "$transaction/database-backup.json"
  rm -f -- "$database-wal" "$database-shm" "$database-journal"
  old_database_present="$(<"$transaction/old-database-present")"
  if [[ "$old_database_present" == yes ]]; then
    restore_tmp="$data_dir/.creator-tracker-restore.$(basename -- "$transaction")"
    cp --reflink=never -- "$transaction/database.backup" "$restore_tmp"
    chown creator-tracker-writer:creator-tracker-writer "$restore_tmp"
    chmod 0600 "$restore_tmp"
    mv -Tf -- "$restore_tmp" "$database"
  else
    rm -f -- "$database"
  fi
  old_imports_present="$(<"$transaction/old-imports-present")"
  rm -rf -- "$provider_imports"
  if [[ "$old_imports_present" == yes ]]; then
    cp -a -- "$transaction/old-provider-imports" "$provider_imports"
  fi
  old_raw_present="$(<"$transaction/old-raw-evidence-present")"
  old_verified_raw_present="$(<"$transaction/old-verified-raw-evidence-present")"
  if [[ "$old_raw_present" == no ]]; then
    rm -rf -- "$raw_evidence"
  elif [[ -f "$transaction/raw-evidence.acl" ]]; then
    setfacl --restore="$transaction/raw-evidence.acl"
  fi
  if [[ "$old_verified_raw_present" == no ]]; then
    rm -rf -- "$verified_raw_evidence"
  elif [[ -f "$transaction/verified-raw-evidence.acl" ]]; then
    setfacl --restore="$transaction/verified-raw-evidence.acl"
  fi
  if [[ -f "$transaction/database.acl" ]]; then
    setfacl --restore="$transaction/database.acl"
  fi
}

restore_config() {
  local transaction="$1" old_present stale_old stale_new
  old_present="$(<"$transaction/old-config-present")"
  stale_old="/etc/.creator-tracker.old.$(basename -- "$transaction")"
  stale_new="/etc/.creator-tracker.new.$(basename -- "$transaction")"
  rm -rf -- "$config_dir"
  if [[ "$old_present" == yes ]]; then
    cp -a -- "$transaction/old-config" "$config_dir"
  fi
  rm -rf -- "$stale_old" "$stale_new"
}

restore_selector() {
  local transaction="$1" old
  old="$(<"$transaction/old-current")"
  if [[ "$old" != none ]]; then
    "$durable_state" symlink "releases/$old" "$selector" 0 0
  else
    durable_unlink "$selector"
  fi
}

restore_history() {
  local transaction="$1"
  rm -f -- "$history"
  if [[ -f "$transaction/old-history" ]]; then
    install -o root -g root -m 0600 "$transaction/old-history" "$history"
  fi
}

rollback_transaction() {
  local transaction="$1"
  [[ "$transaction" =~ ^/opt/creator-tracker/activation-transactions/[A-Za-z0-9._-]+$ &&
     -d "$transaction" && ! -L "$transaction" && \
     "$(readlink -f -- "$transaction")" == "$transaction" && \
     "$(stat -c '%u %g %a' -- "$transaction")" == '0 0 700' ]] || \
    fail 'activation transaction is unsafe or missing'
  assert_units_inactive
  # Resolve every owner-controlled/user-unit and systemd-link destination
  # before changing the database, configuration, selector, or history. A
  # conflict therefore leaves the complete live tuple untouched.
  preflight_legacy_user_units "$transaction"
  preflight_system_units "$transaction"
  restore_database "$transaction"
  restore_config "$transaction"
  restore_units "$transaction"
  restore_selector "$transaction"
  restore_history "$transaction"
  restore_legacy_user_units "$transaction"
  printf 'creator-tracker activation rolled back transaction: %s\n' "$transaction"
}

assert_transaction_file() {
  local path="$1"
  [[ -f "$path" && ! -L "$path" && \
     "$(stat -c '%u %g %a %h' -- "$path")" == '0 0 600 1' ]] || \
    fail "activation transaction file is unsafe: $path"
}

restore_committed_first_cutover() {
  local transaction="$transaction_parent/$transaction_id" transaction_release operation_marker
  local transaction_file recorded_transaction recorded_operation recorded_old recorded_new
  [[ "$self_release_id" == "$expected_current" && \
     "$canonical_self" == "$release_parent/$expected_current/bin/activate-release" ]] || \
    fail 'legacy restoration must run from the expected current sealed release'
  [[ ! -e "$marker" && ! -L "$marker" ]] || \
    fail 'an interrupted operation requires --recover before legacy restoration'
  [[ -d "$transaction" && ! -L "$transaction" && \
     "$(readlink -f -- "$transaction")" == "$transaction" && \
     "$(stat -c '%u %g %a' -- "$transaction")" == '0 0 700' ]] || \
    fail 'committed activation transaction is unsafe or missing'
  for transaction_file in old-current new-release status phase legacy-restore-boundary.json marker; do
    assert_transaction_file "$transaction/$transaction_file"
  done
  [[ "$(<"$transaction/old-current")" == none ]] || \
    fail 'legacy restoration is available only for the first sealed cutover'
  transaction_release="$(<"$transaction/new-release")"
  [[ "$transaction_release" == "$expected_current" && \
     "$(<"$transaction/status")" == committed && \
     "$(<"$transaction/phase")" == committed ]] || \
    fail 'committed activation transaction does not match expected-current'
  recorded_transaction="$(awk -F= '$1 == "transaction" { print $2; exit }' "$transaction/marker")"
  recorded_operation="$(awk -F= '$1 == "operation" { print $2; exit }' "$transaction/marker")"
  recorded_old="$(awk -F= '$1 == "old_release" { print $2; exit }' "$transaction/marker")"
  recorded_new="$(awk -F= '$1 == "new_release" { print $2; exit }' "$transaction/marker")"
  [[ "$recorded_transaction" == "$transaction" && "$recorded_operation" == activate && \
     "$recorded_old" == none && "$recorded_new" == "$expected_current" ]] || \
    fail 'committed activation marker does not bind the requested first-cutover transaction'
  [[ "$(current_id)" == "$expected_current" ]] || \
    fail 'expected-current CAS check failed before legacy restoration'

  verify_release "$expected_current"
  assert_units_inactive
  assert_no_unit_overrides
  # The committed-boundary check must run before anything touches a bounded
  # /var/lib tree. Identity creation/state normalization belongs to activation,
  # never to post-commit restoration preflight.
  assert_existing_identities
  prepare_runtime_locks
  declare -ga lock_fds=()
  acquire_job_locks
  assert_units_inactive
  [[ "$(current_id)" == "$expected_current" ]] || \
    fail 'expected-current CAS changed while fencing legacy restoration'
  assert_installed_units "$release_parent/$expected_current"
  assert_database_acl
  assert_raw_evidence_tree
  "$release_parent/$expected_current/bin/activation-boundary" verify \
    "$transaction/legacy-restore-boundary.json"

  operation_marker="$transaction/legacy-restore.marker"
  {
    printf 'format_version=1\n'
    printf 'operation=restore-legacy\n'
    printf 'transaction=%s\n' "$transaction"
    printf 'old_release=none\n'
    printf 'new_release=%s\n' "$expected_current"
  } | "$durable_state" payload "$operation_marker" 0600 0 0
  durable_text "$transaction/restore-phase" prepared
  "$durable_state" fsync-tree "$transaction"
  "$durable_state" copy "$operation_marker" "$marker" 0600 0 0
  durable_text "$transaction/restore-phase" mutating

  rollback_transaction "$transaction"
  /bin/sync
  durable_text "$transaction/restore-phase" committed
  durable_text "$transaction/status" legacy-restored
  durable_unlink "$marker"
  [[ "$(current_id)" == none ]] || fail 'legacy restoration did not remove the sealed selector'
  printf 'creator-tracker first cutover restored legacy transaction: %s\n' "$transaction"
  printf '%s\n' 'Legacy user units were restored but not restarted.'
}

if [[ "$mode" == restore-legacy ]]; then
  restore_committed_first_cutover
  exit 0
fi

if [[ "$mode" == recover ]]; then
  [[ -f "$marker" && ! -L "$marker" && "$(stat -c '%u %a %h' -- "$marker")" == '0 600 1' ]] || \
    fail 'no valid activation marker is available for recovery'
  transaction="$(awk -F= '$1 == "transaction" { print $2; exit }' "$marker")"
  marker_operation="$(awk -F= '$1 == "operation" { print $2; exit }' "$marker")"
  [[ "$marker_operation" == activate || "$marker_operation" == restore-legacy ]] || \
    fail 'activation marker operation is invalid'
  [[ "$transaction" =~ ^/opt/creator-tracker/activation-transactions/[A-Za-z0-9._-]+$ && \
     -d "$transaction" && ! -L "$transaction" && \
     "$(readlink -f -- "$transaction")" == "$transaction" && \
     "$(stat -c '%u %g %a' -- "$transaction")" == '0 0 700' ]] || \
    fail 'activation recovery transaction is unsafe or missing'
  for transaction_file in old-current new-release marker phase; do
    assert_transaction_file "$transaction/$transaction_file"
  done
  recorded_old="$(<"$transaction/old-current")"
  recorded_new="$(<"$transaction/new-release")"
  [[ "$recorded_old" == none || "$recorded_old" =~ ^[0-9a-f]{64}$ ]] || \
    fail 'activation recovery old release is invalid'
  [[ "$recorded_new" =~ ^[0-9a-f]{64}$ ]] || \
    fail 'activation recovery new release is invalid'
  [[ "$self_release_id" == "$recorded_new" && \
     "$canonical_self" == "$release_parent/$recorded_new/bin/activate-release" ]] || \
    fail 'activation recovery must use the transaction candidate release'
  verify_release "$recorded_new"

  if [[ "$marker_operation" == activate ]]; then
    cmp -s -- "$transaction/marker" "$marker" || \
      fail 'global activation marker does not match its durable transaction marker'
    phase="$(<"$transaction/phase")"
    status=''
    [[ ! -e "$transaction/status" ]] || {
      assert_transaction_file "$transaction/status"
      status="$(<"$transaction/status")"
    }
    recovery_action="$(activation_recovery_action \
      "$phase" "$status" "$(current_id)" "$recorded_old" "$recorded_new")"
    case "$recovery_action" in
      finalize-activation)
        if [[ "$recorded_old" == none ]]; then
          assert_transaction_file "$transaction/legacy-restore-boundary.json"
        fi
        durable_text "$transaction/status" committed
        durable_unlink "$marker"
        printf 'creator-tracker activation recovery: transaction was already durably committed: %s\n' \
          "$transaction"
        exit 0
        ;;
      rollback-activation)
        prepare_identities_and_state
        prepare_runtime_locks
        declare -a lock_fds=()
        acquire_job_locks
        durable_text "$transaction/phase" rolling-back
        rollback_transaction "$transaction"
        /bin/sync
        durable_text "$transaction/status" rolled-back
        durable_text "$transaction/phase" rolled-back
        ;;
      finalize-rollback) ;;
      *) fail 'activation recovery decision is invalid' ;;
    esac
  else
    assert_transaction_file "$transaction/legacy-restore.marker"
    cmp -s -- "$transaction/legacy-restore.marker" "$marker" || \
      fail 'global legacy-restore marker does not match its durable transaction marker'
    assert_transaction_file "$transaction/restore-phase"
    restore_phase="$(<"$transaction/restore-phase")"
    assert_transaction_file "$transaction/status"
    restore_status="$(<"$transaction/status")"
    restore_action="$(legacy_restore_recovery_action \
      "$restore_phase" "$restore_status" "$(current_id)" \
      "$recorded_old" "$recorded_new")"
    case "$restore_action" in
      finalize-restore)
        durable_text "$transaction/status" legacy-restored
        durable_unlink "$marker"
        printf 'creator-tracker activation recovery: legacy restoration was already durably committed: %s\n' \
          "$transaction"
        exit 0
        ;;
      preflight-restore|resume-restore)
        assert_existing_identities
        prepare_runtime_locks
        declare -a lock_fds=()
        acquire_job_locks
        if [[ "$restore_action" == preflight-restore ]]; then
          assert_units_inactive
          assert_installed_units "$release_parent/$recorded_new"
          assert_database_acl
          assert_raw_evidence_tree
          "$release_parent/$recorded_new/bin/activation-boundary" verify \
            "$transaction/legacy-restore-boundary.json"
        fi
        durable_text "$transaction/restore-phase" mutating
        rollback_transaction "$transaction"
        /bin/sync
        durable_text "$transaction/restore-phase" committed
        durable_text "$transaction/status" legacy-restored
        ;;
      *) fail 'legacy restoration recovery decision is invalid' ;;
    esac
  fi
  durable_unlink "$marker"
  exit 0
fi

[[ ! -e "$marker" && ! -L "$marker" ]] || fail 'an interrupted activation requires --recover'
readonly release="$release_parent/$release_id"
[[ "$canonical_self" == "$release/bin/activate-release" ]] || \
  fail 'the activator must be executed from the candidate release'
verify_release "$release_id"
assert_no_unit_overrides
old_current="$(current_id)"
[[ "$old_current" == "$expected_current" ]] || fail 'expected-current CAS check failed before staging'
if [[ "$old_current" != none && "$old_current" != "$release_id" ]]; then
  old_commit="$(<"$release_parent/$old_current/APP_COMMIT")"
  new_commit="$(<"$release/APP_COMMIT")"
  if ! /usr/bin/env -i -- PATH=/usr/bin:/bin LANG=C.UTF-8 LC_ALL=C.UTF-8 \
      /usr/bin/git -c safe.directory="$app_repo" -C "$app_repo" --no-replace-objects \
      merge-base --is-ancestor "$old_commit" "$new_commit"; then
    ((allow_rollback != 0)) || fail 'candidate app commit is not a descendant; use --allow-rollback explicitly'
  fi
fi
if [[ -f "$history" && "$release_id" != "$old_current" ]] && \
   awk -v candidate="$release_id" 'NF == 4 && $3 == candidate { found = 1 } END { exit !found }' \
     "$history"; then
  ((allow_rollback != 0)) || fail 'previously activated release requires --allow-rollback'
fi

for command in setfacl getfacl systemd-tmpfiles systemd-run systemctl systemd-analyze git; do
  command -v "$command" >/dev/null || fail "required activation command is unavailable: $command"
done

transaction=''
activation_complete=0
on_exit() {
  local code=$?
  local rollback_safe=1
  trap - EXIT
  if ((code != 0 && activation_complete == 0)); then
    if [[ -n "$transaction" && -f "$marker" && ! -L "$marker" ]]; then
      printf '%s\n' 'creator-tracker activation: failure detected; restoring the old tuple' >&2
      durable_text "$transaction/phase" rolling-back
      if ! rollback_transaction "$transaction"; then
        printf '%s\n' 'creator-tracker activation: automatic rollback failed; marker retained for --recover' >&2
        rollback_safe=0
      else
        /bin/sync
        durable_text "$transaction/status" rolled-back
        durable_text "$transaction/phase" rolled-back
        durable_unlink "$marker"
      fi
    fi
    if ((rollback_safe != 0)) && ! restore_quiesced_runtime; then
      printf '%s\n' 'creator-tracker activation: failed to restore one or more pre-activation runtime units' >&2
    fi
  fi
  exit "$code"
}
trap on_exit EXIT

quiesce_runtime_for_activation \
  "$activation_drain_timeout_seconds" "$activation_drain_poll_seconds" || \
  fail 'could not drain active tracker jobs safely; activation made no persistent tuple change'
prepare_identities_and_state
prepare_runtime_locks
declare -a lock_fds=()
acquire_job_locks
assert_units_inactive

[[ "$(current_id)" == "$old_current" && "$old_current" == "$expected_current" ]] || \
  fail 'expected-current CAS changed while acquiring fences'
if [[ "$old_current" != none ]]; then
  "$release/bin/activation-database" assert-provider-lease-settled \
    "$database" ignored ignored
fi

transaction="$transaction_parent/$(date -u +%Y%m%dT%H%M%SZ)-$release_id-$$"
mkdir -m 0700 -- "$transaction" || fail 'activation transaction ID already exists'
chown root:root "$transaction"
printf '%s\n' "$old_current" >"$transaction/old-current"
printf '%s\n' "$release_id" >"$transaction/new-release"
chmod 0600 "$transaction/old-current" "$transaction/new-release"
if [[ -f "$history" ]]; then cp -a -- "$history" "$transaction/old-history"; fi
snapshot_units "$transaction"
snapshot_legacy_user_units "$transaction"
if [[ -d "$config_dir" && ! -L "$config_dir" ]]; then
  printf '%s\n' yes >"$transaction/old-config-present"
  cp -a -- "$config_dir" "$transaction/old-config"
elif [[ ! -e "$config_dir" && ! -L "$config_dir" ]]; then
  printf '%s\n' no >"$transaction/old-config-present"
else
  fail 'existing creator-tracker configuration path is unsafe'
fi
chmod 0600 "$transaction/old-config-present"
snapshot_live_state "$transaction"

/usr/bin/env -i -- PATH=/usr/bin:/bin LANG=C.UTF-8 LC_ALL=C.UTF-8 \
  /usr/bin/python3 -I "$release/bin/render-config" \
  "$owner_env" "$provider_env" "$host_env" "$canonical_env" \
  "$raw_verifier_env" \
  "$transaction/new-config"
systemd-analyze verify "${unit_files[@]/#/$release/systemd/}"

{
  printf 'format_version=1\n'
  printf 'operation=activate\n'
  printf 'transaction=%s\n' "$transaction"
  printf 'old_release=%s\n' "$old_current"
  printf 'new_release=%s\n' "$release_id"
} | "$durable_state" payload "$transaction/marker" 0600 0 0
durable_text "$transaction/phase" prepared
# No live path has changed yet. Make the complete rollback tuple and phase
# durable before publishing the global crash-recovery marker.
"$durable_state" fsync-tree "$transaction"
"$durable_state" copy "$transaction/marker" "$marker" 0600 0 0
durable_text "$transaction/phase" mutating

quarantine_legacy_user_units "$transaction"
remove_system_unit_state "$transaction"
materialize_database "$transaction"
migrate_legacy_imports "$transaction"
apply_database_acl
assert_database_acl
apply_raw_evidence_acl
assert_raw_evidence_tree

config_stage="/etc/.creator-tracker.new.$(basename -- "$transaction")"
config_old="/etc/.creator-tracker.old.$(basename -- "$transaction")"
rm -rf -- "$config_stage" "$config_old"
cp -a -- "$transaction/new-config" "$config_stage"
chown -hR root:root "$config_stage"
if [[ -d "$config_dir" ]]; then mv -T -- "$config_dir" "$config_old"; fi
mv -T -- "$config_stage" "$config_dir"

for unit in "${unit_files[@]}"; do
  install -o root -g root -m 0644 "$release/systemd/$unit" "$system_unit_dir/$unit"
done
install -o root -g root -m 0644 "$release/tmpfiles.d/creator-tracker.conf" "$tmpfiles_target"
systemctl daemon-reload
assert_installed_units "$release"
assert_units_inactive

migration_unit="creator-tracker-migrate-${release_id:0:16}-$$"
systemd-run --quiet --wait --pipe --collect --unit="$migration_unit" \
  --property=User=creator-tracker-writer --property=Group=creator-tracker-writer \
  --property="WorkingDirectory=$release/app" \
  --property=Environment=PATH=/usr/bin:/bin \
  --property=UnsetEnvironment='LD_PRELOAD LD_LIBRARY_PATH LD_AUDIT BASH_ENV ENV SHELLOPTS BASHOPTS NODE_OPTIONS NODE_PATH' \
  --property="LoadCredential=role-env:$config_dir/credentials/migrate-database.env" \
  --property=NoNewPrivileges=yes --property=CapabilityBoundingSet= \
  --property=AmbientCapabilities= --property=PrivateDevices=yes \
  --property=PrivateTmp=yes --property=PrivateIPC=yes \
  --property=PrivateMounts=yes --property=ProtectHome=tmpfs \
  --property=ProtectSystem=strict --property=ProtectProc=invisible \
  --property=ProcSubset=pid --property=RestrictNamespaces=yes \
  --property=RestrictAddressFamilies=AF_UNIX \
  --property="BindPaths=$data_dir" \
  --property=BindPaths=/run/creator-tracker/locks \
  --property=InaccessiblePaths="$provider_imports $raw_evidence $verified_raw_evidence" \
  -- \
  "$release/bin/migrate-database"
assert_database_acl
verify_database_role_access "$transaction"
assert_raw_evidence_tree

[[ "$(current_id)" == "$expected_current" ]] || fail 'expected-current CAS changed before selector mutation'
"$durable_state" symlink "releases/$release_id" "$selector" 0 0

verify_release "$release_id"
assert_installed_units "$release"
assert_database_acl
assert_units_inactive
printf '%s\t%s\t%s\t%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  "$old_current" "$release_id" "$([[ "$allow_rollback" == 1 ]] && printf rollback || printf forward)" \
  >>"$history"
chown root:root "$history"
chmod 0600 "$history"
sync -f "$history" 2>/dev/null || sync
rm -rf -- "$config_old"
if [[ "$old_current" == none ]]; then
  "$release/bin/activation-boundary" record \
    "$transaction/legacy-restore-boundary.json"
fi
# All database, configuration, systemd, selector, history, legacy-unit, and
# evidence mutations precede the authoritative phase transition. Flush every
# affected filesystem before committing, then fsync the transaction records
# and marker parent in order.
/bin/sync
durable_text "$transaction/phase" committed
durable_text "$transaction/status" committed
durable_unlink "$marker"
activation_runtime_restore_required=0
activation_complete=1
trap - EXIT

printf 'creator-tracker release activated for future starts: %s app_commit=%s\n' \
  "$release_id" "$(<"$release/APP_COMMIT")"
if [[ "$old_current" == none ]]; then
  printf 'creator-tracker first-cutover restore transaction: %s\n' \
    "$(basename -- "$transaction")"
fi
printf '%s\n' 'Services were not restarted and timers were not enabled.'
