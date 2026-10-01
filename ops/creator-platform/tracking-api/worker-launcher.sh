#!/bin/bash
set -euo pipefail
readonly collector_app="$(readlink -f /opt/creator-tracker/current/app)"
readonly worker_root="$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")"
cd "$collector_app"
exec /usr/bin/flock -n -E 75 /run/creator-tracker/locks/owned-tracker-writer.lock \
  /usr/bin/env -i PATH=/usr/bin:/bin NODE_ENV=production \
  GOTALL_SHADOW_MODE=1 VIRAL_DB_PATH=/var/lib/creator-tracker/state/gotall-viral.db \
  CREATOR_TRACKER_SEALED_RUNTIME=1 CREATOR_TRACKER_DATABASE_ACCESS=writer \
  /opt/creator-tracker/node/v24.20.0/bin/node \
  --env-file="${CREDENTIALS_DIRECTORY}/provider-env" \
  --env-file="${CREDENTIALS_DIRECTORY}/api-env" \
  --import "$collector_app/node_modules/tsx/dist/loader.mjs" \
  "$worker_root/worker.mjs"
