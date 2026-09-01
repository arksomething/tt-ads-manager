#!/bin/bash -p
set -euo pipefail

export PATH='/usr/sbin:/usr/bin:/sbin:/bin'
unset NODE_OPTIONS NODE_PATH LD_PRELOAD LD_LIBRARY_PATH LD_AUDIT BASH_ENV ENV || true

fail() {
  printf 'creator-tracker cutover completeness: %s\n' "$*" >&2
  exit 1
}

usage() {
  printf '%s\n' \
    'usage: run-cutover-completeness' >&2
  exit 64
}

canonical_self="$(readlink -f -- "${BASH_SOURCE[0]}")"
[[ "$canonical_self" =~ ^/opt/creator-tracker/releases/[0-9a-f]{64}/bin/run-cutover-completeness$ ]] || \
  fail 'runner must execute from a sealed versioned release'
release="${canonical_self%/bin/run-cutover-completeness}"
release_id="${release##*/}"
read -r self_uid self_gid self_mode self_links < <(stat -c '%u %g %a %h' -- "$canonical_self")
[[ "$self_uid" == 0 && "$self_gid" == 0 && "$self_links" == 1 && \
   $((8#$self_mode & 8#022)) == 0 ]] || fail 'runner is not root-controlled'

(($# == 0)) || usage

if ((EUID != 0)); then
  exec sudo -n /usr/bin/env -i -- PATH=/usr/sbin:/usr/bin:/sbin:/bin \
    LANG=C.UTF-8 LC_ALL=C.UTF-8 \
    /bin/bash --noprofile --norc -p -- "$canonical_self"
fi

readonly selector='/opt/creator-tracker/current'
readonly activation_marker='/opt/creator-tracker/ACTIVATION_IN_PROGRESS'
readonly activation_lock='/opt/creator-tracker/activation.lock'
readonly lock_dir='/run/creator-tracker/locks'
readonly writer_lock="$lock_dir/owned-tracker-writer.lock"
readonly delivery_lock="$lock_dir/canonical-delivery.lock"
readonly verifier_lock="$lock_dir/raw-verifier.lock"
readonly credential_dir='/etc/creator-tracker/credentials'
readonly cutover_credential="$credential_dir/cutover-verify.env"
readonly delivery_credential="$credential_dir/canonical-delivery.env"
readonly verifier_credential="$credential_dir/raw-verifier.env"
readonly state_dir='/var/lib/creator-tracker/state'
readonly delivery_state="$state_dir/canonical-delivery"
readonly verifier_state="$state_dir/raw-verifier"
readonly source_cas='/var/lib/creator-tracker/raw-evidence-v1'
readonly archive_cas='/var/lib/creator-tracker/verified-raw-evidence-v1'
readonly cutover_state="$state_dir/cutover-completeness"
readonly result_validator="$release/bin/validate-cutover-result"
readonly max_runtime_seconds=3600

[[ -L "$selector" && "$(readlink -f -- "$selector")" == "$release" ]] || \
  fail 'runner release is not the current sealed release'
[[ ! -e "$activation_marker" ]] || \
  fail 'activation recovery must complete before cutover verification'
"$release/bin/verify-release" --installed "$release" "$release_id" >/dev/null || \
  fail 'current release failed its sealed inventory verification'

assert_private_credential() {
  local path="$1"
  [[ ! -L "$path" && -f "$path" && \
     "$(stat -c '%u %g %a %h' -- "$path")" == '0 0 400 1' ]] || \
    fail "credential is missing or unsafe: $path"
}
assert_lock() {
  local path="$1"
  [[ ! -L "$path" && -f "$path" && \
     "$(stat -c '%u %g %a %h' -- "$path")" == '0 0 660 1' ]] || \
    fail "runtime lock is missing or unsafe: $path"
}
assert_private_credential "$cutover_credential"
assert_private_credential "$delivery_credential"
assert_private_credential "$verifier_credential"
for lock_path in "$writer_lock" "$delivery_lock" "$verifier_lock"; do
  assert_lock "$lock_path"
done
[[ ! -L "$activation_lock" && -f "$activation_lock" && \
   "$(stat -c '%u %g %a %h' -- "$activation_lock")" == '0 0 600 1' ]] || \
  fail 'activation lock is missing or unsafe'
[[ ! -L "$cutover_state" && -d "$cutover_state" && \
   "$(stat -c '%U %G %a' -- "$cutover_state")" == \
     'root creator-tracker-health 750' ]] || \
  fail 'cutover state directory is missing or unsafe'
[[ ! -L "$delivery_state" && -d "$delivery_state" && \
   "$(stat -c '%U %G %a' -- "$delivery_state")" == \
     'creator-tracker-writer creator-tracker-health 2750' ]] || \
  fail 'canonical delivery state directory is missing or unsafe'
[[ ! -L "$verifier_state" && -d "$verifier_state" && \
   "$(stat -c '%U %G %a' -- "$verifier_state")" == \
     'creator-tracker-raw-verifier creator-tracker-health 2750' ]] || \
  fail 'raw verifier state directory is missing or unsafe'
[[ ! -L "$source_cas" && -d "$source_cas" && \
   "$(stat -c '%U %G %a' -- "$source_cas")" == \
     'creator-tracker-writer creator-tracker-raw-evidence 2750' ]] || \
  fail 'source evidence CAS is missing or unsafe'
[[ ! -L "$archive_cas" && -d "$archive_cas" && \
   "$(stat -c '%U %G %a' -- "$archive_cas")" == \
     'creator-tracker-raw-verifier creator-tracker-raw-verifier 700' ]] || \
  fail 'verified evidence archive is missing or unsafe'
[[ ! -L "$result_validator" && -f "$result_validator" && -x "$result_validator" && \
   "$(stat -c '%u %g %h' -- "$result_validator")" == '0 0 1' ]] || \
  fail 'trusted cutover result validator is missing or unsafe'

readonly -a managed_units=(
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
)
for unit in "${managed_units[@]}"; do
  ! systemctl is-active --quiet "$unit" || \
    fail "persistent managed unit must be inactive during the cutover gate: $unit"
  enablement="$(systemctl is-enabled "$unit" 2>/dev/null || true)"
  case "$enablement" in
    enabled|enabled-runtime|linked|linked-runtime|alias)
      fail "persistent managed unit must not be enabled before the cutover gate: $unit"
      ;;
  esac
done
unset enablement unit

# This one-time gate freezes provider projection while it drains the already
# recorded outbox and verifier queue. Steady-state canonical delivery does not
# take the global writer flock and therefore never holds it across HTTPS.
exec {activation_fd}<>"$activation_lock"
/usr/bin/flock -n "$activation_fd" || fail 'an activation operation is already running'
exec {writer_fd}<>"$writer_lock"
/usr/bin/flock -n "$writer_fd" || fail 'a database writer is already running'
exec {delivery_fd}<>"$delivery_lock"
/usr/bin/flock -n "$delivery_fd" || fail 'canonical delivery is already running'
exec {verifier_fd}<>"$verifier_lock"
/usr/bin/flock -n "$verifier_fd" || fail 'raw evidence verifier is already running'

umask 077
scratch="$(mktemp -d /run/creator-tracker/cutover-gate.XXXXXX)"
completed=0
started_epoch="$(date +%s)"
cleanup() {
  exit_code=$?
  if [[ -n "${scratch:-}" && -d "$scratch" ]]; then
    rm -f -- "$scratch/result.json" "$scratch/parsed" "$scratch/marker"
    rmdir -- "$scratch" 2>/dev/null || true
  fi
  if ((completed == 0)); then
    failure_tmp="$(mktemp "$cutover_state/.failure.XXXXXX")"
    {
      printf 'format_version=1\n'
      printf 'status=failed\n'
      printf 'failed_at_epoch=%s\n' "$(date +%s)"
      printf 'exit_code=%s\n' "$exit_code"
    } >"$failure_tmp"
    chown root:creator-tracker-health "$failure_tmp"
    chmod 0440 "$failure_tmp"
    mv -fT -- "$failure_tmp" "$cutover_state/failure"
  fi
  exit "$exit_code"
}
trap cleanup EXIT

for stale in success result.json failure; do
  stale_path="$cutover_state/$stale"
  if [[ -e "$stale_path" || -L "$stale_path" ]]; then
    [[ ! -L "$stale_path" && -f "$stale_path" && \
       "$(stat -c '%u %h' -- "$stale_path")" == '0 1' ]] || \
      fail "unsafe prior cutover marker: $stale_path"
    unlink -- "$stale_path"
  fi
done
in_progress_tmp="$(mktemp "$cutover_state/.in-progress.XXXXXX")"
{
  printf 'format_version=1\n'
  printf 'status=running\n'
  printf 'release_id=%s\n' "$release_id"
  printf 'started_at_epoch=%s\n' "$started_epoch"
} >"$in_progress_tmp"
chown root:creator-tracker-health "$in_progress_tmp"
chmod 0440 "$in_progress_tmp"
mv -fT -- "$in_progress_tmp" "$cutover_state/in-progress"

readonly unset_environment='LD_PRELOAD LD_LIBRARY_PATH LD_AUDIT BASH_ENV ENV SHELLOPTS BASHOPTS BASH_LOADABLES_PATH NODE_OPTIONS NODE_PATH PYTHONPATH PYTHONHOME PYTHONSTARTUP PERL5OPT PERL5LIB RUBYOPT RUBYLIB GCONV_PATH TSX_TSCONFIG_PATH'
readonly -a common_properties=(
  --property=Type=oneshot
  --property="WorkingDirectory=$release/app"
  --property=Environment=PATH=/usr/bin:/bin
  --property="UnsetEnvironment=$unset_environment"
  --property=UMask=0027
  --property=NoNewPrivileges=yes
  --property=CapabilityBoundingSet=
  --property=AmbientCapabilities=
  --property=PrivateDevices=yes
  --property=PrivateTmp=yes
  --property=PrivateIPC=yes
  --property=PrivateMounts=yes
  --property=ProtectHome=tmpfs
  --property=ProtectClock=yes
  --property=ProtectControlGroups=yes
  --property=ProtectHostname=yes
  --property=ProtectKernelLogs=yes
  --property=ProtectKernelModules=yes
  --property=ProtectKernelTunables=yes
  --property=ProtectSystem=strict
  --property=ProtectProc=invisible
  --property=ProcSubset=pid
  --property=RestrictNamespaces=yes
  --property='RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6'
  --property=SystemCallArchitectures=native
  --property=KeyringMode=private
  --property=RemoveIPC=yes
  --property=RestrictRealtime=yes
  --property=RestrictSUIDSGID=yes
  --property=LockPersonality=yes
  --property=Restart=no
)
transient_sequence=0

run_cutover_check() {
  local unit exit_code
  local -a role_args=()
  if [[ -n "$1" ]]; then
    role_args=(--producer-run-id "$1")
  fi
  transient_sequence=$((transient_sequence + 1))
  unit="creator-tracker-cutover-verify-$$-$transient_sequence"
  : >"$scratch/result.json"
  set +e
  systemd-run --quiet --wait --pipe --collect --unit="$unit" \
    "${common_properties[@]}" \
    --property=User=creator-tracker-raw-verifier \
    --property=Group=creator-tracker-raw-verifier \
    --property="LoadCredential=role-env:$cutover_credential" \
    --property=TimeoutStartSec=15min \
    --property=TemporaryFileSystem=/run:ro \
    --property=InaccessiblePaths='/etc/creator-tracker /var/lib/creator-tracker/imports' \
    --property=BindReadOnlyPaths='/run/systemd/resolve /var/lib/creator-tracker/state /var/lib/creator-tracker/raw-evidence-v1 /var/lib/creator-tracker/verified-raw-evidence-v1' \
    -- "$release/bin/cutover-verify" "${role_args[@]}" \
    >"$scratch/result.json"
  exit_code=$?
  set -e
  [[ "$exit_code" == 0 || "$exit_code" == 75 ]] || \
    fail "cutover verifier failed (exit=$exit_code)"
  "$result_validator" <"$scratch/result.json" >"$scratch/parsed" || \
    fail 'cutover verifier returned an invalid or incomplete result'
  IFS=$'\t' read -r check_status check_selected check_producer \
    check_capture check_delivery check_raw check_expected check_first_outbox \
    check_last_outbox check_projection <"$scratch/parsed"
  if [[ "$check_status" == complete ]]; then
    [[ "$exit_code" == 0 ]] || fail 'complete verifier result did not exit zero'
  else
    [[ "$exit_code" == 75 ]] || fail 'pending verifier result did not exit 75'
  fi
}

run_delivery_once() {
  local unit exit_code
  transient_sequence=$((transient_sequence + 1))
  unit="creator-tracker-cutover-delivery-$$-$transient_sequence"
  set +e
  systemd-run --quiet --wait --pipe --collect --unit="$unit" \
    "${common_properties[@]}" \
    --property=User=creator-tracker-writer \
    --property=Group=creator-tracker-writer \
    --property=SuccessExitStatus=75 \
    --property="LoadCredential=role-env:$delivery_credential" \
    --property=TimeoutStartSec=2min \
    --property=TemporaryFileSystem=/run:ro \
    --property=InaccessiblePaths='/etc/creator-tracker /var/lib/creator-tracker/imports /var/lib/creator-tracker/raw-evidence-v1 /var/lib/creator-tracker/verified-raw-evidence-v1' \
    --property=BindReadOnlyPaths=/run/systemd/resolve \
    --property=BindPaths='/var/lib/creator-tracker/state' \
    -- "$release/bin/canonical-delivery"
  exit_code=$?
  set -e
  [[ "$exit_code" == 0 || "$exit_code" == 75 ]] || \
    fail "canonical delivery failed during cutover drain (exit=$exit_code)"
}

run_verifier_once() {
  local unit exit_code
  transient_sequence=$((transient_sequence + 1))
  unit="creator-tracker-cutover-raw-$$-$transient_sequence"
  set +e
  systemd-run --quiet --wait --pipe --collect --unit="$unit" \
    "${common_properties[@]}" \
    --property=User=creator-tracker-raw-verifier \
    --property=Group=creator-tracker-raw-verifier \
    --property=SuccessExitStatus=75 \
    --property="LoadCredential=role-env:$verifier_credential" \
    --property=TimeoutStartSec=15min \
    --property=TemporaryFileSystem=/run:ro \
    --property=InaccessiblePaths='/etc/creator-tracker /var/lib/creator-tracker/imports' \
    --property=BindReadOnlyPaths='/run/systemd/resolve /var/lib/creator-tracker/raw-evidence-v1' \
    --property=BindPaths='/var/lib/creator-tracker/verified-raw-evidence-v1' \
    -- "$release/bin/raw-verifier"
  exit_code=$?
  set -e
  [[ "$exit_code" == 0 || "$exit_code" == 75 ]] || \
    fail "raw verifier failed during cutover drain (exit=$exit_code)"
}

cutover_advance_action() {
  local status="$1" delivery_pending="$2" raw_pending="$3" anchored="$4"
  if [[ "$status" == complete && "$anchored" == 1 ]]; then
    printf '%s\n' finish
  elif [[ "$delivery_pending" == 1 ]]; then
    printf '%s\n' delivery
  elif [[ "$raw_pending" == 1 ]]; then
    printf '%s\n' raw-verifier
  elif [[ "$status" == complete ]]; then
    # A latest-selected complete response is not authoritative until the same
    # producer ID has passed one explicit anchored recheck.
    printf '%s\n' recheck
  else
    fail 'pending cutover result did not identify an advanceable queue'
  fi
}

producer_run_id=''
capture_set_id=''
expected_pages=''
frozen_first_outbox_id=''
frozen_last_outbox_id=''
projection_summary=''
anchored_check_seen=0
while :; do
  now_epoch="$(date +%s)"
  ((now_epoch - started_epoch < max_runtime_seconds)) || \
    fail 'cutover drain exceeded its one-hour verified time bound'

  run_cutover_check "$producer_run_id"
  if [[ -z "$producer_run_id" ]]; then
    [[ "$check_selected" == latest ]] || \
      fail 'initial cutover verifier did not select the latest capture set'
    producer_run_id="$check_producer"
    capture_set_id="$check_capture"
    expected_pages="$check_expected"
    frozen_first_outbox_id="$check_first_outbox"
    frozen_last_outbox_id="$check_last_outbox"
    projection_summary="$check_projection"
  else
    [[ "$check_selected" == producer_run_id && \
       "$check_producer" == "$producer_run_id" ]] || \
      fail 'anchored cutover verifier moved to a different producer run'
    if [[ -z "$capture_set_id" ]]; then
      capture_set_id="$check_capture"
      expected_pages="$check_expected"
      frozen_first_outbox_id="$check_first_outbox"
      frozen_last_outbox_id="$check_last_outbox"
      projection_summary="$check_projection"
    fi
    [[ "$check_capture" == "$capture_set_id" && \
       "$check_expected" == "$expected_pages" && \
       "$check_first_outbox" == "$frozen_first_outbox_id" && \
       "$check_last_outbox" == "$frozen_last_outbox_id" && \
       "$check_projection" == "$projection_summary" ]] || \
      fail 'anchored cutover verifier changed the frozen capture set'
    anchored_check_seen=1
  fi

  advance_action="$(cutover_advance_action "$check_status" "$check_delivery" \
    "$check_raw" "$anchored_check_seen")"
  case "$advance_action" in
    finish) break ;;
    delivery) run_delivery_once ;;
    raw-verifier) run_verifier_once ;;
    recheck) ;;
    *) fail 'cutover advance decision is invalid' ;;
  esac
  sleep 2
