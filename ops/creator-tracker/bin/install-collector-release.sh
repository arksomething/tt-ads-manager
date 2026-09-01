#!/bin/bash -p
set -euo pipefail

export PATH='/usr/sbin:/usr/bin:/sbin:/bin'
unset NODE_OPTIONS NODE_PATH LD_PRELOAD LD_LIBRARY_PATH LD_AUDIT BASH_ENV ENV || true

usage() {
  printf '%s\n' \
    'usage: install-collector-release.sh --source-repo ABSOLUTE_PATH --ref GIT_REF [--prepare-only ABSOLUTE_PARENT_DIR]' >&2
  exit 64
}

fail() {
  printf 'creator-tracker release install: %s\n' "$*" >&2
  exit 1
}

source_repo=''
source_ref=''
prepare_only=''
while (($# > 0)); do
  case "$1" in
    --source-repo) (($# >= 2)) || usage; source_repo="$2"; shift 2 ;;
    --ref) (($# >= 2)) || usage; source_ref="$2"; shift 2 ;;
    --prepare-only) (($# >= 2)) || usage; prepare_only="$2"; shift 2 ;;
    *) usage ;;
  esac
done
[[ -n "$source_repo" && -n "$source_ref" && "$source_repo" == /* ]] || usage
[[ -z "$prepare_only" || "$prepare_only" == /* ]] || usage

canonical_installer="$(readlink -f -- "${BASH_SOURCE[0]}")"
[[ "$canonical_installer" =~ ^/opt/creator-tracker/release-tools/[0-9a-f]{64}/bin/install-collector-release\.sh$ ]] || \
  fail 'installer must run from a reviewed root-controlled release-tools bundle'
readonly release_tools_root="${canonical_installer%/bin/install-collector-release.sh}"
readonly release_tools_id="${release_tools_root##*/}"
readonly release_tools_manifest="$release_tools_root/TOOLS_MANIFEST.sha256"
[[ -d "$release_tools_root" && ! -L "$release_tools_root" && \
   "$(stat -c '%u %g' -- "$release_tools_root")" == '0 0' ]] || \
  fail 'release-tools root is not a root-owned real directory'
if find "$release_tools_root" -xdev \( ! -uid 0 -o ! -gid 0 \) -print -quit | grep -q . || \
   find "$release_tools_root" -xdev \( -type d -o -type f \) -perm /022 -print -quit | grep -q . || \
   find "$release_tools_root" -xdev ! -type d ! -type f -print -quit | grep -q . || \
   find "$release_tools_root" -xdev -type f -links +1 -print -quit | grep -q .; then
  fail 'release-tools bundle ownership, mutability, or inventory is unsafe'
fi
[[ ! -L "$release_tools_manifest" && -f "$release_tools_manifest" && \
   "$(stat -c '%u %g %a %h' -- "$release_tools_manifest")" == '0 0 444 1' && \
   "$(sha256sum -- "$release_tools_manifest" | awk '{print $1}')" == \
     "$release_tools_id" ]] || \
  fail 'release-tools manifest is not the exact root-controlled bundle identity'
while IFS= read -r manifest_line; do
  [[ "$manifest_line" =~ ^[0-9a-f]{64}[[:space:]][[:space:]][A-Za-z0-9][A-Za-z0-9._/-]*$ && \
     "$manifest_line" != *'/../'* && "$manifest_line" != *//* ]] || \
    fail 'release-tools manifest contains an unsafe entry'
done <"$release_tools_manifest"
cmp -s \
  <(find "$release_tools_root" -xdev -type f \
      ! -name TOOLS_MANIFEST.sha256 -printf '%P\n' | LC_ALL=C sort) \
  <(awk '{print substr($0,67)}' "$release_tools_manifest" | LC_ALL=C sort) || \
  fail 'release-tools manifest does not exactly cover every bundled file'
(cd -- "$release_tools_root" && \
  sha256sum --check --strict --quiet TOOLS_MANIFEST.sha256) || \
  fail 'release-tools bundle bytes do not match the reviewed manifest'
if ((EUID != 0)); then
  privilege_args=(--source-repo "$source_repo" --ref "$source_ref")
  if [[ -n "$prepare_only" ]]; then
    privilege_args+=(--prepare-only "$prepare_only")
  fi
  exec sudo -n /usr/bin/env -i -- PATH=/usr/sbin:/usr/bin:/sbin:/bin \
    LANG=C.UTF-8 LC_ALL=C.UTF-8 \
    /bin/bash --noprofile --norc -p -- "$canonical_installer" "${privilege_args[@]}"
fi

source_repo="$(realpath -- "$source_repo")"
[[ -d "$source_repo/.git" || -f "$source_repo/.git" ]] || fail 'source path is not a Git worktree'
if [[ -n "$prepare_only" && ! "$prepare_only" =~ ^/var/lib/creator-tracker/prepared(/|$) ]]; then
  fail 'prepare-only output must stay under /var/lib/creator-tracker/prepared'
fi

# The source worktree is intentionally owner-controlled while this installer
# is root. Admit only this exact canonical worktree and suppress replace refs;
# otherwise Git's ownership guard either blocks a correct first install or a
# repository-local replacement could make a reviewed object name ambiguous.
readonly -a source_git=(
  /usr/bin/git -c "safe.directory=$source_repo" --no-replace-objects
  -C "$source_repo"
)
commit="$("${source_git[@]}" rev-parse --verify "${source_ref}^{commit}")" || fail 'Git ref does not resolve to a commit'
[[ "$commit" =~ ^[0-9a-f]{40}([0-9a-f]{24})?$ ]] || fail 'resolved Git commit is not a full object ID'

if ! getent group creator-tracker-builder >/dev/null; then
  groupadd --system creator-tracker-builder
fi
if ! getent passwd creator-tracker-builder >/dev/null; then
  useradd --system --gid creator-tracker-builder --home-dir /nonexistent \
    --no-create-home --shell /usr/sbin/nologin creator-tracker-builder
fi
[[ "$(getent passwd creator-tracker-builder | cut -d: -f6-7)" == \
  '/nonexistent:/usr/sbin/nologin' && \
  "$(id -Gn creator-tracker-builder)" == creator-tracker-builder ]] || \
  fail 'creator-tracker-builder must be an isolated no-login identity'

install -d -o root -g root -m 0751 /var/lib/creator-tracker
install -d -o root -g creator-tracker-builder -m 0710 \
  /var/lib/creator-tracker/build-staging
tmp_dir="$(mktemp -d /var/lib/creator-tracker/build-staging/release.XXXXXX)"
root_stage=''
cleanup() {
  if [[ -n "$root_stage" ]]; then
    rm -rf -- "$root_stage" >/dev/null 2>&1 || true
  fi
  chmod -R u+w -- "$tmp_dir" >/dev/null 2>&1 || true
  rm -rf -- "$tmp_dir"
}
trap cleanup EXIT

# Next loads several compound dotenv names (for example
# .env.production.local). Consume the complete NUL-delimited tree listing so an
# early match can never SIGPIPE git under pipefail and bypass this rejection.
tree_paths="$tmp_dir/git-tree-paths"
"${source_git[@]}" ls-tree -r -z --name-only "$commit" >"$tree_paths" || \
  fail 'could not enumerate the release commit'
live_dotenv_found=0
tracked_npmrc_found=0
while IFS= read -r -d '' tracked_path; do
  tracked_basename="${tracked_path##*/}"
  if [[ "$tracked_basename" == .env || \
        ( "$tracked_basename" == .env.* && "$tracked_basename" != .env.example ) ]]; then
    live_dotenv_found=1
  fi
  [[ "$tracked_basename" != .npmrc ]] || tracked_npmrc_found=1
done <"$tree_paths"
if ((live_dotenv_found != 0)); then
  fail 'Git commit contains a live dotenv file'
fi
if ((tracked_npmrc_found != 0)); then
  fail 'Git commit contains a project npm configuration file'
fi
entry_mode="$("${source_git[@]}" ls-tree "$commit" -- ops/owned-tracker/release-entrypoint | awk '{print $1}')"
[[ "$entry_mode" == 100755 ]] || fail 'commit must contain executable ops/owned-tracker/release-entrypoint'
env_parser_mode="$("${source_git[@]}" ls-tree "$commit" -- ops/owned-tracker/release-env.mjs | awk '{print $1}')"
[[ "$env_parser_mode" == 100644 ]] || \
  fail 'commit must contain non-executable ops/owned-tracker/release-env.mjs'
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
tracker_dir="$(dirname -- "$script_dir")"
verifier="$script_dir/verify-collector-release.sh"
supervisor="$script_dir/run-contained-job.sh"
health_checker="$script_dir/check-dashboard-health.sh"
activator="$script_dir/activate-collector-release.sh"
builder="$script_dir/build-collector-release.sh"
config_renderer="$script_dir/render-collector-config.py"
activation_boundary="$script_dir/activation-boundary.py"
system_state_helper="$script_dir/activation-system-state.py"
user_unit_helper="$script_dir/activation-user-units.py"
durable_state_helper="$script_dir/durable-state.py"
database_helper="$script_dir/activation-database.py"
database_probe="$script_dir/probe-database-access.py"
provider_import_migrator="$script_dir/migrate-provider-imports.py"
canonical_seed_runner="$script_dir/run-canonical-seed.sh"
cutover_runner="$script_dir/run-cutover-completeness.sh"
instagram_credit_rearm_runner="$script_dir/run-instagram-credit-rearm.sh"
raw_verifier_provision_runner="$script_dir/run-raw-verifier-provision.sh"
cutover_result_validator="$script_dir/validate-cutover-result.py"
node_runtime_installer="$script_dir/install-node-runtime.sh"
systemd_dir="$tracker_dir/systemd"
tmpfiles_source="$tracker_dir/tmpfiles.d/creator-tracker.conf"
unit_files=(
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
  creator-tracker.slice
)
[[ -x "$verifier" && -f "$supervisor" && -f "$health_checker" && \
   -x "$activator" && -x "$builder" && -f "$config_renderer" && \
   -f "$activation_boundary" && -f "$system_state_helper" && \
   -f "$user_unit_helper" && -f "$durable_state_helper" && \
   -f "$database_helper" && -f "$database_probe" && \
   -f "$provider_import_migrator" && -x "$canonical_seed_runner" && \
   -x "$cutover_runner" && -x "$instagram_credit_rearm_runner" && \
   -x "$raw_verifier_provision_runner" && \
   -f "$cutover_result_validator" && -d "$systemd_dir" && \
   -x "$node_runtime_installer" && -f "$tmpfiles_source" && \
   ! -L "$tmpfiles_source" ]] || \
  fail 'release verifier, activation, supervisor, and unit sources are required'
declare -A expected_unit=()
for unit_file in "${unit_files[@]}"; do
  expected_unit["$unit_file"]=1
  [[ -f "$systemd_dir/$unit_file" && ! -L "$systemd_dir/$unit_file" ]] || \
    fail "required systemd unit is missing or linked: $unit_file"
done
while IFS= read -r -d '' unit_entry; do
  unit_basename="${unit_entry##*/}"
  [[ -f "$unit_entry" && ! -L "$unit_entry" && -n "${expected_unit[$unit_basename]:-}" ]] || \
    fail "unexpected systemd inventory entry: $unit_basename"
done < <(find "$systemd_dir" -mindepth 1 -maxdepth 1 -print0 | LC_ALL=C sort -z)
bash -n "$canonical_installer" "$verifier" "$supervisor" "$health_checker" \
  "$activator" "$builder" "$canonical_seed_runner" "$cutover_runner" \
  "$instagram_credit_rearm_runner" "$raw_verifier_provision_runner" \
  "$node_runtime_installer"
python3 -I -c \
  'import pathlib,sys; [compile(pathlib.Path(p).read_text(), p, "exec") for p in sys.argv[1:]]' \
  "$config_renderer" "$activation_boundary" "$system_state_helper" \
  "$user_unit_helper" "$durable_state_helper" "$database_helper" "$database_probe" \
  "$provider_import_migrator" "$cutover_result_validator"
readonly node_toolchain='/opt/creator-tracker/node/v24.20.0'
readonly expected_node_distribution_sha256='2f2c0da162318f0de47665410c7c8c2ed3d36c8f3105de4bbc61176c70a7cbf2'
node_path="$node_toolchain/bin/node"
npm_path="$node_toolchain/lib/node_modules/npm/bin/npm-cli.js"
[[ -f "$node_path" && ! -L "$node_path" && -x "$node_path" && \
   -f "$npm_path" && ! -L "$npm_path" && \
   "$(<"$node_toolchain/DISTRIBUTION_SHA256")" == "$expected_node_distribution_sha256" && \
   "$(stat -c '%u:%g:%h' -- "$node_path" "$npm_path")" == $'0:0:1\n0:0:1' ]] || \
  fail 'install and verify the pinned root-owned Node 24.20.0 toolchain first'
if find "$node_toolchain" -xdev \( ! -uid 0 -o ! -gid 0 \) -print -quit | grep -q . || \
   find "$node_toolchain" -xdev -type f -perm /022 -print -quit | grep -q .; then
  fail 'pinned Node toolchain ownership or mutability drifted'
fi

node_sha256="$(sha256sum -- "$node_path" | awk '{print $1}')"
npm_cli_source="$(readlink -f -- "$npm_path")"
npm_cli_sha256="$(sha256sum -- "$npm_cli_source" | awk '{print $1}')"
ops_inputs=(
  "$canonical_installer"
  "$release_tools_manifest"
  "$verifier"
  "$supervisor"
  "$health_checker"
  "$activator"
  "$builder"
  "$config_renderer"
  "$activation_boundary"
  "$system_state_helper"
  "$user_unit_helper"
  "$durable_state_helper"
  "$database_helper"
  "$database_probe"
  "$provider_import_migrator"
  "$canonical_seed_runner"
  "$cutover_runner"
  "$instagram_credit_rearm_runner"
  "$raw_verifier_provision_runner"
  "$cutover_result_validator"
  "$node_runtime_installer"
  "$tmpfiles_source"
)
for unit_file in "${unit_files[@]}"; do
  ops_inputs+=("$systemd_dir/$unit_file")
done
ops_input_manifest="$tmp_dir/ops-inputs.sha256"
: >"$ops_input_manifest"
for ops_input in "${ops_inputs[@]}"; do
  ops_relative="${ops_input#"$tracker_dir/"}"
  printf '%s\t%s\n' "$(sha256sum -- "$ops_input" | awk '{print $1}')" \
    "$ops_relative" >>"$ops_input_manifest"
done
ops_bundle_sha256="$(sha256sum -- "$ops_input_manifest" | awk '{print $1}')"
release_id="$(printf 'format_version=3\napp_commit=%s\nnode_sha256=%s\nnpm_cli_sha256=%s\nops_bundle_sha256=%s\n' \
  "$commit" "$node_sha256" "$npm_cli_sha256" "$ops_bundle_sha256" | \
  sha256sum | awk '{print $1}')"
[[ "$release_id" =~ ^[0-9a-f]{64}$ ]] || fail 'could not derive the composite release ID'

release_stage="$tmp_dir/release/$release_id"
mkdir -p "$release_stage/app" "$release_stage/bin" "$release_stage/runtime" \
  "$release_stage/systemd" "$release_stage/tmpfiles.d"
"${source_git[@]}" archive --format=tar "$commit" | tar -xf - -C "$release_stage/app"
if find "$release_stage/app" -xdev -type l -print -quit | grep -q .; then
  fail 'archived application source contains a symlink'
fi
if find "$release_stage/app" -xdev ! -type d ! -type f -print -quit | grep -q .; then
  fail 'archived application source contains a special filesystem object'
fi
if find "$release_stage/app" -xdev -type f -links +1 -print -quit | grep -q .; then
  fail 'archived application source contains a multiply-linked file'
fi
pristine_source="$tmp_dir/pristine-source"
cp -a -- "$release_stage/app" "$pristine_source"
chmod 0700 "$pristine_source"

build_root="$tmp_dir/isolated-build"
build_home="$build_root/home"
npm_cache="$build_root/npm-cache"
tool_bin="$node_toolchain/bin"
npm_cli="$npm_path"
install -d -o creator-tracker-builder -g creator-tracker-builder -m 0700 \
  "$build_home" "$npm_cache"
chown -hR creator-tracker-builder:creator-tracker-builder "$release_stage/app"
chgrp creator-tracker-builder "$tmp_dir" "$tmp_dir/release" "$release_stage" "$build_root"
chmod 0710 "$tmp_dir" "$tmp_dir/release" "$release_stage" "$build_root"
[[ "$(stat -c '%U %G %a' -- /var/lib/creator-tracker/build-staging)" == \
   'root creator-tracker-builder 710' ]] || \
  fail 'builder staging parent does not have the isolated traversal identity'
for builder_parent in "$tmp_dir" "$tmp_dir/release" "$release_stage" "$build_root"; do
  [[ "$(stat -c '%U %G %a' -- "$builder_parent")" == \
     'root creator-tracker-builder 710' ]] || \
    fail 'builder staging path does not have the isolated traversal identity'
done

run_isolated_build_phase() {
  local phase="$1"
  local unit="creator-tracker-build-${phase}-${release_id:0:12}-$$"
  local -a network_properties=(
    --property=RestrictAddressFamilies='AF_UNIX AF_INET AF_INET6'
    --property=BindReadOnlyPaths=/run/systemd/resolve
  )
  if [[ "$phase" == verify ]]; then
    # Turbopack's build workers coordinate over a loopback TCP socket. Keep
    # those sockets inside an otherwise disconnected private network namespace.
    network_properties=(
      --property=PrivateNetwork=yes
      --property=RestrictAddressFamilies='AF_UNIX AF_INET AF_INET6'
    )
  fi
  systemd-run --quiet --wait --pipe --collect --unit="$unit" \
    --property=User=creator-tracker-builder --property=Group=creator-tracker-builder \
    --property="WorkingDirectory=$release_stage/app" \
    --property=Environment=PATH=/usr/bin:/bin \
    --property=UnsetEnvironment='LD_PRELOAD LD_LIBRARY_PATH LD_AUDIT BASH_ENV ENV SHELLOPTS BASHOPTS NODE_OPTIONS NODE_PATH PYTHONPATH PYTHONHOME' \
    --property=NoNewPrivileges=yes --property=CapabilityBoundingSet= \
    --property=AmbientCapabilities= --property=PrivateDevices=yes \
    --property=PrivateTmp=yes --property=PrivateIPC=yes \
    --property=PrivateMounts=yes --property=ProtectHome=tmpfs \
    --property=ProtectSystem=strict --property=ProtectProc=invisible \
    --property=ProcSubset=all --property=RestrictNamespaces=yes \
    --property=RestrictSUIDSGID=yes --property=LockPersonality=yes \
    --property=SystemCallArchitectures=native \
    --property=InaccessiblePaths='/root -/etc/creator-tracker -/opt/creator-tracker/releases -/opt/creator-tracker/activation-transactions -/var/lib/creator-tracker/state -/var/lib/creator-tracker/imports -/var/lib/creator-tracker/raw-evidence-v1 -/var/lib/creator-tracker/verified-raw-evidence-v1' \
    --property=InaccessiblePaths='-/usr/bin/sudo -/bin/su -/usr/bin/su -/usr/sbin/runuser' \
    --property="BindReadOnlyPaths=$node_toolchain" \
    --property="ReadWritePaths=$release_stage/app $build_home $npm_cache" \
    "${network_properties[@]}" \
    /bin/bash --noprofile --norc -p -- "$builder" "$phase" \
      "$release_stage/app" "$build_home" "$npm_cache" "$tool_bin" \
      "$npm_cli" "$release_id"
}

run_isolated_build_phase install
run_isolated_build_phase verify
# The builder is finished. Revoke its traversal group from the whole candidate,
# including the release root that was temporarily root:builder 0710.
chown -hR root:root "$release_stage" "$build_home" "$npm_cache"
if ! diff -qr --no-dereference --exclude=node_modules --exclude=.next \
    --exclude=next-env.d.ts --exclude=tsconfig.tsbuildinfo \
    "$pristine_source" "$release_stage/app" >/dev/null; then
  fail 'candidate build changed or added files outside explicit generated outputs'
fi
if find "$release_stage/app" -xdev \( -path "$release_stage/app/node_modules" -o \
    -path "$release_stage/app/.next" \) -prune -o -type l -print -quit | grep -q .; then
  fail 'candidate build introduced a source-tree symlink outside generated outputs'
fi

[[ -s "$release_stage/app/.next/BUILD_ID" ]] || fail 'build did not produce .next/BUILD_ID'
[[ "$(<"$release_stage/app/.next/BUILD_ID")" == "$release_id" ]] || \
  fail 'Next.js build ID does not match the composite release ID'
# npm may hard-link duplicate package binaries. Break every such link before
# sealing so no release pathname shares a writable inode, even internally.
while IFS= read -r -d '' linked_file; do
  replacement="$(mktemp "$(dirname -- "$linked_file")/.creator-tracker-dedup.XXXXXX")"
  cp --reflink=never --preserve=mode,timestamps -- "$linked_file" "$replacement"
  mv -f -- "$replacement" "$linked_file"
done < <(find "$release_stage/app" -xdev -type f -links +1 -print0)
install -m 0755 "$node_path" "$release_stage/runtime/node"
install -m 0755 "$verifier" "$release_stage/bin/verify-release"
install -m 0755 "$supervisor" "$release_stage/bin/run-contained-job"
install -m 0755 "$health_checker" "$release_stage/bin/check-dashboard-health"
install -m 0755 "$activator" "$release_stage/bin/activate-release"
install -m 0755 "$config_renderer" "$release_stage/bin/render-config"
install -m 0755 "$activation_boundary" "$release_stage/bin/activation-boundary"
install -m 0755 "$system_state_helper" "$release_stage/bin/activation-system-state"
install -m 0755 "$user_unit_helper" "$release_stage/bin/activation-user-units"
install -m 0755 "$durable_state_helper" "$release_stage/bin/durable-state"
install -m 0755 "$database_helper" "$release_stage/bin/activation-database"
install -m 0755 "$database_probe" "$release_stage/bin/probe-database-access"
install -m 0755 "$provider_import_migrator" "$release_stage/bin/migrate-provider-imports"
install -m 0755 "$canonical_seed_runner" "$release_stage/bin/run-canonical-seed"
install -m 0755 "$cutover_runner" "$release_stage/bin/run-cutover-completeness"
install -m 0755 "$instagram_credit_rearm_runner" \
  "$release_stage/bin/run-instagram-credit-rearm"
install -m 0755 "$raw_verifier_provision_runner" \
  "$release_stage/bin/run-raw-verifier-provision"
install -m 0755 "$cutover_result_validator" "$release_stage/bin/validate-cutover-result"
install -m 0644 "$tmpfiles_source" "$release_stage/tmpfiles.d/creator-tracker.conf"
for unit_file in "${unit_files[@]}"; do
  install -m 0644 "$systemd_dir/$unit_file" "$release_stage/systemd/$unit_file"
done
ops_input_manifest_after="$tmp_dir/ops-inputs-after.sha256"
: >"$ops_input_manifest_after"
for ops_input in "${ops_inputs[@]}"; do
  ops_relative="${ops_input#"$tracker_dir/"}"
  printf '%s\t%s\n' "$(sha256sum -- "$ops_input" | awk '{print $1}')" \
    "$ops_relative" >>"$ops_input_manifest_after"
done
cmp -s "$ops_input_manifest" "$ops_input_manifest_after" || \
  fail 'tracker ops sources changed while the release was being assembled'
cmp -s "$verifier" "$release_stage/bin/verify-release" || \
  fail 'embedded verifier differs from its release-identity input'
cmp -s "$supervisor" "$release_stage/bin/run-contained-job" || \
  fail 'embedded supervisor differs from its release-identity input'
cmp -s "$health_checker" "$release_stage/bin/check-dashboard-health" || \
  fail 'embedded health checker differs from its release-identity input'
cmp -s "$activator" "$release_stage/bin/activate-release" || \
  fail 'embedded activator differs from its release-identity input'
cmp -s "$config_renderer" "$release_stage/bin/render-config" || \
  fail 'embedded config renderer differs from its release-identity input'
cmp -s "$activation_boundary" "$release_stage/bin/activation-boundary" || \
  fail 'embedded activation boundary helper differs from its release-identity input'
cmp -s "$system_state_helper" "$release_stage/bin/activation-system-state" || \
  fail 'embedded system state helper differs from its release-identity input'
cmp -s "$user_unit_helper" "$release_stage/bin/activation-user-units" || \
  fail 'embedded legacy user-unit helper differs from its release-identity input'
cmp -s "$durable_state_helper" "$release_stage/bin/durable-state" || \
  fail 'embedded durable-state helper differs from its release-identity input'
cmp -s "$database_helper" "$release_stage/bin/activation-database" || \
  fail 'embedded database helper differs from its release-identity input'
cmp -s "$database_probe" "$release_stage/bin/probe-database-access" || \
  fail 'embedded database probe differs from its release-identity input'
cmp -s "$provider_import_migrator" "$release_stage/bin/migrate-provider-imports" || \
  fail 'embedded provider import migrator differs from its release-identity input'
cmp -s "$canonical_seed_runner" "$release_stage/bin/run-canonical-seed" || \
  fail 'embedded canonical seed runner differs from its release-identity input'
cmp -s "$cutover_runner" "$release_stage/bin/run-cutover-completeness" || \
  fail 'embedded cutover runner differs from its release-identity input'
cmp -s "$instagram_credit_rearm_runner" \
  "$release_stage/bin/run-instagram-credit-rearm" || \
  fail 'embedded Instagram credit rearm runner differs from its release-identity input'
cmp -s "$raw_verifier_provision_runner" \
  "$release_stage/bin/run-raw-verifier-provision" || \
  fail 'embedded raw verifier provision runner differs from its release-identity input'
cmp -s "$cutover_result_validator" "$release_stage/bin/validate-cutover-result" || \
  fail 'embedded cutover result validator differs from its release-identity input'
cmp -s "$tmpfiles_source" "$release_stage/tmpfiles.d/creator-tracker.conf" || \
  fail 'embedded tmpfiles definition differs from its release-identity input'
for unit_file in "${unit_files[@]}"; do
  cmp -s "$systemd_dir/$unit_file" "$release_stage/systemd/$unit_file" || \
    fail 'embedded unit differs from its release-identity input'
done
for role in roster-refresh scheduler-tick instagram-discovery instagram-scheduler \
  instagram-credit-rearm \
  provider-reconcile canonical-delivery canonical-replay canonical-seed raw-verifier cutover-verify migrate-database \
  collector-worker check-coverage; do
  ln -s ../app/ops/owned-tracker/release-entrypoint "$release_stage/bin/$role"
done
printf '%s\n' "$release_id" >"$release_stage/RELEASE_ID"
printf '%s\n' "$commit" >"$release_stage/APP_COMMIT"
"$node_path" --version >"$release_stage/NODE_VERSION"
printf '%s\n' "$node_sha256" >"$release_stage/NODE_SHA256"
printf '%s\n' "$npm_cli_sha256" >"$release_stage/NPM_CLI_SHA256"
cp -- "$ops_input_manifest" "$release_stage/OPS_INPUTS.sha256"
printf '%s\n' "$ops_bundle_sha256" >"$release_stage/OPS_BUNDLE_SHA256"
{
  printf 'format_version=3\n'
  printf 'release_id=%s\n' "$release_id"
  printf 'app_commit=%s\n' "$commit"
  printf 'node_sha256=%s\n' "$node_sha256"
  printf 'npm_cli_sha256=%s\n' "$npm_cli_sha256"
  printf 'ops_bundle_sha256=%s\n' "$ops_bundle_sha256"
  printf 'node_version=%s\n' "$(<"$release_stage/NODE_VERSION")"
  printf 'verification=isolated_builder_network_audit_plus_private_rebuild_test_typecheck_build\n'
  printf 'secrets=external_not_copied\n'
  printf 'database=/var/lib/creator-tracker/state/gotall-viral.db\n'
} >"$release_stage/RELEASE_INFO"
printf '%s\n' "$release_id" >"$release_stage/.creator-tracker-unsealed-release"
"$verifier" --seal-staged "$release_stage" "$release_id"
# Hold the sealed inventories in process memory before any privileged copy.
# A same-UID process that coherently rewrites a staged runtime file and its
# MANIFEST after this boundary cannot alter these expected digests.
expected_manifest_sha256="$(sha256sum -- "$release_stage/MANIFEST.sha256" | awk '{print $1}')"
expected_directories_sha256="$(sha256sum -- "$release_stage/DIRECTORIES.tsv" | awk '{print $1}')"
expected_symlinks_sha256="$(sha256sum -- "$release_stage/SYMLINKS.tsv" | awk '{print $1}')"

if [[ -n "$prepare_only" ]]; then
  prepared_release="$prepare_only/$release_id"
  [[ ! -e "$prepared_release" ]] || fail 'prepare-only release already exists'
  install -d -m 0755 "$prepare_only"
  cp -a -- "$release_stage" "$prepared_release"
  "$verifier" --staged "$prepared_release" "$release_id"
  printf 'creator-tracker release prepared but not installed: %s\n' "$prepared_release"
  exit 0
fi

readonly release_parent='/opt/creator-tracker/releases'
target="$release_parent/$release_id"
install -d -o root -g root -m 0755 /opt/creator-tracker "$release_parent"
if test -e "$target"; then
  "$target/bin/verify-release" --installed "$target" "$release_id"
  if ! cmp -s "$release_stage/MANIFEST.sha256" "$target/MANIFEST.sha256" || \
     ! cmp -s "$release_stage/DIRECTORIES.tsv" "$target/DIRECTORIES.tsv" || \
     ! cmp -s "$release_stage/SYMLINKS.tsv" "$target/SYMLINKS.tsv"; then
    fail 'same composite release ID produced a different sealed artifact'
  fi
  printf 'creator-tracker release already installed and byte-identical: %s\n' "$target"
  exit 0
fi

root_stage="$(mktemp -d "$release_parent/.${release_id}.XXXXXX")"
cp -a -- "$release_stage/." "$root_stage/"
chown -hR root:root "$root_stage"
chmod 0555 "$root_stage"
[[ "$(sha256sum -- "$root_stage/MANIFEST.sha256" | awk '{print $1}')" == \
   "$expected_manifest_sha256" &&
   "$(sha256sum -- "$root_stage/DIRECTORIES.tsv" | awk '{print $1}')" == \
   "$expected_directories_sha256" &&
   "$(sha256sum -- "$root_stage/SYMLINKS.tsv" | awk '{print $1}')" == \
   "$expected_symlinks_sha256" ]] || \
  fail 'sealed staging inventories changed before the privileged copy completed'
"$root_stage/bin/verify-release" --root-staged "$root_stage" "$release_id"
mv -T -- "$root_stage" "$target"
root_stage=''
"$target/bin/verify-release" --installed "$target" "$release_id"
printf 'creator-tracker release installed but not activated: %s app_commit=%s\n' \
  "$target" "$commit"
