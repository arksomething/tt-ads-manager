#!/bin/bash
set -euo pipefail

readonly source_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly service_user='creator-tracker-codex'
readonly verifier_user='creator-tracker-verifier'
readonly health_user='creator-tracker-health'
readonly state_root='/var/lib/creator-tracker-autopilot'
readonly health_root='/var/lib/creator-tracker-autopilot-health'

fail() {
  printf 'installed creator-tracker autopilot verification: %s\n' "$*" >&2
  exit 1
}

verify_service_identity() {
  local user="$1" entry name password uid gid gecos home shell password_state
  entry="$(getent passwd "$user")" || fail "service identity is missing: $user"
  IFS=: read -r name password uid gid gecos home shell <<<"$entry"
  [[ "$name" == "$user" && "$uid" =~ ^[0-9]+$ && "$uid" != 0 && \
     "$home" == /nonexistent && "$shell" == /usr/sbin/nologin ]] || \
    fail "service identity metadata is unsafe: $user"
  [[ "$(id -gn "$user")" == "$user" ]] || \
    fail "service identity primary group is unsafe: $user"
  password_state="$(passwd --status "$user" | awk '{print $2}')"
  [[ "$password_state" == L ]] || fail "service identity password is not locked: $user"
}

verify_service_identity "$service_user"
verify_service_identity "$verifier_user"
verify_service_identity "$health_user"
[[ "$(id -nG "$service_user")" == "$service_user" ]] || \
  fail 'Codex service identity has supplementary groups'
[[ "$(id -nG "$verifier_user")" == "$verifier_user" ]] || \
  fail 'verifier identity has supplementary groups'
[[ "$(id -nG "$health_user")" == "$health_user" ]] || \
  fail 'health identity has supplementary groups'

declare -A installed_files=(
  ["$source_root/bin/creator-tracker-autopilot.py"]='/usr/local/libexec/creator-tracker-autopilot'
  ["$source_root/bin/run-codex-incident.sh"]='/usr/local/libexec/creator-tracker-codex-incident'
  ["$source_root/bin/verify-codex-candidate.sh"]='/usr/local/libexec/creator-tracker-codex-verifier'
  ["$source_root/bin/validate-codex-result.py"]='/usr/local/libexec/creator-tracker-validate-codex-result'
  ["$source_root/PROMPT.md"]='/usr/local/share/creator-tracker-autopilot/PROMPT.md'
  ["$source_root/result.schema.json"]='/usr/local/share/creator-tracker-autopilot/result.schema.json'
  ["$source_root/autopilot.config.toml"]='/usr/local/share/creator-tracker-autopilot/autopilot.config.toml'
  ["$source_root/artifact-manifest.json"]='/usr/local/share/creator-tracker-autopilot/artifact-manifest.json'
  ["$source_root/codex-0.149.0.SHA256SUMS"]='/opt/creator-tracker-autopilot/codex/0.149.0/SHA256SUMS'
  ["$source_root/systemd/creator-tracker-autopilot.service"]='/etc/systemd/system/creator-tracker-autopilot.service'
  ["$source_root/systemd/creator-tracker-autopilot.timer"]='/etc/systemd/system/creator-tracker-autopilot.timer'
  ["$source_root/systemd/creator-tracker-codex-incident.service"]='/etc/systemd/system/creator-tracker-codex-incident.service'
  ["$source_root/systemd/creator-tracker-codex-verifier.service"]='/etc/systemd/system/creator-tracker-codex-verifier.service'
  ["$source_root/tmpfiles.d/creator-tracker-autopilot.conf"]='/etc/tmpfiles.d/creator-tracker-autopilot.conf'
)
for source in "${!installed_files[@]}"; do
  target="${installed_files[$source]}"
  [[ ! -L "$target" && -f "$target" ]] || fail "installed file is missing or unsafe: $target"
  cmp -s -- "$source" "$target" || fail "installed file drifted: $target"
done

declare -A installed_modes=(
  ['/usr/local/libexec/creator-tracker-autopilot']='root:root:555:1'
  ['/usr/local/libexec/creator-tracker-codex-incident']='root:root:555:1'
  ['/usr/local/libexec/creator-tracker-codex-verifier']='root:root:555:1'
  ['/usr/local/libexec/creator-tracker-validate-codex-result']='root:root:555:1'
  ['/usr/local/share/creator-tracker-autopilot/PROMPT.md']='root:root:444:1'
  ['/usr/local/share/creator-tracker-autopilot/result.schema.json']='root:root:444:1'
  ['/usr/local/share/creator-tracker-autopilot/autopilot.config.toml']='root:root:444:1'
  ['/usr/local/share/creator-tracker-autopilot/artifact-manifest.json']='root:root:444:1'
  ["$state_root/codex-home/autopilot.config.toml"]='root:root:444:1'
  ["$state_root/codex-home/auth.json"]="$service_user:$service_user:600:1"
  ['/etc/systemd/system/creator-tracker-autopilot.service']='root:root:644:1'
  ['/etc/systemd/system/creator-tracker-autopilot.timer']='root:root:644:1'
  ['/etc/systemd/system/creator-tracker-codex-incident.service']='root:root:644:1'
  ['/etc/systemd/system/creator-tracker-codex-verifier.service']='root:root:644:1'
  ['/etc/tmpfiles.d/creator-tracker-autopilot.conf']='root:root:644:1'
  ['/opt/creator-tracker-autopilot/codex/0.149.0/codex']='root:root:555:1'
  ['/opt/creator-tracker-autopilot/codex/0.149.0/codex-code-mode-host']='root:root:555:1'
  ['/opt/creator-tracker-autopilot/codex/0.149.0/SHA256SUMS']='root:root:444:1'
  ["$health_root/status.json"]='root:creator-tracker-health:640:1'
)
for target in "${!installed_modes[@]}"; do
  [[ ! -L "$target" && -f "$target" ]] || fail "installed file is missing or unsafe: $target"
  [[ "$(stat -c '%U:%G:%a:%h' -- "$target")" == "${installed_modes[$target]}" ]] || \
    fail "installed file ownership or mode is unsafe: $target"
