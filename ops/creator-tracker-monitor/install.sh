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

health_root='/var/lib/creator-tracker-autopilot-health'
health_file="$health_root/status.json"
if [[ -L "$health_root" ]]; then
  printf '%s\n' 'creator-tracker-monitor: sanitized autopilot health directory is a symlink' >&2
  exit 1
fi
if [[ ! -e "$health_root" ]]; then
  install -d -o root -g creator-tracker-health -m 0750 "$health_root"
fi
[[ ! -L "$health_root" && -d "$health_root" && \
   "$(stat -c '%U:%G:%a' -- "$health_root")" == 'root:creator-tracker-health:750' ]] || {
  printf '%s\n' 'creator-tracker-monitor: sanitized autopilot health directory is unsafe or missing' >&2
  exit 1
}
systemctl is-enabled --quiet creator-tracker-autopilot.timer || {
  printf '%s\n' 'creator-tracker-monitor: autopilot timer is not enabled' >&2
  exit 1
}
systemctl is-active --quiet creator-tracker-autopilot.timer || {
  printf '%s\n' 'creator-tracker-monitor: autopilot timer is not active' >&2
  exit 1
}

systemctl stop creator-tracker-monitor.timer creator-tracker-monitor.service \
  >/dev/null 2>&1 || true
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
systemctl start creator-tracker-autopilot.service || true
[[ ! -L "$health_file" && -f "$health_file" && \
   "$(stat -c '%U:%G:%a:%h' -- "$health_file")" == 'root:creator-tracker-health:640:1' ]] || {
  printf '%s\n' 'creator-tracker-monitor: sanitized autopilot health export is unsafe or missing' >&2
  exit 1
}
/usr/sbin/runuser -u creator-tracker-health -- /usr/bin/python3 -I - "$health_file" <<'PY'
import json
import pathlib
import sys
import time

value = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))
allowed_reasons = {
    "autopilot_incident_confirmed",
    "autopilot_incident_pending",
    "autopilot_integrity_failure",
    "autopilot_maintenance",
    "autopilot_operator_required",
}
assert isinstance(value, dict)
assert set(value) == {"format_version", "observed_at_epoch", "health", "reason_codes"}
assert value["format_version"] == 1 and not isinstance(value["format_version"], bool)
observed = value["observed_at_epoch"]
assert isinstance(observed, int) and not isinstance(observed, bool)
assert int(time.time()) - 900 < observed <= int(time.time()) + 60
assert value["health"] in {"healthy", "degraded", "failing"}
reasons = value["reason_codes"]
assert isinstance(reasons, list) and len(reasons) <= 1
assert len(reasons) == len(set(reasons))
assert all(reason in allowed_reasons for reason in reasons)
assert (value["health"] == "healthy") == (reasons == [])
PY
systemctl enable --now creator-tracker-monitor.timer
