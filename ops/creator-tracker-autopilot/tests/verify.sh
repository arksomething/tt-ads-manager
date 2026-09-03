#!/bin/bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
python="$root/bin/creator-tracker-autopilot.py"
runner="$root/bin/run-codex-incident.sh"
verifier="$root/bin/verify-codex-candidate.sh"
validator="$root/bin/validate-codex-result.py"

python3 -I "$root/tests/test_autopilot.py" -v
python3 -I "$root/tests/test_result_schema.py" -v
python3 -I - "$python" "$validator" <<'PY'
import pathlib, sys
for source in sys.argv[1:]:
    compile(pathlib.Path(source).read_bytes(), source, "exec")
PY
bash -n "$runner"
bash -n "$verifier"
bash -n "$root/tests/verify-installed.sh"
python3 -I -m json.tool "$root/result.schema.json" >/dev/null
python3 -I -m json.tool "$root/artifact-manifest.json" >/dev/null
test -s "$root/autopilot.config.toml"
systemd-analyze verify "$root/systemd/creator-tracker-autopilot.service" \
  "$root/systemd/creator-tracker-autopilot.timer" \
  "$root/systemd/creator-tracker-codex-incident.service" \
  "$root/systemd/creator-tracker-codex-verifier.service"

grep -Fq 'Persistent=true' "$root/systemd/creator-tracker-autopilot.timer"
grep -Fq 'NoNewPrivileges=true' "$root/systemd/creator-tracker-codex-incident.service"
grep -Fq 'ProtectSystem=strict' "$root/systemd/creator-tracker-codex-incident.service"
grep -Fq 'ProtectHome=tmpfs' "$root/systemd/creator-tracker-codex-incident.service"
grep -Fq 'MemoryMax=4G' "$root/systemd/creator-tracker-codex-incident.service"
grep -Fq 'size=2G' "$root/systemd/creator-tracker-codex-incident.service"
grep -Fq 'LimitFSIZE=512M' "$root/systemd/creator-tracker-codex-incident.service"
grep -Fq 'PrivateNetwork=true' "$root/systemd/creator-tracker-codex-verifier.service"
grep -Fq 'ProtectSystem=strict' "$root/systemd/creator-tracker-codex-verifier.service"
grep -Fq 'ReadWritePaths=/var/lib/creator-tracker-autopilot ' "$root/systemd/creator-tracker-codex-verifier.service"
! grep -F 'ReadWritePaths=' "$root/systemd/creator-tracker-codex-verifier.service" | \
  grep -Fq '/run/'
grep -Fq 'TemporaryFileSystem=/run:ro,nosuid,nodev,noexec,size=1M,mode=0755' \
  "$root/systemd/creator-tracker-codex-verifier.service"
grep -Fq 'InaccessiblePaths=-/var/lib/creator-tracker-autopilot/state.json' "$root/systemd/creator-tracker-codex-verifier.service"
grep -Fq 'MemoryMax=4G' "$root/systemd/creator-tracker-codex-verifier.service"
grep -Fq 'size=2G' "$root/systemd/creator-tracker-codex-verifier.service"
grep -Fq 'User=root' "$root/systemd/creator-tracker-codex-verifier.service"
grep -Fq 'AmbientCapabilities=CAP_SETGID CAP_SETUID' \
  "$root/systemd/creator-tracker-codex-verifier.service"