done
cmp -s -- "$source_root/autopilot.config.toml" "$state_root/codex-home/autopilot.config.toml" || \
  fail 'runtime Codex permission profile drifted'
[[ "$(/opt/creator-tracker-autopilot/codex/0.149.0/codex --version)" == 'codex-cli 0.149.0' ]]
(cd /opt/creator-tracker-autopilot/codex/0.149.0 && sha256sum --status -c SHA256SUMS)

declare -A installed_directories=(
  ["$state_root"]='root:creator-tracker-codex:2750'
  ["$state_root/queue"]='root:root:700'
  ["$state_root/inbox"]='root:creator-tracker-codex:2750'
  ["$state_root/processing"]='creator-tracker-codex:creator-tracker-codex:700'
  ["$state_root/producing"]='creator-tracker-codex:creator-tracker-codex:700'
  ["$state_root/ready"]='root:creator-tracker-codex:770'
  ["$state_root/verification/processing"]='root:root:700'
  ["$state_root/verification/rejected"]='root:root:700'
  ["$state_root/reports"]='root:root:700'
  ['/var/lib/creator-tracker-autopilot-verifier']='root:root:711'
  ["$health_root"]='root:creator-tracker-health:750'
)
for target in "${!installed_directories[@]}"; do
  [[ ! -L "$target" && -d "$target" ]] || fail "runtime directory is missing: $target"
  [[ "$(stat -c '%U:%G:%a' -- "$target")" == "${installed_directories[$target]}" ]] || \
    fail "runtime directory ownership or mode is unsafe: $target"
done

/usr/sbin/runuser -u "$health_user" -- /usr/bin/test -r "$health_root/status.json" || \
  fail 'sanitized health export is not readable by the monitor identity'
python3 -I - "$health_root/status.json" <<'PY'
import json, pathlib, sys
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
assert isinstance(value["observed_at_epoch"], int) and not isinstance(value["observed_at_epoch"], bool)
assert value["observed_at_epoch"] > 0
assert value["health"] in {"healthy", "degraded", "failing"}
assert isinstance(value["reason_codes"], list) and len(value["reason_codes"]) <= 1
assert len(value["reason_codes"]) == len(set(value["reason_codes"]))
assert all(reason in allowed_reasons for reason in value["reason_codes"])
assert (value["health"] == "healthy") == (value["reason_codes"] == [])
PY

python3 -I - /usr/local/libexec/creator-tracker-autopilot <<'PY'
import runpy, sys
namespace = runpy.run_path(sys.argv[1], run_name="installed_autopilot")
ready, detail = namespace["verify_autopilot_artifacts"]()
if not ready:
    raise SystemExit(detail)
PY

if [[ "${VERIFY_AUTOPILOT_TIMER:-1}" == 1 ]]; then
  systemctl is-enabled --quiet creator-tracker-autopilot.timer || fail 'autopilot timer is not enabled'
  systemctl is-active --quiet creator-tracker-autopilot.timer || fail 'autopilot timer is not active'
fi
[[ "$(systemctl show creator-tracker-codex-incident.service -p User --value)" == "$service_user" ]]
[[ "$(systemctl show creator-tracker-codex-incident.service -p NoNewPrivileges --value)" == yes ]]
[[ "$(systemctl show creator-tracker-codex-incident.service -p ProtectSystem --value)" == strict ]]
[[ "$(systemctl show creator-tracker-codex-incident.service -p ProtectHome --value)" == tmpfs ]]
[[ "$(systemctl show creator-tracker-codex-incident.service -p BindReadOnlyPaths --value)" == *'/usr/local/share/creator-tracker-autopilot/autopilot.config.toml:/var/lib/creator-tracker-autopilot/codex-home/autopilot.config.toml'* ]]
[[ -z "$(systemctl show creator-tracker-codex-incident.service -p DropInPaths --value)" ]]
[[ "$(systemctl show creator-tracker-codex-incident.service -p NeedDaemonReload --value)" == no ]]
[[ "$(systemctl show creator-tracker-codex-verifier.service -p User --value)" == root ]]
[[ "$(systemctl show creator-tracker-codex-verifier.service -p NoNewPrivileges --value)" == yes ]]
[[ "$(systemctl show creator-tracker-codex-verifier.service -p ProtectSystem --value)" == strict ]]
[[ "$(systemctl show creator-tracker-codex-verifier.service -p ProtectHome --value)" == yes ]]
[[ "$(systemctl show creator-tracker-codex-verifier.service -p PrivateNetwork --value)" == yes ]]
[[ "$(systemctl show creator-tracker-codex-verifier.service -p AmbientCapabilities --value)" == \
   'cap_setgid cap_setuid' ]]
[[ "$(systemctl show creator-tracker-codex-verifier.service -p TemporaryFileSystem --value)" == \
   *'/run:ro,nosuid,nodev,noexec,size=1M,mode=0755'* ]]
[[ -z "$(systemctl show creator-tracker-codex-verifier.service -p DropInPaths --value)" ]]
[[ "$(systemctl show creator-tracker-codex-verifier.service -p NeedDaemonReload --value)" == no ]]

printf '%s\n' 'installed creator-tracker autopilot verification passed'
