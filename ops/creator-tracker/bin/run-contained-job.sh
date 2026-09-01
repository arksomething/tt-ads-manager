#!/bin/bash -p
set -uo pipefail

export PATH='/usr/bin:/bin'
unset NODE_OPTIONS NODE_PATH LD_PRELOAD LD_LIBRARY_PATH LD_AUDIT BASH_ENV ENV || true

usage() {
  printf '%s\n' \
    'usage: run-contained-job.sh JOB' >&2
  exit 64
}

canonical_wrapper="$(readlink -f -- "${BASH_SOURCE[0]}")"
sealed_wrapper=0
if [[ "$canonical_wrapper" =~ ^/opt/creator-tracker/releases/[0-9a-f]{64}/bin/run-contained-job$ ]]; then
  sealed_wrapper=1
  sealed_release_root="${canonical_wrapper%/bin/run-contained-job}"
fi

job_name="${1:-}"
[[ "$job_name" =~ ^[a-z0-9][a-z0-9-]{0,62}$ ]] || usage
shift

uid="$(id -u)"
if ((sealed_wrapper != 0)); then
  runtime_dir='/run/creator-tracker'
  state_dir="/var/lib/creator-tracker/state/$job_name"
else
  runtime_base="${XDG_RUNTIME_DIR:-/run/user/$uid}"
  state_base="${XDG_STATE_HOME:-${HOME:?HOME is required}/.local/state}"
  runtime_dir="${CREATOR_TRACKER_RUNTIME_DIR:-$runtime_base/creator-tracker}"
  state_dir="${CREATOR_TRACKER_STATE_DIR:-$state_base/creator-tracker}"
fi
lock_dir="$runtime_dir/locks"
if ((sealed_wrapper != 0)); then
  health_dir="$state_dir"
else
  health_dir="$state_dir/health"
fi