grep -Fq -- '--ignore-user-config' "$runner"
grep -Fq -- '--ignore-rules' "$runner"
grep -Fq -- '--ephemeral' "$runner"
grep -Fq -- '--profile autopilot' "$runner"
grep -Fq -- '"$codex_bin" -a never exec' "$runner"
grep -Fq 'default_permissions = "creator-tracker-workspace"' "$root/autopilot.config.toml"
grep -Fq '":root" = "deny"' "$root/autopilot.config.toml"
grep -Fq 'enabled = false' "$root/autopilot.config.toml"
grep -Fq '".git" = "read"' "$root/autopilot.config.toml"
grep -Fq 'apps = false' "$root/autopilot.config.toml"
grep -Fq 'plugins = false' "$root/autopilot.config.toml"
grep -Fq 'code_mode_host = true' "$root/autopilot.config.toml"
grep -Fq 'BindReadOnlyPaths=' "$root/systemd/creator-tracker-codex-incident.service"
grep -Fq 'candidate altered Git execution configuration' "$runner"
grep -Fq -- '"$release/app/node_modules"' "$runner"
grep -Fq -- 'creator-tracker-validate-codex-result' "$runner"
grep -Fq -- 'diff --no-renames --binary' "$runner"
grep -Fq "readonly code_mode_host='/opt/creator-tracker-autopilot/codex/0.149.0/codex-code-mode-host'" "$runner"
grep -Fq 'mktemp -d "$producing_dir/' "$runner"
grep -Fq 'mktemp "$processing_dir/$incident_id.processing.XXXXXX"' "$runner"
grep -Fq 'mv -T -- "$target_dir" "$published"' "$runner"
if grep -Eq -- '--sandbox|sandbox_workspace_write|danger-full-access' "$runner"; then
  printf '%s\n' 'Codex runner mixes legacy sandbox flags with the permission profile' >&2
  exit 1
fi
if grep -Fq '/home/ark296/projects/' "$runner"; then
  printf '%s\n' 'Codex runner exposes a mutable development repository' >&2
  exit 1
fi
if grep -Eq -- '--dangerously-bypass|--approve-for-me|sudo|systemctl' "$runner"; then
  printf '%s\n' 'Codex runner contains a forbidden privilege or approval escape' >&2
  exit 1
fi
grep -Fq 'provider_credit_rearm_allowed": False' "$python"
grep -Fq 'production_database_mutation_allowed": False' "$python"
grep -Fq 'production_deployment_allowed": False' "$python"
if grep -Eq 'enable.*--now|reset-failed|"kind": "kick_job"' "$python"; then
  printf '%s\n' 'Sentinel bypasses timer enablement, service rate limits, or job scheduling' >&2
  exit 1
fi
grep -Fq 'ACTION_COOLDOWN_SECONDS' "$python"
grep -Fq 'cutover_gate_not_ready' "$python"
grep -Fq '2750 root creator-tracker-codex' "$root/tmpfiles.d/creator-tracker-autopilot.conf"
grep -Fq 'd /var/lib/creator-tracker-autopilot-health 0750 root creator-tracker-health -' \
  "$root/tmpfiles.d/creator-tracker-autopilot.conf"
grep -F 'ReadWritePaths=' "$root/systemd/creator-tracker-autopilot.service" | \
  grep -Fq '/var/lib/creator-tracker-autopilot-health'
