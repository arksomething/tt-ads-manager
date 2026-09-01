#!/bin/bash -p
set -euo pipefail

export PATH='/usr/sbin:/usr/bin:/sbin:/bin'
unset NODE_OPTIONS NODE_PATH LD_PRELOAD LD_LIBRARY_PATH LD_AUDIT BASH_ENV ENV || true

fail() {
  printf 'creator-tracker Instagram credit rearm: %s\n' "$*" >&2
  exit 1
}

usage() {
  printf '%s\n' \
    'usage: run-instagram-credit-rearm --handle=INSTAGRAM_HANDLE --confirm-provider-launch-balance-at-least-1250 --confirm-provider-top-up-one-request' >&2
  exit 64
}

canonical_self="$(readlink -f -- "${BASH_SOURCE[0]}")"
[[ "$canonical_self" =~ ^/opt/creator-tracker/releases/[0-9a-f]{64}/bin/run-instagram-credit-rearm$ ]] || \
  fail 'runner must execute from a sealed versioned release'
release="${canonical_self%/bin/run-instagram-credit-rearm}"
release_id="${release##*/}"
read -r self_uid self_gid self_mode self_links < <(stat -c '%u %g %a %h' -- "$canonical_self")
[[ "$self_uid" == 0 && "$self_gid" == 0 && "$self_links" == 1 && \
   $((8#$self_mode & 8#022)) == 0 ]] || fail 'runner is not root-controlled'

if (($# != 3)) ||
   [[ ! "$1" =~ ^--handle=[A-Za-z0-9._]{1,30}$ ]] ||
   [[ "$2" != --confirm-provider-launch-balance-at-least-1250 ]] ||
   [[ "$3" != --confirm-provider-top-up-one-request ]]; then
  usage
fi
readonly handle_argument="$1"
readonly launch_confirmation="$2"
readonly request_confirmation="$3"

if ((EUID != 0)); then
  exec sudo -n /usr/bin/env -i -- PATH=/usr/sbin:/usr/bin:/sbin:/bin \
    LANG=C.UTF-8 LC_ALL=C.UTF-8 \
    /bin/bash --noprofile --norc -p -- "$canonical_self" \
      "$handle_argument" "$launch_confirmation" "$request_confirmation"
fi

readonly selector='/opt/creator-tracker/current'
readonly activation_marker='/opt/creator-tracker/ACTIVATION_IN_PROGRESS'
readonly activation_lock='/opt/creator-tracker/activation.lock'
readonly lock_dir='/run/creator-tracker/locks'
readonly rearm_lock="$lock_dir/instagram-credit-rearm.lock"
readonly writer_lock="$lock_dir/owned-tracker-writer.lock"
readonly credential='/etc/creator-tracker/credentials/instagram-credit-rearm.env'
readonly state_root='/var/lib/creator-tracker/state'
readonly state_dir="$state_root/instagram-credit-rearm"
readonly database="$state_root/gotall-viral.db"
readonly raw_evidence='/var/lib/creator-tracker/raw-evidence-v1'
readonly verified_raw_evidence='/var/lib/creator-tracker/verified-raw-evidence-v1'
readonly cutover_success="$state_root/cutover-completeness/success"
readonly discovery_service='creator-tracker-instagram-discovery.service'
readonly discovery_timer='creator-tracker-instagram-discovery.timer'
readonly scheduler_service='creator-tracker-instagram-scheduler.service'
readonly scheduler_timer='creator-tracker-instagram-scheduler.timer'

[[ -L "$selector" && "$(readlink -f -- "$selector")" == "$release" ]] || \
  fail 'runner release is not the current sealed release'
[[ ! -e "$activation_marker" ]] || \
  fail 'activation recovery must complete before Instagram credit rearm'
"$release/bin/verify-release" --installed "$release" "$release_id" >/dev/null || \
  fail 'current release failed its sealed inventory verification'
[[ ! -L "$credential" && -f "$credential" && \
   "$(stat -c '%u %g %a %h' -- "$credential")" == '0 0 400 1' ]] || \
  fail 'Instagram credit rearm credential is missing or unsafe'
[[ ! -L "$database" && -f "$database" && \
   "$(stat -c '%G %a %h' -- "$database")" == 'creator-tracker-writer 660 1' ]] || \
  fail 'sealed runtime database is missing or unsafe'
[[ ! -L "$state_dir" && -d "$state_dir" && \
   "$(stat -c '%U %G %a' -- "$state_dir")" == \
     'creator-tracker-writer creator-tracker-health 2750' ]] || \
  fail 'Instagram credit rearm state directory is missing or unsafe'
[[ ! -L "$raw_evidence" && -d "$raw_evidence" && \
   "$(stat -c '%U %G %a' -- "$raw_evidence")" == \
     'creator-tracker-writer creator-tracker-raw-evidence 2750' ]] || \
  fail 'raw evidence store is missing or unsafe'
[[ ! -L "$verified_raw_evidence" && -d "$verified_raw_evidence" ]] || \
  fail 'verified raw evidence boundary is missing or unsafe'
[[ ! -L "$activation_lock" && -f "$activation_lock" && \
   "$(stat -c '%u %g %a %h' -- "$activation_lock")" == '0 0 600 1' ]] || \
  fail 'activation lock is missing or unsafe'
for lock_path in "$rearm_lock" "$writer_lock"; do
  [[ ! -L "$lock_path" && -f "$lock_path" && \
     "$(stat -c '%u %g %a %h' -- "$lock_path")" == '0 0 660 1' ]] || \
    fail "runtime lock is missing or unsafe: $lock_path"
done

[[ ! -L "$cutover_success" && -f "$cutover_success" && \
   "$(stat -c '%U %G %a %h' -- "$cutover_success")" == \
     'root creator-tracker-health 440 1' ]] || \
  fail 'the production cutover gate has not completed safely'
grep -Fqx 'format_version=2' "$cutover_success" || \
  fail 'the production cutover marker has an unsupported format'
grep -Fqx 'status=complete' "$cutover_success" || \
  fail 'the production cutover gate is not complete'
[[ "$(awk -F= '$1 == "release_id" { print substr($0, index($0, "=") + 1); found++ } END { if (found != 1) exit 1 }' "$cutover_success")" == \
   "$release_id" ]] || fail 'the production cutover marker belongs to another release'

for unit in "$discovery_service" "$discovery_timer" \
  "$scheduler_service" "$scheduler_timer"; do
  [[ ! -L "/etc/systemd/system/$unit" && -f "/etc/systemd/system/$unit" && \
     "$(stat -c '%u %g %a %h' -- "/etc/systemd/system/$unit")" == \
       '0 0 644 1' ]] || \
    fail "installed Instagram unit is missing or unsafe: $unit"
  cmp -s -- "$release/systemd/$unit" "/etc/systemd/system/$unit" || \
    fail "installed Instagram unit differs from the sealed release: $unit"
done

exec {activation_fd}<>"$activation_lock"
/usr/bin/flock -n "$activation_fd" || fail 'an activation operation is already running'

started_epoch="$(date +%s)"
unit="creator-tracker-instagram-credit-rearm-${release_id:0:12}-$$"
systemd-run --quiet --wait --pipe --collect --unit="$unit" \
  --property=Type=oneshot \
  --property=User=creator-tracker-writer \
  --property=Group=creator-tracker-writer \
  --property=Slice=creator-tracker.slice \
  --property="WorkingDirectory=$release/app" \
  --property=Environment=PATH=/usr/bin:/bin \
  --property=UnsetEnvironment='LD_PRELOAD LD_LIBRARY_PATH LD_AUDIT BASH_ENV ENV SHELLOPTS BASHOPTS BASH_LOADABLES_PATH NODE_OPTIONS NODE_PATH PYTHONPATH PYTHONHOME PYTHONSTARTUP PERL5OPT PERL5LIB RUBYOPT RUBYLIB GCONV_PATH TSX_TSCONFIG_PATH CREATOR_TRACKER_RUNTIME_DIR CREATOR_TRACKER_STATE_DIR CREATOR_TRACKER_TEST_ONLY_ALLOW_ARBITRARY_COMMAND CREATOR_TRACKER_TEST_ONLY_SKIP_COVERAGE' \
  --property="LoadCredential=role-env:$credential" \
  --property=TimeoutStartSec=5min \
  --property=Restart=no \
  --property=UMask=0027 \
  --property=NoNewPrivileges=yes \
  --property=CapabilityBoundingSet= \
  --property=AmbientCapabilities= \
  --property=PrivateDevices=yes \
  --property=PrivateTmp=yes \
  --property=PrivateIPC=yes \
  --property=PrivateMounts=yes \
  --property=ProtectHome=tmpfs \
  --property=ProtectClock=yes \
  --property=ProtectControlGroups=yes \
  --property=ProtectHostname=yes \
  --property=ProtectKernelLogs=yes \
  --property=ProtectKernelModules=yes \
  --property=ProtectKernelTunables=yes \
  --property=ProtectSystem=strict \
  --property=TemporaryFileSystem=/run:ro \
  --property="BindPaths=$lock_dir" \
  --property="BindPaths=$state_dir" \
  --property="BindPaths=$state_root" \
  --property="BindPaths=$raw_evidence" \
  --property=BindReadOnlyPaths=/run/systemd/resolve \
  --property="InaccessiblePaths=/etc/creator-tracker /var/lib/creator-tracker/imports $verified_raw_evidence" \
  --property=ProtectProc=invisible \
  --property=ProcSubset=pid \
  --property=RestrictNamespaces=yes \
  --property='RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6' \
  --property=SystemCallArchitectures=native \
  --property=KeyringMode=private \
  --property=RemoveIPC=yes \
  --property=RestrictRealtime=yes \
  --property=RestrictSUIDSGID=yes \
  --property=LockPersonality=yes \
  -- \
  /bin/bash --noprofile --norc -p -- "$release/bin/run-contained-job" \
    instagram-credit-rearm \
    "$handle_argument" "$launch_confirmation" "$request_confirmation"

readonly success_marker="$state_dir/success"
[[ ! -L "$success_marker" && -f "$success_marker" && \
   "$(stat -c '%U %G %a %h' -- "$success_marker")" == \
     'creator-tracker-writer creator-tracker-health 640 1' ]] || \
  fail 'Instagram credit rearm did not publish a safe success marker'
grep -Fqx 'job=instagram-credit-rearm' "$success_marker" || \
  fail 'Instagram credit rearm success marker has the wrong role'
grep -Fqx 'state=succeeded' "$success_marker" || \
  fail 'Instagram credit rearm did not succeed'
grep -Fqx 'exit_code=0' "$success_marker" || \
  fail 'Instagram credit rearm did not exit cleanly'
success_epoch="$(awk -F= '$1 == "at_epoch" { print $2; found++ } END { if (found != 1) exit 1 }' "$success_marker")"
[[ "$success_epoch" =~ ^[0-9]+$ && "$success_epoch" -ge "$started_epoch" ]] || \
  fail 'Instagram credit rearm success marker is stale'

systemctl enable --now "$discovery_timer" "$scheduler_timer"
for unit in "$discovery_timer" "$scheduler_timer"; do
  systemctl is-enabled --quiet "$unit" || fail "Instagram timer was not enabled: $unit"
  systemctl is-active --quiet "$unit" || fail "Instagram timer is not active: $unit"
done

printf '%s\n' \
  'creator-tracker Instagram credit rearm: verified launch capacity and enabled persistent Instagram tracking timers'