case "$runtime_dir:$state_dir" in
  /*:/*) ;;
  *) printf '%s\n' 'creator-tracker: runtime and state paths must be absolute' >&2; exit 78 ;;
esac

umask 077
if ((sealed_wrapper != 0)); then
  [[ ! -e /opt/creator-tracker/ACTIVATION_IN_PROGRESS ]] || {
    printf '%s\n' 'creator-tracker: activation recovery is required before jobs may start' >&2
    exit 78
  }
  [[ ! -L "$lock_dir" && -d "$lock_dir" && "$(stat -c '%u %a' -- "$lock_dir")" == '0 755' ]] || {
    printf '%s\n' 'creator-tracker: shared lock directory is not root-controlled' >&2
    exit 78
  }
  [[ ! -L "$health_dir" && -d "$health_dir" &&
     "$(stat -c '%u %a' -- "$health_dir")" == "$uid 2750" ]] || {
    printf '%s\n' 'creator-tracker: role state directory is not private or role-owned' >&2
    exit 78
  }
  umask 027
else
  install -d -m 700 "$lock_dir" "$health_dir"
fi

if ((sealed_wrapper != 0)); then
  status_file="$health_dir/status"
  success_file="$health_dir/success"
  failure_file="$health_dir/failure"
else
  status_file="$health_dir/$job_name.status"
  success_file="$health_dir/$job_name.success"
  failure_file="$health_dir/$job_name.failure"
fi
writer_lock_name=''
writer_lock_wait_seconds=0
writer_lock_timeout_exit=75
secondary_lock_name=''
case "$job_name" in
  roster-refresh|provider-reconcile|instagram-discovery|instagram-credit-rearm|migrate-database)
    writer_lock_name=owned-tracker-writer
    writer_lock_wait_seconds=300
    [[ "$job_name" == provider-reconcile ]] && writer_lock_timeout_exit=76
    ;;
  scheduler-tick)
    writer_lock_name=owned-tracker-writer
    ;;
  instagram-scheduler)
    # The five-minute Instagram lane must eventually get a turn even when a
    # two-minute TikTok tick occupies most three-minute timer intervals.
    writer_lock_name=owned-tracker-writer
    writer_lock_wait_seconds=300
    ;;
  dashboard-health)
    # Coverage opens a detached checkpoint-only database snapshot. Defer a
    # health tick while either the ordinary writer lane or canonical delivery
    # can own the WAL instead of reporting a false coverage failure from an
    # intentionally uncheckpointed in-flight transaction.
    writer_lock_name=owned-tracker-writer
    secondary_lock_name=canonical-delivery
    ;;
esac
hostname_value="$(hostname 2>/dev/null || printf unknown)"
started_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
started_epoch="$(date +%s)"
child_pid=''
child_pgid=''
heartbeat_pid=''
received_signal=''

write_status() {
  local state="$1"
  local exit_code="${2:-}"
  local finished_at="${3:-}"
  local now_iso now_epoch tmp
  now_iso="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  now_epoch="$(date +%s)"
  tmp="$status_file.tmp.${BASHPID:-$$}"
  {
    printf 'format_version=1\n'
    printf 'job=%s\n' "$job_name"
    printf 'state=%s\n' "$state"
    printf 'hostname=%s\n' "$hostname_value"
    printf 'wrapper_pid=%s\n' "$$"
    printf 'child_pid=%s\n' "$child_pid"
    printf 'started_at=%s\n' "$started_at"
    printf 'started_at_epoch=%s\n' "$started_epoch"
    printf 'updated_at=%s\n' "$now_iso"
    printf 'updated_at_epoch=%s\n' "$now_epoch"
    printf 'finished_at=%s\n' "$finished_at"
    printf 'exit_code=%s\n' "$exit_code"
  } >"$tmp"
  # The production state tree carries named default ACL entries for its
  # read-only health roles.  Without an explicit chmod, those inherited ACLs
  # leave the mask writable and `stat` reports 0660 even though umask 027 was
  # requested.  Seal every published health file to the mode consumed by the
  # fail-closed rearm and verifier checks.
  chmod 0640 "$tmp"
  mv -fT -- "$tmp" "$status_file"
}

write_marker() {
  local marker_file="$1"
  local exit_code="$2"
  local state="$3"
  local now_iso now_epoch tmp
  now_iso="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  now_epoch="$(date +%s)"
  tmp="$marker_file.tmp.${BASHPID:-$$}"
  {
    printf 'format_version=1\n'
    printf 'job=%s\n' "$job_name"
    printf 'state=%s\n' "$state"
    printf 'at=%s\n' "$now_iso"
    printf 'at_epoch=%s\n' "$now_epoch"
    printf 'exit_code=%s\n' "$exit_code"
  } >"$tmp"
  chmod 0640 "$tmp"
  mv -fT -- "$tmp" "$marker_file"
}

write_storage_metrics() {
  local source_root='/var/lib/creator-tracker/raw-evidence-v1'
  local archive_root='/var/lib/creator-tracker/verified-raw-evidence-v1'
  local metrics_file="$health_dir/storage.metrics"
  local tmp="$metrics_file.tmp.${BASHPID:-$$}" previous_source previous_archive
  local source_bytes archive_bytes available_bytes source_growth archive_growth
  [[ "$job_name" == raw-verifier && "$sealed_wrapper" == 1 ]] || return 0
  [[ -d "$source_root" && ! -L "$source_root" && \
     -d "$archive_root" && ! -L "$archive_root" ]] || return 1
  source_bytes="$(/usr/bin/du -sb -- "$source_root" | awk '{print $1}')"
  archive_bytes="$(/usr/bin/du -sb -- "$archive_root" | awk '{print $1}')"
  available_bytes="$(/usr/bin/df -B1 --output=avail /var/lib/creator-tracker | \
    awk 'NR == 2 { print $1 }')"
  [[ "$source_bytes" =~ ^[0-9]+$ && "$archive_bytes" =~ ^[0-9]+$ && \
     "$available_bytes" =~ ^[0-9]+$ ]] || return 1
  previous_source="$source_bytes"
  previous_archive="$archive_bytes"
  if [[ -f "$metrics_file" && ! -L "$metrics_file" ]]; then
    [[ "$(stat -c '%U %G %a %h' -- "$metrics_file")" == \
      'creator-tracker-raw-verifier creator-tracker-health 640 1' ]] || return 1
    previous_source="$(awk -F= '$1 == "source_cas_bytes" { print $2; exit }' "$metrics_file")"
    previous_archive="$(awk -F= '$1 == "archive_cas_bytes" { print $2; exit }' "$metrics_file")"
    [[ "$previous_source" =~ ^[0-9]+$ && "$previous_archive" =~ ^[0-9]+$ ]] || return 1
  fi
  source_growth=$((source_bytes - previous_source))
  archive_growth=$((archive_bytes - previous_archive))
  ((source_growth >= 0 && archive_growth >= 0)) || return 1
  {
    printf 'format_version=1\n'
    printf 'measured_at_epoch=%s\n' "$(date +%s)"
    printf 'filesystem_available_bytes=%s\n' "$available_bytes"
    printf 'source_cas_bytes=%s\n' "$source_bytes"
    printf 'archive_cas_bytes=%s\n' "$archive_bytes"
    printf 'source_growth_bytes=%s\n' "$source_growth"
    printf 'archive_growth_bytes=%s\n' "$archive_growth"
  } >"$tmp"
  chmod 0640 "$tmp"
  mv -fT -- "$tmp" "$metrics_file"
  /usr/bin/sync -f "$metrics_file"
}

job_lock_file="$lock_dir/$job_name.lock"
if ((sealed_wrapper != 0)); then
  [[ ! -L "$job_lock_file" && -f "$job_lock_file" &&
     "$(stat -c '%u %a %h' -- "$job_lock_file")" == '0 660 1' ]] || {
    printf '%s\n' 'creator-tracker: role lock is not a sealed root-owned file' >&2
    exit 78
  }
fi
exec {job_lock_fd}>"$job_lock_file"
if ! /usr/bin/flock -n "$job_lock_fd"; then
  # Preserve the active owner's running/heartbeat status. A competing manual
  # invocation must not make the health probe think the real worker stopped.
  write_marker "$health_dir/$job_name.lock-busy" 75 lock_busy
  printf 'creator-tracker: %s is already running\n' "$job_name" >&2
  exit 75
fi

# Once Instagram is queued or running, later TikTok ticks yield before touching
# the shared writer lock. This turns the existing Instagram job lock into a
# priority signal without weakening either role's own single-instance fence.
if [[ "$job_name" == scheduler-tick ]]; then
  instagram_priority_lock_file="$lock_dir/instagram-scheduler.lock"
  if ((sealed_wrapper != 0)); then
    [[ ! -L "$instagram_priority_lock_file" && \
       -f "$instagram_priority_lock_file" && \
       "$(stat -c '%u %a %h' -- "$instagram_priority_lock_file")" == \
         '0 660 1' ]] || {
      printf '%s\n' \
        'creator-tracker: Instagram priority lock is not a sealed root-owned file' >&2
      exit 78
    }
  fi
  exec {instagram_priority_lock_fd}>"$instagram_priority_lock_file"
  if ! /usr/bin/flock -n "$instagram_priority_lock_fd"; then
    write_marker \
      "$health_dir/$job_name.priority-lock-busy" \
      75 \
      priority_lock_busy
    printf '%s\n' \
      'creator-tracker: TikTok scheduler yielded to queued Instagram work' >&2
    exit 75
  fi
  exec {instagram_priority_lock_fd}>&-
fi

if [[ -n "$writer_lock_name" ]]; then
  writer_lock_file="$lock_dir/$writer_lock_name.lock"
  if ((sealed_wrapper != 0)); then
    [[ ! -L "$writer_lock_file" && -f "$writer_lock_file" &&
       "$(stat -c '%u %a %h' -- "$writer_lock_file")" == '0 660 1' ]] || {
      printf '%s\n' 'creator-tracker: writer lock is not a sealed root-owned file' >&2
      exit 78
    }
  fi
  exec {writer_lock_fd}>"$writer_lock_file"
  if ((writer_lock_wait_seconds > 0)); then
    /usr/bin/flock -w "$writer_lock_wait_seconds" "$writer_lock_fd"
    writer_lock_exit=$?
  else
    /usr/bin/flock -n "$writer_lock_fd"
    writer_lock_exit=$?
  fi
  if ((writer_lock_exit != 0)); then
    write_marker \
      "$health_dir/$job_name.writer-lock-busy" \
      "$writer_lock_timeout_exit" \
      writer_lock_busy
    printf 'creator-tracker: database writer is busy for %s\n' "$job_name" >&2
    exit "$writer_lock_timeout_exit"
  fi
fi

if [[ -n "$secondary_lock_name" ]]; then
  secondary_lock_file="$lock_dir/$secondary_lock_name.lock"
  if ((sealed_wrapper != 0)); then
    [[ ! -L "$secondary_lock_file" && -f "$secondary_lock_file" &&
       "$(stat -c '%u %a %h' -- "$secondary_lock_file")" == '0 660 1' ]] || {
      printf '%s\n' 'creator-tracker: secondary lock is not a sealed root-owned file' >&2
      exit 78
    }
  fi
  exec {secondary_lock_fd}>"$secondary_lock_file"
  if ! /usr/bin/flock -n "$secondary_lock_fd"; then
    write_marker \
      "$health_dir/$job_name.secondary-lock-busy" \
      75 \
      secondary_lock_busy
    printf 'creator-tracker: secondary database writer is busy for %s\n' "$job_name" >&2
    exit 75
  fi
fi

command_args=()
if ((sealed_wrapper != 0)) && [[ "$job_name" == instagram-credit-rearm ]]; then
  if (($# != 3)) ||
     [[ ! "$1" =~ ^--handle=[A-Za-z0-9._]{1,30}$ ]] ||
     [[ "$2" != --confirm-provider-launch-balance-at-least-1250 ]] ||
     [[ "$3" != --confirm-provider-top-up-one-request ]]; then
    write_status configuration_error 78 "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf '%s\n' 'creator-tracker: Instagram credit rearm arguments are invalid' >&2
    exit 78
  fi
  command_args=("$sealed_release_root/bin/instagram-credit-rearm" "$@")
elif [[ "${1:-}" == '--' ]]; then
  # The repository verifier needs synthetic commands to exercise locking and
  # signal forwarding. A sealed production wrapper can never enter this lane,
  # even if a mutable EnvironmentFile tries to set the test-only flag.
  [[ "$sealed_wrapper" == 0 && \
     "${CREATOR_TRACKER_TEST_ONLY_ALLOW_ARBITRARY_COMMAND:-}" == 1 ]] || usage
  shift
  (($# > 0)) || usage
  command_args=("$@")
else
  (($# == 0)) || usage
  release_role=''
  case "$job_name" in
    roster-refresh) release_role=roster-refresh ;;
    scheduler-tick) release_role=scheduler-tick ;;
    instagram-discovery) release_role=instagram-discovery ;;
    instagram-scheduler) release_role=instagram-scheduler ;;
    provider-reconcile) release_role=provider-reconcile ;;
    canonical-delivery) release_role=canonical-delivery ;;
    raw-verifier) release_role=raw-verifier ;;
    migrate-database) release_role=migrate-database ;;
    collector-worker) release_role=collector-worker ;;
    dashboard-health) release_role=check-dashboard-health ;;
    *)
      write_status configuration_error 78 "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
      printf 'creator-tracker: unsupported sealed job role: %s\n' "$job_name" >&2
      exit 78
      ;;
  esac
  command_args=("$sealed_release_root/bin/$release_role")
fi

if [[ "${command_args[0]}" != /* || ! -x "${command_args[0]}" ]]; then
  write_status configuration_error 78 "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf 'creator-tracker: command must be an absolute executable path: %s\n' \
    "${command_args[0]}" >&2
  exit 78
fi

heartbeat_interval="${CREATOR_TRACKER_HEARTBEAT_INTERVAL_SECONDS:-30}"
if [[ ! "$heartbeat_interval" =~ ^[0-9]+$ ]] || \
   ((heartbeat_interval < 5 || heartbeat_interval > 300)); then
  write_status configuration_error 78 "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf '%s\n' 'creator-tracker: heartbeat interval must be 5..300 seconds' >&2
  exit 78
fi

forward_signal() {
  local signal_name="$1"
  received_signal="$signal_name"
  if [[ -n "$heartbeat_pid" ]]; then
    kill "$heartbeat_pid" 2>/dev/null || true
  fi
  write_status stopping '' ''
  if [[ -n "$child_pgid" ]]; then
    # Every managed command owns a separate session/process group. Forwarding
    # to that group prevents launchers such as Next.js from leaving a restarted
    # or orphaned grandchild behind during logout, reboot, or unit restart.
    kill -s "$signal_name" -- "-$child_pgid" 2>/dev/null || true
  elif [[ -n "$child_pid" ]]; then
    kill -s "$signal_name" "$child_pid" 2>/dev/null || true
  fi
}

trap 'forward_signal TERM' TERM
trap 'forward_signal INT' INT
trap 'forward_signal HUP' HUP

write_status starting '' ''
/usr/bin/setsid --wait -- "${command_args[@]}" &
child_pid=$!
child_pgid=$child_pid
write_status running '' ''

heartbeat_loop() {
  # The monitor must never extend either lock past the managed command. Any
  # external sleep it launches would otherwise inherit the flock descriptors
  # and keep a completed writer serialized until the heartbeat interval ends.
  exec {job_lock_fd}>&-
  if [[ -n "$writer_lock_name" ]]; then
    exec {writer_lock_fd}>&-
  fi
  if [[ -n "$secondary_lock_name" ]]; then
    exec {secondary_lock_fd}>&-
  fi
  while sleep "$heartbeat_interval"; do
    kill -0 "$child_pid" 2>/dev/null || return 0
    write_status running '' ''
  done
}
heartbeat_loop &
heartbeat_pid=$!

wait "$child_pid"
exit_code=$?
kill "$heartbeat_pid" 2>/dev/null || true
wait "$heartbeat_pid" 2>/dev/null || true
heartbeat_pid=''
finished_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

if [[ -n "$received_signal" ]]; then
  write_status stopped "$exit_code" "$finished_at"
  # A supervisor-initiated stop/reboot is an expected lifecycle transition,
  # not a collector failure. Retain the child's real signal exit in the status
  # evidence while returning success to systemd.
  exit 0
fi

if ((exit_code == 0)) && [[ "$job_name" == raw-verifier ]] && \
   ! write_storage_metrics; then
  exit_code=1
  write_status failed "$exit_code" "$finished_at"
  write_marker "$failure_file" "$exit_code" storage_metrics_failed
  printf '%s\n' 'creator-tracker: raw evidence storage metrics could not be recorded' >&2
  exit "$exit_code"
fi

if ((exit_code == 0)); then
  write_status succeeded 0 "$finished_at"
  write_marker "$success_file" 0 succeeded
  exit 0
fi

write_status failed "$exit_code" "$finished_at"
write_marker "$failure_file" "$exit_code" failed
exit "$exit_code"
