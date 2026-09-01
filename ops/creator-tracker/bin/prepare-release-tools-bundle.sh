#!/bin/bash
set -euo pipefail

export PATH='/usr/bin:/bin'
unset NODE_OPTIONS NODE_PATH LD_PRELOAD LD_LIBRARY_PATH LD_AUDIT BASH_ENV ENV || true

fail() {
  printf 'creator-tracker release-tools prepare: %s\n' "$*" >&2
  exit 1
}

usage() {
  printf '%s\n' \
    'usage: prepare-release-tools-bundle.sh --output-parent /var/tmp/creator-tracker-release-tools' >&2
  exit 64
}

output_parent=''
while (($# > 0)); do
  case "$1" in
    --output-parent) (($# >= 2)) || usage; output_parent="$2"; shift 2 ;;
    *) usage ;;
  esac
done
[[ "$output_parent" =~ ^/var/tmp/creator-tracker-release-tools(/[A-Za-z0-9._-]+)*$ ]] || usage
[[ ! -L /var/tmp && -d /var/tmp ]] || fail '/var/tmp is not a real directory'
((EUID != 0)) || fail 'prepare the content-addressed bundle without root privileges'

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
tracker_dir="$(dirname -- "$script_dir")"
readonly -a bin_files=(
  activate-collector-release.sh
  activation-boundary.py
  activation-database.py
  activation-system-state.py
  activation-user-units.py
  build-collector-release.sh
  check-dashboard-health.sh
  durable-state.py
  install-collector-release.sh
  install-node-runtime.sh
  install-yt-dlp-runtime.sh
  migrate-provider-imports.py
  probe-database-access.py
  render-collector-config.py
  run-canonical-seed.sh
  run-cutover-completeness.sh
  run-instagram-credit-rearm.sh
  run-raw-verifier-provision.sh
  run-contained-job.sh
  validate-cutover-result.py
  verify-collector-release.sh
)
readonly -a unit_files=(
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
for relative in "${bin_files[@]/#/bin/}" "${unit_files[@]/#/systemd/}" \
  tmpfiles.d/creator-tracker.conf; do
  source_path="$tracker_dir/$relative"
  [[ -f "$source_path" && ! -L "$source_path" && \
     "$(stat -c '%h' -- "$source_path")" == 1 ]] || \
    fail "required source is missing, linked, or multiply linked: $relative"
done

install -d -m 0700 "$output_parent"
[[ ! -L "$output_parent" && -d "$output_parent" && \
   "$(readlink -f -- "$output_parent")" == "$output_parent" && \
   "$(stat -c '%u %a' -- "$output_parent")" == "$(id -u) 700" ]] || \
  fail 'output parent must be a canonical caller-owned mode 0700 directory'
stage="$(mktemp -d "$output_parent/.staging.XXXXXX")"
cleanup() {
  if [[ -n "${stage:-}" && -d "$stage" ]]; then
    chmod -R u+w -- "$stage" 2>/dev/null || true
    rm -rf -- "$stage"
  fi
}
trap cleanup EXIT
install -d -m 0755 "$stage/bin" "$stage/systemd" "$stage/tmpfiles.d"
for name in "${bin_files[@]}"; do
  install -m 0555 "$tracker_dir/bin/$name" "$stage/bin/$name"
done
for name in "${unit_files[@]}"; do
  install -m 0444 "$tracker_dir/systemd/$name" "$stage/systemd/$name"
done
install -m 0444 "$tracker_dir/tmpfiles.d/creator-tracker.conf" \
  "$stage/tmpfiles.d/creator-tracker.conf"

manifest_tmp="$(mktemp "$output_parent/.manifest.XXXXXX")"
(
  cd -- "$stage"
  find . -xdev -type f -printf '%P\0' | LC_ALL=C sort -z | \
    xargs -0 -r sha256sum --
) >"$manifest_tmp"
install -m 0444 "$manifest_tmp" "$stage/TOOLS_MANIFEST.sha256"
unlink "$manifest_tmp"
tools_id="$(sha256sum -- "$stage/TOOLS_MANIFEST.sha256" | awk '{print $1}')"
[[ "$tools_id" =~ ^[0-9a-f]{64}$ ]] || fail 'could not derive release-tools identity'
target="$output_parent/$tools_id"
[[ ! -e "$target" && ! -L "$target" ]] || fail 'release-tools output ID already exists'
find "$stage" -xdev -type d -exec chmod 0555 {} +
mv -T -- "$stage" "$target"
stage=''
trap - EXIT

printf 'release_tools_id=%s\n' "$tools_id"
printf 'prepared_path=%s\n' "$target"
