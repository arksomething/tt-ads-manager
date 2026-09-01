#!/bin/bash -p
set -uo pipefail

export PATH='/usr/bin:/bin'
unset NODE_OPTIONS NODE_PATH LD_PRELOAD LD_LIBRARY_PATH LD_AUDIT BASH_ENV ENV || true

url="${CREATOR_TRACKER_DASHBOARD_HEALTH_URL:-}"
expected_codes="${CREATOR_TRACKER_DASHBOARD_EXPECTED_CODES:-200}"
timeout_seconds="${CREATOR_TRACKER_DASHBOARD_TIMEOUT_SECONDS:-15}"
canonical_health="$(readlink -f -- "${BASH_SOURCE[0]}")"
sealed_health=0
if [[ "$canonical_health" =~ ^/opt/creator-tracker/releases/[0-9a-f]{64}/bin/check-dashboard-health$ ]]; then
  sealed_health=1
  state_dir='/var/lib/creator-tracker/state'
else
  state_base="${XDG_STATE_HOME:-${HOME:?HOME is required}/.local/state}"
  state_dir="${CREATOR_TRACKER_STATE_DIR:-$state_base/creator-tracker}"
fi
if ((sealed_health == 0)); then
  health_dir="$state_dir/health"
fi

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

http_code="$(/usr/bin/env -i -- PATH=/usr/bin:/bin LANG=C.UTF-8 LC_ALL=C.UTF-8 \
  /usr/bin/curl --disable --silent --show-error --location \
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
instagram_scheduler_max="${CREATOR_TRACKER_INSTAGRAM_SCHEDULER_SUCCESS_MAX_AGE_SECONDS:-660}"
instagram_discovery_max="${CREATOR_TRACKER_INSTAGRAM_DISCOVERY_SUCCESS_MAX_AGE_SECONDS:-5400}"
provider_max="${CREATOR_TRACKER_PROVIDER_SUCCESS_MAX_AGE_SECONDS:-50400}"
canonical_delivery_max="${CREATOR_TRACKER_CANONICAL_DELIVERY_SUCCESS_MAX_AGE_SECONDS:-300}"
raw_verifier_max="${CREATOR_TRACKER_RAW_VERIFIER_SUCCESS_MAX_AGE_SECONDS:-900}"
storage_min_free_bytes="${CREATOR_TRACKER_STORAGE_MIN_FREE_BYTES:-21474836480}"
require_positive_integer CREATOR_TRACKER_STORAGE_MIN_FREE_BYTES "$storage_min_free_bytes"

if ((sealed_health != 0)); then
  worker_status="$state_dir/collector-worker/status"
  scheduler_success="$state_dir/scheduler-tick/success"
  roster_success="$state_dir/roster-refresh/success"
  instagram_scheduler_success="$state_dir/instagram-scheduler/success"
  instagram_discovery_success="$state_dir/instagram-discovery/success"
  provider_success="$state_dir/provider-reconcile/success"
  canonical_delivery_success="$state_dir/canonical-delivery/success"
  raw_verifier_success="$state_dir/raw-verifier/success"
  storage_metrics="$state_dir/raw-verifier/storage.metrics"
  cutover_success="$state_dir/cutover-completeness/success"
  cutover_result="$state_dir/cutover-completeness/result.json"
  cutover_validator='/opt/creator-tracker/current/bin/validate-cutover-result'
else
  worker_status="$health_dir/collector-worker.status"
  scheduler_success="$health_dir/scheduler-tick.success"
  roster_success="$health_dir/roster-refresh.success"
  instagram_scheduler_success="$health_dir/instagram-scheduler.success"
  instagram_discovery_success="$health_dir/instagram-discovery.success"
  provider_success="$health_dir/provider-reconcile.success"
  canonical_delivery_success="$health_dir/canonical-delivery.success"
  raw_verifier_success="$health_dir/raw-verifier.success"