done

result_sha256="$(sha256sum -- "$scratch/result.json" | awk '{print $1}')"
[[ "$result_sha256" =~ ^[0-9a-f]{64}$ ]] || fail 'could not hash final cutover result'
result_tmp="$(mktemp "$cutover_state/.result.XXXXXX")"
cp --reflink=never -- "$scratch/result.json" "$result_tmp"
chown root:creator-tracker-health "$result_tmp"
chmod 0440 "$result_tmp"
mv -fT -- "$result_tmp" "$cutover_state/result.json"
/usr/bin/sync -f "$cutover_state/result.json"

marker_tmp="$(mktemp "$cutover_state/.success.XXXXXX")"
{
  printf 'format_version=2\n'
  printf 'status=complete\n'
  printf 'release_id=%s\n' "$release_id"
  printf 'producer_run_id=%s\n' "$producer_run_id"
  printf 'capture_set_id=%s\n' "$capture_set_id"
  printf 'expected_pages=%s\n' "$expected_pages"
  printf 'frozen_first_outbox_id=%s\n' "$frozen_first_outbox_id"
  printf 'frozen_last_outbox_id=%s\n' "$frozen_last_outbox_id"
  printf 'projection_summary=%s\n' "$projection_summary"
  printf 'result_sha256=%s\n' "$result_sha256"
  printf 'completed_at_epoch=%s\n' "$(date +%s)"
} >"$marker_tmp"
chown root:creator-tracker-health "$marker_tmp"
chmod 0440 "$marker_tmp"
mv -fT -- "$marker_tmp" "$cutover_state/success"
unlink -- "$cutover_state/in-progress"
/usr/bin/sync -f "$cutover_state"
completed=1
printf 'creator-tracker cutover completeness: complete producer_run_id=%s capture_set_id=%s pages=%s\n' \
  "$producer_run_id" "$capture_set_id" "$expected_pages"
