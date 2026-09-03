#!/bin/bash -p
set -euo pipefail

export PATH=/usr/sbin:/usr/bin:/sbin:/bin
unset NODE_OPTIONS NODE_PATH LD_PRELOAD LD_LIBRARY_PATH LD_AUDIT BASH_ENV ENV || true

[[ $# == 1 && "$1" == --secret-file=* ]] || {
  printf '%s\n' 'usage: install.sh --secret-file=ABSOLUTE_PATH' >&2
  exit 64
}
secret_file="${1#--secret-file=}"
[[ "$secret_file" == /* && -f "$secret_file" && ! -L "$secret_file" ]] || {
  printf '%s\n' 'creator-tracker-monitor: secret file is unsafe' >&2
  exit 1
}

if ((EUID != 0)); then
  exec sudo -n /usr/bin/env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin \
    /bin/bash --noprofile --norc -p -- "$(readlink -f -- "${BASH_SOURCE[0]}")" "$@"
fi

source_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
getent group creator-tracker-health >/dev/null || {
  printf '%s\n' 'creator-tracker-monitor: creator-tracker-health group is missing' >&2
  exit 1
}
getent passwd creator-tracker-health >/dev/null || {
  printf '%s\n' 'creator-tracker-monitor: creator-tracker-health user is missing' >&2
  exit 1
}

install -d -o root -g root -m 0755 /opt/creator-tracker-monitor
install -o root -g root -m 0555 "$source_dir/reporter.mjs" \
  /opt/creator-tracker-monitor/reporter.mjs
install -d -o root -g root -m 0700 /etc/creator-tracker-monitor
install -o root -g root -m 0400 "$secret_file" \
  /etc/creator-tracker-monitor/monitor-secret
install -o root -g root -m 0644 "$source_dir/creator-tracker-monitor.service" \
  /etc/systemd/system/creator-tracker-monitor.service
install -o root -g root -m 0644 "$source_dir/creator-tracker-monitor.timer" \
  /etc/systemd/system/creator-tracker-monitor.timer
systemctl daemon-reload
systemctl enable --now creator-tracker-monitor.timer
