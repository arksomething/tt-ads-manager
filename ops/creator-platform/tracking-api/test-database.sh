#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../../.."
psql -X -f ops/creator-platform/tracking-api/database-test.sql
psql -X -f ops/creator-platform/tracking-api/source-adversarial-test.sql
node ops/creator-platform/tracking-api/adversarial-test.mjs