fi
if ((sealed_health != 0)); then
  storage_available_bytes="$(/usr/bin/df -B1 --output=avail /var/lib/creator-tracker | \
    awk 'NR == 2 { print $1 }')"
  if [[ ! "$storage_available_bytes" =~ ^[0-9]+$ || \
       "$storage_available_bytes" -lt "$storage_min_free_bytes" ]]; then
    printf 'creator-tracker health: storage reserve is below floor (available=%s floor=%s)\n' \
      "${storage_available_bytes:-invalid}" "$storage_min_free_bytes" >&2
    failed=1
  fi
  if [[ ! -f "$storage_metrics" || -L "$storage_metrics" || \
       "$(stat -c '%U %G %a %h' -- "$storage_metrics" 2>/dev/null)" != \
         'creator-tracker-raw-verifier creator-tracker-health 640 1' ]]; then
    printf 'creator-tracker health: raw evidence storage metrics are missing or unsafe: %s\n' \
      "$storage_metrics" >&2
    failed=1
  else
    storage_metric_keys="$(cut -d= -f1 -- "$storage_metrics" | LC_ALL=C sort)"
    expected_storage_metric_keys=$'archive_cas_bytes\narchive_growth_bytes\nfilesystem_available_bytes\nformat_version\nmeasured_at_epoch\nsource_cas_bytes\nsource_growth_bytes'
    source_cas_bytes="$(read_field "$storage_metrics" source_cas_bytes)"
    archive_cas_bytes="$(read_field "$storage_metrics" archive_cas_bytes)"
    source_growth_bytes="$(read_field "$storage_metrics" source_growth_bytes)"
    archive_growth_bytes="$(read_field "$storage_metrics" archive_growth_bytes)"
    measured_available_bytes="$(read_field "$storage_metrics" filesystem_available_bytes)"
    storage_measured_epoch="$(read_field "$storage_metrics" measured_at_epoch)"
    storage_format_version="$(read_field "$storage_metrics" format_version)"
    if [[ "$storage_metric_keys" != "$expected_storage_metric_keys" || \
         "$storage_format_version" != 1 || \
         ! "$source_cas_bytes" =~ ^[0-9]+$ || \
         ! "$archive_cas_bytes" =~ ^[0-9]+$ || \
         ! "$source_growth_bytes" =~ ^[0-9]+$ || \
         ! "$archive_growth_bytes" =~ ^[0-9]+$ || \
         ! "$measured_available_bytes" =~ ^[0-9]+$ || \
         ! "$storage_measured_epoch" =~ ^[0-9]+$ ]]; then
      printf 'creator-tracker health: raw evidence storage metrics are invalid: %s\n' \
        "$storage_metrics" >&2
      failed=1
    elif ! check_age storage-metrics "$storage_metrics" measured_at_epoch \
      "$raw_verifier_max"; then
      failed=1
    fi
  fi
fi
if ((sealed_health != 0)); then
  if [[ ! -f "$cutover_success" || -L "$cutover_success" || \
       "$(stat -c '%U %G %a %h' -- "$cutover_success" 2>/dev/null)" != \
         'root creator-tracker-health 440 1' ]]; then
    printf 'creator-tracker health: canonical cutover completeness marker is missing or unsafe: %s\n' \
      "$cutover_success" >&2
    failed=1
  else
    cutover_status="$(read_field "$cutover_success" status)"
    cutover_format_version="$(read_field "$cutover_success" format_version)"
    cutover_release_id="$(read_field "$cutover_success" release_id)"
    cutover_producer_run_id="$(read_field "$cutover_success" producer_run_id)"
    cutover_capture_set_id="$(read_field "$cutover_success" capture_set_id)"
    cutover_expected_pages="$(read_field "$cutover_success" expected_pages)"
    cutover_first_outbox_id="$(read_field "$cutover_success" frozen_first_outbox_id)"
    cutover_last_outbox_id="$(read_field "$cutover_success" frozen_last_outbox_id)"
    cutover_projection_summary="$(read_field "$cutover_success" projection_summary)"
    cutover_result_sha256="$(read_field "$cutover_success" result_sha256)"
    cutover_current_release="$(basename -- "$(readlink -f -- /opt/creator-tracker/current 2>/dev/null)")"
    if [[ "$cutover_format_version" != 2 || "$cutover_status" != complete || \
         ! "$cutover_release_id" =~ ^[0-9a-f]{64}$ || \
         "$cutover_release_id" != "$cutover_current_release" || \
         ! "$cutover_producer_run_id" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$ || \
         ! "$cutover_capture_set_id" =~ ^[0-9a-f]{64}$ || \
         ! "$cutover_expected_pages" =~ ^[1-9][0-9]*$ || \
         ! "$cutover_first_outbox_id" =~ ^[1-9][0-9]*$ || \
         ! "$cutover_last_outbox_id" =~ ^[1-9][0-9]*$ || \
         ! "$cutover_projection_summary" =~ ^[0-9]+(:[0-9]+){5}$ || \
         ! "$cutover_result_sha256" =~ ^[0-9a-f]{64}$ ]]; then
      printf 'creator-tracker health: canonical cutover completeness marker is invalid: %s\n' \
        "$cutover_success" >&2
      failed=1
    elif [[ ! -f "$cutover_result" || -L "$cutover_result" || \
           "$(stat -c '%U %G %a %h' -- "$cutover_result" 2>/dev/null)" != \
             'root creator-tracker-health 440 1' || \
           "$(sha256sum -- "$cutover_result" | awk '{print $1}')" != \
             "$cutover_result_sha256" || \
           ! -x "$cutover_validator" ]]; then
      printf 'creator-tracker health: canonical cutover result is missing, unsafe, or changed: %s\n' \
        "$cutover_result" >&2
      failed=1
    elif ! cutover_fields="$("$cutover_validator" <"$cutover_result")"; then
      printf 'creator-tracker health: canonical cutover result is invalid: %s\n' \
        "$cutover_result" >&2
      failed=1
    else
      IFS=$'\t' read -r cutover_result_status cutover_selected_by \
        cutover_result_producer cutover_result_capture cutover_delivery_pending \
        cutover_raw_pending cutover_result_expected cutover_result_first_outbox \
        cutover_result_last_outbox cutover_result_projection <<<"$cutover_fields"
      if [[ "$cutover_result_status" != complete || \
           "$cutover_selected_by" != producer_run_id || \
           "$cutover_result_producer" != "$cutover_producer_run_id" || \
           "$cutover_result_capture" != "$cutover_capture_set_id" || \
           "$cutover_delivery_pending" != 0 || "$cutover_raw_pending" != 0 || \
           "$cutover_result_expected" != "$cutover_expected_pages" || \
           "$cutover_result_first_outbox" != "$cutover_first_outbox_id" || \
           "$cutover_result_last_outbox" != "$cutover_last_outbox_id" || \
           "$cutover_result_projection" != "$cutover_projection_summary" ]]; then
        printf 'creator-tracker health: canonical cutover result does not match its marker: %s\n' \
          "$cutover_result" >&2
        failed=1
      fi
    fi
  fi
