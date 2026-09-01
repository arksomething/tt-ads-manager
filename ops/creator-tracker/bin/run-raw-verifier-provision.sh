#!/bin/bash -p
set -euo pipefail

export PATH='/usr/sbin:/usr/bin:/sbin:/bin'
unset NODE_OPTIONS NODE_PATH LD_PRELOAD LD_LIBRARY_PATH LD_AUDIT BASH_ENV ENV || true

fail() {
  printf 'creator-tracker raw verifier provision: %s\n' "$*" >&2
  exit 1
}

canonical_self="$(readlink -f -- "${BASH_SOURCE[0]}")"
[[ "$canonical_self" =~ ^/opt/creator-tracker/releases/[0-9a-f]{64}/bin/run-raw-verifier-provision$ ]] || \
  fail 'runner must execute from a sealed versioned release'
readonly release="${canonical_self%/bin/run-raw-verifier-provision}"
readonly release_id="${release##*/}"
read -r self_uid self_gid self_mode self_links < <(stat -c '%u %g %a %h' -- "$canonical_self")
[[ "$self_uid" == 0 && "$self_gid" == 0 && "$self_links" == 1 && \
   $((8#$self_mode & 8#022)) == 0 ]] || fail 'runner is not root-controlled'
(($# == 0)) || fail 'runner accepts no arguments'

if ((EUID != 0)); then
  exec sudo -n /usr/bin/env -i -- PATH=/usr/sbin:/usr/bin:/sbin:/bin \
    LANG=C.UTF-8 LC_ALL=C.UTF-8 \
    /bin/bash --noprofile --norc -p -- "$canonical_self"
fi

readonly owner_uid=1000
readonly owner_gid=1000
readonly admin_env='/home/ark296/projects/tt-ads-manager/web/.env'
readonly pending_dir='/home/ark296/.config/creator-tracker/pending'
readonly canonical_env="$pending_dir/canonical-ingestion.env"
readonly raw_env="$pending_dir/raw-verifier.env"
readonly raw_staging="$pending_dir/.raw-verifier.env.provisioning"
readonly activation_marker='/opt/creator-tracker/ACTIVATION_IN_PROGRESS'

"$release/bin/verify-release" --installed "$release" "$release_id" >/dev/null || \
  fail 'candidate release failed sealed verification'
[[ ! -e "$activation_marker" && ! -L "$activation_marker" ]] || \
  fail 'activation recovery must finish before credential provisioning'
[[ "$(id -u ark296)" == "$owner_uid" && "$(id -g ark296)" == "$owner_gid" ]] || \
  fail 'owner identity does not match the pinned provisioning identity'
for private_input in "$admin_env" "$canonical_env"; do
  [[ ! -L "$private_input" && -f "$private_input" && \
     "$(stat -c '%u %g %a %h' -- "$private_input")" == \
       "$owner_uid $owner_gid 600 1" ]] || \
    fail "private provisioning input is missing or unsafe: $private_input"
done
[[ ! -L "$pending_dir" && -d "$pending_dir" && \
   "$(stat -c '%u %g %a' -- "$pending_dir")" == \
     "$owner_uid $owner_gid 700" ]] || \
  fail 'pending credential directory is missing or unsafe'
for output in "$raw_env" "$raw_staging"; do
  if [[ -e "$output" || -L "$output" ]]; then
    [[ ! -L "$output" && -f "$output" && \
       "$(stat -c '%u %g %a %h' -- "$output")" == \
         "$owner_uid $owner_gid 600 1" ]] || \
      fail "existing provisioning output is unsafe: $output"
  fi
done

unit="creator-tracker-raw-verifier-provision-${release_id:0:12}-$$"
systemd-run --quiet --wait --pipe --collect --unit="$unit" \
  --property=Type=oneshot \
  --property=User=ark296 \
  --property=Group=ark296 \
  --property="WorkingDirectory=$release/app" \
  --property=Environment=PATH=/usr/bin:/bin \
  --property=UnsetEnvironment='LD_PRELOAD LD_LIBRARY_PATH LD_AUDIT BASH_ENV ENV SHELLOPTS BASHOPTS BASH_LOADABLES_PATH NODE_OPTIONS NODE_PATH PYTHONPATH PYTHONHOME PYTHONSTARTUP PERL5OPT PERL5LIB RUBYOPT RUBYLIB GCONV_PATH TSX_TSCONFIG_PATH' \
  --property=TimeoutStartSec=5min \
  --property=UMask=0077 \
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
  --property=BindReadOnlyPaths="/run/systemd/resolve $admin_env $canonical_env" \
  --property=BindPaths="$pending_dir" \
  --property="ReadOnlyPaths=$admin_env $canonical_env" \
  --property=InaccessiblePaths='-/usr/bin/sudo -/bin/su -/usr/bin/su -/usr/sbin/runuser -/home/ark296/.ssh -/home/ark296/.aws -/home/ark296/.config/gcloud -/etc/creator-tracker /var/lib/creator-tracker' \
  -- \
  "$release/runtime/node" --import tsx \
    "$release/app/scripts/provision-raw-evidence-verifier.ts"

[[ ! -L "$raw_env" && -f "$raw_env" && \
   "$(stat -c '%u %g %a %h' -- "$raw_env")" == \
     "$owner_uid $owner_gid 600 1" ]] || \
  fail 'provisioner did not leave an exact owner-private credential'
printf 'creator-tracker raw verifier credential provisioned: %s\n' "$raw_env"
