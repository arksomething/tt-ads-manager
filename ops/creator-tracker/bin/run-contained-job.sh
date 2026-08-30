#!/usr/bin/env bash
set -uo pipefail

usage() {
  printf '%s\n' \
    'usage: run-contained-job.sh JOB [-- ABSOLUTE_COMMAND [ARG ...]]' >&2
  exit 64
}

job_name="${1:-}"
[[ "$job_name" =~ ^[a-z0-9][a-z0-9-]{0,62}$ ]] || usage
shift

uid="$(id -u)"
runtime_base="${XDG_RUNTIME_DIR:-/run/user/$uid}"
state_base="${XDG_STATE_HOME:-${HOME:?HOME is required}/.local/state}"
runtime_dir="${CREATOR_TRACKER_RUNTIME_DIR:-$runtime_base/creator-tracker}"
state_dir="${CREATOR_TRACKER_STATE_DIR:-$state_base/creator-tracker}"
lock_dir="$runtime_dir/locks"
health_dir="$state_dir/health"

case "$runtime_dir:$state_dir" in
  /*:/*) ;;
  *) printf '%s\n' 'creator-tracker: runtime and state paths must be absolute' >&2; exit 78 ;;
esac

umask 077
install -d -m 700 "$lock_dir" "$health_dir"

status_file="$health_dir/$job_name.status"
success_file="$health_dir/$job_name.success"
failure_file="$health_dir/$job_name.failure"
writer_lock_name=''
writer_lock_wait_seconds=0
writer_lock_timeout_exit=75
case "$job_name" in
  roster-refresh|provider-reconcile|instagram-discovery)
    writer_lock_name=owned-tracker-writer
    writer_lock_wait_seconds=300
    [[ "$job_name" == provider-reconcile ]] && writer_lock_timeout_exit=76
    ;;
  scheduler-tick|instagram-scheduler)
    writer_lock_name=owned-tracker-writer
    ;;
esac
hostname_value="$(hostname 2>/dev/null || printf unknown)"
started_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
started_epoch="$(date +%s)"
child_pid=''
child_pgid=''
received_signal=''

write_status() {
  local state="$1"
  local exit_code="${2:-}"
  local finished_at="${3:-}"
  local now_iso now_epoch tmp
  now_iso="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  now_epoch="$(date +%s)"
  tmp="$status_file.tmp.$$"
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
  mv -f "$tmp" "$status_file"
}

write_marker() {
  local marker_file="$1"
  local exit_code="$2"
  local state="$3"
  local now_iso now_epoch tmp
  now_iso="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  now_epoch="$(date +%s)"
  tmp="$marker_file.tmp.$$"
  {
    printf 'format_version=1\n'
    printf 'job=%s\n' "$job_name"
    printf 'state=%s\n' "$state"
    printf 'at=%s\n' "$now_iso"
    printf 'at_epoch=%s\n' "$now_epoch"
    printf 'exit_code=%s\n' "$exit_code"
  } >"$tmp"
  mv -f "$tmp" "$marker_file"
}

job_lock_file="$lock_dir/$job_name.lock"
exec {job_lock_fd}>"$job_lock_file"
if ! /usr/bin/flock -n "$job_lock_fd"; then
  # Preserve the active owner's running/heartbeat status. A competing manual
  # invocation must not make the health probe think the real worker stopped.
  write_marker "$health_dir/$job_name.lock-busy" 75 lock_busy
  printf 'creator-tracker: %s is already running\n' "$job_name" >&2
  exit 75
fi

if [[ -n "$writer_lock_name" ]]; then
  writer_lock_file="$lock_dir/$writer_lock_name.lock"
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

command_args=()
if [[ "${1:-}" == '--' ]]; then
  shift
  (($# > 0)) || usage
  command_args=("$@")
else
  (($# == 0)) || usage
  variable_name=''
  case "$job_name" in
    roster-refresh) variable_name=CREATOR_TRACKER_ROSTER_EXECUTABLE ;;
    scheduler-tick) variable_name=CREATOR_TRACKER_SCHEDULER_EXECUTABLE ;;
    instagram-discovery) variable_name=CREATOR_TRACKER_INSTAGRAM_DISCOVERY_EXECUTABLE ;;
    instagram-scheduler) variable_name=CREATOR_TRACKER_INSTAGRAM_SCHEDULER_EXECUTABLE ;;
    provider-reconcile) variable_name=CREATOR_TRACKER_PROVIDER_EXECUTABLE ;;
    collector-worker) variable_name=CREATOR_TRACKER_WORKER_EXECUTABLE ;;
    *)
      write_status configuration_error 78 "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
      printf 'creator-tracker: %s requires an explicit command after --\n' "$job_name" >&2
      exit 78
      ;;
  esac
  command_path="${!variable_name:-}"
  if [[ -z "$command_path" ]]; then
    write_status configuration_error 78 "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf 'creator-tracker: %s is not configured\n' "$variable_name" >&2
    exit 78
  fi
  command_args=("$command_path")
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

while kill -0 "$child_pid" 2>/dev/null; do
  sleep "$heartbeat_interval" &
  sleep_pid=$!
  wait "$sleep_pid" 2>/dev/null || true
  if kill -0 "$child_pid" 2>/dev/null; then
    write_status running '' ''
  fi
done

wait "$child_pid"
exit_code=$?
finished_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

if [[ -n "$received_signal" ]]; then
  write_status stopped "$exit_code" "$finished_at"
  # A supervisor-initiated stop/reboot is an expected lifecycle transition,
  # not a collector failure. Retain the child's real signal exit in the status
  # evidence while returning success to systemd.
  exit 0
fi

if ((exit_code == 0)); then
  write_status succeeded 0 "$finished_at"
  write_marker "$success_file" 0 succeeded
  exit 0
fi

write_status failed "$exit_code" "$finished_at"
write_marker "$failure_file" "$exit_code" failed
exit "$exit_code"