grep -Fq 'User=creator-tracker-codex' "$root/systemd/creator-tracker-codex-incident.service"
grep -Fq 'creator-tracker-verifier' "$verifier"
grep -Fq 'actual_paths' "$verifier"
grep -Fq 'claimed_path_mismatch' "$verifier"
grep -Fq 'verify-current-cutover' "$verifier"
grep -Fq 'verify-autopilot-artifacts' "$verifier"
grep -Fq '8<&- 9<&-' "$verifier"
grep -Fq 'integration_smoke_test' "$verifier"
grep -Fq 'item.get("type") == "command_execution"' "$verifier"
grep -Fq 'item.get("type") == "error"' "$verifier"
grep -Fq '/var/lib/creator-tracker-autopilot-verifier' "$verifier"
grep -Fq 'chown -hR root:root "$workspace"' "$verifier"
grep -Fq 'find "$workspace" -xdev -type d -exec chmod a+rx,a-w' "$verifier"
grep -Fq -- "--mode='u+rwX' -cf - ." "$verifier"
grep -Fq -- '--delay-directory-restore -xf -' "$verifier"
grep -Fq 'find "$workspace" -xdev -type d -exec chmod u+rwx' "$verifier"
grep -Fq '/usr/bin/test -r "$workspace/package.json"' "$verifier"
grep -Fq 'readonly -a verifier_privdrop=(' "$verifier"
grep -Fq -- '--inh-caps=-all' "$verifier"
grep -Fq -- '--ambient-caps=-all' "$verifier"
grep -Fq -- '--no-new-privs' "$verifier"
[[ "$(grep -Fc '"${verifier_privdrop[@]}"' "$verifier")" -ge 8 ]]
grep -Fq 'verifier privilege drop preflight failed' "$verifier"
grep -Fq 'verifier host runtime namespace is visible' "$verifier"
grep -Fq 'private runtime contains a non-directory endpoint' "$verifier"
grep -Fq 'pathlib.Path("/run/systemd/incoming")' "$verifier"
grep -Fq 'record_verifier_start "$processing_report" 2' "$verifier"
grep -Fq 'verifier attempt limit exhausted; report was quarantined' "$verifier"
grep -Fq 'claimed_path_not_utf8' "$verifier"
grep -Fq "'umask 0022; exec \"\$@\"' verifier-npm" "$verifier"
grep -Fq '/usr/bin/ln -s -- "$release/app/node_modules"' "$verifier"
grep -Fq '/usr/bin/install -d -m 0700' "$verifier"
grep -Fq 'sanitize_processing "$ready_report"' "$verifier"
grep -Fq 'ready_owner="$(stat -c' "$verifier"
grep -Fq 'os.chown(entry, 0, 0, follow_symlinks=False)' "$verifier"
grep -Fq '0770 root creator-tracker-codex' "$root/tmpfiles.d/creator-tracker-autopilot.conf"
grep -Fq 'producing 0700 creator-tracker-codex creator-tracker-codex 2d' "$root/tmpfiles.d/creator-tracker-autopilot.conf"
grep -Fq 'verification/rejected 0700 root root' "$root/tmpfiles.d/creator-tracker-autopilot.conf"
if grep -Eq '^On(Success|Failure)=' "$root/systemd/creator-tracker-codex-incident.service"; then
  printf '%s\n' 'Codex service bypasses the sentinel gate when starting verification' >&2
  exit 1
fi

python3 -I - "$root" <<'PY'
import hashlib, json, pathlib, sys
root = pathlib.Path(sys.argv[1])
mapping = {
    "/usr/local/libexec/creator-tracker-autopilot": root / "bin/creator-tracker-autopilot.py",
    "/usr/local/libexec/creator-tracker-codex-incident": root / "bin/run-codex-incident.sh",
    "/usr/local/libexec/creator-tracker-codex-verifier": root / "bin/verify-codex-candidate.sh",
    "/usr/local/libexec/creator-tracker-validate-codex-result": root / "bin/validate-codex-result.py",
    "/usr/local/share/creator-tracker-autopilot/PROMPT.md": root / "PROMPT.md",
    "/usr/local/share/creator-tracker-autopilot/result.schema.json": root / "result.schema.json",
    "/usr/local/share/creator-tracker-autopilot/autopilot.config.toml": root / "autopilot.config.toml",
    "/opt/creator-tracker-autopilot/codex/0.149.0/SHA256SUMS": root / "codex-0.149.0.SHA256SUMS",
    "/etc/systemd/system/creator-tracker-autopilot.service": root / "systemd/creator-tracker-autopilot.service",
    "/etc/systemd/system/creator-tracker-autopilot.timer": root / "systemd/creator-tracker-autopilot.timer",
    "/etc/systemd/system/creator-tracker-codex-incident.service": root / "systemd/creator-tracker-codex-incident.service",
    "/etc/systemd/system/creator-tracker-codex-verifier.service": root / "systemd/creator-tracker-codex-verifier.service",
    "/etc/tmpfiles.d/creator-tracker-autopilot.conf": root / "tmpfiles.d/creator-tracker-autopilot.conf",
}
manifest = json.loads((root / "artifact-manifest.json").read_text(encoding="utf-8"))
assert manifest.get("format_version") == 1
assert set(manifest.get("files", {})) == set(mapping)
for target, source in mapping.items():
    payload = source.read_bytes()
    assert manifest["files"][target] == {
        "sha256": hashlib.sha256(payload).hexdigest(),
        "size": len(payload),
    }, target
PY

printf '%s\n' 'creator-tracker autopilot verification passed'
