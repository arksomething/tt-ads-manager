# Viral.app preservation tools

The private September 24 archive is at
`/home/ark296/archives/viral-app/2026-09-24/`, outside Git and deployments.
Its `README.md`, `coverage.json`, SQLite database, raw responses, offline index,
and verified ZIP are the deliverables. Do not commit the private archive.

`archive.py` reads the existing legacy application's private API credentials.
It permits GET and documented POST export routes only, uses the configured
workspace, checkpoints each response, and honors provider Retry-After delays.
It never uses live upstream lookups or sends the API key to CSV download hosts.

Order of operation:

1. Preserve the public OpenAPI specification in the archive's `spec/` directory.
2. Run `archive.py core` to inventory and capture workspace/account data.
   Once inventory exists, `archive.py bulk` can prioritize bulk video history.
   Both phases resume completed responses/verified CSVs.
3. `preserve_local.py` copies the specifically inventoried older Viral audit
   caches and source reports. Tracker provider imports/observations are copied
   separately through a read-only database query by an authorized operator.
4. `index_history.py` indexes original JSON pointers and preserves the
   distinction between lifetime and period-specific source values.
5. After collection stops, run `finalize.py` to build CSV/SQLite/offline access,
   calculate checksums, and create and CRC-verify the ZIP.

The current scripts intentionally pin the private capture directory and
credential authority. Use a new directory for a new capture instead of
overwriting the old archive. Avoid concurrent collection and final packaging.

Verification: `python3 tools/viral-archive/test_archive.py`, pagination counts,
provider CSV row counts and SHA-256 hashes, SQLite integrity, historical JSON
pointers, API-key leak scan, offline-index JavaScript syntax, and ZIP integrity.
Core history preserves the provider's own missing/zero-filled/aggregated states.
It does not claim exact-time observations or fill unavailable payout evidence.
