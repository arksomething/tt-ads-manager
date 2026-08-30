#!/usr/bin/env bash
set -uo pipefail

url="${CREATOR_TRACKER_DASHBOARD_HEALTH_URL:-}"
expected_codes="${CREATOR_TRACKER_DASHBOARD_EXPECTED_CODES:-200}"
timeout_seconds="${CREATOR_TRACKER_DASHBOARD_TIMEOUT_SECONDS:-15}"
state_base="${XDG_STATE_HOME:-${HOME:?HOME is required}/.local/state}"
state_dir="${CREATOR_TRACKER_STATE_DIR:-$state_base/creator-tracker}"
health_dir="$state_dir/health"

require_positive_integer() {
  local name="$1"
  local value="$2"
  if [[ ! "$value" =~ ^[0-9]+$ ]] || ((value < 1)); then
    printf 'creator-tracker health: %s must be a positive integer\n' "$name" >&2
    exit 78
  fi
}

read_field() {
  local file="$1"
  local key="$2"
  awk -F= -v wanted="$key" '$1 == wanted { sub(/^[^=]*=/, ""); print; exit }' "$file"
}

check_age() {
  local label="$1"
  local file="$2"
  local epoch_key="$3"
  local max_age="$4"
  local recorded_epoch now_epoch age
  require_positive_integer "$label max age" "$max_age"
  if [[ ! -r "$file" ]]; then
    printf 'creator-tracker health: missing %s marker: %s\n' "$label" "$file" >&2
    return 1
  fi
  recorded_epoch="$(read_field "$file" "$epoch_key")"
  if [[ ! "$recorded_epoch" =~ ^[0-9]+$ ]]; then
    printf 'creator-tracker health: invalid %s marker: %s\n' "$label" "$file" >&2
    return 1
  fi
  now_epoch="$(date +%s)"
  age=$((now_epoch - recorded_epoch))
  if ((age < 0 || age > max_age)); then
    printf 'creator-tracker health: %s is stale (age=%ss max=%ss)\n' \
      "$label" "$age" "$max_age" >&2
    return 1
  fi
  return 0
}

[[ -n "$url" ]] || {
  printf '%s\n' 'creator-tracker health: dashboard URL is not configured' >&2
  exit 78
}
[[ "$url" == http://* || "$url" == https://* ]] || {
  printf '%s\n' 'creator-tracker health: dashboard URL must use http or https' >&2
  exit 78
}
require_positive_integer CREATOR_TRACKER_DASHBOARD_TIMEOUT_SECONDS "$timeout_seconds"

http_code="$(/usr/bin/curl --silent --show-error --location \
  --max-time "$timeout_seconds" --output /dev/null --write-out '%{http_code}' \
  "$url")"
curl_exit=$?
if ((curl_exit != 0)); then
  printf 'creator-tracker health: dashboard probe failed (curl_exit=%s)\n' \
    "$curl_exit" >&2
  exit 1
fi

case ",$expected_codes," in
  *",$http_code,"*) ;;
  *)
    printf 'creator-tracker health: unexpected dashboard status %s (expected %s)\n' \
      "$http_code" "$expected_codes" >&2
    exit 1
    ;;
esac

failed=0
worker_max="${CREATOR_TRACKER_WORKER_HEARTBEAT_MAX_AGE_SECONDS:-120}"
scheduler_max="${CREATOR_TRACKER_SCHEDULER_SUCCESS_MAX_AGE_SECONDS:-600}"
roster_max="${CREATOR_TRACKER_ROSTER_SUCCESS_MAX_AGE_SECONDS:-5400}"
instagram_scheduler_max="${CREATOR_TRACKER_INSTAGRAM_SCHEDULER_SUCCESS_MAX_AGE_SECONDS:-600}"
instagram_discovery_max="${CREATOR_TRACKER_INSTAGRAM_DISCOVERY_SUCCESS_MAX_AGE_SECONDS:-5400}"
provider_max="${CREATOR_TRACKER_PROVIDER_SUCCESS_MAX_AGE_SECONDS:-50400}"

worker_status="$health_dir/collector-worker.status"
if [[ -r "$worker_status" ]]; then
  worker_state="$(read_field "$worker_status" state)"
else
  worker_state=''
fi
if [[ "$worker_state" != running ]]; then
  printf 'creator-tracker health: worker state is %s, expected running\n' \
    "${worker_state:-missing}" >&2
  failed=1
elif ! check_age worker-heartbeat "$worker_status" updated_at_epoch "$worker_max"; then
  failed=1
fi

if ! check_age scheduler-success "$health_dir/scheduler-tick.success" \
  at_epoch "$scheduler_max"; then
  failed=1
fi
if ! check_age roster-success "$health_dir/roster-refresh.success" \
  at_epoch "$roster_max"; then
  failed=1
fi
if [[ -n "${CREATOR_TRACKER_INSTAGRAM_SCHEDULER_EXECUTABLE:-}" ]] && \
   ! check_age instagram-scheduler-success \
     "$health_dir/instagram-scheduler.success" at_epoch \
     "$instagram_scheduler_max"; then
  failed=1
fi
if [[ -n "${CREATOR_TRACKER_INSTAGRAM_DISCOVERY_EXECUTABLE:-}" ]] && \
   ! check_age instagram-discovery-success \
     "$health_dir/instagram-discovery.success" at_epoch \
     "$instagram_discovery_max"; then
  failed=1
fi
if [[ -n "${CREATOR_TRACKER_PROVIDER_EXECUTABLE:-}" ]] && \
   ! check_age provider-success "$health_dir/provider-reconcile.success" \
     at_epoch "$provider_max"; then
  failed=1
fi

coverage_executable="${CREATOR_TRACKER_COVERAGE_EXECUTABLE:-}"
if [[ -n "$coverage_executable" ]]; then
  if [[ "$coverage_executable" != /* || ! -x "$coverage_executable" ]]; then
    printf 'creator-tracker health: coverage executable is invalid: %s\n' \
      "$coverage_executable" >&2
    failed=1
  elif ! "$coverage_executable"; then
    printf '%s\n' 'creator-tracker health: owned source coverage is degraded' >&2
    failed=1
  fi
fi

if ((failed != 0)); then
  exit 1
fi

printf 'creator-tracker health: ok dashboard=%s worker=%s\n' \
  "$http_code" "$worker_state"