fi
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

if ! check_age scheduler-success "$scheduler_success" \
  at_epoch "$scheduler_max"; then
  failed=1
fi
if ! check_age roster-success "$roster_success" \
  at_epoch "$roster_max"; then
  failed=1
fi
if ! check_age instagram-scheduler-success \
  "$instagram_scheduler_success" at_epoch \
  "$instagram_scheduler_max"; then
  failed=1
fi
if ! check_age instagram-discovery-success \
  "$instagram_discovery_success" at_epoch \
  "$instagram_discovery_max"; then
  failed=1
fi
if ! check_age provider-success "$provider_success" \
  at_epoch "$provider_max"; then
  failed=1
fi
if ! check_age canonical-delivery-success "$canonical_delivery_success" \
  at_epoch "$canonical_delivery_max"; then
  failed=1
fi
if ! check_age raw-verifier-success "$raw_verifier_success" \
  at_epoch "$raw_verifier_max"; then
  failed=1
fi

coverage_executable=''
if ((sealed_health != 0)); then
  coverage_executable='/opt/creator-tracker/current/bin/check-coverage'
elif [[ "${CREATOR_TRACKER_TEST_ONLY_SKIP_COVERAGE:-}" != 1 ]]; then
  printf '%s\n' 'creator-tracker health: unsealed health checker cannot run in production' >&2
  failed=1
fi
if [[ -n "$coverage_executable" && ! -x "$coverage_executable" ]]; then
  printf 'creator-tracker health: sealed coverage executable is unavailable: %s\n' \
    "$coverage_executable" >&2
  failed=1
elif [[ -n "$coverage_executable" ]] && ! "$coverage_executable"; then
  printf '%s\n' 'creator-tracker health: owned source coverage is degraded' >&2
  failed=1
fi

if ((failed != 0)); then
  exit 1
fi

printf 'creator-tracker health: ok dashboard=%s worker=%s storage_free_bytes=%s source_cas_bytes=%s archive_cas_bytes=%s source_growth_bytes=%s archive_growth_bytes=%s\n' \
  "$http_code" "$worker_state" "${storage_available_bytes:-unsealed}" \
  "${source_cas_bytes:-unsealed}" "${archive_cas_bytes:-unsealed}" \
  "${source_growth_bytes:-unsealed}" "${archive_growth_bytes:-unsealed}"
