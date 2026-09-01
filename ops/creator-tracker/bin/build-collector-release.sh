#!/bin/bash -p
set -euo pipefail

export PATH='/usr/bin:/bin'
unset NODE_OPTIONS NODE_PATH LD_PRELOAD LD_LIBRARY_PATH LD_AUDIT BASH_ENV ENV || true

fail() {
  printf 'creator-tracker isolated build: %s\n' "$*" >&2
  exit 1
}

[[ $# == 7 ]] || fail 'expected PHASE APP HOME CACHE TOOL_BIN NPM_CLI RELEASE_ID'
phase="$1"
app="$2"
build_home="$3"
npm_cache="$4"
tool_bin="$5"
npm_cli="$6"
release_id="$7"
node_gyp="${npm_cli%/bin/npm-cli.js}/node_modules/node-gyp/bin/node-gyp.js"

[[ "$phase" == install || "$phase" == verify ]] || fail 'phase must be install or verify'
for path in "$app" "$build_home" "$npm_cache"; do
  [[ "$path" == /var/lib/creator-tracker/build-staging/* && "$path" != *'/../'* ]] || \
    fail 'build paths must stay inside the root-controlled staging root'
done
[[ "$tool_bin" == /opt/creator-tracker/node/v24.20.0/bin && \
   "$npm_cli" == /opt/creator-tracker/node/v24.20.0/lib/node_modules/npm/bin/npm-cli.js ]] || \
  fail 'builder toolchain must be the checksum-pinned root-owned Node distribution'
[[ -f "$node_gyp" && ! -L "$node_gyp" ]] || \
  fail 'builder node-gyp must come from the pinned root-owned npm distribution'
[[ "$release_id" =~ ^[0-9a-f]{64}$ ]] || fail 'release ID is invalid'
[[ "$(id -un)" == creator-tracker-builder && "$(id -Gn)" == creator-tracker-builder ]] || \
  fail 'build must run as the isolated no-login builder'
[[ -d "$app" && ! -L "$app" && -d "$build_home" && ! -L "$build_home" && \
   -d "$npm_cache" && ! -L "$npm_cache" && -x "$tool_bin/node" && \
   -f "$npm_cli" && ! -L "$npm_cli" ]] || fail 'isolated build inputs are unsafe'

readonly -a clean_environment=(
  "HOME=$build_home"
  'USER=creator-tracker-builder'
  'LOGNAME=creator-tracker-builder'
  "PATH=$tool_bin:/usr/bin:/bin"
  'LANG=C.UTF-8'
  'LC_ALL=C.UTF-8'
  'CI=1'
  'NEXT_TELEMETRY_DISABLED=1'
  'NPM_CONFIG_USERCONFIG=/dev/null'
  "NPM_CONFIG_CACHE=$npm_cache"
  'NPM_CONFIG_AUDIT=false'
  'NPM_CONFIG_FUND=false'
  'NPM_CONFIG_UPDATE_NOTIFIER=false'
)

cd -- "$app"
case "$phase" in
  install)
    /usr/bin/env -i -- "${clean_environment[@]}" \
      "$tool_bin/node" "$npm_cli" ci --ignore-scripts
    # The audit endpoint is network-backed and is therefore consumed only in
    # this dependency-retrieval phase. The private verification phase below
    # never relies on an npm audit cache or any other network response.
    /usr/bin/env -i -- "${clean_environment[@]}" 'NPM_CONFIG_AUDIT=true' \
      "$tool_bin/node" "$npm_cli" audit --audit-level=low
    ;;
  verify)
    /usr/bin/env -i -- "${clean_environment[@]}" \
      "NPM_CONFIG_NODEDIR=${tool_bin%/bin}" \
      "$tool_bin/node" "$npm_cli" rebuild --offline
    native_root="$app/node_modules/better-sqlite3"
    native_prebuild="$native_root/prebuilds/linux-x64.node"
    native_build="$native_root/build/Release/better_sqlite3.node"
    [[ -d "$native_root" && ! -L "$native_root" && \
       -f "$native_prebuild" && ! -L "$native_prebuild" && \
       "$(stat -c '%h' -- "$native_prebuild")" == 1 ]] || \
      fail 'better-sqlite3 source or pinned Linux prebuild is unsafe'
    [[ "$(/usr/bin/env -i -- "${clean_environment[@]}" \
       "$tool_bin/node" -p "require('$native_root/package.json').version")" == \
       13.0.3 ]] || fail 'better-sqlite3 release version is not the reviewed pin'
    (
      cd -- "$native_root"
      /usr/bin/env -i -- "${clean_environment[@]}" \
        "$tool_bin/node" "$node_gyp" clean
      /usr/bin/env -i -- "${clean_environment[@]}" \
        "$tool_bin/node" "$node_gyp" rebuild --release --force_build=1 \
          "--nodedir=${tool_bin%/bin}"
    )
    [[ -f "$native_build" && ! -L "$native_build" && \
       "$(stat -c '%s' -- "$native_build")" -ge 1048576 && \
       "$(stat -c '%s' -- "$native_build")" -le 16777216 ]] || \
      fail 'better-sqlite3 source build did not produce the bounded native addon'
    # node-gyp's COPY target normally hard-links the loadable addon to its
    # obj.target output. Give the runtime pathname its own inode before any
    # import or sealing step so the verified addon has no mutable alias.
    native_replacement="$(mktemp "$native_root/build/Release/.better_sqlite3.node.XXXXXX")"
    cp --reflink=never --preserve=mode,timestamps -- \
      "$native_build" "$native_replacement"
    mv -f -- "$native_replacement" "$native_build"
    [[ -f "$native_build" && ! -L "$native_build" && \
       "$(stat -c '%h' -- "$native_build")" == 1 ]] || \
      fail 'better-sqlite3 source-built runtime addon still has an unsafe inode alias'
    unlink -- "$native_prebuild"
    [[ ! -e "$native_prebuild" && ! -L "$native_prebuild" ]] || \
      fail 'better-sqlite3 host prebuild remained after source compilation'
    /usr/bin/env -i -- "${clean_environment[@]}" \
      BETTER_SQLITE3_EXPECTED_BINDING="$native_build" \
      "$tool_bin/node" --input-type=commonjs -e \
      'const Module=require("module"); const expected=process.env.BETTER_SQLITE3_EXPECTED_BINDING; const load=Module._extensions[".node"]; Module._extensions[".node"]=(module,filename)=>{if(filename.includes("better-sqlite3")&&filename!==expected)throw new Error("unexpected better-sqlite3 binding"); return load(module,filename)}; const Database=require("better-sqlite3"); const database=new Database(":memory:"); database.prepare("select 1").get(); database.close();'
    /usr/bin/env -i -- "${clean_environment[@]}" \
      "CREATOR_TRACKER_RELEASE_ID=$release_id" \
      "$tool_bin/node" "$npm_cli" test
    /usr/bin/env -i -- "${clean_environment[@]}" \
      "CREATOR_TRACKER_RELEASE_ID=$release_id" \
      "$tool_bin/node" "$npm_cli" run typecheck
    build_fixture="/tmp/creator-tracker-release-build-$release_id"
    install -d -m 0700 "$build_fixture"
    # Next imports the dashboard's fail-closed read-only database module while
    # collecting route metadata, even for force-dynamic pages. Give that import
    # a new empty WAL database inside PrivateTmp. Candidate JavaScript performs
    # this bootstrap only as the no-login builder; it never sees the live state
    # database, a home directory, or any release/runtime credential.
    /usr/bin/env -i -- "${clean_environment[@]}" \
      "CREATOR_TRACKER_RELEASE_ID=$release_id" \
      'GOTALL_SHADOW_MODE=0' \
      'GOTALL_MODE_ZERO_FIXTURE=1' \
      "VIRAL_DB_PATH=$build_fixture/gotall-build.db" \
      'NODE_ENV=production' \
      "$tool_bin/node" --import tsx --input-type=module \
      -e "await import('./src/db/index.ts')"
    /usr/bin/env -i -- "${clean_environment[@]}" \
      "CREATOR_TRACKER_RELEASE_ID=$release_id" \
      'GOTALL_SHADOW_MODE=0' \
      'GOTALL_MODE_ZERO_FIXTURE=1' \
      "VIRAL_DB_PATH=$build_fixture/gotall-build.db" \
      "$tool_bin/node" "$npm_cli" run build
    ;;
esac
