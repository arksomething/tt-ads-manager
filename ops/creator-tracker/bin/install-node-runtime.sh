#!/bin/bash -p
set -euo pipefail

export PATH='/usr/sbin:/usr/bin:/sbin:/bin'
unset NODE_OPTIONS NODE_PATH LD_PRELOAD LD_LIBRARY_PATH LD_AUDIT BASH_ENV ENV || true

readonly node_version='v24.20.0'
readonly archive_name='node-v24.20.0-linux-x64.tar.xz'
readonly archive_sha256='2f2c0da162318f0de47665410c7c8c2ed3d36c8f3105de4bbc61176c70a7cbf2'
readonly distribution_url="https://nodejs.org/dist/${node_version}/${archive_name}"
readonly install_parent='/opt/creator-tracker/node'
readonly install_dir="$install_parent/$node_version"

fail() {
  printf 'creator-tracker Node runtime install: %s\n' "$*" >&2
  exit 1
}

canonical_self="$(readlink -f -- "${BASH_SOURCE[0]}")"
[[ "$canonical_self" =~ ^/opt/creator-tracker/release-tools/[0-9a-f]{64}/bin/install-node-runtime\.sh$ ]] || \
  fail 'installer must run from a reviewed root-controlled release-tools bundle'
readonly release_tools_root="${canonical_self%/bin/install-node-runtime.sh}"
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
  exec sudo -n /usr/bin/env -i -- PATH=/usr/sbin:/usr/bin:/sbin:/bin \
    LANG=C.UTF-8 LC_ALL=C.UTF-8 \
    /bin/bash --noprofile --norc -p -- "$canonical_self"
fi
(($# == 0)) || fail 'this installer does not accept arguments'

verify_immutable_provenance() {
  [[ -d "$install_dir" && ! -L "$install_dir" && \
     -f "$install_dir/bin/node" && ! -L "$install_dir/bin/node" && \
     -f "$install_dir/lib/node_modules/npm/bin/npm-cli.js" && \
     ! -L "$install_dir/lib/node_modules/npm/bin/npm-cli.js" && \
     "$(<"$install_dir/DISTRIBUTION_SHA256")" == "$archive_sha256" ]] || return 1
  if find "$install_dir" -xdev \( ! -uid 0 -o ! -gid 0 \) -print -quit | grep -q .; then
    return 1
  fi
  if find "$install_dir" -xdev -type d -perm /022 -print -quit | grep -q . || \
     find "$install_dir" -xdev -type f -perm /022 -print -quit | grep -q .; then
    return 1
  fi
  if find "$install_dir" -xdev ! -type d ! -type f ! -type l -print -quit | grep -q . || \
     find "$install_dir" -xdev -type f -links +1 -print -quit | grep -q .; then
    return 1
  fi
  while IFS= read -r -d '' link; do
    resolved="$(readlink -m -- "$(dirname -- "$link")/$(readlink -- "$link")")"
    [[ "$resolved" == "$install_dir"/* ]] || return 1
  done < <(find "$install_dir" -xdev -type l -print0)
  [[ "$($install_dir/bin/node --version)" == "$node_version" ]]
}

verify_installed() {
  verify_immutable_provenance || return 1
  ! find "$install_dir" -xdev -type d ! -perm 0555 -print -quit | grep -q .
}

if [[ -e "$install_dir" || -L "$install_dir" ]]; then
  if verify_installed; then
    printf 'creator-tracker Node runtime already verified: %s\n' "$install_dir"
    exit 0
  fi
  verify_immutable_provenance || \
    fail 'existing pinned Node runtime failed provenance checks'
  find "$install_dir" -xdev -type d -exec chmod 0555 {} +
  sync -d "$install_dir"
  sync -d "$install_parent"
  verify_installed || fail 'existing pinned Node runtime traversal repair failed'
  printf 'creator-tracker Node runtime traversal normalized: %s\n' "$install_dir"
  exit 0
fi

stage_parent="$(mktemp -d /var/tmp/creator-tracker-node.XXXXXX)"
trap 'chmod -R u+w -- "$stage_parent" 2>/dev/null || true; rm -rf -- "$stage_parent"' EXIT
archive="$stage_parent/$archive_name"
/usr/bin/curl --disable --proto '=https' --tlsv1.2 --fail --silent --show-error \
  --location "$distribution_url" --output "$archive"
[[ "$(sha256sum -- "$archive" | awk '{print $1}')" == "$archive_sha256" ]] || \
  fail 'downloaded Node distribution hash does not match the compiled-in release checksum'

extract="$stage_parent/extract"
install -d -o root -g root -m 0700 "$extract"
/usr/bin/tar --extract --xz --file "$archive" --directory "$extract" \
  --strip-components=1 --no-same-owner --no-same-permissions
if find "$extract" -xdev ! -type d ! -type f ! -type l -print -quit | grep -q .; then
  fail 'Node distribution contains a special filesystem object'
fi
while IFS= read -r -d '' link; do
  resolved="$(readlink -m -- "$(dirname -- "$link")/$(readlink -- "$link")")"
  [[ "$resolved" == "$extract"/* ]] || fail 'Node distribution symlink escapes its root'
done < <(find "$extract" -xdev -type l -print0)
printf '%s\n' "$archive_sha256" >"$extract/DISTRIBUTION_SHA256"
printf '%s\n' "$distribution_url" >"$extract/DISTRIBUTION_URL"
chown -hR root:root "$extract"
find "$extract" -xdev -type d -exec chmod 0555 {} +
find "$extract" -xdev -type f -exec chmod a-w {} +
install -d -o root -g root -m 0755 /opt/creator-tracker "$install_parent"
mv -T -- "$extract" "$install_dir"
verify_installed || fail 'installed pinned Node runtime failed final verification'
printf 'creator-tracker Node runtime installed: %s sha256=%s\n' \
  "$install_dir" "$archive_sha256"
