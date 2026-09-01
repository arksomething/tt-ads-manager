#!/bin/bash -p
set -euo pipefail

export PATH='/usr/sbin:/usr/bin:/sbin:/bin'
unset NODE_OPTIONS NODE_PATH LD_PRELOAD LD_LIBRARY_PATH LD_AUDIT BASH_ENV ENV || true

fail() {
  printf 'creator-tracker canonical seed: %s\n' "$*" >&2
  exit 1
}

usage() {
  printf '%s\n' \
    'usage: run-canonical-seed --dry-run --organization-id ORGANIZATION' \
    'usage: run-canonical-seed --apply --organization-id ORGANIZATION --confirm-plan-sha256 SHA256 --confirm-legacy-observations-have-no-raw-evidence' >&2
  exit 64
}

canonical_self="$(readlink -f -- "${BASH_SOURCE[0]}")"
[[ "$canonical_self" =~ ^/opt/creator-tracker/releases/[0-9a-f]{64}/bin/run-canonical-seed$ ]] || \
  fail 'runner must execute from a sealed versioned release'
release="${canonical_self%/bin/run-canonical-seed}"
read -r self_uid self_gid self_mode self_links < <(stat -c '%u %g %a %h' -- "$canonical_self")
[[ "$self_uid" == 0 && "$self_gid" == 0 && "$self_links" == 1 && \
   $((8#$self_mode & 8#022)) == 0 ]] || fail 'runner is not root-controlled'

seed_mode=''
organization_id=''
plan_sha256=''
if (($# == 3)) && [[ "$1" == --dry-run && "$2" == --organization-id ]]; then
  seed_mode=dry-run
  organization_id="$3"
elif (($# == 6)) && [[ "$1" == --apply && "$2" == --organization-id && \
     "$4" == --confirm-plan-sha256 && \
     "$6" == --confirm-legacy-observations-have-no-raw-evidence ]]; then
  seed_mode=apply
  organization_id="$3"
  plan_sha256="$5"
else
  usage
fi
[[ "$organization_id" =~ ^[A-Za-z0-9._:-]{1,128}$ ]] || usage
[[ "$seed_mode" == dry-run || "$plan_sha256" =~ ^[0-9a-f]{64}$ ]] || usage

if ((EUID != 0)); then
  privilege_args=("--$seed_mode" --organization-id "$organization_id")
  if [[ "$seed_mode" == apply ]]; then
    privilege_args+=(--confirm-plan-sha256 "$plan_sha256" \
      --confirm-legacy-observations-have-no-raw-evidence)
  fi
  exec sudo -n /usr/bin/env -i -- PATH=/usr/sbin:/usr/bin:/sbin:/bin \
    LANG=C.UTF-8 LC_ALL=C.UTF-8 \
    /bin/bash --noprofile --norc -p -- "$canonical_self" \
      "${privilege_args[@]}"
fi

readonly selector='/opt/creator-tracker/current'
readonly marker='/opt/creator-tracker/ACTIVATION_IN_PROGRESS'
readonly activation_lock='/opt/creator-tracker/activation.lock'
readonly writer_lock='/run/creator-tracker/locks/owned-tracker-writer.lock'
readonly credential='/etc/creator-tracker/credentials/canonical-seed.env'
readonly state_dir='/var/lib/creator-tracker/state'
readonly database="$state_dir/gotall-viral.db"

[[ -L "$selector" && "$(readlink -f -- "$selector")" == "$release" ]] || \
  fail 'runner release is not the current sealed release'
[[ ! -e "$marker" ]] || fail 'activation recovery must complete before canonical seed'
[[ ! -L "$credential" && -f "$credential" && \
   "$(stat -c '%u %g %a %h' -- "$credential")" == '0 0 400 1' ]] || \
  fail 'canonical-seed credential is missing or unsafe'
[[ ! -L "$database" && -f "$database" && \
   "$(stat -c '%G %a %h' -- "$database")" == 'creator-tracker-writer 660 1' ]] || \
  fail 'sealed runtime database is missing or unsafe'

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
    fail "managed unit must be inactive during the one-time seed: $unit"
done

[[ ! -L "$activation_lock" && -f "$activation_lock" && \
   "$(stat -c '%u %g %a %h' -- "$activation_lock")" == '0 0 600 1' ]] || \
  fail 'activation lock is missing or unsafe'
[[ ! -L "$writer_lock" && -f "$writer_lock" && \
   "$(stat -c '%u %g %a %h' -- "$writer_lock")" == '0 0 660 1' ]] || \
  fail 'writer lock is missing or unsafe'
exec {activation_fd}<>"$activation_lock"
/usr/bin/flock -n "$activation_fd" || fail 'an activation operation is already running'
exec {writer_fd}<>"$writer_lock"
/usr/bin/flock -n "$writer_fd" || fail 'a database writer is already running'

if [[ "$seed_mode" == dry-run ]]; then
  seed_args=(--dry-run --database-path "$database" \
    --organization-id "$organization_id")
  unit="creator-tracker-canonical-seed-plan-$$"
else
  seed_args=(--apply --database-path "$database" \
    --organization-id "$organization_id" \
    --confirm-plan-sha256 "$plan_sha256" \
    --confirm-legacy-observations-have-no-raw-evidence)
  unit="creator-tracker-canonical-seed-${plan_sha256:0:12}-$$"
fi
systemd-run --quiet --wait --pipe --collect --unit="$unit" \
  --property=Type=oneshot \
  --property=User=creator-tracker-writer \
  --property=Group=creator-tracker-writer \
  --property="WorkingDirectory=$release/app" \
  --property=Environment=PATH=/usr/bin:/bin \
  --property=UnsetEnvironment='LD_PRELOAD LD_LIBRARY_PATH LD_AUDIT BASH_ENV ENV SHELLOPTS BASHOPTS BASH_LOADABLES_PATH NODE_OPTIONS NODE_PATH PYTHONPATH PYTHONHOME PYTHONSTARTUP PERL5OPT PERL5LIB RUBYOPT RUBYLIB GCONV_PATH TSX_TSCONFIG_PATH' \
  --property="LoadCredential=role-env:$credential" \
  --property=TimeoutStartSec=180min \
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
  --property=TemporaryFileSystem=/run:ro \
  --property=InaccessiblePaths='/etc/creator-tracker /var/lib/creator-tracker/imports /var/lib/creator-tracker/raw-evidence-v1 /var/lib/creator-tracker/verified-raw-evidence-v1' \
  --property="BindPaths=$state_dir" \
  --property=BindReadOnlyPaths=/run/systemd/resolve \
  -- \
  "$release/bin/canonical-seed" "${seed_args[@]}"
