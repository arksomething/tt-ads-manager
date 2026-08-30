#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
tracker_dir="$repo_root/ops/creator-tracker"
wrapper="$tracker_dir/bin/run-contained-job.sh"
health="$tracker_dir/bin/check-dashboard-health.sh"
runtime_installer="$tracker_dir/bin/install-yt-dlp-runtime.sh"

bash -n "$wrapper" "$health" "$runtime_installer"
systemd-analyze --user verify \
  "$tracker_dir"/systemd/*.service \
  "$tracker_dir"/systemd/*.timer \
  "$tracker_dir"/systemd/*.slice

for timer_file in "$tracker_dir"/systemd/creator-tracker-*.timer; do
  grep -Fq 'Persistent=true' "$timer_file"
  grep -Fq '[Install]' "$timer_file"
  grep -Fq 'WantedBy=timers.target' "$timer_file"
done
for service_file in "$tracker_dir"/systemd/creator-tracker-*.service; do
  grep -Fq '%h/.local/libexec/creator-tracker/run-contained-job.sh' \
    "$service_file"
done
for network_service in \
  creator-tracker-roster-refresh.service \
  creator-tracker-scheduler-tick.service \
  creator-tracker-provider-reconcile.service \
  creator-tracker-instagram-discovery.service \
  creator-tracker-instagram-scheduler.service; do
  grep -Fq 'ExecStartPre=/usr/bin/nm-online -q --timeout=60' \
    "$tracker_dir/systemd/$network_service"
done
if rg -q '^(After|Wants)=network-online\.target$' \
  "$tracker_dir"/systemd/creator-tracker-*.service; then
  printf '%s\n' \
    'creator-tracker: user units rely on missing network-online.target' >&2
  exit 1
fi
if grep -Eq \
  '^CREATOR_TRACKER_INSTAGRAM_(DISCOVERY|SCHEDULER)_EXECUTABLE=' \
  "$tracker_dir/creator-tracker.env.example"; then
  printf '%s\n' \
    'creator-tracker: example enables Instagram before credential smoke' >&2
  exit 1
fi

grep -Fq 'instagram-discovery) variable_name=CREATOR_TRACKER_INSTAGRAM_DISCOVERY_EXECUTABLE' \
  "$wrapper"
grep -Fq 'instagram-scheduler) variable_name=CREATOR_TRACKER_INSTAGRAM_SCHEDULER_EXECUTABLE' \
  "$wrapper"
grep -Fq 'roster-refresh|provider-reconcile|instagram-discovery)' "$wrapper"
grep -Fq 'scheduler-tick|instagram-scheduler)' "$wrapper"
grep -Fq 'lock_name=owned-tracker-writer' "$wrapper"
grep -Fq 'lock_wait_seconds=300' "$wrapper"
grep -Fq 'writer_lock_timeout_exit=76' "$wrapper"
grep -Fq 'Restart=on-failure' \
  "$tracker_dir/systemd/creator-tracker-provider-reconcile.service"
grep -Fq 'RestartSec=5min' \
  "$tracker_dir/systemd/creator-tracker-provider-reconcile.service"
grep -Fq 'StartLimitIntervalSec=2h' \
  "$tracker_dir/systemd/creator-tracker-provider-reconcile.service"
grep -Fq 'StartLimitBurst=3' \
  "$tracker_dir/systemd/creator-tracker-provider-reconcile.service"
grep -Fq 'TimeoutStartSec=25min' \
  "$tracker_dir/systemd/creator-tracker-provider-reconcile.service"
grep -Fq 'Restart=always' \
  "$tracker_dir/systemd/creator-tracker-worker.service"
grep -Fq 'OnCalendar=*-*-* *:03,33:00' \
  "$tracker_dir/systemd/creator-tracker-roster-refresh.timer"
grep -Fq '/usr/bin/setsid --wait -- "${command_args[@]}" &' "$wrapper"
grep -Fq 'instagram-discovery.success' "$health"
grep -Fq 'instagram-scheduler.success' "$health"
grep -Fq "readonly ytdlp_version='2026.08.19'" "$runtime_installer"
grep -Fq "readonly ytdlp_sha256='58162f9bfdc27458ea47bfcb311cf47028f17d8154a8bf7d689861d46399230a'" \
  "$runtime_installer"
grep -Fq "readonly ytdlp_sha512='e51e26f77622a1bf75cdaee869698aebe892d4afd105e677118eb8dfbacef9d34933e7b3c0f1091f3f7f94518ac03bb2504e69be85991c31d61e5e8faeb85f37'" \
  "$runtime_installer"
grep -Fq "readonly signing_key_fingerprint='AC0CBBE6848D6A873464AF4E57CF65933B5A7581'" \
  "$runtime_installer"
grep -Fq 'releases/download/${ytdlp_version}/yt-dlp_linux' "$runtime_installer"
grep -Fq 'readonly install_dir="/opt/creator-tracker/yt-dlp/${ytdlp_version}"' \
  "$runtime_installer"
grep -Fq 'readonly install_path="$install_dir/yt-dlp_linux"' "$runtime_installer"
grep -Fq -- "--proto '=https'" "$runtime_installer"
grep -Fq 'sha256sum "$download_path"' "$runtime_installer"
grep -Fq 'sudo -n install -o root -g root -m 0555' "$runtime_installer"
grep -Fq 'sudo -n mv -f -- "$staged_path" "$install_path"' "$runtime_installer"
grep -Fq -- '--list-impersonate-targets' "$runtime_installer"
grep -Fq -- '--verify "$tmp_dir/SHA2-256SUMS.sig"' "$runtime_installer"
grep -Fq -- '--verify "$tmp_dir/SHA2-512SUMS.sig"' "$runtime_installer"

tmp_dir="$(mktemp -d)"
cleanup() {
  if [[ -n "${signal_supervisor_pid:-}" ]]; then
    kill -TERM "$signal_supervisor_pid" 2>/dev/null || true
    wait "$signal_supervisor_pid" 2>/dev/null || true
  fi
  if [[ -n "${server_pid:-}" ]]; then
    kill "$server_pid" 2>/dev/null || true
    wait "$server_pid" 2>/dev/null || true
  fi
  rm -rf -- "$tmp_dir"
}
trap cleanup EXIT

fake_executable="$tmp_dir/succeed"
printf '%s\n' '#!/usr/bin/env bash' 'exit 0' >"$fake_executable"
chmod 0700 "$fake_executable"
blocking_executable="$tmp_dir/block-briefly"
printf '%s\n' \
  '#!/usr/bin/env bash' \
  'printf started >"${FAKE_STARTED_FILE:?}"' \
  'sleep 1' \
  >"$blocking_executable"
chmod 0700 "$blocking_executable"
mkdir -p "$tmp_dir/runtime" "$tmp_dir/state"

env \
  XDG_RUNTIME_DIR="$tmp_dir/runtime" \
  XDG_STATE_HOME="$tmp_dir/state" \
  FAKE_STARTED_FILE="$tmp_dir/discovery-started" \
  CREATOR_TRACKER_HEARTBEAT_INTERVAL_SECONDS=5 \
  CREATOR_TRACKER_INSTAGRAM_DISCOVERY_EXECUTABLE="$blocking_executable" \
  /bin/bash "$wrapper" instagram-discovery &
discovery_pid=$!
for _attempt in {1..50}; do
  [[ -s "$tmp_dir/discovery-started" ]] && break
  sleep 0.02
done
[[ -s "$tmp_dir/discovery-started" ]]
set +e
env \
  XDG_RUNTIME_DIR="$tmp_dir/runtime" \
  XDG_STATE_HOME="$tmp_dir/state" \
  CREATOR_TRACKER_HEARTBEAT_INTERVAL_SECONDS=5 \
  CREATOR_TRACKER_INSTAGRAM_DISCOVERY_EXECUTABLE="$fake_executable" \
  /bin/bash "$wrapper" instagram-discovery
duplicate_exit=$?
set -e
[[ "$duplicate_exit" -eq 75 ]]
grep -Fq 'state=lock_busy' \
  "$tmp_dir/state/creator-tracker/health/instagram-discovery.lock-busy"

set +e
env \
  XDG_RUNTIME_DIR="$tmp_dir/runtime" \
  XDG_STATE_HOME="$tmp_dir/state" \
  CREATOR_TRACKER_HEARTBEAT_INTERVAL_SECONDS=5 \
  CREATOR_TRACKER_INSTAGRAM_SCHEDULER_EXECUTABLE="$fake_executable" \
  /bin/bash "$wrapper" instagram-scheduler
overlap_exit=$?
set -e
[[ "$overlap_exit" -eq 75 ]]
grep -Fq 'state=writer_lock_busy' \
  "$tmp_dir/state/creator-tracker/health/instagram-scheduler.writer-lock-busy"

# A low-frequency writer waits for the same database lock instead of losing its
# entire provider interval to a short scheduler/discovery overlap.
env \
  XDG_RUNTIME_DIR="$tmp_dir/runtime" \
  XDG_STATE_HOME="$tmp_dir/state" \
  CREATOR_TRACKER_HEARTBEAT_INTERVAL_SECONDS=5 \
  CREATOR_TRACKER_PROVIDER_EXECUTABLE="$fake_executable" \
  /bin/bash "$wrapper" provider-reconcile
wait "$discovery_pid"
env \
  XDG_RUNTIME_DIR="$tmp_dir/runtime" \
  XDG_STATE_HOME="$tmp_dir/state" \
  CREATOR_TRACKER_HEARTBEAT_INTERVAL_SECONDS=5 \
  CREATOR_TRACKER_INSTAGRAM_SCHEDULER_EXECUTABLE="$fake_executable" \
  /bin/bash "$wrapper" instagram-scheduler

grep -Fq 'job=instagram-discovery' \
  "$tmp_dir/state/creator-tracker/health/instagram-discovery.success"
grep -Fq 'state=succeeded' \
  "$tmp_dir/state/creator-tracker/health/instagram-discovery.success"
grep -Fq 'state=succeeded' \
  "$tmp_dir/state/creator-tracker/health/provider-reconcile.success"
grep -Fq 'job=instagram-scheduler' \
  "$tmp_dir/state/creator-tracker/health/instagram-scheduler.success"
grep -Fq 'state=succeeded' \
  "$tmp_dir/state/creator-tracker/health/instagram-scheduler.success"

process_tree_executable="$tmp_dir/process-tree"
printf '%s\n' \
  '#!/usr/bin/env bash' \
  'sleep 300 &' \
  'grandchild_pid=$!' \
  'printf "%s %s\n" "$$" "$grandchild_pid" >"${FAKE_PROCESS_TREE_FILE:?}"' \
  'wait "$grandchild_pid"' \
  >"$process_tree_executable"
chmod 0700 "$process_tree_executable"
env \
  XDG_RUNTIME_DIR="$tmp_dir/runtime" \
  XDG_STATE_HOME="$tmp_dir/state" \
  FAKE_PROCESS_TREE_FILE="$tmp_dir/process-tree.pids" \
  CREATOR_TRACKER_HEARTBEAT_INTERVAL_SECONDS=5 \
  /bin/bash "$wrapper" signal-test -- "$process_tree_executable" &
signal_supervisor_pid=$!
for _attempt in {1..50}; do
  [[ -s "$tmp_dir/process-tree.pids" ]] && break
  sleep 0.02
done
[[ -s "$tmp_dir/process-tree.pids" ]]
read -r managed_pid descendant_pid <"$tmp_dir/process-tree.pids"
kill -TERM "$signal_supervisor_pid"
set +e
wait "$signal_supervisor_pid"
signal_exit=$?
set -e
signal_supervisor_pid=''
[[ "$signal_exit" -ne 0 ]]
for stopped_pid in "$managed_pid" "$descendant_pid"; do
  if kill -0 "$stopped_pid" 2>/dev/null; then
    printf 'creator-tracker: process %s survived the supervisor signal\n' \
      "$stopped_pid" >&2
    exit 1
  fi
done
grep -Fq 'state=stopped' \
  "$tmp_dir/state/creator-tracker/health/signal-test.status"

port_file="$tmp_dir/http-port"
node -e '
  const fs = require("node:fs");
  const http = require("node:http");
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/plain" });
    response.end("ok");
  });
  server.listen(0, "127.0.0.1", () => {
    fs.writeFileSync(process.argv[1], String(server.address().port));
  });
' "$port_file" &
server_pid=$!
for _attempt in {1..50}; do
  [[ -s "$port_file" ]] && break
  sleep 0.05
done
[[ -s "$port_file" ]]
http_port="$(<"$port_file")"
now_epoch="$(date +%s)"
health_dir="$tmp_dir/state/creator-tracker/health"

printf 'state=running\nupdated_at_epoch=%s\n' "$now_epoch" \
  >"$health_dir/collector-worker.status"
for marker in scheduler-tick roster-refresh instagram-discovery instagram-scheduler; do
  printf 'state=succeeded\nat_epoch=%s\n' "$now_epoch" \
    >"$health_dir/$marker.success"
done

env \
  XDG_STATE_HOME="$tmp_dir/state" \
  CREATOR_TRACKER_DASHBOARD_HEALTH_URL="http://127.0.0.1:$http_port/health" \
  CREATOR_TRACKER_INSTAGRAM_DISCOVERY_EXECUTABLE=/bin/true \
  CREATOR_TRACKER_INSTAGRAM_SCHEDULER_EXECUTABLE=/bin/true \
  /bin/bash "$health" >/dev/null

mv "$health_dir/instagram-discovery.success" \
  "$health_dir/instagram-discovery.success.disabled"
if env \
  XDG_STATE_HOME="$tmp_dir/state" \
  CREATOR_TRACKER_DASHBOARD_HEALTH_URL="http://127.0.0.1:$http_port/health" \
  CREATOR_TRACKER_INSTAGRAM_DISCOVERY_EXECUTABLE=/bin/true \
  CREATOR_TRACKER_INSTAGRAM_SCHEDULER_EXECUTABLE=/bin/true \
  /bin/bash "$health" >"$tmp_dir/unhealthy.out" 2>&1; then
  printf '%s\n' 'health probe accepted a missing Instagram discovery marker' >&2
  exit 1
fi
grep -Fq 'missing instagram-discovery-success marker' "$tmp_dir/unhealthy.out"

printf '%s\n' 'creator-tracker ops verification: ok'
